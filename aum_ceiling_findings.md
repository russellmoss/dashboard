# Ceiling Comparison + Population Sizing — Findings
**Run Date**: 2026-03-04
**Executed By**: Claude Code (autonomous agent)
**SQL Source**: aum_ceiling_and_population_sizing.sql
**Status**: COMPLETE

---

## Environment Setup
- BQ Connection: PASS
- SQL File: PASS
- aum_40_100m_signal_profile: 364 rows
- aum_proxy_labeled_features: 307 rows
- aum_proxy_control_features: 3,442 rows
- Status: READY

---

## Step A1: >$100M Labeled Cohort Feature Table

- **Status**: PASS
- **Rows**: 166
- **Unique CRDs**: 166
- **AUM Range**: $102M – $1,700M (avg $258.7M)
- **sfdc_aum_band distribution**:
  - $100M–$250M: 116
  - $250M–$500M: 35
  - $500M–$1B: 10
  - $1B+: 5
- **Overlap with $40M–$100M cohort**: 0 (CLEAN)
- **Null Firm AUM**: 11 (6.6%)

---

## Step A2: Three-Way Signal Comparison

| Metric | $40M–$100M (n=307) | >$100M (n=166) | Control (n=3,442) |
|--------|--------------------:|---------------:|------------------:|
| avg_firm_rep_count | 2,340 | 1,955 | 5,339 |
| median_firm_rep_count | 74 | 108 | 3,602 |
| avg_firm_aum_M | 131,399 | 134,690 | 247,414 |
| median_firm_aum_M | 6,263 | 6,015 | 90,022 |
| avg_disc_ratio | 0.863 | 0.858 | 0.735 |
| avg_hnw_ratio | 0.601 | 0.594 | 0.467 |
| avg_tenure_years | 15.8 | 16.6 | 19.9 |
| median_tenure_years | 14.3 | 16.3 | 18.7 |
| avg_license_count | 2.61 | 2.47 | 3.80 |
| pct_series_65_only | 27.0% | 27.1% | 11.3% |
| pct_has_series_7 | 41.7% | 38.6% | 68.8% |
| pct_independent_ria | 53.3% | 53.0% | 18.8% |
| pct_solo_micro | 20.5% | 19.9% | 5.5% |
| pct_portable_custodian | 60.9% | 62.0% | 26.3% |
| pct_has_ownership | 13.0% | 17.5% | 5.3% |
| pct_any_accolade | 1.3% | 6.6% | 2.2% |
| pct_barrons | 0.0% | 0.6% | 0.0% |
| pct_forbes_not_barrons | 0.0% | 4.2% | 0.0% |

### Consistency check vs V2:
- V2 pct_independent_ria (labeled): 53.1% | This run: 53.3% | Match: YES
- V2 pct_portable_custodian (labeled): 60.9% | This run: 60.9% | Match: YES
- V2 avg_license_count (labeled): 2.61 | This run: 2.61 | Match: YES

### Ceiling Signals (where >$100M differs most from $40M–$100M):

| Feature | $40M–$100M | >$100M | Delta | Direction | Ceiling Implication |
|---------|-----------|--------|-------|-----------|---------------------|
| has_any_accolade | 1.3% | 6.6% | +5.3pp | Higher in >$100M | 5x relative prevalence — strongest relative signal |
| has_forbes_not_barrons | 0.0% | 4.2% | +4.2pp | Higher in >$100M | Forbes recognition absent in mid-band entirely |
| median_firm_rep_count | 74 | 108 | +34 | Higher in >$100M | Larger median firm size for >$100M |
| industry_tenure_years | 15.8 | 16.6 | +0.8yr | Higher in >$100M | Slightly more experienced |
| has_ownership | 13.0% | 17.5% | +4.5pp | Higher in >$100M | More likely to be firm owners |

