import { DashboardFilters, FilterOptions } from '@/types/filters';
import { FunnelMetrics, ConversionRates, ConversionRatesResponse, ChannelPerformance, SourcePerformance, DetailRecord, TrendDataPoint } from '@/types/dashboard';

export class ApiError extends Error {
  constructor(message: string, public status: number, public endpoint: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function apiFetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(endpoint, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new ApiError(errorData.error || response.statusText, response.status, endpoint);
  }

  return response.json();
}

export const dashboardApi = {
  getFilterOptions: () => apiFetch<FilterOptions>('/api/dashboard/filters'),

  getFunnelMetrics: (filters: DashboardFilters) =>
    apiFetch<FunnelMetrics>('/api/dashboard/funnel-metrics', {
      method: 'POST',
      body: JSON.stringify(filters),
    }),

  getConversionRates: (
    filters: DashboardFilters, 
    options?: { 
      includeTrends?: boolean; 
      granularity?: 'month' | 'quarter'; 
      mode?: 'period' | 'cohort';
    }
  ) =>
    apiFetch<{ 
      rates: ConversionRatesResponse; 
      trends: TrendDataPoint[] | null; 
      mode?: string;
    }>('/api/dashboard/conversion-rates', {
      method: 'POST',
      body: JSON.stringify({ 
        filters, 
        includeTrends: options?.includeTrends ?? false,
        granularity: options?.granularity ?? 'quarter',
        mode: options?.mode ?? 'period',
      }),
    }),

  getChannelPerformance: (filters: DashboardFilters) =>
    apiFetch<{ channels: ChannelPerformance[] }>('/api/dashboard/source-performance', {
      method: 'POST',
      body: JSON.stringify({ filters, groupBy: 'channel' }),
    }),

  getSourcePerformance: (filters: DashboardFilters) =>
    apiFetch<{ sources: SourcePerformance[] }>('/api/dashboard/source-performance', {
      method: 'POST',
      body: JSON.stringify({ filters, groupBy: 'source' }),
    }),

  getDetailRecords: (filters: DashboardFilters, limit = 500) =>
    apiFetch<{ records: DetailRecord[] }>('/api/dashboard/detail-records', {
      method: 'POST',
      body: JSON.stringify({ filters, limit }),
    }),

  getOpenPipeline: (filters?: Partial<DashboardFilters>) =>
    apiFetch<{ records: DetailRecord[]; summary: any }>('/api/dashboard/open-pipeline', {
      method: 'POST',
      body: JSON.stringify(filters ?? {}),
    }),

  async getAllDashboardData(filters: DashboardFilters) {
    const [metrics, { rates, trends }, { channels }, { sources }, { records }] = await Promise.all([
      this.getFunnelMetrics(filters),
      this.getConversionRates(filters, { includeTrends: true }),
      this.getChannelPerformance(filters),
      this.getSourcePerformance(filters),
      this.getDetailRecords(filters),
    ]);

    return { metrics, rates, trends: trends || [], channels, sources, records };
  },
};

export function handleApiError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Please sign in to continue';
    if (error.status === 403) return 'You do not have permission';
    return error.message;
  }
  return 'An unexpected error occurred';
}
