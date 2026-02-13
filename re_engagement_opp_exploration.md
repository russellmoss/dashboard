# Re-Engagement Opportunity Type in SFDC — Exploration

**Purpose:** Describe the Re-Engagement opportunity type in Salesforce (SFDC) as reflected in BigQuery: how it links to the original Recruiting opportunity it came from, how it links to a new Recruiting opportunity when the prospect converts, its stages and stage-entered date fields, and a complete list of fields and data types. All counts and coverage percentages below are validated against BigQuery (`savvy-gtm-analytics.SavvyGTMData.Opportunity`).

**Source documents:** `Dec_30_re_engagement_opps.md`, `lead_list_touch_point_exploration_180d.md`; validated and extended via MCP BigQuery.

**Last validated:** 2026-02-11

---

## 1. Identification

| Attribute | Value |
|----------|--------|
| **Table** | `savvy-gtm-analytics.SavvyGTMData.Opportunity` |
| **RecordTypeId (Re-Engagement)** | `012VS000009VoxrYAC` |
| **RecordTypeId (Recruiting)** | `012Dn000000mrO3IAI` |
| **Filter (active Re-Engagement)** | `IsDeleted = FALSE` AND `RecordTypeId = '012VS000009VoxrYAC'` |

Re-Engagement opportunities are created when a prior **Recruiting** opportunity is closed lost; the Re-Engagement record represents a second chance to re-engage that prospect. The funnel view `vw_funnel_master` includes both record types: `RecordTypeId IN ('012Dn000000mrO3IAI', '012VS000009VoxrYAC')`.

---

## 2. Connection to the Original Recruiting Opportunity (Origin)

Each Re-Engagement opportunity is tied to the **closed-lost Recruiting opportunity** from which it was created.

### 2.1 Primary link

| Field | Type | Description |
|-------|------|-------------|
| **Previous_Recruiting_Opportunity_ID__c** | STRING | Salesforce Id of the prior (closed-lost) Recruiting opportunity. This is the **origin** Recruiting opp. |

**BigQuery validation:**

- **798** Re-Engagement opportunities (IsDeleted = FALSE).
- **791** (99.1%) have `Previous_Recruiting_Opportunity_ID__c` populated.
- **7** have no origin link (legacy or manual creates).

To join Re-Engagement to the original Recruiting opportunity:

```sql
SELECT re.*, orig.Name AS origin_opp_name, orig.StageName AS origin_stage, orig.Closed_Lost_Reason__c AS origin_clr
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` re
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.Opportunity` orig
  ON orig.Id = re.Previous_Recruiting_Opportunity_ID__c AND orig.IsDeleted = FALSE
WHERE re.IsDeleted = FALSE
  AND re.RecordTypeId = '012VS000009VoxrYAC';
```

### 2.2 Copied context from the original Recruiting opp

These fields on the Re-Engagement record store **snapshots** from the original Recruiting opportunity at the time the Re-Engagement was created:

| Field | Type | Description |
|-------|------|-------------|
| **Previous_Recruiting_Opportunity_CLR__c** | STRING | Closed Lost Reason from the original Recruiting opp. |
| **Previous_Recruiting_Opportunity_Owner_ID__c** | STRING | Owner (User) Id of the original Recruiting opp. |
| **Previous_Recruting_Opp_CL_Details__c** | STRING | Closed-lost details from the original opp. (Note: typo “Recruting” in SFDC.) |

These support reporting and filtering without joining back to the Recruiting opp (e.g., re-engage by prior CLR or prior owner).

---

## 3. Connection to a New Recruiting Opportunity (Conversion)

When a Re-Engagement opportunity **converts** (prospect is re-engaged and moves into the main recruiting pipeline), a **new** Recruiting opportunity is created. The link is **bidirectional**.

### 3.1 On the Re-Engagement opportunity

| Field | Type | Description |
|-------|------|-------------|
| **Created_Recruiting_Opportunity_ID__c** | STRING | Id of the **new** Recruiting opportunity created when this Re-Engagement converts. When set, this Re-Engagement has “converted to Recruiting.” |

**BigQuery validation:**

- **2** of 798 Re-Engagement opps (0.3%) have `Created_Recruiting_Opportunity_ID__c` set.
- Conversion is rare in the current dataset; the field is the source of truth when conversion occurs.

### 3.2 On the new Recruiting opportunity

| Field | Type | Description |
|-------|------|-------------|
| **Source_Re_Engagement_Opportunity_ID__c** | STRING | Id of the Re-Engagement opportunity this Recruiting opp was created from. Populated by the Re-Engagement → Recruiting conversion flow when the new Recruiting opp is created. |

