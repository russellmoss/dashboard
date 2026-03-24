# How We Forecast Joined Advisor AUM — And Why We Changed the Model

---

## What Are We Trying to Predict?

Every quarter, we need to answer one question: **how much AUM will join Savvy Wealth in the coming months?**

We have a pipeline of advisor opportunities at various stages — Discovery, Sales Process, Negotiating, and Signed. Each deal has an AUM value (the assets the advisor would bring). Some of these deals will close. Most won't. The forecast's job is to estimate how much total AUM we should expect to land, and roughly when.

---

## How the Forecast Works (The Short Version)

Every open pipeline deal gets a **probability of joining**. That probability is based on how deals like it have historically performed — specifically, what percentage of deals at each funnel stage eventually made it all the way to Joined.

For each deal: **Expected AUM \= Probability of Joining × Deal AUM**

Add those up across the pipeline and you get the forecast. The Monte Carlo simulation runs 5,000 random scenarios on top of this to show a range of outcomes (bear case, base case, bull case) rather than just one number.

---

## Why Straight Weighted Pipeline Wasn't Good Enough

When we backtested the original model — meaning we went back in time, reconstructed what the pipeline looked like at past quarter starts, ran the forecast, and compared it to what actually happened — the results were sobering.

**The original model over-predicted AUM by 100-600% in every single quarter we tested.** It never under-predicted. Not once.

For example, at the start of Q1 2025, the model predicted $2.36B in expected AUM from the pipeline. The actual AUM that joined from those deals was $940M. That's a \+152% error — the forecast was 2.5× too high.

At its worst (Q3 2024), the model predicted $4.60B. Only $628M joined. That's \+633% — off by more than 6×.

**This wasn't a Monte Carlo problem.** The Monte Carlo simulation faithfully reflected the inputs it was given. The inputs themselves were wrong. Two specific problems drove the errors:

### Problem 1: Every deal at the same stage got the same probability

A deal that entered Sales Process yesterday and a deal that had been sitting in Sales Process for 300 days both received the same probability of joining. In reality, these are very different deals. Our historical data showed that deals lingering more than 2 standard deviations above the average stage duration convert at **less than one-fifth** the rate of fresh deals:

- Fresh Sales Process deals join at 23.3%  
- Stale Sales Process deals (\>105 days) join at 4.1%  
- Fresh Negotiating deals join at 60.4%  
- Stale Negotiating deals (\>81 days) join at 10.8%

The model was treating hundreds of stale, stuck deals as if they were just as likely to close as deals that were actively moving through the funnel. This inflated the forecast massively.

### Problem 2: Big-book and small-book advisors got the same probability

A $200M advisor and a $20M advisor at the same stage received identical conversion probabilities. But our data showed that larger-book advisors convert at a meaningfully lower rate — roughly 60% of the rate of smaller books. The key gap is at the Sales Process → Negotiating transition, where larger deals advance at about half the rate.

Because the large-AUM deals contribute disproportionately to the dollar-weighted forecast, this flat treatment inflated the expected AUM even further. A few billion-dollar Discovery deals that were never going to close were each adding hundreds of millions in "expected" AUM to the forecast.

---

## What We Changed

We made two evidence-based adjustments to the model. Both are derived from Savvy's own historical data, not theoretical assumptions.

### Change 1: Duration Penalty

Deals that have been stuck in a stage for an unusually long time now receive a reduced probability of joining. We define "unusually long" based on the historical average and standard deviation of time spent in each stage:

- **Within normal range:** Full conversion probability (no penalty)  
- **Moderately stale (1-2 standard deviations over average):** Probability reduced to roughly 67-76% of the fresh-deal rate, depending on stage  
- **Very stale (more than 2 standard deviations over average):** Probability reduced to roughly 18-39% of the fresh-deal rate

The penalty only applies to the deal's current stage. If a Negotiating deal is stale, we reduce the Negotiating → Signed probability, but we leave the Signed → Joined probability unchanged — because if the deal does manage to get signed, it's back on a normal path.

