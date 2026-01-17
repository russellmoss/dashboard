# Multi-Layer Caching Strategy - Implementation Plan

## Document Status: ✅ Ready for Agentic Execution

**Last Updated**: January 16, 2026  
**Purpose**: Implement Next.js `unstable_cache()` with tags for all BigQuery API routes

---

## Execution Rules

**CRITICAL**: Complete each phase fully and verify before proceeding to the next phase.

1. **Run `npm run build` after each phase** to verify no TypeScript errors
2. **Test locally** after Phase 2 (query functions) to ensure caching works
3. **Commit after each phase** for safe rollback points
4. **Do not skip validation steps** - they prevent production issues

---

## Rollback Instructions

If caching causes issues in production:

1. **Immediate rollback**: Revert the last commit
   ```bash
   git revert HEAD
   git push
   ```

2. **Partial rollback**: Remove caching from specific files
   - Remove `cachedQuery()` wrapper from affected query function
   - Restore original function export

3. **Full rollback**: Remove all caching changes
   ```bash
   git revert <commit-hash-range>
   ```

4. **Cache invalidation**: If stale cache is the issue, manually call:
   - Admin endpoint: `POST /api/admin/refresh-cache`
   - Or wait for TTL expiration (12 hours)

---

## Overview

This plan implements a comprehensive caching strategy using Next.js App Router's `unstable_cache()` with:
- **12-hour TTL** for most routes (43200 seconds)
- **6-hour TTL** for detail-records (21600 seconds) - shorter due to large result sets (up to 95k rows)
- **Tag-based invalidation** via `revalidateTag()`
- **Manual refresh endpoint** for admins
- **Scheduled invalidation** via Vercel Cron (Fridays 3-6pm EST)

---

## Key Decisions

| Decision | Choice | Reasoning |
|----------|--------|-----------|
| **Caching Strategy** | `unstable_cache()` with tags | Simple, built-in, supports on-demand invalidation |
| **TTL** | 12 hours (6 hours for detail-records) | Aligns with data transfer schedule (24h normal, hourly on Fridays) |
| **Cache Key Generation** | Automatic via Next.js serialization | No manual key generation needed - Next.js handles function arguments |
| **Cache Miss Logging** | Yes | Log cache misses for monitoring |
| **CRON_SECRET** | Auto-injected by Vercel | No need to manually set in environment |

---

## Implementation Phases

| Phase | Description | Files | Verification |
|-------|-------------|-------|--------------|
| **Phase 0** | Verify prerequisites | Check existing files | Confirm dependencies exist |
| **Phase 1** | Create cache utilities | `src/lib/cache.ts` | `npm run build` |
| **Phase 2** | Update query functions | All files in `src/lib/queries/` | `npm run build`, test locally |
| **Phase 3** | Update API routes | Remove `force-dynamic` from 2 files | `npm run build` |
| **Phase 4** | Admin refresh endpoint | `src/app/api/admin/refresh-cache/route.ts` | `npm run build` |
| **Phase 5** | Vercel Cron endpoint | `src/app/api/cron/friday-refresh/route.ts` | `npm run build` |
| **Phase 6** | Update vercel.json | `vercel.json` | Verify JSON syntax |
| **Phase 7** | Update DataFreshnessIndicator | `src/components/dashboard/DataFreshnessIndicator.tsx` | `npm run build` |
| **Phase 8** | Update API client | `src/lib/api-client.ts` | `npm run build` |

---

## PHASE 0: Verify Prerequisites

**Purpose**: Confirm all required dependencies exist before starting implementation

### Step 0.1: Verify Logger

**File**: `src/lib/logger.ts`

**Check**:
- [ ] File exists
- [ ] Exports `logger` object
- [ ] Has methods: `logger.debug()`, `logger.info()`, `logger.warn()`, `logger.error()`

**If missing**: Do not proceed - logger is required for cache miss logging.

### Step 0.2: Verify Auth

**File**: `src/lib/auth.ts`

**Check**:
- [ ] File exists
- [ ] Exports `authOptions` object
- [ ] Compatible with `getServerSession(authOptions)`

**If missing**: Do not proceed - auth is required for admin endpoint.

### Step 0.3: Verify Permissions

**File**: `src/lib/permissions.ts`

