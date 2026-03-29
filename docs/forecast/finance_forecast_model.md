# Finance GTM Forecast Model: How the $2B Q2 2026 Estimate Was Built

**Source:** [GTM Forecast Analysis (Google Sheet)](https://docs.google.com/spreadsheets/d/1Ifg1_jH6XfFtvFA__kSSMVBE03Ie2bVcXQB3EM4w0WY/edit?gid=630845446#gid=630845446)
**As of:** March 25, 2026

---

## Overview

The finance team's GTM Forecast Analysis spreadsheet projects approximately **$1,955M (~$2B) of joined AUM in Q2 2026** (April through June). This number comes from summing two components: expected AUM from current open pipeline deals ($1,955M) and expected AUM from future SQOs that haven't been created yet ($0 in Q2, since new Q2 SQOs won't close until Q3). The model then layers on an AUM transition schedule to show when joined AUM actually hits the custodian, which drives the ARR and RRGP calculations.

---

## The Two Components

### Component 1: Current Pipeline ($3,745M total, ~$1,955M in Q2)

The "Current Pipeline" tab takes every open opportunity (excluding Closed Lost, Joined, and On Hold) and projects when each deal will join and how much AUM it will bring. The Q2 total is the sum of April ($430M), May ($677M), and June ($848M).

For each deal, the model calculates:

**Projected Join Date.** Starting from the deal's current stage entry date, it adds the assumed average days to progress through each remaining stage. The durations are:
- SQO/Discovery/Qualifying to Sales Process: 16 days
- Sales Process to Negotiating: 25 days
- Negotiating to Signed: 20 days
- Signed to Joined: 30 days

Total pipeline cycle from early stage to Joined: ~91 days. The formula is `MAX(today, stage entry + avg days in current stage) + remaining stage durations`.

**Probability.** The product of the remaining stage conversion rates:
- Qualifying/Discovery to Sales Process: 70% (for current pipeline) / 68% (for new SQOs)
- Sales Process to Negotiating: 32%
- Negotiating to Signed: 40%
- Signed to Joined: 97%

A Discovery deal gets all four rates: 70% x 32% x 40% x 97% = **8.6%**. A Sales Process deal gets the last three: 32% x 40% x 97% = **12.3%**. A Negotiating deal gets the last two: 40% x 97% = **38.8%**. A Signed deal gets just the last: **97%**.

**Expected AUM** = Deal AUM x Probability.

**Manual overrides.** This is where the model diverges from a pure formula approach. The "Final Probability" and "Final Projected Join Date" columns include deal-by-deal adjustments based on SGM intel (notes from Bre and others):

- Deals sitting 30+ days in Discovery/Qualifying are zeroed out (0% probability). This eliminated ~10 deals worth $2.5B+ in raw AUM (Brett Ewing, Patrick Hannigan, Avi Pai, Andrew Canter, Blade Robertson, Kyle Burns, Rebecca White, Chad Reed, etc.)
- Deals above $600M in early stages get probability halved and join date pushed 90 days
- Deals above $200M get join date pushed 90 days
- Specific deals get custom overrides based on SGM knowledge:
  - Will Velekei ($500M Negotiating): probability raised from 38.8% to 70% (90-day garden leave, likely to join)
  - David Givler ($200M Negotiating): same treatment, raised to 70%
  - Bryce Brown ($550M Sales Process): raised from 12.3% to 40% ("choosing between 2", summer join)
  - Brandon Harrison ($400M Sales Process): raised from 12.3% to 30% ("choosing between 3")
  - Allen Buckley ($240M Sales Process): raised to 35% ("actively negotiating")
  - Carl Grund ($185M Negotiating): dropped from 38.8% to 11% ("unlikely to sign")

The top 5 deals by expected AUM contribution to the Q2/Q3 forecast:

| Deal | AUM | Stage | Final Prob | Expected AUM |
|---|---:|---|---:|---:|
| Will Velekei | $500M | Negotiating | 70% | $350M |
| Kurt Wedewer | $235M | Signed | 97% | $227M |
| Bryce Brown | $550M | Sales Process | 40% | $220M |
| Tony Parrish | $206M | Signed | 97% | $199M |
| David Givler | $200M | Negotiating | 70% | $140M |

These five deals alone account for $1,136M of the $3,745M total expected AUM from current pipeline.

### Component 2: Future Q2 SQOs ($1,189M, lands in Q3)

The "SQO Forecast" tab creates synthetic future deals based on RevOps SQO targets:
- April: 55 SQOs
- May: 62 SQOs
- June: 74 SQOs

Each synthetic SQO is assigned $75M AUM (the average, though median is $50M) and an 8.3% end-to-end conversion probability (68% x 32% x 40% x 97%). SQO dates are spread evenly within each month, and projected join dates are calculated using the same stage duration assumptions (16 + 25 + 20 + 30 = 91 days from SQO to Joined).

Because of the 91-day cycle time, April SQOs don't join until July, May SQOs until August, June SQOs until September. So this component contributes $0 to Q2 joined AUM and $1,189M to Q3.

**Q2 SQO expected AUM by join month:**
- July: $355M (from April SQOs)
- August: $392M (from May SQOs)
- September: $442M (from June SQOs)

---

## How the Q2 Number Is Calculated

The Q2 joined AUM total on the "AUM Forecast" tab:

| Month | Current Pipeline | Q2 SQOs | Total |
|---|---:|---:|---:|
| April | $430M | $0 | $430M |
| May | $677M | $0 | $677M |
| June | $848M | $0 | $848M |
| **Q2 Total** | **$1,955M** | **$0** | **$1,955M** |

The $2B number is approximately Q2's $1,955M from current pipeline deals.

---

## Conversion Rate Assumptions and Where They Come From

The "Summary" tab contains monthly stage-to-stage conversion rates going back to June 2025, computed from monthly SQO cohorts. The model uses the trailing 6-month average as its baseline:

| Transition | 6-Month Avg | Model Input |
|---|---:|---:|
| SQO to Sales Process | 65% | 68% (current pipeline uses 70%) |
| SP to Negotiating | 68% | 32% |
| Neg to Signed | 32% | 40% |
| Signed to Joined | 97% | 97% |
| **End-to-end** | | **8.3%** (new SQOs) / **8.6%** (current pipeline) |

There's a notable discrepancy: the Summary tab shows SP to Negotiating averaging 68%, but the Assumptions tab uses 32%. Looking more carefully at the Summary tab, the "Sales Process" row (68%) appears to track SQO to Sales Process progression, while the "Negotiating" row (averaging ~32%) tracks the SP to Negotiating transition. The labeling is offset by one stage.

The model also includes forward-looking rate improvements in the roll-forward forecast:
- Negotiating to Signed: projected to improve from 32% to 45% by June ("assumes we need to improve this with Nick back")
- Signed to Joined: projected to improve from 40% to 50% by June ("assumes we unlock high signed rates with incentives")

These improving rates are used in the cohort roll-forward view but the Current Pipeline and SQO Forecast tabs use the static assumptions.

---

## AUM Transition Schedule

Joined AUM doesn't hit the books immediately. The model assumes a 3-month ramp:
- Month 1 after joining: 30% of AUM transitioned to custodian
- Month 2: 80% cumulative
- Month 3: 100% cumulative

This schedule is applied to each month's joined AUM to produce the "Cumulative Transitioned AUM" row, which drives ARR (transitioned AUM x 0.78% fee) and RRGP (ARR x 26% gross margin).

Additionally, the model tracks "Currently Transitioning AUM" for advisors who have already joined but haven't fully transitioned their assets ($395M across 10 advisors, with the bulk being Blue Barn Wealth at $200M), and "Newly Signed" advisors close to joining (Chris Chorlans and Katherine Fibiger contributing $190M).

---

## Stage Duration Assumptions and Where They Come From

The Summary tab tracks actual average days between stages for each monthly cohort. The model uses:

| Stage Transition | Model Assumption | Recent Actuals |
|---|---:|---|
| SQO to Sales Process | 16 days | 4-10 days (trending faster) |
| SP to Negotiating | 25 days | 10-27 days (variable) |
| Neg to Signed | 20 days | 15-25 days (target) |
| Signed to Joined | 30 days | 27-48 days (variable) |
| **Total cycle** | **91 days** | |

The model's 91-day total cycle is slightly conservative relative to some recent cohorts but reasonable as a planning assumption.

---

## Data Alignment: Finance Model vs. Dashboard Pipeline

### Deal Count Discrepancy (184 vs 150)

The finance model's Current Pipeline tab contains **184 deals**. Our dashboard's `vw_forecast_p2` view contains **150 deals**. The difference is **34 Qualifying deals that have not been SQO'd**.

| Stage | Finance Model | Dashboard (`vw_forecast_p2`) | Difference |
|---|---:|---:|---|
| Discovery | ~40 | 42 | Aligned |
| Qualifying | ~25 | 1 | **+34 non-SQO deals in finance model** |
| Sales Process | ~70 | 73 | Aligned |
| Negotiating | ~35 | 30 | Aligned |
| Signed | 4 | 4 | Aligned |
| **Total** | **184** | **150** | **+34** |

The root cause: the finance model's Data2 tab pulls from the raw Opportunity table and filters only on `Stage <> "Closed Lost" AND Stage <> "Joined" AND Stage <> "On Hold"`. Our dashboard additionally requires `SQO_raw = 'Yes'` (the `SQL__c` field in Salesforce), which excludes 34 Qualifying deals where `SQL__c` is NULL. These are opportunities that have been created but haven't been qualified by an SGM yet. They shouldn't be in a pipeline forecast because they haven't passed the SQO gate and may never get qualified.

At 8.6% probability each with an average AUM of ~$75M, these 34 deals add roughly $220M of phantom expected AUM to the finance model's total. Not the largest source of error, but directionally inflating the number.

### Conversion Rate Discrepancy

This is the more significant divergence. The rates differ substantially at two stages:

| Transition | Finance Model | Dashboard (Jun-Dec 2025 cohort) | Delta |
|---|---:|---:|---|
| **SQO to SP** | 68-70% | 66.9% | Close |
| **SP to Neg** | 32% | **42.1%** | Finance 10pts lower |
| **Neg to Signed** | 40% | **50.7%** | Finance 11pts lower |
| **Signed to Joined** | 97% | 94.7% | Close |
| **End-to-end** | 8.3-8.6% | **13.5%** | Dashboard is 60% higher |

The finance model's end-to-end rate (8.3%) is nearly half the dashboard's (13.5%). This means our dashboard assigns roughly 60% more expected AUM per deal than the finance model does before overrides.

**Why the rates differ:** The two models compute conversion rates using different methodologies:

- **Dashboard:** Uses a **cohort-based "reached or beyond" methodology** from the Jun-Dec 2025 resolved SQO cohort (deals that ended in Joined or Closed Lost). A deal counts as having "reached" a stage if it has a stage-entry timestamp for that stage or any later stage. The denominator is all resolved SQOs. This measures eventual progression and produces higher rates.

- **Finance model:** Uses **monthly snapshot rates** from the Summary tab, averaged over 6 months. These measure how many deals in stage X at the start of a month moved to stage X+1 by month end. This produces systematically lower rates because deals still in progress (haven't moved yet that month) count as non-conversions. It's a velocity measure more than an eventual-conversion measure.

Neither methodology is wrong, they answer different questions. The cohort method asks "of deals that entered and resolved, what fraction made it through?" The monthly snapshot method asks "in any given month, what fraction of deals move forward?" The monthly method is more conservative and reflects the pace of movement, while the cohort method reflects ultimate outcomes.

**The paradox: lower rates but higher forecast.** Despite using rates that are nearly half of the dashboard's, the finance model produces a higher Q2 forecast (~$2B vs the dashboard's $1.1-1.3B realization estimate). This happens because:

1. **34 extra non-SQO deals** inflate the pipeline count
2. **Manual probability overrides push key deals much higher** than formula rates (Velekei from 38.8% to 70%, Bryce Brown from 12.3% to 40%, Givler to 70%, etc.). These overrides on large-AUM deals add hundreds of millions of expected AUM that the mechanical model doesn't capture.
3. **No duration penalties** beyond the binary 30-day early-stage cutoff. The dashboard applies continuous SD-based penalties that reduce probabilities by 60-80% for stale deals.
4. **No realization discount.** Our backtesting showed probability-weighted forecasts overestimate quarterly AUM by ~2x on average. The dashboard's two-component model applies a historical realization rate to account for this. The finance model takes the probability-weighted sum at face value.

---

## Key Differences from the Dashboard Pipeline Forecast

| Dimension | Finance Model | Dashboard Model |
|---|---|---|
| **Deal universe** | 184 deals (includes 34 non-SQO Qualifying) | 150 deals (SQO-gated only) |
| **Probability source** | Static rates from 6-month snapshot avg, plus deal-by-deal SGM overrides | Trailing cohort rates from BigQuery, mechanically applied |
| **Base e2e rate** | 8.3-8.6% (monthly snapshot method) | 13.5% (cohort "reached or beyond" method) |
| **Duration penalties** | Binary: 30+ days in early stage = 0% | Continuous: SD-based penalty multipliers |
| **AUM tiers** | Manual: >$600M halved, >$200M delayed 90 days | Systematic: <$75M / >=$75M with separate rate sets |
| **Future SQOs** | Modeled explicitly (191 synthetic SQOs in Q2) | Not included |
| **SGM intel** | Incorporated deal-by-deal (Bre's notes) | Not available |
| **AUM transition** | Modeled (30/80/100% over 3 months) | Not modeled |
| **Realization adjustment** | None | Two-component model applies historical realization rate |

---

## Summary

The $2B Q2 estimate is built from the bottom up: take every open deal, project when it joins using stage duration assumptions, apply stage-to-stage conversion rates as probabilities, adjust deal-by-deal based on SGM intel, and sum the expected AUM landing in April through June.

The model's strengths are its deal-level transparency, SGM intel incorporation, and the AUM transition schedule that connects joined AUM to ARR and RRGP.

The main risks are:
1. **34 non-SQO deals** are included in the pipeline that haven't passed the qualification gate
2. **Conversion rates use a monthly snapshot methodology** that produces different results than cohort-based rates, making direct comparison difficult
3. **Manual overrides on ~6 large deals drive a disproportionate share** of the forecast ($1.1B of $3.7B expected AUM comes from 5 deals with overridden probabilities)
4. **No realization discount is applied.** Our backtesting showed probability-weighted pipeline forecasts overestimate quarterly AUM by 2-3x, and this model does not account for that historical pattern. This is likely the primary reason the finance model's Q2 forecast (~$2B) is higher than the dashboard's two-component realization estimate ($1.1-1.3B).
