# 2025 Events Re-Engagement - Jan26: Campaign Deep Dive

> **Campaign**: 2025 Events Re-Engagement - Jan26  
> **Campaign ID**: `701VS00000bJhNYYA0`  
> **Salesforce URL**: https://savvywealth.lightning.force.com/lightning/r/Campaign/701VS00000bJhNYYA0/view  
> **Purpose**: Agentic exploration of campaign member status, SGA activity, closed-lost dispositions, and lead-working leaderboard  
> **For**: Cursor.ai with MCP connection to BigQuery  
> **Instructions**: Run each query in order using your BigQuery MCP connection. After each query, **APPEND your answer directly below the query** in this document (in the `**Answer:**` placeholder). Do NOT create a separate file. The final document should contain both questions AND answers as a complete audit trail.  
> **Views Referenced**:  
> - Funnel: `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` (local: `views/vw_funnel_master.sql`). Campaign members are accessed via `all_campaigns` ARRAY<STRUCT<id STRING, name STRING>> (from `SavvyGTMData.CampaignMember`; struct fields are `id` and `name`).  
> - Activity: `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` (local definition: `views/vw_sga_activity_performance_v2.sql`). Column names and logic in this document follow the v2 view.

### Activity definition: real outbound SGA touches only

When measuring **activities on leads** (Phases 5, 6, 7), we count only **real outbound SGA effort** — not Lemlist link clicks, opens, or other automated/inbound noise. This follows the strategy in `lead_list_touch_point_exploration_180d.md` (and v2).

**Excluded from activity counts:**
- **Email (Engagement)** — Lemlist link-click tracking (`[lemlist] Clicked on link...`); these are lead engagement events, not SGA outbound touches.
- **Marketing** — automated activities (e.g. Submitted Form, Savvy Marketing).
- **Other** — miscategorized/junk.

**Combined filter** applied to activity in all Phase 5–7 queries:

```sql
AND a.activity_channel_group NOT IN ('Marketing', 'Other', 'Email (Engagement)')
AND a.activity_channel_group IS NOT NULL
AND a.direction = 'Outbound'
```

**What counts:** Email (Campaign) sends, Email (Manual), SMS (outgoing), Calls, LinkedIn. All activity totals, sequences, pace, and "zero activity" / recency in this document use this filter so numbers reflect real SGA touches.

**Note:** The **Answer** tables in Phases 5–7 have been re-run with this filter; numbers below reflect **real outbound only**.

---

# PHASE 1: Campaign Validation & Member Census

**Goal**: Confirm the campaign exists in BQ, validate the campaign ID, and get a total count of all prospects (campaign members).

## 1.1 Validate the Campaign Record

```sql
SELECT
  Id,
  Name,
  Status,
  IsActive,
  Type,
  NumberOfLeads,
  NumberOfConvertedLeads,
  NumberOfOpportunities,
  CreatedDate
FROM `savvy-gtm-analytics.SavvyGTMData.Campaign`
WHERE Id = '701VS00000bJhNYYA0';
```

Document:
- Campaign name, status, and whether it's active
- Salesforce roll-up counts (NumberOfLeads, etc.) — these are SF-maintained roll-ups from CampaignMember

**Answer:**

| Id | Name | Status | IsActive | Type | NumberOfLeads | NumberOfConvertedLeads | NumberOfOpportunities | CreatedDate |
|----|------|--------|----------|------|---------------|------------------------|----------------------|-------------|
| 701VS00000bJhNYYA0 | 2025 Events Re-Engagement - Jan26 | Planned | true | List Upload | 1,183 | 0 | 0 | 2026-01-29 17:27:13 UTC |

**Summary:** Campaign exists. Name: **2025 Events Re-Engagement - Jan26**; Status: **Planned**; IsActive: **true**; Type: **List Upload**. SF roll-ups: **1,183** leads, 0 converted leads, 0 opportunities.

---

## 1.2 Count All Campaign Members via CampaignMember

This is the ground-truth count of how many leads are in this campaign. The `all_campaigns` array in vw_funnel_master is built from CampaignMember.

```sql
SELECT
  COUNT(*) AS total_campaign_members,
  COUNT(DISTINCT cm.LeadId) AS distinct_leads
FROM `savvy-gtm-analytics.SavvyGTMData.CampaignMember` cm
WHERE cm.IsDeleted = FALSE
  AND cm.CampaignId = '701VS00000bJhNYYA0'
  AND cm.LeadId IS NOT NULL;
```

**Answer:**

| total_campaign_members | distinct_leads |
|-----------------------|----------------|
| 1,183 | 1,183 |

**Summary:** Ground-truth count: **1,183** campaign members (all distinct leads). No duplicate lead-campaign rows.

---

## 1.3 Count Campaign Members Visible in vw_funnel_master

Confirm the funnel view sees these members via the `all_campaigns` array.

```sql
SELECT
  COUNT(*) AS funnel_rows_in_campaign
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v,
  UNNEST(IFNULL(v.all_campaigns, [])) AS camp
WHERE camp.id = '701VS00000bJhNYYA0';
```

**Answer:**

| funnel_rows_in_campaign |
|-------------------------|
| 1,183 |

**Summary:** **1,183** funnel rows in campaign — matches 1.2. `all_campaigns` is populated; campaign ID is valid.

---

# PHASE 2: Funnel Stage Distribution

**Goal**: Understand where every campaign member sits in the funnel. How many are Prospects, Contacted, MQL, SQL, SQO, Joined, and Closed Lost?

## 2.1 Full TOF_Stage Breakdown

```sql
SELECT
  v.TOF_Stage,
  v.Conversion_Status,
  COUNT(*) AS record_count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) AS pct_of_total
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v,
  UNNEST(IFNULL(v.all_campaigns, [])) AS camp
WHERE camp.id = '701VS00000bJhNYYA0'
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
- Total prospects (should match Phase 1 count)
- How many have moved to Contacted (`TOF_Stage = 'Contacted'` or higher)
- How many are still at Prospect (never contacted)
- How many are Closed vs Open vs Joined

**Answer:**

| TOF_Stage | Conversion_Status | record_count | pct_of_total |
|-----------|-------------------|--------------|--------------|
| Prospect | Open | 4 | 0.3% |
| Prospect | Closed | 150 | 12.7% |
| Contacted | Open | 42 | 3.6% |
| Contacted | Closed | 955 | 80.7% |
| MQL | Open | 2 | 0.2% |
| MQL | Closed | 30 | 2.5% |
| SQL | — | 0 | 0% |
| SQO | — | 0 | 0% |
| Joined | — | 0 | 0% |
| **Total** | | **1,183** | 100% |

**Summary:** Total **1,183** (matches Phase 1). **Contacted or higher:** 1,029 (42 + 955 + 2 + 30). **Still Prospect:** 154 (4 + 150). **Closed:** 1,135 (150 + 955 + 30). **Open:** 48 (4 + 42 + 2). **Joined:** 0.

---

## 2.2 Contacted Count (is_contacted = 1)

In `vw_funnel_master`, contacted is derived from `stage_entered_contacting__c` (Lead) via `is_contacted = 1`. Use this to validate the "moved to contacting" count (e.g. ~154 in SF campaign view).

```sql
SELECT
  COUNT(*) AS entered_contacting_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v,
  UNNEST(IFNULL(v.all_campaigns, [])) AS camp
WHERE camp.id = '701VS00000bJhNYYA0'
  AND v.is_contacted = 1;
