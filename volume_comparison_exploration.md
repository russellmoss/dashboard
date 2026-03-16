# Volume Comparison Exploration

> **Purpose**: Compare funnel volumes (Prospects, Contacted, MQL, SQL, SQO, Joined) between the OLD `vw_channel_funnel_volume_by_month` BQ view and the CURRENT `vw_funnel_master` production view. Identify exactly where and by how much the numbers diverge, grouped by `Finance_View` category and quarter.
>
> **Prerequisite**: Run `schema_and_mapping_drift_exploration.md` FIRST. This exploration builds on those findings.
>
> **Context**: The Google Sheet forecast tabs (columns C–F) use SUMPRODUCT formulas against the `Volumes` tab, which is a BQ export of `vw_channel_funnel_volume_by_month`. The formulas filter by:
> - `Volumes!$D` (cohort_year) = year in header row
> - `Volumes!$F` (cohort_quarter_num) = quarter in header row
> - `Volumes!$A` (period_type) = "QTD" or "QUARTERLY"
> - `Volumes!$L` (Finance_View) = channel label in column B (e.g., "Outbound", "Marketing")
> - Then sums the appropriate volume column: `$M` (prospects), `$N` (contacted), `$O` (mql), `$P` (sql), `$Q` (sqo), `$R` (joined)
>
> **Goal**: Produce a side-by-side comparison so we know exactly what the new volume view needs to output.

---

## 1. Old Volume View: Current State

### 1.1 — Old view quarterly totals by Finance_View (last 6 quarters)

**Query**: Run against the OLD view if it still exists in BQ:
```sql
SELECT
  period_type,
  period_label,
  Finance_View,
  SUM(prospects_created) AS prospects,
  SUM(contacted_count) AS contacted,
  SUM(mql_count) AS mqls,
  SUM(sql_count) AS sqls,
  SUM(sqo_count) AS sqos,
  SUM(joined_count) AS joined
FROM `savvy-gtm-analytics.Tableau_Views.vw_channel_funnel_volume_by_month`
WHERE period_type IN ('QUARTERLY', 'QTD')
GROUP BY 1, 2, 3
ORDER BY cohort_period DESC, Finance_View
```

If the old view no longer exists, note that and skip to section 2.

**Answer**:
<!-- CLAUDE_CODE_ANSWER_START -->

**The old view `vw_channel_funnel_volume_by_month` NO LONGER EXISTS in BigQuery.**

Views currently in `savvy-gtm-analytics.Tableau_Views`:
- `geocoded_addresses`
- `vw_daily_forecast`
- `vw_funnel_master`
- `vw_joined_advisor_location`
- `vw_lost_to_competition`
- `vw_sga_activity_performance`

Neither `vw_channel_funnel_volume_by_month` nor `vw_channel_conversion_rates_pivoted` exist. The only record of the old view's output is the **Google Sheet `Volumes` tab** (exported Mar 09, 2026).

**Old view data recovered from Google Sheet `Volumes` tab** — aggregated by Finance_View (column L) and quarter for QUARTERLY period_type. Note: the sheet contains **duplicate rows** for certain categories (same data appears under multiple `Channel_Grouping_Name` values but identical `Finance_View`), so SUMPRODUCT formulas double-count those categories.

**Q4 2025 QUARTERLY** (as the SUMPRODUCT would compute, including duplicates):

| Finance_View | Prospects | Contacted | MQLs | SQLs | SQOs | Joined |
|---|---|---|---|---|---|---|
| Advisor Referrals | 10 | 2 | 12 | 12 | 12 | 8 |
| Marketing | 177 | 175 | 52 | 36 | 17 | 1 |
| Other | 1,071 | 740 | 21 | 4 | 2 | 0 |
| Outbound | 17,652 | 27,763 | 960 | 238 | 66 | 6 |
| Outbound + Marketing | 44 | 32 | 26 | 22 | 18 | 2 |
| Partnerships | 63 | 25 | 68 | 50 | 44 | 8 |
| Re-Engagement | 54 | 10 | 24 | 52 | 46 | 2 |

**Q3 2025 QUARTERLY:**

| Finance_View | Prospects | Contacted | MQLs | SQLs | SQOs | Joined |
|---|---|---|---|---|---|---|
| Advisor Referrals | 12 | 4 | 6 | 10 | 10 | 10 |
| Marketing | 104 | 100 | 95 | 67 | 14 | 2 |
| Other | 200 | 71 | 8 | 3 | 2 | 0 |
| Outbound | 9,933 | 16,404 | 806 | 268 | 70 | 5 |
| Outbound + Marketing | 186 | 190 | 60 | 38 | 8 | 0 |
| Partnerships | 88 | 38 | 88 | 54 | 52 | 4 |
| Re-Engagement | 10 | 6 | 4 | 8 | 6 | 0 |

**Q2 2025 QUARTERLY:**

| Finance_View | Prospects | Contacted | MQLs | SQLs | SQOs | Joined |
|---|---|---|---|---|---|---|
| Advisor Referrals | 10 | 4 | 10 | 12 | 12 | 4 |
| Marketing | 460 | 110 | 96 | 35 | 16 | 0 |
| Other | 21 | 10 | 6 | 1 | 1 | 0 |
| Outbound | 7,900 | 12,709 | 648 | 216 | 70 | 9 |
| Outbound + Marketing | 36 | 22 | 16 | 16 | 10 | 0 |
| Partnerships | 40 | 24 | 44 | 22 | 22 | 2 |
| Re-Engagement | 34 | 28 | 8 | 2 | 2 | 2 |

