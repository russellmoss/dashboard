// src/components/sga-hub/QuarterlyProgressChart.tsx

'use client';

import { Card, Title, Text } from '@tremor/react';
import { useTheme } from 'next-themes';
import { CHART_COLORS } from '@/config/theme';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { QuarterlyProgress } from '@/types/sga-hub';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

interface QuarterlyProgressChartProps {
  progressData: QuarterlyProgress[];
  isLoading?: boolean;
}

/**
 * Transform quarterly progress data for chart display
 * Sort from oldest (left) to newest (right)
 */
function transformChartData(progressData: QuarterlyProgress[]) {
  // Sort by quarter string (e.g., "2024-Q1" < "2024-Q2" < "2025-Q1")
  const sorted = [...progressData].sort((a, b) => {
    return a.quarter.localeCompare(b.quarter);
  });
  
  return sorted.map(p => ({
    quarter: p.quarter,
    quarterLabel: p.quarterLabel,
    actual: p.sqoActual,
    goal: p.sqoGoal || 0,
    hasGoal: p.hasGoal,
  }));
}

export function QuarterlyProgressChart({
  progressData,
  isLoading = false,
}: QuarterlyProgressChartProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const chartData = transformChartData(progressData);

  // Check if any quarter has a goal (for showing goal line)
  const hasAnyGoal = progressData.some(p => p.hasGoal);

  if (isLoading) {
    return (
      <Card className="mb-6 dark:bg-gray-800 dark:border-gray-700">
        <div className="h-80 bg-gray-200 dark:bg-gray-700 rounded animate-pulse flex items-center justify-center">
          <LoadingSpinner />
        </div>
      </Card>
    );
  }

  if (chartData.length === 0) {
    return (
      <Card className="mb-6 dark:bg-gray-800 dark:border-gray-700">
        <Title className="dark:text-white mb-4">Historical Quarterly Progress</Title>
        <div className="h-80 flex items-center justify-center text-gray-500 dark:text-gray-400">
          No data available
        </div>
      </Card>
    );
  }

  return (
    <Card className="mb-6 dark:bg-gray-800 dark:border-gray-700">
      <div className="mb-4">
        <Title className="dark:text-white">Historical Quarterly Progress</Title>
        <Text className="text-gray-500 dark:text-gray-400 text-sm mt-1">
          SQO counts by quarter with goal overlay (if set)
        </Text>
      </div>

      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            margin={{ top: 25, right: 30, left: 20, bottom: 5 }}
            barCategoryGap="20%"
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={CHART_COLORS.grid}
              vertical={false}
              className="dark:stroke-gray-700"
            />
            <XAxis
              dataKey="quarterLabel"
              tick={{ fontSize: 12, fill: CHART_COLORS.axis }}
              tickLine={{ stroke: CHART_COLORS.grid }}
              className="dark:[&_text]:fill-gray-400 dark:[&_line]:stroke-gray-700"
            />
            <YAxis
              tick={{ fontSize: 12, fill: CHART_COLORS.axis }}
              tickLine={{ stroke: CHART_COLORS.grid }}
              tickFormatter={(value) => value.toLocaleString()}
              domain={['auto', 'auto']}
              className="dark:[&_text]:fill-gray-400 dark:[&_line]:stroke-gray-700"
            />
            <RechartsTooltip
              contentStyle={{
                backgroundColor: isDark ? '#1f2937' : '#fff',
                border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
                borderRadius: '8px',
                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                color: isDark ? '#f9fafb' : '#111827',
              }}
              formatter={(value: number | undefined, name: string | undefined) => [
                value?.toLocaleString() || 0,
                name === 'actual' ? 'Actual SQOs' : name === 'goal' ? 'Goal' : name || '',
              ]}
              labelStyle={{
                fontWeight: 600,
                marginBottom: '4px',
                color: isDark ? '#f9fafb' : '#111827',
              }}
              itemStyle={{
                color: isDark ? '#f9fafb' : '#111827',
              }}
            />
            <Legend
              wrapperStyle={{
                paddingTop: '20px',
                color: isDark ? '#9ca3af' : '#4b5563',
              }}
            />
            {/* Actual SQOs Bar */}
            <Bar
              dataKey="actual"
              name="Actual SQOs"
              fill={CHART_COLORS.sqoToJoined}
              radius={[4, 4, 0, 0]}
              maxBarSize={60}
            />
            {/* Goal Line (if any quarter has a goal) */}
            {hasAnyGoal && (
              <Bar
                dataKey="goal"
                name="Goal"
                fill={CHART_COLORS.primary}
                radius={[4, 4, 0, 0]}
                maxBarSize={60}
                opacity={0.6}
              />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Legend Explanation */}
      <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
        <Text className="text-xs text-gray-500 dark:text-gray-400">
          <strong>Note:</strong> Shows actual SQO counts by quarter. Goal bars are shown when a
          quarterly goal is set. Bars are grouped by quarter for easy comparison.
        </Text>
      </div>
    </Card>
  );
}
