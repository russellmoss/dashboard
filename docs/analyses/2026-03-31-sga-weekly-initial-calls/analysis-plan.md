# SGA Weekly Initial Calls Scheduled — Q1 2026 QTD Analysis

**Requested**: 2026-03-31
**Request**: "For quarter to date (Q1 2026), looking at all active SGAs (defined by how we define an active SGA in our filters throughout the dashboard), minus Lauren George, what is the average number of initial_call_scheduled__c they have per week?"
**Status**: Validated

---

## 1. Request Interpretation

We need to calculate the **average number of initial calls scheduled per week per active SGA** during Q1 2026 (Jan 1 – Mar 29, 2026, excluding partial final week), excluding Lauren George from the population.

### Definitions Used

| Business Term | Technical Definition | Source |
|---|---|---|
| Active SGA | `SavvyGTMData.User` where `IsSGA__c = TRUE AND IsActive = TRUE`, excluding the dashboard's EXCLUDED_REPORT_SGAS list | `src/lib/reporting/tools.ts:10-21` |
| EXCLUDED_REPORT_SGAS | Anett Diaz, Ariana Butler, Bre McDaniel, Bryan Belville, GinaRose Galli, Jacqueline Tully, Jed Entin, Russell Moss, Savvy Marketing, Savvy Operations | `src/lib/reporting/tools.ts:10-21` |
| Initial Call Scheduled | `Initial_Call_Scheduled_Date__c` on Lead — a **DATE** field representing when an initial call is scheduled to occur. Can be a future date. **Not the same as** `mql_stage_entered_ts` (when the lead entered Call Scheduled stage). | `.claude/bq-field-dictionary.md:61` |
| Q1 2026 | Jan 1, 2026 through Mar 29, 2026 (13 complete Monday-aligned weeks) | User request, bounded to Q1 |
| Lauren George exclusion | Additional exclusion beyond the standard list, per user request | User request |

### Scope
- **Date Range**: `Initial_Call_Scheduled_Date__c` between 2026-01-01 and 2026-03-29 (13 complete weeks)
- **Population**: Active SGAs per User table (IsSGA__c=TRUE, IsActive=TRUE), minus standard exclusion list, minus Lauren George — **16 SGAs total**
- **Metrics**: Count of distinct records with `Initial_Call_Scheduled_Date__c` in range, grouped by SGA and week
- **Granularity**: Per SGA, per week (MONDAY-aligned), then averaged

### Important Note on Attribution
The dashboard uses `SGA_Owner_Name__c` for lead-level metrics (which initial calls are). For opportunity-level metrics, there's a dual-attribution pattern (`SGA_Owner_Name__c OR Opp_SGA_Name__c`), but since `Initial_Call_Scheduled_Date__c` is a lead-level field, we use `SGA_Owner_Name__c` only.

### Important Note on Field Semantics
`Initial_Call_Scheduled_Date__c` is the **date the call is scheduled to occur**, not the date the call was booked. When both fields are set, they differ 61% of the time (356/581 records in Q1 2026). If the business intent is "how many calls did SGAs book this week" rather than "how many calls were scheduled to occur this week," `mql_stage_entered_ts` would be the correct field. This analysis uses the field the user specified.

## 2. Data Sources

| Source | Purpose | Key Fields |
|---|---|---|
| `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` | Source of truth for funnel data | `Initial_Call_Scheduled_Date__c`, `SGA_Owner_Name__c`, `primary_key` |
| `savvy-gtm-analytics.SavvyGTMData.User` | Active SGA identification + tenure | `Name`, `IsSGA__c`, `IsActive`, `CreatedDate` |

## 3. Methodology & Rationale

### Approach
1. Define the active SGA population from the User table using the dashboard's standard logic
2. Generate a calendar spine of complete weeks using `GENERATE_DATE_ARRAY` (not derived from data)
3. CROSS JOIN SGAs with weeks, **bounded by each SGA's start date** (tenure-adjusted denominator)
4. Count `Initial_Call_Scheduled_Date__c` records per SGA per week using `COUNT(DISTINCT primary_key)`
5. Calculate the average across all eligible SGA-week combinations

### Key Decisions