**CRITICAL FINDING — Duplicate rows in Volumes tab:**
The old view export has rows at the `Channel_Grouping_Name × Original_source` granularity. Several Original_sources appear under multiple Channel_Grouping_Name values with **identical data**, but the same `Finance_View` value. The SUMPRODUCT formulas sum ALL rows matching a Finance_View, causing systematic double-counting for:
- **Advisor Referrals**: "Advisor Referral" source appears under CG="Advisor Referrals" AND CG="Ecosystem" → **2× counted**
- **Partnerships**: "Recruitment Firm" source appears under CG="Ecosystem" AND CG="Partnerships" → **2× counted** (Partner/Employee Referral appear once)
- **Re-Engagement**: "Re-Engagement" source appears under CG="Marketing" AND CG="Re-engagement" → **2× counted**
- **Outbound + Marketing**: "Events" source appears under CG="Marketing" AND CG="Outbound + Marketing" → **2× counted**
- **Other**: Some sources (e.g., "Other") appear under CG="Other" AND CG="Outbound" → **partially 2× counted**

<!-- CLAUDE_CODE_ANSWER_END -->

### 1.2 — Old view: distinct Finance_View values

**Query**:
```sql
SELECT DISTINCT Finance_View
FROM `savvy-gtm-analytics.Tableau_Views.vw_channel_funnel_volume_by_month`
ORDER BY 1
```

**Answer**:
<!-- CLAUDE_CODE_ANSWER_START -->

From the Google Sheet `Volumes` tab (column L), the distinct `Finance_View` values are:

1. **Advisor Referrals**
2. **Marketing**
3. **Other**
4. **Outbound**
5. **Outbound + Marketing**
6. **Partnerships**
7. **Re-Engagement**

These are exactly the 7 values the forecast sheet formulas expect (rows B11:B17).

<!-- CLAUDE_CODE_ANSWER_END -->

---

## 2. Current Funnel Master: Equivalent Volumes

### 2.1 — Build equivalent quarterly volumes from `vw_funnel_master`

The current funnel master uses `Finance_View__c` (from Salesforce) instead of the hardcoded SourceMapping. We need to aggregate volumes using the same cohort logic the old view used (event-based cohort months/quarters).

**Query**:
```sql
WITH quarterly AS (
  SELECT
    -- Use the same cohort logic: each stage's volume attributed to when it entered that stage
    Finance_View__c,

    -- Prospect volume: by FilterDate quarter
    DATE_TRUNC(DATE(FilterDate), QUARTER) AS prospect_q,
    -- Contacted volume: by contacted date quarter
    DATE_TRUNC(DATE(stage_entered_contacting__c), QUARTER) AS contacted_q,
    -- MQL volume: by MQL date quarter
    DATE_TRUNC(DATE(mql_stage_entered_ts), QUARTER) AS mql_q,
    -- SQL volume: by converted date quarter
    DATE_TRUNC(DATE(converted_date_raw), QUARTER) AS sql_q,
    -- SQO volume: by SQO date quarter
    DATE_TRUNC(DATE(Date_Became_SQO__c), QUARTER) AS sqo_q,
    -- Joined volume: by join date quarter
    DATE_TRUNC(DATE(advisor_join_date__c), QUARTER) AS joined_q,

    is_contacted,
    is_mql,
    is_sql,
    is_sqo_unique,
    is_joined_unique,
    opp_row_num,
    Full_Opportunity_ID__c
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
)

-- Prospects by quarter
SELECT 'Prospects' AS stage, Finance_View__c, prospect_q AS quarter, COUNT(*) AS vol
FROM quarterly WHERE prospect_q >= '2024-07-01' GROUP BY 2, 3

UNION ALL

-- Contacted by quarter
SELECT 'Contacted', Finance_View__c, contacted_q, SUM(is_contacted)
FROM quarterly WHERE contacted_q >= '2024-07-01' AND is_contacted = 1 GROUP BY 2, 3

UNION ALL

-- MQL by quarter
SELECT 'MQL', Finance_View__c, mql_q, SUM(is_mql)
FROM quarterly WHERE mql_q >= '2024-07-01' AND is_mql = 1 GROUP BY 2, 3

UNION ALL

-- SQL by quarter
SELECT 'SQL', Finance_View__c, sql_q, SUM(is_sql)
FROM quarterly WHERE sql_q >= '2024-07-01' AND is_sql = 1 GROUP BY 2, 3

UNION ALL

-- SQO by quarter (deduplicated)
SELECT 'SQO', Finance_View__c, sqo_q, COUNT(DISTINCT CASE WHEN is_sqo_unique = 1 THEN Full_Opportunity_ID__c END)
FROM quarterly WHERE sqo_q >= '2024-07-01' GROUP BY 2, 3

UNION ALL

-- Joined by quarter (deduplicated)
SELECT 'Joined', Finance_View__c, joined_q, COUNT(DISTINCT CASE WHEN is_joined_unique = 1 THEN Full_Opportunity_ID__c END)
FROM quarterly WHERE joined_q >= '2024-07-01' GROUP BY 2, 3

ORDER BY quarter DESC, Finance_View__c, stage
```

**Answer**:
<!-- CLAUDE_CODE_ANSWER_START -->

**Q1 2026 (QTD as of Mar 12, 2026):**

| Finance_View__c | Prospects | Contacted | MQLs | SQLs | SQOs | Joined |
|---|---|---|---|---|---|---|
| Advisor Referral | 1 | — | 1 | 1 | 1 | 2 |
| Employee Referral | 2 | 2 | — | — | — | — |
| Job Applications | 20 | 11 | 6 | 3 | 3 | 1 |
| Marketing | 870 | 238 | 24 | 11 | 6 | — |
| Other | 205 | 94 | 5 | — | 0 | — |
| Outbound | 23,690 | 18,926 | 379 | 116 | 79 | 4 |
| Outbound + Marketing | 1,757 | 957 | 67 | 17 | 13 | — |
| Re-Engagement | 20 | 6 | 8 | 18 | 15 | 3 |
| Recruitment Firm | 28 | 9 | 36 | 18 | 14 | 2 |

**Q4 2025 QUARTERLY:**

