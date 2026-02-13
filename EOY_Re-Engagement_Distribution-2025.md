# EOY Re-Engagement Distribution — 2025

> **Cohort**: 290 Re-Engagement Opportunities created 2025-12-30  
> **Record Type**: Re-Engagement (`RecordTypeId = '012VS000009VoxrYAC'`)  
> **Date Filter**: `DATE(CreatedDate) = '2025-12-30'`  
> **Reporting Window**: 2025-12-30 through 2026-02-10 (QTD)  
> **Purpose**: Agentic exploration of the 290 EOY re-engagement opportunities — stage distribution, SGA accountability, activity analysis, conversion rates, closed-lost dispositions, and recruiting-opportunity conversion  
> **For**: Cursor.ai with MCP connection to BigQuery  
> **Instructions**: Run each query in order using your BigQuery MCP connection. After each query, **APPEND your answer directly below the query** in this document (in the `**Answer:**` placeholder). Do NOT create a separate file. The final document should contain both questions AND answers as a complete audit trail.  
> **Views Referenced**:  
> - Funnel: `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` (local: `views/vw_funnel_master.sql`). Includes Re-Engagement opps via `RecordTypeId IN ('012Dn000000mrO3IAI', '012VS000009VoxrYAC')`.  
> - Activity: `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` (local: `views/vw_sga_activity_performance_v2.sql`). Column names and logic follow the v2 view.  
> - Opportunity: `savvy-gtm-analytics.SavvyGTMData.Opportunity` (raw Salesforce sync).  
> - Task: `savvy-gtm-analytics.SavvyGTMData.Task` (activity records linked to opps via `WhatId`).  
> - User: `savvy-gtm-analytics.SavvyGTMData.User` (for `OwnerId → Name` resolution).

### Activity definition: real outbound SGA touches only (per lead_list_touch_point_exploration_180d.md)

When measuring **activities on Re-Engagement opps** (Phases 5–7), we count only **real outbound SGA effort** — not Lemlist link clicks, opens, or other automated/inbound noise. This follows the **mandatory** methodology in `lead_list_touch_point_exploration_180d.md` (Engagement tracking exclusion; v2 view).

**Excluded from "real activity" counts:**
- **Email (Engagement)** — Lemlist link-click tracking (`[lemlist] Clicked on link...`); these are lead engagement events, not SGA outbound touches.
- **Marketing** — automated activities (e.g. Submitted Form, Savvy Marketing).
- **Other** — miscategorized/junk.

**Combined filter** for all outbound-effort queries (Phases 5.2–5.4, 6, 7 — use `vw_sga_activity_performance` with this filter):

```sql
AND a.activity_channel_group NOT IN ('Marketing', 'Other', 'Email (Engagement)')
AND a.activity_channel_group IS NOT NULL
AND a.direction = 'Outbound'
```

**What counts as real activity:** Email (Campaign) sends, Email (Manual), SMS (outgoing), Calls, LinkedIn. **All** activity totals, leaderboard "worked" counts, zero-activity list, channel mix, recency, and time-to-first-activity in Phases 5.2–7 use this filter so we monitor real SGA touches, not link clicks. **Exception:** Phase 5.1 is a **baseline** (all tasks including link clicks) for comparison only; do not use 5.1 for accountability or "are they working" conclusions.

---

# PHASE 1: Cohort Validation & Census

**Goal**: Confirm the 290 Re-Engagement opportunities created on 2025-12-30 exist in BQ, validate count, and document the creation window.

## 1.1 Validate the 290 Re-Engagement Opportunities

```sql
SELECT
  COUNT(*) AS total_opps,
  MIN(CreatedDate) AS first_created,
  MAX(CreatedDate) AS last_created,
  COUNT(DISTINCT OwnerId) AS distinct_owners,
  COUNT(DISTINCT StageName) AS distinct_stages
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
WHERE IsDeleted = FALSE
  AND RecordTypeId = '012VS000009VoxrYAC'
  AND DATE(CreatedDate) = '2025-12-30';
```

Document:
- Confirm total is **290**
- Creation window (should be ~5 minutes per prior investigation)
- Number of distinct owners (SGAs) and stages present

**Answer:**

| total_opps | first_created | last_created | distinct_owners | distinct_stages |
|------------|---------------|--------------|-----------------|-----------------|
| 290 | 2025-12-30 16:37:44 UTC | 2025-12-30 16:42:05 UTC | 16 | 6 |

**Summary:** Total is **290** Re-Engagement opportunities. Creation window is ~5 minutes (16:37:44–16:42:05 UTC). There are **16** distinct owners (SGAs) and **6** distinct stages present.

---

## 1.2 Confirm These Opps Are Visible in vw_funnel_master

The funnel master includes Re-Engagement opps via `RecordTypeId IN (..., '012VS000009VoxrYAC')`. Verify the 290 appear. The funnel master key for opportunity-level records is `Full_Opportunity_ID__c`.

```sql
SELECT
  COUNT(*) AS funnel_rows
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE v.Full_Opportunity_ID__c IN (
  SELECT Id
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
  WHERE IsDeleted = FALSE
    AND RecordTypeId = '012VS000009VoxrYAC'
    AND DATE(CreatedDate) = '2025-12-30'
);
```

If this returns 0 or a mismatch, try joining on the prospect/contact ID instead:

```sql
-- Fallback: check if re-engagement opps join via ContactId or AccountId
SELECT
  COUNT(DISTINCT o.Id) AS matched_opps
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
INNER JOIN `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
  ON v.Full_prospect_id__c = o.ContactId
WHERE o.IsDeleted = FALSE
  AND o.RecordTypeId = '012VS000009VoxrYAC'
  AND DATE(o.CreatedDate) = '2025-12-30';
```

Document:
- How many of the 290 opps appear in vw_funnel_master?
- Which join key works? (`Full_Opportunity_ID__c`, `ContactId`, or `AccountId`)
- If <290 appear, note the gap — some may not have a matching lead/contact in the funnel view

**Answer:**

| funnel_rows |
|-------------|
| 290 |

**Summary:** All **290** Re-Engagement opps appear in vw_funnel_master. Join key **`Full_Opportunity_ID__c`** works (Option A). No fallback needed. Phase 9 will use this join key.

---

## 1.3 Sample Records — Spot Check

Pull 10 sample records to verify data shape and field population.

```sql
SELECT
  o.Id,
  o.Name,
  o.StageName,
  o.OwnerId,
  COALESCE(o.Opportunity_Owner_Name__c, u.Name) AS owner_name,
  o.CreatedDate,
  o.Created_Recruiting_Opportunity_ID__c,
  o.Closed_Lost_Reason__c,
  o.Stage_Entered_Planned_Nurture__c,
  o.Stage_Entered_Outreach__c,
  o.Stage_Entered_Engaged__c,
  o.Stage_Entered_Call_Scheduled__c,
  o.Stage_Entered_Re_Engaged__c,
  o.Stage_Entered_Closed__c
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.User` u ON u.Id = o.OwnerId
WHERE o.IsDeleted = FALSE
  AND o.RecordTypeId = '012VS000009VoxrYAC'
  AND DATE(o.CreatedDate) = '2025-12-30'
ORDER BY o.Name
LIMIT 10;
```

Document:
- Field population: are StageName, OwnerId, owner_name populated?
- Are any stage-entered dates populated? (Prior investigation showed ~79% have none)
- Any with Created_Recruiting_Opportunity_ID__c set?

**Answer:**

| Name | StageName | owner_name | Stage_Entered_Outreach__c | Stage_Entered_Closed__c | Created_Recruiting_Opportunity_ID__c |
|------|-----------|------------|---------------------------|-------------------------|---------------------------------------|
| [Re-Engagement] Aaron Brachman | Planned Nurture | Perry Kalmeta | null | null | null |
| [Re-Engagement] Aaron Klemow | Closed Lost | Marisa Saucedo | null | 2026-01-22 | null |
| [Re-Engagement] Adam Barringer | Planned Nurture | Russell Armitage | null | null | null |
| [Re-Engagement] Adam Garvey | Planned Nurture | Ryan Crandall | null | null | null |
| [Re-Engagement] Adam Gorham | Planned Nurture | Brian O'Hara | null | null | null |
| [Re-Engagement] Adam Gould | Closed Lost | Lauren George | null | 2026-01-26 | null |
| [Re-Engagement] Alejandro Algaze | Planned Nurture | Eleni Stefanopoulos | null | null | null |
| [Re-Engagement] Alyce Su | Planned Nurture | Brian O'Hara | null | null | null |
| [Re-Engagement] Amanda Janssen | Planned Nurture | Lauren George | null | null | null |
| [Re-Engagement] Amy Kelly | Planned Nurture | Craig Suchodolski | null | null | null |

**Summary:** StageName, OwnerId, and owner_name are populated on all 10. Stage-entered dates are mostly null: only 2 of 10 have Stage_Entered_Closed__c (Aaron Klemow, Adam Gould); none have Stage_Entered_Outreach__c — consistent with ~79% having no stage dates. None of the 10 have Created_Recruiting_Opportunity_ID__c set.

---

# PHASE 2: Re-Engagement Stage Distribution

**Goal**: Understand where every one of the 290 Re-Engagement opps sits in the Re-Engagement funnel. The Re-Engagement stages are: Planned Nurture → Outreach → Engaged → Call Scheduled → Re-Engaged → Closed Lost.

## 2.1 Full StageName Breakdown

```sql
SELECT
  o.StageName,
  COUNT(*) AS opp_count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) AS pct_of_total
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
WHERE o.IsDeleted = FALSE
  AND o.RecordTypeId = '012VS000009VoxrYAC'
  AND DATE(o.CreatedDate) = '2025-12-30'
GROUP BY o.StageName
ORDER BY
  CASE o.StageName
    WHEN 'Planned Nurture' THEN 1
    WHEN 'Outreach' THEN 2
    WHEN 'Engaged' THEN 3
    WHEN 'Call Scheduled' THEN 4
    WHEN 'Re-Engaged' THEN 5
    WHEN 'Closed Lost' THEN 6
    ELSE 7
  END;
```

Document:
- How many are still in **Planned Nurture** (not yet worked)?
- How many have advanced to **Outreach** or beyond (being actively worked)?
- How many are **Closed Lost**?
- How many have reached **Re-Engaged** (fully re-engaged, potential recruiting conversion)?

**Answer:**

| StageName | opp_count | pct_of_total |
|-----------|-----------|---------------|
| Planned Nurture | 209 | 72.1% |
| Outreach | 10 | 3.4% |
| Engaged | 2 | 0.7% |
| Call Scheduled | 1 | 0.3% |
| Re-Engaged | 2 | 0.7% |
| Closed Lost | 66 | 22.8% |

**Summary:** **209** (72.1%) are still in **Planned Nurture** (not yet worked). **15** have advanced to **Outreach** or beyond (10 Outreach + 2 Engaged + 1 Call Scheduled + 2 Re-Engaged). **66** (22.8%) are **Closed Lost**. **2** have reached **Re-Engaged** (fully re-engaged, potential recruiting conversion).

---

## 2.2 Open vs Closed Breakdown

```sql
SELECT
  CASE
    WHEN o.StageName = 'Closed Lost' THEN 'Closed'
    ELSE 'Open'
  END AS status,
  COUNT(*) AS opp_count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) AS pct_of_total
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
WHERE o.IsDeleted = FALSE
  AND o.RecordTypeId = '012VS000009VoxrYAC'
  AND DATE(o.CreatedDate) = '2025-12-30'
GROUP BY 1
ORDER BY 1;
```

Document:
- What **percentage** of the 290 are still **open** (workable)?
- What **percentage** are **closed** (lost)?

**Answer:**

| status | opp_count | pct_of_total |
|--------|-----------|---------------|
| Open | 224 | 77.2% |
| Closed | 66 | 22.8% |

**Summary:** **77.2%** of the 290 are still **open** (workable); **22.8%** are **closed** (lost).

---

## 2.3 Stage Distribution by SGA

Show every SGA with their count in each stage. SGAs with 0 in a stage should show 0.

```sql
SELECT
  COALESCE(o.Opportunity_Owner_Name__c, u.Name, CAST(o.OwnerId AS STRING)) AS sga_name,
  COUNT(*) AS total_assigned,
  SUM(CASE WHEN o.StageName = 'Planned Nurture' THEN 1 ELSE 0 END) AS planned_nurture,
  SUM(CASE WHEN o.StageName = 'Outreach' THEN 1 ELSE 0 END) AS outreach,
  SUM(CASE WHEN o.StageName = 'Engaged' THEN 1 ELSE 0 END) AS engaged,
  SUM(CASE WHEN o.StageName = 'Call Scheduled' THEN 1 ELSE 0 END) AS call_scheduled,
  SUM(CASE WHEN o.StageName = 'Re-Engaged' THEN 1 ELSE 0 END) AS re_engaged,
  SUM(CASE WHEN o.StageName = 'Closed Lost' THEN 1 ELSE 0 END) AS closed_lost,
  SUM(CASE WHEN o.StageName != 'Closed Lost' THEN 1 ELSE 0 END) AS still_open,
  ROUND(
    SAFE_DIVIDE(
      SUM(CASE WHEN o.StageName NOT IN ('Planned Nurture', 'Closed Lost') THEN 1 ELSE 0 END),
      COUNT(*)
    ) * 100, 1
  ) AS pct_actively_working
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.User` u ON u.Id = o.OwnerId
WHERE o.IsDeleted = FALSE
  AND o.RecordTypeId = '012VS000009VoxrYAC'
  AND DATE(o.CreatedDate) = '2025-12-30'
