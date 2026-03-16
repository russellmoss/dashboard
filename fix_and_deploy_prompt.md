# Fix & Deploy: BQ Views + Google Sheet Source Names

> **Context**: Two bugs confirmed in the newly deployed BQ views:
> 1. **Multi-Finance_View rate inflation** — 4 `Original_source` values span multiple `Finance_View` groups, causing SUMPRODUCT to sum rates (e.g., LinkedIn Self Sourced shows 135.7% instead of 90.6%)
> 2. **Source name mismatches** — Several source names changed from `LeadSource` to `Final_Source__c` but the sheet formulas still reference old names → returns 0
>
> **Additionally**: Switching conversion rate methodology from same-period to **cohorted (resolution-based) with 30-day timeout** for the Contacted→MQL denominator.
>
> **Dashboard codebase**: `C:\Users\russe\Documents\Dashboard\`
> **Google Sheet**: `1JjmBA-z4yzD-iGLhrf_XTuHdBSgtQjeU1ih9c5-ujFc`

---

## Phase 1: Investigate Missing Sources (DO NOT modify anything yet)

Before rewriting the views, we need to know what happened to the sources the sheet references that don't exist in the new views: `Search`, `Meta`, `Direct Mail`, `Webinar`, `LinkedIn Social`.

### 1.1 — Check if these sources exist in `vw_funnel_master` at all

```sql
SELECT
  Original_source,
  Finance_View__c,
  COUNT(*) AS cnt,
  MIN(DATE(FilterDate)) AS earliest,
  MAX(DATE(FilterDate)) AS latest
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE Original_source IN ('Search', 'Meta', 'Direct Mail', 'Webinar', 'LinkedIn Social',
                          'LinkedIn Lead Gen Form', 'Advertisement', 'Apollo', 'Purchased List',
                          'RB2B', 'Manatal', 'Reddit', 'Partner', 'Website')
GROUP BY 1, 2
ORDER BY 1, cnt DESC
```

These sources existed in the old `SourceMapping` CTE. They may still exist in `vw_funnel_master` via `Final_Source__c`, or they may have been renamed to something else. Document which ones exist and which are truly gone.

### 1.2 — Get the complete list of all Original_source values in vw_funnel_master with counts

```sql
SELECT
  Original_source,
  Finance_View__c,
  COUNT(*) AS total,
  COUNTIF(DATE(FilterDate) >= '2025-01-01') AS since_2025
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
GROUP BY 1, 2
ORDER BY total DESC
```

Save this to `C:\Users\russe\Documents\Dashboard\source_inventory.md` as a reference table.

### 1.3 — Read the Google Sheet to get ALL source names used in formulas

Read the Q2 forecast tab (sheet ID: `1JjmBA-z4yzD-iGLhrf_XTuHdBSgtQjeU1ih9c5-ujFc`, tab: `Q2 forecast`) rows 106–600, columns A–B with FORMULA render option.

Extract every unique source name that appears as a section header (these are the strings used in SUMPRODUCT formulas). Build a mapping table:

| Sheet Source Name | Exists in New View? | New View Source Name (if renamed) | Action |
|---|---|---|---|

Save this to `C:\Users\russe\Documents\Dashboard\source_name_mapping.md`.

**STOP. Report findings and wait for approval before proceeding to Phase 2.**

---

## Phase 2: Rewrite Both BQ Views

### 2.1 — Read the current view SQL files

Read both current deployed view SQL files:
- `C:\Users\russe\Documents\Dashboard\deploy_vw_channel_funnel_volume_by_month.sql`
- `C:\Users\russe\Documents\Dashboard\deploy_vw_channel_conversion_rates_pivoted.sql`

Also read the `vw_funnel_master` view definition to understand the available eligibility/progression flags:
- `C:\Users\russe\Documents\Dashboard\views\vw_funnel_master.sql` (or `views\deploy_vw_funnel_master.sql`)

Specifically note these fields in vw_funnel_master that you'll use for cohorted rates:
- `contacted_to_mql_progression` — numerator for C→MQL
- `mql_to_sql_progression` — numerator for MQL→SQL
- `sql_to_sqo_progression` — numerator for SQL→SQO
- `sqo_to_joined_progression` — numerator for SQO→Joined
- `eligible_for_contacted_conversions_30d` — denominator for C→MQL (30-day timeout)
- `eligible_for_mql_conversions` — denominator for MQL→SQL (resolved-only)
- `eligible_for_sql_conversions` — denominator for SQL→SQO (resolved-only)
- `eligible_for_sqo_conversions` — denominator for SQO→Joined (resolved-only)

### 2.2 — Rewrite the VOLUME view

Modify `deploy_vw_channel_funnel_volume_by_month.sql` with these changes:

**Change 1: Add deterministic 1:1 Original_source → Finance_View mapping**

Replace the current Finance_View CASE statement in the `FunnelBase` CTE with a TWO-STEP mapping:

```sql
-- Step A: Override multi-mapped sources to their majority Finance_View__c
CASE Original_source
  WHEN 'LinkedIn (Self Sourced)' THEN 'Outbound'
  WHEN 'Fintrx (Self-Sourced)' THEN 'Outbound'
  WHEN 'Direct Traffic' THEN 'Marketing'
  WHEN 'Re-Engagement' THEN 'Re-Engagement'
  ELSE IFNULL(Finance_View__c, 'Other')
