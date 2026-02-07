# Campaign Investigation: savvy-gtm-analytics.SavvyGTMData.Campaign

This document describes the **Campaign** table in BigQuery (dataset **SavvyGTMData**, project **savvy-gtm-analytics**, location **northamerica-northeast2**): all fields, data types, definitions, and how Campaign relates to the Lead object.

---

## 1. Table overview

| Property | Value |
|----------|--------|
| **Full table ID** | `savvy-gtm-analytics.SavvyGTMData.Campaign` |
| **Location** | northamerica-northeast2 |
| **Type** | TABLE (synced from Salesforce) |
| **Active row count** | 29 (where `IsDeleted = FALSE`) |
| **Source** | Salesforce Campaign standard object + custom fields |

---

## 2. All fields: data types and definitions

### 2.1 Identifiers and core attributes

| Field | Data type (BQ) | Nullable | Definition |
|-------|----------------|----------|------------|
| **Id** | STRING | YES | Primary key. 18-character Salesforce ID of the campaign. Used to link from Lead (`Lead.Campaign__c`) and Opportunity (`Opportunity.CampaignId`). |
| **IsDeleted** | BOOLEAN | YES | Soft-delete flag. Synced rows with `IsDeleted = TRUE` should be excluded in reporting. |
| **Name** | STRING | YES | Campaign name (display label). |
| **ParentId** | STRING | YES | Parent campaign ID when using campaign hierarchy. NULL for top-level campaigns. |
| **Type** | STRING | YES | Campaign type (picklist). In data: `Other`, `Email`, `Event`, `Search`, `Website Direct`, `List Upload`. |
| **Status** | STRING | YES | Campaign lifecycle status. In data: `Planned`, `In Progress`, `Completed`. |
| **Description** | STRING | YES | Long text description of the campaign. |

### 2.2 Dates

| Field | Data type (BQ) | Nullable | Definition |
|-------|----------------|----------|------------|
| **StartDate** | DATE | YES | Campaign start date. |
| **EndDate** | DATE | YES | Campaign end date. |
| **LastActivityDate** | DATE | YES | Date of last activity on the campaign (e.g. last campaign member update). |

### 2.3 Budget and response (standard roll-up / manual)

| Field | Data type (BQ) | Nullable | Definition |
|-------|----------------|----------|------------|
| **ExpectedRevenue** | FLOAT | YES | Expected revenue from the campaign. |
| **BudgetedCost** | FLOAT | YES | Budgeted cost. |
| **ActualCost** | FLOAT | YES | Actual cost. |
| **ExpectedResponse** | FLOAT | YES | Expected response rate (e.g. percentage). |
| **NumberSent** | FLOAT | YES | Number of items sent (e.g. emails, invites). |

### 2.4 Roll-up summary fields (from CampaignMember and related objects)

These counts are **maintained by Salesforce** from CampaignMember and related records. They are **not** recomputed in BigQuery; we only have the synced value.

| Field | Data type (BQ) | Nullable | Definition |
|-------|----------------|----------|------------|
| **NumberOfLeads** | INTEGER | YES | **Roll-up:** Count of **CampaignMember** rows where the member is a **Lead** (LeadId is set). Does *not* equal count of Lead records with `Lead.Campaign__c = Campaign.Id` — many campaigns add members via CampaignMember without setting Lead.Campaign__c. |
| **NumberOfConvertedLeads** | INTEGER | YES | **Roll-up:** Count of campaign members (leads) who have converted to Opportunity/Contact. |
| **NumberOfContacts** | INTEGER | YES | **Roll-up:** Count of CampaignMember rows where the member is a **Contact** (ContactId is set). |
| **NumberOfResponses** | INTEGER | YES | **Roll-up:** Count of campaign members with a “Responded” (or equivalent) status. |
| **NumberOfOpportunities** | INTEGER | YES | **Roll-up:** Count of opportunities associated with the campaign (e.g. via Opportunity.CampaignId or primary campaign source). |
| **NumberOfWonOpportunities** | INTEGER | YES | **Roll-up:** Count of won opportunities tied to the campaign. |
| **AmountAllOpportunities** | FLOAT | YES | **Roll-up:** Sum of Amount for all opportunities tied to the campaign. |
| **AmountWonOpportunities** | FLOAT | YES | **Roll-up:** Sum of Amount for won opportunities tied to the campaign. |

### 2.5 Ownership and audit

| Field | Data type (BQ) | Nullable | Definition |
|-------|----------------|----------|------------|
| **OwnerId** | STRING | YES | User ID of the campaign owner. |
| **CreatedDate** | TIMESTAMP | YES | When the campaign was created. |
| **CreatedById** | STRING | YES | User ID who created the campaign. |
| **LastModifiedDate** | TIMESTAMP | YES | Last modification time. |
| **LastModifiedById** | STRING | YES | User ID who last modified. |
| **SystemModstamp** | TIMESTAMP | YES | System timestamp of last update (used for sync). |
| **LastViewedDate** | TIMESTAMP | YES | Last time the record was viewed (optional). |
| **LastReferencedDate** | TIMESTAMP | YES | Last time the record was referenced (e.g. in a report). |

### 2.6 Active flag

| Field | Data type (BQ) | Nullable | Definition |
|-------|----------------|----------|------------|
| **IsActive** | BOOLEAN | YES | Whether the campaign is active. The dashboard filter-options query uses `IsActive = TRUE` to build the campaign dropdown. |

