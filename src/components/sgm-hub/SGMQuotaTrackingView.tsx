'use client';

import { Card, Badge } from '@tremor/react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useTheme } from 'next-themes';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, Cell,
} from 'recharts';
import { SGMQuotaProgress, SGMHistoricalQuarter, SGMOpenOpp } from '@/types/sgm-hub';
import { formatArrCompact } from '@/lib/utils/sgm-hub-helpers';
import { SGMOpenOppsTable } from './SGMOpenOppsTable';

interface SGMQuotaTrackingViewProps {
  quotaProgress: SGMQuotaProgress | null;
  historicalQuarters: SGMHistoricalQuarter[];
  openOpps: SGMOpenOpp[];
  loading: boolean;
  historicalLoading: boolean;
  openOppsLoading: boolean;
  onQuarterChange: (quarter: string) => void;
  selectedQuarter: string;
  onHistoricalBarClick: (quarter: string) => void;
  onOpenOppClick: (opportunityId: string) => void;
  quarterOptions: Array<{ value: string; label: string }>;
}

function getPacingBadgeConfig(status: string) {
  switch (status) {
    case 'ahead':
      return {
        className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
        icon: <TrendingUp className="w-3.5 h-3.5" />,
        label: 'Ahead',
      };
    case 'on-track':
      return {
        className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
        icon: <Minus className="w-3.5 h-3.5" />,
        label: 'On Track',
      };
    case 'behind':
      return {
        className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
        icon: <TrendingDown className="w-3.5 h-3.5" />,
        label: 'Behind',
      };
    default:
      return {
        className: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
        icon: <Minus className="w-3.5 h-3.5" />,
        label: 'No Goal',
      };
  }
}

function getProgressBarColor(percent: number | null): string {
  if (percent === null) return 'bg-gray-400';
  if (percent >= 100) return 'bg-green-500 dark:bg-green-600';
  if (percent >= 75) return 'bg-blue-500 dark:bg-blue-600';
  if (percent >= 50) return 'bg-yellow-500 dark:bg-yellow-600';
  return 'bg-red-500 dark:bg-red-600';
}

