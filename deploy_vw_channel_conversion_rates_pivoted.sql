CREATE OR REPLACE VIEW `savvy-gtm-analytics.Tableau_Views.vw_channel_conversion_rates_pivoted` AS
WITH
-- ═══════════════════════════════════════════════════════════════════
-- STEP 1: Base table with deterministic 1:1 Finance_View mapping
-- and cohorted conversion eligibility/progression flags
-- ═══════════════════════════════════════════════════════════════════
FunnelBase AS (
  SELECT
    primary_key,
    Full_prospect_id__c,
    Full_Opportunity_ID__c,
    Original_source,
    Finance_View__c,
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
    -- Dates
    FilterDate,
    stage_entered_contacting__c,
    mql_stage_entered_ts,
    converted_date_raw,
    Date_Became_SQO__c,
    advisor_join_date__c,
    -- Cohort months for each stage
    DATE_TRUNC(DATE(FilterDate), MONTH) AS prospect_month,
    DATE_TRUNC(DATE(stage_entered_contacting__c), MONTH) AS contacted_month,
    DATE_TRUNC(DATE(mql_stage_entered_ts), MONTH) AS mql_month,
    DATE_TRUNC(DATE(converted_date_raw), MONTH) AS sql_month,
    DATE_TRUNC(DATE(Date_Became_SQO__c), MONTH) AS sqo_month,
    DATE_TRUNC(DATE(advisor_join_date__c), MONTH) AS joined_month,
    -- Cohort quarters
    DATE_TRUNC(DATE(FilterDate), QUARTER) AS prospect_quarter,
    DATE_TRUNC(DATE(stage_entered_contacting__c), QUARTER) AS contacted_quarter,
    DATE_TRUNC(DATE(mql_stage_entered_ts), QUARTER) AS mql_quarter,
    DATE_TRUNC(DATE(converted_date_raw), QUARTER) AS sql_quarter,
    DATE_TRUNC(DATE(Date_Became_SQO__c), QUARTER) AS sqo_quarter,
    DATE_TRUNC(DATE(advisor_join_date__c), QUARTER) AS joined_quarter,
    -- Stage flags
    is_contacted,
    is_mql,
    is_sql,
    is_sqo_unique,
    is_joined_unique,
    SQO_raw,
    -- Cohorted conversion flags (from vw_funnel_master)
    contacted_to_mql_progression,
    mql_to_sql_progression,
    sql_to_sqo_progression,
    sqo_to_joined_progression,
    eligible_for_contacted_conversions_30d,
    eligible_for_mql_conversions,
    eligible_for_sql_conversions,
    eligible_for_sqo_conversions
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
),

-- ═══════════════════════════════════════════════════════════════════
-- STEP 2: MONTHLY cohorted conversion rate aggregations
-- Uses resolution-based eligibility flags as denominators
-- and progression flags as numerators
-- ═══════════════════════════════════════════════════════════════════

-- Created → Contacted (monthly): eventual contact rate, all-prospects denominator
CreatedToContacted_M AS (
  SELECT
    prospect_month AS cohort_month,
    Finance_View,
    Original_source,
    COUNTIF(is_contacted = 1) AS c2c_num,
    COUNT(DISTINCT primary_key) AS c2c_den
  FROM FunnelBase
  WHERE prospect_month IS NOT NULL
    AND prospect_month >= DATE_SUB(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL 24 MONTH)
  GROUP BY 1, 2, 3
),

-- Contacted → MQL (monthly): 30-day timeout denominator
ContactedToMQL_M AS (
  SELECT
    contacted_month AS cohort_month,
    Finance_View,
    Original_source,
    SUM(contacted_to_mql_progression) AS c2m_num,
    SUM(eligible_for_contacted_conversions_30d) AS c2m_den
  FROM FunnelBase
  WHERE is_contacted = 1
    AND contacted_month IS NOT NULL
    AND contacted_month >= DATE_SUB(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL 24 MONTH)
  GROUP BY 1, 2, 3
),

