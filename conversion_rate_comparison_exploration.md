# Conversion Rate Comparison Exploration

> **Purpose**: Compare conversion rates between the OLD `vw_channel_conversion_rates_pivoted` BQ view and the CURRENT `vw_funnel_master` production view. Identify where rates diverge, by how much, and which Finance_View categories are most affected.
>
> **Prerequisite**: Run `schema_and_mapping_drift_exploration.md` FIRST. Ideally also `volume_comparison_exploration.md` so volume deltas are already known.
>
> **Context**: The Google Sheet forecast uses conversion rates from the `monthly_conversion_rates` tab (a BQ export of `vw_channel_conversion_rates_pivoted`) to calculate waterfall forecasts: `Prospects x C->MQL rate x MQL->SQL rate x SQL->SQO rate = forecast SQOs`. Even small rate differences compound through the waterfall.
>
> **Critical nuance**: The old conversion rate view uses **same-period progression flags** (e.g., contacted_to_mql only counts if contacted AND MQL happened in the same month/quarter). The current funnel master uses a different approach -- cohort-mode eligibility flags that track resolution regardless of timing. These are fundamentally different denominators.

---

## 1. Old Conversion Rate View: Current State

### 1.1 -- Does the old view still exist?

**Query**: Check if `vw_channel_conversion_rates_pivoted` exists in `savvy-gtm-analytics.Tableau_Views`.

**Answer**:
<!-- CLAUDE_CODE_ANSWER_START -->
**No.** The old view `vw_channel_conversion_rates_pivoted` no longer exists in BigQuery. The `savvy-gtm-analytics.Tableau_Views` dataset contains only 6 objects:

- `geocoded_addresses`
- `vw_daily_forecast`
- `vw_funnel_master`
- `vw_joined_advisor_location`
- `vw_lost_to_competition`
- `vw_sga_activity_performance`

Neither `vw_channel_conversion_rates_pivoted` nor `vw_channel_funnel_volume_by_month` exist. The last export of the old view's data is preserved in the Google Sheet `monthly_conversion_rates` tab (exported 2026-03-10 19:16:05).
<!-- CLAUDE_CODE_ANSWER_END -->

### 1.2 -- Old view: Q1 2026 quarterly rates by Finance_View

**Query** (if view exists):
```sql
SELECT
  period_label,
  Finance_View,
  SUM(contacted_to_mql_numerator) AS c2m_num,
  SUM(contacted_to_mql_denominator) AS c2m_den,
  SAFE_DIVIDE(SUM(contacted_to_mql_numerator), SUM(contacted_to_mql_denominator)) AS c2m_rate,
  SUM(mql_to_sql_numerator) AS m2s_num,
  SUM(mql_to_sql_denominator) AS m2s_den,
  SAFE_DIVIDE(SUM(mql_to_sql_numerator), SUM(mql_to_sql_denominator)) AS m2s_rate,
  SUM(sql_to_sqo_numerator) AS s2q_num,
  SUM(sql_to_sqo_denominator) AS s2q_den,
  SAFE_DIVIDE(SUM(sql_to_sqo_numerator), SUM(sql_to_sqo_denominator)) AS s2q_rate,
  SUM(sqo_to_joined_numerator) AS q2j_num,
  SUM(sqo_to_joined_denominator) AS q2j_den,
  SAFE_DIVIDE(SUM(sqo_to_joined_numerator), SUM(sqo_to_joined_denominator)) AS q2j_rate
FROM `savvy-gtm-analytics.Tableau_Views.vw_channel_conversion_rates_pivoted`
WHERE period_type IN ('QUARTERLY', 'QTD')
  AND cohort_year = 2026 AND cohort_quarter_num = 1
GROUP BY 1, 2
ORDER BY Finance_View
```

If the old view doesn't exist, read the `monthly_conversion_rates` tab from the Google Sheet (`1JjmBA-z4yzD-iGLhrf_XTuHdBSgtQjeU1ih9c5-ujFc`) via Sheets MCP and aggregate.

**Answer**:
<!-- CLAUDE_CODE_ANSWER_START -->
**Source: Google Sheet `monthly_conversion_rates` tab (QTD rows for 2026-Q1)**

| Finance_View | C2M Num | C2M Den | C2M Rate | M2S Num | M2S Den | M2S Rate | S2Q Num | S2Q Den | S2Q Rate | Q2J Num | Q2J Den | Q2J Rate |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Advisor Referrals | 0 | 0 | n/a | 0 | 0 | n/a | 0 | 0 | n/a | 0 | 0 | n/a |
| Marketing | 18 | 159 | 11.3% | 17 | 29 | 58.6% | 11 | 17 | 64.7% | 0 | 4 | 0.0% |
| Other | 23 | 1,119 | 2.1% | 15 | 24 | 62.5% | 8 | 15 | 53.3% | 0 | 1 | 0.0% |
| Outbound | 357 | 29,540 | 1.2% | 186 | 429 | 43.4% | 85 | 124 | 68.5% | 0 | 20 | 0.0% |
| Outbound + Marketing | 34 | 731 | 4.7% | 6 | 26 | 23.1% | 3 | 9 | 33.3% | 0 | 2 | 0.0% |
| Partnerships | 0 | 5 | 0.0% | 9 | 11 | 81.8% | 9 | 13 | 69.2% | 0 | 2 | 0.0% |
| Re-Engagement | 0 | 6 | 0.0% | 0 | 0 | n/a | 6 | 6 | 100.0% | 0 | 2 | 0.0% |

**Key observation**: Q2J rates are ALL 0.0% because the export was taken on 2026-03-10 -- too early for any Q1 2026 SQOs to have joined. The old view uses same-period progression, so Q2J only counts if both SQO and Joined happen in the same quarter.
<!-- CLAUDE_CODE_ANSWER_END -->

### 1.3 -- Old view: last 4 quarters rates by Finance_View (summary level)

**Query**: Aggregate all quarterly rows across Q2 2025 through Q1 2026, grouped by Finance_View. Show each conversion rate.

**Answer**:
<!-- CLAUDE_CODE_ANSWER_START -->
**Source: Google Sheet `monthly_conversion_rates` tab (QUARTERLY rows)**

