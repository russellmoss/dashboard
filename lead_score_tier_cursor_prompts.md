# Lead Score Tier — Cursor.ai Implementation Prompts

> **How to use this document**: Each phase below contains a **Cursor Prompt** (copy-paste into Cursor) followed by **exact code snippets** that Cursor must match, then **Validation Steps** you must run and confirm before moving to the next phase.
>
> **CRITICAL RULE**: Do NOT proceed to the next phase until all validation steps pass with zero errors.
>
> **Design decisions baked in**:
> - Advanced multi-select only (no global filter)
> - Include "(No Tier)" option for NULL leads (sentinel value `__NO_TIER__`)
> - Query from `vw_funnel_master` (no date scoping — only 14 values)
> - No breakdown component (rely on AI layer for "Contacted→MQL by tier")

---

## Phase 1: TypeScript Type Definitions

### Cursor Prompt 1

```
Add `leadScoreTiers` as a new advanced multi-select filter to the type system. This follows the exact same pattern as `campaigns`. Make these changes to `src/types/filters.ts`:

1. Add `leadScoreTiers: MultiSelectFilter` to the `AdvancedFilters` interface (after `campaigns`)
2. Add `leadScoreTiers: { selectAll: true, selected: [] }` to `DEFAULT_ADVANCED_FILTERS` (after `campaigns`)
3. Add `!filters.leadScoreTiers.selectAll` to the return expression in `hasActiveAdvancedFilters` (after the campaigns line)
4. Add `if (!filters.leadScoreTiers.selectAll) count++` to `countActiveAdvancedFilters` (after the campaigns line)
5. Add `leadScoreTiers: FilterOption[]` to the `FilterOptions` interface (after `campaigns`)

Do NOT change any existing fields. Only add the new `leadScoreTiers` lines.

Here is the exact code for each change:
```

### Exact Code — `src/types/filters.ts`

**Change 1 — AdvancedFilters interface**: Find the line `campaigns: MultiSelectFilter;` inside the `AdvancedFilters` interface and add after it:

```typescript
  campaigns: MultiSelectFilter;
  leadScoreTiers: MultiSelectFilter;
```

**Change 2 — DEFAULT_ADVANCED_FILTERS**: Find the closing of the campaigns default block and add after it:

```typescript
  campaigns: {
    selectAll: true,
    selected: [],
  },
  leadScoreTiers: {
    selectAll: true,
    selected: [],
  },
};
```

**Change 3 — hasActiveAdvancedFilters**: Find `!filters.campaigns.selectAll` in the return expression and add a new line after it:

```typescript
    !filters.campaigns.selectAll ||
    !filters.leadScoreTiers.selectAll
  );
```

**Change 4 — countActiveAdvancedFilters**: Find `if (!filters.campaigns.selectAll) count++;` and add after it:

```typescript
  if (!filters.campaigns.selectAll) count++;
  if (!filters.leadScoreTiers.selectAll) count++;
  return count;
```

**Change 5 — FilterOptions interface**: Find `campaigns: FilterOption[];` and add after it:

```typescript
  campaigns: FilterOption[];
  leadScoreTiers: FilterOption[];
```

### Validation Steps — Phase 1A

```bash
# Run from project root:
npx tsc --noEmit 2>&1 | head -50
```

**Expected**: You will see errors in OTHER files that don't yet provide `leadScoreTiers` (e.g., `filter-options.ts`, `filters/route.ts`, `AdvancedFilters.tsx`, `dashboard/page.tsx`). That's expected — those are fixed in later phases.

**What must NOT happen**: No syntax errors IN `src/types/filters.ts` itself. If you see an error pointing to `filters.ts`, fix it before proceeding.

**Manual check**: Open `src/types/filters.ts` and confirm:
- [ ] `AdvancedFilters` has 9 keys (7 multi-select + 2 date)
- [ ] `DEFAULT_ADVANCED_FILTERS` has 9 matching keys
- [ ] `hasActiveAdvancedFilters` checks 9 conditions (2 date + 7 multi-select including leadScoreTiers)
- [ ] `countActiveAdvancedFilters` counts 9 conditions
- [ ] `FilterOptions` has `leadScoreTiers: FilterOption[]`

---

## Phase 1B: Dashboard Types and Page

### Cursor Prompt 1B

```
Add `leadScoreTier` to the DetailRecord interface and update the filtersAreEqual function to compare the new leadScoreTiers advanced filter.

1. In `src/types/dashboard.ts`, add `leadScoreTier: string | null` to the `DetailRecord` interface after `campaignName`.

2. In `src/app/dashboard/page.tsx`, update the `filtersAreEqual` function:
   a. In the `advA` object construction, add a `leadScoreTiers` merge block after the `campaigns` block (same pattern)
   b. In the `advB` object construction, add the same `leadScoreTiers` merge block after `campaigns`
   c. After the line `if (!compareMultiSelect(advA.campaigns, advB.campaigns)) return false;`, add:
      `if (!compareMultiSelect(advA.leadScoreTiers, advB.leadScoreTiers)) return false;`

Here is the exact code:
```

### Exact Code — `src/types/dashboard.ts`

Find `campaignName: string | null;` in the `DetailRecord` interface and add after it:

```typescript
  campaignName: string | null;
  leadScoreTier: string | null;
```

### Exact Code — `src/app/dashboard/page.tsx`

**Change 1 — advA construction**: Find the campaigns merge in `advA`:

```typescript
    campaigns: {
      ...DEFAULT_ADVANCED_FILTERS.campaigns,
      ...(a.advancedFilters?.campaigns || {}),
    },
```

Add immediately after it (before the closing `};`):

```typescript
    leadScoreTiers: {
      ...DEFAULT_ADVANCED_FILTERS.leadScoreTiers,
      ...(a.advancedFilters?.leadScoreTiers || {}),
    },
```

**Change 2 — advB construction**: Find the campaigns merge in `advB` and add the same block:

```typescript
    leadScoreTiers: {
      ...DEFAULT_ADVANCED_FILTERS.leadScoreTiers,
      ...(b.advancedFilters?.leadScoreTiers || {}),
    },
```

**Change 3 — compareMultiSelect calls**: Find:

```typescript
  if (!compareMultiSelect(advA.campaigns, advB.campaigns)) return false;
```

Add after it:

```typescript
  if (!compareMultiSelect(advA.leadScoreTiers, advB.leadScoreTiers)) return false;
```

### Validation Steps — Phase 1B

```bash
npx tsc --noEmit 2>&1 | head -50
```

**Expected**: Errors still exist in filter-options.ts, filters/route.ts, AdvancedFilters.tsx (they don't provide leadScoreTiers yet). But NO new errors should appear in `dashboard.ts` or `page.tsx`.

**Manual check**:
- [ ] `DetailRecord` in `dashboard.ts` has `leadScoreTier: string | null`
- [ ] `filtersAreEqual` in `page.tsx` merges `leadScoreTiers` for both `advA` and `advB`
- [ ] `filtersAreEqual` compares `leadScoreTiers` via `compareMultiSelect`

---

## Phase 2: Backend Filter Options Query

### Cursor Prompt 2

```
Add lead score tier to the filter options query in `src/lib/queries/filter-options.ts`. Follow the exact pattern used for campaigns. Make these changes:

1. Add a `LeadScoreTierResult` interface after `CampaignResult`:
   ```typescript
   interface LeadScoreTierResult {
     value: string | null;
     record_count: number | string;
   }
   ```

2. Add `leadScoreTiers` to the `RawFilterOptions` interface:
   ```typescript
   leadScoreTiers: Array<{ value: string; record_count: number }>;
   ```

3. Inside `_getRawFilterOptions`, add this query string after `campaignsQuery`:
   ```typescript
   const leadScoreTiersQuery = `
     SELECT 
       Lead_Score_Tier__c AS value, 
       COUNT(*) AS record_count
     FROM \`${FULL_TABLE}\`
     WHERE Lead_Score_Tier__c IS NOT NULL 
       AND TRIM(Lead_Score_Tier__c) != ''
     GROUP BY Lead_Score_Tier__c
     ORDER BY record_count DESC
   `;
   ```

4. Add `leadScoreTiersResult` as a 9th entry to the Promise.all destructuring array AND a 9th runQuery call:
   ```typescript
   runQuery<LeadScoreTierResult>(leadScoreTiersQuery),
   ```

5. Add to the return object after campaigns:
   ```typescript
   leadScoreTiers: leadScoreTiersResult
     .filter(r => r.value && String(r.value).trim() !== '')
     .map(r => ({
       value: r.value!,
       record_count: parseInt((r.record_count?.toString() || '0'), 10),
     })),
   ```

Do NOT change any existing queries or mappings. Only add the new lead score tier entries.
```

### Exact Code — `src/lib/queries/filter-options.ts`

**After the existing CampaignResult interface, add** (do not duplicate CampaignResult):

```typescript
interface LeadScoreTierResult {
  value: string | null;
  record_count: number | string;
}
```

**In RawFilterOptions, add after campaigns**:

```typescript
  campaigns: FilterOption[];
  leadScoreTiers: Array<{ value: string; record_count: number }>;
}
```

**Query string** (add after campaignsQuery inside `_getRawFilterOptions`):

```typescript
  const leadScoreTiersQuery = `
    SELECT 
      Lead_Score_Tier__c AS value, 
      COUNT(*) AS record_count
    FROM \`${FULL_TABLE}\`
    WHERE Lead_Score_Tier__c IS NOT NULL 
      AND TRIM(Lead_Score_Tier__c) != ''
    GROUP BY Lead_Score_Tier__c
    ORDER BY record_count DESC
  `;
```

**Promise.all** — add 9th destructuring slot and 9th query:

```typescript
  const [
    channelsResult,
    sourcesResult,
    sgasResult,
    sgmsResult,
    stagesResult,
    yearsResult,
    experimentationTagsResult,
    campaignsResult,
    leadScoreTiersResult,
  ] = await Promise.all([
    runQuery<ChannelResult>(channelsQuery),
    runQuery<SourceResult>(sourcesQuery),
    runQuery<SGAResult>(sgasQuery),
    runQuery<SGMResult>(sgmsQuery),
    runQuery<StageResult>(stagesQuery),
    runQuery<YearResult>(yearsQuery),
    runQuery<ExperimentationTagResult>(experimentationTagsQuery),
    runQuery<CampaignResult>(campaignsQuery),
    runQuery<LeadScoreTierResult>(leadScoreTiersQuery),
  ]);
```

**Return object** — add after campaigns mapping:

```typescript
    campaigns: campaignsResult
      .filter(r => r.id && r.name)
      .map(r => ({ value: r.id!, label: r.name!, isActive: true })),
    leadScoreTiers: leadScoreTiersResult
      .filter(r => r.value && String(r.value).trim() !== '')
      .map(r => ({
        value: r.value!,
        record_count: parseInt((r.record_count?.toString() || '0'), 10),
      })),
  };
