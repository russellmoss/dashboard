# Self-Serve Analytics Agent - Codebase Investigation Answers

**Investigation Date**: January 15, 2026  
**Investigated By**: Cursor.ai  
**Dashboard Repository**: C:\Users\russe\Documents\Dashboard

---

## Section 1: Project Structure & Architecture

### 1.1 Current Directory Structure

**Directory Structure**:

```
src/
├── app/
│   ├── api/                    # Next.js API routes
│   │   ├── admin/              # Admin-specific routes
│   │   ├── auth/               # NextAuth routes
│   │   ├── dashboard/          # Main dashboard API routes
│   │   ├── sga-hub/            # SGA Hub specific routes
│   │   └── users/              # User management routes
│   ├── dashboard/              # Dashboard pages
│   ├── login/                  # Login page
│   └── page.tsx                # Root page
├── components/
│   ├── dashboard/               # Dashboard-specific components
│   ├── layout/                 # Header, Sidebar
│   ├── providers/              # React context providers
│   ├── settings/               # Settings page components
│   ├── sga-hub/                # SGA Hub components
│   └── ui/                     # Reusable UI components
├── config/
│   ├── constants.ts            # App-wide constants
│   ├── theme.ts                # Theme/color constants
│   └── ui.ts                   # UI style constants
├── lib/
│   ├── queries/                # BigQuery query functions
│   ├── sheets/                 # Google Sheets export
│   ├── utils/                  # Utility functions
│   ├── api-client.ts           # Frontend API client
│   ├── auth.ts                 # NextAuth configuration
│   ├── bigquery.ts             # BigQuery client setup
│   ├── logger.ts               # Logging utility
│   ├── permissions.ts          # RBAC system
│   ├── prisma.ts               # Prisma client
│   └── users.ts                # User management functions
└── types/
    ├── auth.ts                 # Authentication types
    ├── bigquery-raw.ts         # BigQuery result types
    ├── dashboard.ts             # Dashboard data types
    ├── filters.ts               # Filter types
    ├── record-detail.ts         # Record detail types
    ├── sga-hub.ts              # SGA Hub types
    └── user.ts                  # User types
```

**Folder Purposes**:

| Folder | Purpose |
|--------|---------|
| `src/app/` | Next.js App Router pages and API routes |
| `src/components/` | React components organized by feature area |
| `src/lib/` | Business logic, utilities, and integrations |
| `src/types/` | TypeScript type definitions |
| `src/config/` | Application configuration constants |

---

### 1.2 Semantic Layer Target Location

**Current Location**: `docs/semantic_layer/` (original)

**Target Location**: `src/lib/semantic-layer/`

**Directory Exists?**: ✅ **Yes - Migration Complete**

**Migration Status**: ✅ **COMPLETED**
- Files have been migrated from `docs/semantic_layer/` to `src/lib/semantic-layer/`
- All imports should now reference `@/lib/semantic-layer/...`
- Semantic layer is ready for integration with the self-serve analytics agent

**Migrated Files**:
- `definitions.ts` → `src/lib/semantic-layer/definitions.ts`
- `query-templates.ts` → `src/lib/semantic-layer/query-templates.ts`
- `validation-examples.ts` → `src/lib/semantic-layer/validation-examples.ts`
- `index.ts` → `src/lib/semantic-layer/index.ts`

---

### 1.3 Configuration Files

**`src/config/constants.ts` Contents**:

```typescript
// Open Pipeline Stages - Must match actual Salesforce StageName values
export const OPEN_PIPELINE_STAGES: readonly string[] = [
  'Qualifying',
  'Discovery', 
  'Sales Process',
  'Negotiating'
];

export const RECRUITING_RECORD_TYPE = '012Dn000000mrO3IAI';
export const RE_ENGAGEMENT_RECORD_TYPE = '012VS000009VoxrYAC';

export const FULL_TABLE = 'savvy-gtm-analytics.Tableau_Views.vw_funnel_master';
export const FORECAST_TABLE = 'savvy-gtm-analytics.SavvyGTMData.q4_2025_forecast';
export const MAPPING_TABLE = 'savvy-gtm-analytics.SavvyGTMData.new_mapping';
export const DAILY_FORECAST_VIEW = 'savvy-gtm-analytics.Tableau_Views.vw_daily_forecast';

export const DEFAULT_YEAR = 2025;
export const DEFAULT_DATE_PRESET = 'q4' as const;
```

**Path Alias Configuration** (from `tsconfig.json`):

```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

**Environment Variables Currently Used**:

| Variable | Purpose |
|----------|---------|
| `GCP_PROJECT_ID` | Google Cloud Project ID (defaults to 'savvy-gtm-analytics') |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to BigQuery service account JSON (local dev) |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | BigQuery credentials as JSON string (Vercel) |
| `NEXTAUTH_SECRET` | NextAuth session encryption secret |
| `NEXTAUTH_URL` | Base URL for NextAuth callbacks |
| `GOOGLE_SHEETS_CREDENTIALS_JSON` | Google Sheets service account JSON (Vercel) |
| `GOOGLE_SHEETS_SERVICE_ACCOUNT_PATH` | Path to Google Sheets credentials (local) |
| `GOOGLE_SHEETS_WEBAPP_URL` | Google Apps Script web app URL for sheet creation |
| `DATABASE_URL` | PostgreSQL connection string for Prisma |
| `ANTHROPIC_API_KEY` | ✅ **Already configured** in root `.env` file (`ANTHROPIC_API_KEY=sk-ant-api0-...`) - Ready for Claude integration |

---

## Section 2: API Route Patterns

### 2.1 Existing API Routes

**Routes in `src/app/api/dashboard/`**:

| Route | Methods | Description |
|-------|---------|-------------|
| `/api/dashboard/funnel-metrics` | POST | Returns funnel metrics (prospects, contacted, MQLs, SQLs, SQOs, joined) with optional goals |
| `/api/dashboard/conversion-rates` | POST | Returns conversion rates (cohort or period mode) with optional trends |
| `/api/dashboard/source-performance` | POST | Returns channel or source performance data (groupBy parameter) |
| `/api/dashboard/detail-records` | POST | Returns detailed record list with filtering |
| `/api/dashboard/filters` | GET | Returns available filter options (channels, sources, SGAs, SGMs, etc.) |
| `/api/dashboard/forecast` | POST | Returns forecast data |
| `/api/dashboard/open-pipeline` | POST | Returns open pipeline records and summary |
| `/api/dashboard/export-sheets` | POST | Exports data to Google Sheets |
| `/api/dashboard/record-detail/[id]` | GET | Returns full detail for a single record by ID |

---

### 2.2 API Route Structure Pattern

**Standard API Route Pattern** (from `funnel-metrics/route.ts`):

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest) {
  try {
    // 1. Authentication check
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // 2. Parse request body
    const body = await request.json();
    const filters: DashboardFilters = body.filters || body;
    
    // 3. Get user permissions (for RBAC filtering if needed)
    // Note: Main dashboard does NOT auto-apply SGA/SGM filters
    // SGA filters only applied in SGA Hub features
    
    // 4. Call query function
    const metrics = await getFunnelMetrics(filters);
    
    // 5. Return response
    return NextResponse.json(metrics);
  } catch (error) {
    logger.error('Funnel metrics error', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

**Key Pattern Elements**:
1. **Session Authentication**: Always check with `getServerSession(authOptions)`, return 401 if no session
2. **Permission Filtering**: Use `getUserPermissions()` to get RBAC filters, but main dashboard doesn't auto-apply them
3. **Error Handling**: Try-catch with logger.error, return 500 with generic message
4. **Response Format**: Always return `NextResponse.json()` with data or error object

---

### 2.3 Dynamic Route Patterns

**Existing Dynamic Routes Found**:
- `/api/users/[id]/route.ts` - GET, PUT, DELETE for user management
- `/api/users/[id]/reset-password/route.ts` - POST for password reset
- `/api/dashboard/record-detail/[id]/route.ts` - GET for record details

**Dynamic Route Pattern Example**:

```typescript
interface RouteParams {
  params: { id: string };
}

