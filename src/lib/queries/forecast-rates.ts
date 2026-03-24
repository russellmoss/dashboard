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
  mean_joined_aum: number;
  joined_deal_count: number;
}

export interface TieredForecastRates {
  flat: ForecastRates;
  lower: ForecastRates;
  upper: ForecastRates;
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
  mean_joined_aum: number | null;
  joined_deal_count: number | null;
}

interface RawTieredRatesResult extends RawRatesResult {
  tier_label: string;
}

const FORECAST_VIEW = 'savvy-gtm-analytics.Tableau_Views.vw_funnel_master';

const _getForecastRates = async (
  conversionWindowDays: 180 | 365 | 730 | null = null
): Promise<ForecastRates> => {
  // For trailing windows (180d, 1yr, 2yr), filter by OppCreatedDate range.
  // For "All time" (null), no date filter — use all resolved SQOs.
  const dateFilter = conversionWindowDays
    ? `AND DATE(Opp_CreatedDate) BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL @windowDays DAY) AND CURRENT_DATE()`
    : '';
  const windowStartLabel = conversionWindowDays
    ? `CAST(DATE_SUB(CURRENT_DATE(), INTERVAL @windowDays DAY) AS STRING)`
    : `'All time'`;
  const windowEndLabel = `CAST(CURRENT_DATE() AS STRING)`;

  const query = `
    WITH cohort AS (
      SELECT
        StageName,
        Date_Became_SQO__c,
        COALESCE(Stage_Entered_Sales_Process__c, Stage_Entered_Negotiating__c, Stage_Entered_Signed__c, Stage_Entered_Joined__c) AS eff_sp_ts,
        COALESCE(Stage_Entered_Negotiating__c, Stage_Entered_Signed__c, Stage_Entered_Joined__c) AS eff_neg_ts,
        COALESCE(Stage_Entered_Signed__c, Stage_Entered_Joined__c) AS eff_signed_ts,
        COALESCE(Stage_Entered_Joined__c, TIMESTAMP(advisor_join_date__c)) AS eff_joined_ts,
        COALESCE(Underwritten_AUM__c, Amount) AS aum_dollars
      FROM \`${FORECAST_VIEW}\`
      WHERE Full_Opportunity_ID__c IS NOT NULL
        AND is_primary_opp_record = 1
        AND SQO_raw = 'Yes'
        AND StageName IN ('Joined', 'Closed Lost')
        ${dateFilter}
    ),
    -- Flag joined deals (accounts for advisor_join_date__c fallback)
    flagged AS (
      SELECT *,
        CASE WHEN eff_joined_ts IS NOT NULL AND StageName != 'Closed Lost' THEN 1 ELSE 0 END AS is_joined
      FROM cohort
    )
    SELECT
      -- "reached this stage or beyond" denominator prevents >100% rates
      -- when deals skip stages (e.g., join without Signed timestamp)
      SAFE_DIVIDE(
        COUNTIF(eff_sp_ts IS NOT NULL OR eff_neg_ts IS NOT NULL OR eff_signed_ts IS NOT NULL OR is_joined = 1),
        COUNT(*)
      ) AS rate_sqo_to_sp,
      SAFE_DIVIDE(
        COUNTIF(eff_neg_ts IS NOT NULL OR eff_signed_ts IS NOT NULL OR is_joined = 1),
        COUNTIF(eff_sp_ts IS NOT NULL OR eff_neg_ts IS NOT NULL OR eff_signed_ts IS NOT NULL OR is_joined = 1)
      ) AS rate_sp_to_neg,
      SAFE_DIVIDE(
        COUNTIF(eff_signed_ts IS NOT NULL OR is_joined = 1),
        COUNTIF(eff_neg_ts IS NOT NULL OR eff_signed_ts IS NOT NULL OR is_joined = 1)
      ) AS rate_neg_to_signed,
      SAFE_DIVIDE(
        COUNTIF(is_joined = 1),
        COUNTIF(eff_signed_ts IS NOT NULL OR is_joined = 1)
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
      ${windowStartLabel} AS window_start,
      ${windowEndLabel} AS window_end,
      COUNT(*) AS cohort_count,
      SAFE_DIVIDE(
        SUM(CASE WHEN is_joined = 1 AND aum_dollars > 0 THEN aum_dollars END),
        COUNTIF(is_joined = 1 AND aum_dollars > 0)
      ) AS mean_joined_aum,
      COUNTIF(is_joined = 1 AND aum_dollars > 0) AS joined_deal_count
    FROM flagged
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
    mean_joined_aum: Math.round(toNumber(r.mean_joined_aum) || 0),
    joined_deal_count: toNumber(r.joined_deal_count) || 0,
  };
};

// Cache TTL: 12 hours (43200 seconds)
export const getForecastRates = cachedQuery(
  _getForecastRates,
  'getForecastRates',
  CACHE_TAGS.DASHBOARD,
  43200
);

// --- Tiered rates (flat + Lower/Upper AUM split) ---

const RATES_SELECT = `
      SAFE_DIVIDE(
        COUNTIF(eff_sp_ts IS NOT NULL OR eff_neg_ts IS NOT NULL OR eff_signed_ts IS NOT NULL OR is_joined = 1),
        COUNT(*)
      ) AS rate_sqo_to_sp,
      SAFE_DIVIDE(
        COUNTIF(eff_neg_ts IS NOT NULL OR eff_signed_ts IS NOT NULL OR is_joined = 1),
        COUNTIF(eff_sp_ts IS NOT NULL OR eff_neg_ts IS NOT NULL OR eff_signed_ts IS NOT NULL OR is_joined = 1)
      ) AS rate_sp_to_neg,
      SAFE_DIVIDE(
        COUNTIF(eff_signed_ts IS NOT NULL OR is_joined = 1),
        COUNTIF(eff_neg_ts IS NOT NULL OR eff_signed_ts IS NOT NULL OR is_joined = 1)
      ) AS rate_neg_to_signed,
      SAFE_DIVIDE(
        COUNTIF(is_joined = 1),
        COUNTIF(eff_signed_ts IS NOT NULL OR is_joined = 1)
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
      COUNT(*) AS cohort_count,
      SAFE_DIVIDE(
        SUM(CASE WHEN is_joined = 1 AND aum_dollars > 0 THEN aum_dollars END),
        COUNTIF(is_joined = 1 AND aum_dollars > 0)
      ) AS mean_joined_aum,
      COUNTIF(is_joined = 1 AND aum_dollars > 0) AS joined_deal_count`;

function mapRawToForecastRates(r: RawRatesResult, windowStart: string, windowEnd: string): ForecastRates {
  return {
    sqo_to_sp: toNumber(r.rate_sqo_to_sp) || 0,
    sp_to_neg: toNumber(r.rate_sp_to_neg) || 0,
    neg_to_signed: toNumber(r.rate_neg_to_signed) || 0,
    signed_to_joined: toNumber(r.rate_signed_to_joined) || 0,
    avg_days_sqo_to_sp: Math.round(toNumber(r.avg_days_sqo_to_sp) || 0),
    avg_days_in_sp: Math.round(toNumber(r.avg_days_in_sp) || 0),
    avg_days_in_neg: Math.round(toNumber(r.avg_days_in_neg) || 0),
    avg_days_in_signed: Math.round(toNumber(r.avg_days_in_signed) || 0),
    window_start: windowStart,
    window_end: windowEnd,
    cohort_count: toNumber(r.cohort_count) || 0,
    mean_joined_aum: Math.round(toNumber(r.mean_joined_aum) || 0),
    joined_deal_count: toNumber(r.joined_deal_count) || 0,
  };
}

const EMPTY_RATES: ForecastRates = {
  sqo_to_sp: 0, sp_to_neg: 0, neg_to_signed: 0, signed_to_joined: 0,
  avg_days_sqo_to_sp: 0, avg_days_in_sp: 0, avg_days_in_neg: 0, avg_days_in_signed: 0,
  window_start: '', window_end: '', cohort_count: 0, mean_joined_aum: 0, joined_deal_count: 0,
};

const _getTieredForecastRates = async (
  conversionWindowDays: 180 | 365 | 730 | null = null
): Promise<TieredForecastRates> => {
  const dateFilter = conversionWindowDays
    ? `AND DATE(Opp_CreatedDate) BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL @windowDays DAY) AND CURRENT_DATE()`
    : '';
  const windowStartLabel = conversionWindowDays
    ? `CAST(DATE_SUB(CURRENT_DATE(), INTERVAL @windowDays DAY) AS STRING)`
    : `'All time'`;
  const windowEndLabel = `CAST(CURRENT_DATE() AS STRING)`;

  // Single query producing 3 rows: flat, Lower, Upper via UNION ALL
  const query = `
    WITH cohort AS (
      SELECT
        StageName,
        Date_Became_SQO__c,
        COALESCE(Stage_Entered_Sales_Process__c, Stage_Entered_Negotiating__c, Stage_Entered_Signed__c, Stage_Entered_Joined__c) AS eff_sp_ts,
        COALESCE(Stage_Entered_Negotiating__c, Stage_Entered_Signed__c, Stage_Entered_Joined__c) AS eff_neg_ts,
        COALESCE(Stage_Entered_Signed__c, Stage_Entered_Joined__c) AS eff_signed_ts,
        COALESCE(Stage_Entered_Joined__c, TIMESTAMP(advisor_join_date__c)) AS eff_joined_ts,
        COALESCE(Underwritten_AUM__c, Amount) AS aum_dollars,
        CASE WHEN COALESCE(Underwritten_AUM__c, Amount) < 75000000 THEN 'Lower' ELSE 'Upper' END AS aum_tier_2
      FROM \`${FORECAST_VIEW}\`
      WHERE Full_Opportunity_ID__c IS NOT NULL
        AND is_primary_opp_record = 1
        AND SQO_raw = 'Yes'
        AND StageName IN ('Joined', 'Closed Lost')
        ${dateFilter}
    ),
    flagged AS (
      SELECT *,
        CASE WHEN eff_joined_ts IS NOT NULL AND StageName != 'Closed Lost' THEN 1 ELSE 0 END AS is_joined
      FROM cohort
    )
    -- Flat (all deals)
    SELECT 'flat' AS tier_label,
      ${RATES_SELECT},
      ${windowStartLabel} AS window_start,
      ${windowEndLabel} AS window_end
    FROM flagged
    UNION ALL
    -- Lower tier (< $75M)
    SELECT 'Lower' AS tier_label,
      ${RATES_SELECT},
      ${windowStartLabel} AS window_start,
      ${windowEndLabel} AS window_end
    FROM flagged WHERE aum_tier_2 = 'Lower'
    UNION ALL
    -- Upper tier (>= $75M)
    SELECT 'Upper' AS tier_label,
      ${RATES_SELECT},
      ${windowStartLabel} AS window_start,
      ${windowEndLabel} AS window_end
    FROM flagged WHERE aum_tier_2 = 'Upper'
  `;

  const params: Record<string, any> = {};
  if (conversionWindowDays) {
    params.windowDays = conversionWindowDays;
  }

  const results = await runQuery<RawTieredRatesResult>(query, params);

  const flat = results.find(r => r.tier_label === 'flat');
  const lower = results.find(r => r.tier_label === 'Lower');
  const upper = results.find(r => r.tier_label === 'Upper');

  const ws = flat ? String(flat.window_start) : '';
  const we = flat ? String(flat.window_end) : '';

  return {
    flat: flat ? mapRawToForecastRates(flat, ws, we) : { ...EMPTY_RATES },
    lower: lower ? mapRawToForecastRates(lower, ws, we) : { ...EMPTY_RATES },
    upper: upper ? mapRawToForecastRates(upper, ws, we) : { ...EMPTY_RATES },
  };
};

export const getTieredForecastRates = cachedQuery(
  _getTieredForecastRates,
  'getTieredForecastRates',
  CACHE_TAGS.DASHBOARD,
  43200
);
