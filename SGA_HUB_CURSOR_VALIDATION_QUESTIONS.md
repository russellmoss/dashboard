# SGA Hub Implementation - Cursor.ai Validation Questions

**Purpose**: This document contains validation questions that Cursor.ai should answer before proceeding with agentic development of the SGA Hub feature. Based on Cursor's answers, the implementation document (`SGA_HUB_IMPLEMENTATION.md`) may need updates.

**Instructions for Cursor.ai**:
1. Answer each question by examining the codebase
2. For each section, indicate: ✅ No changes needed, OR ⚠️ Update required (with specifics)
3. If an update is required, provide the exact correction to make in the implementation document
4. After answering all questions, update `SGA_HUB_IMPLEMENTATION.md` directly with any corrections

---

## Section 1: Existing Codebase Patterns

### 1.1 API Route Structure
**Question**: Examine the existing API routes in `src/app/api/`. What is the exact pattern used for:
- Error handling (error types, status codes)
- Session authentication (exact import paths)
- Permission checking (function name and import)
- Response formatting

**Files to examine**:
- `src/app/api/users/route.ts`
- `src/app/api/dashboard/record-detail/[id]/route.ts`
- `src/app/api/dashboard/funnel-metrics/route.ts`

**Why this matters**: The implementation document assumes patterns. If actual patterns differ, API routes will fail to compile.

**Expected answer format**:
```
Authentication: [exact import and usage]
Permissions: [exact function name and return type]
Error handling: [exact pattern]
Response format: [exact pattern]
```

---

### 1.2 BigQuery Query Patterns
**Question**: Examine `src/lib/bigquery.ts` and existing query files:
- What is the exact signature of `runQuery<T>()`?
- How are parameters passed (named params or array)?
- What is the return type structure?
- Is there a `toNumber()` helper in `src/types/bigquery-raw.ts`?

**Files to examine**:
- `src/lib/bigquery.ts`
- `src/lib/queries/funnel-metrics.ts`
- `src/lib/queries/conversion-rates.ts`
- `src/types/bigquery-raw.ts`

**Why this matters**: The implementation uses `runQuery` and `toNumber()` which must match actual signatures.

---

### 1.3 Constants File
**Question**: Examine `src/config/constants.ts`:
- Does `FULL_TABLE` constant exist? What is its exact name and value?
- Does `RECRUITING_RECORD_TYPE` constant exist? What is its exact name?
- Are there any other SGA-related constants?

**Why this matters**: Import paths and constant names must be exact.

---

### 1.4 Prisma Client
**Question**: Examine `src/lib/prisma.ts`:
- What is the exact export name? (`prisma`, `db`, or `default`)
- Is it a named export or default export?

**Why this matters**: Import statements must match.

---

### 1.5 API Client Patterns
**Question**: Examine `src/lib/api-client.ts`:
- Does `apiFetch<T>()` exist as a helper function?
- What is the structure of the `dashboardApi` object?
- How are query parameters handled for GET requests?
- Is there an `ApiError` class?

**Why this matters**: Client functions must match existing patterns.

---

## Section 2: Database & Schema Questions

### 2.1 Existing Prisma Schema
**Question**: Examine `prisma/schema.prisma`:
- What database provider is configured (postgresql, mysql, sqlite)?
- What is the existing User model structure?
- Are there any existing date fields using `@db.Date`?
- What naming conventions are used for models and fields?

**Why this matters**: Schema additions must be compatible with existing configuration.

---

### 2.2 Database Connection
**Question**: 
- Is there an existing database connected?
- What migration strategy is in use (prisma migrate, db push)?
- Are there existing migrations in `prisma/migrations/`?

**Why this matters**: Migration commands may differ based on setup.

---

## Section 3: BigQuery View Structure

### 3.1 vw_funnel_master Fields
**Question**: Using MCP, verify these fields exist in `vw_funnel_master`:
- `SGA_Owner_Name__c` - What are some sample values?
- `Initial_Call_Scheduled_Date__c` - Is it DATE or TIMESTAMP?
- `Qualification_Call_Date__c` - Is it DATE or TIMESTAMP?
- `Date_Became_SQO__c` - Is it DATE or TIMESTAMP?
- `is_sqo_unique` - Is it INTEGER (0/1) or BOOLEAN?
- `recordtypeid` - What values exist?
- `primary_key` - Does it exist? What type?
- `Full_Opportunity_ID__c` - Does it exist?

