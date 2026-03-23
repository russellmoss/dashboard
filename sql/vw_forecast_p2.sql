-- vw_forecast_p2 — created 2026-03-23, updated 2026-03-23
-- Deterministic expected-value pipeline forecast
-- Sources from vw_funnel_master
-- Cohorts for rate estimation: Jun 2025 - Dec 2025 (ALL SQOs, not just closed)
-- DYNAMIC QUARTERS: projected_quarter + expected_aum_weighted replace hardcoded Q2/Q3

CREATE OR REPLACE VIEW `savvy-gtm-analytics.Tableau_Views.vw_forecast_p2` AS

WITH historical_rates AS (
  -- ALL SQOs from Jun-Dec 2025 (including still-open ones)
  -- CRITICAL: Do NOT filter on Conversion_Status here
  SELECT
    SAFE_DIVIDE(COUNTIF(eff_sp_ts IS NOT NULL), COUNT(*)) AS rate_sqo_to_sp,
    SAFE_DIVIDE(COUNTIF(eff_neg_ts IS NOT NULL), COUNTIF(eff_sp_ts IS NOT NULL)) AS rate_sp_to_neg,
    SAFE_DIVIDE(COUNTIF(eff_signed_ts IS NOT NULL), COUNTIF(eff_neg_ts IS NOT NULL)) AS rate_neg_to_signed,
    SAFE_DIVIDE(
      COUNTIF(eff_joined_ts IS NOT NULL AND StageName != 'Closed Lost'),
      COUNTIF(eff_signed_ts IS NOT NULL)
    ) AS rate_signed_to_joined,
    -- Volume-weighted avg days: SUM(total_days) / SUM(opp_count)
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
    ) AS avg_days_in_signed
  FROM (
    SELECT
      StageName,
      COALESCE(Stage_Entered_Sales_Process__c, Stage_Entered_Negotiating__c, Stage_Entered_Signed__c, Stage_Entered_Joined__c) AS eff_sp_ts,
      COALESCE(Stage_Entered_Negotiating__c, Stage_Entered_Signed__c, Stage_Entered_Joined__c) AS eff_neg_ts,
      COALESCE(Stage_Entered_Signed__c, Stage_Entered_Joined__c) AS eff_signed_ts,
      COALESCE(Stage_Entered_Joined__c, TIMESTAMP(advisor_join_date__c)) AS eff_joined_ts
    FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
    WHERE Full_Opportunity_ID__c IS NOT NULL
      AND is_primary_opp_record = 1
      AND SQO_raw = 'Yes'
      AND DATE(Opp_CreatedDate) BETWEEN '2025-06-01' AND '2025-12-31'
      AND StageName != 'On Hold'
  )
),

open_pipeline AS (
  SELECT
    Full_Opportunity_ID__c,
    advisor_name,
    CONCAT('https://savvywealth.lightning.force.com/lightning/r/Opportunity/', Full_Opportunity_ID__c, '/view') AS salesforce_url,
    SGM_Owner_Name__c,
    SGA_Owner_Name__c,
    StageName,
    COALESCE(Underwritten_AUM__c, Amount) AS Opportunity_AUM,
    ROUND(COALESCE(Underwritten_AUM__c, Amount) / 1000000, 2) AS Opportunity_AUM_M,
    CASE
      WHEN COALESCE(Underwritten_AUM__c, Amount) < 25000000 THEN 'Tier 1 (< $25M)'
      WHEN COALESCE(Underwritten_AUM__c, Amount) < 75000000 THEN 'Tier 2 ($25M-$75M)'
      WHEN COALESCE(Underwritten_AUM__c, Amount) < 150000000 THEN 'Tier 3 ($75M-$150M)'
      ELSE 'Tier 4 (> $150M)'
    END AS aum_tier,
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
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
  WHERE SQO_raw = 'Yes'
    AND StageName NOT IN ('On Hold', 'Closed Lost', 'Joined')
    AND Full_Opportunity_ID__c IS NOT NULL
    AND is_sqo_unique = 1
    AND recordtypeid = '012Dn000000mrO3IAI'
),

