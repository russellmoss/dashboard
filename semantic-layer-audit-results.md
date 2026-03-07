# Semantic Layer Audit Results

**Date**: 2026-03-07
**Updated**: 2026-03-07 (verification queries completed, corrections applied)
**Agents**: Gap Finder, Schema Author, Data Validator (3-agent parallel audit)

---

## 1. Audit Summary

| Category | Count |
|---|---|
| **Total gaps found** | 17 |
| High priority | 8 |
| Medium priority | 6 |
| Low priority | 3 |
| **Ready to implement now (Batch 1 + 2)** | 12 |
| **Blocked (architecture / data source)** | 5 |

---

## 2. Gap Inventory

### HIGH PRIORITY

| ID | Feature | Gap Type | Data Status | Implementable? |
|---|---|---|---|---|
| H1 | SGA Activity Metrics (calls, SMS, LinkedIn by channel) | Missing metric + template | Uses `vw_sga_activity_performance` — separate view, NOT in vw_funnel_master | BLOCKED — requires multi-view architecture |
| H2 | SMS Response Rate / Call Answer Rate | Missing metric + template | Same view as H1 | BLOCKED — same as H1 |
| H3 | Closed Lost Re-Engagement Candidates | Missing metric + dimension + template | Uses `vw_sga_closed_lost_sql_followup` + direct Opportunity/Lead tables | PARTIAL — basic closed-lost list from vw_funnel_master is ready; full follow-up workflow blocked |
| H4 | Re-Engagement Opportunities | Missing entity mapping + template | Uses direct `SavvyGTMData.Opportunity` with RE_ENGAGEMENT_RECORD_TYPE | READY — can query vw_funnel_master with record_type filter |
| H5 | Pipeline Aging / Days in Stage / Stale Alerts | Missing metric + dimension + template | Fields exist in vw_funnel_master (Stage_Entered_* timestamps) | READY — needs `Stage_Entered_Closed__c` added to DATE_FIELDS |
| H6 | SGM-Level Pipeline & Conversion Metrics | Missing entity mapping + template | Uses User table for active SGM list | PARTIAL — SGM dimension exists, but active-SGM entity needs User table |
| H7 | Forecast Goals vs Actuals | Missing metric + template | `vw_daily_forecast` exists, constant already in CONSTANTS. `q4_2025_forecast` table is current (latest_month = 2026-03). | READY — needs metrics + template for daily forecast view |
| H8 | SGA Weekly/Quarterly Goals vs Actuals | Missing metric + template | Goals in PostgreSQL, actuals in BigQuery | BLOCKED — requires hybrid data source routing |

### MEDIUM PRIORITY

| ID | Feature | Gap Type | Data Status | Implementable? |
|---|---|---|---|---|
| M1 | MQL/SQL/SQO Disposition Counts | Missing metric | Fields in vw_funnel_master | READY |
| M2 | Advisor Location / Geographic Dimensions | Missing dimension + view | Uses `vw_joined_advisor_location` | BLOCKED — separate view |
| M3 | SGA Leaderboard / Active SGA Entity | Missing entity mapping + template | Uses User table flags | PARTIAL |
| M4 | Conversion Rate Trend Series | Missing query template | Same fields as existing conversion metrics | READY — existing `conversion_trend` template may already cover this |
| M5 | Weekly Actuals per SGA | Missing query template | Same fields as existing metrics, weekly grouping | READY |
| M6 | DoNotCall / Ghost Lead Patterns | Missing dimension + entity mapping | `DoNotCall` field in vw_funnel_master (BOOL, confirmed) | READY |

### LOW PRIORITY

| ID | Feature | Gap Type | Data Status | Implementable? |
|---|---|---|---|---|
| L1 | GC Hub Revenue/Commission | Missing everything | PostgreSQL only (Prisma) | BLOCKED — wrong data source |
| L2 | Recruiter Hub Conversion_Status | Missing dimension | Field in vw_funnel_master | READY (verified) |
| L3 | Campaign Name vs Campaign ID | Missing dimension | `Campaign_Name__c` in vw_funnel_master | READY (verified) |

---

## 3. Recommended Additions (Ready to Implement)

