# Implementation Plan: Re-Engagement Opportunities as Funnel "Leads" (Option A)

**Purpose:** Treat Re-Engagement opportunities as a parallel lead-like stream inside `vw_funnel_master` so they count in prospect → contacted → MQL → SQL volumes and conversion rates, then flow into a new Recruiting opportunity for SQO → Signed → Joined — while preserving the link back to the original closed-lost opportunity for full record history in drilldowns.

**Date:** 2026-02-11 (v2 — Updated with campaign membership findings from `campaign_members.md`)

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

## Phase 1: Salesforce & BigQuery Prerequisites

These must be in place before any view or dashboard changes.

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
3. **Decision: backfill or not.** For the ~617 historical Re-Engagement records with no stage-entered dates, you have two options:
   - **No backfill (recommended to start):** Historical re-engagement records will appear as prospects only (no contacted/MQL/SQL progression). They'll still show up in prospect counts by `FilterDate` (which falls back to `CreatedDate`). Going forward, new records get proper timestamps.
   - **Partial backfill:** For records currently sitting in Outreach, Call Scheduled, Engaged, or Re-Engaged, you could backfill `Stage_Entered_*` from `LastStageChangeDate` as an approximation. This gives you the date they entered their *current* stage but not prior stages. Only worth doing if historical accuracy matters for reporting.

### 1.2 Confirm Conversion Linking Fields Are Syncing

The bidirectional linking fields already exist and are confirmed in BQ (2 records have them set):

- **On Re-Engagement opp:** `Created_Recruiting_Opportunity_ID__c` → Id of the new Recruiting opp
- **On new Recruiting opp:** `Source_Re_Engagement_Opportunity_ID__c` → Id of the Re-Engagement opp it came from

**Action items:**

1. Confirm the Re-Engagement → Recruiting conversion Flow (`Re_Engagement_Conversion_to_Recruiting.flow-meta.xml` from your codebase) is deployed and active in production. This is the flow that fires when `StageName` = `Re-Engaged` and creates the new Recruiting opp with all the field mappings.
2. Confirm both linking fields sync to BQ. They're already in the schema, so verify with the 2 existing converted records (e.g., Scott Sadler: Re-Engagement `006VS00000VL1m5YAD` → Recruiting `006VS00000X00oFYAR`).

### 1.3 Confirm `Conversion_Channel__c` = 'Re-Engagement' on New Recruiting Opps

The conversion Flow should set `Conversion_Channel__c = 'Re-Engagement'` on the new Recruiting opp. This allows downstream reporting to segment re-engagement-sourced Recruiting opps from lead-sourced ones.

**Action:** Verify this is in the Flow and that the picklist value exists in Salesforce.

### 1.4 Add `CampaignId` (Primary Campaign Source) to Re-Engagement Page Layout

**Finding:** 0% of Re-Engagement opps have `CampaignId` populated. The standard `Opportunity.CampaignId` field exists at the object level and is already in BQ, but it's not on the Re-Engagement page layout so nobody can set it.

**Action:** Add the `Campaign` (Primary Campaign Source) field to the Re-Engagement Opportunity page layout in Salesforce Setup. No schema or BQ changes needed — the field already syncs. Once on the layout, users can associate Re-Engagement opps with a campaign, and it will flow through to `Campaign_Id__c` in the view automatically.

### 1.5 Investigate/Fix `ContactId` Population on Re-Engagement Opps

**Finding:** Only 48.6% (388 of 798) Re-Engagement opps have `ContactId` populated. The other 51.4% have no Contact. This matters because campaign membership for Re-Engagement records routes through the Contact (see Phase 2.6).

**Action:** Investigate why half of Re-Engagement opps have no Contact. If the Re-Engagement creation Flow (from close-lost Recruiting opp) isn't copying `ContactId`, fix it. For the 410 historical records without ContactId, consider a backfill if campaign membership matters for them. Going forward, the Flow should always populate ContactId.

---

## Phase 2: Modify `vw_funnel_master`

This is the core change. Four things happen to the view:

1. Add a `ReEngagement_As_Lead` CTE that transforms Re-Engagement opps into lead-shaped rows.
2. UNION that with `Lead_Base` into an `All_Leads` CTE.
3. Remove Re-Engagement from `Opp_Base` (Recruiting only).
4. Split `Campaign_Member_Agg` into two CTEs (By_Lead and By_Contact) with mutually exclusive join conditions to avoid row duplication.

