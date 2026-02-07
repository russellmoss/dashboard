// =============================================================================
// SEMANTIC LAYER DEFINITIONS
// Source of truth for the self-service AI analytics agent
// 
// This file defines all metrics, dimensions, filters, and business rules
// that the agent uses to compose queries. The agent NEVER generates raw SQL -
// it selects from these verified definitions.
//
// Location: src/lib/semantic-layer/definitions.ts
// =============================================================================

// =============================================================================
// CONSTANTS
// =============================================================================
export const CONSTANTS = {
  // Tables
  FULL_TABLE: 'savvy-gtm-analytics.Tableau_Views.vw_funnel_master',
  MAPPING_TABLE: 'savvy-gtm-analytics.SavvyGTMData.new_mapping',  // FIXED: Was incorrectly pointing to Tableau_Views dataset
  DAILY_FORECAST_VIEW: 'savvy-gtm-analytics.Tableau_Views.vw_daily_forecast',
  FORECAST_TABLE: 'savvy-gtm-analytics.SavvyGTMData.q4_2025_forecast',
  
  // Record Types
  RECRUITING_RECORD_TYPE: '012Dn000000mrO3IAI',
  RE_ENGAGEMENT_RECORD_TYPE: '012VS000009VoxrYAC',
  
  // Open Pipeline Stages (current state, excludes closed and inactive)
  // Must match actual Salesforce StageName values
  // These are opportunities that are currently active and actively progressing
  // Excludes: Closed Lost, Joined, On Hold, Signed
  OPEN_PIPELINE_STAGES: [
    'Qualifying',
    'Discovery', 
    'Sales Process',
    'Negotiating'
  ],
} as const;

// =============================================================================
// DATE FIELD MAPPING
// Critical: Each metric has a specific date field for filtering
// =============================================================================
export const DATE_FIELDS = {
  // Lead-level dates
  FilterDate: {
    description: 'Entry date into funnel (handles recycled leads)',
    type: 'TIMESTAMP',
    usedFor: ['prospects'],
  },
  stage_entered_contacting__c: {
    description: 'When lead entered Contacting stage',
    type: 'TIMESTAMP', 
    usedFor: ['contacted'],
  },
  mql_stage_entered_ts: {
    description: 'When lead entered Call Scheduled stage (MQL)',
    type: 'TIMESTAMP',
    usedFor: ['mqls'],
  },
  converted_date_raw: {
    description: 'When lead was converted to opportunity (SQL)',
    type: 'DATE',
    usedFor: ['sqls'],
  },
  Initial_Call_Scheduled_Date__c: {
    description: 'Date of scheduled initial call',
    type: 'DATE',
    usedFor: ['initial_calls_scheduled'],
    note: 'Can be future dates - for upcoming calls',
  },
  lead_closed_date: {
    description: 'When lead was closed (not converted)',
    type: 'TIMESTAMP',
    usedFor: ['lead_closure'],
  },
  
  // Opportunity-level dates
  Date_Became_SQO__c: {
    description: 'When opportunity became Sales Qualified',
    type: 'TIMESTAMP',
    usedFor: ['sqos'],
  },
  Qualification_Call_Date__c: {
    description: 'Date of qualification call',
    type: 'DATE',
    usedFor: ['qualification_calls'],
  },
  Stage_Entered_Signed__c: {
    description: 'When opportunity entered Signed stage',
    type: 'TIMESTAMP',
    usedFor: ['signed'],
  },
  advisor_join_date__c: {
    description: 'When advisor officially joined',
    type: 'DATE',
    usedFor: ['joined'],
  },
  Opp_CreatedDate: {
    description: 'When opportunity was created',
    type: 'TIMESTAMP',
    usedFor: ['opportunity_creation', 'opportunities_by_age'],
  },
  Stage_Entered_Discovery__c: {
    description: 'When opportunity entered Discovery stage',
    type: 'TIMESTAMP',
    usedFor: ['opportunities_by_age'],
  },
  Stage_Entered_Sales_Process__c: {
    description: 'When opportunity entered Sales Process stage',
    type: 'TIMESTAMP',
    usedFor: ['opportunities_by_age'],
  },
  Stage_Entered_Negotiating__c: {
    description: 'When opportunity entered Negotiating stage',
    type: 'TIMESTAMP',
    usedFor: ['opportunities_by_age'],
  },
  Stage_Entered_On_Hold__c: {
    description: 'When opportunity entered On Hold stage',
    type: 'TIMESTAMP',
    usedFor: ['opportunities_by_age'],
  },
} as const;

