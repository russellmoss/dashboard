# Diagnostic: Conversion Rate Inflation in Source-Level Formulas

> **Symptom**: The Google Sheet shows Created → Contacted rate of 144% for "Provided Lead List" in Q1 2026.
> **Formula**: `=SUMPRODUCT((monthly_conversion_rates!$D$2:$D$5000=$F$8)*(monthly_conversion_rates!$F$2:$F$5000=$F$7)*((monthly_conversion_rates!$A$2:$A$5000="QTD")+(monthly_conversion_rates!$A$2:$A$5000="QUARTERLY"))*(monthly_conversion_rates!$H$2:$H$5000="Provided Lead List")*(monthly_conversion_rates!$AH$2:$AH$5000))`
> **Key observation**: The formula matches on `Original_source` (col H) but does NOT filter on `Finance_View` (col K). If multiple rows match the same Original_source × period, rates get SUMMED.

---

## Query 1: How many rows match "Provided Lead List" for Q1 2026 in the conversion rate view?

```sql
SELECT
  period_type,
  period_label,
  Finance_View,
  Original_source,
  created_to_contacted_rate,
  created_to_contacted_numerator,
  created_to_contacted_denominator,
  contacted_to_mql_rate,
  mql_to_sql_rate,
  sql_to_sqo_rate
FROM `savvy-gtm-analytics.Tableau_Views.vw_channel_conversion_rates_pivoted`
WHERE Original_source = 'Provided Lead List'
  AND period_type IN ('QTD', 'QUARTERLY')
  AND cohort_year = 2026
  AND cohort_quarter_num = 1
ORDER BY Finance_View
```

**Expected finding**: Multiple rows for the same Original_source × period, each with its own rate. SUMPRODUCT sums them → 144%.

**Answer**:
<!-- CLAUDE_CODE_ANSWER_START -->

**The query returned 0 rows.**

`"Provided Lead List"` does NOT exist as an `Original_source` value in the new `vw_channel_conversion_rates_pivoted` view. The source was renamed:
- `"Provided Lead List"` → `"Provided List (Lead Scoring)"` (69,885 records in funnel master)
- A separate source `"Provided List (Marketing)"` also exists (1,565 records)

The new view has this for `"Provided List (Lead Scoring)"` in Q1 2026:

| period_type | Finance_View | Original_source | c2c_rate | c2c_num | c2c_denom |
|---|---|---|---|---|---|
| QTD | Outbound | Provided List (Lead Scoring) | 75.5% | 9,399 | 12,454 |

**Only 1 row** — `Provided List (Lead Scoring)` maps to a single Finance_View (Outbound). No multi-row inflation for this source.

**The 144% symptom** was likely observed when the `monthly_conversion_rates` tab still contained data from the OLD view export (pre-rebuild), where `"Provided Lead List"` appeared under multiple `Channel_Grouping_Name` rows with the same `Finance_View`. The old view had systematic duplicate rows (documented in `volume_comparison_exploration.md` §1.1). The SUMPRODUCT formula matched both rows and summed the rates.

The sheet formula in C109 still hardcodes `"Provided Lead List"` (the OLD name), even though the B107 label was updated to `"Provided Lead List (Lead Scoring)"`. With the new view data, this formula returns **0** (no match) rather than 144%.

<!-- CLAUDE_CODE_ANSWER_END -->

## Query 2: Same check across ALL Original_source values — which ones have multiple Finance_View rows?

```sql
SELECT
  Original_source,
  COUNT(*) AS row_count,
  COUNT(DISTINCT Finance_View) AS distinct_finance_views,
  ARRAY_AGG(DISTINCT Finance_View) AS finance_views,
  SUM(created_to_contacted_rate) AS summed_c2c_rate,
  SUM(contacted_to_mql_rate) AS summed_c2m_rate,
  SUM(mql_to_sql_rate) AS summed_m2s_rate,
  SUM(sql_to_sqo_rate) AS summed_s2q_rate
FROM `savvy-gtm-analytics.Tableau_Views.vw_channel_conversion_rates_pivoted`
WHERE period_type IN ('QTD', 'QUARTERLY')
  AND cohort_year = 2026
  AND cohort_quarter_num = 1
GROUP BY 1
HAVING COUNT(DISTINCT Finance_View) > 1
ORDER BY row_count DESC
```

