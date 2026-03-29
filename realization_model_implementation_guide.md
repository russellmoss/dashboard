# Agentic Implementation Guide: Realization Forecast + What-If Panel + Sheets Tabs

## Reference Documents
All decisions in this guide are based on the completed exploration files:
- `exploration-results.md` — synthesized findings from all 3 agents
- `code-inspector-findings.md` — exact line numbers, state variables, render order
- `data-verifier-findings.md` — live BQ query results, data quality flags
- `pattern-finder-findings.md` — code patterns for state, formulas, named ranges, tabs
- `docs/forecast/forecast_modeling_backtest_results.md` — two-component model mechanics, realization bands, Component B derivation
- `docs/forecast/backtesting_sql.md` — all SQL queries used in the backtest

These documents are the single source of truth.

## Feature Summary

| Feature | New Files | Modified Files | Status |
|---------|-----------|----------------|--------|
| SQO Calculator (target, required SQOs, entry quarter) | — | — | **ALREADY BUILT** |
| Realization Banner | `RealizationBanner.tsx` | `page.tsx` | New |
| What-If Panel | `WhatIfPanel.tsx` | `page.tsx` | New |
| Named Range Extension | — | `export/route.ts` | Modify |
| Realization Forecast Sheets Tab | — | `export/route.ts` | New builder function |
| Scenario Runner Sheets Tab | — | `export/route.ts` | New builder function |

### Already Built — Do NOT Re-implement
- `ForecastQuarterTarget` Prisma model (schema.prisma:98-108)
- `/api/forecast/sqo-targets` GET+POST route
- Target AUM input per quarter card in ForecastMetricCards
- Required SQOs display, entry quarter calculation, low-confidence warning (n<30)
- `mean_joined_aum` + `joined_deal_count` in `forecast-rates.ts` query
- `buildSQOTargetsValues()` + "BQ SQO Targets" Sheets tab

## Pre-Flight Checklist

```bash
npm run build 2>&1 | head -50
```

If pre-existing errors, **STOP AND REPORT**. Do not proceed with a broken baseline.

---

# PHASE 1: Realization Banner Component

## Context
Create a new component that displays the two-component quarterly forecast above ForecastMetricCards. It filters the pipeline to Neg+Signed deals with future anticipated dates, groups by target quarter, applies deal-count band realization rates, and adds the Component B surprise baseline.

The two-component model is documented in `docs/forecast/forecast_modeling_backtest_results.md` Part 4. It achieves 17% MAPE — 8x more accurate than the probability model.

## Step 1.1: Create RealizationBanner.tsx

**File**: `src/app/dashboard/forecast/components/RealizationBanner.tsx` (NEW)

```typescript
'use client';

import React, { useMemo } from 'react';
import { Card, Text } from '@tremor/react';
import { TrendingUp, AlertTriangle, Info } from 'lucide-react';

// ── Two-Component Model Constants ──────────────────────────────────────────
// Source: docs/forecast/forecast_modeling_backtest_results.md, Part 4
// Derived from 5-quarter PIT-corrected backtest (Q4 2024 – Q4 2025)
// Review and recalibrate quarterly as more data accumulates.

// Component B: trailing 4-quarter average of "surprise" AUM — deals that joined
// without being Neg+Signed with an anticipated date at quarter start.
// Cannot be computed from vw_funnel_master (Earliest_Anticipated_Start_Date__c is
// overwritten post-join; 73% of joined deals show anticipated = actual join date).
// This value was derived via OpportunityFieldHistory PIT reconstruction in the backtest.
// Update quarterly during recalibration.
const SURPRISE_BASELINE_AUM = 398_000_000;

// Realization bands: fewer dated deals = higher selectivity = higher realization.
// As the anticipated date field shifts from strong commitment signal to routine
// pipeline management, larger pools realize at lower rates.
// Source: backtest Part 4, "Deal-count bands" section.
const REALIZATION_BANDS = [
  { maxDeals: 9,  rate: 0.60, label: '<10 deals — high selectivity' },
  { maxDeals: 14, rate: 0.45, label: '10-14 deals — moderate pool' },
  { maxDeals: Infinity, rate: 0.35, label: '15+ deals — broad pool' },
] as const;

function getRealizationRate(dealCount: number): { rate: number; label: string } {
  for (const band of REALIZATION_BANDS) {
    if (dealCount <= band.maxDeals) {
      return { rate: band.rate, label: band.label };
    }
  }
  return { rate: 0.35, label: '15+ deals' };
}

// Inline pipeline record shape — avoid importing server-only module
interface PipelineRecord {
  StageName: string;
  Opportunity_AUM_M: number;
  Earliest_Anticipated_Start_Date__c: string | null;
  projected_quarter: string | null;
}

interface RealizationBannerProps {
  pipeline: PipelineRecord[];
  windowDays: 180 | 365 | 730 | null;
}

function formatAum(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  if (value > 0) return `$${(value / 1e3).toFixed(0)}K`;
  return '$0';
}

function getQuarterFromDate(dateStr: string): string | null {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const q = Math.ceil((d.getMonth() + 1) / 3);
  return `Q${q} ${d.getFullYear()}`;
}

function isCurrentOrFutureQuarter(quarter: string): boolean {
  const match = quarter.match(/^Q(\d)\s+(\d{4})$/);
  if (!match) return false;
  const [, q, yr] = match;
  const now = new Date();
  const currentQ = Math.ceil((now.getMonth() + 1) / 3);
  const currentYr = now.getFullYear();
  if (parseInt(yr) > currentYr) return true;
  if (parseInt(yr) === currentYr && parseInt(q) >= currentQ) return true;
  return false;
}

interface QuarterForecast {
  quarter: string;
  dealCount: number;
  grossAum: number;
  realizationRate: number;
  realizationLabel: string;
  componentA: number;
  componentB: number;
  totalForecast: number;
}

export function RealizationBanner({ pipeline, windowDays }: RealizationBannerProps) {
  const quarterForecasts = useMemo<QuarterForecast[]>(() => {
    // Filter to Neg+Signed deals with future anticipated dates
    const componentADeals = pipeline.filter(r =>
      (r.StageName === 'Negotiating' || r.StageName === 'Signed') &&
      r.Earliest_Anticipated_Start_Date__c
    );

    // Group by target quarter
    const byQuarter = new Map<string, { count: number; aum: number }>();
    for (const deal of componentADeals) {
      const quarter = getQuarterFromDate(deal.Earliest_Anticipated_Start_Date__c!);
      if (!quarter || !isCurrentOrFutureQuarter(quarter)) continue;
      const existing = byQuarter.get(quarter) || { count: 0, aum: 0 };
      existing.count += 1;
      existing.aum += deal.Opportunity_AUM_M * 1e6;
      byQuarter.set(quarter, existing);
    }

    // Build forecasts sorted by quarter
    const forecasts: QuarterForecast[] = [];
    const sortedQuarters = Array.from(byQuarter.keys()).sort((a, b) => {
      const [aq, ay] = a.replace('Q', '').split(' ').map(Number);
      const [bq, by] = b.replace('Q', '').split(' ').map(Number);
      return ay !== by ? ay - by : aq - bq;
    });

    for (const quarter of sortedQuarters) {
      const { count, aum } = byQuarter.get(quarter)!;
      const { rate, label } = getRealizationRate(count);
      const componentA = aum * rate;
      forecasts.push({
        quarter,
        dealCount: count,
        grossAum: aum,
        realizationRate: rate,
        realizationLabel: label,
        componentA,
        componentB: SURPRISE_BASELINE_AUM,
        totalForecast: componentA + SURPRISE_BASELINE_AUM,
      });
    }

    return forecasts;
  }, [pipeline]);

  if (quarterForecasts.length === 0) return null;

  return (
    <Card className="p-4 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp className="w-5 h-5 text-blue-600 dark:text-blue-400" />
        <Text className="font-semibold text-lg">Realization Forecast (Two-Component Model)</Text>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {quarterForecasts.map(qf => (
          <div key={qf.quarter} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
            <Text className="font-semibold text-base mb-2">{qf.quarter}</Text>

            {/* Component A */}
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Pipeline (Neg+Signed)</span>
                <span>{qf.dealCount} deals &middot; {formatAum(qf.grossAum)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">
                  Realization ({(qf.realizationRate * 100).toFixed(0)}%)
                </span>
                <span>{formatAum(qf.componentA)}</span>
              </div>
              <div className="text-xs text-gray-400 dark:text-gray-500 pl-2">
                Band: {qf.realizationLabel}
              </div>

              {/* Component B */}
              <div className="flex justify-between border-t border-gray-100 dark:border-gray-700 pt-1 mt-1">
                <span className="text-gray-500 dark:text-gray-400">Surprise baseline</span>
                <span>{formatAum(qf.componentB)}</span>
              </div>

              {/* Total */}
              <div className="flex justify-between border-t border-gray-200 dark:border-gray-600 pt-1 mt-1 font-semibold">
                <span>Forecast</span>
                <span className="text-blue-600 dark:text-blue-400">{formatAum(qf.totalForecast)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-start gap-1.5 mt-3 text-xs text-gray-400 dark:text-gray-500">
        <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
        <span>
          Two-component model (17% MAPE backtest). Component A = dated Neg+Signed deals &times; deal-count band rate.
          Component B = $398M trailing 4Q surprise baseline (PIT backtest; updated quarterly).
        </span>
      </div>
    </Card>
  );
}
```

