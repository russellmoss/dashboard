# Data Transfer Implementation - Codebase Analysis Answers

## Instructions for Cursor.ai

Work through each question below sequentially. For each question:
1. Search/read the relevant files in the codebase ✅
2. Use MCP connection to BigQuery if needed to verify configurations ✅
3. Write your findings in `data_transfer_answers.md` with the same section numbering ✅
4. Include relevant code snippets where helpful ✅
5. Note any discrepancies or concerns you discover ✅

---

## Section 1: Current Caching Strategy

### 1.1 Cache Configuration

**File**: `src/lib/cache.ts`

**Cache Tags**:
```typescript
export const CACHE_TAGS = {
  DASHBOARD: 'dashboard',
  SGA_HUB: 'sga-hub',
} as const;
```

**TTL Values**:
- **Dashboard queries**: `DEFAULT_CACHE_TTL = 43200` (12 hours in seconds)
- **Detail records**: `DETAIL_RECORDS_TTL = 21600` (6 hours in seconds)
- **Filter options**: Uses `DEFAULT_CACHE_TTL` (12 hours) - no separate TTL found

**Where `unstable_cache` is used**:
- Wrapper function `cachedQuery()` in `src/lib/cache.ts` wraps `unstable_cache`
- Used extensively across query functions in `src/lib/queries/`:
  - `getFunnelMetrics` (funnel-metrics.ts)
  - `getConversionRates` (conversion-rates.ts)
  - `getDetailRecords` (detail-records.ts) - uses `DETAIL_RECORDS_TTL`
  - `getChannelPerformance`, `getSourcePerformance` (source-performance.ts)
  - `getDataFreshness` (data-freshness.ts)
  - `getOpenPipelineRecords`, `getOpenPipelineSummary` (open-pipeline.ts)
  - `getInitialCallsDrillDown`, `getQualificationCallsDrillDown`, `getSQODrillDown` (drill-down.ts)
  - `getWeeklyActuals`, `getAllSGAWeeklyActuals` (weekly-actuals.ts)
  - `getQuarterlySQOCount`, `getQuarterlySQODetails`, `getQuarterlyProgressForSGA` (quarterly-progress.ts)
  - `getClosedLostRecords` (closed-lost.ts)
  - `getReEngagementOpportunities` (re-engagement.ts)
  - `getAggregateForecastGoals`, `getChannelForecastGoals`, `getSourceForecastGoals` (forecast-goals.ts)
  - `getRecordDetail` (record-detail.ts)

### 1.2 Cache Wrapper Pattern

**File**: `src/lib/cache.ts` (lines 67-98)

**`cachedQuery` wrapper function**:
```typescript
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

**Cache key generation**:
- Cache keys are automatically generated from:
  - `keyName` (explicit identifier - required as arrow functions don't have names)
  - Function arguments (serialized by Next.js)
- Different parameter combinations automatically get different cache keys
- Example: `getFunnelMetrics({ channel: 'Web' })` → Cache Key A, `getFunnelMetrics({ channel: 'Paid Search' })` → Cache Key B

**Query functions using wrapper**: See list in Section 1.1 above (20+ functions)

### 1.3 Cache Invalidation

**What triggers cache invalidation**:
1. **Cron job**: `/api/cron/refresh-cache` - scheduled at `0 5 * * *` (5 AM UTC = midnight EST)
2. **Admin manual refresh**: `/api/admin/refresh-cache` (POST) - admin-only endpoint

**Where `revalidateTag()` is called**:
- `src/app/api/cron/refresh-cache/route.ts` (lines 26-27)
- `src/app/api/admin/refresh-cache/route.ts` (lines 24-25)

**Tags invalidated**:
- Both endpoints invalidate: `CACHE_TAGS.DASHBOARD` and `CACHE_TAGS.SGA_HUB`
- Invalidates all cache entries tagged with these values

**Current schedule analysis**:
- Cron runs daily at 5 AM UTC (midnight EST)
- No Friday-specific cron jobs currently
- ⚠️ **Gap**: Current schedule doesn't align with proposed BigQuery transfer schedule (every 6 hours + Friday additions)

---

## Section 2: Current Cron Jobs

### 2.1 Vercel Cron Configuration

**File**: `vercel.json`

**Current cron schedule**:
```json
{
  "crons": [
    {
      "path": "/api/cron/refresh-cache",
      "schedule": "0 5 * * *"
    }
  ]
}
```

**Schedule details**:
- **Cron expression**: `0 5 * * *` (5:00 AM UTC daily)
- **UTC time**: 5:00 AM
- **EST equivalent**: 12:00 AM (midnight) EST
- **Endpoint**: `/api/cron/refresh-cache`

### 2.2 Cron Route Implementation

**File**: `src/app/api/cron/refresh-cache/route.ts`

**Authentication**:
```typescript
// Validates CRON_SECRET (auto-injected by Vercel)
const authHeader = request.headers.get('authorization');
const cronSecret = process.env.CRON_SECRET;