### Key Observation:
The $40M–$100M and >$100M cohorts are **remarkably similar** on most practice
signals (firm type, custodian, license profile, discretionary/HNW ratios). Both
look like independent RIA advisors at small-to-mid firms with portable custodians.
The key differences are:
1. **Accolades** — >$100M advisors are 5x more likely to have industry recognition
   (especially Forbes), suggesting accolades track with AUM scale.
2. **Median firm size** — >$100M advisors work at slightly larger firms (108 vs 74
   median reps), though both cohorts are dwarfed by Control (3,602 median reps).
3. **Tenure** — >$100M advisors are ~1 year more experienced on average.

The similarity means ceiling exclusion will be **imprecise** — there is no single
bright-line signal that cleanly separates the two bands.

---

## Step A3: Ceiling Signal Delta Rankings

| Feature | $40M–$100M Value | >$100M Value | Delta | Direction | Strength |
|---------|----------------:|-------------:|------:|-----------|----------|
| firm_aum_M | 131,399.155 | 134,689.846 | +3,290.691 | Higher in >$100M | Strong* |
| firm_rep_count | 2,340.391 | 1,955.343 | -385.048 | Lower in >$100M | Strong* |
| industry_tenure_years | 15.847 | 16.599 | +0.753 | Higher in >$100M | Strong |
| license_count | 2.606 | 2.470 | -0.136 | Lower in >$100M | Moderate |
| has_any_accolade | 0.013 | 0.066 | +0.053 | Higher in >$100M | Moderate |
| has_ownership | 0.130 | 0.175 | +0.044 | Higher in >$100M | Weak |
| has_series_7 | 0.417 | 0.386 | -0.031 | Lower in >$100M | Weak |
| is_portable_custodian | 0.609 | 0.620 | +0.011 | Higher in >$100M | Weak |
| firm_hnw_ratio | 0.601 | 0.594 | -0.008 | No difference | Weak |
| is_solo_micro_firm | 0.205 | 0.199 | -0.006 | No difference | Weak |
| firm_disc_ratio | 0.863 | 0.858 | -0.005 | No difference | Weak |
| is_independent_ria | 0.533 | 0.530 | -0.003 | No difference | Weak |
| is_series_65_only | 0.270 | 0.271 | +0.001 | No difference | Weak |

*Note: firm_aum_M and firm_rep_count deltas are numerically large because they
are raw values (not proportions). The 0.15 threshold is designed for proportional
features. These are "strong" by the automated threshold but require manual
interpretation — see below.

### Strong Ceiling Signals (delta >= 0.15):
- **firm_aum_M**: $131,399M in $40M–$100M vs $134,690M in >$100M
  Direction: Higher in >$100M (but both are massively skewed by outlier mega-firms)
  Note: Mean firm AUM is nearly identical. Medians ($6,263M vs $6,015M) show no difference.
  **Not usable as a ceiling filter** — the means are dominated by outliers.

- **firm_rep_count**: 2,340 in $40M–$100M vs 1,955 in >$100M
  Direction: Actually LOWER in >$100M by mean (counterintuitive)
  However, MEDIAN is 74 vs 108 — >$100M advisors are at slightly larger median firms.
  Ceiling exclusion logic: `firm_rep_count > 100` would exclude advisors above the
  >$100M median while retaining most $40M–$100M advisors (median 74).

- **industry_tenure_years**: 15.8yr in $40M–$100M vs 16.6yr in >$100M
  Direction: Higher in >$100M
  Delta of 0.75 years is small in practice. Not a useful standalone filter.

### Moderate Ceiling Signals (delta 0.05–0.15):
- **license_count**: 2.61 in $40M–$100M vs 2.47 in >$100M
  Direction: Lower in >$100M (surprising — would expect more credentials)
  Not usable as a ceiling exclusion — wrong direction for "more is higher AUM" thesis.

