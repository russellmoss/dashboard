// src/components/sga-hub/ClosedLostTable.tsx

'use client';

import { useState, useMemo } from 'react';
import { Card, Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell, Badge, Button } from '@tremor/react';
import { ClosedLostRecord, ClosedLostTimeBucket } from '@/types/sga-hub';
import { ExternalLink, ChevronUp, ChevronDown } from 'lucide-react';
import { formatDate } from '@/lib/utils/format-helpers';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

type SortColumn = 'oppName' | 'lastContactDate' | 'daysSinceContact' | 'closedLostDate' | 'closedLostReason' | 'timeBucket' | null;
type SortDirection = 'asc' | 'desc';

interface ClosedLostTableProps {
  records: ClosedLostRecord[];
  isLoading?: boolean;
  onRecordClick?: (record: ClosedLostRecord) => void;
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
      case 'lastContactDate':
        const aLastContact = a.lastContactDate ? new Date(a.lastContactDate).getTime() : 0;
        const bLastContact = b.lastContactDate ? new Date(b.lastContactDate).getTime() : 0;
        comparison = aLastContact - bLastContact;
        break;
      case 'daysSinceContact':
        comparison = (a.daysSinceContact || 0) - (b.daysSinceContact || 0);
        break;
      case 'closedLostDate':
        const aClosed = a.closedLostDate ? new Date(a.closedLostDate).getTime() : 0;
        const bClosed = b.closedLostDate ? new Date(b.closedLostDate).getTime() : 0;
        comparison = aClosed - bClosed;
        break;
      case 'closedLostReason':
        comparison = (a.closedLostReason || '').toLowerCase().localeCompare((b.closedLostReason || '').toLowerCase());
        break;
      case 'timeBucket':
        comparison = (a.timeSinceContactBucket || '').toLowerCase().localeCompare((b.timeSinceContactBucket || '').toLowerCase());
        break;
    }
    
    return sortDirection === 'asc' ? comparison : -comparison;
  });
}

export function ClosedLostTable({ records, isLoading = false, onRecordClick }: ClosedLostTableProps) {
  const [sortColumn, setSortColumn] = useState<SortColumn>('daysSinceContact'); // Default sort by days since contact
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc'); // Default descending (most urgent first)
  const [selectedBuckets, setSelectedBuckets] = useState<Set<string>>(new Set()); // Empty = show all
  
  // Available time buckets from records
  const availableBuckets = useMemo(() => {
    const buckets = new Set<string>();
    records.forEach(record => {
      if (record.timeSinceContactBucket) {
        buckets.add(record.timeSinceContactBucket);
      }
    });
    return Array.from(buckets).sort();
  }, [records]);
  
  // Filter records by selected buckets
  const filteredRecords = useMemo(() => {
    if (selectedBuckets.size === 0) {
      return records; // Show all if no filter selected
    }
    return records.filter(record => 
      record.timeSinceContactBucket && selectedBuckets.has(record.timeSinceContactBucket)
    );
  }, [records, selectedBuckets]);
  
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
      if (column === 'daysSinceContact' || column === 'lastContactDate' || column === 'closedLostDate') {
        setSortDirection('desc');
      } else {
        setSortDirection('asc');
      }
    }
  };
  
  // Toggle bucket filter
  const toggleBucket = (bucket: string) => {
    setSelectedBuckets(prev => {
      const next = new Set(prev);
      if (next.has(bucket)) {
        next.delete(bucket);
      } else {
        next.add(bucket);
      }
      return next;
    });
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
          Closed Lost Follow-Up Records
        </h3>
        
        {/* Time Bucket Filter */}
        {availableBuckets.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className="text-sm text-gray-600 dark:text-gray-400 font-medium">Filter by time bucket:</span>
            {availableBuckets.map(bucket => {
              const isSelected = selectedBuckets.size === 0 || selectedBuckets.has(bucket);
              return (
                <button
                  key={bucket}
                  onClick={() => toggleBucket(bucket)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                    isSelected
                      ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 border border-blue-300 dark:border-blue-700'
                      : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 border border-gray-300 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  {bucket}
                </button>
              );
            })}
            {selectedBuckets.size > 0 && (
              <button
                onClick={() => setSelectedBuckets(new Set())}
                className="px-3 py-1 rounded-md text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 underline"
              >
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>
      
      <div className="overflow-x-auto">
        <Table>
          <TableHead>
            <TableRow>
              <SortableHeader column="oppName">Opportunity Name</SortableHeader>
              <SortableHeader column="lastContactDate">Last Contact Date</SortableHeader>
              <SortableHeader column="daysSinceContact" alignRight>Days Since Contact</SortableHeader>
              <SortableHeader column="closedLostDate">Closed Lost Date</SortableHeader>
              <SortableHeader column="closedLostReason">Closed Lost Reason</SortableHeader>
              <SortableHeader column="timeBucket">Time Bucket</SortableHeader>
              <TableHeaderCell className="text-gray-600 dark:text-gray-400">Actions</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedRecords.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-gray-500 dark:text-gray-400 py-8">
                  {selectedBuckets.size > 0 
                    ? 'No records found matching selected time buckets' 
                    : 'No closed lost records found'}
                </TableCell>
              </TableRow>
            ) : (
              sortedRecords.map((record, idx) => (
                <TableRow 
                  key={record.id}
                  className={`${getRowColorClass(record.timeSinceContactBucket, idx)} transition-colors ${
                    onRecordClick ? 'cursor-pointer' : ''
                  }`}
                  onClick={() => onRecordClick?.(record)}
                >
                  <TableCell className="font-medium border-r border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100">
                    {record.oppName || 'Unknown'}
                  </TableCell>
                  <TableCell className="text-sm border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                    {formatDate(record.lastContactDate) || '-'}
                  </TableCell>
                  <TableCell className="text-right font-semibold border-r border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white">
                    {record.daysSinceContact || 0}
                  </TableCell>
                  <TableCell className="text-sm border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                    {formatDate(record.closedLostDate) || '-'}
                  </TableCell>
                  <TableCell className="border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                    {record.closedLostReason || 'Unknown'}
                  </TableCell>
                  <TableCell className="border-r border-gray-200 dark:border-gray-700">
                    <Badge 
                      size="xs" 
                      className={getTimeBucketColor(record.timeSinceContactBucket)}
                    >
                      {record.timeSinceContactBucket || 'Unknown'}
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
          {selectedBuckets.size > 0 && (
            <span className="ml-2 text-blue-600 dark:text-blue-400">
              (filtered from {records.length} total)
            </span>
          )}
        </div>
      )}
    </Card>
  );
}
