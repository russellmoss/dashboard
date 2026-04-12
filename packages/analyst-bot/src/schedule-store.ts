// packages/analyst-bot/src/schedule-store.ts
// ============================================================================
// Neon Postgres CRUD for bot_schedules table
// ============================================================================

import { Pool } from 'pg';
import { ScheduleRecord, ScheduleFrequency, ScheduleRecipient } from './types';

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
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Compute the next run timestamp based on frequency and optional schedule day.
 *
 * deliverAtHour: minutes since midnight UTC (24+) or legacy hour (0-23).
 * scheduleDay:
 *   - weekly: 'monday'–'sunday' (which day of the week)
 *   - monthly: '1'–'28', 'last', 'first_monday', 'first_wednesday', 'second_monday', etc.
 *   - daily: ignored
 */
export function computeNextRunAt(frequency: ScheduleFrequency, deliverAtHour: number = 540, scheduleDay?: string | null): Date {
  const now = new Date();

  // Interpret deliverAtHour: values 0-23 are legacy hours, 24+ are minutes since midnight
  const utcHour = deliverAtHour >= 24 ? Math.floor(deliverAtHour / 60) : deliverAtHour;
  const utcMinute = deliverAtHour >= 24 ? deliverAtHour % 60 : 0;

  if (frequency === 'daily') {
    const next = new Date(now);
    next.setUTCHours(utcHour, utcMinute, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }

  if (frequency === 'weekly') {
    const targetDow = scheduleDay ? DAY_NAMES.indexOf(scheduleDay.toLowerCase()) : -1;
    const next = new Date(now);
    next.setUTCHours(utcHour, utcMinute, 0, 0);

    if (targetDow >= 0) {
      // Advance to the next occurrence of the target day
      const currentDow = next.getUTCDay();
      let daysAhead = (targetDow - currentDow + 7) % 7;
      if (daysAhead === 0 && next <= now) daysAhead = 7;
      next.setUTCDate(next.getUTCDate() + daysAhead);
    } else {
      // No day specified — next week same day
      if (next <= now) next.setUTCDate(next.getUTCDate() + 7);
    }
    return next;
  }

  if (frequency === 'monthly') {
    const day = scheduleDay?.toLowerCase() ?? '1';

    if (day === 'last') {
      // Last day of the current or next month
      const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, utcHour, utcMinute, 0));
      if (next <= now) {
        // Last day of next month
        return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 0, utcHour, utcMinute, 0));
      }
      return next;
    }

    // Check for ordinal day patterns: "first_monday", "second_wednesday", etc.
    const ordinalMatch = day.match(/^(first|second|third|fourth|last)_(\w+)$/);
    if (ordinalMatch) {
      const ordinal = ordinalMatch[1];
      const dayName = ordinalMatch[2];
      const targetDow = DAY_NAMES.indexOf(dayName);
      if (targetDow >= 0) {
        const result = findOrdinalDay(now.getUTCFullYear(), now.getUTCMonth(), ordinal, targetDow, utcHour, utcMinute);
        if (result > now) return result;
        // Try next month
        const nextMonth = now.getUTCMonth() + 1;
        const nextYear = nextMonth > 11 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
        return findOrdinalDay(nextYear, nextMonth % 12, ordinal, targetDow, utcHour, utcMinute);
      }
    }

    // Specific day of month (1-28)
    const dayNum = parseInt(day, 10);
    if (dayNum >= 1 && dayNum <= 28) {
      const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), dayNum, utcHour, utcMinute, 0));
      if (next <= now) {
        return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, dayNum, utcHour, utcMinute, 0));
      }
      return next;
    }

    // Fallback: 1st of next month
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, utcHour, utcMinute, 0));
    return next;
  }

  // Fallback
  const next = new Date(now);
  next.setUTCHours(utcHour, utcMinute, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

/**
 * Find the Nth occurrence of a day-of-week in a given month.
 * ordinal: 'first', 'second', 'third', 'fourth', 'last'
 * targetDow: 0=Sunday, 6=Saturday
 */
function findOrdinalDay(year: number, month: number, ordinal: string, targetDow: number, hour: number, minute: number): Date {
  if (ordinal === 'last') {
    // Start from last day and go backwards
    const lastDay = new Date(Date.UTC(year, month + 1, 0));
    for (let d = lastDay.getUTCDate(); d >= 1; d--) {
      const test = new Date(Date.UTC(year, month, d));
      if (test.getUTCDay() === targetDow) {
        test.setUTCHours(hour, minute, 0, 0);
        return test;
      }
    }
  }

  const ordinalNum: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4 };
  const target = ordinalNum[ordinal] ?? 1;
  let count = 0;
  for (let d = 1; d <= 31; d++) {
    const test = new Date(Date.UTC(year, month, d));
    if (test.getUTCMonth() !== month) break; // past end of month
    if (test.getUTCDay() === targetDow) {
      count++;
      if (count === target) {
        test.setUTCHours(hour, minute, 0, 0);
        return test;
      }
    }
  }

  // Fallback: 1st of month
  return new Date(Date.UTC(year, month, 1, hour, minute, 0));
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
    recipients: (row.recipients ?? []) as ScheduleRecipient[],
    scheduleDay: row.schedule_day ?? null,
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
  recipients?: ScheduleRecipient[];
  scheduleDay?: string;
}): Promise<ScheduleRecord> {
  const nextRunAt = params.nextRunAt ?? computeNextRunAt(params.frequency, params.deliverAtHour, params.scheduleDay);
  const result = await getPool().query(
    `INSERT INTO bot_schedules
       (user_id, user_email, report_name, question_text, frozen_sql, frequency, deliver_at_hour, delivery_type, next_run_at, recipients, schedule_day)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      params.userId, params.userEmail, params.reportName, params.questionText,
      params.frozenSql, params.frequency, params.deliverAtHour,
      params.deliveryType ?? 'slack_dm', nextRunAt,
      JSON.stringify(params.recipients ?? []),
      params.scheduleDay ?? null,
    ]
  );
  return rowToSchedule(result.rows[0]);
}

/**
 * Update an existing schedule's settings. Used by admin edit.
 */
export async function updateSchedule(scheduleId: string, params: {
  reportName?: string;
  questionText?: string;
  frozenSql?: string;
  frequency?: ScheduleFrequency;
  deliverAtHour?: number;
  deliveryType?: 'slack_dm' | 'google_doc';
  recipients?: ScheduleRecipient[];
  scheduleDay?: string;
}): Promise<void> {
  const setClauses: string[] = [];
  const values: any[] = [scheduleId];
  let idx = 2;

  if (params.reportName !== undefined) { setClauses.push(`report_name = $${idx++}`); values.push(params.reportName); }
  if (params.questionText !== undefined) { setClauses.push(`question_text = $${idx++}`); values.push(params.questionText); }
  if (params.frozenSql !== undefined) { setClauses.push(`frozen_sql = $${idx++}`); values.push(params.frozenSql); }
  if (params.frequency !== undefined) { setClauses.push(`frequency = $${idx++}`); values.push(params.frequency); }
  if (params.deliverAtHour !== undefined) { setClauses.push(`deliver_at_hour = $${idx++}`); values.push(params.deliverAtHour); }
  if (params.deliveryType !== undefined) { setClauses.push(`delivery_type = $${idx++}`); values.push(params.deliveryType); }
  if (params.recipients !== undefined) { setClauses.push(`recipients = $${idx++}`); values.push(JSON.stringify(params.recipients)); }
  if (params.scheduleDay !== undefined) { setClauses.push(`schedule_day = $${idx++}`); values.push(params.scheduleDay); }

  // Recompute next_run_at if frequency or time changed
  if (params.frequency !== undefined || params.deliverAtHour !== undefined || params.scheduleDay !== undefined) {
    const freq = params.frequency ?? 'daily';
    const hour = params.deliverAtHour ?? 540;
    const nextRunAt = computeNextRunAt(freq as ScheduleFrequency, hour, params.scheduleDay);
    setClauses.push(`next_run_at = $${idx++}`);
    values.push(nextRunAt);
  }

  if (setClauses.length === 0) return;

  await getPool().query(
    `UPDATE bot_schedules SET ${setClauses.join(', ')} WHERE id = $1`,
    values
  );
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
    `SELECT frequency, deliver_at_hour, schedule_day FROM bot_schedules WHERE id = $1`,
    [scheduleId]
  );
  if (schedule.rows.length === 0) return;

  const frequency = schedule.rows[0].frequency as ScheduleFrequency;
  const deliverAtHour = schedule.rows[0].deliver_at_hour ?? 9;
  const scheduleDay = schedule.rows[0].schedule_day ?? null;
  const nextRunAt = computeNextRunAt(frequency, deliverAtHour, scheduleDay);

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