```

**Answer:**

| entered_contacting_count |
|-------------------------|
| **1,024** |

**Summary:** **1,024** leads have been moved to contacting (is_contacted = 1). Higher than SF “~154” — likely SF campaign view uses a different definition or filter.

---

## 2.3 Contacted Records — When Did They Enter Contacting?

Uses `stage_entered_contacting__c` from `vw_funnel_master` (timestamp when lead entered Contacted stage).

```sql
SELECT
  DATE(v.stage_entered_contacting__c) AS contacted_date,
  COUNT(*) AS count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v,
  UNNEST(IFNULL(v.all_campaigns, [])) AS camp
WHERE camp.id = '701VS00000bJhNYYA0'
  AND v.is_contacted = 1
GROUP BY contacted_date
ORDER BY contacted_date;
```

Document:
- Distribution of when leads entered contacting — are they being worked steadily or in bursts?

**Answer:**

| first_contacted_date | last_contacted_date | total_contacted | distinct_dates |
|----------------------|---------------------|----------------|----------------|
| 2024-04-02 | 2026-02-10 | 1,024 | 116 |

**Summary:** Contacted dates span **2024-04-02** to **2026-02-10** across **116** distinct dates (1,024 leads). Work is spread over a long period; peak day in sample: 2025-09-17 (16 leads entered contacting).

---

# PHASE 3: Closed Lost Analysis

**Goal**: How many campaign members are Closed Lost, what were the dispositions (reasons), and who closed them?

## 3.1 Closed Lost Count and Disposition Breakdown

In `vw_funnel_master`: for lead-only closed (no conversion), disposition is `Disposition__c` (Lead). For converted leads that became opportunities and then closed lost, `Closed_Lost_Reason__c` (Opportunity) applies. Use `COALESCE(Disposition__c, Closed_Lost_Reason__c)` to cover both.

```sql
SELECT
  COALESCE(v.Disposition__c, v.Closed_Lost_Reason__c, 'No Disposition Set') AS disposition_reason,
  v.Conversion_Status,
  COUNT(*) AS closed_count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) AS pct
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v,
  UNNEST(IFNULL(v.all_campaigns, [])) AS camp
WHERE camp.id = '701VS00000bJhNYYA0'
  AND v.Conversion_Status = 'Closed'
GROUP BY disposition_reason, v.Conversion_Status
ORDER BY closed_count DESC;
```

**Answer:**

| disposition_reason | closed_count | pct |
|-------------------|--------------|-----|
| Auto-Closed by Operations | 989 | 87.1% |
| Other reasons (9 types) | 146 | 12.9% |
| **Total Closed** | **1,135** | 100% |

**Distinct dispositions (10):** Auto-Closed by Operations, No Response, Not Interested in Moving, Not a Fit, Bad Contact Info - Uncontacted, No Book, AUM / Revenue too Low, Timing, Wrong Phone Number - Contacted, Other. **No Disposition Set:** 0.

**Summary:** **1,135** campaign members are Closed. **87.1%** are **Auto-Closed by Operations**; remaining **146** have explicit dispositions (No Response, Not Interested, Not a Fit, etc.).

---

## 3.2 Closed Lost by SGA (Who Closed Them?)

```sql
SELECT
  v.SGA_Owner_Name__c AS sga_name,
  COALESCE(v.Disposition__c, v.Closed_Lost_Reason__c, 'No Disposition Set') AS disposition_reason,
  COUNT(*) AS closed_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v,
  UNNEST(IFNULL(v.all_campaigns, [])) AS camp
WHERE camp.id = '701VS00000bJhNYYA0'
  AND v.Conversion_Status = 'Closed'
GROUP BY sga_name, disposition_reason
ORDER BY sga_name, closed_count DESC;
```

Document:
- Which SGAs are closing leads out and why
- Are there SGAs closing leads with weak dispositions (e.g., "No Disposition Set")?

**Answer:**

| sga_name | closed_count |
|----------|--------------|
| Jason Ainsworth | 119 |
| Holly Huffman | 117 |
| Katie Bassford | 114 |
| Lauren George | 113 |
| Amy Waller | 92 |
| Ryan Crandall | 87 |
| Eleni Stefanopoulos | 87 |
| Channing Guyer | 78 |
| Craig Suchodolski | 75 |
| Brian O'Hara | 75 |
| (+ 5 more SGAs) | — |

**Summary:** **15 SGAs** have closed leads. Top closer: **Jason Ainsworth** (119), then Holly Huffman (117), Katie Bassford (114), Lauren George (113). No “No Disposition Set” in this campaign (0). Dispositions are set at lead level (Disposition__c).

---

## 3.3 Closed Lost Details (for Opportunity-level Closed Lost)

Uses opportunity-level fields from `vw_funnel_master`: `Closed_Lost_Reason__c`, `Closed_Lost_Details__c`, and `Stage_Entered_Closed__c` (when the opportunity entered Closed Lost).

```sql
SELECT
  v.advisor_name,
  v.SGA_Owner_Name__c AS sga_name,
  v.Closed_Lost_Reason__c,
  v.Closed_Lost_Details__c,
  DATE(v.Stage_Entered_Closed__c) AS closed_date,
  v.TOF_Stage
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v,
  UNNEST(IFNULL(v.all_campaigns, [])) AS camp
WHERE camp.id = '701VS00000bJhNYYA0'
  AND v.Closed_Lost_Reason__c IS NOT NULL
ORDER BY v.Stage_Entered_Closed__c DESC;
```

**Answer:**

| opp_level_closed_count |
|------------------------|
| **0** |

**Summary:** **0** opportunity-level closed-lost records (Closed_Lost_Reason__c IS NOT NULL). All 1,135 closed are **lead-level** (Disposition__c). No rows to list for 3.3.

---

## 3.4 Time to Auto-Close by Operations

**Goal**: For prospects with disposition "Auto-Closed by Operations", how soon after being **added to the campaign** were they auto-closed? "Added to campaign" = `CampaignMember.CreatedDate`; "auto-closed" = lead-level `lead_closed_date` in vw_funnel_master (Lead’s Stage_Entered_Closed__c). Negative days = lead was already closed when the campaign member record was created (e.g. list upload included already-closed leads).

**SQL used:**

```sql
-- Summary stats: min, max, avg, median days from add-to-campaign to auto-close
WITH auto_closed AS (
  SELECT
    cm.LeadId,
    MIN(cm.CreatedDate) AS added_to_campaign_date,
    MIN(v.lead_closed_date) AS auto_closed_date
  FROM `savvy-gtm-analytics.SavvyGTMData.CampaignMember` cm
  INNER JOIN `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
    ON v.Full_prospect_id__c = cm.LeadId
  WHERE cm.CampaignId = '701VS00000bJhNYYA0'
    AND cm.LeadId IS NOT NULL
    AND cm.IsDeleted = FALSE
    AND v.Conversion_Status = 'Closed'
    AND v.Disposition__c = 'Auto-Closed by Operations'
  GROUP BY cm.LeadId
),
with_days AS (
  SELECT
    DATE_DIFF(DATE(auto_closed_date), DATE(added_to_campaign_date), DAY) AS days_to_auto_close
  FROM auto_closed
)
SELECT
  COUNT(*) AS total_auto_closed,
  MIN(days_to_auto_close) AS min_days,
  MAX(days_to_auto_close) AS max_days,
  ROUND(AVG(days_to_auto_close), 1) AS avg_days,
  APPROX_QUANTILES(days_to_auto_close, 100)[OFFSET(50)] AS median_days
FROM with_days;
```

```sql
-- Bucket: closed before vs after being added to campaign
WITH auto_closed AS (
  SELECT
    cm.LeadId,
    MIN(cm.CreatedDate) AS added_to_campaign_date,
    MIN(v.lead_closed_date) AS auto_closed_date
  FROM `savvy-gtm-analytics.SavvyGTMData.CampaignMember` cm
  INNER JOIN `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
    ON v.Full_prospect_id__c = cm.LeadId
  WHERE cm.CampaignId = '701VS00000bJhNYYA0'
    AND cm.LeadId IS NOT NULL
    AND cm.IsDeleted = FALSE
    AND v.Conversion_Status = 'Closed'
    AND v.Disposition__c = 'Auto-Closed by Operations'
  GROUP BY cm.LeadId
),
with_days AS (
  SELECT
    DATE_DIFF(DATE(auto_closed_date), DATE(added_to_campaign_date), DAY) AS days_to_auto_close
  FROM auto_closed
)
SELECT
  CASE
    WHEN days_to_auto_close < 0 THEN 'Closed BEFORE added to campaign'
    WHEN days_to_auto_close = 0 THEN 'Same day'
    WHEN days_to_auto_close BETWEEN 1 AND 7 THEN '1-7 days after add'
    WHEN days_to_auto_close BETWEEN 8 AND 30 THEN '8-30 days after add'
    WHEN days_to_auto_close BETWEEN 31 AND 90 THEN '31-90 days after add'
    ELSE '90+ days after add'
  END AS bucket,
  COUNT(*) AS lead_count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) AS pct
