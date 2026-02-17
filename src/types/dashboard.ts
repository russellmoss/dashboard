export type ConversionTrendMode = 'period' | 'cohort';
export type TrendMode = 'period' | 'cohort'; // Alias for compatibility

// View mode for funnel display
export type ViewMode = 'focused' | 'fullFunnel';

export interface FunnelMetrics {
  prospects: number;  // Count by FilterDate
  contacted: number; // Count by stage_entered_contacting__c with is_contacted=1
  mqls: number;       // Already calculated in query, just add to type
  sqls: number;
  sqos: number;
  signed: number;     // Count by Stage_Entered_Signed__c
  signedAum: number;  // Sum of Opportunity_AUM for signed records (Underwritten_AUM__c / Amount)
  joined: number;
  joinedAum: number;  // Sum of Opportunity_AUM for joined records
  pipelineAum: number;
  openPipelineAum: number;
  // MQL disposition counts
  mqls_open: number;
  mqls_lost: number;
  mqls_converted: number;
  // SQL disposition counts
  sqls_open: number;
  sqls_lost: number;
  sqls_converted: number;
  // SQO disposition counts
  sqos_open: number;
  sqos_lost: number;
  sqos_converted: number;
}

// Forecast goals for any metric level
export interface ForecastGoals {
  prospects: number;
  mqls: number;
  sqls: number;
  sqos: number;
  joined: number;
}

// Variance calculation result
export interface GoalVariance {
  actual: number;
  goal: number;
  difference: number;      // actual - goal (positive = ahead, negative = behind)
  percentVariance: number; // ((actual - goal) / goal) * 100
  isOnTrack: boolean;      // actual >= goal
}

// Extended types with goals
export interface FunnelMetricsWithGoals extends FunnelMetrics {
  goals: ForecastGoals | null;
}

export interface ChannelPerformanceWithGoals extends ChannelPerformance {
  goals?: {
    prospects: number;
    mqls: number;
    sqls: number;
    sqos: number;
    joined: number;
  };
}

export interface SourcePerformanceWithGoals extends SourcePerformance {
  goals?: {
    prospects: number;
    mqls: number;
    sqls: number;
    sqos: number;
    joined: number;
  };
}

export interface ConversionRates {
  contactedToMql: { rate: number; numerator: number; denominator: number };
  mqlToSql: { rate: number; numerator: number; denominator: number };
  sqlToSqo: { rate: number; numerator: number; denominator: number };
  sqoToJoined: { rate: number; numerator: number; denominator: number };
}

// New interfaces for mode-aware conversion rates
export interface ConversionRateResult {
  rate: number;
  numerator: number;
  denominator: number;
  label: string; // e.g., "66 / 116" or "61 / 97 resolved"
}

export interface ConversionRatesResponse {
  contactedToMql: ConversionRateResult;
  mqlToSql: ConversionRateResult;
  sqlToSqo: ConversionRateResult;
  sqoToJoined: ConversionRateResult;
  mode: 'period' | 'cohort';
}

export interface SourcePerformance {
  source: string;
  channel: string;
  prospects: number;
  contacted: number;
  mqls: number;
  sqls: number;
  sqos: number;
  joined: number;
  contactedToMqlRate: number;
  mqlToSqlRate: number;
  sqlToSqoRate: number;
  sqoToJoinedRate: number;
  aum: number;
}

export interface ChannelPerformance {
  channel: string;
  prospects: number;
  contacted: number;
  mqls: number;
  sqls: number;
  sqos: number;
  joined: number;
  contactedToMqlRate: number;
  mqlToSqlRate: number;
  sqlToSqoRate: number;
  sqoToJoinedRate: number;
  aum: number;
}

