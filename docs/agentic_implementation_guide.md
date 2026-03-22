# SGM Hub Phase 3: Quota Tracking Tab — Agentic Implementation Guide

> **Prerequisite state:** SGM Hub page, tab navigation, Leaderboard tab, and Dashboard tab are built and working. `SGMQuarterlyGoal` Prisma model is migrated (schema.prisma:539). The Quota Tracking tab currently renders a "Coming soon" placeholder (SGMHubContent.tsx:801-806).

---

## Phase 1: Quota API Routes (GET/PUT)

**Goal:** CRUD for `SGMQuarterlyGoal` records. Both views depend on reading quotas.

### 1.1 Create `src/app/api/sgm-hub/quota/route.ts`

**Pattern source:** `src/lib/queries/quarterly-goals.ts` + `src/app/api/sga-hub/quarterly-goals/route.ts`

**GET handler:**
- Query params: `year` (optional, e.g. "2026"). If omitted, return all.
- Auth: any of `admin`, `manager`, `revops_admin`, `sgm`. SGM users can read (they need their own quota for pacing).
- Query: `prisma.sGMQuarterlyGoal.findMany({ where: year ? { quarter: { startsWith: year } } : undefined, orderBy: { quarter: 'asc' } })`
- Response: `{ quotas: Array<{ id, userEmail, quarter, arrGoal, createdBy, updatedBy }> }`

**PUT handler:**
- Auth: `admin` and `revops_admin` ONLY. Return 403 for `sgm`, `manager`.
- Body: `{ userEmail: string, quarter: string, arrGoal: number }`
- Validate: quarter format matches `YYYY-QN`, arrGoal >= 0.
- Prisma call:
  ```ts
  prisma.sGMQuarterlyGoal.upsert({
    where: { userEmail_quarter: { userEmail, quarter } },
    create: { userEmail, quarter, arrGoal, createdBy: session.user.email, updatedAt: new Date() },
    update: { arrGoal, updatedBy: session.user.email, updatedAt: new Date() },
  })
  ```
  Note: `updatedAt` is NOT `@updatedAt` in the schema (no auto-update) — set it explicitly.
- Response: `{ quota: { id, userEmail, quarter, arrGoal, updatedBy } }`

### 1.2 Add api-client methods

**File:** `src/lib/api-client.ts` — add after the existing SGM Hub methods (~line 729):

```ts
// SGM Hub Quota Tracking methods
getSGMQuotas: (year?: string) => {
  const params = year ? `?year=${year}` : '';
  return apiFetch<{ quotas: SGMQuotaEntry[] }>(`/api/sgm-hub/quota${params}`);
},

saveSGMQuota: (data: { userEmail: string; quarter: string; arrGoal: number }) =>
  apiFetch<{ quota: SGMQuotaEntry }>('/api/sgm-hub/quota', {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
```

Import `SGMQuotaEntry` from `@/types/sgm-hub` (created in Phase 3).

### Validation gate
- `npm run build` passes
- Manual: `curl GET /api/sgm-hub/quota?year=2026` returns empty array (no data yet)

---

## Phase 2: Quota Seed Script

**Goal:** Populate initial quota values for 12 SGMs from the spec.

### 2.1 Create `scripts/seed-sgm-quotas.ts`

**SGM roster with userEmails** (from data-verifier findings — use the Prisma User table to look up emails by name, or hardcode if emails were found during exploration):

| SGM Name | Q1-2026 | Q2-2026 | Q3-2026 | Q4-2026 |
|---|---|---|---|---|
| Bre McDaniel | $2,000,000 | $2,000,000 | $2,000,000 | $2,000,000 |
| Corey Marcello | $1,300,000 | $1,300,000 | $1,300,000 | $1,300,000 |
| Bryan Belville | $1,300,000 | $1,300,000 | $1,300,000 | $1,300,000 |
| Erin Pearson | $1,300,000 | $1,300,000 | $1,300,000 | $1,300,000 |
| Jade Bingham | $1,300,000 | $1,300,000 | $1,300,000 | $1,300,000 |
| Tim Mackey | $650,000 | $1,300,000 | $1,300,000 | $1,300,000 |
| Arianna Butler | $650,000 | $1,300,000 | $1,300,000 | $1,300,000 |
| Lexi Harrison | $325,000 | $0 | $758,333 | $1,300,000 |
| David Eubanks | $0 | $650,000 | $1,300,000 | $1,300,000 |
| Clayton Kennamer | $0 | $650,000 | $1,300,000 | $1,300,000 |
| Lena Allouche | $0 | $325,000 | $1,191,667 | $1,300,000 |
| GinaRose Galli | $0 | $0 | $0 | $0 |

**Implementation:**
- Use `npx tsx scripts/seed-sgm-quotas.ts` to run
- For each SGM, look up `userEmail` from Prisma `User` table by name match
- Use `prisma.sGMQuarterlyGoal.upsert` in a loop (idempotent — safe to re-run)
- Set `createdBy: 'seed-script'`
- Log each upsert result

**STOP-AND-REPORT:** Verify seed ran successfully. `GET /api/sgm-hub/quota?year=2026` should return 48 records (12 SGMs × 4 quarters).

---

## Phase 3: Types

**Goal:** Add quota tracking types to `src/types/sgm-hub.ts`. This phase intentionally breaks the build as a checklist — all construction sites must be updated before Phase 4.

### 3.1 Add to `src/types/sgm-hub.ts`