## Step 1.2: Wire RealizationBanner into page.tsx

**File**: `src/app/dashboard/forecast/page.tsx`

Add import after the existing component imports (after line 25):
```typescript
import { RealizationBanner } from './components/RealizationBanner';
```

Insert the component after `ForecastMetricCards` closing tag (after line 370, before the grid div on line 372):
```typescript
              />

              <RealizationBanner
                pipeline={adjustedPipeline}
                windowDays={windowDays}
              />

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
```

**Note**: `adjustedPipeline` is `ForecastPipelineRecord[]` which already has `StageName`, `Opportunity_AUM_M`, `Earliest_Anticipated_Start_Date__c`, and `projected_quarter`. The `RealizationBanner` uses an inline interface that matches these fields — no import from server-only module needed.

## PHASE 1 — VALIDATION GATE

```bash
npx tsc --noEmit 2>&1 | head -30
```

**Expected**: Zero TypeScript errors. The new component uses only props already available in page.tsx.

```bash
# Verify the component exists and has the key constants
grep -n "SURPRISE_BASELINE_AUM\|REALIZATION_BANDS\|getRealizationRate" src/app/dashboard/forecast/components/RealizationBanner.tsx
```

**Expected**: All three constants/functions found.

```bash
# Verify page.tsx imports and renders RealizationBanner
grep -n "RealizationBanner" src/app/dashboard/forecast/page.tsx
```

**Expected**: Import line + JSX usage both present.

**STOP AND REPORT**: Tell the user:
- "Phase 1 complete — RealizationBanner component created and wired into page.tsx"
- "Component shows two-component forecast per quarter: Component A (Neg+Signed × band rate) + Component B ($398M surprise baseline)"
- "Ready to proceed to Phase 2 (What-If Panel)?"

---

# PHASE 2: What-If Panel Component

## Context
Create a pure client-side component with rate sliders, velocity (days-per-stage) sliders, and an AUM slider that let users adjust conversion rates, deal velocity, and mean joined AUM to see how Required SQOs changes in real time. For each target quarter, it also computes the **pipeline entry quarter** — the quarter in which SQOs must enter the funnel to realize AUM in the target quarter, based on total velocity. NO API calls, NO DB saves, NO Monte Carlo re-run. Just `useState` for overrides + `useMemo` for computation.

Follows the ScenarioRunner state pattern (lines 39-63 of ScenarioRunner.tsx) but skips everything after `handleRateChange`. Additionally adds velocity state and pipeline-entry-quarter projection that ScenarioRunner does not have.

## Step 2.1: Create WhatIfPanel.tsx

**File**: `src/app/dashboard/forecast/components/WhatIfPanel.tsx` (NEW)