if (authHeader !== `Bearer ${cronSecret}`) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
```

**Actions performed**:
1. Validates `CRON_SECRET` from Authorization header (auto-injected by Vercel)
2. Invalidates both cache tags: `CACHE_TAGS.DASHBOARD` and `CACHE_TAGS.SGA_HUB`
3. Logs the refresh action
4. Returns success response

**Other cron-related routes**: None found

### 2.3 Current Schedule Analysis

**Current cron schedule to EST**:
- `0 5 * * *` (5 AM UTC) = **12:00 AM EST** (midnight)

**Alignment with BigQuery data transfer**:
- ⚠️ **Does NOT align**: Current schedule runs once daily at midnight EST
- Proposed schedule requires:
  - Daily: 5:00 AM, 11:00 AM, 5:00 PM, 11:00 PM EST (every 6 hours)
  - Friday additions: 2:37 PM, 3:37 PM, 5:37 PM EST

**Friday-specific cron jobs**: None currently

---

## Section 3: Current Admin Refresh Feature

### 3.1 Admin Refresh API Endpoint

**File**: `src/app/api/admin/refresh-cache/route.ts`

**Authentication/Authorization**:
```typescript
const session = await getServerSession(authOptions);
if (!session) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

const permissions = await getUserPermissions(session.user?.email || '');
if (permissions.role !== 'admin') {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
```

**What it does**:
1. Checks for valid session
2. Verifies user is admin role
3. Invalidates both cache tags: `CACHE_TAGS.DASHBOARD` and `CACHE_TAGS.SGA_HUB`
4. Logs the refresh action with user email
5. Returns success response

**Response**:
```typescript
{
  success: true,
  message: 'Cache invalidated successfully',
  tags: [CACHE_TAGS.DASHBOARD, CACHE_TAGS.SGA_HUB]
}
```

### 3.2 DataFreshnessIndicator Component

**File**: `src/components/dashboard/DataFreshnessIndicator.tsx`

**How it fetches freshness data**:
```typescript
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

// Auto-refreshes every 5 minutes
useEffect(() => {
  fetchFreshness();
  const interval = setInterval(fetchFreshness, 5 * 60 * 1000);
  return () => clearInterval(interval);
}, []);
```

**Current "Refresh" button**:
```typescript
const handleRefresh = async () => {
  setIsRefreshing(true);
  try {
    const response = await fetch('/api/admin/refresh-cache', {
      method: 'POST',
    });
    
    if (response.ok) {
      console.log('Cache refreshed successfully');
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

**Permissions check**:
```typescript
const { data: session } = useSession();
const permissions = getSessionPermissions(session);
const isAdmin = permissions?.role === 'admin';

// Button only shows if isAdmin is true
{isAdmin && (
  <button onClick={handleRefresh} disabled={isRefreshing}>
    <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
  </button>
)}
```

**User feedback**:
- ⚠️ **No toast notifications**: Uses `console.log` for success, `console.error` for errors
- Shows loading spinner (`RefreshCw` with `animate-spin`) while refreshing
- Refetches freshness data after successful refresh
- No visual success/error messages to user

**Variants**:
- `compact`: Small indicator with dot and relative time
- `detailed`: Larger card with icon, absolute time, and status text

### 3.3 Data Freshness API

**File**: `src/app/api/dashboard/data-freshness/route.ts`

**What data it returns**:
```typescript
interface DataFreshnessResult {
  lastUpdated: string;        // ISO timestamp in UTC
  hoursAgo: number;
  minutesAgo: number;
  isStale: boolean;           // true if > 24 hours
  status: 'fresh' | 'recent' | 'stale' | 'very_stale';
}
```

**How it determines last sync**:
**File**: `src/lib/queries/data-freshness.ts`

```typescript
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
```

**Status determination**:
- `fresh`: < 1 hour ago
- `recent`: 1-6 hours ago
- `stale`: 6-24 hours ago
- `very_stale`: > 24 hours ago

**Current data**: Last sync was ~20 hours ago (Task table last modified: 2026-01-20T05:02:46.141Z)

---

## Section 4: BigQuery Data Transfer Configuration

### 4.1 Transfer Config Details

⚠️ **Unable to query INFORMATION_SCHEMA.TRANSFER_CONFIGS via MCP**: The table was not found in the expected location. This may require direct BigQuery console access or API calls.

**Transfer Config Resource ID** (from question):
```
projects/154995667624/locations/northamerica-northeast2/transferConfigs/68d12521-0000-207a-b4fa-ac3eb14e17d8
```

**Objects being synced** (from data-freshness query):
- Lead
- Opportunity
- Task (confirmed via BigQuery query)

**Destination dataset**: `SavvyGTMData` (inferred from query patterns)

**Transfer config owner**: Unknown (requires BigQuery console or API access)

💡 **Recommendation**: Use BigQuery Data Transfer API client (`@google-cloud/bigquery-data-transfer`) to query transfer config details programmatically.

### 4.2 Recent Transfer Runs

⚠️ **Unable to query transfer runs via MCP**: Requires BigQuery Data Transfer API access, not available through standard BigQuery SQL queries.

💡 **Recommendation**: Use `DataTransferServiceClient` to query recent runs:
```typescript
import { DataTransferServiceClient } from '@google-cloud/bigquery-data-transfer';

const client = new DataTransferServiceClient();
const runs = await client.listTransferRuns({
  parent: 'projects/154995667624/locations/northamerica-northeast2/transferConfigs/68d12521-0000-207a-b4fa-ac3eb14e17d8',
});
```

### 4.3 Transfer Config Resource ID

**Confirmed resource path**:
```
projects/154995667624/locations/northamerica-northeast2/transferConfigs/68d12521-0000-207a-b4fa-ac3eb14e17d8
```

**Components**:
- Project ID: `154995667624`
- Location: `northamerica-northeast2`
- Transfer Config ID: `68d12521-0000-207a-b4fa-ac3eb14e17d8`

---

## Section 5: Permission System

### 5.1 User Roles

**File**: `src/lib/permissions.ts`

**Roles defined**:
```typescript
const ROLE_PERMISSIONS: Record<string, Omit<UserPermissions, 'sgaFilter' | 'sgmFilter'>> = {
  admin: {
    role: 'admin',
    allowedPages: [1, 7, 8, 9, 10],
    canExport: true,
    canManageUsers: true,
  },
  manager: {
    role: 'manager',
    allowedPages: [1, 7, 8, 9, 10],
    canExport: true,
    canManageUsers: true,
  },
  sgm: {
    role: 'sgm',
    allowedPages: [1, 10],
    canExport: true,
    canManageUsers: false,
  },
  sga: {
    role: 'sga',
    allowedPages: [1, 8, 10],
    canExport: true,
    canManageUsers: false,
  },
  viewer: {
    role: 'viewer',
    allowedPages: [1, 10],
    canExport: false,
    canManageUsers: false,
  },
};
```

**Roles**: `admin`, `manager`, `sgm`, `sga`, `viewer`

**Where role checking is implemented**:
- `src/lib/permissions.ts` - `getUserPermissions()` function
- API routes use `getUserPermissions()` to check roles
- Components use `getSessionPermissions()` helper from `src/types/auth.ts`

### 5.2 Permission Checks

**File**: `src/lib/permissions.ts`

**`getUserPermissions` function**:
```typescript
export async function getUserPermissions(email: string): Promise<UserPermissions> {
  const user = await getUserByEmail(email);
  
  if (!user) {
    return {
      role: 'viewer',
      allowedPages: [1, 10],
      sgaFilter: null,
      sgmFilter: null,
      canExport: false,
      canManageUsers: false,
    };
  }
  
  const basePermissions = ROLE_PERMISSIONS[user.role] || ROLE_PERMISSIONS.viewer;
  
  return {
    ...basePermissions,
    sgaFilter: user.role === 'sga' ? user.name : null,
    sgmFilter: user.role === 'sgm' ? user.name : null,
  };
}
```

**How it determines role**: Queries Prisma database for user by email, then looks up role in `ROLE_PERMISSIONS` mapping

**Roles that should have access to trigger data transfers**:
- 💡 **Recommendation**: `admin` and `manager` roles should have access (same as cache refresh)

### 5.3 Current Admin Checks

**DataFreshnessIndicator admin check**:
```typescript
const { data: session } = useSession();
const permissions = getSessionPermissions(session);
const isAdmin = permissions?.role === 'admin';
```

**Other places checking admin/manager permissions**:
- `src/app/api/admin/refresh-cache/route.ts` - checks `permissions.role !== 'admin'`
- `src/app/api/admin/sga-overview/route.ts` - checks for admin/manager roles
- Various components check `isAdmin` or `permissions.role === 'admin'`

💡 **Note**: Current refresh endpoint only checks for `admin`, but `manager` role has same permissions. Consider updating to `['admin', 'manager'].includes(permissions.role)`.

---

## Section 6: Environment Variables

### 6.1 BigQuery Credentials

**Environment variables**:
- `GOOGLE_APPLICATION_CREDENTIALS_JSON` - Used in Vercel (JSON string of service account)
- `GOOGLE_APPLICATION_CREDENTIALS` - Used locally (file path to service account key)

**Where used**: `src/lib/bigquery.ts` (lines 20-75)

**Credential handling**:
```typescript
// For Vercel deployment: use JSON credentials from env var
if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  const credentials = JSON.parse(jsonString);
  bigqueryClient = new BigQuery({
    projectId,
    credentials,
    scopes,
  });
}
// For local development: use file path
else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  bigqueryClient = new BigQuery({
    projectId,
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    scopes,
  });
}
```

**Scopes requested**:
```typescript
const scopes = [
  'https://www.googleapis.com/auth/bigquery',
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/drive.readonly',
];
```

**Separate credential for data transfers**: 
- ⚠️ **Unknown**: Need to verify if same service account has BigQuery Data Transfer API permissions
- 💡 **Recommendation**: Same credentials should work if service account has `bigquery.transfers.update` permission

### 6.2 Cron Secret

**Variable**: `CRON_SECRET`

**How it's used**: 
- Auto-injected by Vercel into Authorization header as `Bearer ${CRON_SECRET}`
- Validated in `/api/cron/refresh-cache/route.ts`:
```typescript
const authHeader = request.headers.get('authorization');
const cronSecret = process.env.CRON_SECRET;

if (authHeader !== `Bearer ${cronSecret}`) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
```

**Where validated**: `src/app/api/cron/refresh-cache/route.ts` (lines 12-23)

### 6.3 Any Missing Env Vars

**New environment variables needed**:
- ✅ None required - can use same `GOOGLE_APPLICATION_CREDENTIALS_JSON` for BigQuery Data Transfer API
- ⚠️ **Verify**: Service account must have `bigquery.transfers.update` IAM permission

---

## Section 7: BigQuery Client Setup

### 7.1 Current BigQuery Client

**File**: `src/lib/bigquery.ts`

**How client is initialized**:
```typescript
let bigqueryClient: BigQuery | null = null;

export function getBigQueryClient(): BigQuery {
  if (bigqueryClient) return bigqueryClient;
  
  const projectId = process.env.GCP_PROJECT_ID || 'savvy-gtm-analytics';
  
  const scopes = [
    'https://www.googleapis.com/auth/bigquery',
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/drive.readonly',
  ];
  
  // Initialize with credentials (see Section 6.1)
  // ...
  
  return bigqueryClient;
}
```

**Scopes requested**: See Section 6.1

### 7.2 Data Transfer Client

**Package installed**: ✅ `@google-cloud/bigquery-data-transfer` version `^5.1.2` (from `package.json`)

**Separate client initialization needed**: 
- 💡 **Yes**: Need to create separate client for Data Transfer API
- **Pattern**:
```typescript
import { DataTransferServiceClient } from '@google-cloud/bigquery-data-transfer';

let dataTransferClient: DataTransferServiceClient | null = null;

export function getDataTransferClient(): DataTransferServiceClient {
  if (dataTransferClient) return dataTransferClient;
  
  // Use same credentials as BigQuery client
  const credentials = /* parse from GOOGLE_APPLICATION_CREDENTIALS_JSON */;
  
  dataTransferClient = new DataTransferServiceClient({
    projectId: process.env.GCP_PROJECT_ID || 'savvy-gtm-analytics',
    credentials,
  });
  
  return dataTransferClient;
}
```

---

## Section 8: UI Components

### 8.1 Dashboard Header

**DataFreshnessIndicator location**:
- Used in `src/app/dashboard/page.tsx` (main dashboard page)
- Appears in dashboard header area

**Multiple instances**: 
- Supports `variant` prop: `'compact' | 'detailed'`
- Currently used once per page

### 8.2 Loading/Progress States

**Loading spinner component**: 
- **File**: `src/components/ui/LoadingSpinner.tsx`
- Uses `RefreshCw` or `Loader2` from `lucide-react` with `animate-spin` class

**Pattern used**:
```typescript
<RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
```

**Success/Error messages**:
- ⚠️ **No toast library**: Currently using `console.log` and `console.error`
- Some components use inline error messages:
  - `src/components/dashboard/ExploreResults.tsx` - Shows error in UI with `AlertCircle` icon
  - `src/components/dashboard/RecordDetailModal.tsx` - Shows error banner
  - `src/components/sga-hub/WeeklyGoalEditor.tsx` - Shows error state

💡 **Recommendation**: Consider adding a toast library (e.g., `react-hot-toast` or `sonner`) for better UX.

### 8.3 Confirmation Dialogs

**Existing confirmation dialog**: 
- **File**: `src/components/dashboard/DeleteConfirmModal.tsx`
- Pattern: Fixed overlay with backdrop, modal content, Cancel/Confirm buttons
- Uses `AlertTriangle` icon for warnings

**Pattern**:
```typescript
<div className="fixed inset-0 z-50 flex items-center justify-center">
  <div className="fixed inset-0 bg-black bg-opacity-50" onClick={onClose} />
  <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl">
    {/* Header with icon and title */}
    {/* Body with message */}
    {/* Footer with Cancel/Confirm buttons */}
  </div>
</div>
```

**Other confirmation patterns**: 
- `src/components/settings/DeleteConfirmModal.tsx` - Similar pattern for user deletion

💡 **Recommendation**: Can reuse `DeleteConfirmModal` pattern or create generic `ConfirmDialog` component.

---

## Section 9: Logging and Monitoring

### 9.1 Current Logging

**File**: `src/lib/logger.ts`

**Logger implementation**:
```typescript
class Logger {
  private isDevelopment: boolean;
  private isProduction: boolean;

  debug(message: string, context?: LogContext): void {
    if (this.shouldLog('debug')) {
      console.debug(this.formatMessage('debug', message, context));
    }
  }

  info(message: string, context?: LogContext): void {
    if (this.shouldLog('info')) {
      console.log(this.formatMessage('info', message, context));
    }
  }

  warn(message: string, context?: LogContext): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, context));
    }
  }

  error(message: string, error?: Error | unknown, context?: LogContext): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', errorMessage, fullContext));
    }
  }
}
```

**Log levels**:
- Development: All logs (debug, info, warn, error)
- Production: Only warn and error logs

**Where logs go**: 
- Vercel logs (console output)
- No external logging service configured

### 9.2 Error Handling Patterns

**API route error handling**:
```typescript
try {
  // ... logic
  return NextResponse.json(data);
} catch (error) {
  logger.error('Error message:', error);
  return NextResponse.json(
    { error: 'Failed to ...' },
    { status: 500 }
  );
}
```

**Error tracking**: 
- ✅ **Sentry configured**: `@sentry/nextjs` version `^10.34.0`
- Files: `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`
- Initialization: `src/instrumentation.ts` (for server/edge runtimes)

---

## Section 10: Vercel Configuration

### 10.1 Function Timeouts

**File**: `vercel.json`

**Current timeout settings**:
```json
{
  "functions": {
    "src/app/api/dashboard/export-sheets/route.ts": {
      "maxDuration": 60
    },
    "src/app/api/agent/query/route.ts": {
      "maxDuration": 60
    }
  }
}
```

**Routes with custom `maxDuration`**: 
- `/api/dashboard/export-sheets` - 60 seconds
- `/api/agent/query` - 60 seconds

**Maximum allowed duration**: 
- ⚠️ **Unknown**: Depends on Vercel plan (Hobby: 10s, Pro: 60s, Enterprise: 300s+)
- 💡 **Recommendation**: Check Vercel dashboard for plan limits

### 10.2 Cron Limitations

**Cron job limits**:
- ⚠️ **Unknown from codebase**: Need to check Vercel documentation
- 💡 **Typical limits**:
  - Minimum interval: 1 minute
  - Maximum cron jobs: Varies by plan
  - Timezone: UTC only

**Current cron jobs**: 1 (`refresh-cache`)

---

## Section 11: Specific Implementation Questions

### 11.1 Rate Limiting

**Existing rate limiting**: 
- ❌ **None found**: No rate limiting implementation in codebase

**How to track "last refresh time"**:
- 💡 **Options**:
  1. Store in database (Prisma) - `lastTransferTrigger` timestamp
  2. Store in Redis (if available)
  3. Store in memory (lost on restart)
  4. Use BigQuery transfer run history to check last run time

**Per-user vs global**:
- 💡 **Recommendation**: **Global cooldown** - only one transfer can be triggered at a time, with cooldown period (e.g., 5 minutes) to prevent abuse

### 11.2 Transfer Status Polling

**Polling duration**: 
- 💡 **Recommendation**: 
  - Maximum poll time: 10-15 minutes
  - Polling interval: Every 10-15 seconds
  - Timeout: 15 minutes (fail gracefully if transfer takes too long)

**Polling pattern**:
```typescript
const pollTransferStatus = async (runName: string, maxWaitTime = 15 * 60 * 1000) => {
  const startTime = Date.now();
  const pollInterval = 10000; // 10 seconds
  
  while (Date.now() - startTime < maxWaitTime) {
    const run = await getTransferRun(runName);
    if (run.state === 'SUCCEEDED') return { success: true, run };
    if (run.state === 'FAILED') return { success: false, run };
    
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
  
  return { success: false, timeout: true };
};
```

### 11.3 Objects to Sync

**Objects currently in transfer** (from codebase analysis):
- ✅ Lead
- ✅ Opportunity
- ✅ Task

**Confirmation needed**: 
- ⚠️ **Verify via BigQuery console or API**: These are the objects found in `__TABLES__` query, but transfer config may include others

---

## Section 12: Schedule Verification

### 12.1 Current BigQuery Transfer Schedule

⚠️ **Unable to verify via MCP**: Requires BigQuery Data Transfer API access.

💡 **Recommendation**: Query via API:
```typescript
const client = getDataTransferClient();
const config = await client.getTransferConfig({
  name: 'projects/154995667624/locations/northamerica-northeast2/transferConfigs/68d12521-0000-207a-b4fa-ac3eb14e17d8',
});
console.log('Schedule:', config.schedule);
console.log('Timezone:', config.scheduleOptions?.timezone);
```

### 12.2 Proposed New Schedule

**EST to UTC conversion**:
- 5:00 AM EST = **10:00 AM UTC** (EST is UTC-5)
- 11:00 AM EST = **4:00 PM UTC** (16:00)
- 5:00 PM EST = **10:00 PM UTC** (22:00)
- 11:00 PM EST = **4:00 AM UTC** (next day) (04:00)

**Friday additions**:
- 2:37 PM EST = **7:37 PM UTC** (19:37)
- 3:37 PM EST = **8:37 PM UTC** (20:37)
- 5:37 PM EST = **10:37 PM UTC** (22:37)

### 12.3 Cron Expression

**Daily 6-hour syncs** (4 cron jobs):
```json
{
  "crons": [
    {
      "path": "/api/cron/refresh-cache",
      "schedule": "0 10 * * *"  // 5:00 AM EST = 10:00 AM UTC
    },
    {
      "path": "/api/cron/refresh-cache",
      "schedule": "0 16 * * *"  // 11:00 AM EST = 4:00 PM UTC
    },
    {
      "path": "/api/cron/refresh-cache",
      "schedule": "0 22 * * *"  // 5:00 PM EST = 10:00 PM UTC
    },
    {
      "path": "/api/cron/refresh-cache",
      "schedule": "0 4 * * *"   // 11:00 PM EST = 4:00 AM UTC (next day)
    }
  ]
}
```

**Friday special syncs** (3 additional cron jobs):
```json
{
  "crons": [
    {
      "path": "/api/cron/refresh-cache",
      "schedule": "37 19 * * 5"  // 2:37 PM EST Friday = 7:37 PM UTC Friday
    },
    {
      "path": "/api/cron/refresh-cache",
      "schedule": "37 20 * * 5"  // 3:37 PM EST Friday = 8:37 PM UTC Friday
    },
    {
      "path": "/api/cron/refresh-cache",
      "schedule": "37 22 * * 5"  // 5:37 PM EST Friday = 10:37 PM UTC Friday
    }
  ]
}
```

⚠️ **Note**: Vercel cron expressions use 5-digit format: `minute hour day month day-of-week`
- Day of week: `0` = Sunday, `5` = Friday

---

## Section 13: Dependencies Check

### 13.1 Package.json Analysis

**Packages installed**:
- ✅ `@google-cloud/bigquery-data-transfer`: `^5.1.2` (installed)
- ✅ `@google-cloud/bigquery`: `^7.9.4` (installed)

### 13.2 Version Compatibility

**Next.js version**: `^14.2.35`

**Compatibility concerns**:
- ✅ **No known issues**: Both packages are compatible with Next.js 14
- `@google-cloud/bigquery-data-transfer` v5.x supports Node.js 14+ and works with Next.js

---

## Summary Questions

### 1. Architecture Summary

**Current caching and refresh system**:

1. **Caching Layer**:
   - Uses Next.js `unstable_cache()` via `cachedQuery()` wrapper
   - Two cache tags: `DASHBOARD` and `SGA_HUB`
   - TTL: 12 hours (default), 6 hours (detail records)
   - Cache keys auto-generated from function name + arguments

2. **Cache Invalidation**:
   - **Scheduled**: Cron job at 5 AM UTC (midnight EST) daily
   - **Manual**: Admin-only endpoint `/api/admin/refresh-cache`
   - Both invalidate all cache entries tagged with `DASHBOARD` and `SGA_HUB`

3. **Data Freshness**:
   - Queries `__TABLES__` metadata for Lead/Opportunity tables
   - Calculates time since last data load
   - Shows status: fresh/recent/stale/very_stale
   - Auto-refreshes every 5 minutes in UI

4. **Flow**:
   ```
   User Request → Check Cache → Cache Hit? → Return Cached Data
                                    ↓ No
                              Query BigQuery → Cache Result → Return Data
   
   Cron/Admin Refresh → revalidateTag() → Invalidate Cache → Next Request Fetches Fresh Data
   ```

### 2. Gap Analysis

**What's missing**:

1. ❌ **Data Transfer Triggering**: No endpoint to trigger BigQuery data transfers
2. ❌ **Transfer Status Polling**: No mechanism to poll transfer completion
3. ❌ **Transfer Progress UI**: No UI to show transfer progress/warnings
4. ❌ **Rate Limiting**: No cooldown mechanism for transfer triggers
5. ❌ **Toast Notifications**: No user-friendly success/error messages
6. ❌ **Updated Cron Schedule**: Current schedule doesn't match proposed 6-hour intervals
7. ❌ **Friday-Specific Cron Jobs**: No Friday hourly syncs
8. ❌ **Cache Invalidation on Transfer Completion**: Cache refresh not tied to transfer completion

### 3. Risk Assessment

**What could go wrong**:

1. ⚠️ **Transfer Failures**: BigQuery transfers can fail - need error handling and user notification
2. ⚠️ **Long-Running Transfers**: Transfers may take 10+ minutes - need timeout handling
3. ⚠️ **Rate Limiting**: Users could spam transfer triggers - need cooldown mechanism
4. ⚠️ **Permission Issues**: Service account may lack `bigquery.transfers.update` permission
5. ⚠️ **Cron Job Limits**: Vercel may have limits on number of cron jobs
6. ⚠️ **Cache Invalidation Timing**: Cache may be invalidated before transfer completes
7. ⚠️ **UI Blocking**: Long polling could block UI - need async/background processing
8. ⚠️ **Error Visibility**: No toast library means errors only in console

### 4. Recommended Approach

**Cleanest implementation**:

1. **New Data Transfer Trigger Endpoint**:
   - **File**: `src/app/api/admin/trigger-transfer/route.ts`
   - **Method**: POST
   - **Auth**: Admin/Manager only
   - **Actions**:
     - Check cooldown (last transfer time)
     - Trigger transfer via Data Transfer API
     - Return transfer run name immediately
     - Poll status in background (don't block response)

2. **Updated UI with Warnings and Progress**:
   - **Modify**: `src/components/dashboard/DataFreshnessIndicator.tsx`
   - **Add**: 
     - Warning banner if data is stale
     - "Trigger Transfer" button (admin/manager only)
     - Progress indicator during transfer
     - Success/error toast notifications
   - **Pattern**: Use existing `DeleteConfirmModal` pattern for confirmation

3. **New Cron Schedule**:
   - **Update**: `vercel.json`
   - **Add**: 4 daily cron jobs (6-hour intervals) + 3 Friday-specific jobs
   - **Note**: Each cron job calls `/api/cron/refresh-cache` which invalidates cache
   - ⚠️ **Consider**: Should cron jobs trigger transfers OR just refresh cache after transfers complete?

4. **Cache Invalidation Tied to Transfer Completion**:
   - **Option A**: Cron jobs trigger transfers, then poll for completion, then invalidate cache
   - **Option B**: Separate cron jobs for transfers (new endpoint) and cache refresh (existing)
   - 💡 **Recommendation**: **Option B** - Keep transfer triggering separate from cache refresh
   - **New endpoint**: `/api/cron/trigger-transfer` (cron-only, no cache invalidation)
   - **Existing endpoint**: `/api/cron/refresh-cache` (called after transfer completes)

### 5. Files to Modify

1. `vercel.json` - Add new cron jobs
2. `src/components/dashboard/DataFreshnessIndicator.tsx` - Add transfer trigger UI
3. `src/lib/api-client.ts` - Add transfer trigger API calls
4. `src/lib/bigquery.ts` - Add Data Transfer client initialization
5. `src/lib/permissions.ts` - Update admin check to include manager (optional)

### 6. New Files to Create

1. `src/app/api/admin/trigger-transfer/route.ts` - Transfer trigger endpoint
2. `src/app/api/cron/trigger-transfer/route.ts` - Cron-triggered transfer endpoint
3. `src/lib/queries/data-transfer.ts` - Data Transfer API wrapper functions
4. `src/components/dashboard/TransferProgressModal.tsx` - Progress indicator modal (optional)
5. `src/types/data-transfer.ts` - TypeScript types for transfer operations

### 7. Environment Variables

**New environment variables needed**:
- ✅ **None** - Can reuse `GOOGLE_APPLICATION_CREDENTIALS_JSON`
- ⚠️ **Verify**: Service account has `bigquery.transfers.update` IAM permission

### 8. Testing Strategy

**Before deploying**:

1. **Local Testing**:
   - Test transfer trigger endpoint with Postman/curl
   - Verify service account permissions
   - Test polling mechanism with mock transfer runs
   - Test error handling (failed transfers, timeouts)

2. **Staging Testing**:
   - Deploy to Vercel preview environment
   - Test admin transfer trigger from UI
   - Verify cron jobs execute (check Vercel logs)
   - Test cache invalidation after transfer completes
   - Test rate limiting/cooldown mechanism

3. **Production Rollout**:
   - Deploy cron jobs one at a time
   - Monitor first few transfer triggers
   - Verify cache invalidation timing
   - Check Vercel function logs for errors
   - Monitor Sentry for any errors

4. **Verification Checklist**:
   - [ ] Transfer triggers successfully
   - [ ] Transfer status polling works
   - [ ] Cache invalidates after transfer completes
   - [ ] UI shows progress/errors correctly
   - [ ] Rate limiting prevents abuse
   - [ ] Cron jobs execute on schedule
   - [ ] Error handling works for failed transfers
   - [ ] Admin/manager permissions enforced

---

## Additional Notes

### ⚠️ Critical Considerations

1. **Service Account Permissions**: Must verify service account has `bigquery.transfers.update` permission
2. **Cron Job Limits**: Check Vercel plan limits for number of cron jobs (may need to consolidate)
3. **Transfer Duration**: BigQuery transfers can take 5-15 minutes - need async polling
4. **Cache Timing**: Consider invalidating cache AFTER transfer completes, not before
5. **Error Handling**: Need robust error handling for transfer failures and API errors

### 💡 Recommendations

1. **Add Toast Library**: Consider `react-hot-toast` or `sonner` for better UX
2. **Background Jobs**: Consider Vercel Background Functions for long-running transfer polling
3. **Monitoring**: Add Sentry tracking for transfer trigger events
4. **Documentation**: Document transfer schedule and expected completion times
5. **Fallback**: Keep manual cache refresh button as fallback if transfers fail

---

*Analysis completed: 2026-01-20*
*Next steps: Implement transfer trigger endpoint and update UI components*
