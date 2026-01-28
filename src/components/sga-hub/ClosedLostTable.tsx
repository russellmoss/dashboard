// src/components/sga-hub/ClosedLostTable.tsx

'use client';

import { useState, useMemo, useEffect } from 'react';
import { Card, Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell, Badge } from '@tremor/react';
import { ClosedLostRecord } from '@/types/sga-hub';
import { ExternalLink, ChevronUp, ChevronDown } from 'lucide-react';
import { formatDate } from '@/lib/utils/format-helpers';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ClosedLostFilters } from './ClosedLostFilters';

type SortColumn = 'oppName' | 'closedLostDate' | 'daysSinceClosedLost' | 'closedLostReason' | 'closedLostTimeBucket' | 'sgaName' | null;
type SortDirection = 'asc' | 'desc';

interface ClosedLostTableProps {
  records: ClosedLostRecord[];
  isLoading?: boolean;
  onRecordClick?: (record: ClosedLostRecord) => void;
  showAllRecords?: boolean;
  onToggleShowAll?: (showAll: boolean) => void;
}

/**
 * Get color class for time bucket badge (older = more urgent/red)
 */
function getTimeBucketColor(bucket: string): string {
  const normalized = bucket.toLowerCase();
  
  // Check for days ranges (most urgent = oldest)
  if (normalized.includes('6+ month') || normalized.includes('180+')) {
    return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'; // Most urgent - 6+ months
  }
  if (normalized.includes('150') || normalized.includes('180') || normalized.includes('5 month')) {
    return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'; // Very urgent - 5 months
  }
  if (normalized.includes('120') || normalized.includes('150') || normalized.includes('4 month')) {
    return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200';
  }
  if (normalized.includes('90') || normalized.includes('120') || normalized.includes('3 month')) {
    return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
  }
  if (normalized.includes('60') || normalized.includes('90') || normalized.includes('2 month')) {
    return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
  }
  if (normalized.includes('30') || normalized.includes('60') || normalized.includes('1 month')) {
    return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'; // Least urgent
  }
  if (normalized.includes('< 1 month') || normalized.includes('<1 month')) {
    return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'; // Very recent - least urgent
  }
  
  // Default
  return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
}

/**
 * Get row background color based on time bucket (older = more urgent/red tint)
 */
function getRowColorClass(bucket: string, index: number): string {
  const normalized = bucket.toLowerCase();
  const baseColor = index % 2 === 0 
    ? 'bg-white dark:bg-gray-800' 
    : 'bg-gray-50 dark:bg-gray-900';
  
  // Add subtle tint for older buckets (most urgent = oldest)
  if (normalized.includes('6+ month') || normalized.includes('180+')) {
    return `${baseColor} hover:bg-red-50 dark:hover:bg-red-950/20`; // Most urgent - 6+ months
  }
  if (normalized.includes('150') || normalized.includes('180') || normalized.includes('5 month')) {
    return `${baseColor} hover:bg-red-50 dark:hover:bg-red-950/20`; // Very urgent - 5 months
  }
  if (normalized.includes('120') || normalized.includes('150') || normalized.includes('4 month')) {
    return `${baseColor} hover:bg-orange-50 dark:hover:bg-orange-950/20`;
  }
  
  return `${baseColor} hover:bg-gray-100 dark:hover:bg-gray-700`;
}

/**
 * Sort records based on column and direction
 */
function sortRecords(records: ClosedLostRecord[], sortColumn: SortColumn, sortDirection: SortDirection): ClosedLostRecord[] {
  if (!sortColumn) return records;

  return [...records].sort((a, b) => {
    let comparison = 0;

    switch (sortColumn) {
      case 'oppName':
        comparison = (a.oppName || '').toLowerCase().localeCompare((b.oppName || '').toLowerCase());
        break;
      case 'closedLostDate':
        const aClosed = a.closedLostDate ? new Date(a.closedLostDate).getTime() : 0;
        const bClosed = b.closedLostDate ? new Date(b.closedLostDate).getTime() : 0;
        comparison = aClosed - bClosed;
        break;
      case 'closedLostReason':
        comparison = (a.closedLostReason || '').toLowerCase().localeCompare((b.closedLostReason || '').toLowerCase());
        break;
      case 'daysSinceClosedLost':
        comparison = (a.daysSinceClosedLost || 0) - (b.daysSinceClosedLost || 0);
        break;
      case 'closedLostTimeBucket':
        comparison = (a.timeSinceClosedLostBucket || '').toLowerCase().localeCompare((b.timeSinceClosedLostBucket || '').toLowerCase());
        break;
      case 'sgaName':
        comparison = (a.sgaName || '').toLowerCase().localeCompare((b.sgaName || '').toLowerCase());
        break;
    }

    return sortDirection === 'asc' ? comparison : -comparison;
  });
}

