---
name: audit-deals
description: "Compare deal calculator proposals against won/lost outcomes. Analyzes deal economics (equity, draws, AUM, payouts) to find what deal structures win vs lose and whether proposals should be adjusted."
---

# Deal Calculator Auditor — Proposal vs Outcome Analysis

You are analyzing Savvy Wealth's deal proposals against actual won/lost outcomes to answer: **What deal structures win? What loses? Should we adjust how we propose deals?**

## Data Sources

All queries use BigQuery MCP (`mcp__bigquery__execute_sql`). Key tables:

- **`savvy-gtm-analytics.SavvyGTMData.Opportunity`** — Full deal economics: equity kickers, draw amounts, forgivable loans, underwritten AUM/ARR, payout rates, vesting
- **`savvy-gtm-analytics.Tableau_Views.vw_funnel_master`** — Funnel outcomes (is_joined, SGA, SGM, source, velocity, AUM tiers)
- **`savvy-gtm-analytics.Tableau_Views.vw_lost_to_competition`** — Lost deals with competitor firm, timing, and reasons
- **Google Sheets MCP** — If the user specifies a deal calculator spreadsheet, read it via `mcp__google-sheets__sheets_get_values`

**Important**: Never use string interpolation in queries.

## Step 1: Map the Deal Economics Landscape

Pull all SQO-stage deals with their full economic terms:

```sql
SELECT
  o.Id AS opp_id,
  o.Name AS opp_name,
  o.StageName,
  o.IsWon,
  o.IsClosed,
  o.Closed_Lost_Reason__c,
  -- AUM metrics
  o.Personal_AUM__c,
  o.Underwritten_AUM__c,
  o.SGA_Reported_AUM__c,
  o.Actual_AUM__c,
  o.Expected_AUM__c,
  o.Average_AUM_at_Firm__c,
  o.Margin_AUM__c,
  o.Actual_Margin_AUM__c,
  -- Revenue
  o.Amount,
  o.ExpectedRevenue,
  o.Underwritten_ARR__c,
  o.Estimated_Average_Client_Fee__c,
  -- Equity terms
  o.Equity_Kicker__c,
  o.Equity_Kicker_Value__c,
  o.Equity_Kicker_ARR_Minimum__c,
  o.Equity_Vesting_Duration_Months__c,
  o.Equity_Grant_2__c,
  o.Equity_Grant_2_Value__c,
  o.Equity_Grant_2_ARR_Threshold__c,
  o.Equity_Grant_3__c,
  o.Equity_Grant_3_Value__c,
  o.Equity_Grant_4__c,
  o.Equity_Grant_4_Value__c,
  -- Financial terms
  o.Draw_Amount_12_Month__c,
  o.Forgivable_Loan_Amount__c,
  o.Other_Fixed_Cost_Annual_Amount__c,
  -- Dates
  o.CloseDate,
  DATE(o.Stage_Entered_Negotiating__c) AS negotiating_date,
  DATE(o.Stage_Entered_Signed__c) AS signed_date,
  DATE(o.Stage_Entered_Joined__c) AS joined_date,
  DATE(o.Stage_Entered_Closed__c) AS closed_date,
  o.Closed_Lost_Details__c
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
WHERE o.StageName NOT IN ('Planned Nurture', 'Outreach', 'Call Scheduled', 'Engaged')
  AND o.IsDeleted = FALSE
ORDER BY o.CloseDate DESC
```

## Step 2: Won vs Lost Economics Comparison

