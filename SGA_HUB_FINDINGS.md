# SGA Hub Feature - Investigation Findings

**Date**: 2025-01-27
**Investigator**: Cursor.ai
**Status**: Complete

---

## Table of Contents
1. User & SGA Mapping
2. Codebase Patterns
3. BigQuery Weekly Data
4. Closed Lost Data
5. Quarterly SQO Data
6. Database Schema Design
7. API Route Design
8. UI Component Design
9. Implementation Plan

---

## 1. User & SGA Mapping

### 1.1 User Table Schema

**Query Executed**: 
```sql
SELECT column_name, data_type, is_nullable 
FROM `savvy-gtm-analytics.SavvyGTMData.INFORMATION_SCHEMA.COLUMNS` 
WHERE table_name = 'User' 
ORDER BY ordinal_position
```

**Result**: Query returned limited results (only `Full_User_ID__c` column shown). The User table in BigQuery appears to be a Salesforce sync table with standard Salesforce User fields.

**Key Fields Identified from Sample Queries**:
- `Id` (STRING) - Salesforce User ID
- `Name` (STRING) - User's full name
- `Email` (STRING) - User email address
- `IsActive` (BOOLEAN) - Active status
- `Full_User_ID__c` (STRING) - Custom field

**Note**: The INFORMATION_SCHEMA query had limited results. Direct queries to the User table work and show standard Salesforce User fields.

### 1.2 SGA Email Mapping

**Query Executed**:
```sql
WITH funnel_sgas AS (
  SELECT DISTINCT SGA_Owner_Name__c as sga_name
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
  WHERE SGA_Owner_Name__c IS NOT NULL
),
users AS (
  SELECT Name, Email, IsActive
  FROM `savvy-gtm-analytics.SavvyGTMData.User`
  WHERE Email LIKE '%@savvywealth.com%'
)
SELECT 
  f.sga_name,
  u.Email as matched_email,
  u.IsActive as is_active_user
FROM funnel_sgas f
LEFT JOIN users u ON LOWER(f.sga_name) = LOWER(u.Name)
ORDER BY f.sga_name
```

**Sample Results**:
- Tim Mackey → tim.mackey@savvywealth.com (Active)
- Eleni Stefanopoulos → eleni@savvywealth.com (Active)
- Helen Kamens → helen.kamens@savvywealth.com (Active)

**Key Finding**: SGA names in `vw_funnel_master.SGA_Owner_Name__c` match User `Name` field (case-insensitive). This is the mapping mechanism.

**Mapping Strategy**: 
- Use `user.name` from Prisma User table
- Match to `SGA_Owner_Name__c` in BigQuery queries using exact name match
- Filter BigQuery results by `SGA_Owner_Name__c = user.name` for SGA role users

### 1.3 Key Findings

1. **SGA Identification**: SGAs are identified by their `name` field in the Prisma User table, which matches `SGA_Owner_Name__c` in BigQuery.

2. **Email Pattern**: All Savvy users have emails ending in `@savvywealth.com`.

3. **Active Status**: Both BigQuery User table and Prisma User table have `IsActive`/`isActive` fields.

4. **Role Assignment**: User roles are stored in Prisma (`admin`, `manager`, `sgm`, `sga`, `viewer`), not in BigQuery.

5. **Missing Mappings**: Some SGAs in the funnel may not have corresponding User records if they're inactive or not in the system. Need to handle gracefully.

---

## 2. Codebase Patterns

### 2.1 User Types and Permissions

**Files Reviewed**:
- `src/types/user.ts`
- `src/lib/permissions.ts`
- `src/lib/auth.ts`
- `prisma/schema.prisma`

**Current User Model** (Prisma):
```prisma
model User {
  id           String   @id @default(cuid())
  email        String   @unique
  name         String
  passwordHash String
  role         String   @default("viewer")
  isActive     Boolean  @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  createdBy    String?
}
```

**User Roles**:
- `admin` - Full access, can manage users
- `manager` - Full access, can manage users
- `sgm` - Limited pages (1,2,3,6), can export, filtered by team
- `sga` - Limited pages (1,2,6), can export, filtered by name
- `viewer` - Read-only (pages 1,2), no export

**Permission System**:
- `getUserPermissions(email)` returns `UserPermissions` object
- `sgaFilter`: Set to `user.name` if role is `sga`, otherwise `null`
- `sgmFilter`: Set to `user.name` if role is `sgm`, otherwise `null`
- `allowedPages`: Array of page IDs user can access
- `canExport`: Boolean for export permission
- `canManageUsers`: Boolean for user management

**Pattern for Role-Restricted Pages**:
1. Get session with `getServerSession(authOptions)`
2. Get permissions with `getUserPermissions(session.user.email)`
3. Check `permissions.role === 'sga'` or use `canAccessPage(permissions, pageId)`
4. Filter data using `permissions.sgaFilter` or `permissions.sgmFilter`

