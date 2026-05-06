// Shared markdown helpers for sales-coaching call_notes rendering.
//
// Two source-specific behaviors are unified here:
//   - Granola: human notes live in `summary_markdown` verbatim; coaching
//     analysis is rendered from the structured `evaluations.ai_original`
//     JSONB blob (handles v2/v3/v4 schema versions).
//   - Kixie: both notes and coaching live inside `summary_markdown`,
//     separated by literal box-drawing markers; we split on those.
//
// Used by:
//   - GET /api/admin/coaching-usage/call/[id]   (single-call modal)
//   - GET /api/dashboard/record-detail/[id]/notes (per-record Notes tab)

interface AiCitedItem { text?: unknown }
export interface AiOriginalSnapshot {
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
 * string. Defensive across schema versions:
 *   v2 — no coachingNudge, no additionalObservations
 *   v3 — coachingNudge added
 *   v4 — additionalObservations added (current)
 * Each section is omitted entirely when its source field is missing/empty.
 */
export function renderAiOriginalToMarkdown(raw: unknown): string {
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
 * Split a Kixie call-note's summary_markdown into the human-facing notes
 * section and the coaching-analysis section, on the literal markers above.
 *
 * Behavior:
 *  - No START marker            → all content goes to notesMarkdown.
 *  - START found, END missing   → everything after START (to end of doc) is
 *                                 treated as coaching; notes = before-START.
 *  - START + END found          → content between markers is coaching; notes
 *                                 is the concatenation of before-START and
 *                                 after-END (the rare trailing-content case).
 */
export function splitSummaryMarkdown(md: string): { notesMarkdown: string; coachingMarkdown: string } {
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

/**
 * Source-aware dispatcher: returns `{ notesMarkdown, coachingMarkdown }`
 * for a call_notes row, given its raw fields. Granola pulls coaching from
 * `aiOriginal`; Kixie splits markers in `summaryMarkdown`.
 */
export function renderCallNoteMarkdown(args: {
  source: string;
  summaryMarkdown: string | null;
  aiOriginal?: unknown;
}): { notesMarkdown: string; coachingMarkdown: string } {
  if (args.source === 'granola') {
    return {
      notesMarkdown: (args.summaryMarkdown ?? '').trim(),
      coachingMarkdown: renderAiOriginalToMarkdown(args.aiOriginal),
    };
  }
  // Kixie (and any other future source that uses inline markers)
  return splitSummaryMarkdown(args.summaryMarkdown ?? '');
}
