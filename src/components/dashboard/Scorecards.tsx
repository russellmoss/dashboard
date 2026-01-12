'use client';

import { Card, Metric, Text, Badge } from '@tremor/react';
import { FunnelMetricsWithGoals, ForecastGoals } from '@/types/dashboard';
import { formatCurrency, formatNumber } from '@/lib/utils/date-helpers';
import { 
  calculateVariance, 
  formatDifference, 
  formatPercentVariance,
  getVarianceColorClass,
  getVarianceBadgeColor 
} from '@/lib/utils/goal-helpers';
import { TrendingUp, Users, DollarSign, Package } from 'lucide-react';
import { OpenPipelineAumTooltip } from './OpenPipelineAumTooltip';

interface ScorecardsProps {
  metrics: FunnelMetricsWithGoals;
  selectedMetric?: string | null;
  onMetricClick?: (metric: string) => void;
}

// Sub-component for displaying goal variance
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

export function Scorecards({ metrics, selectedMetric, onMetricClick }: ScorecardsProps) {
  const isSelected = (id: string) => selectedMetric === id;
  const goals = metrics.goals;
  
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {/* SQLs Card */}
      <Card 
        className={`p-4 dark:bg-gray-800 dark:border-gray-700 ${
          onMetricClick 
            ? `cursor-pointer transition-all hover:bg-gray-50 dark:hover:bg-gray-700 ${
                isSelected('sql') 
                  ? 'ring-2 ring-blue-500 dark:ring-blue-400 bg-blue-50 dark:bg-blue-900/30' 
                  : ''
              }` 
            : ''
        }`}
        onClick={() => onMetricClick?.('sql')}
      >
        <div className="flex items-center justify-between mb-2">
          <Text className="text-gray-600 dark:text-gray-400">SQLs</Text>
          <Users className="w-5 h-5 text-blue-500 dark:text-blue-400" />
        </div>
        <Metric className="text-2xl font-bold text-gray-900 dark:text-white">
          {formatNumber(metrics.sqls)}
        </Metric>
        <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Sales Qualified Leads
        </Text>
        {goals && goals.sqls > 0 && (
          <GoalDisplay actual={metrics.sqls} goal={goals.sqls} label="SQL" />
        )}
      </Card>

      {/* SQOs Card */}
      <Card 
        className={`p-4 dark:bg-gray-800 dark:border-gray-700 ${
          onMetricClick 
            ? `cursor-pointer transition-all hover:bg-gray-50 dark:hover:bg-gray-700 ${
                isSelected('sqo') 
                  ? 'ring-2 ring-blue-500 dark:ring-blue-400 bg-blue-50 dark:bg-blue-900/30' 
                  : ''
              }` 
            : ''
        }`}
        onClick={() => onMetricClick?.('sqo')}
      >
        <div className="flex items-center justify-between mb-2">
          <Text className="text-gray-600 dark:text-gray-400">SQOs</Text>
          <TrendingUp className="w-5 h-5 text-green-500 dark:text-green-400" />
        </div>
        <Metric className="text-2xl font-bold text-gray-900 dark:text-white">
          {formatNumber(metrics.sqos)}
        </Metric>
        <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Sales Qualified Opportunities
        </Text>
        {goals && goals.sqos > 0 && (
          <GoalDisplay actual={metrics.sqos} goal={goals.sqos} label="SQO" />
        )}
      </Card>

      {/* Joined Card */}
      <Card 
        className={`p-4 dark:bg-gray-800 dark:border-gray-700 ${
          onMetricClick 
            ? `cursor-pointer transition-all hover:bg-gray-50 dark:hover:bg-gray-700 ${
                isSelected('joined') 
                  ? 'ring-2 ring-blue-500 dark:ring-blue-400 bg-blue-50 dark:bg-blue-900/30' 
                  : ''
              }` 
            : ''
        }`}
        onClick={() => onMetricClick?.('joined')}
      >
        <div className="flex items-center justify-between mb-2">
          <Text className="text-gray-600 dark:text-gray-400">Joined</Text>
          <Package className="w-5 h-5 text-purple-500 dark:text-purple-400" />
        </div>
        <Metric className="text-2xl font-bold text-gray-900 dark:text-white">
          {formatNumber(metrics.joined)}
        </Metric>
        <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Advisors Joined
        </Text>
        {goals && goals.joined > 0 && (
          <GoalDisplay actual={metrics.joined} goal={goals.joined} label="Joined" />
        )}
      </Card>

      {/* Open Pipeline Card - No goals */}
      <Card 
        className={`p-4 dark:bg-gray-800 dark:border-gray-700 ${
          onMetricClick 
            ? `cursor-pointer transition-all hover:bg-gray-50 dark:hover:bg-gray-700 ${
                isSelected('openPipeline') 
                  ? 'ring-2 ring-blue-500 dark:ring-blue-400 bg-blue-50 dark:bg-blue-900/30' 
                  : ''
              }` 
            : ''
        }`}
        onClick={() => onMetricClick?.('openPipeline')}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center">
            <Text className="text-gray-600 dark:text-gray-400">Open Pipeline</Text>
            <OpenPipelineAumTooltip />
          </div>
          <DollarSign className="w-5 h-5 text-amber-500 dark:text-amber-400" />
        </div>
        <Metric className="text-2xl font-bold text-gray-900 dark:text-white">
          {formatCurrency(metrics.openPipelineAum)}
        </Metric>
        <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Pipeline AUM
        </Text>
      </Card>
    </div>
  );
}
