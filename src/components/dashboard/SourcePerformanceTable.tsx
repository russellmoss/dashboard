'use client';

import { Card, Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell, Badge } from '@tremor/react';
import { SourcePerformanceWithGoals } from '@/types/dashboard';
import { formatCurrency, formatPercent, formatNumber } from '@/lib/utils/date-helpers';
import { 
  calculateVariance, 
  formatDifference,
  getVarianceColorClass 
} from '@/lib/utils/goal-helpers';
import { ExportButton } from '@/components/ui/ExportButton';

interface SourcePerformanceTableProps {
  sources: SourcePerformanceWithGoals[];
  selectedSource?: string | null;
  onSourceClick?: (source: string | null) => void;
  channelFilter?: string | null;
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

export function SourcePerformanceTable({ 
  sources, 
  selectedSource, 
  onSourceClick, 
  channelFilter 
}: SourcePerformanceTableProps) {
  const filteredSources = channelFilter 
    ? sources.filter(s => s.channel === channelFilter)
    : sources;
  
  // Check if any source has goals
  const hasGoals = filteredSources.some(s => s.goals && (s.goals.sqls > 0 || s.goals.sqos > 0));
  
  // Prepare data for CSV export
  const exportData = filteredSources.map(source => ({
    Source: source.source,
    Channel: source.channel,
    Prospects: source.prospects,
    Contacted: source.contacted,
    MQLs: source.mqls,
    SQLs: source.sqls,
    'SQLs Goal': source.goals?.sqls ?? '',
    SQOs: source.sqos,
    'SQOs Goal': source.goals?.sqos ?? '',
    Joined: source.joined,
    'Joined Goal': source.goals?.joined ?? '',
    'MQL→SQL Rate': (source.mqlToSqlRate * 100).toFixed(2) + '%',
    'SQL→SQO Rate': (source.sqlToSqoRate * 100).toFixed(2) + '%',
    'SQO→Joined Rate': (source.sqoToJoinedRate * 100).toFixed(2) + '%',
    AUM: source.aum,
  }));

  return (
    <Card className="mb-6 dark:bg-gray-800 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Source Performance
            {channelFilter && (
              <span className="ml-2 text-sm font-normal text-gray-500 dark:text-gray-400">
                (Filtered by: {channelFilter})
              </span>
            )}
          </h3>
          {hasGoals && (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Goals shown below actuals
            </p>
          )}
        </div>
        <ExportButton data={exportData} filename="source-performance" />
      </div>
      
      <div className="overflow-x-auto">
        <Table>
          <TableHead>
            <TableRow className="bg-gray-50 dark:bg-gray-900">
              <TableHeaderCell className="border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                Source
              </TableHeaderCell>
              <TableHeaderCell className="border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                Channel
              </TableHeaderCell>
              <TableHeaderCell className="text-right border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                MQLs
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
            {filteredSources.map((source, idx) => {
              const isSelected = selectedSource === source.source;
              const zebraClass = idx % 2 === 0 
                ? 'bg-white dark:bg-gray-800' 
                : 'bg-gray-50 dark:bg-gray-900';
              
              return (
                <TableRow
                  key={source.source}
                  className={`
                    cursor-pointer transition-colors
                    ${isSelected 
                      ? 'bg-blue-50 dark:bg-blue-900/30' 
                      : `${zebraClass} hover:bg-gray-100 dark:hover:bg-gray-700`
                    }
                  `}
                  onClick={() => onSourceClick?.(
                    isSelected ? null : source.source
                  )}
                >
                  <TableCell className="border-r border-gray-100 dark:border-gray-800">
                    <span className="font-medium text-gray-900 dark:text-white">
                      {source.source}
                    </span>
                  </TableCell>
                  <TableCell className="border-r border-gray-100 dark:border-gray-800 text-gray-600 dark:text-gray-400">
                    {source.channel}
                  </TableCell>
                  <TableCell className="text-right border-r border-gray-100 dark:border-gray-800">
                    {formatNumber(source.mqls)}
                  </TableCell>
                  <TableCell className="text-right border-r border-gray-100 dark:border-gray-800">
                    <MetricWithGoal actual={source.sqls} goal={source.goals?.sqls} />
                  </TableCell>
                  <TableCell className="text-right border-r border-gray-100 dark:border-gray-800">
                    <MetricWithGoal actual={source.sqos} goal={source.goals?.sqos} />
                  </TableCell>
                  <TableCell className="text-right border-r border-gray-100 dark:border-gray-800">
                    <Badge 
                      size="sm" 
                      color={source.sqlToSqoRate >= 0.5 ? 'green' : source.sqlToSqoRate >= 0.3 ? 'yellow' : 'red'}
                    >
                      {formatPercent(source.sqlToSqoRate)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right border-r border-gray-100 dark:border-gray-800">
                    <MetricWithGoal actual={source.joined} goal={source.goals?.joined} />
                  </TableCell>
                  <TableCell className="text-right border-r border-gray-100 dark:border-gray-800">
                    <Badge 
                      size="sm" 
                      color={source.sqoToJoinedRate >= 0.15 ? 'green' : source.sqoToJoinedRate >= 0.08 ? 'yellow' : 'red'}
                    >
                      {formatPercent(source.sqoToJoinedRate)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium text-gray-900 dark:text-white">
                    {formatCurrency(source.aum)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      
      {filteredSources.length === 0 && (
        <div className="p-8 text-center text-gray-500 dark:text-gray-400">
          No source data available
        </div>
      )}
    </Card>
  );
}
