'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import nextDynamic from 'next/dynamic';
import { Title, Text } from '@tremor/react';
import { GlobalFilters } from '@/components/dashboard/GlobalFilters';
import { Scorecards } from '@/components/dashboard/Scorecards';
import { ConversionRateCards } from '@/components/dashboard/ConversionRateCards';
import { ExportToSheetsButton } from '@/components/dashboard/ExportToSheetsButton';
import { ChartSkeleton, TableSkeleton } from '@/components/ui/Skeletons';

// Lazy load chart and table components (they don't need SSR and are below the fold)
const VolumeTrendChart = nextDynamic(
  () => import('@/components/dashboard/VolumeTrendChart').then(mod => ({
    default: mod.VolumeTrendChart
  })),
  {
    loading: () => <ChartSkeleton height={320} />,
    ssr: false,
  }
);

const ConversionTrendChart = nextDynamic(
  () => import('@/components/dashboard/ConversionTrendChart').then(mod => ({
    default: mod.ConversionTrendChart
  })),
  {
    loading: () => <ChartSkeleton height={384} />,
    ssr: false,
  }
);

const ChannelPerformanceTable = nextDynamic(
  () => import('@/components/dashboard/ChannelPerformanceTable').then(mod => ({
    default: mod.ChannelPerformanceTable
  })),
  {
    loading: () => <TableSkeleton rows={5} />,
    ssr: false,
  }
);

const SourcePerformanceTable = nextDynamic(
  () => import('@/components/dashboard/SourcePerformanceTable').then(mod => ({
    default: mod.SourcePerformanceTable
  })),
  {
    loading: () => <TableSkeleton rows={10} />,
    ssr: false,
  }
);

const DetailRecordsTable = nextDynamic(
  () => import('@/components/dashboard/DetailRecordsTable').then(mod => ({
    default: mod.DetailRecordsTable
  })),
  {
    loading: () => <TableSkeleton rows={10} />,
    ssr: false,
  }
);
import { AdvancedFilters, AdvancedFiltersButton } from '@/components/dashboard/AdvancedFilters';
import { RecordDetailModal } from '@/components/dashboard/RecordDetailModal';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ChartErrorBoundary, TableErrorBoundary, CardErrorBoundary, FilterErrorBoundary } from '@/components/ui';
import { dashboardApi, handleApiError } from '@/lib/api-client';
import { DashboardFilters, FilterOptions, DEFAULT_ADVANCED_FILTERS, countActiveAdvancedFilters } from '@/types/filters';
import { 
  FunnelMetrics, 
  FunnelMetricsWithGoals,  // Changed from FunnelMetrics
  ConversionRatesResponse, 
  ChannelPerformance, 
  ChannelPerformanceWithGoals,  // Changed from ChannelPerformance
  SourcePerformance, 
  SourcePerformanceWithGoals,   // Changed from SourcePerformance
  DetailRecord, 
  TrendDataPoint, 
  ConversionTrendMode,
  ViewMode
} from '@/types/dashboard';
import { ViewModeToggle } from '@/components/dashboard/ViewModeToggle';
import { FullFunnelScorecards } from '@/components/dashboard/FullFunnelScorecards';
import { buildDateRangeFromFilters, parsePeriodToDateRange } from '@/lib/utils/date-helpers';
import { getSessionPermissions } from '@/types/auth';
import { VolumeDrillDownModal } from '@/components/dashboard/VolumeDrillDownModal';
import { RECRUITING_RECORD_TYPE } from '@/config/constants';
import { SaveReportModal } from '@/components/dashboard/SaveReportModal';
import { DeleteConfirmModal } from '@/components/dashboard/DeleteConfirmModal';
import {
  SavedReport,
  FeatureSelection,
  DEFAULT_FEATURE_SELECTION,
  getEffectiveFeatureSelection,
} from '@/types/saved-reports';

export const dynamic = 'force-dynamic';

// Calculate Quarter to Date default dates
const getQTDDefaultDates = () => {
  const today = new Date().toISOString().split('T')[0];
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth(); // 0-11
  const currentQuarter = Math.floor(currentMonth / 3); // 0-3
  const quarterStart = new Date(currentYear, currentQuarter * 3, 1);
  return {
    startDate: quarterStart.toISOString().split('T')[0],
    endDate: today,
  };
};

const qtdDates = getQTDDefaultDates();

const DEFAULT_FILTERS: DashboardFilters = {
  startDate: qtdDates.startDate,
  endDate: qtdDates.endDate,
  datePreset: 'qtd',
  year: new Date().getFullYear(),
  channel: null,
  source: null,
  sga: null,
  sgm: null,
  stage: null,
  experimentationTag: null,
  metricFilter: 'all',
  advancedFilters: DEFAULT_ADVANCED_FILTERS,
};