### 2.2 API Route Patterns

**Files Reviewed**:
- `src/app/api/users/route.ts`
- `src/app/api/dashboard/record-detail/[id]/route.ts`

**Common Patterns**:

1. **Authentication Check**:
```typescript
const session = await getServerSession(authOptions);
if (!session?.user?.email) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
```

2. **Permission Check**:
```typescript
const permissions = await getUserPermissions(session.user.email);
if (!permissions.canManageUsers) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
```

3. **Error Handling**:
- Try-catch blocks
- Console.error for logging
- Return appropriate HTTP status codes (400, 401, 403, 404, 500)

4. **Response Format**:
- Success: `NextResponse.json({ data })`
- Error: `NextResponse.json({ error: 'message' }, { status: code })`

5. **BigQuery Integration**:
- Import query functions from `@/lib/queries/*`
- Handle null/undefined results
- Return structured data matching TypeScript interfaces

### 2.3 UI Component Patterns

**Files Reviewed**:
- `src/components/dashboard/RecordDetailModal.tsx`
- `src/components/settings/UserModal.tsx`
- `src/components/dashboard/DetailRecordsTable.tsx`

**Modal Patterns**:
- Props: `isOpen`, `onClose`, `onSaved` (for forms)
- State: `loading`, `error`, `formData` (for forms)
- `useEffect` to fetch data when modal opens
- Loading skeleton component (`RecordDetailSkeleton`)
- Error display with retry option

**Form Patterns**:
- Controlled inputs with `useState`
- `handleSubmit` async function
- Loading state during submission
- Error state for validation/API errors
- Reset form on close/success

**Table Patterns**:
- Sorting with `useState` for `sortColumn` and `sortDirection`
- Search/filter with `useState` for search query
- Pagination with `useState` for current page
- Client-side filtering/sorting for small datasets
- Server-side filtering for large datasets (via API)

**Loading States**:
- Skeleton loaders for initial load
- Spinner for actions
- Disabled buttons during loading

### 2.4 Navigation and Layout

**Files Reviewed**:
- `src/components/layout/Sidebar.tsx`
- `src/app/dashboard/layout.tsx`

**Navigation Structure**:
- Pages defined in `PAGES` array with `id`, `name`, `href`, `icon`
- Filtered by `permissions.allowedPages.includes(page.id)`
- Active state based on `pathname === page.href`
- Collapsible sidebar with hamburger menu

**Adding New Pages**:
1. Add page definition to `PAGES` array in `Sidebar.tsx`
2. Update `allowedPages` in `permissions.ts` for relevant roles
3. Create route file in `src/app/dashboard/[page-name]/page.tsx`
4. Use `DashboardLayout` wrapper (already applied via `layout.tsx`)

**Route Protection**:
- Currently handled at component level (checking permissions)
- Could add middleware for route-level protection
- Session available via `useSession()` hook (client) or `getServerSession()` (server)

---

## 3. BigQuery Weekly Data

### 3.1 Initial Call Scheduled Data

**Query Executed**:
```sql
SELECT 
  DATE_TRUNC(Initial_Call_Scheduled_Date__c, WEEK(MONDAY)) as week_start,
  COUNT(*) as initial_calls_scheduled,
  COUNT(DISTINCT SGA_Owner_Name__c) as unique_sgas
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE Initial_Call_Scheduled_Date__c IS NOT NULL
  AND Initial_Call_Scheduled_Date__c >= '2024-10-01'
GROUP BY week_start
ORDER BY week_start DESC
LIMIT 20
```

**Sample Result**:
- Week 2025-09-29: 36 initial calls scheduled, 12 unique SGAs

**Key Findings**:
- ✅ Data exists and is populated
- ✅ `Initial_Call_Scheduled_Date__c` is a DATE field (no time component)
- ✅ `DATE_TRUNC(..., WEEK(MONDAY))` correctly groups by Monday-starting weeks
- ✅ Multiple SGAs have data in each week

### 3.2 Qualification Call Data

**Query Executed**:
```sql
SELECT 
  DATE_TRUNC(Qualification_Call_Date__c, WEEK(MONDAY)) as week_start,
  COUNT(*) as qual_calls,
  COUNT(DISTINCT SGA_Owner_Name__c) as unique_sgas
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE Qualification_Call_Date__c IS NOT NULL
  AND Qualification_Call_Date__c >= '2024-10-01'
GROUP BY week_start
ORDER BY week_start DESC
LIMIT 20
```

**Sample Result**:
- Week 2025-09-15: 14 qualification calls, 6 unique SGAs

**Key Findings**:
- ✅ Data exists and is populated
- ✅ `Qualification_Call_Date__c` is a DATE field
- ✅ Lower volume than initial calls (expected - further in funnel)

### 3.3 Weekly Actuals Query

