import { DashboardFilters, FilterOptions } from '@/types/filters';
import { 
  FunnelMetrics, 
  FunnelMetricsWithGoals,
  ConversionRates, 
  ConversionRatesResponse, 
  ChannelPerformance, 
  ChannelPerformanceWithGoals,
  SourcePerformance, 
  SourcePerformanceWithGoals,
  DetailRecord, 
  TrendDataPoint 
} from '@/types/dashboard';

export class ApiError extends Error {
  constructor(message: string, public status: number, public endpoint: string) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Get the base URL for API requests.
 * Returns empty string for client-side (browser) to use relative URLs.
 * Returns full URL for server-side requests.
 * This function is called lazily (not at module load time) to avoid build-time errors.
 */
function getBaseUrl(): string {
  // Client-side: use relative URLs (works with Next.js routing)
  if (typeof window !== 'undefined') {
    return '';
  }
  
  // Server-side: construct absolute URL
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  
  if (process.env.NEXTAUTH_URL) {
    return process.env.NEXTAUTH_URL;
  }
  
  // Fallback for local development
  return 'http://localhost:3000';
}

/**
 * Fetch API endpoint with proper URL construction.
 * Uses relative URLs in browser, absolute URLs on server.
 */
async function apiFetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
  // Construct full URL only when needed (lazy evaluation)
  const baseUrl = getBaseUrl();
  const fullUrl = baseUrl ? `${baseUrl}${endpoint}` : endpoint;
  
  const response = await fetch(fullUrl, {
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

  // Updated to return FunnelMetricsWithGoals
  getFunnelMetrics: (filters: DashboardFilters) =>
    apiFetch<FunnelMetricsWithGoals>('/api/dashboard/funnel-metrics', {
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

  // Updated to return ChannelPerformanceWithGoals[]
  getChannelPerformance: (filters: DashboardFilters) =>
    apiFetch<{ channels: ChannelPerformanceWithGoals[] }>('/api/dashboard/source-performance', {
      method: 'POST',
      body: JSON.stringify({ filters, groupBy: 'channel' }),
    }),

  // Updated to return SourcePerformanceWithGoals[]
  getSourcePerformance: (filters: DashboardFilters) =>
    apiFetch<{ sources: SourcePerformanceWithGoals[] }>('/api/dashboard/source-performance', {
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
