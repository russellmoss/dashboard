# Plan: Sheet Source-Detail Restructure + View Deploy

> **Goal**: Before deploying anything, produce a complete restructure plan that maps the new `Final_Source__c` taxonomy onto the Q2 forecast sheet's source-detail sections (rows 106+). Once approved, deploy views and restructure the sheet in one coordinated push.
>
> **Dashboard codebase**: `C:\Users\russe\Documents\Dashboard\`
> **Google Sheet**: `1JjmBA-z4yzD-iGLhrf_XTuHdBSgtQjeU1ih9c5-ujFc`, tab `Q2 forecast`
> **Reference files already created**:
> - `source_inventory.md` — complete Original_source × Finance_View__c cross-reference
> - `source_name_mapping.md` — current sheet↔BQ mapping

---

## Phase 1: Map Current Sheet Structure

### 1.1 — Read the FULL source-detail section of the Q2 forecast tab

Read `'Q2 forecast'!A106:N700` with FORMULA render option.

For each Finance_View group (Outbound, Marketing, O+M, Re-Engagement, Partnerships, Advisor Referrals, Other), document:
- Group header row number
- Each source within the group:
  - Source name (from column B)
  - Row range (e.g., rows 108–120 for first source)
  - The funnel stages present (Created, Created→Contacted rate, Contacted, C→MQL rate, MQL, MQL→SQL rate, SQL, SQL→SQO rate, SQO, SQO→Joined rate, Joined)
  - Which formula columns are populated (C–F for historical, G for forecast, H–M for monthly)

Build a structured table:

| Finance_View Group | Source Name | Start Row | End Row | Stages | Formula Pattern |
|---|---|---|---|---|---|

Save to `C:\Users\russe\Documents\Dashboard\current_sheet_structure.md`.

### 1.2 — How does the forecast column (G) work for source-detail rows?

Read column G formulas for the source-detail section. Determine:
- Are these hardcoded manual inputs?
- Are they formulas referencing other cells?
- Do they use the trailing historical rates (C–F) to project forward?
- Or are they purely manual overrides?

This matters because if column G has manual forecast values, we need to preserve or re-map them during restructure.

Document the pattern in `current_sheet_structure.md`.

### 1.3 — Are there any other tabs that reference the source-detail rows?

Check if any formulas in these tabs reference rows 106+ of the Q2 forecast tab:
- `re-forecast summary`
- `BQ_Export_Format`
- `Funnel summary`
- `Sheet4`

If yes, those downstream references also need updating.

**STOP. Report the current structure and wait for approval.**

---

## Phase 2: Design the New Structure

### 2.1 — Build the new source taxonomy

Using `source_inventory.md`, for each Finance_View group, list the `Original_source` values that:
1. Have meaningful volume (>10 records since 2025-01-01)
2. Map to that Finance_View via the deterministic 1:1 CASE mapping

Query BQ to get recent volumes per source:

```sql
SELECT
  -- Apply the same deterministic mapping the views will use
  CASE
    WHEN Original_source = 'LinkedIn (Self Sourced)' THEN 'Outbound'
    WHEN Original_source = 'Fintrx (Self-Sourced)' THEN 'Outbound'
    WHEN Original_source = 'Direct Traffic' THEN 'Marketing'
    WHEN Original_source = 'Re-Engagement' THEN 'Re-Engagement'
    WHEN Original_source = 'Recruitment Firm' THEN 'Partnerships'
    WHEN IFNULL(Finance_View__c, 'Other') IN ('Marketing', 'Job Applications') THEN 'Marketing'
    WHEN IFNULL(Finance_View__c, 'Other') = 'Outbound' THEN 'Outbound'
    WHEN IFNULL(Finance_View__c, 'Other') = 'Outbound + Marketing' THEN 'Outbound + Marketing'
    WHEN IFNULL(Finance_View__c, 'Other') IN ('Recruitment Firm', 'Employee Referral', 'Partnerships') THEN 'Partnerships'
    WHEN IFNULL(Finance_View__c, 'Other') = 'Advisor Referral' THEN 'Advisor Referrals'
    WHEN IFNULL(Finance_View__c, 'Other') = 'Re-Engagement' THEN 'Re-Engagement'
    ELSE 'Other'
  END AS Finance_View,
  Original_source,
  COUNT(*) AS total_records,
  COUNTIF(DATE(FilterDate) >= '2025-01-01') AS records_since_2025,
  COUNTIF(DATE(FilterDate) >= '2025-07-01') AS records_since_h2_2025,
  COUNTIF(is_contacted = 1 AND DATE(stage_entered_contacting__c) >= '2025-01-01') AS contacted_since_2025,
  COUNTIF(is_mql = 1 AND DATE(mql_stage_entered_ts) >= '2025-01-01') AS mqls_since_2025,
  COUNTIF(is_sql = 1 AND DATE(converted_date_raw) >= '2025-01-01') AS sqls_since_2025
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
GROUP BY 1, 2
ORDER BY 1, records_since_2025 DESC
```

### 2.2 — Propose the new source-detail layout

For each Finance_View group, propose which sources get their own detail section. Rules:
- Include a source if it has **>25 prospects since 2025** (meaningful for rate calculation)
- Sources with <25 records get rolled into a group "Other [Finance_View]" row or omitted
- Preserve the same funnel stage rows per source (Created, C→Contacted rate, Contacted, C→MQL rate, MQL, M→SQL rate, SQL, S→SQO rate, SQO, Q→Joined rate, Joined)

Build the proposed layout:

```
== Outbound (Cohorted View) ==
  Sources:
    1. Provided List (Lead Scoring)    [was "Provided Lead List"]
    2. LinkedIn (Self Sourced)          [unchanged]
    3. Fintrx (Self-Sourced)            [NEW — was in "Other"]
    ... etc

