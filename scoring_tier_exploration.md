# Lead Score Tier Exploration

This document describes **Lead_Score_Tier__c** from `savvy-gtm-analytics.SavvyGTMData.Lead`: data type, tier values present in the data, current use in the funnel view, and how to add it to the **advanced filters** so you can isolate each tier and compare **Contacted→MQL conversion rates** by scoring tier on the funnel performance dashboard.

---

## 1. Data type and source

| Property | Value |
|----------|--------|
| **Table** | `savvy-gtm-analytics.SavvyGTMData.Lead` |
| **Field** | `Lead_Score_Tier__c` |
| **Data type (BigQuery)** | **STRING** |
| **Nullable** | Yes (many leads have NULL) |

It is a custom Salesforce field on the Lead object, typically populated by a lead-scoring process (e.g. rules or model) to segment leads into tiers.

---

## 2. Tier values present in the data

From `SavvyGTMData.Lead` (non-deleted leads, non-null/non-empty `Lead_Score_Tier__c`):

| Tier value | Description (inferred from name) |
|------------|----------------------------------|
| **STANDARD** | Standard tier |
| **STANDARD_HIGH_V4** | Standard high (v4) |
| **TIER_0A_PRIME_MOVER_DUE** | Prime mover – due |
| **TIER_0B_SMALL_FIRM_DUE** | Small firm – due |
| **TIER_0C_CLOCKWORK_DUE** | Clockwork – due |
| **TIER_1_PRIME_MOVER** | Prime mover |
| **TIER_1B_PRIME_MOVER_SERIES65** | Prime mover (Series 65) |
| **TIER_1D_SMALL_FIRM** | Small firm |
| **TIER_1E_PRIME_MOVER** | Prime mover (1E) |
| **TIER_1F_HV_WEALTH_BLEEDER** | High-value wealth bleeder |
| **TIER_2_PROVEN_MOVER** | Proven mover |
| **TIER_3_MODERATE_BLEEDER** | Moderate bleeder |
| **TIER_4_EXPERIENCED_MOVER** | Experienced mover |

**Counts (from BQ):**

- **Total leads (non-deleted):** 98,674  
- **With tier set:** 5,704  
- **Tier NULL:** 92,970  

So 14 distinct tier values exist; the majority of leads have no tier set.

---

## 2.1 Why only 5,704 leads have a tier (Scored List campaigns)

Tiers are **not** set for most leads in the org. The **only campaigns that have members with Lead_Score_Tier__c set** (in our data) are the **scored list** campaigns:

| Campaign | Campaign ID | Type | Member count (CampaignMember) | Members with tier set (Lead) |
|----------|-------------|------|------------------------------|------------------------------|
| **Scored List January 2026** | 701VS00000ZtS4NYAV | List Upload | 2,621 | 2,621 (100%) |
| **Scored List February 2026** | 701VS00000bIQ3bYAG | List Upload | 2,492 | 2,492 (100%) |

- **Campaign** records live in `savvy-gtm-analytics.SavvyGTMData.Campaign`.
- **Members** live in `savvy-gtm-analytics.SavvyGTMData.CampaignMember` (LeadId, CampaignId).
- Those leads appear in **vw_funnel_master** and are linked to the campaign via **all_campaigns** (so filtering by “Scored List January 2026” or “Scored List February 2026” shows the right rows).

So the **5,704 leads with tier set** are essentially the **Scored List January 2026 + Scored List February 2026** campaign members (2,621 + 2,492 = 5,113; the remainder may be overlap, other small scored lists, or sync timing). We are particularly interested in **Contacted→MQL conversion rate** for these two lists, and by **tier within** each list.

---

## 2.2 Contacted→MQL for the two Scored List campaigns (BQ)

From **vw_funnel_master** (Tableau_Views), restricting to rows in **all_campaigns** for each campaign:

**Scored List January 2026 (campaign id 701VS00000ZtS4NYAV):**

| Metric | Value |
|--------|--------|
| Row count (members in funnel) | 2,621 |
| Contacted (is_contacted) | 1,781 |
| MQL (is_mql) | 24 |
| Contacted→MQL progression | 18 |
| Eligible for Contacted→MQL (30d rule) | 772 |
| **Contacted→MQL rate** (progression / eligible_30d) | **~2.33%** |

**Scored List February 2026 (campaign id 701VS00000bIQ3bYAG):**

