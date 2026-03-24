# Forecast Enhancement Implementation Guide

> **Purpose:** Step-by-step guide for implementing P0 (Duration Penalty) and P1 (2-Tier AUM Rates) from the forecasting research findings.
> **Generated:** 2026-03-23 | **Updated:** 2026-03-24 (reconciled with deployed implementation)
> **Source documents:** `forecasting_research.md`, `exploration_report.md`, `agentic_implementation_guide.md`
> **Expected impact:** MAPE reduction from 156% → 28% (5.6× improvement)
> **Status:** Implemented and deployed. This document reflects the actual shipped code.

---

## Architecture Decision

**All penalty and tier logic is computed CLIENT-SIDE, not in BigQuery views.** This matches the existing pattern:
- `vw_forecast_p2` provides raw data (stage, days_in_current_stage, AUM, etc.)
- The `useMemo` in `page.tsx` applies dynamic rates from the selected window
- The Sheets export `recomputeP2WithRates` does the same server-side
- The Monte Carlo SQL computes rates inline via a new `deal_rates` CTE

**Do NOT modify `vw_forecast_p2` or `vw_funnel_audit`.** The views already provide all needed inputs.

---

## Step 0: Shared Constants & Utility

> Build this FIRST — every subsequent step depends on it.

### 0.1 Create `src/lib/forecast-config.ts`

```ts
/**
 * Duration penalty configuration derived from forecasting research (Phase 3.1).
 * Thresholds from 2yr resolved cohort avg + stddev.
 * Multipliers from empirical join rates by duration bucket.
 * Last calibrated: 2026-03-23. Recalibrate annually.
 */

// --- Duration Thresholds (days) ---
export const DURATION_THRESHOLDS: Record<string, { sd1: number; sd2: number }> = {
  'Discovery':     { sd1: 36,  sd2: 64  },
  'Qualifying':    { sd1: 36,  sd2: 64  },
  'Sales Process': { sd1: 67,  sd2: 105 },
  'Negotiating':   { sd1: 50,  sd2: 81  },
  'Signed':        { sd1: Infinity, sd2: Infinity }, // No penalty
};

// --- Duration Multipliers (applied to CURRENT STAGE rate only) ---
// multiplier_1to2sd = join_rate_1to2sd / join_rate_within_1sd
// multiplier_2plus  = join_rate_2plus  / join_rate_within_1sd
export const DURATION_MULTIPLIERS: Record<string, { within1sd: number; between1and2sd: number; over2sd: number }> = {
  'Discovery':     { within1sd: 1.0, between1and2sd: 0.667, over2sd: 0.393 },
  'Qualifying':    { within1sd: 1.0, between1and2sd: 0.667, over2sd: 0.393 },
  'Sales Process': { within1sd: 1.0, between1and2sd: 0.755, over2sd: 0.176 },
  'Negotiating':   { within1sd: 1.0, between1and2sd: 0.682, over2sd: 0.179 },
  'Signed':        { within1sd: 1.0, between1and2sd: 1.0,   over2sd: 1.0   },
};

// --- AUM Tier Boundary ---
export const AUM_TIER_BOUNDARY = 75_000_000; // $75M

// --- Tier Fallback Threshold ---
// If the Upper tier trailing cohort has fewer than this many resolved deals,
// fall back to flat (non-tiered) rates for that tier.
export const TIER_FALLBACK_MIN_COHORT = 15;

// --- Whale Deal Threshold ---
export const WHALE_AUM_THRESHOLD = 500_000_000; // $500M

// --- Duration Bucket Labels ---
export type DurationBucket = 'Within 1 SD' | '1-2 SD' | '2+ SD';

export function getDurationBucket(stage: string, daysInStage: number): DurationBucket {
  const thresholds = DURATION_THRESHOLDS[stage];
  if (!thresholds) return 'Within 1 SD';
  if (daysInStage > thresholds.sd2) return '2+ SD';
  if (daysInStage > thresholds.sd1) return '1-2 SD';
  return 'Within 1 SD';
}

export function getDurationMultiplier(stage: string, bucket: DurationBucket): number {
  const mults = DURATION_MULTIPLIERS[stage];
  if (!mults) return 1.0;
  switch (bucket) {
    case '2+ SD': return mults.over2sd;
    case '1-2 SD': return mults.between1and2sd;
    default: return mults.within1sd;
  }
}

export function getAumTier2(aumDollars: number): 'Lower' | 'Upper' {
  return aumDollars < AUM_TIER_BOUNDARY ? 'Lower' : 'Upper';
}
```

### 0.2 Create `src/lib/forecast-penalties.ts`

This is the shared utility function called from page.tsx, the export route, and conceptually replicated in the Monte Carlo SQL.