```

### Validation Steps — Phase 2

```bash
npx tsc --noEmit 2>&1 | grep "filter-options"
```

**Expected**: Zero errors in `filter-options.ts`. If you see type errors, check that `RawFilterOptions` includes `leadScoreTiers` and the Promise.all destructuring has exactly 9 entries matching 9 runQuery calls.

---

## Phase 3: API Route

### Cursor Prompt 3

```
Add `leadScoreTiers` to the filter options API response in `src/app/api/dashboard/filters/route.ts`.

Find where `filterOptions` is built (the object that maps rawOptions to the FilterOptions shape). After the `campaigns` mapping, add:

```typescript
leadScoreTiers: (rawOptions.leadScoreTiers || []).map(t => ({
  value: t.value,
  label: t.value,
  isActive: true,
  count: t.record_count,
})),
```

This maps the raw lead score tier results to the FilterOption[] shape expected by the frontend. The label is the same as the value (e.g. "TIER_1_PRIME_MOVER") since tier values are self-descriptive.
```

### Exact Code — `src/app/api/dashboard/filters/route.ts`

Find the `campaigns:` mapping in the filterOptions construction and add after it:

```typescript
      campaigns: (rawOptions.campaigns || []).map(c => ({
        value: c.value,
        label: c.label,
        isActive: true,
      })),
      leadScoreTiers: (rawOptions.leadScoreTiers || []).map(t => ({
        value: t.value,
        label: t.value,
        isActive: true,
        count: t.record_count,
      })),
```

### Validation Steps — Phase 3

```bash
npx tsc --noEmit 2>&1 | grep -E "(filters/route|filter-options)"
```

**Expected**: Zero errors in both files. If you see type mismatch errors, ensure `FilterOptions` (from Phase 1) includes `leadScoreTiers: FilterOption[]` and the route returns that shape.

**BQ data validation** (run via MCP):

```sql
SELECT Lead_Score_Tier__c AS value, COUNT(*) AS record_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE Lead_Score_Tier__c IS NOT NULL AND TRIM(Lead_Score_Tier__c) != ''
GROUP BY Lead_Score_Tier__c
ORDER BY record_count DESC
```

**Expected**: Multiple distinct tier values (e.g. TIER_0C_CLOCKWORK_DUE, TIER_1_PRIME_MOVER, etc.). Run via MCP to verify; actual row counts may vary. Save the output — you'll compare this against the API response in Phase 5 validation.

---

## Phase 4: Backend Filter WHERE Clause

### Cursor Prompt 4

```
Add lead score tier filtering to `src/lib/utils/filter-helpers.ts`. This is the most critical change — it handles the "(No Tier)" sentinel value for NULL rows.

Make these changes:

1. In the `safeFilters` object inside `buildAdvancedFilterClauses`, add a `leadScoreTiers` merge after `campaigns`:
   ```typescript
   leadScoreTiers: {
     ...DEFAULT_ADVANCED_FILTERS.leadScoreTiers,
     ...(filters.leadScoreTiers || {}),
   },
   ```

2. After the campaign filter block (the `if (!safeFilters.campaigns.selectAll ...)` block) and BEFORE `return { whereClauses, params }`, add this lead score tier filter block:

   ```typescript
   // Lead Score Tier filter (multi-select)
   // Handles special "__NO_TIER__" sentinel for NULL tiers
   if (!safeFilters.leadScoreTiers.selectAll && safeFilters.leadScoreTiers.selected.length > 0) {
     const realTiers = safeFilters.leadScoreTiers.selected.filter(t => t !== '__NO_TIER__');
     const includeNoTier = safeFilters.leadScoreTiers.selected.includes('__NO_TIER__');

     if (realTiers.length > 0 && includeNoTier) {
       // Both real tiers AND "(No Tier)" selected
       whereClauses.push(`(v.Lead_Score_Tier__c IN UNNEST(@${paramPrefix}_lead_score_tiers) OR v.Lead_Score_Tier__c IS NULL)`);
       params[`${paramPrefix}_lead_score_tiers`] = realTiers;
     } else if (realTiers.length > 0) {
       // Only real tiers selected
       whereClauses.push(`v.Lead_Score_Tier__c IN UNNEST(@${paramPrefix}_lead_score_tiers)`);
       params[`${paramPrefix}_lead_score_tiers`] = realTiers;
     } else if (includeNoTier) {
       // Only "(No Tier)" selected
       whereClauses.push(`v.Lead_Score_Tier__c IS NULL`);
     }
   }
   ```

