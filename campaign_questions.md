# Campaign Filtering Implementation - Data Exploration Questions

**Purpose**: Explore BigQuery data and codebase to understand how to transition from `experimentation_tag__c` to Campaign-based filtering in the funnel performance dashboard

**For**: Cursor.ai with MCP connection to BigQuery  
**Instructions**: Answer each question directly within this document, preserving the question text and adding your answer below it. Use BigQuery queries via MCP and codebase exploration to provide comprehensive answers.

**Context**:
- We're transitioning from `experimentation_tag__c` to using the Campaign object for marketing experiments
- Lead object has: `Campaign__c` field
- Opportunity object has: `CampaignId` field  
- Campaign object exists in BigQuery: `savvy-gtm-analytics.SavvyGTMData.Campaign`
- Example campaign "Savvy Pirate" with ID: `701VS00000YdiVVYAZ`
- Known validation: 74 prospects should have `stage_entered_contacting__c` NOT NULL between 1/1/2026 to 2/6/2026 for Savvy Pirate campaign

---

## PHASE 1: Understand Current Experimentation Tag Implementation

### Q1.1: How is experimentation_tag currently stored and used in vw_funnel_master?

**Query the view definition to understand**:
```sql
-- Get the CREATE VIEW statement or describe the experimentation tag columns
SELECT column_name, data_type, description
FROM `savvy-gtm-analytics.Tableau_Views.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name = 'vw_funnel_master'
  AND column_name LIKE '%xperimentation%'
ORDER BY ordinal_position;
```

**Answer below**:
- **Column in vw_funnel_master**: `Experimentation_Tag_List` only (INFORMATION_SCHEMA returns no column named `*xperimentation*` other than this).
- **Type**: `ARRAY<STRING>`.
- **How derived**: The view does not expose a column literally named `Experimentation_Tag_Raw__c` in the Tableau_Views schema output, but the view definition shows:
  - **Lead_Base**: `Experimentation_Tag__c AS Lead_Experimentation_Tag__c` (Lead object).
  - **Opp_Base**: `Experimentation_Tag__c AS Opportunity_Experimentation_Tag__c` (Opportunity object).
  - **Combined**: `COALESCE(o.Opportunity_Experimentation_Tag__c, l.Lead_Experimentation_Tag__c) AS Experimentation_Tag_Raw__c`.
  - **Final**: `Experimentation_Tag_List` is built as `ARRAY(SELECT DISTINCT TRIM(tag) FROM UNNEST(SPLIT(IFNULL(Experimentation_Tag_Raw__c, ''), ';')) AS tag WHERE TRIM(tag) != '')`. So the raw value is a semicolon-separated string; the view turns it into an array for filtering/UNNEST.




### Q1.2: What are all the distinct experimentation tags currently in use?

```sql
-- Get all unique experimentation tags
SELECT DISTINCT tag, COUNT(*) as record_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`,
  UNNEST(Experimentation_Tag_List) as tag
GROUP BY tag
ORDER BY record_count DESC;
```

**Answer below**:
- **Distinct experimentation tags in use**: 1.
- **Tag**: `2025-05 Futureproof Denver` — **record_count**: 13.
- So currently only one experimentation tag is present in the data, with 13 records in vw_funnel_master that have that tag in `Experimentation_Tag_List`.




### Q1.3: How is the experimentation tag filter implemented in the dashboard code?

**Files to examine**:
- `src/components/dashboard/GlobalFilters.tsx` (search for "experimentation")
- `src/components/dashboard/AdvancedFilters.tsx` (search for "experimentation")
- `src/lib/semantic-layer/definitions.ts` (search for "experimentation_tag")
- `src/lib/semantic-layer/query-compiler.ts` (search for "experimentation")

**Answer below**:
- **GlobalFilters.tsx**: Single-select dropdown "Experimentation Tag". Options come from `filterOptions.experimentationTags`. On change, `handleExperimentationTagChange` sets `filters.experimentationTag` to the selected value or `null` ("All Tags"). The dropdown is only rendered when `filterOptions.experimentationTags?.length > 0`. Filter state is a single string (`experimentationTag: string | null`).
- **AdvancedFilters.tsx**: Multi-select under "Attribution Filters" with label "Experimentation Tags". Uses `MultiSelectFilterControl` with `filterKey: 'experimentationTags'`, search state `experimentationTagSearch`, and `localFilters.experimentationTags` (selectAll + selected[]). Apply sends `advancedFilters.experimentationTags` to parent.
- **SQL generation**: 
  - **filter-helpers.ts**: When advanced filter has selected tags, adds `EXISTS (SELECT 1 FROM UNNEST(v.Experimentation_Tag_List) as tag WHERE tag IN UNNEST(@param_experimentation_tags))` and passes array param.
  - **Query files** (funnel-metrics, conversion-rates, source-performance, detail-records): When `filters.experimentationTag` is set, add a subquery: `EXISTS (SELECT 1 FROM UNNEST(v.Experimentation_Tag_List) as tag WHERE tag = @experimentationTag)` and `params.experimentationTag = filters.experimentationTag`.
- **Semantic layer**: `definitions.ts` has dimension `experimentation_tag` with `field: 'v.Experimentation_Tag_Raw__c'`, `arrayField: 'v.Experimentation_Tag_List'`, and `filterSql` using `EXISTS (... UNNEST(v.Experimentation_Tag_List) ... tag = @experimentationTag)`. **query-compiler.ts** `buildDimensionFilterSql` has special handling for `experimentation_tag`: for `in`/`equals` with value `*` it uses `ARRAY_LENGTH(v.Experimentation_Tag_List) > 0`; otherwise it uses `EXISTS (SELECT 1 FROM UNNEST(v.Experimentation_Tag_List) as tag WHERE UPPER(tag) LIKE ...)` for fuzzy match. For `not_in`/`not_equals` it uses the inverse (empty array or NOT EXISTS with LIKE).




---

## PHASE 2: Understand Campaign Object Structure in BigQuery

### Q2.1: What is the schema of the Campaign table?

```sql
-- Get Campaign table schema
SELECT column_name, data_type, is_nullable
FROM `savvy-gtm-analytics.SavvyGTMData.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name = 'Campaign'
ORDER BY ordinal_position;
```

**Answer below**:
Campaign table schema (key fields from `SavvyGTMData.Campaign`): **Id** (STRING), **Name** (STRING), **Type** (STRING), **Status** (STRING), **IsActive** (BOOLEAN), **StartDate** (DATE), **EndDate** (DATE), **CreatedDate** (TIMESTAMP), **LastModifiedDate** (TIMESTAMP), **OwnerId**, **CreatedById**, **ParentId**, **NumberOfLeads**, **NumberOfConvertedLeads**, **NumberOfOpportunities**, **NumberOfWonOpportunities**, **AmountAllOpportunities**, **AmountWonOpportunities**, **Campaign_UTM__c** (STRING), **Distribution_Group__c**, **Automated_Distribution__c** (BOOLEAN), plus standard Salesforce fields (Description, BudgetedCost, ActualCost, etc.).




### Q2.2: What campaigns are currently active and what are their attributes?

```sql
-- Get active campaigns with relevant metadata
SELECT 
  Id,
  Name,
  Type,
  Status,
  IsActive,
  StartDate,
  EndDate,
  CreatedDate,
  LastModifiedDate
