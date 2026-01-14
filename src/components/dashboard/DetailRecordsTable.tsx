'use client';

import { useState, useMemo, useEffect } from 'react';
import { Card, Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell, Badge, Button, TextInput } from '@tremor/react';
import { DetailRecord, ViewMode } from '@/types/dashboard';
import { AdvancedFilters } from '@/types/filters';
import { ExternalLink, Search, X, ChevronLeft, ChevronRight, ChevronUp, ChevronDown } from 'lucide-react';
import { ExportButton } from '@/components/ui/ExportButton';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import { formatDate } from '@/lib/utils/format-helpers';

type SortColumn = 'advisor' | 'source' | 'channel' | 'stage' | 'date' | 'sga' | 'sgm' | 'aum' | null;
type SortDirection = 'asc' | 'desc';
type SearchField = 'advisor' | 'sga' | 'sgm' | 'source' | 'channel';

interface DetailRecordsTableProps {
  records: DetailRecord[];
  title?: string;
  filterDescription?: string;
  canExport?: boolean;
  viewMode?: ViewMode;
  advancedFilters?: AdvancedFilters; // To determine which date columns to show
  metricFilter?: 'all' | 'prospect' | 'contacted' | 'mql' | 'sql' | 'sqo' | 'joined' | 'openPipeline'; // To determine what date is shown
  onRecordClick?: (recordId: string) => void;
}

/**
 * Fuzzy matching function for advisor names
 * Matches if:
 * - The query appears anywhere in the name (case-insensitive)
 * - Any word in the name starts with the query
 * - The name contains all characters of the query in order (fuzzy)
 */
function fuzzyMatch(query: string, text: string): boolean {
  if (!query.trim()) return true;
  
  const normalizedQuery = query.toLowerCase().trim();
  const normalizedText = text.toLowerCase().trim();
  
  // Exact substring match
  if (normalizedText.includes(normalizedQuery)) {
    return true;
  }
  
  // Word boundary match - check if any word starts with the query
  const words = normalizedText.split(/\s+/);
  if (words.some(word => word.startsWith(normalizedQuery))) {
    return true;
  }
  
  // Fuzzy match: check if all characters of query appear in order in the text
  let queryIndex = 0;
  for (let i = 0; i < normalizedText.length && queryIndex < normalizedQuery.length; i++) {
    if (normalizedText[i] === normalizedQuery[queryIndex]) {
      queryIndex++;
    }
  }
  
  // If we matched all characters, it's a fuzzy match
  if (queryIndex === normalizedQuery.length) {
    return true;
  }
  
  // Check if query words appear in any order in the text
  const queryWords = normalizedQuery.split(/\s+/).filter(w => w.length > 0);
  if (queryWords.length > 1) {
    return queryWords.every(word => 
      normalizedText.includes(word) || 
      words.some(w => w.startsWith(word))
    );
  }
  
  return false;
}

/**
 * Extract first name from full name for sorting purposes
 * 
 * @param fullName - Full name string (e.g., "John Doe" or "John Michael Doe")
 * @returns First name portion of the full name
 */
function getFirstName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts[0] || fullName;
}

/**
 * Sort records based on column and direction
 * 
 * @param records - Array of detail records to sort
 * @param sortColumn - Column to sort by (null for no sorting)
 * @param sortDirection - Sort direction ('asc' | 'desc')
 * @returns Sorted array of records
 */
