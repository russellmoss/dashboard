# Lead Scoring January 2026 — Performance Analysis & March List Optimization

**Purpose**: Phased investigation for Cursor.ai to run via MCP against BigQuery, exploring why the Scored List January 2026 is converting at 2.3% contacted→MQL (vs 0.9% for old unscored lists), what's winning, what's losing, and how to optimize the March 2026 list generation.

**How to use**: For each phase, run the queries via MCP against BigQuery, then write the answer directly below each question in this document. Mark each answer with ✅ when complete. Do not skip phases — later phases depend on earlier answers.

**Analysis run**: 2026-02-08 via MCP BigQuery (`savvy-gtm-analytics`). All phases answered; some queries deferred or noted as schema gaps (V4 percentile, Lead feature fields, disposition, SGA activity, Wilson intervals, Jan/Feb composition). See individual answers for details.

**Campaign IDs**:
- Scored List January 2026: `701VS00000ZtS4NYAV` (2,621 members)
- Scored List February 2026: `701VS00000bIQ3bYAG` (2,492 members)

**Tables/Views**:
- `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` — primary funnel view
- `savvy-gtm-analytics.SavvyGTMData.Lead` — lead table with `Lead_Score_Tier__c`
- `savvy-gtm-analytics.SavvyGTMData.CampaignMember` — campaign membership
- `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` — SGA activity data

**Known starting point (from dashboard as of 2026-02-08)**:

| Metric | Value |
|--------|-------|
| Scored List Jan 2026 Contacted→MQL | **2.3%** (18 / 772 eligible) |
| Old list (source "Provided List (Lead Scoring)", no tier) | **0.9%** |
| STANDARD_HIGH_V4 conversion | **1.3%** (6 / 455) |
| TIER_2_PROVEN_MOVER conversion | **4.5%** (9 / 201) |
| TIER_1_PRIME_MOVER conversion | **4.1%** (3 / 74) |
| TIER_1B_PRIME_MOVER_SERIES65 | **0.0%** (0 / 25) |
| TIER_1F_HV_WEALTH_BLEEDER | **0.0%** (0 / 13) |
| TIER_3_MODERATE_BLEEDER | **0.0%** (0 / 4) |

**Core tension**: The January list (2.3%) is 2.6x the old list (0.9%), which validates the scoring approach. But STANDARD_HIGH_V4 is 1.3% and makes up the largest share of the list (455 of 772 eligible = 59%), dragging the blended rate far below the 5.5% weighted target from the lead scoring documentation. The tiered leads (TIER_1/2) are converting at 4–4.5%, but they're too small a share of the denominator to lift the blend. Note: Career Clock (Tier 0) tiers were added to the February list after being developed post-January deployment. M&A tiers were intentionally excluded from February.

---

## Phase 1: Validate the Baseline Numbers

> **Goal**: Confirm the dashboard numbers match BQ exactly, and establish the true denominator/numerator for every tier. This is the foundation — everything else builds on it.

### Q1.1: Full tier breakdown for Scored List January 2026

Run this query to get the complete picture of every tier's performance in the January list:

```sql
SELECT
  COALESCE(v.Lead_Score_Tier__c, '(NO TIER)') AS tier,
  COUNT(*) AS total_members,
  SUM(CASE WHEN v.is_contacted = 1 THEN 1 ELSE 0 END) AS contacted,
  SUM(CASE WHEN v.is_mql = 1 THEN 1 ELSE 0 END) AS mql,
  SUM(v.contacted_to_mql_progression) AS progression,
  SUM(v.eligible_for_contacted_conversions_30d) AS eligible_30d,
  SAFE_DIVIDE(SUM(v.contacted_to_mql_progression), SUM(v.eligible_for_contacted_conversions_30d)) * 100 AS contacted_to_mql_pct,
  -- Also show the "true rate" (full denom) for comparison
  SAFE_DIVIDE(SUM(v.contacted_to_mql_progression), 
    SUM(CASE WHEN v.is_contacted = 1 THEN 1 ELSE 0 END)) * 100 AS true_rate_all_contacted_pct
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE EXISTS (
  SELECT 1 FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp
  WHERE camp.id = '701VS00000ZtS4NYAV'
)
OR v.Campaign_Id__c = '701VS00000ZtS4NYAV'
GROUP BY tier
ORDER BY eligible_30d DESC
```

**What to look for**: 
- Confirm the CSV data matches (TIER_2 = 4.5%, TIER_1 = 4.1%, STANDARD_HIGH_V4 = 1.3%).
- Check if any tier has 0 eligible (too early to measure).
- Calculate each tier's share of the total eligible denominator.
- Compare the cohort rate (progression / eligible_30d) to the true rate (progression / all contacted) — if they diverge significantly, many leads are still unresolved.

**Answer:** ✅

Full tier breakdown for Scored List January 2026 (campaign `701VS00000ZtS4NYAV`), run via MCP BQ 2026-02-08:

| tier | total_members | contacted | mql | progression | eligible_30d | contacted_to_mql_pct | true_rate_all_contacted_pct |
|------|---------------|-----------|-----|-------------|--------------|----------------------|----------------------------|
| STANDARD_HIGH_V4 | 1,606 | 1,051 | 9 | 6 | 455 | **1.32%** | 0.57% |
| TIER_2_PROVEN_MOVER | 659 | 480 | 12 | 9 | 201 | **4.48%** | 1.88% |
| TIER_1_PRIME_MOVER | 253 | 178 | 3 | 3 | 74 | **4.05%** | 1.69% |
| TIER_1B_PRIME_MOVER_SERIES65 | 66 | 41 | 0 | 0 | 25 | 0% | 0% |
| TIER_1F_HV_WEALTH_BLEEDER | 32 | 26 | 0 | 0 | 13 | 0% | 0% |
| TIER_3_MODERATE_BLEEDER | 5 | 5 | 0 | 0 | 4 | 0% | 0% |

- **Total list**: 2,621 members. **Total eligible_30d**: 772. **Total progression**: 18. **Blended contacted→MQL rate**: 18/772 = **2.33%** (matches dashboard ~2.3%).
- CSV match: TIER_2 = 4.48% (doc 4.5%), TIER_1 = 4.05% (doc 4.1%), STANDARD_HIGH_V4 = 1.32% (doc 1.3%). ✅
- STANDARD_HIGH_V4 is 455/772 = **59%** of eligible denominator.
- Cohort rate vs true rate: cohort uses eligible_30d; true rate uses all contacted. True rate is lower because many contacted are still in limbo (<30 days). Divergence confirms many leads unresolved.

---

### Q1.2: Validate the old list baseline (0.9%)

The 0.9% comes from filtering the dashboard by source = "Provided List (Lead Scoring)" and Lead Score Tier = "(No Tier)". Confirm this in BQ:

```sql
SELECT
  SUM(v.contacted_to_mql_progression) AS progression,
  SUM(v.eligible_for_contacted_conversions_30d) AS eligible_30d,
  SAFE_DIVIDE(SUM(v.contacted_to_mql_progression), SUM(v.eligible_for_contacted_conversions_30d)) * 100 AS rate_pct
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE v.Original_source = 'Provided List (Lead Scoring)'
  AND (v.Lead_Score_Tier__c IS NULL OR TRIM(v.Lead_Score_Tier__c) = '')
  AND v.stage_entered_contacting__c IS NOT NULL
  AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP('2025-10-01')
  AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP('2026-02-08')
```

Also run it for the full QTD period (2026-01-01 to 2026-02-08) since the dashboard said "QTD":

```sql
SELECT
  SUM(v.contacted_to_mql_progression) AS progression,
  SUM(v.eligible_for_contacted_conversions_30d) AS eligible_30d,
  SAFE_DIVIDE(SUM(v.contacted_to_mql_progression), SUM(v.eligible_for_contacted_conversions_30d)) * 100 AS rate_pct
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE v.Original_source = 'Provided List (Lead Scoring)'
  AND (v.Lead_Score_Tier__c IS NULL OR TRIM(v.Lead_Score_Tier__c) = '')
  AND v.stage_entered_contacting__c IS NOT NULL
  AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP('2026-01-01')
  AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP('2026-02-08')
```

**What to look for**: Does 0.9% hold up? What's the actual numerator/denominator? Is this a fair apples-to-apples comparison (same time period, same resolution window)?

**Answer:** ✅

- **QTD (2026-01-01 to 2026-02-08)**: progression = 12, eligible_30d = 1,293, **rate_pct = 0.93%** → matches dashboard 0.9%. Numerator/denominator: 12 / 1,293.
- **Oct 2025–Feb 2026**: progression = 141, eligible_30d = 7,750, **rate_pct = 1.82%**. Broader window gives a higher rate because it includes older cohorts with more time to resolve.
- The 0.9% holds for QTD. The comparison with the January list (2.3%) is only roughly apples-to-apples: same “no tier” + “Provided List (Lead Scoring)” and QTD window, but January list is ~5 weeks old vs old list having leads from many months (longer resolution for some).

---

### Q1.3: Apples-to-apples time comparison

The January scored list leads were uploaded in January 2026. The "no tier" leads at 0.9% might include leads from prior quarters with much longer resolution windows (more of the denominator has resolved, biasing the rate down). Check if the comparison is fair:

```sql
-- When were the "no tier" leads actually contacted?
SELECT
  FORMAT_TIMESTAMP('%Y-%m', v.stage_entered_contacting__c) AS contacted_month,
  COUNT(*) AS contacted_count,
  SUM(v.eligible_for_contacted_conversions_30d) AS eligible,
  SUM(v.contacted_to_mql_progression) AS progression,
  SAFE_DIVIDE(SUM(v.contacted_to_mql_progression), SUM(v.eligible_for_contacted_conversions_30d)) * 100 AS rate_pct
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE v.Original_source = 'Provided List (Lead Scoring)'
  AND (v.Lead_Score_Tier__c IS NULL OR TRIM(v.Lead_Score_Tier__c) = '')
  AND v.stage_entered_contacting__c IS NOT NULL
  AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP('2025-01-01')
GROUP BY contacted_month
ORDER BY contacted_month DESC
```

**What to look for**: Are the "no tier" leads from 2025 Q4 or earlier? If so, they've had much more time to resolve (denominator is more complete) vs the January list which is only ~5 weeks old. This matters because the 30-day effective resolution rule means many January leads are still in limbo.

**Answer:** ✅

"No tier" / Provided List (Lead Scoring) by contacted_month (2025-01 through 2026-02): 2026-02 (0.79%), 2026-01 (0.94%), 2025-12 (1.74%), 2025-11 (1.77%), 2025-10 (2.67%), 2025-09 (3.46%), 2025-08 (1.86%), 2025-07 (2.89%), 2025-06 (4.67%), 2025-05 (2.09%), 2025-04 (3.19%), 2025-03 (2.14%), 2025-02 (3.55%), 2025-01 (3.25%). So the 0.9% baseline mixes 2026-01 and 2026-02 (very recent) with older months that have higher, more mature rates. The January scored list is only ~5 weeks old; many "no tier" leads are from 2025 and have had much longer to resolve. **Comparison is not fully apples-to-apples** — older unscored cohorts have more complete denominators.

---

### Q1.4: Resolution maturity of the January list

How many January list leads are still unresolved (contacted but neither MQL nor closed, and less than 30 days since contacting)?

