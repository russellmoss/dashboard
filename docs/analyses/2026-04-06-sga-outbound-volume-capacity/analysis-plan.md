# SGA Outbound Volume Capacity Analysis

**Requested**: 2026-04-06
**Request**: Average outbound calls and outbound SMS per month per SGA over the last 6 months, for projecting capacity at 18 and 20 SGAs.
**Status**: Validated

---

## 1. Request Interpretation

Measure the monthly volume of **outbound calls** (Cold_Call + Scheduled_Call) and **outbound SMS** per SGA over Oct 2025 – Mar 2026 (6 months). Use these averages to project total team volume at 18 and 20 SGAs.

### Definitions Used

| Business Term | Technical Definition | Source |
|---|---|---|
| Active SGA | `User.IsSGA__c = TRUE AND IsActive = TRUE` plus 11-name exclusion list | `src/lib/queries/sga-activity.ts:37-47` (ACTIVE_SGAS_CTE) |
| Cold Call | `activity_channel_group = 'Call' AND is_true_cold_call = 1` | METRIC_CASE_EXPRESSION line 28 |
| Scheduled Call | `activity_channel_group = 'Call' AND is_true_cold_call = 0 AND direction = 'Outbound' AND subject NOT LIKE '%[lemlist]%'` | METRIC_CASE_EXPRESSION line 29 |
| Outbound SMS | `activity_channel_group = 'SMS' AND direction = 'Outbound'` | METRIC_CASE_EXPRESSION line 30 |
| Marketing exclusion | `COALESCE(is_marketing_activity, 0) = 0` | All activity queries |
| Date field | `task_activity_date` (COALESCE of ActivityDate and CreatedDate EST) | vw_sga_activity_performance |

### Scope
- **Date Range**: 2025-10-01 to 2026-03-31 (6 full months)
- **Population**: Currently active SGAs per ACTIVE_SGAS_CTE
- **Metrics**: Cold calls, scheduled calls, total outbound calls, outbound SMS
- **Granularity**: Per SGA per month, then averaged

---

## 2. Monthly Team Trend

| Month | Active SGAs | Cold Calls | Scheduled Calls | Total Outbound Calls | Avg Calls/SGA | Outbound SMS | Avg SMS/SGA |
|-------|------------|-----------|----------------|---------------------|--------------|-------------|------------|
| 2025-10 | 9 | 26 | 441 | 467 | 51.9 | 10,424 | 1,158 |
| 2025-11 | 9 | 23 | 301 | 324 | 36.0 | 8,729 | 970 |
| 2025-12 | 11 | 46 | 687 | 733 | 66.6 | 14,251 | 1,296 |
| 2026-01 | 12 | 7 | 641 | 648 | 54.0 | 21,043 | 1,754 |
| 2026-02 | 13 | 34 | 1,250 | 1,284 | 98.8 | 24,639 | 1,895 |
| 2026-03 | 16 | 94 | 1,524 | 1,618 | 101.1 | 28,067 | 1,754 |

**Trend**: Clear upward ramp in both channels. Oct-Jan averaged ~52 calls/SGA and ~1,045 SMS/SGA. Feb-Mar jumped to ~100 calls/SGA and ~1,825 SMS/SGA.

---

## 3. Per-SGA Averages (Oct 2025 – Mar 2026)

| SGA | Months | Avg Calls/Mo | Avg SMS/Mo | Total Calls | Total SMS |
|-----|--------|-------------|-----------|------------|----------|
| Jason Ainsworth | 4 | 176.3 | 1,499.0 | 705 | 5,996 |
| Marisa Saucedo | 6 | 120.3 | 1,910.3 | 722 | 11,462 |
| Helen Kamens | 6 | 105.7 | 1,301.8 | 634 | 7,811 |
| Russell Armitage | 6 | 105.5 | 1,693.0 | 633 | 10,158 |
| Katie Bassford | 2 | 86.5 | 1,790.0 | 173 | 3,580 |
| Brian O'Hara | 4 | 69.5 | 1,939.0 | 278 | 7,756 |
| Eleni Stefanopoulos | 6 | 66.8 | 1,691.5 | 401 | 10,149 |
| Perry Kalmeta | 6 | 59.0 | 1,018.8 | 354 | 6,113 |
| Rashard Wade | 1 | 56.0 | 160.0 | 56 | 160 |
| Ryan Crandall | 6 | 51.5 | 1,767.3 | 309 | 10,604 |
| Amy Waller | 6 | 48.2 | 854.3 | 289 | 5,126 |
| Channing Guyer | 6 | 41.8 | 1,558.2 | 251 | 9,349 |
| Holly Huffman | 3 | 41.0 | 2,256.7 | 123 | 6,770 |
| Craig Suchodolski | 6 | 23.8 | 2,012.7 | 143 | 12,076 |
| Dan Clifford | 1 | 2.0 | 43.0 | 2 | 43 |
| Kai Jean-Simon | 1 | 1.0 | 0.0 | 1 | 0 |

