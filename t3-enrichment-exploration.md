# T3 Conference Enrichment — Exploration Plan

This document describes in plain English how we will enrich **`savvy-gtm-analytics.ml_features.T3-conference`** with CRM outcomes: whether each person **replied**, **entered nurture**, **SQL'd**, or **SQO'd** at some point, using our existing definitions and the tables **Lead**, **Opportunity**, and **Task**.

---

## 1. What we're enriching

**Source table:** `savvy-gtm-analytics.ml_features.T3-conference`  
- External table (Google Sheets). Columns we care about for **matching to CRM**:
  - **`CRM_ID`** — Salesforce Id (Lead or Opportunity; 18 chars).
  - **`lead_url`** — Salesforce URL for the Lead (e.g. `.../Lead/00Q.../view`).
  - **`opp_url`** — Salesforce URL for the Opportunity (e.g. `.../Opportunity/006.../view`).

The table already has some CRM-derived fields (`lead_status`, `lead_disposition`, `opp_stage`, `opp_is_closed`, `opp_is_won`, etc.). The **enrichment** adds explicit flags (or columns) for:

- **Replied** — At least one “reply” task linked to this lead (or their opportunity).
- **Entered nurture** — Either (or both):
  - **Lead nurture:** The lead (prospect) is or has ever been in a **lead-level nurture** stage (exact field/values to be confirmed — e.g. Lead `Status` or a stage timestamp).
  - **Opportunity nurture:** An opportunity linked to this person is or has ever been in the **Planned Nurture** stage.
- **SQL'd** — Lead converted to an opportunity (our standard SQL definition).
- **SQO'd** — An opportunity linked to this person ever became SQO (our standard SQO definition).

**Chosen approach:** We will output **five columns** (`crm_replied`, `crm_lead_nurture`, `crm_opp_planned_nurture`, `crm_sql`, `crm_sqo`) and **join back to T3** in a view or a new table. Two nurture flags allow reporting to distinguish “nurtured as lead” vs “nurtured as opportunity”; a single “any nurture” can be derived as `crm_lead_nurture OR crm_opp_planned_nurture`.

---

## 2. How we define SQL, SQO, Replied, and Nurture (our existing definitions)

### SQL (Sales Qualified Lead)
- **Meaning:** The lead was **converted to an Opportunity** in Salesforce.
- **Where:** `SavvyGTMData.Lead`.
- **How we know:** `IsConverted = TRUE` and `ConvertedDate` (we use `converted_date_raw` in the funnel view). So we’ll treat a Lead as “SQL’d” if that Lead row has `IsConverted = TRUE` (and we can use `ConvertedOpportunityId` to get the Opportunity Id).

### SQO (Sales Qualified Opportunity)
- **Meaning:** An opportunity was qualified (vetted) — **not** “SQL” in the funnel sense; the field name is confusing in Salesforce.
- **Where:** `SavvyGTMData.Opportunity`.
- **How we know:** `SQL__c = 'Yes'` and `Date_Became_SQO__c` is set. For recruiting we also restrict to Recruiting record type: `RecordTypeId = '012Dn000000mrO3IAI'`. So we’ll treat an Opportunity as “SQO’d” if it has `LOWER(SQL__c) = 'yes'` (and optionally the record type filter if we only care about recruiting).

### Replied (from Task data)
- **Meaning:** The prospect **replied** to outreach (email, LinkedIn, etc.) — we infer this from **Task** records that represent a reply.
- **Where:** `SavvyGTMData.Task`.
- **How we know (today in our code):** We classify “Reply Received” when `Subject LIKE '%replied%'` (e.g. LinkedIn reply tasks). We can extend “replied” to include other reply-like tasks, e.g.:
  - `Subject LIKE '%replied%'`
  - Inbound-style tasks: `Subject LIKE '%Incoming%'` or `Subject LIKE '%Inbound%'`
  - Call answered: `Subject LIKE '%answered%'` (and not missed)
  - Optional: other Type/Subject patterns the business considers “reply” (e.g. email reply).
- **Linking:** Tasks are tied to Lead via **`WhoId`** (Lead Id) and/or to Opportunity via **`WhatId`** (Opportunity Id). So “replied” = exists at least one such Task where `WhoId = <lead_id>` or `WhatId = <opp_id>`.

### Entered nurture (two places to check)

We have **two** “nurture” concepts; we expose **two flags** (see chosen approach above):