| Metric | Value |
|--------|--------|
| Row count (members in funnel) | 2,492 |
| Contacted | 117 |
| MQL | 3 |
| Contacted→MQL progression | 1 |
| Eligible (30d) | 1 |
| **Contacted→MQL rate** | **100%** (1/1; very small eligible cohort so far) |

**Tier distribution within scored lists:**

- **Scored List January 2026:** 6 distinct tiers among the 2,621 members (exact tier breakdown can be run in BQ; sample from vw_funnel: e.g. TIER_3_MODERATE_BLEEDER, TIER_0A_PRIME_MOVER_DUE, and others).
- **Scored List February 2026:** 7 distinct tiers among the 2,492 members.

To see **Contacted→MQL by tier** for each list, filter the dashboard by campaign (Scored List Jan or Feb) and add a **Lead Score Tier** advanced filter (Section 5). Once that filter exists, you can select one or more tiers and the conversion rate card will show the rate for that subset. Optionally, add a “by tier” breakdown query that groups by `Lead_Score_Tier__c` and sums `contacted_to_mql_progression` and `eligible_for_contacted_conversions_30d` for each tier.

---

## 3. Current use in vw_funnel_master

**Lead_Score_Tier__c is already in the view.**

- **Lead_Base** (line ~20): `Lead_Score_Tier__c` is selected from `SavvyGTMData.Lead`.
- **Combined** (line ~196): `l.Lead_Score_Tier__c` is selected (lead side only; opportunity-only rows get NULL from the FULL OUTER JOIN).
- The column is carried through **With_Channel_Mapping** → **With_SGA_Lookup** → **With_Campaign_Name** → **Final** via `SELECT *` / `wsl.*`, so **Lead_Score_Tier__c** is in the final output of `vw_funnel_master`.

So the view already exposes the field; no view change is required to “bring it in.” What’s missing is **filtering and sorting** by this field in the dashboard.

---

## 4. Goal: isolate tiers and see Contacted→MQL by tier

You want to:

1. **Filter** by one or more lead score tiers in the **advanced filters** (not the main global filters).
2. **Compare Contacted→MQL conversion rates** by tier (e.g. filter to “TIER_1_PRIME_MOVER” only, then “TIER_2_PROVEN_MOVER” only) to see which tier performs best.

Conversion rates (and other metrics) are already driven by `vw_funnel_master` and already apply **advanced filter** clauses (channels, sources, campaigns, etc.). Adding a **lead score tier** advanced filter follows the same pattern: add the tier filter to the advanced-filter builder and to the filter options that populate the dropdown; then conversion rates will automatically restrict to the selected tier(s).

---

## 5. How to add Lead Score Tier to advanced filters

### 5.1 Pattern to follow

The dashboard already has advanced multi-select filters for **channels**, **sources**, **sgas**, **sgms**, **experimentationTags**, and **campaigns**. Lead score tier should be added in the same way.

### 5.2 Implementation checklist

1. **Types (`src/types/filters.ts`)**  
   - Add `leadScoreTiers: MultiSelectFilter` to `AdvancedFilters`.  
   - Add default in `DEFAULT_ADVANCED_FILTERS`: `leadScoreTiers: { selectAll: true, selected: [] }`.  
   - In `hasActiveAdvancedFilters` and `countActiveAdvancedFilters`, include `!filters.leadScoreTiers.selectAll`.

2. **Filter options (`src/lib/queries/filter-options.ts`)**  
   - Add a query that returns distinct lead score tiers from the view (and optionally counts), e.g.  
     - `SELECT Lead_Score_Tier__c AS value, COUNT(*) AS record_count FROM ${FULL_TABLE} WHERE Lead_Score_Tier__c IS NOT NULL AND TRIM(Lead_Score_Tier__c) != '' AND FilterDate >= ... GROUP BY Lead_Score_Tier__c ORDER BY record_count DESC`.  
   - Add the result to `RawFilterOptions` (e.g. `leadScoreTiers: FilterOption[]` or `string[]` depending on existing pattern).  
   - Run this query in `_getRawFilterOptions` and map the result into the returned object (same pattern as campaigns/channels).