**MCP Query**:
```sql
SELECT 
  column_name, 
  data_type 
FROM `savvy-gtm-analytics.Tableau_Views.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name = 'vw_funnel_master'
  AND column_name IN (
    'SGA_Owner_Name__c',
    'Initial_Call_Scheduled_Date__c',
    'Qualification_Call_Date__c',
    'Date_Became_SQO__c',
    'is_sqo_unique',
    'recordtypeid',
    'primary_key',
    'Full_Opportunity_ID__c'
  )
```

**Why this matters**: DATA types determine how to write WHERE clauses. Getting DATE vs TIMESTAMP wrong causes query failures.

---

### 3.2 Closed Lost View Structure
**Question**: Using MCP, verify the structure of `vw_sga_closed_lost_sql_followup`:
- Does this view exist at `savvy-gtm-analytics.savvy_analytics.vw_sga_closed_lost_sql_followup`?
- What is the exact field name for SGA? (`sga_name` or `SGA_Owner_Name__c`?)
- List all available columns

**MCP Query**:
```sql
SELECT column_name, data_type 
FROM `savvy-gtm-analytics.savvy_analytics.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name = 'vw_sga_closed_lost_sql_followup'
```

**Why this matters**: Field names must be exact.

---

### 3.3 SGA Name Mapping
**Question**: Using MCP, verify how SGA names map between systems:
- What are the actual `SGA_Owner_Name__c` values in `vw_funnel_master`?
- What are the User `name` values in the Prisma User table for SGA users?
- Do they match exactly (case-sensitive)?

**MCP Query**:
```sql
SELECT DISTINCT SGA_Owner_Name__c 
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE SGA_Owner_Name__c IS NOT NULL
LIMIT 20
```

**Why this matters**: If names don't match exactly, filtering will return no results.

---

## Section 4: Authentication & Permissions

### 4.1 Auth Configuration
**Question**: Examine `src/lib/auth.ts`:
- What is the exact export name for auth options? (`authOptions` or something else?)
- What provider is configured (credentials, Google OAuth, etc.)?
- What fields are available on `session.user`?

**Why this matters**: Auth imports and session structure must be exact.

---

### 4.2 Permissions System
**Question**: Examine `src/lib/permissions.ts`:
- What is the exact function signature for `getUserPermissions()`?
- What does it return? (exact type structure)
- What role values exist? (`admin`, `manager`, `sga`, `viewer`?)
- Is there a Page ID system? What IDs are currently used?

**Why this matters**: Permission checks must use correct function and role names.

---

### 4.3 Role Definitions
**Question**: Where are user roles defined and stored?
- In the User model?
- In a separate table?
- In an external system?

**Why this matters**: The implementation needs to know where to check roles.

---

## Section 5: Frontend Patterns

### 5.1 Component Library
**Question**: What UI component libraries are installed and used?
- Tremor components - which are imported and how?
- Shadcn/ui - is it installed?
- Tailwind CSS - what custom configuration exists?

**Files to examine**:
- `package.json` (dependencies)
- `src/components/ui/` (if exists)
- `tailwind.config.js`

**Why this matters**: Component imports must match what's installed.

---

### 5.2 Existing Dashboard Components
**Question**: Examine existing dashboard components for patterns:
- How is client-side data fetching done? (useEffect, SWR, React Query?)
- How are loading states handled?
- How are error states handled?
- What table components are used?

**Files to examine**:
- `src/components/dashboard/`
- `src/app/dashboard/page.tsx`

**Why this matters**: New components should follow established patterns.

---

### 5.3 Sidebar Navigation
**Question**: Examine `src/components/layout/Sidebar.tsx`:
- What is the structure of navigation items?
- How are page IDs used?
- What is the current highest page ID in use?
- How are role-based navigation items filtered?

**Why this matters**: Adding SGA Hub (ID 8) and SGA Management (ID 9) must fit existing structure.

---

## Section 6: Type Definitions

### 6.1 Existing Type Patterns
**Question**: Examine `src/types/dashboard.ts` and `src/types/user.ts`:
- What naming conventions are used?
- How are optional fields marked?
- Are there existing date string types?
- How are API response types structured?

**Why this matters**: New types should be consistent.

---

### 6.2 BigQuery Raw Types
**Question**: Does `src/types/bigquery-raw.ts` exist?
- What helper functions are exported? (`toNumber`, `toString`, etc.)
- How are BigQuery date/timestamp values typed?

**Why this matters**: Transform functions reference these helpers.

---

## Section 7: Testing & Verification

### 7.1 Test Environment
**Question**: 
- Is there a test database configured?
- Are there existing tests in the project?
- What testing framework is used (Jest, Vitest, etc.)?

