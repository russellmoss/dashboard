import { runQuery } from '../bigquery';
import { toNumber, toString } from '@/types/bigquery-raw';
import type { TieredForecastRates } from './forecast-rates';
import { TIER_FALLBACK_MIN_COHORT } from '@/lib/forecast-config';

export interface MonteCarloRequest {
  conversionRates?: {
    sqo_to_sp: number;
    sp_to_neg: number;
    neg_to_signed: number;
    signed_to_joined: number;
  };
  avgDays?: {
    in_sp: number;
    in_neg: number;
    in_signed: number;
  };
  conversionWindowDays?: 180 | 365 | 730 | null;
}

export interface MonteCarloQuarterResult {
  label: string;   // "Q2 2026", "Q3 2026", etc.
  p10: number;
  p50: number;
  p90: number;
  mean: number;
}

export interface MonteCarloPerOpp {
  oppId: string;
  quarterLabel: string;
  winPct: number;
  avgAum: number;
  durationBucket?: string;
  durationMultiplier?: number;
  aumTier2?: string;
}

export interface MonteCarloResponse {
  quarters: MonteCarloQuarterResult[];
  perOpp: MonteCarloPerOpp[];
  trialCount: number;
  ratesUsed: {
    sqo_to_sp: number;
    sp_to_neg: number;
    neg_to_signed: number;
    signed_to_joined: number;
  };
}

const FUNNEL_MASTER = 'savvy-gtm-analytics.Tableau_Views.vw_funnel_master';

// Start at 5K trials. Benchmark P99 latency before increasing.
const TRIAL_COUNT = 5000;

