import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { getRepIdByEmail } from '@/lib/queries/call-intelligence-evaluations';
import { getRepIdsVisibleToActor } from '@/lib/queries/call-intelligence/visible-reps';
import { getOpportunityHeader } from '@/lib/queries/opportunity-header';
import {
  getCallSummariesForOpportunity,
  getObjectionsForCalls,
  getCachedSummary,
  upsertCachedSummary,
  computeCallNoteIdsHash,
} from '@/lib/queries/call-intelligence/opportunity-ai-summary';
import type { CallSummaryMapped, ObjectionMapped, CompetitorItem } from '@/lib/queries/call-intelligence/opportunity-ai-summary';
import type { OpportunityHeader } from '@/types/call-intelligence-opportunities';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SFDC_ID_RE = /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/;
const ALLOWED_ROLES = ['manager', 'admin', 'revops_admin', 'sgm', 'sga'] as const;
const CLAUDE_MODEL = 'claude-sonnet-4-6';
const CLAUDE_MAX_RETRIES = 3;
const CLAUDE_RETRY_BASE_MS = 1000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const AiSummarySchema = z.object({
  painPoints: z.array(z.string()).default([]),
  competitorsInTheMix: z.array(z.string()).default([]),
  nextSteps: z.array(z.string()).default([]),
  compensationDiscussions: z.array(z.string()).default([]),
  advisorConcerns: z.array(z.string()).default([]),
});

// ---------------------------------------------------------------------------
// Auth helper (shared between GET and POST)
// ---------------------------------------------------------------------------