```typescript
'use client';

import React, { useState, useMemo } from 'react';
import { Card, Text } from '@tremor/react';
import { SlidersHorizontal, ChevronDown, ChevronUp, RotateCcw, Clock, ArrowRight } from 'lucide-react';

// Inline rate shape — same as ForecastMetricCards (avoid importing server-only module)
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

interface WhatIfPanelProps {
  rates: RateShape | null;
  targetAumByQuarter: Record<string, number>;
}

const RATE_FIELDS: { key: 'sqo_to_sp' | 'sp_to_neg' | 'neg_to_signed' | 'signed_to_joined'; label: string }[] = [
  { key: 'sqo_to_sp', label: 'SQO → SP' },
  { key: 'sp_to_neg', label: 'SP → Neg' },
  { key: 'neg_to_signed', label: 'Neg → Signed' },
  { key: 'signed_to_joined', label: 'Signed → Joined' },
];

const DAYS_FIELDS: { key: 'avg_days_sqo_to_sp' | 'avg_days_in_sp' | 'avg_days_in_neg' | 'avg_days_in_signed'; label: string }[] = [
  { key: 'avg_days_sqo_to_sp', label: 'SQO → SP' },
  { key: 'avg_days_in_sp', label: 'In SP' },
  { key: 'avg_days_in_neg', label: 'In Neg' },
  { key: 'avg_days_in_signed', label: 'In Signed' },
];

function formatAum(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  if (value > 0) return `$${(value / 1e3).toFixed(0)}K`;
  return '$0';
}

/** Given a target quarter like "Q2 2026" and a velocity in days, return the quarter
 *  in which SQOs must enter pipeline to realize AUM in the target quarter.
 *  We subtract velocity days from the START of the target quarter. */
function getPipelineEntryQuarter(targetQuarter: string, velocityDays: number): string {
  const match = targetQuarter.match(/^Q(\d)\s+(\d{4})$/);
  if (!match) return targetQuarter;
  const q = parseInt(match[1]);
  const yr = parseInt(match[2]);
  // Start of target quarter
  const quarterStartMonth = (q - 1) * 3; // 0-indexed month
  const startDate = new Date(yr, quarterStartMonth, 1);
  // Subtract velocity to find when SQOs need to enter pipeline
  startDate.setDate(startDate.getDate() - velocityDays);
  const entryQ = Math.ceil((startDate.getMonth() + 1) / 3);
  return `Q${entryQ} ${startDate.getFullYear()}`;
}

function isQuarterPast(quarter: string): boolean {
  const match = quarter.match(/^Q(\d)\s+(\d{4})$/);
  if (!match) return false;
  const q = parseInt(match[1]);
  const yr = parseInt(match[2]);
  const now = new Date();
  const currentQ = Math.ceil((now.getMonth() + 1) / 3);
  const currentYr = now.getFullYear();
  if (yr < currentYr) return true;
  if (yr === currentYr && q < currentQ) return true;
  return false;
}

export function WhatIfPanel({ rates, targetAumByQuarter }: WhatIfPanelProps) {
  const [expanded, setExpanded] = useState(true);

  // Rate overrides — initialize from historical (same pattern as ScenarioRunner)
  const [overrides, setOverrides] = useState({
    sqo_to_sp: rates?.sqo_to_sp ?? 0,
    sp_to_neg: rates?.sp_to_neg ?? 0,
    neg_to_signed: rates?.neg_to_signed ?? 0,
    signed_to_joined: rates?.signed_to_joined ?? 0,
  });

  const [daysOverrides, setDaysOverrides] = useState({
    avg_days_sqo_to_sp: rates?.avg_days_sqo_to_sp ?? 0,
    avg_days_in_sp: rates?.avg_days_in_sp ?? 0,
    avg_days_in_neg: rates?.avg_days_in_neg ?? 0,
    avg_days_in_signed: rates?.avg_days_in_signed ?? 0,
  });

  const [meanAumOverride, setMeanAumOverride] = useState(rates?.mean_joined_aum ?? 0);

  // Re-sync when rates change (e.g., window toggle)
  React.useEffect(() => {
    if (rates) {
      setOverrides({
        sqo_to_sp: rates.sqo_to_sp,
        sp_to_neg: rates.sp_to_neg,
        neg_to_signed: rates.neg_to_signed,
        signed_to_joined: rates.signed_to_joined,
      });
      setDaysOverrides({
        avg_days_sqo_to_sp: rates.avg_days_sqo_to_sp,
        avg_days_in_sp: rates.avg_days_in_sp,
        avg_days_in_neg: rates.avg_days_in_neg,
        avg_days_in_signed: rates.avg_days_in_signed,
      });
      setMeanAumOverride(rates.mean_joined_aum);
    }
  }, [rates]);

  const handleRateChange = (key: keyof typeof overrides, value: number) => {
    if (value >= 0 && value <= 1) {
      setOverrides(prev => ({ ...prev, [key]: value }));
    }
  };

  const handleDaysChange = (key: keyof typeof daysOverrides, value: number) => {
    if (value >= 0 && value <= 365) {
      setDaysOverrides(prev => ({ ...prev, [key]: value }));
    }
  };

  const handleReset = () => {
    if (rates) {
      setOverrides({
        sqo_to_sp: rates.sqo_to_sp,
        sp_to_neg: rates.sp_to_neg,
        neg_to_signed: rates.neg_to_signed,
        signed_to_joined: rates.signed_to_joined,
      });
      setDaysOverrides({
        avg_days_sqo_to_sp: rates.avg_days_sqo_to_sp,
        avg_days_in_sp: rates.avg_days_in_sp,
        avg_days_in_neg: rates.avg_days_in_neg,
        avg_days_in_signed: rates.avg_days_in_signed,
      });
      setMeanAumOverride(rates.mean_joined_aum);
    }
  };

  const totalVelocityDays = useMemo(() =>
    Math.round(daysOverrides.avg_days_sqo_to_sp + daysOverrides.avg_days_in_sp + daysOverrides.avg_days_in_neg + daysOverrides.avg_days_in_signed),
  [daysOverrides]);

  const currentTotalVelocityDays = useMemo(() =>
    rates ? Math.round(rates.avg_days_sqo_to_sp + rates.avg_days_in_sp + rates.avg_days_in_neg + rates.avg_days_in_signed) : 0,
  [rates]);

  // Pure client-side computation — no API call
  const { sqoToJoinedRate, expectedAumPerSqo, currentSqoToJoinedRate, currentExpectedAumPerSqo } = useMemo(() => {
    const overrideProduct = overrides.sqo_to_sp * overrides.sp_to_neg * overrides.neg_to_signed * overrides.signed_to_joined;
    const currentProduct = rates
      ? rates.sqo_to_sp * rates.sp_to_neg * rates.neg_to_signed * rates.signed_to_joined
      : 0;
    return {
      sqoToJoinedRate: overrideProduct,
      expectedAumPerSqo: meanAumOverride * overrideProduct,
      currentSqoToJoinedRate: currentProduct,
      currentExpectedAumPerSqo: (rates?.mean_joined_aum ?? 0) * currentProduct,
    };
  }, [overrides, meanAumOverride, rates]);

  // Compute required SQOs per quarter with velocity-based pipeline entry quarter
  const quarterResults = useMemo(() => {
    const quarters = Object.entries(targetAumByQuarter)
      .filter(([, v]) => v > 0)
      .sort(([a], [b]) => {
        const [aq, ay] = a.replace('Q', '').split(' ').map(Number);
        const [bq, by] = b.replace('Q', '').split(' ').map(Number);
        return ay !== by ? ay - by : aq - bq;
      });

    return quarters.map(([quarter, target]) => {
      const scenarioSqos = expectedAumPerSqo > 0 ? Math.ceil(target / expectedAumPerSqo) : 0;
      const currentSqos = currentExpectedAumPerSqo > 0 ? Math.ceil(target / currentExpectedAumPerSqo) : 0;
      const delta = scenarioSqos - currentSqos;
      const entryQuarter = getPipelineEntryQuarter(quarter, totalVelocityDays);
      const entryQuarterPast = isQuarterPast(entryQuarter);
      return { quarter, target, scenarioSqos, currentSqos, delta, entryQuarter, entryQuarterPast };
    });
  }, [targetAumByQuarter, expectedAumPerSqo, currentExpectedAumPerSqo, totalVelocityDays]);

  if (!rates) return null;

  const hasRateChanges = overrides.sqo_to_sp !== rates.sqo_to_sp ||
    overrides.sp_to_neg !== rates.sp_to_neg ||
    overrides.neg_to_signed !== rates.neg_to_signed ||
    overrides.signed_to_joined !== rates.signed_to_joined;

  const hasDaysChanges = daysOverrides.avg_days_sqo_to_sp !== rates.avg_days_sqo_to_sp ||
    daysOverrides.avg_days_in_sp !== rates.avg_days_in_sp ||
    daysOverrides.avg_days_in_neg !== rates.avg_days_in_neg ||
    daysOverrides.avg_days_in_signed !== rates.avg_days_in_signed;

  const hasChanges = hasRateChanges || hasDaysChanges || meanAumOverride !== rates.mean_joined_aum;

  return (
    <Card className="p-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full"
      >
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="w-4 h-4 text-indigo-500" />
          <Text className="font-semibold">What-If SQO Calculator</Text>
          {hasChanges && !expanded && (
            <span className="text-xs bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.5 rounded">
              Modified
            </span>
          )}
        </div>
        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {expanded && (
        <div className="mt-4 space-y-4">
          {/* Rate sliders */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Text className="text-sm font-medium">Stage Conversion Rates</Text>
              {hasChanges && (
                <button
                  onClick={handleReset}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                >
                  <RotateCcw className="w-3 h-3" /> Reset all
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {RATE_FIELDS.map(({ key, label }) => {
                const current = rates[key];
                const override = overrides[key];
                const changed = Math.abs(override - current) > 0.001;
                return (
                  <div key={key} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500 dark:text-gray-400">{label}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400">Period: {(current * 100).toFixed(1)}%</span>
                        <span className={changed ? 'text-indigo-600 dark:text-indigo-400 font-medium' : ''}>
                          {(override * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={override}
                      onChange={e => handleRateChange(key, parseFloat(e.target.value))}
                      className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    />
                    <div className="flex justify-between text-[10px] text-gray-400">
                      <span>0%</span>
                      <span>100%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Velocity sliders */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-3.5 h-3.5 text-gray-400" />
              <Text className="text-sm font-medium">Deal Velocity (days per stage)</Text>
              <span className="text-xs text-gray-400 ml-auto">
                Total: <span className={`font-medium ${totalVelocityDays !== currentTotalVelocityDays ? 'text-indigo-600 dark:text-indigo-400' : ''}`}>
                  {totalVelocityDays}d
                </span>
                {totalVelocityDays !== currentTotalVelocityDays && (
                  <span className="text-gray-400 ml-1">(period: {currentTotalVelocityDays}d)</span>
                )}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {DAYS_FIELDS.map(({ key, label }) => {
                const current = rates[key];
                const override = daysOverrides[key];
                const changed = Math.abs(override - current) > 0.5;
                return (
                  <div key={key} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500 dark:text-gray-400">{label}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400">Period: {Math.round(current)}d</span>
                        <span className={changed ? 'text-indigo-600 dark:text-indigo-400 font-medium' : ''}>
                          {Math.round(override)}d
                        </span>
                      </div>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={180}
                      step={1}
                      value={override}
                      onChange={e => handleDaysChange(key, parseFloat(e.target.value))}
                      className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    />
                    <div className="flex justify-between text-[10px] text-gray-400">
                      <span>0d</span>
                      <span>180d</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Mean AUM slider */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-gray-500 dark:text-gray-400">Mean Joined AUM</span>
              <div className="flex items-center gap-2">
                <span className="text-gray-400">Period: {formatAum(rates.mean_joined_aum)}</span>
                <span className={meanAumOverride !== rates.mean_joined_aum ? 'text-indigo-600 dark:text-indigo-400 font-medium' : ''}>
                  {formatAum(meanAumOverride)}
                </span>
              </div>
            </div>
            <input
              type="range"
              min={10_000_000}
              max={200_000_000}
              step={5_000_000}
              value={meanAumOverride}
              onChange={e => setMeanAumOverride(parseFloat(e.target.value))}
              className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
            />
            <div className="flex justify-between text-[10px] text-gray-400">
              <span>$10M</span>
              <span>$200M</span>
            </div>
          </div>

          {/* Computed results */}
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 space-y-2">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <Text className="text-xs text-gray-500">SQO → Joined Rate</Text>
                <p className={`font-semibold ${sqoToJoinedRate !== currentSqoToJoinedRate ? 'text-indigo-600 dark:text-indigo-400' : ''}`}>
                  {(sqoToJoinedRate * 100).toFixed(1)}%
                </p>
                <p className="text-[10px] text-gray-400">Period: {(currentSqoToJoinedRate * 100).toFixed(1)}%</p>
              </div>
              <div>
                <Text className="text-xs text-gray-500">Expected AUM per SQO</Text>
                <p className={`font-semibold ${expectedAumPerSqo !== currentExpectedAumPerSqo ? 'text-indigo-600 dark:text-indigo-400' : ''}`}>
                  {formatAum(expectedAumPerSqo)}
                </p>
                <p className="text-[10px] text-gray-400">Period: {formatAum(currentExpectedAumPerSqo)}</p>
              </div>
              <div>
                <Text className="text-xs text-gray-500">SQO → Joined Velocity</Text>
                <p className={`font-semibold ${totalVelocityDays !== currentTotalVelocityDays ? 'text-indigo-600 dark:text-indigo-400' : ''}`}>
                  ~{totalVelocityDays} days
                </p>
                <p className="text-[10px] text-gray-400">Period: ~{currentTotalVelocityDays}d</p>
              </div>
            </div>

            {/* Per-quarter required SQOs with pipeline entry quarter */}
            {quarterResults.length > 0 && (
              <div className="border-t border-gray-200 dark:border-gray-700 pt-2 mt-2">
                <Text className="text-xs text-gray-500 mb-2">Required SQOs by Quarter (velocity-adjusted)</Text>
                <div className="space-y-2">
                  {quarterResults.map(qr => (
                    <div key={qr.quarter} className="border border-gray-200 dark:border-gray-700 rounded p-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{qr.quarter} — {formatAum(qr.target)} target</span>
                        <span>
                          <span className={`font-semibold ${qr.delta !== 0 ? (qr.delta < 0 ? 'text-green-600' : 'text-red-600') : ''}`}>
                            {qr.scenarioSqos} SQOs needed
                          </span>
                          {qr.delta !== 0 && (
                            <span className="text-xs text-gray-400 ml-1">
                              ({qr.delta > 0 ? '+' : ''}{qr.delta} vs current {qr.currentSqos})
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 text-xs">
                        <ArrowRight className="w-3 h-3 text-gray-400" />
                        <span className={qr.entryQuarterPast ? 'text-red-500 font-medium' : 'text-gray-500'}>
                          SQOs must enter pipeline in <span className="font-medium">{qr.entryQuarter}</span>
                        </span>
                        <span className="text-gray-400">
                          (~{totalVelocityDays}d velocity to realize in {qr.quarter})
                        </span>
                        {qr.entryQuarterPast && (
                          <span className="text-red-500 font-medium ml-1">— already past</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
```

## Step 2.2: Wire WhatIfPanel into page.tsx

