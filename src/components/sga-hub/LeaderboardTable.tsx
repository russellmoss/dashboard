// src/components/sga-hub/LeaderboardTable.tsx

'use client';

import { useMemo } from 'react';
import { Card, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell, Badge } from '@tremor/react';
import { LeaderboardEntry } from '@/types/sga-hub';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

interface LeaderboardTableProps {
  entries: LeaderboardEntry[];
  isLoading?: boolean;
  onSQOClick?: (sgaName: string) => void;
  currentUserSgaName?: string; // For highlighting current user
}

/**
 * Get styling for top 3 ranks
 */
function getRankStyling(rank: number) {
  if (rank === 1) {
    return {
      rowClass: 'bg-yellow-50 dark:bg-yellow-900/20',
      medal: '🥇',
      textColor: 'text-yellow-600 dark:text-yellow-400',
    };
  } else if (rank === 2) {
    return {
      rowClass: 'bg-gray-50 dark:bg-gray-800/50',
      medal: '🥈',
      textColor: 'text-gray-600 dark:text-gray-400',
    };
  } else if (rank === 3) {
    return {
      rowClass: 'bg-orange-50 dark:bg-orange-900/20',
      medal: '🥉',
      textColor: 'text-orange-600 dark:text-orange-400',
    };
  }
  return {
    rowClass: '',
    medal: null,
    textColor: '',
  };
}

export function LeaderboardTable({ 
  entries, 
  isLoading = false, 
  onSQOClick,
  currentUserSgaName 
}: LeaderboardTableProps) {
  // Sort by rank (already sorted from API, but ensure consistency)
  const sortedEntries = useMemo(() => {
    return [...entries].sort((a, b) => a.rank - b.rank);
  }, [entries]);

  if (isLoading) {
    return (
      <div className="flex justify-center mb-6">
        <Card className="w-full max-w-2xl dark:bg-gray-800 dark:border-gray-700">
          <div className="py-12">
            <LoadingSpinner />
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex justify-center mb-6">
      <Card className="w-full max-w-2xl dark:bg-gray-800 dark:border-gray-700">
        <div className="mb-3">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            SGA Leaderboard
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Ranked by SQO count for the selected period
          </p>
        </div>
        
        <div className="overflow-x-auto">
          <Table>
            <TableHead>
              <TableRow className="bg-gray-50 dark:bg-gray-900">
                <TableHeaderCell className="w-16 px-3 text-left text-gray-600 dark:text-gray-400">
                  Rank
                </TableHeaderCell>
                <TableHeaderCell className="px-4 text-left text-gray-600 dark:text-gray-400">
                  SGA Name
                </TableHeaderCell>
                <TableHeaderCell className="w-24 px-3 text-right text-gray-600 dark:text-gray-400">
                  SQOs
                </TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sortedEntries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-gray-500 dark:text-gray-400 py-12">
                    <div className="flex flex-col items-center gap-2">
                      <p className="text-lg font-medium">No SQOs found</p>
                      <p className="text-sm">Try adjusting your quarter, channels, or sources</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                sortedEntries.map((entry, idx) => {
                  const rankStyling = getRankStyling(entry.rank);
                  const baseZebraClass = idx % 2 === 0 
                    ? 'bg-white dark:bg-gray-800' 
                    : 'bg-gray-50 dark:bg-gray-900';
                  
                  const rowClass = entry.rank <= 3 
                    ? rankStyling.rowClass 
                    : baseZebraClass;
                  
                  const isCurrentUser = currentUserSgaName && entry.sgaName === currentUserSgaName;
                  
                  return (
                    <TableRow
                      key={entry.sgaName}
                      className={`
                        ${rowClass} 
                        hover:bg-gray-100 dark:hover:bg-gray-700 
                        transition-colors
                        ${isCurrentUser ? 'border-l-4 border-blue-500' : ''}
                      `}
                    >
                      <TableCell className="px-3">
                        <div className="flex items-center gap-1.5">
                          {rankStyling.medal && (
                            <span className="text-lg">{rankStyling.medal}</span>
                          )}
                          <span className={`font-semibold ${rankStyling.textColor || 'text-gray-900 dark:text-white'}`}>
                            {entry.rank}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="px-4 font-medium text-gray-900 dark:text-white">
                        <div className="flex items-center gap-2">
                          {entry.sgaName}
                          {isCurrentUser && (
                            <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 text-xs px-1.5 py-0.5">
                              You
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="px-3 text-right">
                        {onSQOClick ? (
                          <button
                            onClick={() => onSQOClick(entry.sgaName)}
                            className="text-2xl font-bold text-white dark:text-white bg-blue-600 dark:bg-blue-600 hover:bg-blue-700 dark:hover:bg-blue-700 px-4 py-2 rounded-lg transition-all duration-200 shadow-sm hover:shadow-md cursor-pointer active:scale-95 min-w-[60px] inline-flex items-center justify-center"
                          >
                            {entry.sqoCount}
                          </button>
                        ) : (
                          <span className="text-2xl font-bold text-gray-900 dark:text-white min-w-[60px] inline-flex items-center justify-center">
                            {entry.sqoCount}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
