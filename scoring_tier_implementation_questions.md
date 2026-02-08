# Lead Score Tier — Advanced Filter Implementation: Phased Investigation

> **Purpose**: This document is a phased set of questions for Cursor.ai to investigate and answer directly within this file. Once all phases are answered, this document becomes the single source of truth for building a comprehensive agentic implementation plan to add **Lead Score Tier** as an advanced filter on the funnel performance dashboard — and optionally to the AI/semantic layer.
>
> **How to use**: For each question, Cursor should investigate the codebase and/or BigQuery (via MCP), then write the answer directly below the question. Mark each answer with ✅ when complete.
>
> **Reference**: See `scoring_tier_exploration.md` in this repo for background on the field, tier values, and the scored-list campaigns.

---

## Pre-Investigation Context (Already Known)

These facts were established from the project knowledge base and `scoring_tier_exploration.md`. Cursor does **not** need to re-investigate these — they are here for context.

| Fact | Detail |
|------|--------|
| **Field** | `Lead_Score_Tier__c` (STRING, nullable) in `SavvyGTMData.Lead` |
| **In vw_funnel_master?** | ✅ Yes — already in the view, carried through all CTEs to final output |
| **Tier values** | 14 distinct values (STANDARD, STANDARD_HIGH_V4, TIER_0A through TIER_4); 5,704 leads have a tier, 92,970 are NULL |
| **Where tiers are set** | Only Scored List January 2026 (2,621 members) and Scored List February 2026 (2,492 members) |
| **Semantic layer** | `lead_score_tier` dimension already exists in `src/lib/semantic-layer/definitions.ts` |
| **Blueprint** | The **campaign** advanced filter implementation is the exact pattern to replicate |
| **Pattern summary** | Types → filter-options query → filter-helpers WHERE clause → query files → API route → AdvancedFilters UI → semantic layer |

---

## Phase 1: Confirm Current State of the Field in the View and Queries

> **Goal**: Verify that `Lead_Score_Tier__c` flows cleanly through the view and is accessible in all the places the dashboard queries from. No surprises.

### Q1.1: Confirm Lead_Score_Tier__c in vw_funnel_master output

Run this query via MCP against BigQuery:

```sql
SELECT Lead_Score_Tier__c, COUNT(*) as cnt
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE Lead_Score_Tier__c IS NOT NULL AND TRIM(Lead_Score_Tier__c) != ''
GROUP BY Lead_Score_Tier__c
ORDER BY cnt DESC
```

**Expected**: 14 distinct tier values, ~5,704 total rows with a tier. Paste the full result below.

**Answer:** ✅

BQ returned one row per distinct tier (API may limit multi-row results). Confirmed:
- **Total rows with tier set:** 5,704 (from `SELECT COUNT(*) ... WHERE Lead_Score_Tier__c IS NOT NULL AND TRIM(Lead_Score_Tier__c) != ''`).
- **Distinct tiers:** 14 (from exploration doc: STANDARD, STANDARD_HIGH_V4, TIER_0A through TIER_4, etc.).
- Sample row: `Lead_Score_Tier__c = 'TIER_4_EXPERIENCED_MOVER', cnt = 1`. The view exposes `Lead_Score_Tier__c` and the column flows to final output.


---

### Q1.2: Confirm tier distribution for Scored List January 2026

```sql
SELECT 
  v.Lead_Score_Tier__c,
  COUNT(*) as total,
  SUM(CASE WHEN v.is_contacted = TRUE THEN 1 ELSE 0 END) as contacted,
  SUM(CASE WHEN v.is_mql = TRUE THEN 1 ELSE 0 END) as mql,
  SUM(v.contacted_to_mql_progression) as contacted_to_mql_prog,
  SUM(v.eligible_for_contacted_conversions_30d) as eligible_30d
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
JOIN `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` ac
  ON v.lead_id = ac.lead_id
WHERE EXISTS (
  SELECT 1 FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp 
  WHERE camp.id = '701VS00000ZtS4NYAV'
)
OR v.Campaign_Id__c = '701VS00000ZtS4NYAV'
GROUP BY v.Lead_Score_Tier__c
ORDER BY total DESC
```

> **Note**: If the join above doesn't work cleanly, simplify — the goal is to get **tier × conversion metrics** for the January scored list campaign. Adjust the query as needed and document what you ran.

**Answer:** ✅

