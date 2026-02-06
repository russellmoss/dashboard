/**
 * Represents a filter option with active status for SGA/SGM dropdowns
 */
export interface FilterOption {
  value: string;
  label: string;
  isActive: boolean;
  count?: number;  // Optional record count for context
}

// Date range filter for Initial Call and Qualification Call
export interface DateRangeFilter {
  enabled: boolean;
  preset: 'any' | 'qtd' | 'ytd' | 'custom';
  startDate: string | null;  // ISO date string YYYY-MM-DD
  endDate: string | null;    // ISO date string YYYY-MM-DD
}

// Multi-select filter (for Channels, Sources, SGAs, SGMs)
export interface MultiSelectFilter {
  selectAll: boolean;
  selected: string[];  // Array of selected values
}

// Complete advanced filters state
export interface AdvancedFilters {
  // Date filters
  initialCallScheduled: DateRangeFilter;
  qualificationCallDate: DateRangeFilter;
  
  // Multi-select filters
  channels: MultiSelectFilter;
  sources: MultiSelectFilter;
  sgas: MultiSelectFilter;
  sgms: MultiSelectFilter;
  experimentationTags: MultiSelectFilter;
  campaigns: MultiSelectFilter;
}

// Default/empty advanced filters state
export const DEFAULT_ADVANCED_FILTERS: AdvancedFilters = {
  initialCallScheduled: {
    enabled: false,
    preset: 'any',
    startDate: null,
    endDate: null,
  },
  qualificationCallDate: {
    enabled: false,
    preset: 'any',
    startDate: null,
    endDate: null,
  },
  channels: {
    selectAll: true,
    selected: [],
  },
  sources: {
    selectAll: true,
    selected: [],
  },
  sgas: {
    selectAll: true,
    selected: [],
  },
  sgms: {
    selectAll: true,
    selected: [],
  },
  experimentationTags: {
    selectAll: true,
    selected: [],
  },
  campaigns: {
    selectAll: true,
    selected: [],
  },
};

// Helper to check if any advanced filters are active
export function hasActiveAdvancedFilters(filters: AdvancedFilters): boolean {
  return (
    filters.initialCallScheduled.enabled ||
    filters.qualificationCallDate.enabled ||
    !filters.channels.selectAll ||
    !filters.sources.selectAll ||
    !filters.sgas.selectAll ||
    !filters.sgms.selectAll ||
    !filters.experimentationTags.selectAll ||
    !filters.campaigns.selectAll
  );
}

// Helper to count active filters
export function countActiveAdvancedFilters(filters: AdvancedFilters): number {
  let count = 0;
  if (filters.initialCallScheduled.enabled) count++;
  if (filters.qualificationCallDate.enabled) count++;
  if (!filters.channels.selectAll) count++;
  if (!filters.sources.selectAll) count++;
  if (!filters.sgas.selectAll) count++;
  if (!filters.sgms.selectAll) count++;
  if (!filters.experimentationTags.selectAll) count++;
  if (!filters.campaigns.selectAll) count++;
  return count;
}

export interface DashboardFilters {
  startDate: string;
  endDate: string;
  datePreset: 'ytd' | 'qtd' | 'q1' | 'q2' | 'q3' | 'q4' | 'custom' | 'last30' | 'last90' | 'alltime';
  year: number;
  channel: string | null;
  source: string | null;
  sga: string | null;
  sgm: string | null;
  stage: string | null;
  experimentationTag: string | null;
  campaignId: string | null;
  metricFilter: 'all' | 'prospect' | 'contacted' | 'mql' | 'sql' | 'sqo' | 'signed' | 'joined' | 'openPipeline';
  advancedFilters?: AdvancedFilters;  // Optional for backward compatibility
}

export interface FilterOptions {
  channels: string[];
  sources: string[];
  sgas: FilterOption[];
  sgms: FilterOption[];
  stages: string[];
  years: number[];
  experimentationTags: string[];
  campaigns: FilterOption[];
}

// Add export for activity dashboard
export type { SGAActivityFilters } from './sga-activity';