export async function GET(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Extract and validate dynamic parameter
    const { id } = params;
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid record ID' }, { status: 400 });
    }

    // Validate ID format (example: Salesforce IDs)
    if (!id.startsWith('00Q') && !id.startsWith('006')) {
      return NextResponse.json({ error: 'Invalid record ID format' }, { status: 400 });
    }

    // Fetch data
    const record = await getRecordDetail(id);
    if (!record) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    }

    return NextResponse.json({ record });
  } catch (error) {
    console.error('Error fetching record detail:', error);
    return NextResponse.json({ error: 'Failed to fetch record detail' }, { status: 500 });
  }
}
```

---

## Section 3: BigQuery Integration

### 3.1 BigQuery Client Setup

**File**: `src/lib/bigquery.ts`

**Client Configuration**:

```typescript
import { BigQuery, Query } from '@google-cloud/bigquery';

let bigqueryClient: BigQuery | null = null;

export function getBigQueryClient(): BigQuery {
  if (bigqueryClient) return bigqueryClient;

  const projectId = process.env.GCP_PROJECT_ID || 'savvy-gtm-analytics';
  const scopes = [
    'https://www.googleapis.com/auth/bigquery',
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/drive.readonly',
  ];

  // Vercel: use JSON credentials from env var
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
    bigqueryClient = new BigQuery({ projectId, credentials, scopes });
  } 
  // Local: use file path
  else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    bigqueryClient = new BigQuery({
      projectId,
      keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      scopes,
    });
  } 
  else {
    throw new Error('No BigQuery credentials configured');
  }

  return bigqueryClient;
}
```

**`runQuery<T>()` Function Signature**:

```typescript
export async function runQuery<T>(query: string, params?: Record<string, any>): Promise<T[]> {
  const client = getBigQueryClient();
  const options: Query = { query, params: params || {} };
  const [rows] = await client.query(options);
  return rows as T[];
}
```

**Parameterized Query Helper**:

```typescript
export function buildQueryParams(filters: {
  startDate?: string;
  endDate?: string;
  channel?: string | null;
  source?: string | null;
  sga?: string | null;
  sgm?: string | null;
}): QueryParams {
  const conditions: string[] = [];
  const params: Record<string, any> = {};

  if (filters.startDate) {
    conditions.push('FilterDate >= TIMESTAMP(@startDate)');
    params.startDate = filters.startDate;
  }
  // ... more filter conditions

  return { conditions, params };
}
```

---

### 3.2 Query Function Patterns

**Files in `src/lib/queries/`**:
- `closed-lost.ts` - Closed lost opportunity queries
- `conversion-rates.ts` - Conversion rate calculations
- `detail-records.ts` - Detail record listings
- `drill-down.ts` - SGA Hub drill-down queries
- `export-records.ts` - Export-specific queries
- `forecast-goals.ts` - Forecast goal queries
- `forecast.ts` - Forecast data queries
- `funnel-metrics.ts` - Main funnel metrics
- `open-pipeline.ts` - Open pipeline queries
- `quarterly-goals.ts` - Quarterly goal queries
- `quarterly-progress.ts` - Quarterly progress queries
- `record-detail.ts` - Single record detail query
- `source-performance.ts` - Channel/source performance
- `weekly-actuals.ts` - Weekly actuals queries
- `weekly-goals.ts` - Weekly goal queries

**Query Function Template** (from `funnel-metrics.ts`):

```typescript
import { runQuery } from '../bigquery';
import { FunnelMetrics } from '@/types/dashboard';
import { DashboardFilters } from '@/types/filters';
import { FULL_TABLE, MAPPING_TABLE, RECRUITING_RECORD_TYPE } from '@/config/constants';
import { buildDateRangeFromFilters } from '../utils/date-helpers';
import { buildAdvancedFilterClauses } from '../utils/filter-helpers';
import { RawFunnelMetricsResult, toNumber } from '@/types/bigquery-raw';

export async function getFunnelMetrics(filters: DashboardFilters): Promise<FunnelMetrics> {
  const { startDate, endDate } = buildDateRangeFromFilters(filters);
  
  // Build advanced filter clauses
  const { whereClauses: advFilterClauses, params: advFilterParams } = 
    buildAdvancedFilterClauses(filters.advancedFilters || DEFAULT_ADVANCED_FILTERS, 'adv');
  
  // Build parameterized query
  const conditions: string[] = [];
  const params: Record<string, any> = {};
  
  // Add filters to conditions and params
  if (filters.channel) {
    conditions.push('COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, \'Other\') = @channel');
    params.channel = filters.channel;
  }
  // ... more filter conditions
  
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  
  // Main query with parameterized values
  const metricsQuery = `
    SELECT
      SUM(CASE WHEN ... THEN 1 ELSE 0 END) as prospects,
      -- ... more metrics
    FROM \`${FULL_TABLE}\` v
    LEFT JOIN \`${MAPPING_TABLE}\` nm
      ON v.Original_source = nm.original_source
    ${whereClause}
  `;
  
  const metricsParams = {
    ...params,
    ...advFilterParams,
    startDate,
    endDate: endDate + ' 23:59:59',
    recruitingRecordType: RECRUITING_RECORD_TYPE,
  };
  
  const [metrics] = await runQuery<RawFunnelMetricsResult>(metricsQuery, metricsParams);
  
  // Transform raw results to typed interface
  return {
    prospects: toNumber(metrics.prospects),
    contacted: toNumber(metrics.contacted),
    // ... more transformations
  };
}
```

---

### 3.3 Table References

**Constants Defined**:

```typescript
// From src/config/constants.ts
export const FULL_TABLE = 'savvy-gtm-analytics.Tableau_Views.vw_funnel_master';
export const FORECAST_TABLE = 'savvy-gtm-analytics.SavvyGTMData.q4_2025_forecast';
export const MAPPING_TABLE = 'savvy-gtm-analytics.SavvyGTMData.new_mapping';
export const DAILY_FORECAST_VIEW = 'savvy-gtm-analytics.Tableau_Views.vw_daily_forecast';
```

**Critical Note**: `new_mapping` table is correctly located at `savvy-gtm-analytics.SavvyGTMData.new_mapping` (NOT Tableau_Views). This was corrected in previous work.

**Usage Pattern**:
- Always use constants from `@/config/constants`
- Use template literals with backticks for table names: `` `\`${FULL_TABLE}\`` ``
- Always use LEFT JOIN with `MAPPING_TABLE` for channel grouping: `LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source`

---

### 3.4 BigQuery Validation Results (MCP)

