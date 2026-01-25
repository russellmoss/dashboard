'use client';

import React, { useState, useMemo } from 'react';
import { Card, Metric, Text, Grid, Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell } from '@tremor/react';
import { ScheduledCallsSummary, DayCount, SGADayCount } from '@/types/sga-activity';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface ScheduledCallsCardsProps {
  title: string;  // "Initial Calls" or "Qualification Calls"
  data: ScheduledCallsSummary;
  onCardClick: (weekType: 'this_week' | 'next_week') => void;
  onDayClick: (weekType: 'this_week' | 'next_week', dayOfWeek: number, sgaName?: string) => void;
  onSGAClick: (weekType: 'this_week' | 'next_week', sgaName: string) => void;
  onWeekTotalClick: (weekType: 'this_week' | 'next_week') => void;  // For clicking week totals
  onSGATotalClick: (sgaName: string) => void;  // For clicking SGA totals
}

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon-Sun
const DAY_ORDER_TO_NAME: Record<number, string> = {
  0: 'Sun',
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
};

export default function ScheduledCallsCards({
  title,
  data,
  onCardClick,
  onDayClick,
  onSGAClick,
  onWeekTotalClick,
  onSGATotalClick,
}: ScheduledCallsCardsProps) {
  const [expandedWeeks, setExpandedWeeks] = useState<Set<'this_week' | 'next_week'>>(new Set());

  const toggleWeek = (weekType: 'this_week' | 'next_week') => {
    const newExpanded = new Set(expandedWeeks);
    if (newExpanded.has(weekType)) {
      newExpanded.delete(weekType);
    } else {
      newExpanded.add(weekType);
    }
    setExpandedWeeks(newExpanded);
  };

  // Group SGA-by-day data by SGA name
  const thisWeekSGAGroups = useMemo(() => {
    const groups = new Map<string, Map<number, number>>();
    for (const item of data.thisWeek.bySGADay || []) {
      if (!groups.has(item.sgaName)) {
        groups.set(item.sgaName, new Map());
      }
      const sgaDays = groups.get(item.sgaName)!;
      sgaDays.set(item.dayOfWeek, item.count);
    }
    return groups;
  }, [data.thisWeek.bySGADay]);

  const nextWeekSGAGroups = useMemo(() => {
    const groups = new Map<string, Map<number, number>>();
    for (const item of data.nextWeek.bySGADay || []) {
      if (!groups.has(item.sgaName)) {
        groups.set(item.sgaName, new Map());
      }
      const sgaDays = groups.get(item.sgaName)!;
      sgaDays.set(item.dayOfWeek, item.count);
    }
    return groups;
  }, [data.nextWeek.bySGADay]);

  // Get all unique SGA names, sorted
  const allSGAs = useMemo(() => {
    const sgaSet = new Set<string>();
    thisWeekSGAGroups.forEach((_, sgaName) => sgaSet.add(sgaName));
    nextWeekSGAGroups.forEach((_, sgaName) => sgaSet.add(sgaName));
    return Array.from(sgaSet).sort((a, b) => {
      const aFirst = a.split(' ')[0];
      const bFirst = b.split(' ')[0];
      return aFirst.localeCompare(bFirst);
    });
  }, [thisWeekSGAGroups, nextWeekSGAGroups]);

  // Calculate totals for each SGA
  const calculateSGATotal = (sgaDays: Map<number, number>): number => {
    let total = 0;
    sgaDays.forEach((count) => {
      total += count;
    });
    return total;
  };

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

      {/* Daily Breakdown with Expandable SGA Rows */}
      <Card className="dark:bg-gray-800 dark:border-gray-700">
        <Text className="font-medium mb-2 text-gray-900 dark:text-gray-100">By Day of Week</Text>
        <div className="overflow-x-auto">
          <Table className="w-full" style={{ tableLayout: 'fixed' }}>
            <TableHead>
              <TableRow>
                <TableHeaderCell style={{ width: '150px', minWidth: '150px' }}>Week</TableHeaderCell>
                {DAY_ORDER.map((dayNum) => (
                  <TableHeaderCell key={dayNum} className="text-center" style={{ width: '80px', minWidth: '80px' }}>
                    {DAY_ORDER_TO_NAME[dayNum]}
                  </TableHeaderCell>
                ))}
                <TableHeaderCell className="text-center font-medium" style={{ width: '80px', minWidth: '80px' }}>Total</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {/* This Week - Rollup Row */}
              <TableRow>
                <TableCell 
                  className="font-medium text-gray-900 dark:text-gray-100 cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900"
                  style={{ width: '150px', minWidth: '150px' }}
                  onClick={() => toggleWeek('this_week')}
                >
                  <div className="flex items-center gap-2">
                    {expandedWeeks.has('this_week') ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                    <span>This Week</span>
                  </div>
                </TableCell>
                {DAY_ORDER.map((dayNum) => {
                  const dayData = data.thisWeek.byDay.find(d => d.dayOfWeek === dayNum);
                  const count = dayData?.count || 0;
                  return (
                    <TableCell 
                      key={dayNum} 
                      className="text-center cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900 font-medium text-gray-900 dark:text-gray-100"
                      style={{ width: '80px', minWidth: '80px' }}
                      onClick={() => count > 0 && onDayClick('this_week', dayNum)}
                    >
                      {count > 0 ? count : '-'}
                    </TableCell>
                  );
                })}
                <TableCell 
                  className="text-center font-medium cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900 text-gray-900 dark:text-gray-100"
                  style={{ width: '80px', minWidth: '80px' }}
                  onClick={() => data.thisWeek.total > 0 && onWeekTotalClick('this_week')}
                >
                  {data.thisWeek.total}
                </TableCell>
              </TableRow>

              {/* This Week - SGA Rows (when expanded) */}
              {expandedWeeks.has('this_week') && allSGAs.map((sgaName) => {
                const sgaDays = thisWeekSGAGroups.get(sgaName);
                if (!sgaDays || sgaDays.size === 0) return null;
                
                const sgaTotal = calculateSGATotal(sgaDays);
                if (sgaTotal === 0) return null;

                return (
                  <TableRow key={`this_week_${sgaName}`} className="bg-gray-50 dark:bg-gray-900/50">
                    <TableCell 
                      className="text-gray-700 dark:text-gray-300 pl-8"
                      style={{ width: '150px', minWidth: '150px' }}
                    >
                      {sgaName}
                    </TableCell>
                    {DAY_ORDER.map((dayNum) => {
                      const count = sgaDays.get(dayNum) || 0;
                      return (
                        <TableCell 
                          key={dayNum} 
                          className="text-center cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900 text-gray-700 dark:text-gray-300"
                          style={{ width: '80px', minWidth: '80px' }}
                          onClick={() => count > 0 && onDayClick('this_week', dayNum, sgaName)}
                        >
                          {count > 0 ? count : '-'}
                        </TableCell>
                      );
                    })}
                    <TableCell 
                      className="text-center font-medium cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900 text-gray-700 dark:text-gray-300"
                      style={{ width: '80px', minWidth: '80px' }}
                      onClick={() => sgaTotal > 0 && onSGAClick('this_week', sgaName)}
                    >
                      {sgaTotal}
                    </TableCell>
                  </TableRow>
                );
              })}

              {/* Next Week - Rollup Row */}
              <TableRow>
                <TableCell 
                  className="font-medium text-gray-900 dark:text-gray-100 cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900"
                  style={{ width: '150px', minWidth: '150px' }}
                  onClick={() => toggleWeek('next_week')}
                >
                  <div className="flex items-center gap-2">
                    {expandedWeeks.has('next_week') ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                    <span>Next Week</span>
                  </div>
                </TableCell>
                {DAY_ORDER.map((dayNum) => {
                  const dayData = data.nextWeek.byDay.find(d => d.dayOfWeek === dayNum);
                  const count = dayData?.count || 0;
                  return (
                    <TableCell 
                      key={dayNum} 
                      className="text-center cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900 font-medium text-gray-900 dark:text-gray-100"
                      style={{ width: '80px', minWidth: '80px' }}
                      onClick={() => count > 0 && onDayClick('next_week', dayNum)}
                    >
                      {count > 0 ? count : '-'}
                    </TableCell>
                  );
                })}
                <TableCell 
                  className="text-center font-medium cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900 text-gray-900 dark:text-gray-100"
                  style={{ width: '80px', minWidth: '80px' }}
                  onClick={() => data.nextWeek.total > 0 && onWeekTotalClick('next_week')}
                >
                  {data.nextWeek.total}
                </TableCell>
              </TableRow>

              {/* Next Week - SGA Rows (when expanded) */}
              {expandedWeeks.has('next_week') && allSGAs.map((sgaName) => {
                const sgaDays = nextWeekSGAGroups.get(sgaName);
                if (!sgaDays || sgaDays.size === 0) return null;
                
                const sgaTotal = calculateSGATotal(sgaDays);
                if (sgaTotal === 0) return null;

                return (
                  <TableRow key={`next_week_${sgaName}`} className="bg-gray-50 dark:bg-gray-900/50">
                    <TableCell 
                      className="text-gray-700 dark:text-gray-300 pl-8"
                      style={{ width: '150px', minWidth: '150px' }}
                    >
                      {sgaName}
                    </TableCell>
                    {DAY_ORDER.map((dayNum) => {
                      const count = sgaDays.get(dayNum) || 0;
                      return (
                        <TableCell 
                          key={dayNum} 
                          className="text-center cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900 text-gray-700 dark:text-gray-300"
                          style={{ width: '80px', minWidth: '80px' }}
                          onClick={() => count > 0 && onDayClick('next_week', dayNum, sgaName)}
                        >
                          {count > 0 ? count : '-'}
                        </TableCell>
                      );
                    })}
                    <TableCell 
                      className="text-center font-medium cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900 text-gray-700 dark:text-gray-300"
                      style={{ width: '80px', minWidth: '80px' }}
                      onClick={() => sgaTotal > 0 && onSGAClick('next_week', sgaName)}
                    >
                      {sgaTotal}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
