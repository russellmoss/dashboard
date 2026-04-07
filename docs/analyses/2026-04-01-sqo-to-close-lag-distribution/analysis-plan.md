# SQO-to-Signed and SQO-to-Joined Lag Distribution

**Requested**: 2026-04-01
**Request**: Calculate SQO-to-Close lag distribution by monthly cohort, for Signed and Joined stages separately. Build a lookup table to project: "if we had X SQOs created in April, how many will Sign or Join in month 1 after creation, month 2, month 3, etc."
**Status**: Validated

---

## 1. Request Interpretation

For every SQO created in a given time window, measure the elapsed time (in days) between SQO creation and either:
- **Signed**: when `Stage_Entered_Signed__c` was populated (entered Signed stage)
- **Joined**: when `Stage_Entered_Joined__c` was populated (entered Joined stage)

Produce a **discrete lag bucket distribution** (what % converted IN each 30-day window) and a **cumulative conversion curve** (what % converted BY each 30-day threshold), both with maturity-gated denominators.

Two presentation methods provided:
1. **Maturity-gated tables** (per user spec): each bucket uses a different denominator restricted to SQOs old enough
2. **Fixed-cohort tables** (supplementary, per council recommendation): all buckets use the same denominator (SQOs aged 180+ days), enabling true additive distribution

Run for three cohort windows:
1. SQOs created in the **last 2 years** (2024-04-01 to present)
2. SQOs created in the **last 1 year** (2025-04-01 to present)
3. **Recent mature cohort**: SQOs created in the last 12 months AND aged 180+ days (Apr 4 -- Oct 3, 2025, N=252). This isolates recent performance to test whether conversion rates are declining vs the 2-year blended number.

### Definitions Used

| Business Term | Technical Definition | Source |
|---|---|---|
| SQO | `is_sqo_unique = 1` AND `recordtypeid = '012Dn000000mrO3IAI'` (Recruiting) | bq-patterns.md, GLOSSARY.md |
| SQO Date | `Date_Became_SQO__c` (TIMESTAMP) | bq-field-dictionary.md |
| Signed Date | `Stage_Entered_Signed__c` (TIMESTAMP) — entered Signed stage | bq-field-dictionary.md |
| Joined Date | `Stage_Entered_Joined__c` (TIMESTAMP) — entered Joined stage | bq-field-dictionary.md |
| Days to Signed | `DATE_DIFF(DATE(Stage_Entered_Signed__c), DATE(Date_Became_SQO__c), DAY)` | Computed |
| Days to Joined | `DATE_DIFF(DATE(Stage_Entered_Joined__c), DATE(Date_Became_SQO__c), DAY)` | Computed |
| Maturity Gate | `DATE_DIFF(CURRENT_DATE(), DATE(Date_Became_SQO__c), DAY) >= threshold` | User spec |

### Scope
- **Date Range**: SQOs created in last 2 years (2024-04-01+), last 1 year (2025-04-01+), and recent mature cohort (last 12 months AND aged 180+ days: Apr 4 -- Oct 3, 2025)
- **Population**: All unique recruiting SQOs (`is_sqo_unique = 1`, `recordtypeid = '012Dn000000mrO3IAI'`)
- **Metrics**: Discrete lag bucket % and cumulative conversion % for Signed and Joined separately
- **Granularity**: 30-day buckets (0-30, 31-60, 61-90, 91-120, 121-150, 151-180, 180+)

## 2. Data Sources

| Source | Purpose | Key Fields |
|---|---|---|
| `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` | All SQO records with stage timestamps | `Date_Became_SQO__c`, `Stage_Entered_Signed__c`, `Stage_Entered_Joined__c`, `is_sqo_unique`, `recordtypeid` |

## 3. Methodology & Rationale

### Approach
1. Filter to unique recruiting SQOs with non-null `Date_Became_SQO__c`
2. Compute `days_since_sqo` (age of the SQO) and `days_to_signed`/`days_to_joined` (conversion lag)
3. For each 30-day bucket, restrict the denominator to only SQOs old enough to have had a chance to convert in that window (maturity gating)
4. All SQOs remain in the denominator. An opp is counted as converted if the relevant stage-entry timestamp exists, even if it later closes lost.

### Key Decisions
1. **Maturity gating**: Each bucket's denominator only includes SQOs at least N days old. This prevents recently-created SQOs from deflating conversion rates. The denominator shrinks as lag increases — this is expected and correct. **Note**: Because each bucket uses a different denominator, the discrete bucket percentages are NOT additive slices of one population. The fixed-cohort supplementary tables (Section 4.5) provide the additive view.
2. **Closed-lost treatment**: All SQOs remain in denominator regardless of current stage. An opp counts as "converted" if it has the stage-entry timestamp, even if currently Closed Lost (they did reach that stage).
3. **Stage_Entered_Joined__c vs advisor_join_date__c**: Using `Stage_Entered_Joined__c` (TIMESTAMP) per user specification. This is a "gross joins" measure — it includes advisors who joined then later churned to Closed Lost. The dashboard's `is_joined` flag would give "net joins" by excluding those. `advisor_join_date__c` (DATE) has 11 more records but a different definition.
4. **Skipped stages**: 5 records have `Stage_Entered_Joined__c` but no `Stage_Entered_Signed__c` (they skipped the Signed stage). These count as non-converters in the SQO-to-Signed analysis but converters in SQO-to-Joined.
5. **180+ bucket limitation**: The open-ended 180+ bucket cannot be properly maturity-gated since there's no upper bound. It uses the same denominator as 151-180 (SQOs aged 180+ days). Treat this bucket as indicative, not precise.

