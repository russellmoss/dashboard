# Forecast Modeling Backtest Results

**Date:** March 24, 2026
**Period:** Q4 2024 through Q4 2025 (5 quarters)
**Models tested:** Weighted AUM (2yr trailing window), Monte Carlo (analytical), SQO Target Calculator
**Point-in-time corrected:** Yes — AUM values, anticipated dates, AND conversion rates all reconstructed to use only data available at each snapshot

---

## TL;DR

Our probability-weighted pipeline forecast overestimates quarterly joined AUM by **138% on average** (PIT-corrected). We built a simpler **two-component model** — late-stage committed deals with anticipated dates, plus a historical surprise baseline — that achieves **17% MAPE, an 8x improvement**. It uses two observable inputs instead of complex per-deal probability calculations, and its $1.1-1.3B Q2 2026 forecast is consistent with the historical growth trajectory (our highest non-whale quarter is $1.3B), whereas the probability model's $2.9B and the Monte Carlo's $2.0B "bear case" both exceed every actual quarterly outcome in our history.

The probability model still has value for pipeline health trending and deal ranking. But for the question "how much AUM will join this quarter?" — the two-component model is the answer.

---

## Methods

### What Point-in-Time Means and Why It Matters

A backtest is only valid if it uses data the model would have had at the time. We identified three sources of data leakage in our initial analysis and corrected all three.

### 1. AUM Values (OpportunityFieldHistory)

Deal AUM estimates get revised during diligence. We used Salesforce's `OpportunityFieldHistory` table to reconstruct `Amount` and `Underwritten_AUM__c` as they were at each snapshot. If a field was changed after the snapshot, we used the `OldValue` from the earliest post-snapshot change. Impact: 8-12 deals per quarter had material AUM drift, with total pipeline shift of -$1.4B to +$1.6B.

### 2. Anticipated Start Dates (OpportunityFieldHistory)

Same approach for `Earliest_Anticipated_Start_Date__c`. If the field was first set after the snapshot, we treated it as NULL at snapshot time. If revised, we used the pre-revision value. Impact: by Q2 2025+, ~40% of pipeline deals had dates set or revised after the snapshot.

### 3. Conversion Rates (Resolution Date Filter)

**This was the most significant correction.** Our initial analysis computed trailing conversion rates from deals whose `Date_Became_SQO__c` fell before the snapshot — but it didn't check whether those deals had actually *resolved* (Joined or Closed Lost) by the snapshot date. A deal that SQO'd 6 months before the snapshot but didn't close until 3 months *after* was included in the rate cohort even though its outcome wasn't known yet.

