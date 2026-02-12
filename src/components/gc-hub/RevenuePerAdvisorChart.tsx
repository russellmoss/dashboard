// src/components/gc-hub/RevenuePerAdvisorChart.tsx

'use client';

import { Card, Title, Text } from '@tremor/react';
import { useTheme } from 'next-themes';
import { CHART_COLORS } from '@/config/theme';
import { GC_CHART_COLORS } from '@/config/gc-hub-theme';
import { formatCurrency, formatPeriodLabel } from '@/lib/gc-hub/formatters';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from 'recharts';

interface RevenuePerAdvisorChartProps {
  data: { period: string; periodStart: string; revenuePerAdvisor: number }[];
  isLoading?: boolean;
}

export function RevenuePerAdvisorChart({ data, isLoading = false }: RevenuePerAdvisorChartProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  if (isLoading) {
    return (
      <Card className="dark:bg-gray-800 dark:border-gray-700">
        <div className="h-72 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
      </Card>
    );
  }

  if (data.length === 0) {
    return (
      <Card className="dark:bg-gray-800 dark:border-gray-700">
        <Title className="dark:text-white">Revenue Per Advisor</Title>
        <div className="h-72 flex items-center justify-center text-gray-500 dark:text-gray-400">
          No data available
        </div>
      </Card>
    );
  }

  const chartData = [...data]
    .sort((a, b) => new Date(a.periodStart).getTime() - new Date(b.periodStart).getTime())
    .map((d) => ({
      period: formatPeriodLabel(d.period),
      'Rev / Advisor': d.revenuePerAdvisor,
    }));

  return (
    <Card className="dark:bg-gray-800 dark:border-gray-700">
      <div className="mb-4">
        <Title className="dark:text-white">Revenue Per Advisor</Title>
        <Text className="text-gray-500 dark:text-gray-400 text-sm mt-1">
          Average revenue per active advisor — unit economics signal
        </Text>
      </div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 10, right: 20, left: 20, bottom: 5 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={isDark ? CHART_COLORS.gridDark : CHART_COLORS.grid}
              vertical={false}
            />
            <XAxis
              dataKey="period"
              tick={{ fontSize: 10, fill: CHART_COLORS.axis }}
              angle={-45}
              textAnchor="end"
              height={60}
              className="dark:[&_text]:fill-gray-400"
            />
            <YAxis
              tick={{ fontSize: 11, fill: CHART_COLORS.axis }}
              tickFormatter={(v) => formatCurrency(v, true)}
              className="dark:[&_text]:fill-gray-400"
            />
            <RechartsTooltip
              contentStyle={{
                backgroundColor: isDark ? '#1f2937' : '#fff',
                border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
                borderRadius: '8px',
                color: isDark ? '#f9fafb' : '#111827',
              }}
              formatter={(value) => [formatCurrency(value as number), '']}
            />
            <Line
              type="monotone"
              dataKey="Rev / Advisor"
              stroke={GC_CHART_COLORS.revenuePerAdvisor}
              strokeWidth={2.5}
              dot={{ r: 4, fill: GC_CHART_COLORS.revenuePerAdvisor }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