### 3a. `definitions.ts` — DATE_FIELDS

Add after `Stage_Entered_On_Hold__c` (before closing `} as const;`):

```typescript
  Stage_Entered_Closed__c: {
    description: 'When opportunity entered Closed (Lost) stage',
    type: 'TIMESTAMP',
    usedFor: ['closed_lost', 'opportunities_by_age'],
    note: 'Legacy data gap: 2023 = 3.6% populated, 2024 = 65.4%, 2025 = 74.5%, 2026 = 80.3%. Reliable for 2024+ records. Do not promise exact closed dates for pre-2024 records.',
  },
```

### 3b. `definitions.ts` — DIMENSIONS

Add after `external_agency` (before closing `} as const;`):

```typescript
  next_steps: {
    name: 'Next Steps (Lead)',
    description: 'Next steps text on the lead record (Next_Steps__c)',
    field: 'v.Next_Steps__c',
    rawField: 'Next_Steps__c',
    requiresJoin: false,
    filterable: true,
    groupable: false,
    aliases: ['lead next steps', 'follow-up notes'],
    note: 'Free text field, max 255 chars. Use for filtering by keyword, not grouping.',
  },

  opp_next_step: {
    name: 'Opportunity Next Step',
    description: 'Next step text on the opportunity record',
    field: 'v.NextStep',
    rawField: 'NextStep',
    requiresJoin: false,
    filterable: true,
    groupable: false,
    aliases: ['opportunity next step', 'opp next step'],
    note: 'Salesforce standard NextStep field on Opportunity. Free text, max 255 chars.',
  },

  conversion_status: {
    name: 'Conversion Status',
    description: 'Lead-level disposition status relative to the current funnel stage being viewed',
    field: 'v.Conversion_Status',
    rawField: 'Conversion_Status',
    requiresJoin: false,
    filterable: true,
    groupable: true,
    allowedValues: ['Open', 'Closed', 'Joined'],
    aliases: ['lead status', 'prospect status', 'disposition'],
    note: 'Context-dependent by funnel stage. For a given stage (e.g., MQL): Open = has not yet progressed or closed, Closed = closed lost, Joined = progressed to the next stage (e.g., became SQL). The frontend interprets these values contextually per stage. Distribution: Closed = 85,046, Open = 22,254, Joined = 118.',
  },

  closed_lost_reason: {
    name: 'Closed Lost Reason',
    description: 'Reason the opportunity was closed lost',
    field: 'v.Closed_Lost_Reason__c',
    rawField: 'Closed_Lost_Reason__c',
    requiresJoin: false,
    filterable: true,
    groupable: true,
    allowedValues: [
      'No Longer Responsive',
      'No Show – Intro Call',
      'Candidate Declined - Timing',
      'Savvy Declined - No Book of Business',
      'Savvy Declined - Insufficient Revenue',
      'Savvy Declined – Book Not Transferable',
      'Candidate Declined - Economics',
      'Candidate Declined - Fear of Change',
      'Other',
      'Savvy Declined - Poor Culture Fit',
      'Candidate Declined - Lost to Competitor',
      'Candidate Declined - Operational Constraints',
      'Savvy Declined - Compliance',
    ],
    aliases: ['loss reason', 'close reason', 'why lost', 'reason for loss'],
    note: 'Only populated on Closed Lost opportunities. 13 known values. Top reasons: No Longer Responsive (272), No Show – Intro Call (237), Candidate Declined - Timing (235).',
  },

  campaign_name: {
    name: 'Campaign Name',
    description: 'Human-readable Salesforce campaign name',
    field: 'v.Campaign_Name__c',
    rawField: 'Campaign_Name__c',
    requiresJoin: false,
    filterable: true,
    groupable: true,
    aliases: ['campaign name', 'marketing campaign name'],
    note: 'Perfect coverage: 10,312 records with Campaign_Id have matching Campaign_Name. Zero orphaned IDs. More user-friendly than campaign dimension (which uses Campaign_Id__c).',
  },
```

### 3c. `definitions.ts` — ENTITY_MAPPINGS

Add after `'signed deals'` (before closing `} as const;`):