**Query 1: Column Validation**
```sql
SELECT column_name, data_type 
FROM `savvy-gtm-analytics.Tableau_Views.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name = 'vw_funnel_master'
ORDER BY ordinal_position
LIMIT 30
```

**Result**: ✅ Query validated successfully. Schema includes all expected columns including:
- `FilterDate` (DATE)
- `stage_entered_contacting__c` (TIMESTAMP)
- `mql_stage_entered_ts` (TIMESTAMP)
- `converted_date_raw` (DATE)
- `Date_Became_SQO__c` (TIMESTAMP)
- `advisor_join_date__c` (DATE)
- `is_sqo_unique` (INT64)
- `is_joined_unique` (INT64)
- `SGA_Owner_Name__c` (STRING)
- `Opp_SGA_Name__c` (STRING)
- `Original_source` (STRING)
- `Channel_Grouping_Name` (STRING)
- And many more...

---

**Query 2: new_mapping Table Location**
```sql
SELECT table_schema, table_name 
FROM `savvy-gtm-analytics.INFORMATION_SCHEMA.TABLES`
WHERE table_name = 'new_mapping';
```

**Result**: ✅ Confirmed via MCP search - table exists at:
- **Dataset**: `SavvyGTMData`
- **Table**: `new_mapping`
- **Full Path**: `savvy-gtm-analytics.SavvyGTMData.new_mapping`

---

**Query 3: Key Metric Fields Exist**
```sql
SELECT 
  CASE WHEN COUNT(FilterDate) > 0 THEN 'EXISTS' ELSE 'MISSING' END as FilterDate,
  CASE WHEN COUNT(stage_entered_contacting__c) > 0 THEN 'EXISTS' ELSE 'MISSING' END as stage_entered_contacting,
  CASE WHEN COUNT(mql_stage_entered_ts) > 0 THEN 'EXISTS' ELSE 'MISSING' END as mql_stage_entered_ts,
  CASE WHEN COUNT(converted_date_raw) > 0 THEN 'EXISTS' ELSE 'MISSING' END as converted_date_raw,
  CASE WHEN COUNT(Date_Became_SQO__c) > 0 THEN 'EXISTS' ELSE 'MISSING' END as Date_Became_SQO__c,
  CASE WHEN COUNT(advisor_join_date__c) > 0 THEN 'EXISTS' ELSE 'MISSING' END as advisor_join_date__c,
  CASE WHEN COUNT(is_sqo_unique) > 0 THEN 'EXISTS' ELSE 'MISSING' END as is_sqo_unique,
  CASE WHEN COUNT(is_joined_unique) > 0 THEN 'EXISTS' ELSE 'MISSING' END as is_joined_unique
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE FilterDate >= '2025-01-01';
```

**Result**: ✅ All fields EXIST
```json
{
  "Date_Became_SQO__c": "EXISTS",
  "FilterDate": "EXISTS",
  "advisor_join_date__c": "EXISTS",
  "converted_date_raw": "EXISTS",
  "is_joined_unique": "EXISTS",
  "is_sqo_unique": "EXISTS",
  "mql_stage_entered_ts": "EXISTS",
  "stage_entered_contacting": "EXISTS"
}
```

---

**Query 4: Conversion Progression Flags**
```sql
SELECT 
  CASE WHEN COUNT(sql_to_sqo_progression) > 0 THEN 'EXISTS' ELSE 'MISSING' END as sql_to_sqo_progression,
  CASE WHEN COUNT(eligible_for_sql_conversions) > 0 THEN 'EXISTS' ELSE 'MISSING' END as eligible_for_sql_conversions,
  CASE WHEN COUNT(mql_to_sql_progression) > 0 THEN 'EXISTS' ELSE 'MISSING' END as mql_to_sql_progression,
  CASE WHEN COUNT(eligible_for_mql_conversions) > 0 THEN 'EXISTS' ELSE 'MISSING' END as eligible_for_mql_conversions
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE FilterDate >= '2025-01-01';
```

**Result**: ✅ All flags EXIST
```json
{
  "eligible_for_mql_conversions": "EXISTS",
  "eligible_for_sql_conversions": "EXISTS",
  "mql_to_sql_progression": "EXISTS",
  "sql_to_sqo_progression": "EXISTS"
}
```

---

**Query 5: Channel JOIN Validation**
```sql
SELECT 
  COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') as channel,
  COUNT(*) as record_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.new_mapping` nm 
  ON v.Original_source = nm.original_source
WHERE v.FilterDate >= '2025-01-01'
GROUP BY 1
ORDER BY 2 DESC
LIMIT 10;
```

**Result**: ✅ JOIN works correctly. Sample results:
```json
{"channel": "Advisor Referrals", "record_count": 37}
```

---

**Query 6: Record Type Validation**
```sql
SELECT DISTINCT recordtypeid, record_type_name, COUNT(*) as cnt
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE record_type_name = 'Recruiting'
GROUP BY 1, 2;
```

**Result**: ✅ Confirmed
```json
{
  "cnt": 1949,
  "record_type_name": "Recruiting",
  "recordtypeid": "012Dn000000mrO3IAI"
}
```

**Expected**: `recordtypeid = '012Dn000000mrO3IAI'` ✅ **MATCHES**

---

## Section 4: Authentication & Permissions

### 4.1 Session Management

**File**: `src/lib/auth.ts`

**Session Structure**:

```typescript
// Extended session with permissions attached
export interface ExtendedSession extends Session {
  permissions?: UserPermissions;
}

// Helper to safely get permissions from session
export function getSessionPermissions(
  session: Session | ExtendedSession | null | undefined
): UserPermissions | null {
  if (hasPermissions(session)) {
    return session.permissions;
  }
  return null;
}
```

**Getting Session in API Route**:

```typescript
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Session is available, permissions attached via callback
}
```

**NextAuth Configuration**:
- Uses CredentialsProvider (email/password)
- JWT strategy with 24-hour maxAge
- Session callback attaches permissions via `getUserPermissions()`
- Custom login page at `/login`

---

### 4.2 Permission System

**File**: `src/lib/permissions.ts`

**`UserPermissions` Interface**:

```typescript
export interface UserPermissions {
  role: 'admin' | 'manager' | 'sgm' | 'sga' | 'viewer';
  allowedPages: number[];
  sgaFilter: string | null;  // If SGA, filter to their records
  sgmFilter: string | null;  // If SGM, filter to their team
  canExport: boolean;
  canManageUsers: boolean;
}
```

**Role Definitions**:

| Role | Pages Allowed | Can Export | Can Manage Users | SGA Filter | SGM Filter |
|------|---------------|------------|------------------|------------|------------|
| admin | [1,2,3,4,5,6,7,8,9] | ✅ Yes | ✅ Yes | null | null |
| manager | [1,2,3,4,5,6,7,8,9] | ✅ Yes | ✅ Yes | null | null |
| sgm | [1,2,3,6] | ✅ Yes | ❌ No | null | user.name |
| sga | [1,2,6,8] | ✅ Yes | ❌ No | user.name | null |
| viewer | [1,2] | ❌ No | ❌ No | null | null |

**`getUserPermissions()` Function**:

```typescript
export async function getUserPermissions(email: string): Promise<UserPermissions> {
  const user = await getUserByEmail(email);
  
  if (!user) {
    return {
      role: 'viewer',
      allowedPages: [1, 2],
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

**Self-Serve Analytics Access**: All roles with `canExport: true` should have access (admin, manager, sgm, sga). Viewers should NOT have access.

---

### 4.3 RBAC Filter Application

**Lead-Level Filter Pattern** (prospects, contacted, mqls, sqls):

```typescript
// Uses SGA_Owner_Name__c for lead-level metrics
const sgaFilterForLead = filters.sga ? ' AND v.SGA_Owner_Name__c = @sga' : '';

// In query CASE statement:
SUM(
  CASE 
    WHEN v.FilterDate IS NOT NULL
      AND TIMESTAMP(v.FilterDate) >= TIMESTAMP(@startDate) 
      AND TIMESTAMP(v.FilterDate) <= TIMESTAMP(@endDate)
      ${sgaFilterForLead}
    THEN 1 
    ELSE 0 
  END
) as prospects
```

**Opportunity-Level Filter Pattern** (sqos, joined, AUM):

```typescript
// Uses BOTH SGA_Owner_Name__c AND Opp_SGA_Name__c for opportunity metrics
// Because an SQO can be associated via either field
const sgaFilterForOpp = filters.sga 
  ? ' AND (v.SGA_Owner_Name__c = @sga OR v.Opp_SGA_Name__c = @sga)' 
  : '';

