# SQO-to-Close Lag Distribution

**Date**: April 1, 2026 | **Author**: RevOps | **Reviewed by**: GPT-5.4, Gemini 3.1 Pro

How long does it take an SQO to Sign and Join, and how many SQOs do we need to hit targets?

---

## Key Findings

Based on 565 mature SQOs (created Apr 2024 -- Sep 2025, each at least 180 days old).

### SQO to Signed

- **Median time**: 45 days (mean 61 days)
- **Total conversion**: 14.7% of SQOs eventually sign
- Most signing happens in months 1--2; by day 60 you've captured 61% of all eventual signers

| Window | Cumulative Signed Rate | SQOs per 1 Signed |
|---|---|---|
| 60 days | 9.0% | ~11 |
| 90 days | 11.7% | ~9 |
| 120 days | 12.9% | ~8 |

### SQO to Joined

- **Median time**: 74 days (mean 82 days)
- **Total conversion**: 13.6% of SQOs eventually join
- Joining is spread more evenly across months 1--3; month 2 is the peak

| Window | Cumulative Joined Rate | SQOs per 1 Joined |
|---|---|---|
| 60 days | 5.8% | ~17 |
| 90 days | 9.0% | ~11 |
| 120 days | 11.0% | ~9 |

### Signed-to-Joined Gap

Once an advisor signs, how long until they join?

- **Median**: 19 days
- **Mean**: 29 days
- **63.5%** join within 30 days of signing; **90.6%** within 120 days

The "assume 30 days from Signed to Joined" rule of thumb is reasonable -- slightly conservative vs the 19-day median but close to the 29-day mean. Plan on 3--4 weeks from signature to onboarding for most deals.

---

## Is the Rate Declining?

To check whether recent SQOs are converting at lower rates, we isolated a "recent mature" cohort: SQOs created Apr--Oct 2025 that are at least 180 days old (N=252).

| Cohort | Period | N | SQO to Signed (90d) | SQO to Joined (90d) |
|---|---|---|---|---|
| Last 2 years | Apr 2024 -- Sep 2025 | 565 | 11.7% | 9.0% |
| Recent mature | Apr 2025 -- Oct 2025 | 252 | 11.9% | 8.7% |
| **Delta** | | | **+0.2pp** | **-0.3pp** |

**No decline.** The recent cohort's Signed rate is essentially flat (+0.2pp) and the Joined rate is within noise (-0.3pp). Neither difference exceeds the 2-percentage-point threshold for a meaningful shift. The 2-year blended rates remain appropriate for forward planning -- no adjustment needed.

---

## Planning Tables

### How many SQOs do we need to produce N Signed advisors?

Using the 90-day cumulative rate (11.7%) -- the most practical planning window:

| Target Signed in Q3 | SQOs needed by start of Q2 |
|---|---|
| 5 | ~43 |
| 10 | ~86 |
| 15 | ~128 |
| 20 | ~171 |
| 30 | ~257 |

### How many SQOs do we need to produce N Joined advisors?

Using the 90-day cumulative rate (9.0%):

| Target Joined in Q3 | SQOs needed by start of Q2 |
|---|---|
| 5 | ~56 |
| 10 | ~111 |
| 15 | ~167 |
| 20 | ~222 |
| 30 | ~333 |

Using the 120-day rate (11.0%) if allowing a full quarter of lag:

| Target Joined in Q3 | SQOs needed by start of Q2 |
|---|---|
| 5 | ~46 |
| 10 | ~91 |
| 15 | ~137 |
| 20 | ~182 |
| 30 | ~273 |

---

## Important Caveats

1. **Gross vs. Net Joins (open question)**: "Joined" here means the advisor entered the Joined stage, including those who later churned to Closed Lost. The dashboard excludes those. If net-active joins are needed for headcount planning, the Joined rates will be slightly lower. This distinction should be resolved before using these numbers for capacity models.

2. **Small samples at longer lags**: The 180-day fixed cohort has 565 SQOs. At the longest windows, we're working with conversion events in the single digits. Treat the 150+ day rates as directional.

3. **Historical patterns confirmed stable**: The recent mature cohort (Apr--Oct 2025, N=252) converts at rates within 0.3pp of the 2-year blended number. No adjustment needed for forward planning. For higher precision, segment by channel or SGM.

---

## Data Notes

- **Sample**: 565 mature SQOs (2yr cohort, aged 180+ days) + 252 recent mature SQOs (Apr--Oct 2025 subset)
- **Date range**: SQOs created April 2024 -- March 2026 (maturity-gated)
- **Source**: `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
- **Dedup**: `is_sqo_unique = 1`, recruiting record type only
- **Validation**: Zero data anomalies (no signed/joined before SQO dates), cross-checked against dashboard known volumes
- **Full analysis plan**: [analysis-plan.md](analysis-plan.md)
- **Executable queries**: [run-analysis.sql](run-analysis.sql)