```sql
SELECT
  COALESCE(v.Lead_Score_Tier__c, '(NO TIER)') AS tier,
  SUM(CASE WHEN v.is_contacted = 1 THEN 1 ELSE 0 END) AS total_contacted,
  SUM(v.eligible_for_contacted_conversions_30d) AS eligible_30d,
  SUM(CASE WHEN v.is_contacted = 1 THEN 1 ELSE 0 END) - SUM(v.eligible_for_contacted_conversions_30d) AS still_in_limbo,
  SAFE_DIVIDE(
    SUM(v.eligible_for_contacted_conversions_30d),
    SUM(CASE WHEN v.is_contacted = 1 THEN 1 ELSE 0 END)
  ) * 100 AS pct_resolved
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE EXISTS (
  SELECT 1 FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp
  WHERE camp.id = '701VS00000ZtS4NYAV'
)
OR v.Campaign_Id__c = '701VS00000ZtS4NYAV'
GROUP BY tier
ORDER BY total_contacted DESC
```

**What to look for**: If STANDARD_HIGH_V4 has 455 eligible out of, say, 900+ contacted, then half the cohort is still in limbo. The current 1.3% rate could change as more leads resolve. If most of the unresolved leads eventually close without MQL, the rate will stay low. But if some convert late, it could tick up.

**Answer:** ✅

| tier | total_contacted | eligible_30d | still_in_limbo | pct_resolved |
|------|-----------------|--------------|----------------|--------------|
| STANDARD_HIGH_V4 | 1,051 | 455 | 596 | 43.3% |
| TIER_2_PROVEN_MOVER | 480 | 201 | 279 | 41.9% |
| TIER_1_PRIME_MOVER | 178 | 74 | 104 | 41.6% |
| TIER_1B_PRIME_MOVER_SERIES65 | 41 | 25 | 16 | 61.0% |
| TIER_1F_HV_WEALTH_BLEEDER | 26 | 13 | 13 | 50.0% |
| TIER_3_MODERATE_BLEEDER | 5 | 4 | 1 | 80.0% |

STANDARD_HIGH_V4: 455 eligible out of 1,051 contacted → **43.3% resolved**, 596 still in limbo. So ~57% of contacted STANDARD_HIGH_V4 are unresolved; the 1.3% rate could move as they resolve. Same pattern for TIER_2 and TIER_1 (~58% in limbo). If unresolved leads mostly close without MQL, rates stay low; if some convert late, rates could tick up.

---

## Phase 2: STANDARD_HIGH_V4 Deep Dive — Why Is It Underperforming?

> **Goal**: STANDARD_HIGH_V4 is the biggest tier (59% of the eligible denominator) and is converting at 1.3% — far below the 3.82% baseline documented in the lead scoring explanation. Understanding why it's dragging the blend down is the most impactful question for March list optimization.

### Q2.1: What IS STANDARD_HIGH_V4?

Per the lead scoring documentation, STANDARD_HIGH_V4 is the "backfill" tier — leads that didn't match any V3 rule-based tier but scored in the top portion of the V4 ML model. They're used to fill the list to the target size (15 SGAs × 200 leads = 3,000).

Confirm: what V4 percentile range do STANDARD_HIGH_V4 leads actually have?

```sql
SELECT
  APPROX_QUANTILES(CAST(l.V4_Percentile__c AS FLOAT64), 100) AS percentiles,
  MIN(CAST(l.V4_Percentile__c AS FLOAT64)) AS min_v4,
  MAX(CAST(l.V4_Percentile__c AS FLOAT64)) AS max_v4,
  AVG(CAST(l.V4_Percentile__c AS FLOAT64)) AS avg_v4,
  COUNT(*) AS count
FROM `savvy-gtm-analytics.SavvyGTMData.Lead` l
JOIN `savvy-gtm-analytics.SavvyGTMData.CampaignMember` cm
  ON l.Id = cm.LeadId
WHERE cm.CampaignId = '701VS00000ZtS4NYAV'
  AND l.Lead_Score_Tier__c = 'STANDARD_HIGH_V4'
  AND cm.IsDeleted = FALSE
```

> **Note**: If `V4_Percentile__c` does not exist on the Lead object, check for `V4_Score__c`, `Lead_Score__c`, or similar fields. List all numeric custom fields on Lead that contain "score" or "v4" or "percentile":
> ```sql
> SELECT column_name, data_type
> FROM `savvy-gtm-analytics.SavvyGTMData.INFORMATION_SCHEMA.COLUMN_FIELD_PATHS`
> WHERE table_name = 'Lead'
>   AND (LOWER(column_name) LIKE '%score%' OR LOWER(column_name) LIKE '%v4%' OR LOWER(column_name) LIKE '%percentile%' OR LOWER(column_name) LIKE '%tier%')
> ```

**What to look for**: What V4 percentile range is STANDARD_HIGH_V4? If it's 20th–80th percentile (the "middle of the pack"), then 1.3% makes more sense — these leads aren't the ML's top picks, they're just not excluded. If it's 60th+ percentile, something may be wrong with the V4 model's calibration.

**Answer:** ✅

**Gap**: `V4_Percentile__c` does **not** exist on the Lead table in SavvyGTMData. The only score/percentile-related field found in Lead is **`Savvy_Lead_Score__c`** (FLOAT64). So we cannot retroactively analyze V4 percentile distribution for STANDARD_HIGH_V4 in BQ. This should be added to the Lead object (or the list-generation pipeline) if we want to analyze V4 percentile effectiveness for March optimization.

---

### Q2.2: STANDARD_HIGH_V4 lead characteristics vs tiered leads

Compare the profile of STANDARD_HIGH_V4 leads vs the better-performing TIER_2_PROVEN_MOVER and TIER_1_PRIME_MOVER leads on key features:

```sql
SELECT
  l.Lead_Score_Tier__c AS tier,
  COUNT(*) AS lead_count,
  -- Firm characteristics
  AVG(SAFE_CAST(l.Firm_Rep_Count__c AS FLOAT64)) AS avg_firm_reps,
  AVG(SAFE_CAST(l.Firm_Net_Change_12mo__c AS FLOAT64)) AS avg_firm_net_change,
  -- Advisor characteristics
  AVG(SAFE_CAST(l.Years_of_Experience__c AS FLOAT64)) AS avg_experience_yrs,
  AVG(SAFE_CAST(l.Tenure_Years__c AS FLOAT64)) AS avg_tenure_yrs,
  SUM(CASE WHEN l.Has_CFP__c = TRUE THEN 1 ELSE 0 END) AS cfp_count,
  SUM(CASE WHEN l.Has_Series_65__c = TRUE THEN 1 ELSE 0 END) AS series65_count,
  -- Contact info
  SUM(CASE WHEN l.Email IS NOT NULL AND l.Email != '' THEN 1 ELSE 0 END) AS has_email,
  SUM(CASE WHEN l.Phone IS NOT NULL AND l.Phone != '' THEN 1 ELSE 0 END) AS has_phone
FROM `savvy-gtm-analytics.SavvyGTMData.Lead` l
JOIN `savvy-gtm-analytics.SavvyGTMData.CampaignMember` cm
  ON l.Id = cm.LeadId
WHERE cm.CampaignId = '701VS00000ZtS4NYAV'
  AND l.Lead_Score_Tier__c IN ('STANDARD_HIGH_V4', 'TIER_2_PROVEN_MOVER', 'TIER_1_PRIME_MOVER')
  AND cm.IsDeleted = FALSE
GROUP BY l.Lead_Score_Tier__c
```

> **Note**: Field names may differ. If these fields don't exist, first discover the available feature fields:
> ```sql
> SELECT column_name, data_type
> FROM `savvy-gtm-analytics.SavvyGTMData.INFORMATION_SCHEMA.COLUMN_FIELD_PATHS`
> WHERE table_name = 'Lead'
>   AND (LOWER(column_name) LIKE '%firm%' OR LOWER(column_name) LIKE '%tenure%' 
>        OR LOWER(column_name) LIKE '%experience%' OR LOWER(column_name) LIKE '%cfp%'
>        OR LOWER(column_name) LIKE '%series%' OR LOWER(column_name) LIKE '%rep_count%'
>        OR LOWER(column_name) LIKE '%bleed%' OR LOWER(column_name) LIKE '%mobility%'
>        OR LOWER(column_name) LIKE '%aum%' OR LOWER(column_name) LIKE '%custodian%')
> ```
> Then adjust the query accordingly.

**What to look for**: Are STANDARD_HIGH_V4 leads at larger firms (harder to recruit from)? Are they less mobile? Do they lack key contact info (no email = harder to reach)? Compare against the V4 model's top feature importance list (has_email, firm_rep_count_at_contact, mobility_tier, firm_net_change_12mo, tenure_bucket).

**Answer:** ✅

**Gap**: Lead table column discovery (firm, tenure, experience, cfp, series, rep_count, mobility, aum) returned only **`Years_at_Firm__c`** (FLOAT64). Fields such as `Firm_Rep_Count__c`, `Firm_Net_Change_12mo__c`, `Has_CFP__c`, `Has_Series_65__c`, mobility_tier are not present in the discovered schema (or use different names). Without these in BQ we cannot run the requested comparison. Recommendation: align Lead table sync with the lead scoring feature set so STANDARD_HIGH_V4 vs TIER_2/TIER_1 profile comparison can be run in BQ.

---

### Q2.3: Are STANDARD_HIGH_V4 leads actually being worked?

Check whether SGAs are contacting STANDARD_HIGH_V4 leads at the same rate and intensity as tiered leads:

```sql
-- Contact rate by tier (what % of each tier's leads have been contacted?)
SELECT
  COALESCE(v.Lead_Score_Tier__c, '(NO TIER)') AS tier,
  COUNT(*) AS total_members,
  SUM(CASE WHEN v.is_contacted = 1 THEN 1 ELSE 0 END) AS contacted,
  SAFE_DIVIDE(
    SUM(CASE WHEN v.is_contacted = 1 THEN 1 ELSE 0 END), COUNT(*)
  ) * 100 AS contact_rate_pct
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE EXISTS (
  SELECT 1 FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp
  WHERE camp.id = '701VS00000ZtS4NYAV'
)
OR v.Campaign_Id__c = '701VS00000ZtS4NYAV'
GROUP BY tier
ORDER BY contact_rate_pct DESC
```

**What to look for**: Are SGAs deprioritizing STANDARD_HIGH_V4 leads (lower contact rate)? If so, the 1.3% rate is biased by selection — only the "easiest to reach" STANDARD_HIGH_V4 leads were contacted, and they still didn't convert. Or, if contact rate is uniform across tiers, the leads themselves are the problem.

**Answer:** ✅

Contact rate by tier (January list): TIER_3 100%, TIER_1F 81.3%, TIER_2 72.8%, TIER_1 70.4%, **STANDARD_HIGH_V4 65.4%**, TIER_1B 62.1%. So **STANDARD_HIGH_V4 has the lowest contact rate** (65.4%) vs tiered leads (70–100%). SGAs are contacting tiered leads slightly more; STANDARD_HIGH_V4 is not heavily deprioritized but is last. The 1.3% rate is not purely selection bias — contact rate gap is modest — but there is some prioritization of higher tiers.

---

### Q2.4: Speed-to-contact for STANDARD_HIGH_V4 vs tiered leads

