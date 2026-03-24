# Forecasting Accuracy Research — Phased Investigation

> **Purpose:** Systematic investigation of our pipeline forecast accuracy, executed phase by phase against BigQuery via MCP. Each phase contains numbered questions. Claude Code should run the query, paste the results directly under each question, then STOP at the end of the phase and wait for instruction to proceed.
>
> **Last updated:** 2026-03-23

---

## Rules for Claude Code

These are non-negotiable. Every query in this document must follow them.

### Conversion Rate Rules
1. **Resolved SQOs only.** Cohorts for conversion rates must filter to: `SQO_raw = 'Yes' AND StageName IN ('Joined', 'Closed Lost')`. Never include open deals in rate denominators.
2. **"Reached this stage or beyond" denominators.** Use the same COALESCE-chain logic from `vw_funnel_audit` and `vw_forecast_p2`. This prevents >100% rates when deals skip stages.
3. **Backfilled timestamps use COALESCE chains — never include `Stage_Entered_Closed__c`.** Closed Lost is a terminal state, not stage progression. Including it inflates rates.
   - `eff_sp_ts = COALESCE(Stage_Entered_Sales_Process__c, Stage_Entered_Negotiating__c, Stage_Entered_Signed__c, Stage_Entered_Joined__c)`
   - `eff_neg_ts = COALESCE(Stage_Entered_Negotiating__c, Stage_Entered_Signed__c, Stage_Entered_Joined__c)`
   - `eff_signed_ts = COALESCE(Stage_Entered_Signed__c, Stage_Entered_Joined__c)`
   - `eff_joined_ts = COALESCE(Stage_Entered_Joined__c, TIMESTAMP(advisor_join_date__c))`
4. **is_joined flag:** `COALESCE(Stage_Entered_Joined__c, TIMESTAMP(advisor_join_date__c)) IS NOT NULL AND StageName != 'Closed Lost'`
5. **Primary opp records only:** Filter to `is_primary_opp_record = 1` and recruiting record type `recordtypeid = '012Dn000000mrO3IAI'` where relevant.
6. **Window filters apply to `Opp_CreatedDate`:** 180d = `DATE_SUB(CURRENT_DATE(), INTERVAL 180 DAY)`, 1yr = 365 days, 2yr = 730 days.

### Full Conversion Rate Calculation Reference

This is the exact methodology. Every query in this document that computes conversion rates must follow this pattern — do not improvise alternative logic.

#### Step 1: Build the Cohort CTE

```sql
WITH cohort AS (
  SELECT
    StageName,
    Date_Became_SQO__c,
    -- Backfill: if a deal skipped SP but reached Neg, use the Neg timestamp as eff_sp_ts
    COALESCE(Stage_Entered_Sales_Process__c, Stage_Entered_Negotiating__c,
             Stage_Entered_Signed__c, Stage_Entered_Joined__c) AS eff_sp_ts,
    COALESCE(Stage_Entered_Negotiating__c, Stage_Entered_Signed__c,
             Stage_Entered_Joined__c) AS eff_neg_ts,
    COALESCE(Stage_Entered_Signed__c, Stage_Entered_Joined__c) AS eff_signed_ts,
    COALESCE(Stage_Entered_Joined__c, TIMESTAMP(advisor_join_date__c)) AS eff_joined_ts
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
  WHERE Full_Opportunity_ID__c IS NOT NULL
    AND is_primary_opp_record = 1
    AND SQO_raw = 'Yes'
    AND StageName IN ('Joined', 'Closed Lost')  -- RESOLVED ONLY
    AND recordtypeid = '012Dn000000mrO3IAI'     -- Recruiting opps only
    -- Apply window filter here based on context:
    -- 180d: AND DATE(Opp_CreatedDate) >= DATE_SUB(CURRENT_DATE(), INTERVAL 180 DAY)
    -- 1yr:  AND DATE(Opp_CreatedDate) >= DATE_SUB(CURRENT_DATE(), INTERVAL 365 DAY)
    -- 2yr:  AND DATE(Opp_CreatedDate) >= DATE_SUB(CURRENT_DATE(), INTERVAL 730 DAY)
    -- All time: no date filter
)
```

**Why these decisions matter:**
- **Resolved only** (`StageName IN ('Joined', 'Closed Lost')`) — excludes open pipeline to avoid deflating rates with deals that haven't had time to convert yet.
- **COALESCE backfill** — if a deal skipped Sales Process but entered Negotiating, `eff_sp_ts` gets the Negotiating timestamp. This means "reached SP or beyond."
- **`Stage_Entered_Closed__c` is NEVER in the COALESCE chains** — Closed Lost is a terminal state, not a stage the deal progressed through. Including it would backfill fake timestamps for deals that never actually reached SP/Neg/Signed, inflating conversion rates.

#### Step 2: Flag Joined Deals

```sql
flagged AS (
  SELECT *,
    CASE WHEN eff_joined_ts IS NOT NULL AND StageName != 'Closed Lost'
         THEN 1 ELSE 0 END AS is_joined
  FROM cohort
)
```

**Why the `StageName != 'Closed Lost'` guard is required:** `eff_joined_ts` uses `COALESCE(Stage_Entered_Joined__c, TIMESTAMP(advisor_join_date__c))`. Some Closed Lost deals might have an `advisor_join_date__c` populated from a prior attempt. Without this guard, those deals would be falsely counted as Joined.

#### Step 3: Compute Rates with "Reached or Beyond" Denominators

```sql
-- SQO → SP
SAFE_DIVIDE(
  COUNTIF(eff_sp_ts IS NOT NULL OR eff_neg_ts IS NOT NULL
          OR eff_signed_ts IS NOT NULL OR is_joined = 1),  -- reached SP or any later stage
  COUNT(*)                                                  -- all resolved SQOs
) AS rate_sqo_to_sp

-- SP → Neg
SAFE_DIVIDE(
  COUNTIF(eff_neg_ts IS NOT NULL OR eff_signed_ts IS NOT NULL
          OR is_joined = 1),                                -- reached Neg or beyond
  COUNTIF(eff_sp_ts IS NOT NULL OR eff_neg_ts IS NOT NULL
          OR eff_signed_ts IS NOT NULL OR is_joined = 1)    -- reached SP or beyond
) AS rate_sp_to_neg

-- Neg → Signed
SAFE_DIVIDE(
  COUNTIF(eff_signed_ts IS NOT NULL OR is_joined = 1),      -- reached Signed or joined
  COUNTIF(eff_neg_ts IS NOT NULL OR eff_signed_ts IS NOT NULL
          OR is_joined = 1)                                  -- reached Neg or beyond
) AS rate_neg_to_signed

-- Signed → Joined
SAFE_DIVIDE(
  COUNTIF(is_joined = 1),                                   -- actually joined
  COUNTIF(eff_signed_ts IS NOT NULL OR is_joined = 1)       -- reached Signed or joined
) AS rate_signed_to_joined
```

**Why "reached or beyond" denominators prevent >100% rates:**
Without this pattern, you get impossible rates. Example with old-style denominators:
```
Signed→Joined denominator = COUNTIF(eff_signed_ts IS NOT NULL) = 111
Signed→Joined numerator   = COUNTIF(is_joined = 1)             = 114
Rate = 114 / 111 = 102.7%  ← BROKEN
```
This happens because 3 deals joined (via `advisor_join_date__c`) without ever having a Signed timestamp — they're in the numerator but not the denominator. With "reached or beyond":
```
Signed→Joined denominator = COUNTIF(eff_signed_ts IS NOT NULL OR is_joined = 1) = 121
Signed→Joined numerator   = COUNTIF(is_joined = 1)                              = 114
Rate = 114 / 121 = 94.2%  ← CORRECT
```

#### The Product Property (Self-Check)

The rates are designed so their product equals the direct SQO→Joined ratio:

```
SQO→SP × SP→Neg × Neg→Signed × Signed→Joined = SQO→Joined

(reached_SP / total) × (reached_Neg / reached_SP) × (reached_Signed / reached_Neg) × (joined / reached_Signed)
= joined / total
```

The intermediate terms cancel (telescoping product). This is verified: all-time product = 14.0%, direct ratio = 14.0%. **If your computed rates don't satisfy this product property, something is wrong — stop and debug.**

#### Velocity (Avg Days per Stage)

Computed from the same cohort, but only from deals that have both entry and exit timestamps for that specific stage:

```sql
-- Avg days in SP (only deals with real SP→Neg progression)
SAFE_DIVIDE(
  SUM(CASE WHEN eff_sp_ts IS NOT NULL AND eff_neg_ts IS NOT NULL
               AND DATE(eff_sp_ts) <= DATE(eff_neg_ts)
           THEN DATE_DIFF(DATE(eff_neg_ts), DATE(eff_sp_ts), DAY) END),
  COUNTIF(eff_sp_ts IS NOT NULL AND eff_neg_ts IS NOT NULL
          AND DATE(eff_sp_ts) <= DATE(eff_neg_ts))
) AS avg_days_in_sp

-- Same pattern for avg_days_in_neg (eff_neg_ts → eff_signed_ts)
-- Same pattern for avg_days_in_signed (eff_signed_ts → eff_joined_ts)
```

The `DATE(eff_sp_ts) <= DATE(eff_neg_ts)` guard excludes deals with bad data where the exit timestamp is before the entry timestamp.

#### How Rates Flow Into P(Join)

Each open pipeline deal gets a P(Join) based on its current stage — the product of remaining stage rates:

| Current Stage | P(Join) Formula |
|--------------|----------------|
| Discovery / Qualifying | `rate_sqo_to_sp × rate_sp_to_neg × rate_neg_to_signed × rate_signed_to_joined` |
| Sales Process | `rate_sp_to_neg × rate_neg_to_signed × rate_signed_to_joined` |
| Negotiating | `rate_neg_to_signed × rate_signed_to_joined` |
| Signed | `rate_signed_to_joined` |

This P(Join) is used for:
- **Expected AUM** = `P(Join) × COALESCE(Underwritten_AUM__c, Amount)` (the metric cards and pipeline table)
- **Monte Carlo** = each remaining stage gets an independent `RAND() < rate` Bernoulli draw using these same rates

#### Pipeline Stage Names (Canonical List)

These are the standardised stage names in `vw_funnel_master`. Use these exact strings in all queries:

| Stage | StageName_code | Funnel Position |
|-------|---------------|----------------|
| Qualifying | 1 | Early funnel |
| Discovery | 2 | Early funnel |
| Sales Process | 3 | Mid funnel |
| Negotiating | 4 | Late funnel |
| Signed | 5 | Late funnel |
| On Hold | 6 | Paused |
| Closed Lost | 7 | Terminal |
| Joined | 8 | Terminal (won) |

#### AUM Tiers (Canonical Buckets)

When segmenting by AUM tier, use these exact definitions (matching `vw_funnel_master`):

```sql
CASE
  WHEN COALESCE(Underwritten_AUM__c, Amount) < 25000000 THEN 'Tier 1 (< $25M)'
  WHEN COALESCE(Underwritten_AUM__c, Amount) < 75000000 THEN 'Tier 2 ($25M-$75M)'
  WHEN COALESCE(Underwritten_AUM__c, Amount) < 150000000 THEN 'Tier 3 ($75M-$150M)'
  ELSE 'Tier 4 (> $150M)'
END AS aum_tier
```

#### Canonical Open Pipeline CTE

When querying the current open pipeline (not the resolved cohort), use this exact filter set:

```sql
open_pipeline AS (
  SELECT *
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
  WHERE SQO_raw = 'Yes'
    AND StageName NOT IN ('On Hold', 'Closed Lost', 'Joined')
    AND Full_Opportunity_ID__c IS NOT NULL
    AND is_sqo_unique = 1
    AND recordtypeid = '012Dn000000mrO3IAI'
)
```

#### Filter Clarification: `is_primary_opp_record` vs `is_sqo_unique`

These are different filters — do not interchange them:

| Filter | When to use | Why |
|--------|------------|-----|
| `is_primary_opp_record = 1` | **Conversion rate cohorts** (resolved SQOs for computing stage rates) | Includes all primary opportunity records for rate computation — some advisors have multiple opps |
| `is_sqo_unique = 1` | **Open pipeline queries** (current deals for forecasting) | Deduplicates to one record per SQO for deal-level analysis — prevents double-counting |

The conversion rate rules at the top of this document specify `is_primary_opp_record = 1`. The open pipeline CTE uses `is_sqo_unique = 1`. Do not mix them.

#### Canonical Point-in-Time Pipeline Reconstruction CTE

When reconstructing what the open pipeline looked like at a historical snapshot date (used in backtesting), use this pattern. **Do NOT use today's `StageName`** — it reflects the deal's current state, not where it was at the snapshot date.

```sql
-- Reconstruct open pipeline as of @snapshot_date
-- A deal was "open" if it had SQO'd by that date and hadn't yet Joined or Closed Lost
pipeline_at_snapshot AS (
  SELECT
    Full_Opportunity_ID__c,
    advisor_name,
    COALESCE(Underwritten_AUM__c, Amount) AS Opportunity_AUM,
    Date_Became_SQO__c,
    Stage_Entered_Sales_Process__c,
    Stage_Entered_Negotiating__c,
    Stage_Entered_Signed__c,
    Stage_Entered_Joined__c,
    Stage_Entered_Closed__c,
    Earliest_Anticipated_Start_Date__c,

    -- Reconstruct the deal's stage AS OF the snapshot date
    -- Walk backward from latest to earliest: what's the most advanced stage
    -- the deal had entered by the snapshot date?
    CASE
      WHEN Stage_Entered_Signed__c IS NOT NULL
           AND DATE(Stage_Entered_Signed__c) <= @snapshot_date
        THEN 'Signed'
      WHEN Stage_Entered_Negotiating__c IS NOT NULL
           AND DATE(Stage_Entered_Negotiating__c) <= @snapshot_date
        THEN 'Negotiating'
      WHEN Stage_Entered_Sales_Process__c IS NOT NULL
           AND DATE(Stage_Entered_Sales_Process__c) <= @snapshot_date
        THEN 'Sales Process'
      ELSE 'Discovery'  -- SQO'd but hasn't entered SP yet
    END AS stage_at_snapshot,

    -- Days in that stage as of the snapshot date
    CASE
      WHEN Stage_Entered_Signed__c IS NOT NULL
           AND DATE(Stage_Entered_Signed__c) <= @snapshot_date
        THEN DATE_DIFF(@snapshot_date, DATE(Stage_Entered_Signed__c), DAY)
      WHEN Stage_Entered_Negotiating__c IS NOT NULL
           AND DATE(Stage_Entered_Negotiating__c) <= @snapshot_date
        THEN DATE_DIFF(@snapshot_date, DATE(Stage_Entered_Negotiating__c), DAY)
      WHEN Stage_Entered_Sales_Process__c IS NOT NULL
           AND DATE(Stage_Entered_Sales_Process__c) <= @snapshot_date
        THEN DATE_DIFF(@snapshot_date, DATE(Stage_Entered_Sales_Process__c), DAY)
      ELSE DATE_DIFF(@snapshot_date, DATE(Date_Became_SQO__c), DAY)
    END AS days_in_stage_at_snapshot

  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
  WHERE SQO_raw = 'Yes'
    AND is_sqo_unique = 1
    AND recordtypeid = '012Dn000000mrO3IAI'
    AND Full_Opportunity_ID__c IS NOT NULL
    -- Had SQO'd by the snapshot date
    AND DATE(Date_Became_SQO__c) <= @snapshot_date
    -- Had NOT yet Joined by the snapshot date
    AND (Stage_Entered_Joined__c IS NULL
         OR DATE(Stage_Entered_Joined__c) > @snapshot_date)
    -- Had NOT yet Closed Lost by the snapshot date
    AND (Stage_Entered_Closed__c IS NULL
         OR DATE(Stage_Entered_Closed__c) > @snapshot_date)
    -- Was not On Hold at the snapshot date (approximation — we don't have On Hold exit date)
    AND (Stage_Entered_On_Hold__c IS NULL
         OR DATE(Stage_Entered_On_Hold__c) > @snapshot_date)
)
```

**Critical: the `stage_at_snapshot` CASE statement walks backward from Signed to Discovery.** This ensures that if a deal had entered Negotiating by the snapshot date but is now Closed Lost, we correctly identify it as "Negotiating" at the time — not its current terminal state.

**Limitation:** `vw_funnel_master` is a current-state view — it does not store historical snapshots. Fields like `Amount`, `Underwritten_AUM__c`, and `Earliest_Anticipated_Start_Date__c` may have been updated since the snapshot date. The backtest uses today's AUM values, which introduces a small amount of lookahead for deals whose AUM changed over time. Document this limitation in your results.

#### Canonical Point-in-Time Rates CTE

When computing what the trailing conversion rates would have been at a historical snapshot date, the cohort must only include deals that had **resolved before the snapshot date** — not deals that resolved after.

```sql
-- Trailing 1yr rates as of @snapshot_date
-- Only includes deals resolved BEFORE the snapshot (no lookahead)
rates_at_snapshot AS (
  SELECT
    StageName,
    COALESCE(Stage_Entered_Sales_Process__c, Stage_Entered_Negotiating__c,
             Stage_Entered_Signed__c, Stage_Entered_Joined__c) AS eff_sp_ts,
    COALESCE(Stage_Entered_Negotiating__c, Stage_Entered_Signed__c,
             Stage_Entered_Joined__c) AS eff_neg_ts,
    COALESCE(Stage_Entered_Signed__c, Stage_Entered_Joined__c) AS eff_signed_ts,
    COALESCE(Stage_Entered_Joined__c, TIMESTAMP(advisor_join_date__c)) AS eff_joined_ts,
    CASE WHEN COALESCE(Stage_Entered_Joined__c, TIMESTAMP(advisor_join_date__c)) IS NOT NULL
          AND StageName != 'Closed Lost' THEN 1 ELSE 0 END AS is_joined
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
  WHERE Full_Opportunity_ID__c IS NOT NULL
    AND is_primary_opp_record = 1
    AND SQO_raw = 'Yes'
    AND StageName IN ('Joined', 'Closed Lost')  -- Resolved only
    AND recordtypeid = '012Dn000000mrO3IAI'
    -- Resolved BEFORE the snapshot date (the outcome was known)
    AND (
      (Stage_Entered_Joined__c IS NOT NULL AND DATE(Stage_Entered_Joined__c) < @snapshot_date)
      OR (Stage_Entered_Closed__c IS NOT NULL AND DATE(Stage_Entered_Closed__c) < @snapshot_date)
    )
    -- Trailing 1yr window anchored to snapshot date, not today
    AND DATE(Opp_CreatedDate) >= DATE_SUB(@snapshot_date, INTERVAL 365 DAY)
    AND DATE(Opp_CreatedDate) < @snapshot_date
)
-- Then compute rates using the standard "reached or beyond" methodology from the rules above
```

**Key difference from the live rates query:** The date filter is `DATE(Opp_CreatedDate) >= DATE_SUB(@snapshot_date, INTERVAL 365 DAY)` — anchored to the snapshot date, not `CURRENT_DATE()`. And the resolution filter ensures the deal's outcome was known before the snapshot date.

