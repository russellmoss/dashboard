CREATE OR REPLACE VIEW `savvy-gtm-analytics.Tableau_Views.vw_channel_funnel_volume_by_month` AS
WITH
-- ═══════════════════════════════════════════════════════════════════
-- STEP 1: Base table with deterministic 1:1 Finance_View mapping
-- Original_source overrides FIRST, then Finance_View__c fallback
-- ═══════════════════════════════════════════════════════════════════
FunnelBase AS (
  SELECT
    primary_key,
    Full_prospect_id__c,
    Full_Opportunity_ID__c,
    Original_source,
    Finance_View__c,
    Channel_Grouping_Name,
    -- Deterministic 1:1 mapping: each Original_source resolves to exactly one Finance_View
    CASE
      -- Override multi-mapped sources to their majority Finance_View
      WHEN Original_source = 'LinkedIn (Self Sourced)' THEN 'Outbound'
      WHEN Original_source = 'Fintrx (Self-Sourced)' THEN 'Outbound'
      WHEN Original_source = 'Direct Traffic' THEN 'Marketing'
      WHEN Original_source = 'Re-Engagement' THEN 'Re-Engagement'
      WHEN Original_source = 'Recruitment Firm' THEN 'Partnerships'
      -- Standard Finance_View__c mapping for all other sources
      WHEN IFNULL(Finance_View__c, 'Other') IN ('Marketing', 'Job Applications') THEN 'Marketing'
      WHEN IFNULL(Finance_View__c, 'Other') = 'Outbound' THEN 'Outbound'
      WHEN IFNULL(Finance_View__c, 'Other') = 'Outbound + Marketing' THEN 'Outbound + Marketing'
      WHEN IFNULL(Finance_View__c, 'Other') IN ('Recruitment Firm', 'Employee Referral', 'Partnerships') THEN 'Partnerships'
      WHEN IFNULL(Finance_View__c, 'Other') = 'Advisor Referral' THEN 'Advisor Referrals'
      WHEN IFNULL(Finance_View__c, 'Other') = 'Re-Engagement' THEN 'Re-Engagement'
      ELSE 'Other'
    END AS Finance_View,
    -- Dates for stage-specific cohort attribution
    FilterDate,
    stage_entered_contacting__c,
    mql_stage_entered_ts,
    converted_date_raw,
    Date_Became_SQO__c,
    advisor_join_date__c,
    -- Stage flags
    is_contacted,
    is_mql,
    is_sql,
    is_sqo_unique,
    is_joined_unique
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
),

-- ═══════════════════════════════════════════════════════════════════
-- STEP 2: Monthly volumes per stage (event-based cohort attribution)
-- Each stage is cohorted on ITS OWN entry timestamp
-- ═══════════════════════════════════════════════════════════════════

ProspectsMonthly AS (
  SELECT
    DATE_TRUNC(DATE(FilterDate), MONTH) AS cohort_month,
    Finance_View,
    Original_source,
    COUNT(DISTINCT primary_key) AS prospects_created
  FROM FunnelBase
  WHERE FilterDate IS NOT NULL
    AND DATE(FilterDate) >= DATE_SUB(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL 24 MONTH)
  GROUP BY 1, 2, 3
),

ContactedMonthly AS (
  SELECT
    DATE_TRUNC(DATE(stage_entered_contacting__c), MONTH) AS cohort_month,
    Finance_View,
    Original_source,
    SUM(is_contacted) AS contacted_count
  FROM FunnelBase
  WHERE is_contacted = 1
    AND DATE(stage_entered_contacting__c) >= DATE_SUB(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL 24 MONTH)
  GROUP BY 1, 2, 3
),

MQLMonthly AS (
  SELECT
    DATE_TRUNC(DATE(mql_stage_entered_ts), MONTH) AS cohort_month,
    Finance_View,
    Original_source,
    SUM(is_mql) AS mql_count
  FROM FunnelBase
  WHERE is_mql = 1
    AND DATE(mql_stage_entered_ts) >= DATE_SUB(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL 24 MONTH)
  GROUP BY 1, 2, 3
),

SQLMonthly AS (
  SELECT
    DATE_TRUNC(DATE(converted_date_raw), MONTH) AS cohort_month,
    Finance_View,
    Original_source,
    SUM(is_sql) AS sql_count
  FROM FunnelBase
  WHERE is_sql = 1
    AND DATE(converted_date_raw) >= DATE_SUB(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL 24 MONTH)
  GROUP BY 1, 2, 3
),