- **has_any_accolade**: 1.3% in $40M–$100M vs 6.6% in >$100M
  Direction: Higher in >$100M (5x relative difference — strongest relative signal)
  Ceiling exclusion logic: `has_any_accolade = TRUE` strongly suggests >$100M
  However, only 6.6% prevalence means it won't exclude many advisors.
  **Best available ceiling signal by discrimination ratio** but requires accolade join.

### Features with NO ceiling differentiation:
- is_portable_custodian, firm_hnw_ratio, is_solo_micro_firm, firm_disc_ratio,
  is_independent_ria, is_series_65_only — all show < 0.01 absolute difference.
  These signals cannot distinguish $40M–$100M from >$100M.

### Proposed Ceiling Exclusion Criteria:
Based on available signals, only one practical filter can be applied in the
population sizing query (which already has firm_rep_count available):

1. **EXCLUDE IF: firm_rep_count > 100** — targets the median firm size of the
   >$100M cohort. Removes advisors at firms larger than the >$100M median.
   - Retains ~50%+ of $40M–$100M advisors (median 74, so majority are below 100)
   - Removes ~50% of >$100M advisors (by definition of median)
   - **Limitation**: This is a blunt instrument. Many $40M–$100M advisors are also
     at firms with >100 reps, so collateral damage is significant.

2. **EXCLUDE IF: has_any_accolade = TRUE** (requires accolade join in production SQL)
   - Removes est. 6.6% of >$100M advisors while retaining 98.7% of $40M–$100M
   - Very low collateral damage but also very low impact
   - Best precision but minimal volume effect

**Honest assessment**: The two cohorts are too similar for reliable ceiling exclusion
from FINTRX signals alone. Production SQL should apply the firm_rep_count filter
as a soft preference (scoring weight) rather than a hard exclusion.

---

## Step B1: Population Sizing — Three Variants

### WITHOUT Ceiling Exclusion (baseline)

| Variant | Total Universe | Passes Criteria | % of Universe | Est. Monthly New |
|---------|---------------:|----------------:|--------------:|-----------------:|
| Relaxed | 168,586 | 44,268 | 26.3% | 3,689 |
| Enhanced | 168,586 | 17,481 | 10.4% | 1,457 |
| Tight | 168,586 | 7,140 | 4.2% | 595 |

### WITH Ceiling Exclusion (firm_rep_count <= 100)

| Variant | Total Universe | Passes Criteria | % of Universe | Est. Monthly New |
|---------|---------------:|----------------:|--------------:|-----------------:|
| Relaxed | 26,802 | 21,991 | 82.0% | 1,833 |
| Enhanced | 26,802 | 12,940 | 48.3% | 1,078 |
| Tight | 26,802 | 4,878 | 18.2% | 407 |

| Variant | Baseline | With Ceiling | Change | Monthly Change |
|---------|---------|-------------|--------|---------------|
| Relaxed | 44,268 | 21,991 | -22,277 | -1,856 |
| Enhanced | 17,481 | 12,940 | -4,541 | -379 |
| Tight | 7,140 | 4,878 | -2,262 | -188 |

**Note**: The ceiling filter (firm_rep_count <= 100) reduces total_universe to
26,802 — below the 50,000 validation threshold. This means the filter is
aggressive on the overall population. However, the Enhanced variant still yields
1,078 monthly prospects, which is viable.

### Volume Assessment:
- **Relaxed monthly new (baseline)**: 3,689 prospects
  Verdict: Too many — need tighter filter (>2,000)
- **Enhanced monthly new (baseline)**: 1,457 prospects
  Verdict: Viable (200–2,000 range)
- **Tight monthly new (baseline)**: 595 prospects
  Verdict: Viable (200–2,000 range)
- **Enhanced monthly new (with ceiling)**: 1,078 prospects
  Verdict: Viable (200–2,000 range)

### Recommended variant for production:
**Enhanced WITHOUT hard ceiling exclusion** — 1,457 monthly prospects.

