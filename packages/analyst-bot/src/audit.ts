// packages/analyst-bot/src/audit.ts
// ============================================================================
// BigQuery audit log writer — fire-and-forget pattern
// ============================================================================

import { BigQuery } from '@google-cloud/bigquery';
import { AuditRecord } from './types';

let bigquery: BigQuery | null = null;

function getBigQuery(): BigQuery {
  if (!bigquery) {
    bigquery = new BigQuery({
      projectId: process.env.BIGQUERY_PROJECT,
    });
  }
  return bigquery;
}

/**
 * Write an audit record to BigQuery. Fire-and-forget.
 * Errors are logged but never thrown — audit must not block responses.
 */
export function writeAuditRecord(record: AuditRecord): void {
  const bq = getBigQuery();
  const dataset = process.env.AUDIT_DATASET;
  const table = process.env.AUDIT_TABLE;

  if (!dataset || !table) {
    console.error('[audit] AUDIT_DATASET or AUDIT_TABLE not set, skipping audit');
    return;
  }

  const row = {
    id: record.id,
    thread_id: record.threadId,
    channel_id: record.channelId,
    user_email: record.userEmail,
    timestamp: record.timestamp,
    user_message: record.userMessage,
    assistant_response: record.assistantResponse,
    tool_calls: JSON.stringify(record.toolCalls),
    sql_executed: JSON.stringify(record.sqlExecuted),
    bytes_scanned: record.bytesScanned,
    chart_generated: record.chartGenerated,
    chart_type: record.chartType,
    export_generated: record.exportGenerated,
    export_type: record.exportType,
    export_trigger: record.exportTrigger,
    is_issue_report: record.isIssueReport,
    issue_details: record.issueDetails ? JSON.stringify(record.issueDetails) : null,
    error: record.error,
  };

  bq.dataset(dataset)
    .table(table)
    .insert([row])
    .catch((err) => {
      console.error('[audit] Failed to write audit record:', err.message);
    });
}
