'use client';

import { useState, useEffect, useMemo } from 'react';
import { Title, Text, Card, Button, Select, SelectItem } from '@tremor/react';
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
import { getDefaultWeekRange, getWeekMondayDate, getWeekInfo, formatDateISO, getCurrentQuarter, getQuarterFromDate, getQuarterInfo } from '@/lib/utils/sga-hub-helpers';
import { getSessionPermissions } from '@/types/auth';

export function SGAHubContent() {
  const { data: session } = useSession();
  const permissions = getSessionPermissions(session);
  const isAdmin = permissions?.role === 'admin' || permissions?.role === 'manager';
  
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
      setHistoricalProgress(historicalData);
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
          />
        </>
      )}
      
      {activeTab === 'closed-lost' && (
        <>
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
          <div className="mb-4 flex items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Quarter:
              </label>
              <Select
                value={selectedQuarter}
                onValueChange={setSelectedQuarter}
                className="min-w-[120px]"
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
                      <SelectItem key={q} value={q}>
                        {info.label}
                      </SelectItem>
                    );
                  });
                })()}
              </Select>
            </div>
          </div>
          
          {quarterlyError && (
            <Card className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <Text className="text-red-600 dark:text-red-400">{quarterlyError}</Text>
            </Card>
          )}
          
          {quarterlyProgress && (
            <QuarterlyProgressCard progress={quarterlyProgress} />
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
    </div>
  );
}
