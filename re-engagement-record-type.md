# Re-Engagement Record Type: Structure, Conversion, and Funnel Treatment

This document reviews the Re-Engagement Opportunity record type in Salesforce/BigQuery, how it converts today (and how it should convert), and how to treat it in `vw_funnel_master` so re-engagement records count as new “leads” that eventually create a new Recruiting-type Opportunity.

---

## 1. What We Have in BigQuery

### 1.1 Record type and scope

- **Record type ID**: `012VS000009VoxrYAC` (Re-Engagement).
- **Object**: `Opportunity` (same object as Recruiting; differentiated by `RecordTypeId`).
- **Source table**: `savvy-gtm-analytics.SavvyGTMData.Opportunity`.
- **Current volume (from BQ)**: Re-Engagement opportunities use **6 stages** (confirmed via `SavvyGTMData.Opportunity` with `RecordTypeId = '012VS000009VoxrYAC'`). See [§1.3](#13-re-engagement-stages-confirmed-in-bq) for the full list and counts.

### 1.2 Re-Engagement-specific fields (Opportunity)

| Field | Purpose |
|-------|--------|
| `Previous_Recruiting_Opportunity_ID__c` | Links this re-engagement opp to the **prior** closed-lost Recruiting opportunity. |
| `Previous_Recruiting_Opportunity_CLR__c` | Closed Lost Reason of that prior opp. |
| `Previous_Recruiting_Opportunity_Owner_ID__c` | Owner of that prior opp. |
| `Re_Engagement_Reason__c` | Reason for re-engagement. |
| `Re_Engagement_Reason_Details__c` | Details. |
| `Target_Re_Engagement_Date__c` | Target date. |
| `Re_Engagement_Next_Touch_Date__c` | Next touch date. |
| `Re_Engagement_Priority__c` | Priority. |
| `Previous_Recruting_Opp_CL_Details__c` | Closed Lost details of prior opp. |

There is **no** field in the current schema that links a Re-Engagement opportunity to a **new** Recruiting opportunity created when the re-engagement “converts.” That is the gap.

### 1.3 Re-Engagement stages (confirmed in BQ)

All **6** Re-Engagement stages are present in BigQuery. Counts as of the last run (query below):

| # | StageName      | record_count |
|---|----------------|--------------|
| 1 | Planned Nurture| 613          |
| 2 | Closed Lost    | 113          |
| 3 | Outreach       | 35           |
| 4 | Re-Engaged     | 21           |
| 5 | Call Scheduled | 9            |
| 6 | Engaged        | 3            |

**Query used:**

```sql
SELECT
  StageName,
  COUNT(*) AS record_count
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
WHERE RecordTypeId = '012VS000009VoxrYAC'
  AND (IsDeleted IS NULL OR IsDeleted = FALSE)
GROUP BY StageName
ORDER BY record_count DESC;
```

**Pipeline order (open → outcome):** Planned Nurture → Outreach → Call Scheduled → Engaged → Re-Engaged (with Closed Lost as outcome). **Engaged** sits between Call Scheduled and Re-Engaged in the flow.

Recruiting Opportunity uses `Stage_Entered_*` timestamps (Discovery, Sales Process, etc.). Re-Engagement uses the same `Opportunity` object; **Stage_Entered_*** fields in BQ are Recruiting-stage–oriented. See [§1.4](#14-how-re-engagement-stages-are-dated-and-timestamped) for what is available today for filtration and conversion rates.

### 1.4 How Re-Engagement stages are dated and timestamped

**Findings from BigQuery (`SavvyGTMData.Opportunity`, Re-Engagement record type):**

| Field | Type | Populated for Re-Engagement? | Use for filtration / conversion |
|-------|------|------------------------------|---------------------------------|
| **CreatedDate** | TIMESTAMP | Yes (all records) | “Created” / FilterDate; when the re-engagement opp was created. Use for “entered pipeline” and for Planned Nurture as “created.” |
| **LastModifiedDate** | TIMESTAMP | Yes | Last update; not stage-specific. |
| **LastStageChangeDate** | TIMESTAMP | Inconsistent (NULL on many; set on some, e.g. Engaged) | Standard Salesforce field; **do not rely** for “when they entered this stage” until validated. |
| **CloseDate** | DATE | Yes | Close date; relevant for Closed Lost. |
| **Stage_Entered_Closed__c** | TIMESTAMP | Yes when StageName = Closed Lost | Shared with Recruiting; when a Re-Engagement opp is moved to Closed Lost, this field is set. Use for “when they entered Closed Lost.” |

**What does *not* exist in BQ today:**

- There are **no** `Stage_Entered_*` fields for Re-Engagement-specific stages (Planned Nurture, Outreach, Call Scheduled, Engaged, Re-Engaged). The Opportunity table only has Recruiting-stage fields: `Stage_Entered_Discovery__c`, `Stage_Entered_Sales_Process__c`, `Stage_Entered_Negotiating__c`, `Stage_Entered_Signed__c`, `Stage_Entered_On_Hold__c`, `Stage_Entered_Closed__c`, `Stage_Entered_Joined__c`.
- So we **cannot** derive from timestamps alone when a Re-Engagement opp entered Outreach, Call Scheduled, Engaged, or Re-Engaged—only that it is *currently* in that stage (`StageName`).

**Implications for filtration and conversion rates:**

- **Filtration by “created” / cohort:** Use `CreatedDate`. You can filter “re-engagement opps created in period” and “current stage = X.”
- **Filtration by current stage:** Use `StageName` (e.g. `StageName = 'Outreach'`).
- **Conversion rates by stage entry:** We **cannot** compute “entered Outreach in period,” “entered Call Scheduled in period,” or “entered Re-Engaged in period” from current BQ data—only current state and creation date. So cohort-by-stage-entry (e.g. “entered Outreach in Jan”) and stage-to-stage conversion rates (e.g. Outreach → Call Scheduled) are **not** possible without either (a) Salesforce Stage History (or equivalent) in BQ, or (b) custom **Stage_Entered_*** fields for Re-Engagement stages in Salesforce, synced to BQ.

**Recommendation:** Add in Salesforce (and sync to BQ) stage-entered timestamps for Re-Engagement, e.g. `Stage_Entered_Planned_Nurture__c`, `Stage_Entered_Outreach__c`, `Stage_Entered_Call_Scheduled__c`, `Stage_Entered_Engaged__c`, `Stage_Entered_Re_Engaged__c`. (Closed is already covered by `Stage_Entered_Closed__c`.) Then filtration (“entered Outreach in date range”) and conversion rates (e.g. Outreach→Call Scheduled, Call Scheduled→Re-Engaged) can be built from these fields.

**Query used to validate date-field population (by stage):**

```sql
SELECT
  StageName,
  COUNT(*) AS n,
  SUM(CASE WHEN CreatedDate IS NOT NULL THEN 1 ELSE 0 END) AS with_created,
  SUM(CASE WHEN LastStageChangeDate IS NOT NULL THEN 1 ELSE 0 END) AS with_last_stage_change,
  SUM(CASE WHEN CloseDate IS NOT NULL THEN 1 ELSE 0 END) AS with_close,
  SUM(CASE WHEN Stage_Entered_Closed__c IS NOT NULL THEN 1 ELSE 0 END) AS with_stage_entered_closed
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
WHERE RecordTypeId = '012VS000009VoxrYAC'
  AND (IsDeleted IS NULL OR IsDeleted = FALSE)
GROUP BY StageName
ORDER BY n DESC;
```

---

## 2. How Conversion Works Today (and the gap)

### 2.1 Current behavior when stage = Re-Engaged

- Moving a Re-Engagement opportunity to **Re-Engaged** does **not** create a new Recruiting-type Opportunity.
- There is no lookup from Re-Engagement → “created” Recruiting opportunity, and no reverse lookup from Recruiting → source Re-Engagement opportunity.
- So today: **Re-Engaged is an outcome stage only**; it does not create or link to a Recruiting opp.

### 2.2 Desired behavior (to implement)

When a Re-Engagement opportunity reaches **stage = Re-Engaged**:

1. **Create** a new **Recruiting**-type Opportunity (same as “conversion” from a lead).
2. **Link** the two records:
   - Option A: On Re-Engagement opp: `Created_Recruiting_Opportunity_ID__c` (or similar) → new Recruiting opp Id.
   - Option B: On Recruiting opp: `Source_Re_Engagement_Opportunity_ID__c` (or similar) → Re-Engagement opp Id.
   - Prefer both for symmetric reporting and validation.
3. That new Recruiting opportunity then flows through the normal funnel (Qualifying → … → SQO / Joined) and is counted in existing recruiting metrics.

This likely requires **Salesforce automation** (Flow or Process Builder) on Re-Engagement Opportunity when `StageName` becomes Re-Engaged: create Opp, set record type to Recruiting, set the linking fields, and optionally copy key fields from the Re-Engagement opp.

---

## 3. How Re-Engagement Fits in the Funnel (vw_funnel_master)

### 3.1 Current behavior in vw_funnel_master

- **Lead_Base**: All Leads (with `converted_oppty_id`, `stage_entered_contacting__c`, `Stage_Entered_Call_Scheduled__c` → MQL, `ConvertedDate` → SQL).
- **Opp_Base**: Opportunities with `RecordTypeId IN ('012Dn000000mrO3IAI', '012VS000009VoxrYAC')` (Recruiting + Re-Engagement).
- **Combined**: `FULL OUTER JOIN` Lead to Opportunity **on `l.converted_oppty_id = o.Full_Opportunity_ID__c`**.

Because Re-Engagement opportunities are **never** the `ConvertedOpportunityId` of a Lead, they appear only as **opportunity-only** rows (no lead side). So for Re-Engagement rows today:

- `Full_prospect_id__c` = NULL  
- `stage_entered_contacting__c`, `mql_stage_entered_ts`, `converted_date_raw` = NULL  
- `is_contacted`, `is_mql`, `is_sql` = 0  

So Re-Engagement is in the view but **does not participate in the lead-based funnel** (Contacted → MQL → SQL). The existing TODO in the view says we may need to treat re-engagement opportunities like “leads” that “convert” into Recruiting opportunities.

### 3.2 Proposed mapping: Re-Engagement stages → funnel stages

Treat Re-Engagement as a **lead-like** pipeline and map its stages to the same funnel concepts we use for Leads:

| Re-Engagement concept | Funnel equivalent | Meaning in vw_funnel_master |
|-----------------------|--------------------|-----------------------------|
| Re-Engagement opp **created** (e.g. Planned Nurture) | **Created** | “Prospect” / first touch; use as `FilterDate` and “created” for cohort. |
| **Outreach** | **Contacted** | Stage “entered contacting”; count as contacted. |
| **Call Scheduled** | **MQL** | Stage “entered call scheduled”; count as MQL. |
| **Engaged** | (Intermediate) | Stage between Call Scheduled and Re-Engaged; can be treated as “engaged but not yet converted.” |
| **Re-Engaged** (and creation of new Recruiting opp) | **SQL** | “Conversion” = new Recruiting Opportunity created; equivalent of `converted_date_raw__c` / SQL. |

So:

- **Planned Nurture** → treat as “created” (equivalent of lead created / stage entered new).
- **Outreach** → treat as “stage entered contacting.”
- **Call Scheduled** → treat as MQL (same as lead’s Call Scheduled).
- **Engaged** → intermediate stage (between Call Scheduled and Re-Engaged); no separate funnel bucket required unless desired.
- When they **convert** (stage = Re-Engaged + new Recruiting opp created) → treat as **SQL** (conversion date = date the new Recruiting opp is created, or date Re-Engagement entered Re-Engaged).

Then the **new Recruiting Opportunity** created from that conversion is already in the funnel via `Opp_Base` and can be joined/linked so we count “re-engagement → new recruiting opp” as one SQL and the subsequent SQO/Joined on that opp.

---

## 4. What We Need to Implement This

### 4.1 Data / Salesforce

1. **Stage names**  
   **Confirmed in BQ:** Re-Engagement has 6 stages — Planned Nurture (613), Closed Lost (113), Outreach (35), Re-Engaged (21), Call Scheduled (9), Engaged (3). See [§1.3](#13-re-engagement-stages-confirmed-in-bq).

2. **Stage-entered timestamps**  
   **BQ confirms:** No `Stage_Entered_*` fields exist for Re-Engagement stages (Planned Nurture, Outreach, Call Scheduled, Engaged, Re-Engaged) in the Opportunity table—only Recruiting stages and `Stage_Entered_Closed__c` (used when Re-Engagement goes to Closed Lost). See [§1.4](#14-how-re-engagement-stages-are-dated-and-timestamped). Add in Salesforce (e.g. `Stage_Entered_Planned_Nurture__c`, `Stage_Entered_Outreach__c`, `Stage_Entered_Call_Scheduled__c`, `Stage_Entered_Engaged__c`, `Stage_Entered_Re_Engaged__c`) and sync to BQ for filtration and conversion rates.

3. **Conversion and linking**  
   - When stage = Re-Engaged: create Recruiting Opportunity and set linking fields (`Created_Recruiting_Opportunity_ID__c` on Re-Engagement, `Source_Re_Engagement_Opportunity_ID__c` on Recruiting, or equivalent).  
   - Ensure these IDs are in BQ so we can join Re-Engagement → Recruiting in the view.

### 4.2 vw_funnel_master changes (conceptual)

Two main approaches:

**Option A – Re-Engagement as its own “lead-like” stream in Combined**

- Add a CTE that selects **Re-Engagement opportunities only** and derives:
  - `FilterDate` = CreatedDate or Stage_Entered_Planned_Nurture (or first stage).
  - `stage_entered_contacting__c` equivalent = Stage_Entered_Outreach (or equivalent).
  - `mql_stage_entered_ts` equivalent = Stage_Entered_Call_Scheduled (or equivalent).
  - `converted_date_raw` equivalent = date new Recruiting opp was created (or Stage_Entered_Re_Engaged), with `is_sql = 1` only when the linking field to the new Recruiting opp is non-null.
- Then **UNION** this re-engagement stream with the existing Lead ↔ Opp join, so Re-Engagement rows contribute to Contacted / MQL / SQL counts like leads, and the linked Recruiting opp appears as the “converted” opportunity.

**Option B – Separate “re-engagement funnel” view**

- Keep `vw_funnel_master` as-is for Lead ↔ Opp.
- Build a second view (e.g. `vw_re_engagement_funnel`) that:
  - Uses Re-Engagement opps as the primary record.
  - Maps stages to created / contacted / MQL / SQL as above.
  - Joins to the **created** Recruiting opp when `Created_Recruiting_Opportunity_ID__c` (or similar) is set.
- Dashboards then union or combine both views for a full funnel that includes re-engagement “leads” and their resulting Recruiting opportunities.

In both options:

- **Created** = Re-Engagement opp created (Planned Nurture as “created” stage).
- **Contacted** = Outreach (stage entered).
- **MQL** = Call Scheduled (stage entered).
- **SQL** = conversion = new Recruiting Opportunity created and linked (equivalent of `converted_date_raw`).

---

## 5. Field mapping: Re-Engagement → Recruiting opportunity

When a Re-Engagement opportunity reaches **stage = Re-Engaged** and we create a **new Recruiting-type Opportunity**, the following mapping ensures data transfers correctly to the new record. Both record types use the same **Opportunity** object in Salesforce/BQ; fields are shared unless they are record-type–specific in the UI (same API names in BQ).

### 5.1 Copy from Re-Engagement to new Recruiting opp (same field name)

These fields exist on both record types (same API name in `SavvyGTMData.Opportunity`). Copy from the Re-Engagement opportunity to the new Recruiting opportunity when creating the record.

| Re-Engagement field (source) | Recruiting field (target) | Notes |
|------------------------------|----------------------------|--------|
| `Name` | `Name` | **Transform:** Strip the `[Re-Engagement] ` prefix so the new opp has a clean advisor/opp name (e.g. `[Re-Engagement] Jesse Dusablon` → `Jesse Dusablon`). |
| `OwnerId` | `OwnerId` | Same SGA/owner. |
| `Amount` | `Amount` | AUM/amount if populated. |
| `Underwritten_AUM__c` | `Underwritten_AUM__c` | If populated. |
| `CloseDate` | `CloseDate` | Can copy or set to a default (e.g. +90 days). |
| `NextStep` | `NextStep` | If populated. |
| `Description` | `Description` | If populated. |
| `LeadSource` | `LeadSource` | If populated. |
| `Final_Source__c` | `Final_Source__c` | Attribution; keep for funnel/source reporting. |
| `Finance_View__c` | `Finance_View__c` | Channel; keep for funnel (e.g. Outbound, Re-Engagement). |
| `External_Agency__c` | `External_Agency__c` | If populated. |
| `FA_CRD__c` | `FA_CRD__c` | Advisor identifier. |
| `Firm_Name__c` | `Firm_Name__c` | If populated. |
| `Personal_Email__c` | `Personal_Email__c` | If populated. |
| `Experimentation_Tag__c` | `Experimentation_Tag__c` | If populated. |
| `AccountId` | `AccountId` | If Re-Engagement has an Account. |
| `ContactId` | `ContactId` | If Re-Engagement has a Contact. |

**Note:** `SGA__c` and `Opportunity_Owner_Name__c` are often formula/lookup on Opportunity; if they are not auto-populated from OwnerId on create, copy or set from the Re-Engagement record as needed.

### 5.2 Set on new Recruiting opp (defaults / not copied from Re-Engagement)

These are set when **creating** the new Recruiting opportunity; they are not copied from Re-Engagement (either Recruiting-specific or start empty).

| Field | Value on new Recruiting opp | Notes |
|-------|-----------------------------|--------|
| `RecordTypeId` | `'012Dn000000mrO3IAI'` (Recruiting) | Required. |
| `StageName` | `'Qualifying'` | First Recruiting stage. |
| `SQL__c` | `'No'` or null | SQO status; set when they become SQO later. |
| `Date_Became_SQO__c` | null | |
| `Stage_Entered_Discovery__c` | null | All Recruiting stage-entered timestamps start null. |
| `Stage_Entered_Sales_Process__c` | null | |
| `Stage_Entered_Negotiating__c` | null | |
| `Stage_Entered_Signed__c` | null | |
| `Stage_Entered_On_Hold__c` | null | |
| `Stage_Entered_Closed__c` | null | |
| `Stage_Entered_Joined__c` | null | |
| `Qualification_Call_Date__c` | null | |
| `Advisor_Join_Date__c` | null | |
| `Closed_Lost_Reason__c` | null | |
| `Closed_Lost_Details__c` | null | |

### 5.3 Re-Engagement–only fields → where they go on Recruiting

Re-Engagement has fields that do **not** exist on the Recruiting record type (or are not used there). Map them as follows so context is preserved on the new Recruiting opp.

| Re-Engagement–only field (source) | How to use on new Recruiting opp |
|-----------------------------------|-----------------------------------|
| `Re_Engagement_Reason__c` | No direct field on Recruiting. Option A: set `Conversion_Channel__c` = `'Re-Engagement'` and/or put reason in `Description` or `NextStep`. Option B: add a custom field on Recruiting (e.g. `Source_Re_Engagement_Reason__c`) if you want it queryable. |
| `Re_Engagement_Reason_Details__c` | Concatenate into `Description` on the new Recruiting opp (e.g. “Converted from Re-Engagement: [details]”), or into a single “source re-engagement” text field if added. |
| `Previous_Recruiting_Opportunity_ID__c` | Do **not** copy to Recruiting (that’s the *old* closed-lost opp). The **new** Recruiting opp is the *new* opportunity. Optionally store the *Re-Engagement* opp Id on the new Recruiting opp via `Source_Re_Engagement_Opportunity_ID__c` (see §5.4). |
| `Previous_Recruiting_Opportunity_CLR__c`, `Previous_Recruting_Opp_CL_Details__c` | No direct mapping; use only for context in Re-Engagement. If needed on Recruiting, add a “Prior opp closed lost reason” field or fold into Description. |
| `Target_Re_Engagement_Date__c`, `Re_Engagement_Next_Touch_Date__c`, `Re_Engagement_Priority__c` | Do not copy; Re-Engagement workflow only. |

**Recommendation:** Set `Conversion_Channel__c` = `'Re-Engagement'` on the new Recruiting opportunity so reporting can segment re-engagement-sourced Recruiting opps. If `Conversion_Channel__c` is not in use for that today, confirm in Salesforce and add the value to the picklist.

### 5.4 Linking fields (to add in Salesforce and sync to BQ)

To link the two records and support funnel/reporting:

| Location | Field to add (or reuse) | Purpose |
|----------|--------------------------|---------|
| **Re-Engagement opportunity** | `Created_Recruiting_Opportunity_ID__c` (Lookup to Opportunity) | Store the Id of the **new** Recruiting opportunity created when stage = Re-Engaged. |
| **Recruiting opportunity** | `Source_Re_Engagement_Opportunity_ID__c` (Lookup to Opportunity) | Store the Id of the **Re-Engagement** opportunity this Recruiting opp was created from. |

After creating the new Recruiting opp in the Flow:

1. Set the new Recruiting opp’s `Source_Re_Engagement_Opportunity_ID__c` = Re-Engagement opp Id.
2. Update the Re-Engagement opp’s `Created_Recruiting_Opportunity_ID__c` = new Recruiting opp Id.

Sync both fields to BQ so `vw_funnel_master` (or a re-engagement funnel view) can join Re-Engagement → Recruiting and count conversions.

### 5.5 Implementation (Flow / automation)

- **When:** Record-Triggered Flow on **Opportunity** when `StageName` is updated to `Re-Engaged` **and** `RecordTypeId` = Re-Engagement.
- **What:** Create a new Opportunity with `RecordTypeId` = Recruiting; set fields per §5.1–5.4 (copy, defaults, Re-Engagement context, linking).
- **Name:** Derive new opp `Name` from Re-Engagement `Name` by removing the `[Re-Engagement] ` prefix.
- **Then:** Set linking fields on both records and, if desired, update Re-Engagement opp (e.g. close it or leave it as Re-Engaged for history).

---

## 6. Creating a Re-Engagement opportunity from a Closed Lost Recruiting opportunity

Today, users create a Re-Engagement opportunity **only** by going through the **Close Lost Opportunity** flow: they click **Close Lost Opportunity**, fill the modal (Closed Lost Reason, Closed Lost Details, “Would you like to open a re-engagement opportunity?” = Yes, Firm Type, etc.), and click **Close Opportunity**. That creates the Re-Engagement opp but forces them to re-close the opp (or to use the close-lost path even when the opp is already closed). The goal is to add a **separate** button, **Create Re-Engagement**, next to **Close Lost Opportunity**, so users can create a Re-Engagement opp **without** going through the close-lost modal. The new button should use the **same field mapping** that the current close-lost flow uses when “open a re-engagement opportunity” = Yes (Recruiting → Re-Engagement).

### 6.1 Current vs desired UX

| Current | Desired |
|--------|---------|
| User must open **Close Lost Opportunity** modal, enter Closed Lost Reason, Closed Lost Details, select “Would you like to open a re-engagement opportunity?” = **Yes**, review Firm Type, then click **Close Opportunity**. | User clicks a **Create Re-Engagement** button (next to **Close Lost Opportunity**). No modal (or an optional minimal confirmation). A new Re-Engagement opportunity is created with the same field mapping as the current flow. |
| Re-engagement is tied to the close-lost action; re-closing or re-entering close reason is required. | Re-engagement can be created independently; no need to re-close the Recruiting opp. |

**Button placement:** In Lightning, the **Close Lost Opportunity** button lives in the record’s action bar (highlights panel). Custom actions appear in the same area when added as **Quick Actions** to the Opportunity page layout. Add a **Create Re-Engagement** Quick Action so it shows next to (or near) **Close Lost Opportunity**.

**Visibility:** Show **Create Re-Engagement** only for **Recruiting** record type (`RecordTypeId = '012Dn000000mrO3IAI'`). Optionally restrict to opportunities that are already **Closed Lost** (so it’s clear they’re creating re-engagement from a closed opp). This can be enforced in the Quick Action’s visibility (e.g. filter by record type) or in the LWC/Flow that runs when the button is clicked.

### 6.2 Field mapping: Recruiting → Re-Engagement (same as current close-lost flow)

When creating a **new Re-Engagement opportunity** from the **current Recruiting opportunity**, copy and set fields as below. This should match what the existing close-lost modal does when “Would you like to open a re-engagement opportunity?” = Yes.

**Copy from Recruiting to new Re-Engagement opp (same API name):**

| Recruiting field (source) | Re-Engagement field (target) | Notes |
|---------------------------|------------------------------|--------|
| `Name` | `Name` | **Transform:** Prepend `[Re-Engagement] ` so the new opp is clearly a re-engagement (e.g. `Jesse Dusablon` → `[Re-Engagement] Jesse Dusablon`). |
| `OwnerId` | `OwnerId` | Same SGA/owner. |
| `Amount` | `Amount` | If populated. |
| `Underwritten_AUM__c` | `Underwritten_AUM__c` | If populated. |
| `CloseDate` | `CloseDate` | Can copy or set default (e.g. +90 days). |
| `NextStep` | `NextStep` | If populated. |
| `Description` | `Description` | If populated. |
| `LeadSource` | `LeadSource` | If populated. |
| `Final_Source__c` | `Final_Source__c` | Attribution. |
| `Finance_View__c` | `Finance_View__c` | Channel. |
| `External_Agency__c` | `External_Agency__c` | If populated. |
| `FA_CRD__c` | `FA_CRD__c` | Advisor identifier. |
| `Firm_Name__c` | `Firm_Name__c` | If populated. |
| `Personal_Email__c` | `Personal_Email__c` | If populated. |
| `Experimentation_Tag__c` | `Experimentation_Tag__c` | If populated. |
| `AccountId` | `AccountId` | If populated. |
| `ContactId` | `ContactId` | If populated. |

**Set on new Re-Engagement opp (link back to this Recruiting opp):**

| Field | Value | Notes |
|-------|--------|--------|
| `RecordTypeId` | `'012VS000009VoxrYAC'` (Re-Engagement) | Required. |
| `StageName` | `'Planned Nurture'` | First Re-Engagement stage. |
| `Previous_Recruiting_Opportunity_ID__c` | **Id of the current Recruiting opportunity** | Links Re-Engagement to the closed-lost Recruiting opp. |
| `Previous_Recruiting_Opportunity_CLR__c` | `Closed_Lost_Reason__c` from Recruiting | Closed Lost Reason of the Recruiting opp. |
| `Previous_Recruiting_Opportunity_Owner_ID__c` | `OwnerId` from Recruiting | Owner of the Recruiting opp. |
| `Previous_Recruting_Opp_CL_Details__c` | `Closed_Lost_Details__c` from Recruiting | Closed Lost details. |

**Optional (if the current close-lost flow sets them):** `Re_Engagement_Reason__c`, `Re_Engagement_Reason_Details__c`, `Target_Re_Engagement_Date__c`, `Re_Engagement_Next_Touch_Date__c`, `Re_Engagement_Priority__c` — leave blank when using the button, or add a small optional screen (e.g. “Reason?”) if you want to capture them without the full close-lost modal.

### 6.3 How to implement the “Create Re-Engagement” button in Salesforce

**Option A: Headless Quick Action (LWC + Apex) — recommended**

1. **Apex:** Create an Apex class with an `@InvocableMethod` or a public static method that accepts the current Opportunity Id, queries the Recruiting opportunity (with all fields to copy), creates a new Opportunity with `RecordTypeId` = Re-Engagement and `StageName` = Planned Nurture, and sets all mapped fields (including `Previous_Recruiting_Opportunity_ID__c`, `Previous_Recruiting_Opportunity_CLR__c`, etc.). Return the new Opportunity Id.
2. **LWC:** Create a Lightning Web Component that:
   - Implements **Quick Action** with `lightning__RecordAction` and `actionType` = **Action** (headless — no modal).
   - Exposes `@api recordId` and a public `@api invoke()` method.
   - In `invoke()`, call the Apex method with `this.recordId`, then use `NavigationMixin.GeneratePage` to navigate to the new Re-Engagement opportunity (or show a toast with a link). Optionally show a “Creating…” toast and then “Re-Engagement opportunity created.”
3. **Meta (XML):** In the LWC’s `*.meta.xml`, add:
   ```xml
   <targetConfigs>
     <targetConfig targets="lightning__RecordAction">
       <actionType>Action</actionType>
     </targetConfig>
   </targetConfigs>
   ```
   Do **not** add `lightning__RecordPage` for a headless action (to avoid “actionSubtype matched” errors).
4. **Quick Action:** In Setup → Object Manager → Opportunity → **Buttons, Links, and Actions**, create a **Lightning Web Component** quick action, select your LWC, and label it **Create Re-Engagement**.
5. **Page layout:** Edit the Opportunity **Record Page** in Lightning App Builder (or the **Page Layout** that controls actions). Add the **Create Re-Engagement** quick action to the **Highlights** panel / action bar so it appears next to **Close Lost Opportunity**.
6. **Visibility:** Use **Conditional Visibility** (or a custom LWC that only renders the button when `recordTypeId` = Recruiting and optionally `StageName` = Closed Lost) so the button only shows on Recruiting opportunities.

**Option B: Flow Quick Action (autolaunched Flow)**

1. **Flow:** Build an autolaunched Flow that:
   - Starts from a **Record-Triggered** or **Quick Action** (invoked with record Id).
   - Gets the current Opportunity (Recruiting) and all needed fields.
   - Creates a new Opportunity with Record Type = Re-Engagement, Stage = Planned Nurture, and sets every field per §6.2 (Name with `[Re-Engagement] ` prefix, OwnerId, Amount, …; `Previous_Recruiting_Opportunity_ID__c`, `Previous_Recruiting_Opportunity_CLR__c`, etc.).
   - Optionally navigates to the new record or shows success message.
2. **Quick Action:** Create a **Flow** quick action that launches this Flow, and add it to the Opportunity page layout next to **Close Lost Opportunity**.
3. **Visibility:** Restrict the Flow quick action to the Recruiting record type (and optionally Closed Lost) via the action’s visibility or a screen at the start of the Flow that checks record type and exits if not Recruiting.

**Recommendation:** Option A (LWC + Apex) gives full control over field mapping, error handling, and navigation, and keeps logic in one place. Option B is no-code and easier to change by admins; use it if the mapping is stable and you prefer Flow.

### 6.4 Summary

- **Goal:** A **Create Re-Engagement** button next to **Close Lost Opportunity** that creates a Re-Engagement opportunity from the current Recruiting opportunity **without** using the close-lost modal.
- **Mapping:** Use the same Recruiting → Re-Engagement field mapping as the current “open re-engagement” path (§6.2); link back via `Previous_Recruiting_Opportunity_ID__c`, `Previous_Recruiting_Opportunity_CLR__c`, `Previous_Recruiting_Opportunity_Owner_ID__c`, `Previous_Recruting_Opp_CL_Details__c`.
- **Implementation:** Headless Quick Action (LWC + Apex) or Flow Quick Action; add the action to the Opportunity record page so it appears next to **Close Lost Opportunity**; restrict to Recruiting record type (and optionally Closed Lost only).

---

## 7. Summary

| Topic | Current state | Target state |
|-------|----------------|--------------|
| **Record type** | Opportunity, `RecordTypeId = '012VS000009VoxrYAC'` | Unchanged. |
| **Stages** | **6 stages in BQ:** Planned Nurture (613), Closed Lost (113), Outreach (35), Re-Engaged (21), Call Scheduled (9), Engaged (3). | Add Stage_Entered_* for re-engagement stages if missing. |
| **Conversion to Recruiting** | Does **not** create a Recruiting Opportunity. | When stage = Re-Engaged: create Recruiting opp and link (both directions). |
| **Field mapping** | N/A. | Copy shared fields; set Recruiting defaults; map Re-Engagement–only fields to Description/Conversion_Channel; add linking fields. See [§5](#5-field-mapping-re-engagement--recruiting-opportunity). |
| **Create Re-Engagement from Recruiting** | Only via Close Lost modal (“Would you like to open a re-engagement opportunity?” = Yes). | Add **Create Re-Engagement** button next to **Close Lost Opportunity**; same Recruiting → Re-Engagement mapping, no close-lost modal. See [§6](#6-creating-a-re-engagement-opportunity-from-a-closed-lost-recruiting-opportunity). |
| **vw_funnel_master** | Re-Engagement opps appear as opportunity-only rows with no funnel stages. | Treat Re-Engagement as lead-like: Planned Nurture = created, Outreach = contacting, Call Scheduled = MQL, conversion to new Recruiting opp = SQL; then count these as new “leads” that create a new Recruiting opportunity. |

Next steps:

1. Confirm any `Stage_Entered_*` fields in Salesforce for Re-Engagement stages (stage picklist is confirmed in BQ — 6 stages).  
2. Add linking fields in Salesforce (`Created_Recruiting_Opportunity_ID__c` on Re-Engagement, `Source_Re_Engagement_Opportunity_ID__c` on Recruiting) and sync to BQ.  
3. Design and implement automation (Record-Triggered Flow) to create Recruiting opp when Re-Engagement reaches Re-Engaged, using the field mapping in [§5](#5-field-mapping-re-engagement--recruiting-opportunity).  
4. Add **Create Re-Engagement** button (Headless Quick Action LWC + Apex, or Flow Quick Action) per [§6](#6-creating-a-re-engagement-opportunity-from-a-closed-lost-recruiting-opportunity) so users can create Re-Engagement from Recruiting without the close-lost modal.  
5. Implement Option A or B in the view so re-engagement contributes to funnel counts and links to the new Recruiting opportunity.  
6. **Validate flows:** See [docs/flows/new_flows_validation.md](docs/flows/new_flows_validation.md) for a check of `docs/flows/new_flows` vs this doc (coverage, gaps, BQ/SF prerequisites).
