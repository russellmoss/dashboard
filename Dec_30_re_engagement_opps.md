# Dec 30, 2025 Re-Engagement Opportunities (290)

**Purpose:** Identify the 290 Re-Engagement opportunities created on December 30, 2025, using BigQuery. They use the same "Re-Engagement" record type as other Re-Engagement opportunities but can be isolated by **CreatedDate**.

---

## How they were found

1. **Record type:** Re-Engagement opportunities in this project use **RecordTypeId = `012VS000009VoxrYAC`** (Recruiting is `012Dn000000mrO3IAI`). This comes from `vw_funnel_master.sql`, which filters `RecordTypeId IN ('012Dn000000mrO3IAI', '012VS000009VoxrYAC')`.

2. **Date filter:** Restrict to opportunities created on **2025-12-30** with `DATE(CreatedDate) = '2025-12-30'` (or equivalent) and `IsDeleted = FALSE`.

3. **Count by date and record type** (used to locate the 290):

```sql
SELECT
  DATE(CreatedDate) AS created_date,
  RecordTypeId,
  COUNT(*) AS opp_count
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
WHERE IsDeleted = FALSE
  AND CreatedDate >= TIMESTAMP('2025-12-28')
  AND CreatedDate < TIMESTAMP('2026-01-05')
GROUP BY created_date, RecordTypeId
ORDER BY created_date, opp_count DESC;
```

**Result:** On **2025-12-30**, **290** opportunities have **RecordTypeId = `012VS000009VoxrYAC`** (Re-Engagement). On the same day there are 2 Recruiting (`012Dn000000mrO3IAI`).

---

## SQL to return the 290 Dec 30 Re-Engagement opportunities

```sql
SELECT
  Id,
  Name,
  RecordTypeId,
  CreatedDate,
  StageName,
  OwnerId
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
WHERE IsDeleted = FALSE
  AND RecordTypeId = '012VS000009VoxrYAC'
  AND DATE(CreatedDate) = '2025-12-30'
ORDER BY CreatedDate;
```

**Count check:**

```sql
SELECT
  COUNT(*) AS total,
  MIN(CreatedDate) AS first_created,
  MAX(CreatedDate) AS last_created
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
WHERE IsDeleted = FALSE
  AND RecordTypeId = '012VS000009VoxrYAC'
  AND DATE(CreatedDate) = '2025-12-30';
```

**Result:** **290** rows; first created **2025-12-30 16:37:44 UTC**, last **2025-12-30 16:42:05 UTC** (all within ~5 minutes).

---

## Summary

| Filter | Value |
|--------|--------|
| **Table** | `savvy-gtm-analytics.SavvyGTMData.Opportunity` |
| **RecordTypeId** | `012VS000009VoxrYAC` (Re-Engagement) |
| **CreatedDate** | `DATE(CreatedDate) = '2025-12-30'` |
| **IsDeleted** | `FALSE` |
| **Count** | **290** |
| **Creation window** | 2025-12-30 16:37:44 UTC – 16:42:05 UTC |

Sample opportunity: **Name** = "[Re-Engagement] Gail Murdoch", **Id** = 006VS00000VL1f6YAD, **StageName** = Closed Lost.

---

# Re-Engagement Opportunity Type: Stages, Dates, Conversion, Activities, Owners

Exploration of **all** Re-Engagement opportunities (`RecordTypeId = '012VS000009VoxrYAC'`) in BigQuery: **798** total (including the 290 created Dec 30).

---

## 1. StageName values

**SQL:**

```sql
SELECT StageName, COUNT(*) AS opp_count
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
WHERE IsDeleted = FALSE
  AND RecordTypeId = '012VS000009VoxrYAC'
GROUP BY StageName
ORDER BY opp_count DESC;
```

**Result:**

| StageName         | opp_count |
|-------------------|-----------|
| Planned Nurture   | 566       |
| Closed Lost       | 164       |
| Outreach          | 35        |
| Re-Engaged        | 22        |
| Call Scheduled   | 8         |
| Engaged           | 3         |

---

## 2. Stage-entered date fields and coverage

Re-Engagement opportunities have **stage-entered** timestamp fields. Many were created or worked before these fields existed, so a large share have **no** dates.

