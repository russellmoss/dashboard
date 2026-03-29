# SQO Target Calculator — Implementation Guide

> **Feature:** Editable "Target AUM" per quarterly scorecard that computes "Required SQOs from Prior Quarter." Persists to Neon DB. Exports to a new "BQ SQO Targets" Google Sheets tab.
>
> **Key decision:** Use `mean_joined_aum` (backtest MAE=16.5, best accuracy of 6 candidates).
>
> **Source:** `sqo-target-exploration-results.md` (2026-03-24)

---

## Phase 1: Add `mean_joined_aum` to Rates Query + Interfaces

**Files:** `src/lib/queries/forecast-rates.ts`, `src/lib/api-client.ts`

### 1a. Update `ForecastRates` interface (forecast-rates.ts, line 5)

Add `mean_joined_aum` and `joined_deal_count` after `cohort_count`:

```ts
// BEFORE (line 5-17):
export interface ForecastRates {
  sqo_to_sp: number;
  sp_to_neg: number;
  neg_to_signed: number;
  signed_to_joined: number;
  avg_days_sqo_to_sp: number;
  avg_days_in_sp: number;
  avg_days_in_neg: number;
  avg_days_in_signed: number;
  window_start: string;
  window_end: string;
  cohort_count: number;
}

// AFTER:
export interface ForecastRates {
  sqo_to_sp: number;
  sp_to_neg: number;
  neg_to_signed: number;
  signed_to_joined: number;
  avg_days_sqo_to_sp: number;
  avg_days_in_sp: number;
  avg_days_in_neg: number;
  avg_days_in_signed: number;
  window_start: string;
  window_end: string;
  cohort_count: number;
  mean_joined_aum: number;       // Mean AUM ($) of Joined-only deals
  joined_deal_count: number;     // N for sample size warnings (warn if < 30)
}
```

### 1b. Update `RawRatesResult` interface (forecast-rates.ts, line 25)

```ts
// ADD after cohort_count (line 36):
  mean_joined_aum: number | null;
  joined_deal_count: number | null;
```

### 1c. Update `_getForecastRates` query SELECT (forecast-rates.ts, ~line 80-131)

Add two new columns to the end of the SELECT, right before `${windowStartLabel} AS window_start`:

```sql
      -- Mean AUM of Joined-only deals (for SQO target calculator)
      SAFE_DIVIDE(
        SUM(CASE WHEN is_joined = 1 AND aum_dollars > 0 THEN aum_dollars END),
        COUNTIF(is_joined = 1 AND aum_dollars > 0)
      ) AS mean_joined_aum,
      COUNTIF(is_joined = 1 AND aum_dollars > 0) AS joined_deal_count,
```

But the flat query's `cohort` CTE doesn't currently have `aum_dollars`. Add it to the SELECT list in the `cohort` CTE (line 59-73). After the `eff_joined_ts` line, add:

```sql
        COALESCE(Underwritten_AUM__c, Amount) AS aum_dollars,
```

So the full cohort CTE becomes:
```sql
    WITH cohort AS (
      SELECT
        StageName,
        Date_Became_SQO__c,
        COALESCE(Stage_Entered_Sales_Process__c, Stage_Entered_Negotiating__c, Stage_Entered_Signed__c, Stage_Entered_Joined__c) AS eff_sp_ts,
        COALESCE(Stage_Entered_Negotiating__c, Stage_Entered_Signed__c, Stage_Entered_Joined__c) AS eff_neg_ts,
        COALESCE(Stage_Entered_Signed__c, Stage_Entered_Joined__c) AS eff_signed_ts,
        COALESCE(Stage_Entered_Joined__c, TIMESTAMP(advisor_join_date__c)) AS eff_joined_ts,
        COALESCE(Underwritten_AUM__c, Amount) AS aum_dollars
      FROM \`${FORECAST_VIEW}\`
      WHERE Full_Opportunity_ID__c IS NOT NULL
        AND is_primary_opp_record = 1
        AND SQO_raw = 'Yes'
        AND StageName IN ('Joined', 'Closed Lost')
        ${dateFilter}
    ),
```

Then in the final SELECT (after `avg_days_in_signed` and before `${windowStartLabel}`), add:

```sql
      SAFE_DIVIDE(
        SUM(CASE WHEN is_joined = 1 AND aum_dollars > 0 THEN aum_dollars END),
        COUNTIF(is_joined = 1 AND aum_dollars > 0)
      ) AS mean_joined_aum,
      COUNTIF(is_joined = 1 AND aum_dollars > 0) AS joined_deal_count,
```