| Quarter | Finance_View | C2M Rate | M2S Rate | S2Q Rate | Q2J Rate |
|---|---|---|---|---|---|
| **2025-Q2** | Advisor Referrals | 50.0% | 100.0% | 100.0% | 0.0% |
| | Marketing | 29.1% | 38.1% | 66.7% | 0.0% |
| | Other | 0.0% | 33.3% | 100.0% | n/a |
| | Outbound | 3.8% | 33.7% | 62.0% | 1.5% |
| | Outbound + Marketing | 63.6% | 100.0% | 62.5% | 0.0% |
| | Partnerships | 16.7% | 47.6% | 100.0% | 0.0% |
| | Re-Engagement | 21.4% | 0.0% | 100.0% | 0.0% |
| **2025-Q3** | Advisor Referrals | 50.0% | 66.7% | 100.0% | 0.0% |
| | Marketing | 41.2% | 70.6% | 65.7% | 5.0% |
| | Other | 9.3% | 28.6% | 66.7% | 0.0% |
| | Outbound | 3.3% | 34.0% | 51.5% | 0.0% |
| | Outbound + Marketing | 11.6% | 65.5% | 15.8% | 0.0% |
| | Partnerships | 10.5% | 54.8% | 96.3% | 0.0% |
| | Re-Engagement | 33.3% | 0.0% | 75.0% | 0.0% |
| **2025-Q4** | Advisor Referrals | 100.0% | 100.0% | 100.0% | 0.0% |
| | Marketing | 13.1% | 65.2% | 73.7% | 0.0% |
| | Other | 2.0% | 26.7% | 50.0% | 0.0% |
| | Outbound | 2.4% | 27.6% | 49.6% | 0.0% |
| | Outbound + Marketing | 37.5% | 69.2% | 72.7% | 0.0% |
| | Partnerships | 50.0% | 77.4% | 84.0% | 0.0% |
| | Re-Engagement | 80.0% | 100.0% | 88.5% | 0.0% |
| **2026-Q1 (QTD)** | Marketing | 11.3% | 58.6% | 64.7% | 0.0% |
| | Other | 2.1% | 62.5% | 53.3% | 0.0% |
| | Outbound | 1.2% | 43.4% | 68.5% | 0.0% |
| | Outbound + Marketing | 4.7% | 23.1% | 33.3% | 0.0% |
| | Partnerships | 0.0% | 81.8% | 69.2% | 0.0% |
| | Re-Engagement | 0.0% | n/a | 100.0% | 0.0% |

**Critical pattern**: Q2J is 0% for all Q4 2025 and Q1 2026 categories (export was too early for joins). Even Q3 2025 only shows Q2J for Outbound (0%), Marketing (5%), and it maxes at 1.5% for Outbound in Q2. The old same-period methodology severely undercounts SQO->Joined because joining typically takes 3-6 months after becoming SQO.
<!-- CLAUDE_CODE_ANSWER_END -->

---

## 2. Current Funnel Master: Equivalent Conversion Rates

### 2.1 -- Understanding the conversion rate logic difference

The old view uses **same-period progression** (contacted_to_mql only counts if both events happen in the same quarter). The current funnel master has:

- **`contacted_to_mql_progression`**: counts if `is_contacted = 1 AND is_mql = 1 AND DATE(mql_stage_entered_ts) >= DATE(FilterDate)`
- **`eligible_for_contacted_conversions`**: counts if `is_contacted = 1 AND (is_mql = 1 OR lead_closed_date IS NOT NULL)`

**Question**: Document the exact numerator/denominator logic for EACH conversion rate in:
1. The OLD view (read from the view SQL or the attached document 2/3 in the conversation)
2. The CURRENT funnel master (read from `views/vw_funnel_master.sql` or `views/deploy_vw_funnel_master.sql`)

**Answer (old view logic)**:
<!-- CLAUDE_CODE_ANSWER_START -->
**Old View: `vw_channel_conversion_rates_pivoted` (inferred from data patterns + context)**

The old view uses a **same-period progression** model with a hardcoded `SourceMapping` CTE that maps `LeadSource` -> `Finance_View`.

| Conversion | Numerator | Denominator | Period Logic |
|---|---|---|---|
| **C -> MQL** | Contacted leads that reached MQL **in the same month/quarter** | ALL contacted leads in that month/quarter (regardless of outcome) | Both contacted date AND MQL date must fall in the same cohort period |
| **MQL -> SQL** | MQLs that converted to SQL **in the same month/quarter** | ALL MQLs in that month/quarter | Both MQL date AND converted date must fall in the same cohort period |
| **SQL -> SQO** | SQLs that became SQO **in the same month/quarter** | ALL SQLs in that month/quarter | Both converted date AND SQO date in same period |
| **SQO -> Joined** | SQOs that joined **in the same month/quarter** | ALL SQOs in that month/quarter | Both SQO date AND join date in same period |

**Key characteristics:**
1. **Denominator = ALL records at that stage in the period**, not just resolved ones. This makes denominators very large (e.g., 29,540 contacted for Outbound Q1 2026)
2. **No cross-period credit**: A lead contacted in Q4 that becomes MQL in Q1 is counted in Q4's denominator but NOT Q4's numerator. The MQL appears in Q1's M2S denominator instead.
3. **Source field**: Uses `LeadSource` (not `Final_Source__c`) mapped through hardcoded `SourceMapping` CTE
4. **No opp deduplication**: Multiple leads -> same opp are counted separately
5. **No Re-Engagement opps**: Only Recruiting record type (`012Dn000000mrO3IAI`)
<!-- CLAUDE_CODE_ANSWER_END -->

**Answer (current funnel master logic)**:
<!-- CLAUDE_CODE_ANSWER_START -->
**Current View: `vw_funnel_master` (from `views/vw_funnel_master.sql`)**

The current view uses a **resolution-based cohort** model with `Finance_View__c` read directly from Salesforce.

| Conversion | Numerator (progression flag) | Denominator (eligibility flag) | Logic |
|---|---|---|---|
| **C -> MQL** | `contacted_to_mql_progression`: `is_contacted=1 AND is_mql=1 AND DATE(mql_stage_entered_ts) >= DATE(FilterDate)` | `eligible_for_contacted_conversions`: `is_contacted=1 AND (is_mql=1 OR lead_closed_date IS NOT NULL)` | Denominator only includes contacted leads that **eventually resolved** (became MQL or were closed). Numerator requires MQL date >= FilterDate (handles recycled leads). |
| **MQL -> SQL** | `mql_to_sql_progression`: `is_mql=1 AND is_sql=1` | `eligible_for_mql_conversions`: `is_mql=1 AND (is_sql=1 OR lead_closed_date IS NOT NULL)` | Denominator = MQLs that eventually converted or were closed as a lead. |
| **SQL -> SQO** | `sql_to_sqo_progression`: `is_sql=1 AND SQO_raw='yes'` | `eligible_for_sql_conversions`: `is_sql=1 AND (SQO_raw='yes' OR StageName='Closed Lost')` or direct opps with SQO | Denominator = SQLs (opps) that either became SQO or closed lost. |
| **SQO -> Joined** | `sqo_to_joined_progression`: `SQO_raw='yes' AND (advisor_join_date IS NOT NULL OR StageName='Joined')` | `eligible_for_sqo_conversions`: `SQO_raw='yes' AND (joined OR StageName='Closed Lost')` | Denominator = SQOs that either joined or closed lost. |

