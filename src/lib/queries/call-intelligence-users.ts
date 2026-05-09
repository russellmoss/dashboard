import { getCoachingPool } from '@/lib/coachingDb';
import type { CoachingRep } from '@/types/call-intelligence';

export async function getCoachingUsers(
  opts: { includeInactive?: boolean } = {},
): Promise<CoachingRep[]> {
  const pool = getCoachingPool();
  const where = opts.includeInactive ? 'r.is_system = false' : 'r.is_system = false AND r.is_active = true';
  const sql = `
    SELECT
      r.id, r.email, r.full_name, r.role,
      r.manager_id,
      mgr.full_name AS manager_full_name,
      r.is_active,
      r.reveal_policy,
      r.reveal_delay_minutes,
      r.reveal_reminder_minutes,
      r.created_at
    FROM reps r
    LEFT JOIN reps mgr ON mgr.id = r.manager_id AND mgr.is_system = false
    WHERE ${where}
    ORDER BY r.is_active DESC, r.full_name ASC
  `;
  const { rows } = await pool.query<CoachingRep>(sql);
  return rows;
}

export async function getRevealSettingsByEmail(email: string): Promise<{
  rep_id: string; policy: string; delay_minutes: number | null; reminder_minutes: number | null;
} | null> {
  if (!email) return null;
  const pool = getCoachingPool();
  const { rows } = await pool.query<{ rep_id: string; policy: string; delay_minutes: number | null; reminder_minutes: number | null; }>(
    `SELECT id AS rep_id, reveal_policy AS policy, reveal_delay_minutes AS delay_minutes, reveal_reminder_minutes AS reminder_minutes
       FROM reps
      WHERE LOWER(email) = LOWER($1)
        AND is_active = true
        AND is_system = false
      LIMIT 1`,
    [email],
  );
  return rows[0] ?? null;
}
