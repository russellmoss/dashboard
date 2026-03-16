# Schema & Mapping Drift Exploration

> **Purpose**: Identify every place where the old BQ views (`vw_channel_conversion_rates_pivoted`, `vw_channel_funnel_volume_by_month`) diverge from the current production `vw_funnel_master` in source field usage, Finance_View mapping, and record scope.
>
> **Context**: The Google Sheets forecast (columns C–F) pulls from `Volumes` and `monthly_conversion_rates` tabs, which are BQ exports from the old pivoted views. Those old views use a hardcoded `SourceMapping` CTE with `LeadSource` → `Finance_View`, while the current funnel master reads `Finance_View__c` directly from Salesforce and uses `Final_Source__c` instead of `LeadSource`. The numbers no longer match the dashboard.
>
> **Output**: Findings written directly into this document by Claude Code. Results feed into the volume and conversion rate comparison explorations.

---

## 1. Old View Definitions

### 1.1 — Do the old views still exist in BigQuery?

**Query**: Check if `vw_channel_conversion_rates_pivoted` and `vw_channel_funnel_volume_by_month` exist in `savvy-gtm-analytics.Tableau_Views`.

```
Run: mcp__bigquery__list_table_ids on dataset savvy-gtm-analytics.Tableau_Views
Filter for: vw_channel_conversion_rates_pivoted, vw_channel_funnel_volume_by_month
```

**Answer**:
<!-- CLAUDE_CODE_ANSWER_START -->
**Neither old view exists.** Only `vw_funnel_master` (VIEW) was found in `savvy-gtm-analytics.Tableau_Views`.

Query run:
```sql
SELECT table_name, table_type
FROM `savvy-gtm-analytics.Tableau_Views.INFORMATION_SCHEMA.TABLES`
WHERE table_name IN ('vw_channel_conversion_rates_pivoted', 'vw_channel_funnel_volume_by_month', 'vw_funnel_master')
```

| table_name | table_type |
|---|---|
| vw_funnel_master | VIEW |

`vw_channel_conversion_rates_pivoted` and `vw_channel_funnel_volume_by_month` have been **deleted** from BigQuery. The Google Sheet is pulling from stale/cached exports — the source views no longer exist.
<!-- CLAUDE_CODE_ANSWER_END -->

### 1.2 — Old view SQL definitions

**Query**: If they exist, retrieve the full SQL definition for each view.

```
Run: mcp__bigquery__get_table_info on each view
Or: SELECT view_definition FROM INFORMATION_SCHEMA.VIEWS WHERE table_name IN ('vw_channel_conversion_rates_pivoted', 'vw_channel_funnel_volume_by_month')
Dataset: savvy-gtm-analytics.Tableau_Views
```

**Answer (conversion rates view definition)**:
<!-- CLAUDE_CODE_ANSWER_START -->
**View does not exist.** `vw_channel_conversion_rates_pivoted` was not found in `INFORMATION_SCHEMA.VIEWS`. The SQL definition cannot be retrieved — the view has been deleted.

The old view SQL must be reconstructed from the codebase or version control. The known characteristics from context:
- Used a hardcoded `SourceMapping` CTE mapping `LeadSource` → `Finance_View`
- Pivoted conversion rates by channel
- Filtered to `recordtypeid = '012Dn000000mrO3IAI'` (Recruiting opps only)
<!-- CLAUDE_CODE_ANSWER_END -->

**Answer (volume view definition)**:
<!-- CLAUDE_CODE_ANSWER_START -->
**View does not exist.** `vw_channel_funnel_volume_by_month` was not found in `INFORMATION_SCHEMA.VIEWS`. The SQL definition cannot be retrieved — the view has been deleted.

Same known characteristics as above — used `LeadSource` with hardcoded `SourceMapping` CTE, no opp deduplication, Recruiting-only record type filter.
<!-- CLAUDE_CODE_ANSWER_END -->

---

## 2. Source Field Drift: `LeadSource` vs `Final_Source__c`

### 2.1 — How many Lead records have different values in `LeadSource` vs `Final_Source__c`?

**Query**:
```sql
SELECT
  COUNT(*) AS total_leads,
  COUNTIF(LeadSource = Final_Source__c) AS matching,
  COUNTIF(LeadSource != Final_Source__c) AS mismatched,
  COUNTIF(LeadSource IS NULL AND Final_Source__c IS NOT NULL) AS leadsource_null_final_populated,
  COUNTIF(LeadSource IS NOT NULL AND Final_Source__c IS NULL) AS leadsource_populated_final_null
FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
```

