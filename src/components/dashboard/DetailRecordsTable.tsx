'use client';

import { useState, useMemo } from 'react';
import { Card, Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell, Badge, Button, TextInput } from '@tremor/react';
import { DetailRecord } from '@/types/dashboard';
import { ExternalLink, Search, X } from 'lucide-react';
import { ExportButton } from '@/components/ui/ExportButton';

interface DetailRecordsTableProps {
  records: DetailRecord[];
  title?: string;
  filterDescription?: string;
  canExport?: boolean;
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

export function DetailRecordsTable({ records, title = 'Detail Records', filterDescription, canExport = false }: DetailRecordsTableProps) {
  const [searchQuery, setSearchQuery] = useState('');
  
  // Filter records based on search query using fuzzy matching
  const filteredRecords = useMemo(() => {
    if (!searchQuery.trim()) {
      return records;
    }
    
    return records.filter(record => 
      fuzzyMatch(searchQuery, record.advisorName)
    );
  }, [records, searchQuery]);
  
  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          {filterDescription && (
            <p className="text-sm text-gray-500 mt-1">{filterDescription}</p>
          )}
        </div>
        {canExport && <ExportButton data={filteredRecords} filename="detail-records" />}
      </div>
      
      {/* Search Input */}
      <div className="mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
          <TextInput
            type="text"
            placeholder="Search by advisor name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 pr-10"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
              aria-label="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        {searchQuery && (
          <p className="text-sm text-gray-500 mt-2">
            {filteredRecords.length === 0 
              ? 'No advisors found matching your search'
              : `Found ${filteredRecords.length} advisor${filteredRecords.length !== 1 ? 's' : ''} matching "${searchQuery}"`
            }
          </p>
        )}
      </div>
      
      <div className="overflow-x-auto">
        <Table>
          <TableHead>
            <TableRow className="bg-gray-50">
              <TableHeaderCell className="border-r border-gray-200">Advisor</TableHeaderCell>
              <TableHeaderCell className="border-r border-gray-200">Source</TableHeaderCell>
              <TableHeaderCell className="border-r border-gray-200">Channel</TableHeaderCell>
              <TableHeaderCell className="border-r border-gray-200">Stage</TableHeaderCell>
              <TableHeaderCell className="border-r border-gray-200">Date</TableHeaderCell>
              <TableHeaderCell className="border-r border-gray-200">SGA</TableHeaderCell>
              <TableHeaderCell className="border-r border-gray-200">SGM</TableHeaderCell>
              <TableHeaderCell className="text-right border-r border-gray-200">AUM</TableHeaderCell>
              <TableHeaderCell>Actions</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredRecords.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-gray-500 py-8">
                  {searchQuery ? 'No records found matching your search' : 'No records found'}
                </TableCell>
              </TableRow>
            ) : (
              filteredRecords.map((record, idx) => (
                <TableRow 
                  key={record.id}
                  className={`${idx % 2 === 0 ? 'bg-white hover:bg-gray-50' : 'bg-gray-50 hover:bg-gray-100'} transition-colors cursor-pointer`}
                >
                  <TableCell className="font-medium border-r border-gray-200">{record.advisorName}</TableCell>
                  <TableCell className="border-r border-gray-200">{record.source}</TableCell>
                  <TableCell className="border-r border-gray-200">{record.channel}</TableCell>
                  <TableCell className="border-r border-gray-200">
                    <div className="flex items-center gap-2">
                      <span>{record.stage}</span>
                      {record.isSql && <Badge size="xs" color="blue">SQL</Badge>}
                      {record.isSqo && <Badge size="xs" color="green">SQO</Badge>}
                      {record.isJoined && <Badge size="xs" color="purple">Joined</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-gray-600 border-r border-gray-200">
                    {record.relevantDate ? new Date(record.relevantDate).toLocaleDateString() : '-'}
                  </TableCell>
                  <TableCell className="border-r border-gray-200">{record.sga || '-'}</TableCell>
                  <TableCell className="border-r border-gray-200">{record.sgm || '-'}</TableCell>
                  <TableCell className="text-right font-semibold border-r border-gray-200">{record.aumFormatted}</TableCell>
                  <TableCell>
                    {record.salesforceUrl && (
                      <a
                        href={record.salesforceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 text-sm"
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
      
      {filteredRecords.length > 0 && (
        <div className="mt-4 text-sm text-gray-500 text-center">
          Showing {filteredRecords.length} of {records.length} record{records.length !== 1 ? 's' : ''}
          {searchQuery && filteredRecords.length < records.length && (
            <span className="ml-2 text-blue-600">(filtered)</span>
          )}
        </div>
      )}
    </Card>
  );
}