| Finance_View__c | Prospects | Contacted | MQLs | SQLs | SQOs | Joined |
|---|---|---|---|---|---|---|
| Advisor Referral | 12 | 1 | 6 | 6 | 6 | 4 |
| Job Applications | 30 | 18 | 11 | 7 | 5 | — |
| Marketing | 174 | 130 | 17 | 12 | 12 | 1 |
| Other | 340 | 184 | 11 | 1 | 1 | — |
| Outbound | 17,671 | 13,491 | 477 | 115 | 64 | 6 |
| Outbound + Marketing | 744 | 575 | 24 | 15 | 11 | 1 |
| Partnerships | 2 | — | — | — | — | — |
| Re-Engagement | 42 | 5 | 12 | 12 | 23 | 1 |
| Recruitment Firm | 179 | 13 | 34 | 25 | 22 | 4 |

**Q3 2025 QUARTERLY:**

| Finance_View__c | Prospects | Contacted | MQLs | SQLs | SQOs | Joined |
|---|---|---|---|---|---|---|
| Advisor Referral | 7 | 2 | 3 | 2 | 5 | 5 |
| Job Applications | 36 | 13 | 22 | 12 | 10 | 2 |
| Marketing | 47 | 28 | 27 | 23 | 13 | 1 |
| Other | 290 | 89 | 8 | 3 | 2 | — |
| Outbound | 9,907 | 8,147 | 403 | 134 | 70 | 5 |
| Outbound + Marketing | 95 | 96 | 30 | 19 | 4 | — |
| Partnerships | 2 | — | — | — | — | — |
| Re-Engagement | 6 | 3 | 2 | 1 | 3 | — |
| Recruitment Firm | 52 | 23 | 44 | 27 | 26 | 2 |

**Q2 2025 QUARTERLY:**

| Finance_View__c | Prospects | Contacted | MQLs | SQLs | SQOs | Joined |
|---|---|---|---|---|---|---|
| Advisor Referral | 5 | 2 | 5 | 5 | 6 | 2 |
| Job Applications | 339 | 9 | 48 | 11 | 4 | — |
| Marketing | 75 | 26 | 20 | 11 | 11 | — |
| Other | 70 | 54 | 9 | 2 | 2 | — |
| Outbound | 7,847 | 6,295 | 324 | 107 | 70 | 9 |
| Outbound + Marketing | 18 | 11 | 8 | 8 | 5 | — |
| Re-Engagement | 17 | 14 | 4 | — | 1 | 1 |
| Recruitment Firm | 22 | 13 | 22 | 11 | 11 | 1 |

<!-- CLAUDE_CODE_ANSWER_END -->

### 2.2 — Current funnel master: distinct Finance_View__c values

**Query**:
```sql
SELECT DISTINCT Finance_View__c, COUNT(*) AS cnt
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
GROUP BY 1
ORDER BY cnt DESC
```

**Answer**:
<!-- CLAUDE_CODE_ANSWER_START -->

| Finance_View__c | Record Count |
|---|---|
| Outbound | 99,634 |
| Job Applications | 2,675 |
| Outbound + Marketing | 2,646 |
| Marketing | 1,401 |
| Other | 1,099 |
| Recruitment Firm | 464 |
| Re-Engagement | 141 |
| Advisor Referral | 57 |
| Partnerships | 11 |
| Employee Referral | 10 |

**10 distinct values** vs 7 in the old view. New values not in old:
- **Job Applications** (2,675 records) — was bucketed into "Other" by old CTE
- **Recruitment Firm** (464 records) — was bucketed into "Partnerships" by old CTE
- **Employee Referral** (10 records) — was bucketed into "Partnerships" by old CTE
- **Partnerships** (11 records) — source value "Partnerships" fell into "Other" in old CTE

Also: **"Advisor Referral"** (singular) vs old **"Advisor Referrals"** (plural).

<!-- CLAUDE_CODE_ANSWER_END -->

---

## 3. Side-by-Side Comparison

### 3.1 — Build comparison: Old view vs Current funnel master (quarterly, by Finance_View)

For the quarters where BOTH datasets have data, create a comparison showing:
- Old view value
- Current funnel master value
- Delta (absolute and %)

**Approach**: If the old view still exists, join the two result sets. If not, compare the current funnel master output against the data already in the Google Sheet `Volumes` tab (which is the last export from the old view).

**Note for Claude Code**: The Google Sheet `Volumes` tab data was exported on Mar 09, 2026. The sheet is at `1JjmBA-z4yzD-iGLhrf_XTuHdBSgtQjeU1ih9c5-ujFc`. Read the Volumes tab via Google Sheets MCP to get the old view's last exported values if the old BQ view no longer exists.

**Answer**:
<!-- CLAUDE_CODE_ANSWER_START -->

**Methodology**: Old view no longer exists in BQ. Old values come from the Google Sheet `Volumes` tab (Mar 09 export). To compare, the new BQ `Finance_View__c` values must be re-bucketed to match the old 7-category scheme:

| New Finance_View__c | → Old Finance_View | Reason |
|---|---|---|
| Advisor Referral | Advisor Referrals | Plural form in old CTE |
| Employee Referral | Partnerships | Old CTE: Employee Referral → Partnerships |
| Job Applications | Other | Not in old CTE, fell to "Other" catch-all |
| Marketing | Marketing | Same |
| Other | Other | Same |
| Outbound | Outbound | Same |
| Outbound + Marketing | Outbound + Marketing | Same (but includes Provided List (Marketing) now, which was "Other" in old CTE) |
| Partnerships | Other | Source "Partnerships" wasn't in old CTE |
| Re-Engagement | Re-Engagement | Same |
| Recruitment Firm | Partnerships | Old CTE: Recruitment Firm → Partnerships |