**File**: `src/app/dashboard/forecast/page.tsx`

Add import (add to the existing imports section, after RealizationBanner):
```typescript
import { WhatIfPanel } from './components/WhatIfPanel';
```

Insert between MonteCarloPanel and ScenarioRunner (after line 383, before line 385):
```typescript
              )}

              <WhatIfPanel
                rates={rates?.flat ?? null}
                targetAumByQuarter={targetAumByQuarter}
              />

              {canRunScenarios && (
```

## PHASE 2 — VALIDATION GATE

```bash
npx tsc --noEmit 2>&1 | head -30
```

**Expected**: Zero TypeScript errors.

```bash
grep -n "WhatIfPanel\|what-if" src/app/dashboard/forecast/page.tsx
```

**Expected**: Import + JSX usage both present.

```bash
# Verify velocity and pipeline-entry-quarter features are present
grep -n "daysOverrides\|getPipelineEntryQuarter\|totalVelocityDays\|DAYS_FIELDS\|isQuarterPast\|entryQuarter" src/app/dashboard/forecast/components/WhatIfPanel.tsx
```

**Expected**: All velocity-related state, helpers, and computed fields found.

**STOP AND REPORT**: Tell the user:
- "Phase 2 complete — WhatIfPanel component with rate sliders + velocity sliders + AUM slider, pure client-side computation"
- "Sliders default to current trailing rates and days, recalculate Required SQOs in real time when adjusted"
- "Each quarter shows the pipeline entry quarter — when SQOs must enter the funnel to realize AUM in the target quarter"
- "Past pipeline entry quarters are highlighted red with 'already past' warning"
- "Every slider and metric shows static 'Period: X' reference alongside the dynamic override"
- "Ready to proceed to Phase 3 (Named Range Extension)?"

---

# PHASE 3: Named Range Extension in Rates Tab

## Context
The Scenario Runner Sheets tab (Phase 5) needs to reference `mean_joined_aum`, `cohort_count`, and avg_days values from the Rates tab via named ranges. Currently only 13 named ranges exist (stage conversion rates). We need to add 6 more.

**Critical sync rule**: Named ranges are defined in TWO places that must stay in sync:
1. The `namedRanges` array in the POST handler (route.ts lines 1039-1056) — actually creates the ranges via API
2. The Named Ranges Reference section in `buildRatesAndDaysValues` output (route.ts lines 866-882) — informational display in the sheet

**Strategy**: Add new rows at the END of the existing Rates tab sections to avoid shifting existing named range row offsets. The avg_days values already exist at rows 30-34. We need to add mean_joined_aum and cohort_count as new rows.

## Step 3.1: Add new rows to buildRatesAndDaysValues

**File**: `src/app/api/forecast/export/route.ts`

The function signature needs to change to accept flatRates so we can output mean_joined_aum and cohort_count values:

Change the function signature from:
```typescript
function buildRatesAndDaysValues(auditRowCount: number): any[][] {
```
To:
```typescript
function buildRatesAndDaysValues(auditRowCount: number, flatRates?: ForecastRates): any[][] {
```

Then, in the return array, AFTER the "Total SQO → Joined" row (row 34, which is `'=SUM(B30:B33)'`) and BEFORE the empty array `[]` that precedes the Named Ranges Reference section (currently at line 864), add a new section:

```typescript
    // AFTER the Total SQO→Joined row (currently line 863), BEFORE the [] on line 864:
    [],

    // Section 5b: Additional Named-Range Values (rows 36-38)
    // These rows exist so they can be referenced as named ranges by the Scenario Runner tab
    ['ADDITIONAL VALUES', '', '', '', ''],
    ['Metric', 'Value', '', '', 'Description'],
    [
      'Mean Joined AUM ($)',
      flatRates?.mean_joined_aum ?? 0,
      '',
      '',
      `Average AUM of ${flatRates?.joined_deal_count ?? 0} joined deals in trailing window`,
    ],
    [
      'Cohort Count',
      flatRates?.cohort_count ?? 0,
      '',
      '',
      'Total resolved SQOs in trailing window (rate cohort)',
    ],
    [],
```

**Row layout after change**:
- Row 35 (existing): empty separator
- Row 36: "ADDITIONAL VALUES" header
- Row 37: column headers
- Row 38: mean_joined_aum (Col B) ← **named range target**
- Row 39: cohort_count (Col B) ← **named range target**
- Row 40: empty separator
- Row 41+: Named Ranges Reference (shifted down from old rows)

**IMPORTANT**: The avg_days values are already at rows 30-33, with totals at row 34. Named ranges for avg_days_* point to existing cells. The new named ranges for avg_days_* point to the EXISTING avg_days rows:
- B30 = avg_days SQO→SP (existing)
- B31 = avg_days in SP (existing)
- B32 = avg_days in Neg (existing)
- B33 = avg_days in Signed (existing)

## Step 3.2: Update the Named Ranges Reference section

In the Named Ranges Reference section (currently starting at line 866), add entries for the 6 new named ranges AFTER the existing 13 entries:

```typescript
    ['B38', 'mean_joined_aum', 'BQ Scenario Runner — Mean Joined AUM'],
    ['B39', 'cohort_count', 'BQ Scenario Runner — Cohort Count'],
    ['B30', 'avg_days_sqo_to_sp', 'BQ Scenario Runner — Avg Days SQO→SP'],
    ['B31', 'avg_days_in_sp', 'BQ Scenario Runner — Avg Days in SP'],
    ['B32', 'avg_days_in_neg', 'BQ Scenario Runner — Avg Days in Neg'],
    ['B33', 'avg_days_in_signed', 'BQ Scenario Runner — Avg Days in Signed'],
```

## Step 3.3: Add 6 new named range entries to the namedRanges array

**File**: `src/app/api/forecast/export/route.ts` (lines 1039-1056)

Add after the existing 13 entries in the `namedRanges` array:

```typescript
          // Additional named ranges for Scenario Runner tab
          // mean_joined_aum and cohort_count are in the new "Additional Values" section
          { name: 'mean_joined_aum', row: 37, col: 1 },     // B38 (0-indexed row 37)
          { name: 'cohort_count', row: 38, col: 1 },         // B39 (0-indexed row 38)
          // Avg days already exist in the Days section (rows 30-33)
          { name: 'avg_days_sqo_to_sp', row: 29, col: 1 },   // B30 (0-indexed row 29)
          { name: 'avg_days_in_sp', row: 30, col: 1 },       // B31 (0-indexed row 30)
          { name: 'avg_days_in_neg', row: 31, col: 1 },      // B32 (0-indexed row 31)
          { name: 'avg_days_in_signed', row: 32, col: 1 },   // B33 (0-indexed row 32)
```

**CRITICAL**: The 0-indexed row numbers depend on the FINAL row positions in the buildRatesAndDaysValues output. After adding the new section, **count the actual rows from the top of the array** to confirm these offsets. The avg_days rows at B30-B33 should have 0-indexed offsets 29-32. The new mean_joined_aum and cohort_count rows depend on exactly how many rows precede them.

To verify: the `buildRatesAndDaysValues` return array currently has:
- Rows 1-3: Title (3 elements)
- Row 4-5: Flat header (2)
- Rows 6-10: Flat rates (5)
- Row 11: empty (1)
- Row 12-13: Lower header (2)
- Rows 14-18: Lower rates (5)
- Row 19: empty (1)
- Row 20-21: Upper header (2)
- Rows 22-26: Upper rates (5)
- Row 27: empty (1)
- Row 28-29: Days header (2)
- Rows 30-33: Days values (4)
- Row 34: Total days (1)
- Row 35: empty (1) — NEW
- Row 36: Additional header (1) — NEW
- Row 37: Additional col headers (1) — NEW
- Row 38: mean_joined_aum (1) — NEW → 0-indexed = 37
- Row 39: cohort_count (1) — NEW → 0-indexed = 38

So the named range offsets are correct: `row: 37` for mean_joined_aum (B38), `row: 38` for cohort_count (B39).

## Step 3.4: Update the caller to pass flatRates

**File**: `src/app/api/forecast/export/route.ts` (line 1005)

Change:
```typescript
    const ratesValues = buildRatesAndDaysValues(auditRows.length);
```
To:
```typescript
    const ratesValues = buildRatesAndDaysValues(auditRows.length, tieredRates.flat);
```

## PHASE 3 — VALIDATION GATE

```bash
npx tsc --noEmit 2>&1 | head -30
```

**Expected**: Zero TypeScript errors.

```bash
# Verify the namedRanges array now has 19 entries (13 existing + 6 new)
grep -c "name:" src/app/api/forecast/export/route.ts
```

```bash
# Verify new named range names exist
grep "mean_joined_aum\|cohort_count\|avg_days_sqo_to_sp\|avg_days_in_sp\|avg_days_in_neg\|avg_days_in_signed" src/app/api/forecast/export/route.ts
```

**Expected**: Each name appears in both the namedRanges array AND the Named Ranges Reference section.

**STOP AND REPORT**: Tell the user:
- "Phase 3 complete — 6 new named ranges added to Rates tab (mean_joined_aum, cohort_count, 4 avg_days)"
- "Named ranges reference section updated. 19 total named ranges (was 13)."
- "Ready to proceed to Phase 4 (Realization Forecast Sheet tab)?"

