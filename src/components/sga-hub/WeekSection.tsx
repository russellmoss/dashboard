'use client';

import { WeeklyGoalWithActuals } from '@/types/sga-hub';
import { MetricType } from '@/types/drill-down';
import { MetricScorecard } from '@/components/sga-hub/MetricScorecard';
import { CHART_COLORS } from '@/config/theme';

interface WeekSectionProps {
  title: string;
  dateRange: string;
  weekData: WeeklyGoalWithActuals | null;
  isEditable: boolean;
  onGoalChange: (field: string, value: number) => void;
  onMetricClick: (metricType: MetricType, options?: { selfSourcedOnly?: boolean }) => void;
  leadsContactedToggle: 'all' | 'self-sourced';
  onLeadsContactedToggleChange: (value: 'all' | 'self-sourced') => void;
  leadsSourcedToggle: 'all' | 'self-sourced';
  onLeadsSourcedToggleChange: (value: 'all' | 'self-sourced') => void;
  isFutureWeek?: boolean;
}

export function WeekSection({
  title,
  dateRange,
  weekData,
  isEditable,
  onGoalChange,
  onMetricClick,
  leadsContactedToggle,
  onLeadsContactedToggleChange,
  leadsSourcedToggle,
  onLeadsSourcedToggleChange,
  isFutureWeek = false,
}: WeekSectionProps) {
  if (!weekData) {
    return (
      <div>
        <div className="mb-2">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">{title}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">{dateRange}</p>
        </div>
        <p className="text-gray-400 dark:text-gray-500 text-sm">No data available</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2">
        <h3 className="text-base font-semibold text-gray-900 dark:text-white">{title}</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">{dateRange}</p>
      </div>

      {/* Pipeline — MQL, SQL, SQO */}
      <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">Pipeline</p>
      <div className="grid grid-cols-3 gap-2 mb-3">
        <MetricScorecard
          label="MQLs"
          goalValue={weekData.mqlGoal}
          actualValue={weekData.mqlActual}
          isEditable={isEditable}
          onGoalChange={(v) => onGoalChange('mqlGoal', v)}
          onActualClick={isFutureWeek ? undefined : () => onMetricClick('mqls')}
          hideActual={isFutureWeek}
          accentColor={CHART_COLORS.contactedToMql}
        />
        <MetricScorecard
          label="SQLs"
          goalValue={weekData.sqlGoal}
          actualValue={weekData.sqlActual}
          isEditable={isEditable}
          onGoalChange={(v) => onGoalChange('sqlGoal', v)}
          onActualClick={isFutureWeek ? undefined : () => onMetricClick('sqls')}
          hideActual={isFutureWeek}
          accentColor={CHART_COLORS.mqlToSql}
        />
        <MetricScorecard
          label="SQOs"
          goalValue={weekData.sqoGoal}
          actualValue={weekData.sqoActual}
          isEditable={isEditable}
          onGoalChange={(v) => onGoalChange('sqoGoal', v)}
          onActualClick={isFutureWeek ? undefined : () => onMetricClick('sqos')}
          hideActual={isFutureWeek}
          accentColor={CHART_COLORS.sqoToJoined}
        />
      </div>

      {/* Calls — Initial Calls, Qualification Calls */}
      <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">Calls</p>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <MetricScorecard
          label="Initial Calls"
          goalValue={weekData.initialCallsGoal}
          actualValue={weekData.initialCallsActual}
          isEditable={isEditable}
          onGoalChange={(v) => onGoalChange('initialCallsGoal', v)}
          onActualClick={() => onMetricClick('initial-calls')}
          accentColor={CHART_COLORS.sqlToSqo}
        />
        <MetricScorecard
          label="Qual Calls"
          goalValue={weekData.qualificationCallsGoal}
          actualValue={weekData.qualificationCallsActual}
          isEditable={isEditable}
          onGoalChange={(v) => onGoalChange('qualificationCallsGoal', v)}
          onActualClick={() => onMetricClick('qualification-calls')}
          accentColor={CHART_COLORS.tertiary}
        />
      </div>

      {/* Lead Activity — Leads Sourced, Leads Contacted */}
      <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">Lead Activity</p>
      <div className="grid grid-cols-2 gap-2">
        <MetricScorecard
          label="Leads Sourced"
          goalValue={weekData.leadsSourcedGoal}
          actualValue={weekData.leadsSourcedActual}
          secondaryActualValue={weekData.leadsSourcedSelfSourcedActual}
          isEditable={isEditable}
          onGoalChange={(v) => onGoalChange('leadsSourcedGoal', v)}
          onActualClick={isFutureWeek ? undefined : () => onMetricClick('leads-sourced', { selfSourcedOnly: leadsSourcedToggle === 'self-sourced' })}
          showToggle={!isFutureWeek}
          toggleValue={leadsSourcedToggle}
          onToggleChange={onLeadsSourcedToggleChange}
          hideActual={isFutureWeek}
          accentColor={CHART_COLORS.quinary}
        />
        <MetricScorecard
          label="Leads Contacted"
          goalValue={weekData.leadsContactedGoal}
          actualValue={weekData.leadsContactedActual}
          secondaryActualValue={weekData.leadsContactedSelfSourcedActual}
          isEditable={isEditable}
          onGoalChange={(v) => onGoalChange('leadsContactedGoal', v)}
          onActualClick={isFutureWeek ? undefined : () => onMetricClick('leads-contacted', { selfSourcedOnly: leadsContactedToggle === 'self-sourced' })}
          showToggle={!isFutureWeek}
          toggleValue={leadsContactedToggle}
          onToggleChange={onLeadsContactedToggleChange}
          hideActual={isFutureWeek}
          accentColor={CHART_COLORS.quaternary}
        />
      </div>
    </div>
  );
}
