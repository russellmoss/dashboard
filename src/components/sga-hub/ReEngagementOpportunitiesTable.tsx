// src/components/sga-hub/ReEngagementOpportunitiesTable.tsx

'use client';

import { useState, useMemo } from 'react';
import { Card, Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell, Badge } from '@tremor/react';
import { ReEngagementOpportunity } from '@/types/sga-hub';
import { ExternalLink, ChevronUp, ChevronDown } from 'lucide-react';
import { formatDate } from '@/lib/utils/format-helpers';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

type SortColumn = 'oppName' | 'stageName' | 'createdDate' | 'lastActivityDate' | 'closeDate' | 'amount' | null;
type SortDirection = 'asc' | 'desc';

interface ReEngagementOpportunitiesTableProps {
  opportunities: ReEngagementOpportunity[];
  isLoading?: boolean;
  onRecordClick?: (opportunity: ReEngagementOpportunity) => void;
}

/**
 * Sort records based on column and direction
 */
function sortRecords(opportunities: ReEngagementOpportunity[], sortColumn: SortColumn, sortDirection: SortDirection): ReEngagementOpportunity[] {
  if (!sortColumn) return opportunities;
  
  return [...opportunities].sort((a, b) => {
    let comparison = 0;
    
    switch (sortColumn) {
      case 'oppName':
        comparison = (a.oppName || '').toLowerCase().localeCompare((b.oppName || '').toLowerCase());
        break;
      case 'stageName':
        comparison = (a.stageName || '').toLowerCase().localeCompare((b.stageName || '').toLowerCase());
        break;
      case 'createdDate':
        const aCreated = a.createdDate ? new Date(a.createdDate).getTime() : 0;
        const bCreated = b.createdDate ? new Date(b.createdDate).getTime() : 0;
        comparison = aCreated - bCreated;
        break;
      case 'lastActivityDate':
        const aLast = a.lastActivityDate ? new Date(a.lastActivityDate).getTime() : 0;
        const bLast = b.lastActivityDate ? new Date(b.lastActivityDate).getTime() : 0;
        comparison = aLast - bLast;
        break;
      case 'closeDate':
        const aClose = a.closeDate ? new Date(a.closeDate).getTime() : 0;
        const bClose = b.closeDate ? new Date(b.closeDate).getTime() : 0;
        comparison = aClose - bClose;
        break;
      case 'amount':
        comparison = (a.amount || 0) - (b.amount || 0);
        break;
    }
    
    return sortDirection === 'asc' ? comparison : -comparison;
  });
}

/**
 * Get color for stage badge
 */
function getStageColor(stage: string): string {
  const normalized = stage.toLowerCase();
  if (normalized.includes('joined') || normalized.includes('signed')) {
    return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
  }
  if (normalized.includes('negotiating') || normalized.includes('sales process')) {
    return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
  }
  if (normalized.includes('discovery') || normalized.includes('qualifying')) {
    return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
  }
  if (normalized.includes('on hold') || normalized.includes('planned nurture')) {
    return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
  }
  return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
}

export function ReEngagementOpportunitiesTable({ opportunities, isLoading = false, onRecordClick }: ReEngagementOpportunitiesTableProps) {
  const [sortColumn, setSortColumn] = useState<SortColumn>('createdDate');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  
  // Sort records
  const sortedRecords = useMemo(() => {
    return sortRecords(opportunities, sortColumn, sortDirection);
  }, [opportunities, sortColumn, sortDirection]);
  
  // Handle column header click for sorting
  const handleSort = (column: SortColumn) => {
    if (column === null) return;
    
    if (sortColumn === column) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      if (column === 'createdDate' || column === 'lastActivityDate' || column === 'closeDate' || column === 'amount') {
        setSortDirection('desc');
      } else {
        setSortDirection('asc');
      }
    }
  };
  
  // Sortable header cell component
  const SortableHeader = ({ column, children, alignRight = false }: { column: SortColumn; children: React.ReactNode; alignRight?: boolean }) => {
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
          Open Re-Engagement Opportunities
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Re-Engagement opportunities for advisors who previously had closed lost opportunities
        </p>
      </div>
      
      <div className="overflow-x-auto">
        <Table>
          <TableHead>
            <TableRow>
              <SortableHeader column="oppName">Opportunity Name</SortableHeader>
              <SortableHeader column="stageName">Stage</SortableHeader>
              <SortableHeader column="createdDate">Created Date</SortableHeader>
              <SortableHeader column="lastActivityDate">Last Activity</SortableHeader>
              <SortableHeader column="closeDate">Close Date</SortableHeader>
              <SortableHeader column="amount" alignRight>Amount / AUM</SortableHeader>
              <TableHeaderCell className="text-gray-600 dark:text-gray-400">Actions</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedRecords.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-gray-500 dark:text-gray-400 py-8">
                  No open re-engagement opportunities found
                </TableCell>
              </TableRow>
            ) : (
              sortedRecords.map((opp, idx) => (
                <TableRow 
                  key={opp.id}
                  className={`${
                    idx % 2 === 0 
                      ? 'bg-white dark:bg-gray-800' 
                      : 'bg-gray-50 dark:bg-gray-900'
                  } transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 ${
                    onRecordClick ? 'cursor-pointer' : ''
                  }`}
                  onClick={() => onRecordClick?.(opp)}
                >
                  <TableCell className="font-medium border-r border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100">
                    {opp.oppName || 'Unknown'}
                  </TableCell>
                  <TableCell className="border-r border-gray-200 dark:border-gray-700">
                    <Badge 
                      size="xs" 
                      className={getStageColor(opp.stageName)}
                    >
                      {opp.stageName || 'Unknown'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                    {formatDate(opp.createdDate) || '-'}
                  </TableCell>
                  <TableCell className="text-sm border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                    {opp.lastActivityDate ? formatDate(opp.lastActivityDate) : '-'}
                  </TableCell>
                  <TableCell className="text-sm border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                    {opp.closeDate ? formatDate(opp.closeDate) : '-'}
                  </TableCell>
                  <TableCell className="text-right font-semibold border-r border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white">
                    {opp.underwrittenAum 
                      ? `$${(opp.underwrittenAum / 1000000).toFixed(2)}M`
                      : opp.amount 
                        ? `$${(opp.amount / 1000000).toFixed(2)}M`
                        : '-'
                    }
                  </TableCell>
                  <TableCell>
                    <a
                      href={opp.opportunityUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 text-xs"
                      title="View Opportunity"
                    >
                      Opp <ExternalLink className="w-3 h-3" />
                    </a>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      
      {sortedRecords.length > 0 && (
        <div className="mt-4 text-sm text-gray-500 dark:text-gray-400">
          Showing {sortedRecords.length} opportunity{sortedRecords.length !== 1 ? 'ies' : ''}
        </div>
      )}
    </Card>
  );
}