### 2.1 Add `ReEngagement_As_Lead` CTE

Insert this CTE after the campaign CTEs and before `Opp_Base`. Note the inclusion of `ContactId` (needed for campaign membership join):

```sql
ReEngagement_As_Lead AS (
  SELECT
    -- Primary identifier: use Re-Engagement opp's full 18-char Id as the "prospect" Id
    Full_Opportunity_ID__c AS Full_prospect_id__c,
    Name AS Prospect_Name,

    -- "Converted opportunity" = the NEW Recruiting opp created on conversion
    Created_Recruiting_Opportunity_ID__c AS converted_oppty_id,

    -- Core dates
    CreatedDate,
    OwnerId AS Lead_OwnerId,

    -- Attribution (same fields as leads)
    Final_Source__c AS Lead_Original_Source,
    Final_Source__c AS Final_Source,
    Finance_View__c AS Lead_Finance_View__c,

    -- ════════════════════════════════════════════════════════════════
    -- STAGE MAPPING: Re-Engagement stages → Lead funnel date fields
    -- ════════════════════════════════════════════════════════════════
    -- Outreach → Contacted
    Stage_Entered_Outreach__c AS stage_entered_contacting__c,
    -- Call Scheduled → MQL
    Stage_Entered_Call_Scheduled__c AS mql_stage_entered_ts,
    -- Re-Engaged (+ new Recruiting opp link) → SQL / conversion
    Stage_Entered_Re_Engaged__c AS converted_date_raw,

    -- "IsConverted" = TRUE when the conversion link to new Recruiting opp exists
    CASE
      WHEN Created_Recruiting_Opportunity_ID__c IS NOT NULL THEN TRUE
      ELSE FALSE
    END AS IsConverted,

    -- Stage entered new equivalent: Planned Nurture or CreatedDate
    COALESCE(Stage_Entered_Planned_Nurture__c, CreatedDate) AS stage_entered_new__c,

    -- FilterDate: same GREATEST logic as Lead_Base
    GREATEST(
      IFNULL(CreatedDate, TIMESTAMP('1900-01-01')),
      IFNULL(Stage_Entered_Planned_Nurture__c, TIMESTAMP('1900-01-01')),
      IFNULL(Stage_Entered_Outreach__c, TIMESTAMP('1900-01-01'))
    ) AS Lead_FilterDate,

    -- Carry-through fields for attribution and drilldown
    Experimentation_Tag__c AS Lead_Experimentation_Tag__c,
    CampaignId AS Lead_Campaign_Id__c,
    External_Agency__c AS Lead_External_Agency__c,
    Opportunity_Owner_Name__c AS Lead_SGA_Owner_Name__c,
    Stage_Entered_Closed__c AS lead_closed_date,

    -- Re-Engagement–specific: origin link for drilldown to original opp
    Previous_Recruiting_Opportunity_ID__c,

    -- ContactId: needed for campaign membership join (By_Contact path)
    ContactId,

    -- Lead-only fields that don't apply to Re-Engagement (nulled out)
    CAST(NULL AS STRING) AS Disposition__c,
    FALSE AS DoNotCall,
    CAST(NULL AS STRING) AS Lead_Score_Tier__c,
    CAST(NULL AS STRING) AS Lead_Next_Steps__c,
    CAST(NULL AS DATE) AS Initial_Call_Scheduled_Date__c,

    -- Marker to distinguish Re-Engagement "leads" from real Leads in drilldown
    'Re-Engagement' AS lead_record_source

  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
  WHERE RecordTypeId = '012VS000009VoxrYAC'
    AND (IsDeleted IS NULL OR IsDeleted = FALSE)
),
```

### 2.2 Add Matching Columns to `Lead_Base`

Add these to the `Lead_Base` SELECT so the schemas match for the UNION:

```sql
-- Add to Lead_Base SELECT list:
CAST(NULL AS STRING) AS Previous_Recruiting_Opportunity_ID__c,
CAST(NULL AS STRING) AS ContactId,
'Lead' AS lead_record_source
```

### 2.3 Create `All_Leads` CTE (UNION)

Insert after `ReEngagement_As_Lead`, before `Opp_Base`:

```sql
All_Leads AS (
  SELECT * FROM Lead_Base
  UNION ALL
  SELECT * FROM ReEngagement_As_Lead
),
```

### 2.4 Modify `Opp_Base` — Recruiting Only

