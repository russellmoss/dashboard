import { getCoachingPool } from '@/lib/coachingDb';
import type { ContentRefinementRow } from '@/types/call-intelligence';

export async function getContentRefinements(
  opts: { status?: 'open' | 'all' } = {},
): Promise<ContentRefinementRow[]> {
  const status = opts.status ?? 'open';
  const pool = getCoachingPool();
  const where = status === 'open' ? `cr.status = 'open'` : `1 = 1`;
  const sql = `
    SELECT
      cr.id,
      cr.requested_by,
      requester.full_name AS requested_by_full_name,
      cr.evaluation_id,
      cr.doc_id,
      cr.drive_url,
      cr.current_chunk_excerpt,
      cr.suggested_change,
      cr.status,
      cr.resolved_by,
      cr.resolved_at,
      cr.resolution_notes,
      cr.created_at
    FROM content_refinement_requests cr
    LEFT JOIN reps requester ON requester.id = cr.requested_by AND requester.is_system = false
    WHERE ${where}
    ORDER BY cr.created_at DESC
  `;
  const { rows } = await pool.query<ContentRefinementRow>(sql);
  return rows;
}