```ts
import {
  getDurationBucket,
  getDurationMultiplier,
  getAumTier2,
  TIER_FALLBACK_MIN_COHORT,
  type DurationBucket,
} from './forecast-config';

export interface TieredRates {
  flat: ForecastRateSet;
  lower: ForecastRateSet;
  upper: ForecastRateSet;
}

export interface ForecastRateSet {
  sqo_to_sp: number;
  sp_to_neg: number;
  neg_to_signed: number;
  signed_to_joined: number;
  avg_days_sqo_to_sp: number;
  avg_days_in_sp: number;
  avg_days_in_neg: number;
  avg_days_in_signed: number;
  cohort_count: number;
}

export interface AdjustedDealResult {
  tier: 'Lower' | 'Upper';
  durationBucket: DurationBucket;
  durationMultiplier: number;
  baselinePJoin: number;
  adjustedPJoin: number;
  ratesUsed: ForecastRateSet;
}

/**
 * Compute the duration-penalized, tier-adjusted P(Join) for a single deal.
 *
 * The multiplier is applied to the CURRENT STAGE rate only.
 * Subsequent stage rates are unchanged.
 *
 * Example: A Negotiating deal at 2+ SD gets:
 *   adjusted_neg_to_signed = neg_to_signed × 0.179
 *   signed_to_joined stays unchanged
 *   adjustedPJoin = adjusted_neg_to_signed × signed_to_joined
 */
export function computeAdjustedDeal(
  stage: string,
  daysInStage: number,
  aumDollars: number,
  tieredRates: TieredRates,
): AdjustedDealResult {
  const tier = getAumTier2(aumDollars);

  // Select rate set: use tiered if cohort is large enough, else flat
  const tierRates = tier === 'Lower' ? tieredRates.lower : tieredRates.upper;
  const ratesUsed = tierRates.cohort_count >= TIER_FALLBACK_MIN_COHORT
    ? tierRates
    : tieredRates.flat;

  const { sqo_to_sp, sp_to_neg, neg_to_signed, signed_to_joined } = ratesUsed;

  // Duration penalty
  const bucket = getDurationBucket(stage, daysInStage);
  const multiplier = getDurationMultiplier(stage, bucket);

  // Defensive clamp helper. Prevents NaN, negative, or >1.0 probabilities from
  // propagating if a rate or multiplier is unexpectedly null, zero, or malformed.
  // This is especially important because tiered rates from thin cohorts can produce
  // edge-case values.
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

  // Clamp the adjusted current-stage rate before using it in the product.
  // The multiplier is applied to ONE stage rate; subsequent rates are unmodified.
  const adjustedCurrentRate = (baseRate: number) => clamp01(baseRate * multiplier);

  // Baseline P(Join) — flat product of remaining stage rates (no penalty)
  let baselinePJoin = 0;
  switch (stage) {
    case 'Discovery':
    case 'Qualifying':
      baselinePJoin = sqo_to_sp * sp_to_neg * neg_to_signed * signed_to_joined;
      break;
    case 'Sales Process':
      baselinePJoin = sp_to_neg * neg_to_signed * signed_to_joined;
      break;
    case 'Negotiating':
      baselinePJoin = neg_to_signed * signed_to_joined;
      break;
    case 'Signed':
      baselinePJoin = signed_to_joined;
      break;
  }
  baselinePJoin = clamp01(baselinePJoin);

  // Adjusted P(Join) — apply multiplier to CURRENT STAGE rate only
  let adjustedPJoin = 0;
  switch (stage) {
    case 'Discovery':
    case 'Qualifying':
      adjustedPJoin = adjustedCurrentRate(sqo_to_sp) * sp_to_neg * neg_to_signed * signed_to_joined;
      break;
    case 'Sales Process':
      adjustedPJoin = adjustedCurrentRate(sp_to_neg) * neg_to_signed * signed_to_joined;
      break;
    case 'Negotiating':
      adjustedPJoin = adjustedCurrentRate(neg_to_signed) * signed_to_joined;
      break;
    case 'Signed':
      adjustedPJoin = adjustedCurrentRate(signed_to_joined); // multiplier is always 1.0 for Signed
      break;
  }
  adjustedPJoin = clamp01(adjustedPJoin);

  return {
    tier,
    durationBucket: bucket,
    durationMultiplier: multiplier,
    baselinePJoin,
    adjustedPJoin,
    ratesUsed,
  };
}
```

### 0.3 Validation Gate

Before proceeding to Step 1, verify:
- [ ] `forecast-config.ts` compiles with no errors
- [ ] `forecast-penalties.ts` compiles with no errors
- [ ] `getDurationBucket('Sales Process', 110)` returns `'2+ SD'`
- [ ] `getDurationMultiplier('Sales Process', '2+ SD')` returns `0.176`
- [ ] `getAumTier2(50_000_000)` returns `'Lower'`
- [ ] `getAumTier2(100_000_000)` returns `'Upper'`
- [ ] `computeAdjustedDeal('Negotiating', 100, 50_000_000, mockTieredRates)` produces the expected multiplier (0.179) and adjustedPJoin

### 0.4 Create Automated Parity Test

Create `src/lib/__tests__/forecast-penalties.test.ts`.

> **Test runner setup (completed):** Jest was installed (`npm install --save-dev jest ts-jest @types/jest`) and a `jest.config.js` was created with `ts-jest` preset and `moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' }` (required for `@/` path alias resolution). The `package.json` `"test"` script was changed from `node test-connection.js` to `jest`, and the old script moved to `"test:connection"`. Tests run via `npm test -- forecast-penalties`.