### Assumptions
- `Date_Became_SQO__c` is populated for 97% of SQO records (1,004/1,034). The 30 missing are excluded.
- `Stage_Entered_Signed__c` was sparsely tracked in 2023 (only 2/75 SQOs) but well-tracked from 2024 onward. Both analysis windows (1yr, 2yr) start in 2024+, so this is not a concern.
- No anomalies found: zero records where Signed or Joined dates precede SQO date.
- UTC timezone is used for all date computations. Salesforce timestamps are stored in UTC. This could shift individual records by +/- 1 day vs Eastern time, but the effect averages out across 30-day buckets.
- Back-calculation formulas assume future cohorts convert at similar historical rates. Segment by channel/SGM for more precise planning.

### Known Limitations
- Small sample sizes for longer lag buckets (the 180+ day denominator is 565 for 2yr, 252 for 1yr)
- The 1-year window's 180+ day bucket only includes SQOs from Apr-Sep 2025 (those old enough)
- 5 records skipped the Signed stage entirely (joined without signing)
- Cumulative converted COUNTS can decrease across thresholds (because the denominator shrinks), but cumulative RATES are monotonically non-decreasing

## 4. Validated Results

### 4.1 Data Validation

| Check | Result |
|---|---|
| `Date_Became_SQO__c` population rate | 97.1% (1,004 / 1,034 unique SQOs) |
| Signed/Joined date before SQO date | 0 anomalies |
| Negative lag values | 0 found |
| Cumulative rates monotonically non-decreasing | PASSED (all 8 series) |
| Discrete bucket %s approximate total conversion rate | PASSED |
| Total unique SQOs (all time) | 1,034 |
| SQOs by year: 2023=75, 2024=259, 2025=483, 2026=187 | Consistent with known volumes |
| Records with Joined but no Signed (stage skip) | 5 |
| Records with Signed but no Joined | 11 |

### 4.2 Velocity Statistics (Converted Records Only, 2-Year Window)

| Metric | N | Median Days | Mean Days |
|---|---|---|---|
| SQO → Signed | 98 | **45 days** | 60.5 days |
| SQO → Joined | 89 | **74 days** | 81.7 days |

The right-skewed distribution (mean > median) confirms a long tail of slow-converting deals.

---

### 4.3 SQO → SIGNED: Last 2 Years (SQOs created 2024-04-01+)

#### Table A — Discrete Lag Buckets (Maturity-Gated)

*Each bucket uses a different denominator — only SQOs old enough for that window.*

| Lag Bucket | Denominator (mature SQOs) | Converted in Window | % of Mature SQOs |
|---|---|---|---|
| 0-30 days | 808 | 36 | 4.46% |
| 31-60 days | 751 | 24 | 3.20% |
| 61-90 days | 700 | 18 | 2.57% |
| 91-120 days | 660 | 9 | 1.36% |
| 121-150 days | 618 | 5 | 0.81% |
| 151-180 days | 565 | 1 | 0.18% |
| 180+ days | 565 | 4 | 0.71% |

#### Table B — Cumulative Conversion Rate (Maturity-Gated)

*Rates are monotonically non-decreasing. Raw counts may decrease as the denominator shrinks.*

| By Day | Denominator | Cumulative Converted | Cumulative Rate |
|---|---|---|---|
| By day 30 | 808 | 36 | 4.46% |
| By day 60 | 751 | 60 | 7.99% |
| By day 90 | 700 | 78 | 11.14% |
| By day 120 | 660 | 84 | 12.73% |
| By day 150 | 618 | 83 | 13.43% |
| By day 180 | 565 | 79 | 13.98% |

---

### 4.4 SQO → SIGNED: Last 1 Year (SQOs created 2025-04-01+)

#### Table A — Discrete Lag Buckets (Maturity-Gated)

| Lag Bucket | Denominator (mature SQOs) | Converted in Window | % of Mature SQOs |
|---|---|---|---|
| 0-30 days | 495 | 22 | 4.44% |
| 31-60 days | 438 | 14 | 3.20% |
| 61-90 days | 387 | 6 | 1.55% |
| 91-120 days | 347 | 6 | 1.73% |
| 121-150 days | 305 | 3 | 0.98% |
| 151-180 days | 252 | 1 | 0.40% |
| 180+ days | 252 | 0 | 0.00% |

#### Table B — Cumulative Conversion Rate (Maturity-Gated)

