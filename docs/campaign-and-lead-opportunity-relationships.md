# Campaign and How It Relates to Leads and Opportunities

Reference for **`savvy-gtm-analytics.SavvyGTMData.Campaign`** and its relationships to Lead and Opportunity in BigQuery (location: **northamerica-northeast2**).

---

## 1. The Campaign table

**Table:** `savvy-gtm-analytics.SavvyGTMData.Campaign`  
**Row count (active):** 29 campaigns (`IsDeleted = FALSE`).

### Key columns

| Column | Type | Meaning |
|--------|------|--------|
| **Id** | STRING | Primary key; used to link from Lead and Opportunity. |
| **Name** | STRING | Display name. |
| **Type** | STRING | e.g. "Other", "Search". |
| **Status** | STRING | e.g. "In Progress". |
| **IsActive** | BOOLEAN | Used for filter-options (only active campaigns in dropdown). |
| **CampaignMemberRecordTypeId** | STRING | Salesforce record type for campaign members; you can use this in `SELECT CampaignMemberRecordTypeId FROM ...Campaign LIMIT 1000` etc. |
| **NumberOfLeads** | INTEGER | **Roll-up in Salesforce** — count of **CampaignMember** rows (lead members). Not derived from `Lead.Campaign__c` in BQ. |
| **NumberOfOpportunities** | INTEGER | **Roll-up in Salesforce** — count of opportunities associated with the campaign. |
| **NumberOfConvertedLeads** | INTEGER | Roll-up of converted leads. |
| **Campaign_UTM__c** | STRING | Custom UTM. |
| **Distribution_Group__c**, **Automated_Distribution__c** | STRING, BOOLEAN | Custom. |

So **Campaign** is the standard Salesforce campaign object: one row per campaign, with roll-up fields that in Salesforce are fed by **CampaignMember** (and related opportunities). In BQ we do **not** have **CampaignMember**; we only have direct lookups on Lead and Opportunity.

---

## 2. Relationship: Campaign ↔ Lead

### In BigQuery

- **Lead** has a **single** campaign lookup: **`Lead.Campaign__c`** (custom field, STRING = Campaign Id).
- **vw_funnel_master** uses it as `Lead_Campaign_Id__c` and then `Campaign_Id__c = COALESCE(Opp_Campaign_Id__c, Lead_Campaign_Id__c)`.

### What we see in SavvyGTMData

- **4,283** leads have `Campaign__c` set (non-null, non-empty).
- Those leads reference **13 distinct** campaign IDs.
- **13 campaigns** have at least one lead with `Lead.Campaign__c = Campaign.Id`.

So in BQ, the only link from Lead to Campaign is **one campaign per lead** via `Lead.Campaign__c`. We do **not** see “all campaigns this lead is a member of” (that would require **CampaignMember**, which is not in this dataset).

---

## 3. Relationship: Campaign ↔ Opportunity

### In BigQuery

- **Opportunity** has standard field **`Opportunity.CampaignId`** (STRING = Campaign Id).
- **vw_funnel_master** uses it as `Opp_Campaign_Id__c` and then `Campaign_Id__c = COALESCE(Opp_Campaign_Id__c, Lead_Campaign_Id__c)`.

### What we see in SavvyGTMData

- At least **1** opportunity has `CampaignId` set (e.g. campaign "XYPN Advisors Nov 2025").
- **7 campaigns** have at least one opportunity with `Opportunity.CampaignId = Campaign.Id`.

So in BQ, the only link from Opportunity to Campaign is **one campaign per opportunity** via `CampaignId`.

---

## 4. How the funnel view uses Campaign

In **`views/vw_funnel_master.sql`**:

1. **Lead_Base**  
   - `Campaign__c AS Lead_Campaign_Id__c`

2. **Opp_Base**  
   - `CampaignId AS Opp_Campaign_Id__c`

3. **Combined**  
   - `Campaign_Id__c = COALESCE(o.Opp_Campaign_Id__c, l.Lead_Campaign_Id__c)`  
   - So each row has **at most one** campaign: opportunity campaign if present, else lead campaign.

4. **With_Campaign_Name**  
   - `LEFT JOIN ...Campaign c ON wsl.Campaign_Id__c = c.Id`  
   - Adds `Campaign_Name__c` for that single campaign.

5. **Campaign_Member_Agg (placeholder)**  
   - Intended to add **all_campaigns** (array of all campaign memberships per lead) once **CampaignMember** exists in BQ.  
   - Today it returns no rows, so `all_campaigns` is always NULL.

So today, **campaign in the funnel = single campaign per row**, from either the lead or the opportunity, and only for records where `Lead.Campaign__c` or `Opportunity.CampaignId` is set.

---

## 5. The gap: Campaign.NumberOfLeads vs Lead.Campaign__c

- **Campaign.NumberOfLeads** in Salesforce is a **roll-up of CampaignMember** (how many lead members the campaign has). In BQ we just have that number on **Campaign**; we do **not** have the **CampaignMember** rows.
- **Lead.Campaign__c** is a **single lookup** on the lead. Many campaigns (e.g. “Scored List January 2026”) add leads as **members** (CampaignMember) but do **not** set `Lead.Campaign__c`. So:
  - Campaign may show **NumberOfLeads = 2,621**.
  - **Leads with Lead.Campaign__c = that campaign** can be **0**.
  - The funnel view then shows **0** leads for that campaign when filtering by `Campaign_Id__c`, until we have **CampaignMember** in BQ and use it (e.g. `all_campaigns`).

---

## 6. Summary

| Link | Source | Meaning in BQ |
|------|--------|----------------|
| **Campaign → Lead** | `Lead.Campaign__c` | Single campaign per lead (only 4,283 leads have it set; 13 campaigns referenced). |
| **Campaign → Opportunity** | `Opportunity.CampaignId` | Single campaign per opportunity (7 campaigns have ≥1 opp). |
| **Campaign roll-ups** | `Campaign.NumberOfLeads`, `NumberOfOpportunities`, etc. | Stored on Campaign; in Salesforce they come from CampaignMember / related data. |
| **CampaignMember** | Not in BQ | Would give “all campaigns per lead”; required for filtering by any campaign a lead belongs to (see Section 8 in `contacted-to-mql-investigation.md`). |

**CampaignMemberRecordTypeId** on Campaign is a Salesforce configuration field (record type for campaign members); it does not change how Lead/Opportunity link to Campaign in BQ — those links are only **Lead.Campaign__c** and **Opportunity.CampaignId**.
