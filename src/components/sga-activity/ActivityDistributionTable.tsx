'use client';

import React, { useState } from 'react';
import { Card, Text, Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell } from '@tremor/react';
import { ActivityDistribution, ActivityChannel, SGAActivityFilters } from '@/types/sga-activity';

interface ActivityDistributionTableProps {
  distributions: ActivityDistribution[];
  onCellClick: (channel: ActivityChannel | undefined, dayOfWeek: number, period: 'A' | 'B') => void;
  filters: SGAActivityFilters;
  onFiltersChange: (filters: SGAActivityFilters) => void;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon-Sun
// Map DAY_ORDER values to their display names
// DAY_ORDER [1,2,3,4,5,6,0] → ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
const DAY_ORDER_TO_NAME: Record<number, string> = {
  0: 'Sun',
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
};

const DATE_RANGE_PRESETS = [
  { value: 'this_week', label: 'This Week' },
  { value: 'next_week', label: 'Next Week' },
  { value: 'last_30', label: 'Last 30 Days' },
  { value: 'last_60', label: 'Last 60 Days' },
  { value: 'last_90', label: 'Last 90 Days' },
  { value: 'qtd', label: 'Quarter to Date' },
  { value: 'all_time', label: 'All Time' },
  { value: 'custom', label: 'Custom Range' },
];

export default function ActivityDistributionTable({
  distributions,
  onCellClick,
  filters,
  onFiltersChange,
}: ActivityDistributionTableProps) {
  const handlePeriodChange = (period: 'A' | 'B', key: 'Type' | 'StartDate' | 'EndDate', value: any) => {
    if (period === 'A') {
      if (key === 'Type') {
        onFiltersChange({ ...filters, periodAType: value });
      } else if (key === 'StartDate') {
        onFiltersChange({ ...filters, periodAStartDate: value });
      } else {
        onFiltersChange({ ...filters, periodAEndDate: value });
      }
    } else {
      if (key === 'Type') {
        onFiltersChange({ ...filters, periodBType: value });
      } else if (key === 'StartDate') {
        onFiltersChange({ ...filters, periodBStartDate: value });
      } else {
        onFiltersChange({ ...filters, periodBEndDate: value });
      }
    }
  };

  // Determine view mode (default to average)
  const viewMode = filters.distributionViewMode || 'average';
  const isSumMode = viewMode === 'sum';

  // Calculate rollup: Sum all channels for each day of week (excluding "Other")
  const rollupPeriodA = new Map<number, number>();
  const rollupPeriodB = new Map<number, number>();

  distributions.forEach((dist) => {
    // Skip "Other" channel from rollup calculations
    if (dist.channel === 'Other') {
      return;
    }
    
    // Sum Period A counts (use total or avg based on view mode)
    dist.currentPeriod.forEach((day) => {
      const current = rollupPeriodA.get(day.dayOfWeek) || 0;
      const value = isSumMode ? (day.totalCount || day.count) : day.count;
      rollupPeriodA.set(day.dayOfWeek, current + value);
    });

    // Sum Period B (use total or avg based on view mode)
    dist.comparisonPeriod.forEach((day) => {
      const current = rollupPeriodB.get(day.dayOfWeek) || 0;
      const value = isSumMode ? (day.totalCount || 0) : (day.avgCount || 0);
      rollupPeriodB.set(day.dayOfWeek, current + value);
    });
  });

  // Calculate variance from summed values
  const rollupVariance = new Map<number, number>();
  DAY_ORDER.forEach((dayNum) => {
    const periodA = rollupPeriodA.get(dayNum) || 0;
    const periodB = rollupPeriodB.get(dayNum) || 0;
    const variance = periodA - periodB;
    rollupVariance.set(dayNum, variance);
  });

  return (
    <Card className="dark:bg-gray-800 dark:border-gray-700">
      <div className="mb-4">
        <Text className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">Activity Distribution by Day of Week</Text>
        
        {/* Period A/B Filters - Only for this table */}
        <div className="flex flex-wrap gap-4 items-end mb-4 p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
          {/* Period A */}
          <div className="min-w-[180px]">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
              Period A
            </label>
            <select
              value={filters.periodAType || 'this_week'}
              onChange={(e) => handlePeriodChange('A', 'Type', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
            >
              {DATE_RANGE_PRESETS.map((preset) => (
                <option key={preset.value} value={preset.value}>
                  {preset.label}
                </option>
              ))}
            </select>
          </div>

          {/* Custom Date Range for Period A (if selected) */}
          {filters.periodAType === 'custom' && (
            <div className="min-w-[250px]">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                Period A Range
              </label>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={filters.periodAStartDate || ''}
                  onChange={(e) => handlePeriodChange('A', 'StartDate', e.target.value || null)}
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
                <span className="self-center text-gray-500 dark:text-gray-400">to</span>
                <input
                  type="date"
                  value={filters.periodAEndDate || ''}
                  onChange={(e) => handlePeriodChange('A', 'EndDate', e.target.value || null)}
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>
            </div>
          )}

          {/* Period B */}
          <div className="min-w-[180px]">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
              Period B
            </label>
            <select
              value={filters.periodBType || 'last_30'}
              onChange={(e) => handlePeriodChange('B', 'Type', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
            >
              {DATE_RANGE_PRESETS.map((preset) => (
                <option key={preset.value} value={preset.value}>
                  {preset.label}
                </option>
              ))}
            </select>
          </div>

          {/* Custom Date Range for Period B (if selected) */}
          {filters.periodBType === 'custom' && (
            <div className="min-w-[250px]">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                Period B Range
              </label>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={filters.periodBStartDate || ''}
                  onChange={(e) => handlePeriodChange('B', 'StartDate', e.target.value || null)}
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
                <span className="self-center text-gray-500 dark:text-gray-400">to</span>
                <input
                  type="date"
                  value={filters.periodBEndDate || ''}
                  onChange={(e) => handlePeriodChange('B', 'EndDate', e.target.value || null)}
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>
            </div>
          )}

          {/* View Mode Toggle */}
          <div className="min-w-[150px]">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
              View Mode
            </label>
            <select
              value={filters.distributionViewMode || 'average'}
              onChange={(e) => onFiltersChange({ ...filters, distributionViewMode: e.target.value as 'average' | 'sum' })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
            >
              <option value="average">Average</option>
              <option value="sum">Sum</option>
            </select>
          </div>
        </div>
      </div>

      {/* Rollup Table - All Activity Combined */}
      <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border-2 border-blue-200 dark:border-blue-700 rounded-lg">
        <div className="flex items-center gap-2 mb-3">
          <Text className="font-semibold text-blue-900 dark:text-blue-100">All Activity Rollup</Text>
          <span className="px-2 py-1 text-xs font-medium bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200 rounded">
            Sum of All Channels
          </span>
        </div>
        <div className="overflow-x-auto">
          <Table className="w-full" style={{ tableLayout: 'fixed' }}>
            <TableHead>
              <TableRow>
                <TableHeaderCell className="text-left" style={{ width: '120px', minWidth: '120px' }}>Metric</TableHeaderCell>
                {DAY_ORDER.map((dayNum) => (
                  <TableHeaderCell key={dayNum} className="text-center" style={{ width: '80px', minWidth: '80px' }}>
                    {DAY_ORDER_TO_NAME[dayNum]}
                  </TableHeaderCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {/* Period A Row */}
              <TableRow>
                <TableCell className="text-left font-medium text-blue-900 dark:text-blue-100" style={{ width: '120px', minWidth: '120px' }}>Period A</TableCell>
                {DAY_ORDER.map((dayNum) => {
                  const count = rollupPeriodA.get(dayNum) || 0;
                  return (
                    <TableCell 
                      key={dayNum} 
                      className="text-center cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-800 font-medium text-blue-900 dark:text-blue-100"
                      style={{ width: '80px', minWidth: '80px' }}
                      onClick={() => count > 0 && onCellClick(undefined, dayNum, 'A')}
                    >
                      {count > 0 ? Math.round(count) : '-'}
                    </TableCell>
                  );
                })}
              </TableRow>
              
              {/* Period B Row */}
              <TableRow>
                <TableCell className="text-left text-blue-700 dark:text-blue-300" style={{ width: '120px', minWidth: '120px' }}>
                  Period B
                </TableCell>
                {DAY_ORDER.map((dayNum) => {
                  const value = rollupPeriodB.get(dayNum);
                  return (
                    <TableCell 
                      key={dayNum} 
                      className="text-center cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-800 font-medium text-blue-700 dark:text-blue-300"
                      style={{ width: '80px', minWidth: '80px' }}
                      onClick={() => value !== undefined && value !== null && value > 0 && onCellClick(undefined, dayNum, 'B')}
                    >
                      {value !== undefined && value !== null && value > 0 ? Math.round(value) : '-'}
                    </TableCell>
                  );
                })}
              </TableRow>
              
              {/* Variance Row */}
              <TableRow>
                <TableCell className="text-left text-blue-700 dark:text-blue-300" style={{ width: '120px', minWidth: '120px' }}>Variance</TableCell>
                {DAY_ORDER.map((dayNum) => {
                  const periodB = rollupPeriodB.get(dayNum) || 0;
                  const variance = rollupVariance.get(dayNum);
                  
                  if (variance === undefined || periodB === 0) {
                    return <TableCell key={dayNum} className="text-center text-blue-700 dark:text-blue-300" style={{ width: '80px', minWidth: '80px' }}>-</TableCell>;
                  }
                  
                  const isPositive = variance > 0;
                  const isNegative = variance < 0;
                  const textColorClass = isPositive 
                    ? 'text-green-600 dark:text-green-400' 
                    : isNegative
                    ? 'text-red-600 dark:text-red-400' 
                    : 'text-blue-700 dark:text-blue-300';
                  
                  return (
                    <TableCell 
                      key={dayNum} 
                      className="text-center" 
                      style={{ width: '80px', minWidth: '80px' }}
                    >
                      <span className={textColorClass}>
                        {isPositive ? '+' : ''}{Math.round(variance)}
                      </span>
                    </TableCell>
                  );
                })}
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>
      
      {/* Sort distributions: SMS first, then others (excluding Other) */}
      {[...distributions]
        .filter(dist => dist.channel !== 'Other')  // Filter out Other for main tables
        .sort((a, b) => {
          // Define custom order: SMS first, then Call, Email, LinkedIn
          const order: Record<string, number> = {
            'SMS': 1,
            'Call': 2,
            'Email': 3,
            'LinkedIn': 4,
          };
          const orderA = order[a.channel] || 999;
          const orderB = order[b.channel] || 999;
          return orderA - orderB;
        })
        .map((dist) => (
          <div key={dist.channel} className="mb-6 last:mb-0">
            <Text className="font-medium mb-2 text-gray-900 dark:text-gray-100">{dist.channel}</Text>
          <div className="overflow-x-auto">
            <Table className="w-full" style={{ tableLayout: 'fixed' }}>
              <TableHead>
                <TableRow>
                  <TableHeaderCell className="text-left" style={{ width: '120px', minWidth: '120px' }}>Metric</TableHeaderCell>
                  {DAY_ORDER.map((dayNum) => (
                    <TableHeaderCell key={dayNum} className="text-center" style={{ width: '80px', minWidth: '80px' }}>
                      {DAY_ORDER_TO_NAME[dayNum]}
                    </TableHeaderCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {/* Period A Row */}
                <TableRow>
                  <TableCell className="text-left font-medium text-gray-900 dark:text-gray-100" style={{ width: '120px', minWidth: '120px' }}>Period A</TableCell>
                  {DAY_ORDER.map((dayNum) => {
                    const dayData = dist.currentPeriod.find(d => d.dayOfWeek === dayNum);
                    const displayValue = isSumMode 
                      ? (dayData?.totalCount ?? dayData?.count ?? 0)
                      : (dayData?.count ?? 0);
                    return (
                      <TableCell 
                        key={dayNum} 
                        className="text-center cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900 font-medium text-gray-900 dark:text-gray-100"
                        style={{ width: '80px', minWidth: '80px' }}
                        onClick={() => displayValue > 0 && onCellClick(dist.channel, dayNum, 'A')}
                      >
                        {displayValue > 0 ? Math.round(displayValue) : '-'}
                      </TableCell>
                    );
                  })}
                </TableRow>
                
                {/* Period B Row */}
                <TableRow>
                  <TableCell className="text-left text-gray-500 dark:text-gray-400" style={{ width: '120px', minWidth: '120px' }}>
                    Period B
                  </TableCell>
                  {DAY_ORDER.map((dayNum) => {
                    const dayData = dist.comparisonPeriod.find(d => d.dayOfWeek === dayNum);
                    const displayValue = isSumMode 
                      ? (dayData?.totalCount ?? 0)
                      : (dayData?.avgCount ?? 0);
                    return (
                      <TableCell 
                        key={dayNum} 
                        className="text-center cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900 font-medium text-gray-500 dark:text-gray-400"
                        style={{ width: '80px', minWidth: '80px' }}
                        onClick={() => displayValue > 0 && onCellClick(dist.channel, dayNum, 'B')}
                      >
                        {displayValue > 0 ? Math.round(displayValue) : '-'}
                      </TableCell>
                    );
                  })}
                </TableRow>
                
                {/* Variance Row */}
                <TableRow>
                  <TableCell className="text-left text-gray-500 dark:text-gray-400" style={{ width: '120px', minWidth: '120px' }}>Variance</TableCell>
                  {DAY_ORDER.map((dayNum) => {
                    const varData = dist.variance.find(d => d.dayOfWeek === dayNum);
                    if (!varData) {
                      return <TableCell key={dayNum} className="text-center text-gray-500 dark:text-gray-400" style={{ width: '80px', minWidth: '80px' }}>-</TableCell>;
                    }
                    
                    const comparisonValue = isSumMode ? varData.comparisonTotal : varData.comparisonCount;
                    const varianceValue = isSumMode ? varData.varianceTotal : varData.variance;
                    
                    if (comparisonValue === 0) {
                      return <TableCell key={dayNum} className="text-center text-gray-500 dark:text-gray-400" style={{ width: '80px', minWidth: '80px' }}>-</TableCell>;
                    }
                    
                    const isPositive = varianceValue > 0;
                    const isNegative = varianceValue < 0;
                    const textColorClass = isPositive 
                      ? 'text-green-600 dark:text-green-400' 
                      : isNegative
                      ? 'text-red-600 dark:text-red-400' 
                      : 'text-gray-500 dark:text-gray-400';
                    
                    return (
                      <TableCell 
                        key={dayNum} 
                        className="text-center" 
                        style={{ width: '80px', minWidth: '80px' }}
                      >
                        <span className={textColorClass}>
                          {isPositive ? '+' : ''}{Math.round(varianceValue)}
                        </span>
                      </TableCell>
                    );
                  })}
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </div>
      ))}
      
      {/* Other Channel - Debugging/Monitoring Table */}
      {distributions.find(dist => dist.channel === 'Other') && (
        <div className="mt-8 pt-6 border-t-2 border-dashed border-gray-300 dark:border-gray-600">
          <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg">
            <div className="flex items-center gap-2 mb-1">
              <Text className="font-semibold text-amber-900 dark:text-amber-100">Other Channel</Text>
              <span className="px-2 py-1 text-xs font-medium bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200 rounded">
                Debugging & Monitoring
              </span>
            </div>
            <Text className="text-sm text-amber-700 dark:text-amber-300">
              Fallback for tasks that cannot be classified into standard channels. Not included in rollup calculations.
            </Text>
          </div>
          <div className="overflow-x-auto">
            <Table className="w-full" style={{ tableLayout: 'fixed' }}>
              <TableHead>
                <TableRow>
                  <TableHeaderCell className="text-left" style={{ width: '120px', minWidth: '120px' }}>Metric</TableHeaderCell>
                  {DAY_ORDER.map((dayNum) => (
                    <TableHeaderCell key={dayNum} className="text-center" style={{ width: '80px', minWidth: '80px' }}>
                      {DAY_ORDER_TO_NAME[dayNum]}
                    </TableHeaderCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {(() => {
                  const otherDist = distributions.find(dist => dist.channel === 'Other');
                  if (!otherDist) return null;
                  
                  return (
                    <>
                      {/* Period A Row */}
                      <TableRow>
                        <TableCell className="text-left font-medium text-amber-900 dark:text-amber-100" style={{ width: '120px', minWidth: '120px' }}>Period A</TableCell>
                        {DAY_ORDER.map((dayNum) => {
                          const dayData = otherDist.currentPeriod.find(d => d.dayOfWeek === dayNum);
                          const displayValue = isSumMode 
                            ? (dayData?.totalCount ?? dayData?.count ?? 0)
                            : (dayData?.count ?? 0);
                          return (
                            <TableCell 
                              key={dayNum} 
                              className="text-center cursor-pointer hover:bg-amber-50 dark:hover:bg-amber-900 font-medium text-amber-900 dark:text-amber-100"
                              style={{ width: '80px', minWidth: '80px' }}
                              onClick={() => displayValue > 0 && onCellClick(otherDist.channel, dayNum, 'A')}
                            >
                              {displayValue > 0 ? Math.round(displayValue) : '-'}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                      
                      {/* Period B Row */}
                      <TableRow>
                        <TableCell className="text-left text-amber-700 dark:text-amber-300" style={{ width: '120px', minWidth: '120px' }}>
                          Period B
                        </TableCell>
                        {DAY_ORDER.map((dayNum) => {
                          const dayData = otherDist.comparisonPeriod.find(d => d.dayOfWeek === dayNum);
                          const displayValue = isSumMode 
                            ? (dayData?.totalCount ?? 0)
                            : (dayData?.avgCount ?? 0);
                          return (
                            <TableCell 
                              key={dayNum} 
                              className="text-center cursor-pointer hover:bg-amber-50 dark:hover:bg-amber-900 font-medium text-amber-700 dark:text-amber-300"
                              style={{ width: '80px', minWidth: '80px' }}
                              onClick={() => displayValue > 0 && onCellClick(otherDist.channel, dayNum, 'B')}
                            >
                              {displayValue > 0 ? Math.round(displayValue) : '-'}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                      
                      {/* Variance Row */}
                      <TableRow>
                        <TableCell className="text-left text-amber-700 dark:text-amber-300" style={{ width: '120px', minWidth: '120px' }}>Variance</TableCell>
                        {DAY_ORDER.map((dayNum) => {
                          const varData = otherDist.variance.find(d => d.dayOfWeek === dayNum);
                          if (!varData) {
                            return <TableCell key={dayNum} className="text-center text-amber-700 dark:text-amber-300" style={{ width: '80px', minWidth: '80px' }}>-</TableCell>;
                          }
                          
                          const comparisonValue = isSumMode ? varData.comparisonTotal : varData.comparisonCount;
                          const varianceValue = isSumMode ? varData.varianceTotal : varData.variance;
                          
                          if (comparisonValue === 0) {
                            return <TableCell key={dayNum} className="text-center text-amber-700 dark:text-amber-300" style={{ width: '80px', minWidth: '80px' }}>-</TableCell>;
                          }
                          
                          const isPositive = varianceValue > 0;
                          const isNegative = varianceValue < 0;
                          const textColorClass = isPositive 
                            ? 'text-green-600 dark:text-green-400' 
                            : isNegative
                            ? 'text-red-600 dark:text-red-400' 
                            : 'text-amber-700 dark:text-amber-300';
                          
                          return (
                            <TableCell 
                              key={dayNum} 
                              className="text-center" 
                              style={{ width: '80px', minWidth: '80px' }}
                            >
                              <span className={textColorClass}>
                                {isPositive ? '+' : ''}{Math.round(varianceValue)}
                              </span>
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    </>
                  );
                })()}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </Card>
  );
}
