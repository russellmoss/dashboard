'use client';

import { useState, useMemo } from 'react';
import { WeeklyGoal, WeeklyActual } from '@/types/sga-hub';
import { MetricType } from '@/types/drill-down';
import { WeeklyGoalsVsActuals } from '@/components/sga-hub/WeeklyGoalsVsActuals';

type ActualWithSGA = WeeklyActual & { sgaName?: string };

interface AdminGoalsRollupViewProps {
  allSGAGoals: WeeklyGoal[];
  allSGAActuals: WeeklyActual[];
  sgaList: Array<{ email: string; name: string }>;
  onGoalSaved: () => void;
  onMetricClick: (weekStartDate: string, metricType: MetricType, options?: { selfSourcedOnly?: boolean; sgaName?: string; userEmail?: string; teamLevel?: boolean }) => void;
}

export function AdminGoalsRollupView({
  allSGAGoals,
  allSGAActuals,
  sgaList,
  onGoalSaved,
  onMetricClick,
}: AdminGoalsRollupViewProps) {
  const [viewMode, setViewMode] = useState<'rollup' | 'individual'>('rollup');
  const [selectedSGA, setSelectedSGA] = useState<{ email: string; name: string } | null>(null);

  const handleSGAChange = (value: string) => {
    if (value === 'all') {
      setViewMode('rollup');
      setSelectedSGA(null);
    } else {
      setViewMode('individual');
      const sga = sgaList.find(s => s.name === value) || null;
      setSelectedSGA(sga);
    }
  };

  // Filter goals/actuals for individual SGA
  const individualGoals = useMemo(() => {
    if (!selectedSGA) return [];
    return allSGAGoals.filter(g => g.userEmail === selectedSGA.email);
  }, [allSGAGoals, selectedSGA]);

  const individualActuals = useMemo(() => {
    if (!selectedSGA) return [];
    return allSGAActuals.filter(a => (a as ActualWithSGA).sgaName === selectedSGA.name);
  }, [allSGAActuals, selectedSGA]);

  // Rollup: aggregate ALL goals and actuals across all SGAs
  const rollupGoals = useMemo(() => {
    const weekMap = new Map<string, WeeklyGoal>();
    for (const g of allSGAGoals) {
      const existing = weekMap.get(g.weekStartDate);
      if (existing) {
        existing.initialCallsGoal += g.initialCallsGoal;
        existing.qualificationCallsGoal += g.qualificationCallsGoal;
        existing.sqoGoal += g.sqoGoal;
        existing.mqlGoal += g.mqlGoal;
        existing.sqlGoal += g.sqlGoal;
        existing.leadsSourcedGoal += g.leadsSourcedGoal;
        existing.leadsContactedGoal += g.leadsContactedGoal;
      } else {
        weekMap.set(g.weekStartDate, { ...g });
      }
    }
    return Array.from(weekMap.values());
  }, [allSGAGoals]);

  const rollupActuals = useMemo(() => {
    const weekMap = new Map<string, WeeklyActual>();
    for (const a of allSGAActuals) {
      const existing = weekMap.get(a.weekStartDate);
      if (existing) {
        existing.initialCalls += a.initialCalls;
        existing.qualificationCalls += a.qualificationCalls;
        existing.sqos += a.sqos;
        existing.mqls += a.mqls;
        existing.sqls += a.sqls;
        existing.leadsSourced += a.leadsSourced;
        existing.leadsSourcedSelfSourced += a.leadsSourcedSelfSourced;
        existing.leadsContacted += a.leadsContacted;
        existing.leadsContactedSelfSourced += a.leadsContactedSelfSourced;
      } else {
        weekMap.set(a.weekStartDate, { ...a });
      }
    }
    return Array.from(weekMap.values());
  }, [allSGAActuals]);

  return (
    <div className="space-y-6">
      {/* SGA Selector */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">View:</label>
        <select
          value={viewMode === 'rollup' ? 'all' : (selectedSGA?.name || 'all')}
          onChange={(e) => handleSGAChange(e.target.value)}
          className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
        >
          <option value="all">All SGAs (Rollup)</option>
          {sgaList.map(sga => (
            <option key={sga.name} value={sga.name}>{sga.name}</option>
          ))}
        </select>
      </div>

      {viewMode === 'rollup' ? (
        <WeeklyGoalsVsActuals
          weeklyGoals={rollupGoals}
          weeklyActuals={rollupActuals}
          isAdmin={false}
          sgaName="All SGAs"
          userEmail=""
          onGoalSaved={onGoalSaved}
          onMetricClick={(weekStartDate, metricType, options) =>
            onMetricClick(weekStartDate, metricType, { ...options, teamLevel: true })
          }
          readOnly
        />
      ) : selectedSGA ? (
        <WeeklyGoalsVsActuals
          weeklyGoals={individualGoals}
          weeklyActuals={individualActuals}
          isAdmin={true}
          sgaName={selectedSGA.name}
          userEmail={selectedSGA.email}
          onGoalSaved={onGoalSaved}
          onMetricClick={(weekStartDate, metricType, options) =>
            onMetricClick(weekStartDate, metricType, { ...options, sgaName: selectedSGA.name, userEmail: selectedSGA.email })
          }
        />
      ) : null}
    </div>
  );
}
