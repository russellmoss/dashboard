import type { ReportOutput } from '@/types/reporting';

type UnknownRecord = Record<string, unknown>;

function isAumLikeLabel(label: string): boolean {
  return /\baum\b|deal size|volume lost|lost volume|pipeline/i.test(label);
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function inferNumericKeys(data: unknown[], xKey?: string): string[] {
  if (!Array.isArray(data) || data.length === 0) return [];
  const sample = data.find(isRecord);
  if (!sample) return [];

  return Object.entries(sample)
    .filter(([key, value]) => key !== xKey && typeof value === 'number')
    .map(([key]) => key);
}

function normalizeYKeyEntry(entry: unknown, index: number): UnknownRecord | null {
  if (typeof entry === 'string' && entry.trim() !== '') {
    return {
      key: entry,
      label: entry,
    };
  }

  if (!isRecord(entry)) return null;

  const key =
    typeof entry.key === 'string' && entry.key.trim() !== ''
      ? entry.key
      : (typeof entry.label === 'string' && entry.label.trim() !== '' ? entry.label : undefined);

  if (!key) return null;

  const normalized: UnknownRecord = {
    key,
    label: typeof entry.label === 'string' && entry.label.trim() !== '' ? entry.label : key,
  };

  if (typeof entry.color === 'string') {
    normalized.color = entry.color;
  }

  if (typeof entry.stackId === 'string') {
    normalized.stackId = entry.stackId;
  }

  if (typeof entry.strokeDasharray === 'string') {
    normalized.strokeDasharray = entry.strokeDasharray;
  }

  return normalized;
}

function normalizeChart(chart: unknown, index: number): UnknownRecord | null {
  if (!isRecord(chart) || typeof chart.type !== 'string') return null;

  const normalized: UnknownRecord = { ...chart };
  const type = normalized.type;
  normalized.id = typeof normalized.id === 'string' ? normalized.id : `chart_${index + 1}`;
  normalized.title = typeof normalized.title === 'string' ? normalized.title : `Chart ${index + 1}`;
  normalized.data = Array.isArray(normalized.data) ? normalized.data : [];
  const xKey = typeof normalized.xKey === 'string' ? normalized.xKey : undefined;
  const numericKeys = inferNumericKeys(Array.isArray(normalized.data) ? normalized.data : [], xKey);

  if (type === 'bar' || type === 'line') {
    if (typeof normalized.xKey !== 'string') {
      const sample = Array.isArray(normalized.data) ? normalized.data.find(isRecord) : undefined;
      const candidate = sample
        ? Object.keys(sample).find(key => typeof sample[key] === 'string')
        : undefined;
      if (!candidate) return null;
      normalized.xKey = candidate;
    }
    if (Array.isArray(normalized.yKeys)) {
      normalized.yKeys = normalized.yKeys
        .map((entry, entryIndex) => normalizeYKeyEntry(entry, entryIndex))
        .filter((entry): entry is UnknownRecord => entry !== null);
    }

    if (!Array.isArray(normalized.yKeys) || normalized.yKeys.length === 0) {
      if (numericKeys.length === 0) return null;
      normalized.yKeys = numericKeys.map(key => ({
        key,
        label: key,
      }));
    }
    return normalized;
  }

  if (type === 'composed') {
    if (typeof normalized.xKey !== 'string') {
      const sample = Array.isArray(normalized.data) ? normalized.data.find(isRecord) : undefined;
      const candidate = sample
        ? Object.keys(sample).find(key => typeof sample[key] === 'string')
        : undefined;
      if (!candidate) return null;
      normalized.xKey = candidate;
    }
    if (!Array.isArray(normalized.series)) {
      if (Array.isArray(normalized.yKeys) && normalized.yKeys.length > 0) {
        normalized.series = normalized.yKeys
          .filter(isRecord)
          .map((entry, index) => ({
            key: typeof entry.key === 'string' ? entry.key : `series_${index + 1}`,
            label: typeof entry.label === 'string' ? entry.label : (typeof entry.key === 'string' ? entry.key : `Series ${index + 1}`),
            chartType: index === 0 ? 'bar' : 'line',
            color: typeof entry.color === 'string' ? entry.color : undefined,
            yAxisId: index === 0 ? 'left' : 'right',
          }));
      } else if (numericKeys.length > 0) {
        normalized.series = numericKeys.map((key, index) => ({
          key,
          label: key,
          chartType: index === 0 ? 'bar' : 'line',
          yAxisId: index === 0 ? 'left' : 'right',
        }));
      } else {
        return null;
      }
    }
    return normalized;
  }

  if (type === 'pie') {
    return Array.isArray(normalized.data) ? normalized : null;
  }

  return null;
}

function normalizeTableColumn(column: unknown, index: number): UnknownRecord | null {
  if (!isRecord(column)) return null;

  const normalized: UnknownRecord = { ...column };
  normalized.key = typeof normalized.key === 'string' ? normalized.key : `column_${index + 1}`;
  normalized.label = typeof normalized.label === 'string' ? normalized.label : String(normalized.key);
  normalized.format =
    normalized.format === 'number' ||
    normalized.format === 'currency' ||
    normalized.format === 'percent' ||
    normalized.format === 'text' ||
    normalized.format === 'date'
      ? normalized.format
      : 'text';

  if (normalized.sortable !== undefined) {
    normalized.sortable = Boolean(normalized.sortable);
  }

  if (normalized.align !== 'left' && normalized.align !== 'center' && normalized.align !== 'right') {
    delete normalized.align;
  }

  if (normalized.highlight !== 'high-is-good' && normalized.highlight !== 'low-is-good') {
    delete normalized.highlight;
  }

  return normalized;
}

function normalizeTable(table: unknown, index: number): UnknownRecord | null {
  if (!isRecord(table)) return null;

  const normalized: UnknownRecord = { ...table };
  normalized.id = typeof normalized.id === 'string' ? normalized.id : `table_${index + 1}`;
  normalized.title = typeof normalized.title === 'string' ? normalized.title : `Table ${index + 1}`;
  normalized.rows = Array.isArray(normalized.rows) ? normalized.rows : [];

  const columns = Array.isArray(normalized.columns) ? normalized.columns : [];
  normalized.columns = columns
    .map((column, columnIndex) => normalizeTableColumn(column, columnIndex))
    .filter((column): column is UnknownRecord => column !== null);

  if ((normalized.columns as UnknownRecord[]).length === 0) {
    const sampleRow = (normalized.rows as unknown[]).find(isRecord);
    if (!sampleRow) return null;
    normalized.columns = Object.keys(sampleRow).map((key, columnIndex) => ({
      key,
      label: key,
      format: 'text',
      sortable: columnIndex === 0 ? undefined : true,
    }));
  }

  if (isRecord(normalized.sortBy)) {
    const sortKey = typeof normalized.sortBy.key === 'string' ? normalized.sortBy.key : undefined;
    const direction = normalized.sortBy.direction === 'asc' || normalized.sortBy.direction === 'desc'
      ? normalized.sortBy.direction
      : undefined;
    if (!sortKey || !direction) {
      delete normalized.sortBy;
    }
  } else {
    delete normalized.sortBy;
  }

  if (isRecord(normalized.highlightRow)) {
    if (typeof normalized.highlightRow.key !== 'string') {
      delete normalized.highlightRow;
    }
  } else {
    delete normalized.highlightRow;
  }

  if (typeof normalized.maxRows !== 'number') {
    delete normalized.maxRows;
  }

  return normalized;
}

function normalizeSection(section: unknown, index: number): UnknownRecord | null {
  if (!isRecord(section)) return null;

  const normalized: UnknownRecord = { ...section };
  normalized.id = typeof normalized.id === 'string' ? normalized.id : `section_${index + 1}`;
  normalized.title = typeof normalized.title === 'string' ? normalized.title : `Section ${index + 1}`;
  normalized.narrative = typeof normalized.narrative === 'string' ? normalized.narrative : '';
  normalized.callouts = Array.isArray(normalized.callouts) ? normalized.callouts : [];

  const charts = Array.isArray(normalized.charts) ? normalized.charts : [];
  normalized.charts = charts
    .map((chart, chartIndex) => normalizeChart(chart, chartIndex))
    .filter((chart): chart is UnknownRecord => chart !== null);

  const tables = Array.isArray(normalized.tables) ? normalized.tables : [];
  normalized.tables = tables
    .map((table, tableIndex) => normalizeTable(table, tableIndex))
    .filter((table): table is UnknownRecord => table !== null);

  return normalized;
}

function normalizeDelta(delta: unknown): UnknownRecord | null {
  if (!isRecord(delta)) return null;

  const normalized: UnknownRecord = { ...delta };

  const rawValue = normalized.value;
  const numericValue =
    typeof rawValue === 'number'
      ? rawValue
      : (typeof rawValue === 'string' && rawValue.trim() !== '' && !Number.isNaN(Number(rawValue)) ? Number(rawValue) : null);

  if (numericValue === null) return null;

  normalized.value = numericValue;

  if (normalized.direction !== 'up' && normalized.direction !== 'down' && normalized.direction !== 'flat') {
    normalized.direction = numericValue > 0 ? 'up' : numericValue < 0 ? 'down' : 'flat';
  }

  normalized.label =
    typeof normalized.label === 'string'
      ? normalized.label
      : `${numericValue > 0 ? '+' : ''}${numericValue}`;

  normalized.favorable = typeof normalized.favorable === 'boolean' ? normalized.favorable : normalized.direction !== 'down';

  return normalized;
}

function normalizeKeyMetric(metric: unknown, index: number): UnknownRecord | null {
  if (!isRecord(metric)) return null;

  const normalized: UnknownRecord = { ...metric };
  normalized.id = typeof normalized.id === 'string' ? normalized.id : `metric_${index + 1}`;
  normalized.label = typeof normalized.label === 'string' ? normalized.label : `Metric ${index + 1}`;

  if (typeof normalized.value !== 'number' && typeof normalized.value !== 'string') {
    return null;
  }

  normalized.format =
    normalized.format === 'number' ||
    normalized.format === 'currency' ||
    normalized.format === 'percent' ||
    normalized.format === 'text'
      ? normalized.format
      : 'text';

  if (
    normalized.format === 'number' &&
    typeof normalized.label === 'string' &&
    typeof normalized.value === 'number' &&
    isAumLikeLabel(normalized.label)
  ) {
    normalized.format = 'currency';
  }

  const delta = normalizeDelta(normalized.delta);
  if (delta) {
    normalized.delta = delta;
  } else {
    delete normalized.delta;
  }

  return normalized;
}

function normalizeRecommendation(recommendation: unknown, index: number): UnknownRecord | null {
  if (!isRecord(recommendation)) return null;

  const normalized: UnknownRecord = { ...recommendation };
  normalized.id = typeof normalized.id === 'string' ? normalized.id : `recommendation_${index + 1}`;
  normalized.priority =
    normalized.priority === 'high' || normalized.priority === 'medium' || normalized.priority === 'low'
      ? normalized.priority
      : 'medium';
  normalized.category =
    normalized.category === 'source-allocation' ||
    normalized.category === 'sga-coaching' ||
    normalized.category === 'process' ||
    normalized.category === 'positioning' ||
    normalized.category === 'product' ||
    normalized.category === 'monitoring'
      ? normalized.category
      : 'monitoring';
  normalized.title = typeof normalized.title === 'string' ? normalized.title : `Recommendation ${index + 1}`;
  normalized.rationale =
    typeof normalized.rationale === 'string'
      ? normalized.rationale
      : (typeof normalized.title === 'string' ? normalized.title : 'Additional follow-up is needed to support this recommendation.');
  if (typeof normalized.expectedImpact !== 'string') {
    delete normalized.expectedImpact;
  }
  normalized.timeframe =
    normalized.timeframe === 'immediate' || normalized.timeframe === 'this-quarter' || normalized.timeframe === 'next-quarter'
      ? normalized.timeframe
      : 'this-quarter';

  return normalized;
}

export function normalizeReportOutput(raw: unknown, reportType: string): unknown {
  if (!isRecord(raw)) return raw;

  const normalized: UnknownRecord = { ...raw };
  normalized.title = typeof normalized.title === 'string' ? normalized.title : `${reportType} report`;
  normalized.reportType = typeof normalized.reportType === 'string' ? normalized.reportType : reportType;
  normalized.generatedAt = typeof normalized.generatedAt === 'string' ? normalized.generatedAt : new Date().toISOString();
  normalized.executiveSummary = typeof normalized.executiveSummary === 'string' ? normalized.executiveSummary : '';
  normalized.keyMetrics = (Array.isArray(normalized.keyMetrics) ? normalized.keyMetrics : [])
    .map((metric, metricIndex) => normalizeKeyMetric(metric, metricIndex))
    .filter((metric): metric is UnknownRecord => metric !== null);
  normalized.recommendations = (Array.isArray(normalized.recommendations) ? normalized.recommendations : [])
    .map((recommendation, recommendationIndex) => normalizeRecommendation(recommendation, recommendationIndex))
    .filter((recommendation): recommendation is UnknownRecord => recommendation !== null);

  const sections = Array.isArray(normalized.sections) ? normalized.sections : [];
  normalized.sections = sections
    .map(normalizeSection)
    .filter((section): section is UnknownRecord => section !== null);

  return normalized as unknown as ReportOutput;
}