**Expected finding**: Several Original_source values spanning multiple Finance_View groups.

**Answer**:
<!-- CLAUDE_CODE_ANSWER_START -->

**3 Original_source values have multiple Finance_View rows in Q1 2026:**

| Original_source | Row Count | Distinct FVs | Finance_Views | Summed c2c Rate | Correct c2c Rate | Inflation |
|---|---|---|---|---|---|---|
| **Direct Traffic** | 3 | 3 | Marketing, Other, Outbound | 23.4% | 23.4% (Marketing) | Mild — Other/Outbound rows have 0% c2c |
| **LinkedIn (Self Sourced)** | 2 | 2 | Outbound, Other | **135.7%** | 90.6% (Outbound) | **+45.1% from Other row** |
| **Fintrx (Self-Sourced)** | 2 | 2 | Marketing, Outbound | **124.6%** | 53.6% (Outbound, majority) | **+71.0% from Marketing row** |

**Detailed breakdown of the multi-FV rows:**

**LinkedIn (Self Sourced):**

| Finance_View | c2c Rate | c2c Num | c2c Denom | c2m Rate | m2s Rate | s2q Rate |
|---|---|---|---|---|---|---|
| Outbound | 90.6% | 8,586 | 9,481 | 1.5% | 24.7% | 71.7% |
| Other | 45.1% | 23 | 51 | 0% | — | — |
| **SUMPRODUCT total** | **135.7%** | — | — | **1.5%** | **24.7%** | **71.7%** |

The 51 "Other" records are leads with `Finance_View__c = 'Other'` but `Original_source = 'LinkedIn (Self Sourced)'`. They create a second row that the SUMPRODUCT adds to the Outbound row's rate.

**Fintrx (Self-Sourced):**

| Finance_View | c2c Rate | c2c Num | c2c Denom | c2m Rate |
|---|---|---|---|---|
| Marketing | 71.0% | 44 | 62 | 0% |
| Outbound | 53.6% | 941 | 1,754 | 3.2% |
| **SUMPRODUCT total** | **124.6%** | — | — | **3.2%** |

**Direct Traffic:**

| Finance_View | c2c Rate | c2c Num | c2c Denom |
|---|---|---|---|
| Marketing | 23.4% | 181 | 774 |
| Other | 0% | 0 | 4 |
| Outbound | 0% | 0 | 1 |
| **SUMPRODUCT total** | **23.4%** | — | — |

Direct Traffic inflation is minimal because the Other/Outbound rows have 0% rates (0 contacted out of 4+1 prospects).

**Across ALL quarters (not just Q1 2026), 4 sources have multi-FV rows:**

| Original_source | Distinct FVs | Finance_Views | Total Rows (all qtrs) |
|---|---|---|---|
| Direct Traffic | 3 | Marketing, Other, Outbound | 11 |
| LinkedIn (Self Sourced) | 2 | Outbound, Other | 10 |
| Re-Engagement | 2 | Re-Engagement, Other | 10 |
| Fintrx (Self-Sourced) | 2 | Marketing, Outbound | 7 |

<!-- CLAUDE_CODE_ANSWER_END -->

## Query 3: Same check on the VOLUME view — does it have the same multi-Finance_View problem?

```sql
SELECT
  Original_source,
  COUNT(*) AS row_count,
  COUNT(DISTINCT Finance_View) AS distinct_finance_views,
  ARRAY_AGG(DISTINCT Finance_View) AS finance_views,
  SUM(prospects_created) AS total_prospects,
  SUM(mql_count) AS total_mqls
FROM `savvy-gtm-analytics.Tableau_Views.vw_channel_funnel_volume_by_month`
WHERE period_type IN ('QTD', 'QUARTERLY')
  AND cohort_year = 2026
  AND cohort_quarter_num = 1
GROUP BY 1
HAVING COUNT(DISTINCT Finance_View) > 1
ORDER BY row_count DESC
```