3. **Filter WHERE clause (`src/lib/utils/filter-helpers.ts`)**  
   - In `buildAdvancedFilterClauses`, add a block for lead score tier:  
     - If `!safeFilters.leadScoreTiers.selectAll && safeFilters.leadScoreTiers.selected.length > 0`, push  
       - `v.Lead_Score_Tier__c IN UNNEST(@${paramPrefix}_lead_score_tiers)`  
     - and set `params[${paramPrefix}_lead_score_tiers] = safeFilters.leadScoreTiers.selected`.  
   - In `hasActiveFilters`, add `!filters.leadScoreTiers.selectAll`.

4. **API / filters route**  
   - Ensure the dashboard filters API and any client that sends `advancedFilters` include the new `leadScoreTiers` shape (selectAll + selected array).  
   - If the API returns filter options, add the lead-score-tier options to the response (same structure as campaigns/channels).

5. **Dashboard UI (advanced filters panel)**  
   - Add a **Lead Score Tier** multi-select control (same UX as Channels, Sources, Campaigns): dropdown or checklist of tier options, “Select all” / clear, and store `leadScoreTiers.selectAll` and `leadScoreTiers.selected`.  
   - Wire it to the same `advancedFilters` state and the same API that applies filters to conversion rates and other funnel queries.

6. **Queries that use advanced filters**  
   - No change needed in **conversion-rates.ts**, **source-performance.ts**, **funnel-metrics.ts**, **detail-records.ts**, etc., as long as they keep using `buildAdvancedFilterClauses(advancedFilters, 'adv')` and the `whereClauses`/params are appended to the main query. The new tier clause will then automatically apply to Contacted→MQL and all other metrics that use advanced filters.

### 5.3 Sorting by tier

If by “sort by” you mean **ordering the conversion-rate table or detail records by tier**:

- **Filtering** (above) already “isolates” tiers (one or multiple).  
- To **sort** (e.g. detail table or a breakdown table by tier), add `Lead_Score_Tier__c` to the SELECT of the relevant query and add an `ORDER BY Lead_Score_Tier__c` (or by a tier display order if you introduce one).  
- To see **Contacted→MQL rate per tier** in one view, you could add a separate “conversion by lead score tier” report that groups by `Lead_Score_Tier__c` and computes the same numerator/denominator as the main Contacted→MQL metric (using `eligible_for_contacted_conversions_30d` and `contacted_to_mql_progression`). That would be a small extension once the tier filter exists.

### 5.4 Edge cases

- **NULL / empty tier:** Most leads have `Lead_Score_Tier__c` NULL. Decide whether the advanced filter should mean “only rows with tier IN (selected)” (excluding NULL) or whether you want an explicit “(No tier)” option that maps to `Lead_Score_Tier__c IS NULL`. The suggested WHERE clause above only includes rows whose tier is in the selected list; NULLs are excluded unless you add a special value for them.
- **Opportunity-only rows:** The view gets `Lead_Score_Tier__c` from the lead side; opportunity-only rows (no lead) will have NULL. Filtering by tier will effectively restrict to lead-based rows (or lead+opp rows). That is consistent with “lead scoring” being a lead attribute.

---

## 6. Summary

| Topic | Conclusion |
|-------|------------|
| **Data type** | STRING, nullable. |
| **Tiers in data** | 14 distinct values (e.g. STANDARD, TIER_1_PRIME_MOVER, TIER_2_PROVEN_MOVER, …); 5,704 leads with tier set, 92,970 NULL. |
| **Where tiers are set** | Only **Scored List January 2026** (2,621 members) and **Scored List February 2026** (2,492 members) have 100% of members with a tier; those campaign members are in Campaign/CampaignMember and in vw_funnel_master via **all_campaigns**. |
| **Contacted→MQL for scored lists** | Jan 2026: ~2.33% (18/772 eligible); Feb 2026: 100% (1/1) so far. We want to compare **Contacted→MQL by tier** within these lists to see which tier performs best. |
| **In vw_funnel_master** | Already present as `Lead_Score_Tier__c`; no view change needed. |
| **Add to dashboard** | Add **Lead Score Tier** as an advanced multi-select filter (types, filter-options query, filter-helpers WHERE clause, API, UI). Then: filter by campaign “Scored List January 2026” or “Scored List February 2026” and by tier(s) to isolate each tier and see Contacted→MQL for that tier; optionally add a “by tier” breakdown or sort by tier in tables. |

Implementing the steps in **Section 5.2** will let you select specific tiers in the funnel performance dashboard’s advanced filters and compare Contacted→MQL conversion rates by tier for the Scored List January 2026 and Scored List February 2026 campaigns.
