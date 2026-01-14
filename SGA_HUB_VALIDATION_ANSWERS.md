# SGA Hub Implementation - Validation Answers

**Date:** January 27, 2026
**Status:** ✅ Complete - All patterns verified

---

## Section 1: Existing Codebase Patterns

### 1.1 API Route Structure ✅

**Authentication:**
```typescript
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

const session = await getServerSession(authOptions);
if (!session?.user?.email) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
```

**Permissions:**
```typescript
import { getUserPermissions } from '@/lib/permissions';

const permissions = await getUserPermissions(session.user.email);
if (!permissions.canManageUsers) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
```

**Error Handling:**
- Try-catch blocks
- `console.error()` for logging
- Status codes: 400 (bad request), 401 (unauthorized), 403 (forbidden), 404 (not found), 500 (server error)
- Return format: `NextResponse.json({ error: 'message' }, { status: code })`

**Response Format:**
- Success: `NextResponse.json({ data })`
- Error: `NextResponse.json({ error: 'message' }, { status: code })`

### 1.2 BigQuery Query Patterns ✅

**runQuery Signature:**
```typescript
export async function runQuery<T>(query: string, params?: Record<string, any>): Promise<T[]>
```

**Parameters:** Named parameters (Record<string, any>), not array
**Return Type:** Array of type T
**toNumber Helper:** ✅ Exists in `src/types/bigquery-raw.ts`

### 1.3 Constants File ✅

- `FULL_TABLE`: ✅ Exists, value: `'savvy-gtm-analytics.Tableau_Views.vw_funnel_master'`
- `RECRUITING_RECORD_TYPE`: ✅ Exists, value: `'012Dn000000mrO3IAI'`
- No other SGA-related constants found

### 1.4 Prisma Client ✅

- Export name: `prisma` (named export)
- Also has default export: `export default prisma`
- Provider: PostgreSQL
- Import: `import { prisma } from '@/lib/prisma'`

### 1.5 API Client Patterns ✅

- `apiFetch<T>()`: ✅ Exists as helper function
- `dashboardApi`: ✅ Object structure exists
- Query parameters: Handled via `URLSearchParams` for GET requests
- `ApiError`: ✅ Class exists

---

## Section 2: Database & Schema Questions

### 2.1 Existing Prisma Schema ✅

- Provider: PostgreSQL
- User model has: `id`, `email`, `name`, `passwordHash`, `role`, `isActive`, `createdAt`, `updatedAt`, `createdBy`
- No existing `@db.Date` fields found (all use DateTime)
- Naming: camelCase for fields, PascalCase for models

### 2.2 Database Connection ✅

- Database: Connected (PostgreSQL)
- Migration strategy: `prisma migrate dev`
- Migrations: Should exist in `prisma/migrations/`

---

## Section 3: BigQuery View Structure

### 3.1 vw_funnel_master Fields ✅

**Verified via MCP:**
- `SGA_Owner_Name__c`: STRING (exact match required)
- `Initial_Call_Scheduled_Date__c`: DATE (direct comparison, no TIMESTAMP wrapper)
- `Qualification_Call_Date__c`: DATE (direct comparison, no TIMESTAMP wrapper)
- `Date_Became_SQO__c`: TIMESTAMP (requires TIMESTAMP wrapper)
- `is_sqo_unique`: INT64 (0 or 1, not BOOLEAN)
- `recordtypeid`: STRING
- `primary_key`: STRING (Lead ID: 00Q... or Opp ID: 006...)
- `Full_Opportunity_ID__c`: STRING (nullable)

### 3.2 Closed Lost View Structure ✅

**Verified via MCP:**
- View exists: `savvy-gtm-analytics.savvy_analytics.vw_sga_closed_lost_sql_followup`
- SGA field: `sga_name` (STRING, exact match to `user.name`)
- `time_since_last_contact_bucket`: STRING (values: 30-60, 60-90, 90-120, 120-150, 150-180)

### 3.3 SGA Name Mapping ✅

- BigQuery `SGA_Owner_Name__c` values: Case-sensitive strings (e.g., "Holly Huffman", "Paige de La Chapelle")
- Prisma User `name` field: String, required
- Matching: Must be exact (case-sensitive) match

---

## Section 4: Authentication & Permissions

### 4.1 Auth Configuration ✅

- Export name: `authOptions` (named export from `@/lib/auth`)
- Provider: Credentials (email/password)
- Session fields: `session.user.email`, `session.user.name`, `session.user.id`

### 4.2 Permissions System ✅

**Function Signature:**
```typescript
export async function getUserPermissions(email: string): Promise<UserPermissions>
```

**Return Type:**
```typescript
interface UserPermissions {
  role: 'admin' | 'manager' | 'sgm' | 'sga' | 'viewer';
  allowedPages: number[];
  sgaFilter: string | null;
  sgmFilter: string | null;
  canExport: boolean;
  canManageUsers: boolean;
}
```

**Roles:** `admin`, `manager`, `sgm`, `sga`, `viewer`
**Page IDs:** Currently 1-7, adding 8 (SGA Hub) and 9 (SGA Management)

### 4.3 Role Definitions ✅

