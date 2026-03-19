import type { ReportOutput } from '@/types/reporting';

export const SAMPLE_REPORT: ReportOutput = {
  title: 'SGM Analysis — Sample Report',
  reportType: 'sgm-analysis',
  generatedAt: '2026-03-17T15:00:00.000Z',
  executiveSummary:
    'This SGM maintains strong qualification discipline with a 42% SQL-to-SQO conversion rate, ranking 2nd among all SGMs. Pipeline health is solid with $18.2M in active opportunities, though close rates dipped slightly in Q1 2026.',

  keyMetrics: [
    {
      id: 'total-sqos',
      label: 'Total SQOs',
      value: 47,
      format: 'number',
      delta: { value: 12.5, direction: 'up', label: 'vs prior quarter', favorable: true },
    },
    {
      id: 'close-rate',
      label: 'Close Rate',
      value: 28.3,
      format: 'percent',
      delta: { value: 3.1, direction: 'down', label: 'vs prior quarter', favorable: false },
    },
    {
      id: 'avg-aum',
      label: 'Avg AUM (Won)',
      value: 2400000,
      format: 'currency',
      delta: { value: 8.2, direction: 'up', label: 'vs prior quarter', favorable: true },
    },
    {
      id: 'pipeline-value',
      label: 'Pipeline Value',
      value: 18200000,
      format: 'currency',
    },
  ],

  sections: [
    {
      id: 'qualification-discipline',
      title: 'Qualification Discipline',
      narrative:
        'Across the SGM team, qualification rigor varies significantly. The target SGM converts 42% of SQLs to SQOs, well above the team average of 34%. Only one SGM (Sarah Chen at 45%) has a higher conversion rate. The bottom performers — notably Mike Torres at 22% — are letting through lower-quality opportunities that rarely close, inflating pipeline counts without improving outcomes.',
      charts: [
        {
          id: 'sgm-sql-sqo-rates',
          type: 'bar' as const,
          title: 'SQL → SQO Conversion Rate by SGM',
          subtitle: 'Higher is better — indicates stricter qualification',
          data: [
            { name: 'Sarah Chen', rate: 45 },
            { name: 'Target SGM', rate: 42 },
            { name: 'Alex Rivera', rate: 36 },
            { name: 'Jordan Kim', rate: 31 },
            { name: 'Mike Torres', rate: 22 },
          ],
          xKey: 'name',
          yKeys: [{ key: 'rate', label: 'Conversion Rate %', color: '#6366f1' }],
          showValues: true,
        },
      ],
      tables: [
        {
          id: 'sgm-qualification-table',
          title: 'SGM Qualification Summary',
          columns: [
            { key: 'name', label: 'SGM', sortable: true },
            { key: 'sqls', label: 'SQLs', format: 'number', sortable: true, align: 'right' },
            { key: 'sqos', label: 'SQOs', format: 'number', sortable: true, align: 'right' },
            { key: 'rate', label: 'Conv. Rate', format: 'percent', sortable: true, align: 'right', highlight: 'high-is-good' },
            { key: 'avgAum', label: 'Avg AUM', format: 'currency', sortable: true, align: 'right' },
          ],
          rows: [
            { name: 'Sarah Chen', sqls: 62, sqos: 28, rate: 45.2, avgAum: 2800000 },
            { name: 'Target SGM', sqls: 112, sqos: 47, rate: 42.0, avgAum: 2400000 },
            { name: 'Alex Rivera', sqls: 89, sqos: 32, rate: 36.0, avgAum: 1900000 },
            { name: 'Jordan Kim', sqls: 74, sqos: 23, rate: 31.1, avgAum: 2100000 },
            { name: 'Mike Torres', sqls: 95, sqos: 21, rate: 22.1, avgAum: 1500000 },
          ],
          sortBy: { key: 'rate', direction: 'desc' },
          highlightRow: { key: 'name', value: 'Target SGM' },
        },
      ],
      callouts: [],
    },
    {
      id: 'pipeline-health',
      title: 'Pipeline Health',
      narrative:
        'Monthly SQO production has been steady, averaging 8.2 SQOs per month over the past 6 months. Close rates show a slight downward trend from 32% in October to 26% in March, which warrants attention. The dip correlates with an increased share of lower-AUM opportunities entering the pipeline from newer lead sources.',
      charts: [
        {
          id: 'monthly-pipeline-trend',
          type: 'composed' as const,
          title: 'Monthly SQOs & Close Rate Trend',
          data: [
            { month: 'Oct', sqos: 7, closeRate: 32 },
            { month: 'Nov', sqos: 9, closeRate: 30 },
            { month: 'Dec', sqos: 6, closeRate: 31 },
            { month: 'Jan', sqos: 10, closeRate: 29 },
            { month: 'Feb', sqos: 8, closeRate: 27 },
            { month: 'Mar', sqos: 7, closeRate: 26 },
          ],
          xKey: 'month',
          series: [
            { key: 'sqos', label: 'SQOs', chartType: 'bar' as const, yAxisId: 'left' as const, color: '#6366f1' },
            { key: 'closeRate', label: 'Close Rate %', chartType: 'line' as const, yAxisId: 'right' as const, color: '#f59e0b' },
          ],
          dualAxis: true,
        },
      ],
      tables: [],
      callouts: [],
    },
  ],

  recommendations: [
    {
      id: 'rec-1',
      priority: 'high',
      category: 'process',
      title: 'Investigate close rate decline',
      rationale:
        'Close rate has dropped 6 percentage points over 6 months (32% → 26%). If this trend continues, quarterly production will miss target by ~15%. Root cause analysis should focus on the new lead sources that correlate with the dip.',
      expectedImpact: 'Prevent 15% quarterly production shortfall',
      timeframe: 'immediate',
    },
    {
      id: 'rec-2',
      priority: 'medium',
      category: 'sga-coaching',
      title: 'Tighten qualification criteria for low-AUM sources',
      rationale:
        'Opportunities from newer lead sources have 40% lower average AUM and 18% lower close rates. Consider raising the AUM floor for SQO qualification from these sources, or routing them to a specialized SGA team.',
      expectedImpact: 'Improve close rate by ~3-5 percentage points',
      timeframe: 'this-quarter',
    },
  ],
};
