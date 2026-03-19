// src/types/reporting.ts
// TypeScript types for the Agentic Reporting feature

export type ReportType = 'analyze-wins' | 'sga-performance' | 'sgm-analysis' | 'competitive-intel';

/** Top-level report output from the agent */
export interface ReportOutput {
  title: string;
  reportType: ReportType;
  generatedAt: string; // ISO 8601

  /** 2-4 sentence executive summary for email notifications and report cards */
  executiveSummary: string;

  /** Headline metrics displayed as KPI cards at the top of the report */
  keyMetrics: KeyMetric[];

  /** Ordered report sections — each rendered as a distinct visual block */
  sections: ReportSection[];

  /** Actionable recommendations, ranked by expected impact */
  recommendations: Recommendation[];
}

export interface KeyMetric {
  id: string;
  label: string;
  value: number | string;
  format: 'number' | 'currency' | 'percent' | 'text';
  delta?: {
    value: number;
    direction: 'up' | 'down' | 'flat';
    label: string;
    favorable: boolean;
  };
}

export interface ReportSection {
  id: string;
  title: string;
  narrative: string;
  charts: ChartSpec[];
  tables: TableSpec[];
  callouts: KeyMetric[];
}

// ─── Chart Specifications ───────────────────────────────────────────

export type ChartSpec = BarChartSpec | LineChartSpec | PieChartSpec | ComposedChartSpec;

interface BaseChartSpec {
  id: string;
  title: string;
  subtitle?: string;
  height?: number;
}

export interface BarChartSpec extends BaseChartSpec {
  type: 'bar';
  data: Record<string, unknown>[];
  xKey: string;
  yKeys: { key: string; label: string; color?: string; stackId?: string }[];
  layout?: 'vertical' | 'horizontal';
  showValues?: boolean;
}

export interface LineChartSpec extends BaseChartSpec {
  type: 'line';
  data: Record<string, unknown>[];
  xKey: string;
  yKeys: { key: string; label: string; color?: string; strokeDasharray?: string }[];
  showDots?: boolean;
  referenceLines?: { y: number; label: string; color: string }[];
}

export interface PieChartSpec extends BaseChartSpec {
  type: 'pie';
  data: { name: string; value: number; color?: string }[];
  innerRadius?: number;
}

export interface ComposedChartSpec extends BaseChartSpec {
  type: 'composed';
  data: Record<string, unknown>[];
  xKey: string;
  series: {
    key: string;
    label: string;
    chartType: 'bar' | 'line' | 'area';
    yAxisId?: 'left' | 'right';
    color?: string;
  }[];
  dualAxis?: boolean;
}

// ─── Table Specifications ───────────────────────────────────────────

export interface TableSpec {
  id: string;
  title: string;
  columns: {
    key: string;
    label: string;
    format?: 'number' | 'currency' | 'percent' | 'text' | 'date';
    sortable?: boolean;
    align?: 'left' | 'center' | 'right';
    highlight?: 'high-is-good' | 'low-is-good';
  }[];
  rows: Record<string, unknown>[];
  sortBy?: { key: string; direction: 'asc' | 'desc' };
  highlightRow?: { key: string; value: unknown };
  maxRows?: number;
}

// ─── Recommendations ────────────────────────────────────────────────

export interface Recommendation {
  id: string;
  priority: 'high' | 'medium' | 'low';
  category: 'source-allocation' | 'sga-coaching' | 'process' | 'positioning' | 'product' | 'monitoring';
  title: string;
  rationale: string;
  expectedImpact?: string;
  timeframe: 'immediate' | 'this-quarter' | 'next-quarter';
}

// ─── Query Log ──────────────────────────────────────────────────────

export interface QueryLogEntry {
  stepIndex: number;
  sql: string;
  description: string;
  rows: Record<string, unknown>[];
  rowCount: number;
  bytesScanned: number;
  durationMs: number;
  timestamp: string;
}

// ─── Report Labels ──────────────────────────────────────────────────

export const REPORT_LABELS: Record<ReportType, string> = {
  'analyze-wins': 'Won Deal Intelligence',
  'sga-performance': 'SGA Performance',
  'sgm-analysis': 'SGM Analysis',
  'competitive-intel': 'Competitive Intelligence',
};

// ─── Suggested Follow-Up Questions ──────────────────────────────────

export interface SuggestedQuestion {
  label: string;
  prompt: string;
  audience: ('revops' | 'manager' | 'leadership')[];
}
