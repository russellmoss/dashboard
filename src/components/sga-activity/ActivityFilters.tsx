'use client';

import React, { useState, useMemo } from 'react';
import { Card } from '@tremor/react';
import { SGAActivityFilters } from '@/types/sga-activity';

interface ActivityFiltersProps {
  filters: SGAActivityFilters;
  onFiltersChange: (filters: SGAActivityFilters) => void;
  sgaOptions: { value: string; label: string; isActive: boolean }[];
  showSGAFilter: boolean;  // Hide for SGA role
}

const ActiveToggle = ({ 
  isActiveOnly, 
  onToggle, 
  label 
}: { 
  isActiveOnly: boolean; 
  onToggle: () => void; 
  label: string;
}) => (
  <div className="flex items-center gap-1.5 ml-2">
    <span className={`text-xs ${isActiveOnly ? 'text-blue-600 font-medium dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'}`}>
      Active
    </span>
    <button
      type="button"
      onClick={onToggle}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 ${
        isActiveOnly ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
      }`}
      role="switch"
      aria-checked={isActiveOnly}
      aria-label={`Toggle ${label} active filter`}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
          isActiveOnly ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
    <span className={`text-xs ${!isActiveOnly ? 'text-blue-600 font-medium dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'}`}>
      All
    </span>
  </div>
);

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


export default function ActivityFilters({
  filters,
  onFiltersChange,
  sgaOptions,
  showSGAFilter,
}: ActivityFiltersProps) {
  // Toggle state for showing only active SGAs (default: true = active only)
  const [sgaActiveOnly, setSgaActiveOnly] = useState<boolean>(true);

  // Filter SGA options based on active toggle
  const filteredSgaOptions = useMemo(() => {
    if (!sgaOptions || sgaOptions.length === 0) return [];
    return sgaActiveOnly 
      ? sgaOptions.filter(opt => opt.isActive) 
      : sgaOptions;
  }, [sgaOptions, sgaActiveOnly]);

  const handleChange = (key: keyof SGAActivityFilters, value: any) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  return (
    <Card className="mb-6 p-4 border border-gray-200 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex flex-wrap gap-4 items-end">
        {/* SGA Filter */}
        {showSGAFilter && (
          <div className="min-w-[200px]">
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                SGA
              </label>
              <ActiveToggle 
                isActiveOnly={sgaActiveOnly} 
                onToggle={() => setSgaActiveOnly(!sgaActiveOnly)} 
                label="SGA"
              />
            </div>
            <select
              value={filters.sga || ''}
              onChange={(e) => handleChange('sga', e.target.value === '' ? null : e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
            >
              <option value="">All SGAs</option>
              {filteredSgaOptions.map((sga) => (
                <option key={sga.value} value={sga.value}>
                  {sga.label}{!sgaActiveOnly && !sga.isActive ? ' (Inactive)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Date Range */}
        <div className="min-w-[180px]">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
            Date Range
          </label>
          <select
            value={filters.dateRangeType}
            onChange={(e) => handleChange('dateRangeType', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
          >
            {DATE_RANGE_PRESETS.map((preset) => (
              <option key={preset.value} value={preset.value}>
                {preset.label}
              </option>
            ))}
          </select>
        </div>

        {/* Custom Date Range (if selected) */}
        {filters.dateRangeType === 'custom' && (
          <div className="min-w-[250px]">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
              Custom Range
            </label>
            <div className="flex gap-2">
              <input
                type="date"
                value={filters.startDate || ''}
                onChange={(e) => handleChange('startDate', e.target.value || null)}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
              <span className="self-center text-gray-500 dark:text-gray-400">to</span>
              <input
                type="date"
                value={filters.endDate || ''}
                onChange={(e) => handleChange('endDate', e.target.value || null)}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
