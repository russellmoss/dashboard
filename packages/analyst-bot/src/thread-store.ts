// packages/analyst-bot/src/thread-store.ts
// ============================================================================
// Neon Postgres thread state CRUD
// ============================================================================

import { Pool } from 'pg';
import { ThreadState, ConversationMessage } from './types';

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set');
    }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // rejectUnauthorized: false is REQUIRED for Neon pooled endpoints.
      // Neon uses pgbouncer with SNI routing; the pooler cert doesn't match
      // the connection string hostname. This is expected, not a security oversight.
      ssl: { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }
  return pool;
}

/**
 * Load thread state from Neon. Returns null if not found.
 */
export async function loadThread(threadId: string): Promise<ThreadState | null> {
  const result = await getPool().query(
    `SELECT thread_id, channel_id, messages, created_at, updated_at
     FROM bot_threads
     WHERE thread_id = $1`,
    [threadId]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    threadId: row.thread_id,
    channelId: row.channel_id,
    messages: row.messages as ConversationMessage[], // JSONB auto-parsed by pg
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Save thread state (upsert). Creates new thread or updates existing.
 */
export async function saveThread(state: ThreadState): Promise<void> {
  await getPool().query(
    `INSERT INTO bot_threads (thread_id, channel_id, messages, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (thread_id)
     DO UPDATE SET messages = $3, updated_at = NOW()`,
    [state.threadId, state.channelId, JSON.stringify(state.messages), state.createdAt]
  );
}

/**
 * Delete threads older than 48 hours. Called by cleanup cron.
 */
export async function deleteExpiredThreads(): Promise<number> {
  const result = await getPool().query(
    `DELETE FROM bot_threads
     WHERE updated_at < NOW() - INTERVAL '48 hours'`
  );
  return result.rowCount ?? 0;
}

/**
 * Close the pool. Call during graceful shutdown.
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