FROM with_days
GROUP BY 1
ORDER BY MIN(days_to_auto_close);
```

**Answer:**

| total_auto_closed | min_days | max_days | avg_days | median_days |
|-------------------|----------|----------|----------|-------------|
| 989 | -634 | 8 | -95.8 | -89 |

| bucket | lead_count | pct |
|--------|------------|-----|
| Closed BEFORE added to campaign | 965 | 97.6% |
| 1-7 days after add | 23 | 2.3% |
| 8-30 days after add | 1 | 0.1% |

**Summary:** **989** leads are "Auto-Closed by Operations". For **97.6%** (965), the lead was **already closed before** the campaign member record was created (negative days: closed date earlier than CampaignMember.CreatedDate). So the campaign list likely included many leads who were closed before being added to this campaign (e.g. bulk upload of a list that already contained closed leads). Only **24** (2.4%) were closed on or after the date they were added: **23** within **1–7 days** after add, **1** in **8–30 days** after add. **Median** days from add to auto-close is **-89** (closed ~89 days before the campaign member record was created). So the vast majority of "auto-closed by operations" in this campaign were closed before they were added to the campaign, not shortly after.

---

# PHASE 4: SGA Ownership & Leaderboard (ALL SGAs)

**Goal**: Build a complete picture of every SGA assigned prospects in this campaign — including those with 0 activity. This is the accountability leaderboard.

## 4.1 Full SGA Assignment Leaderboard

This query shows EVERY SGA_Owner_Name__c with prospects in this campaign, their total assigned count, and how many they've moved to each stage. SGAs with 0 contacted leads will show up here.

```sql
SELECT
  COALESCE(v.SGA_Owner_Name__c, 'UNASSIGNED') AS sga_name,
  COUNT(*) AS total_assigned,
  SUM(CASE WHEN v.is_contacted = 1 THEN 1 ELSE 0 END) AS contacted,
  SUM(CASE WHEN v.is_mql = 1 THEN 1 ELSE 0 END) AS mql,
  SUM(CASE WHEN v.is_sql = 1 THEN 1 ELSE 0 END) AS sql_converted,
  SUM(CASE WHEN v.is_sqo = 1 THEN 1 ELSE 0 END) AS sqo,
  SUM(CASE WHEN v.is_joined = 1 THEN 1 ELSE 0 END) AS joined,
  SUM(CASE WHEN v.Conversion_Status = 'Closed' THEN 1 ELSE 0 END) AS closed_lost,
  SUM(CASE WHEN v.Conversion_Status = 'Open' AND v.is_contacted = 0 THEN 1 ELSE 0 END) AS open_not_contacted,
  ROUND(
    SAFE_DIVIDE(
      SUM(CASE WHEN v.is_contacted = 1 THEN 1 ELSE 0 END),
      COUNT(*)
    ) * 100, 1
  ) AS pct_contacted
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v,
  UNNEST(IFNULL(v.all_campaigns, [])) AS camp
WHERE camp.id = '701VS00000bJhNYYA0'
GROUP BY sga_name
ORDER BY total_assigned DESC;
```

Document:
- **Every SGA** that has prospects in this campaign
- Who has the most assigned? Who has contacted the most?
- Who has open/not-contacted leads sitting idle?
- `pct_contacted` = contacting rate per SGA (accountability metric)

**Answer:**

| sga_name | total_assigned | contacted | closed_lost | open_not_contacted | pct_contacted |
|----------|----------------|-----------|------------|--------------------|---------------|
| Jason Ainsworth | 120 | 102 | 119 | 0 | 85.0% |
| Holly Huffman | 118 | 105 | 117 | 0 | 89.0% |
| Lauren George | 117 | 102 | 113 | 0 | 87.2% |
| Katie Bassford | 115 | 105 | 114 | 0 | 91.3% |
| Eleni Stefanopoulos | 92 | 81 | 87 | 2 | 88.0% |
| Amy Waller | 92 | 82 | 92 | 0 | 89.1% |
| Russell Armitage | 88 | 80 | 61 | 1 | 90.9% |
| Ryan Crandall | 87 | 73 | 87 | 0 | 83.9% |
| Craig Suchodolski | 81 | 65 | 75 | 0 | 80.2% |
| Channing Guyer | 78 | 60 | 78 | 0 | 76.9% |
| Brian O'Hara | 75 | 58 | 75 | 0 | 77.3% |
| Marisa Saucedo | 74 | 74 | 74 | 0 | 100% |
| Savvy Operations | 23 | 18 | 23 | 0 | 78.3% |
| Helen Kamens | 13 | 11 | 13 | 0 | 84.6% |
| Perry Kalmeta | 10 | 8 | 8 | 0 | 80.0% |

**Summary:** **15 SGAs** have prospects. Most assigned: **Jason Ainsworth** (120), Holly Huffman (118), Lauren George (117). Highest pct_contacted: **Marisa Saucedo** (100%). **Open not contacted:** Eleni (2), Russell (1). **Total assigned:** 1,183.

---

## 4.2 SGAs Not Working Their Leads (Zero Contacted)

Quick filter to surface SGAs who have been assigned leads but haven't moved ANY to contacting.

```sql
SELECT
  COALESCE(v.SGA_Owner_Name__c, 'UNASSIGNED') AS sga_name,
  COUNT(*) AS total_assigned,
  SUM(CASE WHEN v.is_contacted = 1 THEN 1 ELSE 0 END) AS contacted,
  SUM(CASE WHEN v.Conversion_Status = 'Closed' THEN 1 ELSE 0 END) AS closed_lost
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v,
  UNNEST(IFNULL(v.all_campaigns, [])) AS camp
