# ADDITIONAL CRITICAL QUESTIONS - Campaign Implementation

**Instructions for cursor.ai**: Append these questions AND your answers to `C:\Users\russe\Documents\Dashboard\campaign_questions.md` at the end of the document under a new section called "## PHASE 13: CRITICAL IMPLEMENTATION DETAILS"

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
- Actual count: ???
- Does it match 74? YES/NO
- If NO, investigate why and provide explanation




### Q13.2: **Provide the exact SQL to modify vw_funnel_master.sql**

You said to add campaign fields but didn't provide the exact SQL. **Write the complete modification** that should be made to each CTE:

**A. Lead_Base CTE - Add at line 24 (after Lead_Experimentation_Tag__c)**:
```sql
-- Add this line:
Campaign__c AS Lead_Campaign_Id__c,
```

**B. Opp_Base CTE - Add at line 64 (after Opportunity_Experimentation_Tag__c)**:
```sql
-- Add this line:
CampaignId AS Opp_Campaign_Id__c,
```

**C. Combined CTE - Add at line 161 (after Experimentation_Tag_Raw__c)**:
```sql
-- Add these lines:
COALESCE(o.Opp_Campaign_Id__c, l.Lead_Campaign_Id__c) AS Campaign_Id__c,
l.Lead_Campaign_Id__c,
o.Opp_Campaign_Id__c,
```

**D. After With_SGA_Lookup CTE (around line 192), add a new CTE for Campaign name join**:
```sql
-- Add this entire new CTE after With_SGA_Lookup:
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
-- Change FROM With_SGA_Lookup wsl to:
FROM With_Campaign_Name wsl
```

**Confirm this SQL is correct** by mentally tracing through the CTEs:
- Does this give us Campaign_Id__c for filtering?
- Does this give us Campaign_Name__c for display?
- Does this preserve all existing functionality?

**Answer**: (Confirm or provide corrections)




### Q13.3: **Campaign inheritance pattern verification**

From Q4.3, you found that some leads have campaigns but their converted opportunities don't. **Run this query to understand the inheritance pattern better**:

```sql
WITH campaign_flow AS (
  SELECT 
    l.Campaign__c as lead_campaign,
    lc.Name as lead_campaign_name,
    o.CampaignId as opp_campaign,
    oc.Name as opp_campaign_name,
    COUNT(*) as record_count
  FROM `savvy-gtm-analytics.SavvyGTMData.Lead` l
  LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.Campaign` lc
    ON l.Campaign__c = lc.Id
  LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
    ON l.ConvertedOpportunityId = o.Id
  LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.Campaign` oc
    ON o.CampaignId = oc.Id
  WHERE l.IsConverted = TRUE
    AND (l.Campaign__c IS NOT NULL OR o.CampaignId IS NOT NULL)
  GROUP BY 1, 2, 3, 4
)
SELECT 
  CASE 
    WHEN lead_campaign IS NOT NULL AND opp_campaign IS NOT NULL AND lead_campaign = opp_campaign THEN 'Both Same'
    WHEN lead_campaign IS NOT NULL AND opp_campaign IS NOT NULL AND lead_campaign != opp_campaign THEN 'Both Different'
    WHEN lead_campaign IS NOT NULL AND opp_campaign IS NULL THEN 'Lead Only'
    WHEN lead_campaign IS NULL AND opp_campaign IS NOT NULL THEN 'Opp Only'
  END as pattern,
  SUM(record_count) as total_records
FROM campaign_flow
GROUP BY 1
ORDER BY 2 DESC;
```

**Answer with**:
- Pattern distribution (how many records in each category)
- **Implication**: Does our COALESCE(opp, lead) logic make sense, or should we prefer lead_campaign?




### Q13.4: **Verify Savvy Pirate records will appear in vw_funnel_master after modification**

After adding campaign fields to vw_funnel_master, run this test query to verify the 74 Savvy Pirate contacted prospects will be queryable:

```sql
-- THIS QUERY SHOULD BE RUN AFTER the view is modified
-- For now, run the equivalent query against the base tables:

SELECT COUNT(*) as contacted_count
FROM (
  SELECT
    l.Id,
    l.Campaign__c AS Lead_Campaign_Id__c,
    o.CampaignId AS Opp_Campaign_Id__c,
    COALESCE(o.CampaignId, l.Campaign__c) AS Campaign_Id__c,
    l.stage_entered_contacting__c
  FROM `savvy-gtm-analytics.SavvyGTMData.Lead` l
  FULL OUTER JOIN `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
    ON l.ConvertedOpportunityId = o.Id
  WHERE o.RecordTypeId IN ('012Dn000000mrO3IAI', '012VS000009VoxrYAC')
    OR o.RecordTypeId IS NULL
) v
WHERE v.Campaign_Id__c = '701VS00000YdiVVYAZ'
  AND v.stage_entered_contacting__c IS NOT NULL
  AND DATE(v.stage_entered_contacting__c) >= DATE('2026-01-01')
  AND DATE(v.stage_entered_contacting__c) <= DATE('2026-02-06');