```typescript
  're-engagement opportunities': {
    filter: "v.record_type_name = 'Re-Engagement' AND v.StageName NOT IN ('Closed Lost', 'Joined')",
    description: 'Open re-engagement opportunities (returning advisors, not new recruiting)',
  },
  'stale pipeline': {
    filter: "v.is_sqo_unique = 1 AND v.StageName IN ('Qualifying', 'Discovery', 'Sales Process', 'Negotiating')",
    description: 'Open pipeline opportunities — combine with days-in-stage calculation for staleness',
  },
  'external agency leads': {
    filter: "v.External_Agency__c IS NOT NULL AND TRIM(v.External_Agency__c) != ''",
    description: 'Leads sourced through an external recruiter agency',
  },
```

### 3d. `query-templates.ts` — New Templates

Add these 4 templates inside `QUERY_TEMPLATES` before the closing `} as const;`:

#### closed_lost_list
```typescript
  // ===========================================================================
  // CLOSED LOST LIST - Closed-lost SQOs
  // ===========================================================================
  closed_lost_list: {
    id: 'closed_lost_list',
    description: 'List closed-lost SQOs with AUM and reason',

    template: `
      SELECT
        v.advisor_name,
        v.SGA_Owner_Name__c as sga,
        v.SGM_Owner_Name__c as sgm,
        v.StageName as stage,
        v.Date_Became_SQO__c as sqo_date,
        v.Closed_Lost_Reason__c as closed_lost_reason,
        COALESCE(v.Underwritten_AUM__c, v.Amount) as aum,
        v.aum_tier,
        v.Original_source as source,
        IFNULL(v.Channel_Grouping_Name, 'Other') as channel,
        v.salesforce_url
      FROM \`${FULL_TABLE}\` v
      WHERE v.StageName = 'Closed Lost'
        AND v.recordtypeid = @recruitingRecordType
        AND v.is_sqo_unique = 1
        {dimensionFilters}
      ORDER BY COALESCE(v.Underwritten_AUM__c, v.Amount) DESC NULLS LAST
    `,

    parameters: {
      recruitingRecordType: { type: 'constant', value: RECRUITING_RECORD_TYPE },
      dimensionFilters: { type: 'filter[]', required: false },
    },

    visualization: 'table',

    exampleQuestions: [
      'Show me closed lost opportunities',
      'List closed lost deals for John Doe',
      'Which closed lost opportunities have the highest AUM?',
      'Why did we lose deals this quarter?',
    ],
  },
```

#### re_engagement_list
```typescript
  // ===========================================================================
  // RE-ENGAGEMENT LIST - Open re-engagement opportunities
  // ===========================================================================
  re_engagement_list: {
    id: 're_engagement_list',
    description: 'List open re-engagement opportunities (returning advisors)',

    template: `
      SELECT
        v.advisor_name,
        v.SGA_Owner_Name__c as sga,
        v.SGM_Owner_Name__c as sgm,
        v.StageName as stage,
        v.Opp_CreatedDate as created_date,
        COALESCE(v.Underwritten_AUM__c, v.Amount) as aum,
        v.aum_tier,
        v.salesforce_url
      FROM \`${FULL_TABLE}\` v
      WHERE v.record_type_name = 'Re-Engagement'
        AND v.StageName NOT IN ('Closed Lost', 'Joined')
        AND v.is_primary_opp_record = 1
        {dimensionFilters}
      ORDER BY COALESCE(v.Underwritten_AUM__c, v.Amount) DESC NULLS LAST
    `,

    parameters: {
      dimensionFilters: { type: 'filter[]', required: false },
    },

    visualization: 'table',

    exampleQuestions: [
      'Show me the re-engagement pipeline',
      'List open re-engagement opportunities',
      'Re-engagement opps for John Doe',
      'What re-engagement opportunities are in Discovery?',
    ],
  },