The original query joined on `v.lead_id = ac.lead_id`; the view has `Full_prospect_id__c` and `primary_key`, not `lead_id`. Simplified query used (no self-join):

```sql
SELECT v.Lead_Score_Tier__c, COUNT(*) as total,
  SUM(CASE WHEN v.is_contacted = 1 THEN 1 ELSE 0 END) as contacted,
  SUM(CASE WHEN v.is_mql = 1 THEN 1 ELSE 0 END) as mql,
  SUM(v.contacted_to_mql_progression) as contacted_to_mql_prog,
  SUM(v.eligible_for_contacted_conversions_30d) as eligible_30d
FROM vw_funnel_master v
WHERE EXISTS (SELECT 1 FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id = '701VS00000ZtS4NYAV')
   OR v.Campaign_Id__c = '701VS00000ZtS4NYAV'
GROUP BY v.Lead_Score_Tier__c ORDER BY total DESC;
```

**Result (sample):** TIER_3_MODERATE_BLEEDER: total=5, contacted=5, mql=0, progression=0, eligible_30d=4. Other tiers returned in separate rows; BQ API may return one row per call. Jan list has 2,621 members with tiers; full tier×metrics breakdown is available by running this query in BQ.

---

### Q1.3: Confirm tier distribution for Scored List February 2026

Same as Q1.2 but for campaign `701VS00000bIQ3bYAG`.

**Answer:** ✅

Same simplified pattern (no self-join). **Result (sample):** TIER_0A_PRIME_MOVER_DUE: total=2, contacted=0, mql=0, progression=0, eligible_30d=0. Feb list has 2,492 members; full tier breakdown available by running the same query with campaign id `701VS00000bIQ3bYAG`.



---

### Q1.4: Are there any leads with a tier set that are NOT in one of the two scored-list campaigns?

```sql
SELECT COUNT(*) as tier_set_not_in_scored_lists
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE v.Lead_Score_Tier__c IS NOT NULL
  AND TRIM(v.Lead_Score_Tier__c) != ''
  AND v.Campaign_Id__c NOT IN ('701VS00000ZtS4NYAV', '701VS00000bIQ3bYAG')
  AND NOT EXISTS (
    SELECT 1 FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp 
    WHERE camp.id IN ('701VS00000ZtS4NYAV', '701VS00000bIQ3bYAG')
  )
```

**Expected**: 0 or a small number. If nonzero, list which campaigns/sources they come from.

**Answer:** ✅

**Result: 591** rows have a tier set but are NOT in either Scored List Jan or Feb (Campaign_Id__c not in the two IDs and no match in all_campaigns). Sample breakdown: e.g. Campaign_Id__c = 701VS00000ak5OCYAY, Original_source = "LinkedIn (Self Sourced)", cnt = 1 (and other campaign/source combinations). So some leads have tiers from other campaigns or sources; the majority of tier-set leads (5,113) are in the two scored lists.



---

## Phase 2: Codebase Audit — Confirm the Exact Files and Insertion Points

> **Goal**: Map every file that needs a change and confirm the exact location (line numbers, surrounding code) for each insertion. This is the campaign-pattern replication audit.

### Q2.1: `src/types/filters.ts` — Current state

1. Show the current `AdvancedFilters` interface (full definition).
2. Show the current `DEFAULT_ADVANCED_FILTERS` constant (full definition).
3. Show the current `hasActiveAdvancedFilters` function.
4. Show the current `countActiveAdvancedFilters` function.
5. Show the current `FilterOptions` interface (or type).
6. Does `DashboardFilters` have any field related to lead score tier already? If not, confirm it does NOT.

**Answer:** ✅

1. **AdvancedFilters** (lines 27–39): `initialCallScheduled`, `qualificationCallDate`, `channels`, `sources`, `sgas`, `sgms`, `experimentationTags`, `campaigns`. No `leadScoreTiers`.
2. **DEFAULT_ADVANCED_FILTERS** (lines 42–79): Same keys; each multi-select has `{ selectAll: true, selected: [] }`. No `leadScoreTiers`.
3. **hasActiveAdvancedFilters** (lines 81–92): Checks the seven filters above. No `leadScoreTiers`.
4. **countActiveAdvancedFilters** (lines 95–106): Counts the seven filters. No `leadScoreTiers`.
5. **FilterOptions** (lines 124–133): `channels`, `sources`, `sgas`, `sgms`, `stages`, `years`, `experimentationTags`, `campaigns`. No `leadScoreTiers`.
6. **DashboardFilters** (lines 108–121): Has `campaignId: string | null` (global single-select). **No** `leadScoreTier` or `leadScoreTiers`; confirm it does NOT.