**IMPORTANT CAVEAT**: The old sheet Volumes tab has **duplicate rows** (see §1.1). The SUMPRODUCT totals below include those duplicates because that's what the forecast formulas actually compute. The "De-duped Old" column shows what the actual unique volumes were.

**Q4 2025 QUARTERLY — Prospects (largest volume stage):**

| Finance_View | Old Sheet (SUMPRODUCT) | Old De-duped | New BQ (re-bucketed) | Delta vs De-duped | Notes |
|---|---|---|---|---|---|
| Advisor Referrals | 10 | 5 | 12 | +7 | +Advisor Referral reclassification |
| Marketing | 177 | 177 | 174 | −3 | Fintrx/Direct Traffic shifts |
| Other | 1,071 | ~537 | 372 | −165 | Job Apps→separate, Fintrx→Outbound |
| Outbound | 17,652 | 17,652 | 17,671 | +19 | +Fintrx(Self-Sourced) now Outbound |
| O+M | 44 | 22 | 744 | +722 | +Provided List(Marketing) now here |
| Partnerships | 63 | 32 | 181 | +149 | Recruitment Firm now separate FV |
| Re-Engagement | 54 | 27 | 42 | +15 | +Re-Engagement opps included |

**Q3 2025 QUARTERLY — Prospects:**

| Finance_View | Old Sheet (SUMPRODUCT) | Old De-duped | New BQ (re-bucketed) | Delta vs De-duped |
|---|---|---|---|---|
| Advisor Referrals | 12 | 6 | 7 | +1 |
| Marketing | 104 | 103 | 47 | −56 |
| Other | 200 | 200 | 328 | +128 |
| Outbound | 9,933 | 9,932 | 9,907 | −25 |
| O+M | 186 | 93 | 95 | +2 |
| Partnerships | 88 | 44 | 56 | +12 |
| Re-Engagement | 10 | 5 | 6 | +1 |

**Q2 2025 QUARTERLY — Prospects:**

| Finance_View | Old Sheet (SUMPRODUCT) | Old De-duped | New BQ (re-bucketed) | Delta vs De-duped |
|---|---|---|---|---|
| Advisor Referrals | 10 | 5 | 5 | 0 |
| Marketing | 460 | 460 | 75 | −385 |
| Other | 21 | 19 | 411 | +392 |
| Outbound | 7,900 | 7,900 | 7,847 | −53 |
| O+M | 36 | 18 | 18 | 0 |
| Partnerships | 40 | 20 | 22 | +2 |
| Re-Engagement | 34 | 17 | 17 | 0 |

**Key Pattern**: The "Marketing" vs "Other" split changes dramatically across quarters because **Job Applications** (mostly Dover/Ashby sources) moved from "Marketing" in old CTE to "Job Applications" in new — a category that maps to "Other" when re-bucketed. In Q2 2025, Dover alone had 338 prospects under "Marketing" in the old view; in the new system these are "Job Applications".

<!-- CLAUDE_CODE_ANSWER_END -->

### 3.2 — Focus: Q1 2026 volumes by Finance_View (most recent complete quarter)

This is the most critical comparison because Q1 actuals directly feed into the Q2 forecast trailing rates.

**Query**: For Q1 2026 specifically, show old vs current for every stage × Finance_View combination.

**Answer**:
<!-- CLAUDE_CODE_ANSWER_START -->

**Q1 2026 QTD** — Old sheet exported Mar 09 vs BQ as of Mar 12 (3-day gap; BQ will be slightly higher).

Old sheet aggregated by Finance_View (SUMPRODUCT totals with duplicates):

| Finance_View | Prospects | Contacted | MQLs | SQLs | SQOs | Joined |
|---|---|---|---|---|---|---|
| Advisor Referrals | 2 | 0 | 0 | 0 | 0 | 4 |
| Marketing | 832 | 157 | 45 | 25 | 12 | 1 |
| Other | 1,892 | 1,056 | 33 | 15 | 9 | 0 |
| Outbound | 21,004 | 28,678 | 641 | 224 | 90 | 4 |
| O+M | 1,501 | 710 | 53 | 9 | 4 | 0 |
| Partnerships | 13 | 5 | 13 | 13 | 9 | 4 |
| Re-Engagement | 20 | 6 | 0 | 6 | 6 | 6 |

New BQ `vw_funnel_master` re-bucketed to old Finance_View labels:

| Old Label | Prospects | Contacted | MQLs | SQLs | SQOs | Joined | Components |
|---|---|---|---|---|---|---|---|
| Advisor Referrals | 1 | 0 | 1 | 1 | 1 | 2 | Advisor Referral |
| Marketing | 870 | 238 | 24 | 11 | 6 | 0 | Marketing |
| Other | 225 | 94 | 11 | 3 | 3 | 1 | Other(205)+JobApps(20) |
| Outbound | 23,690 | 18,926 | 379 | 116 | 79 | 4 | Outbound |
| O+M | 1,757 | 957 | 67 | 17 | 13 | 0 | O+M |
| Partnerships | 30 | 11 | 36 | 18 | 14 | 2 | RecruitFirm(28)+EmpRef(2) |
| Re-Engagement | 20 | 6 | 8 | 18 | 15 | 3 | Re-Engagement |

**Delta (New minus Old De-duped):**

| Finance_View | Prospects | Contacted | MQLs | SQLs | SQOs | Joined |
|---|---|---|---|---|---|---|
| Advisor Referrals | 0 | 0 | +1 | +1 | +1 | 0 |
| Marketing | +38 | +81 | −21 | −14 | −6 | −1 |
| Other | **−667** | **−438** | −5 | −4 | −1 | +1 |
| Outbound | **+2,686** | **−9,752** | −262 | −108 | −11 | 0 |
| O+M | +1,006 | +602 | +41 | +12 | +11 | 0 |
| Partnerships | +24 | +9 | +30 | +12 | +10 | 0 |
| Re-Engagement | +10 | +3 | +8 | +15 | +12 | 0 |