Reasoning:
1. The ceiling filter (firm_rep_count <= 100) reduces universe below 50K, indicating
   over-aggressiveness. It removes 26% of Enhanced-qualifying advisors (-379/month).
2. The $40M–$100M and >$100M cohorts are too similar for a hard ceiling cutoff
   to be reliable — the firm_rep_count filter has ~50% collateral damage on the
   target band.
3. Better approach: use ceiling signals as **scoring weights** in production SQL
   (e.g., firm_rep_count < 100 gets +10 points, has_accolade gets -10 points)
   rather than hard exclusions.
4. Enhanced at 1,457/month is in the viable range and the V2 precision ratio
   (3.96x) provides sufficient quality assurance.

---

## Step B2: Firm AUM Distribution of Enhanced-Criteria Advisors

| Firm AUM Bucket | Advisor Count | % of Total |
|-----------------|-------------:|-----------:|
| Under $50M | 1,511 | 8.6% |
| $50M–$100M | 949 | 5.4% |
| $100M–$250M | 1,933 | 11.1% |
| $250M–$500M | 1,857 | 10.6% |
| $500M–$1B | 1,661 | 9.5% |
| $1B–$5B | 3,046 | 17.4% |
| $5B+ | 6,524 | 37.3% |

### Assessment:
- % at firms under $500M (sweet spot): 35.7% (8.6 + 5.4 + 11.1 + 10.6)
- % at firms $1B+: 54.7% (17.4 + 37.3)
- **Is the distribution consistent with a $40M–$100M individual AUM target?**
  **NO** — over-indexing on large firms. 54.7% of Enhanced-qualifying advisors
  are at firms with $1B+ total AUM. An advisor at a $5B+ firm is unlikely to
  have only $40M–$100M in individual AUM.

- **Recommendation**: Add `firm_aum < $500M` (i.e., SAFE_CAST(f.TOTAL_AUM AS INT64)
  < 500000000) as an additional Enhanced criteria filter and re-run B1 to see
  volume impact. This would retain the 35.7% sweet-spot advisors (~6,250 advisors,
  ~521 monthly) which is still viable.

  Alternatively, use `firm_aum < $1B` as a less aggressive cutoff, which would
  retain 45.2% (~7,911 advisors, ~659 monthly).

---

## Final Synthesis: TIER_AUM_MID Production Specification

### Full Band Definition
This tier targets advisors likely to have $40M–$100M in individual AUM
who have never been in our SFDC pipeline.

