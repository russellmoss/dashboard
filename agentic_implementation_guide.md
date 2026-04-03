# Outreach Effectiveness Tab — Implementation Reference

**Created**: 2026-04-02 | **Last Updated**: 2026-04-02
**Feature**: SGA Hub tab showing lead-centric outreach metrics (4 scorecards, SGA breakdown table, drill-downs, campaign filter)
**Mount Point**: SGA Hub → "Outreach Effectiveness" tab

---

## Data Sources

| View | Purpose |
|---|---|
| `Tableau_Views.vw_funnel_master` | Lead population, funnel flags, dispositions, campaign fields |
| `Tableau_Views.vw_sga_activity_performance` | Activity data (outbound touches, inbound replies) |
| `SavvyGTMData.User` | SGA list (IsSGA__c), start dates (CreatedDate), active status |

**NOT used**: `savvy_analytics.vw_sga_activity_performance` (missing `is_engagement_tracking`)

---

## Files

| File | Purpose |
|---|---|
| `src/types/outreach-effectiveness.ts` | All TypeScript interfaces |
| `src/lib/queries/outreach-effectiveness.ts` | All BigQuery queries, transforms, cached exports |
| `src/app/api/outreach-effectiveness/dashboard/route.ts` | POST — main dashboard data |
| `src/app/api/outreach-effectiveness/filters/route.ts` | GET — SGA + campaign filter options |
| `src/app/api/outreach-effectiveness/drill-down/route.ts` | POST — all drill-down types |
| `src/components/outreach-effectiveness/OutreachEffectivenessFilters.tsx` | Filter bar (SGA, date range, campaign) with Apply/Reset |
| `src/components/outreach-effectiveness/MetricCards.tsx` | 4 scorecard cards with tooltips |
| `src/components/outreach-effectiveness/SGABreakdownTable.tsx` | Per-SGA table with clickable cells, tooltips |
| `src/components/outreach-effectiveness/OutreachDrillDownModal.tsx` | Drill-down modal (leads, zero-touch, weekly-calls) |
| `src/components/outreach-effectiveness/CampaignSummary.tsx` | Campaign-specific summary card |
| `src/app/dashboard/outreach-effectiveness/OutreachEffectivenessContent.tsx` | Main content component (embedded in SGA Hub) |
| `src/components/sga-hub/SGAHubTabs.tsx` | Tab type + tab entry (modified) |
| `src/app/dashboard/sga-hub/SGAHubContent.tsx` | Conditional render (modified) |

---

## Filters

| Filter | Default | Behavior |
|---|---|---|
| **SGA** | All SGAs (active only) | Active/All toggle. SGA role users forced to own name server-side. Only `IsSGA__c = TRUE` users shown. |
| **Date Range** | QTD | Presets: This Week, Last 30/60/90, QTD, All Time, Custom. Controls FilterDate range for lead population. |
| **Campaign** | All Campaigns | Dropdown from vw_funnel_master distinct campaigns. "No Campaign" option filters to `Campaign_Id__c IS NULL`. Uses UNNEST pattern for `all_campaigns` array. |

**Apply/Reset**: Filters use local draft state. Changes don't fire until "Apply filters" is clicked. "Reset filters" returns to defaults.

---

## SGA Population

Only leads owned by actual SGAs are included:

```sql
TRIM(f.SGA_Owner_Name__c) IN (
  SELECT TRIM(u.Name) FROM User u
  WHERE u.IsSGA__c = TRUE
    AND u.Name NOT IN ('Anett Diaz', 'Ariana Butler', 'Bre McDaniel', 'Bryan Belville',
      'GinaRose Galli', 'Jacqueline Tully', 'Jed Entin', 'Russell Moss',
      'Savvy Marketing', 'Savvy Operations', 'Lauren George')
)
```

This is an **allowlist**, not a blocklist. SGMs, operations users, etc. are excluded even if they own leads.

---

## Lead Classification Hierarchy

Each lead is classified in priority order:

| Priority | Status | Condition |
|---|---|---|
| 1 | **Converted** | `is_sql = 1` |
| 2 | **MQL** | `is_mql = 1` |
| 3 | **Replied** | Has inbound SMS or Call activity (excluding Marketing) |
| 4 | **Replied** | Disposition indicates conversation (see Replied Dispositions below) |
| 5 | **Unengaged** | None of the above |

### Replied Dispositions

These dispositions indicate a conversation happened, even if no inbound task was logged:

- Not Interested in Moving
- Timing
- No Book
- AUM / Revenue too Low
- Book Not Transferable
- Restrictive Covenants
- Compensation Model Issues
- Interested in M&A
- Wants Platform Only
- Other
- Withdrawn or Rejected Application

### NOT Replied

| Disposition | Why | Where it goes |
|---|---|---|
| No Show / Ghosted | Call was scheduled but they didn't show — counts against SGA | Unengaged (measured in persistence metrics) |
| No Response | SGA reached out, lead didn't respond — but proves outreach happened | Unengaged (excluded from zero-touch) |
| Auto-Closed by Operations | System action, not engagement | Unengaged |
| Not a Fit | SGA culled them, not a performance issue | Unengaged + **Bad Lead** flag |
| Bad Contact Info - Uncontacted | Data quality issue | Unengaged + **Bad Lead** flag |
| Bad Lead Provided | Bad source data | Unengaged + **Bad Lead** flag |
| Wrong Phone Number - Contacted | Reached wrong person | Unengaged + **Bad Lead** flag |

---

## Bad Lead Flag (`is_bad_lead`)

Leads with these dispositions are flagged `is_bad_lead = TRUE`:

```
'Not a Fit', 'Bad Contact Info - Uncontacted', 'Bad Lead Provided', 'Wrong Phone Number - Contacted'
```

**Impact**: Bad leads are **excluded from ALL metric denominators** (persistence, avg touchpoints, multi-channel coverage). They appear in the "Bad Leads" column but don't count against SGAs. They are also excluded from zero-touch counts.

---

## Outbound Touchpoint Definition

Activities from `vw_sga_activity_performance` where:

```sql
direction = 'Outbound'
AND is_engagement_tracking = 0
AND COALESCE(activity_channel_group, '') NOT IN ('Marketing', '')
AND task_created_date_est >= DATE_SUB(filter_date, INTERVAL 1 DAY)  -- 1-day buffer for self-sourced timing
AND task_created_date_est <= CURRENT_DATE('America/New_York')
AND TRIM(task_executor_name) = SGA_Owner_Name__c  -- executor filter: only THIS SGA's touches
```

**Includes**: SMS, LinkedIn, Call, Email (Manual), Email (Campaign/automated). Automated emails count because the candidate receives them.

**Excludes**: Engagement tracking events, Marketing channel group activities, touches by previous lead owners (executor filter).

**1-day buffer**: `DATE_SUB(filter_date, INTERVAL 1 DAY)` handles self-sourced leads where the SGA logs activity the same day they create the lead, but FilterDate lands on the next day due to timestamp computation.

---

## Terminality Definition (`is_terminal`)

Uses **TOF_Stage** (current stage) not `lead_closed_date` (may be from a prior lifecycle for recycled leads):

```sql
CASE
  WHEN TOF_Stage IN ('MQL', 'SQL', 'SQO', 'Joined') THEN TRUE   -- progressed
  WHEN TOF_Stage = 'Closed' THEN TRUE                              -- actually closed now
  WHEN TOF_Stage = 'Contacted'                                      -- 30-day stale rule
    AND stage_entered_contacting__c IS NOT NULL
    AND DATE(stage_entered_contacting__c) >= DATE(FilterDate)       -- current lifecycle only
    AND DATE(stage_entered_contacting__c) + 30 <= CURRENT_DATE('America/New_York')
    THEN TRUE
  ELSE FALSE
END
```

**Recycled lead handling**: A lead with `lead_closed_date` from a prior lifecycle but currently in `TOF_Stage = 'Contacted'` is NOT terminal — it's an active lead for the current owner.

---

## Open/Closed Definition (`is_open`)

```sql
CASE
  WHEN TOF_Stage IN ('Closed', 'MQL', 'SQL', 'SQO', 'Joined') THEN FALSE
  ELSE TRUE
END
```