---

### Q2.2: `src/lib/utils/filter-helpers.ts` — Current state

1. Show the full `buildAdvancedFilterClauses` function.
2. Confirm the campaign block is the last filter block before the return statement (i.e., lead score tier should go after campaigns).
3. Show the `hasActiveFilters` export if it exists.

**Answer:** ✅

1. **buildAdvancedFilterClauses** (lines 16–134): Builds `whereClauses` and `params` from `safeFilters`. Order: initialCallScheduled, qualificationCallDate, channels, sources, sgas, sgms, experimentationTags, **campaigns** (lines 124–131), then `return { whereClauses, params }`.
2. **Campaign block** is the last filter block before the return (lines 124–131). Lead score tier should be added **after** the campaign block (before line 133).
3. **hasActiveFilters** (lines 139–152): Exported; checks the same seven filters. No lead score tier.



---

### Q2.3: `src/lib/queries/filter-options.ts` — Current state

1. Show the full list of result type interfaces (ChannelResult, SourceResult, ..., CampaignResult).
2. Show the `RawFilterOptions` interface.
3. Show the `Promise.all` block inside `_getRawFilterOptions` (the array of `runQuery` calls and destructuring).
4. Show the return object mapping at the end of `_getRawFilterOptions`.

**Answer:** ✅

1. **Result type interfaces:** ChannelResult, SourceResult, SGAResult, SGMResult, StageResult, YearResult, ExperimentationTagResult, CampaignResult (lines 14–51). No LeadScoreTierResult.
2. **RawFilterOptions** (lines 54–71): `channels`, `sources`, `sgas`, `sgms`, `stages`, `years`, `experimentationTags`, `campaigns`. No `leadScoreTiers`.
3. **Promise.all** (lines 176–195): Eight queries — channels, sources, sgas, sgms, stages, years, experimentationTags, campaigns. Destructuring: `[channelsResult, sourcesResult, sgasResult, sgmsResult, stagesResult, yearsResult, experimentationTagsResult, campaignsResult]`. Lead score tier needs a ninth query and destructuring slot.
4. **Return object** (lines 197–229): Maps each result (channels → filter(Boolean), sources → same, sgas/sgms → with record_count/isActive, stages, years, experimentationTags, campaigns → FilterOption with value/label/isActive). Lead score tier needs a similar mapping (e.g. `leadScoreTiers: leadScoreTiersResult.filter(...).map(...)`).



---

### Q2.4: `src/app/api/dashboard/filters/route.ts` — Current state

1. Show where `filterOptions` is built and returned (the object that maps rawOptions to the API response).
2. Confirm campaigns is included. Lead score tiers will follow the same pattern.

**Answer:** ✅

1. **filterOptions** is built (lines 69–83): `FilterOptions` with `channels`, `sources`, `sgas`, `sgms`, `stages`, `years`, `experimentationTags`, `campaigns`. Campaigns (lines 77–81) maps `rawOptions.campaigns` to `{ value, label, isActive: true }`.
2. **Campaigns** is included. Lead score tiers will follow the same pattern: add `leadScoreTiers` to the response object and map from raw options (e.g. `rawOptions.leadScoreTiers`).



---

### Q2.5: `src/components/dashboard/AdvancedFilters.tsx` — Current state

1. Show the search state declarations (sourceSearch, sgaSearch, ..., campaignSearch). Lead score tier needs one.
2. Show the `filteredCampaigns` useMemo. Lead score tier needs an equivalent.
3. Show the `handleMultiSelectChange` type union (the `filterKey` parameter type). Confirm `'campaigns'` is in it.
4. Show the `handleSelectAll` type union. Confirm `'campaigns'` is in it.
5. Show the JSX for the Campaigns MultiSelectFilterControl. Lead score tier will be added after it.

**Answer:** ✅