```ts
/**
 * Parity tests for forecast penalty logic.
 * These lock down the computeAdjustedDeal utility that drives both the UI (page.tsx useMemo)
 * and the Sheets export (recomputeP2WithRates). The Monte Carlo SQL replicates this logic
 * inline — if these tests pass but MC output diverges, the SQL constants need updating.
 *
 * When recalibrating thresholds or multipliers (annually), update BOTH forecast-config.ts
 * AND the expected values in these tests in the same PR.
 */

import { getDurationBucket, getDurationMultiplier, getAumTier2 } from '../forecast-config';
import { computeAdjustedDeal, type TieredRates } from '../forecast-penalties';

// --- Mock tiered rates (realistic values from 1yr trailing) ---
const mockRates: TieredRates = {
  flat: {
    sqo_to_sp: 0.673, sp_to_neg: 0.407, neg_to_signed: 0.505,
    signed_to_joined: 0.885, avg_days_sqo_to_sp: 5, avg_days_in_sp: 20,
    avg_days_in_neg: 10, avg_days_in_signed: 23, cohort_count: 376,
  },
  lower: {
    sqo_to_sp: 0.693, sp_to_neg: 0.442, neg_to_signed: 0.535,
    signed_to_joined: 0.949, avg_days_sqo_to_sp: 5, avg_days_in_sp: 20,
    avg_days_in_neg: 10, avg_days_in_signed: 23, cohort_count: 300,
  },
  upper: {
    sqo_to_sp: 0.608, sp_to_neg: 0.302, neg_to_signed: 0.564,
    signed_to_joined: 0.909, avg_days_sqo_to_sp: 5, avg_days_in_sp: 20,
    avg_days_in_neg: 10, avg_days_in_signed: 23, cohort_count: 76,
  },
};

// --- GROUP 1: getDurationBucket classification ---
describe('getDurationBucket', () => {
  test.each([
    ['Discovery', 30, 'Within 1 SD'],
    ['Discovery', 50, '1-2 SD'],
    ['Discovery', 100, '2+ SD'],
    ['Sales Process', 60, 'Within 1 SD'],
    ['Sales Process', 80, '1-2 SD'],
    ['Sales Process', 110, '2+ SD'],
    ['Negotiating', 40, 'Within 1 SD'],
    ['Negotiating', 60, '1-2 SD'],
    ['Negotiating', 90, '2+ SD'],
    ['Signed', 200, 'Within 1 SD'], // No penalty for Signed
  ])('(%s, %d) → %s', (stage, days, expected) => {
    expect(getDurationBucket(stage, days)).toBe(expected);
  });
});

// --- GROUP 2: getDurationMultiplier values ---
describe('getDurationMultiplier', () => {
  test.each([
    ['Discovery', 'Within 1 SD', 1.0],
    ['Discovery', '1-2 SD', 0.667],
    ['Discovery', '2+ SD', 0.393],
    ['Sales Process', '2+ SD', 0.176],
    ['Negotiating', '2+ SD', 0.179],
    ['Signed', '2+ SD', 1.0],
  ] as const)('(%s, %s) → %f', (stage, bucket, expected) => {
    expect(getDurationMultiplier(stage, bucket)).toBe(expected);
  });
});

// --- GROUP 3: getAumTier2 classification ---
describe('getAumTier2', () => {
  test.each([
    [50_000_000, 'Lower'],
    [74_999_999, 'Lower'],
    [75_000_000, 'Upper'],
    [200_000_000, 'Upper'],
  ] as const)('(%d) → %s', (aum, expected) => {
    expect(getAumTier2(aum)).toBe(expected);
  });
});

// --- GROUP 4: computeAdjustedDeal — full integration tests ---
describe('computeAdjustedDeal', () => {
  // Test A — Fresh Discovery deal, Lower tier
  test('fresh Discovery, Lower tier, within 1 SD', () => {
    const result = computeAdjustedDeal('Discovery', 10, 50_000_000, mockRates);
    expect(result.tier).toBe('Lower');
    expect(result.durationBucket).toBe('Within 1 SD');
    expect(result.durationMultiplier).toBe(1.0);
    const expectedBaseline = 0.693 * 0.442 * 0.535 * 0.949;
    expect(result.baselinePJoin).toBeCloseTo(expectedBaseline, 4);
    expect(result.adjustedPJoin).toBeCloseTo(expectedBaseline, 4); // no penalty
  });

  // Test B — Stale Sales Process deal, Lower tier, 2+ SD
  test('stale Sales Process, Lower tier, 2+ SD', () => {
    const result = computeAdjustedDeal('Sales Process', 110, 40_000_000, mockRates);
    expect(result.tier).toBe('Lower');
    expect(result.durationBucket).toBe('2+ SD');
    expect(result.durationMultiplier).toBe(0.176);
    const expectedBaseline = 0.442 * 0.535 * 0.949;
    expect(result.baselinePJoin).toBeCloseTo(expectedBaseline, 4);
    const expectedAdjusted = (0.442 * 0.176) * 0.535 * 0.949;
    expect(result.adjustedPJoin).toBeCloseTo(expectedAdjusted, 4);
  });

  // Test C — Stale Negotiating deal, Upper tier, 2+ SD
  test('stale Negotiating, Upper tier, 2+ SD', () => {
    const result = computeAdjustedDeal('Negotiating', 90, 100_000_000, mockRates);
    expect(result.tier).toBe('Upper');
    expect(result.durationBucket).toBe('2+ SD');
    expect(result.durationMultiplier).toBe(0.179);
    const expectedBaseline = 0.564 * 0.909;
    expect(result.baselinePJoin).toBeCloseTo(expectedBaseline, 4);
    const expectedAdjusted = (0.564 * 0.179) * 0.909;
    expect(result.adjustedPJoin).toBeCloseTo(expectedAdjusted, 4);
  });

  // Test D — Fresh Signed deal, Lower tier
  test('fresh Signed, Lower tier', () => {
    const result = computeAdjustedDeal('Signed', 5, 30_000_000, mockRates);
    expect(result.tier).toBe('Lower');
    expect(result.durationBucket).toBe('Within 1 SD');
    expect(result.durationMultiplier).toBe(1.0);
    expect(result.baselinePJoin).toBeCloseTo(0.949, 4);
    expect(result.adjustedPJoin).toBeCloseTo(0.949, 4);
  });

  // Test E — Edge case: 0 days in stage
  test('0 days in stage produces no penalty', () => {
    const result = computeAdjustedDeal('Discovery', 0, 50_000_000, mockRates);
    expect(result.durationBucket).toBe('Within 1 SD');
    expect(result.durationMultiplier).toBe(1.0);
    expect(result.adjustedPJoin).toBeCloseTo(result.baselinePJoin, 4);
  });

  // Test F — Edge case: Upper tier fallback to flat (thin cohort)
  test('Upper tier with thin cohort falls back to flat rates', () => {
    const thinUpperRates: TieredRates = {
      ...mockRates,
      upper: { ...mockRates.upper, cohort_count: 10 }, // below 15 threshold
    };
    const result = computeAdjustedDeal('Sales Process', 50, 100_000_000, thinUpperRates);
    expect(result.tier).toBe('Upper');
    // Should fall back to flat rates
    expect(result.ratesUsed).toBe(thinUpperRates.flat);
    const expectedBaseline = 0.407 * 0.505 * 0.885; // flat rates
    expect(result.baselinePJoin).toBeCloseTo(expectedBaseline, 4);
  });
});

// --- GROUP 5: Boundary and safety checks ---
describe('safety checks', () => {
  const stages = ['Discovery', 'Qualifying', 'Sales Process', 'Negotiating', 'Signed'];
  const dayValues = [0, 10, 50, 100, 200, 500];
  const aumValues = [10_000_000, 74_999_999, 75_000_000, 500_000_000];

  test('no result ever has adjustedPJoin < 0 or > 1', () => {
    for (const stage of stages) {
      for (const days of dayValues) {
        for (const aum of aumValues) {
          const r = computeAdjustedDeal(stage, days, aum, mockRates);
          expect(r.adjustedPJoin).toBeGreaterThanOrEqual(0);
          expect(r.adjustedPJoin).toBeLessThanOrEqual(1);
          expect(r.baselinePJoin).toBeGreaterThanOrEqual(0);
          expect(r.baselinePJoin).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  test('unknown stage name produces adjustedPJoin = 0', () => {
    const r = computeAdjustedDeal('On Hold', 10, 50_000_000, mockRates);
    expect(r.adjustedPJoin).toBe(0);
    expect(r.baselinePJoin).toBe(0);
  });
});
```

Run with `npm test -- forecast-penalties` (or equivalent for your test runner). These tests should run as part of the standard build/CI pipeline. If they fail, the build should block.

---

## Step 1: Extend `getForecastRates` for Tiered Rates

### 1.1 Add `getTieredForecastRates` to `src/lib/queries/forecast-rates.ts`

**What was done:** The original `getForecastRates` (returning flat `ForecastRates`) was **kept intact** for backward compatibility — it is still used by the export and MC routes during transition. A new `getTieredForecastRates` function was added alongside it, returning `TieredForecastRates`.

**Implementation details:**
- A shared `RATES_SELECT` SQL fragment was extracted to avoid duplicating the rate computation SQL
- A `mapRawToForecastRates` helper maps raw BQ rows to the `ForecastRates` interface
- An `EMPTY_RATES` constant provides a zero-value fallback for missing tiers
- A `RawTieredRatesResult` interface extends `RawRatesResult` with a `tier_label` field
- The query uses `UNION ALL` to produce 3 rows (flat, Lower, Upper), each with a `tier_label` column
- The cohort CTE adds `CASE WHEN COALESCE(Underwritten_AUM__c, Amount) < 75000000 THEN 'Lower' ELSE 'Upper' END AS aum_tier_2`
- Cached with `cachedQuery` at 12-hour TTL (same as the original)