```

**Answer**:
- Count returned: ???
- Does it match the 74 from Q13.1?
- If different, explain why




### Q13.5: **Provide complete TypeScript type definitions**

Show the exact code additions needed for TypeScript types:

**A. In `src/types/filters.ts` - Add to DashboardFilters interface**:
```typescript
// Find the current interface and show where to add:
export interface DashboardFilters {
  // ... existing fields ...
  experimentationTag?: string | null;
  
  // ADD THIS:
  campaign?: string | null;  // Single campaign ID for global filter
  
  advancedFilters?: {
    // ... existing advanced filters ...
    experimentationTags?: MultiSelectFilter;
    
    // ADD THIS:
    campaigns?: MultiSelectFilter;  // Multi-select for advanced filters
  };
}
```

**B. In `src/types/filters.ts` - Add to DEFAULT_ADVANCED_FILTERS**:
```typescript
export const DEFAULT_ADVANCED_FILTERS = {
  // ... existing defaults ...
  experimentationTags: { operator: 'in' as const, selected: [] },
  
  // ADD THIS:
  campaigns: { operator: 'in' as const, selected: [] },
};
```

**C. Show what FilterOptions interface needs**:
```typescript
export interface FilterOptions {
  // ... existing options ...
  experimentationTags: string[];
  
  // ADD THIS:
  campaigns: Array<{ id: string; name: string }>;  // Or just string[] for IDs?
}
```

**Confirm**:
- Should campaigns in FilterOptions be `Array<{id: string, name: string}>` or just `string[]`?
- How do other filters handle ID vs display name?




### Q13.6: **Filter options query - provide complete implementation**

Write the complete query that should be added to `src/lib/queries/filter-options.ts`:

```typescript
// Add this function to filter-options.ts:

export const getCampaigns = async (): Promise<Array<{ id: string; name: string }>> => {
  const query = `
    SELECT DISTINCT
      c.Id as id,
      c.Name as name
    FROM \`savvy-gtm-analytics.SavvyGTMData.Campaign\` c
    WHERE c.IsActive = TRUE
      -- Only include campaigns that have associated records
      AND (
        EXISTS (
          SELECT 1 FROM \`savvy-gtm-analytics.SavvyGTMData.Lead\` l 
          WHERE l.Campaign__c = c.Id
        )
        OR EXISTS (
          SELECT 1 FROM \`savvy-gtm-analytics.SavvyGTMData.Opportunity\` o 
          WHERE o.CampaignId = c.Id
        )
      )
    ORDER BY c.Name ASC
  `;
  
  const results = await runQuery<{ id: string; name: string }>(query);
  return results || [];
};
```

**Questions**:
1. Should we filter to only `IsActive = TRUE` campaigns?
2. Should we filter to campaigns with data in last X months?
3. Should we order by Name or by most recently used (LastModifiedDate)?
4. How many campaigns will this return? (Run the query and confirm)




### Q13.7: **Semantic layer dimension definition - provide exact code**

Show the exact code to add to `src/lib/semantic-layer/definitions.ts`:

```typescript
// Add this to the DIMENSIONS object (after experimentation_tag):

campaign: {
  name: 'Campaign',
  description: 'Salesforce Campaign (marketing campaign object)',
  field: 'v.Campaign_Id__c',  // The coalesced campaign ID
  rawField: 'Campaign_Id__c',
  requiresJoin: false,  // Campaign_Id__c is in vw_funnel_master
  filterable: true,
  groupable: true,
  displayField: 'v.Campaign_Name__c',  // For display/labels
  aliases: ['marketing campaign', 'sfdc campaign'],
  note: 'Coalesced from Lead.Campaign__c and Opportunity.CampaignId',
},