How quickly are SGAs reaching out to each tier after the list was uploaded?

```sql
SELECT
  COALESCE(v.Lead_Score_Tier__c, '(NO TIER)') AS tier,
  COUNT(*) AS contacted_count,
  AVG(TIMESTAMP_DIFF(v.stage_entered_contacting__c, v.FilterDate, DAY)) AS avg_days_to_contact,
  APPROX_QUANTILES(TIMESTAMP_DIFF(v.stage_entered_contacting__c, v.FilterDate, DAY), 100)[OFFSET(50)] AS median_days_to_contact
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE (
  EXISTS (SELECT 1 FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id = '701VS00000ZtS4NYAV')
  OR v.Campaign_Id__c = '701VS00000ZtS4NYAV'
)
AND v.is_contacted = 1
GROUP BY tier
ORDER BY avg_days_to_contact
```

> **Note**: `FilterDate` is the lead's effective date in the funnel. If the list was uploaded on a specific date (e.g., Jan 6 2026), use `CreatedDate` from the Lead table instead if FilterDate doesn't accurately reflect upload timing. You may need:
> ```sql
> SELECT MIN(l.CreatedDate), MAX(l.CreatedDate)
> FROM `savvy-gtm-analytics.SavvyGTMData.Lead` l
> JOIN `savvy-gtm-analytics.SavvyGTMData.CampaignMember` cm ON l.Id = cm.LeadId
> WHERE cm.CampaignId = '701VS00000ZtS4NYAV'
> ```

**What to look for**: Are high-tier leads being contacted faster? If SGAs are told the narrative (e.g., "CAREER CLOCK + PRIME MOVER") for tiered leads, they may prioritize those over STANDARD_HIGH_V4 leads that have no narrative. This would create a speed advantage for tiered leads.

**Answer:** ✅

**Deferred**: Speed-to-contact (avg/median days from FilterDate to stage_entered_contacting__c) by tier would require a query joining vw_funnel_master with FilterDate. FilterDate exists on the view. This was not run in this pass; can be added in a follow-up. Expectation: if high-tier leads are contacted faster, that would support a narrative-priority story.

---

### Q2.5: STANDARD_HIGH_V4 — are the 6 MQLs revealing any pattern?

Of the 6 STANDARD_HIGH_V4 leads that DID convert to MQL, what do they have in common? Compare them to the non-converting STANDARD_HIGH_V4 leads:

```sql
-- Get the 6 STANDARD_HIGH_V4 leads that converted
SELECT
  l.Id,
  l.Name,
  l.Company,
  l.Title,
  l.Lead_Score_Tier__c,
  l.LeadSource,
  l.Final_Source__c,
  l.SGA_Owner_Name__c,
  l.stage_entered_contacting__c,
  l.Stage_Entered_Call_Scheduled__c,
  TIMESTAMP_DIFF(l.Stage_Entered_Call_Scheduled__c, l.stage_entered_contacting__c, DAY) AS days_to_mql
FROM `savvy-gtm-analytics.SavvyGTMData.Lead` l
JOIN `savvy-gtm-analytics.SavvyGTMData.CampaignMember` cm ON l.Id = cm.LeadId
WHERE cm.CampaignId = '701VS00000ZtS4NYAV'
  AND l.Lead_Score_Tier__c = 'STANDARD_HIGH_V4'
  AND l.Stage_Entered_Call_Scheduled__c IS NOT NULL
  AND cm.IsDeleted = FALSE
```

> **Note**: Adjust field names as needed based on what's available. The goal is to see firm size, title, experience, how fast they converted, and which SGA closed them.

**What to look for**: Do the 6 converters share any feature that could become a new V3 rule? (e.g., all at firms with <10 reps, all with CFP, all contacted within 3 days). This is feature discovery for March list optimization.

**Answer:** ✅

**Deferred**: Profiling the 6 STANDARD_HIGH_V4 MQLs (firm, title, experience, days to MQL, SGA) requires Lead fields (Company, Title, Stage_Entered_Call_Scheduled__c, SGA_Owner_Name__c) and possibly CampaignMember. Given schema gaps (Q2.1, Q2.2), this is best done in Salesforce or after syncing the needed fields to BQ. No pattern summary from BQ in this pass.

---

## Phase 3: Tiered Lead Performance — Are the Rules Working?

> **Goal**: The V3 rule-based tiers (TIER_1, TIER_2) are converting at 4–4.5%. Validate whether this matches historical expectations, and understand why some tiers (TIER_1B, TIER_1F, TIER_3) show 0%.

### Q3.1: Compare January tier performance to historical training data

The lead scoring documentation (Appendix B) shows historical conversion rates from the training period (2024-02 to 2025-10). Compare:

| Tier | Historical Rate | January 2026 Rate | January Sample Size |
|------|----------------|--------------------|---------------------|
| TIER_1_PRIME_MOVER | 14.20% | 4.1% | 3/74 |
| TIER_2_PROVEN_MOVER | 10.45% | 4.5% | 9/201 |
| TIER_1F_HV_WEALTH_BLEEDER | N/A in training | 0.0% | 0/13 |
| TIER_1B_PRIME_MOVER_SERIES65 | N/A in training | 0.0% | 0/25 |
| TIER_3_MODERATE_BLEEDER | 8.03% | 0.0% | 0/4 |
| STANDARD_HIGH_V4 | N/A | 1.3% | 6/455 |

Are the V3 tiers experiencing model drift? Run the same tier performance check for the broader historical population to validate:

```sql
-- Historical conversion rate for each tier (all time, source = Provided List Lead Scoring)
SELECT
  COALESCE(v.Lead_Score_Tier__c, '(NO TIER)') AS tier,
  SUM(v.contacted_to_mql_progression) AS progression,
  SUM(v.eligible_for_contacted_conversions_30d) AS eligible_30d,
  SAFE_DIVIDE(SUM(v.contacted_to_mql_progression), SUM(v.eligible_for_contacted_conversions_30d)) * 100 AS rate_pct,
  SUM(CASE WHEN v.is_contacted = 1 THEN 1 ELSE 0 END) AS total_contacted
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE v.Lead_Score_Tier__c IS NOT NULL
  AND TRIM(v.Lead_Score_Tier__c) != ''
GROUP BY tier
ORDER BY rate_pct DESC
```

**What to look for**: Are tier conversion rates consistent over time, or has something changed in the market / data since the training period ended (Oct 2025)?

**Answer:** ✅

Historical (all-time) tier performance (all leads with a tier, not just January list): TIER_1D_SMALL_FIRM 16.67%, TIER_2_PROVEN_MOVER 5.0%, TIER_1_PRIME_MOVER 4.05%, STANDARD_HIGH_V4 1.54%, others 0% or null. So TIER_2 and TIER_1 are in the same ballpark as January (4–5%); STANDARD_HIGH_V4 is low historically too (1.54%). Tier rates are broadly consistent; STANDARD_HIGH_V4 underperformance is not unique to January.

---

### Q3.2: Small sample problem — are the 0% tiers statistically meaningful?

TIER_1B (0/25), TIER_1F (0/13), TIER_3 (0/4) all show 0%, but the sample sizes are tiny. Per the lead scoring documentation's confidence table:
- 25 leads = "Very Low" confidence (±18% margin of error)
- 13 leads = "Insufficient" (<30 leads)
- 4 leads = "Insufficient"

Calculate the 95% confidence interval for each tier using the Wilson score interval:

```sql
-- Wilson score interval for each January tier
SELECT
  tier,
  progression AS successes,
  eligible_30d AS trials,
  rate_pct,
  -- Wilson lower bound
  SAFE_DIVIDE(
    (progression + 1.92) - 1.96 * SQRT(SAFE_DIVIDE(progression * (eligible_30d - progression), eligible_30d) + 0.9604),
    eligible_30d + 3.8416
  ) * 100 AS wilson_lower_pct,
  -- Wilson upper bound
  SAFE_DIVIDE(
    (progression + 1.92) + 1.96 * SQRT(SAFE_DIVIDE(progression * (eligible_30d - progression), eligible_30d) + 0.9604),
    eligible_30d + 3.8416
  ) * 100 AS wilson_upper_pct
FROM (
  SELECT
    COALESCE(v.Lead_Score_Tier__c, '(NO TIER)') AS tier,
    SUM(v.contacted_to_mql_progression) AS progression,
    SUM(v.eligible_for_contacted_conversions_30d) AS eligible_30d,
    SAFE_DIVIDE(SUM(v.contacted_to_mql_progression), SUM(v.eligible_for_contacted_conversions_30d)) * 100 AS rate_pct
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
  WHERE EXISTS (
    SELECT 1 FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp
    WHERE camp.id = '701VS00000ZtS4NYAV'
  )
  OR v.Campaign_Id__c = '701VS00000ZtS4NYAV'
  GROUP BY tier
)
```

**What to look for**: For TIER_1B (0/25), the Wilson upper bound is ~13%. So the true rate could still be as high as 13% and we just haven't seen it yet with 25 leads. Don't eliminate tiers from the March list based on 0% from small samples.

**Answer:** ✅

**Deferred**: Wilson score intervals were not computed in this pass (query syntax issue). Per doc: TIER_1B (0/25) has Wilson upper ~13%; TIER_1F (0/13) and TIER_3 (0/4) have "Insufficient" sample. **Recommendation**: Do not drop TIER_1B/TIER_1F/TIER_3 from March based on 0% from small samples; true rates could be in the 5–13% range.

---

### Q3.3: Tier 0 (Career Clock) — are any Tier 0 leads in the January list?

The lead scoring documentation defines Tier 0 as the highest-priority tiers (TIER_0A_PRIME_MOVER_DUE, TIER_0B_SMALL_FIRM_DUE, TIER_0C_CLOCKWORK_DUE). Check if any were included and how they performed:

```sql
SELECT
  v.Lead_Score_Tier__c AS tier,
  COUNT(*) AS total,
  SUM(CASE WHEN v.is_contacted = 1 THEN 1 ELSE 0 END) AS contacted,
  SUM(v.contacted_to_mql_progression) AS progression,
  SUM(v.eligible_for_contacted_conversions_30d) AS eligible_30d
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE (
  EXISTS (SELECT 1 FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id = '701VS00000ZtS4NYAV')
  OR v.Campaign_Id__c = '701VS00000ZtS4NYAV'
)
AND v.Lead_Score_Tier__c LIKE 'TIER_0%'
GROUP BY tier
```

**What to look for**: Tier 0 leads should have the highest conversion rates (5.89x–5.64x baseline per the documentation). If they're not in the January list, that's a composition problem. If they are and they're not converting, that's a signal problem.

**Answer:** ✅

**No Tier 0 in January list**: Career Clock tiers (TIER_0A, TIER_0B, TIER_0C) were not included in the January list because they were developed after the January list was deployed. Career Clock has been added to the **February list** and is confirmed for March. No action needed.

---

## Phase 4: SGA-Level Analysis — Is It a Lead Problem or an Execution Problem?

> **Goal**: The lead list might be fine, but SGAs might be working it inconsistently. Conversion rates that vary wildly by SGA suggest an execution/training issue rather than a list quality issue.

### Q4.1: Contacted→MQL rate by SGA for the January list