FROM `savvy-gtm-analytics.SavvyGTMData.Campaign`
WHERE IsActive = TRUE
ORDER BY CreatedDate DESC
LIMIT 20;
```

**Answer below**:
Query returned **one** active campaign in the result set: **FPA Conference Dec 2025** (Id `701VS00000XR4MHYA1`, Type `Event`, Status `In Progress`, StartDate 2025-11-07, CreatedDate 2025-11-12). The table has 29 rows total; the query limited to `IsActive = TRUE` and `ORDER BY CreatedDate DESC LIMIT 20`, so only one row was returned—suggesting either few active campaigns or that Savvy Pirate may have different IsActive/ordering. Savvy Pirate (see Q2.3) is also active and has Type `Event`, Campaign_UTM__c `savvy_pirate_v1`, NumberOfLeads 633.




### Q2.3: Verify the Savvy Pirate campaign exists with the correct ID

```sql
-- Find Savvy Pirate campaign
SELECT *
FROM `savvy-gtm-analytics.SavvyGTMData.Campaign`
WHERE Id = '701VS00000YdiVVYAZ'
  OR Name LIKE '%Pirate%';
```

**Answer below**:
**Savvy Pirate** exists with Id `701VS00000YdiVVYAZ`. Details: Name `Savvy Pirate`, Type `Event`, Status `In Progress`, IsActive `true`, StartDate `2025-12-03`, EndDate `null`, CreatedDate `2025-12-03T22:05:26Z`, LastModifiedDate `2026-01-02T16:20:31Z`, Campaign_UTM__c `savvy_pirate_v1`, Automated_Distribution__c `true`, NumberOfLeads `633`, NumberOfOpportunities `0`. Confirmed.




---

## PHASE 3: Understand Campaign-Lead-Opportunity Relationships

### Q3.1: How many Leads have Campaign__c populated?

```sql
-- Count leads with campaigns
SELECT 
  COUNT(*) as total_leads,
  COUNT(Campaign__c) as leads_with_campaign,
  ROUND(COUNT(Campaign__c) / COUNT(*) * 100, 2) as pct_with_campaign
FROM `savvy-gtm-analytics.SavvyGTMData.Lead`;
```

**Answer below**:
- **total_leads**: 98,553  
- **leads_with_campaign**: 4,251  
- **pct_with_campaign**: 4.31%  
So about 4.3% of leads have `Campaign__c` populated.




### Q3.2: Sample Lead-Campaign associations

```sql
-- Sample leads with campaigns
SELECT 
  l.Id as lead_id,
  l.Name as lead_name,
  l.Campaign__c,
  c.Name as campaign_name,
  c.Type as campaign_type,
  l.CreatedDate,
  l.stage_entered_contacting__c
FROM `savvy-gtm-analytics.SavvyGTMData.Lead` l
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.Campaign` c
  ON l.Campaign__c = c.Id
WHERE l.Campaign__c IS NOT NULL
ORDER BY l.CreatedDate DESC
LIMIT 10;
```

**Answer below**:
Sample (one row returned in the 10-row query): lead_id `00QVS00000SCaCT2A1`, lead_name `Will Nolan`, Campaign__c `701Dn000001FsInIAK`, campaign_name `Widgets Webinar (Sample)`, campaign_type `Other`, stage_entered_contacting__c populated, CreatedDate 2026-02-04. So leads are associated by `Lead.Campaign__c = Campaign.Id`; multiple campaigns exist (e.g. Widgets Webinar, Savvy Pirate) and the join is straightforward.




### Q3.3: How many Opportunities have CampaignId populated?

```sql
-- Count opportunities with campaigns
SELECT 
  COUNT(*) as total_opps,
  COUNT(CampaignId) as opps_with_campaign,
  ROUND(COUNT(CampaignId) / COUNT(*) * 100, 2) as pct_with_campaign
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`;
```

**Answer below**:
- **total_opps**: 2,800  
- **opps_with_campaign**: 33  
- **pct_with_campaign**: 1.18%  
So about 1.2% of opportunities have `CampaignId` populated.




### Q3.4: Sample Opportunity-Campaign associations

```sql
-- Sample opportunities with campaigns
SELECT 
  o.Id as opp_id,
  o.Name as opp_name,
  o.CampaignId,
  c.Name as campaign_name,
  c.Type as campaign_type,
  o.CreatedDate,
  o.Date_Became_SQO__c,
  o.StageName
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.Campaign` c
  ON o.CampaignId = c.Id
WHERE o.CampaignId IS NOT NULL
ORDER BY o.CreatedDate DESC
LIMIT 10;
```

**Answer below**:
Sample (one row in the 10-row query): opp_id `006VS00000W11MFYAZ`, opp_name `Glenn Cackovic`, CampaignId `701VS00000ZtS4NYAV`, campaign_name `Scored List January 2026`, campaign_type `List Upload`, Date_Became_SQO__c and StageName populated. Opportunities are linked by `Opportunity.CampaignId = Campaign.Id`. Population rate is low (1.18%) compared to leads (4.31%).




---

## PHASE 4: Verify Savvy Pirate Campaign Data (CRITICAL VALIDATION)

### Q4.1: Count prospects with Savvy Pirate campaign who were contacted between 1/1/2026 - 2/6/2026

**This should return 74 records to validate we have the right logic**

```sql
-- CRITICAL VALIDATION QUERY
-- Should return 74 records per user specification
SELECT COUNT(*) as contacted_count
FROM `savvy-gtm-analytics.SavvyGTMData.Lead` l
WHERE l.Campaign__c = '701VS00000YdiVVYAZ'  -- Savvy Pirate campaign ID
  AND l.stage_entered_contacting__c IS NOT NULL
  AND DATE(l.stage_entered_contacting__c) >= DATE('2026-01-01')
  AND DATE(l.stage_entered_contacting__c) <= DATE('2026-02-06');
```

**Answer below**:
**Yes.** The query returns **contacted_count = 74**. Validation passes: 74 prospects have Savvy Pirate campaign (`Campaign__c = '701VS00000YdiVVYAZ'`) and `stage_entered_contacting__c` in 2026-01-01 to 2026-02-06.




### Q4.2: Get details of these 74 prospects

```sql
-- Get details to understand the data
SELECT 
  l.Id,
  l.Name,
  l.Campaign__c,
  c.Name as campaign_name,
  l.stage_entered_contacting__c,
  l.CreatedDate,
  l.IsConverted,
  l.ConvertedOpportunityId
FROM `savvy-gtm-analytics.SavvyGTMData.Lead` l
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.Campaign` c
  ON l.Campaign__c = c.Id
