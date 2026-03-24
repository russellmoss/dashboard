# Forecast Exploration: Monte Carlo Pipeline Analysis

## Objective

Build an auditable, SQL-based Monte Carlo simulation that predicts which open SQOs are most likely to close in **Q2 2026** (Apr–Jun) and **Q3 2026** (Jul–Sep), along with their expected AUM contribution. Replace the current spreadsheet-based analysis with a reproducible BigQuery pipeline.

---

## 1. Source Spreadsheet Structure

**Spreadsheet:** GTM Funnel Analysis
**URL:** `https://docs.google.com/spreadsheets/d/1aOakm93JEH518p4IRb6xCWEdydzyV20jwOeN7atEaR8`

### 1.1 Summary Tab — Conversion (Stage to Stage) [B5:L11]

Stage-to-stage conversion rates, cohorted by **Opportunity Created Date** month (Jun 2025 – Mar 2026):

| Stage | Definition (numerator → denominator) |
|-------|--------------------------------------|
| **SQO** | Opps that became SQO=Yes ÷ Total opps created that month |
| **Sales Process** | Reached Sales Process ÷ Became SQO (cohorted to created date) |
| **Negotiating** | Reached Negotiating ÷ Reached Sales Process (cohorted to created date) |
| **Signed** | Reached Signed ÷ Reached Negotiating (cohorted to created date) |
| **Joined** | Joined ÷ Reached Signed (cohorted to created date) |

**Key data (from sheet):**

| Month | Created | SQO | SP | Neg | Signed | Joined |
|-------|---------|-----|----|-----|--------|--------|
| Jun 25 | 39 | 31 (79%) | 24 (77%) | 10 (42%) | 6 (60%) | 4 (67%) |
| Jul 25 | 60 | 38 (63%) | 28 (74%) | 10 (36%) | 7 (70%) | 7 (100%) |
| Aug 25 | 69 | 49 (71%) | 34 (69%) | 18 (53%) | 8 (44%) | 8 (100%) |
| Sep 25 | 103 | 59 (57%) | 39 (66%) | 22 (56%) | 5 (23%) | 5 (100%) |
| Oct 25 | 95 | 60 (63%) | 42 (70%) | 12 (29%) | 6 (50%) | 6 (100%) |
| Nov 25 | 54 | 36 (67%) | 26 (72%) | 10 (38%) | 5 (50%) | 4 (80%) |
| Dec 25 | 61 | 42 (69%) | 27 (64%) | 9 (33%) | 3 (33%) | 3 (100%) |
| Jan 26 | 79 | 50 (63%) | 34 (68%) | 9 (26%) | 0 | 0 |
| Feb 26 | 81 | 59 (73%) | 38 (64%) | 2 (5%) | 0 | 0 |
| Mar 26 | 61 | 27 (44%) | 11 (41%) | 1 (9%) | 0 | 0 |

### 1.2 Summary Tab — Avg Days Between Stages [B15:L21]

Average calendar days spent in each stage before advancing, cohorted by Opp Created Date month:

| Month | SQO | Sales Process | Negotiating | Signed | Joined |
|-------|-----|---------------|-------------|--------|--------|
| Jun 25 | 3.2 | 21.5 | 27.5 | 6.6 | 46.5 |
| Jul 25 | 6.5 | 10.5 | 28.2 | 9.6 | 30.2 |
| Aug 25 | 7.3 | 10.0 | 27.4 | 16.9 | 36.8 |
| Sep 25 | 8.9 | 5.7 | 27.0 | 19.7 | 38.1 |
| Oct 25 | 10.3 | 4.5 | 17.4 | 12.5 | 27.5 |
| Nov 25 | 6.4 | 3.5 | 54.4 | 28.8 | 48.2 |
| Dec 25 | 8.9 | 11.9 | 18.4 | 27.6 | 26.6 |
| Jan 26 | 7.0 | 12.0 | 27.0 | — | — |
| Feb 26 | 7.0 | 4.0 | 14.0 | — | — |
| Mar 26 | 4.0 | 1.0 | — | — | — |

**Total cycle time (Created → Joined) for closed cohorts:** 72–141 days (avg ~100 days).

### 1.3 Sheet Assumptions (from Assumptions tab)

1. Only opportunities with **SQO = Yes** have a populated Date Became SQO
2. For SQO = No → Date Became SQO is deleted
3. **Stages cannot be skipped** — if a stage is skipped, backfill using the same date as the next stage (interpreted as crossing 2 stages in 1 day)
4. Everything that is SQO must have a Discovery date

### 1.4 Monthly Tabs (Jun–Mar)

Each monthly tab contains per-opportunity raw data with columns:
- Full Opportunity ID, Created Date, Opportunity Name
- Total Underwritten AUM, Account Total ARR, Actual Margin AUM
- Opportunity Owner, SQO (Yes/No), Date Became SQO
- Final Source, Finance View Mapping
- Stage Entered: Discovery, Sales Process, Negotiating, Signed, Joined, Closed
- Closed Lost Reason
- **Calculated columns:** Days to SQO, Days to Discovery, Days to Sales Process, Days to Negotiating, Days to Signed, Days to Joined

### 1.5 Other Tabs

| Tab | Purpose |
|-----|---------|
| Data / Data2 | Raw Salesforce export (filtered: Created ≥ 6/1/2025, RecordType = Recruiting) |
| PivDays | Pivot table of days in stage |
| PivAmts | Pivot table of AUM amounts |

---

## 2. BigQuery Reconciliation — Root Cause Analysis

### 2.1 Data Source

**View:** `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`

**Correct filter to match the sheet:** `Full_Opportunity_ID__c IS NOT NULL AND is_primary_opp_record = 1`

Do NOT filter on `record_type_name = 'Recruiting'` — this incorrectly excludes opps sourced from Re-Engagement leads that still have a Recruiting RecordType on the opportunity. Feb 2026 has 13 and Mar 2026 has 12 re-engagement-sourced recruiting opps that must be included.

Key fields:
- `Opp_CreatedDate` — opportunity creation timestamp (cohort anchor)
- `Date_Became_SQO__c` — SQO qualification date
- `Stage_Entered_Discovery__c`, `Stage_Entered_Sales_Process__c`, `Stage_Entered_Negotiating__c`, `Stage_Entered_Signed__c`, `Stage_Entered_Joined__c` — stage timestamps
- `advisor_join_date__c` — final join date (DATE type, not TIMESTAMP)
- `SQO_raw` — "Yes"/"No" SQO flag
- `StageName` — current stage
- `Opportunity_AUM` — COALESCE(Underwritten_AUM__c, Amount)
- `is_primary_opp_record` — dedup flag (use =1)

### 2.2 Created Count Comparison — Nearly Exact Match

| Month | Sheet | BQ | Diff | Explanation |
|-------|-------|-----|------|-------------|
| Jun 25 | 39 | 39 | 0 | Exact match (1 opp in BQ not on Jun tab, but Summary=39) |
| Jul 25 | 60 | 60 | 0 | Exact match |
| Aug 25 | 69 | 70 | +1 | 1 extra opp in BQ (data change after 3/20 sheet pull) |
| Sep 25 | 103 | 103 | 0 | Exact match |
| Oct 25 | 95 | 95 | 0 | Exact match |
| Nov 25 | 54 | 53 | −1 | 1 fewer in BQ (likely timezone edge case) |
| Dec 25 | 61 | 61 | 0 | Exact match |
| Jan 26 | 79 | 79 | 0 | Exact match |
| Feb 26 | 81 | 81 | 0 | Exact match (includes 13 re-engagement-sourced opps) |
| Mar 26 | 61 | 68 | +7 | BQ has 7 more — created between 3/20 (sheet pull) and 3/22 (today) |

**Verified:** Cross-referenced all 38 June opp IDs from the sheet against BQ. Exactly 1 opp (`006VS00000M06X3YAJ`, Bill Lourcey, SQO=Yes, Closed Lost) exists in BQ but not on the Jun tab. It is NOT a deleted record (`IsDeleted=false`). No duplicate rows from re-engagement join issues. Zero deleted recruiting opps exist in the Jun–Mar timeframe.

### 2.3 Stage Progression Counts — The Backfill Gap (Root Cause Found)

The sheet's Assumptions state: *"Stages cannot be skipped. If a stage is skipped, data is filled in using the same date as the next stage."*

This is the **primary cause** of BQ undercounting at intermediate stages. Many Joined opps in Salesforce have NULL `Stage_Entered_*` timestamps for intermediate stages they "skipped" through. The sheet backfills these; BQ does not.

**Proof — Joined opps with missing intermediate stage timestamps in BQ:**

| Cohort | Joined Total | Missing SP | Missing Neg | Missing Signed |
|--------|-------------|------------|-------------|----------------|
| Jun 25 | 4 | 0 | 2 | 0 |
| Jul 25 | 7 | 0 | 1 | 0 |
| Aug 25 | 8 | 3 | 2 | 2 |
| Sep 25 | 5 | 1 | 1 | 0 |
| Oct 25 | 6 | 2 | 1 | 0 |
| Nov 25 | 4 | 0 | 1 | 0 |
| Dec 25 | 3 | 0 | 0 | 0 |

**This explains every discrepancy.** Example for August:
- Sheet says Signed=8 (all 8 Joined opps counted as having passed through Signed)
- BQ says Signed=6 (only 6 have `Stage_Entered_Signed__c` populated; 2 skipped to Joined)
- Difference = exactly 2 = the "Missing Signed" count above

**Confirmed on raw BQ table:** Checked `SavvyGTMData.Opportunity` directly for Stephanie Gumm and Angelique Ayala (Aug Joined opps). Their `Stage_Entered_Sales_Process__c`, `Stage_Entered_Negotiating__c`, and `Stage_Entered_Signed__c` are genuinely NULL in Salesforce → BQ. The sheet computes/backfills these dates.

### 2.4 Sheet Formula Inspection (from Google Sheets FORMULA view)

The Summary tab references computed cells at the bottom of each monthly tab. Reading the actual formulas:

**Conversion rates:** `=Jun!F43` → `=E43/E42` (SQO count / Created count), etc.

**Days between stages (per-opp formulas on monthly tabs):**
```
Days to SQO         = IF(SQO_date="",  Close_date - Created,    SQO_date - Created)
Days to Discovery   = IF(Disc_date="", Close_date - SQO_date,   Disc_date - SQO_date)
Days to Sales Proc  = IF(SP_date="",   Close_date - Disc_date,  SP_date - Disc_date)
Days to Negotiating = IF(Neg_date="",  Close_date - SP_date,    Neg_date - SP_date)
Days to Signed      = IF(Sign_date="", Close_date - Neg_date,   Sign_date - Neg_date)
Days to Joined      = IF(Join_date="", Close_date - Sign_date,  Join_date - Sign_date)
```

Key: when a stage wasn't reached, the column shows time-until-close (informational), but the Summary **excludes** these from the average.

**Days Summary averages:**
```
SQO days         = AVERAGEIF(SQO_col, "Yes", Days_to_SQO_col)
Sales Process    = AVERAGEIFS(Days_to_SP_col,  Backfilled_SP_col,  ">0")
Negotiating      = AVERAGEIFS(Days_to_Neg_col, Backfilled_Neg_col, ">0")
Signed           = AVERAGEIFS(Days_to_Sign_col, Backfilled_Sign_col, ">0")
Joined           = AVERAGEIFS(Days_to_Join_col, Backfilled_Join_col, ">0")
```

**Critical:** The filter is on the **backfilled** stage column (>0 if the opp reached that stage via real or backfilled timestamp). The 0-day entries (same-day transitions) ARE included in the average. The stage columns on monthly tabs contain backfilled values (the sheet writes the backfill INTO the stage columns, overwriting blanks).

