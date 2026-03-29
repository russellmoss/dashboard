# Exploration Results: Realization Forecast + What-If Panel + Sheets Tabs

**Date:** 2026-03-25
**Agents:** Code Inspector, Data Verifier, Pattern Finder

---

## 1. Feature Summary

Three features to add to the Forecast page and Sheets export:

| Feature | UI Component | Sheets Tab | New Code |
|---------|-------------|------------|----------|
| SQO Calculator + What-If | What-if rate/AUM sliders panel | -- | New component, client-side only |
| Realization Forecast | Realization banner above metric cards | BQ Realization Forecast | New component + buildRealizationValues() |
| Scenario Runner | -- (already exists as ScenarioRunner) | BQ Scenario Runner | buildScenarioRunnerValues() + 6 new named ranges |

**Already built (do NOT re-implement):**
- ForecastQuarterTarget Prisma model, /api/forecast/sqo-targets route
- Target AUM input per quarter card in ForecastMetricCards
- Required SQOs display, entry quarter calculation, low-confidence warning (n<30)
- mean_joined_aum + joined_deal_count in forecast-rates.ts query
- BQ SQO Targets Sheets tab with buildSQOTargetsValues()

---

## 2. BigQuery Status

### Component A Pipeline (Neg+Signed with future dates)
| Quarter | Deals | AUM | Neg | Signed |
|---------|-------|-----|-----|--------|
| Q1 2026 | 2 | $100.2M | 2 | 0 |
| Q2 2026 | 29 | $2,527.4M | 25 | 4 |
| Q3 2026 | 2 | $364.5M | 2 | 0 |

Q2 2026 is the primary target. Q1 deals likely to slip (quarter ends 2026-03-31).

### Mean Joined AUM by Window
| Window | N | Mean AUM |
|--------|---|----------|
| 180d | 13 | $49.8M |
| 1yr | 45 | $97.7M |
| 2yr | 85 | $73.9M |
| All-time | 112 | $65.4M |

- Confirms spec references ($65.5M all-time, $97.3M 1yr)
- **180d window: n=13, BELOW 30-deal threshold** -- warning will trigger correctly
- 1yr vs all-time divergence is 49% ($97.7M vs $65.4M) -- surface prominently

### Q4 2025 Realization Rate
48 deals with Q4 anticipated dates -> 17 joined (35.4%). Confirms backtest ~34%. Band validation: 48 deals = 15+ band = 35% spec rate.

### CRITICAL BLOCKER: Component B Surprise AUM
**`Earliest_Anticipated_Start_Date__c` is overwritten post-join.** 73.3% of joined deals (55/75) have anticipated date = actual join date. `vw_funnel_master` shows the current (post-join) value, NOT the original forecast value. Result: Component B = ~$0 from live data, contradicting the backtest's $398M trailing average.

**Root cause:** Salesforce reps update the anticipated date after close. The backtest used `OpportunityFieldHistory` for point-in-time reconstruction -- not available in current view.

**v1 recommendation:** Hard-code `SURPRISE_BASELINE_AUM = 398_000_000` as a constant with an explanatory cell note. Update quarterly.
**Long-term:** Build a new BQ view using `OpportunityFieldHistory` for PIT reconstruction.

---

## 3. Files to Modify

### New Files to Create
| File | Purpose |
|------|---------|
| `src/app/dashboard/forecast/components/RealizationBanner.tsx` | Component A+B forecast summary banner above metric cards |
| `src/app/dashboard/forecast/components/WhatIfPanel.tsx` | Rate + AUM sliders with client-side SQO recalculation |

### Existing Files to Modify
| File | Changes |
|------|---------|
| `src/app/dashboard/forecast/page.tsx` | Import + render RealizationBanner (line ~371) and WhatIfPanel (line ~384); pass rates + pipeline as props |
| `src/app/api/forecast/export/route.ts` | Add `buildRealizationValues()`, `buildScenarioRunnerValues()`, 2 new tab constants, 6 new named ranges, extend writeTab sequence |
| `src/app/api/forecast/export/route.ts` (buildRatesAndDaysValues) | Add rows for mean_joined_aum, cohort_count, avg_days_* to Rates tab output; update Named Ranges Reference section |

### No Changes Needed
| File | Reason |
|------|--------|
| `src/lib/queries/forecast-rates.ts` | Already returns mean_joined_aum, joined_deal_count, tiered rates |
| `prisma/schema.prisma` | ForecastQuarterTarget already exists |
| `src/app/api/forecast/sqo-targets/route.ts` | Already fully built |
| `src/app/dashboard/forecast/components/ForecastMetricCards.tsx` | Target input + SQO calculator already complete |

---

## 4. Type Changes

