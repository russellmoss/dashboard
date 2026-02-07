# Cursor Prompt: Implement 30-Day "Effectively Closed" Rule for Contacted→MQL Conversion Rate

## Context

We currently calculate Contacted→MQL conversion rates using only **resolved** leads in the denominator — leads that either converted to MQL or were closed. The problem is that leads sit in Contacting for 90-103+ days before being auto-closed by operations, which means recent cohorts have artificially inflated conversion rates because only "winners" are resolved early.

We've validated through data analysis that treating leads as "effectively resolved" after **30 days** in Contacting without converting to MQL gives us an accurate early read on conversion rates (~9% false-negative rate, self-corrects when late converters eventually MQL). Full analysis is in `contacted-to-mql-investigation.md`.

**Apply the 30-day rule globally across all sources.** The investigation (Section 4f) notes that **Recruitment Firm** and **Job Applications** have >40% of converters after 30 days; optionally apply a longer cutoff or exclusion for those sources in a follow-up. This implementation plan does the **global 30-day** rule first.

## What to change

**The rule:** For Contacted→MQL conversion rate calculations ONLY, a lead is "eligible" (in the denominator) if:
- It entered Contacting (`stage_entered_contacting__c IS NOT NULL`), AND
- ANY of the following:
  - It became MQL (`Stage_Entered_Call_Scheduled__c IS NOT NULL` / `mql_stage_entered_ts IS NOT NULL`)
  - It was closed (`lead_closed_date IS NOT NULL` / `Stage_Entered_Closed__c IS NOT NULL`)
  - **NEW:** It has been in Contacting for 30+ days without MQL: `DATE(stage_entered_contacting__c) + 30 <= CURRENT_DATE()` AND `Stage_Entered_Call_Scheduled__c IS NULL` AND `Stage_Entered_Closed__c IS NULL`

**The numerator does NOT change.** `contacted_to_mql_progression` stays exactly as-is.

**No other conversion rates change.** MQL→SQL, SQL→SQO, SQO→Joined — all untouched. Only the Contacted→MQL denominator is affected.

**No Salesforce data changes.** This is reporting logic only.

## Where Contacted→MQL conversion rate appears (all must use 30-day denominator)

| Surface | Backed by | Change |
|--------|-----------|--------|
| **Funnel performance — scorecards** | `conversion-rates.ts` (cohort + period) | Use `eligible_for_contacted_conversions_30d` (cohort); add 30d branch to period inline COUNTIF |
| **Funnel performance — conversion trend chart** | `conversion-rates.ts` (cohort + period trend) | Use `eligible_for_contacted_conversions_30d` in cohort CTE; add 30d branch in period `contacted_to_mql` CTE |
| **Source performance table** | `source-performance.ts` | Use `eligible_for_contacted_conversions_30d` in both channel and source rate calculations |
| **Channel performance table** | `source-performance.ts` | Same as above |
| **Semantic layer / Explore / saved reports** | `definitions.ts` + `query-compiler.ts` | `denominatorField` and SQL fragment → `eligible_for_contacted_conversions_30d`; `stageFlags.contacted.eligible` → 30d |
| **Record detail view** | `record-detail.ts` | Add/use 30d field so detail matches rate logic |
| **Export (records + sheets)** | `export-records.ts`; sheets use API | Use 30d in export-records; sheets get updated rate from API automatically |

UI components (`ConversionRateCards`, `ConversionTrendChart`, `SourcePerformanceTable`, `ChannelPerformanceTable`, `SaveReportModal`, dashboard page) consume API/query results; no changes needed there once the backing queries use the 30-day rule.

## Files to modify (in order)

Reference the investigation doc Section 6 for full mapping. Here are the specific changes:

### 1. `views/vw_funnel_master.sql`

Add a new field `eligible_for_contacted_conversions_30d` alongside the existing `eligible_for_contacted_conversions`. Do NOT modify the existing field — other consumers may use it for non-conversion-rate purposes in the future.