**Check**:
- [ ] File exists
- [ ] Exports `getUserPermissions(email: string)` function
- [ ] Function is **async** (returns `Promise<UserPermissions>`)
- [ ] Returns object with `role: 'admin' | 'manager' | 'sga' | 'sgm' | 'viewer'`

**If missing**: Do not proceed - permissions are required for admin endpoint.

**Note**: `getUserPermissions` is async, so Phase 4 must use `await`.

### Step 0.4: Verify Session Permissions (Frontend)

**File**: `src/types/auth.ts`

**Check**:
- [ ] File exists
- [ ] Exports `getSessionPermissions(session)` function
- [ ] Returns `UserPermissions | null` with `role` property

**If missing**: Do not proceed - needed for Phase 7 (refresh button).

**Validation**:
- ✅ All prerequisite files exist
- ✅ All required exports are present
- ✅ Ready to proceed to Phase 1

---

## PHASE 1: Create Cache Utilities

### Step 1.1: Create `src/lib/cache.ts`

**Purpose**: Centralized cache configuration and wrapper function

**Key Features**:
- Cache tag constants (`CACHE_TAGS.DASHBOARD`, `CACHE_TAGS.SGA_HUB`)
- Default TTL constant (43200 seconds = 12 hours)
- `cachedQuery()` wrapper function with:
  - Explicit `keyName` parameter (instead of `fn.name` for arrow functions)
  - Cache miss logging
  - Type-safe generic wrapper

**Complete File Content**:
```typescript
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
```

**Validation**:
- [ ] File created at `src/lib/cache.ts`
- [ ] Exports `CACHE_TAGS`, `DEFAULT_CACHE_TTL`, `DETAIL_RECORDS_TTL`
- [ ] `cachedQuery()` function with explicit `keyName` parameter
- [ ] Cache miss logging included
- [ ] Type-safe generic wrapper
- [ ] Run `npm run build` - should pass with no errors

**If build fails**: Fix TypeScript errors before proceeding.

---

## PHASE 2: Update Query Functions

**CRITICAL**: This phase modifies many files. Complete one file at a time and verify it compiles.

### Transformation Pattern

**BEFORE** (example from `src/lib/queries/funnel-metrics.ts`):
```typescript
import { runQuery, buildQueryParams } from '../bigquery';
import { FunnelMetrics } from '@/types/dashboard';
// ... other imports ...

export async function getFunnelMetrics(filters: DashboardFilters): Promise<FunnelMetrics> {
  // ... function body ...
}
```

**AFTER**:
```typescript
import { runQuery, buildQueryParams } from '../bigquery';
import { FunnelMetrics } from '@/types/dashboard';
import { cachedQuery, CACHE_TAGS } from '@/lib/cache';
// ... other imports ...

// Extract function body to internal function
const _getFunnelMetrics = async (filters: DashboardFilters): Promise<FunnelMetrics> => {
  // ... same function body (no changes to logic) ...
};

// Export cached version
export const getFunnelMetrics = cachedQuery(
  _getFunnelMetrics,
  'getFunnelMetrics',
  CACHE_TAGS.DASHBOARD
);
```

**Key Points**:
1. Add import: `import { cachedQuery, CACHE_TAGS } from '@/lib/cache';`
2. Rename original function to `_functionName` (internal)
3. Export wrapped version: `export const functionName = cachedQuery(...)`
4. Keep all function logic unchanged

### Files to Update (Group A - Dashboard, 12-hour TTL):

#### 2.1: `src/lib/queries/funnel-metrics.ts`

**Changes**:
1. Add import: `import { cachedQuery, CACHE_TAGS } from '@/lib/cache';`
2. Rename `getFunnelMetrics` to `_getFunnelMetrics`
3. Add export: `export const getFunnelMetrics = cachedQuery(_getFunnelMetrics, 'getFunnelMetrics', CACHE_TAGS.DASHBOARD);`

**Validation**: `npm run build` should pass.

#### 2.2: `src/lib/queries/conversion-rates.ts`

**Changes**:
1. Add import: `import { cachedQuery, CACHE_TAGS } from '@/lib/cache';`
2. Find `getConversionRates` function
3. Rename to `_getConversionRates`
4. Add export: `export const getConversionRates = cachedQuery(_getConversionRates, 'getConversionRates', CACHE_TAGS.DASHBOARD);`

**Validation**: `npm run build` should pass.

