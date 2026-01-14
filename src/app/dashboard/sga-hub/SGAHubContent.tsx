'use client';

import { useState, useEffect, useMemo } from 'react';
import { Title, Text, Card, Button } from '@tremor/react';
import { useSession } from 'next-auth/react';
import { SGAHubTabs, SGAHubTab } from '@/components/sga-hub/SGAHubTabs';
import { WeeklyGoalsTable } from '@/components/sga-hub/WeeklyGoalsTable';
import { WeeklyGoalEditor } from '@/components/sga-hub/WeeklyGoalEditor';
import { ClosedLostTable } from '@/components/sga-hub/ClosedLostTable';
import { QuarterlyProgressCard } from '@/components/sga-hub/QuarterlyProgressCard';
import { SQODetailTable } from '@/components/sga-hub/SQODetailTable';
import { QuarterlyProgressChart } from '@/components/sga-hub/QuarterlyProgressChart';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { dashboardApi, handleApiError } from '@/lib/api-client';
import { WeeklyGoal, WeeklyActual, WeeklyGoalWithActuals, ClosedLostRecord, QuarterlyProgress, SQODetail } from '@/types/sga-hub';
import { getDefaultWeekRange, getWeekMondayDate, getWeekInfo, formatDateISO, getCurrentQuarter, getQuarterFromDate, getQuarterInfo, getWeekSundayDate } from '@/lib/utils/sga-hub-helpers';
import { getSessionPermissions } from '@/types/auth';
import { exportWeeklyGoalsCSV, exportQuarterlyProgressCSV, exportClosedLostCSV } from '@/lib/utils/sga-hub-csv-export';
import { Download } from 'lucide-react';
import { MetricDrillDownModal } from '@/components/sga-hub/MetricDrillDownModal';
import { RecordDetailModal } from '@/components/dashboard/RecordDetailModal';
import { 
  MetricType, 
  DrillDownRecord, 
  DrillDownContext 
} from '@/types/drill-down';
import { formatDate } from '@/lib/utils/format-helpers';

