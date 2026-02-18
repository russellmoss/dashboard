'use client';

import { useState, useMemo } from 'react';
import {
  Card,
  Table,
  TableHead,
  TableRow,
  TableHeaderCell,
  TableBody,
  TableCell,
} from '@tremor/react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { SgmConversionData } from '@/types/dashboard';
import { formatPercent, formatNumber } from '@/lib/utils/date-helpers';

type SortColumn = 'sgm' | 'sqls' | 'sqlToSqo' | 'sqos' | 'sqoToJoined' | 'joined';
type SortDirection = 'asc' | 'desc';

export type SgmConversionMetricType = 'sql' | 'sqo' | 'joined';

interface SgmConversionTableProps {
  data: SgmConversionData[];
  loading?: boolean;
  /** When provided, SQLs / SQO's / Joined numbers become clickable and open drill-down */
  onMetricClick?: (sgm: string, metric: SgmConversionMetricType) => void;
}

export function SgmConversionTable({ data, loading = false, onMetricClick }: SgmConversionTableProps) {
  const [sortColumn, setSortColumn] = useState<SortColumn>('sqls');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Sort data
  const sortedData = useMemo(() => {
    return [...data].sort((a, b) => {
      let comparison = 0;
      switch (sortColumn) {
        case 'sgm':
          comparison = a.sgm.localeCompare(b.sgm);
          break;
        case 'sqls':
          comparison = a.sqlsReceived - b.sqlsReceived;
          break;
        case 'sqlToSqo':
          comparison = a.sqlToSqoRate - b.sqlToSqoRate;
          break;
        case 'sqos':
          comparison = a.sqosCount - b.sqosCount;
          break;
        case 'sqoToJoined':
          comparison = a.sqoToJoinedRate - b.sqoToJoinedRate;
          break;
        case 'joined':
          comparison = a.joinedCount - b.joinedCount;
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [data, sortColumn, sortDirection]);

  // Calculate team averages
  // NOTE: For conversion rates, we compute the AGGREGATE rate (total numer / total denom)
  // not the average of individual rates. This is statistically correct.
  const teamAverage = useMemo(() => {
    if (data.length === 0) return null;
    const totalSqls = data.reduce((sum, d) => sum + d.sqlsReceived, 0);
    const totalSqlToSqoNumer = data.reduce((sum, d) => sum + (d.sqlToSqoNumer || 0), 0);
    const totalSqlToSqoDenom = data.reduce((sum, d) => sum + (d.sqlToSqoDenom || 0), 0);
    const totalSqos = data.reduce((sum, d) => sum + d.sqosCount, 0);
    const totalSqoToJoinedNumer = data.reduce((sum, d) => sum + (d.sqoToJoinedNumer || 0), 0);
    const totalSqoToJoinedDenom = data.reduce((sum, d) => sum + (d.sqoToJoinedDenom || 0), 0);
    const totalJoined = data.reduce((sum, d) => sum + d.joinedCount, 0);

    return {
      sgm: 'Team Average',
      sqlsReceived: Math.round(totalSqls / data.length),
      sqlToSqoRate: totalSqlToSqoDenom > 0 ? totalSqlToSqoNumer / totalSqlToSqoDenom : 0,
      sqosCount: Math.round(totalSqos / data.length),
      sqoToJoinedRate: totalSqoToJoinedDenom > 0 ? totalSqoToJoinedNumer / totalSqoToJoinedDenom : 0,
      joinedCount: Math.round(totalJoined / data.length),
    };
  }, [data]);

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  const SortableHeader = ({ column, children, alignRight = true, className = '' }: {
    column: SortColumn;
    children: React.ReactNode;
    alignRight?: boolean;
    className?: string;
  }) => {
    const isActive = sortColumn === column;
    const showAsc = isActive && sortDirection === 'asc';
    const showDesc = isActive && sortDirection === 'desc';

    return (
      <TableHeaderCell
        className={`cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 select-none ${className}
                    ${alignRight ? 'text-right' : ''}`}
        onClick={() => handleSort(column)}
      >
        <div className={`flex items-center gap-1 ${alignRight ? 'justify-end' : ''}`}>
          {children}
          <div className="flex flex-col">
            <ChevronUp className={`w-3 h-3 ${showAsc ? 'text-blue-600' : 'text-gray-300 dark:text-gray-600'}`} />
            <ChevronDown className={`w-3 h-3 -mt-1 ${showDesc ? 'text-blue-600' : 'text-gray-300 dark:text-gray-600'}`} />
          </div>
        </div>
      </TableHeaderCell>
    );
  };

  if (loading) {
    return (
      <Card className="mt-4 animate-pulse">
        <div className="h-64 bg-gray-200 dark:bg-gray-700 rounded" />
      </Card>
    );
  }

  return (
    <Card className="mt-4">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          SGM Conversion & Velocity
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Post-SQL journey by SGM — click column headers to sort; click SQLs, SQO&apos;s, or Joined to drill down
        </p>
      </div>

      <div className="overflow-x-auto">
        <Table className="table-fixed w-full">
          <TableHead>
            <TableRow className="bg-gray-50 dark:bg-gray-900">
              <SortableHeader column="sgm" alignRight={false} className="w-1/6">SGM</SortableHeader>
              <SortableHeader column="sqls" className="w-1/6">SQLs</SortableHeader>
              <SortableHeader column="sqlToSqo" className="w-1/6">SQL→SQO %</SortableHeader>
              <SortableHeader column="sqos" className="w-1/6">SQO&apos;s</SortableHeader>
              <SortableHeader column="sqoToJoined" className="w-1/6">SQO→Joined %</SortableHeader>
              <SortableHeader column="joined" className="w-1/6">Joined</SortableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedData.map((row, idx) => {
              const isTeamAverage = row.sgm === 'Team Average';
              const makeClickable = onMetricClick && !isTeamAverage;

              return (
                <TableRow
                  key={row.sgm}
                  className={idx % 2 === 0
                    ? 'bg-white dark:bg-gray-800'
                    : 'bg-gray-50 dark:bg-gray-900'}
                >
                  <TableCell className="w-1/6 font-medium text-gray-900 dark:text-white">
                    {row.sgm}
                  </TableCell>
                  <TableCell className="w-1/6 text-right">
                    {makeClickable ? (
                      <button
                        type="button"
                        onClick={() => onMetricClick(row.sgm, 'sql')}
                        className="cursor-pointer text-right hover:underline hover:text-blue-600 dark:hover:text-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-1"
                      >
                        {formatNumber(row.sqlsReceived)}
                      </button>
                    ) : (
                      formatNumber(row.sqlsReceived)
                    )}
                  </TableCell>
                  <TableCell className="w-1/6 text-right">{formatPercent(row.sqlToSqoRate)}</TableCell>
                  <TableCell className="w-1/6 text-right">
                    {makeClickable ? (
                      <button
                        type="button"
                        onClick={() => onMetricClick(row.sgm, 'sqo')}
                        className="cursor-pointer text-right hover:underline hover:text-blue-600 dark:hover:text-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-1"
                      >
                        {formatNumber(row.sqosCount)}
                      </button>
                    ) : (
                      formatNumber(row.sqosCount)
                    )}
                  </TableCell>
                  <TableCell className="w-1/6 text-right">{formatPercent(row.sqoToJoinedRate)}</TableCell>
                  <TableCell className="w-1/6 text-right">
                    {makeClickable ? (
                      <button
                        type="button"
                        onClick={() => onMetricClick(row.sgm, 'joined')}
                        className="cursor-pointer text-right hover:underline hover:text-blue-600 dark:hover:text-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-1"
                      >
                        {formatNumber(row.joinedCount)}
                      </button>
                    ) : (
                      formatNumber(row.joinedCount)
                    )}
                  </TableCell>
                </TableRow>
              );
            })}

            {/* Team Average Row — pinned to bottom with visual separation (not clickable) */}
            {teamAverage && (
              <TableRow className="border-t-2 border-gray-300 dark:border-gray-600 bg-blue-50 dark:bg-blue-900/20">
                <TableCell className="w-1/6 font-bold text-gray-900 dark:text-white">
                  {teamAverage.sgm}
                </TableCell>
                <TableCell className="w-1/6 text-right font-bold">{formatNumber(teamAverage.sqlsReceived)}</TableCell>
                <TableCell className="w-1/6 text-right font-bold">{formatPercent(teamAverage.sqlToSqoRate)}</TableCell>
                <TableCell className="w-1/6 text-right font-bold">{formatNumber(teamAverage.sqosCount)}</TableCell>
                <TableCell className="w-1/6 text-right font-bold">{formatPercent(teamAverage.sqoToJoinedRate)}</TableCell>
                <TableCell className="w-1/6 text-right font-bold">{formatNumber(teamAverage.joinedCount)}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {data.length === 0 && !loading && (
        <div className="p-8 text-center text-gray-500 dark:text-gray-400">
          No conversion data available for selected filters
        </div>
      )}
    </Card>
  );
}
