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
  metricFilter: 'all' | 'sql' | 'sqo' | 'joined' | 'openPipeline';
}

export interface FilterOptions {
  channels: string[];
  sources: string[];
  sgas: string[];
  sgms: string[];
  stages: string[];
  years: number[];
}