```

#### weekly_actuals_by_sga
```typescript
  // ===========================================================================
  // WEEKLY ACTUALS BY SGA - Calls, qual calls, SQOs by week
  // ===========================================================================
  weekly_actuals_by_sga: {
    id: 'weekly_actuals_by_sga',
    description: 'Weekly breakdown of initial calls, qualification calls, and SQOs',

    template: `
      WITH weeks AS (
        SELECT week_start
        FROM UNNEST(GENERATE_DATE_ARRAY(
          DATE_TRUNC(DATE(@startDate), WEEK(MONDAY)),
          DATE_TRUNC(DATE(@endDate), WEEK(MONDAY)),
          INTERVAL 1 WEEK
        )) as week_start
      ),
      ic AS (
        SELECT DATE_TRUNC(v.Initial_Call_Scheduled_Date__c, WEEK(MONDAY)) as week_start,
          COUNT(DISTINCT v.primary_key) as count
        FROM \`${FULL_TABLE}\` v
        WHERE v.Initial_Call_Scheduled_Date__c >= @startDate
          AND v.Initial_Call_Scheduled_Date__c <= @endDate
          {sgaFilterLead}
        GROUP BY 1
      ),
      qc AS (
        SELECT DATE_TRUNC(v.Qualification_Call_Date__c, WEEK(MONDAY)) as week_start,
          COUNT(DISTINCT v.Full_Opportunity_ID__c) as count
        FROM \`${FULL_TABLE}\` v
        WHERE v.Qualification_Call_Date__c >= @startDate
          AND v.Qualification_Call_Date__c <= @endDate
          {sgaFilterLead}
        GROUP BY 1
      ),
      sq AS (
        SELECT DATE(DATE_TRUNC(v.Date_Became_SQO__c, WEEK(MONDAY))) as week_start,
          COUNT(*) as count
        FROM \`${FULL_TABLE}\` v
        WHERE v.is_sqo_unique = 1
          AND v.recordtypeid = @recruitingRecordType
          AND v.Date_Became_SQO__c >= TIMESTAMP(@startDate)
          AND v.Date_Became_SQO__c <= TIMESTAMP(CONCAT(@endDate, ' 23:59:59'))
          {sgaFilterOpp}
        GROUP BY 1
      )
      SELECT w.week_start,
        COALESCE(ic.count, 0) as initial_calls,
        COALESCE(qc.count, 0) as qualification_calls,
        COALESCE(sq.count, 0) as sqos
      FROM weeks w
      LEFT JOIN ic ON w.week_start = ic.week_start
      LEFT JOIN qc ON w.week_start = qc.week_start
      LEFT JOIN sq ON w.week_start = sq.week_start
      ORDER BY w.week_start DESC
    `,

    parameters: {
      startDate: { type: 'date', required: true },
      endDate: { type: 'date', required: true },
      sga: { type: 'string', required: false },
      recruitingRecordType: { type: 'constant', value: RECRUITING_RECORD_TYPE },
      dimensionFilters: { type: 'filter[]', required: false },
    },

    visualization: 'table',

    exampleQuestions: [
      'Show weekly actuals for John Doe this quarter',
      'How many initial calls each week this month?',
      'Weekly SQO breakdown this quarter',
    ],
  },
```

#### sga_quarterly_progress
```typescript
  // ===========================================================================
  // SGA QUARTERLY PROGRESS - SQO count and AUM by quarter
  // ===========================================================================
  sga_quarterly_progress: {
    id: 'sga_quarterly_progress',
    description: 'Quarterly SQO count and total AUM for a specific SGA',

    template: `
      SELECT
        CONCAT(
          CAST(EXTRACT(YEAR FROM v.Date_Became_SQO__c) AS STRING),
          '-Q',
          CAST(EXTRACT(QUARTER FROM v.Date_Became_SQO__c) AS STRING)
        ) as quarter,
        COUNT(*) as sqo_count,
        SUM(v.Opportunity_AUM) as total_aum
      FROM \`${FULL_TABLE}\` v
      WHERE v.is_sqo_unique = 1
        AND v.recordtypeid = @recruitingRecordType
        AND v.Date_Became_SQO__c IS NOT NULL
        AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDate)
        AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(CONCAT(@endDate, ' 23:59:59'))
        {sgaFilterOpp}
        {dimensionFilters}
      GROUP BY quarter
      ORDER BY quarter DESC
    `,

    parameters: {
      startDate: { type: 'date', required: true },
      endDate: { type: 'date', required: true },
      sga: { type: 'string', required: false },
      recruitingRecordType: { type: 'constant', value: RECRUITING_RECORD_TYPE },
      dimensionFilters: { type: 'filter[]', required: false },
    },

    visualization: 'table',

    exampleQuestions: [
      "What's John Doe's quarterly SQO count?",
      'Show SQO progress by quarter for the last 4 quarters',
      'SQO history for Sarah Smith this year',
    ],
  },
