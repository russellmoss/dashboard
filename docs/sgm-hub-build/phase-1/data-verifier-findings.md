# Data Verifier Findings: SGM Hub Leaderboard Tab

**Date:** 2026-03-21
**Analyst:** data-verifier agent (claude-sonnet-4-6)
**Primary source:** `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
**Secondary source:** `savvy-gtm-analytics.SavvyGTMData.User`

---

## Summary: All Clear - No View Changes Required

All fields needed for the SGM Leaderboard exist in `vw_funnel_master` and are well-populated for joined records. No BigQuery view modifications are required.

---

## 1. SGM_Owner_Name__c Population

**Field exists:** Yes (STRING, column 13 of 84)

| Scope | Not-Null Count | Total Count | Population Rate |
|---|---|---|---|
| All funnel records | 2,146 | 109,739 | 1.96% |
| is_joined_unique = 1 only | 115 | 115 | **100.00%** |

**Interpretation:** The 1.96% overall rate is expected -- SGM assignment only applies to records that reach the SQO/qualified stage. For the leaderboard use case (joined records), coverage is perfect.

**Distinct SGM names on joined records (all 12):**

| SGM_Owner_Name__c | Joined Count |
|---|---|
| GinaRose Galli | 43 |
| Bre McDaniel | 31 |
| Corey Marcello | 17 |
| RJ Cupelli | 5 |
| Bryan Belville | 5 |
| Jacqueline Tully | 4 |
| Erin Pearson | 4 |
| Jade Bingham | 2 |
| Savvy Marketing | 1 |
| Arianna Butler | 1 |
| Lexi Harrison | 1 |
| Tim Mackey | 1 |

**FLAG - "Savvy Marketing" anomaly:** One joined record has SGM_Owner_Name__c = 'Savvy Marketing'. This user is confirmed in SavvyGTMData.User as IsSGA__c = TRUE, Is_SGM__c = FALSE -- it is an SGA account, not an SGM. The leaderboard query should filter by joining to SavvyGTMData.User on Is_SGM__c = TRUE to exclude non-SGM owners.

---

## 2. is_joined_unique Flag

**Field exists:** Yes (INT64)

| Metric | Value |
|---|---|
| is_joined_unique = 1 rows | 115 |
| is_joined = 1 rows | 116 |
| Both flags = 1 | 115 |
| is_joined = 1 but is_joined_unique = 0 | 1 |

**How it works:** is_joined_unique deduplicates advisors who have multiple opportunity records. One advisor has is_joined = 1 on two rows, only one of which gets is_joined_unique = 1. All leaderboard queries must use is_joined_unique = 1 as the filter.

**Joined counts by quarter (via advisor_join_date__c):**

| Quarter | Joined Count |
|---|---|
| 2026-Q1 | 12 (in progress through 2026-03-21) |
| 2025-Q4 | 17 |
| 2025-Q3 | 14 |
| 2025-Q2 | 12 |
| 2025-Q1 | 12 |
| 2024-Q4 | 13 |
| 2024-Q3 | 9 |
| 2024-Q2 | 7 |

---

## 3. Opportunity_AUM for Joined Records

**Field exists:** Yes (FLOAT64, COALESCE of Underwritten_AUM__c and Amount)

| Metric | Value |
|---|---|
| Population rate (joined records) | **100%** (115/115) |
| Min AUM | $0 |
| Max AUM | $1,500,000,000 |
| Average AUM | $63,667,992 |
| Median AUM | $30,225,000 |
| Total AUM (all time) | ~$7.32B |
| Records with AUM = $0 | 3 (GinaRose Galli x1, Bre McDaniel x2) |
| Records with AUM = NULL | 0 |

**Zero-AUM records:** 3 out of 115 (2.6%). These are real joined advisors with reported $0 AUM at join time -- not a data quality issue per se, but the leaderboard should display $0 rather than hide these records.

**AUM per SGM (all time):**

| SGM | Joined | Total AUM | Min AUM | Max AUM | Zero AUM |
|---|---|---|---|---|---|
| GinaRose Galli | 43 | $3,107,505,550 | $0 | $1,500,000,000 | 1 |
| Bre McDaniel | 31 | $2,461,983,025 | $0 | $290,000,000 | 2 |
| Corey Marcello | 17 | $1,141,192,276 | $1 | $179,993,025 | 0 |
| Bryan Belville | 5 | $156,390,375 | $20,000,000 | $49,000,000 | 0 |
| Erin Pearson | 4 | $118,166,908 | $22,187,000 | $35,000,000 | 0 |
| RJ Cupelli | 5 | $98,559,759 | $13,600,000 | $26,959,759 | 0 |
| Jacqueline Tully | 4 | $73,000,001 | $1 | $32,000,000 | 0 |
| Savvy Marketing | 1 | $55,000,000 | $55,000,000 | $55,000,000 | 0 |
| Jade Bingham | 2 | $47,861,800 | $16,000,000 | $31,861,800 | 0 |
| Arianna Butler | 1 | $24,908,507 | $24,908,507 | $24,908,507 | 0 |
| Lexi Harrison | 1 | $18,843,400 | $18,843,400 | $18,843,400 | 0 |
| Tim Mackey | 1 | $18,407,500 | $18,407,500 | $18,407,500 | 0 |

**FLAG - GinaRose Galli $1.5B outlier:** One advisor joined under GinaRose has $1,500,000,000 AUM. This is a legitimate record but it dramatically skews her total AUM figures. The leaderboard UI may want to display both "Joined Count" and "Total AUM" columns so viewers can contextualize this.

---

## 4. SGM Identification in SavvyGTMData.User

**Field confirmed:** Is_SGM__c (BOOL) -- note mixed case: capital I, lowercase s, underscore, capital SGM, lowercase c. Contrast with IsSGA__c (no underscore separator).

**Total SGMs in User table:** 14 (12 active, 2 inactive)

| Name | IsActive | Is_SGM__c | IsSGA__c |
|---|---|---|---|
| Arianna Butler | true | true | false |
| Bre McDaniel | true | true | false |
| Bryan Belville | true | true | false |
| Clayton Kennamer | true | true | false |
| Corey Marcello | true | true | false |
| David Eubanks | true | true | false |
| Erin Pearson | true | true | false |
| GinaRose Galli | true | true | false |
| Jade Bingham | true | true | false |
| Lena Allouche | true | true | false |
| Lexi Harrison | true | true | false |
| Tim Mackey | true | true | false |
| Courtney Fallon | **false** | true | false |
| RJ Cupelli | **false** | true | false |

**Active SGMs with zero joined records (3):** David Eubanks, Clayton Kennamer, Lena Allouche. These have SQO activity (7, 11, and 5 SQOs respectively) but no closed/joined deals. They should appear on the leaderboard with 0 joins and $0 AUM if the query uses the User table as the left-side source.

**Active SGMs with no appearance in vw_funnel_master at all:** 0 -- every active SGM appears at least once in the funnel.

**Name join reliability:** SGM names match exactly between SGM_Owner_Name__c in vw_funnel_master and Name in SavvyGTMData.User. A direct string join on Name = SGM_Owner_Name__c is viable.

---

## 5. Leaderboard Data Sanity Check

### Q1 2026 (Jan-Mar, in progress as of 2026-03-21)

| SGM | Joined | Total AUM |
|---|---|---|
| GinaRose Galli | 2 | $1,565,800,000 |
| Corey Marcello | 4 | $458,000,000 |
| Bre McDaniel | 1 | $270,000,000 |
| Erin Pearson | 1 | $35,000,000 |
| Arianna Butler | 1 | $24,900,000 |
| Bryan Belville | 1 | $20,000,000 |
| Lexi Harrison | 1 | $18,800,000 |
| Tim Mackey | 1 | $18,400,000 |

8 SGMs appear on Q1 2026 leaderboard. 4 active SGMs have zero Q1 2026 joins: Clayton Kennamer, David Eubanks, Jade Bingham, Lena Allouche.

### Q4 2025

| SGM | Joined | Total AUM |
|---|---|---|
| Bre McDaniel | 3 | $667,000,000 |
| Corey Marcello | 3 | $285,500,000 |
| GinaRose Galli | 4 | $156,100,000 |
| Bryan Belville | 3 | $110,400,000 |
| Erin Pearson | 3 | $83,200,000 |
| Jade Bingham | 1 | $16,000,000 |

6 SGMs appear on Q4 2025 leaderboard.

AUM range across leaderboard: $16M to $1,566M per quarter per SGM. Total quarterly AUM: ~$2.4B (Q1 2026 in progress), ~$1.3B (Q4 2025). Reasonable for a wealth management recruiting firm.

---

## 6. Distribution of Joined Records Per SGM (Last 5 Quarters)

| SGM | 2025-Q1 | 2025-Q2 | 2025-Q3 | 2025-Q4 | 2026-Q1 |
|---|---|---|---|---|---|
| Bre McDaniel | 5 ($190.9M) | 5 ($346.7M) | 6 ($430.1M) | 3 ($667.0M) | 1 ($270.0M) |
| GinaRose Galli | 4 ($188.5M) | 1 ($34.0M) | 2 ($102.1M) | 4 ($156.1M) | 2 ($1,565.8M) |
| Corey Marcello | 2 ($68.4M) | 3 ($139.3M) | 4 ($175.0M) | 3 ($285.5M) | 4 ($458.0M) |
| Jacqueline Tully | 1 ($15.0M) | 3 ($58.0M) | -- | -- | -- |
| Bryan Belville | -- | -- | 1 ($26.0M) | 3 ($110.4M) | 1 ($20.0M) |
| Erin Pearson | -- | -- | -- | 3 ($83.2M) | 1 ($35.0M) |
| Jade Bingham | -- | -- | 1 ($31.9M) | 1 ($16.0M) | -- |
| Arianna Butler | -- | -- | -- | -- | 1 ($24.9M) |
| Lexi Harrison | -- | -- | -- | -- | 1 ($18.8M) |
| Tim Mackey | -- | -- | -- | -- | 1 ($18.4M) |

**Anomaly - Jacqueline Tully:** Had 4 joined advisors in H1 2025 but zero since Q3 2025. She does not appear in the Is_SGM__c = TRUE active set in SavvyGTMData.User, so she is a former SGM. Historical records remain in vw_funnel_master but she will not appear on the active leaderboard if using the User table join.

**Concentration:** GinaRose, Bre, and Corey account for ~79% of all-time joins. The leaderboard will visually reflect this concentration.

---

## 7. Channel and Source Fields

### Channel_Grouping_Name (7 distinct values)

| Channel | Total Records | Joined Count | Conversion Rate |
|---|---|---|---|
| Outbound | 99,796 | 47 | 0.05% |
| Marketing | 4,078 | 21 | 0.51% |
| Referral | 68 | 20 | 29.41% |
| Recruitment Firm | 476 | 19 | 3.99% |
| Re-Engagement | 151 | 6 | 3.97% |
| Outbound + Marketing | 2,654 | 2 | 0.08% |
| Other | 2,516 | 0 | 0.00% |

All 7 values work as filter options. No NULLs in joined records for this field.

### Original_source (18 distinct values, top 9 with joins)

| Source | Total Records | Joined Count | Conversion Rate |
|---|---|---|---|
| LinkedIn (Self Sourced) | 28,836 | 26 | 0.09% |
| Provided List (Lead Scoring) | 70,336 | 21 | 0.03% |
| Advisor Referral | 58 | 20 | 34.48% |
| Recruitment Firm | 466 | 19 | 4.08% |
| Job Applications | 2,675 | 11 | 0.41% |
| Direct Traffic | 1,343 | 8 | 0.60% |
| Re-Engagement | 151 | 6 | 3.97% |
| Events | 1,095 | 2 | 0.18% |
| LinkedIn Savvy | 6 | 2 | 33.33% |

9 of 18 sources have zero joined records. Consider filtering the source dropdown to sources with at least one join, or showing all with counts in the filter UI.

---

## 8. Quarter Derivation

**Recommended field for quarter filtering:** joined_cohort_month (STRING, format 'YYYY-MM')

| Property | Value |
|---|---|
| Field | joined_cohort_month |
| Type | STRING |
| Format | 'YYYY-MM' (e.g., '2026-03') |
| NULL rate (joined records) | 0% |
| Derived from | advisor_join_date__c |

**Quarter grouping pattern confirmed working in existing queries:**

    FORMAT_DATE('%Y-Q%Q', DATE(advisor_join_date__c)) AS quarter
    -- Returns: '2026-Q1', '2025-Q4', etc.

**For filtering a specific quarter, use joined_cohort_month:**

    -- Q1 2026
    WHERE is_joined_unique = 1
      AND joined_cohort_month IN ('2026-01', '2026-02', '2026-03')

    -- Q4 2025
    WHERE is_joined_unique = 1
      AND joined_cohort_month IN ('2025-10', '2025-11', '2025-12')

**Do NOT use** Stage_Entered_Closed__c for join date -- it is NULL on 114 of 115 joined records (99.1% NULL rate).

advisor_join_date__c is DATE type (not TIMESTAMP), 100% populated for joined records. Use this or joined_cohort_month as the primary date anchor.

---

## Recommended Leaderboard Query Pattern

    -- SGM Leaderboard for a given quarter
    -- Parameters: @quarter_months ARRAY<STRING> e.g. ['2026-01','2026-02','2026-03']
    SELECT
      u.Name AS sgm_name,
      COUNT(f.Full_prospect_id__c) AS joined_count,
      COALESCE(SUM(f.Opportunity_AUM), 0) AS total_aum,
      COALESCE(ROUND(AVG(f.Opportunity_AUM), 0), 0) AS avg_aum_per_join
    FROM
      savvy-gtm-analytics.SavvyGTMData.User u
    LEFT JOIN
      savvy-gtm-analytics.Tableau_Views.vw_funnel_master f
      ON f.SGM_Owner_Name__c = u.Name
      AND f.is_joined_unique = 1
      AND f.joined_cohort_month IN UNNEST(@quarter_months)
    WHERE
      u.Is_SGM__c = TRUE
      AND u.IsActive = TRUE
    GROUP BY 1
    ORDER BY 3 DESC

This pattern:
- Uses SavvyGTMData.User as the left side so SGMs with zero joins in a quarter still appear with 0s
- Filters to active SGMs only (excludes RJ Cupelli, Courtney Fallon)
- Excludes the "Savvy Marketing" SGA anomaly automatically
- Uses @quarter_months parameterized array (not string interpolation)

---

## Blockers and Flags

| Severity | Issue | Recommendation |
|---|---|---|
| LOW | "Savvy Marketing" (IsSGA user) appears as SGM_Owner_Name__c on 1 joined record | Filter leaderboard via User table join on Is_SGM__c = TRUE; this record is excluded automatically |
| LOW | 3 zero-AUM joined records (GinaRose x1, Bre x2) | Display as $0, do not hide |
| LOW | GinaRose Galli has a $1.5B single-advisor outlier in Q1 2026 | No action needed in data layer; UI may want to show avg AUM alongside total AUM |
| INFO | Jacqueline Tully has 4 historical joins but Is_SGM__c = FALSE | Historical records intact; she will not appear on active leaderboard if filtering via User table |
| INFO | 3 active SGMs (David Eubanks, Clayton Kennamer, Lena Allouche) have zero all-time joined records | Left join from User table handles this correctly -- they appear with 0/0 |
| INFO | Stage_Entered_Closed__c is 99.1% NULL for joined records | Use advisor_join_date__c or joined_cohort_month for all date filtering |

**No BigQuery view changes required.** All fields exist and are appropriately populated for the leaderboard feature.

---

## Field Inventory for Leaderboard Feature

| Field | Table | Type | Needed For | Population (joined) |
|---|---|---|---|---|
| SGM_Owner_Name__c | vw_funnel_master | STRING | SGM grouping key | 100% |
| is_joined_unique | vw_funnel_master | INT64 | Dedup filter | n/a (filter col) |
| Opportunity_AUM | vw_funnel_master | FLOAT64 | AUM sum/avg | 100% |
| advisor_join_date__c | vw_funnel_master | DATE | Date filtering | 100% |
| joined_cohort_month | vw_funnel_master | STRING | Quarter grouping | 100% |
| Channel_Grouping_Name | vw_funnel_master | STRING | Channel filter | confirmed present |
| Original_source | vw_funnel_master | STRING | Source filter | confirmed present |
| Name | SavvyGTMData.User | STRING | SGM roster | n/a |
| Is_SGM__c | SavvyGTMData.User | BOOL | SGM role filter | n/a |
| IsActive | SavvyGTMData.User | BOOL | Active-only filter | n/a |
