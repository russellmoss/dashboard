// packages/analyst-bot/src/charts.ts
// ============================================================================
// Chart PNG generation using chartjs-node-canvas
// ============================================================================

import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import { ChartConfiguration } from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { ChartRequest } from './types';

// Color palette — consistent across all charts in a conversation
const COLORS = [
  '#4F46E5', // indigo
  '#059669', // emerald
  '#D97706', // amber
  '#DC2626', // red
  '#7C3AED', // violet
  '#0891B2', // cyan
  '#C2410C', // orange
  '#6D28D9', // purple
];

const COLORS_50 = [
  'rgba(79, 70, 229, 0.5)',
  'rgba(5, 150, 105, 0.5)',
  'rgba(217, 119, 6, 0.5)',
  'rgba(220, 38, 38, 0.5)',
  'rgba(124, 58, 237, 0.5)',
  'rgba(8, 145, 178, 0.5)',
  'rgba(194, 65, 12, 0.5)',
  'rgba(109, 40, 217, 0.5)',
];

// Single global renderer instance for memory efficiency
let renderer: ChartJSNodeCanvas | null = null;

function getRenderer(): ChartJSNodeCanvas {
  if (!renderer) {
    renderer = new ChartJSNodeCanvas({
      width: 800,
      height: 500,
      backgroundColour: 'white',
      plugins: {
        modern: ['chartjs-plugin-datalabels'],
      },
      chartCallback: (ChartJS: any) => {
        ChartJS.defaults.font.family = 'Arial, Helvetica, sans-serif';
        ChartJS.defaults.font.size = 12;
        ChartJS.register(ChartDataLabels);
      },
    });
  }
  return renderer;
}

/**
 * Parse a [CHART]...[/CHART] block from Claude's response text.
 * Returns null if no chart block found or JSON is malformed.
 */
export function parseChartBlock(text: string): ChartRequest | null {
  const match = text.match(/\[CHART\]\s*([\s\S]*?)\s*\[\/CHART\]/);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[1]);
    if (!parsed.type || !parsed.labels || !parsed.datasets) {
      console.error('[charts] Invalid chart block: missing required fields');
      return null;
    }
    return parsed as ChartRequest;
  } catch (err) {
    console.error('[charts] Failed to parse chart JSON:', (err as Error).message);
    return null;
  }
}

/**
 * Strip [CHART]...[/CHART] blocks from text for clean display.
 */
export function stripChartBlocks(text: string): string {
  return text.replace(/\[CHART\]\s*[\s\S]*?\s*\[\/CHART\]/g, '').trim();
}

/**
 * Render a chart request to a PNG buffer.
 * Maps our ChartType aliases to Chart.js configuration.
 */
export async function renderChart(req: ChartRequest): Promise<Buffer> {
  const config = buildChartConfig(req);
  const r = getRenderer();
  return await r.renderToBuffer(config as any);
}

/**
 * Build a Chart.js configuration from our ChartRequest.
 * Handles type mapping:
 *   - "horizontalBar" -> "bar" + indexAxis: "y"
 *   - "stackedBar" -> "bar" + stacked scales
 *   - "pie"/"doughnut" with >6 categories -> fallback to "bar"
 */