// =============================================================================
// VOLUME METRICS
// These count records/events in a date range
// =============================================================================
export const VOLUME_METRICS = {
  prospects: {
    name: 'Prospects',
    description: 'Records entering funnel in period',
    dateField: 'FilterDate',
    sql: `SUM(
      CASE 
        WHEN v.FilterDate IS NOT NULL
          AND TIMESTAMP(v.FilterDate) >= TIMESTAMP(@startDate) 
          AND TIMESTAMP(v.FilterDate) <= TIMESTAMP(@endDate)
          {sgaFilterLead}
        THEN 1 ELSE 0 
      END
    )`,
    visualization: 'metric',
    aliases: ['leads', 'new leads', 'new prospects'],
  },

  contacted: {
    name: 'Contacted',
    description: 'Leads that entered Contacting stage in period',
    dateField: 'stage_entered_contacting__c',
    sql: `SUM(
      CASE 
        WHEN v.stage_entered_contacting__c IS NOT NULL
          AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDate) 
          AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@endDate)
          AND v.is_contacted = 1
          {sgaFilterLead}
        THEN 1 ELSE 0 
      END
    )`,
    visualization: 'metric',
    aliases: ['contacts', 'contacted leads'],
  },

  mqls: {
    name: 'MQLs',
    description: 'Marketing Qualified Leads (Call Scheduled stage) in period',
    dateField: 'mql_stage_entered_ts',
    sql: `SUM(
      CASE 
        WHEN v.mql_stage_entered_ts IS NOT NULL
          AND TIMESTAMP(v.mql_stage_entered_ts) >= TIMESTAMP(@startDate) 
          AND TIMESTAMP(v.mql_stage_entered_ts) <= TIMESTAMP(@endDate)
          {sgaFilterLead}
        THEN 1 ELSE 0 
      END
    )`,
    visualization: 'metric',
    aliases: ['marketing qualified leads', 'call scheduled'],
  },

  sqls: {
    name: 'SQLs',
    description: 'Sales Qualified Leads (converted to opportunity) in period',
    dateField: 'converted_date_raw',
    sql: `SUM(
      CASE 
        WHEN v.converted_date_raw IS NOT NULL
          AND DATE(v.converted_date_raw) >= DATE(@startDate) 
          AND DATE(v.converted_date_raw) <= DATE(@endDate)
          AND v.is_sql = 1
          {sgaFilterLead}
        THEN 1 ELSE 0 
      END
    )`,
    visualization: 'metric',
    aliases: ['sales qualified leads', 'conversions', 'opportunities created'],
  },

  sqos: {
    name: 'SQOs',
    description: 'Sales Qualified Opportunities in period',
    dateField: 'Date_Became_SQO__c',
    sql: `SUM(
      CASE 
        WHEN v.Date_Became_SQO__c IS NOT NULL
          AND DATE(v.Date_Became_SQO__c) >= DATE(@startDate) 
          AND DATE(v.Date_Became_SQO__c) <= DATE(@endDate)
          AND v.recordtypeid = @recruitingRecordType
          AND v.is_sqo_unique = 1
          {sgaFilterOpp}
        THEN 1 ELSE 0 
      END
    )`,
    requiredParams: ['recruitingRecordType'],
    visualization: 'metric',
    aliases: ['sales qualified opportunities', 'qualified opps'],
  },

  joined: {
    name: 'Joined',
    description: 'Advisors that officially joined in period',
    dateField: 'advisor_join_date__c',
    sql: `SUM(
      CASE 
        WHEN v.advisor_join_date__c IS NOT NULL
          AND DATE(v.advisor_join_date__c) >= DATE(@startDate) 
          AND DATE(v.advisor_join_date__c) <= DATE(@endDate)
          AND v.is_joined_unique = 1
          {sgaFilterOpp}
        THEN 1 ELSE 0 
      END
    )`,
    visualization: 'metric',
    aliases: ['joined advisors', 'onboarded', 'closed won'],
  },

  initial_calls_scheduled: {
    name: 'Initial Calls Scheduled',
    description: 'Initial calls scheduled in period (can include future dates)',
    dateField: 'Initial_Call_Scheduled_Date__c',
    sql: `COUNT(DISTINCT 
      CASE 
        WHEN v.Initial_Call_Scheduled_Date__c IS NOT NULL
          AND v.Initial_Call_Scheduled_Date__c >= DATE(@startDate)
          AND v.Initial_Call_Scheduled_Date__c <= DATE(@endDate)
          {sgaFilterLead}
        THEN v.primary_key 
      END
    )`,
    visualization: 'metric',
    aliases: ['initial calls', 'scheduled calls', 'first calls'],
    note: 'Use for "who has calls scheduled for next week" type questions',
  },

  qualification_calls: {
    name: 'Qualification Calls',
    description: 'Qualification calls conducted in period',
    dateField: 'Qualification_Call_Date__c',
    sql: `COUNT(DISTINCT 
      CASE 
        WHEN v.Qualification_Call_Date__c IS NOT NULL
          AND v.Qualification_Call_Date__c >= DATE(@startDate)
          AND v.Qualification_Call_Date__c <= DATE(@endDate)
          {sgaFilterOpp}
        THEN v.Full_Opportunity_ID__c 
      END
    )`,
    visualization: 'metric',
    aliases: ['qual calls', 'discovery calls'],
  },

  signed: {
    name: 'Signed',
    description: 'Opportunities that entered Signed stage in period',
    dateField: 'Stage_Entered_Signed__c',
    sql: `SUM(
      CASE 
        WHEN v.Stage_Entered_Signed__c IS NOT NULL
          AND TIMESTAMP(v.Stage_Entered_Signed__c) >= TIMESTAMP(@startDate)
          AND TIMESTAMP(v.Stage_Entered_Signed__c) <= TIMESTAMP(@endDate)
          AND v.is_sqo_unique = 1
          {sgaFilterOpp}
        THEN 1 ELSE 0 
      END
    )`,
    visualization: 'metric',
    aliases: ['signed deals', 'signed opportunities'],
  },
} as const;

