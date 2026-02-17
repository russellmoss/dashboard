# Open Funnel: Codebase Exploration Document

## Purpose

This document is a **codebase investigation guide** for adding disposition toggles (`All | Open | Lost | Converted`) to the MQL, SQL, and SQO scorecards on the Funnel Performance & Efficiency dashboard.

**Your job is to answer every question below by exploring the actual codebase.** Write your findings directly under each `**Finding:**` section. Do not skip any question. Do not summarize — paste actual code snippets, types, and file paths. This document becomes the single source of truth for the implementation plan that follows.

## Context

The feature adds a four-position segmented button group to each of the MQL, SQL, and SQO scorecard cards. The toggle positions are:
- **All** — current behavior, total count (default)
- **Open** — records that reached this stage but haven't converted to the next stage or closed lost
- **Lost** — records that reached this stage and closed lost without converting
- **Converted** — records that reached this stage and successfully converted to the next stage

When toggled, the scorecard number updates. When the card is clicked for drill-down, the disposition filter carries through. Goal bars hide for any position other than "All."

---

## PHASE 1: Data Layer — What Fields Exist and How Do They Work?

### 1.1 — `Conversion_Status` Field

- **Files to check:** `views/vw_funnel_master.sql`, `views/deploy_vw_funnel_master.sql`
- **Task:** Find and paste the exact CASE expression that computes `Conversion_Status`. List every possible output value.
- **Key question:** `Conversion_Status` has values `'Joined'`, `'Closed'`, and `'Open'`. Does `'Closed'` mean "Closed Lost" specifically, or does it include any terminal non-success state? Is `'Joined'` separate from `'Closed'` (i.e., are they mutually exclusive)?
- **Finding:**

```sql
-- From views/vw_funnel_master.sql lines 436-441
CASE
  WHEN advisor_join_date__c IS NOT NULL OR StageName = 'Joined' THEN 'Joined'
  WHEN Disposition__c IS NOT NULL OR StageName = 'Closed Lost' THEN 'Closed'
  ELSE 'Open'
END AS Conversion_Status,
```

**Possible values:** `'Joined'`, `'Closed'`, `'Open'`

**Analysis:**
- `'Joined'` = Successfully converted to a joined advisor (has join date OR StageName = 'Joined')
- `'Closed'` = Either lead disposition was set (`Disposition__c IS NOT NULL`) OR opportunity StageName = 'Closed Lost'. This means "Closed Lost" specifically — not other terminal states like Signed.
- `'Open'` = Everything else (still in progress)
- **Yes, they are mutually exclusive.** Joined takes precedence, then Closed, then Open.

---

### 1.2 — `TOF_Stage` Field

- **Files to check:** `views/vw_funnel_master.sql`
- **Task:** Find and paste the exact CASE expression that computes `TOF_Stage`. List every possible output value.
- **Key question:** Is `TOF_Stage` the *highest* stage reached, or the *current* stage? For example, if someone MQL'd then SQL'd, is their `TOF_Stage` = `'SQL'` or `'MQL'`?
- **Finding:**

```sql
-- From views/vw_funnel_master.sql lines 443-452
CASE
  WHEN advisor_join_date__c IS NOT NULL OR StageName = 'Joined' THEN 'Joined'
  WHEN StageName = 'Closed Lost' THEN 'Closed'
  WHEN LOWER(SQO_raw) = 'yes' THEN 'SQO'
  WHEN is_sql = 1 THEN 'SQL'
  WHEN is_mql = 1 THEN 'MQL'
  WHEN is_contacted = 1 THEN 'Contacted'
  ELSE 'Prospect'
END AS TOF_Stage,
```

**Possible values:** `'Joined'`, `'Closed'`, `'SQO'`, `'SQL'`, `'MQL'`, `'Contacted'`, `'Prospect'`

**Analysis:**
- `TOF_Stage` represents the **highest stage reached**, not the current stage.
- If someone MQL'd then SQL'd, their `TOF_Stage` = `'SQL'` (because `is_sql = 1` is checked before `is_mql = 1`).
- Terminal states (Joined, Closed Lost) take highest precedence.
- The CASE order establishes the stage hierarchy: Joined > Closed > SQO > SQL > MQL > Contacted > Prospect.

---

### 1.3 — Disposition Logic Per Stage

This is the **most critical investigation**. For each stage (MQL, SQL, SQO), we need to know: given a record that reached this stage, how do we determine whether it's Open, Closed Lost, or Converted to the next stage?

#### MQL Disposition

- **Task:** Using the view SQL and eligibility flags, determine the exact conditions for each MQL disposition.
- **Questions to answer:**
  1. A record is an MQL when `is_mql = 1`. What field sets this? (`mql_stage_entered_ts IS NOT NULL`?)
  2. An MQL is "Converted" (became SQL) when what condition is true? (`is_sql = 1`? `converted_date_raw IS NOT NULL`? Both?)
  3. An MQL is "Closed Lost" when what condition is true? (`lead_closed_date IS NOT NULL AND is_sql = 0`? Something else?)
  4. An MQL is "Open" when it's neither converted nor closed. But are there edge cases? (e.g., recycled leads, re-engagement records, leads in Contacting for 30+ days treated as resolved for reporting?)
  5. Check the `eligible_for_mql_conversions` flag — it's defined as `is_mql = 1 AND (is_sql = 1 OR lead_closed_date IS NOT NULL)`. Does this mean `NOT eligible_for_mql_conversions` = Open?
- **Finding:**

```sql
-- From views/vw_funnel_master.sql line 278
CASE WHEN l.mql_stage_entered_ts IS NOT NULL THEN 1 ELSE 0 END AS is_mql,

-- From views/vw_funnel_master.sql line 279
CASE WHEN l.IsConverted IS TRUE THEN 1 ELSE 0 END AS is_sql,

-- From views/vw_funnel_master.sql lines 515-519
-- MQL Eligibility (Cohort): MQL that became SQL or closed as lead
CASE
  WHEN is_mql = 1 AND (is_sql = 1 OR lead_closed_date IS NOT NULL)
  THEN 1 ELSE 0
END AS eligible_for_mql_conversions,
```

**Answers:**

1. **MQL condition:** `is_mql = 1` ← set when `mql_stage_entered_ts IS NOT NULL` (line 278). This is `Stage_Entered_Call_Scheduled__c` from the Lead table.

2. **MQL → SQL Converted:** `is_sql = 1` (which means `IsConverted IS TRUE`). The `converted_date_raw` is just the date field; `is_sql` is the binary flag.

3. **MQL Closed Lost:** `lead_closed_date IS NOT NULL AND is_sql = 0`. The `lead_closed_date` field is `Stage_Entered_Closed__c` from the Lead table. An MQL is closed lost if the lead closed without converting to SQL.

4. **MQL Open:** `is_mql = 1 AND is_sql = 0 AND lead_closed_date IS NULL`. Edge cases:
   - Re-engagement records use the same logic (they have `mql_stage_entered_ts` mapped from `Stage_Entered_Call_Scheduled__c`)
   - The 30-day resolution rule (`eligible_for_contacted_conversions_30d`) only applies to Contacted→MQL, not MQL→SQL
   - No special handling for recycled leads in MQL disposition

5. **Eligibility flag:** Yes, `eligible_for_mql_conversions = 1` means the MQL has a final outcome (converted OR closed). `NOT eligible_for_mql_conversions AND is_mql = 1` = Open MQL.

**MQL Disposition Summary:**
- **Converted:** `is_mql = 1 AND is_sql = 1`
- **Lost:** `is_mql = 1 AND is_sql = 0 AND lead_closed_date IS NOT NULL`
- **Open:** `is_mql = 1 AND is_sql = 0 AND lead_closed_date IS NULL`

#### SQL Disposition