WHERE l.Campaign__c = '701VS00000YdiVVYAZ'
  AND l.stage_entered_contacting__c IS NOT NULL
  AND DATE(l.stage_entered_contacting__c) >= DATE('2026-01-01')
  AND DATE(l.stage_entered_contacting__c) <= DATE('2026-02-06')
ORDER BY l.stage_entered_contacting__c DESC
LIMIT 20;
```

**Answer below**:
Sample (first of 20): Id `00QVS00000RI8sP2AT`, Name `Joshua Martin`, Campaign__c `701VS00000YdiVVYAZ`, campaign_name `Savvy Pirate`, stage_entered_contacting__c `2026-01-15T22:19:46Z`, CreatedDate 2026-01-06, IsConverted `false`, ConvertedOpportunityId `null`. Pattern: these 74 are contacted Savvy Pirate leads in the date range; many are not yet converted (IsConverted false, ConvertedOpportunityId null).




### Q4.3: Check if these leads converted to opportunities with campaigns

```sql
-- Check conversion and campaign inheritance
SELECT 
  l.Id as lead_id,
  l.Name as lead_name,
  l.Campaign__c as lead_campaign_id,
  lc.Name as lead_campaign_name,
  l.IsConverted,
  o.Id as opp_id,
  o.CampaignId as opp_campaign_id,
  oc.Name as opp_campaign_name,
  CASE 
    WHEN l.Campaign__c = o.CampaignId THEN 'Match'
    WHEN l.Campaign__c IS NOT NULL AND o.CampaignId IS NULL THEN 'Lead has campaign, Opp missing'
    WHEN l.Campaign__c IS NULL AND o.CampaignId IS NOT NULL THEN 'Opp has campaign, Lead missing'
    ELSE 'Mismatch'
  END as campaign_alignment
FROM `savvy-gtm-analytics.SavvyGTMData.Lead` l
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.Campaign` lc
  ON l.Campaign__c = lc.Id
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
  ON l.ConvertedOpportunityId = o.Id
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.Campaign` oc
  ON o.CampaignId = oc.Id
WHERE l.Campaign__c = '701VS00000YdiVVYAZ'
  AND l.stage_entered_contacting__c IS NOT NULL
  AND DATE(l.stage_entered_contacting__c) >= DATE('2026-01-01')
  AND DATE(l.stage_entered_contacting__c) <= DATE('2026-02-06')
  AND l.IsConverted = TRUE
LIMIT 20;
```

**Answer below**:
The query for **converted** Savvy Pirate leads in that cohort (IsConverted = TRUE) returned **0 rows**. So among the 74 contacted Savvy Pirate prospects in 2026-01-01 to 2026-02-06, none have converted yet. We cannot observe lead→opp campaign alignment for this cohort. In general: Lead has `Campaign__c`, Opportunity has `CampaignId`; they are set independently (e.g. at conversion Salesforce may or may not copy campaign). For campaign filtering we should support both lead-level (Campaign__c) and opp-level (CampaignId) and coalesce in the view for a single “campaign” dimension.




---

## PHASE 5: Understand vw_funnel_master Campaign Integration

### Q5.1: Does vw_funnel_master currently include Campaign fields?

**Check the view definition** (file: `views/vw_funnel_master.sql`)

```sql
-- Query to see if campaign fields exist in vw_funnel_master
SELECT column_name, data_type
FROM `savvy-gtm-analytics.Tableau_Views.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name = 'vw_funnel_master'
  AND LOWER(column_name) LIKE '%campaign%'
ORDER BY ordinal_position;
```

**Answer below**:
**No campaign-related columns** in vw_funnel_master. The query `column_name LIKE '%campaign%'` on Tableau_Views.vw_funnel_master returned **0 rows**. The view definition (`views/vw_funnel_master.sql`) does **not** join Campaign and does not select Lead.Campaign__c or Opportunity.CampaignId. There is a TODO in Lead_Base (line 23): "Talk to Kenji on how we get campaigns in here (if we want) or if we should bring in UTM Parameters".




### Q5.2: Review the vw_funnel_master.sql view definition

**Examine**: `views/vw_funnel_master.sql`

**Questions to answer**:
1. How does it currently handle Lead.Campaign__c?
2. How does it currently handle Opportunity.CampaignId?
3. Is there any campaign coalescing logic (similar to experimentation tag)?
4. What would need to be added to support campaign filtering?

**Answer below**:
1. **Lead.Campaign__c**: Not used. Lead_Base selects from `SavvyGTMData.Lead` but does not include Campaign__c.  
2. **Opportunity.CampaignId**: Not used. Opp_Base selects from Opportunity and does not include CampaignId.  
3. **Campaign coalescing**: There is no campaign coalescing. Experimentation tag is coalesced as `COALESCE(o.Opportunity_Experimentation_Tag__c, l.Lead_Experimentation_Tag__c) AS Experimentation_Tag_Raw__c` and then turned into `Experimentation_Tag_List` (split by `;`). No analogous logic exists for Campaign.  
4. **To support campaign filtering**: Add to Lead_Base: `Campaign__c AS Lead_Campaign_Id__c` (or similar). Add to Opp_Base: `CampaignId AS Opp_Campaign_Id__c`. In Combined (or Final), add coalesced campaign id and optionally join Campaign to get Name for display, e.g. `COALESCE(o.Opp_Campaign_Id__c, l.Lead_Campaign_Id__c) AS Campaign_Id__c`, and optionally a `Campaign_Name__c` from a join to Campaign.




---

## PHASE 6: Design Campaign Field Strategy for vw_funnel_master

### Q6.1: Propose campaign field additions to vw_funnel_master

Based on Phase 5 findings, design what fields should be added to support campaign filtering similar to how experimentation tags work.

**Consider**:
- Should we add `Lead_Campaign_Id__c` and `Opp_Campaign_Id__c` separately?
- Should we create a coalesced `Campaign_Id__c` (like we do with experimentation tags)?
- Should we add `Campaign_Name__c` for display purposes?
- Should we create a `Campaign_List` array (for multi-campaign scenarios)?

**Answer below**:
- **Add separate IDs**: In Lead_Base add `Campaign__c AS Lead_Campaign_Id__c`. In Opp_Base add `CampaignId AS Opp_Campaign_Id__c`. Expose both so we can filter/group by lead vs opp campaign when needed.  
- **Add coalesced ID**: In Combined (or Final), add `COALESCE(o.Opp_Campaign_Id__c, l.Lead_Campaign_Id__c) AS Campaign_Id__c` so one field drives “this record’s campaign” (mirroring experimentation tag).  
- **Add Campaign name for display**: Join Campaign once (e.g. on the coalesced id) and add `Campaign_Name__c` (e.g. `c.Name AS Campaign_Name__c`) for UI labels.  
- **Campaign_List array**: Only if we need multi-campaign per row (e.g. multiple campaigns per lead). Current design is one campaign per lead/opp, so a single `Campaign_Id__c` and `Campaign_Name__c` is enough; no `Campaign_List` required unless product asks for it.  
- **Summary**: Add `Lead_Campaign_Id__c`, `Opp_Campaign_Id__c`, `Campaign_Id__c` (coalesced), and `Campaign_Name__c` (from join to Campaign). No array unless we later support multi-campaign.