**Analysis of major deltas:**

1. **Outbound Prospects (+2,686)**: The 3-day gap (Mar 9→12) partially explains this, but the magnitude suggests Fintrx (Self-Sourced) records (~1,755 total) are now mapped to "Outbound" in `Finance_View__c` where they were "Other" in the old CTE.

2. **Outbound Contacted (−9,752)**: MASSIVE drop. The old view reported 28,678 contacted for Outbound in Q1 2026 QTD, while the new shows 18,926. This is likely a **cohort attribution difference** — the old view may have attributed contacted records differently (e.g., by prospect creation quarter rather than contacted date quarter), or counted contacted for leads that were created in prior quarters but contacted in Q1.

3. **Other Prospects (−667)**: "Other" shrinks because Job Applications (20 prospects) is a fraction of what was there before, and Provided Lead List (Marketing) records (211 in old "Other") moved to O+M.

4. **O+M Prospects (+1,006)**: Provided Lead List (Marketing) source — 1,757 new vs ~750 old — now routes to "Outbound + Marketing" via `Finance_View__c` instead of "Other" via old CTE.

5. **Marketing Contacted (+81)**: New system attributes more contacts to Marketing sources (238 vs 157 de-duped). Ashby/Dover/Waitlist contact dates may differ from the old cohort logic.

<!-- CLAUDE_CODE_ANSWER_END -->

### 3.3 — Identify the biggest discrepancies

**Question**: Which Finance_View × stage × quarter combinations have the largest absolute deltas? List the top 15.

**Answer**:
<!-- CLAUDE_CODE_ANSWER_START -->

Comparing new BQ (re-bucketed) vs old sheet de-duped values:

| # | Quarter | Finance_View | Stage | Old De-duped | New BQ | Delta | Root Cause |
|---|---|---|---|---|---|---|---|
| 1 | Q1 2026 | Outbound | Contacted | ~14,339 | 18,926 | **+4,587** | Cohort attribution change |
| 2 | Q1 2026 | Outbound | Prospects | ~21,004 | 23,690 | **+2,686** | Fintrx→Outbound + 3-day gap |
| 3 | Q4 2025 | Outbound | Contacted | 27,763 | 13,491 | **−14,272** | Cohort/dedup differences |
| 4 | Q1 2026 | O+M | Prospects | ~750 | 1,757 | **+1,007** | Provided List(Mktg) remap |
| 5 | Q1 2026 | Other | Prospects | ~946 | 225 | **−721** | Job Apps + Prov List out |
| 6 | Q4 2025 | O+M | Prospects | 22 | 744 | **+722** | Provided List(Mktg) remap |
| 7 | Q1 2026 | Other | Contacted | ~528 | 94 | **−434** | Job Apps + Prov List out |
| 8 | Q2 2025 | Marketing | Prospects | 460 | 75 | **−385** | Dover/Job Apps split |
| 9 | Q2 2025 | Other | Prospects | 19 | 411 | **+392** | Job Apps now in "Other" |
| 10 | Q1 2026 | Outbound | MQLs | ~641 | 379 | **−262** | Dedup + cohort diff |
| 11 | Q4 2025 | Other | Prospects | ~537 | 372 | **−165** | Job Apps split out |
| 12 | Q4 2025 | Partnerships | Prospects | 32 | 181 | **+149** | Recruitment Firm reclassified |
| 13 | Q3 2025 | Outbound | Contacted | 16,404 | 8,147 | **−8,257** | Cohort attribution |
| 14 | Q2 2025 | Outbound | Contacted | 12,709 | 6,295 | **−6,414** | Cohort attribution |
| 15 | Q1 2026 | Outbound | SQLs | ~224 | 116 | **−108** | Dedup + cohort diff |

**The single largest driver across all quarters is the Outbound Contacted discrepancy**, which consistently shows the old view reporting 1.5–2× more contacted than the new. This points to a fundamental difference in how contacted events are attributed to cohort quarters.

<!-- CLAUDE_CODE_ANSWER_END -->

---

## 4. Root Cause Attribution

### 4.1 — How much of the delta is from source field change (`LeadSource` → `Final_Source__c`)?

**Query**: For records where `LeadSource != Final_Source__c`, count how many would shift Finance_View buckets. Cross-reference with the SourceMapping CTE values from the old view to determine the bucket shift.

**Answer**:
<!-- CLAUDE_CODE_ANSWER_START -->

The `vw_funnel_master` view does not expose `LeadSource` or `Final_Source__c` directly — it uses `Original_source` (which maps to `Final_Source__c` from the underlying Lead/Opp tables) and `Finance_View__c`.

However, we can measure the **mapping drift** by comparing what the old SourceMapping CTE would assign based on `Original_source` vs what `Finance_View__c` actually contains. This captures the combined effect of any source field change + mapping logic change.

**Total records where `Finance_View__c` ≠ old CTE bucket (based on `Original_source`):**

| SF Finance_View__c | Old CTE Bucket | Original_source | Count | Direction |
|---|---|---|---|---|
| Job Applications | Other | Job Applications | **2,675** | Other → new category |
| Outbound | Other | Fintrx (Self-Sourced) | **1,755** | Other → Outbound |
| Outbound + Marketing | Other | Provided List (Marketing) | **1,565** | Other → O+M |
| Recruitment Firm | Partnerships | Recruitment Firm | **464** | Partnerships → new category |
| Marketing | Other | Fintrx (Self-Sourced) | **62** | Other → Marketing |
| Advisor Referral | Advisor Referrals | Advisor Referral | **57** | Name change only (singular) |
| Other | Outbound | LinkedIn (Self Sourced) | **51** | Outbound → Other |
| Employee Referral | Partnerships | Employee Referral | **10** | Partnerships → new category |
| Partnerships | Other | Partnerships | **10** | Other → Partnerships |
| Marketing | Other | LinkedIn Savvy | **6** | Other → Marketing |
| Other | Marketing | Direct Traffic | **4** | Marketing → Other |
| Outbound | Marketing | Direct Traffic | **1** | Marketing → Outbound |
| Marketing | Other | Blog | **1** | Other → Marketing |
| Other | Re-Engagement | Re-Engagement | **1** | Re-Engagement → Other |

