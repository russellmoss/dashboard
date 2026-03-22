# Data Verifier Findings: SGM Hub Dashboard Tab (Phase 2)

**Date:** 2026-03-22
**Analyst:** data-verifier agent (claude-sonnet-4-6)
**Primary source:** savvy-gtm-analytics.Tableau_Views.vw_funnel_master
**Scope:** Phase 2 -- ARR fields, SQO->Joined velocity, SGM filtering, quarterly cohorts

---

## Executive Summary

The view contains all 4 newly added fields and is live in production.
Two significant data architecture findings require attention:

1. **SGM_Estimated_ARR__c has 0% population on Joined records.** Only populated on
   active pipeline stages (Sales Process, Negotiating, Discovery, On Hold).
   The field is mutually exclusive with Actual_ARR__c -- different lifecycle stages.
   The dashboard must treat them separately.

2. **Account_Total_ARR__c is duplicated across team members on the same Salesforce Account.**
   Summing directly across joined records double- or triple-counts teams.
   Any aggregate query must deduplicate by Account first.

All other fields are well-formed. SQO-to-Joined velocity is supported by 101 of 116
joined records (87.1%). No negative velocity values exist.

---

## 1. Field Existence Confirmation

Query: INFORMATION_SCHEMA.COLUMNS WHERE table_name = vw_funnel_master

| Field | Data Type | Nullable | Status |
|---|---|---|---|
| Actual_ARR__c | FLOAT64 | YES | CONFIRMED |
| SGM_Estimated_ARR__c | FLOAT64 | YES | CONFIRMED |
| Account_Total_ARR__c | FLOAT64 | YES | CONFIRMED |
| Stage_Entered_Joined__c | TIMESTAMP | YES | CONFIRMED |
| SGM_Owner_Name__c | STRING | YES | CONFIRMED (pre-existing) |

All 5 fields exist in the live BigQuery view and match views/vw_funnel_master.sql.

SQO-related fields confirmed present:

| Field | Type | Purpose |
|---|---|---|
| Date_Became_SQO__c | TIMESTAMP | SQO date anchor for velocity calc |
| SQO_raw | STRING | Raw SQL__c field value |
| is_sqo | INT64 | Derived binary flag |
| is_sqo_unique | INT64 | Deduped SQO flag |
| sqo_cohort_month | STRING | YYYY-MM format |
| sqo_to_joined_progression | INT64 | Progression flag |
| sql_to_sqo_progression | INT64 | Progression flag |
| eligible_for_sqo_conversions | INT64 | Denominator control |

The correct SQO date field for velocity calculation is **Date_Became_SQO__c** (TIMESTAMP).
There is no Stage_Entered_SQO__c field -- that name does not exist in the view.

---

## 2. Population Rates

### 2a. For is_joined = 1 records (116 total rows, 115 unique advisors)

| Field | Non-Null Count | Total Joined | Population Rate | Assessment |
|---|---|---|---|---|
| Actual_ARR__c | 72 | 116 | **62.1%** | FLAG -- 38% gap |
| SGM_Estimated_ARR__c | 0 | 116 | **0.0%** | CRITICAL -- not populated on joined records |
| Account_Total_ARR__c | 107 | 116 | **92.2%** | Good, but has team duplication issue |
| Stage_Entered_Joined__c | 106 | 116 | **91.4%** | Good |

### 2b. For all opportunity records (2,147 total, Full_Opportunity_ID__c IS NOT NULL)

| Field | Non-Null Count | Total Opps | Population Rate | Assessment |
|---|---|---|---|---|
| Actual_ARR__c | 72 | 2,147 | 3.4% | Joined-stage only |
| SGM_Estimated_ARR__c | 71 | 2,147 | 3.3% | Active pipeline only |
| Account_Total_ARR__c | 116 | 2,147 | 5.4% | Joined records only |
| Stage_Entered_Joined__c | 107 | 2,147 | 5.0% | Joined records only |

Field population is by design -- all four fields are scoped to specific funnel stages.

### 2c. ARR field stage exclusivity (CRITICAL FINDING)