```ts
// ============================================
// Phase 3: Quota Tracking Tab Types
// ============================================

/**
 * Pacing status for SGM quota tracking
 * Same status values as SGA, but tolerance band is ±15% instead of ±0.5 SQOs
 */
export type SGMPacingStatus = 'ahead' | 'on-track' | 'behind' | 'no-goal';

/**
 * Single SGM's quota tracking data for a quarter
 * Used by SGMQuotaTrackingView (SGM user view)
 */
export interface SGMQuotaProgress {
  sgmName: string;
  quarter: string;             // "2026-Q1"
  quarterLabel: string;        // "Q1 2026"
  actualArr: number;           // COALESCE(Actual_ARR__c, Account_Total_ARR__c)
  isEstimate: boolean;         // true when using Account_Total_ARR__c fallback
  quotaArr: number;            // from SGMQuarterlyGoal.arrGoal
  hasQuota: boolean;           // quotaArr > 0
  joinedCount: number;         // count of is_joined_unique = 1 for the quarter
  progressPercent: number | null;  // (actualArr / quotaArr) * 100
  expectedArr: number;         // linear pacing target for days elapsed
  pacingDiff: number;          // actualArr - expectedArr
  pacingDiffPercent: number;   // pacingDiff / expectedArr * 100 (for display)
  pacingStatus: SGMPacingStatus;
  projectedArr: number;        // (actualArr / daysElapsed) * daysInQuarter
  daysElapsed: number;
  daysInQuarter: number;
  quarterStartDate: string;    // YYYY-MM-DD
  quarterEndDate: string;      // YYYY-MM-DD
}

/**
 * Open opportunity row for SGM quota tracking view
 * Represents a single open recruiting opportunity
 */
export interface SGMOpenOpp {
  opportunityId: string;       // Full_Opportunity_ID__c (for RecordDetailModal)
  advisorName: string;
  daysOpen: number;            // from CreateDate to today
  daysOpenStatus: 'green' | 'yellow' | 'orange' | 'red';
  currentStage: string;        // StageName
  daysInStage: number | null;  // null when stage entry timestamp is null (~9.5% of Qualifying)
  daysInStageStatus: 'green' | 'yellow' | 'orange' | 'red' | null;
  aum: number;                 // COALESCE(Underwritten_AUM__c, Amount)
  aumFormatted: string;
  estimatedArr: number | null; // SGM_Estimated_ARR__c (null if not set)
  estimatedArrFormatted: string;
  salesforceUrl: string;
}

/**
 * Per-SGM row for admin breakdown table
 * Shows each SGM's open pipeline and quota progress
 */
export interface SGMAdminBreakdown {
  sgmName: string;
  userEmail: string;
  openOpps: number;            // count of all open opportunities
  openOpps90Plus: number;      // count of opps open 90+ days
  openAum: number;             // sum of Opportunity_AUM for open opps
  openAumFormatted: string;
  openArr: number;             // sum of SGM_Estimated_ARR__c for open opps
  openArrFormatted: string;
  quotaArr: number;            // from SGMQuarterlyGoal
  actualArr: number;           // joined ARR for the quarter
  progressPercent: number | null;
  pacingStatus: SGMPacingStatus;
}

/**
 * Team aggregate for admin view header
 */
export interface SGMTeamProgress {
  quarter: string;
  quarterLabel: string;
  totalActualArr: number;
  totalQuotaArr: number;
  progressPercent: number | null;
  expectedArr: number;
  pacingDiff: number;
  pacingStatus: SGMPacingStatus;
  daysElapsed: number;
  daysInQuarter: number;
}

/**
 * Single quota record (one per SGM per quarter — flat array, 48 entries for 12 SGMs × 4 quarters)
 * SGMQuotaTable groups this flat array by SGM for display (rows = SGMs, columns = quarters)
 */
export interface SGMQuotaEntry {
  id?: string;
  userEmail: string;
  sgmName: string;             // display name, looked up from User or SGM options
  quarter: string;             // "2026-Q1"
  arrGoal: number;
  updatedBy?: string | null;
}

/**
 * Per-quarter data point for historical chart
 */
export interface SGMHistoricalQuarter {
  quarter: string;             // "2025-Q1"
  quarterLabel: string;        // "Q1 2025"
  actualArr: number;           // COALESCE(Actual_ARR__c, Account_Total_ARR__c)
  isEstimate: boolean;         // true when using fallback
  goalArr: number | null;      // from SGMQuarterlyGoal, null if no goal set
  joinedCount: number;
}

/**
 * Filters for admin quota tracking view
 */
export interface SGMQuotaFilters {
  quarter: string;             // "2026-Q1"
  sgmNames?: string[];
  channels?: string[];
  sources?: string[];
  pacingStatuses?: SGMPacingStatus[];
}
```

### Validation gate
- `npm run build` — expect it to **fail** if any new types are imported but not yet used correctly. If it passes, that's fine too (types are additive).

---

## Phase 4: Pacing Utility

**Goal:** Create `calculateSGMQuarterPacing` adapted from `calculateQuarterPacing` in `src/lib/utils/sga-hub-helpers.ts:139`.

### 4.1 Create `src/lib/utils/sgm-hub-helpers.ts`

**Key differences from SGA version:**
- Input: `arrGoal: number` (Float) instead of `sqoGoal: number` (Int)
- Tolerance: ±15% of expected pace (not ±0.5 SQOs)
  - `if |actual - expected| / expected <= 0.15` → on-track
  - Above → ahead; Below → behind
  - Edge case: if `expected === 0` (start of quarter, 0 days elapsed) → `no-goal` if no quota, else `on-track`
- Returns `isEstimate: boolean` flag for UI "(est)" indicator
- Returns `projectedArr`: `daysElapsed > 0 ? (actual / daysElapsed) * daysInQuarter : 0`

```ts
import { getQuarterInfo } from './sga-hub-helpers';
import { SGMPacingStatus } from '@/types/sgm-hub';

interface SGMPacingResult {
  expectedArr: number;
  pacingDiff: number;
  pacingDiffPercent: number;
  pacingStatus: SGMPacingStatus;
  progressPercent: number | null;
  projectedArr: number;
  daysElapsed: number;
  daysInQuarter: number;
  quarterStartDate: string;
  quarterEndDate: string;
}

export function calculateSGMQuarterPacing(
  quarter: string,
  arrGoal: number | null,
  actualArr: number,
): SGMPacingResult {
  const info = getQuarterInfo(quarter);
  const today = new Date();
  const startDate = new Date(info.startDate);
  const endDate = new Date(info.endDate);

  const daysInQuarter = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const daysElapsed = Math.max(0, Math.min(
    daysInQuarter,
    Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1
  ));

  let expectedArr = 0;
  let pacingDiff = 0;
  let pacingDiffPercent = 0;
  let pacingStatus: SGMPacingStatus = 'no-goal';
  let progressPercent: number | null = null;
  let projectedArr = 0;

  if (arrGoal !== null && arrGoal > 0) {
    expectedArr = (arrGoal / daysInQuarter) * daysElapsed;
    pacingDiff = actualArr - expectedArr;
    progressPercent = Math.round((actualArr / arrGoal) * 100);
    projectedArr = daysElapsed > 0 ? (actualArr / daysElapsed) * daysInQuarter : 0;

    if (expectedArr === 0) {
      // Start of quarter — no expected value yet
      pacingStatus = 'on-track';
      pacingDiffPercent = 0;
    } else {
      pacingDiffPercent = (pacingDiff / expectedArr) * 100;
      if (pacingDiffPercent > 15) {
        pacingStatus = 'ahead';
      } else if (pacingDiffPercent >= -15) {
        pacingStatus = 'on-track';
      } else {
        pacingStatus = 'behind';
      }
    }
  }

  return {
    expectedArr: Math.round(expectedArr),
    pacingDiff: Math.round(pacingDiff),
    pacingDiffPercent: Math.round(pacingDiffPercent * 10) / 10,
    pacingStatus,
    progressPercent,
    projectedArr: Math.round(projectedArr),
    daysElapsed,
    daysInQuarter,
    quarterStartDate: info.startDate,
    quarterEndDate: info.endDate,
  };
}
```

