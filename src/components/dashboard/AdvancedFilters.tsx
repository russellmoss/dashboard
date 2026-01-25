'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { 
  AdvancedFilters as AdvancedFiltersType,
  DateRangeFilter,
  MultiSelectFilter,
  FilterOption,
  DEFAULT_ADVANCED_FILTERS,
  hasActiveAdvancedFilters,
  countActiveAdvancedFilters,
} from '@/types/filters';
import { ViewMode } from '@/types/dashboard';
import { FilterOptions } from '@/types/filters';

interface AdvancedFiltersProps {
  filters: AdvancedFiltersType;
  onFiltersChange: (filters: AdvancedFiltersType) => void;
  onApply?: () => void; // Optional: if provided, will be called to actually apply filters
  viewMode: ViewMode;
  onClose: () => void;
  isOpen: boolean;
  filterOptions: FilterOptions;
}

interface DateRangeFilterControlProps {
  label: string;
  filter: DateRangeFilter;
  onChange: (updates: Partial<DateRangeFilter>) => void;
}

interface MultiSelectFilterControlProps {
  label: string;
  options: FilterOption[];
  filter: MultiSelectFilter;
  onSelectAll: () => void;
  onChange: (value: string, checked: boolean) => void;
  searchable?: boolean;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
}

interface AdvancedFiltersButtonProps {
  onClick: () => void;
  activeCount: number;
}