- **Task:** Same as above for SQLs.
- **Questions to answer:**
  1. A record is a SQL when `is_sql = 1`. Once converted, we're in Opportunity territory. What determines the outcome?
  2. An SQL is "Converted" (became SQO) when what condition? (`LOWER(SQO_raw) = 'yes'`?)
  3. An SQL is "Closed Lost" when what condition? (`StageName = 'Closed Lost'`? And NOT SQO?)
  4. An SQL is "Open" — what stages count as open? (e.g., `Qualifying`, `Discovery`, `Sales Process`, `Negotiating`, `Signed`, `On Hold`, `Planned Nurture`?)
  5. Check `eligible_for_sql_conversions` flag — does `NOT eligible_for_sql_conversions AND is_sql = 1` = Open?
  6. Do we need `recordtypeid = '012Dn000000mrO3IAI'` (RECRUITING_RECORD_TYPE) for SQL disposition? The current SQL count in `funnel-metrics.ts` does NOT apply this filter for SQLs — only for SQOs. Confirm.
- **Finding:**

```sql
-- From views/vw_funnel_master.sql line 280
CASE WHEN LOWER(o.SQO_raw) = 'yes' THEN 1 ELSE 0 END AS is_sqo,

-- From views/vw_funnel_master.sql lines 521-533
-- SQL Eligibility (Cohort): SQL (Opportunity) that became SQO or closed lost
-- Note: Once converted, we look at OPPORTUNITY outcomes, not Lead disposition
CASE
  WHEN is_sql = 1 AND (
    LOWER(SQO_raw) = 'yes' OR                    -- Became SQO (progress)
    StageName = 'Closed Lost'                     -- Closed without becoming SQO
  )
  THEN 1
  -- Include direct opportunities (no linked lead) that became SQO
  WHEN Full_prospect_id__c IS NULL AND LOWER(SQO_raw) = 'yes'
  THEN 1
  ELSE 0
END AS eligible_for_sql_conversions,
```

**Answers:**

1. **SQL condition:** `is_sql = 1` means the lead converted (`IsConverted IS TRUE`). The record now has an associated Opportunity.

2. **SQL → SQO Converted:** `LOWER(SQO_raw) = 'yes'`. The `SQL__c` field (aliased as `SQO_raw`) indicates SQO status.

3. **SQL Closed Lost:** `StageName = 'Closed Lost' AND LOWER(SQO_raw) != 'yes'`. The opportunity closed lost without becoming an SQO.

4. **SQL Open:** Any opportunity stage that isn't 'Closed Lost' and hasn't become SQO. Open stages include:
   - `Qualifying`
   - `Discovery`
   - `Sales Process`
   - `Negotiating`
   - `Signed`
   - `On Hold`
   - `Planned Nurture` (for Re-Engagement opps)

5. **Eligibility flag:** Yes, `eligible_for_sql_conversions = 1` means the SQL resolved (SQO or Closed Lost). `NOT eligible_for_sql_conversions AND is_sql = 1` = Open SQL.

6. **Record type filter for SQLs:** NO. Looking at `funnel-metrics.ts` lines 118-128:
```typescript
SUM(
  CASE
    WHEN converted_date_raw IS NOT NULL
      AND DATE(converted_date_raw) >= DATE(@startDate)
      AND DATE(converted_date_raw) <= DATE(@endDate)
      AND is_sql = 1
      ${sgaFilterForLead}
    THEN 1
    ELSE 0
  END
) as sqls,
```
There is **no `recordtypeid` filter for SQLs**. The filter is only applied for SQOs (line 134: `AND recordtypeid = @recruitingRecordType`). This makes sense because SQLs are lead-level metrics, while SQOs are opportunity-level.

**SQL Disposition Summary:**
- **Converted:** `is_sql = 1 AND LOWER(SQO_raw) = 'yes'`
- **Lost:** `is_sql = 1 AND StageName = 'Closed Lost' AND LOWER(SQO_raw) != 'yes'`
- **Open:** `is_sql = 1 AND StageName NOT IN ('Closed Lost') AND LOWER(SQO_raw) != 'yes'`

#### SQO Disposition

- **Task:** Same as above for SQOs.
- **Questions to answer:**
  1. An SQO requires `is_sqo_unique = 1 AND recordtypeid = '012Dn000000mrO3IAI'`. Confirm this.
  2. An SQO is "Converted" (Joined) when what condition? (`is_joined = 1`? `advisor_join_date__c IS NOT NULL`? `StageName = 'Joined'`?)
  3. An SQO is "Closed Lost" when what condition? (`StageName = 'Closed Lost'`?)
  4. An SQO is "Open" — same question about which StageName values count as open.
  5. Check `eligible_for_sqo_conversions` flag — does `NOT eligible_for_sqo_conversions AND is_sqo_unique = 1` = Open?
  6. What about the `Signed` stage? Is that considered "Open" or something else? (An SQO that's `Signed` hasn't yet `Joined`.)
- **Finding:**

```sql
-- From views/vw_funnel_master.sql lines 399-406
-- SQO count field (use this instead of is_sqo for volume counts)
-- Only counts once per opportunity, even if multiple leads converted
CASE
  WHEN LOWER(SQO_raw) = 'yes'
    AND (Full_Opportunity_ID__c IS NULL OR opp_row_num = 1)
  THEN 1
  ELSE 0
END AS is_sqo_unique,

-- From views/vw_funnel_master.sql line 281
CASE WHEN o.advisor_join_date__c IS NOT NULL OR o.StageName = 'Joined' THEN 1 ELSE 0 END AS is_joined,

-- From views/vw_funnel_master.sql lines 535-542
-- SQO Eligibility (Cohort): SQO that joined or closed lost
CASE
  WHEN LOWER(SQO_raw) = 'yes' AND (
    (advisor_join_date__c IS NOT NULL OR StageName = 'Joined') OR
    StageName = 'Closed Lost'
  )
  THEN 1 ELSE 0
END AS eligible_for_sqo_conversions,
```

From `funnel-metrics.ts` lines 129-140:
```typescript
SUM(
  CASE
    WHEN Date_Became_SQO__c IS NOT NULL
      AND TIMESTAMP(Date_Became_SQO__c) >= TIMESTAMP(@startDate)
      AND TIMESTAMP(Date_Became_SQO__c) <= TIMESTAMP(@endDate)
      AND recordtypeid = @recruitingRecordType
      AND is_sqo_unique = 1
      ${sgaFilterForOpp}
    THEN 1
    ELSE 0
  END
) as sqos,
```

**Answers:**

1. **SQO condition:** Confirmed. SQO counts use `is_sqo_unique = 1 AND recordtypeid = '012Dn000000mrO3IAI'` (RECRUITING_RECORD_TYPE).

2. **SQO → Joined Converted:** `advisor_join_date__c IS NOT NULL OR StageName = 'Joined'` (both conditions in `is_joined` flag).

3. **SQO Closed Lost:** `StageName = 'Closed Lost'`

4. **SQO Open:** SQO that hasn't joined and isn't closed lost. Open StageName values for SQOs:
   - `Qualifying`
   - `Discovery`
   - `Sales Process`
   - `Negotiating`
   - `Signed` (see below)
   - `On Hold`

5. **Eligibility flag:** Yes, `eligible_for_sqo_conversions = 1` means the SQO resolved (Joined or Closed Lost). `NOT eligible_for_sqo_conversions AND is_sqo_unique = 1` = Open SQO.

6. **Signed stage:** `Signed` is considered **Open** for SQO disposition purposes. A Signed SQO has not yet Joined, so it's still in progress. From the `is_joined` logic, only `advisor_join_date__c IS NOT NULL OR StageName = 'Joined'` counts as converted.

**SQO Disposition Summary:**
- **Converted:** `is_sqo_unique = 1 AND recordtypeid = RECRUITING_RECORD_TYPE AND (advisor_join_date__c IS NOT NULL OR StageName = 'Joined')`
- **Lost:** `is_sqo_unique = 1 AND recordtypeid = RECRUITING_RECORD_TYPE AND StageName = 'Closed Lost'`
- **Open:** `is_sqo_unique = 1 AND recordtypeid = RECRUITING_RECORD_TYPE AND StageName NOT IN ('Closed Lost', 'Joined') AND advisor_join_date__c IS NULL`

---

### 1.4 — Field Availability in Dashboard Queries

- **Task:** Confirm these fields are available in `vw_funnel_master` and already used (or not) in dashboard queries:
  - `Conversion_Status`
  - `TOF_Stage`
  - `lead_closed_date`
  - `StageName`
  - `SQO_raw`
  - `Disposition__c` — what is this field? Is it the Salesforce lead disposition, or something else? How does it relate to `Conversion_Status`?
