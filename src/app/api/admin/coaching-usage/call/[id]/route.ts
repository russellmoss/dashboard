// GET /api/admin/coaching-usage/call/[id]
// Detail-tab payload for the Coaching Usage drill-down modal.
// Returns the full summary_markdown + (optional) transcript for one call_note.
//
// Auth: any call-intelligence role (manager, admin, revops_admin, sgm, sga).
// Cache: per-call_note_id, 5-min TTL on the COACHING_USAGE tag (so the global
// "Refresh" button busts these too).

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { getCoachingPool } from '@/lib/coachingDb';
import { cachedQuery, CACHE_TAGS } from '@/lib/cache';
import { renderCallNoteMarkdown } from '@/lib/coaching-notes-markdown';

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

const _getCallDetail = async (callNoteId: string) => {
  const pool = getCoachingPool();
  // DISTINCT ON picks the most-recent evaluation per call_note (calls may have
  // multiple evals — different roles or re-evaluations). For Kixie calls the
  // ai_original is unused (coaching comes from summary_markdown markers); the
  // join is harmless when the row doesn't exist.
  // 2026-05-10 — prefer summary_markdown_edited when the rep edited the note
  // via the Dashboard rep-note-review sub-route (Step 5b-3-UI). Fallback to
  // summary_markdown for legacy rows and rep-untouched notes. This matches
  // what the SFDC writeback uses (approve flow reads call_note.summary_*_edited
  // ?? summary_markdown via the same precedence).
  const sql = `
    SELECT cn.source,
           COALESCE(cn.summary_markdown_edited, cn.summary_markdown) AS summary_markdown,
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

  // Source-specific coaching dispatch lives in the shared helper —
  // Granola pulls coaching from ai_original, Kixie splits markers.
  const { notesMarkdown, coachingMarkdown } = renderCallNoteMarkdown({
    source: r.source,
    summaryMarkdown: r.summary_markdown,
    aiOriginal: r.ai_original,
  });

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
    const ALLOWED_ROLES = ['manager', 'admin', 'revops_admin', 'sgm', 'sga'] as const;
    if (!(ALLOWED_ROLES as readonly string[]).includes(permissions.role)) {
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
