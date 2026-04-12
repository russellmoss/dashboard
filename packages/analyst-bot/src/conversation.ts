// packages/analyst-bot/src/conversation.ts
// ============================================================================
// Core conversation engine — shared by CLI and Slack
// ============================================================================

import crypto from 'crypto';
import { callClaude } from './claude';
import { parseChartBlock, stripChartBlocks, renderChart } from './charts';
import { generateWorkbook } from './xlsx';
import { loadThread, saveThread } from './thread-store';
import { writeAuditRecord } from './audit';
import { createDashboardRequest } from './dashboard-request';
import { parseExportSqlBlock, stripExportSqlBlocks, runExportQuery, runExportQueryDirect } from './bq-query';
import type { ExportQueryResult } from './bq-query';
import {
  ConversationMessage,
  ConversationResult,
  ThreadState,
  ChartType,
  AuditRecord,
  IssueReport,
  IssuePriority,
  WorkbookRequest,
} from './types';

const MAX_THREAD_MESSAGES = 40; // 20 exchanges — cap to prevent unbounded JSONB growth

function verbose(...args: any[]): void {
  if (process.env.VERBOSE === 'true') console.log(...args);
}

// Export trigger — single regex that catches natural language export requests.
// Matches: "xlsx", "excel", "spreadsheet", "csv", "data export", "export as/to",
// "in an xlsx", "as a spreadsheet", "give me the raw data", "download this", etc.
const EXPORT_RE = /\b(xlsx|excel|spreadsheet|csv)\b|data\s+export|export\s+(as|to)|send\s+me\s+the\s+(data|raw)|download\s+this|give\s+me\s+(a\s+file|the\s+raw|an?\s+(xlsx|excel|spreadsheet))|in\s+an?\s+(xlsx|excel|spreadsheet)|as\s+an?\s+(xlsx|excel|spreadsheet)|raw\s+data/i;

// Issue triggers — phrases that start issue flow
const ISSUE_TRIGGERS = [
  'report issue', "this doesn't look right", 'flag this',
  'this looks wrong', 'something is off',
];

/**
 * Process a user message through the conversation engine.
 * This is the single entry point called by both cli.ts and slack.ts.
 */