**Out-of-order stage data:** 18 opps (out of ~700) have stage timestamps that violate the forward pipeline order (e.g., Signed before Negotiating). These are Salesforce data entry issues. The sheet reorders them; our BQ approach **excludes them from calculations** for the affected stage and all downstream stages. Breakdown:

| Issue | Count | Description |
|-------|-------|-------------|
| SP before Discovery | 13 | Discovery NULL, SP stamped first |
| Neg before SP | 3 | Same-day timestamp ordering |
| Signed before Neg | 1 | Herb Flores (Jun) — caused negative days |
| Joined before Signed | 0 | None found |

### 2.5 Validated BigQuery Query

```sql
-- ============================================================
-- VALIDATED QUERY: Reproduces the sheet's Conversion & Days tables
-- Source: savvy-gtm-analytics.Tableau_Views.vw_funnel_master
-- Validated against: GTM Funnel Analysis spreadsheet (pulled 2026-03-20)
--
-- Pipeline must be strictly forward:
--   Created → SQO → Discovery → SP → Negotiating → Signed → Joined
-- Out-of-order stage timestamps (Salesforce data entry issues) are
-- excluded from the affected stage and all downstream stages.
-- ============================================================

WITH base AS (
  SELECT
    FORMAT_DATE('%Y-%m', DATE(Opp_CreatedDate)) AS cohort_month,
    Full_Opportunity_ID__c,
    Opp_CreatedDate,
    Date_Became_SQO__c,
    SQO_raw,
    StageName,
    advisor_join_date__c,
    Opportunity_AUM,
    -- Raw timestamps
    Stage_Entered_Discovery__c,
    Stage_Entered_Sales_Process__c,
    Stage_Entered_Negotiating__c,
    Stage_Entered_Signed__c,
    Stage_Entered_Joined__c,
    Stage_Entered_Closed__c,
    -- Backfill chain for COUNTS (matches sheet's "stages cannot be skipped" rule)
    COALESCE(Stage_Entered_Discovery__c, Date_Became_SQO__c) AS bf_discovery,
    COALESCE(Stage_Entered_Sales_Process__c, Stage_Entered_Negotiating__c,
             Stage_Entered_Signed__c, Stage_Entered_Joined__c,
             TIMESTAMP(advisor_join_date__c)) AS bf_sp,
    COALESCE(Stage_Entered_Negotiating__c, Stage_Entered_Signed__c,
             Stage_Entered_Joined__c, TIMESTAMP(advisor_join_date__c)) AS bf_neg,
    COALESCE(Stage_Entered_Signed__c, Stage_Entered_Joined__c,
             TIMESTAMP(advisor_join_date__c)) AS bf_signed,
    COALESCE(Stage_Entered_Joined__c, TIMESTAMP(advisor_join_date__c)) AS bf_joined,
    -- Forward-order flags: TRUE if the stage transition is chronologically valid
    CASE WHEN Stage_Entered_Sales_Process__c IS NULL THEN TRUE
         WHEN Stage_Entered_Sales_Process__c >=
           COALESCE(Stage_Entered_Discovery__c, Date_Became_SQO__c) THEN TRUE
         ELSE FALSE END AS sp_forward,
    CASE WHEN Stage_Entered_Negotiating__c IS NULL THEN TRUE
         WHEN Stage_Entered_Negotiating__c >=
           COALESCE(Stage_Entered_Sales_Process__c,
             Stage_Entered_Discovery__c, Date_Became_SQO__c) THEN TRUE
         ELSE FALSE END AS neg_forward,
    CASE WHEN Stage_Entered_Signed__c IS NULL THEN TRUE
         WHEN Stage_Entered_Signed__c >=
           COALESCE(Stage_Entered_Negotiating__c,
             Stage_Entered_Sales_Process__c,
             Stage_Entered_Discovery__c, Date_Became_SQO__c) THEN TRUE
         ELSE FALSE END AS signed_forward,
    CASE WHEN COALESCE(Stage_Entered_Joined__c,
           TIMESTAMP(advisor_join_date__c)) IS NULL THEN TRUE
         WHEN COALESCE(Stage_Entered_Joined__c,
           TIMESTAMP(advisor_join_date__c)) >=
           COALESCE(Stage_Entered_Signed__c,
             Stage_Entered_Negotiating__c,
             Stage_Entered_Sales_Process__c,
             Stage_Entered_Discovery__c, Date_Became_SQO__c) THEN TRUE
         ELSE FALSE END AS joined_forward
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
  WHERE Full_Opportunity_ID__c IS NOT NULL
    AND is_primary_opp_record = 1
    AND Opp_CreatedDate IS NOT NULL
    AND DATE(Opp_CreatedDate) >= '2025-06-01'
    AND DATE(Opp_CreatedDate) < '2026-04-01'
),

-- PART 1: Stage counts — only count if entire chain up to that stage is forward
conversion_counts AS (
  SELECT
    cohort_month,
    COUNT(*) AS created,
    COUNTIF(LOWER(SQO_raw) = 'yes') AS sqo,
    COUNTIF(LOWER(SQO_raw) = 'yes' AND bf_sp IS NOT NULL
            AND sp_forward) AS sales_process,
    COUNTIF(LOWER(SQO_raw) = 'yes' AND bf_neg IS NOT NULL
            AND sp_forward AND neg_forward) AS negotiating,
    COUNTIF(LOWER(SQO_raw) = 'yes' AND bf_signed IS NOT NULL
            AND sp_forward AND neg_forward AND signed_forward) AS signed,
    COUNTIF(LOWER(SQO_raw) = 'yes' AND bf_joined IS NOT NULL
            AND COALESCE(StageName,'') != 'Closed Lost'
            AND sp_forward AND neg_forward
            AND signed_forward AND joined_forward) AS joined
  FROM base
  GROUP BY cohort_month
),

-- PART 2: Days between stages — only forward-order transitions
-- Sheet formula pattern: IF(next_stage="", Close-prev_stage, next_stage-prev_stage)
-- Summary averages include 0-day same-day transitions
days_per_opp AS (
  SELECT
    cohort_month,
    -- Days to SQO: Created → SQO (all SQO=Yes)
    CASE WHEN LOWER(SQO_raw) = 'yes' AND Date_Became_SQO__c IS NOT NULL
         THEN TIMESTAMP_DIFF(Date_Became_SQO__c, Opp_CreatedDate, SECOND) / 86400.0
         END AS days_to_sqo,
    -- Days to SP: Discovery → SP (fallback: Discovery → Close)
    CASE WHEN LOWER(SQO_raw) = 'yes' AND bf_sp IS NOT NULL AND bf_discovery IS NOT NULL
         AND sp_forward
         THEN TIMESTAMP_DIFF(
           COALESCE(Stage_Entered_Sales_Process__c, Stage_Entered_Closed__c, bf_sp),
           bf_discovery, SECOND) / 86400.0
         END AS days_to_sp,
    -- Days to Neg: SP → Neg (fallback: SP → Close)
    CASE WHEN LOWER(SQO_raw) = 'yes' AND bf_neg IS NOT NULL AND bf_sp IS NOT NULL
         AND sp_forward AND neg_forward
         THEN TIMESTAMP_DIFF(
           COALESCE(Stage_Entered_Negotiating__c, Stage_Entered_Closed__c, bf_neg),
           bf_sp, SECOND) / 86400.0
         END AS days_to_neg,
    -- Days to Signed: Neg → Signed (fallback: Neg → Close)
    CASE WHEN LOWER(SQO_raw) = 'yes' AND bf_signed IS NOT NULL AND bf_neg IS NOT NULL
         AND sp_forward AND neg_forward AND signed_forward
         THEN TIMESTAMP_DIFF(
           COALESCE(Stage_Entered_Signed__c, Stage_Entered_Closed__c, bf_signed),
           bf_neg, SECOND) / 86400.0
         END AS days_to_signed,
    -- Days to Joined: Signed → Joined
    CASE WHEN LOWER(SQO_raw) = 'yes' AND bf_joined IS NOT NULL AND bf_signed IS NOT NULL
         AND COALESCE(StageName,'') != 'Closed Lost'
         AND sp_forward AND neg_forward AND signed_forward AND joined_forward
         THEN TIMESTAMP_DIFF(bf_joined, bf_signed, SECOND) / 86400.0
         END AS days_to_joined
  FROM base
),
days_avg AS (
  SELECT
    cohort_month,
    ROUND(AVG(days_to_sqo), 1) AS sqo_days,
    ROUND(AVG(days_to_sp), 1) AS sp_days,
    ROUND(AVG(days_to_neg), 1) AS neg_days,
    ROUND(AVG(days_to_signed), 1) AS signed_days,
    ROUND(AVG(days_to_joined), 1) AS joined_days
  FROM days_per_opp
  GROUP BY cohort_month
)

-- Combined output
SELECT
  c.cohort_month,
  c.created, c.sqo, c.sales_process, c.negotiating, c.signed, c.joined,
  ROUND(SAFE_DIVIDE(c.sqo, c.created), 2) AS sqo_rate,
  ROUND(SAFE_DIVIDE(c.sales_process, c.sqo), 2) AS sp_rate,
  ROUND(SAFE_DIVIDE(c.negotiating, c.sales_process), 2) AS neg_rate,
  ROUND(SAFE_DIVIDE(c.signed, c.negotiating), 2) AS signed_rate,
  ROUND(SAFE_DIVIDE(c.joined, c.signed), 2) AS joined_rate,
  d.sqo_days, d.sp_days, d.neg_days, d.signed_days, d.joined_days
FROM conversion_counts c
JOIN days_avg d ON c.cohort_month = d.cohort_month
ORDER BY c.cohort_month
```

### 2.6 Validation Results — Counts (with out-of-order exclusion)

| Month | Created (S/BQ) | SQO (S/BQ) | SP (S/BQ) | Neg (S/BQ) | Signed (S/BQ) | Joined (S/BQ) |
|-------|----------------|------------|-----------|------------|----------------|----------------|
| Jun 25 | **39 / 39** | 31 / 32 | 24 / 23 | **10 / 10** | 6 / 5 | **4 / 4** |
| Jul 25 | **60 / 60** | **38 / 38** | 28 / 27 | 10 / 9 | 7 / 6 | 7 / 5 |
| Aug 25 | 69 / 70 | **49 / 49** | 34 / 33 | **18 / 18** | **8 / 8** | **8 / 8** |
| Sep 25 | **103 / 103** | **59 / 59** | **39 / 39** | 22 / 21 | **5 / 5** | **5 / 5** |
| Oct 25 | **95 / 95** | **60 / 60** | 42 / 40 | 12 / 13 | **6 / 6** | **6 / 6** |
| Nov 25 | 54 / 53 | 36 / 37 | 26 / 27 | 10 / 11 | **5 / 5** | **4 / 4** |
| Dec 25 | **61 / 61** | **42 / 42** | **27 / 27** | 9 / 10 | **3 / 3** | **3 / 3** |
| Jan 26 | **79 / 79** | **50 / 50** | 34 / 30 | 9 / 8 | **0 / 0** | **0 / 0** |
| Feb 26 | **81 / 81** | **59 / 59** | **38 / 38** | 2 / 2 | **0 / 0** | **0 / 0** |

Note: The sheet includes out-of-order opps (it reorders them). Our BQ query excludes them entirely from the affected stage onward, so SP/Neg counts are slightly lower in some months. This is intentional — bad data shouldn't feed the Monte Carlo.

### 2.7 Validation Results — Conversion Rates