### Q6.2: Write the SQL to add campaign fields to vw_funnel_master

**Provide the actual SQL modifications needed**:

```sql
-- Example structure - update based on your design from Q6.1

-- In Lead_Base CTE:
-- Add: ??? AS Lead_Campaign_Id__c,

-- In Opp_Base CTE:
-- Add: ??? AS Opp_Campaign_Id__c,

-- In Combined or later CTE:
-- Add coalesced field(s):
-- COALESCE(???, ???) AS Campaign_Id__c,

-- Possibly add Campaign name join and array:
-- ...
```

**Answer below**:
- **Lead_Base CTE**: In the SELECT add: `Campaign__c AS Lead_Campaign_Id__c,` (after Lead_External_Agency__c or similar).  
- **Opp_Base CTE**: In the SELECT add: `CampaignId AS Opp_Campaign_Id__c,` (e.g. after Opp_External_Agency__c).  
- **Combined CTE**: Add: `l.Lead_Campaign_Id__c AS Lead_Campaign_Id__c`, `o.Opp_Campaign_Id__c AS Opp_Campaign_Id__c`, and `COALESCE(o.Opp_Campaign_Id__c, l.Lead_Campaign_Id__c) AS Campaign_Id__c`.  
- **Join Campaign for name**: Either in Combined or in a later CTE, add: `LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.Campaign\` camp ON COALESCE(o.Opp_Campaign_Id__c, l.Lead_Campaign_Id__c) = camp.Id` and in the SELECT: `camp.Name AS Campaign_Name__c`.  
- **Final CTE**: Ensure `Campaign_Id__c` and `Campaign_Name__c` (and optionally `Lead_Campaign_Id__c`, `Opp_Campaign_Id__c`) are passed through. No UNNEST/array needed for single-campaign design.




---

## PHASE 7: Understand Filter Options API

### Q7.1: How does the filter options API work for experimentation tags?

**Files to examine**:
- `src/app/api/dashboard/filter-options/route.ts`
- `src/lib/queries/filter-options.ts`

**Questions**:
1. How does it query distinct experimentation tags?
2. What's the return format?
3. How does it handle caching?

**Answer below**:
1. **How distinct experimentation tags are queried**: In `src/lib/queries/filter-options.ts`, `_getRawFilterOptions` runs an experimentation tags query: `SELECT DISTINCT tag as experimentation_tag FROM \`${FULL_TABLE}\` v, UNNEST(v.Experimentation_Tag_List) as tag WHERE tag IS NOT NULL AND TRIM(tag) != '' AND v.FilterDate >= TIMESTAMP(DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR)) ORDER BY experimentation_tag`. So it UNNESTs the array and restricts to last 2 years of FilterDate.  
2. **Return format**: Raw results are `ExperimentationTagResult[]` (field `experimentation_tag`); the function returns `experimentationTags: string[]` (mapped and filtered). The API route `src/app/api/dashboard/filters/route.ts` calls `getRawFilterOptions()` and returns `filterOptions.experimentationTags` in the JSON.  
3. **Caching**: `getRawFilterOptions` is wrapped with `cachedQuery(..., 'getRawFilterOptions', CACHE_TAGS.DASHBOARD, FILTERS_TTL)` where FILTERS_TTL is 3600 (1 hour). So filter options (including experimentation tags) are cached for 1 hour and invalidated with the DASHBOARD cache tag (e.g. admin refresh).




### Q7.2: Design the campaign filter options query

Based on Q7.1, write the SQL query to fetch distinct campaigns for filter options.

**Consider**:
- Should we only show active campaigns?
- Should we filter by date range (campaigns with data in last X months)?
- What fields do we need (Id, Name, Type, Status)?
- Should we order by most recently used?

```sql
-- Design your query here
SELECT DISTINCT
  -- ???
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE -- ???
ORDER BY -- ???
```

**Answer below**:
Once `vw_funnel_master` has `Campaign_Id__c` (and optionally `Campaign_Name__c`):

```sql
SELECT DISTINCT
  v.Campaign_Id__c AS campaign_id,
  v.Campaign_Name__c AS campaign_name
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE v.Campaign_Id__c IS NOT NULL
  AND v.FilterDate >= TIMESTAMP(DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR))
ORDER BY campaign_name
```

- **Active-only**: To restrict to “active” campaigns, join Campaign and filter `IsActive = TRUE` (e.g. `LEFT JOIN ... Campaign c ON v.Campaign_Id__c = c.Id WHERE ... AND (c.IsActive = TRUE OR c.Id IS NULL)`), or run a separate query from Campaign table with `IsActive = TRUE` and intersect.  
- **Date range**: Filtering by `FilterDate >= 2 years` keeps options relevant to recent funnel data.  
- **Fields**: `campaign_id` (Id) for filter value, `campaign_name` for dropdown label.  
- **Order**: `ORDER BY campaign_name` for readability. “Most recently used” would require application-level or session state, not just this query.




---

## PHASE 8: Dashboard Filter Implementation Plan

### Q8.1: GlobalFilters.tsx modification plan

**File**: `src/components/dashboard/GlobalFilters.tsx`

**Tasks to document**:
1. Where to add the campaign dropdown (after which existing filter?)
2. What should the label be?
3. Should it be a simple dropdown or multi-select?
4. How should it integrate with the existing filter state?
5. What's the TypeScript type for the campaign filter value?

**Answer below**:
1. **Where to add**: After the existing "Experimentation Tag" dropdown (or in the same row as Channel, Source, SGA, SGM, Experimentation Tag).  
2. **Label**: "Campaign" (or "Marketing Campaign").  
3. **Control**: Simple single-select dropdown (like Experimentation Tag): option "" = "All Campaigns", then one option per campaign (value = Campaign Id, label = Campaign Name).  
4. **Filter state**: Add `campaignId: string | null` to DashboardFilters; on change call `onFiltersChange({ ...filters, campaignId: value === '' ? null : value })`.  
5. **TypeScript type**: `campaignId: string | null` in `DashboardFilters`; filter options: `campaigns: { id: string; name: string }[]` or `campaigns: Array<{ value: string; label: string }>` in FilterOptions.  
6. **Options source**: Populate from `filterOptions.campaigns` (new), which the filter-options API will return once campaign options query is added.




### Q8.2: AdvancedFilters.tsx modification plan

**File**: `src/components/dashboard/AdvancedFilters.tsx`

**Tasks to document**:
1. Should campaign be in advanced filters or just global?
2. If in advanced filters, should it be multi-select?
3. How does the multi-select logic work for other fields we can reference?
4. Where should it be positioned in the advanced filter panel?