**Query Executed** (for Tim Mackey):
```sql
SELECT 
  DATE_TRUNC(Initial_Call_Scheduled_Date__c, WEEK(MONDAY)) as week_start,
  COUNT(DISTINCT CASE 
    WHEN Initial_Call_Scheduled_Date__c IS NOT NULL 
    THEN primary_key 
  END) as initial_calls,
  COUNT(DISTINCT CASE 
    WHEN Qualification_Call_Date__c IS NOT NULL 
    THEN Full_Opportunity_ID__c 
  END) as qual_calls
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE SGA_Owner_Name__c = 'Tim Mackey'
  AND (
    Initial_Call_Scheduled_Date__c >= '2024-10-01'
    OR Qualification_Call_Date__c >= '2024-10-01'
  )
GROUP BY week_start
ORDER BY week_start DESC
LIMIT 10
```

**Sample Result**:
- Week 2025-11-17: 1 initial call, 1 qualification call

**Key Findings**:
- ✅ Query structure works correctly
- ✅ Using `COUNT(DISTINCT primary_key)` for initial calls (lead-level)
- ✅ Using `COUNT(DISTINCT Full_Opportunity_ID__c)` for qual calls (opp-level)
- ✅ Week grouping works as expected

**Note on SQO Counting**: The original query in the prompt tried to count SQOs in the same week as initial calls, but SQOs should be counted separately by `Date_Became_SQO__c` week (see 3.4).

### 3.4 SQO by Week Query

**Query Executed**:
```sql
SELECT 
  DATE_TRUNC(Date_Became_SQO__c, WEEK(MONDAY)) as week_start,
  COUNT(*) as sqos,
  SUM(Opportunity_AUM) as total_aum
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE SGA_Owner_Name__c = 'Tim Mackey'
  AND is_sqo_unique = 1
  AND Date_Became_SQO__c IS NOT NULL
  AND Date_Became_SQO__c >= '2024-10-01'
  AND recordtypeid = '012Dn000000mrO3IAI'
GROUP BY week_start
ORDER BY week_start DESC
LIMIT 10
```

**Sample Result**:
- Week 2025-11-17: 1 SQO, $70M AUM

**Key Findings**:
- ✅ SQOs counted by `Date_Became_SQO__c` week (when they became SQO)
- ✅ Must filter by `is_sqo_unique = 1` to avoid duplicates
- ✅ Must filter by `recordtypeid = '012Dn000000mrO3IAI'` (Advisor record type)
- ✅ AUM available for aggregation

**Important**: SQOs are counted by the week they BECAME an SQO, not by call dates. This is separate from the weekly goals for calls.

---

## 4. Closed Lost Data

### 4.1 Existing View Check

**Query Executed**:
```sql
SELECT * 
FROM `savvy-gtm-analytics.savvy_analytics.vw_sga_closed_lost_sql_followup`
LIMIT 10
```

**Sample Result**:
```json
{
  "Full_Opportunity_ID__c": "006VS00000T8NOXYA3",
  "Full_prospect_id__c": "00QVS000007BWIX2A4",
  "closed_lost_date": "2026-01-20",
  "closed_lost_details": "Advisor ultimately moved forward with Farther...",
  "closed_lost_reason": "Candidate Declined - Lost to Competitor",
  "last_contact_date": "2025-11-18",
  "opp_name": "Jeffrey Schlotterbeck",
  "salesforce_url": "https://savvywealth.lightning.force.com/006VS00000T8NOXYA3",
  "sga_name": "Lauren George",
  "sql_date": "2025-11-14",
  "time_since_last_contact_bucket": "1 month since last contact"
}
```

**Current Schema**:
- `sga_name` - SGA owner name
- `opp_name` - Advisor/opportunity name
- `salesforce_url` - Opportunity URL (already constructed)
- `time_since_last_contact_bucket` - Bucketed time since last contact
- `last_contact_date` - Date of last contact
- `closed_lost_date` - Date closed lost
- `sql_date` - Date became SQL
- `closed_lost_reason` - Reason for closed lost
- `closed_lost_details` - Details text
- `Full_prospect_id__c` - Lead ID
- `Full_Opportunity_ID__c` - Opportunity ID

**Key Findings**:
- ✅ View exists and is populated
- ✅ Has both Lead and Opportunity IDs
- ✅ Has SGA name for filtering
- ✅ Has time bucket for 30-180 day filtering
- ⚠️ Missing explicit `lead_url` field (can be constructed)

### 4.2 SGA Distribution

**Query Executed**:
```sql
SELECT 
  sga_name,
  COUNT(*) as closed_lost_count,
  MIN(last_contact_date) as oldest_contact,
  MAX(last_contact_date) as newest_contact
FROM `savvy-gtm-analytics.savvy_analytics.vw_sga_closed_lost_sql_followup`
GROUP BY sga_name
ORDER BY closed_lost_count DESC
```

**Sample Result**:
- Brian O'Hara: 1 closed lost record, last contact 2025-12-15