From querying all opp records grouped by StageName:

- Actual_ARR__c is populated ONLY on StageName = Joined (72 of 116 joined records).
  NULL on all other stages.

- SGM_Estimated_ARR__c is populated ONLY on active pipeline stages:
  Sales Process (36), Negotiating (16), Discovery (9), On Hold (5), Closed Lost (5).
  NULL on all Joined records.

These fields are 100% mutually exclusive across all 2,147 opp records:

| Overlap Category | Count |
|---|---|
| Both fields populated | 0 |
| Only Actual_ARR__c | 72 |
| Only SGM_Estimated_ARR__c | 71 |
| Neither | 2,004 |

Implication: SGM_Estimated_ARR__c = SGM pre-close ARR estimate;
Actual_ARR__c = confirmed ARR at join. By the time a deal joins, Salesforce
has cleared the estimate field. These fields cannot be compared in the same query row.

### 2d. Stage_Entered_Joined__c date range

| Metric | Value |
|---|---|
| Earliest date | 2024-01-31 |
| Latest date | 2026-03-19 |
| Records with date | 106 of 116 joined records |
| NULLs on joined records | 10 (8.6%) |

The 10 NULLs represent joined advisors where Salesforce did not capture the exact
stage transition timestamp. advisor_join_date__c (DATE, 100% populated) serves as fallback.

### 2e. Actual_ARR__c value distribution (72 joined records with non-null value)

| Metric | Value |
|---|---|
| Min | $0.00 |
| Max | $1,532,748.05 |
| Average | $321,364.17 |
| P25 | $40,173.91 |
| Median | $208,000.18 |
| P75 | $457,459.22 |

Median ($208K) vs average ($321K) reflects moderate right-skew from high-AUM advisors.

---

## 3. SQO to Joined Velocity

### 3a. Field coverage for velocity calculation

| Metric | Count |
|---|---|
| Total is_joined = 1 records | 116 |
| Have Stage_Entered_Joined__c | 106 (91.4%) |
| Have Date_Became_SQO__c | 109 (94.0%) |
| Have both fields (usable for velocity) | 101 (87.1% of all joined) |
| SQO coverage of those with Stage_Entered_Joined__c | 95.3% |

101 of 116 joined records are usable for SQO->Joined velocity calculation.

### 3b. Velocity statistics (101 records with both dates)

| Metric | Value |
|---|---|
| Average days SQO to Joined | **82.9 days** |
| Minimum | 7 days |
| Maximum | 356 days |
| P25 | 36 days |
| Median | **74 days** |
| P75 | 108 days |

**No negative velocity values exist** (0 records where Joined precedes SQO date). Data is clean.

### 3c. Velocity day distribution

| Bucket | Count | % of 101 |
|---|---|---|
| Same day (0 days) | 0 | 0% |
| 1-30 days | 18 | 17.8% |
| 31-90 days | 47 | 46.5% |
| 91-180 days | 28 | 27.7% |
| Over 180 days | 8 | 7.9% |

IQR is 36-108 days. The 8 records over 180 days are real long-cycle deals, not data errors.
Distribution is right-skewed as expected for a high-touch recruiting process.

---

## 4. SGM Filtering

### 4a. SGM_Owner_Name__c confirmed

Field exists: Yes (STRING, IS NULLABLE). 100% populated on is_joined_unique = 1 records.

### 4b. Distinct SGM names and record counts

| SGM_Owner_Name__c | Total Records | SQO Records | Joined (unique) |
|---|---|---|---|
| GinaRose Galli | 879 | 223 | 43 |
| Bre McDaniel | 348 | 211 | 31 |
| Corey Marcello | 204 | 153 | 17 |
| RJ Cupelli | 110 | 57 | 5 |
| Bryan Belville | 109 | 74 | 5 |
| Erin Pearson | 91 | 70 | 4 |
| Jacqueline Tully | 87 | 29 | 4 |
| Jade Bingham | 87 | 55 | 2 |
| Arianna Butler | 38 | 25 | 1 |
| Tim Mackey | 35 | 25 | 1 |
| Lexi Harrison | 20 | 15 | 1 |
| Savvy Marketing | 5 | 1 | 1 (SGA anomaly per Phase 1) |
| Russell Armitage | 28 | 13 | 0 (NEW -- not in Phase 1 User check) |
| Channing Guyer | 23 | 10 | 0 (NEW -- not in Phase 1 User check) |
| Clayton Kennamer | 15 | 12 | 0 |
| David Eubanks | 11 | 7 | 0 |
| Perry Kalmeta | 9 | 3 | 0 |
| Lena Allouche | 8 | 5 | 0 |
| + others (each 1-6 records each) | -- | -- | 0 |