Change the WHERE clause to exclude Re-Engagement opps (they now live on the lead side):

```sql
-- BEFORE:
WHERE RecordTypeId IN ('012Dn000000mrO3IAI', '012VS000009VoxrYAC')

-- AFTER:
WHERE RecordTypeId = '012Dn000000mrO3IAI'  -- Recruiting only
```

### 2.5 Modify `Combined` CTE — Use `All_Leads`

Change the FROM to use `All_Leads` instead of `Lead_Base`:

```sql
-- BEFORE:
FROM Lead_Base l
FULL OUTER JOIN Opp_Base o
  ON l.converted_oppty_id = o.Full_Opportunity_ID__c

-- AFTER:
FROM All_Leads l
FULL OUTER JOIN Opp_Base o
  ON l.converted_oppty_id = o.Full_Opportunity_ID__c
```

This is the key join: for Re-Engagement "leads," `converted_oppty_id` = `Created_Recruiting_Opportunity_ID__c`, which joins to the new Recruiting opp's `Full_Opportunity_ID__c`. Same pattern as real leads.

Also add these columns to the `Combined` SELECT:

```sql
-- Re-Engagement origin link (for drilldown)
l.Previous_Recruiting_Opportunity_ID__c,

-- Source type marker
l.lead_record_source,

-- ContactId for campaign membership join (Re-Engagement path)
l.ContactId AS lead_contact_id,

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

### 2.6 Campaign Membership: Split Into Two CTEs with Mutually Exclusive Joins

This is the change informed by the campaign membership investigation (`campaign_members.md`).

**Why two CTEs:** The investigation confirmed that `CampaignMember.LeadId` and `CampaignMember.ContactId` are **not mutually exclusive** — 35 rows have both populated (post-conversion records). And 8 of 500 sampled converted leads had CampaignMember records on both their LeadId and their ConvertedContactId with the same campaigns. If we naively joined on both and merged, we'd get either row duplication or duplicate campaign IDs in `all_campaigns`. The safe approach is: use LeadId for real Leads, use ContactId only for Re-Engagement "leads" that have no Lead record.

**Replace the current single `Campaign_Member_Agg` CTE with:**

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

-- Campaign memberships by Contact (for Re-Engagement opps that have no Lead in the funnel row)
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

**Update the JOIN in `Combined`:**

```sql
-- BEFORE:
LEFT JOIN Campaign_Member_Agg cma
  ON cma.LeadId = l.Full_prospect_id__c

-- AFTER:
LEFT JOIN Campaign_Member_Agg_By_Lead cma_lead
  ON cma_lead.LeadId = l.Full_prospect_id__c
LEFT JOIN Campaign_Member_Agg_By_Contact cma_contact
  ON cma_contact.ContactId = l.ContactId
  AND l.lead_record_source = 'Re-Engagement'
```

The `l.lead_record_source = 'Re-Engagement'` condition ensures the Contact-based join only fires for Re-Engagement rows, never for real Leads. This is the mutually exclusive gate that prevents duplication.

**Update the `all_campaigns` SELECT in `Combined`:**

```sql
-- BEFORE:
cma.all_campaigns AS all_campaigns,

-- AFTER:
COALESCE(cma_lead.all_campaigns, cma_contact.all_campaigns) AS all_campaigns,
```

**How this works for each row type:**

| Row type | `cma_lead` join | `cma_contact` join | `all_campaigns` result |
|---|---|---|---|
| Real Lead (lead_record_source = 'Lead') | Matches on LeadId → Lead's campaign memberships | Blocked by `lead_record_source = 'Re-Engagement'` gate → NULL | Lead's campaigns |
| Re-Engagement "lead" (lead_record_source = 'Re-Engagement') | LeadId = Opportunity Id → never matches a CampaignMember.LeadId → NULL | Matches on ContactId (if populated) → Contact's campaign memberships | Contact's campaigns (or NULL if no ContactId / no memberships) |
| Opp-only row (no lead side) | NULL (no lead) | NULL (no lead side) | NULL |

No row duplication. No duplicate campaign IDs. Current Lead behavior completely unchanged.

### 2.7 Clean Up `StageName_code` in `Final` CTE

Remove the dead Planned Nurture mapping:

```sql
-- BEFORE:
WHEN StageName = 'Planned Nurture' THEN 9

