'use client';

import React, { useState, useCallback, useRef } from 'react';
import { Card, Metric, Text } from '@tremor/react';
import { Info, AlertTriangle, Check, TrendingUp, TrendingDown } from 'lucide-react';

// Inline the rate shape to avoid importing server-only module in client component
interface RateShape {
  sqo_to_sp: number;
  sp_to_neg: number;
  neg_to_signed: number;
  signed_to_joined: number;
  avg_days_sqo_to_sp: number;
  avg_days_in_sp: number;
  avg_days_in_neg: number;
  avg_days_in_signed: number;
  window_start: string;
  window_end: string;
  cohort_count: number;
  mean_joined_aum: number;
  joined_deal_count: number;
}

interface QuarterShape {
  label: string;
  opp_count: number;
  expected_aum: number;
}

interface SummaryShape {
  total_opps: number;
  pipeline_total_aum: number;
  zero_aum_count: number;
  anticipated_date_count: number;
  quarters?: QuarterShape[];
}

interface ForecastMetricCardsProps {
  summary: SummaryShape | null;
  windowDays: 180 | 365 | 730 | null;
  rates: RateShape | null;
  targetAumByQuarter: Record<string, number>;
  onTargetChange: (quarter: string, value: number) => void;
}

function formatAum(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  if (value > 0) return `$${(value / 1e3).toFixed(0)}K`;
  return '$0';
}

function getWindowLabel(days: 180 | 365 | 730 | null): string {
  if (days === null) return 'Jun 2025 - Dec 2025 (all-time)';
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  const label = days === 180 ? '180d' : days === 365 ? '1yr' : '2yr';
  return `${fmt(start)} - ${fmt(end)} (${label} window active)`;
}

/** Parse "Q2 2026" → start of that quarter as a Date */
function parseQuarterStart(label: string): Date | null {
  const m = label.match(/^Q(\d)\s+(\d{4})$/);
  if (!m) return null;
  const q = parseInt(m[1]);
  const y = parseInt(m[2]);
  const month = (q - 1) * 3;
  return new Date(y, month, 1);
}

/** Given a date, return its quarter label like "Q2 2026" */
function dateToQuarterLabel(d: Date): string {
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `Q${q} ${d.getFullYear()}`;
}

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