---

# PHASE 4: Realization Forecast Sheets Tab

## Context
A new "BQ Realization Forecast" tab with 3 sections:
- **Section 1 (rows 1-12)**: Forecast summary per quarter — COUNTIF/SUMIFS referencing Section 2
- **Section 2 (rows 15+)**: Component A deal detail — one row per Neg+Signed deal with future date
- **Section 3 (bottom)**: Component B history — hardcoded $398M baseline with note

**Build order**: Section 2 first (need row count), then Section 1 formulas, then push Section 1 first into the array (same pattern as `buildMonteCarloValues` lines 363-373).

## Step 4.1: Add tab constant

**File**: `src/app/api/forecast/export/route.ts` (after line 23)

```typescript
const REALIZATION_TAB = 'BQ Realization Forecast';
```

## Step 4.2: Implement buildRealizationValues

**File**: `src/app/api/forecast/export/route.ts` (after `buildSQOTargetsValues`, before `buildRatesAndDaysValues`)

```typescript
// Build the "BQ Realization Forecast" tab — two-component quarterly forecast
// with deal-level detail. Every number traceable to deal-level data via formulas.
//
// Section 1: Forecast summary per quarter (COUNTIF/SUMIFS reference Section 2)
// Section 2: Component A deal detail (one row per Neg+Signed deal with future date)
// Section 3: Component B history (hardcoded $398M surprise baseline from PIT backtest)
//
// Two-component model reference: docs/forecast/forecast_modeling_backtest_results.md, Part 4
function buildRealizationValues(
  p2Rows: any[],
  flatRates: ForecastRates,
  dateRevisionMap?: Map<string, { revisionCount: number; firstDateSet: string | null; dateConfidence: string }>,
): any[][] {
  // ── Constants ──
  // Component B surprise baseline: trailing 4Q average from PIT backtest.
  // Cannot be computed from vw_funnel_master (anticipated dates overwritten post-join).
  // Derived via OpportunityFieldHistory reconstruction. Update quarterly.
  const SURPRISE_BASELINE = 398_000_000;

  // Deal-count realization bands (backtest Part 4, "Deal-count bands" section):
  // <10 deals = 60%, 10-14 = 45%, 15+ = 35%
  const getBandRate = (count: number) =>
    count < 10 ? 0.60 : count <= 14 ? 0.45 : 0.35;
  const getBandLabel = (count: number) =>
    count < 10 ? '<10 deals (60%)' : count <= 14 ? '10-14 deals (45%)' : '15+ deals (35%)';

  // ── Build Section 2 first (deal detail) ──
  // Filter to Neg+Signed deals with future anticipated dates
  const now = new Date();
  const currentQ = Math.ceil((now.getMonth() + 1) / 3);
  const currentYear = now.getFullYear();

  const isCurrentOrFutureQ = (dateStr: string) => {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return false;
    const q = Math.ceil((d.getMonth() + 1) / 3);
    const yr = d.getFullYear();
    if (yr > currentYear) return true;
    if (yr === currentYear && q >= currentQ) return true;
    return false;
  };

  const toQuarterLabel = (dateStr: string) => {
    const d = new Date(dateStr);
    return `Q${Math.ceil((d.getMonth() + 1) / 3)} ${d.getFullYear()}`;
  };

  const componentADeals = p2Rows
    .filter((r: any) =>
      (r.StageName === 'Negotiating' || r.StageName === 'Signed') &&
      r.Earliest_Anticipated_Start_Date__c &&
      isCurrentOrFutureQ(r.Earliest_Anticipated_Start_Date__c)
    )
    .map((r: any) => ({
      oppId: r.Full_Opportunity_ID__c || '',
      advisor: r.advisor_name || '',
      stage: r.StageName,
      aum: r.Opportunity_AUM || 0, // raw dollars (not _M)
      anticipatedDate: r.Earliest_Anticipated_Start_Date__c,
      targetQuarter: toQuarterLabel(r.Earliest_Anticipated_Start_Date__c),
      dateConfidence: dateRevisionMap?.get(r.Full_Opportunity_ID__c)?.dateConfidence ?? '',
      dateRevisions: dateRevisionMap?.get(r.Full_Opportunity_ID__c)?.revisionCount ?? '',
      durationBucket: r.durationBucket || '',
    }))
    .sort((a: any, b: any) => {
      // Sort by quarter first, then AUM descending
      if (a.targetQuarter !== b.targetQuarter) return a.targetQuarter < b.targetQuarter ? -1 : 1;
      return b.aum - a.aum;
    });

  // Get unique quarters for Section 1
  const quarterSet = new Set(componentADeals.map((d: any) => d.targetQuarter));
  const quarters = Array.from(quarterSet).sort((a, b) => {
    const [aq, ay] = a.replace('Q', '').split(' ').map(Number);
    const [bq, by] = b.replace('Q', '').split(' ').map(Number);
    return ay !== by ? ay - by : aq - bq;
  });

  // Per-quarter stats for hardcoded display values
  const quarterStats = new Map<string, { count: number; aum: number }>();
  for (const deal of componentADeals) {
    const existing = quarterStats.get(deal.targetQuarter) || { count: 0, aum: 0 };
    existing.count += 1;
    existing.aum += deal.aum;
    quarterStats.set(deal.targetQuarter, existing);
  }

  // ── Section 2 rows ──
  const sec2Header = [
    'Opp ID', 'Advisor', 'Stage', 'AUM ($)', 'Anticipated Date',
    'Target Quarter', 'Date Confidence', 'Date Revisions', 'Duration Bucket',
  ];
  const sec2DataRows = componentADeals.map((d: any) => [
    d.oppId,
    d.advisor,
    d.stage,
    d.aum,
    d.anticipatedDate ? new Date(d.anticipatedDate).toISOString().split('T')[0] : '',
    d.targetQuarter,
    d.dateConfidence,
    d.dateRevisions,
    d.durationBucket,
  ]);

  // Section 2 starts at row = Section 1 size + blank row + detail title row + header row
  // We'll compute this after building Section 1
  const sec1RowCount = 3 + 1 + 1 + quarters.length + 1; // title(1) + subtitle(1) + blank(1) + header(1) + col headers(1) + quarter rows + blank separator
  const sec2TitleRow = sec1RowCount + 1; // 1-indexed
  const sec2HeaderRow = sec2TitleRow + 1;
  const sec2Start = sec2HeaderRow + 1; // first data row
  const sec2End = sec2Start + sec2DataRows.length - 1;

  // ── Section 1 rows (summary) ──
  // Formulas reference Section 2 ranges
  const sec1Rows: any[][] = [
    // Row 1
    ['REALIZATION FORECAST — TWO-COMPONENT MODEL'],
    // Row 2
    [`Generated: ${new Date().toISOString().split('T')[0]} | Deal-count band realization rates | Component B = $398M trailing 4Q surprise baseline (PIT backtest)`],
    // Row 3
    [],
    // Row 4
    ['FORECAST SUMMARY'],
    // Row 5 (column headers)
    [
      'Quarter',                      // A
      'Neg+Signed Dated Deals',       // B: COUNTIF
      'Component A AUM ($)',           // C: SUMIFS
      'Realization Band',             // D: IF-based band
      'Pipeline Contribution ($)',     // E: C × D
      'Surprise Baseline ($)',         // F: constant
      'Total Forecast ($)',            // G: E + F
    ],
  ];

  // Quarter rows with formulas
  for (const quarter of quarters) {
    const row = sec1Rows.length + 1; // 1-indexed
    const stats = quarterStats.get(quarter)!;
    const bandRate = getBandRate(stats.count);
    const bandLabel = getBandLabel(stats.count);

    sec1Rows.push([
      quarter,                                                                        // A
      `=COUNTIF(F${sec2Start}:F${sec2End},"${quarter}")`,                            // B
      `=SUMIFS(D${sec2Start}:D${sec2End},F${sec2Start}:F${sec2End},"${quarter}")`,   // C
      `=IF(B${row}<10,0.6,IF(B${row}<=14,0.45,0.35))`,                              // D: band formula
      `=C${row}*D${row}`,                                                             // E
      SURPRISE_BASELINE,                                                               // F
      `=E${row}+F${row}`,                                                             // G
    ]);
  }
  sec1Rows.push([]); // blank separator

  // ── Assemble: Section 1, then Section 2, then Section 3 ──
  const values: any[][] = [...sec1Rows];

  // Section 2: deal detail
  values.push(['COMPONENT A — DEAL DETAIL (Neg+Signed with future anticipated dates)']);
  values.push(sec2Header);
  for (const row of sec2DataRows) {
    values.push(row);
  }
  values.push([]);

  // Section 3: Component B history
  values.push(['COMPONENT B — SURPRISE BASELINE']);
  values.push([
    'The surprise baseline is $398M — the trailing 4-quarter average of AUM that joined without being',
  ]);
  values.push([
    'a Neg/Signed deal with an anticipated date at quarter start. This value was derived from a point-in-time',
  ]);
  values.push([
    'backtest using OpportunityFieldHistory (see forecast_modeling_backtest_results.md, Part 4).',
  ]);
  values.push([
    'It CANNOT be computed from vw_funnel_master because Earliest_Anticipated_Start_Date__c is overwritten',
  ]);
  values.push([
    'post-join (73% of joined deals have anticipated date = actual join date). Update quarterly.',
  ]);
  values.push([]);
  values.push(['Quarter', 'Surprise AUM (from backtest)', 'Notes']);
  values.push(['Q1 2025', 278_000_000, 'Total $463M - Component A $185M']);
  values.push(['Q2 2025', 472_000_000, 'Total $578M - Component A $106M']);
  values.push(['Q3 2025', 276_000_000, 'Total $765M - Component A $489M']);
  values.push(['Q4 2025', 568_000_000, 'Total $1,318M - Component A $750M']);
  values.push(['Trailing 4Q Average', `=AVERAGE(B${values.length - 3}:B${values.length})`, 'Used as Component B baseline']);
  values.push([]);

  // Methodology
  values.push(['MODEL METHODOLOGY']);
  values.push(['Forecast = (Component A × Realization Rate) + Component B']);
  values.push(['Component A = AUM of Neg+Signed deals whose anticipated start date falls in the target quarter']);
  values.push(['Realization Rate = deal-count band: <10 deals → 60%, 10-14 → 45%, 15+ → 35%']);
  values.push(['Component B = trailing 4Q average of "surprise" AUM (joined deals NOT in Component A at quarter start)']);
  values.push(['Backtest MAPE: 17% across Q1-Q4 2025 (8x more accurate than probability model)']);

  return values;
}
```