async function authenticate(opportunityId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const permissions = getSessionPermissions(session);
  if (!permissions) {
    return { error: NextResponse.json({ error: 'Session invalid' }, { status: 401 }) };
  }

  if (!permissions.allowedPages.includes(20)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  if (!(ALLOWED_ROLES as readonly string[]).includes(permissions.role)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  if (!SFDC_ID_RE.test(opportunityId) || !opportunityId.startsWith('006')) {
    return { error: NextResponse.json({ error: 'Invalid Opportunity ID' }, { status: 400 }) };
  }

  const header = await getOpportunityHeader(opportunityId);
  if (!header) {
    return { error: NextResponse.json({ error: 'Opportunity not found' }, { status: 404 }) };
  }

  const isPrivileged = permissions.role === 'admin' || permissions.role === 'revops_admin';
  const rep = await getRepIdByEmail(session.user.email);

  if (!rep && !isPrivileged) {
    return { error: NextResponse.json({ error: 'Rep not found' }, { status: 403 }) };
  }

  const actorRepId = rep?.id ?? '';
  const visibleRepIds = await getRepIdsVisibleToActor({
    repId: actorRepId,
    role: permissions.role,
    email: session.user.email,
  });

  const allRepIds = actorRepId && !visibleRepIds.includes(actorRepId)
    ? [actorRepId, ...visibleRepIds]
    : visibleRepIds;

  return { session, permissions, header, isPrivileged, allRepIds };
}

// ---------------------------------------------------------------------------
// Claude prompt builder
// ---------------------------------------------------------------------------

function buildPrompt(
  header: OpportunityHeader,
  calls: CallSummaryMapped[],
  objections: ObjectionMapped[],
): { system: string; user: string } {
  const system = `You are a deal analysis assistant for a wealth management recruiting firm. You analyze call summaries and structured extraction data to produce concise deal intelligence.

Return ONLY valid JSON with exactly these keys:
{
  "painPoints": string[],
  "competitorsInTheMix": string[],
  "nextSteps": string[],
  "compensationDiscussions": string[],
  "advisorConcerns": string[]
}

Rules:
- Write SHORT bullet fragments, not full sentences. Think quick-scan notes for a busy manager. Examples:
  GOOD: "Client minimums raised 4x ($300K→$1.5M), locks out core market (May 1 call)"
  BAD: "Savant has raised client minimums four times since acquisition — from $300K to $500K to $750K to $1.5M investable — locking Hannah out of her core under-40 professional network of dual-income couples and accumulators. (May 1 call)"
- Aim for 8-15 words per bullet, max 20 words. Strip filler and narrative.
- Synthesize across ALL calls, not just the most recent.
- EXCEPTION: "nextSteps" should ONLY contain action items from the MOST RECENT call (Call 1). Ignore next steps from older calls — they are stale.
- CRITICAL: Structured extraction data (competitors, objections) covers only ~20% of calls. You MUST also extract from the raw call summaries. Do NOT treat structured arrays as exhaustive.
- Deduplicate: do not repeat the same concept, even if it appears in both structured data and raw summaries.
- Return empty array [] for categories with no relevant data.
- For compensation: specifics — rev share %, equity terms, loan amounts, kicker structures.
- End each bullet with the call date tag in parentheses exactly as provided, e.g., "(May 2 call)". Use the exact tag format from the call headers.
- Do NOT wrap the JSON in markdown code fences.`;

  const parts: string[] = [];

  parts.push(`## Opportunity Context
- Name: ${header.name}
- Stage: ${header.stageName}
- Owner: ${header.ownerName}
- Amount: ${header.amount ? `$${(header.amount / 1_000_000).toFixed(1)}M` : 'N/A'}
- Close Date: ${header.closeDate || 'N/A'}`);

  parts.push(`\n## Call Summaries (${calls.length} calls, most recent first)`);
  calls.forEach((c, i) => {
    const date = new Date(c.callDate);
    const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const tag = `${dateStr} call`;
    parts.push(`\n### Call ${i + 1} — ${dateStr} [tag: "${tag}"]\n${c.summary}`);
  });

  const extractedCompetitors = calls.flatMap((c) =>
    c.competitorStatus === 'succeeded' ? c.competitors : [],
  );
  if (extractedCompetitors.length > 0) {
    parts.push(`\n## Structured Competitor Extractions (high-confidence, ~20% coverage)`);
    const seen = new Set<string>();
    for (const comp of extractedCompetitors) {
      const key = comp.canonicalBrand.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      parts.push(`- ${comp.canonicalBrand} (${comp.relationshipType}, confidence: ${comp.confidence})`);
    }
  }

  if (objections.length > 0) {
    parts.push(`\n## Structured Objection Extractions (high-confidence, ~24% coverage)`);
    for (const obj of objections) {
      parts.push(`- [${obj.objectionType}${obj.objectionSubtype ? '/' + obj.objectionSubtype : ''}] ${obj.objectionText}`);
      if (obj.handlingAssessment) {
        parts.push(`  Handling: ${obj.handlingAssessment}`);
      }
    }
  }

  return { system, user: parts.join('\n') };
}

// ---------------------------------------------------------------------------
// Claude API call with retry
// ---------------------------------------------------------------------------

async function callClaude(system: string, userMessage: string) {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < CLAUDE_MAX_RETRIES; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 2048,
        system,
        messages: [{ role: 'user', content: userMessage }],
      });

      const textBlock = response.content.find((b) => b.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        throw new Error('No text response from Claude');
      }

      const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in Claude response');
      }

      const parsed = AiSummarySchema.parse(JSON.parse(jsonMatch[0]));

      return {
        summary: parsed,
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const status = (error as Record<string, unknown>)?.status;
      const isRetryable = status === 429 || status === 529;

      if (isRetryable && attempt < CLAUDE_MAX_RETRIES - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, CLAUDE_RETRY_BASE_MS * Math.pow(2, attempt)),
        );
        continue;
      }

      if (isRetryable) {
        throw new Error('AI service temporarily overloaded. Please try again.');
      }
      throw error;
    }
  }

  throw lastError || new Error('Claude API call failed');
}

// ---------------------------------------------------------------------------
// Call date → call note ID map for UI linking
// ---------------------------------------------------------------------------

function buildCallDateMap(calls: CallSummaryMapped[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const c of calls) {
    const date = new Date(c.callDate);
    const tag = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' call';
    map[tag] = c.id;
  }
  return map;
}

// ---------------------------------------------------------------------------
// Core generation logic (shared between GET miss and POST)
// ---------------------------------------------------------------------------

