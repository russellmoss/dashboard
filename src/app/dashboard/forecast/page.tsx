'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import nextDynamic from 'next/dynamic';
import { Title, Text } from '@tremor/react';
import { Loader2 } from 'lucide-react';

import { dashboardApi } from '@/lib/api-client';
import { getSessionPermissions } from '@/types/auth';
import { TieredForecastRates } from '@/lib/queries/forecast-rates';
import { computeAdjustedDeal } from '@/lib/forecast-penalties';
import { ForecastPipelineRecord, ForecastSummary, QuarterSummary } from '@/lib/queries/forecast-pipeline';
import { MonteCarloResponse } from '@/lib/queries/forecast-monte-carlo';

import { ForecastTopBar } from './components/ForecastTopBar';
import { ForecastMetricCards } from './components/ForecastMetricCards';
import { ConversionRatesPanel } from './components/ConversionRatesPanel';
import { PipelineDetailTable } from './components/PipelineDetailTable';
import { AdvisorForecastModal } from './components/AdvisorForecastModal';
import { ScenarioRunner } from './components/ScenarioRunner';
import { SavedScenariosList } from './components/SavedScenariosList';

const ExpectedAumChart = nextDynamic(
  () => import('./components/ExpectedAumChart'),
  {
    ssr: false,
    loading: () => <div className="h-64 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-lg" />,
  }
);

const MonteCarloPanel = nextDynamic(
  () => import('./components/MonteCarloPanel'),
  {
    ssr: false,
    loading: () => <div className="h-64 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-lg" />,
  }
);

