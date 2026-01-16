# Data Freshness Feature - Implementation Plan

## Document Status: ✅ Ready for Agentic Development

**Last Updated**: January 16, 2026  
**Reviewed Against**: 
- Codebase patterns (API routes, components, types)
- BigQuery schema and query results
- Investigation findings from `data_freshness_answers.md`

**Created**: January 16, 2026  
**Purpose**: Step-by-step guide for implementing "Data Last Updated" indicator throughout the dashboard  
**Target Repository**: `C:\Users\russe\Documents\Dashboard`

---

## Overview

This feature adds a "Data Last Updated" indicator that shows users when dashboard data was last synced from Salesforce to BigQuery. This helps users understand data recency and avoid confusion about recent changes not appearing.

### Key Decisions (from Investigation)

| Decision | Choice | Reasoning |
|----------|--------|-----------|
| **Data Source** | `__TABLES__.last_modified_time` | Shows when data was synced, not when records were modified |
| **Tables to Monitor** | Lead, Opportunity | Primary data sources, synced together |
| **Timezone Display** | User's local timezone | Frontend converts UTC to local |
| **Caching** | 5 minutes with stale-while-revalidate | Balance between freshness and BQ costs |

---

## Implementation Phases

| Phase | Description | Estimated Time |
|-------|-------------|----------------|
| **Phase 1** | API Route | 15 min |
| **Phase 2** | Types & Utilities | 10 min |
| **Phase 3** | DataFreshnessIndicator Component | 20 min |
| **Phase 4** | Header Integration | 10 min |
| **Phase 5** | GlobalFilters Integration | 10 min |
| **Phase 6** | Testing & Validation | 15 min |

**Total Estimated Time**: ~80 minutes

**Note**: This plan has been reviewed and adjusted based on:
- Actual BigQuery query results (timestamp format, return types)
- Existing codebase patterns (authentication, API client, component structure)
- Investigation findings confirming `__TABLES__.last_modified_time` is the correct approach

---

## PHASE 1: API Route

### Step 1.1: Create the Data Freshness Query

**Cursor Prompt**:
```
Create a new BigQuery query file at `src/lib/queries/data-freshness.ts` that:

1. Queries the `__TABLES__` metadata table to get last_modified_time for Lead and Opportunity tables
2. Returns the GREATEST (most recent) timestamp between them
3. Calculates hours_ago and minutes_ago from current time
4. Uses the existing BigQuery client pattern from `src/lib/bigquery.ts`

Use this SQL query:
```sql
SELECT 
  MAX(last_data_load) as last_updated,
  TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), MAX(last_data_load), HOUR) as hours_ago,
  TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), MAX(last_data_load), MINUTE) as minutes_ago
FROM (
  SELECT TIMESTAMP_MILLIS(last_modified_time) as last_data_load
  FROM `savvy-gtm-analytics.SavvyGTMData.__TABLES__`
  WHERE table_id IN ('Lead', 'Opportunity')
)
```

Follow the existing query patterns in `src/lib/queries/` for structure and typing.
```

**Expected File**: `src/lib/queries/data-freshness.ts`

