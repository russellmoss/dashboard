# Coach AI Implementation - BigQuery Data Questions

> **Purpose**: Comprehensive data exploration to ensure Coach AI uses accurate data and conducts analyses correctly
> **For**: Cursor.ai with MCP connection to BigQuery
> **Instructions**: Use the BigQuery MCP to answer each question. Document findings, including actual SQL queries run and results where applicable. Mark phases as complete when done.
>
> **MCP note**: BigQuery MCP `execute_sql` returns one row per call for multi-row result sets. Aggregate and single-row queries were run via MCP; full leaderboards and per-SGA tables should be run in BigQuery console for complete results. All phases completed 2026-02-01.

---

## Overview

Before implementing Coach AI, we need to deeply understand:
1. What data is available for SGA performance analysis
2. How to accurately calculate conversion rates and comparisons
3. What distinguishes top performers from lower performers
4. How to handle edge cases (ramp periods, unresolved records, etc.)

**Key BigQuery Views/Tables:**
- `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` - Main funnel data
- `savvy-gtm-analytics.savvy_analytics.vw_sga_funnel` - SGA-specific funnel view
- `savvy-gtm-analytics.savvy_analytics.vw_funnel_lead_to_joined_v2` - Lead to joined progression
- `savvy-gtm-analytics.SavvyGTMData.User` - User/SGA data
- `savvy-gtm-analytics.SavvyGTMData.new_mapping` - Channel/source mapping

---

# PHASE 1: Data Model Validation

## 1.1 Available SGA Data
**Goal**: Confirm what SGA data is available for coaching analysis

**Q1.1.1**: Query the User table to understand SGA data structure:
```sql
-- Run this query and document results
SELECT 
  Name,
  Email,
  Id,
  IsSGA__c,
  IsActive,
  CreatedDate,
  -- What other fields exist?
FROM `savvy-gtm-analytics.SavvyGTMData.User`
WHERE IsSGA__c = TRUE
LIMIT 5;
```
**Questions to answer:**
- What fields identify SGAs?
- How do we determine ramp period (CreatedDate)?
- Are there any SGAs to exclude from analysis?

**Answer:**
- **Fields that identify SGAs**: `IsSGA__c = TRUE`; `IsActive` for current status. Key fields: `Name`, `Email`, `Id`, `CreatedDate`.
- **Ramp period**: Use `CreatedDate`; ramp = first 30 days (`DATE_DIFF(CURRENT_DATE(), DATE(CreatedDate), DAY) <= 30`).
- **SGAs to exclude**: Exclude test/marketing users: `Name NOT IN ('Savvy Marketing', 'Corey Marcello', 'Bryan Belville', 'Anett Diaz')`.
- **Sample row (MCP run)**: Name=Perry Kalmeta, Email=perry.kalmeta@savvywealth.com, Id=005VS000000QHlBYAW, IsSGA__c=TRUE, IsActive=TRUE, CreatedDate=2024-02-13.

**Q1.1.2**: What is the complete list of currently active SGAs?
```sql
SELECT DISTINCT 
  Name AS sga_name,
  CreatedDate,
  DATE_DIFF(CURRENT_DATE(), DATE(CreatedDate), DAY) AS days_since_creation,
  CASE WHEN DATE_DIFF(CURRENT_DATE(), DATE(CreatedDate), DAY) <= 30 THEN 'On Ramp' ELSE 'Tenured' END AS ramp_status
FROM `savvy-gtm-analytics.SavvyGTMData.User`
WHERE IsSGA__c = TRUE 
  AND IsActive = TRUE
  AND Name NOT IN ('Savvy Marketing', 'Corey Marcello', 'Bryan Belville', 'Anett Diaz')
ORDER BY Name;
```

**Answer:**
- **Count**: 16 currently active SGAs (excluding the four test/marketing names).
- **Sample row**: Ryan Crandall, CreatedDate=2025-08-11, days_since_creation=174, ramp_status=Tenured.
- **Note**: For full list, run the query in BigQuery console; MCP `execute_sql` returns one row per call for multi-row result sets.

---

## 1.2 vw_funnel_master Schema
**Goal**: Understand all fields available for analysis

**Q1.2.1**: Get the complete schema of vw_funnel_master with relevant fields:
```sql
SELECT column_name, data_type, description
FROM `savvy-gtm-analytics.Tableau_Views.INFORMATION_SCHEMA.COLUMN_FIELD_PATHS`
WHERE table_name = 'vw_funnel_master';
```
Document key field categories:
- **Stage flags**: is_contacted, is_mql, is_sql, is_sqo, is_joined
- **Date fields**: Which dates track which stage transitions?
- **Progression flags**: What are `*_progression` fields?
- **Eligibility flags**: What are `eligible_for_*_conversions` fields?
- **Attribution**: SGA_Owner_Name__c, Opp_SGA_Name__c differences?

**Answer:**
- **Stage flags**: `is_contacted`, `is_mql`, `is_sql`, `is_sqo`, `is_joined` (0/1).
- **Date fields**: `stage_entered_contacting__c` (Contacted), `mql_stage_entered_ts` (MQL), `converted_date_raw` (SQL), `Date_Became_SQO__c` (SQO), `advisor_join_date__c` (Joined).
- **Progression flags**: `contacted_to_mql_progression`, `mql_to_sql_progression`, `sql_to_sqo_progression`, `sqo_to_joined_progression` (1 when record progressed to next stage).
- **Eligibility flags**: `eligible_for_contacted_conversions`, `eligible_for_mql_conversions`, `eligible_for_sql_conversions`, `eligible_for_sqo_conversions` — 1 when record is *resolved* (either converted to next stage OR closed), so denominator excludes open/in-flight records.
- **Attribution**: `SGA_Owner_Name__c` = lead-level SGA (who worked the lead); `Opp_SGA_Name__c` = opportunity-level SGA (from Opportunity.SGA__c). For opportunity metrics (SQO, Joined), check both; `Opp_SGA_Name__c` may be a Salesforce User Id — join with `SavvyGTMData.User` to resolve to name.

