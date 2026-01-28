// src/components/sga-hub/AdminQuarterlyFilters.tsx

'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { ChevronDown, ChevronUp, Check, Filter } from 'lucide-react';
import { getQuarterInfo, getCurrentQuarter } from '@/lib/utils/sga-hub-helpers';

interface SGAOption {
  value: string;
  label: string;
  isActive: boolean;
}

interface AdminQuarterlyFiltersProps {
  selectedYear: number;
  selectedQuarter: number;
  selectedSGAs: string[];
  selectedChannels: string[];
  selectedSources: string[];
  selectedPacingStatuses: string[]; // NEW: Pacing Status filter
  sgaOptions: SGAOption[];
  channelOptions: string[];
  sourceOptions: string[];
  sgaOptionsLoading: boolean;
  onApply: (filters: {
    year: number;
    quarter: number;
    sgas: string[];
    channels: string[];
    sources: string[];
    pacingStatuses: string[]; // NEW
  }) => void;
  disabled?: boolean;
}

export function AdminQuarterlyFilters({
  selectedYear: initialYear,
  selectedQuarter: initialQuarter,
  selectedSGAs: initialSGAs,
  selectedChannels: initialChannels,
  selectedSources: initialSources,
  selectedPacingStatuses: initialPacingStatuses = ['ahead', 'on-track', 'behind', 'no-goal'], // Default: all
  sgaOptions,
  channelOptions,
  sourceOptions,
  sgaOptionsLoading,
  onApply,
  disabled = false,
}: AdminQuarterlyFiltersProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [sgaSearch, setSgaSearch] = useState('');
  const [sourceSearch, setSourceSearch] = useState('');

  const [localYear, setLocalYear] = useState<number>(initialYear);
  const [localQuarter, setLocalQuarter] = useState<number>(initialQuarter);
  const [localSGAs, setLocalSGAs] = useState<string[]>(initialSGAs);
  const [localChannels, setLocalChannels] = useState<string[]>(initialChannels);
  const [localSources, setLocalSources] = useState<string[]>(initialSources);
  const [localPacingStatuses, setLocalPacingStatuses] = useState<string[]>(initialPacingStatuses || ['ahead', 'on-track', 'behind', 'no-goal']); // Default: all selected

  // Sync local state with props
  useEffect(() => {
    setLocalYear(initialYear);
    setLocalQuarter(initialQuarter);
    setLocalSGAs(initialSGAs);
    setLocalChannels(initialChannels);
    setLocalSources(initialSources);
    setLocalPacingStatuses(initialPacingStatuses);
  }, [initialYear, initialQuarter, initialSGAs, initialChannels, initialSources, initialPacingStatuses]);

  // Generate year options (current year ± 2 years)
  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

  // Generate quarter options
  const quarterOptions = [1, 2, 3, 4];

  // Filter SGA options by search
  const filteredSgaOptions = useMemo(() => {
    if (!sgaSearch.trim()) return sgaOptions;
    const searchLower = sgaSearch.toLowerCase();
    return sgaOptions.filter(sga =>
      sga.label.toLowerCase().includes(searchLower)
    );
  }, [sgaOptions, sgaSearch]);

  // Filter source options by search
  const filteredSourceOptions = useMemo(() => {
    if (!sourceSearch.trim()) return sourceOptions;
    const searchLower = sourceSearch.toLowerCase();
    return sourceOptions.filter(source =>
      source.toLowerCase().includes(searchLower)
    );
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
    const activeSGAs = sgaOptions.filter(s => s.isActive).map(s => s.value);
    setLocalSGAs(activeSGAs.length > 0 ? activeSGAs : sgaOptions.map(s => s.value));
  };

  // Pacing Status handlers
  const handlePacingStatusToggle = (status: string) => {
    if (disabled) return;
    if (localPacingStatuses.includes(status)) {
      setLocalPacingStatuses(localPacingStatuses.filter(s => s !== status));
    } else {
      setLocalPacingStatuses([...localPacingStatuses, status]);
    }
  };

  const handleSelectAllPacingStatuses = () => {
    if (disabled) return;
    setLocalPacingStatuses(['ahead', 'on-track', 'behind', 'no-goal']);
  };

  const handleDeselectAllPacingStatuses = () => {
    if (disabled) return;
    setLocalPacingStatuses([]);
  };

  const handleApplyFilters = () => {
    if (disabled) return;
    // Ensure at least one channel is selected
    if (localChannels.length === 0) {
      alert('Please select at least one channel.');
      return;
    }
    onApply({
      year: localYear,
      quarter: localQuarter,
      sgas: localSGAs.length > 0 ? localSGAs : sgaOptions.filter(s => s.isActive).map(s => s.value),
      channels: localChannels,
      sources: localSources.length > 0 ? localSources : sourceOptions,
      pacingStatuses: localPacingStatuses.length > 0 ? localPacingStatuses : ['ahead', 'on-track', 'behind', 'no-goal'],
    });
  };

  const handleResetFilters = () => {
    if (disabled) return;
    const currentQuarterInfo = getQuarterInfo(getCurrentQuarter());
    setLocalYear(currentQuarterInfo.year);
    setLocalQuarter(currentQuarterInfo.quarterNumber);
    setLocalSGAs(sgaOptions.filter(s => s.isActive).map(s => s.value));
    setLocalChannels(['Outbound', 'Outbound + Marketing', 'Re-Engagement']);
    setLocalSources([...sourceOptions]);
    setLocalPacingStatuses(['ahead', 'on-track', 'behind', 'no-goal']); // Reset to all selected
  };

  const hasPendingChanges = 
    localYear !== initialYear ||
    localQuarter !== initialQuarter ||
    JSON.stringify([...localSGAs].sort()) !== JSON.stringify([...initialSGAs].sort()) ||
    JSON.stringify([...localChannels].sort()) !== JSON.stringify([...initialChannels].sort()) ||
    JSON.stringify([...localSources].sort()) !== JSON.stringify([...initialSources].sort()) ||
    JSON.stringify([...localPacingStatuses].sort()) !== JSON.stringify([...initialPacingStatuses].sort());

  const sgasSummary = sgaOptionsLoading 
    ? 'Loading...' 
    : localSGAs.length === sgaOptions.filter(s => s.isActive).length 
      ? 'All Active SGAs' 
      : `${localSGAs.length} SGAs`;

  const channelsSummary = localChannels.length === channelOptions.length 
    ? 'All Channels' 
    : `${localChannels.length} Channels`;

  const sourcesSummary = localSources.length === sourceOptions.length 
    ? 'All Sources' 
    : `${localSources.length} Sources`;

  const pacingStatusSummary = localPacingStatuses.length === 4
    ? 'All Statuses'
    : `${localPacingStatuses.length} Statuses`;

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
              {localYear}-Q{localQuarter}
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
            <span className="text-sm bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded-full">
              {pacingStatusSummary}
            </span>
          </div>
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Year Selector */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Year
              </label>
              <select
                value={localYear}
                onChange={(e) => setLocalYear(parseInt(e.target.value, 10))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              >
                {yearOptions.map(year => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </div>

            {/* Quarter Selector */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Quarter
              </label>
              <select
                value={localQuarter}
                onChange={(e) => setLocalQuarter(parseInt(e.target.value, 10))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              >
                {quarterOptions.map(q => (
                  <option key={q} value={q}>Q{q}</option>
                ))}
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

            {/* Pacing Status Multi-Select - NEW */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-base font-medium text-gray-700 dark:text-gray-300">
                  Pacing Status
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={handleSelectAllPacingStatuses}
                    disabled={disabled}
                    className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
                  >
                    Select All
                  </button>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <button
                    onClick={handleDeselectAllPacingStatuses}
                    disabled={disabled}
                    className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
                  >
                    Deselect All
                  </button>
                </div>
              </div>
              <div className="space-y-1">
                {['ahead', 'on-track', 'behind', 'no-goal'].map(status => {
                  const isSelected = localPacingStatuses.includes(status);
                  const statusLabels: Record<string, string> = {
                    'ahead': 'Ahead',
                    'on-track': 'On-Track',
                    'behind': 'Behind',
                    'no-goal': 'No Goal',
                  };
                  return (
                    <label
                      key={status}
                      className={`
                        flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors
                        ${isSelected 
                          ? 'bg-indigo-50 dark:bg-indigo-900/30' 
                          : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                        }
                        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
                      `}
                    >
                      <div className={`
                        w-4 h-4 rounded border-2 flex items-center justify-center transition-colors
                        ${isSelected 
                          ? 'bg-indigo-600 border-indigo-600' 
                          : 'border-gray-300 dark:border-gray-600'
                        }
                      `}>
                        {isSelected && <Check className="w-3 h-3 text-white" />}
                      </div>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handlePacingStatusToggle(status)}
                        disabled={disabled}
                        className="sr-only"
                      />
                      <span className={`text-base ${isSelected ? 'text-indigo-700 dark:text-indigo-300 font-medium' : 'text-gray-700 dark:text-gray-300'}`}>
                        {statusLabels[status]}
                      </span>
                    </label>
                  );
                })}
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
