'use client';

import { useState, useMemo } from 'react';
import { Button } from '@tremor/react';
import { FilterOptions, DashboardFilters } from '@/types/filters';
import { RefreshCw, Save } from 'lucide-react';
import { DataFreshnessIndicator } from '@/components/dashboard/DataFreshnessIndicator';
import { SavedReportsDropdown } from './SavedReportsDropdown';
import { SavedReport } from '@/types/saved-reports';

interface GlobalFiltersProps {
  filters: DashboardFilters;
  filterOptions: FilterOptions;
  onFiltersChange: (filters: DashboardFilters) => void;
  onReset: () => void;
  // Saved Reports props
  savedReports: {
    userReports: SavedReport[];
    adminTemplates: SavedReport[];
  };
  activeReportId: string | null;
  onSelectReport: (report: SavedReport) => void;
  onEditReport: (report: SavedReport) => void;
  onDuplicateReport: (report: SavedReport) => void;
  onDeleteReport: (report: SavedReport) => void;
  onSetDefault: (report: SavedReport) => void;
  onSaveReport: () => void;
  isLoadingReports?: boolean;
  isAdmin?: boolean; // Whether current user is admin/manager
}

const DATE_PRESETS = [
  { value: 'alltime', label: 'All Time' },
  { value: 'ytd', label: 'Year to Date' },
  { value: 'qtd', label: 'Quarter to Date' },
  { value: 'q1', label: 'Q1' },
  { value: 'q2', label: 'Q2' },
  { value: 'q3', label: 'Q3' },
  { value: 'q4', label: 'Q4' },
  { value: 'last30', label: 'Last 30 Days' },
  { value: 'last90', label: 'Last 90 Days' },
  { value: 'custom', label: 'Custom Range' },
];

/**
 * Small toggle switch for Active/All filter
 */
const ActiveToggle = ({ 
  isActiveOnly, 
  onToggle, 
  label 
}: { 
  isActiveOnly: boolean; 
  onToggle: () => void; 
  label: string;
}) => (
  <div className="flex items-center gap-1.5 ml-2">
    <span className={`text-xs ${isActiveOnly ? 'text-blue-600 font-medium' : 'text-gray-400'}`}>
      Active
    </span>
    <button
      type="button"
      onClick={onToggle}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 ${
        isActiveOnly ? 'bg-blue-600' : 'bg-gray-300'
      }`}
      role="switch"
      aria-checked={isActiveOnly}
      aria-label={`Toggle ${label} active filter`}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
          isActiveOnly ? 'translate-x-0' : 'translate-x-4'
        }`}
      />
    </button>
    <span className={`text-xs ${!isActiveOnly ? 'text-gray-600 font-medium' : 'text-gray-400'}`}>
      All
    </span>
  </div>
);