async function generateSummary(
  opportunityId: string,
  header: OpportunityHeader,
  calls: CallSummaryMapped[],
) {
  const callIds = calls.map((c) => c.id);
  const objections = await getObjectionsForCalls(callIds);

  const { system, user } = buildPrompt(header, calls, objections);
  const { summary, promptTokens, completionTokens } = await callClaude(system, user);

  const hash = computeCallNoteIdsHash(callIds);

  await upsertCachedSummary({
    oppId: opportunityId,
    hash,
    callIds,
    painPoints: summary.painPoints,
    competitorsInMix: summary.competitorsInTheMix,
    nextSteps: summary.nextSteps,
    compensationDiscussions: summary.compensationDiscussions,
    advisorConcerns: summary.advisorConcerns,
    model: CLAUDE_MODEL,
    promptTokens,
    completionTokens,
  });

  return {
    opportunityId,
    painPoints: summary.painPoints,
    competitorsInTheMix: summary.competitorsInTheMix,
    nextSteps: summary.nextSteps,
    compensationDiscussions: summary.compensationDiscussions,
    advisorConcerns: summary.advisorConcerns,
    generatedAt: new Date().toISOString(),
    callNoteIds: callIds,
    cacheHit: false,
    callDateMap: buildCallDateMap(calls),
  };
}

// ---------------------------------------------------------------------------
// GET handler — read with auto-generate on cache miss
// ---------------------------------------------------------------------------

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ opportunityId: string }> },
) {
  const { opportunityId } = await params;
  const auth = await authenticate(opportunityId);
  if ('error' in auth) return auth.error;

  const { header, isPrivileged, allRepIds } = auth;

  const calls = await getCallSummariesForOpportunity(
    opportunityId,
    header.leadId,
    header.contactId,
    allRepIds,
  );

  if (calls.length === 0 && !isPrivileged) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (calls.length === 0) {
    return NextResponse.json({
      opportunityId,
      painPoints: [],
      competitorsInTheMix: [],
      nextSteps: [],
      compensationDiscussions: [],
      advisorConcerns: [],
      generatedAt: new Date().toISOString(),
      callNoteIds: [],
      cacheHit: false,
      callDateMap: {},
    });
  }

  const callDateMap = buildCallDateMap(calls);
  const currentHash = computeCallNoteIdsHash(calls.map((c) => c.id));
  const cached = await getCachedSummary(opportunityId);

  if (cached) {
    const cacheAge = Date.now() - new Date(cached.generatedAt).getTime();
    if (cached.hash === currentHash && cacheAge < CACHE_TTL_MS) {
      return NextResponse.json({
        opportunityId,
        painPoints: cached.painPoints,
        competitorsInTheMix: cached.competitorsInMix,
        nextSteps: cached.nextSteps,
        compensationDiscussions: cached.compensationDiscussions,
        advisorConcerns: cached.advisorConcerns,
        generatedAt: cached.generatedAt,
        callNoteIds: cached.contributingCallIds,
        cacheHit: true,
        callDateMap,
      });
    }
  }

  try {
    const result = await generateSummary(opportunityId, header, calls);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[ai-summary] Generation failed:', err);
    return NextResponse.json(
      { error: 'Failed to generate AI summary' },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// POST handler — force regeneration
// ---------------------------------------------------------------------------

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ opportunityId: string }> },
) {
  const { opportunityId } = await params;
  const auth = await authenticate(opportunityId);
  if ('error' in auth) return auth.error;

  const { header, isPrivileged, allRepIds } = auth;

  const calls = await getCallSummariesForOpportunity(
    opportunityId,
    header.leadId,
    header.contactId,
    allRepIds,
  );

  if (calls.length === 0 && !isPrivileged) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (calls.length === 0) {
    return NextResponse.json({
      opportunityId,
      painPoints: [],
      competitorsInTheMix: [],
      nextSteps: [],
      compensationDiscussions: [],
      advisorConcerns: [],
      generatedAt: new Date().toISOString(),
      callNoteIds: [],
      cacheHit: false,
      callDateMap: {},
    });
  }

  try {
    const result = await generateSummary(opportunityId, header, calls);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[ai-summary] Regeneration failed:', err);
    return NextResponse.json(
      { error: 'Failed to regenerate AI summary' },
      { status: 500 },
    );
  }
}