-- AFTER:
-- (Remove this line entirely — Re-Engagement opps are no longer in Opp_Base,
--  so StageName will only be Recruiting stages)
```

### 2.8 Clean Up `record_type_name` in `Final` CTE

Since `Opp_Base` is now Recruiting only, the Re-Engagement branch is dead. Replace with:

```sql
-- Record type of the opportunity (Recruiting only now)
CASE
  WHEN recordtypeid = '012Dn000000mrO3IAI' THEN 'Recruiting'
  ELSE 'Unknown'
END AS record_type_name,

-- Source pathway: did this record originate as a Lead or a Re-Engagement?
l.lead_record_source AS prospect_source_type,
```

### 2.9 Remove the TODO Comment

Delete line 203-204:

```sql
-- REMOVE:
--##TODO## In the future we may need to create a view of re-engagement opportunities and have them look like
-- 'leads' where they 'convert' into Recruiting Type Opportunities.
```

---

## Phase 3: Dashboard Code Changes

The dashboard queries `vw_funnel_master` using standardized field names. Because the view changes preserve the same column names and flag logic, most queries work without modification. The changes below are for drilldown enrichment and visual distinction.

### 3.1 No Changes Needed (Automatic)

These query files read the same flags and date fields that now fire for Re-Engagement "leads." No code changes required:

- `src/lib/queries/funnel-metrics.ts` — Prospects, Contacted, MQLs, SQLs, SQOs, Joined counts
- `src/lib/queries/conversion-rates.ts` — All conversion rate calculations (cohort and period)
- `src/lib/queries/source-performance.ts` — Channel and source breakdowns
- `src/lib/semantic-layer/definitions.ts` — Metric definitions for the semantic layer

Re-Engagement records automatically flow into these counts because:
- **Prospects:** `FilterDate` is set from `GREATEST(CreatedDate, Stage_Entered_Planned_Nurture__c, Stage_Entered_Outreach__c)`
- **Contacted:** `stage_entered_contacting__c` is aliased from `Stage_Entered_Outreach__c`
- **MQLs:** `mql_stage_entered_ts` is aliased from `Stage_Entered_Call_Scheduled__c`
- **SQLs:** `converted_date_raw` is aliased from `Stage_Entered_Re_Engaged__c`, and `is_sql` fires when `IsConverted = TRUE` (i.e., `Created_Recruiting_Opportunity_ID__c IS NOT NULL`)
- **SQOs/Joined:** Come from the linked new Recruiting opp in `Opp_Base`, which already works

### 3.2 Detail Records / Drilldown (Changes Needed)

**File:** `src/lib/queries/detail-records.ts` (and any semantic layer query templates that build detail record queries)

Add the new columns to detail record queries so they appear in the drilldown table and Record Detail Modal:

```sql
-- Add to SELECT in detail record queries:
v.lead_record_source AS prospect_source_type,
v.Previous_Recruiting_Opportunity_ID__c AS origin_recruiting_opp_id,
v.origin_opportunity_url
```

**Purpose:** When a user clicks into a record that came from re-engagement, they see:
- `prospect_source_type = 'Re-Engagement'` — tells them this wasn't a fresh lead
- `origin_opportunity_url` — clickable link to the original closed-lost Recruiting opp in Salesforce
- The full current funnel history (contacted date, MQL date, SQL date from re-engagement, plus SQO/Signed/Joined from the new Recruiting opp)

### 3.3 Record Detail Modal (Changes Needed)

**File:** `src/components/dashboard/ExploreResults.tsx` (or wherever the Record Detail Modal renders)

Add a visual indicator and origin link:

1. **Badge/tag:** If `prospect_source_type === 'Re-Engagement'`, show a badge (e.g., "Re-Engagement" in a distinct color) next to the advisor name. This distinguishes re-engagement prospects from fresh leads at a glance.
2. **Origin opp link:** If `origin_opportunity_url` is non-null, show a "View Original Opportunity" link in the detail modal. This lets users click through to the closed-lost opp to see the full prior history (CLR, prior owner, prior stages, etc.).
3. **Three-record chain (optional enhancement):** For the richest drilldown, show a timeline:
   - Original Recruiting Opp (closed lost) → Re-Engagement "Lead" (prospect → contacted → MQL → SQL) → New Recruiting Opp (SQO → Signed → Joined)

### 3.4 Filter Considerations

**Record type filter on SQOs:** The existing SQO/Joined queries already filter by `recordtypeid = '012Dn000000mrO3IAI'` (Recruiting). Since the new Recruiting opp created from re-engagement conversion has this record type, it passes this filter automatically. No change needed.

**Channel/source filter:** Re-Engagement records carry `Finance_View__c` and `Final_Source__c` from the Re-Engagement opp. If these are populated (they should be, as the conversion Flow copies them), channel/source filtering works as-is. If you want re-engagement records to always appear under a "Re-Engagement" channel, you could set `Finance_View__c = 'Re-Engagement'` on Re-Engagement opps in Salesforce (or override in the CTE).

**SGA filter:** The `Lead_SGA_Owner_Name__c` for re-engagement "leads" comes from `Opportunity_Owner_Name__c` on the Re-Engagement opp. If this field is populated, SGA filtering works. Verify that it resolves to a name (not an Id) — if it's an Id, the `With_SGA_Lookup` CTE should handle the resolution via the User table join, same as it does for Opp_SGA_Name today.

**Campaign filter:** Works through two paths:
1. **Primary campaign (`Campaign_Id__c`):** `COALESCE(o.Opp_Campaign_Id__c, l.Lead_Campaign_Id__c)`. For Re-Engagement "leads," `Lead_Campaign_Id__c` comes from `CampaignId` on the Re-Engagement opp (currently 0% populated; adding to page layout in Phase 1.4 fixes this going forward).
2. **All campaigns (`all_campaigns`):** For real Leads, routed through `Campaign_Member_Agg_By_Lead` on LeadId (unchanged). For Re-Engagement "leads," routed through `Campaign_Member_Agg_By_Contact` on ContactId (new path from Phase 2.6). Currently only 3 of 388 Re-Engagement opps with ContactId have CampaignMember records via Contact, so coverage is low — but the mechanism is in place and will work as more Contacts are added to campaigns.

---

## Phase 4: Validation

### 4.1 Unit Validation with Known Records

Use the confirmed converted record (Scott Sadler) to validate the full chain:

| Record | Id | Expected behavior |
|---|---|---|
| Re-Engagement opp | `006VS00000VL1m5YAD` | Appears as a "lead" row. `Full_prospect_id__c` = this Id. `converted_oppty_id` = `006VS00000X00oFYAR`. `is_sql = 1`. `lead_record_source = 'Re-Engagement'`. |
| New Recruiting opp | `006VS00000X00oFYAR` | Appears in `Opp_Base`. Joins to the re-engagement "lead" via `converted_oppty_id`. Picks up SQO/Joined flags from its own fields. |
| Original Recruiting opp (closed lost) | `006Dn00000AZP6EIAX` | Does NOT appear as a separate row (it's a closed-lost opp from a prior cycle). Accessible only via `origin_opportunity_url` in the drilldown. |

**Query to validate:**

```sql
SELECT
  Full_prospect_id__c,
  Full_Opportunity_ID__c,
  advisor_name,
  lead_record_source,
  FilterDate,
  stage_entered_contacting__c,
  mql_stage_entered_ts,
  converted_date_raw,
  is_contacted,
  is_mql,
  is_sql,
  is_sqo,
  is_joined,
  Previous_Recruiting_Opportunity_ID__c,
  origin_opportunity_url,
  all_campaigns,
  StageName,
  record_type_name
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE Full_prospect_id__c = '006VS00000VL1m5YAD'
   OR Full_Opportunity_ID__c = '006VS00000X00oFYAR';