export async function processMessage(
  input: string,
  threadId: string,
  channelId: string,
  userId: string,
  options?: { threadLink?: string }
): Promise<ConversationResult> {
  let chartBuffer: Buffer | null = null;
  let chartType: ChartType | null = null;
  let xlsxBuffer: Buffer | null = null;
  let xlsxFilename: string | null = null;
  let isIssueReport = false;
  let issueDetails: IssueReport | null = null;
  let exportTrigger: 'explicit_request' | 'large_result_set' | null = null;

  try {
    // Load or create thread state
    verbose('🔍 Loading thread history...');
    let thread = await loadThread(threadId);
    if (!thread) {
      thread = {
        threadId,
        channelId,
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }

    // Append user message
    thread.messages.push({ role: 'user', content: input });

    // Call Claude — increase max_tokens for export requests so the [XLSX] block
    // doesn't get truncated (large datasets can produce huge JSON blocks)
    const isExportRequest = EXPORT_RE.test(input);
    const maxTokens = isExportRequest ? 16384 : 8192;
    verbose('🤖 Calling Claude with MCP server...', isExportRequest ? '(export mode, 32k tokens)' : '');
    const claudeResponse = await callClaude(thread.messages, { maxTokens });

    // Store full content blocks as assistant turn for conversation continuity
    thread.messages.push({
      role: 'assistant',
      content: claudeResponse.contentBlocks,
    });

    // Extract text and process chart blocks
    let responseText = claudeResponse.text;

    // Parse chart
    const chartReq = parseChartBlock(responseText);
    if (chartReq) {
      verbose('📈 Parsing chart block...');
      try {
        verbose('🖼️ Rendering chart PNG...');
        chartBuffer = await renderChart(chartReq);
        chartType = chartReq.type;
      } catch (err) {
        console.error('[conversation] Chart render failed:', (err as Error).message);
        // Chart failure does not block text response
      }
      responseText = stripChartBlocks(responseText);
    }

    // Check for XLSX export — three paths:
    // 1. [EXPORT_SQL] block: Claude wrote the SQL, bot runs it directly (fast, no token limit)
    // 2. [XLSX] block: Claude serialized the data as JSON (works for small datasets)
    // 3. Heuristic: parse markdown tables from response text
    const userRequestedExport = EXPORT_RE.test(input);
    const hasExportSql = /\[EXPORT_SQL\]/.test(responseText);
    const hasXlsxBlock = /\[XLSX\]/.test(responseText);

    if (userRequestedExport || hasExportSql || hasXlsxBlock) {
      exportTrigger = userRequestedExport ? 'explicit_request' : 'large_result_set';

      // Path 1: [EXPORT_SQL] — Claude wrote the query, bot validates and executes it
      // Uses the same safety controls as the MCP server: read-only validation,
      // LIMIT injection, 1GB byte cap, 120s timeout. Falls back to direct BQ on failure.
      if (hasExportSql) {
        verbose('📋 Found [EXPORT_SQL] block — executing with MCP-equivalent validation...');
        const exportReq = parseExportSqlBlock(responseText);
        if (exportReq) {
          let rows: Record<string, any>[] = [];
          let exportBytesScanned = 0;

          try {
            verbose('🔍 Executing validated export query against BigQuery...');
            const result: ExportQueryResult = await runExportQuery(exportReq.sql);
            rows = result.rows;
            exportBytesScanned = result.bytesProcessed;
            verbose(`📊 Got ${rows.length} rows, ${exportBytesScanned} bytes scanned`);

            // Add export SQL and bytes to the audit trail
            claudeResponse.sqlExecuted.push(exportReq.sql);
            claudeResponse.bytesScanned += exportBytesScanned;
          } catch (validatedErr) {
            // Validated path failed — fall back to direct BQ (with jobTimeoutMs)
            console.warn('[conversation] Validated export failed:', (validatedErr as Error).message);
            try {
              rows = await runExportQueryDirect(exportReq.sql);
              claudeResponse.sqlExecuted.push(exportReq.sql);
              verbose(`📊 Fallback: Got ${rows.length} rows from direct BQ`);
            } catch (fallbackErr) {
              console.error('[conversation] EXPORT_SQL execution failed (both paths):', (fallbackErr as Error).message);
            }
          }

          if (rows.length > 0) {
            // Convert BQ rows to keyed objects matching column keys
            const keyedRows = rows.map((row: any) => {
              const obj: Record<string, any> = {};
              for (const col of exportReq.columns) {
                // Try exact key match, then case-insensitive field match
                obj[col.key] = row[col.key] ?? row[col.header] ?? Object.values(row).find((_, i) =>
                  Object.keys(row)[i]?.toLowerCase() === col.key.toLowerCase()
                ) ?? null;
              }
              return obj;
            });

            xlsxBuffer = await generateWorkbook({
              title: exportReq.title,
              sheets: [{
                name: exportReq.title.substring(0, 31), // Excel sheet name limit
                columns: exportReq.columns,
                rows: keyedRows,
                includeTotal: false,
              }],
              chartBuffer: chartBuffer ?? undefined,
            });
            xlsxFilename = sanitizeFilename(exportReq.title) + '.xlsx';
            verbose(`📄 XLSX generated: ${xlsxBuffer.length} bytes, ${rows.length} rows`);
          }
        }
        responseText = stripExportSqlBlocks(responseText);
      }

      // Path 2: [XLSX] block — Claude serialized data as JSON
      if (!xlsxBuffer && hasXlsxBlock) {
        verbose('📋 Parsing [XLSX] block...');
        const xlsxReq = parseXlsxFromResponse(responseText, chartBuffer);
        if (xlsxReq) {
          try {
            verbose('📄 Generating XLSX workbook...');
            xlsxBuffer = await generateWorkbook(xlsxReq);
            xlsxFilename = sanitizeFilename(xlsxReq.title) + '.xlsx';
          } catch (err) {
            console.error('[conversation] XLSX generation failed:', (err as Error).message);
          }
        }
      }

      // Path 3: heuristic fallback — parse markdown tables
      if (!xlsxBuffer && userRequestedExport) {
        verbose('📋 No [EXPORT_SQL] or [XLSX] block — trying markdown table heuristic...');
        const xlsxReq = parseXlsxFromResponse(responseText, chartBuffer);
        if (xlsxReq) {
          try {
            xlsxBuffer = await generateWorkbook(xlsxReq);
            xlsxFilename = sanitizeFilename(xlsxReq.title) + '.xlsx';
          } catch (err) {
            console.error('[conversation] Heuristic XLSX failed:', (err as Error).message);
          }
        }
      }

      // Strip [XLSX] and [EXPORT_SQL] blocks from displayed text
      responseText = responseText.replace(/\[XLSX\]\s*[\s\S]*\s*\[\/XLSX\]/g, '').trim();
      responseText = stripExportSqlBlocks(responseText);
    }

    // Check for issue reporting — two triggers:
    // 1. User said "report issue" or similar
    // 2. Claude produced an [ISSUE] block in the response (after gathering details)
    const userTriggeredIssue = ISSUE_TRIGGERS.some((trigger) =>
      input.toLowerCase().includes(trigger)
    );
    const claudeProducedIssue = /\[ISSUE\]/.test(responseText);

    if (userTriggeredIssue || claudeProducedIssue) {
      isIssueReport = true;
      issueDetails = parseIssueFromResponse(responseText, userId, threadId, channelId, options?.threadLink);
      // Populate originalQuestion from thread history if Claude didn't include it
      if (issueDetails && !issueDetails.originalQuestion && thread.messages.length > 0) {
        const firstUserMsg = thread.messages.find((m) => m.role === 'user');
        if (firstUserMsg && typeof firstUserMsg.content === 'string') {
          issueDetails.originalQuestion = firstUserMsg.content;
        }
      }
      if (claudeProducedIssue) {
        verbose('🚩 Issue report captured from [ISSUE] block');
        // Create a DashboardRequest for the issue — works from both CLI and Slack
        if (issueDetails && (issueDetails.whatLooksWrong || issueDetails.originalQuestion)) {
          createDashboardRequest(issueDetails, userId).catch((err) => {
            console.error('[conversation] Dashboard request creation failed:', err.message);
          });
        }
      }
      // Strip [ISSUE] blocks from displayed text
      responseText = responseText.replace(/\[ISSUE\]\s*[\s\S]*?\s*\[\/ISSUE\]/g, '').trim();
    }

    // Truncate thread history before saving to prevent unbounded JSONB growth
    if (thread.messages.length > MAX_THREAD_MESSAGES) {
      thread.messages = thread.messages.slice(-MAX_THREAD_MESSAGES);
    }

    // Save thread state
    verbose('💾 Saving thread state...');
    thread.updatedAt = new Date();
    await saveThread(thread).catch((err) => {
      console.error('[conversation] Failed to save thread:', err.message);
    });

    // Write audit record (fire-and-forget)
    verbose('📝 Writing audit record...');
    const auditRecord: AuditRecord = {
      id: crypto.randomUUID(),
      threadId,
      channelId,
      userEmail: userId,
      timestamp: new Date().toISOString(),
      userMessage: input,
      assistantResponse: responseText,
      toolCalls: claudeResponse.toolCalls,
      sqlExecuted: claudeResponse.sqlExecuted,
      bytesScanned: claudeResponse.bytesScanned,
      chartGenerated: chartBuffer !== null,
      chartType,
      exportGenerated: xlsxBuffer !== null,
      exportType: xlsxBuffer ? 'xlsx' : null,
      exportTrigger,
      isIssueReport,
      issueDetails,
      error: claudeResponse.error,
    };
    writeAuditRecord(auditRecord);

    return {
      text: responseText,
      chartBuffer,
      chartType,
      xlsxBuffer,
      xlsxFilename,
      isIssueReport,
      issueDetails,
      exportTrigger,
      error: null,
      provenanceQueryCount: claudeResponse.sqlExecuted.length,
      provenanceBytesScanned: claudeResponse.bytesScanned,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[conversation] Error:', errorMsg);

    return {
      text: `Sorry, I ran into a technical issue: ${errorMsg}`,
      chartBuffer: null,
      chartType: null,
      xlsxBuffer: null,
      xlsxFilename: null,
      isIssueReport: false,
      issueDetails: null,
      exportTrigger: null,
      error: errorMsg,
      provenanceQueryCount: 0,
      provenanceBytesScanned: 0,
    };
  }
}

/**
 * Parse XLSX request from Claude's response.
 * Looks for [XLSX]...[/XLSX] blocks or builds a basic workbook from tabular data.
 *
 * Claude's [XLSX] block shape differs from our WorkbookRequest:
 *   Claude: { headers: string[], rows: any[][], format_hints, formula_columns }
 *   Ours:   { columns: ColumnDef[], rows: Record<string,any>[], includeTotal, formulaColumns }
 * This function normalizes Claude's shape into ours.
 */
function parseXlsxFromResponse(
  text: string,
  chartBuffer: Buffer | null
): WorkbookRequest | null {
  // Try structured [XLSX] block first
  const hasXlsxTag = /\[XLSX\]/.test(text);
  const hasXlsxEnd = /\[\/XLSX\]/.test(text);
  verbose('[xlsx-parse] [XLSX] tag found:', hasXlsxTag, '| [/XLSX] found:', hasXlsxEnd);

  if (hasXlsxTag && hasXlsxEnd) {
    // Use greedy match for large blocks — lazy (.*?) can fail on huge JSON
    const xlsxMatch = text.match(/\[XLSX\]\s*([\s\S]*)\s*\[\/XLSX\]/);
    if (xlsxMatch) {
      verbose('[xlsx-parse] Extracted JSON length:', xlsxMatch[1].length, 'chars');
      try {
        const parsed = JSON.parse(xlsxMatch[1]);
        verbose('[xlsx-parse] Raw block shape:', JSON.stringify(Object.keys(parsed)));
        if (parsed.sheets?.[0]) {
          const s = parsed.sheets[0];
          verbose('[xlsx-parse] First sheet:', s.name, '| keys:', Object.keys(s).join(','), '| rows:', s.rows?.length);
        }
        const normalized = normalizeXlsxBlock(parsed, chartBuffer);
        if (normalized) return normalized;
      } catch (err) {
        verbose('[xlsx-parse] JSON parse failed:', (err as Error).message);
        // Fall through to heuristic parsing
      }
    }
  } else if (hasXlsxTag) {
    verbose('[xlsx-parse] [XLSX] tag found but [/XLSX] missing — block may be truncated');
  }

  // Heuristic: look for markdown tables in the response
  const tableMatch = text.match(/\|(.+)\|\n\|[-| ]+\|\n((?:\|.+\|\n?)+)/);
  if (!tableMatch) return null;

  const headers = tableMatch[1]
    .split('|')
    .map((h) => h.trim())
    .filter(Boolean);
  const rows = tableMatch[2]
    .trim()
    .split('\n')
    .map((row) =>
      row
        .split('|')
        .map((c) => c.trim())
        .filter(Boolean)
    );

  const columns = headers.map((h) => ({
    header: h,
    key: h.toLowerCase().replace(/\s+/g, '_'),
    type: 'string' as const,
  }));

  const dataRows = rows.map((row) => {
    const obj: Record<string, any> = {};
    headers.forEach((h, i) => {
      const key = h.toLowerCase().replace(/\s+/g, '_');
      const val = row[i] ?? '';
      const num = Number(val.replace(/[,%$]/g, ''));
      obj[key] = isNaN(num) ? val : num;
    });
    return obj;
  });

  return {
    title: 'Data_Export',
    sheets: [
      {
        name: 'Data',
        columns,
        rows: dataRows,
        includeTotal: true,
      },
    ],
    chartBuffer: chartBuffer ?? undefined,
  };
}

/**
 * Normalize Claude's [XLSX] block into our WorkbookRequest type.
 *
 * Claude produces:
 *   sheet.headers: string[]           → we need sheet.columns: ColumnDef[]
 *   sheet.rows: any[][]               → we need sheet.rows: Record<string,any>[]
 *   sheet.format_hints: {col: type}   → we fold into ColumnDef.type
 *   sheet.formula_columns             → we normalize to sheet.formulaColumns
 *
 * If sheets already have `columns` (our shape), pass through unchanged.
 */
function normalizeXlsxBlock(
  parsed: any,
  chartBuffer: Buffer | null
): WorkbookRequest | null {
  if (!parsed.sheets || !Array.isArray(parsed.sheets) || parsed.sheets.length === 0) {
    verbose('[xlsx-normalize] No sheets array found');
    return null;
  }

  const normalizedSheets = parsed.sheets.map((sheet: any) => {
    // Already in our shape — has columns with key/header/type
    if (Array.isArray(sheet.columns) && sheet.columns[0]?.key) {
      return {
        name: sheet.name ?? 'Sheet',
        columns: sheet.columns,
        rows: sheet.rows ?? [],
        includeTotal: sheet.includeTotal ?? false,
        formulaColumns: sheet.formulaColumns ?? sheet.formula_columns,
      };
    }

    // Claude's shape — headers + array-of-arrays rows
    const headers: string[] = sheet.headers ?? sheet.columns ?? [];
    if (headers.length === 0) {
      verbose('[xlsx-normalize] Sheet has no headers:', sheet.name);
      return null;
    }

    const formatHints: Record<string, string> = sheet.format_hints ?? {};

    // Build ColumnDef[] from headers + format_hints
    const columns = headers.map((h: string) => {
      const key = h.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '');
      const hint = formatHints[h] ?? '';
      let type: 'string' | 'number' | 'percent' | 'currency' = 'string';
      if (hint === 'percent' || hint === 'percentage' || /%/.test(h)) {
        type = 'percent';
      } else if (hint === 'currency' || hint === 'dollar' || /\$|aum|revenue/i.test(h)) {
        type = 'currency';
      } else if (hint === 'number' || hint === 'integer' || hint === 'int') {
        type = 'number';
      }
      return { header: h, key, type };
    });

    // Convert rows: any[][] → Record<string,any>[]
    const rawRows: any[][] = Array.isArray(sheet.rows) ? sheet.rows : [];
    const keyedRows = rawRows.map((row: any) => {
      // If row is already an object (keyed), pass through
      if (row && !Array.isArray(row)) return row;
      const obj: Record<string, any> = {};
      columns.forEach((col: any, i: number) => {
        obj[col.key] = row[i] ?? null;
      });
      return obj;
    });

    // Auto-detect numeric columns from data if format_hints didn't cover them
    if (keyedRows.length > 0) {
      for (const col of columns) {
        if (col.type === 'string') {
          const sample = keyedRows[0][col.key];
          if (typeof sample === 'number') {
            col.type = 'number';
          }
        }
      }
    }

    // Normalize formula_columns → formulaColumns
    const rawFormulas = sheet.formulaColumns ?? sheet.formula_columns;
    let formulaColumns;
    if (Array.isArray(rawFormulas)) {
      formulaColumns = rawFormulas.map((fc: any) => ({
        header: fc.header,
        formula: fc.formula,
        type: (fc.type === 'percent' || fc.format === 'percent') ? 'percent' as const : 'number' as const,
      }));
    }

    // Detect if Claude already included a total/sum row in the data.
    // If any cell in the last row is a =SUM formula, Claude built its own totals.
    const lastRow = rawRows[rawRows.length - 1];
    const dataHasTotalRow = Array.isArray(lastRow) &&
      lastRow.some((cell: any) => typeof cell === 'string' && /^=SUM\(/i.test(cell));

    // Default includeTotal to true for data sheets (>1 row of data),
    // false for metadata/methodology sheets or if Claude already added totals.
    const looksLikeMetadata = /method|notes|context|metadata/i.test(sheet.name ?? '');
    const includeTotal = dataHasTotalRow
      ? false
      : (sheet.includeTotal ?? (keyedRows.length > 1 && !looksLikeMetadata));

    return {
      name: sheet.name ?? 'Sheet',
      columns,
      rows: keyedRows,
      includeTotal,
      formulaColumns,
    };
  }).filter(Boolean);

  if (normalizedSheets.length === 0) return null;

  verbose('[xlsx-normalize] Normalized', normalizedSheets.length, 'sheets:',
    normalizedSheets.map((s: any) => `${s.name} (${s.columns.length} cols, ${s.rows.length} rows)`).join(', '));

  return {
    title: parsed.filename ?? parsed.title ?? 'Data_Export',
    sheets: normalizedSheets,
    chartBuffer: chartBuffer ?? undefined,
  };
}

/**
 * Parse issue details from Claude's [ISSUE] block or build a skeleton.
 *
 * Claude's [ISSUE] block uses different field names than our IssueReport type:
 *   Claude: title, description, root_cause, expected_behavior, proposed_fix, severity
 *   Ours:   whatLooksWrong, whatExpected, originalQuestion, reporterEmail, etc.
 * This function normalizes Claude's shape into ours.
 */
function parseIssueFromResponse(
  text: string,
  userId: string,
  threadId: string,
  channelId: string,
  threadLink?: string
): IssueReport {
  const fallbackLink = threadLink || `Thread ${channelId}:${threadId}`;
  const issueMatch = text.match(/\[ISSUE\]\s*([\s\S]*?)\s*\[\/ISSUE\]/);
  if (issueMatch) {
    try {
      const parsed = JSON.parse(issueMatch[1]);
      verbose('[issue-parse] Parsed issue block keys:', Object.keys(parsed).join(', '));

      // Normalize severity — Claude may use "high"/"medium"/"low" vs our enum
      let severity: 'non-urgent' | 'needs-attention' | 'blocking' = 'non-urgent';
      const rawSeverity = (parsed.severity ?? '').toLowerCase();
      if (rawSeverity === 'blocking' || rawSeverity === 'critical') {
        severity = 'blocking';
      } else if (rawSeverity === 'high' || rawSeverity === 'needs-attention' || rawSeverity === 'medium') {
        severity = 'needs-attention';
      }

      // Normalize priority — Claude should include LOW/MEDIUM/HIGH
      let priority: IssuePriority = 'MEDIUM';
      const rawPriority = (parsed.priority ?? '').toUpperCase();
      if (rawPriority === 'LOW') priority = 'LOW';
      else if (rawPriority === 'HIGH') priority = 'HIGH';
      else if (rawPriority === 'MEDIUM') priority = 'MEDIUM';

      return {
        reporterEmail: parsed.reporterEmail ?? parsed.reported_by ?? userId,
        reporterSlackId: parsed.reporterSlackId ?? userId,
        threadLink: fallbackLink,
        originalQuestion: parsed.originalQuestion ?? parsed.title ?? '',
        sqlExecuted: parsed.sqlExecuted ?? parsed.sql_executed ?? [],
        schemaToolsCalled: parsed.schemaToolsCalled ?? parsed.schema_tools_called ?? [],
        whatLooksWrong: coerceString(parsed.whatLooksWrong ?? parsed.description ?? parsed.root_cause
          ?? parsed.suspected_cause ?? parsed.discrepancy ?? parsed.observed_value
          ?? parsed.summary ?? parsed.issue ?? ''),
        whatExpected: coerceString(parsed.whatExpected ?? parsed.expected_behavior ?? parsed.proposed_fix
          ?? parsed.expected_value ?? parsed.recommendation ?? parsed.recommended_next_steps ?? ''),
        severity,
        priority,
        timestamp: parsed.timestamp ?? new Date().toISOString(),
      };
    } catch (err) {
      verbose('[issue-parse] JSON parse failed:', (err as Error).message);
    }
  }

  // Skeleton — Claude is still gathering info
  return {
    reporterEmail: userId,
    reporterSlackId: userId,
    threadLink: fallbackLink,
    originalQuestion: '',
    sqlExecuted: [],
    schemaToolsCalled: [],
    whatLooksWrong: '',
    whatExpected: '',
    severity: 'non-urgent',
    priority: 'MEDIUM',
    timestamp: new Date().toISOString(),
  };
}

/** Coerce a value to string — handles arrays (join), objects (stringify), and primitives. */
function coerceString(val: any): string {
  if (val == null) return '';
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) return val.join('; ');
  return String(val);
}

function sanitizeFilename(title: string): string {
  return title.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 100);
}