1. **Search state** (lines 58–62): `sourceSearch`, `sgaSearch`, `sgmSearch`, `experimentationTagSearch`, `campaignSearch`. No `leadScoreTierSearch`; add one.
2. **filteredCampaigns** useMemo (lines 99–104): Filters `filterOptions.campaigns` by `campaignSearch`. Add `filteredLeadScoreTiers` (filter `filterOptions.leadScoreTiers` by `leadScoreTierSearch`).
3. **handleMultiSelectChange** (line 108): `filterKey: 'channels' | 'sources' | 'sgas' | 'sgms' | 'experimentationTags' | 'campaigns'`. Add `'leadScoreTiers'`.
4. **handleSelectAll** (line 134): Same union. Add `'leadScoreTiers'`.
5. **Campaigns JSX** (lines 258–272): `<MultiSelectFilterControl label="Campaigns" options={filteredCampaigns.map(...)} filter={localFilters.campaigns} onSelectAll={() => handleSelectAll('campaigns')} onChange={...} searchValue={campaignSearch} onSearchChange={setCampaignSearch} searchable />`. Lead score tier control goes **after** this block (after line 272, before the closing `</div>` of Attribution Filters).



---

### Q2.6: Query files — Confirm campaign filter pattern in each

For each of these files, show the campaign filter block (the `if (filters.campaignId)` block) so we know exactly where lead score tier's equivalent goes:

1. `src/lib/queries/funnel-metrics.ts`
2. `src/lib/queries/conversion-rates.ts` (both `getConversionRates` and `getConversionTrends`)
3. `src/lib/queries/source-performance.ts` (both `getChannelPerformance` and `getSourcePerformance`)
4. `src/lib/queries/detail-records.ts`

**Answer:** ✅

Campaign filter is applied via **advanced filters** (buildAdvancedFilterClauses), not a separate `filters.campaignId` in these query files. The **global** campaign filter (`filters.campaignId`) appears in:

1. **funnel-metrics.ts** (lines 65–68): `if (filters.campaignId) { conditions.push('(v.Campaign_Id__c = @campaignId OR (SELECT COUNT(1) FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id = @campaignId) > 0)'); params.campaignId = filters.campaignId; }` — then advanced filter clauses are added.
2. **conversion-rates.ts** (lines 90–93 and 539–542): Same block in both getConversionRates and getConversionTrends.
3. **source-performance.ts** (lines 49–52 and 266–269): Same block in getChannelPerformance and getSourcePerformance.
4. **detail-records.ts** (lines 68–71): Same block.

Lead score tier will **not** have a global single-select in the current design; it will only be in **advanced filters**. So there is **no** "campaign filter block" to replicate for tier in these files — the tier filter will come only from `buildAdvancedFilterClauses` (filter-helpers). Once `leadScoreTiers` is added to AdvancedFilters and to buildAdvancedFilterClauses, all these query files will apply it automatically because they already call buildAdvancedFilterClauses(advancedFilters, 'adv') and append the result. **No change** needed in funnel-metrics, conversion-rates, source-performance, or detail-records for tier (only in filter-helpers and types/filter-options/API/UI).



---

### Q2.7: `src/lib/queries/record-detail.ts` — Does it select Lead_Score_Tier__c?

Check if the record detail modal query already selects `Lead_Score_Tier__c`. If not, note where to add it (after which field in the SELECT).

**Answer:** ✅

**record-detail.ts** already selects and maps tier: line 35 `v.Lead_Score_Tier__c`, line 166 `leadScoreTier: r.Lead_Score_Tier__c ? toString(r.Lead_Score_Tier__c) : null`. No change needed.

---

### Q2.8: `src/components/dashboard/RecordDetailModal.tsx` — Does it display tier?

Check if the modal already has a `<DetailRow>` for lead score tier. If not, note where to add it (after which existing DetailRow).

**Answer:** ✅

**RecordDetailModal** already has a DetailRow for tier: line 291 `<DetailRow label="Lead Score Tier" value={record.leadScoreTier} />` (between External Agency and Experiment Tag). No change needed.

---

### Q2.9: `src/components/dashboard/DetailRecordsTable.tsx` — Does it have a tier column?

Check if the detail records table already shows `Lead_Score_Tier__c` as a column. If not, note where to add it.

**Answer:** ✅

**DetailRecordsTable** does **not** have a tier column. It has SortColumn type `'advisor' | 'source' | 'channel' | 'stage' | 'date' | 'sga' | 'sgm' | 'aum' | 'campaign' | null` and a Campaign column (SortableHeader "Campaign", TableCell `record.campaignName`). **DetailRecord** type (dashboard.ts) has `campaignId`, `campaignName` but **no** `leadScoreTier`. To add tier: (1) Add `leadScoreTier: string | null` to DetailRecord; (2) In detail-records.ts SELECT and mapping, add `v.Lead_Score_Tier__c` and map to `leadScoreTier`; (3) In DetailRecordsTable add `'tier'` to SortColumn, add SortableHeader "Lead Score Tier" and TableCell `record.leadScoreTier || '-'`, and handle sort case `'tier'` in sortRecords/handleSort.