### Floor Signals (from V2 — confirmed)
Criteria that identify the TARGET band vs. the general population:
| Signal | Threshold | Discrimination Score | Basis |
|--------|-----------|---------------------|-------|
| is_independent_ria OR (is_portable_custodian AND NOT has_series_7) | TRUE | 34.3 / 34.6 | V2 Step 3 |
| firm_disc_ratio | > 0.70 | 52.5 (Cohen's d) | V2 Step 3 |
| firm_hnw_ratio | > 0.30 | 61.2 (Cohen's d) | V2 Step 3 |
| license_count | < 3 | 70.1 (Cohen's d) | V2 Step 3 |
| industry_tenure_years | 7–25 | 41.6 (Cohen's d) | V2 Step 3 |

### Ceiling Signals (from V3 Analysis A — new)
Criteria that EXCLUDE advisors likely above $100M:
| Signal | Threshold | Ceiling Delta | Basis |
|--------|-----------|--------------|-------|
| has_any_accolade | Exclude if TRUE | 0.053 (5x relative) | V3 Step A3 |
| firm_rep_count (median) | Soft exclude if > 100 | 34 reps (median delta) | V3 Step A3 |
| firm_aum (from B2) | Exclude if > $1B | 54.7% of Enhanced at $1B+ | V3 Step B2 |

**Important caveat**: Ceiling signals are weak. The $40M–$100M and >$100M cohorts
share nearly identical profiles on 10 of 13 features tested. Hard ceiling
exclusions will cause significant collateral damage to the target band. Recommend
using ceiling signals as scoring weights, not hard filters.

### Standard Exclusions (unchanged from existing pipeline)
- Wirehouse firms
- Excluded firm CRDs (ml_features.excluded_firm_crds)
- Advisors likely over 70 (INDUSTRY_TENURE_MONTHS > 480)
- Already in SFDC pipeline (Lead or Opportunity)

### Recommended Criteria Variant
**Enhanced** — best balance of volume and precision.
- Floor criteria give 3.96x precision lift over control (V2)
- Volume of 1,457/month (baseline) or ~659/month (with firm_aum < $1B ceiling)
  are both in the viable range

### Estimated Monthly Volume
- Total passing Enhanced criteria (not in pipeline): 17,481 (baseline) / ~7,911 (with $1B ceiling)
- Estimated monthly new prospects: 1,457 (baseline) / ~659 (with ceiling)
- Comparable existing tiers: TIER_2_PROVEN_MOVER gets ~1,500 leads/month

### Expected Conversion Rate Estimate
From V1 findings: non-excluded win rate was 3.4% (3.4x baseline).
This is directional — based on n=9 wins, so treat as hypothesis not fact.
Recommend: shadow run first, validate against 30-day conversion data before
committing to production quota.

### Next Steps
- [ ] Write production SQL inserting TIER_AUM_MID into lead list pipeline
- [ ] Add firm_aum < $1B as a soft ceiling filter (recommended over hard $500M cutoff)
- [ ] Consider adding accolade exclusion (requires accolade table join in production)
- [ ] Run shadow pass against current month's lead list to check tier overlap
      with existing V3 tiers (TIER_2_PROVEN_MOVER likely captures some of these)
- [ ] Add to monthly quota at conservative volume (e.g., 500 leads/month) for
      first 60-day validation window
- [ ] Re-evaluate after 30-day conversion data matures

### Open Questions Resolved / Unresolved
- **RESOLVED**: Can we distinguish >$100M from $40M–$100M using FINTRX signals?
  → Barely. The two cohorts are 80%+ identical on practice signals. Only accolades
  and median firm size show meaningful differences.
- **RESOLVED**: Is the tier viable at volume?
  → YES. Enhanced criteria yield 1,457/month (baseline), well above the 300 minimum.
- **UNRESOLVED**: What is the actual conversion rate for this tier?
  → V1's 3.4% is based on n=9 wins. Need shadow run validation.
- **UNRESOLVED**: How much overlap exists with TIER_2_PROVEN_MOVER?
  → Not tested in this investigation. Recommend overlap analysis before launch.
- **UNRESOLVED**: Should ceiling be a hard filter or scoring weight?
  → Recommendation is scoring weight, but needs product decision.

---

## Validation Summary

| Step | Status | Rows | Key Gate |
|------|--------|------|----------|
| Environment Setup | PASS | — | 3 prereq tables present |
| A1: >$100M Feature Table | PASS | 166 | No boundary bleed, no overlap |
| A2: Three-Way Comparison | PASS | 3 rows | Consistent with V2 |
| A3: Ceiling Delta Table | PASS | 13 rows | 3 strong signals (by threshold) |
| B1: Population Sizing | PASS | 3 rows | Logical ordering confirmed |
| B2: Firm AUM Breakdown | PASS (with flag) | 7 rows | 0% Unknown, but 54.7% at $1B+ firms |

**Overall Status**: COMPLETE
**Primary Finding**: The $40M–$100M and >$100M cohorts are strikingly similar — accolades (5x relative difference) and median firm rep count (108 vs 74) are the only meaningful ceiling discriminators. Hard ceiling exclusion is not recommended; use scoring weights instead.
**Viable Tier?**: YES — Enhanced criteria yield 1,457 monthly prospects at 3.96x precision
**Ready for Production SQL**: YES, with caveats — recommend adding firm_aum < $1B soft ceiling and running a 60-day shadow validation before committing to quota