SQOMonthly AS (
  SELECT
    DATE_TRUNC(DATE(Date_Became_SQO__c), MONTH) AS cohort_month,
    Finance_View,
    Original_source,
    -- Deduplicated: only count primary opp row
    SUM(is_sqo_unique) AS sqo_count
  FROM FunnelBase
  WHERE is_sqo_unique = 1
    AND DATE(Date_Became_SQO__c) >= DATE_SUB(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL 24 MONTH)
  GROUP BY 1, 2, 3
),

JoinedMonthly AS (
  SELECT
    DATE_TRUNC(DATE(advisor_join_date__c), MONTH) AS cohort_month,
    Finance_View,
    Original_source,
    -- Deduplicated: only count primary opp row
    SUM(is_joined_unique) AS joined_count
  FROM FunnelBase
  WHERE is_joined_unique = 1
    AND DATE(advisor_join_date__c) >= DATE_SUB(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL 24 MONTH)
  GROUP BY 1, 2, 3
),

-- ═══════════════════════════════════════════════════════════════════
-- STEP 3: All unique (Finance_View x Original_source x month) combos
-- ═══════════════════════════════════════════════════════════════════

AllMonthCombos AS (
  SELECT DISTINCT cohort_month, Finance_View, Original_source FROM ProspectsMonthly
  UNION DISTINCT
  SELECT DISTINCT cohort_month, Finance_View, Original_source FROM ContactedMonthly
  UNION DISTINCT
  SELECT DISTINCT cohort_month, Finance_View, Original_source FROM MQLMonthly
  UNION DISTINCT
  SELECT DISTINCT cohort_month, Finance_View, Original_source FROM SQLMonthly
  UNION DISTINCT
  SELECT DISTINCT cohort_month, Finance_View, Original_source FROM SQOMonthly
  UNION DISTINCT
  SELECT DISTINCT cohort_month, Finance_View, Original_source FROM JoinedMonthly
),

-- ═══════════════════════════════════════════════════════════════════
-- STEP 4: Combine monthly volumes (left join each stage)
-- ═══════════════════════════════════════════════════════════════════

MonthlyVolumes AS (
  SELECT
    ac.cohort_month,
    ac.Finance_View,
    ac.Original_source,
    IFNULL(p.prospects_created, 0) AS prospects_created,
    IFNULL(c.contacted_count, 0) AS contacted_count,
    IFNULL(m.mql_count, 0) AS mql_count,
    IFNULL(s.sql_count, 0) AS sql_count,
    IFNULL(sq.sqo_count, 0) AS sqo_count,
    IFNULL(j.joined_count, 0) AS joined_count
  FROM AllMonthCombos ac
  LEFT JOIN ProspectsMonthly p
    ON ac.cohort_month = p.cohort_month AND ac.Finance_View = p.Finance_View AND ac.Original_source = p.Original_source
  LEFT JOIN ContactedMonthly c
    ON ac.cohort_month = c.cohort_month AND ac.Finance_View = c.Finance_View AND ac.Original_source = c.Original_source
  LEFT JOIN MQLMonthly m
    ON ac.cohort_month = m.cohort_month AND ac.Finance_View = m.Finance_View AND ac.Original_source = m.Original_source
  LEFT JOIN SQLMonthly s
    ON ac.cohort_month = s.cohort_month AND ac.Finance_View = s.Finance_View AND ac.Original_source = s.Original_source
  LEFT JOIN SQOMonthly sq
    ON ac.cohort_month = sq.cohort_month AND ac.Finance_View = sq.Finance_View AND ac.Original_source = sq.Original_source
  LEFT JOIN JoinedMonthly j
    ON ac.cohort_month = j.cohort_month AND ac.Finance_View = j.Finance_View AND ac.Original_source = j.Original_source
),

-- ═══════════════════════════════════════════════════════════════════
-- STEP 5: Quarterly aggregation (sum of monthly values)
-- ═══════════════════════════════════════════════════════════════════

QuarterlyVolumes AS (
  SELECT
    DATE_TRUNC(cohort_month, QUARTER) AS cohort_quarter,
    Finance_View,
    Original_source,
    SUM(prospects_created) AS prospects_created,
    SUM(contacted_count) AS contacted_count,
    SUM(mql_count) AS mql_count,
    SUM(sql_count) AS sql_count,
    SUM(sqo_count) AS sqo_count,
    SUM(joined_count) AS joined_count
  FROM MonthlyVolumes
  GROUP BY 1, 2, 3
),

-- ═══════════════════════════════════════════════════════════════════
-- STEP 6: Final output with all period types
-- Column order is CRITICAL for sheet SUMPRODUCT formulas
-- ═══════════════════════════════════════════════════════════════════

