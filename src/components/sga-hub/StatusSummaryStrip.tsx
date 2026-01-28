// src/components/sga-hub/StatusSummaryStrip.tsx

'use client';

import { Card, Text } from '@tremor/react';
import { TrendingUp, TrendingDown, Minus, Circle } from 'lucide-react';

interface StatusSummaryStripProps {
  quarterLabel: string;
  totalSGAs: number;
  aheadCount: number;
  onTrackCount: number;
  behindCount: number;
  noGoalCount: number;
}

export function StatusSummaryStrip({
  quarterLabel,
  totalSGAs,
  aheadCount,
  onTrackCount,
  behindCount,
  noGoalCount,
}: StatusSummaryStripProps) {
  return (
    <Card className="mb-4 dark:bg-gray-800 dark:border-gray-700">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <Text className="text-lg font-semibold text-gray-900 dark:text-white">
            {quarterLabel} TEAM STATUS
          </Text>
          <Text className="text-sm text-gray-500 dark:text-gray-400">
            {totalSGAs} Total SGAs
          </Text>
        </div>
        
        <div className="flex items-center gap-4 flex-wrap">
          {/* Ahead */}
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-green-500"></div>
            <Text className="text-sm font-medium text-gray-900 dark:text-white">
              {aheadCount} Ahead
            </Text>
          </div>
          
          {/* On-Track */}
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
            <Text className="text-sm font-medium text-gray-900 dark:text-white">
              {onTrackCount} On-Track
            </Text>
          </div>
          
          {/* Behind */}
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500"></div>
            <Text className="text-sm font-medium text-gray-900 dark:text-white">
              {behindCount} Behind
            </Text>
          </div>
          
          {/* No Goal */}
          {noGoalCount > 0 && (
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-gray-400"></div>
              <Text className="text-sm font-medium text-gray-600 dark:text-gray-400">
                {noGoalCount} No Goal
              </Text>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