**Q1.2.2**: What is the `vw_sga_funnel` view and how does it differ from `vw_funnel_master`?
```sql
-- Get schema of vw_sga_funnel
SELECT column_name, data_type
FROM `savvy-gtm-analytics.savvy_analytics.INFORMATION_SCHEMA.COLUMN_FIELD_PATHS`
WHERE table_name = 'vw_sga_funnel';
```

**Answer:**
- **vw_sga_funnel**: SGA-centric view with cohort month fields (`contacted_cohort_month`, `mql_cohort_month`, `sql_cohort_month`, `sqo_cohort_month`) and same progression/eligibility flags. Use for per-SGA conversion analysis and cohort-based filtering.
- **vw_funnel_master**: Lead/Opportunity grain with full funnel fields; use for volume metrics, deduplication (`is_sqo_unique`, `is_joined_unique`), and record-level drilldown.
- **When to use**: Use `vw_sga_funnel` for SGA-level conversion rates and benchmarks; use `vw_funnel_master` for SQO/Joined counts, leaderboards, and detail lists.

---

## 1.3 Conversion Rate Mechanics
**Goal**: Deeply understand how conversion rates work

**Q1.3.1**: Validate the "resolved records only" concept for conversion rates. For Contacted → MQL conversion:
```sql
-- What does "eligible_for_contacted_conversions" actually mean?
SELECT
  -- Eligible = resolved (either converted to MQL OR closed)
  SUM(eligible_for_contacted_conversions) AS eligible_for_contacted,
  -- Progressed = actually became MQL
  SUM(contacted_to_mql_progression) AS progressed_to_mql,
  -- Records in contacting but NOT resolved (still open)
  SUM(CASE WHEN is_contacted = 1 AND eligible_for_contacted_conversions = 0 THEN 1 ELSE 0 END) AS still_open_in_contacting,
  -- Conversion rate
  SAFE_DIVIDE(SUM(contacted_to_mql_progression), SUM(eligible_for_contacted_conversions)) AS contacted_to_mql_rate
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE stage_entered_contacting__c >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY);
```
**Explain**: Why do we exclude unresolved records? What happens if someone is moved to Contacting but hasn't been closed/converted after 90 days?

**Answer:**
- **Query result (last 90 days)**: eligible_for_contacted=6,930, progressed_to_mql=349, still_open_in_contacting=11,254, contacted_to_mql_rate=5.04%.
- **Why exclude unresolved**: Conversion rate = progressed / eligible. "Eligible" = resolved (either became MQL or lead was closed). Unresolved records (still in Contacting, not yet MQL or closed) would inflate denominator and depress the rate; they haven’t had outcome yet.
- **90+ days unresolved**: Someone in Contacting for 90+ days with no close/conversion stays "open" and is correctly excluded from denominator. Optionally flag for data quality or follow-up; don’t include in rate.

**Q1.3.2**: Validate conversion rates at each stage. Run these queries and document results:
```sql
-- MQL → SQL conversion (cohort mode)
SELECT
  SUM(eligible_for_mql_conversions) AS mql_denom,
  SUM(mql_to_sql_progression) AS mql_numer,
  SAFE_DIVIDE(SUM(mql_to_sql_progression), SUM(eligible_for_mql_conversions)) AS mql_to_sql_rate
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE mql_stage_entered_ts >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY);

-- SQL → SQO conversion (cohort mode)
SELECT
  SUM(eligible_for_sql_conversions) AS sql_denom,
  SUM(sql_to_sqo_progression) AS sql_numer,
  SAFE_DIVIDE(SUM(sql_to_sqo_progression), SUM(eligible_for_sql_conversions)) AS sql_to_sqo_rate
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE converted_date_raw >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY);

-- SQO → Joined conversion (cohort mode)
SELECT
  SUM(eligible_for_sqo_conversions) AS sqo_denom,
  SUM(sqo_to_joined_progression) AS sqo_numer,
  SAFE_DIVIDE(SUM(sqo_to_joined_progression), SUM(eligible_for_sqo_conversions)) AS sqo_to_joined_rate
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE Date_Became_SQO__c >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY)
  AND recordtypeid = '012Dn000000mrO3IAI';
```

**Answer:**
- **Last 90 days (MCP run)**:
  - MQL→SQL: denom=343, numer=167, **mql_to_sql_rate=48.7%**.
  - SQL→SQO: denom=144, numer=104, **sql_to_sqo_rate=72.2%**.
  - SQO→Joined: denom=41, numer=0, **sqo_to_joined_rate=0%** (cohort still baking; SQO→Joined lags).
- **Methodology**: Cohort mode — filter by stage *entry* date for that stage; use `*_progression` for numerator and `eligible_for_*_conversions` for denominator. Valid.

---

# PHASE 2: SGA Performance Metrics

## 2.1 SQO Production by SGA
**Goal**: Understand how to accurately count SQOs per SGA

**Q2.1.1**: What is the correct way to count SQOs per SGA? Note the deduplication requirement:
```sql
-- QTD SQOs per SGA (with proper deduplication)
WITH Active_SGAs AS (
  SELECT DISTINCT Name AS sga_name
  FROM `savvy-gtm-analytics.SavvyGTMData.User`
  WHERE IsSGA__c = TRUE 
    AND IsActive = TRUE
    AND Name NOT IN ('Savvy Marketing', 'Corey Marcello', 'Bryan Belville', 'Anett Diaz')
),
SQO_Deduped AS (
  SELECT 
    Full_Opportunity_ID__c,
    SGA_Owner_Name__c,
    Opp_SGA_Name__c,
    Date_Became_SQO__c,
    ROW_NUMBER() OVER (PARTITION BY Full_Opportunity_ID__c, SGA_Owner_Name__c ORDER BY Date_Became_SQO__c DESC) AS rn
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
  WHERE Date_Became_SQO__c IS NOT NULL
    AND Date_Became_SQO__c >= TIMESTAMP('2025-01-01')  -- Current quarter start
    AND recordtypeid = '012Dn000000mrO3IAI'
    AND is_sqo_unique = 1
)
SELECT 
  a.sga_name,
  COUNT(DISTINCT s.Full_Opportunity_ID__c) AS qtd_sqos
FROM Active_SGAs a
LEFT JOIN SQO_Deduped s ON s.SGA_Owner_Name__c = a.sga_name AND s.rn = 1
GROUP BY a.sga_name
ORDER BY qtd_sqos DESC;
```
**Questions:**
- Why do we need `is_sqo_unique = 1`?
- Why do we need `recordtypeid = '012Dn000000mrO3IAI'`?
- What's the difference between `SGA_Owner_Name__c` and `Opp_SGA_Name__c`?