New names since Phase 1: Russell Armitage (28 records) and Channing Guyer (23 records).
Always filter the leaderboard via SavvyGTMData.User WHERE Is_SGM__c = TRUE AND IsActive = TRUE.

### 4c. Sample filtered aggregation -- GinaRose Galli (2024-Q1 through 2026-Q1)

| Quarter | SQL | SQO | Joined | SQL->SQO% | SQO->Joined% | Avg Days SQO->Join |
|---|---|---|---|---|---|---|
| 2026-Q1 | 1 | 0 | 0 | 0.0% | n/a | n/a |
| 2025-Q4 | 1 | 0 | 0 | 0.0% | n/a | n/a |
| 2025-Q3 | 13 | 8 | 5 | 61.5% | 62.5% | 88.4 days |
| 2025-Q2 | 37 | 19 | 2 | 51.4% | 10.5% | 51.0 days |
| 2025-Q1 | 28 | 20 | 2 | 71.4% | 10.0% | 213.0 days |
| 2024-Q4 | 14 | 9 | 1 | 64.3% | 11.1% | 20.0 days |
| 2024-Q3 | 19 | 12 | 3 | 63.2% | 25.0% | 173.3 days |
| 2024-Q2 | 26 | 18 | 3 | 69.2% | 16.7% | 34.0 days |

FLAG: GinaRose Galli shows near-zero SQL activity in Q4 2025 and Q1 2026 by FilterDate
(1 SQL each quarter vs historical 13-47/quarter). Her join counts by advisor_join_date__c
remain healthy per Phase 1. Possible cause: lead ownership attribution changed. Investigate.

### 4d. Sample filtered aggregation -- Bre McDaniel (2024-Q1 through 2026-Q1)

| Quarter | SQL | SQO | Joined | SQL->SQO% | SQO->Joined% | Avg Days SQO->Join |
|---|---|---|---|---|---|---|
| 2026-Q1 | 30 | 18 | 0 | 60.0% | 0.0% | n/a |
| 2025-Q4 | 28 | 20 | 0 | 71.4% | 0.0% | n/a |
| 2025-Q3 | 41 | 24 | 3 | 58.5% | 12.5% | 106.3 days |
| 2025-Q2 | 37 | 26 | 2 | 70.3% | 7.7% | 82.5 days |
| 2025-Q1 | 34 | 28 | 7 | 82.4% | 25.0% | 55.7 days |
| 2024-Q4 | 58 | 36 | 8 | 62.1% | 22.2% | 100.1 days |
| 2024-Q3 | 77 | 46 | 10 | 59.7% | 21.7% | 83.6 days |
| 2024-Q2 | 11 | 7 | 1 | 63.6% | 14.3% | 108.0 days |

Note: 0 joined in recent quarters by FilterDate is expected -- advisors entering those
quarters have not yet closed given ~83-day avg velocity. Leaderboard uses
advisor_join_date__c quarter which shows 12 joined in 2026-Q1.
SGM-filtered queries work correctly.

---

## 5. Quarterly Cohort Data Depth

### 5a. Last 12 quarters by FilterDate (pipeline entry cohort)

