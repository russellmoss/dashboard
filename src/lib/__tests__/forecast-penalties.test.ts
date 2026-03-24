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
