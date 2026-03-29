# Forecast Modeling Backtest: Executive Summary

**Date:** March 24, 2026

---

## What We Did

We backtested our pipeline forecast models against 5 quarters of actual results (Q4 2024 through Q4 2025) to answer a simple question: when the model says "$X of AUM will join this quarter," how close is it?

We were careful to only use data that would have been available at the time of each forecast. This meant reconstructing AUM values, anticipated start dates, and conversion rates as they existed at each quarter's start date, not as they appear today. This is called point-in-time correction, and without it, backtests look artificially good because they benefit from information that wasn't available when the forecast was made. Our earlier analysis reported 28% average error. After correcting for point-in-time leakage, the real number is much higher.

The conversion rates used in all backtests follow the same methodology as our production model: they are computed from resolved SQOs only (Joined + Closed Lost), cohorted by opportunity created date within a trailing window, using "reached or beyond" denominators to prevent rates from exceeding 100% when deals skip stages. The four stage transitions are SQO to Sales Process, SP to Negotiating, Negotiating to Signed, and Signed to Joined.

---

## The Three Methods We Tested

### 1. Straight Weighted Pipeline

The simplest version of the model. For each open deal, multiply its AUM by the probability of joining (the product of remaining stage conversion rates). Sum across all deals. Every deal at the same stage gets the same probability regardless of how long it has been sitting there or how large it is.

**Result: 591% average error vs. quarterly actuals.** The model predicted $3-5.5B when $300M-$1B actually joined. It was never even close.

### 2. Weighted Pipeline with Duration and AUM Penalties

The current production model. Same approach as straight weighting, but with two adjustments:

- **Duration penalties.** Deals stuck in a stage longer than normal get a reduced probability. A Negotiating deal at 90 days (well past the 50-day average) gets its Neg-to-Signed probability multiplied by 0.179 instead of 1.0. This matters because 50-65% of the pipeline at any given time is stale deals that are unlikely to close.
- **AUM tier segmentation.** Deals above $75M convert at roughly half the rate of smaller deals, so they get lower probabilities. This prevents large-AUM deals from dominating the forecast with inflated expected values.

**Result: 198% average error vs. quarterly actuals.** That is 3x better than straight weighting, so the penalties clearly help. But it still predicted $1-3B when $300M-$1B actually joined. The model cut the overestimation in half but it was still way off for quarterly planning.

Against eventual conversion (total AUM that ever joined from each pipeline snapshot, not just one quarter), the penalized model was 70% off on average. So it is a reasonable measure of total pipeline value over time. It just cannot tell you what will land in any specific quarter.

### 3. Two-Component Realization Model

Since the probability models kept overestimating, we tried a completely different approach. Instead of weighting every deal in the pipeline by its probability, we focused on the deals most likely to close soon and added a historical baseline for everything else.

**Component A: Late-stage committed deals.** At the start of each quarter, count the Negotiating and Signed deals that have an anticipated start date falling in that quarter. Sum their AUM and apply a realization rate (what fraction of that AUM actually shows up).

The realization rate is not a conversion rate. It measures: of the AUM that was "committed" to this quarter by late-stage deals with dates, what percentage actually materialized? We computed this by looking at each prior quarter, summing the AUM of all Neg/Signed deals that had dates in that quarter, and dividing by the AUM that actually joined from those specific deals.

We found the realization rate declines as more deals get anticipated dates (from 94% when only 6 deals had dates, down to 34% when 22 deals had dates). So we used deal-count bands: fewer than 10 dated deals gets a 60% rate, 10-15 gets 45%, and 15+ gets 35%.

**Component B: Historical surprise baseline.** Take the trailing 4-quarter average of "surprise" AUM, which is everything that joined in a quarter that was not a Neg/Signed deal with an anticipated date at quarter start. This captures fast-tracking Sales Process deals, deals that entered and closed within the same quarter, and other sources the model cannot predict from a snapshot.

