import { unstable_cache } from 'next/cache';
import { logger } from '@/lib/logger';

/**
 * Cache tags for invalidation
 * 
 * Use these tags to invalidate related cache entries:
 * - DASHBOARD: All main dashboard routes (funnel-metrics, conversion-rates, etc.)
 * - SGA_HUB: All SGA Hub routes (weekly-actuals, quarterly-progress, etc.)
 */
export const CACHE_TAGS = {
  DASHBOARD: 'dashboard',
  SGA_HUB: 'sga-hub',
} as const;

/**
 * Default cache TTL: 12 hours (43200 seconds)
 * 
 * Aligns with BigQuery data transfer schedule:
 * - Normal: 24-hour transfers
 * - Fridays 3-6pm EST: Hourly transfers
 * - Future: 12-hour transfers + on-demand
 */
export const DEFAULT_CACHE_TTL = 43200; // 12 hours in seconds

/**
 * Detail records cache TTL: 6 hours (21600 seconds)
 * 
 * Shorter TTL due to large result sets (up to 95k rows).
 * This balances performance gains with memory considerations.
 */
export const DETAIL_RECORDS_TTL = 21600; // 6 hours in seconds

/**
 * Wrapper for unstable_cache with consistent configuration
 * 
 * Cache keys are automatically generated from:
 * - keyName (explicit identifier - required as arrow functions don't have names)
 * - Function arguments (serialized by Next.js)
 * 
 * Different parameter combinations automatically get different cache keys:
 * - getFunnelMetrics({ channel: 'Web' }) → Cache Key A
 * - getFunnelMetrics({ channel: 'Paid Search' }) → Cache Key B
 * - getFunnelMetrics({ channel: 'Web', viewMode: 'fullFunnel' }) → Cache Key C
 * 
 * @param fn - Async function to cache
 * @param keyName - Explicit cache key name (required, as arrow functions don't have names)
 * @param tag - Cache tag for invalidation (use CACHE_TAGS.DASHBOARD or CACHE_TAGS.SGA_HUB)
 * @param ttl - Time to live in seconds (default: 12 hours, use DETAIL_RECORDS_TTL for detail-records)
 * @returns Cached version of the function
 * 
 * @example
 * ```typescript
 * export const getFunnelMetrics = cachedQuery(
 *   async (filters: DashboardFilters) => {
 *     // ... query logic
 *   },
 *   'getFunnelMetrics',
 *   CACHE_TAGS.DASHBOARD
 * );
 * 
 * // Different filters = different cache keys automatically
 * getFunnelMetrics({ channel: 'Web' }) // Cache key A
 * getFunnelMetrics({ channel: 'Paid Search' }) // Cache key B
 * ```
 */
export function cachedQuery<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  keyName: string,
  tag: string,
  ttl: number = DEFAULT_CACHE_TTL
): T {
  const cachedFn = unstable_cache(
    async (...args: Parameters<T>) => {
      // Log cache miss for monitoring
      logger.debug(`[Cache Miss] ${keyName}`, { 
        keyName,
        tag,
        argsCount: args.length,
        // Log first arg if it's an object (filters), but truncate for large objects
        firstArg: args[0] && typeof args[0] === 'object' 
          ? JSON.stringify(args[0]).substring(0, 200) 
          : args[0],
      });
      return fn(...args);
    },
    [keyName],
    {
      tags: [tag],
      revalidate: ttl,
    }
  ) as T;

  return cachedFn;
}
