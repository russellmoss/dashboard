// src/lib/utils/sga-hub-csv-export.ts

import { 
  WeeklyGoalWithActuals, 
  QuarterlyProgress, 
  ClosedLostRecord, 
  AdminSGAOverview 
} from '@/types/sga-hub';

type CSVValue = string | number | boolean | null | undefined;
type CSVRow = Record<string, CSVValue>;

/**
 * Format date for CSV (YYYY-MM-DD)
 */
function formatDate(date: string | Date): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '';
  return d.toISOString().split('T')[0];
}

/**
 * Generic CSV generation and download function
 */
function generateCSV<T extends Record<string, any>>(
  data: T[],
  columns: { key: string; header: string }[],
  filename: string
): void {
  if (data.length === 0) {
    alert('No data to export');
    return;
  }

  // Build CSV header row
  const headers = columns.map(col => col.header);
  const csvContent = [
    headers.join(','),
    ...data.map(row => 
      columns.map(col => {
        const value = row[col.key];
        // Convert value to string, handling null/undefined
        const stringValue = String(value ?? '');
        // Escape quotes and wrap in quotes if contains comma, quote, or newline
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
          return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
      }).join(',')
    )
  ].join('\n');

  // Download CSV
  downloadCSV(csvContent, filename);
}

/**
 * Download CSV file using browser Blob API
 */