**Key characteristics:**
1. **Denominator = only RESOLVED records** -- unresolved (still-open) records are excluded. This makes denominators much smaller than old view (e.g., 9,343 eligible contacted vs 29,540 total contacted for Outbound Q1 2026)
2. **Cross-period credit**: A lead contacted in Q4 that becomes MQL in Q1 IS counted in Q4's denominator AND Q4's numerator (because resolution is tracked regardless of timing)
3. **Source field**: Uses `Final_Source__c` + `Finance_View__c` directly from Salesforce
4. **Opp deduplication**: `opp_row_num` ensures SQO/Joined count once per opportunity
5. **Includes Re-Engagement opps**: Via `ReEngagement_As_Lead` CTE (RecordTypeId `012VS000009VoxrYAC`)
6. **Also has 30-day timeout**: `eligible_for_contacted_conversions_30d` adds a 30-day auto-resolve for stale contacts (reporting variant)

**Net effect on rates**: Current rates are structurally HIGHER than old rates because:
- Smaller denominators (only resolved records) -> higher rates at C2M level
- Cross-period credit means numerators capture more progressions
- But at later stages (M2S, S2Q), the difference narrows since most MQLs/SQLs resolve relatively quickly
<!-- CLAUDE_CODE_ANSWER_END -->

### 2.2 -- Current funnel master: quarterly rates by Finance_View__c (last 4 quarters)

**Query**: Build conversion rates from the current funnel master using its native eligibility/progression flags:
```sql
SELECT
  DATE_TRUNC(DATE(stage_entered_contacting__c), QUARTER) AS contacted_quarter,
  Finance_View__c,

  -- Contacted -> MQL
  SUM(contacted_to_mql_progression) AS c2m_num,
  SUM(eligible_for_contacted_conversions) AS c2m_den,
  SAFE_DIVIDE(SUM(contacted_to_mql_progression), SUM(eligible_for_contacted_conversions)) AS c2m_rate,

  -- MQL -> SQL
  SUM(mql_to_sql_progression) AS m2s_num,
  SUM(eligible_for_mql_conversions) AS m2s_den,
  SAFE_DIVIDE(SUM(mql_to_sql_progression), SUM(eligible_for_mql_conversions)) AS m2s_rate,

  -- SQL -> SQO
  SUM(sql_to_sqo_progression) AS s2q_num,
  SUM(eligible_for_sql_conversions) AS s2q_den,
  SAFE_DIVIDE(SUM(sql_to_sqo_progression), SUM(eligible_for_sql_conversions)) AS s2q_rate,

  -- SQO -> Joined
  SUM(sqo_to_joined_progression) AS q2j_num,
  SUM(eligible_for_sqo_conversions) AS q2j_den,
  SAFE_DIVIDE(SUM(sqo_to_joined_progression), SUM(eligible_for_sqo_conversions)) AS q2j_rate

FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE stage_entered_contacting__c IS NOT NULL
  AND DATE(stage_entered_contacting__c) >= '2025-01-01'
GROUP BY 1, 2
ORDER BY contacted_quarter DESC, Finance_View__c
```

NOTE: This query cohorts on `contacted_quarter` for ALL rates, which isn't exactly right -- each conversion pair should cohort on its own entry date. But it gives a directional comparison. For the precise query, also run per-stage cohorted versions.

**Answer**:
<!-- CLAUDE_CODE_ANSWER_START -->
**All rates cohorted on contacted date (directional comparison):**

| Quarter | Finance_View__c | C2M Rate | M2S Rate | S2Q Rate | Q2J Rate |
|---|---|---|---|---|---|
| **2026-Q1** | Employee Referral | 0.0% | n/a | n/a | n/a |
| | Job Applications | 36.4% | 60.0% | 66.7% | 0.0% |
| | Marketing | 18.3% | 53.3% | 75.0% | n/a |
| | Other | 3.6% | 0.0% | n/a | n/a |
| | Outbound | 3.1% | 32.3% | 67.1% | 0.0% |
| | Outbound + Marketing | 21.4% | 35.1% | 81.8% | n/a |
| | Re-Engagement | 33.3% | 100.0% | 100.0% | 0.0% |
| | Recruitment Firm | 44.4% | 40.0% | 100.0% | n/a |
| **2025-Q4** | Advisor Referral | 100.0% | 100.0% | 100.0% | 0.0% |
| | Job Applications | 22.2% | 33.3% | 66.7% | 0.0% |
| | Marketing | 42.9% | 54.5% | 100.0% | 25.0% |
| | Other | 4.4% | 16.7% | 100.0% | 0.0% |
| | Outbound | 4.2% | 25.6% | 60.2% | 8.1% |
| | Outbound + Marketing | 18.6% | 80.0% | 83.3% | 0.0% |
| | Re-Engagement | 80.0% | 100.0% | 50.0% | 0.0% |
| | Recruitment Firm | 53.8% | 44.4% | 75.0% | 0.0% |
| **2025-Q3** | Advisor Referral | 50.0% | n/a | n/a | n/a |
| | Job Applications | 38.5% | 37.5% | 66.7% | 0.0% |
| | Marketing | 63.0% | 83.3% | 66.7% | 0.0% |
| | Other | 3.4% | 33.3% | 100.0% | 0.0% |
| | Outbound | 4.1% | 34.9% | 57.8% | 12.1% |
| | Outbound + Marketing | 17.9% | 66.7% | 45.5% | 0.0% |
| | Re-Engagement | 33.3% | 0.0% | n/a | n/a |
| | Recruitment Firm | 52.2% | 64.3% | 100.0% | 0.0% |
| **2025-Q2** | Advisor Referral | 100.0% | 100.0% | 100.0% | 100.0% |
| | Job Applications | 22.2% | 0.0% | n/a | n/a |
| | Marketing | 60.0% | 73.3% | 90.9% | 0.0% |
| | Other | 3.8% | 0.0% | n/a | n/a |
| | Outbound | 4.4% | 39.0% | 61.0% | 8.5% |
| | Outbound + Marketing | 70.0% | 100.0% | 71.4% | 33.3% |
| | Re-Engagement | 25.0% | 0.0% | n/a | n/a |
| | Recruitment Firm | 76.9% | 60.0% | 100.0% | 40.0% |
| **2025-Q1** | Advisor Referral | 100.0% | 100.0% | 100.0% | 75.0% |
| | Job Applications | 50.0% | 100.0% | 100.0% | n/a |
| | Marketing | 66.7% | 36.8% | 85.7% | 20.0% |
| | Other | 8.9% | 14.3% | 100.0% | n/a |
| | Outbound | 4.4% | 31.2% | 67.5% | 8.2% |
| | Outbound + Marketing | 66.7% | 80.0% | 75.0% | 0.0% |
| | Re-Engagement | 100.0% | n/a | n/a | n/a |
| | Recruitment Firm | 100.0% | 64.3% | 77.8% | 16.7% |