**Answer**:
<!-- CLAUDE_CODE_ANSWER_START -->

**Yes, the volume view has the same 3 multi-Finance_View sources in Q1 2026:**

| Original_source | Row Count | Distinct FVs | Finance_Views | Total Prospects (summed) | Total MQLs (summed) |
|---|---|---|---|---|---|
| **Direct Traffic** | 3 | 3 | Marketing, Other, Outbound | 779 | 13 |
| **LinkedIn (Self Sourced)** | 2 | 2 | Outbound, Other | 9,532 | 190 |
| **Fintrx (Self-Sourced)** | 2 | 2 | Marketing, Outbound | 1,816 | 31 |

**Impact on volume formulas**: The source-detail volume formulas (row 108 etc.) use `Volumes!$I` to match on `Original_source`. Like the rate formulas, they do NOT filter on Finance_View. This means volumes are **also being summed across Finance_View rows**.

However, for volumes this is actually **correct behavior** — the SUMPRODUCT sums the volume counts, and the total across Finance_Views IS the true total for that source. For example, LinkedIn (Self Sourced) really does have 9,481 Outbound + 51 Other = 9,532 total prospects. The volume SUMPRODUCT gives the right answer.

**The problem is ONLY with rates**, because rates are not additive. Summing 90.6% + 45.1% = 135.7% is nonsensical — you'd need a weighted average instead.

<!-- CLAUDE_CODE_ANSWER_END -->

## Query 4: What does `Original_source` look like in `vw_funnel_master` for what was historically "Provided Lead List"?

The old system used `LeadSource`. The current system uses `Final_Source__c`. The schema drift exploration showed 61,694 records shifted from `LeadSource = "Provided Lead List"` to `Final_Source__c = "Provided List (Lead Scoring)"`.

```sql
SELECT
  Original_source,
  Finance_View__c,
  COUNT(*) AS cnt,
  COUNTIF(is_contacted = 1) AS contacted,
  COUNTIF(is_mql = 1) AS mqls
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE Original_source IN (
  'Provided Lead List',
  'Provided List (Lead Scoring)',
  'Provided List (Marketing)',
  'Purchased List'
)
GROUP BY 1, 2
ORDER BY 1, cnt DESC
```

**This shows**: Which `Finance_View__c` values each "Provided List*" source maps to. If a single Original_source spans multiple Finance_View__c values, it creates multiple rows in our views.

**Answer**:
<!-- CLAUDE_CODE_ANSWER_START -->

| Original_source | Finance_View__c | Count | Contacted | MQLs |
|---|---|---|---|---|
| Provided List (Lead Scoring) | **Outbound** | 69,885 | 42,637 | 1,226 |
| Provided List (Marketing) | **Outbound + Marketing** | 1,565 | 1,169 | 32 |

**Key findings:**

1. **`"Provided Lead List"` does NOT exist** in `vw_funnel_master`. Zero rows. The source was renamed/split.

2. **`"Purchased List"` does NOT exist** either. Zero rows.

3. **`"Provided List (Lead Scoring)"` → single Finance_View__c (Outbound)**. No multi-FV problem. 69,885 records, all Outbound.

4. **`"Provided List (Marketing)"` → single Finance_View__c (Outbound + Marketing)**. No multi-FV problem. 1,565 records, all O+M.

5. Each "Provided List*" variant maps to exactly ONE Finance_View__c, so these sources will have exactly one row per period in the views. **No rate inflation for these sources.**

The original 144% symptom for "Provided Lead List" was caused by **old duplicate rows in the `monthly_conversion_rates` tab** (the Channel_Grouping_Name duplication pattern, not the multi-FV issue). With the new views, "Provided Lead List" simply doesn't match any rows.

<!-- CLAUDE_CODE_ANSWER_END -->

## Query 5: What Original_source values does the sheet actually reference?

Read the source-detail section of the Q2 forecast tab (rows 106+) via Google Sheets MCP to get the list of Original_source strings used in formulas. These are the strings that must have EXACTLY ONE row per period in the views.