// =============================================================================
// AUM METRICS
// CRITICAL: AUM always uses COALESCE(Underwritten_AUM__c, Amount) - NEVER add them
// =============================================================================
export const AUM_METRICS = {
  sqo_aum: {
    name: 'SQO AUM',
    description: 'Total AUM of SQOs in period',
    dateField: 'Date_Became_SQO__c',
    sql: `SUM(
      CASE 
        WHEN v.Date_Became_SQO__c IS NOT NULL
          AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDate) 
          AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(@endDate)
          AND v.recordtypeid = @recruitingRecordType
          AND v.is_sqo_unique = 1
          {sgaFilterOpp}
        THEN COALESCE(v.Underwritten_AUM__c, v.Amount, 0) 
        ELSE 0 
      END
    )`,
    format: 'currency',
    requiredParams: ['recruitingRecordType'],
    visualization: 'metric',
    aliases: ['sqo pipeline', 'qualified aum'],
    note: 'Uses COALESCE(Underwritten_AUM__c, Amount) - never adds them',
  },

  joined_aum: {
    name: 'Joined AUM',
    description: 'Total AUM of joined advisors in period',
    dateField: 'advisor_join_date__c',
    sql: `SUM(
      CASE 
        WHEN v.advisor_join_date__c IS NOT NULL
          AND DATE(v.advisor_join_date__c) >= DATE(@startDate) 
          AND DATE(v.advisor_join_date__c) <= DATE(@endDate)
          AND v.is_joined_unique = 1
          {sgaFilterOpp}
        THEN COALESCE(v.Underwritten_AUM__c, v.Amount, 0) 
        ELSE 0 
      END
    )`,
    format: 'currency',
    visualization: 'metric',
    aliases: ['closed won aum', 'onboarded aum'],
    note: 'Uses COALESCE(Underwritten_AUM__c, Amount) - never adds them',
  },

  signed_aum: {
    name: 'Signed AUM',
    description: 'Total AUM of opportunities entering Signed stage in period',
    dateField: 'Stage_Entered_Signed__c',
    sql: `SUM(
      CASE 
        WHEN v.Stage_Entered_Signed__c IS NOT NULL
          AND TIMESTAMP(v.Stage_Entered_Signed__c) >= TIMESTAMP(@startDate)
          AND TIMESTAMP(v.Stage_Entered_Signed__c) <= TIMESTAMP(@endDate)
          AND v.is_sqo_unique = 1
          {sgaFilterOpp}
        THEN COALESCE(v.Underwritten_AUM__c, v.Amount, 0) 
        ELSE 0 
      END
    )`,
    format: 'currency',
    visualization: 'metric',
    aliases: ['signed deal value'],
    note: 'Uses COALESCE(Underwritten_AUM__c, Amount) - never adds them',
  },

  open_pipeline_aum: {
    name: 'Open Pipeline AUM',
    description: 'Current AUM of open opportunities (snapshot, no date filter)',
    dateField: null, // No date filter - current state
    sql: `SUM(
      CASE 
        WHEN v.is_primary_opp_record = 1
        THEN v.Opportunity_AUM 
        ELSE 0 
      END
    )`,
    format: 'currency',
    requiredParams: ['recruitingRecordType', 'openPipelineStages'],
    visualization: 'metric',
    aliases: ['pipeline value', 'open aum', 'active pipeline'],
    note: 'Current state - NOT filtered by date. Uses is_primary_opp_record in CASE and is_sqo_unique in WHERE (added by compiler) to match main dashboard exactly.',
  },

  avg_aum: {
    name: 'Average AUM',
    description: 'Average AUM of records (requires a population filter)',
    sql: `AVG(COALESCE(v.Underwritten_AUM__c, v.Amount))`,
    format: 'currency',
    visualization: 'metric',
    aliases: ['average deal size', 'avg deal value'],
    note: 'Must be combined with a population filter (e.g., joined advisors in 2025)',
  },
} as const;