### No new TypeScript interfaces required for the UI components
- `WhatIfPanel` uses inline `RateShape` (duplicated from ForecastMetricCards pattern, lines 8-22) -- do NOT import from server-only `forecast-rates.ts`
- `RealizationBanner` receives pipeline rows (already typed as `ForecastPipelineRecord[]`) and rates
- Export builder functions return `any[][]` (existing pattern)

### Inline RateShape (copy from ForecastMetricCards)
```typescript
interface RateShape {
  sqo_to_sp: number;
  sp_to_neg: number;
  neg_to_signed: number;
  signed_to_joined: number;
  avg_days_sqo_to_sp: number;
  avg_days_in_sp: number;
  avg_days_in_neg: number;
  avg_days_in_signed: number;
  mean_joined_aum: number;
  joined_deal_count: number;
  cohort_count: number;
}
```

---

## 5. Construction Site Inventory

### RealizationBanner.tsx (new)
- Filters pipeline to Neg+Signed deals with future anticipated dates
- Groups by target quarter, sums AUM (Component A)
- Applies deal-count band realization rate: <10 deals = 60%, 10-14 = 45%, 15+ = 35%
- Adds Component B baseline ($398M constant for v1)
- Displays: "Q2 2026 Forecast: $2.5B pipeline x 35% realization = $884M + $398M surprise = $1.28B"

### WhatIfPanel.tsx (new)
- State: `overrides` (4 rates) + `meanAumOverride` (number)
- Initialized from `rates` prop, re-synced via useEffect (follow ScenarioRunner pattern)
- Pure `useMemo` computation: `requiredSQOs = ceil(targetAum / (meanAumOverride * product(overrides)))`
- NO API call, NO DB save, NO Monte Carlo re-run
- Slider UI must be built from scratch -- no existing slider component in forecast feature
- Consider HTML `<input type="range">` or Tremor's NumberInput with a visual bar

### page.tsx modifications
- Import RealizationBanner, WhatIfPanel
- Pass `pipeline`, `rates?.flat`, `targetAumByQuarter` as props
- Insert RealizationBanner after ForecastMetricCards (line ~371)
- Insert WhatIfPanel between MonteCarloPanel and ScenarioRunner (line ~384)

### buildRealizationValues() (new, in export/route.ts)
- **Section 1 (rows 1-12):** Summary -- one row per future quarter with COUNTIF/SUMIFS referencing Section 2
- **Section 2 (rows 15+):** Component A deal detail -- one row per Neg+Signed deal with future date
- **Section 3 (bottom):** Component B history -- trailing 4Q surprise AUM (hardcoded $398M for v1)
- Build order: Section 2 first (count rows), then Section 1 with formula refs, push Section 1 first
- Formula pattern: `=SUMIFS(D${sec2Start}:D${sec2End},F${sec2Start}:F${sec2End},A${row})`
- Input: `p2Rows` (filter to Neg+Signed with future dates), `flatRates`
- Sort: by target quarter, then AUM descending

### buildScenarioRunnerValues() (new, in export/route.ts)
- **Section 1 (rows 1-10):** Current trailing rates -- formulas referencing named ranges from Rates tab
- **Section 2 (rows 12-22):** Scenario inputs -- editable cells (hardcoded with current values as defaults)
- **Section 3 (rows 24+):** Target analysis -- one row per quarter with scenario vs current SQO comparison
- **Section 4 (rows 35+, optional):** Sensitivity matrix -- required SQOs at different rate x AUM combos
- Cross-tab refs: `='BQ Rates and Days'!$B$6` or named ranges (prefer named ranges, match P2 style)
- Input: `flatRates`, `targetAumByQuarter`

### Named ranges to add (6 new entries in route.ts lines 1039-1056)
Must be added to BOTH:
1. `namedRanges` array in the batchUpdate block
2. Named Ranges Reference section in buildRatesAndDaysValues output (lines 866-882)

| Name | Value Source |
|------|-------------|
| mean_joined_aum | flatRates.mean_joined_aum |
| cohort_count | flatRates.cohort_count |
| avg_days_sqo_to_sp | flatRates.avg_days_sqo_to_sp |
| avg_days_in_sp | flatRates.avg_days_in_sp |
| avg_days_in_neg | flatRates.avg_days_in_neg |
| avg_days_in_signed | flatRates.avg_days_in_signed |

New rows must be added to `buildRatesAndDaysValues()` output, and the corresponding 0-indexed row/col offsets must be added to the namedRanges array.

---

## 6. Recommended Phase Order

### Phase 1: Realization Banner Component
- Create `RealizationBanner.tsx` -- filter pipeline, group by quarter, apply realization bands, add Component B constant
- Wire into page.tsx at line ~371
- **Validation:** Visual check -- banner shows above metric cards with correct numbers