export function AdvancedFilters({
  filters,
  onFiltersChange,
  onApply,
  viewMode,
  onClose,
  isOpen,
  filterOptions,
}: AdvancedFiltersProps) {
  const [localFilters, setLocalFilters] = useState<AdvancedFiltersType>(filters);
  
  // Search states for multi-select dropdowns
  const [sourceSearch, setSourceSearch] = useState('');
  const [sgaSearch, setSgaSearch] = useState('');
  const [sgmSearch, setSgmSearch] = useState('');
  const [experimentationTagSearch, setExperimentationTagSearch] = useState('');

  // Sync local filters when prop changes
  useEffect(() => {
    setLocalFilters(filters);
  }, [filters]);

  // Filter sources/SGAs/SGMs by search
  // Note: filterOptions.sources is string[], filterOptions.sgas/sgms are FilterOption[]
  const filteredSources = useMemo(() => {
    if (!filterOptions?.sources) return [];
    return filterOptions.sources.filter(s => 
      s.toLowerCase().includes(sourceSearch.toLowerCase())
    );
  }, [filterOptions, sourceSearch]);

  const filteredSGAs = useMemo(() => {
    if (!filterOptions?.sgas) return [];
    return filterOptions.sgas.filter(s => 
      s.label.toLowerCase().includes(sgaSearch.toLowerCase())
    );
  }, [filterOptions, sgaSearch]);

  const filteredSGMs = useMemo(() => {
    if (!filterOptions?.sgms) return [];
    return filterOptions.sgms.filter(s => 
      s.label.toLowerCase().includes(sgmSearch.toLowerCase())
    );
  }, [filterOptions, sgmSearch]);

  const filteredExperimentationTags = useMemo(() => {
    if (!filterOptions?.experimentationTags) return [];
    return filterOptions.experimentationTags.filter(tag => 
      tag.toLowerCase().includes(experimentationTagSearch.toLowerCase())
    );
  }, [filterOptions, experimentationTagSearch]);

  // Handlers
  const handleMultiSelectChange = (
    filterKey: 'channels' | 'sources' | 'sgas' | 'sgms' | 'experimentationTags',
    value: string,
    checked: boolean
  ) => {
    setLocalFilters(prev => {
      const current = prev[filterKey];
      let newSelected: string[];
      
      if (checked) {
        newSelected = [...current.selected, value];
      } else {
        newSelected = current.selected.filter(v => v !== value);
      }
      
      return {
        ...prev,
        [filterKey]: {
          selectAll: false,
          selected: newSelected,
        },
      };
    });
  };

  const handleSelectAll = (filterKey: 'channels' | 'sources' | 'sgas' | 'sgms' | 'experimentationTags') => {
    setLocalFilters(prev => {
      const current = prev[filterKey];
      // Toggle: if currently "All" is selected, uncheck it (set to false with empty selection)
      // If "All" is not selected, check it (set to true and clear selection)
      const newSelectAll = !current.selectAll;
      return {
        ...prev,
        [filterKey]: {
          selectAll: newSelectAll,
          selected: newSelectAll ? [] : current.selected, // Keep existing selection when unchecking "All"
        },
      };
    });
  };

  const handleApply = () => {
    onFiltersChange(localFilters);
    // If onApply is provided, call it to actually apply the filters (same as GlobalFilters button)
    if (onApply) {
      onApply();
    }
    onClose();
  };

  const handleReset = () => {
    setLocalFilters(DEFAULT_ADVANCED_FILTERS);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/30 transition-opacity"
        onClick={onClose}
      />
      
      {/* Slide-out panel */}
      <div className="absolute right-0 top-0 h-full w-96 bg-white dark:bg-gray-800 shadow-xl transform transition-transform overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b dark:border-gray-700 flex-shrink-0">
          <h2 className="text-lg font-semibold dark:text-white">Advanced Filters</h2>
          <button 
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-600 dark:text-gray-300"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {!filterOptions ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : (
            <>
              {/* Attribution Filters Section */}
              <div>
                <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                  🏷️ Attribution Filters
                </h3>
                
                {/* Channels */}
                <MultiSelectFilterControl
                  label="Channels"
                  options={filterOptions.channels.map(c => ({ value: c, label: c, isActive: true }))}
                  filter={localFilters.channels}
                  onSelectAll={() => handleSelectAll('channels')}
                  onChange={(value, checked) => handleMultiSelectChange('channels', value, checked)}
                />
                
                {/* Sources */}
                <MultiSelectFilterControl
                  label="Sources"
                  options={filteredSources.map(s => ({ value: s, label: s, isActive: true }))}
                  filter={localFilters.sources}
                  onSelectAll={() => handleSelectAll('sources')}
                  onChange={(value, checked) => handleMultiSelectChange('sources', value, checked)}
                  searchValue={sourceSearch}
                  onSearchChange={setSourceSearch}
                  searchable
                />
                
                {/* SGAs */}
                <MultiSelectFilterControl
                  label="SGAs (Lead Owner)"
                  options={filteredSGAs}
                  filter={localFilters.sgas}
                  onSelectAll={() => handleSelectAll('sgas')}
                  onChange={(value, checked) => handleMultiSelectChange('sgas', value, checked)}
                  searchValue={sgaSearch}
                  onSearchChange={setSgaSearch}
                  searchable
                />
                
                {/* SGMs */}
                <MultiSelectFilterControl
                  label="SGMs (Opportunity Owner)"
                  options={filteredSGMs}
                  filter={localFilters.sgms}
                  onSelectAll={() => handleSelectAll('sgms')}
                  onChange={(value, checked) => handleMultiSelectChange('sgms', value, checked)}
                  searchValue={sgmSearch}
                  onSearchChange={setSgmSearch}
                  searchable
                />
                
                {/* Experimentation Tags */}
                <MultiSelectFilterControl
                  label="Experimentation Tags"
                  options={filteredExperimentationTags.map(tag => ({ value: tag, label: tag, isActive: true }))}
                  filter={localFilters.experimentationTags}
                  onSelectAll={() => handleSelectAll('experimentationTags')}
                  onChange={(value, checked) => handleMultiSelectChange('experimentationTags', value, checked)}
                  searchValue={experimentationTagSearch}
                  onSearchChange={setExperimentationTagSearch}
                  searchable
                />
              </div>
            </>
          )}
        </div>
        
        {/* Footer */}
        <div className="px-4 py-3 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-900 flex justify-between items-center flex-shrink-0">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {countActiveAdvancedFilters(localFilters)} active filter(s)
          </span>
          <div className="flex gap-2">
            <button
              onClick={handleReset}
              className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
            >
              Reset All
            </button>
            <button
              onClick={handleApply}
              className="px-4 py-1.5 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded"
            >
              Apply Filters
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DateRangeFilterControl({ label, filter, onChange }: DateRangeFilterControlProps) {
  const handlePresetChange = (preset: DateRangeFilter['preset']) => {
    const now = new Date();
    const year = now.getFullYear();
    const quarter = Math.floor(now.getMonth() / 3);
    
    let startDate: string | null = null;
    let endDate: string | null = null;
    let enabled = preset !== 'any';
    
    if (preset === 'qtd') {
      const quarterStart = new Date(year, quarter * 3, 1);
      startDate = quarterStart.toISOString().split('T')[0];
      endDate = now.toISOString().split('T')[0];
    } else if (preset === 'ytd') {
      startDate = `${year}-01-01`;
      endDate = now.toISOString().split('T')[0];
    }
    
    onChange({ preset, startDate, endDate, enabled });
  };

  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">{label}</label>
      
      {/* Preset buttons */}
      <div className="flex gap-2 mb-2">
        {(['any', 'qtd', 'ytd', 'custom'] as const).map(preset => (
          <button
            key={preset}
            onClick={() => handlePresetChange(preset)}
            className={`px-3 py-1 text-xs rounded border ${
              filter.preset === preset
                ? 'bg-blue-100 dark:bg-blue-900 border-blue-500 dark:border-blue-600 text-blue-700 dark:text-blue-200'
                : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'
            }`}
          >
            {preset === 'any' ? 'Any' : preset.toUpperCase()}
          </button>
        ))}
      </div>
      
      {/* Custom date inputs */}
      {filter.preset === 'custom' && (
        <div className="flex gap-2">
          <input
            type="date"
            value={filter.startDate || ''}
            onChange={(e) => onChange({ 
              startDate: e.target.value, 
              enabled: !!e.target.value 
            })}
            className="flex-1 px-2 py-1 text-sm border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"
          />
          <input
            type="date"
            value={filter.endDate || ''}
            onChange={(e) => onChange({ 
              endDate: e.target.value,
              enabled: !!e.target.value 
            })}
            className="flex-1 px-2 py-1 text-sm border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"
          />
        </div>
      )}
    </div>
  );
}