// =============================================================================
// CONVERSION RATE METRICS
// CRITICAL: ALWAYS USE COHORT MODE (not periodic mode)
// 
// Cohort Mode (Resolved-Only):
// - "Of records from this period, what % converted?"
// - Uses pre-calculated progression/eligibility flags from vw_funnel_master
// - Only includes RESOLVED records (converted OR closed/lost)
// - Same population - rates always 0-100%
// - Best for: Funnel efficiency, forecasting, AI agent queries
//
// Rate = Progression / Eligible (resolved only)
// =============================================================================
export const CONVERSION_METRICS = {
  contacted_to_mql_rate: {
    name: 'Contacted to MQL Rate',
    description: 'Percentage of contacted leads that became MQL (COHORT MODE - resolved or 30d effective)',
    cohortDateField: 'stage_entered_contacting__c',
    numeratorField: 'contacted_to_mql_progression',
    denominatorField: 'eligible_for_contacted_conversions_30d',
    mode: 'cohort', // ALWAYS use cohort mode
    sql: `SAFE_DIVIDE(
      SUM(CASE 
        WHEN v.stage_entered_contacting__c IS NOT NULL
          AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDate)
          AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@endDate)
        THEN v.contacted_to_mql_progression ELSE 0 
      END),
      SUM(CASE 
        WHEN v.stage_entered_contacting__c IS NOT NULL
          AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDate)
          AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@endDate)
        THEN v.eligible_for_contacted_conversions_30d ELSE 0 
      END)
    )`,
    format: 'percent',
    visualization: 'metric',
    aliases: ['contact to mql conversion', 'contacting conversion rate'],
  },

  mql_to_sql_rate: {
    name: 'MQL to SQL Rate',
    description: 'Percentage of MQLs that converted to SQL (COHORT MODE - resolved only)',
    cohortDateField: 'mql_stage_entered_ts',
    numeratorField: 'mql_to_sql_progression',
    denominatorField: 'eligible_for_mql_conversions',
    mode: 'cohort', // ALWAYS use cohort mode
    sql: `SAFE_DIVIDE(
      SUM(CASE 
        WHEN v.mql_stage_entered_ts IS NOT NULL
          AND TIMESTAMP(v.mql_stage_entered_ts) >= TIMESTAMP(@startDate)
          AND TIMESTAMP(v.mql_stage_entered_ts) <= TIMESTAMP(@endDate)
        THEN v.mql_to_sql_progression ELSE 0 
      END),
      SUM(CASE 
        WHEN v.mql_stage_entered_ts IS NOT NULL
          AND TIMESTAMP(v.mql_stage_entered_ts) >= TIMESTAMP(@startDate)
          AND TIMESTAMP(v.mql_stage_entered_ts) <= TIMESTAMP(@endDate)
        THEN v.eligible_for_mql_conversions ELSE 0 
      END)
    )`,
    format: 'percent',
    visualization: 'metric',
    aliases: ['mql conversion rate', 'mql to opportunity rate'],
  },

  sql_to_sqo_rate: {
    name: 'SQL to SQO Rate',
    description: 'Percentage of SQLs that became SQO (COHORT MODE - resolved only)',
    cohortDateField: 'converted_date_raw',
    numeratorField: 'sql_to_sqo_progression',
    denominatorField: 'eligible_for_sql_conversions',
    mode: 'cohort', // ALWAYS use cohort mode
    sql: `SAFE_DIVIDE(
      SUM(CASE 
        WHEN v.converted_date_raw IS NOT NULL
          AND DATE(v.converted_date_raw) >= DATE(@startDate)
          AND DATE(v.converted_date_raw) <= DATE(@endDate)
        THEN v.sql_to_sqo_progression ELSE 0 
      END),
      SUM(CASE 
        WHEN v.converted_date_raw IS NOT NULL
          AND DATE(v.converted_date_raw) >= DATE(@startDate)
          AND DATE(v.converted_date_raw) <= DATE(@endDate)
        THEN v.eligible_for_sql_conversions ELSE 0 
      END)
    )`,
    format: 'percent',
    visualization: 'metric',
    aliases: ['sql conversion rate', 'opportunity to sqo rate'],
  },

  sqo_to_joined_rate: {
    name: 'SQO to Joined Rate',
    description: 'Percentage of SQOs that joined (COHORT MODE - resolved only)',
    cohortDateField: 'Date_Became_SQO__c',
    numeratorField: 'sqo_to_joined_progression',
    denominatorField: 'eligible_for_sqo_conversions',
    mode: 'cohort', // ALWAYS use cohort mode
    sql: `SAFE_DIVIDE(
      SUM(CASE 
        WHEN v.Date_Became_SQO__c IS NOT NULL
          AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDate)
          AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(@endDate)
        THEN v.sqo_to_joined_progression ELSE 0 
      END),
      SUM(CASE 
        WHEN v.Date_Became_SQO__c IS NOT NULL
          AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDate)
          AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(@endDate)
        THEN v.eligible_for_sqo_conversions ELSE 0 
      END)
    )`,
    format: 'percent',
    visualization: 'metric',
    aliases: ['sqo conversion rate', 'win rate', 'close rate'],
  },
} as const;