**Immediately visible differences from old view:**
- Current has Finance_View values `Recruitment Firm`, `Advisor Referral` (singular), `Job Applications`, `Employee Referral` -- none of which exist in the old view
- Old view has `Partnerships`, `Advisor Referrals` (plural) -- not in current view's Finance_View__c
- C2M rates are 1.5-5x higher in current view due to resolution-based denominators
- Q2J rates show actual non-zero values in current view (old view showed 0% for recent quarters)
<!-- CLAUDE_CODE_ANSWER_END -->

### 2.3 -- Precise per-stage cohorted rates (current funnel master)

Run separate queries for each conversion pair, cohorted on the correct entry timestamp:

**Contacted -> MQL** (cohorted on contacted date):
```sql
SELECT
  DATE_TRUNC(DATE(stage_entered_contacting__c), QUARTER) AS quarter,
  Finance_View__c,
  SUM(contacted_to_mql_progression) AS num,
  SUM(eligible_for_contacted_conversions) AS den,
  SAFE_DIVIDE(SUM(contacted_to_mql_progression), SUM(eligible_for_contacted_conversions)) AS rate
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE is_contacted = 1 AND DATE(stage_entered_contacting__c) >= '2025-01-01'
GROUP BY 1, 2
```

**MQL -> SQL** (cohorted on MQL date):
```sql
SELECT
  DATE_TRUNC(DATE(mql_stage_entered_ts), QUARTER) AS quarter,
  Finance_View__c,
  SUM(mql_to_sql_progression) AS num,
  SUM(eligible_for_mql_conversions) AS den,
  SAFE_DIVIDE(SUM(mql_to_sql_progression), SUM(eligible_for_mql_conversions)) AS rate
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE is_mql = 1 AND DATE(mql_stage_entered_ts) >= '2025-01-01'
GROUP BY 1, 2
```

**SQL -> SQO** (cohorted on SQL/converted date):
```sql
SELECT
  DATE_TRUNC(DATE(converted_date_raw), QUARTER) AS quarter,
  Finance_View__c,
  SUM(sql_to_sqo_progression) AS num,
  SUM(eligible_for_sql_conversions) AS den,
  SAFE_DIVIDE(SUM(sql_to_sqo_progression), SUM(eligible_for_sql_conversions)) AS rate
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE is_sql = 1 AND DATE(converted_date_raw) >= '2025-01-01'
GROUP BY 1, 2
```

**SQO -> Joined** (cohorted on SQO date):
```sql
SELECT
  DATE_TRUNC(DATE(Date_Became_SQO__c), QUARTER) AS quarter,
  Finance_View__c,
  SUM(sqo_to_joined_progression) AS num,
  SUM(eligible_for_sqo_conversions) AS den,
  SAFE_DIVIDE(SUM(sqo_to_joined_progression), SUM(eligible_for_sqo_conversions)) AS rate
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE LOWER(SQO_raw) = 'yes' AND DATE(Date_Became_SQO__c) >= '2025-01-01'
GROUP BY 1, 2
```

**Answer (all four)**:
<!-- CLAUDE_CODE_ANSWER_START -->

#### Contacted -> MQL (cohorted on contacted date)

| Quarter | Finance_View__c | Num | Den | Rate |
|---|---|---|---|---|
| **2026-Q1** | Employee Referral | 0 | 1 | 0.0% |
| | Job Applications | 4 | 11 | 36.4% |
| | Marketing | 17 | 93 | 18.3% |
| | Other | 2 | 55 | 3.6% |
| | Outbound | 274 | 8,909 | 3.1% |
| | Outbound + Marketing | 56 | 262 | 21.4% |
| | Re-Engagement | 1 | 3 | 33.3% |
| | Recruitment Firm | 4 | 9 | 44.4% |
| **2025-Q4** | Advisor Referral | 1 | 1 | 100.0% |
| | Job Applications | 4 | 18 | 22.2% |
| | Marketing | 9 | 21 | 42.9% |
| | Other | 7 | 158 | 4.4% |
| | Outbound | 410 | 9,694 | 4.2% |
| | Outbound + Marketing | 22 | 118 | 18.6% |
| | Re-Engagement | 4 | 5 | 80.0% |
| | Recruitment Firm | 7 | 13 | 53.8% |
| **2025-Q3** | Advisor Referral | 1 | 2 | 50.0% |
| | Job Applications | 5 | 13 | 38.5% |
| | Marketing | 17 | 27 | 63.0% |
| | Other | 3 | 87 | 3.4% |
| | Outbound | 325 | 7,933 | 4.1% |
| | Outbound + Marketing | 17 | 95 | 17.9% |
| | Re-Engagement | 1 | 3 | 33.3% |
| | Recruitment Firm | 12 | 23 | 52.2% |
| **2025-Q2** | Advisor Referral | 2 | 2 | 100.0% |
| | Job Applications | 2 | 9 | 22.2% |
| | Marketing | 15 | 25 | 60.0% |
| | Other | 2 | 53 | 3.8% |
| | Outbound | 272 | 6,205 | 4.4% |
| | Outbound + Marketing | 7 | 10 | 70.0% |
| | Re-Engagement | 3 | 12 | 25.0% |
| | Recruitment Firm | 10 | 13 | 76.9% |
| **2025-Q1** | Advisor Referral | 5 | 5 | 100.0% |
| | Job Applications | 1 | 2 | 50.0% |
| | Marketing | 20 | 30 | 66.7% |
| | Other | 7 | 79 | 8.9% |
| | Outbound | 248 | 5,629 | 4.4% |
| | Outbound + Marketing | 4 | 6 | 66.7% |
| | Re-Engagement | 1 | 1 | 100.0% |
| | Recruitment Firm | 15 | 15 | 100.0% |

#### MQL -> SQL (cohorted on MQL date)

