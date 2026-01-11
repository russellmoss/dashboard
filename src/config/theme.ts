/**
 * Centralized Theme Constants
 * 
 * CURSOR AI: Import colors from this file instead of hardcoding.
 * Example: import { CHART_COLORS } from '@/config/theme';
 */

// Colors for Recharts visualizations
export const CHART_COLORS = {
  // Primary palette
  primary: '#3b82f6',      // blue-500
  secondary: '#8b5cf6',    // violet-500
  tertiary: '#06b6d4',     // cyan-500
  quaternary: '#f59e0b',   // amber-500
  quinary: '#10b981',      // emerald-500
  
  // Conversion funnel specific
  contactedToMql: '#3b82f6',   // blue-500
  mqlToSql: '#10b981',         // emerald-500 (matches chart)
  sqlToSqo: '#f59e0b',         // amber-500 (matches chart)
  sqoToJoined: '#8b5cf6',      // violet-500 (matches chart)
  
  // Volume/secondary data
  volume: '#94a3b8',
  volumeLight: '#cbd5e1',
  
  // Grid and axis
  grid: '#e2e8f0',
  gridDark: '#334155',
  axis: '#64748b',
} as const;

// Status colors as Tailwind class combinations
export const STATUS_COLORS = {
  success: {
    bg: 'bg-green-50 dark:bg-green-900/20',
    text: 'text-green-700 dark:text-green-300',
    border: 'border-green-200 dark:border-green-800',
  },
  warning: {
    bg: 'bg-yellow-50 dark:bg-yellow-900/20',
    text: 'text-yellow-700 dark:text-yellow-300',
    border: 'border-yellow-200 dark:border-yellow-800',
  },
  error: {
    bg: 'bg-red-50 dark:bg-red-900/20',
    text: 'text-red-700 dark:text-red-300',
    border: 'border-red-200 dark:border-red-800',
  },
  info: {
    bg: 'bg-blue-50 dark:bg-blue-900/20',
    text: 'text-blue-700 dark:text-blue-300',
    border: 'border-blue-200 dark:border-blue-800',
  },
} as const;

// Thresholds for color-coding rates
export const RATE_THRESHOLDS = {
  excellent: 0.75,
  good: 0.50,
  warning: 0.25,
} as const;

/**
 * Get Tailwind text color class for a conversion rate
 */
export function getRateColorClass(rate: number): string {
  if (rate >= RATE_THRESHOLDS.excellent) {
    return 'text-green-600 dark:text-green-400';
  }
  if (rate >= RATE_THRESHOLDS.good) {
    return 'text-blue-600 dark:text-blue-400';
  }
  if (rate >= RATE_THRESHOLDS.warning) {
    return 'text-yellow-600 dark:text-yellow-400';
  }
  return 'text-red-600 dark:text-red-400';
}
