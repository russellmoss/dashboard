// src/lib/issue-tracker-sync.ts
// ============================================================================
// Sync DashboardRequest status changes and comments to BigQuery issue_tracker.
// Called from the dashboard API routes (status PATCH, comment POST).
// Only syncs bot-created issues (id starts with 'cbot_').
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
 * Sync a status change to the BigQuery issue_tracker row.
 * Fire-and-forget — errors logged, never thrown.
 */
export function syncStatusToBigQuery(requestId: string, newStatus: string): void {
  if (!isBotIssue(requestId)) return;

  try {
    const bq = getBigQueryClient();
    const now = new Date().toISOString();

    // BigQuery streaming inserts can't update rows, so we use a MERGE query
    bq.query({
      query: `
        UPDATE \`${DATASET}.${TABLE}\`
        SET status = @status,
            status_changed_at = @now,
            updated_at = @now
        WHERE dashboard_request_id = @id
      `,
      params: { id: requestId, status: newStatus, now },
      types: { id: 'STRING', status: 'STRING', now: 'TIMESTAMP' },
    }).catch((err) => {
      console.error('[issue-tracker-sync] Status sync failed:', err.message);
    });
  } catch (err) {
    console.error('[issue-tracker-sync] Status sync error:', (err as Error).message);
  }
}

/**
 * Sync a new comment to the BigQuery issue_tracker row.
 * Appends to the comments JSON array.
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
    const commentJson = JSON.stringify({ author: authorName, email: authorEmail, content, timestamp: now });

    // Append comment to the JSON array
    bq.query({
      query: `
        UPDATE \`${DATASET}.${TABLE}\`
        SET comments = JSON_ARRAY_APPEND(IFNULL(comments, JSON '[]'), '$', PARSE_JSON(@comment)),
            updated_at = @now
        WHERE dashboard_request_id = @id
      `,
      params: { id: requestId, comment: commentJson, now },
      types: { id: 'STRING', comment: 'STRING', now: 'TIMESTAMP' },
    }).catch((err) => {
      console.error('[issue-tracker-sync] Comment sync failed:', err.message);
    });
  } catch (err) {
    console.error('[issue-tracker-sync] Comment sync error:', (err as Error).message);
  }
}