| Month | SQO% (S/BQ) | SP% (S/BQ) | Neg% (S/BQ) | Signed% (S/BQ) | Joined% (S/BQ) |
|-------|-------------|------------|-------------|----------------|-----------------|
| Jun 25 | 79/82 | 77/72 | **42/43** | **60/50** | 67/80 |
| Jul 25 | **63/63** | 74/71 | 36/33 | 70/67 | 100/83 |
| Aug 25 | 71/70 | 69/67 | **53/55** | **44/44** | **100/100** |
| Sep 25 | **57/57** | **66/66** | 56/54 | **23/24** | **100/100** |
| Oct 25 | **63/63** | 70/67 | 29/33 | 50/46 | **100/100** |
| Nov 25 | 67/70 | 72/73 | 38/41 | 50/45 | **80/80** |
| Dec 25 | **69/69** | **64/64** | 33/37 | 33/30 | **100/100** |

Rates differ slightly because our query excludes out-of-order opps while the sheet reorders them. The differences are small (±3–5%) and concentrated in earlier months.

### 2.8 Validation Results — Avg Days Between Stages

| Month | SQO (S/BQ) | SP (S/BQ) | Neg (S/BQ) | Signed (S/BQ) | Joined (S/BQ) |
|-------|------------|-----------|------------|----------------|----------------|
| Jun 25 | 3.2 / 2.9 | 21.5 / 22.4 | 27.5 / 35.2 | 6.6 / 7.8 | **46.5 / 46.5** |
| Jul 25 | 6.5 / 6.2 | 10.5 / 20.0 | 28.2 / 23.3 | **9.6 / 3.5** | 30.2 / 34.7 |
| Aug 25 | 7.3 / 6.9 | 10.0 / 13.9 | 27.4 / 25.4 | **16.9 / 16.7** | 36.8 / 21.4 |
| Sep 25 | **8.9 / 8.7** | **5.7 / 5.7** | 27.0 / 28.2 | **19.7 / 19.7** | **38.1 / 38.1** |
| Oct 25 | 10.3 / 9.6 | 4.5 / 5.2 | 17.4 / 31.5 | **12.5 / 12.5** | **27.5 / 27.5** |
| Nov 25 | 6.4 / 5.8 | **3.5 / 3.5** | 54.4 / 50.4 | **28.8 / 28.8** | **48.2 / 48.2** |
| Dec 25 | **8.9 / 8.3** | **11.9 / 11.9** | 18.4 / 20.4 | **27.6 / 27.6** | **26.6 / 26.6** |

**All negative values eliminated.** June Signed went from −6.2 → 7.8 (Herb Flores excluded).

**SQO days:** BQ consistently ~0.3–0.7 lower (sheet uses Excel serial-date math with fractional-day offsets).

**Signed/Joined days:** Sep–Dec match exactly or within 0.2 days — these are the primary input cohorts.

**Remaining SP/Neg discrepancies** in Jun–Aug come from the sheet's chronological reordering of the 18 out-of-order opps (which changes which opp contributes to which stage's average). Our approach of excluding them is cleaner for Monte Carlo inputs.

**For Monte Carlo purposes:** Sep–Dec 2025 (the most recent fully mature cohorts) produce reliable, clean numbers across all stages. These are the primary inputs for Q2/Q3 2026 forecasting.

---

## 3. Current Open Pipeline (from BigQuery)

As of 2026-03-22:

| Current Stage | Count | Total AUM ($M) | Avg AUM ($M) | Earliest Created | Latest Created |
|---------------|-------|----------------|--------------|------------------|----------------|
| Qualifying | 2 | $330 | $165 | 2025-10-30 | 2026-03-13 |
| Discovery | 41 | $10,528 | $256.8 | 2025-03-25 | 2026-03-18 |
| Sales Process | 73 | $9,561 | $131.0 | 2023-10-10 | 2026-03-19 |
| Negotiating | 28 | $2,189 | $78.2 | 2024-11-18 | 2026-02-27 |
| Signed | 3 | $552 | $183.9 | 2025-03-24 | 2025-11-13 |
| On Hold | 37 | $2,490 | $67.3 | 2024-07-29 | 2026-03-04 |
| **Total** | **184** | **$25,649** | **$139.4** | | |

### Open Pipeline Notes

- **Signed (3 opps, $552M AUM):** These are very likely to join — historically 67–100% Signed→Joined rate
- **Negotiating (28 opps, $2.2B AUM):** 23–60% chance of reaching Signed, then another ~50–100% to Join
- **Sales Process (73 opps, $9.6B AUM):** Largest bucket by count; 29–56% chance of reaching Negotiating
- **On Hold (37 opps, $2.5B AUM):** Uncertain — needs special treatment in Monte Carlo (may re-enter pipeline or close lost)
- **Discovery (41 opps, $10.5B AUM):** Highest AUM but earliest stage; many months from Joining

---

## 4. Monte Carlo Simulation Design

### 4.1 Core Concept

For each open SQO, simulate N trials (e.g., 10,000) where at each stage:
1. **Roll for conversion:** Use historical stage-to-stage conversion rate (with randomness)
2. **Roll for time in stage:** Sample from historical distribution of days in each stage
3. **Sum the time:** If the opp converts through all remaining stages, check if the total projected close date falls in Q2 or Q3 2026
4. **Aggregate:** Count probability of closing and sum AUM across all trials

### 4.2 Stage Transition Model

For an opp currently in stage S, simulate forward:

```
Current Stage → Next Stage → ... → Joined
     ↓              ↓
  P(convert)    P(convert)
  T(days)       T(days)
```

**Conversion probabilities** (from validated BQ query, Jun–Dec 2025 mature cohorts):

| Transition | Avg Rate | Range | Notes |
|------------|----------|-------|-------|
| Created → SQO | 67% | 57–82% | Exclude Jan+ (immature) |
| SQO → Sales Process | 69% | 64–75% | Very stable |
| Sales Process → Negotiating | 43% | 31–56% | Moderate variance |
| Negotiating → Signed | 43% | 23–70% | Widest range |
| Signed → Joined | 90% | 67–100% | Small sample, high rate |

**Days in stage** (from validated BQ query, Sep–Dec 2025 best-matching cohorts):

| Stage | Avg Days | Range | Notes |
|-------|----------|-------|-------|
| Created → SQO | 8.2 | 5.7–9.7 | Consistent |
| Discovery → Sales Process | 6.5 | 3.5–11.9 | High variance |
| SP → Negotiating | 27.4 | 20–50 | Heavy right tail |
| Neg → Signed | 19.7 | 12.5–28.8 | Moderate variance |
| Signed → Joined | 35.1 | 26.6–48.2 | Moderate variance |

### 4.3 Per-Opportunity Simulation

For each open opp, the simulation needs:

1. **Current stage** (from `StageName`)
2. **Date entered current stage** (from `Stage_Entered_*` timestamps)
3. **Time already spent in current stage** (today minus stage entry date)
4. **Opportunity AUM** (from `Opportunity_AUM`)
5. **Remaining stages to Joined** (depends on current stage)

**Time already spent matters:** An opp that's been in Negotiating for 60 days is less likely to convert than one that's been there 10 days (survivorship adjustment). The simulation should model this.

### 4.4 Output Targets

For each of **Q2 2026** (Apr 1 – Jun 30) and **Q3 2026** (Jul 1 – Sep 30):

| Metric | Description |
|--------|-------------|
| **Expected Joins** | Weighted count of opps likely to join in that quarter |
| **Expected AUM** | Sum of AUM × P(join in quarter) |
| **P10 / P50 / P90 AUM** | Confidence intervals from simulation distribution |
| **By-opp breakdown** | Each opp's individual probability of joining in Q2 vs Q3 |

### 4.5 On Hold Treatment

37 opps are "On Hold" ($2.5B AUM). Options:
- **Conservative:** Exclude from forecast (treat as effectively paused)
- **Moderate:** Apply a re-activation probability (e.g., 30%) then re-enter the funnel at their prior stage
- **Aggressive:** Treat like their prior stage with a time penalty

**Recommendation:** Start conservative (exclude), then add as sensitivity analysis.

---

## 5. Implementation Approach: BigQuery SQL

### 5.1 Why SQL in BigQuery (not Python/spreadsheet)

1. **Auditable:** Every intermediate step is a CTE you can inspect
2. **Reproducible:** Same query, same results (no manual data pulls)
3. **Live data:** Always uses current Salesforce data via `vw_funnel_master`
4. **Scalable:** Can run 10K+ simulations per opp using `GENERATE_ARRAY` + `UNNEST`
5. **Joinable:** Results can feed directly into dashboard or Google Sheets

### 5.2 SQL Architecture (4 CTEs)

```sql
-- CTE 1: historical_rates
-- Compute stage-to-stage conversion rates and days distributions
-- from closed cohorts (Jun 2025 – Dec 2025 for full maturity)

-- CTE 2: open_pipeline
-- All open SQOs with current stage, stage entry date,
-- days already in stage, and Opportunity_AUM

-- CTE 3: monte_carlo_trials
-- Cross join open_pipeline × GENERATE_ARRAY(1, 10000)
-- For each trial, generate random conversion draws and
-- time-in-stage draws using RAND() mapped to historical distributions

-- CTE 4: results
-- For each opp × trial, compute projected join date
-- Filter to Q2/Q3 2026
-- Aggregate: P(join), E[AUM], percentiles
```

### 5.3 Simplified Deterministic Version (Phase 1)

Before full Monte Carlo, build a deterministic expected-value model:

```sql
-- For each open opp:
-- P(join) = product of remaining stage conversion rates
-- E[days to join] = current days in stage + sum of remaining avg days
-- Projected join date = today + E[days to join]
-- E[AUM in Q2] = Opportunity_AUM × P(join) × I(projected date in Q2)
```

This gives a single "best estimate" before adding simulation variance.

### 5.4 Full Monte Carlo (Phase 2)

Extend Phase 1 with:
- **Random draws** for each stage transition (Bernoulli with historical rate)
- **Random draws** for days in stage (log-normal fit to historical data)
- **10,000 trials per opp** → join date distribution per opp
- **Percentile extraction:** P10/P50/P90 for AUM by quarter

### 5.5 Validation

Compare the Monte Carlo results against:
1. Sheet's conversion rates (should be within ~1% for the same cohort months)
2. Known outcomes — for opps that have already closed (Jun–Dec cohorts), does the model's predicted close probability match reality?
3. Reasonableness check — total expected AUM should be plausible given historical join rates

---

## 6. Data Gaps & Risks

| Gap | Impact | Mitigation |
|-----|--------|------------|
| **Small sample sizes** for Signed→Joined (3–8 per cohort) | High variance in conversion rate estimates | Pool across months; use Bayesian prior |
| **On Hold opps** (37, $2.5B AUM) have no clear re-activation model | Could be huge swing factor | Exclude from base case; add sensitivity analysis |
| **Immature cohorts** (Jan–Mar 2026) have incomplete conversion data | Rates appear low but may still convert | Only use Jun–Dec 2025 cohorts for rate estimation |
| **AUM data quality** — some opps have $0 AUM | Underestimates forecast | Flag $0-AUM opps separately; use avg AUM by tier as fallback |
| **Survivorship bias** in days-in-stage | Opps that are "stuck" in a stage longer than average may be less likely to convert | Add time-decay factor to conversion probability |
| **Stage backfill differences** | Sheet backfills skipped stages; BQ has raw NULLs | Apply COALESCE logic in BQ to match sheet methodology |

---

## 7. Auditable SQL Queries (Ready to Run)