```sql
-- Compare deal terms between won and lost deals
WITH deals AS (
  SELECT
    o.Id,
    CASE
      WHEN o.StageName = 'Joined' THEN 'Won'
      WHEN o.IsClosed AND NOT o.IsWon THEN 'Lost'
      ELSE 'Open'
    END AS outcome,
    o.Closed_Lost_Reason__c,
    o.Underwritten_AUM__c,
    o.Underwritten_ARR__c,
    o.Amount,
    o.Equity_Kicker__c,
    o.Equity_Kicker_Value__c,
    o.Draw_Amount_12_Month__c,
    o.Forgivable_Loan_Amount__c,
    o.Estimated_Average_Client_Fee__c,
    o.Equity_Vesting_Duration_Months__c
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
  WHERE o.Underwritten_AUM__c IS NOT NULL
    AND o.Underwritten_AUM__c > 0
    AND o.IsDeleted = FALSE
)
SELECT
  outcome,
  COUNT(*) AS deals,
  -- AUM
  ROUND(AVG(Underwritten_AUM__c / 1e6), 1) AS avg_aum_m,
  ROUND(APPROX_QUANTILES(Underwritten_AUM__c / 1e6, 100)[OFFSET(50)], 1) AS median_aum_m,
  ROUND(MIN(Underwritten_AUM__c / 1e6), 1) AS min_aum_m,
  ROUND(MAX(Underwritten_AUM__c / 1e6), 1) AS max_aum_m,
  -- ARR
  ROUND(AVG(Underwritten_ARR__c), 0) AS avg_arr,
  -- Equity
  ROUND(AVG(CASE WHEN Equity_Kicker__c THEN 1.0 ELSE 0 END) * 100, 1) AS equity_pct,
  ROUND(AVG(CASE WHEN Equity_Kicker__c THEN Equity_Kicker_Value__c END), 0) AS avg_equity_value,
  -- Draw
  ROUND(AVG(Draw_Amount_12_Month__c), 0) AS avg_draw_12m,
  COUNTIF(Draw_Amount_12_Month__c > 0) AS deals_with_draw,
  -- Forgivable Loan
  ROUND(AVG(Forgivable_Loan_Amount__c), 0) AS avg_loan,
  COUNTIF(Forgivable_Loan_Amount__c > 0) AS deals_with_loan,
  -- Fees
  ROUND(AVG(Estimated_Average_Client_Fee__c) * 100, 2) AS avg_fee_bps
FROM deals
GROUP BY 1
ORDER BY CASE outcome WHEN 'Won' THEN 1 WHEN 'Open' THEN 2 ELSE 3 END
```

## Step 3: Economics by Closed Lost Reason

```sql
-- What deal terms do we see in specific loss categories?
SELECT
  o.Closed_Lost_Reason__c AS reason,
  COUNT(*) AS deals,
  ROUND(AVG(o.Underwritten_AUM__c / 1e6), 1) AS avg_aum_m,
  ROUND(AVG(CASE WHEN o.Equity_Kicker__c THEN 1.0 ELSE 0 END) * 100, 1) AS equity_pct,
  ROUND(AVG(CASE WHEN o.Equity_Kicker__c THEN o.Equity_Kicker_Value__c END), 0) AS avg_equity_val,
  ROUND(AVG(o.Draw_Amount_12_Month__c), 0) AS avg_draw,
  ROUND(AVG(o.Forgivable_Loan_Amount__c), 0) AS avg_loan
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
WHERE o.IsClosed = TRUE AND o.IsWon = FALSE
  AND o.Underwritten_AUM__c > 0
  AND o.Closed_Lost_Reason__c IS NOT NULL
  AND o.IsDeleted = FALSE
GROUP BY 1
HAVING COUNT(*) >= 5
ORDER BY deals DESC
```

## Step 4: AUM Tier Analysis — What Range Wins?

```sql
-- Win/loss by AUM tier
WITH deals AS (
  SELECT
    o.Id,
    CASE
      WHEN o.StageName = 'Joined' THEN 'Won'
      WHEN o.IsClosed AND NOT o.IsWon THEN 'Lost'
    END AS outcome,
    o.Underwritten_AUM__c,
    CASE
      WHEN o.Underwritten_AUM__c < 25e6 THEN '< $25M'
      WHEN o.Underwritten_AUM__c < 50e6 THEN '$25-50M'
      WHEN o.Underwritten_AUM__c < 100e6 THEN '$50-100M'
      WHEN o.Underwritten_AUM__c < 200e6 THEN '$100-200M'
      ELSE '$200M+'
    END AS aum_tier
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
  WHERE o.Underwritten_AUM__c > 0
    AND (o.StageName = 'Joined' OR (o.IsClosed AND NOT o.IsWon))
    AND o.IsDeleted = FALSE
)
SELECT
  aum_tier,
  COUNTIF(outcome = 'Won') AS won,
  COUNTIF(outcome = 'Lost') AS lost,
  ROUND(SAFE_DIVIDE(COUNTIF(outcome = 'Won'),
    COUNTIF(outcome = 'Won') + COUNTIF(outcome = 'Lost')) * 100, 1) AS win_rate_pct
FROM deals
GROUP BY 1
ORDER BY MIN(Underwritten_AUM__c)
```

## Step 5: Equity Kicker Impact on Win Rate