1. **Lead-level nurture (prospect)**  
   - **Meaning:** The **Lead** is or has ever been in a nurture stage (e.g. “Nurture”, “Lead Nurture”, or whatever the prospect lifecycle stage is called in Salesforce).  
   - **Where:** `SavvyGTMData.Lead`.  
   - **How we know:** Depends on how lead stage is stored. In our codebase we see:
     - **`Status`** on Lead used as “lead stage” (e.g. in `enrich-la-advisors-lead-opp.ts`: `Status AS lead_stage`).
     - **`stage_entered_new__c`** on Lead (and for Re-Engagement opps we map Opportunity’s Planned Nurture into that).
   - **To implement:** Confirm with the team the **exact Lead field and picklist values** that mean “in nurture” (e.g. `Status = 'Nurture'` or `'Lead Nurture'`, or a dedicated `Stage_Entered_Nurture__c` if it exists). Then: for each T3 row’s Lead Id, check whether that Lead has **ever** been in that stage (current value and/or historical — if we only have current state, then “ever” = current `Status`/stage equals the nurture value).

2. **Opportunity-level nurture (Planned Nurture)**  
   - **Meaning:** An **Opportunity** linked to this person is or has ever been in the **Planned Nurture** stage.  
   - **Where:** `SavvyGTMData.Opportunity`.  
   - **How we know:** `StageName = 'Planned Nurture'` **or** `Stage_Entered_Planned_Nurture__c IS NOT NULL`. So for this person’s Opportunity (or Opportunities), at least one has (or had) `StageName = 'Planned Nurture'` or a non-null `Stage_Entered_Planned_Nurture__c`.

**Enrichment output (decided):** We will use **two separate flags** — `crm_lead_nurture` (ever in lead nurture stage) and `crm_opp_planned_nurture` (ever in Opp Planned Nurture) — so reporting can distinguish “nurtured as lead” vs “nurtured as opportunity”. A single “any nurture” flag can be derived as `crm_lead_nurture OR crm_opp_planned_nurture` when needed.

---

## 3. How we'll relate T3-conference to Lead, Opportunity, and Task

### Resolving identities from T3-conference

- **Lead Id:**  
  - If **`lead_url`** is present: parse the Id from the URL (last path segment before `/view` or the 18-char Id segment).  
  - Else if **`CRM_ID`** is a Lead Id (prefix `00Q`): use `CRM_ID` as Lead Id.
- **Opportunity Id:**  
  - If **`opp_url`** is present: parse the Id from the URL.  
  - Else if **`CRM_ID`** is an Opportunity Id (prefix `006`): use `CRM_ID` as Opportunity Id.  
  - Else: from **Lead**, get `ConvertedOpportunityId` for that Lead (so we can still get an Opp even when T3 only has a lead_url/CRM_ID pointing to Lead).

So we can build a **mapping** from each T3 row to one or both of: **Lead Id**, **Opportunity Id**.

### Relating to our tables

- **Lead table (`SavvyGTMData.Lead`):**  
  - Match by **Lead Id** (from `lead_url` or `CRM_ID`).  
  - Use this to get: **SQL'd** = `IsConverted = TRUE` (and `ConvertedOpportunityId` for linking to Opp).
- **Opportunity table (`SavvyGTMData.Opportunity`):**  
  - Match by **Opportunity Id** (from `opp_url`, `CRM_ID`, or Lead’s `ConvertedOpportunityId`).  
  - Use this to get: **SQO'd** = `LOWER(SQL__c) = 'yes'` (and optional Recruiting record type); **Opportunity nurture** = `StageName = 'Planned Nurture'` or `Stage_Entered_Planned_Nurture__c IS NOT NULL`.
- **Lead table (for nurture):**  
  - Same Lead Id as above. Use this to get: **Lead nurture** = Lead is or ever was in the lead-level nurture stage (exact field/values TBD — e.g. `Status` or a stage timestamp).
- **Task table (`SavvyGTMData.Task`):**  
  - Match by **`WhoId` = Lead Id** or **`WhatId` = Opportunity Id** (for any Opp we linked to this person).  
  - Use this to get: **Replied** = exists at least one Task with our reply criteria (e.g. `Subject LIKE '%replied%'` or the extended set above), and `IsDeleted = FALSE`.

---

## 4. Implementation approach (plain English)

1. **Normalize T3 identifiers**
   - For each row in `ml_features.T3-conference`, derive **Lead Id** and/or **Opportunity Id** from `lead_url`, `opp_url`, and `CRM_ID` (and from Lead.ConvertedOpportunityId when we only have a Lead Id).

2. **Compute enrichment flags from CRM**
   - **SQL'd:** For each T3 row, if we have a Lead Id, check `SavvyGTMData.Lead` for that Id and set “SQL'd” if `IsConverted = TRUE`.
   - **SQO'd:** For each T3 row, consider all Opportunity Ids we have (from opp_url, CRM_ID, or ConvertedOpportunityId). In `SavvyGTMData.Opportunity`, check if any of those opportunities have `LOWER(SQL__c) = 'yes'` (and optionally Recruiting record type). If yes, set “SQO'd”.
   - **Lead nurture:** For each T3 row, if we have a Lead Id, check `SavvyGTMData.Lead` for that Id. Set “lead nurture” if the Lead is or has ever been in the lead-level nurture stage (exact logic TBD once we confirm field/values — e.g. `Status = 'Nurture'` or similar).
   - **Opportunity nurture (Planned Nurture):** Same set of Opportunity Ids; in `SavvyGTMData.Opportunity`, check if any have `StageName = 'Planned Nurture'` or `Stage_Entered_Planned_Nurture__c IS NOT NULL`. If yes, set “opp Planned Nurture”.
   - **Replied:** For each T3 row, take all Lead Ids and Opportunity Ids we have. In `SavvyGTMData.Task`, check if there is any task with `IsDeleted = FALSE` and (e.g.) `Subject LIKE '%replied%'` (and optionally other reply patterns) where `WhoId` is one of the Lead Ids or `WhatId` is one of the Opportunity Ids. If yes, set “Replied”.

