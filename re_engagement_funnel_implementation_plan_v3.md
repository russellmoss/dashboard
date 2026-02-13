# Implementation Plan: Re-Engagement Opportunities as Funnel "Leads" (Option A)

**Purpose:** Treat Re-Engagement opportunities as a parallel lead-like stream inside `vw_funnel_master` so they count in prospect → contacted → MQL → SQL volumes and conversion rates, then flow into a new Recruiting opportunity for SQO → Signed → Joined — while preserving the link back to the original closed-lost opportunity for full record history in drilldowns.

**Date:** 2026-02-11 (v3 — Final, ready for agentic execution)

**Key files:**
- View: `views/vw_funnel_master.sql` → deployed to `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
- Detail records query: `src/lib/queries/detail-records.ts`
- Record detail query: `src/lib/queries/record-detail.ts`
- Types: `src/types/dashboard.ts`, `src/types/bigquery-raw.ts`, `src/types/record-detail.ts`
- Modal: `src/components/dashboard/RecordDetailModal.tsx`
- Explore mapping: `src/components/dashboard/ExploreResults.tsx`

---

## Stage Mapping (Reference)

| Re-Engagement Stage | Funnel Equivalent | vw_funnel_master Field It Maps To |
|---|---|---|
| Planned Nurture (created) | **Prospect** | `FilterDate` |
| Outreach | **Contacted** | `stage_entered_contacting__c` |
| Call Scheduled | **MQL** | `mql_stage_entered_ts` |
| ~~Engaged~~ | *(ignored)* | — |
| Re-Engaged → new Recruiting opp created | **SQL** | `converted_date_raw` / `is_sql` |
| *(New Recruiting opp takes over)* | SQO → Signed → Joined | Existing Opp_Base logic |

---

## Phase 1: Salesforce & BigQuery Prerequisites (MANUAL — not agentic)

> **These steps require Salesforce Setup and BQ connector access. An agent cannot execute them. Complete all before starting Phase 2.**

### 1.1 Confirm Stage-Entered Timestamps Are Populating

The six `Stage_Entered_*` fields for Re-Engagement stages already exist in the BQ schema:

- `Stage_Entered_Planned_Nurture__c`
- `Stage_Entered_Outreach__c`
- `Stage_Entered_Call_Scheduled__c`
- `Stage_Entered_Engaged__c`
- `Stage_Entered_Re_Engaged__c`
- `Stage_Entered_Closed__c`

**Problem:** Only ~22.7% of Re-Engagement records have any stage-entered date populated, and almost all of that is `Stage_Entered_Closed__c`. The others are 0–0.4%.

**Action items:**

1. Confirm the Salesforce Flow that stamps these fields on stage change is live and working. If not, build or fix it. This is the Record-Triggered Flow on Opportunity that fires when `StageName` changes and `RecordTypeId` = Re-Engagement (`012VS000009VoxrYAC`). It should set the corresponding `Stage_Entered_*` field to `NOW()` if that field is currently null.
2. Verify these fields are syncing to BigQuery via your existing connector (Fivetran, HVR, or equivalent). They're already in the BQ schema, so they should be syncing — but confirm with a recently-updated Re-Engagement record.
3. **Decision: backfill or not.** For the ~617 historical Re-Engagement records with no stage-entered dates:
   - **No backfill (recommended to start):** Historical re-engagement records will appear as prospects only (no contacted/MQL/SQL progression). They'll still show up in prospect counts by `FilterDate` (which falls back to `CreatedDate`). Going forward, new records get proper timestamps.
   - **Partial backfill:** For records currently sitting in Outreach, Call Scheduled, Engaged, or Re-Engaged, you could backfill `Stage_Entered_*` from `LastStageChangeDate` as an approximation.

### 1.2 Confirm Conversion Linking Fields Are Syncing

The bidirectional linking fields already exist and are confirmed in BQ (2 records have them set per the 2026-02-11 validated exploration doc):

- **On Re-Engagement opp:** `Created_Recruiting_Opportunity_ID__c` → Id of the new Recruiting opp
- **On new Recruiting opp:** `Source_Re_Engagement_Opportunity_ID__c` → Id of the Re-Engagement opp it came from

**Action items:**

1. Confirm the Re-Engagement → Recruiting conversion Flow (`docs/flows/new_flows/Re_Engagement_Conversion_to_Recruiting.flow-meta.xml`) is deployed and active in production.
2. Confirm both linking fields sync to BQ. Verify with the 2 existing converted records (e.g., Scott Sadler: Re-Engagement `006VS00000VL1m5YAD` → Recruiting `006VS00000X00oFYAR`).

### 1.3 Confirm `Conversion_Channel__c` = 'Re-Engagement' on New Recruiting Opps

**Action:** Verify this is set in the conversion Flow and that the picklist value exists in Salesforce.

### 1.4 Add `CampaignId` (Primary Campaign Source) to Re-Engagement Page Layout

**Finding:** 0% of Re-Engagement opps have `CampaignId` populated. The field exists at the object level and is already in BQ, but it's not on the page layout.

**Action:** Add the `Campaign` (Primary Campaign Source) field to the Re-Engagement Opportunity page layout in Salesforce Setup. No schema or BQ changes needed. Note: this won't be manually filled out — it will be populated when RevOps adds Contacts to campaigns. The primary campaign attribution path for Re-Engagement is through `all_campaigns` (CampaignMember via Contact), not this field. But having it on the layout allows manual override if needed.

### 1.5 Investigate/Fix `ContactId` Population on Re-Engagement Opps

**Finding:** Only 48.6% (388 of 798) Re-Engagement opps have `ContactId` populated. Campaign membership via Contact only works for those 388.

**Action:** Investigate why half have no Contact. If the Re-Engagement creation Flow isn't copying `ContactId` from the closed-lost Recruiting opp, fix it. Going forward, the Flow should always populate ContactId.

---

## Phase 2: Modify `vw_funnel_master` (AGENTIC)

> **File:** `views/vw_funnel_master.sql`
> **Deploy target:** `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
>
> **Execution order:** Perform steps in this order so CTEs exist before they are referenced: **2.1 → 2.6 → 2.2 → 2.3 → 2.4 → 2.5 → 2.7**. (2.6 must come before 2.5 because Combined references the two campaign CTEs.)

