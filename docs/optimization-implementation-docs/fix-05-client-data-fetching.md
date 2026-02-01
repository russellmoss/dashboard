# Fix 05: Client-Side Data Fetching (SWR)

**Priority:** High Impact, Medium Effort
**Estimated Time:** 4-6 hours
**Dependencies:** None
**Risk Level:** Low (additive change, no existing functionality modified)
**Related Investigation:** Phase 1 (Duplicate API Call Investigation), Phase 9.8 (Request Batching)

---

## Problem Summary

The dashboard makes **multiple duplicate API calls** on page loads due to:
1. No request deduplication at the client level
2. React StrictMode double-mounting in development (`reactStrictMode: true` in `next.config.js:6`)
3. Multiple `useEffect` hooks that can trigger simultaneously
4. `useCallback` dependency changes causing effect re-runs

### Current Behavior Analysis

**Investigated Files:**
- `src/app/dashboard/page.tsx` - Main dashboard with all data fetching
- `src/lib/api-client.ts` - API client with no client-side caching
- `next.config.js:6` - React StrictMode enabled

**Current Data Fetching Pattern:**

```typescript
// src/app/dashboard/page.tsx

// Effect 1: Filter options (lines 254-266)
useEffect(() => {
  async function fetchFilterOptions() {
    const data = await dashboardApi.getFilterOptions();
    setFilterOptions(data);
  }
  fetchFilterOptions();
}, []);

// Effect 2: Saved reports + default (lines 733-741)
useEffect(() => {
  async function initializeReports() {
    await fetchSavedReports();  // useCallback dependency
    await loadDefaultReport();   // useCallback dependency
  }
  initializeReports();
}, [fetchSavedReports, loadDefaultReport]);

// Effect 3: Dashboard data (lines 743-747)
useEffect(() => {
  if (filterOptions) {
    fetchDashboardData();  // useCallback dependency
  }
}, [fetchDashboardData, filterOptions]);
```

**Why Duplicates Occur:**

| Cause | Effect | Frequency |
|-------|--------|-----------|
| React StrictMode | Double-mounts all components in dev | Every page load (dev only) |
| useCallback deps changing | Effects re-run when callbacks recreate | On state changes |
| No request deduplication | Each fetch() is independent | Every call |

### Current State

| Item | Status | Location |
|------|--------|----------|
| SWR installed | ❌ No | Not in `package.json` |
| Request deduplication | ❌ No | `src/lib/api-client.ts` uses plain `fetch()` |
| Client-side cache | ❌ No | Each request is independent |
| Custom hooks | ❌ Minimal | Only `src/hooks/useDebounce.ts` exists |
| React StrictMode | ✅ Enabled | `next.config.js:6` |

---

## Solution: Implement SWR

SWR (stale-while-revalidate) provides:
- **Automatic request deduplication** - Multiple components requesting the same data result in one request
- **Client-side caching** - Responses cached with configurable TTL
- **StrictMode compatibility** - Handles double-mounts gracefully
- **Built-in loading/error states** - Cleaner component code
- **Automatic revalidation** - Data stays fresh

---

## Implementation

### Step 1: Install SWR

```bash
npm install swr
```

### Step 2: Create SWR Configuration

Create `src/lib/swr-config.tsx`:

```typescript
'use client';

import { SWRConfig } from 'swr';
import { ReactNode } from 'react';

/**
 * Default fetcher for GET endpoints
 * Matches the pattern in api-client.ts but with SWR integration
 */
export const fetcher = async (url: string) => {
  const res = await fetch(url, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const error = new Error('An error occurred while fetching the data.');
    (error as any).info = await res.json().catch(() => ({}));
    (error as any).status = res.status;
    throw error;
  }

  return res.json();
};

/**
 * POST fetcher for endpoints that require POST method
 * Used for dashboard data endpoints that accept filters
 */
export const postFetcher = async ([url, body]: [string, any]) => {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const error = new Error('An error occurred while fetching the data.');
    (error as any).info = await res.json().catch(() => ({}));
    (error as any).status = res.status;
    throw error;
  }

  return res.json();
};

interface SWRProviderProps {
  children: ReactNode;
}

/**
 * Global SWR configuration provider
 * Wrap your app with this to enable SWR features
 */
export function SWRProvider({ children }: SWRProviderProps) {
  return (
    <SWRConfig
      value={{
        fetcher,
        revalidateOnFocus: false,      // Don't refetch on window focus (reduces noise)
        revalidateOnReconnect: true,   // Refetch when network reconnects
        dedupingInterval: 5000,        // Dedupe requests within 5s window
        errorRetryCount: 2,            // Retry failed requests twice
        shouldRetryOnError: true,
        // Keep previous data while revalidating for smoother UX
        keepPreviousData: true,
      }}
    >
      {children}
    </SWRConfig>
  );
}
```

