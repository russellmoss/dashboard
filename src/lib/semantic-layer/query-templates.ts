// =============================================================================
// QUERY TEMPLATES
// Pre-verified SQL patterns that the agent selects from
// 
// The agent's job is to:
// 1. Parse the user's question
// 2. Select the appropriate template
// 3. Fill in the parameters
// 
// The compiler then assembles the final SQL from these verified building blocks.
// This ensures no hallucinated SQL - only validated patterns.
//
// Location: src/lib/semantic-layer/query-templates.ts
// =============================================================================

import { CONSTANTS } from './definitions';

const { FULL_TABLE, MAPPING_TABLE, RECRUITING_RECORD_TYPE, OPEN_PIPELINE_STAGES } = CONSTANTS;

// =============================================================================
// BASE QUERY STRUCTURE
// All queries follow this pattern with consistent JOINs and required filters
// =============================================================================
export const BASE_QUERY = {
  from: `FROM \`${FULL_TABLE}\` v`,
  channelJoin: `LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source`,
  // Always-applied filters (recruiting record type for opp-level metrics)
  recruitingRecordTypeParam: RECRUITING_RECORD_TYPE,
  openPipelineStages: OPEN_PIPELINE_STAGES,
};

// =============================================================================
// QUERY TEMPLATES
// =============================================================================
export const QUERY_TEMPLATES = {
  
  // ===========================================================================
  // SINGLE METRIC - Get total for one metric in a date range
  // ===========================================================================
  single_metric: {
    id: 'single_metric',
    description: 'Calculate a single metric total for a date range',
    
    template: `
      SELECT
        {metric} as value
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE 1=1
        {dimensionFilters}
    `,
    
    parameters: {
      metric: { type: 'metric', required: true },
      startDate: { type: 'date', required: true },
      endDate: { type: 'date', required: true },
      dimensionFilters: { type: 'filter[]', required: false },
    },
    
    visualization: 'metric',
    
    exampleQuestions: [
      'How many SQOs did we have this quarter?',
      'What was our total joined AUM in 2025?',
      'How many MQLs from the LPL campaign?',
    ],
  },

  // ===========================================================================
  // METRIC BY DIMENSION - Get metric grouped by a dimension
  // ===========================================================================
  metric_by_dimension: {
    id: 'metric_by_dimension',
    description: 'Calculate a metric grouped by a dimension',
    
    template: `
      SELECT 
        {dimension} as dimension_value,
        {metric} as metric_value
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE 1=1
        {dimensionFilters}
      GROUP BY dimension_value
      HAVING metric_value > 0
      ORDER BY metric_value DESC
      {limit}
    `,
    
    parameters: {
      metric: { type: 'metric', required: true },
      dimension: { type: 'dimension', required: true },
      startDate: { type: 'date', required: true },
      endDate: { type: 'date', required: true },
      dimensionFilters: { type: 'filter[]', required: false },
      limit: { type: 'integer', required: false, default: null },
    },
    
    visualization: 'bar',
    
    exampleQuestions: [
      'SQOs by channel this quarter',
      'Joined advisors by source YTD',
      'MQLs by SGA this month',
      'SQLs by experimentation tag',
    ],
  },

  // ===========================================================================
  // CONVERSION RATE BY DIMENSION - Get conversion rates by dimension
  // ===========================================================================
  conversion_by_dimension: {
    id: 'conversion_by_dimension',
    description: 'Calculate conversion rates grouped by a dimension',
    
    template: `
      SELECT
        {dimension} as dimension_value,
        {conversionMetric} as rate,
        {numeratorSum} as numerator,
        {denominatorSum} as denominator
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE 1=1
        {dimensionFilters}
      GROUP BY dimension_value
      HAVING denominator > 0
      ORDER BY rate DESC
    `,
    
    parameters: {
      conversionMetric: { type: 'conversionMetric', required: true },
      dimension: { type: 'dimension', required: true },
      startDate: { type: 'date', required: true },
      endDate: { type: 'date', required: true },
      dimensionFilters: { type: 'filter[]', required: false },
    },
    
    visualization: 'bar',
    
    exampleQuestions: [
      'SQL to SQO conversion by channel',
      'MQL to SQL rate by source',
      'Conversion rates by SGA',
      'Win rate by SGM',
    ],
  },

  // ===========================================================================
  // METRIC TREND - Get metric over time periods
  // ===========================================================================
  metric_trend: {
    id: 'metric_trend',
    description: 'Show metric values over time periods (monthly/quarterly) with optional rolling average',
    
    template: `
      WITH period_metrics AS (
        SELECT
          {timePeriod} as period,
          {metric} as metric_value
        FROM \`${FULL_TABLE}\` v
        LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
        WHERE {dateField} IS NOT NULL
          AND {dateField} >= {trendStartDate}
          AND {dateField} <= {trendEndDate}
          {dimensionFilters}
        GROUP BY period
      )
      SELECT
        period,
        metric_value as raw_value,
        {rollingAverageCalculation}
      FROM period_metrics
      ORDER BY period ASC
    `,
    
    parameters: {
      metric: { type: 'metric', required: true },
      timePeriod: { type: 'timeDimension', required: true, enum: ['month', 'quarter', 'week'] },
      trendStartDate: { type: 'date', required: true },
      trendEndDate: { type: 'date', required: true },
      dimensionFilters: { type: 'filter[]', required: false },
      includeRollingAverage: { type: 'boolean', required: false, default: false },
      rollingAverageWindow: { type: 'integer', required: false, min: 1, max: 12, note: 'Number of periods for rolling average (e.g., 3 for 3-month rolling average)' },
    },
    
    visualization: 'line',
    
    exampleQuestions: [
      'SQO trend by month this year',
      'Quarterly MQL volume',
      'Joined advisors month over month',
      'Weekly SQLs for the last 3 months',
      'SQO trend with 3-month rolling average',
    ],
    
    note: 'When includeRollingAverage=true, calculates rolling average of period aggregates using window functions. rollingAverageWindow specifies number of periods (e.g., 3 = 3-month rolling average). Returns both raw_value and rolling_avg for comparison.',
    
    implementationNotes: {
      rollingAverageCalculation: 'When includeRollingAverage=true: AVG(metric_value) OVER (ORDER BY period ROWS BETWEEN rollingAverageWindow-1 PRECEDING AND CURRENT ROW) as rolling_avg',
      whenRollingAverageFalse: 'When includeRollingAverage=false: NULL as rolling_avg (or omit column)',
    },
  },

  // ===========================================================================
  // CONVERSION TREND - Get conversion rates over time
  // ===========================================================================
  conversion_trend: {
    id: 'conversion_trend',
    description: 'Show conversion rates over time periods',
    
    template: `
      SELECT
        {timePeriod} as period,
        {conversionMetric} as rate,
        {numeratorSum} as numerator,
        {denominatorSum} as denominator
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE {cohortDateField} IS NOT NULL
        AND {cohortDateField} >= {trendStartDate}
        AND {cohortDateField} <= {trendEndDate}
        {dimensionFilters}
      GROUP BY period
      ORDER BY period ASC
    `,
    
    parameters: {
      conversionMetric: { type: 'conversionMetric', required: true },
      timePeriod: { type: 'timeDimension', required: true },
      trendStartDate: { type: 'date', required: true },
      trendEndDate: { type: 'date', required: true },
      dimensionFilters: { type: 'filter[]', required: false },
    },
    
    visualization: 'line',
    
    exampleQuestions: [
      'SQL to SQO conversion trend by quarter',
      'Monthly win rate',
      'MQL to SQL rate over time',
    ],
  },

  // ===========================================================================
  // PERIOD COMPARISON - Compare two periods
  // ===========================================================================
  period_comparison: {
    id: 'period_comparison',
    description: 'Compare a metric between two time periods',
    
    template: `
      WITH current_period AS (
        SELECT {metric} as value
        FROM \`${FULL_TABLE}\` v
        LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
        WHERE 1=1
          {currentPeriodFilter}
          {dimensionFilters}
      ),
      previous_period AS (
        SELECT {metric} as value
        FROM \`${FULL_TABLE}\` v
        LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
        WHERE 1=1
          {previousPeriodFilter}
          {dimensionFilters}
      )
      SELECT
        c.value as current_value,
        p.value as previous_value,
        SAFE_DIVIDE(c.value - p.value, p.value) as change_percent,
        c.value - p.value as change_absolute
      FROM current_period c, previous_period p
    `,
    
    parameters: {
      metric: { type: 'metric', required: true },
      currentPeriodStart: { type: 'date', required: true },
      currentPeriodEnd: { type: 'date', required: true },
      previousPeriodStart: { type: 'date', required: true },
      previousPeriodEnd: { type: 'date', required: true },
      dimensionFilters: { type: 'filter[]', required: false },
    },
    
    visualization: 'comparison',
    
    exampleQuestions: [
      'Compare SQOs this quarter vs last quarter',
      'How do SQLs this month compare to last month?',
      'YoY joined advisors comparison',
    ],
  },

  // ===========================================================================
  // TOP N - Get top/bottom N items by metric
  // ===========================================================================
  top_n: {
    id: 'top_n',
    description: 'Get top N (or bottom N) items by a metric',
    
    template: `
      SELECT
        {dimension} as item,
        {metric} as value
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE 1=1
        {dimensionFilters}
      GROUP BY item
      HAVING value > 0
      ORDER BY value {sortDirection}
      LIMIT {limit}
    `,
    
    parameters: {
      metric: { type: 'metric', required: true },
      dimension: { type: 'dimension', required: true },
      startDate: { type: 'date', required: true },
      endDate: { type: 'date', required: true },
      limit: { type: 'integer', required: true, default: 10, max: 50 },
      sortDirection: { type: 'enum', values: ['DESC', 'ASC'], default: 'DESC' },
      dimensionFilters: { type: 'filter[]', required: false },
    },
    
    visualization: 'bar', // Changed from 'table' - rankings are visual comparisons
    
    exampleQuestions: [
      'Top 5 sources by SQOs',
      'Top 10 SGAs by joined AUM',
      'Bottom 5 channels by conversion rate',
      'Which sources have the most MQLs?',
    ],
  },

  // ===========================================================================
  // FUNNEL SUMMARY - Get all funnel metrics in one query
  // ===========================================================================
  funnel_summary: {
    id: 'funnel_summary',
    description: 'Get all funnel stage volumes for a period',
    
    template: `
      SELECT
        {prospects_metric} as prospects,
        {contacted_metric} as contacted,
        {mqls_metric} as mqls,
        {sqls_metric} as sqls,
        {sqos_metric} as sqos,
        {joined_metric} as joined,
        {joined_aum_metric} as joined_aum
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE 1=1
        {dimensionFilters}
    `,
    
    parameters: {
      startDate: { type: 'date', required: true },
      endDate: { type: 'date', required: true },
      dimensionFilters: { type: 'filter[]', required: false },
    },
    
    visualization: 'funnel',
    
    exampleQuestions: [
      'Show me the funnel for Q1',
      'Funnel summary this quarter',
      'How does the funnel look for Paid Search?',
    ],
  },

  // ===========================================================================
  // SCHEDULED CALLS LIST - Get upcoming calls by SGA
  // ===========================================================================
  scheduled_calls_list: {
    id: 'scheduled_calls_list',
    description: 'List scheduled initial calls for a date range',
    
    template: `
      SELECT 
        v.primary_key,
        v.advisor_name,
        v.Initial_Call_Scheduled_Date__c as call_date,
        v.SGA_Owner_Name__c as sga,
        v.Original_source as source,
        COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') as channel,
        v.Lead_Score_Tier__c as lead_score_tier,
        v.TOF_Stage as tof_stage,
        v.lead_url,
        v.opportunity_url
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE v.Initial_Call_Scheduled_Date__c IS NOT NULL
        AND v.Initial_Call_Scheduled_Date__c >= DATE(@startDate)
        AND v.Initial_Call_Scheduled_Date__c <= DATE(@endDate)
        {dimensionFilters}
      ORDER BY v.Initial_Call_Scheduled_Date__c ASC, v.SGA_Owner_Name__c
    `,
    
    parameters: {
      startDate: { type: 'date', required: true },
      endDate: { type: 'date', required: true },
      sga: { type: 'string', required: false },
    },
    
    visualization: 'table',
    
    exampleQuestions: [
      'Who has initial calls scheduled for next week?',
      'Show me initial calls scheduled for John Doe',
      'Upcoming calls for this week',
    ],
  },

  // ===========================================================================
  // QUALIFICATION CALLS LIST - Get qual calls by SGA/SGM
  // ===========================================================================
  qualification_calls_list: {
    id: 'qualification_calls_list',
    description: 'List qualification calls for a date range',
    
    template: `
      SELECT 
        v.primary_key,
        v.advisor_name,
        v.Qualification_Call_Date__c as call_date,
        v.SGA_Owner_Name__c as sga,
        v.SGM_Owner_Name__c as sgm,
        v.Original_source as source,
        COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') as channel,
        COALESCE(v.Underwritten_AUM__c, v.Amount) as aum,
        v.aum_tier,
        v.lead_url,
        v.opportunity_url
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE v.Qualification_Call_Date__c IS NOT NULL
        AND v.Qualification_Call_Date__c >= DATE(@startDate)
        AND v.Qualification_Call_Date__c <= DATE(@endDate)
        {dimensionFilters}
      ORDER BY v.Qualification_Call_Date__c DESC, v.SGM_Owner_Name__c, v.SGA_Owner_Name__c
    `,
    
    parameters: {
      startDate: { type: 'date', required: true },
      endDate: { type: 'date', required: true },
      sga: { type: 'string', required: false },
      sgm: { type: 'string', required: false },
    },
    
    visualization: 'table',
    
    exampleQuestions: [
      'Qualification calls this week',
      'Show qual calls for Sarah Smith this month',
      'Qual calls by SGM this quarter',
    ],
  },

  // ===========================================================================
  // SQO DETAIL LIST - List SQOs with details
  // ===========================================================================
  sqo_detail_list: {
    id: 'sqo_detail_list',
    description: 'List SQO records with full details',
    
    template: `
      SELECT 
        v.primary_key,
        v.advisor_name,
        v.Date_Became_SQO__c as sqo_date,
        v.SGA_Owner_Name__c as sga,
        v.SGM_Owner_Name__c as sgm,
        v.Original_source as source,
        COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') as channel,
        COALESCE(v.Underwritten_AUM__c, v.Amount) as aum,
        v.aum_tier,
        v.StageName as stage,
        v.lead_url,
        v.opportunity_url
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE v.Date_Became_SQO__c IS NOT NULL
        AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDate)
        AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(@endDate)
        AND v.recordtypeid = @recruitingRecordType
        AND v.is_sqo_unique = 1
        {dimensionFilters}
      ORDER BY v.Date_Became_SQO__c DESC, COALESCE(v.Underwritten_AUM__c, v.Amount) DESC
    `,
    
    parameters: {
      startDate: { type: 'date', required: true },
      endDate: { type: 'date', required: true },
      sga: { type: 'string', required: false },
      sgm: { type: 'string', required: false },
      recruitingRecordType: { type: 'constant', value: RECRUITING_RECORD_TYPE },
    },
    
    visualization: 'table',
    
    exampleQuestions: [
      'Show me SQOs for John Doe this quarter',
      'List all SQOs from Paid Search YTD',
      'SQO details for the team this month',
    ],
  },

  // ===========================================================================
  // GENERIC DETAIL LIST - List records for any metric (MQLs, SQLs, etc.)
  // ===========================================================================
  generic_detail_list: {
    id: 'generic_detail_list',
    description: 'List detail records for any volume metric (MQLs, SQLs, Contacted, Prospects, etc.)',
    
    template: `
      SELECT 
        v.primary_key,
        v.advisor_name,
        {dateField} as {dateColumnAlias},
        v.SGA_Owner_Name__c as sga,
        v.SGM_Owner_Name__c as sgm,
        v.Original_source as source,
        COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') as channel,
        {aumColumns}
        v.StageName as stage,
        ARRAY_TO_STRING(v.Experimentation_Tag_List, ', ') as experimentation_tag,
        v.lead_url,
        v.opportunity_url
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE {metricFilter}
        {dateFilters}
        {dimensionFilters}
      ORDER BY v.{dateField} DESC
    `,
    
    parameters: {
      metric: { type: 'metric', required: true },
      dateRange: { type: 'dateRange', required: false },
      filters: { type: 'filter[]', required: false },
    },
    
    visualization: 'table',
    
    exampleQuestions: [
      'Show me all MQLs this quarter',
      'List all SQLs from last month',
      'Who are the people that became MQLs?',
      'Show me all contacted leads this week',
      'Who signed last quarter?',
      'List all signed opportunities this quarter',
      'Who joined last quarter?',
    ],
  },

  // ===========================================================================
  // OPEN PIPELINE LIST - Current open opportunities
  // ===========================================================================
  open_pipeline_list: {
    id: 'open_pipeline_list',
    description: 'List current open pipeline (no date filter - snapshot)',
    
    template: `
      SELECT 
        v.primary_key,
        v.advisor_name,
        v.SGA_Owner_Name__c as sga,
        v.SGM_Owner_Name__c as sgm,
        v.Original_source as source,
        COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') as channel,
        COALESCE(v.Underwritten_AUM__c, v.Amount) as aum,
        v.aum_tier,
        v.StageName as stage,
        v.Date_Became_SQO__c as sqo_date,
        v.lead_url,
        v.opportunity_url
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE v.recordtypeid = @recruitingRecordType
        AND v.StageName IN UNNEST(@openPipelineStages)
        AND v.is_sqo_unique = 1
        {dimensionFilters}
      ORDER BY COALESCE(v.Underwritten_AUM__c, v.Amount) DESC NULLS LAST
    `,
    
    parameters: {
      sga: { type: 'string', required: false },
      sgm: { type: 'string', required: false },
      recruitingRecordType: { type: 'constant', value: RECRUITING_RECORD_TYPE },
      openPipelineStages: { type: 'constant', value: OPEN_PIPELINE_STAGES },
    },
    
    visualization: 'table',
    
    exampleQuestions: [
      'Show me the open pipeline',
      'What opportunities are in Negotiating stage?',
      'Open pipeline for John Doe',
    ],
  },

  // ===========================================================================
  // SGA LEADERBOARD - Rank SGAs by metric
  // ===========================================================================
  sga_leaderboard: {
    id: 'sga_leaderboard',
    description: 'Rank SGAs by a metric',
    
    template: `
      SELECT
        v.SGA_Owner_Name__c as sga,
        {metric} as value,
        RANK() OVER (ORDER BY {metric_for_rank} DESC) as rank
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE v.SGA_Owner_Name__c IS NOT NULL
        {dimensionFilters}
      GROUP BY sga
      HAVING value > 0
      ORDER BY value DESC
      LIMIT {limit}
    `,
    
    parameters: {
      metric: { type: 'metric', required: true },
      startDate: { type: 'date', required: true },
      endDate: { type: 'date', required: true },
      limit: { type: 'integer', default: 20 },
    },
    
    visualization: 'bar', // Changed from 'table' - leaderboards should show relative performance visually
    
    exampleQuestions: [
      'SGA leaderboard by SQOs this quarter',
      'Rank SGAs by joined AUM YTD',
      'Who are the top performers this month?',
    ],
  },

  // ===========================================================================
  // AVERAGE AUM - Calculate average AUM for a population
  // ===========================================================================
  average_aum: {
    id: 'average_aum',
    description: 'Calculate average AUM for a filtered population',
    
    template: `
      SELECT
        AVG(COALESCE(v.Underwritten_AUM__c, v.Amount)) as avg_aum,
        COUNT(*) as record_count,
        MIN(COALESCE(v.Underwritten_AUM__c, v.Amount)) as min_aum,
        MAX(COALESCE(v.Underwritten_AUM__c, v.Amount)) as max_aum
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE COALESCE(v.Underwritten_AUM__c, v.Amount) IS NOT NULL
        AND COALESCE(v.Underwritten_AUM__c, v.Amount) > 0
        {populationFilter}
        {dimensionFilters}
    `,
    
    parameters: {
      populationFilter: { type: 'entityFilter', required: true },
      startDate: { type: 'date', required: false },
      endDate: { type: 'date', required: false },
      dimensionFilters: { type: 'filter[]', required: false },
    },
    
    visualization: 'metric',
    
    exampleQuestions: [
      'Average AUM of joined advisors in 2025',
      'What is the average deal size for SQOs this quarter?',
      'Average AUM by channel',
    ],
  },

  // ===========================================================================
  // FORECAST VS ACTUAL - Compare forecast to actuals
  // ===========================================================================
  forecast_vs_actual: {
    id: 'forecast_vs_actual',
    description: 'Compare forecast goals to actual performance',
    
    template: `
      WITH actuals AS (
        SELECT
          {prospects_metric} as prospects_actual,
          {mqls_metric} as mqls_actual,
          {sqls_metric} as sqls_actual,
          {sqos_metric} as sqos_actual,
          {joined_metric} as joined_actual
        FROM \`${FULL_TABLE}\` v
        LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
        WHERE 1=1
          {dimensionFilters}
      ),
      forecast AS (
        SELECT
          ROUND(SUM(prospects_daily), 2) AS prospects_goal,
          ROUND(SUM(mqls_daily), 2) AS mqls_goal,
          ROUND(SUM(sqls_daily), 2) AS sqls_goal,
          ROUND(SUM(sqos_daily), 2) AS sqos_goal,
          ROUND(SUM(joined_daily), 2) AS joined_goal
        FROM \`${CONSTANTS.DAILY_FORECAST_VIEW}\`
        WHERE date_day BETWEEN @startDate AND @endDate
          {forecastFilters}
      )
      SELECT
        a.prospects_actual,
        f.prospects_goal,
        SAFE_DIVIDE(a.prospects_actual, f.prospects_goal) as prospects_attainment,
        a.mqls_actual,
        f.mqls_goal,
        SAFE_DIVIDE(a.mqls_actual, f.mqls_goal) as mqls_attainment,
        a.sqls_actual,
        f.sqls_goal,
        SAFE_DIVIDE(a.sqls_actual, f.sqls_goal) as sqls_attainment,
        a.sqos_actual,
        f.sqos_goal,
        SAFE_DIVIDE(a.sqos_actual, f.sqos_goal) as sqos_attainment,
        a.joined_actual,
        f.joined_goal,
        SAFE_DIVIDE(a.joined_actual, f.joined_goal) as joined_attainment
      FROM actuals a, forecast f
    `,
    
    parameters: {
      startDate: { type: 'date', required: true },
      endDate: { type: 'date', required: true },
      dimensionFilters: { type: 'filter[]', required: false },
    },
    
    visualization: 'table',
    
    exampleQuestions: [
      'How are we tracking against forecast?',
      'Forecast vs actual this quarter',
      'Are we on pace to hit goals?',
    ],
  },

  // ===========================================================================
  // MULTI-STAGE CONVERSION - Calculate conversion rate across multiple stages
  // Uses COHORT MODE: Direct cohort calculation (more accurate than chaining)
  // ===========================================================================
  multi_stage_conversion: {
    id: 'multi_stage_conversion',
    description: 'Calculate conversion rate across multiple stages (e.g., MQL to Joined) using cohort mode',
    
    template: `
      SELECT
        -- Direct cohort calculation: records that reached start stage AND end stage
        COUNTIF(
          {startStageDateField} IS NOT NULL
          AND TIMESTAMP({startStageDateField}) >= TIMESTAMP(@startDate)
          AND TIMESTAMP({startStageDateField}) <= TIMESTAMP(@endDate)
          AND {endStageDateField} IS NOT NULL
          {startStageFilters}
          {endStageFilters}
        ) as numerator,
        COUNTIF(
          {startStageDateField} IS NOT NULL
          AND TIMESTAMP({startStageDateField}) >= TIMESTAMP(@startDate)
          AND TIMESTAMP({startStageDateField}) <= TIMESTAMP(@endDate)
          {startStageFilters}
        ) as denominator,
        SAFE_DIVIDE(
          COUNTIF(
            {startStageDateField} IS NOT NULL
            AND TIMESTAMP({startStageDateField}) >= TIMESTAMP(@startDate)
            AND TIMESTAMP({startStageDateField}) <= TIMESTAMP(@endDate)
            AND {endStageDateField} IS NOT NULL
            {startStageFilters}
            {endStageFilters}
          ),
          COUNTIF(
            {startStageDateField} IS NOT NULL
            AND TIMESTAMP({startStageDateField}) >= TIMESTAMP(@startDate)
            AND TIMESTAMP({startStageDateField}) <= TIMESTAMP(@endDate)
            {startStageFilters}
          )
        ) as conversion_rate
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE 1=1
        {dimensionFilters}
    `,
    
    parameters: {
      startStage: { type: 'enum', values: ['contacted', 'mql', 'sql', 'sqo'], required: true },
      endStage: { type: 'enum', values: ['mql', 'sql', 'sqo', 'joined'], required: true },
      startDate: { type: 'date', required: true },
      endDate: { type: 'date', required: true },
      dimensionFilters: { type: 'filter[]', required: false },
    },
    
    visualization: 'metric',
    
    exampleQuestions: [
      'What\'s our MQL to Joined rate?',
      'Contacted to Joined conversion rate',
      'Prospect to SQO rate',
      'End-to-end conversion from MQL',
    ],
    
    note: 'Uses direct cohort calculation (more accurate than chaining individual rates). Always uses COHORT MODE.',
  },

  // ===========================================================================
  // TIME TO CONVERT - Calculate average/median days between stages
  // ===========================================================================
  time_to_convert: {
    id: 'time_to_convert',
    description: 'Calculate average/median/min/max days between funnel stages',
    
    template: `
      SELECT
        AVG(DATE_DIFF(DATE({endStageDateField}), DATE({startStageDateField}), DAY)) as avg_days,
        APPROX_QUANTILES(DATE_DIFF(DATE({endStageDateField}), DATE({startStageDateField}), DAY), 100)[OFFSET(50)] as median_days,
        MIN(DATE_DIFF(DATE({endStageDateField}), DATE({startStageDateField}), DAY)) as min_days,
        MAX(DATE_DIFF(DATE({endStageDateField}), DATE({startStageDateField}), DAY)) as max_days,
        APPROX_QUANTILES(DATE_DIFF(DATE({endStageDateField}), DATE({startStageDateField}), DAY), 100)[OFFSET(25)] as p25_days,
        APPROX_QUANTILES(DATE_DIFF(DATE({endStageDateField}), DATE({startStageDateField}), DAY), 100)[OFFSET(75)] as p75_days,
        APPROX_QUANTILES(DATE_DIFF(DATE({endStageDateField}), DATE({startStageDateField}), DAY), 100)[OFFSET(90)] as p90_days,
        COUNT(*) as record_count
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE {startStageDateField} IS NOT NULL
        AND {endStageDateField} IS NOT NULL
        AND TIMESTAMP({startStageDateField}) >= TIMESTAMP(@startDate)
        AND TIMESTAMP({startStageDateField}) <= TIMESTAMP(@endDate)
        {startStageFilters}
        {endStageFilters}
        {dimensionFilters}
    `,
    
    parameters: {
      startStage: { type: 'enum', values: ['contacted', 'mql', 'sql', 'sqo'], required: true },
      endStage: { type: 'enum', values: ['mql', 'sql', 'sqo', 'joined'], required: true },
      statistic: { type: 'enum', values: ['avg', 'median', 'min', 'max', 'p25', 'p75', 'p90'], default: 'avg' },
      startDate: { type: 'date', required: true },
      endDate: { type: 'date', required: true },
      dimensionFilters: { type: 'filter[]', required: false },
    },
    
    visualization: 'metric',
    
    exampleQuestions: [
      'What\'s the average time from MQL to SQL?',
      'How long does it take for SQLs to become SQOs?',
      'Show me median days from Contacted to Joined',
      'What\'s the 90th percentile time from SQO to Joined?',
    ],
    
    note: 'Uses DATE_DIFF() for time calculation. DATE fields need DATE() casting, TIMESTAMP fields can use directly.',
  },

  // ===========================================================================
  // PIPELINE BY STAGE - Breakdown open pipeline by opportunity stage
  // ===========================================================================
  pipeline_by_stage: {
    id: 'pipeline_by_stage',
    description: 'Show open pipeline broken down by opportunity stage (count and AUM)',
    
    template: `
      SELECT
        v.StageName as stage,
        COUNT(*) as opp_count,
        SUM(COALESCE(v.Underwritten_AUM__c, v.Amount, 0)) as total_aum,
        AVG(COALESCE(v.Underwritten_AUM__c, v.Amount, 0)) as avg_aum
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE v.recordtypeid = @recruitingRecordType
        AND v.StageName IN UNNEST(@openPipelineStages)
        AND v.is_sqo_unique = 1
        {dimensionFilters}
      GROUP BY stage
      ORDER BY 
        CASE stage
          WHEN 'Qualifying' THEN 1
          WHEN 'Discovery' THEN 2
          WHEN 'Sales Process' THEN 3
          WHEN 'Negotiating' THEN 4
        END
    `,
    
    parameters: {
      recruitingRecordType: { type: 'constant', value: RECRUITING_RECORD_TYPE },
      openPipelineStages: { type: 'constant', value: OPEN_PIPELINE_STAGES },
      dimensionFilters: { type: 'filter[]', required: false },
    },
    
    visualization: 'bar',
    
    exampleQuestions: [
      'How many opportunities are in each stage?',
      'Show me the pipeline broken down by stage',
      'What\'s the AUM in each pipeline stage?',
      'Pipeline by stage for Paid Search channel',
    ],
    
    note: 'Uses OPEN_PIPELINE_STAGES constant. AUM uses COALESCE(Underwritten_AUM__c, Amount, 0) pattern.',
  },

  // ===========================================================================
  // SGA SUMMARY - Complete performance summary for a specific SGA
  // ===========================================================================
  sga_summary: {
    id: 'sga_summary',
    description: 'Complete performance summary for a specific SGA (all key metrics in one query)',
    
    template: `
      SELECT
        -- Volume metrics (lead-level: use SGA_Owner_Name__c)
        {prospects_metric} as prospects,
        {contacted_metric} as contacted,
        {mqls_metric} as mqls,
        {sqls_metric} as sqls,
        -- Volume metrics (opportunity-level: use OR logic)
        {sqos_metric} as sqos,
        {joined_metric} as joined,
        -- AUM metrics (opportunity-level: use OR logic)
        {sqo_aum_metric} as sqo_aum,
        {joined_aum_metric} as joined_aum,
        -- Conversion rates (cohort mode)
        {contacted_to_mql_rate} as contacted_to_mql_rate,
        {mql_to_sql_rate} as mql_to_sql_rate,
        {sql_to_sqo_rate} as sql_to_sqo_rate,
        {sqo_to_joined_rate} as sqo_to_joined_rate
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE 1=1
        {sgaFilter}  -- Applied correctly per metric type (lead vs opportunity)
    `,
    
    parameters: {
      sga: { type: 'string', required: true },
      startDate: { type: 'date', required: true },
      endDate: { type: 'date', required: true },
    },
    
    visualization: 'table',
    
    exampleQuestions: [
      'How is Chris Morgan doing this quarter?',
      'Show me a complete summary for John Doe',
      'SGA performance summary for Sarah Smith YTD',
    ],
    
    note: 'Lead-level metrics use SGA_Owner_Name__c only. Opportunity-level metrics use (SGA_Owner_Name__c = @sga OR Opp_SGA_Name__c = @sga). All conversion rates use COHORT MODE.',
  },

  // ===========================================================================
  // ROLLING AVERAGE - Calculate rolling average of metrics over time
  // Supports both time series (daily) and single value outputs
  // Always uses daily aggregation, then rolling average window
  // ===========================================================================
  rolling_average: {
    id: 'rolling_average',
    description: 'Calculate rolling average of a metric over a configurable time window (always uses daily aggregation)',
    
    template: `
      WITH daily_metrics AS (
        SELECT
          DATE({dateField}) as date,
          {dimensionGroupBy}
          {metric} as metric_value
        FROM \`${FULL_TABLE}\` v
        LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
        WHERE {dateField} IS NOT NULL
          AND DATE({dateField}) >= DATE_SUB(@endDate, INTERVAL @windowDays DAY)
          AND DATE({dateField}) <= @endDate
          {dimensionFilters}
        GROUP BY date {dimensionGroupByList}
      ),
      rolling_calculated AS (
        SELECT
          date,
          {dimensionSelect}
          metric_value as raw_value,
          AVG(metric_value) OVER (
            {partitionBy}
            ORDER BY date
            ROWS BETWEEN @windowDaysMinusOne PRECEDING AND CURRENT ROW
          ) as rolling_avg,
          COUNT(*) OVER (
            {partitionBy}
            ORDER BY date
            ROWS BETWEEN @windowDaysMinusOne PRECEDING AND CURRENT ROW
          ) as days_in_window
        FROM daily_metrics
        WHERE date >= @startDate
      )
      SELECT
        date,
        {dimensionSelect}
        raw_value,
        rolling_avg,
        days_in_window,
        CASE 
          WHEN days_in_window < @windowDays 
          THEN CONCAT('Note: Only ', CAST(days_in_window AS STRING), ' days of data available within the ', CAST(@windowDays AS STRING), '-day window')
          ELSE NULL
        END as data_availability_note
      FROM rolling_calculated
      {singleValueFilter}
      ORDER BY {dimensionOrderBy}date
    `,
    
    parameters: {
      metric: { type: 'metric', required: true },
      windowDays: { type: 'integer', required: true, min: 1, max: 365 },
      startDate: { type: 'date', required: true },
      endDate: { type: 'date', required: true },
      dimension: { type: 'dimension', required: false },
      dimensionFilters: { type: 'filter[]', required: false },
      outputFormat: { type: 'enum', values: ['time_series', 'single_value'], default: 'time_series' },
    },
    
    visualization: 'line',
    
    exampleQuestions: [
      'What\'s our 30-day rolling average for SQOs?',
      'Show me trailing 90-day MQL volume',
      '30-day rolling average of SQLs by channel',
      'What\'s the current 60-day rolling average for Joined advisors?',
      'Rolling average of SQOs by source for the last 90 days',
    ],
    
    note: 'Always uses daily aggregation first, then applies rolling window. Returns both raw_value and rolling_avg for comparison. days_in_window shows actual days available (may be less than windowDays for early dates). Calendar-based windows (not business days). For single_value output, returns the most recent rolling_avg value with raw_value for comparison.',
    
    implementationNotes: {
      windowCalculation: 'windowDaysMinusOne = windowDays - 1 (for ROWS BETWEEN)',
      dateFieldHandling: 'DATE() casting for both DATE and TIMESTAMP fields',
      dimensionGrouping: 'When dimension provided, uses PARTITION BY dimension in window function',
      singleValueOutput: 'When outputFormat=single_value, filter to WHERE date = (SELECT MAX(date) FROM rolling_calculated)',
      insufficientData: 'days_in_window < windowDays indicates partial window (e.g., only 10 days available for 30-day window)',
    },
  },

  // ===========================================================================
  // OPPORTUNITIES BY AGE - Find opportunities older than specified age threshold
  // Flexible age-based analysis without hardcoded "stale" definition
  // ===========================================================================
  opportunities_by_age: {
    id: 'opportunities_by_age',
    description: 'Find opportunities older than a specified age threshold (user-defined, no default thresholds)',
    
    template: `
      WITH opportunity_ages AS (
        SELECT
          v.primary_key,
          v.Full_Opportunity_ID__c,
          v.advisor_name,
          v.StageName,
          v.Opportunity_AUM,
          v.aum_tier,
          COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') as channel,
          v.Original_source as source,
          v.SGA_Owner_Name__c,
          v.Opp_SGA_Name__c,
          v.SGM_Owner_Name__c,
          v.Opp_CreatedDate,
          {ageCalculation}
          {dimensionGroupBy}
        FROM \`${FULL_TABLE}\` v
        LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
        WHERE v.recordtypeid = @recruitingRecordType
          AND v.is_sqo_unique = 1
          {stageFilter}
          {dimensionFilters}
      )
      SELECT
        primary_key,
        Full_Opportunity_ID__c,
        advisor_name,
        StageName,
        Opportunity_AUM,
        aum_tier,
        channel,
        source,
        SGA_Owner_Name__c,
        Opp_SGA_Name__c,
        SGM_Owner_Name__c,
        age_in_days,
        {dimensionSelect}
        DATE(Opp_CreatedDate) as created_date,
        {mostRecentStageEntryDate}
      FROM opportunity_ages
      WHERE age_in_days >= @ageThreshold
      ORDER BY age_in_days DESC, advisor_name
    `,
    
    parameters: {
      ageMethod: { type: 'enum', values: ['from_creation', 'from_stage_entry'], required: true },
      ageThreshold: { type: 'integer', required: true, min: 1, note: 'User-defined age threshold in days (no defaults)' },
      recruitingRecordType: { type: 'constant', value: RECRUITING_RECORD_TYPE },
      openPipelineStages: { type: 'constant', value: OPEN_PIPELINE_STAGES },
      stageFilter: { type: 'filter', required: false, note: 'Optional: Filter by StageName (e.g., "On Hold", "open_pipeline", specific stages)' },
      aumTierFilter: { type: 'filter', required: false, note: 'Optional: Filter by AUM tier' },
      dimensionFilters: { type: 'filter[]', required: false, note: 'Optional: Additional filters (SGA, SGM, Channel, Source)' },
      groupBy: { type: 'dimension[]', required: false, note: 'Optional: Group by dimensions (SGA, SGM, Channel, AUM tier, Source)' },
    },
    
    visualization: 'table',
    
    exampleQuestions: [
      'What open opportunities are more than 180 days old?',
      'What on hold opportunities are more than 200 days old? and who is the owning SGM?',
      'Show me opportunities in Discovery that are more than 90 days old',
      'Which opportunities created more than 150 days ago are still in Sales Process?',
    ],
    
    note: 'No default age thresholds - users define thresholds via ageThreshold parameter. Supports filtering by stage, AUM tier, SGA, SGM, Channel, Source. Supports grouping by dimensions. Age can be calculated from creation date or most recent stage entry date.',
    
    implementationNotes: {
      ageCalculationFromCreation: 'When ageMethod=from_creation: DATE_DIFF(CURRENT_DATE(), DATE(Opp_CreatedDate), DAY) as age_in_days',
      ageCalculationFromStageEntry: 'When ageMethod=from_stage_entry: DATE_DIFF(CURRENT_DATE(), DATE(GREATEST(Stage_Entered_Discovery__c, Stage_Entered_Sales_Process__c, Stage_Entered_Negotiating__c, Stage_Entered_On_Hold__c, Stage_Entered_Signed__c)), DAY) as age_in_days',
      mostRecentStageEntryDate: 'When ageMethod=from_stage_entry: Include DATE(GREATEST(Stage_Entered_Discovery__c, Stage_Entered_Sales_Process__c, Stage_Entered_Negotiating__c, Stage_Entered_On_Hold__c, Stage_Entered_Signed__c)) as most_recent_stage_entry_date',
      stageFilterOpenPipeline: 'When stageFilter="open_pipeline": Use StageName IN UNNEST(@openPipelineStages)',
      stageFilterSpecific: 'When stageFilter is specific stage: Use StageName = @stageFilter',
      dateFieldHandling: 'Opp_CreatedDate is TIMESTAMP - use DATE() casting. Stage entry dates are TIMESTAMP - use DATE() casting.',
    },
  },
} as const;