Four things happen to the view:

1. Add three columns to `Lead_Base`; split `Campaign_Member_Agg` into two CTEs (By_Lead and By_Contact).
2. Add `ReEngagement_As_Lead` CTE and `All_Leads` (UNION with Lead_Base).
3. Remove Re-Engagement from `Opp_Base` (Recruiting only).
4. Update `Combined` to use `All_Leads` and the two campaign CTEs; add new columns; remove TODO.
5. Clean up `Final` CTE.

### 2.1 Add Three New Columns to `Lead_Base`

**Location:** In the `Lead_Base` CTE SELECT, insert these three columns **after** `lead_closed_date` (column #23) and **before** `Lead_FilterDate` (column #24):

```sql
    -- Re-Engagement columns (NULL for real Leads; needed for UNION schema alignment)
    CAST(NULL AS STRING) AS Previous_Recruiting_Opportunity_ID__c,
    CAST(NULL AS STRING) AS ContactId,
    'Lead' AS lead_record_source,

    -- FilterDate: Handles recycled leads ... (existing Lead_FilterDate line)
```

After this change, `Lead_Base` has **27 columns** in this exact order:

1. `Full_prospect_id__c`
2. `Prospect_Name`
3. `converted_oppty_id`
4. `CreatedDate`
5. `Lead_OwnerId`
6. `Lead_Original_Source`
7. `Final_Source`
8. `Lead_Finance_View__c`
9. `stage_entered_contacting__c`
10. `mql_stage_entered_ts`
11. `converted_date_raw`
12. `IsConverted`
13. `Disposition__c`
14. `DoNotCall`
15. `stage_entered_new__c`
16. `Lead_Experimentation_Tag__c`
17. `Lead_Campaign_Id__c`
18. `Lead_Score_Tier__c`
19. `Lead_External_Agency__c`
20. `Lead_SGA_Owner_Name__c`
21. `Lead_Next_Steps__c`
22. `Initial_Call_Scheduled_Date__c`
23. `lead_closed_date`
24. **`Previous_Recruiting_Opportunity_ID__c`** ← NEW
25. **`ContactId`** ← NEW
26. **`lead_record_source`** ← NEW
27. `Lead_FilterDate`

### 2.2 Add `ReEngagement_As_Lead` CTE

Insert this CTE **after** `Campaign_Member_Agg_By_Contact` (see 2.6) and **before** `Opp_Base`. The column order **must match** `Lead_Base` exactly (27 columns, same aliases, same positions):

```sql
ReEngagement_As_Lead AS (
  SELECT
    -- 1. Full_prospect_id__c
    Full_Opportunity_ID__c AS Full_prospect_id__c,
    -- 2. Prospect_Name
    Name AS Prospect_Name,
    -- 3. converted_oppty_id (NEW Recruiting opp created on conversion)
    Created_Recruiting_Opportunity_ID__c AS converted_oppty_id,
    -- 4. CreatedDate
    CreatedDate,
    -- 5. Lead_OwnerId
    OwnerId AS Lead_OwnerId,
    -- 6. Lead_Original_Source
    Final_Source__c AS Lead_Original_Source,
    -- 7. Final_Source
    Final_Source__c AS Final_Source,
    -- 8. Lead_Finance_View__c
    Finance_View__c AS Lead_Finance_View__c,

    -- ════════════════════════════════════════════════════════════════
    -- STAGE MAPPING: Re-Engagement stages → Lead funnel date fields
    -- ════════════════════════════════════════════════════════════════
    -- 9. stage_entered_contacting__c (Outreach → Contacted)
    Stage_Entered_Outreach__c AS stage_entered_contacting__c,
    -- 10. mql_stage_entered_ts (Call Scheduled → MQL)
    Stage_Entered_Call_Scheduled__c AS mql_stage_entered_ts,
    -- 11. converted_date_raw (Re-Engaged → SQL)
    Stage_Entered_Re_Engaged__c AS converted_date_raw,
    -- 12. IsConverted (TRUE when conversion link to new Recruiting opp exists)
    CASE
      WHEN Created_Recruiting_Opportunity_ID__c IS NOT NULL THEN TRUE
      ELSE FALSE
    END AS IsConverted,

    -- 13. Disposition__c (not applicable)
    CAST(NULL AS STRING) AS Disposition__c,
    -- 14. DoNotCall (not applicable)
    FALSE AS DoNotCall,
    -- 15. stage_entered_new__c (Planned Nurture or CreatedDate)
    COALESCE(Stage_Entered_Planned_Nurture__c, CreatedDate) AS stage_entered_new__c,

    -- 16. Lead_Experimentation_Tag__c
    Experimentation_Tag__c AS Lead_Experimentation_Tag__c,
    -- 17. Lead_Campaign_Id__c
    CampaignId AS Lead_Campaign_Id__c,
    -- 18. Lead_Score_Tier__c (not applicable)
    CAST(NULL AS STRING) AS Lead_Score_Tier__c,
    -- 19. Lead_External_Agency__c
    External_Agency__c AS Lead_External_Agency__c,
    -- 20. Lead_SGA_Owner_Name__c
    Opportunity_Owner_Name__c AS Lead_SGA_Owner_Name__c,
    -- 21. Lead_Next_Steps__c (not applicable)
    CAST(NULL AS STRING) AS Lead_Next_Steps__c,
    -- 22. Initial_Call_Scheduled_Date__c (not applicable)
    CAST(NULL AS DATE) AS Initial_Call_Scheduled_Date__c,
    -- 23. lead_closed_date
    Stage_Entered_Closed__c AS lead_closed_date,

    -- 24. Previous_Recruiting_Opportunity_ID__c (origin link for drilldown)
    Previous_Recruiting_Opportunity_ID__c,
    -- 25. ContactId (for campaign membership join)
    ContactId,
    -- 26. lead_record_source (marker for Re-Engagement vs Lead)
    'Re-Engagement' AS lead_record_source,

    -- 27. Lead_FilterDate
    GREATEST(
      IFNULL(CreatedDate, TIMESTAMP('1900-01-01')),
      IFNULL(Stage_Entered_Planned_Nurture__c, TIMESTAMP('1900-01-01')),
      IFNULL(Stage_Entered_Outreach__c, TIMESTAMP('1900-01-01'))
    ) AS Lead_FilterDate

  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
  WHERE RecordTypeId = '012VS000009VoxrYAC'
    AND (IsDeleted IS NULL OR IsDeleted = FALSE)
),
```

### 2.3 Create `All_Leads` CTE (UNION)

Insert **after** `ReEngagement_As_Lead`, **before** `Opp_Base`:

```sql
All_Leads AS (
  SELECT * FROM Lead_Base
  UNION ALL
  SELECT * FROM ReEngagement_As_Lead
),
```

### 2.4 Modify `Opp_Base` — Recruiting Only

```sql
-- BEFORE:
WHERE RecordTypeId IN ('012Dn000000mrO3IAI', '012VS000009VoxrYAC')

-- AFTER:
WHERE RecordTypeId = '012Dn000000mrO3IAI'  -- Recruiting only
```

### 2.5 Modify `Combined` CTE — Use `All_Leads` + New Columns + Campaign Joins

**Prerequisite:** Complete step **2.6** first (Combined references `Campaign_Member_Agg_By_Lead` and `Campaign_Member_Agg_By_Contact`).

**Change the FROM clause:**

```sql
-- BEFORE:
  FROM Lead_Base l
  FULL OUTER JOIN Opp_Base o
    ON l.converted_oppty_id = o.Full_Opportunity_ID__c
  LEFT JOIN Campaign_Member_Agg cma
    ON cma.LeadId = l.Full_prospect_id__c

-- AFTER:
  FROM All_Leads l
  FULL OUTER JOIN Opp_Base o
    ON l.converted_oppty_id = o.Full_Opportunity_ID__c
  LEFT JOIN Campaign_Member_Agg_By_Lead cma_lead
    ON cma_lead.LeadId = l.Full_prospect_id__c
  LEFT JOIN Campaign_Member_Agg_By_Contact cma_contact
    ON cma_contact.ContactId = l.ContactId
    AND l.lead_record_source = 'Re-Engagement'
```

**Update `all_campaigns` in the SELECT:**

```sql
-- BEFORE:
    cma.all_campaigns AS all_campaigns,

-- AFTER:
    COALESCE(cma_lead.all_campaigns, cma_contact.all_campaigns) AS all_campaigns,
```

**Add new columns to the `Combined` SELECT** (e.g. after the existing `l.Lead_Score_Tier__c` line):

```sql
    -- Re-Engagement origin link (for drilldown)
    l.Previous_Recruiting_Opportunity_ID__c,

    -- Source type marker (Lead vs Re-Engagement)
    l.lead_record_source,

    -- Origin opportunity URL for drilldown
    CASE
      WHEN l.Previous_Recruiting_Opportunity_ID__c IS NOT NULL
      THEN CONCAT(
        'https://savvywealth.lightning.force.com/lightning/r/Opportunity/',
        l.Previous_Recruiting_Opportunity_ID__c,
        '/view'
      )
      ELSE NULL
    END AS origin_opportunity_url,
```

**Remove the TODO comment** (lines 203–204):

```sql
-- DELETE THESE LINES:
    --##TODO## In the future we may need to create a view of re-engagement opportunities and have them look like
    -- 'leads' where they 'convert' into Recruiting Type Opportunities.
```

### 2.6 Campaign Membership: Split Into Two CTEs

**Do this step before 2.5** — Combined (2.5) references these two CTEs.

**Replace** the current single `Campaign_Member_Agg` CTE with two CTEs. Place them where `Campaign_Member_Agg` currently sits (after `Lead_Base`, before `ReEngagement_As_Lead`):

```sql
-- Campaign memberships by Lead (unchanged behavior for Lead-based prospects)
Campaign_Member_Agg_By_Lead AS (
  SELECT
    LeadId,
    ARRAY_AGG(STRUCT(CampaignId AS id, CampaignName AS name) ORDER BY CampaignId) AS all_campaigns
  FROM (
    SELECT DISTINCT
      cm.LeadId,
      cm.CampaignId,
      c.Name AS CampaignName
    FROM `savvy-gtm-analytics.SavvyGTMData.CampaignMember` cm
    LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.Campaign` c
      ON c.Id = cm.CampaignId AND c.IsDeleted = FALSE
    WHERE cm.IsDeleted = FALSE
      AND cm.LeadId IS NOT NULL
      AND cm.CampaignId IS NOT NULL
  )
  GROUP BY LeadId
),