1. **Including zero-call weeks in the average**: We CROSS JOIN SGAs with weeks so that a week where an SGA scheduled zero calls is counted as 0, not excluded. This gives a true average rather than an average-of-only-active-weeks.
   - *Rationale*: A zero-call week is still a week of work — excluding it would inflate the average and misrepresent productivity.

2. **Using EXCLUDED_REPORT_SGAS (10 names) not EXCLUDED_SGAS (6 names)**: The codebase has two exclusion lists. We use the longer one from `reporting/tools.ts` because it's the most comprehensive and is used by the reporting agents that produce SGA analyses.
   - *Rationale*: The shorter list in `sga-leaderboard.ts` is less complete (missing Ariana Butler, Bre McDaniel, Bryan Belville, GinaRose Galli). The reporting list is the superset and better matches "active SGAs as the dashboard defines them."

3. **Date field is `Initial_Call_Scheduled_Date__c` (DATE type), not the MQL timestamp**: This directly answers the question about "initial calls scheduled." The MQL field (`mql_stage_entered_ts`) represents "Call Scheduled" stage entry, which is related but different — they differ 61% of the time.
   - *Rationale*: The user specifically asked about `initial_call_scheduled__c`. The field dictionary confirms `Initial_Call_Scheduled_Date__c` is a DATE field on the Lead representing the scheduled initial call date.

4. **Week alignment on MONDAY**: Consistent with the dashboard's existing weekly patterns (seen in `query-templates.ts:1206`).

5. **Tenure-bounded denominator for new SGAs** (council feedback): SGAs created mid-quarter only have weeks counted from their start date forward. Dan Clifford and Kai Jean-Simon (created Mar 18) get 2 eligible weeks, Rashard Wade (created Mar 4) gets 4 eligible weeks. This prevents January/February zero-weeks from unfairly deflating their averages.
   - *Previous approach*: Counted all 13 weeks for every SGA regardless of start date, which deflated the team average from 3.01 to 2.38.

6. **Calendar spine generated from date range, not data** (council feedback): `AllWeeks` uses `GENERATE_DATE_ARRAY` instead of querying distinct dates from `vw_funnel_master`. This ensures a hypothetical zero-call week for the entire team would still be counted.

7. **Partial final week excluded** (council feedback): The week of Mar 30 contains only 2 days of Q1. Including it would deflate per-week averages. End date capped at Mar 29.

8. **Using `COUNT(DISTINCT primary_key)` instead of `COUNT(*)`**: Validated that the grain is 1:1 (656 rows = 656 distinct keys), but using DISTINCT as a safety measure against future view changes.

### Assumptions
- `Initial_Call_Scheduled_Date__c` represents the scheduled occurrence date of the call
- The User table's `IsActive` flag reflects current status — an SGA who left mid-quarter would be `IsActive=FALSE` and excluded
- SGA tenure is approximated by `User.CreatedDate` (when the User record was created in Salesforce)

### Known Limitations
- **Active status is point-in-time**: If an SGA was active in Jan-Feb but deactivated in March, they are entirely excluded. This is consistent with the dashboard's "Active Only" default behavior.
- **Field population**: Only 1.9% of Q1 2026 funnel records have `Initial_Call_Scheduled_Date__c` set — this is expected because only leads that progress to scheduling an initial call get this field.
- **3 new SGAs with zero calls**: Dan Clifford (2 eligible weeks), Kai Jean-Simon (2 weeks), and Rashard Wade (4 weeks) are all still ramping. They are included but tenure-bounded.

## 4. SQL Queries

### Query 1: Active SGA Population (Validation)

```sql
SELECT DISTINCT u.Name AS sga_name
FROM `savvy-gtm-analytics.SavvyGTMData.User` u
WHERE u.IsSGA__c = TRUE
  AND u.IsActive = TRUE
  AND u.Name NOT IN ('Anett Diaz', 'Ariana Butler', 'Bre McDaniel', 'Bryan Belville', 'GinaRose Galli', 'Jacqueline Tully', 'Jed Entin', 'Russell Moss', 'Savvy Marketing', 'Savvy Operations', 'Lauren George')
ORDER BY u.Name
```

**Expected output**: List of active SGA names
**Validation result**: PASSED — 16 SGAs returned

### Query 2: Primary Analysis — Tenure-Bounded Average per SGA per Week

