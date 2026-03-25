'use client';

import React, { useState, useMemo } from 'react';
import { Card, Text } from '@tremor/react';
import { SlidersHorizontal, ChevronDown, ChevronUp, RotateCcw, Clock, ArrowRight, Info } from 'lucide-react';

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

type AumUnit = 'B' | 'M';

interface PipelineRecord {
  StageName: string;
  Opportunity_AUM_M: number;
  Earliest_Anticipated_Start_Date__c: string | null;
  projected_quarter: string | null;
}

interface WhatIfPanelProps {
  rates: RateShape | null;
  targetAumByQuarter: Record<string, number>;
  onTargetChange: (quarter: string, value: number) => void;
  pipeline: PipelineRecord[];
  surpriseBaseline: number;
}

const RATE_FIELDS: { key: 'sqo_to_sp' | 'sp_to_neg' | 'neg_to_signed' | 'signed_to_joined'; label: string }[] = [
  { key: 'sqo_to_sp', label: 'SQO \u2192 SP' },
  { key: 'sp_to_neg', label: 'SP \u2192 Neg' },
  { key: 'neg_to_signed', label: 'Neg \u2192 Signed' },
  { key: 'signed_to_joined', label: 'Signed \u2192 Joined' },
];

const DAYS_FIELDS: { key: 'avg_days_sqo_to_sp' | 'avg_days_in_sp' | 'avg_days_in_neg' | 'avg_days_in_signed'; label: string }[] = [
  { key: 'avg_days_sqo_to_sp', label: 'SQO \u2192 SP' },
  { key: 'avg_days_in_sp', label: 'In SP' },
  { key: 'avg_days_in_neg', label: 'In Neg' },
  { key: 'avg_days_in_signed', label: 'In Signed' },
];

function Tooltip({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative inline-block ml-1">
      <Info
        className="w-3.5 h-3.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-help inline"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
      />
      {show && (
        <span className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 px-3 py-2 text-xs text-white bg-gray-900 dark:bg-gray-700 rounded-lg shadow-lg">
          {text}
          <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900 dark:border-t-gray-700" />
        </span>
      )}
    </span>
  );
}

function formatAum(value: number, unit: AumUnit = 'B'): string {
  if (unit === 'B') {
    if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
    if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
    if (value > 0) return `$${(value / 1e3).toFixed(0)}K`;
    return '$0';
  }
  // M mode — always show in millions
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  if (value > 0) return `$${(value / 1e3).toFixed(0)}K`;
  return '$0';
}

/** Higher precision for breakdown math so "$1.28B − $1.30B" doesn't both show as "$1.3B" */
function formatAumPrecise(value: number, unit: AumUnit = 'B'): string {
  if (unit === 'B') {
    if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
    if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
    if (value > 0) return `$${(value / 1e3).toFixed(0)}K`;
    return '$0';
  }
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value > 0) return `$${(value / 1e3).toFixed(0)}K`;
  return '$0';
}

function targetDisplayValue(dollars: number, unit: AumUnit): string {
  if (unit === 'B') return (dollars / 1e9).toFixed(2);
  return (dollars / 1e6).toFixed(0);
}

function parseTargetInput(input: string, unit: AumUnit): number {
  const num = parseFloat(input);
  if (isNaN(num) || num < 0) return 0;
  return unit === 'B' ? num * 1e9 : num * 1e6;
}

// ── Realization forecast constants (must match RealizationBanner) ──────────
// surpriseBaseline is now passed as a prop — computed live from BQ via getSurpriseBaseline()
const REALIZATION_BANDS = [
  { maxDeals: 9,  rate: 0.60 },
  { maxDeals: 14, rate: 0.45 },
  { maxDeals: Infinity, rate: 0.35 },
] as const;

function getRealizationRate(dealCount: number): number {
  for (const band of REALIZATION_BANDS) {
    if (dealCount <= band.maxDeals) return band.rate;
  }
  return 0.35;
}

function getQuarterFromDate(dateStr: string): string | null {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return `Q${Math.ceil((d.getMonth() + 1) / 3)} ${d.getFullYear()}`;
}