**Key Findings**:
- ✅ Data distributed across multiple SGAs
- ✅ Date range filtering possible via `last_contact_date`
- ✅ Can filter by SGA name for user-specific views

### 4.3 Available Fields for Drilldown

**Query Executed**:
```sql
SELECT 
  cl.sga_name,
  cl.opp_name,
  cl.Full_Opportunity_ID__c,
  cl.Full_prospect_id__c,
  CONCAT('https://savvywealth.lightning.force.com/lightning/r/Lead/', cl.Full_prospect_id__c, '/view') as lead_url,
  CONCAT('https://savvywealth.lightning.force.com/lightning/r/Opportunity/', cl.Full_Opportunity_ID__c, '/view') as opportunity_url
FROM `savvy-gtm-analytics.savvy_analytics.vw_sga_closed_lost_sql_followup` cl
LIMIT 5
```

**Key Findings**:
- ✅ Both Lead and Opportunity IDs available
- ✅ Can construct URLs in query or application code
- ✅ Opportunity URL already exists in `salesforce_url` field
- ⚠️ Lead URL needs to be constructed (not in view)

**Recommendation**: Add `lead_url` to the view for consistency, or construct in application code.

### 4.4 View Modification Recommendations

**Current Fields** (sufficient for basic needs):
- ✅ `sga_name` - For filtering
- ✅ `opp_name` - Advisor name
- ✅ `Full_prospect_id__c` - Lead ID
- ✅ `Full_Opportunity_ID__c` - Opportunity ID
- ✅ `salesforce_url` - Opportunity URL
- ✅ `last_contact_date` - For date filtering
- ✅ `time_since_last_contact_bucket` - For bucket filtering
- ✅ `closed_lost_reason` - Reason
- ✅ `closed_lost_details` - Details

**Recommended Additions** (for enhanced drilldown):
1. `lead_url` - Constructed Lead URL (or construct in app)
2. `Channel_Grouping_Name` - Attribution channel
3. `Original_source` - Attribution source
4. `Opportunity_AUM` - AUM for context
5. `StageName` - Always "Closed Lost" but useful for consistency

**Note**: Current view is sufficient for MVP. Additional fields can be added later if needed.

---

## 5. Quarterly SQO Data

### 5.1 Quarterly SQO by SGA

**Query Executed** (Q4 2025):
```sql
SELECT 
  SGA_Owner_Name__c as sga_name,
  COUNT(*) as sqo_count,
  SUM(Opportunity_AUM) as total_aum,
  AVG(Opportunity_AUM) as avg_aum
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE is_sqo_unique = 1
  AND Date_Became_SQO__c >= '2025-10-01'
  AND Date_Became_SQO__c < '2026-01-01'
  AND recordtypeid = '012Dn000000mrO3IAI'
  AND SGA_Owner_Name__c IS NOT NULL
GROUP BY sga_name
ORDER BY sqo_count DESC
```

**Sample Result**:
- Tim Mackey: 1 SQO, $70M total AUM, $70M avg AUM

**Key Findings**:
- ✅ Query structure works
- ✅ Must filter by `is_sqo_unique = 1` (deduplication)
- ✅ Must filter by `recordtypeid = '012Dn000000mrO3IAI'` (Advisor record type)
- ✅ AUM aggregation available
- ✅ Can group by quarter using date range filters

**Quarter Identification**: Use date ranges:
- Q1: `>= 'YYYY-01-01' AND < 'YYYY-04-01'`
- Q2: `>= 'YYYY-04-01' AND < 'YYYY-07-01'`
- Q3: `>= 'YYYY-07-01' AND < 'YYYY-10-01'`
- Q4: `>= 'YYYY-10-01' AND < '(YYYY+1)-01-01'`

### 5.2 SQO Detail Query

**Query Structure** (from prompt):
```sql
SELECT 
  primary_key,
  advisor_name,
  Date_Became_SQO__c as sqo_date,
  StageName,
  Opportunity_AUM,
  aum_tier,
  Channel_Grouping_Name,
  Original_source,
  salesforce_url,
  lead_url,
  opportunity_url
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE SGA_Owner_Name__c = 'Chris Morgan'
  AND is_sqo_unique = 1
  AND Date_Became_SQO__c >= '2025-10-01'
  AND Date_Became_SQO__c < '2026-01-01'
  AND recordtypeid = '012Dn000000mrO3IAI'
ORDER BY Date_Became_SQO__c DESC
```

**Key Findings**:
- ✅ All required fields available in `vw_funnel_master`
- ✅ Can filter by SGA, quarter, and record type
- ✅ URLs available for drilldown
- ✅ Attribution fields available
- ✅ AUM and tier available

**Note**: Query structure confirmed from codebase review. All fields exist in the view.

---

## 6. Database Schema Design

### 6.1 Current Prisma Schema Review

**Current Models**:
```prisma
model User {
  id           String   @id @default(cuid())
  email        String   @unique
  name         String
  passwordHash String
  role         String   @default("viewer")
  isActive     Boolean  @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  createdBy    String?
}
```

