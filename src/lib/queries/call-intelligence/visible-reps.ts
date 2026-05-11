import { getCoachingPool } from '@/lib/coachingDb';
import type { VisibleRepsActor } from '@/types/call-intelligence';

/**
 * Returns the set of rep IDs visible to the actor. UNION of:
 *   1. Reps where reps.manager_id = actor.repId (canonical hierarchy)
 *   2. Reps in active coaching_teams where lead_rep_id = actor.repId (pod overlay)
 *   3. If actor has coaching_observers row with scope='all_sgm' → all SGMs;
 *      scope='all_sga' → all SGAs.
 *   4. If actor.role is 'admin' or 'revops_admin' → all active non-system reps.
 *
 * Always filters reps.is_active = true AND reps.is_system = false.
 *
 * IMPORTANT — Role enum boundary:
 *   - actor.role uses the Dashboard enum ('manager'|'admin'|'revops_admin'|'sgm'|'sga'|...)
 *   - reps.role in the coaching DB uses the coaching enum ('manager'|'admin'|'SGA'|'SGM')
 *   - DO NOT cross the streams. Branch 3 below uses 'SGM' / 'SGA' (coaching values)
 *     because it compares against r.role in SQL.
 *
 * V1 LIMITATION — coaching_observers.scope='team' is NOT resolved here. Actors with
 * team-scope rows will not see their team via this branch. Defer to v2.
 *
 * V1 LIMITATION — Manager-leads are NOT included in their own visible set.
 */
export async function getRepIdsVisibleToActor(actor: VisibleRepsActor): Promise<string[]> {
  const pool = getCoachingPool();

  // Admin / revops_admin → all reps
  if (actor.role === 'admin' || actor.role === 'revops_admin') {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM reps WHERE is_active = true AND is_system = false`,
    );
    return rows.map(r => r.id);
  }

  // For other roles: UNION of three branches
  const { rows } = await pool.query<{ id: string }>(
    `
    SELECT DISTINCT r.id
      FROM reps r
     WHERE r.is_active = true
       AND r.is_system = false
       AND (
            -- Branch 1: manager_id hierarchy
            r.manager_id = $1
            -- Branch 2: pod-lead overlay
            OR r.id IN (
              SELECT tm.rep_id
                FROM coaching_team_members tm
                JOIN coaching_teams t ON t.id = tm.team_id AND t.is_active = true
               WHERE t.lead_rep_id = $1
            )
            -- Branch 3: coaching_observers scope
            OR (
              EXISTS (SELECT 1 FROM coaching_observers o
                       WHERE o.rep_id = $1 AND o.scope = 'all_sgm' AND o.is_active = true)
              AND r.role = 'SGM'
            )
            OR (
              EXISTS (SELECT 1 FROM coaching_observers o
                       WHERE o.rep_id = $1 AND o.scope = 'all_sga' AND o.is_active = true)
              AND r.role = 'SGA'
            )
           )
    `,
    [actor.repId],
  );

  return rows.map(r => r.id);
}
