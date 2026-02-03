# Validation: docs/flows/new_flows vs re-engagement-record-type.md

This document checks whether the flows in `docs/flows/new_flows` are sufficient to execute what’s described in `re-engagement-record-type.md`, whether they do exactly what we want, and what’s missing or assumed (including BQ/Salesforce).

---

## 1. Flows present (7 total)

| Flow | Purpose (per doc) |
|------|-------------------|
| **Re_Engagement_Conversion_to_Recruiting** | When Re-Engagement opp reaches **Re-Engaged** → create Recruiting opp + link (§5). |
| **Button_Create_Re_Engagement_Opportunity** | **Create Re-Engagement** button from Recruiting opp → create Re-Engagement opp (§6). |
| **Opportunity_Stage_Entered_Outreach_Update** | Set Stage_Entered_Outreach__c when StageName = Outreach (§1.4). |
| **Opportunity_Stage_Entered_Call_Scheduled_Update** | Set Stage_Entered_Call_Scheduled__c when StageName = Call Scheduled (§1.4). |
| **Opportunity_Stage_Entered_Engaged_Update** | Set Stage_Entered_Engaged__c when StageName = Engaged (§1.4). |
| **Opportunity_Stage_Entered_Re_Engaged_Update** | Set Stage_Entered_Re_Engaged__c when StageName = Re-Engaged (§1.4). |
| **Opportunity_Stage_Entered_Closed_Update** | Set Stage_Entered_Closed__c when StageName = Closed Lost (shared; already exists in BQ). |

---

## 2. Coverage vs doc requirements

### 2.1 Re_Engagement_Conversion_to_Recruiting (§5)

- **Trigger:** Opportunity update, StageName = Re-Engaged, StageName IsChanged, RecordTypeId = 012VS000009VoxrYAC. **Correct.**
- **Creates** new Opportunity: RecordTypeId = 012Dn000000mrO3IAI, StageName = Qualifying. **Correct.**
- **Field mapping (§5.1):** Name (strip prefix), OwnerId, Amount, CloseDate (default +90), Conversion_Channel__c = Re-Engagement, Description, Experimentation_Tag__c, External_Agency__c, FA_CRD__c, Final_Source__c, Finance_View__c, Firm_Name__c, LeadSource, NextStep, Personal_Email__c, Underwritten_AUM__c, AccountId. **Present.**
- **Linking (§5.4):** Source_Re_Engagement_Opportunity_ID__c = $Record.Id on new opp; Created_Recruiting_Opportunity_ID__c = new opp Id on triggering Re-Engagement opp. **Present.**
- **Gap:** ContactId is not copied to the new Recruiting opp. Doc §5.1 says copy if populated. **Recommendation:** Add ContactId input assignment to Create_Recruiting_Opportunity.

**Verdict:** Aligned with doc and thorough. Optional: add ContactId.

---

### 2.2 Button_Create_Re_Engagement_Opportunity (§6)

- **Entry:** Screen Flow with input `recordId` (Quick Action). **Correct.**
- **Gets** current Opportunity by recordId; **creates** new Opportunity with RecordTypeId = 012VS000009VoxrYAC, StageName = Planned Nurture. **Correct.**
- **Currently mapped:** Name ([Re-Engagement] prefix), OwnerId, AccountId, CloseDate (+90), Previous_Recruiting_Opportunity_ID__c, Previous_Recruiting_Opportunity_CLR__c. **Correct but incomplete.**

**Missing vs §6.2:**

| Doc §6.2 field | In flow? |
|----------------|----------|
| Amount | No |
| Underwritten_AUM__c | No |
| NextStep | No |
| Description | No |
| LeadSource | No |
| Final_Source__c | No |
| Finance_View__c | No |
| External_Agency__c | No |
| FA_CRD__c | No |
| Firm_Name__c | No |
| Personal_Email__c | No |
| Experimentation_Tag__c | No |
| ContactId | No |
| Previous_Recruiting_Opportunity_Owner_ID__c | No |
| Previous_Recruting_Opp_CL_Details__c | No |

**Recommendation:** Add the missing input assignments to **Create_Re_Engagement_Opp** so the button flow matches §6.2 (same mapping as close-lost “open re-engagement” path). Also ensure the Quick Action is only available for **Recruiting** record type (and optionally only when StageName = Closed Lost) via layout/visibility.

**Verdict:** Not thorough enough yet; add the fields above to match the doc.

---

