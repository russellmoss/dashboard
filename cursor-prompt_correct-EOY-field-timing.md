# Cursor Prompt: Correct EOY Report for Field Timing & Data Issues

**File:** `C:\Users\russe\Documents\Dashboard\EOY_Re-Engagement_Distribution-2025.md`

**Context:** The report has been fully executed (all Answer placeholders filled). However, two Salesforce features were deployed AFTER the 290 opps were created on 2025-12-30, and the report doesn't account for this. Several answers and the Phase 10.1 summary contain conclusions that are either wrong or misleading because of it. There is also a data discrepancy between Phase 5.3 and Phase 6.3 that needs investigation.

**Task:** Make the corrections described below by editing the existing answers in place. Run new queries via MCP → BigQuery where specified. Do NOT remove existing data/tables — add caveats, new sections, and corrected interpretations alongside them.

---

## Background: What was deployed after these opps were created

The 290 Re-Engagement opps were bulk-created on **2025-12-30**. Two things were added to Salesforce **after** that date, while these opps were already being worked:

1. **Stage-entered timestamp fields** (`Stage_Entered_Outreach__c`, `Stage_Entered_Engaged__c`, `Stage_Entered_Call_Scheduled__c`, `Stage_Entered_Re_Engaged__c`) — only capture transitions that occurred **after** deployment. The Phase 3.4 Verification already confirmed: has_outreach_date=1, has_engaged_date=0, has_call_sched_date=0, has_re_engaged_date=0 out of 290. These are **structurally NULL**, not "sparse." `Stage_Entered_Closed__c` has 69 because closures happened after deployment (Jan 13+).

2. **Re-Engagement → Recruiting conversion flow** (populates `Created_Recruiting_Opportunity_ID__c`) — added after the opps were created. Any SGA who manually created a Recruiting opp before the flow existed would have `Created_Recruiting_Opportunity_ID__c = NULL` even if a real conversion occurred.

Additionally: **SGA stage discipline was not enforced during this period.** SGAs were working opps (making calls, sending SMS) without moving stages from Planned Nurture. This means StageName does NOT reflect work status for this cohort.

---

## Correction 1: Phase 2.3 — Stage ≠ Work (add caveat)

**Problem:** Phase 2.3's `pct_actively_working` metric says Ryan Crandall is 0% (all 25 in Planned Nurture). But Phase 6.1 shows Ryan is **88% worked** (22 opps with real outbound activity, 31 tasks). The same applies to many other SGAs. The stage distribution is misleading because SGAs were working leads without moving stages.

**What to do:** After the existing Phase 2.3 Summary, add:

```
> ⚠️ **CAVEAT: Stage ≠ Work for this cohort.** `pct_actively_working` (based on StageName) dramatically understates actual effort. Example: **Ryan Crandall** shows 0% actively working here (25 in Planned Nurture) but Phase 6.1 shows **88% worked** (22 opps with real outbound activity, 31 tasks including SMS and LinkedIn). SGAs were working leads without moving stages from Planned Nurture — stage discipline was not enforced during this period. **Use Phase 6.1 (activity-based) as the real accountability metric, not this table's pct_actively_working.**
```

---

## Correction 2: Phase 3.4 — MQL/SQL are structural undercounts (add caveat)

**Problem:** Phase 3.4 shows contacted=90, MQL=2, SQL=0. The contacted count is reliable (activity-based). But MQL and SQL for Closed Lost records fall back on `Stage_Entered_Engaged__c IS NOT NULL` and `Stage_Entered_Re_Engaged__c IS NOT NULL` — both structurally NULL for this cohort. Any Closed Lost opp that was engaged or had a call scheduled before the fields were deployed shows as "contacted but not MQL." The 15 Closed Lost with real outbound activity could include opps that were truly engaged but have no stage date to prove it.

The current MQL=2 represents only the 2 opps **currently sitting in Engaged stage** that also have activity. It misses:
- Closed Lost that were engaged before closure (Stage_Entered_Engaged__c is NULL)
- Opps that were engaged but regressed or closed without the date stamp