campaign_name: {
  name: 'Campaign Name',
  description: 'Campaign display name',
  field: 'v.Campaign_Name__c',
  rawField: 'Campaign_Name__c',
  requiresJoin: false,
  filterable: false,  // Filter by ID, display by name
  groupable: true,
  aliases: ['campaign label'],
},
```

**Confirm**:
- Do we need both `campaign` and `campaign_name` dimensions?
- Or can we handle display names in the UI layer?




### Q13.8: **Query compiler special handling - is it needed?**

Review the experimentation tag special handling in `query-compiler.ts`:

```typescript
// Current experimentation tag handling:
if (filter.dimension === 'experimentation_tag') {
  if (filter.operator === 'equals' || filter.operator === 'in') {
    const values = Array.isArray(filter.value) ? filter.value : [filter.value];
    
    if (values.length === 1 && values[0] === '*') {
      clauses.push(`ARRAY_LENGTH(v.Experimentation_Tag_List) > 0`);
    } else {
      const conditions = values.map((v) => {
        const escapedValue = String(v).replace(/'/g, "''").replace(/%/g, "\\%").replace(/_/g, "\\_");
        return `UPPER(tag) LIKE UPPER('%${escapedValue}%')`;
      });
      clauses.push(
        `EXISTS (SELECT 1 FROM UNNEST(v.Experimentation_Tag_List) as tag WHERE ${conditions.join(' OR ')})`
      );
    }
  }
  // ... not_equals/not_in handling ...
  continue;
}
```

**Question**: Does campaign need similar special handling, or can it use standard filtering?

Since Campaign_Id__c is a simple string field (not an array), we can probably use standard filtering:

```typescript
// Standard filtering should work:
if (filter.dimension === 'campaign') {
  // Standard IN clause will work
  // v.Campaign_Id__c IN ('701VS00000YdiVVYAZ', '701Dn000001FsInIAK')
}
```

**Confirm**: Can we use standard filtering for campaign, or do we need special handling?




### Q13.9: **Filter helpers implementation - provide exact code**

In `src/lib/queries/filter-helpers.ts`, show the code to add campaign filtering:

**Find where experimentation tag filtering is done and add campaign similarly**:

```typescript
// After experimentation tag handling, add:

// Campaign filter (global single-select)
if (filters.campaign) {
  whereConditions.push('v.Campaign_Id__c = @campaign');
  params.campaign = filters.campaign;
}

// Campaign advanced filter (multi-select)
if (filters.advancedFilters?.campaigns && filters.advancedFilters.campaigns.selected.length > 0) {
  if (filters.advancedFilters.campaigns.operator === 'in') {
    whereConditions.push('v.Campaign_Id__c IN UNNEST(@param_campaigns)');
    params.param_campaigns = filters.advancedFilters.campaigns.selected;
  } else if (filters.advancedFilters.campaigns.operator === 'not_in') {
    whereConditions.push('(v.Campaign_Id__c NOT IN UNNEST(@param_campaigns) OR v.Campaign_Id__c IS NULL)');
    params.param_campaigns = filters.advancedFilters.campaigns.selected;
  }
}
```

**Confirm this matches the pattern used for other filters**




### Q13.10: **Campaign field in drill-down and export - what's needed?**

**Questions**:
1. Should Campaign_Name__c be added to the detail records table?
2. Should it be added to CSV exports?
3. Which queries need to be updated to SELECT Campaign_Id__c and Campaign_Name__c?

**List all query files that need to add campaign fields**:
- `src/lib/queries/funnel-metrics.ts` - ???
- `src/lib/queries/conversion-rates.ts` - ???
- `src/lib/queries/source-performance.ts` - ???
- `src/lib/queries/detail-records.ts` - ??? (likely YES)
- `src/lib/queries/record-detail.ts` - ??? (for modal)
- Others?

**For each file that needs updates, show the exact SELECT clause modification needed**




### Q13.11: **UI label and positioning - exact specifications**

**GlobalFilters.tsx**:
- Exact label: "Campaign" or "Marketing Campaign" or "SFDC Campaign"?
- Position: After which existing filter? (After source? After experimentation tag?)
- Should it show when no campaigns exist in filter options?

**AdvancedFilters.tsx**:
- Exact label: "Campaigns" (plural)?
- Position: In Attribution Filters section, after Experimentation Tags?
- Should it be searchable (like SGAs/SGMs)?




### Q13.12: **Rollback plan - what if we need to revert?**

If the campaign implementation breaks something, what's the rollback procedure?

1. Can we just revert the vw_funnel_master.sql change and redeploy the view?
2. Will the frontend gracefully handle missing Campaign_Id__c field?
3. Should we add a feature flag to toggle campaign filtering on/off?

**Provide the rollback checklist**




---

## CURSOR.AI: Please answer ALL questions above and append to the main campaign_questions.md file

**Critical priorities**:
1. Q13.1 - Verify the 74 count (URGENT - this validates our entire approach)
2. Q13.2 - Exact SQL for vw_funnel_master (needed to implement)
3. Q13.5 - TypeScript types (needed for type safety)
4. Q13.6 - Filter options query (needed for dropdown population)
5. Q13.9 - Filter helpers code (needed for actual filtering to work)
