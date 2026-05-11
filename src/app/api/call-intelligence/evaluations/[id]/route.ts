import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import {
  getEvaluationDetail,
  getKbChunksByIds,
  getRepIdByEmail,
  getTranscriptComments,
} from '@/lib/queries/call-intelligence-evaluations';
import { getCoachingPool } from '@/lib/coachingDb';
import { readAiOriginalCoachingNudge } from '@/components/call-intelligence/citation-helpers';

export const dynamic = 'force-dynamic';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Walk the ai_original JSONB tree and collect every valid `kb_source.chunk_id`.
 * Validates the full kb_source shape — chunk_id, doc_id, drive_url, doc_title all
 * non-empty strings — before adding to the set. Dedupes implicitly via Set.
 * (Council fix B1.11 — replaces a looser walker that would false-positive on any
 * `chunk_id` string anywhere in the tree.)
 */
function walkForKbSources(node: unknown, acc: Set<string>): void {
  if (!node) return;
  if (Array.isArray(node)) {
    node.forEach((item) => walkForKbSources(item, acc));
    return;
  }
  if (typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;

  const kb = obj.kb_source;
  if (kb && typeof kb === 'object') {
    const k = kb as Record<string, unknown>;
    if (
      typeof k.chunk_id === 'string' && k.chunk_id !== '' &&
      typeof k.doc_id === 'string' &&
      typeof k.drive_url === 'string' &&
      typeof k.doc_title === 'string'
    ) {
      acc.add(k.chunk_id);
    }
  }

  Object.values(obj).forEach((v) => walkForKbSources(v, acc));
}

async function buildChunkLookup(
  aiOriginal: unknown,
): Promise<Record<string, { owner: string; chunk_text: string }>> {
  if (!aiOriginal || typeof aiOriginal !== 'object') return {};
  const chunkIds = new Set<string>();
  walkForKbSources(aiOriginal, chunkIds);
  return getKbChunksByIds([...chunkIds]);
}

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const permissions = getSessionPermissions(session);
    if (!permissions) return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    if (!permissions.allowedPages.includes(20)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const detail = await getEvaluationDetail(id);
    if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // 2026-05-10 — managers now see all (matches admin/revops_admin queue
    // scope). SGA/SGM see own + cross-rep shared (call_note links to a
    // SFDC record that ALSO appears on one of this rep's own call_notes).
    if (
      permissions.role !== 'admin' &&
      permissions.role !== 'revops_admin' &&
      permissions.role !== 'manager'
    ) {
      const rep = await getRepIdByEmail(session.user.email);
      if (!rep) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      const isOwner = detail.rep_id === rep.id;
      const isAssignedManager = detail.assigned_manager_id_snapshot === rep.id;
      let isSharedRecord = false;
      if (!isOwner && !isAssignedManager && detail.call_sfdc_record_id) {
        // Single bounded lookup — at most one row needed to grant access.
        const sharedRows = await getCoachingPool().query<{ exists: boolean }>(
          `SELECT TRUE AS exists FROM call_notes
            WHERE rep_id = $1
              AND sfdc_record_id = $2
              AND source_deleted_at IS NULL
            LIMIT 1`,
          [rep.id, detail.call_sfdc_record_id],
        );
        isSharedRecord = (sharedRows.rowCount ?? 0) > 0;
      }
      if (!isOwner && !isAssignedManager && !isSharedRecord) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    // Step 5b-1 (Bucket 2 Q2): comments are gated to managers + admins. Reps see
    // an empty list rather than a 403 so the UI renders cleanly.
    const role = permissions.role;
    const canSeeComments = role === 'manager' || role === 'admin' || role === 'revops_admin';

    const [comments, chunkLookup] = await Promise.all([
      canSeeComments ? getTranscriptComments(id) : Promise.resolve([]),
      buildChunkLookup(detail.ai_original),
    ]);

    // Pre-024 fallback: canonical coaching_nudge is null for older rows; read from ai_original.
    const coachingNudgeEffective =
      detail.coaching_nudge ?? readAiOriginalCoachingNudge(detail.ai_original);

    return NextResponse.json({
      ...detail,
      transcript_comments: comments,
      chunk_lookup: chunkLookup,
      coaching_nudge_effective: coachingNudgeEffective,
    });
  } catch (err) {
    console.error('[/api/call-intelligence/evaluations/[id]] error', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
  }
}