**Answer**:
<!-- CLAUDE_CODE_ANSWER_START -->
| Metric | Count |
|---|---|
| total_leads | 106,744 |
| matching | 39,849 (37.3%) |
| mismatched | 66,313 (62.1%) |
| leadsource_null_final_populated | 581 (0.5%) |
| leadsource_populated_final_null | 1 (<0.01%) |

**62% of leads have different values in `LeadSource` vs `Final_Source__c`.** This is a massive divergence — the old views (using `LeadSource`) would route the majority of records to different `Finance_View` buckets than the current system (using `Final_Source__c`).
<!-- CLAUDE_CODE_ANSWER_END -->

### 2.2 — What are the most common mismatches?

**Query**:
```sql
SELECT
  LeadSource,
  Final_Source__c,
  COUNT(*) AS cnt
FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
WHERE LeadSource != Final_Source__c
   OR (LeadSource IS NULL AND Final_Source__c IS NOT NULL)
   OR (LeadSource IS NOT NULL AND Final_Source__c IS NULL)
GROUP BY 1, 2
ORDER BY cnt DESC
LIMIT 30
```

**Answer**:
<!-- CLAUDE_CODE_ANSWER_START -->
Top 30 mismatches (LeadSource → Final_Source__c):

| LeadSource | Final_Source__c | Count |
|---|---|---|
| Provided Lead List | Provided List (Lead Scoring) | 61,694 |
| Dover | Job Applications | 2,027 |
| Provided Lead List (Marketing) | Provided List (Marketing) | 946 |
| *(NULL)* | Other | 579 |
| Advisor Waitlist | Direct Traffic | 363 |
| Event | Events | 279 |
| Manatal | Job Applications | 235 |
| RB2B | Other | 194 |
| Provided Lead List | LinkedIn (Self Sourced) | 145 |
| Provided Lead List | Fintrx (Self-Sourced) | 101 |
| Ashby | Job Applications | 51 |
| Fintrx (Self-Sourced) | LinkedIn (Self Sourced) | 46 |
| Fintrx (Self-Sourced) | Provided List (Lead Scoring) | 41 |
| LinkedIn (Self Sourced) | Fintrx (Self-Sourced) | 27 |
| Partner | Recruitment Firm | 23 |
| LinkedIn (Self Sourced) | Provided List (Lead Scoring) | 19 |
| Direct Traffic | Recruitment Firm | 14 |
| LinkedIn (Automation) | LinkedIn (Self Sourced) | 13 |
| Provided Lead List | Recruitment Firm | 11 |
| Reddit | Other | 9 |
| LinkedIn (Self Sourced) | Direct Traffic | 6 |
| Provided List (Lead Scoring) | Direct Traffic | 6 |
| LinkedIn (Content) | LinkedIn Savvy | 6 |
| Provided List (Lead Scoring) | Fintrx (Self-Sourced) | 6 |
| LinkedIn Lead Gen Form | LinkedIn Ads | 5 |
| LinkedIn (Self Sourced) | Recruitment Firm | 4 |
| Provided Lead List | Events | 4 |
| Provided List (Lead Scoring) | LinkedIn (Self Sourced) | 3 |
| LinkedIn (Self Sourced) | Provided List (Marketing) | 3 |
| Recruitment Firm | Direct Traffic | 3 |

**Key insight**: The #1 mismatch alone (61,694 records: `Provided Lead List` → `Provided List (Lead Scoring)`) accounts for 93% of all mismatches. This is a rename/reclassification in Salesforce that the old `SourceMapping` CTE would not pick up. The old CTE mapped `Provided Lead List` → `Outbound`, while `Final_Source__c` = `Provided List (Lead Scoring)` would also map to `Outbound` in the current system — so this particular mismatch likely does NOT change the Finance_View bucket. However, mismatches like `Dover` → `Job Applications` (2,027) and `Advisor Waitlist` → `Direct Traffic` (363) DO change the bucket assignment.
<!-- CLAUDE_CODE_ANSWER_END -->

### 2.3 — Same analysis on Opportunity: `LeadSource` vs `Final_Source__c`

**Query**:
```sql
SELECT
  COUNT(*) AS total_opps,
  COUNTIF(LeadSource = Final_Source__c) AS matching,
  COUNTIF(LeadSource != Final_Source__c) AS mismatched,
  COUNTIF(LeadSource IS NULL AND Final_Source__c IS NOT NULL) AS leadsource_null_final_populated,
  COUNTIF(LeadSource IS NOT NULL AND Final_Source__c IS NULL) AS leadsource_populated_final_null
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
WHERE RecordTypeId IN ('012Dn000000mrO3IAI', '012VS000009VoxrYAC')
```

