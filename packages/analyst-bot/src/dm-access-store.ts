// packages/analyst-bot/src/dm-access-store.ts
// ============================================================================
// Neon Postgres CRUD for bot_dm_approved_users table
// ============================================================================
//
// Stores which Slack users are allowed to DM the bot directly.
// Admins (ADMIN_SLACK_USER_IDS) always have DM access — they are NOT stored
// in this table. This table is for non-admin users granted DM access.
//
// Table DDL (run once in Neon SQL console):
//
//   CREATE TABLE bot_dm_approved_users (
//     slack_user_id TEXT PRIMARY KEY,
//     email         TEXT,
//     display_name  TEXT,
//     added_by      TEXT NOT NULL,        -- Slack user ID of admin who approved
//     added_at      TIMESTAMPTZ DEFAULT NOW()
//   );

import { Pool } from 'pg';

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

export interface ApprovedDMUser {
  slackUserId: string;
  email: string | null;
  displayName: string | null;
  addedBy: string;
  addedAt: Date;
}

/**
 * Check if a user is approved for DM access.
 * Fast path — single indexed lookup.
 */
export async function isApprovedForDM(slackUserId: string): Promise<boolean> {
  const result = await getPool().query(
    `SELECT 1 FROM bot_dm_approved_users WHERE slack_user_id = $1`,
    [slackUserId]
  );
  return result.rows.length > 0;
}

/**
 * Get all approved DM users (for admin view).
 */
export async function getAllApprovedUsers(): Promise<ApprovedDMUser[]> {
  const result = await getPool().query(
    `SELECT slack_user_id, email, display_name, added_by, added_at
     FROM bot_dm_approved_users
     ORDER BY added_at DESC`
  );
  return result.rows.map((row) => ({
    slackUserId: row.slack_user_id,
    email: row.email,
    displayName: row.display_name,
    addedBy: row.added_by,
    addedAt: row.added_at,
  }));
}

/**
 * Add a user to the approved DM list. No-op if already approved.
 * Returns true if newly added, false if already existed.
 */
export async function addApprovedUser(
  slackUserId: string,
  addedBy: string,
  email?: string | null,
  displayName?: string | null
): Promise<boolean> {
  const result = await getPool().query(
    `INSERT INTO bot_dm_approved_users (slack_user_id, email, display_name, added_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (slack_user_id) DO NOTHING`,
    [slackUserId, email ?? null, displayName ?? null, addedBy]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Remove a user from the approved DM list.
 * Returns true if removed, false if not found.
 */
export async function removeApprovedUser(slackUserId: string): Promise<boolean> {
  const result = await getPool().query(
    `DELETE FROM bot_dm_approved_users WHERE slack_user_id = $1`,
    [slackUserId]
  );
  return (result.rowCount ?? 0) > 0;
}
