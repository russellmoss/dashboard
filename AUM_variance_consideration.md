# AUM Variance & Monte Carlo Methodology Consideration

## Context

This document describes a forecasting challenge we've identified in the Savvy Wealth pipeline forecast. The forecast page uses a Monte Carlo simulation (5,000 trials) and deterministic weighted AUM to predict quarterly closed-won pipeline. We've identified significant AUM variance within pipeline stages that may warrant a methodology change.

**Goal:** Get input from multiple LLMs on the best path forward before implementing changes.

---

## The Observed Problem

### AUM Variance by Stage (Current Open Pipeline)

| Stage | Deals | Mean AUM | Median AUM | Std Dev | CV% | Min | Max |
|-------|-------|----------|------------|---------|-----|-----|-----|
| Discovery | 38 | $272M | $170M | $497M | **182%** | $20M | $3.0B |
| Sales Process | 72 | $132M | $80M | $137M | **103%** | $14M | $550M |
| Negotiating | 30 | $75M | $45M | $93M | **125%** | $17M | $500M |
| Signed | 4 | $158M | $111M | $75M | **47%** | $79M | $235M |

Key observations:
- **Coefficient of variation exceeds 100%** in 3 of 4 stages — the standard deviation exceeds the mean.
- **Mean is pulled far above median** by outliers (classic right-skew). In Discovery, the mean ($272M) is 1.6x the median ($170M).
- **Single deals dominate**: one $3B Discovery deal is 11x the stage mean and represents 13% of total pipeline AUM alone.

### Concentration Risk

| Segment | Deals | AUM | % of Total Pipeline |
|---------|-------|-----|-------------------|
| Top 5 deals | 5 | $5.8B | **25.4%** |
| Top 10 deals | 10 | $8.0B | **35.1%** |
| Top 20 deals | 20 | $11.3B | **49.3%** |
| All deals | 145 | $22.9B | 100% |

Half the pipeline AUM is concentrated in 14% of deals.

---

## How the Current Model Works

### Monte Carlo Simulation

For each of 5,000 trials:
1. Every open deal independently gets a Bernoulli draw (coin flip) at each remaining stage
2. The probability at each stage is the **historical conversion rate** for that transition (e.g., Neg→Signed = 54%)
3. All deals at the same stage get the **same probability** regardless of AUM
4. If a deal "wins" all remaining coin flips, its full AUM is added to that trial's total
5. After all trials, we take P10 (10th percentile), P50, and P90 of the trial totals

### Deterministic Expected AUM (Metric Cards)

Each deal gets: `Expected AUM = P(Join) × AUM`

Where `P(Join)` is the product of remaining stage conversion rates — identical for all deals at the same stage.

### Monte Carlo Drilldown (P10/P50/P90 Cards)

When you click into a scenario (e.g., Q2 P10), the drilldown:
1. Shows all deals projected for that quarter
2. Sorts by **simulation win rate** (how often the deal closed across 5,000 trials)
3. Accumulates raw AUM top-down until reaching the scenario target
4. Draws a line — deals above are "in" the scenario, deals below are "out"

---

## The Concern

### "Above the line" feels random

When clicking into P10 (Bear case) for a quarter, the drilldown sorts by win rate and accumulates AUM. But because **all deals at the same stage have essentially the same win rate** (with minor random variation from the Bernoulli draws), the ordering within a stage is effectively random — determined by tiny differences in simulation noise, not by any real signal about which deals are more likely to close.

Example from Q1 2026 P10 ($311M target):
```
#1  Kurt Wedewer      Signed     $235M   84.3%   ← Above the line
#2  Andrew Smith      Negotiating $18M   36.0%   ← Above the line
#3  Eric Kaplan       Negotiating $45M   36.0%   ← Above the line
#4  Kirby Houchin     Negotiating $42M   35.8%   ← Below the line (but nearly identical win rate)
```

Deals #2, #3, and #4 all have ~36% win rates. Whether #3 or #4 ends up "above the line" depends on which happened to get 36.0% vs 35.8% in this particular simulation run — essentially a coin flip. Run it again and the order changes.