/** Compare dashboard filters for equality (used for "Apply" vs pending state). */
function filtersAreEqual(a: DashboardFilters, b: DashboardFilters): boolean {
  if (a.datePreset !== b.datePreset || a.year !== b.year) return false;
  if (a.startDate !== b.startDate || a.endDate !== b.endDate) return false;
  if (a.channel !== b.channel || a.source !== b.source) return false;
  if (a.sga !== b.sga || a.sgm !== b.sgm || a.stage !== b.stage) return false;
  if (a.experimentationTag !== b.experimentationTag || a.metricFilter !== b.metricFilter) return false;
  
  // Compare advanced filters safely without JSON.stringify (avoids circular reference errors)
  // Merge with defaults to ensure all properties exist (handles partial objects)
  const advA: typeof DEFAULT_ADVANCED_FILTERS = {
    ...DEFAULT_ADVANCED_FILTERS,
    ...(a.advancedFilters || {}),
    initialCallScheduled: {
      ...DEFAULT_ADVANCED_FILTERS.initialCallScheduled,
      ...(a.advancedFilters?.initialCallScheduled || {}),
    },
    qualificationCallDate: {
      ...DEFAULT_ADVANCED_FILTERS.qualificationCallDate,
      ...(a.advancedFilters?.qualificationCallDate || {}),
    },
    channels: {
      ...DEFAULT_ADVANCED_FILTERS.channels,
      ...(a.advancedFilters?.channels || {}),
    },
    sources: {
      ...DEFAULT_ADVANCED_FILTERS.sources,
      ...(a.advancedFilters?.sources || {}),
    },
    sgas: {
      ...DEFAULT_ADVANCED_FILTERS.sgas,
      ...(a.advancedFilters?.sgas || {}),
    },
    sgms: {
      ...DEFAULT_ADVANCED_FILTERS.sgms,
      ...(a.advancedFilters?.sgms || {}),
    },
    experimentationTags: {
      ...DEFAULT_ADVANCED_FILTERS.experimentationTags,
      ...(a.advancedFilters?.experimentationTags || {}),
    },
  };
  
  const advB: typeof DEFAULT_ADVANCED_FILTERS = {
    ...DEFAULT_ADVANCED_FILTERS,
    ...(b.advancedFilters || {}),
    initialCallScheduled: {
      ...DEFAULT_ADVANCED_FILTERS.initialCallScheduled,
      ...(b.advancedFilters?.initialCallScheduled || {}),
    },
    qualificationCallDate: {
      ...DEFAULT_ADVANCED_FILTERS.qualificationCallDate,
      ...(b.advancedFilters?.qualificationCallDate || {}),
    },
    channels: {
      ...DEFAULT_ADVANCED_FILTERS.channels,
      ...(b.advancedFilters?.channels || {}),
    },
    sources: {
      ...DEFAULT_ADVANCED_FILTERS.sources,
      ...(b.advancedFilters?.sources || {}),
    },
    sgas: {
      ...DEFAULT_ADVANCED_FILTERS.sgas,
      ...(b.advancedFilters?.sgas || {}),
    },
    sgms: {
      ...DEFAULT_ADVANCED_FILTERS.sgms,
      ...(b.advancedFilters?.sgms || {}),
    },
    experimentationTags: {
      ...DEFAULT_ADVANCED_FILTERS.experimentationTags,
      ...(b.advancedFilters?.experimentationTags || {}),
    },
  };
  
  // Compare date range filters
  if (advA.initialCallScheduled.enabled !== advB.initialCallScheduled.enabled) return false;
  if (advA.initialCallScheduled.preset !== advB.initialCallScheduled.preset) return false;
  if (advA.initialCallScheduled.startDate !== advB.initialCallScheduled.startDate) return false;
  if (advA.initialCallScheduled.endDate !== advB.initialCallScheduled.endDate) return false;
  
  if (advA.qualificationCallDate.enabled !== advB.qualificationCallDate.enabled) return false;
  if (advA.qualificationCallDate.preset !== advB.qualificationCallDate.preset) return false;
  if (advA.qualificationCallDate.startDate !== advB.qualificationCallDate.startDate) return false;
  if (advA.qualificationCallDate.endDate !== advB.qualificationCallDate.endDate) return false;
  
  // Compare multi-select filters (compare arrays by length and sorted values to handle order differences)
  const compareMultiSelect = (a: typeof advA.channels, b: typeof advB.channels) => {
    if (a.selectAll !== b.selectAll) return false;
    if (a.selectAll) return true; // If both are "select all", arrays don't matter
    const aSorted = [...a.selected].sort();
    const bSorted = [...b.selected].sort();
    if (aSorted.length !== bSorted.length) return false;
    return aSorted.every((val, idx) => val === bSorted[idx]);
  };
  
  if (!compareMultiSelect(advA.channels, advB.channels)) return false;
  if (!compareMultiSelect(advA.sources, advB.sources)) return false;
  if (!compareMultiSelect(advA.sgas, advB.sgas)) return false;
  if (!compareMultiSelect(advA.sgms, advB.sgms)) return false;
  if (!compareMultiSelect(advA.experimentationTags, advB.experimentationTags)) return false;
  
  return true;
}

