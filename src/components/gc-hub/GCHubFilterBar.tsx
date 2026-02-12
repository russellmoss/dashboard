// src/components/gc-hub/GCHubFilterBar.tsx

'use client';

import { useState } from 'react';
import { Card, Text } from '@tremor/react';
import { Filter, X } from 'lucide-react';
import type { GcHubFilterState, GcHubFilterOptions } from '@/types/gc-hub';
import { GC_DEFAULT_DATE_RANGE, getDefaultEndDate } from '@/config/gc-hub-theme';

interface GCHubFilterBarProps {
  filters: GcHubFilterState;
  onFilterChange: (filters: GcHubFilterState) => void;
  filterOptions: GcHubFilterOptions | null;
  isAdmin: boolean;
  isCapitalPartner?: boolean;
  isLoading?: boolean;
}

export function GCHubFilterBar({
  filters,
  onFilterChange,
  filterOptions,
  isAdmin,
  isCapitalPartner = false,
  isLoading = false,
}: GCHubFilterBarProps) {
  const [expanded, setExpanded] = useState(false);

  const defaultEnd = getDefaultEndDate();
  const hasActiveFilters =
    filters.accountNames.length > 0 ||
    filters.advisorNames.length > 0 ||
    filters.startDate !== GC_DEFAULT_DATE_RANGE.startDate ||
    filters.endDate !== defaultEnd;

  const clearFilters = () => {
    onFilterChange({
      startDate: GC_DEFAULT_DATE_RANGE.startDate,
      endDate: getDefaultEndDate(),
      accountNames: [],
      advisorNames: [],
      billingFrequency: '',
      search: '',
    });
  };

  const activeFilterCount = [
    filters.accountNames.length > 0,
    filters.advisorNames.length > 0,
    filters.startDate !== GC_DEFAULT_DATE_RANGE.startDate || filters.endDate !== defaultEnd,
  ].filter(Boolean).length;

  return (
    <Card className="p-4 dark:bg-gray-800 dark:border-gray-700">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {/* Date Range */}
        <div className="flex items-center gap-3">
          <label htmlFor="gc-filter-start-date" className="text-sm font-medium text-gray-700 dark:text-gray-300">From</label>
          <input
            id="gc-filter-start-date"
            type="date"
            value={filters.startDate}
            onChange={(e) => onFilterChange({ ...filters, startDate: e.target.value })}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
          <label htmlFor="gc-filter-end-date" className="text-sm font-medium text-gray-700 dark:text-gray-300">to</label>
          <input
            id="gc-filter-end-date"
            type="date"
            value={filters.endDate}
            onChange={(e) => onFilterChange({ ...filters, endDate: e.target.value })}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
        </div>

        {/* Filter Toggle + Clear */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            aria-controls="gc-hub-expanded-filters"
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              expanded || hasActiveFilters
                ? 'border-blue-500 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20'
                : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}
          >
            <Filter className="w-4 h-4" aria-hidden="true" />
            Filters
            {activeFilterCount > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-xs bg-blue-500 text-white rounded-full" aria-label={`${activeFilterCount} active filters`}>
                {activeFilterCount}
              </span>
            )}
          </button>
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              aria-label="Clear all filters"
              className="flex items-center gap-1 px-2 py-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Expanded Filters */}
      {expanded && filterOptions && (
        <div id="gc-hub-expanded-filters" className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Team / Account Filter */}
          <div>
            <label htmlFor="gc-filter-team" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Team
            </label>
            <select
              id="gc-filter-team"
              value={filters.accountNames[0] || ''}
              onChange={(e) => {
                const newTeam = e.target.value;
                // Clear advisor selection if it's not on the new team
                const teamAdvisors = newTeam ? filterOptions.advisorsByAccount[newTeam] || [] : [];
                const currentAdvisor = filters.advisorNames[0];
                const shouldClearAdvisor = currentAdvisor && newTeam && !teamAdvisors.includes(currentAdvisor);

                onFilterChange({
                  ...filters,
                  accountNames: newTeam ? [newTeam] : [],
                  advisorNames: shouldClearAdvisor ? [] : filters.advisorNames,
                });
              }}
              className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="">All Teams</option>
              {filterOptions.accountNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          {/* Advisor Filter (admin + capital partner — CP sees anonymized names) */}
          {(isAdmin || isCapitalPartner) && (
            <div>
              <label htmlFor="gc-filter-advisor" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Advisor
              </label>
              <select
                id="gc-filter-advisor"
                value={filters.advisorNames[0] || ''}
                onChange={(e) =>
                  onFilterChange({
                    ...filters,
                    advisorNames: e.target.value ? [e.target.value] : [],
                  })
                }
                className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                <option value="">
                  {filters.accountNames[0] ? 'All Team Members' : 'All Advisors'}
                </option>
                {/* Show filtered advisors if team selected, otherwise show all */}
                {(filters.accountNames[0]
                  ? filterOptions.advisorsByAccount[filters.accountNames[0]] || []
                  : filterOptions.advisorNames
                ).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          )}

        </div>
      )}
    </Card>
  );
}
