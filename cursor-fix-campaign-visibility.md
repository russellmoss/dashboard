# Fix: Campaign Visibility — Join CampaignMember into Funnel View

## Problem

When leads are added to a scored list campaign (e.g., "Scored List January 2026"), they become CampaignMembers in Salesforce. But `vw_funnel_master` derives campaign from `COALESCE(Opp_Campaign_Id__c, Lead_Campaign_Id__c)`. For this campaign:

- `Lead.Campaign__c` = empty for all 2,621 leads
- `Opportunity.CampaignId` = set for only the 12 that converted

Result: the dashboard only sees 12 of 2,621 campaign members. The other 2,609 leads show up with no campaign, so filtering by "Scored List January 2026" misses them entirely.

**Important context:** Leads CAN be members of multiple campaigns simultaneously (e.g., a scored list campaign AND an experimentation campaign). The solution must handle multi-campaign membership without breaking the view's grain or duplicating rows for non-campaign metrics.

---

## Phase 1: Investigation (do this before writing any code)

### Step 1: Check if CampaignMember is in BigQuery

Use the BQ MCP connection to check:

```sql
-- Check if CampaignMember table exists
SELECT table_name 
FROM `savvy-gtm-analytics.SavvyGTMData.INFORMATION_SCHEMA.TABLES`
WHERE LOWER(table_name) LIKE '%campaignmember%' OR LOWER(table_name) LIKE '%campaign_member%';
```

Also check:
```sql
-- Check for any table that might contain campaign membership data
SELECT table_name 
FROM `savvy-gtm-analytics.SavvyGTMData.INFORMATION_SCHEMA.TABLES`
WHERE LOWER(table_name) LIKE '%campaign%';
```

**If CampaignMember IS in BigQuery:** proceed to Step 2.

