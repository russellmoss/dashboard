// Visualization renderers for the Explore feature
'use client';

import React from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts';
import { TrendingUp } from 'lucide-react';
import { formatCurrency } from '@/lib/utils/date-helpers';
import { formatExploreNumber } from './explore-formatters';
import type { VisualizationType, QueryResultData } from '@/types/agent';

// Helper to get visualization title
export function getVisualizationTitle(type: VisualizationType): string {
  const titles: Record<VisualizationType, string> = {
    metric: 'Metric',
    bar: 'Bar Chart',
    line: 'Trend Chart',
    funnel: 'Funnel View',
    comparison: 'Comparison',
    table: 'Data Table',
  };
  return titles[type] || 'Visualization';
}

// Visualization rendering function
export function renderVisualization(
  visualization: VisualizationType,
  data: QueryResultData,
  title?: string,
  isDark?: boolean,
  isAumMetric?: boolean,
  onMetricClick?: () => void,
  onBarClick?: (data: any, index: number) => void,
  onLineClick?: (data: any, index: number) => void,
  onComparisonClick?: (periodType: 'current' | 'previous') => void
): React.ReactNode {
  switch (visualization) {
    case 'metric':
      return renderMetric(data, isAumMetric, onMetricClick);

    case 'bar':
      return renderBarChart(data, isDark, onBarClick);

    case 'line':
      return renderLineChart(data, isDark, onLineClick);

    case 'funnel':
      // TODO: Implement funnel visualization component
      return (
        <div className="flex items-center justify-center py-8">
          <span className="text-gray-500 dark:text-gray-400">
            Funnel visualization (to be implemented)
          </span>
        </div>
      );

    case 'comparison':
      return renderComparison(data, isDark, onComparisonClick);

    case 'table':
    default:
      // Table is rendered separately below
      return (
        <div className="flex items-center justify-center py-8">
          <span className="text-gray-500 dark:text-gray-400">
            Data displayed in table below
          </span>
        </div>
      );
  }
}

function renderMetric(result: QueryResultData, isAumMetric?: boolean, onMetricClick?: () => void) {
  const value = result.rows[0]?.value;
  const numValue = Number(value) || 0;

  // Check if this is a conversion rate (value between 0-100 and column type is 'rate')
  const valueColumn = result.columns.find(col => col.name === 'value');
  const isRate = valueColumn?.type === 'rate' ||
                 (typeof value === 'number' && value >= 0 && value <= 100 &&
                  (valueColumn?.displayName.toLowerCase().includes('rate') ||
                   valueColumn?.displayName.toLowerCase().includes('percent')));

  // Format AUM metrics with currency
  let displayValue: string;
  let fullValue: string | null = null;

  if (isAumMetric) {
    // Format as currency: "$12.4B" for billions, "$12.5M" for millions, etc.
    displayValue = formatCurrency(numValue);
    // Full formatted value with commas
    fullValue = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(numValue);
  } else if (isRate) {
    displayValue = `${numValue.toFixed(1)}%`;
  } else {
    displayValue = formatExploreNumber(value);
  }

  // ALL metrics are clickable now: counts, AUM, and rates
  const isClickable = numValue > 0 && onMetricClick;

  return (
    <div className="flex flex-col items-center justify-center py-8">
      <TrendingUp className="w-8 h-8 text-blue-500 mb-2" />
      <button
        onClick={isClickable ? onMetricClick : undefined}
        disabled={!isClickable}
        className={`text-4xl font-bold text-gray-900 dark:text-gray-100 ${
          isClickable
            ? 'cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors'
            : 'cursor-default'
        }`}
        title={isClickable ? 'Click to see details' : undefined}
      >
        {displayValue}
      </button>
      {fullValue && (
        <span className="text-sm text-gray-500 dark:text-gray-400 mt-2">
          {fullValue}
        </span>
      )}
    </div>
  );
}

