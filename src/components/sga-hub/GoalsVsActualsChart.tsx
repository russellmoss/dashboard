'use client';

import { useState, useMemo } from 'react';
import { Card } from '@tremor/react';
import { useTheme } from 'next-themes';
import { CHART_COLORS } from '@/config/theme';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

interface MetricConfig {
  key: string;
  label: string;
  goalColor: string;
  actualColor: string;
  defaultVisible?: boolean;
}

interface GoalsVsActualsChartProps {
  title: string;
  data: Array<{
    weekLabel: string;
    weekStartDate: string;
    [metricKey: string]: number | string | null;
  }>;
  metrics: MetricConfig[];
}

const WEEK_RANGE_OPTIONS = [
  { label: '4 Weeks', weeks: 4 },
  { label: '8 Weeks', weeks: 8 },
  { label: '12 Weeks', weeks: 12 },
  { label: 'Custom', weeks: -1 },
];

export function GoalsVsActualsChart({ title, data, metrics }: GoalsVsActualsChartProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const [visibleMetrics, setVisibleMetrics] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    metrics.forEach(m => {
      if (m.defaultVisible !== false) initial.add(m.key);
    });
    return initial;
  });

  const [rangeWeeks, setRangeWeeks] = useState(12);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const filteredData = useMemo(() => {
    if (rangeWeeks === -1) {
      // Custom range
      return data.filter(d => {
        if (customStart && d.weekStartDate < customStart) return false;
        if (customEnd && d.weekStartDate > customEnd) return false;
        return true;
      });
    }
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - rangeWeeks * 7);
    const cutoffISO = cutoff.toISOString().split('T')[0];
    return data.filter(d => d.weekStartDate >= cutoffISO);
  }, [data, rangeWeeks, customStart, customEnd]);

  const toggleMetric = (key: string) => {
    setVisibleMetrics(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  if (filteredData.length === 0) {
    return (
      <Card className="dark:bg-gray-800 dark:border-gray-700">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">{title}</h3>
        <div className="h-48 flex items-center justify-center text-gray-400 dark:text-gray-500 text-sm">
          No data available for selected range
        </div>
      </Card>
    );
  }

  return (
    <Card className="dark:bg-gray-800 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h3>
        <div className="flex items-center gap-2">
          <select
            value={rangeWeeks}
            onChange={(e) => setRangeWeeks(Number(e.target.value))}
            className="text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300"
          >
            {WEEK_RANGE_OPTIONS.map(opt => (
              <option key={opt.weeks} value={opt.weeks}>{opt.label}</option>
            ))}
          </select>
          {rangeWeeks === -1 && (
            <>
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300"
              />
              <span className="text-xs text-gray-400">to</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300"
              />
            </>
          )}
        </div>
      </div>

      {/* Metric toggles */}
      <div className="flex flex-wrap gap-2 mb-4">
        {metrics.map(m => (
          <button
            key={m.key}
            onClick={() => toggleMetric(m.key)}
            className={`text-xs px-2 py-1 rounded border transition-colors ${
              visibleMetrics.has(m.key)
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                : 'border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={filteredData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={isDark ? '#374151' : CHART_COLORS.grid}
              vertical={false}
            />
            <XAxis
              dataKey="weekLabel"
              tick={{ fontSize: 10, fill: isDark ? '#9ca3af' : CHART_COLORS.axis }}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 11, fill: isDark ? '#9ca3af' : CHART_COLORS.axis }}
              tickLine={false}
              allowDecimals={false}
            />
            <RechartsTooltip
              contentStyle={{
                backgroundColor: isDark ? '#1f2937' : '#fff',
                border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
                borderRadius: '8px',
                fontSize: '12px',
                color: isDark ? '#f9fafb' : '#111827',
              }}
            />
            <Legend
              wrapperStyle={{ paddingTop: '8px', fontSize: '12px' }}
            />
            {metrics.map(m => {
              if (!visibleMetrics.has(m.key)) return null;
              return [
                <Line
                  key={`${m.key}Actual`}
                  type="monotone"
                  dataKey={`${m.key}Actual`}
                  name={`${m.label} (Actual)`}
                  stroke={m.actualColor}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls={false}
                />,
                <Line
                  key={`${m.key}Goal`}
                  type="monotone"
                  dataKey={`${m.key}Goal`}
                  name={`${m.label} (Goal)`}
                  stroke={m.goalColor}
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  dot={false}
                  connectNulls={false}
                />,
              ];
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
