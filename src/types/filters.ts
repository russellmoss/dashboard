/**
 * Represents a filter option with active status for SGA/SGM dropdowns
 */
export interface FilterOption {
  value: string;
  label: string;
  isActive: boolean;
}

export interface DashboardFilters {
  startDate: string;
  endDate: string;
  datePreset: 'ytd' | 'qtd' | 'q1' | 'q2' | 'q3' | 'q4' | 'custom' | 'last30' | 'last90';
  year: number;
  channel: string | null;
  source: string | null;
  sga: string | null;
  sgm: string | null;
  stage: string | null;
  metricFilter: 'all' | 'prospect' | 'contacted' | 'mql' | 'sql' | 'sqo' | 'joined' | 'openPipeline';
}

export interface FilterOptions {
  channels: string[];
  sources: string[];
  sgas: FilterOption[];
  sgms: FilterOption[];
  stages: string[];
  years: number[];
}