**Result: 17% average error vs. quarterly actuals.** That is 8x more accurate than the penalized weighted model and 35x more accurate than straight weighting.

---

## Side-by-Side Comparison

| Method | Avg Error vs. Quarterly Actual | Best Use |
|---|---:|---|
| **Two-component (deal-count bands)** | **17%** | Quarterly AUM forecasting |
| Weighted + duration + AUM penalties | 198% | Pipeline health trending |
| Straight weighted (no penalties) | 591% | Not recommended |
| Monte Carlo P50 | 65-195% | Scenario and risk communication |

---

## Why the Probability Models Overestimate

The weighted pipeline forecast answers a different question than the one we are asking. It answers: "what is the total expected value of this pipeline across all future quarters?" That is a legitimate question for pipeline health tracking. But when we compare it against a single quarter's joined AUM, it is always too high because the pipeline takes multiple quarters to work through.

On top of that:
- 50-65% of the pipeline at any snapshot is stale deals that have been sitting for months and are unlikely to close. Even with duration penalties, a residual probability times a large AUM still adds up.
- A few whale deals ($500M+) at low probability still contribute tens of millions each to the forecast.
- About 20% of quarterly AUM comes from deals that were not even in the pipeline at quarter start, so no snapshot-based model can see them coming.

---

## What the Two-Component Model Gets Right

It sidesteps all of those problems by only looking at deals that are close to closing and have committed to a specific quarter. It does not try to probability-weight hundreds of early-stage deals. It does not try to predict whale outcomes. It just asks two questions:

1. How much AUM is committed to this quarter by late-stage deals with dates, and what fraction of that typically shows up?
2. What is the historical baseline of AUM that shows up from other sources?

The sum of those two numbers has been within 17% of actual results across the backtest period.

---

## Sanity Check: Q2 2026 Forecast

The two-component model forecasts $1.1-1.3B for Q2 2026. Here is how that compares to what the other models say and what has actually happened:

| | Amount |
|---|---:|
| Two-component forecast | $1.1-1.3B |
| Weighted pipeline (penalized) | ~$2.9B |
| Monte Carlo P10 ("bear case") | $2.0B |
| Monte Carlo P50 ("base case") | $2.7B |
| **Highest actual quarter ever (ex-whale)** | **$1.3B (Q4 2025)** |

The probability model's $2.9B and the Monte Carlo's $2.0B "bear case" both exceed every non-whale quarter in our history. The two-component estimate of $1.1-1.3B is consistent with the growth trajectory: $463M, $578M, $765M, $1,318M over the last four settled quarters. Q1 2026 hit $2.4B but that was driven by a single $1.5B whale deal. Without that deal, Q1 was $911M.

---

## What We Recommend

1. **For quarterly AUM forecasting**, use the two-component model. Sum Neg/Signed deals with anticipated dates in the target quarter, apply the deal-count band rate, and add the trailing surprise baseline.

2. **For SQO capacity planning**, continue using the SQO target calculator. It was within 3-7 SQOs of what was needed in stable quarters.

3. **For pipeline health monitoring**, track the penalized weighted forecast quarter over quarter as a directional indicator. Do not use it as a dollar target.

4. **For risk communication**, use the Monte Carlo P10/P50/P90 but note that the P10 "bear case" is too optimistic. Actual outcomes fell below it 40% of the time.

5. **For whale deals**, track them on a separate watchlist. No model can predict a single $1.5B deal, and including them in probability math inflates the forecast every quarter they sit in the pipeline.

---

## References

For more detailed information about the analyses run and the decisions made, please see this document:
[Detailed Backtest Results](https://docs.google.com/document/d/1ClYLWDD4oO-ioKi0gZejrbrhJLc-Iz4ZsvPcS1-yO1Q/edit?tab=t.0)

For the SQL used in BigQuery to generate the backtesting, please see this document:
[Backtesting SQL Reference](https://docs.google.com/document/d/1xlBzCou_7gxkfaZQ0g9_UJ0qMciQrZY17vWIScKE94E/edit?usp=sharing)