WHERE camp.id = '701VS00000bJhNYYA0'
GROUP BY sga_name
HAVING contacted = 0
ORDER BY total_assigned DESC;
```

**Answer:**

| sgas_zero_contacted |
|---------------------|
| **0** |

**Summary:** **0** SGAs with zero contacted. Every SGA has moved at least one lead to contacting. No "not working" SGAs.

---

# PHASE 5: Activity Analysis on Contacted Leads

**Goal**: For the ~154 leads that entered contacting, what does their activity look like? Average activities per lead, activity channels, pace, and sequence.

## 5.1 Total Activity Count on Contacted Campaign Members

Join the activity view to the funnel view for campaign members who entered contacting.

```sql
WITH campaign_contacted AS (
  SELECT DISTINCT
    v.Full_prospect_id__c,
    v.SGA_Owner_Name__c,
    v.advisor_name,
    DATE(v.stage_entered_contacting__c) AS contacted_date
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v,
    UNNEST(IFNULL(v.all_campaigns, [])) AS camp
  WHERE camp.id = '701VS00000bJhNYYA0'
    AND v.is_contacted = 1
    AND v.Full_prospect_id__c IS NOT NULL
)
SELECT
  COUNT(DISTINCT cc.Full_prospect_id__c) AS contacted_leads,
  COUNT(a.task_id) AS total_activities,
  ROUND(SAFE_DIVIDE(COUNT(a.task_id), COUNT(DISTINCT cc.Full_prospect_id__c)), 1) AS avg_activities_per_lead
FROM campaign_contacted cc
LEFT JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` a
  ON a.Full_prospect_id__c = cc.Full_prospect_id__c
  AND a.activity_channel_group NOT IN ('Marketing', 'Other', 'Email (Engagement)')
  AND a.activity_channel_group IS NOT NULL
  AND a.direction = 'Outbound';
```

Document:
- Total **real outbound** activities across contacted campaign members (excludes Lemlist link clicks, Marketing, Other per 180d methodology).
- Average activities per contacted lead.
- Leads with 0 real outbound activities after entering contacting (possible data issue).

**Answer:**

| contacted_leads | total_activities | avg_activities_per_lead |
|-----------------|------------------|-------------------------|
| 1,024 | 6,656 | 6.5 |

**Summary:** **1,024** contacted leads have **6,656** real outbound activities (**6.5** avg per lead). Excludes Lemlist link clicks, Marketing, Other per 180d methodology.

---

## 5.2 Activity Breakdown by Channel

What types of outreach are SGAs doing on these campaign leads?

```sql
WITH campaign_contacted AS (
  SELECT DISTINCT v.Full_prospect_id__c
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v,
    UNNEST(IFNULL(v.all_campaigns, [])) AS camp
  WHERE camp.id = '701VS00000bJhNYYA0'
    AND v.is_contacted = 1
    AND v.Full_prospect_id__c IS NOT NULL
)
SELECT
  a.activity_channel,
  a.direction,
  COUNT(*) AS activity_count,
  COUNT(DISTINCT a.Full_prospect_id__c) AS leads_touched,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) AS pct_of_total
FROM campaign_contacted cc
INNER JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` a
  ON a.Full_prospect_id__c = cc.Full_prospect_id__c
WHERE a.activity_channel_group NOT IN ('Marketing', 'Other', 'Email (Engagement)')
  AND a.activity_channel_group IS NOT NULL
  AND a.direction = 'Outbound'
GROUP BY a.activity_channel, a.direction
ORDER BY activity_count DESC;
```

Document:
- Channel mix (real outbound only): Calls vs SMS vs Email vs LinkedIn
- Inbound vs Outbound ratio
- Are SGAs multi-channel or single-channel in their approach?

**Answer:**

| activity_channel | direction | activity_count | pct_of_total |
|------------------|-----------|----------------|--------------|
| SMS | Outbound | 2,741 | 41.2% |
| Email (Campaign) | Outbound | 2,137 | 32.1% |
| LinkedIn | Outbound | 1,459 | 21.9% |
| Email (Manual) | Outbound | 237 | 3.6% |
| Call | Outbound | 82 | 1.2% |

**Summary:** **Real outbound only** (no Email (Engagement), Marketing, Other). **SMS** 41.2%, **Email (Campaign)** 32.1%, **LinkedIn** 21.9%, **Email (Manual)** 3.6%, **Call** 1.2%. All outbound; SGAs use multiple channels.

---

## 5.3 Activity Per Lead by SGA (Who Is Hustling?)

```sql
WITH campaign_contacted AS (
  SELECT DISTINCT
    v.Full_prospect_id__c,
    v.SGA_Owner_Name__c
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v,
    UNNEST(IFNULL(v.all_campaigns, [])) AS camp
  WHERE camp.id = '701VS00000bJhNYYA0'
    AND v.is_contacted = 1
    AND v.Full_prospect_id__c IS NOT NULL
)
SELECT
  cc.SGA_Owner_Name__c AS sga_name,
  COUNT(DISTINCT cc.Full_prospect_id__c) AS contacted_leads,
  COUNT(a.task_id) AS total_activities,
  ROUND(SAFE_DIVIDE(COUNT(a.task_id), COUNT(DISTINCT cc.Full_prospect_id__c)), 1) AS avg_activities_per_lead,
  SUM(CASE WHEN a.activity_channel_group = 'Call' AND a.direction = 'Outbound' THEN 1 ELSE 0 END) AS outbound_calls,
  SUM(CASE WHEN a.activity_channel_group = 'SMS' AND a.direction = 'Outbound' THEN 1 ELSE 0 END) AS outbound_sms,
  SUM(CASE WHEN a.activity_channel_group = 'Email' THEN 1 ELSE 0 END) AS emails,
  SUM(CASE WHEN a.activity_channel_group = 'LinkedIn' THEN 1 ELSE 0 END) AS linkedin,
  SUM(CASE WHEN a.is_meaningful_connect = 1 THEN 1 ELSE 0 END) AS meaningful_connects
FROM campaign_contacted cc
LEFT JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` a
  ON a.Full_prospect_id__c = cc.Full_prospect_id__c
  AND a.activity_channel_group NOT IN ('Marketing', 'Other', 'Email (Engagement)')
  AND a.activity_channel_group IS NOT NULL
  AND a.direction = 'Outbound'
GROUP BY cc.SGA_Owner_Name__c
ORDER BY total_activities DESC;
```

Document:
- SGA-level activity leaderboard on contacted campaign leads (real outbound touches only)
- Channel mix per SGA (calls, SMS, email, LinkedIn)
- Meaningful connects (answered calls, incoming SMS) — measures quality, not just volume

**Answer:**