**Google Sheet ID**: `1JjmBA-z4yzD-iGLhrf_XTuHdBSgtQjeU1ih9c5-ujFc`
**Tab**: `Q2 forecast`
**Read**: Column B from rows 107–200 (or until you find all source-level headers)

Look for rows where B contains a source name that's used in SUMPRODUCT formulas matching `monthly_conversion_rates!$H` or `Volumes!$I`.

**Answer**:
<!-- CLAUDE_CODE_ANSWER_START -->

**Source names referenced in the Q2 forecast source-detail sections (rows 106–500):**

Extracted from column B — each source name block has 13 rows (Created, rate, Contacted, rate, MQL, rate, SQL, rate, SQO, rate, Joined), with blank separator rows.

**Outbound section (row 105+):**
1. `Provided Lead List (Lead Scoring)` ← formula in C109 still matches on `"Provided Lead List"` (OLD name!)
2. `LinkedIn (Self Sourced)` ← **AFFECTED by multi-FV inflation** (Outbound + Other)

**Marketing — Organic section (row 134+):**
3. `Blog`
4. `Search`
5. `LinkedIn Savvy`
6. `LinkedIn Social`
7. `LinkedIn (Content)`
8. `LinkedIn (Automation)`
9. `Direct Traffic` ← **AFFECTED by multi-FV** (Marketing + Other + Outbound), but mild (0% on Other/Outbound rows)
10. `Website`
11. `Advisor Waitlist`

**Marketing — Paid section (row 255+):**
12. `Google Ads + LinkedIn Ads` ← composite; likely custom SUMPRODUCT logic
13. `Ashby`
14. `Google Ads`
15. `Meta`
16. `LinkedIn Ads`

**Outbound + Marketing section (row 340+):**
17. `Events`
18. `Direct Mail`
19. `Webinar`
20. `Provided List (Marketing)`

**Re-Engagement section (row 375+):**
21. `Re-Engagement` ← **AFFECTED by multi-FV** in some quarters (Re-Engagement + Other)

**Partnerships section (row 393+):**
22. `Recruitment Firm`

**Advisor Referrals section (row 407+):**
23. `Advisor Referral`

**Other section (row 421+):**
24. `Other`
25. `Unknown`

**Summary of affected sources:**

| Source | Multi-FV? | Finance_Views | Inflation Severity |
|---|---|---|---|
| LinkedIn (Self Sourced) | **YES** | Outbound, Other | **HIGH** — 135.7% instead of 90.6% c2c |
| Fintrx (Self-Sourced) | **YES** | Marketing, Outbound | **HIGH** — 124.6% instead of 53.6% c2c |
| Direct Traffic | **YES** | Marketing, Other, Outbound | **LOW** — Other/Outbound rows have 0% rates |
| Re-Engagement | **YES** (some qtrs) | Re-Engagement, Other | **MODERATE** — varies by quarter |

**Note**: `Fintrx (Self-Sourced)` does NOT appear as a source-detail row in the sheet. It only affects the summary-level Finance_View formulas, not source-level formulas. However, `LinkedIn (Self Sourced)` and `Direct Traffic` DO appear as source rows and ARE affected.

**Also critical**: The formula for "Provided Lead List (Lead Scoring)" (C109) still hardcodes the OLD name `"Provided Lead List"`. This returns **0** with the new view data — a **name mismatch bug**, not an inflation bug.

<!-- CLAUDE_CODE_ANSWER_END -->

## Query 6: Verify the "Provided Lead List" vs "Provided List (Lead Scoring)" name issue

The sheet formula hardcodes `"Provided Lead List"` but `Final_Source__c` may have renamed most of these to `"Provided List (Lead Scoring)"`. Check what actually matches:

```sql
SELECT
  Original_source,
  COUNT(*) AS rows_in_view
FROM `savvy-gtm-analytics.Tableau_Views.vw_channel_funnel_volume_by_month`
WHERE Original_source LIKE 'Provided%'
  AND period_type IN ('QTD', 'QUARTERLY')
  AND cohort_year = 2026
  AND cohort_quarter_num = 1
GROUP BY 1
ORDER BY 1
```