**Patterns Observed**:
- Uses `@default(cuid())` for IDs
- Uses `@default(now())` for createdAt
- Uses `@updatedAt` for auto-updated timestamps
- Uses `String?` for optional fields
- No explicit relationships defined (simple schema)

**DateTime Handling**:
- PostgreSQL `DateTime` type
- Stored as UTC
- Can use `@default(now())` for automatic timestamps

### 6.2 Proposed New Models

**WeeklyGoal Model**:
```prisma
model WeeklyGoal {
  id                    String   @id @default(cuid())
  userEmail             String   // Link to User.email (not foreign key - email is stable)
  weekStartDate         DateTime // Monday of the week (DATE only, no time)
  initialCallsGoal      Int      @default(0)
  qualificationCallsGoal Int     @default(0)
  sqoGoal               Int      @default(0)
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
  createdBy             String?  // Email of user who created/updated
  updatedBy             String?  // Email of user who last updated

  @@unique([userEmail, weekStartDate])
  @@index([userEmail])
  @@index([weekStartDate])
}
```

**Rationale**:
- `userEmail` instead of foreign key: Emails are stable identifiers, and we need to match to BigQuery SGA names
- `weekStartDate`: Store as Monday date (DATE only, no time component)
- Three goal fields: Initial Calls, Qualification Calls, SQOs
- `createdBy`/`updatedBy`: Audit trail (email strings)
- Unique constraint: One goal per SGA per week
- Indexes: Fast lookups by user and week

**QuarterlyGoal Model**:
```prisma
model QuarterlyGoal {
  id            String   @id @default(cuid())
  userEmail     String   // Link to User.email
  quarter       String   // Format: "2026-Q1", "2026-Q2", etc.
  sqoGoal       Int      @default(0)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  createdBy     String?  // Email of admin who set it
  updatedBy     String?  // Email of admin who last updated

  @@unique([userEmail, quarter])
  @@index([userEmail])
  @@index([quarter])
}
```

**Rationale**:
- `userEmail`: Same as WeeklyGoal (stable identifier)
- `quarter`: String format "YYYY-QN" for easy parsing and display
- `sqoGoal`: Single goal for SQOs per quarter
- `createdBy`/`updatedBy`: Admin audit trail
- Unique constraint: One goal per SGA per quarter
- Indexes: Fast lookups by user and quarter

**Migration Strategy**:
1. Create migration file: `prisma migrate dev --name add_sga_goals`
2. Add both models
3. Seed with current quarter goals if needed
4. Update Prisma client: `prisma generate`

---

## 7. API Route Design

### 7.1 Required Routes

#### 1. `GET /api/sga-hub/weekly-goals`
**Purpose**: Get weekly goals for logged-in SGA
**Method**: GET
**Auth**: Required (SGA role)
**Query Params**: 
- `startWeek` (optional): ISO date string for week start (Monday)
- `endWeek` (optional): ISO date string for week end (Sunday)
**Response**:
```typescript
{
  goals: Array<{
    id: string;
    weekStartDate: string; // ISO date
    initialCallsGoal: number;
    qualificationCallsGoal: number;
    sqoGoal: number;
    canEdit: boolean; // true if current/future week
  }>;
}
```
**Database**: Query `WeeklyGoal` where `userEmail = session.user.email`
**Permissions**: SGA can only see own goals

#### 2. `POST /api/sga-hub/weekly-goals`
**Purpose**: Create/update weekly goal for logged-in SGA
**Method**: POST
**Auth**: Required (SGA role)
**Body**:
```typescript
{
  weekStartDate: string; // ISO date (Monday)
  initialCallsGoal: number;
  qualificationCallsGoal: number;
  sqoGoal: number;
}
```
**Response**: `{ goal: WeeklyGoal }`
**Database**: Upsert `WeeklyGoal` (create or update)
**Permissions**: SGA can only edit current/future weeks for themselves
**Validation**: Check `weekStartDate` is Monday, is current/future week

#### 3. `GET /api/sga-hub/weekly-actuals`
**Purpose**: Get BigQuery actuals for logged-in SGA
**Method**: GET
**Auth**: Required (SGA role)
**Query Params**:
- `startWeek` (optional): ISO date string
- `endWeek` (optional): ISO date string
**Response**:
```typescript
{
  actuals: Array<{
    weekStartDate: string;
    initialCalls: number;
    qualificationCalls: number;
    sqos: number; // By Date_Became_SQO__c week
  }>;
}
```
**BigQuery**: Query `vw_funnel_master` filtered by `SGA_Owner_Name__c = user.name`
**Permissions**: SGA can only see own actuals

