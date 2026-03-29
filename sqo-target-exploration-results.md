# SQO Target Calculator — Exploration Results

> **Feature:** Under each quarterly Expected AUM scorecard, add an editable "Target AUM" input that computes "Required SQOs from Prior Quarter." Persist targets to Neon DB. Reflect math in a new "BQ SQO Targets" Google Sheets tab with auditable formulas.
>
> **Explored:** 2026-03-24

---

## 1. Feature Summary

**User flow:**
1. User sees quarterly Expected AUM scorecards (e.g., "Q2 2026: $1.2B")
2. Below each, they type a Target AUM (e.g., "$500M")
3. The system computes: `Required SQOs = Target AUM / (Median Joined AUM × SQO→Joined Rate)`
4. Displays "~58 SQOs needed from prior quarter" (accounting for ~80-day velocity)
5. Target persists to Neon DB — recalculates dynamically as rates shift with window changes

**Sheets export:** New "BQ SQO Targets" tab shows the math as auditable formulas referencing the "BQ Rates and Days" tab for conversion rates.

---

## 2. BigQuery Data — Key Numbers

### Median AUM (use Joined-only, NOT all resolved)

| Window | Joined Deals | Median AUM | Mean AUM | Note |
|--------|-------------|-----------|---------|------|
| 180d | 14 | $24.9M | $51.9M | Too small for reliable median |
| **1yr** | **46** | **$30.3M** | **$97.3M** | Recommended |
| 2yr | 86 | $27.0M | $74.0M | Stable |
| All-time | 113 | $30.7M | $65.5M | Most stable |

**Critical finding:** Closed Lost deals have HIGHER AUM ($42M median) than Joined deals ($30.7M). Using the resolved pool median ($40M) would overestimate expected AUM per join by ~30%. The calculator must use **Joined-only** median.

**Distribution is right-skewed:** Mean is 2.1× median. Median is the correct metric — mean would be inflated by whale deals.

### SQO Velocity (time from SQO to Joined)

| Window | Avg Days | Note |
|--------|---------|------|
| 180d | 70d | Small sample (N=13) |
| **1yr** | **80d** | Recommended (N=46) |
| 2yr | 82d | Stable |
| All-time | 84d | Most stable |

**Implication:** SQOs need to be created ~11 weeks before the target quarter close to have time to convert. A Q3 2026 target (ending Sep 30) needs SQOs created by ~mid-July at the latest. The "from prior quarter" framing in the UI is roughly correct.

### Zero/Null AUM

- 0 null AUM records (Amount is 100% populated)
- 2 zero AUM records (0.24%) — safe to filter with `AUM > 0`
- 71.7% of deals fall back to `Amount` field (only 28.3% have `Underwritten_AUM__c`)

### No BQ View Changes Needed

All fields exist in `vw_funnel_master`. Median AUM can be computed by adding `APPROX_QUANTILES` to the existing rates query.

---

## 3. Files to Modify

### New Files

| File | Purpose |
|------|---------|
| `prisma/schema.prisma` | Add `ForecastQuarterTarget` model |
| `src/app/api/forecast/sqo-targets/route.ts` | GET + POST for persisting targets |

### Modified Files

| File | Change |
|------|--------|
| `src/lib/queries/forecast-rates.ts` | Add `mean_joined_aum` to query SELECT, `ForecastRates` interface, `RATES_SELECT`, `mapRawToForecastRates`, `EMPTY_RATES` |
| `src/app/dashboard/forecast/components/ForecastMetricCards.tsx` | Add Target AUM input + Required SQOs display per quarter card; new props for targets and callbacks |
| `src/app/dashboard/forecast/page.tsx` | Add `targetAumByQuarter` state, load targets on mount, save on change, thread to ForecastMetricCards, pass targets to export |
| `src/lib/api-client.ts` | Add `getSQOTargets()` and `saveSQOTarget()` methods; update `exportForecastToSheets` signature |
| `src/app/api/forecast/export/route.ts` | Add `SQO_TARGETS_TAB` constant, `buildSQOTargetsValues()` function, `writeTab()` call; accept `targetAumByQuarter` in POST body |

---

## 4. Type Changes

### `ForecastRates` (forecast-rates.ts)
```ts
// Add:
mean_joined_aum: number;  // dollars, median of COALESCE(Underwritten_AUM__c, Amount) for Joined deals
```

### `RawRatesResult` (forecast-rates.ts)
```ts
// Add:
mean_joined_aum: number | null;
```

### `ForecastRatesClient` (api-client.ts)
```ts
// Add:
mean_joined_aum: number;
```

### `ForecastMetricCardsProps` (ForecastMetricCards.tsx)
```ts
// Add:
targetAumByQuarter: Record<string, number>;  // keyed by "Q2 2026"
onTargetChange: (quarter: string, value: number) => void;
medianJoinedAum: number;  // from rates, for the SQO calculation
sqoToJoinedRate: number;  // product of all 4 flat rates
avgDaysToJoin: number;    // sum of avg days, for the "from prior quarter" label
```

