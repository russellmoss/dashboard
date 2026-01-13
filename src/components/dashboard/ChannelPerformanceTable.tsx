'use client';

import { useState, useMemo } from 'react';
import { Card, Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell, Badge } from '@tremor/react';
import { ChannelPerformanceWithGoals } from '@/types/dashboard';
import { formatCurrency, formatPercent, formatNumber } from '@/lib/utils/date-helpers';
import { 
  calculateVariance, 
  formatDifference,
  getVarianceColorClass 
} from '@/lib/utils/goal-helpers';
import { ExportButton } from '@/components/ui/ExportButton';
import { ChevronUp, ChevronDown } from 'lucide-react';

type SortColumn = 'channel' | 'prospects' | 'contacted' | 'mqls' | 'contactedToMql' | 'mqlToSql' | 'sqls' | 'sqos' | 'sqlToSqo' | 'joined' | 'sqoToJoined' | 'aum' | null;
type SortDirection = 'asc' | 'desc';

interface ChannelPerformanceTableProps {
  channels: ChannelPerformanceWithGoals[];
  selectedChannel?: string | null;
  onChannelClick?: (channel: string | null) => void;
  viewMode?: 'focused' | 'fullFunnel';
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

/**
 * Sort channels based on column and direction
 * 
 * @param channels - Array of channel performance data to sort
 * @param sortColumn - Column to sort by (null for no sorting)
 * @param sortDirection - Sort direction ('asc' | 'desc')
 * @returns Sorted array of channels
 */
function sortChannels(channels: ChannelPerformanceWithGoals[], sortColumn: SortColumn, sortDirection: SortDirection): ChannelPerformanceWithGoals[] {
  if (!sortColumn) return channels;
  
  return [...channels].sort((a, b) => {
    let comparison = 0;
    
    switch (sortColumn) {
      case 'channel':
        comparison = (a.channel || '').toLowerCase().localeCompare((b.channel || '').toLowerCase());
        break;
      case 'prospects':
        comparison = (a.prospects || 0) - (b.prospects || 0);
        break;
      case 'contacted':
        comparison = (a.contacted || 0) - (b.contacted || 0);
        break;
      case 'mqls':
        comparison = (a.mqls || 0) - (b.mqls || 0);
        break;
      case 'contactedToMql':
        comparison = (a.contactedToMqlRate || 0) - (b.contactedToMqlRate || 0);
        break;
      case 'mqlToSql':
        comparison = (a.mqlToSqlRate || 0) - (b.mqlToSqlRate || 0);
        break;
      case 'sqls':
        comparison = (a.sqls || 0) - (b.sqls || 0);
        break;
      case 'sqos':
        comparison = (a.sqos || 0) - (b.sqos || 0);
        break;
      case 'sqlToSqo':
        comparison = (a.sqlToSqoRate || 0) - (b.sqlToSqoRate || 0);
        break;
      case 'joined':
        comparison = (a.joined || 0) - (b.joined || 0);
        break;
      case 'sqoToJoined':
        comparison = (a.sqoToJoinedRate || 0) - (b.sqoToJoinedRate || 0);
        break;
      case 'aum':
        comparison = (a.aum || 0) - (b.aum || 0);
        break;
    }
    
    return sortDirection === 'asc' ? comparison : -comparison;
  });
}

export function ChannelPerformanceTable({ 
  channels, 
  selectedChannel, 
  onChannelClick,
  viewMode = 'focused'
}: ChannelPerformanceTableProps) {
  const [sortColumn, setSortColumn] = useState<SortColumn>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  
  // Check if any channel has goals to determine if we show goal info
  const hasGoals = channels.some(c => c.goals && (c.goals.mqls > 0 || c.goals.sqls > 0 || c.goals.sqos > 0));
  
  // Sort channels
  const sortedChannels = useMemo(() => {
    return sortChannels(channels, sortColumn, sortDirection);
  }, [channels, sortColumn, sortDirection]);
  
  // Handle column header click for sorting
  const handleSort = (column: SortColumn) => {
    if (column === null) return;
    
    if (sortColumn === column) {
      // Toggle direction if clicking the same column
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      // Set new column and default to ascending
      setSortColumn(column);
      setSortDirection('asc');
    }
  };
  
  // Sortable header cell component
  const SortableHeader = ({ column, children }: { column: SortColumn; children: React.ReactNode }) => {
    const isActive = sortColumn === column;
    const showAsc = isActive && sortDirection === 'asc';
    const showDesc = isActive && sortDirection === 'desc';
    
    return (
      <TableHeaderCell 
        className={`border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 ${
          column !== null ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 select-none' : ''
        } text-right`}
        onClick={() => handleSort(column)}
      >
        <div className="flex items-center gap-1 justify-end">
          {children}
          {column !== null && (
            <div className="flex flex-col">
              <ChevronUp 
                className={`w-3 h-3 ${showAsc ? 'text-blue-600 dark:text-blue-400' : 'text-gray-300 dark:text-gray-600'}`} 
              />
              <ChevronDown 
                className={`w-3 h-3 -mt-1 ${showDesc ? 'text-blue-600 dark:text-blue-400' : 'text-gray-300 dark:text-gray-600'}`} 
              />
            </div>
          )}
        </div>
      </TableHeaderCell>
    );
  };
  
  // Prepare data for CSV export (use sorted channels)
  const exportData = sortedChannels.map(channel => ({
    Channel: channel.channel,
    ...(viewMode === 'fullFunnel' && {
      Prospects: channel.prospects,
      Contacted: channel.contacted,
      MQLs: channel.mqls,
      'MQLs Goal': channel.goals?.mqls ?? '',
      'Contacted→MQL Rate': (channel.contactedToMqlRate * 100).toFixed(2) + '%',
      'MQL→SQL Rate': (channel.mqlToSqlRate * 100).toFixed(2) + '%',
    }),
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
              <TableHeaderCell 
                className={`border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 ${
                  'channel' !== null ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 select-none' : ''
                }`}
                onClick={() => handleSort('channel')}
              >
                <div className="flex items-center gap-1">
                  Channel
                  <div className="flex flex-col">
                    <ChevronUp 
                      className={`w-3 h-3 ${sortColumn === 'channel' && sortDirection === 'asc' ? 'text-blue-600 dark:text-blue-400' : 'text-gray-300 dark:text-gray-600'}`} 
                    />
                    <ChevronDown 
                      className={`w-3 h-3 -mt-1 ${sortColumn === 'channel' && sortDirection === 'desc' ? 'text-blue-600 dark:text-blue-400' : 'text-gray-300 dark:text-gray-600'}`} 
                    />
                  </div>
                </div>
              </TableHeaderCell>
              {viewMode === 'fullFunnel' && (
                <>
                  <SortableHeader column="prospects">Prospects</SortableHeader>
                  <SortableHeader column="contacted">Contacted</SortableHeader>
                  <SortableHeader column="mqls">MQLs{hasGoals && ' / Goal'}</SortableHeader>
                  <SortableHeader column="contactedToMql">Contacted→MQL</SortableHeader>
                  <SortableHeader column="mqlToSql">MQL→SQL</SortableHeader>
                </>
              )}
              <SortableHeader column="sqls">SQLs{hasGoals && ' / Goal'}</SortableHeader>
              <SortableHeader column="sqos">SQOs{hasGoals && ' / Goal'}</SortableHeader>
              <SortableHeader column="sqlToSqo">SQL→SQO</SortableHeader>
              <SortableHeader column="joined">Joined{hasGoals && ' / Goal'}</SortableHeader>
              <SortableHeader column="sqoToJoined">SQO→Joined</SortableHeader>
              <SortableHeader column="aum">AUM</SortableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedChannels.map((channel, idx) => {
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
                  {viewMode === 'fullFunnel' && (
                    <>
                      <TableCell className="text-right border-r border-gray-100 dark:border-gray-800">
                        {formatNumber(channel.prospects)}
                      </TableCell>
                      <TableCell className="text-right border-r border-gray-100 dark:border-gray-800">
                        {formatNumber(channel.contacted)}
                      </TableCell>
                      <TableCell className="text-right border-r border-gray-100 dark:border-gray-800">
                        <MetricWithGoal actual={channel.mqls} goal={channel.goals?.mqls} />
                      </TableCell>
                      <TableCell className="text-right border-r border-gray-100 dark:border-gray-800">
                        <Badge 
                          size="sm" 
                          color={channel.contactedToMqlRate >= 0.05 ? 'green' : channel.contactedToMqlRate >= 0.03 ? 'yellow' : 'red'}
                        >
                          {formatPercent(channel.contactedToMqlRate)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right border-r border-gray-100 dark:border-gray-800">
                        <Badge 
                          size="sm" 
                          color={channel.mqlToSqlRate >= 0.3 ? 'green' : channel.mqlToSqlRate >= 0.2 ? 'yellow' : 'red'}
                        >
                          {formatPercent(channel.mqlToSqlRate)}
                        </Badge>
                      </TableCell>
                    </>
                  )}
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
      
      {sortedChannels.length === 0 && (
        <div className="p-8 text-center text-gray-500 dark:text-gray-400">
          No channel data available
        </div>
      )}
    </Card>
  );
}
