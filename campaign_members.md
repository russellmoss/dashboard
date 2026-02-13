# Campaign Membership for Re-Engagement Opportunities — Investigation

**Date:** 2026-02-11  
**Context:** Feeds into Re-Engagement funnel implementation (Option A — UNION Re-Engagement with Lead_Base in `vw_funnel_master`). We need to connect Re-Engagement records to campaigns so existing campaign filtering in the dashboard works.  
**Reference:** See `re_engagement_opp_exploration.md`; see also `docs/re-engagement-record-type.md` if present in the repo.

---

## 1. Do Re-Engagement opportunities have ContactId populated?

**Query:**
```sql
SELECT
  COUNT(*) AS total_re_eng,
  COUNT(ContactId) AS with_contact_id,
  ROUND(100.0 * COUNT(ContactId) / COUNT(*), 1) AS pct_with_contact_id
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
WHERE IsDeleted = FALSE
  AND RecordTypeId = '012VS000009VoxrYAC'
```

**Results:**

| Metric | Value |
|--------|--------|
| Total Re-Engagement opps | 798 |
| With ContactId IS NOT NULL | 388 |
| **Coverage %** | **48.6%** |

**Finding:** About half of Re-Engagement opportunities have a Contact; the rest have no ContactId. Campaign membership via Contact will only apply to the 388 with ContactId.

---

## 2. Do Re-Engagement opportunities have CampaignId populated?

**Query:**
```sql
SELECT
  COUNT(*) AS total_re_eng,
  COUNT(CampaignId) AS with_campaign_id,
  ROUND(100.0 * COUNT(CampaignId) / COUNT(*), 1) AS pct_with_campaign_id
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
WHERE IsDeleted = FALSE
  AND RecordTypeId = '012VS000009VoxrYAC'
```

**Results:**

| Metric | Value |
|--------|--------|
| Total Re-Engagement opps | 798 |
| With CampaignId IS NOT NULL | 0 |
| **Coverage %** | **0%** |

**Sample:** No rows with CampaignId; no sample values. Re-Engagement opps do **not** have the standard Opportunity.CampaignId field set. Campaign linkage for Re-Engagement must come from CampaignMember via Contact (or a future custom field), not from Opportunity.CampaignId.

---

## 3. Do the Contacts on Re-Engagement opps have CampaignMember records?

**Query (counts):**
```sql
SELECT
  COUNT(DISTINCT o.Id) AS re_eng_opps_with_contact,
  COUNT(DISTINCT CASE WHEN cm.Id IS NOT NULL THEN o.Id END) AS re_eng_opps_with_cm_via_contact,
  COUNT(DISTINCT cm.CampaignId) AS distinct_campaigns
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.CampaignMember` cm
  ON cm.ContactId = o.ContactId AND cm.IsDeleted = FALSE AND cm.CampaignId IS NOT NULL
WHERE o.IsDeleted = FALSE
  AND o.RecordTypeId = '012VS000009VoxrYAC'
  AND o.ContactId IS NOT NULL
```

**Query (avg memberships per Re-Engagement Contact that has ≥1 CM):**
```sql
WITH re_eng_cm AS (
  SELECT o.Id AS opp_id, o.ContactId, cm.CampaignId
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
  INNER JOIN `savvy-gtm-analytics.SavvyGTMData.CampaignMember` cm
    ON cm.ContactId = o.ContactId AND cm.IsDeleted = FALSE AND cm.CampaignId IS NOT NULL
  WHERE o.IsDeleted = FALSE
    AND o.RecordTypeId = '012VS000009VoxrYAC'
    AND o.ContactId IS NOT NULL
)
SELECT
  COUNT(DISTINCT opp_id) AS re_eng_contacts_with_cm,
  COUNT(*) AS total_cm_rows,
  ROUND(COUNT(*) * 1.0 / COUNT(DISTINCT opp_id), 2) AS avg_memberships_per_contact