The view defines eligibility using `is_contacted`, `is_mql`, and `lead_closed_date` (see lines 327–330). Mirror that pattern and add the 30-day branch:

```sql
-- 30-day effective resolution for Contacted→MQL denominator (reporting only)
CASE
  WHEN is_contacted = 1 AND (
    is_mql = 1
    OR lead_closed_date IS NOT NULL
    OR (
      mql_stage_entered_ts IS NULL
      AND lead_closed_date IS NULL
      AND DATE(stage_entered_contacting__c) + 30 <= CURRENT_DATE()
    )
  )
  THEN 1 ELSE 0
END AS eligible_for_contacted_conversions_30d,
```

**Important:** Use the same source fields/aliases as the existing `eligible_for_contacted_conversions` (e.g. `is_contacted`, `is_mql`, `lead_closed_date`; the view may expose `stage_entered_contacting__c` and `mql_stage_entered_ts` from the underlying CTEs). Match the actual column names in the view. The key addition is the third OR branch with the 30-day check.

Keep `eligible_for_contacted_conversions` exactly as it is. Do not rename or remove it.

### 2. `src/lib/queries/conversion-rates.ts` (funnel performance: scorecards + trend)

Contacted→MQL must use the 30-day rule in **all** code paths so the funnel performance page (scorecards and conversion trend chart) is consistent.

**2a. Scorecard — cohort mode**  
- Uses `SUM(v.eligible_for_contacted_conversions)` (and `SUM(CASE ... eligible_for_contacted_conversions ...)` in the main SELECT).  
- **Change:** Replace with `eligible_for_contacted_conversions_30d` everywhere the Contacted→MQL denominator is computed.

**2b. Scorecard — period mode**  
- Uses **inline** `COUNTIF(...)` for the Contacted→MQL denominator (entry in period AND resolved in period: MQL in period OR closed in period). It does **not** use the view field.  
- **Change:** Add a third OR branch so that "resolved" also includes: no MQL and no close and `DATE(v.stage_entered_contacting__c) + 30 <= CURRENT_DATE()` (and still restrict to contacted-in-period). So the denominator = contacted in period AND (MQL in period OR closed in period OR (v.mql_stage_entered_ts IS NULL AND v.lead_closed_date IS NULL AND DATE(v.stage_entered_contacting__c) + 30 <= CURRENT_DATE())).

**2c. Trend — cohort mode** (`buildCohortModeQuery`)  
- CTE `contacted_cohort` uses `SUM(v.eligible_for_contacted_conversions)` as `eligible_contacts`.  
- **Change:** Replace with `SUM(v.eligible_for_contacted_conversions_30d)`.

**2d. Trend — period mode** (`buildPeriodModeQuery`)  
- CTE `contacted_to_mql` uses **inline** `COUNTIF` for denominator: same-period MQL or same-period closed.  
- **Change:** Add a third OR branch for 30-day effective resolution: no MQL and no close and `DATE(v.stage_entered_contacting__c) + 30 <= LAST_DAY(TIMESTAMP(v.stage_entered_contacting__c))` (so "resolved in period" includes "30+ days in Contacting by end of that period").

**Do NOT change:**  
- The numerator (`contacted_to_mql_progression`) in all of the above.  
- Any other conversion rate denominators (MQL→SQL, SQL→SQO, SQO→Joined).

### 3. `src/lib/queries/source-performance.ts` (source performance + channel performance tables)

This file powers the **Source Performance** and **Channel Performance** tables on the dashboard (e.g. `SourcePerformanceTable.tsx`, `ChannelPerformanceTable.tsx`). The Contacted→MQL rate appears as `contacted_to_mql_rate` / `contactedToMqlRate`.

- **Change:** Find both Contacted→MQL rate calculations (channel-level and source-level; they use `SUM(eligible_for_contacted_conversions)` in the denominator). Replace with `eligible_for_contacted_conversions_30d`.

