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
  TrendDataPoint,
  ViewMode
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
 * 
 * IMPORTANT: Never returns empty string on server-side to avoid "Invalid URL" errors.
 */
function getBaseUrl(): string {
  // Client-side: use relative URLs (works with Next.js routing)
  if (typeof window !== 'undefined') {
    return '';
  }
  
  // Server-side (including build time): always return a valid URL
  // During build, environment variables might not be set, so use fallback
  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) {
    return `https://${vercelUrl}`;
  }
  
  const nextAuthUrl = process.env.NEXTAUTH_URL;
  if (nextAuthUrl && nextAuthUrl.trim() !== '') {
    return nextAuthUrl;
  }
  
  // Fallback: use localhost for build time (Next.js will handle this)
  // This prevents "Invalid URL" errors during static generation
  return 'http://localhost:3000';
}

/**
 * Fetch API endpoint with proper URL construction.
 * Uses relative URLs in browser, absolute URLs on server.
 * 
 * IMPORTANT: This function should only be called at runtime, not during build.
 */
async function apiFetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
  // During build/static generation, use relative URLs to avoid URL construction errors
  // At runtime, construct proper URLs
  let fullUrl: string;
  
  if (typeof window !== 'undefined') {
    // Browser: always use relative URLs
    fullUrl = endpoint;
  } else {
    // Server-side: construct absolute URL only if we have a valid base URL
    const baseUrl = getBaseUrl();
    fullUrl = baseUrl && baseUrl.trim() !== '' ? `${baseUrl}${endpoint}` : endpoint;
  }
  
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

  // Updated to return FunnelMetricsWithGoals and accept optional viewMode
  getFunnelMetrics: (filters: DashboardFilters, viewMode?: ViewMode) =>
    apiFetch<FunnelMetricsWithGoals>('/api/dashboard/funnel-metrics', {
      method: 'POST',
      body: JSON.stringify({ filters, ...(viewMode && { viewMode }) }),
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
        mode: options?.mode ?? 'cohort',
      }),
    }),

  // Updated to return ChannelPerformanceWithGoals[] and accept optional viewMode
  getChannelPerformance: (filters: DashboardFilters, viewMode?: ViewMode) =>
    apiFetch<{ channels: ChannelPerformanceWithGoals[] }>('/api/dashboard/source-performance', {
      method: 'POST',
      body: JSON.stringify({ filters, groupBy: 'channel', ...(viewMode && { viewMode }) }),
    }),

  // Updated to return SourcePerformanceWithGoals[] and accept optional viewMode
  getSourcePerformance: (filters: DashboardFilters, viewMode?: ViewMode) =>
    apiFetch<{ sources: SourcePerformanceWithGoals[] }>('/api/dashboard/source-performance', {
      method: 'POST',
      body: JSON.stringify({ filters, groupBy: 'source', ...(viewMode && { viewMode }) }),
    }),

  getDetailRecords: (filters: DashboardFilters, limit = 50000) =>
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