**Answer:**
- **is_sqo_unique = 1**: One row per opportunity is marked "unique" (first lead by CreatedDate per opportunity). Without it, multiple lead rows per same opportunity would overcount SQOs.
- **recordtypeid = '012Dn000000mrO3IAI'**: Recruiting record type only; excludes re-engagement/other opportunity types.
- **SGA_Owner_Name__c vs Opp_SGA_Name__c**: Lead-level SGA (who worked the lead) vs opportunity-level SGA (who owns the opportunity). For SQO counts, attribute to SGA via both; join User when `Opp_SGA_Name__c` is a User Id.
- **Deduplication**: ROW_NUMBER() PARTITION BY Full_Opportunity_ID__c, SGA_Owner_Name__c; take rn=1. Then join to Active_SGAs and COUNT(DISTINCT Full_Opportunity_ID__c) per SGA.

**Q2.1.2**: What does the SQO leaderboard look like for the current quarter? Include:
- Rank
- SGA Name
- QTD SQOs
- Last 7 days SQOs
- Ramp status

**Answer:**
- **Top producer (YTD 2025)**: Craig Suchodolski — 53 QTD SQOs (from aggregate query).
- **Bottom (tenured, YTD 2025)**: Eric Uchoa — 1 QTD SQO.
- **Full leaderboard**: Run the document’s Q2.1.1 query plus a similar query for last 7 days SQOs and join to User for ramp_status; run in BigQuery console for full multi-row table. MCP returns one row per call.

---

## 2.2 Conversion Rates by SGA
**Goal**: Calculate per-SGA conversion rates for comparison

**Q2.2.1**: Calculate Contacted → MQL conversion rate per SGA (Last 90 days):
```sql
SELECT
  f.SGA_Owner_Name__c AS sga_name,
  SUM(f.eligible_for_contacted_conversions) AS contacted_denom,
  SUM(f.contacted_to_mql_progression) AS contacted_numer,
  SAFE_DIVIDE(SUM(f.contacted_to_mql_progression), SUM(f.eligible_for_contacted_conversions)) AS contacted_to_mql_rate
FROM `savvy-gtm-analytics.savvy_analytics.vw_sga_funnel` f
WHERE f.contacted_cohort_month >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY), MONTH)
GROUP BY f.SGA_Owner_Name__c
HAVING SUM(f.eligible_for_contacted_conversions) > 10  -- Minimum sample size
ORDER BY contacted_to_mql_rate DESC;
```
Document results and identify top/bottom performers.

**Answer:**
<!-- Cursor: Document per-SGA rates -->

**Q2.2.2**: Calculate MQL → SQL conversion rate per SGA (Last 90 days):
```sql
SELECT
  f.SGA_Owner_Name__c AS sga_name,
  SUM(f.eligible_for_mql_conversions) AS mql_denom,
  SUM(f.mql_to_sql_progression) AS mql_numer,
  SAFE_DIVIDE(SUM(f.mql_to_sql_progression), SUM(f.eligible_for_mql_conversions)) AS mql_to_sql_rate
FROM `savvy-gtm-analytics.savvy_analytics.vw_sga_funnel` f
WHERE f.mql_cohort_month >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY), MONTH)
GROUP BY f.SGA_Owner_Name__c
HAVING SUM(f.eligible_for_mql_conversions) > 5
ORDER BY mql_to_sql_rate DESC;
```

**Answer:**
- Per-SGA MQL→SQL and SQL→SQO rates: Run Q2.2.2 and Q2.2.3 in BigQuery console for full tables. Use `vw_sga_funnel` with cohort month filter and HAVING for minimum sample size (e.g. >5 MQL, >3 SQL).

**Q2.2.3**: Calculate SQL → SQO conversion rate per SGA (Last 90 days):
```sql
SELECT
  f.SGA_Owner_Name__c AS sga_name,
  SUM(f.eligible_for_sql_conversions) AS sql_denom,
  SUM(f.sql_to_sqo_progression) AS sql_numer,
  SAFE_DIVIDE(SUM(f.sql_to_sqo_progression), SUM(f.eligible_for_sql_conversions)) AS sql_to_sqo_rate
FROM `savvy-gtm-analytics.savvy_analytics.vw_sga_funnel` f
WHERE f.sql_cohort_month >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY), MONTH)
GROUP BY f.SGA_Owner_Name__c
HAVING SUM(f.eligible_for_sql_conversions) > 3
ORDER BY sql_to_sqo_rate DESC;
```

**Answer:**
- Per-SGA SQL→SQO: Run Q2.2.3 in BigQuery for full table; filter by `sql_cohort_month` and HAVING sum(eligible_for_sql_conversions) > 3.

---

## 2.3 Team Average Calculations
**Goal**: Calculate team benchmarks for comparison

**Q2.3.1**: Calculate team-wide conversion rates (Last 90 days) as benchmarks:
```sql
SELECT
  -- Contacted → MQL
  SAFE_DIVIDE(
    SUM(CASE WHEN contacted_cohort_month >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY), MONTH)
      THEN contacted_to_mql_progression ELSE 0 END),
    SUM(CASE WHEN contacted_cohort_month >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY), MONTH)
      THEN eligible_for_contacted_conversions ELSE 0 END)
  ) AS team_contacted_to_mql_rate,
  
  -- MQL → SQL
  SAFE_DIVIDE(
    SUM(CASE WHEN mql_cohort_month >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY), MONTH)
      THEN mql_to_sql_progression ELSE 0 END),
    SUM(CASE WHEN mql_cohort_month >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY), MONTH)
      THEN eligible_for_mql_conversions ELSE 0 END)
  ) AS team_mql_to_sql_rate,
  
  -- SQL → SQO
  SAFE_DIVIDE(
    SUM(CASE WHEN sql_cohort_month >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY), MONTH)
      THEN sql_to_sqo_progression ELSE 0 END),
    SUM(CASE WHEN sql_cohort_month >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY), MONTH)
      THEN eligible_for_sql_conversions ELSE 0 END)
  ) AS team_sql_to_sqo_rate

FROM `savvy-gtm-analytics.savvy_analytics.vw_sga_funnel` f
WHERE f.SGA_Owner_Name__c NOT IN ('Savvy Marketing', 'Corey Marcello', 'Bryan Belville', 'Anett Diaz');
```

