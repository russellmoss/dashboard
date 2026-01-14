'use client';

import { Card, Title, Text } from '@tremor/react';
import { TrendDataPoint } from '@/types/dashboard';
import { useState } from 'react';
import { useTheme } from 'next-themes';
import { CHART_COLORS } from '@/config/theme';
import {
  BarChart,
  Bar,
  LabelList,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

// Info icon component for tooltips
const InfoIcon = ({ className = '' }: { className?: string }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    className={`h-4 w-4 text-gray-400 hover:text-gray-600 cursor-help ${className}`}
    fill="none" 
    viewBox="0 0 24 24" 
    stroke="currentColor"
  >
    <path 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      strokeWidth={2} 
      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" 
    />
  </svg>
);

interface VolumeTrendChartProps {
  trends: TrendDataPoint[];
  onGranularityChange?: (granularity: 'month' | 'quarter') => void;
  granularity?: 'month' | 'quarter';
  isLoading?: boolean;
}

export function VolumeTrendChart({ 
  trends, 
  onGranularityChange,
  granularity: granularityProp,
  isLoading = false,
}: VolumeTrendChartProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const [internalGranularity, setInternalGranularity] = useState<'month' | 'quarter'>('quarter');
  
  // Use prop if provided, otherwise use internal state
  const granularity = granularityProp ?? internalGranularity;
  
  const handleGranularityChange = (value: 'month' | 'quarter') => {
    setInternalGranularity(value);
    onGranularityChange?.(value);
  };

  // Transform data for volume display
  const chartData = trends.map(t => ({
    period: t.period,
    isSelectedPeriod: t.isSelectedPeriod || false,
    SQLs: Number(t.sqls) || 0,
    SQOs: Number(t.sqos) || 0,
    Joined: Number(t.joined) || 0,
  }));

  const volumeCategories = ['SQLs', 'SQOs', 'Joined']; // Order: SQLs → SQOs → Joined

  const VOLUME_COLORS: Record<string, string> = {
    'SQLs': CHART_COLORS.primary,
    'SQOs': CHART_COLORS.mqlToSql,
    'Joined': CHART_COLORS.sqoToJoined,
  };

  const formatValue = (value: number) => value.toLocaleString();

  // Custom label renderer for values above bars
  const renderBarLabel = (props: any) => {
    const { x = 0, y = 0, width = 0, value } = props;
    
    // Don't show label for zero or undefined values
    if (!value || value === 0) return null;
    
    const displayValue = Number(value).toLocaleString();
    const labelX = x + width / 2;
    const labelY = y - 8;
    
    return (
      <text
        x={labelX}
        y={labelY}
        fill={isDark ? '#f9fafb' : '#111827'}
        textAnchor="middle"
        fontSize={12}
        fontWeight={500}
      >
        {displayValue}
      </text>
    );
  };

  if (isLoading) {
    return (
      <Card className="mb-6">
        <div className="h-80 bg-gray-200 rounded animate-pulse" />
      </Card>
    );
  }

  return (
    <Card className="mb-6">
      {/* Header Section */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Title className="dark:text-white">Volume Trends</Title>
            <div className="relative group">
              <InfoIcon />
              {/* Tooltip */}
              <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-800 dark:bg-gray-700 text-white text-sm rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 pointer-events-none">
                Shows the count of SQLs, SQOs, and Advisors Joined that occurred within each time period
                <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-gray-800 dark:border-t-gray-700"></div>
              </div>
            </div>
          </div>
          <Text className="text-gray-500 dark:text-gray-400 text-sm mt-1">
            Shows the count of SQLs, SQOs, and Advisors Joined that occurred within each time period. 
            These are periodic counts - events are counted by when they happened, regardless of when the record entered the funnel.
          </Text>
        </div>
        
        {/* Controls Row - Only Granularity Toggle */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Granularity Toggle */}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => handleGranularityChange('month')}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                granularity === 'month'
                  ? 'bg-white shadow text-blue-600 font-medium'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => handleGranularityChange('quarter')}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                granularity === 'quarter'
                  ? 'bg-white shadow text-blue-600 font-medium'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Quarterly
            </button>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            margin={{ top: 25, right: 30, left: 20, bottom: 5 }}
            barCategoryGap="15%"
            barGap={2}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} className="dark:stroke-gray-700" />
            <XAxis 
              dataKey="period" 
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
                color: isDark ? '#f9fafb' : '#111827'
              }}
              formatter={(value: number | undefined, name: string | undefined) => [formatValue(value ?? 0), name ?? '']}
              labelStyle={{ 
                fontWeight: 600, 
                marginBottom: '4px',
                color: isDark ? '#f9fafb' : '#111827'
              }}
              itemStyle={{
                color: isDark ? '#f9fafb' : '#111827'
              }}
            />
            {/* Custom Legend - render in correct order: SQLs, SQOs, Joined */}
            <Legend 
              content={({ payload }) => {
                if (!payload) return null;
                // Reorder payload to show: SQLs, SQOs, Joined
                const orderedPayload = volumeCategories.map(cat => 
                  payload.find((p: any) => p.dataKey === cat)
                ).filter(Boolean);
                
                return (
                  <div className="flex justify-center gap-6 pt-2.5">
                    {orderedPayload.map((entry: any, index: number) => (
                      <div key={index} className="flex items-center gap-2">
                        <div 
                          style={{ 
                            width: 14, 
                            height: 14, 
                            backgroundColor: entry.color,
                            borderRadius: 2
                          }} 
                        />
                        <span className="text-sm" style={{ color: isDark ? '#9ca3af' : '#4b5563' }}>
                          {entry.dataKey}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              }}
            />
            {/* Render bars in correct order: SQLs, SQOs, Joined */}
            {volumeCategories.map((cat) => (
              <Bar
                key={cat}
                dataKey={cat}
                fill={VOLUME_COLORS[cat]}
                radius={[4, 4, 0, 0]}
                maxBarSize={50}
              >
                <LabelList 
                  dataKey={cat} 
                  position="top" 
                  content={renderBarLabel}
                />
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Legend Explanation */}
      <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
        <div className="flex items-start gap-2">
          <InfoIcon className="mt-0.5 flex-shrink-0" />
          <Text className="text-xs text-gray-500 dark:text-gray-400">
            <strong>Volumes:</strong> Shows the count of SQLs, SQOs, and Advisors Joined that occurred within each time period. 
            These are periodic counts - events are counted by when they happened, regardless of when the record entered the funnel.
          </Text>
        </div>
      </div>
    </Card>
  );
}