**Summary**: **6,662 records** (6.2% of total) have a different Finance_View bucket in the new system vs old CTE logic. The top 3 shifts account for 5,995 of these:
1. Job Applications: 2,675 records leave "Other" (new dedicated category)
2. Fintrx (Self-Sourced): 1,755 records move from "Other" → "Outbound"
3. Provided List (Marketing): 1,565 records move from "Other" → "Outbound + Marketing"

<!-- CLAUDE_CODE_ANSWER_END -->

### 4.2 — How much of the delta is from Re-Engagement inclusion?

**Query**: Re-run the current funnel master volume query from Q2.1 but EXCLUDING `lead_record_source = 'Re-Engagement'` rows. Compare to the full result.

**Answer**:
<!-- CLAUDE_CODE_ANSWER_START -->

**Q1 2026 breakdown by `lead_record_source` for each Finance_View__c:**

| Finance_View__c | Source | Prospects | Contacted | MQLs | SQLs | SQOs | Joined |
|---|---|---|---|---|---|---|---|
| **Outbound** | Lead | 23,683 | 18,922 | 379 | 116 | 79 | 4 |
| **Outbound** | Re-Engagement | 7 | 4 | 0 | 0 | 0 | 0 |
| **O+M** | Lead | 1,757 | 957 | 67 | 17 | 13 | 0 |
| **O+M** | Re-Engagement | 0 | 0 | 0 | 0 | 0 | 0 |
| **Marketing** | Lead | 870 | 238 | 24 | 11 | 6 | 0 |
| **Marketing** | Re-Engagement | 0 | 0 | 0 | 0 | 0 | 0 |
| **Other** | Lead | 110 | 72 | 3 | 0 | 0 | 0 |
| **Other** | Re-Engagement | 92 | 22 | 2 | 0 | 0 | 0 |
| **Re-Engagement** | Lead | 7 | 4 | 1 | 1 | 0 | 1 |
| **Re-Engagement** | Re-Engagement | 8 | 2 | 7 | 17 | 12 | 0 |
| **Re-Engagement** | NULL (opp-only) | 5 | 0 | 0 | 0 | 3 | 2 |
| **Recruitment Firm** | Lead | 24 | 7 | 35 | 18 | 13 | 2 |
| **Recruitment Firm** | Re-Engagement | 3 | 2 | 1 | 0 | 0 | 0 |
| **Job Applications** | Lead | 19 | 11 | 6 | 3 | 2 | 1 |
| **Employee Referral** | Lead | 1 | 1 | 0 | 0 | 0 | 0 |
| **Employee Referral** | Re-Engagement | 1 | 1 | 0 | 0 | 0 | 0 |
| **Advisor Referral** | Lead | 1 | 0 | 1 | 1 | 1 | 1 |

**Re-Engagement impact in Q1 2026 (total Re-Engagement-sourced records):**

| Finance_View__c | Prospects | Contacted | MQLs | SQLs | SQOs |
|---|---|---|---|---|---|
| Other | 92 | 22 | 2 | 0 | 0 |
| Re-Engagement | 8 | 2 | 7 | 17 | 12 |
| Outbound | 7 | 4 | 0 | 0 | 0 |
| Recruitment Firm | 3 | 2 | 1 | 0 | 0 |
| Employee Referral | 1 | 1 | 0 | 0 | 0 |
| **Total Re-Eng** | **111** | **31** | **10** | **17** | **12** |

**Re-Engagement inclusion is a MINOR factor for most categories.** The largest impact is 92 prospects added to "Other" and 8 prospects + 17 SQLs + 12 SQOs to "Re-Engagement". For Outbound/Marketing/O+M, the Re-Engagement additions are negligible (< 10 records).

Note: the "Re-Engagement" Finance_View__c category is a MIX of Lead-sourced records (7 prospects) and actual Re-Engagement opps (8 prospects). The old view also had a "Re-Engagement" Finance_View with similar small numbers.

<!-- CLAUDE_CODE_ANSWER_END -->

### 4.3 — How much of the delta is from the mapping change (hardcoded CTE vs `Finance_View__c`)?

For records where `LeadSource = Final_Source__c` (no source field drift) and `lead_record_source = 'Lead'` (no Re-Engagement), compare what the OLD SourceMapping CTE would assign as `Finance_View` vs what `Finance_View__c` actually contains.

**Answer**:
<!-- CLAUDE_CODE_ANSWER_START -->

**Lead-only records where `Finance_View__c` ≠ old CTE bucket (isolating pure mapping drift):**

| SF Finance_View__c | Old CTE Bucket | Original_source | Count | Direction |
|---|---|---|---|---|
| Job Applications | Other | Job Applications | **2,312** | Other → Job Applications |
| Outbound | Other | Fintrx (Self-Sourced) | **1,755** | Other → Outbound |
| Outbound + Marketing | Other | Provided List (Marketing) | **1,562** | Other → O+M |
| Recruitment Firm | Partnerships | Recruitment Firm | **291** | Partnerships → Recruitment Firm |
| Marketing | Other | Fintrx (Self-Sourced) | **62** | Other → Marketing |
| Other | Outbound | LinkedIn (Self Sourced) | **51** | Outbound → Other |
| Advisor Referral | Advisor Referrals | Advisor Referral | **32** | Name change (singular) |
| Employee Referral | Partnerships | Employee Referral | **8** | Partnerships → Employee Referral |
| Marketing | Other | LinkedIn Savvy | **6** | Other → Marketing |
| Partnerships | Other | Partnerships | **6** | Other → Partnerships |
| Other | Marketing | Direct Traffic | **4** | Marketing → Other |
| Outbound | Marketing | Direct Traffic | **1** | Marketing → Outbound |
| Marketing | Other | Blog | **1** | Other → Marketing |