**Files to examine**:
- `package.json` (test scripts)
- `jest.config.js` or `vitest.config.ts`
- `__tests__/` or `*.test.ts` files

**Why this matters**: Verification steps may need adjustment.

---

### 7.2 MCP Availability
**Question**: 
- Is MCP (Model Context Protocol) available for BigQuery?
- What is the connection method?
- Can you run a test query to verify?

**Test Query**:
```sql
SELECT 1 as test_value
```

**Why this matters**: Phase 0 verification steps depend on MCP.

---

## Section 8: Edge Cases & Error Scenarios

### 8.1 User Without SGA Data
**Question**: What should happen if:
- A user has SGA role but no records in BigQuery (`SGA_Owner_Name__c` not found)?
- A user's Prisma `name` doesn't match any BigQuery `SGA_Owner_Name__c`?

**Current implementation assumption**: Returns empty arrays. Is this correct?

---

### 8.2 Missing Prisma User Fields
**Question**: Does the User model have a `name` field?
- What is the exact field name?
- Is it required or optional?
- What is the data type?

**Why this matters**: The implementation assumes `user.name` exists.

---

### 8.3 Date Boundary Handling
**Question**: For weekly actuals query, when `endDate` is a Sunday:
- Should Sunday records be included?
- Is `<= @endDate` sufficient for DATE fields?
- Is `<= TIMESTAMP(CONCAT(@endDate, ' 23:59:59'))` needed for TIMESTAMP fields?

**Why this matters**: Edge case can cause off-by-one errors.

---

## Section 9: Deployment & Environment

### 9.1 Environment Variables
**Question**: What BigQuery-related environment variables are configured?
- Google Cloud project ID
- Service account credentials path
- BigQuery dataset names

**Files to examine**:
- `.env.example` or `.env.local` (structure only)
- `src/lib/bigquery.ts` (what it expects)

**Why this matters**: Queries must use correct project/dataset paths.

---

### 9.2 Build Configuration
**Question**: 
- What Node.js version is required?
- Are there any special build scripts?
- What is in `.nvmrc` if it exists?

**Files to examine**:
- `package.json` (engines field)
- `.nvmrc`

**Why this matters**: Compatibility issues can cause build failures.

---

## Section 10: Implementation Document Gaps

### 10.1 Missing API Endpoints
**Question**: The implementation document mentions these API routes but may not have full specifications:
- `/api/sga-hub/closed-lost/route.ts` - GET or POST handler details?
- `/api/sga-hub/quarterly-progress/route.ts` - Full implementation?
- `/api/sga-hub/sqo-details/route.ts` - Full implementation?
- `/api/admin/sga-overview/route.ts` - Full implementation?

**Are these fully specified in Phases 6-8?**

---

### 10.2 Missing Component Specifications
**Question**: These components are mentioned but may lack full code:
- `WeeklyGoalEditor.tsx` - Full modal implementation?
- `ClosedLostTable.tsx` - Full table with filtering?
- `QuarterlyProgressCard.tsx` - Full progress display?
- `QuarterlyProgressChart.tsx` - Recharts implementation?
- `SQODetailTable.tsx` - Full table implementation?

**Are these fully specified in Phases 5-7?**

---

### 10.3 Missing Export Functions
**Question**: Phase 8 mentions export functionality:
- CSV export for weekly goals
- CSV export for quarterly goals
- CSV export for closed lost records

**Is the full implementation provided?**

---

## Summary Checklist for Cursor.ai

After answering all questions above, complete this checklist:

### Codebase Verification
- [ ] All import paths verified correct
- [ ] All function signatures match
- [ ] All constant names verified
- [ ] All type definitions compatible

### BigQuery Verification
- [ ] All field names verified
- [ ] All data types confirmed (DATE vs TIMESTAMP)
- [ ] All view names verified
- [ ] SGA name mapping confirmed

### Permission System Verification
- [ ] Role names verified
- [ ] Permission function verified
- [ ] Page ID system understood

### Missing Specifications Identified
- [ ] List any components needing more detail
- [ ] List any API routes needing more detail
- [ ] List any queries needing correction

---

## Updates Required

After completing the validation, document any required updates here:

### Updates to SGA_HUB_IMPLEMENTATION.md

| Section | Line Numbers | Issue | Correction |
|---------|--------------|-------|------------|
| | | | |
| | | | |
| | | | |

### New Information Discovered

| Topic | Finding | Impact |
|-------|---------|--------|
| | | |
| | | |

---

**Once all questions are answered and the table above is filled in, proceed to update `SGA_HUB_IMPLEMENTATION.md` with corrections, then begin Phase 0.**