-- MQL → SQL (monthly): resolved-only denominator
MQLtoSQL_M AS (
  SELECT
    mql_month AS cohort_month,
    Finance_View,
    Original_source,
    SUM(mql_to_sql_progression) AS m2s_num,
    SUM(eligible_for_mql_conversions) AS m2s_den
  FROM FunnelBase
  WHERE is_mql = 1
    AND mql_month IS NOT NULL
    AND mql_month >= DATE_SUB(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL 24 MONTH)
  GROUP BY 1, 2, 3
),

-- SQL → SQO (monthly): resolved-only denominator
SQLtoSQO_M AS (
  SELECT
    sql_month AS cohort_month,
    Finance_View,
    Original_source,
    SUM(sql_to_sqo_progression) AS s2q_num,
    SUM(eligible_for_sql_conversions) AS s2q_den
  FROM FunnelBase
  WHERE is_sql = 1
    AND sql_month IS NOT NULL
    AND sql_month >= DATE_SUB(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL 24 MONTH)
  GROUP BY 1, 2, 3
),

-- SQO → Joined (monthly): resolved-only denominator
SQOtoJoined_M AS (
  SELECT
    sqo_month AS cohort_month,
    Finance_View,
    Original_source,
    SUM(sqo_to_joined_progression) AS q2j_num,
    SUM(eligible_for_sqo_conversions) AS q2j_den
  FROM FunnelBase
  WHERE is_sqo_unique = 1
    AND sqo_month IS NOT NULL
    AND sqo_month >= DATE_SUB(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL 24 MONTH)
  GROUP BY 1, 2, 3
),

-- ═══════════════════════════════════════════════════════════════════
-- STEP 3: QUARTERLY cohorted conversion rate aggregations
-- Same flag-based logic, grouped by quarter
-- ═══════════════════════════════════════════════════════════════════

CreatedToContacted_Q AS (
  SELECT
    prospect_quarter AS cohort_quarter,
    Finance_View,
    Original_source,
    COUNTIF(is_contacted = 1) AS c2c_num,
    COUNT(DISTINCT primary_key) AS c2c_den
  FROM FunnelBase
  WHERE prospect_quarter IS NOT NULL
    AND prospect_quarter >= DATE_SUB(DATE_TRUNC(CURRENT_DATE(), QUARTER), INTERVAL 8 QUARTER)
  GROUP BY 1, 2, 3
),

ContactedToMQL_Q AS (
  SELECT
    contacted_quarter AS cohort_quarter,
    Finance_View,
    Original_source,
    SUM(contacted_to_mql_progression) AS c2m_num,
    SUM(eligible_for_contacted_conversions_30d) AS c2m_den
  FROM FunnelBase
  WHERE is_contacted = 1
    AND contacted_quarter IS NOT NULL
    AND contacted_quarter >= DATE_SUB(DATE_TRUNC(CURRENT_DATE(), QUARTER), INTERVAL 8 QUARTER)
  GROUP BY 1, 2, 3
),

MQLtoSQL_Q AS (
  SELECT
    mql_quarter AS cohort_quarter,
    Finance_View,
    Original_source,
    SUM(mql_to_sql_progression) AS m2s_num,
    SUM(eligible_for_mql_conversions) AS m2s_den
  FROM FunnelBase
  WHERE is_mql = 1
    AND mql_quarter IS NOT NULL
    AND mql_quarter >= DATE_SUB(DATE_TRUNC(CURRENT_DATE(), QUARTER), INTERVAL 8 QUARTER)
  GROUP BY 1, 2, 3
),

SQLtoSQO_Q AS (
  SELECT
    sql_quarter AS cohort_quarter,
    Finance_View,
    Original_source,
    SUM(sql_to_sqo_progression) AS s2q_num,
    SUM(eligible_for_sql_conversions) AS s2q_den
  FROM FunnelBase
  WHERE is_sql = 1
    AND sql_quarter IS NOT NULL
    AND sql_quarter >= DATE_SUB(DATE_TRUNC(CURRENT_DATE(), QUARTER), INTERVAL 8 QUARTER)
  GROUP BY 1, 2, 3
),

