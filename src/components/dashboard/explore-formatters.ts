// Explore-specific formatting helpers
// NOTE: formatExploreNumber is NOT the same as @/lib/utils/date-helpers formatNumber.
// This version abbreviates B/M/K and returns String(value) for NaN.

export function formatExploreNumber(value: unknown): string {
  if (value === null || value === undefined) return '-';
  const num = Number(value);
  if (isNaN(num)) return String(value);

  // Handle billions
  if (num >= 1_000_000_000) {
    return `${(num / 1_000_000_000).toFixed(1)}B`;
  }
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}K`;
  }
  return num.toLocaleString();
}

export function formatCellValue(value: unknown, type: string, isAumMetric?: boolean): string {
  if (value === null || value === undefined) return '-';

  // Handle date objects from BigQuery (DATE fields can return as { value: string })
  if (typeof value === 'object' && value !== null && 'value' in value) {
    const dateValue = typeof value.value === 'string' ? value.value : String(value.value);
    // Extract date part (YYYY-MM-DD) if it includes time
    const dateStr = dateValue.split('T')[0];
    // Format as readable date (e.g., "Jan 15, 2025")
    try {
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
      }
    } catch {
      // Fallback to raw string if parsing fails
    }
    return dateStr;
  }

  // Handle date strings (YYYY-MM-DD format)
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const dateStr = value.split('T')[0];
    try {
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
      }
    } catch {
      // Fallback to raw string if parsing fails
    }
    return dateStr;
  }

  if (typeof value === 'number') {
    if (type.toLowerCase().includes('rate') || type.toLowerCase().includes('percent')) {
      return `${value.toFixed(1)}%`;
    }
    // Format AUM values as currency in the data table
    if (isAumMetric) {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(value);
    }
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  return String(value);
}