### 1d. Update `_getForecastRates` return mapping (line 141-153)

Add after `cohort_count`:

```ts
    mean_joined_aum: toNumber(r.mean_joined_aum) || 0,
    joined_deal_count: toNumber(r.joined_deal_count) || 0,
```

### 1e. Update `RATES_SELECT` constant (line 166-211)

Add to the end, right before the closing `` COUNT(*) AS cohort_count` ``:

```sql
      SAFE_DIVIDE(
        SUM(CASE WHEN is_joined = 1 AND aum_dollars > 0 THEN aum_dollars END),
        COUNTIF(is_joined = 1 AND aum_dollars > 0)
      ) AS mean_joined_aum,
      COUNTIF(is_joined = 1 AND aum_dollars > 0) AS joined_deal_count,
```

Note: `RATES_SELECT` ends with `COUNT(*) AS cohort_count` — the new lines go before that, so the order is:
```
      ...avg_days_in_signed,
      SAFE_DIVIDE(...) AS mean_joined_aum,
      COUNTIF(...) AS joined_deal_count,
      COUNT(*) AS cohort_count
```

### 1f. Update `_getTieredForecastRates` cohort CTE (line 248-263)

The tiered query already has `COALESCE(Underwritten_AUM__c, Amount)` for the tier split. Add `aum_dollars` alias to the cohort CTE. Find line 256:
```sql
        CASE WHEN COALESCE(Underwritten_AUM__c, Amount) < 75000000 THEN 'Lower' ELSE 'Upper' END AS aum_tier_2
```

Add before it:
```sql
        COALESCE(Underwritten_AUM__c, Amount) AS aum_dollars,
```

### 1g. Update `mapRawToForecastRates` (line 213-227)

```ts
// BEFORE:
function mapRawToForecastRates(r: RawRatesResult, windowStart: string, windowEnd: string): ForecastRates {
  return {
    ...
    cohort_count: toNumber(r.cohort_count) || 0,
  };
}

// AFTER — add two fields:
    cohort_count: toNumber(r.cohort_count) || 0,
    mean_joined_aum: toNumber(r.mean_joined_aum) || 0,
    joined_deal_count: toNumber(r.joined_deal_count) || 0,
```

### 1h. Update `EMPTY_RATES` (line 229-233)

```ts
// BEFORE:
const EMPTY_RATES: ForecastRates = {
  sqo_to_sp: 0, sp_to_neg: 0, neg_to_signed: 0, signed_to_joined: 0,
  avg_days_sqo_to_sp: 0, avg_days_in_sp: 0, avg_days_in_neg: 0, avg_days_in_signed: 0,
  window_start: '', window_end: '', cohort_count: 0,
};

// AFTER:
const EMPTY_RATES: ForecastRates = {
  sqo_to_sp: 0, sp_to_neg: 0, neg_to_signed: 0, signed_to_joined: 0,
  avg_days_sqo_to_sp: 0, avg_days_in_sp: 0, avg_days_in_neg: 0, avg_days_in_signed: 0,
  window_start: '', window_end: '', cohort_count: 0,
  mean_joined_aum: 0, joined_deal_count: 0,
};
```

### 1i. Update `ForecastRatesClient` in api-client.ts (line 22-34)

```ts
// ADD after cohort_count:
  mean_joined_aum: number;
  joined_deal_count: number;
