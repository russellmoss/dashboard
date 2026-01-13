// Raw BigQuery result types for compile-time type safety

export interface RawFunnelMetricsResult {
  prospects?: number | null;
  contacted?: number | null;
  mqls?: number | null;
  sqls: number | null;
  sqos: number | null;
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
  aum: number | null;
  salesforce_url: string | null;
  filter_date?: { value: string } | null; // Legacy field name
  relevant_date?: string | { value: string } | null; // The relevant date field (Date_Became_SQO__c, converted_date_raw, etc.)
  is_contacted: number;
  is_mql: number;
  is_sql: number;
  is_sqo: number;
  is_joined: number;
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

export function toNumber(value: number | null | undefined): number {
  return Number(value) || 0;
}

export function toString(value: string | null | undefined): string {
  return value ?? '';
}