| sga_name | contacted_leads | total_activities | avg_activities_per_lead | outbound_calls | outbound_sms | emails | meaningful_connects |
|----------|-----------------|------------------|-------------------------|----------------|--------------|--------|---------------------|
| Katie Bassford | 105 | 712 | 6.8 | 5 | 261 | 217 | 3 |
| Jason Ainsworth | 102 | 683 | 6.7 | 5 | 333 | 167 | 0 |
| Lauren George | 102 | 652 | 6.4 | 6 | 255 | 198 | 5 |
| Holly Huffman | 105 | 636 | 6.1 | 5 | 263 | 175 | 4 |
| Marisa Saucedo | 74 | 594 | 8.0 | 1 | 152 | 372 | 1 |
| Amy Waller | 82 | 557 | 6.8 | 3 | 242 | 190 | 0 |
| Russell Armitage | 80 | 544 | 6.8 | 11 | 245 | 183 | 5 |
| Channing Guyer | 60 | 480 | 8.0 | 1 | 133 | 294 | 0 |
| Brian O'Hara | 58 | 437 | 7.5 | 0 | 115 | 267 | 0 |
| Ryan Crandall | 73 | 383 | 5.2 | 1 | 211 | 57 | 0 |
| Craig Suchodolski | 65 | 347 | 5.3 | 7 | 132 | 122 | 4 |
| Eleni Stefanopoulos | 81 | 288 | 3.6 | 12 | 258 | 7 | 1 |
| Savvy Operations | 18 | 167 | 9.3 | 10 | 75 | 60 | 9 |
| Helen Kamens | 11 | 99 | 9.0 | 4 | 39 | 41 | 3 |
| Perry Kalmeta | 8 | 77 | 9.6 | 11 | 27 | 24 | 7 |

**Summary:** **Real outbound only.** Top by volume: **Katie Bassford** (712), Jason Ainsworth (683), Lauren George (652). Meaningful connects (inbound/answered) lower when excluding engagement: Savvy Operations (9), Perry (7), Lauren (5), Russell (5). Eleni: 288 activities, 3.6 avg, call/SMS-heavy (12 calls, 258 SMS, 7 emails).

---

## 5.4 Activity Pace: Days Between First Activity and Last Activity

Understanding velocity — how quickly are SGAs working through their sequences?

```sql
WITH campaign_contacted AS (
  SELECT DISTINCT
    v.Full_prospect_id__c,
    v.SGA_Owner_Name__c,
    DATE(v.stage_entered_contacting__c) AS contacted_date
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v,
    UNNEST(IFNULL(v.all_campaigns, [])) AS camp
  WHERE camp.id = '701VS00000bJhNYYA0'
    AND v.is_contacted = 1
    AND v.Full_prospect_id__c IS NOT NULL
),
activity_windows AS (
  SELECT
    cc.Full_prospect_id__c,
    cc.SGA_Owner_Name__c,
    cc.contacted_date,
    MIN(a.task_activity_date) AS first_activity_date,
    MAX(a.task_activity_date) AS last_activity_date,
    COUNT(a.task_id) AS activity_count,
    DATE_DIFF(MAX(a.task_activity_date), MIN(a.task_activity_date), DAY) AS activity_span_days
  FROM campaign_contacted cc
  LEFT JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` a
    ON a.Full_prospect_id__c = cc.Full_prospect_id__c
    AND a.activity_channel_group NOT IN ('Marketing', 'Other', 'Email (Engagement)')
    AND a.activity_channel_group IS NOT NULL
    AND a.direction = 'Outbound'
  GROUP BY cc.Full_prospect_id__c, cc.SGA_Owner_Name__c, cc.contacted_date
)
SELECT
  SGA_Owner_Name__c AS sga_name,
  COUNT(*) AS leads,
  ROUND(AVG(activity_count), 1) AS avg_activities,
  ROUND(AVG(activity_span_days), 1) AS avg_span_days,
  ROUND(AVG(DATE_DIFF(first_activity_date, contacted_date, DAY)), 1) AS avg_days_to_first_activity,
  ROUND(SAFE_DIVIDE(AVG(activity_count), NULLIF(AVG(activity_span_days), 0)), 2) AS avg_activities_per_day