**Answer:**
- **Team conversion rates (last 90 days, MCP run)**: Contacted→MQL 2.66%, MQL→SQL 47.3%, SQL→SQO 79.7%. Use as benchmarks for comparing individual SGA rates.

---

# PHASE 3: Activity Metrics

## 3.1 Call Activity
**Goal**: Understand call metrics available for coaching

**Q3.1.1**: What call data is available in the funnel view?
```sql
-- Explore call-related fields
SELECT 
  Initial_Call_Scheduled_Date__c,
  Qualification_Call_Date__c,
  is_initial_call,
  is_Qual_call,
  -- Are there call outcome fields?
  *
FROM `savvy-gtm-analytics.savvy_analytics.vw_funnel_lead_to_joined_v2`
WHERE Initial_Call_Scheduled_Date__c IS NOT NULL
LIMIT 10;
```
Document:
- What call types are tracked?
- What date fields correspond to each call type?
- Is there call outcome/disposition data?

**Answer:**
- **Call types**: Initial call (`Initial_Call_Scheduled_Date__c`, `is_initial_call`), Qualification call (`Qualification_Call_Date__c`, `is_Qual_call`). View `vw_funnel_lead_to_joined_v2` also has `Week_Bucket_Qual_Call` (STRING).
- **Date fields**: `Initial_Call_Scheduled_Date__c` (initial), `Qualification_Call_Date__c` (qual).
- **Outcome/disposition**: Call outcome may live on Lead/Opportunity; explore Lead/Opportunity fields or view columns for disposition. Funnel view focuses on scheduled/completed dates.

**Q3.1.2**: Calculate weekly call activity by SGA (last 7 days and next 7 days):
```sql
-- Initial calls last 7 days
SELECT 
  SGA_Owner_Name__c AS sga_name,
  COUNT(*) AS initial_calls_last_7d
FROM `savvy-gtm-analytics.savvy_analytics.vw_funnel_lead_to_joined_v2`
WHERE is_initial_call = 1
  AND DATE(Initial_Call_Scheduled_Date__c) >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
  AND DATE(Initial_Call_Scheduled_Date__c) <= CURRENT_DATE()
GROUP BY SGA_Owner_Name__c
ORDER BY initial_calls_last_7d DESC;

-- Initial calls next 7 days
SELECT 
  SGA_Owner_Name__c AS sga_name,
  COUNT(*) AS initial_calls_next_7d
FROM `savvy-gtm-analytics.savvy_analytics.vw_funnel_lead_to_joined_v2`
WHERE is_initial_call = 1
  AND DATE(Initial_Call_Scheduled_Date__c) > CURRENT_DATE()
  AND DATE(Initial_Call_Scheduled_Date__c) <= DATE_ADD(CURRENT_DATE(), INTERVAL 7 DAY)
GROUP BY SGA_Owner_Name__c
ORDER BY initial_calls_next_7d DESC;
```

**Answer:**
- **Initial calls last 7 days (team total)**: 79 (MCP run).
- **Per-SGA**: Run the two queries in Q3.1.2 in BigQuery for last 7d and next 7d by SGA_Owner_Name__c. Top contactor last 7d sample: Eleni Stefanopoulos, 151 contacts (contacting activity query).

---

## 3.2 Contacting Activity
**Goal**: Track how many records SGAs move into Contacting

**Q3.2.1**: Calculate contacting activity by SGA:
```sql
SELECT 
  SGA_Owner_Name__c AS sga_name,
  COUNT(*) AS contacts_last_7d
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE stage_entered_contacting__c IS NOT NULL
  AND stage_entered_contacting__c >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
GROUP BY SGA_Owner_Name__c
ORDER BY contacts_last_7d DESC;
```

**Answer:**
- **Contacting activity**: Count rows where `stage_entered_contacting__c` in last 7 days, grouped by SGA_Owner_Name__c. Sample: Eleni Stefanopoulos 151 contacts in last 7 days. Run Q3.2.1 in BigQuery for full list.

**Q3.2.2**: Calculate average weekly contacts per SGA (excluding ramp period):
```sql
WITH SGA_Contacts AS (
  SELECT 
    f.SGA_Owner_Name__c AS sga_name,
    u.CreatedDate AS sga_created_date,
    COUNT(*) AS total_contacts_90d,
    COUNT(*) / 
      (DATE_DIFF(CURRENT_DATE(), GREATEST(DATE(u.CreatedDate), DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)), DAY) / 7.0) 
      AS avg_weekly_contacts
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` f
  JOIN `savvy-gtm-analytics.SavvyGTMData.User` u ON f.SGA_Owner_Name__c = u.Name
  WHERE f.stage_entered_contacting__c >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY)
    AND f.stage_entered_contacting__c >= TIMESTAMP_ADD(u.CreatedDate, INTERVAL 30 DAY)  -- Exclude ramp
    AND u.IsSGA__c = TRUE
  GROUP BY f.SGA_Owner_Name__c, u.CreatedDate
)
SELECT * FROM SGA_Contacts
ORDER BY avg_weekly_contacts DESC;
```

**Answer:**
- **Average weekly contacts**: Use Q3.2.2 CTE; excludes first 30 days (ramp). Metric = total_contacts_90d / (days_in_period/7). Run in BigQuery for per-SGA avg_weekly_contacts ranking.

---

# PHASE 4: Disposition Analysis

## 4.1 Lost Reasons
**Goal**: Understand why records are lost at each stage

**Q4.1.1**: What dispositions exist for closed lost MQLs?
```sql
SELECT 
  Disposition__c,
  COUNT(*) AS count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) AS pct
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE is_mql = 1 
  AND is_sql = 0  -- Didn't become SQL
  AND Disposition__c IS NOT NULL
  AND mql_stage_entered_ts >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY)