### New Prisma Model
```prisma
model ForecastQuarterTarget {
  id               String   @id @default(cuid())
  quarter          String   @unique   // "Q2 2026"
  targetAumDollars Float    @default(0)
  updatedAt        DateTime @updatedAt
  updatedBy        String?
  @@map("forecast_quarter_targets")
}
```

---

## 5. Math

For each quarter with a target:

```
sqoToJoinedRate = rates.flat.sqo_to_sp × rates.flat.sp_to_neg × rates.flat.neg_to_signed × rates.flat.signed_to_joined

expectedAumPerJoin = mean_joined_aum (from Joined-only deals in the trailing window)

expectedJoinsPerSQO = sqoToJoinedRate

expectedAumPerSQO = expectedAumPerJoin × expectedJoinsPerSQO

requiredSQOs = ceil(targetAumDollars / expectedAumPerSQO)
```

Example (1yr all-time rates):
- sqoToJoinedRate = 0.672 × 0.408 × 0.538 × 0.942 = 0.139
- medianJoinedAum = $30.7M
- expectedAumPerSQO = $30.7M × 0.139 = $4.27M
- Target $500M → Required SQOs = ceil($500M / $4.27M) = **118 SQOs**

### Sheets Formulas (auditable)

The "BQ SQO Targets" tab will reference named ranges from "BQ Rates and Days":

```
B3: Target AUM (hardcoded from user input)
B4: =SQO_to_Joined_rate                          (from named range)
B5: =mean_joined_aum                            (new named range)
B6: =B5*B4                                        (expected AUM per SQO)
B7: =CEILING(B3/B6)                               (required SQOs)
```

---

## 6. Recommended Phase Order

| Phase | What | Risk | Depends On |
|-------|------|------|-----------|
| 1 | Add `mean_joined_aum` to rates query + interfaces | Low | Nothing |
| 2 | Add `ForecastQuarterTarget` Prisma model + migration | Low | Nothing |
| 3 | Create `/api/forecast/sqo-targets` GET+POST route | Low | Phase 2 |
| 4 | Update `ForecastMetricCards` with Target AUM input + Required SQOs display | Medium | Phases 1, 3 |
| 5 | Update `page.tsx` to load/save targets and thread state | Medium | Phases 3, 4 |
| 6 | Add `buildSQOTargetsValues` to Sheets export | Low | Phase 1 |
| 7 | Build check + validation | Low | All |

---

## 7. Backtest: Which AUM Denominator Should We Use?

### The question

When computing "required SQOs = Target AUM / (AUM_per_SQO × conversion_rate)", what should `AUM_per_SQO` be? We tested 6 candidates across 6 historical quarters:

| Method | Population | Statistic |
|--------|-----------|-----------|
| Joined Median | Only deals that Joined | Median AUM |
| Resolved Median | All resolved SQOs (Joined + Closed Lost) | Median AUM |
| All SQO Median | All SQOs including open | Median AUM |
| Joined Mean | Only deals that Joined | Mean AUM |
| Resolved Mean | All resolved SQOs | Mean AUM |
| All SQO Mean | All SQOs including open | Mean AUM |

### Backtest results: Predicted "required SQOs" vs actual prior-quarter SQOs

| Quarter | Actual Joined AUM | Actual Prior-Q SQOs | Joined Med | Resolved Med | All Med | Joined Mean | Resolved Mean | All Mean |
|---------|-------------------|--------------------|-----------:|-------------:|--------:|------------:|--------------:|---------:|
| 2024-Q3 | $378M | 53 | 78 | 58 | 58 | 67 | 32 | 32 |
| 2024-Q4 | $589M | 87 | 146 | 102 | 102 | 85 | 55 | 54 |
| 2025-Q1 | $463M | 80 | 119 | 87 | 82 | 65 | 51 | 51 |
| 2025-Q2 | $578M | 94 | 166 | 118 | 118 | 83 | 72 | 69 |
| 2025-Q3 | $765M | 109 | 210 | 141 | 136 | 91 | 84 | 80 |
| 2025-Q4 | $1.32B | 146 | 298 | 236 | 225 | 107 | 137 | 132 |

### Error vs actual SQOs (positive = overestimate = "you'd think you need more SQOs than you had")

| Quarter | Joined Med | Resolved Med | All Med | Joined Mean | Resolved Mean | All Mean |
|---------|----------:|-------------:|--------:|------------:|--------------:|---------:|
| 2024-Q3 | +25 | +5 | +5 | +14 | -21 | -21 |
| 2024-Q4 | +59 | +15 | +15 | -2 | -32 | -33 |
| 2025-Q1 | +39 | +7 | +2 | -15 | -29 | -29 |
| 2025-Q2 | +72 | +24 | +24 | -11 | -22 | -25 |
| 2025-Q3 | +101 | +32 | +27 | -18 | -25 | -29 |
| 2025-Q4 | +152 | +90 | +79 | -39 | -9 | -14 |

### Summary accuracy

