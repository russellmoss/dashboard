import { runQuery } from '../bigquery';
import { toNumber, toString } from '@/types/bigquery-raw';
import { cachedQuery, CACHE_TAGS } from '@/lib/cache';

function extractDateValue(
  field: { value: string } | string | null | undefined
): string | null {
  if (!field) return null;
  if (typeof field === 'object' && field !== null && 'value' in field) {
    return typeof field.value === 'string' ? field.value : null;
  }
  if (typeof field === 'string') return field;
  return null;
}

export interface ForecastPipelineRecord {
  Full_Opportunity_ID__c: string;
  advisor_name: string;
  salesforce_url: string;
  SGM_Owner_Name__c: string | null;
  SGA_Owner_Name__c: string | null;
  StageName: string;
  days_in_current_stage: number;
  Opportunity_AUM_M: number;
  aum_tier: string;
  is_zero_aum: boolean;
  p_join: number;
  expected_days_remaining: number;
  model_projected_join_date: string | null;
  Earliest_Anticipated_Start_Date__c: string | null;
  final_projected_join_date: string | null;
  date_source: 'Anticipated' | 'Model';
  is_q2_2026: boolean;
  is_q3_2026: boolean;
  expected_aum_q2: number;
  expected_aum_q3: number;
  rate_sqo_to_sp: number | null;
  rate_sp_to_neg: number | null;
  rate_neg_to_signed: number | null;
  rate_signed_to_joined: number | null;
}

export interface ForecastSummary {
  total_opps: number;
  q2_expected_aum: number;
  q3_expected_aum: number;
  q2_opp_count: number;
  q3_opp_count: number;
  zero_aum_count: number;
  anticipated_date_count: number;
  pipeline_total_aum: number;
}

const FORECAST_P2_VIEW = 'savvy-gtm-analytics.Tableau_Views.vw_forecast_p2';

const _getForecastPipeline = async (
  sgmFilter?: string | null,
  sgaFilter?: string | null
): Promise<{ records: ForecastPipelineRecord[]; summary: ForecastSummary }> => {
  const conditions: string[] = [];
  const params: Record<string, any> = {};

  if (sgmFilter) {
    conditions.push('SGM_Owner_Name__c = @sgmFilter');
    params.sgmFilter = sgmFilter;
  }
  if (sgaFilter) {
    conditions.push('SGA_Owner_Name__c = @sgaFilter');
    params.sgaFilter = sgaFilter;
  }

  const whereClause = conditions.length > 0
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  const query = `
    SELECT *
    FROM \`${FORECAST_P2_VIEW}\`
    ${whereClause}
    ORDER BY expected_aum_q2 + expected_aum_q3 DESC
  `;

  const raw = await runQuery<any>(query, params);

  const records: ForecastPipelineRecord[] = raw.map((r: any) => ({
    Full_Opportunity_ID__c: toString(r.Full_Opportunity_ID__c),
    advisor_name: toString(r.advisor_name),
    salesforce_url: toString(r.salesforce_url),
    SGM_Owner_Name__c: r.SGM_Owner_Name__c ? toString(r.SGM_Owner_Name__c) : null,
    SGA_Owner_Name__c: r.SGA_Owner_Name__c ? toString(r.SGA_Owner_Name__c) : null,
    StageName: toString(r.StageName),
    days_in_current_stage: toNumber(r.days_in_current_stage),
    Opportunity_AUM_M: toNumber(r.Opportunity_AUM_M),
    aum_tier: toString(r.aum_tier),
    is_zero_aum: toNumber(r.is_zero_aum) === 1,
    p_join: toNumber(r.p_join),
    expected_days_remaining: toNumber(r.expected_days_remaining),
    model_projected_join_date: extractDateValue(r.model_projected_join_date),
    Earliest_Anticipated_Start_Date__c: extractDateValue(r.Earliest_Anticipated_Start_Date__c),
    final_projected_join_date: extractDateValue(r.final_projected_join_date),
    date_source: toString(r.date_source) as 'Anticipated' | 'Model',
    is_q2_2026: toNumber(r.is_q2_2026) === 1,
    is_q3_2026: toNumber(r.is_q3_2026) === 1,
    expected_aum_q2: toNumber(r.expected_aum_q2),
    expected_aum_q3: toNumber(r.expected_aum_q3),
    rate_sqo_to_sp: r.rate_sqo_to_sp != null ? toNumber(r.rate_sqo_to_sp) : null,
    rate_sp_to_neg: r.rate_sp_to_neg != null ? toNumber(r.rate_sp_to_neg) : null,
    rate_neg_to_signed: r.rate_neg_to_signed != null ? toNumber(r.rate_neg_to_signed) : null,
    rate_signed_to_joined: r.rate_signed_to_joined != null ? toNumber(r.rate_signed_to_joined) : null,
  }));

  const summary: ForecastSummary = {
    total_opps: records.length,
    q2_expected_aum: records.reduce((sum, r) => sum + r.expected_aum_q2, 0),
    q3_expected_aum: records.reduce((sum, r) => sum + r.expected_aum_q3, 0),
    q2_opp_count: records.filter(r => r.is_q2_2026).length,
    q3_opp_count: records.filter(r => r.is_q3_2026).length,
    zero_aum_count: records.filter(r => r.is_zero_aum).length,
    anticipated_date_count: records.filter(r => r.date_source === 'Anticipated').length,
    pipeline_total_aum: records.reduce((sum, r) => sum + r.Opportunity_AUM_M, 0),
  };

  return { records, summary };
};

// Cache TTL: 6 hours (21600 seconds)
export const getForecastPipeline = cachedQuery(
  _getForecastPipeline,
  'getForecastPipeline',
  CACHE_TAGS.DASHBOARD,
  21600
);