SQOtoJoined_Q AS (
  SELECT
    sqo_quarter AS cohort_quarter,
    Finance_View,
    Original_source,
    SUM(sqo_to_joined_progression) AS q2j_num,
    SUM(eligible_for_sqo_conversions) AS q2j_den
  FROM FunnelBase
  WHERE is_sqo_unique = 1
    AND sqo_quarter IS NOT NULL
    AND sqo_quarter >= DATE_SUB(DATE_TRUNC(CURRENT_DATE(), QUARTER), INTERVAL 8 QUARTER)
  GROUP BY 1, 2, 3
),

-- ═══════════════════════════════════════════════════════════════════
-- STEP 4: All unique combinations (monthly + quarterly)
-- ═══════════════════════════════════════════════════════════════════

AllMonthlyCombos AS (
  SELECT DISTINCT cohort_month, Finance_View, Original_source FROM CreatedToContacted_M
  UNION DISTINCT
  SELECT DISTINCT cohort_month, Finance_View, Original_source FROM ContactedToMQL_M
  UNION DISTINCT
  SELECT DISTINCT cohort_month, Finance_View, Original_source FROM MQLtoSQL_M
  UNION DISTINCT
  SELECT DISTINCT cohort_month, Finance_View, Original_source FROM SQLtoSQO_M
  UNION DISTINCT
  SELECT DISTINCT cohort_month, Finance_View, Original_source FROM SQOtoJoined_M
),

AllQuarterlyCombos AS (
  SELECT DISTINCT cohort_quarter, Finance_View, Original_source FROM CreatedToContacted_Q
  UNION DISTINCT
  SELECT DISTINCT cohort_quarter, Finance_View, Original_source FROM ContactedToMQL_Q
  UNION DISTINCT
  SELECT DISTINCT cohort_quarter, Finance_View, Original_source FROM MQLtoSQL_Q
  UNION DISTINCT
  SELECT DISTINCT cohort_quarter, Finance_View, Original_source FROM SQLtoSQO_Q
  UNION DISTINCT
  SELECT DISTINCT cohort_quarter, Finance_View, Original_source FROM SQOtoJoined_Q
),

-- ═══════════════════════════════════════════════════════════════════
-- STEP 5: Assemble monthly rows
-- ═══════════════════════════════════════════════════════════════════