**This must match conversion-rates.ts** — the funnel scorecards and the source/channel performance tables must show the same Contacted→MQL logic. If the scorecard and the source performance table disagree, that's a bug.

### 4. `src/lib/semantic-layer/definitions.ts` (semantic layer: Explore / saved reports)

The semantic layer backs **Explore** and **saved reports**. `CONVERSION_METRICS.contacted_to_mql_rate` must use the same 30-day denominator so Explore and the funnel performance page agree.

- **Change:** Find `CONVERSION_METRICS.contacted_to_mql_rate`. Update:
  - `denominatorField` from `'eligible_for_contacted_conversions'` to `'eligible_for_contacted_conversions_30d'`
  - The SQL fragment (numerator/denominator `SUM(CASE ... THEN v.eligible_for_contacted_conversions ...)`) to use `eligible_for_contacted_conversions_30d`

### 5. `src/lib/semantic-layer/query-compiler.ts`

The compiler builds BigQuery from the definitions and has a **stageFlags** map (e.g. `contacted.eligible: 'eligible_for_contacted_conversions'`) used for multi-stage conversion and other templates.

- **Change:** Search for `eligible_for_contacted_conversions`. For the **Contacted→MQL** metric only (e.g. `stageFlags.contacted.eligible`), set to `'eligible_for_contacted_conversions_30d'`. Leave other stages unchanged.

### 6. `src/lib/queries/record-detail.ts`

This query selects `eligible_for_contacted_conversions` (and `contacted_to_mql_progression`) for the record detail view. For consistency with the dashboard rate:

- **Change:** Add `eligible_for_contacted_conversions_30d` to the SELECT and map it in the result (e.g. `eligibleForContactedConversions30d`). Optionally switch the "eligible for conversion" display to the 30d field so detail view matches the rate logic; otherwise keep both and document which is used for the rate.

### 7. `src/lib/queries/export-records.ts`

Exports include `eligible_for_contacted_conversions` and are used for Contacted→MQL analysis (e.g. `contactedToMql` array built from eligibility + progression).

- **Change:** Add `eligible_for_contacted_conversions_30d` to the SELECT and to the exported row type. Use the 30d field when building the Contacted→MQL analysis (e.g. `eligibleForContactedConversions` in the export should reflect the 30d rule so exported analysis matches the dashboard).

### 8. `src/app/api/dashboard/export-sheets/route.ts` and `src/lib/sheets/google-sheets-exporter.ts`

These consume **API results** (conversion rates from the dashboard API: `ratesResult.contactedToMql.rate`, numerator, denominator). They do **not** reference the view field name directly.

- **Change:** None required in these files. Once `conversion-rates.ts` and `source-performance.ts` use `eligible_for_contacted_conversions_30d`, the exported sheets will automatically show the updated Contacted→MQL rate. If any sheet formula or column references the old denominator by name in a comment or constant, update that comment/constant for clarity.

### 9. Types files

- `src/types/bigquery-raw.ts` — add `eligible_for_contacted_conversions_30d` to the raw result type if any query selects this view field.
- `src/types/record-detail.ts` — add a property for the 30d eligibility field if record-detail returns it (e.g. `eligibleForContactedConversions30d`).
- `src/types/dashboard.ts`, `src/types/saved-reports.ts` — no change needed for the denominator field name; they use `contactedToMql` / rate/numerator/denominator from API responses.

## Files to update (documentation)

After making the code changes, update these docs to reflect the new 30-day logic:

- `docs/CALCULATIONS.md` — update Contacted→MQL formulas and eligibility logic
- `docs/ARCHITECTURE.md` — note the 30d field
- `docs/GROUND-TRUTH.md` — expected rates will change; note that the denominator now uses 30-day effective resolution
- `docs/GLOSSARY.md` — add/update definition for `eligible_for_contacted_conversions_30d`
- `docs/semantic_layer/PHASE_1_VALIDATION_RESULTS.md` — update backing field reference
- `docs/semantic_layer/semantic_layer_corrections.md` — update if it references the denominator
- `docs/SEMANTIC_LAYER_REVIEW_GUIDE.md` — update test SQL
- `.cursorrules` — update Contacted→MQL denominator reference