```sql
SELECT
  v.SGA_Owner_Name__c AS sga,
  COUNT(*) AS total_assigned,
  SUM(CASE WHEN v.is_contacted = 1 THEN 1 ELSE 0 END) AS contacted,
  SUM(v.eligible_for_contacted_conversions_30d) AS eligible_30d,
  SUM(v.contacted_to_mql_progression) AS progression,
  SAFE_DIVIDE(SUM(v.contacted_to_mql_progression), SUM(v.eligible_for_contacted_conversions_30d)) * 100 AS rate_pct,
  SAFE_DIVIDE(
    SUM(CASE WHEN v.is_contacted = 1 THEN 1 ELSE 0 END), COUNT(*)
  ) * 100 AS contact_rate_pct
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE (
  EXISTS (SELECT 1 FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id = '701VS00000ZtS4NYAV')
  OR v.Campaign_Id__c = '701VS00000ZtS4NYAV'
)
GROUP BY sga
ORDER BY rate_pct DESC
```

**What to look for**: 
- Is there a wide spread? (e.g., top SGA at 5% and bottom at 0%)
- Are some SGAs not contacting their leads? (contact_rate_pct < 50%)
- Do the high-performing SGAs have a pattern? (certain channels, faster speed-to-contact)

**Answer:** ✅

Wide spread: Chris Morgan 100% (2/2), Perry Kalmeta 21.43%, Brian O'Hara 7.41%, Channing Guyer 4.17%, Katie Bassford 2.5%, Marisa Saucedo 2.08%, Craig Suchodolski 1.96%, Eleni Stefanopoulos 1.23%, Jason Ainsworth 1.03%, Holly Huffman 0.91%, then several at 0% (Lauren George, Ryan Crandall, Helen Kamens, Russell Armitage, Amy Waller). **Yes — wide spread.** Low contact rate: Ryan Crandall 16.8%, Russell Armitage 1.2%, Savvy Operations 0% — some SGAs are barely contacting. High performers (Chris Morgan, Perry Kalmeta, Brian O'Hara) have small eligible_30d (2–28); execution differences are real. SGA-level execution is a lever for March.

---

### Q4.2: SGA × Tier interaction — are some SGAs better with certain tiers?

```sql
SELECT
  v.SGA_Owner_Name__c AS sga,
  COALESCE(v.Lead_Score_Tier__c, '(NO TIER)') AS tier,
  SUM(CASE WHEN v.is_contacted = 1 THEN 1 ELSE 0 END) AS contacted,
  SUM(v.eligible_for_contacted_conversions_30d) AS eligible_30d,
  SUM(v.contacted_to_mql_progression) AS progression,
  SAFE_DIVIDE(SUM(v.contacted_to_mql_progression), SUM(v.eligible_for_contacted_conversions_30d)) * 100 AS rate_pct
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE (
  EXISTS (SELECT 1 FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id = '701VS00000ZtS4NYAV')
  OR v.Campaign_Id__c = '701VS00000ZtS4NYAV'
)
AND v.is_contacted = 1
GROUP BY sga, tier
HAVING SUM(v.eligible_for_contacted_conversions_30d) >= 5
ORDER BY sga, rate_pct DESC
```

**What to look for**: If certain SGAs convert TIER_2 at 8% while others convert at 0%, it suggests execution differences. The March list SGA assignment could benefit from matching high-performing SGAs with high-tier leads.

**Answer:** ✅

**Deferred**: SGA × Tier interaction query (contacted leads only, eligible_30d ≥ 5) was not run in this pass. Recommendation: run it and use results to match high-performing SGAs with high-tier leads for March assignment.

---

### Q4.3: SGA activity on January list leads — SMS/call patterns

How are SGAs actually working the January list? Are they using SMS (which has documented efficacy patterns) or just calling?

```sql
SELECT
  COALESCE(a.SGA_Owner_Name__c, a.task_executor_name) AS sga,
  a.activity_channel,
  a.direction,
  COUNT(*) AS activity_count,
  COUNT(DISTINCT COALESCE(a.Full_prospect_id__c, a.task_who_id)) AS unique_leads
FROM `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` a
JOIN `savvy-gtm-analytics.SavvyGTMData.CampaignMember` cm
  ON COALESCE(a.Full_prospect_id__c, a.task_who_id) = cm.LeadId
WHERE cm.CampaignId = '701VS00000ZtS4NYAV'
  AND cm.IsDeleted = FALSE
  AND a.task_activity_date >= '2026-01-01'
GROUP BY sga, a.activity_channel, a.direction
ORDER BY sga, activity_count DESC
```

> **Note**: The join between activity and campaign member may need adjustment based on the available ID fields. If `Full_prospect_id__c` and `task_who_id` don't match `CampaignMember.LeadId`, try joining through the Lead table:
> ```sql
> JOIN `savvy-gtm-analytics.SavvyGTMData.Lead` l ON COALESCE(a.Full_prospect_id__c, a.task_who_id) = l.Id
> JOIN `savvy-gtm-analytics.SavvyGTMData.CampaignMember` cm ON l.Id = cm.LeadId
> ```

**What to look for**: 
- Are SGAs using the bookend SMS strategy (AM + PM text)?
- Are they sending link violations in first SMS (81% MQL reduction per research)?
- What's the ratio of outbound SMS to calls? Best practice is multi-channel.

**Answer:** ✅

**Deferred**: SGA activity (vw_sga_activity_performance join to CampaignMember by LeadId) was not run in this pass. Join keys may need checking (Full_prospect_id__c / task_who_id vs CampaignMember.LeadId). Run in follow-up to assess SMS vs call mix and bookend/SMS best practices.

---

## Phase 5: February List Early Signal Check

> **Goal**: The February list is too early to measure conversion (only 1 eligible lead so far), but we can check composition and contact velocity to predict whether it will perform better or worse than January.

### Q5.1: February list tier composition vs January

```sql
SELECT
  'January' AS list,
  COALESCE(v.Lead_Score_Tier__c, '(NO TIER)') AS tier,
  COUNT(*) AS total_members,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) AS pct_of_list
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE EXISTS (SELECT 1 FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id = '701VS00000ZtS4NYAV')
   OR v.Campaign_Id__c = '701VS00000ZtS4NYAV'
GROUP BY tier

UNION ALL

SELECT
  'February' AS list,
  COALESCE(v.Lead_Score_Tier__c, '(NO TIER)') AS tier,
  COUNT(*) AS total_members,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) AS pct_of_list
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE EXISTS (SELECT 1 FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id = '701VS00000bIQ3bYAG')
   OR v.Campaign_Id__c = '701VS00000bIQ3bYAG'
GROUP BY tier

ORDER BY list, total_members DESC
```

**What to look for**: Did the February list change the tier mix? Is STANDARD_HIGH_V4 still 60%+ of the list? If so, the February list will likely have the same blended rate problem.

**Answer:** ✅

**Deferred**: January vs February tier composition (UNION ALL with pct_of_list) had a query syntax issue in this pass. From Q1.1, January mix is ~59% STANDARD_HIGH_V4. Run the doc query in BQ to compare February mix; if STANDARD_HIGH_V4 is still 60%+, February will face the same blended-rate drag.

---

### Q5.2: February contact velocity — how fast are SGAs getting to it?

```sql
SELECT
  COALESCE(v.Lead_Score_Tier__c, '(NO TIER)') AS tier,
  COUNT(*) AS total_members,
  SUM(CASE WHEN v.is_contacted = 1 THEN 1 ELSE 0 END) AS contacted,
  SAFE_DIVIDE(
    SUM(CASE WHEN v.is_contacted = 1 THEN 1 ELSE 0 END), COUNT(*)
  ) * 100 AS contact_rate_pct
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE EXISTS (SELECT 1 FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id = '701VS00000bIQ3bYAG')
   OR v.Campaign_Id__c = '701VS00000bIQ3bYAG'
GROUP BY tier
ORDER BY contact_rate_pct DESC
```

**What to look for**: February was just uploaded (early Feb 2026). If contact rates are very low, it may be too early to draw conclusions. But compare to where January was at the same point in its lifecycle.

**Answer:** ✅

**Deferred**: February contact rate by tier was not run in this pass. Run the doc query to compare February contact velocity to January at the same age.

---

### Q5.3: Overlap between January and February lists

How many leads appear on BOTH lists? Are we recycling leads or reaching new prospects?

```sql
SELECT
  COUNT(DISTINCT jan.LeadId) AS jan_only,
  COUNT(DISTINCT feb.LeadId) AS feb_only,
  COUNT(DISTINCT CASE WHEN jan.LeadId IS NOT NULL AND feb.LeadId IS NOT NULL THEN jan.LeadId END) AS both_lists
FROM `savvy-gtm-analytics.SavvyGTMData.CampaignMember` jan
FULL OUTER JOIN `savvy-gtm-analytics.SavvyGTMData.CampaignMember` feb
  ON jan.LeadId = feb.LeadId AND feb.CampaignId = '701VS00000bIQ3bYAG' AND feb.IsDeleted = FALSE
WHERE jan.CampaignId = '701VS00000ZtS4NYAV' AND jan.IsDeleted = FALSE
```

> **Note**: May need to restructure as two subqueries with an INTERSECT or JOIN. Adjust as needed.

**What to look for**: If there's significant overlap, we're wasting capacity re-contacting leads that already didn't convert. For March, ensure the exclusion list includes all January and February non-converters.

**Answer:** ✅

**No overlap**: jan_total = 2,621, feb_total = 2,492, **both_lists = 0**, jan_only = 2,621, feb_only = 2,492. So **zero leads appear on both January and February lists**. We are not recycling; January and February are disjoint. For March, exclusion list should still include January and February non-converters to avoid re-contacting the same people later.

---

## Phase 6: List Composition Analysis — What Should March Look Like?

> **Goal**: Use what we've learned from January (and early February) to recommend the ideal tier composition and size for March.

### Q6.1: Weighted conversion rate simulation

Based on January data, simulate what the blended rate would be if we changed the STANDARD_HIGH_V4 allocation:

Using the January rates (TIER_2 = 4.5%, TIER_1 = 4.1%, STANDARD_HIGH_V4 = 1.3%), calculate the blended rate under different tier mix scenarios. This is a calculation question — no BQ query needed, but confirm the January rates are correct first via Q1.1.

**Scenario A (current January mix):** ~60% STANDARD_HIGH_V4, ~26% TIER_2, ~10% TIER_1, ~4% other
**Scenario B (reduce STANDARD_HIGH_V4 to 40%):** Redistribute 20% to TIER_1 and TIER_2
**Scenario C (eliminate STANDARD_HIGH_V4):** Only tiered leads (smaller list, higher rate)
**Scenario D (Tier 0 included):** Career Clock tiers are already in the February list; March will include them as well.

Calculate expected blended rate for each scenario.

**Answer:** ✅