**What to do:** After the existing Phase 3.4 Summary, add:

```
> ⚠️ **CAVEAT: MQL and SQL are structural undercounts (field timing).** Stage-entered date fields (`Stage_Entered_Engaged__c`, `Stage_Entered_Re_Engaged__c`) were deployed after these 290 opps were created. They are structurally NULL for any opp that transitioned through Engaged/Call Scheduled/Re-Engaged before deployment. The 15 Closed Lost with real outbound activity may include opps that reached Engaged or beyond before closure, but with no date stamp, they count as "contacted but not MQL." **MQL=2 and SQL=0 are floors, not true rates.** The actual MQL/SQL counts are unknowable for this cohort's Closed Lost records.
```

Also update the Phase 3 intro note (line ~318) to say: "Phases 3.1 and 3.2 undercount 'contacted'; **Phase 3.4 undercounts MQL/SQL for Closed Lost** due to structurally NULL stage-entered dates (deployed after cohort creation)."

---

## Correction 3: Phase 5.3 — Re-run (data discrepancy)

**Problem:** Phase 5.3 answer shows **only Call (24 tasks, 15.1%)** as the sole real outbound channel. But Phase 6.3 shows **159 total tasks** across Call (24), SMS (108), LinkedIn (26), and Meeting (0). These use the same view, same filter, same join. They cannot both be right.

Phase 5.2 confirmed 159 total real outbound tasks. Phase 6.3's per-SGA totals sum to 159. So Phase 5.3's answer is wrong — it only captured 1 channel group.

**What to do:** Re-run the Phase 5.3 query via MCP → BigQuery:

```sql
WITH dec30_opp_ids AS (
  SELECT Id AS opp_id
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
  WHERE IsDeleted = FALSE
    AND RecordTypeId = '012VS000009VoxrYAC'
    AND DATE(CreatedDate) = '2025-12-30'
)
SELECT
  a.activity_channel_group AS channel,
  COUNT(*) AS task_count,
  COUNT(DISTINCT a.task_what_id) AS opps_touched,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) AS pct_of_total
FROM `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` a
INNER JOIN dec30_opp_ids d ON d.opp_id = a.task_what_id
WHERE a.activity_channel_group NOT IN ('Marketing', 'Other', 'Email (Engagement)')
  AND a.activity_channel_group IS NOT NULL
  AND a.direction = 'Outbound'
GROUP BY a.activity_channel_group
ORDER BY task_count DESC;
```

Replace the Phase 5.3 answer table and summary with the new results. The total should be ~159 tasks across multiple channels (Call, SMS, LinkedIn at minimum), consistent with Phase 6.3. Add a note: "Phase 5.3 re-run on [date] to correct prior result that showed only Call; Phase 6.3 confirms multi-channel activity."

Also update the Phase 6.3 Verification block (line ~1316-1317) — its "Result" text also says "only Call (24 tasks)" which contradicts its own Phase 6.3 answer. Change the Result text to reflect the actual channel distribution from the re-run.

---

## Correction 4: Phase 8 — Add Phase 8.4 (unlinked conversions)

**Problem:** Phase 8 shows 0 conversions. The conversion flow was deployed after these opps were created. Any SGA who re-engaged an advisor and manually created a Recruiting opp before the flow existed would not have `Created_Recruiting_Opportunity_ID__c` set. The 0% may not be real.

**What to do:** After Phase 8.3's answer, add a new section:

```
---

## 8.4 Unlinked Recruiting Opps — Manual Conversions Before Flow Existed

The Re-Engagement → Recruiting conversion flow (which populates `Created_Recruiting_Opportunity_ID__c`) was deployed after these 290 opps were created on 2025-12-30. Any SGA who re-engaged an advisor and manually created a Recruiting opp before the flow existed would NOT have the link field set. This query checks for Recruiting opps created for the same contacts after Dec 30 that are NOT linked to any Re-Engagement opp.
```

Then run this query via MCP → BigQuery:

```sql
WITH dec30_re_eng AS (
  SELECT
    o.Id AS re_eng_opp_id,
    o.Name AS re_eng_name,
    o.ContactId,
    o.AccountId,
    COALESCE(o.Opportunity_Owner_Name__c, u.Name) AS sga_name,
    o.StageName AS re_eng_stage
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
  LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.User` u ON u.Id = o.OwnerId
  WHERE o.IsDeleted = FALSE
    AND o.RecordTypeId = '012VS000009VoxrYAC'
    AND DATE(o.CreatedDate) = '2025-12-30'
),
linked_recruiting_ids AS (
  SELECT Created_Recruiting_Opportunity_ID__c AS id
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
  WHERE IsDeleted = FALSE
    AND Created_Recruiting_Opportunity_ID__c IS NOT NULL
),
recruiting_opps AS (
  SELECT
    r.Id AS recruiting_opp_id,
    r.Name AS recruiting_name,
    r.ContactId,
    r.AccountId,
    r.StageName AS recruiting_stage,
    r.CreatedDate AS recruiting_created_date,
    COALESCE(r.Opportunity_Owner_Name__c, u2.Name) AS recruiting_sga
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` r
  LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.User` u2 ON u2.Id = r.OwnerId
  WHERE r.IsDeleted = FALSE
    AND r.RecordTypeId = '012Dn000000mrO3IAI'
    AND r.CreatedDate >= TIMESTAMP('2025-12-30')
    AND r.Id NOT IN (SELECT id FROM linked_recruiting_ids)
)
SELECT
  d.re_eng_opp_id,
  d.re_eng_name,
  d.sga_name,
  d.re_eng_stage,
  r.recruiting_opp_id,
  r.recruiting_name,
  r.recruiting_stage,
  DATE(r.recruiting_created_date) AS recruiting_created_date,
  r.recruiting_sga
FROM dec30_re_eng d
INNER JOIN recruiting_opps r
  ON (r.ContactId = d.ContactId AND d.ContactId IS NOT NULL)
  OR (r.AccountId = d.AccountId AND d.AccountId IS NOT NULL AND d.ContactId IS NULL)