```

### 3e. `agent-prompt.ts` — New Capabilities

Add to the `## YOUR CAPABILITIES` section:

```
- Closed-lost opportunity lists (why deals were lost, loss reasons, AUM)
- Re-engagement pipeline (returning advisors with Re-Engagement record type)
- Weekly activity cadence (initial calls, qualification calls, SQOs by week per SGA)
- SGA quarterly progress (SQO count and AUM grouped by quarter)
- Pipeline aging questions (which deals are stale in a given stage)
```

### 3f. `agent-prompt.ts` — New Example Mappings

Add to the `## EXAMPLE MAPPINGS` section:

```
Question: "show me closed lost opportunities"
-> templateId: "closed_lost_list"
Note: No dateRange needed — current snapshot of all closed-lost SQOs. Add SGA/SGM/channel filters as needed.

Question: "why are we losing deals?"
-> templateId: "metric_by_dimension", metric: "sqos", dimension: "closed_lost_reason", dateRange: { "preset": "this_quarter" }
Note: Use closed_lost_reason dimension to group SQOs by loss reason. For a detailed list, use closed_lost_list instead.

Question: "show me the re-engagement pipeline"
-> templateId: "re_engagement_list"
Note: Re-engagement opportunities have a different record type than recruiting. No date range needed — current snapshot.

Question: "show me John Doe's weekly activity this quarter"
-> templateId: "weekly_actuals_by_sga", filters: [{ "dimension": "sga", "operator": "equals", "value": "John Doe" }], dateRange: { "preset": "this_quarter" }
Note: Returns weekly series of initial calls, qual calls, and SQOs. Requires a date range.

Question: "what's Sarah Smith's quarterly SQO history?"
-> templateId: "sga_quarterly_progress", filters: [{ "dimension": "sga", "operator": "equals", "value": "Sarah Smith" }], dateRange: { "preset": "custom", "startDate": "2025-01-01", "endDate": "2026-03-07" }
Note: For multi-quarter history, set a wide date range. Results group by quarter automatically.

Question: "which deals have been in Discovery for more than 60 days?"
-> templateId: "open_pipeline_list", filters: [{ "dimension": "stage_name", "operator": "equals", "value": "Discovery" }]
Note: The open_pipeline_list template includes days-in-stage data. Filter by stage and look for stale records. The client-side StalePipelineAlerts component uses thresholds: fresh (<30d), warning (30-59d), stale (60-89d), critical (90d+).
```

---

## 4. Data Validation Results

### ✅ All Verification Queries Completed (2026-03-07)

### Query 7: Column Existence — ALL CONFIRMED

| Field | Data Type | Status |
|---|---|---|
| `Stage_Entered_Closed__c` | TIMESTAMP | ✅ Confirmed |
| `DoNotCall` | BOOL | ✅ Confirmed |
| `Closed_Lost_Reason__c` | STRING | ✅ Confirmed |
| `Campaign_Name__c` | STRING | ✅ Confirmed |
| `Conversion_Status` | STRING | ✅ Confirmed |

### Query 1: Closed Lost Reason Distribution — 13 VALUES

| Closed_Lost_Reason__c | Count |
|---|---|
| No Longer Responsive | 272 |
| No Show – Intro Call | 237 |
| Candidate Declined - Timing | 235 |
| Savvy Declined - No Book of Business | 213 |
| Savvy Declined - Insufficient Revenue | 201 |
| Savvy Declined – Book Not Transferable | 169 |
| Candidate Declined - Economics | 131 |
| Candidate Declined - Fear of Change | 123 |
| Other | 101 |
| Savvy Declined - Poor Culture Fit | 92 |
| Candidate Declined - Lost to Competitor | 91 |
| Candidate Declined - Operational Constraints | 15 |
| Savvy Declined - Compliance | 10 |

