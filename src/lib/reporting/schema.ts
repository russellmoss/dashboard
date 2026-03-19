import { z } from 'zod';

// ─── Verification Schema (Pass 1.5) ────────────────────────────────

const VerificationIssueSchema = z.object({
  claim: z.string(),
  cited: z.string(),
  actual: z.string(),
  queryIndex: z.number().optional(),
  severity: z.enum(['error', 'warning']),
});

export const VerificationResultSchema = z.object({
  verified: z.boolean(),
  issueCount: z.number(),
  issues: z.array(VerificationIssueSchema),
  corrections: z.string().optional(),
});

export type VerificationResult = z.infer<typeof VerificationResultSchema>;

// ─── Report Output Schema ───────────────────────────────────────────

const KeyMetricSchema = z.object({
  id: z.string(),
  label: z.string(),
  value: z.union([z.number(), z.string()]),
  format: z.enum(['number', 'currency', 'percent', 'text']),
  delta: z.object({
    value: z.number(),
    direction: z.enum(['up', 'down', 'flat']),
    label: z.string(),
    favorable: z.boolean(),
  }).optional(),
});

const BarChartSpecSchema = z.object({
  type: z.literal('bar'),
  id: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  height: z.number().optional(),
  data: z.array(z.record(z.string(), z.unknown())),
  xKey: z.string(),
  yKeys: z.array(z.object({
    key: z.string(),
    label: z.string(),
    color: z.string().optional(),
    stackId: z.string().optional(),
  })),
  layout: z.enum(['vertical', 'horizontal']).optional(),
  showValues: z.boolean().optional(),
});

const LineChartSpecSchema = z.object({
  type: z.literal('line'),
  id: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  height: z.number().optional(),
  data: z.array(z.record(z.string(), z.unknown())),
  xKey: z.string(),
  yKeys: z.array(z.object({
    key: z.string(),
    label: z.string(),
    color: z.string().optional(),
    strokeDasharray: z.string().optional(),
  })),
  showDots: z.boolean().optional(),
  referenceLines: z.array(z.object({
    y: z.number(),
    label: z.string(),
    color: z.string(),
  })).optional(),
});

const PieChartSpecSchema = z.object({
  type: z.literal('pie'),
  id: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  height: z.number().optional(),
  data: z.array(z.object({
    name: z.string(),
    value: z.number(),
    color: z.string().optional(),
  })),
  innerRadius: z.number().optional(),
});

const ComposedChartSpecSchema = z.object({
  type: z.literal('composed'),
  id: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  height: z.number().optional(),
  data: z.array(z.record(z.string(), z.unknown())),
  xKey: z.string(),
  series: z.array(z.object({
    key: z.string(),
    label: z.string(),
    chartType: z.enum(['bar', 'line', 'area']),
    yAxisId: z.enum(['left', 'right']).optional(),
    color: z.string().optional(),
  })),
  dualAxis: z.boolean().optional(),
});

const ChartSpecSchema = z.discriminatedUnion('type', [
  BarChartSpecSchema,
  LineChartSpecSchema,
  PieChartSpecSchema,
  ComposedChartSpecSchema,
]);

const TableSpecSchema = z.object({
  id: z.string(),
  title: z.string(),
  columns: z.array(z.object({
    key: z.string(),
    label: z.string(),
    format: z.enum(['number', 'currency', 'percent', 'text', 'date']).optional(),
    sortable: z.boolean().optional(),
    align: z.enum(['left', 'center', 'right']).optional(),
    highlight: z.enum(['high-is-good', 'low-is-good']).optional(),
  })),
  rows: z.array(z.record(z.string(), z.unknown())),
  sortBy: z.object({
    key: z.string(),
    direction: z.enum(['asc', 'desc']),
  }).optional(),
  highlightRow: z.object({
    key: z.string(),
    value: z.unknown(),
  }).optional(),
  maxRows: z.number().optional(),
});

const RecommendationSchema = z.object({
  id: z.string(),
  priority: z.enum(['high', 'medium', 'low']),
  category: z.enum(['source-allocation', 'sga-coaching', 'process', 'positioning', 'product', 'monitoring']),
  title: z.string(),
  rationale: z.string(),
  expectedImpact: z.string().optional(),
  timeframe: z.enum(['immediate', 'this-quarter', 'next-quarter']),
});

const ReportSectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  narrative: z.string(),
  charts: z.array(ChartSpecSchema).default([]),
  tables: z.array(TableSpecSchema).default([]),
  callouts: z.array(KeyMetricSchema).default([]),
});

export const ReportOutputSchema = z.object({
  title: z.string(),
  reportType: z.string(),
  generatedAt: z.string(),
  executiveSummary: z.string(),
  keyMetrics: z.array(KeyMetricSchema).min(3).max(12),
  sections: z.array(ReportSectionSchema).min(1),
  recommendations: z.array(RecommendationSchema),
});

export type ReportOutput = z.infer<typeof ReportOutputSchema>;