### The flat-probability assumption

The core issue: a $3B Discovery deal and a $20M Discovery deal both get a 14% P(Join). In reality:
- Mega-deals may convert at different rates (often lower — more stakeholders, longer cycles, more competitive pressure)
- Or they may convert at higher rates if they're strategic/referral deals
- We don't have enough data per AUM tier to know for sure

### Impact on the "expected AUM" point estimate

The deterministic expected AUM for Discovery stage:
- $3B deal × 14% = **$420M expected** — this single deal contributes more expected AUM than any other Discovery deal
- $20M deal × 14% = **$2.8M expected**

The $3B deal dominates the expected AUM metric card, but the 14% probability is computed from all Discovery deals regardless of size. If mega-deals actually convert at 8% instead of 14%, that $420M "expected" value should be $240M.

---

## Idea Under Consideration: Median-Anchored Clustering

One hypothesis: instead of treating each deal's AUM as a fixed value in the simulation, we could **cluster deal outcomes around the stage median** to reduce the impact of outlier AUM values on the simulation output.

### Conceptually

Rather than: "This $3B deal has a 14% chance of bringing $3B"

Consider: "This $3B deal has a 14% chance of bringing something, and when deals at this stage close, they historically bring a median of $170M (with some spread)"

### Possible implementation

For each deal in each trial:
1. Still flip the Bernoulli coin at the stage conversion rate
2. If the deal "closes," instead of using its stated AUM, draw the AUM from a distribution anchored at the **stage median** but influenced by the deal's actual AUM
3. e.g., `simulated_aum = median_aum + (deal_aum - median_aum) × shrinkage_factor`
4. Where `shrinkage_factor` (0.0 to 1.0) controls how much we trust the stated AUM vs regressing to the stage median

### Pros
- Reduces the outsized impact of whale deals on simulation outputs
- P10/P50/P90 spreads become more realistic
- Drilldown ordering becomes more meaningful (less dominated by random noise)

### Cons
- Introduces a tunable parameter (shrinkage_factor) with no obvious "right" value
- Stated AUM is a real data point — shrinking it toward the median discards real information
- If a $3B deal actually does close, the AUM really is $3B, not $170M
- Deals may already have underwritten AUM that's been validated

### Open question
Is the problem the AUM variance, or is the problem that we're applying a uniform conversion rate? Maybe the fix is AUM-tier-specific rates, not AUM smoothing.

---

## Alternative Approaches to Consider

### 1. AUM-Tier-Specific Conversion Rates

Compute separate historical conversion rates for each AUM tier:
- Tier 1: < $25M
- Tier 2: $25M - $75M
- Tier 3: $75M - $150M
- Tier 4: > $150M

Then each deal gets a probability based on its tier, not just its stage. A $3B Discovery deal would use the Tier 4 historical rate, which may be meaningfully different from the overall rate.

**Challenge:** Do we have enough historical data per tier per stage to compute stable rates? With only 817 resolved SQOs all-time, splitting into 4 tiers × 4 stages = 16 cells might leave many cells with <10 observations.

### 2. Log-Normal AUM Simulation

Instead of using stated AUM directly, model the AUM outcome as a draw from a **log-normal distribution** fitted to historical closed-won AUM for that stage. This naturally handles the right-skew and reduces outlier impact.

**How it would work:**
- Fit a log-normal distribution to historical closed-won AUM per stage
- When a deal "closes" in a trial, draw its AUM from this distribution instead of using its stated AUM
- The deal's stated AUM could influence the distribution parameters (shift the mean)

**Pros:** Statistically principled, handles skew naturally, reduces outlier dominance.
**Cons:** Ignores deal-specific AUM information, which is real and often underwritten.

### 3. Bayesian Shrinkage (Empirical Bayes)

Blend each deal's stated AUM with the stage's historical distribution using Bayesian shrinkage:

`adjusted_aum = (weight × deal_aum) + ((1 - weight) × stage_median_aum)`

