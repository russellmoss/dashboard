// =============================================================================
// SEMANTIC LAYER VALIDATION
// Example questions and how they map to templates/metrics/dimensions
// 
// Use this file to:
// 1. Test that the semantic layer covers expected questions
// 2. Verify the agent's expected behavior
// 3. Build test cases for the query compiler
//
// Location: src/lib/semantic-layer/__tests__/validation-examples.ts
// =============================================================================

import { 
  SEMANTIC_LAYER, 
  QUERY_TEMPLATES,
  CONSTANTS 
} from '../index';

// =============================================================================
// EXAMPLE QUESTIONS AND EXPECTED MAPPINGS
// =============================================================================

export const VALIDATION_EXAMPLES = [
  
  // ===========================================================================
  // VOLUME QUESTIONS
  // ===========================================================================
  {
    question: "How many SQOs did we have this quarter?",
    expectedMapping: {
      templateId: 'single_metric',
      metric: 'sqos',
      dateRange: 'this_quarter',
      filters: null,
    },
    explanation: "Simple volume count for SQOs in current quarter",
  },
  
  {
    question: "How many MQLs did John Doe have quarter to date?",
    expectedMapping: {
      templateId: 'single_metric',
      metric: 'mqls',
      dateRange: 'this_quarter',
      filters: { sga: 'John Doe' },
    },
    explanation: "MQL volume filtered by specific SGA",
  },
  
  {
    question: "How many SQLs from LPL this year?",
    expectedMapping: {
      templateId: 'single_metric',
      metric: 'sqls',
      dateRange: 'ytd',
      filters: { source: 'LPL' },
    },
    explanation: "SQL volume filtered by source",
  },
  
  {
    question: "How many SQOs did we get from the Experimentation Tag 'Q4 Campaign'?",
    expectedMapping: {
      templateId: 'single_metric',
      metric: 'sqos',
      dateRange: 'custom', // Agent should ask for date range
      filters: { experimentation_tag: 'Q4 Campaign' },
    },
    explanation: "SQO volume filtered by experimentation tag",
  },

  // ===========================================================================
  // BY DIMENSION QUESTIONS
  // ===========================================================================
  {
    question: "SQOs by channel this quarter",
    expectedMapping: {
      templateId: 'metric_by_dimension',
      metric: 'sqos',
      dimension: 'channel',
      dateRange: 'this_quarter',
    },
    explanation: "SQO breakdown by channel grouping",
  },
  
  {
    question: "Show me joined advisors by SGA this year",
    expectedMapping: {
      templateId: 'metric_by_dimension',
      metric: 'joined',
      dimension: 'sga',
      dateRange: 'ytd',
    },
    explanation: "Joined count grouped by SGA",
  },
  
  {
    question: "MQLs by source for Paid Search channel",
    expectedMapping: {
      templateId: 'metric_by_dimension',
      metric: 'mqls',
      dimension: 'source',
      filters: { channel: 'Paid Search' },
    },
    explanation: "MQL breakdown by source, filtered to one channel",
  },

  // ===========================================================================
  // CONVERSION RATE QUESTIONS
  // ===========================================================================
  {
    question: "What's our SQL to SQO conversion rate by channel?",
    expectedMapping: {
      templateId: 'conversion_by_dimension',
      conversionMetric: 'sql_to_sqo_rate',
      dimension: 'channel',
    },
    explanation: "SQL→SQO rate broken down by channel",
  },
  
  {
    question: "Win rate by SGA this quarter",
    expectedMapping: {
      templateId: 'conversion_by_dimension',
      conversionMetric: 'sqo_to_joined_rate', // "win rate" maps to SQO→Joined
      dimension: 'sga',
      dateRange: 'this_quarter',
    },
    explanation: "SQO→Joined (win rate) by SGA",
  },
  
  {
    question: "Which sources have the best MQL to SQL conversion?",
    expectedMapping: {
      templateId: 'top_n',
      metric: 'mql_to_sql_rate',
      dimension: 'source',
      sortDirection: 'DESC',
    },
    explanation: "Rank sources by MQL→SQL rate (best = highest)",
  },

  // ===========================================================================
  // TREND QUESTIONS
  // ===========================================================================
  {
    question: "SQO trend by month this year",
    expectedMapping: {
      templateId: 'metric_trend',
      metric: 'sqos',
      timePeriod: 'month',
      dateRange: 'ytd',
    },
    explanation: "Monthly SQO volume trend",
  },
  
  {
    question: "Quarterly joined advisors for the last 4 quarters",
    expectedMapping: {
      templateId: 'metric_trend',
      metric: 'joined',
      timePeriod: 'quarter',
      // 4 quarters back
    },
    explanation: "Quarterly joined trend",
  },
  
  {
    question: "SQL to SQO conversion trend by quarter",
    expectedMapping: {
      templateId: 'conversion_trend',
      conversionMetric: 'sql_to_sqo_rate',
      timePeriod: 'quarter',
    },
    explanation: "Quarterly conversion rate trend",
  },

  // ===========================================================================
  // COMPARISON QUESTIONS
  // ===========================================================================
  {
    question: "Compare SQOs this quarter vs last quarter",
    expectedMapping: {
      templateId: 'period_comparison',
      metric: 'sqos',
      currentPeriod: 'this_quarter',
      previousPeriod: 'last_quarter',
    },
    explanation: "QoQ comparison for SQOs",
  },
  
  {
    question: "How do SQLs this month compare to last month?",
    expectedMapping: {
      templateId: 'period_comparison',
      metric: 'sqls',
      currentPeriod: 'this_month',
      previousPeriod: 'last_month',
    },
    explanation: "MoM comparison for SQLs",
  },

  // ===========================================================================
  // TOP N / RANKING QUESTIONS
  // ===========================================================================
  {
    question: "Top 5 sources by SQOs this quarter",
    expectedMapping: {
      templateId: 'top_n',
      metric: 'sqos',
      dimension: 'source',
      limit: 5,
      sortDirection: 'DESC',
      dateRange: 'this_quarter',
    },
    explanation: "Top 5 sources ranked by SQO count",
  },
  
  {
    question: "Which channels are underperforming?",
    expectedMapping: {
      templateId: 'top_n',
      metric: 'sql_to_sqo_rate', // Or agent might choose sqos
      dimension: 'channel',
      sortDirection: 'ASC', // underperforming = lowest
    },
    explanation: "Bottom channels by conversion/volume",
  },
  
  {
    question: "SGA leaderboard by SQOs quarter to date",
    expectedMapping: {
      templateId: 'sga_leaderboard',
      metric: 'sqos',
      dateRange: 'this_quarter',
    },
    explanation: "Rank SGAs by SQO count",
  },

  // ===========================================================================
  // AUM QUESTIONS
  // ===========================================================================
  {
    question: "What was the average AUM of advisors that joined in 2025?",
    expectedMapping: {
      templateId: 'average_aum',
      populationFilter: 'joined advisors',
      dateRange: { startDate: '2025-01-01', endDate: '2025-12-31' },
    },
    explanation: "Average AUM filtered to joined advisors in 2025",
    note: "Uses COALESCE(Underwritten_AUM__c, Amount)",
  },
  
  {
    question: "What's our signed AUM this quarter?",
    expectedMapping: {
      templateId: 'single_metric',
      metric: 'signed_aum',
      dateRange: 'this_quarter',
    },
    explanation: "Total AUM of opps entering Signed stage",
    note: "Signed stage = StageName = 'Signed', AUM = COALESCE(Underwritten_AUM__c, Amount)",
  },
  
  {
    question: "What's the open pipeline AUM?",
    expectedMapping: {
      templateId: 'single_metric',
      metric: 'open_pipeline_aum',
      // NO date filter - this is a snapshot
    },
    explanation: "Current open pipeline value (no date filter)",
  },
  
  {
    question: "Total joined AUM by channel this year",
    expectedMapping: {
      templateId: 'metric_by_dimension',
      metric: 'joined_aum',
      dimension: 'channel',
      dateRange: 'ytd',
    },
    explanation: "Joined AUM broken down by channel",
  },

  // ===========================================================================
  // CALL SCHEDULING QUESTIONS
  // ===========================================================================
  {
    question: "Who has initial calls scheduled for next week?",
    expectedMapping: {
      templateId: 'scheduled_calls_list',
      dateRange: 'next_week',
    },
    explanation: "List of upcoming initial calls (can include future dates)",
  },
  
  {
    question: "Show me initial calls scheduled for John Doe this month",
    expectedMapping: {
      templateId: 'scheduled_calls_list',
      filters: { sga: 'John Doe' },
      dateRange: 'this_month',
    },
    explanation: "Initial calls for specific SGA",
  },
  
  {
    question: "Qualification calls by SGM this quarter",
    expectedMapping: {
      templateId: 'metric_by_dimension',
      metric: 'qualification_calls',
      dimension: 'sgm',
      dateRange: 'this_quarter',
    },
    explanation: "Qual call count by SGM",
  },

  // ===========================================================================
  // LIST/DETAIL QUESTIONS
  // ===========================================================================
  {
    question: "Show me SQOs for Sarah Smith quarter to date",
    expectedMapping: {
      templateId: 'sqo_detail_list',
      filters: { sga: 'Sarah Smith' },
      dateRange: 'this_quarter',
    },
    explanation: "SQO details filtered to specific SGA",
  },
  
  {
    question: "What's in the open pipeline?",
    expectedMapping: {
      templateId: 'open_pipeline_list',
    },
    explanation: "Current open opportunities (no date filter)",
  },
  
  {
    question: "Open pipeline for Negotiating stage",
    expectedMapping: {
      templateId: 'open_pipeline_list',
      filters: { stage_name: 'Negotiating' },
    },
    explanation: "Open pipeline filtered to Negotiating stage",
  },

  // ===========================================================================
  // FORECAST QUESTIONS
  // ===========================================================================
  {
    question: "How are we tracking against forecast this quarter?",
    expectedMapping: {
      templateId: 'forecast_vs_actual',
      dateRange: 'this_quarter',
    },
    explanation: "Compare actuals to forecast goals",
  },
  
  {
    question: "Are we on pace to hit SQO goals?",
    expectedMapping: {
      templateId: 'forecast_vs_actual',
      dateRange: 'this_quarter', // Infer current quarter
    },
    explanation: "Check SQO attainment vs forecast",
  },

  // ===========================================================================
  // COMPLEX / MULTI-FILTER QUESTIONS
  // ===========================================================================
  {
    question: "How many SQOs did Paid Search generate for John Doe's team this quarter?",
    expectedMapping: {
      templateId: 'single_metric',
      metric: 'sqos',
      dateRange: 'this_quarter',
      filters: { 
        channel: 'Paid Search',
        sga: 'John Doe', // Or SGM if "team" implies managing role
      },
    },
    explanation: "Multi-filter: channel + SGA + date range",
  },
  
  {
    question: "Top 10 sources by SQL to SQO rate for Organic channel",
    expectedMapping: {
      templateId: 'top_n',
      metric: 'sql_to_sqo_rate',
      dimension: 'source',
      limit: 10,
      filters: { channel: 'Organic' },
    },
    explanation: "Ranked conversion rate with channel filter",
  },

  // ===========================================================================
  // MULTI-STAGE CONVERSION QUESTIONS
  // ===========================================================================
  {
    question: "What's our MQL to Joined rate?",
    expectedMapping: {
      templateId: 'multi_stage_conversion',
      startStage: 'mql',
      endStage: 'joined',
      dateRange: 'this_quarter',
    },
    explanation: "End-to-end conversion from MQL to Joined using cohort mode",
    note: "Uses direct cohort calculation (more accurate than chaining rates)",
  },
  
  {
    question: "Contacted to Joined conversion rate",
    expectedMapping: {
      templateId: 'multi_stage_conversion',
      startStage: 'contacted',
      endStage: 'joined',
      dateRange: 'ytd',
    },
    explanation: "Multi-stage conversion from Contacted to Joined",
  },

  // ===========================================================================
  // TIME-TO-CONVERT QUESTIONS
  // ===========================================================================
  {
    question: "What's the average time from MQL to SQL?",
    expectedMapping: {
      templateId: 'time_to_convert',
      startStage: 'mql',
      endStage: 'sql',
      statistic: 'avg',
      dateRange: 'this_quarter',
    },
    explanation: "Average days between MQL and SQL stages",
  },
  
  {
    question: "How long does it take for SQLs to become SQOs?",
    expectedMapping: {
      templateId: 'time_to_convert',
      startStage: 'sql',
      endStage: 'sqo',
      statistic: 'median',
      dateRange: 'this_quarter',
    },
    explanation: "Median time from SQL to SQO",
  },
  
  {
    question: "Show me the 90th percentile time from SQO to Joined",
    expectedMapping: {
      templateId: 'time_to_convert',
      startStage: 'sqo',
      endStage: 'joined',
      statistic: 'p90',
      dateRange: 'ytd',
    },
    explanation: "90th percentile time to convert from SQO to Joined",
  },

  // ===========================================================================
  // PIPELINE BY STAGE QUESTIONS
  // ===========================================================================
  {
    question: "How many opportunities are in each stage?",
    expectedMapping: {
      templateId: 'pipeline_by_stage',
    },
    explanation: "Open pipeline breakdown by stage (count and AUM)",
  },
  
  {
    question: "Show me the pipeline broken down by stage",
    expectedMapping: {
      templateId: 'pipeline_by_stage',
    },
    explanation: "Pipeline stage breakdown",
  },
  
  {
    question: "What's the AUM in each pipeline stage for Paid Search?",
    expectedMapping: {
      templateId: 'pipeline_by_stage',
      filters: { channel: 'Paid Search' },
    },
    explanation: "Pipeline by stage filtered by channel",
  },

  // ===========================================================================
  // SGA SUMMARY QUESTIONS
  // ===========================================================================
  {
    question: "How is Chris Morgan doing this quarter?",
    expectedMapping: {
      templateId: 'sga_summary',
      sga: 'Chris Morgan',
      dateRange: 'this_quarter',
    },
    explanation: "Complete SGA performance summary (all metrics in one query)",
  },
  
  {
    question: "Show me a complete summary for John Doe",
    expectedMapping: {
      templateId: 'sga_summary',
      sga: 'John Doe',
      dateRange: 'this_quarter', // Agent should infer current period
    },
    explanation: "SGA summary with inferred date range",
  },
  
  {
    question: "SGA performance summary for Sarah Smith YTD",
    expectedMapping: {
      templateId: 'sga_summary',
      sga: 'Sarah Smith',
      dateRange: 'ytd',
    },
    explanation: "SGA summary for year-to-date period",
  },

  // ===========================================================================
  // ROLLING AVERAGE QUESTIONS
  // ===========================================================================
  {
    question: "What's our 30-day rolling average for SQOs?",
    expectedMapping: {
      templateId: 'rolling_average',
      metric: 'sqos',
      windowDays: 30,
      outputFormat: 'single_value',
      dateRange: 'last_30_days',
    },
    explanation: "Single value rolling average (most recent 30-day average)",
  },
  
  {
    question: "Show me trailing 90-day MQL volume",
    expectedMapping: {
      templateId: 'rolling_average',
      metric: 'mqls',
      windowDays: 90,
      outputFormat: 'time_series',
      dateRange: 'last_90_days',
    },
    explanation: "Time series rolling average (daily values with 90-day rolling average)",
  },
  
  {
    question: "30-day rolling average of SQLs by channel",
    expectedMapping: {
      templateId: 'rolling_average',
      metric: 'sqls',
      windowDays: 30,
      dimension: 'channel',
      outputFormat: 'time_series',
      dateRange: 'last_30_days',
    },
    explanation: "Rolling average grouped by channel (each channel gets independent rolling average)",
  },
  
  {
    question: "What's the current 60-day rolling average for Joined advisors?",
    expectedMapping: {
      templateId: 'rolling_average',
      metric: 'joined',
      windowDays: 60,
      outputFormat: 'single_value',
      dateRange: 'last_60_days',
    },
    explanation: "Single value rolling average (most recent 60-day average)",
  },
  
  {
    question: "SQO trend by month with 3-month rolling average",
    expectedMapping: {
      templateId: 'metric_trend',
      metric: 'sqos',
      timePeriod: 'month',
      includeRollingAverage: true,
      rollingAverageWindow: 3,
      dateRange: 'ytd',
    },
    explanation: "Monthly trend with 3-month rolling average of period aggregates",
  },

  // ===========================================================================
  // OPPORTUNITIES BY AGE QUESTIONS
  // ===========================================================================
  {
    question: "What open opportunities are more than 180 days old?",
    expectedMapping: {
      templateId: 'opportunities_by_age',
      ageMethod: 'from_creation',
      ageThreshold: 180,
      stageFilter: 'open_pipeline',
    },
    explanation: "Open pipeline opportunities older than 180 days from creation",
  },
  
  {
    question: "What on hold opportunities are more than 200 days old? and who is the owning SGM?",
    expectedMapping: {
      templateId: 'opportunities_by_age',
      ageMethod: 'from_stage_entry',
      ageThreshold: 200,
      stageFilter: 'On Hold',
      groupBy: ['sgm'],
    },
    explanation: "On Hold opportunities older than 200 days from stage entry, grouped by SGM",
  },
  
  {
    question: "Show me opportunities in Discovery that are more than 90 days old",
    expectedMapping: {
      templateId: 'opportunities_by_age',
      ageMethod: 'from_stage_entry',
      ageThreshold: 90,
      stageFilter: 'Discovery',
    },
    explanation: "Discovery stage opportunities older than 90 days from stage entry",
  },
  
  {
    question: "Which opportunities created more than 150 days ago are still in Sales Process?",
    expectedMapping: {
      templateId: 'opportunities_by_age',
      ageMethod: 'from_creation',
      ageThreshold: 150,
      stageFilter: 'Sales Process',
    },
    explanation: "Sales Process opportunities older than 150 days from creation",
  },
];