MonthlyRates AS (
  SELECT
    CASE
      WHEN ac.cohort_month = DATE_TRUNC(CURRENT_DATE(), MONTH) THEN 'MTD'
      ELSE 'MONTHLY'
    END AS period_type,
    ac.cohort_month AS cohort_period,
    CASE
      WHEN ac.cohort_month = DATE_TRUNC(CURRENT_DATE(), MONTH)
      THEN CONCAT(FORMAT_DATE('%Y-%m', ac.cohort_month), ' MTD')
      ELSE FORMAT_DATE('%Y-%m', ac.cohort_month)
    END AS period_label,
    EXTRACT(YEAR FROM ac.cohort_month) AS cohort_year,
    EXTRACT(MONTH FROM ac.cohort_month) AS cohort_month_num,
    EXTRACT(QUARTER FROM ac.cohort_month) AS cohort_quarter_num,
    ac.Finance_View,
    ac.Original_source,

    -- Contacted → MQL
    IFNULL(c2m.c2m_num, 0) AS contacted_to_mql_numerator,
    IFNULL(c2m.c2m_den, 0) AS contacted_to_mql_denominator,
    SAFE_DIVIDE(c2m.c2m_num, c2m.c2m_den) AS contacted_to_mql_rate,
    ROUND(SAFE_DIVIDE(c2m.c2m_num, c2m.c2m_den) * 100, 2) AS contacted_to_mql_pct,

    -- MQL → SQL
    IFNULL(m2s.m2s_num, 0) AS mql_to_sql_numerator,
    IFNULL(m2s.m2s_den, 0) AS mql_to_sql_denominator,
    SAFE_DIVIDE(m2s.m2s_num, m2s.m2s_den) AS mql_to_sql_rate,
    ROUND(SAFE_DIVIDE(m2s.m2s_num, m2s.m2s_den) * 100, 2) AS mql_to_sql_pct,

    -- SQL → SQO
    IFNULL(s2q.s2q_num, 0) AS sql_to_sqo_numerator,
    IFNULL(s2q.s2q_den, 0) AS sql_to_sqo_denominator,
    SAFE_DIVIDE(s2q.s2q_num, s2q.s2q_den) AS sql_to_sqo_rate,
    ROUND(SAFE_DIVIDE(s2q.s2q_num, s2q.s2q_den) * 100, 2) AS sql_to_sqo_pct,

    -- SQO → Joined
    IFNULL(q2j.q2j_num, 0) AS sqo_to_joined_numerator,
    IFNULL(q2j.q2j_den, 0) AS sqo_to_joined_denominator,
    SAFE_DIVIDE(q2j.q2j_num, q2j.q2j_den) AS sqo_to_joined_rate,
    ROUND(SAFE_DIVIDE(q2j.q2j_num, q2j.q2j_den) * 100, 2) AS sqo_to_joined_pct,

    -- Volume columns (denominators repeated for convenience)
    IFNULL(c2m.c2m_den, 0) AS contacted_volume,
    IFNULL(m2s.m2s_den, 0) AS mql_volume,
    IFNULL(s2q.s2q_den, 0) AS sql_volume,
    IFNULL(q2j.q2j_den, 0) AS sqo_volume,

    -- Created → Contacted
    IFNULL(c2c.c2c_num, 0) AS created_to_contacted_numerator,
    IFNULL(c2c.c2c_den, 0) AS created_to_contacted_denominator,
    SAFE_DIVIDE(c2c.c2c_num, c2c.c2c_den) AS created_to_contacted_rate,
    ROUND(SAFE_DIVIDE(c2c.c2c_num, c2c.c2c_den) * 100, 2) AS created_to_contacted_pct,
    IFNULL(c2c.c2c_den, 0) AS prospect_volume

  FROM AllMonthlyCombos ac
  LEFT JOIN ContactedToMQL_M c2m ON ac.cohort_month = c2m.cohort_month AND ac.Finance_View = c2m.Finance_View AND ac.Original_source = c2m.Original_source
  LEFT JOIN MQLtoSQL_M m2s ON ac.cohort_month = m2s.cohort_month AND ac.Finance_View = m2s.Finance_View AND ac.Original_source = m2s.Original_source
  LEFT JOIN SQLtoSQO_M s2q ON ac.cohort_month = s2q.cohort_month AND ac.Finance_View = s2q.Finance_View AND ac.Original_source = s2q.Original_source
  LEFT JOIN SQOtoJoined_M q2j ON ac.cohort_month = q2j.cohort_month AND ac.Finance_View = q2j.Finance_View AND ac.Original_source = q2j.Original_source
  LEFT JOIN CreatedToContacted_M c2c ON ac.cohort_month = c2c.cohort_month AND ac.Finance_View = c2c.Finance_View AND ac.Original_source = c2c.Original_source
),

-- ═══════════════════════════════════════════════════════════════════
-- STEP 6: Assemble quarterly rows
-- ═══════════════════════════════════════════════════════════════════