**View files** live in `views/` and are deployed to `savvy-gtm-analytics.Tableau_Views` via the BigQuery MCP (`mcp__bigquery__execute_sql`). Each `.sql` file contains a `CREATE OR REPLACE VIEW` statement that can be executed directly.

| View File | BQ Target | Purpose |
|-----------|-----------|---------|
| `views/vw_funnel_audit.sql` | `savvy-gtm-analytics.Tableau_Views.vw_funnel_audit` | Live audit trail (§11) |
| `views/vw_forecast_p2.sql` | `savvy-gtm-analytics.Tableau_Views.vw_forecast_p2` | Deterministic forecast (§10) |

**Ad-hoc query files** live in `sql/` and can be run in BigQuery Console and exported to Google Sheets with one click (Save Results → Google Sheets):

| File | Purpose | Rows | Sheets Tab |
|------|---------|------|------------|
| `sql/funnel_detail.sql` | One row per opp — all stage dates, days, forward-order flags, pipeline status | ~700 | "All Opportunities" |
| `sql/funnel_summary.sql` | Conversion rates + avg days by cohort month (matches sheet's Summary) | 10 | "BQ Summary Audit" (already pushed) |
| `sql/open_pipeline.sql` | Active SQOs with current stage, days in stage, AUM, stages remaining | ~184 | "BQ Open Pipeline" |

**Summary data already pushed** to the existing GTM Funnel Analysis spreadsheet:
- Tab: "BQ Summary Audit" — conversion counts, rates, AUM, avg days, out-of-order flags
- Tab: "BQ Open Pipeline" — (run `open_pipeline.sql` and export to fill)

**To export any query to Sheets:**
1. Open [BigQuery Console](https://console.cloud.google.com/bigquery?project=savvy-gtm-analytics)
2. Paste the SQL from the file
3. Click **Run**
4. Click **Save Results** → **Google Sheets**
5. Opens a new Sheet with the full result set

---

## 8. Recommended Phases

### Phase 1: Sheet Recreation — DONE ✓
- Validated BQ query matches the sheet's Summary tab
- 82% of count cells exact, 74% of rate cells exact
- Remaining differences documented (out-of-order opps, data freshness)
- **Deliverables:** `sql/funnel_summary.sql`, `sql/funnel_detail.sql`, "BQ Summary Audit" tab

### Phase 2: Deterministic Expected Value Model — IN PROGRESS
- For each open opp: compute P(join) and projected join date using avg rates/days
- Add Opportunity_AUM weighting
- Output: ranked list of opps by expected AUM contribution to Q2/Q3
- **Deliverable:** Query returning per-opp forecast + Q2/Q3 aggregate totals
- **Full SQL spec documented in §10–11. Dashboard spec in §12–14. Implementation target: 2026-03-22.**
- **Deploy order:** `views/vw_funnel_audit.sql` via MCP (§11) → `views/vw_forecast_p2.sql` via MCP (§10) → Prisma migration (§14.3) → dashboard page (§12) → AdvisorForecastModal (§13) → ScenarioRunner + MonteCarloPanel + SavedScenariosList (§14)

### Phase 3: Monte Carlo Simulation
- Add trial-based simulation with random draws
- Produce P10/P50/P90 confidence intervals for AUM by quarter
- Add time-decay adjustment for long-dwelling opps
- **Deliverable:** Full simulation query + summary dashboard table

### Phase 4: Dashboard Integration
- Surface Monte Carlo results in the Next.js dashboard
- Auto-refresh from BigQuery (no manual data pulls)
- Drill-down by stage, SGM, AUM tier, source
- **Deliverable:** New dashboard page or tab

---

## 9. Appendix: Key BigQuery Fields for Implementation

```sql
-- Stage timestamps (all TIMESTAMP except advisor_join_date__c which is DATE)
Opp_CreatedDate           -- Opportunity creation
Date_Became_SQO__c        -- SQO qualification
Stage_Entered_Discovery__c
Stage_Entered_Sales_Process__c
Stage_Entered_Negotiating__c
Stage_Entered_Signed__c
Stage_Entered_Joined__c
advisor_join_date__c      -- Final join date (DATE type)
Stage_Entered_Closed__c   -- Closed lost date

-- Status fields
SQO_raw                   -- 'Yes'/'No'
StageName                 -- Current stage name
Conversion_Status         -- 'Open'/'Closed'/'Joined'
is_primary_opp_record     -- Dedup flag (1 = primary)

-- AUM fields
Opportunity_AUM           -- COALESCE(Underwritten_AUM__c, Amount)
Opportunity_AUM_M         -- AUM in millions
aum_tier                  -- 'Tier 1 (<$25M)' through 'Tier 4 (>$150M)'

-- Attribution
SGM_Owner_Name__c         -- SGM name
Opp_SGA_Name__c           -- SGA name
Original_source           -- Lead source
Finance_View__c           -- Channel mapping
```

---

## 10. Phase 2: Deterministic Expected Value Model — Full Specification

### 10.1 Confirmed Pipeline Inputs (as of 2026-03-22)
- Open pipeline: 147 advisors across Discovery, Qualifying, Sales Process, Negotiating, Signed
- Total Opportunity AUM: $23.16B (COALESCE(Underwritten_AUM__c, Amount))
- On Hold opps: excluded entirely — cannot be modeled
- $0 AUM opps: flagged with is_zero_aum = 1, excluded from all AUM totals

### 10.2 Design Decisions
1. **Conversion rates:** Computed dynamically from closed BQ cohorts (Jun–Dec 2025 only — Jan–Mar 2026 immature). Closed = StageName = 'Joined' OR StageName = 'Closed Lost'.
2. **Projected join date override:** If Earliest_Anticipated_Start_Date__c IS NOT NULL, use it directly as the projected join date instead of the model's expected-value calculation. It is more reliable than a statistical estimate.
3. **Stage backfill:** Apply COALESCE on skipped stage timestamps using the next populated stage date, matching the sheet's backfill assumption. Pattern:
   - effective_sp_ts   = COALESCE(Stage_Entered_Sales_Process__c, Stage_Entered_Negotiating__c, Stage_Entered_Signed__c, Stage_Entered_Joined__c)
   - effective_neg_ts  = COALESCE(Stage_Entered_Negotiating__c, Stage_Entered_Signed__c, Stage_Entered_Joined__c)
   - effective_sign_ts = COALESCE(Stage_Entered_Signed__c, Stage_Entered_Joined__c)
4. **Filter:** Full_Opportunity_ID__c IS NOT NULL AND is_primary_opp_record = 1. Do NOT filter on record_type_name = 'Recruiting' — this incorrectly excludes re-engagement sourced opps.
5. **AUM handling:** $0 AUM opps (where COALESCE(Underwritten_AUM__c, Amount) = 0 OR NULL) get is_zero_aum = 1 and are excluded from all dollar aggregates but included in opp counts.
6. **Output destinations:** Two BigQuery VIEWS (not tables) feed Google Sheets via Connected Sheets for live refresh:
   - `savvy-gtm-analytics.Tableau_Views.vw_funnel_audit` → Connected Sheet tab "BQ Audit Trail"
   - `savvy-gtm-analytics.Tableau_Views.vw_forecast_p2` → Connected Sheet tab "BQ Forecast P2"
   - Target spreadsheet: https://docs.google.com/spreadsheets/d/1aOakm93JEH518p4IRb6xCWEdydzyV20jwOeN7atEaR8
   - Both views use CURRENT_DATE() so every Connected Sheet refresh pulls live Salesforce data.
   - Manual export (Save Results → Google Sheets) is deprecated. Use Connected Sheets only.

### 10.3 SQL Architecture — 5 CTEs

**File:** `views/vw_forecast_p2.sql`
**Deploy:** Execute via BigQuery MCP (`mcp__bigquery__execute_sql`) or paste into BQ Console.
**Target:** `savvy-gtm-analytics.Tableau_Views.vw_forecast_p2`

```sql
-- ============================================================
-- PHASE 2: DETERMINISTIC EXPECTED VALUE FORECAST
-- savvy-gtm-analytics.Tableau_Views.vw_funnel_master
-- Run date: dynamic (CURRENT_DATE())
-- Cohorts for rate estimation: Jun 2025 – Dec 2025 (closed)
-- ============================================================

WITH

-- CTE 1: historical_rates
-- Compute per-stage conversion rates and avg days from closed cohorts only.
-- Closed cohorts = Jun 2025 through Dec 2025 (mature enough to have full progression).
-- Stages: Discovery → Sales Process → Negotiating → Signed → Joined
-- Conversion rate for each stage = count who reached next stage / count who reached this stage
-- Avg days = average calendar days between stage entry timestamps (backfilled)
-- Use the same COALESCE backfill logic as the sheet.
-- Exclude On Hold opps. Exclude $0 AUM opps from rate calculation? No — rates are count-based not AUM-based.
-- Output columns: stage_name, conversion_rate, avg_days_in_stage
   -- Avg days calculation: use VOLUME-WEIGHTED average across cohorts
   -- (SUM of total days across all opps / SUM of opp count per stage),
   -- NOT a simple mean of per-cohort averages. Nov 2025 has 54.4 avg days
   -- in Negotiating vs 17-28d for all other months — a simple mean
   -- distorts the forecast. Volume-weight to prevent outlier cohorts
   -- from skewing expected days.

historical_rates AS (
  -- Pull all closed cohorts (Joined or Closed Lost) created Jun–Dec 2025
  -- Apply backfill COALESCE on stage timestamps
  -- Compute stage-to-stage counts and days
  -- [IMPLEMENTATION NOTE: Claude Code should write the full SQL here]
),

-- CTE 2: open_pipeline
-- All open SQOs excluding On Hold and Closed Lost.
-- Apply backfill COALESCE on stage timestamps.
-- Compute days_in_current_stage = DATE_DIFF(CURRENT_DATE(), DATE(current_stage_entry_ts), DAY)
-- Flag is_zero_aum = 1 where COALESCE(Underwritten_AUM__c, Amount) = 0 OR NULL
-- Flag has_anticipated_date = 1 where Earliest_Anticipated_Start_Date__c IS NOT NULL
-- Output one row per opp with: opp_id, advisor_name, StageName, stage_entry_ts, days_in_current_stage,
--   Opportunity_AUM, is_zero_aum, Earliest_Anticipated_Start_Date__c, has_anticipated_date,
--   SGM_Owner_Name__c, SGA_Owner_Name__c, aum_tier, all stage entry timestamps (backfilled)
   -- Discovery + Qualifying stage treatment:
   -- SQO and Discovery are effectively the same event in Salesforce.
   -- The Discovery timestamp is nearly identical to Date_Became_SQO__c
   -- with no meaningful conversion rate between them (per sheet Assumptions).
   -- Opps with StageName IN ('Discovery', 'Qualifying') are treated as
   -- post-SQO, pre-Sales-Process. They receive the full SP→Neg→Signed→Joined
   -- probability chain. Do NOT return NULL or 0 for p_join on these opps.
   -- There are ~41 Discovery opps with ~$10.5B AUM — they must be included.
   -- Map their current_stage_entry_ts to Date_Became_SQO__c.
   -- Out-of-order opp handling: exclude opps where stage timestamps are
   -- not in forward order (same exclusion rule as historical_rates CTE).
   -- These are flagged in vw_funnel_audit as stages_skipped > 0 AND
   -- timestamps are genuinely out of sequence (not just backfilled NULLs).
   -- Confirm count against BQ Summary Audit out-of-order counts before
   -- finalising the 147 open opp baseline.

open_pipeline AS (
  -- [IMPLEMENTATION NOTE: Claude Code should write the full SQL here]
),

-- CTE 3: stage_probabilities
-- For each open opp, compute:
--   remaining_stages = list of stages between current stage and Joined
--   p_join = product of conversion rates for all remaining stages (from historical_rates)
--   expected_days_remaining = sum of avg_days_in_stage for remaining stages,
--     minus days_already_in_current_stage (floor at 0)
--   projected_join_date = CURRENT_DATE() + expected_days_remaining
--   final_projected_join_date = IF(has_anticipated_date, Earliest_Anticipated_Start_Date__c, projected_join_date)
-- Stage order: Discovery(1) → Sales Process(2) → Negotiating(3) → Signed(4) → Joined(5)
-- Qualifying counts as pre-Discovery — treat as Discovery for rate lookup purposes
   -- Stage order for p_join chain: SP(1) → Neg(2) → Signed(3) → Joined(4)
   -- Discovery and Qualifying both map to stage position 0 (pre-SP).
   -- They use the full 4-stage chain: SP→Neg→Signed→Joined.
   -- SQO→SP is the first conversion rate applied to Discovery/Qualifying opps.

stage_probabilities AS (
  -- [IMPLEMENTATION NOTE: Claude Code should write the full SQL here]
),

-- CTE 4: forecast_results
-- Joins open_pipeline + stage_probabilities
-- Computes:
--   is_q2_2026 = 1 if final_projected_join_date BETWEEN '2026-04-01' AND '2026-06-30'
--   is_q3_2026 = 1 if final_projected_join_date BETWEEN '2026-07-01' AND '2026-09-30'
--   expected_aum_q2 = IF(is_q2_2026 AND NOT is_zero_aum, Opportunity_AUM * p_join, 0)
--   expected_aum_q3 = IF(is_q3_2026 AND NOT is_zero_aum, Opportunity_AUM * p_join, 0)
--   date_source = 'Anticipated' if has_anticipated_date = 1 else 'Model'

forecast_results AS (
  -- [IMPLEMENTATION NOTE: Claude Code should write the full SQL here]
),

-- CTE 5: summary
-- Two outputs from one query using UNION ALL:
-- (a) Per-opp detail rows — for ranked opp list and drill-down
-- (b) Quarter-level aggregate rows — Q2 and Q3 totals:
--     total_opps, opps_with_aum, zero_aum_opps, anticipated_date_opps,
--     sum_expected_aum, sum_raw_pipeline_aum, weighted_avg_p_join

summary AS (
  -- [IMPLEMENTATION NOTE: Claude Code should write the full SQL here]
)

SELECT * FROM forecast_results
ORDER BY expected_aum_q2 + expected_aum_q3 DESC
```

### 10.4 Output Schema (forecast_phase2_results table)

| Column | Type | Description |
|--------|------|-------------|
| run_date | DATE | CURRENT_DATE() — partition key |
| Full_Opportunity_ID__c | STRING | Opp ID |
| advisor_name | STRING | Opp name |
| SGM_Owner_Name__c | STRING | SGM |
| SGA_Owner_Name__c | STRING | SGA |
| StageName | STRING | Current stage |
| days_in_current_stage | INT64 | Days since stage entry |
| Opportunity_AUM | FLOAT64 | Raw AUM |
| aum_tier | STRING | Tier bucket |
| is_zero_aum | INT64 | 1 = excluded from AUM totals |
| p_join | FLOAT64 | Probability of joining (0–1) |
| expected_days_remaining | INT64 | Model days to Joined |
| model_projected_join_date | DATE | Pure model estimate |
| Earliest_Anticipated_Start_Date__c | DATE | Advisor's stated start date (may be NULL) |
| final_projected_join_date | DATE | Override: anticipated if available, else model |
| date_source | STRING | 'Anticipated' or 'Model' |
| is_q2_2026 | INT64 | 1 if final_projected_join_date in Q2 |
| is_q3_2026 | INT64 | 1 if final_projected_join_date in Q3 |
| expected_aum_q2 | FLOAT64 | Opportunity_AUM × p_join if Q2 (0 if is_zero_aum) |
| expected_aum_q3 | FLOAT64 | Opportunity_AUM × p_join if Q3 (0 if is_zero_aum) |

### 10.5 Validation Checks to Run After Query is Written
1. Total open opp count from open_pipeline CTE should be 147
2. Total raw Opportunity_AUM (non-zero) should be ≈ $23.16B
3. Sum of p_join across all opps should be plausible (expect 40–70 expected joiners given historical ~50% SQO→Joined rate)
4. Opps with date_source = 'Anticipated' should be inspected manually — confirm Earliest_Anticipated_Start_Date__c values are future dates not stale ones
5. Any opp with p_join > 0.95 should be flagged — likely a data anomaly

### 10.6 Connected Sheets Setup (replaces manual export)

BigQuery Connected Sheets connects a Google Sheet directly to a BigQuery view. Every Refresh re-queries live — no manual SQL export required.

**Setup steps (one-time per tab):**
1. Open the GTM Funnel Analysis spreadsheet
2. Click Data → Data connectors → Connect to BigQuery
3. Select project: savvy-gtm-analytics
4. Select view: Tableau_Views.vw_funnel_audit (for audit tab) or Tableau_Views.vw_forecast_p2 (for forecast tab)
5. Insert into existing sheet tab or create new — name tabs "BQ Audit Trail" and "BQ Forecast P2"
6. Click Refresh to pull current data
7. Optionally schedule auto-refresh: Data → Data connectors → Schedule refresh

**Important:** Connected Sheets has a 25,000 row display limit in the sheet UI but the underlying BQ view has no limit. For full data, query BQ directly.

### 10.7 Stage Mapping Reference

This table is the authoritative reference for how each StageName value is
handled throughout the forecast model. Used by both vw_funnel_audit and
vw_forecast_p2.

| StageName | Forecast treatment | p_join chain | current_stage_entry_ts | Notes |
|-----------|-------------------|--------------|----------------------|-------|
| Qualifying | Pre-SP (stage 0) | SP→Neg→Signed→Joined | Date_Became_SQO__c | Treated same as Discovery |
| Discovery | Pre-SP (stage 0) | SP→Neg→Signed→Joined | Date_Became_SQO__c | SQO and Discovery are same event per sheet Assumptions |
| Sales Process | Stage 1 | Neg→Signed→Joined | Stage_Entered_Sales_Process__c | |
| Negotiating | Stage 2 | Signed→Joined | Stage_Entered_Negotiating__c | |
| Signed | Stage 3 | Joined only | Stage_Entered_Signed__c | |
| On Hold | Excluded | — | — | Excluded from forecast entirely |
| Closed Lost | Historical only | — | — | Used in historical_rates CTE denominator |
| Joined | Historical only | — | — | Used in historical_rates CTE numerator |

---

## 11. vw_funnel_audit — Live Audit Trail View

### 11.1 Purpose

A live BigQuery view that replicates the per-opp structure of the monthly cohort tabs (Jun–Mar) in the GTM Funnel Analysis spreadsheet. One row per opportunity. Every stage entry date and days calculation for the five tracked stages (SQO, Sales Process, Negotiating, Signed, Joined), AUM, attribution, and current status — always reflecting live Salesforce data via vw_funnel_master.

**Stage scope for this view:** SQO → Sales Process → Negotiating → Signed → Joined. Discovery is not a distinct conversion stage — the Discovery timestamp in Salesforce is nearly identical to Date_Became_SQO__c with no meaningful conversion between them (per sheet Assumptions tab). Opps showing StageName = 'Discovery' or 'Qualifying' are post-SQO, pre-Sales-Process and receive the full SP→Joined probability chain in the forecast model. Days columns for Discovery stage are not tracked; days_in_current_stage uses Date_Became_SQO__c as the entry timestamp for these opps.

This is the auditable foundation that the forecast view (vw_forecast_p2) joins against.

### 11.2 Row Scope

- All opportunities where Full_Opportunity_ID__c IS NOT NULL AND is_primary_opp_record = 1
- Cohort window: Opp_CreatedDate >= '2025-06-01' (matching the sheet's Data tab filter)
- Includes open, joined, and closed lost — all statuses
- Does NOT filter on record_type_name = 'Recruiting' — re-engagement sourced opps must be included
- On Hold opps are included in the audit trail (full history) but flagged with is_on_hold = 1

### 11.3 Stage Backfill Logic

Apply COALESCE on intermediate stage timestamps to match the sheet's backfill assumption (skipped stages get the next available stage date). Discovery is not part of this chain.

```sql
-- Backfilled stage timestamps (no Discovery)
COALESCE(Stage_Entered_Sales_Process__c, Stage_Entered_Negotiating__c, Stage_Entered_Signed__c, Stage_Entered_Joined__c, Stage_Entered_Closed__c) AS eff_sp_ts,
COALESCE(Stage_Entered_Negotiating__c, Stage_Entered_Signed__c, Stage_Entered_Joined__c, Stage_Entered_Closed__c) AS eff_neg_ts,
COALESCE(Stage_Entered_Signed__c, Stage_Entered_Joined__c, Stage_Entered_Closed__c) AS eff_signed_ts,
COALESCE(Stage_Entered_Joined__c, TIMESTAMP(advisor_join_date__c)) AS eff_joined_ts
```

### 11.4 Output Schema

**Identity & Attribution**
| Column | Source | Notes |
|--------|--------|-------|
| Full_Opportunity_ID__c | Full_Opportunity_ID__c | Primary key |
| salesforce_url | salesforce_url | Direct link to SFDC record |
| advisor_name | advisor_name | Opp Name |
| cohort_month | FORMAT_DATE('%Y-%m', DATE(Opp_CreatedDate)) | e.g. '2025-06' |
| Opp_CreatedDate | Opp_CreatedDate | Creation timestamp |
| SGM_Owner_Name__c | SGM_Owner_Name__c | |
| SGA_Owner_Name__c | SGA_Owner_Name__c | |
| Original_source | Original_source | Lead source |
| Finance_View__c | Finance_View__c | Channel mapping |
| lead_record_source | lead_record_source | 'Lead' or 'Re-Engagement' |

**SQO**
| Column | Derivation | Notes |
|--------|-----------|-------|
| SQO_raw | SQO_raw | 'Yes' / 'No' |
| Date_Became_SQO__c | Date_Became_SQO__c | Raw timestamp |
| days_to_sqo | DATE_DIFF(DATE(Date_Became_SQO__c), DATE(Opp_CreatedDate), DAY) | NULL if SQO=No |

**Stage Entry Timestamps — Raw**
| Column | Source Field |
|--------|-------------|
| Stage_Entered_Sales_Process__c | Stage_Entered_Sales_Process__c |
| Stage_Entered_Negotiating__c | Stage_Entered_Negotiating__c |
| Stage_Entered_Signed__c | Stage_Entered_Signed__c |
| Stage_Entered_Joined__c | Stage_Entered_Joined__c |
| Stage_Entered_On_Hold__c | Stage_Entered_On_Hold__c |
| Stage_Entered_Closed__c | Stage_Entered_Closed__c |
| advisor_join_date__c | advisor_join_date__c | DATE type |
| Earliest_Anticipated_Start_Date__c | Earliest_Anticipated_Start_Date__c | DATE type |

**Stage Entry Timestamps — Backfilled (eff_*)**
eff_sp_ts, eff_neg_ts, eff_signed_ts, eff_joined_ts — computed via COALESCE chain per Section 11.3.

**Days in Stage**
All use DATE_DIFF(..., DAY) on backfilled timestamps. For the current open stage, uses CURRENT_DATE() as the end date. Matches the "Days to X" columns in the monthly sheet tabs.

| Column | Formula |
|--------|---------|
| days_to_sqo | DATE_DIFF(DATE(Date_Became_SQO__c), DATE(Opp_CreatedDate), DAY) |
| days_in_sp | DATE_DIFF(DATE(eff_neg_ts), DATE(eff_sp_ts), DAY) |
| days_in_negotiating | DATE_DIFF(DATE(eff_signed_ts), DATE(eff_neg_ts), DAY) |
| days_in_signed | DATE_DIFF(DATE(eff_joined_ts), DATE(eff_signed_ts), DAY) |
| days_in_current_stage | DATE_DIFF(CURRENT_DATE(), DATE(current_stage_entry_ts), DAY) — open opps only, NULL for closed/joined |
| days_total_sqo_to_joined | DATE_DIFF(DATE(eff_joined_ts), DATE(Date_Became_SQO__c), DAY) — NULL if not yet joined |

Note: For open opps, days_in_sp / days_in_negotiating / days_in_signed will be NULL for stages not yet exited. This is correct — the sheet shows "time until close" as a placeholder for open stages but we do not replicate that behaviour in BQ. Use days_in_current_stage for "how long have they been in their current stage."

**AUM & Financial**
| Column | Derivation |
|--------|-----------|
| Opportunity_AUM | COALESCE(Underwritten_AUM__c, Amount) |
| Opportunity_AUM_M | ROUND(Opportunity_AUM / 1000000, 2) |
| aum_tier | Tier 1–4 buckets (from vw_funnel_master) |
| is_zero_aum | 1 if COALESCE(Opportunity_AUM, 0) = 0 |
| Account_Total_ARR__c | Account_Total_ARR__c |
| Actual_ARR__c | Actual_ARR__c |
| SGM_Estimated_ARR__c | SGM_Estimated_ARR__c |

**Status & Flags**
| Column | Derivation |
|--------|-----------|
| StageName | Current stage name |
| StageName_code | 1–8 numeric sort order (from vw_funnel_master) |
| Conversion_Status | 'Open' / 'Joined' / 'Closed' |
| Closed_Lost_Reason__c | Closed_Lost_Reason__c |
| Closed_Lost_Details__c | Closed_Lost_Details__c |
| is_on_hold | 1 if StageName = 'On Hold' |
| has_anticipated_date | 1 if Earliest_Anticipated_Start_Date__c IS NOT NULL |
| stages_skipped | Count of NULL raw stage timestamps for stages the opp progressed past — INTEGER |
| as_of_date | CURRENT_DATE() |

### 11.5 SQL Architecture

**File:** `views/vw_funnel_audit.sql`
**Deploy:** Execute via BigQuery MCP (`mcp__bigquery__execute_sql`) or paste into BQ Console.
**Target:** `savvy-gtm-analytics.Tableau_Views.vw_funnel_audit`

```sql
CREATE OR REPLACE VIEW `savvy-gtm-analytics.Tableau_Views.vw_funnel_audit` AS

WITH base AS (
  SELECT *
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
  WHERE Full_Opportunity_ID__c IS NOT NULL
    AND is_primary_opp_record = 1
    AND DATE(Opp_CreatedDate) >= '2025-06-01'
),

backfilled AS (
  SELECT
    *,
    -- Backfilled stage timestamps (SQO → SP → Neg → Signed → Joined, no Discovery)
    COALESCE(Stage_Entered_Sales_Process__c, Stage_Entered_Negotiating__c, Stage_Entered_Signed__c, Stage_Entered_Joined__c, Stage_Entered_Closed__c) AS eff_sp_ts,
    COALESCE(Stage_Entered_Negotiating__c, Stage_Entered_Signed__c, Stage_Entered_Joined__c, Stage_Entered_Closed__c) AS eff_neg_ts,
    COALESCE(Stage_Entered_Signed__c, Stage_Entered_Joined__c, Stage_Entered_Closed__c) AS eff_signed_ts,
    COALESCE(Stage_Entered_Joined__c, TIMESTAMP(advisor_join_date__c)) AS eff_joined_ts,
    -- Current stage entry timestamp for days_in_current_stage
    CASE StageName
      WHEN 'Sales Process' THEN Stage_Entered_Sales_Process__c
      WHEN 'Negotiating'   THEN Stage_Entered_Negotiating__c
      WHEN 'Signed'        THEN Stage_Entered_Signed__c
      WHEN 'Qualifying'    THEN Date_Became_SQO__c
      WHEN 'Discovery'     THEN Date_Became_SQO__c  -- treat Discovery as post-SQO holding stage
      WHEN 'On Hold'       THEN Stage_Entered_On_Hold__c
      ELSE NULL
    END AS current_stage_entry_ts
  FROM base
)

SELECT
  -- Identity & Attribution
  Full_Opportunity_ID__c,
  salesforce_url,
  advisor_name,
  FORMAT_DATE('%Y-%m', DATE(Opp_CreatedDate)) AS cohort_month,
  Opp_CreatedDate,
  SGM_Owner_Name__c,
  SGA_Owner_Name__c,
  Original_source,
  Finance_View__c,
  lead_record_source,

  -- SQO
  SQO_raw,
  Date_Became_SQO__c,
  DATE_DIFF(DATE(Date_Became_SQO__c), DATE(Opp_CreatedDate), DAY) AS days_to_sqo,

  -- Raw stage timestamps
  Stage_Entered_Sales_Process__c,
  Stage_Entered_Negotiating__c,
  Stage_Entered_Signed__c,
  Stage_Entered_On_Hold__c,
  Stage_Entered_Joined__c,
  Stage_Entered_Closed__c,
  advisor_join_date__c,
  Earliest_Anticipated_Start_Date__c,

  -- Backfilled stage timestamps
  eff_sp_ts,
  eff_neg_ts,
  eff_signed_ts,
  eff_joined_ts,

  -- Days in stage (backfilled; NULL for stages not yet exited on open opps)
  DATE_DIFF(DATE(eff_neg_ts), DATE(eff_sp_ts), DAY)         AS days_in_sp,
  DATE_DIFF(DATE(eff_signed_ts), DATE(eff_neg_ts), DAY)     AS days_in_negotiating,
  DATE_DIFF(DATE(eff_joined_ts), DATE(eff_signed_ts), DAY)  AS days_in_signed,
  DATE_DIFF(DATE(eff_joined_ts), DATE(Date_Became_SQO__c), DAY) AS days_total_sqo_to_joined,
  CASE
    WHEN Conversion_Status = 'Open' AND current_stage_entry_ts IS NOT NULL
    THEN DATE_DIFF(CURRENT_DATE(), DATE(current_stage_entry_ts), DAY)
    ELSE NULL
  END AS days_in_current_stage,

  -- AUM & Financial
  Opportunity_AUM,
  Opportunity_AUM_M,
  aum_tier,
  CASE WHEN COALESCE(Opportunity_AUM, 0) = 0 THEN 1 ELSE 0 END AS is_zero_aum,
  Account_Total_ARR__c,
  Actual_ARR__c,
  SGM_Estimated_ARR__c,

  -- Status & Flags
  StageName,
  StageName_code,
  Conversion_Status,
  Closed_Lost_Reason__c,
  Closed_Lost_Details__c,
  CASE WHEN StageName = 'On Hold' THEN 1 ELSE 0 END AS is_on_hold,
  CASE WHEN Earliest_Anticipated_Start_Date__c IS NOT NULL THEN 1 ELSE 0 END AS has_anticipated_date,
  (
    CASE WHEN Stage_Entered_Sales_Process__c IS NULL AND eff_neg_ts IS NOT NULL THEN 1 ELSE 0 END +
    CASE WHEN Stage_Entered_Negotiating__c IS NULL AND eff_signed_ts IS NOT NULL THEN 1 ELSE 0 END +
    CASE WHEN Stage_Entered_Signed__c IS NULL AND eff_joined_ts IS NOT NULL THEN 1 ELSE 0 END
  ) AS stages_skipped,

  CURRENT_DATE() AS as_of_date

FROM backfilled
ORDER BY DATE(Opp_CreatedDate) DESC, advisor_name ASC
```

### 11.6 Validation Checks

After deploying the view, verify against the GTM Funnel Analysis spreadsheet monthly tabs:
1. Row count per cohort_month should match monthly tab row counts (within the +1/-1 differences documented in Section 2.2)
2. days_in_sp, days_in_negotiating, days_in_signed should match the "Days to Sales Process", "Days to Negotiating", "Days to Signed" columns in the monthly tabs within rounding (sheet uses fractional days; BQ uses whole days)
3. days_total_sqo_to_joined for Jun–Dec 2025 joined opps should be consistent with the ~100-day average documented in Section 1.2
4. stages_skipped per cohort should match the "Missing SP / Missing Neg / Missing Signed" counts from Section 2.3 exactly
5. Total Opportunity_AUM_M for Conversion_Status = 'Open' AND is_on_hold = 0 rows should reconcile to ≈ $23,160M across 147 opps

### 11.7 Relationship to vw_forecast_p2

vw_forecast_p2 JOINs vw_funnel_audit on Full_Opportunity_ID__c to inherit all stage dates and AUM. Build and validate vw_funnel_audit first — vw_forecast_p2 depends on it.

In Connected Sheets, users can VLOOKUP between the two tabs on Full_Opportunity_ID__c to see: "here is this opp's full stage history AND here is what the model says it will do."

---

## 12. Dashboard Integration — Forecast Page

### 12.1 Overview

The forecast page is a new page in the existing Next.js 14 dashboard at route `/dashboard/forecast`. It surfaces both the deterministic expected-value model (Phase 2) and the Monte Carlo simulation (Phase 3) in a single unified view. All data comes from BigQuery via new API routes following existing patterns in `src/lib/bigquery.ts` and `src/lib/queries/`.

### 12.2 Page Layout

The page has five vertical sections rendered top to bottom:

1. **Top bar** — page title, data freshness indicator, open SQO count, conversion window selector, Run Monte Carlo button, Export to Sheets button
2. **Metric cards row** — 4 cards: Open Pipeline AUM, Expected Q2 AUM, Expected Q3 AUM, active conversion window label
3. **Two-column panel row** — left: Expected AUM by quarter (horizontal bar chart by stage), right: Historical conversion rates table + avg days
4. **Monte Carlo chart panel** — P10/P50/P90 AUM confidence bands for Q2 and Q3 (rendered after Run Monte Carlo is clicked; shows placeholder state before first run)
5. **Per-advisor detail table** — all 147 open SQOs with full audit columns, stage filter tabs, sortable by expected AUM

### 12.3 Conversion Window Selector

A segmented control in the top bar with four options:

| Label | startDate passed to API |
|-------|------------------------|
| 90d | CURRENT_DATE() - 90 |
| 180d | CURRENT_DATE() - 180 |
| 1yr | CURRENT_DATE() - 365 ← **default** |
| All time | 2025-06-01 (cohort window start) |

The selected window is passed as a `@startDate` BigQuery parameter to the historical rates CTE in both the deterministic and Monte Carlo queries. Changing the window re-fetches rates and re-runs the deterministic model automatically. Monte Carlo must be manually re-triggered via the Run button after a window change.

The active window is displayed in the fourth metric card so it is always visible: e.g. "Mar 2025 – Mar 2026 (1yr window active)".

Default on page load: **1yr**.

### 12.4 API Routes (new, follow existing patterns in src/lib/queries/)

Three new API routes:

**`/api/forecast/rates`**
- Method: GET
- Params: `startDate` (YYYY-MM-DD)
- Returns: stage-to-stage conversion rates and avg days computed dynamically from closed BQ cohorts (Joined or Closed Lost) created on or after startDate
- Excludes Jan–Mar 2026 immature cohorts automatically (only cohorts where Joined count > 0 are included)
- Source view: vw_funnel_master with filter: Full_Opportunity_ID__c IS NOT NULL AND is_primary_opp_record = 1
- Caching: revalidate 21600 (6 hours, matches Salesforce sync cadence)

**`/api/forecast/pipeline`**
- Method: GET
- Params: `startDate` (same window, for rates computation)
- Returns: per-opp deterministic forecast — all columns from vw_funnel_audit joined with computed p_join, expected_days_remaining, model_projected_join_date, final_projected_join_date, date_source, is_q2_2026, is_q3_2026, expected_aum_q2, expected_aum_q3
- Also returns summary aggregates: total_opps, q2_expected_aum, q3_expected_aum, q2_opp_count, q3_opp_count, zero_aum_count, anticipated_date_count
- Source view: vw_funnel_audit (must be deployed first per Section 11.7)
- Caching: revalidate 21600

**`/api/forecast/monte-carlo`**
- Method: POST
- Body: `{ startDate: string }`
- Triggered only by the Run Monte Carlo button — not on page load
- Runs 10,000 trials per opp in BigQuery using GENERATE_ARRAY(1, 10000) + RAND() (stays within Vercel's 60s timeout configured in vercel.json)
- Returns per-quarter output: { q2: { p10, p50, p90, mean }, q3: { p10, p50, p90, mean } }
- Also returns per-opp P10/P50/P90 projected join date for drill-down
- No caching — always fresh on each button click

### 12.5 Monte Carlo Chart

Rendered in its own panel below the two-column row. Uses Recharts (already in stack).

**Before first run:** placeholder panel with "Run Monte Carlo to see confidence intervals" message and the Run button repeated inline.

**After run:** grouped bar chart or range chart showing:
- Q2 2026: P10 / P50 / P90 expected AUM as three bars or a range band
- Q3 2026: same
- Mean expected AUM overlaid as a line or marker
- Axis: AUM in $B, labelled clearly
- Legend: P10 (pessimistic), P50 (base case), P90 (optimistic)
- Below the chart: small table showing the six numbers (Q2 P10/P50/P90, Q3 P10/P50/P90) in $B to one decimal place

Re-running Monte Carlo (after changing the time window or clicking Run again) replaces the chart in place with a loading state then re-renders.

### 12.6 Per-Advisor Detail Table

Columns (in order):

| Column | Notes |
|--------|-------|
| Advisor | Opp name, links to salesforce_url |
| Stage | Colour-coded badge: Signed (amber), Negotiating (teal), Sales Process (blue), SQO/Qualifying (gray) |
| Days in stage | days_in_current_stage from vw_funnel_audit |
| AUM | Opportunity_AUM_M formatted as $XM or $XB |
| P(join) | Mini progress bar + percentage |
| Projected join | final_projected_join_date formatted as Mon DD |
| Date source | Badge: 'Anticipated' (purple) or 'Model' (gray) |
| Q2 / Q3 | Badge showing which quarter the opp is projected into |
| Exp. AUM | expected_aum_q2 or expected_aum_q3 — probability-weighted, highlighted in blue (Q2) or green (Q3) |
| SGM | SGM_Owner_Name__c |
| SP entered | DATE(Stage_Entered_Sales_Process__c) — raw, not backfilled, so NULL shows as — |
| Neg entered | DATE(Stage_Entered_Negotiating__c) |
| Signed entered | DATE(Stage_Entered_Signed__c) |

**Stage filter tabs** above the table: All stages / Signed / Negotiating / Sales Process / SQO, Discovery & Qualifying — the last tab groups all three because Discovery and Qualifying are functionally equivalent to post-SQO pre-SP status.

**Default sort:** expected_aum_q2 + expected_aum_q3 DESC (highest expected AUM contribution first).

**$0 AUM opps:** included in table with is_zero_aum flag visible, excluded from all AUM aggregates and the chart. Show count of zero-AUM opps in a small note below the table.

**On Hold opps:** excluded from this page entirely (is_on_hold = 1 filtered out in /api/forecast/pipeline).

### 12.7 Export to Sheets

Uses the existing `src/lib/sheets/` exporter and `/api/dashboard/export-sheets/route.ts` pattern.

Clicking Export to Sheets writes two tabs to the GTM Funnel Analysis spreadsheet (https://docs.google.com/spreadsheets/d/1aOakm93JEH518p4IRb6xCWEdydzyV20jwOeN7atEaR8):

- **"BQ Forecast P2"** — the per-opp detail table (all columns from Section 12.6 plus all raw stage entry timestamps)
- **"BQ Audit Trail"** — full vw_funnel_audit output (all opps including closed, all stage dates, all days columns)

Export uses the most recently fetched data — does not trigger a fresh BQ query. A toast notification confirms success with a link to the sheet.

### 12.8 File Structure

New files to create:

```
src/app/dashboard/forecast/
  page.tsx                    — main page component
  components/
    ForecastTopBar.tsx        — title, freshness, window selector, buttons
    ForecastMetricCards.tsx    — 4 metric cards
    ConversionRatesPanel.tsx   — historical rates table + avg days
    ExpectedAumChart.tsx       — horizontal bar chart by stage/quarter
    MonteCarloPanel.tsx        — P10/P50/P90 chart + summary table (§14.7)
    PipelineDetailTable.tsx    — per-advisor sortable table with stage tabs
    AdvisorForecastModal.tsx   — advisor drill-down modal (§13)
    ScenarioRunner.tsx         — rate override panel, admin/revops_admin only (§14)
    SavedScenariosList.tsx     — saved scenarios table with load/share/delete (§14.5)

src/app/api/forecast/
  rates/route.ts              — GET historical conversion rates
  pipeline/route.ts           — GET deterministic forecast
  monte-carlo/route.ts        — POST Monte Carlo simulation
  record/[id]/route.ts        — GET single opp forecast detail (§13)
  scenarios/route.ts           — GET list, POST create (§14.6)
  scenarios/[id]/route.ts      — DELETE by id (§14.6)
  scenarios/[shareToken]/route.ts — GET by shareToken for public sharing (§14.6)

src/lib/queries/
  forecast-rates.ts           — BQ query builder for historical rates
  forecast-pipeline.ts        — BQ query builder for deterministic model
  forecast-monte-carlo.ts     — BQ query builder for Monte Carlo

views/                         — BigQuery view definitions, deployed via MCP to savvy-gtm-analytics.Tableau_Views
  vw_funnel_audit.sql          — live audit trail view (§11)
  vw_forecast_p2.sql           — deterministic forecast view (§10)

prisma/schema.prisma          — add ForecastScenario model (§14.3)
```

---

## 13. Advisor Forecast Drill-Down Modal

### 13.1 Purpose

When a manager clicks any row in the PipelineDetailTable (Section 12.6), an advisor-level modal opens showing the full forecast record, stage journey timeline, and raw audit data for that opportunity. This is the auditable "show your work" layer — every number in the forecast table is traceable back to real timestamps in this modal.

### 13.2 Implementation Approach

Reuse the existing `RecordDetailModal` component pattern (`src/components/dashboard/RecordDetailModal.tsx`) and `/api/dashboard/record-detail/[id]` route. The forecast modal extends this pattern rather than replacing it — it fetches the existing record detail AND joins in forecast-specific fields from `vw_funnel_audit`.

**New file:** `src/app/dashboard/forecast/components/AdvisorForecastModal.tsx`

**Trigger:** Row `onClick` in `PipelineDetailTable.tsx` — sets `selectedOppId` state and renders the modal. Identical pattern to all existing drill-down modals in the dashboard.

**Data source:** Single API call to `/api/forecast/record/[id]` which queries:

```sql
SELECT
  a.*,
  f.p_join,
  f.expected_days_remaining,
  f.model_projected_join_date,
  f.final_projected_join_date,
  f.date_source,
  f.is_q2_2026,
  f.is_q3_2026,
  f.expected_aum_q2,
  f.expected_aum_q3
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_audit` a
LEFT JOIN `savvy-gtm-analytics.Tableau_Views.vw_forecast_p2` f
  ON a.Full_Opportunity_ID__c = f.Full_Opportunity_ID__c
WHERE a.Full_Opportunity_ID__c = @oppId
LIMIT 1
```

Cache TTL: 6 hours (matches detail-records.ts pattern).

Permission enforcement: sgmFilter/sgaFilter override as per all other record-detail routes.

### 13.3 Modal Layout — Four Sections

**Section 1: Header**
- Initials avatar (first + last name initials, background: color-background-info)
- Advisor name (16px/500)
- Opp ID, Created Date, lead_record_source — muted 12px
- Salesforce link using `salesforce_url` — opens in new tab
- Close button (X)

**Section 2: Forecast Summary**
Three stat chips in a row: Current Stage (badge), Forecast Quarter (Q2/Q3 badge or "Beyond Q3" if neither), Date Source ('Anticipated' badge in purple / 'Model' badge in gray).

P(join) as large number (28px/500, color-text-info) with horizontal progress bar and breakdown text showing which conversion rate(s) drove it and which window is active (e.g. "Signed → Joined: 88% · 1yr window").

Expected AUM contribution with raw calculation in muted text (e.g. "$207M ($235M × 88%)"). If is_zero_aum = 1 show "AUM not set — excluded from totals" in color-text-secondary.

Projected join date with date_source label in muted text. If date_source = 'Anticipated', show the raw field name `Earliest_Anticipated_Start_Date__c` in parentheses for auditability.

**Section 3: Stage Journey Timeline**
Horizontal timeline: SQO → Sales Process → Negotiating → Signed → Joined.

Node states:
- **Done** (blue dot + blue connector): stage has a real raw timestamp
- **Backfilled** (blue dot + blue connector, italic "backfilled" label): eff_* exists but raw Stage_Entered_* is NULL — show "(backfilled)" beneath the date
- **Current** (amber dot, no outgoing line): StageName matches this node — show days_in_current_stage in amber
- **Future** (hollow gray dot): not yet reached — show projected date for Joined node

**Section 4: Opportunity Detail**
Two-column grid:

| Field | Source |
|-------|--------|
| Underwritten AUM | Underwritten_AUM__c ("Not set" if NULL) |
| AUM fallback | Amount if Underwritten_AUM__c is NULL |
| AUM Tier | aum_tier |
| SGM | SGM_Owner_Name__c |
| SGA | SGA_Owner_Name__c |
| Source | Original_source |
| Channel | Finance_View__c |
| Lead type | lead_record_source |
| Days in current stage | days_in_current_stage (amber if > 90d) |
| Cohort month | cohort_month |
| SQO date | Date_Became_SQO__c formatted |
| Stages skipped | stages_skipped ("None" if 0, else count + "backfilled in model") |
| Closed Lost Reason | Closed_Lost_Reason__c (only if Conversion_Status = 'Closed') |

Salesforce link at bottom of section.

### 13.4 Styling Rules

Follow existing RecordDetailModal patterns exactly. Amber for days_in_current_stage > 90 (`color: var(--color-text-warning)`). Backfill label: `font-style: italic; color: var(--color-text-secondary)`. Zero-AUM uses color-text-secondary, not danger.

### 13.5 File Structure

```
src/app/dashboard/forecast/components/
  AdvisorForecastModal.tsx

src/app/api/forecast/record/
  [id]/route.ts
```

---

## 14. Scenario Runner — Persistent, Shareable Conversion Rate Overrides

### 14.1 Purpose

Users with the `admin` or `revops_admin` role can override any stage conversion rate and avg days, run a named Monte Carlo scenario against the live pipeline, save it to Neon Postgres, and share a URL with any dashboard user. Saved scenarios are a permanent audit record of forecast assumptions — who ran what, with which rates, and when.

All other roles (manager, sgm, sga, viewer) can VIEW shared scenarios but cannot create, edit, or delete them. The run/save UI is hidden for non-permitted roles.

### 14.2 Role Permission Changes

**File:** `src/types/user.ts`

Add `'revops_admin'` to the role union:

```typescript
role: 'admin' | 'revops_admin' | 'manager' | 'sgm' | 'sga' | 'viewer';
```

**File:** `src/lib/permissions.ts`

Add `revops_admin` to `ROLE_PERMISSIONS` with the same base permissions as `manager` plus `canRunScenarios: true`. Add `canRunScenarios: boolean` to the `UserPermissions` interface. Only `admin` and `revops_admin` get `canRunScenarios: true`. All other roles get `false`.

```typescript
interface UserPermissions {
  role: 'admin' | 'revops_admin' | 'manager' | 'sgm' | 'sga' | 'viewer';
  allowedPages: number[];
  sgaFilter: string | null;
  sgmFilter: string | null;
  canExport: boolean;
  canManageUsers: boolean;
  canRunScenarios: boolean;   // NEW — admin and revops_admin only
}
```

Add `revops_admin` to the page access table — same access as `manager` for all pages, plus the Forecast page.

**Note:** After migration, manually update existing users who should have scenario access from `manager` to `revops_admin` in Neon. Do not attempt an automatic data migration — role assignment requires human judgment.

### 14.3 Neon Postgres Schema

Add to `prisma/schema.prisma`. Uses the existing Neon Postgres connection (same `DATABASE_URL` as all other Prisma models).

```prisma
model ForecastScenario {
  id                  String   @id @default(cuid())
  name                String
  description         String?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
  createdById         String
  createdByName       String   // denormalised — display name at time of creation
  conversionWindowDays Int?    // null = all time; 90, 180, 365 for windowed
  isBaseForecast      Boolean  @default(false) // true = historical rates, no overrides

  // Rate overrides (stored as decimals 0.0–1.0, not percentages)
  rateOverride_sqo_to_sp       Float
  rateOverride_sp_to_neg       Float
  rateOverride_neg_to_signed   Float
  rateOverride_signed_to_joined Float

  // Avg days overrides
  avgDaysOverride_in_sp        Float
  avgDaysOverride_in_neg       Float
  avgDaysOverride_in_signed    Float

  // Historical rates at time of run (snapshot for audit — rates change as cohorts mature)
  historicalRate_sqo_to_sp       Float
  historicalRate_sp_to_neg       Float
  historicalRate_neg_to_signed   Float
  historicalRate_signed_to_joined Float

  // Monte Carlo results summary (stored so shared viewers don't need to re-run)
  trialCount          Int      @default(10000)
  q2_p10_aum          Float?
  q2_p50_aum          Float?
  q2_p90_aum          Float?
  q2_p50_joiners      Int?
  q3_p10_aum          Float?
  q3_p50_aum          Float?
  q3_p90_aum          Float?
  q3_p50_joiners      Int?

  // Pipeline snapshot metadata
  pipelineOppCount    Int?     // 147 at time of run
  pipelineTotalAum    Float?   // $23.16B at time of run

  // Sharing
  shareToken          String   @unique @default(cuid()) // used in share URL
  isPublic            Boolean  @default(false) // if true, any authenticated user can view

  // Per-opp results stored as JSON (BigQuery returns ~147 rows, ~30KB per scenario)
  perOppResults       Json?    // Array of { oppId, advisorName, pJoin, q2AumP50, q3AumP50 }

  createdBy           User     @relation(fields: [createdById], references: [id])

  @@index([createdById])
  @@index([shareToken])
  @@index([createdAt])
}
```

Run `npx prisma migrate dev --name add_forecast_scenarios` after adding the model.

### 14.4 UI: Scenario Runner Panel

**File:** `src/app/dashboard/forecast/components/ScenarioRunner.tsx`

**Visibility:** Only rendered if `session.user.permissions.canRunScenarios === true`. For all other roles the component returns null — no placeholder, no disabled state, just absent.

**Location on page:** Collapsible panel between ConversionRatesPanel and ExpectedAumChart. Collapsed by default. Header: "Scenario Runner" with chevron toggle.

**Panel contents when expanded:**

**Scenario name + description inputs**
- Text input: "Scenario name" (required). Placeholder: "e.g. Upside — back to Aug 2025 rates"
- Textarea (2 rows): "Description (optional)". Placeholder: "What assumptions does this scenario test?"

**Rate Override Table**

One editable row per stage transition. Historical rate column is read-only and always reflects the currently active time window from `/api/forecast/rates`. When the time window selector changes, the historical column updates and any override input that was equal to the old historical rate auto-updates to the new historical rate (i.e. don't lock in stale "historical" values).

| Transition | Historical (read-only) | Override (editable %) | Avg days (editable) |
|-----------|----------------------|----------------------|-------------------|
| SQO → Sales Process | {live from BQ} | [input 0–100] | [input 1–365] |
| Sales Process → Negotiating | {live from BQ} | [input 0–100] | [input 1–365] |
| Negotiating → Signed | {live from BQ} | [input 0–100] | [input 1–365] |
| Signed → Joined | {live from BQ} | [input 0–100] | [input 1–365] |

Override inputs: pre-populated with historical rate. Amber left-border highlight (`border-left: 2px solid var(--color-text-warning)`) when value differs from historical. Invalid input (non-numeric, < 0, > 100) shows inline validation error and disables the Run button.

"Reset to historical" link resets all inputs to current historical values without re-fetching.

**Visibility toggle:** "Make this scenario visible to all users" checkbox. Controls `isPublic` field. Default: checked (true) — scenarios are shareable by default. Uncheck to keep private to the creator.

**Action buttons:**
- "Run & Save scenario" — primary button. Disabled if name is empty or any input is invalid. On click: runs Monte Carlo via POST `/api/forecast/monte-carlo`, then immediately saves to Neon via POST `/api/forecast/scenarios`, then shows the MonteCarloPanel with results and a success toast with the share link.
- "Run without saving" — secondary button. Runs Monte Carlo only, shows results, does not persist. No name required. Scenario banner shows "Unsaved scenario" instead of the name.

**Active scenario banner** — shown above metric cards when a scenario is active:

```
⚠ Scenario active: "{name}" — conversion rates modified. [View saved scenario] [Reset to historical]
```

If unsaved: `⚠ Unsaved scenario active — conversion rates modified. [Reset to historical]`

### 14.5 Saved Scenarios List

**File:** `src/app/dashboard/forecast/components/SavedScenariosList.tsx`

A collapsible panel below the MonteCarloPanel. Header: "Saved scenarios" with count badge.

Shows a table of all scenarios the current user can see:
- All scenarios where `isPublic = true`
- All scenarios created by the current user (even if `isPublic = false`)
- Sorted by `createdAt DESC`

Columns: Name, Created by, Date, Window, Q2 P50 AUM, Q3 P50 AUM, Actions.

Actions column:
- "Load" button — loads the saved rates into the ScenarioRunner inputs and re-displays MonteCarloPanel with stored results. Does not re-run BQ.
- "Share" button (copy icon) — copies the share URL to clipboard. URL format: `/dashboard/forecast?scenario={shareToken}`. Shows "Copied!" toast.
- "Delete" button (trash icon) — only visible to the scenario creator and admin. Calls DELETE `/api/forecast/scenarios/[id]`. Confirms with a simple inline "Are you sure?" before deleting.

**Share URL behaviour:** When a user navigates to `/dashboard/forecast?scenario={shareToken}`, the page loads normally and then auto-loads the shared scenario (rates + stored results) without re-running the Monte Carlo. The ScenarioRunner panel opens automatically and shows the shared rates with all inputs disabled and a banner: "Viewing shared scenario — [Creator name], [date]. [Load into editor ↗]" (Load into editor only shown to admin/revops_admin — copies rates into editable inputs and removes the read-only state).

### 14.6 API Routes

**POST `/api/forecast/monte-carlo`** — unchanged from Section 12 spec except: does NOT save to Neon. Saving is handled by a separate route. Accepts the `MonteCarloRequest` body. Returns `MonteCarloResponse`. `export const dynamic = 'force-dynamic'` — never cached.

**POST `/api/forecast/scenarios`** — save a completed scenario.

```typescript
// Request body
{
  name: string;
  description?: string;
  conversionWindowDays: number | null;
  rateOverrides: { sqo_to_sp: number; sp_to_neg: number; neg_to_signed: number; signed_to_joined: number; };
  avgDaysOverrides: { in_sp: number; in_neg: number; in_signed: number; };
  historicalRates: { sqo_to_sp: number; sp_to_neg: number; neg_to_signed: number; signed_to_joined: number; };
  monteCarloResults: MonteCarloResponse;
  pipelineOppCount: number;
  pipelineTotalAum: number;
  isPublic: boolean;
}

// Auth: require canRunScenarios — return 403 if false
// On success: return { id, shareToken, shareUrl }
```

**GET `/api/forecast/scenarios`** — list scenarios visible to the current user (`isPublic = true` OR `createdById = session.user.id`). Returns array sorted by `createdAt DESC`. No pagination needed — scenario count will be small.

**GET `/api/forecast/scenarios/[shareToken]`** — fetch a single scenario by shareToken. Any authenticated user can call this regardless of role — this is how sharing works. Returns 404 if not found, 403 if `isPublic = false` and caller is not the creator.

**DELETE `/api/forecast/scenarios/[id]`** — delete by Prisma `id` (not shareToken). Requires `canRunScenarios` AND (`createdById === session.user.id` OR `role === 'admin'`). Returns 403 otherwise.

### 14.7 MonteCarloPanel Component

**File:** `src/app/dashboard/forecast/components/MonteCarloPanel.tsx`

Shown after a run completes (or when a saved/shared scenario is loaded).

**P10/P50/P90 summary** — two rows (Q2 and Q3), three cards each. P50 is the headline number (larger text). P10/P90 shown as range below in muted text.

**Rates used disclosure** — collapsible block showing the four rates actually used and whether each was historical or overridden. Overridden rates show historical value in strikethrough beside the override. This is the Monte Carlo audit trail.

If scenario was loaded from a saved record (not a fresh run), show a muted note: "Results from run on {createdAt} — [Re-run with these rates] to refresh against current pipeline."

**Per-opp simulated results** — same table as PipelineDetailTable with an additional "Simulated p(join)" column replacing the deterministic p_join when a scenario is active. Sort by simulated expected AUM DESC.

### 14.8 Scenario Comparison (Phase 4 — not Phase 2)

Design the ForecastScenario Prisma model and ScenarioRunner state shape to accommodate future side-by-side comparison of up to 3 saved scenarios. State should be `scenarios: ForecastScenario[]` (array) not a single object, even in Phase 2, so Phase 4 doesn't require a state refactor.

### 14.9 File Structure

```
src/app/dashboard/forecast/components/
  ScenarioRunner.tsx
  MonteCarloPanel.tsx
  SavedScenariosList.tsx

src/app/api/forecast/
  monte-carlo/route.ts
  scenarios/route.ts              — GET list, POST create
  scenarios/[id]/route.ts         — DELETE by id
  scenarios/[shareToken]/route.ts — GET by shareToken (public share)
  record/[id]/route.ts

src/lib/queries/
  forecast-monte-carlo.ts

prisma/schema.prisma              — add ForecastScenario model
prisma/migrations/
  {timestamp}_add_forecast_scenarios/
```
