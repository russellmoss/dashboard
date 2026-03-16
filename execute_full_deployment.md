# Execute: BQ View Deploy + Sheet Restructure

> **All decisions finalized. This prompt executes the full coordinated deployment.**
>
> **Codebase**: `C:\Users\russe\Documents\Dashboard\`
> **Google Sheet**: `1JjmBA-z4yzD-iGLhrf_XTuHdBSgtQjeU1ih9c5-ujFc`, tab `Q2 forecast`
> **Reference docs**:
> - `current_sheet_structure.md` — full inventory of current sheet layout
> - `sheet_restructure_plan.md` — new taxonomy and migration map
> - `source_inventory.md` — BQ source volumes and Finance_View mapping

---

## Approved Decisions

1. **Marketing section**: Keep Organic/Paid split as-is (organizational headers, not data-driven)
2. **Advisor Waitlist (3 SQOs)**: Redistribute to Direct Traffic
3. **Ashby → Job Applications**: Transfer Ashby's forecast values to Job Applications
4. **Fintrx (Self-Sourced)**: New PRIMARY block in Outbound, leave H/J/L blank for Russell
5. **Direct Traffic**: Promote to PRIMARY, leave H/J/L blank (add Advisor Waitlist's 3 SQOs later when Russell fills in)
6. **Provided List (Marketing)**: Promote to PRIMARY, leave H/J/L blank
7. **Unknown**: Keep as SUB-source
8. **Small Marketing SUBs** (Blog, LinkedIn Savvy, Google Ads, LinkedIn Ads): Keep
9. **Dead sources to REMOVE**: Search, LinkedIn Social, LinkedIn (Content), LinkedIn (Automation), Website, Meta, Direct Mail, Webinar, Advisor Waitlist (after redistributing SQOs)
10. **Conversion rate methodology**: Cohorted (resolution-based) with 30-day timeout for C→MQL denominator

---

## Phase 1: Rewrite & Deploy BQ Views

### 1.1 — Rewrite the Volume View SQL

Read `C:\Users\russe\Documents\Dashboard\deploy_vw_channel_funnel_volume_by_month.sql`.

**Single change needed**: Replace the Finance_View CASE statement in the `FunnelBase` CTE with this deterministic 1:1 mapping (Original_source overrides FIRST, then Finance_View__c mapping):

```sql
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
END AS Finance_View
```

Save the updated file. No other changes to the volume view.

### 1.2 — Rewrite the Conversion Rate View SQL

Read `C:\Users\russe\Documents\Dashboard\deploy_vw_channel_conversion_rates_pivoted.sql`.

Also read the vw_funnel_master definition at `C:\Users\russe\Documents\Dashboard\views\vw_funnel_master.sql` to confirm the available eligibility/progression flag field names.

**Two changes needed:**

**Change A**: Same 1:1 Finance_View CASE statement as the volume view (identical).

**Change B**: Switch from same-period progression to cohorted conversion rates.

The `FunnelBase` CTE needs these additional fields from `vw_funnel_master`:
```sql
contacted_to_mql_progression,
mql_to_sql_progression,
sql_to_sqo_progression,
sqo_to_joined_progression,
eligible_for_contacted_conversions_30d,
eligible_for_mql_conversions,
eligible_for_sql_conversions,
eligible_for_sqo_conversions
```

Replace ALL monthly rate CTEs with cohorted logic:

**ContactedToMQL_M** (30-day timeout denominator):
```sql
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
```

**MQLtoSQL_M** (resolved-only denominator):
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

**SQLtoSQO_M** (resolved-only denominator):
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

**SQOtoJoined_M** (resolved-only denominator):
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

**CreatedToContacted_M** (all-prospects denominator, eventual contact rate):
```sql
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
```

**Apply the SAME changes to the quarterly CTEs** (`_Q` versions) — same flag-based logic, just grouped by quarter instead of month.

Everything else (AllCombinations, MonthlyRates/QuarterlyRates assembly, final SELECT with column ordering) stays the same.

Save the updated file.

### 1.3 — Dry-Run Validation

Strip `CREATE OR REPLACE VIEW` from both SQL files and run with `LIMIT 100` via BigQuery MCP.

**Volume view checks:**
```sql
-- No multi-FV sources (MUST return 0 rows)
SELECT Original_source, COUNT(DISTINCT Finance_View) AS fv_count,
  ARRAY_AGG(DISTINCT Finance_View) AS fvs