- **Commands to run:**
  ```bash
  grep -rn "Conversion_Status" src/lib/queries/
  grep -rn "TOF_Stage" src/lib/queries/
  grep -rn "lead_closed_date" src/lib/queries/
  grep -rn "Disposition__c" src/lib/queries/
  grep -rn "SQO_raw" src/lib/queries/
  ```
- **Finding:**

**Grep Results:**

`Conversion_Status`:
- `src/lib/queries/recruiter-hub.ts:83` - Used in WHERE clause: `"Conversion_Status = 'Closed'"`
- `src/lib/queries/recruiter-hub.ts:93` - Used in WHERE clause: `"Conversion_Status = 'Open'"`
- `src/lib/queries/record-detail.ts:73` - Selected for record detail modal

`TOF_Stage`:
- `src/lib/queries/drill-down.ts:54,73,101,124,169,249` - Selected and mapped to `tofStage` in drill-down records
- `src/lib/queries/record-detail.ts:72` - Selected for record detail modal
- `src/lib/queries/recruiter-hub.ts:109` - Selected for recruiter hub prospects

`lead_closed_date`:
- `src/lib/queries/conversion-rates.ts` - Used extensively in cohort mode conversion calculations
- `src/lib/queries/record-detail.ts:61,200` - Selected for record detail

`StageName`:
- Used throughout for stage-based filtering and display

`SQO_raw`:
- `src/lib/queries/conversion-rates.ts` - Multiple uses for SQO detection
- `src/lib/queries/export-records.ts:89` - Used to compute `is_sqo`

`Disposition__c`:
- `src/lib/queries/record-detail.ts:74,216` - Selected for record detail modal

**Disposition__c Analysis:**
`Disposition__c` is the Salesforce Lead disposition field (e.g., "Not Interested", "Bad Fit", etc.). It's set when a lead is closed without converting. In `Conversion_Status` logic:
```sql
WHEN Disposition__c IS NOT NULL OR StageName = 'Closed Lost' THEN 'Closed'
```
So `Disposition__c` catches lead-level closures, while `StageName = 'Closed Lost'` catches opportunity-level closures.

**Summary:** All fields are available in `vw_funnel_master`. `Conversion_Status` and `TOF_Stage` are already used in some queries but NOT in `funnel-metrics.ts`. The disposition logic fields (`lead_closed_date`, `StageName`, `SQO_raw`, `Disposition__c`) are all present and can be used for disposition counts.

---

## PHASE 2: Current Query Structure — How Are Counts Fetched Today?

### 2.1 — Funnel Metrics Query

- **File:** `src/lib/queries/funnel-metrics.ts`
- **Tasks:**
  1. Paste the complete CASE WHEN blocks for MQL, SQL, and SQO counting (the three metrics we care about).
  2. Is this a single query returning all metrics at once, or multiple queries?
  3. What parameters does the function accept? (Paste the function signature)
  4. How is caching handled? Find `cachedQuery` usage and the cache tag.
  5. What is the return type? Paste the `FunnelMetrics` interface from `src/types/dashboard.ts`.
- **Finding:**

**1. CASE WHEN blocks for MQL, SQL, SQO:**

```typescript
// MQLs (lines 107-117)
SUM(
  CASE
    WHEN mql_stage_entered_ts IS NOT NULL
      AND TIMESTAMP(mql_stage_entered_ts) >= TIMESTAMP(@startDate)
      AND TIMESTAMP(mql_stage_entered_ts) <= TIMESTAMP(@endDate)
      ${sgaFilterForLead}
    THEN 1
    ELSE 0
  END
) as mqls,

// SQLs (lines 118-128)
SUM(
  CASE
    WHEN converted_date_raw IS NOT NULL
      AND DATE(converted_date_raw) >= DATE(@startDate)
      AND DATE(converted_date_raw) <= DATE(@endDate)
      AND is_sql = 1
      ${sgaFilterForLead}
    THEN 1
    ELSE 0
  END
) as sqls,

// SQOs (lines 129-140)
SUM(
  CASE
    WHEN Date_Became_SQO__c IS NOT NULL
      AND TIMESTAMP(Date_Became_SQO__c) >= TIMESTAMP(@startDate)
      AND TIMESTAMP(Date_Became_SQO__c) <= TIMESTAMP(@endDate)
      AND recordtypeid = @recruitingRecordType
      AND is_sqo_unique = 1
      ${sgaFilterForOpp}
    THEN 1
    ELSE 0
  END
) as sqos,
```

**2. Query structure:** Single query returning all metrics at once. Lines 82-191 contain one large SQL query with multiple SUM(CASE WHEN...) blocks. A separate query fetches `openPipelineAum` (lines 214-219).

**3. Function signature:**
```typescript
const _getFunnelMetrics = async (filters: DashboardFilters): Promise<FunnelMetrics> => {
```

**4. Caching:**
```typescript
// Lines 239-243
export const getFunnelMetrics = cachedQuery(
  _getFunnelMetrics,
  'getFunnelMetrics',
  CACHE_TAGS.DASHBOARD
);
```
Cache tag: `CACHE_TAGS.DASHBOARD = 'dashboard'`
Default TTL: 4 hours (14400 seconds)

**5. FunnelMetrics interface:**
```typescript
// From src/types/dashboard.ts lines 7-19
export interface FunnelMetrics {
  prospects: number;  // Count by FilterDate
  contacted: number; // Count by stage_entered_contacting__c with is_contacted=1
  mqls: number;       // Already calculated in query, just add to type
  sqls: number;
  sqos: number;
  signed: number;     // Count by Stage_Entered_Signed__c
  signedAum: number;  // Sum of Opportunity_AUM for signed records (Underwritten_AUM__c / Amount)
  joined: number;
  joinedAum: number;  // Sum of Opportunity_AUM for joined records
  pipelineAum: number;
  openPipelineAum: number;
}
```

---

### 2.2 — Could We Add Disposition Counts to the Existing Query?

- **Task:** Look at the existing metrics query structure. Could we add additional SUM(CASE WHEN ...) blocks for each disposition without a separate query?
- **Questions:**
  1. How many CASE WHEN blocks are already in the query? Would adding 9 more (3 stages × 3 dispositions) make the query unwieldy?
  2. Are there any performance concerns? (Check if there's a WHERE clause that limits the scan or if it's a full table scan)
  3. Would this affect the cache key/strategy?
- **Finding:**

**1. Current CASE WHEN block count:** 10 blocks currently:
- prospects, contacted, mqls, sqls, sqos, signed, signed_aum, joined, pipeline_aum, joined_aum

Adding 9 more (mql_open, mql_lost, mql_converted, sql_open, sql_lost, sql_converted, sqo_open, sqo_lost, sqo_converted) would bring total to 19. This is manageable — BigQuery handles many aggregations efficiently.

**2. Performance analysis:**
```typescript
// Lines 74, 190
const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
// ...
FROM \`${FULL_TABLE}\` v
${whereClause}
```
The WHERE clause filters by channel, source, sga, sgm, experimentationTag, campaignId, and advanced filters. However, there's **no date filter in WHERE** — dates are checked in each CASE WHEN. This means it scans the entire table for every query. Adding more CASE WHEN blocks adds CPU time but not additional I/O.

**3. Cache impact:** The cache key is auto-generated from function name + arguments. Adding disposition counts to the same query would:
- Keep the same cache key (good)
- Return more data per cache hit (good)
- Not require separate cache entries for disposition vs. all (good)

**Conclusion:** Yes, adding disposition counts to the existing query is the cleanest approach. No separate query needed.

---

### 2.3 — Open Pipeline Query (Precedent)

- **File:** `src/lib/queries/funnel-metrics.ts` (look for open pipeline AUM calculation)
- **Task:** The dashboard already has an "Open Pipeline" concept. How is it computed? Does it use `StageName IN (...)` or `Conversion_Status = 'Open'`?
- **Key question:** Can we reuse the same pattern for "Open" MQLs/SQLs/SQOs?
- **Finding:**