// Shared CTE block used by both the aggregate and per-opp queries.
// Per-deal adjusted rates are computed in deal_rates CTE using tiered rate
// parameters (@rate_lower_*, @rate_upper_*) and duration penalty multipliers.
function simulationCTE(): string {
  return `
    open_pipeline AS (
      SELECT
        Full_Opportunity_ID__c AS opp_id,
        StageName,
        COALESCE(Underwritten_AUM__c, Amount) AS Opportunity_AUM,
        CASE
          WHEN COALESCE(Underwritten_AUM__c, Amount) IS NULL
            OR COALESCE(Underwritten_AUM__c, Amount) = 0
          THEN 1 ELSE 0
        END AS is_zero_aum,
        Earliest_Anticipated_Start_Date__c,
        CASE
          WHEN StageName = 'Sales Process' THEN Stage_Entered_Sales_Process__c
          WHEN StageName = 'Negotiating'   THEN Stage_Entered_Negotiating__c
          WHEN StageName = 'Signed'        THEN Stage_Entered_Signed__c
          WHEN StageName IN ('Qualifying', 'Discovery') THEN Date_Became_SQO__c
          ELSE NULL
        END AS current_stage_entry_ts,
        CASE
          WHEN CASE
            WHEN StageName = 'Sales Process' THEN Stage_Entered_Sales_Process__c
            WHEN StageName = 'Negotiating'   THEN Stage_Entered_Negotiating__c
            WHEN StageName = 'Signed'        THEN Stage_Entered_Signed__c
            WHEN StageName IN ('Qualifying', 'Discovery') THEN Date_Became_SQO__c
            ELSE NULL
          END IS NOT NULL
          THEN DATE_DIFF(CURRENT_DATE(), DATE(CASE
            WHEN StageName = 'Sales Process' THEN Stage_Entered_Sales_Process__c
            WHEN StageName = 'Negotiating'   THEN Stage_Entered_Negotiating__c
            WHEN StageName = 'Signed'        THEN Stage_Entered_Signed__c
            WHEN StageName IN ('Qualifying', 'Discovery') THEN Date_Became_SQO__c
            ELSE NULL
          END), DAY)
          ELSE 0
        END AS days_in_current_stage
      FROM \`${FUNNEL_MASTER}\`
      WHERE SQO_raw = 'Yes'
        AND StageName NOT IN ('On Hold', 'Closed Lost', 'Joined')
        AND Full_Opportunity_ID__c IS NOT NULL
        AND is_sqo_unique = 1
        AND recordtypeid = '012Dn000000mrO3IAI'
    ),

    deal_rates AS (
      SELECT
        o.opp_id,
        o.StageName,
        o.Opportunity_AUM,
        o.is_zero_aum,
        o.Earliest_Anticipated_Start_Date__c,
        o.current_stage_entry_ts,
        o.days_in_current_stage,

        -- AUM tier
        CASE WHEN o.Opportunity_AUM < 75000000 THEN 'Lower' ELSE 'Upper' END AS aum_tier_2,

        -- Duration bucket
        CASE o.StageName
          WHEN 'Discovery' THEN CASE
            WHEN o.days_in_current_stage > 64 THEN '2+ SD'
            WHEN o.days_in_current_stage > 36 THEN '1-2 SD'
            ELSE 'Within 1 SD' END
          WHEN 'Qualifying' THEN CASE
            WHEN o.days_in_current_stage > 64 THEN '2+ SD'
            WHEN o.days_in_current_stage > 36 THEN '1-2 SD'
            ELSE 'Within 1 SD' END
          WHEN 'Sales Process' THEN CASE
            WHEN o.days_in_current_stage > 105 THEN '2+ SD'
            WHEN o.days_in_current_stage > 67 THEN '1-2 SD'
            ELSE 'Within 1 SD' END
          WHEN 'Negotiating' THEN CASE
            WHEN o.days_in_current_stage > 81 THEN '2+ SD'
            WHEN o.days_in_current_stage > 50 THEN '1-2 SD'
            ELSE 'Within 1 SD' END
          ELSE 'Within 1 SD'
        END AS duration_bucket,

        -- Duration multiplier
        CASE o.StageName
          WHEN 'Discovery' THEN CASE
            WHEN o.days_in_current_stage > 64 THEN 0.393
            WHEN o.days_in_current_stage > 36 THEN 0.667
            ELSE 1.0 END
          WHEN 'Qualifying' THEN CASE
            WHEN o.days_in_current_stage > 64 THEN 0.393
            WHEN o.days_in_current_stage > 36 THEN 0.667
            ELSE 1.0 END
          WHEN 'Sales Process' THEN CASE
            WHEN o.days_in_current_stage > 105 THEN 0.176
            WHEN o.days_in_current_stage > 67 THEN 0.755
            ELSE 1.0 END
          WHEN 'Negotiating' THEN CASE
            WHEN o.days_in_current_stage > 81 THEN 0.179
            WHEN o.days_in_current_stage > 50 THEN 0.682
            ELSE 1.0 END
          ELSE 1.0
        END AS duration_multiplier,

        -- Base tier rates (Lower or Upper depending on AUM)
        CASE WHEN o.Opportunity_AUM < 75000000
          THEN @rate_lower_sqo_sp ELSE @rate_upper_sqo_sp END AS base_sqo_sp,
        CASE WHEN o.Opportunity_AUM < 75000000
          THEN @rate_lower_sp_neg ELSE @rate_upper_sp_neg END AS base_sp_neg,
        CASE WHEN o.Opportunity_AUM < 75000000
          THEN @rate_lower_neg_signed ELSE @rate_upper_neg_signed END AS base_neg_signed,
        CASE WHEN o.Opportunity_AUM < 75000000
          THEN @rate_lower_signed_joined ELSE @rate_upper_signed_joined END AS base_signed_joined,

        -- Adjusted current-stage rate = base × multiplier, clamped to [0, 1]
        GREATEST(0, LEAST(1,
          CASE o.StageName
            WHEN 'Discovery' THEN
              CASE WHEN o.Opportunity_AUM < 75000000 THEN @rate_lower_sqo_sp ELSE @rate_upper_sqo_sp END
              * CASE WHEN o.days_in_current_stage > 64 THEN 0.393
                     WHEN o.days_in_current_stage > 36 THEN 0.667 ELSE 1.0 END
            WHEN 'Qualifying' THEN
              CASE WHEN o.Opportunity_AUM < 75000000 THEN @rate_lower_sqo_sp ELSE @rate_upper_sqo_sp END
              * CASE WHEN o.days_in_current_stage > 64 THEN 0.393
                     WHEN o.days_in_current_stage > 36 THEN 0.667 ELSE 1.0 END
            WHEN 'Sales Process' THEN
              CASE WHEN o.Opportunity_AUM < 75000000 THEN @rate_lower_sp_neg ELSE @rate_upper_sp_neg END
              * CASE WHEN o.days_in_current_stage > 105 THEN 0.176
                     WHEN o.days_in_current_stage > 67 THEN 0.755 ELSE 1.0 END
            WHEN 'Negotiating' THEN
              CASE WHEN o.Opportunity_AUM < 75000000 THEN @rate_lower_neg_signed ELSE @rate_upper_neg_signed END
              * CASE WHEN o.days_in_current_stage > 81 THEN 0.179
                     WHEN o.days_in_current_stage > 50 THEN 0.682 ELSE 1.0 END
            WHEN 'Signed' THEN
              CASE WHEN o.Opportunity_AUM < 75000000 THEN @rate_lower_signed_joined ELSE @rate_upper_signed_joined END
          END
        )) AS adjusted_current_rate
      FROM open_pipeline o
    ),

    trials AS (
      SELECT trial_id
      FROM UNNEST(GENERATE_ARRAY(1, ${TRIAL_COUNT})) AS trial_id
    ),

    simulation AS (
      SELECT
        t.trial_id,
        dr.opp_id,
        dr.StageName,
        dr.Opportunity_AUM,
        dr.is_zero_aum,
        dr.duration_bucket,
        dr.duration_multiplier,
        dr.aum_tier_2,
        CASE
          WHEN dr.StageName IN ('Discovery', 'Qualifying')
          THEN (CASE WHEN RAND() < dr.adjusted_current_rate THEN 1 ELSE 0 END)
               * (CASE WHEN RAND() < dr.base_sp_neg THEN 1 ELSE 0 END)
               * (CASE WHEN RAND() < dr.base_neg_signed THEN 1 ELSE 0 END)
               * (CASE WHEN RAND() < dr.base_signed_joined THEN 1 ELSE 0 END)
          WHEN dr.StageName = 'Sales Process'
          THEN (CASE WHEN RAND() < dr.adjusted_current_rate THEN 1 ELSE 0 END)
               * (CASE WHEN RAND() < dr.base_neg_signed THEN 1 ELSE 0 END)
               * (CASE WHEN RAND() < dr.base_signed_joined THEN 1 ELSE 0 END)
          WHEN dr.StageName = 'Negotiating'
          THEN (CASE WHEN RAND() < dr.adjusted_current_rate THEN 1 ELSE 0 END)
               * (CASE WHEN RAND() < dr.base_signed_joined THEN 1 ELSE 0 END)
          WHEN dr.StageName = 'Signed'
          THEN (CASE WHEN RAND() < dr.adjusted_current_rate THEN 1 ELSE 0 END)
          ELSE 0
        END AS joined_in_trial,
        CASE
          WHEN dr.Earliest_Anticipated_Start_Date__c IS NOT NULL
          THEN dr.Earliest_Anticipated_Start_Date__c
          ELSE DATE_ADD(CURRENT_DATE(), INTERVAL CAST(GREATEST(0,
            CASE
              WHEN dr.StageName IN ('Discovery', 'Qualifying')
              THEN @days_sp + @days_neg + @days_signed
              WHEN dr.StageName = 'Sales Process'
              THEN @days_neg + @days_signed
              WHEN dr.StageName = 'Negotiating'
              THEN @days_signed
              WHEN dr.StageName = 'Signed' THEN 0
              ELSE 0
            END
            - dr.days_in_current_stage
          ) AS INT64) DAY)
        END AS projected_join_date
      FROM deal_rates dr
      CROSS JOIN trials t
    )`;
}