QuarterlyRates AS (
  SELECT
    CASE
      WHEN ac.cohort_quarter = DATE_TRUNC(CURRENT_DATE(), QUARTER) THEN 'QTD'
      ELSE 'QUARTERLY'
    END AS period_type,
    ac.cohort_quarter AS cohort_period,
    CASE
      WHEN ac.cohort_quarter = DATE_TRUNC(CURRENT_DATE(), QUARTER)
      THEN CONCAT(EXTRACT(YEAR FROM ac.cohort_quarter), '-Q', EXTRACT(QUARTER FROM ac.cohort_quarter), ' QTD')
      ELSE CONCAT(EXTRACT(YEAR FROM ac.cohort_quarter), '-Q', EXTRACT(QUARTER FROM ac.cohort_quarter))
    END AS period_label,
    EXTRACT(YEAR FROM ac.cohort_quarter) AS cohort_year,
    CAST(NULL AS INT64) AS cohort_month_num,
    EXTRACT(QUARTER FROM ac.cohort_quarter) AS cohort_quarter_num,
    ac.Finance_View,
    ac.Original_source,

    IFNULL(c2m.c2m_num, 0) AS contacted_to_mql_numerator,
    IFNULL(c2m.c2m_den, 0) AS contacted_to_mql_denominator,
    SAFE_DIVIDE(c2m.c2m_num, c2m.c2m_den) AS contacted_to_mql_rate,
    ROUND(SAFE_DIVIDE(c2m.c2m_num, c2m.c2m_den) * 100, 2) AS contacted_to_mql_pct,

    IFNULL(m2s.m2s_num, 0) AS mql_to_sql_numerator,
    IFNULL(m2s.m2s_den, 0) AS mql_to_sql_denominator,
    SAFE_DIVIDE(m2s.m2s_num, m2s.m2s_den) AS mql_to_sql_rate,
    ROUND(SAFE_DIVIDE(m2s.m2s_num, m2s.m2s_den) * 100, 2) AS mql_to_sql_pct,

    IFNULL(s2q.s2q_num, 0) AS sql_to_sqo_numerator,
    IFNULL(s2q.s2q_den, 0) AS sql_to_sqo_denominator,
    SAFE_DIVIDE(s2q.s2q_num, s2q.s2q_den) AS sql_to_sqo_rate,
    ROUND(SAFE_DIVIDE(s2q.s2q_num, s2q.s2q_den) * 100, 2) AS sql_to_sqo_pct,

    IFNULL(q2j.q2j_num, 0) AS sqo_to_joined_numerator,
    IFNULL(q2j.q2j_den, 0) AS sqo_to_joined_denominator,
    SAFE_DIVIDE(q2j.q2j_num, q2j.q2j_den) AS sqo_to_joined_rate,
    ROUND(SAFE_DIVIDE(q2j.q2j_num, q2j.q2j_den) * 100, 2) AS sqo_to_joined_pct,

    IFNULL(c2m.c2m_den, 0) AS contacted_volume,
    IFNULL(m2s.m2s_den, 0) AS mql_volume,
    IFNULL(s2q.s2q_den, 0) AS sql_volume,
    IFNULL(q2j.q2j_den, 0) AS sqo_volume,

    IFNULL(c2c.c2c_num, 0) AS created_to_contacted_numerator,
    IFNULL(c2c.c2c_den, 0) AS created_to_contacted_denominator,
    SAFE_DIVIDE(c2c.c2c_num, c2c.c2c_den) AS created_to_contacted_rate,
    ROUND(SAFE_DIVIDE(c2c.c2c_num, c2c.c2c_den) * 100, 2) AS created_to_contacted_pct,
    IFNULL(c2c.c2c_den, 0) AS prospect_volume

  FROM AllQuarterlyCombos ac
  LEFT JOIN ContactedToMQL_Q c2m ON ac.cohort_quarter = c2m.cohort_quarter AND ac.Finance_View = c2m.Finance_View AND ac.Original_source = c2m.Original_source
  LEFT JOIN MQLtoSQL_Q m2s ON ac.cohort_quarter = m2s.cohort_quarter AND ac.Finance_View = m2s.Finance_View AND ac.Original_source = m2s.Original_source
  LEFT JOIN SQLtoSQO_Q s2q ON ac.cohort_quarter = s2q.cohort_quarter AND ac.Finance_View = s2q.Finance_View AND ac.Original_source = s2q.Original_source
  LEFT JOIN SQOtoJoined_Q q2j ON ac.cohort_quarter = q2j.cohort_quarter AND ac.Finance_View = q2j.Finance_View AND ac.Original_source = q2j.Original_source
  LEFT JOIN CreatedToContacted_Q c2c ON ac.cohort_quarter = c2c.cohort_quarter AND ac.Finance_View = c2c.Finance_View AND ac.Original_source = c2c.Original_source
)

