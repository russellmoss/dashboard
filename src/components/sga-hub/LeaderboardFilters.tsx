// src/components/sga-hub/LeaderboardFilters.tsx

'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { ChevronDown, ChevronUp, Check, Filter } from 'lucide-react';
import { getQuarterInfo, getCurrentQuarter } from '@/lib/utils/sga-hub-helpers';

interface SGAOption {
  value: string;
  label: string;
  isActive: boolean;
}

interface LeaderboardFiltersProps {
  // Applied filters (from parent)
  selectedQuarter: string; // "YYYY-QN" format
  selectedChannels: string[];
  selectedSources: string[];
  selectedSGAs: string[];
  
  // Options
  channelOptions: string[];
  sourceOptions: string[];
  sgaOptions: SGAOption[];
  sgaOptionsLoading: boolean;
  
  // Callbacks
  onApply: (filters: {
    quarter: string;
    channels: string[];
    sources: string[];
    sgas: string[];
  }) => void;
  
  disabled?: boolean;
}

export function LeaderboardFilters({
  selectedQuarter: initialQuarter,
  selectedChannels: initialChannels,
  selectedSources: initialSources,
  selectedSGAs: initialSGAs,
  channelOptions,
  sourceOptions,
  sgaOptions,
  sgaOptionsLoading,
  onApply,
  disabled = false,
}: LeaderboardFiltersProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [sgaSearch, setSgaSearch] = useState('');
  const [sourceSearch, setSourceSearch] = useState('');
  
  // Local state for filter selections (not applied until Apply is clicked)
  const [localQuarter, setLocalQuarter] = useState<string>(initialQuarter);
  const [localChannels, setLocalChannels] = useState<string[]>(initialChannels);
  const [localSources, setLocalSources] = useState<string[]>(initialSources);
  const [localSGAs, setLocalSGAs] = useState<string[]>(initialSGAs);
  
  // Sync local state when props change (e.g., after applying filters)
  useEffect(() => {
    setLocalQuarter(initialQuarter);
    setLocalChannels(initialChannels);
    setLocalSources(initialSources);
    setLocalSGAs(initialSGAs);
  }, [initialQuarter, initialChannels, initialSources, initialSGAs]);

  // Filter options by search
  const filteredSgaOptions = useMemo(() => {
    if (!sgaSearch.trim()) return sgaOptions;
    const search = sgaSearch.toLowerCase();
    return sgaOptions.filter(opt => opt.label.toLowerCase().includes(search));
  }, [sgaOptions, sgaSearch]);

  const filteredSourceOptions = useMemo(() => {
    if (!sourceSearch.trim()) return sourceOptions;
    const search = sourceSearch.toLowerCase();
    return sourceOptions.filter(opt => opt.toLowerCase().includes(search));
  }, [sourceOptions, sourceSearch]);

  // Channel handlers
  const handleChannelToggle = (channel: string) => {
    if (disabled) return;
    if (localChannels.includes(channel)) {
      setLocalChannels(localChannels.filter(c => c !== channel));
    } else {
      setLocalChannels([...localChannels, channel]);
    }
  };

  const handleSelectAllChannels = () => {
    if (disabled) return;
    setLocalChannels([...channelOptions]);
  };

  const handleDeselectAllChannels = () => {
    if (disabled) return;
    setLocalChannels([]);
  };

  // Source handlers
  const handleSourceToggle = (source: string) => {
    if (disabled) return;
    if (localSources.includes(source)) {
      setLocalSources(localSources.filter(s => s !== source));
    } else {
      setLocalSources([...localSources, source]);
    }
  };

  const handleSelectAllSources = () => {
    if (disabled) return;
    setLocalSources([...sourceOptions]);
  };

  const handleDeselectAllSources = () => {
    if (disabled) return;
    setLocalSources([]);
  };

  // SGA handlers
  const handleSgaToggle = (sga: string) => {
    if (disabled) return;
    if (localSGAs.includes(sga)) {
      setLocalSGAs(localSGAs.filter(s => s !== sga));
    } else {
      setLocalSGAs([...localSGAs, sga]);
    }
  };

  const handleSelectAllSgas = () => {
    if (disabled || sgaOptionsLoading) return;
    setLocalSGAs(sgaOptions.map(s => s.value));
  };

  const handleDeselectAllSgas = () => {
    if (disabled) return;
    setLocalSGAs([]);
  };

  const handleSelectActiveSgas = () => {
    if (disabled || sgaOptionsLoading) return;
    const activeSgas = sgaOptions.filter(s => s.isActive).map(s => s.value);
    setLocalSGAs(activeSgas.length > 0 ? activeSgas : sgaOptions.map(s => s.value));
  };

  // Apply filters
  const handleApplyFilters = () => {
    if (disabled) return;
    // Ensure at least one channel is selected
    if (localChannels.length === 0) {
      alert('Please select at least one channel.');
      return;
    }
    onApply({
      quarter: localQuarter,
      channels: localChannels,
      sources: localSources.length > 0 ? localSources : sourceOptions, // Default to all if empty
      sgas: localSGAs.length > 0 ? localSGAs : sgaOptions.filter(s => s.isActive).map(s => s.value), // Default to active if empty
    });
  };

  // Reset all filters to defaults
  const handleResetFilters = () => {
    if (disabled) return;
    const currentQuarter = getCurrentQuarter();
    const defaultChannels = ['Outbound', 'Outbound + Marketing'];
    setLocalQuarter(currentQuarter);
    setLocalChannels(defaultChannels);
    setLocalSources([...sourceOptions]); // All sources
    setLocalSGAs(sgaOptions.filter(s => s.isActive).map(s => s.value)); // All active SGAs
  };

  // Summary counts for header (based on applied filters, not local state)
  const channelsSummary = initialChannels.length === channelOptions.length 
    ? 'All Channels' 
    : `${initialChannels.length} Channels`;
  
  const sourcesSummary = initialSources.length === sourceOptions.length 
    ? 'All Sources' 
    : `${initialSources.length} Sources`;
  
  const sgasSummary = sgaOptionsLoading 
    ? 'Loading...'
    : initialSGAs.length === sgaOptions.filter(s => s.isActive).length 
      ? 'All Active SGAs' 
      : `${initialSGAs.length} SGAs`;

  // Check if local state differs from applied filters
  const hasPendingChanges = 
    localQuarter !== initialQuarter ||
    localChannels.length !== initialChannels.length ||
    !localChannels.every(c => initialChannels.includes(c)) ||
    !initialChannels.every(c => localChannels.includes(c)) ||
    localSources.length !== initialSources.length ||
    !localSources.every(s => initialSources.includes(s)) ||
    !initialSources.every(s => localSources.includes(s)) ||
    localSGAs.length !== initialSGAs.length ||
    !localSGAs.every(s => initialSGAs.includes(s)) ||
    !initialSGAs.every(s => localSGAs.includes(s));

  const hasCustomFilters = 
    initialChannels.length !== 2 || // Default is 2 channels
    !initialChannels.includes('Outbound') ||
    !initialChannels.includes('Outbound + Marketing') ||
    initialSources.length !== sourceOptions.length ||
    initialSGAs.length !== sgaOptions.filter(s => s.isActive).length;

  // Generate quarter options (last 8 quarters)
  const quarterOptions: string[] = [];
  const currentQuarterInfo = getQuarterInfo(getCurrentQuarter());
  let year = currentQuarterInfo.year;
  let quarterNum: 1 | 2 | 3 | 4 = currentQuarterInfo.quarterNumber;
  
  for (let i = 0; i < 8; i++) {
    const quarter = `${year}-Q${quarterNum}`;
    quarterOptions.push(quarter);
    if (quarterNum === 1) {
      quarterNum = 4;
      year--;
    } else {
      quarterNum = (quarterNum - 1) as 1 | 2 | 3 | 4;
    }
  }

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-800 mb-6">
      {/* Collapsed Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        disabled={disabled}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
      >
        <div className="flex items-center gap-3">
          <Filter className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          <span className="text-base font-medium text-gray-700 dark:text-gray-300">
            Filters
          </span>
          <div className="flex items-center gap-2">
            <span className="text-sm bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full">
              {getQuarterInfo(localQuarter).label}
            </span>
            <span className="text-sm bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-full">
              {channelsSummary}
            </span>
            <span className="text-sm bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300 px-2 py-0.5 rounded-full">
              {sourcesSummary}
            </span>
            <span className="text-sm bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300 px-2 py-0.5 rounded-full">
              {sgasSummary}
            </span>
          </div>
          {hasCustomFilters && (
            <span className="text-sm text-orange-600 dark:text-orange-400">
              (Modified)
            </span>
          )}
          {hasPendingChanges && (
            <span className="text-sm text-blue-600 dark:text-blue-400">
              (Pending)
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          )}
        </div>
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="border-t border-gray-200 dark:border-gray-700 p-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Quarter Selector */}
            <div>
              <label className="text-base font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                Quarter
              </label>
              <select
                value={localQuarter}
                onChange={(e) => setLocalQuarter(e.target.value)}
                disabled={disabled}
                className="w-full px-3 py-2 text-base border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-50"
              >
                {quarterOptions.map(q => {
                  const info = getQuarterInfo(q);
                  return (
                    <option key={q} value={q}>
                      {info.label}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Channel Multi-Select */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-base font-medium text-gray-700 dark:text-gray-300">
                  Channels
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={handleSelectAllChannels}
                    disabled={disabled}
                    className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
                  >
                    Select All
                  </button>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <button
                    onClick={handleDeselectAllChannels}
                    disabled={disabled}
                    className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
                  >
                    Deselect All
                  </button>
                </div>
              </div>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {channelOptions.map(channel => {
                  const isSelected = localChannels.includes(channel);
                  return (
                    <label
                      key={channel}
                      className={`
                        flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors
                        ${isSelected 
                          ? 'bg-purple-50 dark:bg-purple-900/30' 
                          : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                        }
                        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
                      `}
                    >
                      <div className={`
                        w-5 h-5 rounded border-2 flex items-center justify-center transition-colors
                        ${isSelected 
                          ? 'bg-purple-600 border-purple-600' 
                          : 'border-gray-300 dark:border-gray-600'
                        }
                      `}>
                        {isSelected && <Check className="w-4 h-4 text-white" />}
                      </div>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleChannelToggle(channel)}
                        disabled={disabled}
                        className="sr-only"
                      />
                      <span className={`text-base ${isSelected ? 'text-purple-700 dark:text-purple-300 font-medium' : 'text-gray-700 dark:text-gray-300'}`}>
                        {channel}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Source Multi-Select */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-base font-medium text-gray-700 dark:text-gray-300">
                  Sources
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={handleSelectAllSources}
                    disabled={disabled}
                    className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
                  >
                    Select All
                  </button>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <button
                    onClick={handleDeselectAllSources}
                    disabled={disabled}
                    className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
                  >
                    Deselect All
                  </button>
                </div>
              </div>
              
              {/* Search */}
              <input
                type="text"
                placeholder="Search sources..."
                value={sourceSearch}
                onChange={(e) => setSourceSearch(e.target.value)}
                disabled={disabled}
                className="w-full px-3 py-2 text-base border border-gray-300 dark:border-gray-600 rounded-lg mb-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 disabled:opacity-50"
              />
              
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {filteredSourceOptions.length === 0 ? (
                  <div className="flex items-center justify-center py-4 text-gray-400 text-sm">
                    {sourceSearch ? 'No sources match your search' : 'No sources found'}
                  </div>
                ) : (
                  filteredSourceOptions.map(source => {
                    const isSelected = localSources.includes(source);
                    return (
                      <label
                        key={source}
                        className={`
                          flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors
                          ${isSelected 
                            ? 'bg-green-50 dark:bg-green-900/30' 
                            : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                          }
                          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
                        `}
                      >
                        <div className={`
                          w-4 h-4 rounded border-2 flex items-center justify-center transition-colors
                          ${isSelected 
                            ? 'bg-green-600 border-green-600' 
                            : 'border-gray-300 dark:border-gray-600'
                          }
                        `}>
                          {isSelected && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleSourceToggle(source)}
                          disabled={disabled}
                          className="sr-only"
                        />
                        <span className={`text-base ${isSelected ? 'text-green-700 dark:text-green-300 font-medium' : 'text-gray-700 dark:text-gray-300'}`}>
                          {source}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>

            {/* SGA Multi-Select */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-base font-medium text-gray-700 dark:text-gray-300">
                  SGAs
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={handleSelectActiveSgas}
                    disabled={disabled || sgaOptionsLoading}
                    className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
                  >
                    Active Only
                  </button>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <button
                    onClick={handleSelectAllSgas}
                    disabled={disabled || sgaOptionsLoading}
                    className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
                  >
                    All SGAs
                  </button>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <button
                    onClick={handleDeselectAllSgas}
                    disabled={disabled || sgaOptionsLoading}
                    className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
                  >
                    Deselect All
                  </button>
                </div>
              </div>
              
              {/* Search */}
              <input
                type="text"
                placeholder="Search SGAs..."
                value={sgaSearch}
                onChange={(e) => setSgaSearch(e.target.value)}
                disabled={disabled || sgaOptionsLoading}
                className="w-full px-3 py-2 text-base border border-gray-300 dark:border-gray-600 rounded-lg mb-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 disabled:opacity-50"
              />
              
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {sgaOptionsLoading ? (
                  <div className="flex items-center justify-center py-4 text-gray-400">
                    Loading SGAs...
                  </div>
                ) : filteredSgaOptions.length === 0 ? (
                  <div className="flex items-center justify-center py-4 text-gray-400 text-sm">
                    {sgaSearch ? 'No SGAs match your search' : 'No SGAs found'}
                  </div>
                ) : (
                  filteredSgaOptions.map(sga => {
                    const isSelected = localSGAs.includes(sga.value);
                    return (
                      <label
                        key={sga.value}
                        className={`
                          flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors
                          ${isSelected 
                            ? 'bg-orange-50 dark:bg-orange-900/30' 
                            : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                          }
                          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
                        `}
                      >
                        <div className={`
                          w-4 h-4 rounded border-2 flex items-center justify-center transition-colors
                          ${isSelected 
                            ? 'bg-orange-600 border-orange-600' 
                            : 'border-gray-300 dark:border-gray-600'
                          }
                        `}>
                          {isSelected && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleSgaToggle(sga.value)}
                          disabled={disabled}
                          className="sr-only"
                        />
                        <span className={`text-base ${isSelected ? 'text-orange-700 dark:text-orange-300 font-medium' : 'text-gray-700 dark:text-gray-300'}`}>
                          {sga.label}
                        </span>
                        {!sga.isActive && (
                          <span className="text-sm text-gray-400 dark:text-gray-500">
                            (Inactive)
                          </span>
                        )}
                      </label>
                    );
                  })
                )}
              </div>
            </div>
          </div>
          
          {/* Footer with Apply and Reset buttons */}
          <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-3 bg-gray-50 dark:bg-gray-900 flex justify-between items-center mt-4">
            <span className="text-base text-gray-500 dark:text-gray-400">
              {hasPendingChanges ? 'Changes pending' : 'Filters applied'}
            </span>
            <div className="flex gap-2">
              <button
                onClick={handleResetFilters}
                disabled={disabled}
                className="px-4 py-2 text-base text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Reset
              </button>
              <button
                onClick={handleApplyFilters}
                disabled={disabled || !hasPendingChanges}
                className="px-5 py-2 text-base text-white bg-blue-600 hover:bg-blue-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Apply Filters
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
