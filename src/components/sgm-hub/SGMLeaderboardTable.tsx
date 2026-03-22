'use client';

import { useMemo } from 'react';
import { Card, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell, Badge } from '@tremor/react';
import { SGMLeaderboardEntry } from '@/types/sgm-hub';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

interface SGMLeaderboardTableProps {
  entries: SGMLeaderboardEntry[];
  isLoading?: boolean;
  onJoinedClick?: (sgmName: string) => void;
  onAumClick?: (sgmName: string) => void;
  currentUserSgmName?: string;
}

function getRankStyling(rank: number) {
  if (rank === 1) {
    return {
      rowClass: 'bg-yellow-50 dark:bg-yellow-900/20',
      medal: '\u{1F947}',
      textColor: 'text-yellow-600 dark:text-yellow-400',
    };
  } else if (rank === 2) {
    return {
      rowClass: 'bg-gray-50 dark:bg-gray-800/50',
      medal: '\u{1F948}',
      textColor: 'text-gray-600 dark:text-gray-400',
    };
  } else if (rank === 3) {
    return {
      rowClass: 'bg-orange-50 dark:bg-orange-900/20',
      medal: '\u{1F949}',
      textColor: 'text-orange-600 dark:text-orange-400',
    };
  }
  return {
    rowClass: '',
    medal: null,
    textColor: '',
  };
}

export function SGMLeaderboardTable({
  entries,
  isLoading = false,
  onJoinedClick,
  onAumClick,
  currentUserSgmName,
}: SGMLeaderboardTableProps) {
  const sortedEntries = useMemo(() => {
    return [...entries].sort((a, b) => a.rank - b.rank);
  }, [entries]);

  if (isLoading) {
    return (
      <div className="flex justify-center mb-6">
        <Card className="w-full max-w-3xl dark:bg-gray-800 dark:border-gray-700">
          <div className="py-12">
            <LoadingSpinner />
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex justify-center mb-6">
      <Card className="w-full max-w-3xl dark:bg-gray-800 dark:border-gray-700">
        <div className="mb-3">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            SGM Leaderboard
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Ranked by Joined AUM for the selected period
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
                  SGM Name
                </TableHeaderCell>
                <TableHeaderCell className="w-24 px-3 text-right text-gray-600 dark:text-gray-400">
                  # Joined
                </TableHeaderCell>
                <TableHeaderCell className="w-36 px-3 text-right text-gray-600 dark:text-gray-400">
                  Joined AUM
                </TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sortedEntries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-gray-500 dark:text-gray-400 py-12">
                    <div className="flex flex-col items-center gap-2">
                      <p className="text-lg font-medium">No SGM data found</p>
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

                  const isCurrentUser = currentUserSgmName && entry.sgmName === currentUserSgmName;

                  return (
                    <TableRow
                      key={entry.sgmName}
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
                          {entry.sgmName}
                          {isCurrentUser && (
                            <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 text-xs px-1.5 py-0.5">
                              You
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="px-3 text-right">
                        {onJoinedClick ? (
                          <button
                            onClick={() => onJoinedClick(entry.sgmName)}
                            className="text-2xl font-bold text-white dark:text-white bg-blue-600 dark:bg-blue-600 hover:bg-blue-700 dark:hover:bg-blue-700 px-4 py-2 rounded-lg transition-all duration-200 shadow-sm hover:shadow-md cursor-pointer active:scale-95 min-w-[60px] inline-flex items-center justify-center"
                          >
                            {entry.joinedCount}
                          </button>
                        ) : (
                          <span className="text-2xl font-bold text-gray-900 dark:text-white min-w-[60px] inline-flex items-center justify-center">
                            {entry.joinedCount}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="px-3 text-right">
                        {onAumClick ? (
                          <button
                            onClick={() => onAumClick(entry.sgmName)}
                            className="text-lg font-bold text-white dark:text-white bg-blue-600 dark:bg-blue-600 hover:bg-blue-700 dark:hover:bg-blue-700 px-4 py-2 rounded-lg transition-all duration-200 shadow-sm hover:shadow-md cursor-pointer active:scale-95 min-w-[100px] inline-flex items-center justify-center"
                          >
                            {entry.joinedAumFormatted}
                          </button>
                        ) : (
                          <span className="text-lg font-bold text-gray-900 dark:text-white min-w-[100px] inline-flex items-center justify-center">
                            {entry.joinedAumFormatted}
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