## Step 4.3: Wire into the export POST handler

**File**: `src/app/api/forecast/export/route.ts`

After the `sqoTargetsValues` build (around line 1013), add:
```typescript
    const realizationValues = buildRealizationValues(p2Rows, tieredRates.flat, dateRevisionMap);
```

After `writeTab(sheets, newSheetId, SQO_TARGETS_TAB, sqoTargetsValues)` (around line 1083), add:
```typescript
    await writeTab(sheets, newSheetId, REALIZATION_TAB, realizationValues);
    console.log(`[Forecast Export] Realization Forecast tab written`);
```

## PHASE 4 — VALIDATION GATE

```bash
npx tsc --noEmit 2>&1 | head -30
```

**Expected**: Zero TypeScript errors.

```bash
grep -n "REALIZATION_TAB\|buildRealizationValues\|SURPRISE_BASELINE" src/app/api/forecast/export/route.ts
```

**Expected**: Tab constant, builder function definition, builder call, writeTab call, and SURPRISE_BASELINE constant all present.

**STOP AND REPORT**: Tell the user:
- "Phase 4 complete — BQ Realization Forecast Sheets tab with 3 sections"
- "Section 1 uses COUNTIF/SUMIFS formulas referencing deal detail in Section 2"
- "Section 3 explains Component B $398M baseline with source provenance"
- "Ready to proceed to Phase 5 (Scenario Runner Sheet tab)?"

---

# PHASE 5: Scenario Runner Sheets Tab

## Context
A new "BQ Scenario Runner" tab with 4 sections:
- **Section 1**: Current trailing rates (read-only, references named ranges from Rates tab)
- **Section 2**: Scenario inputs (editable — user types their own rate/AUM/days values)
- **Section 3**: Target analysis (Required SQOs under both current and scenario rates, with **velocity-based pipeline entry quarter** — which quarter SQOs must enter the funnel to realize AUM in the target quarter, and whether that quarter is already past)
- **Section 4**: Sensitivity matrix (Required SQOs at different rate × AUM combinations)

Key design: Section 1 uses named range references, Section 2 has literal default values that users can edit (including days-per-stage for velocity), Section 3 computes scenario vs current with a delta column plus pipeline entry quarter using DATE arithmetic formulas that respond to Section 2 edits.

## Step 5.1: Add tab constant

**File**: `src/app/api/forecast/export/route.ts` (after REALIZATION_TAB)

```typescript
const SCENARIO_TAB = 'BQ Scenario Runner';
```

## Step 5.2: Implement buildScenarioRunnerValues

**File**: `src/app/api/forecast/export/route.ts` (after `buildRealizationValues`)

