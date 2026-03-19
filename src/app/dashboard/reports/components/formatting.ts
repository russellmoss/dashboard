'use client';

export function isAumLike(value: string): boolean {
  return /\baum\b|deal size|volume lost|lost volume|pipeline/i.test(value);
}

export function isPercentLike(value: string): boolean {
  return /growth|rate|share|conversion|pct|percent/i.test(value);
}

function formatCurrencyFromDollars(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toLocaleString()}`;
}

export function formatCurrencyCompact(value: number, assumeMillions: boolean = false): string {
  return formatCurrencyFromDollars(assumeMillions ? value * 1_000_000 : value);
}

export function shouldTreatCurrencyAsMillions(value: number, hint?: string): boolean {
  if (!Number.isFinite(value)) return false;
  if (!hint || !isAumLike(hint)) return false;
  return Math.abs(value) < 100_000;
}

export function formatReportingValue(
  value: unknown,
  format?: string,
  hint?: string
): string {
  if (value == null) return '-';
  if (typeof value === 'string') return value;
  if (typeof value !== 'number') return String(value);

  switch (format) {
    case 'currency':
      return formatCurrencyCompact(value, shouldTreatCurrencyAsMillions(value, hint));
    case 'percent':
      return `${value.toFixed(1)}%`;
    case 'number':
      if (hint && isAumLike(hint)) {
        return formatCurrencyCompact(value, true);
      }
      return value.toLocaleString();
    default:
      if (hint && isAumLike(hint)) {
        return formatCurrencyCompact(value, true);
      }
      if (hint && isPercentLike(hint) && Math.abs(value) <= 10_000) {
        return `${value.toFixed(1)}%`;
      }
      return value.toLocaleString();
  }
}