FROM re_eng_cm
```

**Results:**

| Metric | Value |
|--------|--------|
| Re-Engagement opps with ContactId | 388 |
| Re-Engagement opps with ≥1 CampaignMember via Contact | **3** |
| Distinct campaigns linked this way | 2 |
| Re-Engagement Contacts with ≥1 CM | 3 |
| Total CampaignMember rows (Contact) for those | 3 |
| **Avg campaign memberships per Re-Engagement Contact (with CM)** | **1.00** |

**Finding:** Only 3 of 388 Re-Engagement-with-Contact have any CampaignMember on their Contact; 2 distinct campaigns. So today very few Re-Engagement records would get campaign data from Contact-based CampaignMember, but the **mechanism** (join CampaignMember on ContactId) is valid for when more Contacts are added to campaigns.

---

## 4. Does CampaignMember have both LeadId and ContactId columns? Are they mutually exclusive?

**Schema check:** `SavvyGTMData.CampaignMember` — **LeadId** (STRING) and **ContactId** (STRING) both exist.

**Query:**
```sql
SELECT
  COUNT(*) AS total_rows,
  COUNT(LeadId) AS with_lead_id,
  COUNT(ContactId) AS with_contact_id,
  SUM(CASE WHEN LeadId IS NOT NULL AND ContactId IS NOT NULL THEN 1 ELSE 0 END) AS both_populated,
  SUM(CASE WHEN LeadId IS NOT NULL AND ContactId IS NULL THEN 1 ELSE 0 END) AS lead_only,
  SUM(CASE WHEN LeadId IS NULL AND ContactId IS NOT NULL THEN 1 ELSE 0 END) AS contact_only,
  SUM(CASE WHEN LeadId IS NULL AND ContactId IS NULL THEN 1 ELSE 0 END) AS neither
FROM `savvy-gtm-analytics.SavvyGTMData.CampaignMember`
WHERE IsDeleted = FALSE
```

**Results:**

| Metric | Value |
|--------|--------|
| total_rows | 11,654 |
| with_lead_id | 11,644 |
| with_contact_id | 45 |
| **both_populated** | **35** |
| lead_only | 11,609 |
| contact_only | 10 |
| neither | 0 |

**Sample (LeadId only):** LeadId = `00QDn0000051gvWMAQ`, ContactId = NULL, CampaignId = `701Dn000001FsIoIAK`.  
**Sample (both):** LeadId = `00QVS0000041iHs2AI`, ContactId = `003VS00000FT9orYAD`, CampaignId = `701VS000004iMljYAE`.

**Finding:** Both columns exist. They are **not** mutually exclusive: 35 rows have **both** LeadId and ContactId (likely post-conversion CampaignMember rows). Majority are lead_only; a small number are contact_only. So any logic that “groups by LeadId or ContactId” must avoid double-counting when a row has both (e.g. use separate aggregates by LeadId and by ContactId, then attach to the right prospect type).

---

## 5. How does Campaign_Member_Agg currently work in vw_funnel_master?

**Current CTE (from `views/vw_funnel_master.sql`):**
```sql
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
    LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.Campaign` c
      ON c.Id = cm.CampaignId AND c.IsDeleted = FALSE
    WHERE cm.IsDeleted = FALSE
      AND cm.LeadId IS NOT NULL
      AND cm.CampaignId IS NOT NULL
  )
  GROUP BY LeadId
),
```

**Join in Combined:** `LEFT JOIN Campaign_Member_Agg cma ON cma.LeadId = l.Full_prospect_id__c`

**Conclusion:** Campaign_Member_Agg is keyed **only by LeadId**. Re-Engagement “leads” in Option A will use **Opportunity.Id** as `Full_prospect_id__c` (or equivalent primary key). CampaignMember.LeadId is always a **Lead** Id (prefix `00Q`), never an Opportunity Id (prefix `006`). So for Re-Engagement rows (no lead, prospect = Opportunity Id), `cma.LeadId = <Opportunity Id>` will **never** match, and Re-Engagement rows would get **NULL** for `all_campaigns` with the current join. Confirmed: Re-Engagement records would get no campaign membership from the current CTE.

---

## 6. If we add a ContactId-based join path, would it cause duplication?