**Answer below**:
1. **Global vs advanced**: Campaign can live in **both**: Global as single-select (quick filter) and Advanced as multi-select (with channels/sources/SGAs/SGMs/experimentation tags) for power users.  
2. **Advanced multi-select**: If in Advanced Filters, use the same pattern as Experimentation Tags: `MultiSelectFilterControl` with `filterKey: 'campaigns'`, `campaigns: { selectAll: true, selected: string[] }` in AdvancedFilters type.  
3. **Multi-select logic**: Same as experimentationTags: `handleMultiSelectChange('campaigns', value, checked)`; `handleSelectAll('campaigns')`; filter options `filteredCampaigns` (with optional search); apply sends `advancedFilters.campaigns` to parent.  
4. **Position**: In the "Attribution Filters" section, after "Experimentation Tags" (or before it).  
5. **Filter-helpers**: In `buildAdvancedFilterClauses`, when `!safeFilters.campaigns.selectAll && safeFilters.campaigns.selected.length > 0`, add `v.Campaign_Id__c IN UNNEST(@param_campaigns)` (or `EXISTS` if we ever use a list of ids from names); param `param_campaigns` = array of campaign IDs.




### Q8.3: Filter types update

**File**: `src/types/filters.ts`

**Current experimentation tag definition**:
```typescript
// Find the current definition
```

**Proposed campaign filter definition**:
```typescript
// Design the TypeScript type here
```

**Answer below**:
- **Current experimentation tag**: In `src/types/filters.ts`, DashboardFilters has `experimentationTag: string | null`. AdvancedFilters has `experimentationTags: MultiSelectFilter` (selectAll + selected[]). FilterOptions has `experimentationTags: string[]`.  
- **Proposed campaign types**:
  - **DashboardFilters**: add `campaignId: string | null` (single campaign for global filter).  
  - **AdvancedFilters**: add `campaigns: MultiSelectFilter` (selectAll: boolean; selected: string[] of campaign IDs).  
  - **FilterOptions**: add `campaigns: Array<{ value: string; label: string }>` (value = Id, label = Name) or `campaigns: { id: string; name: string }[]`.  
  - **countActiveAdvancedFilters / hasActiveAdvancedFilters**: include `!filters.campaigns.selectAll` and `if (!filters.campaigns.selectAll) count++`.  
  - **DEFAULT_ADVANCED_FILTERS**: add `campaigns: { selectAll: true, selected: [] }`.




---

## PHASE 9: Query Layer Implementation Plan

### Q9.1: semantic-layer/definitions.ts updates

**File**: `src/lib/semantic-layer/definitions.ts`

**Current experimentation tag dimension**:
```typescript
// Document current definition
```

**Proposed campaign dimension**:
```typescript
// Design the new dimension
```

**Answer below**:
- **Current experimentation_tag** (for reference): `field: 'v.Experimentation_Tag_Raw__c'`, `arrayField: 'v.Experimentation_Tag_List'`, `filterSql: EXISTS (SELECT 1 FROM UNNEST(v.Experimentation_Tag_List) as tag WHERE tag = @experimentationTag)`, aliases `['experiment', 'test tag', 'ab test']`.  
- **Proposed campaign dimension** (single coalesced id, no array):

```typescript
campaign: {
  name: 'Campaign',
  description: 'Marketing campaign (lead or opportunity)',
  field: 'v.Campaign_Id__c',
  requiresJoin: false,
  filterable: true,
  groupable: true,
  filterSql: 'v.Campaign_Id__c = @campaignId',
  aliases: ['marketing campaign', 'campaign name'],
},
```

- For **multi-select** (e.g. advanced filter): same field, filterSql can be `v.Campaign_Id__c IN UNNEST(@campaignIds)` when compiler builds an IN list. No arrayField needed; Campaign_Id__c is a single STRING. If we add Campaign_Name__c for display, it can be a separate display field or alias; filtering stays on Id.




### Q9.2: query-compiler.ts updates

**File**: `src/lib/semantic-layer/query-compiler.ts`

**Questions**:
1. How does `buildDimensionFilterSql` currently handle experimentation tags?
2. Will campaign filtering need similar special handling?
3. If we use a simple Campaign_Id__c field, can we use standard filtering?
4. If we use Campaign_List array, do we need UNNEST logic?

**Answer below**:
1. **buildDimensionFilterSql for experimentation_tag**: Handles `experimentation_tag` specially: for `in`/`equals` with value `*` → `ARRAY_LENGTH(v.Experimentation_Tag_List) > 0`; else → `EXISTS (SELECT 1 FROM UNNEST(v.Experimentation_Tag_List) as tag WHERE UPPER(tag) LIKE ...)`. For `not_in`/`not_equals` → inverse. So experimentation tag uses UNNEST/array logic.  
2. **Campaign**: Campaign is a **single** field `v.Campaign_Id__c` (no array). So no special UNNEST logic; use **standard** dimension handling: for `equals`/`in` → `v.Campaign_Id__c IN (...)` or `v.Campaign_Id__c = @campaignId`; for `not_equals`/`not_in` → `(v.Campaign_Id__c IS NULL OR v.Campaign_Id__c NOT IN (...))`.  
3. **Standard filtering**: Yes. If the dimension definition has `field: 'v.Campaign_Id__c'` and no arrayField, the existing non-SGA, non-experimentation_tag branch in buildDimensionFilterSql (the generic dimension handling) should apply: build conditions from operator and value(s), using the dimension’s field.  
4. **Campaign_List array**: Not needed for current design (one campaign per record). If we later add a Campaign_List (e.g. multiple campaigns per row), we’d add a branch like experimentation_tag: UNNEST + EXISTS.  
- **Code change**: Add `campaign` to DIMENSIONS in definitions.ts; in query-compiler.ts ensure the generic dimension branch uses `dimension.field` for campaign (no special case unless we add multi-campaign array later). No new branch required for single Campaign_Id__c.




---

## PHASE 10: Testing Strategy

### Q10.1: Create test queries for campaign filtering

Write BigQuery test queries that replicate what the dashboard will do:

**Test 1: Filter prospects by Savvy Pirate campaign in date range**
```sql
-- This should match our 74 record validation
```

**Test 2: Filter SQOs by campaign**
```sql
-- Count SQOs for a specific campaign
```

**Test 3: Filter by multiple campaigns (if supporting multi-select)**
```sql
-- Test multi-campaign filtering
```

**Answer below**:
- **Test 1 – Filter prospects by Savvy Pirate in date range (matches 74 validation)**:
```sql
SELECT COUNT(*) as prospect_count
FROM `savvy-gtm-analytics.SavvyGTMData.Lead` l
WHERE l.Campaign__c = '701VS00000YdiVVYAZ'
  AND l.stage_entered_contacting__c IS NOT NULL
  AND DATE(l.stage_entered_contacting__c) >= DATE('2026-01-01')
  AND DATE(l.stage_entered_contacting__c) <= DATE('2026-02-06');
```
Expected: **74**.