GROUP BY sga_name
ORDER BY total_assigned DESC;
```

Document:
- **Every SGA** with their full stage breakdown
- `pct_actively_working` = % of assigned that have moved past Planned Nurture and are NOT Closed Lost (accountability metric)
- Which SGAs have the most opps still in **Planned Nurture** (not started)?
- Which SGAs have advanced the most to **Outreach+** ?

**Answer:**

| sga_name | total_assigned | planned_nurture | outreach | engaged | call_scheduled | re_engaged | closed_lost | still_open | pct_actively_working |
|----------|----------------|-----------------|----------|---------|----------------|------------|-------------|------------|----------------------|
| Russell Armitage | 25 | 13 | 0 | 0 | 0 | 1 | 11 | 14 | 4.0 |
| Marisa Saucedo | 25 | 2 | 4 | 0 | 0 | 0 | 19 | 6 | 16.0 |
| Amy Waller | 25 | 24 | 0 | 0 | 0 | 0 | 1 | 24 | 0.0 |
| Helen Kamens | 25 | 25 | 0 | 0 | 0 | 0 | 0 | 25 | 0.0 |
| Ryan Crandall | 25 | 25 | 0 | 0 | 0 | 0 | 0 | 25 | 0.0 |
| Eleni Stefanopoulos | 24 | 24 | 0 | 0 | 0 | 0 | 0 | 24 | 0.0 |
| Brian O'Hara | 24 | 23 | 0 | 0 | 0 | 0 | 1 | 23 | 0.0 |
| Craig Suchodolski | 24 | 19 | 0 | 0 | 0 | 0 | 5 | 19 | 0.0 |
| Channing Guyer | 24 | 8 | 0 | 0 | 0 | 0 | 16 | 8 | 0.0 |
| Lauren George | 23 | 19 | 0 | 0 | 0 | 0 | 4 | 19 | 0.0 |
| Perry Kalmeta | 22 | 14 | 0 | 2 | 0 | 0 | 6 | 16 | 9.1 |
| Holly Huffman | 10 | 10 | 0 | 0 | 0 | 0 | 0 | 10 | 0.0 |
| Jason Ainsworth | 10 | 1 | 6 | 0 | 0 | 0 | 3 | 7 | 60.0 |
| Chris Morgan | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 2 | 0.0 |
| Jade Bingham | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 1 | 100.0 |
| Bre McDaniel | 1 | 0 | 0 | 0 | 1 | 0 | 0 | 1 | 100.0 |

**Summary:** Every SGA (16 total) with full stage breakdown. **Helen Kamens** and **Ryan Crandall** have the most still in Planned Nurture (25 each, 100% unworked). **Jason Ainsworth** has the highest pct_actively_working (60% — 6 of 10 in Outreach). **Marisa Saucedo** has 4 in Outreach; **Russell Armitage** has 1 Re-Engaged; **Jade Bingham** has 1 Re-Engaged; **Bre McDaniel** has 1 Call Scheduled.

> ⚠️ **CAVEAT: Stage ≠ Work for this cohort.** `pct_actively_working` (based on StageName) dramatically understates actual effort. Example: **Ryan Crandall** shows 0% actively working here (25 in Planned Nurture) but Phase 6.1 shows **88% worked** (22 opps with real outbound activity, 31 tasks including SMS and LinkedIn). SGAs were working leads without moving stages from Planned Nurture — stage discipline was not enforced during this period. **Use Phase 6.1 (activity-based) as the real accountability metric, not this table's pct_actively_working.**

---

# PHASE 3: Conversion Rates & Funnel Volume

**Goal**: Calculate stage-to-stage conversion rates for the 290 Re-Engagement opps. Map Re-Engagement stages to the standard TOF funnel conversion framework.

**Note:** **Phase 3.4 is the most reliable waterfall** because it defines "contacted" using activity data (well-populated: real outbound tasks) rather than stage-entered dates (sparsely populated: only ~0.1% have Outreach date, 20.9% have Closed date). Phases 3.1 and 3.2 undercount "contacted" for Closed Lost records that were worked but never got stage-entered dates stamped. **Phase 3.4 undercounts MQL/SQL for Closed Lost** due to structurally NULL stage-entered dates (deployed after cohort creation).

### Stage-to-funnel mapping for Re-Engagement opps:

| Re-Engagement Stage | Funnel Equivalent | Meaning |
|---------------------|-------------------|---------|
| Planned Nurture | Prospect | Not yet contacted |
| Outreach | Contacted | SGA has begun outreach |
| Engaged | MQL | Prospect responded / showing interest |
| Call Scheduled | MQL (advanced) | Call booked — strong MQL signal |
| Re-Engaged | SQL / SQO | Fully re-engaged, potential recruiting pipeline |
| Created Recruiting Opp | Converted | Became a Recruiting opportunity |

## 3.1 Full Funnel Waterfall with Conversion Rates

```sql
WITH stage_counts AS (
  SELECT
    COUNT(*) AS total,
    -- Contacted = moved past Planned Nurture at any point (Outreach or beyond, OR Closed Lost after being worked)
    SUM(CASE WHEN o.StageName IN ('Outreach', 'Engaged', 'Call Scheduled', 'Re-Engaged') THEN 1
              WHEN o.StageName = 'Closed Lost' AND o.Stage_Entered_Outreach__c IS NOT NULL THEN 1
              ELSE 0 END) AS contacted,
    -- MQL = reached Engaged or Call Scheduled (or beyond)
    SUM(CASE WHEN o.StageName IN ('Engaged', 'Call Scheduled', 'Re-Engaged') THEN 1
              WHEN o.StageName = 'Closed Lost' AND (o.Stage_Entered_Engaged__c IS NOT NULL OR o.Stage_Entered_Call_Scheduled__c IS NOT NULL) THEN 1
              ELSE 0 END) AS mql,
    -- SQL = reached Re-Engaged
    SUM(CASE WHEN o.StageName = 'Re-Engaged' THEN 1
              WHEN o.StageName = 'Closed Lost' AND o.Stage_Entered_Re_Engaged__c IS NOT NULL THEN 1
              ELSE 0 END) AS sql_stage,
    -- SQO / Converted = created a Recruiting opportunity
    SUM(CASE WHEN o.Created_Recruiting_Opportunity_ID__c IS NOT NULL THEN 1 ELSE 0 END) AS sqo_converted
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
  WHERE o.IsDeleted = FALSE
    AND o.RecordTypeId = '012VS000009VoxrYAC'
    AND DATE(o.CreatedDate) = '2025-12-30'
)
SELECT
  total AS total_opps,
  contacted AS contacted_count,
  ROUND(SAFE_DIVIDE(contacted, total) * 100, 1) AS pct_contacted,
  mql AS mql_count,
  ROUND(SAFE_DIVIDE(mql, contacted) * 100, 1) AS contacted_to_mql_rate,
  sql_stage AS sql_count,
  ROUND(SAFE_DIVIDE(sql_stage, mql) * 100, 1) AS mql_to_sql_rate,
  sqo_converted AS sqo_converted_count,
  ROUND(SAFE_DIVIDE(sqo_converted, sql_stage) * 100, 1) AS sql_to_sqo_rate
FROM stage_counts;
```

Document:
- **Total → Contacted** conversion rate
- **Contacted → MQL** conversion rate
- **MQL → SQL** conversion rate
- **SQL → SQO/Converted** conversion rate
- Volume at each stage

**Answer:**

| total_opps | contacted_count | pct_contacted | mql_count | contacted_to_mql_rate | sql_count | mql_to_sql_rate | sqo_converted_count | sql_to_sqo_rate |
|------------|-----------------|---------------|-----------|------------------------|-----------|-----------------|---------------------|-----------------|
| 290 | 16 | 5.5% | 5 | 31.3% | 2 | 40.0% | 0 | 0.0% |

**Summary:** Stage-entered-date-based waterfall: **16** contacted (5.5%), **5** MQL (31.3% of contacted), **2** SQL (40% MQL→SQL), **0** converted to Recruiting. Contacted is undercounted because only 1 opp has Stage_Entered_Outreach__c; Phase 3.4 (activity-based) is more reliable.

---

## 3.2 Funnel Waterfall — Simplified (Current StageName Only)

Because stage-entered dates are sparsely populated (~79% have none), let's also compute conversion using **current StageName** only as a simpler proxy. A record in "Outreach" was at minimum contacted; a record in "Re-Engaged" passed through all prior stages.

```sql
WITH stage_ordered AS (
  SELECT
    o.StageName,
    COUNT(*) AS opp_count,
    CASE o.StageName
      WHEN 'Planned Nurture' THEN 1
      WHEN 'Outreach' THEN 2
      WHEN 'Engaged' THEN 3
      WHEN 'Call Scheduled' THEN 4
      WHEN 'Re-Engaged' THEN 5
      WHEN 'Closed Lost' THEN 0  -- treat separately
    END AS stage_rank
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
  WHERE o.IsDeleted = FALSE
    AND o.RecordTypeId = '012VS000009VoxrYAC'
    AND DATE(o.CreatedDate) = '2025-12-30'
  GROUP BY o.StageName
)
SELECT
  StageName,
  opp_count,
  ROUND(opp_count * 100.0 / SUM(opp_count) OVER(), 1) AS pct_of_total
FROM stage_ordered
ORDER BY
  CASE StageName
    WHEN 'Planned Nurture' THEN 1
    WHEN 'Outreach' THEN 2
    WHEN 'Engaged' THEN 3
    WHEN 'Call Scheduled' THEN 4
    WHEN 'Re-Engaged' THEN 5
    WHEN 'Closed Lost' THEN 6
  END;
```

Then compute cumulative "at or above" each stage:

```sql
WITH base AS (
  SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN StageName NOT IN ('Planned Nurture', 'Closed Lost') THEN 1 ELSE 0 END) AS at_or_above_outreach,
    SUM(CASE WHEN StageName IN ('Engaged', 'Call Scheduled', 'Re-Engaged') THEN 1 ELSE 0 END) AS at_or_above_engaged,
    SUM(CASE WHEN StageName IN ('Call Scheduled', 'Re-Engaged') THEN 1 ELSE 0 END) AS at_or_above_call_scheduled,
    SUM(CASE WHEN StageName = 'Re-Engaged' THEN 1 ELSE 0 END) AS at_re_engaged,
    SUM(CASE WHEN Created_Recruiting_Opportunity_ID__c IS NOT NULL THEN 1 ELSE 0 END) AS converted_to_recruiting
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
  WHERE IsDeleted = FALSE
    AND RecordTypeId = '012VS000009VoxrYAC'
    AND DATE(CreatedDate) = '2025-12-30'
)
SELECT
  total,
  at_or_above_outreach AS contacted_equiv,
  ROUND(SAFE_DIVIDE(at_or_above_outreach, total) * 100, 1) AS pct_contacted,
  at_or_above_engaged AS mql_equiv,
  ROUND(SAFE_DIVIDE(at_or_above_engaged, at_or_above_outreach) * 100, 1) AS contacted_to_mql_pct,
  at_or_above_call_scheduled AS sql_equiv,
  ROUND(SAFE_DIVIDE(at_or_above_call_scheduled, at_or_above_engaged) * 100, 1) AS mql_to_sql_pct,
  at_re_engaged AS sqo_equiv,
  ROUND(SAFE_DIVIDE(at_re_engaged, at_or_above_call_scheduled) * 100, 1) AS sql_to_sqo_pct,
  converted_to_recruiting,
  ROUND(SAFE_DIVIDE(converted_to_recruiting, at_re_engaged) * 100, 1) AS re_engaged_to_recruiting_pct
