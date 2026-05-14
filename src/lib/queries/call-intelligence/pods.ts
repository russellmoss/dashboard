import { getCoachingPool } from '@/lib/coachingDb';
import type { InsightsPod } from '@/types/call-intelligence';

export interface SfdcPodMapping {
  sfdcUserId: string;
  podId: string;
  podName: string;
}

export async function getSfdcUserIdToPodMap(): Promise<Map<string, { podId: string; podName: string }>> {
  const pool = getCoachingPool();
  const { rows } = await pool.query<{ sfdc_user_id: string; pod_id: string; pod_name: string }>(
    `SELECT r.sfdc_user_id, t.id AS pod_id, t.name AS pod_name
       FROM reps r
       JOIN coaching_team_members tm ON tm.rep_id = r.id
       JOIN coaching_teams t ON t.id = tm.team_id AND t.is_active = true
      WHERE r.sfdc_user_id IS NOT NULL`,
  );

  const map = new Map<string, { podId: string; podName: string }>();
  for (const r of rows) {
    map.set(r.sfdc_user_id, { podId: r.pod_id, podName: r.pod_name });
  }
  return map;
}

/**
 * Returns active coaching_teams pods, restricted to those whose members
 * intersect with visibleRepIds.
 */
export async function getActivePodsVisibleToActor(visibleRepIds: string[]): Promise<InsightsPod[]> {
  if (visibleRepIds.length === 0) return [];

  const pool = getCoachingPool();
  const { rows } = await pool.query<{
    id: string;
    name: string;
    lead_rep_id: string;
    lead_full_name: string | null;
  }>(
    `
    SELECT DISTINCT t.id, t.name, t.lead_rep_id,
           lead.full_name AS lead_full_name
      FROM coaching_teams t
      LEFT JOIN reps lead ON lead.id = t.lead_rep_id AND lead.is_system = false
      JOIN coaching_team_members tm ON tm.team_id = t.id
     WHERE t.is_active = true
       AND tm.rep_id = ANY($1::uuid[])
     ORDER BY t.name
    `,
    [visibleRepIds],
  );

  return rows.map(r => ({
    id: r.id,
    name: r.name,
    leadRepId: r.lead_rep_id,
    leadFullName: r.lead_full_name,
  }));
}
