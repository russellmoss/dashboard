// src/components/sga-hub/SGABreakdownTable.tsx

'use client';

import { useState, useMemo } from 'react';
import { Card, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell } from '@tremor/react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { TrendingUp, TrendingDown, Minus, ChevronUp, ChevronDown } from 'lucide-react';
import { getQuarterInfo } from '@/lib/utils/sga-hub-helpers';

export interface SGABreakdownRow {
  sgaName: string;
  goal: number | null;
  sqoCount: number;
  progressPercent: number | null; // SQO Count / Goal * 100
  expectedSQOs: number;
  pacingDiff: number; // currentSQOs - expectedSQOs
  pacingStatus: 'ahead' | 'on-track' | 'behind' | 'no-goal';
}

interface SGABreakdownTableProps {
  year: number;
  quarter: number;
  breakdown: SGABreakdownRow[];
  isLoading?: boolean;
  onSQOClick?: (sgaName: string) => void; // Note: AdminQuarterlyProgressView wraps this to pass filters
  // Filter props
  selectedSGAs?: string[];
  selectedPacingStatuses?: string[];
  onSGAFilterChange?: (sgas: string[]) => void;
  onPacingStatusFilterChange?: (statuses: string[]) => void;
  sgaOptions?: Array<{ value: string; label: string; isActive: boolean }>;
}

type SortColumn = 'sgaName' | 'goal' | 'sqoCount' | 'progressPercent' | 'pacingStatus' | 'pacingDiff' | null;
type SortDirection = 'asc' | 'desc';