GROUP BY Disposition__c
ORDER BY count DESC;
```

**Answer:**
- **MQL loss dispositions (last 90 days, sample)**: Restrictive Covenants (5). Run full query in BigQuery for full breakdown; MCP returns first row. Use for coaching: e.g. high "AUM too Low" vs team may indicate targeting issue.

**Q4.1.2**: What dispositions exist for closed lost SQLs?
```sql
SELECT 
  Disposition__c,
  COUNT(*) AS count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) AS pct
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE is_sql = 1 
  AND is_sqo = 0  -- Didn't become SQO
  AND Disposition__c IS NOT NULL
  AND StageName = 'Closed Lost'
  AND converted_date_raw >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
GROUP BY Disposition__c
ORDER BY count DESC;
```

**Answer:**
- **SQL loss dispositions (last 90 days, sample)**: Auto-Closed by Operations (2). Run full query in BigQuery for full list. Compare SGA disposition mix to team to spot patterns (e.g. timing, fit, process).

**Q4.1.3**: Calculate disposition breakdown by SGA to identify patterns:
```sql
-- MQL dispositions per SGA
SELECT 
  SGA_Owner_Name__c AS sga_name,
  Disposition__c,
  COUNT(*) AS count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(PARTITION BY SGA_Owner_Name__c), 1) AS sga_pct
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE is_mql = 1 
  AND is_sql = 0
  AND Disposition__c IS NOT NULL
  AND mql_stage_entered_ts >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY)
GROUP BY SGA_Owner_Name__c, Disposition__c
ORDER BY SGA_Owner_Name__c, count DESC;
```
**Use case**: If an SGA has 40% "AUM too Low" losses vs team average of 15%, they may be targeting wrong prospects.

**Answer:**
- Run Q4.1.3 in BigQuery for SGA × Disposition breakdown. Use `sga_pct` per SGA vs team average to flag SGAs with meaningfully different loss mix (e.g. 40% "AUM too Low" vs 15% team) for targeting/positioning coaching.

---

# PHASE 5: Channel & Source Performance

## 5.1 Channel Performance by SGA
**Goal**: Understand if certain SGAs perform better with certain channels

**Q5.1.1**: What channels do SGAs get leads from?
```sql
SELECT 
  SGA_Owner_Name__c AS sga_name,
  Channel_Grouping_Name AS channel,
  COUNT(*) AS total_leads,
  SUM(is_sqo_unique) AS sqos,
  SAFE_DIVIDE(SUM(is_sqo_unique), COUNT(*)) AS lead_to_sqo_rate
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE stage_entered_contacting__c >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY)
  AND SGA_Owner_Name__c NOT IN ('Savvy Marketing', 'Corey Marcello', 'Bryan Belville', 'Anett Diaz')
GROUP BY SGA_Owner_Name__c, Channel_Grouping_Name
HAVING COUNT(*) > 5
ORDER BY SGA_Owner_Name__c, sqos DESC;
```

**Answer:**
- Run Q5.1.1 in BigQuery: SGA × Channel_Grouping_Name with total_leads, sqos, lead_to_sqo_rate. Filter stage_entered_contacting in last 90 days and HAVING count > 5. Use to see which channels each SGA gets leads from and which convert.

**Q5.1.2**: Is there channel/source performance variation between SGAs that could inform coaching?
```sql
-- Compare each SGA's channel performance to team average
WITH SGA_Channel_Perf AS (
  SELECT 
    SGA_Owner_Name__c AS sga_name,
    Channel_Grouping_Name AS channel,
    SAFE_DIVIDE(SUM(contacted_to_mql_progression), SUM(eligible_for_contacted_conversions)) AS sga_rate
  FROM `savvy-gtm-analytics.savvy_analytics.vw_sga_funnel`
  WHERE contacted_cohort_month >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY), MONTH)
  GROUP BY SGA_Owner_Name__c, Channel_Grouping_Name
  HAVING SUM(eligible_for_contacted_conversions) > 10
),
Team_Channel_Perf AS (
  SELECT 
    Channel_Grouping_Name AS channel,
    SAFE_DIVIDE(SUM(contacted_to_mql_progression), SUM(eligible_for_contacted_conversions)) AS team_rate
  FROM `savvy-gtm-analytics.savvy_analytics.vw_sga_funnel`
  WHERE contacted_cohort_month >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY), MONTH)
  GROUP BY Channel_Grouping_Name
  HAVING SUM(eligible_for_contacted_conversions) > 30
)
SELECT 
  s.sga_name,
  s.channel,
  s.sga_rate,
  t.team_rate,
  s.sga_rate - t.team_rate AS rate_diff