// In query CASE statement:
SUM(
  CASE 
    WHEN Date_Became_SQO__c IS NOT NULL
      AND TIMESTAMP(Date_Became_SQO__c) >= TIMESTAMP(@startDate) 
      AND TIMESTAMP(Date_Became_SQO__c) <= TIMESTAMP(@endDate)
      AND recordtypeid = @recruitingRecordType
      AND is_sqo_unique = 1
      ${sgaFilterForOpp}
    THEN 1 
    ELSE 0 
  END
) as sqos
```

**Note**: Main dashboard does NOT automatically apply SGA/SGM filters. All users see all data. SGA filters are only applied in SGA Hub features.

---

## Section 5: Type System

### 5.1 Dashboard Types

**File**: `src/types/dashboard.ts`

**Key Types**:

```typescript
export interface FunnelMetrics {
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

export interface ConversionRatesResponse {
  contactedToMql: ConversionRateResult;
  mqlToSql: ConversionRateResult;
  sqlToSqo: ConversionRateResult;
  sqoToJoined: ConversionRateResult;
  mode: 'period' | 'cohort';
}

export interface DetailRecord {
  id: string;
  advisorName: string;
  source: string;
  channel: string;
  stage: string;
  sga: string | null;
  sgm: string | null;
  aum: number;
  aumFormatted: string;
  salesforceUrl: string;
  relevantDate: string;
  initialCallScheduledDate: string | null;
  qualificationCallDate: string | null;
  isContacted: boolean;
  isMql: boolean;
  isSql: boolean;
  isSqo: boolean;
  isJoined: boolean;
  isOpenPipeline: boolean;
}

export interface TrendDataPoint {
  period: string;
  sqls: number;
  sqos: number;
  joined: number;
  contactedToMqlRate: number;
  mqlToSqlRate: number;
  sqlToSqoRate: number;
  sqoToJoinedRate: number;
  isSelectedPeriod?: boolean;
}
```

---

### 5.2 Filter Types

**File**: `src/types/filters.ts`

**`DashboardFilters` Interface**:

```typescript
export interface DashboardFilters {
  startDate: string;
  endDate: string;
  datePreset: 'ytd' | 'qtd' | 'q1' | 'q2' | 'q3' | 'q4' | 'custom' | 'last30' | 'last90';
  year: number;
  channel: string | null;
  source: string | null;
  sga: string | null;
  sgm: string | null;
  stage: string | null;
  experimentationTag: string | null;
  metricFilter: 'all' | 'prospect' | 'contacted' | 'mql' | 'sql' | 'sqo' | 'joined' | 'openPipeline';
  advancedFilters?: AdvancedFilters;
}
```

**`FilterOptions` Interface**:

```typescript
export interface FilterOptions {
  channels: string[];
  sources: string[];
  sgas: FilterOption[];
  sgms: FilterOption[];
  stages: string[];
  years: number[];
  experimentationTags: string[];
}
```

**New Types Needed for Agent**:
- `AgentQuery` - User's natural language query
- `AgentResponse` - Structured response with SQL, results, explanation
- `AgentExportOptions` - Export format preferences (CSV, PNG, SQL, ZIP)

---

### 5.3 BigQuery Raw Types

**File**: `src/types/bigquery-raw.ts`

**Helper Functions**:

```typescript
export function toNumber(value: number | null | undefined): number {
  return Number(value) || 0;
}

export function toString(value: string | null | undefined): string {
  return value ?? '';
}

// extractDateValue is defined in query files, not in bigquery-raw.ts
// Pattern used in src/lib/queries/record-detail.ts and drill-down.ts:
function extractDateValue(
  field: { value: string } | string | null | undefined
): string | null {
  if (!field) return null;
  
  // Handle object format: { value: "2025-01-15T10:30:00Z" }
  if (typeof field === 'object' && field !== null && 'value' in field) {
    return typeof field.value === 'string' ? field.value : null;
  }
  
  // Handle string format: "2025-01-15" or "2025-01-15T10:30:00Z"
  if (typeof field === 'string') {
    return field;
  }
  
  return null;
}
```

**BigQuery Return Type Patterns**:
- TIMESTAMP fields: Often returned as `{ value: string }` objects
- DATE fields: Usually returned as strings directly
- Numbers: Can be `number | null`
- Strings: Can be `string | null`

---

## Section 6: Component Patterns

### 6.1 Dashboard Components

**Files in `src/components/dashboard/`**:
- `AdvancedFilters.tsx` - Advanced filter slide-out panel
- `ChannelPerformanceTable.tsx` - Channel performance table
- `ConversionRateCards.tsx` - Conversion rate display cards
- `ConversionTrendChart.tsx` - Conversion trend chart (Recharts)
- `DetailRecordsTable.tsx` - Detailed records table with sorting/search
- `ExportToSheetsButton.tsx` - Google Sheets export button
- `ForecastComparison.tsx` - Forecast comparison component
- `FullFunnelScorecards.tsx` - Full funnel metric cards
- `FunnelProgressStepper.tsx` - Funnel stage progress indicator
- `GlobalFilters.tsx` - Main filter bar component
- `OpenPipelineAumTooltip.tsx` - Tooltip explaining open pipeline AUM
- `RecordDetailModal.tsx` - Full record detail modal
- `RecordDetailSkeleton.tsx` - Loading skeleton for record detail
- `Scorecards.tsx` - Metric scorecard display
- `SourcePerformanceTable.tsx` - Source performance table
- `ViewModeToggle.tsx` - Toggle between focused/fullFunnel views
- `VolumeTrendChart.tsx` - Volume trend chart (Recharts)

**Key Component Patterns**:

1. **Data Display Component** (Scorecards):
```typescript
interface ScorecardsProps {
  metrics: FunnelMetrics;
  selectedMetric: string | null;
  onMetricClick: (metric: string) => void;
}

export function Scorecards({ metrics, selectedMetric, onMetricClick }: ScorecardsProps) {
  // Uses Tremor Card and Metric components
  // Handles click events for drill-down
}
```

2. **Chart Component** (ConversionTrendChart):
```typescript
interface ConversionTrendChartProps {
  trends: TrendDataPoint[];
  onGranularityChange?: (granularity: 'month' | 'quarter') => void;
  granularity?: 'month' | 'quarter';
  mode: ConversionTrendMode;
  onModeChange?: (mode: ConversionTrendMode) => void;
  isLoading?: boolean;
}

export function ConversionTrendChart({ trends, ... }: ConversionTrendChartProps) {
  // Uses Recharts (BarChart, Bar, XAxis, YAxis, etc.)
  // Uses CHART_COLORS from @/config/theme
  // Supports dark mode via next-themes
}
```

3. **Table Component** (DetailRecordsTable):
```typescript
interface DetailRecordsTableProps {
  records: DetailRecord[];
  title?: string;
  filterDescription?: string;
  canExport?: boolean;
  viewMode?: ViewMode;
  advancedFilters?: AdvancedFilters;
  metricFilter?: 'all' | 'prospect' | 'contacted' | 'mql' | 'sql' | 'sqo' | 'joined' | 'openPipeline';
  onRecordClick?: (recordId: string) => void;
}

export function DetailRecordsTable({ records, ... }: DetailRecordsTableProps) {
  // Uses Tremor Table components
  // Implements sorting, search, pagination
  // Handles row clicks for record detail modal
}
```

---

### 6.2 Modal Patterns

**Existing Modal Example** (`RecordDetailModal.tsx`):

```typescript
interface RecordDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  recordId: string | null;
  initialRecord?: RecordDetailFull | null;
  showBackButton?: boolean;
  onBack?: () => void;
  backButtonLabel?: string;
}