END AS Finance_View__c_resolved,

-- Step B: Map resolved Finance_View__c to the 7 sheet labels
CASE
  WHEN Finance_View__c_resolved = 'Outbound' THEN 'Outbound'
  WHEN Finance_View__c_resolved IN ('Marketing', 'Job Applications') THEN 'Marketing'
  WHEN Finance_View__c_resolved = 'Outbound + Marketing' THEN 'Outbound + Marketing'
  WHEN Finance_View__c_resolved IN ('Recruitment Firm', 'Employee Referral', 'Partnerships') THEN 'Partnerships'
  WHEN Finance_View__c_resolved = 'Advisor Referral' THEN 'Advisor Referrals'
  WHEN Finance_View__c_resolved = 'Re-Engagement' THEN 'Re-Engagement'
  ELSE 'Other'
END AS Finance_View
```

Since you can't reference a computed column in the same SELECT, use a subquery or apply both CASE statements inline. The cleanest approach is to nest them:

```sql
CASE
  WHEN Original_source = 'LinkedIn (Self Sourced)' THEN 'Outbound'
  WHEN Original_source = 'Fintrx (Self-Sourced)' THEN 'Outbound'
  WHEN Original_source = 'Direct Traffic' THEN 'Marketing'
  WHEN Original_source = 'Re-Engagement' THEN 'Re-Engagement'
  WHEN IFNULL(Finance_View__c, 'Other') IN ('Marketing', 'Job Applications') THEN 'Marketing'
  WHEN IFNULL(Finance_View__c, 'Other') = 'Outbound' THEN 'Outbound'
  WHEN IFNULL(Finance_View__c, 'Other') = 'Outbound + Marketing' THEN 'Outbound + Marketing'
  WHEN IFNULL(Finance_View__c, 'Other') IN ('Recruitment Firm', 'Employee Referral', 'Partnerships') THEN 'Partnerships'
  WHEN IFNULL(Finance_View__c, 'Other') = 'Advisor Referral' THEN 'Advisor Referrals'
  WHEN IFNULL(Finance_View__c, 'Other') = 'Re-Engagement' THEN 'Re-Engagement'
  ELSE 'Other'
