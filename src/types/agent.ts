// src/types/agent.ts
// =============================================================================
// AGENT TYPES
// Type definitions for the self-serve analytics agent
// =============================================================================

import type { SEMANTIC_LAYER } from '@/lib/semantic-layer/definitions';

/**
 * Visualization types supported by the agent
 */
export type VisualizationType = 
  | 'metric'      // Single number display
  | 'bar'         // Bar chart
  | 'line'        // Line chart
  | 'table'       // Data table
  | 'funnel'      // Funnel visualization
  | 'comparison'; // Period comparison

/**
 * Date range specification
 */
export interface DateRangeParams {
  preset?: string;      // e.g., 'this_quarter', 'ytd'
  startDate?: string;   // ISO date string for custom range
  endDate?: string;     // ISO date string for custom range
}

/**
 * Dimension filter specification
 */
export interface DimensionFilter {
  dimension: string;    // e.g., 'channel', 'source', 'sga'
  operator: 'equals' | 'in' | 'not_equals' | 'not_in';
  value: string | string[];
}

/**
 * Template selection - what Claude returns after parsing a question
 */
export interface TemplateSelection {
  templateId: string;
  parameters: {
    metric?: string;
    metrics?: string[];
    dimension?: string;
    conversionMetric?: string;
    dateRange?: DateRangeParams;  // Optional for period_comparison, open_pipeline_list, etc.
    filters?: DimensionFilter[];
    limit?: number;
    sortDirection?: 'ASC' | 'DESC';
    timePeriod?: 'day' | 'week' | 'month' | 'quarter' | 'year';
    includeRollingAverage?: boolean;
    rollingAverageWindow?: number;
    ageThreshold?: number;
    ageMethod?: 'from_creation' | 'from_stage_entry';
    stageFilter?: string;
    // Period comparison parameters
    // Can be preset strings (e.g., 'this_quarter') or DateRangeParams objects (for custom ranges like Q4 2025)
    currentPeriod?: string | DateRangeParams;  // e.g., 'this_quarter' or { preset: 'custom', startDate: '2025-10-01', endDate: '2025-12-31' }
    previousPeriod?: string | DateRangeParams; // e.g., 'last_quarter' or { preset: 'custom', startDate: '2025-04-01', endDate: '2025-06-30' }
    // SGA summary parameter
    sga?: string;
    // Time to convert and multi-stage conversion parameters
    startStage?: string;
    endStage?: string;
    statistic?: 'avg' | 'median' | 'min' | 'max' | 'p25' | 'p75' | 'p90';
  };
  confidence: number;   // 0-1 confidence in template selection
  explanation: string;  // Why this template was chosen
  preferredVisualization?: VisualizationType;  // Claude can override template default
  visualizationReasoning?: string;              // Explanation for visualization choice
}

/**
 * Request from frontend to agent API
 */
export interface AgentRequest {
  question: string;
  conversationHistory?: ConversationMessage[];
  userContext?: {
    sgaFilter?: string;   // If user is an SGA, pre-filter to their data
    sgmFilter?: string;   // If user is an SGM, pre-filter to their team
  };
}

/**
 * Message in conversation history
 */
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  queryResult?: QueryResultData;
}

/**
 * Compiled query ready for BigQuery execution
 */
export interface CompiledQuery {
  sql: string;
  params: Record<string, unknown>;
  templateId: string;
  visualization: VisualizationType;
  metadata: {
    metric?: string;
    dimension?: string;
    dateRange: {
      start: string;
      end: string;
    };
    visualizationOverridden?: boolean; // Added
    visualizationReason?: string;       // Added
  };
}

/**
 * Query result data structure
 */
export interface QueryResultData {
  rows: Record<string, unknown>[];
  columns: {
    name: string;
    displayName: string;
    type: string;
  }[];
  metadata: {
    rowCount: number;
    executionTimeMs: number;
    fromCache: boolean;
  };
}

/**
 * Complete agent response
 */
export interface AgentResponse {
  success: boolean;
  templateSelection?: TemplateSelection;
  compiledQuery?: CompiledQuery;
  result?: QueryResultData;
  visualization: VisualizationType;
  visualizationOverridden: boolean;  // True if Claude chose different from template default
  visualizationReason?: string;       // Why this visualization was chosen
  error?: {
    code: string;
    message: string;
    suggestion?: string;
  };
  followUpSuggestions?: string[];
}

/**
 * Streaming chunk types
 */
export type StreamChunk = 
  | { type: 'thinking'; content: string }
  | { type: 'template_selected'; data: TemplateSelection }
  | { type: 'query_compiled'; data: { sql: string; params: Record<string, unknown> } }
  | { type: 'executing' }
  | { type: 'result'; data: QueryResultData }
  | { type: 'complete'; data: AgentResponse }
  | { type: 'error'; data: { code: string; message: string } };

/**
 * Export type helpers
 */
export type MetricName = keyof typeof SEMANTIC_LAYER.volumeMetrics | 
                         keyof typeof SEMANTIC_LAYER.aumMetrics;
export type DimensionName = keyof typeof SEMANTIC_LAYER.dimensions;
export type ConversionMetricName = keyof typeof SEMANTIC_LAYER.conversionMetrics;
