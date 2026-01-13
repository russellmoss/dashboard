'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Title, Text } from '@tremor/react';
import { GlobalFilters } from '@/components/dashboard/GlobalFilters';
import { Scorecards } from '@/components/dashboard/Scorecards';
import { ConversionRateCards } from '@/components/dashboard/ConversionRateCards';
import { ConversionTrendChart } from '@/components/dashboard/ConversionTrendChart';
import { ChannelPerformanceTable } from '@/components/dashboard/ChannelPerformanceTable';
import { SourcePerformanceTable } from '@/components/dashboard/SourcePerformanceTable';
import { DetailRecordsTable } from '@/components/dashboard/DetailRecordsTable';
import { ExportToSheetsButton } from '@/components/dashboard/ExportToSheetsButton';
import { AdvancedFilters, AdvancedFiltersButton } from '@/components/dashboard/AdvancedFilters';
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
import { buildDateRangeFromFilters } from '@/lib/utils/date-helpers';
import { getSessionPermissions } from '@/types/auth';

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
  metricFilter: 'all',
  advancedFilters: DEFAULT_ADVANCED_FILTERS,
};

export default function DashboardPage() {
  const { data: session } = useSession();
  const permissions = getSessionPermissions(session);
  
  // State
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<DashboardFilters>(DEFAULT_FILTERS);
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
  
  // Fetch dashboard data when filters change
  const fetchDashboardData = useCallback(async () => {
    if (!filterOptions) return; // Wait for filter options
    
    setLoading(true);
    
    try {
      // Build date range from filters
      const dateRange = buildDateRangeFromFilters(filters);
      
      // Use filters directly - table clicks (selectedChannel/selectedSource) update filters.channel/filters.source
      const currentFilters: DashboardFilters = {
        ...filters,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        metricFilter: (selectedMetric || 'all') as DashboardFilters['metricFilter'],
      };
      
      // Fetch all data in parallel
      const [metricsData, conversionData, channelsData, sourcesData, recordsData] = await Promise.all([
        dashboardApi.getFunnelMetrics(currentFilters, viewMode),
        dashboardApi.getConversionRates(currentFilters, { includeTrends: true, granularity: trendGranularity, mode: trendMode }),
        dashboardApi.getChannelPerformance(currentFilters, viewMode),
        dashboardApi.getSourcePerformance(currentFilters, viewMode),
        dashboardApi.getDetailRecords(currentFilters, 50000), // Increased limit to fetch all records
      ]);
      
      setMetrics(metricsData);
      setConversionRates(conversionData.rates);
      const trendsData = conversionData.trends || [];
      setTrends(trendsData);
      setChannels(channelsData.channels);
      setSources(sourcesData.sources);
      setDetailRecords(recordsData.records);
      
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
      const errorMessage = handleApiError(error);
      // You can add toast notification here: toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [filters, selectedMetric, trendGranularity, trendMode, filterOptions, viewMode]);
  
  useEffect(() => {
    if (filterOptions) {
      fetchDashboardData();
    }
  }, [fetchDashboardData, filterOptions]);
  
  // Handle metric card click
  const handleMetricClick = (metric: string) => {
    const newMetric = selectedMetric === metric ? null : metric;
    setSelectedMetric(newMetric);
    
    // Update filters to fetch appropriate detail records
    setFilters(prev => ({
      ...prev,
      metricFilter: (newMetric || 'all') as DashboardFilters['metricFilter'],
    }));
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
  
  // Handle channel row click - update filters directly
  const handleChannelClick = (channel: string | null) => {
    setSelectedChannel(channel);
    setSelectedSource(null); // Reset source when channel changes
    setFilters(prev => ({
      ...prev,
      channel: channel,
      source: null, // Reset source when channel changes
    }));
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
  
  // Build detail table description
  const getDetailDescription = () => {
    const parts = [];
    if (selectedMetric) {
      const metricLabels: Record<string, string> = {
        prospect: 'Prospects',
        contacted: 'Contacted',
        mql: 'MQLs',
        sql: 'SQLs',
        sqo: 'SQOs',
        joined: 'Joined',
        openPipeline: 'Open Pipeline',
      };
      parts.push(metricLabels[selectedMetric] || selectedMetric.toUpperCase());
    }
    if (selectedChannel) parts.push(`Channel: ${selectedChannel}`);
    if (selectedSource) parts.push(`Source: ${selectedSource}`);
    
    if (parts.length > 0) {
      return `Filtered by: ${parts.join(', ')}`;
    }
    
    // Default description based on view mode
    return viewMode === 'fullFunnel' ? 'All Records' : 'All SQLs';
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
              onFiltersChange={setFilters}
              onReset={handleFilterReset}
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
          filters={filters}
          mode={trendMode}
          disabled={loading}
          canExport={permissions?.canExport ?? false}
        />
      </div>
      
      {loading ? (
        <LoadingSpinner />
      ) : (
        <>
          {/* Full Funnel Scorecards (only shown in fullFunnel view) */}
          {viewMode === 'fullFunnel' && metrics && (
            <CardErrorBoundary>
              <FullFunnelScorecards
                metrics={metrics}
                selectedMetric={selectedMetric}
                onMetricClick={handleMetricClick}
                loading={loading}
              />
            </CardErrorBoundary>
          )}

          {/* Volume Scorecards */}
          {metrics && (
            <CardErrorBoundary>
              <Scorecards
                metrics={metrics}
                selectedMetric={selectedMetric}
                onMetricClick={handleMetricClick}
              />
            </CardErrorBoundary>
          )}
          
          {/* Conversion Rate Cards */}
          {conversionRates && (
            <CardErrorBoundary>
              <ConversionRateCards conversionRates={conversionRates} isLoading={loading} />
            </CardErrorBoundary>
          )}
          
          {/* Trend Chart */}
          <ChartErrorBoundary>
            <ConversionTrendChart
              trends={trends}
              onGranularityChange={setTrendGranularity}
              granularity={trendGranularity}
              mode={trendMode}
              onModeChange={setTrendMode}
              isLoading={loading}
            />
          </ChartErrorBoundary>
          
          {/* Channel Performance */}
          <TableErrorBoundary>
            <ChannelPerformanceTable
              channels={channels}
              selectedChannel={selectedChannel}
              onChannelClick={handleChannelClick}
              viewMode={viewMode}
            />
          </TableErrorBoundary>
          
          {/* Source Performance (filtered by channel if selected) */}
          <TableErrorBoundary>
            <SourcePerformanceTable
              sources={sources}
              selectedSource={selectedSource}
              onSourceClick={handleSourceClick}
              channelFilter={selectedChannel}
              viewMode={viewMode}
            />
          </TableErrorBoundary>
          
          {/* Detail Records */}
          <TableErrorBoundary>
            <DetailRecordsTable
              records={detailRecords}
              title="Record Details"
              filterDescription={getDetailDescription()}
              canExport={permissions?.canExport ?? false}
              viewMode={viewMode}
              advancedFilters={filters.advancedFilters}
              metricFilter={filters.metricFilter}
            />
          </TableErrorBoundary>
        </>
      )}
      
      {/* Advanced Filters Modal */}
      {filterOptions && (
        <AdvancedFilters
          filters={filters.advancedFilters || DEFAULT_ADVANCED_FILTERS}
          onFiltersChange={(newAdvancedFilters) => {
            setFilters(prev => ({ ...prev, advancedFilters: newAdvancedFilters }));
          }}
          viewMode={viewMode}
          onClose={() => setShowAdvancedFilters(false)}
          isOpen={showAdvancedFilters}
          filterOptions={filterOptions}
        />
      )}
    </div>
  );
}