### Step 3: Add SWR Provider to Layout

Update `src/app/layout.tsx`:

```typescript
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import { SessionProviderWrapper } from '@/components/providers/SessionProviderWrapper';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { SWRProvider } from '@/lib/swr-config';  // ADD THIS
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Savvy GTM Dashboard',
  description: 'GTM Analytics Dashboard',
  icons: {
    icon: '/favicon.svg',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className="overflow-x-hidden">
      <body className={`${inter.className} bg-gray-50 dark:bg-gray-900 transition-colors overflow-x-hidden`}>
        <SessionProviderWrapper>
          <ThemeProvider>
            <SWRProvider>  {/* ADD THIS */}
              {children}
            </SWRProvider>  {/* ADD THIS */}
          </ThemeProvider>
        </SessionProviderWrapper>
        <Analytics />
      </body>
    </html>
  );
}
```

### Step 4: Create Custom Hooks for Saved Reports

Create `src/hooks/use-saved-reports.ts`:

```typescript
'use client';

import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { fetcher } from '@/lib/swr-config';
import { SavedReport, SavedReportInput } from '@/types/saved-reports';

interface SavedReportsResponse {
  userReports: SavedReport[];
  adminTemplates: SavedReport[];
}

// Cache key constants for consistent invalidation
export const SAVED_REPORTS_KEY = '/api/saved-reports';
export const DEFAULT_REPORT_KEY = '/api/saved-reports/default';

/**
 * Hook to fetch all saved reports (user reports + admin templates)
 * Deduplicates requests - safe to call from multiple components
 */
export function useSavedReports() {
  const { data, error, isLoading, mutate } = useSWR<SavedReportsResponse>(
    SAVED_REPORTS_KEY,
    fetcher,
    {
      dedupingInterval: 30000,  // 30 seconds - reports change rarely
      revalidateOnFocus: false,
    }
  );

  return {
    userReports: data?.userReports ?? [],
    adminTemplates: data?.adminTemplates ?? [],
    isLoading,
    error,
    mutate,  // Use to manually revalidate after create/update/delete
  };
}

/**
 * Hook to fetch the user's default report
 */
export function useDefaultReport() {
  const { data, error, isLoading, mutate } = useSWR<{ report: SavedReport | null }>(
    DEFAULT_REPORT_KEY,
    fetcher,
    {
      dedupingInterval: 60000,  // 1 minute
      revalidateOnFocus: false,
    }
  );

  return {
    defaultReport: data?.report ?? null,
    isLoading,
    error,
    mutate,
  };
}

// Mutation helpers for CRUD operations

async function createReportFetcher(
  url: string,
  { arg }: { arg: SavedReportInput }
) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(arg),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to create report');
  }
  return res.json();
}

export function useCreateReport() {
  const { trigger, isMutating, error } = useSWRMutation(
    SAVED_REPORTS_KEY,
    createReportFetcher
  );

  return {
    createReport: trigger,
    isCreating: isMutating,
    error,
  };
}

async function updateReportFetcher(
  url: string,
  { arg }: { arg: { id: string; data: Partial<SavedReportInput> } }
) {
  const res = await fetch(`/api/saved-reports/${encodeURIComponent(arg.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(arg.data),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to update report');
  }
  return res.json();
}

