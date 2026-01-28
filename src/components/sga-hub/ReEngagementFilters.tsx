// src/components/sga-hub/ReEngagementFilters.tsx

'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { ChevronDown, ChevronUp, Check, Filter } from 'lucide-react';
import { ReEngagementOpportunity } from '@/types/sga-hub';

interface ReEngagementFiltersProps {
  opportunities: ReEngagementOpportunity[];
  selectedSGAs: string[];
  selectedStages: string[];
  onApply: (filters: {
    sgas: string[];
    stages: string[];
  }) => void;
  disabled?: boolean;
}

export function ReEngagementFilters({
  opportunities,
  selectedSGAs: initialSGAs,
  selectedStages: initialStages,
  onApply,
  disabled = false,
}: ReEngagementFiltersProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [sgaSearch, setSgaSearch] = useState('');

  // Extract unique values from opportunities
  const availableSGAs = useMemo(() => {
    const sgas = new Set<string>();
    opportunities.forEach(opp => {
      if (opp.sgaName) {
        sgas.add(opp.sgaName);
      }
    });
    return Array.from(sgas).sort();
  }, [opportunities]);

  const availableStages = useMemo(() => {
    const stages = new Set<string>();
    opportunities.forEach(opp => {
      if (opp.stageName) {
        stages.add(opp.stageName);
      }
    });
    return Array.from(stages).sort();
  }, [opportunities]);

  // Initialize local state with all values selected by default
  const [localSGAs, setLocalSGAs] = useState<string[]>(() => 
    initialSGAs.length > 0 ? initialSGAs : availableSGAs
  );
  const [localStages, setLocalStages] = useState<string[]>(() => 
    initialStages.length > 0 ? initialStages : availableStages
  );

  // Sync local state when opportunities change (to update available options)
  useEffect(() => {
    if (availableSGAs.length > 0 && localSGAs.length === 0) {
      setLocalSGAs(availableSGAs);
    }
    if (availableStages.length > 0 && localStages.length === 0) {
      setLocalStages(availableStages);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableSGAs, availableStages]);

  // Sync local state with props
  useEffect(() => {
    if (initialSGAs.length > 0) setLocalSGAs(initialSGAs);
    if (initialStages.length > 0) setLocalStages(initialStages);
  }, [initialSGAs, initialStages]);

  // Filter SGA options by search
  const filteredSgaOptions = useMemo(() => {
    if (!sgaSearch.trim()) return availableSGAs;
    const searchLower = sgaSearch.toLowerCase();
    return availableSGAs.filter(sga =>
      sga.toLowerCase().includes(searchLower)
    );
  }, [availableSGAs, sgaSearch]);

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

  // Stage handlers
  const handleStageToggle = (stage: string) => {
    if (disabled) return;
    if (localStages.includes(stage)) {
      setLocalStages(localStages.filter(s => s !== stage));
    } else {
      setLocalStages([...localStages, stage]);
    }
  };

  const handleSelectAllStages = () => {
    if (disabled) return;
    setLocalStages([...availableStages]);
  };

  const handleDeselectAllStages = () => {
    if (disabled) return;
    setLocalStages([]);
  };

  const handleApplyFilters = () => {
    if (disabled) return;
    onApply({
      sgas: localSGAs.length > 0 ? localSGAs : availableSGAs,
      stages: localStages.length > 0 ? localStages : availableStages,
    });
  };

  const handleResetFilters = () => {
    if (disabled) return;
    setLocalSGAs([...availableSGAs]);
    setLocalStages([...availableStages]);
  };

  const hasPendingChanges = 
    JSON.stringify([...localSGAs].sort()) !== JSON.stringify([...initialSGAs].sort()) ||
    JSON.stringify([...localStages].sort()) !== JSON.stringify([...initialStages].sort());

  const sgasSummary = localSGAs.length === availableSGAs.length 
    ? 'All SGAs' 
    : `${localSGAs.length} SGAs`;

  const stagesSummary = localStages.length === availableStages.length 
    ? 'All Stages' 
    : `${localStages.length} Stages`;

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
              {stagesSummary}
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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

            {/* Stage Multi-Select */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-base font-medium text-gray-700 dark:text-gray-300">
                  Stage
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={handleSelectAllStages}
                    disabled={disabled}
                    className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
                  >
                    Select All
                  </button>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <button
                    onClick={handleDeselectAllStages}
                    disabled={disabled}
                    className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
                  >
                    Deselect All
                  </button>
                </div>
              </div>
              
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {availableStages.length === 0 ? (
                  <div className="flex items-center justify-center py-4 text-gray-400 text-sm">
                    No stages found
                  </div>
                ) : (
                  availableStages.map(stage => {
                    const isSelected = localStages.includes(stage);
                    return (
                      <label
                        key={stage}
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
                          onChange={() => handleStageToggle(stage)}
                          disabled={disabled}
                          className="sr-only"
                        />
                        <span className={`text-base ${isSelected ? 'text-purple-700 dark:text-purple-300 font-medium' : 'text-gray-700 dark:text-gray-300'}`}>
                          {stage}
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
