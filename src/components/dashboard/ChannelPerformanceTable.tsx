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
            <TableRow>
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
            {channels.map((channel, idx) => (
              <TableRow 
                key={idx}
                className={onChannelClick ? `cursor-pointer transition-colors ${selectedChannel === channel.channel ? 'bg-blue-50' : 'hover:bg-gray-50'}` : ''}
                onClick={() => onChannelClick?.(selectedChannel === channel.channel ? null : channel.channel)}
              >
                <TableCell className="font-medium">{channel.channel}</TableCell>
                <TableCell className="text-right">{formatNumber(channel.prospects)}</TableCell>
                <TableCell className="text-right">{formatNumber(channel.contacted)}</TableCell>
                <TableCell className="text-right">{formatNumber(channel.mqls)}</TableCell>
                <TableCell className="text-right font-semibold">{formatNumber(channel.sqls)}</TableCell>
                <TableCell className="text-right">{formatNumber(channel.sqos)}</TableCell>
                <TableCell className="text-right">{formatNumber(channel.joined)}</TableCell>
                <TableCell className="text-right">
                  <Badge size="sm" color={channel.mqlToSqlRate > 0.3 ? 'green' : channel.mqlToSqlRate > 0.2 ? 'yellow' : 'red'}>
                    {formatPercent(channel.mqlToSqlRate)}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Badge size="sm" color={channel.sqlToSqoRate > 0.5 ? 'green' : channel.sqlToSqoRate > 0.3 ? 'yellow' : 'red'}>
                    {formatPercent(channel.sqlToSqoRate)}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Badge size="sm" color={channel.sqoToJoinedRate > 0.4 ? 'green' : channel.sqoToJoinedRate > 0.2 ? 'yellow' : 'red'}>
                    {formatPercent(channel.sqoToJoinedRate)}
                  </Badge>
                </TableCell>
                <TableCell className="text-right font-semibold">{formatCurrency(channel.aum)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