// =============================================================================
// DIMENSIONS
// Fields that can be used for grouping (GROUP BY) and filtering (WHERE)
// =============================================================================
export const DIMENSIONS = {
  channel: {
    name: 'Channel',
    description: 'Marketing channel grouping',
    field: "IFNULL(v.Channel_Grouping_Name, 'Other')",
    rawField: 'Channel_Grouping_Name',
    requiresJoin: false, // Channel_Grouping_Name now comes directly from Finance_View__c in the view
    filterable: true,
    groupable: true,
    aliases: ['marketing channel', 'channel grouping'],
  },

  source: {
    name: 'Source',
    description: 'Lead source (e.g., LPL, Schwab, Google Ads)',
    field: 'v.Original_source',
    rawField: 'Original_source',
    requiresJoin: false,
    filterable: true,
    groupable: true,
    aliases: ['lead source', 'original source', 'campaign'],
  },

  sga: {
    name: 'SGA',
    description: 'Strategic Growth Associate (works leads)',
    field: 'v.SGA_Owner_Name__c',
    rawField: 'SGA_Owner_Name__c',
    requiresJoin: false,
    filterable: true,
    groupable: true,
    rbacField: true, // Subject to permission filtering
    aliases: ['strategic growth associate', 'sga owner'],
    note: 'For opportunity metrics, also check Opp_SGA_Name__c',
  },

  sgm: {
    name: 'SGM',
    description: 'Strategic Growth Manager (manages SGAs, owns opportunities)',
    field: 'v.SGM_Owner_Name__c',
    rawField: 'SGM_Owner_Name__c',
    requiresJoin: false,
    filterable: true,
    groupable: true,
    rbacField: true,
    aliases: ['strategic growth manager', 'sgm owner', 'opportunity owner'],
  },

  experimentation_tag: {
    name: 'Experimentation Tag',
    description: 'A/B test or experiment tags',
    field: 'v.Experimentation_Tag_Raw__c',
    arrayField: 'v.Experimentation_Tag_List', // For filtering via UNNEST
    requiresJoin: false,
    filterable: true,
    groupable: false, // Use arrayField with UNNEST for grouping
    filterSql: `EXISTS (
      SELECT 1 
      FROM UNNEST(v.Experimentation_Tag_List) as tag
      WHERE tag = @experimentationTag
    )`,
    aliases: ['experiment', 'test tag', 'ab test'],
  },

  campaign: {
    name: 'Campaign',
    description: 'Salesforce Campaign (marketing campaign object)',
    field: 'v.Campaign_Id__c',
    rawField: 'Campaign_Id__c',
    requiresJoin: false,
    filterable: true,
    groupable: true,
    aliases: ['marketing campaign', 'sfdc campaign'],
  },

  stage_name: {
    name: 'Stage Name',
    description: 'Current opportunity stage',
    field: 'v.StageName',
    rawField: 'StageName',
    requiresJoin: false,
    filterable: true,
    groupable: true,
    allowedValues: [
      'Qualifying', 'Discovery', 'Sales Process', 'Negotiating',
      'Signed', 'On Hold', 'Closed Lost', 'Joined'
    ],
    aliases: ['stage', 'opportunity stage'],
  },

  aum_tier: {
    name: 'AUM Tier',
    description: 'AUM tier classification',
    field: 'v.aum_tier',
    rawField: 'aum_tier',
    requiresJoin: false,
    filterable: true,
    groupable: true,
    allowedValues: [
      'Tier 1 (< $25M)',
      'Tier 2 ($25M-$75M)',
      'Tier 3 ($75M-$150M)',
      'Tier 4 (> $150M)'
    ],
    aliases: ['deal size tier', 'aum bucket'],
  },

  record_type: {
    name: 'Record Type',
    description: 'Opportunity record type (Recruiting vs Re-Engagement)',
    field: 'v.record_type_name',
    rawField: 'record_type_name',
    requiresJoin: false,
    filterable: true,
    groupable: true,
    allowedValues: ['Recruiting', 'Re-Engagement', 'Unknown'],
    aliases: ['opp type', 'opportunity type'],
  },

  tof_stage: {
    name: 'TOF Stage',
    description: 'Top-of-funnel stage (highest stage reached)',
    field: 'v.TOF_Stage',
    rawField: 'TOF_Stage',
    requiresJoin: false,
    filterable: true,
    groupable: true,
    allowedValues: ['Prospect', 'Contacted', 'MQL', 'SQL', 'SQO', 'Joined'],
    aliases: ['funnel stage', 'lead stage'],
  },

  lead_score_tier: {
    name: 'Lead Score Tier',
    description: 'Lead scoring tier',
    field: 'v.Lead_Score_Tier__c',
    rawField: 'Lead_Score_Tier__c',
    requiresJoin: false,
    filterable: true,
    groupable: true,
    aliases: ['lead score', 'score tier'],
  },

  external_agency: {
    name: 'External Agency',
    description: 'External agency or partner',
    field: 'v.External_Agency__c',
    rawField: 'External_Agency__c',
    requiresJoin: false,
    filterable: true,
    groupable: true,
    aliases: ['agency', 'partner'],
  },
} as const;