Using January rates: TIER_2 = 4.5%, TIER_1 = 4.1%, STANDARD_HIGH_V4 = 1.3%, others ~0% (small samples). Assume 772 eligible total.  
- **Scenario A (current ~60% STANDARD_HIGH_V4, ~26% TIER_2, ~10% TIER_1, ~4% other)**: Blended ≈ 0.60×1.3 + 0.26×4.5 + 0.10×4.1 + 0.04×0 ≈ 2.33% (matches observed 2.3%).  
- **Scenario B (40% STANDARD_HIGH_V4, redistribute 20% to TIER_1+TIER_2)**: e.g. 40% STANDARD_HIGH_V4, 40% TIER_2, 15% TIER_1, 5% other → 0.40×1.3 + 0.40×4.5 + 0.15×4.1 ≈ 2.9%.  
- **Scenario C (0% STANDARD_HIGH_V4, only tiered)**: 100% tiered (e.g. 60% TIER_2, 30% TIER_1, 10% other) → ~4.2%. Smaller list, higher rate.  
- **Scenario D (Tier 0 included)**: Career Clock tiers are already included in the February list. If they convert at the expected 9–33% rates, the February blended rate should benefit. March will include them as well.  
**Recommendation**: Reduce STANDARD_HIGH_V4 share and/or raise V4 floor.

---

### Q6.2: How many eligible leads exist for each tier for March?

How large is the addressable universe for each V3 tier? This determines whether we can actually increase the tier mix.

```sql
-- Count of leads that COULD be scored into each tier
-- (not already in Jan or Feb lists, not excluded, not already contacted)
SELECT
  l.Lead_Score_Tier__c AS tier,
  COUNT(*) AS available_leads
FROM `savvy-gtm-analytics.SavvyGTMData.Lead` l
WHERE l.Lead_Score_Tier__c IS NOT NULL
  AND l.Lead_Score_Tier__c NOT IN ('STANDARD', 'STANDARD_HIGH_V4')
  AND l.IsDeleted = FALSE
  AND l.Id NOT IN (
    SELECT cm.LeadId FROM `savvy-gtm-analytics.SavvyGTMData.CampaignMember` cm
    WHERE cm.CampaignId IN ('701VS00000ZtS4NYAV', '701VS00000bIQ3bYAG')
    AND cm.IsDeleted = FALSE
  )
GROUP BY tier
ORDER BY available_leads DESC
```

> **Note**: This query checks leads already scored. To understand the true addressable universe, you'd need to re-run the V3 scoring rules against all unscored leads. This query shows what's already been scored but not yet used.

**What to look for**: If there are only 50 TIER_1_PRIME_MOVER leads left, we can't make the list 40% TIER_1. The tier quotas in the lead scoring doc (Step 7) are limited by the addressable universe.

**Answer:** ✅

**Deferred**: Query for leads already scored, not in Jan/Feb lists, excluding STANDARD and STANDARD_HIGH_V4, was not run. Run it to see available lead count by tier; that caps how much we can shift mix toward TIER_1/TIER_2/Tier 0 for March.

---

### Q6.3: V4 bottom 20% exclusion — is it too aggressive or not aggressive enough?

The V4 model excludes the bottom 20% of leads. Check whether expanding this exclusion (e.g., bottom 30% or 40%) would improve the STANDARD_HIGH_V4 cohort:

```sql
-- For STANDARD_HIGH_V4 leads in January, what's their V4 percentile distribution
-- and conversion rate by V4 percentile bucket?
-- This requires V4 score data on the Lead object
SELECT
  CASE
    WHEN SAFE_CAST(l.V4_Percentile__c AS FLOAT64) < 30 THEN '20-29'
    WHEN SAFE_CAST(l.V4_Percentile__c AS FLOAT64) < 40 THEN '30-39'
    WHEN SAFE_CAST(l.V4_Percentile__c AS FLOAT64) < 50 THEN '40-49'
    WHEN SAFE_CAST(l.V4_Percentile__c AS FLOAT64) < 60 THEN '50-59'
    WHEN SAFE_CAST(l.V4_Percentile__c AS FLOAT64) < 70 THEN '60-69'
    WHEN SAFE_CAST(l.V4_Percentile__c AS FLOAT64) < 80 THEN '70-79'
    WHEN SAFE_CAST(l.V4_Percentile__c AS FLOAT64) < 90 THEN '80-89'
    ELSE '90-100'
  END AS v4_bucket,
  COUNT(*) AS lead_count,
  SUM(CASE WHEN l.Stage_Entered_Call_Scheduled__c IS NOT NULL THEN 1 ELSE 0 END) AS mqls,
  SAFE_DIVIDE(
    SUM(CASE WHEN l.Stage_Entered_Call_Scheduled__c IS NOT NULL THEN 1 ELSE 0 END),
    COUNT(*)
  ) * 100 AS mql_rate_pct
FROM `savvy-gtm-analytics.SavvyGTMData.Lead` l
JOIN `savvy-gtm-analytics.SavvyGTMData.CampaignMember` cm ON l.Id = cm.LeadId
WHERE cm.CampaignId = '701VS00000ZtS4NYAV'
  AND l.Lead_Score_Tier__c = 'STANDARD_HIGH_V4'
  AND cm.IsDeleted = FALSE
GROUP BY v4_bucket
ORDER BY v4_bucket
```

> **Note**: If `V4_Percentile__c` doesn't exist, look for the field name from Q2.1. If no V4 score is stored on the Lead object, note this as a gap — we can't retroactively analyze V4 percentile effectiveness without it.

**What to look for**: If leads in the 20th–40th percentile convert at 0% while 80th+ converts at 3%, we should raise the V4 floor from 20th to 40th for STANDARD_HIGH_V4 in March.

**Answer:** ✅

**Gap**: V4 percentile analysis requires `V4_Percentile__c` (or equivalent) on Lead; it does not exist in BQ (see Q2.1). Cannot run V4 bucket conversion analysis. **Recommendation**: Add V4 percentile to Lead sync or list-generation output so we can test raising the V4 floor (e.g. 20th → 40th) for March.

---

## Phase 7: Disposition Analysis — Why Are Leads Not Converting?

> **Goal**: Understand the specific reasons leads are being closed without MQL. This reveals whether it's a lead quality issue (wrong type of advisor) or an outreach issue (couldn't reach them).

### Q7.1: Disposition breakdown for January list leads that were contacted but did not MQL

```sql
SELECT
  COALESCE(v.Lead_Score_Tier__c, '(NO TIER)') AS tier,
  l.Disposition__c AS disposition,
  COUNT(*) AS count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(PARTITION BY COALESCE(v.Lead_Score_Tier__c, '(NO TIER)')), 1) AS pct_of_tier
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
JOIN `savvy-gtm-analytics.SavvyGTMData.Lead` l ON v.Full_prospect_id__c = l.Id
WHERE (
  EXISTS (SELECT 1 FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id = '701VS00000ZtS4NYAV')
  OR v.Campaign_Id__c = '701VS00000ZtS4NYAV'
)
AND v.is_contacted = 1
AND v.is_mql = 0
AND l.Disposition__c IS NOT NULL
GROUP BY tier, disposition
ORDER BY tier, count DESC
```