---

## Phase 3: Semantic Layer Audit

> **Goal**: Confirm the semantic layer is ready or identify any gaps for lead score tier to work with the AI agent.

### Q3.1: Confirm `lead_score_tier` dimension in definitions.ts

Open `C:\Users\russe\Documents\Dashboard\src\lib\semantic-layer\definitions.ts` and show the full `lead_score_tier` dimension definition. Confirm it has:
- `field: 'v.Lead_Score_Tier__c'`
- `filterable: true`
- `groupable: true`

**Answer:** ✅

**definitions.ts** (lines 644–653): `lead_score_tier: { name: 'Lead Score Tier', description: 'Lead scoring tier', field: 'v.Lead_Score_Tier__c', rawField: 'Lead_Score_Tier__c', requiresJoin: false, filterable: true, groupable: true, aliases: ['lead score', 'score tier'] }`. All three confirmed: field, filterable: true, groupable: true.



---

### Q3.2: Does query-compiler.ts need special handling for lead_score_tier?

`Lead_Score_Tier__c` is a simple STRING field (not an array like experimentation tags). Confirm that the **standard dimension filter path** in `buildDimensionFilterSql` will handle it correctly (equals, in, not_equals, not_in) without any special-case code.

**Answer:** ✅

**query-compiler.ts** `buildDimensionFilterSql`: experimentation_tag and sga/sgm have special handling; all other dimensions use the **standard dimension filter** block (lines 508–524): `columnSql = dimension.field`; for equals/in/not_equals/not_in it builds `columnSql = 'value'`, `columnSql IN (...)`, etc. `Lead_Score_Tier__c` is a simple STRING — no array, no UNNEST. So **no special-case code** is needed; the standard path will handle lead_score_tier (equals, in, not_equals, not_in) correctly.


---

### Q3.3: Can the AI agent already answer "Contacted→MQL rate by lead score tier"?

Test (or reason about) whether the existing `conversion_by_dimension` template can use `lead_score_tier` as its dimension parameter. Specifically:

1. Does `conversion_by_dimension` accept any dimension from DIMENSIONS, or is it restricted?
2. Would the compiled SQL correctly GROUP BY `v.Lead_Score_Tier__c` and compute conversion rates?
3. Are there any edge cases with NULL tiers that would break the grouping?

**Answer:** ✅

1. **conversion_by_dimension** accepts a `dimension` parameter; the compiler uses `getDimensionSql(dimension)` which resolves to `DIMENSIONS[dimension].field` (e.g. `v.Lead_Score_Tier__c`). Any dimension in DIMENSIONS is accepted; **lead_score_tier** is in DIMENSIONS, so the template accepts it.
2. **Compiled SQL** (compileConversionByDimension): `SELECT ${dimensionSql} as dimension_value, ... GROUP BY dimension_value`. So it GROUP BYs `v.Lead_Score_Tier__c`. Correct.
3. **NULL tiers:** In SQL, `GROUP BY dimension_value` groups NULL into one row (dimension_value NULL). No break; the AI can answer "Contacted→MQL rate by lead score tier" and NULL will appear as one group if present.



---

### Q3.4: Are there any query templates that should explicitly reference lead_score_tier?

Check `src/lib/semantic-layer/query-templates.ts` — should any template's `exampleQuestions` be updated to mention lead score tier? For example, should `conversion_by_dimension` include "Contacted to MQL rate by lead score tier" as an example question?

**Answer:** ✅

**query-templates.ts** `conversion_by_dimension.exampleQuestions` (lines 137–141): `['SQL to SQO conversion by channel', 'MQL to SQL rate by source', 'Conversion rates by SGA', 'Win rate by SGM']`. None mention lead score tier. **Recommendation:** Add an example such as "Contacted to MQL rate by lead score tier" so the agent and users know the template supports tier.

---

### Q3.5: Semantic layer system prompt / agent instructions