### Phase 2: What-If Panel Component
- Create `WhatIfPanel.tsx` -- rate overrides + AUM override sliders, useMemo SQO calculation
- Wire into page.tsx at line ~384
- **Validation:** Adjust sliders, verify Required SQOs updates in real time

### Phase 3: Sheets -- Named Range Extension
- Add 6 new rows to `buildRatesAndDaysValues()` for mean_joined_aum, cohort_count, avg_days_*
- Add 6 entries to `namedRanges` array with correct row/col offsets
- Update Named Ranges Reference section (lines 866-882)
- **Validation:** Export, verify BQ Rates and Days tab has new rows + named ranges resolve

### Phase 4: Sheets -- Realization Forecast Tab
- Implement `buildRealizationValues()` with 3 sections
- Add `REALIZATION_TAB = 'BQ Realization Forecast'` constant
- Add `await writeTab(...)` after SQO Targets tab
- **Validation:** Export, verify COUNTIF/SUMIFS formulas resolve, deal detail matches P2 tab, Component B shows $398M

### Phase 5: Sheets -- Scenario Runner Tab
- Implement `buildScenarioRunnerValues()` with 4 sections
- Add `SCENARIO_TAB = 'BQ Scenario Runner'` constant
- Add `await writeTab(...)` after Realization tab
- **Validation:** Export, verify Section 1 references named ranges, Section 2 editable, Section 3 formulas compute, sensitivity matrix correct

### Phase 6: Build + Lint + Doc Sync
- `npm run build` -- verify no TypeScript errors
- `npx agent-guard sync` -- update docs
- Write `.ai-session-context.md` before commit

---

## 7. Risks and Blockers

### BLOCKER: Component B Surprise AUM ($398M)
- **Status:** Cannot compute from `vw_funnel_master` -- anticipated dates overwritten post-join
- **Mitigation (v1):** Hard-code `SURPRISE_BASELINE_AUM = 398_000_000` constant
- **Long-term:** New BQ view using `OpportunityFieldHistory` for PIT reconstruction
- **Impact:** Realization banner and Sheets Section 3 both need this value

### RISK: 180d Window Unreliability
- Only 13 joined deals in 180d window. Mean AUM = $49.8M (vs $97.7M at 1yr)
- Sample size warning already implemented and will correctly trigger
- **Mitigation:** None needed -- warning is built. Consider defaulting to 1yr for SQO calculator

### RISK: No Existing Slider Component
- ScenarioRunner uses `<input type="number">`, not sliders
- Must build range sliders from scratch for what-if panel
- **Mitigation:** Use HTML `<input type="range">` with Tailwind styling, or install a lightweight slider lib

### RISK: Named Range Row Offset Synchronization
- Named ranges use 0-indexed row/col referencing buildRatesAndDaysValues output
- Adding new rows changes offsets for all subsequent rows
- Must update BOTH the namedRanges array AND the reference section
- **Mitigation:** Add new rows at the END of the Rates tab to avoid shifting existing offsets

### RISK: Sheets API Rate Limits
- 7 tabs x ~4 API calls each = ~28 calls. Quota = 300/min. Within limits.
- maxDuration already 60s (line 910)
- **Mitigation:** None needed, but monitor if tabs grow large

### RISK: Q4 2025 Realization Caveat
- 35.4% rate confirmed, but the 48-deal count includes post-join date overwrites
- Actual pipeline at Q4 start was likely larger (lower true realization rate)
- **Mitigation:** Document in Sheets cell note. The backtest corrected for this via OFH.

---

## 8. Documentation

Implementation guide must include:
- `npx agent-guard sync` phase (Phase 6) after code changes pass build
- Update ARCHITECTURE.md if new components added to forecast page
- Run `npm run gen:api-routes` if export route signature changes
- Write `.ai-session-context.md` before every git commit (Wrike integration)

---

## Key Files Reference

| File | Lines | Purpose |
|------|-------|---------|
| `src/app/dashboard/forecast/page.tsx` | 362-418 | Render order, state vars, insertion points |
| `src/app/dashboard/forecast/components/ForecastMetricCards.tsx` | 8-22, 106-117 | RateShape interface, SQO math (already built) |
| `src/app/dashboard/forecast/components/ScenarioRunner.tsx` | 39-63 | Rate override state pattern to follow |
| `src/app/api/forecast/export/route.ts` | 19-23, 463-649, 1039-1056 | Tab constants, builder pattern, named ranges |
| `src/lib/queries/forecast-rates.ts` | 5-19 | ForecastRates interface (no changes needed) |
| `prisma/schema.prisma` | 98-108 | ForecastQuarterTarget (already exists) |

---

*Generated from parallel agent exploration on 2026-03-25*
