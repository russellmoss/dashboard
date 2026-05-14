import { NextRequest, NextResponse } from 'next/server';
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
  computeCallNoteIdsHash,
} from '@/lib/queries/call-intelligence/opportunity-ai-summary';
import type { CallSummaryMapped, ObjectionMapped } from '@/lib/queries/call-intelligence/opportunity-ai-summary';
import type { CachedSummaryResult } from '@/lib/queries/call-intelligence/opportunity-ai-summary';
import {
  getOrCreateThread,
  getThreadById,
  createThread,
  listThreads,
  getChatMessages,
  getMessageCount,
  saveMessage,
  updateThreadHash,
  updateThreadTitle,
  embedQueryText,
  searchKbChunksForChat,
} from '@/lib/queries/call-intelligence/opportunity-chat';
import type { OpportunityHeader, KbChunkForChat } from '@/types/call-intelligence-opportunities';
import Anthropic from '@anthropic-ai/sdk';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SFDC_ID_RE = /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/;
const ALLOWED_ROLES = ['manager', 'admin', 'revops_admin', 'sgm', 'sga'] as const;
const CLAUDE_MODEL = 'claude-sonnet-4-6';
const MAX_HISTORY_MESSAGES = 20;
const MAX_BODY_TEXT_CHARS = 3000;
const MAX_TOTAL_SUMMARY_CHARS = 60000;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ---------------------------------------------------------------------------
// Auth helper (same 8-step sequence as ai-summary route)
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
// GET — Load thread + message history + threads list
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ opportunityId: string }> },
) {
  const { opportunityId } = await params;
  const auth = await authenticate(opportunityId);
  if ('error' in auth) return auth.error;

  const { session, header, allRepIds } = auth;
  const userEmail = session.user!.email!;

  const url = new URL(request.url);
  const requestedThreadId = url.searchParams.get('threadId');
  const action = url.searchParams.get('action');

  try {
    // action=new creates a fresh thread
    if (action === 'new') {
      const newThread = await createThread(opportunityId, userEmail);
      const threads = await listThreads(opportunityId, userEmail);
      return NextResponse.json({
        thread: {
          id: newThread.id,
          title: newThread.title,
          callNoteIdsHash: newThread.callNoteIdsHash,
          lastMessageAt: newThread.lastMessageAt,
          createdAt: newThread.createdAt,
        },
        messages: [],
        threads,
        newCallsDetected: false,
      });
    }

    // Load specific thread or most recent
    let thread;
    if (requestedThreadId) {
      thread = await getThreadById(requestedThreadId, opportunityId, userEmail);
      if (!thread) {
        return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
      }
    } else {
      thread = await getOrCreateThread(opportunityId, userEmail);
    }

    const [messages, threads] = await Promise.all([
      getChatMessages(thread.id),
      listThreads(opportunityId, userEmail),
    ]);

    // New-call detection
    const calls = await getCallSummariesForOpportunity(
      opportunityId,
      header.leadId,
      header.contactId,
      allRepIds,
    );
    const currentHash = computeCallNoteIdsHash(calls.map((c) => c.id));
    let newCallsDetected = false;

    if (thread.callNoteIdsHash && thread.callNoteIdsHash !== currentHash && messages.length > 0) {
      newCallsDetected = true;
      await saveMessage(
        thread.id,
        'system',
        'New calls have been recorded since your last conversation. I\'ve updated my context to include them.',
      );
      await updateThreadHash(thread.id, currentHash);
    } else if (!thread.callNoteIdsHash || thread.callNoteIdsHash === '') {
      await updateThreadHash(thread.id, currentHash);
    }

    const updatedMessages = newCallsDetected
      ? await getChatMessages(thread.id)
      : messages;

    return NextResponse.json({
      thread: {
        id: thread.id,
        title: thread.title,
        callNoteIdsHash: currentHash,
        lastMessageAt: thread.lastMessageAt,
        createdAt: thread.createdAt,
      },
      messages: updatedMessages,
      threads,
      newCallsDetected,
    });
  } catch (err) {
    console.error('[chat GET] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST — Stream Claude response
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ opportunityId: string }> },
) {
  const { opportunityId } = await params;
  const auth = await authenticate(opportunityId);
  if ('error' in auth) return auth.error;

  const { session, header, allRepIds } = auth;
  const userEmail = session.user!.email!;

  let body: { message: string; threadId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.message || typeof body.message !== 'string' || body.message.trim().length === 0) {
    return NextResponse.json({ error: 'Message is required' }, { status: 400 });
  }

  const userMessage = body.message.trim();

  try {
    // Load specific thread or most recent
    let thread;
    if (body.threadId) {
      thread = await getThreadById(body.threadId, opportunityId, userEmail);
      if (!thread) {
        return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
      }
    } else {
      thread = await getOrCreateThread(opportunityId, userEmail);
    }

    // Check if this is the first user message (for title generation)
    const msgCountBefore = await getMessageCount(thread.id);
    const isFirstMessage = msgCountBefore === 0;

    await saveMessage(thread.id, 'user', userMessage);

    const calls = await getCallSummariesForOpportunity(
      opportunityId, header.leadId, header.contactId, allRepIds,
    );
    const callNoteIds = calls.map((c) => c.id);

    const [objections, cachedSummary, kbChunks, chatHistory] = await Promise.all([
      getObjectionsForCalls(callNoteIds),
      getCachedSummary(opportunityId),
      embedAndSearchKb(userMessage),
      getChatMessages(thread.id),
    ]);

    const systemPrompt = buildSystemPrompt(header, calls, objections, cachedSummary, kbChunks);

    const recentHistory = chatHistory.slice(-MAX_HISTORY_MESSAGES);
    const claudeMessages: Anthropic.MessageParam[] = recentHistory
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    const currentHash = computeCallNoteIdsHash(callNoteIds);
    const encoder = new TextEncoder();
    let fullResponse = '';
    const threadId = thread.id;

    const stream = new ReadableStream({
      async start(controller) {
        try {
          const claudeStream = anthropic.messages.stream({
            model: CLAUDE_MODEL,
            max_tokens: 2048,
            system: systemPrompt,
            messages: claudeMessages,
          });

          for await (const event of claudeStream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              const text = event.delta.text;
              fullResponse += text;
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'text', content: text })}\n\n`),
              );
            }
          }

          const citedChunkIds = extractCitedChunkIds(fullResponse, kbChunks);
          await saveMessage(threadId, 'assistant', fullResponse, citedChunkIds);
          await updateThreadHash(threadId, currentHash);

          // Generate title after first exchange (fire-and-forget)
          if (isFirstMessage && !thread.title) {
            generateTitle(threadId, userMessage, fullResponse).catch((err) =>
              console.error('[chat] Title generation failed:', err)
            );
          }

          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'done', citedChunkIds })}\n\n`),
          );
          controller.close();
        } catch (err) {
          console.error('[chat POST] Stream error:', err);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: 'error', message: 'Failed to generate response' })}\n\n`,
            ),
          );
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (err) {
    console.error('[chat POST] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function generateTitle(threadId: string, userMessage: string, assistantResponse: string) {
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 30,
    system: 'Generate a short 4-6 word title summarizing this conversation topic. Return ONLY the title, no quotes or punctuation at the start/end.',
    messages: [
      { role: 'user', content: userMessage },
      { role: 'assistant', content: assistantResponse.slice(0, 500) },
      { role: 'user', content: 'Generate a short title for this conversation.' },
    ],
  });
  const title = response.content[0]?.type === 'text'
    ? response.content[0].text.trim().slice(0, 100)
    : null;
  if (title) {
    await updateThreadTitle(threadId, title);
  }
}

async function embedAndSearchKb(query: string): Promise<KbChunkForChat[]> {
  try {
    const embedding = await embedQueryText(query);
    return searchKbChunksForChat(embedding, 5);
  } catch (err) {
    console.error('[chat] KB embedding/search failed, proceeding without KB context:', err);
    return [];
  }
}

function buildSystemPrompt(
  header: OpportunityHeader,
  calls: CallSummaryMapped[],
  objections: ObjectionMapped[],
  cachedSummary: CachedSummaryResult | null,
  kbChunks: KbChunkForChat[],
): string {
  const parts: string[] = [];

  parts.push(`You are a deal strategy advisor helping analyze this opportunity based on recorded call summaries and the company's knowledge base. Be specific and reference call dates when discussing call content. When your answer draws on knowledge base content, cite the source inline as a markdown link [Doc Title](drive_url). Only cite when the KB materially informed your answer. Give actionable, concise advice.`);

  parts.push(`\n## Opportunity\n- Name: ${header.name}\n- Stage: ${header.stageName}\n- Owner: ${header.ownerName}\n- Amount: ${header.amount ? `$${header.amount.toLocaleString()}` : 'N/A'}\n- Close Date: ${header.closeDate}\n- Next Step: ${header.nextStep || 'None specified'}`);

  if (cachedSummary) {
    parts.push(`\n## AI Deal Summary (Pre-Digested)\n- Pain Points: ${cachedSummary.painPoints.join('; ') || 'None identified'}\n- Competitors: ${cachedSummary.competitorsInMix.join('; ') || 'None identified'}\n- Next Steps: ${cachedSummary.nextSteps.join('; ') || 'None identified'}\n- Compensation: ${cachedSummary.compensationDiscussions.join('; ') || 'None identified'}\n- Concerns: ${cachedSummary.advisorConcerns.join('; ') || 'None identified'}`);
  } else {
    parts.push(`\n## AI Deal Summary\nNo pre-digested deal summary is available for this opportunity. Rely entirely on the call summaries below to infer deal state, pain points, and concerns.`);
  }

  if (calls.length > 0) {
    parts.push(`\n## Call Summaries (${calls.length} calls)`);
    let totalChars = 0;
    calls.forEach((call, i) => {
      if (totalChars >= MAX_TOTAL_SUMMARY_CHARS) return;
      let summary = call.summary;
      if (totalChars + summary.length > MAX_TOTAL_SUMMARY_CHARS) {
        summary = summary.slice(0, MAX_TOTAL_SUMMARY_CHARS - totalChars) + '... [truncated]';
      }
      totalChars += summary.length;
      parts.push(`\n### Call ${i + 1} — ${call.callDate}\n${summary}`);
    });
  }

  if (objections.length > 0) {
    parts.push(`\n## Objections Raised`);
    objections.forEach((obj) => {
      parts.push(`- [${obj.objectionType}] ${obj.objectionText}`);
    });
  }

  const citableChunks = kbChunks.filter((c) => c.driveUrl);
  if (citableChunks.length > 0) {
    parts.push(`\n## Knowledge Base Context`);
    citableChunks.forEach((chunk) => {
      const text = chunk.bodyText.length > MAX_BODY_TEXT_CHARS
        ? chunk.bodyText.slice(0, MAX_BODY_TEXT_CHARS) + '...'
        : chunk.bodyText;
      parts.push(`\n### ${chunk.docTitle}\n- Source: [${chunk.docTitle}](${chunk.driveUrl})\n- Chunk ID: ${chunk.id}\n${text}`);
    });
  }

  return parts.join('\n');
}

function extractCitedChunkIds(
  response: string,
  kbChunks: KbChunkForChat[],
): string[] {
  const citedFileIds = new Set<string>();
  for (const chunk of kbChunks) {
    if (chunk.driveUrl && response.includes(chunk.driveUrl)) {
      citedFileIds.add(chunk.driveFileId);
    }
  }
  return kbChunks
    .filter((c) => citedFileIds.has(c.driveFileId))
    .map((c) => c.id);
}
