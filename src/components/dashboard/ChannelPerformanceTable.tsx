'use client';

import { Card, Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell, Badge } from '@tremor/react';
import { ChannelPerformance } from '@/types/dashboard';
import { formatCurrency, formatPercent, formatNumber } from '@/lib/utils/date-helpers';
import { ExportButton } from '@/components/ui/ExportButton';

interface ChannelPerformanceTableProps {
  channels: ChannelPerformance[];
  selectedChannel?: string | null;
  onChannelClick?: (channel: string | null) => void;
}

export function ChannelPerformanceTable({ channels, selectedChannel, onChannelClick }: ChannelPerformanceTableProps) {
  // Prepare data for CSV export with formatted values
  const exportData = channels.map(channel => ({
    Channel: channel.channel,
    Prospects: channel.prospects,
    Contacted: channel.contacted,
    MQLs: channel.mqls,
    SQLs: channel.sqls,
    SQOs: channel.sqos,
    Joined: channel.joined,
    'MQL→SQL Rate': (channel.mqlToSqlRate * 100).toFixed(2) + '%',
    'SQL→SQO Rate': (channel.sqlToSqoRate * 100).toFixed(2) + '%',
    'SQO→Joined Rate': (channel.sqoToJoinedRate * 100).toFixed(2) + '%',
    'Contacted→MQL Rate': (channel.contactedToMqlRate * 100).toFixed(2) + '%',
    AUM: channel.aum,
  }));

  return (
    <Card className="mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">Channel Performance</h3>
        <ExportButton data={exportData} filename="channel-performance" />
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHead>
            <TableRow className="bg-gray-50">
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
            {channels.map((channel, idx) => {
              const baseZebra = idx % 2 === 0 ? 'bg-white' : 'bg-gray-50';
              const hoverZebra = idx % 2 === 0 ? 'hover:bg-gray-50' : 'hover:bg-gray-100';
              const isSelected = selectedChannel === channel.channel;
              
              return (
              <TableRow 
                key={idx}
                className={`${baseZebra} ${isSelected ? '!bg-blue-50 hover:!bg-blue-100' : hoverZebra} transition-colors cursor-pointer`}
                onClick={() => onChannelClick?.(isSelected ? null : channel.channel)}
              >
                <TableCell className="font-medium border-r border-gray-200">{channel.channel}</TableCell>
                <TableCell className="text-right border-r border-gray-200">{formatNumber(channel.prospects)}</TableCell>
                <TableCell className="text-right border-r border-gray-200">{formatNumber(channel.contacted)}</TableCell>
                <TableCell className="text-right border-r border-gray-200">{formatNumber(channel.mqls)}</TableCell>
                <TableCell className="text-right font-semibold border-r border-gray-200">{formatNumber(channel.sqls)}</TableCell>
                <TableCell className="text-right border-r border-gray-200">{formatNumber(channel.sqos)}</TableCell>
                <TableCell className="text-right border-r border-gray-200">{formatNumber(channel.joined)}</TableCell>
                <TableCell className="text-right border-r border-gray-200">
                  <Badge size="sm" color={channel.mqlToSqlRate > 0.3 ? 'green' : channel.mqlToSqlRate > 0.2 ? 'yellow' : 'red'}>
                    {formatPercent(channel.mqlToSqlRate)}
                  </Badge>
                </TableCell>
                <TableCell className="text-right border-r border-gray-200">
                  <Badge size="sm" color={channel.sqlToSqoRate > 0.5 ? 'green' : channel.sqlToSqoRate > 0.3 ? 'yellow' : 'red'}>
                    {formatPercent(channel.sqlToSqoRate)}
                  </Badge>
                </TableCell>
                <TableCell className="text-right border-r border-gray-200">
                  <Badge size="sm" color={channel.sqoToJoinedRate > 0.4 ? 'green' : channel.sqoToJoinedRate > 0.2 ? 'yellow' : 'red'}>
                    {formatPercent(channel.sqoToJoinedRate)}
                  </Badge>
                </TableCell>
                <TableCell className="text-right font-semibold">{formatCurrency(channel.aum)}</TableCell>
              </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