```sql
-- Does offering equity improve win rates? At what AUM level?
WITH deals AS (
  SELECT
    o.Id,
    CASE WHEN o.StageName = 'Joined' THEN 'Won' ELSE 'Lost' END AS outcome,
    o.Underwritten_AUM__c,
    o.Equity_Kicker__c AS has_equity,
    o.Equity_Kicker_Value__c,
    CASE
      WHEN o.Underwritten_AUM__c < 50e6 THEN 'Under $50M'
      WHEN o.Underwritten_AUM__c < 100e6 THEN '$50-100M'
      ELSE '$100M+'
    END AS aum_bucket
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
  WHERE (o.StageName = 'Joined' OR (o.IsClosed AND NOT o.IsWon))
    AND o.Underwritten_AUM__c > 0
    AND o.IsDeleted = FALSE
)
SELECT
  aum_bucket,
  has_equity,
  COUNT(*) AS deals,
  COUNTIF(outcome = 'Won') AS won,
  ROUND(SAFE_DIVIDE(COUNTIF(outcome = 'Won'), COUNT(*)) * 100, 1) AS win_rate_pct,
  ROUND(AVG(Equity_Kicker_Value__c), 0) AS avg_equity_value
FROM deals
GROUP BY 1, 2
HAVING COUNT(*) >= 3
ORDER BY aum_bucket, has_equity
```

## Step 6: Lost to Competitor — What Firms Are We Losing To?

```sql
SELECT
  l.moved_to_firm,
  COUNT(*) AS deals_lost,
  ROUND(AVG(l.months_to_move), 1) AS avg_months_to_move,
  l.closed_lost_reason,
  STRING_AGG(DISTINCT LEFT(l.closed_lost_details, 100), ' | ' LIMIT 3) AS sample_details
FROM `savvy-gtm-analytics.Tableau_Views.vw_lost_to_competition` l
WHERE l.moved_to_firm IS NOT NULL
GROUP BY 1, 3
ORDER BY deals_lost DESC
LIMIT 20
```

## Step 7: Deal Calculator Comparison (if spreadsheet provided)

If the user specifies a Google Sheets deal calculator folder/URL:

1. Use `mcp__google-sheets__sheets_get_metadata` to list sheets
2. Use `mcp__google-sheets__sheets_get_values` to read proposal terms
3. Compare the proposed ranges (AUM thresholds, equity tiers, draw schedules) against the actual won/lost distributions from Steps 2-5
4. Flag any misalignments (e.g., "Calculator offers equity at $75M+ but 80% of wins are under $50M")

## Step 8: Synthesize Report

```markdown
# Deal Economics Audit Report
*Generated: [date]*

## Executive Summary
- Analyzed [N] closed deals ([W] won, [L] lost)
- Average won deal: $[X]M AUM, [Y]% include equity, $[Z] avg draw
- Key finding: [one sentence on biggest insight]

## 1. The Winning Deal Profile
| Metric | Won Deals | Lost Deals | Delta |
|--------|-----------|------------|-------|
| Median AUM | | | |
| Equity offered % | | | |
| Avg equity value | | | |
| Avg 12-month draw | | | |
| Avg forgivable loan | | | |
| Avg client fee (bps) | | | |

## 2. Win Rate by AUM Tier
[Table showing win rate at each AUM band — where's the sweet spot?]

## 3. Equity Kicker Impact
[Does equity improve win rate? At what AUM level does it matter most?]

## 4. Why We Lose
[Breakdown by closed-lost reason with deal economics for each]
- **Economics (131 deals)**: Avg AUM $[X]M — are we under-proposing?
- **Lost to Competitor (92 deals)**: Losing mostly to [firm] — what are they offering?
- **Timing (239 deals)**: These come back — what's the re-engagement rate?

## 5. Competitor Analysis
[Which firms we lose to, how quickly advisors move, what details emerge]

## 6. Proposal Adjustment Recommendations
Ranked by expected impact:
1. **[Specific change]**: e.g., "Increase equity kicker for $50-100M AUM band from $X to $Y — this tier has 15% lower win rate without equity"
2. **[Specific change]**: e.g., "Add forgivable loan option for Farther-competitive deals — we've lost 12 to them"
3. **[Specific change]**: e.g., "Our median won deal is $[X]M AUM — recalibrate calculator default range"

## 7. Deal Calculator Gap Analysis
[If spreadsheet was provided: specific misalignments between calculator ranges and actual outcomes]
```

**IMPORTANT**:
- ALL numbers from BigQuery — never estimate
- Treat deal economics as sensitive — don't include specific advisor names with dollar amounts
- Focus recommendations on **structural adjustments** to proposal templates, not individual deal negotiations
- If certain fields have low population rates, note that and adjust analysis accordingly
- Save report to `deal-economics-audit-report.md`