**Answer**:
<!-- CLAUDE_CODE_ANSWER_START -->

| Original_source | Rows in Volume View |
|---|---|
| Provided List (Lead Scoring) | 1 |
| Provided List (Marketing) | 1 |

**Confirmed**: The new views use the renamed source values. `"Provided Lead List"` does not exist.

Cross-referencing with all distinct `Original_source` values in the conversion rate view:

| # | Original_source | In new BQ view? |
|---|---|---|
| 1 | Advisor Referral | ✅ |
| 2 | Blog | ✅ |
| 3 | Direct Traffic | ✅ |
| 4 | Employee Referral | ✅ |
| 5 | Events | ✅ |
| 6 | Fintrx (Self-Sourced) | ✅ |
| 7 | Google Ads | ✅ |
| 8 | Job Applications | ✅ (NEW — not in old view) |
| 9 | LinkedIn (Self Sourced) | ✅ |
| 10 | LinkedIn Ads | ✅ |
| 11 | LinkedIn Savvy | ✅ (NEW) |
| 12 | Other | ✅ |
| 13 | Partnerships | ✅ (NEW) |
| 14 | **Provided List (Lead Scoring)** | ✅ (was "Provided Lead List") |
| 15 | **Provided List (Marketing)** | ✅ (was "Provided Lead List (Marketing)") |
| 16 | Re-Engagement | ✅ |
| 17 | Recruitment Firm | ✅ |
| 18 | Unknown | ✅ |

**Source names the sheet references but that NO LONGER EXIST in the new views:**
- `"Provided Lead List"` → now `"Provided List (Lead Scoring)"` (formula returns 0)
- `"Search"` → does not exist in new view (may need to check if renamed)
- `"LinkedIn Social"` → does not exist in new view
- `"Direct Mail"` → does not exist in new view
- `"Webinar"` → does not exist in new view
- `"Meta"` → does not exist in new view

These will all return **0** from the SUMPRODUCT formulas — silent data loss.

<!-- CLAUDE_CODE_ANSWER_END -->

---

## Summary & Root Cause

Based on the queries above, document:

1. **Is the rate inflation caused by multiple Finance_View rows per Original_source?** (the SUMPRODUCT-sums-rates problem)
2. **Is the "Provided Lead List" name still present in the view, or did `Final_Source__c` rename it?**
3. **Which Original_source values are affected by the multi-Finance_View problem?**
4. **What is the fix?**

Likely fix: The conversion rate view (and possibly volume view) needs to aggregate at the **Original_source × period** grain WITHOUT the Finance_View dimension, since the sheet formulas don't filter on Finance_View when pulling source-level data. We'd keep the Finance_View dimension for the summary-level rows (rows 11–17) but collapse it for the source-detail rows — OR we ensure that each Original_source maps to exactly one Finance_View via a deterministic rule (e.g., the Finance_View of the majority of records for that source).

**Answer**:
<!-- CLAUDE_CODE_ANSWER_START -->

### Root Cause: Two Separate Bugs

**Bug 1: Multi-Finance_View Rate Inflation (SUMPRODUCT sums rates)**

**YES, confirmed.** The new conversion rate view produces multiple rows per `Original_source × period` when that source's records span multiple `Finance_View__c` values. The sheet's source-level SUMPRODUCT formulas match on `Original_source` (column H) without filtering on `Finance_View` (column K), so they SUM the rates across all matching rows.

**Affected sources and severity:**

| Source | Finance_Views | Summed c2c Rate (Q1 2026) | Correct c2c Rate | Sheet Uses It? |
|---|---|---|---|---|
| **LinkedIn (Self Sourced)** | Outbound (9,481), Other (51) | **135.7%** | 90.6% | **YES** — Outbound source detail |
| **Fintrx (Self-Sourced)** | Outbound (1,754), Marketing (62) | **124.6%** | 53.6% | No — not a source-detail row |
| **Direct Traffic** | Marketing (774), Other (4), Outbound (1) | 23.4% | 23.4% | **YES** — Marketing source detail |
| **Re-Engagement** | Re-Engagement (20), Other (varies) | Varies by quarter | 30.0% | **YES** — Re-Engagement detail |