Also add a helper for days-in-stage aging color:

```ts
/**
 * Get color status for days-open / days-in-stage
 * Matches STALE_PIPELINE_THRESHOLDS: warning=30, stale=60, critical=90
 */
export function getDaysAgingStatus(days: number | null): 'green' | 'yellow' | 'orange' | 'red' | null {
  if (days === null) return null;
  if (days >= 90) return 'red';
  if (days >= 60) return 'orange';
  if (days >= 30) return 'yellow';
  return 'green';
}

/**
 * Format dollar amount compactly
 * $1,234,567 → "$1.2M", $500,000 → "$500K", $0 → "$0"
 */
export function formatArrCompact(value: number): string {
  if (value === 0) return '$0';
  if (Math.abs(value) >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `$${(value / 1_000).toFixed(0)}K`;
  }
  return `$${value.toFixed(0)}`;
}
```

### Validation gate
- `npm run build` passes
- Unit test (optional): `calculateSGMQuarterPacing('2026-Q1', 1_000_000, 250_000)` with 45 days elapsed in a 90-day quarter → expected ~$500K, actual $250K → ~50% behind pacing → status 'behind', projected ~$500K

---

## Phase 5: Query Functions

**Goal:** Create `src/lib/queries/sgm-quota.ts` with BigQuery + Prisma query functions.

### 5.1 `getSGMQuotaProgress(sgmName: string, quarter: string)`

Returns actual ARR (using COALESCE), whether it's an estimate, and joined count for a specific SGM and quarter.

```sql
SELECT
  COUNT(DISTINCT v.Full_prospect_id__c) AS joined_count,
  COALESCE(SUM(v.Actual_ARR__c), 0) AS actual_arr_sum,
  COUNTIF(v.Actual_ARR__c IS NOT NULL) AS actual_arr_count,
  COALESCE(SUM(v.Account_Total_ARR__c), 0) AS account_arr_sum,
  COUNTIF(v.Account_Total_ARR__c IS NOT NULL) AS account_arr_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE v.is_joined_unique = 1
  AND v.SGM_Owner_Name__c = @sgmName
  AND v.joined_cohort_month IN UNNEST(@quarterMonths)
  AND v.recordtypeid = @recruitingRecordType
```

**ARR COALESCE logic (TypeScript, per-record level):**
- If `actual_arr_sum > 0` → use it, `isEstimate = false`
- Else → use `account_arr_sum`, `isEstimate = true`

**Important:** The COALESCE must be done **per-record**, not per-aggregate. The query should return per-row ARR:

```sql
SELECT
  v.Full_prospect_id__c,
  v.Actual_ARR__c,
  v.Account_Total_ARR__c,
  COALESCE(v.Actual_ARR__c, v.Account_Total_ARR__c) AS effective_arr,
  CASE WHEN v.Actual_ARR__c IS NOT NULL THEN FALSE ELSE TRUE END AS is_estimate
FROM ...
WHERE v.is_joined_unique = 1 AND v.SGM_Owner_Name__c = @sgmName AND ...
```

Then aggregate in TypeScript:
```ts
const totalArr = rows.reduce((sum, r) => sum + (toNumber(r.effective_arr) || 0), 0);
const hasAnyEstimate = rows.some(r => r.is_estimate === true);
```

Also look up the quota from Prisma:
```ts
const quota = await prisma.sGMQuarterlyGoal.findUnique({
  where: { userEmail_quarter: { userEmail, quarter } }
});
```

Then pass to `calculateSGMQuarterPacing(quarter, quota?.arrGoal ?? null, totalArr)`.

### 5.2 `getSGMOpenOpportunities(sgmName: string)`

Returns open opps with Days Open, Days in Stage, AUM, Est ARR.

```sql
SELECT
  v.Full_Opportunity_ID__c AS opportunityId,
  v.advisor_name AS advisorName,
  v.StageName AS currentStage,
  DATE_DIFF(CURRENT_DATE(), DATE(v.converted_date_raw), DAY) AS daysOpen,
  v.Opportunity_AUM AS aum,
  v.SGM_Estimated_ARR__c AS estimatedArr,
  v.salesforce_url AS salesforceUrl,
  -- Days in Stage: CASE on current stage
  CASE v.StageName
    WHEN 'Qualifying' THEN DATE_DIFF(CURRENT_DATE(), DATE(v.mql_stage_entered_ts), DAY)
    WHEN 'Discovery' THEN DATE_DIFF(CURRENT_DATE(), DATE(v.Stage_Entered_Discovery__c), DAY)
    WHEN 'Sales Process' THEN DATE_DIFF(CURRENT_DATE(), DATE(v.Stage_Entered_Sales_Process__c), DAY)
    WHEN 'Negotiating' THEN DATE_DIFF(CURRENT_DATE(), DATE(v.Stage_Entered_Negotiating__c), DAY)
    WHEN 'Signed' THEN DATE_DIFF(CURRENT_DATE(), DATE(v.Stage_Entered_Signed__c), DAY)
    WHEN 'On Hold' THEN DATE_DIFF(CURRENT_DATE(), DATE(v.Stage_Entered_On_Hold__c), DAY)
    ELSE NULL
  END AS daysInStage
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE v.is_sqo_unique = 1
  AND v.StageName IN ('Qualifying', 'Discovery', 'Sales Process', 'Negotiating', 'On Hold', 'Signed')
  AND v.SGM_Owner_Name__c = @sgmName
  AND v.recordtypeid = @recruitingRecordType
ORDER BY daysOpen DESC
```