export function RecordDetailModal({ isOpen, onClose, ... }: RecordDetailModalProps) {
  const [record, setRecord] = useState<RecordDetailFull | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 transition-opacity"
        onClick={onClose}
      />
      
      {/* Modal Content */}
      <div className="relative z-10 max-w-4xl mx-auto my-8 bg-white dark:bg-gray-800 rounded-lg shadow-xl">
        {/* Header with close button */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-xl font-semibold">Record Details</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        {/* Content */}
        <div className="p-6">
          {loading && <RecordDetailSkeleton />}
          {error && <div className="text-red-600">{error}</div>}
          {record && <RecordDetailContent record={record} />}
        </div>
      </div>
    </div>
  );
}
```

**Key Modal Elements**:
- **Overlay pattern**: Fixed inset-0 with backdrop div and content div
- **Close handling**: ESC key (via React), backdrop click, close button
- **State management**: `isOpen` prop controls visibility, internal `loading`/`error`/`data` states
- **Animation**: CSS transitions on backdrop opacity, no complex animations

---

### 6.3 Drawer/Slide-out Patterns

**Existing Drawer Components Found**: ✅ **AdvancedFilters.tsx** uses slide-out pattern

**Slide-out Pattern** (from `AdvancedFilters.tsx`):

```typescript
export function AdvancedFilters({ isOpen, onClose, ... }: AdvancedFiltersProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/30 transition-opacity"
        onClick={onClose}
      />
      
      {/* Slide-out panel */}
      <div className="absolute right-0 top-0 h-full w-96 bg-white dark:bg-gray-800 shadow-xl transform transition-transform overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0">
          <h2 className="text-lg font-semibold">Advanced Filters</h2>
          <button onClick={onClose}>...</button>
        </div>
        
        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Filter controls */}
        </div>
        
        {/* Footer with actions */}
        <div className="px-4 py-3 border-t flex-shrink-0">
          <button onClick={handleApply}>Apply</button>
        </div>
      </div>
    </div>
  );
}
```

**Recommended Approach for Explore Panel**: Use the same slide-out pattern as `AdvancedFilters.tsx`:
- Fixed overlay with backdrop
- Slide-out from right side
- Width: 600-800px (wider than AdvancedFilters' 384px)
- Same dark mode support
- Same close/backdrop click handling

---

### 6.4 Chart Components

**Libraries Used**:
- **Tremor**: `Card`, `Title`, `Text`, `Table`, `Badge`, `Button`, `Metric` - UI components
- **Recharts**: `BarChart`, `Bar`, `LineChart`, `Line`, `XAxis`, `YAxis`, `CartesianGrid`, `Tooltip`, `Legend`, `ResponsiveContainer`, `LabelList` - Chart components

**Chart Data Format Pattern**:

```typescript
// TrendDataPoint[] for time series charts
const trends: TrendDataPoint[] = [
  {
    period: '2025-Q1',
    sqls: 100,
    sqos: 50,
    joined: 25,
    contactedToMqlRate: 0.75,
    mqlToSqlRate: 0.60,
    sqlToSqoRate: 0.50,
    sqoToJoinedRate: 0.50,
  },
  // ... more periods
];

// Used in Recharts:
<BarChart data={trends}>
  <Bar dataKey="sqos" fill={CHART_COLORS.primary} />
  <XAxis dataKey="period" />
  <YAxis />
</BarChart>
```

**Theme/Dark Mode Handling**:

```typescript
import { useTheme } from 'next-themes';
import { CHART_COLORS } from '@/config/theme';

export function ConversionTrendChart({ trends }: Props) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  
  return (
    <BarChart data={trends}>
      <CartesianGrid 
        strokeDasharray="3 3" 
        stroke={isDark ? CHART_COLORS.gridDark : CHART_COLORS.grid}
      />
      <Bar 
        dataKey="sqos" 
        fill={CHART_COLORS.primary}
      />
    </BarChart>
  );
}
```

**Chart Colors** (from `src/config/theme.ts`):
```typescript
export const CHART_COLORS = {
  primary: '#3b82f6',      // blue-500
  secondary: '#8b5cf6',    // violet-500
  tertiary: '#06b6d4',     // cyan-500
  quaternary: '#f59e0b',   // amber-500
  quinary: '#10b981',      // emerald-500
  contactedToMql: '#3b82f6',
  mqlToSql: '#10b981',
  sqlToSqo: '#f59e0b',
  sqoToJoined: '#8b5cf6',
  grid: '#e2e8f0',
  gridDark: '#334155',
  axis: '#64748b',
} as const;
```

---

### 6.5 Table Components

**Tremor Table Usage Pattern**:

```typescript
import { Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell } from '@tremor/react';

<Table>
  <TableHead>
    <TableRow>
      <TableHeaderCell>Advisor</TableHeaderCell>
      <TableHeaderCell>Source</TableHeaderCell>
      <TableHeaderCell>AUM</TableHeaderCell>
    </TableRow>
  </TableHead>
  <TableBody>
    {records.map((record) => (
      <TableRow 
        key={record.id}
        onClick={() => onRecordClick?.(record.id)}
        className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"
      >
        <TableCell>{record.advisorName}</TableCell>
        <TableCell>{record.source}</TableCell>
        <TableCell>{record.aumFormatted}</TableCell>
      </TableRow>
    ))}
  </TableBody>
</Table>
```

**Sorting Implementation**:

```typescript
type SortColumn = 'advisor' | 'source' | 'aum' | null;
type SortDirection = 'asc' | 'desc';

const [sortColumn, setSortColumn] = useState<SortColumn>(null);
const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

const sortedRecords = useMemo(() => {
  if (!sortColumn) return records;
  return [...records].sort((a, b) => {
    let comparison = 0;
    switch (sortColumn) {
      case 'advisor':
        comparison = a.advisorName.localeCompare(b.advisorName);
        break;
      case 'aum':
        comparison = a.aum - b.aum;
        break;
    }
    return sortDirection === 'asc' ? comparison : -comparison;
  });
}, [records, sortColumn, sortDirection]);
```

**Pagination Approach**: No built-in pagination in Tremor. Current implementation shows all records (up to 50,000 limit). For agent results, implement client-side pagination with `useState` for current page and page size.

**Row Click Handling**:

```typescript
<TableRow 
  onClick={() => onRecordClick?.(record.id)}
  className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"
>
```

**Export Functionality**:

```typescript
import { ExportButton } from '@/components/ui/ExportButton';

<ExportButton 
  data={sortedRecords.map(r => ({
    'Advisor': r.advisorName,
    'Source': r.source,
    'AUM': r.aumFormatted,
  }))} 
  filename="detail-records" 
