'use client';

import { useState, useEffect, useMemo } from 'react';
import { Title, Text, Card, Button } from '@tremor/react';
import { useSession } from 'next-auth/react';
import { SGAHubTabs, SGAHubTab } from '@/components/sga-hub/SGAHubTabs';
import { WeeklyGoalsTable } from '@/components/sga-hub/WeeklyGoalsTable';
import { WeeklyGoalEditor } from '@/components/sga-hub/WeeklyGoalEditor';
import { WeeklyGoalsVsActuals } from '@/components/sga-hub/WeeklyGoalsVsActuals';
import { AdminGoalsRollupView } from '@/components/sga-hub/AdminGoalsRollupView';
import { ClosedLostFollowUpTabs } from '@/components/sga-hub/ClosedLostFollowUpTabs';
import { QuarterlyProgressCard } from '@/components/sga-hub/QuarterlyProgressCard';
import { SQODetailTable } from '@/components/sga-hub/SQODetailTable';
import { QuarterlyProgressChart } from '@/components/sga-hub/QuarterlyProgressChart';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { LeaderboardTable } from '@/components/sga-hub/LeaderboardTable';
import { LeaderboardFilters } from '@/components/sga-hub/LeaderboardFilters';
import { AdminQuarterlyProgressView } from '@/components/sga-hub/AdminQuarterlyProgressView';
import { dashboardApi, handleApiError } from '@/lib/api-client';
import { FilterOptions } from '@/types/filters';
import { WeeklyGoal, WeeklyActual, WeeklyGoalWithActuals, QuarterlyProgress, SQODetail, LeaderboardEntry } from '@/types/sga-hub';
import { getDefaultWeekRange, getWeekMondayDate, getWeekInfo, formatDateISO, getCurrentQuarter, getQuarterFromDate, getQuarterInfo, getWeekSundayDate } from '@/lib/utils/sga-hub-helpers';
import { getSessionPermissions } from '@/types/auth';
import { exportWeeklyGoalsCSV, exportQuarterlyProgressCSV } from '@/lib/utils/sga-hub-csv-export';
import { Download } from 'lucide-react';
import { MetricDrillDownModal } from '@/components/sga-hub/MetricDrillDownModal';
import { RecordDetailModal } from '@/components/dashboard/RecordDetailModal';
import SGAActivityContent from '@/app/dashboard/sga-activity/SGAActivityContent';
import OutreachEffectivenessContent from '@/app/dashboard/outreach-effectiveness/OutreachEffectivenessContent';
import {
  MetricType,
  DrillDownRecord,
  DrillDownContext
} from '@/types/drill-down';
import { formatDate } from '@/lib/utils/format-helpers';