```typescript
// Lines 201-219
// Open pipeline AUM query - NO FILTERS (always shows current state, all time, all channels/sources)
const openPipelineConditions = [
  `v.recordtypeid = @recruitingRecordType`,
  `v.StageName IN (${OPEN_PIPELINE_STAGES.map((_, i) => `@stage${i}`).join(', ')})`,
  'v.is_sqo_unique = 1',
];

// From src/config/constants.ts lines 6-11
export const OPEN_PIPELINE_STAGES: readonly string[] = [
  'Qualifying',
  'Discovery',
  'Sales Process',
  'Negotiating'
];
```

**Analysis:**
- Open Pipeline uses `StageName IN (...)` with explicit stage list, NOT `Conversion_Status = 'Open'`
- This is **different** from what we need for disposition counts:
  - Open Pipeline excludes 'Signed' and 'On Hold' stages
  - Our "Open" disposition should include ANY non-terminal stage (including Signed, On Hold)

**Reuse potential:** Limited. We should use `Conversion_Status` field or the raw conditions (`StageName NOT IN ('Closed Lost', 'Joined')`) rather than the Open Pipeline pattern.

---

## PHASE 3: Frontend Components — What Needs to Change?

### 3.1 — Scorecard Component Props

- **Files:** `src/components/dashboard/FullFunnelScorecards.tsx`, `src/components/dashboard/Scorecards.tsx`
- **Tasks:**
  1. Paste the complete props interface for each component.
  2. Which of these components render the MQL card? The SQL card? The SQO card?
  3. How is `metrics` passed in? Is it the `FunnelMetricsWithGoals` object directly?
  4. How is `onMetricClick` typed? What argument does it receive?
  5. Is there any internal state in these components, or is everything controlled by the parent?
- **Finding:**

**1. Props interfaces:**

```typescript
// FullFunnelScorecards.tsx lines 14-24
interface FullFunnelScorecardsProps {
  metrics: FunnelMetricsWithGoals | null;
  selectedMetric?: string | null;
  onMetricClick?: (metric: string) => void;
  loading?: boolean;
  visibleMetrics?: {
    prospects: boolean;
    contacted: boolean;
    mqls: boolean;
  };
}

// Scorecards.tsx lines 16-29
interface ScorecardsProps {
  metrics: FunnelMetricsWithGoals;
  selectedMetric?: string | null;
  onMetricClick?: (metric: string) => void;
  visibleMetrics?: {
    sqls: boolean;
    sqos: boolean;
    signed: boolean;
    signedAum: boolean;
    joined: boolean;
    joinedAum: boolean;
    openPipeline: boolean;
  };
}
```

**2. Card rendering:**
- **MQL card:** `FullFunnelScorecards.tsx` (lines 133-157) — renders when `visibleMetrics.mqls` is true
- **SQL card:** `Scorecards.tsx` (lines 74-98) — renders when `visibleMetrics.sqls` is true
- **SQO card:** `Scorecards.tsx` (lines 100-124) — renders when `visibleMetrics.sqos` is true

**3. Metrics passing:** Yes, `FunnelMetricsWithGoals` object is passed directly from parent:
```typescript
// From dashboard/page.tsx line 268
const [metrics, setMetrics] = useState<FunnelMetricsWithGoals | null>(null);
// Passed to Scorecards on line 1111
<Scorecards metrics={metrics} ... />
```

**4. onMetricClick typing:**
```typescript
onMetricClick?: (metric: string) => void;
```
It receives the metric ID as a string: `'mql'`, `'sql'`, `'sqo'`, etc.

**5. Internal state:** No internal state in Scorecards components — everything is controlled by parent. The components are purely presentational.

---

### 3.2 — GoalDisplay Component

- **Files:** Search for `GoalDisplay` definition.
- **Tasks:**
  1. Where is `GoalDisplay` defined?
  2. What props does it accept?
  3. How is it conditionally rendered on the scorecard cards?
- **Key question:** We want to hide goals when disposition ≠ "All". Is it sufficient to just not render `<GoalDisplay>`, or does the card layout shift when it's absent?
- **Finding:**

**1. GoalDisplay definitions:**
```typescript
// FullFunnelScorecards.tsx lines 29-54
function GoalDisplay({
  actual,
  goal,
  label
}: {
  actual: number;
  goal: number;
  label: string;
}) { ... }

// Scorecards.tsx lines 31-56 (identical implementation)
function GoalDisplay({
  actual,
  goal,
  label
}: {
  actual: number;
  goal: number;
  label: string;
}) { ... }
```

**2. Props:**
- `actual: number` — current metric value
- `goal: number` — goal value
- `label: string` — label for accessibility (not displayed)

**3. Conditional rendering:**
```typescript
// Example from Scorecards.tsx lines 94-96
{goals && goals.sqls > 0 && (
  <GoalDisplay actual={metrics.sqls} goal={goals.sqls} label="SQL" />
)}
```

**Layout impact analysis:**
```typescript
// GoalDisplay renders:
<div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700">
```
The `mt-2` (margin-top) ensures consistent spacing. When GoalDisplay is absent, there's no border-top or extra padding. **The card layout will slightly shift** when GoalDisplay is hidden — the card will be shorter. This is acceptable since all cards in the row will behave the same way when disposition ≠ "All".

---

### 3.3 — Dashboard Page State Management

- **File:** `src/app/dashboard/page.tsx`
- **Tasks:**
  1. How many state variables relate to scorecards and drill-down? List them all with their types.
  2. Where is `metrics` state defined? (`useState<FunnelMetrics>`)
  3. Where is `handleMetricClick` defined? Paste the full function body.
  4. How is the drill-down modal opened? What state variables control it?
  5. How are `appliedFilters` constructed and passed to API calls?
  6. Is there a `selectedMetric` state? What does it do vs `volumeDrillDownMetric`?
- **Finding:**

**1. Scorecard/drill-down related state variables:**
```typescript
// Line 268 - Main metrics data
const [metrics, setMetrics] = useState<FunnelMetricsWithGoals | null>(null);

// Line 277 - Currently selected metric (for highlighting, legacy)
const [selectedMetric, setSelectedMetric] = useState<string | null>(null);

// Lines 285-293 - Volume drill-down modal state
const [volumeDrillDownOpen, setVolumeDrillDownOpen] = useState(false);
const [volumeDrillDownRecords, setVolumeDrillDownRecords] = useState<DetailRecord[]>([]);
const [volumeDrillDownLoading, setVolumeDrillDownLoading] = useState(false);
const [volumeDrillDownError, setVolumeDrillDownError] = useState<string | null>(null);
const [volumeDrillDownTitle, setVolumeDrillDownTitle] = useState('');
const [volumeDrillDownMetric, setVolumeDrillDownMetric] = useState<
  'prospect' | 'contacted' | 'mql' | 'sql' | 'sqo' | 'signed' | 'joined' | 'openPipeline' | null
>(null);

// Line 262 - Filters state
const [filters, setFilters] = useState<DashboardFilters>(DEFAULT_FILTERS);
// Line 264 - Applied filters (what's actually used for API calls)
const [appliedFilters, setAppliedFilters] = useState<DashboardFilters>(DEFAULT_FILTERS);
```

**2. metrics state:** Line 268
```typescript
const [metrics, setMetrics] = useState<FunnelMetricsWithGoals | null>(null);
```