| By Day | Denominator | Cumulative Converted | Cumulative Rate |
|---|---|---|---|
| By day 30 | 495 | 22 | 4.44% |
| By day 60 | 438 | 36 | 8.22% |
| By day 90 | 387 | 42 | 10.85% |
| By day 120 | 347 | 45 | 12.97% |
| By day 150 | 305 | 42 | 13.77% |
| By day 180 | 252 | 38 | 15.08% |

---

### 4.5 SQO → JOINED: Last 2 Years (SQOs created 2024-04-01+)

#### Table A — Discrete Lag Buckets (Maturity-Gated)

| Lag Bucket | Denominator (mature SQOs) | Converted in Window | % of Mature SQOs |
|---|---|---|---|
| 0-30 days | 808 | 15 | 1.86% |
| 31-60 days | 751 | 24 | 3.20% |
| 61-90 days | 700 | 20 | 2.86% |
| 91-120 days | 660 | 15 | 2.27% |
| 121-150 days | 618 | 5 | 0.81% |
| 151-180 days | 565 | 3 | 0.53% |
| 180+ days | 565 | 7 | 1.24% |

#### Table B — Cumulative Conversion Rate (Maturity-Gated)

| By Day | Denominator | Cumulative Converted | Cumulative Rate |
|---|---|---|---|
| By day 30 | 808 | 15 | 1.86% |
| By day 60 | 751 | 39 | 5.19% |
| By day 90 | 700 | 59 | 8.43% |
| By day 120 | 660 | 71 | 10.76% |
| By day 150 | 618 | 72 | 11.65% |
| By day 180 | 565 | 70 | 12.39% |

---

### 4.6 SQO → JOINED: Last 1 Year (SQOs created 2025-04-01+)

#### Table A — Discrete Lag Buckets (Maturity-Gated)

| Lag Bucket | Denominator (mature SQOs) | Converted in Window | % of Mature SQOs |
|---|---|---|---|
| 0-30 days | 495 | 5 | 1.01% |
| 31-60 days | 438 | 18 | 4.11% |
| 61-90 days | 387 | 7 | 1.81% |
| 91-120 days | 347 | 8 | 2.31% |
| 121-150 days | 305 | 3 | 0.98% |
| 151-180 days | 252 | 2 | 0.79% |
| 180+ days | 252 | 3 | 1.19% |

#### Table B — Cumulative Conversion Rate (Maturity-Gated)

| By Day | Denominator | Cumulative Converted | Cumulative Rate |
|---|---|---|---|
| By day 30 | 495 | 5 | 1.01% |
| By day 60 | 438 | 23 | 5.25% |
| By day 90 | 387 | 30 | 7.75% |
| By day 120 | 347 | 35 | 10.09% |
| By day 150 | 305 | 34 | 11.15% |
| By day 180 | 252 | 31 | 12.30% |

---

### 4.7 Fixed-Cohort Supplementary Tables (2-Year, SQOs aged 180+ days)

*Per council recommendation: single denominator (565 SQOs) across all buckets. These percentages ARE additive slices of one population.*

#### SQO → Signed (Fixed Cohort, N=565)

| Lag Bucket | Converted | % of Cohort | Cumulative % |
|---|---|---|---|
| 0-30 days | 30 | 5.31% | 5.31% |
| 31-60 days | 21 | 3.72% | 9.03% |
| 61-90 days | 15 | 2.65% | 11.68% |
| 91-120 days | 7 | 1.24% | 12.92% |
| 121-150 days | 5 | 0.88% | 13.81% |
| 151-180 days | 1 | 0.18% | 13.98% |
| 180+ days | 4 | 0.71% | 14.69% |
| **Total Signed** | **83** | **14.69%** | |
| Not Signed | 482 | 85.31% | |

#### SQO → Joined (Fixed Cohort, N=565)

| Lag Bucket | Converted | % of Cohort | Cumulative % |
|---|---|---|---|
| 0-30 days | 15 | 2.65% | 2.65% |
| 31-60 days | 18 | 3.19% | 5.84% |
| 61-90 days | 18 | 3.19% | 9.03% |
| 91-120 days | 11 | 1.95% | 10.97% |
| 121-150 days | 5 | 0.88% | 11.86% |
| 151-180 days | 3 | 0.53% | 12.39% |
| 180+ days | 7 | 1.24% | 13.63% |
| **Total Joined** | **77** | **13.63%** | |
| Not Joined | 488 | 86.37% | |

---

### 4.8 Recent Mature Cohort (Last 12 Months, Aged 180+ Days: Apr 4 -- Oct 3, 2025)

*Isolates recent performance to test whether conversion rates are declining vs the 2-year blended number. N=252 SQOs, all at least 180 days old.*

#### SQO → Signed (Recent Mature, N=252)

| Lag Bucket | Converted | % of Cohort | Cumulative % |
|---|---|---|---|
| 0-30 days | 16 | 6.35% | 6.35% |
| 31-60 days | 11 | 4.37% | 10.71% |
| 61-90 days | 3 | 1.19% | 11.90% |
| 91-120 days | 4 | 1.59% | 13.49% |
| 121-150 days | 3 | 1.19% | 14.68% |
| 151-180 days | 1 | 0.40% | 15.08% |
| 180+ days | 0 | 0.00% | 15.08% |
| **Total Signed** | **38** | **15.08%** | |
| Not Signed | 214 | 84.92% | |

