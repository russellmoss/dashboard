// src/types/sgm-hub.ts

/**
 * SGM Hub tab identifiers
 * Phase 1: only 'leaderboard' is active
 * Phase 2+: 'dashboard' and 'quota-tracking' will be implemented
 */
export type SGMHubTab = 'leaderboard' | 'dashboard' | 'quota-tracking';

/**
 * SGM Leaderboard entry — one row per SGM
 * Ranked by joinedAum descending
 */
export interface SGMLeaderboardEntry {
  sgmName: string;
  joinedCount: number;
  joinedAum: number;            // Raw number for sorting/ranking
  joinedAumFormatted: string;   // Pre-formatted display string e.g. "$458.0M"
  rank: number;                 // Calculated after query, ties share rank
}

/**
 * Filters for SGM Leaderboard API
 * Mirrors SGA LeaderboardFilters but with sgmNames instead of sgaNames
 */
export interface SGMLeaderboardFilters {
  startDate: string;       // YYYY-MM-DD (quarter start)
  endDate: string;         // YYYY-MM-DD (quarter end)
  channels: string[];      // Required, non-empty. Default: ALL channels
  sources?: string[];      // Optional; omit = all sources
  sgmNames?: string[];     // Optional; omit = all active SGMs
}

/**
 * SGM option for filter picklist
 */
export interface SGMOption {
  value: string;
  label: string;
  isActive: boolean;
}

// ============================================
// Phase 2: Dashboard Tab Types
// ============================================

/**
 * Filters for SGM Dashboard tab
 * Uses date range (not quarter) since it mirrors Funnel Performance
 */
export interface SGMDashboardFilters {
  startDate: string;        // YYYY-MM-DD
  endDate: string;          // YYYY-MM-DD
  channels: string[];       // Required, non-empty
  sources?: string[];       // Optional; omit = all sources
  sgmNames?: string[];      // Optional; omit = all active SGMs
}

/**
 * Dashboard tab metrics — standard funnel + ARR additions
 */
export interface SGMDashboardMetrics {
  // Standard 7 from Funnel Performance Focused View
  sqls: number;
  sqos: number;
  signed: number;
  signedAum: number;
  joined: number;
  joinedAum: number;
  openPipelineAum: number;
  // ARR additions
  actualArr: number;          // SUM(Actual_ARR__c) from joined records
  arrCoverageCount: number;   // n= advisors with Actual_ARR__c
  estimatedArr: number;       // SUM(SGM_Estimated_ARR__c) from active pipeline
  estimatedArrCount: number;  // n= pipeline records with SGM_Estimated_ARR__c
}

/**
 * Quarterly conversion trend data point for cohorted charts
 */
export interface SGMConversionTrend {
  quarter: string;           // "2025-Q1" format (lexicographic sortable)
  sqlCount: number;
  sqoCount: number;
  joinedCount: number;
  sqlToSqoRate: number;      // Calculated JS-side via safeDiv
  sqoToJoinedRate: number;   // Calculated JS-side via safeDiv
  sqlToSqoNumer: number;
  sqlToSqoDenom: number;
  sqoToJoinedNumer: number;
  sqoToJoinedDenom: number;
}

// ============================================
// Phase 3: Quota Tracking Tab Types
// ============================================

/**
 * Pacing status for SGM quota tracking
 * Same status values as SGA, but tolerance band is ±15% instead of ±0.5 SQOs
 */
export type SGMPacingStatus = 'ahead' | 'on-track' | 'behind' | 'no-goal';

/**
 * Single SGM's quota tracking data for a quarter
 * Used by SGMQuotaTrackingView (SGM user view)
 */