FROM (<volume query without CREATE VIEW>)
WHERE period_type IN ('QTD', 'QUARTERLY') AND cohort_year = 2026 AND cohort_quarter_num = 1
GROUP BY 1 HAVING COUNT(DISTINCT Finance_View) > 1;

-- Distinct Finance_View values (MUST be exactly 7)
SELECT DISTINCT Finance_View FROM (<volume query>) ORDER BY 1;
```

**Conversion rate view checks:**
```sql
-- No multi-FV sources (MUST return 0 rows)
SELECT Original_source, COUNT(DISTINCT Finance_View) AS fv_count
FROM (<rate query without CREATE VIEW>)
WHERE period_type IN ('QTD', 'QUARTERLY') AND cohort_year = 2026 AND cohort_quarter_num = 1
GROUP BY 1 HAVING COUNT(DISTINCT Finance_View) > 1;

-- Rate bounds check (all rates should be 0–1, except c2c which can exceed 1 due to recycled leads)
SELECT
  MAX(contacted_to_mql_rate) AS max_c2m,
  MAX(mql_to_sql_rate) AS max_m2s,
  MAX(sql_to_sqo_rate) AS max_s2q,
  MAX(sqo_to_joined_rate) AS max_q2j
FROM (<rate query>);
-- All should be <= 1.0

-- LinkedIn (Self Sourced) spot check (MUST be exactly 1 row)
SELECT Finance_View, Original_source, contacted_to_mql_rate, created_to_contacted_rate
FROM (<rate query>)
WHERE Original_source = 'LinkedIn (Self Sourced)'
  AND period_type IN ('QTD', 'QUARTERLY') AND cohort_year = 2026 AND cohort_quarter_num = 1;
```

### 1.4 — Deploy Both Views

If all checks pass:

```sql
-- Deploy volume view
CREATE OR REPLACE VIEW `savvy-gtm-analytics.Tableau_Views.vw_channel_funnel_volume_by_month` AS
-- (full SQL from file)