ORDER BY r.recruiting_created_date;
```

Write the answer:
- If 0 rows: "No unlinked Recruiting opps found for Dec 30 cohort contacts. Phase 8.1-8.3 conversion count of 0 is confirmed — no manual conversions predating the flow."
- If >0 rows: Show the full results table. These are **potential unlinked conversions** — advisors from the Dec 30 re-engagement cohort who had a Recruiting opp created without using the conversion flow. Count them separately as "unlinked conversions" and note that the real conversion count is Phase 8.1 count + Phase 8.4 count.

---

## Correction 5: Phase 10.1 — Rewrite with field timing context

**Problem:** The Phase 10.1 summary presents all findings as if the data is complete. It says "0 converted to recruiting" without caveating the conversion flow timing. It says MQL/SQL rates are "low" without explaining they're structural undercounts. It doesn't mention the stage-vs-activity contradiction.

**What to do:** Rewrite the Phase 10.1 answer. Keep the same 11-question structure but incorporate the corrections. Specifically:

**Replace the existing Phase 10.1 answer (everything between `**Answer:**` and the `---` before APPENDIX)** with a corrected version that includes:

1. **Cohort Size** — same as current, no change needed.

2. **Open vs Closed** — same as current.

3. **Stage Distribution** — keep the numbers BUT add: "However, stage distribution does not reflect work status for this cohort. SGAs were working leads without moving stages (e.g., Ryan Crandall: 25 in Planned Nurture but 88% worked per Phase 6.1). Use Phase 6.1 activity data for actual work status."

4. **Are These Leads Being Worked?** — same 90/290 (31%) figure. This is the reliable metric.

5. **Who Is Working Most Aggressively?** — same, using Phase 6.1 activity data (Ryan 88%, Russell 80%, etc.).

6. **Who Is Lagging Behind?** — same.

7. **Conversion Rates** — Change to: "Phase 3.4 (activity-based contacted) is the only reliable conversion metric: 90 contacted (31%). **MQL and SQL rates are structural undercounts** — the stage-entered date fields were deployed after these opps were created, so any Closed Lost opp that reached Engaged/Re-Engaged before deployment shows no stage date. MQL=2 and SQL=0 are floors, not true rates. Current-stage counts (Phase 3.2: 5 MQL, 3 SQL, 2 Re-Engaged) are the best proxy for downstream conversion but exclude Closed Lost that progressed."

8. **Recruiting Conversion** — Change to: "Phase 8.1-8.3: 0 linked conversions via `Created_Recruiting_Opportunity_ID__c`. **However**, the conversion flow was deployed after these opps were created. Phase 8.4 checked for unlinked Recruiting opps created for the same contacts: [insert 8.4 result — either 0 confirmed or N unlinked found]. [If 0: The 0% conversion rate is confirmed.] [If >0: Actual conversion count is N (unlinked, manual conversions predating the flow).]"

9. **Closed Lost Reasons** — same. The closed-lost data is clean because all closures happened after Stage_Entered_Closed__c was deployed (Jan 13+).

10. **Staleness Risk** — same.

11. **Actionable Recommendations** — keep the 5 existing recommendations but update:
    - Recommendation 3: Change from "use activity-based contacted for goals" to "**Use activity data (Phase 6.1) as the definitive accountability metric**, not StageName. Stage distribution is unreliable for this cohort — SGAs were working leads without moving stages. Set contacted targets using real outbound activity counts."
    - Add a 6th recommendation: "**Enforce stage discipline going forward.** This cohort shows 209 in Planned Nurture by stage but only 200 with zero activity — meaning ~9 opps were worked but stages weren't updated. As stage-entered timestamps are now live, require SGAs to move stages as they work so stage and activity data align."
    - If Phase 8.4 found unlinked conversions, add a 7th: "**Backfill conversion links.** [N] Recruiting opps were manually created for Dec 30 cohort contacts before the conversion flow existed. Link them to their Re-Engagement opps in Salesforce so conversion tracking is complete."

**Add a "Data Limitations" section** between the findings (questions 1-10) and the recommendations (question 11):

```
### Data Limitations for This Cohort

Three structural data gaps affect this analysis. All stem from Salesforce features being deployed after these 290 opps were created on 2025-12-30:

1. **Stage-entered dates are structurally NULL.** `Stage_Entered_Outreach__c` through `Stage_Entered_Re_Engaged__c` were added after cohort creation. Only 1 of 290 has an Outreach date; 0 have Engaged/Call Scheduled/Re-Engaged dates. This means MQL and SQL conversion rates for Closed Lost records are structural undercounts — we cannot determine how far those 15 worked-then-closed opps progressed. `Stage_Entered_Closed__c` has full coverage (69/69 Closed Lost) because all closures occurred after the field was deployed (Jan 13+).

2. **The Re-Engagement → Recruiting conversion flow was deployed after cohort creation.** `Created_Recruiting_Opportunity_ID__c` may not capture conversions that occurred before the flow existed. Phase 8.4 checked for unlinked Recruiting opps. [Insert 8.4 result here.]

3. **Stage discipline was not enforced.** SGAs worked leads without moving stages from Planned Nurture. Stage distribution (Phase 2) does not reflect work status. Activity data (Phase 5.2, 6.1) is the only reliable measure of effort. Example: Ryan Crandall — 25 in Planned Nurture by stage, but 88% worked (22 opps, 31 real outbound tasks) by activity.

**Bottom line:** For this cohort, trust activity data (Phases 5-7) for accountability, current StageName (Phase 3.2) for best-available funnel position, and treat all stage-entered-date-based conversion rates as floors.
```

---

## Execution order

1. Re-run Phase 5.3 query → update 5.3 answer and 6.3 Verification result text
2. Run Phase 8.4 query → add 8.4 section with answer
3. Add Phase 2.3 caveat
4. Add Phase 3.4 caveat + update Phase 3 intro
5. Rewrite Phase 10.1 with Data Limitations and corrected interpretations (incorporate 8.4 result)
6. Save the file

After each step, save. Do not create a separate file.
