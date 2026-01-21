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
  ViewMode,
  DataFreshness
} from '@/types/dashboard';
import { RecordDetailFull } from '@/types/record-detail';
import { 
  WeeklyGoal, 
  WeeklyGoalInput, 
  WeeklyActual, 
  QuarterlyGoal, 
  QuarterlyGoalInput,
  ClosedLostRecord,
  ClosedLostTimeBucket,
  ReEngagementOpportunity,
  QuarterlyProgress,
  SQODetail
} from '@/types/sga-hub';
import { 
  InitialCallRecord, 
  QualificationCallRecord, 
  SQODrillDownRecord 
} from '@/types/drill-down';
import type { AgentRequest, AgentResponse, StreamChunk } from '@/types/agent';
import {
  SavedReport,
  SavedReportInput,
} from '@/types/saved-reports';

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

  // Get single record detail by ID (GET method, not POST)
  getRecordDetail: (id: string) =>
    apiFetch<{ record: RecordDetailFull | null }>(`/api/dashboard/record-detail/${encodeURIComponent(id)}`, {
      method: 'GET',
    }).then(data => data.record || null),

  getOpenPipeline: (filters?: Partial<DashboardFilters>) =>
    apiFetch<{ records: DetailRecord[]; summary: any }>('/api/dashboard/open-pipeline', {
      method: 'POST',
      body: JSON.stringify(filters ?? {}),
    }),

  getDataFreshness: () => apiFetch<DataFreshness>('/api/dashboard/data-freshness'),

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

  // SGA Hub API functions
  getWeeklyGoals: (startDate?: string, endDate?: string, userEmail?: string) =>
    apiFetch<{ goals: WeeklyGoal[] }>(`/api/sga-hub/weekly-goals?${new URLSearchParams({ 
      ...(startDate && { startDate }), 
      ...(endDate && { endDate }),
      ...(userEmail && { userEmail })
    }).toString()}`),

  saveWeeklyGoal: (goal: WeeklyGoalInput, userEmail?: string) =>
    apiFetch<{ goal: WeeklyGoal }>('/api/sga-hub/weekly-goals', {
      method: 'POST',
      body: JSON.stringify({ ...goal, ...(userEmail && { userEmail }) }),
    }),

  getWeeklyActuals: (startDate?: string, endDate?: string, userEmail?: string) =>
    apiFetch<{ actuals: WeeklyActual[]; sgaName?: string; startDate: string; endDate: string }>(
      `/api/sga-hub/weekly-actuals?${new URLSearchParams({ 
        ...(startDate && { startDate }), 
        ...(endDate && { endDate }),
        ...(userEmail && { userEmail })
      }).toString()}`
    ),

  getQuarterlyGoals: (quarter?: string, userEmail?: string) =>
    apiFetch<{ goals: QuarterlyGoal[]; quarter?: string }>(
      `/api/sga-hub/quarterly-goals?${new URLSearchParams({ 
        ...(quarter && { quarter }), 
        ...(userEmail && { userEmail })
      }).toString()}`
    ),

  saveQuarterlyGoal: (input: QuarterlyGoalInput) =>
    apiFetch<{ goal: QuarterlyGoal }>('/api/sga-hub/quarterly-goals', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  getClosedLostRecords: (timeBuckets?: ClosedLostTimeBucket[], userEmail?: string) => {
    const params = new URLSearchParams();
    if (timeBuckets && timeBuckets.length > 0) {
      params.append('timeBuckets', timeBuckets.join(','));
    }
    if (userEmail) {
      params.append('userEmail', userEmail);
    }
    return apiFetch<{ records: ClosedLostRecord[] }>(`/api/sga-hub/closed-lost?${params.toString()}`);
  },

  getReEngagementOpportunities: (userEmail?: string) => {
    const params = new URLSearchParams();
    if (userEmail) {
      params.append('userEmail', userEmail);
    }
    return apiFetch<{ opportunities: ReEngagementOpportunity[] }>(`/api/sga-hub/re-engagement?${params.toString()}`);
  },

  getQuarterlyProgress: (quarter?: string) =>
    apiFetch<QuarterlyProgress>(
      `/api/sga-hub/quarterly-progress?${new URLSearchParams({ 
        ...(quarter && { quarter })
      }).toString()}`
    ),

  getSQODetails: (quarter: string) =>
    apiFetch<{ sqos: SQODetail[] }>(
      `/api/sga-hub/sqo-details?${new URLSearchParams({ quarter }).toString()}`
    ),

  // Drill-down functions
  getInitialCallsDrillDown: (
    sgaName: string,
    weekStartDate: string,
    weekEndDate: string,
    userEmail?: string
  ) =>
    apiFetch<{ records: InitialCallRecord[] }>(
      `/api/sga-hub/drill-down/initial-calls?${new URLSearchParams({
        weekStartDate,
        weekEndDate,
        ...(userEmail && { userEmail }),
      }).toString()}`
    ),

  getQualificationCallsDrillDown: (
    sgaName: string,
    weekStartDate: string,
    weekEndDate: string,
    userEmail?: string
  ) =>
    apiFetch<{ records: QualificationCallRecord[] }>(
      `/api/sga-hub/drill-down/qualification-calls?${new URLSearchParams({
        weekStartDate,
        weekEndDate,
        ...(userEmail && { userEmail }),
      }).toString()}`
    ),

  getSQODrillDown: (
    sgaName: string,
    options: { weekStartDate?: string; weekEndDate?: string; quarter?: string },
    userEmail?: string
  ) =>
    apiFetch<{ records: SQODrillDownRecord[] }>(
      `/api/sga-hub/drill-down/sqos?${new URLSearchParams({
        ...(options.weekStartDate && { weekStartDate: options.weekStartDate }),
        ...(options.weekEndDate && { weekEndDate: options.weekEndDate }),
        ...(options.quarter && { quarter: options.quarter }),
        ...(userEmail && { userEmail }),
      }).toString()}`
    ),

  refreshCache: () =>
    apiFetch<{ success: boolean; message: string; tags: string[] }>(
      '/api/admin/refresh-cache',
      { method: 'POST' }
    ),

  // Saved Reports API functions
  getSavedReports: () =>
    apiFetch<{ userReports: SavedReport[]; adminTemplates: SavedReport[] }>('/api/saved-reports'),

  getSavedReport: (id: string) =>
    apiFetch<{ report: SavedReport }>(`/api/saved-reports/${encodeURIComponent(id)}`)
      .then(data => data.report),

  createSavedReport: (input: SavedReportInput) =>
    apiFetch<{ report: SavedReport }>('/api/saved-reports', {
      method: 'POST',
      body: JSON.stringify(input),
    }).then(data => data.report),

  updateSavedReport: (id: string, input: Partial<SavedReportInput>) =>
    apiFetch<{ report: SavedReport }>(`/api/saved-reports/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }).then(data => data.report),

  deleteSavedReport: (id: string) =>
    apiFetch<{ success: boolean }>(`/api/saved-reports/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  setDefaultReport: (id: string) =>
    apiFetch<{ report: SavedReport }>(`/api/saved-reports/${encodeURIComponent(id)}/set-default`, {
      method: 'POST',
    }).then(data => data.report),

  duplicateSavedReport: (id: string, newName?: string) =>
    apiFetch<{ report: SavedReport }>(`/api/saved-reports/${encodeURIComponent(id)}/duplicate`, {
      method: 'POST',
      body: JSON.stringify({ name: newName }),
    }).then(data => data.report),

  getDefaultReport: () =>
    apiFetch<{ report: SavedReport | null }>('/api/saved-reports/default')
      .then(data => data.report),

  /**
   * Trigger a manual data transfer (admin/manager only)
   */
  async triggerDataTransfer(): Promise<{
    success: boolean;
    runId?: string;
    message: string;
    estimatedDuration?: string;
    cooldownMinutes?: number;
  }> {
    return apiFetch<{
      success: boolean;
      runId?: string;
      message: string;
      estimatedDuration?: string;
      cooldownMinutes?: number;
    }>('/api/admin/trigger-transfer', {
      method: 'POST',
    });
  },

  /**
   * Check the status of a transfer run
   */
  async getTransferStatus(runId: string): Promise<{
    runId: string;
    state: string;
    isComplete: boolean;
    success: boolean;
    errorMessage?: string;
    cacheInvalidated?: boolean;
  }> {
    return apiFetch<{
      runId: string;
      state: string;
      isComplete: boolean;
      success: boolean;
      errorMessage?: string;
      cacheInvalidated?: boolean;
    }>(`/api/admin/trigger-transfer?runId=${encodeURIComponent(runId)}`);
  },

  /**
   * Check cooldown status
   */
  async getTransferCooldownStatus(): Promise<{
    cooldown: boolean;
    cooldownMinutes: number;
  }> {
    return apiFetch<{
      cooldown: boolean;
      cooldownMinutes: number;
    }>('/api/admin/trigger-transfer');
  },
};

/**
 * Agent API client for self-serve analytics
 */
export const agentApi = {
  /**
   * Submit a question and get results (non-streaming)
   */
  async query(request: AgentRequest): Promise<AgentResponse> {
    console.log('[agentApi] Making request to /api/agent/query', request);
    
    const response = await fetch('/api/agent/query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    console.log('[agentApi] Response status:', response.status, response.statusText);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to parse error response' }));
      console.error('[agentApi] Error response:', error);
      throw new Error(error.error?.message || error.error || `Query failed with status ${response.status}`);
    }

    const result = await response.json();
    console.log('[agentApi] Success response:', result);
    return result;
  },

  /**
   * Submit a question with streaming progress updates (SSE)
   * Returns an async generator that yields StreamChunk objects
   */
  async *queryStream(request: AgentRequest): AsyncGenerator<StreamChunk> {
    const response = await fetch('/api/agent/query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || error.error || 'Query failed');
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          try {
            yield JSON.parse(data) as StreamChunk;
          } catch {
            console.warn('Failed to parse SSE chunk:', data);
          }
        }
      }
    }
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