Where `weight` increases with the deal's stage progression (we're more confident in AUM at Signed than at Discovery) and with deal-specific validation (underwritten AUM gets higher weight than self-reported).

### 4. AUM-Weighted Win Rates (Bayesian)

Instead of separate tier rates, compute a **single regression** of win probability on log(AUM) per stage. This gives a smooth curve rather than discrete buckets, and works better with limited data.

### 5. Keep the Model As-Is, Improve the Display

The Monte Carlo is mathematically correct — the wide P10/P90 spread accurately reflects the uncertainty caused by AUM concentration. The "problem" may be in presentation, not methodology:

- Remove the "above/below the line" concept from the drilldown since it's misleading when deals have similar win rates
- Instead, show all deals with their simulation stats, and let the user understand that the P10/P50/P90 totals are distributions, not specific deal lists
- Add a concentration risk warning: "5 deals represent 25% of pipeline AUM — forecast uncertainty is high"

---

## What We Need to Decide

1. **Is the current model wrong, or just hard to interpret?** The Monte Carlo math is correct — it faithfully simulates independent Bernoulli outcomes. The question is whether the inputs (flat rates per stage, stated AUM as-is) reflect reality well enough.

2. **Do we have enough data to stratify?** AUM-tier-specific rates are the most principled fix, but need 10+ observations per cell to be stable. We should check historical data density before committing.

3. **Is AUM smoothing/shrinkage appropriate here?** When we have underwritten AUM from a due diligence process, shrinking it toward a median is discarding real information. But for early-stage deals with self-reported AUM, some skepticism may be warranted.

4. **What does the audience need?** If this is for finance planning, they may want conservative point estimates (use median, not mean). If it's for strategic planning, they may want the full distribution (keep Monte Carlo as-is, improve display).

---

---

## Additional Analysis: Anticipated Date & Stage Duration Outliers

### Overdue Anticipated Start Dates

Of the 145 open pipeline deals:
- **60 deals** (41%) have an `Earliest_Anticipated_Start_Date__c` set
- **1 deal** has an anticipated date **before today** (2026-03-23):
  - Andrew Smith, Negotiating, $18M, anticipated 2026-03-18 (5 days overdue)
- **59 deals** have anticipated dates in the future

**Implication for forecasting:** Only 1 deal is technically overdue on its anticipated date, which is encouraging — the anticipated dates are largely forward-looking. However, anticipated dates are set by SGMs/advisors and may be optimistic. We should monitor whether deals with anticipated dates actually close on time vs slip.

### Historical Stage Duration Benchmarks (2yr resolved cohort)

| Stage | N | Avg Days | Median | Std Dev | +1 SD Threshold | +2 SD Threshold | Min | Max |
|-------|---|----------|--------|---------|-----------------|-----------------|-----|-----|
| SQO → SP | 487 | 8.5d | 0d | 27.6d | 36d | 64d | 0 | 370d |
| In SP | 187 | 29.1d | 18d | 38.1d | 67d | 105d | 0 | 364d |
| In Neg | 93 | 19.8d | 8d | 30.5d | 50d | 81d | 0 | 176d |
| In Signed | 89 | 28.4d | 23d | 25.7d | 54d | 80d | 0 | 113d |

Notes:
- **Median is far below mean** in every stage — right-skewed distributions with long tails
- SQO→SP median is **0 days** — most deals enter SP immediately or on the same day they SQO
- SP and Neg have maximums exceeding 300+ days — some deals sit for nearly a year

### Current Open Pipeline: Duration Classification

How many deals in the current open pipeline are lingering beyond normal durations?

| Stage | Within 1 SD | 1-2 SD Over | 2+ SD Over |
|-------|-------------|-------------|------------|
| **Discovery** | 22 deals ($6.8B) | 6 deals ($1.2B) | 10 deals ($2.3B) |
| **Qualifying** | — | — | 1 deal ($130M) |
| **Sales Process** | 63 deals ($8.1B) | 3 deals ($560M) | 6 deals ($902M) |
| **Negotiating** | 21 deals ($1.3B) | 4 deals ($110M) | 5 deals ($813M) |
| **Signed** | 2 deals ($190M) | — | 2 deals ($441M) |

