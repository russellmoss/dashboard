import { getCoachingPool } from '@/lib/coachingDb';
import type { InsightsRep } from '@/types/call-intelligence';

/**
 * Returns full names + active-pod context for a given set of visible rep IDs,
 * restricted to coaching roles ('SGA' | 'SGM') — managers/admins/etc. are
 * filtered out because the Insights tab is rep-scoped. Sorted alphabetically.
 * One row per rep — if a rep belongs to multiple active pods (rare/edge case)
 * the lowest pod name alphabetically wins via DISTINCT ON.
 *
 * Used by /api/call-intelligence/insights/reps for the rep type-ahead filter.
 */
export async function getVisibleRepsDetail(visibleRepIds: string[]): Promise<InsightsRep[]> {
  if (visibleRepIds.length === 0) return [];

  const pool = getCoachingPool();
  const { rows } = await pool.query<{
    id: string;
    full_name: string;
    role: string;
    pod_id: string | null;
    pod_name: string | null;
  }>(
    `
    SELECT DISTINCT ON (r.id)
           r.id,
           r.full_name,
           r.role,
           t.id   AS pod_id,
           t.name AS pod_name
      FROM reps r
      LEFT JOIN coaching_team_members tm ON tm.rep_id = r.id
      LEFT JOIN coaching_teams t         ON t.id = tm.team_id AND t.is_active = true
     WHERE r.id = ANY($1::uuid[])
       AND r.is_active = true
       AND r.is_system = false
       AND r.role IN ('SGA', 'SGM')
     ORDER BY r.id, t.name NULLS LAST
    `,
    [visibleRepIds],
  );

  return rows
    .map(r => ({
      id: r.id,
      fullName: r.full_name,
      role: r.role,
      podId: r.pod_id,
      podName: r.pod_name,
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, undefined, { sensitivity: 'base' }));
}