---

## Currently In Contacting (`is_in_contacting`)

```sql
CASE
  WHEN TOF_Stage = 'Contacted'
    AND stage_entered_contacting__c IS NOT NULL
    AND DATE(stage_entered_contacting__c) >= filter_date  -- current lifecycle only
  THEN TRUE
  ELSE FALSE
END
```

Used to include open contacting leads in persistence/multi-channel denominators alongside terminal leads.

---

## Days In Contacting

Only shows a value if the lead entered contacting **in the current lifecycle**:

```sql
CASE
  WHEN stage_entered_contacting__c IS NOT NULL
    AND DATE(stage_entered_contacting__c) >= filter_date
  THEN DATE_DIFF(CURRENT_DATE('America/New_York'), DATE(stage_entered_contacting__c), DAY)
  ELSE NULL
END
```

Recycled leads with `stage_entered_contacting__c` from a prior lifecycle show NULL.

---

## Scorecard 1: Avg. Touchpoints in Contacting

**Headline**: Average outbound touchpoints across contacting unengaged leads
**Secondary**: % with 5+ touchpoints | % premature (<5 touches)

### Denominator: Contacting Unengaged

Leads that are:
- `lead_status = 'Unengaged'`
- `is_worked = TRUE` (at least 1 outbound touchpoint)
- `NOT is_bad_lead`
- `is_terminal OR is_in_contacting` (closed/stale OR currently being worked in contacting)

This includes both terminal leads (closed without engaging) AND open leads currently in contacting. Provides a live view of outreach effort even early in a quarter.

### Metrics

| Metric | Formula |
|---|---|
| Avg Touchpoints | `AVG(outbound_touchpoints)` on contacting unengaged leads |
| 5+ Touches | `COUNTIF(outbound_touchpoints >= 5)` on contacting unengaged leads |
| % 5+ | 5+ touches / contacting unengaged count |
| <5 Touches (premature) | `COUNTIF(outbound_touchpoints < 5)` on contacting unengaged leads |
| % Premature | <5 touches / contacting unengaged count |
| Touch Distribution | Counts at 1, 2, 3, 4, 5+ touchpoints |

---

## Scorecard 2: Multi-Channel Coverage

**Headline**: % of contacting unengaged leads reached via 2+ distinct channels

### Channel Detection

4 channels for multi-channel presence:

| Channel | Detection |
|---|---|
| SMS | `activity_channel = 'SMS'` (outbound, executor-filtered) |
| LinkedIn | `activity_channel = 'LinkedIn'` (outbound, executor-filtered) |
| Call | `activity_channel = 'Call'` (outbound, executor-filtered) |
| Email | `activity_channel LIKE 'Email%'` — includes ALL email (manual + automated via `email_presence` CTE) |

Email presence uses a separate CTE that includes automated emails (lemlist, campaign emails) because the candidate receives them regardless of how they were sent. The email_presence CTE is also executor-filtered.

### Denominator

Same as Scorecard 1: contacting unengaged leads.

### Metrics

| Metric | Formula |
|---|---|
| 2+ Channels | `COUNTIF(multi_channel_count >= 2)` / denominator |
| 3+ Channels | `COUNTIF(multi_channel_count >= 3)` / denominator |
| Channel Gaps | Per-channel coverage % (sorted, two lowest shown in subtext) |

---

## Scorecard 3: Zero-Touch Gap

**Headline**: Count and % of leads with zero tracked outbound activity

### Who counts as zero-touch

