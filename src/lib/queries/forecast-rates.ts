import { runQuery } from '../bigquery';
import { toNumber } from '@/types/bigquery-raw';
import { cachedQuery, CACHE_TAGS } from '@/lib/cache';

export interface ForecastRates {
  sqo_to_sp: number;
  sp_to_neg: number;
  neg_to_signed: number;
  signed_to_joined: number;
  avg_days_sqo_to_sp: number;
  avg_days_in_sp: number;
  avg_days_in_neg: number;
  avg_days_in_signed: number;
  window_start: string;
  window_end: string;
  cohort_count: number;
}

interface RawRatesResult {
  rate_sqo_to_sp: number | null;
  rate_sp_to_neg: number | null;
  rate_neg_to_signed: number | null;
  rate_signed_to_joined: number | null;
  avg_days_sqo_to_sp: number | null;
  avg_days_in_sp: number | null;
  avg_days_in_neg: number | null;
  avg_days_in_signed: number | null;
  window_start: string;
  window_end: string;
  cohort_count: number;
}

const FORECAST_VIEW = 'savvy-gtm-analytics.Tableau_Views.vw_funnel_master';

const _getForecastRates = async (
  conversionWindowDays: 180 | 365 | 730 | null = null
): Promise<ForecastRates> => {
  const windowStart = conversionWindowDays
    ? `DATE_SUB(CURRENT_DATE(), INTERVAL @windowDays DAY)`
    : `'2025-06-01'`;
  const windowEnd = conversionWindowDays
    ? `CURRENT_DATE()`
    : `'2025-12-31'`;

  const query = `
    WITH cohort AS (
      SELECT
        StageName,
        Date_Became_SQO__c,
        COALESCE(Stage_Entered_Sales_Process__c, Stage_Entered_Negotiating__c, Stage_Entered_Signed__c, Stage_Entered_Joined__c) AS eff_sp_ts,
        COALESCE(Stage_Entered_Negotiating__c, Stage_Entered_Signed__c, Stage_Entered_Joined__c) AS eff_neg_ts,
        COALESCE(Stage_Entered_Signed__c, Stage_Entered_Joined__c) AS eff_signed_ts,
        COALESCE(Stage_Entered_Joined__c, TIMESTAMP(advisor_join_date__c)) AS eff_joined_ts
      FROM \`${FORECAST_VIEW}\`
      WHERE Full_Opportunity_ID__c IS NOT NULL
        AND is_primary_opp_record = 1
        AND SQO_raw = 'Yes'
        AND DATE(Opp_CreatedDate) BETWEEN ${windowStart} AND ${windowEnd}
        AND StageName != 'On Hold'
    )
    SELECT
      SAFE_DIVIDE(COUNTIF(eff_sp_ts IS NOT NULL), COUNT(*)) AS rate_sqo_to_sp,
      SAFE_DIVIDE(COUNTIF(eff_neg_ts IS NOT NULL), COUNTIF(eff_sp_ts IS NOT NULL)) AS rate_sp_to_neg,
      SAFE_DIVIDE(COUNTIF(eff_signed_ts IS NOT NULL), COUNTIF(eff_neg_ts IS NOT NULL)) AS rate_neg_to_signed,
      SAFE_DIVIDE(
        COUNTIF(eff_joined_ts IS NOT NULL AND StageName != 'Closed Lost'),
        COUNTIF(eff_signed_ts IS NOT NULL)
      ) AS rate_signed_to_joined,
      SAFE_DIVIDE(
        SUM(CASE WHEN Date_Became_SQO__c IS NOT NULL AND eff_sp_ts IS NOT NULL
                 AND DATE(Date_Became_SQO__c) <= DATE(eff_sp_ts)
            THEN DATE_DIFF(DATE(eff_sp_ts), DATE(Date_Became_SQO__c), DAY) END),
        COUNTIF(Date_Became_SQO__c IS NOT NULL AND eff_sp_ts IS NOT NULL
                AND DATE(Date_Became_SQO__c) <= DATE(eff_sp_ts))
      ) AS avg_days_sqo_to_sp,
      SAFE_DIVIDE(
        SUM(CASE WHEN eff_sp_ts IS NOT NULL AND eff_neg_ts IS NOT NULL
                 AND DATE(eff_sp_ts) <= DATE(eff_neg_ts)
            THEN DATE_DIFF(DATE(eff_neg_ts), DATE(eff_sp_ts), DAY) END),
        COUNTIF(eff_sp_ts IS NOT NULL AND eff_neg_ts IS NOT NULL
                AND DATE(eff_sp_ts) <= DATE(eff_neg_ts))
      ) AS avg_days_in_sp,
      SAFE_DIVIDE(
        SUM(CASE WHEN eff_neg_ts IS NOT NULL AND eff_signed_ts IS NOT NULL
                 AND DATE(eff_neg_ts) <= DATE(eff_signed_ts)
            THEN DATE_DIFF(DATE(eff_signed_ts), DATE(eff_neg_ts), DAY) END),
        COUNTIF(eff_neg_ts IS NOT NULL AND eff_signed_ts IS NOT NULL
                AND DATE(eff_neg_ts) <= DATE(eff_signed_ts))
      ) AS avg_days_in_neg,
      SAFE_DIVIDE(
        SUM(CASE WHEN eff_signed_ts IS NOT NULL AND eff_joined_ts IS NOT NULL
                 AND DATE(eff_signed_ts) <= DATE(eff_joined_ts)
            THEN DATE_DIFF(DATE(eff_joined_ts), DATE(eff_signed_ts), DAY) END),
        COUNTIF(eff_signed_ts IS NOT NULL AND eff_joined_ts IS NOT NULL
                AND DATE(eff_signed_ts) <= DATE(eff_joined_ts))
      ) AS avg_days_in_signed,
      ${windowStart} AS window_start,
      ${windowEnd} AS window_end,
      COUNT(*) AS cohort_count
    FROM cohort
  `;

  const params: Record<string, any> = {};
  if (conversionWindowDays) {
    params.windowDays = conversionWindowDays;
  }

  const results = await runQuery<RawRatesResult>(query, params);
  const r = results[0];

  return {
    sqo_to_sp: toNumber(r.rate_sqo_to_sp) || 0,
    sp_to_neg: toNumber(r.rate_sp_to_neg) || 0,
    neg_to_signed: toNumber(r.rate_neg_to_signed) || 0,
    signed_to_joined: toNumber(r.rate_signed_to_joined) || 0,
    avg_days_sqo_to_sp: Math.round(toNumber(r.avg_days_sqo_to_sp) || 0),
    avg_days_in_sp: Math.round(toNumber(r.avg_days_in_sp) || 0),
    avg_days_in_neg: Math.round(toNumber(r.avg_days_in_neg) || 0),
    avg_days_in_signed: Math.round(toNumber(r.avg_days_in_signed) || 0),
    window_start: String(r.window_start),
    window_end: String(r.window_end),
    cohort_count: toNumber(r.cohort_count) || 0,
  };
};

// Cache TTL: 12 hours (43200 seconds)
export const getForecastRates = cachedQuery(
  _getForecastRates,
  'getForecastRates',
  CACHE_TAGS.DASHBOARD,
  43200
);
