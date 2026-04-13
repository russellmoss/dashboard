'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { Card } from '@tremor/react';
import { OutreachEffectivenessFilters as FilterType } from '@/types/outreach-effectiveness';
import MultiSelectCombobox from '@/components/ui/MultiSelectCombobox';

interface OutreachEffectivenessFiltersProps {
  filters: FilterType;
  onApply: (filters: FilterType) => void;
  onReset: () => void;
  sgaOptions: { value: string; label: string; isActive: boolean }[];
  campaignOptions: { value: string; label: string }[];
  showSGAFilter: boolean;
}

const DEFAULT_FILTERS: FilterType = {
  sga: null,
  dateRangeType: 'qtd',
  startDate: null,
  endDate: null,
  campaignIds: [],
  zeroTouchMode: 'stale',
};

const ActiveToggle = ({
  isActiveOnly,
  onToggle,
  label,
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
  { value: 'last_30', label: 'Last 30 Days' },
  { value: 'last_60', label: 'Last 60 Days' },
  { value: 'last_90', label: 'Last 90 Days' },
  { value: 'qtd', label: 'Quarter to Date' },
  { value: 'all_time', label: 'All Time' },
  { value: 'custom', label: 'Custom Range' },
];

function arraysEqualUnordered(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const aSorted = [...a].sort();
  const bSorted = [...b].sort();
  return aSorted.every((v, i) => v === bSorted[i]);
}

function filtersEqual(a: FilterType, b: FilterType): boolean {
  return a.sga === b.sga
    && a.dateRangeType === b.dateRangeType
    && a.startDate === b.startDate
    && a.endDate === b.endDate
    && arraysEqualUnordered(a.campaignIds, b.campaignIds)
    && a.zeroTouchMode === b.zeroTouchMode;
}

export default function OutreachEffectivenessFilters({
  filters,
  onApply,
  onReset,
  sgaOptions,
  campaignOptions,
  showSGAFilter,
}: OutreachEffectivenessFiltersProps) {
  // Local draft state — edits don't fire until Apply
  const [draft, setDraft] = useState<FilterType>(filters);
  const [sgaActiveOnly, setSgaActiveOnly] = useState<boolean>(true);

  // Sync draft when parent filters change (e.g. after reset)
  useEffect(() => {
    setDraft(filters);
  }, [filters]);

  const hasPendingChanges = !filtersEqual(draft, filters);

  const filteredSgaOptions = useMemo(() => {
    if (!sgaOptions || sgaOptions.length === 0) return [];
    return sgaActiveOnly
      ? sgaOptions.filter(opt => opt.isActive)
      : sgaOptions;
  }, [sgaOptions, sgaActiveOnly]);

  const handleChange = (key: keyof FilterType, value: any) => {
    setDraft(prev => ({ ...prev, [key]: value }));
  };

  const handleApply = () => {
    onApply(draft);
  };

  const handleReset = () => {
    setDraft(DEFAULT_FILTERS);
    onReset();
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
              value={draft.sga || ''}
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
            value={draft.dateRangeType}
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

        {/* Custom Date Range */}
        {draft.dateRangeType === 'custom' && (
          <div className="min-w-[250px]">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
              Custom Range
            </label>
            <div className="flex gap-2">
              <input
                type="date"
                value={draft.startDate || ''}
                onChange={(e) => handleChange('startDate', e.target.value || null)}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
              <span className="self-center text-gray-500 dark:text-gray-400">to</span>
              <input
                type="date"
                value={draft.endDate || ''}
                onChange={(e) => handleChange('endDate', e.target.value || null)}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
          </div>
        )}

        {/* Campaign Filter — multi-select with substring search.
            "Self Sourced" is a synthetic chip surfaced by the filter-options
            API; the backend detects its sentinel id in buildCampaignFilter.
            Empty selection = no campaign filter (all campaigns shown). */}
        <div className="min-w-[260px] flex-1 max-w-[420px]">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
            Campaign
          </label>
          <MultiSelectCombobox
            ariaLabel="Campaign"
            placeholder="All campaigns — type to search…"
            options={[
              { value: 'no_campaign', label: 'No Campaign' },
              ...campaignOptions,
            ]}
            selected={draft.campaignIds}
            onChange={(next) => handleChange('campaignIds', next)}
          />
        </div>
      </div>

      {/* Apply / Reset */}
      <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700 flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={handleApply}
          disabled={!hasPendingChanges}
          className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-blue-600 rounded transition-colors"
        >
          Apply filters
        </button>
        <button
          type="button"
          onClick={handleReset}
          className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
        >
          Reset filters
        </button>
      </div>
    </Card>
  );
}
