'use client';

import React from 'react';
import { useTheme } from 'next-themes';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  Legend,
  LabelList,
  ReferenceLine,
} from 'recharts';
import { OpenPipelineByStage } from '@/types/dashboard';

interface PipelineByStageChartProps {
  data: OpenPipelineByStage[];
  onBarClick: (stage: string, metric: 'aum' | 'count') => void;
  loading?: boolean;
}

const COLORS = {
  aum: '#3B82F6',      // Blue
  count: '#10B981',    // Green
  aumHover: '#2563EB',
  countHover: '#059669',
};

const formatAumAxis = (value: number) => {
  if (value >= 1000000000) {
    return `$${(value / 1000000000).toFixed(1)}B`;
  }
  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(0)}M`;
  }
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(0)}K`;
  }
  return `$${value.toLocaleString()}`;
};

const formatAumTooltip = (value: number) => {
  if (value >= 1000000000) {
    return `$${(value / 1000000000).toFixed(2)}B`;
  }
  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(1)}K`;
  }
  return `$${value.toLocaleString()}`;
};

const formatAumLabel = (value: number) => {
  if (value >= 1000000000) {
    return `$${(value / 1000000000).toFixed(1)}B`;
  }
  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(0)}M`;
  }
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(0)}K`;
  }
  return `$${value.toLocaleString()}`;
};

interface CustomTooltipProps {
  active?: boolean;
  payload?: any[];
  label?: string;
}

const CustomTooltip = ({ active, payload, label }: CustomTooltipProps) => {
  if (!active || !payload || payload.length === 0) return null;
  
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-4">
      <p className="font-semibold text-base text-gray-900 dark:text-white mb-2">{label}</p>
      {payload.map((entry, index) => (
        <div key={index} className="flex items-center gap-2 text-base">
          <div
            className="w-4 h-4 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-gray-600 dark:text-gray-400">
            {entry.name}:
          </span>
          <span className="font-medium text-gray-900 dark:text-white">
            {entry.name === 'AUM' 
              ? formatAumTooltip(entry.value)
              : entry.value.toLocaleString()
            }
          </span>
        </div>
      ))}
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 border-t border-gray-200 dark:border-gray-600 pt-2">
        Click a bar to see details
      </p>
    </div>
  );
};

export function PipelineByStageChart({
  data,
  onBarClick,
  loading = false,
}: PipelineByStageChartProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  if (loading) {
    return (
      <div className="h-[75vh] min-h-[600px] flex items-center justify-center">
        <div className="animate-pulse text-gray-400">Loading chart...</div>
      </div>
    );
  }
  
  if (!data || data.length === 0) {
    return (
      <div className="h-[75vh] min-h-[600px] flex items-center justify-center text-gray-500 dark:text-gray-400">
        No data available for selected stages
      </div>
    );
  }
  
  const textColor = isDark ? '#9CA3AF' : '#6B7280';
  const gridColor = isDark ? '#4B5563' : '#D1D5DB'; // More visible grid color
  const labelColor = isDark ? '#f9fafb' : '#111827';
  
  // Find max values for scaling
  const maxAum = Math.max(...data.map(d => d.totalAum));
  const maxCount = Math.max(...data.map(d => d.advisorCount));
  
  // Custom label renderer for AUM values above bars
  const renderAumLabel = (props: any) => {
    const { x = 0, y = 0, width = 0, value } = props;
    
    if (!value || value === 0) return null;
    
    const displayValue = formatAumLabel(value);
    const labelX = x + width / 2;
    const labelY = y - 8;
    
    // Use darker color for better visibility in PNG export
    const textFill = isDark ? '#f9fafb' : '#111827';
    
    return (
      <text
        x={labelX}
        y={labelY}
        fill={textFill}
        textAnchor="middle"
        fontSize={14}
        fontWeight={700}
        style={{ 
          textShadow: isDark 
            ? '0 0 2px rgba(0,0,0,0.5)' 
            : '0 0 2px rgba(255,255,255,0.8)',
        }}
      >
        {displayValue}
      </text>
    );
  };
  
  // Custom label renderer for Advisor count values above bars
  const renderCountLabel = (props: any) => {
    const { x = 0, y = 0, width = 0, value } = props;
    
    if (!value || value === 0) return null;
    
    const displayValue = value.toLocaleString();
    const labelX = x + width / 2;
    const labelY = y - 8;
    
    // Use darker color for better visibility in PNG export
    const textFill = isDark ? '#f9fafb' : '#111827';
    
    return (
      <text
        x={labelX}
        y={labelY}
        fill={textFill}
        textAnchor="middle"
        fontSize={14}
        fontWeight={700}
        style={{ 
          textShadow: isDark 
            ? '0 0 2px rgba(0,0,0,0.5)' 
            : '0 0 2px rgba(255,255,255,0.8)',
        }}
      >
        {displayValue}
      </text>
    );
  };
  
  return (
    <div className="h-[75vh] min-h-[600px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 40, right: 80, left: 20, bottom: 20 }}
          barCategoryGap="20%"
        >
          {/* Single horizontal grid that spans full width - aligns with AUM axis ticks */}
          <CartesianGrid 
            strokeDasharray="5 5" 
            stroke={gridColor} 
            vertical={false}
            strokeWidth={1}
            opacity={0.6}
            yAxisId="aum"
          />
          <XAxis 
            dataKey="stage" 
            tick={{ fill: isDark ? '#f9fafb' : '#111827', fontSize: 15, fontWeight: 500 }}
            axisLine={{ stroke: gridColor }}
          />
          <YAxis
            yAxisId="aum"
            orientation="left"
            tickFormatter={formatAumAxis}
            tick={{ fill: isDark ? '#f9fafb' : '#111827', fontSize: 14, fontWeight: 500 }}
            axisLine={{ stroke: gridColor }}
            tickLine={{ stroke: gridColor }}
            domain={[0, 'dataMax']}
            allowDecimals={false}
            label={{ 
              value: 'AUM', 
              angle: -90, 
              position: 'insideLeft',
              style: { fill: COLORS.aum, fontSize: 15, fontWeight: 600 },
            }}
          />
          <YAxis
            yAxisId="count"
            orientation="right"
            tick={{ fill: isDark ? '#f9fafb' : '#111827', fontSize: 14, fontWeight: 500 }}
            tickFormatter={(value) => value.toLocaleString()}
            axisLine={{ stroke: gridColor }}
            tickLine={{ stroke: gridColor }}
            domain={[0, 'dataMax']}
            allowDecimals={false}
            label={{ 
              value: 'Advisors', 
              angle: 90, 
              position: 'insideRight',
              style: { fill: COLORS.count, fontSize: 15, fontWeight: 600 },
            }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend 
            wrapperStyle={{ paddingTop: 10 }}
            formatter={(value) => (
              <span style={{ color: textColor, fontSize: 14 }}>{value}</span>
            )}
          />
          <Bar
            yAxisId="aum"
            dataKey="totalAum"
            name="AUM"
            fill={COLORS.aum}
            radius={[4, 4, 0, 0]}
            cursor="pointer"
            onClick={(data: any) => {
              if (data && data.stage) {
                onBarClick(data.stage, 'aum');
              }
            }}
          >
            {data.map((entry, index) => (
              <Cell 
                key={`aum-${index}`} 
                fill={COLORS.aum}
                className="hover:opacity-80 transition-opacity"
              />
            ))}
            <LabelList dataKey="totalAum" content={renderAumLabel} />
          </Bar>
          <Bar
            yAxisId="count"
            dataKey="advisorCount"
            name="Advisors"
            fill={COLORS.count}
            radius={[4, 4, 0, 0]}
            cursor="pointer"
            onClick={(data: any) => {
              if (data && data.stage) {
                onBarClick(data.stage, 'count');
              }
            }}
          >
            {data.map((entry, index) => (
              <Cell 
                key={`count-${index}`} 
                fill={COLORS.count}
                className="hover:opacity-80 transition-opacity"
              />
            ))}
            <LabelList dataKey="advisorCount" content={renderCountLabel} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
