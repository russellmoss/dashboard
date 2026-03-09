'use client';

import { useState, useMemo, useCallback } from 'react';
import { WeeklyGoal, WeeklyActual, WeeklyGoalWithActuals, WeeklyGoalInput } from '@/types/sga-hub';
import { MetricType } from '@/types/drill-down';
import { WeekSection } from '@/components/sga-hub/WeekSection';
import { GoalsVsActualsChart } from '@/components/sga-hub/GoalsVsActualsChart';
import { getWeekMondayDate, formatWeekRange, getWeekInfo } from '@/lib/utils/sga-hub-helpers';
import { CHART_COLORS } from '@/config/theme';
import { dashboardApi } from '@/lib/api-client';

interface WeeklyGoalsVsActualsProps {
  weeklyGoals: WeeklyGoal[];
  weeklyActuals: WeeklyActual[];
  isAdmin: boolean;
  sgaName: string;
  userEmail: string;
  onGoalSaved: () => void;
  onMetricClick: (weekStartDate: string, metricType: MetricType, options?: { selfSourcedOnly?: boolean }) => void;
  readOnly?: boolean;
}

function formatDateISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function buildWeekData(
  mondayISO: string,
  weeklyGoals: WeeklyGoal[],
  weeklyActuals: WeeklyActual[],
  isAdmin: boolean,
  isCurrentWeek: boolean,
  isFutureWeek: boolean
): WeeklyGoalWithActuals {
  const weekInfo = getWeekInfo(mondayISO);
  const goal = weeklyGoals.find(g => g.weekStartDate === mondayISO);
  const actual = weeklyActuals.find(a => a.weekStartDate === mondayISO) || {
    weekStartDate: mondayISO,
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

  return {
    weekStartDate: mondayISO,
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
  };
}

export function WeeklyGoalsVsActuals({
  weeklyGoals,
  weeklyActuals,
  isAdmin,
  sgaName,
  userEmail,
  onGoalSaved,
  onMetricClick,
  readOnly = false,
}: WeeklyGoalsVsActualsProps) {
  const [leadsContactedToggle, setLeadsContactedToggle] = useState<'all' | 'self-sourced'>('all');
  const [leadsSourcedToggle, setLeadsSourcedToggle] = useState<'all' | 'self-sourced'>('all');
  const [savingGoal, setSavingGoal] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Calculate week mondays
  const { lastWeekMonday, thisWeekMonday, nextWeekMonday } = useMemo(() => {
    const now = new Date();
    const thisMonday = getWeekMondayDate(now);
    const lastMonday = new Date(thisMonday);
    lastMonday.setDate(lastMonday.getDate() - 7);
    const nextMonday = new Date(thisMonday);
    nextMonday.setDate(nextMonday.getDate() + 7);
    return {
      lastWeekMonday: formatDateISO(lastMonday),
      thisWeekMonday: formatDateISO(thisMonday),
      nextWeekMonday: formatDateISO(nextMonday),
    };
  }, []);

  // Build week data
  const lastWeekData = useMemo(
    () => buildWeekData(lastWeekMonday, weeklyGoals, weeklyActuals, isAdmin, false, false),
    [lastWeekMonday, weeklyGoals, weeklyActuals, isAdmin]
  );
  const thisWeekData = useMemo(
    () => buildWeekData(thisWeekMonday, weeklyGoals, weeklyActuals, isAdmin, true, false),
    [thisWeekMonday, weeklyGoals, weeklyActuals, isAdmin]
  );
  const nextWeekData = useMemo(
    () => buildWeekData(nextWeekMonday, weeklyGoals, weeklyActuals, isAdmin, false, true),
    [nextWeekMonday, weeklyGoals, weeklyActuals, isAdmin]
  );

  // Chart data: merge all weeks of goals + actuals into flat chart data points
  const chartData = useMemo(() => {
    // Collect all unique week start dates from both goals and actuals
    const allWeeks = new Set<string>();
    weeklyGoals.forEach(g => allWeeks.add(g.weekStartDate));
    weeklyActuals.forEach(a => allWeeks.add(a.weekStartDate));

    return Array.from(allWeeks)
      .sort()
      .map(ws => {
        const goal = weeklyGoals.find(g => g.weekStartDate === ws);
        const actual = weeklyActuals.find(a => a.weekStartDate === ws);
        const weekLabel = formatWeekRange(ws);
        return {
          weekLabel,
          weekStartDate: ws,
          mqlGoal: goal?.mqlGoal ?? null,
          mqlActual: actual?.mqls ?? 0,
          sqlGoal: goal?.sqlGoal ?? null,
          sqlActual: actual?.sqls ?? 0,
          sqoGoal: goal?.sqoGoal ?? null,
          sqoActual: actual?.sqos ?? 0,
          initialCallsGoal: goal?.initialCallsGoal ?? null,
          initialCallsActual: actual?.initialCalls ?? 0,
          qualificationCallsGoal: goal?.qualificationCallsGoal ?? null,
          qualificationCallsActual: actual?.qualificationCalls ?? 0,
          leadsSourcedGoal: goal?.leadsSourcedGoal ?? null,
          leadsSourcedActual: actual?.leadsSourced ?? 0,
          leadsContactedGoal: goal?.leadsContactedGoal ?? null,
          leadsContactedActual: actual?.leadsContacted ?? 0,
        };
      });
  }, [weeklyGoals, weeklyActuals]);

  const handleGoalChange = useCallback(async (weekStartDate: string, field: string, value: number) => {
    setSavingGoal(true);
    setSaveError(null);
    try {
      const existingGoal = weeklyGoals.find(g => g.weekStartDate === weekStartDate);
      const goalInput: WeeklyGoalInput = {
        weekStartDate,
        initialCallsGoal: existingGoal?.initialCallsGoal ?? 0,
        qualificationCallsGoal: existingGoal?.qualificationCallsGoal ?? 0,
        sqoGoal: existingGoal?.sqoGoal ?? 0,
        mqlGoal: existingGoal?.mqlGoal ?? 0,
        sqlGoal: existingGoal?.sqlGoal ?? 0,
        leadsSourcedGoal: existingGoal?.leadsSourcedGoal ?? 0,
        leadsContactedGoal: existingGoal?.leadsContactedGoal ?? 0,
        [field]: value,
      };
      await dashboardApi.saveWeeklyGoal(goalInput, userEmail);
      onGoalSaved();
    } catch (err) {
      setSaveError('Failed to save goal');
      console.error('Error saving goal:', err);
    } finally {
      setSavingGoal(false);
    }
  }, [weeklyGoals, userEmail, onGoalSaved]);

  return (
    <div className="space-y-6">
      {saveError && (
        <div className="p-3 rounded bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
          {saveError}
        </div>
      )}

      {savingGoal && (
        <div className="text-sm text-blue-600 dark:text-blue-400">Saving goal...</div>
      )}

      {/* Last Week + This Week — side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <WeekSection
            title="Last Week"
            dateRange={formatWeekRange(lastWeekMonday)}
            weekData={lastWeekData}
            isEditable={false}
            onGoalChange={(field, value) => handleGoalChange(lastWeekMonday, field, value)}
            onMetricClick={(metricType, options) => onMetricClick(lastWeekMonday, metricType, options)}
            leadsContactedToggle={leadsContactedToggle}
            onLeadsContactedToggleChange={setLeadsContactedToggle}
            leadsSourcedToggle={leadsSourcedToggle}
            onLeadsSourcedToggleChange={setLeadsSourcedToggle}
          />
        </div>
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <WeekSection
            title="This Week"
            dateRange={formatWeekRange(thisWeekMonday)}
            weekData={thisWeekData}
            isEditable={!readOnly}
            onGoalChange={(field, value) => handleGoalChange(thisWeekMonday, field, value)}
            onMetricClick={(metricType, options) => onMetricClick(thisWeekMonday, metricType, options)}
            leadsContactedToggle={leadsContactedToggle}
            onLeadsContactedToggleChange={setLeadsContactedToggle}
            leadsSourcedToggle={leadsSourcedToggle}
            onLeadsSourcedToggleChange={setLeadsSourcedToggle}
          />
        </div>
      </div>

      {/* Next Week — centered below */}
      <div className="flex justify-center">
        <div className="w-full lg:w-1/2 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <WeekSection
            title="Next Week"
            dateRange={formatWeekRange(nextWeekMonday)}
            weekData={nextWeekData}
            isEditable={!readOnly}
            onGoalChange={(field, value) => handleGoalChange(nextWeekMonday, field, value)}
            onMetricClick={(metricType, options) => onMetricClick(nextWeekMonday, metricType, options)}
            leadsContactedToggle={leadsContactedToggle}
            onLeadsContactedToggleChange={setLeadsContactedToggle}
            leadsSourcedToggle={leadsSourcedToggle}
            onLeadsSourcedToggleChange={setLeadsSourcedToggle}
            isFutureWeek={true}
          />
        </div>
      </div>

      {/* Charts */}
      <GoalsVsActualsChart
        title="Pipeline Metrics"
        data={chartData}
        metrics={[
          { key: 'mql', label: 'MQLs', actualColor: CHART_COLORS.contactedToMql, goalColor: '#93c5fd', defaultVisible: true },
          { key: 'sql', label: 'SQLs', actualColor: CHART_COLORS.mqlToSql, goalColor: '#6ee7b7', defaultVisible: true },
          { key: 'sqo', label: 'SQOs', actualColor: CHART_COLORS.sqoToJoined, goalColor: '#c4b5fd', defaultVisible: true },
        ]}
      />

      <GoalsVsActualsChart
        title="Call Metrics"
        data={chartData}
        metrics={[
          { key: 'initialCalls', label: 'Initial Calls', actualColor: CHART_COLORS.sqlToSqo, goalColor: '#fcd34d', defaultVisible: true },
          { key: 'qualificationCalls', label: 'Qualification Calls', actualColor: CHART_COLORS.tertiary, goalColor: '#67e8f9', defaultVisible: true },
        ]}
      />

      <GoalsVsActualsChart
        title="Lead Activity Metrics"
        data={chartData}
        metrics={[
          { key: 'leadsSourced', label: 'Leads Sourced', actualColor: CHART_COLORS.quinary, goalColor: '#6ee7b7', defaultVisible: true },
          { key: 'leadsContacted', label: 'Leads Contacted', actualColor: CHART_COLORS.quaternary, goalColor: '#fcd34d', defaultVisible: true },
        ]}
      />
    </div>
  );
}