export function GlobalFilters({ 
  filters, 
  filterOptions, 
  onFiltersChange, 
  onReset,
  savedReports,
  activeReportId,
  onSelectReport,
  onEditReport,
  onDuplicateReport,
  onDeleteReport,
  onSetDefault,
  onSaveReport,
  isLoadingReports = false,
  isAdmin = false,
}: GlobalFiltersProps) {
  // Toggle state for showing only active SGAs/SGMs (default: true = active only)
  const [sgaActiveOnly, setSgaActiveOnly] = useState<boolean>(true);
  const [sgmActiveOnly, setSgmActiveOnly] = useState<boolean>(true);

  // Filter SGA options based on active toggle
  const filteredSgaOptions = useMemo(() => {
    if (!filterOptions.sgas || filterOptions.sgas.length === 0) return [];
    return sgaActiveOnly 
      ? filterOptions.sgas.filter(opt => opt.isActive) 
      : filterOptions.sgas;
  }, [filterOptions.sgas, sgaActiveOnly]);

  // Filter SGM options based on active toggle
  const filteredSgmOptions = useMemo(() => {
    if (!filterOptions.sgms || filterOptions.sgms.length === 0) return [];
    return sgmActiveOnly 
      ? filterOptions.sgms.filter(opt => opt.isActive) 
      : filterOptions.sgms;
  }, [filterOptions.sgms, sgmActiveOnly]);

  const handleDatePresetChange = (preset: string) => {
    const currentYear = new Date().getFullYear();
    const updatedFilters: DashboardFilters = {
      ...filters,
      datePreset: preset as DashboardFilters['datePreset'],
    };
    
    // Auto-select current year for "Quarter to Date" and "Year to Date"
    if (preset === 'qtd' || preset === 'ytd') {
      updatedFilters.year = currentYear;
    }
    
    onFiltersChange(updatedFilters);
  };

  const handleYearChange = (year: number) => {
    onFiltersChange({
      ...filters,
      year,
    });
  };

  const handleChannelChange = (value: string) => {
    onFiltersChange({
      ...filters,
      channel: value === '' ? null : value,
    });
  };

  const handleSourceChange = (value: string) => {
    onFiltersChange({
      ...filters,
      source: value === '' ? null : value,
    });
  };

  const handleSgaChange = (value: string) => {
    onFiltersChange({
      ...filters,
      sga: value === '' ? null : value,
    });
  };

  const handleSgmChange = (value: string) => {
    onFiltersChange({
      ...filters,
      sgm: value === '' ? null : value,
    });
  };

  const handleExperimentationTagChange = (value: string) => {
    onFiltersChange({
      ...filters,
      experimentationTag: value === '' ? null : value,
    });
  };

  const handleStartDateChange = (date: string) => {
    onFiltersChange({
      ...filters,
      startDate: date,
      datePreset: 'custom',
    });
  };

  const handleEndDateChange = (date: string) => {
    onFiltersChange({
      ...filters,
      endDate: date,
      datePreset: 'custom',
    });
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Filters</h3>
        
        <div className="flex items-center gap-3">
          {/* Saved Reports Dropdown */}
          <SavedReportsDropdown
            userReports={savedReports.userReports}
            adminTemplates={savedReports.adminTemplates}
            activeReportId={activeReportId}
            onSelectReport={onSelectReport}
            onEditReport={onEditReport}
            onDuplicateReport={onDuplicateReport}
            onDeleteReport={onDeleteReport}
            onSetDefault={onSetDefault}
            isLoading={isLoadingReports}
            isAdmin={isAdmin}
          />
          
          {/* Save Report Button */}
          <Button
            icon={Save}
            size="sm"
            variant="secondary"
            onClick={onSaveReport}
            className="text-gray-700 dark:text-gray-200"
          >
            Save
          </Button>
          
          {/* Reset Button */}
          <Button
            icon={RefreshCw}
            size="sm"
            variant="light"
            onClick={onReset}
            className="text-gray-700 dark:text-gray-200 hover:text-gray-900 dark:hover:text-white"
          >
            Reset
          </Button>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Date Preset */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
            Date Range
          </label>
          <select
            value={filters.datePreset}
            onChange={(e) => handleDatePresetChange(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
          >
            {DATE_PRESETS.map((preset) => (
              <option key={preset.value} value={preset.value}>
                {preset.label}
              </option>
            ))}
          </select>
        </div>

        {/* Year - Only show for Q1-Q4 presets, not for QTD/YTD */}
        {['q1', 'q2', 'q3', 'q4'].includes(filters.datePreset) && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
              Year
            </label>
            <select
              value={filters.year.toString()}
              onChange={(e) => handleYearChange(parseInt(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
            >
              {filterOptions.years.map((year) => (
                <option key={year} value={year.toString()}>
                  {year}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Custom Date Range (shown when preset is 'custom') */}
        {filters.datePreset === 'custom' && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                Start Date
              </label>
              <input
                type="date"
                value={filters.startDate}
                onChange={(e) => handleStartDateChange(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                End Date
              </label>
              <input
                type="date"
                value={filters.endDate}
                onChange={(e) => handleEndDateChange(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
          </>
        )}

        {/* Channel */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
            Channel
          </label>
          <select
            value={filters.channel || ''}
            onChange={(e) => handleChannelChange(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
          >
            <option value="">All Channels</option>
            {filterOptions.channels.map((channel) => (
              <option key={channel} value={channel}>
                {channel}
              </option>
            ))}
          </select>
        </div>

        {/* Source */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
            Source
          </label>
          <select
            value={filters.source || ''}
            onChange={(e) => handleSourceChange(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
          >
            <option value="">All Sources</option>
            {filterOptions.sources.map((source) => (
              <option key={source} value={source}>
                {source}
              </option>
            ))}
          </select>
        </div>

        {/* SGA */}
        {filterOptions.sgas.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                SGA
              </label>
              <ActiveToggle 
                isActiveOnly={sgaActiveOnly} 
                onToggle={() => setSgaActiveOnly(!sgaActiveOnly)} 
                label="SGA"
              />
            </div>
            <select
              value={filters.sga || ''}
              onChange={(e) => handleSgaChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
            >
              <option value="">All SGAs</option>
              {filteredSgaOptions.map((sga) => (
                <option key={sga.value} value={sga.value}>
                  {sga.label}{!sgaActiveOnly && !sga.isActive ? ' (Inactive)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* SGM */}
        {filterOptions.sgms.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                SGM
              </label>
              <ActiveToggle 
                isActiveOnly={sgmActiveOnly} 
                onToggle={() => setSgmActiveOnly(!sgmActiveOnly)} 
                label="SGM"
              />
            </div>
            <select
              value={filters.sgm || ''}
              onChange={(e) => handleSgmChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
            >
              <option value="">All SGMs</option>
              {filteredSgmOptions.map((sgm) => (
                <option key={sgm.value} value={sgm.value}>
                  {sgm.label}{!sgmActiveOnly && !sgm.isActive ? ' (Inactive)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Experimentation Tag */}
        {filterOptions.experimentationTags && filterOptions.experimentationTags.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
              Experimentation Tag
            </label>
            <select
              value={filters.experimentationTag || ''}
              onChange={(e) => handleExperimentationTagChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
            >
              <option value="">All Tags</option>
              {filterOptions.experimentationTags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      
      {/* Data Freshness Indicator */}
      <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700">
        <DataFreshnessIndicator variant="detailed" />
      </div>
    </div>
  );
}