forecast_results AS (
  SELECT
    CURRENT_DATE() AS run_date,
    o.Full_Opportunity_ID__c,
    o.advisor_name,
    o.salesforce_url,
    o.SGM_Owner_Name__c,
    o.SGA_Owner_Name__c,
    o.StageName,
    CASE
      WHEN o.current_stage_entry_ts IS NOT NULL
      THEN DATE_DIFF(CURRENT_DATE(), DATE(o.current_stage_entry_ts), DAY)
      ELSE 0
    END AS days_in_current_stage,
    o.Opportunity_AUM,
    o.Opportunity_AUM_M,
    o.aum_tier,
    o.is_zero_aum,

    -- p_join: product of remaining stage conversion rates
    CASE
      WHEN o.StageName IN ('Discovery', 'Qualifying')
      THEN r.rate_sqo_to_sp * r.rate_sp_to_neg * r.rate_neg_to_signed * r.rate_signed_to_joined
      WHEN o.StageName = 'Sales Process'
      THEN r.rate_sp_to_neg * r.rate_neg_to_signed * r.rate_signed_to_joined
      WHEN o.StageName = 'Negotiating'
      THEN r.rate_neg_to_signed * r.rate_signed_to_joined
      WHEN o.StageName = 'Signed'
      THEN r.rate_signed_to_joined
      ELSE 0
    END AS p_join,

    -- expected_days_remaining (floor at 0)
    GREATEST(0, CAST(
      CASE
        WHEN o.StageName IN ('Discovery', 'Qualifying')
        THEN r.avg_days_in_sp + r.avg_days_in_neg + r.avg_days_in_signed
        WHEN o.StageName = 'Sales Process'
        THEN r.avg_days_in_neg + r.avg_days_in_signed
        WHEN o.StageName = 'Negotiating'
        THEN r.avg_days_in_signed
        WHEN o.StageName = 'Signed'
        THEN 0
        ELSE 0
      END
      - CASE
          WHEN o.current_stage_entry_ts IS NOT NULL
          THEN DATE_DIFF(CURRENT_DATE(), DATE(o.current_stage_entry_ts), DAY)
          ELSE 0
        END
    AS INT64)) AS expected_days_remaining,

    -- model_projected_join_date
    DATE_ADD(CURRENT_DATE(), INTERVAL CAST(GREATEST(0,
      CASE
        WHEN o.StageName IN ('Discovery', 'Qualifying')
        THEN r.avg_days_in_sp + r.avg_days_in_neg + r.avg_days_in_signed
        WHEN o.StageName = 'Sales Process'
        THEN r.avg_days_in_neg + r.avg_days_in_signed
        WHEN o.StageName = 'Negotiating'
        THEN r.avg_days_in_signed
        WHEN o.StageName = 'Signed'
        THEN 0
        ELSE 0
      END
      - CASE
          WHEN o.current_stage_entry_ts IS NOT NULL
          THEN DATE_DIFF(CURRENT_DATE(), DATE(o.current_stage_entry_ts), DAY)
          ELSE 0
        END
    ) AS INT64) DAY) AS model_projected_join_date,

    o.Earliest_Anticipated_Start_Date__c,

    -- final_projected_join_date: anticipated date overrides model
    CASE
      WHEN o.Earliest_Anticipated_Start_Date__c IS NOT NULL
      THEN o.Earliest_Anticipated_Start_Date__c
      ELSE DATE_ADD(CURRENT_DATE(), INTERVAL CAST(GREATEST(0,
        CASE
          WHEN o.StageName IN ('Discovery', 'Qualifying')
          THEN r.avg_days_in_sp + r.avg_days_in_neg + r.avg_days_in_signed
          WHEN o.StageName = 'Sales Process'
          THEN r.avg_days_in_neg + r.avg_days_in_signed
          WHEN o.StageName = 'Negotiating'
          THEN r.avg_days_in_signed
          WHEN o.StageName = 'Signed'
          THEN 0
          ELSE 0
        END
        - CASE
            WHEN o.current_stage_entry_ts IS NOT NULL
            THEN DATE_DIFF(CURRENT_DATE(), DATE(o.current_stage_entry_ts), DAY)
            ELSE 0
          END
      ) AS INT64) DAY)
    END AS final_projected_join_date,

    CASE
      WHEN o.Earliest_Anticipated_Start_Date__c IS NOT NULL THEN 'Anticipated'
      ELSE 'Model'
    END AS date_source,

    -- Rate columns: NULL out rates that don't apply to this opp's remaining stages
    CASE WHEN o.StageName IN ('Discovery','Qualifying')
         THEN r.rate_sqo_to_sp ELSE NULL END AS rate_sqo_to_sp,

    CASE WHEN o.StageName IN ('Discovery','Qualifying','Sales Process')
         THEN r.rate_sp_to_neg ELSE NULL END AS rate_sp_to_neg,

    CASE WHEN o.StageName IN ('Discovery','Qualifying','Sales Process','Negotiating')
         THEN r.rate_neg_to_signed ELSE NULL END AS rate_neg_to_signed,

    r.rate_signed_to_joined AS rate_signed_to_joined,

    -- stages_remaining
    (
      CASE WHEN o.StageName IN ('Discovery','Qualifying') THEN 1 ELSE 0 END +
      CASE WHEN o.StageName IN ('Discovery','Qualifying','Sales Process') THEN 1 ELSE 0 END +
      CASE WHEN o.StageName IN ('Discovery','Qualifying','Sales Process','Negotiating') THEN 1 ELSE 0 END +
      1
    ) AS stages_remaining

  FROM open_pipeline o
  CROSS JOIN historical_rates r
)

SELECT
  f.*,

  -- Dynamic quarter label from projected join date
  CASE
    WHEN f.final_projected_join_date IS NOT NULL
    THEN CONCAT('Q', CAST(EXTRACT(QUARTER FROM f.final_projected_join_date) AS STRING),
                ' ', CAST(EXTRACT(YEAR FROM f.final_projected_join_date) AS STRING))
    ELSE NULL
  END AS projected_quarter,

  -- Probability-weighted expected AUM (quarter-agnostic)
  CASE
    WHEN f.is_zero_aum = 0 AND f.final_projected_join_date IS NOT NULL
    THEN f.Opportunity_AUM * f.p_join
    ELSE 0
  END AS expected_aum_weighted

FROM forecast_results f
ORDER BY
  CASE
    WHEN f.is_zero_aum = 0 AND f.final_projected_join_date IS NOT NULL
    THEN f.Opportunity_AUM * f.p_join
    ELSE 0
  END DESC
