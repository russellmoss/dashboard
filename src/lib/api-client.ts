import { DashboardFilters, FilterOptions, DEFAULT_ADVANCED_FILTERS } from '@/types/filters';
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
  DataFreshness,
  OpenPipelineSummary,
  SgmOption
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
  SQODetail,
  LeaderboardEntry,
  AdminQuarterlyProgress
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
import {
  LevelsApiResponse,
  GameDataApiResponse,
  LeaderboardApiResponse,
  SubmitScoreRequest,
  SubmitScoreResponse,
} from '@/types/game';

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
 * Safely create a clean copy of filters object, removing any non-serializable properties
 * (like React elements, DOM nodes, or circular references)
 */
function cleanFilters(filters: DashboardFilters): DashboardFilters {
  // Create a clean copy with only serializable properties
  const clean: DashboardFilters = {
    startDate: filters.startDate,
    endDate: filters.endDate,
    datePreset: filters.datePreset,
    year: filters.year,
    channel: filters.channel,
    source: filters.source,
    sga: filters.sga,
    sgm: filters.sgm,
    stage: filters.stage,
    experimentationTag: filters.experimentationTag,
    metricFilter: filters.metricFilter,
  };
  
  // Safely merge advancedFilters with defaults to ensure all nested properties exist
  if (filters.advancedFilters) {
    clean.advancedFilters = {
      initialCallScheduled: {
        ...DEFAULT_ADVANCED_FILTERS.initialCallScheduled,
        ...(filters.advancedFilters.initialCallScheduled || {}),
      },
      qualificationCallDate: {
        ...DEFAULT_ADVANCED_FILTERS.qualificationCallDate,
        ...(filters.advancedFilters.qualificationCallDate || {}),
      },
      channels: {
        ...DEFAULT_ADVANCED_FILTERS.channels,
        ...(filters.advancedFilters.channels || {}),
      },
      sources: {
        ...DEFAULT_ADVANCED_FILTERS.sources,
        ...(filters.advancedFilters.sources || {}),
      },
      sgas: {
        ...DEFAULT_ADVANCED_FILTERS.sgas,
        ...(filters.advancedFilters.sgas || {}),
      },
      sgms: {
        ...DEFAULT_ADVANCED_FILTERS.sgms,
        ...(filters.advancedFilters.sgms || {}),
      },
      experimentationTags: {
        ...DEFAULT_ADVANCED_FILTERS.experimentationTags,
        ...(filters.advancedFilters.experimentationTags || {}),
      },
    };
  }
  
  return clean;
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
    credentials: 'include', // Include cookies for NextAuth session
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
      body: JSON.stringify({ filters: cleanFilters(filters), ...(viewMode && { viewMode }) }),
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
        filters: cleanFilters(filters), 
        includeTrends: options?.includeTrends ?? false,
        granularity: options?.granularity ?? 'quarter',
        mode: options?.mode ?? 'cohort',
      }),
    }),

  // Updated to return ChannelPerformanceWithGoals[] and accept optional viewMode
  getChannelPerformance: (filters: DashboardFilters, viewMode?: ViewMode) =>
    apiFetch<{ channels: ChannelPerformanceWithGoals[] }>('/api/dashboard/source-performance', {
      method: 'POST',
      body: JSON.stringify({ filters: cleanFilters(filters), groupBy: 'channel', ...(viewMode && { viewMode }) }),
    }),

  // Updated to return SourcePerformanceWithGoals[] and accept optional viewMode
  getSourcePerformance: (filters: DashboardFilters, viewMode?: ViewMode) =>
    apiFetch<{ sources: SourcePerformanceWithGoals[] }>('/api/dashboard/source-performance', {
      method: 'POST',
      body: JSON.stringify({ filters: cleanFilters(filters), groupBy: 'source', ...(viewMode && { viewMode }) }),
    }),

  getDetailRecords: (filters: DashboardFilters, limit = 50000) =>
    apiFetch<{ records: DetailRecord[] }>('/api/dashboard/detail-records', {
      method: 'POST',
      body: JSON.stringify({ filters: cleanFilters(filters), limit }),
    }),

  // Get single record detail by ID (GET method, not POST)
  getRecordDetail: (id: string) =>
    apiFetch<{ record: RecordDetailFull | null }>(`/api/dashboard/record-detail/${encodeURIComponent(id)}`, {
      method: 'GET',
    }).then(data => data.record || null),

  getOpenPipeline: (filters?: Partial<DashboardFilters>) =>
    apiFetch<{ records: DetailRecord[]; summary: any }>('/api/dashboard/open-pipeline', {
      method: 'POST',
      body: JSON.stringify(filters ? cleanFilters(filters as DashboardFilters) : {}),
    }),

  getDataFreshness: () => apiFetch<DataFreshness>('/api/dashboard/data-freshness'),

  /**
   * Get SGM options for pipeline page filter
   */
  getPipelineSgmOptions: async (): Promise<{ sgmOptions: SgmOption[] }> => {
    const response = await fetch('/api/dashboard/pipeline-sgm-options', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to fetch SGM options');
    }
    
    return response.json();
  },

  /**
   * Get open pipeline summary with by-stage breakdown
   */
  getPipelineSummary: async (stages?: string[], sgms?: string[]): Promise<OpenPipelineSummary> => {
    const response = await fetch('/api/dashboard/pipeline-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stages, sgms }),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to fetch pipeline summary');
    }
    
    return response.json();
  },

  /**
   * Get pipeline records for a specific stage (drill-down)
   */
  getPipelineDrilldown: async (
    stage: string,
    filters?: { channel?: string; source?: string; sga?: string; sgm?: string },
    sgms?: string[]
  ): Promise<{ records: DetailRecord[]; stage: string }> => {
    // Clean filters to remove any non-serializable properties
    const cleanFiltersObj = filters ? {
      channel: filters.channel,
      source: filters.source,
      sga: filters.sga,
      sgm: filters.sgm,
    } : undefined;
    const response = await fetch('/api/dashboard/pipeline-drilldown', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage, filters: cleanFiltersObj, sgms }),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to fetch pipeline drilldown');
    }
    
    return response.json();
  },

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

  getClosedLostRecords: (timeBuckets?: ClosedLostTimeBucket[], userEmail?: string, showAll?: boolean) => {
    const params = new URLSearchParams();
    if (timeBuckets && timeBuckets.length > 0) {
      params.append('timeBuckets', timeBuckets.join(','));
    }
    if (userEmail) {
      params.append('userEmail', userEmail);
    }
    if (showAll) {
      params.append('showAll', 'true');
    }
    return apiFetch<{ records: ClosedLostRecord[] }>(`/api/sga-hub/closed-lost?${params.toString()}`);
  },

  getReEngagementOpportunities: (showAll?: boolean) => {
    const params = new URLSearchParams();
    if (showAll) {
      params.set('showAll', 'true');
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

  getManagerQuarterlyGoal: (quarter: string) =>
    apiFetch<{ goal: number | null }>(
      `/api/sga-hub/manager-quarterly-goal?${new URLSearchParams({ quarter }).toString()}`
    ),

  setManagerQuarterlyGoal: (quarter: string, sqoGoal: number) =>
    apiFetch<{ goal: number; message: string }>(
      '/api/sga-hub/manager-quarterly-goal',
      {
        method: 'POST',
        body: JSON.stringify({ quarter, sqoGoal }),
      }
    ),

  getAdminQuarterlyProgress: (params: {
    year: number;
    quarter: number;
    sgaNames?: string[];
    channels?: string[];
    sources?: string[];
  }) => {
    const searchParams = new URLSearchParams({
      year: params.year.toString(),
      quarter: params.quarter.toString(),
    });
    
    if (params.sgaNames && params.sgaNames.length > 0) {
      params.sgaNames.forEach(sga => searchParams.append('sgaNames', sga));
    }
    if (params.channels && params.channels.length > 0) {
      params.channels.forEach(ch => searchParams.append('channels', ch));
    }
    if (params.sources && params.sources.length > 0) {
      params.sources.forEach(src => searchParams.append('sources', src));
    }
    
    return apiFetch<AdminQuarterlyProgress>(
      `/api/sga-hub/admin-quarterly-progress?${searchParams.toString()}`
    );
  },

  getSGAQuarterlyGoals: (year: number, quarter: number, sgaNames?: string[]) => {
    const params = new URLSearchParams({
      year: year.toString(),
      quarter: quarter.toString(),
    });
    
    if (sgaNames && sgaNames.length > 0) {
      sgaNames.forEach(sga => params.append('sgaNames', sga));
    }
    
    return apiFetch<{ goals: Record<string, number | null> }>(
      `/api/sga-hub/quarterly-goals?${params.toString()}`
    );
  },

  getSGALeaderboard: (filters: {
    startDate: string;
    endDate: string;
    channels: string[];
    sources?: string[];
    sgaNames?: string[];
  }) =>
    apiFetch<{ entries: LeaderboardEntry[] }>('/api/sga-hub/leaderboard', {
      method: 'POST',
      body: JSON.stringify(filters),
    }),

  getLeaderboardSGAOptions: () =>
    apiFetch<{ sgaOptions: Array<{ value: string; label: string; isActive: boolean }> }>(
      '/api/sga-hub/leaderboard-sga-options'
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
    sgaName: string | null,
    options: { weekStartDate?: string; weekEndDate?: string; quarter?: string },
    userEmail?: string,
    channels?: string[],
    sources?: string[],
    teamLevel?: boolean
  ) => {
    const params = new URLSearchParams({
      ...(options.weekStartDate && { weekStartDate: options.weekStartDate }),
      ...(options.weekEndDate && { weekEndDate: options.weekEndDate }),
      ...(options.quarter && { quarter: options.quarter }),
      ...(userEmail && { userEmail }),
    });
    
    // Add sgaName only if not team-level, otherwise add teamLevel flag
    if (teamLevel) {
      params.append('teamLevel', 'true');
    } else if (sgaName !== null) {
      params.append('sgaName', sgaName);
    }
    
    // Add array parameters (channels and sources)
    if (channels && channels.length > 0) {
      channels.forEach(channel => params.append('channels', channel));
    }
    if (sources && sources.length > 0) {
      sources.forEach(source => params.append('sources', source));
    }
    
    return apiFetch<{ records: SQODrillDownRecord[] }>(
      `/api/sga-hub/drill-down/sqos?${params.toString()}`
    );
  },

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
      let errorData;
      try {
        const text = await response.text();
        errorData = text ? JSON.parse(text) : {};
      } catch (parseError) {
        errorData = { 
          error: { 
            code: 'PARSE_ERROR', 
            message: `Query failed with status ${response.status}. Failed to parse error response.` 
          } 
        };
      }
      console.error('[agentApi] Error response:', errorData);
      
      // Handle different error response formats
      const errorMessage = 
        errorData.error?.message || 
        errorData.error?.code || 
        errorData.error || 
        `Query failed with status ${response.status}`;
      
      throw new Error(errorMessage);
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

/**
 * Pipeline Catcher Game API client
 */
export const pipelineCatcherApi = {
  getLevels: () => apiFetch<LevelsApiResponse>('/api/games/pipeline-catcher/levels'),
  
  getGameData: (quarter: string) => 
    apiFetch<GameDataApiResponse>(`/api/games/pipeline-catcher/play/${encodeURIComponent(quarter)}`),
  
  getLeaderboard: (quarter: string) => 
    apiFetch<LeaderboardApiResponse>(`/api/games/pipeline-catcher/leaderboard?quarter=${encodeURIComponent(quarter)}`),
  
  submitScore: (data: SubmitScoreRequest) => 
    apiFetch<SubmitScoreResponse>('/api/games/pipeline-catcher/leaderboard', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateScoreMessage: (scoreId: string, message: string) =>
    apiFetch<{ success: boolean }>('/api/games/pipeline-catcher/leaderboard', {
      method: 'PATCH',
      body: JSON.stringify({ scoreId, message }),
    }),
};

/**
 * Recruiter Hub API client
 */
export const recruiterHubApi = {
  getExternalAgencies: () =>
    apiFetch<{ agencies: string[] }>('/api/recruiter-hub/external-agencies'),

  getProspects: (filters: {
    stages?: string[];
    openOnly?: boolean;
    externalAgencies?: string[];
  }) =>
    apiFetch<{ records: unknown[]; count: number }>(
      '/api/recruiter-hub/prospects',
      {
        method: 'POST',
        body: JSON.stringify(filters),
      }
    ),

  getOpportunities: (filters: {
    stages?: string[];
    sgms?: string[];
    openOnly?: boolean;
    externalAgencies?: string[];
  }) =>
    apiFetch<{ records: unknown[]; count: number }>(
      '/api/recruiter-hub/opportunities',
      {
        method: 'POST',
        body: JSON.stringify(filters),
      }
    ),

  getSgmOptions: () =>
    apiFetch<{ sgms: string[] }>('/api/recruiter-hub/opportunities'),
};

export function handleApiError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Please sign in to continue';
    if (error.status === 403) return 'You do not have permission';
    return error.message;
  }
  return 'An unexpected error occurred';
}
