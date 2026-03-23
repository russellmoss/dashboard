'use client';

import React, { useState, useMemo } from 'react';
import { Card, Text } from '@tremor/react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { MonteCarloResponse } from '@/lib/queries/forecast-monte-carlo';
import { ForecastPipelineRecord } from '@/lib/queries/forecast-pipeline';
import { ChevronDown, ChevronUp, X } from 'lucide-react';

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

type ScenarioKey = 'q2_p10' | 'q2_p50' | 'q2_p90' | 'q3_p10' | 'q3_p50' | 'q3_p90' | null;

const SCENARIO_META: Record<Exclude<ScenarioKey, null>, { quarter: 'Q2' | 'Q3'; label: string; color: string }> = {
  q2_p10: { quarter: 'Q2', label: 'Q2 P10 (Bear)', color: 'text-red-600' },
  q2_p50: { quarter: 'Q2', label: 'Q2 P50 (Base)', color: 'text-blue-600' },
  q2_p90: { quarter: 'Q2', label: 'Q2 P90 (Bull)', color: 'text-green-600' },
  q3_p10: { quarter: 'Q3', label: 'Q3 P10 (Bear)', color: 'text-red-600' },
  q3_p50: { quarter: 'Q3', label: 'Q3 P50 (Base)', color: 'text-blue-600' },
  q3_p90: { quarter: 'Q3', label: 'Q3 P90 (Bull)', color: 'text-green-600' },
};

function getScenarioValue(results: MonteCarloResponse, key: Exclude<ScenarioKey, null>): number {
  const map: Record<string, number> = {
    q2_p10: results.q2.p10, q2_p50: results.q2.p50, q2_p90: results.q2.p90,
    q3_p10: results.q3.p10, q3_p50: results.q3.p50, q3_p90: results.q3.p90,
  };
  return map[key];
}