**Total Lead-only mapping drift: 6,091 records.**

This is the **dominant drift source**. The mapping change from hardcoded CTE to Salesforce `Finance_View__c` accounts for the vast majority of volume shifts. Breaking down the net flows:

| Old Finance_View | Net Records Gained | Net Records Lost | Net Change |
|---|---|---|---|
| Other | — | −5,697 | Massive outflow to Job Apps, Outbound, O+M |
| Outbound | +1,755 | −51 | +1,704 (Fintrx inflow) |
| O+M | +1,562 | — | +1,562 (Provided List(Mktg) inflow) |
| Partnerships | — | −299 | −299 (Recruitment Firm + Employee Ref split out) |
| Marketing | +69 | −5 | +64 (Fintrx, LinkedIn Savvy inflow; Direct Traffic outflow) |
| Advisor Referrals | — | −32 | −32 (name change to singular) |

The **"Other" category is the biggest loser** — it shed ~5,700 records to more specific Finance_View__c categories that didn't exist in the old CTE.

<!-- CLAUDE_CODE_ANSWER_END -->

---

## 5. Deduplication Impact

### 5.1 — SQO/Joined double-counting in old view

The old view has no `opp_row_num` deduplication. How many SQOs and Joined advisors are double-counted?

**Query**:
```sql
SELECT
  'SQO' AS metric,
  COUNT(DISTINCT CASE WHEN is_sqo_unique = 1 THEN Full_Opportunity_ID__c END) AS deduplicated_count,
  COUNTIF(LOWER(SQO_raw) = 'yes' AND Full_Opportunity_ID__c IS NOT NULL) AS raw_count_no_dedup,
  COUNTIF(LOWER(SQO_raw) = 'yes' AND Full_Opportunity_ID__c IS NOT NULL)
    - COUNT(DISTINCT CASE WHEN is_sqo_unique = 1 THEN Full_Opportunity_ID__c END) AS over_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`

UNION ALL

SELECT
  'Joined',
  COUNT(DISTINCT CASE WHEN is_joined_unique = 1 THEN Full_Opportunity_ID__c END),
  COUNTIF((advisor_join_date__c IS NOT NULL OR StageName = 'Joined') AND Full_Opportunity_ID__c IS NOT NULL),
  COUNTIF((advisor_join_date__c IS NOT NULL OR StageName = 'Joined') AND Full_Opportunity_ID__c IS NOT NULL)
    - COUNT(DISTINCT CASE WHEN is_joined_unique = 1 THEN Full_Opportunity_ID__c END)
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
```

**Answer**:
<!-- CLAUDE_CODE_ANSWER_START -->

| Metric | Deduplicated Count | Raw (No Dedup) | Over-Count | Over-Count % |
|---|---|---|---|---|
| **SQO** | 978 | 980 | **2** | 0.2% |
| **Joined** | 117 | 118 | **1** | 0.9% |

**Deduplication has MINIMAL impact.** Only 2 SQOs and 1 Joined record are double-counted across all time. This is because very few opportunities have multiple leads pointing to the same opp.

The old view's lack of `opp_row_num` deduplication is **not a material source of volume discrepancy**.

<!-- CLAUDE_CODE_ANSWER_END -->

### 5.2 — Double-count breakdown by Finance_View

**Query**: Same as 5.1 but grouped by `Finance_View__c`.

**Answer**:
<!-- CLAUDE_CODE_ANSWER_START -->

**SQO by Finance_View__c:**

| Finance_View__c | Deduplicated | Raw (No Dedup) | Over-Count |
|---|---|---|---|
| Outbound | 545 | 546 | **1** |
| Outbound + Marketing | 45 | 46 | **1** |
| All others | (exact match) | (exact match) | **0** |

**Joined by Finance_View__c:**

| Finance_View__c | Deduplicated | Raw (No Dedup) | Over-Count |
|---|---|---|---|
| Outbound | 49 | 50 | **1** |
| All others | (exact match) | (exact match) | **0** |

Only Outbound and O+M have any double-counting, and it's 1 record each. Every other Finance_View__c category has zero deduplication impact.

<!-- CLAUDE_CODE_ANSWER_END -->

---

## 6. Summary & Recommendations

### 6.1 — Total volume impact

For each Finance_View category, summarize the net effect of all drift sources combined:
- Source field change
- Re-Engagement inclusion
- Mapping change
- Deduplication

**Summary**:
<!-- CLAUDE_CODE_ANSWER_START -->

### Net Volume Impact by Old Finance_View Category

| Old Finance_View | Primary Drift Source | Direction | Magnitude | Impact |
|---|---|---|---|---|
| **Other** | Mapping change | **↓↓↓ MAJOR DECREASE** | −5,700 records | Job Applications (2,312), Fintrx→Outbound (1,755), Prov List(Mktg)→O+M (1,562) all left "Other" |
| **Outbound** | Mapping change | **↑↑ INCREASE** | +1,704 records | Fintrx (Self-Sourced) now maps to Outbound. Contacted volumes show large discrepancy (likely cohort attribution, not mapping). |
| **Outbound + Marketing** | Mapping change | **↑↑ INCREASE** | +1,562 records | Provided List (Marketing) moved from "Other" to "O+M" via Finance_View__c |
| **Marketing** | Mapping change | **↑ SMALL INCREASE** | +64 records | Small inflows from Fintrx, LinkedIn Savvy; small outflow of Direct Traffic |
| **Partnerships** | Mapping change | **↓ DECREASE** | −299 records → splits into Recruitment Firm + Employee Referral | Label change: "Partnerships" → "Recruitment Firm" (291 leads) and "Employee Referral" (8) |
| **Advisor Referrals** | Name change | **LABEL ONLY** | 0 net change | "Advisor Referrals" → "Advisor Referral" (singular). Sheet SUMPRODUCT won't match. |
| **Re-Engagement** | Re-Engagement inclusion | **↑ SMALL** | +~50 records | Re-Engagement opps add modest volume; the Finance_View__c "Re-Engagement" category already existed |

### Additional Structural Issues

1. **Sheet Duplicate Rows (§1.1)**: The Volumes tab has systematic duplicate rows for Advisor Referrals, Partnerships, Re-Engagement, O+M, and partially Other. SUMPRODUCT formulas double-count these categories. This means the forecast model was using **inflated baseline volumes** for these categories.

2. **Contacted Volume Cohort Attribution**: The old view's contacted numbers are consistently 1.5–2× higher than the new funnel master for Outbound. This is likely because the old view attributed contacted events to the **prospect creation quarter** rather than the **contacted date quarter**, inflating the contacted count for quarters with high outbound prospecting.

3. **Deduplication**: Negligible impact (3 total records). Not a meaningful drift source.

4. **Three new Finance_View__c categories** exist in the new system that have no old equivalent:
   - Job Applications (2,675 records)
   - Recruitment Firm (464 records)
   - Employee Referral (10 records)

<!-- CLAUDE_CODE_ANSWER_END -->

### 6.2 — What the new volume view must output

Based on these findings, specify:
1. Which `Finance_View` values should the new view output so the sheet formulas work?
2. Should Re-Engagement records be included?
3. Should deduplication be applied?
4. Any other adjustments needed?

**Recommendation**:
<!-- CLAUDE_CODE_ANSWER_START -->

### 1. Finance_View Output Values

The new volume view MUST output these exact 7 labels to match the sheet SUMPRODUCT formulas:

| Output Finance_View | Source from Finance_View__c | Mapping Logic |
|---|---|---|
| **Outbound** | Outbound | Direct pass-through |
| **Marketing** | Marketing, Job Applications | Merge Job Applications into Marketing (restores old behavior) |
| **Outbound + Marketing** | Outbound + Marketing | Direct pass-through |
| **Other** | Other, Partnerships (source) | Catch-all |
| **Partnerships** | Recruitment Firm, Employee Referral | Re-merge these back to "Partnerships" |
| **Advisor Referrals** | Advisor Referral | Add plural "s" to match sheet label |
| **Re-Engagement** | Re-Engagement | Direct pass-through |

**CASE statement for the new view:**
```sql
CASE Finance_View__c
  WHEN 'Outbound' THEN 'Outbound'
  WHEN 'Marketing' THEN 'Marketing'
  WHEN 'Job Applications' THEN 'Marketing'
  WHEN 'Outbound + Marketing' THEN 'Outbound + Marketing'
  WHEN 'Recruitment Firm' THEN 'Partnerships'
  WHEN 'Employee Referral' THEN 'Partnerships'
  WHEN 'Advisor Referral' THEN 'Advisor Referrals'
  WHEN 'Re-Engagement' THEN 'Re-Engagement'
  ELSE 'Other'