export interface SGMQuotaProgress {
  sgmName: string;
  quarter: string;             // "2026-Q1"
  quarterLabel: string;        // "Q1 2026"
  actualArr: number;           // COALESCE(Actual_ARR__c, Account_Total_ARR__c)
  isEstimate: boolean;         // true when using Account_Total_ARR__c fallback
  quotaArr: number;            // from SGMQuarterlyGoal.arrGoal
  hasQuota: boolean;           // quotaArr > 0
  joinedCount: number;         // count of is_joined_unique = 1 for the quarter
  progressPercent: number | null;  // (actualArr / quotaArr) * 100
  expectedArr: number;         // linear pacing target for days elapsed
  pacingDiff: number;          // actualArr - expectedArr
  pacingDiffPercent: number;   // pacingDiff / expectedArr * 100 (for display)
  pacingStatus: SGMPacingStatus;
  projectedArr: number;        // (actualArr / daysElapsed) * daysInQuarter
  daysElapsed: number;
  daysInQuarter: number;
  quarterStartDate: string;    // YYYY-MM-DD
  quarterEndDate: string;      // YYYY-MM-DD
}

/**
 * Open opportunity row for SGM quota tracking view
 * Represents a single open recruiting opportunity
 */
export interface SGMOpenOpp {
  primaryKey: string;          // primary_key (Lead or Opp ID — used by RecordDetailModal)
  opportunityId: string;       // Full_Opportunity_ID__c
  advisorName: string;
  daysOpen: number;            // from CreateDate to today
  daysOpenStatus: 'green' | 'yellow' | 'orange' | 'red';
  currentStage: string;        // StageName
  daysInStage: number | null;  // null when stage entry timestamp is null (~9.5% of Qualifying)
  daysInStageStatus: 'green' | 'yellow' | 'orange' | 'red' | null;
  aum: number;                 // COALESCE(Underwritten_AUM__c, Amount)
  aumFormatted: string;
  estimatedArr: number | null; // SGM_Estimated_ARR__c (null if not set)
  estimatedArrFormatted: string;
  salesforceUrl: string;
}

/**
 * Per-SGM row for admin breakdown table
 * Shows each SGM's open pipeline and quota progress
 */
export interface SGMAdminBreakdown {
  sgmName: string;
  userEmail: string;
  openOpps: number;            // count of all open opportunities
  openOpps90Plus: number;      // count of opps open 90+ days
  openAum: number;             // sum of Opportunity_AUM for open opps
  openAumFormatted: string;
  openArr: number;             // sum of SGM_Estimated_ARR__c for open opps
  openArrFormatted: string;
  quotaArr: number;            // from SGMQuarterlyGoal
  actualArr: number;           // joined ARR for the quarter
  progressPercent: number | null;
  pacingStatus: SGMPacingStatus;
}

/**
 * Team aggregate for admin view header
 */
export interface SGMTeamProgress {
  quarter: string;
  quarterLabel: string;
  totalActualArr: number;
  totalQuotaArr: number;
  progressPercent: number | null;
  expectedArr: number;
  pacingDiff: number;
  pacingStatus: SGMPacingStatus;
  daysElapsed: number;
  daysInQuarter: number;
}

/**
 * Single quota record (one per SGM per quarter — flat array, 48 entries for 12 SGMs × 4 quarters)
 * SGMQuotaTable groups this flat array by SGM for display (rows = SGMs, columns = quarters)
 */
export interface SGMQuotaEntry {
  id?: string;
  userEmail: string;
  sgmName: string;             // display name, looked up from User or SGM options
  quarter: string;             // "2026-Q1"
  arrGoal: number;
  updatedBy?: string | null;
}

/**
 * Per-quarter data point for historical chart
 */
export interface SGMHistoricalQuarter {
  quarter: string;             // "2025-Q1"
  quarterLabel: string;        // "Q1 2025"
  actualArr: number;           // COALESCE(Actual_ARR__c, Account_Total_ARR__c)
  isEstimate: boolean;         // true when using fallback
  goalArr: number | null;      // from SGMQuarterlyGoal, null if no goal set
  joinedCount: number;
}

/**
 * Filters for admin quota tracking view
 */
export interface SGMQuotaFilters {
  quarter: string;             // "2026-Q1"
  sgmNames?: string[];
  channels?: string[];
  sources?: string[];
  pacingStatuses?: SGMPacingStatus[];
}