-- Deploy conversion rate view
CREATE OR REPLACE VIEW `savvy-gtm-analytics.Tableau_Views.vw_channel_conversion_rates_pivoted` AS
-- (full SQL from file)
```

Verify both exist:
```sql
SELECT table_name FROM `savvy-gtm-analytics.Tableau_Views.INFORMATION_SCHEMA.TABLES`
WHERE table_name IN ('vw_channel_funnel_volume_by_month', 'vw_channel_conversion_rates_pivoted');
```

**STOP. Report deployment results and wait for approval before touching the Google Sheet.**

---

## Phase 2: Restructure Google Sheet

### Execution Rules

- Work in the `Q2 forecast` tab of sheet `1JjmBA-z4yzD-iGLhrf_XTuHdBSgtQjeU1ih9c5-ujFc`
- Use Google Sheets MCP for all reads and writes
- **Do ONE Finance_View group at a time**, verify after each group
- When deleting row blocks: delete entire rows (shift up), NOT just clear content
- When inserting new source blocks: use the standard 11-stage template with SUMPRODUCT formulas matching the patterns in `current_sheet_structure.md`
- Preserve all formatting from existing blocks when creating new ones
- **NEVER touch the summary section (rows 1–105)** — those formulas reference column B labels which won't change

### Important: Row Number Shifts

When you delete rows, all subsequent row numbers shift. **Track the cumulative offset** as you work top-to-bottom. Better yet: work **bottom-to-top** (start with Other group, work up to Outbound) so deletions don't affect row numbers of groups you haven't processed yet.

### 2.1 — Group 7: Other (rows 420–446)

**No changes.** Keep both "Other" (PRIMARY) and "Unknown" (SUB) as-is.

Verify: read rows 420–446, confirm structure intact.

### 2.2 — Group 6: Advisor Referrals (rows 405–419)

**No changes.** Keep "Advisor Referral" (PRIMARY) as-is.

Verify: read rows 405–419.

### 2.3 — Group 5: Partnerships (rows 390–404)

**No changes.** Keep "Recruitment Firm" (PRIMARY) as-is.

Verify: read rows 390–404.

### 2.4 — Group 4: Re-Engagement (rows 375–389)

**No changes.** Keep "Re-Engagement" (PRIMARY) as-is.

Verify: read rows 375–389.

### 2.5 — Group 3: Outbound + Marketing (rows 321–374)

**Changes:**
1. **REMOVE** Direct Mail (rows 336–347): Delete these 12 rows
2. **REMOVE** Webinar (rows 349–360 — AFTER Direct Mail deletion, row numbers shift): Delete these 12 rows
3. **PROMOTE** Provided List (Marketing) to PRIMARY: This source block already exists. Add monthly forecast structure to columns H/J/L. Leave values blank (Russell will fill in). Add column G formulas: `=SUM(H{row},J{row},L{row})` for volumes, `=AVERAGE(C{row}:E{row})` for rates.

After changes, verify:
- Events block intact with correct formulas
- Provided List (Marketing) now has H/J/L formula structure
- No orphan rows between blocks

### 2.6 — Group 2: Marketing (rows 134–320)

This is the biggest group. Work sub-section by sub-section.

**Marketing Organic (rows 134–252):**

1. Keep header row 134
2. **KEEP** Blog (SUB) — no changes
3. **REMOVE** Search (rows 149–160): Delete 12 rows
4. **KEEP** LinkedIn Savvy (SUB) — no changes
5. **REMOVE** LinkedIn Social: Delete 12 rows
6. **REMOVE** LinkedIn (Content): Delete 12 rows
7. **REMOVE** LinkedIn (Automation): Delete 12 rows
8. **PROMOTE** Direct Traffic to PRIMARY: Add H/J/L formula structure, leave values blank
9. **REMOVE** Website: Delete 12 rows
10. **REMOVE** Advisor Waitlist: Delete 12 rows. (Its 3 forecast SQOs will be added to Direct Traffic by Russell manually later.)

**Marketing Paid (rows 253–320, row numbers will have shifted):**

1. Keep header row for Paid section
2. **KEEP** Google Ads + LinkedIn Ads (PRIMARY) — no changes
3. **REPLACE** Ashby with Job Applications:
   - Change the source name in the source name cell (B269 or wherever it is after shifts) from `"Ashby"` to `"Job Applications"`
   - Update ALL SUMPRODUCT formulas in this block to reference `"Job Applications"` instead of `"Ashby"` (or if they use a B-cell reference, just changing B is enough)
   - Transfer Ashby's monthly forecast values (Created=5/5/5, rates=0.75/0.5/0.5/0.8) to Job Applications as-is. Russell may adjust later.
4. **KEEP** Google Ads (SUB) — no changes
5. **REMOVE** Meta: Delete 12 rows
6. **KEEP** LinkedIn Ads (SUB) — no changes

After all Marketing changes, verify:
- Blog, LinkedIn Savvy, Direct Traffic, Google Ads + LinkedIn Ads, Job Applications, Google Ads, LinkedIn Ads all present
- No rates >100% for sources with single Finance_View
- No zero-data sources except genuinely new/small ones

### 2.7 — Group 1: Outbound (rows 106–133)

**Changes:**
1. **RENAME** source #1: Change the source name cell from `"Provided Lead List (Lead Scoring)"` to `"Provided List (Lead Scoring)"`
2. **FIX** hardcoded formula strings: The SUMPRODUCT formulas in this block hardcode `="Provided Lead List"`. These need to be changed to either:
   - A cell reference to the source name cell (preferred — consistent with other blocks), OR
   - Hardcoded `="Provided List (Lead Scoring)"`
   Check which formulas use the hardcoded string vs cell reference. Update ALL hardcoded strings.
3. **KEEP** LinkedIn (Self Sourced) — no changes
4. **ADD** Fintrx (Self-Sourced) as new PRIMARY block:
   - Insert 13 new rows after the LinkedIn (Self Sourced) block (11 stage rows + source name row + 1 blank separator)
   - Source name cell: `"Fintrx (Self-Sourced)"`
   - Copy the SUMPRODUCT formula pattern from the LinkedIn (Self Sourced) block
   - Replace the source name reference in all formulas to point to the new Fintrx source name cell
   - Add H/J/L structure (column G = `=SUM(H,J,L)`, rates = `=AVERAGE(C:E)`)
   - Leave H/J/L VALUES blank (Russell will fill in)

After Outbound changes, verify:
- Provided List (Lead Scoring) formulas return non-zero historical data for at least Q3/Q4 2025
- LinkedIn (Self Sourced) unchanged
- Fintrx (Self-Sourced) shows historical data in C–F (it has 1,817 records since 2025)

### 2.8 — Summary Row Verification

After ALL group changes are complete:

1. Read the summary section rows 10–53
2. Verify each Finance_View summary row (10–17) still sums correctly:
   - Row 10 Prospects total = sum of rows 11–17
   - Each Finance_View row's SUMPRODUCT formula should still work (they match on Finance_View column L in the Volumes tab, not on source names)
3. Verify Total Forecast SQOs (cell C4 or wherever it lives) still computes
4. Spot check: no rates >100% in the source-detail sections

**STOP. Report all results and any issues found.**

---

## Phase 3: Final Verification & Documentation

### 3.1 — End-to-end spot checks

Read key cells from the updated sheet and compare against BQ:

```sql
-- Q4 2025 Outbound Prospects (should match C11 in sheet after refresh)
SELECT SUM(prospects_created) FROM `savvy-gtm-analytics.Tableau_Views.vw_channel_funnel_volume_by_month`
WHERE Finance_View = 'Outbound' AND period_type = 'QUARTERLY'
  AND cohort_year = 2025 AND cohort_quarter_num = 4;

