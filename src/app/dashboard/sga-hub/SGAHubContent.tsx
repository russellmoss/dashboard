'use client';

import { useState, useEffect, useMemo } from 'react';
import { Title, Text, Card, Button, Select, SelectItem } from '@tremor/react';
import { useSession } from 'next-auth/react';
import { SGAHubTabs, SGAHubTab } from '@/components/sga-hub/SGAHubTabs';
import { WeeklyGoalsTable } from '@/components/sga-hub/WeeklyGoalsTable';
import { WeeklyGoalEditor } from '@/components/sga-hub/WeeklyGoalEditor';
import { ClosedLostTable } from '@/components/sga-hub/ClosedLostTable';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { dashboardApi, handleApiError } from '@/lib/api-client';
import { WeeklyGoal, WeeklyActual, WeeklyGoalWithActuals, ClosedLostRecord } from '@/types/sga-hub';
import { getDefaultWeekRange, getWeekMondayDate, getWeekInfo, formatDateISO } from '@/lib/utils/sga-hub-helpers';
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
  
  useEffect(() => {
    if (activeTab === 'weekly-goals') {
      fetchWeeklyData();
    } else if (activeTab === 'closed-lost') {
      fetchClosedLostRecords();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange.startDate, dateRange.endDate, activeTab]);
  
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
      const isCurrentWeek = today >= weekStart && today <= weekEnd;
      const isFutureWeek = today < weekStart;
      
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
        <Card className="mb-6 dark:bg-gray-800 dark:border-gray-700">
          <Text>Quarterly Progress tab - Coming in Phase 7</Text>
        </Card>
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