FROM activity_windows
GROUP BY SGA_Owner_Name__c
ORDER BY avg_activities DESC;
```

Document:
- Average span of **real outbound** activity per lead (multi-day sequences or one-and-done?)
- Days from contacted date to first activity (response time)
- Activities per day (intensity)

**Answer:**

| sga_name | leads | avg_activities | avg_span_days | avg_days_to_first_activity | avg_activities_per_day |
|----------|-------|----------------|----------------|----------------------------|------------------------|
| Perry Kalmeta | 8 | 9.6 | 197.6 | -10.8 | 0.05 |
| Savvy Operations | 18 | 9.3 | 175.4 | 3.3 | 0.05 |
| Helen Kamens | 11 | 9.0 | 197.3 | 6.0 | 0.05 |
| Channing Guyer | 60 | 8.0 | 163.7 | 9.8 | 0.05 |
| Marisa Saucedo | 74 | 8.0 | 161.2 | -182.5 | 0.05 |
| Brian O'Hara | 58 | 7.5 | 153.5 | -3.0 | 0.05 |
| Katie Bassford | 105 | 6.8 | 188.5 | 75.0 | 0.04 |
| Amy Waller | 82 | 6.8 | 160.2 | -25.3 | 0.04 |
| Russell Armitage | 80 | 6.8 | 148.2 | -22.7 | 0.05 |
| Jason Ainsworth | 102 | 6.7 | 195.4 | -63.0 | 0.03 |
| Lauren George | 102 | 6.4 | 187.4 | 8.3 | 0.03 |
| Holly Huffman | 105 | 6.1 | 177.0 | 0.9 | 0.03 |
| Craig Suchodolski | 65 | 5.3 | 141.4 | 52.5 | 0.04 |
| Ryan Crandall | 73 | 5.2 | 155.3 | -4.6 | 0.03 |
| Eleni Stefanopoulos | 81 | 3.6 | 34.5 | -2.3 | 0.10 |

**Summary:** **Real outbound only.** Multi-day sequences (avg span **34–198 days**). Negative *avg_days_to_first_activity* = activity before *stage_entered_contacting__c* (recycled leads). **Eleni** shortest span (34.5 days), highest intensity (0.10/day).

---

## 5.5 Activity Sequence Pattern (First 5 Touches)

What does the typical outreach sequence look like? What channels are used in what order? Uses **real outbound touches only** (excludes Marketing, Other, Email (Engagement) per 180d); `task_created_date_utc` for ordering.

```sql
WITH campaign_contacted AS (
  SELECT DISTINCT v.Full_prospect_id__c
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v,
    UNNEST(IFNULL(v.all_campaigns, [])) AS camp
  WHERE camp.id = '701VS00000bJhNYYA0'
    AND v.is_contacted = 1
    AND v.Full_prospect_id__c IS NOT NULL
),
sequenced AS (
  SELECT
    a.Full_prospect_id__c,
    a.activity_channel,
    a.activity_channel_group,
    a.direction,
    a.task_activity_date,
    ROW_NUMBER() OVER (
      PARTITION BY a.Full_prospect_id__c
      ORDER BY a.task_created_date_utc ASC
    ) AS touch_number
  FROM campaign_contacted cc
  INNER JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` a
    ON a.Full_prospect_id__c = cc.Full_prospect_id__c
  WHERE a.activity_channel_group NOT IN ('Marketing', 'Other', 'Email (Engagement)')
    AND a.activity_channel_group IS NOT NULL
    AND a.direction = 'Outbound'
)
SELECT
  touch_number,
  activity_channel_group AS channel,
  COUNT(*) AS count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (PARTITION BY touch_number), 1) AS pct
FROM sequenced
WHERE touch_number <= 5
GROUP BY touch_number, activity_channel_group
ORDER BY touch_number, count DESC;
```

Document:
- What channel is used for touch 1, 2, 3, 4, 5? (real outbound only)
- Are SGAs following a structured sequence (call → SMS → email) or random?
- This tells us if there's a consistent playbook being followed

**Answer:**

| touch_number | channel | count | pct |
|--------------|---------|-------|-----|
| 1 | SMS | 606 | 59.8% |
| 1 | Email | 233 | 23.0% |
| 1 | LinkedIn | 149 | 14.7% |
| 1 | Call | 25 | 2.5% |
| 2 | SMS | 676 | 67.3% |
| 2 | Email | 212 | 21.1% |
| 2 | LinkedIn | 110 | 11.0% |
| 2 | Call | 6 | 0.6% |
| 3 | SMS | 559 | 57.8% |
| 3 | Email | 251 | 26.0% |
| 3 | LinkedIn | 151 | 15.6% |
| 3 | Call | 6 | 0.6% |
| 4 | SMS | 347 | 38.0% |
| 4 | Email | 305 | 33.4% |
| 4 | LinkedIn | 244 | 26.7% |
| 4 | Call | 18 | 2.0% |
| 5 | Email | 290 | 37.1% |
| 5 | LinkedIn | 270 | 34.6% |
| 5 | SMS | 211 | 27.0% |
| 5 | Call | 10 | 1.3% |

**Summary:** **Real outbound only.** Touch 1–3: SMS 58–67%, then Email, LinkedIn; calls rare. Touch 4–5: mix shifts to Email/LinkedIn (33–37% each). Consistent playbook: **SMS first**, then Email/LinkedIn; not call-first.

---

# PHASE 6: Full SGA Activity Leaderboard (ALL Campaign Members, Not Just Contacted)

**Goal**: Expand beyond contacted leads. For EVERY prospect in this campaign, count activities — including those with 0 activities. This is the definitive "who is working leads and who isn't" view.

## 6.1 Complete SGA Leaderboard — All Campaign Members with Activity Counts

```sql
WITH campaign_members AS (
  SELECT DISTINCT
    v.Full_prospect_id__c,
    v.advisor_name,
    COALESCE(v.SGA_Owner_Name__c, 'UNASSIGNED') AS sga_name,
    v.TOF_Stage,
    v.Conversion_Status,
    v.is_contacted
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v,
    UNNEST(IFNULL(v.all_campaigns, [])) AS camp
  WHERE camp.id = '701VS00000bJhNYYA0'
),
member_activities AS (
  SELECT
    cm.Full_prospect_id__c,
    cm.sga_name,
    cm.TOF_Stage,
    cm.Conversion_Status,
    cm.is_contacted,
    COUNT(a.task_id) AS activity_count,
    SUM(CASE WHEN a.direction = 'Outbound' AND a.activity_channel_group NOT IN ('Marketing', 'Other', 'Email (Engagement)') AND a.activity_channel_group IS NOT NULL THEN 1 ELSE 0 END) AS outbound_real,
    SUM(CASE WHEN a.is_meaningful_connect = 1 THEN 1 ELSE 0 END) AS meaningful_connects,
    MIN(a.task_activity_date) AS first_activity,
    MAX(a.task_activity_date) AS last_activity
  FROM campaign_members cm
  LEFT JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` a
    ON a.Full_prospect_id__c = cm.Full_prospect_id__c
    AND a.activity_channel_group NOT IN ('Marketing', 'Other', 'Email (Engagement)')
    AND a.activity_channel_group IS NOT NULL
    AND a.direction = 'Outbound'
  GROUP BY cm.Full_prospect_id__c, cm.sga_name, cm.TOF_Stage, cm.Conversion_Status, cm.is_contacted
)
SELECT
  sga_name,
  COUNT(*) AS total_assigned,
  SUM(is_contacted) AS contacted,
  SUM(CASE WHEN Conversion_Status = 'Closed' THEN 1 ELSE 0 END) AS closed_lost,
  SUM(CASE WHEN Conversion_Status = 'Open' AND is_contacted = 0 THEN 1 ELSE 0 END) AS open_untouched,
  SUM(activity_count) AS total_activities,
  SUM(outbound_real) AS total_outbound_sga,
  SUM(meaningful_connects) AS total_meaningful_connects,
  ROUND(SAFE_DIVIDE(SUM(activity_count), COUNT(*)), 1) AS avg_activities_per_lead,
  ROUND(SAFE_DIVIDE(SUM(outbound_real), COUNT(*)), 1) AS avg_outbound_per_lead,
  SUM(CASE WHEN activity_count = 0 THEN 1 ELSE 0 END) AS leads_with_zero_activities,
  ROUND(
    SAFE_DIVIDE(
      SUM(CASE WHEN activity_count = 0 THEN 1 ELSE 0 END),
      COUNT(*)
    ) * 100, 1
  ) AS pct_zero_activity
