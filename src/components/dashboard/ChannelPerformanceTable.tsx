'use client';

import { Card, Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell, Badge } from '@tremor/react';
import { ChannelPerformanceWithGoals } from '@/types/dashboard';
import { formatCurrency, formatPercent, formatNumber } from '@/lib/utils/date-helpers';
import { 
  calculateVariance, 
  formatDifference,
  getVarianceColorClass 
} from '@/lib/utils/goal-helpers';
import { ExportButton } from '@/components/ui/ExportButton';

interface ChannelPerformanceTableProps {
  channels: ChannelPerformanceWithGoals[];
  selectedChannel?: string | null;
  onChannelClick?: (channel: string | null) => void;
}

// Helper component for displaying metric with goal
function MetricWithGoal({ 
  actual, 
  goal 
}: { 
  actual: number; 
  goal?: number;
}) {
  if (!goal || goal === 0) {
    return <span>{formatNumber(actual)}</span>;
  }
  
  const variance = calculateVariance(actual, goal);
  const colorClass = getVarianceColorClass(variance.isOnTrack);
  
  return (
    <div className="flex flex-col items-end">
      <span className="font-medium">{formatNumber(actual)}</span>
      <span className="text-xs text-gray-500 dark:text-gray-400">
        / {goal.toFixed(1)}
      </span>
      <span className={`text-xs font-medium ${colorClass}`}>
        {formatDifference(variance.difference)}
      </span>
    </div>
  );
}

export function ChannelPerformanceTable({ 
  channels, 
  selectedChannel, 
  onChannelClick 
}: ChannelPerformanceTableProps) {
  // Check if any channel has goals to determine if we show goal info
  const hasGoals = channels.some(c => c.goals && (c.goals.sqls > 0 || c.goals.sqos > 0));
  
  // Prepare data for CSV export
  const exportData = channels.map(channel => ({
    Channel: channel.channel,
    SQLs: channel.sqls,
    'SQLs Goal': channel.goals?.sqls ?? '',
    SQOs: channel.sqos,
    'SQOs Goal': channel.goals?.sqos ?? '',
    'SQL→SQO Rate': (channel.sqlToSqoRate * 100).toFixed(2) + '%',
    Joined: channel.joined,
    'Joined Goal': channel.goals?.joined ?? '',
    'SQO→Joined Rate': (channel.sqoToJoinedRate * 100).toFixed(2) + '%',
    AUM: channel.aum,
  }));

  return (
    <Card className="mb-6 dark:bg-gray-800 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Channel Performance
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Click a row to filter by channel
            {hasGoals && ' • Goals shown below actuals'}
          </p>
        </div>
        <ExportButton data={exportData} filename="channel-performance" />
      </div>
      
      <div className="overflow-x-auto">
        <Table>
          <TableHead>
            <TableRow className="bg-gray-50 dark:bg-gray-900">
              <TableHeaderCell className="border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                Channel
              </TableHeaderCell>
              <TableHeaderCell className="text-right border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                SQLs{hasGoals && ' / Goal'}
              </TableHeaderCell>
              <TableHeaderCell className="text-right border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                SQOs{hasGoals && ' / Goal'}
              </TableHeaderCell>
              <TableHeaderCell className="text-right border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                SQL→SQO
              </TableHeaderCell>
              <TableHeaderCell className="text-right border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                Joined{hasGoals && ' / Goal'}
              </TableHeaderCell>
              <TableHeaderCell className="text-right border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                SQO→Joined
              </TableHeaderCell>
              <TableHeaderCell className="text-right text-gray-600 dark:text-gray-400">
                AUM
              </TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {channels.map((channel, idx) => {
              const isSelected = selectedChannel === channel.channel;
              const zebraClass = idx % 2 === 0 
                ? 'bg-white dark:bg-gray-800' 
                : 'bg-gray-50 dark:bg-gray-900';
              
              return (
                <TableRow
                  key={channel.channel}
                  className={`
                    cursor-pointer transition-colors
                    ${isSelected 
                      ? 'bg-blue-50 dark:bg-blue-900/30' 
                      : `${zebraClass} hover:bg-gray-100 dark:hover:bg-gray-700`
                    }
                  `}
                  onClick={() => onChannelClick?.(
                    isSelected ? null : channel.channel
                  )}
                >
                  <TableCell className="border-r border-gray-100 dark:border-gray-800">
                    <span className="font-medium text-gray-900 dark:text-white">
                      {channel.channel}
                    </span>
                  </TableCell>
                  <TableCell className="text-right border-r border-gray-100 dark:border-gray-800">
                    <MetricWithGoal actual={channel.sqls} goal={channel.goals?.sqls} />
                  </TableCell>
                  <TableCell className="text-right border-r border-gray-100 dark:border-gray-800">
                    <MetricWithGoal actual={channel.sqos} goal={channel.goals?.sqos} />
                  </TableCell>
                  <TableCell className="text-right border-r border-gray-100 dark:border-gray-800">
                    <Badge 
                      size="sm" 
                      color={channel.sqlToSqoRate >= 0.5 ? 'green' : channel.sqlToSqoRate >= 0.3 ? 'yellow' : 'red'}
                    >
                      {formatPercent(channel.sqlToSqoRate)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right border-r border-gray-100 dark:border-gray-800">
                    <MetricWithGoal actual={channel.joined} goal={channel.goals?.joined} />
                  </TableCell>
                  <TableCell className="text-right border-r border-gray-100 dark:border-gray-800">
                    <Badge 
                      size="sm" 
                      color={channel.sqoToJoinedRate >= 0.15 ? 'green' : channel.sqoToJoinedRate >= 0.08 ? 'yellow' : 'red'}
                    >
                      {formatPercent(channel.sqoToJoinedRate)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium text-gray-900 dark:text-white">
                    {formatCurrency(channel.aum)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      
      {channels.length === 0 && (
        <div className="p-8 text-center text-gray-500 dark:text-gray-400">
          No channel data available
        </div>
      )}
    </Card>
  );
}