**Notable**: SMS volume is much more consistent across SGAs (~1,000-2,200/mo) than calls (24-176/mo). Craig Suchodolski is the inverse outlier — lowest calls but highest SMS, suggesting a heavy text-first workflow.

---

## 4. Projections

### Using 6-month blended average (12 SGAs with 3+ months of data)

| Metric | Per SGA/Month | 18 SGAs | 20 SGAs |
|--------|--------------|---------|---------|
| Outbound Calls | 75.8 | 1,364 | 1,516 |
| Outbound SMS | 1,625.2 | 29,254 | 32,504 |

### Using recent run rate (Feb-Mar 2026, ~100 calls and ~1,825 SMS per SGA)

| Metric | Per SGA/Month | 18 SGAs | 20 SGAs |
|--------|--------------|---------|---------|
| Outbound Calls | ~100 | ~1,800 | ~2,000 |
| Outbound SMS | ~1,825 | ~32,850 | ~36,500 |

### Which projection to use?

- **Conservative (blended)**: Use 1,364-1,516 calls and 29K-33K SMS if planning for average output including ramp months.
- **Steady-state (recent)**: Use 1,800-2,000 calls and 33K-37K SMS if the team is fully staffed and ramped. This is more realistic for forward planning.

---

## 5. SQL Query

```sql
WITH active_sgas AS (
  SELECT TRIM(u.Name) as sga_name
  FROM `savvy-gtm-analytics.SavvyGTMData.User` u
  WHERE u.IsSGA__c = TRUE AND u.IsActive = TRUE
    AND u.Name NOT IN (
      'Anett Diaz', 'Ariana Butler', 'Bre McDaniel', 'Bryan Belville',
      'GinaRose Galli', 'Jacqueline Tully', 'Jed Entin', 'Russell Moss',
      'Savvy Marketing', 'Savvy Operations', 'Lauren George'
    )
),
classified AS (
  SELECT DISTINCT
    a.task_id,
    a.task_executor_name,
    FORMAT_DATE('%Y-%m', a.task_activity_date) AS activity_month,
    CASE
      WHEN a.activity_channel_group = 'Call' AND a.is_true_cold_call = 1 THEN 'Cold_Call'
      WHEN a.activity_channel_group = 'Call' AND COALESCE(a.is_true_cold_call, 0) = 0
           AND a.direction = 'Outbound'
           AND LOWER(COALESCE(a.task_subject, '')) NOT LIKE '%[lemlist]%' THEN 'Scheduled_Call'
      WHEN a.activity_channel_group = 'SMS' AND a.direction = 'Outbound' THEN 'Outbound_SMS'
      ELSE NULL
    END AS metric_type
  FROM `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` a
  INNER JOIN active_sgas s ON a.task_executor_name = s.sga_name
  WHERE a.task_activity_date >= DATE('2025-10-01')
    AND a.task_activity_date < DATE('2026-04-01')
    AND COALESCE(a.is_marketing_activity, 0) = 0
),
sga_monthly AS (
  SELECT
    task_executor_name AS sga_name,
    activity_month,
    COUNTIF(metric_type = 'Cold_Call') AS cold_calls,
    COUNTIF(metric_type = 'Scheduled_Call') AS scheduled_calls,
    COUNTIF(metric_type IN ('Cold_Call', 'Scheduled_Call')) AS total_outbound_calls,
    COUNTIF(metric_type = 'Outbound_SMS') AS outbound_sms
  FROM classified
  GROUP BY 1, 2
)
-- Per-SGA averages
SELECT
  sga_name,
  COUNT(DISTINCT activity_month) AS active_months,
  SUM(cold_calls) AS total_cold,
  SUM(scheduled_calls) AS total_scheduled,
  SUM(total_outbound_calls) AS total_outbound,
  SUM(outbound_sms) AS total_sms,
  ROUND(AVG(total_outbound_calls), 1) AS avg_calls_per_month,
  ROUND(AVG(outbound_sms), 1) AS avg_sms_per_month
FROM sga_monthly
GROUP BY 1
ORDER BY avg_calls_per_month DESC;
```

**Validation**: All queries executed successfully against BigQuery on 2026-04-06. Results cross-checked against dashboard Activity Breakdown table for Mar 2026 — numbers align within expected tolerance.

---

## 6. Methodology Notes

- **"Active months"** = months where the SGA had at least 1 classified task. SGAs with <3 months excluded from blended averages (new hires with partial data).
- **Metric classification** uses the exact `METRIC_CASE_EXPRESSION` from the dashboard codebase — same logic as scorecards and breakdown table.
- **SMS volume is predominantly automated** (lemlist campaign sequences). The METRIC_CASE for Outbound_SMS does NOT exclude lemlist — it only excludes lemlist from Scheduled_Call. This means SMS numbers include both manual texts and campaign-triggered texts. This is intentional and matches the dashboard.
- **task_activity_date** used (not task_created_date_est) to align with SFDC report date field.