**LinkedIn (Self Sourced) is the most impactful** — 51 records with `Finance_View__c = 'Other'` (instead of Outbound) create a second row that inflates the rate by +45 percentage points.

**Bug 2: Source Name Mismatch (formulas return 0)**

**"Provided Lead List" no longer exists.** It was renamed to `"Provided List (Lead Scoring)"` when the view switched from `LeadSource` to `Final_Source__c` / `Original_source`. The sheet label (B107) was updated to "Provided Lead List (Lead Scoring)" but the SUMPRODUCT formula string in C109 still hardcodes `"Provided Lead List"`. Result: **0** for all quarters.

Additional sources referenced by the sheet that don't exist in the new view: `Search`, `LinkedIn Social`, `Direct Mail`, `Webinar`, `Meta`. These all return **0** — silent data loss.

**The original 144% symptom** was most likely observed when the `monthly_conversion_rates` tab still contained data from the OLD view export, which had the duplicate `Channel_Grouping_Name` row pattern (same data under multiple groupings but identical `Finance_View`). The SUMPRODUCT summed both rows' rates.

---

### Recommended Fix

**Option A: Ensure 1:1 mapping from Original_source → Finance_View (RECOMMENDED)**

Modify the views so that each `Original_source` maps to exactly ONE `Finance_View`. Use a deterministic rule — assign the Finance_View of the **majority** of records for that source:

```sql
-- In the view definition, replace Finance_View__c with a deterministic mapping:
CASE Original_source
  WHEN 'LinkedIn (Self Sourced)' THEN 'Outbound'      -- 9,481 of 9,532 are Outbound
  WHEN 'Fintrx (Self-Sourced)' THEN 'Outbound'        -- 1,754 of 1,816 are Outbound
  WHEN 'Direct Traffic' THEN 'Marketing'               -- 774 of 779 are Marketing
  WHEN 'Re-Engagement' THEN 'Re-Engagement'            -- majority are Re-Engagement
  ELSE Finance_View__c                                  -- all others already 1:1
END AS Finance_View
```

This eliminates multi-row inflation while preserving the Finance_View dimension for summary-level formulas.

**Option B: Collapse source-detail rows (alternative)**

Add a second output grain to the conversion rate view — source-detail rows aggregated at `Original_source × period` without Finance_View. This requires either:
- A separate view for source-detail queries
- Or a `detail_level` column ('summary' vs 'source') that the formulas can filter on

This is more complex but preserves the true per-Finance_View rates for analytical queries.

**Additionally required (for both options):**

1. **Update sheet formulas** to use new source names:
   - `"Provided Lead List"` → `"Provided List (Lead Scoring)"`
   - Verify all other source names match (Search, LinkedIn Social, Direct Mail, Webinar, Meta)

2. **Validate** that the `monthly_conversion_rates` tab is refreshed from the new view and no stale data remains.

3. **For the volume view**: Multi-FV rows are **not a bug** for volumes (summing counts is correct). But if the sheet expects 1 row per source for layout reasons, apply the same 1:1 mapping.

---

### Impact Assessment

| Issue | Affected Rows | Severity | User-Visible? |
|---|---|---|---|
| LinkedIn (Self Sourced) rate inflation | Outbound source detail | **HIGH** — 45pp over-stated | Yes — forecast rates wrong |
| Source name mismatch (Provided Lead List) | Outbound source detail | **HIGH** — shows 0 | Yes — entire row blank |
| Missing sources (Search, Meta, etc.) | Multiple sections | **MEDIUM** — shows 0 | Yes — rows blank |
| Direct Traffic mild inflation | Marketing source detail | **LOW** — 0pp effective | No — Other/Outbound have 0% |
| Re-Engagement inflation (some qtrs) | Re-Engagement detail | **LOW-MEDIUM** | Varies by quarter |

<!-- CLAUDE_CODE_ANSWER_END -->