## Validation

After making changes, write a test query (or add to existing tests) that confirms:

1. **New field exists:** `SELECT eligible_for_contacted_conversions_30d FROM vw_funnel_master LIMIT 10` returns results
2. **Old field unchanged:** `SELECT eligible_for_contacted_conversions FROM vw_funnel_master LIMIT 10` still works and returns the same values as before
3. **30d field is a superset:** `eligible_for_contacted_conversions_30d >= eligible_for_contacted_conversions` for every row (the 30d field can only add leads to the denominator, never remove them)
4. **Numerator unchanged:** `contacted_to_mql_progression` values are identical before and after
5. **Spot check a recent cohort:** For a month like 2025-10 or 2025-11 (recent but not too recent), compare:
   - Old rate: `SUM(contacted_to_mql_progression) / SUM(eligible_for_contacted_conversions)`
   - New rate: `SUM(contacted_to_mql_progression) / SUM(eligible_for_contacted_conversions_30d)`
   - The new rate should be lower (larger denominator) for recent cohorts and roughly the same for mature cohorts

## Post-implementation verification checklist

Run through these three checks **after** completing the implementation (Steps 1–9). They catch the most common mistakes: missing period-mode logic and inconsistent scorecard vs source performance.

### 1. Period-mode inline logic (2b and 2d) — the trickiest part

The period-mode denominator **does not use the view field**; it uses **inline** `COUNTIF`. Confirm the code actually **added the 30-day OR branch** and did not just swap a field name. Cohort-mode changes are straightforward field swaps; period mode requires **new conditional logic**.

**What to verify:**

- **File:** `src/lib/queries/conversion-rates.ts`
- **2b — Period scorecard:** In the block where `mode === 'period'` (around the first `contacted_denom`), open the `COUNTIF(...)` for the Contacted→MQL denominator. You must see **three** OR conditions:
  1. Resolved by becoming MQL in period  
  2. Resolved by being closed in period  
  3. **Resolved by 30-day rule:** no MQL, no close, and `DATE(v.stage_entered_contacting__c) + 30 <= CURRENT_DATE()` (with the same “contacted in period” filters)
- **2d — Period trend:** In `buildPeriodModeQuery`, find the CTE `contacted_to_mql`. The denominator `COUNTIF(...)` must also have **three** OR conditions:
  1. MQL in same period as contacted  
  2. Closed in same period as contacted  
  3. **30-day effective resolution:** no MQL, no close, and `DATE(v.stage_entered_contacting__c) + 30 <= LAST_DAY(TIMESTAMP(v.stage_entered_contacting__c))` (or equivalent “resolved by end of period”)

If you only see **two** OR conditions in either place, 2b or 2d was not implemented correctly.

### 2. Source performance matches scorecard

The funnel scorecard and the source performance table must use the **same** Contacted→MQL denominator. If one was updated and the other was not, they will diverge.

**What to verify:**

- Filter the dashboard to a **single recent month** and **one source** (e.g. October 2025, LinkedIn).
- Compare the **Contacted→MQL rate** on the **scorecard** (funnel performance) vs the **Source Performance** table for that source.
- They should be **identical** for a single-source filter. If they diverge, one of `conversion-rates.ts` or `source-performance.ts` did not get the 30d swap (or period-mode logic is missing in conversion-rates while source-performance uses the view field).

### 3. Run validation queries (#3 and #5)

Run these in BigQuery (replace `your_project.your_dataset` and table with your actual view/table).

**Check #3 — 30d field is a superset of the old field**