**This single change reduced the forecast error from 156% to 52% in our backtests.** It is the highest-impact improvement in the model.

### Change 2: AUM-Tiered Conversion Rates

Instead of applying one set of conversion rates to all deals, we split the pipeline into two tiers:

- **Lower tier (AUM below $75M):** Uses conversion rates computed from historically resolved deals below $75M  
- **Upper tier (AUM at or above $75M):** Uses conversion rates computed from historically resolved deals at or above $75M

The Upper tier converts at roughly 60% of the Lower tier rate overall (9.4% vs 15.5% SQO-to-Joined). This means a $200M Discovery deal now gets a more realistic (lower) probability than a $30M Discovery deal.

When the Upper tier doesn't have enough historical data to produce reliable rates (fewer than 15 resolved deals in the trailing window), the model automatically falls back to using the overall rates instead — it doesn't use bad data just because it's available.

**Combined with the duration penalty, the tiered rates brought the forecast error down from 52% to 28% in backtests.**

---

## How the Monte Carlo Simulation Uses These Changes

The Monte Carlo simulation runs 5,000 random scenarios. In each scenario, every deal independently "flips a coin" at each remaining stage — will it advance, or won't it? The probability of each coin flip is now specific to that deal based on its AUM tier and how long it's been in its current stage.

This means the simulation now produces more realistic ranges. A pipeline dominated by fresh, small-book deals in late stages will show a tight P10-to-P90 range (high confidence). A pipeline dominated by stale, large-book deals in early stages will show a wide range (low confidence). That's the right behaviour — the simulation is reflecting the actual uncertainty in the pipeline, not just applying a blanket average.

The simulation still produces P10 (bear case), P50 (base case), and P90 (bull case) for each quarter. The expected AUM metric cards on the dashboard show the probability-weighted forecast, which is the number most useful for planning.

---

## What the Backtests Show

We tested the enhanced model against 6 historical quarters (Q3 2024 through Q4 2025\) by reconstructing the pipeline as it looked at the start of each quarter, computing what the model would have predicted, and comparing against actual joined AUM.

| Model | Average Error | Best Quarter | Worst Quarter | Bias |
| :---- | :---- | :---- | :---- | :---- |
| **Original (flat rates)** | **156% too high** | \+35% | \+633% | Always over-predicts |
| **Enhanced (duration penalty \+ tiers)** | **28% error** | \-8% (slightly conservative) | \+91% | Slightly conservative |

Three of five fully testable quarters were within ±11% error under the enhanced model — operationally useful forecasts. The original model was never closer than \+35%.

The model shifted from always over-predicting (sometimes by 6×) to being slightly conservative in most quarters. From a planning perspective, a model that slightly under-predicts is healthier than one that routinely promises AUM that never materialises.

---

## What We Realistically Expect Going Forward

The 28% backtest error is the optimistic bound. In live forecasting, we expect **30-50% error** in a typical quarter, for a few reasons:

- The penalty multipliers were calibrated on the same historical data we backtested against — forward performance will be somewhat less precise  
- Some data fields used in the backtest (like AUM values) may have been updated after the snapshot dates, giving the backtest a small informational advantage that live forecasting won't have  
- Quarters dominated by a single whale deal outcome (a $500M+ deal that either closes or doesn't) will always have higher error because no probability model can predict a binary coin flip

Even at the conservative end of that range, a 50% error is still **3× more accurate** than the current model's 156%. And in quarters without unusual whale outcomes, we expect performance closer to the 28% backtest number.

**What the model cannot do:**

- Predict which specific deals will close — it assigns probabilities, not certainties  
- Eliminate the impact of large-AUM concentration — when half the pipeline AUM sits in 14% of deals, a few outcomes swing everything  
- Predict timing with precision for early-stage deals — the timing model works well for Negotiating and Signed deals (96% correct quarter placement when recruiters set an anticipated date), but early-stage deals often take much longer than the model projects

---

## How We Keep the Model Accurate Over Time

The conversion rates, duration thresholds, and penalty multipliers that drive this model are based on historical data. As the business evolves — new lead sources, changing market conditions, different deal sizes — these values can drift. A model that was accurate in Q2 2026 may become stale by Q1 2027 if the underlying patterns shift.

To prevent this, **the model is recalibrated once per quarter.** At the start of each quarter, we:

1. **Recompute the duration thresholds** — how long is "normal" for each stage? If deal velocity has changed (deals are closing faster or slower), the thresholds shift accordingly.  
     
2. **Recompute the penalty multipliers** — do stale deals still convert at the same reduced rate, or has the pattern changed?  
     
3. **Verify the AUM tier split** — is the $75M boundary still producing meaningfully different conversion rates between small and large books? If the gap has closed, we may simplify back to a single rate set.  
     
4. **Compare last quarter's forecast against actuals** — did the model's prediction for the quarter that just ended land within an acceptable range? If the error exceeded 40%, we investigate what changed.  
     
5. **Update the configuration only when changes are material** — we don't tweak the model every quarter just because we can. If thresholds have moved by less than 10 days and multipliers have moved by less than 5 percentage points, we leave them alone. Stability in the model is a feature, not a bug.

The detailed recalibration instructions, including the specific queries to run and the decision criteria for when to update, are maintained at:

**`C:\Users\russe\Documents\Dashboard\docs\forecast\quarterly_forecast_recalibration.md`**

---

## Key Numbers to Know

| Metric | Value | Context |
| :---- | :---- | :---- |
| Overall pipeline-to-join rate | \~10-15% | Only 1 in 7-10 SQOs eventually joins |
| Historical Joined deals (all-time) | \~114 | The sample size our model is built on |
| Deals currently in pipeline | \~145 | Open SQOs as of March 2026 |
| Total pipeline AUM | \~$22.9B | Raw AUM before probability weighting |
| Stale deals (2+ SD over in stage) | 24 deals, $4.6B AUM | 17% of deals, 20% of pipeline AUM |
| Advisor Referral join rate | 55.6% | 5.5× higher than Outbound (10.2%) |
| Recruiter anticipated date accuracy | 96% correct quarter | When the date is populated |

---

## Glossary

**P(Join):** The probability that a deal will ultimately reach "Joined" status. Computed as the product of remaining stage conversion rates, adjusted for deal duration and AUM tier.

**Expected AUM:** P(Join) × Deal AUM. The probability-weighted contribution of a single deal to the forecast.

**Duration Penalty:** A multiplier (between 0 and 1\) applied to deals that have been in their current stage longer than historical norms suggest is healthy. Fresh deals get 1.0× (no penalty). Very stale deals get as low as 0.176× (an 82% reduction in their stage conversion probability).

**AUM Tier:** Deals are split into Lower (below $75M) and Upper ($75M and above) for the purpose of applying different historical conversion rates. Larger-book advisors historically convert at lower rates.

**Monte Carlo Simulation:** A method that runs 5,000 random scenarios across the pipeline to produce a range of possible outcomes (P10/P50/P90) rather than a single point estimate.

**P10 / P50 / P90:** The 10th, 50th, and 90th percentile outcomes from the Monte Carlo simulation. P10 is the bear case (only 10% of simulated outcomes were worse). P50 is the base case. P90 is the bull case.

**MAPE (Mean Absolute Percentage Error):** The average percentage by which the forecast missed the actual outcome, measured across multiple quarters. Lower is better. Our target is below 40%.

**Trailing Window:** The time period used to compute historical conversion rates. We primarily use a 1-year trailing window (rates based on deals created in the last 12 months), with longer windows as a stability cross-check.

**Recalibration:** The quarterly process of verifying that the model's parameters (thresholds, multipliers, tier boundary) still reflect current reality, and updating them if they've drifted materially.  