```

### 4.2 Campaign Join Validation

Verify the two-CTE campaign approach works correctly and doesn't cause duplication:

```sql
-- Real Leads still get campaigns from LeadId (unchanged behavior)
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

-- No row duplication: total rows should not increase vs. pre-change baseline
SELECT lead_record_source, COUNT(*) AS row_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
GROUP BY 1;
```

### 4.3 Volume Validation

Compare pre- and post-change counts for a recent period:

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

Per `.cursorrules`, after deploying the view change:

1. Run the dashboard test suite against Q1 2025 ground truth values.
2. Expect **prospect counts to increase** by the number of Re-Engagement opps created in that period.
3. Expect contacted/MQL/SQL counts to increase only for records with the relevant stage-entered dates populated (likely minimal for historical periods).
4. SQO/Joined counts should be unchanged or increase by at most the 2 converted records (if they fall in the test period).
5. Update ground truth values to reflect the new baseline that includes Re-Engagement.

---

## Phase 5: Post-Deploy Cleanup & Monitoring

### 5.1 Monitor Stage-Entered Field Population

```sql
SELECT
  DATE_TRUNC(CreatedDate, MONTH) AS created_month,
  COUNT(*) AS total,
  COUNTIF(Stage_Entered_Planned_Nurture__c IS NOT NULL) AS has_planned_nurture_ts,
  COUNTIF(Stage_Entered_Outreach__c IS NOT NULL) AS has_outreach_ts,
  COUNTIF(Stage_Entered_Call_Scheduled__c IS NOT NULL) AS has_call_sched_ts,
  COUNTIF(Stage_Entered_Re_Engaged__c IS NOT NULL) AS has_re_engaged_ts
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
WHERE RecordTypeId = '012VS000009VoxrYAC' AND IsDeleted = FALSE
GROUP BY 1 ORDER BY 1 DESC;
```

### 5.2 Monitor Conversion Volume

```sql
SELECT
  DATE_TRUNC(Stage_Entered_Re_Engaged__c, MONTH) AS conversion_month,
  COUNT(*) AS conversions
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
WHERE RecordTypeId = '012VS000009VoxrYAC' AND IsDeleted = FALSE
  AND Created_Recruiting_Opportunity_ID__c IS NOT NULL