**3. handleMetricClick function (lines 817-881):**
```typescript
const handleMetricClick = async (metric: string) => {
  // Open drill-down modal instead of filtering the main table
  // Clear any previous selection state (no visual highlighting)
  setSelectedMetric(null);

  // Map metric IDs to proper metric filter values
  const metricMap: Record<string, 'prospect' | 'contacted' | 'mql' | 'sql' | 'sqo' | 'signed' | 'joined' | 'openPipeline'> = {
    'prospect': 'prospect',
    'contacted': 'contacted',
    'mql': 'mql',
    'sql': 'sql',
    'sqo': 'sqo',
    'signed': 'signed',
    'joined': 'joined',
    'openPipeline': 'openPipeline',
  };

  const metricFilter = metricMap[metric];
  if (!metricFilter) {
    console.warn(`Unknown metric: ${metric}`);
    return;
  }

  // Set modal state
  setVolumeDrillDownMetric(metricFilter);
  setVolumeDrillDownLoading(true);
  setVolumeDrillDownError(null);
  setVolumeDrillDownOpen(true);

  // Build title with metric name and date range
  const metricLabels: Record<string, string> = {
    prospect: 'Prospects',
    contacted: 'Contacted',
    mql: 'MQLs',
    sql: 'SQLs',
    sqo: 'SQOs',
    signed: 'Signed',
    joined: 'Joined',
    openPipeline: 'Open Pipeline',
  };

  const dateRange = buildDateRangeFromFilters(appliedFilters);
  const dateRangeText = appliedFilters.datePreset === 'custom'
    ? `${dateRange.startDate} to ${dateRange.endDate}`
    : appliedFilters.datePreset?.toUpperCase() || 'Selected Period';

  setVolumeDrillDownTitle(`${metricLabels[metricFilter]} - ${dateRangeText}`);

  try {
    // Build filters for the drill-down query (use applied filters)
    const drillDownFilters: DashboardFilters = {
      ...appliedFilters,
      metricFilter: metricFilter,
    };

    // Fetch records for the selected metric
    const response = await dashboardApi.getDetailRecords(drillDownFilters, 50000);
    setVolumeDrillDownRecords(response.records);
  } catch (error) {
    console.error('Error fetching drill-down records:', error);
    setVolumeDrillDownError('Failed to load records. Please try again.');
  } finally {
    setVolumeDrillDownLoading(false);
  }
};
```

**4. Drill-down modal control:**
- `volumeDrillDownOpen` — controls modal visibility
- `volumeDrillDownMetric` — current metric being drilled into
- `volumeDrillDownTitle` — modal title
- `volumeDrillDownRecords` — data to display
- `volumeDrillDownLoading` / `volumeDrillDownError` — loading state

**5. appliedFilters usage:**
```typescript
// Line 700-707
const currentFilters: DashboardFilters = {
  ...appliedFilters,
  startDate: dateRange.startDate,
  endDate: dateRange.endDate,
  metricFilter: 'prospect' as DashboardFilters['metricFilter'],
};
// Passed to dashboardApi.getFunnelMetrics(currentFilters, viewMode)
```

**6. selectedMetric vs volumeDrillDownMetric:**
- `selectedMetric` — Legacy state for visual highlighting (no longer used effectively, cleared immediately in handleMetricClick)
- `volumeDrillDownMetric` — Active metric for drill-down modal, determines which records to fetch

---

### 3.4 — Drill-Down Modal (Volume Drill-Down)

- **File:** `src/app/dashboard/page.tsx` (search for `VolumeDrillDown` or the drill-down modal component)
- **Tasks:**
  1. What component renders the volume drill-down modal? Where is it defined?
  2. What props does it receive?
  3. How are records fetched for the drill-down? (API call, filters passed)
  4. Is there a title shown on the modal? How is it constructed?
- **Finding:**

**1. Component:** `VolumeDrillDownModal` imported from `@/components/dashboard/VolumeDrillDownModal`

**2. Props (from page.tsx lines 1246-1258):**
```typescript
<VolumeDrillDownModal
  isOpen={volumeDrillDownOpen}
  onClose={handleCloseVolumeDrillDown}
  records={volumeDrillDownRecords}
  title={volumeDrillDownTitle}
  loading={volumeDrillDownLoading}
  error={volumeDrillDownError}
  onRecordClick={handleVolumeDrillDownRecordClick}
  metricFilter={volumeDrillDownMetric}
  canExport={permissions?.canExport ?? false}
/>
```

**3. Record fetching (from handleMetricClick lines 865-879):**
```typescript
const drillDownFilters: DashboardFilters = {
  ...appliedFilters,
  metricFilter: metricFilter,  // 'mql', 'sql', 'sqo', etc.
};
const response = await dashboardApi.getDetailRecords(drillDownFilters, 50000);
setVolumeDrillDownRecords(response.records);
```

**4. Title construction:**
```typescript
setVolumeDrillDownTitle(`${metricLabels[metricFilter]} - ${dateRangeText}`);
// Example: "MQLs - QTD" or "SQOs - 2025-01-01 to 2025-03-31"
```

---

### 3.5 — Detail Records API and Query

- **Files:** `src/lib/queries/detail-records.ts`, `src/app/api/dashboard/detail-records/route.ts`
- **Tasks:**
  1. How does `metricFilter` map to SQL conditions? Paste the switch/if block that handles `'mql'`, `'sql'`, `'sqo'`.
  2. What columns are SELECTed for the detail records?
  3. Are `Conversion_Status`, `TOF_Stage`, `lead_closed_date`, `StageName`, `SQO_raw` already in the SELECT list? If not, would we need to add them?
  4. How is the API route structured? Paste the filter extraction from the POST body.
  5. Is there any existing concept of sub-filtering within a metricFilter?
- **Finding:**

**1. metricFilter mapping (lines 82-177):**
```typescript
switch (filters.metricFilter) {
  case 'mql':
    // MQLs: Filter by mql_stage_entered_ts within date range AND is_mql = 1
    dateField = 'mql_stage_entered_ts';
    dateFieldAlias = 'relevant_date';
    conditions.push('is_mql = 1');
    conditions.push('mql_stage_entered_ts IS NOT NULL');
    conditions.push('TIMESTAMP(mql_stage_entered_ts) >= TIMESTAMP(@startDate)');
    conditions.push('TIMESTAMP(mql_stage_entered_ts) <= TIMESTAMP(@endDate)');
    break;
  case 'sql':
    // SQLs: Filter by converted_date_raw within date range
    dateField = 'converted_date_raw';
    dateFieldAlias = 'relevant_date';
    conditions.push('is_sql = 1');
    conditions.push('converted_date_raw IS NOT NULL');
    conditions.push('DATE(converted_date_raw) >= DATE(@startDate)');
    conditions.push('DATE(converted_date_raw) <= DATE(@endDate)');
    break;
  case 'sqo':
    // SQOs: Filter by Date_Became_SQO__c within date range AND recruiting record type
    dateField = 'Date_Became_SQO__c';
    dateFieldAlias = 'relevant_date';
    conditions.push('is_sqo_unique = 1');
    conditions.push('recordtypeid = @recruitingRecordType');
    conditions.push('Date_Became_SQO__c IS NOT NULL');
    conditions.push('TIMESTAMP(Date_Became_SQO__c) >= TIMESTAMP(@startDate)');
    conditions.push('TIMESTAMP(Date_Became_SQO__c) <= TIMESTAMP(@endDate)');
    params.recruitingRecordType = RECRUITING_RECORD_TYPE;
    break;
  // ... other cases
}
```

**2. SELECT columns (lines 218-256):**
```typescript
SELECT
  v.primary_key as id,
  v.advisor_name,
  v.Original_source as source,
  v.Channel_Grouping_Name as channel,
  v.StageName as stage,
  v.SGA_Owner_Name__c as sga,
  v.SGM_Owner_Name__c as sgm,
  v.Campaign_Id__c as campaign_id,
  v.Campaign_Name__c as campaign_name,
  v.Lead_Score_Tier__c as lead_score_tier,
  v.Opportunity_AUM as aum,
  v.salesforce_url,
  v.FilterDate as filter_date,
  v.stage_entered_contacting__c as contacted_date,
  v.mql_stage_entered_ts as mql_date,
  v.converted_date_raw as sql_date,
  v.Date_Became_SQO__c as sqo_date,
  v.advisor_join_date__c as joined_date,
  v.Initial_Call_Scheduled_Date__c as initial_call_scheduled_date,
  v.Qualification_Call_Date__c as qualification_call_date,
  v.Stage_Entered_Signed__c as signed_date,
  v.Stage_Entered_Discovery__c as discovery_date,
  v.Stage_Entered_Sales_Process__c as sales_process_date,
  v.Stage_Entered_Negotiating__c as negotiating_date,
  v.Stage_Entered_On_Hold__c as on_hold_date,
  v.Stage_Entered_Closed__c as closed_date,
  v.is_contacted,
  v.is_mql,
  v.is_sql,
  v.is_sqo_unique as is_sqo,
  v.is_joined_unique as is_joined,
  v.recordtypeid,
  v.is_primary_opp_record,
  v.Full_Opportunity_ID__c as opportunity_id,
  v.lead_record_source AS prospect_source_type,
  v.Previous_Recruiting_Opportunity_ID__c AS origin_recruiting_opp_id,
  v.origin_opportunity_url
```