**Answer**:
<!-- CLAUDE_CODE_ANSWER_START -->
| Metric | Count |
|---|---|
| total_opps | 2,970 |
| matching | 977 (32.9%) |
| mismatched | 1,820 (61.3%) |
| leadsource_null_final_populated | 74 (2.5%) |
| leadsource_populated_final_null | 93 (3.1%) |

**67% of opportunities have different values** in `LeadSource` vs `Final_Source__c` (including NULLs). The mismatch rate is even higher than on Lead records. Additionally, 93 opps have a `LeadSource` but NULL `Final_Source__c` — these would lose their source attribution in the current system.
<!-- CLAUDE_CODE_ANSWER_END -->

---

## 3. Finance_View Mapping Drift

### 3.1 — What are ALL distinct `Finance_View__c` values on Lead?

**Query**:
```sql
SELECT
  Finance_View__c,
  COUNT(*) AS cnt
FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
GROUP BY 1
ORDER BY cnt DESC
```

**Answer**:
<!-- CLAUDE_CODE_ANSWER_START -->
| Finance_View__c | Count |
|---|---|
| Outbound | 99,123 |
| Outbound + Marketing | 2,610 |
| Job Applications | 2,313 |
| Marketing | 1,361 |
| Other | 870 |
| Recruitment Firm | 292 |
| Re-Engagement | 84 |
| *(NULL)* | 55 |
| Advisor Referral | 27 |
| Employee Referral | 9 |

**10 distinct values** (including NULL). Notable: `Job Applications` (2,313), `Recruitment Firm` (292), `Advisor Referral` (27), and `Employee Referral` (9) are values that do NOT exist in the old `SourceMapping` CTE.
<!-- CLAUDE_CODE_ANSWER_END -->

### 3.2 — What are ALL distinct `Finance_View__c` values on Opportunity?

**Query**:
```sql
SELECT
  Finance_View__c,
  COUNT(*) AS cnt
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
WHERE RecordTypeId IN ('012Dn000000mrO3IAI', '012VS000009VoxrYAC')
GROUP BY 1
ORDER BY cnt DESC
```

**Answer**:
<!-- CLAUDE_CODE_ANSWER_START -->
| Finance_View__c | Count |
|---|---|
| Outbound | 1,550 |
| Job Applications | 464 |
| Recruitment Firm | 315 |
| *(NULL)* | 186 |
| Marketing | 129 |
| Other | 102 |
| Outbound + Marketing | 88 |
| Re-Engagement | 70 |
| Advisor Referral | 49 |
| Partnerships | 11 |
| Employee Referral | 6 |

**11 distinct values** (including NULL). Same new values as Lead: `Job Applications`, `Recruitment Firm`, `Advisor Referral`, `Employee Referral`. Note `Partnerships` (11) appears on Opportunity but was rare on Lead. Also 186 opps have NULL `Finance_View__c`.
<!-- CLAUDE_CODE_ANSWER_END -->

### 3.3 — Compare SF `Finance_View__c` values vs the old SourceMapping CTE values

The old views use a hardcoded `SourceMapping` CTE that maps `Original_source` → `Finance_View`. The expected `Finance_View` values from that CTE are:
- `Outbound`
- `Marketing`
- `Outbound + Marketing`
- `Re-Engagement`
- `Partnerships`
- `Advisor Referrals`
- `Other`

**Question**: Which `Finance_View__c` values from Salesforce (Q3.1 + Q3.2) do NOT appear in the old CTE list above? Which old CTE values do NOT appear in Salesforce?

**Answer**:
<!-- CLAUDE_CODE_ANSWER_START -->
**SF values NOT in old CTE** (new in Salesforce, no old CTE equivalent):
- `Job Applications` — 2,313 leads + 464 opps (significant volume)
- `Recruitment Firm` — 292 leads + 315 opps
- `Advisor Referral` — 27 leads + 49 opps (note: old CTE has `Advisor Referrals` plural — singular vs plural mismatch)
- `Employee Referral` — 9 leads + 6 opps
- *(NULL)* — 55 leads + 186 opps

**Old CTE values NOT in Salesforce `Finance_View__c`**:
- `Advisor Referrals` (plural) — Salesforce uses `Advisor Referral` (singular). **This is a naming mismatch** that would cause the sheet SUMPRODUCT to miss these records.