```sql
SELECT
  COUNT(*) AS total_rows,
  COUNTIF(eligible_for_contacted_conversions_30d >= eligible_for_contacted_conversions) AS rows_where_30d_superset,
  COUNTIF(eligible_for_contacted_conversions_30d < eligible_for_contacted_conversions) AS rows_where_30d_smaller
FROM `your_project.your_dataset.vw_funnel_master`;
```

- Expect: `rows_where_30d_superset` = `total_rows`, and `rows_where_30d_smaller` = 0. The 30d field can only add leads to the denominator, never remove them.

**Check #5 — Spot-check a recent cohort (fastest end-to-end check)**

Pick a month like **2025-10** (or your most recent full month). Run:

```sql
DECLARE cohort_month DATE DEFAULT '2025-10-01';

SELECT
  SUM(contacted_to_mql_progression) AS numer,
  SUM(eligible_for_contacted_conversions) AS denom_old,
  SUM(eligible_for_contacted_conversions_30d) AS denom_30d,
  SAFE_DIVIDE(SUM(contacted_to_mql_progression), SUM(eligible_for_contacted_conversions)) AS rate_old,
  SAFE_DIVIDE(SUM(contacted_to_mql_progression), SUM(eligible_for_contacted_conversions_30d)) AS rate_30d
FROM `your_project.your_dataset.vw_funnel_master` v
WHERE v.stage_entered_contacting__c IS NOT NULL
  AND DATE(v.stage_entered_contacting__c) >= cohort_month
  AND DATE(v.stage_entered_contacting__c) < DATE_ADD(cohort_month, INTERVAL 1 MONTH);
```

- Expect: `denom_30d` ≥ `denom_old`; `rate_30d` ≤ `rate_old` for recent cohorts; and the **dashboard** Contacted→MQL rate for that month (cohort mode) should match `rate_30d`, not `rate_old`. If the dashboard matches the new rate, the whole chain (view → conversion-rates → API → UI) is correct.

---

**Current codebase status (as of last implementation):** Implementation complete. `conversion-rates.ts` and `source-performance.ts` use `eligible_for_contacted_conversions_30d`; period-mode Contacted→MQL denominator has **three** OR conditions in both the period scorecard and the `contacted_to_mql` trend CTE. Deploy the updated `vw_funnel_master.sql` to BigQuery, then run the checklist above (and BQ validation queries) to confirm.

## Summary

- **View:** Add `eligible_for_contacted_conversions_30d` to `vw_funnel_master.sql` (CASE...END AS; mirror existing eligibility using `is_contacted`, `is_mql`, `lead_closed_date`, plus 30-day branch).
- **Funnel performance (scorecards + trend):** In `conversion-rates.ts`, use `eligible_for_contacted_conversions_30d` for **cohort** mode (scorecard and trend). For **period** mode (scorecard and trend), add the 30-day “effectively resolved” branch to the **inline** Contacted→MQL denominator (no view field there today).
- **Source / channel performance:** In `source-performance.ts`, use `eligible_for_contacted_conversions_30d` for both channel and source Contacted→MQL rate.
- **Semantic layer:** In `definitions.ts` and `query-compiler.ts`, set Contacted→MQL denominator to `eligible_for_contacted_conversions_30d` so Explore and saved reports match the dashboard.
- **Record detail + export:** In `record-detail.ts` and `export-records.ts`, add/use the 30d field so detail and exports reflect the same rate logic. Sheets use API; no code change needed there.
- **Types:** Add the 30d field to types where queries return it.
- **Docs:** Update CALCULATIONS, ARCHITECTURE, GROUND-TRUTH, GLOSSARY, semantic-layer docs, and .cursorrules as listed.
- Keep the old field, keep the numerator, don’t touch other conversion rates.
- Validate with the comparison query in the Validation section.

The investigation doc at `contacted-to-mql-investigation.md` (Section 6 for code mapping; Sections 4e–4f for cutoff and optional source-specific handling) has the full data analysis backing this decision.