All of these must be true:
- `outbound_touchpoints = 0`
- `is_contacted = 0` (excludes ghost contacts — leads marked contacted via untracked channels)
- `NOT is_bad_lead` (excludes Not a Fit, Bad Contact Info, Bad Lead Provided, Wrong Phone Number)
- `lead_status = 'Unengaged'` (excludes leads with Replied dispositions)
- `Disposition__c != 'No Response'` (disposition proves outreach happened, task just wasn't logged)

### No terminality filter

"How many assigned leads have zero outreach?" is valid for any lead age.

### Denominator

Total assigned leads (all leads in the population, not just contacting unengaged).

### Metrics

| Metric | Formula |
|---|---|
| Zero-Touch Count | COUNTIF of all exclusion conditions above |
| Zero-Touch % | Zero-touch count / total assigned |
| Still Open | Zero-touch leads where `is_open = TRUE` |
| Closed | Zero-touch leads where `is_open = FALSE` |

---

## Scorecard 4: Avg Calls / Week

**Headline**: Average initial calls per SGA per week (tenure-bounded, zero-filled)

### Data Source

Uses `vw_funnel_master` fields `Initial_Call_Scheduled_Date__c` and `Qualification_Call_Date__c` (lead-level, not activity-level). Separate CTEs for initial and qualification calls, each grouped by own date.

### Week Series

```sql
GENERATE_DATE_ARRAY(
  GREATEST(DATE_TRUNC(@startDate, WEEK(MONDAY)), DATE_TRUNC(sga_start_date, WEEK(MONDAY))),
  DATE_TRUNC(@endDate, WEEK(MONDAY)),
  INTERVAL 1 WEEK
)
```

- **Tenure-bounded**: Only counts weeks after each SGA's start date (`User.CreatedDate`)
- **Zero-filled**: Weeks with no calls count as 0 in the average
- **Week boundaries**: Monday through Sunday

### Metrics

| Metric | Formula |
|---|---|
| Avg Initial/Week | Total initial calls / total eligible weeks (across all SGAs) |
| Avg Qual/Week | Total qual calls / total eligible weeks |
| Per-SGA | `SAFE_DIVIDE(SUM(calls), COUNT(DISTINCT weeks))` per SGA |

---

## SGA Breakdown Table

### Common Columns (all views)

| Column | Source | Clickable |
|---|---|---|
| SGA | `SGA_Owner_Name__c` | No |
| Assigned | COUNT(*) from lead population | Yes |
| Worked | COUNTIF(is_worked) | Yes |
| Bad Leads | COUNTIF(Disposition IN bad lead list) | Yes |
| MQL | Event-date count: `mql_stage_entered_ts` in range | Yes |
| SQL | Event-date count: `converted_date_raw` in range, `is_sql = 1` | Yes |
| SQO | Event-date count: `Date_Became_SQO__c` in range, `recordtypeid = recruiting`, `is_sqo_unique = 1` | Yes |
| Replied | COUNTIF(lead_status = 'Replied') | Yes |

### MQL/SQL/SQO Event-Date Counting

These columns use a separate `event_date_counts` CTE that matches the **funnel performance page logic** exactly:

```sql
-- MQL: by mql_stage_entered_ts (TIMESTAMP comparison)
TIMESTAMP(mql_stage_entered_ts) >= TIMESTAMP(@startDate)
AND TIMESTAMP(mql_stage_entered_ts) <= TIMESTAMP(@endDateTs)  -- endDateTs = 'YYYY-MM-DD 23:59:59'

-- SQL: by converted_date_raw (DATE comparison)
DATE(converted_date_raw) >= DATE(@startDate)
AND DATE(converted_date_raw) <= DATE(@endDate)
AND is_sql = 1

-- SQO: by Date_Became_SQO__c (TIMESTAMP comparison)
TIMESTAMP(Date_Became_SQO__c) >= TIMESTAMP(@startDate)
AND TIMESTAMP(Date_Became_SQO__c) <= TIMESTAMP(@endDateTs)
AND recordtypeid = '012Dn000000mrO3IAI'  -- Recruiting record type
AND is_sqo_unique = 1
```

**Why event dates?** A lead that entered the funnel in Q1 but SQO'd in Q2 should count as a Q2 SQO. This matches the funnel performance page and leaderboard.

**`endDateTs`**: End date with `' 23:59:59'` appended for TIMESTAMP comparisons. Without this, events happening after midnight UTC on the end date would be excluded.

### Metric-Specific Columns

**Persistence view**: Contacting Unengaged, Avg Touches, 5+ Touches, % 5+, <5 Touches, % Premature

**Multi-Channel view**: 2+ Ch %, 3+ Ch %, All 4 %, SMS %, LinkedIn %, Call %, Email %

**Zero-Touch view**: Zero-Touch count, % Zero-Touch, Still Open, Closed

**Avg Calls/Week view**: Weeks, Total IC, Avg IC/Wk, Total QC, Avg QC/Wk

### Clickable Cells

Volume-based cells (not percentages/averages) are clickable and open a drill-down modal filtered to that exact subset. Zero-value cells are grayed out and not clickable.

---

## Drill-Down Types

### Lead Drill-Down (`type: 'leads'`)

Used by: Assigned, Worked, Replied, Contacting Unengaged, 5+ Touches, <5 Touches, and column filters.

Returns `OutreachLeadRecord`: Advisor Name, SGA, Outbound Touchpoints, Channels Used, Days in Contacting, Status, Campaign, Disposition, Salesforce URL.

### MQL/SQL/SQO Drill-Down (`type: 'leads'`, `columnFilter: 'mql'|'sql'|'sqo'`)

Special case: queries `vw_funnel_master` directly by event date (not the classified_leads CTE) to match the counts in the table. Returns the same `OutreachLeadRecord` shape.

### Zero-Touch Drill-Down (`type: 'zero-touch'`)

Returns `ZeroTouchLeadRecord`: Advisor Name, SGA, Days Since Assignment, Current Stage (from `TOF_Stage`), Disposition, Campaign, Still Open, Salesforce URL.

### Weekly Calls Drill-Down (`type: 'weekly-calls'`)

Returns `WeeklyCallBreakdownRow`: SGA, Week Starting, Initial Calls, Qualification Calls. Shows week-by-week breakdown for a specific SGA.

---

## Campaign Summary

Only visible when a campaign filter is active. Shows:
- Total leads in campaign
- Contacted leads
- Avg touches (contacting unengaged denominator)
- % with 5+ touchpoints
- Multi-channel coverage %

---

## Executor Filter

`TRIM(a.task_executor_name) = lp.SGA_Owner_Name__c`

**Applied to**: `outbound_touches` CTE, `email_presence` CTE

**NOT applied to**:
- `inbound_activity` CTE — a reply is engagement regardless of who triggered it
- Zero-touch metric — coverage gap counts any owner
- Metric 5 avg calls/week — uses lead-level fields, not activity records

**Why**: Prevents reassigned leads from inflating the new owner's persistence metrics. Cross-SGA activity is ~3.8% of volume.

---

## Inbound Reply Detection

Only SMS and Call have tracked inbound activity in `vw_sga_activity_performance`. No inbound email is tracked. Marketing inbound events are excluded.

```sql
direction = 'Inbound'
AND COALESCE(activity_channel_group, '') NOT IN ('Marketing', '')
```

The inbound_activity CTE is NOT executor-filtered (a reply is engagement regardless) and NOT date-bounded (any reply at any time counts).

---

## Type Coercion Rules

| Type | Function | Use For |
|---|---|---|
| `parseInt(String(v \|\| 0)) \|\| 0` | `toInt()` | All integer counts |
| `parseFloat(String(v \|\| 0)) \|\| 0` | `toFloat()` | All averages, rates, percentages |
| `safePct(num, den)` | `den > 0 ? Math.round((num/den) * 1000) / 10 : 0` | Percentage calculations |

**CRITICAL**: Never use `parseInt` on BigQuery `AVG`/`SAFE_DIVIDE` output — it truncates decimals silently.

---

## Caching

All query functions wrapped with `cachedQuery(fn, keyName, CACHE_TAGS.SGA_HUB)`. Default TTL: 4 hours.

Cache refresh: `POST /api/admin/refresh-cache` revalidates the `sga-hub` tag.

---

## Auth Pattern

All 3 API routes:
1. `getServerSession(authOptions)` → verify logged in
2. `getSessionPermissions(session)` → derive role from JWT (no DB query)
3. Role check: `['admin', 'manager', 'sga', 'sgm', 'revops_admin']`
4. SGA role override: `if (permissions.role === 'sga') filters.sga = permissions.sgaFilter`
