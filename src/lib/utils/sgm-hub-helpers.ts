import { getQuarterInfo } from './sga-hub-helpers';
import { SGMPacingStatus } from '@/types/sgm-hub';

interface SGMPacingResult {
  expectedArr: number;
  pacingDiff: number;
  pacingDiffPercent: number;
  pacingStatus: SGMPacingStatus;
  progressPercent: number | null;
  projectedArr: number;
  daysElapsed: number;
  daysInQuarter: number;
  quarterStartDate: string;
  quarterEndDate: string;
}

export function calculateSGMQuarterPacing(
  quarter: string,
  arrGoal: number | null,
  actualArr: number,
): SGMPacingResult {
  const info = getQuarterInfo(quarter);
  const today = new Date();
  const startDate = new Date(info.startDate);
  const endDate = new Date(info.endDate);

  const daysInQuarter = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const daysElapsed = Math.max(0, Math.min(
    daysInQuarter,
    Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1
  ));

  let expectedArr = 0;
  let pacingDiff = 0;
  let pacingDiffPercent = 0;
  let pacingStatus: SGMPacingStatus = 'no-goal';
  let progressPercent: number | null = null;
  let projectedArr = 0;

  if (arrGoal !== null && arrGoal > 0) {
    expectedArr = (arrGoal / daysInQuarter) * daysElapsed;
    pacingDiff = actualArr - expectedArr;
    progressPercent = Math.round((actualArr / arrGoal) * 100);
    projectedArr = daysElapsed > 0 ? (actualArr / daysElapsed) * daysInQuarter : 0;

    if (expectedArr === 0) {
      pacingStatus = 'on-track';
      pacingDiffPercent = 0;
    } else {
      pacingDiffPercent = (pacingDiff / expectedArr) * 100;
      if (pacingDiffPercent > 15) {
        pacingStatus = 'ahead';
      } else if (pacingDiffPercent >= -15) {
        pacingStatus = 'on-track';
      } else {
        pacingStatus = 'behind';
      }
    }
  }

  return {
    expectedArr: Math.round(expectedArr),
    pacingDiff: Math.round(pacingDiff),
    pacingDiffPercent: Math.round(pacingDiffPercent * 10) / 10,
    pacingStatus,
    progressPercent,
    projectedArr: Math.round(projectedArr),
    daysElapsed,
    daysInQuarter,
    quarterStartDate: info.startDate,
    quarterEndDate: info.endDate,
  };
}

/**
 * Get color status for days-open / days-in-stage
 * Matches STALE_PIPELINE_THRESHOLDS: warning=30, stale=60, critical=90
 */
export function getDaysAgingStatus(days: number | null): 'green' | 'yellow' | 'orange' | 'red' | null {
  if (days === null) return null;
  if (days >= 90) return 'red';
  if (days >= 60) return 'orange';
  if (days >= 30) return 'yellow';
  return 'green';
}

/**
 * Format dollar amount compactly
 * $1,234,567 → "$1.2M", $500,000 → "$500K", $0 → "$0"
 */
export function formatArrCompact(value: number): string {
  if (value === 0) return '$0';
  if (Math.abs(value) >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `$${(value / 1_000).toFixed(0)}K`;
  }
  return `$${value.toFixed(0)}`;
}