```

### Phase 1 Validation Gate

```bash
npx tsc --noEmit
```

Expected: Build passes. The new fields are additive — no existing consumers break because they don't destructure exhaustively. The rates API already returns the full `ForecastRates` object, so the two new fields flow through to the client automatically.

---

## Phase 2: Prisma Model + Migration

**Files:** `prisma/schema.prisma`

### 2a. Add `ForecastQuarterTarget` model

Add after the `ManagerQuarterlyGoal` model (after line 96):

```prisma
model ForecastQuarterTarget {
  id               String   @id @default(cuid())
  quarter          String   @unique   // "Q2 2026"
  targetAumDollars Float    @default(0)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  updatedBy        String?

  @@index([quarter])
  @@map("forecast_quarter_targets")
}
```

This follows the `ManagerQuarterlyGoal` pattern: global per-quarter (not per-user), simple upsert by quarter key, `updatedBy` for audit trail.

### 2b. Run migration

```bash
npx prisma migrate dev --name add-forecast-quarter-targets
```

### 2c. Generate client

```bash
npx prisma generate
```

### Phase 2 Validation Gate

```bash
npx prisma migrate status
npx tsc --noEmit
```

Expected: Migration applied, Prisma client generated, build passes.

---

## Phase 3: API Route — `/api/forecast/sqo-targets`

**New file:** `src/app/api/forecast/sqo-targets/route.ts`

### 3a. Create the route file

Follow the auth pattern from `src/app/api/forecast/scenarios/route.ts`:
- GET: any authenticated user (read-only)
- POST: requires `canRunScenarios` permission (same as scenarios)

```ts
// src/app/api/forecast/sqo-targets/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * GET /api/forecast/sqo-targets
 * Returns all quarter targets as a Record<string, number>
 * e.g. { "Q2 2026": 500000000, "Q3 2026": 750000000 }
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }

    const targets = await prisma.forecastQuarterTarget.findMany({
      orderBy: { quarter: 'asc' },
    });

    // Convert to Record<string, number> keyed by quarter label
    const targetsByQuarter: Record<string, number> = {};
    for (const t of targets) {
      targetsByQuarter[t.quarter] = t.targetAumDollars;
    }

    return NextResponse.json({ targets: targetsByQuarter });
  } catch (error) {
    console.error('SQO targets GET error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch SQO targets' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/forecast/sqo-targets
 * Upsert a single quarter target
 * Body: { quarter: "Q2 2026", targetAumDollars: 500000000 }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = getSessionPermissions(session);
    if (!permissions || !permissions.canRunScenarios) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { quarter, targetAumDollars } = body;

    if (!quarter || typeof quarter !== 'string') {
      return NextResponse.json(
        { error: 'quarter is required (e.g. "Q2 2026")' },
        { status: 400 }
      );
    }

    if (targetAumDollars === undefined || typeof targetAumDollars !== 'number' || targetAumDollars < 0) {
      return NextResponse.json(
        { error: 'targetAumDollars must be a non-negative number' },
        { status: 400 }
      );
    }

    const target = await prisma.forecastQuarterTarget.upsert({
      where: { quarter },
      update: {
        targetAumDollars,
        updatedBy: session.user.email,
      },
      create: {
        quarter,
        targetAumDollars,
        updatedBy: session.user.email,
      },
    });

    return NextResponse.json({ target });
  } catch (error) {
    console.error('SQO targets POST error:', error);
    return NextResponse.json(
      { error: 'Failed to save SQO target' },
      { status: 500 }
    );
  }
}
```

### 3b. Add client methods to `api-client.ts`

Add after `exportForecastToSheets` (~line 1115), before the closing `};` of `dashboardApi`:

```ts
  getSQOTargets: () =>
    apiFetch<{ targets: Record<string, number> }>('/api/forecast/sqo-targets'),

  saveSQOTarget: (quarter: string, targetAumDollars: number) =>
    apiFetch<{ target: any }>('/api/forecast/sqo-targets', {
      method: 'POST',
      body: JSON.stringify({ quarter, targetAumDollars }),
    }),
```

### Phase 3 Validation Gate

```bash
npx tsc --noEmit
```

Expected: Build passes. New route file compiles. Client methods are typed.

---

## Phase 4: Update `ForecastMetricCards` UI

**File:** `src/app/dashboard/forecast/components/ForecastMetricCards.tsx`

### 4a. Expand the props interface (line 9-13)

```ts
// BEFORE:
interface ForecastMetricCardsProps {
  summary: ForecastSummary | null;
  windowDays: 180 | 365 | 730 | null;
  rates: ForecastRates | null;
}

// AFTER:
interface ForecastMetricCardsProps {
  summary: ForecastSummary | null;
  windowDays: 180 | 365 | 730 | null;
  rates: ForecastRates | null;
  targetAumByQuarter: Record<string, number>;
  onTargetChange: (quarter: string, targetAumDollars: number) => void;
  canEditTargets: boolean;
}
```

### 4b. Add `formatSqos` helper (after `formatAum` around line 15)

```ts
function formatAumInput(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(0)}`;
  return `${value}`;
}

function parseAumInput(input: string): number | null {
  // Accept formats: "500" (millions), "1.2" (billions if > 100 treat as millions)
  const num = parseFloat(input.replace(/[,$]/g, ''));
  if (isNaN(num) || num < 0) return null;
  // User types in millions (e.g., "500" = $500M)
  return num * 1e6;
}
```

### 4c. Create `SQOTargetInput` inline component

Add before the main `ForecastMetricCards` export function:

```ts
function SQOTargetInput({
  quarter,
  currentTarget,
  meanJoinedAum,
  sqoToJoinedRate,
  joinedDealCount,
  onSave,
  canEdit,
}: {
  quarter: string;
  currentTarget: number; // dollars
  meanJoinedAum: number;
  sqoToJoinedRate: number;
  joinedDealCount: number;
  onSave: (quarter: string, value: number) => void;
  canEdit: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');

  const expectedAumPerSQO = meanJoinedAum * sqoToJoinedRate;
  const requiredSQOs = expectedAumPerSQO > 0 && currentTarget > 0
    ? Math.ceil(currentTarget / expectedAumPerSQO)
    : null;
  const lowConfidence = joinedDealCount < 30;

  const handleSave = () => {
    const parsed = parseAumInput(inputValue);
    if (parsed === null) return;
    onSave(quarter, parsed);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') {
      setIsEditing(false);
      setInputValue(currentTarget > 0 ? formatAumInput(currentTarget) : '');
    }
  };

  if (!canEdit && currentTarget === 0) return null;

  return (
    <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
      <div className="flex items-center gap-1.5">
        <Text className="text-xs text-gray-500">Target AUM:</Text>
        {isEditing ? (
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-400">$</span>
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleSave}
              placeholder="500"
              className="w-16 px-1 py-0.5 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              autoFocus
            />
            <span className="text-xs text-gray-400">M</span>
          </div>
        ) : (
          <button
            onClick={() => {
              if (!canEdit) return;
              setInputValue(currentTarget > 0 ? formatAumInput(currentTarget) : '');
              setIsEditing(true);
            }}
            className={`text-xs font-medium ${
              canEdit
                ? 'text-blue-600 dark:text-blue-400 hover:underline cursor-pointer'
                : 'text-gray-600 dark:text-gray-400'
            }`}
            disabled={!canEdit}
          >
            {currentTarget > 0 ? formatAum(currentTarget) : (canEdit ? 'Set target' : '-')}
          </button>
        )}
      </div>
      {requiredSQOs !== null && (
        <Text className="text-xs mt-1">
          <span className="font-semibold text-indigo-600 dark:text-indigo-400">
            ~{requiredSQOs} SQOs
          </span>
          {' '}needed from prior quarter
          {lowConfidence && (
            <span className="text-amber-500 ml-1" title={`Only ${joinedDealCount} joined deals in window`}>
              (N={joinedDealCount}, low confidence)
            </span>
          )}
        </Text>
      )}
    </div>
  );
}
```

### 4d. Update the main component signature and card rendering

```ts
// BEFORE (line 50):
export function ForecastMetricCards({ summary, windowDays, rates }: ForecastMetricCardsProps) {

// AFTER:
export function ForecastMetricCards({
  summary,
  windowDays,
  rates,
  targetAumByQuarter,
  onTargetChange,
  canEditTargets,
}: ForecastMetricCardsProps) {
```

Compute the SQO→Joined rate once at the top of the function (after the `if (!summary) return null;` guard):

```ts
  // SQO → Joined conversion rate (product of all 4 flat rates)
  const sqoToJoinedRate = rates
    ? rates.sqo_to_sp * rates.sp_to_neg * rates.neg_to_signed * rates.signed_to_joined
    : 0;
  const meanJoinedAum = rates?.mean_joined_aum ?? 0;
  const joinedDealCount = rates?.joined_deal_count ?? 0;
```

### 4e. Render the SQOTargetInput under each quarter card

Replace the `cards.map` rendering section (lines 80-92). The key change: quarter cards need the `SQOTargetInput` below them, while non-quarter cards don't.

```tsx
  return (
    <div className={`grid grid-cols-1 md:grid-cols-2 ${gridCols} gap-4`}>
      {/* Pipeline card */}
      <Card className="p-4">
        <Text>{pipelineCard.title}</Text>
        <Metric className="mt-1">{pipelineCard.value}</Metric>
        <Text className="mt-1 text-xs">{pipelineCard.subtitle}</Text>
      </Card>

      {/* Quarter cards with SQO target inputs */}
      {quarterCards.map(card => {
        // Extract quarter label from title "Expected Q2 2026 AUM" → "Q2 2026"
        const quarterMatch = card.title.match(/Expected (.+) AUM/);
        const quarter = quarterMatch ? quarterMatch[1] : '';
        return (
          <Card key={card.title} className="p-4">
            <Text>
              {card.title}
              {card.tooltip && <Tooltip text={card.tooltip} />}
            </Text>
            <Metric className="mt-1">{card.value}</Metric>
            <Text className="mt-1 text-xs">{card.subtitle}</Text>
            {quarter && (
              <SQOTargetInput
                quarter={quarter}
                currentTarget={targetAumByQuarter[quarter] ?? 0}
                meanJoinedAum={meanJoinedAum}
                sqoToJoinedRate={sqoToJoinedRate}
                joinedDealCount={joinedDealCount}
                onSave={onTargetChange}
                canEdit={canEditTargets}
              />
            )}
          </Card>
        );
      })}

      {/* Conversion window card */}
      <Card className="p-4">
        <Text>{windowCard.title}</Text>
        <Metric className="mt-1">{windowCard.value}</Metric>
        <Text className="mt-1 text-xs">{windowCard.subtitle}</Text>
      </Card>
    </div>
  );
```

