import { DataFreshnessStatus } from '@/types/dashboard';

/**
 * Formats minutes ago into human-readable relative time
 * @param minutesAgo - Number of minutes ago
 * @returns Human-readable string like "Just now", "5 minutes ago", "2 hours ago", "3 days ago"
 */
export function formatRelativeTime(minutesAgo: number): string {
  if (minutesAgo < 1) {
    return 'Just now';
  }
  if (minutesAgo < 60) {
    return `${Math.floor(minutesAgo)} minute${minutesAgo >= 2 ? 's' : ''} ago`;
  }
  
  const hoursAgo = Math.floor(minutesAgo / 60);
  if (hoursAgo < 24) {
    return `${hoursAgo} hour${hoursAgo >= 2 ? 's' : ''} ago`;
  }
  
  const daysAgo = Math.floor(hoursAgo / 24);
  return `${daysAgo} day${daysAgo >= 2 ? 's' : ''} ago`;
}

/**
 * Formats ISO timestamp to user's local timezone
 * Output format: "Jan 16, 2026 at 3:39 PM"
 * @param isoTimestamp - ISO 8601 timestamp string (e.g., "2026-01-16T20:39:22.827Z")
 * @param locale - Optional locale string (defaults to user's browser locale)
 * @returns Formatted date/time string in user's local timezone
 */
export function formatAbsoluteTime(isoTimestamp: string, locale?: string): string {
  const date = new Date(isoTimestamp);
  
  // Format: "Jan 16, 2026, 3:39 PM" -> "Jan 16, 2026 at 3:39 PM"
  const formatted = date.toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  
  // Replace the comma before time with " at"
  return formatted.replace(/,(\s+\d+:\d+)/, ' at$1');
}

/**
 * Returns Tailwind CSS classes for status indicator colors
 * Supports both light and dark mode
 * @param status - Data freshness status
 * @returns Object with bg, text, and dot color classes
 */
export function getStatusColor(status: DataFreshnessStatus): {
  bg: string;
  text: string;
  dot: string;
} {
  switch (status) {
    case 'fresh':
      return {
        bg: 'bg-green-50 dark:bg-green-900/20',
        text: 'text-green-700 dark:text-green-400',
        dot: 'bg-green-500',
      };
    case 'recent':
      return {
        bg: 'bg-yellow-50 dark:bg-yellow-900/20',
        text: 'text-yellow-700 dark:text-yellow-400',
        dot: 'bg-yellow-500',
      };
    case 'stale':
      return {
        bg: 'bg-orange-50 dark:bg-orange-900/20',
        text: 'text-orange-700 dark:text-orange-400',
        dot: 'bg-orange-500',
      };
    case 'very_stale':
      return {
        bg: 'bg-red-50 dark:bg-red-900/20',
        text: 'text-red-700 dark:text-red-400',
        dot: 'bg-red-500',
      };
    default:
      return {
        bg: 'bg-gray-50 dark:bg-gray-900/20',
        text: 'text-gray-700 dark:text-gray-400',
        dot: 'bg-gray-500',
      };
  }
}

/**
 * Returns lucide-react icon name for status
 * Note: This returns the icon name as a string. The component should import and use the actual icon component.
 * @param status - Data freshness status
 * @returns Icon name string (e.g., 'CheckCircle', 'Clock', 'AlertCircle', 'AlertTriangle')
 */
export function getStatusIcon(status: DataFreshnessStatus): string {
  switch (status) {
    case 'fresh':
      return 'CheckCircle';
    case 'recent':
      return 'Clock';
    case 'stale':
      return 'AlertCircle';
    case 'very_stale':
      return 'AlertTriangle';
    default:
      return 'HelpCircle';
  }
}