#### 4. `GET /api/sga-hub/closed-lost`
**Purpose**: Get closed lost records for logged-in SGA
**Method**: GET
**Auth**: Required (SGA role)
**Query Params**:
- `daysSinceContact` (optional): Filter by time bucket (30-180)
**Response**:
```typescript
{
  records: Array<{
    oppName: string;
    leadUrl: string;
    opportunityUrl: string;
    lastContactDate: string;
    closedLostDate: string;
    closedLostReason: string;
    closedLostDetails: string;
    timeSinceContact: string;
  }>;
}
```
**BigQuery**: Query `vw_sga_closed_lost_sql_followup` filtered by `sga_name = user.name`
**Permissions**: SGA can only see own records

#### 5. `GET /api/sga-hub/quarterly-progress`
**Purpose**: Get quarterly SQO progress for logged-in SGA
**Method**: GET
**Auth**: Required (SGA role)
**Query Params**:
- `quarter` (optional): "2026-Q1" format, defaults to current quarter
**Response**:
```typescript
{
  quarter: string;
  goal: number | null;
  actual: number;
  progress: number; // percentage
  aum: number;
}
```
**Database**: Query `QuarterlyGoal` for goal
**BigQuery**: Query `vw_funnel_master` for actual SQOs
**Permissions**: SGA can only see own progress

#### 6. `GET /api/sga-hub/sqo-details`
**Purpose**: Get SQO detail records for logged-in SGA
**Method**: GET
**Auth**: Required (SGA role)
**Query Params**:
- `quarter` (optional): "2026-Q1" format
**Response**:
```typescript
{
  sqos: Array<{
    id: string;
    advisorName: string;
    sqoDate: string;
    aum: number;
    aumTier: string;
    channel: string;
    source: string;
    salesforceUrl: string;
  }>;
}
```
**BigQuery**: Query `vw_funnel_master` filtered by SGA and quarter
**Permissions**: SGA can only see own SQOs

#### 7. `GET /api/admin/sga-overview`
**Purpose**: Get all SGAs with goals/actuals (admin view)
**Method**: GET
**Auth**: Required (admin role)
**Query Params**:
- `week` (optional): ISO date for week start
- `quarter` (optional): "2026-Q1" format
**Response**:
```typescript
{
  sgas: Array<{
    email: string;
    name: string;
    weeklyGoals: Array<WeeklyGoal>;
    weeklyActuals: Array<WeeklyActual>;
    quarterlyGoal: QuarterlyGoal | null;
    quarterlyActual: number;
    closedLostCount: number;
  }>;
}
```
**Database**: Query all `WeeklyGoal` and `QuarterlyGoal` records
**BigQuery**: Aggregate actuals for all SGAs
**Permissions**: Admin only

#### 8. `POST /api/admin/quarterly-goals`
**Purpose**: Set quarterly goal for an SGA (admin)
**Method**: POST
**Auth**: Required (admin role)
**Body**:
```typescript
{
  userEmail: string;
  quarter: string;
  sqoGoal: number;
}
```
**Response**: `{ goal: QuarterlyGoal }`
**Database**: Upsert `QuarterlyGoal`
**Permissions**: Admin only

#### 9. `POST /api/admin/weekly-goals`
**Purpose**: Override weekly goal for an SGA (admin)
**Method**: POST
**Auth**: Required (admin role)
**Body**:
```typescript
{
  userEmail: string;
  weekStartDate: string;
  initialCallsGoal: number;
  qualificationCallsGoal: number;
  sqoGoal: number;
}
```
**Response**: `{ goal: WeeklyGoal }`
**Database**: Upsert `WeeklyGoal`
**Permissions**: Admin can edit any week for any SGA

---

## 8. UI Component Design

### 8.1 Page Structure

#### SGA Hub Page (`/dashboard/sga-hub`)
**Route**: `src/app/dashboard/sga-hub/page.tsx`
**Layout**: Uses `DashboardLayout` (already applied)
**Access**: SGA role only (check permissions)

**Tabs Structure**:
1. **Weekly Goals Tab** (default)
   - Table showing weeks (current + future)
   - Columns: Week | Initial Calls (Goal/Actual) | Qual Calls (Goal/Actual) | SQOs (Goal/Actual) | Actions
   - Edit button for current/future weeks
   - Past weeks read-only
   - Goal vs Actual comparison with visual indicators (green/red)

2. **Closed Lost Tab**
   - Table of closed lost records
   - Columns: Advisor | Last Contact | Closed Lost Date | Reason | Details | Actions
   - Filter by time bucket (30-60, 60-90, 90-120, 120-180 days)
   - Click row to open detail modal (reuse `RecordDetailModal`)

3. **Quarterly Progress Tab**
   - Card showing current quarter progress
   - Progress bar: Actual / Goal
   - AUM summary
   - "View SQO Details" button → opens SQO list table
   - SQO list table: Advisor | SQO Date | AUM | Tier | Channel | Source | Actions