export function SGAHubContent() {
  const { data: session } = useSession();
  const permissions = getSessionPermissions(session);
  const isAdmin = permissions?.role === 'admin' || permissions?.role === 'manager' || permissions?.role === 'revops_admin';
  const sgaName = session?.user?.name || 'Unknown';
  
  const [activeTab, setActiveTab] = useState<SGAHubTab>('leaderboard');
  const [dateRange, setDateRange] = useState(getDefaultWeekRange());
  
  // Weekly Goals state
  const [weeklyGoals, setWeeklyGoals] = useState<WeeklyGoal[]>([]);
  const [weeklyActuals, setWeeklyActuals] = useState<WeeklyActual[]>([]);
  const [goalsWithActuals, setGoalsWithActuals] = useState<WeeklyGoalWithActuals[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Modal state
  const [showGoalEditor, setShowGoalEditor] = useState(false);
  const [editingGoal, setEditingGoal] = useState<WeeklyGoalWithActuals | null>(null);
  
  // Closed Lost state
  
  // Re-Engagement state
  
  // Quarterly Progress state
  const [selectedQuarter, setSelectedQuarter] = useState<string>(getCurrentQuarter());
  const [quarterlyProgress, setQuarterlyProgress] = useState<QuarterlyProgress | null>(null);
  const [sqoDetails, setSqoDetails] = useState<SQODetail[]>([]);
  const [historicalProgress, setHistoricalProgress] = useState<QuarterlyProgress[]>([]);
  const [quarterlyLoading, setQuarterlyLoading] = useState(false);
  const [quarterlyError, setQuarterlyError] = useState<string | null>(null);

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

  // Leaderboard state
  const [leaderboardEntries, setLeaderboardEntries] = useState<LeaderboardEntry[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);

  // Leaderboard filters (applied filters)
  const [leaderboardQuarter, setLeaderboardQuarter] = useState<string>(getCurrentQuarter());
  const [leaderboardChannels, setLeaderboardChannels] = useState<string[]>(['Outbound', 'Outbound + Marketing', 'Re-Engagement']);
  const [leaderboardSources, setLeaderboardSources] = useState<string[]>([]); // Empty array = all sources (default)
  const [leaderboardSGAs, setLeaderboardSGAs] = useState<string[]>([]); // Empty array = all active SGAs (default)

  // Admin Goals vs. Actuals state
  const [allSGAGoals, setAllSGAGoals] = useState<WeeklyGoal[]>([]);
  const [allSGAActuals, setAllSGAActuals] = useState<WeeklyActual[]>([]);
  const [sgaList, setSgaList] = useState<Array<{ email: string; name: string }>>([]);
  const [sgaUsersFromGoals, setSgaUsersFromGoals] = useState<Array<{ email: string; name: string }>>([]);

  // Filter options (for channel/source/SGA dropdowns)
  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);
  const [sgaOptions, setSgaOptions] = useState<Array<{ value: string; label: string; isActive: boolean }>>([]);
  const [sgaOptionsLoading, setSgaOptionsLoading] = useState(false);
  
  // Fetch weekly goals and actuals
  const fetchWeeklyData = async () => {
    try {
      setLoading(true);
      setError(null);

      if (isAdmin) {
        // Admin: fetch all SGAs' data for rollup view
        const [goalsResponse, actualsResponse] = await Promise.all([
          dashboardApi.getAllSGAWeeklyGoals(dateRange.startDate, dateRange.endDate),
          dashboardApi.getAllSGAWeeklyActuals(dateRange.startDate, dateRange.endDate),
        ]);

        setAllSGAGoals(goalsResponse.goals);

        // Flatten all SGA actuals into a single array (tag each with sgaName)
        const flatActuals: (WeeklyActual & { sgaName: string })[] = [];
        for (const sgaGroup of actualsResponse.actuals) {
          for (const actual of sgaGroup.actuals) {
            flatActuals.push({ ...actual, sgaName: sgaGroup.sgaName });
          }
        }
        setAllSGAActuals(flatActuals as unknown as WeeklyActual[]);

        // Store sgaUsers for email lookup (used by SGA list effect below)
        setSgaUsersFromGoals((goalsResponse as any).sgaUsers || []);

        // Also set individual data for own user
        setWeeklyGoals(goalsResponse.goals.filter(g => g.userEmail === session?.user?.email));
        const ownActuals = actualsResponse.actuals.find(s => s.sgaName === sgaName);
        setWeeklyActuals(ownActuals?.actuals || []);
      } else {
        // SGA: fetch own data only
        const [goalsResponse, actualsResponse] = await Promise.all([
          dashboardApi.getWeeklyGoals(dateRange.startDate, dateRange.endDate),
          dashboardApi.getWeeklyActuals(dateRange.startDate, dateRange.endDate),
        ]);

        setWeeklyGoals(goalsResponse.goals);
        setWeeklyActuals(actualsResponse.actuals);
      }
    } catch (err) {
      setError(handleApiError(err));
    } finally {
      setLoading(false);
    }
  };
  
  
  // Fetch quarterly progress data
  const fetchQuarterlyProgress = async () => {
    try {
      setQuarterlyLoading(true);
      setQuarterlyError(null);
      
      // Fetch current quarter progress
      const progress = await dashboardApi.getQuarterlyProgress(selectedQuarter);
      setQuarterlyProgress(progress);
      
      // Fetch SQO details for selected quarter
      const detailsResponse = await dashboardApi.getSQODetails(selectedQuarter);
      setSqoDetails(detailsResponse.sqos);
      
      // Fetch historical data for chart (last 8 quarters)
      const currentQuarterInfo = getQuarterInfo(selectedQuarter);
      const quarters: string[] = [];
      let year = currentQuarterInfo.year;
      let quarterNum: 1 | 2 | 3 | 4 = currentQuarterInfo.quarterNumber;
      
      for (let i = 0; i < 8; i++) {
        quarters.push(`${year}-Q${quarterNum}`);
        if (quarterNum === 1) {
          quarterNum = 4;
          year--;
        } else {
          quarterNum = (quarterNum - 1) as 1 | 2 | 3 | 4;
        }
      }
      
      // Fetch progress for all historical quarters
      const historicalData = await Promise.all(
        quarters.map(q => dashboardApi.getQuarterlyProgress(q))
      );
      // Sort from oldest to newest (left to right on chart)
      const sortedHistorical = historicalData.sort((a, b) => 
        a.quarter.localeCompare(b.quarter)
      );
      setHistoricalProgress(sortedHistorical);
    } catch (err) {
      setQuarterlyError(handleApiError(err));
    } finally {
      setQuarterlyLoading(false);
    }
  };
  
  // Fetch filter options on mount
  useEffect(() => {
    const fetchFilterOptions = async () => {
      try {
        const options = await dashboardApi.getFilterOptions();
        setFilterOptions(options);
        // Set default sources to all sources
        if (options && options.sources) {
          setLeaderboardSources([...options.sources]);
        }
      } catch (err) {
        console.error('Error fetching filter options:', err);
      }
    };
    
    fetchFilterOptions();
  }, []);

  // Fetch SGA options for leaderboard filter
  useEffect(() => {
    const fetchSGAOptions = async () => {
      try {
        setSgaOptionsLoading(true);
        const response = await dashboardApi.getLeaderboardSGAOptions();
        setSgaOptions(response.sgaOptions);
        // Set default SGAs to all active SGAs
        const activeSGAs = response.sgaOptions.filter(s => s.isActive).map(s => s.value);
        setLeaderboardSGAs(activeSGAs);
      } catch (err) {
        console.error('Error fetching SGA options:', err);
      } finally {
        setSgaOptionsLoading(false);
      }
    };
    
    fetchSGAOptions();
  }, []);

  // Build admin SGA list when sgaOptions or sgaUsersFromGoals change
  useEffect(() => {
    if (!isAdmin) return;
    if (sgaOptions.length === 0) return;
    const emailByName = new Map(sgaUsersFromGoals.map(su => [su.name, su.email]));
    const activeSGAs = sgaOptions
      .filter(s => s.isActive)
      .map(s => ({ email: emailByName.get(s.value) || '', name: s.value }))
      .sort((a, b) => a.name.localeCompare(b.name));
    setSgaList(activeSGAs);
  }, [isAdmin, sgaOptions, sgaUsersFromGoals]);

  // Fetch leaderboard data
  const fetchLeaderboard = async () => {
    try {
      setLeaderboardLoading(true);
      setLeaderboardError(null);
      
      // Convert quarter to date range
      const quarterInfo = getQuarterInfo(leaderboardQuarter);
      
      // Call API
      const response = await dashboardApi.getSGALeaderboard({
        startDate: quarterInfo.startDate,
        endDate: quarterInfo.endDate,
        channels: leaderboardChannels,
        sources: leaderboardSources.length > 0 ? leaderboardSources : undefined,
        sgaNames: leaderboardSGAs.length > 0 ? leaderboardSGAs : undefined,
      });
      
      setLeaderboardEntries(response.entries);
    } catch (err) {
      setLeaderboardError(handleApiError(err));
    } finally {
      setLeaderboardLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'weekly-goals') {
      fetchWeeklyData();
    } else if (activeTab === 'quarterly-progress') {
      fetchQuarterlyProgress();
    } else if (activeTab === 'leaderboard') {
      fetchLeaderboard();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange.startDate, dateRange.endDate, activeTab, selectedQuarter, 
      leaderboardQuarter, leaderboardChannels, leaderboardSources, leaderboardSGAs]);
  
  // Combine goals and actuals
  useEffect(() => {
    if (activeTab !== 'weekly-goals') return;
    
    // Generate all weeks in range
    const startDate = new Date(dateRange.startDate);
    const endDate = new Date(dateRange.endDate);
    const weeks: WeeklyGoalWithActuals[] = [];
    
    let currentDate = getWeekMondayDate(startDate);
    const endMonday = getWeekMondayDate(endDate);
    
    while (currentDate <= endMonday) {
      const weekStartDate = formatDateISO(currentDate);
      const weekInfo = getWeekInfo(weekStartDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      // Parse dates as local dates to avoid timezone issues
      const [year, month, day] = weekStartDate.split('-').map(Number);
      const weekStart = new Date(year, month - 1, day);
      weekStart.setHours(0, 0, 0, 0);
      
      const [endYear, endMonth, endDay] = weekInfo.weekEndDate.split('-').map(Number);
      const weekEnd = new Date(endYear, endMonth - 1, endDay);
      weekEnd.setHours(23, 59, 59, 999);
      
      // Determine if this is current or future week
      const isCurrentWeek = today.getTime() >= weekStart.getTime() && today.getTime() <= weekEnd.getTime();
      const isFutureWeek = today.getTime() < weekStart.getTime();
      
      // Find goal for this week
      const goal = weeklyGoals.find(g => g.weekStartDate === weekStartDate);
      
      // Find actuals for this week
      const actual = weeklyActuals.find(a => a.weekStartDate === weekStartDate) || {
        weekStartDate,
        initialCalls: 0,
        qualificationCalls: 0,
        sqos: 0,
        mqls: 0,
        sqls: 0,
        leadsSourced: 0,
        leadsSourcedSelfSourced: 0,
        leadsContacted: 0,
        leadsContactedSelfSourced: 0,
      };

      weeks.push({
        weekStartDate,
        weekEndDate: weekInfo.weekEndDate,
        weekLabel: weekInfo.label,
        initialCallsGoal: goal?.initialCallsGoal ?? null,
        qualificationCallsGoal: goal?.qualificationCallsGoal ?? null,
        sqoGoal: goal?.sqoGoal ?? null,
        mqlGoal: goal?.mqlGoal ?? null,
        sqlGoal: goal?.sqlGoal ?? null,
        leadsSourcedGoal: goal?.leadsSourcedGoal ?? null,
        leadsContactedGoal: goal?.leadsContactedGoal ?? null,
        initialCallsActual: actual.initialCalls,
        qualificationCallsActual: actual.qualificationCalls,
        sqoActual: actual.sqos,
        mqlActual: actual.mqls,
        sqlActual: actual.sqls,
        leadsSourcedActual: actual.leadsSourced,
        leadsSourcedSelfSourcedActual: actual.leadsSourcedSelfSourced,
        leadsContactedActual: actual.leadsContacted,
        leadsContactedSelfSourcedActual: actual.leadsContactedSelfSourced,
        initialCallsDiff: goal ? actual.initialCalls - goal.initialCallsGoal : null,
        qualificationCallsDiff: goal ? actual.qualificationCalls - goal.qualificationCallsGoal : null,
        sqoDiff: goal ? actual.sqos - goal.sqoGoal : null,
        mqlDiff: goal ? actual.mqls - goal.mqlGoal : null,
        sqlDiff: goal ? actual.sqls - goal.sqlGoal : null,
        leadsSourcedDiff: goal ? actual.leadsSourced - goal.leadsSourcedGoal : null,
        leadsContactedDiff: goal ? actual.leadsContacted - goal.leadsContactedGoal : null,
        hasGoal: !!goal,
        canEdit: isAdmin || isCurrentWeek || isFutureWeek,
      });
      
      // Move to next week
      currentDate = new Date(currentDate);
      currentDate.setDate(currentDate.getDate() + 7);
    }
    
    // Sort by week (newest first)
    weeks.sort((a, b) => new Date(b.weekStartDate).getTime() - new Date(a.weekStartDate).getTime());
    
    setGoalsWithActuals(weeks);
  }, [weeklyGoals, weeklyActuals, dateRange.startDate, dateRange.endDate, isAdmin]);
  
  const handleEditGoal = (goal: WeeklyGoalWithActuals) => {
    setEditingGoal(goal);
    setShowGoalEditor(true);
  };
  
  const handleGoalSaved = () => {
    setShowGoalEditor(false);
    setEditingGoal(null);
    fetchWeeklyData();
  };

  // Helper to calculate week end date (Sunday) from start date (Monday)
  const getWeekEndDate = (startDate: string): string => {
    return formatDateISO(getWeekSundayDate(startDate));
  };

  // Handle metric click from Weekly Goals / Goals vs. Actuals
  const handleWeeklyMetricClick = async (weekStartDate: string, metricType: MetricType, options?: { selfSourcedOnly?: boolean; sgaName?: string; userEmail?: string; teamLevel?: boolean }) => {
    const targetSGA = options?.sgaName || sgaName;
    const targetEmail = options?.userEmail;
    const teamLevel = options?.teamLevel || false;
    if (!teamLevel && (!targetSGA || targetSGA === 'Unknown')) return;

    setDrillDownLoading(true);
    setDrillDownError(null);
    setDrillDownMetricType(metricType);
    setDrillDownOpen(true);

    const weekEndDate = getWeekEndDate(weekStartDate);

    const metricLabels: Record<MetricType, string> = {
      'initial-calls': 'Initial Calls',
      'qualification-calls': 'Qualification Calls',
      'sqos': 'SQOs',
      'open-sqls': 'Open SQLs',
      'mqls': 'MQLs',
      'sqls': 'SQLs',
      'leads-sourced': 'Leads Sourced',
      'leads-contacted': 'Leads Contacted',
      'joined': 'Joined',
    };

    const title = `${metricLabels[metricType]} - Week of ${formatDate(weekStartDate)}`;
    setDrillDownTitle(title);

    setDrillDownContext({
      metricType,
      title,
      sgaName: targetSGA,
      weekStartDate,
      weekEndDate,
    });

    try {
      let records: DrillDownRecord[] = [];

      switch (metricType) {
        case 'initial-calls': {
          const response = await dashboardApi.getInitialCallsDrillDown(targetSGA, weekStartDate, weekEndDate, targetEmail, teamLevel);
          records = response.records;
          break;
        }
        case 'qualification-calls': {
          const response = await dashboardApi.getQualificationCallsDrillDown(targetSGA, weekStartDate, weekEndDate, targetEmail, teamLevel);
          records = response.records;
          break;
        }
        case 'sqos': {
          const response = await dashboardApi.getSQODrillDown(targetSGA, { weekStartDate, weekEndDate }, targetEmail, undefined, undefined, teamLevel);
          records = response.records;
          break;
        }
        case 'mqls': {
          const response = await dashboardApi.getMQLDrillDown(targetSGA, weekStartDate, weekEndDate, targetEmail, teamLevel);
          records = response.records;
          break;
        }
        case 'sqls': {
          const response = await dashboardApi.getSQLDrillDown(targetSGA, weekStartDate, weekEndDate, targetEmail, teamLevel);
          records = response.records;
          break;
        }
        case 'leads-sourced': {
          const response = await dashboardApi.getLeadsSourcedDrillDown(
            targetSGA, weekStartDate, weekEndDate, options?.selfSourcedOnly, targetEmail, teamLevel
          );
          records = response.records;
          break;
        }
        case 'leads-contacted': {
          const response = await dashboardApi.getLeadsContactedDrillDown(
            targetSGA, weekStartDate, weekEndDate, options?.selfSourcedOnly, targetEmail, teamLevel
          );
          records = response.records;
          break;
        }
      }

      setDrillDownRecords(records);
    } catch (error) {
      console.error('Error fetching drill-down records:', error);
      setDrillDownError('Failed to load records. Please try again.');
    } finally {
      setDrillDownLoading(false);
    }
  };

  // Handle SQO click from Quarterly Progress Card
  const handleQuarterlySQOClick = async () => {
    if (!sgaName || sgaName === 'Unknown') return;

    setDrillDownLoading(true);
    setDrillDownError(null);
    setDrillDownMetricType('sqos');
    setDrillDownOpen(true);

    const title = `SQOs - ${selectedQuarter}`;
    setDrillDownTitle(title);

    setDrillDownContext({
      metricType: 'sqos',
      title,
      sgaName: sgaName,
      quarter: selectedQuarter,
    });

    try {
      // For SGA Hub, users are viewing their own data, so don't pass userEmail
      const response = await dashboardApi.getSQODrillDown(sgaName, { quarter: selectedQuarter });
      setDrillDownRecords(response.records);
    } catch (error) {
      console.error('Error fetching SQO drill-down:', error);
      setDrillDownError('Failed to load SQO records. Please try again.');
    } finally {
      setDrillDownLoading(false);
    }
  };

  // Handle SQO click from Leaderboard Table
  const handleLeaderboardSQOClick = async (sgaName: string) => {
    setDrillDownLoading(true);
    setDrillDownError(null);
    setDrillDownMetricType('sqos');
    setDrillDownOpen(true);
    
    const quarterInfo = getQuarterInfo(leaderboardQuarter);
    const title = `${sgaName} - SQOs - ${leaderboardQuarter}`;
    setDrillDownTitle(title);
    
    setDrillDownContext({
      metricType: 'sqos',
      title,
      sgaName: sgaName,
      quarter: leaderboardQuarter,
    });
    
    try {
      // Call drill-down API with channels/sources filters
      // Note: If leaderboardSources is empty array, it means "all sources" - don't pass filter
      // If leaderboardSources has values, pass them to filter
      const response = await dashboardApi.getSQODrillDown(
        sgaName, 
        { quarter: leaderboardQuarter },
        undefined, // userEmail
        leaderboardChannels.length > 0 ? leaderboardChannels : undefined,
        leaderboardSources.length > 0 ? leaderboardSources : undefined
      );
      console.log('Drill-down response:', {
        sgaName,
        quarter: leaderboardQuarter,
        channels: leaderboardChannels,
        sources: leaderboardSources,
        recordCount: response.records.length,
      });
      setDrillDownRecords(response.records);
    } catch (error) {
      console.error('Error fetching SQO drill-down:', error);
      setDrillDownError('Failed to load SQO records. Please try again.');
    } finally {
      setDrillDownLoading(false);
    }
  };

  const handleAdminQuarterlySQOClick = async (
    sgaName: string,
    filters: { year: number; quarter: number; channels: string[]; sources: string[] }
  ) => {
    setDrillDownLoading(true);
    setDrillDownError(null);
    setDrillDownMetricType('sqos');
    setDrillDownOpen(true);
    
    const title = `${sgaName} - SQOs - ${filters.year}-Q${filters.quarter}`;
    setDrillDownTitle(title);
    
    setDrillDownContext({
      metricType: 'sqos',
      title,
      sgaName: sgaName,
      quarter: `${filters.year}-Q${filters.quarter}`,
    });
    
    try {
      const response = await dashboardApi.getSQODrillDown(
        sgaName,
        { quarter: `${filters.year}-Q${filters.quarter}` },
        undefined, // userEmail
        filters.channels.length > 0 ? filters.channels : undefined,
        filters.sources.length > 0 ? filters.sources : undefined
      );
      setDrillDownRecords(response.records);
    } catch (error) {
      console.error('Error fetching SQO drill-down:', error);
      setDrillDownError('Failed to load SQO records. Please try again.');
    } finally {
      setDrillDownLoading(false);
    }
  };

  const handleAdminQuarterlyOpenSqlClick = async (
    sgaName: string,
    filters: { year: number; quarter: number; channels: string[]; sources: string[] }
  ) => {
    setDrillDownLoading(true);
    setDrillDownError(null);
    setDrillDownMetricType('open-sqls');
    setDrillDownOpen(true);

    const title = `${sgaName} - Open SQLs - ${filters.year}-Q${filters.quarter}`;
    setDrillDownTitle(title);

    setDrillDownContext({
      metricType: 'open-sqls',
      title,
      sgaName: sgaName,
      quarter: `${filters.year}-Q${filters.quarter}`,
    });

    try {
      const response = await dashboardApi.getOpenSQLDrillDown(
        sgaName,
        `${filters.year}-Q${filters.quarter}`,
        filters.channels.length > 0 ? filters.channels : undefined,
        filters.sources.length > 0 ? filters.sources : undefined
      );
      setDrillDownRecords(response.records);
    } catch (error) {
      console.error('Error fetching Open SQL drill-down:', error);
      setDrillDownError('Failed to load Open SQL records. Please try again.');
    } finally {
      setDrillDownLoading(false);
    }
  };

  const handleAdminTeamSQOClick = async (
    filters: { year: number; quarter: number; channels: string[]; sources: string[] }
  ) => {
    setDrillDownLoading(true);
    setDrillDownError(null);
    setDrillDownMetricType('sqos');
    setDrillDownOpen(true);
    
    const title = `Team SQOs - ${filters.year}-Q${filters.quarter}`;
    setDrillDownTitle(title);
    
    setDrillDownContext({
      metricType: 'sqos',
      title,
      sgaName: null, // Team-level, no specific SGA
      quarter: `${filters.year}-Q${filters.quarter}`,
    });
    
    try {
      const response = await dashboardApi.getSQODrillDown(
        null, // null for team-level
        { quarter: `${filters.year}-Q${filters.quarter}` },
        undefined, // userEmail
        filters.channels.length > 0 ? filters.channels : undefined,
        filters.sources.length > 0 ? filters.sources : undefined,
        true // teamLevel flag
      );
      setDrillDownRecords(response.records);
    } catch (error) {
      console.error('Error fetching team SQO drill-down:', error);
      setDrillDownError('Failed to load SQO records. Please try again.');
    } finally {
      setDrillDownLoading(false);
    }
  };

  // Handle row click in drill-down modal
  const handleRecordClick = (primaryKey: string) => {
    setDrillDownOpen(false);
    setRecordDetailId(primaryKey);
    setRecordDetailOpen(true);
  };

  // Handle back button
  const handleBackToDrillDown = () => {
    setRecordDetailOpen(false);
    setRecordDetailId(null);
    setDrillDownOpen(true);
  };

  // Handle close drill-down
  const handleCloseDrillDown = () => {
    setDrillDownOpen(false);
    setDrillDownRecords([]);
    setDrillDownContext(null);
  };

  // Handle close record detail
  const handleCloseRecordDetail = () => {
    setRecordDetailOpen(false);
    setRecordDetailId(null);
    setDrillDownContext(null);
  };

  // Handle SQO Detail row click
  const handleSQODetailClick = (sqo: SQODetail) => {
    // SQODetail.id is already the primary_key from the query
    setRecordDetailId(sqo.id);
    setRecordDetailOpen(true);
    // Don't set drillDownContext - no back button for SQO details table
  };
  
  return (
    <div>
      <div className="mb-6">
        <Title>SGA Hub</Title>
        <Text>Track your weekly goals, closed lost follow-ups, and quarterly progress</Text>
      </div>
      
      <SGAHubTabs activeTab={activeTab} onTabChange={setActiveTab} />
      
      {activeTab === 'leaderboard' && (
        <>
          {/* Leaderboard Filters Component */}
          {filterOptions && (
            <LeaderboardFilters
              selectedQuarter={leaderboardQuarter}
              selectedChannels={leaderboardChannels}
              selectedSources={leaderboardSources}
              selectedSGAs={leaderboardSGAs}
              channelOptions={filterOptions.channels}
              sourceOptions={filterOptions.sources}
              sgaOptions={sgaOptions}
              sgaOptionsLoading={sgaOptionsLoading}
              onApply={(filters) => {
                setLeaderboardQuarter(filters.quarter);
                setLeaderboardChannels(filters.channels);
                setLeaderboardSources(filters.sources);
                setLeaderboardSGAs(filters.sgas);
                // fetchLeaderboard will be called automatically via useEffect dependency
              }}
              disabled={leaderboardLoading}
            />
          )}
          
          {/* Error Display */}
          {leaderboardError && (
            <Card className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <Text className="text-red-600 dark:text-red-400">{leaderboardError}</Text>
            </Card>
          )}
          
          {/* Leaderboard Table */}
          <LeaderboardTable
            entries={leaderboardEntries}
            isLoading={leaderboardLoading}
            onSQOClick={handleLeaderboardSQOClick}
            currentUserSgaName={sgaName}
          />
        </>
      )}
      
      {activeTab === 'weekly-goals' && (
        <>
          {error && (
            <Card className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <Text className="text-red-600 dark:text-red-400">{error}</Text>
            </Card>
          )}

          {loading ? (
            <LoadingSpinner />
          ) : isAdmin ? (
            <AdminGoalsRollupView
              allSGAGoals={allSGAGoals}
              allSGAActuals={allSGAActuals}
              sgaList={sgaList}
              onGoalSaved={() => fetchWeeklyData()}
              onMetricClick={handleWeeklyMetricClick}
            />
          ) : (
            <WeeklyGoalsVsActuals
              weeklyGoals={weeklyGoals}
              weeklyActuals={weeklyActuals}
              isAdmin={false}
              sgaName={sgaName}
              userEmail={session?.user?.email || ''}
              onGoalSaved={() => fetchWeeklyData()}
              onMetricClick={handleWeeklyMetricClick}
            />
          )}
        </>
      )}
      
      {activeTab === 'closed-lost' && (
        <ClosedLostFollowUpTabs />
      )}
      
      {activeTab === 'quarterly-progress' && (
        isAdmin ? (
          // Admin view: Show AdminQuarterlyProgressView
          <AdminQuarterlyProgressView
            onSQOClick={handleAdminQuarterlySQOClick}
            onTeamSQOClick={handleAdminTeamSQOClick}
            onOpenSqlClick={handleAdminQuarterlyOpenSqlClick}
          />
        ) : (
          // SGA view: Show existing quarterly progress (UNCHANGED)
          <>
            <div className="mb-4 flex items-end justify-between gap-4">
              <div className="w-fit">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  Quarter
                </label>
                <select
                  value={selectedQuarter}
                  onChange={(e) => setSelectedQuarter(e.target.value)}
                  className="min-w-[140px] px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
                >
                  {(() => {
                    const quarters: string[] = [];
                    const currentQuarterInfo = getQuarterInfo(getCurrentQuarter());
                    let year = currentQuarterInfo.year;
                    let quarterNum: 1 | 2 | 3 | 4 = currentQuarterInfo.quarterNumber;
                    
                    // Generate last 8 quarters
                    for (let i = 0; i < 8; i++) {
                      const quarter = `${year}-Q${quarterNum}`;
                      const info = getQuarterInfo(quarter);
                      quarters.push(quarter);
                      if (quarterNum === 1) {
                        quarterNum = 4;
                        year--;
                      } else {
                        quarterNum = (quarterNum - 1) as 1 | 2 | 3 | 4;
                      }
                    }
                    
                    return quarters.map(q => {
                      const info = getQuarterInfo(q);
                      return (
                        <option key={q} value={q}>
                          {info.label}
                        </option>
                      );
                    });
                  })()}
                </select>
              </div>
              <Button
                size="sm"
                variant="secondary"
                icon={Download}
                onClick={() => {
                  const allProgress = historicalProgress.length > 0 
                    ? historicalProgress 
                    : (quarterlyProgress ? [quarterlyProgress] : []);
                  exportQuarterlyProgressCSV(allProgress, sgaName);
                }}
                disabled={!quarterlyProgress && historicalProgress.length === 0}
              >
                Export CSV
              </Button>
            </div>
            
            {quarterlyError && (
              <Card className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                <Text className="text-red-600 dark:text-red-400">{quarterlyError}</Text>
              </Card>
            )}
            
            {quarterlyProgress && (
              <QuarterlyProgressCard
                progress={quarterlyProgress}
                onSQOClick={handleQuarterlySQOClick}
              />
            )}
            
            <QuarterlyProgressChart
              progressData={historicalProgress}
              isLoading={quarterlyLoading}
            />
            
            <SQODetailTable
              sqos={sqoDetails}
              isLoading={quarterlyLoading}
              onRecordClick={handleSQODetailClick}
            />
          </>
        )
      )}

      {activeTab === 'activity' && (
        <SGAActivityContent embedded />
      )}

      {activeTab === 'outreach-effectiveness' && (
        <OutreachEffectivenessContent embedded />
      )}

      <WeeklyGoalEditor
        isOpen={showGoalEditor}
        onClose={() => {
          setShowGoalEditor(false);
          setEditingGoal(null);
        }}
        onSaved={handleGoalSaved}
        goal={editingGoal}
      />

      {/* Drill-Down Modal */}
      <MetricDrillDownModal
        isOpen={drillDownOpen}
        onClose={handleCloseDrillDown}
        metricType={drillDownMetricType || 'initial-calls'}
        records={drillDownRecords}
        title={drillDownTitle}
        loading={drillDownLoading}
        error={drillDownError}
        onRecordClick={handleRecordClick}
        canExport={true}
      />

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