export function SGAHubContent() {
  const { data: session } = useSession();
  const permissions = getSessionPermissions(session);
  const isAdmin = permissions?.role === 'admin' || permissions?.role === 'manager';
  const sgaName = session?.user?.name || 'Unknown';
  
  const [activeTab, setActiveTab] = useState<SGAHubTab>('weekly-goals');
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
  const [closedLostRecords, setClosedLostRecords] = useState<ClosedLostRecord[]>([]);
  const [closedLostLoading, setClosedLostLoading] = useState(false);
  const [closedLostError, setClosedLostError] = useState<string | null>(null);
  
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
  
  // Fetch weekly goals and actuals
  const fetchWeeklyData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const [goalsResponse, actualsResponse] = await Promise.all([
        dashboardApi.getWeeklyGoals(dateRange.startDate, dateRange.endDate),
        dashboardApi.getWeeklyActuals(dateRange.startDate, dateRange.endDate),
      ]);
      
      setWeeklyGoals(goalsResponse.goals);
      setWeeklyActuals(actualsResponse.actuals);
    } catch (err) {
      setError(handleApiError(err));
    } finally {
      setLoading(false);
    }
  };
  
  // Fetch closed lost records
  const fetchClosedLostRecords = async () => {
    try {
      setClosedLostLoading(true);
      setClosedLostError(null);
      
      const response = await dashboardApi.getClosedLostRecords();
      setClosedLostRecords(response.records);
    } catch (err) {
      setClosedLostError(handleApiError(err));
    } finally {
      setClosedLostLoading(false);
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
  
  useEffect(() => {
    if (activeTab === 'weekly-goals') {
      fetchWeeklyData();
    } else if (activeTab === 'closed-lost') {
      fetchClosedLostRecords();
    } else if (activeTab === 'quarterly-progress') {
      fetchQuarterlyProgress();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange.startDate, dateRange.endDate, activeTab, selectedQuarter]);
  
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
      };
      
      // Calculate differences
      const initialCallsDiff = goal ? actual.initialCalls - goal.initialCallsGoal : null;
      const qualificationCallsDiff = goal ? actual.qualificationCalls - goal.qualificationCallsGoal : null;
      const sqoDiff = goal ? actual.sqos - goal.sqoGoal : null;
      
      weeks.push({
        weekStartDate,
        weekEndDate: weekInfo.weekEndDate,
        weekLabel: weekInfo.label,
        initialCallsGoal: goal?.initialCallsGoal ?? null,
        qualificationCallsGoal: goal?.qualificationCallsGoal ?? null,
        sqoGoal: goal?.sqoGoal ?? null,
        initialCallsActual: actual.initialCalls,
        qualificationCallsActual: actual.qualificationCalls,
        sqoActual: actual.sqos,
        initialCallsDiff,
        qualificationCallsDiff,
        sqoDiff,
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

  // Handle metric click from Weekly Goals Table
  const handleWeeklyMetricClick = async (weekStartDate: string, metricType: MetricType) => {
    if (!sgaName || sgaName === 'Unknown') return;

    setDrillDownLoading(true);
    setDrillDownError(null);
    setDrillDownMetricType(metricType);
    setDrillDownOpen(true);

    const weekEndDate = getWeekEndDate(weekStartDate);

    const metricLabels: Record<MetricType, string> = {
      'initial-calls': 'Initial Calls',
      'qualification-calls': 'Qualification Calls',
      'sqos': 'SQOs',
    };
    
    const title = `${metricLabels[metricType]} - Week of ${formatDate(weekStartDate)}`;
    setDrillDownTitle(title);

    setDrillDownContext({
      metricType,
      title,
      sgaName: sgaName,
      weekStartDate,
      weekEndDate,
    });

    try {
      let records: DrillDownRecord[] = [];

      switch (metricType) {
        case 'initial-calls': {
          const response = await dashboardApi.getInitialCallsDrillDown(sgaName, weekStartDate, weekEndDate, session?.user?.email);
          records = response.records;
          break;
        }
        case 'qualification-calls': {
          const response = await dashboardApi.getQualificationCallsDrillDown(sgaName, weekStartDate, weekEndDate, session?.user?.email);
          records = response.records;
          break;
        }
        case 'sqos': {
          const response = await dashboardApi.getSQODrillDown(sgaName, { weekStartDate, weekEndDate }, session?.user?.email);
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
      const response = await dashboardApi.getSQODrillDown(sgaName, { quarter: selectedQuarter }, session?.user?.email);
      setDrillDownRecords(response.records);
    } catch (error) {
      console.error('Error fetching SQO drill-down:', error);
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

  // Handle Closed Lost row click
  const handleClosedLostRecordClick = (record: ClosedLostRecord) => {
    // Use primaryKey if available, otherwise fallback to id (opportunity ID)
    // Note: RecordDetailModal expects primary_key format, but can handle opportunity IDs starting with 006
    const recordId = record.primaryKey || record.id;
    setRecordDetailId(recordId);
    setRecordDetailOpen(true);
    // Don't set drillDownContext - no back button for closed lost
  };
  
  return (
    <div>
      <div className="mb-6">
        <Title>SGA Hub</Title>
        <Text>Track your weekly goals, closed lost follow-ups, and quarterly progress</Text>
      </div>
      
      <SGAHubTabs activeTab={activeTab} onTabChange={setActiveTab} />
      
      {activeTab === 'weekly-goals' && (
        <>
          <div className="mb-4 flex items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Start Date:
              </label>
              <input
                type="date"
                value={dateRange.startDate}
                onChange={(e) => setDateRange({ ...dateRange, startDate: e.target.value })}
                className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                End Date:
              </label>
              <input
                type="date"
                value={dateRange.endDate}
                onChange={(e) => setDateRange({ ...dateRange, endDate: e.target.value })}
                className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              />
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setDateRange(getDefaultWeekRange())}
            >
              Reset to Default
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={Download}
              onClick={() => exportWeeklyGoalsCSV(goalsWithActuals, sgaName)}
              disabled={goalsWithActuals.length === 0}
            >
              Export CSV
            </Button>
          </div>
          
          {error && (
            <Card className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <Text className="text-red-600 dark:text-red-400">{error}</Text>
            </Card>
          )}
          
          <WeeklyGoalsTable
            goals={goalsWithActuals}
            onEditGoal={handleEditGoal}
            isLoading={loading}
            onMetricClick={handleWeeklyMetricClick}
          />
        </>
      )}
      
      {activeTab === 'closed-lost' && (
        <>
          <div className="mb-4 flex justify-end">
            <Button
              size="sm"
              variant="secondary"
              icon={Download}
              onClick={() => exportClosedLostCSV(closedLostRecords, sgaName)}
              disabled={closedLostRecords.length === 0}
            >
              Export CSV
            </Button>
          </div>
          {closedLostError && (
            <Card className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <Text className="text-red-600 dark:text-red-400">{closedLostError}</Text>
            </Card>
          )}
          
          <ClosedLostTable
            records={closedLostRecords}
            isLoading={closedLostLoading}
          />
        </>
      )}
      
      {activeTab === 'quarterly-progress' && (
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
          />
        </>
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