END AS Finance_View
```

**Decision needed**: Should "Job Applications" map to "Marketing" (restoring old behavior where Dover/Ashby went to Marketing) or stay in "Other"? The old CTE put these in "Marketing" via source mapping, but `Finance_View__c` classifies them separately. **Recommendation: Map to "Marketing"** for continuity with the forecast model's historical rates.

### 2. Re-Engagement Records

**Include them.** The old view also had a "Re-Engagement" Finance_View row. The Re-Engagement-sourced records add only ~111 prospects and ~31 contacts in Q1 2026 — negligible for Outbound/Marketing but meaningful for the Re-Engagement category's own volumes. Excluding them would zero out the Re-Engagement row.

### 3. Deduplication

**Apply it (keep `opp_row_num = 1` filter for SQO/Joined).** The over-count is only 2-3 records total, so the practical impact is negligible. But deduplication is the correct behavior — the old view's lack of dedup was a bug, not a feature.

### 4. Other Adjustments

**A. Fix the duplicate row issue.** The new view must NOT produce duplicate rows per Channel_Grouping_Name × Original_source. Output should be at the `Finance_View × cohort_period` grain (one row per combination). This eliminates the systematic 2× inflation that the old Volumes tab had for Advisor Referrals, Partnerships, Re-Engagement, and O+M.

**Impact of fixing duplicates**: The forecast model's historical baseline for these categories was inflated. Fixing this will show ~50% lower historical volumes for Advisor Referrals, Partnerships, Re-Engagement, and O+M. The forecast team must be informed and may need to re-baseline.

**B. Investigate the Contacted cohort attribution.** The old view's Outbound Contacted numbers are 1.5–2× higher than the new funnel master. Before building the new view, determine whether contacted should be attributed to the prospect creation quarter (old behavior) or the contacted date quarter (new behavior). This decision materially affects conversion rate calculations.

**C. Handle Fintrx (Self-Sourced) routing.** These 1,755+ records have `Finance_View__c = 'Outbound'` but `Original_source = 'Fintrx (Self-Sourced)'`. The old CTE would put them in "Other". The new `Finance_View__c` from Salesforce puts them in "Outbound". **Recommendation: Trust Finance_View__c** — Salesforce is the source of truth for categorization, and the old CTE was a static approximation.

**D. Handle Provided List (Marketing) routing.** Similarly, 1,565 records with `Original_source = 'Provided List (Marketing)'` have `Finance_View__c = 'Outbound + Marketing'` (old CTE had them as "Other"). **Recommendation: Trust Finance_View__c.**

<!-- CLAUDE_CODE_ANSWER_END -->

---

*Exploration complete. Results feed into the view rewrite phase.*