function buildChartConfig(req: ChartRequest): ChartConfiguration {
  let chartType: string = req.type;
  let indexAxis: 'x' | 'y' = 'x';
  let stacked = false;

  // Map convenience aliases
  if (chartType === 'horizontalBar') {
    chartType = 'bar';
    indexAxis = 'y';
  } else if (chartType === 'stackedBar') {
    chartType = 'bar';
    stacked = true;
  }

  // Pie/doughnut safety: >6 categories -> fallback to bar
  if ((chartType === 'pie' || chartType === 'doughnut') && req.labels.length > 6) {
    console.warn(`[charts] ${chartType} with ${req.labels.length} categories, falling back to bar`);
    chartType = 'bar';
  }

  const isPie = chartType === 'pie' || chartType === 'doughnut';

  // Build datasets
  const datasets = req.datasets.map((ds, i) => {
    const colorIndex = i % COLORS.length;
    if (isPie) {
      return {
        label: ds.label,
        data: ds.values,
        backgroundColor: req.labels.map((_, j) => COLORS[j % COLORS.length]),
        borderColor: req.labels.map((_, j) => COLORS[j % COLORS.length]),
        borderWidth: 1,
      };
    }
    return {
      label: ds.label,
      data: ds.values,
      backgroundColor: stacked ? COLORS_50[colorIndex] : COLORS[colorIndex],
      borderColor: COLORS[colorIndex],
      borderWidth: chartType === 'line' ? 2 : 1,
      ...(chartType === 'line' ? { fill: false, tension: 0.1 } : {}),
    };
  });

  // Derive axis labels — only for non-stacked charts (stacked has multiple
  // datasets so the auto-derived label from datasets[0] is wrong)
  const isHorizontal = indexAxis === 'y';
  const valueLabel = !stacked ? (req.options?.yAxisLabel ?? req.datasets[0]?.label ?? '') : '';
  const categoryLabel = req.options?.xAxisLabel ?? '';

  // Build scales (not used for pie/doughnut)
  const scales: any = {};
  if (!isPie) {
    scales.x = {
      ...(stacked ? { stacked: true } : {}),
      grid: { color: 'rgba(0,0,0,0.06)' },
      ticks: { maxRotation: 45, autoSkip: true },
      ...((!stacked && (isHorizontal ? valueLabel : categoryLabel))
        ? { title: { display: true, text: isHorizontal ? valueLabel : categoryLabel, font: { size: 12 } } }
        : {}),
    };
    scales.y = {
      ...(stacked ? { stacked: true } : {}),
      grid: { color: 'rgba(0,0,0,0.06)' },
      beginAtZero: true,
      ...((!stacked && (isHorizontal ? categoryLabel : valueLabel))
        ? { title: { display: true, text: isHorizontal ? categoryLabel : valueLabel, font: { size: 12 } } }
        : {}),
    };
  }

  // Data label plugin config:
  // - Regular bars/lines: show values above bars
  // - Stacked bars: OFF (labels overlap and look jumbled)
  // - Pie/doughnut: show label + percentage on each segment
  let datalabels: any;
  if (isPie) {
    datalabels = {
      display: true,
      color: '#fff',
      font: { size: 12, weight: 'bold' as const },
      textStrokeColor: 'rgba(0,0,0,0.5)',
      textStrokeWidth: 2,
      formatter: (value: number, ctx: any) => {
        const data: number[] = ctx.chart.data.datasets[0].data;
        const total = data.reduce((a: number, b: number) => a + b, 0);
        const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';
        const label = ctx.chart.data.labels?.[ctx.dataIndex] ?? '';
        // Hide label for very small slices (<3%) to avoid clutter
        if (total > 0 && (value / total) < 0.03) return '';
        return `${label}\n${pct}%`;
      },
    };
  } else if (stacked) {
    datalabels = { display: false };
  } else {
    datalabels = {
      display: true,
      anchor: isHorizontal ? 'end' : 'end',
      align: isHorizontal ? 'right' : 'top',
      font: { size: 11, weight: 'bold' as const },
      color: '#374151',
      formatter: (value: number) => {
        if (value >= 1_000_000) return (value / 1_000_000).toFixed(1) + 'M';
        if (value >= 1_000) return (value / 1_000).toFixed(1) + 'K';
        if (value % 1 !== 0) return value.toFixed(1);
        return String(value);
      },
    };
  }

  const config: ChartConfiguration = {
    type: chartType as any,
    data: {
      labels: req.labels,
      datasets: datasets as any,
    },
    options: {
      indexAxis: indexAxis as any,
      responsive: false,
      layout: {
        padding: { top: 20, right: 20 },
      },
      plugins: {
        title: {
          display: true,
          text: req.title,
          font: { size: 16, weight: 'bold' as const },
          padding: { bottom: 16 },
        },
        legend: {
          display: req.datasets.length > 1 || isPie,
          position: 'top' as const,
        },
        datalabels,
      },
      ...(isPie ? {} : { scales }),
    },
  };

  return config;
}