**Notes:**
- `mql_stage_entered_ts` for Qualifying — 90.5% populated. When NULL, `daysInStage` is NULL → show "—" in UI.
- `converted_date_raw` = Lead ConvertedDate = when the opportunity was created. Use for "Days Open".
- Use `getDaysAgingStatus()` from Phase 4 to compute color status in TypeScript.
- AUM uses existing `Opportunity_AUM` (already COALESCE'd in the view).

### 5.3 `getSGMHistoricalQuarters(sgmName: string, numQuarters: number)`

Returns ARR by quarter for historical chart (current quarter + previous N-1 quarters).

```sql
SELECT
  CONCAT(CAST(EXTRACT(YEAR FROM DATE(v.advisor_join_date__c)) AS STRING), '-Q',
    CAST(EXTRACT(QUARTER FROM DATE(v.advisor_join_date__c)) AS STRING)) AS quarter,
  COUNT(DISTINCT v.Full_prospect_id__c) AS joined_count,
  SUM(COALESCE(v.Actual_ARR__c, v.Account_Total_ARR__c, 0)) AS total_arr,
  COUNTIF(v.Actual_ARR__c IS NULL AND v.Account_Total_ARR__c IS NOT NULL) AS estimate_count,
  COUNTIF(v.Actual_ARR__c IS NOT NULL) AS actual_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE v.is_joined_unique = 1
  AND v.SGM_Owner_Name__c = @sgmName
  AND v.recordtypeid = @recruitingRecordType
  AND v.advisor_join_date__c >= @startDate
GROUP BY quarter
ORDER BY quarter ASC
```

Where `@startDate` is computed as the first day of (currentQuarter - numQuarters + 1).

Then join with Prisma quotas:
```ts
const quotas = await prisma.sGMQuarterlyGoal.findMany({
  where: { userEmail, quarter: { in: quartersList } },
});
const quotaMap = Object.fromEntries(quotas.map(q => [q.quarter, q.arrGoal]));
```

Map to `SGMHistoricalQuarter[]`, setting `isEstimate = estimate_count > 0` and `goalArr = quotaMap[quarter] ?? null`.

### 5.4 `getSGMAdminBreakdown(quarter: string, filters?: SGMQuotaFilters)`

Returns per-SGM breakdown for admin view.

```sql
WITH ActiveSGMs AS (
  SELECT DISTINCT u.Name AS sgm_name, u.Email AS sgm_email
  FROM `savvy-gtm-analytics.SavvyGTMData.User` u
  WHERE u.Is_SGM__c = TRUE AND u.IsActive = TRUE
),
OpenPipeline AS (
  SELECT
    v.SGM_Owner_Name__c AS sgm_name,
    COUNT(DISTINCT v.Full_Opportunity_ID__c) AS open_opps,
    COUNTIF(DATE_DIFF(CURRENT_DATE(), DATE(v.converted_date_raw), DAY) >= 90) AS open_opps_90_plus,
    COALESCE(SUM(v.Opportunity_AUM), 0) AS open_aum,
    COALESCE(SUM(v.SGM_Estimated_ARR__c), 0) AS open_arr
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
  WHERE v.is_sqo_unique = 1
    AND v.StageName IN ('Qualifying', 'Discovery', 'Sales Process', 'Negotiating', 'On Hold', 'Signed')
    AND v.recordtypeid = @recruitingRecordType
  GROUP BY v.SGM_Owner_Name__c
),
JoinedArr AS (
  SELECT
    v.SGM_Owner_Name__c AS sgm_name,
    SUM(COALESCE(v.Actual_ARR__c, v.Account_Total_ARR__c, 0)) AS actual_arr
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
  WHERE v.is_joined_unique = 1
    AND v.joined_cohort_month IN UNNEST(@quarterMonths)
    AND v.recordtypeid = @recruitingRecordType
  GROUP BY v.SGM_Owner_Name__c
)
SELECT
  a.sgm_name,
  a.sgm_email,
  COALESCE(p.open_opps, 0) AS open_opps,
  COALESCE(p.open_opps_90_plus, 0) AS open_opps_90_plus,
  COALESCE(p.open_aum, 0) AS open_aum,
  COALESCE(p.open_arr, 0) AS open_arr,
  COALESCE(j.actual_arr, 0) AS actual_arr
FROM ActiveSGMs a
LEFT JOIN OpenPipeline p ON p.sgm_name = a.sgm_name
LEFT JOIN JoinedArr j ON j.sgm_name = a.sgm_name
ORDER BY a.sgm_name ASC
```

Then join with Prisma quotas for `quotaArr` and compute `progressPercent` and `pacingStatus` per-SGM via the pacing utility.

Optional filter application:
- `sgmNames`: add `WHERE u.Name IN UNNEST(@sgmNames)` to ActiveSGMs CTE
- `channels`: add to both OpenPipeline and JoinedArr WHERE clauses
- `sources`: same
- `pacingStatuses`: filter in TypeScript after pacing calculation

### 5.5 `getSGMTeamProgress(quarter: string)`

Returns team total actual ARR vs total quota.

```ts
// Sum all quotas for the quarter
const quotas = await prisma.sGMQuarterlyGoal.findMany({
  where: { quarter },
});
const totalQuotaArr = quotas.reduce((sum, q) => sum + q.arrGoal, 0);

// Get total joined ARR for the quarter (same query pattern as 5.1, but no SGM filter)
// ... BigQuery query without SGM_Owner_Name__c filter ...

const pacing = calculateSGMQuarterPacing(quarter, totalQuotaArr, totalActualArr);

return {
  quarter,
  quarterLabel: getQuarterInfo(quarter).label,
  totalActualArr,
  totalQuotaArr,
  ...pacing,
};
```

### Validation gate
- `npm run build` passes
- Test each function individually with known SGM names

---

## Phase 6: API Routes

**Goal:** Add API routes for quota tracking data.

### 6.1 Create `src/app/api/sgm-hub/quota-progress/route.ts` (GET)

- Query params: `sgmName`, `quarter` (default: current quarter)
- Auth: `admin`, `manager`, `revops_admin`, `sgm`. SGM users: enforce `sgmFilter` match.
- Calls: `getSGMQuotaProgress(sgmName, quarter)` → returns `SGMQuotaProgress`

### 6.2 Create `src/app/api/sgm-hub/open-opps/route.ts` (GET)

- Query params: `sgmName`
- Auth: `admin`, `manager`, `revops_admin`, `sgm`. SGM users: enforce `sgmFilter` match.
- Calls: `getSGMOpenOpportunities(sgmName)` → returns `{ opps: SGMOpenOpp[] }`

### 6.3 Create `src/app/api/sgm-hub/historical-quarters/route.ts` (GET)

- Query params: `sgmName`, `numQuarters` (default: 8)
- Auth: same as 6.1
- Calls: `getSGMHistoricalQuarters(sgmName, numQuarters)` → returns `{ quarters: SGMHistoricalQuarter[] }`
- **Click handler note:** When a bar is clicked, the frontend will call `getJoinedDrillDown` (already exists from Phase 1) with the specific quarter to get joined opportunities.

### 6.4 Create `src/app/api/sgm-hub/admin-breakdown/route.ts` (POST)

- Auth: `admin`, `revops_admin` ONLY.
- Body: `{ quarter, sgmNames?, channels?, sources?, pacingStatuses? }`
- Calls: `getSGMAdminBreakdown(quarter, filters)` → returns `{ breakdown: SGMAdminBreakdown[] }`

### 6.5 Create `src/app/api/sgm-hub/team-progress/route.ts` (GET)

- Query params: `quarter`
- Auth: `admin`, `revops_admin` ONLY.
- Calls: `getSGMTeamProgress(quarter)` → returns `{ progress: SGMTeamProgress }`

### 6.6 Add api-client methods

Add to `src/lib/api-client.ts`:

```ts
getSGMQuotaProgress: (sgmName: string, quarter?: string) => {
  const params = new URLSearchParams({ sgmName });
  if (quarter) params.set('quarter', quarter);
  return apiFetch<{ progress: SGMQuotaProgress }>(`/api/sgm-hub/quota-progress?${params}`);
},

getSGMOpenOpps: (sgmName: string) =>
  apiFetch<{ opps: SGMOpenOpp[] }>(`/api/sgm-hub/open-opps?sgmName=${encodeURIComponent(sgmName)}`),

getSGMHistoricalQuarters: (sgmName: string, numQuarters?: number) => {
  const params = new URLSearchParams({ sgmName });
  if (numQuarters) params.set('numQuarters', String(numQuarters));
  return apiFetch<{ quarters: SGMHistoricalQuarter[] }>(`/api/sgm-hub/historical-quarters?${params}`);
},

getSGMAdminBreakdown: (filters: SGMQuotaFilters) =>
  apiFetch<{ breakdown: SGMAdminBreakdown[] }>('/api/sgm-hub/admin-breakdown', {
    method: 'POST', body: JSON.stringify(filters),
  }),

getSGMTeamProgress: (quarter: string) =>
  apiFetch<{ progress: SGMTeamProgress }>(`/api/sgm-hub/team-progress?quarter=${quarter}`),
```

Import all new types from `@/types/sgm-hub`.

### Validation gate
- `npm run build` passes
- Manual test: `GET /api/sgm-hub/quota-progress?sgmName=Bre%20McDaniel&quarter=2026-Q1`

---

## Phase 7: SGM View Components

**Goal:** Build the SGM user's quota tracking view.

### 7.1 Create `src/components/sgm-hub/SGMQuotaTrackingView.tsx`

Container component for the SGM-user view. Receives all data as props.

**Props:**
```ts
interface SGMQuotaTrackingViewProps {
  quotaProgress: SGMQuotaProgress | null;
  historicalQuarters: SGMHistoricalQuarter[];
  openOpps: SGMOpenOpp[];
  loading: boolean;
  historicalLoading: boolean;
  openOppsLoading: boolean;
  onQuarterChange: (quarter: string) => void;
  selectedQuarter: string;
  onHistoricalBarClick: (quarter: string) => void;
  onOpenOppClick: (opportunityId: string) => void;
}
```

**Sections (top to bottom):**

1. **Quarter selector** — dropdown, mirrors SGA quarterly progress pattern. Default: current quarter.

2. **Quarterly Progress card** — mirror `QuarterlyProgressCard.tsx` pattern:
   - Header: "Quarterly Progress" + quarter label
   - Pacing badge (Tremor `Badge`) with status icon (TrendingUp/TrendingDown/Minus)
   - Pacing label: e.g., "Behind by $250,000 (50%)" or "On Track" or "Ahead by $100,000 (15%)"
   - ARR display: `$250,000` + `(est)` indicator when `isEstimate` is true. Show "of $1,000,000" for quota.
   - Progress bar: `<div>` with width% and color coding (green ≥100%, blue ≥75%, yellow ≥50%, red <50%)
   - Stats grid: Joined Count, Expected ARR, Projected ARR, Days Elapsed/Remaining

3. **Historical chart** — Recharts BarChart:
   - Up to 8 quarterly bars (current + 7 prior)
   - Bar fill: Actual ARR per quarter
   - ReferenceLine or overlay line: Goal ARR per quarter (where goal exists)
   - **Clickable bars**: `onClick` on each bar → `onHistoricalBarClick(quarter)` → parent fetches joined drilldown for that quarter
   - `isAnimationActive={false}` (mandatory — D3 crash fix)
   - Dark mode colors via `useTheme().resolvedTheme === 'dark'`
   - Tooltip showing ARR value, goal, count, and "(est)" indicator

4. **Open Opportunities table** — `SGMOpenOppsTable` component (see 7.2)

### 7.2 Create `src/components/sgm-hub/SGMOpenOppsTable.tsx`

Sortable table for open opportunities.

**Props:**
```ts
interface SGMOpenOppsTableProps {
  opps: SGMOpenOpp[];
  loading: boolean;
  onAdvisorClick: (opportunityId: string) => void;
}
```

**Columns:**
| Column | Source | Sortable | Notes |
|---|---|---|---|
| Advisor Name | `advisorName` | Yes | Clickable → `onAdvisorClick(opportunityId)` → opens RecordDetailModal |
| Days Open | `daysOpen` | Yes | Color-coded cell: green (0-29), yellow (30-59), orange (60-89), red (90+) |
| Current Stage | `currentStage` | Yes | Plain text |
| Days in Stage | `daysInStage` | Yes | Color-coded same as Days Open. Show "—" when null (Qualifying with missing `mql_stage_entered_ts`) |
| AUM | `aum` | Yes | Dollar formatted |
| Est. ARR | `estimatedArr` | Yes | Dollar formatted, "—" when null |

**Color coding implementation:**
```tsx
function getAgingCellClass(status: 'green' | 'yellow' | 'orange' | 'red' | null): string {
  switch (status) {
    case 'green': return 'text-green-600 dark:text-green-400';
    case 'yellow': return 'text-yellow-600 dark:text-yellow-400';
    case 'orange': return 'text-orange-600 dark:text-orange-400';
    case 'red': return 'text-red-600 dark:text-red-400 font-semibold';
    default: return 'text-gray-400';
  }
}
```

**Sorting:** Local state with `sortField` and `sortDirection`. Default: sort by `daysOpen` DESC.

### Validation gate
- Components render without errors in isolation
- `npm run build` passes

---

## Phase 8: Admin View Components

**Goal:** Build the admin/revops view of quota tracking.

### 8.1 Create `src/components/sgm-hub/SGMAdminQuotaView.tsx`

Container component for admin view.

**Props:**
```ts
interface SGMAdminQuotaViewProps {
  teamProgress: SGMTeamProgress | null;
  breakdown: SGMAdminBreakdown[];
  quotas: SGMQuotaEntry[];
  loading: boolean;
  breakdownLoading: boolean;
  quotasLoading: boolean;
  selectedQuarter: string;
  onQuarterChange: (quarter: string) => void;
  onFilterApply: (filters: SGMQuotaFilters) => void;
  onOpenOppsClick: (sgmName: string) => void;
  onOpenOpps90Click: (sgmName: string) => void;
  onQuotaSave: (data: { userEmail: string; quarter: string; arrGoal: number }) => Promise<void>;
  sgmOptions: Array<{ value: string; label: string; isActive: boolean }>;
  sgmOptionsLoading: boolean;
  filterOptions: FilterOptions | null;
}
```

**Sections (top to bottom):**

1. **Filters** — `SGMQuotaFilters.tsx` (see 8.2)

2. **Team Progress card** — mirror `TeamProgressCard.tsx` pattern (sga-hub):
   - Header: "Team Progress - Q1 2026"
   - Total Joined ARR: `$X,XXX,XXX` of `$Y,YYY,YYY` (total team quota)
   - Pacing status with icon + color
   - Progress bar (blue fill, same pattern as SGA)
   - Expected ARR, Days elapsed stats

3. **Individual SGM Breakdown table** — sortable, columns:
   | Column | Sortable | Notes |
   |---|---|---|
   | SGM Name | Yes | Plain text |
   | Open Opps | Yes | Number, **clickable** → `onOpenOppsClick(sgmName)` → drilldown showing all open opps |
   | Open Opps 90+ | Yes | Number, **clickable** → `onOpenOpps90Click(sgmName)` → drilldown filtered to 90+ day opps |
   | Open AUM | Yes | Dollar formatted |
   | Open ARR | Yes | Dollar formatted (SGM_Estimated_ARR__c) |
   | Progress % | Yes | Percentage with pacing badge color |

4. **Editable Quota Table** — `SGMQuotaTable.tsx` (see 8.3)

### 8.2 Create `src/components/sgm-hub/SGMQuotaFilters.tsx`

**Pattern source:** `AdminQuarterlyFilters.tsx`

**Filters:**
- Quarter dropdown (year + quarter number, default current quarter)
- SGM multi-select with search
- Channels multi-select
- Sources multi-select
- Pacing status multi-select: Ahead, On-Track, Behind, No Goal (default: all selected)

Uses Apply button pattern (local pending state → `onApply` callback).

### 8.3 Create `src/components/sgm-hub/SGMQuotaTable.tsx`

Editable quarterly quota grid. Admin/RevOps only.

**Pattern source:** `MetricScorecard.tsx` (on-blur/on-Enter edit pattern) + `WeeklyGoalsVsActuals.tsx`

**Props:**
```ts
interface SGMQuotaTableProps {
  quotas: SGMQuotaEntry[];
  loading: boolean;
  onSave: (data: { userEmail: string; quarter: string; arrGoal: number }) => Promise<void>;
  selectedYear: number;
  onYearChange: (year: number) => void;
}
```

**Layout:**
- Year selector at top
- Table: rows = 12 SGMs, columns = Q1-Q4 for selected year
- Each cell shows dollar-formatted value (e.g., "$1,300,000")
- Click cell → edit mode: input shows raw number
- Blur or Enter → commit: call `onSave({ userEmail, quarter, arrGoal })`

**State per cell:**
```ts
const [editingCell, setEditingCell] = useState<string | null>(null); // "email:quarter"
const [draftValue, setDraftValue] = useState<string>('');
```

**Optimistic update:** Update local quotas state immediately on save. Revert on error with toast/alert.

**Display:** Group quotas by SGM name. For each SGM, show 4 quarter columns. Empty cells show "$0".

### Validation gate
- `npm run build` passes
- All components render

---

## Phase 9: SGMHubContent.tsx Wiring

**Goal:** Replace the "Coming soon" placeholder with working quota tracking views.

### 9.1 Add new state variables

Add after the existing Dashboard tab state (~line 225):

```ts
// ============================================
// Quota Tracking tab state
// ============================================

// SGM view
const [quotaQuarter, setQuotaQuarter] = useState<string>(getCurrentQuarter());
const [quotaProgress, setQuotaProgress] = useState<SGMQuotaProgress | null>(null);
const [quotaProgressLoading, setQuotaProgressLoading] = useState(false);
const [historicalQuarters, setHistoricalQuarters] = useState<SGMHistoricalQuarter[]>([]);
const [historicalLoading, setHistoricalLoading] = useState(false);
const [openOpps, setOpenOpps] = useState<SGMOpenOpp[]>([]);
const [openOppsLoading, setOpenOppsLoading] = useState(false);

// Admin view
const [adminBreakdown, setAdminBreakdown] = useState<SGMAdminBreakdown[]>([]);
const [adminBreakdownLoading, setAdminBreakdownLoading] = useState(false);
const [teamProgress, setTeamProgress] = useState<SGMTeamProgress | null>(null);
const [quotas, setQuotas] = useState<SGMQuotaEntry[]>([]);
const [quotasLoading, setQuotasLoading] = useState(false);
const [quotaFilters, setQuotaFilters] = useState<SGMQuotaFilters>({
  quarter: getCurrentQuarter(),
});
const [quotaYear, setQuotaYear] = useState<number>(new Date().getFullYear());
```

**Consider extraction:** The file is already ~847 lines with ~22 Dashboard state vars. Adding ~15 more will push it to ~950+ lines. Consider extracting quota state + fetch logic into a custom hook:

```ts
// src/hooks/useQuotaTracking.ts (optional — if file gets unwieldy)
export function useQuotaTracking(isAdmin: boolean, sgmName: string | null, activeTab: SGMHubTab) {
  // All quota state + fetch functions + effects
  return { quotaProgress, historicalQuarters, openOpps, ... };
}
```

Decision: **Do extract** — the file is already complex enough.

### 9.2 Add fetch functions

**SGM view fetches (in hook or SGMHubContent):**

```ts
const fetchQuotaProgress = async () => {
  if (!currentUserSgmName) return;
  setQuotaProgressLoading(true);
  try {
    const { progress } = await dashboardApi.getSGMQuotaProgress(currentUserSgmName, quotaQuarter);
    setQuotaProgress(progress);
  } catch (err) {
    console.error('Error fetching quota progress:', err);
  } finally {
    setQuotaProgressLoading(false);
  }
};

const fetchHistoricalQuarters = async () => {
  if (!currentUserSgmName) return;
  setHistoricalLoading(true);
  try {
    const { quarters } = await dashboardApi.getSGMHistoricalQuarters(currentUserSgmName, 8);
    setHistoricalQuarters(quarters);
  } catch (err) {
    console.error('Error fetching historical quarters:', err);
  } finally {
    setHistoricalLoading(false);
  }
};

const fetchOpenOpps = async () => {
  if (!currentUserSgmName) return;
  setOpenOppsLoading(true);
  try {
    const { opps } = await dashboardApi.getSGMOpenOpps(currentUserSgmName);
    setOpenOpps(opps);
  } catch (err) {
    console.error('Error fetching open opps:', err);
  } finally {
    setOpenOppsLoading(false);
  }
};
```

**Admin view fetches:**

```ts
const fetchAdminBreakdown = async () => {
  setAdminBreakdownLoading(true);
  try {
    const { breakdown } = await dashboardApi.getSGMAdminBreakdown(quotaFilters);
    setAdminBreakdown(breakdown);
  } catch (err) {
    console.error('Error fetching admin breakdown:', err);
  } finally {
    setAdminBreakdownLoading(false);
  }
};

const fetchTeamProgress = async () => {
  try {
    const { progress } = await dashboardApi.getSGMTeamProgress(quotaFilters.quarter);
    setTeamProgress(progress);
  } catch (err) {
    console.error('Error fetching team progress:', err);
  }
};

const fetchQuotas = async () => {
  setQuotasLoading(true);
  try {
    const { quotas: data } = await dashboardApi.getSGMQuotas(String(quotaYear));
    setQuotas(data);
  } catch (err) {
    console.error('Error fetching quotas:', err);
  } finally {
    setQuotasLoading(false);
  }
};
```

### 9.3 Add useEffect triggers

```ts
// Quota tracking data fetch
useEffect(() => {
  if (activeTab !== 'quota-tracking') return;

  if (isAdmin) {
    fetchAdminBreakdown();
    fetchTeamProgress();
    fetchQuotas();
  } else if (isSGM && currentUserSgmName) {
    fetchQuotaProgress();
    fetchHistoricalQuarters();
    fetchOpenOpps();
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [activeTab, quotaQuarter, quotaFilters]);

// Quota year change → refetch quota table
useEffect(() => {
  if (activeTab !== 'quota-tracking' || !isAdmin) return;
  fetchQuotas();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [quotaYear]);
```

### 9.4 Add handler functions

```ts
const handleQuotaSave = async (data: { userEmail: string; quarter: string; arrGoal: number }) => {
  // Optimistic update
  setQuotas(prev => prev.map(q =>
    q.userEmail === data.userEmail && q.quarter === data.quarter
      ? { ...q, arrGoal: data.arrGoal }
      : q
  ));
  try {
    await dashboardApi.saveSGMQuota(data);
  } catch (err) {
    console.error('Error saving quota:', err);
    // Revert on error
    fetchQuotas();
  }
};

const handleHistoricalBarClick = async (quarter: string) => {
  if (!currentUserSgmName) return;
  // Open System 2 drilldown (MetricDrillDownModal) with joined records for that quarter
  setDrillDownLoading(true);
  setDrillDownMetricType('joined');
  setDrillDownOpen(true);
  const title = `${currentUserSgmName} - Joined Advisors - ${quarter}`;
  setDrillDownTitle(title);
  setDrillDownContext({ metricType: 'joined', title, sgaName: null, sgmName: currentUserSgmName, quarter });
  try {
    const response = await dashboardApi.getJoinedDrillDown(currentUserSgmName, { quarter });
    setDrillDownRecords(response.records);
  } catch (err) {
    setDrillDownError('Failed to load joined records');
  } finally {
    setDrillDownLoading(false);
  }
};

const handleOpenOppClick = (opportunityId: string) => {
  setRecordDetailId(opportunityId);
  setRecordDetailOpen(true);
};

// Admin drilldowns: open opps and 90+ opps
const handleAdminOpenOppsClick = async (sgmName: string) => {
  // Fetch open opps for this SGM and show in drilldown
  setVolumeDrillDownLoading(true);
  setVolumeDrillDownOpen(true);
  setVolumeDrillDownTitle(`${sgmName} - Open Opportunities`);
  setVolumeDrillDownMetric('openPipeline');
  try {
    const { opps } = await dashboardApi.getSGMOpenOpps(sgmName);
    // Map SGMOpenOpp[] to DetailRecord[] for VolumeDrillDownModal
    const records: DetailRecord[] = opps.map(opp => ({
      id: opp.opportunityId,
      advisorName: opp.advisorName,
      stageName: opp.currentStage,
      daysOpen: opp.daysOpen,
      aum: opp.aum,
      salesforceUrl: opp.salesforceUrl,
      // ... map remaining fields as needed by DetailRecordsTable
    }));
    setVolumeDrillDownRecords(records);
  } catch (err) {
    setVolumeDrillDownError('Failed to load open opportunities');
  } finally {
    setVolumeDrillDownLoading(false);
  }
};

const handleAdminOpenOpps90Click = async (sgmName: string) => {
  // Same as above but filter to 90+ day opps
  setVolumeDrillDownLoading(true);
  setVolumeDrillDownOpen(true);
  setVolumeDrillDownTitle(`${sgmName} - Open Opportunities (90+ days)`);
  setVolumeDrillDownMetric('openPipeline');
  try {
    const { opps } = await dashboardApi.getSGMOpenOpps(sgmName);
    const filtered = opps.filter(o => o.daysOpen >= 90);
    const records: DetailRecord[] = filtered.map(opp => ({
      id: opp.opportunityId,
      advisorName: opp.advisorName,
      stageName: opp.currentStage,
      daysOpen: opp.daysOpen,
      aum: opp.aum,
      salesforceUrl: opp.salesforceUrl,
    }));
    setVolumeDrillDownRecords(records);
  } catch (err) {
    setVolumeDrillDownError('Failed to load stale opportunities');
  } finally {
    setVolumeDrillDownLoading(false);
  }
};
```

### 9.5 Replace placeholder with tab render

Replace the "Coming soon" block (SGMHubContent.tsx:801-806) with:

```tsx
{activeTab === 'quota-tracking' && (
  isAdmin ? (
    <SGMAdminQuotaView
      teamProgress={teamProgress}
      breakdown={adminBreakdown}
      quotas={quotas}
      loading={quotaProgressLoading}
      breakdownLoading={adminBreakdownLoading}
      quotasLoading={quotasLoading}
      selectedQuarter={quotaFilters.quarter}
      onQuarterChange={(q) => setQuotaFilters(prev => ({ ...prev, quarter: q }))}
      onFilterApply={setQuotaFilters}
      onOpenOppsClick={handleAdminOpenOppsClick}
      onOpenOpps90Click={handleAdminOpenOpps90Click}
      onQuotaSave={handleQuotaSave}
      sgmOptions={sgmOptions}
      sgmOptionsLoading={sgmOptionsLoading}
      filterOptions={filterOptions}
    />
  ) : (
    <SGMQuotaTrackingView
      quotaProgress={quotaProgress}
      historicalQuarters={historicalQuarters}
      openOpps={openOpps}
      loading={quotaProgressLoading}
      historicalLoading={historicalLoading}
      openOppsLoading={openOppsLoading}
      onQuarterChange={setQuotaQuarter}
      selectedQuarter={quotaQuarter}
      onHistoricalBarClick={handleHistoricalBarClick}
      onOpenOppClick={handleOpenOppClick}
    />
  )
)}
```

### 9.6 Add imports

Add at the top of SGMHubContent.tsx:
```ts
import { SGMQuotaTrackingView } from '@/components/sgm-hub/SGMQuotaTrackingView';
import { SGMAdminQuotaView } from '@/components/sgm-hub/SGMAdminQuotaView';
import {
  SGMQuotaProgress, SGMOpenOpp, SGMHistoricalQuarter,
  SGMAdminBreakdown, SGMTeamProgress, SGMQuotaEntry, SGMQuotaFilters,
} from '@/types/sgm-hub';
```

### Validation gate
- `npm run build` passes with zero errors
- Tab renders for both SGM and admin user types

---

## Phase 9.5: Documentation Sync

```bash
npx agent-guard sync
npm run gen:api-routes
npm run gen:all
```

---

## Phase 10: UI/UX Validation (Requires User)

### SGM View checks
- [ ] SGM user sees only their own data, no filter UI on this tab
- [ ] Quarter selector changes data appropriately
- [ ] Progress bar shows correct Actual ARR vs quota
- [ ] "(est)" indicator appears when ARR is from `Account_Total_ARR__c` fallback
- [ ] Pacing math: $1M quota, 90-day quarter, 45 days in, $250K actual → ~50% behind pacing, projected ~$500K
- [ ] ±15% tolerance: verify "on-track" badge when actual is within 15% of expected
- [ ] Historical chart shows up to 8 quarters with goal overlay lines where goals exist
- [ ] Historical chart bars clickable → drilldown with joined opportunities → click through to RecordDetailModal
- [ ] Open Opps table renders with correct stages
- [ ] Color coding: 95-day-old opp shows red, 45-day shows yellow, 15-day shows green
- [ ] Days in Stage for Qualifying uses `mql_stage_entered_ts`, shows "—" when null
- [ ] Days in Stage for other stages uses their `Stage_Entered_*` field
- [ ] Advisor Name clickable → RecordDetailModal
- [ ] AUM shows `COALESCE(Underwritten_AUM__c, Amount)` correctly

### Admin View checks
- [ ] Admin/RevOps sees team view with filter UI
- [ ] Team progress bar shows total Joined ARR vs total team quota
- [ ] Pacing status filter works (filter to "behind" shows only behind-pace SGMs)
- [ ] Individual SGM Breakdown table shows all active SGMs
- [ ] Open Opps count clickable → drilldown showing those opps
- [ ] Open Opps 90+ count clickable → drilldown filtered to 90+ day opps
- [ ] Progress % aligns with individual quota values
- [ ] Editable quota table: all 12 SGMs visible with 4 quarter columns
- [ ] Edit a cell → blur or press Enter → value saves
- [ ] Reload page → edited value persists
- [ ] Check `updatedBy` is populated with admin's name/email after edit
- [ ] GinaRose Galli appears with $0 defaults
- [ ] Changing a quota reflects in SGM view pacing on next load/refresh

### Build check
- [ ] `npm run build` passes with zero errors

---

## Key Decision Log

| Decision | Rationale |
|---|---|
| COALESCE(Actual_ARR__c, Account_Total_ARR__c) with "(est)" indicator | `Actual_ARR__c` is 0% populated for Q4 2025/Q1 2026. Fallback ensures data shows now; auto-transitions when field populates. |
| ±15% pacing tolerance | Proportional band similar to SGA's ±0.5 SQO at typical ARR levels. More forgiving than SGA because ARR is lumpier. |
| `mql_stage_entered_ts` for Qualifying "Days in Stage" | No `Stage_Entered_Qualifying__c` field exists. `mql_stage_entered_ts` is 90.5% populated — show "—" for the 9.5% null cases. |
| Extract `useQuotaTracking` hook | SGMHubContent.tsx already ~847 lines with ~29 state vars. Adding ~15 more warrants extraction for maintainability. |
| No gauge/ring component | Codebase has none. Use existing progress bar + Badge pattern from `QuarterlyProgressCard.tsx`. |
| Historical chart bars are clickable | New functionality — SGA version doesn't have click handlers on its historical chart. Uses existing `getJoinedDrillDown` API. |
| Admin drilldowns use System 1 (VolumeDrillDownModal) | Consistent with Dashboard tab pattern. Map `SGMOpenOpp[]` → `DetailRecord[]` for the modal. |
| GinaRose Galli included at $0 quotas | No longer active SGM but should exist in system for historical data integrity. |

---

## File Summary

### New Files (11)
| File | Purpose |
|---|---|
| `src/app/api/sgm-hub/quota/route.ts` | GET/PUT for SGMQuarterlyGoal CRUD |
| `src/app/api/sgm-hub/quota-progress/route.ts` | GET: SGM's pacing data for a quarter |
| `src/app/api/sgm-hub/open-opps/route.ts` | GET: SGM's open opportunities |
| `src/app/api/sgm-hub/historical-quarters/route.ts` | GET: SGM's historical ARR + goals |
| `src/app/api/sgm-hub/admin-breakdown/route.ts` | POST: admin team breakdown |
| `src/app/api/sgm-hub/team-progress/route.ts` | GET: admin team totals |
| `src/lib/queries/sgm-quota.ts` | BigQuery + Prisma query functions |
| `src/lib/utils/sgm-hub-helpers.ts` | Pacing utility + aging helpers |
| `src/components/sgm-hub/SGMQuotaTrackingView.tsx` | SGM user quota view |
| `src/components/sgm-hub/SGMOpenOppsTable.tsx` | Open opportunities table |
| `src/components/sgm-hub/SGMAdminQuotaView.tsx` | Admin quota view container |
| `src/components/sgm-hub/SGMQuotaFilters.tsx` | Admin quota filters |
| `src/components/sgm-hub/SGMQuotaTable.tsx` | Editable quarterly quota grid |
| `scripts/seed-sgm-quotas.ts` | One-time seed script for initial quotas |

### Modified Files (3)
| File | Change |
|---|---|
| `src/types/sgm-hub.ts` | Add ~10 new types for quota tracking |
| `src/lib/api-client.ts` | Add ~7 new methods for quota APIs |
| `src/app/dashboard/sgm-hub/SGMHubContent.tsx` | Replace placeholder, add state/fetch/handlers (or extract to hook) |
