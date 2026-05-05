// GET /api/admin/coaching-usage/call/[id]
// Detail-tab payload for the Coaching Usage drill-down modal.
// Returns the full summary_markdown + (optional) transcript for one call_note.
//
// Auth: revops_admin only — same gate as the parent /api/admin/coaching-usage.
// Cache: per-call_note_id, 5-min TTL on the COACHING_USAGE tag (so the global
// "Refresh" button busts these too).

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { getCoachingPool } from '@/lib/coachingDb';
import { cachedQuery, CACHE_TAGS } from '@/lib/cache';

export const dynamic = 'force-dynamic';
const CALL_DETAIL_TTL = 300; // 5 minutes

// Lowercase hex + dashes only — matches Postgres UUIDs (call_notes.id is uuid).
// Hard-validated before going anywhere near SQL.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface DetailRow {
  source: 'granola' | 'kixie' | string;
  summary_markdown: string | null;
  transcript: unknown; // jsonb — TranscriptUtterance[] when present
  ai_original: unknown; // jsonb — AIOriginalSnapshot (Granola coaching source)
}

interface AiCitedItem { text?: unknown }
interface AiOriginalSnapshot {
  overallScore?: unknown;
  dimensionScores?: Record<string, { score?: unknown }>;
  narrative?: { text?: unknown };
  strengths?: AiCitedItem[];
  weaknesses?: AiCitedItem[];
  knowledgeGaps?: AiCitedItem[];
  complianceFlags?: AiCitedItem[];
  coachingNudge?: { text?: unknown };
  additionalObservations?: AiCitedItem[];
}

/**
 * Render an evaluations.ai_original JSONB blob into a single markdown
 * string for the Coaching tab. Defensive against schema versions:
 *   v2 — no coachingNudge, no additionalObservations
 *   v3 — coachingNudge added
 *   v4 — additionalObservations added (current)
 * Each section is omitted entirely when its source field is missing/empty,
 * so the output is clean across all three schema generations.
 */
function renderAiOriginalToMarkdown(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return '';
  const ai = raw as AiOriginalSnapshot;
  const lines: string[] = [];

  const pushBullets = (heading: string, items: AiCitedItem[] | undefined) => {
    if (!Array.isArray(items)) return;
    const texts = items
      .map((it) => (typeof it?.text === 'string' ? it.text.trim() : ''))
      .filter((t) => t.length > 0);
    if (texts.length === 0) return;
    lines.push(`## ${heading}`, '');
    for (const t of texts) lines.push(`- ${t}`);
    lines.push('');
  };

  if (typeof ai.overallScore === 'number') {
    lines.push('## Overall Score', '', String(ai.overallScore), '');
  }
  if (ai.narrative && typeof ai.narrative.text === 'string' && ai.narrative.text.trim().length > 0) {
    lines.push('## Narrative', '', ai.narrative.text.trim(), '');
  }
  if (ai.dimensionScores && typeof ai.dimensionScores === 'object') {
    const entries = Object.entries(ai.dimensionScores)
      .map(([name, val]) => {
        const score = val && typeof val === 'object' ? (val as { score?: unknown }).score : undefined;
        return typeof score === 'number' ? `- **${name}**: ${score}` : null;
      })
      .filter((s): s is string => s !== null);
    if (entries.length > 0) {
      lines.push('## Dimension Scores', '', ...entries, '');
    }
  }
  pushBullets('Strengths',              ai.strengths);
  pushBullets('Weaknesses',             ai.weaknesses);
  pushBullets('Knowledge Gaps',         ai.knowledgeGaps);
  pushBullets('Compliance Flags',       ai.complianceFlags);
  if (ai.coachingNudge && typeof ai.coachingNudge.text === 'string' && ai.coachingNudge.text.trim().length > 0) {
    lines.push('## Coaching Nudge', '', ai.coachingNudge.text.trim(), '');
  }
  pushBullets('Additional Observations', ai.additionalObservations);

  return lines.join('\n').trim();
}

