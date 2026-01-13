'use client';

import { useState, useMemo } from 'react';
import { Card, Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell, Badge } from '@tremor/react';
import { SourcePerformanceWithGoals } from '@/types/dashboard';
import { formatCurrency, formatPercent, formatNumber } from '@/lib/utils/date-helpers';
import { 
  calculateVariance, 
  formatDifference,
  getVarianceColorClass 
} from '@/lib/utils/goal-helpers';
import { ExportButton } from '@/components/ui/ExportButton';
import { ChevronUp, ChevronDown } from 'lucide-react';

type SortColumn = 'source' | 'channel' | 'prospects' | 'contacted' | 'contactedToMql' | 'mqls' | 'mqlToSql' | 'sqls' | 'sqos' | 'sqlToSqo' | 'joined' | 'sqoToJoined' | 'aum' | null;
type SortDirection = 'asc' | 'desc';

interface SourcePerformanceTableProps {
  sources: SourcePerformanceWithGoals[];
  selectedSource?: string | null;
  onSourceClick?: (source: string | null) => void;
  channelFilter?: string | null;
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
 * Sort sources based on column and direction
 * 
 * @param sources - Array of source performance data to sort
 * @param sortColumn - Column to sort by (null for no sorting)
 * @param sortDirection - Sort direction ('asc' | 'desc')
 * @returns Sorted array of sources
 */
function sortSources(sources: SourcePerformanceWithGoals[], sortColumn: SortColumn, sortDirection: SortDirection): SourcePerformanceWithGoals[] {
  if (!sortColumn) return sources;
  
  return [...sources].sort((a, b) => {
    let comparison = 0;
    
    switch (sortColumn) {
      case 'source':
        comparison = (a.source || '').toLowerCase().localeCompare((b.source || '').toLowerCase());
        break;
      case 'channel':
        comparison = (a.channel || '').toLowerCase().localeCompare((b.channel || '').toLowerCase());
        break;
      case 'prospects':
        comparison = (a.prospects || 0) - (b.prospects || 0);
        break;
      case 'contacted':
        comparison = (a.contacted || 0) - (b.contacted || 0);
        break;
      case 'contactedToMql':
        comparison = (a.contactedToMqlRate || 0) - (b.contactedToMqlRate || 0);
        break;
      case 'mqls':
        comparison = (a.mqls || 0) - (b.mqls || 0);
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

export function SourcePerformanceTable({ 
  sources, 
  selectedSource, 
  onSourceClick, 
  channelFilter,
  viewMode = 'focused'
}: SourcePerformanceTableProps) {
  const [sortColumn, setSortColumn] = useState<SortColumn>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  
  const filteredSources = channelFilter 
    ? sources.filter(s => s.channel === channelFilter)
    : sources;
  
  // Check if any source has goals
  const hasGoals = filteredSources.some(s => s.goals && (s.goals.mqls > 0 || s.goals.sqls > 0 || s.goals.sqos > 0));
  
  // Sort sources
  const sortedSources = useMemo(() => {
    return sortSources(filteredSources, sortColumn, sortDirection);
  }, [filteredSources, sortColumn, sortDirection]);
  
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
  const SortableHeader = ({ column, children, alignRight = true }: { column: SortColumn; children: React.ReactNode; alignRight?: boolean }) => {
    const isActive = sortColumn === column;
    const showAsc = isActive && sortDirection === 'asc';
    const showDesc = isActive && sortDirection === 'desc';
    
    return (
      <TableHeaderCell 
        className={`border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 ${
          column !== null ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 select-none' : ''
        } ${alignRight ? 'text-right' : ''}`}
        onClick={() => handleSort(column)}
      >
        <div className={`flex items-center gap-1 ${alignRight ? 'justify-end' : ''}`}>
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
  
  // Prepare data for CSV export (use sorted sources)
  const exportData = sortedSources.map(source => ({
    Source: source.source,
    Channel: source.channel,
    ...(viewMode === 'fullFunnel' && {
      Prospects: source.prospects,
      Contacted: source.contacted,
      'Contacted→MQL Rate': (source.contactedToMqlRate * 100).toFixed(2) + '%',
    }),
    MQLs: source.mqls,
    'MQLs Goal': source.goals?.mqls ?? '',
    'MQL→SQL Rate': (source.mqlToSqlRate * 100).toFixed(2) + '%',
    SQLs: source.sqls,
    'SQLs Goal': source.goals?.sqls ?? '',
    SQOs: source.sqos,
    'SQOs Goal': source.goals?.sqos ?? '',
    Joined: source.joined,
    'Joined Goal': source.goals?.joined ?? '',
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
              <TableHeaderCell 
                className={`border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 ${
                  'source' !== null ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 select-none' : ''
                }`}
                onClick={() => handleSort('source')}
              >
                <div className="flex items-center gap-1">
                  Source
                  <div className="flex flex-col">
                    <ChevronUp 
                      className={`w-3 h-3 ${sortColumn === 'source' && sortDirection === 'asc' ? 'text-blue-600 dark:text-blue-400' : 'text-gray-300 dark:text-gray-600'}`} 
                    />
                    <ChevronDown 
                      className={`w-3 h-3 -mt-1 ${sortColumn === 'source' && sortDirection === 'desc' ? 'text-blue-600 dark:text-blue-400' : 'text-gray-300 dark:text-gray-600'}`} 
                    />
                  </div>
                </div>
              </TableHeaderCell>
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
                  <SortableHeader column="contactedToMql">Contacted→MQL</SortableHeader>
                </>
              )}
              <SortableHeader column="mqls">MQLs{viewMode === 'fullFunnel' && hasGoals && ' / Goal'}</SortableHeader>
              {viewMode === 'fullFunnel' && (
                <SortableHeader column="mqlToSql">MQL→SQL</SortableHeader>
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
            {sortedSources.map((source, idx) => {
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
                  {viewMode === 'fullFunnel' && (
                    <>
                      <TableCell className="text-right border-r border-gray-100 dark:border-gray-800">
                        {formatNumber(source.prospects)}
                      </TableCell>
                      <TableCell className="text-right border-r border-gray-100 dark:border-gray-800">
                        {formatNumber(source.contacted)}
                      </TableCell>
                      <TableCell className="text-right border-r border-gray-100 dark:border-gray-800">
                        <Badge 
                          size="sm" 
                          color={source.contactedToMqlRate >= 0.05 ? 'green' : source.contactedToMqlRate >= 0.03 ? 'yellow' : 'red'}
                        >
                          {formatPercent(source.contactedToMqlRate)}
                        </Badge>
                      </TableCell>
                    </>
                  )}
                  <TableCell className="text-right border-r border-gray-100 dark:border-gray-800">
                    {viewMode === 'fullFunnel' ? (
                      <MetricWithGoal actual={source.mqls} goal={source.goals?.mqls} />
                    ) : (
                      formatNumber(source.mqls)
                    )}
                  </TableCell>
                  {viewMode === 'fullFunnel' && (
                    <TableCell className="text-right border-r border-gray-100 dark:border-gray-800">
                      <Badge 
                        size="sm" 
                        color={source.mqlToSqlRate >= 0.3 ? 'green' : source.mqlToSqlRate >= 0.2 ? 'yellow' : 'red'}
                      >
                        {formatPercent(source.mqlToSqlRate)}
                      </Badge>
                    </TableCell>
                  )}
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
      
      {sortedSources.length === 0 && (
        <div className="p-8 text-center text-gray-500 dark:text-gray-400">
          No source data available
        </div>
      )}
    </Card>
  );
}