**BigQuery validation:**

- **2** Recruiting opportunities have `Source_Re_Engagement_Opportunity_ID__c` set.
- Join check: for those 2 Recruiting opps, the linked Re-Engagement opp has `Created_Recruiting_Opportunity_ID__c` equal to that Recruiting opp Id (bidirectional link confirmed).

**Example (validated):**

- Re-Engagement: Id `006VS00000VL1m5YAD`, Name `[Re-Engagement] Scott Sadler`, StageName `Re-Engaged`, `Created_Recruiting_Opportunity_ID__c` = `006VS00000X00oFYAR`, `Previous_Recruiting_Opportunity_ID__c` = `006Dn00000AZP6EIAX`.
- New Recruiting: Id `006VS00000X00oFYAR`, Name `Scott Sadler - 2/2026`, `Source_Re_Engagement_Opportunity_ID__c` = `006VS00000VL1m5YAD`.

### 3.3 Summary: three-way relationship

- **Original Recruiting opp** (closed lost): `Opportunity.Id` = `Re-Engagement.Previous_Recruiting_Opportunity_ID__c`.
- **Re-Engagement opp**: `Opportunity.Id` = Re-Engagement record; `Created_Recruiting_Opportunity_ID__c` points to new Recruiting when converted.
- **New Recruiting opp** (after conversion): `Opportunity.Id` = `Re-Engagement.Created_Recruiting_Opportunity_ID__c`; `Source_Re_Engagement_Opportunity_ID__c` = Re-Engagement Id.

---

## 4. Stages of the Re-Engagement Opportunity

Re-Engagement uses a dedicated pipeline with the following **StageName** values (validated in BQ).

### 4.1 Stage list and counts (BQ-validated)

| StageName | opp_count | Notes |
|-----------|-----------|--------|
| Planned Nurture | 554 | Entry / nurture stage |
| Closed Lost | 174 | Closed without converting |
| Outreach | 35 | Active outreach |
| Re-Engaged | 23 | Converted path; often leads to new Recruiting opp |
| Call Scheduled | 8 | Call scheduled |
| Engaged | 4 | Engaged, not yet Re-Engaged |

**Total Re-Engagement opps (IsDeleted = FALSE):** 798.

Typical **logical order** of stages (flow): **Planned Nurture** → **Outreach** → **Call Scheduled** → **Engaged** → **Re-Engaged** (success path) or **Closed Lost** (no conversion).

### 4.2 Stage-entered date fields (when they enter each stage)

Each stage has a **timestamp** field that records when the opportunity **entered** that stage. All are **TIMESTAMP** in BigQuery.

| Stage | Field | BigQuery type |
|-------|--------|----------------|
| Planned Nurture | **Stage_Entered_Planned_Nurture__c** | TIMESTAMP |
| Outreach | **Stage_Entered_Outreach__c** | TIMESTAMP |
| Call Scheduled | **Stage_Entered_Call_Scheduled__c** | TIMESTAMP |
| Engaged | **Stage_Entered_Engaged__c** | TIMESTAMP |
| Re-Engaged | **Stage_Entered_Re_Engaged__c** | TIMESTAMP |
| Closed (Closed Lost or closed state) | **Stage_Entered_Closed__c** | TIMESTAMP |

**Coverage (BQ-validated):**

| Metric | Value |
|--------|--------|
| Re-Engagement opps with **at least one** stage-entered date | 181 (22.7%) |
| Re-Engagement opps with **no** stage-entered dates | 617 (77.3%) |
| % with Stage_Entered_Planned_Nurture__c | 0.1% |
| % with Stage_Entered_Outreach__c | 0.3% |
| % with Stage_Entered_Engaged__c | 0.1% |
| % with Stage_Entered_Call_Scheduled__c | 0% |
| % with Stage_Entered_Re_Engaged__c | 0.4% |
| % with Stage_Entered_Closed__c | 22.3% |

Most records have no stage-entered dates; **Stage_Entered_Closed__c** is the most populated (22.3%). This is consistent with these fields being added after many Re-Engagement records were created or worked. For recent cohorts, stage dates can be used for funnel timing and velocity.

**Standard stage date:**

- **LastStageChangeDate** (TIMESTAMP) — standard Opportunity field; last time the stage value changed. Populated on all records that have had a stage change.

### 4.3 Re-Engagement stages as prospect-equivalent (funnel alignment)

When treating a Re-Engagement opportunity **like a new prospect** (e.g. for funnel reporting or stage logic in `vw_funnel_master`), Re-Engagement stages can be mapped to the **prospect/lead funnel stages** as follows:

| Re-Engagement StageName | Prospect / funnel equivalent | Notes |
|-------------------------|-----------------------------|--------|
| **Planned Nurture**     | **New**                     | Same as prospect stage “New” — entry / not yet actively outreaching |
| **Outreach**            | **Contacting**              | Same as prospect stage “Contacting” — SGA is actively reaching out |
| **Call Scheduled**      | **Call Scheduled**         | Same as prospect stage “Call Scheduled” (MQL) |
| **Engaged**             | *(no equivalent)*           | **Does not have an analog in the prospect flow.** Must be handled explicitly in logic (e.g. treat as a distinct Re-Engagement-only stage between Call Scheduled and Qualified). |
| **Re-Engaged**          | **Qualified (SQL)**        | Same as prospect stage “Qualified” (SQL). Success path: they have re-engaged and are qualified. |
| *(then conversion)*     | → **New Recruiting opp**   | When they convert, a **new Recruiting-type opportunity** is created; they can then **SQO** again on that Recruiting opp. |

**Flow in plain terms:**

1. Re-Engagement opp moves: **Planned Nurture** (New) → **Outreach** (Contacting) → **Call Scheduled** (Call Scheduled) → optionally **Engaged** (no prospect analog) → **Re-Engaged** (Qualified/SQL).
2. At **Re-Engaged**, the system creates a **new Recruiting opportunity** (linked via `Created_Recruiting_Opportunity_ID__c` / `Source_Re_Engagement_Opportunity_ID__c`).
3. On that new Recruiting opp, the prospect can move through SQO and the rest of the Recruiting pipeline again.

**Relation to `views/vw_funnel_master.sql`:**

- The funnel view currently includes both record types: `RecordTypeId IN ('012Dn000000mrO3IAI', '012VS000009VoxrYAC')` (Recruiting and Re-Engagement). Opportunities are joined to leads via `l.converted_oppty_id = o.Full_Opportunity_ID__c`; Re-Engagement opps often have no converting lead (they originate from a closed-lost Recruiting opp, not from a lead conversion).
- **TOF_Stage** in the view is derived from lead/opp stages (Prospect → Contacted → MQL → SQL → SQO → Joined). **StageName_code** already maps `StageName = 'Planned Nurture'` to code 9; other Re-Engagement stages (Outreach, Call Scheduled, Engaged, Re-Engaged) are not yet mapped in that CASE and would need to be handled if Re-Engagement is to be treated like a prospect for funnel stages.
- **Dealing with “Engaged”:** The Re-Engagement stage **Engaged** has no direct equivalent in the prospect flow (New → Contacting → Call Scheduled → Qualified → …). Any logic that aligns Re-Engagement to prospect stages (e.g. in the funnel view or in reporting) must explicitly decide how to treat **Engaged** — for example: treat it as its own stage between Call Scheduled and Qualified, or map it to Contacting or Call Scheduled for reporting purposes. It cannot be omitted; it must be handled so that Re-Engagement funnel counts and stage logic remain correct.

---

## 5. Fields Within the Re-Engagement Opportunity (Complete List)

Below are the **standard** Opportunity fields and **custom** fields that exist on the Opportunity object and are relevant to Re-Engagement (including shared custom fields used by both Recruiting and Re-Engagement). Types are as in BigQuery.

### 5.1 Standard Opportunity fields (present on all Opportunity records)

| Field | Type | Description |
|-------|------|-------------|
| Id | STRING | Salesforce Id (primary key) |
| IsDeleted | BOOLEAN | Soft delete flag; use FALSE for active records |
| AccountId | STRING | Account (company) Id |
| RecordTypeId | STRING | Record type (Re-Engagement = 012VS000009VoxrYAC) |
| Name | STRING | Opportunity name (e.g. `[Re-Engagement] Gail Murdoch`) |
| Description | STRING | Long text |
| StageName | STRING | Current stage (e.g. Planned Nurture, Closed Lost) |
| Amount | FLOAT | Opportunity amount |
| Probability | FLOAT | Probability % |
| ExpectedRevenue | FLOAT | Expected revenue |
| TotalOpportunityQuantity | FLOAT | Quantity |
| CloseDate | DATE | Expected close date |
| Type | STRING | Opportunity type |
| NextStep | STRING | Next step text |
| LeadSource | STRING | Lead source |
| IsClosed | BOOLEAN | Whether opportunity is closed |
| IsWon | BOOLEAN | Whether opportunity is won |
| ForecastCategory | STRING | Forecast category |
| ForecastCategoryName | STRING | Forecast category label |
| CampaignId | STRING | Campaign Id |
| HasOpportunityLineItem | BOOLEAN | Has line items |
| Pricebook2Id | STRING | Price book Id |
| OwnerId | STRING | Owner (User) Id |
| CreatedDate | TIMESTAMP | Created datetime (UTC) |
| CreatedById | STRING | Creator User Id |
| LastModifiedDate | TIMESTAMP | Last modified datetime |
| LastModifiedById | STRING | Last modifier User Id |
| SystemModstamp | TIMESTAMP | System mod stamp |
| LastActivityDate | DATE | Last activity date |
| PushCount | INTEGER | Push count |
| LastStageChangeDate | TIMESTAMP | When stage last changed |
| FiscalQuarter | INTEGER | Fiscal quarter |
| FiscalYear | INTEGER | Fiscal year |
| Fiscal | STRING | Fiscal period label |
| ContactId | STRING | Primary Contact Id |
| LastViewedDate | TIMESTAMP | Last viewed |
| LastReferencedDate | TIMESTAMP | Last referenced |
| SyncedQuoteId | STRING | Synced quote Id |
| ContractId | STRING | Contract Id |
| HasOpenActivity | BOOLEAN | Has open activity |
| HasOverdueTask | BOOLEAN | Has overdue task |
| LastAmountChangedHistoryId | STRING | History Id |
| LastCloseDateChangedHistoryId | STRING | History Id |