-- Campaign memberships by Contact (for Re-Engagement opps; no Lead in funnel row)
Campaign_Member_Agg_By_Contact AS (
  SELECT
    ContactId,
    ARRAY_AGG(STRUCT(CampaignId AS id, CampaignName AS name) ORDER BY CampaignId) AS all_campaigns
  FROM (
    SELECT DISTINCT
      cm.ContactId,
      cm.CampaignId,
      c.Name AS CampaignName
    FROM `savvy-gtm-analytics.SavvyGTMData.CampaignMember` cm
    LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.Campaign` c
      ON c.Id = cm.CampaignId AND c.IsDeleted = FALSE
    WHERE cm.IsDeleted = FALSE
      AND cm.ContactId IS NOT NULL
      AND cm.CampaignId IS NOT NULL
  )
  GROUP BY ContactId
),
```

**How duplication is prevented:**

| Row type | `cma_lead` join | `cma_contact` join | `all_campaigns` |
|---|---|---|---|
| Real Lead (`lead_record_source = 'Lead'`) | Matches on LeadId | Blocked by `lead_record_source = 'Re-Engagement'` gate → NULL | Lead's campaigns |
| Re-Engagement (`lead_record_source = 'Re-Engagement'`) | Opp Id never matches CampaignMember.LeadId → NULL | Matches on ContactId (if populated) | Contact's campaigns |

### 2.7 Clean Up `Final` CTE

**In the `Final` CTE** (source CTE is `With_Campaign_Name`, aliased `wsl`):

**Remove the Planned Nurture StageName_code:**

```sql
-- DELETE THIS LINE:
      WHEN StageName = 'Planned Nurture' THEN 9
```

**Update `record_type_name` and add `prospect_source_type`:**

```sql
-- BEFORE:
    CASE
      WHEN recordtypeid = '012Dn000000mrO3IAI' THEN 'Recruiting'
      WHEN recordtypeid = '012VS000009VoxrYAC' THEN 'Re-Engagement'
      ELSE 'Unknown'
    END AS record_type_name,

-- AFTER:
    CASE
      WHEN recordtypeid = '012Dn000000mrO3IAI' THEN 'Recruiting'
      ELSE 'Unknown'
    END AS record_type_name,

    -- Source pathway: Lead or Re-Engagement
    -- NOTE: Use wsl. prefix (Final CTE reads from With_Campaign_Name aliased wsl), NOT l.
    wsl.lead_record_source AS prospect_source_type,
```

> **IMPORTANT:** The `Final` CTE references `With_Campaign_Name` (aliased `wsl`), **not** `l` or `o`. Any reference to `lead_record_source`, `Previous_Recruiting_Opportunity_ID__c`, or `origin_opportunity_url` in the Final SELECT must use `wsl.` prefix (or unqualified, since there's only one source).

---

## Phase 3: Dashboard Code Changes (AGENTIC)

Two separate data paths need extending:
1. **Detail records table** — uses `DetailRecord` type from `detail-records.ts` query
2. **Record detail modal** — uses `RecordDetailFull` type from `record-detail.ts` query

### 3.1 No Changes Needed (Automatic)

These query files read the same flags and date fields. Re-Engagement records automatically flow into counts. **No code changes required:**

- `src/lib/queries/funnel-metrics.ts`
- `src/lib/queries/conversion-rates.ts`
- `src/lib/queries/source-performance.ts`
- `src/lib/semantic-layer/definitions.ts`

### 3.2 Detail Records Table — Extend Query, Types, and Mapping

**Three files, four changes:**

#### 3.2a Add columns to the SQL SELECT

**File:** `src/lib/queries/detail-records.ts` (around lines 219–252, with other `v.*` columns)

Add:

```sql
v.lead_record_source AS prospect_source_type,
v.Previous_Recruiting_Opportunity_ID__c AS origin_recruiting_opp_id,
v.origin_opportunity_url,
```

#### 3.2b Extend `RawDetailRecordResult`

**File:** `src/types/bigquery-raw.ts` (after `opportunity_id` field, around line 98)

Add:

```ts
  prospect_source_type?: string | null;
  origin_recruiting_opp_id?: string | null;
  origin_opportunity_url?: string | null;
```

#### 3.2c Extend `DetailRecord`

**File:** `src/types/dashboard.ts` (after `opportunityId` field, around line 155)

Add:

```ts
  prospectSourceType: string | null;    // 'Lead' | 'Re-Engagement'
  originRecruitingOppId: string | null; // Previous_Recruiting_Opportunity_ID__c
  originOpportunityUrl: string | null;  // URL to original closed-lost opp
```

#### 3.2d Extend the mapping

**File:** `src/lib/queries/detail-records.ts` — in the `return { ... }` block (around lines 310–346, after `opportunityId`)

Add:

```ts
  prospectSourceType: r.prospect_source_type ? toString(r.prospect_source_type) : null,
  originRecruitingOppId: r.origin_recruiting_opp_id ? toString(r.origin_recruiting_opp_id) : null,
  originOpportunityUrl: r.origin_opportunity_url ? toString(r.origin_opportunity_url) : null,
```

### 3.3 Record Detail Modal — Extend Query, Types, and UI

The modal uses `RecordDetailFull` (from `@/types/record-detail`), **not** `DetailRecord`. The data flows through `src/lib/queries/record-detail.ts` → record-detail API route → `RecordDetailModal.tsx`. All three need the new fields.

#### 3.3a Extend `RecordDetailFull` and `RecordDetailRaw`

**File:** `src/types/record-detail.ts`

Add to `RecordDetailRaw` (snake_case):

```ts
  prospect_source_type?: string | null;
  origin_recruiting_opp_id?: string | null;
  origin_opportunity_url?: string | null;
```

Add to `RecordDetailFull` (camelCase):

```ts
  prospectSourceType: string | null;
  originRecruitingOppId: string | null;
  originOpportunityUrl: string | null;
```

#### 3.3b Extend record-detail query SELECT and mapping

**File:** `src/lib/queries/record-detail.ts`

Add to the SQL SELECT (after `v.salesforce_url` — add a comma after `v.salesforce_url` then add these three lines):

```sql
v.lead_record_source AS prospect_source_type,
v.Previous_Recruiting_Opportunity_ID__c AS origin_recruiting_opp_id,
v.origin_opportunity_url,
```

Add to the **`transformToRecordDetail`** return object (after `isJoinedUnique`, before the closing `};`):

```ts
  prospectSourceType: r.prospect_source_type ? toString(r.prospect_source_type) : null,
  originRecruitingOppId: r.origin_recruiting_opp_id ? toString(r.origin_recruiting_opp_id) : null,
  originOpportunityUrl: r.origin_opportunity_url ? toString(r.origin_opportunity_url) : null,
```

#### 3.3c Add badge and origin link to `RecordDetailModal.tsx`

**File:** `src/components/dashboard/RecordDetailModal.tsx`

**Badge (header, lines 219–228):** In the same row as the existing record-type badges, add a conditional Re-Engagement badge:

```tsx
{record.prospectSourceType === 'Re-Engagement' && (
  <span className="inline-flex items-center rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-medium text-purple-800">
    Re-Engagement
  </span>
)}
```

Place it next to or near the existing `recordType` / `recordTypeName` badges.

**"View Original Opportunity" link (footer, lines 396–423):** With the existing Salesforce links (`record.leadUrl`, `record.opportunityUrl`), add (ExternalLink is already imported in this file):

```tsx
{record.originOpportunityUrl && (
  <a
    href={record.originOpportunityUrl}
    target="_blank"
    rel="noopener noreferrer"
    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 rounded-lg transition-colors"
  >
    <ExternalLink className="w-4 h-4" />
    View Original Opportunity
  </a>
)}
```

### 3.4 ExploreResults Drilldown Mapping + Semantic Layer

**Two changes:**

1. **Semantic layer — add columns to drilldown SELECT**  
   **File:** `src/lib/semantic-layer/query-compiler.ts`  
   In **`compileGenericDetailList`**, add to the SELECT list (with the other `v.*` columns, e.g. after `v.opportunity_url`):

   ```ts
   v.lead_record_source as prospect_source_type,
   v.Previous_Recruiting_Opportunity_ID__c as origin_recruiting_opp_id,
   v.origin_opportunity_url,
   ```
   This ensures Explore drilldown result rows include these fields so the mapping below can use them.

2. **ExploreResults mapping**  
   **File:** `src/components/dashboard/ExploreResults.tsx` (~line 840)

   The Explore drilldown maps semantic layer result rows into `DetailRecord[]`. In the mapping return object (`const records: DetailRecord[] = detailData.result.rows.map(...)`), add (e.g. after `opportunityId`):

```ts
  prospectSourceType: row.prospect_source_type ? String(row.prospect_source_type) : null,
  originRecruitingOppId: row.origin_recruiting_opp_id ? String(row.origin_recruiting_opp_id) : null,
  originOpportunityUrl: row.origin_opportunity_url ? String(row.origin_opportunity_url) : null,
```

### 3.5 Filter Considerations (No code changes needed)

**Record type filter on SQOs:** Existing queries filter by `recordtypeid = '012Dn000000mrO3IAI'` (Recruiting). The new Recruiting opp from re-engagement conversion has this record type. No change.

**Channel/source filter:** Re-Engagement records carry `Finance_View__c` and `Final_Source__c`. Works as-is.

**SGA filter:** `Lead_SGA_Owner_Name__c` for re-engagement "leads" comes from `Opportunity_Owner_Name__c`. If it's an Id not a name, `With_SGA_Lookup` resolves it via the User table join. No change.

**Campaign filter:** Works through both paths:
1. `Campaign_Id__c` — from `CampaignId` on the Re-Engagement opp (currently 0% populated; Phase 1.4 adds it to the layout).
2. `all_campaigns` — from `Campaign_Member_Agg_By_Contact` via ContactId (currently 3 Re-Engagement opps have CM records; mechanism is in place for future growth).

---

## Phase 4: Validation (AGENTIC — run after Phase 2 deploy)

### 4.1 Unit Validation with Known Records

| Record | Id | Expected |
|---|---|---|
| Re-Engagement opp | `006VS00000VL1m5YAD` | `Full_prospect_id__c` = this Id. `converted_oppty_id` = `006VS00000X00oFYAR`. `is_sql = 1`. `lead_record_source = 'Re-Engagement'`. |
| New Recruiting opp | `006VS00000X00oFYAR` | In `Opp_Base`. Joins to re-engagement "lead" via `converted_oppty_id`. |
| Original Recruiting opp | `006Dn00000AZP6EIAX` | NOT a separate row. Accessible via `origin_opportunity_url`. |

```sql
SELECT
  Full_prospect_id__c, Full_Opportunity_ID__c, advisor_name,
  lead_record_source, prospect_source_type,
  FilterDate, stage_entered_contacting__c, mql_stage_entered_ts, converted_date_raw,
  is_contacted, is_mql, is_sql, is_sqo, is_joined,
  Previous_Recruiting_Opportunity_ID__c, origin_opportunity_url,
  all_campaigns, StageName, record_type_name
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE Full_prospect_id__c = '006VS00000VL1m5YAD'
   OR Full_Opportunity_ID__c = '006VS00000X00oFYAR';
```

### 4.2 Campaign Join Validation

```sql
-- Real Leads still get campaigns from LeadId
SELECT Full_prospect_id__c, lead_record_source, Campaign_Id__c,
       ARRAY_LENGTH(all_campaigns) AS campaign_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE lead_record_source = 'Lead' AND all_campaigns IS NOT NULL
LIMIT 20;

-- Re-Engagement "leads" get campaigns from ContactId
SELECT Full_prospect_id__c, lead_record_source, Campaign_Id__c,
       ARRAY_LENGTH(all_campaigns) AS campaign_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE lead_record_source = 'Re-Engagement' AND all_campaigns IS NOT NULL;

-- No row duplication
SELECT lead_record_source, COUNT(*) AS row_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
GROUP BY 1;
```

### 4.3 Volume Impact

```sql
SELECT 'Prospect' AS stage, COUNT(*) AS re_engagement_count
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
WHERE RecordTypeId = '012VS000009VoxrYAC' AND IsDeleted = FALSE AND CreatedDate >= '2025-01-01'
UNION ALL
SELECT 'Contacted', COUNT(*)
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
WHERE RecordTypeId = '012VS000009VoxrYAC' AND IsDeleted = FALSE AND Stage_Entered_Outreach__c IS NOT NULL
UNION ALL
SELECT 'MQL', COUNT(*)
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
WHERE RecordTypeId = '012VS000009VoxrYAC' AND IsDeleted = FALSE AND Stage_Entered_Call_Scheduled__c IS NOT NULL
UNION ALL
SELECT 'SQL (Converted)', COUNT(*)
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
WHERE RecordTypeId = '012VS000009VoxrYAC' AND IsDeleted = FALSE AND Created_Recruiting_Opportunity_ID__c IS NOT NULL;
```

### 4.4 Ground Truth Comparison

Per `.cursorrules`:

1. Run dashboard test suite against Q1 2025 ground truth.
2. Prospect counts will increase by the number of Re-Engagement opps created in that period.
3. Contacted/MQL/SQL increases will be minimal for historical periods (stage-entered fields mostly unpopulated).
4. SQO/Joined should be unchanged or +2 max.
5. Update ground truth baselines.

---

## Phase 5: Post-Deploy Monitoring (MANUAL)

### 5.1 Stage-Entered Field Population

```sql
SELECT
  DATE_TRUNC(CreatedDate, MONTH) AS created_month, COUNT(*) AS total,
  COUNTIF(Stage_Entered_Planned_Nurture__c IS NOT NULL) AS has_planned_nurture_ts,
  COUNTIF(Stage_Entered_Outreach__c IS NOT NULL) AS has_outreach_ts,
  COUNTIF(Stage_Entered_Call_Scheduled__c IS NOT NULL) AS has_call_sched_ts,
  COUNTIF(Stage_Entered_Re_Engaged__c IS NOT NULL) AS has_re_engaged_ts
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
WHERE RecordTypeId = '012VS000009VoxrYAC' AND IsDeleted = FALSE
GROUP BY 1 ORDER BY 1 DESC;
```

### 5.2 Conversion Volume

```sql
SELECT
  DATE_TRUNC(Stage_Entered_Re_Engaged__c, MONTH) AS conversion_month, COUNT(*) AS conversions
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
WHERE RecordTypeId = '012VS000009VoxrYAC' AND IsDeleted = FALSE
  AND Created_Recruiting_Opportunity_ID__c IS NOT NULL
GROUP BY 1 ORDER BY 1 DESC;
```

### 5.3 Campaign Coverage

```sql
SELECT
  DATE_TRUNC(CreatedDate, MONTH) AS created_month, COUNT(*) AS total_re_eng,
  COUNTIF(CampaignId IS NOT NULL) AS with_primary_campaign,
  COUNTIF(ContactId IS NOT NULL) AS with_contact_id
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
WHERE RecordTypeId = '012VS000009VoxrYAC' AND IsDeleted = FALSE
GROUP BY 1 ORDER BY 1 DESC;
```

---

## Summary: Ordered Workstream

| Step | What | Owner | Type | Dependency |
|---|---|---|---|---|
| **1** | Confirm/deploy Stage_Entered_* Flow for Re-Engagement stages | Salesforce Admin | Manual | None |
| **2** | Confirm/deploy Re-Engagement → Recruiting conversion Flow | Salesforce Admin | Manual | None |
| **3** | Add `CampaignId` to Re-Engagement page layout | Salesforce Admin | Manual | None |
| **4** | Investigate/fix ContactId population (48.6% gap) | Salesforce Admin | Manual | None |
| **5** | Verify fields syncing to BQ | Data Eng / RevOps | Manual | Steps 1-4 |
| **6** | Modify `views/vw_funnel_master.sql` (Phase 2) | Agent | Agentic | Step 5 |
| **7** | Extend detail-records query + types + mapping (Phase 3.2) | Agent | Agentic | Step 6 |
| **8** | Extend record-detail query + types + modal UI (Phase 3.3) | Agent | Agentic | Step 6 |
| **9** | Update ExploreResults mapping + semantic layer template (Phase 3.4) | Agent | Agentic | Step 7 |
| **10** | Validate (Phase 4) | Agent / RevOps | Agentic + Manual | Steps 6-9 |
| **11** | Update ground truth baselines | RevOps | Manual | Step 10 |
| **12** | Monitor (Phase 5) | RevOps | Manual | Ongoing |

---

## Appendix: Campaign Membership Investigation Summary

*Full findings in `campaign_members.md`.*

| Finding | Detail | Impact |
|---|---|---|
| CampaignId on Re-Engagement | 0% populated | Add to page layout; auto-populated when RevOps adds Contacts to campaigns via CampaignMember, not this field |
| ContactId on Re-Engagement | 48.6% (388/798) | Route campaign membership through Contact; investigate gap |
| CampaignMember via Contact | 3 Re-Engagement opps have CM via Contact today | Mechanism works; coverage grows as Contacts are added to campaigns |
| LeadId vs ContactId on CampaignMember | Not mutually exclusive (35 rows have both) | Two CTEs with `lead_record_source = 'Re-Engagement'` gate |
| Duplication risk | 8/500 converted leads had CM on both LeadId and ContactId | Two-CTE approach prevents duplication |
| ConvertedContactId on Lead | 99.4% populated | Not needed; available for future use |
