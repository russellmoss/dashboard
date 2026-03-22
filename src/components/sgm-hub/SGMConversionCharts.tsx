'use client';

import React, { useMemo } from 'react';
import { useTheme } from 'next-themes';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
  LabelList,
} from 'recharts';
import { SGMConversionTrend } from '@/types/sgm-hub';
import { SGMQuarterSelector } from './SGMQuarterSelector';

interface SGMConversionChartsProps {
  data: SGMConversionTrend[];
  loading: boolean;
  quarterCount: number;
  onQuarterCountChange: (n: number) => void;
  onVolumeBarClick?: (quarter: string, metric: 'sql' | 'sqo' | 'joined') => void;
}

const COLORS = {
  sqlToSqo: '#3B82F6',    // blue
  sqoToJoined: '#10B981',  // green
  sqls: '#3B82F6',         // blue
  sqos: '#F59E0B',         // amber
  joined: '#10B981',       // green
};

// Custom tooltip for rate chart
function RateTooltip({ active, payload, label }: any) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3">
      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">{label}</p>
      {payload.map((entry: any) => (
        <p key={entry.dataKey} className="text-sm" style={{ color: entry.color }}>
          {entry.name}: {(entry.value * 100).toFixed(1)}%
        </p>
      ))}
    </div>
  );
}

// Custom tooltip for volume chart
function VolumeTooltip({ active, payload, label }: any) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3">
      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">{label}</p>
      {payload.map((entry: any) => (
        <p key={entry.dataKey} className="text-sm" style={{ color: entry.color }}>
          {entry.name}: {entry.value.toLocaleString()}
        </p>
      ))}
    </div>
  );
}

// Custom label renderer for bar values
function renderBarLabel(isDark: boolean) {
  return (props: any) => {
    const { x = 0, y = 0, width = 0, value } = props;
    if (!value || value === 0) return null;
    return (
      <text
        x={x + width / 2}
        y={y - 6}
        fill={isDark ? '#f9fafb' : '#111827'}
        textAnchor="middle"
        fontSize={11}
        fontWeight={500}
      >
        {value.toLocaleString()}
      </text>
    );
  };
}

export function SGMConversionCharts({
  data,
  loading,
  quarterCount,
  onQuarterCountChange,
  onVolumeBarClick,
}: SGMConversionChartsProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  // Slice to last N quarters
  const chartData = useMemo(() => {
    if (data.length <= quarterCount) return data;
    return data.slice(data.length - quarterCount);
  }, [data, quarterCount]);

  const gridColor = isDark ? '#374151' : '#E5E7EB';
  const axisColor = isDark ? '#9CA3AF' : '#6B7280';

  if (loading) {
    return (
      <div>
        <div className="flex justify-end mb-4">
          <SGMQuarterSelector quarterCount={quarterCount} onQuarterCountChange={onQuarterCountChange} />
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="h-[350px] animate-pulse bg-gray-100 dark:bg-gray-700 rounded-lg" />
          <div className="h-[350px] animate-pulse bg-gray-100 dark:bg-gray-700 rounded-lg" />
        </div>
      </div>
    );
  }

  if (!chartData || chartData.length === 0) {
    return (
      <div>
        <div className="flex justify-end mb-4">
          <SGMQuarterSelector quarterCount={quarterCount} onQuarterCountChange={onQuarterCountChange} />
        </div>
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          No conversion data available
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-end mb-4">
        <SGMQuarterSelector quarterCount={quarterCount} onQuarterCountChange={onQuarterCountChange} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Chart 1: Conversion Rate Trend */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-4">
            Conversion Rate Trend
          </h3>
          <ResponsiveContainer width="100%" height={350}>
            <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
              <XAxis
                dataKey="quarter"
                tick={{ fill: axisColor, fontSize: 12 }}
                tickLine={{ stroke: axisColor }}
              />
              <YAxis
                tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                tick={{ fill: axisColor, fontSize: 12 }}
                tickLine={{ stroke: axisColor }}
              />
              <RechartsTooltip content={<RateTooltip />} />
              <Legend />
              <Line
                type="monotone"
                dataKey="sqlToSqoRate"
                name="SQL→SQO%"
                stroke={COLORS.sqlToSqo}
                strokeWidth={2}
                dot={{ r: 4, fill: COLORS.sqlToSqo }}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="sqoToJoinedRate"
                name="SQO→Joined%"
                stroke={COLORS.sqoToJoined}
                strokeWidth={2}
                dot={{ r: 4, fill: COLORS.sqoToJoined }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Chart 2: Conversion Volume Trend */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-4">
            Conversion Volume Trend
          </h3>
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={chartData} margin={{ top: 20, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
              <XAxis
                dataKey="quarter"
                tick={{ fill: axisColor, fontSize: 12 }}
                tickLine={{ stroke: axisColor }}
              />
              <YAxis
                tick={{ fill: axisColor, fontSize: 12 }}
                tickLine={{ stroke: axisColor }}
              />
              <RechartsTooltip content={<VolumeTooltip />} />
              <Legend iconType="square" content={({ payload }) => {
                // Force order: SQLs → SQOs → Joined
                const order = ['SQLs', 'SQOs', 'Joined'];
                const sorted = order
                  .map(name => (payload || []).find((p: any) => p.value === name))
                  .filter(Boolean);
                return (
                  <div className="flex justify-center gap-4 mt-2">
                    {sorted.map((entry: any) => (
                      <div key={entry.value} className="flex items-center gap-1.5">
                        <div className="w-3 h-3" style={{ backgroundColor: entry.color }} />
                        <span className="text-sm text-gray-600 dark:text-gray-400">{entry.value}</span>
                      </div>
                    ))}
                  </div>
                );
              }} />
              <Bar
                dataKey="sqlCount"
                name="SQLs"
                fill={COLORS.sqls}
                isAnimationActive={false}
                cursor="pointer"
                onClick={(data: any) => onVolumeBarClick?.(data.quarter, 'sql')}
              >
                <LabelList content={renderBarLabel(isDark)} />
              </Bar>
              <Bar
                dataKey="sqoCount"
                name="SQOs"
                fill={COLORS.sqos}
                isAnimationActive={false}
                cursor="pointer"
                onClick={(data: any) => onVolumeBarClick?.(data.quarter, 'sqo')}
              >
                <LabelList content={renderBarLabel(isDark)} />
              </Bar>
              <Bar
                dataKey="joinedCount"
                name="Joined"
                fill={COLORS.joined}
                isAnimationActive={false}
                cursor="pointer"
                onClick={(data: any) => onVolumeBarClick?.(data.quarter, 'joined')}
              >
                <LabelList content={renderBarLabel(isDark)} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