3. **Output (decided)**  
   We will **add columns to the enrichment output** and join back to T3. The enrichment will add these columns:
   - `crm_replied`
   - `crm_lead_nurture`
   - `crm_opp_planned_nurture`
   - `crm_sql`
   - `crm_sqo`  
   The result will be joined back to T3 in a **view or a new table** (e.g. `ml_features.T3_conference_enriched` or a view that selects from T3-conference plus the enrichment flags). A derived column `crm_any_nurture` = `crm_lead_nurture OR crm_opp_planned_nurture` can be added in that view/table if desired.

4. **Edge cases**
   - **CRM_ID / URLs missing:** That row gets no Lead/Opp Ids; we can’t enrich it from CRM (flags stay false or null).
   - **Multiple opportunities per person:** We consider “at least one” for SQO and “opp Planned Nurture” (any Opp in Planned Nurture counts).
   - **Task on Lead vs Opportunity:** We count reply tasks on either WhoId (Lead) or WhatId (Opportunity) so we don’t miss replies recorded on the Opp after conversion.

---

## 5. Summary

- **T3-conference** gives us a list of people and, when present, **CRM_ID**, **lead_url**, and **opp_url**.
- We **parse Lead Id and Opportunity Id** from those fields (and from Lead → ConvertedOpportunityId when needed).
- We use **our existing definitions**: SQL = Lead converted; SQO = Opportunity with `SQL__c = 'Yes'`; Replied = Task with reply-like Subject (and optionally other patterns). **Nurture** = two checks: (1) Lead is or ever was in the **lead nurture** stage (field/values TBD), and/or (2) Opportunity is or ever was in **Planned Nurture** (`StageName = 'Planned Nurture'` or `Stage_Entered_Planned_Nurture__c IS NOT NULL`).
- We **join** to **Lead**, **Opportunity**, and **Task** on those Ids and compute the five enrichment flags (`crm_replied`, `crm_lead_nurture`, `crm_opp_planned_nurture`, `crm_sql`, `crm_sqo`), then attach them back to T3 by **adding these columns to the enrichment output and joining back to T3** in a view or a new table. A single “any nurture” flag can be derived as `crm_lead_nurture OR crm_opp_planned_nurture` when needed.

**Before implementation:** Confirm with the team the exact Lead field and picklist value(s) that mean “in nurture” at the prospect level (e.g. `Lead.Status` or a stage-entered timestamp), so we can implement the lead nurture flag correctly.

Next step is to implement this in SQL (e.g. in BigQuery): a query that parses T3’s IDs and joins to Lead/Opportunity/Task to produce the five flags (`crm_replied`, `crm_lead_nurture`, `crm_opp_planned_nurture`, `crm_sql`, `crm_sqo`), then a **view or a new table** that joins that result back to `ml_features.T3-conference` with these columns added for reporting.

---

## 6. Implementation completed (BigQuery view)

The enrichment view has been created in BigQuery via MCP:

- **View:** `savvy-gtm-analytics.ml_features.T3_conference_enriched`
- **Source SQL:** `views/vw_t3_conference_enriched.sql` in this repo

The view selects from `ml_features.T3-conference` (Google Sheets external table), parses Lead/Opportunity Ids from `lead_url`, `opp_url`, and `CRM_ID`, joins to `SavvyGTMData.Lead`, `SavvyGTMData.Opportunity`, and `SavvyGTMData.Task`, and adds:

- `crm_sql` — Lead converted (IsConverted = TRUE)
- `crm_lead_nurture` — Lead Status LIKE '%nurture%' (update in view when team confirms exact values)
- `crm_opp_planned_nurture` — Opportunity in Planned Nurture stage
- `crm_sqo` — Opportunity with SQL__c = 'Yes' (Recruiting record type)
- `crm_replied` — At least one reply-like Task (WhoId/WhatId) linked
- `crm_any_nurture` — crm_lead_nurture OR crm_opp_planned_nurture

**Note:** Querying the view requires the same Drive/Sheets access as the base table `T3-conference`. If you see “Permission denied while getting Drive credentials”, grant the BigQuery credentials access to the Google Sheet.
