// src/components/sga-hub/ReEngagementOpportunitiesTable.tsx

'use client';

import { useState, useMemo, useEffect } from 'react';
import { Card, Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell, Badge } from '@tremor/react';
import { ReEngagementOpportunity } from '@/types/sga-hub';
import { ExternalLink, ChevronUp, ChevronDown } from 'lucide-react';
import { formatDate } from '@/lib/utils/format-helpers';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ReEngagementFilters } from './ReEngagementFilters';

type SortColumn = 'oppName' | 'stageName' | 'sgaName' | 'createdDate' | 'lastActivityDate' | 'closeDate' | 'amount' | null;
type SortDirection = 'asc' | 'desc';

interface ReEngagementOpportunitiesTableProps {
  opportunities: ReEngagementOpportunity[];
  isLoading?: boolean;
  onRecordClick?: (opportunity: ReEngagementOpportunity) => void;
  showAllRecords?: boolean; // Admin view - show SGA name and filters
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
      case 'sgaName':
        comparison = (a.sgaName || '').toLowerCase().localeCompare((b.sgaName || '').toLowerCase());
        break;
    }
    
    return sortDirection === 'asc' ? comparison : -comparison;
  });
}

/**
 * Get color for stage badge - each stage gets its own unique color
 * Uses color scheme similar to time buckets in Closed Lost table
 */
function getStageColor(stage: string): string {
  if (!stage) {
    return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
  }
  
  const normalized = stage.toLowerCase().trim();
  
  // Each stage gets its own unique color
  if (normalized === 'joined') {
    return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
  }
  if (normalized === 'signed') {
    return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200';
  }
  if (normalized === 'negotiating') {
    return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
  }
  if (normalized === 'sales process') {
    return 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200';
  }
  if (normalized === 're-engaged') {
    return 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200';
  }
  if (normalized === 'qualifying') {
    return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
  }
  if (normalized === 'discovery') {
    return 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200';
  }
  if (normalized === 'outreach') {
    return 'bg-lime-100 text-lime-800 dark:bg-lime-900 dark:text-lime-200';
  }
  if (normalized === 'engaged') {
    return 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200';
  }
  if (normalized === 'call scheduled') {
    return 'bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200';
  }
  if (normalized === 'on hold') {
    return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200';
  }
  if (normalized === 'planned nurture') {
    return 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200';
  }
  if (normalized === 'closed lost') {
    return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
  }
  
  // Default - Gray for unknown stages
  return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
}

export function ReEngagementOpportunitiesTable({ opportunities, isLoading = false, onRecordClick, showAllRecords = false }: ReEngagementOpportunitiesTableProps) {
  const [sortColumn, setSortColumn] = useState<SortColumn>('createdDate');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  
  // Filter state (only used in admin view)
  const [selectedSGAs, setSelectedSGAs] = useState<string[]>([]);
  const [selectedStages, setSelectedStages] = useState<string[]>([]);
  
  // Extract unique values from opportunities for initial filter state
  const availableSGAs = useMemo(() => {
    const sgas = new Set<string>();
    opportunities.forEach(opp => {
      if (opp.sgaName) {
        sgas.add(opp.sgaName);
      }
    });
    return Array.from(sgas).sort();
  }, [opportunities]);

  const availableStages = useMemo(() => {
    const stages = new Set<string>();
    opportunities.forEach(opp => {
      if (opp.stageName) {
        stages.add(opp.stageName);
      }
    });
    return Array.from(stages).sort();
  }, [opportunities]);

  // Initialize filters with all values selected by default (only in admin view)
  useEffect(() => {
    if (showAllRecords) {
      if (selectedSGAs.length === 0 && availableSGAs.length > 0) {
        setSelectedSGAs([...availableSGAs]);
      }
      if (selectedStages.length === 0 && availableStages.length > 0) {
        setSelectedStages([...availableStages]);
      }
    }
  }, [showAllRecords, availableSGAs, availableStages, selectedSGAs.length, selectedStages.length]);
  
  // Filter records by selected filters (only in admin view)
  const filteredRecords = useMemo(() => {
    if (!showAllRecords) {
      return opportunities; // No filtering for non-admin view
    }

    let filtered = opportunities;
    
    // Filter by SGA Name
    if (selectedSGAs.length > 0) {
      filtered = filtered.filter(opp => 
        opp.sgaName && selectedSGAs.includes(opp.sgaName)
      );
    }
    
    // Filter by Stage
    if (selectedStages.length > 0) {
      filtered = filtered.filter(opp => 
        opp.stageName && selectedStages.includes(opp.stageName)
      );
    }
    
    return filtered;
  }, [opportunities, showAllRecords, selectedSGAs, selectedStages]);
  
  // Sort filtered records
  const sortedRecords = useMemo(() => {
    return sortRecords(filteredRecords, sortColumn, sortDirection);
  }, [filteredRecords, sortColumn, sortDirection]);
  
  // Handle filter apply
  const handleApplyFilters = (filters: {
    sgas: string[];
    stages: string[];
  }) => {
    setSelectedSGAs(filters.sgas);
    setSelectedStages(filters.stages);
  };
  
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
    <>
      {/* Filters (only shown in admin view) */}
      {showAllRecords && (
        <ReEngagementFilters
          opportunities={opportunities}
          selectedSGAs={selectedSGAs}
          selectedStages={selectedStages}
          onApply={handleApplyFilters}
        />
      )}

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
                {showAllRecords && (
                  <SortableHeader column="sgaName">SGA</SortableHeader>
                )}
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
                <TableCell colSpan={showAllRecords ? 8 : 7} className="text-center text-gray-500 dark:text-gray-400 py-8">
                  {showAllRecords && (selectedSGAs.length > 0 || selectedStages.length > 0)
                    ? 'No opportunities found matching selected filters'
                    : 'No open re-engagement opportunities found'}
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
                  {showAllRecords && (
                    <TableCell className="border-r border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300">
                      {opp.sgaName || 'Unknown'}
                    </TableCell>
                  )}
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
          {showAllRecords && (selectedSGAs.length < availableSGAs.length || selectedStages.length < availableStages.length) && (
            <span className="ml-2 text-blue-600 dark:text-blue-400">
              (filtered from {opportunities.length} total)
            </span>
          )}
        </div>
      )}
    </Card>
    </>
  );
}