export default function ForecastPage() {
  const { data: session, status } = useSession();
  const searchParams = useSearchParams();
  const permissions = getSessionPermissions(session);
  const canRunScenarios = permissions?.canRunScenarios ?? false;

  const [windowDays, setWindowDays] = useState<180 | 365 | 730 | null>(365);
  const [rates, setRates] = useState<TieredForecastRates | null>(null);
  const [pipeline, setPipeline] = useState<ForecastPipelineRecord[]>([]);
  const [summary, setSummary] = useState<ForecastSummary | null>(null);
  const [monteCarloResults, setMonteCarloResults] = useState<MonteCarloResponse | null>(null);
  const [selectedOppId, setSelectedOppId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mcLoading, setMcLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [dateRevisions, setDateRevisions] = useState<Record<string, { revisionCount: number; firstDateSet: string | null; dateConfidence: string }>>({});
  const [targetAumByQuarter, setTargetAumByQuarter] = useState<Record<string, number>>({});
  const [joinedAumByQuarter, setJoinedAumByQuarter] = useState<Record<string, { joined_aum: number; joined_count: number }>>({});
  const hasSharedScenario = useRef(!!searchParams.get('scenario'));

  // Recompute p_join, expected_aum_weighted, projected dates, and summary
  // using the active window's rates (instead of the view's baked-in rates)
  const { adjustedPipeline, adjustedSummary } = useMemo(() => {
    if (!rates || pipeline.length === 0) {
      return { adjustedPipeline: pipeline, adjustedSummary: summary };
    }

    const { avg_days_in_sp, avg_days_in_neg, avg_days_in_signed } = rates.flat;

    // Build tiered rates shape for computeAdjustedDeal
    const tieredRates = {
      flat: rates.flat,
      lower: rates.lower,
      upper: rates.upper,
    };

    const adjusted: ForecastPipelineRecord[] = pipeline.map(r => {
      const aumRaw = r.Opportunity_AUM_M * 1e6;

      // Compute duration-penalized, tier-adjusted P(Join)
      const deal = computeAdjustedDeal(r.StageName, r.days_in_current_stage, aumRaw, tieredRates);

      // Recalculate expected days remaining (uses flat avg_days — doesn't vary by tier)
      let totalDaysFromStage = 0;
      switch (r.StageName) {
        case 'Discovery':
        case 'Qualifying':
          totalDaysFromStage = avg_days_in_sp + avg_days_in_neg + avg_days_in_signed;
          break;
        case 'Sales Process':
          totalDaysFromStage = avg_days_in_neg + avg_days_in_signed;
          break;
        case 'Negotiating':
          totalDaysFromStage = avg_days_in_signed;
          break;
        case 'Signed':
          totalDaysFromStage = 0;
          break;
      }
      const daysRemaining = Math.max(0, totalDaysFromStage - r.days_in_current_stage);

      // Recalculate projected join date (use anticipated if set, else model)
      let finalDate = r.Earliest_Anticipated_Start_Date__c;
      let dateSource: 'Anticipated' | 'Model' = 'Anticipated';
      if (!finalDate) {
        const projected = new Date();
        projected.setDate(projected.getDate() + daysRemaining);
        finalDate = projected.toISOString().split('T')[0];
        dateSource = 'Model';
      }

      // Compute projected quarter from final date
      let projectedQuarter: string | null = null;
      if (finalDate) {
        const d = new Date(finalDate);
        const q = Math.ceil((d.getMonth() + 1) / 3);
        projectedQuarter = `Q${q} ${d.getFullYear()}`;
      }

      // Adjusted expected AUM (primary display value)
      const expectedAum = r.is_zero_aum ? 0 : aumRaw * deal.adjustedPJoin;
      // Baseline expected AUM (for comparison)
      const baselineExpectedAum = r.is_zero_aum ? 0 : aumRaw * deal.baselinePJoin;

      // Date revision confidence
      const rev = dateRevisions[r.Full_Opportunity_ID__c];
      const dateRevisionCount = rev?.revisionCount ?? 0;
      const dateConfidence = (rev?.dateConfidence as 'High' | 'Medium' | 'Low') ?? 'High';
      const firstDateSet = rev?.firstDateSet ?? null;

      return {
        ...r,
        p_join: deal.adjustedPJoin,
        expected_days_remaining: daysRemaining,
        final_projected_join_date: finalDate,
        date_source: dateSource,
        projected_quarter: projectedQuarter,
        expected_aum_weighted: expectedAum,
        // Duration penalty fields
        durationBucket: deal.durationBucket,
        durationMultiplier: deal.durationMultiplier,
        baselinePJoin: deal.baselinePJoin,
        baselineExpectedAum,
        aumTier2: deal.tier,
        // Date revision confidence
        dateRevisionCount,
        dateConfidence: r.Earliest_Anticipated_Start_Date__c ? dateConfidence : undefined,
        firstDateSet,
      };
    });

    // Build summary with dynamic quarters
    const quarterMap = new Map<string, { opp_count: number; expected_aum: number }>();
    for (const r of adjusted) {
      if (r.projected_quarter) {
        const existing = quarterMap.get(r.projected_quarter);
        if (existing) {
          existing.opp_count += 1;
          existing.expected_aum += r.expected_aum_weighted;
        } else {
          quarterMap.set(r.projected_quarter, { opp_count: 1, expected_aum: r.expected_aum_weighted });
        }
      }
    }
    const quarters: QuarterSummary[] = Array.from(quarterMap.entries())
      .map(([label, data]) => ({ label, ...data }))
      .sort((a, b) => {
        const [aq, ay] = a.label.replace('Q', '').split(' ').map(Number);
        const [bq, by] = b.label.replace('Q', '').split(' ').map(Number);
        return ay !== by ? ay - by : aq - bq;
      });

    const adjSummary: ForecastSummary = {
      total_opps: adjusted.length,
      pipeline_total_aum: adjusted.reduce((sum, r) => sum + r.Opportunity_AUM_M, 0),
      zero_aum_count: adjusted.filter(r => r.is_zero_aum).length,
      anticipated_date_count: adjusted.filter(r => r.date_source === 'Anticipated').length,
      quarters,
    };

    return { adjustedPipeline: adjusted, adjustedSummary: adjSummary };
  }, [pipeline, rates, summary, dateRevisions]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ratesRes, pipelineRes, revisionsRes, targetsRes] = await Promise.all([
        dashboardApi.getForecastRates(windowDays),
        dashboardApi.getForecastPipeline(),
        dashboardApi.getDateRevisions().catch(() => ({ revisions: {} })),
        dashboardApi.getSQOTargets().catch(() => ({ targets: {} })),
      ]);
      setRates(ratesRes.rates);
      setPipeline(pipelineRes.records);
      setSummary(pipelineRes.summary);
      setJoinedAumByQuarter(pipelineRes.joinedByQuarter ?? {});
      setDateRevisions(revisionsRes.revisions);
      setTargetAumByQuarter(targetsRes.targets);
    } catch (err) {
      console.error('Forecast data fetch error:', err);
      setError('Failed to load forecast data');
    } finally {
      setLoading(false);
    }
  }, [windowDays]);

  useEffect(() => {
    if (status === 'authenticated') {
      fetchData();
    }
  }, [status, fetchData]);

  // Auto-run Monte Carlo after data loads (on first load and when window changes)
  useEffect(() => {
    if (!loading && rates && !hasSharedScenario.current) {
      handleRunMonteCarlo();
    }
    // Clear the shared scenario flag after first load so window changes still auto-run
    if (!loading && hasSharedScenario.current && rates) {
      hasSharedScenario.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, rates]);

  // Auto-load shared scenario from URL
  useEffect(() => {
    const scenarioToken = searchParams.get('scenario');
    if (scenarioToken && status === 'authenticated') {
      dashboardApi.getSharedScenario(scenarioToken)
        .then(({ scenario }) => {
          if (scenario) {
            const quarters = scenario.quartersJson ?? [];
            setMonteCarloResults({
              quarters,
              perOpp: [],
              trialCount: scenario.trialCount,
              ratesUsed: {
                sqo_to_sp: scenario.rateOverride_sqo_to_sp,
                sp_to_neg: scenario.rateOverride_sp_to_neg,
                neg_to_signed: scenario.rateOverride_neg_to_signed,
                signed_to_joined: scenario.rateOverride_signed_to_joined,
              },
            });
          }
        })
        .catch(err => console.error('Failed to load shared scenario:', err));
    }
  }, [searchParams, status]);

  const handleRunMonteCarlo = useCallback(async (rateOverrides?: {
    sqo_to_sp: number;
    sp_to_neg: number;
    neg_to_signed: number;
    signed_to_joined: number;
  }) => {
    setMcLoading(true);
    try {
      const result = await dashboardApi.runMonteCarlo({
        conversionRates: rateOverrides,
        conversionWindowDays: windowDays,
      });
      setMonteCarloResults(result);
    } catch (err) {
      console.error('Monte Carlo error:', err);
      setError('Monte Carlo simulation failed');
    } finally {
      setMcLoading(false);
    }
  }, [windowDays]);

  const handleTargetChange = useCallback(async (quarter: string, value: number) => {
    setTargetAumByQuarter(prev => ({ ...prev, [quarter]: value }));
    if (value > 0) {
      try {
        await dashboardApi.saveSQOTarget(quarter, value);
      } catch (err) {
        console.error('Failed to save SQO target:', err);
      }
    }
  }, []);

  const handleExport = useCallback(async () => {
    setExportStatus('Exporting...');
    try {
      const data = await dashboardApi.exportForecastToSheets(windowDays, targetAumByQuarter);
      if (data.success) {
        setExportStatus(`Exported ${data.p2RowCount} forecast + ${data.auditRowCount} audit rows`);
        window.open(data.spreadsheetUrl, '_blank');
      } else {
        setExportStatus('Export failed');
      }
    } catch {
      setExportStatus('Export failed');
    }
    setTimeout(() => setExportStatus(null), 5000);
  }, [windowDays]);

  const handleOppClick = useCallback((oppId: string) => {
    setSelectedOppId(oppId);
    setModalOpen(true);
  }, []);

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (status !== 'authenticated') {
    return null;
  }

  return (
    <div className="space-y-6">
      <div>
        <Title>Pipeline Forecast</Title>
        <Text>Probability-weighted pipeline forecast with Monte Carlo simulation</Text>
      </div>

      <ForecastTopBar
        windowDays={windowDays}
        onWindowChange={setWindowDays}
        canRunScenarios={canRunScenarios}
        onRunMonteCarlo={() => handleRunMonteCarlo()}
        onExport={handleExport}
        mcLoading={mcLoading}
        totalOpps={adjustedSummary?.total_opps ?? 0}
        exportStatus={exportStatus}
      />

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-700 dark:text-red-400 text-sm">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-32 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-lg" />
          ))}
        </div>
      ) : (
        <>
          <ForecastMetricCards
            summary={adjustedSummary}
            windowDays={windowDays}
            rates={rates?.flat ?? null}
            targetAumByQuarter={targetAumByQuarter}
            joinedAumByQuarter={joinedAumByQuarter}
            onTargetChange={handleTargetChange}
          />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <ExpectedAumChart pipeline={adjustedPipeline} />
            </div>
            <div>
              <ConversionRatesPanel rates={rates?.flat ?? null} />
            </div>
          </div>

          {monteCarloResults && (
            <MonteCarloPanel results={monteCarloResults} pipeline={adjustedPipeline} onOppClick={handleOppClick} />
          )}

          {canRunScenarios && (
            <ScenarioRunner
              rates={rates?.flat ?? null}
              summary={adjustedSummary}
              monteCarloResults={monteCarloResults}
              onRunMonteCarlo={handleRunMonteCarlo}
              mcLoading={mcLoading}
            />
          )}

          <SavedScenariosList
            canRunScenarios={canRunScenarios}
            onLoadScenario={(scenario) => {
              const quarters = scenario.quartersJson ?? [];
              setMonteCarloResults({
                quarters,
                perOpp: [],
                trialCount: scenario.trialCount,
                ratesUsed: {
                  sqo_to_sp: scenario.rateOverride_sqo_to_sp,
                  sp_to_neg: scenario.rateOverride_sp_to_neg,
                  neg_to_signed: scenario.rateOverride_neg_to_signed,
                  signed_to_joined: scenario.rateOverride_signed_to_joined,
                },
              });
            }}
          />

          <PipelineDetailTable
            records={adjustedPipeline}
            onRowClick={handleOppClick}
          />
        </>
      )}

      <AdvisorForecastModal
        isOpen={modalOpen}
        onClose={() => { setModalOpen(false); setSelectedOppId(null); }}
        oppId={selectedOppId}
      />
    </div>
  );
}