FROM base;
```

Document:
- Simplified waterfall using current stage only (no dependency on sparse stage-entered dates)
- Volume and rate at each transition
- **Note**: This is a lower bound — some records may have passed through a stage and regressed (e.g., moved to Outreach then Closed Lost). Phase 3.1 uses stage-entered dates to capture those; this query captures current state only.

**Answer:**

| total | contacted_equiv | pct_contacted | mql_equiv | contacted_to_mql_pct | sql_equiv | mql_to_sql_pct | sqo_equiv | sql_to_sqo_pct | converted_to_recruiting | re_engaged_to_recruiting_pct |
|-------|-----------------|---------------|-----------|----------------------|-----------|----------------|-----------|----------------|-------------------------|------------------------------|
| 290 | 15 | 5.2% | 5 | 33.3% | 3 | 60.0% | 2 | 66.7% | 0 | 0.0% |

**Summary:** Simplified (current StageName only): **15** contacted (5.2%), **5** MQL (33.3% contacted→MQL), **3** SQL (60% MQL→SQL), **2** at Re-Engaged (66.7% SQL→SQO), **0** converted to Recruiting. Same undercount on contacted; Phase 3.4 uses activity for reliable contacted count.

---

## 3.3 Conversion Rates by SGA

```sql
SELECT
  COALESCE(o.Opportunity_Owner_Name__c, u.Name, CAST(o.OwnerId AS STRING)) AS sga_name,
  COUNT(*) AS total_assigned,
  -- Contacted: currently at Outreach+ (excluding Closed Lost unless they have an outreach date)
  SUM(CASE WHEN o.StageName NOT IN ('Planned Nurture', 'Closed Lost') THEN 1 ELSE 0 END) AS contacted,
  ROUND(SAFE_DIVIDE(
    SUM(CASE WHEN o.StageName NOT IN ('Planned Nurture', 'Closed Lost') THEN 1 ELSE 0 END),
    COUNT(*)
  ) * 100, 1) AS pct_contacted,
  -- MQL: Engaged, Call Scheduled, Re-Engaged
  SUM(CASE WHEN o.StageName IN ('Engaged', 'Call Scheduled', 'Re-Engaged') THEN 1 ELSE 0 END) AS mql,
  -- SQL: Call Scheduled, Re-Engaged
  SUM(CASE WHEN o.StageName IN ('Call Scheduled', 'Re-Engaged') THEN 1 ELSE 0 END) AS sql_stage,
  -- SQO: Re-Engaged
  SUM(CASE WHEN o.StageName = 'Re-Engaged' THEN 1 ELSE 0 END) AS sqo,
  -- Converted to Recruiting
  SUM(CASE WHEN o.Created_Recruiting_Opportunity_ID__c IS NOT NULL THEN 1 ELSE 0 END) AS converted_to_recruiting,
  -- Closed Lost
  SUM(CASE WHEN o.StageName = 'Closed Lost' THEN 1 ELSE 0 END) AS closed_lost
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.User` u ON u.Id = o.OwnerId
WHERE o.IsDeleted = FALSE
  AND o.RecordTypeId = '012VS000009VoxrYAC'
  AND DATE(o.CreatedDate) = '2025-12-30'
GROUP BY sga_name
ORDER BY total_assigned DESC;
```

Document:
- SGA-level conversion rates across the funnel
- Who is advancing leads the furthest?
- Who has the most Closed Lost vs. still open?

**Answer:**

| sga_name | total_assigned | contacted | pct_contacted | mql | sql_stage | sqo | converted_to_recruiting | closed_lost |
|----------|----------------|-----------|---------------|-----|-----------|-----|-------------------------|-------------|
| Russell Armitage | 25 | 1 | 4.0% | 1 | 1 | 1 | 0 | 11 |
| Marisa Saucedo | 25 | 4 | 16.0% | 0 | 0 | 0 | 0 | 19 |
| Amy Waller | 25 | 0 | 0.0% | 0 | 0 | 0 | 0 | 1 |
| Helen Kamens | 25 | 0 | 0.0% | 0 | 0 | 0 | 0 | 0 |
| Ryan Crandall | 25 | 0 | 0.0% | 0 | 0 | 0 | 0 | 0 |
| Eleni Stefanopoulos | 24 | 0 | 0.0% | 0 | 0 | 0 | 0 | 0 |
| Brian O'Hara | 24 | 0 | 0.0% | 0 | 0 | 0 | 0 | 1 |
| Craig Suchodolski | 24 | 0 | 0.0% | 0 | 0 | 0 | 0 | 5 |
| Channing Guyer | 24 | 0 | 0.0% | 0 | 0 | 0 | 0 | 16 |
| Lauren George | 23 | 0 | 0.0% | 0 | 0 | 0 | 0 | 4 |
| Perry Kalmeta | 22 | 2 | 9.1% | 2 | 0 | 0 | 0 | 6 |
| Holly Huffman | 10 | 0 | 0.0% | 0 | 0 | 0 | 0 | 0 |
| Jason Ainsworth | 10 | 6 | 60.0% | 0 | 0 | 0 | 0 | 3 |
| Chris Morgan | 2 | 0 | 0.0% | 0 | 0 | 0 | 0 | 0 |
| Jade Bingham | 1 | 1 | 100.0% | 1 | 1 | 1 | 0 | 0 |
| Bre McDaniel | 1 | 1 | 100.0% | 1 | 1 | 0 | 0 | 0 |

**Summary:** **Jade Bingham** and **Bre McDaniel** have the only Re-Engaged/SQL-stage opps (Jade 1 Re-Engaged, Bre 1 Call Scheduled). **Jason Ainsworth** has highest pct_contacted (60%, 6 of 10). **Marisa Saucedo** has most Closed Lost (19); **Channing Guyer** next (16).

---

## 3.4 Funnel Waterfall — Activity-Based (Most Reliable)

"Contacted" = opp has ≥1 real outbound activity (regardless of stage-entered dates or current StageName). This avoids undercounting Closed Lost records that were worked but have no stage-entered dates.

```sql
WITH dec30_opps AS (
  SELECT
    o.Id AS opp_id,
    o.StageName,
    o.Stage_Entered_Engaged__c,
    o.Stage_Entered_Call_Scheduled__c,
    o.Stage_Entered_Re_Engaged__c,
    o.Created_Recruiting_Opportunity_ID__c
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
  WHERE o.IsDeleted = FALSE
    AND o.RecordTypeId = '012VS000009VoxrYAC'
    AND DATE(o.CreatedDate) = '2025-12-30'
),
contacted_flag AS (
  SELECT
    d.opp_id,
    d.StageName,
    d.Stage_Entered_Engaged__c,
    d.Stage_Entered_Call_Scheduled__c,
    d.Stage_Entered_Re_Engaged__c,
    d.Created_Recruiting_Opportunity_ID__c,
    CASE WHEN a.task_what_id IS NOT NULL THEN 1 ELSE 0 END AS has_real_outbound
  FROM dec30_opps d
  LEFT JOIN (
    SELECT DISTINCT task_what_id
    FROM `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` a
    WHERE a.activity_channel_group NOT IN ('Marketing', 'Other', 'Email (Engagement)')
      AND a.activity_channel_group IS NOT NULL
      AND a.direction = 'Outbound'
  ) a ON a.task_what_id = d.opp_id
),
stage_counts AS (
  SELECT
    COUNT(*) AS total,
    SUM(has_real_outbound) AS contacted,
    SUM(CASE WHEN has_real_outbound = 1 AND (
      StageName IN ('Engaged', 'Call Scheduled', 'Re-Engaged')
      OR (StageName = 'Closed Lost' AND (Stage_Entered_Engaged__c IS NOT NULL OR Stage_Entered_Call_Scheduled__c IS NOT NULL))
    ) THEN 1 ELSE 0 END) AS mql,
    SUM(CASE WHEN has_real_outbound = 1 AND (
      StageName = 'Re-Engaged'
      OR (StageName = 'Closed Lost' AND Stage_Entered_Re_Engaged__c IS NOT NULL)
    ) THEN 1 ELSE 0 END) AS sql_stage,
    SUM(CASE WHEN Created_Recruiting_Opportunity_ID__c IS NOT NULL THEN 1 ELSE 0 END) AS sqo_converted
  FROM contacted_flag
)
SELECT
  total AS total_opps,
  contacted AS contacted_count,
  ROUND(SAFE_DIVIDE(contacted, total) * 100, 1) AS pct_contacted,
  mql AS mql_count,
  ROUND(SAFE_DIVIDE(mql, contacted) * 100, 1) AS contacted_to_mql_rate,
  sql_stage AS sql_count,
  ROUND(SAFE_DIVIDE(sql_stage, mql) * 100, 1) AS mql_to_sql_rate,
  sqo_converted AS sqo_converted_count,
  ROUND(SAFE_DIVIDE(sqo_converted, sql_stage) * 100, 1) AS sql_to_sqo_rate
FROM stage_counts;
```

Document:
- **Contacted** = count with ≥1 real outbound activity (join to activity view with filter).
- **MQL** = contacted and (current StageName in Engaged/Call Scheduled/Re-Engaged, or Closed Lost with engaged/call_scheduled date).
- **SQL** = contacted and (Re-Engaged or Closed Lost with re_engaged date).
- **SQO/Converted** = Created_Recruiting_Opportunity_ID__c set.
- Compare rates to Phase 3.1/3.2; 3.4 should show higher contacted count.

**Answer:**

| total_opps | contacted_count | pct_contacted | mql_count | contacted_to_mql_rate | sql_count | mql_to_sql_rate | sqo_converted_count | sql_to_sqo_rate |
|------------|-----------------|---------------|-----------|------------------------|-----------|-----------------|---------------------|-----------------|
| 290 | 90 | 31.0% | 2 | 2.2% | 0 | 0.0% | 0 | — |

**Summary:** **Phase 3.4 is the most reliable waterfall.** Contacted = **90** (31.0%) — opps with ≥1 real outbound activity — vs **16** (3.1) and **15** (3.2). So **74–75** additional "contacted" opps are captured by activity (worked but no stage-entered dates). MQL=2, SQL=0, SQO converted=0. Use 3.4 for contacted volume; downstream rates (contacted→MQL, etc.) are low.

> ⚠️ **CAVEAT: MQL and SQL are structural undercounts (field timing).** Stage-entered date fields (`Stage_Entered_Engaged__c`, `Stage_Entered_Re_Engaged__c`) were deployed after these 290 opps were created. They are structurally NULL for any opp that transitioned through Engaged/Call Scheduled/Re-Engaged before deployment. The 15 Closed Lost with real outbound activity may include opps that reached Engaged or beyond before closure, but with no date stamp, they count as "contacted but not MQL." **MQL=2 and SQL=0 are floors, not true rates.** The actual MQL/SQL counts are unknowable for this cohort's Closed Lost records.

---

### Verification (added by Cursor)

**Issue:** Phase 3.1/3.2 undercount "contacted" for Closed Lost — stage-entered dates are sparse; activity data is more reliable.

**Verification query (stage date sparsity for Dec 30 cohort):**
```sql
SELECT
  COUNT(*) AS total,
  SUM(CASE WHEN Stage_Entered_Outreach__c IS NOT NULL THEN 1 ELSE 0 END) AS has_outreach_date,
  SUM(CASE WHEN Stage_Entered_Engaged__c IS NOT NULL THEN 1 ELSE 0 END) AS has_engaged_date,
  SUM(CASE WHEN Stage_Entered_Call_Scheduled__c IS NOT NULL THEN 1 ELSE 0 END) AS has_call_sched_date,
  SUM(CASE WHEN Stage_Entered_Re_Engaged__c IS NOT NULL THEN 1 ELSE 0 END) AS has_re_engaged_date,
  SUM(CASE WHEN Stage_Entered_Closed__c IS NOT NULL THEN 1 ELSE 0 END) AS has_closed_date
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
WHERE IsDeleted = FALSE
  AND RecordTypeId = '012VS000009VoxrYAC'
  AND DATE(CreatedDate) = '2025-12-30';
```

**Result:** total=290, has_outreach_date=1, has_engaged_date=0, has_call_sched_date=0, has_re_engaged_date=0, has_closed_date=69. Stage-entered dates are very sparse.

**Verification query (Closed Lost with real outbound activity):**
```sql
WITH dec30_closed AS (
  SELECT Id AS opp_id
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
  WHERE IsDeleted = FALSE
    AND RecordTypeId = '012VS000009VoxrYAC'
    AND DATE(CreatedDate) = '2025-12-30'
    AND StageName = 'Closed Lost'
)
SELECT
  COUNT(DISTINCT d.opp_id) AS closed_lost_with_real_activity,
  (SELECT COUNT(*) FROM dec30_closed) AS total_closed_lost
FROM dec30_closed d
INNER JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` a
  ON a.task_what_id = d.opp_id
WHERE a.activity_channel_group NOT IN ('Marketing', 'Other', 'Email (Engagement)')
  AND a.activity_channel_group IS NOT NULL
  AND a.direction = 'Outbound';
```

**Result:** closed_lost_with_real_activity=15, total_closed_lost=66. So 15 Closed Lost opps were worked (real outbound) but would be missed as "contacted" in 3.1 (only 1 has outreach date).

**Action taken:** Added Phase 3.4 with activity-based "contacted" (≥1 real outbound task). Phase 3 intro updated to state 3.4 is most reliable; 3.1/3.2 retained for reference.

---

# PHASE 4: Closed Lost Analysis

**Goal**: For the Re-Engagement opps that are Closed Lost — why? What are the disposition reasons, and who closed them?

## 4.1 Closed Lost Count and Reason Breakdown

```sql
SELECT
  COALESCE(o.Closed_Lost_Reason__c, 'No Reason Set') AS closed_lost_reason,
  COUNT(*) AS closed_count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) AS pct_of_closed
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
WHERE o.IsDeleted = FALSE
  AND o.RecordTypeId = '012VS000009VoxrYAC'
  AND DATE(o.CreatedDate) = '2025-12-30'
  AND o.StageName = 'Closed Lost'
