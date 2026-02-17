'use client';

import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  LabelList,
} from 'recharts';
import { useTheme } from 'next-themes';
import { STAGE_STACK_ORDER, STAGE_COLORS } from '@/config/constants';
import { SgmPipelineChartData } from '@/types/dashboard';

interface PipelineBySgmChartProps {
  data: SgmPipelineChartData[];
  selectedStages: string[];
  onSegmentClick: (sgm: string, stage: string) => void;
  onSgmClick: (sgm: string) => void;
  loading?: boolean;
}

function stageToKey(stage: string): string {
  const map: Record<string, string> = {
    'Planned Nurture': 'plannedNurture',
    'Qualifying': 'qualifying',
    'Discovery': 'discovery',
    'Sales Process': 'salesProcess',
    'Negotiating': 'negotiating',
    'Signed': 'signed',
    'On Hold': 'onHold',
  };
  return map[stage] || stage.toLowerCase().replace(/\s+/g, '');
}

const formatAumAxis = (value: number) => {
  if (value >= 1000000000) return `$${(value / 1000000000).toFixed(1)}B`;
  if (value >= 1000000) return `$${(value / 1000000).toFixed(0)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
  return `$${value.toLocaleString()}`;
};

const formatAumTooltip = (value: number) => {
  if (value >= 1000000000) return `$${(value / 1000000000).toFixed(2)}B`;
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`;
  return `$${value.toLocaleString()}`;
};

const formatAumLabel = (value: number) => {
  if (value >= 1000000000) return `$${(value / 1000000000).toFixed(1)}B`;
  if (value >= 1000000) return `$${Math.round(value / 1000000)}M`;
  if (value >= 1000) return `$${Math.round(value / 1000)}K`;
  return `$${value.toLocaleString()}`;
};

interface CustomXAxisTickProps {
  x?: number;
  y?: number;
  payload?: { value: string };
  onClick: (sgm: string) => void;
  isDark: boolean;
}

const CustomXAxisTick = ({ x, y, payload, onClick, isDark }: CustomXAxisTickProps) => {
  const name = payload?.value || '';
  // Truncate long names to 15 chars with ellipsis
  const displayName = name.length > 15 ? name.substring(0, 14) + '…' : name;
  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={0}
        y={0}
        dy={16}
        textAnchor="middle"
        fill={isDark ? '#60a5fa' : '#2563eb'}
        fontSize={20}
        fontWeight={600}
        style={{ cursor: 'pointer', textDecoration: 'underline' }}
        onClick={(e) => {
          e.stopPropagation();
          onClick(name);
        }}
      >
        {displayName}
      </text>
    </g>
  );
};

interface CustomTooltipProps {
  active?: boolean;
  payload?: any[];
  selectedStages: string[];
}

const CustomTooltip = ({ active, payload, selectedStages }: CustomTooltipProps) => {
  if (!active || !payload || payload.length === 0) return null;

  const dataEntry = payload[0]?.payload as SgmPipelineChartData;
  if (!dataEntry) return null;

  // Build list of stages to show (only those in selectedStages with data)
  const stageRows: { stage: string; aum: number; count: number }[] = [];
  for (const stage of STAGE_STACK_ORDER) {
    if (!selectedStages.includes(stage)) continue;
    const key = stageToKey(stage);
    const aum = (dataEntry as any)[key] || 0;
    const count = (dataEntry as any)[`${key}Count`] || 0;
    if (aum > 0 || count > 0) {
      stageRows.push({ stage, aum, count });
    }
  }

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-4 min-w-[280px]">
      <p className="font-semibold text-base text-gray-900 dark:text-white mb-2">
        {dataEntry.sgm}
      </p>
      <div className="space-y-1">
        {stageRows.map(({ stage, aum, count }) => (
          <div key={stage} className="flex items-center gap-2 text-sm">
            <div
              className="w-3 h-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: STAGE_COLORS[stage] }}
            />
            <span className="text-gray-600 dark:text-gray-400 flex-1">{stage}:</span>
            <span className="font-medium text-gray-900 dark:text-white">
              {formatAumTooltip(aum)}
            </span>
            <span className="text-gray-500 dark:text-gray-400">
              ({count} advisor{count !== 1 ? 's' : ''})
            </span>
          </div>
        ))}
      </div>
      <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-600">
        <div className="flex justify-between text-sm font-semibold">
          <span className="text-gray-700 dark:text-gray-300">Total:</span>
          <span className="text-gray-900 dark:text-white">
            {formatAumTooltip(dataEntry.totalAum)} ({dataEntry.totalCount} advisor{dataEntry.totalCount !== 1 ? 's' : ''})
          </span>
        </div>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 pt-2 border-t border-gray-200 dark:border-gray-600">
        Click any segment to drill down
      </p>
    </div>
  );
};

// Colors for the two bar types
const BAR_COLORS = {
  aum: '#3B82F6',      // Blue for AUM
  count: '#10B981',    // Green for Count
};