-- ═══════════════════════════════════════════════════════════════════
-- FINAL SELECT — column order matches sheet column letters:
-- A=period_type, B=cohort_period, C=period_label, D=cohort_year,
-- E=cohort_month_num, F=cohort_quarter_num,
-- G=Channel_Grouping_Name, H=Original_source, I=Orig_Source_Grouping,
-- J=Source_Channel_Mapping, K=Finance_View,
-- L=c2m_num, M=c2m_den, N=c2m_rate, O=c2m_pct,
-- P=m2s_num, Q=m2s_den, R=m2s_rate, S=m2s_pct,
-- T=s2q_num, U=s2q_den, V=s2q_rate, W=s2q_pct,
-- X=q2j_num, Y=q2j_den, Z=q2j_rate, AA=q2j_pct,
-- AB=contacted_vol, AC=mql_vol, AD=sql_vol, AE=sqo_vol,
-- AF=c2c_num, AG=c2c_den, AH=c2c_rate, AI=c2c_pct,
-- AJ=prospect_volume, AK=last_updated
-- ═══════════════════════════════════════════════════════════════════

SELECT
  period_type,                                    -- col A
  cohort_period,                                  -- col B
  period_label,                                   -- col C
  cohort_year,                                    -- col D
  cohort_month_num,                               -- col E
  cohort_quarter_num,                             -- col F
  Finance_View AS Channel_Grouping_Name,          -- col G
  Original_source,                                -- col H (CRITICAL: matched by SUMPRODUCT)
  Finance_View AS Original_Source_Grouping,       -- col I (placeholder)
  Finance_View AS Source_Channel_Mapping,         -- col J (placeholder)
  Finance_View,                                   -- col K
  contacted_to_mql_numerator,                     -- col L
  contacted_to_mql_denominator,                   -- col M
  contacted_to_mql_rate,                          -- col N (CRITICAL: rate value)
  contacted_to_mql_pct,                           -- col O
  mql_to_sql_numerator,                           -- col P
  mql_to_sql_denominator,                         -- col Q
  mql_to_sql_rate,                                -- col R (CRITICAL: rate value)
  mql_to_sql_pct,                                 -- col S
  sql_to_sqo_numerator,                           -- col T
  sql_to_sqo_denominator,                         -- col U
  sql_to_sqo_rate,                                -- col V (CRITICAL: rate value)
  sql_to_sqo_pct,                                 -- col W
  sqo_to_joined_numerator,                        -- col X
  sqo_to_joined_denominator,                      -- col Y
  sqo_to_joined_rate,                             -- col Z (rate value)
  sqo_to_joined_pct,                              -- col AA
  contacted_volume,                               -- col AB
  mql_volume,                                     -- col AC
  sql_volume,                                     -- col AD
  sqo_volume,                                     -- col AE
  created_to_contacted_numerator,                 -- col AF
  created_to_contacted_denominator,               -- col AG
  created_to_contacted_rate,                      -- col AH (CRITICAL: rate value)
  created_to_contacted_pct,                       -- col AI
  prospect_volume,                                -- col AJ
  CURRENT_TIMESTAMP() AS last_updated             -- col AK
FROM MonthlyRates

UNION ALL

SELECT
  period_type,
  cohort_period,
  period_label,
  cohort_year,
  cohort_month_num,
  cohort_quarter_num,
  Finance_View AS Channel_Grouping_Name,
  Original_source,
  Finance_View AS Original_Source_Grouping,
  Finance_View AS Source_Channel_Mapping,
  Finance_View,
  contacted_to_mql_numerator,
  contacted_to_mql_denominator,
  contacted_to_mql_rate,
  contacted_to_mql_pct,
  mql_to_sql_numerator,
  mql_to_sql_denominator,
  mql_to_sql_rate,
  mql_to_sql_pct,
  sql_to_sqo_numerator,
  sql_to_sqo_denominator,
  sql_to_sqo_rate,
  sql_to_sqo_pct,
  sqo_to_joined_numerator,
  sqo_to_joined_denominator,
  sqo_to_joined_rate,
  sqo_to_joined_pct,
  contacted_volume,
  mql_volume,
  sql_volume,
  sqo_volume,
  created_to_contacted_numerator,
  created_to_contacted_denominator,
  created_to_contacted_rate,
  created_to_contacted_pct,
  prospect_volume,
  CURRENT_TIMESTAMP() AS last_updated
FROM QuarterlyRates

ORDER BY period_type DESC, cohort_period DESC, Finance_View, Original_source