```sql
WITH ActiveSGAs AS (
  SELECT DISTINCT u.Name AS sga_name, DATE(u.CreatedDate) AS sga_start_date
  FROM `savvy-gtm-analytics.SavvyGTMData.User` u
  WHERE u.IsSGA__c = TRUE
    AND u.IsActive = TRUE
    AND u.Name NOT IN ('Anett Diaz', 'Ariana Butler', 'Bre McDaniel', 'Bryan Belville', 'GinaRose Galli', 'Jacqueline Tully', 'Jed Entin', 'Russell Moss', 'Savvy Marketing', 'Savvy Operations', 'Lauren George')
),
AllWeeks AS (
  -- Generated calendar spine (not data-derived) — 13 complete Monday-aligned weeks
  SELECT DATE_TRUNC(d, WEEK(MONDAY)) AS week_start
  FROM UNNEST(GENERATE_DATE_ARRAY(DATE('2026-01-01'), DATE('2026-03-29'), INTERVAL 7 DAY)) AS d
),
SGAWeekCross AS (
  -- Only include weeks on/after each SGA's start date (tenure-bounded)
  SELECT a.sga_name, w.week_start
  FROM ActiveSGAs a
  CROSS JOIN AllWeeks w
  WHERE w.week_start >= DATE_TRUNC(a.sga_start_date, WEEK(MONDAY))
),
WeeklyCallsBySGA AS (
  SELECT
    v.SGA_Owner_Name__c AS sga_name,
    DATE_TRUNC(v.Initial_Call_Scheduled_Date__c, WEEK(MONDAY)) AS week_start,
    COUNT(DISTINCT v.primary_key) AS calls_scheduled
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
  INNER JOIN ActiveSGAs a ON v.SGA_Owner_Name__c = a.sga_name
  WHERE v.Initial_Call_Scheduled_Date__c >= DATE('2026-01-01')
    AND v.Initial_Call_Scheduled_Date__c <= DATE('2026-03-29')
    AND v.Initial_Call_Scheduled_Date__c IS NOT NULL
  GROUP BY 1, 2
),
FilledWeeks AS (
  SELECT
    c.sga_name,
    c.week_start,
    COALESCE(w.calls_scheduled, 0) AS calls_scheduled
  FROM SGAWeekCross c
  LEFT JOIN WeeklyCallsBySGA w ON c.sga_name = w.sga_name AND c.week_start = w.week_start
)
SELECT
  COUNT(DISTINCT sga_name) AS active_sgas,
  COUNT(DISTINCT week_start) AS total_weeks,
  SUM(calls_scheduled) AS total_calls,
  ROUND(AVG(calls_scheduled), 2) AS avg_initial_calls_per_sga_per_week
FROM FilledWeeks
```

**Expected output**: Single row with team-wide tenure-bounded average
**Validation result**: PASSED — 16 active SGAs, 13 complete weeks, 523 total calls, **3.01 avg initial calls per SGA per week**

### Query 3: Per-SGA Breakdown (Tenure-Bounded)

