'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import nextDynamic from 'next/dynamic';
import { getSessionPermissions } from '@/types/auth';
import { SGMHubTabs } from '@/components/sgm-hub/SGMHubTabs';
import { SGMHubTab, SGMDashboardMetrics, SGMConversionTrend, SGMOpenOpp } from '@/types/sgm-hub';
import { SGMQuotaTrackingView } from '@/components/sgm-hub/SGMQuotaTrackingView';
import { SGMAdminQuotaView } from '@/components/sgm-hub/SGMAdminQuotaView';
import { useQuotaTracking } from '@/hooks/useQuotaTracking';
import { SGMLeaderboardFilters } from '@/components/sgm-hub/SGMLeaderboardFilters';
import { SGMLeaderboardTable } from '@/components/sgm-hub/SGMLeaderboardTable';
import { SGMDashboardFilters as SGMDashboardFiltersComponent } from '@/components/sgm-hub/SGMDashboardFilters';
import { SGMDashboardScorecards } from '@/components/sgm-hub/SGMDashboardScorecards';
import { PipelineFilters } from '@/components/dashboard/PipelineFilters';
import { SgmConversionTable, SgmConversionMetricType, SgmConversionRateType } from '@/components/dashboard/SgmConversionTable';
import { StalePipelineAlerts } from '@/components/dashboard/StalePipelineAlerts';
import { VolumeDrillDownModal } from '@/components/dashboard/VolumeDrillDownModal';
import { MetricDrillDownModal } from '@/components/sga-hub/MetricDrillDownModal';
import { RecordDetailModal } from '@/components/dashboard/RecordDetailModal';
import { dashboardApi, handleApiError } from '@/lib/api-client';
import { FilterOptions, DashboardFilters, DEFAULT_ADVANCED_FILTERS } from '@/types/filters';
import { OPEN_PIPELINE_STAGES, ON_HOLD_STAGE } from '@/config/constants';
import { SGMLeaderboardEntry } from '@/types/sgm-hub';
import { SgmConversionData, DetailRecord, OpenPipelineByStage } from '@/types/dashboard';
import { getCurrentQuarter, getQuarterInfo } from '@/lib/utils/sga-hub-helpers';
import {
  MetricType,
  DrillDownRecord,
  DrillDownContext,
} from '@/types/drill-down';

const SGMConversionCharts = nextDynamic(
  () => import('@/components/sgm-hub/SGMConversionCharts').then(m => ({ default: m.SGMConversionCharts })),
  { ssr: false, loading: () => <div className="h-64 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-lg" /> }
);

const PipelineByStageChart = nextDynamic(
  () => import('@/components/dashboard/PipelineByStageChart').then(m => ({ default: m.PipelineByStageChart })),
  { ssr: false, loading: () => <div className="h-64 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-lg" /> }
);

type ConversionPreset = 'alltime' | 'q1' | 'q2' | 'q3' | 'q4' | 'ytd' | 'custom';

function getConversionDateRange(preset: ConversionPreset, year: number): { startDate: string; endDate: string } | null {
  if (preset === 'alltime') return null;
  const now = new Date();
  if (preset === 'ytd') return { startDate: `${year}-01-01`, endDate: year === now.getFullYear() ? now.toISOString().split('T')[0] : `${year}-12-31` };
  const q = parseInt(preset.replace('q', ''));
  const startMonth = (q - 1) * 3;
  const start = new Date(year, startMonth, 1);
  const end = new Date(year, startMonth + 3, 0);
  return { startDate: start.toISOString().split('T')[0], endDate: end.toISOString().split('T')[0] };
}

