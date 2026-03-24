# How the Pipeline Forecast Model Was Built

> This document explains, in plain language, how the Savvy Wealth pipeline forecast model works — how it was developed, what problems it solves, and the data-driven decisions behind it. It's intended for anyone who needs to understand the model without reading the underlying research code.
>
> **Last updated:** 2026-03-24

---

## The Problem We Started With

Every quarter, we need to predict how much AUM will join Savvy Wealth from the current pipeline. Each open deal has a stage (Discovery, Sales Process, Negotiating, Signed) and an AUM value. The forecast's job is to estimate which deals will close and when.

The original model was simple: compute a historical conversion rate at each funnel stage, multiply them together to get a P(Join) for each deal, then multiply by the deal's AUM. Sum those up and you have the forecast.

**It was wrong by 100-600% in every backtest quarter.** The model predicted $2-5B when the actual joined AUM was $0.6-1.1B. It never under-predicted — it was always too high, often by 2-6x.

Two root causes drove this:

1. **A deal sitting in Sales Process for 300 days got the same probability as one that entered yesterday.** In reality, stale deals convert at less than one-fifth the rate of fresh ones.
2. **A $500M deal got the same probability as a $20M deal at the same stage.** Larger-book advisors convert at meaningfully lower rates, but because they contribute disproportionately to the dollar-weighted forecast, a few large stale deals inflated the number by billions.

---

## How Conversion Rates Are Calculated

### The cohort: only resolved deals

We only compute rates from deals whose outcome is known — deals that have either **Joined** or **Closed Lost**. Open deals are never in the denominator. This prevents the rates from being distorted by deals that haven't had time to play out.

The cohort is filtered by the trailing window the user selects (180 days, 1 year, 2 years, or all time), based on the opportunity's created date.

### "Reached or beyond" denominators

A naive approach would count how many deals entered Sales Process and how many of those entered Negotiating. But deals sometimes skip stages — a deal might go from SQO directly to Negotiating with no Sales Process timestamp. If we required a Sales Process timestamp in the denominator, the SP→Neg rate could exceed 100%.

We solve this with COALESCE chains. For each deal, we ask "did this deal reach Sales Process **or any later stage**?" using backfilled timestamps:

- **Reached SP or beyond:** has a SP timestamp, OR a Neg timestamp, OR a Signed timestamp, OR a Joined timestamp
- **Reached Neg or beyond:** has a Neg timestamp, OR a Signed timestamp, OR a Joined timestamp
- And so on

This ensures the denominator at each stage includes every deal that got at least that far, even if it skipped the stage. Rates always stay between 0% and 100%.

### The four stage rates

| Transition | What it measures |
|------------|-----------------|
| SQO → SP | Of all resolved SQOs, what fraction reached Sales Process or beyond? |
| SP → Neg | Of those that reached SP+, what fraction reached Negotiating or beyond? |
| Neg → Signed | Of those that reached Neg+, what fraction reached Signed or beyond? |
| Signed → Joined | Of those that reached Signed+, what fraction actually Joined? |

These four rates, multiplied together, give the end-to-end SQO → Joined rate. We verified this product property against a direct count of Joined/Total and they match exactly (14.0% all-time).

### Average days in stage

Computed from the same resolved cohort, but only from deals that actually completed the transition (both entry and exit timestamps exist). If a deal entered SP but closed lost without ever reaching Neg, it doesn't contribute to the "average days in SP" metric. This gives us the expected time between stages for deals that successfully progress.

### Auditability

The Google Sheets export includes a **"BQ Rates and Days"** tab where every rate and average-days value is a live Sheets formula referencing the raw deal data in the "BQ Audit Trail" tab. You can click any cell to see the math — it references the 0/1 denominator and numerator flags on each deal row. No black boxes.

---

## How We Arrived at the Duration Multiplier

### The data exploration

Using the full 2-year resolved cohort, we computed the average number of days deals spend in each stage and the standard deviation. Then we bucketed every deal into three groups:

- **Within 1 SD:** Normal duration — deal is progressing at a typical pace
- **1-2 SD over:** Moderately stale — lingering but not dead
- **2+ SD over:** Very stale — significantly beyond normal duration

The thresholds:

| Stage | Normal (≤1 SD) | Moderately Stale (1-2 SD) | Very Stale (2+ SD) |
|-------|---------------|--------------------------|-------------------|
| Discovery/Qualifying | ≤ 36 days | 37-64 days | > 64 days |
| Sales Process | ≤ 67 days | 68-105 days | > 105 days |
| Negotiating | ≤ 50 days | 51-81 days | > 81 days |
| Signed | No penalty applied (insufficient data) | | |

### The join rates by bucket

For each stage × bucket combination, we computed what fraction of deals in that bucket eventually joined:

| Stage | Within 1 SD | 1-2 SD | 2+ SD |
|-------|------------|--------|-------|
| Discovery | 15.0% (N=600) | 10.0% (N=40) | 5.9% (N=68) |
| Sales Process | 23.3% (N=382) | 17.6% (N=68) | **4.1% (N=74)** |
| Negotiating | 60.4% (N=154) | 41.2% (N=17) | **10.8% (N=37)** |

The drop-off is dramatic: a Sales Process deal that's been sitting for 105+ days joins at 4.1% — about one-fifth the rate of a fresh SP deal. A Negotiating deal past 81 days joins at 10.8% vs 60.4% for fresh deals.

### The multipliers

We express the penalty as a multiplier: `bucket join rate / normal join rate`. This gives us:

| Stage | 1-2 SD Multiplier | 2+ SD Multiplier |
|-------|-------------------|-----------------|
| Discovery/Qualifying | 0.667 | 0.393 |
| Sales Process | 0.755 | 0.176 |
| Negotiating | 0.682 | 0.179 |
| Signed | 1.0 (no penalty) | 1.0 (no penalty) |

### How and why the multiplier is applied

The multiplier only adjusts the **current stage** conversion rate. Subsequent stage rates are left unchanged. The logic: if a deal has been stuck in Negotiating for too long, that tells us something about the Neg→Signed transition for this deal. But if it does manage to get signed, it's back on a normal path — the Signed→Joined rate shouldn't be penalized.

Example: A Negotiating deal at 90 days (2+ SD):
- `adjusted_neg_to_signed = neg_to_signed × 0.179`
- `signed_to_joined` stays unchanged
- `adjusted P(Join) = adjusted_neg_to_signed × signed_to_joined`

A natural question is: why use a multiplier instead of just using the bucket join rates directly? After all, the multiplier is derived from those rates — for example, the 2+ SD Negotiating multiplier of 0.179 comes from dividing 10.8% by 60.4%. Mathematically, applying the multiplier to the base rate gives you the bucket rate back: `60.4% × 0.179 = 10.8%`. They are the same thing.

The reason is that the bucket join rates were computed from the all-time resolved cohort, but the user can select different trailing windows on the dashboard (180 days, 1 year, 2 years, or all time). Each window produces different base rates — for example, the all-time Neg→Signed rate is 53.8% but the 1-year rate might be 50.5%. If we hardcoded the bucket join rates (10.8%), a stale Negotiating deal would always get 10.8% regardless of which window was selected. With the multiplier approach, the penalty scales with the selected window: `50.5% × 0.179 = 9.0%` for the 1-year window, `53.8% × 0.179 = 9.6%` for all-time. The multiplier encodes the relative penalty — stale deals convert at roughly 18% of the rate of fresh deals — and lets that ratio apply consistently no matter which base rates are in use.

### Why no Signed penalty

The Signed stage had only 9 deals in the 1-2 SD bucket and 6 in the 2+ SD bucket — too sparse for reliable multipliers. The 2+ SD bucket showed 100% join rate, which is clearly a small-sample artifact (all 6 happened to join). We set the Signed multiplier to 1.0 (no penalty) and flagged it for revisiting when more data accumulates.

---

## P(Join): What It Is and Its Iterations

### Baseline P(Join)

The simplest version: multiply the flat historical conversion rates for all remaining stages. A Negotiating deal's baseline P(Join) = `neg_to_signed × signed_to_joined`. Every deal at the same stage gets the same number.

**Problem:** This ignores how long the deal has been in its stage and how large it is. A $500M Discovery deal at 200 days gets the same P(Join) as a $20M Discovery deal at 5 days.