3. In the `hasActiveFilters` function, add `!filters.leadScoreTiers.selectAll` to the return expression after the campaigns line.

IMPORTANT: The sentinel value `__NO_TIER__` is a frontend-only concept. When the user selects "(No Tier)" in the UI, the selected array contains the string `'__NO_TIER__'`. This block translates that to `IS NULL` in SQL. Real tier values (e.g. "TIER_1_PRIME_MOVER") use `IN UNNEST(...)`. When both are selected, it uses OR.

Do NOT modify any existing filter blocks. Only add the new lead score tier block.
```

### Exact Code — `src/lib/utils/filter-helpers.ts`

**Change 1 — safeFilters merge**: After campaigns:

```typescript
    campaigns: {
      ...DEFAULT_ADVANCED_FILTERS.campaigns,
      ...(filters.campaigns || {}),
    },
    leadScoreTiers: {
      ...DEFAULT_ADVANCED_FILTERS.leadScoreTiers,
      ...(filters.leadScoreTiers || {}),
    },
  };
```

**Change 2 — WHERE clause block**: After the campaign filter block (which ends around line 131), add:

```typescript
  // Lead Score Tier filter (multi-select)
  // Handles special "__NO_TIER__" sentinel for NULL tiers
  if (!safeFilters.leadScoreTiers.selectAll && safeFilters.leadScoreTiers.selected.length > 0) {
    const realTiers = safeFilters.leadScoreTiers.selected.filter(t => t !== '__NO_TIER__');
    const includeNoTier = safeFilters.leadScoreTiers.selected.includes('__NO_TIER__');

    if (realTiers.length > 0 && includeNoTier) {
      // Both real tiers AND "(No Tier)" selected
      whereClauses.push(`(v.Lead_Score_Tier__c IN UNNEST(@${paramPrefix}_lead_score_tiers) OR v.Lead_Score_Tier__c IS NULL)`);
      params[`${paramPrefix}_lead_score_tiers`] = realTiers;
    } else if (realTiers.length > 0) {
      // Only real tiers selected
      whereClauses.push(`v.Lead_Score_Tier__c IN UNNEST(@${paramPrefix}_lead_score_tiers)`);
      params[`${paramPrefix}_lead_score_tiers`] = realTiers;
    } else if (includeNoTier) {
      // Only "(No Tier)" selected
      whereClauses.push(`v.Lead_Score_Tier__c IS NULL`);
    }
  }
```

**Change 3 — hasActiveFilters**: Find `!filters.campaigns.selectAll` and add after:

```typescript
    !filters.campaigns.selectAll ||
    !filters.leadScoreTiers.selectAll
  );
```

### Validation Steps — Phase 4

```bash
npx tsc --noEmit 2>&1 | grep "filter-helpers"
```

**Expected**: Zero errors.

**Logic review** — mentally trace these three scenarios:

| User selects... | `realTiers` | `includeNoTier` | SQL produced |
|---|---|---|---|
| TIER_1_PRIME_MOVER | `['TIER_1_PRIME_MOVER']` | false | `v.Lead_Score_Tier__c IN UNNEST(...)` |
| (No Tier) | `[]` | true | `v.Lead_Score_Tier__c IS NULL` |
| TIER_1 + (No Tier) | `['TIER_1_PRIME_MOVER']` | true | `(... IN UNNEST(...) OR ... IS NULL)` |

**CRITICAL**: Because all query files (funnel-metrics.ts, conversion-rates.ts, source-performance.ts, detail-records.ts) already call `buildAdvancedFilterClauses(advancedFilters, 'adv')` and append the result, **NO changes are needed in those files**. The new tier clause automatically propagates.

---

## Phase 5: Frontend UI — AdvancedFilters.tsx

### Cursor Prompt 5

```
Add "Lead Score Tiers" as a multi-select filter to `src/components/dashboard/AdvancedFilters.tsx`. Follow the exact pattern of the campaigns multi-select. This filter includes a special "(No Tier)" option for NULL leads.

Make these changes:

1. Add a search state after `campaignSearch`:
   ```typescript
   const [leadScoreTierSearch, setLeadScoreTierSearch] = useState('');
   ```

2. Add a `filteredLeadScoreTiers` useMemo after `filteredCampaigns`. This prepends a synthetic "(No Tier)" option with sentinel value `__NO_TIER__`:
   ```typescript
   const filteredLeadScoreTiers = useMemo(() => {
     if (!filterOptions?.leadScoreTiers) return [];
     const noTierOption = { value: '__NO_TIER__', label: '(No Tier)', isActive: true };
     const realTiers = filterOptions.leadScoreTiers.filter(t =>
       t.label.toLowerCase().includes(leadScoreTierSearch.toLowerCase())
     );
     const showNoTier = !leadScoreTierSearch || 
       '(no tier)'.includes(leadScoreTierSearch.toLowerCase());
     return showNoTier ? [noTierOption, ...realTiers] : realTiers;
   }, [filterOptions, leadScoreTierSearch]);
   ```

