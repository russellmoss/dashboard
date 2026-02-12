// src/lib/gc-hub/formatters.ts

/**
 * GC Hub display formatters.
 * Used by all chart and table components.
 */

/**
 * Format a number as USD currency.
 * formatCurrency(1234567.89) → "$1,234,568"
 * formatCurrency(1234567.89, true) → "$1.2M"
 */
export function formatCurrency(value: number | null | undefined, compact = false): string {
  if (value == null) return '—';
  if (compact) {
    if (Math.abs(value) >= 1_000_000) {
      return `$${(value / 1_000_000).toFixed(1)}M`;
    }
    if (Math.abs(value) >= 1_000) {
      return `$${(value / 1_000).toFixed(0)}K`;
    }
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Format a number with commas.
 * formatNumber(1234) → "1,234"
 */
export function formatNumber(value: number | null | undefined): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('en-US').format(value);
}

/**
 * Format a period string for display.
 * "2024-Q3" → "Q3 2024"
 * "2026-Jan" → "Jan 2026"
 * "2026-Feb" → "Feb 2026"
 */
export function formatPeriodLabel(period: string): string {
  // Quarterly format: "2024-Q3" → "Q3 2024"
  const qMatch = period.match(/^(\d{4})-Q(\d)$/);
  if (qMatch) return `Q${qMatch[2]} ${qMatch[1]}`;

  // Monthly format: "2026-Jan" → "Jan 2026"
  const mMatch = period.match(/^(\d{4})-(\w+)$/);
  if (mMatch) return `${mMatch[2]} ${mMatch[1]}`;

  return period;
}

/**
 * Format an ISO date string as a short date.
 * "2024-01-15T00:00:00.000Z" → "Jan 15, 2024"
 */
export function formatDate(isoDate: string | null | undefined): string {
  if (!isoDate) return '—';
  return new Date(isoDate).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Format a relative time string.
 * "2026-02-12T06:30:00.000Z" → "2 hours ago"
 */
export function formatRelativeTime(isoDate: string | null | undefined): string {
  if (!isoDate) return 'Never';
  const now = new Date();
  const then = new Date(isoDate);
  const diffMs = now.getTime() - then.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return formatDate(isoDate);
}

/**
 * Calculate percentage change between two values.
 * percentChange(100, 120) → 20
 * percentChange(100, 80) → -20
 */
export function percentChange(previous: number, current: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}
