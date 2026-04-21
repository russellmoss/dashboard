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
  leadScoreTiers: MultiSelectFilter;
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
  leadScoreTiers: {
    selectAll: true,
    selected: [],
  },
};

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
  metricDisposition?: 'all' | 'open' | 'lost' | 'converted';
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
  leadScoreTiers: FilterOption[];
}

// Disposition filter type for MQL/SQL/SQO drill-down
export type MetricDisposition = 'all' | 'open' | 'lost' | 'converted';

// Add export for activity dashboard
export type { SGAActivityFilters } from './sga-activity';