#### 2.3: `src/lib/queries/source-performance.ts`

**Changes**:
1. Add import: `import { cachedQuery, CACHE_TAGS } from '@/lib/cache';`
2. Find `getChannelPerformance` function - rename to `_getChannelPerformance`
3. Find `getSourcePerformance` function - rename to `_getSourcePerformance`
4. Add exports:
   ```typescript
   export const getChannelPerformance = cachedQuery(_getChannelPerformance, 'getChannelPerformance', CACHE_TAGS.DASHBOARD);
   export const getSourcePerformance = cachedQuery(_getSourcePerformance, 'getSourcePerformance', CACHE_TAGS.DASHBOARD);
   ```

**Validation**: `npm run build` should pass.

#### 2.4: `src/lib/queries/detail-records.ts`

**Changes**:
1. Add import: `import { cachedQuery, CACHE_TAGS, DETAIL_RECORDS_TTL } from '@/lib/cache';`
2. Rename `getDetailRecords` to `_getDetailRecords`
3. Add export: `export const getDetailRecords = cachedQuery(_getDetailRecords, 'getDetailRecords', CACHE_TAGS.DASHBOARD, DETAIL_RECORDS_TTL);`
4. **Note**: Uses `DETAIL_RECORDS_TTL` (6 hours) instead of default

**Validation**: `npm run build` should pass.

#### 2.5: `src/lib/queries/drill-down.ts`

**Changes**:
1. Add import: `import { cachedQuery, CACHE_TAGS } from '@/lib/cache';`
2. Find all exported functions (e.g., `getDrillDownRecords`, etc.)
3. For each function:
   - Rename to `_functionName`
   - Add export: `export const functionName = cachedQuery(_functionName, 'functionName', CACHE_TAGS.DASHBOARD);`

**Validation**: `npm run build` should pass.

#### 2.6: `src/lib/queries/data-freshness.ts`

**Changes**:
1. Add import: `import { cachedQuery, CACHE_TAGS } from '@/lib/cache';`
2. Rename `getDataFreshness` to `_getDataFreshness`
3. Add export: `export const getDataFreshness = cachedQuery(_getDataFreshness, 'getDataFreshness', CACHE_TAGS.DASHBOARD);`

**Validation**: `npm run build` should pass.

#### 2.7: `src/lib/queries/open-pipeline.ts`

**Changes**:
1. Add import: `import { cachedQuery, CACHE_TAGS } from '@/lib/cache';`
2. Rename `getOpenPipelineAum` to `_getOpenPipelineAum`
3. Add export: `export const getOpenPipelineAum = cachedQuery(_getOpenPipelineAum, 'getOpenPipelineAum', CACHE_TAGS.DASHBOARD);`

**Validation**: `npm run build` should pass.

#### 2.8: `src/lib/queries/forecast-goals.ts`

**Changes**:
1. Add import: `import { cachedQuery, CACHE_TAGS } from '@/lib/cache';`
2. Rename `getAggregateForecastGoals` to `_getAggregateForecastGoals`
3. Add export: `export const getAggregateForecastGoals = cachedQuery(_getAggregateForecastGoals, 'getAggregateForecastGoals', CACHE_TAGS.DASHBOARD);`

**Validation**: `npm run build` should pass.

#### 2.9: `src/lib/queries/record-detail.ts`

**Changes**:
1. Add import: `import { cachedQuery, CACHE_TAGS } from '@/lib/cache';`
2. Rename `getRecordDetail` to `_getRecordDetail`
3. Add export: `export const getRecordDetail = cachedQuery(_getRecordDetail, 'getRecordDetail', CACHE_TAGS.DASHBOARD);`

**Validation**: `npm run build` should pass.

### Files to Update (Group B - SGA Hub, 12-hour TTL):

#### 2.10: `src/lib/queries/weekly-actuals.ts`

**Changes**:
1. Add import: `import { cachedQuery, CACHE_TAGS } from '@/lib/cache';`
2. Find all exported SGA Hub functions
3. For each function:
   - Rename to `_functionName`
   - Add export: `export const functionName = cachedQuery(_functionName, 'functionName', CACHE_TAGS.SGA_HUB);`

**Validation**: `npm run build` should pass.

#### 2.11: `src/lib/queries/quarterly-progress.ts`

