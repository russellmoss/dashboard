// packages/analyst-bot/src/schedule-store.ts
// ============================================================================
// Neon Postgres CRUD for bot_schedules table
// ============================================================================

import { Pool } from 'pg';
import { ScheduleRecord, ScheduleFrequency } from './types';

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set');
    }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }
  return pool;
}

/**
 * Compute the next run timestamp based on frequency.
 * - daily: +24 hours
 * - weekly: +7 days
 * - monthly: same day next month, clamped to last day if needed (e.g., Jan 31 → Feb 28)
 *
 * deliverAtHour stores minutes since midnight UTC (0-1439) for sub-hour precision.
 * Legacy values 0-23 are treated as hours (backward compatible).
 * All timestamps are UTC. DST drift is expected for daily schedules — documented as known behavior.
 */
export function computeNextRunAt(frequency: ScheduleFrequency, deliverAtHour: number = 540): Date {
  const now = new Date();
  const next = new Date(now);

  // Interpret deliverAtHour: values 0-23 are legacy hours, 24+ are minutes since midnight
  const utcHour = deliverAtHour >= 24 ? Math.floor(deliverAtHour / 60) : deliverAtHour;
  const utcMinute = deliverAtHour >= 24 ? deliverAtHour % 60 : 0;

  // Set to the target time today
  next.setUTCHours(utcHour, utcMinute, 0, 0);

  // If that time has already passed today, advance by one frequency period
  if (next <= now) {
    switch (frequency) {
      case 'daily':
        next.setUTCDate(next.getUTCDate() + 1);
        break;
      case 'weekly':
        next.setUTCDate(next.getUTCDate() + 7);
        break;
      case 'monthly': {
        const targetMonth = next.getUTCMonth() + 1;
        next.setUTCMonth(targetMonth);
        // Clamp to last day of month if the target day doesn't exist
        if (next.getUTCMonth() !== targetMonth % 12) {
          next.setUTCDate(0); // rolls back to last day of intended month
        }
        break;
      }
    }
  }

  return next;
}

function rowToSchedule(row: any): ScheduleRecord {
  return {
    id: row.id,
    userId: row.user_id,
    userEmail: row.user_email,
    reportName: row.report_name,
    questionText: row.question_text,
    frozenSql: row.frozen_sql,
    frequency: row.frequency as ScheduleFrequency,
    deliverAtHour: row.deliver_at_hour ?? 9,
    deliveryType: row.delivery_type ?? 'slack_dm',
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    failureCount: row.failure_count ?? 0,
    createdAt: row.created_at,
    isActive: row.is_active,
  };
}

/**
 * Create a new schedule. Returns the created record.
 */
export async function createSchedule(params: {
  userId: string;
  userEmail: string | null;
  reportName: string;
  questionText: string;
  frozenSql: string;
  frequency: ScheduleFrequency;
  deliverAtHour: number;
  deliveryType?: 'slack_dm' | 'google_doc';
  nextRunAt?: Date;
}): Promise<ScheduleRecord> {
  const nextRunAt = params.nextRunAt ?? computeNextRunAt(params.frequency, params.deliverAtHour);
  const result = await getPool().query(
    `INSERT INTO bot_schedules
       (user_id, user_email, report_name, question_text, frozen_sql, frequency, deliver_at_hour, delivery_type, next_run_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      params.userId, params.userEmail, params.reportName, params.questionText,
      params.frozenSql, params.frequency, params.deliverAtHour,
      params.deliveryType ?? 'slack_dm', nextRunAt,
    ]
  );
  return rowToSchedule(result.rows[0]);
}

/**
 * Get all schedules that are due to run (next_run_at <= NOW() and is_active = true).
 */
export async function getDueSchedules(): Promise<ScheduleRecord[]> {
  const result = await getPool().query(
    `SELECT * FROM bot_schedules
     WHERE is_active = TRUE AND next_run_at <= NOW()
     ORDER BY next_run_at ASC`
  );
  return result.rows.map(rowToSchedule);
}

/**
 * Mark a schedule as having just run. Updates last_run_at and advances next_run_at.
 */
export async function markScheduleRun(scheduleId: string): Promise<void> {
  const now = new Date();
  const schedule = await getPool().query(
    `SELECT frequency, deliver_at_hour FROM bot_schedules WHERE id = $1`,
    [scheduleId]
  );
  if (schedule.rows.length === 0) return;

  const frequency = schedule.rows[0].frequency as ScheduleFrequency;
  const deliverAtHour = schedule.rows[0].deliver_at_hour ?? 9;
  const nextRunAt = computeNextRunAt(frequency, deliverAtHour);

  await getPool().query(
    `UPDATE bot_schedules
     SET last_run_at = $1, next_run_at = $2, failure_count = 0
     WHERE id = $3`,
    [now, nextRunAt, scheduleId]
  );
}

/**
 * Cancel a schedule (soft delete — sets is_active = false).
 */
export async function cancelSchedule(scheduleId: string): Promise<void> {
  await getPool().query(
    `UPDATE bot_schedules SET is_active = FALSE WHERE id = $1`,
    [scheduleId]
  );
}

/**
 * Get all active schedules for a given user (for App Home display).
 */
export async function getActiveSchedulesForUser(userId: string): Promise<ScheduleRecord[]> {
  const result = await getPool().query(
    `SELECT * FROM bot_schedules
     WHERE user_id = $1 AND is_active = TRUE
     ORDER BY created_at DESC`,
    [userId]
  );
  return result.rows.map(rowToSchedule);
}

/**
 * Get ALL active schedules across all users — admin only.
 * Returns schedules ordered by user then next_run_at for grouped display.
 */
export async function getAllSchedules(): Promise<ScheduleRecord[]> {
  try {
    const result = await getPool().query(
      `SELECT * FROM bot_schedules
       WHERE is_active = TRUE
       ORDER BY user_id, next_run_at ASC`
    );
    return result.rows.map(rowToSchedule);
  } catch (err) {
    console.error('[schedule-store] getAllSchedules failed:', (err as Error).message);
    return [];
  }
}

/**
 * Admin cancel — cancel any schedule by ID regardless of owner.
 */
export async function adminCancelSchedule(scheduleId: string): Promise<void> {
  await getPool().query(
    `UPDATE bot_schedules SET is_active = FALSE WHERE id = $1`,
    [scheduleId]
  );
}