**Query (converted leads — do they have CampaignMember on BOTH LeadId and ConvertedContactId?):**
```sql
WITH converted_leads AS (
  SELECT Id AS LeadId, ConvertedContactId
  FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
  WHERE IsConverted = TRUE AND ConvertedContactId IS NOT NULL
  LIMIT 500
),
lead_cm AS (...),
contact_cm AS (...)
SELECT
  COUNT(DISTINCT l.LeadId) AS converted_leads_checked,
  SUM(CASE WHEN l.campaign_id_lead IS NOT NULL THEN 1 ELSE 0 END) AS leads_with_cm_on_lead_id,
  SUM(CASE WHEN c.campaign_id_contact IS NOT NULL THEN 1 ELSE 0 END) AS leads_with_cm_on_contact_id,
  SUM(CASE WHEN l.campaign_id_lead IS NOT NULL AND c.campaign_id_contact IS NOT NULL THEN 1 ELSE 0 END) AS leads_with_cm_on_both
FROM lead_cm l JOIN contact_cm c ON l.LeadId = c.LeadId
```

**Results (500 converted leads sampled):**

| Metric | Value |
|--------|--------|
| converted_leads_checked | 500 |
| leads_with_cm_on_lead_id | 10 |
| leads_with_cm_on_contact_id | 9 |
| **leads_with_cm_on_both** | **8** |

So **8** of 500 had CampaignMember on **both** LeadId and ConvertedContactId. For those 8, lead and contact campaign sets in the sample were **the same** (e.g. lead_campaign_ids = contact_campaign_ids = `['701VS00000YdiVVYAZ']`). So: if we joined on **both** LeadId and ContactId and merged/union’d campaigns into one `all_campaigns`, we could get **duplicate campaign ids** in the array for converted leads (same campaign from Lead and from Contact). We would **not** get extra **rows** in Combined if we still only join **one** source per row (e.g. use LeadId for lead rows and ContactId only for opp-only rows). Row duplication would occur only if we did two joins (cma_lead and cma_contact) without restricting one join to “opp-only” rows.

**Finding:** Use a single source of campaigns per row: **LeadId** when the row has a lead, **ContactId** only when the row has no lead (Re-Engagement-only). That avoids row duplication and avoids duplicate campaign ids in `all_campaigns`.

---

## 7. Recommended join strategy (safest approach)

**Goals:**
- Preserve current behavior for real Leads (join on LeadId).
- Add campaign membership for Re-Engagement “leads” via ContactId on the Re-Engagement opp.
- Do **not** cause row duplication in Combined.

**Recommendation: Two separate CTEs, join with mutually exclusive conditions.**

- **Campaign_Member_Agg_By_Lead:** Same as current Campaign_Member_Agg (group by LeadId, produce `all_campaigns`). Used for rows that have a Lead (`l.Full_prospect_id__c IS NOT NULL`).
- **Campaign_Member_Agg_By_Contact:** New CTE grouped by ContactId, same structure (ContactId, `all_campaigns`). Used only for rows that have **no** Lead and have an Opportunity with ContactId (Re-Engagement-only rows in Option A).

**Join logic in Combined:**
- `LEFT JOIN Campaign_Member_Agg_By_Lead cma_lead ON cma_lead.LeadId = l.Full_prospect_id__c`
- `LEFT JOIN Campaign_Member_Agg_By_Contact cma_contact ON cma_contact.ContactId = o.ContactId AND l.Full_prospect_id__c IS NULL`

Then: `all_campaigns = COALESCE(cma_lead.all_campaigns, cma_contact.all_campaigns)`.

**Rationale:**
- Lead rows (including converted lead + opp): use only LeadId; `l.Full_prospect_id__c` is set, so `cma_contact` join condition fails (we don’t join contact agg for them). No duplication.
- Re-Engagement-only rows (no lead, opp only): `l.Full_prospect_id__c` is NULL, so we join `cma_contact` on `o.ContactId` and get campaigns for that Contact. No LeadId to join, so no second row from cma_lead.
- We never attach both lead and contact campaign agg to the same row, so no row duplication and no duplicate campaign ids in `all_campaigns`.

**Risks / edge cases:**
- Re-Engagement opps with **no** ContactId (51.4%) will still have NULL `all_campaigns`; that’s expected until they get a Contact or another campaign mechanism.
- If in the future a Re-Engagement row is also joined to a Lead (e.g. same person as lead), then with this design we’d still prefer the lead’s campaigns (COALESCE(lead, contact)); that’s consistent with “lead is primary when present.”

