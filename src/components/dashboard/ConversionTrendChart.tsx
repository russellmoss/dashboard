'use client';

import { Card, Title, Text } from '@tremor/react';
import { TrendDataPoint, ConversionTrendMode } from '@/types/dashboard';
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

// Tooltip component for mode explanations
const ModeTooltip = ({ mode, children }: { mode: ConversionTrendMode; children: React.ReactNode }) => {
  const [isOpen, setIsOpen] = useState(false);
  
  const explanations = {
    period: {
      title: 'Period Mode (Activity-Based)',
      description: 'Shows conversion activity that occurred in each period.',
      example: 'An SQL from Q3 that becomes SQO in Q4 counts toward Q4\'s rate.',
      details: [
        'Answers: "What happened in this period?"',
        'Includes ALL records, including those still in progress',
        'Rates can exceed 100% when converting older leads',
        'Best for: Activity tracking, sales performance, executive dashboards',
      ],
      calculation: 'SQL→SQO Rate = (SQOs created in period) ÷ (SQLs created in period)',
    },
    cohort: {
      title: 'Cohort Mode (Efficiency-Based)',
      description: 'Tracks how well leads from each period convert over time.',
      example: 'An SQL from Q3 that becomes SQO in Q4 counts toward Q3\'s rate.',
      details: [
        'Answers: "How well do leads from this period convert?"',
        'Only includes RESOLVED records (converted OR closed/lost)',
        'Open records are excluded from denominators',
        'Rates are always 0-100%',
        'Best for: Funnel efficiency, forecasting, process improvement',
      ],
      calculation: 'SQL→SQO Rate = (Resolved SQLs that became SQO) ÷ (Resolved SQLs)',
      resolvedNote: 'Resolved = either converted to next stage OR closed/lost',
    },
  };
  
  const content = explanations[mode];
  
  return (
    <div className="relative inline-block">
      <div 
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => setIsOpen(false)}
        onClick={() => setIsOpen(!isOpen)}
      >
        {children}
      </div>
      {isOpen && (
        <div className="absolute z-50 w-96 p-4 bg-white rounded-lg shadow-xl border border-gray-200 -left-2 mt-2">
          <div className="absolute -top-2 left-4 w-4 h-4 bg-white border-l border-t border-gray-200 transform rotate-45" />
          <h4 className="font-semibold text-gray-900 mb-2">{content.title}</h4>
          <p className="text-sm text-gray-600 mb-3">{content.description}</p>
          
          <div className="bg-blue-50 p-2 rounded text-sm text-blue-800 mb-3">
            <strong>Example:</strong> {content.example}
          </div>
          
          <ul className="text-sm text-gray-600 space-y-1.5 mb-3">
            {content.details.map((detail, i) => (
              <li key={i} className="flex items-start">
                <span className="mr-2 text-gray-400">•</span>
                <span>{detail}</span>
              </li>
            ))}
          </ul>
          
          <div className="bg-gray-50 p-2 rounded text-xs text-gray-700 font-mono mb-2">
            {content.calculation}
          </div>
          
          {'resolvedNote' in content && content.resolvedNote && (
            <div className="text-xs text-gray-500 italic">
              {content.resolvedNote}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

interface ConversionTrendChartProps {
  trends: TrendDataPoint[];
  onGranularityChange?: (granularity: 'month' | 'quarter') => void;
  granularity?: 'month' | 'quarter';
  mode?: ConversionTrendMode;
  onModeChange?: (mode: ConversionTrendMode) => void;
  isLoading?: boolean;
}

export function ConversionTrendChart({ 
  trends, 
  onGranularityChange,
  granularity: granularityProp,
  mode = 'period',
  onModeChange,
  isLoading = false,
}: ConversionTrendChartProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const [selectedMetric, setSelectedMetric] = useState<'rates' | 'volume'>('rates');
  const [internalGranularity, setInternalGranularity] = useState<'month' | 'quarter'>('quarter');
  
  // Use prop if provided, otherwise use internal state
  const granularity = granularityProp ?? internalGranularity;
  
  const handleGranularityChange = (value: 'month' | 'quarter') => {
    setInternalGranularity(value);
    onGranularityChange?.(value);
  };

  const handleModeChange = (newMode: ConversionTrendMode) => {
    onModeChange?.(newMode);
  };

  // Transform data for chart display with proper rounding
  const chartData = trends.map(t => ({
    period: t.period,
    isSelectedPeriod: t.isSelectedPeriod || false,
    // Convert rates from decimal (0-1) to percentage (0-100) and round to 1 decimal
    'Contacted→MQL': Number(((Number(t.contactedToMqlRate) || 0) * 100).toFixed(1)),
    'MQL→SQL': Number(((Number(t.mqlToSqlRate) || 0) * 100).toFixed(1)),
    'SQL→SQO': Number(((Number(t.sqlToSqoRate) || 0) * 100).toFixed(1)),
    'SQO→Joined': Number(((Number(t.sqoToJoinedRate) || 0) * 100).toFixed(1)),
    SQLs: Number(t.sqls) || 0,
    SQOs: Number(t.sqos) || 0,
    Joined: Number(t.joined) || 0,
  }));

  const rateCategories = ['Contacted→MQL', 'MQL→SQL', 'SQL→SQO', 'SQO→Joined'];
  const volumeCategories = ['SQLs', 'SQOs', 'Joined'];

  // Color scheme using centralized theme constants
  const RATE_COLORS: Record<string, string> = {
    'Contacted→MQL': CHART_COLORS.contactedToMql,
    'MQL→SQL': CHART_COLORS.mqlToSql,
    'SQL→SQO': CHART_COLORS.sqlToSqo,
    'SQO→Joined': CHART_COLORS.sqoToJoined,
  };

  const VOLUME_COLORS: Record<string, string> = {
    'SQLs': CHART_COLORS.primary,
    'SQOs': CHART_COLORS.mqlToSql,
    'Joined': CHART_COLORS.sqoToJoined,
  };

  const categories = selectedMetric === 'rates' ? rateCategories : volumeCategories;
  const colorMap = selectedMetric === 'rates' ? RATE_COLORS : VOLUME_COLORS;

  const formatValue = (value: number) => {
    if (selectedMetric === 'rates') {
      return `${Number(value).toFixed(1)}%`;
    }
    return value.toLocaleString();
  };

  // Custom label renderer for values above bars
  const renderBarLabel = (props: any) => {
    const { x = 0, y = 0, width = 0, value } = props;
    
    // Don't show label for zero or undefined values
    if (!value || value === 0) return null;
    
    const displayValue = selectedMetric === 'rates' 
      ? `${Number(value).toFixed(1)}%`
      : Number(value).toLocaleString();
    
    // Use dark mode aware text color with better contrast
    // Use darker color in light mode, lighter in dark mode for visibility
    const textColor = isDark ? '#e5e7eb' : '#1f2937';
    const bgColor = isDark ? 'rgba(31, 41, 55, 0.9)' : 'rgba(255, 255, 255, 0.9)';
    const labelX = x + width / 2;
    const labelY = y - 6;
    
    // Calculate text width approximation (rough estimate: ~6px per character)
    const textWidth = displayValue.length * 6;
    const padding = 4;
    
    return (
      <g style={{ pointerEvents: 'none' }}>
        {/* Background rectangle for better contrast */}
        <rect
          x={labelX - textWidth / 2 - padding}
          y={labelY - 12}
          width={textWidth + padding * 2}
          height={14}
          fill={bgColor}
          rx={3}
          stroke={isDark ? '#4b5563' : '#e5e7eb'}
          strokeWidth={0.5}
        />
        {/* Text label */}
        <text 
          x={labelX} 
          y={labelY} 
          fill={textColor}
          textAnchor="middle" 
          fontSize={11} 
          fontWeight={600}
        >
          {displayValue}
        </text>
      </g>
    );
  };

  if (isLoading) {
    return (
      <Card className="mb-6">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 rounded w-48 mb-4" />
          <div className="h-80 bg-gray-200 rounded" />
        </div>
      </Card>
    );
  }

  return (
    <Card className="mb-6">
      {/* Header Section */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Title className="dark:text-white">Conversion Trends</Title>
            <ModeTooltip mode={mode}>
              <InfoIcon />
            </ModeTooltip>
          </div>
          <Text className="text-gray-500 dark:text-gray-400 text-sm mt-1">
            {mode === 'period' 
              ? 'Activity view: What happened in each period'
              : 'Cohort view: How well resolved leads from each period convert'
            }
          </Text>
        </div>
        
        {/* Controls Row */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Mode Toggle */}
          {onModeChange && (
            <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => handleModeChange('period')}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors flex items-center gap-1 ${
                  mode === 'period'
                    ? 'bg-white shadow text-blue-600 font-medium'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Period
                <ModeTooltip mode="period">
                  <InfoIcon className="ml-0.5" />
                </ModeTooltip>
              </button>
              <button
                onClick={() => handleModeChange('cohort')}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors flex items-center gap-1 ${
                  mode === 'cohort'
                    ? 'bg-white shadow text-blue-600 font-medium'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Cohort
                <ModeTooltip mode="cohort">
                  <InfoIcon className="ml-0.5" />
                </ModeTooltip>
              </button>
            </div>
          )}
          
          {/* Metric Toggle (Rates vs Volume) */}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setSelectedMetric('rates')}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                selectedMetric === 'rates'
                  ? 'bg-white shadow text-blue-600 font-medium'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Rates
            </button>
            <button
              onClick={() => setSelectedMetric('volume')}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                selectedMetric === 'volume'
                  ? 'bg-white shadow text-blue-600 font-medium'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Volume
            </button>
          </div>
          
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
      <div className="h-96">
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
              tickFormatter={(value) => 
                selectedMetric === 'rates' ? `${value}%` : value.toLocaleString()
              }
              domain={selectedMetric === 'rates' ? [0, 'auto'] : ['auto', 'auto']}
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
            <Legend 
              wrapperStyle={{ paddingTop: '10px' }}
              iconType="square"
            />
            {categories.map((cat) => (
              <Bar
                key={cat}
                dataKey={cat}
                fill={colorMap[cat]}
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
            {mode === 'period' ? (
              <>
                <strong>Period Mode:</strong> Shows conversion activity in each period. 
                An SQL from Q3 that becomes SQO in Q4 counts toward Q4&apos;s rate.
                Includes all records. Rates can exceed 100% when converting older leads.
              </>
            ) : (
              <>
                <strong>Cohort Mode:</strong> Tracks each cohort through the funnel using only resolved records.
                An SQL from Q3 that becomes SQO in Q4 counts toward Q3&apos;s rate.
                Open records (still in progress) are excluded. Rates are always 0-100%.
              </>
            )}
          </Text>
        </div>
      </div>
    </Card>
  );
}
