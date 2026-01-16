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
  joined: number;
  pipelineAum: number;
  joinedAum: number;
  openPipelineAum: number;
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
  aum: number;
  aumFormatted: string;
  salesforceUrl: string;
  relevantDate: string; // The relevant date field based on metric filter (Date_Became_SQO__c, converted_date_raw, advisor_join_date__c, etc.)
  initialCallScheduledDate: string | null; // Initial_Call_Scheduled_Date__c (DATE field)
  qualificationCallDate: string | null; // Qualification_Call_Date__c (DATE field)
  isContacted: boolean;
  isMql: boolean;
  isSql: boolean;
  isSqo: boolean;
  isJoined: boolean;
  isOpenPipeline: boolean;
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
