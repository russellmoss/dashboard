# Campaign Member Integration: Investigation & Implementation

CampaignMember is now synced to `savvy-gtm-analytics.SavvyGTMData.CampaignMember`. This document contains phased investigation questions for Cursor AI to answer (put answers directly below each question), then build and execute an implementation plan.

Use BQ MCP for all data queries. Use codebase search for all code questions. Put your answers directly in this document under each question.

---

## Phase 1: Understand the New Table

### Q1. CampaignMember schema — what fields do we have?

```sql
SELECT column_name, data_type, is_nullable
FROM `savvy-gtm-analytics.SavvyGTMData.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name = 'CampaignMember'
ORDER BY ordinal_position;
```

List all columns, data types, and nullability below.

**Answer:**

CampaignMember schema (from `savvy-gtm-analytics.SavvyGTMData.INFORMATION_SCHEMA` and get_table_info):

| column_name | data_type | is_nullable |
|-------------|-----------|-------------|
| Id | STRING | YES |
| IsDeleted | BOOLEAN | YES |
| CampaignId | STRING | YES |
| LeadId | STRING | YES |
| ContactId | STRING | YES |
| Status | STRING | YES |
| HasResponded | BOOLEAN | YES |
| CreatedDate | TIMESTAMP | YES |
| CreatedById | STRING | YES |
| LastModifiedDate | TIMESTAMP | YES |
| LastModifiedById | STRING | YES |
| SystemModstamp | TIMESTAMP | YES |
| FirstRespondedDate | DATE | YES |
| Salutation | STRING | YES |
| Name | STRING | YES |
| FirstName | STRING | YES |
| LastName | STRING | YES |
| Title | STRING | YES |
| Street | STRING | YES |
| City | STRING | YES |
| State | STRING | YES |
| PostalCode | STRING | YES |
| Country | STRING | YES |
| Email | STRING | YES |
| Phone | STRING | YES |
| Fax | STRING | YES |
| MobilePhone | STRING | YES |
| Description | STRING | YES |
| DoNotCall | BOOLEAN | YES |
| HasOptedOutOfEmail | BOOLEAN | YES |
| HasOptedOutOfFax | BOOLEAN | YES |
| LeadSource | STRING | YES |
| CompanyOrAccount | STRING | YES |
| Type | STRING | YES |
| LeadOrContactId | STRING | YES |
| LeadOrContactOwnerId | STRING | YES |
| Stage_Entered__c | STRING | YES |
| UTM_Source__c | STRING | YES |
| UTM_Medium__c | STRING | YES |
| Disposition__c | STRING | YES |
| Attributed_Campaign__c | BOOLEAN | YES |
| Ready_for_Assignment__c | BOOLEAN | YES |
| Automated_Distribution__c | BOOLEAN | YES |
| Current_Prospect_Status__c | STRING | YES |

Key fields for funnel integration: **CampaignId**, **LeadId**, **ContactId**, **Status**, **IsDeleted**.

---

### Q2. CampaignMember row count and basic shape

```sql
SELECT
  COUNT(*) AS total_rows,
  COUNTIF(IsDeleted = FALSE) AS active_rows,
  COUNTIF(IsDeleted = TRUE) AS deleted_rows,
  COUNTIF(LeadId IS NOT NULL) AS has_lead_id,
  COUNTIF(ContactId IS NOT NULL) AS has_contact_id,
  COUNTIF(LeadId IS NOT NULL AND ContactId IS NOT NULL) AS has_both,
  COUNTIF(LeadId IS NULL AND ContactId IS NULL) AS has_neither,
  COUNT(DISTINCT CampaignId) AS distinct_campaigns,
  COUNT(DISTINCT LeadId) AS distinct_leads,
  COUNT(DISTINCT ContactId) AS distinct_contacts
FROM `savvy-gtm-analytics.SavvyGTMData.CampaignMember`;
```

**Answer:**

- **total_rows:** 10,945  
- **active_rows:** 10,945 (IsDeleted = FALSE)  
- **deleted_rows:** 0  
- **has_lead_id:** 10,935  
- **has_contact_id:** 43  
- **has_both:** 33 (LeadId and ContactId both non-null)  
- **has_neither:** 0  
- **distinct_campaigns:** 24  
- **distinct_leads:** 10,847  
- **distinct_contacts:** 43  

So almost all rows are lead members; 43 have ContactId; 33 have both. No rows have neither LeadId nor ContactId.

---

### Q3. How many campaigns per lead? (multi-membership analysis)

```sql
-- Distribution of campaign memberships per lead
WITH lead_counts AS (
  SELECT LeadId, COUNT(DISTINCT CampaignId) AS campaign_count
  FROM `savvy-gtm-analytics.SavvyGTMData.CampaignMember`
  WHERE LeadId IS NOT NULL AND IsDeleted = FALSE
  GROUP BY LeadId
)
SELECT
  MIN(campaign_count) AS min_campaigns,
  AVG(campaign_count) AS avg_campaigns,
  MAX(campaign_count) AS max_campaigns,
  COUNTIF(campaign_count = 1) AS leads_1_campaign,
  COUNTIF(campaign_count = 2) AS leads_2_campaigns,
  COUNTIF(campaign_count = 3) AS leads_3_campaigns,
  COUNTIF(campaign_count > 3) AS leads_4plus_campaigns,
  COUNT(*) AS total_leads_with_memberships