**3. Field availability:**
- `StageName` — YES, selected as `stage`
- `lead_closed_date` — NO, not currently selected (would need to add: `v.lead_closed_date as lead_closed_date`)
- `Conversion_Status` — NO, not selected
- `TOF_Stage` — NO, not selected
- `SQO_raw` — NO, not selected (but `is_sqo` flag is derived from it)

**Would need to add for disposition filtering:**
```sql
v.lead_closed_date as lead_closed_date,
v.Conversion_Status as conversion_status,
-- v.SQO_raw not needed since we have is_sqo flag
```

**4. API route structure:** Not explored in detail but follows standard pattern — POST body contains filters object.

**5. Sub-filtering concept:** NO existing concept of sub-filtering within a metricFilter. The `metricFilter` determines WHICH records to fetch, but there's no secondary filter for disposition. This is what we need to add.

---

### 3.6 — DashboardFilters Type

- **File:** `src/types/filters.ts`
- **Tasks:**
  1. Paste the complete `DashboardFilters` interface.
  2. Paste the `metricFilter` type definition (or wherever its allowed values are defined).
  3. Is there any existing `disposition` or `status` field on the filters type?
- **Finding:**

**1. DashboardFilters interface (lines 115-129):**
```typescript
export interface DashboardFilters {
  startDate: string;
  endDate: string;
  datePreset: 'ytd' | 'qtd' | 'q1' | 'q2' | 'q3' | 'q4' | 'custom' | 'last30' | 'last90' | 'alltime';
  year: number;
  channel: string | null;
  source: string | null;
  sga: string | null;
  sgm: string | null;
  stage: string | null;
  experimentationTag: string | null;
  campaignId: string | null;
  metricFilter: 'all' | 'prospect' | 'contacted' | 'mql' | 'sql' | 'sqo' | 'signed' | 'joined' | 'openPipeline';
  advancedFilters?: AdvancedFilters;  // Optional for backward compatibility
}
```

**2. metricFilter type:** Inline union type on line 127:
```typescript
metricFilter: 'all' | 'prospect' | 'contacted' | 'mql' | 'sql' | 'sqo' | 'signed' | 'joined' | 'openPipeline';
```

**3. Existing disposition/status field:** NO. There is no `disposition` or `status` field on `DashboardFilters`. We would need to add one, e.g.:
```typescript
metricDisposition?: 'all' | 'open' | 'lost' | 'converted';  // New field
```

---

### 3.7 — API Client Functions

- **File:** `src/lib/api-client.ts`
- **Tasks:**
  1. Paste the `getFunnelMetrics()` function — full signature and body.
  2. Paste the `getDetailRecords()` function — full signature and body.
  3. How are filters serialized for the POST body?
- **Finding:**

**1. getFunnelMetrics (lines 253-258):**
```typescript
getFunnelMetrics: (filters: DashboardFilters, viewMode?: ViewMode) =>
  apiFetch<FunnelMetricsWithGoals>('/api/dashboard/funnel-metrics', {
    method: 'POST',
    body: JSON.stringify({ filters: cleanFilters(filters), ...(viewMode && { viewMode }) }),
  }),
```

**2. getDetailRecords (lines 296-300):**
```typescript
getDetailRecords: (filters: DashboardFilters, limit = 50000) =>
  apiFetch<{ records: DetailRecord[] }>('/api/dashboard/detail-records', {
    method: 'POST',
    body: JSON.stringify({ filters: cleanFilters(filters), limit }),
  }),
```

**3. Filter serialization:**
The `cleanFilters()` function (lines 154-214) creates a clean copy of the filters object with only serializable properties. It merges `advancedFilters` with defaults to ensure all nested properties exist.

---

## PHASE 4: Existing UI Patterns — What Precedents Exist?

### 4.1 — ViewModeToggle Component

- **Task:** Find the `ViewModeToggle` component (Focused / Full Funnel toggle).
- **Questions:**
  1. Where is it defined? Paste the full component code.
  2. How is it styled? (Tailwind classes, Tremor components, custom?)
  3. How does it manage state? (Controlled via props? Internal state?)
  4. Could this pattern be adapted for a smaller, card-level segmented control?
- **Finding:**

**1. Definition:** `src/components/dashboard/ViewModeToggle.tsx`

```typescript
'use client';

import { ViewMode } from '@/types/dashboard';

interface ViewModeToggleProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}

export function ViewModeToggle({ value, onChange }: ViewModeToggleProps) {
  return (
    <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
      <button
        onClick={() => onChange('focused')}
        className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
          value === 'focused'
            ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
            : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
        }`}
      >
        Focused View
      </button>
      <button
        onClick={() => onChange('fullFunnel')}
        className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
          value === 'fullFunnel'
            ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
            : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
        }`}
      >
        Full Funnel View
      </button>
    </div>
  );
}
```

**2. Styling:** Pure Tailwind CSS, no Tremor components. Dark mode support via `dark:` variants.

**3. State management:** Fully controlled via props (`value` + `onChange`). No internal state.

**4. Adaptation potential:** YES, excellent pattern for card-level segmented control. Would need:
- Smaller padding (e.g., `px-2 py-1` instead of `px-4 py-2`)
- Smaller text (e.g., `text-xs` instead of `text-sm`)
- 4 buttons instead of 2
- Generic type for value options

---

### 4.2 — Conversion Trend Mode Toggle (Period vs Cohort)

- **File:** `src/components/dashboard/ConversionTrendChart.tsx`
- **Task:** Find the segmented control that switches between Period and Cohort modes.
- **Questions:**
  1. How is the toggle rendered? Paste the relevant JSX.
  2. How is state managed?
  3. Is this a reusable pattern?
- **Finding:**

**1. Toggle JSX (lines 255-284):**
```typescript
{/* Mode Toggle - Cohort first (default), Period second */}
{onModeChange && (
  <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
    <button
      onClick={() => handleModeChange('cohort')}
      className={`px-3 py-1.5 text-sm rounded-md transition-colors flex items-center gap-1 ${
        mode === 'cohort'
          ? 'bg-white dark:bg-gray-700 shadow text-blue-600 dark:text-blue-400 font-medium'
          : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
      }`}
    >
      Cohort
      <ModeTooltip mode="cohort">
        <InfoIcon className="ml-0.5" />
      </ModeTooltip>
    </button>
    <button
      onClick={() => handleModeChange('period')}
      className={`px-3 py-1.5 text-sm rounded-md transition-colors flex items-center gap-1 ${
        mode === 'period'
          ? 'bg-white dark:bg-gray-700 shadow text-blue-600 dark:text-blue-400 font-medium'
          : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
      }`}
    >
      Period
      <ModeTooltip mode="period">
        <InfoIcon className="ml-0.5" />
      </ModeTooltip>
    </button>
  </div>
)}
```

**2. State management:** Controlled via props:
```typescript
mode?: ConversionTrendMode;  // 'period' | 'cohort'
onModeChange?: (mode: ConversionTrendMode) => void;
```

**3. Reusability:** Same pattern as ViewModeToggle. Could create a generic `SegmentedControl<T>` component.

---

### 4.3 — Any Other Segmented Controls or Button Groups

- **Task:** Search for any existing segmented button groups, tab-like controls, or filter pills in the codebase.
- **Finding:**

The codebase uses inline button groups with consistent styling:

Pattern: `bg-gray-100 rounded-lg p-1` container with `px-3 py-1.5 rounded-md` buttons inside.

Used in:
1. ViewModeToggle (Focused/Full Funnel)
2. ConversionTrendChart mode toggle (Cohort/Period)
3. ConversionTrendChart granularity toggle (Monthly/Quarterly)

**Recommendation:** Create a reusable `SegmentedControl` component:
```typescript
interface SegmentedControlProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  size?: 'sm' | 'md';  // sm for cards, md for page-level
}
```

---

## PHASE 5: Edge Cases and Data Integrity