- Stored in: User model (`role` field, String type)
- Values: `'admin' | 'manager' | 'sgm' | 'sga' | 'viewer'`

---

## Section 5: Frontend Patterns

### 5.1 Component Library ✅

- Tremor: ✅ Installed (`@tremor/react`)
- Shadcn/ui: ❌ Not installed
- Tailwind CSS: ✅ Installed and configured

### 5.2 Existing Dashboard Components ✅

- Data fetching: `useEffect` with `useState`
- Loading states: Skeleton components or loading spinners
- Error states: Error messages with retry options
- Tables: Tremor `Table` components

### 5.3 Sidebar Navigation ✅

- Structure: Array of page objects with `id`, `name`, `href`, `icon`
- Page IDs: 1-7 currently, highest is 7 (Settings)
- Filtering: Uses `allowedPages` from permissions
- Adding: ID 8 (SGA Hub), ID 9 (SGA Management)

---

## Section 6: Type Definitions

### 6.1 Existing Type Patterns ✅

- Naming: PascalCase for interfaces, camelCase for fields
- Optional fields: Marked with `?` or `| null`
- Date strings: ISO format strings (`string`)
- API responses: Wrapped in objects (e.g., `{ users: SafeUser[] }`)

### 6.2 BigQuery Raw Types ✅

- File exists: `src/types/bigquery-raw.ts`
- Helpers: `toNumber()`, `toString()`
- Date/timestamp: Typed as `string | { value: string } | null`

---

## Section 7: Testing & Verification

### 7.1 Test Environment

- Test database: Not explicitly configured
- Tests: No test framework found (no Jest/Vitest config)
- Test scripts: Basic connection tests only

### 7.2 MCP Availability ✅

- MCP: ✅ Available for BigQuery
- Connection: Verified via test queries
- Status: Working correctly

---

## Section 8: Edge Cases & Error Scenarios

### 8.1 User Without SGA Data ✅

**Handling:**
- Returns empty arrays (correct assumption)
- No error thrown if `SGA_Owner_Name__c` not found
- Graceful degradation

### 8.2 Missing Prisma User Fields ✅

- `name` field: ✅ Exists (String, required)
- Exact field name: `name` (not `userName` or `fullName`)

### 8.3 Date Boundary Handling ✅

- DATE fields: `<= @endDate` includes full day
- TIMESTAMP fields: `<= TIMESTAMP(CONCAT(@endDate, ' 23:59:59'))` needed

---

## Section 9: Deployment & Environment

### 9.1 Environment Variables

- BigQuery: `GOOGLE_APPLICATION_CREDENTIALS_JSON` (Vercel) or `GOOGLE_APPLICATION_CREDENTIALS` (local)
- Database: `DATABASE_URL`, `POSTGRES_PRISMA_URL`, or `POSTGRES_URL`
- Project ID: `GCP_PROJECT_ID` (defaults to 'savvy-gtm-analytics')

### 9.2 Build Configuration

- Node.js: Not specified in package.json
- Build script: `prisma generate && next build`
- No `.nvmrc` found

---

## Section 10: Implementation Document Gaps

### 10.1 Missing API Endpoints

- `/api/sga-hub/closed-lost/route.ts`: ⚠️ Needs POST handler specification
- `/api/sga-hub/quarterly-progress/route.ts`: ⚠️ Needs full implementation
- `/api/sga-hub/sqo-details/route.ts`: ⚠️ Needs full implementation
- `/api/admin/sga-overview/route.ts`: ⚠️ Needs full implementation

### 10.2 Missing Component Specifications

- `WeeklyGoalEditor.tsx`: ⚠️ Needs full modal implementation details
- `ClosedLostTable.tsx`: ⚠️ Needs full table with filtering details
- `QuarterlyProgressCard.tsx`: ⚠️ Needs full progress display details
- `QuarterlyProgressChart.tsx`: ⚠️ Needs Recharts implementation details
- `SQODetailTable.tsx`: ⚠️ Needs full table implementation details

### 10.3 Missing Export Functions

- CSV export: ⚠️ Needs full implementation for weekly, quarterly, and closed lost

---

## Summary of Updates Made to Implementation Document

### ✅ Verified Patterns (No Changes Needed)
1. API route authentication and permission patterns
2. BigQuery query patterns and helper functions
3. Prisma client usage
4. Constants and imports
5. Permission system structure
6. User model structure

### ⚠️ Updates Applied
1. Added validation status section at top
2. Added verified import comments throughout code examples
3. Enhanced Sidebar navigation instructions with exact code
4. Enhanced permissions update instructions with exact code
5. Added BigQuery field type verification notes
6. Enhanced closed lost query with exact field names
7. Added test user creation notes with name matching requirements

### ⚠️ Still Needs Detail (Future Phases)
1. Full API route implementations for closed-lost, quarterly-progress, sqo-details, admin/sga-overview
2. Full component implementations for all UI components
3. CSV export function implementations

---

## Conclusion

✅ **All critical patterns verified and confirmed**
✅ **Implementation document updated with verified patterns**
⚠️ **Some detailed implementations still need to be added in later phases**

The implementation plan is now validated and ready for agentic execution. All import paths, function signatures, and patterns match the actual codebase.