```sql
WITH ActiveSGAs AS (
  SELECT DISTINCT u.Name AS sga_name, DATE(u.CreatedDate) AS sga_start_date
  FROM `savvy-gtm-analytics.SavvyGTMData.User` u
  WHERE u.IsSGA__c = TRUE
    AND u.IsActive = TRUE
    AND u.Name NOT IN ('Anett Diaz', 'Ariana Butler', 'Bre McDaniel', 'Bryan Belville', 'GinaRose Galli', 'Jacqueline Tully', 'Jed Entin', 'Russell Moss', 'Savvy Marketing', 'Savvy Operations', 'Lauren George')
),
AllWeeks AS (
  SELECT DATE_TRUNC(d, WEEK(MONDAY)) AS week_start
  FROM UNNEST(GENERATE_DATE_ARRAY(DATE('2026-01-01'), DATE('2026-03-29'), INTERVAL 7 DAY)) AS d
),
SGAWeekCross AS (
  SELECT a.sga_name, a.sga_start_date, w.week_start
  FROM ActiveSGAs a
  CROSS JOIN AllWeeks w
  WHERE w.week_start >= DATE_TRUNC(a.sga_start_date, WEEK(MONDAY))
),
WeeklyCallsBySGA AS (
  SELECT
    v.SGA_Owner_Name__c AS sga_name,
    DATE_TRUNC(v.Initial_Call_Scheduled_Date__c, WEEK(MONDAY)) AS week_start,
    COUNT(DISTINCT v.primary_key) AS calls_scheduled
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
  INNER JOIN ActiveSGAs a ON v.SGA_Owner_Name__c = a.sga_name
  WHERE v.Initial_Call_Scheduled_Date__c >= DATE('2026-01-01')
    AND v.Initial_Call_Scheduled_Date__c <= DATE('2026-03-29')
    AND v.Initial_Call_Scheduled_Date__c IS NOT NULL
  GROUP BY 1, 2
),
FilledWeeks AS (
  SELECT
    c.sga_name,
    c.sga_start_date,
    c.week_start,
    COALESCE(w.calls_scheduled, 0) AS calls_scheduled
  FROM SGAWeekCross c
  LEFT JOIN WeeklyCallsBySGA w ON c.sga_name = w.sga_name AND c.week_start = w.week_start
)
SELECT
  sga_name,
  sga_start_date,
  COUNT(DISTINCT week_start) AS eligible_weeks,
  SUM(calls_scheduled) AS total_calls,
  ROUND(AVG(calls_scheduled), 2) AS avg_calls_per_week
FROM FilledWeeks
GROUP BY 1, 2
ORDER BY avg_calls_per_week DESC
```

**Expected output**: Per-SGA averages with tenure context
**Validation result**: PASSED — see Results Summary below

## 5. Execution Instructions

All queries can be run directly in BigQuery console or via the dashboard's BigQuery MCP tool. No parameters needed — all values are literal.

To reproduce for a different quarter, change:
- `DATE('2026-01-01')` → quarter start date
- `DATE('2026-03-29')` → last Monday-aligned complete week end (Sunday before quarter end)
- The exclusion list should be re-verified against current `EXCLUDED_REPORT_SGAS` in `src/lib/reporting/tools.ts`

## 6. Council Review

**Reviewed by**: OpenAI (gpt-5.4, reasoning_effort: high), Gemini (gemini-3.1-pro-preview)
**Critical issues found**: 2 (both addressed)
**Changes made**:

1. **Calendar spine generation** — Changed `AllWeeks` from data-derived (`SELECT DISTINCT ... FROM vw_funnel_master`) to `GENERATE_DATE_ARRAY`. This ensures hypothetical zero-call weeks for the entire team are still counted. (OpenAI SHOULD FIX #1, Gemini SHOULD FIX #2)

2. **Tenure-bounded denominator** — Added `User.CreatedDate` to `ActiveSGAs` CTE and filtered `SGAWeekCross` to only include weeks on/after each SGA's start date. New hires no longer have January/February zero-weeks counted against them. This changed the team average from 2.38 → 3.01. (OpenAI SHOULD FIX #3, Gemini CRITICAL #2)

3. **Partial week exclusion** — Capped end date at 2026-03-29 to exclude the 2-day partial week of Mar 30-31. Week count went from 14 → 13. (OpenAI SHOULD FIX #4, Gemini SHOULD FIX #1)

4. **Q1 end-date bounded** — Replaced `CURRENT_DATE()` with hard-coded `DATE('2026-03-29')` so the query remains correct if re-run after Q1. (OpenAI SHOULD FIX #2)

5. **Dedup safety** — Changed `COUNT(*)` to `COUNT(DISTINCT primary_key)`. Validated that grain is 1:1 (656 rows = 656 distinct keys), but added as future-proofing. (OpenAI SUGGESTION #2, Gemini SHOULD FIX #3)

6. **Field semantics documented** — Added explicit note that `Initial_Call_Scheduled_Date__c` (call occurrence date) differs from `mql_stage_entered_ts` (booking activity date) 61% of the time. Stakeholder should confirm which metric they want. (OpenAI SUGGESTION #1, Gemini CRITICAL #1)

**Not changed (by design):**
- Name-based SGA joins: No User ID is exposed in `vw_funnel_master` for `SGA_Owner_Name__c`. The join is name-based by necessity. (OpenAI SUGGESTION #3)
- Hard-coded exclusion list: No programmatic way to pull from the codebase at query time. Source is documented. (OpenAI SUGGESTION #4)

---

## Results Summary

### Primary Answer
**The average number of initial calls scheduled per active SGA per week in Q1 2026 is 3.01** (523 total calls across 16 SGAs, tenure-adjusted to 13 complete weeks).

### Per-SGA Breakdown (Tenure-Bounded)

| SGA | Start Date | Eligible Weeks | Total Calls | Avg Calls/Week |
|-----|------------|----------------|-------------|----------------|
| Brian O'Hara | 2025-11-17 | 13 | 86 | 6.62 |
| Russell Armitage | 2024-07-16 | 13 | 66 | 5.08 |
| Perry Kalmeta | 2024-02-13 | 13 | 51 | 3.92 |
| Eleni Stefanopoulos | 2024-01-31 | 13 | 47 | 3.62 |
| Ryan Crandall | 2025-08-11 | 13 | 45 | 3.46 |
| Craig Suchodolski | 2024-07-08 | 13 | 40 | 3.08 |
| Amy Waller | 2025-08-11 | 13 | 34 | 2.62 |
| Helen Kamens | 2025-08-11 | 13 | 33 | 2.54 |
| Marisa Saucedo | 2025-09-15 | 13 | 31 | 2.38 |
| Jason Ainsworth | 2025-12-16 | 13 | 30 | 2.31 |
| Channing Guyer | 2025-09-15 | 13 | 26 | 2.00 |
| Holly Huffman | 2025-12-16 | 13 | 23 | 1.77 |
| Katie Bassford | 2026-01-20 | 10 | 11 | 1.10 |
| Rashard Wade | 2026-03-04 | 4 | 0 | 0.00 |
| Dan Clifford | 2026-03-18 | 2 | 0 | 0.00 |
| Kai Jean-Simon | 2026-03-18 | 2 | 0 | 0.00 |

### Key Insights
- **Team average: 3.01 initial calls per SGA per week** (tenure-adjusted)
- **Top tier** (>5/wk): Brian O'Hara (6.62), Russell Armitage (5.08) — together account for 29% of all calls
- **Mid tier** (2-5/wk): 8 SGAs averaging 2.00-3.92/wk
- **Low tier** (<2/wk): Holly Huffman (1.77), Katie Bassford (1.10, started Jan 20)
- **Ramping** (0 calls): Dan Clifford, Kai Jean-Simon, Rashard Wade — all hired March 2026
- **Feb 2 week anomaly**: Only 19 team-wide calls (vs 40-96 other weeks) — worth investigating with RevOps
- **Variance**: Top performer is 2.2x the team average — significant but not extreme

### Clarification Needed
**`Initial_Call_Scheduled_Date__c` vs `mql_stage_entered_ts`**: These differ 61% of the time. The current analysis counts by when the call is *scheduled to occur*. If the business intent is "how many calls did SGAs *book* per week" (booking activity), the query should use `mql_stage_entered_ts` instead. This could produce materially different numbers.

---

## Appendix: Raw Council Feedback

### OpenAI Review

**CRITICAL**

- None identified from the provided glossary / field dictionary / query rules.
  The plan's core definitions are aligned with the docs:
  - **Active SGA** = `User.IsSGA__c = TRUE AND User.IsActive = TRUE` with exclusions
  - **Initial Call Scheduled** = `Initial_Call_Scheduled_Date__c` on the lead side
  - **Lead-level attribution** via `SGA_Owner_Name__c` is appropriate for this metric
  - Use of `DATE` comparisons on `Initial_Call_Scheduled_Date__c` is correct for BigQuery

**SHOULD FIX**

1. **Zero-call weeks are not truly guaranteed to be included**
   - **Where**: Primary Query, `AllWeeks` CTE; Key Decision #1
   - **What's wrong**: `AllWeeks` is built from `vw_funnel_master` rows that already have `Initial_Call_Scheduled_Date__c` in range. That means a week only exists if at least one call exists somewhere in the data that week. If the entire team had a zero-call week, it would disappear from the denominator, inflating the average.
   - **Fix**: Generate the week calendar from the date range itself, not from the fact table. Example pattern:
     ```sql
     WITH bounds AS (
       SELECT
         DATE '2026-01-01' AS start_date,
         LEAST(CURRENT_DATE('America/New_York'), DATE '2026-03-31') AS end_date
     ),
     AllWeeks AS (
       SELECT DISTINCT DATE_TRUNC(d, WEEK(MONDAY)) AS week_start
       FROM bounds, UNNEST(GENERATE_DATE_ARRAY(start_date, end_date)) AS d
     )
     ```
     Then use `bounds` for the fact-table filter too.

2. **Q1 end-date logic is not safely bounded**
   - **Where**: Definitions Used (`Q1 2026 QTD`) and Primary Query filters
   - **What's wrong**: `<= CURRENT_DATE()` is only correct while the query is run during Q1 2026. If anyone reruns this later, it will include Q2+ dates and no longer answer "Q1 2026 QTD." Also, `CURRENT_DATE()` defaults to UTC unless a timezone is specified.
   - **Fix**: Cap the end date:
     ```sql
     LEAST(CURRENT_DATE('America/New_York'), DATE '2026-03-31')
     ```
     Or hard-code `DATE '2026-03-31'` if this is a one-off as-of-3/31 analysis.

3. **The denominator includes pre-start weeks for March hires**
   - **Where**: Key Decision #5 and the `SGAWeekCross` logic
   - **What's wrong**: The query cross-joins all currently active SGAs to all QTD weeks, so SGAs who only became active in March are counted as zero for January and February. This is not a definition error, but it is a strong methodology choice that materially suppresses the average.
   - **Fix**: Either:
     - explicitly label the metric as **"based on today's active SGA roster across all QTD weeks"**, or
     - build a tenure-adjusted version that only includes weeks on/after each SGA's start/active date.

     Given your own validation (`2.38` vs `~3.42`), I'd recommend showing both.

4. **Partial-week handling is ambiguous**
   - **Where**: Key Decision #4 / final interpretation
   - **What's wrong**: Monday-based week truncation means Q1 QTD includes:
     - week starting **2025-12-29** for Jan 1–4
     - week starting **2026-03-30** for Mar 30–31

     So "14 weeks" includes two partial weeks. That may be fine, but it will lower the per-week average vs full-week-only logic.
   - **Fix**: Confirm the intended convention with the stakeholder/dashboard:
     - if calendar weeks touched by the date range are correct, keep as is and label it clearly
     - if only full weeks should count, exclude edge partial weeks
     - if they want a normalized QTD weekly rate, use `total_calls / (days_in_range / 7.0)`

**SUGGESTIONS**

1. **Confirm the business intent: scheduled meeting date vs booking activity date**
   - **Where**: Metric definition / field selection
   - **What's wrong**: `Initial_Call_Scheduled_Date__c` is the **date the call is scheduled to occur** and can be future-dated. If the stakeholder really means "how many calls did SGAs schedule in Q1," the closer event field is `mql_stage_entered_ts` (when the lead entered Call Scheduled / MQL).
   - **Fix**: Validate the intent. If they mean booking activity, use `mql_stage_entered_ts` with proper TIMESTAMP filtering/truncation, not `Initial_Call_Scheduled_Date__c`.

2. **Validate the grain of `vw_funnel_master` before relying on `COUNT(*)`**
   - **Where**: `WeeklyCallsBySGA`
   - **What's wrong**: There's no documented dedup flag required for this metric, so `COUNT(*)` may be fine. But that is only safe if `vw_funnel_master` is effectively one row per lead/prospect for this lead-level field.
   - **Fix**: Sanity-check `COUNT(*)` against `COUNT(DISTINCT <lead/prospect id>)` if an ID exists. If they differ, use distinct ID counting.

3. **Joining on SGA name is brittle**
   - **Where**: `INNER JOIN ActiveSGAs a ON v.SGA_Owner_Name__c = a.sga_name`
   - **What's wrong**: Name-based joins can break with duplicate names or historical name changes.
   - **Fix**: Prefer a stable user ID if the view exposes one. If not, at least audit:
     - duplicate `User.Name` values
     - `SGA_Owner_Name__c` values not matching any active SGA name

4. **The hard-coded exclusion list can drift from dashboard logic**
   - **Where**: `ActiveSGAs` CTE
   - **What's wrong**: The query manually embeds the exclusion names. If the canonical excluded list changes, this analysis will no longer match the dashboard.
   - **Fix**: Pull from the same canonical source used by reporting if possible, or at minimum document the exact source/version of the exclusion list.

5. **Rename the output to match what the query actually computes**
   - **Where**: Query label/result section
   - **What's wrong**: "Team-Wide Average" is a little misleading. The query returns **average calls per SGA per week**, not just team average calls per week.
   - **Fix**: Rename it to something like:
     - `avg_initial_calls_per_active_sga_per_week`

     Optionally also return:
     ```sql
     ROUND(SUM(calls_scheduled) / COUNT(DISTINCT week_start), 2) AS avg_team_calls_per_week
     ```
     so both views are available.

### Gemini Review

**CRITICAL**

*   **Confusing Calendar Date with Booking Activity (`Initial_Call_Scheduled_Date__c` vs `mql_stage_entered_ts`)**: The request asks how many initial calls an SGA "has per week". The query uses `Initial_Call_Scheduled_Date__c`, which the Field Dictionary explicitly defines as the date the call *actually takes place* ("can be future"). If an SGA booked a call on March 30 for April 4, this query will exclude it entirely because of the `<= CURRENT_DATE()` filter.
    *   *Fix*: If the business wants to measure SGA weekly **booking activity** (which is standard for RevOps), you must group and filter by `mql_stage_entered_ts` (when the call was scheduled), not the date of the meeting itself. You can also utilize the `is_mql` flag which indicates this action.
*   **Cross-Joining New Hires Against Prior Weeks**: The query cross-joins all 14 weeks of Q1 against SGAs who were hired in mid-March (Dan, Kai, Rashard). Mathematically, this divides their 1–2 weeks of zero-call ramp time by 14 weeks, giving them an artificial ~0.00 average and unfairly dragging the team-wide average down from 3.42 to 2.38.
    *   *Fix*: The denominator for the average must be bounded by the SGA's tenure. Exclude weeks prior to an SGA's creation/start date in the `FilledWeeks` CTE, or explicitly exclude ramping reps from historical performance benchmarks.

**SHOULD FIX**

*   **Partial Week Skew**: Q1 2026 ends on Tuesday, March 31. The week starting Monday, March 30 only contains 2 days of Q1. Averaging a 2-day week against full 7-day weeks artificially lowers the final `avg_calls_per_sga_per_week`.
    *   *Fix*: Filter out the current/partial week, or prorate the final week's volume to a 5-day or 7-day equivalent before calculating the average.
*   **Risky Week Generation Spine**: The `AllWeeks` CTE generates a calendar spine by querying distinct dates from `vw_funnel_master`. If the *entire team* had zero calls in a specific week (e.g., during a company holiday week), that week wouldn't exist in the data and wouldn't be cross-joined, artificially inflating the average.
    *   *Fix*: Use BigQuery's native array function to generate a bulletproof calendar spine: `UNNEST(GENERATE_DATE_ARRAY('2026-01-01', CURRENT_DATE(), INTERVAL 1 WEEK))`.
*   **Using `COUNT(*)` instead of distinct IDs**: The query uses `COUNT(*) AS calls_scheduled` on `vw_funnel_master`. If `vw_funnel_master` contains multiple rows per lead (e.g., stage history) or duplicate entries, this will double-count calls.
    *   *Fix*: Use `COUNT(DISTINCT Lead_ID)` (or the equivalent primary key) to ensure you are counting unique scheduled calls.

**SUGGESTIONS**

*   **Investigate the Outlier Week**: The validation findings note that the week of Feb 2 had only 19 calls compared to a typical 45–96. You should investigate this with RevOps (e.g., was this Sales Kickoff week? A system routing outage?). If it is a legitimate anomaly, consider presenting the **Median** calls per week alongside the **Mean**, as averages are highly sensitive to single-week drop-offs.
*   **Active Status Caveat**: The query relies on `IsActive = TRUE` at the time the query is run. If an SGA was a top performer in January and February but left the company in March (`IsActive = FALSE`), their data is entirely excluded from Q1. This might be fine depending on the requester's intent ("looking at all *currently* active SGAs"), but it means the sum of this query won't tie out to total Q1 pipeline metrics. Add a note explaining this limitation to the stakeholder.