**Expected Content**:
```typescript
import { runQuery } from '@/lib/bigquery';

interface RawDataFreshnessResult {
  last_updated: string;  // BigQuery returns TIMESTAMP as ISO string directly
  hours_ago: number | string;  // May be returned as string from BigQuery
  minutes_ago: number | string;  // May be returned as string from BigQuery
}

export interface DataFreshnessResult {
  lastUpdated: string;        // ISO timestamp in UTC
  hoursAgo: number;
  minutesAgo: number;
  isStale: boolean;           // true if > 24 hours
  status: 'fresh' | 'recent' | 'stale' | 'very_stale';
}

export async function getDataFreshness(): Promise<DataFreshnessResult> {
  const query = `
    SELECT 
      MAX(last_data_load) as last_updated,
      TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), MAX(last_data_load), HOUR) as hours_ago,
      TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), MAX(last_data_load), MINUTE) as minutes_ago
    FROM (
      SELECT TIMESTAMP_MILLIS(last_modified_time) as last_data_load
      FROM \`savvy-gtm-analytics.SavvyGTMData.__TABLES__\`
      WHERE table_id IN ('Lead', 'Opportunity')
    )
  `;

  const [result] = await runQuery<RawDataFreshnessResult>(query);
  
  // BigQuery may return numbers as strings, so convert safely
  const hoursAgo = typeof result.hours_ago === 'string' ? parseInt(result.hours_ago, 10) : (result.hours_ago || 0);
  const minutesAgo = typeof result.minutes_ago === 'string' ? parseInt(result.minutes_ago, 10) : (result.minutes_ago || 0);
  
  // Determine status based on age
  let status: DataFreshnessResult['status'];
  if (hoursAgo < 1) {
    status = 'fresh';
  } else if (hoursAgo < 6) {
    status = 'recent';
  } else if (hoursAgo < 24) {
    status = 'stale';
  } else {
    status = 'very_stale';
  }

  // BigQuery TIMESTAMP is returned as ISO string directly, not wrapped in { value: string }
  return {
    lastUpdated: result.last_updated || new Date().toISOString(),
    hoursAgo,
    minutesAgo,
    isStale: hoursAgo >= 24,
    status,
  };
}
```

---

### Step 1.2: Create the API Route

**Cursor Prompt**:
```
Create a new API route at `src/app/api/dashboard/data-freshness/route.ts` that:

1. Exports a GET handler
2. Calls the `getDataFreshness()` function from `src/lib/queries/data-freshness.ts`
3. Returns JSON response with the freshness data
4. Includes proper error handling following the pattern in other dashboard API routes
5. Sets Cache-Control header for 5 minute caching: `Cache-Control: public, s-maxage=300, stale-while-revalidate=600`

Follow the existing API route patterns in `src/app/api/dashboard/` for structure and error handling.
```

**Expected File**: `src/app/api/dashboard/data-freshness/route.ts`

**Expected Content**:
```typescript
import { NextResponse } from 'next/server';
import { getDataFreshness } from '@/lib/queries/data-freshness';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const freshness = await getDataFreshness();

    return NextResponse.json(freshness, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (error) {
    console.error('Error fetching data freshness:', error);
    return NextResponse.json(
      { error: 'Failed to fetch data freshness' },
      { status: 500 }
    );
  }
}
```

---

### Verification Gate 1: API Route Works

**Cursor Prompt for Validation**:
```
Verify the API route works by:

1. First, use your MCP connection to BigQuery to run this query and record the result:
```sql
SELECT 
  MAX(last_data_load) as last_updated,
  TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), MAX(last_data_load), HOUR) as hours_ago,
  TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), MAX(last_data_load), MINUTE) as minutes_ago
FROM (
  SELECT TIMESTAMP_MILLIS(last_modified_time) as last_data_load
  FROM `savvy-gtm-analytics.SavvyGTMData.__TABLES__`
  WHERE table_id IN ('Lead', 'Opportunity')
)
```

2. Run `npx tsc --noEmit` to check for TypeScript errors
3. Start the dev server with `npm run dev`
4. Test the endpoint by visiting http://localhost:3000/api/dashboard/data-freshness (must be logged in)
5. Compare the API response to the direct BigQuery result - they should match

**Important**: The BigQuery query returns:
- `last_updated`: TIMESTAMP as ISO string (e.g., "2026-01-16T20:39:22.827Z")
- `hours_ago`: INTEGER (may be returned as number or string)
- `minutes_ago`: INTEGER (may be returned as number or string)

If you see a different format, adjust the `RawDataFreshnessResult` interface accordingly.