function sortRecords(records: DetailRecord[], sortColumn: SortColumn, sortDirection: SortDirection): DetailRecord[] {
  if (!sortColumn) return records;
  
  return [...records].sort((a, b) => {
    let comparison = 0;
    
    switch (sortColumn) {
      case 'advisor':
        const aFirstName = getFirstName(a.advisorName).toLowerCase();
        const bFirstName = getFirstName(b.advisorName).toLowerCase();
        comparison = aFirstName.localeCompare(bFirstName);
        break;
      case 'source':
        comparison = (a.source || '').toLowerCase().localeCompare((b.source || '').toLowerCase());
        break;
      case 'channel':
        comparison = (a.channel || '').toLowerCase().localeCompare((b.channel || '').toLowerCase());
        break;
      case 'stage':
        comparison = (a.stage || '').toLowerCase().localeCompare((b.stage || '').toLowerCase());
        break;
      case 'date':
        const aDate = a.relevantDate ? new Date(a.relevantDate).getTime() : 0;
        const bDate = b.relevantDate ? new Date(b.relevantDate).getTime() : 0;
        comparison = aDate - bDate;
        break;
      case 'sga':
        const aSga = (a.sga || '').toLowerCase();
        const bSga = (b.sga || '').toLowerCase();
        // Extract first name for SGA sorting
        comparison = getFirstName(aSga).localeCompare(getFirstName(bSga));
        break;
      case 'sgm':
        const aSgm = (a.sgm || '').toLowerCase();
        const bSgm = (b.sgm || '').toLowerCase();
        // Extract first name for SGM sorting
        comparison = getFirstName(aSgm).localeCompare(getFirstName(bSgm));
        break;
      case 'aum':
        comparison = (a.aum || 0) - (b.aum || 0);
        break;
    }
    
    return sortDirection === 'asc' ? comparison : -comparison;
  });
}