export function PipelineBySgmChart({
  data,
  selectedStages,
  onSegmentClick,
  onSgmClick,
  loading = false,
}: PipelineBySgmChartProps) {
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
        No data available for selected filters
      </div>
    );
  }

  const gridColor = isDark ? '#4B5563' : '#D1D5DB';
  const textColor = isDark ? '#9CA3AF' : '#6B7280';

  // Filter stages to only those selected
  const stagesToRender = STAGE_STACK_ORDER.filter(stage => selectedStages.includes(stage));

  // Custom label renderer for total AUM above each stacked bar
  const renderTotalAumLabel = (props: any) => {
    const { x = 0, y = 0, width = 0, index } = props;
    if (index === undefined || !data[index]) return null;
    const entry = data[index];
    if (!entry.totalAum || entry.totalAum === 0) return null;

    const displayValue = formatAumLabel(entry.totalAum);
    return (
      <text
        x={x + width / 2}
        y={y - 8}
        fill={isDark ? '#f9fafb' : '#111827'}
        textAnchor="middle"
        fontSize={20}
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

  // Custom label renderer for total count above each stacked count bar
  const renderTotalCountLabel = (props: any) => {
    const { x = 0, y = 0, width = 0, index } = props;
    if (index === undefined || !data[index]) return null;
    const entry = data[index];
    if (!entry.totalCount || entry.totalCount === 0) return null;

    return (
      <text
        x={x + width / 2}
        y={y - 8}
        fill={isDark ? '#f9fafb' : '#111827'}
        textAnchor="middle"
        fontSize={20}
        fontWeight={700}
        style={{
          textShadow: isDark
            ? '0 0 2px rgba(0,0,0,0.5)'
            : '0 0 2px rgba(255,255,255,0.8)',
        }}
      >
        {entry.totalCount}
      </text>
    );
  };

  // Legend formatter - show stage names only once (not duplicated for AUM/Count)
  const legendFormatter = (value: string) => {
    // Find the stage name that matches this camelCase key
    for (const stage of STAGE_STACK_ORDER) {
      if (stageToKey(stage) === value) {
        return <span style={{ color: textColor, fontSize: 20 }}>{stage}</span>;
      }
    }
    return <span style={{ color: textColor, fontSize: 20 }}>{value}</span>;
  };

  return (
    <div className="h-[75vh] min-h-[600px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 40, right: 80, left: 80, bottom: 20 }}
          barCategoryGap="20%"
          barGap={2}
        >
          <CartesianGrid
            strokeDasharray="5 5"
            stroke={gridColor}
            vertical={false}
            yAxisId="aum"
          />
          <XAxis
            dataKey="sgm"
            tick={(props: any) => (
              <CustomXAxisTick {...props} onClick={onSgmClick} isDark={isDark} />
            )}
            axisLine={{ stroke: gridColor }}
            interval={0}
          />
          {/* Left Y-Axis for AUM */}
          <YAxis
            yAxisId="aum"
            orientation="left"
            tickFormatter={formatAumAxis}
            tick={{ fill: isDark ? '#f9fafb' : '#111827', fontSize: 21, fontWeight: 500 }}
            axisLine={{ stroke: gridColor }}
            tickLine={{ stroke: gridColor }}
            domain={[0, 'dataMax']}
            allowDecimals={false}
            label={{
              value: 'AUM ($)',
              angle: -90,
              position: 'insideLeft',
              dx: -35,
              style: { fill: BAR_COLORS.aum, fontSize: 21, fontWeight: 600 },
            }}
          />
          {/* Right Y-Axis for Advisor Count */}
          <YAxis
            yAxisId="count"
            orientation="right"
            tick={{ fill: isDark ? '#f9fafb' : '#111827', fontSize: 21, fontWeight: 500 }}
            tickFormatter={(value) => value.toLocaleString()}
            axisLine={{ stroke: gridColor }}
            tickLine={{ stroke: gridColor }}
            domain={[0, 'dataMax']}
            allowDecimals={false}
            label={{
              value: '# of Advisors',
              angle: 90,
              position: 'insideRight',
              dx: 35,
              style: { fill: BAR_COLORS.count, fontSize: 21, fontWeight: 600 },
            }}
          />
          <Tooltip
            content={<CustomTooltip selectedStages={selectedStages} />}
          />
          <Legend
            wrapperStyle={{ paddingTop: 10 }}
            formatter={legendFormatter}
          />
          {/* AUM Bars (stacked) */}
          {stagesToRender.map((stage, index) => {
            const key = stageToKey(stage);
            const isLast = index === stagesToRender.length - 1;

            return (
              <Bar
                key={`aum-${stage}`}
                dataKey={key}
                yAxisId="aum"
                stackId="aum"
                fill={STAGE_COLORS[stage]}
                name={key}
                cursor="pointer"
                onClick={(barData: any) => {
                  if (barData && barData.sgm) {
                    onSegmentClick(barData.sgm, stage);
                  }
                }}
              >
                {isLast && (
                  <LabelList content={renderTotalAumLabel} />
                )}
              </Bar>
            );
          })}
          {/* Count Bars (stacked) */}
          {stagesToRender.map((stage, index) => {
            const key = stageToKey(stage);
            const countKey = `${key}Count`;
            const isLast = index === stagesToRender.length - 1;

            return (
              <Bar
                key={`count-${stage}`}
                dataKey={countKey}
                yAxisId="count"
                stackId="count"
                fill={STAGE_COLORS[stage]}
                name={isLast ? undefined : countKey} // Only show in legend once via AUM bars
                legendType={isLast ? 'none' : 'none'} // Hide count bars from legend (colors shown via AUM)
                cursor="pointer"
                onClick={(barData: any) => {
                  if (barData && barData.sgm) {
                    onSegmentClick(barData.sgm, stage);
                  }
                }}
              >
                {isLast && (
                  <LabelList content={renderTotalCountLabel} />
                )}
              </Bar>
            );
          })}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