AllRows AS (
  -- MONTHLY rows
  SELECT
    CASE
      WHEN cohort_month = DATE_TRUNC(CURRENT_DATE(), MONTH) THEN 'MTD'
      ELSE 'MONTHLY'
    END AS period_type,
    cohort_month AS cohort_period,
    CASE
      WHEN cohort_month = DATE_TRUNC(CURRENT_DATE(), MONTH)
      THEN CONCAT(FORMAT_DATE('%Y-%m', cohort_month), ' MTD')
      ELSE FORMAT_DATE('%Y-%m', cohort_month)
    END AS period_label,
    EXTRACT(YEAR FROM cohort_month) AS cohort_year,
    EXTRACT(MONTH FROM cohort_month) AS cohort_month_num,
    EXTRACT(QUARTER FROM cohort_month) AS cohort_quarter_num,
    FORMAT_DATE('%b %Y', cohort_month) AS cohort_period_name,
    Finance_View,
    Original_source,
    prospects_created,
    contacted_count,
    mql_count,
    sql_count,
    sqo_count,
    joined_count
  FROM MonthlyVolumes

  UNION ALL

  -- QUARTERLY rows (completed quarters only)
  SELECT
    CASE
      WHEN cohort_quarter = DATE_TRUNC(CURRENT_DATE(), QUARTER) THEN 'QTD'
      ELSE 'QUARTERLY'
    END AS period_type,
    cohort_quarter AS cohort_period,
    CASE
      WHEN cohort_quarter = DATE_TRUNC(CURRENT_DATE(), QUARTER)
      THEN CONCAT(EXTRACT(YEAR FROM cohort_quarter), '-Q', EXTRACT(QUARTER FROM cohort_quarter), ' QTD')
      ELSE CONCAT(EXTRACT(YEAR FROM cohort_quarter), '-Q', EXTRACT(QUARTER FROM cohort_quarter))
    END AS period_label,
    EXTRACT(YEAR FROM cohort_quarter) AS cohort_year,
    CAST(NULL AS INT64) AS cohort_month_num,
    EXTRACT(QUARTER FROM cohort_quarter) AS cohort_quarter_num,
    CONCAT('Q', EXTRACT(QUARTER FROM cohort_quarter), ' ', EXTRACT(YEAR FROM cohort_quarter)) AS cohort_period_name,
    Finance_View,
    Original_source,
    prospects_created,
    contacted_count,
    mql_count,
    sql_count,
    sqo_count,
    joined_count
  FROM QuarterlyVolumes
)

-- ═══════════════════════════════════════════════════════════════════
-- FINAL SELECT — column order matches sheet column letters:
-- A=period_type, B=cohort_period, C=period_label, D=cohort_year,
-- E=cohort_month_num, F=cohort_quarter_num, G=cohort_period_name,
-- H=Channel_Grouping_Name, I=Original_source, J=Original_Source_Grouping,
-- K=Source_Channel_Mapping, L=Finance_View,
-- M=prospects_created, N=contacted_count, O=mql_count,
-- P=sql_count, Q=sqo_count, R=joined_count, S=last_updated
-- ═══════════════════════════════════════════════════════════════════

SELECT
  period_type,                                    -- col A
  cohort_period,                                  -- col B
  period_label,                                   -- col C
  cohort_year,                                    -- col D
  cohort_month_num,                               -- col E
  cohort_quarter_num,                             -- col F
  cohort_period_name,                             -- col G
  Finance_View AS Channel_Grouping_Name,          -- col H (not used in formulas; set = Finance_View)
  Original_source,                                -- col I (used in source-level formulas)
  Finance_View AS Original_Source_Grouping,       -- col J (not used in formulas; placeholder)
  Finance_View AS Source_Channel_Mapping,         -- col K (not used in formulas; placeholder)
  Finance_View,                                   -- col L (CRITICAL: matched by SUMPRODUCT)
  prospects_created,                              -- col M (value column for Prospects)
  contacted_count,                                -- col N (value column for Contacted)
  mql_count,                                      -- col O (value column for MQLs)
  sql_count,                                      -- col P (value column for SQLs)
  sqo_count,                                      -- col Q (value column for SQOs)
  joined_count,                                   -- col R (value column for Joined)
  CURRENT_TIMESTAMP() AS last_updated             -- col S (metadata)
FROM AllRows
WHERE cohort_period IS NOT NULL
ORDER BY period_type DESC, cohort_period DESC, Finance_View, Original_source