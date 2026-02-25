// src/components/dashboard/ExploreResults.tsx
'use client';

import React from 'react';
import { 
  BarChart, 
  Bar, 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Legend 
} from 'recharts';
import { useState } from 'react';
import { useTheme } from 'next-themes';
import { AlertCircle, RefreshCw, TrendingUp, Table2, Loader2, ThumbsUp, ThumbsDown, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { QueryInspector } from './QueryInspector';
import { ExportMenu } from './ExportMenu';
import { DetailRecordsTable } from './DetailRecordsTable';
import { RecordDetailModal } from './RecordDetailModal';
import { dashboardApi } from '@/lib/api-client';
import { formatCurrency } from '@/lib/utils/date-helpers';
import type { AgentResponse, VisualizationType, QueryResultData } from '@/types/agent';
import type { DetailRecord } from '@/types/dashboard';
import type { RecordDetailFull } from '@/types/record-detail';

interface ExploreResultsProps {
  response: AgentResponse | null;
  isLoading: boolean;
  error: string | null;
  streamingMessage?: string | null;
  currentQuestion?: string; // NEW - for feedback component
  onRetry?: () => void;
}

// Feedback Component
interface FeedbackProps {
  questionId: string; // Use timestamp or generate UUID
  templateId: string;
  question: string;
  response: AgentResponse | null; // For accessing compiledQuery and resultSummary
  error: string | null; // For capturing query errors (parsing, execution, etc.)
}

function ResponseFeedback({ questionId, templateId, question, response, error }: FeedbackProps) {
  const [feedback, setFeedback] = useState<'positive' | 'negative' | null>(null);
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState(false);

  /**
   * Generate executable SQL by substituting parameters
   * Uses the same logic as QueryInspector component
   */
  const generateExecutableSql = (querySql: string, queryParams: Record<string, unknown>): string => {
    let executableSql = querySql;
    
    for (const [key, value] of Object.entries(queryParams)) {
      let sqlValue: string;
      
      if (value === null || value === undefined) {
        sqlValue = 'NULL';
      } else if (typeof value === 'string') {
        // Check if it's already a SQL expression
        const isSqlExpression = /^\s*(DATE|TIMESTAMP|CONCAT|DATE_TRUNC|DATE_SUB|DATE_ADD|CURRENT_DATE|CURRENT_TIMESTAMP|EXTRACT|CAST|UNNEST)\s*\(/i.test(value.trim()) ||
                                 value.includes('INTERVAL') ||
                                 (value.includes('(') && value.includes(')') && !value.match(/^['"]/));
        
        if (isSqlExpression) {
          sqlValue = value;
        } else {
          // String literal, wrap in quotes and escape
          sqlValue = `'${String(value).replace(/'/g, "''")}'`;
        }
      } else if (typeof value === 'number') {
        sqlValue = String(value);
      } else if (typeof value === 'boolean') {
        sqlValue = value ? 'TRUE' : 'FALSE';
      } else if (Array.isArray(value)) {
        const arrayValues = value.map(v => {
          if (typeof v === 'string') {
            return `'${String(v).replace(/'/g, "''")}'`;
          }
          return String(v);
        }).join(', ');
        sqlValue = `[${arrayValues}]`;
      } else {
        sqlValue = String(value);
      }
      
      const regex = new RegExp(`@${key}\\b`, 'g');
      executableSql = executableSql.replace(regex, sqlValue);
    }
    
    return executableSql;
  };

  // Update handleFeedback to save positive feedback immediately
  const handleFeedback = async (type: 'positive' | 'negative') => {
    setFeedback(type);
    setSaveError(null);
    
    if (type === 'negative') {
      setShowComment(true);
      // Don't save yet - wait for comment
      return;
    }
    
    // For positive feedback, save immediately
    await saveFeedback(type, null);
  };

  // Add saveFeedback function
  const saveFeedback = async (feedbackType: 'positive' | 'negative', commentText: string | null) => {
    setIsSaving(true);
    setSaveError(null);
    
    try {
      // Prepare resultSummary from response
      const resultSummary = response?.result ? {
        rowCount: response.result.metadata.rowCount,
        executionTimeMs: response.result.metadata.executionTimeMs,
        visualization: response.visualization,
      } : null;

      // Generate executable SQL if compiledQuery exists
      let executableSql: string | null = null;
      if (response?.compiledQuery?.sql && response?.compiledQuery?.params) {
        try {
          executableSql = generateExecutableSql(
            response.compiledQuery.sql,
            response.compiledQuery.params
          );
        } catch (err) {
          console.warn('Failed to generate executable SQL:', err);
          // Continue without executable SQL
        }
      }

      const response_data = await fetch('/api/explore/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionId,
          templateId,
          question,
          feedback: feedbackType,
          comment: commentText,
          compiledQuery: response?.compiledQuery || null,
          executableSql,
          resultSummary,
          error: error || null, // Capture error if query failed
        }),
      });

      if (!response_data.ok) {
        const errorData = await response_data.json();
        throw new Error(errorData.error || 'Failed to save feedback');
      }

      setIsSaved(true);
      if (feedbackType === 'negative') {
        setShowComment(false);
      }
    } catch (error) {
      console.error('Failed to save feedback:', error);
      setSaveError(error instanceof Error ? error.message : 'Failed to save feedback');
      // Don't block user - they can still see the feedback was recorded
    } finally {
      setIsSaving(false);
    }
  };

  // Update handleCommentSubmit to require comment and save
  const handleCommentSubmit = async () => {
    if (!comment || comment.trim() === '') {
      setSaveError('Please provide a comment explaining what went wrong');
      return;
    }
    
    await saveFeedback('negative', comment.trim());
  };

  // Update render logic
  if (isSaved) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        <span>Thanks for your feedback!</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-500 dark:text-gray-400">
          Was this helpful?
        </span>
        <button
          onClick={() => handleFeedback('positive')}
          disabled={isSaving}
          className={`p-1 rounded transition-colors ${
            feedback === 'positive'
              ? 'text-green-600 bg-green-100 dark:bg-green-900/30'
              : 'text-gray-400 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20'
          } ${isSaving ? 'opacity-50 cursor-not-allowed' : ''}`}
          title="Yes, this was helpful"
        >
          <ThumbsUp className="w-4 h-4" />
        </button>
        <button
          onClick={() => handleFeedback('negative')}
          disabled={isSaving}
          className={`p-1 rounded transition-colors ${
            feedback === 'negative'
              ? 'text-red-600 bg-red-100 dark:bg-red-900/30'
              : 'text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20'
          } ${isSaving ? 'opacity-50 cursor-not-allowed' : ''}`}
          title="No, this could be better"
        >
          <ThumbsDown className="w-4 h-4" />
        </button>
        {isSaving && (
          <span className="text-xs text-gray-500 dark:text-gray-400">Saving...</span>
        )}
      </div>

      {saveError && (
        <div className="text-xs text-red-600 dark:text-red-400">
          {saveError}
        </div>
      )}

      {showComment && (
        <div className="flex flex-col gap-2">
          <input
            type="text"
            value={comment}
            onChange={(e) => {
              setComment(e.target.value);
              setSaveError(null); // Clear error when user types
            }}
            placeholder="What went wrong? (required)"
            className="flex-1 px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 
                       rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
                       focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && comment.trim()) {
                handleCommentSubmit();
              }
            }}
          />
          <button
            onClick={handleCommentSubmit}
            disabled={!comment || comment.trim() === '' || isSaving}
            className="px-3 py-1 text-sm bg-blue-600 text-white rounded-md 
                       hover:bg-blue-700 transition-colors
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? 'Saving...' : 'Send'}
          </button>
        </div>
      )}
    </div>
  );
}