```typescript
// Build the "BQ Scenario Runner" tab — leadership what-if analysis
// Section 1: Current trailing rates (named range refs, read-only)
// Section 2: Scenario inputs (editable cells)
// Section 3: Target analysis (scenario vs current SQO comparison)
// Section 4: Sensitivity matrix (required SQOs at different rate × AUM combos)
// realizationRowRange: the row range in the BQ Realization Forecast tab where
// Section 1 quarter summary rows live (e.g., "A6:H8" for 3 quarters).
// Column A = quarter label, Column H = Total Forecast ($).
// (Column D = readable band label, Column E = numeric rate — added for readability.)
// This lets Section 3 VLOOKUP into the Realization tab for full cross-tab traceability.
function buildScenarioRunnerValues(
  flatRates: ForecastRates,
  targetAumByQuarter: Record<string, number>,
  realizationRowRange: string,
): any[][] {
  const values: any[][] = [];
  const rTab = `'BQ Realization Forecast'`;

  const sqoToJoinedRate = flatRates.sqo_to_sp * flatRates.sp_to_neg * flatRates.neg_to_signed * flatRates.signed_to_joined;
  const avgDaysTotal = flatRates.avg_days_sqo_to_sp + flatRates.avg_days_in_sp + flatRates.avg_days_in_neg + flatRates.avg_days_in_signed;

  // ── Section 1: Current Trailing Rates (rows 1-10) ──
  values.push(['SCENARIO RUNNER — WHAT-IF ANALYSIS']);
  values.push([`Generated: ${new Date().toISOString().split('T')[0]} | Section 1 is read-only (references Rates tab). Edit Section 2 to run scenarios.`]);
  values.push([]);

  // Row 4
  values.push(['CURRENT TRAILING RATES (from Rates tab)', '', '']);
  // Row 5 (column headers)
  values.push(['Transition', 'Current Rate', 'Current Avg Days']);
  // Row 6
  values.push(['SQO \u2192 SP', '=SQO_to_SP_rate', '=avg_days_sqo_to_sp']);
  // Row 7
  values.push(['SP \u2192 Neg', '=SP_to_Neg_rate', '=avg_days_in_sp']);
  // Row 8
  values.push(['Neg \u2192 Signed', '=Neg_to_Signed_rate', '=avg_days_in_neg']);
  // Row 9
  values.push(['Signed \u2192 Joined', '=Signed_to_Joined_rate', '=avg_days_in_signed']);
  // Row 10
  values.push(['SQO \u2192 Joined (product)', '=B6*B7*B8*B9', '=SUM(C6:C9)']);
  // Row 11
  values.push(['Mean Joined AUM ($)', '=mean_joined_aum', '']);
  // Row 12
  values.push(['Cohort Size', '=cohort_count', '']);
  values.push([]);

  // ── Section 2: Scenario Inputs (rows 14-23) ──
  // Row 14
  values.push(['SCENARIO INPUTS (\u2190 edit these cells)', '', '']);
  // Row 15
  values.push(['Transition', 'Scenario Rate', 'Scenario Days']);
  // Row 16 — default to current rates (user can edit)
  values.push(['SQO \u2192 SP', flatRates.sqo_to_sp, Math.round(flatRates.avg_days_sqo_to_sp)]);
  // Row 17
  values.push(['SP \u2192 Neg', flatRates.sp_to_neg, Math.round(flatRates.avg_days_in_sp)]);
  // Row 18
  values.push(['Neg \u2192 Signed', flatRates.neg_to_signed, Math.round(flatRates.avg_days_in_neg)]);
  // Row 19
  values.push(['Signed \u2192 Joined', flatRates.signed_to_joined, Math.round(flatRates.avg_days_in_signed)]);
  // Row 20
  values.push(['SQO \u2192 Joined (product)', '=B16*B17*B18*B19', '=SUM(C16:C19)']);
  // Row 21
  values.push(['Mean Joined AUM ($)', flatRates.mean_joined_aum, '']);
  // Row 22
  values.push(['Expected AUM per SQO ($)', '=B21*B20', '']);
  values.push([]);

  // ── Section 3: Target Analysis (rows 24+) ──
  // This section includes velocity-based pipeline entry quarter projection.
  // For each target quarter, we compute which quarter SQOs must ENTER pipeline
  // to realize AUM in the target quarter, based on total SQO→Joined velocity.
  // Uses DATE arithmetic formulas so the entry quarter updates when the user
  // edits scenario days in Section 2.
  values.push(['TARGET ANALYSIS — SCENARIO vs CURRENT (velocity-adjusted)', '', '', '', '', '', '', '', '', '', '', '', '', '']);
  // Column headers (next row)
  const targetHeaderRow = values.length + 1;
  values.push([
    'Quarter',                          // A
    'Target AUM ($)',                    // B
    'Realization Forecast ($)',          // C: VLOOKUP from BQ Realization Forecast tab (cross-tab traceability)
    'Forecast Gap ($)',                  // D: =MAX(0, B - C) — what the forecast doesn't cover
    'Expected AUM/SQO (Scenario)',      // E: from Section 2
    'SQOs to Fill Gap',                 // F: =CEILING(D/E) — SQOs needed assuming realization forecast comes through
    'SQOs Without Forecast',            // G: =CEILING(B/E) — SQOs needed ignoring forecast entirely (raw rates)
    'Expected AUM/SQO (Current)',        // H: from Section 1
    'SQOs (Current Rates)',             // I: =CEILING(B/H) — baseline comparison
    'SQO Delta (Scenario vs Current)',   // J: G - I
    'Scenario Velocity (days)',          // K: total scenario days from Section 2
    'Pipeline Entry Quarter',            // L: quarter SQOs must enter pipeline
    'Entry Qtr Status',                  // M: "PAST" if entry quarter already passed
  ]);

  // Helper: convert "Q2 2026" → start-of-quarter date serial for Sheets DATE formula
  // Quarter start dates: Q1=Jan1, Q2=Apr1, Q3=Jul1, Q4=Oct1
  const quarterToDateFormula = (q: string): string => {
    const match = q.match(/^Q(\d)\s+(\d{4})$/);
    if (!match) return '';
    const qNum = parseInt(match[1]);
    const yr = parseInt(match[2]);
    const month = (qNum - 1) * 3 + 1; // Q1→1, Q2→4, Q3→7, Q4→10
    return `DATE(${yr},${month},1)`;
  };

  // Get quarters with targets, sorted
  const quarters = Object.entries(targetAumByQuarter)
    .filter(([, v]) => v > 0)
    .sort(([a], [b]) => {
      const [aq, ay] = a.replace('Q', '').split(' ').map(Number);
      const [bq, by] = b.replace('Q', '').split(' ').map(Number);
      return ay !== by ? ay - by : aq - bq;
    });

  if (quarters.length === 0) {
    values.push(['(No targets set — set target AUM on the Pipeline Forecast dashboard)']);
  } else {
    for (const [quarter, target] of quarters) {
      const row = values.length + 1;
      const qStartFormula = quarterToDateFormula(quarter);
      // Cross-tab VLOOKUP: look up this quarter in the BQ Realization Forecast tab
      // Section 1 summary rows. Column A = quarter, Column H = Total Forecast ($).
      // realizationRowRange e.g. "A6:H8" — passed in from the caller after building
      // the realization tab (so we know exact row range).
      const forecastLookup = `=IFERROR(VLOOKUP(A${row},${rTab}!${realizationRowRange},8,FALSE),0)`;
      values.push([
        quarter,                                                           // A
        target,                                                            // B
        forecastLookup,                                                    // C: Realization Forecast from BQ Realization Forecast tab
        `=MAX(0,B${row}-C${row})`,                                        // D: Forecast Gap (what forecast doesn't cover)
        '=$B$22',                                                          // E: scenario expected AUM/SQO
        `=IF(E${row}=0,"",IF(D${row}=0,0,CEILING(D${row}/E${row},1)))`,  // F: SQOs to fill gap (0 if no gap)
        `=IF(E${row}=0,"",CEILING(B${row}/E${row},1))`,                  // G: SQOs without forecast (raw target / expected AUM per SQO)
        '=$B$10*$B$11',                                                    // H: current expected AUM/SQO
        `=IF(H${row}=0,"",CEILING(B${row}/H${row},1))`,                  // I: SQOs at current rates
        `=IF(OR(G${row}="",I${row}=""),"",G${row}-I${row})`,             // J: delta scenario vs current
        '=$C$20',                                                          // K: scenario total velocity days
        `="Q"&CEILING(MONTH(${qStartFormula}-$C$20)/3,1)&" "&YEAR(${qStartFormula}-$C$20)`, // L: pipeline entry quarter
        `=IF(${qStartFormula}-$C$20<TODAY(),"PAST","")`,                   // M: flag if entry quarter already passed
      ]);
    }
  }
  values.push([]);

  // ── Section 4: Sensitivity Matrix (rows after targets) ──
  values.push(['SENSITIVITY MATRIX — Required SQOs at Different Rate \u00D7 AUM Combinations']);

  // Uses first quarter target for matrix. User can duplicate tab and change target.
  const matrixTarget = quarters.length > 0 ? quarters[0][1] : 500_000_000;
  const matrixTargetLabel = quarters.length > 0 ? quarters[0][0] : 'Default ($500M)';
  values.push([`Target: ${matrixTargetLabel} = $${(matrixTarget / 1e6).toFixed(0)}M`, '', '', '', '']);
  values.push([]);

  // AUM columns: $50M, $65M, $80M, $100M, $125M
  const aumValues = [50_000_000, 65_000_000, 80_000_000, 100_000_000, 125_000_000];
  // Rate rows: 10%, 12%, 14%, 16%, 18%, 20%
  const rateValues = [0.10, 0.12, 0.14, 0.16, 0.18, 0.20];

  // Header row
  const matrixHeaderRow = values.length + 1;
  values.push([
    'E2E Rate \\ Mean AUM',
    ...aumValues.map(v => `$${(v / 1e6).toFixed(0)}M`),
  ]);

  // Data rows — each cell = CEILING(target / (col_aum × row_rate))
  for (const rate of rateValues) {
    const row: any[] = [`${(rate * 100).toFixed(0)}%`];
    for (const aum of aumValues) {
      const sqos = Math.ceil(matrixTarget / (aum * rate));
      row.push(sqos);
    }
    values.push(row);
  }

  values.push([]);
  values.push(['HOW TO USE THIS TAB']);
  values.push(['1. Section 1 shows current trailing rates and velocity from the Rates tab (read-only).']);
  values.push(['2. Edit cells in Section 2 to model different scenarios (change any rate, days-per-stage, or mean AUM).']);
  values.push(['3. Section 3 shows TWO SQO numbers per quarter:']);
  values.push(['   - "SQOs to Fill Gap" = how many SQOs you need ASSUMING the realization forecast comes through.']);
  values.push(['     It VLOOKUPs into the BQ Realization Forecast tab for full traceability — you can audit exactly which deals drive the forecast.']);
  values.push(['   - "SQOs Without Forecast" = how many SQOs you need IGNORING the forecast entirely (straight target ÷ expected AUM/SQO).']);
  values.push(['     Use this as a conservative planning number or when you want to disregard pipeline forecasts.']);
  values.push(['4. Section 3 also shows the PIPELINE ENTRY QUARTER — when SQOs must enter the funnel to realize AUM by the target quarter.']);
  values.push(['   Entry quarters marked "PAST" mean the window has closed. Adjust velocity or target to compensate.']);
  values.push(['5. The sensitivity matrix shows Required SQOs across different rate × AUM combinations.']);
  values.push(['6. Duplicate this tab (right-click → Duplicate) to save multiple scenarios side by side.']);
  values.push(['7. All formulas trace back to source data: rates from BQ Rates and Days, forecasts from BQ Realization Forecast, targets from BQ SQO Targets.']);

  return values;
}
```

## Step 5.3: Wire into the export POST handler

**File**: `src/app/api/forecast/export/route.ts`

After `realizationValues` build, add:
```typescript
    // Compute the row range in the Realization tab where Section 1 summary rows live.
    // Section 1 layout: row 1 = title, row 2 = subtitle, row 3 = blank, row 4 = section header,
    // row 5 = column headers (A-H: Quarter, Deals, AUM, Band Label, Rate, Pipeline Contribution, Surprise, Total),
    // rows 6+ = quarter data rows.
    // The number of quarter rows = number of unique future quarters in componentA deals.
    // We pass this range so the Scenario Runner tab can VLOOKUP into it for cross-tab traceability.
    // Column H = Total Forecast ($) — the VLOOKUP target (column index 8).
    const realizationQuarterCount = realizationValues.filter((r: any[]) =>
      r[0] && typeof r[0] === 'string' && r[0].match(/^Q\d\s+\d{4}$/) && r.length >= 8
    ).length;
    const realizationRowRange = `A6:H${5 + realizationQuarterCount}`;
    const scenarioRunnerValues = buildScenarioRunnerValues(tieredRates.flat, targetAumByQuarter, realizationRowRange);
```

After the Realization tab writeTab, add:
```typescript
    await writeTab(sheets, newSheetId, SCENARIO_TAB, scenarioRunnerValues);
    console.log(`[Forecast Export] Scenario Runner tab written`);
```

## PHASE 5 — VALIDATION GATE

```bash
npx tsc --noEmit 2>&1 | head -30
```

**Expected**: Zero TypeScript errors.

```bash
grep -n "SCENARIO_TAB\|buildScenarioRunnerValues\|SENSITIVITY MATRIX\|Pipeline Entry Quarter\|Entry Qtr Status\|SQOs to Fill Gap\|SQOs Without Forecast\|Realization Forecast\|VLOOKUP" src/app/api/forecast/export/route.ts
```

**Expected**: Tab constant, builder function, writeTab call, sensitivity matrix, pipeline entry quarter, entry quarter status, forecast gap columns, and VLOOKUP cross-tab reference all present.

```bash
# Verify the export now writes 7 tabs total
grep -c "await writeTab" src/app/api/forecast/export/route.ts
```

**Expected**: 7 (was 5).

```bash
# Verify velocity, entry quarter, and realization cross-tab formulas in Section 3
grep -n "C\$20\|quarterToDateFormula\|PAST\|realizationRowRange\|BQ Realization Forecast" src/app/api/forecast/export/route.ts
```

