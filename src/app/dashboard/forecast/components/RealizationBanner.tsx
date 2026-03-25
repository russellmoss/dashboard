'use client';

import React, { useMemo } from 'react';
import { Card, Text } from '@tremor/react';
import { TrendingUp, Info } from 'lucide-react';

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
// surpriseBaseline is now passed as a prop — computed live from BQ via getSurpriseBaseline()

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
  surpriseBaseline: number;
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

function isFutureQuarter(quarter: string): boolean {
  const match = quarter.match(/^Q(\d)\s+(\d{4})$/);
  if (!match) return false;
  const [, q, yr] = match;
  const now = new Date();
  const currentQ = Math.ceil((now.getMonth() + 1) / 3);
  const currentYr = now.getFullYear();
  if (parseInt(yr) > currentYr) return true;
  if (parseInt(yr) === currentYr && parseInt(q) > currentQ) return true;
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

export function RealizationBanner({ pipeline, windowDays, surpriseBaseline }: RealizationBannerProps) {
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
      if (!quarter || !isFutureQuarter(quarter)) continue;
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
        componentB: surpriseBaseline,
        totalForecast: componentA + surpriseBaseline,
      });
    }

    return forecasts;
  }, [pipeline, surpriseBaseline]);

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
          Component B = {formatAum(surpriseBaseline)} trailing 4Q surprise baseline (live from BQ + OpportunityFieldHistory PIT).
        </span>
      </div>
    </Card>
  );
}
