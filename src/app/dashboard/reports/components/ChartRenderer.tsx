'use client';

import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  BarChartSpec,
  ChartSpec,
  ComposedChartSpec,
  LineChartSpec,
  PieChartSpec,
} from '@/types/reporting';
import { formatReportingValue, isAumLike, isPercentLike } from './formatting';

const COLORS = [
  '#6366f1',
  '#22c55e',
  '#f59e0b',
  '#ef4444',
  '#06b6d4',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
];

type TooltipPayloadItem = {
  color?: string;
  dataKey?: string | number;
  name?: string;
  value?: unknown;
  payload?: Record<string, unknown>;
};

function getSeriesHint(title: string, label?: string, key?: string | number) {
  return [title, label, typeof key === 'string' ? key : ''].filter(Boolean).join(' ');
}

function CustomChartTooltip({
  active,
  payload,
  label,
  title,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string | number;
  title: string;
}) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-background/95 px-3 py-2 shadow-lg">
      <div className="text-sm font-semibold text-foreground">{label ?? title}</div>
      <div className="mt-2 space-y-1">
        {payload.map((entry, index) => {
          const hint = getSeriesHint(title, entry.name, entry.dataKey);
          return (
            <div key={`${entry.name ?? entry.dataKey ?? index}`} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: entry.color ?? '#94a3b8' }}
                />
                <span>{entry.name ?? entry.dataKey ?? 'Value'}</span>
              </div>
              <div className="text-xs font-medium text-foreground">
                {formatReportingValue(entry.value, undefined, hint)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function getAxisTickFormatter(labels: string[]) {
  const axisHint = labels.join(' ').trim();
  if (!axisHint) return undefined;

  if (isAumLike(axisHint)) {
    return (value: number) => formatReportingValue(value, 'currency', axisHint);
  }

  if (isPercentLike(axisHint)) {
    return (value: number) => formatReportingValue(value, 'percent', axisHint);
  }

  return undefined;
}

export function ChartRenderer({ spec }: { spec: ChartSpec }) {
  switch (spec.type) {
    case 'bar':
      return <BarChartComponent spec={spec} />;
    case 'line':
      return <LineChartComponent spec={spec} />;
    case 'pie':
      return <PieChartComponent spec={spec} />;
    case 'composed':
      return <ComposedChartComponent spec={spec} />;
    default:
      return null;
  }
}

function BarChartComponent({ spec }: { spec: BarChartSpec }) {
  const tickFormatter = getAxisTickFormatter(spec.yKeys.map(y => y.label));

  return (
    <div className="my-6">
      <h4 className="text-sm font-medium text-muted-foreground mb-2">{spec.title}</h4>
      {spec.subtitle && <p className="text-xs text-muted-foreground mb-3">{spec.subtitle}</p>}
      <ResponsiveContainer width="100%" height={spec.height ?? 350}>
        <BarChart
          data={spec.data}
          layout={spec.layout === 'horizontal' ? 'vertical' : 'horizontal'}
          margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          {spec.layout === 'horizontal' ? (
            <>
              <XAxis type="number" tick={{ fontSize: 12, fill: '#94a3b8' }} tickFormatter={tickFormatter} />
              <YAxis dataKey={spec.xKey} type="category" tick={{ fontSize: 12, fill: '#94a3b8' }} width={160} />
            </>
          ) : (
            <>
              <XAxis dataKey={spec.xKey} tick={{ fontSize: 12, fill: '#94a3b8' }} />
              <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} tickFormatter={tickFormatter} />
            </>
          )}
          <Tooltip content={<CustomChartTooltip title={spec.title} />} />
          <Legend />
          {spec.yKeys.map((y, i) => (
            <Bar
              key={y.key}
              dataKey={y.key}
              name={y.label}
              fill={y.color ?? COLORS[i % COLORS.length]}
              stackId={y.stackId}
              isAnimationActive={false}
            >
              {spec.showValues && (
                <LabelList
                  dataKey={y.key}
                  position="top"
                  fontSize={11}
                  fill="#94a3b8"
                  formatter={(value: unknown) => formatReportingValue(value, undefined, getSeriesHint(spec.title, y.label, y.key))}
                />
              )}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function LineChartComponent({ spec }: { spec: LineChartSpec }) {
  const tickFormatter = getAxisTickFormatter(spec.yKeys.map(y => y.label));

  return (
    <div className="my-6">
      <h4 className="text-sm font-medium text-muted-foreground mb-2">{spec.title}</h4>
      {spec.subtitle && <p className="text-xs text-muted-foreground mb-3">{spec.subtitle}</p>}
      <ResponsiveContainer width="100%" height={spec.height ?? 350}>
        <LineChart data={spec.data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey={spec.xKey} tick={{ fontSize: 12, fill: '#94a3b8' }} />
          <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} tickFormatter={tickFormatter} />
          <Tooltip content={<CustomChartTooltip title={spec.title} />} />
          <Legend />
          {spec.yKeys.map((y, i) => (
            <Line
              key={y.key}
              type="monotone"
              dataKey={y.key}
              name={y.label}
              stroke={y.color ?? COLORS[i % COLORS.length]}
              strokeDasharray={y.strokeDasharray}
              dot={spec.showDots ?? false}
              isAnimationActive={false}
            />
          ))}
          {spec.referenceLines?.map((rl, i) => (
            <ReferenceLine
              key={i}
              y={rl.y}
              label={rl.label}
              stroke={rl.color}
              strokeDasharray="3 3"
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function PieChartComponent({ spec }: { spec: PieChartSpec }) {
  return (
    <div className="my-6">
      <h4 className="text-sm font-medium text-muted-foreground mb-2">{spec.title}</h4>
      {spec.subtitle && <p className="text-xs text-muted-foreground mb-3">{spec.subtitle}</p>}
      <ResponsiveContainer width="100%" height={spec.height ?? 350}>
        <PieChart>
          <Pie
            data={spec.data}
            cx="50%"
            cy="50%"
            innerRadius={spec.innerRadius ?? 0}
            outerRadius={120}
            dataKey="value"
            nameKey="name"
            label={({ name, percent }: { name?: string; percent?: number }) => `${name ?? ''} ${((percent ?? 0) * 100).toFixed(0)}%`}
            isAnimationActive={false}
          >
            {spec.data.map((entry, i) => (
              <Cell key={i} fill={entry.color ?? COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip content={<CustomChartTooltip title={spec.title} />} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function ComposedChartComponent({ spec }: { spec: ComposedChartSpec }) {
  const leftSeries = spec.series.filter(s => (s.yAxisId ?? 'left') === 'left');
  const rightSeries = spec.series.filter(s => s.yAxisId === 'right');
  const leftLabel = leftSeries[0]?.label;
  const rightLabel = spec.dualAxis ? rightSeries[0]?.label : undefined;
  const leftTickFormatter = getAxisTickFormatter(leftSeries.map(series => series.label));
  const rightTickFormatter = getAxisTickFormatter(rightSeries.map(series => series.label));

  return (
    <div className="my-6">
      <h4 className="text-sm font-medium text-muted-foreground mb-2">{spec.title}</h4>
      {spec.subtitle && <p className="text-xs text-muted-foreground mb-3">{spec.subtitle}</p>}
      <ResponsiveContainer width="100%" height={spec.height ?? 350}>
        <ComposedChart data={spec.data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey={spec.xKey} tick={{ fontSize: 12, fill: '#94a3b8' }} />
          <YAxis
            yAxisId="left"
            tick={{ fontSize: 12, fill: '#94a3b8' }}
            tickFormatter={leftTickFormatter}
            label={leftLabel ? { value: leftLabel, angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 12, offset: 0, style: { textAnchor: 'middle' } } : undefined}
          />
          {spec.dualAxis && (
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fontSize: 12, fill: '#94a3b8' }}
              tickFormatter={rightTickFormatter}
              label={rightLabel ? { value: rightLabel, angle: -90, position: 'insideRight', fill: '#94a3b8', fontSize: 12, offset: 0, style: { textAnchor: 'middle' } } : undefined}
            />
          )}
          <Tooltip content={<CustomChartTooltip title={spec.title} />} />
          <Legend />
          {spec.series.map((s, i) => {
            const color = s.color ?? COLORS[i % COLORS.length];
            const axisId = s.yAxisId ?? 'left';
            switch (s.chartType) {
              case 'bar':
                return (
                  <Bar
                    key={s.key}
                    dataKey={s.key}
                    name={s.label}
                    fill={color}
                    yAxisId={axisId}
                    isAnimationActive={false}
                  />
                );
              case 'line':
                return (
                  <Line
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    name={s.label}
                    stroke={color}
                    yAxisId={axisId}
                    isAnimationActive={false}
                  />
                );
              case 'area':
                return (
                  <Area
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    name={s.label}
                    fill={color}
                    stroke={color}
                    fillOpacity={0.3}
                    yAxisId={axisId}
                    isAnimationActive={false}
                  />
                );
              default:
                return null;
            }
          })}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