// =============================================================================
// TIME DIMENSIONS
// For grouping by time periods
// =============================================================================
export const TIME_DIMENSIONS = {
  quarter: {
    name: 'Quarter',
    description: 'Fiscal quarter (e.g., 2025-Q1)',
    sql: (dateField: string) => `CONCAT(
      CAST(EXTRACT(YEAR FROM ${dateField}) AS STRING), 
      '-Q', 
      CAST(EXTRACT(QUARTER FROM ${dateField}) AS STRING)
    )`,
    aliases: ['quarterly', 'by quarter'],
  },

  month: {
    name: 'Month',
    description: 'Calendar month (e.g., 2025-01)',
    sql: (dateField: string) => `FORMAT_DATE('%Y-%m', DATE(${dateField}))`,
    aliases: ['monthly', 'by month'],
  },

  week: {
    name: 'Week',
    description: 'Week starting Monday',
    sql: (dateField: string) => `DATE_TRUNC(DATE(${dateField}), WEEK(MONDAY))`,
    aliases: ['weekly', 'by week'],
  },

  year: {
    name: 'Year',
    description: 'Calendar year',
    sql: (dateField: string) => `EXTRACT(YEAR FROM ${dateField})`,
    aliases: ['yearly', 'by year', 'annual'],
  },
} as const;

