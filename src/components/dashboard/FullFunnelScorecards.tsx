'use client';

import { Card, Metric, Text } from '@tremor/react';
import { FunnelMetricsWithGoals } from '@/types/dashboard';
import { formatNumber } from '@/lib/utils/date-helpers';
import { 
  calculateVariance, 
  formatDifference, 
  formatPercentVariance,
  getVarianceColorClass,
} from '@/lib/utils/goal-helpers';
import { Users, MessageSquare, Calendar } from 'lucide-react';

interface FullFunnelScorecardsProps {
  metrics: FunnelMetricsWithGoals | null;
  selectedMetric?: string | null;
  onMetricClick?: (metric: string) => void;
  loading?: boolean;
}

/**
 * Sub-component for displaying goal variance (reuse from Scorecards.tsx)
 * Shows goal value and variance indicator with color coding
 */
function GoalDisplay({ 
  actual, 
  goal, 
  label 
}: { 
  actual: number; 
  goal: number; 
  label: string;
}) {
  const variance = calculateVariance(actual, goal);
  const colorClass = getVarianceColorClass(variance.isOnTrack);
  
  return (
    <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700">
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-500 dark:text-gray-400">
          Goal: {goal.toFixed(1)}
        </span>
        <span className={`font-medium ${colorClass}`}>
          {formatDifference(variance.difference)} ({formatPercentVariance(variance.percentVariance)})
        </span>
      </div>
    </div>
  );
}

/**
 * Scorecards component for Full Funnel View
 * Displays Prospects, Contacted, and MQL metrics with goal tracking
 * 
 * @param metrics - Funnel metrics with goals data
 * @param selectedMetric - Currently selected metric ID (for highlighting)
 * @param onMetricClick - Callback when a metric card is clicked
 * @param loading - Whether data is currently loading
 */
export function FullFunnelScorecards({
  metrics,
  selectedMetric,
  onMetricClick,
  loading = false,
}: FullFunnelScorecardsProps) {
  if (!metrics) return null;
  
  const goals = metrics.goals;
  const isSelected = (id: string) => selectedMetric === id;
  
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
      {/* Prospects Card */}
      <Card 
        className={`p-4 dark:bg-gray-800 dark:border-gray-700 ${
          onMetricClick 
            ? `cursor-pointer transition-all hover:bg-gray-50 dark:hover:bg-gray-700 ${
                isSelected('prospect') 
                  ? 'ring-2 ring-blue-500 dark:ring-blue-400 bg-blue-50 dark:bg-blue-900/30' 
                  : ''
              }` 
            : ''
        }`}
        onClick={() => onMetricClick?.('prospect')}
      >
        <div className="flex items-center justify-between mb-2">
          <Text className="text-gray-600 dark:text-gray-400">Prospects</Text>
          <Users className="w-5 h-5 text-slate-500 dark:text-slate-400" />
        </div>
        <Metric className="text-2xl font-bold text-gray-900 dark:text-white">
          {loading ? '...' : formatNumber(metrics.prospects)}
        </Metric>
        <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          All records in funnel
        </Text>
        {goals && goals.prospects > 0 && (
          <GoalDisplay actual={metrics.prospects} goal={goals.prospects} label="Prospects" />
        )}
      </Card>

      {/* Contacted Card */}
      <Card 
        className={`p-4 dark:bg-gray-800 dark:border-gray-700 ${
          onMetricClick 
            ? `cursor-pointer transition-all hover:bg-gray-50 dark:hover:bg-gray-700 ${
                isSelected('contacted') 
                  ? 'ring-2 ring-blue-500 dark:ring-blue-400 bg-blue-50 dark:bg-blue-900/30' 
                  : ''
              }` 
            : ''
        }`}
        onClick={() => onMetricClick?.('contacted')}
      >
        <div className="flex items-center justify-between mb-2">
          <Text className="text-gray-600 dark:text-gray-400">Contacted</Text>
          <MessageSquare className="w-5 h-5 text-zinc-500 dark:text-zinc-400" />
        </div>
        <Metric className="text-2xl font-bold text-gray-900 dark:text-white">
          {loading ? '...' : formatNumber(metrics.contacted)}
        </Metric>
        <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Leads contacted
        </Text>
        {/* No goals for contacted */}
      </Card>

      {/* MQLs Card */}
      <Card 
        className={`p-4 dark:bg-gray-800 dark:border-gray-700 ${
          onMetricClick 
            ? `cursor-pointer transition-all hover:bg-gray-50 dark:hover:bg-gray-700 ${
                isSelected('mql') 
                  ? 'ring-2 ring-blue-500 dark:ring-blue-400 bg-blue-50 dark:bg-blue-900/30' 
                  : ''
              }` 
            : ''
        }`}
        onClick={() => onMetricClick?.('mql')}
      >
        <div className="flex items-center justify-between mb-2">
          <Text className="text-gray-600 dark:text-gray-400">MQLs</Text>
          <Calendar className="w-5 h-5 text-blue-500 dark:text-blue-400" />
        </div>
        <Metric className="text-2xl font-bold text-gray-900 dark:text-white">
          {loading ? '...' : formatNumber(metrics.mqls)}
        </Metric>
        <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Marketing Qualified Leads
        </Text>
        {goals && goals.mqls > 0 && (
          <GoalDisplay actual={metrics.mqls} goal={goals.mqls} label="MQL" />
        )}
      </Card>
    </div>
  );
}