/>
```

---

## Section 7: API Client & Data Fetching

### 7.1 API Client Structure

**File**: `src/lib/api-client.ts`

**`apiFetch()` Function**:

```typescript
async function apiFetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
  let fullUrl: string;
  
  if (typeof window !== 'undefined') {
    // Browser: use relative URLs
    fullUrl = endpoint;
  } else {
    // Server-side: construct absolute URL
    const baseUrl = getBaseUrl(); // Handles Vercel/localhost
    fullUrl = baseUrl && baseUrl.trim() !== '' ? `${baseUrl}${endpoint}` : endpoint;
  }
  
  const response = await fetch(fullUrl, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new ApiError(errorData.error || response.statusText, response.status, endpoint);
  }

  return response.json();
}
```

**`dashboardApi` Object**:

```typescript
export const dashboardApi = {
  getFilterOptions: () => apiFetch<FilterOptions>('/api/dashboard/filters'),
  
  getFunnelMetrics: (filters: DashboardFilters, viewMode?: ViewMode) =>
    apiFetch<FunnelMetricsWithGoals>('/api/dashboard/funnel-metrics', {
      method: 'POST',
      body: JSON.stringify({ filters, ...(viewMode && { viewMode }) }),
    }),
  
  getConversionRates: (filters: DashboardFilters, options?: { includeTrends?: boolean; granularity?: 'month' | 'quarter'; mode?: 'period' | 'cohort' }) =>
    apiFetch<{ rates: ConversionRatesResponse; trends: TrendDataPoint[] | null; mode?: string }>('/api/dashboard/conversion-rates', {
      method: 'POST',
      body: JSON.stringify({ filters, ...options }),
    }),
  
  getChannelPerformance: (filters: DashboardFilters, viewMode?: ViewMode) =>
    apiFetch<{ channels: ChannelPerformanceWithGoals[] }>('/api/dashboard/source-performance', {
      method: 'POST',
      body: JSON.stringify({ filters, groupBy: 'channel', ...(viewMode && { viewMode }) }),
    }),
  
  getSourcePerformance: (filters: DashboardFilters, viewMode?: ViewMode) =>
    apiFetch<{ sources: SourcePerformanceWithGoals[] }>('/api/dashboard/source-performance', {
      method: 'POST',
      body: JSON.stringify({ filters, groupBy: 'source', ...(viewMode && { viewMode }) }),
    }),
  
  getDetailRecords: (filters: DashboardFilters, limit = 50000) =>
    apiFetch<{ records: DetailRecord[] }>('/api/dashboard/detail-records', {
      method: 'POST',
      body: JSON.stringify({ filters, limit }),
    }),
  
  getRecordDetail: (id: string) =>
    apiFetch<{ record: RecordDetailFull | null }>(`/api/dashboard/record-detail/${encodeURIComponent(id)}`, {
      method: 'GET',
    }).then(data => data.record || null),
  
  // ... more methods
};
```

**`ApiError` Class**:

```typescript
export class ApiError extends Error {
  constructor(message: string, public status: number, public endpoint: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export function handleApiError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Please sign in to continue';
    if (error.status === 403) return 'You do not have permission';
    return error.message;
  }
  return 'An unexpected error occurred';
}
```

---

### 7.2 Dashboard Page Data Fetching

**File**: `src/app/dashboard/page.tsx`

**State Variables**:

```typescript
const [loading, setLoading] = useState(true);
const [filters, setFilters] = useState<DashboardFilters>(DEFAULT_FILTERS);
const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);
const [metrics, setMetrics] = useState<FunnelMetricsWithGoals | null>(null);
const [conversionRates, setConversionRates] = useState<ConversionRatesResponse | null>(null);
const [trends, setTrends] = useState<TrendDataPoint[]>([]);
const [channels, setChannels] = useState<ChannelPerformanceWithGoals[]>([]);
const [sources, setSources] = useState<SourcePerformanceWithGoals[]>([]);
const [detailRecords, setDetailRecords] = useState<DetailRecord[]>([]);
const [viewMode, setViewMode] = useState<ViewMode>('focused');
const [selectedMetric, setSelectedMetric] = useState<string | null>(null);
const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
const [selectedSource, setSelectedSource] = useState<string | null>(null);
const [trendGranularity, setTrendGranularity] = useState<'month' | 'quarter'>('quarter');
const [trendMode, setTrendMode] = useState<ConversionTrendMode>('cohort');
const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
```

**Data Fetching Pattern**:

```typescript
// Fetch filter options on mount
useEffect(() => {
  async function fetchFilterOptions() {
    try {
      const data = await dashboardApi.getFilterOptions();
      setFilterOptions(data);
    } catch (error) {
      console.error('Failed to fetch filter options:', error);
      const errorMessage = handleApiError(error);
    }
  }
  fetchFilterOptions();
}, []);

// Fetch dashboard data when filters change
const fetchDashboardData = useCallback(async () => {
  if (!filterOptions) return;
  
  setLoading(true);
  
  try {
    const dateRange = buildDateRangeFromFilters(filters);
    const currentFilters: DashboardFilters = {
      ...filters,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      metricFilter: (selectedMetric || 'all') as DashboardFilters['metricFilter'],
    };
    
    // Fetch all data in parallel
    const [metricsData, conversionData, channelsData, sourcesData, recordsData] = await Promise.all([
      dashboardApi.getFunnelMetrics(currentFilters, viewMode),
      dashboardApi.getConversionRates(currentFilters, { includeTrends: true, granularity: trendGranularity, mode: trendMode }),
      dashboardApi.getChannelPerformance(currentFilters, viewMode),
      dashboardApi.getSourcePerformance(currentFilters, viewMode),
      dashboardApi.getDetailRecords(currentFilters, 50000),
    ]);
    
    setMetrics(metricsData);
    setConversionRates(conversionData.rates);
    setTrends(conversionData.trends || []);
    setChannels(channelsData.channels);
    setSources(sourcesData.sources);
    setDetailRecords(recordsData.records);
  } catch (error) {
    console.error('Failed to fetch dashboard data:', error);
    const errorMessage = handleApiError(error);
  } finally {
    setLoading(false);
  }
}, [filters, selectedMetric, trendGranularity, trendMode, filterOptions, viewMode]);

useEffect(() => {
  if (filterOptions) {
    fetchDashboardData();
  }
}, [fetchDashboardData, filterOptions]);
```

**Loading/Error State Handling**:

```typescript
{loading ? (
  <LoadingSpinner />
) : (
  <>
    {/* Render components with data */}
    {metrics && <Scorecards metrics={metrics} />}
    {conversionRates && <ConversionRateCards conversionRates={conversionRates} />}
    {/* ... */}
  </>
)}
```

---

## Section 8: Export & Download Patterns

### 8.1 CSV Export

**Export Function Location**: `src/lib/utils/export-csv.ts`

**Export Function**:

```typescript
type CSVValue = string | number | boolean | null | undefined;
type CSVRow = Record<string, CSVValue>;