### 5.2 Re-Engagement–specific and linking custom fields

| Field | Type | Description |
|-------|------|-------------|
| **Previous_Recruiting_Opportunity_ID__c** | STRING | Id of the original (closed-lost) Recruiting opp — **origin link** |
| **Previous_Recruiting_Opportunity_CLR__c** | STRING | Closed Lost Reason of the original Recruiting opp |
| **Previous_Recruiting_Opportunity_Owner_ID__c** | STRING | Owner Id of the original Recruiting opp |
| **Previous_Recruting_Opp_CL_Details__c** | STRING | Closed-lost details from original opp (SFDC name has typo “Recruting”) |
| **Created_Recruiting_Opportunity_ID__c** | STRING | Id of the **new** Recruiting opp when this Re-Engagement converts — **conversion link** |
| **Source_Re_Engagement_Opportunity_ID__c** | STRING | On **Recruiting** opp: Id of the Re-Engagement opp this was created from (used when conversion flow creates the new Recruiting opp) |

### 5.3 Re-Engagement stage-entered date fields (all TIMESTAMP)

| Field | Type | Stage |
|-------|------|--------|
| **Stage_Entered_Planned_Nurture__c** | TIMESTAMP | Planned Nurture |
| **Stage_Entered_Outreach__c** | TIMESTAMP | Outreach |
| **Stage_Entered_Call_Scheduled__c** | TIMESTAMP | Call Scheduled |
| **Stage_Entered_Engaged__c** | TIMESTAMP | Engaged |
| **Stage_Entered_Re_Engaged__c** | TIMESTAMP | Re-Engaged |
| **Stage_Entered_Closed__c** | TIMESTAMP | Closed |

### 5.4 Re-Engagement planning and reason fields

| Field | Type | Description |
|-------|------|-------------|
| **Re_Engagement_Reason__c** | STRING | Reason for re-engagement (e.g. picklist); in BQ sample: “Nervous about litigation” |
| **Re_Engagement_Reason_Details__c** | STRING | Free-text details |
| **Re_Engagement_Priority__c** | STRING | Priority (e.g. High); in BQ sample: “High” |
| **Target_Re_Engagement_Date__c** | DATE | Target date to re-engage |
| **Re_Engagement_Next_Touch_Date__c** | DATE | Next touch date |

### 5.5 Other custom fields on Opportunity (shared or used on Re-Engagement)

| Field | Type | Description |
|-------|------|-------------|
| **Opportunity_Owner_Name__c** | STRING | Owner display name (SGA); use when present, else join OwnerId to User |
| **Full_Opportunity_ID__c** | STRING | Full opportunity Id (e.g. for reporting/Tableau) |
| **Closed_Lost_Reason__c** | STRING | Closed lost reason (when StageName = Closed Lost) |
| **Closed_Lost_Details__c** | STRING | Closed lost details |
| **Stage_Before_Closed_or_Conversion__c** | STRING | Stage name before closing or converting |
| **SGM_reengagement__c** | STRING | SGM re-engagement reference |

Additional custom fields exist on the Opportunity object (e.g. firm/advisor fields, compensation, UTM, etc.); the above list covers identification, **origin**, **conversion**, **stages**, **stage-entered dates**, and Re-Engagement planning/reason fields. For the full schema, use `mcp_Dashboard-bigquery_get_table_info` for `SavvyGTMData.Opportunity`.