END AS Finance_View
```

The `Original_source` overrides MUST come first so they take priority for the 4 multi-mapped sources.

**No other changes to the volume view.** The rest of the logic (cohort attribution, period types, column order) remains the same.

### 2.3 — Rewrite the CONVERSION RATE view

Modify `deploy_vw_channel_conversion_rates_pivoted.sql` with these changes:

**Change 1: Same 1:1 Finance_View mapping** (identical CASE statement as the volume view)

**Change 2: Switch to cohorted conversion rates with 30-day timeout**

Replace the same-period progression logic with cohorted logic using the pre-calculated flags from `vw_funnel_master`.

The `FunnelBase` CTE needs these additional fields from `vw_funnel_master`:
```sql
contacted_to_mql_progression,
mql_to_sql_progression,
sql_to_sqo_progression,
sqo_to_joined_progression,
eligible_for_contacted_conversions_30d,  -- 30-day timeout denominator for C→MQL
eligible_for_mql_conversions,
eligible_for_sql_conversions,
eligible_for_sqo_conversions,
is_sqo_unique,
is_joined_unique
```

The monthly/quarterly CTEs change from same-period checks to simple aggregation of the pre-calculated flags:

**Contacted → MQL (monthly, cohorted with 30-day timeout):**
```sql
ContactedToMQL_M AS (
  SELECT
    contacted_month AS cohort_month,
    Finance_View,
    Original_source,
    -- Numerator: contacted that eventually became MQL
    SUM(contacted_to_mql_progression) AS c2m_num,
    -- Denominator: contacted that resolved (MQL or closed) OR 30 days elapsed
    SUM(eligible_for_contacted_conversions_30d) AS c2m_den
  FROM FunnelBase
  WHERE is_contacted = 1
    AND contacted_month IS NOT NULL
    AND contacted_month >= DATE_SUB(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL 24 MONTH)
  GROUP BY 1, 2, 3
),
```

**MQL → SQL (monthly, cohorted resolved-only):**
```sql
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
```

**SQL → SQO (monthly, cohorted resolved-only):**
```sql
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
```

**SQO → Joined (monthly, cohorted resolved-only):**
```sql
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
```

**Created → Contacted (monthly):**
Keep the existing same-period logic for this one — Created→Contacted doesn't have a pre-calculated eligibility flag in vw_funnel_master (the 30-day flag is for Contacted→MQL, not Created→Contacted). Use the existing approach:
```sql
CreatedToContacted_M AS (
  SELECT
    prospect_month AS cohort_month,
    Finance_View,
    Original_source,
    COUNTIF(is_contacted = 1 AND contacted_month = prospect_month) AS c2c_num,
    COUNT(DISTINCT primary_key) AS c2c_den
  FROM FunnelBase
  WHERE prospect_month IS NOT NULL
    AND prospect_month >= DATE_SUB(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL 24 MONTH)
  GROUP BY 1, 2, 3
),
```

Actually — wait. Created→Contacted CAN use a simple cohort approach: numerator = contacted, denominator = all prospects. No resolution gating needed because every prospect either gets contacted or doesn't — there's no "open" state that matters. So use:
```sql
CreatedToContacted_M AS (
  SELECT
    prospect_month AS cohort_month,
    Finance_View,
    Original_source,
    -- Numerator: prospects that were eventually contacted
    COUNTIF(is_contacted = 1) AS c2c_num,
    -- Denominator: all prospects created in this month
    COUNT(DISTINCT primary_key) AS c2c_den
  FROM FunnelBase
  WHERE prospect_month IS NOT NULL
    AND prospect_month >= DATE_SUB(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL 24 MONTH)
  GROUP BY 1, 2, 3
),
```

This gives the "eventual contact rate" for each prospect cohort, which is what the forecast needs.

**Apply the same quarterly CTE changes** (replace the `_Q` CTEs with the same cohorted logic, just using `_quarter` instead of `_month`).

**Everything else stays the same**: the AllCombinations, MonthlyRates, QuarterlyRates, and final SELECT with column ordering.

### 2.4 — Write the updated SQL files

Save the modified SQL to:
- `C:\Users\russe\Documents\Dashboard\deploy_vw_channel_funnel_volume_by_month.sql` (overwrite)
- `C:\Users\russe\Documents\Dashboard\deploy_vw_channel_conversion_rates_pivoted.sql` (overwrite)

### 2.5 — Dry-run validation

Before deploying, strip the `CREATE OR REPLACE VIEW` lines and run both queries with `LIMIT 100` via BigQuery MCP.

**Volume view checks:**
```sql
-- Check: no Original_source spans multiple Finance_View values
SELECT Original_source, COUNT(DISTINCT Finance_View) AS fv_count, ARRAY_AGG(DISTINCT Finance_View) AS fvs
FROM (<volume query>)
WHERE period_type IN ('QTD', 'QUARTERLY') AND cohort_year = 2026 AND cohort_quarter_num = 1
GROUP BY 1 HAVING COUNT(DISTINCT Finance_View) > 1;
-- MUST return 0 rows
```

**Conversion rate view checks:**
```sql
-- Check 1: no Original_source spans multiple Finance_View values
SELECT Original_source, COUNT(DISTINCT Finance_View) AS fv_count
FROM (<rate query>)
WHERE period_type IN ('QTD', 'QUARTERLY') AND cohort_year = 2026 AND cohort_quarter_num = 1
GROUP BY 1 HAVING COUNT(DISTINCT Finance_View) > 1;
-- MUST return 0 rows

-- Check 2: all rate values are between 0 and 1
SELECT
  MIN(contacted_to_mql_rate) AS min_c2m,
  MAX(contacted_to_mql_rate) AS max_c2m,
  MIN(mql_to_sql_rate) AS min_m2s,
  MAX(mql_to_sql_rate) AS max_m2s,
  MIN(sql_to_sqo_rate) AS min_s2q,
  MAX(sql_to_sqo_rate) AS max_s2q,
  MIN(created_to_contacted_rate) AS min_c2c,
  MAX(created_to_contacted_rate) AS max_c2c
FROM (<rate query>);
-- All values should be between 0 and 1 (c2c can exceed 1 if contacted > created due to recycling)

-- Check 3: spot-check LinkedIn (Self Sourced) Q1 2026
SELECT Finance_View, Original_source, contacted_to_mql_rate, created_to_contacted_rate
FROM (<rate query>)
WHERE Original_source = 'LinkedIn (Self Sourced)'
  AND period_type IN ('QTD', 'QUARTERLY') AND cohort_year = 2026 AND cohort_quarter_num = 1;