**Changes**:
1. Add import: `import { cachedQuery, CACHE_TAGS } from '@/lib/cache';`
2. Find all exported SGA Hub functions
3. For each function:
   - Rename to `_functionName`
   - Add export: `export const functionName = cachedQuery(_functionName, 'functionName', CACHE_TAGS.SGA_HUB);`

**Validation**: `npm run build` should pass.

#### 2.12: `src/lib/queries/sqo-details.ts`

**Changes**:
1. Add import: `import { cachedQuery, CACHE_TAGS } from '@/lib/cache';`
2. Find all exported SGA Hub functions
3. For each function:
   - Rename to `_functionName`
   - Add export: `export const functionName = cachedQuery(_functionName, 'functionName', CACHE_TAGS.SGA_HUB);`

**Validation**: `npm run build` should pass.

#### 2.13: `src/lib/queries/closed-lost.ts`

**Changes**:
1. Add import: `import { cachedQuery, CACHE_TAGS } from '@/lib/cache';`
2. Find all exported SGA Hub functions
3. For each function:
   - Rename to `_functionName`
   - Add export: `export const functionName = cachedQuery(_functionName, 'functionName', CACHE_TAGS.SGA_HUB);`

**Validation**: `npm run build` should pass.

#### 2.14: `src/lib/queries/re-engagement.ts`

**Changes**:
1. Add import: `import { cachedQuery, CACHE_TAGS } from '@/lib/cache';`
2. Find all exported SGA Hub functions
3. For each function:
   - Rename to `_functionName`
   - Add export: `export const functionName = cachedQuery(_functionName, 'functionName', CACHE_TAGS.SGA_HUB);`

**Validation**: `npm run build` should pass.

### Files to NOT Cache:

- **`src/lib/queries/agent-query.ts`** (if exists) - Dynamic SQL exploration, should always be fresh
- **`src/lib/queries/export-records.ts`** - Export operations should not be cached

**Final Validation**:
- [ ] All query functions wrapped with `cachedQuery()`
- [ ] Correct cache tags applied (DASHBOARD vs SGA_HUB)
- [ ] `detail-records` uses `DETAIL_RECORDS_TTL` (6 hours)
- [ ] All other routes use `DEFAULT_CACHE_TTL` (12 hours)
- [ ] Explicit `keyName` provided for each function
- [ ] Run `npm run build` - should pass with no errors
- [ ] Test locally: `npm run dev` - verify dashboard loads without errors

**If build fails**: Fix TypeScript errors before proceeding.

**If runtime errors**: Check that function signatures match (parameters, return types).

---

## PHASE 3: Update API Routes

**Purpose**: Remove `force-dynamic` to allow caching

### Files to Update (Explicit List):

#### 3.1: `src/app/api/dashboard/filters/route.ts`

**Current state**: Has `export const dynamic = 'force-dynamic';`

**Changes**:
1. Remove line: `export const dynamic = 'force-dynamic';`
2. No other changes needed (caching handled at query function level)

**Validation**: `npm run build` should pass.

#### 3.2: `src/app/api/dashboard/data-freshness/route.ts`

**Current state**: Has `export const dynamic = 'force-dynamic';` and manual `Cache-Control` headers

**Changes**:
1. Remove line: `export const dynamic = 'force-dynamic';`
2. Remove `Cache-Control` headers from `NextResponse.json()` call (caching handled by `unstable_cache()`)

**Before**:
```typescript
return NextResponse.json(freshness, {
  headers: {
    'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
  },
});
```

**After**:
```typescript
return NextResponse.json(freshness);
```

**Validation**: `npm run build` should pass.

### Files to Check (May Not Have `force-dynamic`):

These files should NOT have `force-dynamic` (if they do, remove it):
- `src/app/api/dashboard/funnel-metrics/route.ts`
- `src/app/api/dashboard/conversion-rates/route.ts`
- `src/app/api/dashboard/source-performance/route.ts`
- `src/app/api/dashboard/detail-records/route.ts`
- `src/app/api/dashboard/drill-down/route.ts`
- `src/app/api/dashboard/open-pipeline/route.ts`
- `src/app/api/dashboard/forecast/route.ts`
- `src/app/api/dashboard/record-detail/route.ts`

**Note**: If any of these files have `export const dynamic = 'force-dynamic';`, remove it.

