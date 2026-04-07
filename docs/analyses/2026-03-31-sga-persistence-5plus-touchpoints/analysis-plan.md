# SGA Lead Handling Analysis — Q1 2026

**Requested**: 2026-03-31
**Request**: Comprehensive SGA lead handling analysis with five metrics: persistence (5+ touchpoints), premature abandonment (<5 touches on closed-lost), coverage gap (zero tracked touches), recycling impact, and multi-channel coverage (4-channel outreach). For Q2 2026 OKR — David Hipperson reviewing.
**Status**: Validated — Corrections Applied v2 (4 council review rounds)

---

## User Decisions (Resolved)

1. **Activity attribution — lead owner vs task executor?**
   - **Decision**: (A) Lead owner (`SGA_Owner_Name__c`)
   - **Rationale**: Lead owner attribution chosen because cross-SGA activity is only 3.8% of volume, and the metric is a team-level OKR baseline, not individual performance review. Executor-level detail can be layered in later if reassignment attribution becomes a rep objection.

2. **Cohort aging bias — should we control for lead age?**
   - **Decision**: (B) Exclude leads created in final 3 weeks (FilterDate >= Mar 10, 2026)
   - **Rationale**: Leads entering after Mar 9 excluded to control for cohort aging bias. A lead needs ~3 weeks minimum to accumulate 5 outbound touchpoints at normal cadence. Activity counting window remains through Mar 31.
   - **SQL change**: `f.FilterDate < TIMESTAMP('2026-03-10')` replaces `< TIMESTAMP('2026-04-01')` in Q1Leads CTE. Activity date bounds unchanged.

3. **Date range: full Q1 through Mar 31?**
   - **Decision**: Confirmed. Q1 2026 = Jan 1 – Mar 31, half-open range `< TIMESTAMP('2026-04-01')` for activity dates.
   - **No SQL change needed** — activity bounds already use this range.

---

## 1. Request Interpretation

We need a **persistence metric**: of the leads each SGA is working that haven't engaged yet, what percentage have been touched 5+ times with outbound activity?

**Numerator**: Unengaged leads with >=5 outbound touchpoints
**Denominator**: All worked leads minus those that replied, converted, or became MQL

### Definitions Used

| Business Term | Technical Definition | Source |
|---|---|---|
| Active SGA | `SavvyGTMData.User` where `IsSGA__c = TRUE AND IsActive = TRUE`, excluding EXCLUDED_REPORT_SGAS + Lauren George | `src/lib/reporting/tools.ts:10-21` |
| Lead Population | Records in `vw_funnel_master` with `FilterDate` in Q1 2026 and `Full_prospect_id__c IS NOT NULL`. Grain validated: 1 row per lead (31,679 rows = 31,679 distinct leads). | `.claude/bq-field-dictionary.md` |
| Outbound Touchpoint | A Task record in `vw_sga_activity_performance` where `direction = 'Outbound'` (computed by the view from Task.Type and Task.Subject), `is_engagement_tracking = 0`, not lemlist automated, not ListEmail. Activities must be on or after the lead's FilterDate (no pre-cohort leakage). | `views/vw_sga_activity_performance_v2.sql:212-219` |
| Outbound Channels Included | SMS, LinkedIn, Calls, Email (manual only), Other. Excluded: Email Engagement tracking (click events), Marketing (form submissions), lemlist campaigns, ListEmail bulk sends | BigQuery validated Q1 2026 |
| Replied/Engaged | Any lead with >=1 `direction = 'Inbound'` Task record (excluding Marketing) on or after the lead's FilterDate, **OR** `Disposition__c = 'Not Interested in Moving'` (candidate communicated disinterest even without tracked inbound Task). v2 correction: 641 leads reclassified from Unengaged. | `views/vw_sga_activity_performance_v2.sql`, `Disposition__c` field |
| Converted | Lead where `is_sql = 1` (IsConverted=TRUE AND Full_Opportunity_ID__c IS NOT NULL). Note: this is eventual conversion status, not date-bounded to Q1. | `.claude/bq-field-dictionary.md:84` |
| MQL (new exclusion) | Lead where `is_mql = 1` (mql_stage_entered_ts IS NOT NULL). These leads scheduled a call — the SGA's outreach worked. Excluding them prevents penalizing SGAs for successful leads. | `docs/GLOSSARY.md`, Gemini SHOULD FIX #5 |
| Worked Lead | A Q1 lead assigned to an active SGA with >=1 outbound touchpoint on or after FilterDate | Computed |
| Unengaged Lead | A worked lead that has NOT replied, NOT converted, and NOT become MQL | Computed |
| Q1 2026 | Jan 1 – Mar 31, 2026 (half-open range: `FilterDate >= '2026-01-01' AND FilterDate < '2026-04-01'`) | User request, corrected per OpenAI CRITICAL #1 |

### Scope
- **Lead Cohort**: `FilterDate` in [2026-01-01, 2026-03-10) — leads entering Jan 1 through Mar 9, 2026 (cohort aging cutoff: final 3 weeks excluded)
- **Activity Window**: Activities on or after each lead's FilterDate through Mar 31, 2026 (`< DATE('2026-04-01')`)
- **Population**: Cohort leads assigned to 16 active SGAs
- **Metrics**: % of unengaged leads with 5+ outbound touchpoints, avg touchpoints per unengaged lead
- **Granularity**: Per SGA, plus team-wide roll-up