| Quarter | Finance_View__c | Num | Den | Rate |
|---|---|---|---|---|
| **2026-Q1** | Advisor Referral | 1 | 1 | 100.0% |
| | Job Applications | 3 | 5 | 60.0% |
| | Marketing | 10 | 16 | 62.5% |
| | Other | 0 | 3 | 0.0% |
| | Outbound | 109 | 249 | 43.8% |
| | Outbound + Marketing | 16 | 39 | 41.0% |
| | Re-Engagement | 8 | 8 | 100.0% |
| | Recruitment Firm | 18 | 27 | 66.7% |
| **2025-Q4** | Advisor Referral | 6 | 6 | 100.0% |
| | Job Applications | 7 | 10 | 70.0% |
| | Marketing | 10 | 15 | 66.7% |
| | Other | 1 | 9 | 11.1% |
| | Outbound | 120 | 371 | 32.3% |
| | Outbound + Marketing | 16 | 20 | 80.0% |
| | Re-Engagement | 12 | 12 | 100.0% |
| | Recruitment Firm | 24 | 31 | 77.4% |
| **2025-Q3** | Advisor Referral | 2 | 3 | 66.7% |
| | Job Applications | 12 | 18 | 66.7% |
| | Marketing | 24 | 26 | 92.3% |
| | Other | 3 | 8 | 37.5% |
| | Outbound | 133 | 367 | 36.2% |
| | Outbound + Marketing | 19 | 28 | 67.9% |
| | Re-Engagement | 1 | 2 | 50.0% |
| | Recruitment Firm | 27 | 42 | 64.3% |
| **2025-Q2** | Advisor Referral | 5 | 5 | 100.0% |
| | Job Applications | 10 | 41 | 24.4% |
| | Marketing | 12 | 19 | 63.2% |
| | Other | 2 | 9 | 22.2% |
| | Outbound | 105 | 300 | 35.0% |
| | Outbound + Marketing | 8 | 8 | 100.0% |
| | Re-Engagement | 0 | 2 | 0.0% |
| | Recruitment Firm | 12 | 21 | 57.1% |
| **2025-Q1** | Advisor Referral | 1 | 1 | 100.0% |
| | Job Applications | 8 | 58 | 13.8% |
| | Marketing | 6 | 18 | 33.3% |
| | Other | 1 | 10 | 10.0% |
| | Outbound | 89 | 327 | 27.2% |
| | Outbound + Marketing | 8 | 9 | 88.9% |
| | Recruitment Firm | 10 | 20 | 50.0% |

#### SQL -> SQO (cohorted on converted date)

| Quarter | Finance_View__c | Num | Den | Rate |
|---|---|---|---|---|
| **2026-Q1** | Advisor Referral | 1 | 1 | 100.0% |
| | Job Applications | 2 | 3 | 66.7% |
| | Marketing | 5 | 6 | 83.3% |
| | Outbound | 72 | 102 | 70.6% |
| | Outbound + Marketing | 11 | 15 | 73.3% |
| | Re-Engagement | 12 | 15 | 80.0% |
| | Recruitment Firm | 13 | 14 | 92.9% |
| **2025-Q4** | Advisor Referral | 6 | 6 | 100.0% |
| | Job Applications | 5 | 7 | 71.4% |
| | Marketing | 10 | 12 | 83.3% |
| | Other | 1 | 1 | 100.0% |
| | Outbound | 61 | 113 | 54.0% |
| | Outbound + Marketing | 12 | 15 | 80.0% |
| | Re-Engagement | 9 | 12 | 75.0% |
| | Recruitment Firm | 21 | 25 | 84.0% |
| **2025-Q3** | Advisor Referral | 2 | 2 | 100.0% |
| | Job Applications | 10 | 12 | 83.3% |
| | Marketing | 16 | 23 | 69.6% |
| | Other | 2 | 3 | 66.7% |
| | Outbound | 78 | 134 | 58.2% |
| | Outbound + Marketing | 5 | 18 | 27.8% |
| | Re-Engagement | 0 | 1 | 0.0% |
| | Recruitment Firm | 27 | 27 | 100.0% |
| **2025-Q2** | Advisor Referral | 5 | 5 | 100.0% |
| | Job Applications | 3 | 10 | 30.0% |
| | Marketing | 11 | 11 | 100.0% |
| | Other | 2 | 2 | 100.0% |
| | Outbound | 67 | 106 | 63.2% |
| | Outbound + Marketing | 6 | 8 | 75.0% |
| | Recruitment Firm | 11 | 11 | 100.0% |
| **2025-Q1** | Advisor Referral | 1 | 1 | 100.0% |
| | Job Applications | 2 | 6 | 33.3% |
| | Marketing | 6 | 7 | 85.7% |
| | Other | 1 | 1 | 100.0% |
| | Outbound | 60 | 86 | 69.8% |
| | Outbound + Marketing | 7 | 8 | 87.5% |
| | Recruitment Firm | 8 | 11 | 72.7% |

#### SQO -> Joined (cohorted on SQO date)

| Quarter | Finance_View__c | Num | Den | Rate |
|---|---|---|---|---|
| **2026-Q1** | Advisor Referral | 0 | 0 | n/a |
| | Job Applications | 0 | 1 | 0.0% |
| | Marketing | 0 | 2 | 0.0% |
| | Outbound | 0 | 21 | 0.0% |
| | Outbound + Marketing | 0 | 1 | 0.0% |
| | Re-Engagement | 0 | 5 | 0.0% |
| | Recruitment Firm | 0 | 2 | 0.0% |
| **2025-Q4** | Advisor Referral | 3 | 6 | 50.0% |
| | Job Applications | 1 | 4 | 25.0% |
| | Marketing | 1 | 10 | 10.0% |
| | Other | 0 | 1 | 0.0% |
| | Outbound | 4 | 48 | 8.3% |
| | Outbound + Marketing | 0 | 10 | 0.0% |
| | Re-Engagement | 3 | 16 | 18.8% |
| | Recruitment Firm | 2 | 13 | 15.4% |
| **2025-Q3** | Advisor Referral | 4 | 5 | 80.0% |
| | Job Applications | 2 | 8 | 25.0% |
| | Marketing | 1 | 12 | 8.3% |
| | Other | 0 | 2 | 0.0% |
| | Outbound | 8 | 63 | 12.7% |
| | Outbound + Marketing | 1 | 4 | 25.0% |
| | Re-Engagement | 1 | 2 | 50.0% |
| | Recruitment Firm | 4 | 25 | 16.0% |
| **2025-Q2** | Advisor Referral | 5 | 6 | 83.3% |
| | Job Applications | 0 | 3 | 0.0% |
| | Marketing | 0 | 8 | 0.0% |
| | Other | 0 | 1 | 0.0% |
| | Outbound | 5 | 66 | 7.6% |
| | Outbound + Marketing | 0 | 3 | 0.0% |
| | Re-Engagement | 0 | 1 | 0.0% |
| | Recruitment Firm | 2 | 10 | 20.0% |
| **2025-Q1** | Advisor Referral | 1 | 2 | 50.0% |
| | Employee Referral | 0 | 1 | 0.0% |
| | Job Applications | 0 | 2 | 0.0% |
| | Marketing | 1 | 5 | 20.0% |
| | Outbound | 5 | 59 | 8.5% |
| | Outbound + Marketing | 0 | 6 | 0.0% |
| | Re-Engagement | 2 | 5 | 40.0% |
| | Recruitment Firm | 2 | 8 | 25.0% |
<!-- CLAUDE_CODE_ANSWER_END -->