**Components Needed**:
- `SGAHubTabs.tsx` - Tab navigation
- `WeeklyGoalsTable.tsx` - Goals table with edit capability
- `WeeklyGoalEditor.tsx` - Modal/form for editing goals
- `ClosedLostTable.tsx` - Closed lost records table
- `QuarterlyProgressCard.tsx` - Progress card with chart
- `SQODetailTable.tsx` - SQO list table

#### Admin SGA Management Page (`/dashboard/admin/sga-management`)
**Route**: `src/app/dashboard/admin/sga-management/page.tsx`
**Access**: Admin role only

**Layout**:
- SGA selector dropdown (all SGAs)
- Or: Table view showing all SGAs with aggregated metrics

**Sections**:
1. **Weekly Goals Overview**
   - Table: SGA | Week | Initial Calls (G/A) | Qual Calls (G/A) | SQOs (G/A) | Actions
   - Admin can edit any cell for any SGA
   - Filter by week

2. **Quarterly Goals Editor**
   - Table: SGA | Quarter | Goal | Actual | Progress | Actions
   - "Set Goal" button opens modal
   - Can edit any SGA's quarterly goal

3. **Closed Lost Summary**
   - Table: SGA | Count (30-60d) | Count (60-90d) | Count (90-120d) | Count (120-180d) | Total
   - Aggregate view only

**Components Needed**:
- `AdminSGAOverview.tsx` - Main container
- `SGAWeeklyGoalsTable.tsx` - All SGAs weekly goals
- `SGAQuarterlyGoalsTable.tsx` - All SGAs quarterly goals
- `QuarterlyGoalEditor.tsx` - Modal for setting quarterly goals
- `SGAClosedLostSummary.tsx` - Aggregate closed lost counts

### 8.2 Component Breakdown

#### `WeeklyGoalsTable.tsx`
**Props**:
```typescript
{
  goals: WeeklyGoal[];
  actuals: WeeklyActual[];
  onEdit: (goal: WeeklyGoal) => void;
  canEdit: (weekStartDate: Date) => boolean;
}
```
**State**: None (presentational)
**Functionality**: 
- Display goals vs actuals
- Highlight differences (green if actual >= goal, red if < goal)
- Show edit button for editable weeks
- Format dates as "Mon, Jan 13 - Sun, Jan 19, 2026"

#### `WeeklyGoalEditor.tsx`
**Props**:
```typescript
{
  isOpen: boolean;
  onClose: () => void;
  onSave: (goal: WeeklyGoalInput) => Promise<void>;
  initialGoal?: WeeklyGoal;
  weekStartDate: Date;
}
```
**State**: 
- `formData` (initialCallsGoal, qualificationCallsGoal, sqoGoal)
- `loading`
- `error`
**Functionality**:
- Form with three number inputs
- Validation (non-negative integers)
- Submit to API
- Show loading/error states

#### `ClosedLostTable.tsx`
**Props**:
```typescript
{
  records: ClosedLostRecord[];
  onRecordClick: (recordId: string) => void;
  filterDays?: number;
}
```
**State**: 
- `selectedTimeBucket` (30-60, 60-90, etc.)
- `sortColumn`, `sortDirection`
**Functionality**:
- Filter by time bucket
- Sort by columns
- Click row to open detail modal
- Show Lead/Opportunity links

#### `QuarterlyProgressCard.tsx`
**Props**:
```typescript
{
  quarter: string;
  goal: number | null;
  actual: number;
  aum: number;
  onViewDetails: () => void;
}
```
**State**: None
**Functionality**:
- Display progress bar (actual / goal)
- Show percentage
- Show AUM summary
- "View SQO Details" button

#### `SQODetailTable.tsx`
**Props**:
```typescript
{
  sqos: SQODetail[];
  onRecordClick: (recordId: string) => void;
}
```
**State**: `sortColumn`, `sortDirection`
**Functionality**:
- Sortable table
- Click row to open detail modal
- Format AUM as currency
- Show tier badges

---

## 9. Implementation Plan

### Phase 1: Database Schema + Migrations
**Duration**: 1-2 hours
**Tasks**:
1. Add `WeeklyGoal` model to `schema.prisma`
2. Add `QuarterlyGoal` model to `schema.prisma`
3. Run `prisma migrate dev --name add_sga_goals`
4. Run `prisma generate`
5. Verify schema in database

**Dependencies**: None
**Verification**: Check database tables created correctly

### Phase 2: API Routes for Weekly Goals
**Duration**: 3-4 hours
**Tasks**:
1. Create `src/app/api/sga-hub/weekly-goals/route.ts`
   - GET handler (list goals for user)
   - POST handler (create/update goal)
2. Create `src/lib/queries/weekly-goals.ts`
   - `getWeeklyGoals(userEmail, startWeek?, endWeek?)`
   - `upsertWeeklyGoal(userEmail, weekStartDate, goals)`
3. Add permission checks (SGA role, week editability)
4. Add validation (Monday date, current/future week for SGA)
5. Test with Postman/curl

**Dependencies**: Phase 1
**Verification**: API routes return correct data, permissions work