Record:
- [ ] BigQuery direct query result (timestamp format verified)
- [ ] TypeScript compilation passes
- [ ] API endpoint returns 200 OK (when authenticated)
- [ ] API endpoint returns 401 Unauthorized (when not logged in)
- [ ] API response matches BigQuery result
- [ ] Response includes all expected fields: lastUpdated, hoursAgo, minutesAgo, isStale, status
```

**Pass Criteria**:
- [ ] No TypeScript errors
- [ ] API returns 200 with valid JSON (when authenticated)
- [ ] API returns 401 when not authenticated
- [ ] `lastUpdated` timestamp matches BigQuery result (ISO format: "2026-01-16T20:39:22.827Z")
- [ ] `status` field is one of: fresh, recent, stale, very_stale
- [ ] `hoursAgo` and `minutesAgo` are numbers (not strings)

---

### Step 1.3: Add API Client Method

**Cursor Prompt**:
```
Add a method to the API client for fetching data freshness.

Open `src/lib/api-client.ts` and add this method to the `dashboardApi` object:

```typescript
getDataFreshness: () => apiFetch<DataFreshness>('/api/dashboard/data-freshness'),
```

Make sure to import the `DataFreshness` type from `@/types/dashboard` at the top of the file.
```

**Expected Modification**:
```typescript
// In src/lib/api-client.ts, add to imports:
import { DataFreshness } from '@/types/dashboard';

// In the dashboardApi object, add:
getDataFreshness: () => apiFetch<DataFreshness>('/api/dashboard/data-freshness'),
```

---

## PHASE 2: Types & Utilities

### Step 2.1: Add Types to Dashboard Types

**Cursor Prompt**:
```
Add the DataFreshness types to the existing types file. 

Open `src/types/dashboard.ts` and add these types at the end of the file:

```typescript
// Data Freshness Types
export type DataFreshnessStatus = 'fresh' | 'recent' | 'stale' | 'very_stale';

export interface DataFreshness {
  lastUpdated: string;        // ISO timestamp in UTC
  hoursAgo: number;
  minutesAgo: number;
  isStale: boolean;
  status: DataFreshnessStatus;
}
```

Make sure not to duplicate if similar types already exist.
```

---

### Step 2.2: Create Freshness Formatting Utilities

**Cursor Prompt**:
```
Create a new utility file at `src/lib/utils/freshness-helpers.ts` with these functions:

1. `formatRelativeTime(minutesAgo: number)`: Returns human-readable relative time
   - < 1 minute: "Just now"
   - < 60 minutes: "X minutes ago"
   - < 24 hours: "X hours ago"
   - >= 24 hours: "X days ago"

2. `formatAbsoluteTime(isoTimestamp: string, locale?: string)`: Returns formatted date/time in user's timezone
   - Uses Intl.DateTimeFormat for timezone-aware formatting
   - Format: "Jan 16, 2026 at 3:39 PM"

3. `getStatusColor(status: DataFreshnessStatus)`: Returns Tailwind color classes
   - fresh: green
   - recent: yellow  
   - stale: orange
   - very_stale: red

4. `getStatusIcon(status: DataFreshnessStatus)`: Returns the appropriate icon name from lucide-react
   - fresh: 'CheckCircle'
   - recent: 'Clock'
   - stale: 'AlertCircle'
   - very_stale: 'AlertTriangle'

Include JSDoc comments for each function.
```

**Expected File**: `src/lib/utils/freshness-helpers.ts`

**Expected Content**:
```typescript
import { DataFreshnessStatus } from '@/types/dashboard';

