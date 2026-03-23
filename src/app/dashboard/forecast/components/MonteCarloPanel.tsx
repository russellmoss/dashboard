'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { Card, Text } from '@tremor/react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { MonteCarloResponse, MonteCarloQuarterResult, MonteCarloPerOpp } from '@/lib/queries/forecast-monte-carlo';
import { ForecastPipelineRecord } from '@/lib/queries/forecast-pipeline';
import { ChevronDown, ChevronUp, X, Download } from 'lucide-react';
import { exportToCSV } from '@/lib/utils/export-csv';

interface MonteCarloPanelProps {
  results: MonteCarloResponse;
  pipeline?: ForecastPipelineRecord[];
  onOppClick?: (oppId: string) => void;
}

function formatAum(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  return `$${value.toFixed(0)}`;
}

function formatAumShort(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

type ScenarioKey = string | null;

const PERCENTILE_META: Record<string, { suffix: string; label: string; color: string; ring: string }> = {
  p10: { suffix: 'P10 (Bear)', label: 'P10 (Bear)', color: 'text-red-600', ring: 'ring-red-400' },
  p50: { suffix: 'P50 (Base)', label: 'P50 (Base)', color: 'text-blue-600', ring: 'ring-blue-400' },
  p90: { suffix: 'P90 (Bull)', label: 'P90 (Bull)', color: 'text-green-600', ring: 'ring-green-400' },
};

const QUARTER_COLORS = ['#3b82f6', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444', '#6366f1'];

interface DrilldownRow {
  record: ForecastPipelineRecord;
  rawAum: number;
  simWinPct: number;
  expectedAum: number;
  cumulative: number;
  inScenario: boolean;
  inP10: boolean;
  inP50: boolean;
  inP90: boolean;
}

export default function MonteCarloPanel({ results, pipeline, onOppClick }: MonteCarloPanelProps) {
  const [showRates, setShowRates] = useState(false);
  const [activeScenario, setActiveScenario] = useState<ScenarioKey>(null);

  // Parse active scenario into quarter label + percentile
  const activeQuarter = useMemo(() => {
    if (!activeScenario) return null;
    const lastUnderscore = activeScenario.lastIndexOf('_');
    const quarterLabel = activeScenario.substring(0, lastUnderscore);
    const percentile = activeScenario.substring(lastUnderscore + 1) as 'p10' | 'p50' | 'p90';
    const qData = results.quarters.find(q => q.label === quarterLabel);
    if (!qData) return null;
    return { quarterLabel, percentile, qData, targetAum: qData[percentile] };
  }, [activeScenario, results.quarters]);

  // Build chart data from dynamic quarters
  const chartData = useMemo(() => {
    const data: Array<{ name: string; value: number; quarter: string; scenario: string; qIndex: number }> = [];
    for (let qi = 0; qi < results.quarters.length; qi++) {
      const q = results.quarters[qi];
      for (const pKey of ['p10', 'p50', 'p90'] as const) {
        data.push({
          name: `${q.label} ${PERCENTILE_META[pKey].suffix.split(' ')[0]}`,
          value: q[pKey],
          quarter: q.label,
          scenario: `${q.label}_${pKey}`,
          qIndex: qi,
        });
      }
    }
    return data;
  }, [results.quarters]);

  // Build per-opp lookup
  const perOppMap = useMemo(() => {
    const map = new Map<string, MonteCarloPerOpp>();
    if (results.perOpp) {
      for (const opp of results.perOpp) {
        map.set(`${opp.oppId}_${opp.quarterLabel}`, opp);
      }
    }
    return map;
  }, [results.perOpp]);

  // Drilldown with P10/P50/P90 membership for all three scenarios
  const drilldownData = useMemo(() => {
    if (!activeQuarter || !pipeline) return null;

    const { quarterLabel, qData } = activeQuarter;
    const meta = PERCENTILE_META[activeQuarter.percentile];
    const targetAum = activeQuarter.targetAum;

    const baseDealsList = pipeline
      .filter(r => r.projected_quarter === quarterLabel)
      .filter(r => !r.is_zero_aum)
      .map(r => {
        const sim = perOppMap.get(`${r.Full_Opportunity_ID__c}_${quarterLabel}`);
        const winPct = sim?.winPct ?? 0;
        const rawAum = r.Opportunity_AUM_M * 1e6;
        return { record: r, rawAum, simWinPct: winPct, expectedAum: winPct * rawAum };
      })
      .sort((a, b) => b.simWinPct - a.simWinPct || b.rawAum - a.rawAum);

    // First pass: compute cumulative AUM for the sorted list
    let cumulative = 0;
    const dealsWithCum = baseDealsList.map(d => {
      cumulative += d.rawAum;
      return { ...d, cumulative };
    });
    const totalAum = cumulative;

    // Membership: deal is "in" a scenario if its cumulative AUM <= target * 1.05
    // OR if total AUM never reaches the target (all deals are in)
    const isIn = (cum: number, target: number): boolean => {
      if (target > 0 && totalAum < target * 0.95) return true;
      return cum <= target * 1.05;
    };

    const deals: DrilldownRow[] = dealsWithCum.map(d => ({
      ...d,
      inScenario: isIn(d.cumulative, targetAum),
      inP10: isIn(d.cumulative, qData.p10),
      inP50: isIn(d.cumulative, qData.p50),
      inP90: isIn(d.cumulative, qData.p90),
    }));

    return {
      deals,
      targetAum,
      label: `${quarterLabel} ${meta.label}`,
      color: meta.color,
      quarterLabel,
      totalDeals: deals.length,
    };
  }, [activeQuarter, pipeline, perOppMap]);

  const toggleScenario = (key: string) => {
    setActiveScenario(prev => prev === key ? null : key);
  };

  const handleExportCSV = useCallback(() => {
    if (!drilldownData) return;

    const csvRows = drilldownData.deals.map((row, i) => ({
      '#': i + 1,
      'Opp ID': row.record.Full_Opportunity_ID__c,
      'Advisor': row.record.advisor_name,
      'SGM': row.record.SGM_Owner_Name__c ?? '',
      'SGA': row.record.SGA_Owner_Name__c ?? '',
      'Stage': row.record.StageName,
      'Days in Stage': row.record.days_in_current_stage,
      'AUM ($M)': row.record.Opportunity_AUM_M,
      'AUM Tier': row.record.aum_tier,
      'P(Join)': (row.record.p_join * 100).toFixed(1) + '%',
      'Won in (MC)': (row.simWinPct * 100).toFixed(1) + '%',
      'Expected AUM': Math.round(row.expectedAum),
      'Running Total': Math.round(row.cumulative),
      'In P10 (Bear)': row.inP10 ? 'YES' : 'NO',
      'In P50 (Base)': row.inP50 ? 'YES' : 'NO',
      'In P90 (Bull)': row.inP90 ? 'YES' : 'NO',
      'Projected Quarter': row.record.projected_quarter ?? '',
      'Model Join Date': row.record.model_projected_join_date ?? '',
      'Anticipated Join Date': row.record.Earliest_Anticipated_Start_Date__c ?? '',
      'Final Projected Join Date': row.record.final_projected_join_date ?? '',
      'Date Source': row.record.date_source,
      'Expected Days Remaining': row.record.expected_days_remaining,
      'Rate SQO→SP': row.record.rate_sqo_to_sp != null ? (row.record.rate_sqo_to_sp * 100).toFixed(1) + '%' : '',
      'Rate SP→Neg': row.record.rate_sp_to_neg != null ? (row.record.rate_sp_to_neg * 100).toFixed(1) + '%' : '',
      'Rate Neg→Signed': row.record.rate_neg_to_signed != null ? (row.record.rate_neg_to_signed * 100).toFixed(1) + '%' : '',
      'Rate Signed→Joined': row.record.rate_signed_to_joined != null ? (row.record.rate_signed_to_joined * 100).toFixed(1) + '%' : '',
      'Salesforce URL': row.record.salesforce_url,
    }));

    const filename = `forecast_${drilldownData.quarterLabel.replace(' ', '_')}_drilldown`;
    exportToCSV(csvRows, filename);
  }, [drilldownData]);

  return (
    <Card className="p-4">
      <Text className="font-semibold mb-4">Monte Carlo Simulation ({results.trialCount.toLocaleString()} trials)</Text>

      {/* Dynamic quarter cards */}
      <div className={`grid grid-cols-1 ${results.quarters.length <= 2 ? 'md:grid-cols-2' : results.quarters.length <= 3 ? 'md:grid-cols-3' : 'md:grid-cols-2 lg:grid-cols-4'} gap-6 mb-6`}>
        {results.quarters.map(q => (
          <div key={q.label}>
            <Text className="font-medium mb-2">{q.label}</Text>
            <div className="grid grid-cols-3 gap-3">
              {(['p10', 'p50', 'p90'] as const).map(pKey => {
                const scenarioKey = `${q.label}_${pKey}`;
                const meta = PERCENTILE_META[pKey];
                return (
                  <div
                    key={scenarioKey}
                    onClick={() => toggleScenario(scenarioKey)}
                    className={`bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center cursor-pointer transition-all hover:shadow-md ${
                      activeScenario === scenarioKey ? `ring-2 ${meta.ring} shadow-md` : ''
                    }`}
                  >
                    <p className="text-xs text-gray-500 mb-1">{meta.label}</p>
                    <p className={`text-sm font-bold ${meta.color}`}>{formatAum(q[pKey])}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">click to see deals</p>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Drilldown table */}
      {drilldownData && activeScenario && (
        <div className="mb-6 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <div className="bg-gray-50 dark:bg-gray-800 px-4 py-3">
            <div className="flex items-center justify-between">
              <span className={`font-semibold text-sm ${drilldownData.color}`}>
                {drilldownData.label} — {formatAum(drilldownData.targetAum)}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleExportCSV}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600"
                  title="Export drilldown as CSV"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export CSV
                </button>
                <button onClick={() => setActiveScenario(null)} className="p-1 text-gray-400 hover:text-gray-600">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Sorted by simulation win rate (most reliable closers first).
              &quot;Won in&quot; = % of {results.trialCount.toLocaleString()} trials where this deal closed.
              Running total shows cumulative AUM if these deals close, top-down.
            </p>
          </div>
          <div className="overflow-x-auto max-h-[28rem] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white dark:bg-gray-900 z-10">
                <tr className="border-b border-gray-200 dark:border-gray-700 text-left">
                  <th className="py-2 px-3 font-medium text-gray-500 w-6">#</th>
                  <th className="py-2 px-3 font-medium text-gray-500">Advisor</th>
                  <th className="py-2 px-3 font-medium text-gray-500">Stage</th>
                  <th className="py-2 px-3 text-right font-medium text-gray-500">AUM if Won</th>
                  <th className="py-2 px-3 text-right font-medium text-gray-500">Won in</th>
                  <th className="py-2 px-3 text-right font-medium text-gray-500">Expected AUM</th>
                  <th className="py-2 px-3 font-medium text-gray-500">Proj. Join</th>
                  <th className="py-2 px-3 text-center font-medium text-gray-500">P10</th>
                  <th className="py-2 px-3 text-center font-medium text-gray-500">P50</th>
                  <th className="py-2 px-3 text-center font-medium text-gray-500">P90</th>
                  <th className="py-2 px-3 text-right font-medium text-gray-500">Running Total</th>
                </tr>
              </thead>
              <tbody>
                {drilldownData.deals.map((row, i) => {
                  const isLastIn = row.inScenario &&
                    (i === drilldownData.deals.length - 1 || !drilldownData.deals[i + 1].inScenario);

                  return (
                    <React.Fragment key={row.record.Full_Opportunity_ID__c}>
                      <tr
                        className={`border-b transition-colors cursor-pointer ${
                          row.inScenario
                            ? 'bg-blue-50/50 dark:bg-blue-900/10 border-gray-100 dark:border-gray-800 hover:bg-blue-100/50 dark:hover:bg-blue-900/20'
                            : 'border-gray-100 dark:border-gray-800 opacity-50 hover:opacity-75'
                        }`}
                        onClick={() => onOppClick?.(row.record.Full_Opportunity_ID__c)}
                      >
                        <td className="py-2 px-3 text-gray-400 text-xs">{i + 1}</td>
                        <td className="py-2 px-3 font-medium text-gray-900 dark:text-gray-100 max-w-[180px] truncate">
                          {row.record.advisor_name}
                        </td>
                        <td className="py-2 px-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            row.record.StageName === 'Signed' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                            row.record.StageName === 'Negotiating' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' :
                            row.record.StageName === 'Sales Process' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' :
                            'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                          }`}>
                            {row.record.StageName}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-gray-500">
                          {formatAumShort(row.rawAum)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold">
                          {(row.simWinPct * 100).toFixed(1)}%
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-medium text-gray-900 dark:text-gray-100">
                          {formatAumShort(row.expectedAum)}
                        </td>
                        <td className="py-2 px-3 text-gray-500 text-xs whitespace-nowrap">
                          {row.record.final_projected_join_date?.substring(0, 10) || '-'}
                        </td>
                        <td className="py-2 px-3 text-center">
                          {row.inP10 ? (
                            <span className="inline-block w-2 h-2 rounded-full bg-red-500" title="In P10" />
                          ) : (
                            <span className="text-gray-300 text-xs">-</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-center">
                          {row.inP50 ? (
                            <span className="inline-block w-2 h-2 rounded-full bg-blue-500" title="In P50" />
                          ) : (
                            <span className="text-gray-300 text-xs">-</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-center">
                          {row.inP90 ? (
                            <span className="inline-block w-2 h-2 rounded-full bg-green-500" title="In P90" />
                          ) : (
                            <span className="text-gray-300 text-xs">-</span>
                          )}
                        </td>
                        <td className={`py-2 px-3 text-right font-mono ${
                          row.inScenario ? 'text-blue-600 dark:text-blue-400 font-semibold' : 'text-gray-400'
                        }`}>
                          {formatAum(row.cumulative)}
                        </td>
                      </tr>
                      {isLastIn && (
                        <tr>
                          <td colSpan={11} className="px-3 py-1">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 border-t-2 border-dashed border-blue-400" />
                              <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 whitespace-nowrap">
                                {drilldownData.label} target: {formatAum(drilldownData.targetAum)}
                              </span>
                              <div className="flex-1 border-t-2 border-dashed border-blue-400" />
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="bg-gray-50 dark:bg-gray-800 px-4 py-2 text-xs text-gray-500">
            Sorted by simulation win rate — most reliable closers first. In bear scenarios, these are the deals most likely to have actually closed.
            Each deal closes independently per trial, so the exact mix varies. Win rates change each simulation run.
          </div>
        </div>
      )}

      {/* Chart */}
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
          <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={50} />
          <YAxis tickFormatter={(v) => formatAum(Number(v))} tick={{ fontSize: 11 }} />
          <Tooltip formatter={(value) => formatAum(Number(value))} />
          <Bar
            dataKey="value"
            radius={[4, 4, 0, 0]}
            cursor="pointer"
            onClick={(_data, index) => {
              if (typeof index === 'number' && chartData[index]?.scenario) {
                toggleScenario(chartData[index].scenario);
              }
            }}
          >
            {chartData.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={QUARTER_COLORS[entry.qIndex % QUARTER_COLORS.length]}
                opacity={activeScenario && activeScenario !== entry.scenario ? 0.3 : 1}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Rates disclosure */}
      <button
        onClick={() => setShowRates(!showRates)}
        className="flex items-center gap-1 mt-4 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
      >
        {showRates ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        Rates used
      </button>
      {showRates && (
        <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <div className="bg-gray-50 dark:bg-gray-800 rounded p-2">
            <p className="text-gray-500">SQO→SP</p>
            <p className="font-mono">{(results.ratesUsed.sqo_to_sp * 100).toFixed(1)}%</p>
          </div>
          <div className="bg-gray-50 dark:bg-gray-800 rounded p-2">
            <p className="text-gray-500">SP→Neg</p>
            <p className="font-mono">{(results.ratesUsed.sp_to_neg * 100).toFixed(1)}%</p>
          </div>
          <div className="bg-gray-50 dark:bg-gray-800 rounded p-2">
            <p className="text-gray-500">Neg→Signed</p>
            <p className="font-mono">{(results.ratesUsed.neg_to_signed * 100).toFixed(1)}%</p>
          </div>
          <div className="bg-gray-50 dark:bg-gray-800 rounded p-2">
            <p className="text-gray-500">Signed→Joined</p>
            <p className="font-mono">{(results.ratesUsed.signed_to_joined * 100).toFixed(1)}%</p>
          </div>
        </div>
      )}
    </Card>
  );
}