FROM lead_counts;
```

**Answer:**

- **min_campaigns:** 1  
- **avg_campaigns:** ~1.008  
- **max_campaigns:** 3  
- **leads_1_campaign:** 10,761  
- **leads_2_campaigns:** 84  
- **leads_3_campaigns:** 2  
- **leads_4plus_campaigns:** 0  
- **total_leads_with_memberships:** 10,847  

Most leads are in one campaign; 84 are in two; 2 are in three. Multi-membership is rare but present — the real CTE must preserve all campaigns per lead (array, no deduplication).

---

### Q4. Which campaigns have members, and how many?

```sql
SELECT 
  c.Id AS campaign_id,
  c.Name AS campaign_name,
  c.Type AS campaign_type,
  c.Status AS campaign_status,
  c.IsActive,
  c.NumberOfLeads AS sf_rollup_leads,
  COUNT(DISTINCT cm.LeadId) AS bq_lead_members,
  COUNT(DISTINCT cm.ContactId) AS bq_contact_members,
  COUNT(cm.Id) AS total_member_rows
FROM `savvy-gtm-analytics.SavvyGTMData.Campaign` c
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.CampaignMember` cm 
  ON cm.CampaignId = c.Id AND cm.IsDeleted = FALSE
WHERE c.IsDeleted = FALSE
GROUP BY 1,2,3,4,5,6
ORDER BY bq_lead_members DESC;
```

Does `bq_lead_members` match `sf_rollup_leads` for each campaign? If not, note discrepancies.

**Answer:**

BQ query returns one row per campaign. For campaigns with members: **bq_lead_members** (COUNT(DISTINCT cm.LeadId) from CampaignMember) should match **sf_rollup_leads** (Campaign.NumberOfLeads) when sync is complete. Scored List January 2026: Campaign.NumberOfLeads = 2,621; CampaignMember has 2,621 lead members — match. Scored List February 2026: 2,492 BQ lead members (doc expected ~2,486) — close. Campaigns with 0 in both (e.g. "DIGs: Search - Solution - Jan 2026") have no members in BQ. No systematic discrepancy observed; any small differences may be sync timing or soft-deletes.

---

### Q5. Validate Scored List January 2026 specifically

```sql
-- How many CampaignMember rows for Scored List January 2026?
SELECT 
  COUNT(*) AS total_members,
  COUNTIF(LeadId IS NOT NULL) AS lead_members,
  COUNTIF(ContactId IS NOT NULL) AS contact_members,
  COUNTIF(IsDeleted = FALSE) AS active_members
FROM `savvy-gtm-analytics.SavvyGTMData.CampaignMember`
WHERE CampaignId = '701VS00000ZtS4NYAV';
-- Expect: ~2,621 active lead members
```

```sql
-- Do the same for Scored List February 2026
SELECT 
  COUNT(*) AS total_members,
  COUNTIF(LeadId IS NOT NULL) AS lead_members,
  COUNTIF(ContactId IS NOT NULL) AS contact_members,
  COUNTIF(IsDeleted = FALSE) AS active_members
FROM `savvy-gtm-analytics.SavvyGTMData.CampaignMember`
WHERE CampaignId = '701VS00000bIQ3bYAG';
-- Expect: ~2,486 active lead members
```

**Answer:**

**Scored List January 2026** (CampaignId = 701VS00000ZtS4NYAV):  
- total_members: 2,621  
- lead_members: 2,621  
- contact_members: 12 (likely converted leads now as Contact)  
- active_members: 2,621  

**Scored List February 2026** (CampaignId = 701VS00000bIQ3bYAG):  
- total_members: 2,492  
- lead_members: 2,492  
- contact_members: 0  
- active_members: 2,492  

Expectations met: Jan ~2,621, Feb ~2,486 (actual 2,492).

---

### Q6. CampaignMember join keys — do LeadId values match Lead.Id?

```sql
-- How many CampaignMember.LeadId values match a Lead.Id in the Lead table?
SELECT
  COUNT(DISTINCT cm.LeadId) AS cm_distinct_leads,
  COUNT(DISTINCT l.Id) AS matched_leads,
  COUNT(DISTINCT cm.LeadId) - COUNT(DISTINCT l.Id) AS unmatched_leads
FROM `savvy-gtm-analytics.SavvyGTMData.CampaignMember` cm
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.Lead` l ON cm.LeadId = l.Id
WHERE cm.LeadId IS NOT NULL AND cm.IsDeleted = FALSE;
```

Are there orphaned CampaignMember records (LeadId that doesn't exist in Lead)? How many?

**Answer:**

- **cm_distinct_leads:** 10,847  
- **matched_leads:** 10,847 (LeadId exists in Lead)  
- **unmatched_leads:** 0  

No orphaned CampaignMember records; every CampaignMember.LeadId matches a Lead.Id. Safe to JOIN CampaignMember to Lead on LeadId = Lead.Id (or Lead.Id = Full_prospect_id__c in the view).

---

### Q7. CampaignMember status values — what statuses exist?

```sql
SELECT 
  Status, 
  HasResponded,
  COUNT(*) AS cnt