**Fields (from Opportunity):**

- `Stage_Entered_Planned_Nurture__c`
- `Stage_Entered_Outreach__c`
- `Stage_Entered_Engaged__c`
- `Stage_Entered_Call_Scheduled__c`
- `Stage_Entered_Re_Engaged__c`
- `Stage_Entered_Closed__c`

**SQL – count with vs without any stage date:**

```sql
SELECT
  COUNT(*) AS total_re_eng,
  SUM(CASE WHEN Stage_Entered_Planned_Nurture__c IS NOT NULL OR Stage_Entered_Outreach__c IS NOT NULL
        OR Stage_Entered_Engaged__c IS NOT NULL OR Stage_Entered_Call_Scheduled__c IS NOT NULL
        OR Stage_Entered_Re_Engaged__c IS NOT NULL OR Stage_Entered_Closed__c IS NOT NULL THEN 1 ELSE 0 END) AS with_any_stage_date,
  ROUND(100.0 * SUM(CASE WHEN Stage_Entered_Planned_Nurture__c IS NOT NULL OR Stage_Entered_Outreach__c IS NOT NULL
        OR Stage_Entered_Engaged__c IS NOT NULL OR Stage_Entered_Call_Scheduled__c IS NOT NULL
        OR Stage_Entered_Re_Engaged__c IS NOT NULL OR Stage_Entered_Closed__c IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 1) AS pct_with_any_stage_date
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
WHERE IsDeleted = FALSE
  AND RecordTypeId = '012VS000009VoxrYAC';
```

**SQL – % with each stage date populated:**

```sql
SELECT
  COUNT(*) AS total,
  ROUND(100.0 * COUNT(Stage_Entered_Planned_Nurture__c) / COUNT(*), 1) AS pct_Planned_Nurture,
  ROUND(100.0 * COUNT(Stage_Entered_Outreach__c) / COUNT(*), 1) AS pct_Outreach,
  ROUND(100.0 * COUNT(Stage_Entered_Engaged__c) / COUNT(*), 1) AS pct_Engaged,
  ROUND(100.0 * COUNT(Stage_Entered_Call_Scheduled__c) / COUNT(*), 1) AS pct_Call_Scheduled,
  ROUND(100.0 * COUNT(Stage_Entered_Re_Engaged__c) / COUNT(*), 1) AS pct_Re_Engaged,
  ROUND(100.0 * COUNT(Stage_Entered_Closed__c) / COUNT(*), 1) AS pct_Closed
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
WHERE IsDeleted = FALSE
  AND RecordTypeId = '012VS000009VoxrYAC';
```

**Result (798 Re-Engagement opps):**

| Metric                         | Value   |
|--------------------------------|---------|
| **With at least one stage date** | 169 (21.2%) |
| **With no stage dates**          | 629 (78.8%) |
| % with Stage_Entered_Planned_Nurture__c | 0.1%  |
| % with Stage_Entered_Outreach__c        | 0.1%  |
| % with Stage_Entered_Engaged__c          | 0%    |
| % with Stage_Entered_Call_Scheduled__c   | 0%    |
| % with Stage_Entered_Re_Engaged__c      | 0.3%  |
| % with Stage_Entered_Closed__c          | 20.9% |

**Summary:** **78.8%** have **no** stage-entered dates. **20.9%** have `Stage_Entered_Closed__c`; other stage dates are almost never set (0–0.3%). So we can track “when closed” for about one in five; for the rest, stage entry dates are missing, consistent with these fields being added after many records were created or worked.

---

## 3. Conversion to Recruiting opportunity

Conversion from Re-Engagement to a Recruiting opportunity is stored in **`Created_Recruiting_Opportunity_ID__c`** (ID of the created Recruiting opp).

**SQL:**

```sql
SELECT
  COUNT(*) AS re_eng_opps,
  COUNT(Created_Recruiting_Opportunity_ID__c) AS converted_to_recruiting,
  ROUND(100.0 * COUNT(Created_Recruiting_Opportunity_ID__c) / COUNT(*), 1) AS pct_converted
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
WHERE IsDeleted = FALSE
  AND RecordTypeId = '012VS000009VoxrYAC';
```

