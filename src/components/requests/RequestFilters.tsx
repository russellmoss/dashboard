'use client';

import { useState } from 'react';
import { Search, Filter, X, ChevronDown, ChevronUp } from 'lucide-react';
import {
  RequestFilters as RequestFiltersType,
  RequestType,
  RequestPriority,
  TYPE_LABELS,
  PRIORITY_LABELS,
} from '@/types/dashboard-request';

interface RequestFiltersProps {
  filters: RequestFiltersType;
  onChange: (filters: RequestFiltersType) => void;
  canManageRequests: boolean;
}

// Shared input styles for dark mode support
const selectStyles = "px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-white";
const inputStyles = "px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-400";

export function RequestFilters({
  filters,
  onChange,
  canManageRequests,
}: RequestFiltersProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const updateFilter = <K extends keyof RequestFiltersType>(
    key: K,
    value: RequestFiltersType[K]
  ) => {
    onChange({ ...filters, [key]: value });
  };

  const clearFilters = () => {
    onChange({});
  };

  const hasActiveFilters =
    filters.search ||
    filters.requestType ||
    filters.priority ||
    filters.submitterId ||
    filters.dateFrom ||
    filters.dateTo;

  return (
    <div className="space-y-3">
      {/* Main Filter Row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-[400px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={filters.search || ''}
            onChange={(e) => updateFilter('search', e.target.value || undefined)}
            placeholder="Search requests..."
            className={`${inputStyles} pl-9 w-full`}
          />
        </div>

        {/* Type Filter */}
        <select
          value={filters.requestType || ''}
          onChange={(e) =>
            updateFilter('requestType', (e.target.value as RequestType) || undefined)
          }
          className={selectStyles}
        >
          <option value="">All Types</option>
          <option value="FEATURE_REQUEST">{TYPE_LABELS.FEATURE_REQUEST}</option>
          <option value="DATA_ERROR">{TYPE_LABELS.DATA_ERROR}</option>
        </select>

        {/* Priority Filter */}
        <select
          value={filters.priority || ''}
          onChange={(e) =>
            updateFilter('priority', (e.target.value as RequestPriority) || undefined)
          }
          className={selectStyles}
        >
          <option value="">All Priorities</option>
          <option value="IMMEDIATE">{PRIORITY_LABELS.IMMEDIATE}</option>
          <option value="HIGH">{PRIORITY_LABELS.HIGH}</option>
          <option value="MEDIUM">{PRIORITY_LABELS.MEDIUM}</option>
          <option value="LOW">{PRIORITY_LABELS.LOW}</option>
        </select>

        {/* Advanced Filters Toggle */}
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          <Filter className="w-4 h-4" />
          More
          {showAdvanced ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </button>

        {/* Clear Filters */}
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-1 px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
            Clear
          </button>
        )}
      </div>

      {/* Advanced Filters Row */}
      {showAdvanced && (
        <div className="flex flex-wrap items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          {/* Date From */}
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600 dark:text-gray-400">From:</label>
            <input
              type="date"
              value={filters.dateFrom || ''}
              onChange={(e) => updateFilter('dateFrom', e.target.value || undefined)}
              className={inputStyles}
            />
          </div>

          {/* Date To */}
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600 dark:text-gray-400">To:</label>
            <input
              type="date"
              value={filters.dateTo || ''}
              onChange={(e) => updateFilter('dateTo', e.target.value || undefined)}
              className={inputStyles}
            />
          </div>

          {/* Include Archived (Admin only) */}
          {canManageRequests && (
            <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={filters.includeArchived || false}
                onChange={(e) => updateFilter('includeArchived', e.target.checked || undefined)}
                className="w-4 h-4 text-blue-600 rounded border-gray-300 dark:border-gray-600 focus:ring-blue-500 dark:bg-gray-700"
              />
              Include Archived
            </label>
          )}
        </div>
      )}
    </div>
  );
}