---

## 8. Does Lead_Base have access to ConvertedContactId?

**Schema:** `SavvyGTMData.Lead` includes **ConvertedContactId** (STRING).

**Query:**
```sql
SELECT
  COUNT(*) AS total_leads,
  COUNT(CASE WHEN IsConverted = TRUE THEN 1 END) AS converted_leads,
  COUNT(CASE WHEN IsConverted = TRUE AND ConvertedContactId IS NOT NULL THEN 1 END) AS converted_with_contact_id,
  ROUND(100.0 * COUNT(CASE WHEN IsConverted = TRUE AND ConvertedContactId IS NOT NULL THEN 1 END) / NULLIF(COUNT(CASE WHEN IsConverted = TRUE THEN 1 END), 0), 1) AS pct_converted_with_contact_id
FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
WHERE IsDeleted = FALSE
```

**Results:**

| Metric | Value |
|--------|--------|
| total_leads | 99,644 |
| converted_leads | 1,504 |
| converted_with_contact_id | 1,495 |
| **pct_converted_with_contact_id** | **99.4%** |

**Finding:** ConvertedContactId exists on Lead and is populated for **99.4%** of converted leads. We could add it to Lead_Base and use it as a secondary key for campaign membership; however, for the recommended approach we do **not** need to join campaign by ContactId for **lead** rows (we use LeadId only for them). So adding ConvertedContactId to Lead_Base is optional for campaign logic; it could still be useful for other reporting or for a “unified campaign by Contact” experiment later.

---

## Draft SQL: Recommended CTE change

Replace the single `Campaign_Member_Agg` CTE with two CTEs and update the join and `all_campaigns` in Combined as below.

**New CTEs:**
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

**In Combined:** Replace the single Campaign_Member_Agg join with:
```sql
  FROM Lead_Base l
  FULL OUTER JOIN Opp_Base o
    ON l.converted_oppty_id = o.Full_Opportunity_ID__c
  LEFT JOIN Campaign_Member_Agg_By_Lead cma_lead
    ON cma_lead.LeadId = l.Full_prospect_id__c
  LEFT JOIN Campaign_Member_Agg_By_Contact cma_contact
    ON cma_contact.ContactId = o.ContactId AND l.Full_prospect_id__c IS NULL
```

**Select for all_campaigns:**
```sql
    COALESCE(cma_lead.all_campaigns, cma_contact.all_campaigns) AS all_campaigns,
```

**Note:** This applies once Option A is implemented (Re-Engagement rows appear as prospect rows with no lead, e.g. from a UNION with Lead_Base). Until then, `l.Full_prospect_id__c IS NULL` in the join would only apply to existing “opp-only” rows from the current FULL OUTER JOIN (opportunities with no converting lead); those are mostly Recruiting opps created without a lead. After Option A, Re-Engagement rows will explicitly be in the prospect set with no lead side, so the ContactId join will apply to them.

---

## Summary table

| Question | Finding |
|----------|---------|
| **1. ContactId on Re-Engagement** | 798 total; 388 (48.6%) have ContactId. |
| **2. CampaignId on Re-Engagement** | 0 (0%); no standard CampaignId. |
| **3. CampaignMember via Contact** | 3 Re-Engagement opps have ≥1 CampaignMember via Contact; 2 distinct campaigns; avg 1 membership per contact with CM. |
| **4. LeadId vs ContactId** | Both exist; not mutually exclusive (35 rows have both). |
| **5. Current Campaign_Member_Agg** | Keyed by LeadId only; Re-Engagement (Opportunity Id) would get NULL from current join. |
| **6. Duplication risk** | 8/500 converted leads had CM on both Lead and Contact; same campaigns. Join only one source per row to avoid row and array duplication. |
| **7. Safest strategy** | Two CTEs (By_Lead, By_Contact); join lead agg when row has lead, contact agg when row has no lead (Re-Engagement); COALESCE(lead, contact) for all_campaigns. |
| **8. ConvertedContactId on Lead** | Exists; 99.4% of converted leads have it; optional for campaign logic with above strategy. |
