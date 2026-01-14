// src/types/sga-hub.ts

/**
 * SGA Hub Feature Types
 * Types for weekly goals, quarterly progress, and closed lost tracking
 */

// ============================================================================
// WEEKLY GOALS
// ============================================================================

/** Weekly goal from database */
export interface WeeklyGoal {
  id: string;
  userEmail: string;
  weekStartDate: string; // ISO date string (Monday)
  initialCallsGoal: number;
  qualificationCallsGoal: number;
  sqoGoal: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

/** Weekly goal input for create/update */
export interface WeeklyGoalInput {
  weekStartDate: string; // ISO date string (Monday)
  initialCallsGoal: number;
  qualificationCallsGoal: number;
  sqoGoal: number;
}

/** Weekly actuals from BigQuery */
export interface WeeklyActual {
  weekStartDate: string; // ISO date string (Monday) - YYYY-MM-DD format
  initialCalls: number;
  qualificationCalls: number;
  sqos: number;
}

/** Combined goal and actual for display */
export interface WeeklyGoalWithActuals {
  weekStartDate: string;
  weekEndDate: string; // Sunday
  weekLabel: string; // e.g., "Jan 13 - Jan 19, 2026"
  
  // Goals (null if not set)
  initialCallsGoal: number | null;
  qualificationCallsGoal: number | null;
  sqoGoal: number | null;
  
  // Actuals
  initialCallsActual: number;
  qualificationCallsActual: number;
  sqoActual: number;
  
  // Differences (null if goal not set)
  initialCallsDiff: number | null;
  qualificationCallsDiff: number | null;
  sqoDiff: number | null;
  
  // Status
  hasGoal: boolean;
  canEdit: boolean; // SGAs can only edit current/future weeks; Admins can edit any week
}

// ============================================================================
// QUARTERLY GOALS & PROGRESS
// ============================================================================

/** Quarterly goal from database */
export interface QuarterlyGoal {
  id: string;
  userEmail: string;
  quarter: string; // "2026-Q1" format
  sqoGoal: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

/** Quarterly goal input for create/update */
export interface QuarterlyGoalInput {
  userEmail: string;
  quarter: string;
  sqoGoal: number;
}

/** Quarterly progress with pacing */
export interface QuarterlyProgress {
  quarter: string;
  quarterLabel: string; // "Q1 2026"
  
  // Goal
  sqoGoal: number | null;
  hasGoal: boolean;
  
  // Actuals
  sqoActual: number;
  totalAum: number;
  totalAumFormatted: string;
  
  // Progress percentage (actual / goal * 100)
  progressPercent: number | null;
  
  // Pacing
  quarterStartDate: string;
  quarterEndDate: string;
  daysInQuarter: number;
  daysElapsed: number;
  expectedSqos: number; // Prorated based on days elapsed
  pacingDiff: number; // actual - expected (positive = ahead, negative = behind)
  pacingStatus: 'ahead' | 'on-track' | 'behind' | 'no-goal';
}

/** SQO detail record for quarterly progress table */
export interface SQODetail {
  id: string; // primary_key
  advisorName: string;
  sqoDate: string;
  aum: number;
  aumFormatted: string;
  aumTier: string;
  channel: string;
  source: string;
  stageName: string;
  leadUrl: string | null;
  opportunityUrl: string | null;
  salesforceUrl: string;
}

// ============================================================================
// CLOSED LOST
// ============================================================================

/** Time bucket for closed lost filtering */
export type ClosedLostTimeBucket = 
  | '30-60' 
  | '60-90' 
  | '90-120' 
  | '120-150' 
  | '150-180'
  | '180+'
  | 'all';

/** Closed lost record from BigQuery view */
export interface ClosedLostRecord {
  id: string; // Full_Opportunity_ID__c
  primaryKey: string; // primary_key from vw_funnel_master for RecordDetailModal
  oppName: string;
  leadId: string | null;
  opportunityId: string;
  leadUrl: string | null;
  opportunityUrl: string;
  salesforceUrl: string;
  lastContactDate: string;
  closedLostDate: string;
  sqlDate: string;
  closedLostReason: string;
  closedLostDetails: string | null;
  timeSinceContactBucket: string;
  daysSinceContact: number;
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

/** GET /api/sga-hub/weekly-goals query params */
export interface WeeklyGoalsQueryParams {
  startDate?: string; // ISO date
  endDate?: string; // ISO date
}

/** POST /api/sga-hub/weekly-goals request body */
export interface WeeklyGoalsPostBody extends WeeklyGoalInput {
  // Inherits weekStartDate, initialCallsGoal, qualificationCallsGoal, sqoGoal
}

/** GET /api/sga-hub/weekly-actuals query params */
export interface WeeklyActualsQueryParams {
  startDate?: string;
  endDate?: string;
}

/** GET /api/sga-hub/closed-lost query params */
export interface ClosedLostQueryParams {
  timeBuckets?: ClosedLostTimeBucket[]; // Multi-select
}

/** GET /api/sga-hub/quarterly-progress query params */
export interface QuarterlyProgressQueryParams {
  quarters?: string[]; // Multi-select, e.g., ["2026-Q1", "2025-Q4"]
}

/** GET /api/admin/sga-overview query params */
export interface AdminSGAOverviewQueryParams {
  weekStartDate?: string;
  quarter?: string;
}

/** Admin SGA overview response item */
export interface AdminSGAOverview {
  userEmail: string;
  userName: string;
  isActive: boolean;
  
  // Current week
  currentWeekGoal: WeeklyGoal | null;
  currentWeekActual: WeeklyActual | null;
  
  // Current quarter
  currentQuarterGoal: QuarterlyGoal | null;
  currentQuarterProgress: QuarterlyProgress | null;
  
  // Closed lost count
  closedLostCount: number;
  
  // Alerts
  missingWeeklyGoal: boolean;
  missingQuarterlyGoal: boolean;
  behindPacing: boolean;
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

/** Quarter info helper */
export interface QuarterInfo {
  quarter: string; // "2026-Q1"
  label: string; // "Q1 2026"
  startDate: string;
  endDate: string;
  year: number;
  quarterNumber: 1 | 2 | 3 | 4;
}

/** Week info helper */
export interface WeekInfo {
  weekStartDate: string; // Monday ISO date
  weekEndDate: string; // Sunday ISO date
  label: string; // "Jan 13 - Jan 19, 2026"
  isCurrentWeek: boolean;
  isFutureWeek: boolean;
  isPastWeek: boolean;
}
