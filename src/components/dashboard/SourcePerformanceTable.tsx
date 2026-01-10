'use client';

import { Card, Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell, Badge } from '@tremor/react';
import { SourcePerformance } from '@/types/dashboard';
import { formatCurrency, formatPercent, formatNumber } from '@/lib/utils/date-helpers';
import { ExportButton } from '@/components/ui/ExportButton';

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
  
  // Prepare data for CSV export with formatted values
  const exportData = filteredSources.map(source => ({
    Source: source.source,
    Channel: source.channel,
    Prospects: source.prospects,
    Contacted: source.contacted,
    MQLs: source.mqls,
    SQLs: source.sqls,
    SQOs: source.sqos,
    Joined: source.joined,
    'MQL→SQL Rate': (source.mqlToSqlRate * 100).toFixed(2) + '%',
    'SQL→SQO Rate': (source.sqlToSqoRate * 100).toFixed(2) + '%',
    'SQO→Joined Rate': (source.sqoToJoinedRate * 100).toFixed(2) + '%',
    'Contacted→MQL Rate': (source.contactedToMqlRate * 100).toFixed(2) + '%',
    AUM: source.aum,
  }));

  return (
    <Card className="mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">
          Source Performance
          {channelFilter && (
            <span className="ml-2 text-sm text-gray-500">(Filtered by: {channelFilter})</span>
          )}
        </h3>
        <ExportButton data={exportData} filename="source-performance" />
      </div>
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