### Duration-Adjusted P(Join)

Apply the duration multiplier to the current stage rate. A fresh Negotiating deal might have P(Join) = 0.505 × 0.885 = 44.7%. The same deal at 90 days (2+ SD) would have P(Join) = (0.505 × 0.179) × 0.885 = 8.0%.

**Backtest improvement:** Average error dropped from 156% to 52%.

### Tier-Adjusted P(Join)

Instead of one set of rates for all deals, we split into two tiers at $75M AUM:
- **Lower tier (< $75M):** higher conversion rates (15.5% end-to-end)
- **Upper tier (≥ $75M):** lower conversion rates (9.4% end-to-end)

The $75M boundary was driven by sample size constraints. We originally explored 4 tiers, but the upper two tiers had only 9 and 11 all-time Joined deals — too few for reliable per-stage rates. Collapsing to 2 tiers at $75M gave the best tradeoff between statistical power and discriminative ability. When the Upper tier doesn't have at least 15 resolved deals in the trailing window, we automatically fall back to flat rates.

### Combined (Duration + Tier) Adjusted P(Join)

The final model: select the tier-appropriate rates, then apply the duration multiplier to the current stage rate. This is the **Adjusted P(Join)** shown in the dashboard and used for the expected AUM forecast.

**Backtest improvement:** Average error dropped from 156% (baseline) to 28%. A 5.6× improvement.

### Where all these values live in the export

The Google Sheets export shows all iterations side by side for every deal:
- **Column Q:** P(Join) — the flat-rate formula (Sheets formula linking to individual rate columns)
- **Column AB:** Baseline P(Join) — the tier-selected rate product before duration penalty
- **Column AC:** Adjusted P(Join) — the final value after tier selection and duration penalty
- **Column AD:** Baseline Expected AUM — AUM × Baseline P(Join)
- **Column AE:** Adjusted Expected AUM — AUM × Adjusted P(Join)

---

## Why Weighted AUM Is Recommended Over Monte Carlo for Finance Forecasting

The Monte Carlo simulation is a powerful tool for understanding the **range** of possible outcomes, but the deterministic weighted-AUM forecast (sum of Adjusted P(Join) × AUM across all deals) is more appropriate for finance planning. Here's why:

### The distribution is lumpy, not smooth

The Monte Carlo runs 5,000 random scenarios. In each scenario, every deal independently "flips a coin" at each remaining stage to determine if it advances. The total joined AUM in each scenario is the sum of AUM for deals where all their coin flips came up heads.

In theory, with enough independent deals, the distribution of outcomes should be roughly bell-shaped. In practice, a few whale deals ($500M+) dominate the distribution. Whether one specific $1.3B Discovery deal joins or not swings the total by more than the combined contribution of 50 smaller deals. This makes the distribution right-skewed and lumpy — not the smooth bell curve that P10/P50/P90 percentiles assume.

### Backtesting showed the P10-P90 range was too narrow

We backtested the Monte Carlo's P10-P90 range across 6 historical quarters. A well-calibrated 80% confidence interval should contain the actual outcome 80% of the time. Ours contained it only **67% of the time** (4 out of 6 quarters). Both misses were below P10 — the model never predicted outcomes optimistic enough to miss above P90. The interval systematically underestimates the downside.

### Zombie whale deals distort the simulation

Two specific deals — one at $1.3B and one at $800M — sat in Discovery across all 6 backtest quarters and eventually Closed Lost. Combined, they contributed $2.1B of phantom pipeline every quarter. In each Monte Carlo trial, there was a small chance these deals "joined," creating an artificially inflated right tail. The weighted-AUM forecast also overweighted these deals, but the duration penalty (Discovery, 2+ SD) correctly down-weighted their contribution by 60-80%. The Monte Carlo couldn't penalize them as effectively because the Bernoulli draw is binary — the deal either joins or doesn't in each trial.

### What the Monte Carlo IS good for

The Monte Carlo is valuable for **scenario communication** — showing stakeholders "here's the bear case, base case, and bull case" as concrete dollar amounts rather than abstract probabilities. It's also useful for identifying concentration risk: if 60% of the P50 outcome depends on 3 deals, that's important context for planning.

