// packages/analyst-bot/src/types.ts
// ============================================================================
// Shared type definitions for the Savvy Analyst Bot
// ============================================================================

/**
 * Chart types Claude can request. The charts module maps these to Chart.js config.
 * - "horizontalBar" and "stackedBar" are convenience aliases that map to
 *   Chart.js "bar" with specific options.
 */
export type ChartType = 'bar' | 'horizontalBar' | 'pie' | 'doughnut' | 'line' | 'stackedBar';

/**
 * Parsed from Claude's [CHART]...[/CHART] JSON block.
 */
export interface ChartRequest {
  type: ChartType;
  title: string;
  labels: string[];
  datasets: Array<{
    label: string;
    values: number[];
  }>;
  options?: {
    showPercentages?: boolean;
    showValues?: boolean;
    yAxisLabel?: string;
    xAxisLabel?: string;
  };
}

/**
 * Column definition for XLSX generation.
 */
export interface ColumnDef {
  header: string;
  key: string;
  type: 'string' | 'number' | 'percent' | 'currency';
}

/**
 * Formula column that computes from other columns.
 */
export interface FormulaColumn {
  header: string;
  formula: string; // Excel formula template, e.g., "=B{row}/C{row}"
  type: 'percent' | 'number';
}

/**
 * Sheet definition within a workbook.
 */
export interface SheetDef {
  name: string;
  columns: ColumnDef[];
  rows: Record<string, any>[];
  includeTotal: boolean;
  formulaColumns?: FormulaColumn[];
}

/**
 * Input to the XLSX generation module.
 */
export interface WorkbookRequest {
  title: string;
  sheets: SheetDef[];
  chartBuffer?: Buffer;
}

/**
 * A single message in the conversation history.
 * Stored in Neon as JSONB. Sent to Claude as message params.
 */
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string | any[]; // string for user, content block array for assistant
}

/**
 * Thread state persisted in Neon Postgres.
 */
export interface ThreadState {
  threadId: string;
  channelId: string;
  messages: ConversationMessage[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * MCP tool call record for audit logging.
 */
export interface ToolCallRecord {
  toolName: string;
  serverName: string;
  input: Record<string, any>;
  isError: boolean;
}

/**
 * Response from Claude API, parsed by claude.ts.
 */
export interface ClaudeResponse {
  text: string;
  contentBlocks: any[];
  toolCalls: ToolCallRecord[];
  sqlExecuted: string[];
  bytesScanned: number;
  error: string | null;
}

/**
 * Issue report details gathered by Claude during issue flow.
 */
export type IssuePriority = 'LOW' | 'MEDIUM' | 'HIGH';

export interface IssueReport {
  reporterEmail: string;
  reporterSlackId: string;
  threadLink: string;
  originalQuestion: string;
  sqlExecuted: string[];
  schemaToolsCalled: string[];
  whatLooksWrong: string;
  whatExpected: string;
  severity: 'non-urgent' | 'needs-attention' | 'blocking';
  priority: IssuePriority;
  timestamp: string;
}

/**
 * Audit record written to BigQuery.
 */
export interface AuditRecord {
  id: string;
  threadId: string;
  channelId: string;
  userEmail: string;
  timestamp: string;
  userMessage: string;
  assistantResponse: string;
  toolCalls: ToolCallRecord[];
  sqlExecuted: string[];
  bytesScanned: number;
  chartGenerated: boolean;
  chartType: ChartType | null;
  exportGenerated: boolean;
  exportType: 'xlsx' | null;
  exportTrigger: 'explicit_request' | 'large_result_set' | null;
  isIssueReport: boolean;
  issueDetails: IssueReport | null;
  error: string | null;
}

/**
 * Result returned by conversation.ts processMessage().
 * cli.ts and slack.ts use this to render output.
 */
export interface ConversationResult {
  text: string;
  chartBuffer: Buffer | null;
  chartType: ChartType | null;
  xlsxBuffer: Buffer | null;
  xlsxFilename: string | null;
  isIssueReport: boolean;
  issueDetails: IssueReport | null;
  exportTrigger: 'explicit_request' | 'large_result_set' | null;
  error: string | null;
}
