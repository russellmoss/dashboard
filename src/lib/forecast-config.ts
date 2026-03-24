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
