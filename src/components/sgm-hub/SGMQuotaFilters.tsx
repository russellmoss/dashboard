'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Check, Filter } from 'lucide-react';
import { SGMPacingStatus, SGMQuotaFilters as SGMQuotaFiltersType } from '@/types/sgm-hub';
import { getCurrentQuarter, getQuarterInfo } from '@/lib/utils/sga-hub-helpers';

interface SGMOption {
  value: string;
  label: string;
  isActive: boolean;
}

interface SGMQuotaFiltersProps {
  selectedFilters: SGMQuotaFiltersType;
  channelOptions: string[];
  sourceOptions: string[];
  sgmOptions: SGMOption[];
  sgmOptionsLoading: boolean;
  onApply: (filters: SGMQuotaFiltersType) => void;
  disabled?: boolean;
}

const PACING_OPTIONS: Array<{ value: SGMPacingStatus; label: string }> = [
  { value: 'ahead', label: 'Ahead' },
  { value: 'on-track', label: 'On Track' },
  { value: 'behind', label: 'Behind' },
  { value: 'no-goal', label: 'No Goal' },
];

function generateQuarterOptions(): Array<{ value: string; label: string }> {
  const options: Array<{ value: string; label: string }> = [];
  const now = new Date();
  const currentYear = now.getFullYear();
  // Show quarters from last year through current year + 1
  for (let year = currentYear - 1; year <= currentYear + 1; year++) {
    for (let q = 1; q <= 4; q++) {
      const value = `${year}-Q${q}`;
      const info = getQuarterInfo(value);
      options.push({ value, label: info.label });
    }
  }
  return options;
}

export function SGMQuotaFilters({
  selectedFilters,
  channelOptions,
  sourceOptions,
  sgmOptions,
  sgmOptionsLoading,
  onApply,
  disabled = false,
}: SGMQuotaFiltersProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [pendingQuarter, setPendingQuarter] = useState(selectedFilters.quarter);
  const [pendingSGMs, setPendingSGMs] = useState<string[]>(selectedFilters.sgmNames || []);
  const [pendingChannels, setPendingChannels] = useState<string[]>(selectedFilters.channels || []);
  const [pendingSources, setPendingSources] = useState<string[]>(selectedFilters.sources || []);
  const [pendingPacing, setPendingPacing] = useState<SGMPacingStatus[]>(selectedFilters.pacingStatuses || []);

  const quarterOptions = generateQuarterOptions();

  const handleApply = () => {
    onApply({
      quarter: pendingQuarter,
      sgmNames: pendingSGMs.length > 0 ? pendingSGMs : undefined,
      channels: pendingChannels.length > 0 ? pendingChannels : undefined,
      sources: pendingSources.length > 0 ? pendingSources : undefined,
      pacingStatuses: pendingPacing.length > 0 ? pendingPacing : undefined,
    });
  };

  const handleReset = () => {
    const currentQ = getCurrentQuarter();
    setPendingQuarter(currentQ);
    setPendingSGMs([]);
    setPendingChannels([]);
    setPendingSources([]);
    setPendingPacing([]);
    onApply({ quarter: currentQ });
  };

  const toggleItem = (
    item: string,
    list: string[],
    setter: (v: string[]) => void
  ) => {
    setter(
      list.includes(item) ? list.filter(i => i !== item) : [...list, item]
    );
  };

  const togglePacing = (status: SGMPacingStatus) => {
    setPendingPacing(prev =>
      prev.includes(status) ? prev.filter(s => s !== status) : [...prev, status]
    );
  };

  const MultiSelect = ({
    label,
    options,
    selected,
    onToggle,
    loading = false,
  }: {
    label: string;
    options: Array<{ value: string; label: string }>;
    selected: string[];
    onToggle: (value: string) => void;
    loading?: boolean;
  }) => (
    <div>
      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{label}</label>
      <div className="max-h-36 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800">
        {loading ? (
          <p className="text-xs text-gray-400 p-2">Loading...</p>
        ) : options.length === 0 ? (
          <p className="text-xs text-gray-400 p-2">None available</p>
        ) : (
          options.map(opt => (
            <button
              key={opt.value}
              onClick={() => onToggle(opt.value)}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              <div className={`w-4 h-4 border rounded flex items-center justify-center ${
                selected.includes(opt.value)
                  ? 'bg-blue-600 border-blue-600'
                  : 'border-gray-300 dark:border-gray-600'
              }`}>
                {selected.includes(opt.value) && <Check className="w-3 h-3 text-white" />}
              </div>
              <span className="text-gray-700 dark:text-gray-300 truncate">{opt.label}</span>
            </button>
          ))
        )}
      </div>
      {selected.length > 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{selected.length} selected</p>
      )}
    </div>
  );

  return (
    <div className="mb-6">
      {/* Compact header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Quarter:</label>
          <select
            value={pendingQuarter}
            onChange={(e) => setPendingQuarter(e.target.value)}
            className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm text-gray-900 dark:text-white"
          >
            {quarterOptions.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
        >
          <Filter className="w-4 h-4" />
          Filters
          {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Expandable filter panel */}
      {isOpen && (
        <div className="mt-3 p-4 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-900">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MultiSelect
              label="SGMs"
              options={sgmOptions.map(s => ({ value: s.value, label: s.label }))}
              selected={pendingSGMs}
              onToggle={(v) => toggleItem(v, pendingSGMs, setPendingSGMs)}
              loading={sgmOptionsLoading}
            />
            <MultiSelect
              label="Channels"
              options={channelOptions.map(c => ({ value: c, label: c }))}
              selected={pendingChannels}
              onToggle={(v) => toggleItem(v, pendingChannels, setPendingChannels)}
            />
            <MultiSelect
              label="Sources"
              options={sourceOptions.map(s => ({ value: s, label: s }))}
              selected={pendingSources}
              onToggle={(v) => toggleItem(v, pendingSources, setPendingSources)}
            />
            <MultiSelect
              label="Pacing Status"
              options={PACING_OPTIONS.map(p => ({ value: p.value, label: p.label }))}
              selected={pendingPacing}
              onToggle={(v) => togglePacing(v as SGMPacingStatus)}
            />
          </div>
          <div className="flex items-center gap-2 mt-4">
            <button
              onClick={handleApply}
              disabled={disabled}
              className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              Apply
            </button>
            <button
              onClick={handleReset}
              className="px-4 py-1.5 text-gray-600 dark:text-gray-400 text-sm hover:text-gray-900 dark:hover:text-white"
            >
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