// Markers the sales-coaching writer wraps the coaching-analysis section with.
// Match must be exact (these are specific Unicode box-drawing characters, U+2550).
const COACHING_START = '═══ COACHING ANALYSIS START ═══';
const COACHING_END   = '═══ COACHING ANALYSIS END ═══';

/**
 * Split a call-note's summary_markdown into the human-facing notes section
 * and the coaching-analysis section, on the literal markers above.
 *
 * Behavior:
 *  - No START marker            → all content goes to notesMarkdown.
 *  - START found, END missing   → everything after START (to end of doc) is
 *                                 treated as coaching; notes = before-START.
 *  - START + END found          → content between markers is coaching; notes
 *                                 is the concatenation of before-START and
 *                                 after-END (the rare trailing-content case).
 */
function splitSummaryMarkdown(md: string): { notesMarkdown: string; coachingMarkdown: string } {
  const startIdx = md.indexOf(COACHING_START);
  if (startIdx === -1) {
    return { notesMarkdown: md.trim(), coachingMarkdown: '' };
  }
  const beforeStart = md.slice(0, startIdx);
  const afterStart  = md.slice(startIdx + COACHING_START.length);
  const endIdx = afterStart.indexOf(COACHING_END);
  if (endIdx === -1) {
    return { notesMarkdown: beforeStart.trim(), coachingMarkdown: afterStart.trim() };
  }
  const coachingMarkdown = afterStart.slice(0, endIdx).trim();
  const afterEnd = afterStart.slice(endIdx + COACHING_END.length);
  const notesMarkdown = (beforeStart + afterEnd).trim();
  return { notesMarkdown, coachingMarkdown };
}

const _getCallDetail = async (callNoteId: string) => {
  const pool = getCoachingPool();
  // DISTINCT ON picks the most-recent evaluation per call_note (calls may have
  // multiple evals — different roles or re-evaluations). For Kixie calls the
  // ai_original is unused (coaching comes from summary_markdown markers); the
  // join is harmless when the row doesn't exist.
  const sql = `
    SELECT cn.source,
           cn.summary_markdown,
           ct.transcript,
           e.ai_original
    FROM call_notes cn
    LEFT JOIN call_transcripts ct ON ct.call_note_id = cn.id
    LEFT JOIN (
      SELECT DISTINCT ON (call_note_id) call_note_id, ai_original
      FROM evaluations
      ORDER BY call_note_id, created_at DESC
    ) e ON e.call_note_id = cn.id
    WHERE cn.id = $1
      AND cn.source_deleted_at IS NULL
    LIMIT 1
  `;
  const { rows } = await pool.query<DetailRow>(sql, [callNoteId]);
  if (rows.length === 0) return null;
  const r = rows[0]!;

  // Source-specific coaching dispatch:
  //   - Kixie (legacy):  coaching is embedded in summary_markdown between
  //     ═══ COACHING ANALYSIS START/END ═══ markers. Notes is the rest.
  //   - Granola:         coaching is the rendered evaluations.ai_original
  //     blob. Notes is the full summary_markdown verbatim (no marker split).
  let notesMarkdown: string;
  let coachingMarkdown: string;
  if (r.source === 'granola') {
    notesMarkdown = (r.summary_markdown ?? '').trim();
    coachingMarkdown = renderAiOriginalToMarkdown(r.ai_original);
  } else {
    const split = splitSummaryMarkdown(r.summary_markdown ?? '');
    notesMarkdown = split.notesMarkdown;
    coachingMarkdown = split.coachingMarkdown;
  }

  return {
    notesMarkdown,
    coachingMarkdown,
    // pg returns jsonb as parsed JSON; pass through as-is. The client validates shape.
    transcript: Array.isArray(r.transcript) ? r.transcript : null,
  };
};

const getCallDetail = cachedQuery(
  _getCallDetail,
  'getCallDetail',
  CACHE_TAGS.COACHING_USAGE,
  CALL_DETAIL_TTL,
);

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }
    if (permissions.role !== 'revops_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Invalid call_note_id' }, { status: 400 });
    }

    const data = await getCallDetail(id);
    if (data === null) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch (error) {
    console.error('[API] Error fetching call detail:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch call detail' },
      { status: 500 },
    );
  }
}