**Final Validation**:
- [ ] `force-dynamic` removed from `filters/route.ts`
- [ ] `force-dynamic` removed from `data-freshness/route.ts`
- [ ] Manual `Cache-Control` headers removed from `data-freshness/route.ts`
- [ ] All other routes checked (no `force-dynamic` present)
- [ ] Run `npm run build` - should pass with no errors

---

## PHASE 4: Admin Refresh Endpoint

### Step 4.1: Create `src/app/api/admin/refresh-cache/route.ts`

**Purpose**: Admin-only endpoint to manually invalidate all caches

**Complete File Content**:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { revalidateTag } from 'next/cache';
import { CACHE_TAGS } from '@/lib/cache';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = await getUserPermissions(session.user?.email || '');
    if (permissions.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Invalidate both cache tags
    revalidateTag(CACHE_TAGS.DASHBOARD);
    revalidateTag(CACHE_TAGS.SGA_HUB);

    logger.info('[Cache Refresh] Admin cache invalidation', {
      user: session.user?.email,
      tags: [CACHE_TAGS.DASHBOARD, CACHE_TAGS.SGA_HUB],
    });

    return NextResponse.json({
      success: true,
      message: 'Cache invalidated successfully',
      tags: [CACHE_TAGS.DASHBOARD, CACHE_TAGS.SGA_HUB],
    });
  } catch (error) {
    logger.error('Error refreshing cache:', error);
    return NextResponse.json(
      { error: 'Failed to refresh cache' },
      { status: 500 }
    );
  }
}
```

**Validation**:
- [ ] File created at `src/app/api/admin/refresh-cache/route.ts`
- [ ] Admin-only access enforced
- [ ] Both cache tags invalidated
- [ ] Logging included
- [ ] Error handling complete
- [ ] Run `npm run build` - should pass with no errors

---

## PHASE 5: Vercel Cron Endpoint

### Step 5.1: Create `src/app/api/cron/friday-refresh/route.ts`

**Purpose**: Scheduled cache invalidation on Fridays 3-6pm EST (hourly)

**Complete File Content**:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { CACHE_TAGS } from '@/lib/cache';
import { logger } from '@/lib/logger';

export async function GET(request: NextRequest) {
  try {
    // Validate CRON_SECRET (auto-injected by Vercel)
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
      logger.warn('[Cron] CRON_SECRET not configured');
      return NextResponse.json({ error: 'Cron not configured' }, { status: 500 });
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
      logger.warn('[Cron] Invalid CRON_SECRET');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Invalidate both cache tags
    revalidateTag(CACHE_TAGS.DASHBOARD);
    revalidateTag(CACHE_TAGS.SGA_HUB);

    logger.info('[Cron] Friday refresh cache invalidation', {
      tags: [CACHE_TAGS.DASHBOARD, CACHE_TAGS.SGA_HUB],
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      message: 'Cache invalidated successfully',
      tags: [CACHE_TAGS.DASHBOARD, CACHE_TAGS.SGA_HUB],
    });
  } catch (error) {
    logger.error('Error in cron refresh:', error);
    return NextResponse.json(
      { error: 'Failed to refresh cache' },
      { status: 500 }
    );
  }
}
```

**Note**: Vercel auto-injects `CRON_SECRET` - no need to manually set in `.env.example`

**Validation**:
- [ ] File created at `src/app/api/cron/friday-refresh/route.ts`
- [ ] CRON_SECRET validation
- [ ] Both cache tags invalidated
- [ ] Logging included
- [ ] Error handling complete
- [ ] Run `npm run build` - should pass with no errors

---

## PHASE 6: Update vercel.json

### Step 6.1: Add Cron Configuration

**File**: `vercel.json`

**Current Content**:
```json
{
  "functions": {
    "src/app/api/export-sheets/route.ts": {
      "maxDuration": 60
    },
    "src/app/api/agent/query/route.ts": {
      "maxDuration": 60
    }
  }
}
```

**Updated Content**:
```json
{
  "functions": {
    "src/app/api/export-sheets/route.ts": {
      "maxDuration": 60
    },
    "src/app/api/agent/query/route.ts": {
      "maxDuration": 60
    }
  },
  "crons": [
    {
      "path": "/api/cron/friday-refresh",
      "schedule": "0 20,21,23 * * 5"
    }
  ]
}
```