**Pipeline-wide summary:**

| Duration Bucket | Deals | AUM | % of Pipeline AUM |
|----------------|-------|-----|-------------------|
| Within 1 SD | 108 | $16.4B | **71.7%** |
| 1-2 SD over | 13 | $1.9B | **8.3%** |
| 2+ SD over | 24 | $4.6B | **20.1%** |

**24 deals representing $4.6B (20% of pipeline AUM) have been in their current stage more than 2 standard deviations beyond the historical average.** These are deals that, based on historical norms, should have either advanced or closed lost by now.

### Do Stale Deals Convert at Lower Rates?

We checked whether deals that linger in a stage historically convert at different rates:

**Sales Process → eventually Joined:**

| SP Duration | Deals | Eventually Joined | Join Rate |
|------------|-------|-------------------|-----------|
| Within 1 SD | 163 | 75 | **46.0%** |
| 1-2 SD over | 18 | 10 | 55.6% |
| 2+ SD over | 6 | 2 | **33.3%** |

**Negotiating → eventually Joined:**

| Neg Duration | Deals | Eventually Joined | Join Rate |
|-------------|-------|-------------------|-----------|
| Within 1 SD | 83 | 79 | **95.2%** |
| 1-2 SD over | 5 | 5 | 100% |
| 2+ SD over | 5 | 3 | **60.0%** |

**Key finding:** Deals that linger 2+ SD in Negotiating have a **60% join rate** vs **95% for deals that move at normal pace**. The sample sizes are small (n=5), but the signal is directionally clear — stale deals are less likely to close, especially at the Negotiating stage.

### Implications for Forecasting

1. **The current model treats a deal that's been in Negotiating for 256 days the same as one that's been there for 5 days.** Both get a ~50% Neg→Signed rate. The data suggests the 256-day deal should have a meaningfully lower probability.

2. **$4.6B of pipeline AUM is in the "2+ SD stale" bucket.** If these deals convert at roughly half the normal rate, the expected AUM from this segment is overstated by ~50%. That's potentially $1-2B of phantom expected value in the forecast.

3. **Duration-adjusted conversion rates** could be a more impactful improvement than AUM-tier rates, because:
   - We have more data (duration is continuous, not bucketed into 4 tiers)
   - The signal is clearer (stale deals demonstrably convert less)
   - It addresses a visible problem (deals stuck for 250+ days showing the same P(Join) as fresh deals)

4. **Possible implementation:** Add a duration penalty to P(Join) for deals beyond +1 SD in their current stage. For example:
   - Within 1 SD: full rate
   - 1-2 SD over: rate × 0.75
   - 2+ SD over: rate × 0.50

   These multipliers could be derived from the actual historical conversion rates by bucket (as shown above), though we'd need more data to be confident in the exact values.

5. **For the Monte Carlo:** The Bernoulli draw probabilities could be adjusted per-deal based on duration. A Negotiating deal at 256 days would get a lower `RAND() < rate` threshold than a Negotiating deal at 5 days. This would cause stale deals to appear less frequently in winning trials, which better reflects reality.

---

## Current System Architecture (for implementor context)

- **Stack:** Next.js 14, TypeScript, BigQuery, Recharts
- **Monte Carlo:** Runs in BigQuery SQL (5,000 trials via CROSS JOIN + RAND()), returns per-quarter P10/P50/P90 + per-deal win frequency
- **Rates:** Computed from resolved SQOs (Joined + Closed Lost) using "reached this stage or beyond" denominators to handle stage-skipping
- **Pipeline view:** `vw_forecast_p2` in BigQuery, with client-side rate recomputation when the conversion window changes
- **Drilldown:** Sorts by simulation win rate, accumulates raw AUM, draws P10/P50/P90 threshold lines
- **Export:** CSV from drilldown + Google Sheets export with audit trail and numerator/denominator flags