// =============================================================================
// DATE RANGES
// Common date range filters
// =============================================================================
export const DATE_RANGES = {
  this_quarter: {
    name: 'This Quarter',
    description: 'Current quarter to date',
    startDateSql: `DATE_TRUNC(CURRENT_DATE(), QUARTER)`,
    endDateSql: `CURRENT_DATE()`,
    aliases: ['qtd', 'quarter to date', 'current quarter'],
  },

  last_quarter: {
    name: 'Last Quarter',
    description: 'Previous complete quarter',
    startDateSql: `DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 QUARTER), QUARTER)`,
    // Use DATE_SUB to get the last day of previous quarter (day before current quarter starts)
    // This works for both DATE and TIMESTAMP comparisons when used with <=
    endDateSql: `DATE_SUB(DATE_TRUNC(CURRENT_DATE(), QUARTER), INTERVAL 1 DAY)`,
    aliases: ['previous quarter', 'prior quarter'],
  },

  this_month: {
    name: 'This Month',
    description: 'Current month to date',
    startDateSql: `DATE_TRUNC(CURRENT_DATE(), MONTH)`,
    endDateSql: `CURRENT_DATE()`,
    aliases: ['mtd', 'month to date', 'current month'],
  },

  last_month: {
    name: 'Last Month',
    description: 'Previous complete month',
    startDateSql: `DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH), MONTH)`,
    endDateSql: `CONCAT(CAST(DATE_SUB(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL 1 DAY) AS STRING), ' 23:59:59')`,
    aliases: ['previous month', 'prior month'],
  },

  this_week: {
    name: 'This Week',
    description: 'Current week (Monday to today)',
    startDateSql: `DATE_TRUNC(CURRENT_DATE(), WEEK(MONDAY))`,
    endDateSql: `CURRENT_DATE()`,
    aliases: ['wtd', 'week to date', 'current week'],
  },

  next_week: {
    name: 'Next Week',
    description: 'Upcoming week (next Monday to Sunday)',
    startDateSql: `DATE_ADD(DATE_TRUNC(CURRENT_DATE(), WEEK(MONDAY)), INTERVAL 1 WEEK)`,
    endDateSql: `DATE_ADD(DATE_TRUNC(CURRENT_DATE(), WEEK(MONDAY)), INTERVAL 13 DAY)`,
    aliases: ['upcoming week', 'following week'],
    note: 'Useful for "initial calls scheduled for next week"',
  },

  ytd: {
    name: 'Year to Date',
    description: 'Current year to date',
    startDateSql: `DATE_TRUNC(CURRENT_DATE(), YEAR)`,
    endDateSql: `CURRENT_DATE()`,
    aliases: ['year to date', 'this year'],
  },

  last_year: {
    name: 'Last Year',
    description: 'Previous complete year',
    startDateSql: `DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 YEAR), YEAR)`,
    endDateSql: `CONCAT(CAST(DATE_SUB(DATE_TRUNC(CURRENT_DATE(), YEAR), INTERVAL 1 DAY) AS STRING), ' 23:59:59')`,
    aliases: ['previous year', 'prior year'],
  },

  last_30_days: {
    name: 'Last 30 Days',
    description: 'Rolling 30 days',
    startDateSql: `DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)`,
    endDateSql: `CURRENT_DATE()`,
    aliases: ['past 30 days', 'trailing 30 days'],
  },

  last_90_days: {
    name: 'Last 90 Days',
    description: 'Rolling 90 days',
    startDateSql: `DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)`,
    endDateSql: `CURRENT_DATE()`,
    aliases: ['past 90 days', 'trailing 90 days'],
  },

  custom: {
    name: 'Custom Range',
    description: 'User-specified date range',
    requiresParams: ['startDate', 'endDate'],
    aliases: ['custom', 'date range', 'between'],
  },
} as const;