**Coaching insight**: Top 2 reasons (No Longer Responsive + No Show – Intro Call) are early-funnel disengagement — 509 total. These are addressable through SGA velocity and multi-channel outreach.

### Query 2: Stage_Entered_Closed__c Population — 51.1% OVERALL (LEGACY GAP)

| Total Closed Lost | Has Date | Pct |
|---|---|---|
| 1,973 | 1,009 | 51.1% |

**Follow-up query — Population by entry year**:

| Entry Year | Total | Has Date | Pct |
|---|---|---|---|
| 2023 | 583 | 21 | 3.6% |
| 2024 | 564 | 369 | 65.4% |
| 2025 | 765 | 570 | 74.5% |
| 2026 | 61 | 49 | 80.3% |

**Conclusion**: Legacy data issue, NOT a current tracking problem. Field was introduced mid-2024. Reliable for 2024+ records and improving. The `closed_lost_list` template does NOT depend on this field (uses `StageName = 'Closed Lost'`), so no impact on Batch 1 implementation.

**Follow-up query — Stage distribution**: Almost exclusively Closed Lost records (1,973). Only 4 records on other stages (Discovery, Negotiating, Joined, Sales Process) — these are recycled opps that passed through Closed Lost and were reopened.

### Query 3: Text Field Max Lengths — SAFE

| Field | Max Length |
|---|---|
| `Next_Steps__c` | 255 |
| `NextStep` | 255 |

No `SUBSTR` needed. Both capped at Salesforce's standard 255-char text field limit.

### Query 4: Campaign_Name__c Coverage — PERFECT

| Has Campaign_Id | Has Campaign_Name | ID Without Name |
|---|---|---|
| 10,312 | 10,312 | 0 |

Zero orphaned Campaign IDs. Campaign_Name__c is a safe replacement for Campaign_Id__c in user-facing queries.

### Query 5: Forecast Table Currency — CURRENT

| Latest Month |
|---|
| 2026-03 |

**Note**: The table `q4_2025_forecast` has a misleading name — it is actually a rolling goals table that started in Q4 2025 but contains goals for future quarters (Q1 2026, Q2 2026, etc.). It breaks down MQL, SQL, and SQO goals by source and channel. The name is misleading but the data is current through March 2026.

### Query 6: Conversion_Status Distribution — CORRECTED VALUES

| Conversion_Status | Count |
|---|---|
| Closed | 85,046 |
| Open | 22,254 |
| Joined | 118 |

**⚠️ CORRECTION**: The original audit assumed values `['Open', 'Closed', 'Converted']`. Actual values are `['Open', 'Closed', 'Joined']`. There is NO "Converted" value.

**Business logic**: Conversion_Status is context-dependent per funnel stage. When viewing a specific stage (e.g., MQL): Open = has not yet progressed or closed lost, Closed = closed lost, Joined = progressed to the next stage. The frontend interprets these values contextually per stage view.

### Data Quality Flags (Updated)

| Flag | Severity | Status | Notes |
|---|---|---|---|
| `Opp_SGA_Name__c` mixed type | CRITICAL | ⚠️ KNOWN | Contains both human names AND Salesforce IDs. DO NOT add as standalone dimension. Already handled by SGA_FILTER_PATTERNS. |
| `q4_2025_forecast` stale name | ~~HIGH~~ RESOLVED | ✅ | Name is misleading but data is current (latest_month = 2026-03). Rolling goals table, not Q4-specific. |
| `Next_Steps__c` / `NextStep` free text | ~~MEDIUM~~ RESOLVED | ✅ | Max 255 chars each. Safe to display without truncation. |
| `Conversion_Status` wrong values in audit | HIGH | ✅ CORRECTED | Changed from `['Open', 'Closed', 'Converted']` to `['Open', 'Closed', 'Joined']` in Section 3b. |
| `Stage_Entered_Closed__c` low population | MEDIUM | ✅ DOCUMENTED | Legacy data gap (3.6% in 2023 → 80.3% in 2026). Added note to DATE_FIELDS entry. |
| `vw_sga_closed_lost_sql_followup` 30-179d only | MEDIUM | ⚠️ KNOWN | Missing 180+ day bucket. Don't use as sole closed-lost source. |
| `vw_daily_forecast` min date | LOW | ⚠️ KNOWN | Starts at 2025-10-01. Document constraint so AI doesn't query earlier periods. |