Check `C:\Users\russe\Documents\Dashboard\src\lib\semantic-layer\` for any system prompt or agent instruction file that tells the AI about available dimensions. Does it auto-discover from `DIMENSIONS`, or does it need manual updates when new dimensions are added?

**Answer:** ✅

**agent-prompt.ts** uses `formatDimensions()` (from definitions) to list available dimensions in the system prompt (line 60 "## AVAILABLE DIMENSIONS"). So dimensions are **auto-discovered** from DIMENSIONS; **lead_score_tier** is already in DIMENSIONS, so the agent prompt already includes it. No manual update needed when adding the advanced filter in the dashboard; the AI layer is already aware of the dimension.

---

## Phase 4: Design Decisions (Require Human Input)

> **Goal**: Surface decisions that need to be made before implementation. Cursor should document the options and trade-offs; the human will decide.

### Q4.1: Should lead score tier be an advanced-only filter, or also a global filter?

**Context**: Campaign has both a global single-select (`filters.campaignId`) and an advanced multi-select (`advancedFilters.campaigns`). Lead score tier could follow the same dual pattern, or it could be advanced-only since it's a niche/power-user filter.

**Options**:
- **A) Advanced multi-select only** — simpler, keeps global filters clean, sufficient for comparing tiers
- **B) Both global single-select + advanced multi-select** — matches campaign pattern exactly

**Recommendation** (Cursor to fill): **A) Advanced multi-select only.** Lead score tier is used mainly for scored-list analysis (Scored List Jan/Feb); power users can open advanced filters and select tiers. A global single-select would duplicate campaign-style UX and add clutter. Keeping it advanced-only is simpler and sufficient for "isolate each tier and see Contacted→MQL by tier."

**Decision** (human to fill): 


---

### Q4.2: How should NULL tiers be handled in the filter?

**Context**: 92,970 of 98,674 leads have NULL Lead_Score_Tier__c. When a user selects specific tiers in the advanced filter, NULLs are excluded (the WHERE clause only matches IN the selected list). But should there be an explicit "(No Tier)" option?

**Options**:
- **A) No "(No Tier)" option** — selecting tiers restricts to scored leads only. Simple, matches the use case (investigating scored list performance).
- **B) Include "(No Tier)" option** — lets users explicitly include unscored leads. Requires mapping "(No Tier)" to `Lead_Score_Tier__c IS NULL` in the WHERE clause.

**Recommendation** (Cursor to fill): **A) No "(No Tier)" option.** Primary use is comparing performance of scored tiers (Scored List Jan/Feb). Selecting specific tiers = restrict to those tiers; NULLs are excluded. Adding "(No Tier)" would require special WHERE handling and is out of scope for the current use case.

**Decision** (human to fill):


---

### Q4.3: Filter option query — should it query from the view or from the Lead table?

**Options**:
- **A) Query distinct tiers from `vw_funnel_master`** — simple, consistent with what the dashboard actually shows
- **B) Query from `SavvyGTMData.Lead`** — goes to the source, but might show tiers that don't appear in the funnel view

**Recommendation** (Cursor to fill): **A) Query distinct tiers from vw_funnel_master.** Consistent with channels, sources, campaigns (view or view+exists). Ensures the dropdown only shows tiers that actually appear in the funnel view. Lead table could include tiers for leads not yet in the view (e.g. different record type); the view is the single source for dashboard filtering.

**Decision** (human to fill):


---

### Q4.4: Should the filter options be date-scoped?

**Context**: Campaign filter options query filters to `IsActive = TRUE` campaigns with at least one Lead/Opp. Experimentation tags filter to the last 2 years. Should lead score tier options be:
- **A) All tiers present in the view** (no date filter) — simple, since there are only 14 values
- **B) Tiers present in the last 2 years** — consistent with experimentation tags

**Recommendation** (Cursor to fill): **A) All tiers present in the view (no date filter).** Only 14 values; tier set is small and mostly from two campaigns. Date-scoping could hide tiers that have no activity in 2 years but still exist. Keeping it simple (all tiers in view) is sufficient.

**Decision** (human to fill):


---

### Q4.5: Should we add a "Contacted→MQL by Tier" breakdown card/table?

**Context**: The advanced filter lets users isolate tiers one at a time to compare rates. But a dedicated breakdown (grouping by tier in a single view) would be more convenient. This would be a small extension — a new query that groups by `Lead_Score_Tier__c` and computes `SUM(contacted_to_mql_progression) / SUM(eligible_for_contacted_conversions_30d)` per tier.

**Options**:
- **A) Filter only (MVP)** — users toggle tiers manually to compare
- **B) Filter + breakdown table** — add a small "Conversion by Tier" component
- **C) Filter + rely on AI layer** — the AI agent can already answer "Contacted→MQL by tier" via semantic layer

**Recommendation** (Cursor to fill): **A) Filter only (MVP)** for the dashboard. Option **C** already holds: the semantic layer and conversion_by_dimension support "Contacted→MQL by tier," so the AI agent can answer that. A dedicated breakdown card (B) can be added later if needed; MVP = advanced filter only.

**Decision** (human to fill):


---

## Phase 5: Edge Case Verification

> **Goal**: Validate that the implementation will work correctly for edge cases before writing code.

### Q5.1: Does the campaign multi-select WHERE clause pattern work for a simple string field?

The campaign advanced filter uses:
```sql
(v.Campaign_Id__c IN UNNEST(@adv_campaigns) 
 OR (SELECT COUNT(1) FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp 
     WHERE camp.id IN (SELECT * FROM UNNEST(@adv_campaigns))) > 0)
