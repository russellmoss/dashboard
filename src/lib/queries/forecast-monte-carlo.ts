import { runQuery } from '../bigquery';
import { toNumber, toString } from '@/types/bigquery-raw';

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
    )`;
}

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
  const cte = simulationCTE();

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
          THEN Opportunity_AUM END) AS avg_aum
    FROM sim_with_quarter
    GROUP BY opp_id, quarter_label
    HAVING win_pct > 0
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
  }));

  return {
    quarters,
    perOpp,
    trialCount: TRIAL_COUNT,
    ratesUsed: rates,
  };
}