GROUP BY closed_lost_reason
ORDER BY closed_count DESC;
```

Document:
- Total Closed Lost count and % of 290
- **Top reasons** — are we losing to "No Response", "Not Interested", or something else?
- How many have **"No Reason Set"** — data hygiene issue?

**Answer:**

| closed_lost_reason | closed_count | pct_of_closed |
|--------------------|--------------|---------------|
| Other | 29 | 43.9% |
| No Reason Set | 15 | 22.7% |
| Savvy Declined - Poor Culture Fit | 7 | 10.6% |
| Savvy Declined – Book Not Transferable | 5 | 7.6% |
| Candidate Declined - Lost to Competitor | 3 | 4.5% |
| No Longer Responsive | 2 | 3.0% |
| Candidate Declined - Timing | 2 | 3.0% |
| Savvy Declined - Compliance | 1 | 1.5% |
| Savvy Declined - Insufficient Revenue | 1 | 1.5% |
| Candidate Declined - Fear of Change | 1 | 1.5% |

**Summary:** **66** Closed Lost (22.8% of 290). Top reason: **Other** (29, 43.9%), then **No Reason Set** (15, 22.7%) — data hygiene issue. **Savvy Declined - Poor Culture Fit** (7), **Book Not Transferable** (5), **Lost to Competitor** (3) follow.

---

## 4.2 Closed Lost Details (Free-Text)

```sql
SELECT
  COALESCE(o.Opportunity_Owner_Name__c, u.Name) AS sga_name,
  o.Name AS opp_name,
  o.Closed_Lost_Reason__c,
  o.Closed_Lost_Details__c,
  DATE(o.Stage_Entered_Closed__c) AS closed_date
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.User` u ON u.Id = o.OwnerId
WHERE o.IsDeleted = FALSE
  AND o.RecordTypeId = '012VS000009VoxrYAC'
  AND DATE(o.CreatedDate) = '2025-12-30'
  AND o.StageName = 'Closed Lost'
  AND o.Closed_Lost_Details__c IS NOT NULL
  AND TRIM(o.Closed_Lost_Details__c) != ''
ORDER BY o.Stage_Entered_Closed__c DESC
LIMIT 25;
```

Document:
- Free-text details on why leads were closed — look for patterns
- Which SGAs are writing detailed notes vs. leaving blank?

**Answer:**