export async function runMonteCarlo(
  tieredRates: TieredForecastRates,
  avgDays: {
    in_sp: number;
    in_neg: number;
    in_signed: number;
  }
): Promise<MonteCarloResponse> {
  const cte = simulationCTE();

  // Apply tier fallback: if a tier's cohort is too small, use flat rates
  const lower = tieredRates.lower.cohort_count >= TIER_FALLBACK_MIN_COHORT
    ? tieredRates.lower
    : tieredRates.flat;
  const upper = tieredRates.upper.cohort_count >= TIER_FALLBACK_MIN_COHORT
    ? tieredRates.upper
    : tieredRates.flat;

  // Aggregate query — P10/P50/P90 totals per dynamic quarter
  const aggregateQuery = `
    WITH ${cte},
    sim_with_quarter AS (
      SELECT
        trial_id,
        joined_in_trial,
        is_zero_aum,
        Opportunity_AUM,
        CONCAT('Q', CAST(EXTRACT(QUARTER FROM projected_join_date) AS STRING),
               ' ', CAST(EXTRACT(YEAR FROM projected_join_date) AS STRING)) AS quarter_label
      FROM simulation
      WHERE projected_join_date IS NOT NULL
    ),
    trial_quarter_aum AS (
      SELECT
        trial_id,
        quarter_label,
        SUM(CASE WHEN joined_in_trial = 1 AND is_zero_aum = 0
            THEN Opportunity_AUM ELSE 0 END) AS aum
      FROM sim_with_quarter
      GROUP BY trial_id, quarter_label
    )
    SELECT
      quarter_label,
      APPROX_QUANTILES(aum, 100)[OFFSET(10)] AS p10,
      APPROX_QUANTILES(aum, 100)[OFFSET(50)] AS p50,
      APPROX_QUANTILES(aum, 100)[OFFSET(90)] AS p90,
      AVG(aum) AS mean
    FROM trial_quarter_aum
    GROUP BY quarter_label
    ORDER BY quarter_label
  `;

  // Per-opp query — win frequency per deal per dynamic quarter
  const perOppQuery = `
    WITH ${cte},
    sim_with_quarter AS (
      SELECT
        opp_id,
        joined_in_trial,
        is_zero_aum,
        Opportunity_AUM,
        duration_bucket,
        duration_multiplier,
        aum_tier_2,
        CONCAT('Q', CAST(EXTRACT(QUARTER FROM projected_join_date) AS STRING),
               ' ', CAST(EXTRACT(YEAR FROM projected_join_date) AS STRING)) AS quarter_label
      FROM simulation
      WHERE projected_join_date IS NOT NULL
    )
    SELECT
      opp_id,
      quarter_label,
      SAFE_DIVIDE(
        COUNTIF(joined_in_trial = 1 AND is_zero_aum = 0),
        ${TRIAL_COUNT}
      ) AS win_pct,
      AVG(CASE WHEN joined_in_trial = 1 AND is_zero_aum = 0
          THEN Opportunity_AUM END) AS avg_aum,
      ANY_VALUE(duration_bucket) AS duration_bucket,
      ANY_VALUE(duration_multiplier) AS duration_multiplier,
      ANY_VALUE(aum_tier_2) AS aum_tier_2
    FROM sim_with_quarter
    GROUP BY opp_id, quarter_label
    HAVING win_pct > 0
  `;

  const params = {
    rate_lower_sqo_sp: lower.sqo_to_sp,
    rate_lower_sp_neg: lower.sp_to_neg,
    rate_lower_neg_signed: lower.neg_to_signed,
    rate_lower_signed_joined: lower.signed_to_joined,
    rate_upper_sqo_sp: upper.sqo_to_sp,
    rate_upper_sp_neg: upper.sp_to_neg,
    rate_upper_neg_signed: upper.neg_to_signed,
    rate_upper_signed_joined: upper.signed_to_joined,
    days_sp: avgDays.in_sp,
    days_neg: avgDays.in_neg,
    days_signed: avgDays.in_signed,
  };

  const [aggResults, oppResults] = await Promise.all([
    runQuery<any>(aggregateQuery, params),
    runQuery<any>(perOppQuery, params),
  ]);

  const quarters: MonteCarloQuarterResult[] = aggResults.map((r: any) => ({
    label: toString(r.quarter_label),
    p10: toNumber(r.p10) || 0,
    p50: toNumber(r.p50) || 0,
    p90: toNumber(r.p90) || 0,
    mean: toNumber(r.mean) || 0,
  }));

  // Sort quarters chronologically
  quarters.sort((a, b) => {
    const [aq, ay] = a.label.replace('Q', '').split(' ').map(Number);
    const [bq, by] = b.label.replace('Q', '').split(' ').map(Number);
    return ay !== by ? ay - by : aq - bq;
  });

  const perOpp: MonteCarloPerOpp[] = oppResults.map((row: any) => ({
    oppId: toString(row.opp_id),
    quarterLabel: toString(row.quarter_label),
    winPct: toNumber(row.win_pct) || 0,
    avgAum: toNumber(row.avg_aum) || 0,
    durationBucket: toString(row.duration_bucket) || undefined,
    durationMultiplier: toNumber(row.duration_multiplier) || undefined,
    aumTier2: toString(row.aum_tier_2) || undefined,
  }));

  return {
    quarters,
    perOpp,
    trialCount: TRIAL_COUNT,
    ratesUsed: {
      sqo_to_sp: tieredRates.flat.sqo_to_sp,
      sp_to_neg: tieredRates.flat.sp_to_neg,
      neg_to_signed: tieredRates.flat.neg_to_signed,
      signed_to_joined: tieredRates.flat.signed_to_joined,
    },
  };
}