---

## 3. Side-by-Side Comparison

### 3.1 -- Q1 2026 rate comparison: Old view vs Current funnel master

For each Finance_View x conversion pair, show:
- Old rate (from BQ view or sheet export)
- Current rate (from section 2.3)
- Delta (percentage points)
- Impact direction (which is higher?)

**Answer**:
<!-- CLAUDE_CODE_ANSWER_START -->
**Mapping note:** Old `Partnerships` = Current `Recruitment Firm`. Old `Advisor Referrals` has no Q1 2026 data. Current has `Job Applications` and `Employee Referral` with no old equivalent.

#### Contacted -> MQL (Q1 2026)

| Finance_View (Old) | Finance_View (Current) | Old Rate | Current Rate | Delta (pp) | Higher |
|---|---|---|---|---|---|
| Outbound | Outbound | 1.2% | 3.1% | +1.9 | Current |
| Marketing | Marketing | 11.3% | 18.3% | +7.0 | Current |
| Outbound + Marketing | Outbound + Marketing | 4.7% | 21.4% | +16.7 | Current |
| Partnerships | Recruitment Firm | 0.0% | 44.4% | +44.4 | Current |
| Re-Engagement | Re-Engagement | 0.0% | 33.3% | +33.3 | Current |
| Other | Other | 2.1% | 3.6% | +1.5 | Current |
| Advisor Referrals | Advisor Referral | n/a | n/a (1 rec) | -- | -- |

#### MQL -> SQL (Q1 2026)

| Finance_View (Old) | Finance_View (Current) | Old Rate | Current Rate | Delta (pp) | Higher |
|---|---|---|---|---|---|
| Outbound | Outbound | 43.4% | 43.8% | +0.4 | ~Equal |
| Marketing | Marketing | 58.6% | 62.5% | +3.9 | Current |
| Outbound + Marketing | Outbound + Marketing | 23.1% | 41.0% | +17.9 | Current |
| Partnerships | Recruitment Firm | 81.8% | 66.7% | -15.1 | Old |
| Re-Engagement | Re-Engagement | n/a | 100.0% | -- | -- |
| Other | Other | 62.5% | 0.0% | -62.5 | Old |

#### SQL -> SQO (Q1 2026)

| Finance_View (Old) | Finance_View (Current) | Old Rate | Current Rate | Delta (pp) | Higher |
|---|---|---|---|---|---|
| Outbound | Outbound | 68.5% | 70.6% | +2.1 | ~Equal |
| Marketing | Marketing | 64.7% | 83.3% | +18.6 | Current |
| Outbound + Marketing | Outbound + Marketing | 33.3% | 73.3% | +40.0 | Current |
| Partnerships | Recruitment Firm | 69.2% | 92.9% | +23.7 | Current |
| Re-Engagement | Re-Engagement | 100.0% | 80.0% | -20.0 | Old |
| Other | Other | 53.3% | n/a (0 den) | -- | -- |

#### SQO -> Joined (Q1 2026)

| Finance_View (Old) | Finance_View (Current) | Old Rate | Current Rate | Higher |
|---|---|---|---|---|
| ALL | ALL | 0.0% | 0.0% | Equal |

**Note:** Q2J is 0% for both views for Q1 2026 -- too recent for any SQOs to have joined or closed lost.
<!-- CLAUDE_CODE_ANSWER_END -->

### 3.2 -- Which conversion pair x Finance_View has the largest discrepancy?

List the top 10 biggest rate differences.

**Answer**:
<!-- CLAUDE_CODE_ANSWER_START -->
**Top 10 largest rate discrepancies (Q4 2025 + Q1 2026, sorted by absolute delta):**

| Rank | Quarter | Finance_View | Conversion | Old Rate | Current Rate | Delta (pp) |
|---|---|---|---|---|---|---|
| 1 | Q1 2026 | Other | MQL->SQL | 62.5% | 0.0% | -62.5 |
| 2 | Q1 2026 | Partnerships/Recruit Firm | C->MQL | 0.0% | 44.4% | +44.4 |
| 3 | Q1 2026 | Outbound + Marketing | SQL->SQO | 33.3% | 73.3% | +40.0 |
| 4 | Q1 2026 | Re-Engagement | C->MQL | 0.0% | 33.3% | +33.3 |
| 5 | Q4 2025 | Marketing | C->MQL | 13.1% | 42.9% | +29.8 |
| 6 | Q1 2026 | Partnerships/Recruit Firm | SQL->SQO | 69.2% | 92.9% | +23.7 |
| 7 | Q1 2026 | Re-Engagement | SQL->SQO | 100.0% | 80.0% | -20.0 |
| 8 | Q1 2026 | Marketing | SQL->SQO | 64.7% | 83.3% | +18.6 |
| 9 | Q1 2026 | Outbound + Marketing | MQL->SQL | 23.1% | 41.0% | +17.9 |
| 10 | Q1 2026 | Outbound + Marketing | C->MQL | 4.7% | 21.4% | +16.7 |

**Pattern**: Current rates are almost universally higher than old rates. The structural cause is the resolution-based denominator (smaller denominator = higher rate). The few cases where old > current (Other MQL->SQL, Re-Engagement SQL->SQO) are small-sample-size artifacts (3 and 6 records respectively).

The Outbound C->MQL difference is the most impactful by volume: 1.2% vs 3.1% applied to ~29,000 contacted = ~550 phantom MQLs if the current rate were used in the forecast.
<!-- CLAUDE_CODE_ANSWER_END -->

### 3.3 -- Waterfall impact: How do compounded rate differences affect forecast SQOs?

For each Finance_View, compute:
- `Old waterfall`: Old Prospects x Old C->MQL x Old MQL->SQL x Old SQL->SQO = forecast SQOs
- `New waterfall`: Same prospects x New rates = forecast SQOs
- `Delta SQOs`

Use Q4 2025 as the base quarter (most recent completed quarter with full data).

**Answer**:
<!-- CLAUDE_CODE_ANSWER_START -->
**Waterfall: Contacted Volume x C2M x M2S x S2Q = Forecast SQOs (Q4 2025)**

Using the old view's contacted denominator as the "contacted volume" input for both waterfalls:

| Finance_View | Contacted Vol | Old C2M | Old M2S | Old S2Q | **Old SQOs** | New C2M | New M2S | New S2Q | **New SQOs** | **Delta** |
|---|---|---|---|---|---|---|---|---|---|---|
| **Outbound** | 27,457 | 2.35% | 27.65% | 49.58% | **88** | 4.23% | 32.35% | 54.0% | **203** | **+115** |
| **Marketing** | 175 | 13.14% | 65.22% | 73.68% | **11** | 42.86% | 66.67% | 83.33% | **42** | **+31** |
| **O+M** | 32 | 37.50% | 69.23% | 72.73% | **6** | 18.64% | 80.00% | 80.00% | **4** | **-2** |
| **Partnerships/Recruit** | 24 | 50.00% | 77.42% | 84.00% | **8** | 53.85% | 77.42% | 84.00% | **9** | **+1** |
| **Re-Engagement** | 10 | 80.00% | 100.0% | 88.46% | **7** | 80.00% | 100.0% | 75.00% | **6** | **-1** |
| **Advisor Ref** | 2 | 100.0% | 100.0% | 100.0% | **2** | 100.0% | 100.0% | 100.0% | **2** | **0** |
| **Other** | 740 | 2.03% | 26.67% | 50.00% | **2** | 4.43% | 11.11% | 100.0% | **4** | **+2** |
| **TOTAL** | | | | | **124** | | | | **270** | **+146** |

**Math detail for Outbound (largest impact):**
- Old: 27,457 x 0.0235 = 645 MQLs -> x 0.2765 = 178 SQLs -> x 0.4958 = **88 SQOs**
- New: 27,457 x 0.0423 = 1,161 MQLs -> x 0.3235 = 376 SQLs -> x 0.5400 = **203 SQOs**
- Delta: +115 SQOs (+131%)

**The compounding effect is massive.** Using current funnel master rates in the forecast would predict 2.2x more SQOs than the old rates. This is almost entirely driven by:
1. **C2M denominator change** (biggest factor): Resolution-based denominators are ~3x smaller, inflating C2M rates ~2x
2. **S2Q rate increase**: Current rates are higher because cross-period SQOs are captured
3. **M2S rates**: Similar between views (least affected by methodology change)

**WARNING**: These rates are NOT interchangeable. Using current funnel master rates with old-style volume inputs would massively over-forecast because the rates assume smaller, resolution-filtered denominators.
<!-- CLAUDE_CODE_ANSWER_END -->

---

## 4. Denominator Logic Deep Dive

### 4.1 -- Same-period vs resolution-based denominators

The old view's conversion denominators require BOTH events to happen in the SAME period. The current funnel master denominators include any record that eventually resolved (progressed or closed).

**Question**: For Q4 2025, how many records are in the CURRENT denominator but would NOT be in the OLD denominator (because their resolution crossed a quarter boundary)?

```sql
-- Example for Contacted -> MQL:
-- Old logic: is_contacted = 1 (same-quarter progression only)
-- Current logic: is_contacted = 1 AND (is_mql = 1 OR lead_closed_date IS NOT NULL) -- resolved anytime
SELECT
  'Contacted->MQL' AS pair,
  COUNTIF(is_contacted = 1) AS old_denom_approx,
  COUNTIF(eligible_for_contacted_conversions = 1) AS current_denom,
  COUNTIF(eligible_for_contacted_conversions = 1) - COUNTIF(is_contacted = 1) AS delta
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE DATE(stage_entered_contacting__c) BETWEEN '2025-10-01' AND '2025-12-31'
```

Run for all four conversion pairs.

**Answer**:
<!-- CLAUDE_CODE_ANSWER_START -->
**Q4 2025 denominator comparison:**

| Conversion Pair | Old Denom (all at stage) | Current Denom (resolved only) | Delta | % Reduction |
|---|---|---|---|---|
| **Contacted -> MQL** | 14,417 | 10,028 | **-4,389** | -30.4% |
| **MQL -> SQL** | 592 | 474 | **-118** | -19.9% |
| **SQL -> SQO** | 193 | 191 | **-2** | -1.0% |
| **SQO -> Joined** | 146 | 108 | **-38** | -26.0% |

**Key insight: The current denominator is SMALLER, not larger.** This is counterintuitive but correct:

- **Old denominator** = ALL records that reached that stage in the period (regardless of outcome)
- **Current denominator** = Only records that RESOLVED (progressed to next stage OR closed)

The 4,389 records excluded from the C2M denominator are contacted leads that are **still open** -- they haven't become MQL and haven't been closed yet. The old view counts them in the denominator (dragging the rate down), while the current view excludes them until they resolve.

This is the **primary driver** of the rate difference: removing ~30% of the denominator at C2M mechanically increases the rate by ~43% (1/0.7 = 1.43x).

At the SQL->SQO level, virtually all SQLs resolve quickly (become SQO or close), so the denominators nearly match (-1.0%).
<!-- CLAUDE_CODE_ANSWER_END -->

### 4.2 -- Does the Google Sheet expect same-period or resolution-based rates?

**Question**: The forecast waterfall is: `Volume x Rate = Next Stage Volume`. For this to be internally consistent, do the sheet's conversion rates need to be same-period (matching the volume view's cohort logic) or resolution-based (matching the dashboard)?

Examine the formulas in the conversion rate rows of the Q2 forecast tab to determine which approach the sheet uses.

**Answer**:
<!-- CLAUDE_CODE_ANSWER_START -->
**The sheet does NOT use conversion rates in the waterfall at all.** Examination of the Q2 forecast formulas reveals:

**Volume formulas (rows 11-17, 20-26, 29-35, 38-44, 47-53):** Each stage's volume is pulled **directly** from the `Volumes` tab using SUMPRODUCT:
```
=SUMPRODUCT((Volumes!$D$2:$D$1000=$C$8)*(Volumes!$F$2:$F$1000=$C$7)
  *((Volumes!$A$2:$A$1000="QTD")+(Volumes!$A$2:$A$1000="QUARTERLY"))
  *(Volumes!$L$2:$L$1000=$B$11)*(Volumes!$M$2:$M$1000))
```

Volumes at each stage are pulled independently -- Prospects from col M, Contacted from col N, MQL from col O, SQL from col P, SQO from col Q, Joined from col R.

**There is no multiplicative waterfall (Volume x Rate x Rate x Rate) in the historical columns.** The sheet displays actual volumes at each stage, not forecasted values derived from rates.

**For the Q2 FORECAST columns (G onward):** The forecast uses the detail-level rows (rows 106+) with SGA-level pipeline data and manual "gap filler" + "minimum" targets. It does NOT multiply trailing rates x volumes.

**The `monthly_conversion_rates` tab exists in the sheet but is not referenced by any formula in the Q2 forecast tab.** It appears to be a reference/comparison data source, not an input to the forecast model.

**Implication for the new view**: The volume view is the critical one for the sheet. The conversion rate view is supplementary -- it informs rate assumptions but isn't wired into the forecast formulas directly. The new view should prioritize matching the volume view's Finance_View labels and column schema.
<!-- CLAUDE_CODE_ANSWER_END -->

---

## 5. Summary & Recommendations

### 5.1 -- Which conversion rate methodology should the new view use?

