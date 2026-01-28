// src/components/sga-hub/AdminQuarterlyProgressView.tsx

'use client';

import { useState, useEffect, useMemo } from 'react';
import { TeamGoalEditor } from './TeamGoalEditor';
import { TeamProgressCard } from './TeamProgressCard';
import { SGABreakdownTable, SGABreakdownRow } from './SGABreakdownTable';
import { AdminQuarterlyFilters } from './AdminQuarterlyFilters';
import { StatusSummaryStrip } from './StatusSummaryStrip';
import { dashboardApi } from '@/lib/api-client';
import { getCurrentQuarter, getQuarterInfo } from '@/lib/utils/sga-hub-helpers';
import { FilterOptions } from '@/types/filters';
import { AdminQuarterlyProgress } from '@/types/sga-hub';

interface AdminQuarterlyProgressViewProps {
  onSQOClick?: (sgaName: string, filters: { year: number; quarter: number; channels: string[]; sources: string[] }) => void;
  onTeamSQOClick?: (filters: { year: number; quarter: number; channels: string[]; sources: string[] }) => void;
}

export function AdminQuarterlyProgressView({
  onSQOClick,
  onTeamSQOClick,
}: AdminQuarterlyProgressViewProps) {
  const currentQuarterInfo = getQuarterInfo(getCurrentQuarter());
  
  const [year, setYear] = useState<number>(currentQuarterInfo.year);
  const [quarter, setQuarter] = useState<number>(currentQuarterInfo.quarterNumber);
  const [selectedSGAs, setSelectedSGAs] = useState<string[]>([]);
  const [selectedChannels, setSelectedChannels] = useState<string[]>(['Outbound', 'Outbound + Marketing', 'Re-Engagement']);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [selectedPacingStatuses, setSelectedPacingStatuses] = useState<string[]>(['ahead', 'on-track', 'behind', 'no-goal']); // Default: all

  const [sgaManagerGoal, setSgaManagerGoal] = useState<number | null>(null);
  const [adminProgress, setAdminProgress] = useState<AdminQuarterlyProgress | null>(null);
  const [sgaGoals, setSgaGoals] = useState<Record<string, number | null>>({});
  const [loading, setLoading] = useState(true);
  const [savingGoal, setSavingGoal] = useState(false);
  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);
  const [sgaOptions, setSgaOptions] = useState<Array<{ value: string; label: string; isActive: boolean }>>([]);
  const [sgaOptionsLoading, setSgaOptionsLoading] = useState(false);

  // Fetch filter options
  useEffect(() => {
    const fetchFilterOptions = async () => {
      try {
        const options = await dashboardApi.getFilterOptions();
        setFilterOptions(options);
        if (options && options.sources) {
          setSelectedSources([...options.sources]);
        }
      } catch (err) {
        console.error('Error fetching filter options:', err);
      }
    };
    fetchFilterOptions();
  }, []);

  // Fetch SGA options
  useEffect(() => {
    const fetchSGAOptions = async () => {
      try {
        setSgaOptionsLoading(true);
        const response = await dashboardApi.getLeaderboardSGAOptions();
        setSgaOptions(response.sgaOptions);
        const activeSGAs = response.sgaOptions.filter(s => s.isActive).map(s => s.value);
        setSelectedSGAs(activeSGAs);
      } catch (err) {
        console.error('Error fetching SGA options:', err);
      } finally {
        setSgaOptionsLoading(false);
      }
    };
    fetchSGAOptions();
  }, []);

  // Fetch manager goal
  useEffect(() => {
    const fetchManagerGoal = async () => {
      try {
        const response = await dashboardApi.getManagerQuarterlyGoal(`${year}-Q${quarter}`);
        setSgaManagerGoal(response.goal);
      } catch (err) {
        console.error('Error fetching manager goal:', err);
      }
    };
    fetchManagerGoal();
  }, [year, quarter]);

  // Fetch admin progress and SGA breakdown
  useEffect(() => {
    const fetchProgress = async () => {
      try {
        setLoading(true);
        const progress = await dashboardApi.getAdminQuarterlyProgress({
          year,
          quarter,
          sgaNames: selectedSGAs.length > 0 ? selectedSGAs : undefined,
          channels: selectedChannels.length > 0 ? selectedChannels : undefined,
          sources: selectedSources.length > 0 ? selectedSources : undefined,
        });
        setAdminProgress(progress);
        
        // Update local manager goal state from API response only if local state is null
        // This prevents stale cached data from overwriting a freshly saved goal
        if (sgaManagerGoal === null && progress.sgaManagerGoal !== null) {
          setSgaManagerGoal(progress.sgaManagerGoal);
        }

        // Fetch individual SGA goals for breakdown
        if (progress.sgaBreakdown.length > 0) {
          try {
            const sgaNames = progress.sgaBreakdown.map(item => item.sgaName);
            const response = await dashboardApi.getSGAQuarterlyGoals(year, quarter, sgaNames);
            setSgaGoals(response.goals);
          } catch (err) {
            console.error('Error fetching SGA goals:', err);
            // Continue with empty goals if fetch fails
            setSgaGoals({});
          }
        } else {
          setSgaGoals({});
        }
      } catch (err) {
        console.error('Error fetching admin progress:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchProgress();
  }, [year, quarter, selectedSGAs, selectedChannels, selectedSources]);

  const handleSaveManagerGoal = async (goal: number) => {
    setSavingGoal(true);
    try {
      await dashboardApi.setManagerQuarterlyGoal(`${year}-Q${quarter}`, goal);
      setSgaManagerGoal(goal);
      // Refresh admin progress to get updated manager goal
      const progress = await dashboardApi.getAdminQuarterlyProgress({
        year,
        quarter,
        sgaNames: selectedSGAs.length > 0 ? selectedSGAs : undefined,
        channels: selectedChannels.length > 0 ? selectedChannels : undefined,
        sources: selectedSources.length > 0 ? selectedSources : undefined,
      });
      setAdminProgress(progress);
    } catch (err) {
      console.error('Error saving manager goal:', err);
      throw err;
    } finally {
      setSavingGoal(false);
    }
  };

  const handleApplyFilters = (filters: {
    year: number;
    quarter: number;
    sgas: string[];
    channels: string[];
    sources: string[];
    pacingStatuses: string[];
  }) => {
    setYear(filters.year);
    setQuarter(filters.quarter);
    setSelectedSGAs(filters.sgas);
    setSelectedChannels(filters.channels);
    setSelectedSources(filters.sources);
    setSelectedPacingStatuses(filters.pacingStatuses);
  };

  // Build SGA breakdown with goals, progress, and pacing
  const sgaBreakdown: SGABreakdownRow[] = useMemo(() => {
    if (!adminProgress) return [];
    
    return adminProgress.sgaBreakdown.map((item) => {
      const goal = sgaGoals[item.sgaName] || null;
      const progressPercent = goal && goal > 0 
        ? Math.round((item.sqoCount / goal) * 100)
        : null;
      
      // Calculate pacing (same logic as TeamProgressCard)
      const quarterInfo = getQuarterInfo(`${year}-Q${quarter}`);
      const startDate = new Date(quarterInfo.startDate);
      const endDate = new Date(quarterInfo.endDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const daysInQuarter = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      const daysElapsed = Math.min(
        Math.max(0, Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1),
        daysInQuarter
      );
      
      let expectedSQOs = 0;
      let pacingStatus: 'ahead' | 'on-track' | 'behind' | 'no-goal' = 'no-goal';
      
      if (goal && goal > 0) {
        expectedSQOs = Math.round((goal / daysInQuarter) * daysElapsed);
        if (item.sqoCount > expectedSQOs * 1.1) {
          pacingStatus = 'ahead';
        } else if (item.sqoCount >= expectedSQOs * 0.9) {
          pacingStatus = 'on-track';
        } else {
          pacingStatus = 'behind';
        }
      }
      
      const pacingDiff = item.sqoCount - expectedSQOs;
      
      return {
        sgaName: item.sgaName,
        goal,
        sqoCount: item.sqoCount,
        progressPercent,
        expectedSQOs,
        pacingDiff,
        pacingStatus,
      };
    });
  }, [adminProgress, sgaGoals, year, quarter]);

  // Calculate status counts for StatusSummaryStrip
  const statusCounts = useMemo(() => {
    const counts = {
      ahead: 0,
      onTrack: 0,
      behind: 0,
      noGoal: 0,
      total: sgaBreakdown.length,
    };
    sgaBreakdown.forEach(row => {
      if (row.pacingStatus === 'ahead') counts.ahead++;
      else if (row.pacingStatus === 'on-track') counts.onTrack++;
      else if (row.pacingStatus === 'behind') counts.behind++;
      else if (row.pacingStatus === 'no-goal') counts.noGoal++;
    });
    return counts;
  }, [sgaBreakdown]);

  if (!filterOptions) {
    return <div>Loading filters...</div>;
  }

  return (
    <div>
      {/* 1. AdminQuarterlyFilters (collapsible) */}
      <AdminQuarterlyFilters
        selectedYear={year}
        selectedQuarter={quarter}
        selectedSGAs={selectedSGAs}
        selectedChannels={selectedChannels}
        selectedSources={selectedSources}
        selectedPacingStatuses={selectedPacingStatuses}
        sgaOptions={sgaOptions}
        channelOptions={filterOptions.channels}
        sourceOptions={filterOptions.sources}
        sgaOptionsLoading={sgaOptionsLoading}
        onApply={handleApplyFilters}
        disabled={loading}
      />

      {/* 2. StatusSummaryStrip (at-a-glance stats) */}
      {adminProgress && (
        <StatusSummaryStrip
          quarterLabel={getQuarterInfo(`${year}-Q${quarter}`).label}
          totalSGAs={statusCounts.total}
          aheadCount={statusCounts.ahead}
          onTrackCount={statusCounts.onTrack}
          behindCount={statusCounts.behind}
          noGoalCount={statusCounts.noGoal}
        />
      )}

      {/* 3. Manager Goal Editor (inline, smaller) */}
      <div className="mb-4">
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            SGA Manager Quarterly Goal:
          </span>
          <TeamGoalEditor
            year={year}
            quarter={quarter}
            currentGoal={sgaManagerGoal}
            onSave={handleSaveManagerGoal}
            isLoading={savingGoal}
          />
        </div>
      </div>

      {/* 4. TeamProgressCard (the two goal metrics comparison) */}
      {adminProgress && (
        <TeamProgressCard
          year={year}
          quarter={quarter}
          sgaIndividualGoalsAggregate={adminProgress.sgaIndividualGoalsAggregate}
          sgaManagerGoal={sgaManagerGoal !== null ? sgaManagerGoal : adminProgress.sgaManagerGoal}
          currentSQOs={adminProgress.teamTotalSQOs}
          onSQOClick={onTeamSQOClick ? () => onTeamSQOClick({ year, quarter, channels: selectedChannels, sources: selectedSources }) : undefined}
        />
      )}

      {/* 5. SGABreakdownTable (with sorting and full columns) */}
      <SGABreakdownTable
        year={year}
        quarter={quarter}
        breakdown={sgaBreakdown}
        isLoading={loading}
        onSQOClick={onSQOClick ? (sgaName) => onSQOClick(sgaName, { year, quarter, channels: selectedChannels, sources: selectedSources }) : undefined}
        selectedSGAs={selectedSGAs}
        selectedPacingStatuses={selectedPacingStatuses}
        sgaOptions={sgaOptions}
      />
    </div>
  );
}