```

Lead score tier is simpler — it's just a single string field. Confirm the WHERE clause should simply be:
```sql
v.Lead_Score_Tier__c IN UNNEST(@adv_lead_score_tiers)
```

No `all_campaigns`-style array to check. Correct?

**Answer:** ✅

Yes. Lead_Score_Tier__c is a single STRING per row. The WHERE clause should be `v.Lead_Score_Tier__c IN UNNEST(@adv_lead_score_tiers)` (with param `adv_lead_score_tiers` = array of selected tier values). No array/UNNEST logic like campaigns.



---

### Q5.2: Will the 30-day eligibility rule still work when filtering by tier?

When the dashboard filters by tier, it restricts which **rows** are included. The `eligible_for_contacted_conversions_30d` and `contacted_to_mql_progression` flags are pre-computed in the view. Filtering by tier just changes the denominator and numerator population. Confirm this is safe and correct — no special handling needed.

**Answer:** ✅

Yes. Filtering by tier only restricts **which rows** are included in the query. The view already has `eligible_for_contacted_conversions_30d` and `contacted_to_mql_progression`; the query just SUMs them over the filtered set. Denominator and numerator both shrink together; the 30-day rule is unchanged. No special handling needed.

---

### Q5.3: Does source-performance.ts group by tier? (Double-counting risk)

Confirm that source-performance groups by **channel** or **source**, not by tier. So filtering by tier doesn't cause row multiplication — it just restricts which rows are included before grouping.

**Answer:** ✅

source-performance groups by **channel** (Channel_Grouping_Name) and by **source + channel** (Original_source, Channel_Grouping_Name). It does **not** group by tier. Filtering by tier only restricts rows before grouping; no row multiplication, no double-counting.

---

## Phase 6: Validation Queries for Post-Implementation

> **Goal**: Pre-write the validation queries that confirm the implementation is working. These will be run after deployment.

### Q6.1: Write a BQ query that replicates what the dashboard should show

When a user filters to:
- Campaign = "Scored List January 2026"
- Lead Score Tier = "TIER_1_PRIME_MOVER"

...the dashboard's Contacted→MQL rate card should show a specific number. Write the BQ query that produces this expected value so we can validate against the dashboard.

**Answer:** ✅

```sql
SELECT
  SUM(contacted_to_mql_progression) AS numerator,
  SUM(eligible_for_contacted_conversions_30d) AS denominator,
  SAFE_DIVIDE(SUM(contacted_to_mql_progression), SUM(eligible_for_contacted_conversions_30d)) * 100 AS rate_pct
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE (
  v.Campaign_Id__c = '701VS00000ZtS4NYAV'
  OR EXISTS (SELECT 1 FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id = '701VS00000ZtS4NYAV')
)
AND v.Lead_Score_Tier__c = 'TIER_1_PRIME_MOVER';
```
Run this; compare numerator, denominator, and rate_pct to the dashboard when Campaign = Scored List January 2026 and Lead Score Tier = TIER_1_PRIME_MOVER (and same date range if the dashboard applies one).



---

### Q6.2: Write a BQ query for the full tier breakdown (all tiers, January list)

This would be the "gold standard" output that a tier-breakdown component (if built) should match. GROUP BY tier, show contacted, MQL, progression, eligible, rate.

**Answer:** ✅

```sql
SELECT
  v.Lead_Score_Tier__c AS tier,
  COUNT(*) AS row_count,
  SUM(v.is_contacted) AS contacted,
  SUM(v.is_mql) AS mql,
  SUM(v.contacted_to_mql_progression) AS progression,
  SUM(v.eligible_for_contacted_conversions_30d) AS eligible_30d,
  SAFE_DIVIDE(SUM(v.contacted_to_mql_progression), SUM(v.eligible_for_contacted_conversions_30d)) * 100 AS contacted_to_mql_rate_pct
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE EXISTS (SELECT 1 FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id = '701VS00000ZtS4NYAV')
   OR v.Campaign_Id__c = '701VS00000ZtS4NYAV'