export function exportToCSV<T extends CSVRow>(
  data: T[],
  filename: string
): void {
  if (data.length === 0) return;
  
  const headers = Object.keys(data[0]);
  const csvContent = [
    headers.join(','),
    ...data.map(row => 
      headers.map(header => {
        const value = row[header];
        const stringValue = String(value ?? '');
        if (stringValue.includes(',') || stringValue.includes('"')) {
          return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
      }).join(',')
    )
  ].join('\n');
  
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${filename}_${new Date().toISOString().split('T')[0]}.csv`;
  link.click();
}
```

**Download Trigger Pattern**:

```typescript
import { ExportButton } from '@/components/ui/ExportButton';

<ExportButton 
  data={records.map(r => ({
    'Advisor': r.advisorName,
    'Source': r.source,
    'AUM': r.aumFormatted,
  }))} 
  filename="detail-records" 
/>
```

---

### 8.2 Other Export Types

**PNG/Image Export**:
- Library: ❌ **Not implemented**
- Pattern: Need to add `html-to-image` library for chart/table screenshots

**SQL File Export**:
- Implemented: ❌ **No**
- Pattern: Need to create function that generates SQL file from query string and downloads it

**ZIP Export**:
- Library: ❌ **Not implemented**
- Pattern: Need to add `jszip` library to bundle multiple files (CSV + SQL + PNG) into ZIP

**Google Sheets Export**:
- ✅ **Implemented** in `src/lib/sheets/google-sheets-exporter.ts`
- Uses Google Apps Script web app to create sheets
- Populates with service account credentials
- Exports summary, trends, detail records, conversion analysis, validation sheets

---

## Section 9: Styling & Theme

### 9.1 Tailwind Configuration

**File**: `tailwind.config.js`

**Custom Colors**:

```javascript
module.exports = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'dashboard': {
          'bg': '#f9fafb',
          'card': '#ffffff',
          'border': '#e5e7eb',
          'border-hover': '#3b82f6',
          'zebra-even': '#ffffff',
          'zebra-odd': '#f9fafb',
          'zebra-hover': '#eff6ff',
          'dark-bg': '#111827',
          'dark-card': '#1f2937',
          'dark-border': '#374151',
          'dark-border-hover': '#60a5fa',
          'dark-zebra-even': '#1f2937',
          'dark-zebra-odd': '#111827',
          'dark-zebra-hover': '#1e3a5f',
        },
      },
      boxShadow: {
        'scorecard': '0 2px 4px rgba(0, 0, 0, 0.05)',
        'scorecard-hover': '0 4px 12px rgba(59, 130, 246, 0.15)',
      },
    },
  },
};
```

**Dark Mode Configuration**:
- Mode: `'class'` (class-based, not media-based)
- Pattern: Uses `next-themes` to toggle `dark` class on `<html>` element
- All components use `dark:` prefix for dark mode styles

---

### 9.2 Theme System

**Chart Colors** (from `src/config/theme.ts`):

```typescript
export const CHART_COLORS = {
  primary: '#3b82f6',      // blue-500
  secondary: '#8b5cf6',    // violet-500
  tertiary: '#06b6d4',     // cyan-500
  quaternary: '#f59e0b',   // amber-500
  quinary: '#10b981',      // emerald-500
  contactedToMql: '#3b82f6',
  mqlToSql: '#10b981',
  sqlToSqo: '#f59e0b',
  sqoToJoined: '#8b5cf6',
  volume: '#94a3b8',
  volumeLight: '#cbd5e1',
  grid: '#e2e8f0',
  gridDark: '#334155',
  axis: '#64748b',
} as const;
```

**Theme Provider Usage**:

```typescript
// src/components/providers/ThemeProvider.tsx
import { ThemeProvider as NextThemesProvider } from 'next-themes';

export function ThemeProvider({ children }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={true}
      disableTransitionOnChange={false}
    >
      {children}
    </NextThemesProvider>
  );
}

// Usage in components:
import { useTheme } from 'next-themes';

const { resolvedTheme } = useTheme();
const isDark = resolvedTheme === 'dark';
```

---

## Section 10: Existing Chat/AI Patterns

### 10.1 Claude/AI Integration

**Search Results for AI-related code**:
- `anthropic`: ❌ **None found**
- `claude`: ❌ **None found**
- `openai`: ❌ **None found**
- `ai/` routes: ❌ **None found**

**Conclusion**: ✅ **New capability needed** - No existing AI/Claude integration. Need to:
1. Install `@anthropic-ai/sdk` package
2. Create API route `/api/agent/query` (or similar)
3. Implement streaming response pattern
4. Integrate with semantic layer for query generation

**Note**: ✅ `ANTHROPIC_API_KEY` is **already configured** in the root `.env` file (`ANTHROPIC_API_KEY=sk-ant-api0-...`). Ready for Claude integration.

---

### 10.2 Streaming Patterns

**Search Results for streaming code**:
- `ReadableStream`: ❌ **None found**
- `TextEncoder`: ❌ **None found**
- Streaming routes: ❌ **None found**

**Conclusion**: ❌ **Streaming not implemented, need to add**

**Recommended Pattern for Agent Streaming**:

```typescript
// src/app/api/agent/query/route.ts
import { ReadableStream } from 'stream';

export async function POST(request: NextRequest) {
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      
      // Send initial response
      controller.enqueue(encoder.encode('data: {"type":"thinking","content":"..."}\n\n'));
      
      // Stream Claude response
      const response = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 4096,
        stream: true,
        messages: [...],
      });
      
      for await (const chunk of response) {
        if (chunk.type === 'content_block_delta') {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'content', content: chunk.delta.text })}\n\n`));
        }
      }
      
      controller.close();
    },
  });
  
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
```

---

## Section 11: Semantic Layer Validation Summary

### 11.1 Metric Field Validation Summary

| Field | Status | Notes |
|-------|--------|-------|
| FilterDate | ✅ EXISTS | DATE type |
| stage_entered_contacting__c | ✅ EXISTS | TIMESTAMP type |
| mql_stage_entered_ts | ✅ EXISTS | TIMESTAMP type |
| converted_date_raw | ✅ EXISTS | DATE type |
| Date_Became_SQO__c | ✅ EXISTS | TIMESTAMP type |
| advisor_join_date__c | ✅ EXISTS | DATE type |
| is_sqo_unique | ✅ EXISTS | INT64 flag |
| is_joined_unique | ✅ EXISTS | INT64 flag |
| sql_to_sqo_progression | ✅ EXISTS | Conversion flag |
| eligible_for_sql_conversions | ✅ EXISTS | Eligibility flag |
| mql_to_sql_progression | ✅ EXISTS | Conversion flag |
| eligible_for_mql_conversions | ✅ EXISTS | Eligibility flag |

---

### 11.2 Dimension Field Validation Summary

| Dimension | Field | Status | Notes |
|-----------|-------|--------|-------|
| channel | Channel_Grouping_Name (via JOIN) | ✅ EXISTS | Uses COALESCE with new_mapping JOIN |
| source | Original_source | ✅ EXISTS | Direct field |
| sga | SGA_Owner_Name__c | ✅ EXISTS | Lead-level ownership |
| sga (opp) | Opp_SGA_Name__c | ✅ EXISTS | Opportunity-level ownership |
| sgm | SGM_Owner_Name__c | ✅ EXISTS | Opportunity-level ownership |
| experimentation_tag | Experimentation_Tag_Raw__c | ✅ EXISTS | String field, also has Experimentation_Tag_List array |

---

### 11.3 Critical Configuration Validation

| Item | Expected | Actual | Status |
|------|----------|--------|--------|
| new_mapping table dataset | SavvyGTMData | SavvyGTMData | ✅ **CORRECT** |
| Recruiting record type ID | 012Dn000000mrO3IAI | 012Dn000000mrO3IAI | ✅ **MATCHES** |
| Open pipeline stages | Qualifying, Discovery, Sales Process, Negotiating | Qualifying, Discovery, Sales Process, Negotiating | ✅ **MATCHES** |

---

## Section 12: Implementation Readiness

### 12.1 Dependencies Check

**Current `package.json` Dependencies**:

```json
{
  "dependencies": {
    "@auth/prisma-adapter": "^2.11.1",
    "@google-cloud/bigquery": "^7.9.4",
    "@prisma/client": "6.19.0",
    "@tremor/react": "^3.18.7",
    "@vercel/postgres": "^0.10.0",
    "bcryptjs": "^3.0.3",
    "date-fns": "^3.6.0",
    "dotenv": "^16.3.1",
    "googleapis": "^170.0.0",
    "lucide-react": "^0.300.0",
    "next": "^14.2.35",
    "next-auth": "^4.24.13",
    "next-themes": "^0.4.6",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "recharts": "^3.6.0"
  }
}
```

**Dependencies Needed for Self-Serve Analytics**:

| Package | Purpose | Currently Installed? |
|---------|---------|---------------------|
| `@anthropic-ai/sdk` | Claude API integration | ❌ **No** - Need to install |
| `html-to-image` | PNG export (chart/table screenshots) | ❌ **No** - Need to install |
| `jszip` | ZIP export (bundle CSV + SQL + PNG) | ❌ **No** - Need to install |

---

### 12.2 Environment Variables

**New Environment Variables Needed**:

| Variable | Purpose | Required | Status |
|----------|---------|----------|--------|
| `ANTHROPIC_API_KEY` | Claude API authentication | ✅ Yes | ✅ **Already configured in root `.env` file** (`ANTHROPIC_API_KEY=sk-ant-api0-...`) |

**Existing Environment Variables** (already configured in root `.env` file):
- `GCP_PROJECT_ID` - BigQuery project
- `GOOGLE_APPLICATION_CREDENTIALS_JSON` - BigQuery credentials (Vercel)
- `NEXTAUTH_SECRET` - Session encryption
- `DATABASE_URL` - PostgreSQL connection
- `ANTHROPIC_API_KEY` - ✅ **Claude API authentication** (already configured: `ANTHROPIC_API_KEY=sk-ant-api0-...`)

---

### 12.3 Deployment Configuration

**Vercel Configuration**:
- `vercel.json` exists: ✅ **Yes**
- API route timeout: Custom (60s for export-sheets route)
- Edge functions used: ❌ **No**

**Current `vercel.json`**:
```json
{
  "functions": {
    "src/app/api/dashboard/export-sheets/route.ts": {
      "maxDuration": 60
    }
  }
}
```

**Considerations for New Feature**:
- Agent API route may need longer timeout (60s) for complex queries
- Streaming responses should work within default timeout
- Consider adding timeout config for `/api/agent/query` route

---

## Section 13: UI/UX Context

### 13.1 Current Page Layout

**File**: `src/app/dashboard/layout.tsx`

**Layout Structure**:

```typescript
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <Header />
        <div className="flex overflow-x-hidden">
          <Sidebar isCollapsed={isSidebarCollapsed} onToggle={toggleSidebar} />
          <main className="flex-1 p-6 transition-all duration-300 min-w-0 overflow-x-hidden">
            {children}
          </main>
        </div>
      </div>
    </ErrorBoundary>
  );
}
```

**Entry Points for "Explore" Feature**:
- **Sidebar**: ✅ **DECIDED** - Robot-like icon in left side panel (Sidebar) for navigation
- **Full Page**: ✅ **DECIDED** - Feature will be a full page (not a drawer)
- **Navigation**: Sidebar item will navigate to `/dashboard/explore` full page route

**Implementation Decision**: 
- Use robot/Sparkles icon from `lucide-react` in Sidebar navigation
- Add as new page ID (e.g., ID 10) in `PAGES` array in `Sidebar.tsx`
- Full page implementation at `src/app/dashboard/explore/page.tsx`
- Icon should be visually distinct to indicate AI/agent functionality

---

### 13.2 Navigation Structure

**Header Component** (`src/components/layout/Header.tsx`):

```typescript
export function Header() {
  const { data: session } = useSession();

  return (
    <header className="h-16 bg-white dark:bg-gray-800 border-b px-6 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <span className="text-xl font-bold">Savvy</span>
        <span className="text-sm text-gray-500">Funnel Dashboard</span>
      </div>

      <div className="flex items-center gap-4">
        <ThemeToggle />
        {session?.user && (
          <>
            <span className="text-sm">{session.user.email}</span>
            <button onClick={() => signOut()}>Sign Out</button>
          </>
        )}
      </div>
    </header>
  );
}
```

**Sidebar Component** (`src/components/layout/Sidebar.tsx`):

```typescript
const PAGES = [
  { id: 1, name: 'Funnel Performance', href: '/dashboard', icon: BarChart3 },
  { id: 2, name: 'Channel Drilldown', href: '/dashboard/channels', icon: GitBranch },
  // ... more pages
  { id: 9, name: 'SGA Management', href: '/dashboard/sga-management', icon: Users },
];
```

**Implementation Decision for "Explore" Entry Point**:
- ✅ **DECIDED**: Full page implementation (not drawer)
- ✅ **DECIDED**: Robot-like icon in left Sidebar panel
- **Sidebar Entry**: Add as page ID 10 in `PAGES` array:
  ```typescript
  { id: 10, name: 'Explore', href: '/dashboard/explore', icon: Bot } // or Sparkles, Brain, etc.
  ```
- **Icon Options**: Consider `Bot`, `Sparkles`, `Brain`, or `Zap` from `lucide-react` for AI/agent feel
- **Full Page Route**: Create `src/app/dashboard/explore/page.tsx` for the full page implementation
- **No Drawer**: Decision made to use full page instead of slide-out drawer pattern

---

### 13.3 Responsive Design Patterns

**Breakpoints Used**:
- Mobile: Default (no prefix)
- Tablet: `md:` (768px+)
- Desktop: `lg:` (1024px+), `xl:` (1280px+)

**Mobile-Specific Patterns**:
- Sidebar collapses to icon-only on mobile (already implemented)
- Tables scroll horizontally on mobile
- Modals are full-screen on mobile (via responsive classes)
- Charts use `ResponsiveContainer` from Recharts for auto-sizing

**Considerations for Explore Drawer**:
- On mobile: Full-screen overlay (like modal)
- On tablet/desktop: Slide-out from right (384-600px width)
- Backdrop click closes drawer
- ESC key closes drawer

---

## Implementation Readiness Summary

### ✅ Ready Components

| Component | Status | Notes |
|-----------|--------|-------|
| BigQuery integration | ✅ Ready | Client configured, query patterns established |
| Authentication | ✅ Ready | NextAuth with session management |
| RBAC filters | ✅ Ready | Permission system with role-based access |
| Type system | ✅ Ready | Comprehensive TypeScript types |
| API route patterns | ✅ Ready | Standardized patterns for all routes |
| Component patterns | ✅ Ready | Modal, table, chart patterns established |
| Export (CSV) | ✅ Ready | CSV export implemented |
| Theme system | ✅ Ready | Dark mode with next-themes |
| Slide-out pattern | ✅ Ready | AdvancedFilters component as reference |

---

### ⚠️ Components Needing Work

| Component | Status | Work Needed |
|-----------|--------|-------------|
| Claude API integration | ❌ Not implemented | Need to add Anthropic SDK, create API route |
| Streaming responses | ❌ Not implemented | Need to implement ReadableStream pattern |
| Drawer component | ⚠️ Pattern exists | Adapt AdvancedFilters pattern for explore drawer |
| PNG export | ❌ Not implemented | Need html-to-image library |
| SQL file export | ❌ Not implemented | Need to create SQL file download function |
| ZIP export | ❌ Not implemented | Need jszip library |
| Semantic layer migration | ✅ **COMPLETE** | Files migrated to src/lib/semantic-layer/ |

---

### 📋 Pre-Implementation Checklist

- [x] ✅ Semantic layer files migrated to `src/lib/semantic-layer/` (**COMPLETE**)
- [x] ✅ `ANTHROPIC_API_KEY` verified in environment (**already configured in root `.env` file**)
- [ ] Required dependencies installed (`@anthropic-ai/sdk`, `html-to-image`, `jszip`)
- [x] ✅ BigQuery validation queries all pass (all validated)
- [x] ✅ Entry point location decided: **Full page with robot icon in Sidebar** (not drawer)
- [ ] UI mockups reviewed and approved
- [ ] Streaming response pattern implemented
- [ ] Export functionality (CSV, PNG, SQL, ZIP) implemented

---

### 🚨 Potential Challenges

1. **Streaming Response Complexity**: Need to handle SSE (Server-Sent Events) properly in Next.js App Router
2. **Query Generation Accuracy**: Semantic layer needs to correctly map natural language to SQL
3. **Large Result Sets**: Need pagination/chunking for very large query results
4. **Error Handling**: Need graceful error messages when queries fail or return no results
5. **Performance**: Complex queries may take time - need loading states and progress indicators
6. **Security**: Ensure all queries respect RBAC filters and don't expose sensitive data

---

### 💡 Recommendations

1. **Start with MVP**: Implement basic query → SQL → results flow before adding streaming/export
2. **Use Existing Patterns**: Leverage AdvancedFilters slide-out pattern for explore drawer
3. **Incremental Features**: Add export formats one at a time (CSV first, then PNG, SQL, ZIP)
4. **Error Boundaries**: Wrap agent UI in error boundary to catch query failures gracefully
5. **Query Validation**: Validate generated SQL before execution to catch syntax errors early
6. **Result Limits**: Implement reasonable limits (e.g., 10,000 rows max) to prevent memory issues
7. **Caching**: Consider caching common queries/results to improve performance
8. **User Feedback**: Show query explanation and SQL preview before execution

---

**END OF INVESTIGATION ANSWERS**

---

*Document completed by Cursor.ai on January 15, 2026*
