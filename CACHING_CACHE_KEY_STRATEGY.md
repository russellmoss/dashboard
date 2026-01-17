# Cache Key Generation Strategy for Parameterized Queries

## How `unstable_cache()` Generates Cache Keys

Next.js `unstable_cache()` automatically generates cache keys from:
1. **Function identity**: Hash of the function's source code/signature
2. **Function arguments**: Serialized version of all arguments passed to the cached function
3. **keyParts array** (optional): Additional string identifiers you provide

## For Our Use Case

### Example: `getFunnelMetrics(filters, viewMode?)`

When we wrap this function:
```typescript
const cachedGetFunnelMetrics = unstable_cache(
  async (filters: DashboardFilters, viewMode?: ViewMode) => {
    // ... query logic
  },
  ['getFunnelMetrics'], // keyParts - function name
  { 
    tags: ['dashboard'],
    revalidate: 43200 // 12 hours
  }
);
```

**Cache key generation**:
- Function identity: Hash of the function body
- Arguments: Serialized `filters` object + optional `viewMode`
- keyParts: `['getFunnelMetrics']`

**Result**: Different filter combinations automatically get different cache keys:
- `getFunnelMetrics({ channel: 'Web', year: 2024 })` → Key A
- `getFunnelMetrics({ channel: 'Paid Search', year: 2024 })` → Key B
- `getFunnelMetrics({ channel: 'Web', year: 2024, viewMode: 'fullFunnel' })` → Key C

## Implementation Strategy

### Option 1: Direct Argument Passing (Recommended)

Pass filters directly as function arguments. Next.js will serialize them automatically:

```typescript
// In src/lib/cache.ts
export function cachedQuery<T>(
  fn: (...args: any[]) => Promise<T>,
  tag: string,
  ttl?: number
) {
  return unstable_cache(
    fn,
    [fn.name], // Use function name as keyPart
    {
      tags: [tag],
      revalidate: ttl || DEFAULT_CACHE_TTL,
    }
  );
}

// Usage in funnel-metrics.ts
export const getFunnelMetrics = cachedQuery(
  async (filters: DashboardFilters): Promise<FunnelMetrics> => {
    // ... existing query logic
  },
  CACHE_TAGS.DASHBOARD
);
```

**Pros**:
- Simple, automatic
- Next.js handles serialization
- Different parameters = different keys automatically

**Cons**:
- Relies on Next.js serialization being consistent
- Object property order might matter (though Next.js should handle this)

### Option 2: Normalize Filters Before Caching (More Robust)

Create a normalization function to ensure consistent cache keys:

```typescript
// In src/lib/cache.ts
function normalizeFilters(filters: DashboardFilters): string {
  // Sort object properties, normalize null/undefined, etc.
  // Return stable JSON string
  return JSON.stringify({
    startDate: filters.startDate,
    endDate: filters.endDate,
    datePreset: filters.datePreset,
    year: filters.year,
    channel: filters.channel || null, // Normalize undefined to null
    source: filters.source || null,
    sga: filters.sga || null,
    sgm: filters.sgm || null,
    stage: filters.stage || null,
    experimentationTag: filters.experimentationTag || null,
    metricFilter: filters.metricFilter,
    advancedFilters: filters.advancedFilters || DEFAULT_ADVANCED_FILTERS,
  }, Object.keys(filters).sort()); // Sort keys for consistency
}

export function cachedQuery<T>(
  fn: (...args: any[]) => Promise<T>,
  tag: string,
  ttl?: number,
  normalizeArgs?: (args: any[]) => string[]
) {
  return unstable_cache(
    async (...args: any[]) => {
      return fn(...args);
    },
    normalizeArgs 
      ? normalizeArgs(args) 
      : [fn.name, ...args.map(a => JSON.stringify(a))],
    {
      tags: [tag],
      revalidate: ttl || DEFAULT_CACHE_TTL,
    }
  );
}
```

**Pros**:
- Guaranteed consistent keys
- Handles edge cases (undefined vs null, property order)

**Cons**:
- More complex
- Requires normalization logic for each parameter type

## Recommended Approach

**Use Option 1 (Direct Argument Passing)** with these safeguards:

1. **Always pass filters as a single object parameter** (not spread)
2. **Use consistent filter structure** (always include all properties, use `null` not `undefined`)
3. **Include all parameters in function signature** (don't use closures for dynamic values)

### Example Implementation

```typescript
// src/lib/cache.ts
import { unstable_cache } from 'next/cache';

export const CACHE_TAGS = {
  DASHBOARD: 'dashboard',
  SGA_HUB: 'sga-hub',
} as const;

export const DEFAULT_CACHE_TTL = 43200; // 12 hours in seconds

/**
 * Wrapper for unstable_cache with consistent configuration
 * 
 * @param fn - Async function to cache
 * @param tag - Cache tag for invalidation
 * @param ttl - Time to live in seconds (default: 12 hours)
 * @returns Cached version of the function
 * 
 * Cache keys are automatically generated from:
 * - Function name (from fn.name)
 * - Function arguments (serialized by Next.js)
 * 
 * Example:
 * ```typescript
 * const cachedFn = cachedQuery(
 *   async (filters: DashboardFilters) => { ... },
 *   CACHE_TAGS.DASHBOARD
 * );
 * 
 * // Different filters = different cache keys automatically
 * cachedFn({ channel: 'Web' }) // Cache key A
 * cachedFn({ channel: 'Paid Search' }) // Cache key B
 * ```
 */
export function cachedQuery<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  tag: string,
  ttl: number = DEFAULT_CACHE_TTL
): T {
  return unstable_cache(
    fn,
    [fn.name || 'anonymous'], // Use function name as keyPart
    {
      tags: [tag],
      revalidate: ttl,
    }
  ) as T;
}
```

### For Functions with Multiple Parameters

```typescript
// Example: getConversionRates(filters, mode)
export const getConversionRates = cachedQuery(
  async (
    filters: DashboardFilters,
    mode: 'period' | 'cohort' = 'cohort'
  ): Promise<ConversionRatesResponse> => {
    // ... query logic
  },
  CACHE_TAGS.DASHBOARD
);

// Both parameters are included in cache key:
// getConversionRates({ channel: 'Web' }, 'period') → Key A
// getConversionRates({ channel: 'Web' }, 'cohort') → Key B
// getConversionRates({ channel: 'Paid Search' }, 'period') → Key C
```

### For Functions with Optional Parameters

```typescript
// Example: getFunnelMetrics(filters, viewMode?)
export const getFunnelMetrics = cachedQuery(
  async (
    filters: DashboardFilters,
    viewMode?: ViewMode
  ): Promise<FunnelMetrics> => {
    // ... query logic
  },
  CACHE_TAGS.DASHBOARD
);

// Optional parameters are included if provided:
// getFunnelMetrics({ channel: 'Web' }) → Key A
// getFunnelMetrics({ channel: 'Web' }, 'fullFunnel') → Key B
// getFunnelMetrics({ channel: 'Web' }, undefined) → Key A (same as first)
```

## Testing Cache Key Uniqueness

To verify cache keys work correctly:

1. **Test same filters = same cache**:
   ```typescript
   const filters1 = { channel: 'Web', year: 2024 };
   const filters2 = { channel: 'Web', year: 2024 };
   // Both should hit same cache entry
   ```

2. **Test different filters = different cache**:
   ```typescript
   const filters1 = { channel: 'Web', year: 2024 };
   const filters2 = { channel: 'Paid Search', year: 2024 };
   // Should create different cache entries
   ```

3. **Test property order doesn't matter**:
   ```typescript
   const filters1 = { channel: 'Web', year: 2024 };
   const filters2 = { year: 2024, channel: 'Web' };
   // Should hit same cache (Next.js serialization should handle this)
   ```

## Edge Cases to Handle

1. **undefined vs null**: Normalize to `null` in filter objects
2. **Missing properties**: Use default values (e.g., `DEFAULT_ADVANCED_FILTERS`)
3. **Nested objects**: Next.js serialization handles recursively
4. **Arrays**: Order matters (e.g., `selected: ['A', 'B']` vs `['B', 'A']` are different)

## Summary

**Recommended approach**: Use `unstable_cache()` with direct argument passing. Next.js automatically:
- Serializes function arguments
- Generates unique cache keys per parameter combination
- Handles nested objects and arrays

**No manual cache key generation needed** - Next.js handles it automatically based on function arguments.