---

## 6. Validation Notes vs. Source Documents

- **Dec_30_re_engagement_opps.md:** RecordTypeId, stages, stage-entered field names, and conversion field (`Created_Recruiting_Opportunity_ID__c`) match BQ. Counts have shifted slightly (e.g. 798 Re-Engagement total; 2 with conversion link vs. 1 in the doc; 181 with any stage date vs. 169). Stage date coverage remains low except for Stage_Entered_Closed__c (~22%).
- **lead_list_touch_point_exploration_180d.md:** Focuses on lead/contacted/MQL and source; it does not define Re-Engagement opp structure. Re-Engagement is mentioned as a lead source (e.g. “Re-Engagement” in Original_source); that is lead-level attribution, not the Re-Engagement Opportunity object described here.
- **Origin link:** `Dec_30_re_engagement_opps.md` did not document `Previous_Recruiting_Opportunity_ID__c`; BQ confirms 99.1% of Re-Engagement opps have it set.
- **Bidirectional conversion link:** Confirmed in BQ: Recruiting opps with `Source_Re_Engagement_Opportunity_ID__c` match Re-Engagement opps with `Created_Recruiting_Opportunity_ID__c` (2 pairs).

---

## 7. Example queries

**All Re-Engagement opps with origin and conversion links:**

```sql
SELECT
  re.Id,
  re.Name,
  re.StageName,
  re.CreatedDate,
  re.Previous_Recruiting_Opportunity_ID__c   AS origin_recruiting_id,
  re.Created_Recruiting_Opportunity_ID__c   AS new_recruiting_id,
  re.Stage_Entered_Planned_Nurture__c,
  re.Stage_Entered_Outreach__c,
  re.Stage_Entered_Re_Engaged__c,
  re.Stage_Entered_Closed__c
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` re
WHERE re.IsDeleted = FALSE
  AND re.RecordTypeId = '012VS000009VoxrYAC'
ORDER BY re.CreatedDate DESC;
```

**Re-Engagement opps that converted to Recruiting (with new Recruiting name):**

```sql
SELECT
  re.Id AS re_eng_id,
  re.Name AS re_eng_name,
  re.StageName AS re_eng_stage,
  re.Created_Recruiting_Opportunity_ID__c AS new_recruiting_id,
  r.Name AS new_recruiting_name
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` re
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.Opportunity` r
  ON r.Id = re.Created_Recruiting_Opportunity_ID__c AND r.IsDeleted = FALSE
WHERE re.IsDeleted = FALSE
  AND re.RecordTypeId = '012VS000009VoxrYAC'
  AND re.Created_Recruiting_Opportunity_ID__c IS NOT NULL;
```

**Stage distribution (validated):**

```sql
SELECT StageName, COUNT(*) AS opp_count
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
WHERE IsDeleted = FALSE
  AND RecordTypeId = '012VS000009VoxrYAC'
GROUP BY StageName
ORDER BY opp_count DESC;
```

---

## 8. Summary

| Topic | Summary |
|--------|---------|
| **Origin** | Re-Engagement → original Recruiting: **Previous_Recruiting_Opportunity_ID__c** (99.1% populated). Context: Previous_Recruiting_Opportunity_CLR__c, Previous_Recruiting_Opportunity_Owner_ID__c, Previous_Recruting_Opp_CL_Details__c. |
| **Conversion** | Re-Engagement → new Recruiting: **Created_Recruiting_Opportunity_ID__c** on Re-Engagement; **Source_Re_Engagement_Opportunity_ID__c** on the new Recruiting opp. Bidirectional; 2 conversions in BQ. After Re-Engaged, a new Recruiting opp is created and they can SQO again. |
| **Stages** | Planned Nurture, Outreach, Call Scheduled, Engaged, Re-Engaged, Closed Lost. Order: Planned Nurture → … → Re-Engaged or Closed Lost. |
| **Stages vs prospect funnel** | When treating Re-Engagement like a new prospect: Planned Nurture = New, Outreach = Contacting, Call Scheduled = Call Scheduled, Re-Engaged = Qualified (SQL). **Engaged** has no equivalent in the prospect flow and must be handled explicitly (e.g. in `vw_funnel_master` or reporting). |
| **Stage dates** | Six TIMESTAMP fields (Stage_Entered_Planned_Nurture__c through Stage_Entered_Closed__c). ~22.7% have at least one; Stage_Entered_Closed__c ~22.3%; others 0–0.4%. |
| **Fields** | Standard Opportunity fields plus Re-Engagement-specific custom fields (origin, conversion, stage-entered, reason/priority/dates). All types documented above. |