FROM member_activities
GROUP BY sga_name
ORDER BY total_assigned DESC;
```

Document:
- **Definitive leaderboard**: Every SGA with their full picture
- `open_untouched` = leads assigned but never contacted and still open — biggest opportunity
- `leads_with_zero_activities` = no **real outbound** touches (excludes Marketing, Other, Email (Engagement) per 180d) — red flag
- `avg_outbound_per_lead` = SGA effort intensity (real outbound only)

**Answer:**

| sga_name | total_assigned | contacted | closed_lost | open_untouched | total_activities | leads_with_zero_activities | pct_zero_activity |
|----------|----------------|-----------|-------------|----------------|------------------|----------------------------|-------------------|
| Jason Ainsworth | 120 | 102 | 119 | 0 | 732 | 2 | 1.7% |
| Holly Huffman | 118 | 105 | 117 | 0 | 667 | 5 | 4.2% |
| Lauren George | 117 | 102 | 113 | 0 | 694 | 1 | 0.9% |
| Katie Bassford | 115 | 105 | 114 | 0 | 741 | 2 | 1.7% |
| Eleni Stefanopoulos | 92 | 81 | 87 | **2** | 290 | **17** | **18.5%** |
| Amy Waller | 92 | 82 | 92 | 0 | 609 | 0 | 0% |
| Russell Armitage | 88 | 80 | 61 | 1 | 587 | 0 | 0% |
| Ryan Crandall | 87 | 73 | 87 | 0 | 435 | 1 | 1.1% |
| Craig Suchodolski | 81 | 65 | 75 | 0 | 401 | 0 | 0% |
| Channing Guyer | 78 | 60 | 78 | 0 | 587 | 0 | 0% |
| Brian O'Hara | 75 | 58 | 75 | 0 | 531 | 0 | 0% |
| Marisa Saucedo | 74 | 74 | 74 | 0 | 594 | 0 | 0% |
| Savvy Operations | 23 | 18 | 23 | 0 | 190 | 1 | 4.3% |
| Helen Kamens | 13 | 11 | 13 | 0 | 116 | 0 | 0% |
| Perry Kalmeta | 10 | 8 | 8 | 0 | 89 | 0 | 0% |

**Summary:** **Real outbound only.** Open untouched: Eleni (2), Russell (1). **Zero real-outbound activities:** **Eleni 17 (18.5%)** — red flag; Holly 5; Jason 2; Katie 2; Lauren 1; Ryan 1; Savvy Operations 1. Katie most activities (741); Eleni lowest (290) and highest pct_zero_activity.

---

## 6.2 Leads with Zero Activities (Untouched List by SGA)

```sql
WITH campaign_members AS (
  SELECT DISTINCT
    v.Full_prospect_id__c,
    v.advisor_name,
    COALESCE(v.SGA_Owner_Name__c, 'UNASSIGNED') AS sga_name,
    v.TOF_Stage,
    v.Conversion_Status
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v,
    UNNEST(IFNULL(v.all_campaigns, [])) AS camp
  WHERE camp.id = '701VS00000bJhNYYA0'
),
with_activity_flag AS (
  SELECT
    cm.*,
    COUNT(a.task_id) AS activity_count
  FROM campaign_members cm
  LEFT JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` a
    ON a.Full_prospect_id__c = cm.Full_prospect_id__c
    AND a.activity_channel_group NOT IN ('Marketing', 'Other', 'Email (Engagement)')
    AND a.activity_channel_group IS NOT NULL
    AND a.direction = 'Outbound'
  GROUP BY cm.Full_prospect_id__c, cm.advisor_name, cm.sga_name, cm.TOF_Stage, cm.Conversion_Status
)
SELECT
  sga_name,
  COUNT(*) AS zero_activity_leads,
  STRING_AGG(advisor_name, ', ' ORDER BY advisor_name LIMIT 10) AS sample_names
FROM with_activity_flag
WHERE activity_count = 0
  AND Conversion_Status = 'Open'
GROUP BY sga_name
ORDER BY zero_activity_leads DESC;
```

Document:
- Which SGAs have the most open leads with **zero real outbound** activities?
- Sample advisor names for spot-checking in Salesforce

**Answer:**

| sga_name | zero_activity_leads (open only) | sample_names |
|----------|---------------------------------|--------------|
| Eleni Stefanopoulos | **3** | Mark Genereux, Ruben Cisneros, Steven Resler |

**Summary:** **3** open leads have **zero real outbound** activities, all assigned to **Eleni Stefanopoulos**. **1 SGA** has open zero-activity leads. Sample names: Mark Genereux, Ruben Cisneros, Steven Resler.

---

# PHASE 7: Time-to-Contact & Recency Analysis

**Goal**: How recently are leads being worked? Are there stale leads that need re-engagement?

## 7.1 Recency of Last Activity on Open Leads

```sql
WITH campaign_open AS (
  SELECT DISTINCT
    v.Full_prospect_id__c,
    COALESCE(v.SGA_Owner_Name__c, 'UNASSIGNED') AS sga_name
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v,
    UNNEST(IFNULL(v.all_campaigns, [])) AS camp
  WHERE camp.id = '701VS00000bJhNYYA0'
    AND v.Conversion_Status = 'Open'
    AND v.Full_prospect_id__c IS NOT NULL
),
last_touch AS (
  SELECT
    co.Full_prospect_id__c,
    co.sga_name,
    MAX(a.task_activity_date) AS last_activity_date
  FROM campaign_open co
  LEFT JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` a
    ON a.Full_prospect_id__c = co.Full_prospect_id__c
    AND a.activity_channel_group NOT IN ('Marketing', 'Other', 'Email (Engagement)')
    AND a.activity_channel_group IS NOT NULL
    AND a.direction = 'Outbound'
  GROUP BY co.Full_prospect_id__c, co.sga_name
)
SELECT
  sga_name,
  COUNT(*) AS open_leads,
  SUM(CASE WHEN last_activity_date IS NULL THEN 1 ELSE 0 END) AS never_touched,
  SUM(CASE WHEN DATE_DIFF(CURRENT_DATE(), last_activity_date, DAY) <= 7 THEN 1 ELSE 0 END) AS active_last_7d,
  SUM(CASE WHEN DATE_DIFF(CURRENT_DATE(), last_activity_date, DAY) BETWEEN 8 AND 14 THEN 1 ELSE 0 END) AS active_8_14d,
  SUM(CASE WHEN DATE_DIFF(CURRENT_DATE(), last_activity_date, DAY) BETWEEN 15 AND 30 THEN 1 ELSE 0 END) AS active_15_30d,
  SUM(CASE WHEN DATE_DIFF(CURRENT_DATE(), last_activity_date, DAY) > 30 THEN 1 ELSE 0 END) AS stale_over_30d
