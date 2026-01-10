'use client';

import { Card, Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell, Badge, Button } from '@tremor/react';
import { DetailRecord } from '@/types/dashboard';
import { ExternalLink } from 'lucide-react';
import { ExportButton } from '@/components/ui/ExportButton';

interface DetailRecordsTableProps {
  records: DetailRecord[];
  title?: string;
  filterDescription?: string;
  canExport?: boolean;
}

export function DetailRecordsTable({ records, title = 'Detail Records', filterDescription, canExport = false }: DetailRecordsTableProps) {
  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          {filterDescription && (
            <p className="text-sm text-gray-500 mt-1">{filterDescription}</p>
          )}
        </div>
        {canExport && <ExportButton data={records} filename="detail-records" />}
      </div>
      
      <div className="overflow-x-auto">
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Advisor</TableHeaderCell>
              <TableHeaderCell>Source</TableHeaderCell>
              <TableHeaderCell>Channel</TableHeaderCell>
              <TableHeaderCell>Stage</TableHeaderCell>
              <TableHeaderCell>Date</TableHeaderCell>
              <TableHeaderCell>SGA</TableHeaderCell>
              <TableHeaderCell>SGM</TableHeaderCell>
              <TableHeaderCell className="text-right">AUM</TableHeaderCell>
              <TableHeaderCell>Actions</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {records.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-gray-500 py-8">
                  No records found
                </TableCell>
              </TableRow>
            ) : (
              records.map((record) => (
                <TableRow key={record.id}>
                  <TableCell className="font-medium">{record.advisorName}</TableCell>
                  <TableCell>{record.source}</TableCell>
                  <TableCell>{record.channel}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span>{record.stage}</span>
                      {record.isSql && <Badge size="xs" color="blue">SQL</Badge>}
                      {record.isSqo && <Badge size="xs" color="green">SQO</Badge>}
                      {record.isJoined && <Badge size="xs" color="purple">Joined</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-gray-600">
                    {record.relevantDate ? new Date(record.relevantDate).toLocaleDateString() : '-'}
                  </TableCell>
                  <TableCell>{record.sga || '-'}</TableCell>
                  <TableCell>{record.sgm || '-'}</TableCell>
                  <TableCell className="text-right font-semibold">{record.aumFormatted}</TableCell>
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
      
      {records.length > 0 && (
        <div className="mt-4 text-sm text-gray-500 text-center">
          Showing {records.length} record{records.length !== 1 ? 's' : ''}
        </div>
      )}
    </Card>
  );
}