**Type architecture note:** Two parallel tiered-rate interfaces exist:
- `TieredForecastRates` in `forecast-rates.ts` — uses `ForecastRates` members (includes `window_start`, `window_end`, `cohort_count`)
- `TieredRates` in `forecast-penalties.ts` — uses `ForecastRateSet` members (omits `window_start`, `window_end`)

These are structurally compatible: `ForecastRates` is a superset of `ForecastRateSet`, so passing `TieredForecastRates` where `TieredRates` is expected works via TypeScript structural typing. The `computeAdjustedDeal` function accepts `TieredRates` and only reads the rate + cohort_count fields.

```ts
export interface TieredForecastRates {
  flat: ForecastRates;
  lower: ForecastRates;
  upper: ForecastRates;
}
```

### 1.2 Update the API route `src/app/api/forecast/rates/route.ts`

Change the response shape from `{ rates: ForecastRates }` to `{ rates: TieredForecastRates }`.

### 1.3 Update `src/lib/api-client.ts`

Added `TieredForecastRatesClient` interface (mirror of server-side `TieredForecastRates`). Updated `getForecastRates` method return type to `{ rates: TieredForecastRatesClient }`. Also added optional `durationBucket`, `durationMultiplier`, `aumTier2` fields to `MonteCarloResponseClient.perOpp` to match the enriched per-opp data from Step 3.5.

The `ForecastPipelineRecordClient` was NOT changed — duration penalty fields (`durationBucket`, `durationMultiplier`, `baselinePJoin`, etc.) are computed client-side in the `useMemo`, not returned by the API.

### 1.4 Validation Gate

- [ ] The rates API returns `{ rates: { flat: {...}, lower: {...}, upper: {...} } }`
- [ ] `flat.cohort_count` matches the current production value
- [ ] `lower.cohort_count + upper.cohort_count` ≈ `flat.cohort_count` (may differ slightly due to NULL AUM deals)
- [ ] `upper.sp_to_neg` is approximately half of `lower.sp_to_neg` (the key tier discriminator from Phase 5)
- [ ] When Upper tier `cohort_count < 15`, the frontend should fall back to flat rates (test with 180d window on early cohorts)

---

## Step 2: Update page.tsx `useMemo` (Primary P(Join) Computation)

### 2.1 Update the `useMemo` in `src/app/dashboard/forecast/page.tsx`

**Additional plumbing changes (done in Step 1 alongside the rates refactor):**
- State type changed from `ForecastRates | null` to `TieredForecastRates | null`
- Import changed from `ForecastRates` to `TieredForecastRates` (plus new `computeAdjustedDeal` import)
- Child components that expect flat `ForecastRates | null` now receive `rates?.flat ?? null`:
  - `ForecastMetricCards rates={rates?.flat ?? null}`
  - `ConversionRatesPanel rates={rates?.flat ?? null}`
  - `ScenarioRunner rates={rates?.flat ?? null}`