-- MUST return exactly 1 row with Finance_View = 'Outbound'
```

**STOP. Report dry-run results and wait for approval before deploying.**

---

## Phase 3: Deploy Views

### 3.1 — Deploy the volume view
Run the full `CREATE OR REPLACE VIEW` from the updated `deploy_vw_channel_funnel_volume_by_month.sql`.

### 3.2 — Deploy the conversion rate view
Run the full `CREATE OR REPLACE VIEW` from the updated `deploy_vw_channel_conversion_rates_pivoted.sql`.

### 3.3 — Post-deploy verification
```sql
-- Verify both views exist
SELECT table_name FROM `savvy-gtm-analytics.Tableau_Views.INFORMATION_SCHEMA.TABLES`
WHERE table_name IN ('vw_channel_funnel_volume_by_month', 'vw_channel_conversion_rates_pivoted');

-- Verify no multi-FV sources in volume view
SELECT Original_source, COUNT(DISTINCT Finance_View) AS fv_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_channel_funnel_volume_by_month`
WHERE period_type IN ('QTD', 'QUARTERLY')
GROUP BY 1 HAVING COUNT(DISTINCT Finance_View) > 1;

-- Verify no multi-FV sources in rate view
SELECT Original_source, COUNT(DISTINCT Finance_View) AS fv_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_channel_conversion_rates_pivoted`
WHERE period_type IN ('QTD', 'QUARTERLY')
GROUP BY 1 HAVING COUNT(DISTINCT Finance_View) > 1;

-- Spot check: LinkedIn (Self Sourced) rate should be reasonable (not >100%)
SELECT Finance_View, Original_source,
  created_to_contacted_rate, contacted_to_mql_rate, mql_to_sql_rate, sql_to_sqo_rate
FROM `savvy-gtm-analytics.Tableau_Views.vw_channel_conversion_rates_pivoted`
WHERE Original_source = 'LinkedIn (Self Sourced)'
  AND period_type IN ('QTD', 'QUARTERLY') AND cohort_year = 2026 AND cohort_quarter_num = 1;
```

**STOP. Report results and wait for approval before touching the Google Sheet.**

---

## Phase 4: Google Sheet Source Name Updates

### 4.1 — Build the formula update map

Using the `source_name_mapping.md` from Phase 1.3, identify every cell in the Q2 forecast tab that contains a SUMPRODUCT formula referencing an old source name.

Read the Q2 forecast tab rows 106–700, columns C through M with FORMULA render option. For each formula that contains a source name string (the part matching `monthly_conversion_rates!$H` or `Volumes!$I`), check if that source name exists in the new views.

Build a table:

| Cell | Current Formula Source Name | New View Source Name | Action |
|------|---------------------------|---------------------|--------|
| C109 | "Provided Lead List" | "Provided List (Lead Scoring)" | Replace |
| ... | ... | ... | ... |

**Do NOT update any cells yet.** Just document the mapping.

### 4.2 — Report the full update plan

Write the complete list of cells and their formula changes to `C:\Users\russe\Documents\Dashboard\sheet_formula_updates.md`.

Include:
1. Total number of cells to update
2. For each cell: old formula string → new formula string (just the source name part that changes)
3. Any sources referenced by the sheet that don't exist in the new views at all (truly gone, not renamed)
4. Risk assessment: will any formula changes break other tabs?

**STOP. Report the update plan and wait for explicit approval before modifying the Google Sheet.**

---

## Phase 5: Apply Google Sheet Updates (ONLY after Phase 4 approval)

### 5.1 — Update formulas

Using Google Sheets MCP, update each cell identified in Phase 4.2 with the corrected source name.

**Rules:**
- Only change the source name string inside the formula — do NOT change any column references, range sizes, or logical structure
- For example, if a formula contains `"Provided Lead List"`, replace ONLY that string with `"Provided List (Lead Scoring)"`. Leave everything else identical.
- Work through the cells systematically, one section at a time (Outbound sources, then Marketing, then O+M, etc.)
- After each section, verify the formulas return non-zero values for at least one historical quarter

### 5.2 — Verify the sheet

After all updates:
1. Check that no source-detail row shows rates > 100% (the inflation bug should be gone)
2. Check that no source-detail row shows 0 across all historical quarters (would indicate a remaining name mismatch)
3. Verify the summary rows (10–17) still sum correctly
4. Spot-check: Outbound Prospects Q4 2025 — should be a reasonable number (was ~17,652 in old view but will be different now due to mapping changes)

### 5.3 — Document results

Write final results to `C:\Users\russe\Documents\Dashboard\view_deployment_results.md`:
1. Views deployed successfully (Y/N)
2. Multi-FV bug eliminated (Y/N)
3. Sheet formulas updated (count of cells changed)
4. Remaining issues or sources returning 0
5. Methodology note: "Conversion rates now use cohorted resolution-based methodology with 30-day timeout for Contacted→MQL denominator. This differs from the old same-period progression approach — rates will be higher because they capture lagged conversions."