**Schedule Explanation**:
- `0 20,21,23 * * 5` = 8pm, 9pm, and 11pm UTC on Fridays
- EST is UTC-5: 3pm, 4pm, 6pm EST
- Aligned with BigQuery Friday data transfers:
  - 3pm EST → after EST transfer (2:37pm)
  - 4pm EST → after CT transfer (3:37pm)
  - 6pm EST → after PST transfer (5:37pm)
- Only 3 targeted invalidations instead of hourly, each timed to when fresh data is available
- **Note**: During Daylight Saving Time (March-November), EST becomes EDT (UTC-4), so the cron runs 4pm, 5pm, 7pm EDT instead of 3pm, 4pm, 6pm. This is acceptable as it still aligns with data transfer windows.

**Validation**:
- [ ] `crons` array added to `vercel.json`
- [ ] Schedule matches Friday data transfer times (3pm, 4pm, 6pm EST)
- [ ] JSON syntax is valid (no trailing commas)
- [ ] Run `npm run build` - should pass with no errors

---

## PHASE 7: Update DataFreshnessIndicator

### Step 7.1: Add Refresh Button

**File**: `src/components/dashboard/DataFreshnessIndicator.tsx`

**Purpose**: Add admin-only "Refresh Data" button that calls cache refresh endpoint

**Complete Component Changes**:

**Add to imports** (top of file, after existing imports)**:
```typescript
import { useSession } from 'next-auth/react';
import { getSessionPermissions } from '@/types/auth';
```

**Note**: `RefreshCw` is already imported in this file (line 4: `import { CheckCircle, Clock, AlertCircle, AlertTriangle, RefreshCw } from 'lucide-react';`), so no need to add it again.

**Add state** (inside component, after existing state):
```typescript
const [isRefreshing, setIsRefreshing] = useState(false);
```

**Add refresh handler** (inside component, after `fetchFreshness` function):
```typescript
const handleRefresh = async () => {
  setIsRefreshing(true);
  try {
    const response = await fetch('/api/admin/refresh-cache', {
      method: 'POST',
    });
    
    if (response.ok) {
      // Show success message in console (no toast library available)
      console.log('Cache refreshed successfully');
      // Optionally refetch data freshness
      await fetchFreshness();
    } else {
      const errorData = await response.json().catch(() => ({}));
      console.error('Failed to refresh cache:', errorData.error || 'Unknown error');
    }
  } catch (error) {
    console.error('Error refreshing cache:', error);
  } finally {
    setIsRefreshing(false);
  }
};
```

**Add admin check** (inside component, after session):
```typescript
const { data: session } = useSession();
const permissions = getSessionPermissions(session);
const isAdmin = permissions?.role === 'admin';
```

**Update detailed variant JSX** (replace the detailed variant return statement):
```typescript
// Detailed variant
return (
  <div className={`flex items-center gap-2 ${className}`}>
    <div 
      className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs ${colors.bg} ${colors.text}`}
      title={`Data is ${freshness!.status.replace('_', ' ')}`}
    >
      <StatusIcon status={freshness!.status} />
      <span>
        Last synced: <span className="font-medium">{absoluteTime}</span>
      </span>
      {freshness!.isStale && (
        <span className="text-[10px] uppercase tracking-wide opacity-75">
          (stale)
        </span>
      )}
    </div>
    {isAdmin && (
      <button
        onClick={handleRefresh}
        disabled={isRefreshing}
        className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
        title="Refresh cache (admin only)"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
        <span>{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
      </button>
    )}
  </div>
);
```

**Note**: No toast library is available in the codebase, so we use `console.log` for feedback. The button shows loading state via `isRefreshing`.

**Validation**:
- [ ] Refresh button visible for admin users only
- [ ] Button calls admin refresh endpoint
- [ ] Loading state handled (spinning icon, disabled state)
- [ ] Success/error feedback (console logs)
- [ ] Run `npm run build` - should pass with no errors
- [ ] Test locally: Verify button appears for admin users only

---

## PHASE 8: Update API Client

### Step 8.1: Add `refreshCache()` Method

**File**: `src/lib/api-client.ts`

**Purpose**: Add typed method for cache refresh

**Changes**:

**Find the `dashboardApi` object** (around line 107).

**Add new method** (inside `dashboardApi` object, after existing methods):
```typescript
refreshCache: () =>
  apiFetch<{ success: boolean; message: string; tags: string[] }>(
    '/api/admin/refresh-cache',
    { method: 'POST' }
  ),