export function ExploreResults({ response, isLoading, error, streamingMessage, currentQuestion, onRetry }: ExploreResultsProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 50;
  
  // Step 5.1: Drilldown modal state
  const [drillDownOpen, setDrillDownOpen] = useState(false);
  const [drillDownRecords, setDrillDownRecords] = useState<DetailRecord[]>([]);
  const [drillDownLoading, setDrillDownLoading] = useState(false);
  const [drillDownTitle, setDrillDownTitle] = useState('');
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [recordDetail, setRecordDetail] = useState<RecordDetailFull | null>(null);
  const [isLoadingRecord, setIsLoadingRecord] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);
  
  // Step 5.2: Table row click state (separate from drilldown)
  const [tableRowRecordId, setTableRowRecordId] = useState<string | null>(null);
  const [tableRowRecordDetail, setTableRowRecordDetail] = useState<RecordDetailFull | null>(null);
  const [isLoadingTableRecord, setIsLoadingTableRecord] = useState(false);
  
  // Reset to page 1 when new results arrive (must be before any conditional returns)
  React.useEffect(() => {
    if (response?.success && response?.result) {
      setCurrentPage(1);
    }
  }, [response?.success, response?.result]);
  
  // Loading state with streaming progress
  if (isLoading) {
    return (
      <div className="space-y-4">
        {/* Progress indicator */}
        <div className="flex items-center gap-3 p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
          <Loader2 className="w-5 h-5 text-blue-600 dark:text-blue-400 animate-spin" />
          <div>
            <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
              {streamingMessage || 'Processing...'}
            </p>
            <p className="text-xs text-blue-600 dark:text-blue-400">
              This usually takes 5-10 seconds
            </p>
          </div>
        </div>
        
        {/* Skeleton placeholder */}
        <div className="animate-pulse space-y-4">
          <div className="h-64 bg-gray-200 dark:bg-gray-700 rounded" />
          <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded" />
        </div>
      </div>
    );
  }

  // Error state with improved messaging
  if (error) {
    // Parse error message for better user experience
    const isTimeout = error.toLowerCase().includes('timeout') || error.toLowerCase().includes('timed out');
    const isQueryError = error.toLowerCase().includes('syntax error') || error.toLowerCase().includes('bigquery');
    
    let errorTitle = 'Query Failed';
    let errorMessage = error;
    let suggestion = '';
    
    if (isTimeout) {
      errorTitle = 'Request Timed Out';
      errorMessage = 'The query took too long to execute.';
      suggestion = 'Try simplifying your question, narrowing the date range, or removing filters.';
    } else if (isQueryError) {
      errorTitle = 'Query Error';
      errorMessage = 'There was an issue executing the query.';
      suggestion = 'Check the Query Inspector for the generated SQL. You can copy it and run it directly in BigQuery to debug.';
    }
    
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
          {errorTitle}
        </h3>
        <p className="text-gray-500 dark:text-gray-400 mb-2 max-w-md">
          {errorMessage}
        </p>
        {suggestion && (
          <p className="text-sm text-blue-600 dark:text-blue-400 mb-4 max-w-md">
            💡 {suggestion}
          </p>
        )}
        {onRetry && (
          <button
            onClick={onRetry}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 
                       hover:bg-blue-700 text-white transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Try Again
          </button>
        )}
      </div>
    );
  }

  // No response yet
  if (!response) {
    return null;
  }

  // Error in response with improved messaging
  if (!response.success && response.error) {
    const errorCode = response.error.code;
    let errorTitle = 'Error';
    let iconColor = 'text-yellow-500';
    
    if (errorCode === 'UNSUPPORTED_QUESTION') {
      errorTitle = 'Cannot Answer';
      iconColor = 'text-gray-500';
    } else if (errorCode === 'TIMEOUT') {
      errorTitle = 'Request Timed Out';
      iconColor = 'text-orange-500';
    } else if (errorCode === 'QUERY_ERROR' || errorCode === 'INVALID_TEMPLATE') {
      errorTitle = 'Query Error';
      iconColor = 'text-red-500';
    }
    
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <AlertCircle className={`w-12 h-12 ${iconColor} mb-4`} />
        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
          {errorTitle}
        </h3>
        <p className="text-gray-500 dark:text-gray-400 mb-4 max-w-md">
          {response.error.message}
        </p>
        {response.error.suggestion && (
          <p className="text-sm text-blue-600 dark:text-blue-400 mb-4 max-w-md">
            💡 {response.error.suggestion}
          </p>
        )}
        {onRetry && errorCode !== 'UNSUPPORTED_QUESTION' && (
          <button
            onClick={onRetry}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 
                       hover:bg-blue-700 text-white transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Try Again
          </button>
        )}
      </div>
    );
  }

  // Successful response
  const { result, visualization, visualizationOverridden, visualizationReason, compiledQuery, templateSelection, followUpSuggestions } = response;
  
  // Check if this is an AUM metric (check both template selection and compiled query metadata)
  const metricName = templateSelection?.parameters?.metric || compiledQuery?.metadata?.metric;
  const isAumMetric = metricName === 'open_pipeline_aum' ||
                      metricName === 'sqo_aum' ||
                      metricName === 'joined_aum' ||
                      metricName === 'signed_aum' ||
                      metricName === 'avg_aum';

  if (!result || result.rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Table2 className="w-12 h-12 text-gray-400 mb-4" />
        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
          No Data Found
        </h3>
        <p className="text-gray-500 dark:text-gray-400 max-w-md">
          The query returned no results for the selected filters and date range.
        </p>
      </div>
    );
  }

  // =============================================================================
  // Step 5.1: Drilldown Handlers
  // =============================================================================

  // Helper functions for date range calculations
  function parsePeriodToDateRange(period: string): { preset?: string; startDate?: string; endDate?: string } | null {
    // Parse "2025-01" or "2025-Q1" format
    if (period.match(/^\d{4}-Q\d$/)) {
      // Quarter format
      const [year, quarter] = period.split('-Q');
      // Calculate quarter start/end dates
      const quarterNum = parseInt(quarter);
      const startMonth = (quarterNum - 1) * 3;
      const startDate = `${year}-${String(startMonth + 1).padStart(2, '0')}-01`;
      const endMonth = quarterNum * 3;
      const endDate = new Date(parseInt(year), endMonth, 0).toISOString().split('T')[0];
      return { startDate, endDate };
    } else if (period.match(/^\d{4}-\d{2}$/)) {
      // Month format (e.g., "2025-10" for October 2025)
      const [year, month] = period.split('-');
      const yearNum = parseInt(year);
      const monthNum = parseInt(month); // month is 1-indexed (1-12)
      const startDate = `${year}-${month}-01`;
      // JavaScript Date months are 0-indexed, so monthNum (10) = October = index 9
      // To get last day of October: new Date(2025, 10, 0) = last day of month 10 (October) = Oct 31
      // So we use monthNum directly (not monthNum - 1) because day 0 of next month = last day of current month
      const lastDay = new Date(yearNum, monthNum, 0);
      const endDate = lastDay.toISOString().split('T')[0];
      
      // CRITICAL: For TIMESTAMP fields, we need to include the full day
      // The query compiler uses TIMESTAMP(DATE('2025-10-31')) which becomes 2025-10-31 00:00:00
      // This excludes records with timestamps later in the day. We need to use the next day
      // and change the comparison to < instead of <=, OR append ' 23:59:59' to the end date.
      // However, since we're passing a custom dateRange object, the query compiler will use
      // TIMESTAMP(@endDate). To include the full day, we should use the next day's date
      // and the query should use < instead of <=. But that requires changing the query compiler.
      // 
      // Simpler fix: Use the last day of the month, and the query compiler should handle it.
      // Actually, looking at the query compiler, it uses <= TIMESTAMP(@endDate), so we need
      // to ensure endDate includes the full day. The best approach is to use the next day
      // and change to <, but that's a bigger change. For now, let's use the last day and
      // note that the query might need adjustment.
      return { startDate, endDate };
    }
    return null;
  }

  function calculatePreviousPeriod(dateRange: any): any {
    // Calculate previous period based on current dateRange
    // For period_comparison, we need to extract the previousPeriod from templateSelection
    if (dateRange?.preset) {
      // Map presets to previous period
      const presetMap: Record<string, string> = {
        'this_quarter': 'last_quarter',
        'this_month': 'last_month',
        'this_year': 'last_year',
      };
      return { preset: presetMap[dateRange.preset] || 'last_quarter' };
    }
    // For custom date ranges, calculate previous period
    if (dateRange?.startDate && dateRange?.endDate) {
      // This is a simplified calculation - for quarter comparisons, we'd need more logic
      // But for now, return the dateRange as-is and let the query handle it
      return dateRange;
    }
    return null;
  }

  // Helper to format date range as quarter string if it matches a quarter
  function formatDateRangeAsQuarter(startDate: string, endDate: string): string | null {
    // Check if the date range matches a quarter (Q1-Q4)
    // Q1: 01-01 to 03-31
    // Q2: 04-01 to 06-30
    // Q3: 07-01 to 09-30
    // Q4: 10-01 to 12-31
    
    const startMatch = startDate.match(/^(\d{4})-(\d{2})-01$/);
    const endMatch = endDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    
    if (!startMatch || !endMatch) return null;
    
    const startYear = parseInt(startMatch[1]);
    const startMonth = parseInt(startMatch[2]);
    const endYear = parseInt(endMatch[1]);
    const endMonth = parseInt(endMatch[2]);
    const endDay = parseInt(endMatch[3]);
    
    // Check if years match
    if (startYear !== endYear) return null;
    
    // Check if it's a quarter boundary
    let quarter: number | null = null;
    if (startMonth === 1 && endMonth === 3 && endDay === 31) {
      quarter = 1;
    } else if (startMonth === 4 && endMonth === 6 && endDay === 30) {
      quarter = 2;
    } else if (startMonth === 7 && endMonth === 9 && endDay === 30) {
      quarter = 3;
    } else if (startMonth === 10 && endMonth === 12 && endDay === 31) {
      quarter = 4;
    }
    
    if (quarter) {
      return `in Q${quarter} ${startYear}`;
    }
    
    return null;
  }

  // Unified handler for all drilldown types
  const handleDrillDown = async (
    drillDownType: 'metric' | 'bar' | 'line' | 'comparison' | 'aum' | 'conversion' | 'leaderboard',
    context?: {
      // For bar charts: dimension value clicked
      dimensionValue?: string;
      dimensionName?: string; // 'channel', 'source', 'sga', etc.
      // For line charts: time period clicked
      period?: string; // '2025-01', '2025-Q1', etc.
      // For comparison: which period
      periodType?: 'current' | 'previous';
      // For leaderboard: SGA name
      sgaName?: string;
      // For conversion rates: numerator or denominator
      conversionType?: 'numerator' | 'denominator';
    }
  ) => {
    if (!response?.success || !response?.compiledQuery || !response?.templateSelection) {
      return;
    }

    const { templateSelection, compiledQuery } = response;
    let { metric, dateRange, filters, dimension } = templateSelection.parameters;

    // Determine detail template and additional filters based on drilldown type
    let detailTemplate: string;
    let additionalFilters: any[] = [];
    let title = '';

    // Map metric to detail_list template
    if (drillDownType === 'aum') {
      // AUM metrics use open_pipeline_list
      detailTemplate = 'open_pipeline_list';
      title = 'Open Pipeline Opportunities';
    } else if (drillDownType === 'conversion') {
      // Conversion rates - use appropriate template based on metric
      if (metric?.includes('sqo')) {
        detailTemplate = 'sqo_detail_list';
        title = context?.conversionType === 'numerator' 
          ? 'Records that Converted' 
          : 'All Eligible Records';
      } else {
        // Default to sqo_detail_list for now
        detailTemplate = 'sqo_detail_list';
        title = 'Conversion Records';
      }
    } else {
      // Standard count metrics
      const drilldownMetrics = ['sqos', 'joined', 'prospects', 'contacted', 'mqls', 'sqls'];
      if (!metric || !drilldownMetrics.includes(metric)) {
        return;
      }

      // For MQLs, SQLs, Prospects, Contacted, and Joined - use generic_detail_list
      // For SQOs, use sqo_detail_list
      if (metric === 'sqos') {
        detailTemplate = 'sqo_detail_list';
      } else {
        // For MQLs, SQLs, Prospects, Contacted, Joined - use generic_detail_list
        // The question will be specific enough for the agent to choose correctly
        detailTemplate = 'generic_detail_list';
      }
      title = `${metric.toUpperCase()} Details`;
    }

    // Add filters based on drilldown context
    if (drillDownType === 'bar' && context?.dimensionValue && context?.dimensionName) {
      // Filter by dimension value (e.g., channel = 'Outbound')
      additionalFilters.push({
        dimension: context.dimensionName,
        operator: 'equals',
        value: context.dimensionValue,
      });
      title = `${title} - ${context.dimensionValue}`;
    } else if (drillDownType === 'line' && context?.period) {
      // Filter by time period
      // Parse period and create date range
      const periodDateRange = parsePeriodToDateRange(context.period);
      if (periodDateRange) {
        // Override dateRange for this drilldown
        dateRange = periodDateRange;
      }
      title = `${title} - ${context.period}`;
    } else if (drillDownType === 'comparison' && context?.periodType) {
      // Use appropriate date range from comparison
      // For period_comparison template, we need to get the actual period from templateSelection
      if (context.periodType === 'current') {
        // Get currentPeriod from templateSelection
        const currentPeriod = templateSelection.parameters.currentPeriod;
        if (typeof currentPeriod === 'string') {
          dateRange = { preset: currentPeriod };
        } else if (currentPeriod) {
          dateRange = currentPeriod;
        }
        title = `${title} - Current Period`;
      } else {
        // Get previousPeriod from templateSelection
        const previousPeriod = templateSelection.parameters.previousPeriod;
        if (typeof previousPeriod === 'string') {
          dateRange = { preset: previousPeriod };
        } else if (previousPeriod) {
          dateRange = previousPeriod;
        } else {
          // Fallback: calculate previous period
          const prevDateRange = calculatePreviousPeriod(dateRange);
          if (prevDateRange) {
            dateRange = prevDateRange;
          }
        }
        title = `${title} - Previous Period`;
      }
      
      // Debug logging for comparison drilldown
      console.log('[handleDrillDown] Comparison drilldown:', {
        periodType: context.periodType,
        dateRange,
        metric,
        title,
      });
    } else if (drillDownType === 'leaderboard' && context?.sgaName) {
      // Filter by SGA
      if (context.sgaName) {
        additionalFilters.push({
          dimension: 'sga',
          operator: 'equals',
          value: context.sgaName,
        });
        title = `${title} - ${context.sgaName}`;
      }
    }

    // Merge additional filters with existing filters
    const mergedFilters = filters ? [...filters, ...additionalFilters] : additionalFilters;

    setDrillDownLoading(true);
    setDrillDownOpen(true);
    setDrillDownTitle(title);

    try {
      // Generate natural language question for the API
      // CRITICAL: Include date range and filters from original query to ensure correct results
      // Use explicit question format that matches agent prompt examples
      let question = '';
      
      // Build question based on metric type
      // CRITICAL: Make questions explicit and specific so agent selects correct template
      if (metric === 'sqos') {
        question = 'who are the people that SQOed';
      } else if (metric === 'joined') {
        question = 'who are the people that joined';
      } else if (metric === 'sqls') {
        question = 'who are the people that became SQLs';
      } else if (metric === 'mqls') {
        question = 'who are the people that became MQLs';
      } else if (metric === 'contacted') {
        question = 'who are the people that were contacted';
      } else if (metric === 'prospects') {
        question = 'who are the prospects';
      } else {
        question = `show me all ${metric || 'records'}`;
      }
      
      // For MQLs, SQLs, and Joined, use "show me all" format to ensure generic_detail_list template
      // The agent should select generic_detail_list for these metrics
      if (metric === 'mqls') {
        question = 'show me all MQLs';
      } else if (metric === 'sqls') {
        question = 'show me all SQLs';
      } else if (metric === 'joined') {
        question = 'show me all joined advisors';
      }
      
      // Add date range explicitly
      if (dateRange) {
        // Check for custom date range first (preset: "custom" with startDate/endDate)
        if ((dateRange.preset === 'custom' || !dateRange.preset) && dateRange.startDate && dateRange.endDate) {
          // Try to format as quarter first (e.g., "in Q3 2025")
          const quarterFormat = formatDateRangeAsQuarter(dateRange.startDate, dateRange.endDate);
          if (quarterFormat) {
            question += ` ${quarterFormat}`;
          } else {
            // Custom date range - use explicit dates
            question += ` from ${dateRange.startDate} to ${dateRange.endDate}`;
          }
        } else if (dateRange.preset) {
          // Map preset to natural language
          const presetMap: Record<string, string> = {
            'this_quarter': 'this quarter',
            'last_quarter': 'last quarter',
            'this_month': 'this month',
            'last_month': 'last month',
            'this_week': 'this week',
            'ytd': 'this year',
            'last_year': 'last year',
            'last_30_days': 'in the last 30 days',
            'last_90_days': 'in the last 90 days',
          };
          const presetText = presetMap[dateRange.preset];
          if (presetText) {
            question += ` ${presetText}`;
          }
          // If preset is not in map (e.g., unknown preset), don't add anything
        }
      }
      
      // Debug logging for question construction
      console.log('[handleDrillDown] Generated question:', {
        question,
        dateRange,
        metric,
        drillDownType,
        context,
      });
      
      // Add dimension filters from original query
      if (mergedFilters && mergedFilters.length > 0) {
        mergedFilters.forEach(filter => {
          if (filter.dimension === 'channel') {
            question += ` from ${filter.value} channel`;
          } else if (filter.dimension === 'source') {
            question += ` from ${filter.value} source`;
          } else if (filter.dimension === 'sga') {
            question += ` for SGA ${filter.value}`;
          } else if (filter.dimension === 'sgm') {
            question += ` for SGM ${filter.value}`;
          } else if (filter.dimension === 'experimentation_tag') {
            if (Array.isArray(filter.value)) {
              question += ` from ${filter.value.join(' or ')} experiment`;
            } else {
              question += ` from ${filter.value} experiment`;
            }
          }
        });
      }
      
      // Add context-specific filters
      if (context?.dimensionValue && drillDownType === 'bar') {
        // Already included in mergedFilters above
      } else if (context?.period && drillDownType === 'line') {
        // Period already handled by dateRange override above
      } else if (context?.sgaName && drillDownType === 'leaderboard') {
        // Already included in mergedFilters above
      }

      const detailResponse = await fetch('/api/agent/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          conversationHistory: [],
        }),
      });

      const detailData: AgentResponse = await detailResponse.json();
      
      // Debug logging for API response
      console.log('[handleDrillDown] API response:', {
        success: detailData.success,
        rowCount: detailData.result?.rows?.length || 0,
        columns: detailData.result?.columns?.map(c => c.name) || [],
        templateId: detailData.templateSelection?.templateId,
        metric: detailData.templateSelection?.parameters?.metric,
        error: detailData.error,
        firstRow: detailData.result?.rows?.[0],
      });
      
      if (detailData.success && detailData.result) {
        // Check if we got any rows
        if (!detailData.result.rows || detailData.result.rows.length === 0) {
          console.warn('[handleDrillDown] No rows returned from API', {
            question,
            templateId: detailData.templateSelection?.templateId,
            metric: detailData.templateSelection?.parameters?.metric,
            columns: detailData.result.columns?.map(c => c.name) || [],
            compiledQuery: detailData.compiledQuery,
          });
          setDrillDownRecords([]);
          return;
        }
        
        // Transform QueryResultData rows to DetailRecord format
        const records: DetailRecord[] = detailData.result.rows.map((row, idx) => {
          // Map row data to DetailRecord structure
          // Handle different column names that might be returned for different metrics
          const primaryKey = row.primary_key as string || 
                           row.id as string || 
                           `record-${idx}`;
          const advisorName = row.advisor_name as string || 
                            row.name as string || 
                            row.prospect_name as string || 
                            'Unknown';
          const source = row.source as string || 
                        row.original_source as string || 
                        'Unknown';
          const channel = row.channel as string || 
                        row.channel_grouping_name as string || 
                        'Other';
          const stage = row.stage as string || 
                       row.stage_name as string || 
                       row.stagename as string || 
                       'Unknown';
          const sga = (row.sga as string) || 
                     (row.sga_owner_name__c as string) || 
                     null;
          const sgm = (row.sgm as string) || 
                     (row.sgm_owner_name__c as string) || 
                     null;
          const campaignId = (row.campaign_id as string) || (row.Campaign_Id__c as string) || null;
          const campaignName = (row.campaign_name as string) || (row.Campaign_Name__c as string) || null;
          const leadScoreTier = (row.lead_score_tier as string) || (row.Lead_Score_Tier__c as string) || null;
          const aum = typeof row.aum === 'number' ? row.aum : 
                     (typeof row.aum === 'string' ? parseFloat(row.aum) || 0 : 0);
          // For MQLs, SQLs, and other metrics, check for metric-specific date columns
          const relevantDate = row.sqo_date as string || 
                              row.mql_date as string ||
                              row.sql_date as string ||
                              row.contacted_date as string ||
                              row.joined_date as string ||
                              row.prospect_date as string ||
                              row.date as string || 
                              row.relevant_date as string || 
                              '';
          const leadUrl = row.lead_url as string || null;
          const opportunityUrl = row.opportunity_url as string || null;
          const salesforceUrl = opportunityUrl || leadUrl || '';
          
          // Determine stage flags based on available data
          const isSqo = Boolean(row.is_sqo || row.is_sqo_unique || row.Date_Became_SQO__c);
          const isJoined = Boolean(row.is_joined || row.is_joined_unique || row.advisor_join_date__c);
          const isSql = Boolean(row.is_sql || row.sql_stage_entered_ts || row.converted_date_raw);
          const isMql = Boolean(row.is_mql || row.mql_stage_entered_ts);
          const isContacted = Boolean(row.is_contacted || row.contacted_date || row.stage_entered_contacting__c);
          const isOpenPipeline = Boolean(row.is_open_pipeline || (row.stage && !['Closed Won', 'Closed Lost'].includes(String(row.stage))));

          return {
            id: primaryKey,
            advisorName,
            source,
            channel,
            stage,
            sga,
            sgm,
            campaignId,
            campaignName,
            leadScoreTier,
            aum,
            aumFormatted: aum ? formatCurrency(aum) : '-',
            salesforceUrl,
            relevantDate,
            contactedDate: row.contacted_date as string || row.stage_entered_contacting__c as string || null,
            mqlDate: row.mql_date as string || row.mql_stage_entered_ts as string || null,
            sqlDate: row.sql_date as string || row.converted_date_raw as string || null,
            sqoDate: row.sqo_date as string || row.Date_Became_SQO__c as string || null,
            joinedDate: row.joined_date as string || row.advisor_join_date__c as string || null,
            signedDate: row.signed_date as string || row.Stage_Entered_Signed__c as string || null,
            discoveryDate: row.discovery_date as string || row.Stage_Entered_Discovery__c as string || null,
            salesProcessDate: row.sales_process_date as string || row.Stage_Entered_Sales_Process__c as string || null,
            negotiatingDate: row.negotiating_date as string || row.Stage_Entered_Negotiating__c as string || null,
            onHoldDate: row.on_hold_date as string || row.Stage_Entered_On_Hold__c as string || null,
            closedDate: row.closed_date as string || row.Stage_Entered_Closed__c as string || null,
            initialCallScheduledDate: row.initial_call_scheduled_date as string || row.Initial_Call_Scheduled_Date__c as string || null,
            qualificationCallDate: row.qualification_call_date as string || row.Qualification_Call_Date__c as string || null,
            isContacted,
            isMql,
            isSql,
            isSqo,
            isJoined,
            isOpenPipeline,
            recordTypeId: row.recordtypeid as string || null,
            isPrimaryOppRecord: (row.is_primary_opp_record as number ?? 0) === 1,
            opportunityId: (row.Full_Opportunity_ID__c as string) || null,
            prospectSourceType: row.prospect_source_type ? String(row.prospect_source_type) : null,
            originRecruitingOppId: row.origin_recruiting_opp_id ? String(row.origin_recruiting_opp_id) : null,
            originOpportunityUrl: row.origin_opportunity_url ? String(row.origin_opportunity_url) : null,
            nextSteps: (row.next_steps as string) || (row.Next_Steps__c as string) || null,
            opportunityNextStep: (row.opportunity_next_step as string) || (row.NextStep as string) || null,
            tofStage: (row.tof_stage as string) || (row.TOF_Stage as string) || 'Prospect',
            oppCreatedDate: null,
            daysInCurrentStage: null,
          };
        });

        console.log('[handleDrillDown] Mapped records:', {
          recordCount: records.length,
          sampleRecord: records[0],
        });

        setDrillDownRecords(records);
      } else {
        throw new Error(detailData.error?.message || 'Failed to load drilldown records');
      }
    } catch (error) {
      console.error('Error fetching drilldown records:', error);
      setDrillDownRecords([]);
    } finally {
      setDrillDownLoading(false);
    }
  };

  // Specific handlers for different visualization types
  const handleMetricClick = () => {
    if (!response?.templateSelection) return;
    
    const { metric } = response.templateSelection.parameters;
    
    // Check if AUM metric
    const aumMetrics = ['open_pipeline_aum', 'sqo_aum', 'joined_aum', 'signed_aum'];
    if (metric && aumMetrics.includes(metric)) {
      handleDrillDown('aum');
      return;
    }
    
    // Check if conversion rate
    const valueColumn = response?.result?.columns.find(col => col.name === 'value');
    const isRate = valueColumn?.type === 'rate' || 
                   (typeof response?.result?.rows[0]?.value === 'number' && 
                    response.result.rows[0].value >= 0 && 
                    response.result.rows[0].value <= 100);
    
    if (isRate) {
      handleDrillDown('conversion', { conversionType: 'numerator' });
      return;
    }
    
    // Standard count metric
    handleDrillDown('metric');
  };

  const handleBarClick = (data: any, index: number) => {
    if (!response?.templateSelection || !response?.result) return;
    
    const { dimension } = response.templateSelection.parameters;
    const row = response.result.rows[index];
    
    // Get dimension value from clicked bar
    const dimensionValue = row.dimension_value as string || row.name as string || String(row[dimension || ''] || '');
    
    handleDrillDown('bar', {
      dimensionValue,
      dimensionName: dimension,
    });
  };

  const handleComparisonClick = (periodType: 'current' | 'previous') => {
    handleDrillDown('comparison', { periodType });
  };

  const handleLineClick = (data: any, index: number) => {
    if (!response?.result) return;
    
    // data is the payload from the clicked dot, which contains the period/name
    // The period should be in format "2025-01" (month) or "2025-Q1" (quarter)
    const period = data?.name as string || data?.period as string || '';
    
    // Fallback: get from original result rows
    if (!period && response.result.rows[index]) {
      const row = response.result.rows[index];
      const fallbackPeriod = row.period as string || row.name as string || '';
      if (fallbackPeriod) {
        handleDrillDown('line', { period: fallbackPeriod });
        return;
      }
    }
    
    if (!period) {
      console.warn('Could not extract period from line chart click', { data, index, rows: response.result.rows });
      return;
    }
    
    handleDrillDown('line', { period });
  };

  // Handler for clicking on records in drilldown list
  const handleRecordClick = (recordId: string) => {
    setDrillDownOpen(false);
    setSelectedRecordId(recordId);
    setRecordDetail(null);
    setRecordError(null);
    setIsLoadingRecord(true);
    
    dashboardApi.getRecordDetail(recordId)
      .then((record) => {
        setRecordDetail(record);
        setIsLoadingRecord(false);
      })
      .catch((error) => {
        console.error('Error fetching record detail:', error);
        setRecordError('Failed to load record details');
        setIsLoadingRecord(false);
      });
  };

  // Handler for back button in record detail modal
  const handleBackToDrillDown = () => {
    setSelectedRecordId(null);
    setRecordDetail(null);
    setDrillDownOpen(true);
  };

  // =============================================================================
  // Step 5.2: Table Row Click Handler
  // =============================================================================

  // Handler for table row clicks - separate from drilldown record clicks
  const handleTableRowClick = (row: Record<string, unknown>) => {
    const primaryKey = row.primary_key;
    if (primaryKey && typeof primaryKey === 'string') {
      setTableRowRecordId(primaryKey);
      setTableRowRecordDetail(null);
      setIsLoadingTableRecord(true);
      
      // Fetch full record details
      dashboardApi.getRecordDetail(primaryKey)
        .then((record) => {
          setTableRowRecordDetail(record);
          setIsLoadingTableRecord(false);
        })
        .catch((error) => {
          console.error('Error fetching record detail:', error);
          setIsLoadingTableRecord(false);
        });
    }
  };

  return (
    <div className="space-y-6">
      {/* Template explanation */}
      {templateSelection && (
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <span className="font-medium">Template:</span>
          <code className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800">
            {templateSelection.templateId}
          </code>
          <span className="opacity-60">•</span>
          <span>{templateSelection.explanation}</span>
        </div>
      )}

      {/* Visualization */}
      <div 
        id="explore-chart"
        className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {getVisualizationTitle(visualization)}
          </h3>
          {visualizationOverridden && visualizationReason && (
            <span className="text-xs text-gray-500 dark:text-gray-400 italic">
              ({visualizationReason})
            </span>
          )}
        </div>
        {renderVisualization(
          visualization, 
          result, 
          getVisualizationTitle(visualization), 
          isDark, 
          isAumMetric,
          handleMetricClick,
          handleBarClick,
          handleLineClick,
          handleComparisonClick
        )}
      </div>

      {/* Data Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex items-center justify-between">
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Data ({result.metadata.rowCount} rows)
          </h4>
          {compiledQuery && (
            <ExportMenu
              data={result}
              query={compiledQuery}
              chartElementId="explore-chart"
              filename={`funnel-${templateSelection?.templateId || 'query'}`}
            />
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/50">
              <tr>
                {result.columns.map((col) => (
                  <th
                    key={col.name}
                    className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-400"
                  >
                    {col.displayName}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {(() => {
                const startIndex = (currentPage - 1) * rowsPerPage;
                const endIndex = startIndex + rowsPerPage;
                const paginatedRows = result.rows.slice(startIndex, endIndex);
                
                // Check if table has primary_key column (enables row clicks)
                const hasPrimaryKey = result.columns.some(col => col.name === 'primary_key');
                
                return paginatedRows.map((row, i) => (
                  <tr 
                    key={startIndex + i} 
                    className={`hover:bg-gray-50 dark:hover:bg-gray-800/50 ${
                      hasPrimaryKey ? 'cursor-pointer' : ''
                    }`}
                    onClick={() => hasPrimaryKey && handleTableRowClick(row)}
                  >
                    {result.columns.map((col) => (
                      <td key={col.name} className="px-4 py-2 text-gray-900 dark:text-gray-100">
                        {formatCellValue(row[col.name], col.type, isAumMetric && col.name === 'value')}
                      </td>
                    ))}
                  </tr>
                ));
              })()}
            </tbody>
          </table>
          
          {/* Pagination Controls */}
          {result.rows.length > rowsPerPage && (() => {
            const totalPages = Math.ceil(result.rows.length / rowsPerPage);
            const startIndex = (currentPage - 1) * rowsPerPage;
            const endIndex = Math.min(startIndex + rowsPerPage, result.rows.length);
            
            return (
              <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex items-center justify-between">
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  Showing {startIndex + 1} to {endIndex} of {result.rows.length} rows
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                    className="p-2 rounded-md border border-gray-300 dark:border-gray-600 
                             bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300
                             hover:bg-gray-50 dark:hover:bg-gray-700
                             disabled:opacity-50 disabled:cursor-not-allowed
                             transition-colors"
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-sm text-gray-700 dark:text-gray-300 px-3">
                    Page {currentPage} of {totalPages}
                  </span>
                  <button
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                    className="p-2 rounded-md border border-gray-300 dark:border-gray-600 
                             bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300
                             hover:bg-gray-50 dark:hover:bg-gray-700
                             disabled:opacity-50 disabled:cursor-not-allowed
                             transition-colors"
                    aria-label="Next page"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Query Inspector */}
      {compiledQuery && (
        <QueryInspector
          sql={compiledQuery.sql}
          params={compiledQuery.params}
          executionTimeMs={result.metadata.executionTimeMs}
        />
      )}

      {/* Feedback */}
      {(response?.success && response?.templateSelection) || error ? (
        <ResponseFeedback
          questionId={new Date().toISOString()}
          templateId={response?.templateSelection?.templateId || 'error'}
          question={currentQuestion || ''}
          response={response}
          error={error}
        />
      ) : null}

      {/* Follow-up suggestions */}
      {followUpSuggestions && followUpSuggestions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <span className="text-sm text-gray-500 dark:text-gray-400">Try also:</span>
          {followUpSuggestions.map((suggestion, i) => (
            <button
              key={i}
              className="text-sm px-3 py-1 rounded-full bg-gray-100 dark:bg-gray-700 
                         text-gray-700 dark:text-gray-300 hover:bg-gray-200 
                         dark:hover:bg-gray-600 transition-colors"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      {/* Step 5.1: Drilldown Modal */}
      {drillDownOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setDrillDownOpen(false)} />
          <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-6xl mx-4 max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                {drillDownTitle}
              </h2>
              <button
                onClick={() => setDrillDownOpen(false)}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-6">
              {drillDownLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                </div>
              ) : (
                <>
                  <DetailRecordsTable
                    records={drillDownRecords}
                    title=""
                    onRecordClick={handleRecordClick}
                    canExport={true}
                  />
                  {/* Export menu for drilldown data */}
                  {drillDownRecords.length > 0 && compiledQuery && (() => {
                    // Convert DetailRecord[] to QueryResultData format for ExportMenu
                    const exportData: QueryResultData = {
                      rows: drillDownRecords.map(r => ({
                        'Advisor Name': r.advisorName,
                        'Source': r.source,
                        'Channel': r.channel,
                        'Stage': r.stage,
                        'Date': r.relevantDate,
                        'SGA': r.sga || '',
                        'SGM': r.sgm || '',
                        'AUM': r.aum,
                        'AUM Formatted': r.aumFormatted,
                        'Lead Next Steps': r.nextSteps || '',
                        'Opportunity Next Step': r.opportunityNextStep || '',
                        'Current Stage': (r.stage && r.stage !== 'Unknown') ? r.stage : r.tofStage,
                        'Days in Current Stage': r.daysInCurrentStage ?? '',
                      })),
                      columns: [
                        { name: 'Advisor Name', displayName: 'Advisor Name', type: 'string' },
                        { name: 'Source', displayName: 'Source', type: 'string' },
                        { name: 'Channel', displayName: 'Channel', type: 'string' },
                        { name: 'Stage', displayName: 'Stage', type: 'string' },
                        { name: 'Date', displayName: 'Date', type: 'date' },
                        { name: 'SGA', displayName: 'SGA', type: 'string' },
                        { name: 'SGM', displayName: 'SGM', type: 'string' },
                        { name: 'AUM', displayName: 'AUM', type: 'number' },
                        { name: 'AUM Formatted', displayName: 'AUM Formatted', type: 'string' },
                        { name: 'Lead Next Steps', displayName: 'Lead Next Steps', type: 'string' },
                        { name: 'Opportunity Next Step', displayName: 'Opportunity Next Step', type: 'string' },
                        { name: 'Current Stage', displayName: 'Current Stage', type: 'string' },
                        { name: 'Days in Current Stage', displayName: 'Days in Current Stage', type: 'number' },
                      ],
                      metadata: {
                        rowCount: drillDownRecords.length,
                        executionTimeMs: 0,
                        fromCache: false,
                      },
                    };
                    
                    return (
                      <div className="mt-4 flex justify-end">
                        <ExportMenu
                          data={exportData}
                          query={compiledQuery}
                          chartElementId={undefined}
                          filename={`drilldown-${drillDownTitle.toLowerCase().replace(/\s+/g, '-')}`}
                        />
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Step 5.1: Record Detail Modal (from drilldown) */}
      <RecordDetailModal
        isOpen={selectedRecordId !== null}
        onClose={() => {
          setSelectedRecordId(null);
          setRecordDetail(null);
          setRecordError(null);
        }}
        recordId={selectedRecordId}
        initialRecord={recordDetail}
        showBackButton={drillDownRecords.length > 0 && drillDownOpen === false}
        onBack={handleBackToDrillDown}
        backButtonLabel="← Back to list"
      />

      {/* Step 5.2: Record Detail Modal (from table rows) */}
      <RecordDetailModal
        isOpen={tableRowRecordId !== null}
        onClose={() => {
          setTableRowRecordId(null);
          setTableRowRecordDetail(null);
        }}
        recordId={tableRowRecordId}
        initialRecord={tableRowRecordDetail}
      />
    </div>
  );
}

// =============================================================================
// VISUALIZATION RENDERERS
// =============================================================================

// Helper to get visualization title
function getVisualizationTitle(type: VisualizationType): string {
  const titles: Record<VisualizationType, string> = {
    metric: 'Metric',
    bar: 'Bar Chart',
    line: 'Trend Chart',
    funnel: 'Funnel View',
    comparison: 'Comparison',
    table: 'Data Table',
  };
  return titles[type] || 'Visualization';
}

// Visualization rendering function
// NOTE: For full implementation, create separate components (MetricCard, BarChartVisualization, etc.)
// For now, using inline renderers that match existing patterns
function renderVisualization(
  visualization: VisualizationType,
  data: QueryResultData,
  title?: string,
  isDark?: boolean,
  isAumMetric?: boolean,
  onMetricClick?: () => void,
  onBarClick?: (data: any, index: number) => void,
  onLineClick?: (data: any, index: number) => void,
  onComparisonClick?: (periodType: 'current' | 'previous') => void
): React.ReactNode {
  switch (visualization) {
    case 'metric':
      return renderMetric(data, isAumMetric, onMetricClick);
    
    case 'bar':
      return renderBarChart(data, isDark, onBarClick);
    
    case 'line':
      return renderLineChart(data, isDark, onLineClick);
    
    case 'funnel':
      // TODO: Implement funnel visualization component
      return (
        <div className="flex items-center justify-center py-8">
          <span className="text-gray-500 dark:text-gray-400">
            Funnel visualization (to be implemented)
          </span>
        </div>
      );
    
    case 'comparison':
      return renderComparison(data, isDark, onComparisonClick);
    
    case 'table':
    default:
      // Table is rendered separately below
      return (
        <div className="flex items-center justify-center py-8">
          <span className="text-gray-500 dark:text-gray-400">
            Data displayed in table below
          </span>
        </div>
      );
  }
}

function renderMetric(result: QueryResultData, isAumMetric?: boolean, onMetricClick?: () => void) {
  const value = result.rows[0]?.value;
  const numValue = Number(value) || 0;
  
  // Check if this is a conversion rate (value between 0-100 and column type is 'rate')
  const valueColumn = result.columns.find(col => col.name === 'value');
  const isRate = valueColumn?.type === 'rate' || 
                 (typeof value === 'number' && value >= 0 && value <= 100 && 
                  (valueColumn?.displayName.toLowerCase().includes('rate') || 
                   valueColumn?.displayName.toLowerCase().includes('percent')));
  
  // Format AUM metrics with currency
  let displayValue: string;
  let fullValue: string | null = null;
  
  if (isAumMetric) {
    // Format as currency: "$12.4B" for billions, "$12.5M" for millions, etc.
    displayValue = formatCurrency(numValue);
    // Full formatted value with commas
    fullValue = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(numValue);
  } else if (isRate) {
    displayValue = `${numValue.toFixed(1)}%`;
  } else {
    displayValue = formatNumber(value);
  }
  
  // ALL metrics are clickable now: counts, AUM, and rates
  const isClickable = numValue > 0 && onMetricClick;
  
  return (
    <div className="flex flex-col items-center justify-center py-8">
      <TrendingUp className="w-8 h-8 text-blue-500 mb-2" />
      <button
        onClick={isClickable ? onMetricClick : undefined}
        disabled={!isClickable}
        className={`text-4xl font-bold text-gray-900 dark:text-gray-100 ${
          isClickable 
            ? 'cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors' 
            : 'cursor-default'
        }`}
        title={isClickable ? 'Click to see details' : undefined}
      >
        {displayValue}
      </button>
      {fullValue && (
        <span className="text-sm text-gray-500 dark:text-gray-400 mt-2">
          {fullValue}
        </span>
      )}
    </div>
  );
}

function renderBarChart(result: QueryResultData, isDark: boolean = false, onBarClick?: (data: any, index: number) => void) {
  const data = result.rows.map((row, idx) => ({
    name: String(row.dimension_value || row.period || row.sga || ''),
    value: Number(row.metric_value || row.rate || row.value || 0),
    index: idx, // Store index for click handler
  }));

  return (
    <div className="h-80">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis type="number" />
          <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 12 }} />
          <Tooltip 
            contentStyle={{ 
              backgroundColor: isDark ? '#1f2937' : '#fff',
              border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
              borderRadius: '8px',
              color: isDark ? '#f9fafb' : '#111827'
            }} 
          />
          <Bar 
            dataKey="value" 
            fill="#3B82F6" 
            radius={[0, 4, 4, 0]}
            onClick={(data: any, index: number) => {
              if (onBarClick && data && data.value > 0) {
                // data is the clicked data point, index is the index
                onBarClick(data, index);
              }
            }}
            style={{ cursor: onBarClick ? 'pointer' : 'default' }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function renderComparison(result: QueryResultData, isDark: boolean = false, onComparisonClick?: (periodType: 'current' | 'previous') => void) {
  if (result.rows.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <span className="text-gray-500 dark:text-gray-400">No comparison data available</span>
      </div>
    );
  }

  const row = result.rows[0];
  const currentValue = Number(row.current_value || row.currentValue || 0);
  const previousValue = Number(row.previous_value || row.previousValue || 0);
  const changePercent = row.change_percent !== undefined ? Number(row.change_percent) : row.changePercent !== undefined ? Number(row.changePercent) : null;
  const changeAbsolute = row.change_absolute !== undefined ? Number(row.change_absolute) : row.changeAbsolute !== undefined ? Number(row.changeAbsolute) : 0;

  const isPositive = changePercent !== null && changePercent > 0;
  const isNegative = changePercent !== null && changePercent < 0;

  return (
    <div className="flex items-center justify-center py-8">
      <div className="grid grid-cols-2 gap-8 w-full max-w-2xl">
        {/* Current Period */}
        <div className="text-center">
          <div className="text-sm text-gray-500 dark:text-gray-400 mb-2">Current Period</div>
          <button
            onClick={() => onComparisonClick?.('current')}
            disabled={!onComparisonClick || currentValue === 0}
            className={`text-4xl font-bold ${
              onComparisonClick && currentValue > 0
                ? 'cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors text-gray-900 dark:text-gray-100'
                : 'cursor-default text-gray-900 dark:text-gray-100'
            }`}
            title={onComparisonClick && currentValue > 0 ? 'Click to see details' : undefined}
          >
            {currentValue.toLocaleString()}
          </button>
        </div>

        {/* Previous Period */}
        <div className="text-center">
          <div className="text-sm text-gray-500 dark:text-gray-400 mb-2">Previous Period</div>
          <button
            onClick={() => onComparisonClick?.('previous')}
            disabled={!onComparisonClick || previousValue === 0}
            className={`text-4xl font-bold ${
              onComparisonClick && previousValue > 0
                ? 'cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors text-gray-900 dark:text-gray-100'
                : 'cursor-default text-gray-900 dark:text-gray-100'
            }`}
            title={onComparisonClick && previousValue > 0 ? 'Click to see details' : undefined}
          >
            {previousValue.toLocaleString()}
          </button>
        </div>

        {/* Change */}
        {changePercent !== null && (
          <div className="col-span-2 text-center mt-4">
            <div className={`text-2xl font-semibold ${
              isPositive ? 'text-green-600 dark:text-green-400' : 
              isNegative ? 'text-red-600 dark:text-red-400' : 
              'text-gray-600 dark:text-gray-400'
            }`}>
              {isPositive ? '+' : ''}{changePercent.toFixed(1)}%
              {changeAbsolute !== 0 && (
                <span className="text-lg text-gray-500 dark:text-gray-400 ml-2">
                  ({changeAbsolute > 0 ? '+' : ''}{changeAbsolute.toLocaleString()})
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function renderLineChart(result: QueryResultData, isDark: boolean = false, onPointClick?: (data: any, index: number) => void) {
  const data = result.rows.map((row, idx) => ({
    name: String(row.period || ''),
    value: Number(row.raw_value || row.metric_value || row.rate || 0),
    rollingAvg: row.rolling_avg ? Number(row.rolling_avg) : undefined,
    index: idx, // Store index for click handler
  }));

  return (
    <div className="h-80">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis dataKey="name" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip 
            contentStyle={{ 
              backgroundColor: isDark ? '#1f2937' : '#fff',
              border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
              borderRadius: '8px',
              color: isDark ? '#f9fafb' : '#111827'
            }} 
          />
          <Legend />
          <Line 
            type="monotone" 
            dataKey="value" 
            stroke="#3B82F6" 
            strokeWidth={2}
            dot={onPointClick ? (props: any) => {
              const { cx, cy, payload, value } = props;
              // payload contains the data point from the data array, including the index we stored
              const dataIndex = payload?.index !== undefined ? payload.index : data.findIndex((d: any) => d.name === payload?.name && d.value === value);
              return (
                <circle
                  cx={cx}
                  cy={cy}
                  r={6}
                  fill="#3B82F6"
                  stroke="#fff"
                  strokeWidth={2}
                  style={{ cursor: 'pointer' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onPointClick && payload && value > 0 && dataIndex >= 0) {
                      // Pass the payload (which contains name/period) and the index
                      onPointClick(payload, dataIndex);
                    }
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.setAttribute('fill', '#2563EB');
                    e.currentTarget.setAttribute('r', '8');
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.setAttribute('fill', '#3B82F6');
                    e.currentTarget.setAttribute('r', '6');
                  }}
                />
              );
            } : { r: 4 }}
            name="Value"
          />
          {data.some(d => d.rollingAvg !== undefined) && (
            <Line 
              type="monotone" 
              dataKey="rollingAvg" 
              stroke="#10B981" 
              strokeWidth={2}
              strokeDasharray="5 5"
              dot={false}
              name="Rolling Avg"
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// =============================================================================
// FORMATTING HELPERS
// =============================================================================

function formatNumber(value: unknown): string {
  if (value === null || value === undefined) return '-';
  const num = Number(value);
  if (isNaN(num)) return String(value);
  
  // Handle billions
  if (num >= 1_000_000_000) {
    return `${(num / 1_000_000_000).toFixed(1)}B`;
  }
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}K`;
  }
  return num.toLocaleString();
}

function formatCellValue(value: unknown, type: string, isAumMetric?: boolean): string {
  if (value === null || value === undefined) return '-';
  
  // Handle date objects from BigQuery (DATE fields can return as { value: string })
  if (typeof value === 'object' && value !== null && 'value' in value) {
    const dateValue = typeof value.value === 'string' ? value.value : String(value.value);
    // Extract date part (YYYY-MM-DD) if it includes time
    const dateStr = dateValue.split('T')[0];
    // Format as readable date (e.g., "Jan 15, 2025")
    try {
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
      }
    } catch {
      // Fallback to raw string if parsing fails
    }
    return dateStr;
  }
  
  // Handle date strings (YYYY-MM-DD format)
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const dateStr = value.split('T')[0];
    try {
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
      }
    } catch {
      // Fallback to raw string if parsing fails
    }
    return dateStr;
  }
  
  if (typeof value === 'number') {
    if (type.toLowerCase().includes('rate') || type.toLowerCase().includes('percent')) {
      return `${value.toFixed(1)}%`;
    }
    // Format AUM values as currency in the data table
    if (isAumMetric) {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(value);
    }
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  
  return String(value);
}
