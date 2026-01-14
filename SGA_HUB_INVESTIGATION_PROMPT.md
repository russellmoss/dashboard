# SGA Hub Feature - Investigation & Documentation Prompt

## 🎯 Objective

You are tasked with investigating the codebase, database schema, and BigQuery data to gather all necessary information for building the **SGA Hub** feature. Document ALL findings in a new file called `SGA_HUB_FINDINGS.md` in the project root.

---

## 📋 Feature Requirements Summary

The SGA Hub is a new dashboard section with these capabilities:

1. **Weekly Goals Tracker** (SGA-only page)
   - SGAs set weekly goals for: Initial Call Scheduled, Qualification Call Scheduled, SQO
   - View actuals vs goals by week (calendar weeks, Mon-Sun)
   - Only current/future weeks can be edited by SGAs
   - Admins can edit any week for any SGA

2. **Closed Lost Follow-Up Tab** (SGA-only page)
   - List of SQLs that are Closed Lost, 30-180 days since last contact
   - Full drilldown capability (Lead URL, Opportunity URL, all details)
   - Filtered to logged-in SGA's records

3. **Quarterly SQO Goals** (Admin-set, SGA-visible)
   - Admins set quarterly SQO targets per SGA
   - SGAs see progress against their quarterly goal
   - SQO list with full details on that page

4. **Admin SGA Management Page** (Admin-only)
   - View all SGAs: weekly goals, actuals, diffs
   - View all SGAs: closed lost counts
   - View all SGAs: quarterly SQO progress
   - Set/override goals for any SGA

---

## 🔍 Investigation Tasks

Complete each section and document your findings in `SGA_HUB_FINDINGS.md`.

---

### SECTION 1: User & SGA Mapping

**Goal**: Understand how user emails map to SGA names in BigQuery.

#### Task 1.1: Query the User Table Schema

Run this query via MCP to understand the User table:

```sql
SELECT 
  column_name, 
  data_type, 
  is_nullable
FROM `savvy-gtm-analytics.SavvyGTMData.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name = 'User'
ORDER BY ordinal_position
```

**Document**: Full schema of the User table.

#### Task 1.2: Sample User Data with SGA-Related Fields

```sql
SELECT 
  Id,
  Name,
  Email,
  IsActive,
  UserRole.Name as RoleName,
  Profile.Name as ProfileName
FROM `savvy-gtm-analytics.SavvyGTMData.User`
WHERE IsActive = TRUE
  AND Email LIKE '%@savvywealth.com%'