```

**Complete example** (showing context):
```typescript
export const dashboardApi = {
  getFilterOptions: () => apiFetch<FilterOptions>('/api/dashboard/filters'),

  getFunnelMetrics: (filters: DashboardFilters, viewMode?: ViewMode) =>
    apiFetch<FunnelMetricsWithGoals>('/api/dashboard/funnel-metrics', {
      method: 'POST',
      body: JSON.stringify({ filters, ...(viewMode && { viewMode }) }),
    }),

  // ... other existing methods ...

  refreshCache: () =>
    apiFetch<{ success: boolean; message: string; tags: string[] }>(
      '/api/admin/refresh-cache',
      { method: 'POST' }
    ),
};
```

**Validation**:
- [ ] `refreshCache()` method added to `dashboardApi` object
- [ ] Returns typed response
- [ ] Method signature matches endpoint response
- [ ] Run `npm run build` - should pass with no errors

---

## Testing Checklist

### Phase 0: Prerequisites
- [x] All prerequisite files exist and have required exports

### Phase 1: Cache Utilities
- [ ] `src/lib/cache.ts` created with all exports
- [ ] `cachedQuery()` function works with explicit `keyName`
- [ ] Cache miss logging works
- [ ] `npm run build` passes

### Phase 2: Query Functions
- [ ] All query functions wrapped with `cachedQuery()`
- [ ] `detail-records` uses 6-hour TTL
- [ ] All other routes use 12-hour TTL
- [ ] Correct cache tags applied
- [ ] `npm run build` passes
- [ ] Local test: Dashboard loads without errors

### Phase 3: API Routes
- [ ] `force-dynamic` removed from `filters/route.ts`
- [ ] `force-dynamic` removed from `data-freshness/route.ts`
- [ ] Manual `Cache-Control` headers removed
- [ ] All other routes checked
- [ ] `npm run build` passes

### Phase 4: Admin Refresh
- [ ] Admin endpoint accessible only to admins
- [ ] Both cache tags invalidated
- [ ] Logging works
- [ ] `npm run build` passes

### Phase 5: Vercel Cron
- [ ] Cron endpoint validates `CRON_SECRET`
- [ ] Both cache tags invalidated
- [ ] Logging works
- [ ] `npm run build` passes

### Phase 6: vercel.json
- [ ] Cron configuration added
- [ ] Schedule matches Friday 3-6pm EST
- [ ] JSON syntax valid
- [ ] `npm run build` passes

### Phase 7: DataFreshnessIndicator
- [ ] Refresh button visible for admins only
- [ ] Button calls refresh endpoint
- [ ] Loading/success/error states work
- [ ] `npm run build` passes
- [ ] Local test: Button appears for admin users

### Phase 8: API Client
- [ ] `refreshCache()` method added
- [ ] Method works correctly
- [ ] `npm run build` passes

### Integration Testing
- [ ] First request to cached endpoint = cache miss (logged in console)
- [ ] Second request with same params = cache hit (no log)
- [ ] Different params = different cache entry
- [ ] Admin refresh invalidates cache
- [ ] Next request after refresh = cache miss (logged)
- [ ] Detail records uses 6-hour TTL (verify in logs)

---

## Environment Variables

### No New Variables Required

- `CRON_SECRET` is auto-injected by Vercel (no need to add to `.env.example`)

---

## Summary

This implementation adds comprehensive caching to all BigQuery API routes using Next.js `unstable_cache()` with:
- **Automatic cache key generation** from function arguments
- **Tag-based invalidation** for on-demand refresh
- **12-hour TTL** (6-hour for detail-records)
- **Admin refresh endpoint** for manual invalidation
- **Scheduled invalidation** on Fridays 3-6pm EST
- **Cache miss logging** for monitoring

All changes are backward-compatible and require no frontend changes (except the optional refresh button).

---

## Rollback Instructions (Reminder)

If issues occur:

1. **Immediate**: `git revert HEAD && git push`
2. **Partial**: Remove `cachedQuery()` from affected files
3. **Full**: Revert all commits in this implementation
4. **Cache**: Manually call `/api/admin/refresh-cache` or wait for TTL expiration
