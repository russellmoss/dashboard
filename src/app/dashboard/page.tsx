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
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ChartErrorBoundary, TableErrorBoundary, CardErrorBoundary, FilterErrorBoundary } from '@/components/ui';
import { dashboardApi, handleApiError } from '@/lib/api-client';
import { DashboardFilters, FilterOptions } from '@/types/filters';
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
  ConversionTrendMode 
} from '@/types/dashboard';
import { buildDateRangeFromFilters } from '@/lib/utils/date-helpers';
import { getSessionPermissions } from '@/types/auth';

export const dynamic = 'force-dynamic';

const DEFAULT_FILTERS: DashboardFilters = {
  startDate: '2025-10-01',
  endDate: '2025-12-31',
  datePreset: 'q4',
  year: 2025,
  channel: null,
  source: null,
  sga: null,
  sgm: null,
  stage: null,
  metricFilter: 'all',
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
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [trendGranularity, setTrendGranularity] = useState<'month' | 'quarter'>('quarter');
  const [trendMode, setTrendMode] = useState<ConversionTrendMode>('period');
  
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
        dashboardApi.getFunnelMetrics(currentFilters),
        dashboardApi.getConversionRates(currentFilters, { includeTrends: true, granularity: trendGranularity, mode: trendMode }),
        dashboardApi.getChannelPerformance(currentFilters),
        dashboardApi.getSourcePerformance(currentFilters),
        dashboardApi.getDetailRecords(currentFilters, 500),
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
  }, [filters, selectedMetric, trendGranularity, trendMode, filterOptions]);
  
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
    if (selectedMetric) parts.push(selectedMetric.toUpperCase());
    if (selectedChannel) parts.push(`Channel: ${selectedChannel}`);
    if (selectedSource) parts.push(`Source: ${selectedSource}`);
    return parts.length > 0 ? `Filtered by: ${parts.join(', ')}` : 'All SQLs';
  };

  if (!filterOptions) {
    return <LoadingSpinner />;
  }

  return (
    <div>
      <div className="mb-6">
        <Title>Funnel Performance & Efficiency</Title>
        <Text>Track volume, conversion rates, and pipeline health</Text>
      </div>
      
      <FilterErrorBoundary>
        <GlobalFilters
          filters={filters}
          filterOptions={filterOptions}
          onFiltersChange={setFilters}
          onReset={handleFilterReset}
        />
      </FilterErrorBoundary>
      
      {loading ? (
        <LoadingSpinner />
      ) : (
        <>
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
            />
          </TableErrorBoundary>
          
          {/* Source Performance (filtered by channel if selected) */}
          <TableErrorBoundary>
            <SourcePerformanceTable
              sources={sources}
              selectedSource={selectedSource}
              onSourceClick={handleSourceClick}
              channelFilter={selectedChannel}
            />
          </TableErrorBoundary>
          
          {/* Detail Records */}
          <TableErrorBoundary>
            <DetailRecordsTable
              records={detailRecords}
              title="Record Details"
              filterDescription={getDetailDescription()}
              canExport={permissions?.canExport ?? false}
            />
          </TableErrorBoundary>
        </>
      )}
    </div>
  );
}