/**
 * Formats minutes ago into human-readable relative time
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
 * Output: "Jan 16, 2026 at 3:39 PM"
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
```

---

### Verification Gate 2: Types & Utilities Compile

**Cursor Prompt for Validation**:
```
Verify the types and utilities are correct:

1. Run `npx tsc --noEmit` to check for TypeScript errors
2. Create a simple test in the terminal or a test file:

```typescript
import { formatRelativeTime, formatAbsoluteTime, getStatusColor } from '@/lib/utils/freshness-helpers';

// Test formatRelativeTime
console.log(formatRelativeTime(0));   // Should output: "Just now"
console.log(formatRelativeTime(5));   // Should output: "5 minutes ago"
console.log(formatRelativeTime(90));  // Should output: "1 hour ago"
console.log(formatRelativeTime(1500)); // Should output: "1 day ago"

// Test formatAbsoluteTime
console.log(formatAbsoluteTime('2026-01-16T20:39:22.827Z')); 
// Should output something like: "Jan 16, 2026 at 3:39 PM" (in your local timezone)

// Test getStatusColor
console.log(getStatusColor('fresh')); // Should return green classes
```

Record:
- [ ] TypeScript compilation passes
- [ ] formatRelativeTime returns correct strings for all test cases
- [ ] formatAbsoluteTime correctly converts to local timezone
- [ ] getStatusColor returns valid Tailwind classes
```

**Pass Criteria**:
- [ ] No TypeScript errors
- [ ] All utility functions work as expected

---

## PHASE 3: DataFreshnessIndicator Component

### Step 3.1: Create the Component

**Cursor Prompt**:
```
Create a new component at `src/components/dashboard/DataFreshnessIndicator.tsx` that:

1. Is a client component ('use client')
2. Accepts these props:
   - `variant`: 'compact' | 'detailed' (default: 'compact')
   - `className`: optional string for additional styles
3. Fetches data from `/api/dashboard/data-freshness` using the `dashboardApi.getDataFreshness()` method from `@/lib/api-client` with useState/useEffect
4. Shows loading state while fetching
5. Displays:
   - **Compact variant** (for Header): Status dot + "Updated X min ago"
   - **Detailed variant** (for GlobalFilters): "Last synced: Jan 16, 2026 at 3:39 PM" with status indicator
6. Uses the utility functions from `src/lib/utils/freshness-helpers.ts`
7. Has a tooltip on hover showing full details
8. Handles error states gracefully (shows nothing or a subtle error indicator)
9. Auto-refreshes every 5 minutes

Use existing component patterns from `src/components/dashboard/` for consistency.
Include dark mode support using existing dark: Tailwind classes.
```

**Expected File**: `src/components/dashboard/DataFreshnessIndicator.tsx`

**Expected Content**:
```typescript
'use client';

import { useState, useEffect } from 'react';
import { CheckCircle, Clock, AlertCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import { DataFreshness, DataFreshnessStatus } from '@/types/dashboard';
import { dashboardApi } from '@/lib/api-client';
import { 
  formatRelativeTime, 
  formatAbsoluteTime, 
  getStatusColor 
} from '@/lib/utils/freshness-helpers';

interface DataFreshnessIndicatorProps {
  variant?: 'compact' | 'detailed';
  className?: string;
}

const StatusIcon = ({ status }: { status: DataFreshnessStatus }) => {
  const iconClass = 'w-3.5 h-3.5';
  switch (status) {
    case 'fresh':
      return <CheckCircle className={iconClass} />;
    case 'recent':
      return <Clock className={iconClass} />;
    case 'stale':
      return <AlertCircle className={iconClass} />;
    case 'very_stale':
      return <AlertTriangle className={iconClass} />;
    default:
      return <Clock className={iconClass} />;
  }
};

export function DataFreshnessIndicator({ 
  variant = 'compact',
  className = '' 
}: DataFreshnessIndicatorProps) {
  const [freshness, setFreshness] = useState<DataFreshness | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchFreshness = async () => {
    try {
      const data = await dashboardApi.getDataFreshness();
      setFreshness(data);
      setError(false);
    } catch (err) {
      console.error('Error fetching data freshness:', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFreshness();
    
    // Refresh every 5 minutes
    const interval = setInterval(fetchFreshness, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Don't render anything if error or no data
  if (error || (!loading && !freshness)) {
    return null;
  }

  // Loading state
  if (loading) {
    return (
      <div className={`flex items-center gap-1.5 text-xs text-gray-400 ${className}`}>
        <RefreshCw className="w-3 h-3 animate-spin" />
        <span>Loading...</span>
      </div>
    );
  }

  const colors = getStatusColor(freshness!.status);
  const relativeTime = formatRelativeTime(freshness!.minutesAgo);
  const absoluteTime = formatAbsoluteTime(freshness!.lastUpdated);

  if (variant === 'compact') {
    return (
      <div 
        className={`flex items-center gap-1.5 text-xs ${colors.text} ${className}`}
        title={`Last synced: ${absoluteTime}\nStatus: ${freshness!.status}`}
      >
        <span className={`w-2 h-2 rounded-full ${colors.dot}`} />
        <span>Updated {relativeTime}</span>
      </div>
    );
  }

  // Detailed variant
  return (
    <div 
      className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs ${colors.bg} ${colors.text} ${className}`}
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
  );
}
```

---

### Verification Gate 3: Component Renders

**Cursor Prompt for Validation**:
```
Verify the DataFreshnessIndicator component works:

1. Run `npx tsc --noEmit` to check for TypeScript errors
2. Run `npm run lint` to check for linting issues
3. Start the dev server with `npm run dev`
4. Create a temporary test page or add the component to an existing page:

```typescript
// Temporarily add to src/app/dashboard/page.tsx or create a test page
import { DataFreshnessIndicator } from '@/components/dashboard/DataFreshnessIndicator';

// Inside the component JSX:
<div className="space-y-4 p-4 bg-gray-100">
  <h3>Compact Variant:</h3>
  <DataFreshnessIndicator variant="compact" />
  
  <h3>Detailed Variant:</h3>
  <DataFreshnessIndicator variant="detailed" />
</div>
```

5. Verify in the browser:
   - Both variants render correctly
   - Loading state shows briefly
   - Timestamps are in user's local timezone
   - Colors match the status (should be green if data is fresh)
   - Tooltip shows on hover

Record:
- [ ] TypeScript compilation passes
- [ ] Linting passes
- [ ] Compact variant shows: colored dot + "Updated X minutes ago"
- [ ] Detailed variant shows: icon + "Last synced: [date] at [time]"
- [ ] Timestamps display in local timezone (not UTC)
- [ ] Status color matches data age (green for fresh)
```

**Pass Criteria**:
- [ ] Component renders without errors
- [ ] Both variants display correctly
- [ ] Timezone conversion works (not showing UTC)
- [ ] Auto-refresh works (check network tab after 5 minutes)

---

## PHASE 4: Header Integration

### Step 4.1: Add to Header Component

**Cursor Prompt**:
```
Modify `src/components/layout/Header.tsx` to include the DataFreshnessIndicator:

1. Import the DataFreshnessIndicator component
2. Add the compact variant to the header, positioned:
   - In the right section of the header
   - Before the user info/sign out button
   - With appropriate spacing

The header should show the compact version: a small status dot with "Updated X minutes ago"

Make sure it:
- Doesn't break existing header layout
- Is responsive (consider hiding on very small screens if needed)
- Follows existing dark mode patterns
- Has appropriate spacing from other elements

Look at the current Header.tsx structure and find the best placement in the right-side controls area.
```

**Example Integration** (adjust based on actual Header structure):
```typescript
// In Header.tsx, add import:
import { DataFreshnessIndicator } from '@/components/dashboard/DataFreshnessIndicator';

// In the JSX, add in the right section before user controls:
<div className="flex items-center gap-4">
  <DataFreshnessIndicator variant="compact" className="hidden sm:flex" />
  {/* existing controls like ThemeToggle, user info, etc. */}
