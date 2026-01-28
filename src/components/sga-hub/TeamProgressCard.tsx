// src/components/sga-hub/TeamProgressCard.tsx

'use client';

import { Card, Text } from '@tremor/react';
import { Target, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { getQuarterInfo } from '@/lib/utils/sga-hub-helpers';

interface TeamProgressCardProps {
  year: number;
  quarter: number;
  sgaIndividualGoalsAggregate: number; // Sum of all SGA goals
  sgaManagerGoal: number | null;       // Manager's goal
  currentSQOs: number;
  onSQOClick?: () => void; // Handler for clicking on Current SQOs number
}

export function TeamProgressCard({
  year,
  quarter,
  sgaIndividualGoalsAggregate,
  sgaManagerGoal,
  currentSQOs,
  onSQOClick,
}: TeamProgressCardProps) {
  const quarterInfo = getQuarterInfo(`${year}-Q${quarter}`);
  const startDate = new Date(quarterInfo.startDate);
  const endDate = new Date(quarterInfo.endDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Calculate days
  const daysInQuarter = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const daysElapsed = Math.min(
    Math.max(0, Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1),
    daysInQuarter
  );

  // Helper function to calculate pacing status
  const calculatePacingStatus = (goal: number): {
    status: 'ahead' | 'on-track' | 'behind' | 'no-goal';
    statusColor: string;
    StatusIcon: typeof TrendingUp | typeof TrendingDown | typeof Minus;
    expectedSQOs: number;
  } => {
    if (!goal || goal <= 0) {
      return {
        status: 'no-goal',
        statusColor: 'text-gray-500',
        StatusIcon: Minus,
        expectedSQOs: 0,
      };
    }

    const expectedSQOs = Math.round((goal / daysInQuarter) * daysElapsed);
    
    if (currentSQOs > expectedSQOs * 1.1) {
      return {
        status: 'ahead',
        statusColor: 'text-green-600 dark:text-green-400',
        StatusIcon: TrendingUp,
        expectedSQOs,
      };
    } else if (currentSQOs >= expectedSQOs * 0.9) {
      return {
        status: 'on-track',
        statusColor: 'text-yellow-600 dark:text-yellow-400',
        StatusIcon: Minus,
        expectedSQOs,
      };
    } else {
      return {
        status: 'behind',
        statusColor: 'text-red-600 dark:text-red-400',
        StatusIcon: TrendingDown,
        expectedSQOs,
      };
    }
  };

  // Calculate pacing for both goals
  const aggregatePacing = calculatePacingStatus(sgaIndividualGoalsAggregate);
  const managerPacing = calculatePacingStatus(sgaManagerGoal || 0);

  // Progress percentages against both goals
  const progressVsAggregate = sgaIndividualGoalsAggregate > 0
    ? Math.min(100, Math.round((currentSQOs / sgaIndividualGoalsAggregate) * 100))
    : 0;
  
  const progressVsManager = sgaManagerGoal && sgaManagerGoal > 0
    ? Math.min(100, Math.round((currentSQOs / sgaManagerGoal) * 100))
    : 0;

  return (
    <Card className="mb-6 dark:bg-gray-800 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Target className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          <Text className="text-lg font-semibold text-gray-900 dark:text-white">
            Team Progress - {quarterInfo.label}
          </Text>
        </div>
      </div>

      <div className="mb-6">
        <Text className="text-sm text-gray-500 dark:text-gray-400 mb-1">Current SQOs</Text>
        {onSQOClick ? (
          <button
            onClick={onSQOClick}
            className="text-3xl font-bold text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer"
            title="Click to view all SQOs in drill-down"
          >
            {currentSQOs}
          </button>
        ) : (
          <Text className="text-3xl font-bold text-gray-900 dark:text-white">
            {currentSQOs}
          </Text>
        )}
      </div>

      {/* Two Goal Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* vs. SGA Individual Goals (Aggregate) */}
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <Text className="text-sm text-gray-500 dark:text-gray-400 mb-2">
            vs. SGA Individual Goals (Aggregate)
          </Text>
          <Text className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
            {sgaIndividualGoalsAggregate}
          </Text>
          
          {/* Pacing Status for Individual Goals Aggregate */}
          {sgaIndividualGoalsAggregate > 0 && (() => {
            const AggregateIcon = aggregatePacing.StatusIcon;
            return (
              <div className="mb-3 pb-3 border-b border-gray-200 dark:border-gray-700">
                <Text className="text-xs text-gray-500 dark:text-gray-400 mb-1">Pacing Status</Text>
                <div className="flex items-center gap-2">
                  <AggregateIcon className={`w-4 h-4 ${aggregatePacing.statusColor}`} />
                  <Text className={`text-sm font-semibold ${aggregatePacing.statusColor}`}>
                    {aggregatePacing.status === 'ahead' ? 'Ahead' : aggregatePacing.status === 'on-track' ? 'On-track' : aggregatePacing.status === 'behind' ? 'Behind' : 'No goal set'}
                  </Text>
                </div>
                <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Expected: {aggregatePacing.expectedSQOs} ({daysElapsed}/{daysInQuarter} days)
                </Text>
              </div>
            );
          })()}
          
          <div className="flex items-center justify-between mb-2">
            <Text className="text-xs text-gray-500 dark:text-gray-400">Progress</Text>
            <Text className="text-sm font-medium text-gray-900 dark:text-white">
              {progressVsAggregate}%
            </Text>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all"
              style={{ width: `${Math.min(100, progressVsAggregate)}%` }}
            />
          </div>
          <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {currentSQOs >= sgaIndividualGoalsAggregate ? '✓' : ''} {currentSQOs} / {sgaIndividualGoalsAggregate}
          </Text>
        </div>

        {/* vs. SGA Manager Goal */}
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <Text className="text-sm text-gray-500 dark:text-gray-400 mb-2">
            vs. SGA Manager Goal
          </Text>
          <Text className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
            {sgaManagerGoal ?? 'Not set'}
          </Text>
          {sgaManagerGoal && sgaManagerGoal > 0 && (
            <>
              {/* Pacing Status for Manager Goal */}
              {(() => {
                const ManagerIcon = managerPacing.StatusIcon;
                return (
                  <div className="mb-3 pb-3 border-b border-gray-200 dark:border-gray-700">
                    <Text className="text-xs text-gray-500 dark:text-gray-400 mb-1">Pacing Status</Text>
                    <div className="flex items-center gap-2">
                      <ManagerIcon className={`w-4 h-4 ${managerPacing.statusColor}`} />
                      <Text className={`text-sm font-semibold ${managerPacing.statusColor}`}>
                        {managerPacing.status === 'ahead' ? 'Ahead' : managerPacing.status === 'on-track' ? 'On-track' : managerPacing.status === 'behind' ? 'Behind' : 'No goal set'}
                      </Text>
                    </div>
                    <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Expected: {managerPacing.expectedSQOs} ({daysElapsed}/{daysInQuarter} days)
                    </Text>
                  </div>
                );
              })()}
              
              <div className="flex items-center justify-between mb-2">
                <Text className="text-xs text-gray-500 dark:text-gray-400">Progress</Text>
                <Text className="text-sm font-medium text-gray-900 dark:text-white">
                  {progressVsManager}%
                </Text>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div
                  className="bg-green-600 h-2 rounded-full transition-all"
                  style={{ width: `${Math.min(100, progressVsManager)}%` }}
                />
              </div>
              <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {currentSQOs >= sgaManagerGoal ? '✓' : ''} {currentSQOs} / {sgaManagerGoal}
              </Text>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