// =============================================================================
// QUESTIONS THE SEMANTIC LAYER CANNOT ANSWER
// These should trigger a helpful redirect from the agent
// =============================================================================
export const UNSUPPORTED_QUESTIONS = [
  {
    question: "Why did Q3 underperform?",
    reason: "Requires causal reasoning, not data retrieval",
    suggestedRedirect: "I can show you Q3 metrics vs Q2. Would that help?",
  },
  {
    question: "Should we invest more in LPL?",
    reason: "Business judgment, not data analysis",
    suggestedRedirect: "I can show you LPL's performance metrics and conversion rates.",
  },
  {
    question: "What will our Q2 SQOs be?",
    reason: "Prediction, not historical data",
    suggestedRedirect: "I can show you Q2 forecast goals or historical Q2 performance.",
  },
  {
    question: "Tell me about the advisor named John Smith",
    reason: "Individual advisor lookup not supported (would need different data)",
    suggestedRedirect: "I can show you funnel records by advisor name if you know more details.",
  },
];

// =============================================================================
// METRIC COVERAGE MATRIX
// Validates that all dashboard metrics are covered
// =============================================================================
export const METRIC_COVERAGE = {
  // Volume metrics
  prospects: { status: 'covered', dateField: 'FilterDate' },
  contacted: { status: 'covered', dateField: 'stage_entered_contacting__c' },
  mqls: { status: 'covered', dateField: 'mql_stage_entered_ts' },
  sqls: { status: 'covered', dateField: 'converted_date_raw' },
  sqos: { status: 'covered', dateField: 'Date_Became_SQO__c', note: 'Requires recruitingRecordType + is_sqo_unique' },
  joined: { status: 'covered', dateField: 'advisor_join_date__c', note: 'Requires is_joined_unique' },
  
  // AUM metrics  
  sqo_aum: { status: 'covered', note: 'COALESCE(Underwritten_AUM__c, Amount)' },
  joined_aum: { status: 'covered', note: 'COALESCE(Underwritten_AUM__c, Amount)' },
  signed_aum: { status: 'covered', dateField: 'Stage_Entered_Signed__c' },
  open_pipeline_aum: { status: 'covered', note: 'No date filter - current snapshot' },
  avg_aum: { status: 'covered', note: 'Requires population filter' },
  
  // Conversion rates (ALWAYS use COHORT MODE)
  contacted_to_mql_rate: { status: 'covered', cohortField: 'stage_entered_contacting__c', note: 'Uses cohort mode (progression/eligibility flags)' },
  mql_to_sql_rate: { status: 'covered', cohortField: 'mql_stage_entered_ts', note: 'Uses cohort mode (progression/eligibility flags)' },
  sql_to_sqo_rate: { status: 'covered', cohortField: 'converted_date_raw', note: 'Uses cohort mode (progression/eligibility flags)' },
  sqo_to_joined_rate: { status: 'covered', cohortField: 'Date_Became_SQO__c', note: 'Uses cohort mode (progression/eligibility flags)' },
  
  // Multi-stage conversion
  multi_stage_conversion: { status: 'covered', note: 'Direct cohort calculation (e.g., MQL to Joined)' },
  
  // Time-to-convert
  time_to_convert: { status: 'covered', note: 'Average/median days between stages' },
  
  // Rolling averages
  rolling_average: { status: 'covered', note: 'Rolling average over configurable window (always uses daily aggregation)' },
  
  // Age-based opportunity analysis
  opportunities_by_age: { status: 'covered', note: 'Flexible age-based analysis with user-defined thresholds (no defaults)' },
  
  // Activity metrics
  initial_calls_scheduled: { status: 'covered', dateField: 'Initial_Call_Scheduled_Date__c' },
  qualification_calls: { status: 'covered', dateField: 'Qualification_Call_Date__c' },
};

