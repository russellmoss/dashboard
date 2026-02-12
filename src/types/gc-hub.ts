// src/types/gc-hub.ts

/**
 * GC Hub frontend types.
 * API response types (GcPeriodSummary, GcAdvisorRow, GcAdvisorDetail)
 * are defined in src/lib/api-client.ts.
 * This file adds UI-specific types.
 */

// Tab identifiers
export type GcHubTab = 'overview' | 'advisor-detail';

// Sort direction for tables
export type SortDir = 'asc' | 'desc';

// Filter state for the GC Hub
export interface GcHubFilterState {
  startDate: string;         // ISO date "2022-10-01"
  endDate: string;           // ISO date "2026-02-28"
  accountNames: string[];    // Selected teams
  advisorNames: string[];    // Selected advisors (admin only)
  billingFrequency: string;  // "" | "quarterly" | "monthly"
  search: string;            // Free-text search
}

// Filter options returned by /api/gc-hub/filters
export interface GcHubFilterOptions {
  accountNames: string[];
  advisorNames: string[];
  advisorsByAccount: Record<string, string[]>;
  periods: string[];
  billingFrequencies: string[];
}

// Sync status returned by /api/gc-hub/sync-status
export interface GcSyncStatus {
  lastSync: string | null;
  lastSyncType: string | null;
  lastSyncStatus: string | null;
  totalRecords: number;
}

// Override form data
export interface GcOverridePayload {
  recordId: string;
  grossRevenue?: number;
  commissionsPaid?: number;
  reason: string;
}

// Sparkline data point for advisor table
export interface SparklinePoint {
  period: string;
  value: number;
}

// Table sort state
export interface GcTableSortState {
  key: string | null;
  dir: SortDir;
}
