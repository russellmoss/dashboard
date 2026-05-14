# Savvy Dashboard — Architecture Reference

> **Purpose**: Single source of truth for architectural patterns, decisions, and domain knowledge.  
> **Audience**: AI agents (Cursor, Claude), developers, maintainers  
> **Status**: Living document — Cursor should validate against actual codebase and update as needed

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Data Pipeline](#2-data-pipeline)
3. [Data Layer](#3-data-layer)
4. [Caching Strategy](#4-caching-strategy)
5. [Data Freshness](#5-data-freshness)
6. [Authentication & Permissions](#6-authentication--permissions)
7. [Core Dashboard Features](#7-core-dashboard-features)
8. [Advanced Features](#8-advanced-features)
9. [SGA Hub & Management](#9-sga-hub--management)
10. [Self-Serve Analytics (Explore)](#10-self-serve-analytics-explore)
11. [Deployment & Operations](#11-deployment--operations)
12. [GC Hub](#12-gc-hub)
13. [Dashboard Requests](#13-dashboard-requests)
14. [Recruiter Hub](#14-recruiter-hub)
15. [Advisor Map](#15-advisor-map)
16. [Pipeline Catcher Game](#16-pipeline-catcher-game)
17. [SGA Activity](#17-sga-activity)
18. [Saved Reports](#18-saved-reports)
19. [SGM Hub](#19-sgm-hub)
20. [Pipeline Forecast](#20-pipeline-forecast)
21. [Savvy Analyst Bot](#21-savvy-analyst-bot)
22. [Call Intelligence](#22-call-intelligence)

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
| **Analyst Bot** | Claude Sonnet 4.6 + Slack Bolt | Conversational BI via Slack |
| **Bot Hosting** | Google Cloud Run (us-east1) | Always-on container, no CPU throttling |
| **Monitoring** | Sentry | Error tracking, logging |

### Data Flow

```
Salesforce ──► BigQuery (every 6 hours) ──► Next.js API ──► React Dashboard
  ▲                  │                                          ▲
  │                  ▼                                          │
  │           vw_funnel_master (pre-computed view)         DashboardRequest
  │                  │                                          ▲
  │                  ▼                                          │
  │     Slack ◄──► Analyst Bot (Cloud Run) ──► Claude API ──► MCP Server
  │                  │                            (Sonnet)    (schema-context)
  │                  ▼
  │           bot_audit (interaction_log, issues, issue_events)
  │
  └──── Hightouch (daily, Marketing_Segment__c writeback via Bulk API v2)
```

**Inbound (Salesforce → BigQuery):** 6 BigQuery Data Transfer Service jobs run every 6 hours, pulling incremental changes from 6 Salesforce objects into the `SavvyGTMData` dataset.

**Outbound (BigQuery → Salesforce):** 3 Hightouch syncs run daily, writing computed `Marketing_Segment__c` values back to Lead, Contact, and Opportunity records via Salesforce Bulk API v2.

### Key Principle: Single Source of Truth

All funnel metrics derive from the `vw_funnel_master` BigQuery view, which:
- Joins Leads and Opportunities with proper deduplication
- Pre-computes conversion flags (`is_sql`, `is_sqo`, `is_joined`)
- Pre-computes eligibility flags for conversion rate denominators
- Handles SGA/SGM attribution at both lead and opportunity levels

---

## 2. Data Pipeline

### Inbound: Salesforce → BigQuery (Data Transfer Service)

Six incremental transfers run **every 6 hours** via Google BigQuery Data Transfer Service. They pull changed records (based on `SystemModstamp`) from Salesforce into the `SavvyGTMData` dataset in the `northamerica-northeast2` region.

| Transfer Name | Salesforce Object | Typical Incremental Size | Notes |
|---------------|-------------------|--------------------------|-------|
| SavvyTransferLead | Lead | ~76 MB | Largest object (~87K records total) |
| SavvyTransferContact | Contact | ~121 KB | |
| SavvyTransferOpportunity | Opportunity | ~33 KB | |
| SavvyTransferTask | Task | ~262 KB | SMS + call activity records |
| SavvyTransferCampaign | Campaign | ~2 KB | |
| SavvyTransferCampaignHistory | CampaignHistory | 0–small | Often zero changes |

**How it works:** Each transfer creates a Salesforce Bulk API v1 query job, loads results into a staging table, then MERGEs into the final table. Total time for all 6: ~3 minutes. Total Salesforce API calls: ~30–36 per cycle (5–6 REST calls per object for job lifecycle).

**Schedule:** Every 6 hours. Next run times visible in BigQuery console under Data Transfers.

### Outbound: BigQuery → Salesforce (Hightouch)

Three Hightouch syncs run **daily**, writing the computed `advisor_segment` (from `FinTrx_data_CA.advisor_segments`) back to Salesforce as `Marketing_Segment__c`.

| Sync | Salesforce Object | Model Rows | Match Key | Hightouch Sync ID |
|------|-------------------|------------|-----------|-------------------|
| Marketing Segments - Lead | Lead | ~87,000 | `salesforce_lead_id` → `Id` | 2711387 |
| Marketing Segments - Contacts | Contact | ~1,100 | `salesforce_contact_id` → `Id` | 2711389 |
| Marketing Segments - Opportunity | Opportunity | ~2,200 | `salesforce_opp_id` → `Id` | 2711001 |

**Sync configuration (all three):**

| Setting | Value |
|---------|-------|
| Mode | `update` |
| Bulk API v2 | Enabled |
| Rows per batch | 10,000 |
| Split batch retry | Enabled |
| Field synced | `advisor_segment` → `Marketing_Segment__c` |

**Diff-based syncing:** On each run, Hightouch queries BigQuery for the full result set, compares against the cached results from the previous run, and only sends **changed rows** to Salesforce. A typical daily run pushes 0–50 changed rows, not the full dataset.

**Full resync** is only needed when the model primary key changes or data gets out of sync. It sends all rows.

**Model SQL pattern** (all three follow this structure):
```sql
SELECT DISTINCT
  l.Id AS salesforce_lead_id,
  seg.advisor_segment
FROM `savvy-gtm-analytics.SavvyGTMData.Lead` l
INNER JOIN `savvy-gtm-analytics.FinTrx_data_CA.advisor_segments` seg
  ON SAFE_CAST(REGEXP_REPLACE(CAST(l.FA_CRD__c AS STRING), r'[^0-9]', '') AS INT64)
     = seg.RIA_CONTACT_CRD_ID
WHERE l.IsDeleted = false
  AND l.FA_CRD__c IS NOT NULL
```

**Match key design:** Syncs match on native Salesforce `Id` (returned directly from the BigQuery source tables). This eliminates per-row REST lookups that would otherwise be needed to resolve external IDs like `FA_CRD__c`.

### Salesforce API Budget

| | Daily Limit | All 6 BQ Transfers (×4 cycles) | All 3 Hightouch Syncs (incremental) | Combined |
|--|-------------|-------------------------------|--------------------------------------|----------|
| REST API Calls | 240,000 | ~120–144 | ~45–75 | **< 0.1%** |
| Bulk API v1 Batches | 15,000 | ~24 | 0 | < 0.2% |
| Bulk API v2 Jobs | 10,000 | 0 | ~3–11 | < 0.1% |

The data pipeline consumes negligible API budget, leaving headroom for Salesforce UI users, integrations, and ad-hoc tooling.

---

## 3. Data Layer

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
export async function runQuery<T>(
  query: string,
  params?: Record<string, any>,
  types?: Record<string, string | string[]>,
): Promise<T[]>
```

`types` is optional and only required when a named array param may be empty — BQ rejects empty array params without explicit type info ("Parameter types must be provided for empty arrays."). Use `{ paramName: ['STRING'] }` to declare a STRING array; scalar params are inferred and don't need entries here.

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

## 4. Caching Strategy

### Approach

Uses Next.js `unstable_cache()` with tag-based invalidation. Chosen over Redis for simplicity — no external infrastructure needed.

### Cache Tags

| Tag | Scope |
|-----|-------|
| `dashboard` | Main funnel queries, conversion rates, source performance |
| `sga-hub` | SGA-specific queries (weekly actuals, quarterly progress) |
| `sgm-hub` | SGM-specific queries (quota progress, conversions) |
| `bot-usage` | Savvy Analyst Bot audit log queries (`/api/admin/bot-usage`) |
| `coaching-usage` | Sales-coaching pipeline rollups + drill-down (`/api/admin/coaching-usage`, `/api/admin/coaching-usage/call/[id]`) |

### TTL Policy

| Query Type | TTL | Rationale |
|------------|-----|-----------|
| Standard queries | 4 hours | Aligns with 6-hour BigQuery sync cycle (`DEFAULT_CACHE_TTL = 14400`) |
| Detail records | 2 hours | Large payloads up to 95k rows (`DETAIL_RECORDS_TTL = 7200`) |
| Bot usage | 1 hour | Slack bot audit log; admin can also force-refresh manually |

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

**Rationale**: Runs after the late-night BigQuery sync cycle, ensures morning users get fresh data.

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

## 5. Data Freshness

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

## 6. Authentication & Permissions

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

### MCP API Key Management

Users with `bqAccess: true` can be issued API keys for the remote BigQuery MCP server.

- **Model**: `McpApiKey` (table `mcp_api_keys`) — `id`, `userId`, `key` (SHA-256 hash), `isActive`, `createdAt`, `revokedAt`, `label`, `lastUsedAt`
- **Key Format**: `sk-savvy-` prefix + 40 hex chars (20 random bytes)
- **Storage**: SHA-256 hash stored in DB — plaintext shown once at creation, never retrievable
- **Lifecycle**: Generate / Revoke / Rotate (atomic revoke + generate via `$transaction`)
- **Utility**: `src/lib/mcp-key-utils.ts` — `createMcpApiKey()`, `revokeMcpApiKeys()`, `rotateMcpApiKey()`
- **UI**: Settings > User Management — "BQ Access" column, Database icon button opens `McpKeyModal` with generate/revoke/rotate + `.mcp.json` download

| Route | Methods | Purpose |
|-------|---------|---------|
| `/api/users/[id]/mcp-key` | POST, DELETE | Generate new key, revoke active key |
| `/api/users/[id]/mcp-key/rotate` | POST | Atomic revoke + generate (returns new plaintext) |

Both routes require `canManageUsers` permission (admin/revops_admin/manager).

### Role Hierarchy

| Role | Description | Data Access | Default Login Page |
|------|-------------|-------------|-------------------|
| `revops_admin` | RevOps leadership | All data, all pages, user management, scenarios, forecast | Funnel Performance |
| `admin` | Full system access | All data, most pages, user management | Funnel Performance |
| `manager` | Team oversight | All data, most pages, no user management | Funnel Performance |
| `sgm` | Sales Growth Manager | Filtered to their team's data | SGM Hub |
| `sga` | Sales Growth Advisor | Filtered to their own data only | SGA Hub |
| `viewer` | Read-only access | Limited pages, no export | Funnel Performance |
| `recruiter` | External recruiter | Filtered to their agency | Recruiter Hub |
| `capital_partner` | Capital partner | Filtered to their firm | Funnel Performance |

### Permission Properties

**Location**: `src/types/user.ts`

```typescript
interface UserPermissions {
  role: UserRole;
  allowedPages: number[];
  sgaFilter: string | null;
  sgmFilter: string | null;
  recruiterFilter: string | null;
  capitalPartnerFilter: string | null;
  canExport: boolean;
  canManageUsers: boolean;
  canManageRequests: boolean;
  canRunScenarios: boolean;
  userId: string | null;
}
```

**Implementation**: `src/lib/permissions.ts` defines `ROLE_PERMISSIONS` with base permissions, then adds role-specific filters based on user's role and name/agency.

### Page Access Control

| Page ID | Page Name | Route | revops_admin | admin | manager | sgm | sga | viewer | recruiter | capital_partner |
|---------|-----------|-------|-------------|-------|---------|-----|-----|--------|-----------|----------------|
| 1 | Funnel Performance | `/dashboard` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| 3 | Open Pipeline | `/dashboard/pipeline` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| 7 | Settings | `/dashboard/settings` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 8 | SGA Hub | `/dashboard/sga-hub` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| 10 | Explore (AI) | `/dashboard/explore` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| 11 | Chart Builder | `/dashboard/chart-builder` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| 12 | Recruiter Hub | `/dashboard/recruiter-hub` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| 13 | Dashboard Requests | `/dashboard/requests` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| 14 | Settings (Admin) | `/dashboard/settings` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 15 | Saved Reports | `/dashboard/reports` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| 16 | Capital Partner Hub | `/dashboard/gc-hub` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| 17 | Advisor Map | `/dashboard/advisor-map` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 18 | SGM Hub | `/dashboard/sgm-hub` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| 19 | Pipeline Forecast | `/dashboard/forecast` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

**Note**: Pipeline Forecast (page 19) is restricted to `revops_admin` only. It contains the realization forecast model, what-if scenario tools, and Sheets export with full audit trail.

**Note**: SGAs land on SGA Hub, SGMs land on SGM Hub, Recruiters land on Recruiter Hub after login. All other roles land on Funnel Performance.

### Automatic Data Filtering

Some API routes enforce `sgaFilter`/`sgmFilter` by overriding the frontend-supplied filter with the user's own name:

```typescript
// Pattern used in open-pipeline, forecast, export-sheets, outreach-effectiveness
if (permissions.sgaFilter) {
  filters.sga = permissions.sgaFilter; // Override — user can only see their own data
}
```

**Drill-down routes must override every SGA-identity input.** When a route accepts an `sgaName` (or similar) body arg distinct from `filters.sga`, that arg must be pinned too — otherwise a client can bypass the filter by supplying a different name. Current example: `POST /api/outreach-effectiveness/drill-down` rewrites both `filters.sga` and the standalone `sgaName` arg for `role === 'sga'`.

**Exceptions** — the following routes pass the frontend-selected filter through directly (no override), allowing SGA users to see full-team data on the funnel performance page:
- `GET /api/dashboard/filters` — SGA users see **all SGAs** in the dropdown (not filtered to their own name)
- `POST /api/dashboard/funnel-metrics` — respects the SGA selected in the UI
- `POST /api/dashboard/source-performance` — respects the SGA selected in the UI

### Canonical SGA Name Resolution

The value stored in `sgaFilter` needs to match `SGA_Owner_Name__c` in BigQuery exactly. The dashboard's `User.name` is populated from Google OAuth display name (freeform) and can drift from Salesforce `User.Name` (e.g. `Brian OHara` vs `Brian O'Hara`). To protect against this, `src/lib/sga-canonical-name.ts` resolves the user's email against `savvy-gtm-analytics.SavvyGTMData.User` (filtered to `IsSGA__c = TRUE AND IsActive = TRUE`) and returns the canonical `Name`.

This runs in the NextAuth JWT callback at sign-in (and as a one-time backfill for pre-existing tokens), caching the result on the token as `sgaCanonicalName`. `getPermissionsFromToken` in `src/lib/permissions.ts` prefers this canonical value, falling back to `tokenData.name` only if the BQ lookup failed — so login never blocks on BQ hiccups. In-process LRU cache in the helper keeps repeat lookups cheap (10-min TTL).

### Middleware Protection

Routes protected via Next.js middleware:

```typescript
export const config = {
  matcher: ['/dashboard/:path*', '/api/dashboard/:path*'],
};
```

Unauthenticated requests redirect to `/login`.

---

## 7. Core Dashboard Features

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
  signed: number;            // opp-level (legacy)
  signedAum: number;         // opp-level (legacy)
  joined: number;            // opp-level (legacy)
  joinedAum: number;         // opp-level (legacy)
  pipelineAum: number;
  openPipelineAum: number;
  // Disposition counts (all / open / lost / converted) for Contacted, MQL, SQL, SQO
  contacted_open: number; contacted_lost: number; contacted_converted: number;
  mqls_open: number; mqls_lost: number; mqls_converted: number;
  sqls_open: number; sqls_lost: number; sqls_converted: number;
  sqos_open: number; sqos_lost: number; sqos_converted: number;
  // SQO AUM — mirrors SQO disposition counts so the UI toggle can switch
  // count and AUM together against the same cohort. AUM formula:
  // COALESCE(Underwritten_AUM__c, Amount, 0) filtered by
  // is_sqo_unique = 1 AND is_primary_opp_record = 1 (matches Slack bot pattern).
  sqoAum: number;
  sqoAum_open: number;
  sqoAum_lost: number;
  sqoAum_converted: number;
  // Advisor-level Joined metrics (vw_close_won). All/Current/Churned toggle.
  joined_all: number; joined_current: number; joined_churned: number;
  joinedAum_all: number;       // Underwritten AUM across all joined accounts in range
  joinedAum_current: number;   // Account_Total_AUM__c (live actual) for currently-joined
  joinedAum_churned: number;   // Underwritten AUM at join (Account_Total_AUM__c is NULL post-churn)
  // Advisor-level Signed metrics (vw_signed_advisors). All/Joined/Lost toggle.
  signed_all: number; signed_joined: number; signed_lost: number;
  signedAum_all: number; signedAum_joined: number; signedAum_lost: number;
}
```

**SQO scorecard layout** (`src/components/dashboard/Scorecards.tsx`): SQO count, subtitle, DispositionToggle, then a divider and a second `Metric`-sized **SQO AUM** block that switches with the toggle (`getSqoAum()`), then optional GoalDisplay when toggle = "all".

**Joined / Signed scorecard layout** (`src/components/dashboard/Scorecards.tsx` + `ScorecardToggle.tsx`):
- **Joined card**: All / Current / Churned toggle. Counts individual advisors (Contacts) from `vw_close_won` filtered by `joined_date` in range. Joined AUM card paired below switches with the toggle: All/Churned use Underwritten (deal value at join); Current uses `Account.Account_Total_AUM__c` (live actual book). Goal pill shown only on "All".
- **Signed card**: All / Joined / Lost toggle. Counts individual advisors from `vw_signed_advisors` filtered by `signed_date` in range. Cohort flag: `joined` = StageName='Joined', `lost` = StageName='Closed Lost', `in_flight` = otherwise (still Signed). All AUMs use Underwritten (deal value at signing).
- **Drill-downs are advisor-grain**: clicking the card opens a table of one row per individual advisor, not per Opportunity. Team Accounts (Blue Barn, Marcado) expand into their advisor lists. Toggle state is honored — clicking with "Current" toggle filters to currently-joined advisors only.
- **Alltime preset includes NULL-joined-date advisors** (legitimate Joined Contacts without a joining Opp in SFDC). Specific-period filters still require a known date.
- **Toggle state types**: `JoinedDisposition = 'all' | 'current' | 'churned'`, `SignedDisposition = 'all' | 'joined' | 'lost'` (`src/types/filters.ts`). State lives in dashboard page, passed to Scorecards and through to drill-down filters via `cleanFilters` in `api-client.ts`.

**Contacted scorecard** (`src/components/dashboard/FullFunnelScorecards.tsx`): Full-funnel view also exposes a DispositionToggle on the Contacted card. Cohort anchor is `is_contacted = 1` with `stage_entered_contacting__c` in the date range. Converted = advanced to MQL (`is_mql = 1`), Lost = never MQL'd and closed (`is_mql = 0 AND lead_closed_date IS NOT NULL`), Open = never MQL'd and still open (`is_mql = 0 AND lead_closed_date IS NULL`). Drill-down (`src/lib/queries/detail-records.ts`) honors the same `metricDisposition` filter.

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
- Multi-column sorting (by first name for advisor/SGA/SGM columns)
- Fuzzy search across: Advisor, SGA, SGM, Source, Channel
- Stage filter dropdown (funnel stages + opportunity stages)
- Dynamic date column based on selected stage filter
- Metric filter (click scorecard to filter)
- Row click opens Record Detail Modal

**Query Limit**: 50,000 records (increased from 500).

**Location**:
- Query: `src/lib/queries/detail-records.ts` — uses `LIMIT 50000` in SQL query
- Component: `src/components/dashboard/DetailRecordsTable.tsx` — table rendering, sorting, search, pagination
- Helpers: `src/components/dashboard/detail-records-table-utils.ts` — `fuzzyMatch()` (multi-strategy search), `getFirstName()` (name sorting)

**Consumers**: Main dashboard (`page.tsx` via `next/dynamic`), `VolumeDrillDownModal`, `ExploreResults`

### Global Filters

Available filters applied to all queries (Funnel Performance & Efficiency page).

Main filter bar (`src/components/dashboard/GlobalFilters.tsx`):
- **Date Preset** (single-select): YTD, QTD, Q1-Q4, Last 30/90 days, Custom
- **Year** (single-select): defaults to current year
- **Channel** (multi-select with type-to-search): from distinct values in data
- **Source** (multi-select with type-to-search): from distinct values in data
- **SGA** (multi-select with type-to-search, Active/All toggle): may be auto-scoped by permissions
- **SGM** (multi-select with type-to-search, Active/All toggle): may be auto-scoped by permissions
- **Campaign** (multi-select with type-to-search): from distinct values in data
- **Lead Score Tiers** (multi-select with type-to-search): includes synthetic "(No Tier)" option (`__NO_TIER__` sentinel, handled in `src/lib/utils/filter-helpers.ts`)

All six multi-select filters share the `MultiSelectCombobox` primitive from `src/components/ui/MultiSelectCombobox.tsx`, which is also used by the Outreach Effectiveness campaign filter.

Main-bar multi-select state is stored on `filters.advancedFilters.{channels,sources,sgas,sgms,campaigns,leadScoreTiers}` (shape: `{ selectAll: boolean, selected: string[] }`) — one source of truth with the query layer's `buildAdvancedFilterClauses`. Empty selection = `selectAll: true` = "all values". The legacy single-select fields on `DashboardFilters` (`channel`, `source`, `sga`, `sgm`, `campaignId`) remain on the type because Record Detail Modal, Explore AI, and the semantic layer still reference them, but the main bar no longer writes to them.

The Advanced Filters slide-out panel has been removed — all filters now live on the main bar. The `AdvancedFilters` type and `DEFAULT_ADVANCED_FILTERS` remain in `src/types/filters.ts` because they are the storage shape for main-bar multi-select state.

Note: **Experimentation Tag** has been deprecated and removed from all filter UI. The field still exists on the shared `Filters` type because Record Detail Modal, Explore AI results, and the semantic layer continue to reference it; a full cross-codebase deprecation is a possible follow-up.

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
- `/api/dashboard/record-detail/[id]/activity` - Activity timeline (Tasks) for a record
- `/api/dashboard/record-detail/[id]/notes` - Sales-coaching call_notes for a record (RBAC-gated, see §7.2 Notes Tab)
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

**Outreach Effectiveness Routes**:
- `/api/outreach-effectiveness/dashboard` - POST: Main dashboard data (5 metrics + SGA breakdown)
- `/api/outreach-effectiveness/filters` - GET: SGA and campaign filter options
- `/api/outreach-effectiveness/drill-down` - POST: Lead-level, zero-touch, and weekly-calls drill-downs

**Forecast Routes**:
- `/api/forecast/pipeline` - Pipeline deals with summary and joined AUM by quarter
- `/api/forecast/rates` - Tiered conversion rates by AUM band and time window
- `/api/forecast/monte-carlo` - Monte Carlo simulation with optional rate overrides
- `/api/forecast/export` - Export forecast + audit data to Google Sheets
- `/api/forecast/exports` - List past forecast exports (from ForecastExport model)
- `/api/forecast/date-revisions` - Close date revision history and confidence scores
- `/api/forecast/scenarios` - Save/load/share scenario snapshots
- `/api/forecast/sqo-targets` - Quarterly SQO AUM targets (get/save)

**Admin Routes**:
- `/api/admin/refresh-cache` - Manual cache invalidation (revops_admin/admin/manager); invalidates `dashboard`, `sga-hub`, `sgm-hub`, `bot-usage` tags
- `/api/admin/sga-overview` - Admin SGA overview
- `/api/admin/bot-usage` - Savvy Analyst Bot audit log (revops_admin only); BigQuery-backed scorecards, time series, paginated Q&A, `?threadId=` for full chronology; cached 1h via `CACHE_TAGS.BOT_USAGE`

**Other Routes**:
- `/api/agent/query` - AI agent query (Explore feature)
- `/api/explore/feedback` - Explore feature feedback
- `/api/cron/refresh-cache` - Scheduled cache refresh (Vercel cron)
- `/api/auth/[...nextauth]` - NextAuth authentication
- `/api/users` - User management
- `/api/users/[id]` - Individual user operations
- `/api/users/[id]/reset-password` - Password reset

---

## 8. Advanced Features

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

**Accepted ID prefixes**:
- `00Q` (Lead) — looked up by `primary_key` in `vw_funnel_master`
- `006` (Opportunity) — looked up by `primary_key` in `vw_funnel_master`
- `003` (Contact) — used by advisor-grain Joined/Signed drill-down rows. Routes to `_getContactRecordDetail()` in `src/lib/queries/record-detail.ts` which joins `Contact + Account + primary signing/joining Opportunity + Lead attribution`. Lead attribution (Source, Channel, SGA, SGM, Lead Score Tier, Campaign) flows from two CTEs: `contact_lead` (Contact's own converted Lead) → `account_lead` (per-field MAX across all converted Leads on the Account), with `COALESCE(contact_lead, account_lead)` so team members without their own Lead inherit the team's attribution. MQL/SQL/Contacted dates are still NULL at Contact grain. The `/activity` sub-route also accepts `003` IDs and queries Tasks via `WhoId = contactId` plus `WhatId = opportunityId` (so multi-advisor team members see the team-level activity timeline). The drill-down queries `getJoinedAdvisorRecords` and `getSignedAdvisorRecords` in `detail-records.ts` apply the same Contact + Team attribution lookup so table rows match the modal.

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

**Notes Tab** (added 2026-05): Third tab alongside Details and Activity. Component: `src/components/dashboard/NotesTab.tsx` (accordion of NoteCard rows, most-recent open by default, per-note Copy + Download as `.md`, top-level "Download all"). Surfaces all sales-coaching `call_notes` (Granola + Kixie, treated identically) confidently linked to the record's underlying Lead. Renders **human notes only** — coaching analysis is intentionally excluded from this surface (use the Coaching Usage tab for the coaching view); backend still returns `coachingMarkdown` so future consumers can opt in. Endpoint: `GET /api/dashboard/record-detail/[id]/notes`. Resolution: a single BQ query maps the record id to its lead_id + contact_id + matching kixie Task.Ids (Task.WhoId pointing at lead/contact) + uniquely-resolving emails (the lead's or contact's email that no other Lead/Contact shares); a single Pg query then fetches matching `call_notes` ordered by `call_started_at DESC`. Each note carries `linkConfidence` ∈ `{pushed, direct, email}` so the UI can badge attribution strength. Markdown rendering shared via `src/lib/coaching-notes-markdown.ts` — Granola pulls coaching from `evaluations.ai_original`; Kixie splits `summary_markdown` on `═══ COACHING ANALYSIS START/END ═══` markers. **RBAC**: revops_admin/admin/manager see all notes; SGA only when their Neon `reps.full_name` matches `SGA_Owner_Name__c` OR `Opp_SGA_Name__c` for the record; SGM only when matching `SGM_Owner_Name__c`. Other roles (viewer/recruiter/capital_partner) get `authorized:false` + empty notes. Cross-checked at build time against live data: all 23 active SGA+SGM reps in Neon match exactly to BQ owner names. Tab is hidden on the client when `notes.length === 0` OR when the response carries `authorized:false` — RecordDetailModal eagerly fetches notes on open so the visibility decision can be made before the user clicks. 5-min response cache on the DASHBOARD tag.

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

## 9. SGA Hub & Management

### Overview

Single page for SGA performance tracking with role-based tabs:

| Page | ID | Purpose | Access |
|------|-----|---------|--------|
| **SGA Hub** | 8 | SGA performance, goals, leaderboard, and admin management | admin, manager, sga, sgm, revops_admin |

### SGA Hub Tabs

Seven tabs defined in `src/components/sga-hub/SGAHubTabs.tsx` as `SGAHubTab` type:
`leaderboard | weekly-goals | closed-lost | quarterly-progress | activity | outreach-effectiveness | management`

Tab orchestrator: `src/app/dashboard/sga-hub/SGAHubContent.tsx` — renders each tab's content component conditionally. Activity and Outreach Effectiveness embed standalone content components with `embedded` prop. The Management tab is only visible to `revops_admin` users (controlled via `showManagement` prop on `SGAHubTabs`).

#### 0. Leaderboard Tab

Default tab. Tracks SGA performance rankings across key metrics (MQLs, SQLs, SQOs, calls, leads sourced/contacted) for a selected time period.

**Files**:
- Component: `src/components/sga-hub/SGAHubLeaderboard.tsx`
- API: `GET /api/sga-hub/leaderboard`, `GET /api/sga-hub/leaderboard-sga-options`

#### 1. Weekly Goals vs. Actuals Tab

Tracks 7 weekly activity metrics against goals with scorecard + chart views:

| Metric | Date Field | Filter |
|--------|------------|--------|
| MQLs | `Date_Became_MQL__c` (TIMESTAMP) | Week range |
| SQLs | `Date_Became_SQL__c` (TIMESTAMP) | Week range |
| SQOs | `Date_Became_SQO__c` (TIMESTAMP) | Week range + `is_sqo_unique=1` + `recordtypeid` |
| Initial Calls | `Initial_Call_Scheduled_Date__c` (DATE) | Week range |
| Qualification Calls | `Qualification_Call_Date__c` (DATE) | Week range |
| Leads Sourced | `CreatedDate` (TIMESTAMP) | Week range + SGA ownership |
| Leads Contacted | `First_Activity_Date__c` (DATE) | Week range + SGA ownership |

**Call Timing in Funnel**:
- Initial Calls occur between MQL and SQL (SGA schedules and conducts)
- Qualification Calls occur after SQL conversion (SGA + SGM conduct together to determine SQO eligibility)

**Week Definition**: Monday-Sunday, calculated with `DATE_TRUNC(..., WEEK(MONDAY))`

**Layout**:
- **Scorecards**: Last Week + This Week side-by-side, Next Week centered below. Each scorecard shows Goal, Actual, and Difference with color-coded left border matching chart colors.
- **Charts**: Three Recharts line charts (Pipeline, Calls, Lead Activity) with week-based range selector (4/8/12 weeks + custom date range). Default data window is 12 weeks back.
- **Admin Rollup View**: Aggregates all SGA goals/actuals into a single rolled-up view. Dropdown to switch between "All SGAs (Rollup)" and individual SGAs. Rollup is read-only; individual SGA view allows goal editing.

**Goal Storage**: PostgreSQL via Prisma `WeeklyGoal` model:
```prisma
model WeeklyGoal {
  id                     String   @id @default(cuid())
  userEmail              String   // Links to User.email - matches SGA_Owner_Name__c via User.name
  weekStartDate          DateTime @db.Date // Monday of the week (DATE only)
  initialCallsGoal       Int      @default(0)
  qualificationCallsGoal Int      @default(0)
  sqoGoal                Int      @default(0)
  mqlGoal                Int      @default(0)
  sqlGoal                Int      @default(0)
  leadsSourcedGoal       Int      @default(0)
  leadsContactedGoal     Int      @default(0)
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
- **Rollup view**: Always read-only (goals are aggregated)

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

**Visibility**:
- **Admins / Managers / SGAs**: See all records across all SGAs (`showAll=true` passed to API; `sga` role is explicitly allowed by the route guard)
- **Other roles**: See only their own records (filtered by `sga_name` to the logged-in user's name)

**Salesforce Link**: The "Open Re-Engagement List in Salesforce" button links to the Re-Engagement Eligible report (`00OVS0000082GSH2A2`), which shows all re-engagement fields including Closed Lost Time Bucket and Original Closed Lost Reason.

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

**Visibility**:
- **Admins / Managers / SGAs**: See all re-engagement opportunities across all SGAs (`showAll=true`; `sga` role explicitly allowed by the route's `showAll` guard)
- **Other roles**: See only their own re-engagement opportunities

**Data Source**: Re-engagement opportunities from BigQuery
**API Route**: `/api/sga-hub/re-engagement`

### SGA Management Tab (RevOps Admin Only)

Embedded in the SGA Hub as the "SGA Management" tab, visible only to `revops_admin`. Component: `src/app/dashboard/sga-management/SGAManagementContent.tsx`.

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

Click any metric actual value to see underlying records:

| Metric | API Route | Records Shown |
|--------|-----------|---------------|
| MQLs | `/api/sga-hub/drill-down/mqls` | Leads that became MQL in period |
| SQLs | `/api/sga-hub/drill-down/sqls` | Leads that became SQL in period |
| SQOs | `/api/sga-hub/drill-down/sqos` | Opportunities that became SQO |
| Initial Calls | `/api/sga-hub/drill-down/initial-calls` | Leads with initial call in period |
| Qualification Calls | `/api/sga-hub/drill-down/qualification-calls` | Leads with qual call in period |
| Leads Sourced | `/api/sga-hub/drill-down/leads-sourced` | Leads created in period |
| Leads Contacted | `/api/sga-hub/drill-down/leads-contacted` | Leads with first activity in period |
| Open SQLs | `/api/sga-hub/drill-down/open-sqls` | Open SQL opportunities (quarterly) |

**Team-Level Drill-Down**: When clicking metrics in the admin rollup view, `teamLevel=true` is passed to skip the SGA filter and return all records across all SGAs. Only `admin`, `manager`, and `revops_admin` roles can use team-level queries.

**Nested Modal Flow**:
```
Metric Click → Drill-Down Modal → Row Click → Record Detail Modal
                                      ↑
                        "← Back" button returns here
```

**Drill-Down Modal Sizing**: All table-based drill-down modals use a consistent full-window layout: `width: calc(100vw - 48px)`, `max-height: 90vh`. This applies to `MetricDrillDownModal`, `VolumeDrillDownModal`, `ActivityDrillDownModal`, `AdvisorDrillDownModal`, `OutreachDrillDownModal`, and `ActivityBreakdownDrillDownModal`. The `RecordDetailModal` (detail view opened from a drill-down row) retains its own sizing.

**MetricDrillDownModal Component**: Shared component used across SGA Hub tabs (including Management tab). Supports CSV export for all metric types.

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
| `First_Activity_Date__c` | DATE | Direct: `>= @startDate` |
| `Date_Became_MQL__c` | TIMESTAMP | Wrapped: `>= TIMESTAMP(@startDate)` |
| `Date_Became_SQL__c` | TIMESTAMP | Wrapped: `>= TIMESTAMP(@startDate)` |
| `Date_Became_SQO__c` | TIMESTAMP | Wrapped: `>= TIMESTAMP(@startDate)` |
| `CreatedDate` | TIMESTAMP | Wrapped: `>= TIMESTAMP(@startDate)` |

**Week Join Pattern**: Cast TIMESTAMP to DATE when grouping:
```sql
DATE(DATE_TRUNC(Date_Became_SQO__c, WEEK(MONDAY))) as week_start
```

#### 5. Activity Tab

Embeds the standalone SGA Activity feature (`SGAActivityContent.tsx`) with `embedded` prop. Provides detailed call/SMS/email/LinkedIn activity analytics with period-over-period comparison, distribution charts, and drill-down into individual records. See Section 17 for full API and query details.

**Data Sources**: `Tableau_Views.vw_sga_activity_performance` (activity records) + `SavvyGTMData.User` (SGA list)

**Key view field**: `task_activity_date` uses `COALESCE(ActivityDate, DATE(CreatedDate, 'America/New_York'))` — aligns with SFDC's DUE_DATE field so dashboard counts match what SGAs see in Salesforce reports. Updated 2026-04-06; prior version used `DATE(CreatedDate)` which caused ~22% date mismatches for lemlist campaign tasks.

**SGA filter**: `INNER JOIN User WHERE IsSGA__c = TRUE AND IsActive = TRUE` plus name exclusion list. Do NOT use `SGA_IsActive` from the view (can be NULL for valid records due to the view's join path through `vw_funnel_master` -> `User`).

**Metric classification** — shared `METRIC_CASE_EXPRESSION` constant in `src/lib/queries/sga-activity.ts`, used identically by scorecards (`getActivityTotals`), scorecard drilldown (`getActivityRecords`), breakdown table (`getActivityBreakdownAggregation`), breakdown drilldown, and XLSX export. Classification uses `Initial_Call_Scheduled_Date__c` date matching (not the view's `call_type` field, which has a NULL-handling bug). 6 types:
- **Scheduled_Call**: `activity_channel_group = 'Call' AND direction = 'Outbound' AND task_created_date_est = DATE(Initial_Call_Scheduled_Date__c)` — call on the exact scheduled date
- **Cold_Call**: `activity_channel_group = 'Call' AND direction = 'Outbound' AND (no scheduled date OR date mismatch) AND subject NOT LIKE '%[lemlist]%'` — any other outbound call
- **Outbound_SMS**: `activity_channel_group = 'SMS' AND direction = 'Outbound'`
- **LinkedIn**: `activity_channel_group = 'LinkedIn'`
- **Manual_Email**: `activity_channel_group = 'Email' AND is_engagement_tracking = 0 AND is_marketing_activity = 0`
- **Email_Engagement**: `activity_channel_group = 'Email (Engagement)' OR (Email AND is_engagement_tracking = 1)`

Records not matching any type fall to `ELSE NULL` and are excluded. Inbound SMS is not in the shared CASE (excluded from breakdown) but counted separately in scorecards via `activity_channel_group = 'SMS' AND direction = 'Inbound'`.

**Lemlist task reminder exclusion**: Shared `LEMLIST_TASK_REMINDER_FILTER` constant excludes `[lemlist] Call -` and `[lemlist] Task -` patterns (campaign step reminders TO the SGA, not real outreach). Added to all 11 query WHERE clauses. The view also NULLs `activity_channel_group` for these patterns. In the record detail activity tab (`record-activity.ts`), these are classified as `'Reminder'` channel and shown with a yellow badge via `ActivityTimeline.tsx` — visible but excluded from counts and the All/Outbound/Inbound filter tabs, with a dedicated "Reminders" tab.

**Filtering consistency**: All activity queries use `ACTIVE_SGAS_CTE` (INNER JOIN on User table with `IsSGA__c = TRUE`, `IsActive = TRUE`, plus name exclusion list), `COALESCE(is_marketing_activity, 0) = 0`, and `LEMLIST_TASK_REMINDER_FILTER`. Do NOT use `SGA_IsActive` from the view or `activity_channel_group != 'Marketing'`.

**View SQL file**: `views/vw_sga_activity_performance_v2.sql` — local source for the BigQuery view `Tableau_Views.vw_sga_activity_performance` (no v2 suffix in BQ). Deploy via `CREATE OR REPLACE VIEW` in BigQuery.

**XLSX export**: Uses `exceljs` (added as dependency) to generate audit-trail workbooks with COUNTIFS formulae and named ranges (`Audit_SGA`, `Audit_Week`, `Audit_Metric`, `Audit_TaskID`) referencing a raw task records sheet. Generator script: `scripts/generate-activity-report.cjs`.

**Files**:
- Content: `src/app/dashboard/sga-activity/SGAActivityContent.tsx`
- Filters: `src/components/sga-activity/ActivityFilters.tsx` (immediate-apply pattern, no Apply button)
- Drilldown: `src/components/sga-activity/ActivityDrillDownModal.tsx`
- Types: `src/types/sga-activity.ts`
- Queries: `src/lib/queries/sga-activity.ts`
- API Routes: `src/app/api/sga-activity/{dashboard,activity-records,scheduled-calls,filters}/route.ts`
- Feature spec: `docs/individual_SGA_activity_breakdown.md` (planned Activity Breakdown tables with trailing average comparison + drilldowns)

#### 6. Outreach Effectiveness Tab

Lead-centric view of SGA outreach quality. Self-contained component (`OutreachEffectivenessContent`) with `embedded` prop, following the Activity tab pattern. Apply/Reset filter buttons (changes don't fire until applied).

**Data Sources**: `Tableau_Views.vw_funnel_master` (lead population) + `Tableau_Views.vw_sga_activity_performance` (activity counts) + `SavvyGTMData.User` (SGA list, start dates)

**Filters**: SGA dropdown (Active/All toggle, IsSGA__c allowlist), SGA Lead List dropdown (dependent on SGA, sourced from `vw_funnel_master.SGA_Self_List_name__c`), date range (QTD default), campaign multi-select combobox (substring search, `OutreachEffectivenessFilters.campaignIds: string[]`).

**Filter visibility by role** is split across two flags in `OutreachEffectivenessContent.tsx`:
- `showSGADropdown` — admin / manager / revops_admin / sgm only.
- `showSGAListDropdown` — same set **plus** `sga`. SGA-role users have the SGA picker hidden (server-side `permissions.sgaFilter` enforces self-only data) but still see the Lead List dropdown so they can narrow to one of their own self-lists. Their identity is passed in as `currentSgaName` and the dropdown resolves available lists via `sgaLists[draft.sga ?? currentSgaName]`.

The SGA Lead List dropdown is disabled until an effective SGA is known (either picked via the dropdown or, for SGA-role users, supplied via `currentSgaName`) and resets when the SGA changes — list names like "LPL List V2" are reused across SGAs, so an unscoped pick is ambiguous. The `/filters` endpoint returns `sgaLists: Record<sgaName, string[]>` keyed by SGA. Backend honors `filters.sgaList` only when both `filters.sga` and `filters.sgaList` are set, via `buildSgaListFilter` (see `src/lib/queries/outreach-effectiveness.ts`).

Campaign multi-select reserves two sentinel ids that live alongside real Salesforce campaign ids in the same dropdown:
- `no_campaign` → expands to `f.Campaign_Id__c IS NULL`
- `__self_sourced__` → synthetic "Self Sourced (LinkedIn + FinTrx)" chip, expands to `f.Original_source IN ('LinkedIn (Self Sourced)', 'Fintrx (Self-Sourced)')` (values verified against `vw_funnel_master` — note the inconsistent punctuation across the two strings)

Selections are OR'd: `[Self Sourced, Campaign A, no_campaign]` returns leads matching any of the three predicates. Empty array = no campaign filter. Campaign summary card only renders when exactly **one real campaign** is selected (synthetic sentinels and multi-campaign don't roll up cleanly — `MAX(Campaign_Name__c)` would collapse).

The combobox is a project-local vanilla primitive at `src/components/ui/MultiSelectCombobox.tsx` — no cmdk/headlessui dependency, matches the rest of the hand-rolled Tailwind components.

**Scorecards (4)**:

| Scorecard | Headline | Denominator |
|-----------|----------|-------------|
| Avg. Touchpoints in Contacting | Avg outbound touches on contacting unengaged leads | Contacting unengaged (terminal + open contacting) |
| Multi-Channel Coverage | % reached via 2+ channels (SMS, LinkedIn, Call, Email) | Same as above |
| Zero-Touch Gap | Leads with zero tracked outbound activity (Stale/All toggle) | All assigned leads |
| Avg Calls/Week | Tenure-bounded, zero-filled IC & QC per SGA per week | Active SGAs × eligible weeks |

**SGA Breakdown Table Columns**: SGA, Assigned, Worked, Bad Leads, MQL, SQL, SQO, Replied + metric-specific columns. All volume cells are clickable drill-downs. MQL/SQL/SQO count by event date (matching funnel performance page).

**Key Business Logic**:
- **Lead classification**: Converted (`is_sql=1`) > MQL (`is_mql=1`) > Replied (inbound SMS/Call OR 12 conversation-indicating dispositions) > Unengaged
- **Terminality**: Uses `TOF_Stage` (current stage), NOT `lead_closed_date` (persists from recycled lead prior lifecycles). Terminal = TOF_Stage in (Closed, MQL, SQL, SQO, Joined) OR 30+ days in contacting with no progression
- **Contacting unengaged denominator**: Terminal unengaged + open contacting leads (live view of outreach effort)
- **Bad leads** (`is_bad_lead`): Not a Fit, Bad Contact Info, Bad Lead Provided, Wrong Phone Number — excluded from all metric denominators
- **No Show/Ghosted**: NOT a reply — counts as Unengaged, measured in persistence metrics
- **Executor filter**: `task_executor_name = SGA_Owner_Name__c` on outbound touches/email presence (not inbound, not zero-touch)
- **Automated emails**: Count as touchpoints (candidate receives them)
- **Zero-touch exclusions**: Ghost contacts, bad leads, replied leads, "No Response" disposition (proves outreach happened)
- **Zero-touch Stale/All toggle**: "Stale" (default) only shows closed zero-touch leads OR leads untouched for 30+ days. "All" shows every zero-touch lead regardless of age. Toggle is on the scorecard and affects the SGA breakdown table.
- **1-day date buffer**: `DATE_SUB(filter_date, INTERVAL 1 DAY)` for activity date lower bound (self-sourced lead timing)
- **SGA allowlist**: `IsSGA__c = TRUE` + `IsActive = TRUE` subquery, with a small local `SGA_EXCLUSION_LIST` (operational/test accounts only: Savvy Marketing, Savvy Operations, plus a handful of inactive or non-outreach SGA users). Maintained at `src/lib/queries/outreach-effectiveness.ts:139` and scoped to this dashboard only — other SGA views apply their own filters.
- **Event-date MQL/SQL/SQO**: `endDateTs` = endDate + ' 23:59:59' for TIMESTAMP comparisons

**Files**:
- Types: `src/types/outreach-effectiveness.ts`
- Queries: `src/lib/queries/outreach-effectiveness.ts`
- API Routes: `src/app/api/outreach-effectiveness/{dashboard,filters,drill-down}/route.ts`
- Components: `src/components/outreach-effectiveness/` (5 files: Filters, MetricCards, SGABreakdownTable, OutreachDrillDownModal, CampaignSummary)
- Content: `src/app/dashboard/outreach-effectiveness/OutreachEffectivenessContent.tsx`
- Full reference: `agentic_implementation_guide.md` (updated with all formulas and filters)

### CSV Export

All tabs support CSV export via `src/lib/utils/sga-hub-csv-export.ts`:
- `exportWeeklyGoalsCSV()` — Weekly goals with actuals (all 7 metrics: MQL, SQL, SQO, IC, QC, Leads Sourced, Leads Contacted)
- `exportQuarterlyProgressCSV()` — Quarterly progress data
- `exportClosedLostCSV()` — Closed lost records
- `exportAdminOverviewCSV()` — Admin SGA overview (all 7 weekly goal/actual columns + quarterly progress)
- **MetricDrillDownModal** — Each drill-down modal has its own CSV export for the underlying records

### API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/sga-hub/weekly-goals` | GET/POST | Get/set weekly goals (7 metrics) |
| `/api/sga-hub/weekly-actuals` | GET | Get actuals from BigQuery (7 metrics + self-sourced variants) |
| `/api/sga-hub/quarterly-progress` | GET | Get quarterly SQO progress |
| `/api/sga-hub/quarterly-goals` | GET/POST | Get/set quarterly goals |
| `/api/sga-hub/admin-quarterly-progress` | GET | Admin view of all SGA quarterly progress |
| `/api/sga-hub/manager-quarterly-goal` | GET/POST | Manager quarterly goal management |
| `/api/sga-hub/closed-lost` | GET | Get closed lost records |
| `/api/sga-hub/sqo-details` | GET | Get SQO details for current quarter |
| `/api/sga-hub/re-engagement` | GET | Get re-engagement opportunities |
| `/api/sga-hub/leaderboard` | GET | SGA leaderboard data |
| `/api/sga-hub/leaderboard-sga-options` | GET | SGA options for leaderboard filters |
| `/api/sga-hub/drill-down/initial-calls` | POST | Drill-down: initial calls (supports teamLevel) |
| `/api/sga-hub/drill-down/qualification-calls` | POST | Drill-down: qualification calls (supports teamLevel) |
| `/api/sga-hub/drill-down/mqls` | POST | Drill-down: MQLs (supports teamLevel) |
| `/api/sga-hub/drill-down/sqls` | POST | Drill-down: SQLs (supports teamLevel) |
| `/api/sga-hub/drill-down/sqos` | POST | Drill-down: SQOs (supports teamLevel) |
| `/api/sga-hub/drill-down/leads-sourced` | POST | Drill-down: leads sourced (supports teamLevel) |
| `/api/sga-hub/drill-down/leads-contacted` | POST | Drill-down: leads contacted (supports teamLevel) |
| `/api/sga-hub/drill-down/open-sqls` | POST | Drill-down: open SQL opportunities |
| `/api/admin/sga-overview` | GET | Admin overview of all SGAs |
| `/api/outreach-effectiveness/dashboard` | POST | Outreach effectiveness metrics (5 metrics + SGA breakdown) |
| `/api/outreach-effectiveness/filters` | GET | SGA + campaign filter options |
| `/api/outreach-effectiveness/drill-down` | POST | Lead, zero-touch, and weekly-calls drill-downs |

---

## 10. Self-Serve Analytics (Explore)

### Overview

AI-powered natural language query interface for funnel analytics. Users ask questions in plain English; Claude interprets and generates SQL via a semantic layer.

**Entry Point**: `/dashboard/explore` (Page ID 10, robot icon in sidebar)

**Status**: ✅ **Live in Production**

**Access**: admin, manager, sgm, sga (not viewer)

**Tabs** (rendered when user has the right role):
- **Ask** — natural-language query interface (the original Explore feature; visible to everyone with Explore access)
- **Bot Usage** — Slack analyst-bot audit dashboard (revops_admin only); see `src/app/dashboard/explore/BotUsageClient.tsx`
- **Coaching Usage** — sales-coaching pipeline rollups + filterable drill-down (revops_admin only). Reads a SECOND Neon DB (the sales-coaching project) via raw `pg` (`src/lib/coachingDb.ts` — first non-Prisma DB helper in the repo); resolves advisor names + funnel status + SFDC IDs via BigQuery (`src/lib/queries/resolve-advisor-names.ts` joining `SavvyGTMData.Lead` + `Contact` + `Opportunity` + `Account` → `Tableau_Views.vw_funnel_master`; `AdvisorInfo` exposes `leadId` and primary `opportunityId`). Resolution cascade per row: (1) **`sfdc_what_id` → Opportunity direct** — for granola calls pushed with WhatId only (`sfdc_who_id` NULL, `sfdc_record_type='Opportunity'`), the resolver reads THIS opp's StageName + is_sql/is_sqo from vw_funnel_master directly (not the lead's primary-opp roll-up — a sibling Closed Lost opp on the same lead would otherwise poison the stage of an active Negotiating opp) and pulls Account.Name for the display name. `leadId` is intentionally null on what-arm hits because `Full_prospect_id__c` is 006-prefixed in this org and would 404 against `/Lead/<id>/view`; the deep-link uses `opportunityId` instead. (2) **Contact → Account → best-opp arm** — when `sfdc_who_id` is a Contact and the Contact's Account hosts a more-current opp than the Contact's converted-Lead primary opp (e.g., Closed Lost original Lead + later Re-Engagement opp + current open opp all stacked on the same Account), the resolver pivots through `Contact.AccountId`, picks open opps before closed and most-recent within each bucket, and uses THAT opp's StageName. Disambiguation guard: chosen opp's Name must contain the Contact's LastName, protecting against rare multi-advisor Accounts (partner firms). (3) `sfdc_who_id` → Lead/Contact direct (pre-existing path; fires when the Account-pivot arm finds nothing — typical of single-lifecycle Leads). (4) **Granola pre-push suggestion fallback** — for granola rows with no linkage of their own (both `sfdc_who_id` and `sfdc_what_id` NULL), the resolver consults `slack_review_messages.sfdc_suggestion` (canonical `surface='dm'` row, LEFT JOIN'd from the route's DETAIL_SQL): if `candidates[0].confidence_tier='likely'`, that candidate's `what_id` / `who_id` is fed into the lookup so the row shows the same stage the rep saw in the DM **before** they approve the push. A row that the rep manually re-linked to a different record is **not** overridden by a stale DM-time suggestion. A one-shot backfill at `scripts/backfill-coaching-what-id.cjs` mirrors the same "likely Opp" rule into `call_notes.sfdc_what_id` (idempotent, dry-run by default; pass `--commit` to apply) so the call_note row is self-describing for downstream consumers that don't go through the resolver. (5) **Kixie self-heal** — for `source='kixie'` rows, re-read `SavvyGTMData.Task.WhoId` keyed on `kixie_task_id` and resolve from there (recovers calls where SFDC associated `WhoId` after the call-transcriber baked NULL into Postgres, AND the same-day-Lead case where `sfdc_who_id` is set but the referenced Lead/Contact hasn't sync'd to BQ yet); (6) external invitee email → unique Lead/Contact match; (7) first email + tooltip extras; (8) Unknown. **All four lookup inputs (whoId, whatId, kixieTaskId, externalEmails) are collected unconditionally for every row** so any miss on the primary arm transparently falls through to the next — Fivetran lag on a fresh SFDC Lead/Contact won't strand a row that one of the fallbacks could have resolved. Advisor-facing rule (used by KPIs and drill-down): every Kixie call counts (outbound dialer, definitionally prospect-facing); Granola requires `call_notes.likely_call_type = 'advisor_call'` from the AI classifier (excludes `internal_collaboration`, `vendor_call`, `unknown`, and unclassified rows). Architecture: server returns the full annotated advisor-facing list per range (~213 rows all-time, well within budget), and the client computes every KPI and applies every filter (rep name, advisor name, SQL'd, SQO'd, Closed Lost, Pushed-to-SFDC, rep role, stage) locally — so KPIs are reactive to filter changes without per-keystroke round-trips and the response cache stratifies only by `range`. Per-call modal with Summary/Notes/Coaching/Transcript tabs at `/api/admin/coaching-usage/call/[id]` plus a footer with View Lead / View Opportunity SFDC deep-links (lightning.force.com URLs built from the resolver IDs; hidden for unlinked rows / lead-only advisors). Coaching content dispatches by source: Kixie splits `summary_markdown` on `═══ COACHING ANALYSIS START/END ═══` markers; Granola pulls `evaluations.ai_original` (handles v2/v3/v4 schema versions). See `src/app/dashboard/explore/CoachingUsageClient.tsx` + `CallDetailModal.tsx`.

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

**Attribution Mode — `ATTRIBUTION_MODEL` env var (Phase 3, 2026-04)**

The Funnel Performance & Efficiency page (and every query in `src/lib/queries/` that it drives — `funnel-metrics`, `conversion-rates`, `detail-records`, `source-performance`, `export-records`) routes SGA filtering through a single helper, `buildSgaFilterClause` in `src/lib/utils/filter-helpers.ts`. The helper reads `ATTRIBUTION_MODEL` via `src/lib/utils/attribution-mode.ts`:

| Mode | Env | SGA predicate | Notes |
|---|---|---|---|
| **v1** (default) | unset / `'v1'` | `v.SGA_Owner_Name__c IN UNNEST(@sgas)` | Current-owner filtering; subject to Savvy Ops sweep distortion when the filter excludes sweep rows |
| **v2** | `ATTRIBUTION_MODEL=v2` | `LEFT JOIN vw_lead_primary_sga p … WHERE p.primary_sga_name IN UNNEST(@sgas)` | Lead-era attribution from `vw_lead_primary_sga` (119,262 rows); sweep-proof |

When no SGA filter is active, the helper short-circuits (empty JOIN + empty WHERE), making v1 and v2 emit byte-identical SQL. Unfiltered invariance is structural.

**Scope limitation:** v2 uses the LEAD-era primary SGA. Opp-era metrics (SQO, Joined, AUM) filtered by SGA may understate for leads where the lead-era primary was orphan/none but the opp-era owner was a real SGA. Phase 4 (future) will add a dedicated opp-era view. Do NOT COALESCE-fallback on the filter predicate — that reintroduces Savvy-Ops-sweep noise.

**`ATTRIBUTION_DEBUG` env var** (server-side only; no `NEXT_PUBLIC_` twin). When `true`, the funnel-metrics API route — only for admins (`revops_admin`/`admin`) with an active SGA filter — computes Contacted→MQL under both v1 and v2 and attaches a `debug: { v1, v2 }` payload to `FunnelMetrics`. The `AttributionDebugPanel` component (mounted above `GlobalFilters`) renders the side-by-side only when the payload is present AND the session role is admin.

**Rule-3 UI collapse** (`src/components/dashboard/GlobalFilters.tsx`): when a user individually ticks every visible SGA (or SGM), `handleMultiSelectChange` collapses to `{selectAll: true, selected: []}`. This alone removes the Savvy-Ops-sweep distortion at the UI level, independent of the `ATTRIBUTION_MODEL` setting.

#### Dimensions

Grouping fields for breakdowns:

| Dimension | Field | Mapping | Notes |
|-----------|-------|---------|-------|
| `channel` | `Channel_Grouping_Name` | Inline from `Finance_View__c` | Coarsest grouping; sources nest within channels |
| `source` | `Original_source` | Direct (`Final_Source__c`) | Atomic lead source; multiple sources roll up to one channel |
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
| `custom_query` | Escape hatch for compound/novel questions | "SQOs from Paid Search that also had a qual call?" |

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
export const ON_HOLD_STAGE = 'On Hold';                        // Separate from OPEN_PIPELINE_STAGES
export const STALE_PIPELINE_THRESHOLDS = { warning: 30, stale: 60, critical: 90 }; // Days-in-stage thresholds

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

## 11. Deployment & Operations

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
| `ANTHROPIC_API_KEY` | Both | Claude API for Explore feature + opportunity chat |
| `VERTEX_AI_LOCATION` | Both | GCP region for Vertex AI text-embedding-004 (opportunity chat RAG). Defaults to `us-central1` |
| `SALES_COACHING_DATABASE_URL` | Both | Sales-coaching Neon DB pooled URL (Coaching Usage tab); falls back when `_UNPOOLED` is unset |
| `SALES_COACHING_DATABASE_URL_UNPOOLED` | Both | Sales-coaching Neon DB direct URL — preferred for raw `pg` (PgBouncer breaks prepared statements) |

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
- `instrumentation-client.ts` - Client-side error tracking (browser)
- `src/instrumentation.ts` - Server-side and edge runtime error tracking (API routes, server components, middleware)

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

## 12. GC Hub

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

## 13. Dashboard Requests

### Overview

Dashboard Requests is an internal ticketing system for submitting and tracking analytics feature requests. It integrates with **Wrike** for project management and sends **email notifications** on status changes.

| Feature | Detail |
|---------|--------|
| Statuses | SUBMITTED → PLANNED → IN_PROGRESS → DONE → ARCHIVED |
| Wrike sync | Background (non-blocking); syncs creates, status changes, and comments |
| Attachments | Images (PNG, JPEG, GIF, WebP), SQL, TXT, JSON; max 5 MB; stored as base64 in DB |
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

`POST /api/dashboard-requests/[id]/comments` adds a comment, syncs it to the linked Wrike task, sends `@mention` notifications to tagged users, and syncs the comment to BigQuery `bot_audit.issues` + `bot_audit.issue_events` for bot-created issues (id starts with `cbot_`).

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
| PATCH | `/api/dashboard-requests/[id]/status` | canManageRequests | Change status; email notification; Wrike sync; BigQuery issues + issue_events sync (bot issues) |
| GET | `/api/dashboard-requests/[id]/comments` | Non-recruiter | List comments |
| POST | `/api/dashboard-requests/[id]/comments` | Non-recruiter | Add comment; Wrike sync; @mention notifications; BigQuery issues + issue_events sync (bot issues) |
| GET | `/api/dashboard-requests/analytics` | canManageRequests | Counts by status/type/priority, avg resolution time, top submitters |
| POST | `/api/dashboard-requests/kanban` | Non-recruiter | Kanban view (4 columns; search/type/priority/submitter/date filters) |
| GET | `/api/dashboard-requests/recent` | Non-recruiter | Recent requests for duplicate detection (last 30 days, min 3 chars, max 10) |
| POST | `/api/dashboard-requests/[id]/archive` | canManageRequests | Archive request; records history; Wrike sync |
| POST | `/api/dashboard-requests/[id]/unarchive` | canManageRequests | Unarchive to DONE; records history; Wrike sync |
| GET | `/api/dashboard-requests/[id]/attachments` | Non-recruiter | List attachments (metadata only, no binary data) |
| POST | `/api/dashboard-requests/[id]/attachments` | Non-recruiter | Upload file (PNG/JPEG/GIF/WebP/SQL/TXT/JSON, max 5 MB, stored as base64) |

### Analyst Bot Integration

The Savvy Analyst Bot (`packages/analyst-bot/`) can create DashboardRequest entries directly (type `DATA_ERROR`, user-selected priority) when users report issues through the bot's issue flow. Bot-created requests have IDs prefixed with `cbot_`.

**BigQuery Issue Tracker Sync** (`src/lib/issue-tracker-sync.ts`): Status changes and comments on bot-created requests are synced to `bot_audit.issue_tracker` in BigQuery via streaming inserts (append-only — BigQuery's streaming buffer blocks DML for ~30 min, so each event is a new row, not an UPDATE). The sync is fire-and-forget (non-blocking) and only activates for requests with `cbot_` prefix. The `source` field distinguishes event types: `analyst-bot` (initial creation), `dashboard-status-change`, `dashboard-comment`. To get the latest status for an issue, query `WHERE dashboard_request_id = @id AND source = 'dashboard-status-change' ORDER BY updated_at DESC LIMIT 1`.

---

## 14. Recruiter Hub

### Overview

Recruiter Hub (Page 12) gives recruiters and managers a view of prospect and opportunity data. Users with the **recruiter role** have their data automatically scoped to their own records via the `recruiterFilter` permission — they cannot see other recruiters' data.

| Feature | Detail |
|---------|--------|
| Page | 12 (`page_12` permission required) |
| Auto-filter | `recruiterFilter` applied automatically for recruiter role |
| External agencies | Recruiter role → own agency only; others → full list |
| SGM filter | Available in opportunities view |

### File Structure

| File | Purpose |
|------|---------|
| `src/app/dashboard/recruiter-hub/page.tsx` | Server component — auth guard, permission check, renders `RecruiterHubContent` |
| `src/app/dashboard/recruiter-hub/RecruiterHubContent.tsx` | Main `'use client'` component — two data tables (prospects + opportunities), filter panels, search, pagination, CSV export |
| `src/app/dashboard/recruiter-hub/recruiter-hub-types.ts` | TypeScript interfaces (`ProspectRecord`, `OpportunityRecord`, filter types), stage constants, stage color maps |
| `src/app/dashboard/recruiter-hub/recruiter-hub-utils.ts` | Pure helpers — `getProspectStageLabel()`, `escapeCsvCell()` |
| `src/app/dashboard/recruiter-hub/SortableTh.tsx` | Reusable sortable table header component with ascending/descending indicators |

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

## 15. Advisor Map

### Overview

Advisor Map visualizes financial advisor locations on a Google Maps interface. Administrators can create overrides when Google Maps geocoding returns incorrect coordinates for an advisor's address.

| Feature | Detail |
|---------|--------|
| Geocoding | Google Maps API (`GOOGLE_MAPS_API_KEY` env var) |
| Override model | `AdvisorAddressOverride` Prisma model |
| Access | Blocks recruiter and capital_partner |
| Layout | Fills the viewport vertically — map grows to the bottom of the window via `flex flex-col h-[calc(100vh-4rem)]` on the page and `flex-1 min-h-0` on the map section |

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

## 16. Pipeline Catcher Game

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

## 17. SGA Activity

### Overview

SGA Activity provides detailed call and activity analytics for SGA performance management. It supports period-over-period (A/B) comparison and drill-down views into individual records. Embedded in the SGA Hub as the Activity tab (see Section 9, Tab 5).

| Feature | Detail |
|---------|--------|
| Access | admin, manager, sga, sgm, revops_admin |
| SGA auto-filter | SGA role automatically scoped to own name |
| Period comparison | Period A vs Period B supported on dashboard endpoint |
| Data source | BigQuery `vw_sga_activity_performance` (7 queries run in parallel) |
| View SQL | `views/vw_sga_activity_performance_v2.sql` (deploys as `vw_sga_activity_performance` in BQ) |
| Date field | `task_activity_date` = `COALESCE(ActivityDate, DATE(CreatedDate, 'America/New_York'))` |

### Dashboard Parallel Queries

`POST /api/sga-activity/dashboard` fetches 5 data sources simultaneously:

| Source | Description |
|--------|-------------|
| `initialCalls` | Initial call counts by date/SGA |
| `qualificationCalls` | Qualification call counts |
| `smsResponseRate` | SMS response rate metrics |
| `callAnswerRate` | Call answer rate metrics |
| `totals` | Aggregate totals (7 scorecards via `METRIC_CASE_EXPRESSION`) |

The Activity Breakdown table is fetched separately via `POST /api/sga-activity/breakdown` with its own `trailingWeeks` parameter (4/6/8/12).

### Drill-Down Views

Two endpoints provide paginated record-level detail:

- **`/api/sga-activity/activity-records`** — Individual activity records (page/pageSize, default 100). Accepts `channel`, `subType`, `dayOfWeek`, `activityType` + standard filters.
- **`/api/sga-activity/scheduled-calls`** — Scheduled call records. Accepts `callType`, `weekType`, `dayOfWeek`, `sgaName` + filters object.

### Filter Options

`GET /api/sga-activity/filters` returns available filter values. When the requesting user has the **sga role**, the `sgas` list in the response contains only their own name — preventing cross-SGA visibility.

### API Routes

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/sga-activity/dashboard` | admin/manager/sga/sgm/revops_admin | Dashboard metrics (5 parallel BigQuery queries) |
| GET | `/api/sga-activity/filters` | admin/manager/sga/sgm/revops_admin | Filter options (sga role sees only own name in sgas list) |
| POST | `/api/sga-activity/activity-records` | admin/manager/sga/sgm/revops_admin | Paginated scorecard drill-down (uses `METRIC_CASE_EXPRESSION`) |
| POST | `/api/sga-activity/scheduled-calls` | admin/manager/sga/sgm/revops_admin | Scheduled call drill-down |
| POST | `/api/sga-activity/breakdown` | admin/manager/sga/sgm/revops_admin | Activity Breakdown aggregation (trailing weeks) |
| POST | `/api/sga-activity/breakdown-drilldown` | admin/manager/sga/sgm/revops_admin | Breakdown cell drill-down (SGA + metric + week) |
| POST | `/api/sga-activity/export-breakdown` | admin/manager/sga/sgm/revops_admin | XLSX export (Activity by Metric + Summary + Audit Trail) |

---

## 18. Saved Reports

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

## 19. SGM Hub

### Overview

SGM (Sales Growth Manager) performance tracking hub. Three tabs: Leaderboard, Dashboard, and Quota Tracking.

| Tab | Purpose | Access |
|-----|---------|--------|
| **Leaderboard** | Ranked SGMs by Joined AUM for selected quarter | admin, manager, sgm, revops_admin |
| **Dashboard** | Funnel metrics, conversion trends, pipeline by stage, SGM conversion table | admin, manager, sgm, revops_admin |
| **Quota Tracking** | Quarterly ARR quota pacing, open pipeline, historical performance | admin, manager, sgm, revops_admin |

**Page ID**: 18
**Route**: `/dashboard/sgm-hub`
**Main Component**: `src/app/dashboard/sgm-hub/SGMHubContent.tsx`

### Quota Tracking Tab

Two role-conditional views:

#### SGM View (role=sgm)

SGMs see only their own data (enforced via `sgmFilter` from session permissions). Components:

| Section | Component | Data Source |
|---------|-----------|-------------|
| Quarter Selector | Inline dropdown | Local state |
| Quarterly Progress | Card with pacing badge, progress bar, stats grid | `GET /api/sgm-hub/quota-progress` |
| Historical ARR Chart | Recharts BarChart (clickable bars) + goal ReferenceLine | `GET /api/sgm-hub/historical-quarters` |
| Open Opportunities | Sortable table with aging color coding | `GET /api/sgm-hub/open-opps` |

**Pacing Logic** (`src/lib/utils/sgm-hub-helpers.ts`):
- Tolerance band: ±15% of expected pace (vs SGA's ±0.5 SQOs)
- `expectedArr = (arrGoal / daysInQuarter) * daysElapsed`
- Status: `ahead` (>15%), `on-track` (±15%), `behind` (<-15%), `no-goal`
- `projectedArr = (actualArr / daysElapsed) * daysInQuarter`

**ARR COALESCE**: `COALESCE(Actual_ARR__c, Account_Total_ARR__c)` per-record with `(est)` indicator when using fallback. `Actual_ARR__c` is 0% populated for recent quarters — auto-transitions when field populates.

**Open Opps Aging** (color thresholds): green (0-29d), yellow (30-59d), orange (60-89d), red (90+d)

**Days in Stage**: Uses stage-specific timestamp fields. `mql_stage_entered_ts` for Qualifying (90.5% populated — shows "—" when null).

#### Admin View (role=admin, revops_admin)

| Section | Component | Data Source |
|---------|-----------|-------------|
| Filters | Quarter, SGM, Channel, Source, Pacing Status multi-selects | Local state + filter options |
| Team Progress | Card with total Joined ARR vs total quota | `GET /api/sgm-hub/team-progress` |
| SGM Breakdown | Sortable table: Open Opps (clickable), 90+ Days (clickable), Open AUM, Open ARR, Joined ARR, Progress % | `POST /api/sgm-hub/admin-breakdown` |
| Quota Management | Editable grid: 12 SGMs × 4 quarters, inline edit on click | `GET/PUT /api/sgm-hub/quota` |

### Quota Data Model

```prisma
model SGMQuarterlyGoal {
  id        String   @id @default(dbgenerated("gen_random_uuid()"))
  userEmail String
  quarter   String   // "YYYY-QN" format
  arrGoal   Float    @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime // NOT @updatedAt — set explicitly
  createdBy String?
  updatedBy String?
  @@unique([userEmail, quarter])
}
```

Seeded with 48 records (12 SGMs × 4 quarters for 2026) via `scripts/seed-sgm-quotas.ts`.

### API Routes

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/sgm-hub/quota` | admin, manager, sgm, revops_admin | List quotas, optional `?year=` filter |
| PUT | `/api/sgm-hub/quota` | admin, revops_admin | Upsert a single quota (userEmail + quarter + arrGoal) |
| GET | `/api/sgm-hub/quota-progress` | admin, manager, sgm, revops_admin | Pacing data for one SGM + quarter |
| GET | `/api/sgm-hub/open-opps` | admin, manager, sgm, revops_admin | Open opportunities for one SGM |
| GET | `/api/sgm-hub/historical-quarters` | admin, manager, sgm, revops_admin | Historical ARR by quarter (default 8) |
| POST | `/api/sgm-hub/admin-breakdown` | admin, revops_admin | Per-SGM breakdown with filters |
| GET | `/api/sgm-hub/team-progress` | admin, revops_admin | Team total ARR vs total quota |

### Key Files

| File | Purpose |
|------|---------|
| `src/lib/queries/sgm-quota.ts` | BigQuery + Prisma query functions (5 exports) |
| `src/lib/utils/sgm-hub-helpers.ts` | `calculateSGMQuarterPacing`, `getDaysAgingStatus`, `formatArrCompact` |
| `src/hooks/useQuotaTracking.ts` | Extracted quota state + fetch logic hook |
| `src/components/sgm-hub/SGMQuotaTrackingView.tsx` | SGM user view (progress + chart + open opps) |
| `src/components/sgm-hub/SGMAdminQuotaView.tsx` | Admin view (team progress + breakdown + quota table) |
| `src/components/sgm-hub/SGMOpenOppsTable.tsx` | Sortable open opps table with aging colors |
| `src/components/sgm-hub/SGMQuotaFilters.tsx` | Admin filter panel |
| `src/components/sgm-hub/SGMQuotaTable.tsx` | Editable quarterly quota grid |
| `src/types/sgm-hub.ts` | All SGM Hub types (leaderboard, dashboard, quota tracking) |

---

## 20. Pipeline Forecast

### Overview

The Pipeline Forecast page (`/dashboard/forecast`) provides probability-weighted AUM forecasting with Monte Carlo simulation, a two-component realization forecast model, and what-if scenario planning. It combines live pipeline data with historical conversion rates to project quarterly AUM outcomes.

**Page**: `src/app/dashboard/forecast/page.tsx`
**Permission**: Page ID 19 — `revops_admin` only (checked via `canAccessPage`)

### Data Flow

```
Page Load -> Parallel fetch:
  1. GET /api/forecast/rates?windowDays=N     -> Tiered conversion rates (flat + AUM bands)
  2. GET /api/forecast/pipeline               -> Pipeline records + summary + joined AUM + surprise baseline
  3. GET /api/forecast/date-revisions         -> Close date revision history
  4. GET /api/forecast/sqo-targets            -> Quarterly AUM targets

Client-side recompute (useMemo):
  Pipeline records x Rates -> adjustedPipeline (duration penalties, tier-adjusted P(Join))
  adjustedPipeline -> adjustedSummary (dynamic quarter rollups)
  Pipeline -> realizationByQuarter (Component A x band rate + surprise baseline)

Auto-run after load:
  POST /api/forecast/monte-carlo             -> Quarterly probability distributions
```

### Pipeline Route

`GET /api/forecast/pipeline` returns four fields:
- **records**: Open pipeline deals with stage, AUM, days in stage, projected dates
- **summary**: Aggregate counts (total opps, zero-AUM count, anticipated date count, quarters)
- **joinedByQuarter**: Actual joined AUM and count by quarter (from `getJoinedAumByQuarter`)
- **surpriseBaseline**: Live-computed trailing 4Q surprise AUM average (from `getSurpriseBaseline` — uses OpportunityFieldHistory PIT reconstruction, 24h cache)

The `joinedByQuarter` data enables gap analysis. The `surpriseBaseline` replaces the hardcoded $398M constant — it's computed from BQ using the same OpportunityFieldHistory methodology as the backtest.

### Client-Side Adjustments

The page recomputes deal-level forecasts client-side using `computeAdjustedDeal()` from `src/lib/forecast-penalties.ts`:

- **Duration penalties**: Deals lingering in a stage get a multiplier reduction on P(Join)
- **AUM-tiered rates**: Conversion rates vary by AUM band (lower/flat/upper)
- **Projected dates**: Model-based or anticipated start date, with confidence from revision history
- **Quarter rollups**: Dynamic quarter assignment based on projected join date

### Page Components

| Component | Purpose |
|-----------|---------|
| `ForecastTabs` | Tab switcher between Pipeline Forecast and Exports views |
| `ForecastTopBar` | Window selector (180/365/730 days), Monte Carlo trigger, Sheets export |
| `RatesSummaryBar` | Compact 8-card strip showing per-stage conversion rates, avg days, end-to-end rate, velocity, avg joined AUM, and AUM/SQO for the active window |
| `RealizationBanner` | Two-component realization forecast banner (pipeline expected AUM + surprise baseline) |
| `WhatIfPanel` | Interactive what-if controls for targets and pipeline adjustments |
| `ForecastMetricCards` | Quarter cards with expected AUM, targets, gap analysis, joined actuals |
| `ExpectedAumChart` | Visual AUM distribution by quarter (dynamically loaded) |
| `ConversionRatesPanel` | Flat conversion rates for the selected window |
| `MonteCarloPanel` | Simulation results with per-deal stats (dynamically loaded) |
| `ScenarioRunner` | Rate override sliders for what-if scenarios (requires `canRunScenarios`) |
| `SavedScenariosList` | Load/share saved scenario snapshots |
| `PipelineDetailTable` | Full deal list with adjusted P(Join), AUM tier, duration bucket |
| `AdvisorForecastModal` | Per-opportunity detail modal on row click |
| `ExportsPanel` | Browse past Google Sheets exports with links and metadata |

### API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/forecast/pipeline` | GET | Pipeline records, summary, joined AUM by quarter, surprise baseline |
| `/api/forecast/rates` | GET | Tiered conversion rates by time window |
| `/api/forecast/monte-carlo` | POST | Run Monte Carlo simulation |
| `/api/forecast/export` | POST | Export to Google Sheets (7 styled tabs with full formula traceability) |
| `/api/forecast/export` | DELETE | Delete an export (removes Google Drive file + DB record) |
| `/api/forecast/exports` | GET | List past forecast exports |
| `/api/forecast/date-revisions` | GET | Close date revision counts and confidence |
| `/api/forecast/scenarios` | GET/POST | Save, list, and share scenarios |
| `/api/forecast/sqo-targets` | GET/POST | Quarterly SQO AUM target management |

### Key Files

| File | Purpose |
|------|---------|
| `src/app/dashboard/forecast/page.tsx` | Main forecast page with state management and data orchestration |
| `src/app/api/forecast/pipeline/route.ts` | Pipeline API route (SGM/SGA filtered, includes surprise baseline) |
| `src/lib/queries/forecast-pipeline.ts` | `getForecastPipeline`, `getJoinedAumByQuarter`, `getSurpriseBaseline` |
| `src/lib/queries/forecast-rates.ts` | Tiered conversion rate queries |
| `src/lib/queries/forecast-monte-carlo.ts` | Monte Carlo simulation logic |
| `src/lib/forecast-penalties.ts` | `computeAdjustedDeal` -- duration penalties and AUM-tier adjustments |
| `src/app/api/forecast/export/route.ts` | Sheets export POST (7 tabs, styling, named ranges) + DELETE handler |
| `src/app/api/forecast/exports/route.ts` | Exports list API route (reads ForecastExport model) |
| `src/app/dashboard/forecast/components/` | All forecast UI components (see component table above) |

### Google Sheets Export

The export creates a professionally styled 7-tab workbook. Every value traces to source data via formulas.

**Tabs** (in display order):
1. **BQ Scenario Runner** — editable what-if analysis with VLOOKUP cross-tab traceability
2. **BQ Rates and Days** — conversion rates + velocity from Audit Trail formulas + 19 named ranges
3. **BQ Realization Forecast** — two-component model with OFH PIT-reconstructed Component A detail
4. **BQ Forecast P2** — full pipeline with per-deal probability and tier-adjusted rates
5. **BQ Monte Carlo** — simulation results (P10/P50/P90/Mean) per quarter + per-deal detail
6. **BQ SQO Targets** — gap analysis with joined AUM, projected pipeline, entry quarter formulas
7. **BQ Audit Trail** — raw resolved SQO data (source for all rate formulas)

**Styling**: Dark navy section headers, light gray column headers, alternating row banding on large tables (P2, Audit Trail), conditional formatting (Duration Bucket, Date Confidence, Status), tab colors (blue=leadership, gray=analytical), frozen rows/columns, auto-resized columns.

**Infrastructure**: Per-user Google Drive subfolders, export delete (DB + Drive), Sheet1 auto-deletion, dependency-ordered tab writes then API reorder for display.

**Data sources**: 8 parallel BQ queries including historical joined deals (Q1-Q4 2025) and Component A PIT reconstruction via `OpportunityFieldHistory`.

---

## 22. Call Intelligence

### Overview

The Call Intelligence page (`/dashboard/call-intelligence`, page ID 20) hosts AI evaluations of advisor calls produced by the sales-coaching service. It is a single Next.js route with a 5-tab strip plus two record-level sub-routes for evaluation drill-down and rubric editing. All future call-coaching UI surfaces ship as additional tabs or `[id]` sub-routes inside this page rather than new top-level routes.

**Pages**:
- `src/app/dashboard/call-intelligence/page.tsx` — server gate + tab strip. Also resolves the optional `?focus_rep=<uuid>` query param via the Insights authority union and falls through to `notFound()` if out of scope (no leak).
- `src/app/dashboard/call-intelligence/evaluations/[id]/page.tsx` — eval drill-down sub-route
- `src/app/dashboard/call-intelligence/rubrics/[id]/page.tsx` — rubric editor sub-route (manager + admin only). `[id]` is a UUID for edit/view, or the literal `'new'` for create-new-version.
- `src/app/dashboard/call-intelligence/review/[callNoteId]/page.tsx` — rep note-review sub-route (any active page-20 user). Reachable from the Slack DM `[Review in App →]` deep-link and from the "My pending note reviews" widget on the Queue tab. Mobile-responsive (≤375px). Editor + SFDC linkage panel + sticky Approve/Reject action bar. On bridge-fetch failure (note already approved/rejected/deleted/forbidden), redirects to `/dashboard/call-intelligence?tab=queue&note=unavailable`.
- `src/app/dashboard/call-intelligence/opportunity/[opportunityId]/page.tsx` — Opportunity detail sub-route. `[opportunityId]` is a SFDC Id (006-prefix). Server gate validates format + page 20 + role allowlist. Client component fetches header (BQ) + threaded call timeline (Neon) via `/api/call-intelligence/opportunities/[opportunityId]`. Threads calls across Opp + Contact + Lead identities, including pre-conversion Lead-era calls and likely-but-unlinked candidates.
- Insights heat-map drill-down is now an in-tab three-layer modal stack inside `InsightsTab.tsx` (the page route under `insights/evals/` was retired 2026-05-11; a `permanent: true` redirect in `next.config.js` strips legacy `?…` query params and lands the user on `?tab=insights`). The API at `/api/call-intelligence/insights/evals` still backs Layer 1's eval list — only the page-route was deleted.

**Permission**: Page ID 20 — `revops_admin`, `admin`, `manager`, `sgm`, `sga`. Recruiter and capital_partner roles have explicit redirects.

### Tabs

| Tab id | Label | Visible to | Default? |
|---|---|---|---|
| `queue` | Reviews / My Reviews | revops_admin, admin, manager, sgm, sga | yes |
| `opportunities` | Opportunities | revops_admin, admin, manager, sgm, sga | — |
| `insights` | Insights | revops_admin, admin, manager (same allowlist as Rubrics — `canEditRubrics()` covers it) | — |
| `rubrics` | Rubrics | revops_admin, admin, manager (centralized via `canEditRubrics()` in `src/lib/permissions.ts`) | — |
| `coaching-usage` | Usage | revops_admin, admin, manager, sgm (widened for Needs Linking sub-tab) | — |
| `settings` | My settings | revops_admin, admin, manager, sgm, sga | — |
| `admin-users` | Admin: Users | revops_admin, admin only | — |
| `admin-refinements` | Admin: Content Refinements | revops_admin, admin only | — |
| `cost-analysis` | Cost Analysis | revops_admin, admin only | — |

The Reviews heading is "My Reviews" for SGM/SGA (coachee view, scoped by own `rep_id`) and "Reviews" for manager (scoped by `assigned_manager_id_snapshot`) and admin (unscoped). A History toggle (Pending / Revealed / All) controls the row filter.

**Advisor-call filter** (added 2026-05-10, refined same-day): `getEvaluationsForManager` filters to `(cn.source = 'kixie' OR cn.likely_call_type = 'advisor_call')` — the advisor-facing rule from §Coaching Usage. Every Kixie call counts (outbound dialer = prospect-facing by definition; Kixie is never AI-classified, so `likely_call_type IS NULL` for all Kixie rows). Granola calls require the manager-monitor classifier to have tagged them `advisor_call`; `internal_collaboration` (all-hands, training, comp-plan walkthroughs), `vendor_call`, `unknown`, and unclassified (NULL) Granola rows are excluded from the queue regardless of role. Direct-link to a specific eval still works — the filter only hides rows from the listing query, not `getEvaluationDetail`. If a real Granola recruiting call is mis-classified as `internal_collaboration` it won't surface; the classifier is the upstream truth source.

**Client-side sort + filters on the queue** (added 2026-05-10, Phase A): every column header in `QueueTab` cycles asc/desc on click. Fuzzy multi-token name search on Rep + Advisor, mirroring CoachingUsage's helper. Rep role filter (any/SGA/SGM) renders for admin/manager only (SGM/SGA already see only their own evals). All operate over the already-fetched rows — no extra round-trips. `rep_role` was added to `EvaluationQueueRow` (sourced from `sga.role` in the existing SELECT — no new join). Funnel filters (SQL'd / SQO'd / Stages / Closed Lost / Pushed-to-SFDC) are Phase B and require backend BQ + SFDC enrichment per row.

**Needs Linking sub-tab** (added 2026-05-12): The Coaching Usage tab now contains two sub-tabs managed by `CoachingUsageWrapper.tsx` — "Overview" (the original `CoachingUsageClient`, revops_admin only) and "Needs Linking" (all coaching-usage roles). Needs Linking surfaces `call_notes` that haven't been attached to a Salesforce record. API at `/api/call-intelligence/needs-linking` (GET, `force-dynamic`, no caching). RBAC via `getRepIdsVisibleToActor()` + actor self-union. Query: `src/lib/queries/call-intelligence/needs-linking.ts`. Component: `NeedsLinkingTab.tsx`. Default filter: last 14 days. Each row links to the existing NoteReviewClient for SFDC search.

**Opportunities tab** (added 2026-05-14): Top-level tab showing Opportunities with threaded call activity across the full Lead→Contact→Opportunity lifecycle. Two-source data model: BQ resolves all Opportunities with identity tuples (`Opportunity LEFT JOIN Lead`), Neon counts threaded calls per Opp using UNNEST'd identity arrays, app layer merges. Detail page at `/dashboard/call-intelligence/opportunity/[opportunityId]` shows header (BQ), latest call recap, rep's next step (SFDC NextStep), and chronological threaded timeline with linkage badges (Linked to Opp/Contact/Lead/Likely match) and stage-at-time-of-call badges (from OpportunityFieldHistory). CallDetailModal enhanced with optional `initialReviewData` prop for pre-loading sfdc_suggestion on likely-but-unlinked rows. Coaching Usage Stage cell made clickable to navigate to the detail page. The detail page includes a streaming chat panel (`OpportunityChatPanel.tsx`) where users can converse with Claude about the opportunity's calls, deal context, and the company knowledge base. Claude responses are grounded in call summaries + RAG-retrieved KB chunks (pgvector cosine search via Vertex AI `text-embedding-004` embeddings). Per-user multi-thread support with AI-generated titles. Chat data persisted in `opportunity_chat_threads` / `opportunity_chat_messages` (sales-coaching Neon, Dashboard-owned, direct pg). Query files: `src/lib/queries/opportunity-header.ts` (BQ), `src/lib/queries/call-intelligence/opportunity-timeline.ts` (Neon), `src/lib/queries/call-intelligence/opportunity-list-counts.ts` (Neon), `src/lib/queries/call-intelligence/opportunity-chat.ts` (Neon — embedding, thread CRUD, message CRUD, KB search).

**CallDetailModal review tab gate** (fixed 2026-05-13): The "Needs Linking" / "Not in SFDC" tab inside `CallDetailModal` is shown for any record where `pushedToSfdc` is false — no `callNoteStatus` restriction. `callNoteStatus` was removed from `CallDetailRowSummary` (the modal's row prop interface) since it is no longer consumed by the modal; the coaching-usage API route (`/api/admin/coaching-usage`) still returns `callNoteStatus` (from `cn.status`) for CoachingUsageTab's own row type. Previously gated on `callNoteStatus === 'pending'`, which hid the tab from 282 `rejected`-status unlinked Granola records that most need manual linking. `NoteReviewClient` gained an optional `backLabel` prop so the modal can display "Back to call detail" instead of the default "Back to Needs Linking".

### Data Flow

```
Reads (direct, via raw pg coachingDb):
  Dashboard -> SALES_COACHING_DATABASE_URL_UNPOOLED
            -> evaluations / call_notes / reps / call_transcripts / content_refinement_requests

Writes (via signed HMAC bridge to sales-coaching Cloud Run):
  Dashboard route -> src/lib/sales-coaching-client (HMAC v1 token, X-Request-ID header)
                 -> SALES_COACHING_API_URL/api/dashboard/*
                 -> sales-coaching Postgres
```

The bridge token format: `v1.<base64url(payload)>.<base64url(signature)>`, payload `{email, iat, exp}`, signed HMAC-SHA256 with `DASHBOARD_BRIDGE_SECRET`. TTL ≤ 60 s; default 30 s. `request_id` flows via `X-Request-ID` HTTP header (not in the token), so Sentry events from both repos can be stitched on the same trace ID.

### API Routes

| Route | Method | Path source | Purpose |
|---|---|---|---|
| `/api/call-intelligence/queue` | GET | direct (cached) | Evaluations list, scoped by role + history filter |
| `/api/call-intelligence/evaluations/[id]` | GET | direct | Eval detail + transcript_comments + chunk_lookup + coaching_nudge_effective merge |
| `/api/call-intelligence/evaluations/[id]/edit` | PATCH | bridge | Manager inline edit; OCC via `expected_edit_version`; 409 disambiguates stale-version vs authority-lost |
| `/api/call-intelligence/evaluations/[id]/transcript-comments` | GET / POST | direct GET, bridge POST | List (manager+admin only) / create utterance-level comment |
| `/api/call-intelligence/evaluations/[id]/reveal-scheduling` | PATCH | bridge | Hold / custom-delay / use-default override |
| `/api/call-intelligence/evaluations/[id]/reveal` | POST | bridge | Manual reveal-now |
| `/api/call-intelligence/transcript-comments/[id]` | DELETE | bridge | Author or admin can delete; 403 `role_forbidden` otherwise |
| `/api/call-intelligence/content-refinements` | POST | bridge | Submit refinement suggestion; 409 `content_refinement_duplicate` on partial-UNIQUE clash |
| `/api/call-intelligence/my-content-refinements` | GET | bridge | Per-user refinement list (open/addressed/declined) |
| `/api/call-intelligence/users` | GET / POST | direct GET, bridge POST | Users list / create (admin only) |
| `/api/call-intelligence/users/[id]` | PATCH | bridge | Update user (admin only) |
| `/api/call-intelligence/users/[id]/deactivate` | POST | bridge | Deactivate user; surfaces 409 typed errors |
| `/api/call-intelligence/users/[id]/bulk-reassign-pending-evals` | POST | bridge | Reassign pending evals from blocked deactivate |
| `/api/call-intelligence/users/[id]/granola-key` | POST / DELETE | bridge | Save or clear the rep's encrypted Granola API key. Save validates against Granola's `/v1/notes` BEFORE storing; surfaces `granola_key_rejected` / `granola_key_malformed` via `BridgeValidationError.issues` so the UI can distinguish rejection from other 400s. |
| `/api/call-intelligence/users/[id]/granola-key/verify` | POST | bridge | Re-validate the currently-stored key without bumping `granola_key_version`. Returns `status: 'valid' \| 'invalid' \| 'unknown' \| 'no_key'`. |
| `/api/call-intelligence/managers` | GET | bridge | List `role='manager'` reps for the canonical-manager dropdown. Excludes admins by design — pod-director admins surface via `coaching-teams` instead. |
| `/api/call-intelligence/coaching-teams` | GET / POST | bridge | List active pods (with embedded members + lead) / create new pod. POST body validated against `CreateCoachingTeamRequest` (name unique case-insensitive among active teams; optional `lead_rep_id` must be role IN ('manager','admin')). |
| `/api/call-intelligence/coaching-teams/[teamId]/members` | POST | bridge | Add a rep to a pod. Idempotent — re-adding silently no-ops, returns 200 with unchanged team payload. |
| `/api/call-intelligence/coaching-teams/[teamId]/members/[repId]` | DELETE | bridge | Remove rep from pod. Idempotent — returns `removed: false` if rep wasn't a member. |
| `/api/call-intelligence/refinements` | GET | direct | List open content_refinement_requests (admin only) |
| `/api/call-intelligence/refinements/[id]/resolve` | POST | bridge | Mark addressed/declined |
| `/api/call-intelligence/settings` | GET / PATCH | direct GET, bridge PATCH | Current user reveal policy |
| `/api/call-intelligence/rubrics` | GET / POST | direct GET (joins reps for `created_by_name`), bridge POST | Listing for the Rubrics tab / create new draft rubric |
| `/api/call-intelligence/rubrics/[id]` | GET / PATCH | bridge | Single rubric / update draft (OCC via `expected_edit_version`; 409 `rubric_conflict` discriminator: `version_mismatch`/`not_in_draft`/`concurrent_activation`) |
| `/api/call-intelligence/rubrics/[id]/activate` | PATCH | bridge | Activate draft (atomic archive-old + flip-new); 409 on concurrent activation |
| `/api/call-intelligence/note-reviews` | GET | bridge | List `pending` note-reviews for the current rep (manager+admin see all) |
| `/api/call-intelligence/note-reviews/[callNoteId]` | GET / PATCH | bridge | Detail / edit `summary_markdown_edited`. PATCH carries `expected_edit_version` (OCC); 409 `call_note_conflict` triggers reload + banner |
| `/api/call-intelligence/note-reviews/[callNoteId]/sfdc-search` | POST | bridge | Search SFDC by CRD / Email / Name / Manual ID (read-only, no revalidate) |
| `/api/call-intelligence/note-reviews/[callNoteId]/sfdc-link` | PATCH | bridge | Set linkage to a chosen SFDC record (always sends `linkage_strategy='manual_entry'`) |
| `/api/call-intelligence/note-reviews/[callNoteId]/submit` | POST | bridge | Approve & queue for SFDC push; redirects to `?tab=queue` on success |
| `/api/call-intelligence/note-reviews/[callNoteId]/reject` | POST | bridge | Reject with reason; redirects to `?tab=queue` on success |
| `/api/call-intelligence/insights/heatmap` | GET | direct (coachingDb) | Team-mode dimension heat map grouped by (role, rubric_version, pod, dimension). When `focus_rep` is set, scopes to that single rep and adds 90d sparkline series. |
| `/api/call-intelligence/insights/clusters` | GET | direct (coachingDb) | Knowledge-gap clusters: UNION of `evaluations.knowledge_gaps` JSONB + `rep_deferrals`. **Buckets by structured upstream-AI fields** (replaces the prior `KB_VOCAB_SYNONYMS` substring matcher, which dropped 66% of gaps and 84% of deferrals): gaps group by the first two path segments of `knowledge_gaps[].expected_source`; deferrals group by the first `topics[]` value from `knowledge_base_chunks` resolved through `kb_chunk_ids` (deterministic via `ORDER BY chunk_index, id LIMIT 1` with `is_active = true`). Items without a structured field land in an `Uncategorized` bucket (gaps) or `Uncategorized: <topic>` (deferrals). Each row carries `sampleEvidence[]` for the cluster-evidence modal — capped at 5 in `mode=team`, 200 in `mode=rep_focus` (auto-set when `focus_rep` is present or `?limit=full`). Source filter pill: `all` / `gaps_only` / `deferrals_only` / `deferrals_kb_missing` / `deferrals_kb_covered`. |
| `/api/call-intelligence/insights/pods` | GET | direct (coachingDb) | Active `coaching_teams` pods whose members intersect the actor's visible rep set. |
| `/api/call-intelligence/insights/evals` | GET | direct (coachingDb) | Filtered eval list for heat-map cell drill-down. Filters: role, rubric_version, pod, dimension, range, focused rep. Limit 500. |
| `/api/call-intelligence/opportunities` | GET | BQ + direct (coachingDb) | Opportunities tab list. BQ resolves all recruiting Opps with Lead/Contact identity tuples; Neon counts threaded calls per Opp via UNNEST. Filters: stage[], owner[], hasLikelyUnlinked. RBAC via `getRepIdsVisibleToActor()`. |
| `/api/call-intelligence/opportunities/[opportunityId]` | GET | BQ + direct (coachingDb) | Opportunity detail: header (BQ), threaded call timeline (Neon), stage-at-time-of-call badges (BQ OFH). SFDC Id validation (006-prefix). RBAC: 403 if no visible calls for non-privileged users. |
| `/api/call-intelligence/opportunities/[opportunityId]/ai-summary` | GET, POST | BQ + direct (coachingDb) + Claude API | AI-generated deal summary with 5 categories: pain points, competitors, next steps, compensation, advisor concerns. GET auto-generates on cache miss (24h TTL + hash). POST forces regeneration. Cached in `opportunity_ai_summaries` table (sales-coaching Neon). Uses Claude Sonnet for synthesis. |
| `/api/call-intelligence/opportunities/[opportunityId]/chat` | GET, POST | direct (coachingDb) + Claude API + Vertex AI | Streaming chat with Claude about opportunity calls. GET loads/creates thread + messages, detects new calls via hash comparison. POST streams SSE response grounded in call summaries and RAG-retrieved KB chunks (pgvector cosine search, Vertex AI text-embedding-004). Per-user threads in `opportunity_chat_threads`/`opportunity_chat_messages` (sales-coaching Neon). |
| `/api/call-intelligence/cost-analysis` | GET | bridge | AI spend rollup for the Cost Analysis tab (admin-only). Query params `start_date` + `end_date` (YYYY-MM-DD, end inclusive). Returns total spend, distinct-advisor-call denominator, $/advisor-call, avg $/day, avg $/month (avg_daily × 31), by-day series, by-feature + by-model rollups. Spend filtered by `ai_usage_log.created_at`; denominator filtered by `call_notes.created_at` where source='kixie' OR (source='granola' AND likely_call_type='advisor_call'). |

Cache tag: `CACHE_TAGS.CALL_INTELLIGENCE_QUEUE`. Mutating routes call `revalidateTag()` after a successful bridge response. Listed in `src/app/api/admin/refresh-cache/route.ts` for the bulk admin invalidation. Note-review mutators also revalidate `CALL_INTELLIGENCE_QUEUE` (no separate `NOTE_REVIEWS` tag — the widget fetches with `cache: 'no-store'`).

### Bridge Client

`src/lib/sales-coaching-client/`:
- `index.ts` — server-only fetch wrapper, signs token + sets `X-Request-ID`, parses response against mirrored Zod schema, dispatches typed errors per response code. **2026-05-12** — 8 admin methods added for the Users-tab refactor: `listManagers`, `listCoachingTeams`, `createCoachingTeam`, `addCoachingTeamMember`, `removeCoachingTeamMember`, `saveGranolaKey`, `verifyGranolaKey`, `clearGranolaKey`. All admin-only on the bridge; reuse the shared `bridgeRequest()` plumbing with no new typed-error classes (the new endpoints use the standard `{ ok: false, error: '...' }` envelope, so 400/401/403/404/409/500 dispatch is already covered).
- `token.ts` — `signDashboardToken(email, opts)` HMAC-SHA256
- `errors.ts` — `BridgeAuthError`, `BridgeTransportError`, `BridgeValidationError`, `EvaluationConflictError`, `DeactivateBlockedError`, `ContentRefinementAlreadyResolvedError`, `EvaluationNotFoundError`, `ContentRefinementDuplicateError`, `RubricConflictError` (`reason: 'version_mismatch' | 'not_in_draft' | 'concurrent_activation'`), `CallNoteConflictError` (carries `callNoteId`, `expectedVersion`, `actualVersion`; bridge-side and route-side both surface 409 status — defense in depth, since the typed branch fires only when the bridge envelope's `error` is exactly `'call_note_conflict'`).
- `schemas.ts` — **byte-identical mirror** of `sales-coaching/src/lib/dashboard-api/schemas.ts`. CI workflow `.github/workflows/schema-mirror-check.yml` fails the build on drift (cross-repo checkout requires `secrets.CROSS_REPO_TOKEN`). Local check: `npm run check:schema-mirror` (uses GH raw with `GH_TOKEN`, or `SALES_COACHING_SCHEMAS_PATH` for sibling-repo dev). Recovery: `/sync-bridge-schema` skill in Claude Code. **2026-05-12 sync** — adds Zod contracts for eight new admin endpoints powering the Users tab: `ListManagers`, `ListCoachingTeams`, `CreateCoachingTeam`, `AddCoachingTeamMember`, `RemoveCoachingTeamMember`, `SaveGranolaKey`, `VerifyGranolaKey`, `ClearGranolaKey`. `ListManagers` returns role=manager only (server `assertManagerAssignmentValid` rejects pod-director admins as `manager_id`); pod-director admins like GinaRose Galli surface elsewhere as `coaching_teams.lead_rep_id`.

### Key Files

| File | Purpose |
|---|---|
| `src/app/dashboard/call-intelligence/CallIntelligenceClient.tsx` | Tab strip with role-gated rendering |
| `src/app/dashboard/call-intelligence/tabs/QueueTab.tsx` | Pending / Revealed / All toggle + table |
| `src/app/dashboard/call-intelligence/tabs/SettingsTab.tsx` | Reveal policy form (manual / auto_delay / auto_immediate) |
| `src/app/dashboard/call-intelligence/tabs/AdminUsersTab.tsx` | Users CRUD + deactivate-blocked bulk-reassign UX. **2026-05-12** — full-form refactor: Add form gathers email/full_name/role/canonical_manager/pod/slack_id/sfdc_id/granola_key with role-aware required-vs-forbidden manager gating, lowercase domain hint, Slack `/^U[A-Z0-9]+$/` + SFDC 15/18-char + Granola `grn_` client validations. Edit slide-over drawer adds reveal-policy controls + per-pod-membership remove buttons + Granola Save/Rotate/Verify/Clear with tri-state pill (`valid` / `unverified` / `invalid` / `no_key` / 400-rejected). Submit order: `createUser` first, then `addCoachingTeamMember` + `saveGranolaKey` in parallel via `Promise.allSettled` — secondary failures surface as warnings, never roll back the create. Duplicate-email submit currently lands as 500 (kernel doesn't typed-error 23505 yet); form detects 500 and shows "may already be in use — try Edit" inline on the email field. Footer note directs admins to `scripts/manage-rep.ts` CLI for coaching DM CC subscriptions (out of scope for this UI). **2026-05-12 inline pod-create** — "+ New pod" button next to the Add form's pod dropdown opens an inline modal (name + optional description + optional lead picker sourced from active reps with `role IN ('manager','admin')`, including pod-director admins like GinaRose Galli that `listManagers()` filters out). Description is omitted from the request body when blank — the server's `CreateCoachingTeamRequest` rejects empty strings with `z.string().trim().min(1).max(1000).nullable().optional()`, so blank → undefined avoids a 400 Zod error. On confirm: `createCoachingTeam` runs FIRST, then the parent re-fetches teams and the form auto-preselects the new pod id. The new user's rep_id is never threaded into pod-create (lead is a different rep). |
| `src/app/dashboard/call-intelligence/tabs/AdminRefinementsTab.tsx` | Open refinement list with addressed/decline actions |
| `src/app/dashboard/call-intelligence/tabs/RubricsTab.tsx` | Rubrics listing — SGA + SGM sections, version chip, status badge, Edit/View button (auto-locked to "View" when `created_by_is_system === true`) |
| `src/app/dashboard/call-intelligence/rubrics/[id]/page.tsx` | Rubric editor server gate. Re-applies the manager+admin allowlist independently (sub-routes do NOT inherit the parent page gate). For `[id] === 'new'`, seeds the form from the current active rubric for the role (Q1). Calls `isSystemRubric()` to set `readOnlyReason='system'` when the row's creator is a system rep. |
| `src/app/dashboard/call-intelligence/rubrics/[id]/RubricEditorClient.tsx` | Editor client: name input, dimension cards with `@dnd-kit` (PointerSensor + KeyboardSensor for a11y), level-1..4 textareas, sticky save bar. Activate flow opens a confirm modal that diffs the draft against the active rubric (added / dropped / unchanged) with an `AbortController`-cancelled prefetch. Save-draft 409 preserves local edits and surfaces a "Fork to v{N+1}" CTA (Q2). Reads `readOnlyReason` to lock for system rubrics. |
| `src/components/call-intelligence/RubricVersionBadge.tsx` | Small `Rubric vN` chip rendered alongside `OverallScoreBadge` in the eval detail header and in queue rows. Tooltip surfaces dimension count to make cross-version comparisons explicit. |
| `src/lib/queries/call-intelligence-rubrics.ts` | `getRubricsForList({ role?, status? })` (LEFT JOIN reps for `created_by_name` + `created_by_is_system`), `isSystemRubric(id)` |
| `src/app/dashboard/call-intelligence/evaluations/[id]/EvalDetailClient.tsx` | Eval detail (full-width): inline edits + audit toggle + citation pills + transcript comments. Transcript and KB chunks render as **modals**, not a side pane — a "View transcript" button opens the transcript modal; clicking a citation pill opens the relevant modal (transcript scrolled to the cited utterance, or KB chunk inspector). Header now shows `RubricVersionBadge` next to `OverallScoreBadge`. |
| `src/app/dashboard/call-intelligence/my-refinements/page.tsx` | Per-user refinement requests list (linked from Settings tab) |
| `src/components/call-intelligence/` | Components: `CitationPill`, `CitedProse` (2026-05-11 — text + trailing wrapped citation pills; replaces two diverged private impls in InsightsEvalDetailModal and EvalDetailClient), `TranscriptModal` (wraps `TranscriptViewer` in a centered modal with auto-scroll-to-utterance), `TranscriptViewer`, `KBSidePanel` (renders as a centered modal despite the legacy name), `RefinementModal`, `InlineEditDimensionScore`, `InlineEditTextField`, `InlineEditListField`, `AuditToggle`, `UtteranceCommentCard`, `UtteranceCommentComposer`, `MyRefinementsTable`. Plus `citation-helpers.ts` (defensive readers + version-support helpers — `isFieldSupportedByAiOriginalVersion` now gates `body` field on `version >= 6`). |
| `src/lib/queries/call-intelligence-evaluations.ts` | `getRepIdByEmail`, `getEvaluationsForManager`, `getEvaluationDetail`, `getTranscriptComments`, `getKbChunksByIds` |
| `src/lib/queries/call-intelligence-users.ts` | `getCoachingUsers` (returns full rep row incl. `slack_user_id`, `sfdc_user_id`, `granola_key_status`, `granola_key_last_validated_at`, derived `has_granola_key`; admins intentionally INCLUDED for pod-lead picker), `getRevealSettingsByEmail` |
| `src/lib/queries/call-intelligence-refinements.ts` | `getContentRefinements` |
| `src/types/call-intelligence.ts` | `EvaluationQueueRow`, `EvaluationDetail`, `Citation`, `TranscriptCommentRow`, `KbChunkAugmentation`, `TranscriptUtterance`, `CoachingRep`, `ContentRefinementRow`, `RevealSettings`, `CallIntelligenceTab` |
| `src/app/dashboard/call-intelligence/review/[callNoteId]/page.tsx` | Server gate (page 20 + `recruiter`/`capital_partner` redirects) → fetches `getCallNoteReview` via bridge; on failure redirects to `?tab=queue&note=unavailable`. |
| `src/app/dashboard/call-intelligence/review/[callNoteId]/NoteReviewClient.tsx` | Two-column editor + SFDC linkage panel. **Single-flight save queue** (refs: `editVersionRef`, `lastSavedDraftRef`, `inFlightRef`, `pendingDraftRef`) — only one PATCH in flight; new keystrokes during a save accumulate and flush after settle. `flushPendingSave()` called and awaited before Approve / Reject / Pick. SFDC search uses `AbortController` per request. Approve disabled when `!linked || isSubmitting || hasUnsavedChanges || draftIsEmpty`. On 409, banner + `router.refresh()`. |
| `src/app/dashboard/call-intelligence/tabs/MyPendingNoteReviewsWidget.tsx` | "My pending note reviews" strip. Client-fetches `/api/call-intelligence/note-reviews` with `cache: 'no-store'`; renders nothing on empty. The bridge enforces visibility (managers + admins see all pending; reps see only their own). **Currently NOT mounted anywhere** — kept as a ready-to-use component. The previous mount on QueueTab was reverted because (a) the widget visually displaced the existing global filters / pills / sort / rep-role filter / search, and (b) the widget items aren't pre-filtered by advisor-call type, so they appeared inconsistent with the queue's `(cn.source='kixie' OR cn.likely_call_type='advisor_call')` rule. Re-mounting requires a sales-coaching change to expose `likely_call_type` on `CallNoteSummarySchema` so the same rule can be applied client-side, OR mounting on a less-trafficked surface (own tab, settings page) where the visual displacement is acceptable. |
| `src/components/call-intelligence/RejectReasonModal.tsx` | Reusable a11y-baseline reject modal (focus textarea on open, Escape closes, `role="dialog" aria-modal aria-labelledby`). |
| `src/components/call-intelligence/ConfirmSubmitModal.tsx` | Reusable Salesforce-push confirmation modal with the same a11y baseline. Approve button pinned to `dark:text-gray-900` to prevent global dark-text overrides from breaking contrast. |
| `src/components/call-intelligence/SaveStateChip.tsx` | `idle`/`saving`/`saved at HH:MM:SS`/`error → retry` chip. |
| `src/components/call-intelligence/QueryTypeSelector.tsx` | Radio strip ≥768px, native `<select>` below. **No longer wired into NoteReviewClient as of 2026-05-10** — replaced by a single auto-detect input. Kept as code for potential future use. |
| `src/components/call-intelligence/SfdcResultsList.tsx` | Tappable list of SFDC matches; rows show name + type + optional CRD / owner_email + score. |
| `src/components/call-intelligence/SuggestedRecordsPanel.tsx` | One-click waterfall-candidate picker (added 2026-05-10). Renders the SFDC suggestion candidates the Slack DM already showed — `Recommended` + `Other matches from the call` — so reps don't need a fresh SOQL search when the auto-suggested record is correct. Consumes `BridgeSfdcSuggestion` from `getCallNoteReview` response (optional+nullable for forward/backward compat). Each "Use this" button calls `handlePick` which fires the existing `PATCH /sfdc-link`. Hidden when suggestion is null OR candidates list is empty. Schema uses `.passthrough()` and treats `owner_id` / `owner_name` / `owner_match` / `confidence_tier` / `account_name` as optional so legacy `slack_review_messages.sfdc_suggestion` JSONB rows written before those fields existed parse without error (driving incident: Lena × Cory Underwood `c425a90f` silently redirected to Queue because the legacy DM-row JSONB lacked `confidence_tier`). Cross-repo byte-equal check still enforces lockstep schemas. |
| `src/lib/call-intelligence/note-review-constants.ts` | `LONG_NOTE_CHAR_THRESHOLD = 2800` — mirrors sales-coaching's threshold; only affects the "Long note" hint chip. |

**Queue scope: manager sees all + SGA/SGM shared-record visibility (2026-05-10)** — `getEvaluationsForManager` in `src/lib/queries/call-intelligence-evaluations.ts` previously scoped manager-role to "assigned-to-me only" and SGM/SGA to "own only". New rules: managers see everything (mirroring admin/revops_admin); SGM/SGA see own evals OR cross-rep evals where the underlying `call_note.sfdc_record_id` matches any of their own call_notes' `sfdc_record_id`. This is "shared person" visibility — two reps who both linked a call to the same SFDC Lead/Contact/Opportunity/Account see each other's calls. Pre-linkage calls only show under own-rep-id. Eval-detail route's authority check (`src/app/api/call-intelligence/evaluations/[id]/route.ts`) was expanded in parallel: managers always allowed; SGA/SGM allowed when `isOwner` OR `isAssignedManager` OR shared-SFDC-record (bounded `LIMIT 1` lookup). `EvaluationDetail.call_sfdc_record_id` added to support the gate. Phase 2 follow-up will extend to `sfdc_account_id` matching once `call_notes.sfdc_account_id` is populated.

**Rep-edited note flows through eval detail + SGA hub record-notes too (2026-05-10)** — same shape as the Coaching Usage detail fix: `getEvaluationDetail` in `src/lib/queries/call-intelligence-evaluations.ts:286` and `getRecordNotes` in `src/lib/queries/record-notes.ts:238` both selected `cn.summary_markdown` unconditionally. Both now `COALESCE(cn.summary_markdown_edited, cn.summary_markdown)`. Both functions are uncached so the fix takes effect immediately on deploy without cache-tag invalidation.

**Coaching Usage shows the rep's edited note (2026-05-10)** — `getCallDetail` in `src/app/api/admin/coaching-usage/call/[id]/route.ts` was reading `cn.summary_markdown` (original AI text) which meant Coaching Usage's per-call detail modal always showed the pre-edit summary, never what got pushed to SFDC. Fix: query now selects `COALESCE(cn.summary_markdown_edited, cn.summary_markdown)` — same precedence the approve flow uses for the SFDC writeback. Note-review mutating routes (`PATCH /[callNoteId]`, `/sfdc-link`, `/submit`, `/reject`) now also call `revalidateTag(CACHE_TAGS.COACHING_USAGE)` alongside `CALL_INTELLIGENCE_QUEUE` so the 5-minute cache flushes immediately on save/approve/reject rather than serving stale text for up to 5 min after a rep edit.

**Note-review widget on Queue tab**: `MyPendingNoteReviewsWidget` mounts at the top of `QueueTab` for both `mode='mine'` and `mode='queue'` (the bridge enforces row-level visibility — Dashboard does not re-implement scoping). Empty list = no widget rendered. Each row is a tappable card linking to `/dashboard/call-intelligence/review/[callNoteId]`. The "Long note" hint chip appears on rows over `LONG_NOTE_CHAR_THRESHOLD`. After Approve/Reject the user is redirected to `?tab=queue` and `router.refresh()` causes the just-resolved row to vanish from the widget — no toast (no toast library is installed; the disappearance is the visible feedback).

### Team Insights tab (5c-1)

The `insights` tab (manager + admin only) renders two team-shape views and a per-rep drilldown, all from Neon (no BigQuery):

1. **Dimension heat map** — grid of dimensions × pods, aggregating `evaluations.dimension_scores` JSONB via `jsonb_each`, grouped by `(role, rubric_version, pod_label)`. Pod sub-grouping for SGMs (named pods + `Unassigned (no pod)`); SGAs render as a single `__SGA__` sentinel block. Cell color: Savvy Green `#175242` ≥3.0, Savvy Gold `#8e7e57` ≥2.0, Tan `#c7bca1` <2.0. Click a cell → opens Layer 1 of the three-layer modal stack (eval list → eval detail → transcript). All three layers render inside `InsightsTab.tsx`; URL hash (`#modal=list|detail|transcript`) makes browser back pop one layer at a time. **2026-05-11 — per-dimension `body`**: Layer 2 now leads with a 2-3 sentence AI rationale (`dimension_scores[dim].body`, schema v6) rendered via `<CitedProse>` with trailing citation pills. v2-v5 historical rows lack body until backfilled by `scripts/backfill-dimension-bodies.cjs` — fallback path renders the dim banner + citations + an italic "No per-dimension rationale on file yet" hint. Call-level Narrative / Strengths / Weaknesses / Knowledge gaps / Compliance flags / Additional observations / Rep deferrals sections have been removed from this modal (they belong on the standalone `/evaluations/[id]` page).
2. **Knowledge-gap clusters** — UNION of `evaluations.knowledge_gaps` JSONB rows + `rep_deferrals` table rows, bucketed by the structured fields the upstream AI already writes. Gaps group by the first two path segments of `knowledge_gaps[].expected_source` (e.g. `profile/ideal-candidate-profile`); deferrals group by the first topic in `knowledge_base_chunks.topics[]` resolved from `rep_deferrals.kb_chunk_ids` via `LEFT JOIN LATERAL (... ORDER BY chunk_index, id LIMIT 1)` with `is_active = true`. Items lacking a structured field surface in an `Uncategorized` bucket (gaps) or as `Uncategorized: <topic>` (deferrals — preserves the raw AI topic as a longtail label). The prior approach matched keywords substring-style against `kb_vocab_topics` via `KB_VOCAB_SYNONYMS` and was retired 2026-05-12 because it dropped 66% of advisor-eligible gaps and 84% of deferrals into a vocab black hole. Each cluster row carries a capped `sampleEvidence[]` (5 in team mode, 200 in rep-focus) that feeds a new Layer-1 cluster-evidence modal; row click pushes the existing eval-detail Layer 2 (with `payload.bucket` set to scope the rendered gaps), then citation pill → transcript Layer 3. Cluster cards become clickable buttons (whole-card click target); longtail (`totalOccurrences=1 AND bucketKind='uncategorized'`) collapses into an expandable "Other (N one-offs)" group at the bottom. Source pills filter to gap-only / deferral-only / deferrals→KB-missing / deferrals→KB-covered.
3. **Rep focus** — triggered by `?focus_rep=<uuid>`. Same heat-map helper, scoped to `repIds=[focus_rep]`; additionally returns 90d-trailing sparkline series. `repBreakdown` is suppressed in cluster cards (n=1 by definition).

**Eligibility predicate** (decided 2026-05-10): `(cn.source = 'kixie' OR cn.likely_call_type = 'advisor_call')` — knowledge gaps are knowledge gaps regardless of reveal status. Manager-edited values live in canonical `dimension_scores` / `knowledge_gaps` JSONB columns; no separate handling.

**Authority resolution** (`src/lib/queries/call-intelligence/visible-reps.ts`) — `getRepIdsVisibleToActor(actor)` returns the UNION of:
1. `reps.manager_id = actor.repId` (canonical hierarchy — Weiner sees all 7 SGMs).
2. Members of any team where `coaching_teams.lead_rep_id = actor.repId AND is_active = true` (pod-lead overlay — GinaRose / Nick).
3. `coaching_observers` with `scope='all_sgm'` → all SGMs; `scope='all_sga'` → all SGAs. (`scope='team'` is deferred to v2.)
4. `actor.role IN ('admin','revops_admin')` short-circuits BEFORE the `getRepIdByEmail` lookup — admins without a `coaching_reps` row still pass.

**Role enum boundary** — `actor.role` uses the Dashboard enum (`'admin'|'revops_admin'|'manager'|'sgm'|'sga'`); `reps.role` in the coaching DB uses the coaching enum (`'admin'|'manager'|'SGA'|'SGM'`). Branches 3 and downstream queries compare against the right side of that boundary. Helper short-circuits admin/revops_admin first to avoid mixing.

**Query helpers** (`src/lib/queries/call-intelligence/`):

| File | Export | Purpose |
|---|---|---|
| `visible-reps.ts` | `getRepIdsVisibleToActor(actor)` | Authority union (4 branches above). |
| `pods.ts` | `getActivePodsVisibleToActor(visibleRepIds)` | Active pods whose members intersect the visible set. |
| `dimension-heatmap.ts` | `getDimensionHeatmap({...})` | Grid SQL + (when n=1) trailing-90d sparkline SQL. Sparkline lookback is decoupled from the main date filter to avoid n=1 collapse. |
| `knowledge-gap-clusters.ts` | `getKnowledgeGapClusters({...})` | Structured-field UNION query. Gaps bucket on `expected_source` two-segment path; deferrals bucket on chunk `topics[]` via lateral join. Accepts `mode: 'team' | 'rep_focus'` to cap `sampleEvidence[]` at 5 vs 200. All filters bound as `$N` params; the only literal in the SQL is `sliceCap` (constrained at the TS layer to `5 \| 200`). |
| `kb-vocab-synonyms.ts` | `KB_VOCAB_SYNONYMS` (32 vocab values incl. `annuity`) | Retained as theming data (badge colors per canonical bucket). **No longer load-bearing for cluster bucketing as of 2026-05-12** — the cluster query is no longer importing this map. The file lives at `src/lib/queries/call-intelligence/kb-vocab-synonyms.ts`. |
| `insights-evals-list.ts` | `getInsightsEvalsList({...})` | Drill-down list used by Layer 1 of the in-tab modal stack (heat-map cell click). Filters by role/rubric_version/pod/dimension/range/rep. `DISTINCT` to dedupe LEFT-JOINed multi-team rows. |

**Components**:
- `src/app/dashboard/call-intelligence/tabs/InsightsTab.tsx` — full client tab with sticky filter bar (range, role, pod multi-select, source pills), heat-map render (team mode + rep-focus mode with sparklines), cluster list, URL-param persistence via `router.replace({ scroll: false })`.
- `src/components/call-intelligence/Sparkline.tsx` — shared SVG sparkline (extracted from `GCHubAdvisorTable`). Auto-trend coloring; falls back to `—` when <2 points.
- `src/components/call-intelligence/InsightsEvalListModal.tsx` (Layer 1 — heat-map cell drill), `InsightsClusterEvidenceModal.tsx` (Layer 1 — cluster card drill), and `InsightsEvalDetailModal.tsx` (Layer 2) — modal-stack drill-down rendered inline inside the Insights tab. Cluster modal columns: rep (clickable → rep-focus mode), call date, kind chip (Gap | Deferral · Covered/Partial/Missing), evidence preview. Row click pushes Layer 2 with `payload.bucket` + `payload.bucketKind` set so the eval-detail modal can highlight the matched gaps. Layer 3 reuses `TranscriptModal.tsx` with `disableOwnEscHandler` + `zClassName="z-[70]"` so the parent owns a unified Esc handler. Bucket-match logic shared between modal and tests lives at `src/components/call-intelligence/bucket-match.ts` (pure function — mirrors the Phase 2E SQL CASE).
- `src/app/dashboard/call-intelligence/tabs/CostAnalysisTab.tsx` — admin-only "Cost Analysis" tab (2026-05-11). Date-range picker with presets (Month-to-date default, Last 7/30/90 days, Custom). Four KPI cards (Total spend, Spend per advisor call, Avg $/day, Avg $/month projection). Recharts area chart for daily spend series + two rollup tables (by feature, by model). Backed by GET `/api/call-intelligence/cost-analysis` pass-through to the sales-coaching bridge. Tab gated on `isAdmin` in `CallIntelligenceClient.tsx`.

**URL contract** — filters persist via query params: `?tab=insights&range=30d&role=SGM&pods=<id1>,<id2>&source=deferrals_kb_missing&focus_rep=<uuid>`. The "← Back to team" button only clears `focus_rep` — range/role/pod/source remain intact. Role + pod controls switch to read-only chips while in focus mode.

**Conventions established for this feature**:
- **Single-flight save queue with ref-based OCC**. Use this pattern (not naive debounced setTimeout) any time a textarea autosave can race itself. Refs hold the latest server `edit_version` and the last-saved draft so closures don't go stale; new keystrokes during a save accumulate in `pendingDraftRef` and flush automatically when the in-flight save resolves.
- **`min-h-[44px]` touch-target convention** — Apple HIG floor — for buttons, list rows, inputs, and `<select>` on new mobile-first surfaces.
- **Radio→`<select>` mobile fallback** in `QueryTypeSelector` (radio strip with `hidden md:inline-flex`, `<select>` with `md:hidden`). Both share state.
- **Defense-in-depth 409 mapping**: bridge throws typed `CallNoteConflictError` when the envelope's `error` is exactly `'call_note_conflict'`, otherwise falls through to `BridgeTransportError(status=409)`. Either way the API route returns 409 to the client. Client only branches on status, not on the error class.

### Environment Variables

| Variable | Purpose |
|---|---|
| `DASHBOARD_BRIDGE_SECRET` | HMAC-SHA256 secret shared with sales-coaching Cloud Run (min 32 chars). Generate with `openssl rand -base64 32`. |
| `SALES_COACHING_API_URL` | Base URL of sales-coaching Cloud Run service (no trailing slash). |
| `SALES_COACHING_DATABASE_URL_UNPOOLED` | Direct (unpooled) Neon URL for raw `pg` reads. Required because PgBouncer transaction-pooled URL disables prepared statements. |

The same `DASHBOARD_BRIDGE_SECRET` value must be configured on Vercel (Production + Preview + Development), in GCP Secret Manager (`sales-coaching-dashboard-bridge-secret`), and on the Cloud Run service. Rotate by issuing a new random value, updating all three locations, and bumping the Cloud Run revision.

### Identity Resolution

The bridge does not pass IDs — sales-coaching resolves the caller via email. Dashboard's `revops_admin` role has no counterpart in sales-coaching, so revops_admin users must be seeded into the `reps` table with `role='admin'` to write through the bridge. Email comparison is case-insensitive lowercase.

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
| **Stale Pipeline Alerts** | UI section on Pipeline tab showing records grouped by stage with aging badges. Days-in-stage thresholds: 30d (yellow), 60d (orange), 90d (red). On Hold records shown in a separate sub-section. |
| **Days in Stage** | `DetailRecord.daysInCurrentStage` — calculated at app layer in `date-helpers.ts:calculateDaysInStage()`. Uses per-stage entry date fields from `vw_funnel_master`. Qualifying uses `Opp_CreatedDate` as proxy. |

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
   - ✅ SGA Management moved from standalone page to SGA Hub tab (revops_admin only)
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

This documentation is maintained by [`@mossrussell/agent-guard`](https://www.npmjs.com/package/@mossrussell/agent-guard), a four-layer documentation integrity system:

1. **Standing Instructions** — AI agents receive context about docs and update them alongside code changes
2. **Generated Inventories** — Deterministic scripts regenerate `docs/_generated/*.md` from source code
3. **Pre-commit Hook** — Detects doc-relevant changes, auto-runs generators, and invokes Claude Code for narrative updates
4. **CI/CD Audit** — GitHub Actions catch drift on push to main and create issues with remediation steps

**To manually regenerate inventories:**
```bash
npm run gen:all
```

**Configuration:** See `agent-docs.config.json` for all detection categories, scan paths, and automation settings.

---

## 21. Savvy Analyst Bot

### Overview

The Savvy Analyst Bot (`packages/analyst-bot/`) is a conversational BI tool that runs in Slack. Users @mention the bot with natural language data questions and receive formatted results with charts, tables, and XLSX exports — all without touching the dashboard.

| Property | Value |
|----------|-------|
| Package | `packages/analyst-bot/` (`@savvy/analyst-bot`) |
| Runtime | Node.js 20 on Google Cloud Run (us-east1) |
| LLM | Claude Sonnet 4.6 via Anthropic API (beta MCP client) |
| Schema Context | Remote MCP server — fetches `.claude/schema-config.yaml` live from GitHub (auto-refreshed on push via GitHub Action) |
| Slack Framework | `@slack/bolt` 4.x (ExpressReceiver, HTTP mode) |
| Thread Storage | Neon PostgreSQL (`bot_threads` table, JSONB messages) |
| Audit Log | BigQuery `bot_audit.interaction_log` (streaming inserts) |
| Issue Tracking | BigQuery `bot_audit.issues` + `bot_audit.issue_events` + Neon `DashboardRequest` |

### Architecture

```
Slack (user @mention)
  │
  ▼
Cloud Run (savvy-analyst-bot)
  ├── slack.ts ─── Bolt event handlers (app_mention, message, reaction, action, view)
  ├── conversation.ts ─── Core engine: calls Claude, parses charts/XLSX/issues
  ├── claude.ts ─── Anthropic API client with remote MCP server attachment
  ├── charts.ts ─── Chart.js PNG rendering from [CHART] blocks
  ├── xlsx.ts ─── ExcelJS workbook generation from [XLSX] / [EXPORT_SQL] blocks
  ├── bq-query.ts ─── Direct BigQuery execution for large XLSX exports
  ├── issues.ts ─── Format and post issue reports to #data-issues
  ├── dashboard-request.ts ─── Create DashboardRequest + sync to BigQuery
  ├── thread-store.ts ─── Neon CRUD for conversation threads
  ├── audit.ts ─── Fire-and-forget BigQuery audit logging
  └── system-prompt.ts ─── Single source of truth for Claude's analyst persona
```

### Conversation Flow

1. User @mentions the bot in an allowed Slack channel
2. Bot adds hourglass reaction, loads thread history from Neon
3. User message + history sent to Claude Sonnet via Anthropic beta API with MCP server attached
4. Claude calls schema-context MCP tools (`describe_view`, `get_metric`, `lint_query`, `execute_sql`) to gather data
5. Bot parses Claude's response for `[CHART]`, `[XLSX]`, `[EXPORT_SQL]`, and `[ISSUE]` blocks
6. Renders chart PNG (Chart.js via canvas), generates XLSX (ExcelJS), or files issue as appropriate
7. Posts text response + uploads chart/XLSX to thread
8. Saves thread state to Neon, writes audit record to BigQuery

### Issue Reporting (Slack Modal)

When a user says "report issue" (or similar triggers), the bot skips Claude entirely and presents a Slack modal form:

1. Bot posts a "Report Issue" button in the thread (with the original question shown as context)
2. User clicks the button — Slack modal opens with:
   - **What looks wrong?** — textarea (pre-filled if user included text after "report issue")
   - **What did you expect?** — textarea (optional)
   - **Priority** — dropdown (Low / Medium / High, defaults to Medium)
3. On submit, the issue is filed to three places simultaneously:
   - **Neon** — `DashboardRequest` row (type `DATA_ERROR`, ID prefix `cbot_`) with original prompt in description and SQL attached as `.sql` file (`RequestAttachment`)
   - **BigQuery** — `bot_audit.issues` row + `bot_audit.issue_events` "created" event
   - **Slack** — Formatted report posted to alerts channel (`ISSUES_CHANNEL`)
4. Confirmation message posted in the original thread

Other issue triggers: "this doesn't look right", "flag this", "this looks wrong", "something is off", or the :triangular_flag_on_post: reaction emoji.

### XLSX Export Paths

| Path | Trigger | How It Works |
|------|---------|--------------|
| `[EXPORT_SQL]` | Claude writes SQL + column spec | Bot executes SQL directly against BigQuery, maps rows to columns, generates XLSX. Preferred for large datasets (>10 rows). |
| `[XLSX]` | Claude serializes data as JSON | Bot normalizes Claude's shape (headers → columns, array rows → keyed rows), generates XLSX. For small datasets. |
| Heuristic | User requests export but no block present | Bot parses markdown tables from response text and converts to XLSX. |

### System Prompt Rules

The system prompt (`system-prompt.ts`) enforces:

- **Pre-query gate**: Must call `describe_view` and `get_metric` before writing SQL, then `lint_query` before executing
- **Cohort mode default**: Conversion rates always use cohort mode unless user explicitly requests period mode
- **Slack formatting**: `*bold*` not `**bold**`, tables wrapped in triple backticks, `<url|text>` link format
- **Output structure**: Results → Chart → Editorial → Suggested follow-up → Footer
- **No narration**: Response must start with the data, not "Let me check the schema..."

### Deployment

| Property | Value |
|----------|-------|
| Image | `gcr.io/savvy-gtm-analytics/savvy-analyst-bot` |
| Region | us-east1 |
| Min instances | 1 (always warm) |
| CPU throttling | Disabled (`--no-cpu-throttling`) — required for async Bolt handlers |
| Startup CPU boost | Enabled |
| Port | 3000 |
| Entry point | `node dist/index.js --mode slack` |
| Cleanup | `POST /internal/cleanup` (authenticated, deletes threads >48h old) |

**Deploy command (image-only — preserves secrets/env vars):**
```bash
cd packages/analyst-bot
gcloud builds submit --config=cloudbuild.yaml --project=savvy-gtm-analytics .
gcloud run deploy savvy-analyst-bot --project=savvy-gtm-analytics --region=us-east1 \
  --image=gcr.io/savvy-gtm-analytics/analyst-bot:latest
```

> Do NOT use `--set-secrets` or `--set-env-vars` — it overwrites all existing values. Secrets are configured on the Cloud Run service via Secret Manager refs.

### MCP Server

The MCP server (`savvy-mcp-server`) provides schema context and BigQuery access to both the analyst bot and external MCP users.

| Property | Value |
|----------|-------|
| Image | `gcr.io/savvy-gtm-analytics/savvy-mcp-server` |
| Region | us-east1 |
| Source | `mcp-server/` |
| Schema Source | Fetched live from GitHub (`raw.githubusercontent.com/.../main/.claude/schema-config.yaml`) with 5-minute cache |
| Auto-refresh | GitHub Action (`.github/workflows/refresh-schema.yml`) calls `/refresh-schema` on push to `main` |
| Tools | `schema_context`, `execute_sql`, `list_datasets`, `list_tables`, `describe_table` |

**Schema config update workflow:**
1. Edit `.claude/schema-config.yaml`, commit, push to `main`
2. GitHub Action triggers → curls `/refresh-schema` → MCP server re-fetches from GitHub
3. Live immediately for all consumers (Slack bot, MCP users) — no rebuild needed

**Deploy (only for `mcp-server/src/**` changes):**
```bash
bash mcp-server/deploy.sh
```

### Environment Variables

| Variable | Source | Purpose |
|----------|--------|---------|
| `ANTHROPIC_API_KEY` | Secret Manager | Claude API authentication |
| `MCP_SERVER_URL` | Config | Remote MCP server endpoint |
| `MCP_API_KEY` | Secret Manager | MCP server authentication |
| `DATABASE_URL` | Secret Manager | Neon PostgreSQL connection string |
| `BIGQUERY_PROJECT` | Config | `savvy-gtm-analytics` |
| `AUDIT_DATASET` | Config | `bot_audit` |
| `AUDIT_TABLE` | Config | `interaction_log` |
| `SLACK_BOT_TOKEN` | Secret Manager | Slack Bot OAuth token |
| `SLACK_SIGNING_SECRET` | Secret Manager | Slack request verification |
| `ALLOWED_CHANNELS` | Config | Comma-separated channel IDs the bot responds in |
| `ISSUES_CHANNEL` | Config | Channel ID for alerts/issues |
| `MAINTAINER_SLACK_ID` | Config | User ID tagged on issue reports |
| `BOT_SUBMITTER_ID` | Config | Fallback DashboardRequest submitter |
| `CLEANUP_SECRET` | Secret Manager | Auth header for cleanup endpoint |
| `VERBOSE` | Config | `true` for debug logging |

### Slack App Setup

The Slack app requires two endpoints pointing at the same Cloud Run URL:

| Slack Setting | URL |
|---------------|-----|
| Event Subscriptions → Request URL | `https://<service-url>/slack/events` |
| Interactivity & Shortcuts → Request URL | `https://<service-url>/slack/events` |

**Required bot scopes**: `app_mentions:read`, `chat:write`, `channels:history`, `files:write`, `reactions:read`, `reactions:write`, `users:read`, `users:read.email`

**Event subscriptions**: `app_mention`, `message.channels`, `reaction_added`

### BigQuery Audit Schema

**Dataset**: `bot_audit`

| Table | Purpose | Write Pattern |
|-------|---------|---------------|
| `interaction_log` | Every bot interaction (question, response, tools called, SQL, bytes scanned) | Streaming insert (fire-and-forget) |
| `issues` | One mutable row per issue (current state: title, description, priority, status) | DML INSERT (immediately updatable) |
| `issue_events` | Append-only audit trail (created, status changes, comments) | Streaming insert |
| `issue_summary` | VIEW joining issues + latest event | Read-only |

---

*Last Updated: April 11, 2026*
*Validated Against Codebase: Yes*
*Last Review: April 11, 2026 (Section 21 added: Savvy Analyst Bot architecture, deployment, issue modal flow)*
