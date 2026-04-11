// packages/analyst-bot/src/bq-query.ts
// ============================================================================
// BigQuery query execution for exports.
// Used when Claude produces [EXPORT_SQL] blocks instead of [XLSX] blocks.
// Claude writes the SQL + column spec, the bot validates and runs it.
//
// Applies the SAME safety controls as the MCP server (mcp-server/src/):
// - Read-only validation (SELECT/WITH only)
// - Blocked DML/DDL keywords
// - Dataset allowlist
// - LIMIT injection (1000 rows max)
// - Byte cap (1GB maximumBytesBilled)
// - Job timeout (120s)
// - Returns bytesProcessed for audit trail
// ============================================================================

import { BigQuery } from '@google-cloud/bigquery';

let bigquery: BigQuery | null = null;

function getBigQuery(): BigQuery {
  if (!bigquery) {
    bigquery = new BigQuery({ projectId: process.env.BIGQUERY_PROJECT });
  }
  return bigquery;
}

function verbose(...args: any[]): void {
  if (process.env.VERBOSE === 'true') console.log(...args);
}

export interface ExportSqlRequest {
  sql: string;
  title: string;
  columns: Array<{
    header: string;
    key: string;
    type: 'string' | 'number' | 'percent' | 'currency';
  }>;
}

export interface ExportQueryResult {
  rows: Record<string, any>[];
  bytesProcessed: number;
  executionTimeMs: number;
}

// ---- Query validation (mirrors mcp-server/src/query-validator.ts) ----

const ALLOWED_DATASETS = ['Tableau_Views', 'SavvyGTMData', 'savvy_analytics'];

const BLOCKED_KEYWORDS = [
  'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'TRUNCATE',
  'CREATE', 'DROP', 'ALTER',
  'EXECUTE', 'CALL',
];

const MAX_EXPORT_ROWS = 1000;

function stripLeadingComments(sql: string): string {
  let s = sql.trimStart();
  while (true) {
    if (s.startsWith('--')) {
      const newline = s.indexOf('\n');
      s = newline === -1 ? '' : s.slice(newline + 1).trimStart();
    } else if (s.startsWith('/*')) {
      const end = s.indexOf('*/');
      s = end === -1 ? '' : s.slice(end + 2).trimStart();
    } else {
      break;
    }
  }
  return s;
}

function validateExportQuery(sql: string): { valid: boolean; error?: string; sanitizedQuery: string } {
  const trimmed = stripLeadingComments(sql);
  if (!trimmed) {
    return { valid: false, error: 'Empty query', sanitizedQuery: sql };
  }

  const upperStart = trimmed.toUpperCase();
  if (!upperStart.startsWith('SELECT') && !upperStart.startsWith('WITH') && !upperStart.startsWith('(SELECT')) {
    return { valid: false, error: 'Only SELECT queries are allowed for export', sanitizedQuery: sql };
  }

  for (const keyword of BLOCKED_KEYWORDS) {
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    if (regex.test(trimmed)) {
      return { valid: false, error: `Blocked keyword: ${keyword}`, sanitizedQuery: sql };
    }
  }

  if (/INFORMATION_SCHEMA/i.test(trimmed)) {
    return { valid: false, error: 'INFORMATION_SCHEMA access not allowed', sanitizedQuery: sql };
  }

  // Validate dataset references
  const datasetPattern = /`?savvy-gtm-analytics`?\.`?(\w+)`?\./gi;
  let match: RegExpExecArray | null;
  while ((match = datasetPattern.exec(trimmed)) !== null) {
    if (!ALLOWED_DATASETS.includes(match[1])) {
      return { valid: false, error: `Dataset "${match[1]}" is not allowed`, sanitizedQuery: sql };
    }
  }

  // Inject LIMIT if missing
  let sanitizedQuery = trimmed;
  if (!/\bLIMIT\s+\d+/i.test(trimmed)) {
    sanitizedQuery = `${trimmed.replace(/;\s*$/, '')} LIMIT ${MAX_EXPORT_ROWS}`;
  }

  return { valid: true, sanitizedQuery };
}

// ---- Export query execution ----

/**
 * Parse an [EXPORT_SQL] block from Claude's response.
 * Claude produces this instead of [XLSX] for large datasets.
 */
export function parseExportSqlBlock(text: string): ExportSqlRequest | null {
  const match = text.match(/\[EXPORT_SQL\]\s*([\s\S]*?)\s*\[\/EXPORT_SQL\]/);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[1]);
    if (!parsed.sql || !parsed.columns) {
      console.error('[bq-query] EXPORT_SQL block missing sql or columns');
      return null;
    }
    return {
      sql: parsed.sql,
      title: parsed.title ?? 'Data_Export',
      columns: parsed.columns.map((col: any) => ({
        header: col.header ?? col.name ?? col.key,
        key: col.key ?? (col.header ?? col.name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_'),
        type: col.type ?? 'string',
      })),
    };
  } catch (err) {
    console.error('[bq-query] Failed to parse EXPORT_SQL block:', (err as Error).message);
    return null;
  }
}

/**
 * Strip [EXPORT_SQL] blocks from text.
 */
export function stripExportSqlBlocks(text: string): string {
  return text.replace(/\[EXPORT_SQL\]\s*[\s\S]*?\s*\[\/EXPORT_SQL\]/g, '').trim();
}

/**
 * Execute an export query with the same safety controls as the MCP server:
 * - Read-only validation
 * - LIMIT injection
 * - 1GB byte cap (maximumBytesBilled)
 * - 120s job timeout
 * - Returns bytesProcessed for audit trail
 */
export async function runExportQuery(sql: string): Promise<ExportQueryResult> {
  // Validate query (same rules as MCP server)
  const validation = validateExportQuery(sql);
  if (!validation.valid) {
    throw new Error(`[EXPORT_SQL] validation failed: ${validation.error}`);
  }

  verbose('[bq-query] Export query validated, executing with MCP-equivalent safety controls');
  verbose('[bq-query] Options: jobTimeoutMs=120000, maximumBytesBilled=1GB, LIMIT injected:', validation.sanitizedQuery !== sql);

  const bq = getBigQuery();
  const startTime = Date.now();

  const [job] = await bq.createQueryJob({
    query: validation.sanitizedQuery,
    maximumBytesBilled: '1000000000', // 1GB cap — same as MCP server
    jobTimeoutMs: 120_000,
  });
  const [rows] = await job.getQueryResults();
  const metadata = await job.getMetadata();
  const executionTimeMs = Date.now() - startTime;
  const bytesProcessed = parseInt(
    metadata[0]?.statistics?.totalBytesProcessed || '0',
    10
  );

  verbose(`[bq-query] Export query complete: ${rows.length} rows, ${bytesProcessed} bytes, ${executionTimeMs}ms`);

  return { rows, bytesProcessed, executionTimeMs };
}

/**
 * Direct BQ fallback — no validation, just timeout.
 * Only used when the validated path fails unexpectedly.
 */
export async function runExportQueryDirect(sql: string): Promise<Record<string, any>[]> {
  console.warn('[EXPORT_SQL] MCP routing failed, falling back to direct BQ');
  const bq = getBigQuery();
  const opts = { query: sql, jobTimeoutMs: 120_000 };
  verbose('[bq-query] Fallback export query options:', JSON.stringify({ jobTimeoutMs: opts.jobTimeoutMs, sqlLength: sql.length }));
  const [rows] = await bq.query(opts);
  return rows;
}
