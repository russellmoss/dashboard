import { runQuery } from '../bigquery';
import { toString, toNumber } from '@/types/bigquery-raw';

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

export interface ForecastExportP2Row {
  Full_Opportunity_ID__c: string;
  advisor_name: string;
  SGM_Owner_Name__c: string | null;
  SGA_Owner_Name__c: string | null;
  StageName: string;
  days_in_current_stage: number;
  Opportunity_AUM: number;
  Opportunity_AUM_M: number;
  aum_tier: string;
  is_zero_aum: number;
  p_join: number;
  stages_remaining: number;
  expected_days_remaining: number;
  model_projected_join_date: string | null;
  Earliest_Anticipated_Start_Date__c: string | null;
  final_projected_join_date: string | null;
  date_source: string;
  is_q2_2026: number;
  is_q3_2026: number;
  expected_aum_q2: number;
  expected_aum_q3: number;
  rate_sqo_to_sp: number | null;
  rate_sp_to_neg: number | null;
  rate_neg_to_signed: number | null;
  rate_signed_to_joined: number | null;
}

export interface ForecastExportAuditRow {
  Full_Opportunity_ID__c: string;
  salesforce_url: string;
  advisor_name: string;
  cohort_month: string;
  Opp_CreatedDate: string;
  SGM_Owner_Name__c: string | null;
  SGA_Owner_Name__c: string | null;
  Original_source: string | null;
  Finance_View__c: string | null;
  lead_record_source: string | null;
  SQO_raw: string;
  Date_Became_SQO__c: string | null;
  Stage_Entered_Sales_Process__c: string | null;
  Stage_Entered_Negotiating__c: string | null;
  Stage_Entered_Signed__c: string | null;
  Stage_Entered_Joined__c: string | null;
  Stage_Entered_On_Hold__c: string | null;
  Stage_Entered_Closed__c: string | null;
  advisor_join_date__c: string | null;
  Earliest_Anticipated_Start_Date__c: string | null;
  eff_sp_ts: string | null;
  eff_neg_ts: string | null;
  eff_signed_ts: string | null;
  eff_joined_ts: string | null;
  days_in_current_stage: number | null;
  StageName: string;
  Conversion_Status: string;
  Opportunity_AUM_M: number;
  is_on_hold: number;
  has_anticipated_date: number;
  stages_skipped: number;
}

export async function getForecastExportP2(): Promise<ForecastExportP2Row[]> {
  const query = `
    SELECT *
    FROM \`savvy-gtm-analytics.Tableau_Views.vw_forecast_p2\`
    ORDER BY expected_aum_q2 + expected_aum_q3 DESC
  `;
  const raw = await runQuery<any>(query);
  return raw.map(r => ({
    Full_Opportunity_ID__c: toString(r.Full_Opportunity_ID__c),
    advisor_name: toString(r.advisor_name),
    SGM_Owner_Name__c: r.SGM_Owner_Name__c ? toString(r.SGM_Owner_Name__c) : null,
    SGA_Owner_Name__c: r.SGA_Owner_Name__c ? toString(r.SGA_Owner_Name__c) : null,
    StageName: toString(r.StageName),
    days_in_current_stage: toNumber(r.days_in_current_stage),
    Opportunity_AUM: toNumber(r.Opportunity_AUM),
    Opportunity_AUM_M: toNumber(r.Opportunity_AUM_M),
    aum_tier: toString(r.aum_tier),
    is_zero_aum: toNumber(r.is_zero_aum),
    p_join: toNumber(r.p_join),
    stages_remaining: toNumber(r.stages_remaining),
    expected_days_remaining: toNumber(r.expected_days_remaining),
    model_projected_join_date: extractDateValue(r.model_projected_join_date),
    Earliest_Anticipated_Start_Date__c: extractDateValue(r.Earliest_Anticipated_Start_Date__c),
    final_projected_join_date: extractDateValue(r.final_projected_join_date),
    date_source: toString(r.date_source),
    is_q2_2026: toNumber(r.is_q2_2026),
    is_q3_2026: toNumber(r.is_q3_2026),
    expected_aum_q2: toNumber(r.expected_aum_q2),
    expected_aum_q3: toNumber(r.expected_aum_q3),
    rate_sqo_to_sp: r.rate_sqo_to_sp != null ? toNumber(r.rate_sqo_to_sp) : null,
    rate_sp_to_neg: r.rate_sp_to_neg != null ? toNumber(r.rate_sp_to_neg) : null,
    rate_neg_to_signed: r.rate_neg_to_signed != null ? toNumber(r.rate_neg_to_signed) : null,
    rate_signed_to_joined: r.rate_signed_to_joined != null ? toNumber(r.rate_signed_to_joined) : null,
  }));
}

export async function getForecastExportAudit(): Promise<ForecastExportAuditRow[]> {
  const query = `
    SELECT *
    FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_audit\`
    ORDER BY DATE(Opp_CreatedDate) DESC, advisor_name ASC
  `;
  const raw = await runQuery<any>(query);
  return raw.map(r => ({
    Full_Opportunity_ID__c: toString(r.Full_Opportunity_ID__c),
    salesforce_url: toString(r.salesforce_url),
    advisor_name: toString(r.advisor_name),
    cohort_month: toString(r.cohort_month),
    Opp_CreatedDate: extractDateValue(r.Opp_CreatedDate) || toString(r.Opp_CreatedDate),
    SGM_Owner_Name__c: r.SGM_Owner_Name__c ? toString(r.SGM_Owner_Name__c) : null,
    SGA_Owner_Name__c: r.SGA_Owner_Name__c ? toString(r.SGA_Owner_Name__c) : null,
    Original_source: r.Original_source ? toString(r.Original_source) : null,
    Finance_View__c: r.Finance_View__c ? toString(r.Finance_View__c) : null,
    lead_record_source: r.lead_record_source ? toString(r.lead_record_source) : null,
    SQO_raw: toString(r.SQO_raw),
    Date_Became_SQO__c: extractDateValue(r.Date_Became_SQO__c),
    Stage_Entered_Sales_Process__c: extractDateValue(r.Stage_Entered_Sales_Process__c),
    Stage_Entered_Negotiating__c: extractDateValue(r.Stage_Entered_Negotiating__c),
    Stage_Entered_Signed__c: extractDateValue(r.Stage_Entered_Signed__c),
    Stage_Entered_Joined__c: extractDateValue(r.Stage_Entered_Joined__c),
    Stage_Entered_On_Hold__c: extractDateValue(r.Stage_Entered_On_Hold__c),
    Stage_Entered_Closed__c: extractDateValue(r.Stage_Entered_Closed__c),
    advisor_join_date__c: extractDateValue(r.advisor_join_date__c),
    Earliest_Anticipated_Start_Date__c: extractDateValue(r.Earliest_Anticipated_Start_Date__c),
    eff_sp_ts: extractDateValue(r.eff_sp_ts),
    eff_neg_ts: extractDateValue(r.eff_neg_ts),
    eff_signed_ts: extractDateValue(r.eff_signed_ts),
    eff_joined_ts: extractDateValue(r.eff_joined_ts),
    days_in_current_stage: r.days_in_current_stage != null ? toNumber(r.days_in_current_stage) : null,
    StageName: toString(r.StageName),
    Conversion_Status: toString(r.Conversion_Status),
    Opportunity_AUM_M: toNumber(r.Opportunity_AUM_M),
    is_on_hold: toNumber(r.is_on_hold),
    has_anticipated_date: toNumber(r.has_anticipated_date),
    stages_skipped: toNumber(r.stages_skipped),
  }));
}
