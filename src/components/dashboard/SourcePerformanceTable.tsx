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
            <TableRow className="bg-gray-50">
              <TableHeaderCell className="border-r border-gray-200">Source</TableHeaderCell>
              <TableHeaderCell className="border-r border-gray-200">Channel</TableHeaderCell>
              <TableHeaderCell className="text-right border-r border-gray-200">Prospects</TableHeaderCell>
              <TableHeaderCell className="text-right border-r border-gray-200">Contacted</TableHeaderCell>
              <TableHeaderCell className="text-right border-r border-gray-200">MQLs</TableHeaderCell>
              <TableHeaderCell className="text-right border-r border-gray-200">SQLs</TableHeaderCell>
              <TableHeaderCell className="text-right border-r border-gray-200">SQOs</TableHeaderCell>
              <TableHeaderCell className="text-right border-r border-gray-200">Joined</TableHeaderCell>
              <TableHeaderCell className="text-right border-r border-gray-200">MQL→SQL</TableHeaderCell>
              <TableHeaderCell className="text-right border-r border-gray-200">SQL→SQO</TableHeaderCell>
              <TableHeaderCell className="text-right border-r border-gray-200">SQO→Joined</TableHeaderCell>
              <TableHeaderCell className="text-right">AUM</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredSources.map((source, idx) => {
              const baseZebra = idx % 2 === 0 ? 'bg-white' : 'bg-gray-50';
              const hoverZebra = idx % 2 === 0 ? 'hover:bg-gray-50' : 'hover:bg-gray-100';
              const isSelected = selectedSource === source.source;
              
              return (
              <TableRow 
                key={idx}
                className={`${baseZebra} ${isSelected ? '!bg-blue-50 hover:!bg-blue-100' : hoverZebra} transition-colors cursor-pointer`}
                onClick={() => onSourceClick?.(isSelected ? null : source.source)}
              >
                <TableCell className="font-medium border-r border-gray-200">{source.source}</TableCell>
                <TableCell className="border-r border-gray-200">{source.channel}</TableCell>
                <TableCell className="text-right border-r border-gray-200">{formatNumber(source.prospects)}</TableCell>
                <TableCell className="text-right border-r border-gray-200">{formatNumber(source.contacted)}</TableCell>
                <TableCell className="text-right border-r border-gray-200">{formatNumber(source.mqls)}</TableCell>
                <TableCell className="text-right font-semibold border-r border-gray-200">{formatNumber(source.sqls)}</TableCell>
                <TableCell className="text-right border-r border-gray-200">{formatNumber(source.sqos)}</TableCell>
                <TableCell className="text-right border-r border-gray-200">{formatNumber(source.joined)}</TableCell>
                <TableCell className="text-right border-r border-gray-200">
                  <Badge size="sm" color={source.mqlToSqlRate > 0.3 ? 'green' : source.mqlToSqlRate > 0.2 ? 'yellow' : 'red'}>
                    {formatPercent(source.mqlToSqlRate)}
                  </Badge>
                </TableCell>
                <TableCell className="text-right border-r border-gray-200">
                  <Badge size="sm" color={source.sqlToSqoRate > 0.5 ? 'green' : source.sqlToSqoRate > 0.3 ? 'yellow' : 'red'}>
                    {formatPercent(source.sqlToSqoRate)}
                  </Badge>
                </TableCell>
                <TableCell className="text-right border-r border-gray-200">
                  <Badge size="sm" color={source.sqoToJoinedRate > 0.4 ? 'green' : source.sqoToJoinedRate > 0.2 ? 'yellow' : 'red'}>
                    {formatPercent(source.sqoToJoinedRate)}
                  </Badge>
                </TableCell>
                <TableCell className="text-right font-semibold">{formatCurrency(source.aum)}</TableCell>
              </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
