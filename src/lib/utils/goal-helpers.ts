// src/lib/utils/goal-helpers.ts
// Helper functions for goal variance calculations and formatting

import { GoalVariance } from '@/types/dashboard';

/**
 * Calculate variance between actual and goal values
 */
export function calculateVariance(actual: number, goal: number): GoalVariance {
  const difference = actual - goal;
  const percentVariance = goal > 0 ? (difference / goal) * 100 : 0;
  
  return {
    actual,
    goal,
    difference,
    percentVariance,
    isOnTrack: actual >= goal,
  };
}

/**
 * Format variance for display
 * Returns something like "+3 (+15.2%)" or "-2 (-10.5%)"
 */
export function formatVariance(variance: GoalVariance, decimalPlaces: number = 1): string {
  const diffSign = variance.difference >= 0 ? '+' : '';
  const pctSign = variance.percentVariance >= 0 ? '+' : '';
  
  const diffStr = `${diffSign}${variance.difference.toFixed(decimalPlaces)}`;
  const pctStr = `${pctSign}${variance.percentVariance.toFixed(1)}%`;
  
  return `${diffStr} (${pctStr})`;
}

/**
 * Format just the numeric difference with sign
 */
export function formatDifference(difference: number, decimalPlaces: number = 1): string {
  const sign = difference >= 0 ? '+' : '';
  return `${sign}${difference.toFixed(decimalPlaces)}`;
}

/**
 * Format just the percent variance with sign
 */
export function formatPercentVariance(percentVariance: number): string {
  const sign = percentVariance >= 0 ? '+' : '';
  return `${sign}${percentVariance.toFixed(1)}%`;
}

/**
 * Get color class based on whether on track
 * Returns Tailwind classes for text color
 */
export function getVarianceColorClass(isOnTrack: boolean): string {
  return isOnTrack 
    ? 'text-green-600 dark:text-green-400' 
    : 'text-red-600 dark:text-red-400';
}

/**
 * Get background color class based on whether on track
 * Returns Tailwind classes for background color (subtle)
 */
export function getVarianceBgClass(isOnTrack: boolean): string {
  return isOnTrack
    ? 'bg-green-50 dark:bg-green-900/20'
    : 'bg-red-50 dark:bg-red-900/20';
}

/**
 * Get Tremor Badge color based on whether on track
 */
export function getVarianceBadgeColor(isOnTrack: boolean): 'green' | 'red' {
  return isOnTrack ? 'green' : 'red';
}