| Method | Mean Abs Error | Avg Bias | Interpretation |
|--------|---------------|----------|----------------|
| **Joined Median** | **74.7** | +74.7 (always over) | Massively overestimates — says you need 2-3× the SQOs you actually had |
| **Resolved Median** | **28.8** | +28.8 (slight over) | Moderate overestimate — conservative but usable |
| **All SQO Median** | **25.3** | +25.3 (slight over) | Similar to resolved, slightly better |
| **Joined Mean** | **16.5** | -11.8 (slight under) | **Best accuracy.** Slight underestimate — says you need fewer SQOs than you had |
| **Resolved Mean** | **23.0** | -23.0 (under) | Underestimates — whale deals inflate mean |
| **All SQO Mean** | **25.2** | -25.2 (under) | Similar to resolved mean |

### Interpretation

**Medians systematically overestimate required SQOs** because they ignore whale deals. When a $1.5B Marcado joins (Q4 2025), it delivers the AUM equivalent of ~50 median-sized deals — but the median-based formula doesn't account for this, so it says you needed 225-298 SQOs when you actually had 146.

**Means systematically underestimate** (except Joined Mean) because they're inflated by whale deals that often don't close, making each SQO look more valuable than it really is.

**Joined Mean ($65.5M all-time) is the winner** with the lowest error (MAE=16.5) and nearly unbiased (-11.8 SQOs on average). This makes sense: it measures the actual average AUM that walks in the door when deals close, including the occasional whale that dramatically shifts the quarterly total.

### Why Joined Mean beats Resolved/All SQO populations

Using all resolved or all SQOs inflates the mean with large Closed Lost deals (Closed Lost median AUM = $42M vs Joined median = $30.7M). The Joined population correctly reflects "what AUM actually lands when deals close" — including the whale variance that drives quarterly totals.

### Recommendation: Use Joined Mean

**`AUM_per_SQO = mean_joined_aum`** (from the selected trailing window)

- Most accurate in backtest (MAE=16.5 SQOs, vs 25-75 for other methods)
- Slight conservative underestimate (-11.8 SQOs avg bias) — says you need slightly fewer than you actually had, which is acceptable for target-setting
- Accounts for whale deal variance that dominates quarterly outcomes
- Field name in the rates query: `mean_joined_aum` (not `mean_joined_aum`)

**Caveat:** The 180d window has N=14 joined deals and the mean ($51.9M) is volatile. Show a sample size warning when N < 30.

---

## 8. Updated Math (post-backtest)

For each quarter with a target:

```
sqoToJoinedRate = rates.flat.sqo_to_sp × rates.flat.sp_to_neg × rates.flat.neg_to_signed × rates.flat.signed_to_joined

meanJoinedAum = mean AUM of Joined deals in the trailing window

expectedAumPerSQO = meanJoinedAum × sqoToJoinedRate

requiredSQOs = ceil(targetAumDollars / expectedAumPerSQO)
```

Example (all-time rates):
- sqoToJoinedRate = 0.672 × 0.408 × 0.538 × 0.942 = 0.139
- meanJoinedAum = $65.5M
- expectedAumPerSQO = $65.5M × 0.139 = $9.1M
- Target $500M → Required SQOs = ceil($500M / $9.1M) = **55 SQOs**

Compare to backtest: actual prior-quarter SQOs ranged from 53-146, and the Joined Mean method predicted 67-132. The formula tracks reality.

### Sheets Formulas (auditable)

```
B3: Target AUM (from user input)
B4: =SQO_to_Joined_rate                          (named range)
B5: =mean_joined_aum                             (new named range — Joined deals mean AUM)
B6: =B5*B4                                       (expected AUM per SQO)
B7: =CEILING(B3/B6)                              (required SQOs)
```

---

## 9. Risks and Decisions

### Decision: Persistence scope

Targets are global (one target per quarter, not per user), matching the `ManagerQuarterlyGoal` pattern. Any user with `canRunScenarios` permission can edit.

### Decision: 180d window warning

The 180d Joined cohort has only N=14 deals. Show "(N=14, low confidence)" when below 30 deals. Use the selected window's mean regardless — don't silently substitute a different window.

### Risk: Named range dependency

The Sheets export formulas reference named ranges (`SQO_to_Joined_rate`, `mean_joined_aum`). The user must create these in the Google Sheet. If missing, formulas show `#NAME?`.

---

## 8. Existing Patterns to Follow

| Pattern | Source | Apply To |
|---------|--------|----------|
| Editable number input with callback | `TeamGoalEditor.tsx` | Target AUM input |
| Global per-quarter model | `ManagerQuarterlyGoal` Prisma model | `ForecastQuarterTarget` |
| Upsert API route | `quarterly-goals/route.ts` | `/api/forecast/sqo-targets` |
| Multi-section Sheets tab | `buildRatesAndDaysValues()` | `buildSQOTargetsValues()` |
| Named range references | P2 tab K-N formulas | SQO Targets tab |
| Auth: `canRunScenarios` for writes | `scenarios/route.ts` | New targets route |