== Marketing (Cohorted View) ==
  Sources:
    1. Google Ads                       [unchanged]
    2. LinkedIn Ads                     [unchanged]
    3. Job Applications                 [NEW — includes old Dover, Ashby, Manatal]
    4. Direct Traffic                   [was split across groups, now pinned to Marketing]
    5. Blog                             [was "Search" or separate]
    ... etc

== Outbound + Marketing ==
  Sources:
    1. Events                           [unchanged]
    2. Provided List (Marketing)        [was "Provided Lead List (Marketing)"]
    ... etc

== Re-Engagement ==
  Sources:
    1. Re-Engagement                    [unchanged]

== Partnerships ==
  Sources:
    1. Recruitment Firm                 [was under "Partnerships"]
    2. Employee Referral                [NEW or was under "Partnerships"]

== Advisor Referrals ==
  Sources:
    1. Advisor Referral                 [unchanged]

== Other ==
  Sources:
    1. Other                            [catch-all]
    2. Unknown                          [if meaningful volume]
```

### 2.3 — Map old sources to new sources

For each OLD source in the current sheet (Phase 1.1), document what happened to it:

| Old Sheet Source | Status | New Source Name | New Finance_View | Action |
|---|---|---|---|---|
| Provided Lead List | RENAMED | Provided List (Lead Scoring) | Outbound | Update name |
| LinkedIn (Self Sourced) | UNCHANGED | LinkedIn (Self Sourced) | Outbound | Keep |
| Search | GONE | (absorbed into other sources) | — | Remove row |
| Dover | RECLASSIFIED | Job Applications | Marketing | Replace with Job Applications |
| Ashby | RECLASSIFIED | Job Applications | Marketing | Merge into Job Applications |
| Advisor Waitlist | RECLASSIFIED | Direct Traffic | Marketing | Replace with Direct Traffic |
| Meta | GONE | (no records) | — | Remove or check if renamed |
| ... | ... | ... | ... | ... |

### 2.4 — Identify what to do with forecast column (G) values

For sources being renamed: the column G forecast value can stay (just update the source name).
For sources being removed: note the G value so Russell can redistribute it to the replacement source.
For NEW sources being added: G starts empty (Russell fills in manually).

Build a migration table:

| Old Source | Old G Value (SQOs) | New Source | Action for G |
|---|---|---|---|
| Provided Lead List | [read from sheet] | Provided List (Lead Scoring) | Keep value |
| Dover | [read from sheet] | Job Applications | Merge Dover + Ashby + Manatal G values |
| Search | [read from sheet] | (removed) | Redistribute to Blog or Direct Traffic |

Save the complete restructure plan to `C:\Users\russe\Documents\Dashboard\sheet_restructure_plan.md`.

**STOP. Report the full restructure plan and wait for approval.**

---

## Phase 3: Execute (ONLY after Phase 2 approval)

Once the restructure plan is approved, the execution order is:

### 3.1 — Deploy the fixed BQ views (from fix_and_deploy_prompt.md Phase 2)

Apply the 1:1 Finance_View mapping fix AND cohorted conversion rate methodology.

### 3.2 — Verify BQ views work correctly (from fix_and_deploy_prompt.md Phase 3)

Run all verification queries.

### 3.3 — Restructure the Google Sheet source-detail sections

This is the big one. For each Finance_View group:

1. **Renamed sources**: Update the source name in column B AND in all SUMPRODUCT formulas (columns C–M)
2. **Removed sources**: Delete the row block (or clear content and note "Source discontinued")
3. **New sources**: Insert new row blocks with the standard funnel stage pattern and SUMPRODUCT formulas matching the new source name
4. **Merged sources**: Update formulas to reference the new merged source name; add the old source's G forecast value to the new source's G value

**CRITICAL**: Work one Finance_View group at a time. After each group:
- Verify the summary row (10–17) for that Finance_View still sums correctly
- Verify at least one source in the group shows non-zero historical data
- Verify no rates exceed 100%

### 3.4 — Update downstream references

If Phase 1.3 found other tabs referencing rows 106+, update those references after the restructure.

### 3.5 — Final verification

1. Summary rows (10–17): each Finance_View shows reasonable volumes for Q2–Q4 2025
2. Source-detail rows: no rates > 100%, no sources returning all zeros (except genuinely new sources with no history)
3. Forecast column (G): spot-check that no values were lost during restructure
4. Total Forecast SQOs (cell C4): verify it still computes correctly

### 3.6 — Document everything

Write final results to `C:\Users\russe\Documents\Dashboard\restructure_results.md`.
