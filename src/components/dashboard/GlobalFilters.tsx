'use client';

import { Button } from '@tremor/react';
import { FilterOptions, DashboardFilters } from '@/types/filters';
import { RefreshCw } from 'lucide-react';

interface GlobalFiltersProps {
  filters: DashboardFilters;
  filterOptions: FilterOptions;
  onFiltersChange: (filters: DashboardFilters) => void;
  onReset: () => void;
}

const DATE_PRESETS = [
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

export function GlobalFilters({ 
  filters, 
  filterOptions, 
  onFiltersChange, 
  onReset 
}: GlobalFiltersProps) {
  const handleDatePresetChange = (preset: string) => {
    onFiltersChange({
      ...filters,
      datePreset: preset as DashboardFilters['datePreset'],
    });
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
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">Filters</h3>
        <Button
          icon={RefreshCw}
          size="sm"
          variant="light"
          onClick={onReset}
        >
          Reset
        </Button>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Date Preset */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
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

        {/* Year */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
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

        {/* Custom Date Range (shown when preset is 'custom') */}
        {filters.datePreset === 'custom' && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
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
              <label className="block text-sm font-medium text-gray-700 mb-1">
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
          <label className="block text-sm font-medium text-gray-700 mb-1">
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
          <label className="block text-sm font-medium text-gray-700 mb-1">
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
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              SGA
            </label>
            <select
              value={filters.sga || ''}
              onChange={(e) => handleSgaChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
            >
              <option value="">All SGAs</option>
              {filterOptions.sgas.map((sga) => (
                <option key={sga} value={sga}>
                  {sga}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* SGM */}
        {filterOptions.sgms.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              SGM
            </label>
            <select
              value={filters.sgm || ''}
              onChange={(e) => handleSgmChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
            >
              <option value="">All SGMs</option>
              {filterOptions.sgms.map((sgm) => (
                <option key={sgm} value={sgm}>
                  {sgm}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}