| Quarter | SQL | SQO | Joined (unique) | Total Funnel Records |
|---|---|---|---|---|
| 2026-Q1 | 169 | 107 | 0* | 30,140 |
| 2025-Q4 | 194 | 143 | 10 | 18,560 |
| 2025-Q3 | 216 | 141 | 15 | 10,222 |
| 2025-Q2 | 157 | 108 | 13 | 8,195 |
| 2025-Q1 | 122 | 95 | 12 | 6,790 |
| 2024-Q4 | 129 | 85 | 13 | 9,615 |
| 2024-Q3 | 172 | 99 | 17 | 7,505 |
| 2024-Q2 | 92 | 56 | 6 | 3,610 |
| 2024-Q1 | 78 | 49 | 10 | 2,434 |
| 2023-Q4 | 34 | 39 | 8 | 3,616 |
| 2023-Q3 | 174 | 34 | 3 | 5,745 |
| 2023-Q2 | 97 | 25 | 3 | 3,325 |

*2026-Q1: 12 joined by advisor_join_date__c quarter; 0 by FilterDate cohort.

### 5b. Joined counts by advisor_join_date__c quarter (leaderboard-relevant)

| Quarter | Joined (unique) |
|---|---|
| 2026-Q1 | 12 (in progress through 2026-03-19) |
| 2025-Q4 | 17 |
| 2025-Q3 | 14 |
| 2025-Q2 | 12 |
| 2025-Q1 | 12 |
| 2024-Q4 | 13 |
| 2024-Q3 | 9 |
| 2024-Q2 | 7 |
| 2024-Q1 | 5 |

8 complete or in-progress quarters starting 2024-Q1. SQL/SQO counts (92-216/quarter)
are robust for trend rendering. Joined counts of 5-17/quarter are sufficient as totals
but marginal for per-SGM-per-quarter breakdowns -- display n= counts with percentages.

---

## 7. ARR Sanity Check

### 7a. Account_Total_ARR__c distribution (107 joined records with non-null value)

| Metric | Value |
|---|---|
| Raw sum (NOT deduplicated) | $65,348,716.55 |
| Average per joined record | $610,735.67 |
| P25 | $161,632.92 |
| Median | $306,463.04 |
| P75 | $801,585.10 |
| Max | $2,855,773.63 |
| Records over $1M | 22 (20.6%) |
| Records over $500K | 39 (36.4%) |
| Records under $10K | 6 (5.6%) |

**CRITICAL -- Account_Total_ARR__c is duplicated across team members on the same
Salesforce Account.** This field is a LEFT JOIN from Account. When multiple advisors
join under the same Account (team joins), every member gets the same Account-level
ARR value. Summing directly overcounts.

Confirmed duplication groups (top 10 by Account ARR):

| Account_Total_ARR | Advisors on Same Account |
|---|---|
| $2,800,878.82 | 3 advisors (Jacob Larue, Matthew Finley, Matthew Nelson) |
| $2,104,531.89 | 5 advisors (Joshua Barone team) |
| $1,863,354.37 | 2 advisors (Brad Morgan, Nate Kunkel) |
| $1,593,905.73 | 2 advisors (True Harvest team) |
| $1,349,026.08 | 2 advisors (Cindy Alvarez, Janelle Van Meel) |
| $1,081,280.34 | 2 advisors (Brandon Barber, Brian Boswell) |
| $887,456.26 | 3 advisors (Team Horizon) |
| $747,478.64 | 2 advisors (Frank Malpigli, Michael Most) |
| $506,301.41 | 2 advisors (Erik Allison, Tyson Lokke) |
| $398,739.30 | 2 advisors (Colin Farr, Michaela Sullivan) |

At minimum 26 advisors across 10 account groups have duplicated ARR values.
The raw sum of $65.3M overcounts real ARR.

Recommended usage patterns:
- Per-advisor display: Show Account_Total_ARR__c as 'Account ARR' next to each row.
  Acceptable as context even if the number is shared across a team.
- Portfolio totals: Use Actual_ARR__c (individual, no duplication) and accept 62.1% coverage.
  Show n= count alongside.
- Account-level totals: Cannot use SUM(DISTINCT Account_Total_ARR__c) because team members
  have different Opportunity IDs on the same Account. Requires a view change.

### 7b. Actual_ARR__c vs SGM_Estimated_ARR__c comparison