Options:
- A) Same-period progression (matches old view, simpler, but different from dashboard)
- B) Resolution-based cohort (matches dashboard, more accurate, but different from old view)
- C) Hybrid (same-period for the sheet, resolution-based for the dashboard)

**Recommendation**:
<!-- CLAUDE_CODE_ANSWER_START -->
**Recommendation: Option C (Hybrid) -- but with a twist.**

**For the BQ export view (sheet-facing):** Use **same-period progression** methodology.

Rationale:
1. **The sheet doesn't use rates in formulas** -- it pulls volumes directly. The conversion rate tab is informational only.
2. **Same-period rates are more conservative** -- they're useful as trailing indicators without overstating conversion efficiency. Finance/leadership can see "of the people we contacted this quarter, how many progressed this quarter."
3. **Consistency with volumes** -- if the volume view counts MQLs when `mql_stage_entered_ts` falls in the period, then the C2M rate denominator should also count all contacts in that period (not just resolved ones). Otherwise rates and volumes are logically inconsistent.
4. **The SQO->Joined problem** -- same-period Q2J will always undercount because joining takes months. This is a known limitation. The sheet can note "Q2J = trailing indicator, lagging."

**For the dashboard:** Continue using **resolution-based cohort** methodology (the current `vw_funnel_master` approach).

Rationale:
1. Resolution-based rates give a truer picture of funnel efficiency for operational use.
2. The dashboard already uses this approach -- changing it would break user expectations.
3. The 30-day timeout variant (`eligible_for_contacted_conversions_30d`) handles the "still open" problem for near-real-time dashboarding.

**Critical implementation note:** The new conversion rate view should clearly label its methodology (e.g., column `rate_methodology = 'same_period'`) so consumers know which approach produced the numbers.
<!-- CLAUDE_CODE_ANSWER_END -->

### 5.2 -- What the new conversion rate view must output

Specify:
1. Column schema (must match what the sheet formulas reference)
2. Finance_View values (must match sheet row labels)
3. Numerator/denominator methodology
4. Period granularity (monthly, quarterly, both?)

**Specification**:
<!-- CLAUDE_CODE_ANSWER_START -->
**New view: `vw_channel_conversion_rates_pivoted` (replacement)**

#### 1. Column Schema (must match sheet's `monthly_conversion_rates` tab)

| Column | Type | Description |
|---|---|---|
| `period_type` | STRING | `MONTHLY`, `QUARTERLY`, `QTD` |
| `cohort_period` | DATE | First day of the period |
| `period_label` | STRING | e.g., `2026-Q1 QTD`, `2025-Q4`, `2025-12` |
| `cohort_year` | INT64 | Year number |
| `cohort_month_num` | INT64 | Month (1-12), NULL for quarterly |
| `cohort_quarter_num` | INT64 | Quarter (1-4) |
| `Channel_Grouping_Name` | STRING | Dashboard grouping (post-CASE override) |
| `Original_source` | STRING | `Final_Source__c` value |
| `Original_Source_Grouping` | STRING | Source grouping |
| `Source_Channel_Mapping` | STRING | Source-to-channel mapping |
| `Finance_View` | STRING | **Must output old labels** (see mapping below) |
| `contacted_to_mql_numerator` | INT64 | Same-period progression count |
| `contacted_to_mql_denominator` | INT64 | All contacted in period |
| `contacted_to_mql_rate` | FLOAT64 | Numerator / Denominator |
| `contacted_to_mql_pct` | STRING | Rate formatted as percentage |
| `mql_to_sql_numerator` | INT64 | |
| `mql_to_sql_denominator` | INT64 | |
| `mql_to_sql_rate` | FLOAT64 | |
| `mql_to_sql_pct` | STRING | |
| `sql_to_sqo_numerator` | INT64 | |
| `sql_to_sqo_denominator` | INT64 | |
| `sql_to_sqo_rate` | FLOAT64 | |
| `sql_to_sqo_pct` | STRING | |
| `sqo_to_joined_numerator` | INT64 | |
| `sqo_to_joined_denominator` | INT64 | |
| `sqo_to_joined_rate` | FLOAT64 | |
| `sqo_to_joined_pct` | STRING | |
| `contacted_volume` | INT64 | Total contacted in period |
| `mql_volume` | INT64 | |
| `sql_volume` | INT64 | |
| `sqo_volume` | INT64 | |
| `created_to_contacted_numerator` | INT64 | |
| `created_to_contacted_denominator` | INT64 | |
| `created_to_contacted_rate` | FLOAT64 | |
| `created_to_contacted_pct` | STRING | |
| `prospect_volume` | INT64 | |
| `last_updated` | TIMESTAMP | View refresh timestamp |

#### 2. Finance_View Mapping (SF `Finance_View__c` -> Sheet label)

The new view must output the 7 labels the sheet expects:

| SF `Finance_View__c` | Output `Finance_View` | Notes |
|---|---|---|
| `Outbound` | `Outbound` | Direct match |
| `Marketing` | `Marketing` | Direct match |
| `Job Applications` | `Marketing` | Fold into Marketing (matches dashboard `Channel_Grouping_Name` override) |
| `Outbound + Marketing` | `Outbound + Marketing` | Direct match |
| `Re-Engagement` | `Re-Engagement` | Direct match |
| `Recruitment Firm` | `Partnerships` | Reverse of dashboard CASE override |
| `Advisor Referral` | `Advisor Referrals` | Add trailing 's' for sheet compatibility |
| `Employee Referral` | `Other` | Fold into Other (tiny volume) |
| `Other` | `Other` | Direct match |
| NULL | `Other` | Default |

#### 3. Numerator/Denominator Methodology

**Same-period progression** (matches old view):

| Rate | Numerator | Denominator |
|---|---|---|
| C -> MQL | Contacted in period P AND MQL date also in period P | All contacted in period P |
| MQL -> SQL | MQL in period P AND converted date also in period P | All MQL in period P |
| SQL -> SQO | SQL in period P AND SQO date also in period P | All SQL in period P |
| SQO -> Joined | SQO in period P AND join date also in period P | All SQO in period P |

**Data source**: `vw_funnel_master` (inherits the current view's source field and Re-Engagement inclusion). Apply the Finance_View mapping CASE statement to translate.

#### 4. Period Granularity

- **MONTHLY** rows: For every month where data exists
- **QUARTERLY** rows: For completed quarters only (sum of 3 monthly rows)
- **QTD** rows: For the current incomplete quarter (rolling sum of months so far)

All three period types should be output because the sheet formulas filter on `period_type IN ('QTD', 'QUARTERLY')`.
<!-- CLAUDE_CODE_ANSWER_END -->

---

*Exploration complete. Combined with volume_comparison_exploration.md findings, this provides the full spec for rebuilding both BQ views.*