function MultiSelectFilterControl({
  label,
  options,
  filter,
  onSelectAll,
  onChange,
  searchable,
  searchValue,
  onSearchChange,
}: MultiSelectFilterControlProps) {
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">{label}</label>
      
      <div className="border dark:border-gray-600 rounded max-h-48 overflow-y-auto bg-white dark:bg-gray-800">
        {/* Search input */}
        {searchable && onSearchChange && (
          <div className="sticky top-0 bg-white dark:bg-gray-800 p-2 border-b dark:border-gray-600">
            <input
              type="text"
              value={searchValue || ''}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={`Search ${label.toLowerCase()}...`}
              className="w-full px-2 py-1 text-sm border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            />
          </div>
        )}
        
        {/* Select All option */}
        <label className="flex items-center px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer border-b dark:border-gray-600">
          <input
            type="checkbox"
            checked={filter.selectAll}
            onChange={() => onSelectAll()}
            className="mr-2"
          />
          <span className="text-sm font-medium dark:text-gray-200">
            All ({options.length})
          </span>
        </label>
        
        {/* Individual options */}
        {options.map(option => (
          <label 
            key={option.value}
            className={`flex items-center px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700 ${
              filter.selectAll ? 'opacity-50' : 'cursor-pointer'
            }`}
          >
            <input
              type="checkbox"
              checked={filter.selectAll || filter.selected.includes(option.value)}
              disabled={filter.selectAll}
              onChange={(e) => onChange(option.value, e.target.checked)}
              className="mr-2"
            />
            <span className="text-sm flex-1 truncate dark:text-gray-200">{option.label}</span>
            {option.count !== undefined && (
              <span className="text-xs text-gray-400 dark:text-gray-500 ml-1">({option.count.toLocaleString()})</span>
            )}
          </label>
        ))}
      </div>
    </div>
  );
}

// Export button component to use in dashboard header
export function AdvancedFiltersButton({ onClick, activeCount }: AdvancedFiltersButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center px-3 py-2 text-sm font-medium rounded-md border ${
        activeCount > 0
          ? 'bg-blue-50 dark:bg-blue-900 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-200'
          : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
      }`}
    >
      <svg 
        className="w-4 h-4 mr-2" 
        fill="none" 
        stroke="currentColor" 
        viewBox="0 0 24 24"
      >
        <path 
          strokeLinecap="round" 
          strokeLinejoin="round" 
          strokeWidth={2} 
          d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" 
        />
      </svg>
      Advanced Filters
      {activeCount > 0 && (
        <span className="ml-2 inline-flex items-center justify-center px-2 py-0.5 text-xs font-bold leading-none text-white bg-blue-600 rounded-full">
          {activeCount}
        </span>
      )}
    </button>
  );
}
