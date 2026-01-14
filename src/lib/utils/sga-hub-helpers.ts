// src/lib/utils/sga-hub-helpers.ts

import { QuarterInfo, WeekInfo, QuarterlyProgress } from '@/types/sga-hub';

/**
 * Get the Monday of the week containing the given date
 */
export function getWeekMondayDate(date: Date | string): Date {
  // Parse as local date to avoid timezone issues
  let d: Date;
  if (typeof date === 'string') {
    // Parse YYYY-MM-DD as local date (not UTC)
    const [year, month, day] = date.split('-').map(Number);
    d = new Date(year, month - 1, day);
  } else {
    d = new Date(date);
  }
  d.setHours(0, 0, 0, 0);
  
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Sunday
  const monday = new Date(d.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

/**
 * Get the Sunday of the week containing the given date
 */
export function getWeekSundayDate(date: Date | string): Date {
  const monday = getWeekMondayDate(date);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return sunday;
}

/**
 * Format a week range as "Jan 13 - Jan 19, 2026"
 */
export function formatWeekRange(mondayDate: Date | string): string {
  // Parse as local date to avoid timezone issues
  let monday: Date;
  if (typeof mondayDate === 'string') {
    // Parse YYYY-MM-DD as local date (not UTC)
    const [year, month, day] = mondayDate.split('-').map(Number);
    monday = new Date(year, month - 1, day);
  } else {
    monday = new Date(mondayDate);
  }
  monday.setHours(0, 0, 0, 0);
  
  const sunday = getWeekSundayDate(monday);
  sunday.setHours(0, 0, 0, 0);
  
  const monthFormat = new Intl.DateTimeFormat('en-US', { month: 'short' });
  const dayFormat = new Intl.DateTimeFormat('en-US', { day: 'numeric' });
  const yearFormat = new Intl.DateTimeFormat('en-US', { year: 'numeric' });
  
  const monMonth = monthFormat.format(monday);
  const monDay = dayFormat.format(monday);
  const sunMonth = monthFormat.format(sunday);
  const sunDay = dayFormat.format(sunday);
  const year = yearFormat.format(sunday);
  
  // Same month
  if (monMonth === sunMonth) {
    return `${monMonth} ${monDay} - ${sunDay}, ${year}`;
  }
  // Different months
  return `${monMonth} ${monDay} - ${sunMonth} ${sunDay}, ${year}`;
}

/**
 * Format date as ISO string (YYYY-MM-DD)
 */
export function formatDateISO(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Get quarter string from date (e.g., "2026-Q1")
 */
export function getQuarterFromDate(date: Date | string): string {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth(); // 0-11
  const quarter = Math.floor(month / 3) + 1;
  return `${year}-Q${quarter}`;
}

/**
 * Get quarter info from quarter string
 */
export function getQuarterInfo(quarter: string): QuarterInfo {
  const [yearStr, qStr] = quarter.split('-Q');
  const year = parseInt(yearStr, 10);
  const quarterNumber = parseInt(qStr, 10) as 1 | 2 | 3 | 4;
  
  const startMonth = (quarterNumber - 1) * 3;
  const startDate = new Date(year, startMonth, 1);
  const endDate = new Date(year, startMonth + 3, 0); // Last day of quarter
  
  return {
    quarter,
    label: `Q${quarterNumber} ${year}`,
    startDate: formatDateISO(startDate),
    endDate: formatDateISO(endDate),
    year,
    quarterNumber,
  };
}

/**
 * Get all quarters in a range (for historical view)
 */
export function getQuartersInRange(startQuarter: string, endQuarter: string): string[] {
  const quarters: string[] = [];
  const start = getQuarterInfo(startQuarter);
  const end = getQuarterInfo(endQuarter);
  
  let currentYear = start.year;
  let currentQ = start.quarterNumber;
  
  while (currentYear < end.year || (currentYear === end.year && currentQ <= end.quarterNumber)) {
    quarters.push(`${currentYear}-Q${currentQ}`);
    currentQ++;
    if (currentQ > 4) {
      currentQ = 1;
      currentYear++;
    }
  }
  
  return quarters;
}

/**
 * Calculate quarterly pacing
 */
export function calculateQuarterPacing(
  quarter: string,
  goal: number | null,
  actual: number,
  totalAum: number,
  formatCurrency: (n: number) => string
): QuarterlyProgress {
  const info = getQuarterInfo(quarter);
  const today = new Date();
  const startDate = new Date(info.startDate);
  const endDate = new Date(info.endDate);
  
  // Calculate days
  const daysInQuarter = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const daysElapsed = Math.max(0, Math.min(
    daysInQuarter,
    Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1
  ));
  
  // Calculate pacing
  let expectedSqos = 0;
  let pacingDiff = 0;
  let pacingStatus: 'ahead' | 'on-track' | 'behind' | 'no-goal' = 'no-goal';
  let progressPercent: number | null = null;
  
  if (goal !== null && goal > 0) {
    expectedSqos = Math.round((goal / daysInQuarter) * daysElapsed * 10) / 10; // 1 decimal
    pacingDiff = actual - expectedSqos;
    progressPercent = Math.round((actual / goal) * 100);
    
    if (pacingDiff >= 0.5) {
      pacingStatus = 'ahead';
    } else if (pacingDiff >= -0.5) {
      pacingStatus = 'on-track';
    } else {
      pacingStatus = 'behind';
    }
  }
  
  return {
    quarter,
    quarterLabel: info.label,
    sqoGoal: goal,
    hasGoal: goal !== null,
    sqoActual: actual,
    totalAum,
    totalAumFormatted: formatCurrency(totalAum),
    progressPercent,
    quarterStartDate: info.startDate,
    quarterEndDate: info.endDate,
    daysInQuarter,
    daysElapsed,
    expectedSqos,
    pacingDiff: Math.round(pacingDiff * 10) / 10,
    pacingStatus,
  };
}

/**
 * Get week info for a given Monday date
 */
export function getWeekInfo(mondayDate: Date | string): WeekInfo {
  // Parse as local date to avoid timezone issues
  let monday: Date;
  if (typeof mondayDate === 'string') {
    // Parse YYYY-MM-DD as local date (not UTC)
    const [year, month, day] = mondayDate.split('-').map(Number);
    monday = new Date(year, month - 1, day);
  } else {
    monday = new Date(mondayDate);
  }
  monday.setHours(0, 0, 0, 0);
  
  const sunday = getWeekSundayDate(monday);
  sunday.setHours(0, 0, 0, 0);
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const currentWeekMonday = getWeekMondayDate(today);
  
  const isCurrentWeek = monday.getTime() === currentWeekMonday.getTime();
  const isFutureWeek = monday.getTime() > currentWeekMonday.getTime();
  const isPastWeek = monday.getTime() < currentWeekMonday.getTime();
  
  return {
    weekStartDate: formatDateISO(monday),
    weekEndDate: formatDateISO(sunday),
    label: formatWeekRange(monday),
    isCurrentWeek,
    isFutureWeek,
    isPastWeek,
  };
}

/**
 * Get array of week Monday dates in a range
 */
export function getWeeksInRange(startDate: Date | string, endDate: Date | string): Date[] {
  const weeks: Date[] = [];
  let currentMonday = getWeekMondayDate(startDate);
  const end = new Date(endDate);
  
  while (currentMonday <= end) {
    weeks.push(new Date(currentMonday));
    currentMonday.setDate(currentMonday.getDate() + 7);
  }
  
  return weeks;
}

/**
 * Get default date range for weekly goals view (3 past weeks + current + next week)
 */
export function getDefaultWeekRange(): { startDate: string; endDate: string } {
  const today = new Date();
  const currentMonday = getWeekMondayDate(today);
  
  // 3 weeks before current
  const startMonday = new Date(currentMonday);
  startMonday.setDate(startMonday.getDate() - 21);
  
  // 1 week after current (next week's Sunday)
  const endSunday = new Date(currentMonday);
  endSunday.setDate(endSunday.getDate() + 13); // Current Monday + 13 = next week Sunday
  
  return {
    startDate: formatDateISO(startMonday),
    endDate: formatDateISO(endSunday),
  };
}

/**
 * Get current quarter string
 */
export function getCurrentQuarter(): string {
  return getQuarterFromDate(new Date());
}

/**
 * Validate that a date is a Monday
 */
export function isMonday(date: Date | string): boolean {
  // Parse as local date to avoid timezone issues
  let d: Date;
  if (typeof date === 'string') {
    // Parse YYYY-MM-DD as local date (not UTC)
    const [year, month, day] = date.split('-').map(Number);
    d = new Date(year, month - 1, day);
  } else {
    d = new Date(date);
  }
  d.setHours(0, 0, 0, 0);
  return d.getDay() === 1;
}

/**
 * Parse quarter string and validate
 */
export function parseQuarter(quarter: string): { year: number; quarter: number } | null {
  const match = quarter.match(/^(\d{4})-Q([1-4])$/);
  if (!match) return null;
  return {
    year: parseInt(match[1], 10),
    quarter: parseInt(match[2], 10),
  };
}