GROUP BY 1 ORDER BY 1 DESC;
```

### 5.3 Monitor Campaign Coverage for Re-Engagement

```sql
SELECT
  DATE_TRUNC(CreatedDate, MONTH) AS created_month,
  COUNT(*) AS total_re_eng,
  COUNTIF(CampaignId IS NOT NULL) AS with_primary_campaign,
  COUNTIF(ContactId IS NOT NULL) AS with_contact_id
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
WHERE RecordTypeId = '012VS000009VoxrYAC' AND IsDeleted = FALSE
GROUP BY 1 ORDER BY 1 DESC;
```

### 5.4 Optional: Backfill Decision

After running for 1–2 months with good stage-entered coverage on new records, revisit whether historical backfill is worth the effort.

---

## Summary: Ordered Workstream

| Step | What | Owner | Dependency |
|---|---|---|---|
| **1** | Confirm/deploy Stage_Entered_* Flow for Re-Engagement stages | Salesforce Admin | None |
| **2** | Confirm/deploy Re-Engagement → Recruiting conversion Flow | Salesforce Admin | None |
| **3** | Add `CampaignId` to Re-Engagement page layout | Salesforce Admin | None |
| **4** | Investigate/fix ContactId population on Re-Engagement opps (48.6% gap) | Salesforce Admin | None |
| **5** | Verify linking fields + stage-entered fields + ContactId syncing to BQ | Data Eng / RevOps | Steps 1-4 |
| **6** | Modify `vw_funnel_master` (Phases 2.1–2.9 above) | Data Eng / RevOps | Step 5 |
| **7** | Validate with known records + campaign joins + ground truth (Phase 4) | Data Eng / RevOps | Step 6 |
| **8** | Add drilldown columns + origin link to dashboard (Phase 3.2–3.3) | Frontend / Dashboard Dev | Step 6 |
| **9** | Update ground truth baselines | RevOps | Step 7 |
| **10** | Monitor stage-entered population + conversion volume + campaign coverage (Phase 5) | RevOps | Ongoing |

---

## Appendix: Campaign Membership Investigation Summary

*Full findings in `campaign_members.md`.*

| Question | Finding | Impact on Implementation |
|---|---|---|
| **CampaignId on Re-Engagement** | 0% populated | Add to page layout (Phase 1.4); no schema change needed |
| **ContactId on Re-Engagement** | 48.6% (388/798) have it | Route campaign membership through Contact; investigate gap (Phase 1.5) |
| **CampaignMember via Contact** | Only 3 Re-Engagement opps have CM records via Contact today | Mechanism works, coverage will grow as Contacts are added to campaigns |
| **LeadId vs ContactId on CampaignMember** | Not mutually exclusive — 35 rows have both | Must use separate CTEs with mutually exclusive join conditions |
| **Duplication risk** | 8/500 converted leads had CM on both LeadId and ContactId (same campaigns) | Two-CTE approach with `lead_record_source = 'Re-Engagement'` gate prevents duplication |
| **Recommended strategy** | Two CTEs: By_Lead (for Leads), By_Contact (for Re-Engagement only); COALESCE in SELECT | Implemented in Phase 2.6 |
| **ConvertedContactId on Lead** | Exists, 99.4% populated on converted leads | Not needed for this implementation; available for future use |