**25** Closed Lost opps have free-text Closed_Lost_Details__c. Sample (most recent): Martin Chanzit (Retired Nov 2025), Matthew Lengel (Lost to SummitPoint), Thor Gould (Not an advisor — management seat), Phillip Clark (worked with Corey, couldn't get there), Tanya Escobedo (Not even an advisor), Cary Rothman (Just moved), Jeremy Stafford (Edward Jones), Eric Hom (Belongs to Schwab), Dan Pease (Fishing call), Charles Mattiucci (Moved 6 mos ago). **Marisa Saucedo**, **Craig Suchodolski**, **Lauren George**, **Perry Kalmeta**, **Jason Ainsworth** have the most detailed notes; others leave details blank (contributing to "No Reason Set").

---

## 4.3 Closed Lost by SGA with Reason Breakdown

```sql
SELECT
  COALESCE(o.Opportunity_Owner_Name__c, u.Name, CAST(o.OwnerId AS STRING)) AS sga_name,
  COALESCE(o.Closed_Lost_Reason__c, 'No Reason Set') AS closed_lost_reason,
  COUNT(*) AS closed_count
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.User` u ON u.Id = o.OwnerId
WHERE o.IsDeleted = FALSE
  AND o.RecordTypeId = '012VS000009VoxrYAC'
  AND DATE(o.CreatedDate) = '2025-12-30'
  AND o.StageName = 'Closed Lost'
GROUP BY sga_name, closed_lost_reason
ORDER BY sga_name, closed_count DESC;
```

Document:
- Which SGAs are closing the most leads and why?
- Are there SGAs closing with weak dispositions (e.g., "No Reason Set")?
- Are certain SGAs disproportionately closing to a specific reason?

**Answer:**

| sga_name | closed_lost_reason | closed_count |
|----------|--------------------|--------------|
| Channing Guyer | Other | 16 |
| Russell Armitage | No Reason Set | 10 |
| Marisa Saucedo | Savvy Declined - Poor Culture Fit | 6 |
| Marisa Saucedo | Other | 5 |
| Marisa Saucedo | Savvy Declined – Book Not Transferable | 3 |
| Marisa Saucedo | No Longer Responsive | 2 |
| Marisa Saucedo | Candidate Declined - Timing | 1 |
| Marisa Saucedo | Savvy Declined - Insufficient Revenue | 1 |
| Marisa Saucedo | No Reason Set | 1 |
| Craig Suchodolski | Candidate Declined - Lost to Competitor | 2 |
| Craig Suchodolski | Savvy Declined – Book Not Transferable | 1 |
| Craig Suchodolski | Candidate Declined - Fear of Change | 1 |
| Craig Suchodolski | No Reason Set | 1 |
| Perry Kalmeta | Other | 2 |
| Perry Kalmeta | Candidate Declined - Timing | 1 |
| Perry Kalmeta | Savvy Declined - Compliance | 1 |
| Perry Kalmeta | Savvy Declined – Book Not Transferable | 1 |
| Perry Kalmeta | Savvy Declined - Poor Culture Fit | 1 |
| Lauren George | Other | 2 |
| Lauren George | No Reason Set | 2 |
| Jason Ainsworth | Other | 2 |
| Jason Ainsworth | Candidate Declined - Lost to Competitor | 1 |
| Amy Waller | Other | 1 |
| Brian O'Hara | No Reason Set | 1 |
| Russell Armitage | Other | 1 |

**Summary:** **Channing Guyer** (16 Other), **Russell Armitage** (10 No Reason Set — weak disposition), **Marisa Saucedo** (19 total, mix of reasons including Poor Culture Fit, Book Not Transferable). Russell has the most "No Reason Set"; Channing has the most "Other."

---

## 4.4 Closed Lost Timing — When Were They Closed?

```sql
SELECT
  DATE(o.Stage_Entered_Closed__c) AS closed_date,
  COUNT(*) AS closed_count
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
WHERE o.IsDeleted = FALSE
  AND o.RecordTypeId = '012VS000009VoxrYAC'
  AND DATE(o.CreatedDate) = '2025-12-30'
  AND o.StageName = 'Closed Lost'
  AND o.Stage_Entered_Closed__c IS NOT NULL
GROUP BY closed_date
ORDER BY closed_date;
```

Also check how many Closed Lost have NO closed date:

```sql
SELECT
  SUM(CASE WHEN o.Stage_Entered_Closed__c IS NOT NULL THEN 1 ELSE 0 END) AS with_closed_date,
  SUM(CASE WHEN o.Stage_Entered_Closed__c IS NULL THEN 1 ELSE 0 END) AS no_closed_date,
  COUNT(*) AS total_closed_lost
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
WHERE o.IsDeleted = FALSE
  AND o.RecordTypeId = '012VS000009VoxrYAC'
  AND DATE(o.CreatedDate) = '2025-12-30'
  AND o.StageName = 'Closed Lost';
```

Document:
- When were these opps closed? Same day? Weeks later?
- Are closures front-loaded (SGAs quickly triaging) or spread out (working then closing)?
- How many Closed Lost records are missing the closed date?

**Answer:**

**Closed by date:** 2026-01-13 (1), 2026-01-21 (6), 2026-01-22 (12), 2026-01-26 (3), 2026-01-27 (2), 2026-01-28 (9), 2026-01-29 (4), 2026-02-09 (28), 2026-02-10 (1). **Total Closed Lost: 66.** **With closed date: 66; no closed date: 0.** Closures are spread out (Jan 13–Feb 10); **28** closed on 2026-02-09 (bulk day). Not same-day — SGAs worked then closed over several weeks.

---

# PHASE 5: Activity Analysis — Are These Leads Being Worked?

**Goal**: The #1 question — are SGAs actually working these 290 re-engagement opps? How many tasks/activities exist on them?

## 5.1 Total Activity Count on the 290 Opps (Baseline — All Tasks)

Activities are linked to opportunities via `Task.WhatId`. This query counts **all** tasks (including link clicks, marketing, other). Use only as a **baseline** for comparison. For "are they working" and accountability, use **real outbound** from 5.2 and Phases 6–7 (per `lead_list_touch_point_exploration_180d.md`).

```sql
WITH dec30_opps AS (
  SELECT Id AS opp_id
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
  WHERE IsDeleted = FALSE
    AND RecordTypeId = '012VS000009VoxrYAC'
    AND DATE(CreatedDate) = '2025-12-30'
),
opp_tasks AS (
  SELECT
    d.opp_id,
    COUNT(t.Id) AS task_count
  FROM dec30_opps d
  LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.Task` t
    ON t.WhatId = d.opp_id AND t.IsDeleted = FALSE
  GROUP BY d.opp_id
)
SELECT
  COUNT(*) AS total_opps,
  SUM(CASE WHEN task_count > 0 THEN 1 ELSE 0 END) AS opps_with_activity,
  ROUND(SUM(CASE WHEN task_count > 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS pct_with_activity,
  SUM(CASE WHEN task_count = 0 THEN 1 ELSE 0 END) AS opps_with_zero_activity,
  SUM(task_count) AS total_tasks,
  ROUND(AVG(task_count), 1) AS avg_tasks_per_opp,
  ROUND(SAFE_DIVIDE(SUM(task_count), SUM(CASE WHEN task_count > 0 THEN 1 ELSE 0 END)), 1) AS avg_tasks_per_worked_opp
FROM opp_tasks;
```

Document:
- How many of the 290 opps have **at least one task**?
- How many have **zero tasks** (never touched)?
- Average tasks per opp overall vs. per worked opp

**Answer:**

| total_opps | opps_with_activity | pct_with_activity | opps_with_zero_activity | total_tasks | avg_tasks_per_opp | avg_tasks_per_worked_opp |
|------------|--------------------|-------------------|--------------------------|-------------|-------------------|---------------------------|
| 290 | 90 | 31.0% | 200 | 200 | 0.7 | 2.2 |

**Summary:** **90** of 290 (31.0%) have at least one task; **200** have zero tasks (never touched). **200** total tasks (all types); 0.7 avg per opp overall, 2.2 avg per worked opp. Baseline only — includes link clicks; use 5.2 for real SGA effort.

---

## 5.2 Real Outbound Activity (vw_sga_activity_performance)

For **real outbound SGA touches only**, use the activity view with the filter from the header: `activity_channel_group NOT IN ('Marketing', 'Other', 'Email (Engagement)')`, `activity_channel_group IS NOT NULL`, and `direction = 'Outbound'`. The view joins Task to vw_funnel_master on `WhoId = Full_prospect_id__c OR WhatId = Full_Opportunity_ID__c`; Re-Engagement opps appear in the funnel via `Full_Opportunity_ID__c`, so activities on the 290 opps are included when `WhatId` matches. Run this **after** Phase 1.2 confirms the 290 appear in vw_funnel_master (join on `Full_Opportunity_ID__c`).

```sql
WITH dec30_opp_ids AS (
  SELECT Id AS opp_id
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
  WHERE IsDeleted = FALSE
    AND RecordTypeId = '012VS000009VoxrYAC'
    AND DATE(CreatedDate) = '2025-12-30'
),
activity_real_outbound AS (
  SELECT
    a.task_what_id AS opp_id,
    a.task_id
  FROM `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` a
  INNER JOIN dec30_opp_ids d ON d.opp_id = a.task_what_id
  WHERE a.activity_channel_group NOT IN ('Marketing', 'Other', 'Email (Engagement)')
    AND a.activity_channel_group IS NOT NULL
    AND a.direction = 'Outbound'
)
SELECT
  (SELECT COUNT(*) FROM dec30_opp_ids) AS total_opps,
  COUNT(DISTINCT opp_id) AS opps_with_real_outbound_activity,
  ROUND(COUNT(DISTINCT opp_id) * 100.0 / (SELECT COUNT(*) FROM dec30_opp_ids), 1) AS pct_with_real_outbound,
  COUNT(*) AS total_real_outbound_tasks,
  ROUND(SAFE_DIVIDE(COUNT(*), COUNT(DISTINCT opp_id)), 1) AS avg_real_outbound_per_worked_opp
FROM activity_real_outbound;
```

If the activity view uses different output column names (e.g. `task_what_id` vs `WhatId`), adjust the join to match the view. Local view definition: `views/vw_sga_activity_performance_v2.sql`; the view exposes `task_what_id` (from `WhatId`), `activity_channel_group`, and `direction`.

Document:
- How many of the 290 have at least one **real outbound** activity (per view filter)?
- Total real outbound tasks and average per worked opp
- If the query returns 0, confirm Phase 1.2: the 290 must appear in vw_funnel_master for the activity view to include their tasks

**Answer:**

| total_opps | opps_with_real_outbound_activity | pct_with_real_outbound | total_real_outbound_tasks | avg_real_outbound_per_worked_opp |
|------------|----------------------------------|------------------------|---------------------------|----------------------------------|
| 290 | 90 | 31.0% | 159 | 1.8 |

**Summary:** **90** of 290 (31.0%) have at least one **real outbound** activity; **159** total real outbound tasks; **1.8** avg per worked opp. **Difference vs 5.1 (baseline):** 5.1 has 200 total tasks vs 5.2 has 159 real outbound — **41 tasks** (20.5%) are link clicks / marketing / other noise, not real SGA effort.

---

### Verification (added by Cursor)

**Issue:** Join key for activity view to Dec 30 opps — confirm column name and that join returns activity for the 290 opps.

**Verification query:**
```sql
WITH dec30_opp_ids AS (
  SELECT Id AS opp_id
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
  WHERE IsDeleted = FALSE
    AND RecordTypeId = '012VS000009VoxrYAC'
    AND DATE(CreatedDate) = '2025-12-30'
)
SELECT
  COUNT(DISTINCT d.opp_id) AS opps_with_activity,
  COUNT(*) AS total_activity_rows
FROM dec30_opp_ids d
INNER JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` a
  ON a.task_what_id = d.opp_id
WHERE a.activity_channel_group NOT IN ('Marketing', 'Other', 'Email (Engagement)')
  AND a.activity_channel_group IS NOT NULL
  AND a.direction = 'Outbound';
```

**Result:** opps_with_activity = 90, total_activity_rows = 159. Join key `a.task_what_id = d.opp_id` is correct; view exposes `task_what_id` (from Task.WhatId).

**Action taken:** No change to join key. All activity queries in Phases 5.2–5.4, 6, 7 use `a.task_what_id = d.opp_id` (or equivalent). Date column for grouping/recency set in Phase 5.4 Verification.

---

## 5.3 Activity Breakdown by Channel (Real Outbound Only)

Use `vw_sga_activity_performance` with the real-outbound filter so channel mix reflects **real SGA touches**, not link clicks (per `lead_list_touch_point_exploration_180d.md`).

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

Document:
- Channel mix: Calls, SMS, Email, LinkedIn, etc. (real outbound only — no link clicks).
- Are SGAs multi-channel or relying on a single channel?

**Answer:**

| channel | task_count | opps_touched | pct_of_total |
|---------|------------|--------------|---------------|
| SMS | 109 | 68 | 68.6 |
| LinkedIn | 26 | 24 | 16.4 |
| Call | 24 | 15 | 15.1 |

**Summary:** For Dec 30 cohort real outbound, **159 total tasks** across **SMS** (109, 68.6%), **LinkedIn** (26, 16.4%), and **Call** (24, 15.1%). SGAs are multi-channel; SMS dominates, with LinkedIn and Call also used. Phase 5.3 re-run on 2025-02-10 to correct prior result that showed only Call; Phase 6.3 confirms multi-channel activity.

---

## 5.4 Activity Timeline — When Are Real Outbound Tasks Happening?

Use the activity view with the real-outbound filter so the timeline reflects **real SGA touches**, not link clicks (per `lead_list_touch_point_exploration_180d.md`).

```sql
WITH dec30_opp_ids AS (
  SELECT Id AS opp_id
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
  WHERE IsDeleted = FALSE
    AND RecordTypeId = '012VS000009VoxrYAC'
    AND DATE(CreatedDate) = '2025-12-30'
)
SELECT
  a.task_activity_date AS activity_date,
  COUNT(*) AS task_count,
  COUNT(DISTINCT a.task_what_id) AS opps_touched
FROM `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` a
INNER JOIN dec30_opp_ids d ON d.opp_id = a.task_what_id
WHERE a.activity_channel_group NOT IN ('Marketing', 'Other', 'Email (Engagement)')
  AND a.activity_channel_group IS NOT NULL
  AND a.direction = 'Outbound'
GROUP BY a.task_activity_date
ORDER BY activity_date;
```

Document:
- Real outbound activity distribution from 2025-12-30 through present (no link clicks).
- Are activities steady or concentrated in bursts?
- Any days with zero real activity (work stoppage)?
- Recent activity trend — is momentum increasing or dying off?

**Answer:**

| activity_date | task_count | opps_touched |
|---------------|------------|--------------|
| 2026-01-12 | 2 | 1 |
| 2026-01-13 | 3 | 2 |
| 2026-01-19 | 1 | 1 |
| 2026-01-21 | 20 | 17 |
| 2026-01-22 | 7 | 4 |
| 2026-01-23 | 13 | 11 |
| 2026-01-26 | 12 | 6 |
| 2026-01-27 | 44 | 41 |
| 2026-01-28 | 4 | 3 |
| 2026-01-29 | 2 | 2 |
| 2026-01-30 | 11 | 2 |
| 2026-02-07 | 1 | 1 |
| 2026-02-08 | 2 | 2 |
| 2026-02-09 | 34 | 24 |
| 2026-02-10 | 3 | 1 |

**Summary:** Real outbound activity is **concentrated in bursts**: 2026-01-27 (44 tasks, 41 opps), 2026-02-09 (34 tasks, 24 opps), 2026-01-21 (20 tasks, 17 opps). Many days have zero or low activity (e.g. Jan 14–18, Jan 24–25, Jan 31–Feb 6). Recent activity (Feb 7–10) is low — momentum has tapered.

---

### Verification (added by Cursor)

**Issue:** Date column name for activity view — use correct column for date-level grouping and recency (GROUP BY date, DATE_DIFF).

**Verification query:**
```sql
SELECT * FROM `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` LIMIT 1;
```

**Result:** View exposes both `task_created_date` (DATE, UTC) and `task_activity_date` (DATE, Eastern). Per January doc appendix and cursor-prompt: use `task_activity_date` for date-level grouping and recency so reporting is consistent with Eastern date.

**Action taken:** Replaced every `a.task_created_date` with `a.task_activity_date` in Phase 5.4 (SELECT and GROUP BY), Phase 6.1 (MIN/MAX first_task_date and last_task_date), Phase 7.1 (MAX last_task_date), and Phase 7.2 (MIN first_task_date). See Phase 5.2 Verification for join key.

---

# PHASE 6: SGA Accountability Leaderboard

**Goal**: Build the definitive accountability view. For EVERY SGA: how many opps assigned, how many worked, % worked, activity volume, and who is lagging. **All counts use real outbound only** (per `lead_list_touch_point_exploration_180d.md`) — no link clicks.

## 6.1 Full SGA Leaderboard — Assigned, Worked, % Worked (Real Outbound Only)

```sql
WITH dec30_opps AS (
  SELECT
    o.Id AS opp_id,
    o.StageName,
    COALESCE(o.Opportunity_Owner_Name__c, u.Name, CAST(o.OwnerId AS STRING)) AS sga_name
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
  LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.User` u ON u.Id = o.OwnerId
  WHERE o.IsDeleted = FALSE
    AND o.RecordTypeId = '012VS000009VoxrYAC'
    AND DATE(o.CreatedDate) = '2025-12-30'
),
real_outbound_per_opp AS (
  SELECT
    d.opp_id,
    d.sga_name,
    d.StageName,
    COUNT(a.task_id) AS task_count,
    MIN(a.task_activity_date) AS first_task_date,
    MAX(a.task_activity_date) AS last_task_date
  FROM dec30_opps d
  LEFT JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` a
    ON a.task_what_id = d.opp_id
   AND a.activity_channel_group NOT IN ('Marketing', 'Other', 'Email (Engagement)')
   AND a.activity_channel_group IS NOT NULL
   AND a.direction = 'Outbound'
  GROUP BY d.opp_id, d.sga_name, d.StageName
)
SELECT
  sga_name,
  COUNT(*) AS total_assigned,
  SUM(CASE WHEN task_count > 0 THEN 1 ELSE 0 END) AS opps_worked,
  ROUND(SAFE_DIVIDE(SUM(CASE WHEN task_count > 0 THEN 1 ELSE 0 END), COUNT(*)) * 100, 1) AS pct_worked,
  SUM(CASE WHEN task_count = 0 THEN 1 ELSE 0 END) AS opps_not_worked,
  SUM(task_count) AS total_tasks,
  ROUND(AVG(task_count), 1) AS avg_tasks_per_opp,
  ROUND(SAFE_DIVIDE(SUM(task_count), SUM(CASE WHEN task_count > 0 THEN 1 ELSE 0 END)), 1) AS avg_tasks_per_worked_opp,
  SUM(CASE WHEN StageName = 'Closed Lost' THEN 1 ELSE 0 END) AS closed_lost,
  SUM(CASE WHEN StageName NOT IN ('Closed Lost', 'Planned Nurture') THEN 1 ELSE 0 END) AS actively_in_pipeline,
  SUM(CASE WHEN StageName = 'Planned Nurture' THEN 1 ELSE 0 END) AS still_in_planned_nurture
FROM real_outbound_per_opp
GROUP BY sga_name
ORDER BY total_assigned DESC;
```

Document:
- **Definitive accountability table**: every SGA with their numbers (**real outbound only** — no link clicks).
- `pct_worked` = % of assigned opps with at least 1 **real outbound** task — the core "are they working their leads" metric.
- `opps_not_worked` = zero real outbound tasks — these are the ones falling through the cracks.
- **Who is working the most aggressively?** (highest pct_worked, highest avg_tasks)
- **Who is lagging behind?** (lowest pct_worked, most not_worked)

**Answer:**

| sga_name | total_assigned | opps_worked | pct_worked | opps_not_worked | total_tasks | avg_tasks_per_opp | avg_tasks_per_worked_opp | closed_lost | actively_in_pipeline | still_in_planned_nurture |
|----------|----------------|-------------|------------|-----------------|-------------|-------------------|--------------------------|-------------|----------------------|--------------------------|
| Russell Armitage | 25 | 20 | 80.0 | 5 | 42 | 1.7 | 2.1 | 11 | 1 | 13 |
| Ryan Crandall | 25 | 22 | 88.0 | 3 | 31 | 1.2 | 1.4 | 0 | 0 | 25 |
| Craig Suchodolski | 24 | 16 | 66.7 | 8 | 23 | 1.0 | 1.4 | 5 | 0 | 19 |
| Jason Ainsworth | 10 | 6 | 60.0 | 4 | 10 | 1.0 | 1.7 | 3 | 6 | 1 |
| Holly Huffman | 10 | 5 | 50.0 | 5 | 6 | 0.6 | 1.2 | 0 | 0 | 10 |
| Amy Waller | 25 | 9 | 36.0 | 16 | 20 | 0.8 | 2.2 | 1 | 0 | 24 |
| Lauren George | 23 | 3 | 13.0 | 20 | 3 | 0.1 | 1.0 | 4 | 0 | 19 |
| Channing Guyer | 24 | 3 | 12.5 | 21 | 7 | 0.3 | 2.3 | 16 | 0 | 8 |
| Brian O'Hara | 24 | 2 | 8.3 | 22 | 8 | 0.3 | 4.0 | 1 | 0 | 23 |
| Marisa Saucedo | 25 | 1 | 4.0 | 24 | 1 | 0.0 | 1.0 | 19 | 4 | 2 |
| Perry Kalmeta | 22 | 1 | 4.5 | 21 | 1 | 0.0 | 1.0 | 6 | 2 | 14 |
| Helen Kamens | 25 | 1 | 4.0 | 24 | 3 | 0.1 | 3.0 | 0 | 0 | 25 |
| Eleni Stefanopoulos | 24 | 0 | 0.0 | 24 | 0 | 0.0 | — | 0 | 0 | 24 |
| Chris Morgan | 2 | 0 | 0.0 | 2 | 0 | 0.0 | — | 0 | 0 | 2 |
| Jade Bingham | 1 | 0 | 0.0 | 1 | 0 | 0.0 | — | 0 | 1 | 0 |
| Bre McDaniel | 1 | 1 | 100.0 | 0 | 4 | 4.0 | 4.0 | 0 | 1 | 0 |

**Summary:** **Working most aggressively:** Ryan Crandall (88% worked, 22 opps), Russell Armitage (80%, 20 opps), Craig Suchodolski (66.7%, 16 opps), Jason Ainsworth (60%, 6 opps). **Lagging:** Eleni Stefanopoulos (0% worked, 24 not worked), Helen Kamens (4%, 24 not worked), Marisa Saucedo (4%, 24 not worked), Brian O'Hara (8.3%, 22 not worked), Channing Guyer (12.5%, 21 not worked). Every SGA appears; zeros shown.

---

## 6.2 Opps with Zero Real Outbound Activity — The Untouched List

Which specific Re-Engagement opps have **never had a real outbound touch** (no link clicks counted)? List them by SGA so we can follow up. Uses the real-outbound filter per `lead_list_touch_point_exploration_180d.md`.

```sql
WITH dec30_opps AS (
  SELECT
    o.Id AS opp_id,
    o.Name AS opp_name,
    o.StageName,
    COALESCE(o.Opportunity_Owner_Name__c, u.Name, CAST(o.OwnerId AS STRING)) AS sga_name
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
  LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.User` u ON u.Id = o.OwnerId
  WHERE o.IsDeleted = FALSE
    AND o.RecordTypeId = '012VS000009VoxrYAC'
    AND DATE(o.CreatedDate) = '2025-12-30'
),
real_outbound_per_opp AS (
  SELECT
    d.opp_id,
    d.opp_name,
    d.sga_name,
    d.StageName,
    COUNT(a.task_id) AS task_count
  FROM dec30_opps d
  LEFT JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` a
    ON a.task_what_id = d.opp_id
   AND a.activity_channel_group NOT IN ('Marketing', 'Other', 'Email (Engagement)')
   AND a.activity_channel_group IS NOT NULL
   AND a.direction = 'Outbound'
  GROUP BY d.opp_id, d.opp_name, d.sga_name, d.StageName
)
SELECT
  sga_name,
  COUNT(*) AS zero_activity_opps,
  STRING_AGG(opp_name, ', ' ORDER BY opp_name LIMIT 10) AS sample_opp_names,
  STRING_AGG(DISTINCT StageName, ', ') AS stages_represented
FROM real_outbound_per_opp
WHERE task_count = 0
GROUP BY sga_name
ORDER BY zero_activity_opps DESC;
```

Document:
- Which SGAs have the most untouched opps (zero **real outbound** tasks)?
- Sample names for Salesforce spot-checking.
- Are untouched opps in Planned Nurture (never started) or other stages (stalled)?

**Answer:**

| sga_name | zero_activity_opps | stages_represented |
|----------|--------------------|--------------------|
| Eleni Stefanopoulos | 24 | Planned Nurture |
| Helen Kamens | 24 | Planned Nurture |
| Marisa Saucedo | 24 | Closed Lost, Outreach, Planned Nurture |
| Brian O'Hara | 22 | Planned Nurture, Closed Lost |
| Perry Kalmeta | 21 | Planned Nurture, Closed Lost, Engaged |
| Channing Guyer | 21 | Closed Lost, Planned Nurture |
| Lauren George | 20 | Planned Nurture, Closed Lost |
| Amy Waller | 16 | Planned Nurture |
| Craig Suchodolski | 8 | Planned Nurture, Closed Lost |
| Russell Armitage | 5 | Closed Lost, Re-Engaged |
| Holly Huffman | 5 | Planned Nurture |
| Jason Ainsworth | 4 | Closed Lost, Planned Nurture |
| Ryan Crandall | 3 | Planned Nurture |
| Chris Morgan | 2 | Planned Nurture |
| Jade Bingham | 1 | Re-Engaged |

**Summary:** **Eleni Stefanopoulos**, **Helen Kamens**, **Marisa Saucedo** have the most untouched opps (24 each). Sample names: Eleni — Alejandro Algaze, Angelo Leslie, Brian Bengry; Helen — Aubrey Brown, Avi Pai, Bennett Smith; Marisa — Aaron Klemow, Aron Martz, Brian Kubis. Most untouched are in **Planned Nurture**; Marisa has mix (Closed Lost, Outreach, Planned Nurture); Russell and Jade have untouched in Re-Engaged/Closed Lost (stalled or no real outbound logged).

---

## 6.3 SGA Activity by Channel (Real Outbound Only — Who Is Doing What Type of Outreach?)

Use the activity view with the real-outbound filter so channel mix per SGA reflects **real SGA touches**, not link clicks (per `lead_list_touch_point_exploration_180d.md`).

```sql
WITH dec30_opps AS (
  SELECT
    o.Id AS opp_id,
    COALESCE(o.Opportunity_Owner_Name__c, u.Name, CAST(o.OwnerId AS STRING)) AS sga_name
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
  LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.User` u ON u.Id = o.OwnerId
  WHERE o.IsDeleted = FALSE
    AND o.RecordTypeId = '012VS000009VoxrYAC'
    AND DATE(o.CreatedDate) = '2025-12-30'
)
SELECT
  d.sga_name,
  SUM(CASE WHEN a.activity_channel_group = 'Call' THEN 1 ELSE 0 END) AS calls,
  SUM(CASE WHEN a.activity_channel_group = 'SMS' THEN 1 ELSE 0 END) AS sms,
  SUM(CASE WHEN a.activity_channel_group = 'Email' THEN 1 ELSE 0 END) AS emails,
  SUM(CASE WHEN a.activity_channel_group = 'LinkedIn' THEN 1 ELSE 0 END) AS linkedin,
  SUM(CASE WHEN a.activity_channel_group = 'Meeting' THEN 1 ELSE 0 END) AS meetings,
  SUM(CASE WHEN a.activity_channel_group NOT IN ('Call', 'SMS', 'Email', 'LinkedIn', 'Meeting') AND a.activity_channel_group IS NOT NULL THEN 1 ELSE 0 END) AS other,
  COUNT(a.task_id) AS total_tasks
FROM dec30_opps d
LEFT JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` a
  ON a.task_what_id = d.opp_id
 AND a.activity_channel_group NOT IN ('Marketing', 'Other', 'Email (Engagement)')
 AND a.activity_channel_group IS NOT NULL
 AND a.direction = 'Outbound'
GROUP BY d.sga_name
ORDER BY total_tasks DESC;
```

Document:
- Channel mix per SGA (**real outbound only** — no link clicks). Meeting is its own column so it is not hidden in "other."
- Are SGAs multi-channel (calls + SMS + email + LinkedIn + meetings) or single-channel?
- Who is calling vs. texting vs. emailing?

**Answer:**

| sga_name | calls | sms | emails | linkedin | meetings | other | total_tasks |
|----------|-------|-----|--------|----------|----------|-------|-------------|
| Russell Armitage | 5 | 37 | 0 | 0 | 0 | 0 | 42 |
| Ryan Crandall | 1 | 6 | 0 | 24 | 0 | 0 | 31 |
| Craig Suchodolski | 4 | 19 | 0 | 0 | 0 | 0 | 23 |
| Amy Waller | 7 | 13 | 0 | 0 | 0 | 0 | 20 |
| Jason Ainsworth | 2 | 6 | 0 | 2 | 0 | 0 | 10 |
| Brian O'Hara | 1 | 7 | 0 | 0 | 0 | 0 | 8 |
| Channing Guyer | 1 | 6 | 0 | 0 | 0 | 0 | 7 |
| Holly Huffman | 0 | 6 | 0 | 0 | 0 | 0 | 6 |
| Bre McDaniel | 2 | 2 | 0 | 0 | 0 | 0 | 4 |
| Lauren George | 0 | 3 | 0 | 0 | 0 | 0 | 3 |
| Helen Kamens | 1 | 2 | 0 | 0 | 0 | 0 | 3 |
| Perry Kalmeta | 0 | 1 | 0 | 0 | 0 | 0 | 1 |
| Marisa Saucedo | 0 | 1 | 0 | 0 | 0 | 0 | 1 |
| Jade Bingham | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Chris Morgan | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Eleni Stefanopoulos | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

**Summary:** **Multi-channel:** Russell (calls + SMS), Ryan (calls + SMS + LinkedIn), Craig/Amy (calls + SMS), Jason (calls + SMS + LinkedIn). **Single-channel:** Holly, Lauren (SMS only); Perry, Marisa (1 task each). **Russell** has most calls (5) and SMS (37); **Ryan** has most LinkedIn (24). No Email or Meeting in real outbound for this cohort.

---

### Verification (added by Cursor)

**Issue:** Phase 6.3 "other" bucket was catching Meeting (a legitimate outbound channel) — inflating other and hiding useful data.

**Verification query (distinct activity_channel_group for Dec 30 real outbound):**
```sql
WITH dec30_opp_ids AS (
  SELECT Id AS opp_id
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
  WHERE IsDeleted = FALSE
    AND RecordTypeId = '012VS000009VoxrYAC'
    AND DATE(CreatedDate) = '2025-12-30'
)
SELECT
  a.activity_channel_group,
  COUNT(*) AS task_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` a
INNER JOIN dec30_opp_ids d ON d.opp_id = a.task_what_id
WHERE a.activity_channel_group NOT IN ('Marketing', 'Other', 'Email (Engagement)')
  AND a.activity_channel_group IS NOT NULL
  AND a.direction = 'Outbound'
GROUP BY a.activity_channel_group
ORDER BY task_count DESC;
```

**Result:** For Dec 30 cohort real outbound: **SMS** (109 tasks), **LinkedIn** (26), **Call** (24) — 159 total, consistent with Phase 5.3 re-run. View can also produce Email, Meeting; "other" should exclude all named channels so it captures only unexpected/miscategorized.

**Action taken:** Added `meetings` column: `SUM(CASE WHEN a.activity_channel_group = 'Meeting' THEN 1 ELSE 0 END) AS meetings`. Updated `other` to exclude Meeting: `activity_channel_group NOT IN ('Call', 'SMS', 'Email', 'LinkedIn', 'Meeting')`. Phase 5.3 remains GROUP BY activity_channel_group (dynamic rows) so all channels appear without a fixed "other" bucket.

---

# PHASE 7: Time-to-Contact & Recency Analysis

**Goal**: How recently are these opps being worked? Are there stale leads going cold? **All recency and time-to-first-activity use real outbound only** (per `lead_list_touch_point_exploration_180d.md`) — no link clicks.

## 7.1 Recency of Last Real Outbound Activity on Open Opps (Still Working)

```sql
WITH dec30_open AS (
  SELECT
    o.Id AS opp_id,
    o.StageName,
    COALESCE(o.Opportunity_Owner_Name__c, u.Name, CAST(o.OwnerId AS STRING)) AS sga_name
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
  LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.User` u ON u.Id = o.OwnerId
  WHERE o.IsDeleted = FALSE
    AND o.RecordTypeId = '012VS000009VoxrYAC'
    AND DATE(o.CreatedDate) = '2025-12-30'
    AND o.StageName != 'Closed Lost'
),
last_real_touch AS (
  SELECT
    d.opp_id,
    d.sga_name,
    d.StageName,
    MAX(a.task_activity_date) AS last_task_date
  FROM dec30_open d
  LEFT JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` a
    ON a.task_what_id = d.opp_id
   AND a.activity_channel_group NOT IN ('Marketing', 'Other', 'Email (Engagement)')
   AND a.activity_channel_group IS NOT NULL
   AND a.direction = 'Outbound'
  GROUP BY d.opp_id, d.sga_name, d.StageName
)
SELECT
  sga_name,
  COUNT(*) AS open_opps,
  SUM(CASE WHEN last_task_date IS NULL THEN 1 ELSE 0 END) AS never_touched,
  SUM(CASE WHEN DATE_DIFF(CURRENT_DATE(), last_task_date, DAY) <= 7 THEN 1 ELSE 0 END) AS active_last_7d,
  SUM(CASE WHEN DATE_DIFF(CURRENT_DATE(), last_task_date, DAY) BETWEEN 8 AND 14 THEN 1 ELSE 0 END) AS active_8_14d,
  SUM(CASE WHEN DATE_DIFF(CURRENT_DATE(), last_task_date, DAY) BETWEEN 15 AND 30 THEN 1 ELSE 0 END) AS active_15_30d,
  SUM(CASE WHEN DATE_DIFF(CURRENT_DATE(), last_task_date, DAY) > 30 THEN 1 ELSE 0 END) AS stale_over_30d
FROM last_real_touch
GROUP BY sga_name
ORDER BY open_opps DESC;
```

Document:
- `never_touched` = open opps with no **real outbound** tasks — sitting idle.
- `stale_over_30d` = last real outbound activity 30+ days ago — going cold.
- `active_last_7d` = real outbound activity in the last 7 days — these SGAs are working.
- **Key question**: Are open opps actively being worked or dying on the vine?

**Answer:**

| sga_name | open_opps | never_touched | active_last_7d | active_8_14d | active_15_30d | stale_over_30d |
|----------|------------|---------------|----------------|--------------|---------------|----------------|
| Ryan Crandall | 25 | 3 | 1 | 21 | 0 | 0 |
| Helen Kamens | 25 | 24 | 0 | 0 | 0 | 0 |
| Eleni Stefanopoulos | 24 | 24 | 0 | 0 | 0 | 0 |
| Amy Waller | 24 | 16 | 3 | 5 | 0 | 0 |
| Brian O'Hara | 23 | 21 | 0 | 1 | 1 | 0 |
| Lauren George | 19 | 16 | 0 | 0 | 3 | 0 |
| Craig Suchodolski | 19 | 7 | 3 | 0 | 9 | 0 |
| Perry Kalmeta | 16 | 15 | 0 | 1 | 0 | 0 |
| Russell Armitage | 14 | 1 | 12 | 0 | 1 | 0 |
| Holly Huffman | 10 | 5 | 0 | 1 | 4 | 0 |
| Channing Guyer | 8 | 7 | 1 | 0 | 0 | 0 |
| Jason Ainsworth | 7 | 1 | 0 | 4 | 2 | 0 |
| Marisa Saucedo | 6 | 6 | 0 | 0 | 0 | 0 |
| Chris Morgan | 2 | 2 | 0 | 0 | 0 | 0 |
| Jade Bingham | 1 | 1 | 0 | 0 | 0 | 0 |
| Bre McDaniel | 1 | 0 | 0 | 0 | 1 | 0 |

**Summary:** **Russell Armitage** has 12 open opps with activity in last 7 days (actively working). **Ryan Crandall** has 21 in 8–14d (recent). **Helen Kamens**, **Eleni Stefanopoulos** have 24 never_touched each (sitting idle). **Marisa Saucedo** has 6 open, all never_touched. **stale_over_30d** = 0 for all — no open opps with last touch 30+ days ago. Open opps are either never touched or touched within 30 days.

---

## 7.2 Days from Creation to First Real Outbound Activity

How quickly did SGAs start **really** working these opps (first real outbound touch) after they were created on Dec 30? Uses the real-outbound filter per `lead_list_touch_point_exploration_180d.md` — link clicks do not count.

```sql
WITH dec30_opps AS (
  SELECT
    o.Id AS opp_id,
    DATE(o.CreatedDate) AS created_date,
    COALESCE(o.Opportunity_Owner_Name__c, u.Name, CAST(o.OwnerId AS STRING)) AS sga_name
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
  LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.User` u ON u.Id = o.OwnerId
  WHERE o.IsDeleted = FALSE
    AND o.RecordTypeId = '012VS000009VoxrYAC'
    AND DATE(o.CreatedDate) = '2025-12-30'
),
first_real_activity AS (
  SELECT
    d.opp_id,
    d.sga_name,
    d.created_date,
    MIN(a.task_activity_date) AS first_task_date
  FROM dec30_opps d
  LEFT JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` a
    ON a.task_what_id = d.opp_id
   AND a.activity_channel_group NOT IN ('Marketing', 'Other', 'Email (Engagement)')
   AND a.activity_channel_group IS NOT NULL
   AND a.direction = 'Outbound'
  GROUP BY d.opp_id, d.sga_name, d.created_date
)
SELECT
  sga_name,
  COUNT(*) AS total_opps,
  SUM(CASE WHEN first_task_date IS NOT NULL THEN 1 ELSE 0 END) AS opps_with_activity,
  ROUND(AVG(CASE WHEN first_task_date IS NOT NULL THEN DATE_DIFF(first_task_date, created_date, DAY) END), 1) AS avg_days_to_first_activity,
  MIN(CASE WHEN first_task_date IS NOT NULL THEN DATE_DIFF(first_task_date, created_date, DAY) END) AS min_days,
  MAX(CASE WHEN first_task_date IS NOT NULL THEN DATE_DIFF(first_task_date, created_date, DAY) END) AS max_days
FROM first_real_activity
GROUP BY sga_name
ORDER BY avg_days_to_first_activity;
```

Document:
- **Response time**: How many days from opp creation to first **real outbound** task (no link clicks)?
- Which SGAs jumped on these fastest?
- Which SGAs took the longest to start working them?

**Answer:**

| sga_name | total_opps | opps_with_activity | avg_days_to_first_activity | min_days | max_days |
|----------|------------|--------------------|----------------------------|----------|----------|
| Marisa Saucedo | 25 | 1 | 23.0 | 23 | 23 |
| Bre McDaniel | 1 | 1 | 23.0 | 23 | 23 |
| Holly Huffman | 10 | 5 | 23.6 | 22 | 29 |
| Helen Kamens | 25 | 1 | 24.0 | 24 | 24 |
| Jason Ainsworth | 10 | 6 | 24.0 | 22 | 28 |
| Brian O'Hara | 24 | 2 | 24.0 | 22 | 28 |
| Channing Guyer | 24 | 3 | 26.3 | 14 | 41 |
| Craig Suchodolski | 24 | 16 | 26.8 | 20 | 41 |
| Lauren George | 23 | 3 | 27.0 | 27 | 27 |
| Ryan Crandall | 25 | 22 | 27.5 | 23 | 28 |
| Perry Kalmeta | 22 | 1 | 30.0 | 30 | 30 |
| Amy Waller | 25 | 9 | 30.4 | 24 | 41 |
| Russell Armitage | 25 | 20 | 34.5 | 13 | 41 |
| Eleni Stefanopoulos | 24 | 0 | — | — | — |
| Chris Morgan | 2 | 0 | — | — | — |
| Jade Bingham | 1 | 0 | — | — | — |

**Summary:** **Fastest to first touch:** Channing (min 14 days), Russell (min 13), Craig (min 20). **Slowest avg:** Russell (34.5 days), Amy (30.4), Perry (30). **Eleni, Chris, Jade** have 0 opps with real outbound activity (never started). First activity typically 22–30+ days after Dec 30 creation.

---

# PHASE 8: Recruiting Opportunity Conversion

**Goal**: The ultimate success metric — how many of these 290 re-engagement opps have been converted to a Recruiting opportunity?

## 8.1 Recruiting Conversion Count

```sql
SELECT
  COUNT(*) AS total_re_eng_opps,
  SUM(CASE WHEN o.Created_Recruiting_Opportunity_ID__c IS NOT NULL THEN 1 ELSE 0 END) AS converted_to_recruiting,
  ROUND(
    SAFE_DIVIDE(
      SUM(CASE WHEN o.Created_Recruiting_Opportunity_ID__c IS NOT NULL THEN 1 ELSE 0 END),
      COUNT(*)
    ) * 100, 1
  ) AS conversion_rate_pct
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
WHERE o.IsDeleted = FALSE
  AND o.RecordTypeId = '012VS000009VoxrYAC'
  AND DATE(o.CreatedDate) = '2025-12-30';
```

Document:
- How many of the 290 have created a Recruiting opp?
- Conversion rate to recruiting

**Answer:**

| total_re_eng_opps | converted_to_recruiting | conversion_rate_pct |
|-------------------|-------------------------|----------------------|
| 290 | 0 | 0.0% |

**Summary:** **0** of 290 have created a Recruiting opportunity. Conversion rate to recruiting = **0%**.

---

## 8.2 Recruiting Conversion Details

```sql
SELECT
  o.Id AS re_eng_opp_id,
  o.Name AS re_eng_opp_name,
  COALESCE(o.Opportunity_Owner_Name__c, u.Name) AS sga_name,
  o.StageName AS re_eng_stage,
  o.Created_Recruiting_Opportunity_ID__c AS recruiting_opp_id,
  r.Name AS recruiting_opp_name,
  r.StageName AS recruiting_stage,
  r.CreatedDate AS recruiting_created_date
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.User` u ON u.Id = o.OwnerId
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.Opportunity` r
  ON r.Id = o.Created_Recruiting_Opportunity_ID__c AND r.IsDeleted = FALSE
WHERE o.IsDeleted = FALSE
  AND o.RecordTypeId = '012VS000009VoxrYAC'
  AND DATE(o.CreatedDate) = '2025-12-30'
  AND o.Created_Recruiting_Opportunity_ID__c IS NOT NULL;
```

Document:
- Details on each converted opp: who was it, which SGA, what stage is the recruiting opp in?
- If 0 conversions, note that and move on

**Answer:**

**0 rows.** No Re-Engagement opps from the Dec 30 cohort have Created_Recruiting_Opportunity_ID__c set. No conversion details to report.

---

## 8.3 Recruiting Conversion by SGA

```sql
SELECT
  COALESCE(o.Opportunity_Owner_Name__c, u.Name, CAST(o.OwnerId AS STRING)) AS sga_name,
  COUNT(*) AS total_assigned,
  SUM(CASE WHEN o.Created_Recruiting_Opportunity_ID__c IS NOT NULL THEN 1 ELSE 0 END) AS converted_to_recruiting,
  ROUND(
    SAFE_DIVIDE(
      SUM(CASE WHEN o.Created_Recruiting_Opportunity_ID__c IS NOT NULL THEN 1 ELSE 0 END),
      COUNT(*)
    ) * 100, 1
  ) AS conversion_rate_pct
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.User` u ON u.Id = o.OwnerId
WHERE o.IsDeleted = FALSE
  AND o.RecordTypeId = '012VS000009VoxrYAC'
  AND DATE(o.CreatedDate) = '2025-12-30'
GROUP BY sga_name
ORDER BY converted_to_recruiting DESC, total_assigned DESC;
```

Document:
- Which SGAs have converted any to recruiting?
- Even if conversion is 0 across the board, show every SGA with their 0 so it's visible

**Answer:**

**Every SGA:** 0 converted to recruiting (all 16 SGAs have converted_to_recruiting = 0, conversion_rate_pct = 0.0%). No SGA has converted any of the 290 Dec 30 Re-Engagement opps to a Recruiting opportunity.

---

## 8.4 Unlinked Recruiting Opps — Manual Conversions Before Flow Existed

The Re-Engagement → Recruiting conversion flow (which populates `Created_Recruiting_Opportunity_ID__c`) was deployed after these 290 opps were created on 2025-12-30. Any SGA who re-engaged an advisor and manually created a Recruiting opp before the flow existed would NOT have the link field set. This query checks for Recruiting opps created for the same contacts after Dec 30 that are NOT linked to any Re-Engagement opp.

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

**Answer:**

No unlinked Recruiting opps found for Dec 30 cohort contacts. Phase 8.1–8.3 conversion count of 0 is confirmed — no manual conversions predating the flow.

---

# PHASE 9: Lead-Level Funnel Position (via vw_funnel_master)

**Goal**: Cross-reference the 290 Re-Engagement opps with vw_funnel_master to see funnel position (TOF_Stage, is_contacted, is_mql, is_sql, is_sqo). The funnel view includes Re-Engagement opps via `Opp_Base` (`RecordTypeId IN ('012Dn000000mrO3IAI', '012VS000009VoxrYAC')`). Rows are joined Lead to Opp on `l.converted_oppty_id = o.Full_Opportunity_ID__c`; Re-Engagement opps created without a converted lead appear as **opportunity-only** rows (Full_Opportunity_ID__c set, Full_prospect_id__c NULL). For those rows, lead-level flags (is_contacted, is_mql, is_sql) come from the lead and are 0; TOF_Stage and is_sqo/is_joined use Opportunity fields (SQO_raw, StageName, advisor_join_date__c).

## 9.1 Lead-Level TOF_Stage for Dec 30 Re-Engagement Prospects

This depends on the join established in Phase 1.2. Use **Option A** (join via `Full_Opportunity_ID__c`) first; if it returns 0, try Option B (join via ContactId / Full_prospect_id__c).

```sql
-- Option A: join via Full_Opportunity_ID__c
SELECT
  v.TOF_Stage,
  v.Conversion_Status,
  COUNT(*) AS record_count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) AS pct_of_total
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE v.Full_Opportunity_ID__c IN (
  SELECT Id
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
  WHERE IsDeleted = FALSE
    AND RecordTypeId = '012VS000009VoxrYAC'
    AND DATE(CreatedDate) = '2025-12-30'
)
GROUP BY v.TOF_Stage, v.Conversion_Status
ORDER BY
  CASE v.TOF_Stage
    WHEN 'Prospect' THEN 1
    WHEN 'Contacted' THEN 2
    WHEN 'MQL' THEN 3
    WHEN 'SQL' THEN 4
    WHEN 'SQO' THEN 5
    WHEN 'Joined' THEN 6
  END,
  v.Conversion_Status;
```

```sql
-- Option B: join via ContactId (if Option A returns 0)
SELECT
  v.TOF_Stage,
  v.Conversion_Status,
  COUNT(DISTINCT o.Id) AS re_eng_opps,
  ROUND(COUNT(DISTINCT o.Id) * 100.0 / SUM(COUNT(DISTINCT o.Id)) OVER(), 1) AS pct_of_total
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
INNER JOIN `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
  ON v.Full_prospect_id__c = o.ContactId
WHERE o.IsDeleted = FALSE
  AND o.RecordTypeId = '012VS000009VoxrYAC'
  AND DATE(o.CreatedDate) = '2025-12-30'
GROUP BY v.TOF_Stage, v.Conversion_Status
ORDER BY
  CASE v.TOF_Stage
    WHEN 'Prospect' THEN 1
    WHEN 'Contacted' THEN 2
    WHEN 'MQL' THEN 3
    WHEN 'SQL' THEN 4
    WHEN 'SQO' THEN 5
    WHEN 'Joined' THEN 6
  END,
  v.Conversion_Status;
```

Document:
- Lead-level funnel position for the prospects behind these 290 Re-Engagement opps
- How does the lead-level funnel compare to the opp-level stage distribution from Phase 2?
- Are there prospects who are MQL/SQL/SQO at the lead level but whose Re-Engagement opp is still in Planned Nurture?

**Answer:**

**Option A** (join via `Full_Opportunity_ID__c`) used; 290 matched.

| TOF_Stage | Conversion_Status | record_count | pct_of_total |
|-----------|-------------------|--------------|---------------|
| Prospect | Open | 224 | 77.2% |
| Prospect | Closed | 66 | 22.8% |

**Summary:** All 290 appear in vw_funnel_master as **TOF_Stage = Prospect** (Re-Engagement opp-only rows have no converted lead, so lead-level flags are 0; TOF_Stage defaults to Prospect). **224** Open (77.2%), **66** Closed (22.8%) — aligns with Phase 2 (224 open, 66 closed). No MQL/SQL/SQO at lead level for this cohort; no prospects in Planned Nurture at opp level but MQL+ at lead level.

---

## 9.2 Lead-Level Conversion Flags

```sql
SELECT
  COUNT(DISTINCT o.Id) AS total_re_eng_opps,
  SUM(CASE WHEN v.is_contacted = 1 THEN 1 ELSE 0 END) AS lead_contacted,
  ROUND(SAFE_DIVIDE(SUM(CASE WHEN v.is_contacted = 1 THEN 1 ELSE 0 END), COUNT(DISTINCT o.Id)) * 100, 1) AS pct_lead_contacted,
  SUM(CASE WHEN v.is_mql = 1 THEN 1 ELSE 0 END) AS lead_mql,
  ROUND(SAFE_DIVIDE(SUM(CASE WHEN v.is_mql = 1 THEN 1 ELSE 0 END), SUM(CASE WHEN v.is_contacted = 1 THEN 1 ELSE 0 END)) * 100, 1) AS contacted_to_mql_rate,
  SUM(CASE WHEN v.is_sql = 1 THEN 1 ELSE 0 END) AS lead_sql,
  ROUND(SAFE_DIVIDE(SUM(CASE WHEN v.is_sql = 1 THEN 1 ELSE 0 END), SUM(CASE WHEN v.is_mql = 1 THEN 1 ELSE 0 END)) * 100, 1) AS mql_to_sql_rate,
  SUM(CASE WHEN v.is_sqo = 1 THEN 1 ELSE 0 END) AS lead_sqo,
  ROUND(SAFE_DIVIDE(SUM(CASE WHEN v.is_sqo = 1 THEN 1 ELSE 0 END), SUM(CASE WHEN v.is_sql = 1 THEN 1 ELSE 0 END)) * 100, 1) AS sql_to_sqo_rate,
  SUM(CASE WHEN v.is_joined = 1 THEN 1 ELSE 0 END) AS lead_joined
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
INNER JOIN `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
  ON v.Full_Opportunity_ID__c = o.Id  -- adjust join key per Phase 1.2 findings
WHERE o.IsDeleted = FALSE
  AND o.RecordTypeId = '012VS000009VoxrYAC'
  AND DATE(o.CreatedDate) = '2025-12-30';
```

Document:
- Lead-level conversion rates: Contacted → MQL → SQL → SQO → Joined
- Compare to the Re-Engagement opp-level rates from Phase 3
- If join doesn't work on `Full_Opportunity_ID__c`, substitute `ContactId` join per Phase 1.2

**Answer:**

| total_re_eng_opps | lead_contacted | pct_lead_contacted | lead_mql | contacted_to_mql_rate | lead_sql | mql_to_sql_rate | lead_sqo | sql_to_sqo_rate | lead_joined |
|-------------------|----------------|--------------------|----------|------------------------|----------|-----------------|----------|----------------|-------------|
| 290 | 0 | 0.0% | 0 | — | 0 | — | 0 | — | 0 |

**Summary:** Join on `Full_Opportunity_ID__c` works. For Re-Engagement opp-only rows (no linked lead), **lead_contacted = 0**, **lead_mql = 0**, **lead_sql = 0**, **lead_sqo = 0**, **lead_joined = 0**. Lead-level conversion rates are N/A; use **Phase 3.4** (activity-based contacted) and **Phase 3.1/3.2** for opp-level conversion.

---

# PHASE 10: Summary & Coaching Insights

**Goal**: Synthesize all findings into actionable coaching points.

## 10.1 Final Summary

After completing all phases above, Cursor should write a comprehensive summary answering these questions:

1. **Cohort Size**: Confirm the 290 Re-Engagement opportunities created Dec 30, 2025.
2. **Open vs Closed**: What percentage are still open? What percentage are closed lost?
3. **Stage Distribution**: How many are in each Re-Engagement stage? Where is the bulk sitting?
4. **Are These Leads Being Worked?**: What percentage of the 290 have at least one activity? How many have zero?
5. **Who Is Working Them Most Aggressively?**: Which SGAs have the highest % worked and highest activity volume per opp?
6. **Who Is Lagging Behind?**: Which SGAs have the most unworked opps and lowest % worked?
7. **Conversion Rates**: What are the stage-to-stage conversion rates (Contacted→MQL, MQL→SQL, SQL→SQO)?
8. **Recruiting Conversion**: How many of the 290 have been converted to a Recruiting opportunity?
9. **Closed Lost Reasons**: What are the top reasons for closure? Are there data hygiene issues (missing reasons)?
10. **Staleness Risk**: How many open opps have gone 30+ days without activity?
11. **Actionable Recommendations**: Based on the data, what 3-5 specific coaching actions should we take?

**Answer:**

---

**1. Cohort size.** The cohort is **290** Re-Engagement opportunities created on **2025-12-30** (RecordTypeId = '012VS000009VoxrYAC'), creation window 16:37:44–16:42:05 UTC, **16** distinct SGAs, **6** stages present. All 290 appear in vw_funnel_master (join key Full_Opportunity_ID__c).

**2. Open vs closed.** **77.2%** (224) are still **open**; **22.8%** (66) are **closed lost**.

**3. Stage distribution.** **209** (72.1%) in **Planned Nurture**, **10** (3.4%) Outreach, **2** (0.7%) Engaged, **1** (0.3%) Call Scheduled, **2** (0.7%) Re-Engaged, **66** (22.8%) Closed Lost. Bulk is in Planned Nurture. However, stage distribution does not reflect work status for this cohort. SGAs were working leads without moving stages (e.g., Ryan Crandall: 25 in Planned Nurture but 88% worked per Phase 6.1). Use Phase 6.1 activity data for actual work status.

**4. Are these leads being worked?** **31%** (90 of 290) have at least one **real outbound** activity; **200** have **zero** real outbound tasks (69% never touched). This is the reliable metric. Phase 5.1 baseline: 200 total tasks (all types); 5.2 real outbound: 159 tasks — **41 tasks** (20.5%) are link clicks/marketing/noise.

**5. Who is working them most aggressively?** **Ryan Crandall** (88% worked, 22 opps, 31 tasks), **Russell Armitage** (80%, 20 opps, 42 tasks), **Craig Suchodolski** (66.7%, 16 opps), **Jason Ainsworth** (60%, 6 opps), **Holly Huffman** (50%, 5 opps). **Bre McDaniel** (100%, 1 opp, 4 tasks). Use Phase 6.1 activity data.

**6. Who is lagging behind?** **Eleni Stefanopoulos** (0% worked, 24 not worked), **Helen Kamens** (4%, 24 not worked), **Marisa Saucedo** (4%, 24 not worked), **Brian O'Hara** (8.3%, 22 not worked), **Channing Guyer** (12.5%, 21 not worked). **Chris Morgan** (0%, 2), **Jade Bingham** (0%, 1).

**7. Conversion rates.** Phase 3.4 (activity-based contacted) is the only reliable conversion metric: **90** contacted (31%). **MQL and SQL rates are structural undercounts** — the stage-entered date fields were deployed after these opps were created, so any Closed Lost opp that reached Engaged/Re-Engaged before deployment shows no stage date. MQL=2 and SQL=0 are floors, not true rates. Current-stage counts (Phase 3.2: 5 MQL, 3 SQL, 2 Re-Engaged) are the best proxy for downstream conversion but exclude Closed Lost that progressed.

**8. Recruiting conversion.** Phase 8.1–8.3: **0** linked conversions via `Created_Recruiting_Opportunity_ID__c`. **However**, the conversion flow was deployed after these opps were created. Phase 8.4 checked for unlinked Recruiting opps created for the same contacts: **no unlinked opps found**. The 0% conversion rate is confirmed.

**9. Closed lost reasons.** **66** closed lost. Top reasons: **Other** (29, 43.9%), **No Reason Set** (15, 22.7% — data hygiene issue), **Savvy Declined - Poor Culture Fit** (7), **Book Not Transferable** (5), **Lost to Competitor** (3). **Russell Armitage** has 10 with "No Reason Set"; **Channing Guyer** has 16 "Other." The closed-lost data is clean because all closures happened after Stage_Entered_Closed__c was deployed (Jan 13+).

**10. Staleness risk.** **0** open opps have gone 30+ days without **real outbound** activity (stale_over_30d = 0 for all SGAs). Open opps are either never touched or touched within 30 days. **200** open opps have **never** had real outbound (never_touched).

### Data Limitations for This Cohort

Three structural data gaps affect this analysis. All stem from Salesforce features being deployed after these 290 opps were created on 2025-12-30:

1. **Stage-entered dates are structurally NULL.** `Stage_Entered_Outreach__c` through `Stage_Entered_Re_Engaged__c` were added after cohort creation. Only 1 of 290 has an Outreach date; 0 have Engaged/Call Scheduled/Re-Engaged dates. This means MQL and SQL conversion rates for Closed Lost records are structural undercounts — we cannot determine how far those 15 worked-then-closed opps progressed. `Stage_Entered_Closed__c` has full coverage (69/69 Closed Lost) because all closures occurred after the field was deployed (Jan 13+).

2. **The Re-Engagement → Recruiting conversion flow was deployed after cohort creation.** `Created_Recruiting_Opportunity_ID__c` may not capture conversions that occurred before the flow existed. Phase 8.4 checked for unlinked Recruiting opps: **no unlinked opps found** — 0% conversion is confirmed.

3. **Stage discipline was not enforced.** SGAs worked leads without moving stages from Planned Nurture. Stage distribution (Phase 2) does not reflect work status. Activity data (Phase 5.2, 6.1) is the only reliable measure of effort. Example: Ryan Crandall — 25 in Planned Nurture by stage, but 88% worked (22 opps, 31 real outbound tasks) by activity.

**Bottom line:** For this cohort, trust activity data (Phases 5–7) for accountability, current StageName (Phase 3.2) for best-available funnel position, and treat all stage-entered-date-based conversion rates as floors.

**11. Actionable recommendations.**

1. **Prioritize SGAs with 0% or low % worked.** Eleni Stefanopoulos (24 untouched), Helen Kamens (24), Marisa Saucedo (24) — 1:1s to unblock: capacity, list quality, or process. Ensure they have clear next steps and time blocked for re-engagement.
2. **Enforce Closed Lost reason and details.** 15 closed with "No Reason Set"; Russell Armitage has 10. Require picklist + brief details before closing so we can analyze loss reasons and improve qualification.
3. **Use activity data (Phase 6.1) as the definitive accountability metric**, not StageName. Stage distribution is unreliable for this cohort — SGAs were working leads without moving stages. Set contacted targets using real outbound activity counts.
4. **Celebrate and replicate top performers.** Ryan Crandall (88% worked, 22 opps) and Russell Armitage (80%, 20 opps, 12 active in last 7d) — share their mix (calls, SMS, LinkedIn) and cadence; consider peer shadowing or best-practice callouts.
5. **Re-engage the 200 with zero real outbound.** Assign accountability (e.g. by SGA) and a timeline to either contact or close with reason; avoid leaving them in Planned Nurture indefinitely.
6. **Enforce stage discipline going forward.** This cohort shows 209 in Planned Nurture by stage but only 200 with zero activity — meaning ~9 opps were worked but stages weren't updated. As stage-entered timestamps are now live, require SGAs to move stages as they work so stage and activity data align.

---

# APPENDIX: Key Field Definitions

For reference, these are the key fields used in this analysis.

| Field | Source | Definition |
|-------|--------|------------|
| `RecordTypeId` | Opportunity | `012VS000009VoxrYAC` = Re-Engagement; `012Dn000000mrO3IAI` = Recruiting |
| `StageName` | Opportunity | Re-Engagement stages: Planned Nurture → Outreach → Engaged → Call Scheduled → Re-Engaged → Closed Lost |
| `OwnerId` | Opportunity | Salesforce User Id of the SGA who owns the opp |
| `Opportunity_Owner_Name__c` | Opportunity | Display name of the opp owner (SGA); may be null |
| `Created_Recruiting_Opportunity_ID__c` | Opportunity | If set, the ID of the Recruiting opp created from this Re-Engagement opp — the conversion flag |
| `Closed_Lost_Reason__c` | Opportunity | Opportunity-level closed-lost reason (picklist) |
| `Closed_Lost_Details__c` | Opportunity | Free-text details on why opp was closed lost |
| `Stage_Entered_Planned_Nurture__c` | Opportunity | Timestamp when opp entered Planned Nurture |
| `Stage_Entered_Outreach__c` | Opportunity | Timestamp when opp entered Outreach |
| `Stage_Entered_Engaged__c` | Opportunity | Timestamp when opp entered Engaged |
| `Stage_Entered_Call_Scheduled__c` | Opportunity | Timestamp when opp entered Call Scheduled |
| `Stage_Entered_Re_Engaged__c` | Opportunity | Timestamp when opp entered Re-Engaged |
| `Stage_Entered_Closed__c` | Opportunity | Timestamp when opp entered Closed Lost |
| `Task.WhatId` | Task | Links activity to the Opportunity Id |
| `Full_Opportunity_ID__c` | vw_funnel_master | Opportunity Id in the funnel view (used to join Re-Engagement opps) |
| `Full_prospect_id__c` | vw_funnel_master | Lead/Contact Id in the funnel view |
| `TOF_Stage` | vw_funnel_master | Lead-level highest stage reached: Prospect → Contacted → MQL → SQL → SQO → Joined |
| `is_contacted` | vw_funnel_master | 1 if Lead `stage_entered_contacting__c` is set |
| `is_mql` | vw_funnel_master | 1 if Lead `mql_stage_entered_ts` is set (Stage_Entered_Call_Scheduled__c; Call Scheduled stage) |
| `is_sql` | vw_funnel_master | 1 if Lead `IsConverted = TRUE` (converted to opportunity) |
| `is_sqo` | vw_funnel_master | 1 if Opportunity `LOWER(SQO_raw) = 'yes'` |
| `Conversion_Status` | vw_funnel_master | Open / Closed / Joined |
| `SGA_Owner_Name__c` | vw_funnel_master | SGA who owns the lead/opp |
| `activity_channel_group` | vw_sga_activity_performance (v2) | High-level bucket: SMS, Call, Email, LinkedIn, Meeting, Marketing, Other |
| `direction` | vw_sga_activity_performance (v2) | Inbound vs Outbound |
| **Real outbound filter** | `lead_list_touch_point_exploration_180d.md` (mandatory) | `activity_channel_group NOT IN ('Marketing', 'Other', 'Email (Engagement)')` AND `activity_channel_group IS NOT NULL` AND `direction = 'Outbound'`. All Phases 5.2–7 use this so we monitor real SGA touches, not link clicks. |

---

# APPENDIX B: Cohort Isolation

The 290 Re-Engagement opportunities in this analysis are isolated by:

```sql
WHERE IsDeleted = FALSE
  AND RecordTypeId = '012VS000009VoxrYAC'  -- Re-Engagement record type
  AND DATE(CreatedDate) = '2025-12-30'      -- Created on Dec 30, 2025
```

**Creation window**: 2025-12-30 16:37:44 UTC — 16:42:05 UTC (all within ~5 minutes, consistent with a bulk upload/creation process).

**Sample record**: Name = "[Re-Engagement] Gail Murdoch", Id = 006VS00000VL1f6YAD, StageName = Closed Lost.