FROM last_touch
GROUP BY sga_name
ORDER BY open_leads DESC;
```

Document:
- `never_touched` = open leads with no **real outbound** activity
- `stale_over_30d` = last real outbound touch 30+ days ago — going cold
- `active_last_7d` = real outbound touch in last 7 days

**Answer:**

| sga_name | open_leads | never_touched | active_last_7d | active_8_14d | active_15_30d | stale_over_30d |
|----------|------------|---------------|---------------|--------------|---------------|-----------------|
| Russell Armitage | 27 | 0 | 25 | 0 | 0 | 2 |
| Craig Suchodolski | 6 | 0 | 6 | 0 | 0 | 0 |
| Eleni Stefanopoulos | 5 | **3** | 0 | 0 | 0 | 2 |
| Lauren George | 4 | 0 | 3 | 0 | 0 | 1 |
| Perry Kalmeta | 2 | 0 | 2 | 0 | 0 | 0 |
| Holly Huffman | 1 | 0 | 1 | 0 | 0 | 0 |
| Katie Bassford | 1 | 0 | 1 | 0 | 0 | 0 |
| Jason Ainsworth | 1 | 0 | 1 | 0 | 0 | 0 |

**Summary:** **48** total open leads. **Never touched** (no real outbound): **3** (all Eleni). **Stale 30+ days:** **5** (Russell 2, Eleni 2, Lauren 1). **Active last 7d:** **39** (Russell 25, Craig 6, others 8). Russell has most open pipeline (27); 25/27 active in last 7d.

---

# PHASE 8: Summary & Coaching Insights

**Goal**: Synthesize findings into actionable coaching points.

## 8.1 Final Summary

After completing all phases above, Cursor should write a summary here answering these questions:

1. **Total Campaign Size**: How many prospects are in this campaign?
2. **Contacting Rate**: What percentage have been moved to contacting? (Target: we saw 154)
3. **Closed Lost**: How many were closed lost? What are the top 3 disposition reasons?
4. **Top Performers**: Which SGAs have the highest contact rate and activity volume?
5. **Underperformers**: Which SGAs have the most assigned leads with zero or minimal activity?
6. **Activity Quality**: What's the average number of activities per contacted lead? What's the channel mix?
7. **Sequence Insights**: Is there a consistent outreach sequence? What does the typical first 5-touch look like?
8. **Staleness Risk**: How many open leads have gone 30+ days without activity?
9. **Actionable Recommendations**: Based on the data, what 3-5 specific coaching actions should we take?

**Answer:**

**1. Total Campaign Size**  
**1,183** prospects are in the campaign (CampaignMember and vw_funnel_master both show 1,183). Campaign: 2025 Events Re-Engagement - Jan26 (ID: 701VS00000bJhNYYA0), Status: Planned, Type: List Upload.

**2. Contacting Rate**  
**86.5%** (1,024 of 1,183) have been moved to contacting (is_contacted = 1). This is higher than the SF “~154” target mentioned in the doc — the doc target may refer to a different campaign view or date filter. In our data, 159 are still Prospect (4 Open, 150 Closed, plus 2 MQL Open, 30 MQL Closed).

**3. Closed Lost**  
**1,135** campaign members are Closed. **Top 3 disposition reasons:** (1) **Auto-Closed by Operations** — 989 (87.1%); (2) **No Response** and other explicit reasons — 146 total (12.9%), including No Response, Not Interested in Moving, Not a Fit, Bad Contact Info - Uncontacted, No Book, AUM / Revenue too Low, Timing, Wrong Phone Number - Contacted, Other. All closed are lead-level (Disposition__c); 0 opportunity-level (Closed_Lost_Reason__c). **15 SGAs** closed leads; top closers: Jason Ainsworth (119), Holly Huffman (117), Katie Bassford (114), Lauren George (113).

**4. Top Performers**  
- **Contact rate:** Marisa Saucedo 100% (74/74 contacted); Katie Bassford 91.3%; Holly Huffman 89.0%; Eleni Stefanopoulos 88.0%; Amy Waller 89.1%.  
- **Activity volume (contacted leads, real outbound only):** Katie Bassford 712 activities (6.8/lead), Jason Ainsworth 683 (6.7/lead), Lauren George 652 (6.4/lead), Holly Huffman 636 (6.1/lead).  
- **Meaningful connects (real outbound context):** Savvy Operations 9, Perry Kalmeta 7, Lauren George 5, Russell Armitage 5.  
- **Full campaign activity (Phase 6, real outbound):** Katie 741 total activities, Lauren 694, Jason 732; Eleni lowest (290) and highest % zero-activity (18.5%).

**5. Underperformers**  
- **Eleni Stefanopoulos:** 17 leads with zero **real outbound** activities (18.5% of 92 assigned), 2 open untouched, 3 open leads with zero real outbound (sample: Mark Genereux, Ruben Cisneros, Steven Resler). Lowest total real-outbound activities (290) and lowest avg per lead (3.6).  
- **Holly Huffman:** 5 leads with zero real outbound (4.2%).  
- **Jason Ainsworth, Katie Bassford:** 2 each (1.7%).  
- **Russell Armitage:** 1 open untouched lead.  
No SGA has “zero contacted” (every SGA has moved at least one lead to contacting).

**6. Activity Quality**  
- **Avg real outbound activities per contacted lead:** **6.5** (6,656 activities / 1,024 contacted leads). Excludes Lemlist link clicks, Marketing, Other per 180d methodology.  
- **Channel mix (real outbound only):** SMS 41.2%; Email (Campaign) 32.1%; LinkedIn 21.9%; Email (Manual) 3.6%; Call 1.2%. SGAs are multi-channel (SMS-first, then email/LinkedIn; calls rare).

**7. Sequence Insights**  
Yes — **consistent playbook (real outbound only).** Touch 1: SMS 59.8%, Email 23.0%, LinkedIn 14.7%, Call 2.5%. Touch 2–3: SMS 58–67%, then Email, then LinkedIn. Touch 4–5: mix shifts to Email/LinkedIn (33–37% each), SMS 27–38%. **Typical first 5 touches:** SMS → SMS or Email → SMS/Email/LinkedIn → more Email/LinkedIn → Email/LinkedIn. Not call-first; SMS-heavy early, then multi-channel.

**8. Staleness Risk**  
**5** open leads have gone **30+ days** without activity: Russell Armitage 2, Eleni Stefanopoulos 2, Lauren George 1. **3** open leads are **never touched** (all Eleni). **48** total open leads; **39** had activity in the last 7 days (Russell 25, Craig 6, others 8).

**9. Actionable Recommendations**  
1. **Eleni Stefanopoulos — zero-activity and untouched leads:** Review the 3 open leads with zero activity (e.g. Mark Genereux, Ruben Cisneros, Steven Resler); either contact or reassign/close. Address the 17 leads with no tasks (18.5%) and the 2 stale open leads; decide contact plan or disposition.  
2. **Eleni — channel mix:** She is call/SMS-heavy (12 outbound calls, 258 SMS, 7 emails on contacted leads). Consider adding email/LinkedIn for balance and for leads that don’t respond to calls/SMS.  
3. **Stale open leads (5 total):** Russell (2), Eleni (2), Lauren (1) — each SGA to either re-engage in the next 2 weeks or set a disposition so the list stays actionable.  
4. **Holly Huffman — 5 zero-activity leads:** Confirm if assigned intentionally; if yes, ensure at least one touch or disposition.  
5. **Campaign-level:** 87% Auto-Closed by Operations — confirm this is expected for re-engagement; if not, review auto-close rules and whether SGAs should disposition before auto-close. Share the “SMS first, then email/LinkedIn” sequence as the observed playbook for consistency and training.

---

# APPENDIX: Key Field Definitions

For reference, these are the key fields used in this analysis. Definitions align with `views/vw_funnel_master.sql` and `views/vw_sga_activity_performance_v2.sql`.

| Field | Source | Definition |
|-------|--------|------------|
| `all_campaigns` | vw_funnel_master | ARRAY<STRUCT<id STRING, name STRING>> of all campaigns a lead belongs to (from CampaignMember); struct fields are `id` and `name`. |
| `is_contacted` | vw_funnel_master | 1 if Lead `stage_entered_contacting__c` is set |
| `is_mql` | vw_funnel_master | 1 if Lead `mql_stage_entered_ts` is set (Stage_Entered_Call_Scheduled__c; Call Scheduled stage) |
| `is_sql` | vw_funnel_master | 1 if Lead `IsConverted = TRUE` |
| `is_sqo` | vw_funnel_master | 1 if Opportunity `LOWER(SQO_raw) = 'yes'` (SQO_raw is SQL__c; confusing name, means SQO) |
| `TOF_Stage` | vw_funnel_master | Highest stage reached: Prospect → Contacted → MQL → SQL → SQO → Joined |
| `Conversion_Status` | vw_funnel_master | Open / Closed / Joined |
| `Disposition__c` | vw_funnel_master | Lead-level closed-lost reason (Lead object) |
| `Closed_Lost_Reason__c` | vw_funnel_master | Opportunity-level closed-lost reason |
| `Stage_Entered_Closed__c` | vw_funnel_master | Opportunity-level: when opportunity entered Closed Lost. For lead-only closed, use `lead_closed_date`. |
| `SGA_Owner_Name__c` | vw_funnel_master | SGA who owns/worked the lead; coalesced with Opp SGA when lead SGA is null |
| `activity_channel` | vw_sga_activity_performance (v2) | Detailed channel: SMS, Call, Email (Manual/Campaign/Blast/Engagement), LinkedIn, Meeting, Marketing, Other |
| `activity_channel_group` | vw_sga_activity_performance (v2) | High-level bucket: SMS, Call, Email, LinkedIn, Meeting, Marketing, Other |
| `direction` | vw_sga_activity_performance (v2) | Inbound vs Outbound |
| `is_meaningful_connect` | vw_sga_activity_performance (v2) | 1 if Incoming SMS, answered call (subject like '%answered%' and not missed), or CallDurationInSeconds > 120 |
| `is_marketing_activity` | vw_sga_activity_performance (v2) | 1 if Subject LIKE 'Submitted Form%' OR executor_name = 'Savvy Marketing' |
| `task_activity_date` | vw_sga_activity_performance (v2) | DATE(CreatedDate, 'America/New_York') — activity date in Eastern |
| `task_created_date_utc` | vw_sga_activity_performance (v2) | Task CreatedDate (UTC) for ordering touches |
| **Real outbound filter** | This document (per 180d) | For activity counts/sequences/recency: `activity_channel_group NOT IN ('Marketing', 'Other', 'Email (Engagement)')` AND `activity_channel_group IS NOT NULL` AND `direction = 'Outbound'`. Excludes Lemlist link clicks (Email (Engagement)), marketing automation, Other. See `lead_list_touch_point_exploration_180d.md`. |
