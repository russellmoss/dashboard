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
  provenanceQueryCount: number;
  provenanceBytesScanned: number;
}

// ============================================================================
// Scheduled Reports + Google Docs Report Generation types
// ============================================================================

/**
 * Frequency for scheduled recurring reports.
 */
export type ScheduleFrequency = 'daily' | 'weekly' | 'monthly';

/**
 * A scheduled recurring report persisted in Neon Postgres (bot_schedules table).
 * Users create these via the Report Builder modal (App Home or "Schedule This" shortcut).
 */
/**
 * A recipient for a scheduled report.
 * userId is the Slack user ID, email is resolved for Google Doc sharing.
 */
export interface ScheduleRecipient {
  userId: string;
  email?: string;
}

export interface ScheduleRecord {
  id: string;
  userId: string;
  userEmail: string | null;
  reportName: string;
  questionText: string;
  frozenSql: string;
  frequency: ScheduleFrequency;
  deliverAtHour: number;        // minutes since midnight UTC (0-1439) or legacy hour (0-23)
  deliveryType: 'slack_dm' | 'google_doc';
  nextRunAt: Date;
  lastRunAt: Date | null;
  failureCount: number;
  createdAt: Date;
  isActive: boolean;
  recipients: ScheduleRecipient[];  // additional recipients (creator always included)
  scheduleDay: string | null;       // weekly: 'monday'-'sunday'; monthly: '1','15','last','first_monday', etc.
}

/**
 * Status of a single section within a generated report.
 */
export type ReportSectionStatus = 'pending' | 'running' | 'done' | 'failed';

/**
 * A section in a multi-section report (stored in bot_reports.sections_json).
 */
export interface ReportSection {
  title: string;
  question: string;
  status: ReportSectionStatus;
  narrativeText?: string;
  errorMessage?: string;
}

/**
 * Result of processing a single report section through the Claude pipeline.
 */
export interface SectionResult {
  title: string;
  text: string;
  chartBuffer: Buffer | null;
  tableData: Record<string, any>[] | null;
  allTables?: Record<string, any>[][];
}

/**
 * Status of a generated report.
 */
export type ReportStatus = 'pending' | 'running' | 'done' | 'failed';

/**
 * A generated report record persisted in Neon Postgres (bot_reports table).
 */
export interface ReportRecord {
  id: string;
  userId: string;
  userEmail: string;
  title: string;
  sectionsJson: ReportSection[];
  status: ReportStatus;
  googleDocId: string | null;
  googleDocUrl: string | null;
  errorMessage: string | null;
  createdAt: Date;
  completedAt: Date | null;
}