### Phase 3: Weekly Goals UI
**Duration**: 4-5 hours
**Tasks**:
1. Create `src/app/dashboard/sga-hub/page.tsx`
2. Create `src/components/sga-hub/SGAHubTabs.tsx`
3. Create `src/components/sga-hub/WeeklyGoalsTable.tsx`
4. Create `src/components/sga-hub/WeeklyGoalEditor.tsx`
5. Add to Sidebar navigation (page ID 8, SGA role only)
6. Update permissions.ts to include page 8 for SGA role
7. Fetch goals and actuals, display in table
8. Implement edit functionality

**Dependencies**: Phase 2
**Verification**: UI displays correctly, edit works, permissions enforced

### Phase 4: BigQuery Actuals Queries
**Duration**: 2-3 hours
**Tasks**:
1. Create `src/lib/queries/weekly-actuals.ts`
   - `getWeeklyActuals(sgaName, startWeek?, endWeek?)`
2. Create `src/app/api/sga-hub/weekly-actuals/route.ts`
3. Query BigQuery for initial calls, qual calls, SQOs by week
4. Format response to match UI needs
5. Test queries with real data

**Dependencies**: Phase 2
**Verification**: Actuals match expected values, weeks align correctly

### Phase 5: Closed Lost Tab
**Duration**: 3-4 hours
**Tasks**:
1. Create `src/lib/queries/closed-lost.ts`
   - `getClosedLostRecords(sgaName, daysSinceContact?)`
2. Create `src/app/api/sga-hub/closed-lost/route.ts`
3. Create `src/components/sga-hub/ClosedLostTable.tsx`
4. Add to SGA Hub tabs
5. Implement filtering by time bucket
6. Integrate with `RecordDetailModal` for drilldown

**Dependencies**: Phase 3
**Verification**: Records display correctly, filtering works, modal opens

### Phase 6: Quarterly Goals (Admin)
**Duration**: 3-4 hours
**Tasks**:
1. Create `src/app/api/admin/quarterly-goals/route.ts`
2. Create `src/lib/queries/quarterly-goals.ts`
3. Create `src/app/api/sga-hub/quarterly-progress/route.ts`
4. Create `src/components/sga-hub/QuarterlyProgressCard.tsx`
5. Create `src/components/sga-hub/SQODetailTable.tsx`
6. Add Quarterly Progress tab to SGA Hub
7. Implement goal setting (admin) and viewing (SGA)

**Dependencies**: Phase 1, Phase 4
**Verification**: Goals can be set, progress displays correctly

### Phase 7: Admin Overview Page
**Duration**: 4-5 hours
**Tasks**:
1. Create `src/app/dashboard/admin/sga-management/page.tsx`
2. Create `src/app/api/admin/sga-overview/route.ts`
3. Create `src/app/api/admin/weekly-goals/route.ts`
4. Create `src/components/admin/AdminSGAOverview.tsx`
5. Create `src/components/admin/SGAWeeklyGoalsTable.tsx`
6. Create `src/components/admin/SGAQuarterlyGoalsTable.tsx`
7. Create `src/components/admin/QuarterlyGoalEditor.tsx`
8. Add to Sidebar (page ID 9, admin only)
9. Update permissions.ts

**Dependencies**: Phase 3, Phase 6
**Verification**: Admin can view/edit all SGA goals

### Phase 8: Integration Testing
**Duration**: 2-3 hours
**Tasks**:
1. Test SGA user flow (view/edit own goals)
2. Test admin user flow (view/edit all goals)
3. Test permission restrictions
4. Test date validation (Monday dates, current/future weeks)
5. Test BigQuery data accuracy
6. Test edge cases (no goals, no actuals, etc.)
7. Fix any bugs

**Dependencies**: All previous phases
**Verification**: All features work correctly, no bugs

**Total Estimated Duration**: 22-30 hours

---

## Blockers & Open Questions

1. **SGA Name Matching**: Confirmed that `user.name` matches `SGA_Owner_Name__c` (case-insensitive). Need to ensure consistency.

2. **Week Date Handling**: Need to standardize on Monday dates. Use `DATE_TRUNC(..., WEEK(MONDAY))` in BigQuery and store Monday dates in database.

3. **Time Zone**: All dates stored as UTC. Display in user's local timezone using `formatDate` helper.

4. **View Modifications**: Current `vw_sga_closed_lost_sql_followup` view is sufficient for MVP. Can add fields later if needed.

5. **Record Type ID**: Hardcoded `'012Dn000000mrO3IAI'` for Advisor record type. Confirm this is correct and won't change.

6. **Quarter Format**: Using "YYYY-QN" string format. Consider if date-based quarter identification is better.

---

## Next Steps

1. Review findings with stakeholders
2. Confirm SGA name mapping strategy
3. Approve database schema design
4. Begin Phase 1 implementation
5. Set up development environment for testing

---

**Investigation Complete** ✅