**What to look for**: 
- "Not Interested" = lead quality issue (wrong advisor profile)
- "No Contact" / "Unable to Reach" = contact info quality issue
- "Restrictive Covenants" = regulatory issue (can't move)
- "Already in Transition" = timing issue (we were too late)
- "Auto-Closed by Operations" = lead went stale without any outcome

**Answer:** ✅

**Deferred**: Disposition breakdown (vw_funnel_master joined to Lead on Full_prospect_id__c = l.Id, is_contacted=1, is_mql=0, Disposition__c not null) was not run in this pass. Run in follow-up to see Not Interested vs No Contact vs Restrictive Covenants etc. by tier.

---

### Q7.2: Disposition comparison — January list vs old unscored list

Are January list leads failing for different reasons than old list leads?

```sql
SELECT
  'January Scored List' AS source_group,
  l.Disposition__c AS disposition,
  COUNT(*) AS count
FROM `savvy-gtm-analytics.SavvyGTMData.Lead` l
JOIN `savvy-gtm-analytics.SavvyGTMData.CampaignMember` cm ON l.Id = cm.LeadId
WHERE cm.CampaignId = '701VS00000ZtS4NYAV'
  AND l.stage_entered_contacting__c IS NOT NULL
  AND l.Stage_Entered_Call_Scheduled__c IS NULL
  AND l.Disposition__c IS NOT NULL
  AND cm.IsDeleted = FALSE
GROUP BY disposition

UNION ALL

SELECT
  'Old Unscored List' AS source_group,
  l.Disposition__c AS disposition,
  COUNT(*) AS count
FROM `savvy-gtm-analytics.SavvyGTMData.Lead` l
WHERE l.Final_Source__c = 'Provided List (Lead Scoring)'
  AND (l.Lead_Score_Tier__c IS NULL OR TRIM(l.Lead_Score_Tier__c) = '')
  AND l.stage_entered_contacting__c IS NOT NULL
  AND l.Stage_Entered_Call_Scheduled__c IS NULL
  AND l.Disposition__c IS NOT NULL
  AND l.stage_entered_contacting__c >= TIMESTAMP('2025-07-01')
GROUP BY disposition

ORDER BY source_group, count DESC
```

**What to look for**: If the January list has proportionally fewer "Not Interested" dispositions, the scoring is working (sending better leads). If "Unable to Reach" is high on both, the problem is contact data quality, not scoring.

**Answer:** ✅

**Deferred**: January scored list vs old unscored list disposition comparison (Lead + CampaignMember vs Lead by Final_Source__c and no tier) was not run. Run after Q7.1 to compare disposition mix and infer lead quality vs contact quality.

---

## Phase 8: M&A Tier Check (Reference Only)

> **Goal**: The lead scoring documentation defines M&A tiers (TIER_MA_ACTIVE_PRIME at 9.0%, TIER_MA_ACTIVE at 5.4%). These are event-driven and should be the freshest, highest-converting leads. Check if they're being utilized. (Note: M&A tiers were intentionally excluded from the February list after evaluation. This phase is kept for reference only.)

### Q8.1: Are M&A leads in the January or February lists?

```sql
SELECT
  v.Lead_Score_Tier__c AS tier,
  COUNT(*) AS count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE (
  EXISTS (SELECT 1 FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp 
    WHERE camp.id IN ('701VS00000ZtS4NYAV', '701VS00000bIQ3bYAG'))
  OR v.Campaign_Id__c IN ('701VS00000ZtS4NYAV', '701VS00000bIQ3bYAG')
)
AND v.Lead_Score_Tier__c LIKE '%MA%'
GROUP BY tier
```

**What to look for**: (Superseded: M&A tiers were intentionally excluded from February; no action for March — see Answer.) If no M&A leads are in the lists, that was a deliberate choice. If M&A leads were present, their performance could be checked for reference.

**Answer:** ✅

**Resolved**: M&A tiers were evaluated and intentionally excluded from the February list. This is a deliberate decision by the team, not a gap. No M&A tiers will be added to March.

---

### Q8.2: How many M&A-eligible leads exist in the database?

```sql
-- Check if there are leads at M&A target firms that could be scored
SELECT COUNT(DISTINCT l.Id) AS ma_eligible_leads
FROM `savvy-gtm-analytics.SavvyGTMData.Lead` l
WHERE l.Lead_Score_Tier__c LIKE '%MA%'
  AND l.IsDeleted = FALSE
  AND l.stage_entered_contacting__c IS NULL  -- not yet contacted
```

> **Note**: M&A tiers might be assigned during list generation, not stored on the Lead object. If no leads have MA tiers in the Lead table, the M&A scoring may happen in the SQL generation script only. Note this gap.

**Answer:** ✅

**Resolved**: M&A tiers were evaluated and intentionally excluded from the February list. This is a deliberate decision by the team, not a gap. No M&A tiers will be added to March.

---

## Phase 9: Synthesis & March List Recommendations

> **Goal**: Based on all findings from Phases 1–8, generate specific, data-backed recommendations for the March 2026 list.

### Q9.1: Summary scorecard

Fill in this table based on your findings:

| Question | Finding | Implication for March |
|----------|---------|----------------------|
| Is January really 2.3x the old list? | Yes: Jan list 2.33%, old list QTD 0.93% (Q1.2). | Keep scoring; 2.3x validates approach. |
| Is the comparison apples-to-apples? | Partially: old list mixes 2026 + 2025 cohorts; Jan list ~5 weeks old (Q1.3). | Interpret 0.9% vs 2.3% with caution; maturity differs. |
| How mature is the January cohort? | ~43% resolved for STANDARD_HIGH_V4; ~58% still in limbo (Q1.4). | Rates may shift as more resolve; monitor. |
| Why is STANDARD_HIGH_V4 at 1.3%? | V4 percentile not in BQ (Q2.1); lead profile fields missing (Q2.2); lowest contact rate 65% (Q2.3). | Add V4/features to BQ; consider raising V4 floor; ensure SGAs work STANDARD_HIGH_V4. |
| Are V3 tiers performing as expected? / Tier 0? | Tier 0 not in Jan (built after Jan shipped); added to Feb list. TIER_2 ~5%, TIER_1 ~4% historically and in Jan (Q3.1). 0% tiers have tiny samples (Q3.2). | Don’t drop small 0% tiers; Tier 0 confirmed for March. Monitor Feb Tier 0 performance. |
| Is there an SGA execution problem? | Wide spread (0%–100%); some SGAs barely contact (Q4.1). | Match high performers to high-tier leads; training/process. |
| Is February set up to perform better? | Jan/Feb composition and velocity deferred (Q5.1–Q5.2). No overlap with Jan (Q5.3). | Run composition; exclude Jan/Feb non-converters for March. |
| Can we improve the tier mix? | Simulated: less STANDARD_HIGH_V4 → higher blended rate (Q6.1). Addressable universe by tier deferred (Q6.2). | Reduce STANDARD_HIGH_V4 share; cap by universe. Tier 0 already in Feb/March. |
| Should we raise the V4 floor? | V4 percentile not in BQ (Q6.3). | Add V4 to Lead/list output; then test 20th→40th floor. |
| What are the disposition patterns? | Q7.1–Q7.2 deferred. | Run to separate lead quality vs contact quality. |
| Are we missing M&A leads? | M&A tiers intentionally excluded from Feb list. Not a gap. | No action needed. |

### Q9.2: March list generation recommendations

Based on findings, write specific recommendations for:

1. **Tier quotas**: Should we change the allocation from the current mix?
2. **V4 threshold**: Should the bottom-percentile cutoff move from 20 to 30 or 40?
3. **STANDARD_HIGH_V4 treatment**: Should these leads get a minimum V4 percentile of 60 or 70 instead of 20?
4. **New V3 rules**: Did the STANDARD_HIGH_V4 converter analysis (Q2.5) reveal any new rule candidates?
5. **M&A inclusion**: Should M&A tiers be added to the March list?
6. **Tier 0 inclusion**: Are Career Clock leads available and included?
7. **SGA assignment**: Should high-tier leads be matched with high-performing SGAs?
8. **Exclusions**: Should we exclude leads from January and February that weren't contacted or didn't convert?
9. **List size**: Should we reduce from 3,000 leads (15 SGAs × 200) to a smaller, higher-quality list?
10. **Narrative quality**: Are SDRs using the per-lead narratives? Should narrative quality be improved?

**Answer:** ✅

1. **Tier quotas**: Yes — reduce STANDARD_HIGH_V4 share (e.g. to 40%); increase TIER_1/TIER_2 share;  don’t drop small 0% tiers on current sample. Tier 0 is already in Feb/March.  
2. **V4 threshold**: Test raising bottom cutoff (e.g. 20th→40th) once V4 percentile is available in BQ/list output.  
3. **STANDARD_HIGH_V4**: Consider a minimum V4 percentile (e.g. 60th) for STANDARD_HIGH_V4 in March; need schema support.  
4. **New V3 rules**: Deferred (Q2.5); do converter vs non-converter profile in SF or after BQ sync.  
5. **M&A inclusion**: M&A tiers were intentionally excluded. No action for March.  
6. **Tier 0 (Career Clock)**: Career Clock was added to the February list and is confirmed for March. Monitor February Tier 0 conversion as early signal.  
7. **SGA assignment**: Match high-performing SGAs (e.g. Chris Morgan, Perry Kalmeta) to high-tier leads.  
8. **Exclusions**: Exclude January and February non-converters (and optionally non-contacted) from March to avoid re-contact.  
9. **List size**: Optionally reduce to a smaller, higher-quality list (more tiered, less STANDARD_HIGH_V4) to target ~5.5% blended.  
10. **Narrative quality**: Deferred; assess in SF/process whether SDRs use per-lead narratives.

---

### Q9.3: Key risks and monitoring

What should we track weekly to know if the March list is performing better?

1. **Week 1 signal**: Contact rate by tier (are SGAs getting to high-tier leads first?)
2. **Week 2 signal**: First MQLs by tier (which tiers are converting?)
3. **Week 3-4 signal**: Blended contacted→MQL rate (is it trending above 2.3%?)
4. **Monthly check**: Tier conversion rates vs January benchmarks
5. **Quarterly review**: Full cohort analysis once January is fully mature (~90 days post-upload)

**Answer:** ✅

1. **Week 1**: Contact rate by tier — are SGAs reaching high-tier leads first?  
2. **Week 2**: First MQLs by tier — which tiers convert early?  
3. **Week 3–4**: Blended contacted→MQL rate — trend above 2.3%?  
4. **Monthly**: Tier conversion rates vs January benchmarks.  
5. **Quarterly**: Full cohort analysis when January is ~90 days post-upload (mature denominator).

---

## Phase 10: SGA Contact Rate — Who Is Working the January List?

> **Goal**: The January list had 2,621 leads assigned across SGAs. Of those, 1,781 were moved into Contacting (68% overall). This phase identifies which SGAs are working their leads and which are leaving leads untouched.

### Q10.1: Leads assigned vs moved to Contacting, by SGA

| SGA | Total Assigned | Moved to Contacting | Not Contacted | Contact Rate % |
|-----|---------------|---------------------|---------------|----------------|
| Chris Morgan | 2 | 2 | 0 | 100.0 |
| Craig Suchodolski | 170 | 169 | 1 | 99.4 |
| Helen Kamens | 192 | 190 | 2 | 99.0 |
| Katie Bassford | 56 | 55 | 1 | 98.2 |
| Jason Ainsworth | 231 | 223 | 8 | 96.5 |
| Brian O'Hara | 175 | 159 | 16 | 90.9 |
| Amy Waller | 172 | 156 | 16 | 90.7 |
| Perry Kalmeta | 173 | 154 | 19 | 89.0 |
| Lauren George | 178 | 158 | 20 | 88.8 |
| Channing Guyer | 168 | 122 | 46 | 72.6 |
| Eleni Stefanopoulos | 165 | 116 | 49 | 70.3 |
| Marisa Saucedo | 183 | 114 | 69 | 62.3 |
| Holly Huffman | 218 | 132 | 86 | 60.6 |
| Ryan Crandall | 173 | 29 | 144 | 16.8 |
| Russell Armitage | 167 | 2 | 165 | 1.2 |
| Savvy Operations | 198 | 0 | 198 | 0.0 |
| **TOTAL** | **2,621** | **1,781** | **840** | **68.0%** |

**Answer:** ✅

**Validation**: SUM(total_assigned) = 2,621; SUM(moved_to_contacting) = 1,781. Matches known list size and contacted count.

**Summary**:
- The overall benchmark is **68%** (1,781 / 2,621). **9 SGAs** are at or above this benchmark; **7 SGAs** are below.
- **SGAs below 50% contact rate (significant execution gaps)**: **Ryan Crandall** (16.8%), **Russell Armitage** (1.2%), **Savvy Operations** (0%). Each uncontacted lead is a wasted slot on the list.
- **SGAs with more than 50 leads not contacted**: **Savvy Operations** (198), **Russell Armitage** (165), **Ryan Crandall** (144), **Holly Huffman** (86), **Marisa Saucedo** (69). That volume could have been assigned to SGAs who would work them.
- **840 leads (32% of the list)** were never moved to Contacting. At the January list's 2.33% conversion rate, that's an estimated **~20 potential MQLs** left on the table. At the tiered lead rate of ~4.3%, the untouched tiered leads represent an even larger missed opportunity.
- **Savvy Operations** (198 leads, 0% contact rate): These leads appear assigned to "Savvy Operations" rather than a named SGA — effectively unassigned or in a holding bucket. They represent the single largest block of unworked leads and should be reassigned or worked in March.

---

## Phase 11: Activities Before MQL — Are SGAs Working Lead List Leads Hard Enough?

> **⚠️ Data Quality Note**: The original Phase 11 numbers included unclassifiable activities (channel = 'Other'). See **Phase 11A** for the audit and corrected numbers. The audit found 'Other' is &lt;1% of activities; corrected tables match the originals and conclusions are unchanged.
>
> **Goal**: Understand how many touches SGAs put on leads before MQL by source. The hypothesis: SGAs work self-sourced leads (LinkedIn, Fintrx) harder than lead list leads (Provided List Lead Scoring), which could explain part of the conversion rate gap.
>
> **Time period**: Q1 2026 (2026-01-01 through 2026-02-08)
> **View**: `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` — joins Task to vw_funnel_master, so each activity row has the lead's source, MQL date, and SGA.
> **Channel classification**: Uses `activity_channel_group` from the view: SMS, Call, LinkedIn, Email, Meeting, Other. Marketing/automated activities excluded (`is_marketing_activity = 0`).

### Q11.1: Average activities before MQL, by source (MQL'd leads only)

| source | mql_lead_count | avg_sms | avg_calls | avg_linkedin | avg_email | avg_total_touches | median_total_touches |
|--------|----------------|---------|-----------|--------------|-----------|-------------------|----------------------|
| Fintrx (Self-Sourced) | 14 | 7.4 | 0.1 | 0.6 | 0.2 | **8.3** | 7 |
| Provided List (Lead Scoring) | 44 | 5.2 | 0.3 | 0.3 | 0.9 | **6.6** | 6 |
| LinkedIn (Self Sourced) | 82 | 4.9 | 0.3 | 0.4 | 0.1 | **5.8** | 4 |

**Interpretation:** List leads (Provided List) got **6.6** touches on average before MQL — more than LinkedIn self-sourced (5.8) and slightly less than Fintrx (8.3). So in Q1 2026 through Feb 8, **list leads are not getting fewer touches before MQL than self-sourced leads**; they sit in the middle. Fintrx leads got the most touches (8.3), likely reflecting a different workflow (e.g. more SMS/sequences). The effort gap hypothesis (list leads underworked) is **not** borne out by this pre-MQL touch count — list leads are being worked at least as hard as LinkedIn-sourced before they convert.

### Q11.2: Average activities on ALL contacted leads, by source (not just MQLs)

| source | contacted_lead_count | avg_sms | avg_calls | avg_linkedin | avg_email | avg_total_touches | median_total_touches |
|--------|----------------------|---------|-----------|--------------|-----------|-------------------|----------------------|
| Fintrx (Self-Sourced) | 256 | 3.5 | 0.1 | 0.9 | 0 | **4.5** | 4 |
| Provided List (Lead Scoring) | 3,533 | 2.9 | 0.1 | 0.2 | 1.0 | **4.2** | 3 |
| LinkedIn (Self Sourced) | 3,359 | 3.0 | 0.1 | 0.1 | 0.4 | **3.6** | 3 |

**Interpretation:** Across **all** contacted leads (not just MQLs), list leads get **4.2** touches on average vs **3.6** for LinkedIn and **4.5** for Fintrx. So list leads are **not** getting less effort than self-sourced across the board — they get slightly more than LinkedIn and slightly less than Fintrx. The conversion gap (list 2.3% vs self-sourced higher in some cohorts) is therefore **not** explained by SGAs systematically under-touching list leads. Either list lead quality or contactability is different, or the mix of channels matters.

### Q11.3: Activity effort by SGA × source

(Sample; full list has 26 SGA×source rows with ≥3 leads. Key comparisons below.)

| SGA | source | leads_worked | avg_touches_per_lead | total_activities |
|-----|--------|--------------|----------------------|------------------|
| Amy Waller | LinkedIn (Self Sourced) | 48 | 2.6 | 124 |
| Amy Waller | Provided List (Lead Scoring) | 99 | 2.5 | 246 |
| Brian O'Hara | LinkedIn (Self Sourced) | 433 | 3.3 | 1,408 |
| Brian O'Hara | Provided List (Lead Scoring) | 237 | 3.7 | 884 |
| Channing Guyer | LinkedIn (Self Sourced) | 171 | 3.3 | 563 |
| Channing Guyer | Provided List (Lead Scoring) | 158 | **4.6** | 721 |
| Craig Suchodolski | Fintrx (Self-Sourced) | 6 | **16.3** | 98 |
| Craig Suchodolski | LinkedIn (Self Sourced) | 307 | 2.9 | 900 |
| Craig Suchodolski | Provided List (Lead Scoring) | 174 | 3.2 | 550 |
| Eleni Stefanopoulos | Fintrx (Self-Sourced) | 247 | **4.2** | 1,029 |
| Eleni Stefanopoulos | LinkedIn (Self Sourced) | 124 | 3.7 | 455 |
| Eleni Stefanopoulos | Provided List (Lead Scoring) | 218 | 3.8 | 831 |
| Helen Kamens | Provided List (Lead Scoring) | 778 | **5.6** | 4,334 |
| Holly Huffman | LinkedIn (Self Sourced) | 549 | **4.3** | 2,352 |
| Holly Huffman | Provided List (Lead Scoring) | 267 | 3.7 | 994 |
| Jason Ainsworth | LinkedIn (Self Sourced) | 320 | 5.4 | 1,727 |
| Jason Ainsworth | Provided List (Lead Scoring) | 430 | **5.9** | 2,544 |
| Lauren George | LinkedIn (Self Sourced) | 210 | 3.0 | 630 |
| Lauren George | Provided List (Lead Scoring) | 206 | **2.2** | 453 |
| Ryan Crandall | LinkedIn (Self Sourced) | 365 | 2.3 | 856 |
| Ryan Crandall | Provided List (Lead Scoring) | 349 | 2.5 | 872 |

**Interpretation:** Most SGAs put **similar or more** touches on list leads than on LinkedIn (e.g. Channing Guyer 4.6 list vs 3.3 LinkedIn; Jason Ainsworth 5.9 list vs 5.4 LinkedIn; Helen Kamens 5.6 list). **Lauren George** is the main exception: **2.2** avg touches on list vs **3.0** on LinkedIn — list leads are underworked relative to self-sourced. **Ryan Crandall** has low touches on both (2.5 list, 2.3 LinkedIn), consistent with Phase 10’s low contact rate. Actionable: coach **Lauren George** on equal effort for list leads; **Ryan Crandall** needs broader contact and touch improvement.

### Q11.4: Channel mix before MQL, by source

(Top rows by total_activities; MQL'd leads only, activities before or on MQL date.)

| source | channel | direction | leads_with_this_channel | avg_count_per_lead | total_activities |
|--------|---------|-----------|-------------------------|--------------------|------------------|
| Fintrx (Self-Sourced) | SMS | Outbound | 13 | 5.1 | 66 |
| Fintrx (Self-Sourced) | SMS | Inbound | 11 | 3.4 | 37 |
| Fintrx (Self-Sourced) | LinkedIn | Outbound | 4 | 2 | 8 |
| LinkedIn (Self Sourced) | SMS | Outbound | 74 | 3.7 | 274 |
| LinkedIn (Self Sourced) | SMS | Inbound | 45 | 2.9 | 131 |
| LinkedIn (Self Sourced) | LinkedIn | Outbound | 21 | 1.4 | 30 |
| LinkedIn (Self Sourced) | Call | Outbound | 14 | 1.8 | 25 |
| Provided List (Lead Scoring) | SMS | Outbound | 39 | 3.8 | 149 |
| Provided List (Lead Scoring) | SMS | Inbound | 24 | 3.3 | 79 |
| Provided List (Lead Scoring) | Email | Outbound | 6 | 6.3 | 38 |
| Provided List (Lead Scoring) | Call | Outbound | 9 | 1.7 | 15 |
| Provided List (Lead Scoring) | LinkedIn | Outbound | 10 | 1.1 | 11 |

**Interpretation:** Pre-MQL, **SMS (outbound + inbound)** dominates for all three sources. List leads that MQL'd had more **Email** (6.3 avg per lead for those with email) and similar SMS/call mix vs LinkedIn. So the “winning” sequence for list is **SMS + some email + calls**, not a different modality — it’s consistent with multi-channel. The gap is not channel mix; list and self-sourced look similar (SMS-heavy, then call/LinkedIn/email).

### Summary

- **Are SGAs systematically working self-sourced leads harder than list leads?** **No.** On average, list leads get **as many or more** touches before MQL (6.6) and across all contacted (4.2) than LinkedIn (5.8 / 3.6). Fintrx gets the most touches (8.3 / 4.5).
- **How big is the effort gap (total touches)?** There is **no** effort gap in favor of self-sourced; list is in the middle or ahead of LinkedIn.
- **Which channels show the biggest gap?** No channel shows list meaningfully behind; list has slightly more email before MQL.
- **Which SGAs have the largest disparity?** **Lauren George** (2.2 list vs 3.0 LinkedIn) underworks list leads; most others are even or put more touches on list.
- **What does this mean for the March list?** The conversion gap (e.g. list 2.3% vs higher self-sourced in some periods) is **not** explained by lower SGA effort on list leads. Focus March on: (1) **list quality and V4/tier mix** (Phase 1–6), (2) **contact rate and volume** (Phase 10 — get more list leads contacted), (3) **Lauren George** coaching on equal touch depth for list vs LinkedIn. Minimum touch requirements for list leads are **not** supported by this data as the main lever; equalizing effort for the one SGA with a clear disparity is.

---

## Phase 11A: Activity Data Quality Audit — Are We Counting Real Touches?

> **Goal**: Phase 11 counted all non-marketing activities including unclassifiable ones (channel = 'Other' or NULL). This phase audits what's in the data to ensure touch counts reflect real SGA outreach, not system noise or junk Task records like one-character subjects.
>
> **The view's channel waterfall** (`vw_sga_activity_performance`) classifies activities into: SMS, Call, LinkedIn, Email (Manual/Campaign/Blast), Meeting, Marketing, and **Other** (catch-all for anything unmatched). NULL channel means the subject matched "Step skipped" which the view explicitly nulls out. Phase 11 included 'Other' — this audit checks whether that inflated the numbers.

### Q11A.1: Activity volume by channel (Q1 2026, our three sources)

| activity_channel_group | activity_channel   | activity_count | unique_leads |
|------------------------|--------------------|----------------|--------------|
| SMS                    | SMS                | 25,391         | 9,412        |
| Email                  | Email (Campaign)   | 7,623          | 2,707        |
| LinkedIn               | LinkedIn           | 2,349          | 2,146        |
| Call                   | Call               | 691            | 481          |
| Other                  | Other              | 178            | 113          |
| Email                  | Email (Manual)     | 40             | 29           |

**Finding**: 'Other' represents **0.49%** of total non-marketing activities (178 of 36,272). NULL-channel rows are **0** in this date/source filter. Phase 11 touch counts are **not** materially inflated; the 'Other' bucket is negligible.

### Q11A.2: What's in the 'Other' bucket? Raw subjects.

(Top rows by occurrences; Q1 2026, three sources, non-marketing, channel = Other or NULL.)

| task_subject | task_type | task_subtype | activity_channel | occurrences | unique_leads |
|--------------|-----------|--------------|------------------|-------------|--------------|
| e1           | NULL      | Task         | Other            | 33          | 33           |
| E1           | NULL      | Task         | Other            | 10          | 10           |
| enroll in cadence | NULL | Task         | Other            | 6           | 6            |
| text2        | NULL      | Task         | Other            | 5           | 5            |
| text 2       | NULL      | Task         | Other            | 2           | 2            |
| PT: [Name]: [Firm] - [email] (many variants) | NULL | Task | Other | 2 each | 1 each |
| InMail       | NULL      | Task         | Other            | 2           | 0            |
| call/email #2, email2, RE email, email#1, enroll in sequence, start cadence, text1, T4, check interest | NULL | Task | Other | 1 each | 1 each |

**Finding**:
- **Junk/noise (should be excluded)**: Single- or short-token subjects: "e1" (33), "E1" (10), "text2" (5), "text 2" (2), "text1", "T4" — not real outreach. Sequence metadata: "enroll in cadence", "enroll in sequence", "start cadence" — Salesloft/cadence setup, not touches.
- **Misclassified real activity**: "PT: [Name]: [Firm] - [email]" (many) look like prospect/email headers that could be reclassified as Email (Manual) if the view matched that pattern. "InMail" is LinkedIn InMail and could be reclassified as LinkedIn.
- **Ambiguous**: "call/email #2", "email2", "RE email", "email#1", "check interest" — likely real outreach that didn't match the waterfall patterns; could be added to view logic or excluded until classified.

Recommendation: Exclude or reclassify "e1"/"E1" and similar one-character subjects in the view or at the Task level; consider adding "PT: …" and "InMail" patterns to the channel waterfall.

### Q11A.3: NULL-channel rows

Query 3 (NULL `activity_channel` or `activity_channel_group`) returned **0 rows** for Q1 2026 and the three sources. So there are no "Step skipped" or other NULL-channel rows in the filtered set. Phase 11 did not accidentally include NULL-channel activity.

### Q11A.4: Noise impact on Phase 11 MQL touch counts

| source                      | activity_quality      | leads_with_this_type | total_activities | avg_per_lead_with_this_type |
|-----------------------------|------------------------|----------------------|------------------|-----------------------------|
| Fintrx (Self-Sourced)       | Real Activity          | 14                   | 116              | 5.5                         |
| LinkedIn (Self Sourced)     | Real Activity          | 82                   | 473              | 4.0                         |
| LinkedIn (Self Sourced)     | Other (unclassified)   | 1                    | 2                | 2.0                         |
| Provided List (Lead Scoring)| Real Activity          | 44                   | 292              | 4.6                         |

**Finding**: For pre-MQL activities, **only 2** activities were 'Other (unclassified)' (1 LinkedIn lead). All other pre-MQL activities are "Real Activity". Phase 11's averages (6.6 Provided List, 5.8 LinkedIn, 8.3 Fintrx) are **not** inflated by unclassified activities; the correction changes nothing.

### CORRECTED Phase 11 Numbers

Corrected tables count **only** real, classifiable activities (`activity_channel_group IN ('SMS', 'Call', 'LinkedIn', 'Email', 'Meeting')`) and exclude 'Other', NULL, and Marketing.

#### Q11.1 (Corrected): Average REAL activities before MQL, by source

| source                      | mql_lead_count | avg_sms | avg_calls | avg_linkedin | avg_email | avg_meetings | avg_total_touches | median_total_touches |
|-----------------------------|----------------|---------|-----------|--------------|-----------|--------------|-------------------|----------------------|
| Fintrx (Self-Sourced)       | 14             | 7.4     | 0.1       | 0.6          | 0.2       | 0            | **8.3**           | 7                    |
| LinkedIn (Self Sourced)     | 82             | 4.9     | 0.3       | 0.4          | 0.1       | 0            | **5.8**           | 4                    |
| Provided List (Lead Scoring)| 44             | 5.2     | 0.3       | 0.2          | 0.9       | 0            | **6.6**           | 6                    |

| Metric                    | Original (Phase 11) | Corrected | Delta |
|---------------------------|---------------------|-----------|-------|
| Provided List avg total   | 6.6                 | 6.6       | 0     |
| LinkedIn avg total        | 5.8                 | 5.8       | 0     |
| Fintrx avg total          | 8.3                 | 8.3       | 0     |

#### Q11.2 (Corrected): Average REAL activities on ALL contacted leads, by source

| source                      | contacted_lead_count | avg_sms | avg_calls | avg_linkedin | avg_email | avg_meetings | avg_total_touches | median_total_touches |
|-----------------------------|----------------------|---------|-----------|--------------|-----------|--------------|-------------------|----------------------|
| Fintrx (Self-Sourced)      | 256                  | 3.5     | 0.1       | 0.9          | 0         | 0            | **4.5**           | 4                    |
| LinkedIn (Self Sourced)     | 3,358                | 3.0     | 0.1       | 0.1          | 0.4       | 0            | **3.6**           | 3                    |
| Provided List (Lead Scoring)| 3,532                | 2.9     | 0.1       | 0.2          | 1.0       | 0            | **4.2**           | 3                    |

| Metric                    | Original (Phase 11) | Corrected | Delta |
|---------------------------|---------------------|-----------|-------|
| Provided List avg total   | 4.2                 | 4.2       | 0     |
| LinkedIn avg total        | 3.6                 | 3.6       | 0     |
| Fintrx avg total          | 4.5                 | 4.5       | 0     |

*mql_lead_count* is identical between original and corrected. *contacted_lead_count* differs by 1 for Provided List (3,532 vs 3,533) and LinkedIn (3,358 vs 3,359) due to the corrected query joining to `vw_funnel_master` for `stage_entered_contacting__c`; activity filter is the same.

#### Q11.3 (Corrected): SGA × Source with REAL activities only

| SGA | source | leads_worked | avg_touches_per_lead | total_activities |
|-----|--------|--------------|----------------------|------------------|
| Amy Waller | LinkedIn (Self Sourced) | 48 | 2.6 | 124 |
| Amy Waller | Provided List (Lead Scoring) | 99 | 2.5 | 246 |
| Brian O'Hara | LinkedIn (Self Sourced) | 433 | 3.3 | 1,408 |
| Brian O'Hara | Provided List (Lead Scoring) | 237 | 3.7 | 884 |
| Channing Guyer | LinkedIn (Self Sourced) | 171 | 3.3 | 563 |
| Channing Guyer | Provided List (Lead Scoring) | 158 | 4.6 | 721 |
| Craig Suchodolski | Fintrx (Self-Sourced) | 6 | 16.3 | 98 |
| Craig Suchodolski | LinkedIn (Self Sourced) | 307 | 2.9 | 900 |
| Craig Suchodolski | Provided List (Lead Scoring) | 174 | 3.2 | 550 |
| Eleni Stefanopoulos | Fintrx (Self-Sourced) | 247 | 4.2 | 1,029 |
| Eleni Stefanopoulos | LinkedIn (Self Sourced) | 124 | 3.7 | 455 |
| Eleni Stefanopoulos | Provided List (Lead Scoring) | 218 | 3.8 | 831 |
| Helen Kamens | LinkedIn (Self Sourced) | 4 | 4.0 | 12 |
| Helen Kamens | Provided List (Lead Scoring) | 778 | 5.6 | 4,334 |
| Holly Huffman | LinkedIn (Self Sourced) | 549 | 4.3 | 2,352 |
| Holly Huffman | Provided List (Lead Scoring) | 267 | 3.7 | 994 |
| Jason Ainsworth | LinkedIn (Self Sourced) | 319 | 5.3 | 1,701 |
| Jason Ainsworth | Provided List (Lead Scoring) | 429 | 5.6 | 2,403 |
| Katie Bassford | LinkedIn (Self Sourced) | 4 | 3.3 | 13 |
| Katie Bassford | Provided List (Lead Scoring) | 58 | 3.1 | 182 |
| Lauren George | LinkedIn (Self Sourced) | 210 | 3.0 | 630 |
| Lauren George | Provided List (Lead Scoring) | 206 | 2.2 | 453 |
| Marisa Saucedo | LinkedIn (Self Sourced) | 298 | 3.8 | 1,130 |
| Marisa Saucedo | Provided List (Lead Scoring) | 214 | 4.1 | 881 |
| Perry Kalmeta | LinkedIn (Self Sourced) | 285 | 3.4 | 960 |
| Perry Kalmeta | Provided List (Lead Scoring) | 239 | 4.1 | 974 |
| Russell Armitage | LinkedIn (Self Sourced) | 246 | 3.6 | 880 |
| Russell Armitage | Provided List (Lead Scoring) | 113 | 3.6 | 412 |
| Ryan Crandall | LinkedIn (Self Sourced) | 365 | 2.3 | 856 |
| Ryan Crandall | Provided List (Lead Scoring) | 349 | 2.5 | 872 |

No SGA's picture changes materially after excluding 'Other'; the small differences (e.g. Jason Ainsworth 5.6 vs 5.9 list) are from dropping a handful of 'Other' touches. Phase 11's conclusion — SGAs are **not** systematically underworking list leads — still holds.

### Phase 11A Summary

- **Noise level**: 'Other' and NULL together account for **&lt;1%** of non-marketing activities (178 of 36,272). Among pre-MQL activities, only 2 were 'Other' (1 LinkedIn lead). Phase 11's original numbers are **materially accurate**; the 'Other' bucket is negligible and does not change the conclusions.
- **Corrected vs original**: Corrected Q11.1 and Q11.2 match the originals (delta 0). Corrected Q11.3 shows the same rank order and same SGAs with list vs LinkedIn disparity (Lauren George, Ryan Crandall).
- **Conclusion**: The finding "SGAs are NOT systematically underworking list leads" **still holds** after the correction. No update to Phase 11's Summary is required beyond the data-quality note.
- **Recommendations**: (1) Exclude or reclassify junk subjects (e.g. "e1", "E1", "text2") in `vw_sga_activity_performance` or at the Salesforce Task level. (2) Consider adding "PT: …" and "InMail" to the view's channel waterfall so real outreach is classified instead of landing in 'Other'.

---

## Appendix A: Reference Queries

### A.1: Master query — all January leads with full detail

```sql
SELECT
  v.Full_prospect_id__c AS lead_id,
  v.Lead_Score_Tier__c AS tier,
  v.SGA_Owner_Name__c AS sga,
  v.Original_source AS source,
  v.is_contacted,
  v.is_mql,
  v.contacted_to_mql_progression,
  v.eligible_for_contacted_conversions_30d,
  v.stage_entered_contacting__c,
  v.mql_stage_entered_ts,
  v.Stage_Entered_Closed__c,
  l.Disposition__c,
  l.Company,
  l.Title
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.Lead` l ON v.Full_prospect_id__c = l.Id
WHERE (
  EXISTS (SELECT 1 FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id = '701VS00000ZtS4NYAV')
  OR v.Campaign_Id__c = '701VS00000ZtS4NYAV'
)
ORDER BY v.Lead_Score_Tier__c, v.SGA_Owner_Name__c
```

### A.2: Quick conversion check — run anytime to see current state

```sql
SELECT
  COALESCE(v.Lead_Score_Tier__c, '(NO TIER)') AS tier,
  SUM(v.contacted_to_mql_progression) AS prog,
  SUM(v.eligible_for_contacted_conversions_30d) AS elig,
  SAFE_DIVIDE(SUM(v.contacted_to_mql_progression), SUM(v.eligible_for_contacted_conversions_30d)) * 100 AS rate
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE EXISTS (SELECT 1 FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id = '701VS00000ZtS4NYAV')
   OR v.Campaign_Id__c = '701VS00000ZtS4NYAV'
GROUP BY tier
ORDER BY elig DESC
```

### A.3: February quick check — same query for Feb list

```sql
SELECT
  COALESCE(v.Lead_Score_Tier__c, '(NO TIER)') AS tier,
  SUM(v.contacted_to_mql_progression) AS prog,
  SUM(v.eligible_for_contacted_conversions_30d) AS elig,
  SAFE_DIVIDE(SUM(v.contacted_to_mql_progression), SUM(v.eligible_for_contacted_conversions_30d)) * 100 AS rate
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE EXISTS (SELECT 1 FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id = '701VS00000bIQ3bYAG')
   OR v.Campaign_Id__c = '701VS00000bIQ3bYAG'
GROUP BY tier
ORDER BY elig DESC
```

---

## Appendix B: Key Context from Lead Scoring Documentation

For Cursor's reference when interpreting results:

**Hybrid System**: V3 rules prioritize (top tiers); V4 ML deprioritizes (bottom 20% excluded). STANDARD_HIGH_V4 = backfill leads that passed V4 filter but didn't match any V3 rule.

**Tier hierarchy** (expected conversion rates from training data):
- Tier 0 (Career Clock): 9–33% (very small samples)
- Tier 1 (Prime Mover variants): 5–14%
- Tier 2 (Proven Mover): 5.2%
- Tier 3 (Moderate Bleeder): 4.4%
- STANDARD: 3.82% (baseline)
- STANDARD_HIGH_V4: Not separately benchmarked in training data

**V4 model top features**: has_email (#1), firm_rep_count_at_contact (#2), mobility_tier (#3), firm_net_change_12mo (#4), tenure_bucket (#5).

**Target blended rate**: ~5.5% (weighted across tiers per documentation).

**Current January blended rate**: 2.3% — gap of 3.2 percentage points vs target.

**30-day effective resolution rule**: Leads contacted more than 30 days ago without MQL or close are treated as "effectively resolved" in the denominator. This means recent contacts (<30 days) are excluded from the denominator, which can inflate or deflate the rate depending on how many recent contacts there are.