export interface DetailRecord {
  id: string;
  advisorName: string;
  source: string;
  channel: string;
  stage: string;
  sga: string | null;
  sgm: string | null;
  campaignId: string | null;
  campaignName: string | null;
  leadScoreTier: string | null;
  aum: number;
  aumFormatted: string;
  salesforceUrl: string;
  relevantDate: string; // FilterDate (fallback)
  contactedDate: string | null; // stage_entered_contacting__c
  mqlDate: string | null; // mql_stage_entered_ts
  sqlDate: string | null; // converted_date_raw
  sqoDate: string | null; // Date_Became_SQO__c
  joinedDate: string | null; // advisor_join_date__c
  signedDate: string | null; // Stage_Entered_Signed__c
  discoveryDate: string | null; // Stage_Entered_Discovery__c
  salesProcessDate: string | null; // Stage_Entered_Sales_Process__c
  negotiatingDate: string | null; // Stage_Entered_Negotiating__c
  onHoldDate: string | null; // Stage_Entered_On_Hold__c
  closedDate: string | null; // Stage_Entered_Closed__c
  initialCallScheduledDate: string | null;
  qualificationCallDate: string | null;
  isContacted: boolean;
  isMql: boolean;
  isSql: boolean;
  isSqo: boolean;
  isJoined: boolean;
  isOpenPipeline: boolean;
  recordTypeId: string | null; // For filtering SQOs by recruiting record type
  isPrimaryOppRecord: boolean; // For deduplicating opportunities with multiple leads
  opportunityId: string | null; // For deduplicating opportunities with multiple leads
  prospectSourceType?: string | null;    // 'Lead' | 'Re-Engagement' (optional for backward compat with ExploreResults/open-pipeline)
  originRecruitingOppId?: string | null; // Previous_Recruiting_Opportunity_ID__c
  originOpportunityUrl?: string | null;  // URL to original closed-lost opp
}

export interface ForecastData {
  monthKey: string;
  channel: string;
  metric: string;
  stage: string;
  originalSource: string;
  forecastValue: number;
}

export interface TrendDataPoint {
  period: string;
  sqls: number;
  sqos: number;
  joined: number;
  contactedToMqlRate: number;
  mqlToSqlRate: number;
  sqlToSqoRate: number;
  sqoToJoinedRate: number;
  isSelectedPeriod?: boolean;
}

// Data Freshness Types
export type DataFreshnessStatus = 'fresh' | 'recent' | 'stale' | 'very_stale';

export interface DataFreshness {
  lastUpdated: string;        // ISO timestamp in UTC
  hoursAgo: number;
  minutesAgo: number;
  isStale: boolean;
  status: DataFreshnessStatus;
}

// Open Pipeline Types
/**
 * Open Pipeline stage breakdown for bar chart
 */
export interface OpenPipelineByStage {
  stage: string;
  advisorCount: number;
  totalAum: number;
  aumFormatted: string;
  aumInBillions: number;
}

/**
 * Open Pipeline summary with totals and by-stage breakdown
 */
export interface OpenPipelineSummary {
  totalAum: number;
  totalAumFormatted: string;
  advisorCount: number;
  byStage: OpenPipelineByStage[];
}

export interface SgmPipelineChartData {
  sgm: string;
  totalAum: number;
  totalCount: number;
  // Per-stage AUM values (camelCase keys for Recharts dataKey)
  plannedNurture: number;
  qualifying: number;
  discovery: number;
  salesProcess: number;
  negotiating: number;
  signed: number;
  onHold: number;
  // Per-stage counts (for tooltip display)
  plannedNurtureCount: number;
  qualifyingCount: number;
  discoveryCount: number;
  salesProcessCount: number;
  negotiatingCount: number;
  signedCount: number;
  onHoldCount: number;
}

export interface OpenPipelineBySgmResponse {
  data: SgmPipelineChartData[];
}

/**
 * Available stages for filtering
 */
export interface PipelineStageOption {
  value: string;
  label: string;
  isDefault: boolean;
}

/**
 * SGM option with active status (for pipeline filters)
 */
export interface SgmOption {
  value: string;
  label: string;
  isActive: boolean;
}

/**
 * Multi-select filter state
 */
export interface MultiSelectFilterState {
  selectAll: boolean;
  selected: string[];
}

/**
 * Pipeline page filter state
 */
export interface PipelinePageFilters {
  stages: MultiSelectFilterState;
  sgms: MultiSelectFilterState;
}