**Our recommendation:** Use the deterministic weighted-AUM forecast (Adjusted Expected AUM) for financial planning and goal-setting. Use the Monte Carlo P10/P50/P90 for risk communication and scenario planning. Present whale deals (>$500M) separately so their outsized impact is visible.

---

## How the Monte Carlo Simulation Works

### The setup

The simulation runs entirely in BigQuery as a single SQL query. The code lives in `src/lib/queries/forecast-monte-carlo.ts`.

**Step 1 — Gather the pipeline:** The `open_pipeline` CTE pulls all current open deals (SQO = Yes, not On Hold/Closed Lost/Joined) with their AUM, stage, days in current stage, and anticipated join date.

**Step 2 — Compute per-deal rates:** The `deal_rates` CTE determines each deal's AUM tier (Lower or Upper at the $75M boundary), duration bucket (Within 1 SD, 1-2 SD, or 2+ SD based on days in stage), and duration multiplier. It then computes:
- `adjusted_current_rate` = the current stage's base rate × the duration multiplier, clamped between 0 and 1
- `base_sp_neg`, `base_neg_signed`, `base_signed_joined` = the tier-appropriate rates for subsequent stages (no penalty applied)

**Step 3 — Generate trials:** The `trials` CTE creates 5,000 trial IDs using `GENERATE_ARRAY(1, 5000)`.

### The coin flips

The `simulation` CTE cross-joins every deal with every trial (e.g., 150 deals × 5,000 trials = 750,000 rows). For each deal × trial combination, it simulates the deal's progression through the remaining funnel stages using independent random draws.

For a deal currently in Sales Process, the simulation flips three coins:
1. `RAND() < adjusted_current_rate` — does the deal advance from SP to Neg? (penalized by duration)
2. `RAND() < base_neg_signed` — does it advance from Neg to Signed? (tier rate, no penalty)
3. `RAND() < base_signed_joined` — does it advance from Signed to Joined? (tier rate, no penalty)

The deal "joins" in that trial only if ALL remaining coin flips come up heads. The result is a `joined_in_trial` flag (1 or 0) for each deal × trial.

