'use client';

import React from 'react';
import { Card, Metric, Text, Grid, Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell } from '@tremor/react';
import { ScheduledCallsSummary, DayCount, SGACallCount } from '@/types/sga-activity';

interface ScheduledCallsCardsProps {
  title: string;  // "Initial Calls" or "Qualification Calls"
  data: ScheduledCallsSummary;
  onCardClick: (weekType: 'this_week' | 'next_week') => void;
  onDayClick: (weekType: 'this_week' | 'next_week', dayOfWeek: number) => void;
  onSGAClick: (weekType: 'this_week' | 'next_week', sgaName: string) => void;
  onWeekTotalClick: (weekType: 'this_week' | 'next_week') => void;  // For clicking week totals
  onSGATotalClick: (sgaName: string) => void;  // For clicking SGA totals
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function ScheduledCallsCards({
  title,
  data,
  onCardClick,
  onDayClick,
  onSGAClick,
  onWeekTotalClick,
  onSGATotalClick,
}: ScheduledCallsCardsProps) {
  // Combine SGA data for display
  const combinedSGAData = combineSGAData(data);

  return (
    <div className="space-y-4">
      <Text className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</Text>
      
      {/* Summary Cards */}
      <Grid numItems={1} numItemsSm={2} className="gap-4">
        <Card 
          className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-800 dark:border-gray-700"
          onClick={() => onCardClick('this_week')}
        >
          <Text className="text-gray-600 dark:text-gray-400">This Week</Text>
          <Metric className="text-gray-900 dark:text-white">{data.thisWeek.total}</Metric>
        </Card>
        <Card 
          className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-800 dark:border-gray-700"
          onClick={() => onCardClick('next_week')}
        >
          <Text className="text-gray-600 dark:text-gray-400">Next Week</Text>
          <Metric className="text-gray-900 dark:text-white">{data.nextWeek.total}</Metric>
        </Card>
      </Grid>

      {/* Daily Breakdown */}
      <Card className="dark:bg-gray-800 dark:border-gray-700">
        <Text className="font-medium mb-2 text-gray-900 dark:text-gray-100">By Day of Week</Text>
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Week</TableHeaderCell>
              {DAY_NAMES.map((day, idx) => (
                <TableHeaderCell key={day} className="text-center">{day}</TableHeaderCell>
              ))}
              <TableHeaderCell className="text-center">Total</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell>This Week</TableCell>
              {[1, 2, 3, 4, 5, 6, 0].map((dayNum) => {
                const dayData = data.thisWeek.byDay.find(d => d.dayOfWeek === dayNum);
                return (
                  <TableCell 
                    key={dayNum} 
                    className="text-center cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900"
                    onClick={() => dayData && dayData.count > 0 && onDayClick('this_week', dayNum)}
                  >
                    {dayData?.count || '-'}
                  </TableCell>
                );
              })}
              <TableCell 
                className="text-center font-medium cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900"
                onClick={() => data.thisWeek.total > 0 && onWeekTotalClick('this_week')}
              >
                {data.thisWeek.total}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Next Week</TableCell>
              {[1, 2, 3, 4, 5, 6, 0].map((dayNum) => {
                const dayData = data.nextWeek.byDay.find(d => d.dayOfWeek === dayNum);
                return (
                  <TableCell 
                    key={dayNum} 
                    className="text-center cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900"
                    onClick={() => dayData && dayData.count > 0 && onDayClick('next_week', dayNum)}
                  >
                    {dayData?.count || '-'}
                  </TableCell>
                );
              })}
              <TableCell 
                className="text-center font-medium cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900"
                onClick={() => data.nextWeek.total > 0 && onWeekTotalClick('next_week')}
              >
                {data.nextWeek.total}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Card>

      {/* Per-SGA Breakdown */}
      <Card className="dark:bg-gray-800 dark:border-gray-700">
        <Text className="font-medium mb-2 text-gray-900 dark:text-gray-100">By SGA</Text>
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>SGA Name</TableHeaderCell>
              <TableHeaderCell className="text-center">This Week</TableHeaderCell>
              <TableHeaderCell className="text-center">Next Week</TableHeaderCell>
              <TableHeaderCell className="text-center">Total</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {combinedSGAData.map((sga) => (
              <TableRow key={sga.sgaName}>
                <TableCell>{sga.sgaName}</TableCell>
                <TableCell 
                  className="text-center cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900"
                  onClick={() => sga.thisWeek > 0 && onSGAClick('this_week', sga.sgaName)}
                >
                  {sga.thisWeek || '-'}
                </TableCell>
                <TableCell 
                  className="text-center cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900"
                  onClick={() => sga.nextWeek > 0 && onSGAClick('next_week', sga.sgaName)}
                >
                  {sga.nextWeek || '-'}
                </TableCell>
                <TableCell 
                  className="text-center font-medium cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900"
                  onClick={() => sga.total > 0 && onSGATotalClick(sga.sgaName)}
                >
                  {sga.total}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function combineSGAData(data: ScheduledCallsSummary): SGACallCount[] {
  const sgaMap = new Map<string, SGACallCount>();
  
  for (const sga of data.thisWeek.bySGA) {
    sgaMap.set(sga.sgaName, { ...sga });
  }
  
  for (const sga of data.nextWeek.bySGA) {
    const existing = sgaMap.get(sga.sgaName);
    if (existing) {
      existing.nextWeek = sga.nextWeek;
      existing.total = existing.thisWeek + sga.nextWeek;
    } else {
      sgaMap.set(sga.sgaName, { ...sga, thisWeek: 0, total: sga.nextWeek });
    }
  }
  
  // Sort alphabetically by SGA name (first name)
  return Array.from(sgaMap.values()).sort((a, b) => {
    const aFirst = a.sgaName.split(' ')[0];
    const bFirst = b.sgaName.split(' ')[0];
    return aFirst.localeCompare(bFirst);
  });
}
