'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { getSessionPermissions } from '@/types/auth';
import ActivityFilters from '@/components/sga-activity/ActivityFilters';
import ScheduledCallsCards from '@/components/sga-activity/ScheduledCallsCards';
import ActivityTotalsCards from '@/components/sga-activity/ActivityTotalsCards';
import ActivityDistributionTable from '@/components/sga-activity/ActivityDistributionTable';
import RateCards from '@/components/sga-activity/RateCards';
import ActivityDrillDownModal from '@/components/sga-activity/ActivityDrillDownModal';
import { DataFreshnessIndicator } from '@/components/dashboard/DataFreshnessIndicator';
import { RecordDetailModal } from '@/components/dashboard/RecordDetailModal';
import {
  SGAActivityFilters,
  SGAActivityDashboardData,
  ActivityRecord,
  ScheduledCallRecord,
  ActivityChannel,
} from '@/types/sga-activity';

const DEFAULT_FILTERS: SGAActivityFilters = {
  sga: null,
  dateRangeType: 'qtd', // Default to QTD
  startDate: null,
  endDate: null,
  comparisonDateRangeType: 'last_30',
  comparisonStartDate: null,
  comparisonEndDate: null,
  // Period A/B defaults (only for Activity Distribution)
  periodAType: 'this_week',
  periodAStartDate: null,
  periodAEndDate: null,
  periodBType: 'last_30',
  periodBStartDate: null,
  periodBEndDate: null,
  distributionViewMode: 'average', // Default to average view
  activityTypes: [],
  includeAutomated: true, // Always include automated activities (emails, LinkedIn, SMS)
  callTypeFilter: 'all_outbound',
};

// Helper to convert UI day number to BigQuery DAYOFWEEK value
// UI DAY_ORDER is [1,2,3,4,5,6,0] displayed as [Mon,Tue,Wed,Thu,Fri,Sat,Sun]
// BigQuery DAYOFWEEK: 1=Sun, 2=Mon, 3=Tue, 4=Wed, 5=Thu, 6=Fri, 7=Sat
// Conversion: UI 0→BQ 1 (Sun), UI 1→BQ 2 (Mon), UI 2→BQ 3 (Tue), UI 3→BQ 4 (Wed), 
//             UI 4→BQ 5 (Thu), UI 5→BQ 6 (Fri), UI 6→BQ 7 (Sat)
function convertUIToBigQueryDayOfWeek(uiDayNum: number): number {
  if (uiDayNum === 0) return 1; // Sunday
  return uiDayNum + 1; // UI 1→BQ 2, UI 2→BQ 3, etc.
}

// Helper to get day name from UI day number
// DAY_ORDER is [1,2,3,4,5,6,0] displayed as [Mon,Tue,Wed,Thu,Fri,Sat,Sun]
function getDayName(dayOfWeek: number): string {
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  // DAY_ORDER mapping: 0->Sun, 1->Mon, 2->Tue, 3->Wed, 4->Thu, 5->Fri, 6->Sat
  if (dayOfWeek === 0) return 'Sun';
  if (dayOfWeek >= 1 && dayOfWeek <= 6) return dayNames[dayOfWeek];
  return '';
}

interface SGAActivityContentProps {
  embedded?: boolean; // When true, removes outer padding and adjusts title for embedding in SGA Hub
}