3. Add `'leadScoreTiers'` to the filterKey type union in BOTH `handleMultiSelectChange` and `handleSelectAll` function signatures:
   ```typescript
   filterKey: 'channels' | 'sources' | 'sgas' | 'sgms' | 'experimentationTags' | 'campaigns' | 'leadScoreTiers',
   ```

4. In the JSX, after the Campaigns `MultiSelectFilterControl` block and before the closing `</div>` of the Attribution Filters section, add:
   ```tsx
   {/* Lead Score Tiers */}
   <MultiSelectFilterControl
     label="Lead Score Tiers"
     options={filteredLeadScoreTiers.map(t => ({ 
       value: t.value, 
       label: t.label, 
       isActive: true 
     }))}
     filter={localFilters.leadScoreTiers}
     onSelectAll={() => handleSelectAll('leadScoreTiers')}
     onChange={(value, checked) => handleMultiSelectChange('leadScoreTiers', value, checked)}
     searchValue={leadScoreTierSearch}
     onSearchChange={setLeadScoreTierSearch}
     searchable
   />
   ```

IMPORTANT: The sentinel value `__NO_TIER__` must match EXACTLY between this component and filter-helpers.ts. Do not rename it.
```

### Exact Code — `src/components/dashboard/AdvancedFilters.tsx`

**Change 1 — Search state** (after `campaignSearch`):

```typescript
  const [campaignSearch, setCampaignSearch] = useState('');
  const [leadScoreTierSearch, setLeadScoreTierSearch] = useState('');
```

**Change 2 — Filtered memo** (after `filteredCampaigns` useMemo):

```typescript
  const filteredLeadScoreTiers = useMemo(() => {
    if (!filterOptions?.leadScoreTiers) return [];
    const noTierOption = { value: '__NO_TIER__', label: '(No Tier)', isActive: true };
    const realTiers = filterOptions.leadScoreTiers.filter(t =>
      t.label.toLowerCase().includes(leadScoreTierSearch.toLowerCase())
    );
    const showNoTier = !leadScoreTierSearch || 
      '(no tier)'.includes(leadScoreTierSearch.toLowerCase());
    return showNoTier ? [noTierOption, ...realTiers] : realTiers;
  }, [filterOptions, leadScoreTierSearch]);