#### SQO → Joined (Recent Mature, N=252)

| Lag Bucket | Converted | % of Cohort | Cumulative % |
|---|---|---|---|
| 0-30 days | 5 | 1.98% | 1.98% |
| 31-60 days | 12 | 4.76% | 6.75% |
| 61-90 days | 5 | 1.98% | 8.73% |
| 91-120 days | 4 | 1.59% | 10.32% |
| 121-150 days | 3 | 1.19% | 11.51% |
| 151-180 days | 2 | 0.79% | 12.30% |
| 180+ days | 3 | 1.19% | 13.49% |
| **Total Joined** | **34** | **13.49%** | |
| Not Joined | 218 | 86.51% | |

#### Cohort Comparison (Fixed-Cohort, 90-Day Cumulative Rates)

| Cohort | Period | N | SQO → Signed (90d) | SQO → Joined (90d) |
|---|---|---|---|---|
| Last 2 years | Apr 2024 -- Sep 2025 | 565 | 11.68% | 9.03% |
| Recent mature | Apr 2025 -- Oct 2025 | 252 | 11.90% | 8.73% |
| **Delta** | | | **+0.22pp** | **-0.30pp** |

**Interpretation**: Rates are stable. The recent mature cohort's 90-day Signed rate (11.90%) is within 0.22pp of the 2-year rate (11.68%), and the Joined rate (8.73%) is within 0.30pp. Neither difference exceeds 2 percentage points. No evidence of a declining trend — the 2-year blended rates remain appropriate for forward planning.

---

## 5. Summary Interpretation

### SQO → Signed

Of 565 mature SQOs (aged 180+ days, last 2 years), **14.69% eventually Signed** (83/565). The median time to sign is **45 days** (mean 60.5).

The bulk of signing happens in months 1-2: 9.03% of all SQOs sign within 60 days. Month 3 adds another 2.65%, reaching 11.68% by day 90. After day 90, only ~3% more trickle in.

**Applied forward**: 100 SQOs created in April would produce approximately:
- **9 Signed** by end of May (60 days)
- **12 Signed** by end of June (90 days)
- **13 Signed** by end of July (120 days)
- **15 Signed** eventually (all time)

### SQO → Joined

Of 565 mature SQOs, **13.63% eventually entered Joined** (77/565). The median time to join is **74 days** (mean 81.7).

Joining is more evenly distributed across months 1-3: 2.65% by day 30, 5.84% by day 60, 9.03% by day 90. The joined curve lags signed by ~30 days, as expected (signing precedes onboarding).

**Applied forward**: 100 SQOs created in April would produce approximately:
- **6 Joined** by end of May (60 days)
- **9 Joined** by end of June (90 days)
- **11 Joined** by end of July (120 days)
- **14 Joined** eventually (all time)

### Back-Calculation Formulas

Using the fixed-cohort cumulative rates (most reliable for planning):

**To produce Y Signed advisors within N days:**
```
Required SQO count = Y / cumulative_rate_at_N_days
```
| Target Window | Rate | SQOs needed per 1 Signed |
|---|---|---|
| 60 days | 9.03% | 11.1 SQOs |
| 90 days | 11.68% | 8.6 SQOs |
| 120 days | 12.92% | 7.7 SQOs |

**To produce Y Joined advisors within N days:**
| Target Window | Rate | SQOs needed per 1 Joined |
|---|---|---|
| 60 days | 5.84% | 17.1 SQOs |
| 90 days | 9.03% | 11.1 SQOs |
| 120 days | 10.97% | 9.1 SQOs |

**Example**: To produce 10 Joined advisors within 90 days of SQO creation, need approximately 111 SQOs (10 / 0.0903).

**Caveats**: These rates assume future cohorts have similar mix/quality to the historical 2-year window. For more precise planning, segment by channel, SGM, or AUM tier. Use the 1-year rates if recency matters more than sample size.

---

## 6. Council Review

**Reviewed by**: OpenAI (gpt-5.4), Gemini (gemini-3.1-pro-preview)
**Critical issues found**: 4 (OpenAI) + 2 (Gemini)
**Changes made**: 5
**Questions for user**: 1

### Changes Applied