export default function SGAActivityContent({ embedded = false }: SGAActivityContentProps) {
  const { data: session } = useSession();
  const permissions = getSessionPermissions(session);
  const showSGAFilter = permissions ? ['admin', 'manager'].includes(permissions.role) : false;

  // State
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<SGAActivityFilters>(DEFAULT_FILTERS);
  const [data, setData] = useState<SGAActivityDashboardData | null>(null);
  const [sgaOptions, setSgaOptions] = useState<{ value: string; label: string; isActive: boolean }[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Drill-down state
  const [drillDownOpen, setDrillDownOpen] = useState(false);
  const [drillDownTitle, setDrillDownTitle] = useState('');
  const [drillDownRecords, setDrillDownRecords] = useState<(ActivityRecord | ScheduledCallRecord)[]>([]);
  const [drillDownLoading, setDrillDownLoading] = useState(false);
  const [drillDownRecordType, setDrillDownRecordType] = useState<'activity' | 'scheduled_call'>('activity');
  const [drillDownPage, setDrillDownPage] = useState(1);
  const [drillDownTotal, setDrillDownTotal] = useState(0);
  const [drillDownFilters, setDrillDownFilters] = useState<{
    activityType?: string;
    channel?: ActivityChannel;
    dayOfWeek?: number;
  }>({});
  const [drillDownExportFilters, setDrillDownExportFilters] = useState<SGAActivityFilters | null>(null);

  // Record detail modal state
  const [recordDetailOpen, setRecordDetailOpen] = useState(false);
  const [recordDetailId, setRecordDetailId] = useState<string | null>(null);

  // Fetch filter options
  useEffect(() => {
    const fetchFilterOptions = async () => {
      try {
        const response = await fetch('/api/sga-activity/filters');
        if (!response.ok) throw new Error('Failed to fetch filter options');
        const options = await response.json();
        setSgaOptions(options.sgas || []);
      } catch (err) {
        console.error('Failed to fetch filter options:', err);
      }
    };
    fetchFilterOptions();
  }, []);

  // Fetch dashboard data
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Send main filters - API will handle Period A/B for Activity Distribution separately
      const response = await fetch('/api/sga-activity/dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters }),
      });

      if (!response.ok) {
        throw new Error('Failed to fetch dashboard data');
      }

      const dashboardData = await response.json();
      setData(dashboardData);
    } catch (err: any) {
      console.error('Dashboard fetch error:', err);
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Drill-down handlers
  const handleScheduledCallClick = async (
    callType: 'initial' | 'qualification',
    weekType: 'this_week' | 'next_week',
    dayOfWeek?: number,
    sgaName?: string
  ) => {
    setDrillDownLoading(true);
    setDrillDownRecordType('scheduled_call');
    setDrillDownPage(1);
    setDrillDownFilters({});

    // Convert UI day number to BigQuery DAYOFWEEK value if provided
    // Note: dayOfWeek is already in UI format (0=Sun, 1=Mon, etc.)
    const bigQueryDayOfWeek = dayOfWeek !== undefined ? convertUIToBigQueryDayOfWeek(dayOfWeek) : undefined;

    const title = `${callType === 'initial' ? 'Initial' : 'Qualification'} Calls Scheduled - ${weekType === 'this_week' ? 'This Week' : 'Next Week'}${
      dayOfWeek !== undefined ? ` - ${getDayName(dayOfWeek)}` : ''
    }${sgaName ? ` - ${sgaName}` : ''}`;
    setDrillDownTitle(title);

    try {
      const response = await fetch('/api/sga-activity/scheduled-calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filters,
          callType,
          weekType,
          dayOfWeek: bigQueryDayOfWeek,
          sgaName,
        }),
      });

      if (!response.ok) throw new Error('Failed to fetch scheduled calls');
      const result = await response.json();
      setDrillDownRecords(result.records || []);
      setDrillDownTotal(result.total || 0);
      setDrillDownOpen(true);
    } catch (err: any) {
      console.error('Scheduled call drill-down error:', err);
      setError(err.message || 'Failed to load scheduled calls');
    } finally {
      setDrillDownLoading(false);
    }
  };

  // Handler for SGA total clicks - shows all records for that SGA across both weeks
  const handleSGATotalClick = async (
    callType: 'initial' | 'qualification',
    sgaName: string
  ) => {
    setDrillDownLoading(true);
    setDrillDownRecordType('scheduled_call');
    setDrillDownPage(1);
    setDrillDownFilters({});

    const title = `${callType === 'initial' ? 'Initial' : 'Qualification'} Calls Scheduled - ${sgaName} - All Weeks`;
    setDrillDownTitle(title);

    try {
      // Fetch records for both weeks and combine them
      // Note: filters.sga will be used if set, otherwise sgaName parameter will be used
      const [thisWeekResponse, nextWeekResponse] = await Promise.all([
        fetch('/api/sga-activity/scheduled-calls', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filters,
            callType,
            weekType: 'this_week',
            sgaName, // This will be used if filters.sga is not set
          }),
        }),
        fetch('/api/sga-activity/scheduled-calls', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filters,
            callType,
            weekType: 'next_week',
            sgaName, // This will be used if filters.sga is not set
          }),
        }),
      ]);

      if (!thisWeekResponse.ok || !nextWeekResponse.ok) {
        throw new Error('Failed to fetch scheduled calls');
      }

      const thisWeekResult = await thisWeekResponse.json();
      const nextWeekResult = await nextWeekResponse.json();

      // Combine records from both weeks
      const combinedRecords = [
        ...(thisWeekResult.records || []),
        ...(nextWeekResult.records || []),
      ];
      const combinedTotal = (thisWeekResult.total || 0) + (nextWeekResult.total || 0);

      setDrillDownRecords(combinedRecords);
      setDrillDownTotal(combinedTotal);
      setDrillDownOpen(true);
    } catch (err: any) {
      console.error('SGA total drill-down error:', err);
      setError(err.message || 'Failed to load scheduled calls');
    } finally {
      setDrillDownLoading(false);
    }
  };

  const handleActivityDrillDown = async (
    activityType: string | undefined,
    channel?: ActivityChannel,
    dayOfWeek?: number
  ) => {
    setDrillDownLoading(true);
    setDrillDownRecordType('activity');
    setDrillDownPage(1);
    setDrillDownFilters({ activityType, channel, dayOfWeek });
    setDrillDownExportFilters(filters); // Store filters for export

    const labels: Record<string, string> = {
      cold_calls: 'Cold Calls',
      outbound_calls: 'Outbound Calls',
      sms_outbound: 'Outbound SMS',
      sms_inbound: 'Inbound SMS',
      linkedin_messages: 'LinkedIn Messages',
      emails_manual: 'Emails',
    };

    const mapping: Record<string, ActivityChannel> = {
      cold_calls: 'Call',
      outbound_calls: 'Call',
      sms_outbound: 'SMS',
      sms_inbound: 'SMS',
      linkedin_messages: 'LinkedIn',
      emails_manual: 'Email',
    };

    const label = activityType && labels[activityType] ? labels[activityType] : (channel || 'Activity');
    const channelLabel = channel ? ` - ${channel}` : '';
    const dayLabel = dayOfWeek !== undefined ? ` - ${getDayName(dayOfWeek)}` : '';
    setDrillDownTitle(`${label}${channelLabel}${dayLabel}`);

    try {
      const response = await fetch('/api/sga-activity/activity-records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filters,
          ...(activityType ? { activityType } : {}),
          ...(channel ? { channel } : {}),
          ...(dayOfWeek !== undefined ? { dayOfWeek } : {}),
          page: 1,
          pageSize: 100,
        }),
      });

      if (!response.ok) throw new Error('Failed to fetch activity records');
      const result = await response.json();
      setDrillDownRecords(result.records || []);
      setDrillDownTotal(result.total || 0);
      setDrillDownOpen(true);
    } catch (err: any) {
      console.error('Activity drill-down error:', err);
      setError(err.message || 'Failed to load activity records');
    } finally {
      setDrillDownLoading(false);
    }
  };

  const handleActivityDistributionCellClick = async (channel: ActivityChannel | undefined, dayOfWeek: number, period: 'A' | 'B' = 'A') => {
    // Use Period A or Period B filters based on the period parameter
    const periodFilters: SGAActivityFilters = period === 'A' 
      ? {
          ...filters,
          dateRangeType: filters.periodAType || filters.dateRangeType,
          startDate: filters.periodAStartDate || filters.startDate,
          endDate: filters.periodAEndDate || filters.endDate,
        }
      : {
          ...filters,
          dateRangeType: filters.periodBType || filters.comparisonDateRangeType,
          startDate: filters.periodBStartDate || filters.comparisonStartDate,
          endDate: filters.periodBEndDate || filters.comparisonEndDate,
        };
    
    // Convert UI day number to BigQuery DAYOFWEEK value
    // UI DAY_ORDER [1,2,3,4,5,6,0] → BigQuery [2,3,4,5,6,7,1]
    const bigQueryDayOfWeek = convertUIToBigQueryDayOfWeek(dayOfWeek);
    
    setDrillDownLoading(true);
    setDrillDownRecordType('activity');
    setDrillDownPage(1);
    setDrillDownFilters({ channel, dayOfWeek: bigQueryDayOfWeek });
    setDrillDownExportFilters(periodFilters); // Store filters for export

    const labels: Record<string, string> = {
      cold_calls: 'Cold Calls',
      outbound_calls: 'Outbound Calls',
      sms_outbound: 'Outbound SMS',
      sms_inbound: 'Inbound SMS',
      linkedin_messages: 'LinkedIn Messages',
      emails_manual: 'Emails',
    };

    const channelLabel = channel || 'Activity';
    // Use the original UI day number (before conversion) for display
    const dayLabel = dayOfWeek !== undefined ? ` - ${getDayName(dayOfWeek)}` : '';
    
    // Build a more descriptive title that includes the period info
    const periodType = period === 'A' ? periodFilters.periodAType : periodFilters.periodBType;
    const periodLabel = periodType === 'this_week' 
      ? 'This Week' 
      : periodType === 'last_30'
      ? 'Last 30 Days'
      : periodType === 'last_60'
      ? 'Last 60 Days'
      : periodType === 'last_90'
      ? 'Last 90 Days'
      : periodType === 'qtd'
      ? 'Quarter to Date'
      : periodType === 'all_time'
      ? 'All Time'
      : periodType === 'custom' && periodFilters.startDate && periodFilters.endDate
      ? `${periodFilters.startDate} to ${periodFilters.endDate}`
      : period === 'A' ? 'Period A' : 'Period B';
    
    setDrillDownTitle(`${channelLabel}${dayLabel} (${periodLabel})`);

    try {
      const response = await fetch('/api/sga-activity/activity-records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filters: periodFilters,
          channel,
          dayOfWeek: bigQueryDayOfWeek,
          page: 1,
          pageSize: 100,
        }),
      });

      if (!response.ok) throw new Error('Failed to fetch activity records');
      const result = await response.json();
      setDrillDownRecords(result.records || []);
      setDrillDownTotal(result.total || 0);
      setDrillDownOpen(true);
    } catch (err: any) {
      console.error('Activity drill-down error:', err);
      setError(err.message || 'Failed to load activity records');
    } finally {
      setDrillDownLoading(false);
    }
  };

  const handleDrillDownPageChange = async (page: number) => {
    if (drillDownRecordType === 'activity') {
      setDrillDownPage(page);
      setDrillDownLoading(true);

      // Check if this is from Activity Distribution (has dayOfWeek filter)
      // If so, use Period A filters; otherwise use main filters
      const filtersToUse = drillDownFilters.dayOfWeek !== undefined
        ? {
            ...filters,
            dateRangeType: filters.periodAType || filters.dateRangeType,
            startDate: filters.periodAStartDate || filters.startDate,
            endDate: filters.periodAEndDate || filters.endDate,
          }
        : filters;

      try {
        const response = await fetch('/api/sga-activity/activity-records', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filters: filtersToUse,
            ...(drillDownFilters.activityType ? { activityType: drillDownFilters.activityType } : {}),
            ...(drillDownFilters.channel ? { channel: drillDownFilters.channel } : {}),
            ...(drillDownFilters.dayOfWeek !== undefined ? { dayOfWeek: drillDownFilters.dayOfWeek } : {}),
            page,
            pageSize: 100,
          }),
        });

        if (!response.ok) throw new Error('Failed to fetch activity records');
        const result = await response.json();
        setDrillDownRecords(result.records || []);
        setDrillDownTotal(result.total || 0);
      } catch (err: any) {
        console.error('Activity drill-down pagination error:', err);
        setError(err.message || 'Failed to load activity records');
      } finally {
        setDrillDownLoading(false);
      }
    }
  };

  const handleRecordClick = (recordId: string) => {
    if (!recordId) {
      console.warn('No record ID provided');
      return;
    }
    setRecordDetailId(recordId);
    setRecordDetailOpen(true);
  };

  const handleCloseRecordDetail = () => {
    setRecordDetailOpen(false);
    setRecordDetailId(null);
  };

  const handleBackToDrillDown = () => {
    setRecordDetailOpen(false);
    setRecordDetailId(null);
    setDrillDownOpen(true);
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="p-6">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-800 dark:text-red-200">Error: {error}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <div className={embedded ? "space-y-6" : "p-6 space-y-6"}>
      <div className="flex items-center justify-between">
        {!embedded && (
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">SGA Activity Dashboard</h1>
        )}
        <DataFreshnessIndicator />
      </div>

      <ActivityFilters
        filters={filters}
        onFiltersChange={setFilters}
        sgaOptions={sgaOptions}
        showSGAFilter={showSGAFilter}
      />

      {/* Activity Totals - Scorecards at the top */}
      <ActivityTotalsCards
        totals={data.totals}
        onCardClick={handleActivityDrillDown}
      />

      {/* Response Rates - Gauge Scorecards */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Response Rates</h2>
        <RateCards smsRate={data.smsResponseRate} callRate={data.callAnswerRate} />
      </div>

      {/* Scheduled Calls - Side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ScheduledCallsCards
          title="Initial Calls Scheduled"
          data={data.initialCalls}
          onCardClick={(weekType) => handleScheduledCallClick('initial', weekType)}
          onDayClick={(weekType, dayOfWeek, sgaName) => handleScheduledCallClick('initial', weekType, dayOfWeek, sgaName)}
          onSGAClick={(weekType, sgaName) => handleScheduledCallClick('initial', weekType, undefined, sgaName)}
          onWeekTotalClick={(weekType) => handleScheduledCallClick('initial', weekType)}
          onSGATotalClick={(sgaName) => handleSGATotalClick('initial', sgaName)}
        />

        <ScheduledCallsCards
          title="Qualification Calls Scheduled"
          data={data.qualificationCalls}
          onCardClick={(weekType) => handleScheduledCallClick('qualification', weekType)}
          onDayClick={(weekType, dayOfWeek, sgaName) => handleScheduledCallClick('qualification', weekType, dayOfWeek, sgaName)}
          onSGAClick={(weekType, sgaName) => handleScheduledCallClick('qualification', weekType, undefined, sgaName)}
          onWeekTotalClick={(weekType) => handleScheduledCallClick('qualification', weekType)}
          onSGATotalClick={(sgaName) => handleSGATotalClick('qualification', sgaName)}
        />
      </div>


      {/* Activity Distribution - with Period A/B filters */}
      <ActivityDistributionTable
        distributions={data.activityDistribution}
        onCellClick={handleActivityDistributionCellClick}
        filters={filters}
        onFiltersChange={setFilters}
      />

      {/* Drill-down Modal */}
      <ActivityDrillDownModal
        isOpen={drillDownOpen && !recordDetailOpen}
        onClose={() => {
        setDrillDownOpen(false);
        setDrillDownFilters({});
        setDrillDownExportFilters(null);
      }}
      title={drillDownTitle}
      records={drillDownRecords}
      loading={drillDownLoading}
      onRecordClick={handleRecordClick}
      recordType={drillDownRecordType}
      total={drillDownTotal}
      page={drillDownPage}
      pageSize={100}
      onPageChange={handleDrillDownPageChange}
      exportFilters={drillDownExportFilters}
      exportChannel={drillDownFilters.channel}
      exportDayOfWeek={drillDownFilters.dayOfWeek}
      exportActivityType={drillDownFilters.activityType}
    />

      {/* Record Detail Modal */}
      <RecordDetailModal
        isOpen={recordDetailOpen}
        onClose={handleCloseRecordDetail}
        recordId={recordDetailId}
        showBackButton={drillDownOpen}
        onBack={handleBackToDrillDown}
        backButtonLabel="← Back to records"
      />
    </div>
  );
}