- The `useMemo` destructures avg_days from `rates.flat` (timing doesn't vary by tier)

**P(Join) computation logic:** For each record:
1. Call `computeAdjustedDeal(r.StageName, r.days_in_current_stage, aumRaw, tieredRates)` where `aumRaw = r.Opportunity_AUM_M * 1e6`
2. Use `deal.adjustedPJoin` as the new `p_join`
3. Add `durationBucket`, `durationMultiplier`, `baselinePJoin`, `aumTier2` (mapped from `deal.tier`) to the adjusted record
4. Compute `baselineExpectedAum = r.is_zero_aum ? 0 : aumRaw * deal.baselinePJoin`
5. Compute `expectedAum = r.is_zero_aum ? 0 : aumRaw * deal.adjustedPJoin` (this replaces the old `expectedAum`)

### 2.2 Extend the `ForecastPipelineRecord` interface

**File:** `src/lib/queries/forecast-pipeline.ts` (line 16)

Add these fields to the interface:

```ts
// Duration penalty fields (computed client-side, not from BQ)
durationBucket?: DurationBucket;
durationMultiplier?: number;
baselinePJoin?: number;
baselineExpectedAum?: number;
aumTier2?: 'Lower' | 'Upper';
```

These are optional (`?`) because the raw BQ data doesn't have them — they're populated by the `useMemo`.

### 2.3 Update the summary computation

The `adjustedSummary` object (which feeds `ForecastMetricCards`) sums `expected_aum_weighted` by quarter. Since the `useMemo` now sets `expected_aum_weighted` to the adjusted value, the summary automatically uses duration-penalized values. No separate change needed for the summary.

### 2.4 Validation Gate

- [ ] Build succeeds (`npm run build`)
- [ ] The forecast page loads without errors
- [ ] A stale Sales Process deal (>105 days) shows a lower P(Join) than a fresh one at the same stage
- [ ] The duration bucket badge appears in the pipeline table (added in Step 4)
- [ ] Total expected AUM per quarter is lower than before (due to penalties on stale deals)
- [ ] Verify the product property: for any deal, `adjustedPJoin` should equal the product of (current stage rate × multiplier) × subsequent stage rates

---

## Step 3: Update Monte Carlo SQL

### 3.1 Add `deal_rates` CTE to `src/lib/queries/forecast-monte-carlo.ts`

**Current CTE chain:** `open_pipeline` → `trials` → `simulation`

**New CTE chain:** `open_pipeline` → `deal_rates` → `trials` → `simulation`

The `deal_rates` CTE computes per-deal adjusted rates from `days_in_current_stage` and AUM tier. Insert it between `open_pipeline` and `trials`.

**AUM parity note:** The `open_pipeline` CTE already defines `Opportunity_AUM` as `COALESCE(Underwritten_AUM__c, Amount)`. The tier check below uses `o.Opportunity_AUM` — which is that same COALESCE result. This must match the client-side computation in page.tsx, which uses `r.Opportunity_AUM_M * 1e6` (where `Opportunity_AUM_M` comes from `vw_forecast_p2`'s `Opportunity_AUM / 1e6`). Both ultimately derive from `COALESCE(Underwritten_AUM__c, Amount)`, so they are equivalent. **Verify this parity during Step 3 validation** — pick 2-3 deals near the $75M boundary and confirm they land in the same tier in both the Monte Carlo SQL and the client-side useMemo.

```sql
deal_rates AS (
  SELECT
    o.opp_id,
    o.StageName,
    o.Opportunity_AUM,  -- = COALESCE(Underwritten_AUM__c, Amount) from open_pipeline
    o.is_zero_aum,
    o.Earliest_Anticipated_Start_Date__c,
    o.current_stage_entry_ts,
    o.days_in_current_stage,

    -- AUM tier (uses o.Opportunity_AUM which is already COALESCE(Underwritten_AUM__c, Amount))
    CASE WHEN o.Opportunity_AUM < 75000000 THEN 'Lower' ELSE 'Upper' END AS aum_tier_2,

    -- Duration bucket
    CASE o.StageName
      WHEN 'Discovery' THEN CASE
        WHEN o.days_in_current_stage > 64 THEN '2+ SD'
        WHEN o.days_in_current_stage > 36 THEN '1-2 SD'
        ELSE 'Within 1 SD' END
      WHEN 'Qualifying' THEN CASE
        WHEN o.days_in_current_stage > 64 THEN '2+ SD'
        WHEN o.days_in_current_stage > 36 THEN '1-2 SD'
        ELSE 'Within 1 SD' END
      WHEN 'Sales Process' THEN CASE
        WHEN o.days_in_current_stage > 105 THEN '2+ SD'
        WHEN o.days_in_current_stage > 67 THEN '1-2 SD'
        ELSE 'Within 1 SD' END
      WHEN 'Negotiating' THEN CASE
        WHEN o.days_in_current_stage > 81 THEN '2+ SD'
        WHEN o.days_in_current_stage > 50 THEN '1-2 SD'
        ELSE 'Within 1 SD' END
      ELSE 'Within 1 SD'
    END AS duration_bucket,

    -- Duration multiplier (applied to CURRENT stage rate only)
    CASE o.StageName
      WHEN 'Discovery' THEN CASE
        WHEN o.days_in_current_stage > 64 THEN 0.393
        WHEN o.days_in_current_stage > 36 THEN 0.667
        ELSE 1.0 END
      WHEN 'Qualifying' THEN CASE
        WHEN o.days_in_current_stage > 64 THEN 0.393
        WHEN o.days_in_current_stage > 36 THEN 0.667
        ELSE 1.0 END
      WHEN 'Sales Process' THEN CASE
        WHEN o.days_in_current_stage > 105 THEN 0.176
        WHEN o.days_in_current_stage > 67 THEN 0.755
        ELSE 1.0 END
      WHEN 'Negotiating' THEN CASE
        WHEN o.days_in_current_stage > 81 THEN 0.179
        WHEN o.days_in_current_stage > 50 THEN 0.682
        ELSE 1.0 END
      ELSE 1.0
    END AS duration_multiplier,

    -- Per-deal adjusted rates
    -- Current stage rate is multiplied by the duration multiplier
    -- Subsequent stage rates use the tier-appropriate base rate
    -- Tiered rates are passed as parameters: @rate_lower_* and @rate_upper_*
    -- Fall back to flat @rate_* when tier cohort is small (handled by caller setting tier params = flat params)
    CASE WHEN o.Opportunity_AUM < 75000000
      THEN @rate_lower_sqo_sp ELSE @rate_upper_sqo_sp END AS base_sqo_sp,
    CASE WHEN o.Opportunity_AUM < 75000000
      THEN @rate_lower_sp_neg ELSE @rate_upper_sp_neg END AS base_sp_neg,
    CASE WHEN o.Opportunity_AUM < 75000000
      THEN @rate_lower_neg_signed ELSE @rate_upper_neg_signed END AS base_neg_signed,
    CASE WHEN o.Opportunity_AUM < 75000000
      THEN @rate_lower_signed_joined ELSE @rate_upper_signed_joined END AS base_signed_joined,

    -- Adjusted current-stage rate (base × multiplier), clamped to [0, 1]
    -- Defensive clamp via GREATEST/LEAST. Prevents out-of-range probabilities from
    -- propagating if a tiered rate from a thin cohort produces an edge-case value.
    GREATEST(0, LEAST(1,
      CASE o.StageName
        WHEN 'Discovery' THEN
          CASE WHEN o.Opportunity_AUM < 75000000 THEN @rate_lower_sqo_sp ELSE @rate_upper_sqo_sp END
          * CASE WHEN o.days_in_current_stage > 64 THEN 0.393
                 WHEN o.days_in_current_stage > 36 THEN 0.667 ELSE 1.0 END
        WHEN 'Qualifying' THEN
          CASE WHEN o.Opportunity_AUM < 75000000 THEN @rate_lower_sqo_sp ELSE @rate_upper_sqo_sp END
          * CASE WHEN o.days_in_current_stage > 64 THEN 0.393
                 WHEN o.days_in_current_stage > 36 THEN 0.667 ELSE 1.0 END
        WHEN 'Sales Process' THEN
          CASE WHEN o.Opportunity_AUM < 75000000 THEN @rate_lower_sp_neg ELSE @rate_upper_sp_neg END
          * CASE WHEN o.days_in_current_stage > 105 THEN 0.176
                 WHEN o.days_in_current_stage > 67 THEN 0.755 ELSE 1.0 END
        WHEN 'Negotiating' THEN
          CASE WHEN o.Opportunity_AUM < 75000000 THEN @rate_lower_neg_signed ELSE @rate_upper_neg_signed END
          * CASE WHEN o.days_in_current_stage > 81 THEN 0.179
                 WHEN o.days_in_current_stage > 50 THEN 0.682 ELSE 1.0 END
        WHEN 'Signed' THEN
          CASE WHEN o.Opportunity_AUM < 75000000 THEN @rate_lower_signed_joined ELSE @rate_upper_signed_joined END
      END
    )) AS adjusted_current_rate
  FROM open_pipeline o
)
```

### 3.2 Update the `simulation` CTE Bernoulli draws

Replace the global `@rate_*` params with per-deal rates from `deal_rates`:

```sql
simulation AS (
  SELECT
    dr.opp_id,
    dr.StageName,
    dr.Opportunity_AUM,
    dr.is_zero_aum,
    dr.duration_bucket,
    dr.duration_multiplier,
    dr.aum_tier_2,
    t.trial_id,
    CASE
      WHEN dr.StageName IN ('Discovery', 'Qualifying')
      THEN (CASE WHEN RAND() < dr.adjusted_current_rate THEN 1 ELSE 0 END)  -- penalized SQO→SP
           * (CASE WHEN RAND() < dr.base_sp_neg THEN 1 ELSE 0 END)
           * (CASE WHEN RAND() < dr.base_neg_signed THEN 1 ELSE 0 END)
           * (CASE WHEN RAND() < dr.base_signed_joined THEN 1 ELSE 0 END)
      WHEN dr.StageName = 'Sales Process'
      THEN (CASE WHEN RAND() < dr.adjusted_current_rate THEN 1 ELSE 0 END)  -- penalized SP→Neg
           * (CASE WHEN RAND() < dr.base_neg_signed THEN 1 ELSE 0 END)
           * (CASE WHEN RAND() < dr.base_signed_joined THEN 1 ELSE 0 END)
      WHEN dr.StageName = 'Negotiating'
      THEN (CASE WHEN RAND() < dr.adjusted_current_rate THEN 1 ELSE 0 END)  -- penalized Neg→Signed
           * (CASE WHEN RAND() < dr.base_signed_joined THEN 1 ELSE 0 END)
      WHEN dr.StageName = 'Signed'
      THEN (CASE WHEN RAND() < dr.adjusted_current_rate THEN 1 ELSE 0 END)  -- Signed→Joined (mult=1.0)
      ELSE 0
    END AS joined_in_trial,
    -- projected_join_date logic stays the same (uses dr.* fields)
    ...
  FROM deal_rates dr
  CROSS JOIN trials t
)
```

### 3.3 Update the `runMonteCarlo` function signature

**File:** `src/lib/queries/forecast-monte-carlo.ts`

The function currently accepts `(rates: ForecastRates, avgDays: AvgDays)`. Change to:

```ts
export async function runMonteCarlo(
  tieredRates: TieredForecastRates,
  avgDays: AvgDays
): Promise<MonteCarloResponse>
```

Pass 8 rate parameters instead of 4:
- `@rate_lower_sqo_sp`, `@rate_lower_sp_neg`, `@rate_lower_neg_signed`, `@rate_lower_signed_joined`
- `@rate_upper_sqo_sp`, `@rate_upper_sp_neg`, `@rate_upper_neg_signed`, `@rate_upper_signed_joined`

When the Upper tier cohort is below the fallback threshold, the caller sets `@rate_upper_*` = `@rate_flat_*` (the flat values), so the SQL doesn't need fallback logic.

### 3.4 Update the API route `src/app/api/forecast/monte-carlo/route.ts`

- Switched from `getForecastRates` to `getTieredForecastRates`
- **Tier fallback** is applied inside `runMonteCarlo` (not in the route): both lower and upper tiers are checked against `TIER_FALLBACK_MIN_COHORT` and fall back to flat if below threshold
- `avgDays` defaults to `tieredRates.flat` avg_days (timing doesn't vary by tier), overridable via `body.avgDays`
- **ScenarioRunner compatibility (V1 solution):** When `body.conversionRates` is provided (manual rate overrides from the ScenarioRunner), all three tiers (flat, lower, upper) are set to the override values uniformly. This ensures the ScenarioRunner still works with flat overrides while the MC SQL expects tiered params. The override rate set inherits `avg_days_*`, `cohort_count`, and `window_*` from `tieredRates.flat` so the type is satisfied.

### 3.5 Update per-opp query output

Add `duration_bucket`, `duration_multiplier`, and `aum_tier_2` to the per-opp query output so they're available in the drilldown.

### 3.6 Validation Gate

- [ ] Monte Carlo simulation runs without BQ errors (test with `npm run dev` and triggering a simulation)
- [ ] Per-opp `win_pct` for stale deals (2+ SD) is visibly lower than fresh deals at the same stage
- [ ] Aggregate P10/P50/P90 values are lower than before (penalties reduce expected AUM)
- [ ] A stale SP deal (>105 days) should have `win_pct` approximately `0.176×` the win_pct of a fresh SP deal
- [ ] Simulation completes within 60 seconds (the `deal_rates` CTE adds negligible cost)
- [ ] **AUM tier parity check:** Pick 2-3 deals near the $75M boundary. Confirm they land in the same tier (`Lower` vs `Upper`) in BOTH the Monte Carlo SQL output (from `deal_rates.aum_tier_2`) AND the client-side PipelineDetailTable (from the useMemo's `getAumTier2(r.Opportunity_AUM_M * 1e6)`). Both paths derive AUM from `COALESCE(Underwritten_AUM__c, Amount)`, but verify there are no rounding or field-mapping mismatches (e.g., `Opportunity_AUM` in the MC SQL vs `Opportunity_AUM_M * 1e6` on the client)

---

## Step 4: UI Changes

### 4.1 PipelineDetailTable — Add Duration Bucket column

**File:** `src/app/dashboard/forecast/components/PipelineDetailTable.tsx`

- Add `'durationBucket'` to the `SortField` union type (line 21)
- Add a new `<th>` column header: "Duration" (between Days and Proj. Join, or at the end)
- Add a new `<td>` cell rendering a colored badge:
  - `Within 1 SD` → green or no badge (default/normal)
  - `1-2 SD` → yellow/amber badge
  - `2+ SD` → red badge
- The field `r.durationBucket` is populated by the `useMemo` (Step 2)

### 4.2 MonteCarloPanel — Add Duration Bucket to drilldown

**File:** `src/app/dashboard/forecast/components/MonteCarloPanel.tsx`

- Added "Duration" column to drilldown table header (after "Stage")
- Added the duration badge to each drilldown row (same styling as PipelineDetailTable)
- Updated `colSpan` to `12` on all separator `<td>` elements (12 columns total: #, Advisor, Stage, Duration, AUM if Won, Won in, Expected AUM, Proj. Join, P10, P50, P90, Running Total)
- Added to CSV export: `Duration Bucket`, `Duration Multiplier`, `AUM Tier (2-tier)`, `Baseline P(Join)`

**Additional drilldown fixes (post-implementation):**

- **Cumulative AUM fix:** The drilldown's running total was changed from accumulating `rawAum` to `expectedAum` (`winPct × rawAum`). The P10/P50/P90 targets are probability-weighted simulation outputs, so the cumulative must also be probability-weighted for the "in scenario" comparison to be meaningful. Without this fix, raw AUM cumulative for a single large deal would immediately exceed the P10 target, making the "in scenario" line useless for bear cases.

- **Bear-case top separator:** When no deals satisfy `inScenario` (common for P10 where the target is lower than any single deal's expected AUM), a red dashed line renders at the TOP of the table with the label: `"{scenario} target: {amount} — bear case: few deals close"`. All deals appear below the line at reduced opacity. This communicates that in the bear case, most of these deals don't close — the $XM P10 target comes from random small subsets across different trials, not from any identifiable deal combination.

### 4.3 ConversionRatesPanel — Show tier info (optional enhancement)

**File:** `src/app/dashboard/forecast/components/ConversionRatesPanel.tsx`

Consider showing both Lower and Upper tier rates side-by-side, or adding a "Rates shown for: Lower tier / Upper tier" toggle. This is a P3-level enhancement — not required for V1.

### 4.4 Validation Gate

- [ ] Duration bucket badges render correctly in the pipeline table
- [ ] Stale deals show red badges; fresh deals show green or no badge
- [ ] Drilldown table includes the Duration column
- [ ] CSV export from drilldown includes Duration Bucket and Duration Multiplier columns
- [ ] No layout/alignment issues in the table (check responsive behavior)

---

## Step 5: Google Sheets Export Enhancement

### 5.1 Update `recomputeP2WithRates` in `src/app/api/forecast/export/route.ts`

**Current (lines 131-202):** Takes `(rows, rates)` where `rates` is flat `ForecastRates`.

**New:** Takes `(rows: ForecastExportP2Row[], tieredRates: TieredForecastRates)`. For each row:
1. Call `computeAdjustedDeal(r.StageName, r.days_in_current_stage, r.Opportunity_AUM, tieredRates)`
2. Set `r.p_join = deal.adjustedPJoin` (the existing P(Join) column now uses the adjusted value)
3. Add new fields to the row: `durationBucket`, `durationMultiplier`, `baselinePJoin`, `adjustedPJoin`, `aumTier2`
4. Recompute `expected_aum_weighted = r.is_zero_aum ? 0 : r.Opportunity_AUM * deal.adjustedPJoin`
5. Recompute per-stage display rates (`rate_sqo_to_sp`, `rate_sp_to_neg`, `rate_neg_to_signed`, `rate_signed_to_joined`) from the **tier-selected** rate set (`deal.ratesUsed`), not from flat rates — so the rate columns in the Sheets export reflect the tier-appropriate values

The `ForecastExportP2Row` interface in `forecast-export.ts` was extended with optional fields: `aumTier2`, `durationBucket`, `durationMultiplier`, `baselinePJoin`, `adjustedPJoin`.

### 5.2 Add new columns to the P2 header row

**File:** `src/app/api/forecast/export/route.ts`, `buildP2Values` function (line 215)

Append 7 new columns after column X (Expected AUM):

| New Col | Header | Value |
|---------|--------|-------|
| Y | AUM Tier (2-tier) | `r.aumTier2` — `'Lower (< $75M)'` or `'Upper (≥ $75M)'` |
| Z | Duration Bucket | `r.durationBucket` — `'Within 1 SD'`, `'1-2 SD'`, `'2+ SD'` |
| AA | Duration Multiplier | `r.durationMultiplier` — e.g., `0.176` |
| AB | Baseline P(Join) | `r.baselinePJoin` — flat rate P(Join) before penalty |
| AC | Adjusted P(Join) | `r.adjustedPJoin` — after tier + duration adjustment |
| AD | Baseline Expected AUM | Sheets formula: `=IF(AND(W{row}<>"",J{row}="NO"),G{row}*AB{row},0)` |
| AE | Adjusted Expected AUM | Sheets formula: `=IF(AND(W{row}<>"",J{row}="NO"),G{row}*AC{row},0)` |

**Critical:** Append after X. Do NOT insert before X — this would break the hardcoded column letter references in existing Sheets formulas (H, Q, X).

### 5.3 Update the export POST route

**File:** `src/app/api/forecast/export/route.ts`

Change the `getForecastRates(windowDays)` call to use the new tiered rates shape. Pass `tieredRates` to `recomputeP2WithRates`.

### 5.4 Validation Gate

- [ ] Export runs without errors
- [ ] The Google Sheet has columns Y-AE populated
- [ ] Existing columns A-X are unchanged (no formula breakage)
- [ ] A stale deal's "Adjusted P(Join)" (col AC) < "Baseline P(Join)" (col AB)
- [ ] "Adjusted Expected AUM" (col AE) < "Baseline Expected AUM" (col AD) for stale deals
- [ ] Fresh deals have identical Baseline and Adjusted values

---

## Step 5.5: Parity Tests (Mandatory Before Merge)

The automated test file at `src/lib/__tests__/forecast-penalties.test.ts` (created in Step 0.4) covers the TypeScript utility, which drives both the UI and Sheets export code paths. Those tests run automatically on every build. The manual verification below focuses on the **Monte Carlo SQL path**, which cannot be covered by unit tests because it replicates the logic in BigQuery SQL. The manual check confirms the SQL constants match the TypeScript constants.

The duration penalty and tiered rate logic is implemented in 3 separate code paths:
1. **Client-side useMemo** (`page.tsx`) — drives the UI display
2. **Server-side `recomputeP2WithRates`** (`export/route.ts`) — drives the Sheets export
3. **Monte Carlo SQL `deal_rates` CTE** (`forecast-monte-carlo.ts`) — drives the simulation

These MUST produce the same P(Join) for the same deal with the same rate inputs. Drift between them is the highest-risk bug in this implementation.

### Test procedure

**1. Pick 4 specific current pipeline deals:**

| # | Profile | Stage | AUM Tier | Duration Bucket |
|---|---------|-------|----------|-----------------|
| A | Fresh small deal | Discovery | Lower (< $75M) | Within 1 SD |
| B | Stale mid-funnel deal | Sales Process | Lower (< $75M) | 2+ SD (>105 days) |
| C | Stale late-funnel whale | Negotiating | Upper (≥ $75M) | 2+ SD (>81 days) |
| D | Fresh Signed deal | Signed | Any | Within 1 SD |

Use actual deals from the current pipeline. Record their `Full_Opportunity_ID__c`, `advisor_name`, `days_in_current_stage`, and `Opportunity_AUM`.

**2. For each deal, using the same 1yr trailing tiered rates, manually compute:**

| Field | Deal A | Deal B | Deal C | Deal D |
|-------|--------|--------|--------|--------|
| Opp ID | _fill in_ | _fill in_ | _fill in_ | _fill in_ |
| Advisor | _fill in_ | _fill in_ | _fill in_ | _fill in_ |
| AUM | _fill in_ | _fill in_ | _fill in_ | _fill in_ |
| Days in Stage | _fill in_ | _fill in_ | _fill in_ | _fill in_ |
| Expected Tier | Lower | Lower | Upper | _fill in_ |
| Expected Duration Bucket | Within 1 SD | 2+ SD | 2+ SD | Within 1 SD |
| Expected Duration Multiplier | 1.0 | 0.176 | 0.179 | 1.0 |
| Expected Baseline P(Join) | _compute_ | _compute_ | _compute_ | _compute_ |
| Expected Adjusted P(Join) | _compute_ | _compute_ | _compute_ | _compute_ |

**3. Verify across all 3 code paths:**

| Code Path | How to Check | Tolerance |
|-----------|-------------|-----------|
| UI (`page.tsx` useMemo) | Browser dev tools or temporary `console.log` — check `adjustedPJoin` for the deal's `Full_Opportunity_ID__c` | Exact match |
| Sheets export (`recomputeP2WithRates`) | Export to Sheets, read col AC (Adjusted P(Join)) for the deal | Exact match |
| Monte Carlo (`deal_rates` CTE) | Check per-opp query output `win_pct` for the deal | ±2pp (sampling noise at 5,000 trials) |

**4. Record actual results:**

| Code Path | Deal A | Deal B | Deal C | Deal D |
|-----------|--------|--------|--------|--------|
| Manual expected | _fill in_ | _fill in_ | _fill in_ | _fill in_ |
| UI (page.tsx) | _fill in_ | _fill in_ | _fill in_ | _fill in_ |
| Sheets export | _fill in_ | _fill in_ | _fill in_ | _fill in_ |
| Monte Carlo win_pct | _fill in_ | _fill in_ | _fill in_ | _fill in_ |
| Match? | _Y/N_ | _Y/N_ | _Y/N_ | _Y/N_ |

### 5.5 Validation Gate

- [ ] `npm test -- forecast-penalties` passes (all automated parity tests green)
- [ ] All 4 deals match across UI, export, and Monte Carlo within tolerance
- [ ] No deal shows adjusted P(Join) < 0 or > 1.0 in any code path
- [ ] A deal with 0 days in stage shows `durationMultiplier = 1.0` and `adjustedPJoin = baselinePJoin`

**If any parity check fails, debug and fix BEFORE proceeding to Step 6.**

---

## Step 6: Documentation Sync

### 6.1 Update `agentic_implementation_guide.md`

Add a new section documenting:
- Duration penalty methodology (thresholds, multipliers, application logic)
- 2-tier AUM rate structure
- Where the penalty is computed (client-side, not BQ view)
- The shared utility function pattern

### 6.2 Run generators

```bash
npm run gen:api-routes
npx agent-guard sync
```

### 6.3 Write `.ai-session-context.md` before committing

---

## Step 7: Shadow Mode Rollout

The adjusted model should run alongside baseline values for at least one full quarter before the baseline columns are removed from the Sheets export.

### How this works (no extra infrastructure needed)

1. **The Sheets export already shows both baseline and adjusted values side by side:**
   - Col AB: Baseline P(Join)
   - Col AC: Adjusted P(Join)
   - Col AD: Baseline Expected AUM
   - Col AE: Adjusted Expected AUM

2. **The UI metric cards and pipeline table show the ADJUSTED values as primary** (this is the new model).

3. **For the first full quarter after launch (e.g., Q2 2026):**
   - Export the sheet at the **START** of the quarter (snapshot of pipeline + predictions)
   - At the **END** of the quarter, compare:
     - Sum of Adjusted Expected AUM (col AE) for deals projected to that quarter vs actual joined AUM
     - Sum of Baseline Expected AUM (col AD) for the same deals vs actual joined AUM
   - The adjusted model should have a smaller error than baseline. If it doesn't, investigate before the next quarter.

4. **After one quarter of confirmed improvement**, the baseline columns (AB, AD) can optionally be removed from the export to reduce clutter. Keep the adjusted columns (AC, AE) as the canonical values.

5. **Log the comparison result** in `forecasting_research.md` under a new "Post-Launch Validation" section for the team's reference.

This is NOT a parallel production system. It's a simple before/after comparison using columns that already exist in the Sheets export. No extra code needed — just discipline to check the sheet at quarter boundaries.

---

## Implementation Checklist Summary

| Step | Component | Files Modified | Risk | Status |
|------|-----------|---------------|------|--------|
| 0.1 | Constants file | `src/lib/forecast-config.ts` (NEW) | Low | Done |
| 0.2 | Utility function | `src/lib/forecast-penalties.ts` (NEW) | Low | Done |
| 0.4 | Automated parity tests | `src/lib/__tests__/forecast-penalties.test.ts` (NEW), `jest.config.js` (NEW), `package.json` | Low | Done (28 tests) |
| 1.1 | Tiered rates query | `src/lib/queries/forecast-rates.ts` (added `getTieredForecastRates`, kept original) | Medium | Done |
| 1.2 | Rates API route | `src/app/api/forecast/rates/route.ts` | Low | Done |
| 1.3 | Client types | `src/lib/api-client.ts` | Low | Done |
| 2.1 | Page useMemo + state | `src/app/dashboard/forecast/page.tsx` | Medium | Done |
| 2.2 | Pipeline record type | `src/lib/queries/forecast-pipeline.ts`, `src/lib/queries/forecast-export.ts` | Low | Done |
| 3.1-3.5 | Monte Carlo SQL + route | `src/lib/queries/forecast-monte-carlo.ts`, `src/app/api/forecast/monte-carlo/route.ts` | **High** | Done |
| 4.1 | Pipeline table | `PipelineDetailTable.tsx` | Low | Done |
| 4.2 | MC drilldown + fixes | `MonteCarloPanel.tsx` (duration col, bear-case line, cumulative fix) | Medium | Done |
| 5.1-5.3 | Sheets export | `src/app/api/forecast/export/route.ts` | Medium | Done |
| 5.5 | Parity audit | Code-level audit (all 3 paths match) | **Medium** | Done |
| 6 | Docs | This guide (reconciled 2026-03-24) | Low | Done |
| 7 | Shadow mode rollout | None (process — Sheets comparison at quarter boundary) | Low | Pending |

**Total files modified:** 10 files + 3 new files
**New files:** `src/lib/forecast-config.ts`, `src/lib/forecast-penalties.ts`, `src/lib/__tests__/forecast-penalties.test.ts`, `jest.config.js`
**No BigQuery view changes required.**

---

## Known V1 Limitations

1. **On Hold clock contamination:** 2 of 24 stale deals have On Hold history that inflates their `days_in_current_stage`. V2 enhancement: subtract On Hold duration when `Stage_Entered_On_Hold__c IS NOT NULL`.

2. **Signed penalty not applied:** Insufficient data (N=9, N=6 in over-SD buckets). Multiplier is 1.0 for all Signed deals. Revisit when more Signed deals resolve.

3. **Upper tier Signed→Joined = 100%** at most snapshots (denominators of 1-5). This rate is noise, not signal. The fallback to flat rates partially mitigates.

4. **AUM lookahead in `vw_forecast_p2`:** `Amount` and `Underwritten_AUM__c` are current-state values. The AUM used for tier classification may differ from what existed when the deal entered its current stage. Impact is small (Phase 7.4: median Underwritten/Amount ratio = 1.00×).

5. **Scenario Runner compatibility (resolved in V1):** The MC API route collapses all three tiers to the override values when the ScenarioRunner sends custom rates. This means manual overrides bypass tier differentiation and duration penalties still apply (since those are computed from deal-level fields in the `deal_rates` CTE, not from the rate parameters). V2 enhancement: allow scenario overrides to include duration penalty on/off toggle.

6. **Anticipated date reliability:** Post-implementation analysis (`anticipated_start_date_exploration.md`) found that the first recruiter anticipated date overshoots by +18 days on average (not the +2 days Phase 7.1 reported for the final date). Deals with 3+ date revisions ($1.34B in current pipeline) have an average first-date slip of +41 days. V2 enhancement: override the anticipated date with the model date for deals with 3+ revisions; add a "Date Confidence" indicator to the dashboard and Sheets export.
