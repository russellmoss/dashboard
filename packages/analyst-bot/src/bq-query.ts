// packages/analyst-bot/src/bq-query.ts
// ============================================================================
// Direct BigQuery query execution for large exports.
// Used when Claude produces [EXPORT_SQL] blocks instead of [XLSX] blocks.
// Claude writes the SQL + column spec, the bot runs it and builds the XLSX.
// ============================================================================

import { BigQuery } from '@google-cloud/bigquery';

let bigquery: BigQuery | null = null;

function getBigQuery(): BigQuery {
  if (!bigquery) {
    bigquery = new BigQuery({ projectId: process.env.BIGQUERY_PROJECT });
  }
  return bigquery;
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
 * Execute a SQL query directly against BigQuery and return rows.
 * 120s timeout prevents runaway export queries from blocking the bot.
 */
export async function runExportQuery(sql: string): Promise<Record<string, any>[]> {
  const bq = getBigQuery();
  const opts = { query: sql, jobTimeoutMs: 120_000 };
  if (process.env.VERBOSE === 'true') {
    console.log('[bq-query] Export query options:', JSON.stringify({ jobTimeoutMs: opts.jobTimeoutMs, sqlLength: sql.length }));
  }
  const [rows] = await bq.query(opts);
  return rows;
}
