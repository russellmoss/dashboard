// src/components/sga-hub/QuarterlyProgressCard.tsx

'use client';

import { Card, Metric, Text, Badge } from '@tremor/react';
import { QuarterlyProgress } from '@/types/sga-hub';
import { TrendingUp, TrendingDown, Minus, Target } from 'lucide-react';

interface QuarterlyProgressCardProps {
  progress: QuarterlyProgress;
  // New prop for SQO click
  onSQOClick?: () => void;
}

/**
 * Get color classes for pacing status badge
 */
function getPacingBadgeColor(status: QuarterlyProgress['pacingStatus']): string {
  switch (status) {
    case 'ahead':
      return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
    case 'on-track':
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
    case 'behind':
      return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
    case 'no-goal':
      return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
    default:
      return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
  }
}

/**
 * Get icon for pacing status
 */
function getPacingIcon(status: QuarterlyProgress['pacingStatus']) {
  switch (status) {
    case 'ahead':
      return <TrendingUp className="w-4 h-4" />;
    case 'behind':
      return <TrendingDown className="w-4 h-4" />;
    case 'on-track':
      return <Minus className="w-4 h-4" />;
    default:
      return <Target className="w-4 h-4" />;
  }
}

/**
 * Get label for pacing status
 */
function getPacingLabel(status: QuarterlyProgress['pacingStatus'], diff: number): string {
  switch (status) {
    case 'ahead':
      return `Ahead by ${Math.abs(diff).toFixed(1)} SQOs`;
    case 'behind':
      return `Behind by ${Math.abs(diff).toFixed(1)} SQOs`;
    case 'on-track':
      return 'On Track';
    case 'no-goal':
      return 'No Goal Set';
    default:
      return 'Unknown';
  }
}

export function QuarterlyProgressCard({ progress, onSQOClick }: QuarterlyProgressCardProps) {
  const {
    quarterLabel,
    sqoGoal,
    hasGoal,
    sqoActual,
    totalAumFormatted,
    progressPercent,
    daysElapsed,
    daysInQuarter,
    expectedSqos,
    pacingDiff,
    pacingStatus,
  } = progress;

  // Calculate progress bar percentage (clamp to 0-100)
  const progressBarPercent = hasGoal && sqoGoal && sqoGoal > 0
    ? Math.min(100, Math.max(0, progressPercent || 0))
    : 0;

  return (
    <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <Text className="text-gray-600 dark:text-gray-400 text-sm">Quarterly Progress</Text>
          <Metric className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
            {quarterLabel}
          </Metric>
        </div>
        <Badge className={getPacingBadgeColor(pacingStatus)} size="lg">
          <div className="flex items-center gap-1.5">
            {getPacingIcon(pacingStatus)}
            <span>{getPacingLabel(pacingStatus, pacingDiff)}</span>
          </div>
        </Badge>
      </div>

      {/* SQO Progress */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Text className="text-gray-600 dark:text-gray-400 text-sm font-medium">SQOs:</Text>
            {onSQOClick ? (
              <ClickableMetricValue
                value={Math.round(sqoActual)}
                onClick={onSQOClick}
              />
            ) : (
              <Text className="text-xl font-bold text-gray-900 dark:text-white">
                {sqoActual.toFixed(0)}
              </Text>
            )}
            {hasGoal && sqoGoal && (
              <Text className="text-sm text-gray-500 dark:text-gray-400">
                of {sqoGoal.toFixed(0)}
              </Text>
            )}
          </div>
          {hasGoal && progressPercent !== null && (
            <Text className="text-gray-900 dark:text-white font-semibold">
              {progressPercent.toFixed(0)}%
            </Text>
          )}
        </div>
        
        {/* Progress Bar */}
        {hasGoal && sqoGoal && sqoGoal > 0 ? (
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${
                progressBarPercent >= 100
                  ? 'bg-green-500 dark:bg-green-600'
                  : progressBarPercent >= 75
                  ? 'bg-blue-500 dark:bg-blue-600'
                  : progressBarPercent >= 50
                  ? 'bg-yellow-500 dark:bg-yellow-600'
                  : 'bg-red-500 dark:bg-red-600'
              }`}
              style={{ width: `${progressBarPercent}%` }}
            />
          </div>
        ) : (
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
            <div className="h-full w-0" />
          </div>
        )}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        {/* Total AUM */}
        <div className="p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
          <Text className="text-gray-600 dark:text-gray-400 text-xs mb-1">Total AUM</Text>
          <Text className="text-gray-900 dark:text-white font-semibold text-lg">
            {totalAumFormatted}
          </Text>
        </div>

        {/* Expected SQOs */}
        {hasGoal && (
          <div className="p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
            <Text className="text-gray-600 dark:text-gray-400 text-xs mb-1">Expected SQOs</Text>
            <Text className="text-gray-900 dark:text-white font-semibold text-lg">
              {expectedSqos.toFixed(1)}
            </Text>
          </div>
        )}
      </div>

      {/* Time Progress */}
      <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
          <span>Days Elapsed: {daysElapsed} / {daysInQuarter}</span>
          <span>{Math.round((daysElapsed / daysInQuarter) * 100)}% of quarter</span>
        </div>
      </div>
    </Card>
  );
}