// =============================================================================
// ENTITY MAPPINGS
// Map business terms to technical filters
// =============================================================================
export const ENTITY_MAPPINGS = {
  'joined advisors': {
    filter: 'v.is_joined_unique = 1',
    description: 'Advisors who have officially joined',
  },
  'qualified opportunities': {
    filter: "v.is_sqo_unique = 1 AND v.recordtypeid = @recruitingRecordType",
    description: 'Sales Qualified Opportunities',
    params: ['recruitingRecordType'],
  },
  'converted leads': {
    filter: 'v.is_sql = 1',
    description: 'Leads that converted to opportunities',
  },
  'open pipeline': {
    filter: 'v.is_sqo_unique = 1 AND v.is_joined_unique = 0 AND v.StageName NOT IN ("Closed Lost")',
    description: 'SQOs that have not yet joined or closed',
  },
  'closed lost': {
    filter: "v.StageName = 'Closed Lost'",
    description: 'Opportunities that were lost',
  },
  'recruiting opportunities': {
    filter: 'v.recordtypeid = @recruitingRecordType',
    description: 'Opportunities with Recruiting record type',
    params: ['recruitingRecordType'],
  },
  'signed deals': {
    filter: "v.StageName = 'Signed' AND v.is_sqo_unique = 1",
    description: 'Opportunities in Signed stage',
  },
} as const;

// =============================================================================
// AGGREGATION TYPES
// How to aggregate metrics
// =============================================================================
export const AGGREGATIONS = {
  sum: {
    sql: 'SUM({field})',
    aliases: ['total', 'sum of', 'add up'],
  },
  avg: {
    sql: 'AVG({field})',
    aliases: ['average', 'mean', 'avg of'],
  },
  count: {
    sql: 'COUNT({field})',
    aliases: ['count of', 'number of', 'how many'],
  },
  count_distinct: {
    sql: 'COUNT(DISTINCT {field})',
    aliases: ['unique count', 'distinct count'],
  },
  max: {
    sql: 'MAX({field})',
    aliases: ['maximum', 'highest', 'largest', 'biggest'],
  },
  min: {
    sql: 'MIN({field})',
    aliases: ['minimum', 'lowest', 'smallest'],
  },
} as const;

// =============================================================================
// SGA FILTER PATTERNS
// Different SGA filter patterns for lead-level vs opportunity-level metrics
// =============================================================================
export const SGA_FILTER_PATTERNS = {
  // For lead-level metrics (prospects, contacted, mqls, sqls)
  lead: {
    withFilter: 'AND v.SGA_Owner_Name__c = @sga',
    withoutFilter: '',
    description: 'SGA who owns/worked the lead',
  },
  // For opportunity-level metrics (sqos, joined, aum)
  // Check BOTH because SQO can be attributed via lead SGA OR opportunity SGA
  opportunity: {
    withFilter: 'AND (v.SGA_Owner_Name__c = @sga OR v.Opp_SGA_Name__c = @sga)',
    withoutFilter: '',
    description: 'SGA associated via lead or opportunity',
  },
} as const;

// =============================================================================
// EXPORT ALL
// =============================================================================
export const SEMANTIC_LAYER = {
  constants: CONSTANTS,
  dateFields: DATE_FIELDS,
  volumeMetrics: VOLUME_METRICS,
  aumMetrics: AUM_METRICS,
  conversionMetrics: CONVERSION_METRICS,
  dimensions: DIMENSIONS,
  timeDimensions: TIME_DIMENSIONS,
  dateRanges: DATE_RANGES,
  entityMappings: ENTITY_MAPPINGS,
  aggregations: AGGREGATIONS,
  sgaFilterPatterns: SGA_FILTER_PATTERNS,
} as const;

export type SemanticLayer = typeof SEMANTIC_LAYER;
