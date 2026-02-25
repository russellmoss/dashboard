'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useTheme } from 'next-themes';
import { Title, Text, Card } from '@tremor/react';
import { Loader2 } from 'lucide-react';

import { dashboardApi } from '@/lib/api-client';
import { getSessionPermissions } from '@/types/auth';
import { OPEN_PIPELINE_STAGES, ON_HOLD_STAGE } from '@/config/constants';
import { OpenPipelineSummary, DetailRecord, SqlDateRange, SgmConversionData } from '@/types/dashboard';
import { buildDateRangeFromSqlFilter } from '@/lib/utils/date-helpers';

import { PipelineScorecard } from '@/components/dashboard/PipelineScorecard';
import { PipelineByStageChart } from '@/components/dashboard/PipelineByStageChart';
import { PipelineBySgmChart } from '@/components/dashboard/PipelineBySgmChart';
import { PipelineFilters } from '@/components/dashboard/PipelineFilters';
import { PipelineExportPng } from '@/components/dashboard/PipelineExportPng';
import { VolumeDrillDownModal } from '@/components/dashboard/VolumeDrillDownModal';
import { RecordDetailModal } from '@/components/dashboard/RecordDetailModal';
import { SqlDateFilter } from '@/components/dashboard/SqlDateFilter';
import { SgmConversionTable } from '@/components/dashboard/SgmConversionTable';
import { StalePipelineAlerts } from '@/components/dashboard/StalePipelineAlerts';
import { SgmOption, SgmPipelineChartData } from '@/types/dashboard';