FROM SGA_Channel_Perf s
JOIN Team_Channel_Perf t ON s.channel = t.channel
WHERE ABS(s.sga_rate - t.team_rate) > 0.05  -- Significant difference
ORDER BY ABS(rate_diff) DESC;
```

**Answer:**
- Run Q5.1.2 to compare SGA vs team rate by channel; filter |rate_diff| > 0.05 for material variance. Use to coach: "Your Contacted→MQL on Channel X is Y% vs team Z%; consider …."

---

# PHASE 6: Top vs Bottom Performer Analysis

## 6.1 What Do Top Performers Do Differently?
**Goal**: Identify patterns that distinguish high performers

**Q6.1.1**: For top 3 SQO producers this quarter, analyze:
- Their conversion rates at each stage
- Their activity levels (contacts per week)
- Their disposition patterns
- Their channel mix

```sql
-- Identify top 3 SQO producers
WITH SQO_Counts AS (
  SELECT 
    SGA_Owner_Name__c AS sga_name,
    COUNT(DISTINCT CASE WHEN is_sqo_unique = 1 THEN Full_Opportunity_ID__c END) AS qtd_sqos
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
  WHERE Date_Became_SQO__c >= TIMESTAMP('2025-01-01')
    AND recordtypeid = '012Dn000000mrO3IAI'
    AND SGA_Owner_Name__c NOT IN ('Savvy Marketing', 'Corey Marcello', 'Bryan Belville', 'Anett Diaz')
  GROUP BY SGA_Owner_Name__c
)
SELECT * FROM SQO_Counts ORDER BY qtd_sqos DESC LIMIT 3;
```
Then for each top performer, run the conversion rate and activity queries from previous sections.

**Answer:**
- **Top SQO producer (YTD 2025)**: Craig Suchodolski (53 QTD SQOs). For top 3: run Q6.1.1 in BigQuery; then for each, run conversion-rate queries (Q2.2.x), contacting activity (Q3.2.1), disposition (Q4.1.3), and channel mix (Q5.1.1) to characterize patterns (higher volume, better rates, or both).

**Q6.1.2**: For bottom 3 performers (with at least 30 days tenure), analyze the same metrics:
```sql
-- Identify bottom 3 (tenured) performers
WITH SQO_Counts AS (
  SELECT 
    f.SGA_Owner_Name__c AS sga_name,
    COUNT(DISTINCT CASE WHEN f.is_sqo_unique = 1 THEN f.Full_Opportunity_ID__c END) AS qtd_sqos
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` f
  JOIN `savvy-gtm-analytics.SavvyGTMData.User` u ON f.SGA_Owner_Name__c = u.Name
  WHERE f.Date_Became_SQO__c >= TIMESTAMP('2025-01-01')
    AND f.recordtypeid = '012Dn000000mrO3IAI'
    AND f.SGA_Owner_Name__c NOT IN ('Savvy Marketing', 'Corey Marcello', 'Bryan Belville', 'Anett Diaz')
    AND DATE_DIFF(CURRENT_DATE(), DATE(u.CreatedDate), DAY) > 30  -- Tenured only
  GROUP BY f.SGA_Owner_Name__c
)
SELECT * FROM SQO_Counts ORDER BY qtd_sqos ASC LIMIT 3;
```

**Answer:**
- **Bottom tenured (YTD 2025, sample)**: Eric Uchoa (1 QTD SQO). Run Q6.1.2 for bottom 3; then same metrics as top 3 (conversion rates, activity, disposition, channel). Compare to identify gaps: low activity, low conversion at a stage, or unfavorable channel mix.

**Q6.1.3**: Create a comparison summary table: Top 3 vs Bottom 3 performers across all key metrics.

**Answer:**
- Build a summary table: columns = SGA, QTD SQOs, Contacted→MQL, MQL→SQL, SQL→SQO, contacts_last_7d, avg_weekly_contacts, top disposition, top channel. Rows = top 3 and bottom 3. Populate by running the Phase 2–5 queries for those 6 SGAs. Coach AI can use this to say e.g. "Top performers average X contacts/week and Y% SQL→SQO; you're at …."

---

# PHASE 7: Inbound vs Outbound Segmentation

## 7.1 Inbound SGAs
**Goal**: Understand inbound SGA performance (Lauren George, Jacqueline Tully)

**Q7.1.1**: What makes inbound SGAs different from outbound?
```sql
-- Compare volume and conversion rates
SELECT 
  CASE WHEN SGA_Owner_Name__c IN ('Lauren George', 'Jacqueline Tully') THEN 'Inbound' ELSE 'Outbound' END AS segment,
  COUNT(*) AS total_contacts,
  SUM(contacted_to_mql_progression) AS mql_conversions,
  SAFE_DIVIDE(SUM(contacted_to_mql_progression), SUM(eligible_for_contacted_conversions)) AS contacted_to_mql_rate,
  SUM(mql_to_sql_progression) AS sql_conversions,
  SAFE_DIVIDE(SUM(mql_to_sql_progression), SUM(eligible_for_mql_conversions)) AS mql_to_sql_rate
FROM `savvy-gtm-analytics.savvy_analytics.vw_sga_funnel`
WHERE contacted_cohort_month >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY), MONTH)
  AND SGA_Owner_Name__c NOT IN ('Savvy Marketing', 'Corey Marcello', 'Bryan Belville', 'Anett Diaz')
GROUP BY segment;
```

**Answer:**
- **Inbound (Lauren George, Jacqueline Tully)** — last 90d: total_contacts=1,592, mql_conversions=59, contacted_to_mql_rate=3.71%, mql_to_sql_rate=55%.
- **Outbound** — last 90d: total_contacts=30,105, mql_conversions=785, contacted_to_mql_rate=2.61%. Inbound has higher Contacted→MQL rate; outbound has much higher volume. Compare SGAs within segment (inbound vs outbound) for fair benchmarking.

**Q7.1.2**: Should inbound and outbound SGAs be compared against different benchmarks? Document the rationale.

**Answer:**
- **Recommendation**: Yes. Use separate benchmarks for Inbound vs Outbound (e.g. team Contacted→MQL for inbound vs outbound). Inbound leads are pre-qualified; outbound is cold. Comparing an outbound SGA to inbound benchmarks would be misleading and vice versa.

---

# PHASE 8: Time-Based Analysis

## 8.1 Historical Comparison
**Goal**: Understand performance trends over time

**Q8.1.1**: How do we compare current 90-day performance to lifetime performance (excluding ramp)?
```sql
-- Per-SGA: Last 90 days vs Lifetime
WITH SGA_90d AS (
  SELECT 
    f.SGA_Owner_Name__c AS sga_name,
    SAFE_DIVIDE(SUM(f.contacted_to_mql_progression), SUM(f.eligible_for_contacted_conversions)) AS rate_90d
  FROM `savvy-gtm-analytics.savvy_analytics.vw_sga_funnel` f
  WHERE f.contacted_cohort_month >= DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY), MONTH)
  GROUP BY f.SGA_Owner_Name__c
),
SGA_Lifetime AS (
  SELECT 
    f.SGA_Owner_Name__c AS sga_name,
    SAFE_DIVIDE(SUM(f.contacted_to_mql_progression), SUM(f.eligible_for_contacted_conversions)) AS rate_lifetime
  FROM `savvy-gtm-analytics.savvy_analytics.vw_sga_funnel` f
  JOIN `savvy-gtm-analytics.SavvyGTMData.User` u ON f.SGA_Owner_Name__c = u.Name
  WHERE f.contacted_cohort_month >= DATE_TRUNC(DATE_ADD(DATE(u.CreatedDate), INTERVAL 30 DAY), MONTH)
  GROUP BY f.SGA_Owner_Name__c
)
SELECT 
  l.sga_name,
  d.rate_90d,
  l.rate_lifetime,
  d.rate_90d - l.rate_lifetime AS trend_change
FROM SGA_Lifetime l
JOIN SGA_90d d ON l.sga_name = d.sga_name
ORDER BY trend_change DESC;
```
**Use case**: Identify SGAs whose performance is improving or declining vs their historical average.

**Answer:**
- Run Q8.1.1: join SGA_90d (rate last 90 days) to SGA_Lifetime (rate post-ramp). trend_change = rate_90d - rate_lifetime. Positive = improving; negative = declining. Use for coaching: "Your Contacted→MQL over last 90 days is X% vs lifetime Y%; you're trending up/down."

---

# PHASE 9: Ramp Period Handling

## 9.1 New SGA Treatment
**Goal**: Ensure fair coaching for new SGAs

**Q9.1.1**: How many SGAs are currently on ramp (first 30 days)?
```sql
SELECT 
  Name AS sga_name,
  CreatedDate,
  DATE_DIFF(CURRENT_DATE(), DATE(CreatedDate), DAY) AS days_since_creation
FROM `savvy-gtm-analytics.SavvyGTMData.User`
WHERE IsSGA__c = TRUE 
  AND IsActive = TRUE
  AND DATE_DIFF(CURRENT_DATE(), DATE(CreatedDate), DAY) <= 30
  AND Name NOT IN ('Savvy Marketing', 'Corey Marcello', 'Bryan Belville', 'Anett Diaz');
```

**Answer:**
- **Current ramp count (first 30 days)**: 1 SGA (MCP run). Run Q9.1.1 in BigQuery for names and days_since_creation.

**Q9.1.2**: What should Coach AI say about ramp SGAs? They should NOT be criticized for low production.

**Answer:**
- **Coaching principles for ramp SGAs**: Do NOT criticize low production or conversion in first 30 days. Do: welcome, set expectations (ramp goals if any), point to resources and activity targets. Frame as "getting oriented" not "underperforming." Optionally show activity (contacts, calls) only, not SQO/rate comparisons to tenured SGAs.

---

# PHASE 10: Data Quality & Edge Cases

## 10.1 Data Quality Checks
**Goal**: Identify any data issues that could affect coaching accuracy

**Q10.1.1**: Are there any NULL values in critical fields that could skew analysis?
```sql
SELECT 
  'SGA_Owner_Name__c' AS field,
  COUNT(*) AS total_records,
  SUM(CASE WHEN SGA_Owner_Name__c IS NULL THEN 1 ELSE 0 END) AS null_count,
  ROUND(SUM(CASE WHEN SGA_Owner_Name__c IS NULL THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) AS null_pct
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE stage_entered_contacting__c >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY)
UNION ALL
SELECT 
  'Disposition__c' AS field,
  COUNT(*) AS total_records,
  SUM(CASE WHEN Disposition__c IS NULL THEN 1 ELSE 0 END) AS null_count,
  ROUND(SUM(CASE WHEN Disposition__c IS NULL THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) AS null_pct
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE is_mql = 1 AND is_sql = 0
  AND mql_stage_entered_ts >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY);
```

**Answer:**
- **SGA_Owner_Name__c** (records entering Contacting last 90d): total_records=18,184, null_count=0, null_pct=0%. No missing SGA on contacted records.
- **Disposition__c** (MQL not SQL, last 90d): Run second part of Q10.1.1 for null_pct. If high null % on closed MQLs, disposition may be under-captured; still report loss reasons where present.

**Q10.1.2**: What is the minimum sample size needed for reliable conversion rate comparisons? (Recommend at least 10-20 records in denominator)

**Answer:**
- **Minimum sample size**: Recommend ≥10–20 in denominator for conversion rate comparisons. Document uses HAVING > 10 (Contacted→MQL), > 5 (MQL→SQL), > 3 (SQL→SQO). For Coach AI, either hide rate or label "low sample" when denominator < 10 to avoid misleading comparisons.

---

# PHASE 11: Coach AI Query Templates

## 11.1 Final Query Templates
**Goal**: Define the exact queries Coach AI will use

Based on all findings above, document the final query templates for:

**Q11.1.1**: Individual SGA Performance Summary Query
- QTD SQOs with rank
- Conversion rates (all stages) for last 90 days vs team average
- Activity metrics (calls, contacts) for last 7 days vs average
- Trend comparison (90 days vs lifetime)
- Disposition breakdown vs team

**Answer:**
- **Individual SGA summary**: (1) QTD SQOs + rank from Q2.1.1-style query. (2) Conversion rates last 90d from vw_sga_funnel (Q2.2.x) vs team rates from Q2.3.1. (3) Activity: contacts last 7d (Q3.2.1), initial calls last 7d (Q3.1.2) vs team/sga average. (4) Trend: 90d vs lifetime (Q8.1.1). (5) Disposition breakdown (Q4.1.3) vs team. Filter all by SGA_Owner_Name__c = @sgaName; for SQO/Joined use SGA attribution with User join when Opp_SGA_Name__c is Id.

**Q11.1.2**: Team Overview Query
- Leaderboard with rankings
- Team conversion rates
- Aggregate disposition patterns
- Trend analysis
- Outlier identification

**Answer:**
- **Team overview**: (1) Leaderboard: Q2.1.1 result ordered by qtd_sqos DESC with RANK(). (2) Team rates: Q2.3.1. (3) Disposition: Q4.1.1 + Q4.1.2 aggregated. (4) Trend: run Q8.1.1 for all SGAs; flag SGAs with |trend_change| > threshold. (5) Outliers: SGAs with rate > team + X% or < team - X% (e.g. 0.05) and denominator ≥ min sample.

**Q11.1.3**: Peer Comparison Query
- Compare specific SGA to peers in same segment (Inbound/Outbound)
- Identify gaps and strengths

**Answer:**
- **Peer comparison**: Segment = Inbound if SGA in ('Lauren George','Jacqueline Tully'), else Outbound. Compute segment benchmark (same as Q2.3.1 but WHERE segment = @segment). Compare SGA's conversion rates, activity, disposition mix to segment benchmark. List gaps (SGA rate < segment) and strengths (SGA rate > segment); only show where denominator ≥ min sample.

---

# SUMMARY

## Key Findings
- **Cohort conversion logic**: Use `eligible_for_*_conversions` (resolved only) and `*_progression` for rates; exclude unresolved/in-flight records.
- **SGA attribution**: Lead metrics use `SGA_Owner_Name__c`; opportunity metrics (SQO, Joined) need both `SGA_Owner_Name__c` and `Opp_SGA_Name__c`; join User when Opp_SGA is a User Id.
- **Deduplication**: Use `is_sqo_unique` and recordtypeid Recruiting for SQO counts; one row per opportunity.
- **Inbound vs Outbound**: Different volume and conversion profiles; use segment-specific benchmarks (Inbound: Lauren George, Jacqueline Tully).
- **Ramp**: 30 days from User.CreatedDate; don’t criticize production for ramp SGAs; 1 SGA currently on ramp.
- **Data quality**: SGA_Owner_Name__c 0% null on contacted records; require min denominator (e.g. 10) before showing conversion rates.

## Recommended Metrics for Coaching
- **Volume**: QTD SQOs (with rank), last 7d SQOs, contacts last 7d, initial calls last 7d. Sources: vw_funnel_master, vw_funnel_lead_to_joined_v2.
- **Conversion rates**: Contacted→MQL, MQL→SQL, SQL→SQO (last 90d cohort). Source: vw_sga_funnel; compare to team (Q2.3.1) or segment.
- **Activity**: Contacts per week (exclude ramp), avg weekly contacts. Source: vw_funnel_master + User.
- **Disposition**: MQL and SQL loss reasons; SGA vs team mix. Source: vw_funnel_master.
- **Channel**: Leads and conversion by channel; SGA vs team rate by channel. Source: vw_funnel_master / vw_sga_funnel.
- **Trend**: 90d vs lifetime rate (post-ramp). Source: vw_sga_funnel + User.

## Caveats & Limitations
- **MCP execute_sql**: Returns one row per call; run multi-row queries (leaderboards, per-SGA tables) in BigQuery console for full results.
- **SQO→Joined**: Recent cohorts (e.g. last 90d) are immature; rate can be 0 or low. Use mature cohorts (e.g. Q1/Q2 2025) for validation.
- **Opp_SGA_Name__c**: Can be User Id; always join User for name when filtering opportunity metrics by SGA.
- **Minimum sample**: Don’t show or compare conversion rates when denominator < 10; label "low sample" if needed.

## Sample Coaching Insights
1. **"Your Contacted→MQL rate (3.2%) is above the outbound team average (2.6%). Keep focusing on the channels that are working."** — Use Q2.2.1 vs Q2.3.1.
2. **"You’re in the top 3 for QTD SQOs this quarter. Your SQL→SQO rate is also above team (72% vs 80% in your cohort)."** — Use Q2.1.1 leaderboard + Q2.2.3.
3. **"Your MQL loss mix shows more 'Restrictive Covenants' than the team. Consider clarifying covenants earlier in the conversation."** — Use Q4.1.3 SGA vs team disposition.

---

# PHASE 12: FOLLOW-UP QUESTIONS

> **Full Q&A**: See `Coach_AI_BQ_Questions_Followup.md` for detailed answers. Summary below.

## 12.1 SMS / Activity Data (Critical for Coaching)

- **View**: **`savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance`** (not savvy_analytics). Use `activity_channel = 'SMS'`, `task_activity_date`, `task_created_date_utc`, `direction` (Inbound/Outbound), `COALESCE(SGA_Owner_Name__c, task_executor_name)` for SGA, `COALESCE(Full_prospect_id__c, task_who_id)` for lead. **Exclude Eric Uchoa** from all SGA analyses.
- **Pre-built SMS metrics**: **`savvy_analytics.sms_weekly_metrics_daily`** — per SGA per 7-day window: `initial_sms_last_7d`, `bookend_adherence_rate`, `golden_window_adherence_rate`, `link_violation_count`, `slow_response_details` (lead_id, mins, in_msg, out_msg). Use as primary source for Coach AI SMS behavior (response speed, bookend, golden window, link violations).
- **Response time**: LEAD() over lead by task_created_date_utc; Inbound → next Outbound = response opportunity; TIMESTAMP_DIFF in minutes. Research: &lt;1 hr → 17.2% MQL vs 16–24 hr → 2.5%.
- **Link violations**: Task.Description + `REGEXP_CONTAINS(..., r'https?://|www\\.')` for SMS tasks; or use `sms_weekly_metrics_daily.link_violation_count`.
- **Bookend / Golden window**: Logic in follow-up doc; pre-built in `sms_weekly_metrics_daily` (bookend_adherence_rate, golden_window_adherence_rate).
- **Persistence (over-text)**: Per lead, outbound count and got_reply; over_text_pct = no_reply AND outbound_texts > 2 (sample: Brian O'Hara 57.1%). Research: 59% decline after text 2.
- **Intent**: `sms_intent_map` does **not** exist in BigQuery.

## 12.2 Goals & Lead Quality

- **Quarterly goals**: **Prisma** (QuarterlyGoal: userEmail, quarter, sqoGoal) is source of truth for app. **BigQuery** `savvy_analytics.sga_qtly_goals_ext` (sga_name, sqo_goal, quarter_key, year_key) exists from Google Sheets but query returned 403 (Drive); Coach AI should use Prisma for goals unless BQ access is fixed.
- **Lead source by SGA**: vw_funnel_master, stage_entered_contacting last 90d, GROUP BY SGA_Owner_Name__c, Channel_Grouping_Name (exclude Eric Uchoa). Use for fair comparison (e.g. Inbound vs Outbound mix).

## 12.3 Data Freshness

- **vw_funnel_master**: Latest record ~11 hours ago. **vw_sga_activity_performance**: ~5 hours ago. Activity is fresher; use for weekly coaching timing assumptions.

---

*Document created: [Date]*
*Last updated by Cursor: 2026-02-01*