### 2.3 Stage_Entered_* flows (§1.4, §4.1)

- **Outreach, Call Scheduled, Engaged, Re-Engaged:** Each flow runs on Opportunity update when StageName = [stage] and StageName IsChanged; updates the corresponding Stage_Entered_*__c to $Flow.CurrentDateTime. **Logic is correct.**
- **Closed:** Same pattern for StageName = Closed Lost → Stage_Entered_Closed__c. **Correct** (field already exists in BQ).

**Prerequisite (Salesforce + BQ):**  
The doc and BQ schema state that **Stage_Entered_Outreach__c**, **Stage_Entered_Call_Scheduled__c**, **Stage_Entered_Engaged__c**, **Stage_Entered_Re_Engaged__c** do **not** exist on Opportunity in BQ today. So:

1. **Create these 4 custom fields** on Opportunity in Salesforce (DateTime or appropriate type), deploy to the org.
2. **Include them in the sync** to BigQuery so funnel/cohort logic can use them.

Until then, the four flows that set them will fail at runtime (invalid field). **Stage_Entered_Closed__c** already exists; the Closed flow is fine once deployed.

**Optional:** A flow to set **Stage_Entered_Planned_Nurture__c** when StageName = Planned Nurture (on create or when stage changes to Planned Nurture). Doc uses CreatedDate for “created”; a dedicated field is optional.

**Verdict:** Flows are correct; they are **not** sufficient until the four Stage_Entered_* fields exist in Salesforce (and ideally in BQ).

---

## 3. BigQuery validation

- **RecordTypeIds:** 012Dn000000mrO3IAI (Recruiting) and 012VS000009VoxrYAC (Re-Engagement) are used in the doc and in BQ; **valid.**
- **Stage names:** Planned Nurture, Outreach, Call Scheduled, Engaged, Re-Engaged, Closed Lost are confirmed in BQ for Re-Engagement; **valid.**
- **Existing Opportunity fields** used by the flows and already in BQ: Stage_Entered_Closed__c, Previous_Recruiting_Opportunity_ID__c, Previous_Recruiting_Opportunity_CLR__c, Closed_Lost_Reason__c, Closed_Lost_Details__c, Name, OwnerId, Amount, etc. **Valid.**
- **Fields that must exist in Salesforce (and then BQ) before the flows are fully usable:**
  - **Created_Recruiting_Opportunity_ID__c** (Re-Engagement opp)
  - **Source_Re_Engagement_Opportunity_ID__c** (Recruiting opp)
  - **Stage_Entered_Outreach__c**
  - **Stage_Entered_Call_Scheduled__c**
  - **Stage_Entered_Engaged__c**
  - **Stage_Entered_Re_Engaged__c**

These are **not** in the current BQ Opportunity schema; add them in Salesforce and add them to the sync to BQ so reporting and vw_funnel_master (or re-engagement funnel view) can use them.

---

## 4. Summary

| Requirement | Covered by new_flows? | Notes |
|-------------|------------------------|--------|
| §5 Re-Engaged → create Recruiting opp + link | Yes | Re_Engagement_Conversion_to_Recruiting; optional: add ContactId. |
| §5.4 Linking fields | Yes (in flow) | Created_Recruiting_Opportunity_ID__c, Source_Re_Engagement_Opportunity_ID__c must exist in SF + BQ. |
| §6 Create Re-Engagement button | Partially | Button flow exists but is missing many §6.2 fields; add full mapping. |
| §1.4 / §4.1 Stage_Entered_* for funnel | Yes (in flow) | Four new Stage_Entered_* fields must be created in SF and synced to BQ. |
| Stage_Entered_Closed__c | Yes | Field exists in BQ; Closed flow is fine. |
| Stage_Entered_Planned_Nurture__c | No | Optional; doc uses CreatedDate for “created.” |

**Conclusion:**  
We have the right set of flows to execute the doc, but:

1. **Button_Create_Re_Engagement_Opportunity** must be extended with all §6.2 fields so it matches the doc and behaves like the close-lost “open re-engagement” path.  
2. **Salesforce:** Create and deploy the linking fields and the four Stage_Entered_* fields; then the flows will be thorough and correct.  
3. **BigQuery:** Include the new fields in the Opportunity sync so we can validate and use them for funnel/cohort logic.

Once the Button flow is completed and the new fields exist in Salesforce (and BQ), the flows will do what we want and will be thorough enough to execute `re-engagement-record-type.md`.
