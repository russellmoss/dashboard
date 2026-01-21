'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { ChevronDown, ChevronUp, Check, Filter, RotateCcw } from 'lucide-react';
import { OPEN_PIPELINE_STAGES } from '@/config/constants';
import { SgmOption } from '@/types/dashboard';

// All possible opportunity stages
const ALL_STAGES = [
  { value: 'Qualifying', label: 'Qualifying', isOpenPipeline: true },
  { value: 'Discovery', label: 'Discovery', isOpenPipeline: true },
  { value: 'Sales Process', label: 'Sales Process', isOpenPipeline: true },
  { value: 'Negotiating', label: 'Negotiating', isOpenPipeline: true },
  { value: 'Signed', label: 'Signed', isOpenPipeline: false },
  { value: 'On Hold', label: 'On Hold', isOpenPipeline: false },
  { value: 'Planned Nurture', label: 'Planned Nurture', isOpenPipeline: false },
];

interface PipelineFiltersProps {
  // Stage filter
  selectedStages: string[];
  onApply: (stages: string[], sgms: string[]) => void;
  // SGM filter
  selectedSgms: string[];
  sgmOptions: SgmOption[];
  sgmOptionsLoading: boolean;
  // State
  disabled?: boolean;
}

export function PipelineFilters({
  selectedStages: initialStages,
  onApply,
  selectedSgms: initialSgms,
  sgmOptions,
  sgmOptionsLoading,
  disabled = false,
}: PipelineFiltersProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [sgmSearch, setSgmSearch] = useState('');
  
  // Local state for filter selections (not applied until Apply is clicked)
  const [localStages, setLocalStages] = useState<string[]>(initialStages);
  const [localSgms, setLocalSgms] = useState<string[]>(initialSgms);
  
  // Sync local state when props change (e.g., after applying filters)
  useEffect(() => {
    setLocalStages(initialStages);
    setLocalSgms(initialSgms);
  }, [initialStages, initialSgms]);

  // Filter SGM options by search
  const filteredSgmOptions = useMemo(() => {
    if (!sgmSearch.trim()) return sgmOptions;
    const search = sgmSearch.toLowerCase();
    return sgmOptions.filter(opt => opt.label.toLowerCase().includes(search));
  }, [sgmOptions, sgmSearch]);

  // Stage handlers (update local state only)
  const handleStageToggle = (stage: string) => {
    if (disabled) return;
    if (localStages.includes(stage)) {
      // Allow removing stages (can deselect all)
      setLocalStages(localStages.filter(s => s !== stage));
    } else {
      setLocalStages([...localStages, stage]);
    }
  };

  const handleSelectAllStages = () => {
    if (disabled) return;
    setLocalStages(ALL_STAGES.map(s => s.value));
  };

  const handleDeselectAllStages = () => {
    if (disabled) return;
    setLocalStages([]);
  };

  const handleSelectOpenPipelineStages = () => {
    if (disabled) return;
    setLocalStages([...OPEN_PIPELINE_STAGES]);
  };

  // SGM handlers (update local state only)
  const handleSgmToggle = (sgm: string) => {
    if (disabled) return;
    if (localSgms.includes(sgm)) {
      // Allow removing SGMs (can deselect all)
      setLocalSgms(localSgms.filter(s => s !== sgm));
    } else {
      setLocalSgms([...localSgms, sgm]);
    }
  };

  const handleSelectAllSgms = () => {
    if (disabled) return;
    setLocalSgms(sgmOptions.map(s => s.value));
  };

  const handleDeselectAllSgms = () => {
    if (disabled) return;
    setLocalSgms([]);
  };

  const handleSelectActiveSgms = () => {
    if (disabled) return;
    const activeSgms = sgmOptions.filter(s => s.isActive).map(s => s.value);
    setLocalSgms(activeSgms.length > 0 ? activeSgms : sgmOptions.map(s => s.value));
  };

  // Apply filters
  const handleApplyFilters = () => {
    if (disabled) return;
    // Ensure at least one stage and one SGM is selected
    if (localStages.length === 0) {
      alert('Please select at least one opportunity stage.');
      return;
    }
    if (localSgms.length === 0) {
      alert('Please select at least one SGM.');
      return;
    }
    onApply(localStages, localSgms);
  };

  // Reset all filters to defaults (local state only)
  const handleResetFilters = () => {
    if (disabled) return;
    setLocalStages([...OPEN_PIPELINE_STAGES]);
    setLocalSgms(sgmOptions.map(s => s.value));
  };

  // Summary counts for header (based on applied filters, not local state)
  const stagesSummary = initialStages.length === ALL_STAGES.length 
    ? 'All Stages' 
    : initialStages.length === OPEN_PIPELINE_STAGES.length && 
      OPEN_PIPELINE_STAGES.every(s => initialStages.includes(s))
      ? 'Open Pipeline'
      : `${initialStages.length} Stages`;
  
  const sgmsSummary = sgmOptionsLoading 
    ? 'Loading...'
    : initialSgms.length === sgmOptions.length 
      ? 'All SGMs' 
      : `${initialSgms.length} SGMs`;

  // Check if local state differs from applied filters
  const hasPendingChanges = 
    localStages.length !== initialStages.length ||
    !localStages.every(s => initialStages.includes(s)) ||
    !initialStages.every(s => localStages.includes(s)) ||
    localSgms.length !== initialSgms.length ||
    !localSgms.every(s => initialSgms.includes(s)) ||
    !initialSgms.every(s => localSgms.includes(s));

  const hasCustomFilters = 
    initialStages.length !== OPEN_PIPELINE_STAGES.length ||
    !OPEN_PIPELINE_STAGES.every(s => initialStages.includes(s)) ||
    initialSgms.length !== sgmOptions.length;

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-800">
      {/* Collapsed Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        disabled={disabled}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
      >
        <div className="flex items-center gap-3">
          <Filter className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Filters
          </span>
          <div className="flex items-center gap-2">
            <span className="text-xs bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full">
              {stagesSummary}
            </span>
            <span className="text-xs bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300 px-2 py-0.5 rounded-full">
              {sgmsSummary}
            </span>
          </div>
          {hasCustomFilters && (
            <span className="text-xs text-orange-600 dark:text-orange-400">
              (Modified)
            </span>
          )}
          {hasPendingChanges && (
            <span className="text-xs text-blue-600 dark:text-blue-400">
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
            {/* Stage Filter */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Opportunity Stages
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={handleSelectOpenPipelineStages}
                    disabled={disabled}
                    className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
                  >
                    Open Pipeline
                  </button>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <button
                    onClick={handleSelectAllStages}
                    disabled={disabled}
                    className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
                  >
                    All Stages
                  </button>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <button
                    onClick={handleDeselectAllStages}
                    disabled={disabled}
                    className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
                  >
                    Deselect All
                  </button>
                </div>
              </div>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {ALL_STAGES.map(stage => {
                  const isSelected = localStages.includes(stage.value);
                  return (
                    <label
                      key={stage.value}
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
                        onChange={() => handleStageToggle(stage.value)}
                        disabled={disabled}
                        className="sr-only"
                      />
                      <span className={`text-sm ${isSelected ? 'text-blue-700 dark:text-blue-300 font-medium' : 'text-gray-700 dark:text-gray-300'}`}>
                        {stage.label}
                      </span>
                      {stage.isOpenPipeline && (
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          (Open Pipeline)
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>

            {/* SGM Filter */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  SGM Owners
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={handleSelectActiveSgms}
                    disabled={disabled || sgmOptionsLoading}
                    className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
                  >
                    Active Only
                  </button>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <button
                    onClick={handleSelectAllSgms}
                    disabled={disabled || sgmOptionsLoading}
                    className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
                  >
                    All SGMs
                  </button>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <button
                    onClick={handleDeselectAllSgms}
                    disabled={disabled || sgmOptionsLoading}
                    className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
                  >
                    Deselect All
                  </button>
                </div>
              </div>
              
              {/* Search */}
              <input
                type="text"
                placeholder="Search SGMs..."
                value={sgmSearch}
                onChange={(e) => setSgmSearch(e.target.value)}
                disabled={disabled || sgmOptionsLoading}
                className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg mb-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 disabled:opacity-50"
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
                    const isSelected = localSgms.includes(sgm.value);
                    return (
                      <label
                        key={sgm.value}
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
                          onChange={() => handleSgmToggle(sgm.value)}
                          disabled={disabled}
                          className="sr-only"
                        />
                        <span className={`text-sm ${isSelected ? 'text-green-700 dark:text-green-300 font-medium' : 'text-gray-700 dark:text-gray-300'}`}>
                          {sgm.label}
                        </span>
                        {!sgm.isActive && (
                          <span className="text-xs text-gray-400 dark:text-gray-500">
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
          <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-3 bg-gray-50 dark:bg-gray-900 flex justify-between items-center">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {hasPendingChanges ? 'Changes pending' : 'Filters applied'}
            </span>
            <div className="flex gap-2">
              <button
                onClick={handleResetFilters}
                disabled={disabled}
                className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Reset
              </button>
              <button
                onClick={handleApplyFilters}
                disabled={disabled || !hasPendingChanges}
                className="px-4 py-1.5 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
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
