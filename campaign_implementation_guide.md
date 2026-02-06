# Campaign Filtering Implementation Guide

**Goal**: Add Campaign object filtering to the funnel performance dashboard, replacing/complementing the experimentation_tag filter with proper Salesforce Campaign object support.

**Validation Target**: 74 Savvy Pirate campaign prospects contacted between 1/1/2026 - 2/6/2026

**Execution order (for agentic runs)**  
1. **Phase 1** (view) first — deploy `vw_funnel_master.sql` so Campaign columns exist in BigQuery.  
2. **Phase 2** (types) — add all TypeScript types and defaults so Phase 3/4 compile.  
3. **Phase 3** (backend) — filter-options, filter-helpers, query files, semantic layer.  
4. **Phase 4** (frontend) — GlobalFilters, AdvancedFilters, RecordDetailModal, DetailRecordsTable; ensure api-client and dashboard page include campaignId/campaigns (Steps 2.9–2.10).  
5. **Phase 5** (testing) — validate 74 Savvy Pirate, filter API, and UI.  
Dependencies: filter-options and filters route need RawFilterOptions/FilterOptions with campaigns; query files need filters.campaignId and (where applicable) advanced filter clauses from filter-helpers.

**CRITICAL FOR AGENTIC EXECUTION**
- Execute validations **IMMEDIATELY** after completing each phase.
- **Do NOT proceed** to the next phase if **ANY** validation fails.
- Fix validation failures before moving forward.
- This prevents cascading errors and saves debugging time.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Phase 1: Database View Update](#phase-1-database-view-update)
3. [✅ PHASE 1 VALIDATION](#phase-1-validation-after-database-view-changes)
4. [Phase 2: TypeScript Type Definitions](#phase-2-typescript-type-definitions)
5. [✅ PHASE 2 VALIDATION](#phase-2-validation-after-typescript-type-changes)
6. [Phase 3: Backend Query Layer](#phase-3-backend-query-layer)
7. [✅ PHASE 3 VALIDATION](#phase-3-validation-after-backend-query-changes)
8. [Phase 4: Frontend UI Components](#phase-4-frontend-ui-components)
9. [✅ PHASE 4 VALIDATION](#phase-4-validation-after-frontend-ui-changes)
10. [Phase 5: Testing & Validation](#phase-5-testing--validation)
11. [Phase 6: Deployment](#phase-6-deployment)
12. [Rollback Procedure](#rollback-procedure)

---

## Prerequisites

**Before starting**:
- [ ] Backup current `vw_funnel_master.sql`
- [ ] Create feature branch: `feature/campaign-filtering`
- [ ] Verify you have BigQuery deployment access
- [ ] Confirm 74 Savvy Pirate records exist (already validated in Q13.1)

---

## Phase 1: Database View Update

### File: `C:\Users\russe\Documents\Dashboard\views\vw_funnel_master.sql`

**Objective**: Add Campaign_Id__c, Lead_Campaign_Id__c, Opp_Campaign_Id__c, and Campaign_Name__c to vw_funnel_master

#### Step 1.1: Update Lead_Base CTE

**Location**: After line 17 (`Experimentation_Tag__c AS Lead_Experimentation_Tag__c,`). Insert the new line **before** `Lead_Score_Tier__c`.

**Add exactly one line**:
```sql
    Experimentation_Tag__c AS Lead_Experimentation_Tag__c,
    Campaign__c AS Lead_Campaign_Id__c,   -- ADD THIS LINE ONLY
    Lead_Score_Tier__c,
```

#### Step 1.2: Update Opp_Base CTE

**Location**: After `External_Agency__c AS Opp_External_Agency__c,` and before `NextStep` (or after `NextStep,` and before the closing of the SELECT). Add one line so Opp_Base exposes the campaign ID.

**Add exactly one line**:
```sql
    External_Agency__c AS Opp_External_Agency__c,
    CampaignId AS Opp_Campaign_Id__c,   -- ADD THIS LINE ONLY
    NextStep AS Opp_NextStep

  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
```

#### Step 1.3: Update Combined CTE

**Location**: Line 161 (after `Experimentation_Tag_Raw__c`)

**Add**:
```sql
    -- Experiment Tags (raw)
    COALESCE(o.Opportunity_Experimentation_Tag__c, l.Lead_Experimentation_Tag__c) AS Experimentation_Tag_Raw__c,
    
    -- Campaign IDs (raw and coalesced)  -- ADD THESE 3 LINES
    COALESCE(o.Opp_Campaign_Id__c, l.Lead_Campaign_Id__c) AS Campaign_Id__c,
    l.Lead_Campaign_Id__c,
    o.Opp_Campaign_Id__c,
    
    -- Record Classification
    o.RecordTypeId AS recordtypeid,
```

#### Step 1.4: Add With_Campaign_Name CTE

**Location**: After `With_SGA_Lookup` CTE (around line 192)

**Add entire new CTE**:
```sql
-- Add User lookup for Opportunity SGA names (when SGA_Owner_Name__c is NULL)
With_SGA_Lookup AS (
  SELECT
    wcm.*,
    u.Name AS Opp_SGA_User_Name
  FROM With_Channel_Mapping wcm
  LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.User` u
    ON wcm.Opp_SGA_Name__c = u.Id
),

-- ADD THIS ENTIRE NEW CTE:
-- Join Campaign table to get campaign names for display
With_Campaign_Name AS (
  SELECT
    wsl.*,
    c.Name AS Campaign_Name__c
  FROM With_SGA_Lookup wsl
  LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.Campaign` c
    ON wsl.Campaign_Id__c = c.Id
),

-- Final transformation with all derived fields
```

#### Step 1.5: Update Final CTE

**Location**: At the **bottom** of the Final CTE only. The Final CTE starts with `Final AS ( SELECT ...` and ends with `FROM With_SGA_Lookup wsl )`. Do **not** change the SELECT line; only change the FROM.

**Change the Final CTE’s FROM clause** (search for `FROM With_SGA_Lookup wsl` near the end of the file, ~line 372):
```sql
  FROM With_SGA_Lookup wsl
)
```
**To**:
```sql
  FROM With_Campaign_Name wsl
)
```
(Replace `With_SGA_Lookup` with `With_Campaign_Name`; keep the alias `wsl`.)

**Summary of View Changes**:
- ✅ Lead_Campaign_Id__c added from Lead.Campaign__c
- ✅ Opp_Campaign_Id__c added from Opportunity.CampaignId
- ✅ Campaign_Id__c created via COALESCE(opp, lead)
- ✅ Campaign_Name__c added via LEFT JOIN to Campaign table
- ✅ All existing columns preserved

---

## ✅ PHASE 1 VALIDATION (after database view changes)

**Execute these checks immediately after Phase 1. Do NOT proceed to Phase 2 until all pass.**

1. **BigQuery deployment verification**
   - Run the modified view SQL in BigQuery console (CREATE OR REPLACE VIEW).
   - Verify no syntax errors.
   - Confirm view created successfully.

2. **Column existence check** — Run this query:
   ```sql
   SELECT column_name, data_type
   FROM `savvy-gtm-analytics.Tableau_Views.INFORMATION_SCHEMA.COLUMNS`
   WHERE table_name = 'vw_funnel_master'
     AND column_name IN ('Campaign_Id__c', 'Campaign_Name__c', 'Lead_Campaign_Id__c', 'Opp_Campaign_Id__c')
   ORDER BY column_name;
   ```
   **Expected:** 4 rows returned (all STRING type).  
   **If failed:** Review Steps 1.1–1.5 (Lead_Base, Opp_Base, Combined, With_Campaign_Name, Final FROM).

3. **Data population check**
   ```sql
   SELECT 
     COUNT(*) as total_records,
     COUNT(Campaign_Id__c) as records_with_campaign,
     COUNT(DISTINCT Campaign_Id__c) as distinct_campaigns
   FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`;
   ```
   **Expected:** `records_with_campaign` ~4,000+; `distinct_campaigns` ~15+.  
   **If failed:** Check With_Campaign_Name CTE and COALESCE logic.

4. **CRITICAL — 74 Savvy Pirate validation**
   ```sql
   SELECT COUNT(*) as contacted_count
   FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
   WHERE v.Campaign_Id__c = '701VS00000YdiVVYAZ'
     AND v.stage_entered_contacting__c IS NOT NULL
     AND DATE(v.stage_entered_contacting__c) >= DATE('2026-01-01')
     AND DATE(v.stage_entered_contacting__c) <= DATE('2026-02-06');
   ```
   **Expected:** `contacted_count = 74` exactly.  
   **If not 74:** STOP; review Campaign_Id__c COALESCE logic and date filters.

5. **Regression check** — Verify existing columns still work:
   ```sql
   SELECT advisor_name, Original_source, Channel_Grouping_Name, 
          SGA_Owner_Name__c, is_contacted, is_sql
   FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
   LIMIT 5;
   ```
   **Expected:** 5 rows, no errors.

✅ **DO NOT PROCEED TO PHASE 2** until all Phase 1 validations pass.

---

## Phase 2: TypeScript Type Definitions

### File: `src/types/filters.ts`

#### Step 2.1: Update DashboardFilters Interface

**Location**: In `DashboardFilters` (around line 100–115), add **one property** after `experimentationTag`.

**Add**:
```typescript
  experimentationTag: string | null;
  campaignId: string | null;  // ADD THIS LINE - single campaign ID for global filter
  metricFilter: 'all' | 'prospect' | 'contacted' | 'mql' | 'sql' | 'sqo' | 'signed' | 'joined' | 'openPipeline';
```
Do not change existing property types or make other fields optional; the codebase uses required fields for DashboardFilters.

#### Step 2.2: Update AdvancedFilters Interface

**Location**: Find the AdvancedFilters interface

**Add after `experimentationTags`**:
```typescript
export interface AdvancedFilters {
  initialCallScheduled?: DateRangeFilter;
  qualificationCallDate?: DateRangeFilter;
  channels?: MultiSelectFilter;
  sources?: MultiSelectFilter;
  sgas?: MultiSelectFilter;
  sgms?: MultiSelectFilter;
  experimentationTags?: MultiSelectFilter;
  campaigns?: MultiSelectFilter;  // ADD THIS LINE
}
```

#### Step 2.3: Update DEFAULT_ADVANCED_FILTERS

**Location**: Find `DEFAULT_ADVANCED_FILTERS` constant. The codebase uses `preset: 'any'`, `startDate: null`, `endDate: null` for date filters and `selectAll: true, selected: []` for multi-selects (no `operator` property).

**Add after `experimentationTags`** (match existing shape exactly):
```typescript
  experimentationTags: {
    selectAll: true,
    selected: [],
  },
  campaigns: { selectAll: true, selected: [] },  // ADD THIS LINE
};
```

#### Step 2.4: Update hasActiveAdvancedFilters Function

**Location**: Find the hasActiveAdvancedFilters function

**Add campaign check**: Add one condition to the return expression (after `!filters.experimentationTags.selectAll`):
```typescript
    !filters.experimentationTags.selectAll ||
    !filters.campaigns?.selectAll  // ADD THIS LINE (use .campaigns.selectAll if AdvancedFilters is required)
  );
```

#### Step 2.5: Update countActiveAdvancedFilters Function

**Location**: Find the countActiveAdvancedFilters function

**Add campaign count**: Add one `if` after the experimentationTags check:
```typescript
  if (!filters.experimentationTags.selectAll) count++;
  if (!filters.campaigns?.selectAll) count++;  // ADD THIS LINE
  return count;
```

### File: `src/types/filters.ts` - FilterOptions Interface

#### Step 2.6: Update FilterOptions Interface

**Location**: Find `FilterOptions`. The codebase has `channels: string[]`, `sources: string[]`, `sgas: FilterOption[]`, `sgms: FilterOption[]`, `stages: string[]`, `years: number[]`, `experimentationTags: string[]`.

**Add after `experimentationTags`**:
```typescript
  experimentationTags: string[];
  campaigns: FilterOption[];  // ADD THIS LINE - { value: campaignId, label: campaignName, isActive }
}
```
(SGA/SGM use FilterOption[] with value/label/isActive; campaigns use value = Id, label = Name.)

### File: `src/types/record-detail.ts`

#### Step 2.7: Update RecordDetailFull Interface

**Location**: Find RecordDetailFull interface, add to Attribution section

**Add after `experimentationTag`**:
```typescript
export interface RecordDetailFull {
  // Identifiers
  id: string;
  fullProspectId: string | null;
  // ... other fields ...
  
  // Attribution
  source: string;
  channel: string;
  sga: string | null;
  sgm: string | null;
  externalAgency: string | null;
  nextSteps: string | null;
  opportunityNextStep: string | null;
  leadScoreTier: string | null;
  experimentationTag: string | null;
  campaignId: string | null;        // ADD THIS LINE
  campaignName: string | null;      // ADD THIS LINE
  
  // ... rest of interface ...
}
```

#### Step 2.8: Update RecordDetailRaw Interface

**Location**: Find RecordDetailRaw interface

**Add after `Experimentation_Tag_Raw__c`**:
```typescript
export interface RecordDetailRaw {
  // ... other fields ...
  
  // Attribution
  Original_source: string;
  Channel_Grouping_Name: string;
  SGA_Owner_Name__c: string | null;
  SGM_Owner_Name__c: string | null;
  External_Agency__c: string | null;
  Next_Steps__c: string | null;
  NextStep: string | null;
  Lead_Score_Tier__c: string | null;
  Experimentation_Tag_Raw__c: string | null;
  Campaign_Id__c: string | null;           // ADD THIS LINE
  Campaign_Name__c: string | null;         // ADD THIS LINE
  
  // ... rest of interface ...
}
```

### File: `src/lib/api-client.ts`

#### Step 2.9: Include campaignId and campaigns in Request Payload

**Location**: Where dashboard filters are serialized for API calls (e.g. `buildDashboardRequest` or the object passed to `getFunnelMetrics`, `getConversionRates`, etc.). The codebase has a `clean` object that lists each filter key.

**Add**:
- To the top-level filter object: `campaignId: filters.campaignId,`
- In the `advancedFilters` merge (if present): include `campaigns: { ...DEFAULT_ADVANCED_FILTERS.campaigns, ...(filters.advancedFilters?.campaigns || {}) },` so that when advanced filters are sent, `campaigns` is included.

### File: `src/app/dashboard/page.tsx`

#### Step 2.10: Default Filters and Equality Check

**Location**: Where default dashboard filters are defined (e.g. `DEFAULT_FILTERS` or initial state) and where `filtersAreEqual` (or equivalent) compares filters.

**Add**:
- To the default filters object: `campaignId: null,` (so the dashboard starts with no campaign selected).
- To the equality comparison: compare `a.campaignId === b.campaignId` and, for advanced filters, ensure `campaigns` is merged and compared (e.g. `!filters.campaigns.selectAll` and `filters.campaigns.selected` length/contents) so that "Apply" state and saved reports work correctly.

---

## ✅ PHASE 2 VALIDATION (after TypeScript type changes)

**Execute these checks immediately after Phase 2. Do NOT proceed to Phase 3 until all pass.**

1. **TypeScript compilation check**
   ```bash
   npx tsc --noEmit
   ```
   **Expected:** No type errors.  
   **If errors:** Review Steps 2.1–2.10; check all interface and default updates.

2. **Linting check**
   ```bash
   npm run lint
   ```
   **Expected:** No errors (warnings acceptable).  
   **If errors:** Run `npm run lint -- --fix` first, then fix remaining issues.

3. **Specific type file checks** (optional; confirms types in isolation)
   ```bash
   npx tsc --noEmit  # full project is sufficient; these are for targeted debugging
   ```
   If needed: ensure `src/types/filters.ts`, `src/types/record-detail.ts`, and `src/types/dashboard.ts` are consistent (no missing `campaignId`/`campaigns`/`campaignName`).

4. **Manual verification checklist**
   - [ ] `DEFAULT_ADVANCED_FILTERS.campaigns` exists with `{ selectAll: true, selected: [] }`
   - [ ] `hasActiveAdvancedFilters` includes campaign check
   - [ ] `countActiveAdvancedFilters` includes campaign count
   - [ ] `FilterOptions` includes `campaigns: FilterOption[]`
   - [ ] `DashboardFilters` includes `campaignId: string | null`
   - [ ] `RecordDetailFull` includes `campaignId` and `campaignName`
   - [ ] api-client and dashboard page include campaignId/campaigns (Steps 2.9–2.10)

✅ **DO NOT PROCEED TO PHASE 3** until all Phase 2 validations pass.

---

## Phase 3: Backend Query Layer

### File: `src/lib/queries/filter-options.ts`

**Important**: The codebase does **not** use separate `getChannels`, `getSources`, etc. It has a single `_getRawFilterOptions` that defines query strings and runs them in one `Promise.all([runQuery(...), ...])`, then maps results into `RawFilterOptions`. Follow that pattern for campaigns.

#### Step 3.1: Add Campaign Result Type and Query

**Location**: After `ExperimentationTagResult` interface (around line 44)

**Add**:
```typescript
interface CampaignResult {
  id: string | null;
  name: string | null;
}
```

**Add to `RawFilterOptions`** (the exported interface, around line 61):
```typescript
  experimentationTags: string[];
  campaigns: Array<{ value: string; label: string }>;  // value = Id, label = Name
}
```

#### Step 3.2: Add Campaigns Query and Include in _getRawFilterOptions

**Location**: Inside `_getRawFilterOptions`, after `experimentationTagsQuery` and before the `Promise.all`.

**Add the campaigns query** (after experimentationTagsQuery):
```typescript
  const campaignsQuery = `
    SELECT DISTINCT
      c.Id as id,
      c.Name as name
    FROM \`savvy-gtm-analytics.SavvyGTMData.Campaign\` c
    WHERE c.IsActive = TRUE
      AND (
        EXISTS (SELECT 1 FROM \`savvy-gtm-analytics.SavvyGTMData.Lead\` l WHERE l.Campaign__c = c.Id)
        OR EXISTS (SELECT 1 FROM \`savvy-gtm-analytics.SavvyGTMData.Opportunity\` o WHERE o.CampaignId = c.Id)
      )
    ORDER BY c.Name ASC
  `;
```

**Update the Promise.all**: Add an 8th element to the destructuring array and to the `runQuery` array:
```typescript
  const [
    channelsResult,
    sourcesResult,
    sgasResult,
    sgmsResult,
    stagesResult,
    yearsResult,
    experimentationTagsResult,
    campaignsResult,  // ADD THIS
  ] = await Promise.all([
    runQuery<ChannelResult>(channelsQuery),
    runQuery<SourceResult>(sourcesQuery),
    runQuery<SGAResult>(sgasQuery),
    runQuery<SGMResult>(sgmsQuery),
    runQuery<StageResult>(stagesQuery),
    runQuery<YearResult>(yearsQuery),
    runQuery<ExperimentationTagResult>(experimentationTagsQuery),
    runQuery<CampaignResult>(campaignsQuery),  // ADD THIS
  ]);
```

**Update the return object**: Add campaigns (after experimentationTags):
```typescript
    experimentationTags: experimentationTagsResult
      .map(r => r.experimentation_tag || '')
      .filter(Boolean),
    campaigns: campaignsResult
      .filter(r => r.id && r.name)
      .map(r => ({ value: r.id!, label: r.name! })),
  };
```

#### Step 3.2b: Update Filters API Route to Return Campaigns

**File**: `src/app/api/dashboard/filters/route.ts`

**Location**: Where `filterOptions` is built (around line 69). Add campaigns to the object and map to FilterOption shape if the route expects FilterOption[]:

**Add**:
```typescript
    const filterOptions: FilterOptions = {
      channels: rawOptions.channels,
      sources: rawOptions.sources,
      sgas: processedSgas,
      sgms: processedSgms,
      stages: rawOptions.stages,
      years: rawOptions.years,
      experimentationTags: rawOptions.experimentationTags,
      campaigns: (rawOptions.campaigns || []).map(c => ({
        value: c.value,
        label: c.label,
        isActive: true,
      })),  // ADD THIS
    };
```

### File: `src/lib/utils/filter-helpers.ts`

**Important**: The codebase uses `paramPrefix = 'adv'` (default). The function builds `safeFilters` by merging each key from `DEFAULT_ADVANCED_FILTERS` with `filters.*` (e.g. `channels: { ...DEFAULT_ADVANCED_FILTERS.channels, ...(filters.channels || {}) }`). Do **not** replace the whole function; add only the following.

#### Step 3.3: Update buildAdvancedFilterClauses Function

**Location 1**: In the `safeFilters` object (the merge with DEFAULT_ADVANCED_FILTERS), add a `campaigns` key after `experimentationTags`:
```typescript
    experimentationTags: {
      ...DEFAULT_ADVANCED_FILTERS.experimentationTags,
      ...(filters.experimentationTags || {}),
    },
    campaigns: {
      ...DEFAULT_ADVANCED_FILTERS.campaigns,
      ...(filters.campaigns || {}),
    },
  };
```

**Location 2**: After the Experimentation Tag filter block (the `if (!safeFilters.experimentationTags.selectAll && ...)` block that pushes the EXISTS clause and sets `params[paramPrefix + '_experimentation_tags']`), add:
```typescript
  // Campaign filter (multi-select) - same pattern as channels/sources
  if (!safeFilters.campaigns.selectAll && safeFilters.campaigns.selected.length > 0) {
    whereClauses.push(`v.Campaign_Id__c IN UNNEST(@${paramPrefix}_campaigns)`);
    params[`${paramPrefix}_campaigns`] = safeFilters.campaigns.selected;
  }
```
Note: The codebase uses `whereClauses` (plural) and `params`; the return is `{ whereClauses, params }`. Param prefix is typically `'adv'` when called from dashboard queries.

**Location 3 (optional)**: If the same file exports `hasActiveFilters(filters: AdvancedFilters)`, add `!filters.campaigns.selectAll` to its return expression so campaign selection is counted as an active advanced filter.

### File: `src/lib/queries/funnel-metrics.ts`

#### Step 3.4: Add Campaign Filter to getFunnelMetrics

**Location**: In WHERE conditions, after experimentation tag handling

**Add**:
```typescript
const getFunnelMetrics = async (
  filters: DashboardFilters,
  viewMode: ViewMode = 'focused',
  recruiterFilter?: string | null
): Promise<FunnelMetrics> => {
  // ... existing code ...

  // Build WHERE conditions
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  // ... existing date, channel, source, sga, sgm filters ...

  // Experimentation Tag
  if (filters.experimentationTag) {
    conditions.push(
      `EXISTS (SELECT 1 FROM UNNEST(v.Experimentation_Tag_List) as tag WHERE tag = @experimentationTag)`
    );
    params.experimentationTag = filters.experimentationTag;
  }

  // Campaign - ADD THIS BLOCK
  if (filters.campaignId) {
    conditions.push('v.Campaign_Id__c = @campaignId');
    params.campaignId = filters.campaignId;
  }

  // ... rest of function ...
};
```

### File: `src/lib/queries/conversion-rates.ts`

#### Step 3.5: Add Campaign Filter to Conversion Rate Queries

**Location**: In WHERE conditions for both `getConversionRates` and `getConversionTrends`

**Add after experimentation tag in BOTH functions**:
```typescript
// In getConversionRates:
if (filters.experimentationTag) {
  whereClauses.push(
    `EXISTS (SELECT 1 FROM UNNEST(v.Experimentation_Tag_List) as tag WHERE tag = @experimentationTag)`
  );
  params.experimentationTag = filters.experimentationTag;
}

// Campaign - ADD THIS BLOCK
if (filters.campaignId) {
  whereClauses.push('v.Campaign_Id__c = @campaignId');
  params.campaignId = filters.campaignId;
}

// In getConversionTrends (same addition):
if (filters.experimentationTag) {
  whereClauses.push(
    `EXISTS (SELECT 1 FROM UNNEST(v.Experimentation_Tag_List) as tag WHERE tag = @experimentationTag)`
  );
  params.experimentationTag = filters.experimentationTag;
}

// Campaign - ADD THIS BLOCK
if (filters.campaignId) {
  whereClauses.push('v.Campaign_Id__c = @campaignId');
  params.campaignId = filters.campaignId;
}
```

### File: `src/lib/queries/source-performance.ts`

#### Step 3.6: Add Campaign Filter to Source Performance

**Location**: In WHERE conditions for both `getChannelPerformance` and `getSourcePerformance`

**Add after experimentation tag**:
```typescript
// In getChannelPerformance:
if (filters.experimentationTag) {
  conditions.push(
    `EXISTS (SELECT 1 FROM UNNEST(v.Experimentation_Tag_List) as tag WHERE tag = @experimentationTag)`
  );
  params.experimentationTag = filters.experimentationTag;
}

// Campaign - ADD THIS BLOCK
if (filters.campaignId) {
  conditions.push('v.Campaign_Id__c = @campaignId');
  params.campaignId = filters.campaignId;
}

// In getSourcePerformance (same addition):
if (filters.experimentationTag) {
  conditions.push(
    `EXISTS (SELECT 1 FROM UNNEST(v.Experimentation_Tag_List) as tag WHERE tag = @experimentationTag)`
  );
  params.experimentationTag = filters.experimentationTag;
}

// Campaign - ADD THIS BLOCK
if (filters.campaignId) {
  conditions.push('v.Campaign_Id__c = @campaignId');
  params.campaignId = filters.campaignId;
}
```

### File: `src/lib/queries/detail-records.ts`

#### Step 3.7: Add Campaign to Detail Records SELECT and Filter

**Step 3.7a: Update SELECT clause**

**Location**: In the SELECT list

**Add campaign fields**:
```typescript
const query = `
  SELECT
    v.primary_key,
    v.Full_prospect_id__c,
    v.Full_Opportunity_ID__c,
    v.advisor_name,
    v.Original_source,
    v.Channel_Grouping_Name,
    v.SGA_Owner_Name__c,
    v.SGM_Owner_Name__c,
    v.Campaign_Id__c,        -- ADD THIS LINE
    v.Campaign_Name__c,      -- ADD THIS LINE
    v.FilterDate,
    v.CreatedDate,
    -- ... rest of SELECT ...
```

**Step 3.7b: Add campaign filter**

**Location**: In WHERE conditions (same pattern as experimentation tag).

**Add after experimentation tag**:
```typescript
if (filters.campaignId) {
  conditions.push('v.Campaign_Id__c = @campaignId');
  params.campaignId = filters.campaignId;
}
```
(Use the same variable names as in the file — e.g. `conditions`/`params` or `whereClauses`/`params`.)

**Step 3.7d: Map query result to DetailRecord**  
Wherever the raw detail-records query result is mapped to `DetailRecord` (e.g. in the same file or in the API route), include `campaignId: row.Campaign_Id__c ?? null` and `campaignName: row.Campaign_Name__c ?? null` (or the actual column names returned by BigQuery). Ensure the SELECT in Step 3.7a returns `v.Campaign_Id__c` and `v.Campaign_Name__c` so the mapping has values.

**Step 3.7c: Update DetailRecord type**

**Location**: `src/types/dashboard.ts` — `DetailRecord` interface (around line 118). Add two properties in the attribution area (e.g. after `sgm`).

**Add**:
```typescript
  sga: string | null;
  sgm: string | null;
  campaignId: string | null;      // ADD THIS LINE
  campaignName: string | null;    // ADD THIS LINE
  aum: number;
```

### File: `src/lib/queries/record-detail.ts`

#### Step 3.8: Add Campaign to Record Detail Query

**Step 3.8a: Update SELECT clause**

**Location**: In the SELECT list (around line 30)

**Add after `Experimentation_Tag_Raw__c`**:
```typescript
const query = `
  SELECT
    -- Identifiers
    v.primary_key,
    v.Full_prospect_id__c,
    v.Full_Opportunity_ID__c,
    v.advisor_name,
    v.record_type_name,
    
    -- Attribution
    v.Original_source,
    COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') as Channel_Grouping_Name,
    v.SGA_Owner_Name__c,
    v.SGM_Owner_Name__c,
    v.External_Agency__c,
    v.Next_Steps__c,
    v.NextStep,
    v.Lead_Score_Tier__c,
    v.Experimentation_Tag_Raw__c,
    v.Campaign_Id__c,        -- ADD THIS LINE
    v.Campaign_Name__c,      -- ADD THIS LINE
    
    -- ... rest of SELECT ...
`;
```

**Step 3.8b: Update transformToRecordDetail function**

**Location**: In the transform function

**Add after `experimentationTag`** in the returned object (use the same `toString`/null pattern as other attribution fields):
```typescript
    experimentationTag: r.Experimentation_Tag_Raw__c ? toString(r.Experimentation_Tag_Raw__c) : null,
    campaignId: r.Campaign_Id__c ? toString(r.Campaign_Id__c) : null,
    campaignName: r.Campaign_Name__c ? toString(r.Campaign_Name__c) : null,
```
The codebase uses `toString` from `@/types/bigquery-raw` for BigQuery values. Add `Campaign_Id__c` and `Campaign_Name__c` to the SELECT in the same query (Step 3.8a) and to `RecordDetailRaw` (Phase 2 Step 2.8).

### File: `src/lib/semantic-layer/definitions.ts`

#### Step 3.9: Add Campaign Dimension

**Location**: In DIMENSIONS object, after `experimentation_tag`

**Add**:
```typescript
export const DIMENSIONS = {
  // ... existing dimensions ...

  experimentation_tag: {
    name: 'Experimentation Tag',
    description: 'A/B test or experiment tags',
    field: 'v.Experimentation_Tag_Raw__c',
    arrayField: 'v.Experimentation_Tag_List',
    requiresJoin: false,
    filterable: true,
    groupable: false,
    filterSql: `EXISTS (
      SELECT 1 
      FROM UNNEST(v.Experimentation_Tag_List) as tag
      WHERE tag = @experimentationTag
    )`,
    aliases: ['experiment', 'test tag', 'ab test'],
  },

  // ADD THIS ENTIRE BLOCK:
  campaign: {
    name: 'Campaign',
    description: 'Salesforce Campaign (marketing campaign object)',
    field: 'v.Campaign_Id__c',
    rawField: 'Campaign_Id__c',
    requiresJoin: false,
    filterable: true,
    groupable: true,
    aliases: ['marketing campaign', 'sfdc campaign'],
  },

  // ... rest of dimensions ...
};
```

---

## ✅ PHASE 3 VALIDATION (after backend query changes)

**Execute these checks immediately after Phase 3. Do NOT proceed to Phase 4 until all pass.**

1. **TypeScript compilation (full project)**
   ```bash
   npx tsc --noEmit
   ```
   **Expected:** No errors.  
   **Common issues:** `filters.campaignId` not recognized (add to DashboardFilters); params type errors in query files.

2. **Linting**
   ```bash
   npm run lint
   ```
   **Expected:** No errors.

3. **Development server startup**
   ```bash
   npm run dev
   ```
   **Expected:** Server starts without crashes.  
   Watch console for import/syntax errors.

4. **Filter options API test** (with server running)  
   In browser: log in, open DevTools → Network, load dashboard; find request to `/api/dashboard/filters`.  
   Or with auth cookie:
   ```bash
   curl http://localhost:3000/api/dashboard/filters -H "Cookie: [your-auth-cookie]"
   ```
   **Expected response** must include:
   ```json
   {
     "campaigns": [
       {"value": "701VS00000YdiVVYAZ", "label": "Savvy Pirate", "isActive": true},
       ...
     ]
   }
   ```
   **Verify:** ~15 campaigns; Savvy Pirate present.  
   **If failed:** Check Step 3.1 (campaigns query) and Step 3.2b (filters route).

5. **Browser console check**
   - Open dashboard in browser.
   - Open DevTools → Console (F12).
   - Reload page.  
   **Expected:** No red errors (warnings OK).  
   **Common errors:** "campaigns of undefined" → FilterOptions or route not returning `campaigns`.

6. **Query file verification** (optional)  
   In one modified query file (e.g. funnel-metrics), temporarily log when campaign filter is applied:
   ```typescript
   if (filters.campaignId) {
     console.log('Campaign filter applied:', filters.campaignId);
   }
   ```
   Apply Savvy Pirate in UI and confirm log appears; remove log after validation.

✅ **DO NOT PROCEED TO PHASE 4** until all Phase 3 validations pass.

---

## Phase 4: Frontend UI Components

### File: `src/components/dashboard/GlobalFilters.tsx`

#### Step 4.1: Add Campaign Handler (No Local State)

**Important**: GlobalFilters receives `filters` and `onFiltersChange` from props; it does **not** hold filter state locally. Do **not** add `useState` for filters. Only add a handler that calls the parent.

**Add handler** (after `handleExperimentationTagChange`):
```typescript
const handleCampaignChange = (value: string) => {
  onFiltersChange({
    ...filters,
    campaignId: value === '' ? null : value,
  });
};
```
**Parent (dashboard page)** must include `campaignId: null` in default filters and pass `campaignId` in filters to GlobalFilters (see Step 4.0 below if needed).

#### Step 4.2: Add Campaign Dropdown to JSX

**Location**: After the Experimentation Tag dropdown block, before the closing `</div>` of the filters grid.

**Add** (only show when campaigns exist, same pattern as Experimentation Tag):
```typescript
        {/* Campaign */}
        {filterOptions.campaigns && filterOptions.campaigns.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
              Campaign
            </label>
            <select
              value={filters.campaignId || ''}
              onChange={(e) => handleCampaignChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
            >
              <option value="">All Campaigns</option>
              {filterOptions.campaigns.map((campaign) => (
                <option key={campaign.value} value={campaign.value}>
                  {campaign.label}
                </option>
              ))}
            </select>
          </div>
        )}
```
Use `filters.campaignId` (from props) and `filterOptions.campaigns` (value/label from API).

### File: `src/components/dashboard/AdvancedFilters.tsx`

#### Step 4.3: Add Campaign Search State and Filter Key Support

**Location**: After experimentation tag search state.

**Add**:
```typescript
const [campaignSearch, setCampaignSearch] = useState('');
```

**Update type unions**: In `handleMultiSelectChange` and `handleSelectAll`, the `filterKey` parameter type must include `'campaigns'`. Change:
- `filterKey: 'channels' | 'sources' | 'sgas' | 'sgms' | 'experimentationTags'`
to:
- `filterKey: 'channels' | 'sources' | 'sgas' | 'sgms' | 'experimentationTags' | 'campaigns'`
(in both function signatures).

#### Step 4.4: Add Filtered Campaigns (Search)

**Location**: After the `filteredExperimentationTags` useMemo.

**Add** (match pattern used for other searchable lists):
```typescript
const filteredCampaigns = useMemo(() => {
  if (!filterOptions?.campaigns) return [];
  return filterOptions.campaigns.filter(c =>
    c.label.toLowerCase().includes(campaignSearch.toLowerCase())
  );
}, [filterOptions, campaignSearch]);
```

#### Step 4.5: Add Campaign Multi-Select to JSX

**Location**: In the Attribution Filters section, after the Experimentation Tags `MultiSelectFilterControl`, before the closing `</div>` of that section.

**Add**:
```typescript
                {/* Campaigns */}
                <MultiSelectFilterControl
                  label="Campaigns"
                  options={filteredCampaigns.map(c => ({ value: c.value, label: c.label, isActive: true }))}
                  filter={localFilters.campaigns}
                  onSelectAll={() => handleSelectAll('campaigns')}
                  onChange={(value, checked) => handleMultiSelectChange('campaigns', value, checked)}
                  searchValue={campaignSearch}
                  onSearchChange={setCampaignSearch}
                  searchable
                />
```
Ensure `localFilters` is merged with defaults that include `campaigns: { selectAll: true, selected: [] }` (from DEFAULT_ADVANCED_FILTERS) so `localFilters.campaigns` exists.

### File: `src/components/dashboard/RecordDetailModal.tsx`

#### Step 4.6: Add Campaign Display to Modal

**Location**: `src/components/dashboard/RecordDetailModal.tsx` — in the Attribution section, after the existing `<DetailRow label="Experiment Tag" value={record.experimentationTag} />` line.

**Add one line** (DetailRow handles null/empty):
```typescript
                    <DetailRow label="Experiment Tag" value={record.experimentationTag} />
                    <DetailRow label="Campaign" value={record.campaignName} />
```
Ensure `RecordDetailFull` and the record-detail query/transform include `campaignName` (and optionally `campaignId`) as in Phase 2 and Step 3.8.

### File: `src/components/dashboard/DetailRecordsTable.tsx`

#### Step 4.7: Add Campaign Column to Detail Table

**Important**: The table does **not** use a generic `columns` array. It uses explicit `SortColumn` type, `SortableHeader`, and `TableCell` components. Add campaign in three places.

**1. Add `'campaign'` to the SortColumn type** (top of file):
```typescript
type SortColumn = 'advisor' | 'source' | 'channel' | 'stage' | 'date' | 'sga' | 'sgm' | 'aum' | 'campaign' | null;
```

**2. Add header and cell**: After the Channel column (or after Source), add:
- In `<TableHead>`: `<SortableHeader column="campaign">Campaign</SortableHeader>`
- In each `<TableRow>` (body): `<TableCell className="border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">{record.campaignName || '-'}</TableCell>`

**3. Add sort logic**: In `sortRecords` (and any switch that uses sortColumn), add:
```typescript
case 'campaign':
  comparison = (a.campaignName || '').toLowerCase().localeCompare((b.campaignName || '').toLowerCase());
  break;
```
Update the empty-state `colSpan` to include the new column (e.g. 9 → 10 if campaign is one column). Ensure `DetailRecord` includes `campaignName` (and optionally `campaignId`) as in Step 3.7c.

---

## ✅ PHASE 4 VALIDATION (after frontend UI changes)

**Execute these checks immediately after Phase 4. Phase 4 is complete when all UI elements render and function correctly.**

1. **TypeScript compilation**
   ```bash
   npx tsc --noEmit
   ```
   **Expected:** No errors.

2. **Linting**
   ```bash
   npm run lint
   ```
   **Expected:** No errors.

3. **Development server startup (clean)**
   ```bash
   npm run dev
   ```
   **Expected:** No errors, no warnings in build.

4. **UI rendering checks** (in browser)
   - **GlobalFilters**
     - [ ] Campaign dropdown appears
     - [ ] Shows "All Campaigns" default option
     - [ ] Lists ~15 campaigns
     - [ ] Dropdown is scrollable
     - [ ] No console errors when selecting campaign
   - **AdvancedFilters**
     - [ ] "Campaigns" multi-select appears in Attribution section (after "Experimentation Tags")
     - [ ] Search box works
     - [ ] "Select All" / "Deselect All" works
     - [ ] Selected campaigns show checkmarks
     - [ ] Active filter count updates when campaigns selected
   - **RecordDetailModal**
     - [ ] Campaign row appears in Attribution section
     - [ ] Only shows when record has campaign
     - [ ] Displays campaign name (not ID)
   - **DetailRecordsTable**
     - [ ] Campaign column appears
     - [ ] Column is sortable
     - [ ] Shows campaign names
     - [ ] Shows "-" for records without campaign

5. **Functional testing**
   - a. Select "Savvy Pirate" campaign in GlobalFilters.
   - b. Set date range: 1/1/2026 – 2/6/2026.
   - c. Click "Apply filters".
   - d. Verify: "Contacted" scorecard shows value > 0.
   - e. Click on Contacted scorecard.
   - f. Verify: Drill-down modal opens with records.
   - g. Verify: Campaign column shows "Savvy Pirate".
   - h. Verify: Record count matches expectation.

6. **Browser DevTools Network tab**
   - Check API requests include `campaignId` (or equivalent) when campaign is selected.
   - Verify no 400/500 errors.
   - Check response data is filtered correctly.

7. **Responsive/UI check**
   - [ ] Campaign dropdown doesn’t overflow on small viewports
   - [ ] Advanced filters modal displays correctly
   - [ ] Table scrolls horizontally if needed for campaign column

✅ **Phase 4 complete** when all UI elements render and function correctly.

---

## Phase 5: Testing & Validation

### ✅ PHASE 5 VALIDATION (comprehensive end-to-end testing)

Use these scenarios in addition to Steps 5.1–5.6 below.

1. **Critical path test — Savvy Pirate campaign**
   - Date range: 1/1/2026 – 2/6/2026.
   - Campaign: Savvy Pirate.
   - **Expected:** Contacted metric reflects 74 prospects.
   - Test drill-down shows correct records.
   - Test export includes campaign column.

2. **Multi-filter combination tests**
   - Campaign + Channel filter.
   - Campaign + Source filter.
   - Campaign + SGA filter.
   - Campaign + Date range.
   - Advanced filters: multiple campaigns selected.

3. **Edge case tests**
   - No campaign selected ("All Campaigns").
   - Campaign with 0 records in date range.
   - Campaign + other filters that return 0 results.

4. **Regression tests**
   - Experimentation tag filter still works independently.
   - Campaign and experimentation tag filters work together.
   - All existing saved reports still load.
   - Export works with and without campaign filter.

---

### Step 5.1: Deploy Updated View to BigQuery

```bash
# From your BigQuery console or deployment script:
# 1. Copy the updated vw_funnel_master.sql content
# 2. Run as CREATE OR REPLACE VIEW
# 3. Verify no syntax errors
# 4. Confirm view creation successful
```

**Validation Query**:
```sql
-- Verify campaign fields exist
SELECT 
  Campaign_Id__c,
  Campaign_Name__c,
  Lead_Campaign_Id__c,
  Opp_Campaign_Id__c
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE Campaign_Id__c IS NOT NULL
LIMIT 10;
```

### Step 5.2: Validate Savvy Pirate Campaign Data

**Run this query to confirm 74 records**:
```sql
SELECT COUNT(*) as contacted_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE v.Campaign_Id__c = '701VS00000YdiVVYAZ'
  AND v.stage_entered_contacting__c IS NOT NULL
  AND DATE(v.stage_entered_contacting__c) >= DATE('2026-01-01')
  AND DATE(v.stage_entered_contacting__c) <= DATE('2026-02-06');
```

**Expected result**: `contacted_count = 74`

### Step 5.3: Test Campaign Filter Options API

**Endpoint**: Filter options are returned by **`GET /api/dashboard/filters`** (not `/api/dashboard/filter-options`). You must be authenticated (session cookie or auth header).

```bash
# Start your dev server
npm run dev

# Test the filters endpoint (requires auth - use browser DevTools Network tab or a logged-in session)
# In browser: open dashboard, check Network tab for request to /api/dashboard/filters
```

**Verify response includes**:
```json
{
  "channels": [...],
  "sources": [...],
  "sgas": [...],
  "sgms": [...],
  "stages": [...],
  "years": [...],
  "experimentationTags": [...],
  "campaigns": [
    { "value": "701VS00000YdiVVYAZ", "label": "Savvy Pirate", "isActive": true },
    ...
  ]
}
```
(Approx. 15 campaigns when view is deployed and campaigns query runs.)

### Step 5.4: UI Testing Checklist

**GlobalFilters**:
- [ ] Campaign dropdown appears when campaigns exist
- [ ] Dropdown shows 15 campaigns
- [ ] Selecting a campaign updates filters
- [ ] "All Campaigns" option works
- [ ] Changing campaign triggers "Apply filters" button

**AdvancedFilters**:
- [ ] "Campaigns" multi-select appears in Attribution Filters
- [ ] Search functionality works
- [ ] Select All / Deselect All works
- [ ] Selected campaigns are highlighted
- [ ] Active filter count updates

**Dashboard Functionality**:
- [ ] Filtering by Savvy Pirate campaign shows correct data
- [ ] Scorecards update based on campaign filter
- [ ] Conversion rates update based on campaign filter
- [ ] Channel/Source tables respect campaign filter
- [ ] Detail records table shows campaign column
- [ ] Detail records respect campaign filter

**Record Detail Modal**:
- [ ] Campaign field appears in Attribution section
- [ ] Campaign name displays correctly
- [ ] Campaign field only shows when present

### Step 5.5: Integration Testing

**Test Case 1: Savvy Pirate Campaign Filter**
1. Open dashboard
2. Select date range: 1/1/2026 - 2/6/2026
3. Select Campaign: "Savvy Pirate"
4. Click "Apply filters"
5. Verify "Contacted" scorecard shows some value
6. Click on the Contacted scorecard value
7. Verify drill-down shows records
8. Verify campaign column shows "Savvy Pirate"

**Test Case 2: Campaign + Channel Filter**
1. Select Campaign: "Savvy Pirate"
2. Select Channel: "Paid Search" (or any channel with data)
3. Click "Apply filters"
4. Verify metrics update
5. Verify both filters are applied (check detail records)

**Test Case 3: Advanced Filters - Multiple Campaigns**
1. Click "Advanced Filters"
2. Under "Campaigns", deselect "Select All"
3. Select 2-3 specific campaigns
4. Click "Apply"
5. Verify metrics reflect only those campaigns
6. Check detail records show only selected campaigns

**Test Case 4: Export with Campaign**
1. Apply Savvy Pirate campaign filter
2. Click drill-down on any metric
3. Export to CSV
4. Verify CSV includes campaign name column
5. Verify only Savvy Pirate records in export

### Step 5.6: Regression Testing

**Verify existing functionality still works**:
- [ ] Dashboard loads without campaign filter
- [ ] Experimentation Tag filter still works
- [ ] Channel/Source filters still work
- [ ] SGA/SGM filters still work
- [ ] Date range filters still work
- [ ] All scorecards calculate correctly
- [ ] Conversion rates calculate correctly
- [ ] Export functionality works
- [ ] Saved reports load correctly

---

## Phase 6: Deployment

### Step 6.1: Pre-Deployment Checklist

- [ ] All tests passing
- [ ] 74 Savvy Pirate validation confirmed
- [ ] Code reviewed
- [ ] TypeScript compilation successful
- [ ] No console errors in browser
- [ ] Database view deployed to production
- [ ] Cache invalidation plan ready

### Step 6.2: Deployment Steps

```bash
# 1. Merge feature branch
git checkout main
git merge feature/campaign-filtering

# 2. Deploy BigQuery view (if not done)
# Run vw_funnel_master.sql in BigQuery console

# 3. Deploy application
npm run build
# Deploy to your hosting platform

# 4. Invalidate cache
# Run cache invalidation for dashboard data
```

### Step 6.3: Post-Deployment Validation

**Immediately after deployment**:
1. [ ] Load dashboard in production
2. [ ] Verify campaign dropdown appears
3. [ ] Verify 15 campaigns in dropdown
4. [ ] Apply Savvy Pirate filter
5. [ ] Verify data loads correctly
6. [ ] Check browser console for errors
7. [ ] Test on mobile/tablet
8. [ ] Verify exports work

### Step 6.4: Monitoring

**Watch for**:
- BigQuery query errors
- API endpoint timeouts
- UI rendering issues
- Filter application failures
- Export failures

---

## Rollback Procedure

### If Issues Occur

**Level 1: Feature Flag (Recommended)**

If you implemented a feature flag:
```typescript
// In config or environment
const ENABLE_CAMPAIGN_FILTER = false;  // Turn off

// In GlobalFilters.tsx and AdvancedFilters.tsx
{ENABLE_CAMPAIGN_FILTER && filterOptions.campaigns && (
  // Campaign dropdown
)}

// In query files
if (ENABLE_CAMPAIGN_FILTER && filters.campaignId) {
  // Campaign filter
}
```

**Level 2: Full Rollback**

1. **Revert Application Code**:
```bash
git revert <campaign-feature-commit>
git push origin main
# Redeploy application
```

2. **Revert Database View**:
```sql
-- Deploy previous version of vw_funnel_master.sql
-- This removes Campaign_Id__c, Campaign_Name__c, etc.
```

3. **Invalidate Cache**:
```bash
# Clear all dashboard caches
# Restart application servers if needed
```

4. **Verify Rollback**:
- [ ] Dashboard loads
- [ ] No campaign filter visible
- [ ] All other filters work
- [ ] No console errors
- [ ] Exports work

### Rollback Testing Checklist

After rollback:
- [ ] Dashboard loads successfully
- [ ] Experimentation tag filter still works
- [ ] All scorecards calculate correctly
- [ ] Detail records load
- [ ] Exports work
- [ ] No JavaScript errors in console
- [ ] No BigQuery errors in logs

---

## Summary Checklist

### Database
- [ ] vw_funnel_master.sql updated with campaign fields
- [ ] View deployed to BigQuery production
- [ ] 74 Savvy Pirate records validated

### Backend
- [ ] filter-options.ts: getCampaigns() added
- [ ] filter-helpers.ts: campaign advanced filter added
- [ ] funnel-metrics.ts: campaign filter added
- [ ] conversion-rates.ts: campaign filter added
- [ ] source-performance.ts: campaign filter added
- [ ] detail-records.ts: campaign SELECT and filter added
- [ ] record-detail.ts: campaign SELECT and transform added
- [ ] semantic-layer/definitions.ts: campaign dimension added

### Types
- [ ] filters.ts: DashboardFilters.campaignId added
- [ ] filters.ts: AdvancedFilters.campaigns added
- [ ] filters.ts: DEFAULT_ADVANCED_FILTERS.campaigns added
- [ ] filters.ts: FilterOptions.campaigns added
- [ ] filters.ts: hasActiveAdvancedFilters updated
- [ ] filters.ts: countActiveAdvancedFilters updated
- [ ] record-detail.ts: campaignId and campaignName added
- [ ] dashboard.ts: DetailRecord campaign fields added

### Frontend
- [ ] GlobalFilters.tsx: campaign dropdown added
- [ ] AdvancedFilters.tsx: campaigns multi-select added
- [ ] RecordDetailModal.tsx: campaign display added
- [ ] DetailRecordsTable.tsx: campaign column added

### Testing
- [ ] Filter options API returns campaigns
- [ ] Campaign filter affects all queries
- [ ] Savvy Pirate campaign shows 74 contacted
- [ ] Export includes campaign
- [ ] Regression tests pass

### Documentation
- [ ] ARCHITECTURE.md updated with campaign filter
- [ ] This implementation guide completed
- [ ] Rollback procedure documented

---

## Notes

**Campaign vs Experimentation Tag**:
- Both will coexist - they serve different purposes
- Campaign: Proper Salesforce Campaign object (4.3% of leads)
- Experimentation Tag: Ad-hoc experiment labels (30k+ leads, no overlap with campaigns)
- Keep both filters available

**Data Inheritance**:
- Campaign_Id__c = COALESCE(Opportunity.CampaignId, Lead.Campaign__c)
- Prefers opportunity-level campaign when both exist
- Only 1 record has both (and they match), so logic is safe

**Performance**:
- 15 campaigns returned by filter options query
- Campaign_Id__c is a simple string field (no array/UNNEST needed)
- Standard IN clause filtering (efficient)

**Future Enhancements**:
- Add campaign type/status to filter options
- Add campaign date range to filter options
- Group by campaign in Explore
- Campaign performance table (similar to source/channel)