</div>
```

---

### Verification Gate 4: Header Integration Works

**Cursor Prompt for Validation**:
```
Verify the Header integration:

1. Run `npx tsc --noEmit` to check for TypeScript errors
2. Start dev server and navigate to any dashboard page
3. Check that the header shows the data freshness indicator

Verify:
- [ ] Indicator appears in header on desktop view
- [ ] Indicator is hidden or appropriately styled on mobile (< 640px)
- [ ] Indicator doesn't break header layout
- [ ] Dark mode works correctly (toggle theme if available)
- [ ] Indicator is visible on all dashboard pages (navigate between pages)

Take a screenshot or describe the visual appearance.
```

**Pass Criteria**:
- [ ] Indicator visible in header
- [ ] Responsive behavior correct
- [ ] Consistent across all pages

---

## PHASE 5: GlobalFilters Integration

### Step 5.1: Add to GlobalFilters Component

**Cursor Prompt**:
```
Modify `src/components/dashboard/GlobalFilters.tsx` to include the DataFreshnessIndicator:

1. Import the DataFreshnessIndicator component
2. Add the detailed variant, positioned:
   - Below the filter controls
   - Or in a subtle footer area of the filters section
   - Aligned left or right based on the existing layout

The GlobalFilters should show the detailed version: "Last synced: Jan 16, 2026 at 3:39 PM" with status icon and background color.