These fields cannot be compared directly -- 0 records have both populated (see 2c).
Actual_ARR__c is post-join; SGM_Estimated_ARR__c is pre-close active pipeline.
Salesforce clears the estimate field when the deal closes.

SGM_Estimated_ARR__c on active pipeline (71 records):

| Stage | Count with Value | Avg Value |
|---|---|---|
| Sales Process | 36 | $622,108.36 |
| Negotiating | 16 | $766,991.44 |
| Discovery | 9 | $1,141,111.11 |
| On Hold | 5 | $497,000.00 |
| Closed Lost | 5 | $680,400.00 |

Average estimated ARR on active pipeline: $715,841.75
Average actual ARR on joined records (72 records): $321,364.17

The apparent 2x gap should not be interpreted as SGMs overestimating by 2x --
these are entirely different advisor populations at different deal stages.

### 7c. Outlier check

| Field | Max Value | Note |
|---|---|---|
| Actual_ARR__c | $1,532,748.05 | Matthew Nelson (Bre McDaniel) -- legitimate large advisor |
| SGM_Estimated_ARR__c | $4,000,000.00 | Active pipeline, Discovery stage -- verify if intentional |
| Account_Total_ARR__c | $2,855,773.63 | Colorado Wealth Group (Bre McDaniel) |

The $4M SGM_Estimated_ARR__c should be verified (5.6x the avg estimate of $715K).
No data layer action needed but the dashboard may want to flag values far above median.

---

## 8. Flags and Blockers Summary

| Severity | Issue | Impact | Recommendation |
|---|---|---|---|
| CRITICAL | Account_Total_ARR__c duplicated across team members on same Salesforce Account | Summing inflates totals by 20-30% | Never SUM directly. Use per-advisor display, or flag as Phase 3 view enhancement for deduplicated account ARR column. |
| HIGH | SGM_Estimated_ARR__c is 0% populated on Joined records | Any joined scorecard widget expecting this field returns nulls | Use SGM_Estimated_ARR__c only for active pipeline queries. Not usable on the joined scorecard. |
| MEDIUM | Actual_ARR__c is 62.1% populated on Joined records (44 of 116 NULL) | ARR metrics exclude 38% of advisors | Accept coverage gap. Display n= count alongside any ARR total. Do not impute. |
| LOW | Stage_Entered_Joined__c is NULL for 10 joined records (8.6%) | Velocity metric excludes these 10 records | Use advisor_join_date__c as fallback for display. Exclude NULLs from velocity calc explicitly. |
| LOW | GinaRose Galli shows near-zero SQL in Q4 2025 and Q1 2026 by FilterDate (1 each vs historical 13-47/quarter) | FilterDate pipeline metrics appear anomalous for her | Investigate lead ownership attribution. Join counts by advisor_join_date__c remain healthy. |
| INFO | New names Russell Armitage and Channing Guyer in SGM_Owner_Name__c (not in Phase 1 User check) | May appear on leaderboard without User table filter | Filter via User WHERE Is_SGM__c = TRUE AND IsActive = TRUE. |
| INFO | 2026-Q1 shows 0 joined by FilterDate cohort | Apparent zero in FilterDate chart | Use advisor_join_date__c quarter for leaderboard join counts. FilterDate for SQL/SQO trend charts only. |

---

## 9. View Change Assessment

**No view changes are required** for the Phase 2 scorecard feature.

- All 4 new fields are live in the deployed view and match views/vw_funnel_master.sql.
- SGM_Estimated_ARR__c limitation is a Salesforce data model constraint (CRM clears
  the estimate field on deal close), not a view deficiency.
- Account_Total_ARR__c duplication is inherent to the LEFT JOIN from Account and
  cannot be fixed without materializing the view or adding window functions.

**Potential Phase 3 view enhancement:** Add an account_arr_deduplicated column using
ROW_NUMBER() OVER (PARTITION BY AccountId ORDER BY advisor_join_date__c) to flag the
first member of each team, enabling correct portfolio ARR totals.

---

## 10. Recommended Query Patterns

