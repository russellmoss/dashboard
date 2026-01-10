'use client';

import { Card, Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell, Badge } from '@tremor/react';
import { SourcePerformance } from '@/types/dashboard';
import { formatCurrency, formatPercent, formatNumber } from '@/lib/utils/date-helpers';

interface SourcePerformanceTableProps {
  sources: SourcePerformance[];
  selectedSource?: string | null;
  onSourceClick?: (source: string | null) => void;
  channelFilter?: string | null;
}

export function SourcePerformanceTable({ sources, selectedSource, onSourceClick, channelFilter }: SourcePerformanceTableProps) {
  const filteredSources = channelFilter 
    ? sources.filter(s => s.channel === channelFilter)
    : sources;
  return (
    <Card className="mb-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">
        Source Performance
        {channelFilter && (
          <span className="ml-2 text-sm text-gray-500">(Filtered by: {channelFilter})</span>
        )}
      </h3>
      <div className="overflow-x-auto">
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Source</TableHeaderCell>
              <TableHeaderCell>Channel</TableHeaderCell>
              <TableHeaderCell className="text-right">Prospects</TableHeaderCell>
              <TableHeaderCell className="text-right">Contacted</TableHeaderCell>
              <TableHeaderCell className="text-right">MQLs</TableHeaderCell>
              <TableHeaderCell className="text-right">SQLs</TableHeaderCell>
              <TableHeaderCell className="text-right">SQOs</TableHeaderCell>
              <TableHeaderCell className="text-right">Joined</TableHeaderCell>
              <TableHeaderCell className="text-right">MQL→SQL</TableHeaderCell>
              <TableHeaderCell className="text-right">SQL→SQO</TableHeaderCell>
              <TableHeaderCell className="text-right">SQO→Joined</TableHeaderCell>
              <TableHeaderCell className="text-right">AUM</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredSources.map((source, idx) => (
              <TableRow 
                key={idx}
                className={onSourceClick ? `cursor-pointer transition-colors ${selectedSource === source.source ? 'bg-blue-50' : 'hover:bg-gray-50'}` : ''}
                onClick={() => onSourceClick?.(selectedSource === source.source ? null : source.source)}
              >
                <TableCell className="font-medium">{source.source}</TableCell>
                <TableCell>{source.channel}</TableCell>
                <TableCell className="text-right">{formatNumber(source.prospects)}</TableCell>
                <TableCell className="text-right">{formatNumber(source.contacted)}</TableCell>
                <TableCell className="text-right">{formatNumber(source.mqls)}</TableCell>
                <TableCell className="text-right font-semibold">{formatNumber(source.sqls)}</TableCell>
                <TableCell className="text-right">{formatNumber(source.sqos)}</TableCell>
                <TableCell className="text-right">{formatNumber(source.joined)}</TableCell>
                <TableCell className="text-right">
                  <Badge size="sm" color={source.mqlToSqlRate > 0.3 ? 'green' : source.mqlToSqlRate > 0.2 ? 'yellow' : 'red'}>
                    {formatPercent(source.mqlToSqlRate)}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Badge size="sm" color={source.sqlToSqoRate > 0.5 ? 'green' : source.sqlToSqoRate > 0.3 ? 'yellow' : 'red'}>
                    {formatPercent(source.sqlToSqoRate)}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Badge size="sm" color={source.sqoToJoinedRate > 0.4 ? 'green' : source.sqoToJoinedRate > 0.2 ? 'yellow' : 'red'}>
                    {formatPercent(source.sqoToJoinedRate)}
                  </Badge>
                </TableCell>
                <TableCell className="text-right font-semibold">{formatCurrency(source.aum)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