```

**Change 3 — Type unions**: Update BOTH `handleMultiSelectChange` and `handleSelectAll`:

```typescript
  const handleMultiSelectChange = (
    filterKey: 'channels' | 'sources' | 'sgas' | 'sgms' | 'experimentationTags' | 'campaigns' | 'leadScoreTiers',
```

```typescript
  const handleSelectAll = (filterKey: 'channels' | 'sources' | 'sgas' | 'sgms' | 'experimentationTags' | 'campaigns' | 'leadScoreTiers') => {
```

**Change 4 — JSX** (after the Campaigns MultiSelectFilterControl, before `</div>` of Attribution Filters):

```tsx
                {/* Lead Score Tiers */}
                <MultiSelectFilterControl
                  label="Lead Score Tiers"
                  options={filteredLeadScoreTiers.map(t => ({ 
                    value: t.value, 
                    label: t.label, 
                    isActive: true 
                  }))}
                  filter={localFilters.leadScoreTiers}
                  onSelectAll={() => handleSelectAll('leadScoreTiers')}
                  onChange={(value, checked) => handleMultiSelectChange('leadScoreTiers', value, checked)}
                  searchValue={leadScoreTierSearch}
                  onSearchChange={setLeadScoreTierSearch}
                  searchable
                />
```

### Validation Steps — Phase 5

```bash
# Full compilation check — should now pass clean
npx tsc --noEmit
```

**Expected**: ZERO errors. All types are now aligned. If errors remain, they are likely in files not yet updated (detail-records mapping — Phase 6). Check the error messages carefully.

```bash
npm run lint
```

**Expected**: Zero errors (warnings OK).

```bash
npm run dev
```

**Expected**: Server starts. Load the dashboard in browser.

**Browser validation**:
1. Open the dashboard → click "Advanced Filters" button
2. **Expected**: "Lead Score Tiers" multi-select appears after "Campaigns" in Attribution Filters section
3. The dropdown should show "(No Tier)" at the top, followed by ~14 real tier values (STANDARD, TIER_0A_PRIME_MOVER_DUE, etc.)
4. "Select All" should be checked by default
5. Type "PRIME" in the search box → only PRIME_MOVER tiers should show; "(No Tier)" should hide
6. Clear search → "(No Tier)" reappears at the top
7. Uncheck "All" → check "TIER_1_PRIME_MOVER" → click Apply → dashboard should filter
8. Active filter count badge should show 1 (or increment by 1)

**API validation** (browser DevTools → Network):
- Find the `/api/dashboard/filters` request
- Response should include `"leadScoreTiers"` array with ~14 objects
- Each object should have `value`, `label`, `isActive`, `count`
- Compare `value` list to the BQ query output from Phase 3 validation — they should match exactly

---

## Phase 6: Detail Records Table

### Cursor Prompt 6

```
Add "Lead Score Tier" as a visible column in the detail records table. Make these changes:

1. In `src/types/bigquery-raw.ts`:
   a. Add `lead_score_tier?: string | null` to the `RawDetailRecordResult` interface (after `campaign_name`).

2. In `src/lib/queries/detail-records.ts`:
   a. Add `v.Lead_Score_Tier__c as lead_score_tier` to the SELECT clause (after `v.Campaign_Name__c as campaign_name` — use the same alias pattern as campaign).
   b. In the result-to-DetailRecord mapping, add after campaignName:
      ```typescript
      leadScoreTier: r.lead_score_tier ? toString(r.lead_score_tier) : null,
      ```
      (Use the alias `r.lead_score_tier` and the same optional-toString pattern as campaignName.)

3. In `src/components/dashboard/DetailRecordsTable.tsx`:
   a. Add `'tier'` to the SortColumn type union.
   b. Add a sort case for `'tier'` in **both** places: (i) the standalone `sortRecords` function, and (ii) the useMemo that sorts `filteredRecords` (the one that uses `getDisplayDate`). Use the same comparison style as `'campaign'`:
      ```typescript
      case 'tier':
        comparison = (a.leadScoreTier || '').toLowerCase().localeCompare((b.leadScoreTier || '').toLowerCase());
        break;
      ```
   c. Add a SortableHeader for "Lead Score Tier" after the Campaign column header. **Use children for the label** (no `label`/`currentSort`/`onSort` props): `<SortableHeader column="tier">Lead Score Tier</SortableHeader>`.
   d. Add a **TableCell** (Tremor) in the row after the Campaign cell, with the same className as the Campaign cell: `className="border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400"` and content `{record.leadScoreTier || '-'}`.

4. In `src/components/dashboard/ExploreResults.tsx`:
   In the drill-down where DetailRecord objects are built from API rows, add after the campaignName line:
   ```typescript
   const leadScoreTier = (row.lead_score_tier as string) || (row.Lead_Score_Tier__c as string) || null;
   ```
   And include `leadScoreTier` in the returned DetailRecord object.

Match the exact component patterns: SortableHeader uses **children**; table cells use **TableCell** from Tremor, not raw `<td>`.
```

### Exact Code — `src/types/bigquery-raw.ts`

**RawDetailRecordResult** — find `campaign_name?: string | null` and add after it:

```typescript
  campaign_name?: string | null;
  lead_score_tier?: string | null;
```

### Exact Code — `src/lib/queries/detail-records.ts`

**SELECT clause** — find `v.Campaign_Name__c as campaign_name` and add after it (use alias to match pattern):

```typescript
    v.Campaign_Name__c as campaign_name,
    v.Lead_Score_Tier__c as lead_score_tier,
```

**Result mapping** — find where `campaignName` is mapped (e.g. `campaignName: r.campaign_name ? toString(r.campaign_name) : null`) and add after it:

```typescript
      campaignName: r.campaign_name ? toString(r.campaign_name) : null,
      leadScoreTier: r.lead_score_tier ? toString(r.lead_score_tier) : null,
```

> **Note**: Use the alias `r.lead_score_tier`; do not reference `r.Lead_Score_Tier__c` in the mapping.

### Exact Code — `src/components/dashboard/DetailRecordsTable.tsx`

**SortColumn type** — add `'tier'` to the union:

```typescript
type SortColumn = 'advisor' | 'source' | 'channel' | 'stage' | 'date' | 'sga' | 'sgm' | 'aum' | 'campaign' | 'tier' | null;
```

**Sort case** — add in **both** the standalone `sortRecords` function and the useMemo that sorts `filteredRecords`. Find `case 'campaign':` and add after its `break;` in each:

```typescript
      case 'tier':
        comparison = (a.leadScoreTier || '').toLowerCase().localeCompare((b.leadScoreTier || '').toLowerCase());
        break;
```

**Table header** — find the Campaign SortableHeader (e.g. `<SortableHeader column="campaign">Campaign</SortableHeader>`) and add after it. **Use children for the label** — SortableHeader does not take `label`/`currentSort`/`onSort`:

```tsx
              <SortableHeader column="tier">Lead Score Tier</SortableHeader>
```

**Table cell** — find the Campaign **TableCell** (e.g. `{record.campaignName || '-'}`) and add a TableCell after it with the same className:

```tsx
                <TableCell className="border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">{record.leadScoreTier || '-'}</TableCell>
```

**Empty state row** — if the table has a "no results" row with `colSpan`, increment the base number by 1 (e.g. `colSpan={10 + ...}` → `colSpan={11 + ...}`) so it spans the new tier column.

> **Note**: Use Tremor's `TableCell`, not raw `<td>`. Match the Campaign cell's className exactly.

### Exact Code — `src/components/dashboard/ExploreResults.tsx`

Find the `campaignName` variable in the drill-down record builder (where DetailRecord objects are built from API rows) and add after it:

```typescript
          const campaignName = (row.campaign_name as string) || (row.Campaign_Name__c as string) || null;
          const leadScoreTier = (row.lead_score_tier as string) || (row.Lead_Score_Tier__c as string) || null;
```

In the returned DetailRecord object, add `leadScoreTier` after `campaignName` (same block):

```typescript
            campaignName,
            leadScoreTier,
```

### Validation Steps — Phase 6

```bash
npx tsc --noEmit
```

**Expected**: ZERO errors across the entire project.

```bash
npm run lint
```

**Expected**: Zero errors.

```bash
npm run dev
```

**Browser validation**:
1. Load dashboard → open Detail Records table
2. **Expected**: "Lead Score Tier" column visible after "Campaign"
3. Filter to Campaign = "Scored List January 2026"
4. Rows should show tier values (e.g. "TIER_1_PRIME_MOVER", "TIER_3_MODERATE_BLEEDER")
5. Click the "Lead Score Tier" column header → rows should sort alphabetically by tier
6. Rows without a tier should show "-"

---

## Phase 7: Semantic Layer Polish

### Cursor Prompt 7

```
Add example questions mentioning lead score tier to the semantic layer query templates in `src/lib/semantic-layer/query-templates.ts`.

1. Find `conversion_by_dimension` → `exampleQuestions` array. Add this string to the end of the array:
   ```
   'Contacted to MQL rate by lead score tier'
   ```

2. Find `metric_by_dimension` → `exampleQuestions` array. Add this string to the end:
   ```
   'MQLs by lead score tier'
   ```

These are just example questions to help the AI agent recognize that lead_score_tier is a valid dimension for these templates. The dimension itself is already defined in definitions.ts — no changes needed there.
```

### Exact Code — `src/lib/semantic-layer/query-templates.ts`

**conversion_by_dimension.exampleQuestions** — add to end of array:

```typescript
    exampleQuestions: [
      'SQL to SQO conversion by channel',
      'MQL to SQL rate by source',
      'Conversion rates by SGA',
      'Win rate by SGM',
      'Contacted to MQL rate by lead score tier',
    ],
```

**metric_by_dimension.exampleQuestions** — add to end of array:

```typescript
      'MQLs by lead score tier',
```

### Validation Steps — Phase 7

```bash
npx tsc --noEmit && npm run lint
```

**Expected**: Zero errors.

**AI agent validation** (if Explore/chat is available):
- Ask: "What is the Contacted to MQL rate by lead score tier?"
- **Expected**: Agent compiles a query grouping by `v.Lead_Score_Tier__c` and returns results
- NULL tiers appear as one group (dimension_value = null)

---

## Phase 8: End-to-End Validation

### Cursor Prompt 8 (Validation Only — No Code Changes)

```
Run the following validation steps and confirm each one passes. Do NOT make any code changes in this phase.

1. Full TypeScript compilation:
   ```bash
   npx tsc --noEmit
   ```
   MUST return zero errors.

2. Linting:
   ```bash
   npm run lint
   ```
   MUST return zero errors.

3. Dev server startup:
   ```bash
   npm run dev
   ```
   Server MUST start without crashes.

4. Check browser console for errors after loading the dashboard.
   MUST have zero red errors.

5. Verify filter options API response includes leadScoreTiers.
```

### Manual Test Checklist

Run each test and mark pass/fail:

**Test 1: Filter Options API**
- [ ] Load dashboard → DevTools → Network → find `/api/dashboard/filters`
- [ ] Response includes `leadScoreTiers` array with ~14 entries
- [ ] Each entry has `value`, `label`, `isActive: true`, `count`

**Test 2: Tier Filter — Single Tier**
- [ ] Set Campaign (global) = "Scored List January 2026"
- [ ] Open Advanced Filters → Lead Score Tiers → uncheck All → check only "TIER_1_PRIME_MOVER" → Apply
- [ ] Dashboard metrics change (narrower population)
- [ ] Contacted→MQL rate card shows a value

**Test 3: Tier Filter — "(No Tier)"**
- [ ] Reset all filters
- [ ] Open Advanced Filters → Lead Score Tiers → uncheck All → check only "(No Tier)" → Apply
- [ ] Dashboard shows metrics for ~92,970 unscored leads
- [ ] Contacted→MQL rate reflects unscored population

**Test 4: Tier Filter — Multiple Tiers + "(No Tier)"**
- [ ] Open Advanced Filters → Lead Score Tiers → uncheck All → check "TIER_1_PRIME_MOVER" AND "(No Tier)" → Apply
- [ ] Dashboard shows combined metrics for both populations
- [ ] This tests the OR branch in the WHERE clause

**Test 5: Detail Records Table**
- [ ] Filter to Campaign = "Scored List January 2026"
- [ ] Open Detail Records table
- [ ] "Lead Score Tier" column is visible after Campaign
- [ ] Rows show real tier values; non-scored rows show "-"
- [ ] Column is sortable (click header)

**Test 6: Active Filter Count**
- [ ] Select specific tiers in Advanced Filters → Apply
- [ ] Advanced Filters button badge shows correct count

**Test 7: Reset**
- [ ] Click "Reset All" in Advanced Filters
- [ ] Lead Score Tiers reverts to "All"
- [ ] Dashboard shows full unfiltered data

### BQ Cross-Validation

Run this via MCP and compare to what the dashboard shows when Campaign = "Scored List January 2026" and Lead Score Tier = "TIER_1_PRIME_MOVER":

```sql
SELECT
  SUM(contacted_to_mql_progression) AS numerator,
  SUM(eligible_for_contacted_conversions_30d) AS denominator,
  SAFE_DIVIDE(SUM(contacted_to_mql_progression), 
              SUM(eligible_for_contacted_conversions_30d)) * 100 AS rate_pct
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE (
  v.Campaign_Id__c = '701VS00000ZtS4NYAV'
  OR EXISTS (SELECT 1 FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp 
             WHERE camp.id = '701VS00000ZtS4NYAV')
)
AND v.Lead_Score_Tier__c = 'TIER_1_PRIME_MOVER';
```

**Dashboard value MUST match BQ value** (within rounding).

Run the full tier breakdown to confirm all tiers are accessible:

```sql
SELECT
  v.Lead_Score_Tier__c AS tier,
  COUNT(*) AS row_count,
  SUM(v.is_contacted) AS contacted,
  SUM(v.is_mql) AS mql,
  SUM(v.contacted_to_mql_progression) AS progression,
  SUM(v.eligible_for_contacted_conversions_30d) AS eligible_30d,
  SAFE_DIVIDE(SUM(v.contacted_to_mql_progression), 
              SUM(v.eligible_for_contacted_conversions_30d)) * 100 AS rate_pct
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE EXISTS (SELECT 1 FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp 
             WHERE camp.id = '701VS00000ZtS4NYAV')
   OR v.Campaign_Id__c = '701VS00000ZtS4NYAV'
GROUP BY v.Lead_Score_Tier__c
ORDER BY row_count DESC;
```

---

## Complete File Change Map

| # | File | Changes |
|---|------|---------|
| 1 | `src/types/filters.ts` | Add `leadScoreTiers` to: AdvancedFilters, DEFAULT_ADVANCED_FILTERS, hasActive, countActive, FilterOptions |
| 2 | `src/types/dashboard.ts` | Add `leadScoreTier: string \| null` to DetailRecord |
| 3 | `src/app/dashboard/page.tsx` | Add `leadScoreTiers` merge + compare in `filtersAreEqual` |
| 4 | `src/lib/queries/filter-options.ts` | Add LeadScoreTierResult, query, Promise.all slot, return mapping |
| 5 | `src/app/api/dashboard/filters/route.ts` | Add `leadScoreTiers` to filterOptions response |
| 6 | `src/lib/utils/filter-helpers.ts` | Add leadScoreTiers to safeFilters, WHERE clause block with NULL sentinel, hasActiveFilters |
| 7 | `src/components/dashboard/AdvancedFilters.tsx` | Add search state, filteredLeadScoreTiers memo, type unions, MultiSelectFilterControl |
| 8 | `src/types/bigquery-raw.ts` | Add `lead_score_tier?: string \| null` to RawDetailRecordResult |
| 9 | `src/lib/queries/detail-records.ts` | Add `v.Lead_Score_Tier__c as lead_score_tier` to SELECT; add leadScoreTier mapping using `r.lead_score_tier` |
| 10 | `src/components/dashboard/DetailRecordsTable.tsx` | Add 'tier' to SortColumn; add sort case in both sortRecords and useMemo; SortableHeader (children); TableCell |
| 11 | `src/components/dashboard/ExploreResults.tsx` | Add leadScoreTier variable and include in drill-down DetailRecord object |
| 12 | `src/lib/semantic-layer/query-templates.ts` | Add example questions mentioning lead score tier |

### Files That Do NOT Need Changes

| File | Reason |
|------|--------|
| `views/vw_funnel_master.sql` | Lead_Score_Tier__c already in view |
| `src/lib/semantic-layer/definitions.ts` | lead_score_tier dimension already exists |
| `src/lib/semantic-layer/query-compiler.ts` | Standard dimension filter handles it |
| `src/lib/queries/funnel-metrics.ts` | Uses buildAdvancedFilterClauses — auto-propagates |
| `src/lib/queries/conversion-rates.ts` | Same — auto-propagates |
| `src/lib/queries/source-performance.ts` | Same — auto-propagates |
| `src/lib/queries/record-detail.ts` | Already selects and maps Lead_Score_Tier__c |
| `src/components/dashboard/RecordDetailModal.tsx` | Already displays Lead Score Tier DetailRow |
| `src/components/dashboard/GlobalFilters.tsx` | No global filter (advanced only) |

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `leadScoreTiers` missing from API | filter-options.ts or route.ts not updated | Check Phases 2-3 |
| Empty dropdown | BQ query returns no rows | Check FULL_TABLE constant and query syntax |
| "(No Tier)" not appearing | filteredLeadScoreTiers memo wrong | Check Phase 5 Step 5.2 |
| Filter doesn't affect data | filter-helpers block not added | Check Phase 4 Step 4.2 |
| `Property 'leadScoreTiers' does not exist` | Missing from AdvancedFilters or DEFAULT | Check Phase 1 |
| Detail table crashes | DetailRecord missing leadScoreTier | Check Phase 1B and Phase 6 |
| filtersAreEqual always true/false | page.tsx not updated | Check Phase 1B |
| BQ param error | Param name mismatch | Ensure `${paramPrefix}_lead_score_tiers` is consistent |
| "(No Tier)" selects everything | Sentinel `__NO_TIER__` doesn't match | Must be identical string in AdvancedFilters.tsx and filter-helpers.ts |