export function SGMQuotaTrackingView({
  quotaProgress,
  historicalQuarters,
  openOpps,
  loading,
  historicalLoading,
  openOppsLoading,
  onQuarterChange,
  selectedQuarter,
  onHistoricalBarClick,
  onOpenOppClick,
  quarterOptions,
}: SGMQuotaTrackingViewProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const gridColor = isDark ? '#374151' : '#e5e7eb';
  const axisColor = isDark ? '#9ca3af' : '#6b7280';

  // --- Quarter Selector ---
  const quarterSelector = (
    <div className="flex items-center gap-3 mb-6">
      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Quarter:</label>
      <select
        value={selectedQuarter}
        onChange={(e) => onQuarterChange(e.target.value)}
        className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm text-gray-900 dark:text-white"
      >
        {quarterOptions.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );

  // --- Loading skeleton ---
  if (loading || !quotaProgress) {
    return (
      <div>
        {quarterSelector}
        <Card className="animate-pulse">
          <div className="h-6 w-48 bg-gray-200 dark:bg-gray-700 rounded mb-4" />
          <div className="h-4 w-64 bg-gray-200 dark:bg-gray-700 rounded mb-3" />
          <div className="h-3 w-full bg-gray-200 dark:bg-gray-700 rounded mb-4" />
          <div className="grid grid-cols-2 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-16 bg-gray-100 dark:bg-gray-800 rounded" />
            ))}
          </div>
        </Card>
      </div>
    );
  }

  const p = quotaProgress;
  const pacingBadge = getPacingBadgeConfig(p.pacingStatus);
  const progressBarPercent = p.progressPercent !== null ? Math.min(p.progressPercent, 100) : 0;

  // Pacing description
  let pacingDescription = '';
  if (p.pacingStatus === 'ahead') {
    pacingDescription = `Ahead by ${formatArrCompact(Math.abs(p.pacingDiff))} (${Math.abs(p.pacingDiffPercent)}%)`;
  } else if (p.pacingStatus === 'behind') {
    pacingDescription = `Behind by ${formatArrCompact(Math.abs(p.pacingDiff))} (${Math.abs(p.pacingDiffPercent)}%)`;
  } else if (p.pacingStatus === 'on-track') {
    pacingDescription = 'On Track';
  }

  // --- Historical Chart Data ---
  const chartData = historicalQuarters.map(q => ({
    quarter: q.quarterLabel,
    quarterKey: q.quarter,
    actualArr: q.actualArr,
    goalArr: q.goalArr,
    joinedCount: q.joinedCount,
    isEstimate: q.isEstimate,
  }));

  return (
    <div>
      {quarterSelector}

      {/* Quarterly Progress Card */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Quarterly Progress — {p.quarterLabel}
          </h3>
          <Badge className={pacingBadge.className}>
            <span className="flex items-center gap-1">
              {pacingBadge.icon}
              {pacingBadge.label}
            </span>
          </Badge>
        </div>

        {p.hasQuota && (
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
            {pacingDescription}
          </p>
        )}

        {/* ARR display */}
        <div className="mb-4">
          <span className="text-2xl font-bold text-gray-900 dark:text-white">
            {formatArrCompact(p.actualArr)}
          </span>
          {p.isEstimate && (
            <span className="text-sm text-yellow-600 dark:text-yellow-400 ml-1">(est)</span>
          )}
          {p.hasQuota && (
            <span className="text-sm text-gray-500 dark:text-gray-400 ml-2">
              of {formatArrCompact(p.quotaArr)}
            </span>
          )}
        </div>

        {/* Progress bar */}
        {p.hasQuota && (
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden mb-4">
            <div
              className={`h-full transition-all duration-500 ${getProgressBarColor(p.progressPercent)}`}
              style={{ width: `${progressBarPercent}%` }}
            />
          </div>
        )}

        {/* Stats grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">Joined</p>
            <p className="text-lg font-semibold text-gray-900 dark:text-white">{p.joinedCount}</p>
          </div>
          <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">Expected ARR</p>
            <p className="text-lg font-semibold text-gray-900 dark:text-white">{formatArrCompact(p.expectedArr)}</p>
          </div>
          <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">Projected ARR</p>
            <p className="text-lg font-semibold text-gray-900 dark:text-white">{formatArrCompact(p.projectedArr)}</p>
          </div>
          <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">Days Elapsed</p>
            <p className="text-lg font-semibold text-gray-900 dark:text-white">
              {p.daysElapsed} / {p.daysInQuarter}
            </p>
          </div>
        </div>
      </Card>

      {/* Historical Chart */}
      <Card className="mt-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Historical ARR by Quarter
        </h3>
        {historicalLoading ? (
          <div className="h-64 animate-pulse bg-gray-100 dark:bg-gray-800 rounded" />
        ) : chartData.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400 py-8 text-center">No historical data</p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
              <XAxis dataKey="quarter" tick={{ fill: axisColor, fontSize: 12 }} />
              <YAxis
                tickFormatter={(v) => formatArrCompact(v)}
                tick={{ fill: axisColor, fontSize: 12 }}
                domain={[0, (dataMax: number) => {
                  const goalMax = p.hasQuota ? p.quotaArr : 0;
                  const max = Math.max(dataMax, goalMax);
                  return Math.ceil(max * 1.1); // 10% headroom above the higher of data/goal
                }]}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: isDark ? '#1f2937' : '#ffffff',
                  borderColor: isDark ? '#374151' : '#e5e7eb',
                  color: isDark ? '#f9fafb' : '#111827',
                }}
                itemStyle={{
                  color: isDark ? '#f9fafb' : '#111827',
                }}
                labelStyle={{
                  color: isDark ? '#f9fafb' : '#111827',
                }}
                formatter={(value: any) => {
                  const v = typeof value === 'number' ? value : 0;
                  return [formatArrCompact(v), 'Actual ARR'];
                }}
                labelFormatter={(label) => {
                  const item = chartData.find(d => d.quarter === label);
                  let str = label;
                  if (item?.joinedCount) str += ` (${item.joinedCount} joined)`;
                  if (item?.isEstimate) str += ' (est)';
                  return str;
                }}
              />
              <Bar
                dataKey="actualArr"
                name="actualArr"
                isAnimationActive={false}
                cursor="pointer"
                onClick={(_data, index) => {
                  if (index >= 0 && chartData[index]) {
                    onHistoricalBarClick(chartData[index].quarterKey);
                  }
                }}
              >
                {chartData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={isDark ? '#60a5fa' : '#3b82f6'}
                  />
                ))}
              </Bar>
              {/* Goal reference line — horizontal dashed line at current quarter's quota */}
              {p.hasQuota && (
                <ReferenceLine
                  y={p.quotaArr}
                  stroke={isDark ? '#f59e0b' : '#d97706'}
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  label={{
                    value: `Goal: ${formatArrCompact(p.quotaArr)}`,
                    position: 'right',
                    fill: isDark ? '#f59e0b' : '#d97706',
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                />
              )}
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Open Opportunities Table */}
      <SGMOpenOppsTable
        opps={openOpps}
        loading={openOppsLoading}
        onAdvisorClick={onOpenOppClick}
      />
    </div>
  );
}