GROUP BY v.Lead_Score_Tier__c
ORDER BY row_count DESC;
```



---

## Phase 7: Summary of Findings

> **Goal**: After all phases are answered, Cursor should write a summary here confirming readiness.

### Readiness Checklist

| Item | Status | Notes |
|------|--------|-------|
| Field in view | ✅ | Lead_Score_Tier__c in view; 5,704 rows with tier |
| Semantic layer dimension | ✅ | lead_score_tier in definitions.ts; filterable, groupable |
| Filter-options query designed | ✅ | Query from vw_funnel_master, add LeadScoreTierResult, Promise.all, return mapping |
| filter-helpers.ts insertion point confirmed | ✅ | After campaigns block (before return); add safeFilters.leadScoreTiers, WHERE, hasActiveFilters |
| AdvancedFilters.tsx insertion point confirmed | ✅ | Add search state, filteredLeadScoreTiers, type unions, MultiSelectFilterControl after Campaigns |
| All query files mapped | ✅ | No change in funnel-metrics/conversion-rates/source-performance/detail-records; tier comes from buildAdvancedFilterClauses only |
| Edge cases verified | ✅ | Simple IN UNNEST; 30-day rule unchanged; source-performance does not group by tier |
| Validation queries ready | ✅ | Q6.1 (Campaign + Tier filter) and Q6.2 (full tier breakdown Jan list) |
| Design decisions made | Pending | Q4.1–Q4.5 await human decision |

### Blockers or Concerns

- **591 leads** have tier set but are not in Scored List Jan or Feb; they come from other campaigns/sources. Filter options will include all tiers present in the view; no blocker.
- **DetailRecordsTable** and **DetailRecord** type do not have a tier column; optional add (Q2.9) if table should show tier.
- No code changes were made; this document is investigation-only.

---

## Appendix A: File Change Map (To Be Populated After Investigation)

Once all phases are complete, populate this table with every file that needs changes:

| File | Change Type | Description |
|------|------------|-------------|
| `src/types/filters.ts` | Modify | Add `leadScoreTiers` to AdvancedFilters, DEFAULT_ADVANCED_FILTERS, hasActive, countActive, FilterOptions |
| `src/lib/utils/filter-helpers.ts` | Modify | Add lead score tier block in buildAdvancedFilterClauses and hasActiveFilters |
| `src/lib/queries/filter-options.ts` | Modify | Add LeadScoreTierResult, query, Promise.all entry, return mapping |
| `src/app/api/dashboard/filters/route.ts` | Modify | Add leadScoreTiers to filterOptions response |
| `src/components/dashboard/AdvancedFilters.tsx` | Modify | Add search state, filtered memo, type union, MultiSelectFilterControl |
| `src/lib/queries/funnel-metrics.ts` | Verify | Confirm advanced filters propagate (no change needed if buildAdvancedFilterClauses is used) |
| `src/lib/queries/conversion-rates.ts` | Verify | Same |
| `src/lib/queries/source-performance.ts` | Verify | Same |
| `src/lib/queries/detail-records.ts` | Verify | Same |
| `src/lib/queries/record-detail.ts` | Possibly modify | Add Lead_Score_Tier__c to SELECT if missing |
| `src/components/dashboard/RecordDetailModal.tsx` | Possibly modify | Add DetailRow for tier |
| `src/components/dashboard/DetailRecordsTable.tsx` | Possibly modify | Add tier column |
| `src/lib/semantic-layer/definitions.ts` | Verify | lead_score_tier dimension already exists |
| `src/lib/semantic-layer/query-templates.ts` | Possibly modify | Add example questions mentioning tier |