### Phase 4 Validation Gate

```bash
npx tsc --noEmit
```

Expected: Build will FAIL because `page.tsx` doesn't pass the new required props yet. This is intentional — Phase 5 fixes it.

---

## Phase 5: Wire Up `page.tsx` State + Load/Save

**File:** `src/app/dashboard/forecast/page.tsx`

### 5a. Add state (after line 58, near other state declarations)

```ts
  const [targetAumByQuarter, setTargetAumByQuarter] = useState<Record<string, number>>({});
```

### 5b. Load targets on mount

Add a `loadTargets` call inside `fetchData` (line 184-203). Add it to the `Promise.all`:

```ts
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ratesRes, pipelineRes, revisionsRes, targetsRes] = await Promise.all([
        dashboardApi.getForecastRates(windowDays),
        dashboardApi.getForecastPipeline(),
        dashboardApi.getDateRevisions().catch(() => ({ revisions: {} })),
        dashboardApi.getSQOTargets().catch(() => ({ targets: {} })),
      ]);
      setRates(ratesRes.rates);
      setPipeline(pipelineRes.records);
      setSummary(pipelineRes.summary);
      setDateRevisions(revisionsRes.revisions);
      setTargetAumByQuarter(targetsRes.targets);
    } catch (err) {
      console.error('Forecast data fetch error:', err);
      setError('Failed to load forecast data');
    } finally {
      setLoading(false);
    }
  }, [windowDays]);
```

### 5c. Add save handler (near `handleRunMonteCarlo` and other handlers)

```ts
  const handleTargetChange = useCallback(async (quarter: string, targetAumDollars: number) => {
    // Optimistic update
    setTargetAumByQuarter(prev => ({ ...prev, [quarter]: targetAumDollars }));
    try {
      await dashboardApi.saveSQOTarget(quarter, targetAumDollars);
    } catch (err) {
      console.error('Failed to save SQO target:', err);
      // Revert on failure
      setTargetAumByQuarter(prev => {
        const reverted = { ...prev };
        delete reverted[quarter];
        return reverted;
      });
    }
  }, []);
```

### 5d. Update `ForecastMetricCards` JSX (line 334-338)

```tsx
// BEFORE:
          <ForecastMetricCards
            summary={adjustedSummary}
            windowDays={windowDays}
            rates={rates?.flat ?? null}
          />

// AFTER:
          <ForecastMetricCards
            summary={adjustedSummary}
            windowDays={windowDays}
            rates={rates?.flat ?? null}
            targetAumByQuarter={targetAumByQuarter}
            onTargetChange={handleTargetChange}
            canEditTargets={canRunScenarios}
          />
```

### 5e. Pass targets to export (update exportForecastToSheets call)

Find the export handler (search for `exportForecastToSheets` in page.tsx). Update it to include the targets:

```ts
// BEFORE:
  const res = await dashboardApi.exportForecastToSheets(windowDays);

// AFTER:
  const res = await dashboardApi.exportForecastToSheets(windowDays, targetAumByQuarter);
```

And update the `exportForecastToSheets` method signature in `api-client.ts` (line 1106-1115):

```ts
// BEFORE:
  exportForecastToSheets: (windowDays?: 180 | 365 | 730 | null) =>
    apiFetch<{
      success: boolean;
      spreadsheetUrl: string;
      p2RowCount: number;
      auditRowCount: number;
    }>('/api/forecast/export', {
      method: 'POST',
      body: JSON.stringify({ windowDays: windowDays ?? null }),
    }),

// AFTER:
  exportForecastToSheets: (windowDays?: 180 | 365 | 730 | null, targetAumByQuarter?: Record<string, number>) =>
    apiFetch<{
      success: boolean;
      spreadsheetUrl: string;
      p2RowCount: number;
      auditRowCount: number;
    }>('/api/forecast/export', {
      method: 'POST',
      body: JSON.stringify({ windowDays: windowDays ?? null, targetAumByQuarter: targetAumByQuarter ?? {} }),
    }),
```

### Phase 5 Validation Gate

```bash
npx tsc --noEmit
```