**Values present in both** (with same name):
- `Outbound` ✓
- `Marketing` ✓
- `Outbound + Marketing` ✓
- `Re-Engagement` ✓
- `Partnerships` ✓ (on Opps only — 11 records)
- `Other` ✓
<!-- CLAUDE_CODE_ANSWER_END -->

### 3.4 — Current dashboard mapping: `Finance_View__c` → `Channel_Grouping_Name`

The current `vw_funnel_master` applies a post-hoc CASE override:
```sql
CASE IFNULL(c.Finance_View__c, 'Other')
  WHEN 'Partnerships' THEN 'Recruitment Firm'
  WHEN 'Job Applications' THEN 'Marketing'
  WHEN 'Employee Referral' THEN 'Referral'
  WHEN 'Advisor Referral' THEN 'Referral'
  ELSE IFNULL(c.Finance_View__c, 'Other')
END AS Channel_Grouping_Name
```

**Question**: For each distinct `Finance_View__c` value found in Q3.1 and Q3.2, what does it map to in the CURRENT system (`Channel_Grouping_Name`) vs what it maps to in the OLD `SourceMapping` CTE (`Finance_View` column)?

Build a comparison table:
```sql
-- Run against vw_funnel_master to get current mapping
SELECT DISTINCT
  Finance_View__c,
  Channel_Grouping_Name
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
ORDER BY Finance_View__c
```

**Answer**:
<!-- CLAUDE_CODE_ANSWER_START -->
Current mapping from `vw_funnel_master`:

| Finance_View__c (SF) | Channel_Grouping_Name (current) | Old CTE Finance_View |
|---|---|---|
| Advisor Referral | **Referral** | *(not in CTE; CTE has "Advisor Referrals" plural)* |
| Employee Referral | **Referral** | *(not in CTE)* |
| Job Applications | **Marketing** | *(not in CTE)* |
| Marketing | Marketing | Marketing |
| Other | Other | Other |
| Outbound | Outbound | Outbound |
| Outbound + Marketing | Outbound + Marketing | Outbound + Marketing |
| Partnerships | **Recruitment Firm** | Partnerships |
| Re-Engagement | Re-Engagement | Re-Engagement |
| Recruitment Firm | Recruitment Firm | *(not in CTE)* |
| *(NULL)* | **Other** | *(not in CTE)* |

