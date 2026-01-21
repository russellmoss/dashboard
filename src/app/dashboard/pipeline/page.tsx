'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useTheme } from 'next-themes';
import { Title, Text, Card } from '@tremor/react';
import { Loader2 } from 'lucide-react';

import { dashboardApi } from '@/lib/api-client';
import { getSessionPermissions } from '@/types/auth';
import { OPEN_PIPELINE_STAGES } from '@/config/constants';
import { OpenPipelineSummary, DetailRecord } from '@/types/dashboard';

import { PipelineScorecard } from '@/components/dashboard/PipelineScorecard';
import { PipelineByStageChart } from '@/components/dashboard/PipelineByStageChart';
import { PipelineFilters } from '@/components/dashboard/PipelineFilters';
import { PipelineExportPng } from '@/components/dashboard/PipelineExportPng';
import { VolumeDrillDownModal } from '@/components/dashboard/VolumeDrillDownModal';
import { RecordDetailModal } from '@/components/dashboard/RecordDetailModal';
import { SgmOption } from '@/types/dashboard';

export default function PipelinePage() {
  const { data: session, status } = useSession();
  const permissions = getSessionPermissions(session);
  
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
  
  // Close drill-down modal
  const handleCloseDrillDown = () => {
    setDrillDownOpen(false);
    setDrillDownRecords([]);
    setDrillDownStage(null);
    setDrillDownMetric(null);
  };
  
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
        <Title>Open Pipeline</Title>
        <Text>
          Real-time view of active opportunities in the recruitment pipeline
        </Text>
      </div>
      
      {/* Error State */}
      {error && (
        <Card className="mb-6 border-red-200 dark:border-red-800">
          <Text className="text-red-600 dark:text-red-400">{error}</Text>
          <button
            onClick={fetchData}
            className="mt-2 text-sm text-blue-600 hover:text-blue-700"
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
      
      {/* Bar Chart with Export */}
      <Card className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <Text className="font-semibold">Pipeline by Stage</Text>
            <Text className="text-sm text-gray-500 dark:text-gray-400">
              Click any bar to see the advisors in that stage
            </Text>
          </div>
          <PipelineExportPng
            chartElementId="pipeline-by-stage-chart"
            filename="open-pipeline-chart"
            disabled={loading || !summary?.byStage?.length}
          />
        </div>
        {/* Wrap chart in div with ID for PNG export */}
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
      </Card>
      
      {/* Drill-Down Modal - Reuse existing VolumeDrillDownModal component */}
      <VolumeDrillDownModal
        isOpen={drillDownOpen}
        onClose={handleCloseDrillDown}
        records={drillDownRecords}
        title={
          drillDownStage 
            ? `${drillDownStage} Stage` 
            : selectedStages.length === OPEN_PIPELINE_STAGES.length && 
              OPEN_PIPELINE_STAGES.every(s => selectedStages.includes(s))
              ? 'Open Pipeline - All Stages'
              : `Open Pipeline - ${selectedStages.length} Stage${selectedStages.length > 1 ? 's' : ''}`
        }
        loading={drillDownLoading}
        error={null}
        onRecordClick={handleRecordClick}
        metricFilter="openPipeline"
        canExport={permissions?.canExport || false}
      />
      
      {/* Record Detail Modal */}
      <RecordDetailModal
        isOpen={selectedRecordId !== null}
        onClose={() => setSelectedRecordId(null)}
        recordId={selectedRecordId}
        showBackButton={drillDownRecords.length > 0}
        onBack={handleBackToDrillDown}
        backButtonLabel={`← Back to ${drillDownStage || 'list'}`}
      />
    </div>
  );
}