Look at the current GlobalFilters.tsx structure and find the best placement. Common options:
- As a footer below the filter grid
- In the header area next to the title
- As a small banner above or below the filters

Make sure it:
- Doesn't interfere with filter functionality
- Is clearly visible but not distracting
- Follows existing styling patterns
```

**Example Integration** (adjust based on actual structure):
```typescript
// In GlobalFilters.tsx, add import:
import { DataFreshnessIndicator } from '@/components/dashboard/DataFreshnessIndicator';

// At the bottom of the filters card/section:
<div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800">
  <DataFreshnessIndicator variant="detailed" />
</div>
```

---

### Step 5.2: Handle Pages Without GlobalFilters

**Cursor Prompt**:
```
Check which dashboard pages have GlobalFilters and which don't.

For pages that DON'T have GlobalFilters, the Header indicator will be the only freshness indicator, which is fine.

List which pages have GlobalFilters:
1. Check `src/app/dashboard/page.tsx` (main funnel performance)
2. Check other pages in `src/app/dashboard/*/page.tsx`

Record which pages have GlobalFilters and confirm the indicator appears there.
```

---

### Verification Gate 5: GlobalFilters Integration Works

**Cursor Prompt for Validation**:
```
Verify the GlobalFilters integration:

1. Run `npx tsc --noEmit` to check for TypeScript errors
2. Start dev server and navigate to a page with GlobalFilters (likely main dashboard)
3. Check that the detailed freshness indicator appears

Verify:
- [ ] Detailed indicator appears below/near the filters
- [ ] Shows full timestamp: "Last synced: [date] at [time]"
- [ ] Status icon and background color are visible
- [ ] Doesn't interfere with filter controls (can still use filters)
- [ ] Dark mode works correctly
- [ ] Both Header (compact) and GlobalFilters (detailed) indicators are visible on the same page

Take a screenshot or describe the visual appearance.
```

**Pass Criteria**:
- [ ] Detailed indicator visible in GlobalFilters area
- [ ] Full timestamp displayed correctly
- [ ] Both indicators work together on the page

---

## PHASE 6: Testing & Final Validation

### Step 6.1: BigQuery Validation

**Cursor Prompt**:
```
Use your MCP connection to BigQuery to run these validation queries:

1. **Current freshness query** - verify it returns expected data:
```sql
SELECT 
  MAX(last_data_load) as last_updated,
  TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), MAX(last_data_load), HOUR) as hours_ago,
  TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), MAX(last_data_load), MINUTE) as minutes_ago
FROM (
  SELECT TIMESTAMP_MILLIS(last_modified_time) as last_data_load
  FROM `savvy-gtm-analytics.SavvyGTMData.__TABLES__`
  WHERE table_id IN ('Lead', 'Opportunity')
)
```

