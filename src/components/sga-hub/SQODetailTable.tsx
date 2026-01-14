// src/components/sga-hub/SQODetailTable.tsx

'use client';

import { useState, useMemo } from 'react';
import { Card, Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell, Badge } from '@tremor/react';
import { SQODetail } from '@/types/sga-hub';
import { ExternalLink, ChevronUp, ChevronDown } from 'lucide-react';
import { formatDate } from '@/lib/utils/format-helpers';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

type SortColumn = 'advisorName' | 'sqoDate' | 'aum' | 'aumTier' | 'channel' | 'source' | null;
type SortDirection = 'asc' | 'desc';

interface SQODetailTableProps {
  sqos: SQODetail[];
  isLoading?: boolean;
  onRecordClick?: (sqo: SQODetail) => void;
}

/**
 * Sort records based on column and direction
 */
function sortRecords(
  records: SQODetail[],
  sortColumn: SortColumn,
  sortDirection: SortDirection
): SQODetail[] {
  if (!sortColumn) return records;

  return [...records].sort((a, b) => {
    let comparison = 0;

    switch (sortColumn) {
      case 'advisorName':
        comparison = (a.advisorName || '').localeCompare(b.advisorName || '');
        break;
      case 'sqoDate':
        comparison = (a.sqoDate || '').localeCompare(b.sqoDate || '');
        break;
      case 'aum':
        comparison = (a.aum || 0) - (b.aum || 0);
        break;
      case 'aumTier':
        comparison = (a.aumTier || '').localeCompare(b.aumTier || '');
        break;
      case 'channel':
        comparison = (a.channel || '').localeCompare(b.channel || '');
        break;
      case 'source':
        comparison = (a.source || '').localeCompare(b.source || '');
        break;
      default:
        return 0;
    }

    return sortDirection === 'asc' ? comparison : -comparison;
  });
}

export function SQODetailTable({ sqos, isLoading = false, onRecordClick }: SQODetailTableProps) {
  const [sortColumn, setSortColumn] = useState<SortColumn>('sqoDate');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Sort records
  const sortedRecords = useMemo(() => {
    return sortRecords(sqos, sortColumn, sortDirection);
  }, [sqos, sortColumn, sortDirection]);

  // Handle column header click for sorting
  const handleSort = (column: SortColumn) => {
    if (column === null) return;

    if (sortColumn === column) {
      // Toggle direction if clicking the same column
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      // Set new column and default to descending for dates/numbers, ascending for text
      setSortColumn(column);
      if (column === 'sqoDate' || column === 'aum') {
        setSortDirection('desc');
      } else {
        setSortDirection('asc');
      }
    }
  };

  // Sortable header cell component
  const SortableHeader = ({
    column,
    children,
    alignRight = false,
  }: {
    column: SortColumn;
    children: React.ReactNode;
    alignRight?: boolean;
  }) => {
    const isActive = sortColumn === column;
    const showAsc = isActive && sortDirection === 'asc';
    const showDesc = isActive && sortDirection === 'desc';

    return (
      <TableHeaderCell
        className={`border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 ${
          column !== null
            ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 select-none'
            : ''
        } ${alignRight ? 'text-right' : ''}`}
        onClick={() => handleSort(column)}
      >
        <div className={`flex items-center gap-1 ${alignRight ? 'justify-end' : ''}`}>
          {children}
          {column !== null && (
            <div className="flex flex-col">
              <ChevronUp
                className={`w-3 h-3 ${showAsc ? 'text-gray-900 dark:text-white' : 'text-gray-400'}`}
              />
              <ChevronDown
                className={`w-3 h-3 -mt-1 ${
                  showDesc ? 'text-gray-900 dark:text-white' : 'text-gray-400'
                }`}
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
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          SQO Details
        </h3>
      </div>
      
      <div className="overflow-x-auto">
        <Table>
          <TableHead>
            <TableRow>
              <SortableHeader column="advisorName">Advisor Name</SortableHeader>
              <SortableHeader column="sqoDate">SQO Date</SortableHeader>
              <SortableHeader column="aum" alignRight>AUM</SortableHeader>
              <TableHeaderCell className="border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                AUM Tier
              </TableHeaderCell>
              <TableHeaderCell className="border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                Channel
              </TableHeaderCell>
              <TableHeaderCell className="border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                Source
              </TableHeaderCell>
              <TableHeaderCell className="text-gray-600 dark:text-gray-400">Actions</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedRecords.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-gray-500 dark:text-gray-400 py-8">
                  No SQO records found for this quarter
                </TableCell>
              </TableRow>
            ) : (
              sortedRecords.map((sqo) => (
                <TableRow
                  key={sqo.id}
                  className={`transition-colors ${
                    onRecordClick ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800' : ''
                  }`}
                  onClick={() => onRecordClick?.(sqo)}
                >
                  <TableCell className="font-medium border-r border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100">
                    {sqo.advisorName || 'Unknown'}
                  </TableCell>
                  <TableCell className="text-sm border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                    {formatDate(sqo.sqoDate) || '-'}
                  </TableCell>
                  <TableCell className="text-right font-semibold border-r border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white">
                    {sqo.aumFormatted || '-'}
                  </TableCell>
                  <TableCell className="border-r border-gray-200 dark:border-gray-700">
                    <Badge size="xs" className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                      {sqo.aumTier || 'Unknown'}
                    </Badge>
                  </TableCell>
                  <TableCell className="border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                    {sqo.channel || 'Unknown'}
                  </TableCell>
                  <TableCell className="border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                    {sqo.source || 'Unknown'}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {sqo.leadUrl && (
                        <a
                          href={sqo.leadUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-blue-600 dark:text-blue-400 hover:underline text-sm flex items-center gap-1"
                        >
                          Lead <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                      {sqo.opportunityUrl && (
                        <a
                          href={sqo.opportunityUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-blue-600 dark:text-blue-400 hover:underline text-sm flex items-center gap-1"
                        >
                          Opp <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      
      {sortedRecords.length > 0 && (
        <div className="mt-4 text-sm text-gray-500 dark:text-gray-400">
          Showing {sortedRecords.length} SQO record{sortedRecords.length !== 1 ? 's' : ''}
        </div>
      )}
    </Card>
  );
}
