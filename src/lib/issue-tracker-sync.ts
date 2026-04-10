// src/lib/issue-tracker-sync.ts
// ============================================================================
// Sync DashboardRequest changes to BigQuery issue tracking tables.
//
// Two-table design:
//   bot_audit.issues        — one row per issue, updated via DML
//   bot_audit.issue_events  — append-only event log via streaming insert
//
// Only syncs bot-created issues (id starts with 'cbot_').
// All operations are fire-and-forget — errors logged, never thrown.
// ============================================================================

import { getBigQueryClient } from './bigquery';
import crypto from 'crypto';

const DATASET = 'bot_audit';

/**
 * Check if a request was created by the analyst bot.
 */
export function isBotIssue(requestId: string): boolean {
  return requestId.startsWith('cbot_');
}

/**
 * Sync a status change: update issues row + append event.
 */
export function syncStatusToBigQuery(requestId: string, newStatus: string, previousStatus?: string): void {
  if (!isBotIssue(requestId)) return;

  try {
    const bq = getBigQueryClient();
    const now = new Date().toISOString();

    // Update the issues row (DML — works immediately, no streaming buffer)
    bq.query({
      query: `UPDATE \`${DATASET}.issues\`
        SET status = @status, updated_at = @now
        WHERE dashboard_request_id = @id`,
      params: { id: requestId, status: newStatus, now },
      types: { id: 'STRING', status: 'STRING', now: 'TIMESTAMP' },
    }).then(() => {
      console.log(`[issue-tracker-sync] Status updated: ${requestId} → ${newStatus}`);
    }).catch((err) => {
      console.error('[issue-tracker-sync] Status update failed:', err.message);
    });

    // Append event to issue_events (streaming insert)
    bq.dataset(DATASET).table('issue_events').insert([{
      event_id: crypto.randomUUID(),
      dashboard_request_id: requestId,
      event_type: 'status_change',
      actor_email: null,
      actor_name: null,
      old_value: previousStatus ?? null,
      new_value: newStatus,
      metadata: JSON.stringify({ previous: previousStatus, new: newStatus }),
      created_at: now,
    }]).catch((err) => {
      console.error('[issue-tracker-sync] Status event insert failed:', err.message);
    });
  } catch (err) {
    console.error('[issue-tracker-sync] Status sync error:', (err as Error).message);
  }
}

/**
 * Sync a comment: append event to issue_events + touch issues.updated_at.
 */
export function syncCommentToBigQuery(
  requestId: string,
  authorName: string,
  authorEmail: string,
  content: string,
): void {
  if (!isBotIssue(requestId)) return;

  try {
    const bq = getBigQueryClient();
    const now = new Date().toISOString();

    // Touch the issues row updated_at
    bq.query({
      query: `UPDATE \`${DATASET}.issues\`
        SET updated_at = @now
        WHERE dashboard_request_id = @id`,
      params: { id: requestId, now },
      types: { id: 'STRING', now: 'TIMESTAMP' },
    }).catch((err) => {
      console.error('[issue-tracker-sync] Comment touch failed:', err.message);
    });

    // Append event to issue_events
    bq.dataset(DATASET).table('issue_events').insert([{
      event_id: crypto.randomUUID(),
      dashboard_request_id: requestId,
      event_type: 'comment',
      actor_email: authorEmail,
      actor_name: authorName,
      old_value: null,
      new_value: content,
      metadata: null,
      created_at: now,
    }]).then(() => {
      console.log(`[issue-tracker-sync] Comment synced: ${requestId} by ${authorName}`);
    }).catch((err) => {
      console.error('[issue-tracker-sync] Comment event insert failed:', err.message);
    });
  } catch (err) {
    console.error('[issue-tracker-sync] Comment sync error:', (err as Error).message);
  }
}