2. **Individual table check** - verify both tables are being synced:
```sql
SELECT 
  table_id,
  TIMESTAMP_MILLIS(last_modified_time) as last_modified,
  row_count
FROM `savvy-gtm-analytics.SavvyGTMData.__TABLES__`
WHERE table_id IN ('Lead', 'Opportunity')
ORDER BY last_modified_time DESC
```

3. **Compare API response to direct query**:
   - Call the API: `curl http://localhost:3000/api/dashboard/data-freshness`
   - Compare `lastUpdated` to the BigQuery `last_updated` value
   - They should match (accounting for the slight time difference between queries)

Record all results.
```

---

### Step 6.2: Status Threshold Testing

**Cursor Prompt**:
```
Test that status thresholds work correctly by temporarily modifying the API response.

In `src/lib/queries/data-freshness.ts`, temporarily add test overrides:

```typescript
// TEMPORARY: Test different statuses - REMOVE AFTER TESTING
const TEST_STATUS = null; // Set to 'fresh', 'recent', 'stale', or 'very_stale' to test
const TEST_MINUTES_AGO = null; // Set to a number to test specific time

// In the return statement, add:
if (TEST_STATUS) {
  return {
    lastUpdated: result.last_updated || new Date().toISOString(),
    hoursAgo: TEST_STATUS === 'fresh' ? 0 : TEST_STATUS === 'recent' ? 3 : TEST_STATUS === 'stale' ? 12 : 48,
    minutesAgo: TEST_MINUTES_AGO || (TEST_STATUS === 'fresh' ? 15 : 180),
    isStale: TEST_STATUS === 'very_stale',
    status: TEST_STATUS,
  };
}
```

Test each status:
1. Set TEST_STATUS = 'fresh' → Verify green indicator
2. Set TEST_STATUS = 'recent' → Verify yellow indicator  
3. Set TEST_STATUS = 'stale' → Verify orange indicator
4. Set TEST_STATUS = 'very_stale' → Verify red indicator

After testing, REMOVE the test code.

Record:
- [ ] 'fresh' status shows green color
- [ ] 'recent' status shows yellow color
- [ ] 'stale' status shows orange color
- [ ] 'very_stale' status shows red color with "(stale)" label
- [ ] Test code has been removed
```

---

### Step 6.3: Timezone Testing

**Cursor Prompt**:
```
Verify timezone handling works correctly:

1. Check your browser's timezone in dev tools: 
   - Open console, run: `Intl.DateTimeFormat().resolvedOptions().timeZone`
   - Record your timezone

2. The API returns UTC timestamp. Verify the component converts correctly:
   - API returns: "2026-01-16T20:39:22.827Z" (UTC)
   - If you're in EST (UTC-5), should display: "Jan 16, 2026 at 3:39 PM"
   - If you're in PST (UTC-8), should display: "Jan 16, 2026 at 12:39 PM"

3. Check the displayed time matches your local timezone conversion

Record:
- [ ] Your timezone: _______________
- [ ] API timestamp (UTC): _______________
- [ ] Displayed timestamp: _______________
- [ ] Conversion is correct: Yes/No
```

---

### Step 6.4: Final Compilation Check

**Cursor Prompt**:
```
Run final compilation and lint checks:

1. `npx tsc --noEmit` - TypeScript compilation
2. `npm run lint` - Linting
3. `npm run build` - Full production build

Record any errors or warnings. All should pass.

Record:
- [ ] TypeScript: Pass/Fail
- [ ] Lint: Pass/Fail (note any warnings)
- [ ] Build: Pass/Fail
```

---

### Step 6.5: Create Summary Documentation

**Cursor Prompt**:
```
Create a brief documentation file at `docs/DATA_FRESHNESS_FEATURE.md` that documents:

1. **What it does**: Explains the data freshness indicator feature
2. **How it works**: The __TABLES__ metadata query approach
3. **Where it appears**: Header (compact) and GlobalFilters (detailed)
4. **Status thresholds**:
   - fresh: < 1 hour (green)
   - recent: 1-6 hours (yellow)
   - stale: 6-24 hours (orange)
   - very_stale: > 24 hours (red)
