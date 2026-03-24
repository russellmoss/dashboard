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

  // Defensive clamp helper
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

  // Clamp the adjusted current-stage rate before using it in the product
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
