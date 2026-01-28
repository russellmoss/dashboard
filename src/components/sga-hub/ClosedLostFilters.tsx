// src/components/sga-hub/ClosedLostFilters.tsx

'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { ChevronDown, ChevronUp, Check, Filter } from 'lucide-react';
import { ClosedLostRecord } from '@/types/sga-hub';

interface ClosedLostFiltersProps {
  records: ClosedLostRecord[];
  selectedSGAs: string[];
  selectedTimeBuckets: string[];
  selectedReasons: string[];
  onApply: (filters: {
    sgas: string[];
    timeBuckets: string[];
    reasons: string[];
  }) => void;
  disabled?: boolean;
}

export function ClosedLostFilters({
  records,
  selectedSGAs: initialSGAs,
  selectedTimeBuckets: initialTimeBuckets,
  selectedReasons: initialReasons,
  onApply,
  disabled = false,
}: ClosedLostFiltersProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [sgaSearch, setSgaSearch] = useState('');
  const [reasonSearch, setReasonSearch] = useState('');

  // Extract unique values from records
  const availableSGAs = useMemo(() => {
    const sgas = new Set<string>();
    records.forEach(record => {
      if (record.sgaName) {
        sgas.add(record.sgaName);
      }
    });
    return Array.from(sgas).sort();
  }, [records]);

  const availableTimeBuckets = useMemo(() => {
    const buckets = new Set<string>();
    records.forEach(record => {
      if (record.timeSinceClosedLostBucket) {
        buckets.add(record.timeSinceClosedLostBucket);
      }
    });
    return Array.from(buckets).sort();
  }, [records]);

  const availableReasons = useMemo(() => {
    const reasons = new Set<string>();
    records.forEach(record => {
      if (record.closedLostReason) {
        reasons.add(record.closedLostReason);
      }
    });
    return Array.from(reasons).sort();
  }, [records]);

  // Initialize local state with all values selected by default
  const [localSGAs, setLocalSGAs] = useState<string[]>(() => 
    initialSGAs.length > 0 ? initialSGAs : availableSGAs
  );
  const [localTimeBuckets, setLocalTimeBuckets] = useState<string[]>(() => 
    initialTimeBuckets.length > 0 ? initialTimeBuckets : availableTimeBuckets
  );
  const [localReasons, setLocalReasons] = useState<string[]>(() => 
    initialReasons.length > 0 ? initialReasons : availableReasons
  );

  // Sync local state when records change (to update available options)
  useEffect(() => {
    if (availableSGAs.length > 0 && localSGAs.length === 0) {
      setLocalSGAs(availableSGAs);
    }
    if (availableTimeBuckets.length > 0 && localTimeBuckets.length === 0) {
      setLocalTimeBuckets(availableTimeBuckets);
    }
    if (availableReasons.length > 0 && localReasons.length === 0) {
      setLocalReasons(availableReasons);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableSGAs, availableTimeBuckets, availableReasons]);

  // Sync local state with props
  useEffect(() => {
    if (initialSGAs.length > 0) setLocalSGAs(initialSGAs);
    if (initialTimeBuckets.length > 0) setLocalTimeBuckets(initialTimeBuckets);
    if (initialReasons.length > 0) setLocalReasons(initialReasons);
  }, [initialSGAs, initialTimeBuckets, initialReasons]);

  // Filter SGA options by search
  const filteredSgaOptions = useMemo(() => {
    if (!sgaSearch.trim()) return availableSGAs;
    const searchLower = sgaSearch.toLowerCase();
    return availableSGAs.filter(sga =>
      sga.toLowerCase().includes(searchLower)
    );
  }, [availableSGAs, sgaSearch]);

  // Filter reason options by search
  const filteredReasonOptions = useMemo(() => {
    if (!reasonSearch.trim()) return availableReasons;
    const searchLower = reasonSearch.toLowerCase();
    return availableReasons.filter(reason =>
      reason.toLowerCase().includes(searchLower)
    );
  }, [availableReasons, reasonSearch]);

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
    if (disabled) return;
    setLocalSGAs([...availableSGAs]);
  };

  const handleDeselectAllSgas = () => {
    if (disabled) return;
    setLocalSGAs([]);
  };

  // Time Bucket handlers
  const handleTimeBucketToggle = (bucket: string) => {
    if (disabled) return;
    if (localTimeBuckets.includes(bucket)) {
      setLocalTimeBuckets(localTimeBuckets.filter(b => b !== bucket));
    } else {
      setLocalTimeBuckets([...localTimeBuckets, bucket]);
    }
  };

  const handleSelectAllTimeBuckets = () => {
    if (disabled) return;
    setLocalTimeBuckets([...availableTimeBuckets]);
  };

  const handleDeselectAllTimeBuckets = () => {
    if (disabled) return;
    setLocalTimeBuckets([]);
  };

  // Reason handlers
  const handleReasonToggle = (reason: string) => {
    if (disabled) return;
    if (localReasons.includes(reason)) {
      setLocalReasons(localReasons.filter(r => r !== reason));
    } else {
      setLocalReasons([...localReasons, reason]);
    }
  };

  const handleSelectAllReasons = () => {
    if (disabled) return;
    setLocalReasons([...availableReasons]);
  };

  const handleDeselectAllReasons = () => {
    if (disabled) return;
    setLocalReasons([]);
  };

  const handleApplyFilters = () => {
    if (disabled) return;
    onApply({
      sgas: localSGAs.length > 0 ? localSGAs : availableSGAs,
      timeBuckets: localTimeBuckets.length > 0 ? localTimeBuckets : availableTimeBuckets,
      reasons: localReasons.length > 0 ? localReasons : availableReasons,
    });
  };

  const handleResetFilters = () => {
    if (disabled) return;
    setLocalSGAs([...availableSGAs]);
    setLocalTimeBuckets([...availableTimeBuckets]);
    setLocalReasons([...availableReasons]);
  };

  const hasPendingChanges = 
    JSON.stringify([...localSGAs].sort()) !== JSON.stringify([...initialSGAs].sort()) ||
    JSON.stringify([...localTimeBuckets].sort()) !== JSON.stringify([...initialTimeBuckets].sort()) ||
    JSON.stringify([...localReasons].sort()) !== JSON.stringify([...initialReasons].sort());

  const sgasSummary = localSGAs.length === availableSGAs.length 
    ? 'All SGAs' 
    : `${localSGAs.length} SGAs`;

  const timeBucketsSummary = localTimeBuckets.length === availableTimeBuckets.length 
    ? 'All Buckets' 
    : `${localTimeBuckets.length} Buckets`;

  const reasonsSummary = localReasons.length === availableReasons.length 
    ? 'All Reasons' 
    : `${localReasons.length} Reasons`;

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
              {sgasSummary}
            </span>
            <span className="text-sm bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-full">
              {timeBucketsSummary}
            </span>
            <span className="text-sm bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300 px-2 py-0.5 rounded-full">
              {reasonsSummary}
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* SGA Multi-Select */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-base font-medium text-gray-700 dark:text-gray-300">
                  SGA Name
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={handleSelectAllSgas}
                    disabled={disabled}
                    className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
                  >
                    Select All
                  </button>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <button
                    onClick={handleDeselectAllSgas}
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
                placeholder="Search SGAs..."
                value={sgaSearch}
                onChange={(e) => setSgaSearch(e.target.value)}
                disabled={disabled}
                className="w-full px-3 py-2 text-base border border-gray-300 dark:border-gray-600 rounded-lg mb-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 disabled:opacity-50"
              />
              
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {filteredSgaOptions.length === 0 ? (
                  <div className="flex items-center justify-center py-4 text-gray-400 text-sm">
                    {sgaSearch ? 'No SGAs match your search' : 'No SGAs found'}
                  </div>
                ) : (
                  filteredSgaOptions.map(sga => {
                    const isSelected = localSGAs.includes(sga);
                    return (
                      <label
                        key={sga}
                        className={`
                          flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors
                          ${isSelected 
                            ? 'bg-blue-50 dark:bg-blue-900/30' 
                            : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                          }
                          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
                        `}
                      >
                        <div className={`
                          w-4 h-4 rounded border-2 flex items-center justify-center transition-colors
                          ${isSelected 
                            ? 'bg-blue-600 border-blue-600' 
                            : 'border-gray-300 dark:border-gray-600'
                          }
                        `}>
                          {isSelected && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleSgaToggle(sga)}
                          disabled={disabled}
                          className="sr-only"
                        />
                        <span className={`text-base ${isSelected ? 'text-blue-700 dark:text-blue-300 font-medium' : 'text-gray-700 dark:text-gray-300'}`}>
                          {sga}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>

            {/* Time Bucket Multi-Select */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-base font-medium text-gray-700 dark:text-gray-300">
                  Days Since Closed Lost Time Bucket
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={handleSelectAllTimeBuckets}
                    disabled={disabled}
                    className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
                  >
                    Select All
                  </button>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <button
                    onClick={handleDeselectAllTimeBuckets}
                    disabled={disabled}
                    className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
                  >
                    Deselect All
                  </button>
                </div>
              </div>
              
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {availableTimeBuckets.length === 0 ? (
                  <div className="flex items-center justify-center py-4 text-gray-400 text-sm">
                    No time buckets found
                  </div>
                ) : (
                  availableTimeBuckets.map(bucket => {
                    const isSelected = localTimeBuckets.includes(bucket);
                    return (
                      <label
                        key={bucket}
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
                          w-4 h-4 rounded border-2 flex items-center justify-center transition-colors
                          ${isSelected 
                            ? 'bg-purple-600 border-purple-600' 
                            : 'border-gray-300 dark:border-gray-600'
                          }
                        `}>
                          {isSelected && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleTimeBucketToggle(bucket)}
                          disabled={disabled}
                          className="sr-only"
                        />
                        <span className={`text-base ${isSelected ? 'text-purple-700 dark:text-purple-300 font-medium' : 'text-gray-700 dark:text-gray-300'}`}>
                          {bucket}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>

            {/* Closed Lost Reason Multi-Select */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-base font-medium text-gray-700 dark:text-gray-300">
                  Closed Lost Reason
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={handleSelectAllReasons}
                    disabled={disabled}
                    className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
                  >
                    Select All
                  </button>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <button
                    onClick={handleDeselectAllReasons}
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
                placeholder="Search reasons..."
                value={reasonSearch}
                onChange={(e) => setReasonSearch(e.target.value)}
                disabled={disabled}
                className="w-full px-3 py-2 text-base border border-gray-300 dark:border-gray-600 rounded-lg mb-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 disabled:opacity-50"
              />
              
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {filteredReasonOptions.length === 0 ? (
                  <div className="flex items-center justify-center py-4 text-gray-400 text-sm">
                    {reasonSearch ? 'No reasons match your search' : 'No reasons found'}
                  </div>
                ) : (
                  filteredReasonOptions.map(reason => {
                    const isSelected = localReasons.includes(reason);
                    return (
                      <label
                        key={reason}
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
                          onChange={() => handleReasonToggle(reason)}
                          disabled={disabled}
                          className="sr-only"
                        />
                        <span className={`text-base ${isSelected ? 'text-green-700 dark:text-green-300 font-medium' : 'text-gray-700 dark:text-gray-300'}`}>
                          {reason}
                        </span>
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