Each trial also computes a projected join date for the deal (using either the recruiter's anticipated date if set, or a model date based on average stage durations).

### How P10, P50, and P90 are computed

**Aggregate query:** For each trial, sum the AUM of all deals that joined in that trial, grouped by projected quarter. This gives 5,000 total-AUM values per quarter. Then:

- **P10 (Bear case):** The 10th percentile — 90% of trials produced more AUM than this
- **P50 (Base case):** The median trial outcome
- **P90 (Bull case):** The 90th percentile — only 10% of trials exceeded this

These are computed using BigQuery's `APPROX_QUANTILES(aum, 100)[OFFSET(10/50/90)]`.

**Per-deal query:** For each deal, compute `win_pct = count of trials where it joined / 5,000`. This is the empirical win percentage shown in the drilldown — it's close to the deal's P(Join) but not identical because of sampling noise across 5,000 random draws.

---

## Anticipated Date Reliability

### What Phase 7.1 originally found

The initial research measured the **final** anticipated date (after all revisions) against the actual join date and found it was remarkably accurate: +2 days average slip, 73% of deals joining on the exact date.

### What we discovered when we looked deeper

By examining the `OpportunityFieldHistory` table, we found that 57% of deals with an anticipated date have revised it at least once, and 92% of revisions push the date later. The average deal's anticipated date is pushed out 17 days over its lifetime.

The "+2 days accuracy" of the final date is an artifact of iterative revision — recruiters chase the date forward to match reality. The **first** anticipated date (the one that exists when the forecast first uses it) is off by an average of +18 days, with 65% of deals joining later than initially estimated.

| Revisions | Avg First-Date Slip | Avg Final-Date Slip |
|-----------|--------------------|--------------------|
| 1 (set once) | +8.5 days | +3.5 days |
| 2 | +10.7 days | +0.4 days |
| 3 | +17.7 days | +0.6 days |
| 4+ | **+40.7 days** | +0.2 days |

Deals with 4+ revisions have first-date slip of over a month, but their final date is accurate to within a day — the revision process creates the accuracy.

### Current impact

In the current pipeline, 12 deals with 3+ date revisions carry $1.34B in AUM. Their dates have been pushed an average of 227 days. All 4 Signed deals with anticipated dates have been revised, with an average of 176 days of drift. The dashboard now shows a **Date Confidence** indicator (green/amber/red dot) next to deals using an anticipated date, based on revision count.

---

## Backtesting Summary

| Model | Avg Error (MAPE) | Best Quarter | Worst Quarter |
|-------|-----------------|-------------|---------------|
| Baseline (flat rates) | **156%** | +35% | +633% |
| + Duration penalty only | **52%** | -2% | +252% |
| + Tiered rates only | **90%** | +21% | +176% |
| **+ Duration + Tiered (shipped)** | **28%** | -8% | +91% |

The combined model reduced forecast error by 5.6×. It slightly under-predicts in some quarters (-8% to -11%), which is preferable to the baseline's systematic massive over-prediction.

The remaining +91% worst case (Q3 2025) is partially driven by 15 deals that were still open at that snapshot point and two persistent zombie whale deals that eventually closed lost.

---

## How the SQO Target Calculator Works

The forecast model tells us how much AUM the current pipeline is expected to produce. But leadership also needs to answer the reverse question: **"If we want $1B of joined AUM next quarter, how many SQOs do we need to create — and when?"**

The SQO Target Calculator answers this. On the dashboard, each quarter card has a Target AUM input. When you type a number, the system immediately shows how many additional SQOs are needed to close the gap between what the pipeline is already producing and what the target requires.

### The formula

The core calculation is simple:

```
Expected AUM per SQO = Mean Joined AUM × SQO→Joined Rate

Gap = Target AUM - (Already Joined AUM + Projected Pipeline AUM)

Required SQOs = CEILING( Gap / Expected AUM per SQO )
```

**Mean Joined AUM** is the average AUM of deals that actually joined in the trailing window. **SQO→Joined Rate** is the product of the four stage conversion rates (SQO→SP × SP→Neg × Neg→Signed × Signed→Joined). Together, they tell you: for every SQO that enters the pipeline, how many dollars of AUM do you expect to eventually walk in the door?

The calculation accounts for what's already in the pipeline. If Q1 2026 has $2.4B of already-joined AUM and $238M of projected pipeline AUM against a $1B target, the gap is zero — you're already ahead. Only when the target exceeds the combined joined + projected total does the calculator show incremental SQOs needed.

### Why we use Joined Mean, not median

This was the most important decision in building the calculator. We tested six different approaches for the "AUM per SQO" value — three populations (Joined only, all resolved, all SQOs) crossed with two statistics (mean, median). We backtested each across six historical quarters, comparing the predicted "required SQOs" against the actual number of SQOs created in the prior quarter.

| Method | Mean Absolute Error | Bias |
|--------|-------------------|------|
| Joined Median | 74.7 SQOs | Always overestimates (2-3×) |
| Resolved Median | 28.8 SQOs | Moderate overestimate |
| All SQO Median | 25.3 SQOs | Moderate overestimate |
| **Joined Mean** | **16.5 SQOs** | **Slight underestimate (-11.8)** |
| Resolved Mean | 23.0 SQOs | Underestimates |
| All SQO Mean | 25.2 SQOs | Underestimates |

**Joined Mean won by a wide margin** — an average error of just 16.5 SQOs compared to 25-75 for every other method.

The reason medians fail is whale deals. When a $1.5B deal joins (as happened in Q4 2025), it delivers the AUM equivalent of ~50 median-sized deals in a single close. The median-based formula can't account for this, so it told us we needed 225-298 SQOs when we actually had 146. The mean naturally incorporates whale variance because it reflects the average AUM that actually walks in the door — including the occasional outsized deal that dramatically shifts the quarterly total.

The reason we use the Joined population (not all resolved SQOs or all SQOs) is that Closed Lost deals have *higher* median AUM ($42M) than Joined deals ($30.7M). Using the resolved pool would inflate the expected AUM per SQO, making the calculator think each SQO is worth more than it really is — leading to under-counting how many you need. Larger-book advisors are harder to close. The Joined-only mean captures what actually lands.

### SQO entry quarter: when do they need to come in?

Knowing you need 124 more SQOs is only half the answer. The other half is: when do those SQOs need to be created?

The model uses the **average SQO→Joined velocity** (the sum of avg days at each stage for deals that successfully progressed) to work backwards from the target quarter. If the average deal takes ~80 days from SQO to Joined, and you're targeting Q3 2026 (which starts July 1), the SQOs need to enter the pipeline around mid-May — which falls in Q2 2026.

The calculation takes the midpoint of the target quarter (approximately day 45 of the quarter), subtracts the avg velocity in days, and maps the resulting date to a quarter label. If that entry quarter is already in the past, the dashboard shows a red warning: those SQOs are at risk because the pipeline didn't have enough lead time.

### Current-quarter awareness

A subtlety that matters for practical use: the calculator is aware of what's already closed this quarter. For Q1 2026, if $2.4B of AUM has already joined and the target is $1B, the card shows "On track — exceeds target by $1.6B" rather than computing SQOs needed against only the open pipeline.

The total expected AUM for any quarter is:

```
Total Expected = Already Joined AUM (actual) + Projected Pipeline AUM (from open opps × P(Join))
```

Already-joined AUM comes from `vw_funnel_master` (deals where `is_joined = 1`, grouped by the quarter of their `advisor_join_date__c`). This is real, closed business — not a forecast. Projected AUM comes from the pipeline model described in the earlier sections of this document.

### Persistence and the Sheets export

Targets are saved to a Postgres table (`forecast_quarter_targets`) so they persist across sessions. Any user with scenario permissions can set or edit targets. The targets are shared — there's one target per quarter for the whole organization, not per user.

The Google Sheets export includes a **"BQ SQO Targets"** tab that shows the full gap analysis with Sheets formulas. Every quarter gets a row with: Target AUM, Joined AUM (actual), Projected AUM (pipeline), Total Expected, Gap, Coverage %, Status, Incremental SQOs Needed, Total SQOs for Full Target, and SQO Entry Quarter. The computed columns (Gap, Coverage, SQOs) are live formulas referencing the model inputs at the top of the sheet, which in turn reference the "BQ Rates and Days" tab. You can click any cell to trace how the number was derived.

### Low confidence warnings

The accuracy of the SQO calculation depends on having enough joined deals in the trailing window to produce a reliable mean AUM. When the joined deal count drops below 30, the dashboard shows a "Low confidence" warning. At the 180-day window, the sample is often just 13-14 deals and the mean AUM is volatile — a single whale deal joining or not can swing it by millions. The 1-year window (typically 45-50 joined deals) is the recommended default for target-setting.

---

## Where the Code Lives

| Component | File | What It Does |
|-----------|------|-------------|
| Duration thresholds & multipliers | `src/lib/forecast-config.ts` | All constants in one place |
| P(Join) computation | `src/lib/forecast-penalties.ts` | `computeAdjustedDeal()` — shared by UI and export |
| Tiered rates query | `src/lib/queries/forecast-rates.ts` | `getTieredForecastRates()` — BQ query returning flat/lower/upper |
| Monte Carlo SQL | `src/lib/queries/forecast-monte-carlo.ts` | `simulationCTE()` with deal_rates, trials, simulation CTEs |
| UI display | `src/app/dashboard/forecast/page.tsx` | `useMemo` calling `computeAdjustedDeal` per deal |
| Sheets export | `src/app/api/forecast/export/route.ts` | `recomputeP2WithRates` + `buildP2Values` |
| Parity tests | `src/lib/__tests__/forecast-penalties.test.ts` | 28 tests ensuring all code paths produce identical results |
| SQO target persistence | `src/app/api/forecast/sqo-targets/route.ts` | GET + POST for saving/loading quarterly AUM targets |
| SQO target UI | `src/app/dashboard/forecast/components/ForecastMetricCards.tsx` | Gap analysis, SQO calculator, entry quarter mapping |
| Joined AUM query | `src/lib/queries/forecast-pipeline.ts` | `getJoinedAumByQuarter()` — actual joined AUM per quarter |
| SQO Targets sheet export | `src/app/api/forecast/export/route.ts` | `buildSQOTargetsValues()` — full gap analysis with formulas |

---

## Appendix A: Why $75M Is the AUM Tier Boundary

### Starting point: the existing 4-tier structure

Salesforce already classifies deals into four AUM tiers at $25M, $75M, and $150M. We tested whether we could compute reliable per-tier conversion rates at this granularity.

**4-tier join rates (all-time resolved SQOs):**

| Tier | Resolved Deals | Joined | Join Rate | Smallest Late-Funnel Denominator |
|------|---------------|--------|-----------|----------------------------------|
| Tier 1 (< $25M) | 208 | 45 | 21.6% | 46 (Signed→Joined) |
| Tier 2 ($25M-$75M) | 397 | 49 | 12.3% | 53 (Signed→Joined) |
| Tier 3 ($75M-$150M) | 124 | 9 | 7.3% | **10** (Signed→Joined) |
| Tier 4 (> $150M) | 88 | 11 | 12.5% | **12** (Signed→Joined) |

Tier 3 has only 10 deals at the Signed→Joined denominator. One deal resolving differently would swing that rate by 10 percentage points. Tier 4's Neg→Signed denominator is 19 — similarly fragile. You can't build reliable per-stage rates on cells with 10-20 observations.

### Where the natural break is

The join rates show that Tier 1 (21.6%) and Tier 2 (12.3%) are both meaningfully higher than Tier 3 (7.3%) and Tier 4 (12.5%). The biggest behavioral gap is **between Tier 2 and Tier 3** — between below $75M and above $75M. Tier 4's higher rate vs Tier 3 (12.5% vs 7.3%) is likely noise from small samples, not a real signal that $150M+ deals convert better than $75-150M deals.

The SP→Neg transition is where the divergence is sharpest:

| Tier | SP→Neg Rate |
|------|------------|
| Tier 1 (< $25M) | 50.0% |
| Tier 2 ($25M-$75M) | 41.0% |
| Tier 3 ($75M-$150M) | **26.3%** |
| Tier 4 (> $150M) | 35.8% |

There's a clear drop at $75M. Below $75M, 41-50% of deals advance from SP to Neg. Above $75M, only 26-36% do. Larger-book advisors are harder to move past Sales Process — likely because the decision to switch platforms is higher-stakes with more AUM at play.

### The 2-tier collapse at $75M

Merging Tier 1 + Tier 2 into "Lower" and Tier 3 + Tier 4 into "Upper" at the existing $75M boundary:

| Tier | Resolved | Joined | Join Rate | SP→Neg Den | Neg→Signed Den | Signed→Joined Den |
|------|----------|--------|-----------|------------|----------------|-------------------|
| Lower (< $75M) | 605 | 94 | **15.5%** | 419 | 185 | 99 |
| Upper (≥ $75M) | 212 | 20 | **9.4%** | 129 | 39 | 22 |

Lower converts at **1.65× the rate of Upper** (15.5% vs 9.4%). The denominators, while still thin for Upper at Signed→Joined (22), are usable. The signal is real and consistent: Upper tier underperforms at every stage transition, most dramatically at SP→Neg (44.2% vs 30.2%).

### Why not a different boundary?

- **$75M is where the existing Salesforce tier boundary sits** — no new field logic needed
- **It's where the join rate drop is sharpest** in the data (the Tier 2 → Tier 3 gap)
- **Any lower** (e.g., $50M) would put too few deals in the Upper tier — the 1-year trailing Upper cohort would regularly fall below the 15-deal fallback threshold, triggering fallback to flat rates and negating the benefit
- **Any higher** (e.g., $100M) would lump $75-100M deals (which behave like Upper) into the Lower tier, diluting the signal

### The AUM field used

The tier classification uses `COALESCE(Underwritten_AUM__c, Amount)` — Underwritten AUM if it's been set (the vetted value populated during diligence), otherwise the initial Salesforce Amount. This is consistent across the tiered rates query, Monte Carlo SQL, and client-side computation.

### The fallback safety net

When the Upper tier has fewer than 15 resolved deals in the selected trailing window (which happens at shorter windows like 180 days, or at early historical snapshots where Upper had as few as 4 deals), the model automatically falls back to flat rates for Upper-tier deals. It doesn't use statistically meaningless rates just because they exist — it waits for enough data to be reliable.