Expected: Build passes. The UI should now show Target AUM inputs under each quarter card, and save/load targets to/from Neon DB.

**Manual test:**
1. Load `/dashboard/forecast`
2. See quarter cards (e.g., "Expected Q2 2026 AUM")
3. Click "Set target" under a quarter card
4. Type "500" (= $500M), press Enter
5. See "~55 SQOs needed from prior quarter" appear
6. Refresh page — target persists

---

## Phase 6: Sheets Export — `BQ SQO Targets` Tab

**File:** `src/app/api/forecast/export/route.ts`

### 6a. Add tab constant (after line 19)

```ts
const SQO_TARGETS_TAB = 'BQ SQO Targets';
```

### 6b. Accept `targetAumByQuarter` from POST body (line 725-726)

```ts
// BEFORE:
    const body = await request.json().catch(() => ({}));
    const windowDays = body.windowDays as 180 | 365 | 730 | null | undefined;

// AFTER:
    const body = await request.json().catch(() => ({}));
    const windowDays = body.windowDays as 180 | 365 | 730 | null | undefined;
    const targetAumByQuarter = (body.targetAumByQuarter ?? {}) as Record<string, number>;
```

### 6c. Add `buildSQOTargetsValues` function

Add before the `POST` handler (before `export async function POST`), after the `buildRatesAndDaysValues` function:

```ts
/**
 * Build the "BQ SQO Targets" tab values.
 * For each quarter with a target, shows:
 * - Target AUM (from user input)
 * - SQO→Joined rate (formula referencing Rates tab)
 * - Mean Joined AUM (from rates)
 * - Expected AUM per SQO (computed)
 * - Required SQOs (CEILING formula)
 */
function buildSQOTargetsValues(
  targetAumByQuarter: Record<string, number>,
  tieredRates: TieredForecastRates,
): any[][] {
  const flat = tieredRates.flat;
  const sqoToJoinedRate = flat.sqo_to_sp * flat.sp_to_neg * flat.neg_to_signed * flat.signed_to_joined;
  const meanJoinedAum = flat.mean_joined_aum;
  const expectedAumPerSQO = meanJoinedAum * sqoToJoinedRate;
  const joinedDealCount = flat.joined_deal_count;

  const rows: any[][] = [
    // Header
    ['SQO TARGET CALCULATOR', '', '', '', ''],
    ['Metric', 'Value', '', 'Formula / Source'],
    [],

    // Global rates section
    ['CONVERSION RATES (from selected window)'],
    ['SQO → SP rate', flat.sqo_to_sp, '', `='${RATES_TAB}'!B6`],
    ['SP → Neg rate', flat.sp_to_neg, '', `='${RATES_TAB}'!B7`],
    ['Neg → Signed rate', flat.neg_to_signed, '', `='${RATES_TAB}'!B8`],
    ['Signed → Joined rate', flat.signed_to_joined, '', `='${RATES_TAB}'!B9`],
    ['SQO → Joined rate (product)', sqoToJoinedRate, '', '=B5*B6*B7*B8'],
    ['Mean Joined AUM ($)', meanJoinedAum, '', 'AVG(AUM) of Joined deals in window'],
    ['Joined deal count (N)', joinedDealCount, '', 'Sample size for mean AUM'],
    ['Expected AUM per SQO', expectedAumPerSQO, '', '=B10*B9 (mean AUM × SQO→Joined rate)'],
    [],
    joinedDealCount < 30
      ? ['⚠️ LOW CONFIDENCE', `Only ${joinedDealCount} joined deals in window. Mean AUM may be volatile.`]
      : [],
    [],

    // Per-quarter targets
    ['QUARTERLY TARGETS'],
    ['Quarter', 'Target AUM ($)', 'Required SQOs', 'Formula'],
  ];

  // Sort quarters chronologically
  const quarters = Object.keys(targetAumByQuarter).sort();

  if (quarters.length === 0) {
    rows.push(['(No targets set)', '', '', 'Set targets in the forecast dashboard']);
  } else {
    for (const quarter of quarters) {
      const target = targetAumByQuarter[quarter];
      const requiredSQOs = expectedAumPerSQO > 0 ? Math.ceil(target / expectedAumPerSQO) : 'N/A';
      rows.push([
        quarter,
        target,
        requiredSQOs,
        `=CEILING(B${rows.length + 1}/B12)`,
      ]);
    }
  }

  rows.push([]);
  rows.push(['METHODOLOGY']);
  rows.push([
    'Formula:',
    'Required SQOs = CEILING(Target AUM / (Mean Joined AUM × SQO→Joined rate))',
  ]);
  rows.push([
    'AUM metric:',
    'Mean of COALESCE(Underwritten_AUM__c, Amount) for Joined deals only (backtest MAE=16.5)',
  ]);
  rows.push([
    'Why mean, not median:',
    'Median overestimates by 2-3x because it ignores whale deals. Mean accounts for actual AUM variance.',
  ]);
  rows.push([
    'Caveat:',
    'SQOs need ~80 days (11 weeks) to convert. "Prior quarter" framing is approximate.',
  ]);

  return rows;
}
```