### 2.7 Standard: Campaign member record type

| Field | Data type (BQ) | Nullable | Definition |
|-------|----------------|----------|------------|
| **CampaignMemberRecordTypeId** | STRING | YES | Record type ID applied to **CampaignMember** records when leads/contacts are added to this campaign. Controls which page layout and fields apply to campaign members. Does not link Campaign to Lead in BigQuery; the link from Lead to Campaign in BQ is **Lead.Campaign__c** (and conceptually CampaignMember in Salesforce). |

### 2.8 Custom fields (Savvy)

| Field | Data type (BQ) | Nullable | Definition |
|-------|----------------|----------|------------|
| **Campaign_UTM__c** | STRING | YES | Custom: UTM (or other) tracking code for the campaign. Example in data: `fpadec2025`. |
| **Distribution_Group__c** | STRING | YES | Custom: distribution group reference. |
| **Automated_Distribution__c** | BOOLEAN | YES | Custom: whether distribution is automated. In sample data: `false`. |

---

## 3. Relationship: Campaign ↔ Lead

### 3.1 In BigQuery (what we have)

- **Lead** has one campaign lookup: **`Lead.Campaign__c`** (custom field, STRING = Campaign Id).
- **One campaign per lead** in the sync: at most one Campaign Id is stored on each Lead.
- **Counts in SavvyGTMData:**
  - **98,590** total leads (non-deleted).
  - **4,283** leads have `Campaign__c` set (non-null, non-empty).
  - Those 4,283 leads reference **13 distinct** campaign IDs.
- So: **13 campaigns** have at least one lead with `Lead.Campaign__c = Campaign.Id`. The other campaigns have **0** leads linked via `Lead.Campaign__c`, even if they have many members in Salesforce (e.g. **NumberOfLeads = 2,621** for “Scored List January 2026”).

### 3.2 In Salesforce and BigQuery (CampaignMember integrated)

- **CampaignMember** is the join object in Salesforce: many-to-many between Campaign and Lead/Contact. **CampaignMember is now synced to** `SavvyGTMData.CampaignMember` (as of 2026-02-07) and **integrated into the funnel view** via the **Campaign_Member_Agg** CTE in `vw_funnel_master`. The view aggregates CampaignMember by LeadId into **all_campaigns** (ARRAY&lt;STRUCT&lt;id STRING, name STRING&gt;&gt;) so every campaign a lead belongs to is available for filtering.
- **Lead.Campaign__c** is a **separate** lookup: a single “primary” or “first-touch” campaign on the lead. It is **not** auto-populated from CampaignMember.
- **Dashboard:** The campaign filter now works for **all** campaign members: a row matches if `Campaign_Id__c` is in the selected list **or** any element of `all_campaigns` has `id` in the selected list. So “Scored List January 2026” (and other campaigns that have members only via CampaignMember) will show all ~2,621 members once the updated view is deployed.

### 3.3 How the funnel view uses it

- **vw_funnel_master** uses:
  - **Lead_Base:** `Campaign__c AS Lead_Campaign_Id__c`
  - **Combined:** `Campaign_Id__c = COALESCE(Opp_Campaign_Id__c, Lead_Campaign_Id__c)` and **all_campaigns** from **Campaign_Member_Agg** (LEFT JOIN on LeadId = Full_prospect_id__c).
- So each funnel row has **one** primary campaign (Campaign_Id__c) **and** **all_campaigns** (array of every campaign the lead is a member of). Filtering by campaign matches either Campaign_Id__c or any id in all_campaigns. Campaigns that have members only via CampaignMember (e.g. Scored List January 2026) now appear for those members once the updated view is deployed.

---

## 4. Relationship: Campaign ↔ Opportunity (brief)

- **Opportunity.CampaignId** (STRING) = Campaign Id. One campaign per opportunity.
- In SavvyGTMData, **7 campaigns** have at least one opportunity with `CampaignId` set.
- The funnel view uses **Campaign_Id__c = COALESCE(Opp_Campaign_Id__c, Lead_Campaign_Id__c)**, so opportunity campaign overrides lead campaign when both exist.

---

## 5. Summary

| Topic | Summary |
|-------|--------|
| **Campaign table** | 29 active rows; standard Campaign fields + CampaignMemberRecordTypeId + custom Campaign_UTM__c, Distribution_Group__c, Automated_Distribution__c. |
| **Roll-up fields** | NumberOfLeads, NumberOfOpportunities, etc., are Salesforce roll-ups from CampaignMember/related data; we do not recompute them in BQ. |
| **Lead link in BQ** | **Lead.Campaign__c** (single campaign per lead): 4,283 leads set; 13 campaigns referenced. **CampaignMember** is now in BQ and aggregated into **all_campaigns** in the funnel view for ~10,847 leads with memberships. |
| **CampaignMember** | Synced to `SavvyGTMData.CampaignMember`; integrated into `vw_funnel_master` via Campaign_Member_Agg. **all_campaigns** is populated for every lead with CampaignMember rows; dashboard filter by any campaign is supported. |
| **CampaignMemberRecordTypeId** | Configures campaign member record type in Salesforce; it does not change how Campaign relates to Lead in BigQuery. |

For how Campaign is used in the dashboard and funnel view, see **docs/campaign-and-lead-opportunity-relationships.md**.