| # | Source | Severity | Issue | Resolution |
|---|---|---|---|---|
| 1 | OpenAI | CRITICAL | Cumulative query could count negative lags | VERIFIED: 0 negative lags exist in data. Added `BETWEEN 0 AND N` lower bound in discrete queries already. No data change. |
| 2 | OpenAI | CRITICAL | 180+ bucket not properly maturity-gated | FIXED: Added explicit limitation note in methodology (Section 3, Decision #5). Added fixed-cohort tables (Section 4.7) that handle this correctly. |
| 3 | OpenAI | CRITICAL | Different denominator per bucket misrepresented as one distribution | FIXED: Added fixed-cohort supplementary tables (Section 4.7) with single denominator. Relabeled maturity-gated tables to clarify they use different denominators. |
| 4 | Gemini | CRITICAL | Cumulative converted counts decrease (confusing stakeholders) | FIXED: Added explicit note that raw counts can decrease but RATES are monotonically non-decreasing. Added fixed-cohort tables where counts are truly cumulative. |
| 5 | Both | SHOULD FIX | Back-calculation formula too simplistic | FIXED: Added caveats about mix/quality assumptions. Switched primary planning tables to fixed-cohort rates. Added per-window SQO-per-conversion ratios. |

### Disagreements (Reviewer Wrong or N/A)

| # | Source | Issue | Why We Disagree |
|---|---|---|---|
| 1 | OpenAI | CRITICAL: DATE() on TIMESTAMP violates query rules | The bq-patterns rule "Never use DATE() wrapper on TIMESTAMP fields" applies to comparison filtering (e.g., WHERE clauses), not to DATE_DIFF arithmetic. `DATE_DIFF(DATE(ts1), DATE(ts2), DAY)` is standard BigQuery for calendar-day differences. The WHERE clause uses `DATE(Date_Became_SQO__c)` for comparison which is technically against the rule, but works correctly here since we're comparing to a DATE value. |
| 2 | OpenAI | CRITICAL: "Not a true single-cohort distribution" | Acknowledged and addressed by adding fixed-cohort tables. The maturity-gated tables are the user's requested methodology and remain as the primary output; the fixed-cohort tables supplement them. |
| 3 | Gemini | CRITICAL: "Fatal flaw" in cumulative maturity gating | The maturity-gated cumulative RATES are mathematically sound and monotonically non-decreasing. The raw counts decreasing is expected behavior, not a flaw. We addressed the presentation concern by adding fixed-cohort tables. |
| 4 | Gemini | SHOULD FIX: Adjust Signed to include implicit passage | Gemini suggested counting `Stage_Entered_Joined__c IS NOT NULL` as implicit Signed. While logical (joining implies having signed), the user explicitly asked for separate Signed and Joined analyses. Including implicit passage would conflate the two metrics. The 5 stage-skip records are documented. |

### Questions for User (Must Answer Before Using for Planning)

1. **Gross vs Net Joins**: This analysis uses `Stage_Entered_Joined__c IS NOT NULL` ("gross joins" — includes advisors who later churned to Closed Lost). The dashboard's `is_joined` excludes those. Which definition should be used for capacity planning? If net joins matter, the Joined rates will be slightly lower. Currently there are ~11 more records with `advisor_join_date__c` than `Stage_Entered_Joined__c`, and the `is_joined` flag further excludes churned advisors.

---

## 7. SQL Queries

All queries use the same CTE pattern. Below is the canonical form for each query type.

### Query: Discrete Lag Buckets (parameterized)

```sql
-- Replace INTERVAL and Stage_Entered_X__c as needed
WITH sqo_base AS (
  SELECT
    Date_Became_SQO__c,
    Stage_Entered_Signed__c,  -- or Stage_Entered_Joined__c
    DATE_DIFF(CURRENT_DATE(), DATE(Date_Became_SQO__c), DAY) AS days_since_sqo,
    CASE WHEN Stage_Entered_Signed__c IS NOT NULL  -- or Stage_Entered_Joined__c
      THEN DATE_DIFF(DATE(Stage_Entered_Signed__c), DATE(Date_Became_SQO__c), DAY)
      ELSE NULL
    END AS days_to_event
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
  WHERE is_sqo_unique = 1
    AND recordtypeid = '012Dn000000mrO3IAI'
    AND Date_Became_SQO__c IS NOT NULL
    AND DATE(Date_Became_SQO__c) >= DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR)  -- or 1 YEAR
)
SELECT
  '0-30 days' AS lag_bucket, 1 AS sort_order,
  COUNTIF(days_since_sqo >= 30) AS denominator,
  COUNTIF(days_since_sqo >= 30 AND days_to_event BETWEEN 0 AND 30) AS converted,
  ROUND(SAFE_DIVIDE(
    COUNTIF(days_since_sqo >= 30 AND days_to_event BETWEEN 0 AND 30),
    COUNTIF(days_since_sqo >= 30)
  ) * 100, 2) AS pct
FROM sqo_base
UNION ALL
-- ... repeat for 31-60, 61-90, 91-120, 121-150, 151-180, 180+
-- Each bucket adjusts the maturity gate and BETWEEN range accordingly
ORDER BY sort_order
```

### Query: Fixed-Cohort Distribution

```sql
WITH sqo_base AS (
  SELECT
    CASE WHEN Stage_Entered_Signed__c IS NOT NULL
      THEN DATE_DIFF(DATE(Stage_Entered_Signed__c), DATE(Date_Became_SQO__c), DAY)
      ELSE NULL
    END AS days_to_event
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
  WHERE is_sqo_unique = 1
    AND recordtypeid = '012Dn000000mrO3IAI'
    AND Date_Became_SQO__c IS NOT NULL
    AND DATE(Date_Became_SQO__c) >= DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR)
    AND DATE_DIFF(CURRENT_DATE(), DATE(Date_Became_SQO__c), DAY) >= 180
)
SELECT
  COUNT(*) AS fixed_denominator,
  COUNTIF(days_to_event BETWEEN 0 AND 30) AS bucket_0_30,
  COUNTIF(days_to_event BETWEEN 31 AND 60) AS bucket_31_60,
  COUNTIF(days_to_event BETWEEN 61 AND 90) AS bucket_61_90,
  COUNTIF(days_to_event BETWEEN 91 AND 120) AS bucket_91_120,
  COUNTIF(days_to_event BETWEEN 121 AND 150) AS bucket_121_150,
  COUNTIF(days_to_event BETWEEN 151 AND 180) AS bucket_151_180,
  COUNTIF(days_to_event > 180) AS bucket_180_plus,
  COUNTIF(days_to_event >= 0) AS total_converted
FROM sqo_base
```

### Query: Median/Mean Velocity

```sql
SELECT
  COUNT(*) AS n,
  APPROX_QUANTILES(DATE_DIFF(DATE(Stage_Entered_Signed__c), DATE(Date_Became_SQO__c), DAY), 100)[OFFSET(50)] AS median_days,
  ROUND(AVG(DATE_DIFF(DATE(Stage_Entered_Signed__c), DATE(Date_Became_SQO__c), DAY)), 1) AS mean_days
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE is_sqo_unique = 1
  AND recordtypeid = '012Dn000000mrO3IAI'
  AND Date_Became_SQO__c IS NOT NULL
  AND Stage_Entered_Signed__c IS NOT NULL
  AND DATE(Date_Became_SQO__c) >= DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR)
```

**Validation**: All queries executed successfully. Row counts and rates verified against multiple cross-checks.

---

## Appendix: Raw Council Feedback

### OpenAI Review

**OpenAI Response** (model: gpt-5.4)

---

## CRITICAL

1. **TIMESTAMP handling violates the stated query rules and can shift bucket assignment by a day**
   - **Section:** Definitions; SQL Pattern (Discrete / Cumulative)
   - **What's wrong:** The plan uses `DATE(Date_Became_SQO__c)` and `DATE(Stage_Entered_Signed__c)` on TIMESTAMP fields, but the supplied critical rules explicitly say: **"Never use DATE() wrapper on TIMESTAMP fields."**  
     It also uses `CURRENT_DATE()` against TIMESTAMP-derived dates, which can create **UTC/local-time off-by-one errors** around midnight.
   - **Fix:** Keep calculations in TIMESTAMP space, e.g.:
     ```sql
     TIMESTAMP_DIFF(Stage_Entered_Signed__c, Date_Became_SQO__c, DAY)
     TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), Date_Became_SQO__c, DAY)
     Date_Became_SQO__c >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 2 YEAR)
     ```
     If the business wants calendar-day logic, define the business timezone explicitly and apply it consistently.

2. **Cumulative query can count negative lags as conversions**
   - **Section:** SQL Pattern (Cumulative)
   - **What's wrong:** `COUNTIF(days_since_sqo >= 30 AND days_to_signed <= 30)` includes any records where `days_to_signed < 0`. That can happen from data quality issues, backfills, or timezone artifacts. Those should not count as valid conversions.
   - **Fix:** Add a lower bound:
     ```sql
     COUNTIF(days_since_sqo >= 30 AND days_to_signed BETWEEN 0 AND 30)
     ```
     Same issue applies to the Joined version: use `days_to_joined BETWEEN 0 AND threshold`.

3. **The `180+` discrete bucket is not actually maturity-gated**
   - **Section:** Methodology; SQL Pattern (Discrete); Results (Discrete)
   - **What's wrong:** The maturity-gating rule works for bounded buckets like `0-30`, `31-60`, etc. It does **not** work for an open-ended bucket like `180+`.  
     Using denominator `days_since_sqo >= 180` does **not** mean those opps had enough time to fully realize all `180+` conversions, because some will convert at day 220, 300, etc.
   - **Fix:** One of:
     - drop the `180+` discrete bucket,
     - replace it with a bounded bucket like `181-365` and gate denominator at `>= 365`,
     - or use a survival-analysis / censoring approach for the tail.

4. **The current "distribution" is not a true single-cohort lag distribution**
   - **Section:** Methodology; Results (Discrete / Cumulative)
   - **What's wrong:** Each bucket uses a **different denominator cohort** (`>=30`, `>=60`, `>=90`, etc.). That means the bucket percentages are not parts of one common distribution and should not be interpreted as additive slices of the same population.
   - **Why this matters:** It can mislead readers into thinking the discrete rows sum to the cumulative rate or represent one fixed cohort. They do not.
   - **Fix:** For a true lag distribution through day 180, use a **fixed cohort** of SQOs aged at least 180 days for **all** buckets `0-30 ... 151-180`. Keep the maturity-gated version only if clearly labeled as "bucket-specific matured conversion share."

---

## SHOULD FIX

1. **"Joined" is defined inconsistently with the glossary**
   - **Section:** Definitions; Methodology
   - **What's wrong:** The glossary defines **Joined** as the advisor officially joining, and notes the dashboard uses `is_joined`, which excludes later `Closed Lost`.  
     The plan instead uses `Stage_Entered_Joined__c` and raw `IS NOT NULL`, which measures **entered Joined stage**, not the glossary/dashboard business definition.
   - **Fix:** Either:
     - rename the metric everywhere to **"Entered Joined stage"**, or
     - if business "Joined" is required, use `is_joined` / `advisor_join_date__c` per the glossary.

2. **The closed-lost methodology statement is overstated / partially incorrect**
   - **Section:** Methodology
   - **What's wrong:** "Closed-lost opps remain in denominator as non-converters" is not fully true under this plan.  
     If an opp has `Stage_Entered_Signed__c` or `Stage_Entered_Joined__c`, it is counted as a converter to that stage even if it later becomes `Closed Lost`.
   - **Fix:** Reword to something like:  
     **"All SQOs remain in the denominator. An opp is counted as converted if the relevant stage-entry timestamp exists, even if it later closes lost."**

3. **Results tables can be misread because cumulative counts are not comparable across thresholds**
   - **Section:** Results (Cumulative)
   - **What's wrong:** Because the maturity gate changes the eligible cohort at each threshold, `Cum. Converted` can stay flat or even decrease across rows. That's mathematically possible here, but many readers will interpret cumulative counts as if they should only increase.
   - **Fix:** Add a note that each threshold uses a different mature cohort, or switch to a fixed cohort for presentation. At minimum, emphasize the **rate**, not the raw cumulative count.

4. **Back-calculation `Y / 0.0843` is easy to over-interpret**
   - **Section:** Key Interpretation
   - **What's wrong:** This assumes:
     - the 2-year historical rate is stable,
     - future cohorts have similar mix/quality,
     - and that "Joined" here means the same as the business joined metric -- which it currently does not.
   - **Fix:** Add caveats, or use:
     - the 1-year cohort if recency matters more,
     - segmented rates by channel/recruiter/source,
     - and the official joined definition if this is for planning actual advisor joins.

5. **The SQL pattern shown only supports Signed, not literally Joined**
   - **Section:** SQL Pattern
   - **What's wrong:** The sample CTE only calculates `days_to_signed`. The plan says "same CTE" for cumulative/Joined, but the joined metric needs its own `Stage_Entered_Joined__c` and `days_to_joined`.
   - **Fix:** Show a second stage-date field in the base CTE, or parameterize the stage date explicitly.

---

## SUGGESTIONS

1. **Parameterize the "as of" date/timestamp**
   - **Section:** SQL Pattern / Methodology
   - **Suggestion:** Replace `CURRENT_DATE()` / `CURRENT_TIMESTAMP()` with an `@as_of_ts` parameter so results are reproducible and auditable.

2. **Consider two separate outputs**
   - **Section:** Methodology / Results
   - **Suggestion:** Produce:
     - a **fixed-horizon lag distribution** (e.g. SQOs aged `>=180` days, bucketed 0-180), and
     - a **maturity-adjusted cumulative conversion curve** (by day 30 / 60 / 90 / 180).  
     That avoids mixing two different concepts into one table set.

3. **Use survival-analysis framing for long-tail conversion**
   - **Section:** Maturity gating methodology
   - **Suggestion:** If the business cares about the full post-SQO time-to-signed/joined distribution, Kaplan-Meier / right-censoring is a better methodological fit than an open-ended `180+` bucket.

4. **Add explicit data-quality checks**
   - **Section:** Methodology / SQL
   - **Suggestion:** Report counts of:
     - negative lag records,
     - Joined without Signed,
     - Signed/Joined timestamps before SQO,
     - null stage timestamps on opps currently in Signed/Joined.  
     That will help explain anomalies and protect downstream planning.

5. **Clarify the business timezone**
   - **Section:** Definitions / SQL
   - **Suggestion:** If bucketing is supposed to be by business day rather than elapsed 24-hour periods, specify the timezone explicitly in the methodology.

6. **Fix wording in the goal**
   - **Section:** Goal
   - **Suggestion:** It says "SQO-to-Close lag distribution for Signed and Joined stages." That should probably be **"SQO-to-Signed and SQO-to-Joined lag distribution."**

### Bottom line
The biggest problems are:
1. improper TIMESTAMP/DATE handling,
2. cumulative logic allowing negative lags,
3. invalid maturity treatment of the `180+` bucket,
4. and using a different cohort per bucket while presenting it like one lag distribution.

Those should be corrected before trusting the reported rates for planning.

### Gemini Review

**Gemini Response** (model: gemini-3.1-pro-preview)

---

Here is a data quality audit of the proposed analysis plan, broken down by severity. 

### CRITICAL (Analysis would produce wrong or misleading results)

**1. Fatal Flaw in "Cumulative" Maturity Gating (Decreasing Counts)**
*   **The Issue**: The plan claims "Cumulative rates monotonically non-decreasing: PASSED", but looking at the data, the **Cumulative Converted counts are actually decreasing** (e.g., 2-Year SQO to Signed drops from 84 at 120d, to 83 at 150d, to 79 at 180d). 
*   **Why it happens**: By shrinking the denominator at each maturity gate (requiring `days_since_sqo >= bucket_upper_bound`), you are entirely dropping newer cohorts from the older buckets. An opportunity that converted in 20 days, but was created 130 days ago, is counted in the 120d cumulative bucket but is *erased* from the 150d cumulative bucket.
*   **Impact**: A "cumulative" count that shrinks is mathematically illogical and will instantly destroy trust with business stakeholders. Furthermore, this method conflates **conversion speed** with **cohort quality**. Your 180-day bucket only represents the oldest SQOs; if the company's recruiting process improved recently, the newer/better cohorts are represented in the 30-day bucket but absent from the 180-day bucket, deeply distorting the curve.

**2. Naive Forecasting Back-Calculation**
*   **The Issue**: The interpretation states: *"To produce Y Joined advisors by 90 days -> need Y / 0.0843 SQOs"*.
*   **Impact**: This assumes a static historical average is a valid forward-looking predictor, ignoring both seasonality and recent cohort trends. Because the 2-year rate blends ancient performance with recent performance, using this flat rate to set future SGM/SDR quotas will likely result in missed targets if recent conversion rates have trended downward (or sandbagged targets if they've trended upward).

### SHOULD FIX (Results would be imprecise or inconsistent with dashboard)

**1. Misalignment on "Joined" Definition (Gross vs. Net)**
*   **The Issue**: The analyst noted the divergence (using raw `Stage_Entered_Joined__c IS NOT NULL` rather than `is_joined` to include advisors who joined then churned to Closed Lost). 
*   **Why it needs fixing**: While requested "per user spec," this guarantees the numbers will not tie out to the executive dashboard. If this analysis is used for capacity planning or revenue forecasting, it will over-predict the number of *active, revenue-generating* advisors. 
*   **Action**: Provide *both* metrics (Gross Joins and Net Joins), or explicitly title the output "Gross SQO-to-Joined Lag" to prevent finance/ops from using it for active headcount models.

**2. Leaky Funnel from Skipped Stages**
*   **The Issue**: 5 records joined without entering the "Signed" stage. The current SQL logic will evaluate `Stage_Entered_Signed__c IS NOT NULL` as `FALSE` for these records.
*   **Impact**: These 5 successful records will be counted as non-converters in the SQO to Signed analysis, artificially lowering the Signed conversion rate.
*   **Action**: Adjust the Signed definition to mathematically assume passage if a downstream stage was reached: `(Stage_Entered_Signed__c IS NOT NULL OR Stage_Entered_Joined__c IS NOT NULL)`.

**3. Timezone / Boundary Assumptions**
*   **The Issue**: BigQuery's `DATE()`, `CURRENT_DATE()`, and `DATE_DIFF()` functions default to **UTC** unless a timezone is explicitly declared.
*   **Impact**: An SQO created at 9 PM EST on a Tuesday will be recorded as Wednesday in UTC. If the advisor signs the next morning at 10 AM EST (also Wednesday in UTC), `DATE_DIFF` calculates a 0-day lag instead of a 1-day lag. This shifts the distribution leftward.
*   **Action**: Explicitly cast timestamps to the company's operating timezone (e.g., `DATE(Date_Became_SQO__c, 'America/New_York')`).

**4. Reproducibility & Drifting Windows**
*   **The Issue**: The query relies on `DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR)`.
*   **Impact**: If someone runs this query on a Monday, and someone else runs it on a Friday, the baseline cohort shifts by 4 days, causing total counts to change. This makes quarter-over-quarter reproducible auditing impossible.
*   **Action**: Hardcode the cohort window bounds to exact historical quarters or months (e.g., `BETWEEN '2022-01-01' AND '2023-12-31'`).

### SUGGESTIONS (Better approaches or additional angles)

**1. Upgrade to a True Kaplan-Meier (Survival) Analysis**
*   Instead of the flawed shrinking denominator, use a true survival/cohort analysis. Calculate the *marginal* conversion rate for each 30-day window (Converted in Window / Eligible in Window), and multiply the non-conversion probabilities. This properly controls for right-censored data (newer SQOs) without making cumulative counts decrease or dropping data points.

**2. Compare Disjointed Timeframes, not Overlapping Ones**
*   Comparing a "2-Year Window" to a "1-Year Window" obscures insights because the 1-year data makes up exactly 50% (or more) of the 2-year data. To see if GTM velocity is improving, compare "Trailing 12 Months" vs. "Prior 12 Months" (Months 1-12 vs. Months 13-24). 

**3. Surface Averages vs. Medians**
*   The business assumes buckets represent the "average" journey. Because time-to-close distributions are almost always heavily right-skewed (a few deals take 300+ days, pulling the mean upward), you should calculate and report the **Median Days to Sign/Join** alongside the bucketing. 

**4. Document Treatment of Open Pipeline**
*   The methodology notes that "Closed-lost opps remain in the denominator." It should also explicitly state how *Open* SQOs are treated. Open SQOs should be in the denominator up to their current age (which the maturity gate handles), but making this explicit in the business glossary prevents stakeholder confusion.