**Result:** **798** Re-Engagement opps; **1** has `Created_Recruiting_Opportunity_ID__c` set (**0.1%**). So conversion to Recruiting is rare in this dataset and **can be tracked** via that field when it is set.

**Example – Re-Engagement opp that created a Recruiting opp:**

```sql
SELECT Id, Name, StageName, Created_Recruiting_Opportunity_ID__c,
       Stage_Entered_Re_Engaged__c, Stage_Entered_Closed__c
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
WHERE IsDeleted = FALSE
  AND RecordTypeId = '012VS000009VoxrYAC'
  AND Created_Recruiting_Opportunity_ID__c IS NOT NULL;
```

---

## 4. Activities on Re-Engagement opportunities

Tasks (calls, emails, SMS, etc.) are linked to opportunities via **`Task.WhatId`**. Re-Engagement opportunities can be joined to `Task` on `Task.WhatId = Opportunity.Id`.

**SQL – count tasks and Re-Engagement opps with at least one task:**

```sql
SELECT
  COUNT(DISTINCT t.Id) AS task_count,
  COUNT(DISTINCT t.WhatId) AS opps_with_activity
FROM `savvy-gtm-analytics.SavvyGTMData.Task` t
INNER JOIN `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
  ON o.Id = t.WhatId AND o.IsDeleted = FALSE AND o.RecordTypeId = '012VS000009VoxrYAC'
WHERE t.IsDeleted = FALSE;
```

**Result:** **634** tasks linked to **208** Re-Engagement opportunities. So **yes**, we can track activities on Re-Engagement records; ~26% of Re-Engagement opps have at least one task.

**Example – recent task on a Re-Engagement opp:**

```sql
SELECT t.Id AS task_id, t.WhatId AS opportunity_id, t.Subject, t.CreatedDate, t.Type, t.OwnerId
FROM `savvy-gtm-analytics.SavvyGTMData.Task` t
INNER JOIN `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
  ON o.Id = t.WhatId AND o.IsDeleted = FALSE AND o.RecordTypeId = '012VS000009VoxrYAC'
WHERE t.IsDeleted = FALSE
ORDER BY t.CreatedDate DESC
LIMIT 5;
```

**Note:** `Tableau_Views.vw_sga_activity_performance` is built from Task joined to **vw_funnel_master**; that view includes Re-Engagement opps (`RecordTypeId IN (..., '012VS000009VoxrYAC')`). So Re-Engagement opp activities can also be analyzed through that view when the opp is in the funnel (e.g. by `Full_Opportunity_ID__c` = Re-Engagement opp Id).

---

## 5. Owners of Re-Engagement records (SGAs)

Owners are stored as **`OwnerId`** (Salesforce User Id). The **`Opportunity_Owner_Name__c`** field is populated on many records and holds the owner’s display name (SGA). To resolve **OwnerId → name** for all records, join to **`SavvyGTMData.User`** on `User.Id = Opportunity.OwnerId`.

**SQL – owner breakdown (top owners):**

```sql
SELECT
  COALESCE(o.Opportunity_Owner_Name__c, u.Name, CAST(o.OwnerId AS STRING)) AS owner_name,
  o.OwnerId,
  COUNT(*) AS opp_count
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.User` u ON u.Id = o.OwnerId
WHERE o.IsDeleted = FALSE
  AND o.RecordTypeId = '012VS000009VoxrYAC'
GROUP BY o.OwnerId, o.Opportunity_Owner_Name__c, u.Name
ORDER BY opp_count DESC;
```

**Result (top owners, 798 total Re-Engagement opps):**

| owner_name         | opp_count |
|--------------------|-----------|
| Helen Kamens       | 66        |
| Channing Guyer     | 65        |
| Russell Armitage    | 65        |
| Ryan Crandall      | 65        |
| Amy Waller         | 64        |
| Marisa Saucedo     | 64        |
| Lauren George      | 63        |
| Craig Suchodolski  | 61        |
| Eleni Stefanopoulos| 60        |
| Perry Kalmeta      | 57        |
| … (others)         | …         |

**Summary:** Owners are SGAs. Use **`Opportunity_Owner_Name__c`** when present; otherwise join **`Opportunity.OwnerId`** to **`SavvyGTMData.User`** and use **`User.Name`** to get the SGA name.