function ConversionTableDateFilter({ dateRange, onChange }: {
  dateRange: { startDate: string; endDate: string } | null;
  onChange: (range: { startDate: string; endDate: string } | null) => void;
}) {
  const currentYear = new Date().getFullYear();
  const [preset, setPreset] = useState<ConversionPreset>('alltime');
  const [year, setYear] = useState(currentYear);
  const yearOptions = Array.from({ length: 4 }, (_, i) => currentYear - i);

  const handlePresetChange = (newPreset: ConversionPreset) => {
    setPreset(newPreset);
    if (newPreset === 'custom') {
      // Default custom to current year
      onChange({ startDate: `${currentYear}-01-01`, endDate: new Date().toISOString().split('T')[0] });
    } else {
      onChange(getConversionDateRange(newPreset, year));
    }
  };

  const handleYearChange = (newYear: number) => {
    setYear(newYear);
    if (preset !== 'alltime' && preset !== 'custom') {
      onChange(getConversionDateRange(preset, newYear));
    }
  };

  const showYearSelector = preset !== 'alltime' && preset !== 'custom';
  const showCustomDates = preset === 'custom' && dateRange !== null;

  return (
    <div className="flex items-center gap-3 mb-2 flex-wrap">
      <label className="text-sm font-medium text-gray-600 dark:text-gray-400">Date Range:</label>
      <select
        value={preset}
        onChange={(e) => handlePresetChange(e.target.value as ConversionPreset)}
        className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
      >
        <option value="alltime">All Time</option>
        <option value="ytd">Year to Date</option>
        <option value="q1">Q1</option>
        <option value="q2">Q2</option>
        <option value="q3">Q3</option>
        <option value="q4">Q4</option>
        <option value="custom">Custom Range</option>
      </select>
      {showYearSelector && (
        <select
          value={year}
          onChange={(e) => handleYearChange(parseInt(e.target.value))}
          className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
        >
          {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      )}
      {showCustomDates && (
        <>
          <input
            type="date"
            value={dateRange.startDate}
            onChange={(e) => onChange({ ...dateRange, startDate: e.target.value })}
            className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          />
          <span className="text-sm text-gray-500">to</span>
          <input
            type="date"
            value={dateRange.endDate}
            onChange={(e) => onChange({ ...dateRange, endDate: e.target.value })}
            className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          />
        </>
      )}
      {dateRange && (
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {dateRange.startDate} to {dateRange.endDate}
        </span>
      )}
    </div>
  );
}

export function SGMHubContent() {
  const { data: session } = useSession();
  const permissions = getSessionPermissions(session);

  const isSGM = permissions?.role === 'sgm';
  const currentUserSgmName = isSGM ? (permissions?.sgmFilter || session?.user?.name || null) : null;
  const isAdmin = permissions?.role === 'admin' || permissions?.role === 'revops_admin';

  // Tab state
  const [activeTab, setActiveTab] = useState<SGMHubTab>('leaderboard');

  // Quota tracking hook
  const quota = useQuotaTracking(isAdmin, isSGM, currentUserSgmName, activeTab);

  // Leaderboard state
  const [leaderboardEntries, setLeaderboardEntries] = useState<SGMLeaderboardEntry[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);

  // Leaderboard filters (applied filters) — SGM Hub defaults to ALL channels
  const [leaderboardQuarter, setLeaderboardQuarter] = useState<string>(getCurrentQuarter());
  const [leaderboardChannels, setLeaderboardChannels] = useState<string[]>([]);
  const [leaderboardSources, setLeaderboardSources] = useState<string[]>([]);
  const [leaderboardSGMs, setLeaderboardSGMs] = useState<string[]>([]);

  // Filter options
  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);
  const [sgmOptions, setSgmOptions] = useState<Array<{ value: string; label: string; isActive: boolean }>>([]);
  const [sgmOptionsLoading, setSgmOptionsLoading] = useState(false);

  // Drill-down modal state
  const [drillDownOpen, setDrillDownOpen] = useState(false);
  const [drillDownMetricType, setDrillDownMetricType] = useState<MetricType | null>(null);
  const [drillDownRecords, setDrillDownRecords] = useState<DrillDownRecord[]>([]);
  const [drillDownLoading, setDrillDownLoading] = useState(false);
  const [drillDownError, setDrillDownError] = useState<string | null>(null);
  const [drillDownTitle, setDrillDownTitle] = useState('');
  const [drillDownContext, setDrillDownContext] = useState<DrillDownContext | null>(null);

  // Record detail modal state
  const [recordDetailOpen, setRecordDetailOpen] = useState(false);
  const [recordDetailId, setRecordDetailId] = useState<string | null>(null);

  // ============================================
  // Dashboard tab state
  // ============================================

  // Dashboard filters (separate from leaderboard — date range vs quarter)
  const [dashboardDateRange, setDashboardDateRange] = useState<{ startDate: string; endDate: string }>(() => {
    const now = new Date();
    const quarterMonth = Math.floor(now.getMonth() / 3) * 3;
    const quarterStart = new Date(now.getFullYear(), quarterMonth, 1);
    return {
      startDate: quarterStart.toISOString().split('T')[0],
      endDate: now.toISOString().split('T')[0],
    };
  });
  const [dashboardChannels, setDashboardChannels] = useState<string[]>([]);
  const [dashboardSources, setDashboardSources] = useState<string[]>([]);
  const [dashboardSGMs, setDashboardSGMs] = useState<string[]>([]);

  // Dashboard data
  const [dashboardMetrics, setDashboardMetrics] = useState<SGMDashboardMetrics | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);

  // Conversion trend
  const [conversionTrend, setConversionTrend] = useState<SGMConversionTrend[]>([]);
  const [conversionTrendLoading, setConversionTrendLoading] = useState(false);
  const [quarterCount, setQuarterCount] = useState(4);

  // Pipeline by stage
  const [pipelineByStage, setPipelineByStage] = useState<OpenPipelineByStage[]>([]);
  const [pipelineLoading, setPipelineLoading] = useState(false);
  const [pipelineStages, setPipelineStages] = useState<string[]>([
    'Qualifying', 'Discovery', 'Sales Process', 'Negotiating', 'Signed', 'On Hold', 'Planned Nurture'
  ]);

  // SGM Conversion table (has its own date filter, defaults to all-time)
  const [conversionData, setConversionData] = useState<SgmConversionData[]>([]);
  const [conversionLoading, setConversionLoading] = useState(false);
  const [conversionDateRange, setConversionDateRange] = useState<{ startDate: string; endDate: string } | null>(null);

  // Stale pipeline
  const [staleRecords, setStaleRecords] = useState<DetailRecord[]>([]);
  const [staleLoading, setStaleLoading] = useState(false);

  // System 1 drilldown (Dashboard tab — DetailRecord[] + VolumeDrillDownModal)
  const [volumeDrillDownOpen, setVolumeDrillDownOpen] = useState(false);
  const [volumeDrillDownRecords, setVolumeDrillDownRecords] = useState<DetailRecord[]>([]);
  const [volumeDrillDownLoading, setVolumeDrillDownLoading] = useState(false);
  const [volumeDrillDownError, setVolumeDrillDownError] = useState<string | null>(null);
  const [volumeDrillDownTitle, setVolumeDrillDownTitle] = useState('');
  const [volumeDrillDownMetric, setVolumeDrillDownMetric] = useState<
    'prospect' | 'contacted' | 'mql' | 'sql' | 'sqo' | 'signed' | 'joined' | 'openPipeline' | null
  >(null);

  // Fetch filter options on mount
  useEffect(() => {
    const fetchFilterOptions = async () => {
      try {
        const options = await dashboardApi.getFilterOptions();
        setFilterOptions(options);
        // SGM Hub defaults to ALL channels and ALL sources
        if (options && options.channels) {
          setLeaderboardChannels([...options.channels]);
          setDashboardChannels([...options.channels]);
        }
        if (options && options.sources) {
          setLeaderboardSources([...options.sources]);
          setDashboardSources([...options.sources]);
        }
      } catch (err) {
        console.error('Error fetching filter options:', err);
      }
    };

    fetchFilterOptions();
  }, []);

  // Fetch SGM options for leaderboard filter
  useEffect(() => {
    const fetchSGMOptions = async () => {
      try {
        setSgmOptionsLoading(true);
        const response = await dashboardApi.getLeaderboardSGMOptions();
        setSgmOptions(response.sgmOptions);
        // Set default SGMs to all active SGMs
        const activeSGMs = response.sgmOptions.filter(s => s.isActive).map(s => s.value);
        setLeaderboardSGMs(activeSGMs);
        // Dashboard SGM default: SGM user → own name, Admin → all active
        if (isSGM && currentUserSgmName) {
          setDashboardSGMs([currentUserSgmName]);
        } else {
          setDashboardSGMs(activeSGMs);
        }
      } catch (err) {
        console.error('Error fetching SGM options:', err);
      } finally {
        setSgmOptionsLoading(false);
      }
    };

    fetchSGMOptions();
  }, []);

  // Fetch leaderboard data
  const fetchLeaderboard = async () => {
    if (leaderboardChannels.length === 0) return; // Wait for filter options to load
    try {
      setLeaderboardLoading(true);
      setLeaderboardError(null);

      const quarterInfo = getQuarterInfo(leaderboardQuarter);
      const response = await dashboardApi.getSGMLeaderboard({
        startDate: quarterInfo.startDate,
        endDate: quarterInfo.endDate,
        channels: leaderboardChannels,
        sources: leaderboardSources.length > 0 ? leaderboardSources : undefined,
        sgmNames: leaderboardSGMs.length > 0 ? leaderboardSGMs : undefined,
      });
      setLeaderboardEntries(response.entries);
    } catch (err) {
      setLeaderboardError(handleApiError(err));
    } finally {
      setLeaderboardLoading(false);
    }
  };

  // Refetch leaderboard when tab or filters change
  useEffect(() => {
    if (activeTab === 'leaderboard') {
      fetchLeaderboard();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, leaderboardQuarter, leaderboardChannels, leaderboardSources, leaderboardSGMs]);

  // Drill-down handlers
  const handleJoinedClick = async (sgmName: string) => {
    setDrillDownLoading(true);
    setDrillDownMetricType('joined');
    setDrillDownOpen(true);
    const title = `${sgmName} - Joined Advisors - ${leaderboardQuarter}`;
    setDrillDownTitle(title);
    setDrillDownContext({ metricType: 'joined', title, sgaName: null, sgmName, quarter: leaderboardQuarter });
    try {
      const response = await dashboardApi.getJoinedDrillDown(
        sgmName,
        { quarter: leaderboardQuarter },
        leaderboardChannels.length > 0 ? leaderboardChannels : undefined,
        leaderboardSources.length > 0 ? leaderboardSources : undefined,
      );
      setDrillDownRecords(response.records);
    } catch (err) {
      console.error('Error fetching joined drill-down:', err);
      setDrillDownError('Failed to load joined advisor records');
    } finally {
      setDrillDownLoading(false);
    }
  };

  const handleAumClick = async (sgmName: string) => {
    setDrillDownLoading(true);
    setDrillDownMetricType('joined');
    setDrillDownOpen(true);
    const title = `${sgmName} - Joined AUM - ${leaderboardQuarter}`;
    setDrillDownTitle(title);
    setDrillDownContext({ metricType: 'joined', title, sgaName: null, sgmName, quarter: leaderboardQuarter });
    try {
      const response = await dashboardApi.getJoinedDrillDown(
        sgmName,
        { quarter: leaderboardQuarter },
        leaderboardChannels.length > 0 ? leaderboardChannels : undefined,
        leaderboardSources.length > 0 ? leaderboardSources : undefined,
      );
      setDrillDownRecords(response.records);
    } catch (err) {
      console.error('Error fetching joined AUM drill-down:', err);
      setDrillDownError('Failed to load joined advisor records');
    } finally {
      setDrillDownLoading(false);
    }
  };

  const handleRecordClick = (primaryKey: string) => {
    setDrillDownOpen(false);
    setRecordDetailId(primaryKey);
    setRecordDetailOpen(true);
  };

  const handleBackToDrillDown = () => {
    setRecordDetailOpen(false);
    setRecordDetailId(null);
    setDrillDownOpen(true);
  };

  const handleCloseDrillDown = () => {
    setDrillDownOpen(false);
    setDrillDownRecords([]);
    setDrillDownContext(null);
  };

  const handleCloseRecordDetail = () => {
    setRecordDetailOpen(false);
    setRecordDetailId(null);
    setDrillDownContext(null);
  };

  // Handle filter apply
  const handleFilterApply = (filters: {
    quarter: string;
    channels: string[];
    sources: string[];
    sgms: string[];
  }) => {
    setLeaderboardQuarter(filters.quarter);
    setLeaderboardChannels(filters.channels);
    setLeaderboardSources(filters.sources);
    setLeaderboardSGMs(filters.sgms);
  };

  // ============================================
  // Dashboard tab fetch functions
  // ============================================

  // When all active SGMs are selected (default), don't filter by SGM — show all data
  // including records owned by inactive SGMs. Only filter when user narrows selection.
  const activeSgmNames = sgmOptions.filter(s => s.isActive).map(s => s.value);
  const isDefaultSgmFilter = dashboardSGMs.length === activeSgmNames.length &&
    activeSgmNames.every(s => dashboardSGMs.includes(s));
  const effectiveSgmFilter = isDefaultSgmFilter ? undefined : (dashboardSGMs.length > 0 ? dashboardSGMs : undefined);

  const fetchDashboardData = async () => {
    if (dashboardChannels.length === 0) return;
    setDashboardLoading(true);
    setDashboardError(null);
    try {
      const response = await dashboardApi.getSGMDashboardMetrics({
        startDate: dashboardDateRange.startDate,
        endDate: dashboardDateRange.endDate,
        channels: dashboardChannels,
        sources: dashboardSources.length > 0 ? dashboardSources : undefined,
        sgmNames: effectiveSgmFilter,
      });
      setDashboardMetrics(response.metrics);
    } catch (err) {
      setDashboardError(handleApiError(err));
    } finally {
      setDashboardLoading(false);
    }
  };

  const fetchConversionTrend = async () => {
    if (dashboardChannels.length === 0) return;
    setConversionTrendLoading(true);
    try {
      const now = new Date();
      const currentQ = Math.floor(now.getMonth() / 3);
      const startQ = new Date(now.getFullYear(), currentQ * 3, 1);
      startQ.setMonth(startQ.getMonth() - (quarterCount - 1) * 3);

      const response = await dashboardApi.getSGMConversionTrend({
        startDate: startQ.toISOString().split('T')[0],
        endDate: dashboardDateRange.endDate,
        channels: dashboardChannels.length > 0 ? dashboardChannels : undefined,
        sources: dashboardSources.length > 0 ? dashboardSources : undefined,
        sgmNames: effectiveSgmFilter,
      });
      setConversionTrend(response.data);
    } catch (err) {
      console.error('Error fetching conversion trend:', err);
    } finally {
      setConversionTrendLoading(false);
    }
  };

  const fetchPipelineByStage = async () => {
    setPipelineLoading(true);
    try {
      const response = await dashboardApi.getPipelineSummary(
        pipelineStages,
        effectiveSgmFilter
      );
      setPipelineByStage(response.byStage || []);
    } catch (err) {
      console.error('Error fetching pipeline by stage:', err);
    } finally {
      setPipelineLoading(false);
    }
  };

  const fetchConversionTable = async () => {
    setConversionLoading(true);
    try {
      const response = await dashboardApi.getSGMConversions({
        sgmNames: effectiveSgmFilter,
        dateRange: conversionDateRange,
      });
      setConversionData(response.data);
    } catch (err) {
      console.error('Error fetching conversion data:', err);
    } finally {
      setConversionLoading(false);
    }
  };

  const fetchStaleRecords = async () => {
    setStaleLoading(true);
    try {
      // Match Open Pipeline page approach: fetch per-stage via getPipelineDrilldown
      // This ensures daysInCurrentStage is properly calculated
      const stagesToFetch = [...OPEN_PIPELINE_STAGES, ON_HOLD_STAGE];
      const allRecords: DetailRecord[] = [];
      const recordIds = new Set<string>();

      for (const stage of stagesToFetch) {
        try {
          const result = await dashboardApi.getPipelineDrilldown(
            stage,
            undefined,
            effectiveSgmFilter,
          );
          for (const record of result.records) {
            if (!recordIds.has(record.id)) {
              recordIds.add(record.id);
              allRecords.push(record);
            }
          }
        } catch (err) {
          console.error(`Error fetching stale pipeline stage ${stage}:`, err);
        }
      }

      setStaleRecords(allRecords);
    } catch (err) {
      console.error('Error fetching stale pipeline:', err);
      setStaleRecords([]);
    } finally {
      setStaleLoading(false);
    }
  };

  // Fetch dashboard data when tab or filters change
  useEffect(() => {
    if (activeTab !== 'dashboard' || dashboardChannels.length === 0) return;
    fetchDashboardData();
    fetchConversionTrend();
    fetchPipelineByStage();
    fetchConversionTable();
    fetchStaleRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, dashboardDateRange, dashboardChannels, dashboardSources, dashboardSGMs]);

  // Refetch conversion trend when quarter count changes
  useEffect(() => {
    if (activeTab !== 'dashboard' || dashboardChannels.length === 0) return;
    fetchConversionTrend();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quarterCount]);

  // Refetch conversion table when its own date range changes
  useEffect(() => {
    if (activeTab !== 'dashboard') return;
    fetchConversionTable();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversionDateRange]);

  // Refetch pipeline when stages change
  useEffect(() => {
    if (activeTab !== 'dashboard') return;
    fetchPipelineByStage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineStages]);

  // ============================================
  // Dashboard tab drilldown handlers
  // ============================================

  // Build DashboardFilters from SGM Hub dashboard state for drilldown
  const buildDrillDownFilters = (metricFilter: DashboardFilters['metricFilter']): DashboardFilters => ({
    startDate: dashboardDateRange.startDate,
    endDate: dashboardDateRange.endDate,
    datePreset: 'custom',
    year: new Date().getFullYear(),
    channel: null,
    source: null,
    sga: null,
    sgm: null,
    stage: null,
    experimentationTag: null,
    campaignId: null,
    metricFilter,
    advancedFilters: {
      ...DEFAULT_ADVANCED_FILTERS,
      channels: dashboardChannels.length > 0 && dashboardChannels.length < (filterOptions?.channels?.length || 999)
        ? { selectAll: false, selected: dashboardChannels }
        : { selectAll: true, selected: [] },
      sources: dashboardSources.length > 0 && dashboardSources.length < (filterOptions?.sources?.length || 999)
        ? { selectAll: false, selected: dashboardSources }
        : { selectAll: true, selected: [] },
      sgms: isDefaultSgmFilter
        ? { selectAll: true, selected: [] }
        : dashboardSGMs.length > 0
          ? { selectAll: false, selected: dashboardSGMs }
          : { selectAll: true, selected: [] },
    },
  });

  const handleDashboardMetricClick = async (metric: string) => {
    const metricMap: Record<string, typeof volumeDrillDownMetric> = {
      sql: 'sql', sqo: 'sqo', signed: 'signed', joined: 'joined', openPipeline: 'openPipeline',
    };
    const drillDownMetric = metricMap[metric];
    if (!drillDownMetric) return;

    setVolumeDrillDownMetric(drillDownMetric);
    setVolumeDrillDownOpen(true);
    setVolumeDrillDownLoading(true);
    setVolumeDrillDownTitle(`${metric.toUpperCase()} Records`);
    try {
      const drillDownFilters = buildDrillDownFilters(drillDownMetric);
      const response = await dashboardApi.getDetailRecords(drillDownFilters, 50000);
      setVolumeDrillDownRecords(response.records || []);
    } catch (err) {
      setVolumeDrillDownError(handleApiError(err));
    } finally {
      setVolumeDrillDownLoading(false);
    }
  };

  const handlePipelineBarClick = async (stage: string) => {
    setVolumeDrillDownMetric('openPipeline');
    setVolumeDrillDownOpen(true);
    setVolumeDrillDownLoading(true);
    setVolumeDrillDownTitle(`Pipeline — ${stage}`);
    try {
      const response = await dashboardApi.getPipelineDrilldown(
        stage,
        {},
        effectiveSgmFilter,
      );
      setVolumeDrillDownRecords(response.records || []);
    } catch (err) {
      setVolumeDrillDownError(handleApiError(err));
    } finally {
      setVolumeDrillDownLoading(false);
    }
  };

  const handleConversionMetricClick = async (sgm: string, metric: SgmConversionMetricType) => {
    setVolumeDrillDownMetric(metric === 'sql' ? 'sql' : metric === 'sqo' ? 'sqo' : 'joined');
    setVolumeDrillDownOpen(true);
    setVolumeDrillDownLoading(true);
    setVolumeDrillDownTitle(`${sgm} — ${metric.toUpperCase()} Records`);
    try {
      const response = await dashboardApi.getSgmConversionDrilldown(
        sgm,
        metric,
        effectiveSgmFilter,
        dashboardDateRange,
      );
      setVolumeDrillDownRecords(response.records || []);
    } catch (err) {
      setVolumeDrillDownError(handleApiError(err));
    } finally {
      setVolumeDrillDownLoading(false);
    }
  };

  const handleConversionRateClick = async (sgm: string, rateType: SgmConversionRateType) => {
    const label = rateType === 'sqlToSqoEligible' ? 'SQL→SQO Eligible' : 'SQO→Joined Eligible';
    setVolumeDrillDownMetric(rateType === 'sqlToSqoEligible' ? 'sql' : 'sqo');
    setVolumeDrillDownOpen(true);
    setVolumeDrillDownLoading(true);
    setVolumeDrillDownTitle(`${sgm} — ${label} Records`);
    try {
      // Use conversionDateRange (matches the conversion table's own date filter, null = all-time)
      const response = await dashboardApi.getSgmConversionDrilldown(
        sgm,
        rateType,
        effectiveSgmFilter,
        conversionDateRange,
      );
      setVolumeDrillDownRecords(response.records || []);
    } catch (err) {
      setVolumeDrillDownError(handleApiError(err));
    } finally {
      setVolumeDrillDownLoading(false);
    }
  };

  const handleVolumeDrillDownRecordClick = (recordId: string) => {
    setVolumeDrillDownOpen(false);
    setRecordDetailId(recordId);
    setRecordDetailOpen(true);
  };

  const handleCloseVolumeDrillDown = () => {
    setVolumeDrillDownOpen(false);
    setVolumeDrillDownRecords([]);
    setVolumeDrillDownMetric(null);
    setVolumeDrillDownError(null);
  };

  const handleDashboardFilterApply = (filters: {
    dateRange: { startDate: string; endDate: string };
    channels: string[];
    sources: string[];
    sgms: string[];
  }) => {
    setDashboardDateRange(filters.dateRange);
    setDashboardChannels(filters.channels);
    setDashboardSources(filters.sources);
    setDashboardSGMs(filters.sgms);
  };

  const handleStaleStageClick = (stage: string, records: DetailRecord[]) => {
    setVolumeDrillDownMetric('openPipeline');
    setVolumeDrillDownRecords(records);
    setVolumeDrillDownTitle(`Stale Pipeline — ${stage}`);
    setVolumeDrillDownOpen(true);
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100">
        SGM Hub
      </h1>

      <SGMHubTabs activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Tab content */}
      {activeTab === 'leaderboard' && (
        <div>
          <SGMLeaderboardFilters
            selectedQuarter={leaderboardQuarter}
            selectedChannels={leaderboardChannels}
            selectedSources={leaderboardSources}
            selectedSGMs={leaderboardSGMs}
            channelOptions={filterOptions?.channels || []}
            sourceOptions={filterOptions?.sources || []}
            sgmOptions={sgmOptions}
            sgmOptionsLoading={sgmOptionsLoading}
            onApply={handleFilterApply}
            disabled={leaderboardLoading}
          />

          {leaderboardError && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">
              {leaderboardError}
            </div>
          )}

          <SGMLeaderboardTable
            entries={leaderboardEntries}
            isLoading={leaderboardLoading}
            onJoinedClick={handleJoinedClick}
            onAumClick={handleAumClick}
            currentUserSgmName={currentUserSgmName || undefined}
          />
        </div>
      )}

      {activeTab === 'dashboard' && (
        <div>
          {/* Dashboard Filters */}
          <SGMDashboardFiltersComponent
            selectedDateRange={dashboardDateRange}
            selectedChannels={dashboardChannels}
            selectedSources={dashboardSources}
            selectedSGMs={dashboardSGMs}
            channelOptions={filterOptions?.channels || []}
            sourceOptions={filterOptions?.sources || []}
            sgmOptions={sgmOptions}
            sgmOptionsLoading={sgmOptionsLoading}
            onApply={handleDashboardFilterApply}
            disabled={dashboardLoading}
          />

          {dashboardError && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">
              {dashboardError}
            </div>
          )}

          {/* Scorecards */}
          <SGMDashboardScorecards
            metrics={dashboardMetrics}
            loading={dashboardLoading}
            onMetricClick={handleDashboardMetricClick}
          />

          {/* Conversion Charts */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Conversion Trends
              </h2>
            </div>
            <SGMConversionCharts
              data={conversionTrend}
              loading={conversionTrendLoading}
              quarterCount={quarterCount}
              onQuarterCountChange={setQuarterCount}
            />
          </div>

          {/* Pipeline by Stage */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Pipeline by Stage
              </h2>
            </div>
            <PipelineFilters
              selectedStages={pipelineStages}
              onApply={(stages) => setPipelineStages(stages)}
              selectedSgms={dashboardSGMs}
              sgmOptions={sgmOptions.map(s => ({ value: s.value, label: s.label, isActive: s.isActive }))}
              sgmOptionsLoading={sgmOptionsLoading}
              hideSgmFilter={true}
            />
            <PipelineByStageChart
              data={pipelineByStage}
              onBarClick={(stage) => handlePipelineBarClick(stage)}
              loading={pipelineLoading}
            />
          </div>

          {/* SGM Conversion & Velocity Table */}
          <div className="mb-6">
            <ConversionTableDateFilter
              dateRange={conversionDateRange}
              onChange={setConversionDateRange}
            />
            <SgmConversionTable
              data={conversionData}
              loading={conversionLoading}
              onMetricClick={handleConversionMetricClick}
              onRateClick={handleConversionRateClick}
              hideTeamAverage={dashboardSGMs.length === 1}
            />
          </div>

          {/* Stale Pipeline Alerts */}
          <StalePipelineAlerts
            records={staleRecords}
            loading={staleLoading}
            onStageClick={handleStaleStageClick}
            onRecordClick={handleVolumeDrillDownRecordClick}
          />
        </div>
      )}

      {activeTab === 'quota-tracking' && (
        isAdmin ? (
          <SGMAdminQuotaView
            teamProgress={quota.teamProgress}
            breakdown={quota.adminBreakdown}
            quotas={quota.quotas}
            loading={quota.quotaProgressLoading || !quota.teamProgress}
            breakdownLoading={quota.adminBreakdownLoading}
            quotasLoading={quota.quotasLoading}
            selectedQuarter={quota.quotaFilters.quarter}
            onQuarterChange={(q) => quota.setQuotaFilters(prev => ({ ...prev, quarter: q }))}
            onFilterApply={quota.setQuotaFilters}
            onOpenOppsClick={async (sgmName: string) => {
              setVolumeDrillDownLoading(true);
              setVolumeDrillDownOpen(true);
              setVolumeDrillDownTitle(`${sgmName} - Open Opportunities`);
              setVolumeDrillDownMetric('openPipeline');
              try {
                const { opps } = await dashboardApi.getSGMOpenOpps(sgmName);
                const records = opps.map((opp: SGMOpenOpp) => ({
                  id: opp.opportunityId,
                  advisorName: opp.advisorName,
                  stage: opp.currentStage,
                  aum: opp.aum,
                  aumFormatted: opp.aumFormatted,
                  salesforceUrl: opp.salesforceUrl,
                  source: '', channel: '', tofStage: '', sga: null, sgm: null,
                  campaignId: null, campaignName: null, leadScoreTier: null,
                  relevantDate: '', isContacted: false, isMql: false, isSql: false,
                  isSqo: true, isJoined: false, isOpenPipeline: true,
                  recordTypeId: null, isPrimaryOppRecord: true, opportunityId: opp.opportunityId,
                  contactedDate: null, mqlDate: null, sqlDate: null, sqoDate: null,
                  joinedDate: null, signedDate: null, discoveryDate: null,
                  salesProcessDate: null, negotiatingDate: null, onHoldDate: null,
                  closedDate: null, oppCreatedDate: null, daysInCurrentStage: opp.daysOpen,
                  initialCallScheduledDate: null, qualificationCallDate: null,
                })) as DetailRecord[];
                setVolumeDrillDownRecords(records);
              } catch (err) {
                setVolumeDrillDownError('Failed to load open opportunities');
              } finally {
                setVolumeDrillDownLoading(false);
              }
            }}
            onOpenOpps90Click={async (sgmName: string) => {
              setVolumeDrillDownLoading(true);
              setVolumeDrillDownOpen(true);
              setVolumeDrillDownTitle(`${sgmName} - Open Opportunities (90+ days)`);
              setVolumeDrillDownMetric('openPipeline');
              try {
                const { opps } = await dashboardApi.getSGMOpenOpps(sgmName);
                const filtered = opps.filter((o: SGMOpenOpp) => o.daysOpen >= 90);
                const records = filtered.map((opp: SGMOpenOpp) => ({
                  id: opp.opportunityId,
                  advisorName: opp.advisorName,
                  stage: opp.currentStage,
                  aum: opp.aum,
                  aumFormatted: opp.aumFormatted,
                  salesforceUrl: opp.salesforceUrl,
                  source: '', channel: '', tofStage: '', sga: null, sgm: null,
                  campaignId: null, campaignName: null, leadScoreTier: null,
                  relevantDate: '', isContacted: false, isMql: false, isSql: false,
                  isSqo: true, isJoined: false, isOpenPipeline: true,
                  recordTypeId: null, isPrimaryOppRecord: true, opportunityId: opp.opportunityId,
                  contactedDate: null, mqlDate: null, sqlDate: null, sqoDate: null,
                  joinedDate: null, signedDate: null, discoveryDate: null,
                  salesProcessDate: null, negotiatingDate: null, onHoldDate: null,
                  closedDate: null, oppCreatedDate: null, daysInCurrentStage: opp.daysOpen,
                  initialCallScheduledDate: null, qualificationCallDate: null,
                })) as DetailRecord[];
                setVolumeDrillDownRecords(records);
              } catch (err) {
                setVolumeDrillDownError('Failed to load stale opportunities');
              } finally {
                setVolumeDrillDownLoading(false);
              }
            }}
            onQuotaSave={quota.handleQuotaSave}
            sgmOptions={sgmOptions}
            sgmOptionsLoading={sgmOptionsLoading}
            filterOptions={filterOptions}
          />
        ) : (
          <SGMQuotaTrackingView
            quotaProgress={quota.quotaProgress}
            historicalQuarters={quota.historicalQuarters}
            openOpps={quota.openOpps}
            loading={quota.quotaProgressLoading}
            historicalLoading={quota.historicalLoading}
            openOppsLoading={quota.openOppsLoading}
            onQuarterChange={quota.setQuotaQuarter}
            selectedQuarter={quota.quotaQuarter}
            quarterOptions={quota.quarterOptions}
            onHistoricalBarClick={async (quarter: string) => {
              if (!currentUserSgmName) return;
              setDrillDownLoading(true);
              setDrillDownMetricType('joined');
              setDrillDownOpen(true);
              const title = `${currentUserSgmName} - Joined Advisors - ${quarter}`;
              setDrillDownTitle(title);
              setDrillDownContext({ metricType: 'joined', title, sgaName: null, sgmName: currentUserSgmName, quarter });
              try {
                const response = await dashboardApi.getJoinedDrillDown(currentUserSgmName, { quarter });
                setDrillDownRecords(response.records);
              } catch (err) {
                setDrillDownError('Failed to load joined records');
              } finally {
                setDrillDownLoading(false);
              }
            }}
            onOpenOppClick={(opportunityId: string) => {
              setRecordDetailId(opportunityId);
              setRecordDetailOpen(true);
            }}
          />
        )
      )}

      {/* Drill-Down Modal */}
      <MetricDrillDownModal
        isOpen={drillDownOpen}
        onClose={handleCloseDrillDown}
        metricType={drillDownMetricType || 'joined'}
        records={drillDownRecords}
        title={drillDownTitle}
        loading={drillDownLoading}
        error={drillDownError}
        onRecordClick={handleRecordClick}
        canExport={true}
      />

      {/* Volume Drill-Down Modal (Dashboard tab — System 1) */}
      {volumeDrillDownMetric && (
        <VolumeDrillDownModal
          isOpen={volumeDrillDownOpen}
          onClose={handleCloseVolumeDrillDown}
          records={volumeDrillDownRecords}
          title={volumeDrillDownTitle}
          loading={volumeDrillDownLoading}
          error={volumeDrillDownError}
          onRecordClick={handleVolumeDrillDownRecordClick}
          metricFilter={volumeDrillDownMetric}
          canExport={true}
        />
      )}

      {/* Record Detail Modal */}
      <RecordDetailModal
        isOpen={recordDetailOpen}
        onClose={handleCloseRecordDetail}
        recordId={recordDetailId}
        showBackButton={drillDownContext !== null}
        onBack={handleBackToDrillDown}
        backButtonLabel="← Back to records"
      />
    </div>
  );
}