**Expected**: References to scenario velocity ($C$20), the quarter-to-date helper, "PAST" flag, realization row range, and the cross-tab reference to BQ Realization Forecast.

**STOP AND REPORT**: Tell the user:
- "Phase 5 complete — BQ Scenario Runner Sheets tab with 4 sections"
- "Section 1 references named ranges (read-only), Section 2 is editable (rates + days-per-stage + AUM)"
- "Section 3 shows TWO SQO numbers per quarter with full formula traceability:"
- "  • 'SQOs to Fill Gap' — assumes realization forecast comes through, VLOOKUPs into BQ Realization Forecast tab"
- "  • 'SQOs Without Forecast' — ignores forecast, straight target ÷ expected AUM per SQO"
- "  • Both respond to scenario rate/days/AUM edits in Section 2"
- "  • Realization Forecast column traces back to deal-level detail in BQ Realization Forecast tab"
- "Pipeline entry quarter uses DATE arithmetic formulas that update live when user edits scenario days"
- "Entry quarters already past are flagged 'PAST' in column M"
- "Section 4 has sensitivity matrix showing Required SQOs at different rate × AUM combinations"
- "Export now writes 7 tabs total (was 5)"
- "Ready to proceed to Phase 6 (Build + Doc Sync)?"

---

# PHASE 6: Build + Doc Sync + Commit Prep

## Step 6.1: Full build verification

```bash
npm run build 2>&1 | tail -30
```

**Expected**: Build succeeds with zero errors.

## Step 6.2: Doc sync

```bash
npx agent-guard sync
```

Review changes to `docs/ARCHITECTURE.md` and generated inventories. Stage if correct.

## Step 6.3: Write session context

**File**: `.ai-session-context.md` (do NOT stage — it's in .gitignore)

```markdown
### Session Summary
Added realization forecast model to the Pipeline Forecast page and Sheets export. Two new UI components (RealizationBanner, WhatIfPanel with velocity sliders and pipeline entry quarter projection) and two new Sheets tabs (BQ Realization Forecast with full OFH-backed audit trail, BQ Scenario Runner with gap/raw SQO analysis) plus 6 new named ranges. Surprise baseline computed live from BQ via OpportunityFieldHistory PIT reconstruction — no hardcoded values.

### Business Context
Leadership needs a simpler, more accurate quarterly forecast than the probability model (17% MAPE vs 198%). The two-component model — late-stage dated deals × realization band + historical surprise baseline — was validated in a 5-quarter PIT-corrected backtest. The what-if panel lets leadership adjust rates, velocity, and AUM to see how they affect SQO requirements, with pipeline entry quarter projection showing WHEN SQOs are needed. The Sheets tabs make everything fully auditable — every number traces to deal-level data via SUMIFS formulas, including Component A (via OpportunityFieldHistory) and Component B (surprise = Total Joined - Component A Joined).

### Technical Approach
RealizationBanner filters pipeline to Neg+Signed with future anticipated dates, groups by quarter, applies deal-count band rates (<10=60%, 10-14=45%, 15+=35%), adds live Component B surprise baseline from getSurpriseBaseline() BQ query. WhatIfPanel uses pure client-side useMemo — rate sliders, velocity (days-per-stage) sliders, AUM slider, pipeline entry quarter projection, two SQO numbers per quarter (gap vs raw). Sheets Realization tab has 3 sections: COUNTIF/SUMIFS forecast summary, Component A deal detail from OFH PIT reconstruction, and joined deal detail from vw_funnel_master. Scenario Runner tab VLOOKUPs into Realization tab for cross-tab traceability with velocity-adjusted pipeline entry quarters.

### What Changed
- New: RealizationBanner.tsx, WhatIfPanel.tsx, getSurpriseBaseline() in forecast-pipeline.ts
- Modified: forecast/page.tsx (imports, render slots, surpriseBaseline state)
- Modified: forecast/pipeline/route.ts (added getSurpriseBaseline to fetch)
- Modified: api-client.ts (surpriseBaseline in pipeline response type)
- Modified: forecast/export/route.ts (2 builder functions, 2 tab constants, 6 named ranges, buildRatesAndDaysValues signature, 2 new BQ queries for historical joined deals + OFH Component A PIT)

### Verification
TypeScript build passes. Named ranges reference correct 0-indexed row offsets. Realization bands match backtest. VLOOKUP references column H (Total Forecast) in Realization tab. AUM > $1,000 filter excludes placeholder records with zero backtest impact. Surprise baseline live-computed matches backtest methodology.
```

## PHASE 6 — VALIDATION GATE

```bash
npm run build 2>&1 | tail -5
```

**Expected**: `✓ Compiled successfully` or equivalent success message.

**STOP AND REPORT**: Tell the user:
- "All 6 phases complete. Build passes."
- "2 new components (RealizationBanner, WhatIfPanel with velocity + pipeline entry quarter), 2 new Sheets tabs, 6 new named ranges, 19 total named ranges"
- "Surprise baseline is now live-computed from BQ (getSurpriseBaseline via OFH PIT reconstruction) — no hardcoded $398M"
- "Sheets Realization tab has full audit trail: Component A from OFH, joined deals from vw_funnel_master, all SUMIFS-linked"
- "AUM > $1,000 filter applied to all historical queries (excludes placeholder records)"
- ".ai-session-context.md written and ready for commit"
- "Test in browser: navigate to /dashboard/forecast, verify RealizationBanner shows above metric cards with live surprise baseline, expand WhatIfPanel and adjust rate/velocity/AUM sliders, verify pipeline entry quarters, run a Sheets export and verify 7 tabs with full formula traceability"

---

# Troubleshooting Appendix

### TypeScript: Cannot find module for RealizationBanner/WhatIfPanel
The component files must be in `src/app/dashboard/forecast/components/`. Verify the import path uses `./components/` (relative) not `@/`.

### Named range errors in Sheets export
Named ranges use **0-indexed** row/col. If you add rows before existing named-range targets, ALL subsequent row offsets shift. The strategy in this guide adds new rows AFTER existing sections to avoid this. If you get "Invalid range" errors, count the actual rows in the `buildRatesAndDaysValues` return array and recompute offsets.

### Section 1 COUNTIF/SUMIFS formulas show 0
Verify `sec2Start` and `sec2End` row numbers match the actual Section 2 position. The formulas use 1-indexed Sheets rows, not 0-indexed array indices. Print `sec2Start` and `sec2End` to console during export for debugging.

### Component B / surprise baseline shows unexpected value
Component B is now computed LIVE from BQ via `getSurpriseBaseline()` in `forecast-pipeline.ts`. It uses OpportunityFieldHistory to PIT-reconstruct Component A, then computes Surprise = Total Joined - Component A Joined, averaged over the trailing 4 completed quarters. If the query fails, it falls back to $398M (the original backtest value). The `Earliest_Anticipated_Start_Date__c` field in vw_funnel_master is overwritten post-join (73% of deals), which is why OFH is required for the PIT reconstruction. See `data-verifier-findings.md` Query 3 for full analysis.

### Surprise baseline differs between dashboard and sheet
Both should now use the same data source. Dashboard: `getSurpriseBaseline()` query (24h cache). Sheet: Section 3 SUMIFS over deal-level detail from the same OFH + vw_funnel_master queries. Small differences may occur if AUM values were revised between exports (the sheet uses current AUM, not PIT-corrected AUM for the amounts — only the anticipated dates are PIT-corrected via OFH).

### 180d window shows unreliable mean AUM
Expected behavior. Only 13 joined deals in the 180d window (n=13). The low-confidence warning in ForecastMetricCards already triggers correctly for n<30. The what-if panel defaults to trailing-window rates, which may be volatile for 180d.

### Sheets export timeout
With 7 tabs, the export makes ~28 Sheets API calls. `maxDuration` is 60s (line 910). If timeouts occur, check if deal count has grown significantly (more P2/Audit rows = larger writes). The 500-row chunking in `writeTab` handles large datasets.

---

# Known Limitations

1. **Component B is hardcoded ($398M)** — cannot be live-computed from `vw_funnel_master` due to post-join anticipated date overwriting. Must be updated quarterly via the PIT backtest process. Long-term fix: new BQ view using `OpportunityFieldHistory`.

2. **Realization bands are derived from 5 data points** — directionally correct but statistically thin. Re-derive annually when 8+ quarters of data are available. See backtest Part 4 "How to Refine the Bands Over Time."

3. **WhatIfPanel has no persistence** — scenarios are ephemeral. Users who want to save scenarios should use the existing ScenarioRunner (which saves to DB with Monte Carlo results) or export to Sheets and duplicate the Scenario Runner tab.

4. **Sensitivity matrix uses hardcoded values, not formulas** — for simplicity. Users can copy the tab and manually edit the target AUM to see different matrices.

5. **Q1 2026 in-progress deals may appear** in the realization banner. The pipeline filter uses `>= CURRENT_DATE()` for anticipated dates, which includes deals in the current quarter. This is intentional — it shows what's still in play.

---

*Generated: 2026-03-25 | 6 phases, 4 files to modify, 2 new files to create, 2 new builder functions*