function renderBarChart(result: QueryResultData, isDark: boolean = false, onBarClick?: (data: any, index: number) => void) {
  const data = result.rows.map((row, idx) => ({
    name: String(row.dimension_value || row.period || row.sga || ''),
    value: Number(row.metric_value || row.rate || row.value || 0),
    index: idx, // Store index for click handler
  }));

  return (
    <div className="h-80">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis type="number" />
          <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 12 }} />
          <Tooltip
            contentStyle={{
              backgroundColor: isDark ? '#1f2937' : '#fff',
              border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
              borderRadius: '8px',
              color: isDark ? '#f9fafb' : '#111827'
            }}
          />
          <Bar
            dataKey="value"
            fill="#3B82F6"
            radius={[0, 4, 4, 0]}
            isAnimationActive={false}
            onClick={(data: any, index: number) => {
              if (onBarClick && data && data.value > 0) {
                // data is the clicked data point, index is the index
                onBarClick(data, index);
              }
            }}
            style={{ cursor: onBarClick ? 'pointer' : 'default' }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function renderComparison(result: QueryResultData, isDark: boolean = false, onComparisonClick?: (periodType: 'current' | 'previous') => void) {
  if (result.rows.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <span className="text-gray-500 dark:text-gray-400">No comparison data available</span>
      </div>
    );
  }

  const row = result.rows[0];
  const currentValue = Number(row.current_value || row.currentValue || 0);
  const previousValue = Number(row.previous_value || row.previousValue || 0);
  const changePercent = row.change_percent !== undefined ? Number(row.change_percent) : row.changePercent !== undefined ? Number(row.changePercent) : null;
  const changeAbsolute = row.change_absolute !== undefined ? Number(row.change_absolute) : row.changeAbsolute !== undefined ? Number(row.changeAbsolute) : 0;

  const isPositive = changePercent !== null && changePercent > 0;
  const isNegative = changePercent !== null && changePercent < 0;

  return (
    <div className="flex items-center justify-center py-8">
      <div className="grid grid-cols-2 gap-8 w-full max-w-2xl">
        {/* Current Period */}
        <div className="text-center">
          <div className="text-sm text-gray-500 dark:text-gray-400 mb-2">Current Period</div>
          <button
            onClick={() => onComparisonClick?.('current')}
            disabled={!onComparisonClick || currentValue === 0}
            className={`text-4xl font-bold ${
              onComparisonClick && currentValue > 0
                ? 'cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors text-gray-900 dark:text-gray-100'
                : 'cursor-default text-gray-900 dark:text-gray-100'
            }`}
            title={onComparisonClick && currentValue > 0 ? 'Click to see details' : undefined}
          >
            {currentValue.toLocaleString()}
          </button>
        </div>

        {/* Previous Period */}
        <div className="text-center">
          <div className="text-sm text-gray-500 dark:text-gray-400 mb-2">Previous Period</div>
          <button
            onClick={() => onComparisonClick?.('previous')}
            disabled={!onComparisonClick || previousValue === 0}
            className={`text-4xl font-bold ${
              onComparisonClick && previousValue > 0
                ? 'cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors text-gray-900 dark:text-gray-100'
                : 'cursor-default text-gray-900 dark:text-gray-100'
            }`}
            title={onComparisonClick && previousValue > 0 ? 'Click to see details' : undefined}
          >
            {previousValue.toLocaleString()}
          </button>
        </div>

        {/* Change */}
        {changePercent !== null && (
          <div className="col-span-2 text-center mt-4">
            <div className={`text-2xl font-semibold ${
              isPositive ? 'text-green-600 dark:text-green-400' :
              isNegative ? 'text-red-600 dark:text-red-400' :
              'text-gray-600 dark:text-gray-400'
            }`}>
              {isPositive ? '+' : ''}{changePercent.toFixed(1)}%
              {changeAbsolute !== 0 && (
                <span className="text-lg text-gray-500 dark:text-gray-400 ml-2">
                  ({changeAbsolute > 0 ? '+' : ''}{changeAbsolute.toLocaleString()})
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function renderLineChart(result: QueryResultData, isDark: boolean = false, onPointClick?: (data: any, index: number) => void) {
  const data = result.rows.map((row, idx) => ({
    name: String(row.period || ''),
    value: Number(row.raw_value || row.metric_value || row.rate || 0),
    rollingAvg: row.rolling_avg ? Number(row.rolling_avg) : undefined,
    index: idx, // Store index for click handler
  }));

  return (
    <div className="h-80">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis dataKey="name" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip
            contentStyle={{
              backgroundColor: isDark ? '#1f2937' : '#fff',
              border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
              borderRadius: '8px',
              color: isDark ? '#f9fafb' : '#111827'
            }}
          />
          <Legend />
          <Line
            type="monotone"
            dataKey="value"
            stroke="#3B82F6"
            strokeWidth={2}
            isAnimationActive={false}
            dot={onPointClick ? (props: any) => {
              const { cx, cy, payload, value } = props;
              // payload contains the data point from the data array, including the index we stored
              const dataIndex = payload?.index !== undefined ? payload.index : data.findIndex((d: any) => d.name === payload?.name && d.value === value);
              return (
                <circle
                  cx={cx}
                  cy={cy}
                  r={6}
                  fill="#3B82F6"
                  stroke="#fff"
                  strokeWidth={2}
                  style={{ cursor: 'pointer' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onPointClick && payload && value > 0 && dataIndex >= 0) {
                      // Pass the payload (which contains name/period) and the index
                      onPointClick(payload, dataIndex);
                    }
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.setAttribute('fill', '#2563EB');
                    e.currentTarget.setAttribute('r', '8');
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.setAttribute('fill', '#3B82F6');
                    e.currentTarget.setAttribute('r', '6');
                  }}
                />
              );
            } : { r: 4 }}
            name="Value"
          />
          {data.some(d => d.rollingAvg !== undefined) && (
            <Line
              type="monotone"
              dataKey="rollingAvg"
              stroke="#10B981"
              strokeWidth={2}
              strokeDasharray="5 5"
              dot={false}
              name="Rolling Avg"
              isAnimationActive={false}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