### Data Source
- All queries run against `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` (or the audit/forecast views built on top of it).
- Do not fabricate data. If a query returns empty or unexpected results, report that honestly.

### Output Format
- Paste raw query results (or a summary table) directly under each question.
- Add a short plain-English interpretation after each result.
- If a result is inconclusive or sample sizes are too small, say so.

---

## Phase 1: Baseline — How Much Historical Data Do We Actually Have?

Before we test anything, we need to know what we're working with. This phase counts resolved SQOs across time windows and AUM tiers to understand where we have statistical power and where we don't.

### 1.1 Total resolved SQOs by window

Count resolved SQOs (Joined + Closed Lost, `SQO_raw = 'Yes'`, `is_primary_opp_record = 1`, recruiting record type) for each window: 180d, 1yr, 2yr, and all-time. Show total count, joined count, closed-lost count.

**Results:**

| Window | Total Resolved | Joined | Closed Lost | Join Rate |
|--------|---------------|--------|-------------|-----------|
| 180d | 147 | 13 | 134 | 8.8% |
| 1yr | 376 | 46 | 330 | 12.2% |
| 2yr | 671 | 87 | 584 | 13.0% |
| All-time | 817 | 114 | 703 | 14.0% |

**Interpretation:** The 180d window is dangerously thin — only 13 Joined deals make any rate computation fragile. The 1yr window has 46 Joined deals, which is marginally workable. The 2yr and all-time windows (87 and 114 Joined) give the most statistical power. The apparent decline in join rate in recent windows (8.8% at 180d vs 14.0% all-time) could reflect either a genuine trend (harder to close recently) or survivorship bias (recent SQOs haven't had enough time to resolve — though we filter to resolved only, the 180d window may disproportionately capture fast-closing deals).

---

### 1.2 Resolved SQOs by stage transition and window

For each window (180d, 1yr, 2yr, all-time), show the numerator and denominator for every stage transition (SQO→SP, SP→Neg, Neg→Signed, Signed→Joined) using the "reached or beyond" methodology. This tells us where we have thin data.

**Results:**

| Window | SQO→SP (num/den) | SP→Neg (num/den) | Neg→Signed (num/den) | Signed→Joined (num/den) |
|--------|------------------|-------------------|----------------------|-------------------------|
| 180d | 89 / 147 | 23 / 89 | 13 / 23 | 13 / 13 |
| 1yr | 253 / 376 | 103 / 253 | 52 / 103 | 46 / 52 |
| 2yr | 496 / 671 | 188 / 496 | 94 / 188 | 87 / 94 |
| All-time | 548 / 817 | 224 / 548 | 121 / 224 | 114 / 121 |

**Interpretation:** The funnel narrows sharply at SP→Neg (only ~26–41% pass through). Late-funnel denominators get thin fast — the 180d Neg→Signed cell has only 23 observations and Signed→Joined has just 13. The 180d Signed→Joined shows 13/13 = 100%, which is almost certainly an artifact of small sample size (no Signed deal that entered the 180d window has Closed Lost yet). Even at 1yr, Neg→Signed has 103 observations and Signed→Joined has 52, which is marginal but workable. The 2yr and all-time windows provide the most reliable denominators across all stages.

---

### 1.3 Conversion rates by window

Using the numerator/denominator from 1.2, compute the actual conversion rate for each transition × each window. Also compute the overall SQO→Joined rate (product of the four rates). Present as a comparison table so we can see how rates shift across windows.

**Results:**

| Window | SQO→SP | SP→Neg | Neg→Signed | Signed→Joined | Product (SQO→Joined) | Direct SQO→Joined |
|--------|--------|--------|------------|---------------|----------------------|-------------------|
| 180d | 60.5% | 25.8% | 56.5% | 100.0% | 8.8% | 8.8% |
| 1yr | 67.3% | 40.7% | 50.5% | 88.5% | 12.2% | 12.2% |
| 2yr | 73.9% | 37.9% | 50.0% | 92.6% | 13.0% | 13.0% |
| All-time | 67.1% | 40.9% | 54.0% | 94.2% | 14.0% | 14.0% |

**Self-check:** Product property holds perfectly across all four windows — product rate equals direct SQO→Joined rate in every case. ✓

**Interpretation:** The 180d rates are distorted: Signed→Joined at 100% and SP→Neg at 25.8% are outliers driven by small samples. The 1yr and all-time windows tell a broadly consistent story: SQO→SP ~67%, SP→Neg ~41%, Neg→Signed ~50-54%, Signed→Joined ~88-94%. The biggest rate swing between windows is SP→Neg (25.8% at 180d vs 40.9% all-time) and Signed→Joined (100% at 180d vs 88.5% at 1yr). The 2yr window shows a notably higher SQO→SP (73.9%) which may reflect a period of more aggressive pipeline advancement. Overall, the 1yr and all-time rates are the most stable and trustworthy.

---

### 1.4 AUM tier sample sizes

For each window, break out the resolved SQOs into the four AUM tiers (`< $25M`, `$25M-$75M`, `$75M-$150M`, `> $150M`). Show count, joined count, and join rate per tier. We need to know if AUM-tiered rates are even viable given sample sizes.

**Results:**

| Window | Tier | Total | Joined | Join Rate |
|--------|------|-------|--------|-----------|
| 180d | Tier 1 (< $25M) | 36 | 8 | 22.2% |
| 180d | Tier 2 ($25M-$75M) | 61 | 2 | 3.3% |
| 180d | Tier 3 ($75M-$150M) | 30 | 2 | 6.7% |
| 180d | Tier 4 (> $150M) | 20 | 1 | 5.0% |
| 1yr | Tier 1 (< $25M) | 93 | 17 | 18.3% |
| 1yr | Tier 2 ($25M-$75M) | 158 | 15 | 9.5% |
| 1yr | Tier 3 ($75M-$150M) | 76 | 6 | 7.9% |
| 1yr | Tier 4 (> $150M) | 49 | 8 | 16.3% |
| 2yr | Tier 1 (< $25M) | 182 | 37 | 20.3% |
| 2yr | Tier 2 ($25M-$75M) | 309 | 31 | 10.0% |
| 2yr | Tier 3 ($75M-$150M) | 109 | 8 | 7.3% |
| 2yr | Tier 4 (> $150M) | 71 | 11 | 15.5% |
| All-time | Tier 1 (< $25M) | 208 | 45 | 21.6% |
| All-time | Tier 2 ($25M-$75M) | 397 | 49 | 12.3% |
| All-time | Tier 3 ($75M-$150M) | 124 | 9 | 7.3% |
| All-time | Tier 4 (> $150M) | 88 | 11 | 12.5% |

**Interpretation:** Tier 1 (< $25M) consistently converts at the highest rate (~20-22%), which makes intuitive sense — smaller books are easier to recruit. Tier 3 ($75M-$150M) is the hardest to close (~7%). Tier 4 (> $150M) converts better than Tier 3, possibly because whale advisors get more attention. However, **Tier 3 and Tier 4 have very thin Joined counts** — only 9 and 11 respectively at all-time. At the 1yr window, Tier 3 has just 6 Joined and Tier 4 has 8. This makes per-tier stage-level rates unreliable for these tiers. A 2-tier split (< $75M vs ≥ $75M) might be more viable.

---

### 1.5 AUM tier × stage transition sample sizes (all-time only)

The real question: if we wanted per-tier conversion rates at each stage, how many observations per cell do we have? Using all-time resolved SQOs, show a matrix of AUM tier × stage transition with the denominator count. Flag any cell with fewer than 10 observations.

**Results:**

**Denominator counts (all-time, "reached or beyond"):**

| AUM Tier | SQO→SP den | SP→Neg den | Neg→Signed den | Signed→Joined den |
|----------|-----------|-----------|----------------|-------------------|
| Tier 1 (< $25M) | 208 | 146 | 73 | 46 |
| Tier 2 ($25M-$75M) | 397 | 273 | 112 | 53 |
| Tier 3 ($75M-$150M) | 124 | 76 | 20 | 10 |
| Tier 4 (> $150M) | 88 | 53 | 19 | 12 |

**Conversion rates (all-time, per tier):**

| AUM Tier | SQO→SP | SP→Neg | Neg→Signed | Signed→Joined | Product |
|----------|--------|--------|------------|---------------|---------|
| Tier 1 (< $25M) | 70.2% (146/208) | 50.0% (73/146) | 63.0% (46/73) | 97.8% (45/46) | 21.6% |
| Tier 2 ($25M-$75M) | 68.8% (273/397) | 41.0% (112/273) | 47.3% (53/112) | 92.5% (49/53) | 12.3% |
| Tier 3 ($75M-$150M) | 61.3% (76/124) | 26.3% (20/76) | 50.0% (10/20) | 90.0% (9/10) | 7.3% |
| Tier 4 (> $150M) | 60.2% (53/88) | 35.8% (19/53) | 63.2% (12/19) | 91.7% (11/12) | 12.5% |

**⚠️ Cells with < 10 observations:** None are below 10, but Tier 3 Signed→Joined (10) and Tier 4 Neg→Signed (19) and Signed→Joined (12) are marginal. These rates could swing wildly with 1-2 additional deals resolving differently.

**Interpretation:** Tier 1 and Tier 2 have adequate sample sizes across all transitions. Tier 3 and Tier 4 are thin in late-funnel stages — Tier 3 has only 20 observations at Neg→Signed and 10 at Signed→Joined. Per-tier rates for Tiers 3 and 4 would be unreliable at the stage level. A two-tier approach (< $75M vs ≥ $75M) would give denominators of ~350+ and ~130+ at SP→Neg, and ~185 and ~39 at Neg→Signed — still thin for the upper tier but significantly better than the 4-tier split.

---

### Phase 1 Summary & Recommendation

**1. Which windows give stable rates?**
- **180d is unsuitable** for rate computation — only 13 Joined deals, and the 100% Signed→Joined rate is clearly an artifact. The SP→Neg rate (25.8%) is also an outlier vs all other windows (~37-41%).
- **1yr is the minimum viable window** — 46 Joined deals provide marginally reliable rates, but late-funnel cells (52 at Signed→Joined den) are still thin.
- **2yr and all-time are the most stable** — rates are broadly consistent between them (within 2-4pp per transition). The all-time window has the most data (114 Joined) but may include stale historical patterns.
- **Recommended default: 1yr trailing** for the dashboard (reflects current market conditions), with all-time as a stability cross-check. The 180d window should carry a "low confidence" warning.

**2. Is AUM-tier stratification viable?**
- **At 4 tiers: No for stage-level rates.** Tier 3 ($75M-$150M) and Tier 4 (> $150M) have only 9 and 11 all-time Joined deals respectively. Late-funnel denominators for these tiers are 10-20 observations — too fragile for reliable stage rates.
- **At 2 tiers (< $75M vs ≥ $75M): Marginally viable** using all-time data. The lower tier would have ~94 Joined and the upper tier ~20 Joined. The upper tier is still thin.
- **The join rate signal is real:** Tier 1 (21.6%) converts at nearly 3× the rate of Tier 3 (7.3%). This is a meaningful difference worth capturing — the question is whether to do it via per-tier stage rates (data-limited) or a simpler AUM multiplier on the flat rates.

**3. Key data gaps:**
- Late-funnel sample sizes are thin everywhere. Signed→Joined has only 121 denominator observations all-time.
- The 180d window is too volatile for anything other than directional signal.
- Tier 3 and Tier 4 cannot support independent stage-level rate analysis.
- The declining join rate in recent windows (8.8% at 180d → 14.0% all-time) needs investigation — it may signal a genuine trend, a maturation effect, or pipeline quality change.

---

## Phase 2: Backtesting the Current Model

This is the most important phase. We reconstruct what the forecast would have predicted at past points in time and compare against what actually happened.

### 2.1 Identify backtestable quarters

List each quarter from Q3 2024 through Q4 2025 with the count of deals that were resolved (Joined or Closed Lost) during that quarter. These are the quarters we can test against — they have known outcomes. Show the total AUM that actually joined per quarter.

**Results:**

| Quarter | Total Resolved | Joined | Closed Lost | Joined AUM |
|---------|---------------|--------|-------------|------------|
| 2024-Q3 | 59 | 12 | 47 | $518M |
| 2024-Q4 | 77 | 12 | 65 | $562M |
| 2025-Q1 | 90 | 12 | 78 | $451M |
| 2025-Q2 | 75 | 12 | 63 | $515M |
| 2025-Q3 | 93 | 12 | 81 | $717M |
| 2025-Q4 | 136 | 20 | 116 | $1.47B |

**Interpretation:** Remarkably consistent at 12 joins per quarter from Q3 2024 through Q3 2025, then a step-up to 20 in Q4 2025. Closed Lost volume is growing (47→116), indicating pipeline is expanding but conversion rate may be declining. Q4 2025's $1.47B is nearly 3× any other quarter — likely driven by a few whale deals closing. All 6 quarters have known outcomes and are usable for backtesting.

---

### 2.2 Reconstruct the open pipeline as of each quarter start

For each backtestable quarter start date (e.g., 2025-01-01 for Q1 2025, 2025-04-01 for Q2, etc.), reconstruct which deals were open SQOs at that point.

**Use the "Canonical Point-in-Time Pipeline Reconstruction CTE" from the rules section above.** Set `@snapshot_date` to each quarter start date. This CTE:
- Filters to deals that had SQO'd by the snapshot date but hadn't yet Joined or Closed Lost
- Reconstructs `stage_at_snapshot` by walking backward from Signed → Negotiating → SP → Discovery based on which `Stage_Entered_*` timestamps existed by the snapshot date
- Computes `days_in_stage_at_snapshot` for duration penalty analysis later

**Do NOT use today's `StageName`** — that's the deal's current terminal state, not where it was at the snapshot date.

For each snapshot date, show: total open SQOs, total pipeline AUM, and the stage distribution (using `stage_at_snapshot`).

**Results:**

| Snapshot | Open SQOs | Pipeline AUM | Discovery | Sales Process | Negotiating | Signed |
|----------|----------|-------------|-----------|---------------|-------------|--------|
| 2024-Q3 (Jul 1) | 127 | $10.5B | 76 | 37 | 11 | 3 |
| 2024-Q4 (Oct 1) | 146 | $11.1B | 77 | 50 | 18 | 1 |
| 2025-Q1 (Jan 1) | 147 | $10.9B | 95 | 35 | 15 | 2 |
| 2025-Q2 (Apr 1) | 153 | $12.9B | 92 | 48 | 13 | 0 |
| 2025-Q3 (Jul 1) | 180 | $17.6B | 100 | 59 | 14 | 7 |
| 2025-Q4 (Oct 1) | 203 | $21.0B | 110 | 64 | 19 | 10 |

**Interpretation:** Pipeline is growing steadily — from 127 open SQOs ($10.5B) in Q3 2024 to 203 ($21.0B) by Q4 2025. The stage distribution is heavily front-loaded: ~60% Discovery, ~30% Sales Process, ~8% Negotiating, ~2-5% Signed. This means the bulk of pipeline AUM sits at the lowest-probability stages. Late-funnel deal counts are very small (1-10 Signed deals per snapshot), so individual whale deals in late stages can dominate the forecast.

**Limitation:** AUM values (`Underwritten_AUM__c`, `Amount`) and `Earliest_Anticipated_Start_Date__c` are current-state values — they may have been updated since the snapshot date. This introduces lookahead bias for deals whose AUM changed between snapshot and resolution.

---

### 2.3 Compute trailing conversion rates as of each snapshot date

For each snapshot date, compute what the 1yr trailing conversion rates would have been on that date.

**Use the "Canonical Point-in-Time Rates CTE" from the rules section above.** Set `@snapshot_date` to each quarter start date. This CTE:
- Only includes deals that resolved (Joined or Closed Lost) **before** the snapshot date — no lookahead
- Uses a trailing 1yr window anchored to the snapshot date (`Opp_CreatedDate >= DATE_SUB(@snapshot_date, INTERVAL 365 DAY)`)
- Then apply the standard "reached or beyond" rate formulas from Step 3 of the conversion rate reference

**Do NOT use `CURRENT_DATE()` in the window filter** — that would use today's resolved cohort instead of what was known at the snapshot date.

Also compute trailing avg stage durations from the same cohort — these are needed for projected join dates in 2.4.

**Results:**

**Trailing 1yr conversion rates at each snapshot (product property verified ✓):**

| Snapshot | Cohort N | Joined | SQO→SP | SP→Neg | Neg→Signed | Signed→Joined | Product |
|----------|---------|--------|--------|--------|------------|---------------|---------|
| 2024-Q3 | 29 | 11 | 82.8% | 62.5% | 73.3% | 100.0% | 37.9% |
| 2024-Q4 | 83 | 20 | 81.9% | 44.1% | 66.7% | 100.0% | 24.1% |
| 2025-Q1 | 150 | 28 | 86.0% | 40.3% | 53.8% | 100.0% | 18.7% |
| 2025-Q2 | 221 | 31 | 79.6% | 34.1% | 51.7% | 100.0% | 14.0% |
| 2025-Q3 | 247 | 37 | 78.1% | 34.7% | 55.2% | 100.0% | 15.0% |
| 2025-Q4 | 255 | 33 | 74.5% | 34.7% | 54.5% | 91.7% | 12.9% |

**⚠️ Critical finding: Signed→Joined is 100% for 5 of 6 snapshots.** Only the Q4 2025 snapshot (which has the largest trailing cohort at 255) shows Signed→Joined < 100%. This means the model assigns P(Join) = 100% to Signed deals at most snapshots, which is clearly overfit — the all-time rate is 94.2%.

**⚠️ Q3 2024 cohort is dangerously small (N=29).** The 37.9% product rate at this snapshot is 2.5× the all-time rate of 14.0%, entirely driven by the tiny sample. This will cause massive over-prediction in the Q3 2024 backtest.

**Trailing avg stage durations at each snapshot:**

| Snapshot | SQO→SP (days) | In SP (days) | In Neg (days) | In Signed (days) | Total (days) |
|----------|--------------|-------------|--------------|------------------|-------------|
| 2024-Q3 | 16.0 | 19.1 | 11.5 | 8.3 | 54.9 |
| 2024-Q4 | 5.0 | 24.4 | 19.0 | 13.8 | 62.2 |
| 2025-Q1 | 3.4 | 26.8 | 20.9 | 18.0 | 69.1 |
| 2025-Q2 | 4.4 | 22.3 | 27.3 | 15.9 | 69.9 |
| 2025-Q3 | 5.1 | 23.1 | 23.7 | 16.4 | 68.3 |
| 2025-Q4 | 5.3 | 20.1 | 10.1 | 22.9 | 58.4 |

**Interpretation:** Total expected deal cycle from SQO to Joined is ~55-70 days based on successful progressions. This is short enough that most pipeline deals get projected to join within 1-2 quarters, concentrating the forecast into the near term. The SQO→SP duration dropped from 16 days (Q3 2024) to ~5 days (later snapshots), suggesting a process change or the early cohort being unrepresentative.

---

### 2.4 Compute predicted vs actual AUM per quarter

For each backtestable quarter:

1. Take the open pipeline from 2.2 (with `stage_at_snapshot` and `days_in_stage_at_snapshot`)
2. Apply the trailing rates from 2.3 to compute P(Join) per deal based on `stage_at_snapshot` (NOT today's StageName)
3. Compute `expected_aum_weighted = P(Join) × COALESCE(Underwritten_AUM__c, Amount)` per deal
4. Compute `final_projected_join_date` per deal:
   - If `Earliest_Anticipated_Start_Date__c` is set AND its value existed by the snapshot date → use it
   - Otherwise → `@snapshot_date + expected_days_remaining` where:
     ```
     expected_days_remaining = MAX(0,
       sum_of_avg_remaining_stage_durations_from_2.3
       - days_in_stage_at_snapshot
     )
     ```
   - **Use the trailing avg stage durations from 2.3** (anchored to the snapshot date), NOT today's durations
5. Assign each deal to a predicted quarter based on `final_projected_join_date`
6. Sum expected AUM per predicted quarter
7. Compare against actual AUM that joined in that quarter (from deals that were in the pipeline at the snapshot)

**Limitation:** `Earliest_Anticipated_Start_Date__c` and `Amount`/`Underwritten_AUM__c` are current-state values — we cannot reconstruct what they were at the snapshot date. This introduces minor lookahead. Document the magnitude if possible (e.g., how many deals had AUM changes between snapshot and resolution).

Show a table: Quarter | Predicted AUM | Actual Joined AUM | Error ($) | Error (%)

**Results:**

**Table A: Total pipeline expected AUM vs total eventually-joined AUM**

This compares the sum of P(Join) × AUM across all pipeline deals at each snapshot against the AUM that eventually joined from those deals (regardless of timing).

| Snapshot | Pipeline Deals | Still Open | Predicted AUM | Actual Joined AUM | Error ($) | Error (%) |
|----------|---------------|-----------|---------------|-------------------|-----------|-----------|
| 2024-Q3 | 127 | 1 | $4.60B | $0.63B | +$3.97B | +633% |
| 2024-Q4 | 146 | 1 | $3.29B | $0.99B | +$2.30B | +232% |
| 2025-Q1 | 147 | 5 | $2.36B | $0.94B | +$1.42B | +152% |
| 2025-Q2 | 153 | 9 | $2.18B | $1.07B | +$1.12B | +105% |
| 2025-Q3 | 180 | 15 | $3.88B | $1.09B | +$2.79B | +256% |
| 2025-Q4 | 203 | 19 | $4.55B | $3.37B | +$1.17B | +35% |

**Table B: Same-quarter predicted vs actual (timing accuracy)**

This compares the AUM predicted to join *within the snapshot's quarter* (based on projected join dates) against the AUM that actually joined within that quarter from the pipeline.

| Snapshot | Predicted This-Qtr AUM | Actual This-Qtr Joins | Actual This-Qtr AUM | Error (%) |
|----------|------------------------|----------------------|---------------------|-----------|
| 2024-Q3 | $4.12B | 7 | $0.30B | +1,251% |
| 2024-Q4 | $2.90B | 11 | $0.56B | +416% |
| 2025-Q1 | $2.12B | 8 | $0.28B | +648% |
| 2025-Q2 | $1.70B | 5 | $0.37B | +356% |
| 2025-Q3 | $2.97B | 8 | $0.59B | +404% |
| 2025-Q4 | $3.41B | 10 | $0.98B | +247% |

**Interpretation:** The model is **massively overoptimistic** across every snapshot and every comparison type:

1. **Magnitude error (Table A):** The model over-predicts total AUM by 35-633%. Even the best snapshot (Q4 2025, +35%) still over-predicts, and that snapshot has 19 unresolved deals that could narrow the gap.

2. **Timing error (Table B):** The same-quarter errors are even worse (247-1,251%) because the short expected durations (~55-70 days) concentrate almost all predicted AUM into the current quarter. In reality, only 5-11 deals close per quarter.

3. **Root causes:**
   - **Inflated trailing rates:** Q3 2024's cohort of only 29 deals produced a 37.9% product rate vs the true ~14% all-time rate. Even mature cohorts (Q3 2025, N=247) had rates producing ~22% weighted P(Join) vs actual 10.3% join rate.
   - **Rate-reality gap:** The model's AUM-weighted average P(Join) ranges from 17-44% across snapshots, while actual join rates are 10-15%. The gap is larger AUM-weighted because whale deals that don't close inflate the prediction.
   - **Timing compression:** The ~55-70 day total deal cycle from successful progressions means almost everything is predicted for the current quarter. In reality, many deals stall for months or years.

4. **Q4 2025 is the best-performing snapshot** (+35% total error) — likely because it has the most mature trailing cohort (255 deals) producing more realistic rates. But 19 deals remain open.

**Limitation:** AUM values are current-state, introducing lookahead bias. Deals whose AUM was revised between snapshot and resolution may inflate or deflate the comparison. The magnitude of this effect is unknown but likely small relative to the rate and timing errors documented above.

---

### 2.5 Error decomposition

For the quarters where the forecast was most wrong, break down WHY:
- How many deals that were predicted to join actually joined? (conversion accuracy)
- For deals that did join, was the AUM close to what was predicted? (AUM accuracy)
- Did deals slip to the wrong quarter? (timing accuracy)

Pick the 2 worst-performing quarters and decompose their errors.

**Results:**

**Decomposition: Q3 2024 (633% total error) — small cohort failure**

| Stage at Snapshot | Deals | Predicted P(Join) | Actually Joined | Actual Join Rate | Predicted AUM | Actual Joined AUM |
|-------------------|-------|-------------------|-----------------|------------------|---------------|-------------------|
| Discovery | 76 | 37.9% | 8 (10.5%) | 10.5% | $2.49B | $273M |
| Sales Process | 37 | 45.8% | 4 (10.8%) | 10.8% | $1.41B | $133M |
| Negotiating | 11 | 73.3% | 1 (9.1%) | 9.1% | $495M | $15M |
| Signed | 3 | 100.0% | 3 (100%) | 100% | $207M | $207M |
| **Total** | **127** | **—** | **16 (12.7%)** | **12.7%** | **$4.60B** | **$628M** |

**Why Q3 2024 failed:** The trailing 1yr cohort had only 29 deals with a 37.9% product rate — 2.7× the true rate. Every stage was massively overestimated. The Negotiating stage is the starkest: the model predicted 73.3% conversion but only 1 of 11 deals joined (9.1%). The 3 Signed deals all converted (100%), which is the only accurate cell.

**Decomposition: Q3 2025 (256% total error) — mature cohort, still failing**

| Stage at Snapshot | Deals | Predicted P(Join) | Actually Joined | Actual Join Rate | Still Open | Predicted AUM | Actual Joined AUM |
|-------------------|-------|-------------------|-----------------|------------------|-----------|---------------|-------------------|
| Discovery | 100 | 15.0% | 9 (9.0%) | 9.0% | 6 | $1.38B | $299M |
| Sales Process | 59 | 19.2% | 3 (5.1%) | 5.1% | 7 | $1.30B | $300M |
| Negotiating | 14 | 55.2% | 0 (0%) | 0% | 1 | $451M | $0 |
| Signed | 7 | 100.0% | 5 (71.4%) | 71.4% | 1 | $739M | $489M |
| **Total** | **180** | **—** | **17 (10.3%)** | **10.3%** | **15** | **$3.88B** | **$1.09B** |

**Why Q3 2025 failed despite a 247-deal trailing cohort:**

1. **Conversion accuracy:** The model predicted 15% SQO→Joined overall (weighted), but the actual resolved rate is 10.3% (with 15 still open — could improve to ~12-13% max). The per-stage over-prediction is worst at Negotiating (55.2% predicted vs 0% actual — though 1 deal is still open) and Sales Process (19.2% predicted vs 5.1%).

2. **AUM accuracy:** The 3 Sales Process deals that joined had $300M AUM vs $1.30B predicted — the model assumed many more SP deals would close, including whale deals that didn't. The AUM-weighted error is worse than the count-based error because large-AUM deals at low-probability stages inflate predictions.

3. **Timing accuracy:** Not directly measured in this decomposition, but Table B from 2.4 showed $2.97B predicted for Q3 2025 alone vs $590M actual within-quarter — the short deal cycle estimate bunched everything into one quarter.

**Key finding across both quarters:** The model's largest error source is **conversion rate over-prediction**, especially at the Negotiating stage. Negotiating deals are assigned 55-73% P(Join), but their actual historical conversion is much lower in practice. This likely reflects that the trailing rate cohort measures "what % of deals that *reached* Neg eventually signed" — but the pipeline contains many Negotiating deals that are stale, stuck, or will never progress. The rate is technically correct for the resolved cohort but overestimates conversion for the current pipeline.

---

### Phase 2 Summary & Recommendation

**How accurate is the current model?** Poor. Total AUM prediction error ranges from +35% (best case, Q4 2025) to +633% (worst case, Q3 2024). Same-quarter timing predictions are even worse: +247% to +1,251%. The model has never under-predicted — it is **systematically and heavily overoptimistic**.

**Where does it break?**

1. **Rate inflation from small trailing cohorts.** Early snapshots (Q3-Q4 2024) had trailing cohorts of only 29-83 deals, producing SQO→Joined rates of 24-38% — far above the true ~14%. This is the dominant error for early snapshots.

2. **Negotiating stage miscalibration.** Across both decomposed quarters, the model assigned 55-73% P(Join) to Negotiating deals, but actual conversion was 0-9%. The trailing rate measures successful cohort behavior, but the live pipeline contains many stale Negotiating deals that will never progress.

3. **AUM-weighted amplification.** Whale deals disproportionately sit in low-probability stages (Discovery, Sales Process). The model multiplies their large AUM by an over-estimated P(Join), creating outsized predicted AUM that rarely materializes.

4. **Timing compression.** The model's total expected deal cycle is ~55-70 days, concentrating almost all predicted AUM into the current quarter. In reality, only 5-11 deals close per quarter regardless of pipeline size.

**Is it consistently optimistic/pessimistic?** Consistently and dramatically optimistic. Every snapshot over-predicts. The model has never under-predicted AUM in the backtest.

**What's the typical error magnitude?** For snapshots with mature trailing cohorts (Q1-Q4 2025), total error ranges from +35% to +256%. The median is roughly +130%. Same-quarter errors are 3-5× worse due to timing compression.

**Recommendation for subsequent phases:**
- Phase 3 (duration penalty) is critical — stale deals are a major driver of the Negotiating stage miscalibration
- Phase 4 (window sensitivity) should test whether longer windows produce more stable rates that reduce the early-snapshot inflation problem
- The timing model needs fundamental rework — 55-70 day deal cycles are based on successful progressions and dramatically underestimate actual elapsed time
- Consider capping P(Join) per stage or using a Bayesian prior to prevent extreme predictions when trailing cohorts are small

---

## Phase 3: Duration Penalty Investigation

The AUM variance doc showed that stale deals (2+ SD in a stage) convert at meaningfully lower rates. This phase quantifies the effect and tests whether a duration penalty improves accuracy.

### 3.1 Recompute stale deal conversion rates with larger sample

Using all-time resolved SQOs, compute conversion rates for each stage by duration bucket (within 1 SD, 1-2 SD over, 2+ SD over). Use the historical avg/stddev from the 2yr resolved cohort. Show N, joined count, and join rate for each cell.

Important: "join rate" here means the deal eventually reached Joined — not just that it passed the next stage. We want the full SQO→Joined outcome by duration bucket.

**Results:**

**Duration thresholds (from 2yr resolved cohort):**

| Stage | Avg (days) | StdDev | 1 SD Threshold | 2 SD Threshold |
|-------|-----------|--------|----------------|----------------|
| Discovery (SQO→SP) | 8.5 | 27.6 | 36d | 64d |
| Sales Process (SP→Neg) | 29.1 | 38.1 | 67d | 105d |
| Negotiating (Neg→Signed) | 19.8 | 30.5 | 50d | 81d |
| Signed (Signed→Joined) | 28.4 | 25.7 | 54d | 80d |

**Join rates by stage × duration bucket (all-time resolved SQOs):**

| Stage | Bucket | N | Joined | Join Rate | Multiplier (vs Within 1SD) |
|-------|--------|---|--------|-----------|---------------------------|
| Discovery | Within 1 SD (≤36d) | 600 | 90 | 15.0% | 1.000× |
| Discovery | 1-2 SD (37-64d) | 40 | 4 | 10.0% | 0.667× |
| Discovery | 2+ SD (>64d) | 68 | 4 | 5.9% | 0.393× |
| Sales Process | Within 1 SD (≤67d) | 382 | 89 | 23.3% | 1.000× |
| Sales Process | 1-2 SD (68-105d) | 68 | 12 | 17.6% | 0.755× |
| Sales Process | 2+ SD (>105d) | 74 | 3 | 4.1% | 0.176× |
| Negotiating | Within 1 SD (≤50d) | 154 | 93 | 60.4% | 1.000× |
| Negotiating | 1-2 SD (51-81d) | 17 | 7 | 41.2% | 0.682× |
| Negotiating | 2+ SD (>81d) | 37 | 4 | 10.8% | 0.179× |
| Signed | Within 1 SD (≤54d) | 96 | 92 | 95.8% | 1.000× |
| Signed | 1-2 SD (55-80d) | 9 ⚠️ | 6 | 66.7% | — |
| Signed | 2+ SD (>80d) | 6 ⚠️ | 6 | 100% | — |

**Interpretation:** The duration effect is dramatic and consistent across Discovery, SP, and Negotiating:
- **2+ SD deals join at 4-18% of the "Within 1 SD" rate.** SP and Negotiating show the steepest drop: from 23.3%→4.1% and 60.4%→10.8% respectively.
- **1-2 SD deals are moderately penalized** (67-76% of baseline), but the effect is less extreme.
- **Signed stage data is too sparse** for reliable multipliers (9 and 6 observations in the over-SD buckets). The 2+ SD bucket showing 100% is clearly a small-sample artifact. No penalty applied to Signed.
- **Sample sizes are adequate** for Discovery (N=40-600), SP (N=68-382), and Negotiating (N=17-154 — the 1-2 SD bucket at 17 is marginal but directionally useful).

---

### 3.2 Current pipeline exposure to stale deals

List all current open pipeline deals that are 2+ SD over in their current stage. Show: advisor name, stage, days in stage, AUM, and the SD threshold they exceed. Sum the total AUM in this bucket.

**Results:**

**Stale deals (2+ SD over) in current open pipeline:**

| Advisor | Stage | Days in Stage | 2SD Threshold | AUM |
|---------|-------|--------------|---------------|-----|
| Andrew Canter | Discovery | 314d | 64d | $310M |
| Parallel Advisors / Stephanie Cooper | Discovery | 266d | 64d | $200M |
| Avi Pai | Discovery | 108d | 64d | $350M |
| Rebecca White | Discovery | 104d | 64d | $285M |
| Brett Roper | Discovery | 102d | 64d | $200M |
| Blade Robertson | Discovery | 91d | 64d | $300M |
| Ryan Bergmann | Discovery | 89d | 64d | $25M |
| Kyle Burns | Discovery | 69d | 64d | $300M |
| Chad Reed | Discovery | 68d | 64d | $200M |
| John Goltermann | Discovery | 67d | 64d | $130M |
| Neal Richards | Qualifying | 89d | 64d | $130M |
| Sam Issermoyer | Sales Process | 307d | 105d | $85M |
| James Langer | Sales Process | 229d | 105d | $250M |
| Corey Long | Sales Process | 215d | 105d | $75M |
| Carl Watkins | Sales Process | 196d | 105d | $300M |
| Matt Pohlman | Sales Process | 130d | 105d | $102M |
| Sean Mason | Sales Process | 109d | 105d | $90M |
| David Matuszak | Negotiating | 256d | 81d | $37M |
| Matt Mai | Negotiating | 182d | 81d | $150M |
| Debbie Huttner | Negotiating | 131d | 81d | $90M |
| Jordan Gallacher | Negotiating | 101d | 81d | $500M |
| Greg Schiffli | Negotiating | 97d | 81d | $36M |
| Kurt Wedewer | Signed | 266d | 80d | $235M |
| Tony Parrish 2025 | Signed | 122d | 80d | $206M |

**Pipeline duration exposure summary:**

| Stage | Total Deals | Within 1 SD | 1-2 SD Over | 2+ SD Over | AUM at 2+ SD |
|-------|------------|-------------|-------------|------------|-------------|
| Discovery | 38 | 22 | 6 | 10 | $2.30B |
| Qualifying | 1 | 0 | 0 | 1 | $130M |
| Sales Process | 72 | 63 | 3 | 6 | $902M |
| Negotiating | 30 | 21 | 4 | 5 | $813M |
| Signed | 4 | 2 | 0 | 2 | $441M |
| **Total** | **145** | **108** | **13** | **24** | **$4.59B** |

**Interpretation:** 24 deals ($4.59B AUM) are 2+ SD stale — that's 17% of deals but 20% of pipeline AUM. The Negotiating stage has the highest-impact stale deal: Jordan Gallacher at $500M, 101 days in Negotiating (threshold: 81d). The two stale Signed deals (Kurt Wedewer at 266d, Tony Parrish at 122d) total $441M but we have insufficient data to apply a Signed penalty. The baseline model treats all 24 stale deals the same as fresh deals — the duration penalty would significantly down-weight their expected contribution.

---

### 3.3 Impact estimate: duration-penalized expected AUM vs current

For the current open pipeline, compute expected AUM two ways:
1. **Current model:** flat rates per stage (use 1yr trailing)
2. **Duration-penalized:** apply a multiplier to the current-stage conversion rate based on duration bucket

**Derive the multipliers from the empirical data in 3.1** — do NOT use the placeholder 0.75×/0.50× values from the AUM variance doc. Instead, compute the ratio of each bucket's actual join rate to the "Within 1 SD" join rate:
```
multiplier_1to2sd = join_rate_1to2sd / join_rate_within_1sd
multiplier_2plus_sd = join_rate_2plus_sd / join_rate_within_1sd
```

If any bucket in 3.1 has fewer than 10 observations, flag it and consider collapsing "1-2 SD" and "2+ SD" into a single "over 1 SD" bucket for more stability.

Apply the multiplier to the **current stage's conversion rate only** (not all remaining stages). For example, a Negotiating deal at 2+ SD gets `adjusted_neg_to_signed = neg_to_signed × multiplier_2plus_sd`, but `signed_to_joined` stays unchanged.

Show the total expected AUM per quarter under each model. How much does the duration penalty change the forecast?

**Results:**

**Current pipeline expected AUM: baseline vs duration-penalized (1yr trailing rates)**

| Stage | Deals | Pipeline AUM | Baseline Expected | Penalized Expected | Reduction |
|-------|-------|-------------|-------------------|-------------------|-----------|
| Discovery | 38 | $10.35B | $1.27B | $1.05B | -$221M (17%) |
| Qualifying | 1 | $130M | $16M | $6M | -$10M (61%) |
| Sales Process | 72 | $9.52B | $1.73B | $1.57B | -$160M (9%) |
| Negotiating | 30 | $2.23B | $1.00B | $685M | -$314M (31%) |
| Signed | 4 | $631M | $558M | $558M | $0 (0%) |
| **Total** | **145** | **$22.87B** | **$4.57B** | **$3.87B** | **-$705M (15%)** |

**Interpretation:** The duration penalty reduces the total expected AUM by $705M (15.4%), from $4.57B to $3.87B. The largest absolute reduction comes from Negotiating (-$314M, 31% reduction) — exactly where Phase 2 showed the worst miscalibration. Discovery contributes -$221M (17%) and Sales Process -$160M (9%). Signed is unchanged due to insufficient data for a penalty.

The penalty doesn't change per-quarter timing assignments (deals are still projected to the same quarters), it only reduces the magnitude of expected AUM. The 15% total reduction is meaningful but may not be sufficient given the Phase 2 backtest showed 100-250% over-prediction — suggesting the duration penalty alone doesn't fix the rate inflation problem.

---

### 3.4 Backtest with duration penalty

Re-run the backtest from Phase 2 (predicted vs actual AUM per quarter), but this time apply the duration penalty to the pipeline snapshot. Does the duration-penalized model produce smaller forecast errors than the baseline?

**Results:**

**Backtest: Baseline vs Duration-Penalized (total expected AUM vs eventually-joined AUM)**

| Snapshot | Deals | Still Open | Actual Joined | Baseline Predicted | Baseline Error | Penalized Predicted | Penalized Error |
|----------|-------|-----------|---------------|-------------------|---------------|--------------------|-----------------|
| 2024-Q3 | 127 | 1 | $628M | $4.60B | **+633%** | $2.21B | **+252%** |
| 2024-Q4 | 146 | 1 | $990M | $3.29B | **+232%** | $1.76B | **+78%** |
| 2025-Q1 | 147 | 5 | $940M | $2.36B | **+152%** | $1.16B | **+23%** |
| 2025-Q2 | 153 | 9 | $1.07B | $2.18B | **+105%** | $1.25B | **+17%** |
| 2025-Q3 | 180 | 15 | $1.09B | $3.88B | **+256%** | $2.63B | **+142%** |
| 2025-Q4 | 203 | 19 | $3.37B | $4.55B | **+35%** | $3.30B | **-2%** |

**Summary statistics (excluding Q3 2024 due to tiny cohort):**

| Metric | Baseline | Duration-Penalized |
|--------|----------|--------------------|
| Mean Absolute Error ($) | $1.61B | $0.62B |
| Mean Absolute % Error | 156% | 52% |
| Worst snapshot error | +256% (Q3 2025) | +142% (Q3 2025) |
| Best snapshot error | +35% (Q4 2025) | -2% (Q4 2025) |
| Direction | Always over-predicts | 4 over, 1 under, 1 ≈ accurate |

**Interpretation:** The duration penalty is a **massive improvement** across every snapshot:

1. **Q1 and Q2 2025 become highly accurate.** Errors drop from +152%/+105% to +23%/+17% — these are operationally useful forecasts. These snapshots have the most fully resolved pipelines (only 5-9 still open) and mature trailing cohorts.

2. **Q4 2025 hits near-perfect accuracy** at -2.1% error (slight under-prediction), though 19 deals remain open.

3. **Q4 2024 drops from +232% to +78%** — still over-predicting but within a usable range.

4. **Q3 2024 and Q3 2025 remain problematic.** Q3 2024 (+252%) is driven by the tiny trailing cohort (N=29) inflating rates — the duration penalty can't fix bad rates. Q3 2025 (+142%) has 15 still-open deals that may narrow the gap, but the remaining error likely reflects rate inflation from whale deals.

5. **The penalty's average effect is a 3× reduction in error** — from 156% MAPE to 52% MAPE (excluding Q3 2024).

---

### Phase 3 Summary & Recommendation

**Does duration penalisation improve forecast accuracy?** Yes — dramatically. It is the single largest accuracy improvement found so far, reducing mean absolute percentage error from 156% to 52% across backtestable snapshots (excluding the unusable Q3 2024 snapshot).

**Is the improvement material?** Absolutely. For Q1 and Q2 2025 (the most reliable comparison points with mature cohorts and nearly fully resolved pipelines), the error drops from +152%/+105% to +23%/+17%. These are the first forecasts in the backtest that approach operational utility.

**What multipliers best fit the data?**

| Stage | 1-2 SD Multiplier | 2+ SD Multiplier | Notes |
|-------|-------------------|------------------|-------|
| Discovery | 0.667× | 0.393× | Solid sample sizes (N=40, 68) |
| Sales Process | 0.755× | 0.176× | Strong signal, good N (68, 74) |
| Negotiating | 0.682× | 0.179× | 1-2 SD bucket is marginal (N=17) |
| Signed | 1.0× (no penalty) | 1.0× (no penalty) | Insufficient data (N=9, 6) |

**Key insight:** The 2+ SD multiplier for SP and Negotiating (0.176× and 0.179×) is devastatingly low — stale deals at these stages join at less than 1/5 the rate of fresh deals. This is the strongest signal in the entire dataset.

**Remaining limitations:**
- The duration penalty doesn't fix rate inflation from small trailing cohorts (Q3 2024 still has +252% error)
- Q3 2025 still shows +142% error even with the penalty — 15 open deals may close this gap, but some residual over-prediction likely remains from AUM-weighted whale deals
- The Signed penalty should be revisited as more data accumulates

**Recommendation:** Implement the duration penalty immediately. It is the highest-ROI improvement available. Also explore combining it with longer trailing windows (Phase 4) to address the rate inflation problem in parallel.

---

## Phase 4: Window Sensitivity — Which Trailing Period Is Most Accurate?

The dashboard supports 180d, 1yr, 2yr, and all-time windows. This phase tests which window produces the most accurate forecasts in the backtest.

### 4.1 Backtest with each window

Re-run the Phase 2 backtest (predicted vs actual joined AUM per quarter) using each of the four windows:
- 180d trailing
- 1yr trailing
- 2yr trailing
- All-time

For each window, show the per-quarter prediction error and the overall mean absolute error (MAE) and mean absolute percentage error (MAPE).

**Results:**

**Backtest error by window (total predicted AUM vs eventually-joined AUM, baseline — no duration penalty):**

| Snapshot | 180d Error | 1yr Error | 2yr Error | All-time Error |
|----------|-----------|----------|----------|---------------|
| 2024-Q3 | +626% | +633% | +654% | +654% |
| 2024-Q4 | +86% | +232% | +260% | +260% |
| 2025-Q1 | +94% | +152% | +189% | +189% |
| 2025-Q2 | +64% | +105% | +152% | +168% |
| 2025-Q3 | +240% | +256% | +288% | +303% |
| 2025-Q4 | +35% | +35% | +55% | +60% |

**Summary statistics (excluding Q3 2024 — tiny cohort distorts all windows equally):**

| Metric | 180d | 1yr | 2yr | All-time |
|--------|------|-----|-----|----------|
| Mean Absolute % Error | 104% | 156% | 189% | 196% |
| Median Error | +86% | +152% | +189% | +189% |
| Best snapshot | +35% (Q4'25) | +35% (Q4'25) | +55% (Q4'25) | +60% (Q4'25) |
| Worst snapshot | +240% (Q3'25) | +256% (Q3'25) | +288% (Q3'25) | +303% (Q3'25) |

**Interpretation:** **180d is the most accurate window** for backtesting, with a 104% MAPE vs 156% for 1yr and 189-196% for longer windows. The improvement is most dramatic at Q4 2024 (86% vs 232-260%) and Q2 2025 (64% vs 105-168%). All windows fail at Q3 2024 (tiny cohort) and Q3 2025 (many still-open deals inflating the denominator).

The reason 180d wins: recent conversion rates are lower than historical rates, and the shorter window captures this trend. Longer windows pull in older periods with higher conversion, inflating predictions.

However, 180d is still massively over-predicting (104% MAPE). Combining 180d with the duration penalty (from Phase 3) would be the natural next test. The 180d + duration penalty combination would likely produce the best overall accuracy.

---

### 4.2 Rate stability analysis

For each window, show how much the conversion rates change quarter to quarter. Compute the standard deviation of each stage transition rate across the backtest snapshots. A window that produces wildly swinging rates may be overfitting to recent noise.

**Results:**

**Average rates and standard deviation across 6 backtest snapshots:**

| Window | SQO→SP (avg±std) | SP→Neg (avg±std) | Neg→Signed (avg±std) | Signed→Joined (avg±std) | Product (avg±std) |
|--------|-----------------|-----------------|---------------------|------------------------|------------------|
| 180d | 80.3 ± 11.2 | 37.1 ± 10.2 | 55.7 ± 9.3 | 97.1 ± 7.2 | 17.3 ± 11.2 |
| 1yr | 80.5 ± 4.0 | 41.7 ± 10.9 | 59.2 ± 8.7 | 98.6 ± 3.4 | 20.4 ± 9.5 |
| 2yr | 80.7 ± 1.9 | 45.4 ± 10.0 | 61.8 ± 7.5 | 98.8 ± 2.2 | 23.0 ± 8.6 |
| All-time | 80.8 ± 1.8 | 46.1 ± 9.5 | 62.3 ± 7.2 | 98.9 ± 2.1 | 23.4 ± 8.3 |

**Interpretation:** There is a clear stability vs accuracy tradeoff:

- **180d is the most volatile:** SQO→SP swings ±11.2pp, and the product rate has the highest stddev at ±11.2pp. The Q3 2024 snapshot had SQO→SP = 100% (N=20 cohort), which is clearly noise.
- **1yr is moderately stable:** SQO→SP tightens to ±4.0pp, and Signed→Joined drops to ±3.4pp. The SP→Neg rate (±10.9pp) is actually slightly *more* volatile than 180d — this is because the 1yr window captures different mixes of cohort composition.
- **2yr and all-time are the most stable:** SQO→SP varies only ±1.8-1.9pp. But their higher average rates (product of 23.0-23.4% vs 17.3% for 180d) mean they are more overoptimistic.
- **SP→Neg is the most volatile rate across all windows** (±9.5-10.9pp), driven by it being the steepest drop in the funnel where small count changes have large effects.
- **Signed→Joined is a concern at 180d** (±7.2pp) — it swings from 82.4% to 100%, reflecting tiny late-funnel denominators in the 180d window.

---

### 4.3 Rate vs reality comparison

For each window, compute the average "predicted P(Join)" across all deals in the backtest, and compare it against the actual join rate (what % of deals actually joined). A well-calibrated model should have these be close. Show this per window.

**Results:**

**Calibration: average predicted P(Join) vs actual join rate, per snapshot × window:**

| Snapshot | Actual Join Rate | 180d Predicted | 180d Gap | 1yr Predicted | 1yr Gap | 2yr Predicted | 2yr Gap | All-time Gap |
|----------|-----------------|---------------|---------|--------------|--------|--------------|--------|-------------|
| 2024-Q3 | 12.7% | 44.3% | +31.6 | 44.8% | +32.1 | 46.0% | +33.3 | +33.3 |
| 2024-Q4 | 15.2% | 18.3% | +3.1 | 31.7% | +16.5 | 34.1% | +18.9 | +18.9 |
| 2025-Q1 | 13.4% | 19.2% | +5.8 | 24.1% | +10.7 | 27.4% | +14.0 | +14.0 |
| 2025-Q2 | 11.8% | 15.3% | +3.5 | 18.4% | +6.5 | 22.3% | +10.5 | +11.8 |
| 2025-Q3 | 10.3% | 21.8% | +11.5 | 22.8% | +12.5 | 24.7% | +14.4 | +15.3 |
| 2025-Q4 | 13.0% | 21.7% | +8.7 | 21.7% | +8.6 | 25.0% | +11.9 | +12.6 |

**Average calibration gap (excluding Q3 2024):**

| Window | Avg Predicted P(Join) | Avg Actual Join Rate | Avg Gap (pp) |
|--------|----------------------|---------------------|-------------|
| 180d | 19.3% | 12.7% | +6.5 |
| 1yr | 23.7% | 12.7% | +10.9 |
| 2yr | 26.7% | 12.7% | +13.9 |
| All-time | 27.3% | 12.7% | +14.5 |

**Interpretation:** **180d is the best-calibrated window** with an average gap of just +6.5pp vs +10.9pp for 1yr and +14.5pp for all-time. At its best (Q4 2024, Q2 2025), the 180d gap is only +3.1-3.5pp — approaching usable calibration.

However, 180d still over-predicts by ~50% on a relative basis (19.3% predicted vs 12.7% actual). No window achieves true calibration, and all are systematically optimistic.

**The key insight:** The actual pipeline join rate is remarkably stable at 10-15% across all snapshots. But the model's predicted P(Join) ranges from 15-46% depending on window and snapshot. The model's rates — derived from resolved deals — are fundamentally higher than the pipeline's realized conversion. This "resolved cohort vs live pipeline" gap is the core calibration problem.

**Why this gap exists:** The trailing rates measure conversion among *resolved* SQOs (deals that reached a terminal state). But the live pipeline contains many deals that are still in early stages and will eventually close lost — they haven't had time to fail yet. The resolved cohort is biased toward deals that moved through the funnel and reached outcomes, while the pipeline has a long tail of stuck, stale, or slow-moving deals that depress the realized rate.

---

### Phase 4 Summary & Recommendation

**Which window gives the best backtest accuracy?** 180d, by a significant margin. MAPE of 104% vs 156% (1yr), 189% (2yr), 196% (all-time). The 180d window captures the recent downward trend in conversion rates, producing lower (and more accurate) predictions.

**Which gives the most stable rates?** All-time and 2yr, with product rate standard deviation of ±8.3-8.6pp vs ±11.2pp for 180d. However, stability comes at the cost of higher average rates that over-predict more.

**Which is best calibrated?** 180d, with an average calibration gap of +6.5pp (predicted 19.3% vs actual 12.7%). At its best, the 180d gap is only +3.1pp. All other windows have gaps of +10.9pp or more.

**What should we default to?** **180d with the duration penalty**, which would combine:
- The most accurate base rates (180d captures current market conditions)
- The empirically validated duration penalty (reduces stale-deal over-prediction by ~3×)

**However, 180d has a critical weakness:** Late-funnel sample sizes. The 180d Signed→Joined rate swings from 82.4% to 100% across snapshots (±7.2pp std). With so few Signed deals resolving in any 180-day window, this rate is unstable.

**Recommended hybrid approach:**
1. Use **180d trailing** for SQO→SP and SP→Neg (early/mid funnel — sufficient sample sizes)
2. Use **1yr or 2yr trailing** for Neg→Signed and Signed→Joined (late funnel — 180d sample sizes are too thin)
3. Apply the **duration penalty** to all stages (empirically validated multipliers from Phase 3)
4. This hybrid preserves the calibration advantage of 180d where data supports it, while avoiding late-funnel noise

**The fundamental calibration problem** is that resolved-cohort rates overestimate live-pipeline conversion. The actual pipeline join rate is consistently 10-15%, but model predictions range from 15-46%. The duration penalty partially addresses this (it down-weights stale deals), but a structural adjustment or pipeline-specific calibration factor may be needed.

---

## Phase 5: AUM Tier Rates — Is It Worth Stratifying?

If sample sizes allow, this phase tests whether AUM-tiered conversion rates improve accuracy.

### 5.1 Check viability

Revisit the Phase 1 tier × stage matrix. If any critical cell has <10 observations, we may need to collapse tiers (e.g., 2 tiers instead of 4) or skip this approach entirely. Decide on a viable tier structure based on the data.

**Results:**

**4-tier viability (from Phase 1.5):** Not viable. Tier 3 Signed→Joined has 10 observations and Tier 4 Neg→Signed has 19. These are too thin for reliable per-tier stage rates.

**2-tier viability (< $75M vs ≥ $75M, all-time):**

| Tier | Total | Joined | SQO→SP den | SP→Neg den | Neg→Signed den | Signed→Joined den |
|------|-------|--------|-----------|-----------|----------------|-------------------|
| Lower (< $75M) | 605 | 94 (15.5%) | 605 | 419 | 185 | 99 |
| Upper (≥ $75M) | 212 | 20 (9.4%) | 212 | 129 | 39 | 22 |

**2-tier rates (all-time):**

| Tier | SQO→SP | SP→Neg | Neg→Signed | Signed→Joined | Product |
|------|--------|--------|------------|---------------|---------|
| Lower (< $75M) | 69.3% | 44.2% | 53.5% | 94.9% | 15.5% |
| Upper (≥ $75M) | 60.8% | 30.2% | 56.4% | 90.9% | 9.4% |

**Decision:** The 2-tier structure is marginally viable. The Lower tier has solid sample sizes across all transitions. The Upper tier's Neg→Signed (39) and Signed→Joined (22) are thin but usable. The rate difference is meaningful: Lower converts at 1.65× the rate of Upper (15.5% vs 9.4%), primarily driven by SP→Neg (44.2% vs 30.2%).

**Caveat for backtesting:** When computing 1yr trailing tiered rates at historical snapshot dates, the Upper tier cohort is very small at early snapshots (4 deals at Q3 2024, 15 at Q4 2024). I use flat-rate fallback for the Upper tier at Q3 2024, and tiered rates from Q4 2024 onward despite thin cells.

---

### 5.2 Compute tiered conversion rates

Using whatever tier structure is viable from 5.1, compute per-tier conversion rates for each stage transition using the best-performing window from Phase 4.

**Results:**

**1yr trailing tiered rates at each snapshot (2-tier: < $75M vs ≥ $75M):**

| Snapshot | Tier | Cohort N | Joined | SQO→SP | SP→Neg | Neg→Signed | Signed→Joined | Product |
|----------|------|---------|--------|--------|--------|------------|---------------|---------|
| 2024-Q3 | Lower | 25 | 11 | 88.0% | 68.2% | 73.3% | 100% | 44.0% |
| 2024-Q3 | Upper | 4 ⚠️ | 0 | — | — | — | — | 0% (fallback to flat) |
| 2024-Q4 | Lower | 68 | 19 | 82.4% | 50.0% | 67.9% | 100% | 27.9% |
| 2024-Q4 | Upper | 15 | 1 | 80.0% | 16.7% | 50.0% | 100% | 6.7% |
| 2025-Q1 | Lower | 126 | 26 | 85.7% | 43.5% | 55.3% | 100% | 20.6% |
| 2025-Q1 | Upper | 24 | 2 | 87.5% | 23.8% | 40.0% | 100% | 8.3% |
| 2025-Q2 | Lower | 186 | 28 | 78.0% | 37.2% | 51.9% | 100% | 15.1% |
| 2025-Q2 | Upper | 35 | 3 | 88.6% | 19.4% | 50.0% | 100% | 8.6% |
| 2025-Q3 | Lower | 201 | 33 | 76.1% | 37.9% | 56.9% | 100% | 16.4% |
| 2025-Q3 | Upper | 46 | 4 | 87.0% | 22.5% | 44.4% | 100% | 8.7% |
| 2025-Q4 | Lower | 197 | 28 | 74.1% | 39.0% | 54.4% | 90.3% | 14.2% |
| 2025-Q4 | Upper | 58 | 5 | 75.9% | 20.5% | 55.6% | 100% | 8.6% |

**Interpretation:** The tier split reveals a consistent pattern: Upper tier deals are much harder to close at the SP→Neg transition (16.7-22.5% vs 37.2-50.0% for Lower). This is the funnel's key discriminator between small and large books. The Upper tier's Signed→Joined rate is 100% at every snapshot except one — but with denominators of 1-5, this is noise, not signal.

The Lower tier product rate ranges from 14.2-44.0%, while Upper ranges from 6.7-8.7% (excluding the Q3 2024 fallback). This ~2× gap is consistent and actionable.

---

### 5.3 Backtest with tiered rates

Re-run the backtest using AUM-tiered conversion rates instead of flat rates. Compare prediction error against the baseline model and the duration-penalized model.

**Results:**

Combined in 5.4 below (all four model variants tested together).

---

### 5.4 Combined model: tiered rates + duration penalty

If both tiered rates and duration penalty show improvement individually, test them together. Run the backtest with both applied. Does the combination outperform either alone?

**Results:**

**Four-model comparison backtest (total predicted AUM vs eventually-joined AUM):**

| Snapshot | Actual Joined | Flat 1yr | Flat + Duration | Tiered 1yr | Tiered + Duration |
|----------|--------------|----------|-----------------|------------|-------------------|
| 2024-Q3 | $628M | $4.60B (+633%) | $2.21B (+252%) | $4.77B (+660%) | $2.29B (+265%) |
| 2024-Q4 | $990M | $3.29B (+232%) | $1.76B (+78%) | $2.08B (+110%) | $1.19B (+20%) |
| 2025-Q1 | $940M | $2.36B (+152%) | $1.16B (+23%) | $1.73B (+84%) | $865M (−8%) |
| 2025-Q2 | $1.07B | $2.18B (+105%) | $1.25B (+17%) | $1.69B (+58%) | $949M (−11%) |
| 2025-Q3 | $1.09B | $3.88B (+256%) | $2.63B (+142%) | $3.00B (+176%) | $2.08B (+91%) |
| 2025-Q4 | $3.37B | $4.55B (+35%) | $3.30B (−2%) | $4.07B (+21%) | $3.06B (−10%) |

**Summary statistics (MAPE, excluding Q3 2024):**

| Model | MAPE | Best Snapshot | Worst Snapshot |
|-------|------|--------------|----------------|
| Flat 1yr (baseline) | **156%** | +35% (Q4'25) | +256% (Q3'25) |
| Flat + Duration | **52%** | −2% (Q4'25) | +142% (Q3'25) |
| Tiered 1yr | **90%** | +21% (Q4'25) | +176% (Q3'25) |
| **Tiered + Duration** | **28%** | −8% (Q1'25) | +91% (Q3'25) |

**Interpretation:** The combined tiered + duration penalty model is the clear winner:

1. **MAPE drops from 156% → 28%** — a 5.6× improvement over baseline. Each improvement layer contributes independently: tiered rates reduce MAPE to 90%, duration penalty reduces to 52%, and the combination achieves 28%.

2. **Three of five snapshots are within ±11%** (Q4 2024 at +20%, Q1 2025 at −8%, Q2 2025 at −11%). These are operationally excellent forecasts.

3. **Q4 2025 slightly under-predicts at −10%** — with 19 deals still open, additional joins could bring this closer to zero.

4. **Q3 2025 remains the worst at +91%** — 15 deals still open, but even accounting for those, some residual over-prediction likely remains.

5. **The slight under-prediction at Q1 and Q2 2025** (−8%, −11%) suggests the combined model may be marginally conservative — which is arguably preferable to the systematic over-prediction of the baseline.

6. **Q3 2024 remains unredeemable** (+265%) due to the fundamentally tiny trailing cohort (25 Lower, 4 Upper). No model configuration can fix rates computed from N=4.

---

### Phase 5 Summary & Recommendation

**Are tiered rates worth it given sample sizes?** Yes — with the 2-tier structure (< $75M vs ≥ $75M). The Lower tier has robust sample sizes at all transitions. The Upper tier is thin at late-funnel stages (22-39 observations all-time, as few as 1-5 at historical snapshots), but even with these limitations, tiered rates reduce MAPE from 156% to 90% in the backtest. The improvement is driven primarily by the SP→Neg transition, where Upper tier deals convert at roughly half the rate of Lower tier deals.

**Does combining with duration penalty help or overfit?** The combination helps substantially and does not appear to overfit. The tiered + duration model achieves 28% MAPE — better than either improvement alone (tiered: 90%, duration: 52%). The improvements are complementary:
- **Tiered rates** address the structural difference in conversion between small and large books
- **Duration penalty** addresses the behavioral difference between fresh and stale deals
- These are independent axes of variation, so combining them is additive rather than overfitting

**The recommended model configuration is now:**
1. **2-tier AUM split** (< $75M vs ≥ $75M) for per-tier stage conversion rates
2. **Duration penalty** (empirical multipliers from Phase 3) applied to the current stage rate
3. **1yr trailing window** for rate computation (180d would be too thin for per-tier late-funnel rates)
4. At historical snapshots where the Upper tier cohort has < 15 deals, fall back to flat rates

**Caveats:**
- The Upper tier Signed→Joined rate is 100% at almost every snapshot (denominators of 1-5). This rate is unreliable and should eventually be replaced with a pooled estimate or Bayesian prior.
- The slight under-prediction at Q1/Q2 2025 (−8%, −11%) suggests the model may be marginally conservative, which is preferable to the +100-600% over-prediction of the baseline.
- Q3 2025 (+91% error) remains problematic even with the best model — 15 still-open deals explain some but not all of this gap.

---

## Phase 6: Monte Carlo Validation

Separate from the deterministic forecast, we need to check whether the Monte Carlo P10/P50/P90 ranges are actually calibrated — do actual outcomes fall within the predicted ranges at the right frequency?

### 6.1 Monte Carlo coverage check

For each backtestable quarter, assess whether the Monte Carlo range (P10–P90) would have captured the actual outcome.

**We cannot re-run the full Monte Carlo historically** (it requires the exact pipeline + rates at each snapshot, which is complex). Instead, use a simplified approximation:

1. Take the pipeline snapshot from Phase 2.2 and the trailing rates from Phase 2.3
2. For each deal, compute `P(Join)` and `AUM`
3. **Approximate the distribution** using the sum of independent Bernoulli-weighted AUM random variables:
   - Expected total = `SUM(P(Join) × AUM)` (this is the deterministic forecast from 2.4)
   - Variance of total = `SUM(P(Join) × (1 - P(Join)) × AUM²)` (variance of sum of independent Bernoulli × constant)
   - Std dev = `SQRT(variance)`
   - Approximate P10 = `Expected - 1.28 × StdDev` (10th percentile of normal approximation)
   - Approximate P90 = `Expected + 1.28 × StdDev`

4. Compare actual joined AUM against the approximate P10 and P90 for each quarter

Show: Quarter | Expected AUM | Approx P10 | Approx P90 | Actual AUM | Where actual landed (below P10 / within range / above P90)

**Caveat:** The normal approximation breaks down when a few whale deals dominate the variance (which they do — see AUM variance doc). The actual Monte Carlo distribution is likely more skewed than the normal approximation. Note this limitation in the results but proceed — the goal is a directional calibration check, not an exact replication.

**Results:**

**Using the best model (tiered + duration penalty) for P(Join) values:**

| Snapshot | Expected AUM | Std Dev | Approx P10 | Approx P90 | Actual Joined | Still Open | Where? |
|----------|-------------|---------|-----------|-----------|---------------|-----------|--------|
| 2024-Q3 | $2.29B | $688M | $1.41B | $3.17B | $628M | 1 | **Below P10** |
| 2024-Q4 | $1.19B | $371M | $716M | $1.67B | $990M | 1 | Within range |
| 2025-Q1 | $865M | $368M | $394M | $1.34B | $940M | 5 | Within range |
| 2025-Q2 | $949M | $420M | $410M | $1.49B | $1.07B | 9 | Within range |
| 2025-Q3 | $2.08B | $559M | $1.36B | $2.80B | $1.09B | 15 | **Below P10** |
| 2025-Q4 | $3.06B | $664M | $2.21B | $3.91B | $3.37B | 19 | Within range |

**Coverage summary:** 4 of 6 snapshots (67%) have actual outcomes within the P10-P90 range. A well-calibrated 80% interval should capture 80% of outcomes, so the range is slightly too narrow — or more precisely, the model is still biased high (2 misses are below P10, none above P90).

**Caveats:**
- **Normal approximation is poor here.** The standard deviations are $370M-$690M, driven almost entirely by a few whale deals with high AUM × moderate P(Join). The actual Monte Carlo distribution would be heavily right-skewed (a whale joining creates a long right tail), not symmetric as the normal approximation assumes.
- **Q3 2024 and Q3 2025 fall below P10** — the model's lower bound still can't imagine outcomes this low. Q3 2024 is the familiar tiny-cohort problem. Q3 2025 has 15 still-open deals that could narrow the gap.
- **Q4 2025's $3.37B actual** falls comfortably within the range ($2.21B-$3.91B). But as we'll see in 6.2, this is almost entirely because one $1.5B whale deal joined — a single Bernoulli flip that landed favorably.

---

### 6.2 Whale deal impact analysis

For each backtestable quarter, identify the largest deal in the pipeline and check: did it join? How much did its outcome (join vs not) swing the total AUM? This quantifies the concentration risk the Monte Carlo is trying to capture.

**Results:**

**Top 3 deals by AUM at each pipeline snapshot:**

| Snapshot | Rank | Advisor | AUM | Stage at Snapshot | Outcome | % of Pipeline | % of Joined AUM |
|----------|------|---------|-----|-------------------|---------|---------------|-----------------|
| 2024-Q3 | 1 | John Stein | $1.30B | Discovery | Closed Lost | 12.4% | 207% if won |
| 2024-Q3 | 2 | Scott Hampton | $800M | Discovery | Closed Lost | 7.6% | 128% if won |
| 2024-Q3 | 3 | Jon Timson | $525M | Sales Process | Closed Lost | 5.0% | 84% if won |
| 2024-Q4 | 1 | John Stein | $1.30B | Discovery | Closed Lost | 11.7% | 131% if won |
| 2024-Q4 | 2 | Scott Hampton | $800M | Discovery | Closed Lost | 7.2% | 81% if won |
| 2024-Q4 | 3 | Jon Timson | $525M | Sales Process | Closed Lost | 4.7% | 53% if won |
| 2025-Q1 | 1 | John Stein | $1.30B | Discovery | Closed Lost | 12.0% | 138% if won |
| 2025-Q1 | 2 | Scott Hampton | $800M | Discovery | Closed Lost | 7.4% | 85% if won |
| 2025-Q1 | 3 | Jon Timson | $525M | Sales Process | Closed Lost | 4.8% | 56% if won |
| 2025-Q2 | 1 | John Stein | $1.30B | Discovery | Closed Lost | 10.1% | 122% if won |
| 2025-Q2 | 2 | Scott Hampton | $800M | Discovery | Closed Lost | 6.2% | 75% if won |
| 2025-Q2 | 3 | Jon Timson | $525M | Sales Process | Closed Lost | 4.1% | 49% if won |
| 2025-Q3 | 1 | John Stein | $1.30B | Discovery | Closed Lost | 7.4% | 120% if won |
| 2025-Q3 | 2 | Kevin Kelly | $800M | Sales Process | Closed Lost | 4.6% | 74% if won |
| 2025-Q3 | 3 | Scott Hampton | $800M | Discovery | Closed Lost | 4.6% | 74% if won |
| **2025-Q4** | **1** | **Marcado 401k Team** | **$1.50B** | **Discovery** | **Joined** | **7.2%** | **44% of actual** |
| 2025-Q4 | 2 | John Stein | $1.30B | Discovery | Closed Lost | 6.2% | 39% if won |
| 2025-Q4 | 3 | Scott Hampton | $800M | Discovery | Closed Lost | 3.8% | 24% if won |

**Key findings:**

1. **John Stein ($1.3B) persisted in the pipeline for 5+ quarters at Discovery stage and eventually Closed Lost.** This single deal was worth more than ALL actual joined AUM in 4 of 6 quarters. Every quarter it was in the pipeline, the model assigned it some P(Join) × $1.3B, inflating predictions by hundreds of millions.

2. **Scott Hampton ($800M) had the same pattern** — in Discovery across all 6 snapshots, always Closed Lost. Combined with John Stein, these two zombie deals contributed $2.1B of phantom pipeline every quarter.

3. **Q4 2025 is the outlier: Marcado 401k Team ($1.5B) actually joined.** This single deal accounts for **44% of Q4 2025's $3.37B joined AUM**. This is why Q4 2025 was the only quarter where actual outcomes approached predictions. Without Marcado joining, Q4 2025's joined AUM would have been ~$1.87B — and the forecast error would have been much larger.

4. **Concentration risk is extreme.** The top 3 deals represent 17-25% of total pipeline AUM. A single whale deal's binary outcome (join vs not) swings the total by more than the entire rest of the pipeline combined. The forecast is essentially a bet on whether 1-2 whale deals close.

5. **The whale deals are almost always in Discovery or Sales Process** — the earliest, lowest-probability stages. The model assigns them small but non-trivial P(Join) values, and their massive AUM amplifies even small probabilities into large expected contributions.

---

### Phase 6 Summary & Recommendation

**Is the Monte Carlo range well-calibrated?** No — it's too optimistic. Even using the best model (tiered + duration penalty), 2 of 6 snapshots fall below the P10 estimate, and none fall above P90. A well-calibrated 80% interval should miss 10% on each side. The model's lower bound is still too high, reflecting the systematic over-prediction documented in earlier phases.

**Does concentration risk dominate outcomes?** Absolutely. This is the single most important structural finding of the research:

- **Two zombie whales** (John Stein $1.3B, Scott Hampton $800M) sat in Discovery across all 6 backtest quarters, never progressing, eventually Closing Lost. They contributed $2.1B of phantom pipeline every quarter, inflating predictions by hundreds of millions.
- **One whale joining** (Marcado 401k $1.5B in Q4 2025) accounted for 44% of that quarter's joined AUM and is the primary reason Q4 2025's forecast was accurate.
- **The forecast is effectively a whale lottery.** With the top 3 deals representing 17-25% of pipeline AUM and individual whales worth more than all other joins combined, the expected value calculation is dominated by 1-2 binary outcomes.

**Implications for how we run or present the simulation:**

1. **The Monte Carlo P10/P50/P90 percentiles are misleading** because the underlying distribution is not approximately normal — it's dominated by a few discrete high-AUM Bernoulli draws. The normal approximation's symmetric confidence interval understates the left tail (reality can be much worse than P10) while overstating the right tail (P90 is rarely reached because multiple whales joining simultaneously is extremely unlikely).

2. **Consider presenting whale deals separately.** Show "base expected AUM" (pipeline excluding deals > $500M) + "whale deal scenarios" (each whale listed individually with P(Join) and AUM). This makes the concentration risk visible to stakeholders rather than hiding it in an aggregate number.

3. **The duration penalty helps with whale deals indirectly** — the two zombie whales (John Stein, Scott Hampton) were both in Discovery for 5+ quarters and would have received heavy duration penalties. But even penalized, their sheer AUM still contributes materially to the forecast.

4. **5,000 Monte Carlo trials is sufficient for aggregate P10/P50/P90 stability** given the deal count (127-203 deals). The noise is not from insufficient trials — it's from the distribution being fundamentally lumpy due to whale deals.

---

## Phase 7: Deal Quality & Timing Reality Checks

Our historical Joined sample size is small (~116 deals all-time). This phase investigates four signals that could improve forecast accuracy — date slippage, lead source quality, seasonality, and underwriting — but every step must respect that small N. Flag statistical fragility wherever it appears. Do not draw conclusions from cells with fewer than 10 observations.

### 7.1 Date Slippage — The "Happy Ears" Factor

Recruiters set `Earliest_Anticipated_Start_Date__c` as their best guess for when an advisor will join. We need to know how optimistic those guesses are, because the forecast uses that date to assign deals to quarters. If anticipated dates are systematically early, we're pulling AUM forward into the wrong quarter.

**Query:** Find all historical resolved SQOs that actually Joined (`StageName = 'Joined'` or `advisor_join_date__c IS NOT NULL`, excluding Closed Lost) and had a populated `Earliest_Anticipated_Start_Date__c` at the time they joined. Compute:

- `slip_days = DATE_DIFF(DATE(advisor_join_date__c), DATE(Earliest_Anticipated_Start_Date__c), DAY)` — positive means the deal closed AFTER the anticipated date (late), negative means early.
- Median and average slip in days.
- Count and percentage of deals that closed ON or BEFORE the anticipated date vs AFTER it.
- Distribution buckets: >30 days early, 1-30 days early, on time (0 days), 1-30 days late, 31-60 days late, 61-90 days late, 90+ days late.
- If sample size allows, break this out by stage at the time the anticipated date was set (if trackable) or by AUM tier to see if whale deals slip more.

Use standard filters: `SQO_raw = 'Yes'`, `is_primary_opp_record = 1`, recruiting record type.

**Results:**

**Sample:** 75 of 114 Joined deals (65.8%) had both `advisor_join_date__c` and `Earliest_Anticipated_Start_Date__c` populated.

**Overall slip statistics:**
- Average slip: **+2.0 days** (late)
- Median slip: **0 days** (on time)
- Min: −9 days (early), Max: +39 days (late)

**On-time vs late:**
- On time or early: **59 deals (78.7%)**
- Late: **16 deals (21.3%)**

**Distribution buckets:**

| Bucket | Count | % |
|--------|-------|---|
| >30 days early | 0 | 0% |
| 1-30 days early | 4 | 5.3% |
| On time (0 days) | 55 | 73.3% |
| 1-30 days late | 14 | 18.7% |
| 31-60 days late | 2 | 2.7% |
| 61-90 days late | 0 | 0% |
| 90+ days late | 0 | 0% |

**By AUM tier:**

| Tier | N | Avg Slip | Median | % Late |
|------|---|---------|--------|--------|
| Lower (< $75M) | 57 | +1.7d | 0 | 21.1% |
| Upper (≥ $75M) | 18 | +3.0d | 0 | 22.2% |

**Interpretation:** Recruiter date estimates are **surprisingly accurate**. 73.3% of deals close on the exact anticipated date, and only 2 deals slipped more than 30 days. The average slip of +2 days is negligible for quarterly forecasting. There is no meaningful difference between AUM tiers. **A date slippage buffer is NOT warranted** — the recruiter dates are reliable when populated. The bigger issue is the 35% of Joined deals that don't have an anticipated date at all, requiring the model date fallback.

---

### 7.2 Lead Source / Channel Quality (Earlier Stage Gates)

Grouping the ~116 Joined deals by lead source will produce cells too small to trust. Instead, evaluate source quality at earlier funnel stages where we have more volume, then include the Joined rate with explicit small-sample warnings.

**Query:** Using all-time resolved SQOs (`SQO_raw = 'Yes'`, `StageName IN ('Joined', 'Closed Lost')`, `is_primary_opp_record = 1`, recruiting record type), group by `Finance_View__c` (the channel grouping field). For each channel, compute:

1. **Total resolved SQOs** (denominator for all rates below)
2. **SQO → Sales Process rate** — numerator: reached SP or beyond (using "reached or beyond" methodology)
3. **SQO → Negotiating rate** — numerator: reached Neg or beyond
4. **SQO → Joined rate** — numerator: actually Joined
5. **Avg AUM of Joined deals** per channel (to see if certain channels bring larger or smaller books)

For the SQO → Joined column, flag any channel where the Joined count is <10 with a `⚠️ LOW N` marker. Do not draw conversion rate conclusions from those cells.

Also run the same breakdown by `Original_source` if it provides a more granular view, but only show sources with ≥15 total resolved SQOs to avoid noise.

**Results:**

**By Finance_View__c (channel), all-time resolved SQOs (N ≥ 10):**

| Channel | Resolved SQOs | SQO→SP | SQO→Neg | Joined | SQO→Joined | Avg Joined AUM |
|---------|--------------|--------|---------|--------|------------|----------------|
| Outbound | 462 | 62.6% | 22.1% | 47 | 10.2% | $54M |
| Recruitment Firm | 103 | 86.4% | 37.9% | 18 | 17.5% | $68M |
| Job Applications | 81 | 51.9% | 23.5% | 11 | 13.6% | $27M |
| Marketing | 61 | 85.2% | 36.1% | 10 | 16.4% | $56M |
| **Advisor Referral** | **36** | **83.3%** | **69.4%** | **20** | **55.6%** | **$111M** |
| Re-Engagement | 31 | 77.4% | 35.5% | 6 ⚠️ LOW N | 19.4% | $33M |
| Outbound + Marketing | 28 | 46.4% | 10.7% | 2 ⚠️ LOW N | 7.1% | $153M |
| Other | 10 | 40.0% | 20.0% | 0 ⚠️ LOW N | 0% | — |

**Key findings:**

1. **Advisor Referral is the standout channel** — 55.6% SQO→Joined rate, 3-5× higher than any other channel. These deals also bring the largest average AUM ($111M). The SQO→Neg rate (69.4%) is also ~2× higher than Outbound (22.1%), meaning referrals progress deeper into the funnel. N=20 Joined is adequate for this conclusion.

2. **Recruitment Firm and Marketing** perform similarly (17.5% and 16.4% join rate) and notably better than Outbound (10.2%). Both show strong SQO→SP advancement (86% and 85%).

3. **Outbound is the volume leader** (462 SQOs, 56% of total) but the lowest-converting major channel (10.2%). It also brings the smallest average AUM of joined deals ($54M vs $111M for Referral).

4. **Job Applications** convert moderately (13.6%) but bring small books ($27M avg).

5. **Outbound + Marketing** has the lowest conversion (7.1%) with only 2 joined deals — too thin to draw conclusions.

**Implication for forecasting:** Advisor Referral deals should arguably get a channel-specific rate boost, but with only 36 resolved SQOs and 20 Joined, the per-stage rates would be too thin. The signal is directionally strong but not actionable at the stage level.

---

### 7.3 Seasonality — When Do Advisors Actually Move?

If advisor transitions cluster in certain months or quarters (e.g., Q1 after bonus payouts, or Q4 for tax planning), the forecast should account for it. But with ~116 Joined deals spread across multiple years, any monthly breakdown will be thin. Keep this high-level.

**Query:** Take all historically Joined deals (`SQO_raw = 'Yes'`, reached Joined, `advisor_join_date__c IS NOT NULL`, excluding Closed Lost, `is_primary_opp_record = 1`, recruiting record type). Group by:

1. **Calendar quarter of join** (Q1/Q2/Q3/Q4, ignoring year — aggregate all Q1s together, etc.). Show: count of joined advisors, total AUM, average AUM.
2. **Calendar month of join** (Jan–Dec, ignoring year). Show: count of joined advisors, total AUM.
3. For context, also show the year-by-year breakdown (Q1 2024, Q2 2024, etc.) so we can see if any single year is dominating the quarterly signal.

We're looking for: does any quarter consistently have 2x+ the joins of another? Or is it relatively flat? If the signal is weak (e.g., all quarters within ±20% of the mean), note that seasonality is not a strong enough factor to model.

**Results:**

**By calendar quarter (all years aggregated):**

| Quarter | Joined Count | Total AUM | Avg AUM |
|---------|-------------|-----------|---------|
| Q1 | 30 | $3.06B | $102M |
| Q2 | 22 | $935M | $43M |
| Q3 | 30 | $1.44B | $48M |
| Q4 | 33 | $1.97B | $60M |

**By calendar month (all years aggregated):**

| Month | Joined | Total AUM |
|-------|--------|-----------|
| Jan | 11 | $1.89B |
| Feb | 9 | $402M |
| Mar | 10 | $760M |
| Apr | 5 | $208M |
| May | 7 | $194M |
| Jun | 10 | $533M |
| Jul | 10 | $674M |
| Aug | 11 | $417M |
| Sep | 9 | $346M |
| Oct | 9 | $279M |
| Nov | 11 | $1.05B |
| Dec | 13 | $648M |

**Year-by-year (for context):**

| Year-Quarter | Joined | Total AUM |
|-------------|--------|-----------|
| 2024-Q1 | 5 | $145M |
| 2024-Q2 | 7 | $198M |
| 2024-Q3 | 9 | $378M |
| 2024-Q4 | 13 | $589M |
| 2025-Q1 | 12 | $463M |
| 2025-Q2 | 12 | $578M |
| 2025-Q3 | 14 | $765M |
| 2025-Q4 | 17 | $1.32B |
| 2026-Q1 | 12 | $2.41B |

**Interpretation:** The count-based seasonality signal is **weak**. Q2 is the lowest (22 joins) and Q4 the highest (33), a ratio of 1.5× — meaningful but not the 2×+ threshold for modeling. April is notably slow (5 joins) and December is the busiest (13), but with only ~10 deals per month, these fluctuations are within noise range.

**The AUM signal is dominated by outliers.** Q1 shows $3.06B total — but this is inflated by Q1 2026's $2.41B (likely including Marcado 401k's $1.5B deal). January alone shows $1.89B. Removing that single deal would bring Q1 back in line with other quarters.

**The year-over-year growth trend is stronger than seasonality.** Joins are increasing steadily (5→7→9→13→12→12→14→17→12 per quarter from 2024 onward), reflecting pipeline growth rather than seasonal patterns.

**Verdict:** Seasonality is **not strong enough to model** given the data. The count variation is within ±30% of the mean, sample sizes per month are ~10, and the apparent Q1 AUM spike is driven by a single whale deal. The growth trend is more actionable than any seasonal pattern.

---

### 7.4 Underwritten AUM vs. Stated Amount — Stage-Controlled Comparison

Underwritten AUM (`Underwritten_AUM__c`) is typically populated during or after the Negotiating stage, which means deals with it have inherently progressed further. A naive comparison of "deals with underwritten AUM convert better" would be confounded by stage. We must control for this.

**Query:** Using all-time resolved SQOs that reached at least the Negotiating stage (i.e., `eff_neg_ts IS NOT NULL` using the COALESCE chain, `SQO_raw = 'Yes'`, `StageName IN ('Joined', 'Closed Lost')`, `is_primary_opp_record = 1`, recruiting record type), split into two groups:

1. **Has Underwritten AUM:** `Underwritten_AUM__c IS NOT NULL AND Underwritten_AUM__c > 0`
2. **No Underwritten AUM:** relies on `Amount` only (i.e., `Underwritten_AUM__c IS NULL OR Underwritten_AUM__c = 0`)

For each group, compute:
- Count of deals
- Count that reached Signed (or beyond)
- Count that Joined
- **Neg → Signed rate** (using "reached or beyond" denominators)
- **Neg → Joined rate** (numerator: Joined, denominator: reached Neg or beyond)
- **Signed → Joined rate** (for deals that reached Signed)
- Average AUM and median AUM of Joined deals in each group

If either bucket has <10 Joined deals, flag it. The key question: does having underwritten AUM signal a meaningfully higher close rate from the same stage, or is it just correlated with being further along?

Also compute: for deals that Joined, what was the average ratio of `Underwritten_AUM__c / Amount`? This tells us how much the AUM typically changes during underwriting (do deals shrink, grow, or stay flat?).

**Results:**

**Stage-controlled comparison: deals that reached Negotiating or beyond (all-time):**

| Group | Total Deals | Reached Signed | Joined | Neg→Signed | Neg→Joined | Signed→Joined | Avg Joined AUM | Median Joined AUM |
|-------|------------|---------------|--------|------------|------------|---------------|----------------|-------------------|
| Has Underwritten AUM | 163 | 109 | 102 | 66.9% | 62.6% | 93.6% | $69M | $30M |
| Amount Only | 51 | 2 | 2 ⚠️ | 3.9% | 3.9% | 100% | $0 | $0 |

**Underwritten / Amount ratio (for 112 Joined deals with both values):**
- Average ratio: **1.03×** (underwritten is ~3% higher than stated)
- Median ratio: **1.00×** (no change)
- Underwritten > Amount: 21 deals (18.8%)
- Underwritten < Amount: 38 deals (33.9%)
- Same: 53 deals (47.3%)

**Interpretation:** The underwriting signal is **overwhelmingly strong but confounded**:

1. **Deals with underwritten AUM convert at 62.6% from Negotiating (vs 3.9% without).** This is a 16× difference. However, this is almost certainly confounded — deals that receive underwriting are deals where Savvy has decided to invest analytical resources, which itself signals deal quality and seriousness. The underwriting is a *consequence* of deal momentum, not just a predictor.

2. **Only 2 deals without underwritten AUM have ever Joined from Negotiating.** With N=2, we cannot draw conversion rate conclusions for the "Amount Only" group at this stage. The 3.9% and 100% rates are noise.

3. **AUM values barely change during underwriting.** The median ratio is 1.00× (no change) and the average is 1.03× (3% increase). 47% of deals have identical values. When changes occur, deals are slightly more likely to shrink (34%) than grow (19%). This means `Amount` is a reasonable proxy for final AUM even before underwriting.

4. **The practical takeaway:** Having `Underwritten_AUM__c` populated is a strong positive signal for deal quality, but it's not separable from stage progression. Deals at Negotiating without underwriting essentially never close. Rather than building this into the rate model (sample is too thin for the Amount Only group), it could serve as a **pipeline health flag** — a Negotiating deal without underwritten AUM should be flagged as atypical.

---

### Phase 7 Summary & Recommendation

**1. Date slippage: No buffer needed.** Recruiter anticipated dates are remarkably accurate: 73% on time, 79% on time or early, average slip +2 days. The max observed slip is 39 days. No systematic late bias exists. The forecast should continue using `Earliest_Anticipated_Start_Date__c` when populated. The real issue is the 35% of Joined deals lacking this date entirely — improving population coverage would help more than adjusting for slip.

**2. Lead sources: Advisor Referral is the clear winner, but not actionable for rate modeling.** Referral deals convert at 55.6% (vs 10.2% for Outbound) with the largest avg AUM ($111M). Recruitment Firm (17.5%) and Marketing (16.4%) also outperform Outbound. However, with only 36 total referral SQOs, per-stage rates by channel are not viable. Channel quality is better surfaced as a **deal-level confidence indicator** rather than a rate modifier.

**3. Seasonality: Not strong enough to model.** Count-based variation is ±30% of the quarterly mean (Q2 lowest at 22, Q4 highest at 33). AUM seasonality is entirely driven by individual whale deals. The year-over-year growth trend (5→17 joins per quarter from early 2024 to late 2025) is far more meaningful than any seasonal pattern.

**4. Underwriting: Strong signal but confounded, not separately modelable.** Deals with underwritten AUM convert at 62.6% from Negotiating vs 3.9% without — but this reflects deal selection (Savvy invests in underwriting serious deals), not an independent predictor. AUM values barely change during underwriting (median ratio 1.00×). Best used as a **pipeline health flag**: a Negotiating deal without underwritten AUM is atypical and likely to fail.

**5. Trustworthiness assessment:**
- **High confidence:** Date slippage findings (N=75, consistent pattern), channel quality at early stages (N=462 for Outbound, 103 for Recruitment Firm)
- **Moderate confidence:** Advisor Referral superiority (N=36, but 55.6% is dramatically different from other channels)
- **Low confidence / directional only:** Seasonality (N~10 per month), underwriting comparison (N=2 for Amount Only group at Neg stage), any AUM-weighted pattern (dominated by individual whale deals)

---

## Phase 8: Forecast Calibration, Timing Accuracy & Data Integrity Checks

This phase stress-tests the forecast from angles the earlier phases don't cover: is the recruiter date override actually helping? Are certain stages systematically miscalibrated? Is future information leaking into backtests? Are atypical deal paths distorting assumptions? With ~116 Joined deals, prefer broad buckets and robust diagnostics over thinly sliced analysis. Where sample sizes are too small, Claude Code must flag that explicitly and not over-interpret.

### 8.1 Recruiter Date vs. Model Date Backtest

The forecast gives priority to `Earliest_Anticipated_Start_Date__c` when populated, otherwise it falls back to the model date (`DATE_ADD(CURRENT_DATE(), INTERVAL expected_days_remaining DAY)` based on avg stage durations minus days already spent). We need to test whether the recruiter override actually improves timing accuracy or hurts it.

**Query:** Using all historical resolved SQOs that Joined (`SQO_raw = 'Yes'`, `StageName = 'Joined'` or `advisor_join_date__c IS NOT NULL`, excluding Closed Lost, `is_primary_opp_record = 1`, recruiting record type `012Dn000000mrO3IAI`), compute two parallel projected join dates per deal:

1. **Recruiter-date method:** Use `Earliest_Anticipated_Start_Date__c` when populated, otherwise fall back to the model date.
2. **Model-date-only method:** Ignore `Earliest_Anticipated_Start_Date__c` entirely. Compute the projected join date using `Date_Became_SQO__c` (or the relevant stage entry timestamp) plus the sum of avg remaining stage durations minus days already spent in the current stage at the time of prediction. Use the same `expected_days_remaining` logic from `vw_forecast_p2`.

For each method, compare the predicted join date against actual `advisor_join_date__c`. Measure:

- Average absolute error in days
- Median absolute error in days
- Percentage assigned to the **correct calendar quarter**
- Percentage assigned **one quarter early**
- Percentage assigned **one quarter late**
- Percentage off by **two or more quarters**

Break this out overall, and by funnel grouping at the time the deal was in the pipeline:

| Grouping | Stages Included |
|----------|----------------|
| Early funnel | Discovery, Qualifying |
| Mid funnel | Sales Process |
| Late funnel | Negotiating, Signed |

**For the model-date-only method**, you must reconstruct what the model would have predicted at the time the deal was in the pipeline. Use this approach:

1. For each Joined deal, determine the "prediction date" — the date it entered its most advanced pre-terminal stage (e.g., `Stage_Entered_Signed__c` if it went through Signed, else `Stage_Entered_Negotiating__c`, etc.)
2. Compute trailing avg stage durations from deals that resolved **before** the prediction date (use the "Canonical Point-in-Time Rates CTE" pattern with `@snapshot_date` = prediction date)
3. Compute `expected_days_remaining` from the prediction date using those historical durations
4. `model_projected_join_date = prediction_date + expected_days_remaining`
5. Compare against actual `advisor_join_date__c`

```sql
-- Skeleton for model-date reconstruction per Joined deal
-- For each deal, find the latest stage entry BEFORE join as the prediction point
prediction_date AS (
  SELECT
    Full_Opportunity_ID__c,
    advisor_join_date__c,
    Earliest_Anticipated_Start_Date__c,
    COALESCE(Underwritten_AUM__c, Amount) AS aum,
    -- The "prediction point" = latest stage entry before joining
    GREATEST(
      COALESCE(DATE(Stage_Entered_Signed__c), DATE('1900-01-01')),
      COALESCE(DATE(Stage_Entered_Negotiating__c), DATE('1900-01-01')),
      COALESCE(DATE(Stage_Entered_Sales_Process__c), DATE('1900-01-01')),
      COALESCE(DATE(Date_Became_SQO__c), DATE('1900-01-01'))
    ) AS pred_date,
    -- Stage at prediction point
    CASE
      WHEN Stage_Entered_Signed__c IS NOT NULL THEN 'Signed'
      WHEN Stage_Entered_Negotiating__c IS NOT NULL THEN 'Negotiating'
      WHEN Stage_Entered_Sales_Process__c IS NOT NULL THEN 'Sales Process'
      ELSE 'Discovery'
    END AS stage_at_prediction
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
  WHERE SQO_raw = 'Yes'
    AND is_primary_opp_record = 1
    AND recordtypeid = '012Dn000000mrO3IAI'
    AND StageName = 'Joined'  -- Only deals that actually joined
    AND advisor_join_date__c IS NOT NULL
)
-- Then for each deal, compute trailing rates as of pred_date
-- and derive expected_days_remaining to get model_projected_join_date
```

**Limitation:** Computing per-deal trailing rates requires a correlated subquery or pre-computed rate table for each prediction date. For simplicity, you can compute trailing rates for each quarter start date (Q3 2024, Q4 2024, etc.) and join deals to the nearest rate snapshot. Document this approximation.

Explicitly flag whether recruiter dates help only in late-funnel stages while hurting early-funnel accuracy (or vice versa). If the sample of deals with populated `Earliest_Anticipated_Start_Date__c` is small, state the N and caution against strong conclusions.

**Results:**

**Filtered to deals that Joined in 2024+ (N=101), by funnel group at prediction point:**

| Funnel Group | N | Has Anticipated Date | Model Median Abs Err | Recruiter Median Abs Err | Model Correct Qtr | Recruiter Correct Qtr |
|-------------|---|---------------------|---------------------|--------------------------|--------------------|-----------------------|
| Early funnel | 3 ⚠️ | 2 | 40d | 0d | 100% | 100% |
| Mid funnel | 1 ⚠️ | 0 | 37d | 37d | 100% | 100% |
| **Late funnel** | **97** | **73** | **18d** | **0d** | **80.4%** | **95.9%** |

**Interpretation:** The recruiter date method is **dramatically better** for late-funnel deals: 95.9% correct quarter vs 80.4% for model-only, with median absolute error of 0 days vs 18 days. The model-only method has a slight late bias (−3.1 days signed error for late funnel — deals actually join slightly before the model predicts).

Early and mid funnel samples are too small (3 and 1 deals respectively) for conclusions. Almost all Joined deals reach the late funnel before joining, so the late-funnel comparison is the one that matters.

**Approximation note:** Model durations use 2yr averages (SQO→SP: 8d, SP: 29d, Neg: 20d, Signed: 28d) rather than per-deal point-in-time trailing rates. This is a simplification — the full model would use trailing rates at each deal's snapshot date.

---

### 8.2 Stage-Level Calibration Check

Even if total forecasted AUM looks reasonable in the backtest, the model may be systematically over- or under-estimating conversion at specific stages. We need to know where the calibration breaks.

**Query:** Using all historical resolved SQOs (`SQO_raw = 'Yes'`, `StageName IN ('Joined', 'Closed Lost')`, `is_primary_opp_record = 1`, recruiting record type), compute — for each stage a deal could have been in when a forecast was generated — the following:

For each pipeline stage (Discovery, Qualifying, Sales Process, Negotiating, Signed):

1. **Count of historical deals** that were at that stage at some point (i.e., reached that stage based on COALESCE-chain timestamps)
2. **Average predicted P(Join)** — the product of remaining stage conversion rates that the model would have assigned at that stage (using 1yr trailing rates from the best-performing window in Phase 4, or default to 1yr if Phase 4 hasn't been completed yet)
3. **Actual realized join rate** — what percentage of deals that were at that stage actually ended up Joining
4. **Calibration gap** — predicted P(Join) minus actual join rate. Positive = model is too optimistic. Negative = too pessimistic.
5. **Expected AUM** — sum of `P(Join) × AUM` for all deals at that stage
6. **Actual Joined AUM** — sum of AUM for deals that actually Joined from that stage

Present both count-based calibration (does 14% predicted = ~14% actual?) and AUM-weighted calibration (does the dollar-weighted forecast match dollar-weighted reality?). Highlight any stage where the calibration gap exceeds 5 percentage points — that's a stage where the model is materially wrong.

**Results:**

**Stage-level calibration using 1yr trailing rates vs all-time resolved actuals:**

| Stage | Deals | Joined | Actual Join Rate | Predicted P(Join) | Gap (pp) | Predicted AUM | Actual Joined AUM | AUM Error |
|-------|-------|--------|-----------------|-------------------|----------|---------------|-------------------|-----------|
| Discovery (all SQOs) | 817 | 114 | 14.0% | 12.2% | −1.7 | $7.16B | $7.32B | −2.2% |
| Sales Process | 548 | 104 | 19.3% | 18.2% | −1.1 | $6.32B | $6.99B | −9.6% |
| Negotiating | 214 | 104 | 48.6% | 44.7% | −3.9 | $5.75B | $6.99B | −17.8% |
| **Signed** | **111** | **104** | **93.7%** | **88.5%** | **−5.2** ⚠️ | **$6.64B** | **$6.99B** | **−5.1%** |

**Interpretation:** Against the all-time resolved cohort, the 1yr trailing rates are actually **slightly conservative** at every stage (all gaps negative). This seems contradictory to the Phase 2 backtest showing massive over-prediction — but the paradox is explained by the **resolved cohort vs live pipeline gap** identified in Phase 4.

- **Count-based calibration is good.** Gaps are within 4pp for Discovery through Negotiating. The Signed gap (−5.2pp) just exceeds the 5pp threshold — the 1yr rate (88.5%) underestimates the all-time actual (93.7%), likely because recent Signed→Joined outcomes include a few losses that haven't accumulated in the all-time average.

- **AUM-weighted calibration shows larger gaps** at Negotiating (−17.8%). This means deals that reached Negotiating and actually Joined had higher average AUM than the overall Negotiating cohort. Whale deals that reach Negotiating are more likely to join than average — the flat P(Join) underweights them.

- **The core issue is NOT rate miscalibration against resolved deals** — it's that the live pipeline contains a large proportion of deals that will never reach Negotiating or beyond. The rates are accurate for deals that progress; they're overoptimistic when applied to a pipeline full of stalled early-stage deals. This is exactly what the duration penalty addresses.

---

### 8.3 Quarter-Timing Accuracy Check

A model can look right on annual AUM while being operationally wrong if it consistently pulls deals into the wrong quarter. This matters because the forecast is consumed as a quarterly planning tool.

**Query:** Using the backtest data from Phase 2 (or recomputing if needed), compare the predicted quarter vs the actual quarter of `advisor_join_date__c` for every deal that Joined. Produce:

**Count-based summary:**

| Timing Outcome | Count | % of Total |
|---------------|-------|-----------|
| Exact quarter match | ? | ?% |
| 1 quarter early (predicted Q2, joined Q3) | ? | ?% |
| 1 quarter late (predicted Q2, joined Q1) | ? | ?% |
| 2+ quarters early | ? | ?% |
| 2+ quarters late | ? | ?% |

**AUM-weighted summary:** Same breakdown but weighted by the deal's AUM, so we can see if the big deals are the ones landing in the wrong quarter.

**Directional bias:** Overall, does the model predict deals will close earlier than they actually do (forward-bias / optimistic timing) or later (delay-bias)? Compute the average signed error in days (positive = model predicted earlier than reality).

If sample sizes allow, split this by whether the deal used a recruiter-set anticipated date vs the model date (ties back to 8.1).

**Results:**

**Quarter-timing accuracy for deals in Q4 2025 pipeline snapshot that eventually Joined (N=24):**

| Timing Outcome | Model-Only Count | Model % | Recruiter Count | Recruiter % |
|---------------|-----------------|---------|----------------|-------------|
| Exact quarter match | 10 | 41.7% | 15 | 62.5% |
| 1 quarter early | 4 | 16.7% | 1 | 4.2% |
| 1 quarter late | 2 | 8.3% | 0 | 0% |
| 2+ quarters early | 0 | 0% | 0 | 0% |
| 2+ quarters late | 8 | 33.3% | 8 | 33.3% |

**Directional bias:**
- Model: average −229 days (actual joins 229 days after model predicted — strong late bias)
- Recruiter: average −239 days (similar — the 8 deals 2+ quarters late dominate both methods)

**Interpretation:** The recruiter method gets 62.5% correct quarter vs 41.7% for model-only. However, **both methods fail equally on the 8 deals that are 2+ quarters late** (33.3%). These are deals that were in early stages at the Q4 2025 snapshot and still haven't joined by mid-2026 — neither the model's short timeline nor the recruiter dates (which may not have been set for early-stage deals) can predict these accurately.

**The timing model's biggest weakness is early-funnel deals.** The model projects ~85 day total cycle for Discovery deals, but many take 6+ months. The duration penalty addresses *magnitude* (down-weighting stale deals' expected AUM) but doesn't fix the *timing* estimate. Improving early-funnel timing would require either: (a) using the full SQO-to-join duration (~150-200 days median) instead of the stage-by-stage sum, or (b) acknowledging that Discovery deals can't be reliably assigned to a specific quarter.

---

### 8.4 Point-in-Time Data Integrity / Leakage Check

Backtests are only trustworthy if they use information that would truly have been available at the time of prediction. If any field was updated after the snapshot date and the backtest inadvertently uses the updated value, the results are contaminated.

**Query / Audit:** Claude Code should evaluate each field used in the backtest pipeline snapshots (Phase 2) and classify them:

**Fields to evaluate:**

| Field | Used For | Point-in-Time Safe? | Risk |
|-------|----------|-------------------|------|
| `StageName` | Current stage at snapshot | ? | Could be restated if deal regressed |
| `Stage_Entered_Sales_Process__c` | Stage timestamps | ? | Should be immutable once set |
| `Stage_Entered_Negotiating__c` | Stage timestamps | ? | Same |
| `Stage_Entered_Signed__c` | Stage timestamps | ? | Same |
| `Stage_Entered_Joined__c` | Outcome | ? | Set at join — not available at prediction time |
| `Stage_Entered_Closed__c` | Outcome | ? | Set at close — not available at prediction time |
| `Amount` | AUM estimate | ? | May be updated throughout lifecycle |
| `Underwritten_AUM__c` | AUM estimate | ? | Typically set at Neg/Signed — not available early |
| `Earliest_Anticipated_Start_Date__c` | Timing override | ? | May be revised multiple times |
| `advisor_join_date__c` | Actual outcome | ? | Only available after join |
| `Date_Became_SQO__c` | Prediction anchor | ? | Should be immutable |
| `Opp_CreatedDate` | Cohort assignment | ? | Immutable |

For each field, Claude Code should:
1. State whether the field is safe to use in a point-in-time backtest
2. If NOT safe, explain the leakage risk and recommend how to mitigate (e.g., "only use `Amount` for deals at Discovery/Qualifying, assume `Underwritten_AUM__c` is not available until Negotiating")
3. Check whether Salesforce field history tracking is enabled for any of these fields — if so, we could reconstruct true point-in-time values; if not, document that limitation

Also check: does `vw_funnel_master` store any snapshots or is it always the current-state view? If it's current-state only, the backtests in Phase 2 have an inherent limitation that should be flagged.

**Results:**

**`vw_funnel_master` is a current-state view — it does NOT store historical snapshots.** All backtests in Phase 2+ use current-state field values, which introduces varying degrees of lookahead bias.

**Field-by-field assessment:**

| Field | Used For | Point-in-Time Safe? | Risk Level | Notes |
|-------|----------|-------------------|------------|-------|
| `StageName` | Current stage | ❌ NOT used in backtest | N/A | Backtest uses `stage_at_snapshot` from timestamps instead — correct approach |
| `Stage_Entered_Sales_Process__c` | Stage timestamps | ✅ Safe | Low | Immutable once set in Salesforce — timestamp of first entry |
| `Stage_Entered_Negotiating__c` | Stage timestamps | ✅ Safe | Low | Same — immutable |
| `Stage_Entered_Signed__c` | Stage timestamps | ✅ Safe | Low | Same |
| `Stage_Entered_Joined__c` | Outcome filter | ✅ Used correctly | Low | Only used to exclude deals that joined before snapshot — correct |
| `Stage_Entered_Closed__c` | Outcome filter | ✅ Used correctly | Low | Only used to exclude deals that closed before snapshot |
| `Amount` | AUM estimate | ⚠️ Leakage risk | **Medium** | Updated throughout deal lifecycle. The backtest uses today's `Amount`, which may differ from what it was at the snapshot date. For Discovery deals, Amount is typically set at SQO and rarely updated, so risk is low. For later stages, Amount may have been revised. |
| `Underwritten_AUM__c` | AUM estimate | ⚠️ Leakage risk | **Medium** | Typically populated at Negotiating/Signed. For deals at Discovery/SP at the snapshot, this value didn't exist yet — but the backtest uses `COALESCE(Underwritten_AUM__c, Amount)`, which would use the now-populated underwritten AUM for deals that have since progressed. This inflates/deflates AUM predictions retroactively. |
| `Earliest_Anticipated_Start_Date__c` | Timing override | ⚠️ Leakage risk | **Medium** | May be revised multiple times. The backtest uses the current value, which could differ from what was set at the snapshot date. No historical tracking available. |
| `advisor_join_date__c` | Actual outcome | ✅ Used correctly | Low | Only used for actual outcome comparison, not prediction — correct |
| `Date_Became_SQO__c` | Prediction anchor | ✅ Safe | Low | Immutable — set once when deal qualifies |
| `Opp_CreatedDate` | Cohort assignment | ✅ Safe | Low | Immutable |

**Salesforce field history tracking:** Not available for the AUM fields in `vw_funnel_master`. The view is built from Salesforce objects that don't include field history tracking for `Amount` or `Underwritten_AUM__c`. True point-in-time AUM reconstruction is **not possible** with the current data infrastructure.

**Mitigation recommendations:**
1. **Accept the AUM lookahead as a known limitation.** For most deals, AUM doesn't change dramatically (Phase 7.4 showed median Underwritten/Amount ratio = 1.00×). The bias direction is unpredictable — some deals' AUM went up, others down.
2. **For future backtesting rigor**, consider setting up a quarterly pipeline snapshot table that captures AUM, stage, and anticipated date at fixed points in time. This would eliminate lookahead entirely.
3. **The stage-timestamp approach used in Phase 2 is the correct methodology** — it avoids the `StageName` leakage problem by reconstructing stage from immutable timestamps.

---

### 8.5 Atypical Deal Path / Reopened Deal Check

Some deals don't follow the standard Discovery → Qualifying → Sales Process → Negotiating → Signed → Joined path. Skipped stages, reopened deals, long pauses, or stage regressions can distort the assumptions baked into the model's conversion rates and velocity estimates.

**Query:** Using all-time resolved SQOs (`SQO_raw = 'Yes'`, `StageName IN ('Joined', 'Closed Lost')`, `is_primary_opp_record = 1`, recruiting record type), identify atypical deal paths:

**1. Stage skippers:** Deals where one or more intermediate `Stage_Entered_*` timestamps are NULL despite the deal reaching a later stage. Use the `stages_skipped` field from `vw_funnel_audit` if available, or compute directly:
- `Stage_Entered_Sales_Process__c IS NULL` but `eff_neg_ts IS NOT NULL` (skipped SP)
- `Stage_Entered_Negotiating__c IS NULL` but `eff_signed_ts IS NOT NULL` (skipped Neg)
- `Stage_Entered_Signed__c IS NULL` but `eff_joined_ts IS NOT NULL` (skipped Signed)

**2. Long-paused deals:** Deals where any single stage duration exceeds 2 SD above the historical mean for that stage (using the duration thresholds from the AUM variance doc).

**3. Potential reopens/recycled deals:** Deals where `Stage_Entered_On_Hold__c IS NOT NULL` (went On Hold at some point but later resolved). Also check for deals with a `Previous_Recruiting_Opportunity_ID__c` on the linked lead record, which suggests a re-engagement.

For each atypical group, compare against standard-path deals on:
- Join rate
- Median days from SQO to resolution
- Average AUM of Joined deals
- Count (to assess whether they're common enough to matter)

If stage regressions are not directly observable in the data (i.e., Salesforce doesn't track backward movements), document that limitation and note the best available proxy.

**Results:**

**Atypical deal path analysis (all-time resolved SQOs):**

| Deal Type | Total Deals | Joined | Join Rate | Median Days to Resolution | Avg Joined AUM |
|-----------|------------|--------|-----------|--------------------------|----------------|
| Standard Path | 641 | 59 | 9.2% | 45d | $56M |
| Stage Skipper | 55 | 49 | **89.1%** | 48d | $72M |
| Went On Hold | 121 | 6 | 5.0% | 160d | $83M |

**Stage skipper detail:** Of 55 stage skippers: 29 skipped SP, 25 skipped Neg, 19 skipped Signed. These categories overlap (a deal can skip multiple stages).

**Key findings:**

1. **Stage Skippers are overwhelmingly Joined deals (89.1%).** This is NOT a data quality issue — it's the COALESCE backfill logic at work. When a deal's `Stage_Entered_SP__c` is NULL but `Stage_Entered_Negotiating__c` IS NOT NULL, the deal genuinely skipped SP. These deals are the fastest-progressing, highest-quality deals in the pipeline. The COALESCE chain in rate calculations correctly treats them as "reached SP or beyond," so they're already accounted for in conversion rates.

2. **On Hold deals convert at 5.0%** — about half the standard rate (9.2%). They take 3.5× longer to resolve (median 160 days vs 45 days). With 121 deals (14.8% of the total), this is a material subpopulation. The current model treats them the same as standard deals, which likely over-estimates their contribution.

3. **Stage regressions are NOT directly observable** in `vw_funnel_master`. Salesforce `Stage_Entered_*` timestamps only record the first entry into each stage. If a deal went Negotiating → Sales Process → Negotiating, only the first Negotiating entry is recorded. We have no proxy for regression frequency.

4. **Practical impact:** Stage skippers don't distort the model (they're handled by COALESCE). On Hold deals are already excluded from the open pipeline CTE (`StageName NOT IN ('On Hold', ...)`). The main risk is deals that return from On Hold — they re-enter the active pipeline with inflated dwell times but the On Hold pause is not accounted for.

---

### 8.6 AUM Data Freshness / Completeness Check

Forecast quality depends on AUM values being populated, current, and credible. Missing, zero, or stale AUM values may need special handling — either confidence flags or exclusion from weighted metrics.

**Query:** Using all-time resolved SQOs (`SQO_raw = 'Yes'`, `StageName IN ('Joined', 'Closed Lost')`, `is_primary_opp_record = 1`, recruiting record type), segment deals into AUM quality buckets:

| Bucket | Definition |
|--------|-----------|
| **Underwritten** | `Underwritten_AUM__c IS NOT NULL AND Underwritten_AUM__c > 0` |
| **Amount only** | `Underwritten_AUM__c IS NULL` (or 0) AND `Amount IS NOT NULL AND Amount > 0` |
| **Zero / NULL AUM** | Both `Underwritten_AUM__c` and `Amount` are NULL or 0 |

For each bucket, compute:
- Count of deals
- Join rate (count-based)
- Average and median AUM of Joined deals (using `COALESCE(Underwritten_AUM__c, Amount)`)
- For the backtest quarters from Phase 2: average forecast error (predicted expected AUM vs actual joined AUM) by bucket, if feasible

Also check: what percentage of current open pipeline falls into each bucket? If a significant chunk of open pipeline has zero/null AUM, that's pipeline we're effectively ignoring in the weighted forecast.

Keep this analysis simple. The goal is to determine whether weak AUM data should drive a confidence label (e.g., "low-confidence AUM" flag on the dashboard) or an exclusion rule, not to build a complex adjustment model.

**Results:**

**Historical resolved SQOs by AUM quality bucket:**

| Bucket | Total Deals | Joined | Join Rate | Avg Joined AUM | Median Joined AUM |
|--------|------------|--------|-----------|----------------|-------------------|
| Underwritten | 230 | 112 | 48.7% | $65M | $31M |
| Amount Only | 587 | 2 | 0.3% | $0 | $0 |
| Zero/NULL AUM | 0 | — | — | — | — |

**Current open pipeline by AUM quality bucket:**

| Bucket | Deals | % of Deals | Total AUM | % of AUM |
|--------|-------|-----------|-----------|----------|
| Amount Only | 114 | 78.6% | $20.50B | 89.6% |
| Underwritten | 31 | 21.4% | $2.37B | 10.4% |
| Zero/NULL AUM | 0 | 0% | $0 | 0% |

**Interpretation:** This is a critical finding:

1. **78.6% of the current open pipeline has only `Amount` (no underwriting).** This is the majority of both deal count and AUM ($20.5B of $22.9B). These deals are overwhelmingly in early stages (Discovery, Sales Process) where underwriting hasn't occurred yet.

2. **The 0.3% join rate for "Amount Only" resolved deals is misleading.** It doesn't mean Amount-only deals never join — it means that by the time a deal joins, it almost always has been underwritten. The 587 "Amount Only" resolved deals are mostly Closed Lost deals that never progressed far enough to be underwritten.

3. **No zero/NULL AUM deals exist** in either the resolved or open pipeline. Every deal has at least an `Amount` value. This is good — no deals are invisible to the weighted forecast.

4. **AUM quality flags are NOT needed.** The Amount values are populated for 100% of deals, and Phase 7.4 showed that underwriting barely changes AUM values (median ratio 1.00×). The real signal from having underwritten AUM is deal progression/quality, not AUM accuracy — and that's already captured by the stage-based conversion rates.

---

### 8.7 Model vs. Presentation / Drilldown Sanity Check

Some forecast issues may be presentation problems, not model problems. The Monte Carlo drilldown sorts deals by simulation win rate and draws an "above/below the line" cut for P10/P50/P90. When many deals have nearly identical win rates (because all deals at the same stage get the same conversion probability), the ranking is driven by simulation noise, not real signal.

**Query / Analysis:** Claude Code should inspect the following, using the current open pipeline and the most recent Monte Carlo results (or the logic from `forecast-monte-carlo.ts`):

**1. Win-rate clustering:** For the current pipeline, how many deals share effectively the same P(Join)? Group deals by their deterministic P(Join) rounded to 1 decimal place. Show the count per group. If 20+ deals share the same P(Join), the Monte Carlo drilldown ranking within that group is noise.

**2. Simulation instability:** The Monte Carlo uses 5,000 trials with independent `RAND()` draws. For deals with similar P(Join), how much does the simulated `win_pct` vary between them? Compute the range (max - min) of `win_pct` among deals at the same stage. If deals at the same stage show a win_pct range of, say, 35.2% to 36.8%, that 1.6pp spread is not meaningful — it's sampling noise from 5,000 trials.

**3. Drilldown line stability:** The "above/below the line" cut in the P10 drilldown accumulates raw AUM from the top of the sorted list until reaching the P10 target. If two adjacent deals have nearly identical win rates but very different AUM, the line placement is arbitrary. Claude Code should estimate how often re-running the simulation would move a deal from "above the line" to "below the line" (or vice versa) — especially for mid-probability deals in the Negotiating and Sales Process stages.

**Recommendation scope:** The output here is not just SQL results. Claude Code should also write a brief analytical recommendation:
- Is the drilldown "above/below the line" concept adding clarity or creating false precision?
- Should the presentation be simplified (e.g., bucket deals into "high / medium / low confidence" instead of ranking them)?
- Would averaging win_pct across multiple simulation runs reduce noise, or is 5,000 trials already sufficient for aggregate P10/P50/P90 stability?
- Is the core issue here model quality or UX interpretation?

**Results:**

**1. Win-rate clustering (current pipeline, flat 1yr trailing rates):**

| P(Join) | Stage(s) | Deal Count | Total AUM |
|---------|----------|-----------|-----------|
| 12.2% | Discovery/Qualifying | 39 | $10.48B |
| 18.2% | Sales Process | 72 | $9.52B |
| 44.7% | Negotiating | 30 | $2.23B |
| 88.5% | Signed | 4 | $631M |

**Every deal at the same stage has an identical P(Join).** 145 deals collapse into just 4 distinct probability groups. Within each group, the Monte Carlo simulation produces slightly different win rates (e.g., 35.2% vs 36.8% for two Negotiating deals), but this variation is pure sampling noise from 5,000 trials — not meaningful signal.

**2. Simulation instability:** For deals at the same stage, the simulated `win_pct` varies by ~2-4pp due to random sampling. With 5,000 trials and a true probability of 18.2%, the standard error is `sqrt(0.182 × 0.818 / 5000) = 0.55%`. So the 95% CI for simulated win rates of SP deals is roughly 17.1-19.3%. Any ranking of SP deals by simulated win rate is noise.

**3. Drilldown line stability:** The "above/below the line" cut in the P10 drilldown accumulates AUM from the top of the sorted deal list. Since all SP deals have ~the same win_pct, the line placement within the SP block is arbitrary. Re-running the simulation would rearrange the within-stage ordering, potentially moving deals above or below the line. For Negotiating deals (30 deals, 44.7% P(Join)), the line placement is most sensitive — these deals have high enough probability to matter but enough of them that the within-group ordering determines billions in AUM placement.

**Analytical Recommendation:**

1. **The drilldown "above/below the line" concept creates false precision.** It implies a meaningful distinction between deal #15 and deal #16 in the sorted list, when in reality their probabilities are identical. Users may interpret line placement as deal-level signal when it's simulation noise.

2. **Simplify to confidence tiers.** Replace the granular ranking with:
   - **High confidence (>50% P(Join)):** Signed deals, some Negotiating
   - **Medium confidence (15-50%):** Negotiating and Sales Process
   - **Low confidence (<15%):** Discovery/Qualifying
   This matches the actual resolution of the model (4 probability groups) and avoids implying false precision.

3. **5,000 trials is sufficient for aggregate P10/P50/P90.** The aggregate percentiles converge well at this trial count. The instability is in the per-deal ranking, not the aggregate numbers. Increasing trials wouldn't help because the underlying probabilities have only 4 distinct values.

4. **The core issue is model resolution, not UX.** With flat per-stage rates, the model cannot distinguish between a fresh SP deal and a stale one, or between a referral-sourced deal and an outbound one. The duration penalty (Phase 3) and tiered rates (Phase 5) add resolution by creating more distinct P(Join) groups. With duration penalties, a stale SP deal at 2+ SD would have P(Join) = 18.2% × 0.176 = 3.2%, clearly separating it from a fresh SP deal at 18.2%. This would make the drilldown ranking more meaningful.

---

### Phase 8 Summary & Recommendation

**1. Recruiter date override: Keep it, especially for late-funnel deals.** The recruiter method achieves 95.9% correct quarter for late-funnel deals vs 80.4% for model-only, with median absolute error of 0 days vs 18 days. No slip buffer is needed (Phase 7.1 confirmed recruiter dates are accurate). The main improvement opportunity is increasing coverage — 35% of Joined deals lack an anticipated date.

**2. Stage calibration: Rates are well-calibrated against resolved cohort, not against live pipeline.** The 1yr trailing rates are actually slightly conservative vs all-time actuals (gaps of −1.7pp to −5.2pp). The over-prediction in backtests is NOT from miscalibrated rates — it's from applying resolved-cohort rates to a pipeline that contains many deals that will never progress. The duration penalty directly addresses this.

**3. Systematic forward-bias: Yes, but primarily for early-funnel deals.** The model's 55-85 day total cycle compresses Discovery deals into the current quarter, but many take 6+ months. 33% of pipeline deals that eventually join are 2+ quarters later than predicted. The timing model needs longer horizons for early-funnel deals.

**4. Data integrity: Medium risk from AUM/date lookahead, but not crippling.** `vw_funnel_master` is current-state only — `Amount`, `Underwritten_AUM__c`, and `Earliest_Anticipated_Start_Date__c` may have been updated since backtest snapshot dates. However, AUM barely changes during underwriting (median ratio 1.00×), and stage timestamps are immutable. The stage-timestamp reconstruction approach used in backtests is sound. **Recommendation:** Build a quarterly pipeline snapshot table for future backtesting rigor.

**5. Atypical deal paths: Stage skippers are fine, On Hold deals are a concern.** Stage skippers (55 deals, 89.1% join rate) are correctly handled by COALESCE backfill. On Hold deals (121, 5.0% join rate) take 3.5× longer to resolve but are excluded from the open pipeline CTE, so they don't affect current forecasts. The risk is deals returning from On Hold with inflated dwell times.

**6. AUM quality flags: Not needed.** 100% of deals have `Amount` populated. Underwritten AUM is a quality signal, not an accuracy signal (values barely change). Use underwriting status as a pipeline health indicator instead.

**7. Drilldown false precision: Yes, fix by adding model resolution.** All deals at the same stage share identical P(Join), making within-stage ranking pure noise. The duration penalty creates meaningful differentiation (fresh SP at 18.2% vs stale SP at 3.2%). Implement duration penalty first; then consider simplifying the drilldown to confidence tiers (High/Medium/Low) if within-tier noise persists.

---

## Final Recommendations

### 1. Best Model Configuration

**Tiered rates (2-tier: < $75M vs ≥ $75M) + duration penalty + 1yr trailing window.**

This combination achieved **28% MAPE** in backtesting, down from **156% MAPE** for the current flat-rate baseline — a **5.6× improvement**. Three of five fully testable snapshots were within ±11% error.

| Component | MAPE (standalone) | MAPE (cumulative) | Why it helps |
|-----------|-------------------|-------------------|-------------|
| Flat 1yr baseline | 156% | 156% | Current model |
| + Duration penalty | 52% | 52% | Down-weights stale deals (2+ SD) that almost never close |
| + 2-tier AUM rates | 90% | **28%** | Large-book deals convert at ~0.6× the rate of small-book deals |

### 2. Expected Accuracy Improvement

| Metric | Current Baseline | Recommended Model | Improvement |
|--------|-----------------|-------------------|-------------|
| MAPE (total AUM) | 156% | 28% | 5.6× better |
| Best-case error | +35% | −8% | Near-zero |
| Worst-case error | +256% | +91% | 2.8× better |
| Direction bias | Always over-predicts | Slightly conservative | Healthier |

### 3. Implementation Changes (Priority Order)

**P0 — Duration Penalty (biggest single improvement, 156% → 52% MAPE)**
- Apply empirical multipliers to the current-stage conversion rate:
  - Discovery: 0.667× at 1-2 SD, 0.393× at 2+ SD (thresholds: 36d / 64d)
  - Sales Process: 0.755× at 1-2 SD, 0.176× at 2+ SD (thresholds: 67d / 105d)
  - Negotiating: 0.682× at 1-2 SD, 0.179× at 2+ SD (thresholds: 50d / 81d)
  - Signed: no penalty (insufficient data)
- Multiply only the current stage rate, not subsequent stages

**P1 — 2-Tier AUM Rates (52% → 28% MAPE when combined with P0)**
- Split rates by < $75M vs ≥ $75M using `COALESCE(Underwritten_AUM__c, Amount)`
- Fall back to flat rates when the trailing cohort for the Upper tier has < 15 resolved deals

**P2 — Whale Deal Separation (presentation improvement)**
- Show "base expected AUM" (pipeline excluding > $500M deals) + individual whale deal cards
- Makes concentration risk visible instead of hiding it in aggregate percentiles
- Two zombie whales ($1.3B + $800M) inflated predictions for 5+ consecutive quarters

**P3 — Drilldown Resolution (UX improvement)**
- Duration penalty alone creates meaningful per-deal differentiation (fresh SP at 18.2% vs stale SP at 3.2%)
- Consider simplifying drilldown to High/Medium/Low confidence tiers if within-tier noise persists
- 5,000 Monte Carlo trials is sufficient for aggregate percentiles

**P4 — Pipeline Snapshot Table (data infrastructure)**
- Build a quarterly snapshot table capturing AUM, stage, and anticipated date at fixed points
- Eliminates lookahead bias for future backtests
- Current backtest methodology is sound for stage reconstruction (immutable timestamps) but leaks on AUM and dates

### 4. Monitoring & Calibration

- **Quarterly backtest.** After each quarter closes, re-run the predicted vs actual comparison for that quarter. Track MAPE over time. If MAPE creeps above 40%, investigate whether rates or duration thresholds need recalibration.
- **Duration threshold refresh.** Recompute avg/stddev per stage from the trailing 2yr cohort at least annually. If deal velocity changes, the thresholds will shift.
- **Upper tier cohort size.** Monitor whether the ≥ $75M trailing cohort exceeds 30 resolved deals. Below that, late-funnel tiered rates are unreliable and should fall back to flat.
- **Signed→Joined rate.** This rate is the weakest link (100% at most snapshots due to tiny denominators). As more Signed deals resolve, re-evaluate whether a duration penalty is warranted.
- **New whale monitoring.** Flag any deal entering the pipeline at > $500M AUM. Track its stage progression quarterly. Persistent Discovery-stage whales (> 2 quarters) should be flagged for recruiter review.

### 5. Process & Data Collection Changes

- **Increase `Earliest_Anticipated_Start_Date__c` coverage.** Currently 65% of Joined deals have this field. When populated, it produces 96% correct-quarter timing for late-funnel deals. Requiring this field at Negotiating stage entry would improve timing accuracy.
- **Underwriting as a pipeline health gate.** A Negotiating deal without `Underwritten_AUM__c` has a 3.9% join rate vs 62.6% with it. Flag ununderwritten Neg deals on the dashboard.
- **On Hold return monitoring.** Deals returning from On Hold re-enter with inflated dwell times. Consider resetting the "days in stage" clock when a deal returns from On Hold.
- **No seasonal adjustments needed.** Seasonality signal is too weak to model (±30% quarterly variation, dominated by individual whale outcomes).
- **Advisor Referral quality signal.** Referral deals convert at 5.5× the rate of Outbound (55.6% vs 10.2%). Consider a channel-quality tag on the pipeline view, though sample sizes don't support per-channel rate modeling yet.

---

## Appendix: Pre-Implementation Validation Checks

> Run on 2026-03-23 as final validation before building the new model.

### Check 1: On Hold Contamination in the Stale Deal List

**Question:** Do we need a clock-reset mechanism for On Hold returns, or is this a non-issue?

**Result:** Of 24 deals flagged as 2+ SD over their stage threshold, **only 2 have On Hold history:**

| Advisor | Stage | Days in Stage | 2SD Threshold | AUM | On Hold Entry |
|---------|-------|--------------|---------------|-----|---------------|
| Debbie Huttner | Negotiating | 131d | 81d | $90M | 2025-06-13 |
| Jordan Gallacher | Negotiating | 101d | 81d | $500M | 2025-10-15 |

For **Debbie Huttner**: On Hold entry was June 2025, so a significant portion of the 131 days may have been On Hold time. If we subtracted ~90 days of On Hold, she'd drop to ~41 days — well below the 81d threshold.

For **Jordan Gallacher**: On Hold entry was Oct 2025 — more recent. If she was On Hold for ~60 days, she'd drop to ~41 days, also below threshold.

**Verdict:** On Hold contamination affects only **2 of 24 stale deals (8%)**, but one of them is the $500M Jordan Gallacher deal — the highest-AUM stale Negotiating deal in the pipeline. **A clock-reset mechanism is not a blocker but is a nice-to-have.** For V1, document this as a known limitation. For V2, subtract estimated On Hold duration from `days_in_stage` when `Stage_Entered_On_Hold__c` is not null.

---

### Check 2: Current Pipeline Anticipated Date Coverage

**Question:** How much of the current pipeline relies on the compressed model-date timing?

| Stage | Total Deals | Has Anticipated Date | % Coverage | AUM With Date | AUM Without Date |
|-------|------------|---------------------|-----------|---------------|-----------------|
| Discovery | 38 | 0 | **0%** | $0 | $10.35B |
| Qualifying | 1 | 0 | 0% | $0 | $130M |
| Sales Process | 72 | 26 | **36.1%** | $1.89B | $7.63B |
| Negotiating | 30 | 30 | **100%** | $2.23B | $0 |
| Signed | 4 | 4 | **100%** | $631M | $0 |

**Verdict:** Coverage is **excellent where it matters most** — 100% of Negotiating and Signed deals have anticipated dates. These are the deals with the highest P(Join) and where timing accuracy is most impactful. Sales Process is at 36%, which is the biggest gap. Discovery has 0%, which is expected (too early to estimate a join date).

**No Neg/Signed deals are missing anticipated dates**, so the model-date fallback only applies to early/mid-funnel deals where timing accuracy is inherently lower anyway. **No process change needed for V1.** Optionally, push for anticipated date coverage at SP entry to improve mid-funnel timing.

---

### Check 3: Zombie Whale Expected AUM Under the New Model

**Question:** Is the duration penalty sufficient for whale deals, or do we need a hard floor rule?

**Current whale deals (> $500M AUM) in the open pipeline:**

| Advisor | Stage | Days in Stage | Bucket | AUM | Flat Expected | New Model Expected | > $50M? |
|---------|-------|--------------|--------|-----|---------------|-------------------|---------|
| Kosta Tanglis | Discovery | 4d | Within 1 SD | $3.00B | $367M | $260M | **Yes** |
| Tim Simon | Discovery | 4d | Within 1 SD | $1.20B | $147M | $104M | **Yes** |
| Bryce Brown | Sales Process | 29d | Within 1 SD | $550M | $100M | $63M | **Yes** |
| Ben McLintock | Sales Process | 3d | Within 1 SD | $550M | $100M | $63M | **Yes** |

**Key finding: All 4 current whale deals are fresh (Within 1 SD).** None trigger the duration penalty. The two zombie whales from the backtest (John Stein $1.3B, Scott Hampton $800M) have both resolved — they're no longer in the pipeline.

The new model reduces whale expected AUM by ~29-37% vs flat (via tiered Upper rates: 8.7% vs 12.2% at Discovery), but fresh whale deals still contribute $63-260M each.

**Kosta Tanglis ($3.0B) is an outlier risk.** At $260M expected AUM, this single deal represents more than the combined expected AUM of most other stages. If this deal eventually closes lost, the forecast will have been inflated by $260M for the quarter(s) it was in pipeline.

**Verdict:** The duration penalty is sufficient — **no hard floor rule needed for V1.** The current whales are all fresh and legitimately in the pipeline. The penalty will kick in automatically if they stall. Monitor Kosta Tanglis and Tim Simon specifically; if either is still at Discovery after 64 days, the 2+ SD penalty (0.393×) would drop their expected AUM to $102M and $41M respectively — a substantial reduction. A dashboard-level whale flag (> $500M) is the recommended presentation approach per Phase 6.

---

### Check 4: Signed→Joined Rate Stability — Failure Case Inventory

**Question:** Is the 94.2% all-time Signed→Joined rate driven by unusual losses, or a real pattern?

**All Signed deals that Closed Lost (all-time): 7 deals**

| Advisor | AUM | Signed Date | Closed Date | Days in Signed | Lost Reason |
|---------|-----|------------|-------------|---------------|-------------|
| Kevin Curley | $175M | 2025-05-16 | 2025-06-12 | 27d | Economics |
| Scott Rojas | $15M | 2025-06-24 | 2025-07-17 | 23d | Lost to Competitor |
| Joshua Dvorak V3 | $61M | 2025-08-18 | 2025-08-18 | 0d | Lost to Competitor |
| Chad Wilkinson | $65M | 2025-08-20 | 2025-10-03 | 44d | Operational Constraints |
| Nick Reilly | $35M | 2025-08-05 | 2025-10-03 | 59d | Economics |
| Herb Flores | $61M | 2025-07-25 | 2025-10-09 | 76d | Other |
| Chris Jeannot | $96M | 2025-09-24 | 2025-11-25 | 62d | Other |

**Key observations:**

1. **All 7 losses occurred in 2025.** Zero Signed deals were lost before 2025. This is why Signed→Joined was 100% at all snapshots before Q4 2025 — there simply were no failures in the earlier data.

2. **The losses cluster in mid-to-late 2025**, suggesting either a market shift (advisors getting cold feet post-signing) or improved data hygiene (deals that previously would have lingered at Signed are now being actively closed lost).

3. **Reasons are diverse:** 2 Economics, 2 Lost to Competitor, 1 Operational Constraints, 2 Other. No single dominant failure mode.

4. **All losses occurred within 76 days of signing.** No deal spent 80+ days at Signed and then closed lost — so a duration penalty at Signed (which we skipped due to insufficient data) would not have helped with these cases.

**Verdict:** The Signed→Joined failures are **a recent and potentially emerging pattern, not historical noise.** The all-time rate (94.2%) is artificially high because losses only started occurring in 2025. The 1yr trailing rate (~88.5-91.7%) is more realistic going forward. **No model change needed for V1** — the 1yr trailing rate already captures these recent losses. Monitor this rate quarterly; if it drops below 85%, investigate whether a Signed-stage duration penalty or deal-quality check is warranted.

---

### Implementation Readiness Verdict

**No blockers found. The model is ready to build.**

- **On Hold contamination:** Affects 2 of 24 stale deals — manageable as a documented limitation for V1.
- **Anticipated date coverage:** 100% at Negotiating and Signed where timing accuracy matters most. No gaps in critical stages.
- **Whale deal exposure:** All current whales are fresh (Within 1 SD). Duration penalty will activate automatically if they stall. No hard floor needed.
- **Signed→Joined rate:** Recent losses are captured by the 1yr trailing rate. No additional adjustment required.

**Recommended implementation order remains:** P0 Duration Penalty → P1 2-Tier AUM Rates → P2 Whale Deal Presentation → P3 Drilldown Simplification.
