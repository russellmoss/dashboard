# Savvy Dashboard — Architecture Reference

> **Purpose**: Single source of truth for architectural patterns, decisions, and domain knowledge.  
> **Audience**: AI agents (Cursor, Claude), developers, maintainers  
> **Status**: Living document — Cursor should validate against actual codebase and update as needed

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Data Layer](#2-data-layer)
3. [Caching Strategy](#3-caching-strategy)
4. [Data Freshness](#4-data-freshness)
5. [Authentication & Permissions](#5-authentication--permissions)
6. [Core Dashboard Features](#6-core-dashboard-features)
7. [Advanced Features](#7-advanced-features)
8. [SGA Hub & Management](#8-sga-hub--management)
9. [Self-Serve Analytics (Explore)](#9-self-serve-analytics-explore)
10. [Deployment & Operations](#10-deployment--operations)
11. [GC Hub](#11-gc-hub)
12. [Dashboard Requests](#12-dashboard-requests)
13. [Recruiter Hub](#13-recruiter-hub)
14. [Advisor Map](#14-advisor-map)
15. [Pipeline Catcher Game](#15-pipeline-catcher-game)
16. [SGA Activity](#16-sga-activity)
17. [Saved Reports](#17-saved-reports)

---

## 1. System Overview

### What This Dashboard Does

Replaces Tableau for Savvy Wealth's **recruiting funnel analytics**. Tracks financial advisor prospects from initial contact through joining as 1099 employees.

### Tech Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Framework** | Next.js 14 (App Router) | SSR, API routes, caching |
| **UI Components** | Tremor React, Recharts | Charts, tables, cards |
| **Styling** | Tailwind CSS | Utility-first CSS, dark mode |
| **Authentication** | NextAuth.js | Email/password auth |
| **Database** | Google BigQuery | Analytics data warehouse |
| **User Data** | PostgreSQL (Prisma) | Users, goals, permissions |
| **Deployment** | Vercel | Serverless, edge, cron |
| **Monitoring** | Sentry | Error tracking, logging |

### Data Flow

```
Salesforce → BigQuery (daily sync) → Next.js API → React Dashboard
                ↓
         vw_funnel_master (pre-computed view)
```

### Key Principle: Single Source of Truth

All funnel metrics derive from the `vw_funnel_master` BigQuery view, which:
- Joins Leads and Opportunities with proper deduplication
- Pre-computes conversion flags (`is_sql`, `is_sqo`, `is_joined`)
- Pre-computes eligibility flags for conversion rate denominators
- Handles SGA/SGM attribution at both lead and opportunity levels

---

## 2. Data Layer

### BigQuery Connection

**Location**: `src/lib/bigquery.ts`

**Authentication Methods**:
- **Local development**: File path via `GOOGLE_APPLICATION_CREDENTIALS`
- **Vercel production**: JSON string via `GOOGLE_APPLICATION_CREDENTIALS_JSON`

**Client Initialization**: `getBigQueryClient()` returns singleton BigQuery client with proper credentials handling.

**Query Pattern**: Always use parameterized queries to prevent SQL injection:

```typescript
// ✅ CORRECT: Parameterized
import { runQuery } from '@/lib/bigquery';

const query = `SELECT * FROM table WHERE channel = @channel`;
const params = { channel: filterValue };
const results = await runQuery<ResultType>(query, params);

// ❌ WRONG: String interpolation
const query = `SELECT * FROM table WHERE channel = '${filterValue}'`;
```

**Function Signature**:
```typescript
export async function runQuery<T>(query: string, params?: Record<string, any>): Promise<T[]>
```

**Helper Function**: `buildQueryParams()` constructs WHERE conditions and params object for common filters (startDate, endDate, channel, source, sga, sgm).

### Primary Data Sources

| Table/View | Purpose |
|------------|---------|
| `Tableau_Views.vw_funnel_master` | Main funnel data (single source of truth) |
| `SavvyGTMData.new_mapping` | Channel grouping mapping |
| `SavvyGTMData.q4_2025_forecast` | Forecast/goal targets |
| `SavvyGTMData.Lead` | Raw Salesforce leads |
| `SavvyGTMData.Opportunity` | Raw Salesforce opportunities |

### Critical Fields in vw_funnel_master

**Date Fields** (each metric uses a specific date):

| Metric | Date Field | Type |
|--------|------------|------|
| Prospects | `FilterDate` | TIMESTAMP |
| Contacted | `stage_entered_contacting__c` | TIMESTAMP |
| MQLs | `mql_stage_entered_ts` | TIMESTAMP |
| SQLs | `converted_date_raw` | DATE |
| SQOs | `Date_Became_SQO__c` | TIMESTAMP |
| Joined | `advisor_join_date__c` | DATE |

**Funnel Flags** (boolean indicators):
- `is_contacted`, `is_mql`, `is_sql`, `is_sqo`, `is_joined`

**Deduplication Flags** (for opportunity-level metrics):
- `is_sqo_unique` — Count each SQO once
- `is_joined_unique` — Count each Joined once
- `is_primary_opp_record` — Primary opportunity for AUM

**Conversion Progression Flags**:
- `contacted_to_mql_progression`, `mql_to_sql_progression`, etc.

**Eligibility Flags** (for conversion rate denominators):
- `eligible_for_contacted_conversions_30d` (Contacted→MQL; 30-day effective resolution), `eligible_for_contacted_conversions` (legacy), `eligible_for_mql_conversions`, etc.

### DATE vs TIMESTAMP Handling

**Critical Rule**: Always ensure type consistency in comparisons. Use the correct wrapper based on field type.

```sql
-- ✅ CORRECT: DATE field with DATE wrapper
WHERE DATE(v.converted_date_raw) >= DATE('2025-10-01')

-- ✅ CORRECT: TIMESTAMP field with TIMESTAMP wrapper  
WHERE TIMESTAMP(v.FilterDate) >= TIMESTAMP('2025-10-01')

-- ❌ WRONG: Mixing types causes BigQuery errors
WHERE TIMESTAMP(v.converted_date_raw) >= DATE('2025-10-01')
```

**Field Type Reference**:
- **DATE fields** (use `DATE()` wrapper): `converted_date_raw`, `advisor_join_date__c`, `Initial_Call_Scheduled_Date__c`, `Qualification_Call_Date__c`
- **TIMESTAMP fields** (use `TIMESTAMP()` wrapper): `FilterDate`, `stage_entered_contacting__c`, `mql_stage_entered_ts`, `Date_Became_SQO__c`, `Opp_CreatedDate`

**⚠️ Parameter Type Conflict**: When a query uses both DATE and TIMESTAMP fields, using the same parameter with both wrappers causes BigQuery type inference errors. Use separate parameters:

```sql
-- ✅ CORRECT: Separate parameters for DATE vs TIMESTAMP
-- Parameters:
--   startDate: '2025-01-01' (for DATE() comparisons)
--   startDateTimestamp: '2025-01-01 00:00:00' (for TIMESTAMP() comparisons)

WHERE DATE(v.converted_date_raw) >= DATE(@startDate)
  AND TIMESTAMP(v.FilterDate) >= TIMESTAMP(@startDateTimestamp)

-- ❌ WRONG: Same parameter with different wrappers causes type conflict
WHERE DATE(v.converted_date_raw) >= DATE(@startDate)
  AND TIMESTAMP(v.FilterDate) >= TIMESTAMP(@startDate)  -- Error: type mismatch
```

**Pattern**: In `source-performance.ts`, we use:
- `startDate` / `endDate` — plain date strings (YYYY-MM-DD) for `DATE()` comparisons
- `startDateTimestamp` / `endDateTimestamp` — date strings with time (YYYY-MM-DD HH:MM:SS) for `TIMESTAMP()` comparisons

### Channel Mapping Pattern

Always use COALESCE with the mapping table:

```sql
SELECT 
  COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') as channel
FROM vw_funnel_master v
LEFT JOIN new_mapping nm ON v.Original_source = nm.original_source
```

### SGA/SGM Filtering

**Lead-level metrics** (Prospects, Contacted, MQL, SQL):
```sql
WHERE v.SGA_Owner_Name__c = @sgaName
```

**Opportunity-level metrics** (SQO, Joined, AUM):
```sql
WHERE (v.SGA_Owner_Name__c = @sgaName OR v.Opp_SGA_Name__c = @sgaName)
```

**Rationale**: Opportunities can be re-assigned, so check both lead and opportunity ownership.

### Record Type Filtering

SQO and pipeline calculations require recruiting record type:
```sql
WHERE recordtypeid = '012Dn000000mrO3IAI'  -- Recruiting
```

**Constants**:
- `RECRUITING_RECORD_TYPE = '012Dn000000mrO3IAI'` (from `src/config/constants.ts`)
- `RE_ENGAGEMENT_RECORD_TYPE = '012VS000009VoxrYAC'` (also defined but less commonly used)

---

## 3. Caching Strategy

### Approach

Uses Next.js `unstable_cache()` with tag-based invalidation. Chosen over Redis for simplicity — no external infrastructure needed.

### Cache Tags

| Tag | Scope |
|-----|-------|
| `dashboard` | Main funnel queries, conversion rates, source performance |
| `sga-hub` | SGA-specific queries (weekly actuals, quarterly progress) |

### TTL Policy

| Query Type | TTL | Rationale |
|------------|-----|-----------|
| Standard queries | 12 hours | Aligns with daily BigQuery sync |
| Detail records | 6 hours | Large payloads (up to 95k rows) |

### Cache Key Generation

Automatic via Next.js serialization of function arguments:
- `getFunnelMetrics({ channel: 'Web' })` → Cache Key A
- `getFunnelMetrics({ channel: 'Paid Search' })` → Cache Key B
- Same filters = cache hit, different filters = cache miss

### Wrapper Pattern

```typescript
// Internal function (not exported directly)
const _getFunnelMetrics = async (filters: DashboardFilters) => {
  // ... query logic
};

// Export cached version
export const getFunnelMetrics = cachedQuery(
  _getFunnelMetrics,
  'getFunnelMetrics',      // Explicit key name (required for arrow functions)
  CACHE_TAGS.DASHBOARD     // Tag for invalidation
);
```

### Invalidation Triggers

| Trigger | When | How |
|---------|------|-----|
| **Daily Cron** | 12 AM EST | Vercel cron calls refresh endpoint |
| **Manual Admin** | On demand | Admin clicks refresh button |
| **API Endpoint** | Programmatic | `POST /api/admin/refresh-cache` |

### Cron Schedule

**Location**: `vercel.json` (root directory)

```json
{
  "crons": [
    {
      "path": "/api/cron/refresh-cache",
      "schedule": "0 5 * * *"  // 5 AM UTC = 12 AM EST
    }
  ]
}
```

**Route Implementation**: `src/app/api/cron/refresh-cache/route.ts`
- Validates `CRON_SECRET` from Authorization header (auto-injected by Vercel)
- Calls `revalidateTag()` for both `dashboard` and `sga-hub` tags

**Rationale**: Runs after 11:30 PM BigQuery daily sync, ensures morning users get fresh data.

### Cache Miss Logging

All cache misses are logged for monitoring:
```
[Cache Miss] getFunnelMetrics { keyName, tag, argsCount }
```

Check logs to identify frequently missed queries or unusual patterns.

### Rollback Strategy

If caching causes issues:
1. **Immediate**: Remove `cachedQuery()` wrapper from affected function
2. **Full**: Revert commits, cache expires naturally in 12 hours
3. **Force refresh**: Call `/api/admin/refresh-cache` or wait for TTL

---

## 4. Data Freshness

### Purpose

Shows users when BigQuery data was last synced from Salesforce. Prevents confusion when recent Salesforce changes don't appear immediately.

### How It Works

Queries BigQuery's `__TABLES__` metadata to get `last_modified_time` for Lead and Opportunity tables:

```sql
SELECT 
  MAX(last_data_load) as last_updated,
  TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), MAX(last_data_load), HOUR) as hours_ago
FROM (
  SELECT TIMESTAMP_MILLIS(last_modified_time) as last_data_load
  FROM `savvy-gtm-analytics.SavvyGTMData.__TABLES__`
  WHERE table_id IN ('Lead', 'Opportunity')
)
```

### Status Thresholds

| Status | Age | Color | Meaning |
|--------|-----|-------|---------|
| `fresh` | < 1 hour | Green | Data just synced |
| `recent` | 1-6 hours | Yellow | Normal freshness |
| `stale` | 6-24 hours | Orange | Getting old |
| `very_stale` | > 24 hours | Red | Sync may have failed |

### Display Locations

| Location | Variant | Shows |
|----------|---------|-------|
| Header | Compact | Relative time ("2h ago") |
| GlobalFilters | Detailed | Full timestamp + status badge |

### Caching

- **API TTL**: 5 minutes with stale-while-revalidate
- **Frontend refresh**: Polls every 5 minutes

### Admin Refresh Button

Visible only to admin users in the detailed variant. Calls cache refresh endpoint to force data reload.

---

## 5. Authentication & Permissions

### Authentication Method

**Email/Password via NextAuth.js** (not OAuth). Chosen to avoid GCP OAuth setup complexity.

### Session Strategy

- **Type**: JWT tokens
- **Duration**: 24 hours
- **Storage**: HTTP-only cookies

### Password Handling

- **Hashing**: bcrypt with salt rounds
- **Storage**: PostgreSQL via Prisma (or JSON file for simple deployments)
- **Reset**: Admin-initiated password reset via Settings page

### Role Hierarchy

| Role | Description | Data Access |
|------|-------------|-------------|
| `admin` | Full system access | All data, all pages, user management |
| `manager` | Team oversight | All data, most pages, no user management |
| `sgm` | Sales Growth Manager | Filtered to their team's data |
| `sga` | Sales Growth Advisor | Filtered to their own data only |
| `viewer` | Read-only access | Limited pages, no export |

### Permission Properties

**Location**: `src/types/user.ts`

```typescript
interface UserPermissions {
  role: 'admin' | 'manager' | 'sgm' | 'sga' | 'viewer';
  allowedPages: number[];      // Page IDs user can access
  sgaFilter: string | null;    // If SGA, filter to their name
  sgmFilter: string | null;    // If SGM, filter to their team
  canExport: boolean;          // Can use export features
  canManageUsers: boolean;     // Can manage users (admin/manager only)
}
```

**Implementation**: `src/lib/permissions.ts` defines `ROLE_PERMISSIONS` with base permissions, then adds `sgaFilter`/`sgmFilter` based on user's role and name.

### Page Access Control

| Page ID | Page Name | Route | admin | manager | sgm | sga | viewer |
|---------|-----------|-------|-------|---------|-----|-----|--------|
| 1 | Funnel Performance | `/dashboard` | ✅ | ✅ | ✅ | ✅ | ✅ |
| 2 | Channel Drilldown | `/dashboard/channels` | ✅ | ✅ | ✅ | ✅ | ✅ |
| 3 | Open Pipeline | `/dashboard/pipeline` | ✅ | ✅ | ✅ | ❌ | ❌ |
| 4 | Partner Performance | `/dashboard/partners` | ✅ | ✅ | ❌ | ❌ | ❌ |
| 5 | Experimentation | `/dashboard/experiments` | ✅ | ✅ | ❌ | ❌ | ❌ |
| 6 | SGA Performance | `/dashboard/sga` | ✅ | ✅ | ✅ | ✅ | ❌ |
| 7 | Settings | `/dashboard/settings` | ✅ | ✅ | ✅ | ✅ | ❌ |
| 8 | SGA Hub | `/dashboard/sga-hub` | ✅ | ✅ | ❌ | ✅ | ❌ |
| 9 | SGA Management | `/dashboard/sga-management` | ✅ | ✅ | ❌ | ❌ | ❌ |
| 10 | Explore (AI) | `/dashboard/explore` | ✅ | ✅ | ✅ | ✅ | ❌ |

**Note**: Pages 3, 4, 5 are defined in sidebar but routes may not be fully implemented yet.

**Note**: SGAs access SGA Hub (page 8) to view their own performance. SGMs do not need SGA Hub as they manage BoF (SQO→Joined), not ToF activities.

### Automatic Data Filtering

When user has `sgaFilter` or `sgmFilter` set, all queries automatically apply that filter:

```typescript
// In API routes
const permissions = await getUserPermissions(session.user.email);
const filters = {
  ...requestFilters,
  sga: permissions.sgaFilter || requestFilters.sga,
  sgm: permissions.sgmFilter || requestFilters.sgm,
};
```

### Middleware Protection

Routes protected via Next.js middleware:

```typescript
export const config = {
  matcher: ['/dashboard/:path*', '/api/dashboard/:path*'],
};
```

Unauthenticated requests redirect to `/login`.

---

## 6. Core Dashboard Features

### Funnel Stages

The recruiting funnel has six stages, displayed in two view modes:

| Stage | Date Field | Filter Flag | Deduplication |
|-------|------------|-------------|---------------|
| **Prospect** | `FilterDate` | (none) | — |
| **Contacted** | `stage_entered_contacting__c` | `is_contacted = 1` | — |
| **MQL** | `mql_stage_entered_ts` | `is_mql = 1` | — |
| **SQL** | `converted_date_raw` | `is_sql = 1` | — |
| **SQO** | `Date_Became_SQO__c` | `is_sqo_unique = 1` | + `recordtypeid` filter |
| **Joined** | `advisor_join_date__c` | `is_joined_unique = 1` | — |

### View Modes

| Mode | Shows | Default |
|------|-------|---------|
| **Focused View** | SQL, SQO, Joined | ✅ Yes |
| **Full Funnel View** | All 6 stages | No |

Toggle is a frontend-only control — backend always returns all metrics.

### Scorecards

Display key metrics with optional goal comparison:

```typescript
interface FunnelMetrics {
  prospects: number;
  contacted: number;
  mqls: number;
  sqls: number;
  sqos: number;
  joined: number;
  pipelineAum: number;
  joinedAum: number;
  openPipelineAum: number;
}
```

Goals come from `vw_daily_forecast` table, aggregated by `getAggregateForecastGoals()`.

### Conversion Rates

Four conversion rate cards, each showing:
- Rate percentage
- Numerator / Denominator
- Trend sparkline (optional)

| Conversion | Numerator Flag | Denominator Flag |
|------------|----------------|------------------|
| Contacted → MQL | `contacted_to_mql_progression` | `eligible_for_contacted_conversions_30d` |
| MQL → SQL | `mql_to_sql_progression` | `eligible_for_mql_conversions` |
| SQL → SQO | `sql_to_sqo_progression` | `eligible_for_sql_conversions` |
| SQO → Joined | `sqo_to_joined_progression` | `eligible_for_sqo_conversions` |

**Conversion Rate Modes**:
- **Period Mode**: Activity-based, numerator/denominator from different populations, rates can exceed 100%
- **Cohort Mode**: Tracks how leads from a period ultimately convert, rates always 0-100%

### Channel/Source Performance Tables

Aggregate metrics by channel or source with columns:
- Volume metrics (Prospects, Contacted, MQL, SQL, SQO, Joined)
- Conversion rates
- AUM totals
- Goal comparisons (in Full Funnel View)

**Channel Mapping**: Always use COALESCE pattern to handle unmapped sources.

### Detail Records Table

Shows individual records with:
- Pagination (50 records per page)
- Multi-column sorting
- Search across: Advisor, SGA, SGM, Source, Channel
- Metric filter (click scorecard to filter)
- Row click opens Record Detail Modal

**Query Limit**: 50,000 records (increased from 500).

**Location**: `src/lib/queries/detail-records.ts`
- Uses `LIMIT 50000` in SQL query
- Frontend pagination shows 50 records per page

### Global Filters

Available filters applied to all queries:
- **Date Preset**: YTD, QTD, Q1-Q4, Last 30/90 days, Custom
- **Year**: Defaults to current year
- **Channel**: From distinct values in data
- **Source**: From distinct values in data
- **SGA**: From distinct values (may be auto-set by permissions)
- **SGM**: From distinct values (may be auto-set by permissions)

### API Route Pattern

All dashboard API routes use **POST with JSON body**:

```typescript
// ✅ CORRECT
const response = await fetch('/api/dashboard/funnel-metrics', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ filters, viewMode }),
});

// ❌ WRONG (don't use GET with query params)
const response = await fetch('/api/dashboard/funnel-metrics?channel=Web');
```

**Complete API Route List** (verified against codebase):

**Dashboard Routes**:
- `/api/dashboard/funnel-metrics` - Main funnel metrics
- `/api/dashboard/conversion-rates` - Conversion rate calculations
- `/api/dashboard/source-performance` - Source/channel breakdown
- `/api/dashboard/detail-records` - Individual records table
- `/api/dashboard/record-detail/[id]` - Single record details
- `/api/dashboard/export-sheets` - Google Sheets export
- `/api/dashboard/data-freshness` - BigQuery sync status
- `/api/dashboard/filters` - Available filter options
- `/api/dashboard/forecast` - Forecast/goal data
- `/api/dashboard/open-pipeline` - Open pipeline AUM

**SGA Hub Routes**:
- `/api/sga-hub/weekly-goals` - Weekly goal management
- `/api/sga-hub/weekly-actuals` - Weekly actuals from BigQuery
- `/api/sga-hub/quarterly-progress` - Quarterly SQO progress
- `/api/sga-hub/quarterly-goals` - Quarterly goal management
- `/api/sga-hub/closed-lost` - Closed lost opportunities
- `/api/sga-hub/sqo-details` - SQO details for quarter
- `/api/sga-hub/re-engagement` - Re-engagement opportunities
- `/api/sga-hub/drill-down/initial-calls` - Initial calls drill-down
- `/api/sga-hub/drill-down/qualification-calls` - Qualification calls drill-down
- `/api/sga-hub/drill-down/sqos` - SQOs drill-down

**Admin Routes**:
- `/api/admin/refresh-cache` - Manual cache invalidation
- `/api/admin/sga-overview` - Admin SGA overview

**Other Routes**:
- `/api/agent/query` - AI agent query (Explore feature)
- `/api/explore/feedback` - Explore feature feedback
- `/api/cron/refresh-cache` - Scheduled cache refresh (Vercel cron)
- `/api/auth/[...nextauth]` - NextAuth authentication
- `/api/users` - User management
- `/api/users/[id]` - Individual user operations
- `/api/users/[id]/reset-password` - Password reset

---

## 7. Advanced Features

### 7.1 Full Funnel View Toggle

**Purpose**: Switch between executive view (SQL/SQO/Joined) and complete funnel view (all 6 stages).

**Implementation**:
- `ViewMode` type: `'focused' | 'fullFunnel'`
- State managed in dashboard page via `useState`
- Toggle component shows/hides top-of-funnel scorecards
- Tables conditionally display extended columns

**Metric Filter Extension**:
```typescript
type MetricFilter = 'all' | 'prospect' | 'contacted' | 'mql' | 'sql' | 'sqo' | 'joined' | 'openPipeline';
```

### 7.2 Record Detail Modal

**Purpose**: Click any row in Detail Records table to see full record information.

**Architecture**:
```
Table Row Click → API: GET /api/dashboard/record-detail/[id] → Modal Display
```

**Modal Sections**:
1. **Header**: Advisor name, stage badge, Salesforce links
2. **Funnel Progress**: Visual stepper showing completed stages
3. **Attribution**: Source, channel, SGA, SGM
4. **Key Dates**: All stage entry timestamps
5. **Financials**: AUM, opportunity details
6. **Status**: Current stage, record type

**Date Field Handling**:
- **DATE fields** (`converted_date_raw`, `advisor_join_date__c`, `Initial_Call_Scheduled_Date__c`, `Qualification_Call_Date__c`): Returned as strings, use `toString()` helper from `src/types/bigquery-raw.ts`
- **TIMESTAMP fields**: May return as `{ value: string }` or string, use `extractDateValue()` helper

**Helper Functions** (from `src/types/bigquery-raw.ts`):
- `toNumber(value)` - Converts BigQuery number results (handles null/undefined)
- `toString(value)` - Converts BigQuery string results (handles null/undefined)

**Timezone Fix**: DATE fields parsed as local dates to prevent day-shift:
```typescript
// Parse YYYY-MM-DD as local date, not UTC
const [year, month, day] = dateString.split('-').map(Number);
const date = new Date(year, month - 1, day);
```

**Component Location**: `src/components/dashboard/RecordDetailModal.tsx`

**State Management**: Modal state lives in dashboard page:
```typescript
const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
```

### 7.3 Google Sheets Export

**Purpose**: Export dashboard data to Google Sheets for validation and sharing.

**Constraint**: Service account can EDIT and COPY but cannot CREATE sheets. Uses **template copy approach**.

**Template**: Pre-created Google Sheet that gets copied for each export.
- Template ID: `143rmkaleDkDJGthNorETWtmYksj8XJGMrQ639LJwLGE`
- Shared with service account as Editor

**Export Tabs**:
1. **Dashboard Summary**: Current filter settings, metrics overview
2. **Detail Records**: All records matching current filters
3. **Source Performance**: Aggregated by source
4. **Conversion Rates**: Rate calculations with numerator/denominator
5. **Validation**: Formulas to cross-check dashboard accuracy

**Flow**:
```
User clicks Export → API copies template → Populates data → Shares with user → Opens in new tab
```

**API Route**: `POST /api/dashboard/export-sheets`
- **Location**: `src/app/api/dashboard/export-sheets/route.ts`
- Timeout: 60 seconds (configured in vercel.json)
- Max records: 10,000 (configurable)

**Implementation**:
- **Exporter Class**: `src/lib/sheets/google-sheets-exporter.ts` (`GoogleSheetsExporter`)
- **Types**: `src/lib/sheets/sheets-types.ts`
- Uses Google Sheets API v4 via `googleapis` package

**Credentials**:
- **Local**: File path via `GOOGLE_SHEETS_SERVICE_ACCOUNT_PATH`
- **Vercel**: Single-line JSON via `GOOGLE_SHEETS_CREDENTIALS_JSON`

**Template ID**: `143rmkaleDkDJGthNorETWtmYksj8XJGMrQ639LJwLGE` (hardcoded in exporter)

**Rate Limiting**: Writes in chunks with 100ms delay between batches to avoid Google API limits.

**Error Handling**:
- Template not accessible → Check service account sharing
- Rate limit exceeded → Increase chunk delay
- Timeout → Reduce max records or increase Vercel function timeout

---

## 8. SGA Hub & Management

### Overview

Two related pages for SGA performance tracking:

| Page | ID | Purpose | Access |
|------|-----|---------|--------|
| **SGA Hub** | 8 | Individual SGA views their own performance | admin, manager, sga |
| **SGA Management** | 9 | Admin/manager overview of all SGAs | admin, manager |

### SGA Hub Tabs

#### 1. Weekly Goals Tab

Tracks weekly activity metrics against goals:

| Metric | Date Field | Filter |
|--------|------------|--------|
| Initial Calls | `Initial_Call_Scheduled_Date__c` (DATE) | Week range |
| Qualification Calls | `Qualification_Call_Date__c` (DATE) | Week range |
| SQOs | `Date_Became_SQO__c` (TIMESTAMP) | Week range + `is_sqo_unique=1` + `recordtypeid` |

**Call Timing in Funnel**:
- Initial Calls occur between MQL and SQL (SGA schedules and conducts)
- Qualification Calls occur after SQL conversion (SGA + SGM conduct together to determine SQO eligibility)

**Week Definition**: Monday-Sunday, calculated with `DATE_TRUNC(..., WEEK(MONDAY))`

**Goal Storage**: PostgreSQL via Prisma `WeeklyGoal` model:
```prisma
model WeeklyGoal {
  id                     String   @id @default(cuid())
  userEmail              String   // Links to User.email - matches SGA_Owner_Name__c via User.name
  weekStartDate          DateTime @db.Date // Monday of the week (DATE only)
  initialCallsGoal       Int      @default(0)
  qualificationCallsGoal Int      @default(0)
  sqoGoal                Int      @default(0)
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt
  createdBy              String?  // Email of user who created
  updatedBy              String?  // Email of user who last updated

  @@unique([userEmail, weekStartDate])
  @@index([userEmail])
  @@index([weekStartDate])
}
```

**Edit Permissions**:
- **SGAs**: Can only edit current and future weeks (not past)
- **Admins/Managers**: Can edit any week for any SGA

#### 2. Quarterly Progress Tab

Tracks SQO progress toward quarterly goals:

| Metric | Calculation |
|--------|-------------|
| SQO Count | `is_sqo_unique=1` + `recordtypeid` + quarter date range |
| SQO Goal | From `QuarterlyGoal` Prisma model |
| Pacing | (Actual / Expected at this point in quarter) |

**Quarter Format**: `2025-Q4`

**Goal Storage**: PostgreSQL via Prisma `QuarterlyGoal` model:
```prisma
model QuarterlyGoal {
  id        String   @id @default(cuid())
  userEmail String   // Links to User.email
  quarter   String   // Format: "2026-Q1", "2026-Q2", etc.
  sqoGoal   Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  createdBy String?  // Email of admin who set it
  updatedBy String?  // Email of admin who last updated

  @@unique([userEmail, quarter])
  @@index([userEmail])
  @@index([quarter])
}
```

#### 3. Closed Lost Tab

Shows opportunities that closed lost and have **not yet been re-engaged**. These are candidates for potential re-engagement outreach.

**Data Source**: `savvy-gtm-analytics.savvy_analytics.vw_sga_closed_lost_sql_followup`

**Categories**:
- **30-179 days**: Recent closed lost, higher priority for re-engagement
- **180+ days**: Older closed lost, lower priority

**Filter**: By `sga_name` field (exact match to user's name)

**Next Step**: If SGA decides to re-engage, a Re-engagement opportunity is created (see Re-Engagement Tab).

#### 4. Re-Engagement Tab

Shows active re-engagement opportunities that SGAs are currently working.

**What is Re-Engagement?**
- People we previously engaged with and closed lost
- We are NOW actively re-engaging with them
- A special "Re-engagement" record type opportunity is created

**Record Type**: `RE_ENGAGEMENT_RECORD_TYPE = '012VS000009VoxrYAC'`

**Key Distinction**:
- A person can have BOTH a Recruiting opportunity AND a Re-engagement opportunity simultaneously
- Recruiting opportunity: Original recruitment attempt
- Re-engagement opportunity: New attempt to recruit someone we previously closed lost

**Difference from Closed Lost Tab**:
| Tab | Shows | Purpose |
|-----|-------|---------|
| **Closed Lost** | Opportunities we closed lost but haven't re-engaged yet | Find candidates for re-engagement |
| **Re-Engagement** | Active re-engagement opportunities being worked | Track current re-engagement efforts |

**Data Source**: Re-engagement opportunities from BigQuery
**API Route**: `/api/sga-hub/re-engagement`

### SGA Management Page (Admin)

Overview dashboard showing all active SGAs:

**Summary Cards**:
- Total active SGAs
- SGAs behind pacing
- SGAs missing weekly goals
- SGAs missing quarterly goals

**Admin SGA Table**:
- All SGAs with current week/quarter metrics
- Expandable rows for detail view
- Clickable metrics open drill-down modal
- Filter by week/quarter

**Bulk Goal Editor**:
- Set weekly or quarterly goals for multiple SGAs at once
- Individual goal editing via row actions

### Drill-Down Modals

Click any metric value to see underlying records:

| Metric | API Route | Records Shown |
|--------|-----------|---------------|
| Initial Calls | `/api/sga-hub/drill-down/initial-calls` | Leads with initial call in period |
| Qualification Calls | `/api/sga-hub/drill-down/qualification-calls` | Leads with qual call in period |
| SQOs | `/api/sga-hub/drill-down/sqos` | Opportunities that became SQO |

**Nested Modal Flow**:
```
Metric Click → Drill-Down Modal → Row Click → Record Detail Modal
                                      ↑
                        "← Back" button returns here
```

**MetricDrillDownModal Component**: Shared component used by both SGA Hub and SGA Management.

### SGA Name Matching

**Critical**: SGA filtering requires exact name match between:
- `user.name` in Prisma User table
- `SGA_Owner_Name__c` in BigQuery vw_funnel_master

**Case-sensitive** — names must match exactly.

### DATE vs TIMESTAMP Handling (SGA Queries)

| Field | Type | Comparison Pattern |
|-------|------|-------------------|
| `Initial_Call_Scheduled_Date__c` | DATE | Direct: `>= @startDate` |
| `Qualification_Call_Date__c` | DATE | Direct: `>= @startDate` |
| `Date_Became_SQO__c` | TIMESTAMP | Wrapped: `>= TIMESTAMP(@startDate)` |

**Week Join Pattern**: Cast TIMESTAMP to DATE when grouping:
```sql
DATE(DATE_TRUNC(Date_Became_SQO__c, WEEK(MONDAY))) as week_start
```

### CSV Export

All tabs support CSV export:
- `exportWeeklyGoalsCSV()` — Weekly goals with actuals
- `exportQuarterlyProgressCSV()` — Quarterly progress data
- `exportClosedLostCSV()` — Closed lost records
- `exportAdminOverviewCSV()` — Admin SGA overview

### API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/sga-hub/weekly-goals` | GET/POST | Get/set weekly goals |
| `/api/sga-hub/weekly-actuals` | GET | Get actuals from BigQuery |
| `/api/sga-hub/quarterly-progress` | GET | Get quarterly SQO progress |
| `/api/sga-hub/quarterly-goals` | GET/POST | Get/set quarterly goals |
| `/api/sga-hub/closed-lost` | GET | Get closed lost records |
| `/api/sga-hub/sqo-details` | GET | Get SQO details for current quarter |
| `/api/sga-hub/re-engagement` | GET | Get re-engagement opportunities |
| `/api/sga-hub/drill-down/initial-calls` | POST | Drill-down for initial calls |
| `/api/sga-hub/drill-down/qualification-calls` | POST | Drill-down for qual calls |
| `/api/sga-hub/drill-down/sqos` | POST | Drill-down for SQOs |
| `/api/admin/sga-overview` | GET | Admin overview of all SGAs |

---

## 9. Self-Serve Analytics (Explore)

### Overview

AI-powered natural language query interface for funnel analytics. Users ask questions in plain English; Claude interprets and generates SQL via a semantic layer.

**Entry Point**: `/dashboard/explore` (Page ID 10, robot icon in sidebar)

**Status**: ✅ **Live in Production**

**Access**: admin, manager, sgm, sga (not viewer)

### Architecture

```
User Question → Claude API → Template Selection → Query Compiler → BigQuery → Visualization
                   ↓
            Semantic Layer (metrics, dimensions, templates, presets)
```

### Key Components

| Component | File Location | Purpose |
|-----------|---------------|---------|
| **Semantic Layer** | `src/lib/semantic-layer/` | Metric/dimension definitions |
| **Query Compiler** | `src/lib/semantic-layer/query-compiler.ts` | Generates SQL from templates |
| **Agent Prompt** | `src/lib/semantic-layer/agent-prompt.ts` | Claude system prompt |
| **API Route** | `src/app/api/agent/query/route.ts` | Handles requests, calls Claude |
| **Explore Page** | `src/app/dashboard/explore/page.tsx` | Main UI |
| **Results Display** | `src/components/dashboard/ExploreResults.tsx` | Charts/tables |

### Semantic Layer Structure

#### Metrics

Pre-defined calculations with proper date fields and filters. **Location**: `src/lib/semantic-layer/definitions.ts` (`VOLUME_METRICS` object)

| Metric | Date Field | Filter | Level | Date Type |
|--------|------------|--------|-------|-----------|
| `prospects` | `FilterDate` | (none) | Lead | TIMESTAMP |
| `contacted` | `stage_entered_contacting__c` | `is_contacted=1` | Lead | TIMESTAMP |
| `mqls` | `mql_stage_entered_ts` | `is_mql=1` | Lead | TIMESTAMP |
| `sqls` | `converted_date_raw` | `is_sql=1` | Lead | **DATE** |
| `sqos` | `Date_Became_SQO__c` | `is_sqo_unique=1` + `recordtypeid` | Opportunity | TIMESTAMP |
| `joined` | `advisor_join_date__c` | `is_joined_unique=1` | Opportunity | **DATE** |
| `initial_calls_scheduled` | `Initial_Call_Scheduled_Date__c` | (none) | Lead | **DATE** |
| `qualification_calls` | `Qualification_Call_Date__c` | (none) | Opportunity | **DATE** |
| `pipeline_aum` | `Date_Became_SQO__c` | Open pipeline stages | Opportunity | TIMESTAMP |
| `joined_aum` | `advisor_join_date__c` | `is_joined_unique=1` | Opportunity | **DATE** |

**SGA Filter Pattern by Level**:
- **Lead-level**: `WHERE SGA_Owner_Name__c = @sgaName`
- **Opportunity-level**: `WHERE (SGA_Owner_Name__c = @sgaName OR Opp_SGA_Name__c = @sgaName)`

#### Dimensions

Grouping fields for breakdowns:

| Dimension | Field | Mapping | Notes |
|-----------|-------|---------|-------|
| `channel` | `Channel_Grouping_Name` | Via `new_mapping` JOIN | Uses COALESCE pattern |
| `source` | `Original_source` | Direct | |
| `sga` | `SGA_Owner_Name__c` | Direct | Supports fuzzy matching (partial names) |
| `sgm` | `SGM_Owner_Name__c` | Direct | Supports fuzzy matching (partial names) |
| `stage` | `StageName` | Direct | |
| `aum_tier` | `aum_tier` | Direct | |
| `experimentation_tag` | `Experimentation_Tag_List` | Array field via UNNEST | Special handling for array field, supports fuzzy matching with LIKE |

#### Date Presets

| Preset | Start Date SQL | End Date SQL |
|--------|----------------|--------------|
| `this_quarter` | `DATE_TRUNC(CURRENT_DATE(), QUARTER)` | `CURRENT_DATE()` |
| `last_quarter` | Previous quarter start | Previous quarter end |
| `this_month` | `DATE_TRUNC(CURRENT_DATE(), MONTH)` | `CURRENT_DATE()` |
| `last_month` | Previous month start | Previous month end |
| `ytd` | `DATE_TRUNC(CURRENT_DATE(), YEAR)` | `CURRENT_DATE()` |
| `last_7_days` | `DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)` | `CURRENT_DATE()` |
| `last_30_days` | `DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)` | `CURRENT_DATE()` |

### Query Templates

Claude selects a template based on the question; the compiler generates SQL. **Location**: `src/lib/semantic-layer/query-templates.ts` (`QUERY_TEMPLATES` object)

| Template | Purpose | Example Question |
|----------|---------|------------------|
| `single_metric` | One metric value | "How many SQOs this quarter?" |
| `metric_by_dimension` | Breakdown by dimension | "SQOs by channel this quarter" |
| `metric_trend` | Time series with optional rolling average | "Show SQL trend this year" |
| `conversion_by_dimension` | Conversion rate by dimension | "SQL to SQO rate by channel" |
| `conversion_trend` | Conversion rate over time | "SQL to SQO rate trend this year" |
| `period_comparison` | Compare two periods | "Compare SQOs this quarter vs last" |
| `top_n` | Top/bottom performers | "Top 5 sources by SQOs" |
| `funnel_summary` | Full funnel metrics | "Show me the full funnel" |
| `scheduled_calls_list` | Initial calls scheduled | "Who has calls scheduled next week?" |
| `qualification_calls_list` | Qualification calls | "Show qualification calls this month" |
| `sqo_detail_list` | List of SQO records | "Who are the people that SQOed?" |
| `generic_detail_list` | List of records (MQLs, SQLs, etc.) | "Show me all MQLs this quarter" |
| `open_pipeline_list` | Open pipeline opportunities | "Show open pipeline opportunities" |
| `sga_leaderboard` | SGA rankings | "Rank SGAs by SQOs" |
| `average_aum` | Average AUM calculation | "What's the average AUM for SQOs?" |
| `forecast_vs_actual` | Compare forecast to actuals | "How are we doing vs forecast?" |
| `multi_stage_conversion` | Multi-stage cohort conversion | "MQL to Joined conversion rate" |
| `time_to_convert` | Days between stages | "Average time from SQL to SQO" |
| `pipeline_by_stage` | Open pipeline breakdown | "Show pipeline by stage" |
| `sga_summary` | SGA performance summary | "How is Craig doing this quarter?" |
| `rolling_average` | Rolling averages | "30-day rolling average of SQLs" |
| `opportunities_by_age` | Age-based analysis | "Opportunities older than 180 days" |

### Visualization Selection

Claude recommends visualization; compiler may override based on data:

| Visualization | When Used |
|---------------|-----------|
| `metric` | Single value result |
| `bar` | Dimension breakdown, rankings |
| `line` | Time series, trends |
| `funnel` | Funnel summary |
| `comparison` | Period comparisons |
| `table` | Detailed records, lists |

### DATE vs TIMESTAMP Handling

**Critical Pattern** in query compiler:

| Field Type | Comparison Pattern |
|------------|-------------------|
| **DATE** (`converted_date_raw`, `advisor_join_date__c`, `Initial_Call_Scheduled_Date__c`, `Qualification_Call_Date__c`) | `DATE(field) >= DATE(@startDate)` |
| **TIMESTAMP** (`FilterDate`, `stage_entered_contacting__c`, `mql_stage_entered_ts`, `Date_Became_SQO__c`, `Opp_CreatedDate`) | `TIMESTAMP(field) >= TIMESTAMP(@startDateTimestamp)` |

**⚠️ Parameter Type Conflict**: When mixing DATE and TIMESTAMP fields in the same query, use separate parameters (`@startDate` for DATE, `@startDateTimestamp` for TIMESTAMP) to avoid BigQuery type inference errors. See Section 2 for details.

**End-of-day for TIMESTAMP**: Use `< TIMESTAMP(DATE_ADD(@endDateTimestamp, INTERVAL 1 DAY))` to include full last day.

**Reference**: See `src/lib/semantic-layer/definitions.ts` `DATE_FIELDS` object for complete field type mapping.

### RBAC Integration

User permissions automatically applied to all queries:

```typescript
// In query compiler
if (userPermissions.sgaFilter) {
  // Lead-level metrics: filter by SGA_Owner_Name__c
  // Opportunity-level metrics: filter by SGA_Owner_Name__c OR Opp_SGA_Name__c
}
```

### API Route Flow

**Location**: `src/app/api/agent/query/route.ts`

```typescript
// POST /api/agent/query
1. Authenticate user (getServerSession)
2. Get user permissions (getUserPermissions)
3. Call Claude API with system prompt + user question
4. Parse Claude's JSON response (template selection)
5. Compile SQL via query compiler (applies RBAC filters)
6. Execute BigQuery query (runQuery)
7. Transform results for visualization
8. Return results with visualization config
```

**Timeout**: 60 seconds (configured in vercel.json)

**Error Handling**: JSON extraction fallback with regex if Claude returns malformed JSON

### Export Features

| Export | Format | Content |
|--------|--------|---------|
| PNG | Image | Chart screenshot |
| CSV | File | Query results |
| SQL | Text | Generated query |
| ZIP | Bundle | All of the above |

### Environment Variables

| Variable | Purpose | Required |
|----------|---------|----------|
| `ANTHROPIC_API_KEY` | Claude API authentication | Yes |
| `SENTRY_DSN` | Sentry error tracking (server/edge) | Optional |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry error tracking (client) | Optional |

### Constants

**Location**: `src/config/constants.ts` and `src/lib/semantic-layer/definitions.ts` (CONSTANTS object)

```typescript
// From src/config/constants.ts
export const FULL_TABLE = 'savvy-gtm-analytics.Tableau_Views.vw_funnel_master';
export const MAPPING_TABLE = 'savvy-gtm-analytics.SavvyGTMData.new_mapping';
export const RECRUITING_RECORD_TYPE = '012Dn000000mrO3IAI';
export const RE_ENGAGEMENT_RECORD_TYPE = '012VS000009VoxrYAC';
export const OPEN_PIPELINE_STAGES = ['Qualifying', 'Discovery', 'Sales Process', 'Negotiating'];

// From src/lib/semantic-layer/definitions.ts (CONSTANTS object)
export const CONSTANTS = {
  FULL_TABLE: 'savvy-gtm-analytics.Tableau_Views.vw_funnel_master',
  MAPPING_TABLE: 'savvy-gtm-analytics.SavvyGTMData.new_mapping',
  RECRUITING_RECORD_TYPE: '012Dn000000mrO3IAI',
  RE_ENGAGEMENT_RECORD_TYPE: '012VS000009VoxrYAC',
  OPEN_PIPELINE_STAGES: ['Qualifying', 'Discovery', 'Sales Process', 'Negotiating'],
};
```

### Drill-Down Integration

Query results support drill-down to underlying records:
- Click metric value → MetricDrillDownModal
- Click table row → RecordDetailModal

### Common Issues

| Issue | Solution |
|-------|----------|
| Claude returns invalid JSON | JSON extraction fallback with regex |
| BigQuery timeout | Add LIMIT clause, check date range |
| Wrong counts | Verify DATE vs TIMESTAMP handling |
| RBAC not applying | Check userPermissions passed to compiler |
| Period comparison off by one | Use `< DATE_ADD(endDate, INTERVAL 1 DAY)` pattern |

---

## 10. Deployment & Operations

### Environment Variables

| Variable | Environment | Purpose |
|----------|-------------|---------|
| `GOOGLE_APPLICATION_CREDENTIALS` | Local | File path to BigQuery service account key |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | Vercel | JSON string of BigQuery service account |
| `GCP_PROJECT_ID` | Both | `savvy-gtm-analytics` |
| `NEXTAUTH_SECRET` | Both | Session encryption |
| `NEXTAUTH_URL` | Both | Auth callback URL |
| `DATABASE_URL` | Both | PostgreSQL connection |
| `CRON_SECRET` | Vercel | Auto-injected for cron auth |
| `GOOGLE_SHEETS_TEMPLATE_ID` | Both | Template sheet for exports |
| `GOOGLE_SHEETS_SERVICE_ACCOUNT_PATH` | Local | File path to Sheets service account |
| `GOOGLE_SHEETS_CREDENTIALS_JSON` | Vercel | Single-line JSON of Sheets service account |
| `ANTHROPIC_API_KEY` | Both | Claude API for Explore feature |

### Vercel Configuration

**Location**: `vercel.json` (root directory)

```json
{
  "functions": {
    "src/app/api/dashboard/export-sheets/route.ts": { "maxDuration": 60 },
    "src/app/api/agent/query/route.ts": { "maxDuration": 60 }
  },
  "crons": [
    { "path": "/api/cron/refresh-cache", "schedule": "0 5 * * *" }
  ]
}
```

**Cron Authentication**: The cron route validates `CRON_SECRET` from the `Authorization` header (auto-injected by Vercel).

### Error Monitoring (Sentry)

- **Client**: Browser errors, React component errors, session replay
- **Server**: API route errors, server component errors
- **Edge**: Middleware errors

**Configuration Files**:
- `sentry.client.config.ts` - Client-side error tracking (browser)
- `sentry.server.config.ts` - Server-side error tracking (API routes, server components)
- `sentry.edge.config.ts` - Edge runtime error tracking (middleware)

**Features Enabled**:
- Automatic error capture
- Console logging integration (captures `console.log`, `console.warn`, `console.error`)
- Session replay (10% sample rate, 100% on errors)
- Source map upload for better stack traces

**Environment Variables** (Vercel):
- `SENTRY_DSN` - Server/edge DSN
- `NEXT_PUBLIC_SENTRY_DSN` - Client-side DSN (must have `NEXT_PUBLIC_` prefix)

**Test Page**: `/sentry-example-page` for verifying error tracking

---

## 11. GC Hub

### Overview

GC Hub displays Gross Commission (GC) data for financial advisors, sourced from the Orion revenue estimates Google Sheet. Accessible only to users with **Page 16** permission. Capital Partners receive anonymized data (advisor and firm names replaced with `"Hidden"`).

| Role | Access Level |
|------|-------------|
| admin, revops_admin | Full access including write operations |
| manager, sgm, sga | Read-only |
| capital_partner | Anonymized read-only |
| recruiter | Blocked |

### Data Source & Sync

Data is synchronized from Orion into two Prisma models:

- **`GcAdvisorPeriodData`** — Per-advisor, per-period revenue records. Key fields: `grossRevenue`, `commissionsPaid`, `amountEarned`, `advisorNormalizedName`, `period`, plus override tracking (`isOverridden`, `originalGrossRevenue`, `originalCommissionsPaid`, `overrideReason`).
- **`GcSyncLog`** — Sync audit log recording `monthsSynced`, `totalInserted`, `totalUpdated`, `totalSkipped`, and errors per sync run.

`POST /api/gc-hub/manual-sync` (admin/revops_admin only) triggers `syncAllMonths()`, which pulls all data from Orion and upserts into `GcAdvisorPeriodData`. A `GcSyncLog` entry is created on completion.

### Override System

`PUT /api/gc-hub/override` (admin/revops_admin only) corrects `grossRevenue` and `commissionsPaid` for a specific record. On the first override, original values are preserved in `originalGrossRevenue`/`originalCommissionsPaid`. `amountEarned` is recalculated after every override.

### Period Management

`POST /api/gc-hub/period` creates a new period record; `DELETE /api/gc-hub/period` removes one. Both require admin/revops_admin. Uniqueness is enforced by `@@unique([advisorNormalizedName, period])`.

### API Routes

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/gc-hub/advisors` | page_16 | List advisors with filters (dates, accounts, billing frequency, sort, search) |
| POST | `/api/gc-hub/advisor-detail` | page_16 | Single advisor detail (accepts `advisorName`) |
| POST | `/api/gc-hub/filters` | page_16 | Filter options (accounts, advisors, billing frequencies) |
| POST | `/api/gc-hub/summary` | page_16 | Period summary with date + advisor/account/billing filters |
| POST | `/api/gc-hub/manual-sync` | admin/revops_admin | Trigger full Orion sync; returns sync stats |
| PUT | `/api/gc-hub/override` | admin/revops_admin | Override grossRevenue/commissionsPaid; preserves originals |
| POST | `/api/gc-hub/period` | admin/revops_admin | Create a new period record |
| DELETE | `/api/gc-hub/period` | admin/revops_admin | Delete a period record |
| GET | `/api/gc-hub/sync-status` | page_16 | Latest sync status from `getGcSyncStatus()` |

---

## 12. Dashboard Requests

### Overview

Dashboard Requests is an internal ticketing system for submitting and tracking analytics feature requests. It integrates with **Wrike** for project management and sends **email notifications** on status changes.

| Feature | Detail |
|---------|--------|
| Statuses | SUBMITTED → PLANNED → IN_PROGRESS → DONE → ARCHIVED |
| Wrike sync | Background (non-blocking); syncs creates, status changes, and comments |
| Attachments | Images only (PNG, JPEG, GIF, WebP); max 5 MB; stored as base64 in DB |
| Edit history | All field changes recorded in `RequestEditHistory` |
| Kanban view | 4 columns: SUBMITTED, PLANNED, IN_PROGRESS, DONE |

### Visibility Rules

| User Type | What They See |
|-----------|---------------|
| RevOps Admin (`canManageRequests`) | All requests |
| Everyone else | Own requests + non-private requests with status ≠ SUBMITTED |

Archived requests are excluded from all list and kanban views.

### Access Control

All non-recruiter users can submit requests. `canManageRequests` (RevOps Admin) is required for:

- Status changes via `/[id]/status` (also sends email notification)
- Archive (`/[id]/archive`) and unarchive (`/[id]/unarchive`)
- Analytics endpoint
- Unarchiving restores status to **DONE** (not the prior status)

### Comments & Notifications

`POST /api/dashboard-requests/[id]/comments` adds a comment, syncs it to the linked Wrike task, and sends `@mention` notifications to tagged users.

### Duplicate Detection

`GET /api/dashboard-requests/recent?search=<query>` searches titles and descriptions from the **last 30 days** (minimum 3 characters, returns up to 10 results). Used by the submission form to surface potential duplicates.

### Prisma Models

- **`DashboardRequest`** — Core record: `title`, `description`, `requestType`, `priority`, `status`, `isPrivate`, `submitterId`, `wrikeTaskId`, `statusChangedAt`.
- **`RequestEditHistory`** — Change log: `fieldName`, `oldValue`, `newValue`, `editedById`, `createdAt`.
- **`RequestComment`** — `content`, `authorId`, `wrikeCommentId`.
- **`RequestAttachment`** — `filename`, `mimeType`, `size`, base64 `data`, `uploadedById`.

### API Routes

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/dashboard-requests` | Non-recruiter | List requests (visibility rules applied) |
| POST | `/api/dashboard-requests` | Non-recruiter | Create request; Wrike sync in background |
| GET | `/api/dashboard-requests/[id]` | Non-recruiter | Get single request with full detail |
| PATCH | `/api/dashboard-requests/[id]` | Owner or canManageRequests | Update fields; records edit history; Wrike sync |
| DELETE | `/api/dashboard-requests/[id]` | Owner or canManageRequests | Delete request |
| PATCH | `/api/dashboard-requests/[id]/status` | canManageRequests | Change status; email notification; Wrike sync |
| GET | `/api/dashboard-requests/[id]/comments` | Non-recruiter | List comments |
| POST | `/api/dashboard-requests/[id]/comments` | Non-recruiter | Add comment; Wrike sync; @mention notifications |
| GET | `/api/dashboard-requests/analytics` | canManageRequests | Counts by status/type/priority, avg resolution time, top submitters |
| POST | `/api/dashboard-requests/kanban` | Non-recruiter | Kanban view (4 columns; search/type/priority/submitter/date filters) |
| GET | `/api/dashboard-requests/recent` | Non-recruiter | Recent requests for duplicate detection (last 30 days, min 3 chars, max 10) |
| POST | `/api/dashboard-requests/[id]/archive` | canManageRequests | Archive request; records history; Wrike sync |
| POST | `/api/dashboard-requests/[id]/unarchive` | canManageRequests | Unarchive to DONE; records history; Wrike sync |
| GET | `/api/dashboard-requests/[id]/attachments` | Non-recruiter | List attachments (metadata only, no binary data) |
| POST | `/api/dashboard-requests/[id]/attachments` | Non-recruiter | Upload image (PNG/JPEG/GIF/WebP, max 5 MB, stored as base64) |

---

## 13. Recruiter Hub

### Overview

Recruiter Hub (Page 12) gives recruiters and managers a view of prospect and opportunity data. Users with the **recruiter role** have their data automatically scoped to their own records via the `recruiterFilter` permission — they cannot see other recruiters' data.

| Feature | Detail |
|---------|--------|
| Page | 12 (`page_12` permission required) |
| Auto-filter | `recruiterFilter` applied automatically for recruiter role |
| External agencies | Recruiter role → own agency only; others → full list |
| SGM filter | Available in opportunities view |

### Access Control

| Operation | Requirement |
|-----------|-------------|
| All routes | `page_12` permission |
| Full agency list | Non-recruiter role |
| SGMs list | GET `/api/recruiter-hub/opportunities` |

### API Routes

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/recruiter-hub/prospects` | page_12 | Prospect list; filters: stages, openOnly, closedOnly, externalAgencies; auto-applies recruiterFilter |
| POST | `/api/recruiter-hub/opportunities` | page_12 | Opportunities with SGM filter; auto-applies recruiterFilter |
| GET | `/api/recruiter-hub/opportunities` | page_12 | Returns available SGMs list |
| GET | `/api/recruiter-hub/external-agencies` | page_12 | External agencies (recruiter → own agency only) |

---

## 14. Advisor Map

### Overview

Advisor Map visualizes financial advisor locations on a Google Maps interface. Administrators can create overrides when Google Maps geocoding returns incorrect coordinates for an advisor's address.

| Feature | Detail |
|---------|--------|
| Geocoding | Google Maps API (`GOOGLE_MAPS_API_KEY` env var) |
| Override model | `AdvisorAddressOverride` Prisma model |
| Access | Blocks recruiter and capital_partner |

### Address Override Flow

1. Admin fetches advisor locations from `POST /api/advisor-map/locations`.
2. If a location is incorrect, admin `POST`s to `/api/advisor-map/overrides` with corrected address.
3. API auto-geocodes the new address via Google Maps and stores `latitude`/`longitude` in `AdvisorAddressOverride`.
4. Subsequent location requests use override coordinates when an override exists for that advisor.

### Prisma Model

```prisma
model AdvisorAddressOverride {
  id          String   @id @default(cuid())
  advisorName String   @unique
  address     String
  latitude    Float
  longitude   Float
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  createdBy   String?  // Admin email
}
```

### Location Filters

Both `POST` and `GET` for `/api/advisor-map/locations` accept `AdvisorLocationFilters`:

| Filter | Description |
|--------|-------------|
| `startDate` / `endDate` | Date range |
| `sga` | SGA name filter |
| `sgm` | SGM name filter |
| `channel` | Prospect channel |
| `source` | Lead source |
| `coordSourceFilter` | Filter by coordinate source (geocoded vs overridden) |

### API Routes

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/advisor-map/locations` | Non-recruiter, non-capital_partner | Advisor locations with filters |
| GET | `/api/advisor-map/locations` | Non-recruiter, non-capital_partner | Same as POST (alternate method) |
| GET | `/api/advisor-map/overrides` | admin/revops_admin/manager | List all address overrides |
| POST | `/api/advisor-map/overrides` | Non-recruiter, non-capital_partner | Create or update override with auto-geocoding |
| DELETE | `/api/advisor-map/overrides` | admin/revops_admin | Delete an address override |

---

## 15. Pipeline Catcher Game

### Overview

Pipeline Catcher is a gamified browser game where users catch pipeline items. Scores are tracked per quarter with a public leaderboard. Players can optionally attach a message to their leaderboard entry.

| Feature | Detail |
|---------|--------|
| Score model | `GameScore` Prisma model |
| Quarter format | `YYYY-Q[1-4]` (validated by regex `^\d{4}-Q[1-4]$`) |
| Leaderboard | Top 10 scores per quarter |
| Access | Blocks recruiter and capital_partner |

### Prisma Model

```prisma
model GameScore {
  id        String   @id @default(cuid())
  userId    String
  quarter   String   // Format: "2025-Q4"
  score     Int
  level     Int
  message   String?  // Optional player message
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  user User @relation(fields: [userId], references: [id])
}
```

### Score Submission Flow

1. User plays the game at `/games/pipeline-catcher/play/[quarter]`.
2. Client `POST`s score + level to `/api/games/pipeline-catcher/leaderboard`.
3. A `GameScore` record is created; response includes updated top-10.
4. User may `PATCH` their entry to add/update a message (same user only).

### API Routes

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/games/pipeline-catcher/leaderboard` | Non-recruiter, non-capital_partner | Top-10 leaderboard for a quarter (`?quarter=YYYY-QN` required) |
| POST | `/api/games/pipeline-catcher/leaderboard` | Non-recruiter, non-capital_partner | Submit new score; creates `GameScore` |
| PATCH | `/api/games/pipeline-catcher/leaderboard` | Same user only | Update message on own leaderboard entry |
| GET | `/api/games/pipeline-catcher/levels` | Non-recruiter, non-capital_partner | Available levels with per-quarter high score |
| GET | `/api/games/pipeline-catcher/play/[quarter]` | Non-recruiter, non-capital_partner | Game data for specified quarter from `getGameDataForQuarter()` |

---

## 16. SGA Activity

### Overview

SGA Activity provides detailed call and activity analytics for SGA performance management. It supports period-over-period (A/B) comparison and drill-down views into individual records.

| Feature | Detail |
|---------|--------|
| Access | admin, manager, sga, sgm, revops_admin |
| SGA auto-filter | SGA role automatically scoped to own name |
| Period comparison | Period A vs Period B supported on dashboard endpoint |
| Data source | BigQuery (7 queries run in parallel) |

### Dashboard Parallel Queries

`POST /api/sga-activity/dashboard` fetches 7 data sources simultaneously:

| Source | Description |
|--------|-------------|
| `initialCalls` | Initial call counts by date/SGA |
| `qualificationCalls` | Qualification call counts |
| `activityDistribution` | Activity distribution by type |
| `smsResponseRate` | SMS response rate metrics |
| `callAnswerRate` | Call answer rate metrics |
| `activityBreakdown` | Detailed activity breakdown |
| `totals` | Aggregate totals for the period |

Period A/B comparison is achieved by passing two filter sets in the request body; both are queried in the same parallel batch.

### Drill-Down Views

Two endpoints provide paginated record-level detail:

- **`/api/sga-activity/activity-records`** — Individual activity records (page/pageSize, default 100). Accepts `channel`, `subType`, `dayOfWeek`, `activityType` + standard filters.
- **`/api/sga-activity/scheduled-calls`** — Scheduled call records. Accepts `callType`, `weekType`, `dayOfWeek`, `sgaName` + filters object.

### Filter Options

`GET /api/sga-activity/filters` returns available filter values. When the requesting user has the **sga role**, the `sgas` list in the response contains only their own name — preventing cross-SGA visibility.

### API Routes

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/sga-activity/dashboard` | admin/manager/sga/sgm/revops_admin | Dashboard metrics (7 parallel BigQuery queries); Period A/B comparison |
| GET | `/api/sga-activity/filters` | admin/manager/sga/sgm/revops_admin | Filter options (sga role sees only own name in sgas list) |
| POST | `/api/sga-activity/activity-records` | admin/manager/sga/sgm/revops_admin | Paginated activity record drill-down |
| POST | `/api/sga-activity/scheduled-calls` | admin/manager/sga/sgm/revops_admin | Scheduled call drill-down |

---

## 17. Saved Reports

### Overview

Saved Reports lets users persist named filter configurations for the **Funnel Performance** dashboard. Administrators can create shared **admin templates** visible to all eligible users.

| Feature | Detail |
|---------|--------|
| Dashboard scope | `funnel_performance` only |
| Report types | `user` (personal) and `admin_template` (shared) |
| Soft delete | `isActive: false` — records are never hard-deleted |
| Default report | One default per user; enforced in application logic |
| Access | Blocks recruiter and capital_partner |

### Report Type Permission Matrix

| Action | user report | admin_template |
|--------|-------------|----------------|
| Create | Any non-recruiter/non-CP | admin or manager only |
| Read | Owner | All non-recruiter/non-CP |
| Update | Owner | admin or manager |
| Delete (soft) | Owner | admin or manager |
| Set as default | Owner | Not allowed |
| Duplicate | Owner | Any non-recruiter/non-CP (duplicate always becomes `user` type) |

### Default Report Flow

1. `POST /api/saved-reports/[id]/set-default` — Unsets all existing defaults for the user (via `updateMany`), then sets the target report as default. Admin templates cannot be set as default.
2. `GET /api/saved-reports/default` — Returns the user's current default report (or `{ report: null }`). Queries by `userId + isDefault: true + isActive: true + dashboard: 'funnel_performance'`.

### Prisma Model

```prisma
model SavedReport {
  id               String   @id @default(cuid())
  userId           String
  name             String   @db.VarChar(255)
  description      String?
  filters          Json     // DashboardFilters object
  featureSelection Json?    // Optional feature panel selection
  viewMode         String?
  dashboard        String   // 'funnel_performance'
  reportType       String   // 'user' | 'admin_template'
  isDefault        Boolean  @default(false)
  isActive         Boolean  @default(true)  // false = soft-deleted
  createdBy        String?  // Email of creator
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  user User @relation(fields: [userId], references: [id])
}
```

### API Routes

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/saved-reports` | Non-recruiter, non-capital_partner | List user's own reports + all admin templates |
| POST | `/api/saved-reports` | Non-recruiter, non-capital_partner | Create report (`admin_template` requires admin/manager) |
| GET | `/api/saved-reports/default` | Authenticated | Get user's default report (`null` if none) |
| GET | `/api/saved-reports/[id]` | Owner or admin/manager | Get single report |
| PUT | `/api/saved-reports/[id]` | Owner or admin/manager | Update report fields |
| DELETE | `/api/saved-reports/[id]` | Owner or admin/manager | Soft-delete (`isActive: false`) |
| POST | `/api/saved-reports/[id]/duplicate` | Owner, or any eligible user for admin_template | Duplicate; result is always `reportType: 'user'` |
| POST | `/api/saved-reports/[id]/set-default` | Owner (user reports only) | Set as default; unsets previous default first |

---

## Appendix A: Validated Reference Values

**Q4 2025 (Oct 1 - Dec 31, 2025)**:

### Volume Metrics

| Metric | Value | Date Field Used | Filter Condition |
|--------|-------|-----------------|------------------|
| Prospects | 22,885 | `FilterDate` | Date in range |
| Contacted | 15,766 | `stage_entered_contacting__c` | `is_contacted = 1` + date in range |
| MQLs | 595 | `mql_stage_entered_ts` | `is_mql = 1` + date in range |
| SQLs | 193 | `converted_date_raw` | `is_sql = 1` + date in range |
| SQOs | 144 | `Date_Became_SQO__c` | `is_sqo_unique = 1` + `recordtypeid` + date in range |
| Joined | 17 | `advisor_join_date__c` | `is_joined_unique = 1` + date in range |

### Conversion Rates

| Conversion | Numerator | Denominator | Rate |
|------------|-----------|-------------|------|
| Contacted→MQL | 447 | 7,292 | 6.1% |
| MQL→SQL | 193 | 427 | 45.2% |
| SQL→SQO | 122 | 167 | 73.1% |
| SQO→Joined | 7 | 66 | 10.6% |

### AUM Values

| Metric | Value |
|--------|-------|
| Open Pipeline AUM | ~$12.3B |

Use these values to validate any query changes.

---

## Appendix B: Glossary

| Term | Definition |
|------|------------|
| **Prospect** | A record that entered the funnel (new or recycled) based on FilterDate |
| **Contacted** | A lead that entered the Contacting stage |
| **MQL** | Marketing Qualified Lead — Lead met marketing qualification criteria |
| **SQL** | Sales Qualified Lead — Lead converted to Opportunity |
| **SQO** | Sales Qualified Opportunity — Opportunity in active pipeline |
| **Joined** | Advisor signed and joined Savvy |
| **AUM** | Assets Under Management |
| **SGA** | Strategic Growth Associate — Responsible for Top of Funnel (ToF) sales: Prospect → SQL |
| **SGM** | Strategic Growth Manager — Responsible for Bottom of Funnel (BoF) sales: SQO → Joined |
| **TOF** | Top of Funnel — Prospects, Contacted, MQL, SQL (SGA responsibility) |
| **BOF** | Bottom of Funnel — SQO, Joined (SGM responsibility) |
| **Focused View** | Executive view showing SQL, SQO, Joined metrics only |
| **Full Funnel View** | Complete funnel view including Prospects, Contacted, MQL |
| **Period Mode** | Conversion rate calculation where numerator/denominator come from activity in the period |
| **Cohort Mode** | Conversion rate calculation tracking how a cohort of leads ultimately converts |
| **Initial Call** | First scheduled call with a prospect, occurs after MQL and before SQL conversion (SGA metric) |
| **Qualification Call** | Call conducted with SGM after SQL conversion to determine if opportunity qualifies for SQO status |
| **Closed Lost** | Opportunity that was lost — tracked for re-engagement |
| **Pacing** | Progress toward goal relative to where you should be at this point in the period |
| **Semantic Layer** | Abstraction defining metrics, dimensions, and query templates for AI-generated SQL |
| **Query Template** | Pre-defined SQL pattern that the query compiler fills in based on parameters |
| **RBAC** | Role-Based Access Control — Automatic data filtering based on user permissions |
| **Open Pipeline** | Active opportunities in stages: Qualifying, Discovery, Sales Process, Negotiating |

---

## Appendix C: Known Code Issues

### DATE vs TIMESTAMP Inconsistency

**Status**: ✅ **FIXED** (January 18, 2026)

**Issue 1: Incorrect Wrapper Usage**: Multiple query files incorrectly used `TIMESTAMP()` wrapper for DATE fields (`converted_date_raw`, `advisor_join_date__c`).

**Files Fixed**:
- `src/lib/queries/funnel-metrics.ts` - 3 instances
- `src/lib/queries/source-performance.ts` - 8 instances
- `src/lib/queries/conversion-rates.ts` - 12 instances
- `src/lib/queries/detail-records.ts` - 6 instances

**Total**: 29 instances fixed

**Fix Applied**: Changed `TIMESTAMP(v.converted_date_raw)` to `DATE(v.converted_date_raw)` and `TIMESTAMP(v.advisor_join_date__c)` to `DATE(v.advisor_join_date__c)` for all date comparisons.

**Issue 2: Parameter Type Conflict** (January 18, 2026 - Additional Fix):
- **File**: `src/lib/queries/source-performance.ts`
- **Problem**: Using the same parameter (`@startDate`, `@endDate`) with both `DATE()` and `TIMESTAMP()` wrappers caused BigQuery type inference errors: "No matching signature for operator >= for argument types: DATE, TIMESTAMP"
- **Symptom**: Metrics stayed at default QTD values when filtering to specific quarters (e.g., Q1 2025) because queries failed silently
- **Fix Applied**: Introduced separate parameters:
  - `startDate` / `endDate` — plain date strings (YYYY-MM-DD) for `DATE()` comparisons
  - `startDateTimestamp` / `endDateTimestamp` — date strings with time (YYYY-MM-DD HH:MM:SS) for `TIMESTAMP()` comparisons
- **Impact**: ✅ **RESOLVED** - Queries now execute successfully and metrics display correctly when filtering to any quarter (Q1 2025, Q2 2025, etc.)
- **Production Status**: ✅ **VERIFIED WORKING** - User confirmed correct numbers display when filtering to Q1 2025

**Verification**: 
- ✅ TypeScript compilation passes
- ✅ MCP queries return identical results before and after fix
- ✅ QTD values verified: SQLs=34, Joined=0
- ✅ Q4 2025 reference values verified: SQLs=193, Joined=17
- ✅ Q1 2025 queries execute successfully (123 SQLs verified)
- ✅ UI metrics unchanged (manually verified)

**Note**: `export-records.ts` correctly uses `TIMESTAMP()` wrapper for `FORMAT_TIMESTAMP()` function calls, which is appropriate as the function requires TIMESTAMP input.

---

## Validation Summary (January 18, 2026 - Updated January 18, 2026)

### Changes Made (January 18, 2026 - Initial Validation)

1. **Section 2 (Data Layer)**:
   - ✅ Verified `src/lib/bigquery.ts` exists with `runQuery()` function
   - ✅ Verified `src/config/constants.ts` has all constants (FULL_TABLE, MAPPING_TABLE, RECRUITING_RECORD_TYPE, OPEN_PIPELINE_STAGES)
   - ✅ Verified `src/types/bigquery-raw.ts` has `toNumber()` and `toString()` helpers
   - ✅ Added `RE_ENGAGEMENT_RECORD_TYPE` constant documentation
   - ✅ Enhanced DATE vs TIMESTAMP handling documentation with complete field type reference
   - ✅ Added `buildQueryParams()` helper function documentation

2. **Section 3 (Caching)**:
   - ✅ Verified `unstable_cache` usage in `src/lib/cache.ts`
   - ✅ Verified cache tags: `'dashboard'` and `'sga-hub'` match actual implementation
   - ✅ Verified cron route at `/api/cron/refresh-cache` with correct schedule
   - ✅ Added cron authentication details (CRON_SECRET validation)

3. **Section 5 (Auth)**:
   - ✅ Verified `src/lib/auth.ts` authOptions structure matches
   - ✅ Verified `src/lib/permissions.ts` role definitions and allowedPages arrays
   - ✅ Verified `src/middleware.ts` matcher pattern matches
   - ✅ Added `canManageUsers` property to UserPermissions interface
   - ✅ Added page routes to page access control table

4. **Section 6 (Core Dashboard)**:
   - ✅ Verified `src/types/dashboard.ts` FunnelMetrics interface matches
   - ✅ Verified `src/types/filters.ts` DashboardFilters and metricFilter type
   - ✅ Verified `src/lib/queries/funnel-metrics.ts` exists
   - ✅ Added complete API route list (29 routes verified)
   - ✅ Added detail records query limit documentation (50,000)

5. **Section 7 (Advanced Features)**:
   - ✅ Verified `ViewMode` type exists in `src/types/dashboard.ts`
   - ✅ Verified `src/components/dashboard/RecordDetailModal.tsx` exists
   - ✅ Verified `src/lib/sheets/` Google Sheets exporter exists
   - ✅ Verified `src/app/api/dashboard/export-sheets/route.ts` exists
   - ✅ Added file locations and implementation details

6. **Section 8 (SGA Hub)**:
   - ✅ Verified Prisma schema has WeeklyGoal and QuarterlyGoal models (updated to match actual schema with cuid IDs)
   - ✅ Verified `src/app/dashboard/sga-hub/` page structure
   - ✅ Verified `src/app/dashboard/sga-management/` page structure
   - ✅ Verified all SGA Hub API routes exist (10 routes)
   - ✅ Added Re-Engagement tab documentation
   - ✅ Added sqo-details and re-engagement API routes

7. **Section 9 (Explore)**:
   - ✅ Verified `src/lib/semantic-layer/definitions.ts` exists with METRICS object
   - ✅ Verified `src/lib/semantic-layer/query-compiler.ts` exists
   - ✅ Verified `src/lib/semantic-layer/query-templates.ts` exists with template names
   - ✅ Verified `src/app/api/agent/query/route.ts` exists
   - ✅ Verified `src/app/dashboard/explore/page.tsx` exists
   - ✅ Updated query templates list to match actual implementation
   - ✅ Added experimentation_tag dimension documentation
   - ✅ Enhanced DATE vs TIMESTAMP handling with complete field type reference

8. **Section 10 (Deployment)**:
   - ✅ Verified vercel.json configuration matches actual file
   - ✅ Added Sentry configuration details
   - ✅ Added environment variables for Sentry

### Code Issues Flagged

1. **DATE vs TIMESTAMP Inconsistency in funnel-metrics.ts**:
   - **File**: `src/lib/queries/funnel-metrics.ts`
   - **Lines**: 114-115
   - **Issue**: Uses `TIMESTAMP()` wrapper for `converted_date_raw` (a DATE field)
   - **Should Be**: `DATE()` wrapper
   - **Impact**: May cause incorrect date comparisons
   - **Reference**: Semantic layer correctly uses `DATE()` for this field
   - **Status**: Flagged in Appendix C for code review

### Missing Patterns Added

1. **BigQuery Helper Functions**: Documented `buildQueryParams()` helper
2. **Complete API Route List**: Added comprehensive list of all 29 API routes
3. **Prisma Model Details**: Updated WeeklyGoal and QuarterlyGoal models to match actual schema (cuid IDs, additional fields)
4. **Experimentation Tag Dimension**: Added to dimensions table with array field handling notes
5. **Sentry Configuration**: Added detailed Sentry setup documentation
6. **Re-Engagement Tab**: Added documentation for SGA Hub Re-Engagement tab
7. **File Locations**: Added file paths throughout for easier navigation

### Changes Made (January 18, 2026 - architecture_answers.md Updates)

**Part 1: Clarifications Applied**:

1. **Section 8 & Glossary - SGA/SGM Handoff and Call Timing**:
   - ✅ Updated glossary: Initial Call definition (occurs after MQL, before SQL)
   - ✅ Updated glossary: Qualification Call definition (conducted with SGM after SQL conversion)
   - ✅ Added call timing note to Section 8 Weekly Goals Tab explaining when calls occur in funnel

2. **Section 9 - Explore Feature Status**:
   - ✅ Added production status indicator: "✅ **Live in Production**"

3. **Section 8 - Re-Engagement Tab Documentation**:
   - ✅ Enhanced Re-Engagement Tab section with detailed explanation
   - ✅ Added distinction between Closed Lost (candidates) and Re-Engagement (active opportunities)
   - ✅ Updated Closed Lost Tab description to clarify it shows candidates for re-engagement
   - ✅ Documented RE_ENGAGEMENT_RECORD_TYPE constant usage

4. **Appendix C - DATE/TIMESTAMP Bug Verification**:
   - ✅ Verified bug exists in 4 files (29 instances total)
   - ✅ **FIXED**: All 29 instances corrected (January 18, 2026)

**Part 2: Verification Tasks Completed**:

1. ✅ **OPEN_PIPELINE_STAGES**: Verified matches documentation (`['Qualifying', 'Discovery', 'Sales Process', 'Negotiating']`)
2. ✅ **Sidebar Page IDs**: Verified all 10 pages match documentation (IDs, names, routes)
3. ✅ **Prisma Models**: Verified WeeklyGoal and QuarterlyGoal models match documentation (cuid IDs, all fields)
4. ✅ **Semantic Layer Templates**: Updated query templates table with all 22 actual templates (added missing: `conversion_trend`, `funnel_summary`, `qualification_calls_list`, `average_aum`, `forecast_vs_actual`, `multi_stage_conversion`, `time_to_convert`, `pipeline_by_stage`, `sga_summary`, `rolling_average`, `opportunities_by_age`)
5. ✅ **API Routes Count**: Verified 29 routes match documentation
6. ✅ **Re-Engagement API Route**: Verified `/api/sga-hub/re-engagement` exists and is documented
7. ✅ **Vercel Configuration**: Verified vercel.json matches documentation (60s timeouts, cron schedule)

### Changes Made (January 18, 2026 - DATE/TIMESTAMP Bug Fix)

**Phase 1: Pre-Fix Verification**:
- ✅ Bug confirmed via grep search (29 instances across 4 files)
- ✅ MCP queries confirmed current values match expected (SQLs=34, Joined=0 for QTD)
- ✅ Verified correct DATE() wrapper returns identical results

**Phase 2-5: Fixes Applied**:
- ✅ funnel-metrics.ts: 3 instances fixed
- ✅ source-performance.ts: 8 instances fixed
- ✅ conversion-rates.ts: 12 instances fixed
- ✅ detail-records.ts: 6 instances fixed

**Phase 6: Verification**:
- ✅ TypeScript compilation passes
- ✅ Linting passes
- ✅ MCP queries return correct values (SQLs=34, Joined=0 for QTD)
- ✅ Q4 2025 reference values verified (SQLs=193, Joined=17)
- ✅ No remaining incorrect wrappers (only export-records.ts, which is correct)

**Phase 7: User Verification**:
- ✅ UI metrics match expected values
- ✅ No console errors
- ✅ Drill-down modals functional

**Status**: ✅ Bug fully resolved

### Additional Fix (January 18, 2026 - Parameter Type Conflict)

**Issue**: BigQuery type inference error when using same parameter with both DATE() and TIMESTAMP() wrappers in `source-performance.ts`:
- Error: "No matching signature for operator >= for argument types: DATE, TIMESTAMP"
- Occurred when filtering to specific quarters (e.g., Q1 2025)

**Fix Applied**:
- Introduced separate parameters for DATE vs TIMESTAMP comparisons:
  - `startDate` / `endDate` — plain date strings (YYYY-MM-DD) for `DATE()` comparisons
  - `startDateTimestamp` / `endDateTimestamp` — date strings with time (YYYY-MM-DD HH:MM:SS) for `TIMESTAMP()` comparisons
- Updated both `_getChannelPerformance` and `_getSourcePerformance` functions

**Verification**:
- ✅ TypeScript compilation passes
- ✅ Q1 2025 queries execute successfully (123 SQLs verified via MCP)
- ✅ No BigQuery type errors
- ✅ Date filtering works correctly for all quarters
- ✅ **Production Verified**: User confirmed correct metrics display when filtering to Q1 2025 and other quarters

**Status**: ✅ Parameter type conflict resolved and working in production

### Verification Status

- ✅ All file paths verified
- ✅ All constants verified
- ✅ All type definitions verified
- ✅ All API routes verified (29 routes)
- ✅ All Prisma models verified
- ✅ All query patterns verified
- ✅ All clarifications from product owner applied
- ✅ DATE/TIMESTAMP bug fixed (29 instances across 4 files)
- ✅ Parameter type conflict fixed (source-performance.ts - separate DATE/TIMESTAMP parameters)

---

## Document Maintenance

**When to update**:
- New feature added → Add section
- Pattern changed → Update relevant section
- Bug fix revealed incorrect pattern → Correct and note

**Validation instruction for Cursor**:
> Review this ARCHITECTURE.md against the actual codebase. Update all file paths, function names, and code examples to reflect what's actually implemented. Flag any sections that describe features differently than how they're built.

---

*Last Updated: February 18, 2026*
*Validated Against Codebase: Yes*
*Last Review: February 18, 2026 (Sections 11–17 added: GC Hub, Dashboard Requests, Recruiter Hub, Advisor Map, Pipeline Catcher Game, SGA Activity, Saved Reports)*