function isFutureQuarter(quarter: string): boolean {
  const match = quarter.match(/^Q(\d)\s+(\d{4})$/);
  if (!match) return false;
  const now = new Date();
  const currentQ = Math.ceil((now.getMonth() + 1) / 3);
  const currentYr = now.getFullYear();
  const q = parseInt(match[1]), yr = parseInt(match[2]);
  return yr > currentYr || (yr === currentYr && q > currentQ);
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

export function WhatIfPanel({ rates, targetAumByQuarter, onTargetChange, pipeline, surpriseBaseline }: WhatIfPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const [aumUnit, setAumUnit] = useState<AumUnit>('B');

  // Compute realization forecast per quarter (same logic as RealizationBanner)
  const realizationByQuarter = useMemo(() => {
    const map = new Map<string, number>();
    const byQ = new Map<string, { count: number; aum: number }>();
    for (const deal of pipeline) {
      if ((deal.StageName !== 'Negotiating' && deal.StageName !== 'Signed') || !deal.Earliest_Anticipated_Start_Date__c) continue;
      const quarter = getQuarterFromDate(deal.Earliest_Anticipated_Start_Date__c);
      if (!quarter || !isFutureQuarter(quarter)) continue;
      const existing = byQ.get(quarter) || { count: 0, aum: 0 };
      existing.count += 1;
      existing.aum += deal.Opportunity_AUM_M * 1e6;
      byQ.set(quarter, existing);
    }
    for (const [q, { count, aum }] of byQ) {
      const componentA = aum * getRealizationRate(count);
      map.set(q, componentA + surpriseBaseline);
    }
    return map;
  }, [pipeline, surpriseBaseline]);

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
      .filter(([q, v]) => v > 0 && isFutureQuarter(q))
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
      // Realization forecast gap: how many SQOs to fill what the forecast doesn't cover
      const forecastAum = realizationByQuarter.get(quarter) ?? 0;
      const rawGap = Math.max(0, target - forecastAum);
      // If the gap is less than what 1 SQO would contribute, treat as covered —
      // you can't plan for a fractional SQO and the forecast essentially meets the target
      const gap = (expectedAumPerSqo > 0 && rawGap < expectedAumPerSqo) ? 0 : rawGap;
      const gapSqos = expectedAumPerSqo > 0 ? Math.ceil(gap / expectedAumPerSqo) : 0;
      return { quarter, target, scenarioSqos, currentSqos, delta, entryQuarter, entryQuarterPast, forecastAum, gap, gapSqos };
    });
  }, [targetAumByQuarter, expectedAumPerSqo, currentExpectedAumPerSqo, totalVelocityDays, realizationByQuarter]);

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
                <span className="text-gray-400">Period: {formatAum(rates.mean_joined_aum, aumUnit)}</span>
                <span className={meanAumOverride !== rates.mean_joined_aum ? 'text-indigo-600 dark:text-indigo-400 font-medium' : ''}>
                  {formatAum(meanAumOverride, aumUnit)}
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
                <Text className="text-xs text-gray-500">SQO \u2192 Joined Rate</Text>
                <p className={`font-semibold ${sqoToJoinedRate !== currentSqoToJoinedRate ? 'text-indigo-600 dark:text-indigo-400' : ''}`}>
                  {(sqoToJoinedRate * 100).toFixed(1)}%
                </p>
                <p className="text-[10px] text-gray-400">Period: {(currentSqoToJoinedRate * 100).toFixed(1)}%</p>
              </div>
              <div>
                <Text className="text-xs text-gray-500">
                  Expected AUM per SQO
                  <Tooltip text="Mean Joined AUM × SQO→Joined rate. Uses the average AUM of deals that actually joined (not all SQOs entering the funnel) because larger deals convert at lower rates. Using pipeline-entry AUM would overstate expected value. Backtest confirmed joined-only mean produces the most accurate SQO forecasts (MAE 16.5 SQOs)." />
                </Text>
                <p className={`font-semibold ${expectedAumPerSqo !== currentExpectedAumPerSqo ? 'text-indigo-600 dark:text-indigo-400' : ''}`}>
                  {formatAum(expectedAumPerSqo, aumUnit)}
                </p>
                <p className="text-[10px] text-gray-400">Period: {formatAum(currentExpectedAumPerSqo, aumUnit)}</p>
              </div>
              <div>
                <Text className="text-xs text-gray-500">SQO \u2192 Joined Velocity</Text>
                <p className={`font-semibold ${totalVelocityDays !== currentTotalVelocityDays ? 'text-indigo-600 dark:text-indigo-400' : ''}`}>
                  ~{totalVelocityDays} days
                </p>
                <p className="text-[10px] text-gray-400">Period: ~{currentTotalVelocityDays}d</p>
              </div>
            </div>

            {/* Per-quarter required SQOs with pipeline entry quarter */}
            {quarterResults.length > 0 && (
              <div className="border-t border-gray-200 dark:border-gray-700 pt-2 mt-2">
                <div className="flex items-center justify-between mb-2">
                  <Text className="text-xs text-gray-500">Required SQOs by Quarter (velocity-adjusted)</Text>
                  <div className="flex items-center gap-1 text-[10px]">
                    <button
                      onClick={() => setAumUnit('B')}
                      className={`px-1.5 py-0.5 rounded ${aumUnit === 'B' ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 font-medium' : 'text-gray-400 hover:text-gray-600'}`}
                    >$B</button>
                    <button
                      onClick={() => setAumUnit('M')}
                      className={`px-1.5 py-0.5 rounded ${aumUnit === 'M' ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 font-medium' : 'text-gray-400 hover:text-gray-600'}`}
                    >$M</button>
                  </div>
                </div>
                <div className="space-y-2">
                  {quarterResults.map(qr => (
                    <div key={qr.quarter} className="border border-gray-200 dark:border-gray-700 rounded p-2">
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{qr.quarter}</span>
                          <div className="flex items-center gap-1">
                            <label className="text-xs text-gray-400">Target ({aumUnit === 'B' ? '$B' : '$M'}):</label>
                            <input
                              type="text"
                              inputMode="decimal"
                              defaultValue={targetDisplayValue(qr.target, aumUnit)}
                              key={`${qr.quarter}-${aumUnit}`}
                              onBlur={e => {
                                const dollars = parseTargetInput(e.target.value, aumUnit);
                                onTargetChange(qr.quarter, dollars);
                              }}
                              onKeyDown={e => {
                                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                              }}
                              className="w-20 px-1.5 py-0.5 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-right"
                            />
                          </div>
                        </div>
                      </div>
                      {/* Two SQO calculations */}
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                        <div className={`rounded p-1.5 ${qr.gapSqos === 0 && qr.forecastAum > 0 ? 'bg-green-50 dark:bg-green-900/20' : 'bg-blue-50 dark:bg-blue-900/20'}`}>
                          {qr.forecastAum > 0 ? (
                            qr.gapSqos === 0 ? (
                              <>
                                <div className="text-green-600 dark:text-green-400 font-semibold text-sm">On track</div>
                                <div className="text-green-500 dark:text-green-400">Forecast meets or exceeds target</div>
                                <div className="text-gray-400 mt-0.5">
                                  {formatAumPrecise(qr.forecastAum, aumUnit)} forecast &ge; {formatAumPrecise(qr.target, aumUnit)} target
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="text-blue-600 dark:text-blue-400 font-semibold text-sm">{qr.gapSqos} SQOs</div>
                                <div className="text-blue-500 dark:text-blue-400">to fill forecast gap</div>
                                <div className="text-gray-400 mt-0.5">
                                  {formatAumPrecise(qr.target, aumUnit)} target &minus; {formatAumPrecise(qr.forecastAum, aumUnit)} forecast = {formatAum(qr.gap, aumUnit)} gap
                                </div>
                              </>
                            )
                          ) : (
                            <>
                              <div className="text-blue-600 dark:text-blue-400 font-semibold text-sm">{qr.gapSqos} SQOs</div>
                              <div className="text-blue-500 dark:text-blue-400">to fill forecast gap</div>
                              <div className="text-gray-400 mt-0.5">No realization forecast for this quarter</div>
                            </>
                          )}
                        </div>
                        <div className="bg-gray-100 dark:bg-gray-800 rounded p-1.5">
                          <div className="font-semibold text-sm">{qr.scenarioSqos} SQOs</div>
                          <div className="text-gray-500 dark:text-gray-400">without forecast (raw rates)</div>
                          <div className="text-gray-400 mt-0.5">
                            {formatAum(qr.target, aumUnit)} target &divide; {formatAum(expectedAumPerSqo, aumUnit)}/SQO
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1.5 text-xs">
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