5. **Caching**: 5-minute cache with stale-while-revalidate
6. **Files created/modified**: List of all files
```

---

### Final Verification Gate: Complete Implementation

**Checklist**:

#### Files Created:
- [ ] `src/lib/queries/data-freshness.ts`
- [ ] `src/app/api/dashboard/data-freshness/route.ts`
- [ ] `src/lib/utils/freshness-helpers.ts`
- [ ] `src/components/dashboard/DataFreshnessIndicator.tsx`
- [ ] `docs/DATA_FRESHNESS_FEATURE.md`

#### Files Modified:
- [ ] `src/types/dashboard.ts` (added DataFreshness types)
- [ ] `src/lib/api-client.ts` (added getDataFreshness method)
- [ ] `src/components/layout/Header.tsx` (added compact indicator)
- [ ] `src/components/dashboard/GlobalFilters.tsx` (added detailed indicator)

#### Functionality Verified:
- [ ] API returns correct timestamp from BigQuery `__TABLES__` metadata
- [ ] Compact indicator shows in Header on all pages
- [ ] Detailed indicator shows in GlobalFilters area
- [ ] Timestamps display in user's local timezone
- [ ] Status colors work correctly (green/yellow/orange/red)
- [ ] Auto-refresh works (every 5 minutes)
- [ ] Dark mode works correctly
- [ ] No TypeScript errors
- [ ] No lint errors
- [ ] Production build succeeds

#### User Experience Verified:
- [ ] Users can see when data was last synced
- [ ] Stale data (> 24 hours) shows clear warning
- [ ] Indicator doesn't interfere with existing functionality

---

## Troubleshooting

### Common Issues

**Issue**: API returns 500 error
- Check BigQuery credentials are configured (GOOGLE_APPLICATION_CREDENTIALS_JSON or GOOGLE_APPLICATION_CREDENTIALS)
- Verify `__TABLES__` query works in BigQuery console (tested and confirmed working)
- Check server logs for specific error (logger.error will show details)
- Verify authentication is working (session check)

**Issue**: API returns 401 Unauthorized
- Ensure user is logged in
- Check that `getServerSession(authOptions)` is working correctly
- Verify NextAuth configuration

**Issue**: Timestamp shows in UTC instead of local time
- Ensure `formatAbsoluteTime` uses `toLocaleString()` without specifying a timezone
- Check browser isn't overriding timezone

**Issue**: Component doesn't auto-refresh
- Check `useEffect` cleanup function is correct
- Verify `setInterval` is set to 5 * 60 * 1000 (5 minutes in ms)

**Issue**: Status always shows 'fresh' even when data is old
- Check `hoursAgo` calculation in query (verify BigQuery returns correct values)
- Verify `status` determination logic in `getDataFreshness()` (thresholds: <1h=fresh, <6h=recent, <24h=stale, >=24h=very_stale)
- Check that BigQuery TIMESTAMP_DIFF is returning numbers correctly (may need parseInt if returned as string)

**Issue**: Timestamp format incorrect
- BigQuery TIMESTAMP is returned as ISO string directly (e.g., "2026-01-16T20:39:22.827Z")
- Not wrapped in `{ value: string }` object
- If seeing unexpected format, check the actual BigQuery response structure

---

## Rollback Plan

If issues are discovered after deployment:

1. **Quick fix**: Comment out the `DataFreshnessIndicator` imports in Header.tsx and GlobalFilters.tsx
2. **Full rollback**: Revert the commits that added this feature
3. **Disable API**: Add `return NextResponse.json({ disabled: true })` at top of API route

---

## Future Enhancements (Optional)

1. **Manual refresh button**: Add a button to manually refresh the timestamp
2. **Notification on stale**: Show a toast/banner when data becomes stale
3. **Per-page freshness**: Track freshness for specific data types (leads vs opportunities)
4. **Admin visibility**: Show more details for admin users (individual table times, row counts)