### 6d. Build and write the new tab (in POST handler, ~line 749-767)

After `const ratesValues = buildRatesAndDaysValues(auditRows.length);` add:

```ts
    const sqoTargetsValues = buildSQOTargetsValues(targetAumByQuarter, tieredRates);
```

After the last `writeTab` call (after `await writeTab(sheets, TARGET_SHEET_ID, RATES_TAB, ratesValues);`), add:

```ts
    await writeTab(sheets, TARGET_SHEET_ID, SQO_TARGETS_TAB, sqoTargetsValues);
    console.log(`[Forecast Export] SQO Targets tab written`);
```

### 6e. Add `mean_joined_aum` to the Rates tab named ranges section

In `buildRatesAndDaysValues`, add to the Named Ranges section (after line 682, the Upper tier entries):

```ts
    ['B10', 'SQO_to_Joined_rate', 'Product of all 4 flat rates — BQ SQO Targets'],
    ['B[TBD]', 'mean_joined_aum', 'Mean AUM of Joined deals — BQ SQO Targets'],
```

Note: The exact row for `mean_joined_aum` depends on where we add it in the Rates tab. Since the Rates tab currently has the product rate at B10, we should add `mean_joined_aum` as a new row in the flat rates section. Add it after the "SQO→Joined (product)" row:

In `buildRatesAndDaysValues`, find the flat rates section (the rows after `['FLAT RATES (all deals)']`). After the product rate row, add:

```ts
    [
      'Mean Joined AUM ($)',
      `=IFERROR(AVERAGEIF(${rng('AS')}, 1, '${a}'!AG2:AG${lastRow})*1000000, "N/A")`,
      '',
      '',
      'Mean of AUM (col AG, $M → $) for Joined deals (Joined Numer col AS = 1)',
    ],
```

Wait — the Rates tab currently uses SUMPRODUCT formulas referencing the Audit tab. The `mean_joined_aum` value comes from BQ, not from the audit trail. Two options:

**Option A (simpler, recommended):** Hardcode the BQ-computed value into the Rates tab and note the source. This is consistent — the rates are also BQ-computed values displayed as numbers.

Add a new section to `buildRatesAndDaysValues`, after the "Average Days in Stage" section and before the "Named Ranges" section:

```ts
    [],

    // Section 5.5: Mean Joined AUM (for SQO target calculator)
    ['MEAN JOINED AUM (for SQO Targets)'],
    ['Source', 'Value'],
    ['Mean AUM of Joined deals ($)', '(populated by BQ — see BQ SQO Targets tab)'],
```

But this doesn't give a live formula. Since the rates tab values are already BQ-pushed snapshots (not live formulas for the rates themselves), the simplest approach is to just include the `mean_joined_aum` value directly in the SQO Targets tab, which we already do in `buildSQOTargetsValues`.

**Final decision:** The SQO Targets tab is self-contained with the hardcoded BQ values. The named range reference in the methodology section tells users where the numbers come from. No changes needed to `buildRatesAndDaysValues` beyond the named range reference row.

### Phase 6 Validation Gate

```bash
npx tsc --noEmit
```

Expected: Build passes.

**Manual test:**
1. Set a target AUM on at least one quarter
2. Click the export button
3. Verify "BQ SQO Targets" tab appears in the Google Sheet
4. Verify formulas reference the correct cells

---

## Phase 7: Tests + Final Build Check

### 7a. Unit test for SQO math

**New file:** `src/lib/__tests__/sqo-target-math.test.ts`

Follow the pattern from `src/lib/__tests__/forecast-penalties.test.ts`:

```ts
/**
 * SQO Target Calculator math tests.
 * Validates the required SQOs formula against backtest data.
 */

describe('SQO Target Calculator', () => {
  const allTimeRates = {
    sqo_to_sp: 0.672,
    sp_to_neg: 0.408,
    neg_to_signed: 0.538,
    signed_to_joined: 0.942,
  };

  const sqoToJoinedRate =
    allTimeRates.sqo_to_sp *
    allTimeRates.sp_to_neg *
    allTimeRates.neg_to_signed *
    allTimeRates.signed_to_joined;

  const meanJoinedAum = 65_500_000; // $65.5M (all-time joined mean)

  test('sqoToJoinedRate computes correctly', () => {
    // 0.672 × 0.408 × 0.538 × 0.942 ≈ 0.139
    expect(sqoToJoinedRate).toBeCloseTo(0.139, 2);
  });

  test('expectedAumPerSQO = meanJoinedAum × sqoToJoinedRate', () => {
    const expected = meanJoinedAum * sqoToJoinedRate;
    // $65.5M × 0.139 ≈ $9.1M
    expect(expected / 1e6).toBeCloseTo(9.1, 0);
  });

  test('$500M target → ~55 SQOs', () => {
    const target = 500_000_000;
    const expectedAumPerSQO = meanJoinedAum * sqoToJoinedRate;
    const requiredSQOs = Math.ceil(target / expectedAumPerSQO);
    expect(requiredSQOs).toBe(55);
  });

  test('$0 target → 0 SQOs (no division by zero)', () => {
    const target = 0;
    const expectedAumPerSQO = meanJoinedAum * sqoToJoinedRate;
    const requiredSQOs = expectedAumPerSQO > 0 && target > 0
      ? Math.ceil(target / expectedAumPerSQO)
      : 0;
    expect(requiredSQOs).toBe(0);
  });

  test('zero rates → no crash', () => {
    const zeroRate = 0;
    const expectedAumPerSQO = meanJoinedAum * zeroRate;
    const requiredSQOs = expectedAumPerSQO > 0 ? Math.ceil(500_000_000 / expectedAumPerSQO) : null;
    expect(requiredSQOs).toBeNull();
  });

  // Backtest validation: joined mean predicted 67-107 SQOs vs actual 53-146
  test.each([
    ['2024-Q3', 378_000_000, 53, 67],
    ['2024-Q4', 589_000_000, 87, 85],
    ['2025-Q1', 463_000_000, 80, 65],
    ['2025-Q2', 578_000_000, 94, 83],
    ['2025-Q3', 765_000_000, 109, 91],
    ['2025-Q4', 1_320_000_000, 146, 107],
  ] as const)('backtest %s: target $%dM → %d predicted (actual %d)', (
    _quarter, targetAum, actualSQOs, expectedPrediction,
  ) => {
    const expectedAumPerSQO = meanJoinedAum * sqoToJoinedRate;
    const predicted = Math.ceil(targetAum / expectedAumPerSQO);
    // Allow ±5 tolerance due to rounding in the exploration doc rates
    expect(Math.abs(predicted - expectedPrediction)).toBeLessThanOrEqual(5);
  });
});
```

### 7b. Run all validations

```bash
npx tsc --noEmit
npm test -- --testPathPattern=sqo-target-math
npx prisma migrate status
npm run gen:api-routes
```

### 7c. Run `npx agent-guard sync` (per CLAUDE.md doc maintenance instructions)

```bash
npx agent-guard sync
```

### Phase 7 Validation Gate

All of the following must pass:
- `npx tsc --noEmit` — no type errors
- `npm test -- --testPathPattern=sqo-target-math` — all 8 tests green
- `npx prisma migrate status` — no pending migrations
- Manual: load forecast page, set target, see SQO count, refresh → persists, export → tab appears

---

## Summary of All Changed Files

| File | Change Type | Phase |
|------|------------|-------|
| `src/lib/queries/forecast-rates.ts` | Modified — add `mean_joined_aum` + `joined_deal_count` to interface, query, mapping, empty | 1 |
| `src/lib/api-client.ts` | Modified — add fields to `ForecastRatesClient`, add `getSQOTargets`/`saveSQOTarget`, update `exportForecastToSheets` signature | 1, 3, 5 |
| `prisma/schema.prisma` | Modified — add `ForecastQuarterTarget` model | 2 |
| `src/app/api/forecast/sqo-targets/route.ts` | **New** — GET + POST for quarter targets | 3 |
| `src/app/dashboard/forecast/components/ForecastMetricCards.tsx` | Modified — add target input + SQO display per quarter card | 4 |
| `src/app/dashboard/forecast/page.tsx` | Modified — add state, load/save targets, pass props | 5 |
| `src/app/api/forecast/export/route.ts` | Modified — add `SQO_TARGETS_TAB`, `buildSQOTargetsValues`, write new tab | 6 |
| `src/lib/__tests__/sqo-target-math.test.ts` | **New** — unit tests for SQO calculator math + backtest validation | 7 |