- **Test 2 – Filter SQOs by campaign** (after view has Campaign_Id__c, or from Opportunity directly):
```sql
SELECT COUNT(*) as sqo_count
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
WHERE o.CampaignId = '701VS00000YdiVVYAZ'
  AND o.SQL__c = 'Yes'
  AND o.Date_Became_SQO__c IS NOT NULL;
```
Expected (current data): **0** (Savvy Pirate has no SQOs yet).

- **Test 3 – Multi-campaign filtering** (once vw_funnel_master has Campaign_Id__c):
```sql
SELECT COUNT(*) as record_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE v.Campaign_Id__c IN ('701VS00000YdiVVYAZ', '701Dn000001FsInIAK')
  AND DATE(v.FilterDate) >= DATE('2026-01-01')
  AND DATE(v.FilterDate) <= DATE('2026-02-06');
```
Run after view is deployed; compare to sum of single-campaign counts for sanity.




### Q10.2: Migration verification queries

Write queries to verify data consistency after migration:

**Verify 1: Check for null campaigns where experimentation tags exist**
```sql
-- Are there records with experimentation tags but no campaigns?
```

**Verify 2: Check campaign-experimentation tag correlation**
```sql
-- Do campaigns and experimentation tags typically align?
```

**Answer below**:
- **Verify 1 – Null campaigns where experimentation tags exist** (proxy on Lead; view doesn’t have campaign yet):
```sql
SELECT 
  (SELECT COUNT(*) FROM `savvy-gtm-analytics.SavvyGTMData.Lead` 
   WHERE Experimentation_Tag__c IS NOT NULL AND TRIM(Experimentation_Tag__c) != '' AND Campaign__c IS NULL) AS leads_tag_no_campaign,
  (SELECT COUNT(*) FROM `savvy-gtm-analytics.SavvyGTMData.Lead` 
   WHERE Experimentation_Tag__c IS NOT NULL AND TRIM(Experimentation_Tag__c) != '' AND Campaign__c IS NOT NULL) AS leads_tag_with_campaign;
```
Result: **leads_tag_no_campaign = 30,331**, **leads_tag_with_campaign = 0**. So on Lead, experimentation tag and Campaign__c are disjoint: many records have tag but no campaign; none have both. Migration does not “replace” tag with campaign for existing tag-only records; campaign is an additional dimension.

- **Verify 2 – Campaign vs experimentation tag correlation**: No direct join in current view. After adding campaign to the view, a verification query could be: count rows where Experimentation_Tag_Raw__c IS NOT NULL AND Campaign_Id__c IS NULL vs both non-null. Expect many tag-only and some campaign-only; alignment is data-dependent and not 1:1.




---

## PHASE 11: Implementation Checklist

Based on all the above phases, create a complete implementation checklist:

### Backend Changes:
- [ ] Update `views/vw_funnel_master.sql` to add campaign fields
- [ ] Deploy updated view to BigQuery
- [ ] Update `src/lib/queries/filter-options.ts` to fetch campaigns
- [ ] Update `src/lib/semantic-layer/definitions.ts` with campaign dimension
- [ ] Update `src/lib/semantic-layer/query-compiler.ts` if special handling needed
- [ ] Add campaign to semantic layer type definitions

### Frontend Changes:
- [ ] Update `src/types/filters.ts` with campaign filter type
- [ ] Update `src/components/dashboard/GlobalFilters.tsx` to add campaign dropdown
- [ ] Update `src/components/dashboard/AdvancedFilters.tsx` if needed
- [ ] Update default filters to include campaign
- [ ] Update filter comparison logic for campaign

### Testing:
- [ ] Verify 74 Savvy Pirate records query works
- [ ] Test campaign filter in dashboard
- [ ] Test campaign multi-select (if implemented)
- [ ] Test campaign with other filters (channel, source, SGA, etc.)
- [ ] Verify data export includes campaign
- [ ] Test advanced filters with campaign

### Documentation:
- [ ] Update `docs/ARCHITECTURE.md` with campaign filter info
- [ ] Update `docs/CALCULATIONS.md` if needed
- [ ] Add campaign examples to semantic layer docs
- [ ] Update README if filter list needs updating

---

## PHASE 12: Final Recommendations

After completing all phases above, provide your recommendations:

1. **Should we keep experimentation_tag or remove it?**
   - If campaigns fully replace it, can we deprecate experimentation_tag?
   - Or should both coexist?

2. **Best approach for the campaign field structure?**
   - Single coalesced Campaign_Id__c?
   - Separate Lead_Campaign_Id__c and Opp_Campaign_Id__c?
   - Campaign_List array for multi-campaign support?

3. **Filter UI design recommendations**
   - Global filter dropdown vs. Advanced filter multi-select?
   - Both?

4. **Migration path**
   - Can this be a single PR or should it be phased?
   - Any risks to existing functionality?

**Answer below**:

1. **Keep experimentation_tag or remove?**  
   **Keep both.** Experimentation tag is a semicolon-separated string (often one value) and is populated on 30k+ leads with 0 overlap with Campaign__c on Lead. Campaign is a proper SF Campaign object (4.3% leads, 1.2% opps). They answer different questions (ad-hoc experiment labels vs campaign object). Deprecate only if product explicitly moves all use cases to Campaign.

2. **Best campaign field structure?**  
   **Single coalesced Campaign_Id__c** for filtering and display, plus **Lead_Campaign_Id__c** and **Opp_Campaign_Id__c** in the view for diagnostics. **Campaign_Name__c** from a join for labels. **No Campaign_List array** unless we later support multiple campaigns per record.

3. **Filter UI:**  
   **Global**: single-select “Campaign” dropdown (Id value, Name label). **Advanced**: multi-select “Campaigns” (same pattern as Experimentation Tags). Both is recommended.

4. **Migration path:**  
   **Phased.** (1) Backend: add campaign columns to vw_funnel_master and deploy; add campaign to filter-options query and API; add campaign dimension and compiler support; add types and filter helpers. (2) Frontend: GlobalFilters campaign dropdown; AdvancedFilters campaigns multi-select; wire filters to APIs and Explore. (3) Test: 74 Savvy Pirate validation, filter in UI, export. **Risks**: view change requires BigQuery deploy and cache refresh; keep experimentation tag behavior unchanged so existing reports/filters keep working.




---

## PHASE 13: CRITICAL IMPLEMENTATION DETAILS

### Q13.1: **URGENT - Verify the 74 record validation**

In Q4.1, you stated "Expected: 74" but didn't confirm the actual count returned. **Run this exact query now and confirm the count**:

```sql
SELECT COUNT(*) as contacted_count
FROM `savvy-gtm-analytics.SavvyGTMData.Lead` l
WHERE l.Campaign__c = '701VS00000YdiVVYAZ'  -- Savvy Pirate campaign ID
  AND l.stage_entered_contacting__c IS NOT NULL
  AND DATE(l.stage_entered_contacting__c) >= DATE('2026-01-01')
  AND DATE(l.stage_entered_contacting__c) <= DATE('2026-02-06');
```

