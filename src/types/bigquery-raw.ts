// Raw BigQuery result types for compile-time type safety

export interface RawFunnelMetricsResult {
  prospects?: number | null;
  contacted?: number | null;
  mqls?: number | null;
  sqls: number | null;
  sqos: number | null;
  signed: number | null;
  signed_aum: number | null;
  joined: number | null;
  pipeline_aum: number | null;
  joined_aum: number | null;
}

export interface RawOpenPipelineResult {
  open_pipeline_aum: number | null;
}

export interface RawConversionRatesResult {
  contacted_denom: number | null;
  contacted_numer: number | null;
  mql_denom: number | null;
  mql_numer: number | null;
  sql_denom: number | null;
  sql_numer: number | null;
  sqo_denom: number | null;
  sqo_numer: number | null;
}

export interface RawConversionTrendResult {
  period: string;
  sqls: number | null;
  sqos: number | null;
  joined: number | null;
  contacted_to_mql_numer: number | null;
  contacted_to_mql_denom: number | null;
  mql_to_sql_numer: number | null;
  mql_to_sql_denom: number | null;
  sql_to_sqo_numer: number | null;
  sql_to_sqo_denom: number | null;
  sqo_to_joined_numer: number | null;
  sqo_to_joined_denom: number | null;
}

export interface RawSourcePerformanceResult {
  source?: string | null;
  channel: string | null;
  prospects: number | null;
  contacted: number | null;
  mqls: number | null;
  sqls: number | null;
  sqos: number | null;
  joined: number | null;
  contacted_to_mql_rate: number | null;
  mql_to_sql_rate: number | null;
  sql_to_sqo_rate: number | null;
  sqo_to_joined_rate: number | null;
  aum: number | null;
}

export interface RawDetailRecordResult {
  id: string;
  advisor_name: string | null;
  source: string | null;
  channel: string | null;
  stage: string | null;
  sga: string | null;
  sgm: string | null;
  campaign_id?: string | null;
  campaign_name?: string | null;
  lead_score_tier?: string | null;
  aum: number | null;
  salesforce_url: string | null;
  filter_date?: string | { value: string } | null;
  contacted_date?: string | { value: string } | null; // stage_entered_contacting__c (TIMESTAMP)
  mql_date?: string | { value: string } | null; // mql_stage_entered_ts (TIMESTAMP)
  sql_date?: string | { value: string } | null; // converted_date_raw (DATE)
  sqo_date?: string | { value: string } | null; // Date_Became_SQO__c (TIMESTAMP)
  joined_date?: string | { value: string } | null; // advisor_join_date__c (DATE)
  signed_date?: string | { value: string } | null; // Stage_Entered_Signed__c (TIMESTAMP)
  discovery_date?: string | { value: string } | null; // Stage_Entered_Discovery__c (TIMESTAMP)
  sales_process_date?: string | { value: string } | null; // Stage_Entered_Sales_Process__c (TIMESTAMP)
  negotiating_date?: string | { value: string } | null; // Stage_Entered_Negotiating__c (TIMESTAMP)
  on_hold_date?: string | { value: string } | null; // Stage_Entered_On_Hold__c (TIMESTAMP)
  closed_date?: string | { value: string } | null; // Stage_Entered_Closed__c (TIMESTAMP)
  relevant_date?: string | { value: string } | null; // Legacy - keep for backward compatibility
  initial_call_scheduled_date?: string | { value: string } | null;
  qualification_call_date?: string | { value: string } | null;
  is_contacted: number;
  is_mql: number;
  is_sql: number;
  is_sqo: number;
  is_joined: number;
  recordtypeid?: string | null;
  is_primary_opp_record?: number | null;
  opportunity_id?: string | null;
}

// Forecast Goals Raw Results
export interface RawForecastGoalsResult {
  prospects_goal: number | null;
  mqls_goal: number | null;
  sqls_goal: number | null;
  sqos_goal: number | null;
  joined_goal: number | null;
}

export interface RawChannelForecastResult extends RawForecastGoalsResult {
  channel_grouping_name: string | null;
}

export interface RawSourceForecastResult extends RawForecastGoalsResult {
  original_source: string | null;
  channel_grouping_name: string | null;
}

// Filter Options Raw Results
export interface RawSgaResult {
  sga: string | null;
  isActive: boolean | string | number | null;
}

export interface RawSgmResult {
  sgm: string | null;
  isActive: boolean | string | number | null;
}

export function toNumber(value: number | null | undefined): number {
  return Number(value) || 0;
}

export function toString(value: string | null | undefined): string {
  return value ?? '';
}