export default function MonteCarloPanel({ results, pipeline, onOppClick }: MonteCarloPanelProps) {
  const [showRates, setShowRates] = useState(false);
  const [activeScenario, setActiveScenario] = useState<ScenarioKey>(null);

  const chartData = [
    { name: 'Q2 P10', value: results.q2.p10, quarter: 'Q2', scenario: 'q2_p10' as ScenarioKey },
    { name: 'Q2 P50', value: results.q2.p50, quarter: 'Q2', scenario: 'q2_p50' as ScenarioKey },
    { name: 'Q2 P90', value: results.q2.p90, quarter: 'Q2', scenario: 'q2_p90' as ScenarioKey },
    { name: 'Q3 P10', value: results.q3.p10, quarter: 'Q3', scenario: 'q3_p10' as ScenarioKey },
    { name: 'Q3 P50', value: results.q3.p50, quarter: 'Q3', scenario: 'q3_p50' as ScenarioKey },
    { name: 'Q3 P90', value: results.q3.p90, quarter: 'Q3', scenario: 'q3_p90' as ScenarioKey },
  ];

  // Build the drilldown: deals sorted by P(Close) desc with running total
  // Deals "in" the scenario = those whose cumulative AUM ≤ scenario target
  const drilldownData = useMemo(() => {
    if (!activeScenario || !pipeline) return null;

    const meta = SCENARIO_META[activeScenario];
    const targetAum = getScenarioValue(results, activeScenario);
    const quarter = meta.quarter;

    // Get all deals projected for this quarter, sorted by P(Close) desc
    const deals = pipeline
      .filter(r => quarter === 'Q2' ? r.is_q2_2026 : r.is_q3_2026)
      .filter(r => !r.is_zero_aum)
      .sort((a, b) => b.p_join - a.p_join);

    // Walk through deals, accumulating AUM until we reach the target
    let cumulative = 0;
    const rows = deals.map(r => {
      const rawAum = r.Opportunity_AUM_M * 1e6;
      cumulative += rawAum;
      return {
        record: r,
        rawAum,
        cumulative,
        inScenario: cumulative <= targetAum * 1.05, // 5% tolerance for rounding
      };
    });

    // If cumulative never reaches target (P90 exceeds total raw AUM),
    // mark all deals as in-scenario
    if (targetAum > 0 && cumulative < targetAum * 0.95) {
      rows.forEach(r => r.inScenario = true);
    }

    return { deals: rows, targetAum, meta, totalDeals: deals.length };
  }, [activeScenario, pipeline, results]);

  const toggleScenario = (key: ScenarioKey) => {
    setActiveScenario(prev => prev === key ? null : key);
  };

  const scenarioCards = (quarter: 'Q2' | 'Q3') => {
    const items = quarter === 'Q2'
      ? [
          { key: 'q2_p10' as ScenarioKey, label: 'P10 (Bear)', value: results.q2.p10, color: 'text-red-600', ring: 'ring-red-400' },
          { key: 'q2_p50' as ScenarioKey, label: 'P50 (Base)', value: results.q2.p50, color: 'text-blue-600', ring: 'ring-blue-400' },
          { key: 'q2_p90' as ScenarioKey, label: 'P90 (Bull)', value: results.q2.p90, color: 'text-green-600', ring: 'ring-green-400' },
        ]
      : [
          { key: 'q3_p10' as ScenarioKey, label: 'P10 (Bear)', value: results.q3.p10, color: 'text-red-600', ring: 'ring-red-400' },
          { key: 'q3_p50' as ScenarioKey, label: 'P50 (Base)', value: results.q3.p50, color: 'text-blue-600', ring: 'ring-blue-400' },
          { key: 'q3_p90' as ScenarioKey, label: 'P90 (Bull)', value: results.q3.p90, color: 'text-green-600', ring: 'ring-green-400' },
        ];

    return (
      <div>
        <Text className="font-medium mb-2">{quarter} 2026</Text>
        <div className="grid grid-cols-3 gap-3">
          {items.map(item => (
            <div
              key={item.key}
              onClick={() => toggleScenario(item.key)}
              className={`bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center cursor-pointer transition-all hover:shadow-md ${
                activeScenario === item.key ? `ring-2 ${item.ring} shadow-md` : ''
              }`}
            >
              <p className="text-xs text-gray-500 mb-1">{item.label}</p>
              <p className={`text-sm font-bold ${item.color}`}>{formatAum(item.value)}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">click to see deals</p>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <Card className="p-4">
      <Text className="font-semibold mb-4">Monte Carlo Simulation ({results.trialCount.toLocaleString()} trials)</Text>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {scenarioCards('Q2')}
        {scenarioCards('Q3')}
      </div>

      {/* Drilldown table */}
      {drilldownData && activeScenario && (
        <div className="mb-6 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <div className="bg-gray-50 dark:bg-gray-800 px-4 py-3">
            <div className="flex items-center justify-between">
              <span className={`font-semibold text-sm ${drilldownData.meta.color}`}>
                {drilldownData.meta.label} — {formatAum(drilldownData.targetAum)}
              </span>
              <button onClick={() => setActiveScenario(null)} className="p-1 text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Deals sorted by probability of closing (highest first). The running total shows how the AUM accumulates to reach the {drilldownData.meta.label.split(' ')[1]} scenario value.
              Deals above the line are the ones most likely to make up this outcome.
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
                  <th className="py-2 px-3 text-right font-medium text-gray-500">P(Close)</th>
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
                        <td className="py-2 px-3 text-right font-mono font-medium text-gray-900 dark:text-gray-100">
                          {formatAumShort(row.rawAum)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold">
                          {(row.record.p_join * 100).toFixed(1)}%
                        </td>
                        <td className={`py-2 px-3 text-right font-mono ${
                          row.inScenario ? 'text-blue-600 dark:text-blue-400 font-semibold' : 'text-gray-400'
                        }`}>
                          {formatAum(row.cumulative)}
                        </td>
                      </tr>
                      {isLastIn && (
                        <tr>
                          <td colSpan={6} className="px-3 py-1">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 border-t-2 border-dashed border-blue-400" />
                              <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 whitespace-nowrap">
                                {drilldownData.meta.label} target: {formatAum(drilldownData.targetAum)} — {i + 1} deals above this line
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
            Deals above the dashed line are the highest-probability wins that accumulate to the scenario total.
            In the Monte Carlo, each deal independently closes or doesn&apos;t — so the actual mix varies per trial, but these are the most likely contributors.
          </div>
        </div>
      )}

      {/* Chart */}
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
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
                fill={entry.quarter === 'Q2' ? '#3b82f6' : '#8b5cf6'}
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