LIMIT 20
```

**Document**: Sample of active Savvy users with their emails and names.

#### Task 1.3: Find All SGAs with Email Mapping

We need to map SGA emails to their `SGA_Owner_Name__c` values. Run:

```sql
-- Find all unique SGAs from the funnel and try to match to User emails
WITH funnel_sgas AS (
  SELECT DISTINCT SGA_Owner_Name__c as sga_name
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
  WHERE SGA_Owner_Name__c IS NOT NULL
),
users AS (
  SELECT 
    Name,
    Email,
    IsActive
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

**Document**: Complete SGA name → email mapping. Note any SGAs without email matches.

#### Task 1.4: Verify Specific SGAs

Run a query to find these specific SGAs and their emails:
- Eleni (look for names containing "Eleni")
- Any other SGAs currently in the permissions config

```sql
SELECT 
  Name,
  Email,
  IsActive
FROM `savvy-gtm-analytics.SavvyGTMData.User`
WHERE (
  LOWER(Name) LIKE '%eleni%'
  OR LOWER(Email) LIKE '%eleni%'
)
AND Email LIKE '%@savvywealth.com%'
```

**Document**: Exact email → name mappings for all SGAs that need to use the SGA Hub.

---

### SECTION 2: Existing Codebase Patterns

**Goal**: Understand existing patterns for user roles, permissions, and data filtering.

#### Task 2.1: Review Current User Types and Permissions

Examine these files and document:

1. `src/types/user.ts` - User and UserPermissions interfaces
2. `src/lib/permissions.ts` - How permissions are assigned
3. `src/lib/auth.ts` - How authentication works
4. `prisma/schema.prisma` - Current database schema

**Document**:
- Current User model fields
- How `sgaFilter` and `sgmFilter` work
- How role-based access is implemented
- Pattern for role-restricted pages

#### Task 2.2: Review API Route Patterns

Examine these files for patterns to follow:

1. `src/app/api/users/route.ts` - CRUD pattern for users
2. `src/app/api/users/[id]/route.ts` - Single record operations
3. `src/app/api/dashboard/record-detail/[id]/route.ts` - BigQuery single record fetch

**Document**:
- How to get current user session in API routes
- How to check user permissions
- Error handling patterns
- Response format patterns

#### Task 2.3: Review UI Component Patterns

Examine these files:

1. `src/components/dashboard/RecordDetailModal.tsx` - Modal with data fetching
2. `src/components/settings/UserModal.tsx` - Form modal pattern
3. `src/app/dashboard/page.tsx` - Main dashboard structure
4. `src/components/dashboard/DetailRecordsTable.tsx` - Table with sorting, search, pagination

**Document**:
- Modal open/close patterns
- Form state management
- Table component patterns
- Loading and error states

#### Task 2.4: Review Navigation and Layout

Examine:

1. `src/components/layout/Sidebar.tsx` - Navigation structure
2. `src/app/dashboard/layout.tsx` - Dashboard layout
3. Any route protection patterns

**Document**:
- How to add new navigation items
- How to restrict routes by role
- Layout structure for new pages

---

### SECTION 3: BigQuery Data for Weekly Actuals

**Goal**: Verify we can query the data needed for weekly goal tracking.

#### Task 3.1: Verify Initial Call Scheduled Data

```sql
-- Check Initial Call Scheduled distribution by week
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

**Document**: Confirm data exists and is populated correctly.

#### Task 3.2: Verify Qualification Call Data

```sql
-- Check Qualification Call distribution by week
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

**Document**: Confirm data exists and is populated correctly.

#### Task 3.3: Test Weekly Actuals Query for a Specific SGA

```sql
-- Weekly actuals for a specific SGA (replace 'SGA Name' with actual name)
SELECT 
  DATE_TRUNC(Initial_Call_Scheduled_Date__c, WEEK(MONDAY)) as week_start,
  COUNT(DISTINCT CASE 
    WHEN Initial_Call_Scheduled_Date__c IS NOT NULL 
    THEN primary_key 
  END) as initial_calls,
  COUNT(DISTINCT CASE 
    WHEN Qualification_Call_Date__c IS NOT NULL 
    THEN Full_Opportunity_ID__c 
  END) as qual_calls,
  COUNT(DISTINCT CASE 
    WHEN is_sqo_unique = 1 
      AND Date_Became_SQO__c IS NOT NULL 
      AND DATE_TRUNC(Date_Became_SQO__c, WEEK(MONDAY)) = DATE_TRUNC(Initial_Call_Scheduled_Date__c, WEEK(MONDAY))
    THEN Full_Opportunity_ID__c 
  END) as sqos_same_week
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE SGA_Owner_Name__c = 'Chris Morgan'  -- Replace with actual SGA name
  AND (
    Initial_Call_Scheduled_Date__c >= '2024-10-01'
    OR Qualification_Call_Date__c >= '2024-10-01'
    OR Date_Became_SQO__c >= '2024-10-01'
  )
GROUP BY week_start
ORDER BY week_start DESC
```

**Document**: Confirm query works and returns expected data structure.

#### Task 3.4: SQO by Week Query (Separate from Calls)

SQOs should be counted by when they BECAME an SQO, not by call dates:

```sql
-- SQOs by week for a specific SGA
SELECT 
  DATE_TRUNC(Date_Became_SQO__c, WEEK(MONDAY)) as week_start,
  COUNT(*) as sqos,
  SUM(Opportunity_AUM) as total_aum
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE SGA_Owner_Name__c = 'Chris Morgan'  -- Replace with actual SGA name
  AND is_sqo_unique = 1
  AND Date_Became_SQO__c IS NOT NULL
  AND Date_Became_SQO__c >= '2024-10-01'
  AND recordtypeid = '012Dn000000mrO3IAI'
GROUP BY week_start
ORDER BY week_start DESC
```

**Document**: Confirm SQO counting logic.

---

### SECTION 4: Closed Lost Follow-Up Data

**Goal**: Verify the closed lost view and determine if modifications are needed.

#### Task 4.1: Check Existing View

```sql
-- Test the existing closed lost view
SELECT *
FROM `savvy-gtm-analytics.savvy_analytics.vw_sga_closed_lost_sql_followup`
LIMIT 10
```

**Document**: Current schema and sample data.

#### Task 4.2: Verify Data for a Specific SGA

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

**Document**: Distribution of closed lost records by SGA.

#### Task 4.3: Check Available Fields for Drilldown

We need Lead URL and full Opportunity URL. Check if we can get these:

```sql
-- Check if we can join to get Lead info
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

**Document**: Confirm we have both Lead and Opportunity IDs for URL generation.

#### Task 4.4: Recommend View Modifications

Based on the existing view SQL provided:

```sql
-- Current view fields:
-- sga_name, opp_name, salesforce_url, time_since_last_contact_bucket,
-- last_contact_date, closed_lost_date, sql_date, closed_lost_reason,
-- closed_lost_details, Full_prospect_id__c, Full_Opportunity_ID__c

-- Recommended additions for drilldown:
-- lead_url (constructed from Full_prospect_id__c)
-- opportunity_url (constructed from Full_Opportunity_ID__c)  
-- advisor_name (from opp_name, already there)
-- StageName (always 'Closed Lost' but useful)
-- Opportunity_AUM (for context)
-- Channel_Grouping_Name (attribution)
-- Original_source (attribution)
```

**Document**: Recommend specific fields to add to the view.

---

### SECTION 5: Quarterly SQO Goals Data

**Goal**: Verify quarterly SQO counting logic.

#### Task 5.1: Quarterly SQO by SGA

```sql
-- Q4 2025 SQOs by SGA
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

**Document**: Q4 2025 SQO distribution by SGA.

#### Task 5.2: SQO Detail Query for SGA Hub

```sql
-- SQO details for a specific SGA in a quarter
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
WHERE SGA_Owner_Name__c = 'Chris Morgan'  -- Replace with actual SGA
  AND is_sqo_unique = 1
  AND Date_Became_SQO__c >= '2025-10-01'
  AND Date_Became_SQO__c < '2026-01-01'
  AND recordtypeid = '012Dn000000mrO3IAI'
ORDER BY Date_Became_SQO__c DESC
```

**Document**: Confirm query structure for SQO detail list.

---

### SECTION 6: Database Schema Design

**Goal**: Design the Prisma schema additions for goals.

#### Task 6.1: Review Current Prisma Schema

Read `prisma/schema.prisma` and document:
- Current models
- Relationship patterns
- Index patterns
- DateTime handling

#### Task 6.2: Propose New Models

Design and document these new models:

```prisma
model WeeklyGoal {
  // Design fields based on requirements:
  // - Links to User by email
  // - Week identified by Monday date
  // - Three goal metrics
  // - Audit fields
  // - Unique constraint on SGA + week
}

model QuarterlyGoal {
  // Design fields based on requirements:
  // - Links to User by email  
  // - Quarter as string (e.g., "2026-Q1")
  // - SQO goal
  // - Admin who set it
  // - Audit fields
  // - Unique constraint on SGA + quarter
}
```

**Document**: Complete proposed schema with rationale.

---

### SECTION 7: API Route Design

**Goal**: Design the API routes needed.

#### Task 7.1: List All Required Routes

Document each route with:
- HTTP method
- Path
- Request body shape
- Response shape
- Required permissions
- Database operations
- BigQuery operations

Routes needed:
1. `GET /api/sga-hub/weekly-goals` - Get goals for logged-in SGA
2. `POST /api/sga-hub/weekly-goals` - Create/update goal for a week
3. `GET /api/sga-hub/weekly-actuals` - Get BigQuery actuals for SGA
4. `GET /api/sga-hub/closed-lost` - Get closed lost records for SGA
5. `GET /api/sga-hub/quarterly-progress` - Get quarterly SQO progress
6. `GET /api/sga-hub/sqo-details` - Get SQO detail records
7. `GET /api/admin/sga-overview` - Get all SGAs with goals/actuals (admin)
8. `POST /api/admin/quarterly-goals` - Set quarterly goal for an SGA (admin)
9. `POST /api/admin/weekly-goals` - Override weekly goal for an SGA (admin)

**Document**: Complete API design for each route.

---

### SECTION 8: UI Component Design

**Goal**: Design the UI components and pages.

#### Task 8.1: Page Structure

Design and document:

1. **SGA Hub Page** (`/dashboard/sga-hub`)
   - Tabs: Weekly Goals | Closed Lost | Quarterly Progress
   - Each tab's layout and components

2. **Admin SGA Management Page** (`/dashboard/admin/sga-management`)
   - SGA selector/list
   - Weekly goals table (all SGAs)
   - Quarterly goals editor
   - Aggregate metrics

#### Task 8.2: Component Breakdown

List all new components needed:
- `WeeklyGoalsTable.tsx`
- `WeeklyGoalEditor.tsx`
- `ClosedLostTable.tsx`
- `QuarterlyProgressCard.tsx`
- `SQODetailTable.tsx`
- `AdminSGAOverview.tsx`
- etc.

**Document**: Each component's props, state, and functionality.

---

### SECTION 9: Implementation Order

**Goal**: Create a phased implementation plan.

Based on all findings, propose an implementation order:

1. **Phase 1**: Database schema + migrations
2. **Phase 2**: API routes for weekly goals
3. **Phase 3**: Weekly Goals UI
4. **Phase 4**: BigQuery actuals queries
5. **Phase 5**: Closed Lost tab
6. **Phase 6**: Quarterly goals (admin)
7. **Phase 7**: Admin overview page
8. **Phase 8**: Integration testing

**Document**: Detailed phases with dependencies and verification gates.

---

## 📝 Output Format

Create `SGA_HUB_FINDINGS.md` with this structure:

```markdown
# SGA Hub Feature - Investigation Findings

**Date**: [Current Date]
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
[Query results and analysis]

### 1.2 SGA Email Mapping
[Complete mapping table]

### 1.3 Key Findings
[Important discoveries]

---

[Continue for each section...]
```

---

## ⚠️ Important Notes

1. **Use MCP** for all BigQuery queries - do not fabricate results
2. **Read actual files** - do not assume file contents
3. **Document everything** - even negative findings (e.g., "Field X does not exist")
4. **Note any blockers** - things that need clarification before implementation
5. **Include actual query results** - not just the queries

---

## 🚀 Getting Started

Begin by creating the `SGA_HUB_FINDINGS.md` file, then work through each section systematically. Run actual queries and read actual files. Document as you go.

Start with Section 1 (User & SGA Mapping) as this is foundational for all other work.