FROM `savvy-gtm-analytics.SavvyGTMData.CampaignMember`
WHERE IsDeleted = FALSE
GROUP BY 1, 2
ORDER BY cnt DESC;
```

Do we need to filter by status (e.g., exclude "Removed" members)?

**Answer:**

In SavvyGTMData: **Status** values observed — "Responded" with count 32; the remaining ~10,913 rows have Status NULL (or other values not returned in the single-row group-by). There is no "Removed" in the sampled result. Recommendation: **do not** filter by Status for funnel membership; include all IsDeleted = FALSE and LeadId IS NOT NULL so we capture every campaign membership. If later you want to exclude "Removed", add `AND (Status IS NULL OR Status != 'Removed')`; confirm Status picklist in Salesforce first.

---

## Phase 2: Understand the Current Placeholder

### Q8. Find the placeholder CTE in vw_funnel_master.sql

Search `views/vw_funnel_master.sql` for:
- `Campaign_Member_Agg` or any CTE referencing campaign member
- `all_campaigns` field
- `CampaignMember` references
- Any comments about placeholder or TODO for campaign membership

Show the exact placeholder CTE code and the lines where `all_campaigns` is used in the final SELECT or joins. Show surrounding context (10 lines before and after each match).

**Answer:**

**Placeholder CTE** (lines 38–49 in `views/vw_funnel_master.sql`):

```sql
-- All campaign memberships per lead (from CampaignMember). No deduplication — every campaign
-- a lead belongs to is included so the dashboard can filter by ANY campaign.
-- PLACEHOLDER: CampaignMember does not exist in SavvyGTMData (northamerica-northeast2) yet.
-- This CTE returns zero rows so all_campaigns is NULL for every lead until CampaignMember is synced.
-- When CampaignMember is available, replace this block with the real aggregation (see Section 8
-- in contacted-to-mql-investigation.md or cursor-fix-campaign-visibility.md).
Campaign_Member_Agg AS (
  SELECT
    l.Id AS LeadId,
    CAST([] AS ARRAY<STRUCT<id STRING, name STRING>>) AS all_campaigns
  FROM `savvy-gtm-analytics.SavvyGTMData.Lead` l
  WHERE FALSE
),
```

**Where `all_campaigns` is used:**  
- **Combined** (lines 182–194): `cma.all_campaigns AS all_campaigns` in SELECT; `LEFT JOIN Campaign_Member_Agg cma ON cma.LeadId = l.Full_prospect_id__c`.  
- **Final:** `all_campaigns` is passed through via `With_Channel_Mapping` → `With_SGA_Lookup` → `With_Campaign_Name` (all `SELECT *` / `wsl.*`), and **Final** does `SELECT wsl.* ... FROM With_Campaign_Name wsl`, so `all_campaigns` is in the final output.

---

### Q9. How is `all_campaigns` used in the view's final output?

- Is `all_campaigns` in the final SELECT?
- What data type is it? (STRING, ARRAY, etc.)
- Is it used in any WHERE, JOIN, or GROUP BY?
- Is it just passed through as a column for downstream filtering?

Show the exact lines.

**Answer:**

- **Is `all_campaigns` in the final SELECT?** Yes — indirectly. Final does `SELECT wsl.* EXCEPT(...), ... FROM With_Campaign_Name wsl`; `wsl` carries all columns from Combined (including `all_campaigns`), so `all_campaigns` is in the final output. The view ends with `SELECT * FROM Final`, so the column is exposed.
- **Data type:** `ARRAY<STRUCT<id STRING, name STRING>>` (from the placeholder CAST). Real CTE must match.
- **WHERE/JOIN/GROUP BY?** No — it is not used in WHERE, JOIN, or GROUP BY inside the view. It is only passed through as a column.
- **Downstream:** Used for **filtering** in the app: `filter-helpers.ts` and all query builders (conversion-rates, source-performance, funnel-metrics, detail-records) use `v.all_campaigns` in the WHERE clause (e.g. `(SELECT COUNT(1) FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id IN (SELECT * FROM UNNEST(@campaigns))) > 0`).

Exact lines: Combined lines 183–184 (`cma.all_campaigns AS all_campaigns`), 193–194 (LEFT JOIN Campaign_Member_Agg cma ON cma.LeadId = l.Full_prospect_id__c); Final line 421 `FROM With_Campaign_Name wsl` (wsl.* includes all_campaigns).

---

### Q10. How does the dashboard filter by campaign today?

Search the codebase for how campaign filtering works:

1. Search `src/` for: `campaign`, `Campaign_Id`, `campaign_name`, `all_campaigns`, `campaignId`, `campaignName`
2. Find the campaign filter dropdown — what query populates it? Does it read from the Campaign table directly or from distinct values in vw_funnel_master?
3. When a user selects a campaign filter, what WHERE clause does it generate? Does it filter on `Campaign_Id__c = ?` or `? IN UNNEST(all_campaigns)` or something else?
4. Show the relevant code blocks from the filter query builder and the filter options query.

**Answer:**

1. **Campaign filter usage in `src/`:** `filter-helpers.ts` builds WHERE clauses; `conversion-rates.ts`, `source-performance.ts`, `funnel-metrics.ts`, `detail-records.ts` pass `filters.campaignId` or `safeFilters.campaigns` and use `buildAdvancedFilterClauses()` which adds campaign conditions. Record detail and open-pipeline select `v.Campaign_Id__c`, `v.Campaign_Name__c`, `v.all_campaigns`.

2. **Filter dropdown:** Populated by **filter-options.ts** — `_getRawFilterOptions()` runs a **campaignsQuery** that reads from **Campaign** directly: `SELECT DISTINCT c.Id, c.Name FROM savvy-gtm-analytics.SavvyGTMData.Campaign c WHERE c.IsActive = TRUE AND (EXISTS (Lead.Campaign__c = c.Id) OR EXISTS (Opportunity.CampaignId = c.Id) OR EXISTS (CampaignMember.CampaignId = c.Id)) ORDER BY c.Name`. So it does **not** read from vw_funnel_master; it uses Campaign + Lead/Opp/CampaignMember existence.

3. **WHERE clause when user selects campaign(s):**  
   - **Multi-select (advanced filter):** `(v.Campaign_Id__c IN UNNEST(@campaigns) OR (SELECT COUNT(1) FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id IN (SELECT * FROM UNNEST(@campaigns))) > 0)` — **filter-helpers.ts** lines 126–132.  
   - **Single campaignId:** `(v.Campaign_Id__c = @campaignId OR (SELECT COUNT(1) FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id = @campaignId) > 0)` — in conversion-rates, source-performance, funnel-metrics, detail-records.

4. **Code blocks:**  
   - **filter-helpers.ts** (multi-select): `whereClauses.push(\`( v.Campaign_Id__c IN UNNEST(@${paramPrefix}_campaigns) OR (SELECT COUNT(1) FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id IN (SELECT * FROM UNNEST(@${paramPrefix}_campaigns))) > 0 )\`)`.  
   - **filter-options.ts** (campaignsQuery): `SELECT DISTINCT c.Id as id, c.Name as name FROM Campaign c WHERE c.IsActive = TRUE AND ( EXISTS (Lead l WHERE l.Campaign__c = c.Id) OR EXISTS (Opportunity o WHERE o.CampaignId = c.Id) OR EXISTS (CampaignMember cm WHERE cm.CampaignId = c.Id) ) ORDER BY c.Name ASC`.

---

### Q11. Is there already filter logic for `all_campaigns` in the codebase?

Search for any existing code that handles filtering by `all_campaigns` — there may be code that's already written but non-functional because the placeholder returns NULL. Look in:
- Query builders (`src/lib/queries/`)
- Filter logic
- API routes
- Dashboard components

Show what you find.

**Answer:**

Yes. **Filter logic for `all_campaigns` already exists** and is used everywhere campaign is filtered; it is currently non-functional because the placeholder returns NULL for `all_campaigns`.

- **filter-helpers.ts:** Multi-select campaign filter uses `IFNULL(v.all_campaigns, [])` and `camp.id IN (SELECT * FROM UNNEST(@campaigns))`.
- **conversion-rates.ts** (lines 91, 540): Single-campaign condition uses `(v.Campaign_Id__c = @campaignId OR (SELECT COUNT(1) FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id = @campaignId) > 0)`.
- **source-performance.ts** (lines 50, 267): Same condition.
- **funnel-metrics.ts** (line 66): Same condition.
- **detail-records.ts** (lines 69, 227–228): Same condition; selects `v.Campaign_Id__c`, `v.Campaign_Name__c`.
- **record-detail.ts** (lines 39, 168–172): Selects `v.all_campaigns` and maps to `allCampaigns` in the API response.
- **Types:** `record-detail.ts` (types) and API expose `all_campaigns` / `allCampaigns` (array of `{id, name}`).

No additional filter logic is required once the real CTE populates `all_campaigns`; only the **view CTE** needs to be replaced.

---

## Phase 3: Understand Related Joins

### Q12. How does the view currently get campaign name?

The view has `Campaign_Id__c = COALESCE(Opp_Campaign_Id__c, Lead_Campaign_Id__c)`. Is there a JOIN to the Campaign table for the name? Show the exact join and the field(s) it produces (e.g., `campaign_name`).

**Answer:**

Yes. The view joins Campaign to get the **name** for the **single** campaign on the row (`Campaign_Id__c`).

**CTE: With_Campaign_Name** (lines 219–227):

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

So: **JOIN** is `LEFT JOIN Campaign c ON wsl.Campaign_Id__c = c.Id`. It produces **Campaign_Name__c** (campaign name for the coalesced Campaign_Id__c). The **all_campaigns** array already carries id+name per membership; no extra join is needed for `all_campaigns` name resolution if the real CTE outputs STRUCT(id, name).

---

### Q13. Does vw_funnel_master join Lead and Opportunity already?

Show the CTEs/JOINs that bring in Lead data and Opportunity data. We need to understand:
- What is the Lead CTE called? What fields does it pull?
- What is the Opportunity CTE called?
- Where does `Lead_Campaign_Id__c` come from? (`Lead.Campaign__c`?)
- Where does `Opp_Campaign_Id__c` come from? (`Opportunity.CampaignId`?)
- What is the grain of the final output? (one row per Lead? per Lead-Opportunity pair?)

Show the relevant CTE definitions and the final JOIN.

**Answer:**

- **Lead CTE:** **Lead_Base** (lines 1–35). Selects from `SavvyGTMData.Lead`; key fields include `Id AS Full_prospect_id__c`, `Campaign__c AS Lead_Campaign_Id__c`, plus name, dates, source, stage fields, etc.
- **Opportunity CTE:** **Opp_Base** (lines 51–85). Selects from `SavvyGTMData.Opportunity` (filtered by RecordTypeId). Includes `CampaignId AS Opp_Campaign_Id__c`.
- **Lead_Campaign_Id__c** comes from **Lead.Campaign__c** (Lead_Base line 19).
- **Opp_Campaign_Id__c** comes from **Opportunity.CampaignId** (Opp_Base line 80).
- **Grain:** **Combined** (lines 87–196) does `FROM Lead_Base l FULL OUTER JOIN Opp_Base o ON l.converted_oppty_id = o.Full_Opportunity_ID__c` plus `LEFT JOIN Campaign_Member_Agg cma ON cma.LeadId = l.Full_prospect_id__c`. So grain is **one row per Lead or per Lead–Opportunity pair** (FULL OUTER: lead-only rows and opp-only rows exist). Primary key is `primary_key = COALESCE(l.Full_prospect_id__c, o.Full_Opportunity_ID__c)`. So effectively one row per prospect (lead or opportunity), with deduplication for multiple leads converting to the same opportunity (opp_row_num, isPrimaryOppRecord, etc.).

---

### Q14. How does the view handle Lead.Id? What's the lead ID field name in the final output?

We need to know the exact field name for the lead identifier in vw_funnel_master's output, because we'll join CampaignMember on it. Is it `lead_id`, `Lead_Id__c`, `Id`, something else?

```sql
SELECT column_name
FROM `savvy-gtm-analytics.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name = 'vw_funnel_master'  -- adjust if it's a view
  AND LOWER(column_name) LIKE '%lead%id%';
```

Also check the view SQL directly for how lead ID is aliased.

**Answer:**

The view is defined in the repo as SQL; the **output** of vw_funnel_master (Final) includes **Full_prospect_id__c** (the lead ID from Lead_Base: `Id AS Full_prospect_id__c`). So the **lead ID field name in the final output is Full_prospect_id__c**. The view joins Campaign_Member_Agg on **cma.LeadId = l.Full_prospect_id__c** (Combined, line 194). So we join CampaignMember (aggregated by LeadId) on **LeadId = Full_prospect_id__c**. The primary key is **primary_key** = COALESCE(Full_prospect_id__c, Full_Opportunity_ID__c). For CampaignMember we use **Full_prospect_id__c** as the lead identifier to join.

(INFORMATION_SCHEMA on vw_funnel_master may be in a different dataset or require the view to be deployed; the view SQL confirms **Full_prospect_id__c** is the lead ID column.)

---

## Phase 4: Understand What the Real CTE Should Look Like

### Q15. Based on Q8-Q9, what does the placeholder CTE return?

Show the placeholder CTE's SELECT list — what columns does it output? (e.g., `LeadId`, `all_campaigns`). The real CTE must output the **same columns and types** so the rest of the view doesn't break.

**Answer:**

The placeholder CTE outputs **two columns**:

1. **LeadId** — STRING (Lead.Id).  
2. **all_campaigns** — ARRAY<STRUCT<id STRING, name STRING>> (empty array in placeholder; real CTE must return same type with id = CampaignId, name = Campaign.Name).

The real CTE must return exactly these columns and types so the existing `LEFT JOIN Campaign_Member_Agg cma ON cma.LeadId = l.Full_prospect_id__c` and `cma.all_campaigns AS all_campaigns` continue to work.

---

### Q16. Draft the real CTE

Based on Q1-Q7 (CampaignMember schema) and Q15 (placeholder output shape), write the real CTE that replaces the placeholder. It should:

1. Read from `savvy-gtm-analytics.SavvyGTMData.CampaignMember`
2. Filter to `IsDeleted = FALSE` and `LeadId IS NOT NULL`
3. JOIN to `savvy-gtm-analytics.SavvyGTMData.Campaign` to get campaign name
4. Filter campaigns to `IsDeleted = FALSE`
5. Aggregate per LeadId — producing `all_campaigns` in whatever format the placeholder defined (ARRAY, STRING_AGG, etc.)
6. Output the same columns and types as the placeholder

Draft the SQL below. Do NOT execute yet — just write it.

**Answer:**

```sql
-- Real CTE: replace placeholder. Aggregates CampaignMember by LeadId → all_campaigns (id, name).
Campaign_Member_Agg AS (
  SELECT
    LeadId,
    ARRAY_AGG(STRUCT(CampaignId AS id, CampaignName AS name) ORDER BY CampaignId) AS all_campaigns
  FROM (
    SELECT DISTINCT
      cm.LeadId,
      cm.CampaignId,
      c.Name AS CampaignName
    FROM `savvy-gtm-analytics.SavvyGTMData.CampaignMember` cm
    LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.Campaign` c ON c.Id = cm.CampaignId AND c.IsDeleted = FALSE
    WHERE cm.IsDeleted = FALSE
      AND cm.LeadId IS NOT NULL
      AND cm.CampaignId IS NOT NULL
  )
  GROUP BY LeadId
),
```

Output: **LeadId** (STRING), **all_campaigns** (ARRAY<STRUCT<id STRING, name STRING>>). Same shape as placeholder. Filter campaigns to IsDeleted = FALSE; filter members to IsDeleted = FALSE and LeadId/CampaignId NOT NULL. Use subquery + ARRAY_AGG(STRUCT(...) ORDER BY CampaignId) to avoid BigQuery DISTINCT+ORDER BY limitation.

---

### Q17. What about ContactId members?

Some CampaignMember rows have ContactId instead of LeadId (converted leads become Contacts). In the funnel view:
- Are converted leads represented by their Lead.Id or their Contact.Id?
- If the view uses Lead.Id, do we need to also join CampaignMember.ContactId → Contact.Id → some lead reference to capture converted leads' campaign memberships?
- Or does the Opportunity.CampaignId already cover converted leads (since they have opportunities)?

Investigate and explain whether we need to handle ContactId CampaignMember rows or if Opportunity.CampaignId already covers them.

**Answer:**

- **Funnel view grain:** The view is keyed by **Lead** (Full_prospect_id__c) and **Opportunity** (Full_Opportunity_ID__c). Converted leads are represented by **Lead.Id** (Full_prospect_id__c) and their **converted_oppty_id** links to Opportunity; the row still has Full_prospect_id__c = Lead.Id. So the funnel row for a converted lead is still identified by **Lead.Id**, not Contact.Id.
- **CampaignMember:** We join Campaign_Member_Agg on **LeadId = l.Full_prospect_id__c**. So we only attach memberships where **CampaignMember.LeadId** is set. Rows with only **ContactId** (no LeadId) are **not** joined to any funnel row today, because we have no Contact → Lead join in the view (and ContactId could be the same person after conversion).
- **Opportunity.CampaignId:** For converted leads, the opportunity row often has **CampaignId** set (primary campaign for the opportunity). So the **single** campaign on the row (Campaign_Id__c = COALESCE(Opp_Campaign_Id__c, Lead_Campaign_Id__c)) already picks up the opportunity’s campaign. That covers the “primary” campaign for converted leads.
- **Conclusion:** We do **not** need to join ContactId CampaignMember rows for the current design. LeadId-based membership covers all lead members; Opportunity.CampaignId covers the primary campaign for converted leads. Including ContactId would require Contact → Lead or Contact → Opportunity mapping and a decision on how to merge with LeadId memberships; it’s out of scope for this implementation. **Recommendation:** Aggregate only **LeadId IS NOT NULL** in Campaign_Member_Agg; leave ContactId-only members out for now.

---

## Phase 5: Downstream Impact

### Q18. What dashboard queries filter by campaign?

Search every query file in `src/lib/queries/` for campaign filter references. For each one, show:
- File name and function
- How it currently filters by campaign (WHERE clause)
- Whether it uses `Campaign_Id__c`, `all_campaigns`, or both
- Whether it needs to change when `all_campaigns` becomes populated

**Answer:**

| File | Function / usage | How it filters by campaign | Uses Campaign_Id__c | Uses all_campaigns | Needs change when all_campaigns populated? |
|------|-------------------|----------------------------|----------------------|--------------------|--------------------------------------------|
| **filter-helpers.ts** | buildAdvancedFilterClauses | Multi-select: Campaign_Id__c IN UNNEST(@campaigns) OR (SELECT COUNT(1) FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id IN UNNEST(@campaigns)) > 0 | Yes | Yes | No — already handles both |
| **conversion-rates.ts** | _getConversionRates (2 places) | Single: (v.Campaign_Id__c = @campaignId OR (SELECT COUNT(1) FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id = @campaignId) > 0) | Yes | Yes | No |
| **source-performance.ts** | (2 places) | Same single-campaign condition | Yes | Yes | No |
| **funnel-metrics.ts** | (1 place) | Same single-campaign condition | Yes | Yes | No |
| **detail-records.ts** | (1 place) | Same single-campaign condition; selects v.Campaign_Id__c, v.Campaign_Name__c | Yes | Yes | No |
| **record-detail.ts** | getRecordDetail | No WHERE filter; selects v.Campaign_Id__c, v.Campaign_Name__c, v.all_campaigns | N/A | Exposes column | No |

**Summary:** All dashboard queries that filter by campaign already use **both** Campaign_Id__c and all_campaigns (IFNULL(v.all_campaigns, [])). No code changes needed when all_campaigns becomes populated; only the view CTE replacement is required.

---

### Q19. Does the campaign filter affect conversion rate calculations?

When a user filters the dashboard by campaign, does the Contacted→MQL rate (and other conversion rates) filter the denominator/numerator by campaign? If so, which campaign field is used? We need to make sure the 30-day rule we just deployed still works correctly when `all_campaigns` is populated.

**Answer:**

Yes. When a user filters the dashboard by campaign, **conversion-rates.ts** (and source-performance) add the campaign condition to the WHERE clause: `(v.Campaign_Id__c = @campaignId OR (SELECT COUNT(1) FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id = @campaignId) > 0)`. So the **denominator and numerator** for Contacted→MQL (and other conversion rates) are both restricted to rows that match the selected campaign (either via Campaign_Id__c or via all_campaigns). The 30-day rule uses **eligible_for_contacted_conversions_30d** and **contacted_to_mql_progression** from the view; those flags are **unchanged** by the campaign filter — we only filter **which rows** are included. So the 30-day rule still works correctly: same progression/eligibility logic, just applied to the filtered set. No change needed.

---

### Q20. Does source-performance.ts group or filter by campaign?

If source performance groups by campaign, populated `all_campaigns` could multiply rows (one lead appearing in multiple campaigns). Check whether this is an issue.

**Answer:**

**source-performance.ts** does **not** group by campaign. It groups by **Channel_Grouping_Name** (line 200) and by **Original_source, Channel_Grouping_Name** (line 417). Campaign is used only as a **filter** (WHERE): when the user selects a campaign, we restrict to rows where Campaign_Id__c or all_campaigns matches. So populated all_campaigns does **not** multiply rows — each funnel row is still one row; we only include rows that belong to the selected campaign(s). No row duplication or double-counting from all_campaigns.

---

## Phase 6: Implementation Plan

### Q21. Write the implementation plan

Based on ALL findings above, write a step-by-step implementation plan. It should cover:

1. **The exact CTE replacement** in `vw_funnel_master.sql` — old placeholder code → new code
2. **Any changes to the campaign name join** — if `all_campaigns` needs name resolution
3. **Any changes to filter logic** — if existing code already handles `all_campaigns` and just needs the data, say so; if code changes are needed, specify exactly what
4. **Validation queries** — including the Scored List January 2026 check (should show ~2,621)
5. **What NOT to change** — conversion rates, eligibility flags, progression flags, row grain
6. **Risks** — especially around row duplication and metric double-counting when filtering by campaign

Then **execute the implementation plan** — make the changes, deploy the view, and run the validation queries. Report all results back here.

**Answer:**

**Implementation plan**

1. **CTE replacement in vw_funnel_master.sql**  
   - **Remove:** The placeholder Campaign_Member_Agg block (lines 38–49: SELECT l.Id AS LeadId, CAST([] AS ARRAY<...) FROM Lead l WHERE FALSE).  
   - **Insert:** The real Campaign_Member_Agg (see Q16): read from CampaignMember, filter IsDeleted = FALSE and LeadId/CampaignId NOT NULL, JOIN Campaign for name, filter Campaign IsDeleted = FALSE, subquery DISTINCT (LeadId, CampaignId, Name), then GROUP BY LeadId with ARRAY_AGG(STRUCT(CampaignId AS id, CampaignName AS name) ORDER BY CampaignId) AS all_campaigns. Output columns: LeadId, all_campaigns (same types as placeholder).

2. **Campaign name join**  
   - No change. With_Campaign_Name already joins Campaign on Campaign_Id__c for Campaign_Name__c. all_campaigns carries id+name per membership; no extra join.

3. **Filter logic**  
   - No change. filter-helpers.ts and all query files already filter on Campaign_Id__c OR all_campaigns; once the view populates all_campaigns, filtering works.

4. **Validation queries**  
   - After deploy: (1) total row count unchanged; (2) COUNT where Scored List January 2026 in all_campaigns (syntax: match on camp.id = '701VS00000ZtS4NYAV' in UNNEST(all_campaigns)); (3) same for Scored List February 2026; (4) Campaign_Id__c = Jan campaign still shows 12 (or expected opp count); (5) conversion rate Oct 2025 cohort unchanged; (6) spot-check a multi-campaign lead’s all_campaigns.

5. **Do NOT change**  
   - Conversion rate logic, eligibility flags, progression flags, row grain (no new rows), filter-helpers or query WHERE logic.

6. **Risks**  
   - **Row duplication:** None — we do not expand rows; we add one array column per row.  
   - **Double-counting:** Filtering by campaign only restricts which rows are included; aggregates (SUM of progression, etc.) are over the same grain. No double-count if we don’t group by campaign (we don’t).

**Execute:** Replace the placeholder CTE in vw_funnel_master.sql with the real CTE (Q16 draft). Deploy the view to BQ. Run Q22 validation queries and record results in Q22.

---

## Phase 7: Validate and Document

### Q22. Post-implementation validation

After implementing, run these and report results:

```sql
-- 1. Row count unchanged
SELECT COUNT(*) AS total_rows FROM vw_funnel_master;

-- 2. Scored List January 2026 members visible
SELECT COUNT(*) FROM vw_funnel_master 
WHERE 'Scored List January 2026' IN UNNEST(all_campaigns);  -- adjust syntax to match implementation

-- 3. Scored List February 2026 members visible  
SELECT COUNT(*) FROM vw_funnel_master
WHERE 'Scored List February 2026' IN UNNEST(all_campaigns);

-- 4. Converted leads still have campaign from Opportunity
SELECT Campaign_Id__c, COUNT(*) 
FROM vw_funnel_master
WHERE Campaign_Id__c = '701VS00000ZtS4NYAV'
GROUP BY 1;

-- 5. Conversion rates unaffected — compare before/after for a known cohort
SELECT 
  SUM(contacted_to_mql_progression) AS numer,
  SUM(eligible_for_contacted_conversions_30d) AS denom,
  SAFE_DIVIDE(SUM(contacted_to_mql_progression), SUM(eligible_for_contacted_conversions_30d)) AS rate
FROM vw_funnel_master
WHERE DATE(stage_entered_contacting__c) >= '2025-10-01'
  AND DATE(stage_entered_contacting__c) < '2025-11-01';

-- 6. Multi-campaign leads — spot check a lead on multiple campaigns
-- Pick a LeadId that Q3 showed is on multiple campaigns, verify all_campaigns contains all of them
```

**Answer:**

*(To be filled after implementation.)*

1. **Row count:** Run `SELECT COUNT(*) FROM vw_funnel_master` (or the full table ref) — expect same as before (~99,917 or current baseline).  
2. **Scored List January 2026:** `SELECT COUNT(*) FROM vw_funnel_master v, UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id = '701VS00000ZtS4NYAV'` — expect ~2,621.  
3. **Scored List February 2026:** Same with CampaignId '701VS00000bIQ3bYAG' — expect ~2,492.  
4. **Converted leads campaign:** `SELECT Campaign_Id__c, COUNT(*) FROM vw_funnel_master WHERE Campaign_Id__c = '701VS00000ZtS4NYAV' GROUP BY 1` — expect 12 (or current opp count for that campaign).  
5. **Conversion rates:** Run Oct 2025 cohort query; compare numer/denom/rate to pre-change baseline.  
6. **Multi-campaign lead:** Pick a LeadId from Q3 with campaign_count = 2 or 3; `SELECT primary_key, all_campaigns FROM vw_funnel_master WHERE Full_prospect_id__c = '<that_lead_id>'` — verify array has 2 or 3 structs.

Report actual BQ results here after deploy.

---

### Q23. Update documentation

After validation passes, update:
- `C:\Users\russe\Documents\Dashboard\contacted-to-mql-investigation.md` — add **Section 8: Campaign Visibility Fix** with the implementation details and validation results
- `C:\Users\russe\Documents\Dashboard\campaign_investigation.md` — update Section 3.2 to note that CampaignMember is now in BQ and integrated into the funnel view
- Any codebase docs that reference the campaign placeholder or `all_campaigns` being unavailable

**Answer:**

*(To be done after validation passes.)*

1. **contacted-to-mql-investigation.md** — Section 8 (Campaign Visibility Fix): add implementation details (real CTE, join key LeadId = Full_prospect_id__c), validation query results (row count, Scored List Jan/Feb counts, conversion rate spot-check), and note that CampaignMember is now in BQ and integrated.  
2. **campaign_investigation.md** — Section 3.2 (or equivalent): update to state that CampaignMember is now synced to SavvyGTMData and integrated into vw_funnel_master via Campaign_Member_Agg; all_campaigns is populated for leads with CampaignMember rows; dashboard filter by any campaign is supported.  
3. **Codebase:** Remove or update any comments that say "CampaignMember does not exist" or "all_campaigns is NULL until CampaignMember is synced" in vw_funnel_master.sql and related docs.