export default function PipelinePage() {
  const { data: session, status } = useSession();
  const permissions = getSessionPermissions(session);

  // Debug logging for Vercel
  useEffect(() => {
    console.log('[Pipeline] Session status:', status);
    console.log('[Pipeline] Session data:', session);
    console.log('[Pipeline] Permissions:', permissions);
    console.log('[Pipeline] Role:', permissions?.role);
  }, [session, status, permissions]);

  const isRevOpsAdmin = permissions?.role === 'revops_admin';

  // Data state
  const [summary, setSummary] = useState<OpenPipelineSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // SGM options state
  const [sgmOptions, setSgmOptions] = useState<SgmOption[]>([]);
  const [sgmOptionsLoading, setSgmOptionsLoading] = useState(true);
  
  // Filter state - defaults
  const [selectedStages, setSelectedStages] = useState<string[]>([...OPEN_PIPELINE_STAGES]);
  const [selectedSgms, setSelectedSgms] = useState<string[]>([]);
  
  // Fetch SGM options on mount
  useEffect(() => {
    const fetchSgmOptions = async () => {
      setSgmOptionsLoading(true);
      try {
        const { sgmOptions: options } = await dashboardApi.getPipelineSgmOptions();
        setSgmOptions(options);
        // Default: select all SGMs
        setSelectedSgms(options.map(o => o.value));
      } catch (err) {
        console.error('Error fetching SGM options:', err);
        setSgmOptions([]);
        setSelectedSgms([]);
      } finally {
        setSgmOptionsLoading(false);
      }
    };
    
    if (status === 'authenticated') {
      fetchSgmOptions();
    }
  }, [status]);
  
  // Drill-down modal state
  const [drillDownOpen, setDrillDownOpen] = useState(false);
  const [drillDownRecords, setDrillDownRecords] = useState<DetailRecord[]>([]);
  const [drillDownLoading, setDrillDownLoading] = useState(false);
  const [drillDownStage, setDrillDownStage] = useState<string | null>(null);
  const [drillDownMetric, setDrillDownMetric] = useState<'aum' | 'count' | null>(null);
  
  // Record detail modal state
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);

  // Tab state (By Stage vs By SGM) — revops_admin only feature
  const [activeTab, setActiveTab] = useState<'byStage' | 'bySgm'>('byStage');

  // By SGM data
  const [bySgmData, setBySgmData] = useState<SgmPipelineChartData[]>([]);
  const [bySgmLoading, setBySgmLoading] = useState(false);

  // SGM drill-down tracking
  const [drillDownSgm, setDrillDownSgm] = useState<string | null>(null);
  /** When set, drill-down was opened from conversion table (SQLs / SQO'd / Joined click) */
  const [drillDownConversionMetric, setDrillDownConversionMetric] = useState<'sql' | 'sqo' | 'joined' | null>(null);

  // Stale pipeline alerts
  const [staleRecords, setStaleRecords] = useState<DetailRecord[]>([]);
  const [staleLoading, setStaleLoading] = useState(false);

  // SQL Date Filter state (null = "All Time")
  const [sqlDateRange, setSqlDateRange] = useState<SqlDateRange | null>(null);

  // Conversion Table state
  const [conversionData, setConversionData] = useState<SgmConversionData[]>([]);
  const [conversionLoading, setConversionLoading] = useState(false);

  // Dark mode detection (for chart component - chart uses useTheme internally)
  const { resolvedTheme } = useTheme();
  
  // Fetch pipeline data
  const fetchData = useCallback(async () => {
    if (sgmOptionsLoading || selectedSgms.length === 0) return;
    
    setLoading(true);
    setError(null);
    
    try {
      // Only pass SGMs if not all are selected (optimization)
      const sgmsToSend = selectedSgms.length === sgmOptions.length ? undefined : selectedSgms;
      const data = await dashboardApi.getPipelineSummary(selectedStages, sgmsToSend);
      setSummary(data);
    } catch (err) {
      console.error('Error fetching pipeline data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load pipeline data');
    } finally {
      setLoading(false);
    }
  }, [selectedStages, selectedSgms, sgmOptions.length, sgmOptionsLoading]);
  
  // Fetch on mount and when stages change
  useEffect(() => {
    if (status === 'authenticated') {
      fetchData();
    }
  }, [status, fetchData]);

  // Fetch By SGM data
  const fetchBySgmData = useCallback(async () => {
    if (activeTab !== 'bySgm') return;
    setBySgmLoading(true);
    try {
      const sgmsToSend = selectedSgms.length === sgmOptions.length ? undefined :
        selectedSgms.length === 0 ? undefined : selectedSgms;
      const dateRange = sqlDateRange ? buildDateRangeFromSqlFilter(sqlDateRange) : null;
      const result = await dashboardApi.getPipelineBySgm(
        selectedStages.length > 0 ? selectedStages : undefined,
        sgmsToSend,
        dateRange
      );
      setBySgmData(result.data);
    } catch (err) {
      console.error('Error fetching by-SGM data:', err);
      setBySgmData([]);
    } finally {
      setBySgmLoading(false);
    }
  }, [activeTab, selectedStages, selectedSgms, sgmOptions.length, sqlDateRange]);

  // Fetch Conversion Table data
  const fetchConversionData = useCallback(async () => {
    if (activeTab !== 'bySgm') return;
    setConversionLoading(true);
    try {
      const sgmsToSend = selectedSgms.length === sgmOptions.length ? undefined : selectedSgms;
      const dateRange = sqlDateRange ? buildDateRangeFromSqlFilter(sqlDateRange) : null;
      const result = await dashboardApi.getSgmConversions(sgmsToSend, dateRange);
      setConversionData(result.data);
    } catch (err) {
      console.error('Error fetching conversion data:', err);
      setConversionData([]);
    } finally {
      setConversionLoading(false);
    }
  }, [activeTab, selectedSgms, sgmOptions.length, sqlDateRange]);

  useEffect(() => {
    if (activeTab === 'bySgm' && isRevOpsAdmin) {
      fetchBySgmData();
      fetchConversionData();
    }
  }, [activeTab, isRevOpsAdmin, fetchBySgmData, fetchConversionData]);

  // Fetch all open pipeline records for stale alerts (both active stages and On Hold)
  const fetchStaleRecords = useCallback(async () => {
    if (sgmOptionsLoading || selectedSgms.length === 0) return;
    setStaleLoading(true);

    try {
      const sgmsToSend = selectedSgms.length === sgmOptions.length ? undefined : selectedSgms;
      const allRecords: DetailRecord[] = [];
      const recordIds = new Set<string>();

      // Include all selected active stages plus On Hold (always relevant for staleness)
      const stagesToFetch = [...selectedStages, ON_HOLD_STAGE];

      for (const stage of stagesToFetch) {
        try {
          const result = await dashboardApi.getPipelineDrilldown(stage, undefined, sgmsToSend);
          for (const record of result.records) {
            if (!recordIds.has(record.id)) {
              recordIds.add(record.id);
              allRecords.push(record);
            }
          }
        } catch (err) {
          console.error(`[StaleAlerts] Error fetching stage ${stage}:`, err);
        }
      }

      setStaleRecords(allRecords);
    } catch (err) {
      console.error('[StaleAlerts] Error:', err);
      setStaleRecords([]);
    } finally {
      setStaleLoading(false);
    }
  }, [selectedStages, selectedSgms, sgmOptions.length, sgmOptionsLoading]);

  useEffect(() => {
    if (status === 'authenticated') {
      fetchStaleRecords();
    }
  }, [status, fetchStaleRecords]);

  // Handle bar click for drill-down
  const handleBarClick = async (stage: string, metric: 'aum' | 'count') => {
    setDrillDownStage(stage);
    setDrillDownMetric(metric);
    setDrillDownOpen(true);
    setDrillDownLoading(true);
    
    try {
      // Pass SGMs filter to drill-down (only if not all selected)
      const sgmsToSend = selectedSgms.length === sgmOptions.length ? undefined : selectedSgms;
      const result = await dashboardApi.getPipelineDrilldown(stage, undefined, sgmsToSend);
      setDrillDownRecords(result.records);
    } catch (err) {
      console.error('Error fetching drill-down data:', err);
      setDrillDownRecords([]);
    } finally {
      setDrillDownLoading(false);
    }
  };
  
  // Handle AUM scorecard click - fetch all records across all selected stages
  const handleAumClick = async () => {
    setDrillDownStage(null);
    setDrillDownMetric(null);
    setDrillDownOpen(true);
    setDrillDownLoading(true);
    
    try {
      // Fetch records for all selected stages and combine them
      const sgmsToSend = selectedSgms.length === sgmOptions.length ? undefined : selectedSgms;
      const allRecords: DetailRecord[] = [];
      const recordIds = new Set<string>(); // To deduplicate if needed
      
      // Fetch records for each selected stage
      for (const stage of selectedStages) {
        try {
          const result = await dashboardApi.getPipelineDrilldown(stage, undefined, sgmsToSend);
          // Add records, avoiding duplicates by ID
          for (const record of result.records) {
            if (!recordIds.has(record.id)) {
              recordIds.add(record.id);
              allRecords.push(record);
            }
          }
        } catch (err) {
          console.error(`Error fetching records for stage ${stage}:`, err);
        }
      }
      
      // Sort by AUM descending
      allRecords.sort((a, b) => b.aum - a.aum);
      
      setDrillDownRecords(allRecords);
    } catch (err) {
      console.error('Error fetching AUM drill-down data:', err);
      setDrillDownRecords([]);
    } finally {
      setDrillDownLoading(false);
    }
  };
  
  // Handle Advisors scorecard click - fetch all records across all selected stages
  const handleAdvisorsClick = async () => {
    setDrillDownStage(null);
    setDrillDownMetric(null);
    setDrillDownOpen(true);
    setDrillDownLoading(true);
    
    try {
      // Fetch records for all selected stages and combine them
      const sgmsToSend = selectedSgms.length === sgmOptions.length ? undefined : selectedSgms;
      const allRecords: DetailRecord[] = [];
      const recordIds = new Set<string>(); // To deduplicate if needed
      
      // Fetch records for each selected stage
      for (const stage of selectedStages) {
        try {
          const result = await dashboardApi.getPipelineDrilldown(stage, undefined, sgmsToSend);
          // Add records, avoiding duplicates by ID
          for (const record of result.records) {
            if (!recordIds.has(record.id)) {
              recordIds.add(record.id);
              allRecords.push(record);
            }
          }
        } catch (err) {
          console.error(`Error fetching records for stage ${stage}:`, err);
        }
      }
      
      // Sort by AUM descending (same as AUM click for consistency)
      allRecords.sort((a, b) => b.aum - a.aum);
      
      setDrillDownRecords(allRecords);
    } catch (err) {
      console.error('Error fetching Advisors drill-down data:', err);
      setDrillDownRecords([]);
    } finally {
      setDrillDownLoading(false);
    }
  };
  
  // Handle record click from drill-down
  const handleRecordClick = (recordId: string) => {
    setDrillDownOpen(false);
    setSelectedRecordId(recordId);
  };
  
  // Handle back from record detail to drill-down
  const handleBackToDrillDown = () => {
    setSelectedRecordId(null);
    setDrillDownOpen(true);
  };

  // Handle segment click in By SGM chart (drill down to specific SGM + stage)
  const handleSegmentClick = async (sgm: string, stage: string) => {
    setDrillDownStage(stage);
    setDrillDownSgm(sgm);
    setDrillDownMetric('aum');
    setDrillDownOpen(true);
    setDrillDownLoading(true);

    try {
      const sgmsToSend = selectedSgms.length === sgmOptions.length ? undefined : selectedSgms;
      const dateRange = sqlDateRange ? buildDateRangeFromSqlFilter(sqlDateRange) : null;
      const result = await dashboardApi.getPipelineDrilldown(stage, { sgm }, sgmsToSend, dateRange);
      setDrillDownRecords(result.records);
    } catch (err) {
      console.error('Error fetching segment drill-down:', err);
      setDrillDownRecords([]);
    } finally {
      setDrillDownLoading(false);
    }
  };

  // Handle SGM name click (drill down to all stages for one SGM)
  const handleSgmClick = async (sgm: string) => {
    setDrillDownStage(null);
    setDrillDownSgm(sgm);
    setDrillDownMetric(null);
    setDrillDownOpen(true);
    setDrillDownLoading(true);

    try {
      const sgmsToSend = selectedSgms.length === sgmOptions.length ? undefined : selectedSgms;
      const dateRange = sqlDateRange ? buildDateRangeFromSqlFilter(sqlDateRange) : null;
      const result = await dashboardApi.getPipelineDrilldownBySgm(
        sgm,
        selectedStages.length > 0 ? selectedStages : undefined,
        sgmsToSend,
        dateRange
      );
      setDrillDownRecords(result.records);
    } catch (err) {
      console.error('Error fetching SGM drill-down:', err);
      setDrillDownRecords([]);
    } finally {
      setDrillDownLoading(false);
    }
  };

  // Close drill-down modal
  const handleCloseDrillDown = () => {
    setDrillDownOpen(false);
    setDrillDownRecords([]);
    setDrillDownStage(null);
    setDrillDownMetric(null);
    setDrillDownSgm(null);
    setDrillDownConversionMetric(null);
  };

  // Handle stale alert stage click — opens drill-down pre-filtered to that stage's records
  const handleStaleStageClick = (stage: string, stageRecords: DetailRecord[]) => {
    setDrillDownRecords(stageRecords);
    setDrillDownStage(stage);
    setDrillDownMetric(null);
    setDrillDownSgm(null);
    setDrillDownConversionMetric(null);
    setDrillDownOpen(true);
  };

  // Handle conversion table metric click (SQLs, SQO'd, or Joined) — open drill-down with those records
  const handleConversionMetricClick = useCallback(async (sgm: string, metric: 'sql' | 'sqo' | 'joined') => {
    setDrillDownSgm(sgm);
    setDrillDownStage(null);
    setDrillDownConversionMetric(metric);
    setDrillDownOpen(true);
    setDrillDownLoading(true);

    try {
      const sgmsToSend = selectedSgms.length === sgmOptions.length ? undefined : selectedSgms;
      const dateRange = sqlDateRange ? buildDateRangeFromSqlFilter(sqlDateRange) : null;
      const result = await dashboardApi.getSgmConversionDrilldown(sgm, metric, sgmsToSend, dateRange);
      setDrillDownRecords(result.records);
    } catch (err) {
      console.error('Error fetching conversion drill-down:', err);
      setDrillDownRecords([]);
    } finally {
      setDrillDownLoading(false);
    }
  }, [selectedSgms, sgmOptions.length, sqlDateRange]);
  
  // Note: Stage and SGM filter changes are handled directly via setSelectedStages and setSelectedSgms
  // The fetchData callback will automatically trigger when these change
  
  // Loading state
  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    );
  }
  
  // Note: Permission check removed - all authenticated users can access the pipeline page
  
  return (
    <div className="w-full max-w-full overflow-x-hidden">
      {/* Header */}
      <div className="mb-6">
        <Title className="text-3xl">Open Pipeline</Title>
        <Text className="text-base">
          Real-time view of active opportunities in the recruitment pipeline
        </Text>
      </div>
      
      {/* Error State */}
      {error && (
        <Card className="mb-6 border-red-200 dark:border-red-800">
          <Text className="text-red-600 dark:text-red-400">{error}</Text>
          <button
            onClick={fetchData}
            className="mt-2 text-base text-blue-600 hover:text-blue-700"
          >
            Try Again
          </button>
        </Card>
      )}
      
      {/* Scorecards */}
      <div className="mb-6">
        <PipelineScorecard
          totalAum={summary?.totalAum || 0}
          totalAumFormatted={summary?.totalAumFormatted || '$0'}
          advisorCount={summary?.advisorCount || 0}
          loading={loading}
          onAumClick={handleAumClick}
          onAdvisorsClick={handleAdvisorsClick}
        />
      </div>
      
      {/* Filters */}
      <div className="mb-6">
        <PipelineFilters
          selectedStages={selectedStages}
          selectedSgms={selectedSgms}
          onApply={(stages, sgms) => {
            setSelectedStages(stages);
            setSelectedSgms(sgms);
          }}
          sgmOptions={sgmOptions}
          sgmOptionsLoading={sgmOptionsLoading}
          disabled={loading}
        />
      </div>

      {/* Tab Toggle — revops_admin only */}
      {isRevOpsAdmin && (
        <div className="flex gap-1 mb-4">
          <button
            onClick={() => setActiveTab('byStage')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              activeTab === 'byStage'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            By Stage
          </button>
          <button
            onClick={() => setActiveTab('bySgm')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              activeTab === 'bySgm'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            By SGM
          </button>
        </div>
      )}

      {/* SQL Date Filter — only shown on By SGM tab */}
      {activeTab === 'bySgm' && isRevOpsAdmin && (
        <SqlDateFilter
          value={sqlDateRange}
          onChange={setSqlDateRange}
          disabled={bySgmLoading || conversionLoading}
        />
      )}

      {/* Bar Chart with Export */}
      <Card className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <Text className="font-semibold text-lg">
              {activeTab === 'byStage' ? 'Pipeline by Stage' : 'Pipeline by SGM'}
            </Text>
            <Text className="text-base text-gray-500 dark:text-gray-400">
              {activeTab === 'byStage'
                ? 'Click any bar to see the advisors in that stage'
                : 'Click a segment or SGM name to drill down'}
            </Text>
          </div>
          <PipelineExportPng
            chartElementId={activeTab === 'byStage' ? 'pipeline-by-stage-chart' : 'pipeline-by-sgm-chart'}
            filename={activeTab === 'byStage' ? 'open-pipeline-chart' : 'pipeline-by-sgm-chart'}
            disabled={activeTab === 'byStage' ? (loading || !summary?.byStage?.length) : (bySgmLoading || !bySgmData.length)}
          />
        </div>
        {/* Conditional chart rendering */}
        {activeTab === 'byStage' ? (
          <div
            id="pipeline-by-stage-chart"
            className="bg-white dark:bg-gray-800 p-4 rounded-lg"
            style={{
              backgroundColor: resolvedTheme === 'dark' ? '#1f2937' : '#ffffff'
            }}
          >
            <PipelineByStageChart
              data={summary?.byStage || []}
              onBarClick={handleBarClick}
              loading={loading}
            />
          </div>
        ) : (
          <div
            id="pipeline-by-sgm-chart"
            className="bg-white dark:bg-gray-800 p-4 rounded-lg"
            style={{
              backgroundColor: resolvedTheme === 'dark' ? '#1f2937' : '#ffffff'
            }}
          >
            <PipelineBySgmChart
              data={bySgmData}
              selectedStages={selectedStages}
              onSegmentClick={handleSegmentClick}
              onSgmClick={handleSgmClick}
              loading={bySgmLoading}
            />
          </div>
        )}
      </Card>

      {/* Stale Pipeline Alerts — By Stage tab only */}
      {activeTab === 'byStage' && (
        <StalePipelineAlerts
          records={staleRecords}
          loading={staleLoading}
          onStageClick={handleStaleStageClick}
          onRecordClick={handleRecordClick}
        />
      )}

      {/* Conversion Table — only shown on By SGM tab */}
      {activeTab === 'bySgm' && isRevOpsAdmin && (
        <SgmConversionTable
          data={conversionData}
          loading={conversionLoading}
          onMetricClick={handleConversionMetricClick}
        />
      )}

      {/* Drill-Down Modal - Reuse existing VolumeDrillDownModal component */}
      <VolumeDrillDownModal
        isOpen={drillDownOpen}
        onClose={handleCloseDrillDown}
        records={drillDownRecords}
        title={
          drillDownConversionMetric
            ? `${drillDownSgm ?? ''} — ${drillDownConversionMetric === 'sql' ? 'SQLs' : drillDownConversionMetric === 'sqo' ? "SQO's" : 'Joined'}`
            : drillDownSgm
              ? drillDownStage
                ? `${drillDownSgm} — ${drillDownStage}`
                : `${drillDownSgm} — All Open Pipeline`
              : drillDownStage
                ? `${drillDownStage} Stage`
                : selectedStages.length === OPEN_PIPELINE_STAGES.length &&
                  OPEN_PIPELINE_STAGES.every(s => selectedStages.includes(s))
                  ? 'Open Pipeline - All Stages'
                  : `Open Pipeline - ${selectedStages.length} Stage${selectedStages.length > 1 ? 's' : ''}`
        }
        loading={drillDownLoading}
        error={null}
        onRecordClick={handleRecordClick}
        metricFilter={drillDownConversionMetric ?? 'openPipeline'}
        canExport={permissions?.canExport || false}
      />
      
      {/* Record Detail Modal */}
      <RecordDetailModal
        isOpen={selectedRecordId !== null}
        onClose={() => setSelectedRecordId(null)}
        recordId={selectedRecordId}
        showBackButton={drillDownRecords.length > 0}
        onBack={handleBackToDrillDown}
        backButtonLabel={`← Back to ${drillDownConversionMetric ? drillDownSgm + (drillDownConversionMetric === 'sql' ? ' — SQLs' : drillDownConversionMetric === 'sqo' ? " — SQO's" : ' — Joined') : drillDownSgm ? drillDownSgm + (drillDownStage ? ' — ' + drillDownStage : '') : drillDownStage || 'list'}`}
      />
    </div>
  );
}
