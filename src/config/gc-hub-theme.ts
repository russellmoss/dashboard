// src/config/gc-hub-theme.ts

/**
 * GC Hub chart color constants.
 * Extends the base CHART_COLORS from @/config/theme.
 * These colors are specific to GC Hub financial charts.
 */
export const GC_CHART_COLORS = {
  revenue: '#3b82f6',        // blue-500 — gross revenue line
  amountEarned: '#10b981',   // emerald-500 — net amount earned line
  commissions: '#f59e0b',    // amber-500 — commissions (used in detail views)
  advisorCount: '#8b5cf6',   // violet-500 — advisor count bars
  revenuePerAdvisor: '#06b6d4', // cyan-500 — revenue per advisor line
  sparklineUp: '#10b981',    // emerald-500 — sparkline trending up
  sparklineDown: '#ef4444',  // red-500 — sparkline trending down
  sparklineFlat: '#6b7280',  // gray-500 — sparkline flat
} as const;

/**
 * Default date range for GC Hub — all historical data.
 * Q4 2022 is the earliest period in the dataset.
 * For endDate, use getDefaultEndDate() so "today" is evaluated at runtime, not at module load.
 */
export const GC_DEFAULT_DATE_RANGE = {
  startDate: '2022-10-01',
} as const;

/** Capital Partner: earliest date they can access (no 2022/2023 data). */
export const GC_CP_MIN_START_DATE = '2024-01-01';

/** Capital Partner: default filter start date. */
export const GC_CP_DEFAULT_START_DATE = '2025-01-01';

/**
 * Returns today's date in ISO date string form (YYYY-MM-DD).
 * Use when initializing filter state: endDate: getDefaultEndDate()
 */
export function getDefaultEndDate(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Rows per page for advisor table pagination.
 */
export const GC_ROWS_PER_PAGE = 50;