export default function DashboardPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const permissions = getSessionPermissions(session);

  // State
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<DashboardFilters>(DEFAULT_FILTERS);
  /** Applied filters used for fetching/export; updates only on Apply / Reset / Load report. */
  const [appliedFilters, setAppliedFilters] = useState<DashboardFilters>(DEFAULT_FILTERS);
  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);
  
  // Data state - update these three types
  const [metrics, setMetrics] = useState<FunnelMetricsWithGoals | null>(null);
  const [conversionRates, setConversionRates] = useState<ConversionRatesResponse | null>(null);
  const [trends, setTrends] = useState<TrendDataPoint[]>([]);
  const [channels, setChannels] = useState<ChannelPerformanceWithGoals[]>([]);
  const [sources, setSources] = useState<SourcePerformanceWithGoals[]>([]);
  const [detailRecords, setDetailRecords] = useState<DetailRecord[]>([]);
  
  // UI state
  const [viewMode, setViewMode] = useState<ViewMode>('focused');
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [trendGranularity, setTrendGranularity] = useState<'month' | 'quarter'>('quarter');
  const [trendMode, setTrendMode] = useState<ConversionTrendMode>('cohort');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  
  // Volume drill-down modal state
  const [volumeDrillDownOpen, setVolumeDrillDownOpen] = useState(false);
  const [volumeDrillDownRecords, setVolumeDrillDownRecords] = useState<DetailRecord[]>([]);
  const [volumeDrillDownLoading, setVolumeDrillDownLoading] = useState(false);
  const [volumeDrillDownError, setVolumeDrillDownError] = useState<string | null>(null);
  const [volumeDrillDownTitle, setVolumeDrillDownTitle] = useState('');
  const [volumeDrillDownMetric, setVolumeDrillDownMetric] = useState<
    'prospect' | 'contacted' | 'mql' | 'sql' | 'sqo' | 'signed' | 'joined' | 'openPipeline' | null
  >(null);
  
  // Stage filter for DetailRecordsTable (defaults to SQO - middle funnel focus)
  const [stageFilter, setStageFilter] = useState<string>('sqo');
  
  // Saved Reports State
  const [savedReports, setSavedReports] = useState<{
    userReports: SavedReport[];
    adminTemplates: SavedReport[];
  }>({ userReports: [], adminTemplates: [] });
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [featureSelection, setFeatureSelection] = useState<FeatureSelection>(
    DEFAULT_FEATURE_SELECTION
  );
  const [isLoadingReports, setIsLoadingReports] = useState(false);

  // Modal State
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [editingReport, setEditingReport] = useState<SavedReport | null>(null);
  const [deletingReport, setDeletingReport] = useState<SavedReport | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Get admin status
  const isAdmin = permissions?.role === 'admin' || permissions?.role === 'manager';
  
  // Fetch filter options on mount
  useEffect(() => {
    async function fetchFilterOptions() {
      try {
        const data = await dashboardApi.getFilterOptions();
        setFilterOptions(data);
      } catch (error) {
        console.error('Failed to fetch filter options:', error);
        const errorMessage = handleApiError(error);
        // You can add toast notification here: toast.error(errorMessage);
      }
    }
    fetchFilterOptions();
  }, []);
  
  // Always show all predefined opportunity stages, even if no records match
  // Order: Qualifying, Discovery, Sales Process, Negotiating, Signed, On Hold, Closed Lost, Joined
  const availableOpportunityStages = useMemo(() => {
    // Define all possible opportunity stages in preferred order
    // These should always appear in the dropdown, even if no records match
    // Based on user requirements and semantic layer definitions
    const preferredOrder = [
      'Qualifying',
      'Discovery',
      'Sales Process',
      'Negotiating',
      'Signed',
      'On Hold',
      'Closed Lost',
      'Joined'
    ];
    
    // Also collect any additional stages found in the data that aren't in the predefined list
    const additionalStages = new Set<string>();
    const funnelStages = ['Prospect', 'Contacted', 'MQL', 'SQL', 'SQO'];
    
    if (detailRecords && detailRecords.length > 0) {
      detailRecords.forEach(record => {
        if (record.stage && !funnelStages.includes(record.stage) && !preferredOrder.includes(record.stage)) {
          additionalStages.add(record.stage);
        }
      });
    }
    
    // Sort additional stages alphabetically
    const sortedAdditional = Array.from(additionalStages).sort();
    
    // Return all predefined stages first, then any additional stages found in data
    return [...preferredOrder, ...sortedAdditional];
  }, [detailRecords]);
  
  // Filter detail records based on stage filter selection
  // When a stage is selected, filter by both the boolean flag AND the stage-specific date within the date range
  const filteredDetailRecords = useMemo(() => {
    if (!detailRecords || detailRecords.length === 0) return [];
    
    // Get date range from applied filters (matches fetch)
    const dateRange = buildDateRangeFromFilters(appliedFilters);
    const startDate = new Date(dateRange.startDate);
    const endDate = new Date(dateRange.endDate + ' 23:59:59'); // Include full end date
    
    // Helper to check if a date string is within range
    const isDateInRange = (dateStr: string | null): boolean => {
      if (!dateStr) return false;
      const date = new Date(dateStr);
      return date >= startDate && date <= endDate;
    };
    
    return detailRecords.filter(record => {
      switch (stageFilter) {
        case 'prospect':
          // Prospects: Filter by FilterDate (cohort date) within range
          return isDateInRange(record.relevantDate);
        case 'contacted':
          // Contacted: Must be contacted AND contacted date in range
          return record.isContacted === true && isDateInRange(record.contactedDate);
        case 'mql':
          // MQL: Must be MQL AND MQL date in range
          return record.isMql === true && isDateInRange(record.mqlDate);
        case 'sql':
          // SQL: Must be SQL AND SQL conversion date in range
          return record.isSql === true && isDateInRange(record.sqlDate);
        case 'sqo':
          // SQO: Must be SQO AND SQO date in range AND recruiting record type (matches scorecard behavior)
          return record.isSqo === true 
            && isDateInRange(record.sqoDate)
            && record.recordTypeId === RECRUITING_RECORD_TYPE;
        case 'joined':
          // Joined: Must be joined AND join date in range (for legacy 'joined' value)
          return record.isJoined === true && isDateInRange(record.joinedDate);
        case 'openPipeline':
          // Open Pipeline: Current state, no date filter needed
          return record.isOpenPipeline === true;
        default:
          // Handle opportunity stage names (e.g., "Discovery", "Qualifying", "Signed", "Joined")
          // For "Joined" stage name, also check join date in range
          if (stageFilter === 'Joined') {
            return record.stage === 'Joined' && record.isJoined === true && isDateInRange(record.joinedDate);
          }
          // For "Signed" stage, check signed date in range (regardless of current stage)
          // Records may have moved past "Signed" (e.g., to "Joined") but we still want to show them
          if (stageFilter === 'Signed') {
            return record.signedDate !== null && isDateInRange(record.signedDate);
          }
          // For "Discovery" stage, check discovery date in range (regardless of current stage)
          if (stageFilter === 'Discovery') {
            return record.discoveryDate !== null && isDateInRange(record.discoveryDate);
          }
          // For "Sales Process" stage, check sales process date in range (regardless of current stage)
          if (stageFilter === 'Sales Process') {
            return record.salesProcessDate !== null && isDateInRange(record.salesProcessDate);
          }
          // For "Negotiating" stage, check negotiating date in range (regardless of current stage)
          if (stageFilter === 'Negotiating') {
            return record.negotiatingDate !== null && isDateInRange(record.negotiatingDate);
          }
          // For "On Hold" stage, check on hold date in range (regardless of current stage)
          if (stageFilter === 'On Hold') {
            return record.onHoldDate !== null && isDateInRange(record.onHoldDate);
          }
          // For "Closed Lost" stage, check closed date in range (regardless of current stage)
          if (stageFilter === 'Closed Lost') {
            return record.closedDate !== null && isDateInRange(record.closedDate) && record.stage === 'Closed Lost';
          }
          // For other opportunity stages (e.g., "Qualifying"), show all records with that stage (no date filter)
          return record.stage === stageFilter;
      }
    })
    // Deduplicate: For opportunities with multiple leads, keep the most advanced record
    // (e.g., the one that has progressed furthest - has join date, or is in a later stage)
    .reduce((acc: DetailRecord[], record) => {
      // Lead-only records (no opportunity) are always included
      if (!record.opportunityId) {
        acc.push(record);
        return acc;
      }
      
      // For opportunities, check if we already have a record for this opportunity
      const existingIndex = acc.findIndex(r => r.opportunityId === record.opportunityId);
      
      if (existingIndex === -1) {
        // First record for this opportunity - add it
        acc.push(record);
      } else {
        // We already have a record for this opportunity - keep the most advanced one
        const existing = acc[existingIndex];
        
        // Prefer the record that has progressed furthest:
        // 1. Has join date (most advanced)
        // 2. Has signed date
        // 3. Has more stage dates
        // 4. Is in a later stage
        const recordScore = (record.isJoined ? 1000 : 0) +
                           (record.joinedDate ? 500 : 0) +
                           (record.signedDate ? 400 : 0) +
                           (record.salesProcessDate ? 300 : 0) +
                           (record.discoveryDate ? 200 : 0) +
                           (record.negotiatingDate ? 100 : 0);
        
        const existingScore = (existing.isJoined ? 1000 : 0) +
                              (existing.joinedDate ? 500 : 0) +
                              (existing.signedDate ? 400 : 0) +
                              (existing.salesProcessDate ? 300 : 0) +
                              (existing.discoveryDate ? 200 : 0) +
                              (existing.negotiatingDate ? 100 : 0);
        
        if (recordScore > existingScore) {
          // Replace with the more advanced record
          acc[existingIndex] = record;
        }
        // Otherwise keep the existing record
      }
      
      return acc;
    }, []);
  }, [detailRecords, stageFilter, appliedFilters]);
  
  // Fetch saved reports
  const fetchSavedReports = useCallback(async () => {
    try {
      setIsLoadingReports(true);
      const data = await dashboardApi.getSavedReports();
      console.log('[DEBUG] Fetched saved reports:', {
        userReportsCount: data.userReports.length,
        adminTemplatesCount: data.adminTemplates.length,
        userReports: data.userReports.map(r => ({ 
          id: r.id, 
          name: r.name, 
          isDefault: r.isDefault, 
          isActive: r.isActive,
          dashboard: r.dashboard,
          userId: r.userId,
        })),
      });
      // Also log the full data to see everything
      // Safely stringify data, handling circular references
      try {
        console.log('[DEBUG] Full saved reports data:', JSON.stringify(data, null, 2));
      } catch (stringifyError) {
        console.log('[DEBUG] Full saved reports data (stringify failed, logging object):', data);
      }
      setSavedReports(data);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Failed to fetch saved reports:', errorMessage);
    } finally {
      setIsLoadingReports(false);
    }
  }, []);

  // Apply a report (filters + feature selection + view mode)
  // IMPORTANT: Saved report viewMode overrides current view mode. Applies filters immediately (no Apply click).
  const applyReport = useCallback((report: SavedReport) => {
    const reportFilters = report.filters as DashboardFilters;
    setActiveReportId(report.id);
    setFilters(reportFilters);
    setAppliedFilters(reportFilters);
    setFeatureSelection(getEffectiveFeatureSelection(report.featureSelection));
    // Override view mode with saved report's view mode (if specified)
    if (report.viewMode) {
      setViewMode(report.viewMode as ViewMode);
    }
  }, []);

  // Load default report on mount
  const loadDefaultReport = useCallback(async () => {
    try {
      const defaultReport = await dashboardApi.getDefaultReport();
      if (defaultReport) {
        applyReport(defaultReport);
      }
    } catch (error) {
      console.error('Failed to load default report:', error);
    }
  }, [applyReport]);

  // Handle selecting a report
  const handleSelectReport = useCallback((report: SavedReport) => {
    applyReport(report);
  }, [applyReport]);

  // Handle saving a report
  const handleSaveReport = useCallback(
    async (
      name: string,
      description: string,
      filters: DashboardFilters,
      featureSelection: FeatureSelection,
      viewMode: ViewMode,
      isDefault: boolean,
      isAdminTemplate: boolean
    ) => {
      setIsSaving(true);
      try {
        if (editingReport) {
          await dashboardApi.updateSavedReport(editingReport.id, {
            name,
            description,
            filters,
            featureSelection,
            viewMode,
            isDefault,
          });
        } else {
          await dashboardApi.createSavedReport({
            name,
            description,
            filters,
            featureSelection,
            viewMode,
            isDefault,
            reportType: isAdminTemplate ? 'admin_template' : 'user',
          });
        }
        await fetchSavedReports();
        // If this was set as default, load it
        if (isDefault && !isAdminTemplate) {
          await loadDefaultReport();
        }
        setEditingReport(null);
      } catch (error) {
        console.error('Failed to save report:', error);
        throw error; // Re-throw to let modal handle error display
      } finally {
        setIsSaving(false);
      }
    },
    [editingReport, fetchSavedReports]
  );

  // Handle editing a report
  const handleEditReport = useCallback((report: SavedReport) => {
    setEditingReport(report);
    setIsSaveModalOpen(true);
  }, []);

  // Handle duplicating a report
  const handleDuplicateReport = useCallback(
    async (report: SavedReport) => {
      try {
        await dashboardApi.duplicateSavedReport(report.id);
        await fetchSavedReports();
      } catch (error) {
        console.error('Failed to duplicate report:', error);
      }
    },
    [fetchSavedReports]
  );

  // Handle deleting a report
  const handleDeleteReport = useCallback((report: SavedReport) => {
    setDeletingReport(report);
    setIsDeleteModalOpen(true);
  }, []);

  const confirmDeleteReport = useCallback(async () => {
    if (!deletingReport) return;
    
    setIsDeleting(true);
    try {
      await dashboardApi.deleteSavedReport(deletingReport.id);
      await fetchSavedReports();
      if (activeReportId === deletingReport.id) {
        setActiveReportId(null);
        // Reset to default feature selection when deleting active report
        setFeatureSelection(DEFAULT_FEATURE_SELECTION);
      }
      setIsDeleteModalOpen(false);
      setDeletingReport(null);
    } catch (error) {
      console.error('Failed to delete report:', error);
    } finally {
      setIsDeleting(false);
    }
  }, [deletingReport, activeReportId, fetchSavedReports]);

  // Handle setting default
  const handleSetDefault = useCallback(
    async (report: SavedReport) => {
      try {
        await dashboardApi.setDefaultReport(report.id);
        await fetchSavedReports();
      } catch (error) {
        console.error('Failed to set default report:', error);
      }
    },
    [fetchSavedReports]
  );

  // Open save modal for new report
  const handleOpenSaveModal = useCallback(() => {
    setEditingReport(null);
    setIsSaveModalOpen(true);
  }, []);

  // Apply pending filter changes → triggers single fetch, avoids race conditions
  // If updatedAdvancedFilters is provided, use it to construct the complete filters object
  const handleApplyFilters = useCallback((updatedAdvancedFilters?: typeof filters.advancedFilters) => {
    if (updatedAdvancedFilters !== undefined) {
      // AdvancedFilters is applying - use the provided advancedFilters and current global filters
      setAppliedFilters({ 
        ...filters, 
        advancedFilters: updatedAdvancedFilters 
      });
    } else {
      // GlobalFilters is applying - use current filters state (which includes any pending advanced filter changes)
      setAppliedFilters({ ...filters });
    }
  }, [filters]);

  // Fetch dashboard data when applied filters change (not on every dropdown change)
  const fetchDashboardData = useCallback(async () => {
    if (!filterOptions) return; // Wait for filter options
    
    setLoading(true);
    
    try {
      // Build date range from applied filters
      const dateRange = buildDateRangeFromFilters(appliedFilters);
      
      // Use applied filters - data fetches only run after Apply / Reset / Load report
      const currentFilters: DashboardFilters = {
        ...appliedFilters,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        // Always fetch all records (prospects) for client-side filtering via stage dropdown
        metricFilter: 'prospect' as DashboardFilters['metricFilter'],
      };
      
      const promises: Promise<any>[] = [];
      
      // Conditional fetch: Only fetch metrics if any scorecard is visible
      // OR if tables need metrics data
      const needsMetrics = 
        // Full Funnel scorecards (only in fullFunnel view)
        (viewMode === 'fullFunnel' && (
          featureSelection.scorecards.prospects ||
          featureSelection.scorecards.contacted ||
          featureSelection.scorecards.mqls
        )) ||
        // Volume scorecards (available in both views)
        featureSelection.scorecards.sqls ||
        featureSelection.scorecards.sqos ||
        featureSelection.scorecards.signed ||
        featureSelection.scorecards.signedAum ||
        featureSelection.scorecards.joined ||
        featureSelection.scorecards.joinedAum ||
        featureSelection.scorecards.openPipeline ||
        // Tables need metrics for calculations
        featureSelection.tables.channelPerformance ||
        featureSelection.tables.sourcePerformance;
      
      if (needsMetrics) {
        promises.push(
          dashboardApi.getFunnelMetrics(currentFilters, viewMode)
            .then(setMetrics)
        );
      }
      
      // Conditional fetch: Only fetch conversion rates if any rate card is visible
      // OR if charts need trends data
      const needsConversionRates = 
        featureSelection.conversionRates.contactedToMql ||
        featureSelection.conversionRates.mqlToSql ||
        featureSelection.conversionRates.sqlToSqo ||
        featureSelection.conversionRates.sqoToJoined ||
        featureSelection.charts.conversionTrends ||
        featureSelection.charts.volumeTrends;
      
      if (needsConversionRates) {
        promises.push(
          dashboardApi.getConversionRates(currentFilters, { 
            includeTrends: true, 
            granularity: trendGranularity, 
            mode: trendMode 
          })
            .then(data => {
              setConversionRates(data.rates);
              setTrends(data.trends || []);
            })
        );
      }
      
      // Conditional fetch: Channel performance
      if (featureSelection.tables.channelPerformance) {
        promises.push(
          dashboardApi.getChannelPerformance(currentFilters, viewMode)
            .then(data => setChannels(data.channels))
        );
      }
      
      // Conditional fetch: Source performance
      if (featureSelection.tables.sourcePerformance) {
        promises.push(
          dashboardApi.getSourcePerformance(currentFilters, viewMode)
            .then(data => setSources(data.sources))
        );
      }
      
      // Conditional fetch: Detail records
      if (featureSelection.tables.detailRecords) {
        promises.push(
          dashboardApi.getDetailRecords(currentFilters, 50000)
            .then(data => setDetailRecords(data.records))
        );
      }
      
      await Promise.all(promises);
      
    } catch (error) {
      // Safely log error without circular references
      const errorMessage = handleApiError(error);
      console.error('Failed to fetch dashboard data:', errorMessage, error instanceof Error ? error.stack : '');
      // You can add toast notification here: toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [appliedFilters, trendGranularity, trendMode, filterOptions, viewMode, featureSelection]);
  
  // Fetch saved reports and load default on mount
  useEffect(() => {
    async function initializeReports() {
      // First fetch all reports
      await fetchSavedReports();
      // Then load the default report (if any)
      await loadDefaultReport();
    }
    initializeReports();
  }, [fetchSavedReports, loadDefaultReport]);

  useEffect(() => {
    if (filterOptions) {
      fetchDashboardData();
    }
  }, [fetchDashboardData, filterOptions]);
  
  // Handle metric card click
  const handleMetricClick = async (metric: string) => {
    // Open drill-down modal instead of filtering the main table
    // Clear any previous selection state (no visual highlighting)
    setSelectedMetric(null);
    
    // Map metric IDs to proper metric filter values
    const metricMap: Record<string, 'prospect' | 'contacted' | 'mql' | 'sql' | 'sqo' | 'signed' | 'joined' | 'openPipeline'> = {
      'prospect': 'prospect',
      'contacted': 'contacted',
      'mql': 'mql',
      'sql': 'sql',
      'sqo': 'sqo',
      'signed': 'signed',
      'joined': 'joined',
      'openPipeline': 'openPipeline',
    };
    
    const metricFilter = metricMap[metric];
    if (!metricFilter) {
      console.warn(`Unknown metric: ${metric}`);
      return;
    }
    
    // Set modal state
    setVolumeDrillDownMetric(metricFilter);
    setVolumeDrillDownLoading(true);
    setVolumeDrillDownError(null);
    setVolumeDrillDownOpen(true);
    
    // Build title with metric name and date range
    const metricLabels: Record<string, string> = {
      prospect: 'Prospects',
      contacted: 'Contacted',
      mql: 'MQLs',
      sql: 'SQLs',
      sqo: 'SQOs',
      signed: 'Signed',
      joined: 'Joined',
      openPipeline: 'Open Pipeline',
    };
    
    const dateRange = buildDateRangeFromFilters(appliedFilters);
    const dateRangeText = appliedFilters.datePreset === 'custom' 
      ? `${dateRange.startDate} to ${dateRange.endDate}`
      : appliedFilters.datePreset?.toUpperCase() || 'Selected Period';
    
    setVolumeDrillDownTitle(`${metricLabels[metricFilter]} - ${dateRangeText}`);
    
    try {
      // Build filters for the drill-down query (use applied filters)
      const drillDownFilters: DashboardFilters = {
        ...appliedFilters,
        metricFilter: metricFilter,
      };
      
      // Fetch records for the selected metric
      const response = await dashboardApi.getDetailRecords(drillDownFilters, 50000);
      setVolumeDrillDownRecords(response.records);
    } catch (error) {
      console.error('Error fetching drill-down records:', error);
      setVolumeDrillDownError('Failed to load records. Please try again.');
    } finally {
      setVolumeDrillDownLoading(false);
    }
  };

  // Handle view mode changes to clear full-funnel metric selections when switching to focused view
  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    // When switching from fullFunnel to focused, clear selection if it's a full-funnel metric
    if (mode === 'focused' && ['prospect', 'contacted', 'mql'].includes(selectedMetric || '')) {
      setSelectedMetric(null);
      setFilters(prev => ({ ...prev, metricFilter: 'all' }));
    }
  };
  
  // Handle channel row click - update filters directly and immediately apply
  const handleChannelClick = (channel: string | null) => {
    setSelectedChannel(channel);
    setSelectedSource(null); // Reset source when channel changes
    const updatedFilters = {
      ...appliedFilters,
      channel: channel,
      source: null, // Reset source when channel changes
    };
    setFilters(updatedFilters);
    setAppliedFilters(updatedFilters); // Immediately apply to trigger refetch with channel filter
  };
  
  // Handle source row click - update filters directly
  const handleSourceClick = (source: string | null) => {
    setSelectedSource(source);
    setFilters(prev => ({
      ...prev,
      source: source,
    }));
  };
  
  // Handle filter reset
  const handleFilterReset = () => {
    setFilters(DEFAULT_FILTERS);
    setSelectedMetric(null);
    setSelectedChannel(null);
    setSelectedSource(null);
  };

  // Handle record click to open modal
  const handleRecordClick = useCallback((recordId: string) => {
    setSelectedRecordId(recordId);
  }, []);

  // Handle modal close
  const handleCloseRecordModal = useCallback(() => {
    setSelectedRecordId(null);
  }, []);

  // Handle volume trend bar click
  const handleVolumeBarClick = useCallback(async (metric: 'sql' | 'sqo' | 'joined', period: string) => {
    setVolumeDrillDownLoading(true);
    setVolumeDrillDownError(null);
    setVolumeDrillDownOpen(true);
    setVolumeDrillDownMetric(metric);
    
    // Parse period to date range
    const { startDate, endDate } = parsePeriodToDateRange(period);
    
    // Set title
    const metricLabels: Record<'sql' | 'sqo' | 'joined', string> = {
      sql: 'SQLs',
      sqo: 'SQOs',
      joined: 'Joined',
    };
    setVolumeDrillDownTitle(`${metricLabels[metric]} - ${period}`);
    
    try {
      // Build filters for the drill-down (use applied filters as base)
      const drillDownFilters: DashboardFilters = {
        ...appliedFilters,
        startDate,
        endDate,
        metricFilter: metric, // 'sql', 'sqo', or 'joined'
        datePreset: 'custom',
      };
      
      // Fetch records using getDetailRecords
      const response = await dashboardApi.getDetailRecords(drillDownFilters, 50000);
      setVolumeDrillDownRecords(response.records);
    } catch (error) {
      console.error('Error fetching volume drill-down records:', error);
      setVolumeDrillDownError('Failed to load records. Please try again.');
    } finally {
      setVolumeDrillDownLoading(false);
    }
  }, [appliedFilters]);

  // Handle record click from volume drill-down
  const handleVolumeDrillDownRecordClick = useCallback((primaryKey: string) => {
    setVolumeDrillDownOpen(false);
    setSelectedRecordId(primaryKey);
  }, []);

  // Handle close volume drill-down modal
  const handleCloseVolumeDrillDown = useCallback(() => {
    setVolumeDrillDownOpen(false);
    setVolumeDrillDownRecords([]);
    setVolumeDrillDownMetric(null);
  }, []);
  
  // Build detail table description
  const getDetailDescription = () => {
    const parts = [];
    
    // Add stage filter to description (replaces selectedMetric)
    const stageLabels: Record<string, string> = {
      prospect: 'Prospects',
      contacted: 'Contacted',
      mql: 'MQLs',
      sql: 'SQLs',
      sqo: 'SQOs',
      joined: 'Joined',
      openPipeline: 'Open Pipeline',
    };
    const stageLabel = stageLabels[stageFilter] || stageFilter;
    parts.push(stageLabel);
    
    if (selectedChannel) parts.push(`Channel: ${selectedChannel}`);
    if (selectedSource) parts.push(`Source: ${selectedSource}`);
    
    if (parts.length > 0) {
      return `Filtered by: ${parts.join(', ')}`;
    }
    
    // Default to SQOs (since that's the default stage filter)
    return 'All SQOs';
  };

  if (!filterOptions) {
    return <LoadingSpinner />;
  }

  return (
    <div className="w-full max-w-full overflow-x-hidden">
      <div className="mb-6">
        <div className="flex justify-between items-center mb-4">
          <div>
            <Title>Funnel Performance & Efficiency</Title>
            <Text>Track volume, conversion rates, and pipeline health</Text>
          </div>
          <ViewModeToggle value={viewMode} onChange={handleViewModeChange} />
        </div>
      </div>
      
      <FilterErrorBoundary>
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1">
            <GlobalFilters
              filters={filters}
              filterOptions={filterOptions}
              hasPendingChanges={!filtersAreEqual(filters, appliedFilters)}
              onFiltersChange={(newFilters) => {
                setFilters(newFilters);
                setActiveReportId(null); // Clear active report when manually changing filters
              }}
              onApply={handleApplyFilters}
              onReset={() => {
                setFilters(DEFAULT_FILTERS);
                setAppliedFilters(DEFAULT_FILTERS);
                setActiveReportId(null);
                setFeatureSelection(DEFAULT_FEATURE_SELECTION);
              }}
              savedReports={savedReports}
              activeReportId={activeReportId}
              onSelectReport={handleSelectReport}
              onEditReport={handleEditReport}
              onDuplicateReport={handleDuplicateReport}
              onDeleteReport={handleDeleteReport}
              onSetDefault={handleSetDefault}
              onSaveReport={handleOpenSaveModal}
              isLoadingReports={isLoadingReports}
              isAdmin={isAdmin}
            />
          </div>
          <AdvancedFiltersButton
            onClick={() => setShowAdvancedFilters(true)}
            activeCount={countActiveAdvancedFilters(filters.advancedFilters || DEFAULT_ADVANCED_FILTERS)}
          />
        </div>
      </FilterErrorBoundary>

      {/* Export Button */}
      <div className="mb-6 flex justify-end">
        <ExportToSheetsButton 
          filters={appliedFilters}
          mode={trendMode}
          disabled={loading}
          canExport={permissions?.canExport ?? false}
        />
      </div>
      
      {loading ? (
        <LoadingSpinner />
      ) : (
        <>
          {/* Full Funnel Scorecards - conditional on viewMode AND any full funnel scorecard visible */}
          {viewMode === 'fullFunnel' && metrics && (
            (featureSelection.scorecards.prospects ||
             featureSelection.scorecards.contacted ||
             featureSelection.scorecards.mqls) && (
              <CardErrorBoundary>
                <FullFunnelScorecards
                  metrics={metrics}
                  selectedMetric={selectedMetric}
                  onMetricClick={handleMetricClick}
                  loading={loading}
                  visibleMetrics={{
                    prospects: featureSelection.scorecards.prospects,
                    contacted: featureSelection.scorecards.contacted,
                    mqls: featureSelection.scorecards.mqls,
                  }}
                />
              </CardErrorBoundary>
            )
          )}

          {/* Volume Scorecards - conditional on any volume scorecard visible */}
          {metrics && (
            (featureSelection.scorecards.sqls ||
             featureSelection.scorecards.sqos ||
             featureSelection.scorecards.signed ||
             featureSelection.scorecards.signedAum ||
             featureSelection.scorecards.joined ||
             featureSelection.scorecards.joinedAum ||
             featureSelection.scorecards.openPipeline) && (
              <CardErrorBoundary>
                <Scorecards
                  metrics={metrics}
                  selectedMetric={selectedMetric}
                  onMetricClick={handleMetricClick}
                  visibleMetrics={{
                    sqls: featureSelection.scorecards.sqls,
                    sqos: featureSelection.scorecards.sqos,
                    signed: featureSelection.scorecards.signed,
                    signedAum: featureSelection.scorecards.signedAum,
                    joined: featureSelection.scorecards.joined,
                    joinedAum: featureSelection.scorecards.joinedAum,
                    openPipeline: featureSelection.scorecards.openPipeline,
                  }}
                />
              </CardErrorBoundary>
            )
          )}
          
          {/* Conversion Rate Cards - conditional on any rate card visible */}
          {conversionRates && (
            (featureSelection.conversionRates.contactedToMql ||
             featureSelection.conversionRates.mqlToSql ||
             featureSelection.conversionRates.sqlToSqo ||
             featureSelection.conversionRates.sqoToJoined) && (
              <CardErrorBoundary>
                <ConversionRateCards
                  conversionRates={conversionRates}
                  isLoading={loading}
                  visibleRates={{
                    contactedToMql: featureSelection.conversionRates.contactedToMql,
                    mqlToSql: featureSelection.conversionRates.mqlToSql,
                    sqlToSqo: featureSelection.conversionRates.sqlToSqo,
                    sqoToJoined: featureSelection.conversionRates.sqoToJoined,
                  }}
                />
              </CardErrorBoundary>
            )
          )}
          
          {/* Conversion Trends Chart - conditional on featureSelection */}
          {featureSelection.charts.conversionTrends && (
            <ChartErrorBoundary>
              <ConversionTrendChart
                trends={trends}
                onGranularityChange={setTrendGranularity}
                granularity={trendGranularity}
                mode={trendMode}
                onModeChange={(newMode) => {
                  setTrendMode(newMode);
                  // Trigger refetch when mode changes
                  fetchDashboardData();
                }}
                isLoading={loading}
              />
            </ChartErrorBoundary>
          )}
          
          {/* Volume Trends Chart - conditional on featureSelection */}
          {featureSelection.charts.volumeTrends && (
            <ChartErrorBoundary>
              <VolumeTrendChart
                trends={trends}
                onGranularityChange={setTrendGranularity}
                granularity={trendGranularity}
                isLoading={loading}
                onBarClick={handleVolumeBarClick}
              />
            </ChartErrorBoundary>
          )}
          
          {/* Channel Performance - conditional on featureSelection */}
          {featureSelection.tables.channelPerformance && (
            <TableErrorBoundary>
              <ChannelPerformanceTable
                channels={channels}
                selectedChannel={selectedChannel}
                onChannelClick={handleChannelClick}
                viewMode={viewMode}
              />
            </TableErrorBoundary>
          )}
          
          {/* Source Performance - conditional on featureSelection */}
          {featureSelection.tables.sourcePerformance && (
            <TableErrorBoundary>
              <SourcePerformanceTable
                sources={sources}
                selectedSource={selectedSource}
                onSourceClick={handleSourceClick}
                channelFilter={selectedChannel}
                viewMode={viewMode}
              />
            </TableErrorBoundary>
          )}
          
          {/* Detail Records - conditional on featureSelection */}
          {featureSelection.tables.detailRecords && (
            <TableErrorBoundary>
              <DetailRecordsTable
                records={filteredDetailRecords}
                title="Record Details"
                filterDescription={getDetailDescription()}
                canExport={permissions?.canExport ?? false}
                viewMode={viewMode}
                advancedFilters={filters.advancedFilters}
                metricFilter="prospect"
                onRecordClick={handleRecordClick}
                stageFilter={stageFilter}
                onStageFilterChange={setStageFilter}
                availableOpportunityStages={availableOpportunityStages}
              />
            </TableErrorBoundary>
          )}
        </>
      )}
      
      {/* Advanced Filters Modal */}
      {filterOptions && (
        <AdvancedFilters
          filters={filters.advancedFilters || DEFAULT_ADVANCED_FILTERS}
          onFiltersChange={(newAdvancedFilters) => {
            setFilters(prev => ({ ...prev, advancedFilters: newAdvancedFilters }));
          }}
          onApply={(updatedAdvancedFilters) => {
            // Pass the updated advanced filters to handleApplyFilters so it can apply all filters together
            handleApplyFilters(updatedAdvancedFilters);
          }}
          viewMode={viewMode}
          onClose={() => setShowAdvancedFilters(false)}
          isOpen={showAdvancedFilters}
          filterOptions={filterOptions}
        />
      )}

      {/* Volume Drill-Down Modal */}
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
          canExport={permissions?.canExport ?? false}
        />
      )}

      {/* Record Detail Modal */}
      <RecordDetailModal
        isOpen={selectedRecordId !== null}
        onClose={handleCloseRecordModal}
        recordId={selectedRecordId}
        showBackButton={volumeDrillDownOpen}
        onBack={() => {
          setSelectedRecordId(null);
          setVolumeDrillDownOpen(true);
        }}
        backButtonLabel="← Back to records"
      />

      {/* Save Report Modal */}
      <SaveReportModal
        isOpen={isSaveModalOpen}
        onClose={() => {
          setIsSaveModalOpen(false);
          setEditingReport(null);
        }}
        onSave={handleSaveReport}
        currentFilters={appliedFilters}
        currentViewMode={viewMode}
        currentFeatureSelection={featureSelection}
        editingReport={editingReport}
        isAdmin={isAdmin}
        isSaving={isSaving}
      />

      {/* Delete Confirm Modal */}
      <DeleteConfirmModal
        isOpen={isDeleteModalOpen}
        onClose={() => {
          setIsDeleteModalOpen(false);
          setDeletingReport(null);
        }}
        onConfirm={confirmDeleteReport}
        reportName={deletingReport?.name || ''}
        isDeleting={isDeleting}
      />
    </div>
  );
}