export function ClosedLostTable({ records, isLoading = false, onRecordClick, showAllRecords = false, onToggleShowAll }: ClosedLostTableProps) {
  const [sortColumn, setSortColumn] = useState<SortColumn>('daysSinceClosedLost'); // Default sort by days since closed lost
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc'); // Default descending (most urgent first)
  
  // Filter state (only used in admin view)
  const [selectedSGAs, setSelectedSGAs] = useState<string[]>([]);
  const [selectedTimeBuckets, setSelectedTimeBuckets] = useState<string[]>([]);
  const [selectedReasons, setSelectedReasons] = useState<string[]>([]);
  
  // Extract unique values from records for initial filter state
  const availableSGAs = useMemo(() => {
    const sgas = new Set<string>();
    records.forEach(record => {
      if (record.sgaName) {
        sgas.add(record.sgaName);
      }
    });
    return Array.from(sgas).sort();
  }, [records]);

  const availableTimeBuckets = useMemo(() => {
    const buckets = new Set<string>();
    records.forEach(record => {
      if (record.timeSinceClosedLostBucket) {
        buckets.add(record.timeSinceClosedLostBucket);
      }
    });
    return Array.from(buckets).sort();
  }, [records]);

  const availableReasons = useMemo(() => {
    const reasons = new Set<string>();
    records.forEach(record => {
      if (record.closedLostReason) {
        reasons.add(record.closedLostReason);
      }
    });
    return Array.from(reasons).sort();
  }, [records]);

  // Initialize filters with all values selected by default (only in admin view)
  useEffect(() => {
    if (showAllRecords) {
      if (selectedSGAs.length === 0 && availableSGAs.length > 0) {
        setSelectedSGAs([...availableSGAs]);
      }
      if (selectedTimeBuckets.length === 0 && availableTimeBuckets.length > 0) {
        setSelectedTimeBuckets([...availableTimeBuckets]);
      }
      if (selectedReasons.length === 0 && availableReasons.length > 0) {
        setSelectedReasons([...availableReasons]);
      }
    }
  }, [showAllRecords, availableSGAs, availableTimeBuckets, availableReasons, selectedSGAs.length, selectedTimeBuckets.length, selectedReasons.length]);
  
  // Filter records by selected filters (only in admin view)
  const filteredRecords = useMemo(() => {
    if (!showAllRecords) {
      return records; // No filtering for non-admin view
    }

    let filtered = records;
    
    // Filter by SGA Name
    if (selectedSGAs.length > 0) {
      filtered = filtered.filter(record => 
        record.sgaName && selectedSGAs.includes(record.sgaName)
      );
    }
    
    // Filter by Days Since Closed Lost Time Bucket
    if (selectedTimeBuckets.length > 0) {
      filtered = filtered.filter(record => 
        record.timeSinceClosedLostBucket && selectedTimeBuckets.includes(record.timeSinceClosedLostBucket)
      );
    }
    
    // Filter by Closed Lost Reason
    if (selectedReasons.length > 0) {
      filtered = filtered.filter(record => 
        record.closedLostReason && selectedReasons.includes(record.closedLostReason)
      );
    }
    
    return filtered;
  }, [records, showAllRecords, selectedSGAs, selectedTimeBuckets, selectedReasons]);
  
  // Sort filtered records
  const sortedRecords = useMemo(() => {
    return sortRecords(filteredRecords, sortColumn, sortDirection);
  }, [filteredRecords, sortColumn, sortDirection]);
  
  // Handle column header click for sorting
  const handleSort = (column: SortColumn) => {
    if (column === null) return;
    
    if (sortColumn === column) {
      // Toggle direction if clicking the same column
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      // Set new column and default to descending for dates/numbers, ascending for text
      setSortColumn(column);
      if (column === 'closedLostDate' || column === 'daysSinceClosedLost') {
        setSortDirection('desc');
      } else {
        setSortDirection('asc');
      }
    }
  };
  
  // Handle filter apply
  const handleApplyFilters = (filters: {
    sgas: string[];
    timeBuckets: string[];
    reasons: string[];
  }) => {
    setSelectedSGAs(filters.sgas);
    setSelectedTimeBuckets(filters.timeBuckets);
    setSelectedReasons(filters.reasons);
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
        <ClosedLostFilters
          records={records}
          selectedSGAs={selectedSGAs}
          selectedTimeBuckets={selectedTimeBuckets}
          selectedReasons={selectedReasons}
          onApply={handleApplyFilters}
        />
      )}

      <Card className="mb-6 dark:bg-gray-800 dark:border-gray-700">
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              Closed Lost Follow-Up Records
            </h3>

            {/* My Records / All Records Toggle */}
            {onToggleShowAll && (
              <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
                <button
                  onClick={() => onToggleShowAll(false)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    !showAllRecords
                      ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                  }`}
                >
                  My Records
                </button>
                <button
                  onClick={() => onToggleShowAll(true)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    showAllRecords
                      ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                  }`}
                >
                  All Records
                </button>
              </div>
            )}
          </div>
        </div>
      
      <div className="overflow-x-auto">
        <Table>
          <TableHead>
            <TableRow>
              <SortableHeader column="oppName">Opportunity Name</SortableHeader>
              {showAllRecords && (
                <SortableHeader column="sgaName">SGA</SortableHeader>
              )}
              <SortableHeader column="closedLostDate">Closed Lost Date</SortableHeader>
              <SortableHeader column="daysSinceClosedLost" alignRight>Days Since Closed Lost</SortableHeader>
              <SortableHeader column="closedLostReason">Closed Lost Reason</SortableHeader>
              <SortableHeader column="closedLostTimeBucket">Days Since Closed Lost Time Bucket</SortableHeader>
              <TableHeaderCell className="text-gray-600 dark:text-gray-400">Actions</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedRecords.length === 0 ? (
              <TableRow>
                <TableCell colSpan={showAllRecords ? 7 : 6} className="text-center text-gray-500 dark:text-gray-400 py-8">
                  {showAllRecords && (selectedSGAs.length > 0 || selectedTimeBuckets.length > 0 || selectedReasons.length > 0)
                    ? 'No records found matching selected filters'
                    : 'No closed lost records found'}
                </TableCell>
              </TableRow>
            ) : (
              sortedRecords.map((record, idx) => (
                <TableRow
                  key={record.id}
                  className={`${getRowColorClass(record.timeSinceClosedLostBucket, idx)} transition-colors ${
                    onRecordClick ? 'cursor-pointer' : ''
                  }`}
                  onClick={() => onRecordClick?.(record)}
                >
                  <TableCell className="font-medium border-r border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100">
                    {record.oppName || 'Unknown'}
                  </TableCell>
                  {showAllRecords && (
                    <TableCell className="border-r border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300">
                      {record.sgaName || 'Unknown'}
                    </TableCell>
                  )}
                  <TableCell className="text-sm border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                    {formatDate(record.closedLostDate) || '-'}
                  </TableCell>
                  <TableCell className="text-right font-semibold border-r border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white">
                    {record.daysSinceClosedLost || 0}
                  </TableCell>
                  <TableCell className="border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                    {record.closedLostReason || 'Unknown'}
                  </TableCell>
                  <TableCell className="border-r border-gray-200 dark:border-gray-700">
                    <Badge
                      size="xs"
                      className={getTimeBucketColor(record.timeSinceClosedLostBucket)}
                    >
                      {record.timeSinceClosedLostBucket || 'Unknown'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {record.leadUrl && (
                        <a
                          href={record.leadUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 text-xs"
                          title="View Lead"
                        >
                          Lead <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                      {record.opportunityUrl && (
                        <a
                          href={record.opportunityUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 text-xs"
                          title="View Opportunity"
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
          Showing {sortedRecords.length} record{sortedRecords.length !== 1 ? 's' : ''}
          {showAllRecords && (selectedSGAs.length < availableSGAs.length || selectedTimeBuckets.length < availableTimeBuckets.length || selectedReasons.length < availableReasons.length) && (
            <span className="ml-2 text-blue-600 dark:text-blue-400">
              (filtered from {records.length} total)
            </span>
          )}
        </div>
      )}
    </Card>
    </>
  );
}