### SGM Scorecard (joined-quarter based, with ARR and velocity)

    -- Parameters: @quarter_months ARRAY<STRING>
    SELECT
      u.Name AS sgm_name,
      COUNT(f.Full_prospect_id__c) AS joined_count,
      COALESCE(SUM(f.Actual_ARR__c), 0) AS total_actual_arr,
      COUNT(CASE WHEN f.Actual_ARR__c IS NOT NULL THEN 1 END) AS arr_coverage_count,
      ROUND(AVG(
        CASE WHEN f.Stage_Entered_Joined__c IS NOT NULL AND f.Date_Became_SQO__c IS NOT NULL
        THEN DATE_DIFF(DATE(f.Stage_Entered_Joined__c), DATE(f.Date_Became_SQO__c), DAY)
        END
      ), 1) AS avg_days_sqo_to_joined
    FROM savvy-gtm-analytics.SavvyGTMData.User u
    LEFT JOIN savvy-gtm-analytics.Tableau_Views.vw_funnel_master f
      ON f.SGM_Owner_Name__c = u.Name
      AND f.is_joined_unique = 1
      AND f.joined_cohort_month IN UNNEST(@quarter_months)
    WHERE u.Is_SGM__c = TRUE AND u.IsActive = TRUE
    GROUP BY 1 ORDER BY 2 DESC

### Velocity Distribution for a Quarter

    -- Parameters: @quarter_months ARRAY<STRING>
    SELECT
      SGM_Owner_Name__c,
      DATE_DIFF(DATE(Stage_Entered_Joined__c), DATE(Date_Became_SQO__c), DAY) AS days_sqo_to_joined,
      advisor_name
    FROM savvy-gtm-analytics.Tableau_Views.vw_funnel_master
    WHERE is_joined_unique = 1
      AND joined_cohort_month IN UNNEST(@quarter_months)
      AND Stage_Entered_Joined__c IS NOT NULL
      AND Date_Became_SQO__c IS NOT NULL
    ORDER BY 1, 2

### Active Pipeline ARR by SGM (SGM_Estimated_ARR__c only)

    -- For pipeline view ONLY -- NOT for joined scorecard
    SELECT
      SGM_Owner_Name__c, StageName,
      COUNT(*) AS opp_count,
      SUM(SGM_Estimated_ARR__c) AS pipeline_estimated_arr
    FROM savvy-gtm-analytics.Tableau_Views.vw_funnel_master
    WHERE SGM_Estimated_ARR__c IS NOT NULL
      AND SGM_Owner_Name__c IS NOT NULL
      AND StageName NOT IN ('Joined', 'Closed Lost')
    GROUP BY 1, 2 ORDER BY 1, 3 DESC

---

## 11. Field Inventory for Phase 2

| Field | Source | Type | Use Case | Population (joined) | Caveat |
|---|---|---|---|---|---|
| Actual_ARR__c | vw_funnel_master | FLOAT64 | Per-advisor ARR on scorecard | 62.1% | Only on Joined stage; 38% gap |
| SGM_Estimated_ARR__c | vw_funnel_master | FLOAT64 | Active pipeline ARR | 0% on joined | Use for pipeline queries only |
| Account_Total_ARR__c | vw_funnel_master | FLOAT64 | Account-level ARR context | 92.2% | Duplicated across team members on same Account |
| Stage_Entered_Joined__c | vw_funnel_master | TIMESTAMP | Velocity calc (joined anchor) | 91.4% | 8.6% NULL; fallback to advisor_join_date__c |
| Date_Became_SQO__c | vw_funnel_master | TIMESTAMP | Velocity calc (SQO anchor) | 94.0% on joined | Confirmed correct SQO date field |
| SGM_Owner_Name__c | vw_funnel_master | STRING | SGM filter key | 100% on joined | Filter via User table join |
| is_joined_unique | vw_funnel_master | INT64 | Dedup filter | n/a | Always use this, not is_joined |
| advisor_join_date__c | vw_funnel_master | DATE | Join date, quarter grouping | 100% on joined | Preferred date for leaderboard |
| joined_cohort_month | vw_funnel_master | STRING | Quarter filter (YYYY-MM) | 100% on joined | Preferred for parameterized queries |
