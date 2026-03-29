# Pipeline Forecast: Project Update

**Date:** March 25, 2026

---

## What We Built

We built a Pipeline Forecast page at `/dashboard/forecast` that gives finance and leadership a data-driven view of open pipeline outcomes. Before this, there was no centralized way to see deal-level probabilities, no confidence intervals around aggregate projections, and forecasts were manual spreadsheets disconnected from the underlying Salesforce data.

The system has five components working together:

**Probability-Weighted Forecast.** Every open deal gets a probability of joining based on its current stage and how long it has been sitting there. The probability is the product of its remaining stage-to-stage conversion rates (SQO to Sales Process, SP to Negotiating, Neg to Signed, Signed to Joined), computed from a trailing cohort of resolved deals in BigQuery. Deals stuck in a stage longer than normal get penalized. Deals above $75M AUM get separate, lower conversion rates because large deals close at about half the rate of smaller ones. Expected AUM is summed into Q2 and Q3 2026 buckets.

**Monte Carlo Simulation.** 5,000 trials run natively in BigQuery. Each trial flips an independent coin for every stage transition on every open deal, producing P10/P50/P90 confidence intervals for quarterly AUM and joiner counts. This shifts the conversation from "we expect $X" to "we're 90% confident it's above $X and 50% confident it reaches $Y."

**Scenario Runner.** Admins can override any conversion rate or average-days-in-stage value, name the scenario, save it, and share it via a unique URL. This lets leadership stress-test assumptions ("what if SP to Neg drops 10 points?") without filing a data request.

**Realization Forecast.** A two-component model that forecasts quarterly AUM using late-stage committed deals with anticipated dates plus a historical surprise baseline. This was built after backtesting revealed the probability models overestimate by 2-3x (more on that below).

**Google Sheets Export.** Every export creates a new Google Sheet with 7 tabs covering the pipeline forecast, audit trail, Monte Carlo results, conversion rates, SQO targets, realization forecast, and an editable scenario runner. Sheets are organized into per-user folders in a shared Google Drive. The dashboard mirrors this structure with collapsible user folders on the Exports tab.

---

## What We Learned from Backtesting

We backtested the forecast models against 5 quarters of actual results (Q4 2024 through Q4 2025) using strict point-in-time correction. That means we only used data the model would have had at the time of each forecast: AUM values before post-snapshot revisions, anticipated dates before they were pushed, and conversion rates computed only from deals that had actually resolved by the snapshot date.

This correction mattered a lot. Our earlier analysis reported 28% average error. After fixing three sources of data leakage, the real number was 198% for the penalized weighted model and 591% for straight weighting. The probability models were consistently predicting $1-3B when $300M-$1B actually landed each quarter.

The core problem is that the probability model answers a different question than the one we're asking. It tells you what the pipeline is worth across all future quarters, not what will land in any specific one. On top of that, 50-65% of the pipeline at any snapshot is stale deals that have been sitting for months, a few whale deals at low probability still contribute tens of millions each, and about 20% of quarterly AUM comes from deals that weren't even in the pipeline at quarter start.

So we built the two-component realization model. Instead of probability-weighting every deal, it looks at the Negotiating and Signed deals that have an anticipated start date in the target quarter, applies a realization rate based on how many such deals exist, and adds a trailing 4-quarter average of "surprise" AUM from other sources. This achieved 17% average error across the backtest period, an 8x improvement over the penalized model.

| Method | Avg Error vs. Quarterly Actual | Best Use |
|---|---:|---|
| **Two-component realization** | **17%** | Quarterly AUM forecasting |
| Weighted + duration + AUM penalties | 198% | Pipeline health trending |
| Straight weighted | 591% | Not recommended |
| Monte Carlo P50 | 65-195% | Scenario and risk communication |

The two-component model forecasts $1.1-1.3B for Q2 2026. The probability model says $2.9B and the Monte Carlo bear case says $2.0B. Both of those exceed every non-whale quarter in our history. The highest actual quarter (excluding the Q1 2026 $1.5B whale deal) was $1.3B in Q4 2025.

---

## What Each Component Is Best For

**For quarterly AUM planning:** Use the realization forecast. It is the only model validated against actual quarterly outcomes.

**For pipeline health monitoring:** Track the penalized weighted forecast over time as a directional indicator. Is it growing or shrinking? Don't use the dollar amount as a target.

**For risk communication:** Use the Monte Carlo P10/P50/P90, but note that the P10 "bear case" is too optimistic. Actual outcomes fell below it 40% of the time.

**For SQO capacity planning:** The SQO target calculator was within 3-7 SQOs of what was needed in stable quarters.

**For whale deals:** Track them on a separate watchlist. No model can predict a single $1.5B outcome, and including them in probability math inflates the forecast every quarter they sit in the pipeline.

---

## Key Decisions and Why

**Denominator methodology.** Conversion rates use ALL SQOs as the denominator (including still-open), not just closed opps. Using closed-only produces artificially inflated rates (~99.6%) because you're only looking at deals that reached an outcome. Including open deals produces accurate rates (~69/43/45/90%).

**Point-in-time rate correction.** The single biggest improvement to the backtest. Adding `resolution_date < snapshot_date` to the rate cohort filter changed Q4 2024's cohort from 252 deals to 94. The leaked cohort included 158 deals whose outcomes weren't known yet. This correction alone shifted forecasts by hundreds of millions.

**AUM tier split at $75M.** Deals above $75M convert at roughly half the rate of smaller deals but carry 5-10x more AUM. Without tier segmentation, large deals dominate the forecast with inflated expected values.

**Deal-count bands for realization rates.** The realization rate (what fraction of committed AUM actually shows up) declines as more deals get anticipated dates. Fewer than 10 dated deals gets 60%, 10-15 gets 45%, and 15+ gets 35%. This captures the pattern that when more deals are "committed" to a quarter, more of them end up slipping.

---

## References

- [Detailed Backtest Results (Google Doc)](https://docs.google.com/document/d/1ClYLWDD4oO-ioKi0gZejrbrhJLc-Iz4ZsvPcS1-yO1Q/edit?usp=sharing)
- [Backtesting SQL Reference](backtesting_sql.md)
- [Full Technical Reference](forecast_explained.md)
- [Executive Summary](forecast_modeling_backtest_exec_doc.md)
- [Backtest Results Detail](forecast_modeling_backtest_results.md)
