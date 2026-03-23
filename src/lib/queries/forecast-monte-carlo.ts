import { runQuery } from '../bigquery';
import { toNumber } from '@/types/bigquery-raw';

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
  conversionWindowDays?: 90 | 180 | 365 | null;
}

export interface MonteCarloResponse {
  q2: { p10: number; p50: number; p90: number; mean: number };
  q3: { p10: number; p50: number; p90: number; mean: number };
  perOpp?: Array<{ oppId: string; pJoin: number; q2AumP50: number; q3AumP50: number }>;
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

export async function runMonteCarlo(
  rates: {
    sqo_to_sp: number;
    sp_to_neg: number;
    neg_to_signed: number;
    signed_to_joined: number;
  },
  avgDays: {
    in_sp: number;
    in_neg: number;
    in_signed: number;
  }
): Promise<MonteCarloResponse> {
  const query = `
    WITH open_pipeline AS (
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
        END AS current_stage_entry_ts
      FROM \`${FUNNEL_MASTER}\`
      WHERE SQO_raw = 'Yes'
        AND StageName NOT IN ('On Hold', 'Closed Lost', 'Joined')
        AND Full_Opportunity_ID__c IS NOT NULL
        AND is_sqo_unique = 1
        AND recordtypeid = '012Dn000000mrO3IAI'
    ),

    trials AS (
      SELECT trial_id
      FROM UNNEST(GENERATE_ARRAY(1, ${TRIAL_COUNT})) AS trial_id
    ),

    simulation AS (
      SELECT
        t.trial_id,
        o.opp_id,
        o.StageName,
        o.Opportunity_AUM,
        o.is_zero_aum,
        -- Bernoulli draw for each remaining stage
        CASE
          WHEN o.StageName IN ('Discovery', 'Qualifying')
          THEN (CASE WHEN RAND() < @rate_sqo_sp THEN 1 ELSE 0 END)
               * (CASE WHEN RAND() < @rate_sp_neg THEN 1 ELSE 0 END)
               * (CASE WHEN RAND() < @rate_neg_signed THEN 1 ELSE 0 END)
               * (CASE WHEN RAND() < @rate_signed_joined THEN 1 ELSE 0 END)
          WHEN o.StageName = 'Sales Process'
          THEN (CASE WHEN RAND() < @rate_sp_neg THEN 1 ELSE 0 END)
               * (CASE WHEN RAND() < @rate_neg_signed THEN 1 ELSE 0 END)
               * (CASE WHEN RAND() < @rate_signed_joined THEN 1 ELSE 0 END)
          WHEN o.StageName = 'Negotiating'
          THEN (CASE WHEN RAND() < @rate_neg_signed THEN 1 ELSE 0 END)
               * (CASE WHEN RAND() < @rate_signed_joined THEN 1 ELSE 0 END)
          WHEN o.StageName = 'Signed'
          THEN (CASE WHEN RAND() < @rate_signed_joined THEN 1 ELSE 0 END)
          ELSE 0
        END AS joined_in_trial,
        -- Expected days remaining for projected join date
        CASE
          WHEN o.Earliest_Anticipated_Start_Date__c IS NOT NULL
          THEN o.Earliest_Anticipated_Start_Date__c
          ELSE DATE_ADD(CURRENT_DATE(), INTERVAL CAST(GREATEST(0,
            CASE
              WHEN o.StageName IN ('Discovery', 'Qualifying')
              THEN @days_sp + @days_neg + @days_signed
              WHEN o.StageName = 'Sales Process'
              THEN @days_neg + @days_signed
              WHEN o.StageName = 'Negotiating'
              THEN @days_signed
              WHEN o.StageName = 'Signed' THEN 0
              ELSE 0
            END
            - CASE
                WHEN o.current_stage_entry_ts IS NOT NULL
                THEN DATE_DIFF(CURRENT_DATE(), DATE(o.current_stage_entry_ts), DAY)
                ELSE 0
              END
          ) AS INT64) DAY)
        END AS projected_join_date
      FROM open_pipeline o
      CROSS JOIN trials t
    ),

    trial_results AS (
      SELECT
        trial_id,
        SUM(CASE
          WHEN joined_in_trial = 1 AND is_zero_aum = 0
            AND projected_join_date BETWEEN '2026-04-01' AND '2026-06-30'
          THEN Opportunity_AUM ELSE 0
        END) AS q2_aum,
        SUM(CASE
          WHEN joined_in_trial = 1 AND is_zero_aum = 0
            AND projected_join_date BETWEEN '2026-07-01' AND '2026-09-30'
          THEN Opportunity_AUM ELSE 0
        END) AS q3_aum
      FROM simulation
      GROUP BY trial_id
    )

    SELECT
      APPROX_QUANTILES(q2_aum, 100)[OFFSET(10)] AS q2_p10,
      APPROX_QUANTILES(q2_aum, 100)[OFFSET(50)] AS q2_p50,
      APPROX_QUANTILES(q2_aum, 100)[OFFSET(90)] AS q2_p90,
      AVG(q2_aum) AS q2_mean,
      APPROX_QUANTILES(q3_aum, 100)[OFFSET(10)] AS q3_p10,
      APPROX_QUANTILES(q3_aum, 100)[OFFSET(50)] AS q3_p50,
      APPROX_QUANTILES(q3_aum, 100)[OFFSET(90)] AS q3_p90,
      AVG(q3_aum) AS q3_mean
    FROM trial_results
  `;

  const params = {
    rate_sqo_sp: rates.sqo_to_sp,
    rate_sp_neg: rates.sp_to_neg,
    rate_neg_signed: rates.neg_to_signed,
    rate_signed_joined: rates.signed_to_joined,
    days_sp: avgDays.in_sp,
    days_neg: avgDays.in_neg,
    days_signed: avgDays.in_signed,
  };

  const results = await runQuery<any>(query, params);
  const r = results[0];

  return {
    q2: {
      p10: toNumber(r.q2_p10) || 0,
      p50: toNumber(r.q2_p50) || 0,
      p90: toNumber(r.q2_p90) || 0,
      mean: toNumber(r.q2_mean) || 0,
    },
    q3: {
      p10: toNumber(r.q3_p10) || 0,
      p50: toNumber(r.q3_p50) || 0,
      p90: toNumber(r.q3_p90) || 0,
      mean: toNumber(r.q3_mean) || 0,
    },
    trialCount: TRIAL_COUNT,
    ratesUsed: rates,
  };
}
