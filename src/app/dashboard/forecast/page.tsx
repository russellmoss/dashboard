'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import nextDynamic from 'next/dynamic';
import { Title, Text } from '@tremor/react';
import { Loader2 } from 'lucide-react';

import { dashboardApi } from '@/lib/api-client';
import { getSessionPermissions } from '@/types/auth';
import { ForecastRates } from '@/lib/queries/forecast-rates';
import { ForecastPipelineRecord, ForecastSummary } from '@/lib/queries/forecast-pipeline';
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

  const [windowDays, setWindowDays] = useState<90 | 180 | 365 | null>(365);
  const [rates, setRates] = useState<ForecastRates | null>(null);
  const [pipeline, setPipeline] = useState<ForecastPipelineRecord[]>([]);
  const [summary, setSummary] = useState<ForecastSummary | null>(null);
  const [monteCarloResults, setMonteCarloResults] = useState<MonteCarloResponse | null>(null);
  const [selectedOppId, setSelectedOppId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mcLoading, setMcLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ratesRes, pipelineRes] = await Promise.all([
        dashboardApi.getForecastRates(windowDays),
        dashboardApi.getForecastPipeline(),
      ]);
      setRates(ratesRes.rates);
      setPipeline(pipelineRes.records);
      setSummary(pipelineRes.summary);
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

  // Auto-load shared scenario from URL
  useEffect(() => {
    const scenarioToken = searchParams.get('scenario');
    if (scenarioToken && status === 'authenticated') {
      dashboardApi.getSharedScenario(scenarioToken)
        .then(({ scenario }) => {
          if (scenario) {
            setMonteCarloResults({
              q2: {
                p10: scenario.q2_p10_aum || 0,
                p50: scenario.q2_p50_aum || 0,
                p90: scenario.q2_p90_aum || 0,
                mean: scenario.q2_p50_aum || 0,
              },
              q3: {
                p10: scenario.q3_p10_aum || 0,
                p50: scenario.q3_p50_aum || 0,
                p90: scenario.q3_p90_aum || 0,
                mean: scenario.q3_p50_aum || 0,
              },
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

  const handleExport = useCallback(async () => {
    setExportStatus('Exporting...');
    try {
      const data = await dashboardApi.exportForecastToSheets();
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
  }, []);

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
        totalOpps={summary?.total_opps ?? 0}
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
            summary={summary}
            windowDays={windowDays}
            rates={rates}
          />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <ExpectedAumChart pipeline={pipeline} />
            </div>
            <div>
              <ConversionRatesPanel rates={rates} />
            </div>
          </div>

          {monteCarloResults && (
            <MonteCarloPanel results={monteCarloResults} pipeline={pipeline} onOppClick={handleOppClick} />
          )}

          {canRunScenarios && (
            <ScenarioRunner
              rates={rates}
              summary={summary}
              monteCarloResults={monteCarloResults}
              onRunMonteCarlo={handleRunMonteCarlo}
              mcLoading={mcLoading}
            />
          )}

          <SavedScenariosList
            canRunScenarios={canRunScenarios}
            onLoadScenario={(scenario) => {
              setMonteCarloResults({
                q2: {
                  p10: scenario.q2_p10_aum || 0,
                  p50: scenario.q2_p50_aum || 0,
                  p90: scenario.q2_p90_aum || 0,
                  mean: scenario.q2_p50_aum || 0,
                },
                q3: {
                  p10: scenario.q3_p10_aum || 0,
                  p50: scenario.q3_p50_aum || 0,
                  p90: scenario.q3_p90_aum || 0,
                  mean: scenario.q3_p50_aum || 0,
                },
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
            records={pipeline}
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