export function useUpdateReport() {
  const { trigger, isMutating, error } = useSWRMutation(
    SAVED_REPORTS_KEY,
    updateReportFetcher
  );

  return {
    updateReport: trigger,
    isUpdating: isMutating,
    error,
  };
}

async function deleteReportFetcher(
  url: string,
  { arg }: { arg: string }
) {
  const res = await fetch(`/api/saved-reports/${encodeURIComponent(arg)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to delete report');
  }
  return res.json();
}

export function useDeleteReport() {
  const { trigger, isMutating, error } = useSWRMutation(
    SAVED_REPORTS_KEY,
    deleteReportFetcher
  );

  return {
    deleteReport: trigger,
    isDeleting: isMutating,
    error,
  };
}
```

### Step 5: Create Custom Hooks for Filter Options

Create `src/hooks/use-filter-options.ts`:

```typescript
'use client';

import useSWR from 'swr';
import { fetcher } from '@/lib/swr-config';
import { FilterOptions } from '@/types/filters';

export const FILTER_OPTIONS_KEY = '/api/dashboard/filters';

/**
 * Hook to fetch filter options (channels, sources, SGAs, SGMs, etc.)
 * These rarely change, so we use a longer deduping interval
 */
export function useFilterOptions() {
  const { data, error, isLoading, mutate } = useSWR<FilterOptions>(
    FILTER_OPTIONS_KEY,
    fetcher,
    {
      dedupingInterval: 60000,  // 1 minute - filter options change rarely
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
    }
  );

  return {
    filterOptions: data ?? null,
    isLoading,
    error,
    mutate,
  };
}
```

### Step 6: Create Custom Hooks for Dashboard Data

Create `src/hooks/use-dashboard-data.ts`:

```typescript
'use client';

import useSWR from 'swr';
import { postFetcher } from '@/lib/swr-config';
import { DashboardFilters, DEFAULT_ADVANCED_FILTERS } from '@/types/filters';
import {
  FunnelMetricsWithGoals,
  ConversionRatesResponse,
  ChannelPerformanceWithGoals,
  SourcePerformanceWithGoals,
  DetailRecord,
  TrendDataPoint,
  ViewMode,
} from '@/types/dashboard';

/**
 * Clean filters object to ensure serialization
 * Matches the pattern in api-client.ts
 */
function cleanFilters(filters: DashboardFilters): DashboardFilters {
  const clean: DashboardFilters = {
    startDate: filters.startDate,
    endDate: filters.endDate,
    datePreset: filters.datePreset,
    year: filters.year,
    channel: filters.channel,
    source: filters.source,
    sga: filters.sga,
    sgm: filters.sgm,
    stage: filters.stage,
    experimentationTag: filters.experimentationTag,
    metricFilter: filters.metricFilter,
  };

  if (filters.advancedFilters) {
    clean.advancedFilters = {
      initialCallScheduled: {
        ...DEFAULT_ADVANCED_FILTERS.initialCallScheduled,
        ...(filters.advancedFilters.initialCallScheduled || {}),
      },
      qualificationCallDate: {
        ...DEFAULT_ADVANCED_FILTERS.qualificationCallDate,
        ...(filters.advancedFilters.qualificationCallDate || {}),
      },
      channels: {
        ...DEFAULT_ADVANCED_FILTERS.channels,
        ...(filters.advancedFilters.channels || {}),
      },
      sources: {
        ...DEFAULT_ADVANCED_FILTERS.sources,
        ...(filters.advancedFilters.sources || {}),
      },
      sgas: {
        ...DEFAULT_ADVANCED_FILTERS.sgas,
        ...(filters.advancedFilters.sgas || {}),
      },
      sgms: {
        ...DEFAULT_ADVANCED_FILTERS.sgms,
        ...(filters.advancedFilters.sgms || {}),
      },
      experimentationTags: {
        ...DEFAULT_ADVANCED_FILTERS.experimentationTags,
        ...(filters.advancedFilters.experimentationTags || {}),
      },
    };
  }

  return clean;
}

/**
 * Create a stable cache key from filters
 * Uses JSON.stringify to create consistent keys
 */
function createCacheKey(endpoint: string, body: object): [string, object] {
  return [endpoint, body];
}

/**
 * Hook for fetching funnel metrics
 */
export function useFunnelMetrics(
  filters: DashboardFilters,
  viewMode?: ViewMode,
  enabled = true
) {
  const body = {
    filters: cleanFilters(filters),
    ...(viewMode && { viewMode }),
  };

  const { data, error, isLoading, mutate } = useSWR(
    enabled ? createCacheKey('/api/dashboard/funnel-metrics', body) : null,
    postFetcher,
    {
      dedupingInterval: 10000,  // 10 seconds
      revalidateOnFocus: false,
    }
  );

  return {
    metrics: data as FunnelMetricsWithGoals | undefined,
    isLoading,
    error,
    mutate,
  };
}

/**
 * Hook for fetching conversion rates and trends
 */
export function useConversionRates(
  filters: DashboardFilters,
  options?: {
    includeTrends?: boolean;
    granularity?: 'month' | 'quarter';
    mode?: 'period' | 'cohort';
  },
  enabled = true
) {
  const body = {
    filters: cleanFilters(filters),
    includeTrends: options?.includeTrends ?? false,
    granularity: options?.granularity ?? 'quarter',
    mode: options?.mode ?? 'cohort',
  };

  const { data, error, isLoading, mutate } = useSWR<{
    rates: ConversionRatesResponse;
    trends: TrendDataPoint[] | null;
  }>(
    enabled ? createCacheKey('/api/dashboard/conversion-rates', body) : null,
    postFetcher,
    {
      dedupingInterval: 10000,
      revalidateOnFocus: false,
    }
  );

  return {
    rates: data?.rates,
    trends: data?.trends ?? [],
    isLoading,
    error,
    mutate,
  };
}

/**
 * Hook for fetching channel performance
 */
export function useChannelPerformance(
  filters: DashboardFilters,
  viewMode?: ViewMode,
  enabled = true
) {
  const body = {
    filters: cleanFilters(filters),
    groupBy: 'channel',
    ...(viewMode && { viewMode }),
  };

  const { data, error, isLoading, mutate } = useSWR<{
    channels: ChannelPerformanceWithGoals[];
  }>(
    enabled ? createCacheKey('/api/dashboard/source-performance', body) : null,
    postFetcher,
    {
      dedupingInterval: 10000,
      revalidateOnFocus: false,
    }
  );

  return {
    channels: data?.channels ?? [],
    isLoading,
    error,
    mutate,
  };
}

/**
 * Hook for fetching source performance
 */
export function useSourcePerformance(
  filters: DashboardFilters,
  viewMode?: ViewMode,
  enabled = true
) {
  const body = {
    filters: cleanFilters(filters),
    groupBy: 'source',
    ...(viewMode && { viewMode }),
  };

  const { data, error, isLoading, mutate } = useSWR<{
    sources: SourcePerformanceWithGoals[];
  }>(
    enabled ? createCacheKey('/api/dashboard/source-performance', body) : null,
    postFetcher,
    {
      dedupingInterval: 10000,
      revalidateOnFocus: false,
    }
  );

  return {
    sources: data?.sources ?? [],
    isLoading,
    error,
    mutate,
  };
}

/**
 * Hook for fetching detail records
 */
export function useDetailRecords(
  filters: DashboardFilters,
  limit = 50000,
  enabled = true
) {
  const body = {
    filters: cleanFilters(filters),
    limit,
  };

  const { data, error, isLoading, mutate } = useSWR<{
    records: DetailRecord[];
  }>(
    enabled ? createCacheKey('/api/dashboard/detail-records', body) : null,
    postFetcher,
    {
      dedupingInterval: 10000,
      revalidateOnFocus: false,
    }
  );

  return {
    records: data?.records ?? [],
    isLoading,
    error,
    mutate,
  };
}
```

---

## Migration Strategy

### Phase 1: Add Infrastructure (Low Risk)
1. Install SWR
2. Create `src/lib/swr-config.tsx`
3. Add SWRProvider to layout
4. Create hook files (empty or with stubs)
5. **Test:** Verify app still works with no functional changes

### Phase 2: Migrate Saved Reports (Medium Risk)
1. Replace saved reports fetching in dashboard page with `useSavedReports()`
2. Replace default report fetching with `useDefaultReport()`
3. Update mutation handlers to use `mutate()` for cache invalidation
4. **Test:** Verify saved reports CRUD operations work

### Phase 3: Migrate Filter Options (Low Risk)
1. Replace filter options fetching with `useFilterOptions()`
2. **Test:** Verify filters populate correctly

### Phase 4: Migrate Dashboard Data (Higher Risk)
1. Replace metrics fetching with `useFunnelMetrics()`
2. Replace conversion rates with `useConversionRates()`
3. Replace channel/source performance with respective hooks
4. Replace detail records with `useDetailRecords()`
5. **Test:** Verify all dashboard data loads correctly

---

## Dashboard Page Changes (Phase 4 Example)

**Before (current pattern):**
```typescript
// src/app/dashboard/page.tsx (lines 194-206)

const [loading, setLoading] = useState(true);
const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);
const [metrics, setMetrics] = useState<FunnelMetricsWithGoals | null>(null);
// ... more useState for each data type

useEffect(() => {
  async function fetchFilterOptions() {
    const data = await dashboardApi.getFilterOptions();
    setFilterOptions(data);
  }
  fetchFilterOptions();
}, []);
```

**After (with SWR):**
```typescript
// src/app/dashboard/page.tsx

import { useFilterOptions } from '@/hooks/use-filter-options';
import { useFunnelMetrics, useConversionRates } from '@/hooks/use-dashboard-data';
import { useSavedReports, useDefaultReport } from '@/hooks/use-saved-reports';

// Replace useState + useEffect with hooks
const { filterOptions, isLoading: filterOptionsLoading } = useFilterOptions();
const { userReports, adminTemplates, mutate: mutateReports } = useSavedReports();
const { defaultReport } = useDefaultReport();

// Dashboard data hooks (enabled when filterOptions is available)
const { metrics, isLoading: metricsLoading } = useFunnelMetrics(
  appliedFilters,
  viewMode,
  !!filterOptions && featureSelection.scorecards.sqls  // Only fetch if needed
);

// Combine loading states
const loading = filterOptionsLoading || metricsLoading;
```

---

## Expected Improvements

### Request Reduction

| Scenario | Before | After | Reduction |
|----------|--------|-------|-----------|
| Page load (dev mode) | 6-12 requests per endpoint | 1 request per endpoint | 80-90% |
| Page load (prod mode) | 3-6 requests per endpoint | 1 request per endpoint | 66-80% |
| Tab focus/blur | New requests | Cached (no request) | 100% |
| Navigation away/back | New requests | Cached (instant) | 100% |

### Performance

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Initial page load | 5-8s | 3-5s | 30-40% |
| Subsequent navigations | 5-8s | <500ms (cache hit) | 90%+ |
| Network requests | Multiple duplicates | Single per endpoint | 70-85% |

### Code Quality

| Aspect | Before | After |
|--------|--------|-------|
| State management | Manual useState + useEffect | Declarative hooks |
| Loading states | Manual boolean tracking | Built-in isLoading |
| Error handling | Manual try/catch | Built-in error state |
| Cache invalidation | Not available | `mutate()` function |
| Request deduplication | None | Automatic |

---

## Verification

### Step 1: Check Network Tab

```bash
npm run dev
# Open browser DevTools → Network tab
# Navigate to dashboard
```

**Before SWR:**
- Multiple requests to `/api/saved-reports`
- Multiple requests to `/api/dashboard/filters`

**After SWR:**
- Single request to each endpoint
- Subsequent navigations show "(from cache)" or no request

### Step 2: Test Deduplication

```javascript
// In browser console, test rapid requests:
for (let i = 0; i < 10; i++) {
  fetch('/api/saved-reports').then(r => console.log('Request', i));
}
// Before: 10 network requests
// After: 1-2 network requests (deduped)
```

### Step 3: Test Cache Behavior

1. Navigate to dashboard
2. Wait for data to load
3. Navigate to Settings page
4. Navigate back to dashboard
5. Check Network tab - should see instant load with no new requests

### Step 4: Test Mutations

1. Create a new saved report
2. Verify it appears in the list immediately (optimistic update)
3. Check Network tab - should see POST then GET to revalidate

---

## Rollback Plan

### Quick Rollback (Keep SWR, Disable Features)

```typescript
// In src/lib/swr-config.tsx, disable caching:
<SWRConfig
  value={{
    fetcher,
    dedupingInterval: 0,        // Disable deduplication
    revalidateOnFocus: true,    // Always revalidate
    revalidateOnReconnect: true,
  }}
>
```

### Full Rollback

```bash
# Revert all changes
git checkout src/app/layout.tsx
git checkout src/app/dashboard/page.tsx
rm src/lib/swr-config.tsx
rm src/hooks/use-saved-reports.ts
rm src/hooks/use-filter-options.ts
rm src/hooks/use-dashboard-data.ts
npm uninstall swr
```

---

## Checklist

### Phase 1: Infrastructure
- [ ] Run `npm install swr`
- [ ] Create `src/lib/swr-config.tsx` with SWRProvider
- [ ] Update `src/app/layout.tsx` to wrap with SWRProvider
- [ ] Verify app starts without errors

### Phase 2: Saved Reports Migration
- [ ] Create `src/hooks/use-saved-reports.ts`
- [ ] Update dashboard page to use `useSavedReports()`
- [ ] Update dashboard page to use `useDefaultReport()`
- [ ] Update mutation handlers to call `mutate()` on success
- [ ] Verify saved reports CRUD works correctly

### Phase 3: Filter Options Migration
- [ ] Create `src/hooks/use-filter-options.ts`
- [ ] Update dashboard page to use `useFilterOptions()`
- [ ] Verify filter dropdowns populate correctly

### Phase 4: Dashboard Data Migration
- [ ] Create `src/hooks/use-dashboard-data.ts`
- [ ] Update dashboard page to use data hooks
- [ ] Remove manual `fetchDashboardData` function
- [ ] Remove related useState declarations
- [ ] Verify all dashboard sections load correctly

### Verification
- [ ] Network tab shows reduced requests
- [ ] No duplicate requests on page load
- [ ] Navigation back to dashboard is instant
- [ ] All existing functionality works
- [ ] No console errors

---

## Alternative: Lighter-Weight Deduplication

If SWR feels too heavy, consider a simpler approach:

### Option A: Request Deduplication Map

Create `src/lib/request-dedup.ts`:

```typescript
const inflightRequests = new Map<string, Promise<any>>();

export async function dedupedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttl = 5000
): Promise<T> {
  if (inflightRequests.has(key)) {
    return inflightRequests.get(key)!;
  }

  const promise = fetcher().finally(() => {
    setTimeout(() => inflightRequests.delete(key), ttl);
  });

  inflightRequests.set(key, promise);
  return promise;
}
```

**Pros:** No new dependency, minimal code
**Cons:** No caching, no automatic revalidation, manual implementation

### Recommendation

SWR is the better choice because:
1. Battle-tested by Vercel (same team as Next.js)
2. Handles edge cases (race conditions, stale data, retries)
3. Integrates well with React's lifecycle
4. Small bundle size (~4KB gzipped)
5. Used by many production Next.js apps

---

## Summary

**Key Findings:**
- Current code uses `useState` + `useEffect` pattern with no deduplication
- React StrictMode causes double-mounting (expected in dev)
- `useCallback` dependencies can cause effect re-runs
- No client-side caching exists

**Recommended Action:**
1. Install SWR (low risk, high reward)
2. Migrate incrementally, starting with saved reports
3. Test each phase before proceeding
4. Keep existing `dashboardApi` for non-hook use cases

**Expected Outcome:**
- 70-85% reduction in network requests
- 30-40% faster initial page load
- Near-instant subsequent navigations
- Cleaner, more maintainable code

---

**Document Version:** 2.0
**Last Updated:** 2026-01-30
**Updated By:** Claude Code
**Status:** Investigation complete - ready for implementation
**For:** Savvy Dashboard Performance Optimization