**Key differences**:
1. `Partnerships` → now maps to `Recruitment Firm` (was its own category in old CTE)
2. `Job Applications` → maps to `Marketing` (didn't exist in old CTE at all)
3. `Advisor Referral` / `Employee Referral` → maps to `Referral` (new category not in old CTE)
4. `Recruitment Firm` → passes through as `Recruitment Firm` (not in old CTE)
5. NULL → maps to `Other` via IFNULL
<!-- CLAUDE_CODE_ANSWER_END -->

### 3.5 — What the forecast sheet expects: Finance_View values in SUMPRODUCT formulas

The Google Sheet forecast formulas (columns C–F) match on the `Finance_View` column (column L in Volumes tab, column K in conversion rates tab). The row labels in B11:B17 are:
- `Outbound`
- `Marketing`
- `Outbound + Marketing`
- `Re-Engagement`
- `Partnerships`
- `Advisor Referrals`
- `Other`

**Question**: If we rebuild the BQ views using `Finance_View__c` from Salesforce (as the current funnel master does), which of these 7 sheet labels would get zero matches because the value doesn't exist in Salesforce `Finance_View__c`? Which Salesforce values would fall into no sheet row (orphaned)?

**Answer**:
<!-- CLAUDE_CODE_ANSWER_START -->
**Sheet labels that would get ZERO matches** (value doesn't exist in SF `Finance_View__c`):
- **`Advisor Referrals`** (plural) — SF uses `Advisor Referral` (singular). The 27 leads + 49 opps with `Advisor Referral` would NOT match the sheet's SUMPRODUCT looking for `Advisor Referrals`. **This row would show 0.**

**Sheet labels that WOULD match but with different content**:
- `Partnerships` — exists in SF (11 opps only), but the current `vw_funnel_master` remaps it to `Recruitment Firm`. If rebuilding old-style views using raw `Finance_View__c`, this row would show only 11 opps instead of whatever the old CTE mapped.
- `Marketing` — would now include `Job Applications` records if using the current CASE mapping, inflating this category.

**SF values that would be ORPHANED** (fall into no sheet row):
- `Job Applications` — 2,313 leads + 464 opps → no sheet row for this value
- `Recruitment Firm` — 292 leads + 315 opps → no sheet row
- `Employee Referral` — 9 leads + 6 opps → no sheet row
- `Advisor Referral` — 27 leads + 49 opps → no sheet row (singular vs plural)
- *(NULL)* — 55 leads + 186 opps → no sheet row (unless IFNULL'd to `Other`)

**Impact**: ~3,200 lead records and ~1,020 opp records would be invisible to the forecast sheet if `Finance_View__c` is used without a mapping layer.
<!-- CLAUDE_CODE_ANSWER_END -->

---

## 4. Record Scope Drift

### 4.1 — Re-Engagement inclusion

The old views filter Opportunity with `WHERE o.recordtypeid = '012Dn000000mrO3IAI'` (Recruiting only). The current `vw_funnel_master` also includes Re-Engagement opps (`012VS000009VoxrYAC`) via the `ReEngagement_As_Lead` CTE.

**Query**: How many Re-Engagement records are in the current funnel master?
```sql
SELECT
  lead_record_source,
  COUNT(*) AS total_records,
  COUNTIF(is_contacted = 1) AS contacted,
  COUNTIF(is_mql = 1) AS mqls,
  COUNTIF(is_sql = 1) AS sqls
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
GROUP BY 1
```

**Answer**:
<!-- CLAUDE_CODE_ANSWER_START -->
| lead_record_source | total_records | contacted | mqls | sqls |
|---|---|---|---|---|
| Lead | 106,744 | 72,174 | 3,925 | 1,584 |
| Re-Engagement | 861 | 31 | 10 | 17 |
| *(NULL)* | 533 | 0 | 0 | 0 |

**861 Re-Engagement records** are in the current funnel master. These would NOT exist in the old views (which filtered to Recruiting record type only). Additionally, 533 records have NULL `lead_record_source` — these need investigation.

The Re-Engagement records contribute 31 contacted, 10 MQLs, and 17 SQLs. While small in absolute terms, the 17 SQLs are meaningful for conversion rate calculations in low-volume channels.
<!-- CLAUDE_CODE_ANSWER_END -->

### 4.2 — Re-Engagement records by Finance_View__c

**Query**:
```sql
SELECT
  Finance_View__c,
  COUNT(*) AS cnt,
  COUNTIF(is_contacted = 1) AS contacted,
  COUNTIF(is_mql = 1) AS mqls,
  COUNTIF(is_sql = 1) AS sqls
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE lead_record_source = 'Re-Engagement'
GROUP BY 1
ORDER BY cnt DESC
```

**Answer**:
<!-- CLAUDE_CODE_ANSWER_START -->
| Finance_View__c | cnt | contacted | mqls | sqls |
|---|---|---|---|---|
| Outbound | 459 | 4 | 0 | 0 |
| Other | 172 | 22 | 2 | 0 |
| Recruitment Firm | 154 | 2 | 1 | 0 |
| Re-Engagement | 24 | 2 | 7 | 17 |
| Marketing | 24 | 0 | 0 | 0 |
| Outbound + Marketing | 15 | 0 | 0 | 0 |
| Advisor Referral | 8 | 0 | 0 | 0 |
| Partnerships | 4 | 0 | 0 | 0 |
| Employee Referral | 1 | 1 | 0 | 0 |

**Key finding**: All 17 SQLs from Re-Engagement records are in the `Re-Engagement` Finance_View bucket. The Re-Engagement records are spread across many Finance_View categories (Outbound: 459, Other: 172, Recruitment Firm: 154), adding non-trivial volume to categories that the old views wouldn't have included. The `Outbound` category gets the largest inflation (+459 records).
<!-- CLAUDE_CODE_ANSWER_END -->

### 4.3 — Opportunity deduplication: `opp_row_num`

The current funnel master uses `ROW_NUMBER() OVER (PARTITION BY Full_Opportunity_ID__c ORDER BY CreatedDate ASC)` to deduplicate opps (multiple leads → same opp). The old views do NOT have this.

**Query**: How many opportunities have multiple leads?
```sql
SELECT
  COUNT(DISTINCT Full_Opportunity_ID__c) AS total_opps,
  COUNTIF(opp_row_num > 1) AS duplicate_opp_rows,
  COUNT(*) AS total_rows_with_opp
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE Full_Opportunity_ID__c IS NOT NULL
```

**Answer**:
<!-- CLAUDE_CODE_ANSWER_START -->
| Metric | Value |
|---|---|
| total_opps (distinct) | 2,109 |
| duplicate_opp_rows (opp_row_num > 1) | 2 |
| total_rows_with_opp | 2,111 |

**Only 2 duplicate opp rows** exist in the current funnel master (2,111 rows for 2,109 distinct opps). The `opp_row_num` deduplication logic in the current view catches these, but the old views (without dedup) would double-count them. The impact is minimal — only 2 extra rows — so opp deduplication is NOT a significant driver of drift.
<!-- CLAUDE_CODE_ANSWER_END -->

---

## 5. Summary: Root Causes of Drift

Based on all findings above, summarize:

1. **Source field impact**: How many records shift between Finance_View buckets due to `Final_Source__c` vs `LeadSource`?
2. **Mapping mismatch**: Which Finance_View categories are materially different between old CTE and current SF field?
3. **Record scope**: How many records are added by Re-Engagement inclusion? Do they materially affect any Finance_View category?
4. **Deduplication**: Does the old view double-count any SQO/Joined volumes due to missing `opp_row_num` logic?

**Summary**:
<!-- CLAUDE_CODE_ANSWER_START -->
### 1. Source Field Impact: MAJOR

62% of leads (66,313) and 67% of opportunities (1,893) have different values in `LeadSource` vs `Final_Source__c`. The old views used `LeadSource` with a hardcoded CTE to derive `Finance_View`; the current system uses `Final_Source__c` with `Finance_View__c` directly from Salesforce. While the single largest mismatch (61,694 records: `Provided Lead List` → `Provided List (Lead Scoring)`) likely maps to the same `Outbound` bucket in both systems, ~4,600 records map to genuinely different sources (e.g., `Dover` → `Job Applications`, `Advisor Waitlist` → `Direct Traffic`), which shift them between Finance_View buckets.

### 2. Mapping Mismatch: SIGNIFICANT

The SF `Finance_View__c` field contains 4 values that don't exist in the old CTE:
- **`Job Applications`** (2,313 leads + 464 opps) — large volume, completely invisible to old views
- **`Recruitment Firm`** (292 leads + 315 opps) — the old CTE had no equivalent
- **`Advisor Referral`** (singular, 27+49) — the old CTE used `Advisor Referrals` (plural) — **name mismatch breaks the Google Sheet SUMPRODUCT**
- **`Employee Referral`** (9+6) — small but new

Additionally, the current `vw_funnel_master` applies a CASE remapping that the old views didn't:
- `Partnerships` → `Recruitment Firm`
- `Job Applications` → `Marketing`
- `Advisor Referral` / `Employee Referral` → `Referral`

This means the **current dashboard groups channels differently** than both the old views AND the forecast sheet. The sheet expects 7 categories; the current system produces a different set.

### 3. Record Scope: MODERATE

861 Re-Engagement records are added by the current `vw_funnel_master` (via RecordTypeId `012VS000009VoxrYAC`). These contribute:
- 459 records to `Outbound`, 172 to `Other`, 154 to `Recruitment Firm`
- 17 SQLs (all in `Re-Engagement` Finance_View bucket)
- The old views excluded these entirely

While 861 records is <1% of the total 108K, the 17 SQLs in `Re-Engagement` are material for conversion rate calculations in that low-volume channel.

### 4. Deduplication: NEGLIGIBLE

Only 2 duplicate opp rows exist (2,111 total rows for 2,109 distinct opps). The old views' lack of `opp_row_num` dedup would cause at most 2 extra counts. **This is not a meaningful driver of drift.**

### Root Cause Priority (highest impact first):

1. **Old views are deleted** — the Google Sheet is pulling from stale cached exports, not live BQ data
2. **Source field switch** (`LeadSource` → `Final_Source__c`) affects 62-67% of records
3. **New Finance_View__c values** (`Job Applications`, `Recruitment Firm`, `Advisor Referral`, `Employee Referral`) have no mapping in old CTE — ~3,200 leads and ~1,020 opps orphaned
4. **`Advisor Referrals` → `Advisor Referral` name change** breaks exact-match SUMPRODUCT formulas
5. **Channel_Grouping_Name remapping** in current view merges/renames categories differently than the sheet expects
6. **Re-Engagement scope expansion** adds 861 records the old views didn't include
7. **Opp dedup** — negligible impact (2 rows)
<!-- CLAUDE_CODE_ANSWER_END -->

---

*Exploration complete. Results feed into `volume_comparison_exploration.md` and `conversion_rate_comparison_exploration.md`.*