---

## 5. Blocked Items

| Item | Blocker | Resolution |
|---|---|---|
| H1/H2: SGA Activity Metrics | Uses `vw_sga_activity_performance` — separate view with different grain (tasks, not leads/opps) | Requires multi-view semantic layer architecture. Phase 2 project. |
| H8: SGA Weekly/Quarterly Goals | Goals stored in PostgreSQL (Prisma), actuals in BigQuery | Requires hybrid data source routing in the agent. Phase 2 project. |
| M2: Advisor Locations | Uses `vw_joined_advisor_location` — separate view | Requires multi-view architecture. Could be standalone template. |
| L1: GC Hub Revenue | PostgreSQL only (Prisma) | Wrong data source entirely. Out of scope. |
| H3 (full): Closed Lost Follow-Up Workflow | `vw_sga_closed_lost_sql_followup` has 30-179 day coverage gap; full workflow uses direct Opportunity/Lead table CTEs | Basic closed-lost list from vw_funnel_master IS implementable (see Section 3). Full workflow needs view enhancement. |

---

## 6. Implementation Plan

### Batch 1 — Implement Now (no blockers, all verified)

**Files to modify**: `definitions.ts`, `query-templates.ts`, `agent-prompt.ts`

1. **`definitions.ts` — DATE_FIELDS**: Add `Stage_Entered_Closed__c` (Section 3a)
2. **`definitions.ts` — ENTITY_MAPPINGS**: Add `re-engagement opportunities`, `stale pipeline`, `external agency leads` (Section 3c)
3. **`query-templates.ts`**: Add `closed_lost_list` template (Section 3d)
4. **`query-templates.ts`**: Add `re_engagement_list` template (Section 3d)
5. **`query-templates.ts`**: Add `weekly_actuals_by_sga` template (Section 3d)
6. **`query-templates.ts`**: Add `sga_quarterly_progress` template (Section 3d)
7. **`agent-prompt.ts`**: Add 5 new capabilities (Section 3e)
8. **`agent-prompt.ts`**: Add 6 new example mappings (Section 3f)

**Validation after Batch 1**: Verify the query compiler handles `{sgaFilterLead}` and `{sgaFilterOpp}` placeholders in the new `weekly_actuals_by_sga` and `sga_quarterly_progress` templates. These must be substituted using `SGA_FILTER_PATTERNS` the same way existing templates handle them. Run TypeScript compilation check.

### Batch 2 — Implement Now (all verification queries passed)

**Files to modify**: `definitions.ts`

9. **`definitions.ts` — DIMENSIONS**: Add `closed_lost_reason` with 13 verified `allowedValues` (Section 3b)
10. **`definitions.ts` — DIMENSIONS**: Add `campaign_name` (Section 3b)
11. **`definitions.ts` — DIMENSIONS**: Add `conversion_status` with corrected `allowedValues: ['Open', 'Closed', 'Joined']` (Section 3b)
12. **`definitions.ts` — DIMENSIONS**: Add `next_steps` + `opp_next_step` (Section 3b)

**Note**: Batch 2 was originally gated on verification queries. All queries have now passed — implement alongside Batch 1.

### Batch 3 — Design Decision Required

13. Forecast goal metrics — `q4_2025_forecast` table is confirmed current. Decision: use existing `vw_daily_forecast` constant or create new FORECAST_METRICS section?
14. SGM-level pipeline template — needs User table join for active SGM filtering
15. SGA leaderboard/ranking template — needs User table join for active SGA list

### Phase 2 — Multi-View Architecture

16. SGA activity metrics (`vw_sga_activity_performance`)
17. Hybrid PostgreSQL+BigQuery goal tracking
18. Advisor location/geographic queries (`vw_joined_advisor_location`)
19. Lost-to-competition analysis (`vw_lost_to_competition`)