export function SGABreakdownTable({
  year,
  quarter,
  breakdown,
  isLoading = false,
  onSQOClick,
  selectedSGAs = [],
  selectedPacingStatuses = [],
}: SGABreakdownTableProps) {
  const [sortColumn, setSortColumn] = useState<SortColumn>('pacingStatus');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc'); // Default: Behind first

  // Get quarter info for display
  const quarterInfo = getQuarterInfo(`${year}-Q${quarter}`);

  // Filter breakdown by selected SGAs and Pacing Statuses
  const filteredBreakdown = useMemo(() => {
    let filtered = breakdown;
    
    if (selectedSGAs.length > 0) {
      filtered = filtered.filter(row => selectedSGAs.includes(row.sgaName));
    }
    
    if (selectedPacingStatuses.length > 0) {
      filtered = filtered.filter(row => selectedPacingStatuses.includes(row.pacingStatus));
    }
    
    return filtered;
  }, [breakdown, selectedSGAs, selectedPacingStatuses]);

  // Sort filtered breakdown
  const sortedBreakdown = useMemo(() => {
    if (!sortColumn) return filteredBreakdown;
    
    return [...filteredBreakdown].sort((a, b) => {
      let comparison = 0;
      
      switch (sortColumn) {
        case 'sgaName':
          comparison = a.sgaName.toLowerCase().localeCompare(b.sgaName.toLowerCase());
          break;
        case 'goal':
          comparison = (a.goal || 0) - (b.goal || 0);
          break;
        case 'sqoCount':
          comparison = a.sqoCount - b.sqoCount;
          break;
        case 'progressPercent':
          comparison = (a.progressPercent || 0) - (b.progressPercent || 0);
          break;
        case 'pacingStatus':
          // Order: behind (0) < on-track (1) < ahead (2) < no-goal (3)
          const statusOrder: Record<string, number> = {
            'behind': 0,
            'on-track': 1,
            'ahead': 2,
            'no-goal': 3,
          };
          comparison = (statusOrder[a.pacingStatus] || 99) - (statusOrder[b.pacingStatus] || 99);
          break;
        case 'pacingDiff':
          comparison = a.pacingDiff - b.pacingDiff;
          break;
      }
      
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [filteredBreakdown, sortColumn, sortDirection]);

  // Handle column header click for sorting
  const handleSort = (column: SortColumn) => {
    if (column === null) return;
    
    if (sortColumn === column) {
      // Toggle direction if clicking the same column
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      // Set new column and default direction
      setSortColumn(column);
      if (column === 'sgaName') {
        setSortDirection('asc'); // A-Z default
      } else if (column === 'pacingStatus') {
        setSortDirection('asc'); // Behind first default
      } else {
        setSortDirection('desc'); // High-Low default for numbers
      }
    }
  };

  // Sortable header cell component (reuse pattern from ClosedLostTable)
  const SortableHeader = ({ column, children, alignRight = false, alignCenter = false }: { 
    column: SortColumn; 
    children: React.ReactNode; 
    alignRight?: boolean;
    alignCenter?: boolean;
  }) => {
    const isActive = sortColumn === column;
    const showAsc = isActive && sortDirection === 'asc';
    const showDesc = isActive && sortDirection === 'desc';
    
    return (
      <TableHeaderCell 
        className={`text-gray-600 dark:text-gray-400 ${
          column !== null ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 select-none' : ''
        } ${alignRight ? 'text-right' : alignCenter ? 'text-center' : ''}`}
        onClick={() => handleSort(column)}
      >
        <div className={`flex items-center gap-1 ${alignRight ? 'justify-end' : alignCenter ? 'justify-center' : ''}`}>
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

  if (isLoading) {
    return (
      <Card className="mb-6 dark:bg-gray-800 dark:border-gray-700">
        <div className="py-12">
          <LoadingSpinner />
        </div>
      </Card>
    );
  }

  return (
    <Card className="mb-6 dark:bg-gray-800 dark:border-gray-700">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          Individual SGA Breakdown
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          SQO performance by SGA for {quarterInfo.label}
        </p>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHead>
            <TableRow className="bg-gray-50 dark:bg-gray-900">
              <SortableHeader column="sgaName">SGA Name</SortableHeader>
              <SortableHeader column="goal" alignRight>Individual Goal</SortableHeader>
              <SortableHeader column="sqoCount" alignRight>SQO Count</SortableHeader>
              <SortableHeader column="progressPercent" alignRight>Progress %</SortableHeader>
              <SortableHeader column="pacingStatus" alignCenter>Pacing Status</SortableHeader>
              <SortableHeader column="pacingDiff" alignRight>Pacing Diff</SortableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedBreakdown.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-gray-500 dark:text-gray-400 py-12">
                  No data available
                </TableCell>
              </TableRow>
            ) : (
              sortedBreakdown.map((row) => {
                const StatusIcon = row.pacingStatus === 'ahead' ? TrendingUp 
                  : row.pacingStatus === 'behind' ? TrendingDown 
                  : Minus;
                
                const statusColor = row.pacingStatus === 'ahead' 
                  ? 'text-green-600 dark:text-green-400'
                  : row.pacingStatus === 'on-track'
                  ? 'text-yellow-600 dark:text-yellow-400'
                  : row.pacingStatus === 'behind'
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-gray-500 dark:text-gray-400';
                
                const statusLabel = row.pacingStatus === 'ahead' ? 'Ahead'
                  : row.pacingStatus === 'on-track' ? 'On-Track'
                  : row.pacingStatus === 'behind' ? 'Behind'
                  : 'No Goal';

                return (
                  <TableRow
                    key={row.sgaName}
                    className="hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  >
                    <TableCell className="font-medium text-gray-900 dark:text-white">
                      {row.sgaName}
                    </TableCell>
                    <TableCell className="text-right text-gray-900 dark:text-white">
                      {row.goal ?? '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      {onSQOClick ? (
                        <button
                          onClick={() => onSQOClick(row.sgaName)}
                          className="font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                        >
                          {row.sqoCount}
                        </button>
                      ) : (
                        <span className="font-semibold text-gray-900 dark:text-white">
                          {row.sqoCount}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-gray-900 dark:text-white">
                      {row.progressPercent !== null ? `${row.progressPercent}%` : '-'}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <StatusIcon className={`w-4 h-4 ${statusColor}`} />
                        <span className={`text-sm font-medium ${statusColor}`}>
                          {statusLabel}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className={`text-right font-medium ${row.pacingDiff >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                      {row.pacingDiff >= 0 ? '+' : ''}{row.pacingDiff}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