export function DetailRecordsTable({ records, title = 'Detail Records', filterDescription, canExport = false, viewMode = 'focused', advancedFilters, metricFilter = 'all', onRecordClick }: DetailRecordsTableProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchField, setSearchField] = useState<SearchField>('advisor');
  const [currentPage, setCurrentPage] = useState(1);
  const [sortColumn, setSortColumn] = useState<SortColumn>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const recordsPerPage = 50;
  
  // Determine which date columns to show based on active advanced filters
  const showInitialCallColumn = advancedFilters?.initialCallScheduled?.enabled ?? false;
  const showQualCallColumn = advancedFilters?.qualificationCallDate?.enabled ?? false;
  
  // Determine what date description to show in tooltip
  const getDateColumnDescription = (): string => {
    // Check advanced filters first
    if (advancedFilters?.initialCallScheduled?.enabled) {
      return 'Shows the Initial Call Scheduled Date for each record. This is the date when the initial call was scheduled, regardless of when they entered other stages.';
    }
    if (advancedFilters?.qualificationCallDate?.enabled) {
      return 'Shows the Opportunity Created Date for each record. This is the date when the opportunity was created, filtered by Qualification Call Date.';
    }
    
    // Then check metric filter
    switch (metricFilter) {
      case 'prospect':
        return 'Shows the Filter Date (cohort date) for each prospect. This is the date when they became a prospect in the system.';
      case 'contacted':
        return 'Shows the date when each person entered the Contacting stage. This is when they were first contacted.';
      case 'mql':
        return 'Shows the date when each person became an MQL (Marketing Qualified Lead). This is when they entered the Call Scheduled stage.';
      case 'sql':
        return 'Shows the conversion date for each SQL (Sales Qualified Lead). This is when they converted from MQL to SQL.';
      case 'sqo':
        return 'Shows the date when each person became an SQO (Sales Qualified Opportunity). This is when they entered the SQO stage.';
      case 'joined':
        return 'Shows the advisor join date for each person who joined. This is when they officially joined as an advisor.';
      case 'openPipeline':
        return 'Shows the Filter Date for open pipeline records. These are current opportunities in active stages.';
      default:
        return 'Shows the SQL conversion date (when they converted from MQL to SQL). When advanced filters are active, this may show different dates.';
    }
  };
  
  /**
   * Get search value from record based on selected field
   * 
   * @param record - Detail record to extract value from
   * @param field - Field to extract (advisor, sga, sgm, source, channel)
   * @returns Value from the specified field
   */
  const getSearchValue = (record: DetailRecord, field: SearchField): string => {
    switch (field) {
      case 'advisor':
        return record.advisorName;
      case 'sga':
        return record.sga || '';
      case 'sgm':
        return record.sgm || '';
      case 'source':
        return record.source || '';
      case 'channel':
        return record.channel || '';
      default:
        return '';
    }
  };

  /**
   * Get placeholder text based on selected search field
   * 
   * @param field - Search field type
   * @returns Placeholder text for the search input
   */
  const getPlaceholderText = (field: SearchField): string => {
    switch (field) {
      case 'advisor':
        return 'Search by advisor name...';
      case 'sga':
        return 'Search by SGA...';
      case 'sgm':
        return 'Search by SGM...';
      case 'source':
        return 'Search by source...';
      case 'channel':
        return 'Search by channel...';
      default:
        return 'Search...';
    }
  };
  
  // Filter records based on search query using fuzzy matching
  const filteredRecords = useMemo(() => {
    if (!searchQuery.trim()) {
      return records;
    }
    
    return records.filter(record => {
      const searchValue = getSearchValue(record, searchField);
      return fuzzyMatch(searchQuery, searchValue);
    });
  }, [records, searchQuery, searchField]);

  // Sort filtered records
  const sortedRecords = useMemo(() => {
    return sortRecords(filteredRecords, sortColumn, sortDirection);
  }, [filteredRecords, sortColumn, sortDirection]);

  // Pagination logic
  const totalPages = Math.ceil(sortedRecords.length / recordsPerPage);
  const startIndex = (currentPage - 1) * recordsPerPage;
  const endIndex = startIndex + recordsPerPage;
  const paginatedRecords = sortedRecords.slice(startIndex, endIndex);
  const shouldShowPagination = sortedRecords.length > recordsPerPage;

  // Reset to page 1 when search query, search field, records, or sort changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, searchField, records.length, sortColumn, sortDirection]);

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
                className={`w-3 h-3 ${showAsc ? 'text-gray-900 dark:text-white' : 'text-gray-400'}`} 
              />
              <ChevronDown 
                className={`w-3 h-3 -mt-1 ${showDesc ? 'text-gray-900 dark:text-white' : 'text-gray-400'}`} 
              />
            </div>
          )}
        </div>
      </TableHeaderCell>
    );
  };
  
  return (
    <Card className="mb-6 dark:bg-gray-800 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h3>
          {filterDescription && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{filterDescription}</p>
          )}
        </div>
        {canExport && <ExportButton data={sortedRecords} filename="detail-records" />}
      </div>
      
      {/* Search Input */}
      <div className="mb-4">
        {/* Search Field Selector */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm text-gray-600 dark:text-gray-400">Search by:</span>
          <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
            {(['advisor', 'sga', 'sgm', 'source', 'channel'] as SearchField[]).map((field) => {
              const getButtonLabel = (f: SearchField): string => {
                if (f === 'sga' || f === 'sgm') {
                  return f.toUpperCase();
                }
                return f.charAt(0).toUpperCase() + f.slice(1);
              };
              
              return (
                <button
                  key={field}
                  onClick={() => {
                    setSearchField(field);
                    setSearchQuery(''); // Clear search when switching fields
                  }}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                    searchField === field
                      ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                  }`}
                >
                  {getButtonLabel(field)}
                </button>
              );
            })}
          </div>
        </div>
        
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
          <TextInput
            type="text"
            placeholder={getPlaceholderText(searchField)}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 pr-10"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              aria-label="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        {searchQuery && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            {filteredRecords.length === 0 
              ? `No records found matching "${searchQuery}" in ${searchField}`
              : `Found ${filteredRecords.length} record${filteredRecords.length !== 1 ? 's' : ''} matching "${searchQuery}" in ${searchField}`
            }
          </p>
        )}
      </div>
      
      <div className="overflow-x-auto">
        <div className={shouldShowPagination ? 'max-h-[600px] overflow-y-auto' : ''}>
          <Table>
            <TableHead className={shouldShowPagination ? 'sticky top-0 z-10 bg-gray-50 dark:bg-gray-900' : ''}>
              <TableRow className="bg-gray-50 dark:bg-gray-900">
                <SortableHeader column="advisor">Advisor</SortableHeader>
                <SortableHeader column="source">Source</SortableHeader>
                <SortableHeader column="channel">Channel</SortableHeader>
                <SortableHeader column="stage">Stage</SortableHeader>
                <SortableHeader column="date">
                  <div className="flex items-center gap-1">
                    Date
                    <InfoTooltip content={getDateColumnDescription()} />
                  </div>
                </SortableHeader>
                {showInitialCallColumn && (
                  <SortableHeader column={null}>Initial Call Scheduled</SortableHeader>
                )}
                {showQualCallColumn && (
                  <SortableHeader column={null}>Qualification Call</SortableHeader>
                )}
                <SortableHeader column="sga">SGA</SortableHeader>
                <SortableHeader column="sgm">SGM</SortableHeader>
                <SortableHeader column="aum" alignRight>
                  AUM
                </SortableHeader>
                <TableHeaderCell className="text-gray-600 dark:text-gray-400">Actions</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
            {paginatedRecords.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9 + (showInitialCallColumn ? 1 : 0) + (showQualCallColumn ? 1 : 0)} className="text-center text-gray-500 dark:text-gray-400 py-8">
                  {searchQuery ? 'No records found matching your search' : 'No records found'}
                </TableCell>
              </TableRow>
            ) : (
              paginatedRecords.map((record, idx) => (
                <TableRow 
                  key={record.id}
                  className={`${idx % 2 === 0 ? 'bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700' : 'bg-gray-50 dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-700'} transition-colors cursor-pointer`}
                  onClick={() => onRecordClick?.(record.id)}
                >
                  <TableCell className="font-medium border-r border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100">{record.advisorName}</TableCell>
                  <TableCell className="border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">{record.source}</TableCell>
                  <TableCell className="border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">{record.channel}</TableCell>
                  <TableCell className="border-r border-gray-200 dark:border-gray-700">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-700 dark:text-gray-300">{record.stage}</span>
                      {viewMode === 'fullFunnel' && record.isContacted && <span className="text-red-600 dark:text-red-400 font-medium">Contacted</span>}
                      {viewMode === 'fullFunnel' && record.isMql && <span className="text-orange-600 dark:text-orange-400 font-medium">MQL</span>}
                      {record.isSql && <span className="text-blue-600 dark:text-blue-400 font-medium">SQL</span>}
                      {record.isSqo && <span className="text-green-600 dark:text-green-400 font-medium">SQO</span>}
                      {record.isJoined && <span className="text-purple-600 dark:text-purple-400 font-medium">Joined</span>}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                    {formatDate(record.relevantDate) || '-'}
                  </TableCell>
                  {showInitialCallColumn && (
                    <TableCell className="text-sm border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                      {formatDate(record.initialCallScheduledDate) || '-'}
                    </TableCell>
                  )}
                  {showQualCallColumn && (
                    <TableCell className="text-sm border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                      {formatDate(record.qualificationCallDate) || '-'}
                    </TableCell>
                  )}
                  <TableCell className="border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">{record.sga || '-'}</TableCell>
                  <TableCell className="border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">{record.sgm || '-'}</TableCell>
                  <TableCell className="text-right font-semibold border-r border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white">{record.aumFormatted}</TableCell>
                  <TableCell>
                    {record.salesforceUrl && (
                      <a
                        href={record.salesforceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 text-sm"
                      >
                        View <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
            </TableBody>
          </Table>
        </div>
      </div>
      
      {sortedRecords.length > 0 && (
        <div className="mt-4 flex items-center justify-between">
          <div className="text-sm text-gray-500 dark:text-gray-400">
            Showing {startIndex + 1}-{Math.min(endIndex, sortedRecords.length)} of {sortedRecords.length} record{sortedRecords.length !== 1 ? 's' : ''}
            {searchQuery && sortedRecords.length < records.length && (
              <span className="ml-2 text-blue-600 dark:text-blue-400">(filtered from {records.length} total)</span>
            )}
            {sortColumn && (
              <span className="ml-2 text-blue-600 dark:text-blue-400">
                (sorted by {sortColumn} {sortDirection === 'asc' ? '↑' : '↓'})
              </span>
            )}
          </div>
          
          {shouldShowPagination && (
            <div className="flex items-center gap-2">
              <Button
                size="xs"
                variant="secondary"
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                icon={ChevronLeft}
              >
                Previous
              </Button>
              <span className="text-sm text-gray-600 dark:text-gray-400">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                size="xs"
                variant="secondary"
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                icon={ChevronRight}
                iconPosition="right"
              >
                Next
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