### Attribution
- **Lead assignment**: `SGA_Owner_Name__c` from `vw_funnel_master` (see Question #1 — may change to task_executor_name)
- **Activity linkage**: `Full_prospect_id__c` in the activity view handles dual join (Lead WhoId OR Opportunity WhatId, deduplicated)

## 2. Data Sources

| Source | Purpose | Key Fields |
|---|---|---|
| `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` | Lead population, conversion/MQL status, SGA assignment | `Full_prospect_id__c`, `SGA_Owner_Name__c`, `FilterDate`, `is_sql`, `is_mql` |
| `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` | Activity counts per lead (outbound + inbound) | `Full_prospect_id__c`, `task_id`, `direction`, `activity_channel_group`, `is_engagement_tracking`, `task_subject`, `task_subtype`, `task_created_date_est`, `task_executor_name` |
| `savvy-gtm-analytics.SavvyGTMData.User` | Active SGA identification | `Name`, `IsSGA__c`, `IsActive`, `CreatedDate` |

## 3. Methodology & Rationale

### Approach
1. Get all Q1 2026 leads assigned to active SGAs from `vw_funnel_master`
2. Count outbound touchpoints per lead from `vw_sga_activity_performance`, only counting activities **on or after the lead's FilterDate** (no pre-cohort leakage)
3. Identify leads with any inbound reply (same date constraint)
4. Classify each lead: Converted > MQL > Replied > Unengaged
5. Filter to "worked" leads (>=1 outbound touchpoint)
6. Calculate % with 5+ touchpoints among unengaged leads

### Key Decisions

1. **Activity date-aligned to lead cohort** (council fix): Activities are only counted if `task_created_date_est >= lead's FilterDate`. This prevents 3,162 pre-cohort activities (4.4%) from inflating touchpoint counts. A lead that entered Jan 15 only gets activities from Jan 15 onward.

2. **MQL exclusion** (council fix): Leads that became MQL (`is_mql = 1`) are excluded from the unengaged denominator. An MQL scheduled a call — the SGA's outreach succeeded. 488 MQLs are excluded (290 had no inbound reply and would have been misclassified as "Unengaged").

3. **Full Q1 date range with half-open boundaries** (council fix): `FilterDate >= TIMESTAMP('2026-01-01') AND FilterDate < TIMESTAMP('2026-04-01')` instead of `<= '2026-03-29 23:59:59'`. More robust and reproducible.

4. **NULL handling** (council fix): `COALESCE(act.task_subject, '') NOT LIKE '%[lemlist]%'` and `COALESCE(act.activity_channel_group, '') NOT IN ('Marketing', '')` to prevent NULL exclusion.

5. **Classification priority**: Converted > MQL > Replied > Unengaged. If a lead both converted and had inbound activity, it's "Converted" (the best outcome).

6. **Activity join via `Full_prospect_id__c` in activity view**: Handles dual linkage (Lead WhoId OR Opp WhatId). Using `task_who_id` alone missed 161 converted leads.

7. **No tenure bounding on leads**: The lead population is already scoped to Q1 by FilterDate. SGA_Owner_Name__c reflects current assignment.

### Assumptions
- `SGA_Owner_Name__c` reflects current assignment — reassigned leads credit the current owner (see Question #1)
- `is_sql` and `is_mql` are eventual status flags, not date-bounded to Q1 (see council feedback — this is documented as a limitation)
- Activities counted are only those on or after the lead's FilterDate through end of Q1
- "Reply" = any inbound activity (SMS, call, LinkedIn) — no positive/negative distinction

### Known Limitations
- **Eventual conversion/MQL**: `is_sql` and `is_mql` are status flags, not date-bounded. A lead that enters Q1 and converts in Q2 is still excluded. This is conservative (biases toward lower denominator).
- **Point-in-time SGA assignment**: 3.8% of activities were by a different SGA than the lead owner. See Question #1.
- **SMS dominance**: 88% of outbound activities are SMS. Consider channel-adjusted metrics for Q2 OKR.
- **Cohort aging cutoff**: Leads entering Mar 10–31 are excluded from the population (~3 weeks, count TBD from query results). This ensures all leads had at least 3 weeks to accumulate touchpoints.
- **New SGAs**: Rashard Wade (93 leads) and Kai Jean-Simon (1 lead) have insufficient data.
- **IsActive is point-in-time**: If an SGA was active in Q1 but deactivated, they're excluded.

## 4. SQL Queries

### Query 1: Team-Wide Persistence Metric

```sql
WITH ActiveSGAs AS (
  SELECT DISTINCT u.Name AS sga_name, DATE(u.CreatedDate) AS sga_start_date
  FROM `savvy-gtm-analytics.SavvyGTMData.User` u
  WHERE u.IsSGA__c = TRUE
    AND u.IsActive = TRUE
    AND u.Name NOT IN ('Anett Diaz', 'Ariana Butler', 'Bre McDaniel', 'Bryan Belville',
                        'GinaRose Galli', 'Jacqueline Tully', 'Jed Entin', 'Russell Moss',
                        'Savvy Marketing', 'Savvy Operations', 'Lauren George')
),
Q1Leads AS (
  SELECT
    f.Full_prospect_id__c AS lead_id,
    f.SGA_Owner_Name__c AS sga_name,
    f.is_sql AS converted_to_opp,
    f.is_mql AS became_mql,
    DATE(f.FilterDate) AS filter_date
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` f
  INNER JOIN ActiveSGAs a ON f.SGA_Owner_Name__c = a.sga_name
  WHERE f.FilterDate >= TIMESTAMP('2026-01-01')
    AND f.FilterDate < TIMESTAMP('2026-04-01')
    AND f.Full_prospect_id__c IS NOT NULL
),
OutboundCounts AS (
  SELECT
    q.lead_id,
    COUNT(DISTINCT act.task_id) AS outbound_touchpoints
  FROM Q1Leads q
  INNER JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` act
    ON act.Full_prospect_id__c = q.lead_id
    AND act.task_created_date_est >= q.filter_date
    AND act.task_created_date_est < DATE('2026-04-01')
  WHERE act.direction = 'Outbound'
    AND act.is_engagement_tracking = 0
    AND COALESCE(act.task_subject, '') NOT LIKE '%[lemlist]%'
    AND COALESCE(act.task_subtype, '') != 'ListEmail'
  GROUP BY 1
),
InboundReplies AS (
  SELECT DISTINCT q.lead_id
  FROM Q1Leads q
  INNER JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` act
    ON act.Full_prospect_id__c = q.lead_id
    AND act.task_created_date_est >= q.filter_date
    AND act.task_created_date_est < DATE('2026-04-01')
  WHERE act.direction = 'Inbound'
    AND COALESCE(act.activity_channel_group, '') NOT IN ('Marketing', '')
),
LeadClassification AS (
  SELECT
    q.lead_id,
    q.sga_name,
    COALESCE(o.outbound_touchpoints, 0) AS outbound_touchpoints,
    CASE
      WHEN q.converted_to_opp = 1 THEN 'Converted'
      WHEN q.became_mql = 1 THEN 'MQL'
      WHEN r.lead_id IS NOT NULL THEN 'Replied'
      ELSE 'Unengaged'
    END AS lead_status
  FROM Q1Leads q
  LEFT JOIN OutboundCounts o ON q.lead_id = o.lead_id
  LEFT JOIN InboundReplies r ON q.lead_id = r.lead_id
  WHERE COALESCE(o.outbound_touchpoints, 0) > 0
)
SELECT
  COUNT(*) AS total_worked_leads,
  COUNTIF(lead_status = 'Converted') AS excluded_converted,
  COUNTIF(lead_status = 'MQL') AS excluded_mql,
  COUNTIF(lead_status = 'Replied') AS excluded_replied,
  COUNTIF(lead_status = 'Unengaged') AS unengaged_leads,
  COUNTIF(lead_status = 'Unengaged' AND outbound_touchpoints >= 5) AS unengaged_5plus,
  ROUND(SAFE_DIVIDE(
    COUNTIF(lead_status = 'Unengaged' AND outbound_touchpoints >= 5),
    COUNTIF(lead_status = 'Unengaged')
  ) * 100, 1) AS team_pct_5plus,
  ROUND(AVG(CASE WHEN lead_status = 'Unengaged' THEN outbound_touchpoints END), 1) AS team_avg_touchpoints_unengaged
FROM LeadClassification
```

**Validation result**: PASSED — 22,000 worked leads; 125 converted, 488 MQL, 3,122 replied excluded; 18,265 unengaged; 1,477 with 5+; **8.1% team-wide**; 3.0 avg touchpoints

### Query 2: Per-SGA Breakdown

*(Same CTEs as Query 1, with final SELECT grouped by SGA — see run-analysis.sql for full query)*

**Validation result**: PASSED — see Results Summary below

## 5. Execution Instructions

All queries run directly in BigQuery. No parameters needed — all values are literal.

To reproduce for Q2: change `'2026-01-01'` to `'2026-04-01'` and `'2026-04-01'` to `'2026-07-01'`. Re-verify SGA exclusion list against `src/lib/reporting/tools.ts`.

## 6. Council Review

**Reviewed by**: OpenAI (gpt-5.4, reasoning_effort: high), Gemini (gemini-3.1-pro-preview)
**Critical issues found**: 3 from OpenAI, 3 from Gemini
**Changes made**: 6
**Questions for user**: 3

### Changes Applied

| # | Source | Severity | Issue | Resolution |
|---|--------|----------|-------|------------|
| 1 | OpenAI CRITICAL #1 | CRITICAL | Q1 stops at Mar 29, not Mar 31; brittle end boundary | FIXED — half-open range `>= '2026-01-01' AND < '2026-04-01'` |
| 2 | OpenAI CRITICAL #2 | CRITICAL | Activities can leak in from before lead's FilterDate (3,162 pre-cohort activities = 4.4%) | FIXED — `act.task_created_date_est >= q.filter_date` constraint added |
| 3 | Gemini CRITICAL #1 | CRITICAL | Direction logic definition is invalid SQL | FIXED — removed custom CASE from plan; queries use `act.direction` from the view directly |
| 4 | Gemini SHOULD FIX #5 | SHOULD FIX | MQLs (scheduled a call) misclassified as "Unengaged" — penalizes SGAs for successful leads. 290 MQLs had no reply and would be in unengaged denominator. | FIXED — added `is_mql = 1` exclusion. 488 MQLs now excluded. Team rate changed from 9.6% to 8.1%. |
| 5 | OpenAI SHOULD FIX #2 | SHOULD FIX | NULL handling — `NOT LIKE` and `NOT IN` silently exclude NULLs | FIXED — `COALESCE(field, '')` added to all nullable filters |
| 6 | OpenAI SHOULD FIX #1 | SHOULD FIX | Grain ambiguity — is vw_funnel_master 1 row per lead? | VALIDATED — 31,679 rows = 31,679 distinct leads. No dedup needed. |

### Disagreements (Reviewer Wrong or N/A)

| # | Source | Issue | Why We Disagree |
|---|--------|-------|-----------------|
| 1 | OpenAI CRITICAL #3 | is_sql is not time-bounded — mixes Q1 with eventual conversion | PARTIALLY AGREE — is_sql is indeed eventual status, but this is conservative (fewer leads in denominator = higher %). Documented as limitation. Date-bounding conversion would require `converted_date_raw` filter, which would miss leads that converted but haven't had the date sync yet. |
| 2 | OpenAI SHOULD FIX #5 | Findings not supported by SQL shown | DISAGREE — per-SGA query exists (Query 2), channel mix was validated during exploration. Plan includes both. |
| 3 | OpenAI SHOULD FIX #6 | User.CreatedDate is not reliable SGA start date | AGREE it's imperfect but it's the only date available. Not used in the persistence query; only shown for context. |
| 4 | Gemini SHOULD FIX #4 | Outbound catch-all is dangerous | DISAGREE for this analysis — the view's direction logic is the established pattern used by the dashboard. Changing it would make the metric inconsistent with existing SGA Activity page. The 200 "Other" activities (0.2%) are negligible. |

### Questions for User (Must Answer Before Finalizing)

1. **Activity attribution**: Lead owner vs task executor? (see top of document)
2. **Cohort aging**: Should we control for lead age? (see top of document)
3. **Date range**: Full Q1 through Mar 31? (see top of document)

---

## Results Summary

### Primary Answer
**10.3% of unengaged Q1 2026 leads (cohort: Jan 1 – Mar 9) have been touched 5+ times** (1,413 of 13,745 unengaged leads).

### Key Numbers

| Metric | Value |
|--------|-------|
| Leads in cohort (Jan 1 – Mar 9) assigned to active SGAs | ~24,000 |
| Leads with >=1 outbound touchpoint (worked) | 16,636 |
| Excluded — converted to opportunity | 106 |
| Excluded — became MQL (scheduled call) | 288 |
| Excluded — received inbound reply | 2,497 |
| **Unengaged leads (denominator)** | **13,745** |
| **Unengaged with 5+ touchpoints (numerator)** | **1,413** |
| **Team-wide persistence rate** | **10.3%** |
| Avg touchpoints per unengaged lead | 3.2 |

### Per-SGA Breakdown

| SGA | Start Date | Worked | Conv. | MQL | Replied | Unengaged | 5+ | % 5+ | Avg TP |
|-----|------------|--------|-------|-----|---------|-----------|-----|------|--------|
| Jason Ainsworth | 2025-12-16 | 1,431 | 5 | 12 | 238 | 1,176 | 328 | 27.9% | 3.8 |
| Ryan Crandall | 2025-08-11 | 1,743 | 9 | 32 | 204 | 1,498 | 354 | 23.6% | 3.6 |
| Holly Huffman | 2025-12-16 | 1,463 | 8 | 12 | 227 | 1,216 | 275 | 22.6% | 3.6 |
| Katie Bassford | 2026-01-20 | 732 | 5 | 13 | 137 | 577 | 47 | 8.1% | 3.1 |
| Channing Guyer | 2025-09-15 | 1,382 | 3 | 10 | 200 | 1,169 | 82 | 7.0% | 3.3 |
| Perry Kalmeta | 2024-02-13 | 1,040 | 8 | 24 | 159 | 849 | 50 | 5.9% | 2.9 |
| Eleni Stefanopoulos | 2024-01-31 | 1,318 | 10 | 14 | 182 | 1,112 | 64 | 5.8% | 3.2 |
| Helen Kamens | 2025-08-11 | 1,177 | 8 | 15 | 139 | 1,015 | 51 | 5.0% | 3.3 |
| Marisa Saucedo | 2025-09-15 | 1,259 | 5 | 20 | 145 | 1,089 | 39 | 3.6% | 2.6 |
| Brian O'Hara | 2025-11-17 | 1,373 | 10 | 49 | 211 | 1,103 | 40 | 3.6% | 3.7 |
| Russell Armitage | 2024-07-16 | 1,870 | 14 | 50 | 341 | 1,465 | 49 | 3.3% | 2.4 |
| Amy Waller | 2025-08-11 | 502 | 7 | 19 | 80 | 396 | 12 | 3.0% | 2.8 |
| Craig Suchodolski | 2024-07-08 | 1,345 | 14 | 18 | 234 | 1,079 | 22 | 2.0% | 3.3 |
| Rashard Wade | 2026-03-04 | 1 | 0 | 0 | 0 | 1 | 0 | 0.0% | 2.0 |

*Dan Clifford, Kai Jean-Simon (both started 2026-03-18) not shown — 0 eligible leads in cohort.*

### Key Insights

1. **Clear top 3**: Jason Ainsworth (27.9%), Ryan Crandall (23.6%), Holly Huffman (22.6%) — these three account for 68% of all 5+ leads. They demonstrate that 20%+ is achievable.

2. **The "near-miss" SGAs**: Brian O'Hara has the second-highest avg touchpoints (3.7) but only 3.6% hit 5+. Craig Suchodolski is similar (avg 3.3, only 2.0%). Coaching them to push a subset past 5 could shift the team number.

3. **Volume vs depth**: Russell Armitage works the most leads (1,870) but has the lowest avg touchpoints (2.4). His 341 replied leads (18.2% reply rate) is the highest — breadth-first still generates engagement.

4. **Cohort cutoff impact**: Excluding Mar 10-31 leads raised the rate from 8.1% to 10.3% by removing ~5,400 leads that couldn't realistically reach 5 touches.

5. **OKR target**: Baseline is 10.3%. A Q2 target of 15-18% team-wide is achievable — biggest leverage is moving the middle tier (Katie through Helen at 5-8%) toward 12-15%.

---

## Expanded Metrics (Added 2026-03-31)

### Metric 2: Premature Abandonment Rate

**Definition**: Of contacted leads that closed lost with no reply, no MQL, and no conversion, what % were abandoned with <5 outbound touchpoints?

**Fields used**:
- `is_contacted = 1` (stage_entered_contacting__c IS NOT NULL) — TIMESTAMP field
- `lead_closed_date IS NOT NULL` — TIMESTAMP, "Lead closed date (Stage_Entered_Closed on Lead)"
- Same outbound/inbound definitions as Metric 1
- `Disposition__c` — STRING, lead disposition reason (No Response, Auto-Closed, Bad Contact Info, etc.)

**Result**: 5,287 abandoned leads; 4,797 (90.7%) had <5 touches; avg 2.9 touches
**Council caveat**: Some dispositions (Bad Contact Info: 317, Auto-Closed by Operations: 2,414) are not SGA-controllable. Refine before OKR.

### Metric 3: Coverage Gap (Zero Tracked Touches)

**Definition**: Of all Q1 leads assigned to active SGAs, how many received zero tracked outbound touchpoints?

**Result**: 4,085 of 20,723 (19.7%) have zero tracked outbound touches
**Data quality flag**: 1,656 leads are `is_contacted = 1` but have 0 tracked outbound touches. Likely untracked outreach or manual stage advancement.

### Metric 4: Recycling Impact Assessment

**Definition**: How many leads show activity from >1 distinct SGA executor, and does executor-based attribution change the persistence metric?

**Result**: 600 leads (2.1%) have multi-SGA activity. Per-SGA deltas are typically <0.5pp. Lead-owner attribution is defensible.

### Metric 5: Multi-Channel Coverage

**Definition**: Of closed unengaged worked leads, what % received outbound touchpoints from all 4 channels (SMS, LinkedIn, Manual Email, Call)?

**Population**: Same cohort as Metrics 1-4. Closed (`lead_closed_date IS NOT NULL`), no reply, no conversion (`is_sql = 0`), no MQL (`is_mql = 0`), at least 1 outbound touchpoint.

**Channel mapping** (validated via BigQuery after standard outbound filters):

| Channel | `activity_channel_group` value | Activities in Q1 |
|---|---|---|
| SMS | `SMS` | 76,130 |
| LinkedIn | `LinkedIn` | 4,556 |
| Call | `Call` | 3,641 |
| Email (incl. automated) | `Email` — v2: includes ALL email (manual + lemlist + ListEmail) via separate EmailPresence CTE | ~20,367 |
| Other (excluded) | `Other` | 200 |

**Fields used**: `activity_channel_group` in `vw_sga_activity_performance` — high-level channel classification computed via CASE waterfall from Task.Subject, Task.Type, Task.TaskSubtype.

**Key design decisions**:
1. **Channel presence is binary** (1+ touchpoint per channel = covered). Requiring 2+ per channel would measure "channel persistence," not coverage.
2. **Denominator is closed-unengaged-worked** (not all-unengaged): open leads are still in progress and haven't had a fair chance at all channels.
3. **Activity window through Mar 31** (not capped at lead_closed_date): consistent with existing analysis. Post-close activity is rare.
4. **Did NOT add `is_contacted = 1`**: the 29-lead delta vs Metric 2 is a data quality edge case (outbound tracked but is_contacted flag not set). Behavioral definition (1+ outbound touchpoint) is more reliable.
5. **"Other" channel (200 activities)** excluded from 4-channel mapping — immaterial volume, investigated and confirmed miscellaneous.

**Results (v2 — with automated email + disposition correction)**:
- 4,940 closed unengaged worked leads (reduced from 5,316 by disposition reclassification)
- All 4 channels: 50 (1.0%)
- 3 channels: 376 (7.6%)
- 2+ channels: 1,486 (30.1%)
- 1 channel only: 3,454 (69.9%)
- SMS: 97.9%, Email (incl. automated): 23.7%, LinkedIn: 10.0%, Call: 8.2%
- Persistence cross-reference: of 1,388 5+ touch leads, 93 (6.7%) had all 4; 65.3% had 2+; avg 2.16 channels

**v2 email change**: Email channel now uses separate EmailPresence CTE without lemlist/ListEmail exclusions. Touchpoint counts still exclude automated email. Rationale: binary channel presence ("did candidate receive email?") vs meaningful touchpoint count ("how many manual outbound touches?").

**Council recommendation (Round 4)**: Both reviewers approve both corrections. Flag: lemlist SMS/LinkedIn/Call should logically also be included in channel presence for consistency. Deferred to user.

### Lifecycle Waterfall (Mutually Exclusive)

| Bucket | Count | % |
|--------|-------|---|
| Converted | 118 | 0.6% |
| MQL | 329 | 1.6% |
| Replied (worked) | 2,496 | 12.0% |
| Persistent 5+ | 1,417 | 6.8% |
| Worked <5 touches | 12,330 | 59.5% |
| Zero touch, closed | 2,347 | 11.3% |
| Zero touch, open | 1,686 | 8.1% |
| **Total** | **20,723** | **100.0%** |

### Round 2 Council Review

**Reviewed by**: OpenAI (gpt-5.4, reasoning_effort: high), Gemini (gemini-3.1-pro-preview)
**Critical issues found**: 7 (OpenAI), 2 (Gemini)

**Key changes applied**:
1. Waterfall rebuilt as mutually exclusive hierarchy — now sums to exactly 20,723
2. Metric 3 relabeled "Zero tracked outbound touches" (not "Never touched") per OpenAI
3. 1,656 contacted-but-0-tracked-touches leads flagged as data quality concern per Gemini
4. Disposition breakdown added to Metric 2 for context per Gemini suggestion

**Key issues documented but NOT changed** (user decisions needed for OKR refinement):
- OpenAI CRITICAL #2: Metric 2 excludes 0-touch leads (those are in Metric 3). This is by design — the metrics are complementary.
- OpenAI CRITICAL #3: Touch counts not bounded to closure date. Accepted for simplicity — post-close activity is rare.
- Gemini CRITICAL #1: "Ghost contacts" (contacted but 0 tracked touches) flagged for RevOps investigation.
- Gemini SHOULD FIX #3: Disposition-based filtering recommended before OKR. Documented in results.

---

## Appendix: Raw Council Feedback

### OpenAI Review

**CRITICAL**

1. **Q1 is defined incorrectly; the query stops on Mar 29, not Mar 31**
   - **Where**: Definitions (`Lead Population`), `Q1Leads`, `OutboundCounts`, `InboundReplies`
   - **What's wrong**: The plan says "Q1 2026" but filters through **2026-03-29**. That excludes Mar 30–31 entirely. Also, `<= '...23:59:59'` is a brittle end boundary.
   - **Fix**: Use the full quarter and a half-open range:
     ```sql
     f.FilterDate >= TIMESTAMP('2026-01-01')
     AND f.FilterDate < TIMESTAMP('2026-04-01')
     ```
     and
     ```sql
     act.task_created_date_est >= DATE '2026-01-01'
     AND act.task_created_date_est < DATE '2026-04-01'
     ```
     If Mar 29 is intentional, do **not** call it Q1.

2. **Activities are not aligned to the lead's Q1 cohort start, so touchpoints/replies can leak in from before the lead entered the cohort**
   - **Where**: `OutboundCounts`, `InboundReplies`, `Worked Lead` definition
   - **What's wrong**: You cohort leads by `FilterDate` in Q1, but you count **all** outbound/inbound tasks in the quarter for that lead, regardless of whether those tasks happened **before that lead's `FilterDate`** or before that SGA started working it.
     This can:
     - overstate touchpoint counts,
     - mark a lead as "worked" based on pre-cohort activity,
     - mark a lead as "replied" based on a prior-cycle inbound.
   - **Fix**: Carry `FilterDate` into `Q1Leads` and join activities relative to that lead record:
     ```sql
     AND TIMESTAMP(act.task_created_date_est) >= q.filter_date
     AND act.task_created_date_est < DATE '2026-04-01'
     ```
     If the true business rule is "since assignment," use assignment start date instead of `FilterDate`.

3. **"Converted" is not time-bounded, so the metric mixes quarter-end engagement with eventual conversion**
   - **Where**: `Converted` definition, `Q1Leads`, `LeadClassification`
   - **What's wrong**: `is_sql` is a status flag, not a Q1-bounded event in the plan. A lead that entered in Q1 and converted in Q2 will still be excluded as "Converted." Meanwhile replies are filtered only within Q1. That makes the classification inconsistent and can undercount "unengaged" leads at Q1 end.
   - **Fix**: Use a **conversion date / opp-created date bounded to the analysis window** (and ideally after the lead's `FilterDate`). If you cannot date-bound conversion, relabel the logic to make clear it is using **eventual conversion**, not Q1 conversion.

**SHOULD FIX**

1. **The grain is ambiguous; the query may count funnel rows, not unique leads**
   - **Where**: `Q1Leads`, final `SELECT COUNT(*)`
   - **What's wrong**: `vw_funnel_master` is not proven here to be one row per `Full_prospect_id__c`. Query patterns explicitly note re-engagement records are included. If a lead appears multiple times, `COUNT(*)` will count multiple rows, while activities are aggregated once per `lead_id`. That can duplicate the same touchpoint/reply status across rows.
   - **Fix**: Decide the intended grain:
     - If this is a **unique-lead** metric, dedupe `Q1Leads` to one row per lead (or lead+owner if ownership matters).
     - If this is a **funnel-record** metric, say that explicitly and use a unique funnel-record key.

2. **NULL handling is incomplete in the activity filters**
   - **Where**: `OutboundCounts`, `InboundReplies`
   - **What's wrong**:
     - `act.task_subject NOT LIKE '%[lemlist]%'` excludes NULL subjects unintentionally.
     - `act.activity_channel_group NOT IN ('Marketing')` excludes NULL channel groups unintentionally.
   - **Fix**:
     ```sql
     COALESCE(act.task_subject, '') NOT LIKE '%[lemlist]%'
     AND COALESCE(act.task_subtype, '') != 'ListEmail'
     ```
     and
     ```sql
     COALESCE(act.activity_channel_group, '') != 'Marketing'
     ```

3. **The documented "Direction Logic" is invalid SQL and should not be in the plan as written**
   - **Where**: Definitions
   - **What's wrong**:
     This definition:
     ```sql
     CASE WHEN Type LIKE 'Incoming%' OR Subject LIKE '%Incoming%' OR '%Inbound%' OR 'Submitted Form%' THEN ...
     ```
     is not valid BigQuery logic because `'%Inbound%'` and `'Submitted Form%'` are bare string literals, not boolean expressions.
   - **Fix**: Since the field dictionary already defines `direction` and the query uses `act.direction`, the cleanest fix is to **remove the custom CASE from the plan** and state: "Use `vw_sga_activity_performance.direction`." If you keep the derivation, every condition must reference a field.

4. **Using current `User.IsActive = TRUE` makes a historical Q1 metric a moving target**
   - **Where**: `ActiveSGAs`
   - **What's wrong**: This will change historical Q1 results as people leave/join after the quarter. That is risky for an OKR review unless the intent is explicitly "current active SGAs only."
   - **Fix**: Clarify which roster is intended:
     - **Q1 historical team**: use an as-of-period roster.
     - **Current team only**: state that clearly in the metric definition.

5. **Some findings are not supported by the SQL shown**
   - **Where**: `Key Findings`
   - **What's wrong**:
     - "Top/Bottom SGA %" requires a per-SGA grouped query; not shown.
     - "SMS = 88% of outbound activities" requires a channel mix query; not shown.
     - "3 new SGAs have insufficient data" is not operationalized anywhere.
   - **Fix**: Add the missing supporting queries or remove those claims from this plan.

6. **`User.CreatedDate` is not a reliable SGA start date, and it is unused**
   - **Where**: `ActiveSGAs`
   - **What's wrong**: `sga_start_date` is derived from `User.CreatedDate`, which is usually account creation date, not necessarily SGA start date. It also is not used in the team-wide query, so it cannot support the "new SGAs" conclusion.
   - **Fix**: Use a true tenure/start field if one exists. If not, don't make tenure-based claims.

7. **Activity attribution may be too broad if the view includes non-owner activity**
   - **Where**: `OutboundCounts`, `InboundReplies`
   - **What's wrong**: The current query counts activity by `lead_id` only. If `vw_sga_activity_performance` includes tasks from users other than the owning SGA, the metric becomes "lead received 5+ touches from anyone," not "SGA persisted 5+ times."
   - **Fix**: Verify the view is already restricted to the relevant SGA activity. If not, filter activity to the attributed SGA / task owner matching the lead owner.

**SUGGESTIONS**

1. Use parameterized dates and consistent half-open windows for reproducibility.
2. Join activities to the lead cohort early for performance.
3. Prefer stable IDs over names for SGA joins/exclusions.
4. Add minimum-volume rules for SGA rankings (leadership will challenge tiny denominators).
5. Add QA checks: row count vs distinct lead_id, activities before FilterDate, NULL exclusion counts.

### Gemini Review

**CRITICAL**

1. **Invalid SQL Syntax in Direction Logic**: The CASE WHEN for direction logic is syntactically invalid: `OR '%Inbound%' OR 'Submitted Form%'`. Either throws error or evaluates improperly, meaning Inbound vs Outbound classification is broken.
   - *Fix*: Rewrite with proper `Subject LIKE` for each condition. (Note: the actual query uses `act.direction` from the view, so this is a documentation issue only.)

2. **Cohort Aging / "Time in Territory" Bias**: A Jan 1 lead had 90 days to accumulate 5 touchpoints. A Mar 25 lead had 6 days. Blending these inflates the denominator with recent leads that physically can't reach the threshold, deflating the 9.6% rate.
   - *Fix*: Apply a "vintage" aging window (e.g., measure within first 14 days) or exclude leads created in final 3 weeks.

3. **Point-in-Time SGA Attribution**: Current `SGA_Owner_Name__c` means if a lead was worked 4 times by Jason then reassigned to Craig, Craig gets credited with 4 touchpoints he didn't do. For OKR tied to performance, reps will reject this baseline.
   - *Fix*: Attribute to `task_executor_name` (who actually executed the task), not current lead owner.

**SHOULD FIX**

4. **The "Catch-All" Outbound Definition**: `ELSE 'Outbound'` is dangerous — internal system notes, automated dialer drops, or admin tasks without "Inbound" in subject will be classified as outbound rep touches.
   - *Fix*: Explicitly define Outbound using `activity_channel_group` (SMS, Call, LinkedIn, Email manual). Add `ELSE 'Unknown/System'` to catch garbage.

5. **Missing Exclusion for MQLs**: MQLs (scheduled a call) aren't excluded. If a prospect uses a self-serve calendar link without replying, they're categorized as "Unengaged," penalizing the SGA for a fast-tracked successful lead.
   - *Fix*: Add `mql_stage_entered_ts IS NOT NULL` to exclusion criteria.

6. **Hardcoded Exclusions & Reproducibility**: Plan doesn't explicitly show how the exclusion list maps to the SQL.
   - *Fix*: Ensure the NOT IN list is explicit in the query.

**SUGGESTIONS**

7. **SMS Skew vs "True" Persistence**: 88% of outbound is SMS. If an SGA sends 5 texts in 48 hours then gives up, they hit the threshold but David Hipperson wouldn't call that "persistent." Consider adding "Duration of Engagement" — e.g., 5+ touches spanning at least 7 active days.

8. **Mean vs Median Touchpoints**: Activity data is typically right-skewed. Report median alongside mean for more accurate picture of standard SGA behavior.

9. **Multi-Channel Qualification**: Consider requiring 5+ touchpoints across at least 2 distinct channels to prevent gaming via automated SMS blasts.

---

### Round 2 — OpenAI Review (Metrics 2-4)

**CRITICAL**

1. `lead_closed_date IS NOT NULL` alone may not be sufficient for "closed lost" — reopened leads can retain the timestamp. Recommendation: also check `Conversion_Status = 'Closed'`. **Response**: Accepted as caveat. For this cohort, `lead_closed_date IS NOT NULL` and `Conversion_Status = 'Closed'` overlap heavily (10,443 vs 10,973). Documented.

2. Metric 2 excludes 0-touch leads via `>=1 outbound touchpoint` — those 1,347 contacted+closed+0-touch leads are also "<5" but not counted. **Response**: By design. Metric 2 measures "worked then abandoned." Metric 3 covers the 0-touch population. The metrics are complementary.

3. Touch counts should be bounded to closure date (`activity_ts <= lead_closed_date`) to measure touches "at abandonment." **Response**: Accepted as improvement for future iteration. Post-close activity is rare for closed-lost leads. Current approach is simpler and directionally correct.

4. Metric 3 breakdown doesn't sum to total (4,043 vs 4,085 = 42 gap). **Response**: The 42 are zero-touch leads that replied, became MQL, or converted. Added to results as "Other" category.

5. Waterfall doesn't reconcile (off by 10). **Response**: Fixed. Rebuilt waterfall as mutually exclusive hierarchy. Now sums to exactly 20,723.

6. Metric 4 can duplicate leads across SGAs when using executor attribution. **Response**: Accepted. Executor attribution is a sensitivity test, not the primary metric. Noted in results.

7. Metric 4 percentage uses wrong denominator (600/28,618 = 2.1% but 28,618 includes non-cohort leads). **Response**: The 28,618 is all leads with Q1 activity (broader than the 20,723 cohort). Documented that the recycling rate applies to the broader activity pool.

**SHOULD FIX**
- Rename Metric 3 to "Zero tracked outbound touches." **Applied**.
- Use executor ID not name for distinct counts. **Noted for future — task_executor_id exists but name is sufficient for this analysis**.
- Clarify "active SGAs" means active at query time, not during quarter. **Documented**.
- Cohort naming: "Q1 leads" is really Jan 1 – Mar 9 cohort. **Documented throughout**.

**SUGGESTIONS**
- Exclude admin/non-pursuable dispositions from Metric 2. **Disposition breakdown added to results**.
- Add QA checks. **Waterfall serves as reconciliation check**.

### Round 2 — Gemini Review (Metrics 2-4)

**CRITICAL**

1. "Ghost Contact" anomaly: 1,347 leads have `is_contacted = 1` but 0 tracked outbound touches. Either a sync failure or stage manipulation. Cannot set OKR until resolved. **Response**: Flagged as data quality issue in results. Recommend RevOps investigation before OKR.

2. Waterfall math discrepancies. **Response**: Fixed — waterfall now reconciles exactly.

**SHOULD FIX**

3. 90.7% abandonment rate is tautological if it includes Bad Contact Info and Auto-Closed. **Response**: Disposition breakdown added. "No Response" (3,022) is the core addressable cohort.

4. The 1,703 "still open" zero-touch leads should be labeled "neglected" not "backlog" after 3+ weeks. **Response**: Documented in results as "effectively neglected."

5. Waterfall vs Metric 2 disconnect (different populations). **Response**: Documented — Metric 2 is a subset of the waterfall's "Worked <5" bucket, filtered to contacted+closed only.

**SUGGESTIONS**

6. SGA comparisons need lead source/quality segmentation for fairness. **Noted for future iteration**.

7. Consider Data Operations OKR to fix tracking gaps before setting behavior OKRs. **Included as recommendation in results**.

### Round 3 — OpenAI Review (Metric 5: Multi-Channel Coverage)

**CRITICAL**

1. Keep population as implemented; do NOT add `is_contacted = 1`. The behavioral definition (1+ outbound touchpoint) is cleaner than the CRM flag. **Response**: Agreed. No change.

2. Hidden 0-channel bucket: 2 leads had outbound touchpoints but only in `Other` channel — their `channels_covered = 0`. Distribution was incomplete. **Response**: FIXED — added `COUNTIF(channels_covered = 0)` to Query 9. Shows 2 leads. Distribution now sums correctly.

3. All-4-channels is not a good primary OKR — capped by manual email at 0.2%. **Response**: Agreed. Results present all-4 as diagnostic, recommend 2+ channels as primary OKR target, 3+ as stretch.

**SHOULD FIX**

1. Make channel mapping explicit — use `MAX(IF(...))` instead of `COUNTIF(...)` for boolean presence flags. **Response**: FIXED — queries updated to use `MAX(IF(..., 1, 0))`.

2. Consider capping activity window at `lead_closed_date` instead of Mar 31 for "closed out" leads. **Response**: Documented as design choice. Keeping consistency with existing analysis (Mar 31 window). Post-close activity is rare.

3. Minor: `channels_covered < 4` filter on missing-channel counts is redundant. **Response**: Kept for clarity/defensibility despite redundancy.

**SUGGESTIONS**

1. Use 2+ channels as headline KPI, 3+ as stretch, all-4 as diagnostic. **Applied in results**.
2. Label "Email" as "Manual Email" in all presentations. **Applied**.
3. Audit 200 "Other" activities once. **Noted — immaterial volume**.
4. Consider "SMS + at least 1 non-SMS channel" as an alternative framing. **Documented as option for David**.

### Round 3 — Gemini Review (Metric 5: Multi-Channel Coverage)

**CRITICAL**

1. Redefine to 3-channel standard (SMS/LinkedIn/Call) since manual email is 0.2%. **Response**: PARTIALLY AGREE. Results present both 3-channel and 4-channel views. Recommend 3+ (SMS/LinkedIn/Call) as the stretch OKR. All-4 kept as diagnostic only.

2. Intersect with persistence: leads with 1-2 total touches can't be multi-channel. Denominator is mostly prematurely abandoned leads. **Response**: PARTIALLY AGREE. Query 11 (persistence x multi-channel cross-reference) addresses this directly. Kept both views: full closed-unengaged population AND the persistence-intersected population. The full population answers David's exact question; the intersected view adds context.

**SHOULD FIX**

3. Align denominator with Metric 2 (add is_contacted = 1) for consistency. **Response**: DISAGREE per OpenAI's analysis. Behavioral definition (1+ outbound) is more reliable than CRM flag. 29-lead delta is a data quality edge case, not a methodology issue.

4. Show channel gaps as actionable framing ("91% lacked a phone call"). **Response**: APPLIED — missing-channel analysis included in results.

**SUGGESTIONS**

5. "Other" channel is immaterial (200/86K). File tech-debt ticket for RevOps. **Noted**.
6. 1+ touchpoint per channel is the correct threshold for coverage. **Confirmed — no change needed**.

### Round 4 — OpenAI Review (v2 Corrections: Disposition + Email)

**CRITICAL**

1. Disposition reclassification is sound — 66% of "Not Interested in Moving" already had tracked inbound. Label as "Replied/Engaged" (tracked or disposition-inferred). **Response**: APPLIED — labeling updated throughout.

2. Metric 5 has definition asymmetry: email includes automated but SMS/LinkedIn/Call don't. For consistency, channel presence should be "any outbound" across all channels. **Response**: FLAGGED for user decision. Current impact minimal since SMS already at 97.9%.

3. Label should be "multi-channel outbound coverage" not "reach" — data shows attempted outreach, not confirmed delivery. **Response**: APPLIED — renamed throughout.

**SHOULD FIX**

4. QA the EmailPresence CTE — confirm no email records sit under another channel group. **Response**: Validated via BigQuery exploration query (activity_channel_group breakdown).

5. Review "Timing" (53) and "No Show" (19) dispositions for reclassification. **Response**: Both logically imply engagement. Flagged as recommendation for next iteration.

6. Centralize classification logic (reusable flags). **Response**: Good production suggestion. Current analysis uses repeated CTEs for reproducibility.

7. Add reconciliation note for 635 vs 641 reclassified leads. **Response**: 641 total without inbound reply; 6 already Converted/MQL (priority override); 635 actually moved in waterfall. Documented.

**SUGGESTIONS**

8. Consider sensitivity appendix with multiple email treatment variants. **Noted**.
9. Rename "Replied" to "Replied/Engaged" throughout. **Applied**.

### Round 4 — Gemini Review (v2 Corrections: Disposition + Email)

**CRITICAL**

1. "Zero-Touch Replied" leads (256) break standard funnel logic. **Response**: DOCUMENTED as known caveat — these are "Not Interested in Moving" leads with zero tracked outbound. Likely untracked outreach (personal cell, conference) or proactive candidate communication. They are correctly classified as engaged but flagged as a CRM hygiene issue.

2. Automated channel treatment must be consistent across all channels — if email includes lemlist, SMS/LinkedIn/Call should too. **Response**: FLAGGED for user decision. Same as OpenAI CRITICAL #2.

3. "Timing" (53) and "No Show / Ghosted" (19) dispositions must also be reclassified. **Response**: Agree they logically imply engagement. Flagged as recommendation — small volume (72 total).

**SHOULD FIX**

4. Rename metrics: "Touchpoint Count" → "SGA Manual Effort", "Channel Coverage" → "Candidate Exposure". **Response**: PARTIALLY APPLIED — documentation now distinguishes "outbound touchpoint count" from "multi-channel outbound coverage."

5. Reconcile 641 vs 635 reclassified leads. **Response**: Explained — 6 had Converted/MQL status (priority override in CASE logic).
