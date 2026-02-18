'use client';

import { Card } from '@tremor/react';
import { Calendar } from 'lucide-react';
import { SqlDateRange } from '@/types/dashboard';

const DATE_PRESETS = [
  { value: 'alltime', label: 'All Time' },
  { value: 'ytd', label: 'Year to Date' },
  { value: 'qtd', label: 'Quarter to Date' },
  { value: 'q1', label: 'Q1' },
  { value: 'q2', label: 'Q2' },
  { value: 'q3', label: 'Q3' },
  { value: 'q4', label: 'Q4' },
  { value: 'custom', label: 'Custom Range' },
] as const;

interface SqlDateFilterProps {
  value: SqlDateRange | null;
  onChange: (value: SqlDateRange | null) => void;
  disabled?: boolean;
}

export function SqlDateFilter({ value, onChange, disabled = false }: SqlDateFilterProps) {
  const currentYear = new Date().getFullYear();
  const years = [currentYear, currentYear - 1, currentYear - 2];

  const preset = value?.preset || 'alltime';
  const year = value?.year || currentYear;

  const handlePresetChange = (newPreset: string) => {
    if (newPreset === 'alltime') {
      onChange(null);
      return;
    }
    onChange({
      preset: newPreset as SqlDateRange['preset'],
      year: ['ytd', 'qtd'].includes(newPreset) ? currentYear : year,
      startDate: value?.startDate || null,
      endDate: value?.endDate || null,
    });
  };

  const handleYearChange = (newYear: number) => {
    if (!value) return;
    onChange({ ...value, year: newYear });
  };

  const handleStartDateChange = (date: string) => {
    onChange({
      preset: 'custom',
      year: currentYear,
      startDate: date,
      endDate: value?.endDate || null,
    });
  };

  const handleEndDateChange = (date: string) => {
    onChange({
      preset: 'custom',
      year: currentYear,
      startDate: value?.startDate || null,
      endDate: date,
    });
  };

  const showYearSelector = ['q1', 'q2', 'q3', 'q4'].includes(preset);
  const showCustomDates = preset === 'custom';

  return (
    <Card className="mb-4 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Calendar className="w-4 h-4 text-gray-500 dark:text-gray-400" />
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          SQL Creation Date
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          (scopes chart and table to SQLs created in this period)
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {/* Preset Selector */}
        <select
          value={preset}
          onChange={(e) => handlePresetChange(e.target.value)}
          disabled={disabled}
          className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                     bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
                     focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none
                     disabled:opacity-50 disabled:cursor-not-allowed text-sm"
        >
          {DATE_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>

        {/* Year Selector (for Q1-Q4) */}
        {showYearSelector && (
          <select
            value={year}
            onChange={(e) => handleYearChange(parseInt(e.target.value))}
            disabled={disabled}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                       bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
                       focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none
                       disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        )}

        {/* Custom Date Range */}
        {showCustomDates && (
          <>
            <input
              type="date"
              value={value?.startDate || ''}
              onChange={(e) => handleStartDateChange(e.target.value)}
              disabled={disabled}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                         bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
                         focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none
                         disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            />
            <span className="text-gray-500 dark:text-gray-400 text-sm">to</span>
            <input
              type="date"
              value={value?.endDate || ''}
              onChange={(e) => handleEndDateChange(e.target.value)}
              disabled={disabled}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                         bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
                         focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none
                         disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            />
          </>
        )}
      </div>
    </Card>
  );
}
