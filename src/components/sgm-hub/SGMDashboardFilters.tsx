'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { ChevronDown, ChevronUp, Check, Filter } from 'lucide-react';

interface SGMOption {
  value: string;
  label: string;
  isActive: boolean;
}

type DatePreset = 'qtd' | 'ytd' | 'q1' | 'q2' | 'q3' | 'q4' | 'custom';

interface SGMDashboardFiltersProps {
  selectedDateRange: { startDate: string; endDate: string };
  selectedChannels: string[];
  selectedSources: string[];
  selectedSGMs: string[];
  channelOptions: string[];
  sourceOptions: string[];
  sgmOptions: SGMOption[];
  sgmOptionsLoading: boolean;
  onApply: (filters: {
    dateRange: { startDate: string; endDate: string };
    channels: string[];
    sources: string[];
    sgms: string[];
  }) => void;
  disabled?: boolean;
}

function getQuarterDates(quarter: 1 | 2 | 3 | 4, year: number) {
  const startMonth = (quarter - 1) * 3;
  const startDate = new Date(year, startMonth, 1);
  const endDate = new Date(year, startMonth + 3, 0); // Last day of quarter
  return {
    startDate: startDate.toISOString().split('T')[0],
    endDate: endDate.toISOString().split('T')[0],
  };
}

function getQTDDates(year: number) {
  const now = new Date();
  const quarterMonth = Math.floor(now.getMonth() / 3) * 3;
  const startDate = new Date(year === now.getFullYear() ? year : year, quarterMonth, 1);
  return {
    startDate: startDate.toISOString().split('T')[0],
    endDate: now.toISOString().split('T')[0],
  };
}

function getYTDDates(year: number) {
  const now = new Date();
  return {
    startDate: `${year}-01-01`,
    endDate: year === now.getFullYear() ? now.toISOString().split('T')[0] : `${year}-12-31`,
  };
}

function detectPreset(dateRange: { startDate: string; endDate: string }): { preset: DatePreset; year: number } {
  const now = new Date();
  const currentYear = now.getFullYear();
  const startYear = parseInt(dateRange.startDate.substring(0, 4));

  // Check QTD
  const qtd = getQTDDates(currentYear);
  if (dateRange.startDate === qtd.startDate && dateRange.endDate === qtd.endDate) {
    return { preset: 'qtd', year: currentYear };
  }

  // Check YTD
  const ytd = getYTDDates(currentYear);
  if (dateRange.startDate === ytd.startDate && dateRange.endDate === ytd.endDate) {
    return { preset: 'ytd', year: currentYear };
  }

  // Check Q1-Q4
  for (const q of [1, 2, 3, 4] as const) {
    const qDates = getQuarterDates(q, startYear);
    if (dateRange.startDate === qDates.startDate && dateRange.endDate === qDates.endDate) {
      return { preset: `q${q}` as DatePreset, year: startYear };
    }
  }

  return { preset: 'custom', year: startYear };
}

const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: 'qtd', label: 'Quarter to Date' },
  { value: 'ytd', label: 'Year to Date' },
  { value: 'q1', label: 'Q1' },
  { value: 'q2', label: 'Q2' },
  { value: 'q3', label: 'Q3' },
  { value: 'q4', label: 'Q4' },
  { value: 'custom', label: 'Custom Range' },
];

