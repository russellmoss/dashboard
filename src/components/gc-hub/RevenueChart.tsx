// src/components/gc-hub/RevenueChart.tsx

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
  Legend,
  ResponsiveContainer,
} from 'recharts';

interface SummaryDataPoint {
  period: string;
  periodStart: string;
  totalRevenue: number;
  totalAmountEarned: number;
}

interface RevenueChartProps {
  data: SummaryDataPoint[];
  isLoading?: boolean;
}

export function RevenueChart({ data, isLoading = false }: RevenueChartProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  if (isLoading) {
    return (
      <Card className="dark:bg-gray-800 dark:border-gray-700">
        <div className="h-80 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
      </Card>
    );
  }

  if (data.length === 0) {
    return (
      <Card className="dark:bg-gray-800 dark:border-gray-700">
        <Title className="dark:text-white">Revenue & Amount Earned</Title>
        <div className="h-80 flex items-center justify-center text-gray-500 dark:text-gray-400">
          No data available for the selected range
        </div>
      </Card>
    );
  }

  // Sort by date and format for chart
  const chartData = [...data]
    .sort((a, b) => new Date(a.periodStart).getTime() - new Date(b.periodStart).getTime())
    .map((d) => ({
      period: formatPeriodLabel(d.period),
      Revenue: d.totalRevenue,
      'Amount Earned': d.totalAmountEarned,
    }));

  return (
    <Card className="dark:bg-gray-800 dark:border-gray-700">
      <div className="mb-4">
        <Title className="dark:text-white">Revenue & Amount Earned</Title>
        <Text className="text-gray-500 dark:text-gray-400 text-sm mt-1">
          Gross revenue vs net amount earned (revenue minus commissions) by period
        </Text>
      </div>

      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartData}
            margin={{ top: 10, right: 30, left: 20, bottom: 5 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={isDark ? CHART_COLORS.gridDark : CHART_COLORS.grid}
              vertical={false}
            />
            <XAxis
              dataKey="period"
              tick={{ fontSize: 11, fill: CHART_COLORS.axis }}
              tickLine={{ stroke: isDark ? CHART_COLORS.gridDark : CHART_COLORS.grid }}
              angle={-45}
              textAnchor="end"
              height={60}
              className="dark:[&_text]:fill-gray-400"
            />
            <YAxis
              tick={{ fontSize: 11, fill: CHART_COLORS.axis }}
              tickLine={{ stroke: isDark ? CHART_COLORS.gridDark : CHART_COLORS.grid }}
              tickFormatter={(value) => formatCurrency(value, true)}
              className="dark:[&_text]:fill-gray-400"
            />
            <RechartsTooltip
              contentStyle={{
                backgroundColor: isDark ? '#1f2937' : '#fff',
                border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
                borderRadius: '8px',
                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                color: isDark ? '#f9fafb' : '#111827',
              }}
              formatter={(value) => [formatCurrency(value as number), '']}
              labelStyle={{
                fontWeight: 600,
                marginBottom: '4px',
                color: isDark ? '#f9fafb' : '#111827',
              }}
            />
            <Legend
              wrapperStyle={{ color: isDark ? '#d1d5db' : '#374151' }}
            />
            <Line
              type="monotone"
              dataKey="Revenue"
              stroke={GC_CHART_COLORS.revenue}
              strokeWidth={2.5}
              dot={{ r: 4, fill: GC_CHART_COLORS.revenue }}
              activeDot={{ r: 6 }}
            />
            <Line
              type="monotone"
              dataKey="Amount Earned"
              stroke={GC_CHART_COLORS.amountEarned}
              strokeWidth={2.5}
              dot={{ r: 4, fill: GC_CHART_COLORS.amountEarned }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