**If CampaignMember is NOT in BigQuery:** 
- Check if there's a Fivetran, Airbyte, Stitch, or other connector syncing Salesforce to BQ. Look at the dataset metadata, other table naming patterns, and any sync config in the codebase.
- Document what object needs to be added to the sync and where that configuration lives.
- Write the findings into `C:\Users\russe\Documents\Dashboard\contacted-to-mql-investigation.md` as a new **Section 8: Campaign Visibility Fix** so we know exactly what to enable.
- Then continue writing the design assuming CampaignMember WILL be available (so we're ready to deploy once the sync is added).

### Step 2: Understand CampaignMember schema

```sql
SELECT column_name, data_type
FROM `savvy-gtm-analytics.SavvyGTMData.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name = 'CampaignMember'  -- adjust to actual table name
ORDER BY ordinal_position;
```

Key fields we need:
- `LeadId` — the lead this membership belongs to
- `CampaignId` — the campaign ID
- `ContactId` — for converted leads
- `Status` — membership status (active, responded, etc.)
- `CreatedDate` — when the lead was added

### Step 3: Understand multi-campaign reality

This is critical. Map out how campaigns are actually used:

```sql
-- How many campaigns per lead?
SELECT 
  MIN(cnt) AS min_campaigns,
  AVG(cnt) AS avg_campaigns,
  MAX(cnt) AS max_campaigns,
  COUNTIF(cnt = 1) AS leads_with_1_campaign,
  COUNTIF(cnt = 2) AS leads_with_2_campaigns,
  COUNTIF(cnt = 3) AS leads_with_3_campaigns,
  COUNTIF(cnt > 3) AS leads_with_4plus_campaigns
FROM (
  SELECT LeadId, COUNT(DISTINCT CampaignId) AS cnt
  FROM `savvy-gtm-analytics.SavvyGTMData.CampaignMember`
  WHERE LeadId IS NOT NULL
  GROUP BY LeadId
);
```

```sql
-- What TYPES of campaigns exist? Is there a Type, RecordType, or naming pattern 
-- that distinguishes scored lists from experimentation from other campaigns?
SELECT 
  c.Type,
  c.RecordTypeId,
  CASE 
    WHEN c.Name LIKE 'Scored List%' THEN 'Scored List'
    WHEN c.Name LIKE '%Experiment%' OR c.Name LIKE '%Test%' THEN 'Experimentation'
    ELSE 'Other'
  END AS campaign_category,
  COUNT(DISTINCT cm.Id) AS member_count,
  COUNT(DISTINCT c.Id) AS campaign_count
FROM `savvy-gtm-analytics.SavvyGTMData.CampaignMember` cm
JOIN `savvy-gtm-analytics.SavvyGTMData.Campaign` c ON cm.CampaignId = c.Id
WHERE cm.LeadId IS NOT NULL
GROUP BY 1, 2, 3
ORDER BY member_count DESC;
```

```sql
-- For leads on multiple campaigns, what combinations exist?
-- (Are they on a scored list + an experiment? Two scored lists? etc.)
WITH lead_campaigns AS (
  SELECT 
    cm.LeadId,
    c.Name,
    CASE 
      WHEN c.Name LIKE 'Scored List%' THEN 'Scored List'
      ELSE 'Other'
    END AS campaign_type
  FROM `savvy-gtm-analytics.SavvyGTMData.CampaignMember` cm
  JOIN `savvy-gtm-analytics.SavvyGTMData.Campaign` c ON cm.CampaignId = c.Id
  WHERE cm.LeadId IS NOT NULL
),
lead_summary AS (
  SELECT 
    LeadId,
    COUNTIF(campaign_type = 'Scored List') AS scored_list_count,
    COUNTIF(campaign_type = 'Other') AS other_count,
    COUNT(*) AS total_count
  FROM lead_campaigns
  GROUP BY LeadId
)
SELECT 
  scored_list_count,
  other_count,
  COUNT(*) AS leads
FROM lead_summary
GROUP BY 1, 2
ORDER BY leads DESC;
```

### Step 4: Understand how experimentation tags currently work in the dashboard

Search the codebase for how experimentation tags are implemented:

1. Is there an `experimentation_tag` field on Lead? On Opportunity? In vw_funnel_master?
2. Does the dashboard filter by experimentation tag separately from campaign?
3. Is experimentation tag derived from campaign membership, or is it a separate field?
4. How does the dashboard UI let users "de-select experimentation tags" — is that a separate filter from campaign?

Search for: `experimentation`, `experiment_tag`, `Experimentation_Tag__c`, `experiment` in the codebase. Document what you find.

### Step 5: Understand the current view grain and campaign usage

```sql
-- What is the grain of vw_funnel_master? One row per lead? Per lead-opp pair?
SELECT 
  COUNT(*) AS total_rows,
  COUNT(DISTINCT lead_id) AS distinct_leads  -- adjust field name
FROM vw_funnel_master;
```

Also search the view SQL to answer:
1. What is the current campaign field called in the final SELECT? (`campaign_id`, `campaign_name`, `CampaignId`, etc.)
2. Is it a single field or are there multiple campaign-related fields?
3. How does the dashboard use campaign for filtering — by ID or name?
4. Is campaign used in GROUP BY for any metrics, or only as a filter?

---

## Phase 2: Design Decision

Based on the investigation, we need to choose an approach. The right design depends on what Phase 1 reveals. Here are the options — recommend one based on findings:

### Option A: Separate scored list campaign field (adds a column, not rows)

**When to use:** If the dashboard only needs campaign as a **filter** (not a GROUP BY dimension that multiplies metrics), and if leads are typically on just 1 scored list campaign (even if they're on other campaign types too).

**How it works:**
- Add a new field to the view (e.g., `scored_list_campaign_id`, `scored_list_campaign_name`) derived from CampaignMember, filtered to only scored list campaigns.
- Deduplicate to one scored list campaign per lead (most recent).
- Keep the existing `campaign_id`/`campaign_name` field from `COALESCE(Opp, Lead)` unchanged.
- Dashboard uses the new field for scored list filtering.

**Pros:** No row duplication. Simple. Existing metrics unaffected.  
**Cons:** Only handles scored list campaigns. Other campaign types (experimentation) need a separate approach.

### Option B: Extend COALESCE with CampaignMember fallback (adds a column, not rows)

**When to use:** If the current campaign field is primarily for scored lists and we just need to fill in the gaps.

**How it works:**
- Deduplicate CampaignMember to one "primary" campaign per lead (most recent, or scored list takes priority).
- Add as third fallback in existing COALESCE: `COALESCE(Opp_Campaign, Lead_Campaign, CM_Campaign)`.

**Pros:** Minimal change. One campaign field.  
**Cons:** Loses multi-campaign info. If a lead is on a scored list AND an experiment, we only see one.

### Option C: Typed campaign columns (one column per campaign category)

**When to use:** If leads are commonly on multiple campaigns of different types and the dashboard needs to filter by each independently.

**How it works:**
- Create deduplicated subqueries per campaign type (e.g., one for scored lists, one for experimentation).
- Add typed columns to the view: `scored_list_campaign_id`, `scored_list_campaign_name`, `experimentation_campaign_id`, `experimentation_campaign_name`.
- Each is derived from CampaignMember filtered by campaign type/name pattern, deduplicated to one per lead.
- Dashboard filters use the appropriate typed field.
- The existing `campaign_id`/`campaign_name` field stays as-is (from Opp/Lead COALESCE).

**Pros:** Full multi-campaign support. No row duplication. Each campaign type is independently filterable. Clean, explicit. Future-proof for new campaign types (just add a column).  
**Cons:** Requires knowing campaign type classification upfront. More columns in the view. Dashboard filter UI needs to know which field to use.

### Option D: Campaign membership as an array/STRING_AGG field

**When to use:** If campaign types are unpredictable and you want maximum flexibility.

**How it works:**
- Add `all_campaign_ids` (ARRAY or comma-separated) and `all_campaign_names` to the view.
- Dashboard filtering uses UNNEST or CONTAINS.

**Pros:** Handles any number of campaigns.  
**Cons:** Harder to filter in SQL. Dashboard filtering logic is more complex.

### Option E: Junction view (multiplies rows by campaign)

**When to use:** If campaign is a true GROUP BY dimension (e.g., "show me metrics broken down by campaign").

**How it works:**
- Create `vw_funnel_by_campaign` that joins CampaignMember, producing one row per lead-campaign pair.

**Pros:** Full flexibility for GROUP BY.  
**Cons:** Row duplication. Metrics double-count. Most dangerous to get wrong.

### Recommendation criteria

Based on Phase 1 findings, recommend the approach by answering:

1. **How many campaign types matter for filtering?** If just scored lists → Option A or B. If scored lists + experimentation + others → Option C.
2. **Does the dashboard GROUP BY campaign for metrics, or just filter?** Filter only → Options A/B/C. GROUP BY → Option E (carefully).
3. **How does experimentation tagging work today?** If it's already a separate field (not from campaigns) → only need to solve for scored lists → Option A or B. If experimentation is ALSO from campaigns → Option C.
4. **What's the simplest change that unblocks the immediate need?** We need 2,621 leads to show up when filtering by "Scored List January 2026." What's the minimum viable change?

---

## Phase 3: Implementation

After choosing an approach in Phase 2, implement it. General rules regardless of approach:

1. **Do NOT change the existing campaign COALESCE** — add new fields/logic alongside it.
2. **Do NOT change row grain** unless explicitly choosing Option E.
3. **Do NOT change conversion rate logic, eligibility flags, or progression flags.**
4. **DO validate row count is unchanged** (unless Option E).
5. **DO validate the 12 converted January leads still show correctly.**

### Validation (run after implementation)

```sql
-- 1. Row count unchanged (Options A/B/C/D)
SELECT COUNT(*) FROM vw_funnel_master;

-- 2. Scored List January 2026 now shows all members
SELECT COUNT(*) 
FROM vw_funnel_master 
WHERE [new_campaign_field] = 'Scored List January 2026';
-- Expect: ~2,621

-- 3. Scored List February 2026 shows all members
SELECT COUNT(*) 
FROM vw_funnel_master 
WHERE [new_campaign_field] = 'Scored List February 2026';
-- Expect: ~2,486

-- 4. The 12 converted leads still have the right campaign
SELECT COUNT(*) 
FROM vw_funnel_master 
WHERE [new_campaign_field] = 'Scored List January 2026'
  AND is_mql = 1;

-- 5. Contacted→MQL 30-day rule unaffected
SELECT 
  SUM(contacted_to_mql_progression) AS numer,
  SUM(eligible_for_contacted_conversions_30d) AS denom
FROM vw_funnel_master
WHERE [new_campaign_field] = 'Scored List January 2026';
```

### Downstream checks

1. **Dashboard campaign filter** — does it populate with scored list campaigns?
2. **Campaign + experimentation tag interaction** — can users filter independently?
3. **Source performance by campaign** — correct numbers when filtered?
4. **Conversion rate cards** — unaffected by the campaign field change?

---

## Phase 4: Document

Write all findings and the chosen approach into `C:\Users\russe\Documents\Dashboard\contacted-to-mql-investigation.md` as a new **Section 8: Campaign Visibility Fix**. Include:
- Whether CampaignMember was already in BQ or needs to be synced
- Multi-campaign analysis results (how many leads on multiple campaigns, what types)
- How experimentation tags currently work
- The chosen design approach and rationale
- Implementation details
- Validation results
- Any remaining TODOs

---

## Summary

This is a two-phase task: **investigate first, then implement.** Do NOT jump to implementation before completing Phase 1 and making a design recommendation in Phase 2. The multi-campaign reality means we need to understand the data shape before choosing an approach. The immediate goal is getting 2,621+ leads visible when filtering by "Scored List January 2026" — but the design must not break when leads are on multiple campaigns in the future.