// =============================================================================
// DIMENSION COVERAGE
// =============================================================================
export const DIMENSION_COVERAGE = {
  channel: { status: 'covered', note: 'Uses new_mapping JOIN' },
  source: { status: 'covered' },
  sga: { status: 'covered', note: 'Lead-level uses SGA_Owner_Name__c, Opp-level checks both' },
  sgm: { status: 'covered' },
  experimentation_tag: { status: 'covered', note: 'Uses UNNEST for filtering' },
  stage_name: { status: 'covered' },
  aum_tier: { status: 'covered' },
  record_type: { status: 'covered' },
  tof_stage: { status: 'covered' },
  lead_score_tier: { status: 'covered' },
  external_agency: { status: 'covered' },
};

// =============================================================================
// RUN VALIDATION (for testing)
// =============================================================================
export function validateSemanticLayer(): { 
  passed: boolean; 
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Check all metrics are defined
  for (const [metric, status] of Object.entries(METRIC_COVERAGE)) {
    const volumeMetrics = SEMANTIC_LAYER.volumeMetrics as Record<string, any>;
    const aumMetrics = SEMANTIC_LAYER.aumMetrics as Record<string, any>;
    const conversionMetrics = SEMANTIC_LAYER.conversionMetrics as Record<string, any>;
    
    if (!volumeMetrics[metric] && !aumMetrics[metric] && !conversionMetrics[metric]) {
      errors.push(`Metric '${metric}' in coverage matrix but not in definitions`);
    }
  }
  
  // Check all dimensions are defined
  for (const [dimension, status] of Object.entries(DIMENSION_COVERAGE)) {
    if (!SEMANTIC_LAYER.dimensions[dimension as keyof typeof SEMANTIC_LAYER.dimensions]) {
      errors.push(`Dimension '${dimension}' in coverage matrix but not in definitions`);
    }
  }
  
  // Check all templates reference valid metrics/dimensions
  for (const [templateId, template] of Object.entries(QUERY_TEMPLATES)) {
    if (!template.template) {
      errors.push(`Template '${templateId}' missing template SQL`);
    }
    if (!template.visualization) {
      warnings.push(`Template '${templateId}' missing visualization type`);
    }
  }
  
  return {
    passed: errors.length === 0,
    errors,
    warnings,
  };
}