**Answer with the ACTUAL count returned**:
- **Actual count: 74**
- **Does it match 74? YES**
- If NO, investigate why and provide explanation: N/A — validation passes.

---

### Q13.2: **Provide the exact SQL to modify vw_funnel_master.sql**

You said to add campaign fields but didn't provide the exact SQL. **Write the complete modification** that should be made to each CTE:

**A. Lead_Base CTE - Add at line 24 (after Lead_Experimentation_Tag__c)**:
```sql
Campaign__c AS Lead_Campaign_Id__c,
```

**B. Opp_Base CTE - Add at line 64 (after Opportunity_Experimentation_Tag__c)**:
```sql
CampaignId AS Opp_Campaign_Id__c,
```

**C. Combined CTE - Add at line 161 (after Experimentation_Tag_Raw__c)**:
```sql
COALESCE(o.Opp_Campaign_Id__c, l.Lead_Campaign_Id__c) AS Campaign_Id__c,
l.Lead_Campaign_Id__c,
o.Opp_Campaign_Id__c,
```

**D. After With_SGA_Lookup CTE (around line 192), add a new CTE for Campaign name join**:
```sql
With_Campaign_Name AS (
  SELECT
    wsl.*,
    c.Name AS Campaign_Name__c
  FROM With_SGA_Lookup wsl
  LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.Campaign` c
    ON wsl.Campaign_Id__c = c.Id
),
```

**E. Final CTE - Update line 196 to reference the new CTE**:
```sql
FROM With_Campaign_Name wsl
```

**Confirm this SQL is correct**:
- **Campaign_Id__c for filtering?** Yes — it is in Combined and passed through With_Channel_Mapping, With_SGA_Lookup, With_Campaign_Name, and Final.
- **Campaign_Name__c for display?** Yes — added in With_Campaign_Name via join to Campaign.
- **Preserve existing functionality?** Yes — only additive columns and one new CTE; Final still selects from the same structure (now With_Campaign_Name instead of With_SGA_Lookup). **One correction**: In Combined we must select **column names** that match what later CTEs expect. Lead_Base and Opp_Base output `Lead_Campaign_Id__c` and `Opp_Campaign_Id__c`, so in Combined use `l.Lead_Campaign_Id__c`, `o.Opp_Campaign_Id__c` (no extra AS for those two if they’re already named in the CTEs). So C is correct: add the COALESCE as `Campaign_Id__c` and pass through `l.Lead_Campaign_Id__c` and `o.Opp_Campaign_Id__c`.

---

### Q13.3: **Campaign inheritance pattern verification**

**Answer**:
- **Pattern distribution** (from BigQuery): **Both Same** = 1 record (lead and opp have same campaign). The query returned one row; the other three patterns (Both Different, Lead Only, Opp Only) had 0 records in the result set — i.e. among converted leads with at least one campaign, only one has both lead and opp campaign set and they match.
- **Implication**: **COALESCE(opp, lead)** is correct. When both exist and match we get one campaign; when only lead has campaign we use lead; when only opp has campaign we use opp. Preferring opp in COALESCE gives opportunity-level campaign when present, else lead-level — which is consistent with how we treat other attribution (e.g. source). No change needed.

---

### Q13.4: **Verify Savvy Pirate records will appear in vw_funnel_master after modification**

**Answer**:
- **Count returned: 74**
- **Does it match the 74 from Q13.1?** Yes.
- **If different, explain why:** N/A. The equivalent query (FULL OUTER JOIN Lead/Opp with RecordTypeId filter, COALESCE(Opp.CampaignId, Lead.Campaign__c) as Campaign_Id__c, same date filter) returns 74, so once the view is modified the 74 Savvy Pirate contacted prospects will be queryable.

---

### Q13.5: **Provide complete TypeScript type definitions**

**A. In `src/types/filters.ts` - DashboardFilters**  
Add after `experimentationTag`:
```typescript
campaignId: string | null;  // Single campaign ID for global filter (use campaignId to match existing experimentationTag naming pattern)
```
Add to **AdvancedFilters** interface:
```typescript
campaigns: MultiSelectFilter;
```
Add to **DEFAULT_ADVANCED_FILTERS** (note: this codebase uses `selectAll`/`selected`, not `operator`):
```typescript
campaigns: {
  selectAll: true,
  selected: [],
},
```
Update **hasActiveAdvancedFilters** and **countActiveAdvancedFilters** to include `!filters.campaigns.selectAll` and the count branch for campaigns.

**B. FilterOptions**  
Add:
```typescript
campaigns: Array<{ value: string; label: string }>;  // value = Id, label = Name for dropdown
```
- **Confirm**: Use **Array<{ value: string; label: string }>** (or `{ id: string; name: string }`) so the UI can show name in the dropdown and send Id as filter value. Other filters: channels/sources/experimentationTags are string[] (display = value); sgas/sgms use FilterOption[] (value, label, isActive). For campaign, value = Id and label = Name is the right pattern.

---

### Q13.6: **Filter options query - provide complete implementation**

**Answer**:
1. **Filter to IsActive = TRUE?** Yes — the proposed query does this; it limits to campaigns that have at least one Lead or Opportunity, which keeps the dropdown relevant.
2. **Filter to campaigns with data in last X months?** Optional. The current proposal does not; it only requires at least one Lead/Opp. To align with experimentation tags (last 2 years), you could add a subquery on Lead/Opp with date filters — but that would exclude Savvy Pirate if no converted records yet. So either no date filter (simplest) or “has any Lead/Opp in last 2 years” if we want consistency with other filter options.
3. **Order by Name or LastModifiedDate?** Order by **Name** for dropdown usability. LastModifiedDate would require a different ORDER BY and is optional.
4. **How many campaigns will this return?** **15** (run confirmed: 15 campaigns are IsActive = TRUE and have at least one Lead or Opportunity).

Implementation: add the campaign query to `_getRawFilterOptions` (or a separate cached getter), return `campaigns: Array<{ value: string; label: string }>` (map `id` → `value`, `name` → `label`), and include `campaigns` in the API response in `src/app/api/dashboard/filters/route.ts`. Use the same caching as other filter options (e.g. `getRawFilterOptions`).

---

### Q13.7: **Semantic layer dimension definition - provide exact code**

**Answer**:
- **Do we need both `campaign` and `campaign_name` dimensions?** **No.** One dimension **campaign** with `field: 'v.Campaign_Id__c'` is enough for filtering and grouping. **Display names** can be handled in the UI: filter options already return `{ value: Id, label: Name }`, and detail/export can select `Campaign_Name__c` from the view. A separate `campaign_name` dimension is optional (e.g. for grouping by name in Explore); not required for filter dropdown.
- **Exact code** (single dimension):
```typescript
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
```
Omit `displayField` unless the compiler uses it; UI can resolve name from filter options or from view column `Campaign_Name__c` when needed.

---

### Q13.8: **Query compiler special handling - is it needed?**

**Answer**: **No special handling.** Campaign uses a single scalar field `v.Campaign_Id__c`, so the existing generic dimension handling in `buildDimensionFilterSql` (equals/in → `v.Campaign_Id__c = @campaignId` or `IN UNNEST(@campaignIds)`; not_equals/not_in → IS NULL OR NOT IN) is sufficient. Only experimentation_tag needs special handling because it uses an array (UNNEST) and the `*` “any tag” semantics. **Confirm: use standard filtering for campaign.**

---

### Q13.9: **Filter helpers implementation - provide exact code**

**Answer**: **Correction**: In this codebase, **filter-helpers.ts** only handles **advanced** filters (buildAdvancedFilterClauses). The **global** campaign filter (`filters.campaignId`) is applied in the **query files** (funnel-metrics, conversion-rates, source-performance, detail-records), same as `filters.experimentationTag` — not in filter-helpers.

**In `src/lib/utils/filter-helpers.ts`** — add to `safeFilters` merge:
```typescript
campaigns: {
  ...DEFAULT_ADVANCED_FILTERS.campaigns,
  ...(filters.campaigns || {}),
},
```
Add after experimentation Tags block (and add `campaigns` to DEFAULT_ADVANCED_FILTERS in types):
```typescript
// Campaign filter (multi-select) - same pattern as channels/sources
if (!safeFilters.campaigns.selectAll && safeFilters.campaigns.selected.length > 0) {
  whereClauses.push(`v.Campaign_Id__c IN UNNEST(@${paramPrefix}_campaigns)`);
  params[`${paramPrefix}_campaigns`] = safeFilters.campaigns.selected;
}
```
**In query files** (funnel-metrics, conversion-rates, source-performance, detail-records) add for **global** campaign:
```typescript
if (filters.campaignId) {
  conditions.push('v.Campaign_Id__c = @campaignId');
  params.campaignId = filters.campaignId;
}
```
Note: Advanced filters use **selectAll** and **selected** (no `operator` in MultiSelectFilter in this codebase).

---

### Q13.10: **Campaign field in drill-down and export - what's needed?**

**Answer**:
1. **Detail records table:** Yes — add **Campaign_Name__c** (and optionally Campaign_Id__c) to the columns returned so users can see campaign in the table.
2. **CSV export:** Yes — include campaign (name and/or id) in the export columns if the export is built from the same detail records or view.
3. **Queries to update**:
   - **funnel-metrics.ts** — add campaign filter condition (and param) when `filters.campaignId` is set; no SELECT change if query is aggregate.
   - **conversion-rates.ts** — same: add campaign filter in both scorecard and trend queries.
   - **source-performance.ts** — same: add campaign filter where filters are applied.
   - **detail-records.ts** — add campaign filter when `filters.campaignId` is set; **add to SELECT**: `v.Campaign_Id__c`, `v.Campaign_Name__c` (so detail table and export can show them).
   - **record-detail.ts** — add to SELECT: `v.Campaign_Id__c`, `v.Campaign_Name__c`; add to RecordDetailRaw and RecordDetailFull (e.g. `campaignId`, `campaignName`) and map in the transform. **RecordDetailModal** — add a row for Campaign (label "Campaign", value campaignName or campaignId).
   - **filter-options.ts** — add campaign query and return `campaigns` in raw options.
   - **filter-helpers.ts** — add campaigns to advanced filter clauses (see Q13.9).

**SELECT clause changes**:
- **detail-records.ts**: In the SELECT list add `v.Campaign_Id__c, v.Campaign_Name__c` (and ensure the detail type includes campaign fields).
- **record-detail.ts**: In the SELECT list add `v.Campaign_Id__c, v.Campaign_Name__c`; in the mapping add `campaignId: r.Campaign_Id__c ?? null`, `campaignName: r.Campaign_Name__c ?? null`.

---

### Q13.11: **UI label and positioning - exact specifications**

**GlobalFilters.tsx**:
- **Label:** **"Campaign"** (short and clear).
- **Position:** After **Experimentation Tag** (same row as other attribution filters).
- **Show when no campaigns?** Only show when `filterOptions.campaigns?.length > 0` (same as Experimentation Tag), so the dropdown is hidden when there are no options.

**AdvancedFilters.tsx**:
- **Label:** **"Campaigns"** (plural for multi-select).
- **Position:** In Attribution Filters section, **after** "Experimentation Tags".
- **Searchable:** Yes — add search state and filter options like SGAs/SGMs/Experimentation Tags so users can search by name.

---

### Q13.12: **Rollback plan - what if we need to revert?**

**Answer**:
1. **Revert vw_funnel_master.sql and redeploy?** Yes. Revert the view definition in the repo and redeploy the view in BigQuery so it no longer exposes Campaign_Id__c, Campaign_Name__c, etc. That stops any queries from selecting those columns.
2. **Frontend with missing Campaign_Id__c?** No — the frontend will break if it selects or filters on `v.Campaign_Id__c` and the view no longer has it (e.g. BigQuery error or missing column). So rollback should be **full**: revert view **and** app (filter types, filter-helpers, query files, UI). Alternatively, make campaign optional: only add campaign filter/columns when the view is known to have them (e.g. feature flag or API contract version).
3. **Feature flag?** Recommended. Add a feature flag (e.g. `ENABLE_CAMPAIGN_FILTER` or a config check) so that: (a) campaign dropdown and advanced campaign filter are only rendered when the flag is on, and (b) query files only add campaign conditions when the flag is on. Then rollback = turn off flag + optionally revert view so the view doesn’t need to be reverted immediately.

**Rollback checklist**:
1. Turn off campaign feature flag (if implemented).
2. Revert view: restore previous vw_funnel_master.sql and redeploy to BigQuery.
3. Revert app: types (filters.ts), filter-helpers, filter-options, query files (funnel-metrics, conversion-rates, source-performance, detail-records, record-detail), GlobalFilters, AdvancedFilters, semantic layer (definitions, compiler if any campaign-specific code), record-detail types and modal.
4. Invalidate dashboard cache after view revert.
5. Smoke-test: load dashboard, apply other filters, export — confirm no references to campaign and no errors.

---

## APPENDIX: Useful Queries for Reference

### Get all column names in vw_funnel_master:
```sql
SELECT column_name, data_type, is_nullable
FROM `savvy-gtm-analytics.Tableau_Views.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name = 'vw_funnel_master'
ORDER BY ordinal_position;
```

### Sample current data from vw_funnel_master:
```sql
SELECT *
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
LIMIT 5;
```

### Get campaigns with record counts:
```sql
SELECT 
  c.Id,
  c.Name,
  c.Type,
  c.Status,
  COUNT(DISTINCT l.Id) as lead_count,
  COUNT(DISTINCT o.Id) as opp_count
FROM `savvy-gtm-analytics.SavvyGTMData.Campaign` c
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.Lead` l
  ON c.Id = l.Campaign__c
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
  ON c.Id = o.CampaignId
GROUP BY c.Id, c.Name, c.Type, c.Status
ORDER BY lead_count DESC, opp_count DESC;
```
