import { BigQuery } from '@google-cloud/bigquery';
import crypto from 'crypto';

const bigquery = new BigQuery();

interface AuditEntry {
  userEmail: string;
  apiKeyId: string;
  queryText: string;
  datasetsReferenced: string[];
  success: boolean;
  errorMessage?: string;
  executionTimeMs?: number;
  bytesProcessed?: number;
  rowsReturned?: number;
  clientIp?: string;
  userAgent?: string;
}

/**
 * Fire-and-forget audit log insert.
 * Does NOT block the query response. Errors are logged but not thrown.
 */
export function logAuditEntry(entry: AuditEntry): void {
  const logId = crypto.randomUUID();
  const row = {
    log_id: logId,
    logged_at: new Date().toISOString(),
    user_email: entry.userEmail,
    api_key_id: entry.apiKeyId,
    query_text: entry.queryText,
    datasets_referenced: entry.datasetsReferenced,
    success: entry.success,
    error_message: entry.errorMessage ?? null,
    execution_time_ms: entry.executionTimeMs ?? null,
    bytes_processed: entry.bytesProcessed ?? null,
    rows_returned: entry.rowsReturned ?? null,
    client_ip: entry.clientIp ?? null,
    user_agent: entry.userAgent ?? null,
  };

  bigquery
    .dataset('savvy_analytics')
    .table('mcp_audit_log')
    .insert([row])
    .catch((err) => {
      console.error('[audit] Failed to log audit entry:', err.message);
    });
}