export function ForecastMetricCards({ summary, windowDays, rates, targetAumByQuarter, onTargetChange }: ForecastMetricCardsProps) {
  if (!summary) return null;

  const [savedQuarter, setSavedQuarter] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Conversion rates and velocity from the flat cohort
  const sqoToSp = rates?.sqo_to_sp ?? 0;
  const spToNeg = rates?.sp_to_neg ?? 0;
  const negToSigned = rates?.neg_to_signed ?? 0;
  const signedToJoined = rates?.signed_to_joined ?? 0;
  const sqoToJoinedRate = sqoToSp * spToNeg * negToSigned * signedToJoined;
  const meanJoinedAum = rates?.mean_joined_aum ?? 0;
  const joinedDealCount = rates?.joined_deal_count ?? 0;
  const avgDaysToJoin = (rates?.avg_days_sqo_to_sp ?? 0) + (rates?.avg_days_in_sp ?? 0)
    + (rates?.avg_days_in_neg ?? 0) + (rates?.avg_days_in_signed ?? 0);

  // Expected AUM contribution per SQO = P(SQO→Joined) × avg AUM of deals that joined
  const expectedAumPerSQO = meanJoinedAum * sqoToJoinedRate;

  // Debug: log rates so we can diagnose if values are missing
  if (rates && expectedAumPerSQO === 0) {
    console.warn('[ForecastMetricCards] expectedAumPerSQO=0 — rates debug:', {
      sqoToSp, spToNeg, negToSigned, signedToJoined,
      sqoToJoinedRate, meanJoinedAum, joinedDealCount, avgDaysToJoin,
      rawRates: rates,
    });
  }

  const handleInputChange = useCallback((quarter: string, rawVal: string) => {
    const val = parseFloat(rawVal);
    const dollars = isNaN(val) || val <= 0 ? 0 : val * 1e6;
    onTargetChange(quarter, dollars);
    if (dollars > 0) {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      setSavedQuarter(quarter);
      saveTimerRef.current = setTimeout(() => setSavedQuarter(null), 1500);
    }
  }, [onTargetChange]);

  // Fixed cards
  const pipelineCard = {
    title: 'Open Pipeline AUM',
    value: formatAum(summary.pipeline_total_aum * 1e6),
    subtitle: `${summary.total_opps} opps (${summary.zero_aum_count} zero-AUM)`,
  };
  const windowCard = {
    title: 'Conversion Window',
    value: rates ? `${rates.cohort_count} SQOs` : '-',
    subtitle: rates
      ? `${getWindowLabel(windowDays)} | ${(sqoToJoinedRate * 100).toFixed(1)}% conv, ${formatAum(meanJoinedAum)} avg AUM, ${formatAum(expectedAumPerSQO)}/SQO`
      : getWindowLabel(windowDays),
  };
  const fixedCards = [pipelineCard, windowCard];
  const quarters = summary.quarters ?? [];
  const totalCards = fixedCards.length + quarters.length;
  const gridCols = totalCards <= 3 ? 'lg:grid-cols-3' : totalCards <= 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-5';

  return (
    <div className={`grid grid-cols-1 md:grid-cols-2 ${gridCols} gap-4`}>
      {fixedCards.map(card => (
        <Card key={card.title} className="p-4">
          <Text>{card.title}</Text>
          <Metric className="mt-1">{card.value}</Metric>
          <Text className="mt-1 text-xs">{card.subtitle}</Text>
        </Card>
      ))}

      {quarters.map(q => {
        const targetDollars = targetAumByQuarter[q.label] ?? 0;
        const targetMillions = targetDollars > 0 ? (targetDollars / 1e6).toString() : '';
        const projectedAum = q.expected_aum;

        // Gap: how much more AUM we need beyond current pipeline projection
        const gapDollars = targetDollars > 0 ? targetDollars - projectedAum : 0;
        const onTrack = gapDollars <= 0 && targetDollars > 0;
        const coveragePct = targetDollars > 0 ? (projectedAum / targetDollars) * 100 : 0;

        // SQO math — incremental (gap-based) and total
        const canComputeSQOs = expectedAumPerSQO > 0;
        const incrementalSQOs = canComputeSQOs && gapDollars > 0
          ? Math.ceil(gapDollars / expectedAumPerSQO)
          : 0;
        const totalSQOs = canComputeSQOs && targetDollars > 0
          ? Math.ceil(targetDollars / expectedAumPerSQO)
          : 0;

        // Map SQOs back to the quarter they need to ENTER the pipeline
        // Logic: to join in target quarter, SQOs must become SQO avgDaysToJoin days earlier
        let sqoEntryQuarter: string | null = null;
        let entryQuarterPast = false;
        if (incrementalSQOs > 0 && avgDaysToJoin > 0) {
          const quarterStart = parseQuarterStart(q.label);
          if (quarterStart) {
            const midpoint = new Date(quarterStart);
            midpoint.setDate(midpoint.getDate() + 45); // mid-quarter join target
            const entryDate = new Date(midpoint);
            entryDate.setDate(entryDate.getDate() - avgDaysToJoin);
            sqoEntryQuarter = dateToQuarterLabel(entryDate);
            const currentQStart = parseQuarterStart(dateToQuarterLabel(new Date()));
            const entryQStart = parseQuarterStart(sqoEntryQuarter);
            if (entryQStart && currentQStart && entryQStart < currentQStart) {
              entryQuarterPast = true;
            }
          }
        }

        return (
          <Card key={q.label} className="p-4">
            <Text>
              Expected {q.label} AUM
              <Tooltip text={`Sum of each opp's AUM × adjusted P(Join). Only opps projected to join in ${q.label} are included.`} />
            </Text>
            <Metric className="mt-1">{formatAum(projectedAum)}</Metric>
            <Text className="mt-1 text-xs">{q.opp_count} opps projected {q.label}</Text>

            {/* Target input */}
            <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">Target AUM ($M):</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  placeholder="e.g. 500"
                  value={targetMillions}
                  onChange={(e) => handleInputChange(q.label, e.target.value)}
                  className="w-24 px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                {savedQuarter === q.label && (
                  <span className="flex items-center gap-0.5 text-[10px] text-emerald-600 dark:text-emerald-400 animate-pulse">
                    <Check className="w-3 h-3" /> Saved
                  </span>
                )}
              </div>

              {/* ── Analysis section: only when target is set ── */}
              {targetDollars > 0 && (
                <div className="mt-3 space-y-3">

                  {/* Coverage progress bar */}
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <Text className="text-[10px] text-gray-500">Pipeline coverage</Text>
                      <Text className={`text-[10px] font-semibold ${onTrack ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                        {coveragePct.toFixed(0)}%
                      </Text>
                    </div>
                    <div className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${onTrack ? 'bg-emerald-500' : coveragePct >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                        style={{ width: `${Math.min(coveragePct, 100)}%` }}
                      />
                    </div>
                  </div>

                  {/* ── On-Track ── */}
                  {onTrack && (
                    <div className="flex items-center gap-1">
                      <TrendingUp className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                      <Text className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                        On track — exceeds target by {formatAum(Math.abs(gapDollars))}
                      </Text>
                    </div>
                  )}

                  {/* ── Gap + SQO plan ── */}
                  {!onTrack && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-1">
                        <TrendingDown className="w-3.5 h-3.5 text-red-500 dark:text-red-400" />
                        <Text className="text-xs font-semibold text-red-600 dark:text-red-400">
                          {formatAum(gapDollars)} gap to close
                        </Text>
                      </div>

                      {/* SQO requirement — always shown when gap exists and we have rates */}
                      {canComputeSQOs ? (
                        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-2.5 space-y-1.5">
                          <Text className="text-xs font-bold text-blue-700 dark:text-blue-300">
                            Need {incrementalSQOs} more SQOs to close the gap
                          </Text>
                          <Text className="text-[10px] text-blue-600 dark:text-blue-400">
                            ({totalSQOs} total SQOs required for full {formatAum(targetDollars)} target)
                          </Text>

                          {/* Entry quarter */}
                          {sqoEntryQuarter && (
                            <div className={`flex items-start gap-1.5 mt-1 ${entryQuarterPast ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'}`}>
                              {entryQuarterPast && <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />}
                              <Text className={`text-xs font-semibold ${entryQuarterPast ? 'text-red-600 dark:text-red-400' : 'text-blue-700 dark:text-blue-300'}`}>
                                {entryQuarterPast
                                  ? `SQOs needed to enter in ${sqoEntryQuarter} (already past) — at risk`
                                  : `SQOs must enter pipeline in ${sqoEntryQuarter}`
                                }
                              </Text>
                            </div>
                          )}

                          {/* Math breakdown */}
                          <div className="pt-1.5 mt-1.5 border-t border-blue-200 dark:border-blue-800 space-y-0.5">
                            <Text className="text-[10px] text-blue-500 dark:text-blue-400">
                              {formatAum(gapDollars)} gap ÷ {formatAum(expectedAumPerSQO)} expected AUM per SQO
                            </Text>
                            <Text className="text-[10px] text-blue-500 dark:text-blue-400">
                              SQO→Joined rate: {(sqoToJoinedRate * 100).toFixed(1)}% × {formatAum(meanJoinedAum)} avg joined AUM
                            </Text>
                            <Text className="text-[10px] text-blue-500 dark:text-blue-400">
                              Avg SQO→Joined velocity: ~{avgDaysToJoin} days
                            </Text>
                          </div>
                        </div>
                      ) : (
                        <Text className="text-[10px] text-gray-400 italic">
                          Cannot compute SQO requirement — no joined deals in conversion window to derive rates
                        </Text>
                      )}
                    </div>
                  )}

                  {joinedDealCount > 0 && joinedDealCount < 30 && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="w-3 h-3" />
                      Low confidence — only {joinedDealCount} joined deals in window
                    </span>
                  )}
                </div>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