export function SGMDashboardFilters({
  selectedDateRange,
  selectedChannels,
  selectedSources,
  selectedSGMs,
  channelOptions,
  sourceOptions,
  sgmOptions,
  sgmOptionsLoading,
  onApply,
  disabled = false,
}: SGMDashboardFiltersProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [sgmSearch, setSgmSearch] = useState('');
  const [sourceSearch, setSourceSearch] = useState('');

  // Detect initial preset from applied date range
  const initialDetected = detectPreset(selectedDateRange);

  // Local state
  const [localPreset, setLocalPreset] = useState<DatePreset>(initialDetected.preset);
  const [localYear, setLocalYear] = useState(initialDetected.year);
  const [localDateRange, setLocalDateRange] = useState(selectedDateRange);
  const [localChannels, setLocalChannels] = useState(selectedChannels);
  const [localSources, setLocalSources] = useState(selectedSources);
  const [localSGMs, setLocalSGMs] = useState(selectedSGMs);

  // Sync local state when props change
  useEffect(() => {
    const detected = detectPreset(selectedDateRange);
    setLocalPreset(detected.preset);
    setLocalYear(detected.year);
    setLocalDateRange(selectedDateRange);
    setLocalChannels(selectedChannels);
    setLocalSources(selectedSources);
    setLocalSGMs(selectedSGMs);
  }, [selectedDateRange, selectedChannels, selectedSources, selectedSGMs]);

  // Update date range when preset or year changes
  const handlePresetChange = (preset: DatePreset) => {
    setLocalPreset(preset);
    if (preset === 'custom') return;
    const now = new Date();
    const year = preset === 'qtd' || preset === 'ytd' ? now.getFullYear() : localYear;
    if (preset === 'qtd') {
      setLocalDateRange(getQTDDates(year));
    } else if (preset === 'ytd') {
      setLocalDateRange(getYTDDates(year));
    } else {
      const q = parseInt(preset.replace('q', '')) as 1 | 2 | 3 | 4;
      setLocalDateRange(getQuarterDates(q, year));
    }
  };

  const handleYearChange = (year: number) => {
    setLocalYear(year);
    if (localPreset === 'qtd') {
      setLocalDateRange(getQTDDates(year));
    } else if (localPreset === 'ytd') {
      setLocalDateRange(getYTDDates(year));
    } else if (localPreset !== 'custom') {
      const q = parseInt(localPreset.replace('q', '')) as 1 | 2 | 3 | 4;
      setLocalDateRange(getQuarterDates(q, year));
    }
  };

  // Year options
  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 4 }, (_, i) => currentYear - i);

  // Search filtering
  const filteredSgmOptions = useMemo(() => {
    if (!sgmSearch.trim()) return sgmOptions;
    const search = sgmSearch.toLowerCase();
    return sgmOptions.filter(opt => opt.label.toLowerCase().includes(search));
  }, [sgmOptions, sgmSearch]);

  const filteredSourceOptions = useMemo(() => {
    if (!sourceSearch.trim()) return sourceOptions;
    const search = sourceSearch.toLowerCase();
    return sourceOptions.filter(opt => opt.toLowerCase().includes(search));
  }, [sourceOptions, sourceSearch]);

  // Channel handlers
  const handleChannelToggle = (channel: string) => {
    if (disabled) return;
    setLocalChannels(prev =>
      prev.includes(channel) ? prev.filter(c => c !== channel) : [...prev, channel]
    );
  };

  // Source handlers
  const handleSourceToggle = (source: string) => {
    if (disabled) return;
    setLocalSources(prev =>
      prev.includes(source) ? prev.filter(s => s !== source) : [...prev, source]
    );
  };

  // SGM handlers
  const handleSgmToggle = (sgm: string) => {
    if (disabled) return;
    setLocalSGMs(prev =>
      prev.includes(sgm) ? prev.filter(s => s !== sgm) : [...prev, sgm]
    );
  };

  // Apply
  const handleApplyFilters = () => {
    if (disabled) return;
    if (localChannels.length === 0) {
      alert('Please select at least one channel.');
      return;
    }
    onApply({
      dateRange: localDateRange,
      channels: localChannels,
      sources: localSources.length > 0 ? localSources : sourceOptions,
      sgms: localSGMs.length > 0 ? localSGMs : sgmOptions.filter(s => s.isActive).map(s => s.value),
    });
  };

  // Reset
  const handleResetFilters = () => {
    if (disabled) return;
    setLocalPreset('qtd');
    setLocalYear(currentYear);
    setLocalDateRange(getQTDDates(currentYear));
    setLocalChannels([...channelOptions]);
    setLocalSources([...sourceOptions]);
    setLocalSGMs(sgmOptions.filter(s => s.isActive).map(s => s.value));
  };

  // Pending changes detection
  const hasPendingChanges =
    localDateRange.startDate !== selectedDateRange.startDate ||
    localDateRange.endDate !== selectedDateRange.endDate ||
    localChannels.length !== selectedChannels.length ||
    !localChannels.every(c => selectedChannels.includes(c)) ||
    localSources.length !== selectedSources.length ||
    !localSources.every(s => selectedSources.includes(s)) ||
    localSGMs.length !== selectedSGMs.length ||
    !localSGMs.every(s => selectedSGMs.includes(s));

  // Summary badges
  const presetLabel = DATE_PRESETS.find(p => p.value === localPreset)?.label || 'Custom';
  const dateSummary = localPreset === 'custom'
    ? `${localDateRange.startDate} — ${localDateRange.endDate}`
    : localPreset === 'qtd' || localPreset === 'ytd'
      ? presetLabel
      : `${presetLabel} ${localYear}`;

  const channelsSummary = selectedChannels.length === channelOptions.length
    ? 'All Channels'
    : `${selectedChannels.length} Channels`;

  const sourcesSummary = selectedSources.length === sourceOptions.length
    ? 'All Sources'
    : `${selectedSources.length} Sources`;

  const sgmsSummary = sgmOptionsLoading
    ? 'Loading...'
    : selectedSGMs.length === sgmOptions.filter(s => s.isActive).length
      ? 'All Active SGMs'
      : `${selectedSGMs.length} SGMs`;

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
              {dateSummary}
            </span>
            <span className="text-sm bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-full">
              {channelsSummary}
            </span>
            <span className="text-sm bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300 px-2 py-0.5 rounded-full">
              {sourcesSummary}
            </span>
            <span className="text-sm bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300 px-2 py-0.5 rounded-full">
              {sgmsSummary}
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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Date Range */}
            <div>
              <label className="text-base font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                Date Range
              </label>
              <div className="flex gap-2 mb-2">
                <select
                  value={localPreset}
                  onChange={(e) => handlePresetChange(e.target.value as DatePreset)}
                  disabled={disabled}
                  className="flex-1 px-3 py-2 text-base border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-50"
                >
                  {DATE_PRESETS.map(p => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
                {localPreset !== 'custom' && localPreset !== 'qtd' && localPreset !== 'ytd' && (
                  <select
                    value={localYear}
                    onChange={(e) => handleYearChange(parseInt(e.target.value))}
                    disabled={disabled}
                    className="w-24 px-3 py-2 text-base border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-50"
                  >
                    {yearOptions.map(y => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                )}
              </div>
              {localPreset === 'custom' && (
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={localDateRange.startDate}
                    onChange={(e) => setLocalDateRange(prev => ({ ...prev, startDate: e.target.value }))}
                    disabled={disabled}
                    className="flex-1 px-3 py-2 text-base border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-50"
                  />
                  <span className="self-center text-gray-500">to</span>
                  <input
                    type="date"
                    value={localDateRange.endDate}
                    onChange={(e) => setLocalDateRange(prev => ({ ...prev, endDate: e.target.value }))}
                    disabled={disabled}
                    className="flex-1 px-3 py-2 text-base border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-50"
                  />
                </div>
              )}
              {localPreset !== 'custom' && (
                <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  {localDateRange.startDate} to {localDateRange.endDate}
                </div>
              )}
            </div>

            {/* Channel Multi-Select */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-base font-medium text-gray-700 dark:text-gray-300">
                  Channels
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() => { if (!disabled) setLocalChannels([...channelOptions]); }}
                    disabled={disabled}
                    className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
                  >
                    Select All
                  </button>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <button
                    onClick={() => { if (!disabled) setLocalChannels([]); }}
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
                    onClick={() => { if (!disabled) setLocalSources([...sourceOptions]); }}
                    disabled={disabled}
                    className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
                  >
                    Select All
                  </button>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <button
                    onClick={() => { if (!disabled) setLocalSources([]); }}
                    disabled={disabled}
                    className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
                  >
                    Deselect All
                  </button>
                </div>
              </div>
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

            {/* SGM Multi-Select */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-base font-medium text-gray-700 dark:text-gray-300">
                  SGMs
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() => { if (!disabled && !sgmOptionsLoading) setLocalSGMs(sgmOptions.filter(s => s.isActive).map(s => s.value)); }}
                    disabled={disabled || sgmOptionsLoading}
                    className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
                  >
                    Active Only
                  </button>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <button
                    onClick={() => { if (!disabled && !sgmOptionsLoading) setLocalSGMs(sgmOptions.map(s => s.value)); }}
                    disabled={disabled || sgmOptionsLoading}
                    className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
                  >
                    All SGMs
                  </button>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <button
                    onClick={() => { if (!disabled) setLocalSGMs([]); }}
                    disabled={disabled || sgmOptionsLoading}
                    className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
                  >
                    Deselect All
                  </button>
                </div>
              </div>
              <input
                type="text"
                placeholder="Search SGMs..."
                value={sgmSearch}
                onChange={(e) => setSgmSearch(e.target.value)}
                disabled={disabled || sgmOptionsLoading}
                className="w-full px-3 py-2 text-base border border-gray-300 dark:border-gray-600 rounded-lg mb-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 disabled:opacity-50"
              />
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {sgmOptionsLoading ? (
                  <div className="flex items-center justify-center py-4 text-gray-400">
                    Loading SGMs...
                  </div>
                ) : filteredSgmOptions.length === 0 ? (
                  <div className="flex items-center justify-center py-4 text-gray-400 text-sm">
                    {sgmSearch ? 'No SGMs match your search' : 'No SGMs found'}
                  </div>
                ) : (
                  filteredSgmOptions.map(sgm => {
                    const isSelected = localSGMs.includes(sgm.value);
                    return (
                      <label
                        key={sgm.value}
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
                          onChange={() => handleSgmToggle(sgm.value)}
                          disabled={disabled}
                          className="sr-only"
                        />
                        <span className={`text-base ${isSelected ? 'text-orange-700 dark:text-orange-300 font-medium' : 'text-gray-700 dark:text-gray-300'}`}>
                          {sgm.label}
                        </span>
                        {!sgm.isActive && (
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

          {/* Footer */}
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
