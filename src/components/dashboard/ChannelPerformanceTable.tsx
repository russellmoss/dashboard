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
    <Card className="mb-6 dark:bg-gray-800 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Channel Performance</h3>
        <ExportButton data={exportData} filename="channel-performance" />
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHead>
            <TableRow className="bg-gray-50 dark:bg-gray-900">
              <TableHeaderCell className="border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">Channel</TableHeaderCell>
              <TableHeaderCell className="text-right border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">Prospects</TableHeaderCell>
              <TableHeaderCell className="text-right border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">Contacted</TableHeaderCell>
              <TableHeaderCell className="text-right border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">MQLs</TableHeaderCell>
              <TableHeaderCell className="text-right border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">SQLs</TableHeaderCell>
              <TableHeaderCell className="text-right border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">SQOs</TableHeaderCell>
              <TableHeaderCell className="text-right border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">Joined</TableHeaderCell>
              <TableHeaderCell className="text-right border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">MQL→SQL</TableHeaderCell>
              <TableHeaderCell className="text-right border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">SQL→SQO</TableHeaderCell>
              <TableHeaderCell className="text-right border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">SQO→Joined</TableHeaderCell>
              <TableHeaderCell className="text-right text-gray-600 dark:text-gray-400">AUM</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {channels.map((channel, idx) => {
              const baseZebra = idx % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50 dark:bg-gray-900';
              const hoverZebra = idx % 2 === 0 ? 'hover:bg-gray-50 dark:hover:bg-gray-700' : 'hover:bg-gray-100 dark:hover:bg-gray-700';
              const isSelected = selectedChannel === channel.channel;
              
              return (
              <TableRow 
                key={idx}
                className={`${baseZebra} ${isSelected ? '!bg-blue-50 dark:!bg-blue-900/30 hover:!bg-blue-100 dark:hover:!bg-blue-900/40' : hoverZebra} transition-colors cursor-pointer`}
                onClick={() => onChannelClick?.(isSelected ? null : channel.channel)}
              >
                <TableCell className="font-medium border-r border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100">{channel.channel}</TableCell>
                <TableCell className="text-right border-r border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300">{formatNumber(channel.prospects)}</TableCell>
                <TableCell className="text-right border-r border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300">{formatNumber(channel.contacted)}</TableCell>
                <TableCell className="text-right border-r border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300">{formatNumber(channel.mqls)}</TableCell>
                <TableCell className="text-right font-semibold border-r border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white">{formatNumber(channel.sqls)}</TableCell>
                <TableCell className="text-right border-r border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300">{formatNumber(channel.sqos)}</TableCell>
                <TableCell className="text-right border-r border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300">{formatNumber(channel.joined)}</TableCell>
                <TableCell className="text-right border-r border-gray-200 dark:border-gray-700">
                  <Badge size="sm" color={channel.mqlToSqlRate > 0.3 ? 'green' : channel.mqlToSqlRate > 0.2 ? 'yellow' : 'red'}>
                    {formatPercent(channel.mqlToSqlRate)}
                  </Badge>
                </TableCell>
                <TableCell className="text-right border-r border-gray-200 dark:border-gray-700">
                  <Badge size="sm" color={channel.sqlToSqoRate > 0.5 ? 'green' : channel.sqlToSqoRate > 0.3 ? 'yellow' : 'red'}>
                    {formatPercent(channel.sqlToSqoRate)}
                  </Badge>
                </TableCell>
                <TableCell className="text-right border-r border-gray-200 dark:border-gray-700">
                  <Badge size="sm" color={channel.sqoToJoinedRate > 0.4 ? 'green' : channel.sqoToJoinedRate > 0.2 ? 'yellow' : 'red'}>
                    {formatPercent(channel.sqoToJoinedRate)}
                  </Badge>
                </TableCell>
                <TableCell className="text-right font-semibold text-gray-900 dark:text-white">{formatCurrency(channel.aum)}</TableCell>
              </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