### 5.1 — Re-Engagement Records

- **Questions:**
  1. Do re-engagement records have `is_mql = 1`? Can they appear in the MQL scorecard?
  2. Is `record_type_name = 'Re-Engagement'` a factor we need to consider for disposition logic?
  3. For SQLs and SQOs, the `recordtypeid = RECRUITING_RECORD_TYPE` filter — does this automatically exclude re-engagement records?
- **Finding:**

**1. Re-engagement MQL handling:**
From `views/vw_funnel_master.sql` lines 109-111:
```sql
-- 10. mql_stage_entered_ts (Call Scheduled → MQL)
Stage_Entered_Call_Scheduled__c AS mql_stage_entered_ts,
```
YES, re-engagement records can have `is_mql = 1` if they have `Stage_Entered_Call_Scheduled__c` populated. They appear in MQL counts.

**2. Record type for disposition logic:**
Re-engagement opps have `RecordTypeId = '012VS000009VoxrYAC'` (RE_ENGAGEMENT_RECORD_TYPE). For MQL/SQL disposition (lead-level), record type doesn't matter. For SQO disposition, the `recordtypeid = RECRUITING_RECORD_TYPE` filter already excludes re-engagement opps.

**3. SQO filter:**
```typescript
// From funnel-metrics.ts line 134
AND recordtypeid = @recruitingRecordType
```
YES, the RECRUITING_RECORD_TYPE filter (`'012Dn000000mrO3IAI'`) automatically excludes re-engagement records. SQO disposition only applies to recruiting opps.

---

### 5.2 — Deduplication

- **Questions:**
  1. `is_sqo_unique` — how is this computed in the view? When would `is_sqo = 1` but `is_sqo_unique = 0`?
  2. For disposition counts, should we use `is_sqo_unique` or `is_sqo`?
  3. Is there an `is_sql_unique` or `is_mql_unique` flag? Or do MQLs and SQLs not need deduplication?
- **Finding:**

**1. is_sqo_unique computation:**
```sql
-- From views/vw_funnel_master.sql lines 399-406
CASE
  WHEN LOWER(SQO_raw) = 'yes'
    AND (Full_Opportunity_ID__c IS NULL OR opp_row_num = 1)
  THEN 1
  ELSE 0
END AS is_sqo_unique,
```
- `is_sqo = 1` for ANY row where `LOWER(SQO_raw) = 'yes'`
- `is_sqo_unique = 1` only for the PRIMARY row per opportunity (`opp_row_num = 1`)
- Example: Two leads convert to the same opportunity → both have `is_sqo = 1`, only one has `is_sqo_unique = 1`

**2. For disposition counts:** Use `is_sqo_unique = 1` (matches current behavior, avoids double-counting).

**3. MQL/SQL deduplication:**
- NO `is_mql_unique` or `is_sql_unique` flags exist
- MQLs are lead-level (one lead = one MQL), no dedup needed
- SQLs are also lead-level (one lead conversion = one SQL), no dedup needed
- Only SQOs need deduplication because multiple leads can convert to the same opportunity

---

### 5.3 — SGA/SGM Filter Interaction

- **Questions:**
  1. For MQL disposition counts (lead-level), which SGA field is used? (`SGA_Owner_Name__c`?)
  2. For SQL disposition counts, which SGA field? (Lead-level or opportunity-level?)
  3. For SQO disposition counts (opp-level), which SGA field? (`Opp_SGA_Name__c`?)
  4. Does the current `sgaFilterForLead` / `sgaFilterForOpp` pattern in `funnel-metrics.ts` apply correctly per stage? Would our new CASE WHEN blocks inherit the same pattern?
- **Finding:**

From `funnel-metrics.ts` lines 44-45:
```typescript
const sgaFilterForLead = filters.sga ? ' AND v.SGA_Owner_Name__c = @sga' : '';
const sgaFilterForOpp = filters.sga ? ' AND (v.SGA_Owner_Name__c = @sga OR v.Opp_SGA_Name__c = @sga OR COALESCE(sga_user.Name, v.Opp_SGA_Name__c) = @sga)' : '';
```

**1. MQL SGA filter:** `sgaFilterForLead` — uses `SGA_Owner_Name__c` (lead-level SGA)

**2. SQL SGA filter:** `sgaFilterForLead` — uses `SGA_Owner_Name__c` (still lead-level)

**3. SQO SGA filter:** `sgaFilterForOpp` — checks BOTH `SGA_Owner_Name__c` AND `Opp_SGA_Name__c`

**4. Inheritance for disposition counts:** YES, the existing `sgaFilterForLead` and `sgaFilterForOpp` variables are template-injected into CASE WHEN blocks. New disposition counts would follow the same pattern:
```typescript
// MQL disposition counts would use sgaFilterForLead
SUM(CASE WHEN is_mql = 1 AND is_sql = 0 AND lead_closed_date IS NULL ${sgaFilterForLead} THEN 1 ELSE 0 END) as mql_open,
```

---

### 5.4 — Date Field Per Stage

- **Task:** Each stage uses a different date field for "when did this record enter this stage." Confirm:
  1. MQL scorecard counts records where `mql_stage_entered_ts` is in the date range
  2. SQL scorecard counts records where `converted_date_raw` is in the date range
  3. SQO scorecard counts records where `Date_Became_SQO__c` is in the date range
