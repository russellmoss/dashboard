'use client';

import { Card, Metric, Text, Badge } from '@tremor/react';
import { FunnelMetricsWithGoals, ForecastGoals } from '@/types/dashboard';
import { formatCurrency, formatNumber, formatAumCompact } from '@/lib/utils/date-helpers';
import { 
  calculateVariance, 
  formatDifference, 
  formatPercentVariance,
  getVarianceColorClass,
  getVarianceBadgeColor 
} from '@/lib/utils/goal-helpers';
import { TrendingUp, Users, DollarSign, Package, FileCheck } from 'lucide-react';
import { OpenPipelineAumTooltip } from './OpenPipelineAumTooltip';

interface ScorecardsProps {
  metrics: FunnelMetricsWithGoals;
  selectedMetric?: string | null;
  onMetricClick?: (metric: string) => void;
  visibleMetrics?: {
    sqls: boolean;
    sqos: boolean;
    signed: boolean;
    signedAum: boolean;
    joined: boolean;
    joinedAum: boolean;
    openPipeline: boolean;
  };
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

export function Scorecards({ 
  metrics, 
  selectedMetric, 
  onMetricClick,
  visibleMetrics = { sqls: true, sqos: true, signed: true, signedAum: true, joined: true, joinedAum: true, openPipeline: true },
}: ScorecardsProps) {
  const goals = metrics.goals;
  
  // Don't render if no metrics are visible
  if (!visibleMetrics.sqls && !visibleMetrics.sqos && !visibleMetrics.signed && !visibleMetrics.signedAum &&
      !visibleMetrics.joined && !visibleMetrics.joinedAum && !visibleMetrics.openPipeline) {
    return null;
  }
  
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {/* SQLs Card */}
      {visibleMetrics.sqls && (
      <Card 
        className={`p-4 dark:bg-gray-800 dark:border-gray-700 ${
          onMetricClick 
            ? 'cursor-pointer transition-all hover:bg-gray-50 dark:hover:bg-gray-700 hover:shadow-md' 
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
      )}

      {/* SQOs Card */}
      {visibleMetrics.sqos && (
      <Card 
        className={`p-4 dark:bg-gray-800 dark:border-gray-700 ${
          onMetricClick 
            ? 'cursor-pointer transition-all hover:bg-gray-50 dark:hover:bg-gray-700 hover:shadow-md' 
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
      )}

      {/* Signed column: Signed card with Signed AUM directly beneath */}
      {(visibleMetrics.signed || visibleMetrics.signedAum) && (
      <div className="flex flex-col gap-4">
        {visibleMetrics.signed && (
        <Card 
          className={`p-4 dark:bg-gray-800 dark:border-gray-700 ${
            onMetricClick 
              ? 'cursor-pointer transition-all hover:bg-gray-50 dark:hover:bg-gray-700 hover:shadow-md' 
              : ''
          }`}
          onClick={() => onMetricClick?.('signed')}
        >
          <div className="flex items-center justify-between mb-2">
            <Text className="text-gray-600 dark:text-gray-400">Signed</Text>
            <FileCheck className="w-5 h-5 text-indigo-500 dark:text-indigo-400" />
          </div>
          <Metric className="text-2xl font-bold text-gray-900 dark:text-white">
            {formatNumber(metrics.signed)}
          </Metric>
          <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Signed Advisors
          </Text>
        </Card>
        )}
        {visibleMetrics.signedAum && (
        <Card 
          className={`p-4 dark:bg-gray-800 dark:border-gray-700 ${
            onMetricClick 
              ? 'cursor-pointer transition-all hover:bg-gray-50 dark:hover:bg-gray-700 hover:shadow-md' 
              : ''
          }`}
          onClick={() => onMetricClick?.('signed')}
        >
          <div className="flex items-center justify-between mb-2">
            <Text className="text-gray-600 dark:text-gray-400">Signed AUM</Text>
            <DollarSign className="w-5 h-5 text-indigo-500 dark:text-indigo-400" />
          </div>
          <Metric className="text-2xl font-bold text-gray-900 dark:text-white">
            {formatAumCompact(metrics.signedAum)}
          </Metric>
          <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            AUM of Signed Advisors (Underwritten / Amount)
          </Text>
        </Card>
        )}
      </div>
      )}

      {/* Joined column: Joined card with Joined AUM directly beneath */}
      {(visibleMetrics.joined || visibleMetrics.joinedAum) && (
      <div className="flex flex-col gap-4">
        {visibleMetrics.joined && (
        <Card 
          className={`p-4 dark:bg-gray-800 dark:border-gray-700 ${
            onMetricClick 
              ? 'cursor-pointer transition-all hover:bg-gray-50 dark:hover:bg-gray-700 hover:shadow-md' 
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
        )}
        {visibleMetrics.joinedAum && (
        <Card 
          className={`p-4 dark:bg-gray-800 dark:border-gray-700 ${
            onMetricClick 
              ? 'cursor-pointer transition-all hover:bg-gray-50 dark:hover:bg-gray-700 hover:shadow-md' 
              : ''
          }`}
          onClick={() => onMetricClick?.('joined')}
        >
          <div className="flex items-center justify-between mb-2">
            <Text className="text-gray-600 dark:text-gray-400">Joined AUM</Text>
            <DollarSign className="w-5 h-5 text-purple-500 dark:text-purple-400" />
          </div>
          <Metric className="text-2xl font-bold text-gray-900 dark:text-white">
            {formatAumCompact(metrics.joinedAum)}
          </Metric>
          <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            AUM of Advisors Joined (Underwritten / Amount)
          </Text>
        </Card>
        )}
      </div>
      )}

      {/* Open Pipeline Card - No goals */}
      {visibleMetrics.openPipeline && (
      <Card 
        className={`p-4 dark:bg-gray-800 dark:border-gray-700 ${
          onMetricClick 
            ? 'cursor-pointer transition-all hover:bg-gray-50 dark:hover:bg-gray-700 hover:shadow-md' 
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
      )}
    </div>
  );
}