-- Q4 2025 Outbound C→MQL rate for LinkedIn (Self Sourced)
SELECT contacted_to_mql_rate FROM `savvy-gtm-analytics.Tableau_Views.vw_channel_conversion_rates_pivoted`
WHERE Original_source = 'LinkedIn (Self Sourced)' AND period_type = 'QUARTERLY'
  AND cohort_year = 2025 AND cohort_quarter_num = 4;
```

Compare with the corresponding sheet cells.

### 3.2 — Write deployment results

Save to `C:\Users\russe\Documents\Dashboard\restructure_results.md`:

1. **BQ Views**: Deployed successfully? Multi-FV bug eliminated? Rate methodology confirmed cohorted?
2. **Sheet Changes**:
   - Sources removed (list)
   - Sources added (list)
   - Sources renamed (list)
   - Sources promoted to PRIMARY (list)
   - Formula strings updated (count)
3. **Verification**:
   - Summary rows valid? (Y/N)
   - Source-detail rates all ≤100% (excluding c2c)? (Y/N)
   - Historical data visible for existing sources? (Y/N)
   - New sources (Fintrx, promoted sources) show historical data? (Y/N)
4. **Remaining manual work for Russell**:
   - Fill in Fintrx (Self-Sourced) monthly forecast values (H/J/L)
   - Fill in Direct Traffic monthly forecast values
   - Fill in Provided List (Marketing) monthly forecast values
   - Optionally add Advisor Waitlist's 3 SQOs to Direct Traffic forecast
   - Optionally adjust Job Applications rates (transferred from Ashby as-is)
   - Refresh the BQ-connected tabs (Volumes, monthly_conversion_rates, vw_channel_*) if they don't auto-refresh
5. **Methodology note**: "Conversion rates now use cohorted resolution-based methodology with 30-day timeout for Contacted→MQL denominator. Rates will differ from the old same-period approach — typically higher because they capture lagged conversions that previously went uncounted."
