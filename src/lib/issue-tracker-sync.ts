// src/lib/issue-tracker-sync.ts
// ============================================================================
// Sync DashboardRequest status changes and comments to BigQuery issue_tracker.
// Called from the dashboard API routes (status PATCH, comment POST).
// Only syncs bot-created issues (id starts with 'cbot_').
//
// DESIGN: Uses streaming inserts (append-only) not UPDATE — BigQuery's
// streaming buffer blocks DML for ~30 min after insert. Each status change
// and comment is a new row with an event_type field. Query the latest
// status with: WHERE event_type = 'status_change' ORDER BY updated_at DESC LIMIT 1
// ============================================================================

import { getBigQueryClient } from './bigquery';

const DATASET = 'bot_audit';
const TABLE = 'issue_tracker';

/**
 * Check if a request was created by the analyst bot.
 */
export function isBotIssue(requestId: string): boolean {
  return requestId.startsWith('cbot_');
}

/**
 * Sync a status change to BigQuery by inserting a new event row.
 * Fire-and-forget — errors logged, never thrown.
 */
export function syncStatusToBigQuery(requestId: string, newStatus: string): void {
  if (!isBotIssue(requestId)) return;

  try {
    const bq = getBigQueryClient();
    const now = new Date().toISOString();

    const row = {
      dashboard_request_id: requestId,
      title: `Status changed to ${newStatus}`,
      description: `Status updated to ${newStatus}`,
      priority: null,
      status: newStatus,
      reporter_email: null,
      reporter_name: null,
      comments: JSON.stringify([]),
      source: 'dashboard-status-change',
      thread_id: null,
      created_at: now,
      updated_at: now,
      status_changed_at: now,
    };

    bq.dataset(DATASET)
      .table(TABLE)
      .insert([row])
      .then(() => {
        console.log(`[issue-tracker-sync] Status synced to BQ: ${requestId} → ${newStatus}`);
      })
      .catch((err) => {
        console.error('[issue-tracker-sync] Status sync failed:', err.message);
      });
  } catch (err) {
    console.error('[issue-tracker-sync] Status sync error:', (err as Error).message);
  }
}

/**
 * Sync a new comment to BigQuery by inserting a new event row.
 * Fire-and-forget — errors logged, never thrown.
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
    const commentJson = JSON.stringify([
      { author: authorName, email: authorEmail, content, timestamp: now },
    ]);

    const row = {
      dashboard_request_id: requestId,
      title: `Comment by ${authorName}`,
      description: content,
      priority: null,
      status: null,
      reporter_email: authorEmail,
      reporter_name: authorName,
      comments: commentJson,
      source: 'dashboard-comment',
      thread_id: null,
      created_at: now,
      updated_at: now,
      status_changed_at: null,
    };

    bq.dataset(DATASET)
      .table(TABLE)
      .insert([row])
      .then(() => {
        console.log(`[issue-tracker-sync] Comment synced to BQ: ${requestId} by ${authorName}`);
      })
      .catch((err) => {
        console.error('[issue-tracker-sync] Comment sync failed:', err.message);
      });
  } catch (err) {
    console.error('[issue-tracker-sync] Comment sync error:', (err as Error).message);
  }
}