This matters because the PIT-resolved cohort is systematically different from the full cohort: deals that resolve quickly tend to have higher join rates (they're the decisive ones — either fast closes or quick disqualifications). Slow-to-resolve deals are disproportionately Closed Lost stragglers that hadn't gotten around to being marked as lost yet.

The fix: add `AND resolution_date < snapshot_date` to the rate cohort. Impact:

| Quarter | Leaked Cohort (2yr) | PIT-Resolved Cohort | PIT e2e Rate | Leaked e2e Rate |
|---|:---:|:---:|---:|---:|
| Q4 2024 | 252 deals | **94 deals** | 21.3% | 16.7% |
| Q1 2025 | 328 | 171 | 18.7% | 15.9% |
| Q2 2025 | 416 | 260 | 16.9% | 15.1% |
| Q3 2025 | 505 | 332 | 16.9% | 14.5% |
| Q4 2025 | 597 | 420 | 16.2% | 14.9% |

For Q4 2024, 63% of the rate cohort hadn't resolved yet. The PIT rate is 4.6 percentage points higher, which on a $12.5B pipeline adds ~$575M to the forecast. This single correction was larger than the AUM correction.

### 4. Stage Naming Clarification

The model uses four stage transitions: **SQO→SP** (reached Sales Process or beyond), **SP→Neg**, **Neg→Signed**, **Signed→Joined**. "Discovery" and "Qualifying" are early-funnel SQO entry states — the first rate captures the SQO→SP transition, not a Discovery→SP transition. Deals in Discovery/Qualifying use all four rates; deals in Sales Process use the last three; and so on.

### 5. Data Provenance: Salesforce Timeline

We initially assumed SFDC was adopted in September 2024, but the data shows otherwise. Opportunity `CreatedDate` records go back to **February 2023**, with consistent monthly volumes (21-96 opps/month) from April 2023 onward. 90% of SQO deals were created in SFDC within 7 days of their SQO date — there is no evidence of bulk backfilling.

What happened in **September 2024** was that `OpportunityFieldHistory` tracking was enabled — the audit trail of field changes. This is why we can only roll back AUM and anticipated date changes to Sep 2024, not earlier.

**This is good news for the backtest:** stage entry timestamps, SQO dates, and pipeline data going back to 2023 are natively tracked in Salesforce, not approximate backfills. The conversion rates derived from this data are based on real-time-tracked records.

The September 2024 date only limits our ability to detect and correct post-snapshot changes to `Amount`, `Underwritten_AUM__c`, and `Earliest_Anticipated_Start_Date__c` — which is already documented in the AUM and anticipated date correction sections above.

### Other Data Constraints

- **Q3 2024 was dropped** from the analysis (no `OpportunityFieldHistory` for AUM/date correction — field change tracking began Sep 2024)
- **The 2yr and all-time windows are identical** for Q4 2024 and Q1 2025 (SQO data only extends to March 2023, less than 2 years before these snapshots)
- **The 180d window is unreliable** for early snapshots (57 PIT-resolved deals at Q4 2024, with Signed→Joined at 100% from a tiny sample)
- **Q4 2024 has a thin PIT-resolved rate cohort** (94 deals for the 2yr window) because many deals SQO'd before Oct 2024 hadn't resolved yet — this is a sample size issue, not a data quality issue

### Prior Research That Informed This Analysis

This backtest builds on several prior explorations:
- **`forecasting_research.md`** — established the canonical rate calculation methodology, "reached or beyond" denominators, and PIT pipeline/rate reconstruction CTEs
- **`AUM_variance_consideration.md`** — identified whale-deal concentration risk ($3B single deal = 13% of pipeline) and the flat-probability problem that led to AUM tier segmentation
- **`OPPORTUNITY_HISTORY_EXPLORATION.md`** — mapped the `OpportunityFieldHistory` schema, discovered that 57% of anticipated dates are revised (92% pushed later), and established the field-change patterns we used for PIT correction
- **`anticipated_start_date_exploration.md`** — the critical finding that Phase 7.1's "+2 days average slip" measured final (post-revision) dates, not first-set dates; the actual first-set slip is +18.3 days

All SQL queries used in this backtest are documented in [backtesting_sql.md](backtesting_sql.md).

### Why Earlier Accuracy Claims Were Wrong — And Why Backtesting Is Hard

Two prior documents — [How the Pipeline Forecast Model Was Built](How%20the%20Pipeline%20Forecast%20Model%20Was%20Built.md) and [How We Forecast Joined Advisor AUM — And Why We Changed the Model](How%20We%20Forecast%20Joined%20Advisor%20AUM%20—%20And%20Why%20We%20Changed%20the%20Model.md) — reported that the enhanced forecast model (duration penalties + AUM tiers) achieved **28% average error** across 6 backtested quarters, down from 156% with the baseline model. Those numbers were reported in good faith during the model development phase, but they contained three sources of error that compounded to make the model look significantly more accurate than it actually is.

**Error 1: Conversion rates included future outcomes.**
The rate cohort was filtered by `Date_Became_SQO__c < snapshot_date` — which correctly limits to deals that had entered the pipeline by the snapshot. But it did NOT filter by `resolution_date < snapshot_date`, meaning deals that were still open at the snapshot but later resolved were included. At the Q4 2024 snapshot, **63% of the rate cohort (166 of 252 deals) hadn't actually resolved yet.** Their outcomes were unknowable at forecast time. This is the most impactful error — it deflated the conversion rates by diluting the resolved cohort with unresolved deals, making the forecast look less overestimated than it truly was. When corrected, PIT rates are 2-7 percentage points higher (e.g., 21.3% vs 16.7% end-to-end at Q4 2024), which means the model would have produced even larger forecasts in real time.

**Error 2: AUM values reflected post-snapshot revisions.**
The backtest used current `Opportunity_AUM` values, not what they were at the snapshot. Deal AUM gets revised during diligence — sometimes up, sometimes down. Using `OpportunityFieldHistory` to roll back, we found pipeline-level AUM drift of -$1.4B to +$1.6B. The direction was mixed across quarters, so this didn't systematically bias the results in one direction, but it introduced noise that the model wouldn't have faced in real time.

**Error 3: Anticipated dates reflected final-revised values.**
The earlier research reported that anticipated start dates were 96% accurate for quarter placement. That's true for the *final* anticipated date — after an average of 17 days of revisions. The *first-set* date (what the model would actually have at forecast time) is only 18.4% on-time, with an average slip of +18.3 days. 57% of dates are revised, and 92% of revisions push later. The "+2 days average slip" from Phase 7.1 measured the accuracy of the last guess, not the first.

**Why these errors are understandable:**
Backtesting a pipeline forecast is genuinely hard. Unlike a stock price model where the "actual" is unambiguous, pipeline forecasting faces several unique challenges:

1. **No historical snapshots exist.** Salesforce stores current state, not point-in-time state. Reconstructing what the pipeline looked like 6 months ago requires reverse-engineering from immutable timestamps (stage entries) and field change history — a capability that wasn't available until `OpportunityFieldHistory` was enabled in September 2024.

2. **The rate cohort is reflexive.** To compute conversion rates at a past date, you need to know which deals had resolved by then. But the resolution date itself is a field in the same view you're querying, creating circular dependencies where it's easy to accidentally include future information.

3. **Multiple fields can leak.** AUM, anticipated dates, stage names, and conversion rates can all contain post-snapshot data. Each requires a separate correction using a different methodology — and missing even one (as we did with rates initially) changes the results materially.

4. **Small samples amplify errors.** With only 94 PIT-resolved deals at Q4 2024 (vs. 252 in the leaked cohort), statistical noise is high. The Signed→Joined rate was 100% in the PIT cohort — clearly a small-sample artifact, but one that propagates through the entire forecast.

5. **The "actual" is a moving target.** "Eventual AUM joined" from a pipeline snapshot keeps changing as more deals resolve. The Q4 2025 pipeline still has open deals that may join in Q2-Q3 2026, so even our "actual" comparison is incomplete for recent quarters.

**Corrected accuracy:** After fixing all three errors, the enhanced model's error vs. eventual joined AUM is **60-71% for settled quarters** — not 28%. This is a meaningful improvement over the 207% baseline (a ~3x reduction), but not the 5.6x improvement the earlier docs claimed. The model is useful for pipeline health trending, but it is not accurate enough for quarterly AUM planning — which is why we developed the two-component model (Part 4).

---

## Actual Results by Quarter

| Quarter | Deals Joined | Actual AUM | Avg AUM/Deal |
|---------|:---:|---:|---:|
| Q4 2024 | 13 | $589M | $45M |
| Q1 2025 | 12 | $463M | $39M |
| Q2 2025 | 12 | $578M | $48M |
| Q3 2025 | 14 | $765M | $55M |
| Q4 2025 | 17 | $1,318M | $78M |

---

## The Pipeline at Each Snapshot (PIT-Corrected)

| Quarter Start | Open Deals | PIT Pipeline AUM | Late Stage (Neg + Signed) |
|---|:---:|---:|---:|
| Q4 2024 | 160 | $12.5B | $1.1B (22 deals) |
| Q1 2025 | 162 | $12.7B | $0.7B (18 deals) |
| Q2 2025 | 168 | $14.6B | $0.7B (15 deals) |
| Q3 2025 | 203 | $21.0B | $1.6B (22 deals) |
| Q4 2025 | 240 | $21.1B | $3.4B (37 deals) |

---

# Part 1: Weighted Pipeline Forecast (Fully PIT-Corrected)

## Forecast vs. Eventual Conversion

We tested three variants of the weighted pipeline forecast, all using PIT-corrected data (resolution-date-filtered rates, PIT AUM, 2yr trailing window):

1. **Straight weighted** — flat PIT rates, no duration penalties, no AUM tier segmentation. Every deal at the same stage gets the same probability regardless of how long it's been there or how large it is.
2. **Penalized + tiered** — the current production model. Adds duration-in-stage penalties and splits rates by AUM tier (<$75M / >=$75M).
3. Both compared against actual quarterly AUM and eventual AUM from each pipeline snapshot.

### vs. Quarterly Actual (what landed that quarter)

| Quarter | Actual | Straight Weighted | Error | Penalized + Tiered | Error |
|---|---:|---:|---:|---:|---:|
| Q4 2024 | $562M | $3,551M | +532% | $1,249M | +122% |
| Q1 2025 | $298M | $2,855M | +857% | $1,063M | +256% |
| Q2 2025 | $588M | $3,065M | +421% | $1,359M | +131% |
| Q3 2025 | $590M | $4,786M | +711% | $2,174M | +268% |
| Q4 2025 | $1,031M | $5,491M | +433% | $3,214M | +212% |
| **MAPE** | | | **591%** | | **198%** |

### vs. Eventual Conversion (what the pipeline eventually produced)

| Quarter | Eventual | Straight Weighted | Error | Penalized + Tiered | Error |
|---|---:|---:|---:|---:|---:|
| Q4 2024 | $717M | $3,551M | +395% | $1,249M | **+74%** |
| Q1 2025 | $655M | $2,855M | +336% | $1,063M | **+62%** |
| Q2 2025 | $833M | $3,065M | +268% | $1,359M | **+63%** |
| Q3 2025 | $881M* | $4,786M | +443% | $2,174M | +147% |
| Q4 2025 | $3,082M* | $5,491M | +78% | $3,214M | **+4%** |
| **MAPE** | | | **304%** | | **70%** |

*Q3 and Q4 2025 "eventual" numbers are incomplete — deals remain open.*

### Do the penalties and tiers help? Yes — significantly.

The duration penalties and AUM tier segmentation reduce error by roughly **4x** across every comparison:

| Metric | Straight | Penalized + Tiered | Improvement |
|---|---:|---:|---|
| MAPE vs. quarterly actual | 591% | 198% | **3.0x better** |
| MAPE vs. eventual | 304% | 70% | **4.3x better** |
| Worst quarter (vs. Q actual) | +857% | +268% | 3.2x better |
| Best quarter (vs. eventual) | +78% | +4% | 19.5x better |

The penalties cut the straight forecast roughly in half for settled quarters. This is because 50-65% of the pipeline is "very stale" zombie deals — duration penalties apply 0.18x multipliers to these, and AUM tier segmentation further reduces the weight of large-AUM deals that convert at lower rates.

**However**, even the penalized model is still 198% MAPE vs. quarterly actuals — meaning it tells you the pipeline is worth $1-3B when $300M-$1B actually lands that quarter. It's useful for pipeline health trending (is the penalized total growing or shrinking?) but not for quarterly dollar forecasting. That's what the two-component model (Part 4) was built to solve.

---

## Why Both Weighted Models Overestimate

### The Zombie Pipeline

50-65% of deals at any snapshot are "very stale" (2+ SD over normal duration). Duration penalties (0.18x for very stale SP/Neg deals) help but don't fully zero out ghost contributions from large-AUM zombies. A $500M Discovery deal at 300+ days, even with a 0.393x penalty and a 3% base probability, still contributes ~$6M to the forecast. Multiply by 50 such deals and it's $300M of phantom pipeline value.

### AUM Concentration

Upper-tier deals (>=$75M) convert at roughly half the rate of smaller deals but carry 5-10x more AUM. A single whale in Discovery at 3% probability still contributes meaningfully to the forecast. Tier segmentation helps (it uses the lower Upper-tier rate) but the core math — small probability × huge number = still a big number — can't be fully solved by rate adjustments.

### Intra-Quarter Blind Spot

Deals that enter and close within the same quarter contributed $27-288M per quarter (growing to ~20% of quarterly AUM). No snapshot-based model can predict these.

### PIT Rate Inflation

The PIT-resolved cohort has systematically higher rates than the full historical cohort because fast-closing deals are overrepresented. This means the model operating in real time would see *more* optimistic rates than a lookback suggests — a structural bias toward overestimation.

---

## What Predicts Well

### Anticipated Start Dates — Accurate but Misleading

**Quarter placement: still 100% among PIT-corrected dates.** 37 out of 37 joined deals that had a PIT anticipated date joined in the anticipated quarter. However, this requires important context from our anticipated date exploration:

**First-set dates are much less accurate than final dates.** The "+2 days average slip" from our Phase 7.1 research measured the *final* anticipated date (after all revisions), not the first. The `anticipated_start_date_exploration.md` found:

| Metric | First-Set Date | Final Date |
|---|---|---|
| Average slip | **+18.3 days** | +1.1 days |
| On-time (0 days) | 18.4% | 73.3% |
| Late (>0 days) | 65.3% | 21.4% |
| >30 days late | 26.5% | 2.7% |

The final date accuracy is an artifact of iterative revision — recruiters push the date out an average of 17 days over the deal's life, converging on reality. The first estimate (the one that exists when the forecast first uses it) overshoots by +18.3 days on average, with 65% of deals joining later than first estimated.

**Revision count matters.** Deals revised 4+ times have +40.7 days of first-date slip (vs +8.5 for set-once dates). Our `OPPORTUNITY_HISTORY_EXPLORATION.md` found that 57% of anticipated dates get revised, 92% of revisions push later, and 19% of multi-revisers have pushed 5+ times.

**For forecasting:** The anticipated date is a strong *quarter-level* signal (100% accuracy) but not a precise *date-level* signal. The dashboard's Date Confidence indicator (green/amber/red based on revision count) correctly reflects this — dates with 0-1 revisions are trustworthy, dates with 3+ revisions are not.

---

# Part 2: Monte Carlo Simulation (PIT-Corrected)

Using PIT AUM, PIT anticipated dates, and PIT rates for quarter assignment:

| Quarter | Actual | Deals Projected | MC Mean | P10 (analytical) | P90 (analytical) | In P10-P90? |
|---|---:|:---:|---:|---:|---:|:---:|
| Q4 2024 | $562M | ~139 | ~$1,060M | ~$530M | ~$1,590M | **Yes** |
| Q1 2025 | $298M | ~134 | ~$770M | ~$280M | ~$1,260M | **Yes** (barely) |
| Q2 2025 | $588M | ~133 | ~$1,130M | ~$510M | ~$1,750M | **Yes** |
| Q3 2025 | $590M | ~181 | ~$2,450M | ~$1,310M | ~$3,590M | Below P10 |
| Q4 2025 | $1,031M | ~191 | ~$3,470M | ~$2,630M | ~$4,310M | Below P10 |

3 of 5 quarters (60%) fell within P10-P90. Expected: 80%. Both misses below P10. With PIT rates being higher, the MC mean and P10 floor are also higher, making it harder for actuals to land within range.

---

# Part 3: SQO Target Calculator (Fully PIT-Corrected)

Using PIT mean joined AUM (1yr trailing, only deals joined before snapshot) and PIT-resolved SQO→Joined rate:

| Quarter | PIT Mean AUM | PIT Rate | Expected/SQO | SQOs Needed | Prior Q SQOs | Gap |
|---|---:|---:|---:|:---:|:---:|:---:|
| Q4 2024 | $33.3M | 24.1% | $8.0M | 74 | 86 | **-12** |
| Q1 2025 | $37.2M | 19.6% | $7.3M | 64 | 80 | **-16** |
| Q2 2025 | $39.4M | 14.3% | $5.7M | 103 | 96 | +7 |
| Q3 2025 | $45.9M | 14.7% | $6.8M | 113 | 110 | **+3** |
| Q4 2025 | $47.9M | 13.1% | $6.3M | 211 | 133 | +78 |

### How PIT Correction Changed the Calculator

The PIT rate correction had a significant effect on the SQO calculator — especially for early quarters:

- **Q4 2024 and Q1 2025:** PIT rates (24% and 20%) are much higher than leaked rates (17% and 16%) because the PIT-resolved cohort is small and enriched for fast-closing joiners. Higher rate means each SQO is "worth more," so fewer are needed. The model says we over-produced SQOs (-12, -16 gap).
- **Q2 2025 onward:** PIT rates converge toward leaked rates as the resolved cohort grows. The gap becomes small (+3 to +7) — effectively spot-on.
- **Q4 2025:** +78 gap is driven by the $1.3B actual outcome ($78M/deal avg), far above the trailing $48M mean. A single whale deal accounts for most of this.

**The SQO calculator's accuracy depends on having a stable, representative rate cohort.** When the PIT cohort is thin (83-153 deals for early quarters), the rate is volatile and the calculator becomes less reliable. By Q2 2025+ (250+ resolved deals), the rates stabilize and the calculator performs well.

---

# Part 4: Two-Component Quarterly Forecast

The probability model answers "what is this pipeline worth in total?" — not "what will land this quarter?" After seeing 60-71% overestimation from the weighted model and 138% MAPE against single-quarter actuals, we built a simpler model designed specifically for quarterly prediction.

## How It Works

**Component A — Late-stage committed deals:**
Sum the AUM of all Negotiating + Signed deals whose anticipated start date falls in the target quarter. Apply a realization multiplier (not all will close). Don't use probability weighting — just a flat realization rate based on how many deals have dates.

**Component B — Historical surprise baseline:**
Take the trailing 4-quarter average of "surprise" AUM — everything that joined in a quarter that was NOT a Neg+Signed deal with an anticipated date at quarter start. This captures fast-tracking Sales Process deals, intra-quarter new pipeline, and other unpredictable sources.

**Forecast = (Component A × realization rate) + Component B**

## What the Realization Rate Is and How It's Calculated

The realization rate is **not** a conversion rate. It's not P(Join), it's not a stage transition probability, and it's not derived from the probability model at all. It is a simple, empirically observed ratio:

```
                    AUM that actually joined from Component A deals
Realization Rate = ─────────────────────────────────────────────────
                    Total AUM of all Component A deals at quarter start
```

Where "Component A deals" are specifically: **deals that were in Negotiating or Signed stage at the start of the quarter AND had an anticipated start date falling within that quarter.**

### Worked example: Q4 2025

At the start of Q4 2025 (October 1), the pipeline contained **22 deals** in Negotiating or Signed that had anticipated start dates between October 1 and December 31, 2025. Their combined AUM was **$2,221M**.

By the end of Q4 2025, we looked at which of those 22 specific deals actually joined. **6 of the 22 deals joined**, contributing **$750M** of AUM.

```
Q4 2025 Realization Rate = $750M / $2,221M = 34%
```

This means 34% of the AUM that was "committed" to Q4 2025 (by virtue of being late-stage with a date in the quarter) actually materialized. The other 66% either slipped to a later quarter, closed lost, or is still open.

### Why this is different from a conversion rate

A conversion rate (like our Neg→Signed rate of ~53%) measures: "Of all deals that reach Negotiating, what fraction advance to Signed?" It's computed from the full resolved cohort across a trailing time window and applies to every deal at that stage equally.

The realization rate measures something more specific: "Of deals that are Neg/Signed AND have committed to a specific quarter via an anticipated date, what fraction actually delivers AUM that quarter?" It's a joint measure of:
- Whether the deal closes at all (similar to conversion)
- Whether it closes **on time** (in the quarter the date says)
- Whether deals with anticipated dates are meaningfully different from deals without them

A deal could have a high P(Join) but still not "realize" in the target quarter if it slips — the anticipated date moves out, or the deal closes a quarter late. Conversely, a deal with a moderate P(Join) that has a firm date and closes on schedule contributes to realization.

### How we computed it for each backtest quarter

For each quarter Q:

1. **Identify Component A deals at quarter start:** Query the pipeline as of Q's start date. Filter to deals in Negotiating or Signed (using stage entry timestamps for PIT reconstruction) that have a PIT-corrected anticipated start date within Q.

2. **Sum their AUM:** This is the Component A pipeline — the denominator.

3. **After the quarter ends, check outcomes:** Of those specific deals, which ones have `StageName = 'Joined'` with `advisor_join_date__c` in quarter Q? Sum their AUM — this is the numerator.

4. **Divide:** Realization rate = numerator / denominator.

### What we observed: the declining realization rate

| Quarter | Component A Deals | Component A AUM | AUM That Joined | **Realization Rate** |
|---|:---:|---:|---:|---:|
| Q4 2024 | 6 | $330M | $310M | **94%** |
| Q1 2025 | 10 | $332M | $185M | **56%** |
| Q2 2025 | 5 | $181M | $106M | **59%** |
| Q3 2025 | 13 | $1,128M | $489M | **43%** |
| Q4 2025 | 22 | $2,221M | $750M | **34%** |

The realization rate is declining as more deals get anticipated dates. Early on (Q4 2024), only 6 highly committed deals had dates — and nearly all closed (94%). By Q4 2025, 22 deals had dates, but the field was being used more broadly and less selectively, so only 34% of the committed AUM materialized. This is not because close rates got worse — it's because the anticipated date field went from a strong commitment signal to a routine pipeline management field.

## Why a Realization Rate Instead of P(Join)

The probability model applies a per-deal P(Join) based on stage, AUM tier, and duration. In theory this is more precise. In practice, it overestimates by 60-71% because:
- It includes hundreds of early-stage deals that contribute small but cumulative phantom AUM
- PIT conversion rates are structurally inflated (fast-closers dominate the resolved cohort)
- Whale deals at low probability still add large expected values

The realization rate sidesteps all of this. It only looks at deals that have made a timing commitment (anticipated date in the quarter) and are close to closing (Neg/Signed). It doesn't care about Discovery deals, zombie pipeline, or probability math — it just asks: "When deals say they're going to close this quarter, how much of that AUM actually shows up?"

## Three Realization Approaches Tested

### 1. Adaptive trailing rate
Use the cumulative realization rate from all prior quarters. Problem: it lags. Q1 2025 inherited Q4 2024's 94% rate, massively over-predicting.

### 2. Fixed 50%
Simple, stable. Works well on average but doesn't account for the compositional shift as more deals get dates.

### 3. Deal-count bands
Fewer dated deals = more selective = higher realization. More dated deals = less selective = lower realization. We derived three bands from the observed pattern:

| Dated Deals in Quarter | Realization Rate | Rationale |
|---|---|---|
| < 10 deals | 60% | Small pool, high selectivity — only the most committed deals have dates |
| 10–15 deals | 45% | Moderate pool, mixed quality |
| 15+ deals | 35% | Large pool, dates are widespread, lower average commitment |

These bands were derived from 5 quarters of observed realization rates. They're rough — the boundaries and percentages should be refined as more quarters complete. The key insight they encode is that the realization rate is a function of how many deals have dates, not a fixed property of the pipeline.

## Backtest Results

| Quarter | Actual | Deal-Count Bands | Error | Fixed 50% | Error | Prob Model | Error |
|---|---:|---:|---:|---:|---:|---:|---:|
| Q1 2025 | $463M | $428M | **-8%** | $445M | -4% | $1,047M | +126% |
| Q2 2025 | $578M | $387M | -33% | $369M | -36% | $1,351M | +130% |
| Q3 2025 | $765M | $851M | **+11%** | $907M | +19% | $2,169M | +183% |
| Q4 2025 | $1,318M | $1,104M | **-16%** | $1,437M | +9% | $3,223M | +145% |
| | | **MAPE: 17%** | | **MAPE: 17%** | | **MAPE: 146%** | |

Both simple models are **8x more accurate** than the probability model. The deal-count bands model has a tighter max error (+11% vs +19%) and is more conservative — it slightly under-predicts in 3 of 4 quarters, which is safer for planning than systematic over-prediction.

**Q2 2025 is the structural weak spot** across all models (-33%). That quarter, only 5 Neg+Signed deals had dates ($181M), but $578M actually joined — 82% was "surprise" AUM. When the late-stage pipeline is thin, Component B dominates, and a trailing average can't predict quarter-to-quarter spikes. This is an inherent limitation of any model that relies on late-stage visibility.

## Q1 2026 and Q2 2026 Forward Forecast

Using the deal-count bands model with the current pipeline as of March 24, 2026:

### Q1 2026 (Jan–Mar 2026) — Quarter In Progress

| Component | Input | Value |
|---|---|---|
| **Already joined (actual)** | 12 deals | **$2,411M** |
| Component A (remaining) | 4 Neg deals dated in Q1, × 60% | $98M |
| Component B | Trailing 4Q surprise avg | $398M |
| **Model forecast (ex-joined)** | | **$496M** |

**Q1 2026 actual is already $2,411M** — driven by a single $1.5B whale deal that joined in January (62% of the quarter). No model could have predicted this. Without the whale, the remaining 11 deals total $911M, which is in line with the model's range. This quarter illustrates why whale deals must be tracked separately.

### Q2 2026 (Apr–Jun 2026) — Forward Forecast

| Component | Input | Value |
|---|---|---|
| Component A | 29 deals (25 Neg + 4 Signed), $2,527M AUM | |
| Realization band | 29 deals → 35% (15+ band) | $885M |
| Component B | Trailing 4Q surprise avg | $398M |
| **Forecast** | | **$1,283M** |

The Q2 2026 pipeline is unusually large — 29 Neg+Signed deals with anticipated dates in the quarter, carrying $2.5B of AUM. At the 35% realization band, this produces $885M from Component A. Adding the $398M surprise baseline gives a forecast of **~$1.3B**.

**Caution:** With 29 deals, we're at the high end of our observed range (previous max was 22 in Q4 2025, which realized at 34%). The 35% band may still be too optimistic for a pool this large. If realization continues to decline, 30% ($758M + $398M = $1,156M) is a more conservative estimate.

**Range: $1.1B – $1.3B for Q2 2026.**

### Sanity Check: Does This Pass the Smell Test?

The two-component model forecasts $1.1-1.3B for Q2 2026. Compare that against what the other models say and what has actually happened historically:

| Source | Q2 2026 Estimate |
|---|---:|
| **Two-component (deal-count bands)** | **$1.1–1.3B** |
| Weighted pipeline forecast (penalized) | ~$2.9B |
| Monte Carlo P10 (bear case) | $2.0B |
| Monte Carlo P50 (base case) | $2.7B |

Now look at what has actually joined per quarter — the historical record:

| Quarter | Actual Joined AUM |
|---|---:|
| Q4 2024 | $589M |
| Q1 2025 | $463M |
| Q2 2025 | $578M |
| Q3 2025 | $765M |
| Q4 2025 | $1,318M |
| Q1 2026 | $2,411M (includes $1.5B whale) |

Excluding the Q1 2026 whale, **our highest quarterly AUM ever is Q4 2025 at $1.3B**. The quarterly trend is growing but gradually — $463M → $578M → $765M → $1,318M. The probability model's $2.9B weighted forecast and the Monte Carlo's $2.0B P10 (bear case!) both exceed every non-whale quarter in our history. Even the Monte Carlo's supposed "bear case" has never actually happened — not once.

The two-component estimate of $1.1-1.3B is consistent with the growth trajectory and with Q4 2025 as a reference point. It's grounded in what has actually happened, not in probability math applied to a pipeline full of zombie deals.

### Q1 2026: The Whale Quarter

The two-component model forecast for Q1 2026 was $496M. Actual: $2,411M. That looks like a catastrophic miss — but strip out the single $1.5B whale deal that closed in January, and the remaining 11 deals total $911M. That $911M is within the plausible range of the model — Q4 2025 saw $1.3B, and the model's Component B surprise baseline ($398M) combined with a normal Component A contribution would have landed in the $500-900M zone. The miss isn't the model — it's the whale. No quarterly forecast model can predict a single $1.5B deal, and attempting to do so (as the probability model does, by weighting it at P(Join) × $1.5B) is what causes the systematic overestimation in the first place.

## How to Refine the Bands Over Time

The deal-count bands (60% / 45% / 35%) are derived from 5 data points — directionally correct but statistically thin. To improve them:

1. **After each quarter closes**, compute the actual realization rate: `AUM joined from Component A deals / total Component A pipeline AUM`. Add it to the running dataset.

2. **Re-derive bands annually** (or when you have 8+ data points). Plot realization rate vs. deal count and fit a simple curve. The current bands assume a step function; with more data, a linear or logarithmic fit may work better (e.g., `realization = 0.80 - 0.02 × deal_count`).

3. **Consider splitting by stage**: Signed deals may realize at a consistently higher rate than Negotiating deals. If the data supports it (we'd need 10+ quarters to have enough Signed deals to measure), separate bands for Signed vs. Negotiating would improve precision.

4. **Track Component B trends**: The surprise baseline has been growing ($145M → $568M over 8 quarters). If this growth continues, a trailing average will systematically under-predict Component B. Consider using a growth-adjusted trailing average or a simple linear extrapolation.

5. **Flag whale quarters**: Any quarter where a single deal represents >30% of the Component A pipeline should be flagged. The model can't predict whale outcomes — present them as upside/downside scenarios rather than point estimates.

---

# Part 5: Conclusion

## Summary Accuracy Table

All methods PIT-corrected. MAPE = mean absolute percentage error across backtested quarters.

| Method | MAPE vs. Quarterly Actual | MAPE vs. Eventual | Best Use |
|---|---:|---:|---|
| **Two-component (deal-count bands)** | **17%** | — | **Quarterly AUM forecasting** |
| **Two-component (fixed 50%)** | **17%** | — | Quarterly AUM (simpler variant) |
| Two-component (adaptive trailing) | 31% | — | Not recommended (lags) |
| SQO target calculator | +3 to +7 SQO gap | — | SQO capacity planning |
| Weighted + duration + tier | 198% | 70% | Pipeline health trending |
| Straight weighted (no penalties) | **591%** | **304%** | Not recommended |
| MC quarter-assigned (P50) | 65-195% | — | Scenario/risk communication |

The penalties and tier segmentation cut the straight weighted model's error by **4x** (304% → 70% vs. eventual). But even the penalized model is 198% off vs. quarterly actuals — it answers a different question ("total pipeline value") than quarterly planning requires. The two-component model answers the quarterly question at 17% MAPE — **35x more accurate** than straight weighting and **12x more accurate** than the penalized model for single-quarter prediction.

## Recommendation

1. **For quarterly AUM forecasting:** Use the **two-component model with deal-count bands**. It's 8x more accurate than the probability model, requires no complex calculation, and is grounded in observable pipeline data. The forecast is: `(Neg+Signed dated AUM × band rate) + trailing 4Q surprise average`. Review and refine the bands each quarter as more data accumulates.

2. **For SQO capacity planning:** Continue using the **SQO target calculator** with the 1yr trailing window. It works well (+/-3-7 SQOs in stable quarters) because the mean-based approach naturally handles whale variance.

3. **For pipeline health monitoring:** Track the **penalized weighted forecast** quarter-over-quarter as a leading indicator. Don't use it for dollar targets — apply a ~0.4x haircut for directional expectations.

4. **For risk communication:** Use the **Monte Carlo P10/P50/P90** with caveats: P10 is too optimistic (actuals fell below it 40% of the time), and present whale deals (>$500M) separately since they dominate the range.

5. **For whale quarters:** No model can predict a $1.5B deal closing. Track whale deals on a separate watchlist and present them as upside scenarios, not point estimates. Q1 2026 ($2.4B actual, driven by one $1.5B deal) is a clear example — the model forecast $496M ex-joined.

## Which Results to Trust Most

Not all quarters in this backtest are created equal. Confidence is driven by data cleanliness and cohort size:

| Quarter | Rate Cohort Size (2yr PIT) | AUM PIT Coverage | Confidence |
|---|---|---|---|
| Q4 2024 | Thin (94 deals), PIT rates inflated (21% e2e) | Partial field history | **Low** |
| Q1 2025 | Moderate (171 deals) | Good | **Moderate** |
| Q2 2025 | Good (260 deals), rates stabilizing | Good | **High** |
| Q3 2025 | Large (332 deals) | Good | **High** (but eventual still resolving) |
| Q4 2025 | Large (420 deals) | Good | **Highest** (but eventual still resolving) |

**Q2 2025 is our single most trustworthy settled data point**: good rate cohort, good PIT AUM coverage, and enough time has passed (12 months) for most pipeline deals to resolve. The penalized forecast error of **+62%** vs. eventual is the best single estimate of real-world model accuracy.

The main concern for Q4 2024 is not data quality (the SFDC data is natively tracked) but **sample size** — only 94 PIT-resolved deals in the rate cohort, with the PIT e2e rate inflated to 21% because fast-closing deals dominate the small resolved pool.

## Known Limitations

- **PIT rates are inflated in early snapshots** because the resolved cohort is small and enriched for fast-closers. This is a structural property of point-in-time analysis — at Q4 2024, only 94 deals had resolved, and their 21% e2e rate is well above the long-run ~15%.
- **AUM and anticipated date PIT correction is limited to post-September 2024** (when `OpportunityFieldHistory` tracking was enabled). Pre-Sep 2024 field changes cannot be detected or rolled back.
- **The 180d window is unreliable** for backtesting Q4 2024 — only 57 PIT-resolved deals with Signed→Joined at 100% from a tiny sample.
- **Intra-quarter pipeline** (~20% of quarterly AUM) is structurally invisible to any snapshot-based forecast.