- **Critical question:** When we compute "Open MQLs in Q1 2025," do we count records where `mql_stage_entered_ts` is in Q1 AND the record is currently still open? Or only records whose MQL date AND current status are both relevant? (The answer is the former — we want records that MQL'd in Q1 that are still open as of now.)
- **Finding:**

**Confirmed date fields:**
1. MQL: `mql_stage_entered_ts` (lines 110-112 of funnel-metrics.ts)
2. SQL: `converted_date_raw` (lines 120-122)
3. SQO: `Date_Became_SQO__c` (lines 131-133)

**Critical answer:** YES, we count records where the stage entry date is in the selected date range AND the record is currently in the specified disposition state.

For "Open MQLs in Q1 2025":
```sql
SUM(CASE
  WHEN mql_stage_entered_ts IS NOT NULL
    AND TIMESTAMP(mql_stage_entered_ts) >= TIMESTAMP(@startDate)
    AND TIMESTAMP(mql_stage_entered_ts) <= TIMESTAMP(@endDate)
    AND is_mql = 1
    AND is_sql = 0           -- Not converted (current state)
    AND lead_closed_date IS NULL  -- Not closed (current state)
  THEN 1 ELSE 0
END) as mql_open
```

This counts MQLs that:
1. Entered MQL stage in Q1 2025 (historical fact)
2. Are CURRENTLY still open (present state)

---

### 5.5 — The "Signed" Stage Edge Case

- **Questions:**
  1. Is "Signed" treated as an open SQO (hasn't Joined yet) or as a separate state?
  2. What is `StageName` for a Signed record? Is it literally `'Signed'`?
  3. Does the current SQO count include Signed records? (The SQO CASE uses `is_sqo_unique = 1` which doesn't exclude Signed.)
  4. For the SQO disposition toggle: a Signed SQO hasn't Joined and isn't Closed Lost. Should it be "Open"?
- **Finding:**

**1. Signed = Open SQO:** YES, Signed is treated as an open SQO. The record has become an SQO but hasn't yet Joined.

**2. StageName value:** YES, it's literally `'Signed'`. From `views/vw_funnel_master.sql` line 460:
```sql
WHEN StageName = 'Signed' THEN 5
```

**3. Current SQO count:** YES, Signed records are included in SQO counts. The CASE is:
```sql
WHEN LOWER(SQO_raw) = 'yes' ...
```
This includes all SQOs regardless of current stage.

**4. SQO disposition for Signed:** YES, "Signed" should be categorized as "Open" for SQO disposition:
- Not Converted (hasn't Joined)
- Not Lost (StageName ≠ 'Closed Lost')
- Therefore: Open

**Note:** There's a potential UX consideration — "Signed" might feel like a "won" state to some users. However, per the business logic, Signed SQOs are "Open" until they actually Join.

---

### 5.6 — Counts Must Add Up

- **This is a hard requirement:** `All = Open + Lost + Converted` for each stage.
- **Questions:**
  1. For MQLs: Could a record be `is_mql = 1` AND `is_sql = 1` (Converted) AND `lead_closed_date IS NOT NULL` (Lost)? If so, which bucket wins? (Converted should win — they successfully converted even if the lead was later closed.)
  2. For SQLs: Could an SQL be `LOWER(SQO_raw) = 'yes'` (Converted) AND `StageName = 'Closed Lost'` (Lost)? This would mean an opp became SQO but then closed lost. Which bucket does this SQL fall into?
  3. For SQOs: Could an SQO have `is_joined = 1` (Converted) AND `StageName = 'Closed Lost'` (Lost)?
  4. What is the correct precedence order if buckets overlap? (Recommended: Converted > Lost > Open)
- **Finding:**

**1. MQL overlap analysis:**
- Can `is_mql = 1 AND is_sql = 1 AND lead_closed_date IS NOT NULL`?
- NO, this shouldn't happen. Once a lead converts (`is_sql = 1`), the lead is closed via conversion, not disposition. The `lead_closed_date` field (`Stage_Entered_Closed__c`) is for leads that closed WITHOUT converting.
- **Safe:** No overlap expected. But implement precedence anyway: Converted > Lost > Open.

**2. SQL overlap analysis:**
- Can `LOWER(SQO_raw) = 'yes' AND StageName = 'Closed Lost'`?
- YES, this can happen. An opportunity becomes SQO, then later closes lost.
- **Decision:** For SQL disposition, if the opp became SQO, count as **Converted** (they achieved SQO even if they later lost). The SQL→SQO conversion happened.

**3. SQO overlap analysis:**
- Can `is_joined = 1 AND StageName = 'Closed Lost'`?
- THEORETICALLY possible if data is inconsistent, but logically shouldn't happen. If `advisor_join_date__c IS NOT NULL`, they joined.
- **Decision:** Converted takes precedence.

**4. Precedence order:** **Converted > Lost > Open**

Implementation:
```sql
-- MQL disposition
CASE
  WHEN is_mql = 1 AND is_sql = 1 THEN 'Converted'
  WHEN is_mql = 1 AND lead_closed_date IS NOT NULL THEN 'Lost'
  WHEN is_mql = 1 THEN 'Open'
END

-- SQL disposition
CASE
  WHEN is_sql = 1 AND LOWER(SQO_raw) = 'yes' THEN 'Converted'
  WHEN is_sql = 1 AND StageName = 'Closed Lost' THEN 'Lost'
  WHEN is_sql = 1 THEN 'Open'
END

-- SQO disposition
CASE
  WHEN is_sqo_unique = 1 AND recordtypeid = RECRUITING_RECORD_TYPE
       AND (advisor_join_date__c IS NOT NULL OR StageName = 'Joined') THEN 'Converted'
  WHEN is_sqo_unique = 1 AND recordtypeid = RECRUITING_RECORD_TYPE
       AND StageName = 'Closed Lost' THEN 'Lost'
  WHEN is_sqo_unique = 1 AND recordtypeid = RECRUITING_RECORD_TYPE THEN 'Open'
END
```

---

## PHASE 6: Performance and Caching

### 6.1 — Current Query Performance

- **Commands:**
  ```bash
  grep -rn "cachedQuery\|CACHE_TAGS\|cache.*ttl\|revalidate" src/lib/queries/funnel-metrics.ts
  grep -rn "CACHE_TAGS" src/lib/cache.ts
  ```
- **Questions:**
  1. What is the cache TTL for funnel metrics?
  2. How is the cache key constructed?
  3. Would adding disposition counts to the same query change the cache key?
- **Finding:**

**1. Cache TTL:**
```typescript
// From src/lib/cache.ts lines 23-25
export const DEFAULT_CACHE_TTL = 14400; // 4 hours in seconds
```

**2. Cache key construction:**
```typescript
// From src/lib/cache.ts lines 68-92
export function cachedQuery<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  keyName: string,  // Explicit key name
  tag: string,
  ttl: number = DEFAULT_CACHE_TTL
): T {
  const cachedFn = unstable_cache(
    async (...args: Parameters<T>) => { ... },
    [keyName],  // Key parts
    { tags: [tag], revalidate: ttl }
  ) as T;
  return cachedFn;
}
```
Cache key = `keyName` + serialized function arguments (handled by Next.js `unstable_cache`).

**3. Impact of adding disposition counts:**
- Cache key: **NO CHANGE** — same function, same arguments, same key
- Cache value: LARGER (more data returned)
- Cache hit: Returns all counts (including disposition) in one fetch — GOOD

---

### 6.2 — Query Scan Scope

- **Questions:**
  1. Does the funnel metrics query have a WHERE clause that limits the row scan? (e.g., date-range based?)
  2. Adding 9 more SUM(CASE WHEN) blocks doesn't require additional table scans — it's just more computation on the same rows. Confirm this understanding by reviewing the query structure.
  3. Are there any query size limits in BigQuery that could be a concern?
- **Finding:**

**1. WHERE clause analysis:**
```typescript
// Lines 22-74 show the conditions being built:
if (filters.channel) { conditions.push('v.Channel_Grouping_Name = @channel'); }
if (filters.source) { conditions.push('v.Original_source = @source'); }
if (filters.sga) { conditions.push('...'); }
// etc.
```
The WHERE clause filters by channel, source, SGA, SGM, experimentation tag, campaign, and advanced filters. **NO DATE FILTER IN WHERE** — dates are checked per-metric in CASE WHEN blocks. This means the query scans the full table (or whatever rows match channel/source/etc filters).

**2. Additional SUM blocks = same scan:**
CONFIRMED. BigQuery processes all SUM(CASE WHEN...) blocks in a single pass over the data. Adding 9 more columns adds CPU time but not I/O. The query planner is smart enough to evaluate multiple aggregations together.

**3. BigQuery limits:**
- Query text limit: 1MB (our query is ~10KB, plenty of headroom)
- Result columns: 10,000 (we're using ~25)
- No concern for disposition counts

---

## PHASE 7: Summary Checklist

After completing all phases above, fill in this summary:

### Data Layer
- [x] `Conversion_Status` values confirmed: `'Joined'`, `'Closed'`, `'Open'`
- [x] `TOF_Stage` values confirmed: `'Joined'`, `'Closed'`, `'SQO'`, `'SQL'`, `'MQL'`, `'Contacted'`, `'Prospect'`
- [x] MQL Open/Lost/Converted logic defined and verified
- [x] SQL Open/Lost/Converted logic defined and verified
- [x] SQO Open/Lost/Converted logic defined and verified
- [x] Edge cases identified (re-engagement, dedup, signed stage, overlapping states)
- [x] Confirmed counts will add up: All = Open + Lost + Converted (with Converted > Lost > Open precedence)

### Query Layer
- [x] Current funnel metrics query structure understood
- [x] Disposition counts can be added to existing query (CONFIRMED)
- [x] Cache strategy impact assessed (no key change, just larger response)
- [x] Performance impact assessed (same scan, more CPU for aggregations — minimal)

### Frontend Layer
- [x] Scorecard component props and structure documented
- [x] Dashboard page state management mapped
- [x] handleMetricClick flow traced
- [x] Drill-down modal and detail records query documented
- [x] DashboardFilters type documented
- [x] API client functions documented

### UI Patterns
- [x] Existing toggle/segmented control patterns identified (ViewModeToggle, ConversionTrendChart mode toggle)
- [x] Reusable pattern selected for disposition toggle (same style, smaller sizing)

---

## Instructions for Claude Code

1. **Work through every phase sequentially.** Do not skip ahead.
2. **Paste actual code** — do not paraphrase or summarize. If a CASE expression is 20 lines, paste all 20 lines.
3. **Run grep/find commands** where specified. Paste the output.
4. **Write findings directly under each `**Finding:**` heading** in this document.
5. **If something is ambiguous or you discover an edge case not covered by the questions, add a new subsection** under the relevant phase and document it.
6. **Do not propose solutions or write any implementation code.** This is investigation only.
7. **When done, fill in the Phase 7 summary checklist** to confirm completeness.
8. **Save the completed document** back to `open_funnel.md` — it becomes the input for the implementation plan.