function downloadCSV(csvContent: string, filename: string): void {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${filename}_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

/**
 * Export weekly goals with actuals to CSV
 */
export function exportWeeklyGoalsCSV(
  goals: WeeklyGoalWithActuals[],
  sgaName: string
): void {
  const sanitizedName = sgaName.replace(/[^a-zA-Z0-9]/g, '_');
  
  const columns = [
    { key: 'weekLabel', header: 'Week' },
    { key: 'weekStartDate', header: 'Week Start Date' },
    { key: 'weekEndDate', header: 'Week End Date' },
    { key: 'initialCallsGoal', header: 'Initial Calls Goal' },
    { key: 'initialCallsActual', header: 'Initial Calls Actual' },
    { key: 'initialCallsDiff', header: 'Initial Calls Difference' },
    { key: 'qualificationCallsGoal', header: 'Qualification Calls Goal' },
    { key: 'qualificationCallsActual', header: 'Qualification Calls Actual' },
    { key: 'qualificationCallsDiff', header: 'Qualification Calls Difference' },
    { key: 'sqoGoal', header: 'SQO Goal' },
    { key: 'sqoActual', header: 'SQO Actual' },
    { key: 'sqoDiff', header: 'SQO Difference' },
    { key: 'hasGoal', header: 'Has Goal' },
  ];

  // Transform data for CSV (format dates, handle nulls)
  const csvData = goals.map(goal => ({
    weekLabel: goal.weekLabel,
    weekStartDate: formatDate(goal.weekStartDate),
    weekEndDate: formatDate(goal.weekEndDate),
    initialCallsGoal: goal.initialCallsGoal ?? '',
    initialCallsActual: goal.initialCallsActual,
    initialCallsDiff: goal.initialCallsDiff ?? '',
    qualificationCallsGoal: goal.qualificationCallsGoal ?? '',
    qualificationCallsActual: goal.qualificationCallsActual,
    qualificationCallsDiff: goal.qualificationCallsDiff ?? '',
    sqoGoal: goal.sqoGoal ?? '',
    sqoActual: goal.sqoActual,
    sqoDiff: goal.sqoDiff ?? '',
    hasGoal: goal.hasGoal ? 'Yes' : 'No',
  }));

  generateCSV(csvData, columns, `weekly_goals_${sanitizedName}`);
}

/**
 * Export quarterly progress to CSV
 */
export function exportQuarterlyProgressCSV(
  progress: QuarterlyProgress[],
  sgaName: string
): void {
  const sanitizedName = sgaName.replace(/[^a-zA-Z0-9]/g, '_');
  
  const columns = [
    { key: 'quarterLabel', header: 'Quarter' },
    { key: 'quarter', header: 'Quarter Code' },
    { key: 'sqoGoal', header: 'SQO Goal' },
    { key: 'sqoActual', header: 'SQO Actual' },
    { key: 'progressPercent', header: 'Progress %' },
    { key: 'totalAumFormatted', header: 'Total AUM' },
    { key: 'daysElapsed', header: 'Days Elapsed' },
    { key: 'daysInQuarter', header: 'Days in Quarter' },
    { key: 'expectedSqos', header: 'Expected SQOs' },
    { key: 'pacingDiff', header: 'Pacing Difference' },
    { key: 'pacingStatus', header: 'Pacing Status' },
    { key: 'quarterStartDate', header: 'Quarter Start Date' },
    { key: 'quarterEndDate', header: 'Quarter End Date' },
  ];

  // Transform data for CSV (format dates, handle nulls)
  const csvData = progress.map(p => ({
    quarterLabel: p.quarterLabel,
    quarter: p.quarter,
    sqoGoal: p.sqoGoal ?? '',
    sqoActual: p.sqoActual,
    progressPercent: p.progressPercent ? `${p.progressPercent.toFixed(1)}%` : '',
    totalAumFormatted: p.totalAumFormatted,
    daysElapsed: p.daysElapsed,
    daysInQuarter: p.daysInQuarter,
    expectedSqos: p.expectedSqos.toFixed(1),
    pacingDiff: p.pacingDiff.toFixed(1),
    pacingStatus: p.pacingStatus,
    quarterStartDate: formatDate(p.quarterStartDate),
    quarterEndDate: formatDate(p.quarterEndDate),
  }));

  generateCSV(csvData, columns, `quarterly_progress_${sanitizedName}`);
}

/**
 * Export closed lost records to CSV
 */
export function exportClosedLostCSV(
  records: ClosedLostRecord[],
  sgaName: string
): void {
  const sanitizedName = sgaName.replace(/[^a-zA-Z0-9]/g, '_');
  
  const columns = [
    { key: 'oppName', header: 'Opportunity Name' },
    { key: 'lastContactDate', header: 'Last Contact Date' },
    { key: 'daysSinceContact', header: 'Days Since Contact' },
    { key: 'closedLostDate', header: 'Closed Lost Date' },
    { key: 'sqlDate', header: 'SQL Date' },
    { key: 'closedLostReason', header: 'Closed Lost Reason' },
    { key: 'closedLostDetails', header: 'Closed Lost Details' },
    { key: 'timeSinceContactBucket', header: 'Time Since Contact Bucket' },
    { key: 'leadId', header: 'Lead ID' },
    { key: 'opportunityId', header: 'Opportunity ID' },
    { key: 'leadUrl', header: 'Lead URL' },
    { key: 'opportunityUrl', header: 'Opportunity URL' },
  ];

  // Transform data for CSV (format dates, handle nulls)
  const csvData = records.map(record => ({
    oppName: record.oppName || '',
    lastContactDate: formatDate(record.lastContactDate),
    daysSinceContact: record.daysSinceContact ?? '',
    closedLostDate: formatDate(record.closedLostDate),
    sqlDate: formatDate(record.sqlDate),
    closedLostReason: record.closedLostReason || '',
    closedLostDetails: record.closedLostDetails || '',
    timeSinceContactBucket: record.timeSinceContactBucket || '',
    leadId: record.leadId || '',
    opportunityId: record.opportunityId || '',
    leadUrl: record.leadUrl || '',
    opportunityUrl: record.opportunityUrl || '',
  }));

  generateCSV(csvData, columns, `closed_lost_${sanitizedName}`);
}

/**
 * Export admin SGA overview to CSV
 */
export function exportAdminOverviewCSV(
  overviews: AdminSGAOverview[]
): void {
  const columns = [
    { key: 'userName', header: 'SGA Name' },
    { key: 'userEmail', header: 'Email' },
    { key: 'isActive', header: 'Active' },
    { key: 'weeklyGoalIC', header: 'Week Goal - Initial Calls' },
    { key: 'weeklyGoalQC', header: 'Week Goal - Qualification Calls' },
    { key: 'weeklyGoalSQO', header: 'Week Goal - SQO' },
    { key: 'weeklyActualIC', header: 'Week Actual - Initial Calls' },
    { key: 'weeklyActualQC', header: 'Week Actual - Qualification Calls' },
    { key: 'weeklyActualSQO', header: 'Week Actual - SQO' },
    { key: 'quarterlyGoal', header: 'Quarter Goal - SQO' },
    { key: 'quarterlyActual', header: 'Quarter Actual - SQO' },
    { key: 'quarterlyProgress', header: 'Quarter Progress %' },
    { key: 'quarterlyPacing', header: 'Quarter Pacing Status' },
    { key: 'closedLostCount', header: 'Closed Lost Count' },
    { key: 'missingWeeklyGoal', header: 'Missing Weekly Goal' },
    { key: 'missingQuarterlyGoal', header: 'Missing Quarterly Goal' },
    { key: 'behindPacing', header: 'Behind Pacing' },
  ];

  // Transform data for CSV (flatten nested objects)
  const csvData = overviews.map(overview => ({
    userName: overview.userName,
    userEmail: overview.userEmail,
    isActive: overview.isActive ? 'Yes' : 'No',
    weeklyGoalIC: overview.currentWeekGoal?.initialCallsGoal ?? '',
    weeklyGoalQC: overview.currentWeekGoal?.qualificationCallsGoal ?? '',
    weeklyGoalSQO: overview.currentWeekGoal?.sqoGoal ?? '',
    weeklyActualIC: overview.currentWeekActual?.initialCalls ?? '',
    weeklyActualQC: overview.currentWeekActual?.qualificationCalls ?? '',
    weeklyActualSQO: overview.currentWeekActual?.sqos ?? '',
    quarterlyGoal: overview.currentQuarterGoal?.sqoGoal ?? '',
    quarterlyActual: overview.currentQuarterProgress?.sqoActual ?? '',
    quarterlyProgress: overview.currentQuarterProgress?.progressPercent 
      ? `${overview.currentQuarterProgress.progressPercent.toFixed(1)}%` 
      : '',
    quarterlyPacing: overview.currentQuarterProgress?.pacingStatus ?? '',
    closedLostCount: overview.closedLostCount,
    missingWeeklyGoal: overview.missingWeeklyGoal ? 'Yes' : 'No',
    missingQuarterlyGoal: overview.missingQuarterlyGoal ? 'Yes' : 'No',
    behindPacing: overview.behindPacing ? 'Yes' : 'No',
  }));

  generateCSV(csvData, columns, 'admin_sga_overview');
}