// =============================================================================
// VISUALIZATION TYPES
// Maps template outputs to appropriate chart types
// =============================================================================
export const VISUALIZATION_TYPES = {
  metric: {
    description: 'Single metric display (scorecard)',
    components: ['value', 'label', 'comparison'],
  },
  bar: {
    description: 'Bar chart for categorical comparisons',
    components: ['dimension', 'value', 'optional_second_value'],
  },
  line: {
    description: 'Line chart for trends over time',
    components: ['period', 'value', 'optional_second_value'],
  },
  table: {
    description: 'Data table with sortable columns',
    components: ['columns', 'rows', 'optional_links'],
  },
  funnel: {
    description: 'Funnel visualization for stage progression',
    components: ['stages', 'values', 'conversion_rates'],
  },
  comparison: {
    description: 'Period-over-period comparison',
    components: ['current', 'previous', 'change_percent', 'change_absolute'],
  },
} as const;

// =============================================================================
// QUESTION PATTERNS
// Patterns the agent uses to identify question types
// =============================================================================
export const QUESTION_PATTERNS = {
  // Volume questions
  volume: {
    patterns: [
      /how many (prospects|contacted|mqls|sqls|sqos|joined)/i,
      /total (prospects|contacted|mqls|sqls|sqos|joined)/i,
      /number of (prospects|contacted|mqls|sqls|sqos|joined)/i,
      /count of/i,
    ],
    templateHint: 'single_metric or metric_by_dimension',
  },
  
  // Conversion questions
  conversion: {
    patterns: [
      /conversion rate/i,
      /convert/i,
      /win rate/i,
      /close rate/i,
      /what percent/i,
      /what percentage/i,
      /(mql|sql|sqo|contacted).*to.*(joined|sqo|sql|mql)/i,  // Multi-stage conversion
    ],
    templateHint: 'conversion_by_dimension or conversion_trend or multi_stage_conversion',
  },
  
  // Time/velocity questions
  velocity: {
    patterns: [
      /how long/i,
      /time to/i,
      /days from/i,
      /average time/i,
      /median time/i,
      /velocity/i,
      /speed/i,
    ],
    templateHint: 'time_to_convert',
  },
  
  // Pipeline breakdown questions
  pipeline_breakdown: {
    patterns: [
      /pipeline by stage/i,
      /breakdown by stage/i,
      /each stage/i,
      /stage breakdown/i,
    ],
    templateHint: 'pipeline_by_stage',
  },
  
  // SGA performance questions
  sga_performance: {
    patterns: [
      /how is.*doing/i,
      /sga.*summary/i,
      /performance.*summary/i,
      /complete.*summary/i,
    ],
    templateHint: 'sga_summary',
  },
  
  // Rolling average questions
  rolling_average: {
    patterns: [
      /rolling average/i,
      /trailing.*day/i,
      /.*day.*average/i,
      /moving average/i,
      /smoothed/i,
    ],
    templateHint: 'rolling_average',
  },
  
  // Age-based opportunity questions
  opportunities_by_age: {
    patterns: [
      /opportunit.*more than \d+ days old/i,
      /opportunit.*older than/i,
      /opportunit.*\d+ days/i,
      /stale pipeline/i,
      /on hold.*\d+ days/i,
      /open opportunit.*\d+ days/i,
      /which opportunit.*\d+ days/i,
    ],
    templateHint: 'opportunities_by_age',
  },
  
  // Trend questions
  trend: {
    patterns: [
      /trend/i,
      /over time/i,
      /by month/i,
      /by quarter/i,
      /month over month/i,
      /quarter over quarter/i,
    ],
    templateHint: 'metric_trend or conversion_trend',
  },
  
  // Comparison questions
  comparison: {
    patterns: [
      /compare/i,
      /vs/i,
      /versus/i,
      /compared to/i,
      /this.+vs.+last/i,
      /change from/i,
    ],
    templateHint: 'period_comparison',
  },
  
  // Ranking questions
  ranking: {
    patterns: [
      /top \d+/i,
      /bottom \d+/i,
      /best/i,
      /worst/i,
      /highest/i,
      /lowest/i,
      /rank/i,
      /leaderboard/i,
    ],
    templateHint: 'top_n or sga_leaderboard',
  },
  
  // List/detail questions
  list: {
    patterns: [
      /show me/i,
      /list/i,
      /which/i,
      /who has/i,
      /what are/i,
      /details/i,
    ],
    templateHint: 'sqo_detail_list or generic_detail_list or scheduled_calls_list or open_pipeline_list',
  },
  
  // AUM questions
  aum: {
    patterns: [
      /aum/i,
      /pipeline value/i,
      /deal size/i,
      /average aum/i,
      /total aum/i,
    ],
    templateHint: 'average_aum or single_metric with AUM metric',
  },
  
  // Forecast questions
  forecast: {
    patterns: [
      /forecast/i,
      /goal/i,
      /target/i,
      /on pace/i,
      /tracking/i,
      /attainment/i,
    ],
    templateHint: 'forecast_vs_actual',
  },
  
  // Call scheduling questions
  calls: {
    patterns: [
      /initial call/i,
      /qualification call/i,
      /scheduled call/i,
      /upcoming call/i,
      /next week.+call/i,
      /calls scheduled/i,
    ],
    templateHint: 'scheduled_calls_list or qualification_calls_list',
  },
} as const;

// =============================================================================
// EXPORT ALL
// =============================================================================
export const QUERY_LAYER = {
  baseQuery: BASE_QUERY,
  templates: QUERY_TEMPLATES,
  visualizationTypes: VISUALIZATION_TYPES,
  questionPatterns: QUESTION_PATTERNS,
} as const;

export type QueryLayer = typeof QUERY_LAYER;
