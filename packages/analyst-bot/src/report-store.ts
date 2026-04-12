// packages/analyst-bot/src/report-store.ts
// ============================================================================
// Neon Postgres CRUD for bot_reports table
// ============================================================================

import { Pool } from 'pg';
import { ReportRecord, ReportSection, ReportStatus } from './types';

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

function rowToReport(row: any): ReportRecord {
  return {
    id: row.id,
    userId: row.user_id,
    userEmail: row.user_email,
    title: row.title,
    sectionsJson: row.sections_json as ReportSection[],
    status: row.status as ReportStatus,
    googleDocId: row.google_doc_id,
    googleDocUrl: row.google_doc_url,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

/**
 * Create a new report record. Returns the created record.
 */
export async function createReport(params: {
  userId: string;
  userEmail: string;
  title: string;
  sectionsJson: ReportSection[];
}): Promise<ReportRecord> {
  const result = await getPool().query(
    `INSERT INTO bot_reports (user_id, user_email, title, sections_json, status)
     VALUES ($1, $2, $3, $4, 'pending')
     RETURNING *`,
    [params.userId, params.userEmail, params.title, JSON.stringify(params.sectionsJson)]
  );
  return rowToReport(result.rows[0]);
}

/**
 * Update a report's status and optional fields.
 */
export async function updateReportStatus(
  reportId: string,
  status: ReportStatus,
  updates?: {
    sectionsJson?: ReportSection[];
    googleDocId?: string;
    googleDocUrl?: string;
    errorMessage?: string;
  }
): Promise<void> {
  const setClauses = ['status = $2'];
  const params: any[] = [reportId, status];
  let paramIdx = 3;

  if (status === 'done' || status === 'failed') {
    setClauses.push(`completed_at = NOW()`);
  }

  if (updates?.sectionsJson !== undefined) {
    setClauses.push(`sections_json = $${paramIdx}`);
    params.push(JSON.stringify(updates.sectionsJson));
    paramIdx++;
  }
  if (updates?.googleDocId !== undefined) {
    setClauses.push(`google_doc_id = $${paramIdx}`);
    params.push(updates.googleDocId);
    paramIdx++;
  }
  if (updates?.googleDocUrl !== undefined) {
    setClauses.push(`google_doc_url = $${paramIdx}`);
    params.push(updates.googleDocUrl);
    paramIdx++;
  }
  if (updates?.errorMessage !== undefined) {
    setClauses.push(`error_message = $${paramIdx}`);
    params.push(updates.errorMessage);
    paramIdx++;
  }

  await getPool().query(
    `UPDATE bot_reports SET ${setClauses.join(', ')} WHERE id = $1`,
    params
  );
}

/**
 * Get all reports for a user, ordered by creation date descending.
 */
export async function getReportsForUser(userId: string): Promise<ReportRecord[]> {
  const result = await getPool().query(
    `SELECT * FROM bot_reports
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 10`,
    [userId]
  );
  return result.rows.map(rowToReport);
}

/**
 * Get all generated reports across all users — admin only.
 * Returns most recent 50, ordered by created_at DESC.
 */
export async function getAllReports(): Promise<ReportRecord[]> {
  try {
    const result = await getPool().query(
      `SELECT * FROM bot_reports
       ORDER BY created_at DESC
       LIMIT 50`
    );
    return result.rows.map(rowToReport);
  } catch (err) {
    console.error('[report-store] getAllReports failed:', (err as Error).message);
    return [];
  }
}
