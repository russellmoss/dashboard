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

import type { DurationBucket } from '@/lib/forecast-config';

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
  projected_quarter: string | null;
  expected_aum_weighted: number;
  rate_sqo_to_sp: number | null;
  rate_sp_to_neg: number | null;
  rate_neg_to_signed: number | null;
  rate_signed_to_joined: number | null;
  // Duration penalty fields (computed client-side, not from BQ)
  durationBucket?: DurationBucket;
  durationMultiplier?: number;
  baselinePJoin?: number;
  baselineExpectedAum?: number;
  aumTier2?: 'Lower' | 'Upper';
  // Date revision confidence fields (from OpportunityFieldHistory)
  dateRevisionCount?: number;
  dateConfidence?: 'High' | 'Medium' | 'Low';
  firstDateSet?: string | null;
}

export interface QuarterSummary {
  label: string;
  opp_count: number;
  expected_aum: number;
}

export interface ForecastSummary {
  total_opps: number;
  pipeline_total_aum: number;
  zero_aum_count: number;
  anticipated_date_count: number;
  quarters: QuarterSummary[];
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
    ORDER BY expected_aum_weighted DESC
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
    projected_quarter: r.projected_quarter ? toString(r.projected_quarter) : null,
    expected_aum_weighted: toNumber(r.expected_aum_weighted),
    rate_sqo_to_sp: r.rate_sqo_to_sp != null ? toNumber(r.rate_sqo_to_sp) : null,
    rate_sp_to_neg: r.rate_sp_to_neg != null ? toNumber(r.rate_sp_to_neg) : null,
    rate_neg_to_signed: r.rate_neg_to_signed != null ? toNumber(r.rate_neg_to_signed) : null,
    rate_signed_to_joined: r.rate_signed_to_joined != null ? toNumber(r.rate_signed_to_joined) : null,
  }));

  // Build quarters array by grouping on projected_quarter
  const quarterMap = new Map<string, { opp_count: number; expected_aum: number }>();
  for (const r of records) {
    if (r.projected_quarter) {
      const existing = quarterMap.get(r.projected_quarter);
      if (existing) {
        existing.opp_count += 1;
        existing.expected_aum += r.expected_aum_weighted;
      } else {
        quarterMap.set(r.projected_quarter, { opp_count: 1, expected_aum: r.expected_aum_weighted });
      }
    }
  }

  // Sort quarters chronologically (Q1 2026 < Q2 2026 < Q3 2026 etc.)
  const quarters: QuarterSummary[] = Array.from(quarterMap.entries())
    .map(([label, data]) => ({ label, ...data }))
    .sort((a, b) => {
      const [aq, ay] = a.label.replace('Q', '').split(' ').map(Number);
      const [bq, by] = b.label.replace('Q', '').split(' ').map(Number);
      return ay !== by ? ay - by : aq - bq;
    });

  const summary: ForecastSummary = {
    total_opps: records.length,
    pipeline_total_aum: records.reduce((sum, r) => sum + r.Opportunity_AUM_M, 0),
    zero_aum_count: records.filter(r => r.is_zero_aum).length,
    anticipated_date_count: records.filter(r => r.date_source === 'Anticipated').length,
    quarters,
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

// --- Joined AUM by quarter (actual closed deals) ---

const _getJoinedAumByQuarter = async (): Promise<Record<string, { joined_aum: number; joined_count: number }>> => {
  const query = `
    SELECT
      CONCAT('Q', EXTRACT(QUARTER FROM advisor_join_date__c), ' ', EXTRACT(YEAR FROM advisor_join_date__c)) AS quarter_label,
      COUNT(*) AS joined_count,
      SUM(COALESCE(Underwritten_AUM__c, Amount, 0)) AS joined_aum
    FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\`
    WHERE is_joined = 1
      AND is_primary_opp_record = 1
      AND advisor_join_date__c >= DATE_SUB(CURRENT_DATE(), INTERVAL 730 DAY)
    GROUP BY quarter_label
  `;

  const rows = await runQuery<{ quarter_label: string; joined_count: number | null; joined_aum: number | null }>(query);

  const result: Record<string, { joined_aum: number; joined_count: number }> = {};
  for (const r of rows) {
    const label = r.quarter_label;
    if (label) {
      result[label] = {
        joined_aum: toNumber(r.joined_aum) || 0,
        joined_count: toNumber(r.joined_count) || 0,
      };
    }
  }
  return result;
};

export const getJoinedAumByQuarter = cachedQuery(
  _getJoinedAumByQuarter,
  'getJoinedAumByQuarter',
  CACHE_TAGS.DASHBOARD,
  21600
);

// Compute the trailing 4-quarter surprise baseline from live data.
// Uses OpportunityFieldHistory to PIT-reconstruct Component A, then:
//   Surprise per quarter = Total Joined AUM − Component A Joined AUM
//   Baseline = average of last 4 completed quarters
// This replaces the hardcoded $398M constant with a live-computed value.
const _getSurpriseBaseline = async (): Promise<number> => {
  const rows = await runQuery<{ surprise_baseline: number | null }>(`
    WITH completed_quarters AS (
      -- Last 4 completed quarters (not the current quarter)
      SELECT qtr, q_start, q_end FROM UNNEST([
        STRUCT('Q1 2025' AS qtr, DATE '2025-01-01' AS q_start, DATE '2025-04-01' AS q_end),
        STRUCT('Q2 2025', DATE '2025-04-01', DATE '2025-07-01'),
        STRUCT('Q3 2025', DATE '2025-07-01', DATE '2025-10-01'),
        STRUCT('Q4 2025', DATE '2025-10-01', DATE '2026-01-01')
      ])
    ),
    -- Total joined AUM per quarter
    joined_totals AS (
      SELECT
        CONCAT('Q', EXTRACT(QUARTER FROM f.advisor_join_date__c), ' ', EXTRACT(YEAR FROM f.advisor_join_date__c)) AS qtr,
        SUM(COALESCE(f.Underwritten_AUM__c, f.Amount, 0)) AS total_joined_aum
      FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\` f
      WHERE f.is_joined = 1 AND f.is_primary_opp_record = 1
        AND f.advisor_join_date__c >= '2025-01-01' AND f.advisor_join_date__c < '2026-01-01'
        AND COALESCE(f.Underwritten_AUM__c, f.Amount, 0) > 1000
      GROUP BY qtr
    ),
    -- PIT-corrected Component A: Neg+Signed with anticipated date in quarter at quarter start
    pit_date_changes AS (
      SELECT
        h.OpportunityId, q.qtr,
        SAFE.PARSE_DATE('%F', h.OldValue) AS pit_date
      FROM \`savvy-gtm-analytics.SavvyGTMData.OpportunityFieldHistory\` h
      CROSS JOIN completed_quarters q
      WHERE h.Field = 'Earliest_Anticipated_Start_Date__c'
        AND DATE(h.CreatedDate) >= q.q_start
      QUALIFY ROW_NUMBER() OVER (PARTITION BY h.OpportunityId, q.qtr ORDER BY h.CreatedDate ASC) = 1
    ),
    component_a_joined AS (
      SELECT
        q.qtr,
        SUM(COALESCE(f.Underwritten_AUM__c, f.Amount, 0)) AS component_a_aum
      FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\` f
      CROSS JOIN completed_quarters q
      LEFT JOIN pit_date_changes pd ON pd.OpportunityId = f.Full_Opportunity_ID__c AND pd.qtr = q.qtr
      WHERE f.SQO_raw = 'Yes' AND f.is_primary_opp_record = 1
        AND DATE(f.Date_Became_SQO__c) < q.q_start
        AND (f.advisor_join_date__c IS NULL OR f.advisor_join_date__c >= q.q_start)
        AND (f.Stage_Entered_Closed__c IS NULL OR DATE(f.Stage_Entered_Closed__c) >= q.q_start)
        AND COALESCE(f.Underwritten_AUM__c, f.Amount, 0) > 1000
        -- Stage at snapshot must be Neg or Signed
        AND (
          (f.Stage_Entered_Signed__c IS NOT NULL AND DATE(f.Stage_Entered_Signed__c) < q.q_start)
          OR (f.Stage_Entered_Negotiating__c IS NOT NULL AND DATE(f.Stage_Entered_Negotiating__c) < q.q_start
              AND (f.Stage_Entered_Signed__c IS NULL OR DATE(f.Stage_Entered_Signed__c) >= q.q_start))
        )
        -- PIT anticipated date falls within the quarter
        AND COALESCE(pd.pit_date, f.Earliest_Anticipated_Start_Date__c) >= q.q_start
        AND COALESCE(pd.pit_date, f.Earliest_Anticipated_Start_Date__c) < q.q_end
        -- Must have actually joined in the quarter
        AND f.StageName = 'Joined'
        AND f.advisor_join_date__c >= q.q_start AND f.advisor_join_date__c < q.q_end
      GROUP BY q.qtr
    ),
    quarterly_surprise AS (
      SELECT
        j.qtr,
        j.total_joined_aum,
        COALESCE(a.component_a_aum, 0) AS component_a_aum,
        j.total_joined_aum - COALESCE(a.component_a_aum, 0) AS surprise_aum
      FROM joined_totals j
      LEFT JOIN component_a_joined a ON a.qtr = j.qtr
    )
    SELECT AVG(surprise_aum) AS surprise_baseline
    FROM quarterly_surprise
  `);

  return toNumber(rows[0]?.surprise_baseline) || 398_000_000; // fallback to backtest value if query fails
};

export const getSurpriseBaseline = cachedQuery(
  _getSurpriseBaseline,
  'getSurpriseBaseline',
  CACHE_TAGS.DASHBOARD,
  86400 // 24h cache — only changes when a quarter completes
);
