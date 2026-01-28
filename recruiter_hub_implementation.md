# Recruiter Hub — Agentic Implementation Guide

**Version:** 1.0  
**Reference Document:** `recruiter_hub_investigation.md`  
**Estimated Phases:** 8  
**Estimated Implementation Time:** 6-10 hours (agentic)

---

## Validation Notes (Codebase & Investigation)

This plan was validated against `recruiter_hub_investigation.md` and the Dashboard codebase. The following corrections were applied:

- **Phase 1:** Database migration uses **manual SQL for Neon** instead of `prisma migrate dev` (which doesn't work with Neon). Human must run SQL in Neon console.
- **Phase 2:** Manager role keeps `canManageUsers: false` (codebase and investigation; only admin can manage users).
- **Phase 6:** Recruiter-hub queries use `runQuery<T>(query, params)` from `@/lib/bigquery` and `FULL_TABLE` from `@/config/constants` — the project does not export a `bigquery` client or `bigquery.query()`.
- **Phase 6:** Added `/api/auth/permissions` endpoint for client-side permission fetching.
- **Phase 7:** `createUser` does not set a default password; use `passwordHash = input.password ? await bcrypt.hash(input.password, 10) : null` for OAuth-only users.
- **Phase 7:** Added check for `getUserById` function existence.
- **Phase 8:** Replaced `getSessionPermissions` with API-based permission fetching pattern.

**Environment Constraints:**
- Database: Neon (PostgreSQL) - requires manual SQL migrations
- BigQuery: Accessed via MCP tool
- Framework: Next.js 14 with App Router

---

## How to Use This Document

This document is designed for **agentic execution** by Cursor.ai. Each phase:

1. **Starts** with clear objectives and file targets
2. **Contains** step-by-step implementation instructions with code snippets
3. **Includes** automated validation steps (linting, type checking, MCP queries)
4. **Ends** with a human checkpoint listing manual verifications required

**Execution Rules:**
- Complete each phase fully before moving to the next
- Run ALL validation commands and fix any errors before proceeding
- At each 🧑‍💻 HUMAN CHECKPOINT, STOP and wait for human confirmation
- If any validation fails, debug and fix before continuing
- Use MCP to query BigQuery for data verification where specified

---

## Pre-Implementation Checklist

Before starting, verify the development environment:

```bash
# Verify you're in the correct directory
pwd
# Should be: C:\Users\russe\Documents\Dashboard (or equivalent)

# Verify dependencies are installed
npm list next prisma @prisma/client

# Verify database connection
npx prisma db pull --print

# Verify BigQuery MCP connection is available
# (Cursor.ai should have MCP access configured)
```

---

# PHASE 1: Database Schema & Prisma Setup

## Objectives
- Add `externalAgency` field to User model in Prisma schema
- Create manual SQL migration file for human to run in Neon
- Regenerate Prisma client after human applies migration

## Files to Modify
- `prisma/schema.prisma`

## Files to Create
- `prisma/migrations/manual_add_user_external_agency.sql` (NEW - manual migration)

---

### Step 1.1: Update Prisma Schema

**File:** `prisma/schema.prisma`

Find the `User` model and add the `externalAgency` field after `createdBy`:

```prisma
model User {
  id           String   @id @default(cuid())
  email        String   @unique
  name         String
  passwordHash String?  // Optional for OAuth-only users
  role         String   @default("viewer")
  isActive     Boolean  @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  createdBy    String?
  externalAgency String?  // NEW: Links recruiter to their External Agency (matches External_Agency__c in Salesforce)

  // Relations (keep existing relations as-is)
  savedReports        SavedReport[]
  gameScores          GameScore[]
  passwordResetTokens PasswordResetToken[]
}
```

---

### Step 1.2: Create Manual SQL Migration File

**File:** `prisma/migrations/manual_add_user_external_agency.sql` (NEW FILE)

```sql
-- Manual Migration: Add externalAgency column to User table
-- Run this SQL in Neon SQL Editor: https://console.neon.tech/
-- After running, execute: npx prisma generate

-- Add externalAgency column (idempotent - safe to run multiple times)
ALTER TABLE "User" 
ADD COLUMN IF NOT EXISTS "externalAgency" TEXT;

-- Verify the column was added
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'User' AND column_name = 'externalAgency';
```

---

### Step 1.3: Validation Commands (Agent Only)

```bash
# Validate Prisma schema syntax
npx prisma validate

# Verify the migration file was created
cat prisma/migrations/manual_add_user_external_agency.sql
```

**DO NOT run `npx prisma migrate dev` - it does not work with Neon.**

---

### 🧑‍💻 HUMAN CHECKPOINT — Phase 1

**Agent completed:**
- [x] Added `externalAgency` field to Prisma schema
- [x] Created manual SQL migration file
- [x] Validated Prisma schema

**Human must do the following:**

1. **Open Neon Console:** https://console.neon.tech/
2. **Navigate to your project → SQL Editor**
3. **Copy and paste the contents of `prisma/migrations/manual_add_user_external_agency.sql`**
4. **Click "Run" to execute the SQL**
5. **Verify the output shows the new column exists**
6. **Return to terminal and run:**
   ```bash
   npx prisma generate
   ```
7. **Verify Prisma client was regenerated:**
   ```bash
   npx prisma validate
   ```
8. **(Optional) Open Prisma Studio to verify:**
   ```bash
   npx prisma studio
   ```
   Confirm `User` table has `externalAgency` column with `null` values.

**Human: Type "CONTINUE" to proceed to Phase 2**

---

# PHASE 2: TypeScript Types & Permissions

## Objectives
- Add `'recruiter'` to all role type unions
- Add `externalAgency` to User-related types
- Add `recruiterFilter` to permissions
- Configure recruiter role permissions

## Files to Modify
- `src/types/user.ts`
- `src/lib/permissions.ts`
- `src/lib/users.ts`

## Pre-Implementation: Read Existing Patterns

Before modifying any files, read these files to understand existing patterns:

```bash
# View current user types
cat src/types/user.ts

# View current permissions structure  
cat src/lib/permissions.ts

# View current users library
cat src/lib/users.ts
```

Match the existing code style, naming conventions, and patterns exactly.

---

### Step 2.1: Update User Types

**File:** `src/types/user.ts`

Update ALL role unions to include `'recruiter'`:

```typescript
export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: 'admin' | 'manager' | 'sgm' | 'sga' | 'viewer' | 'recruiter';  // Added 'recruiter'
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  isActive: boolean;
  externalAgency?: string | null;  // NEW: For recruiter role
}

export interface UserPermissions {
  role: 'admin' | 'manager' | 'sgm' | 'sga' | 'viewer' | 'recruiter';  // Added 'recruiter'
  allowedPages: number[];
  sgaFilter: string | null;
  sgmFilter: string | null;
  recruiterFilter: string | null;  // NEW: For recruiter role
  canExport: boolean;
  canManageUsers: boolean;
}

// For API responses (excludes passwordHash)
export interface SafeUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'manager' | 'sgm' | 'sga' | 'viewer' | 'recruiter';  // Added 'recruiter'
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  isActive: boolean;
  externalAgency?: string | null;  // NEW: For recruiter role
}

// For creating/updating users
export interface UserInput {
  email: string;
  name: string;
  password?: string;
  role: 'admin' | 'manager' | 'sgm' | 'sga' | 'viewer' | 'recruiter';  // Added 'recruiter'
  isActive?: boolean;
  externalAgency?: string | null;  // NEW: For recruiter role
}
```

---

### Step 2.2: Update Permissions

**File:** `src/lib/permissions.ts`

Add recruiter to `ROLE_PERMISSIONS` and update `getUserPermissions`:

```typescript
import { UserPermissions } from '@/types/user';
import { getUserByEmail } from './users';

const ROLE_PERMISSIONS: Record<string, Omit<UserPermissions, 'sgaFilter' | 'sgmFilter' | 'recruiterFilter'>> = {
  admin: {
    role: 'admin',
    allowedPages: [1, 3, 7, 8, 9, 10, 11, 12],  // Added 12 (Recruiter Hub)
    canExport: true,
    canManageUsers: true,
  },
  manager: {
    role: 'manager',
    allowedPages: [1, 3, 7, 8, 9, 10, 11, 12],  // Added 12 (Recruiter Hub)
    canExport: true,
    canManageUsers: false,
  },
  sgm: {
    role: 'sgm',
    allowedPages: [1, 3, 7, 10],
    canExport: true,
    canManageUsers: false,
  },
  sga: {
    role: 'sga',
    allowedPages: [1, 3, 7, 8, 10, 11],
    canExport: true,
    canManageUsers: false,
  },
  viewer: {
    role: 'viewer',
    allowedPages: [1, 3, 7, 10],
    canExport: false,
    canManageUsers: false,
  },
  // NEW: Recruiter role
  recruiter: {
    role: 'recruiter',
    allowedPages: [7, 12],  // Settings (7) + Recruiter Hub (12) ONLY
    canExport: true,        // Can export their agency's data
    canManageUsers: false,
  },
};

export async function getUserPermissions(email: string): Promise<UserPermissions> {
  const user = await getUserByEmail(email);
  
  if (!user) {
    return {
      role: 'viewer',
      allowedPages: [1, 3, 7, 10],
      sgaFilter: null,
      sgmFilter: null,
      recruiterFilter: null,  // NEW
      canExport: false,
      canManageUsers: false,
    };
  }
  
  const basePermissions = ROLE_PERMISSIONS[user.role] || ROLE_PERMISSIONS.viewer;
  
  return {
    ...basePermissions,
    sgaFilter: user.role === 'sga' ? user.name : null,
    sgmFilter: user.role === 'sgm' ? user.name : null,
    recruiterFilter: user.role === 'recruiter' ? (user.externalAgency ?? null) : null,  // NEW
  };
}

export function canAccessPage(permissions: UserPermissions, pageNumber: number): boolean {
  return permissions.allowedPages.includes(pageNumber);
}

export function getDataFilters(permissions: UserPermissions): {
  sgaFilter: string | null;
  sgmFilter: string | null;
  recruiterFilter: string | null;  // NEW
} {
  return {
    sgaFilter: permissions.sgaFilter,
    sgmFilter: permissions.sgmFilter,
    recruiterFilter: permissions.recruiterFilter,  // NEW
  };
}
```

---

### Step 2.3: Update Users Library

**File:** `src/lib/users.ts`

Ensure `getUserByEmail` returns `externalAgency`. Find the Prisma query and add `externalAgency` to the select:

```typescript
// In getUserByEmail function, ensure externalAgency is selected
export async function getUserByEmail(email: string) {
  const normalizedEmail = email.toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    // If using select, add externalAgency:
    // select: { id: true, email: true, name: true, role: true, isActive: true, externalAgency: true, ... }
  });
  return user;
}

// In createUser function, add externalAgency parameter
export async function createUser(
  input: {
    email: string;
    name: string;
    password?: string;
    role: string;
    isActive?: boolean;
    externalAgency?: string | null;  // NEW
  },
  createdBy: string
) {
  const normalizedEmail = input.email.toLowerCase();
  
  // Check if user already exists
  const existingUser = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });
  
  if (existingUser) {
    throw new Error('User with this email already exists');
  }
  
  const passwordHash = input.password
    ? await bcrypt.hash(input.password, 10)
    : null;  // OAuth-only users have no password
  
  return prisma.user.create({
    data: {
      email: normalizedEmail,
      name: input.name,
      passwordHash,
      role: input.role,
      isActive: input.isActive ?? true,
      createdBy,
      externalAgency: input.externalAgency ?? null,  // NEW
    },
  });
}

// In updateUser function, add externalAgency handling
export async function updateUser(
  id: string,
  input: {
    name?: string;
    role?: string;
    password?: string;
    isActive?: boolean;
    externalAgency?: string | null;  // NEW
  }
) {
  const updateData: any = {};
  
  if (input.name !== undefined) updateData.name = input.name;
  if (input.role !== undefined) updateData.role = input.role;
  if (input.isActive !== undefined) updateData.isActive = input.isActive;
  if (input.externalAgency !== undefined) updateData.externalAgency = input.externalAgency;  // NEW
  
  if (input.password) {
    updateData.passwordHash = await bcrypt.hash(input.password, 10);
  }
  
  return prisma.user.update({
    where: { id },
    data: updateData,
  });
}
```

---

### Step 2.4: Validation Commands

```bash
# Type check - MUST PASS with no errors
npx tsc --noEmit

# Lint check
npm run lint

# Search for any remaining type errors related to recruiter
grep -r "role:" src/types/ src/lib/ --include="*.ts" | head -20
```

**Fix ALL type errors before proceeding.**

---

### 🧑‍💻 HUMAN CHECKPOINT — Phase 2

**Agent completed:**
- [x] Added `'recruiter'` to all role type unions
- [x] Added `externalAgency` to User types
- [x] Added `recruiterFilter` to `UserPermissions`
- [x] Added recruiter to `ROLE_PERMISSIONS` with `allowedPages: [7, 12]`
- [x] Updated `getUserByEmail`, `createUser`, `updateUser` to handle `externalAgency`
- [x] Passed type check and linter

**Human must verify:**
1. Review `src/types/user.ts` — confirm `'recruiter'` appears in all role unions
2. Review `src/lib/permissions.ts` — confirm recruiter has `allowedPages: [7, 12]` and `canExport: true`

**Human: Type "CONTINUE" to proceed to Phase 3**

---

# PHASE 3: Sidebar & Navigation

## Objectives
- Add Recruiter Hub to sidebar navigation
- Import Briefcase icon
- Verify routing will work

## Files to Modify
- `src/components/layout/Sidebar.tsx`

---

### Step 3.1: Update Sidebar

**File:** `src/components/layout/Sidebar.tsx`

Add the Briefcase import and Recruiter Hub page entry:

```typescript
// At the top of the file, add Briefcase to the lucide-react imports
import {
  BarChart3, Settings, Menu, X, Target,
  Bot, Users, Layers, Briefcase  // ADD Briefcase
} from 'lucide-react';

// In the PAGES array, add Recruiter Hub (after SGA Management, before Settings)
const PAGES = [
  { id: 1, name: 'Funnel Performance', href: '/dashboard', icon: BarChart3 },
  { id: 3, name: 'Open Pipeline', href: '/dashboard/pipeline', icon: Layers },
  { id: 10, name: 'Explore', href: '/dashboard/explore', icon: Bot },
  { id: 8, name: 'SGA Hub', href: '/dashboard/sga-hub', icon: Target },
  { id: 9, name: 'SGA Management', href: '/dashboard/sga-management', icon: Users },
  { id: 12, name: 'Recruiter Hub', href: '/dashboard/recruiter-hub', icon: Briefcase },  // NEW
  { id: 7, name: 'Settings', href: '/dashboard/settings', icon: Settings },
];
```

---

### Step 3.2: Validation Commands

```bash
# Type check
npx tsc --noEmit

# Lint check
npm run lint

# Verify Briefcase is properly imported
grep -n "Briefcase" src/components/layout/Sidebar.tsx
```

---

### 🧑‍💻 HUMAN CHECKPOINT — Phase 3

**Agent completed:**
- [x] Added Briefcase icon import
- [x] Added Recruiter Hub entry to PAGES array with id: 12
- [x] Passed type check and linter

**Human must verify:**
1. Start dev server: `npm run dev`
2. Log in as **admin** user
3. Verify sidebar shows "Recruiter Hub" with Briefcase icon
4. Click on it — should show 404 (page not created yet, this is expected)
5. Log in as **SGA** user (or other non-admin) — Recruiter Hub should NOT appear in sidebar

**Human: Type "CONTINUE" to proceed to Phase 4**

---

# PHASE 4: BigQuery View Update

## Objectives
- Add `Next_Steps__c` (Lead) and `NextStep` (Opportunity) to vw_funnel_master
- Deploy updated view to BigQuery via MCP
- Verify columns exist

## Files to Modify
- `views/vw_funnel_master.sql`

## MCP Actions
- Execute CREATE OR REPLACE VIEW in BigQuery

---

### Step 4.1: Update vw_funnel_master.sql

**File:** `views/vw_funnel_master.sql`

Make these specific additions:

#### 4.1.1: In Lead_Base CTE (after `Lead_SGA_Owner_Name__c` line):

```sql
-- Add this line in Lead_Base SELECT:
Next_Steps__c AS Lead_Next_Steps__c,
```

#### 4.1.2: In Opp_Base CTE (after `External_Agency__c AS Opp_External_Agency__c` line):

```sql
-- Add this line in Opp_Base SELECT:
NextStep AS Opp_NextStep,
```

#### 4.1.3: In Combined CTE (after the attribution/SGA section):

```sql
-- Add these lines in Combined SELECT (after SGA/SGM lines):
l.Lead_Next_Steps__c AS Next_Steps__c,
o.Opp_NextStep AS NextStep,
```

#### 4.1.4: In Final CTE SELECT

Ensure `Next_Steps__c` and `NextStep` are passed through. If using `wsl.*`, they should be included automatically. If explicit columns are listed, add:

```sql
Next_Steps__c,
NextStep,
```

---

### Step 4.2: Deploy View to BigQuery via MCP

**Using MCP BigQuery tool, execute the following:**

1. First, read the updated SQL file:
```bash
cat views/vw_funnel_master.sql
```

2. Copy the ENTIRE contents of the file.

3. Execute via MCP BigQuery with this wrapper:
```sql
CREATE OR REPLACE VIEW `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` AS
-- [PASTE ENTIRE FILE CONTENTS HERE]
```

**IMPORTANT:** The view deployment must be a single SQL statement. Do not break it into multiple queries.

4. After deployment, verify with MCP:
```sql
-- Check columns exist
SELECT column_name 
FROM `savvy-gtm-analytics.Tableau_Views.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name = 'vw_funnel_master'
  AND column_name IN ('Next_Steps__c', 'NextStep');
```

Expected: 2 rows returned.

---

### Step 4.3: Verify Deployment via MCP

**Execute these verification queries via MCP:**

**Query 1: Verify columns exist**
```sql
SELECT column_name, data_type
FROM `savvy-gtm-analytics.Tableau_Views.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name = 'vw_funnel_master'
  AND column_name IN ('Next_Steps__c', 'NextStep')
ORDER BY column_name;
```

**Expected:** 2 rows — `Next_Steps__c` (STRING) and `NextStep` (STRING)

**Query 2: Verify data is populated**
```sql
SELECT 
  COUNT(*) as total,
  COUNTIF(Next_Steps__c IS NOT NULL) as has_lead_next_steps,
  COUNTIF(NextStep IS NOT NULL) as has_opp_next_step
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE External_Agency__c IS NOT NULL;
```

**Expected:** Some non-zero counts for both columns

**Query 3: Sample data check**
```sql
SELECT 
  advisor_name,
  External_Agency__c,
  Next_Steps__c,
  NextStep,
  StageName
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE External_Agency__c IS NOT NULL
  AND (Next_Steps__c IS NOT NULL OR NextStep IS NOT NULL)
LIMIT 5;
```

**Expected:** 5 rows with visible Next_Steps__c or NextStep values

---

### Step 4.4: Validation Commands

```bash
# Verify local SQL file syntax (basic check)
head -100 views/vw_funnel_master.sql

# Verify Next_Steps__c and NextStep are in the file
grep -n "Next_Steps__c\|NextStep" views/vw_funnel_master.sql
```

---

### 🧑‍💻 HUMAN CHECKPOINT — Phase 4

**Agent completed:**
- [x] Added `Lead_Next_Steps__c` to Lead_Base CTE
- [x] Added `Opp_NextStep` to Opp_Base CTE
- [x] Added `Next_Steps__c` and `NextStep` to Combined CTE
- [x] Deployed view to BigQuery via MCP
- [x] Verified columns exist via MCP query

**Human must verify:**
1. Go to BigQuery Console: https://console.cloud.google.com/bigquery
2. Navigate to `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
3. Click "Preview" and verify `Next_Steps__c` and `NextStep` columns appear
4. Run a quick query to see sample data:
   ```sql
   SELECT advisor_name, Next_Steps__c, NextStep 
   FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` 
   WHERE External_Agency__c = 'Zero Staffing' 
   LIMIT 10;
   ```

**Human: Type "CONTINUE" to proceed to Phase 5**

---

# PHASE 5: Record Detail Enhancement

## Objectives
- Add Next Steps fields to record detail query
- Update record detail types
- Display Next Steps in RecordDetailModal

## Files to Modify
- `src/lib/queries/record-detail.ts`
- `src/types/record-detail.ts`
- `src/components/dashboard/RecordDetailModal.tsx`

---

### Step 5.1: Update Record Detail Query

**File:** `src/lib/queries/record-detail.ts`

Find the SELECT statement that queries `vw_funnel_master` and add the new columns:

```typescript
// Add to the SELECT list (find the existing column list):
Next_Steps__c,
NextStep,
```

The full query should look something like:

```typescript
const query = `
  SELECT
    primary_key,
    Full_prospect_id__c,
    Full_Opportunity_ID__c,
    advisor_name,
    -- ... existing columns ...
    External_Agency__c,
    Next_Steps__c,      -- NEW
    NextStep,           -- NEW
    -- ... rest of columns ...
  FROM \`${FULL_TABLE}\`
  WHERE primary_key = @primaryKey
`;
```

---

### Step 5.2: Update Record Detail Types

**File:** `src/types/record-detail.ts`

Add the new fields to both Raw and Full types:

```typescript
// In RecordDetailRaw interface, add:
Next_Steps__c: string | null;
NextStep: string | null;

// In RecordDetailFull interface, add:
nextSteps: string | null;          // From Lead.Next_Steps__c
opportunityNextStep: string | null; // From Opportunity.NextStep
```

---

### Step 5.3: Update Transform Function

**File:** `src/lib/queries/record-detail.ts` (or wherever `transformToRecordDetail` lives)

Add mapping for the new fields:

```typescript
// In transformToRecordDetail function, add:
nextSteps: raw.Next_Steps__c ?? null,
opportunityNextStep: raw.NextStep ?? null,
```

---

### Step 5.4: Update RecordDetailModal

**File:** `src/components/dashboard/RecordDetailModal.tsx`

Add a new section to display Next Steps. Find the modal content area and add:

```tsx
{/* Next Steps Section - add after existing sections */}
{(record.nextSteps || record.opportunityNextStep) && (
  <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
    <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
      Next Steps
    </h4>
    <div className="space-y-2">
      {record.nextSteps && (
        <div>
          <span className="text-xs text-gray-500 dark:text-gray-400">Lead Next Steps:</span>
          <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">
            {record.nextSteps}
          </p>
        </div>
      )}
      {record.opportunityNextStep && (
        <div>
          <span className="text-xs text-gray-500 dark:text-gray-400">Opportunity Next Step:</span>
          <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">
            {record.opportunityNextStep}
          </p>
        </div>
      )}
    </div>
  </div>
)}
```

---

### Step 5.5: Validation Commands

```bash
# Type check - critical for this phase
npx tsc --noEmit

# Lint check
npm run lint

# Verify the new fields are properly typed
grep -n "nextSteps\|opportunityNextStep" src/types/record-detail.ts
grep -n "Next_Steps__c\|NextStep" src/lib/queries/record-detail.ts
```

**Fix ALL errors before proceeding.**

---

### 🧑‍💻 HUMAN CHECKPOINT — Phase 5

**Agent completed:**
- [x] Added `Next_Steps__c` and `NextStep` to record detail query
- [x] Added `nextSteps` and `opportunityNextStep` to record detail types
- [x] Added transform mapping
- [x] Added Next Steps section to RecordDetailModal
- [x] Passed type check and linter

**Human must verify:**
1. Start dev server: `npm run dev`
2. Go to Funnel Performance or Open Pipeline
3. Click on any record row to open the detail modal
4. Verify the modal opens without errors (check browser console F12)
5. If the record has Next Steps data, verify it displays in the modal

**Human: Type "CONTINUE" to proceed to Phase 6**

---

# PHASE 6: Recruiter Hub APIs

## Objectives
- Create external agencies list API
- Create prospects list API
- Create opportunities list API
- Create BigQuery query functions

## Files to Create
- `src/app/api/recruiter-hub/external-agencies/route.ts`
- `src/app/api/recruiter-hub/prospects/route.ts`
- `src/app/api/recruiter-hub/opportunities/route.ts`
- `src/lib/queries/recruiter-hub.ts`

## Pre-Implementation: Read Existing Patterns

Before creating new API routes, read these existing patterns:

```bash
# View existing API route pattern
cat src/app/api/dashboard/filters/route.ts

# View existing BigQuery query pattern
cat src/lib/queries/detail-records.ts

# View how runQuery is used
grep -A 10 "runQuery" src/lib/bigquery.ts
```

Match the existing patterns for error handling, response format, and query structure.

---

### Step 6.1: Create Query Functions

**File:** `src/lib/queries/recruiter-hub.ts` (NEW FILE)

```typescript
import { runQuery } from '@/lib/bigquery';
import { FULL_TABLE } from '@/config/constants';

// Types for Recruiter Hub records
export interface RecruiterProspect {
  primary_key: string;
  advisor_name: string;
  External_Agency__c: string;
  SGA_Owner_Name__c: string | null;
  Next_Steps__c: string | null;
  TOF_Stage: string;
  Conversion_Status: string;
  is_mql: number;
  is_sql: number;
  is_sqo: number;
  salesforce_url: string | null;
}

export interface RecruiterOpportunity {
  primary_key: string;
  advisor_name: string;
  External_Agency__c: string;
  SGM_Owner_Name__c: string | null;
  StageName: string;
  NextStep: string | null;
  salesforce_url: string | null;
}

// Get distinct external agencies for dropdown
export async function getDistinctExternalAgencies(): Promise<string[]> {
  const query = `
    SELECT DISTINCT External_Agency__c
    FROM \`${FULL_TABLE}\`
    WHERE External_Agency__c IS NOT NULL 
      AND TRIM(External_Agency__c) != ''
    ORDER BY External_Agency__c
  `;

  const rows = await runQuery<{ External_Agency__c: string }>(query);
  return rows.map((row) => row.External_Agency__c);
}

// Get prospects for Recruiter Hub
export async function getRecruiterProspects(
  recruiterFilter: string | null,
  filters: {
    stages?: string[];  // 'MQL', 'SQL', 'SQO'
    openOnly?: boolean;
    externalAgencies?: string[];  // For admin filtering
  }
): Promise<RecruiterProspect[]> {
  const params: Record<string, unknown> = {};
  const conditions: string[] = [
    'External_Agency__c IS NOT NULL',
    "TRIM(External_Agency__c) != ''",
    'Full_prospect_id__c IS NOT NULL',  // Must have a prospect/lead
  ];

  // Recruiter filter (required for recruiters, ignored for admins)
  if (recruiterFilter) {
    conditions.push('External_Agency__c = @recruiterFilter');
    params.recruiterFilter = recruiterFilter;
  }

  // Admin agency filter (optional)
  if (!recruiterFilter && filters.externalAgencies && filters.externalAgencies.length > 0) {
    conditions.push('External_Agency__c IN UNNEST(@externalAgencies)');
    params.externalAgencies = filters.externalAgencies;
  }

  // Stage filters
  if (filters.stages && filters.stages.length > 0) {
    const stageConditions: string[] = [];
    if (filters.stages.includes('MQL')) stageConditions.push('is_mql = 1');
    if (filters.stages.includes('SQL')) stageConditions.push('is_sql = 1');
    if (filters.stages.includes('SQO')) stageConditions.push('is_sqo = 1');
    if (stageConditions.length > 0) {
      conditions.push(`(${stageConditions.join(' OR ')})`);
    }
  }

  // Open/Closed filter
  if (filters.openOnly) {
    conditions.push("Conversion_Status = 'Open'");
  }

  const query = `
    SELECT
      primary_key,
      advisor_name,
      External_Agency__c,
      SGA_Owner_Name__c,
      Next_Steps__c,
      TOF_Stage,
      Conversion_Status,
      is_mql,
      is_sql,
      is_sqo,
      salesforce_url
    FROM \`${FULL_TABLE}\`
    WHERE ${conditions.join(' AND ')}
    ORDER BY advisor_name
    LIMIT 5000
  `;

  return runQuery<RecruiterProspect>(query, Object.keys(params).length ? params : undefined);
}

// Get opportunities for Recruiter Hub
export async function getRecruiterOpportunities(
  recruiterFilter: string | null,
  filters: {
    stages?: string[];
    sgms?: string[];
    openOnly?: boolean;
    externalAgencies?: string[];
  }
): Promise<RecruiterOpportunity[]> {
  const params: Record<string, unknown> = {};
  const conditions: string[] = [
    'External_Agency__c IS NOT NULL',
    "TRIM(External_Agency__c) != ''",
    'Full_Opportunity_ID__c IS NOT NULL',
    'is_primary_opp_record = 1',  // Dedupe opportunities
  ];

  // Recruiter filter
  if (recruiterFilter) {
    conditions.push('External_Agency__c = @recruiterFilter');
    params.recruiterFilter = recruiterFilter;
  }

  // Admin agency filter
  if (!recruiterFilter && filters.externalAgencies && filters.externalAgencies.length > 0) {
    conditions.push('External_Agency__c IN UNNEST(@externalAgencies)');
    params.externalAgencies = filters.externalAgencies;
  }

  // Stage filter
  if (filters.stages && filters.stages.length > 0) {
    conditions.push('StageName IN UNNEST(@stages)');
    params.stages = filters.stages;
  }

  // SGM filter
  if (filters.sgms && filters.sgms.length > 0) {
    conditions.push('SGM_Owner_Name__c IN UNNEST(@sgms)');
    params.sgms = filters.sgms;
  }

  // Open/Closed filter
  if (filters.openOnly) {
    conditions.push("StageName NOT IN ('Joined', 'Closed Lost')");
  }

  const query = `
    SELECT
      primary_key,
      advisor_name,
      External_Agency__c,
      SGM_Owner_Name__c,
      StageName,
      NextStep,
      salesforce_url
    FROM \`${FULL_TABLE}\`
    WHERE ${conditions.join(' AND ')}
    ORDER BY advisor_name
    LIMIT 5000
  `;

  return runQuery<RecruiterOpportunity>(query, Object.keys(params).length ? params : undefined);
}

// Get distinct SGMs for filter dropdown
export async function getRecruiterHubSGMs(recruiterFilter: string | null): Promise<string[]> {
  const params: Record<string, unknown> = {};
  const conditions: string[] = [
    'External_Agency__c IS NOT NULL',
    "TRIM(External_Agency__c) != ''",
    'Full_Opportunity_ID__c IS NOT NULL',
    'SGM_Owner_Name__c IS NOT NULL',
  ];

  if (recruiterFilter) {
    conditions.push('External_Agency__c = @recruiterFilter');
    params.recruiterFilter = recruiterFilter;
  }

  const query = `
    SELECT DISTINCT SGM_Owner_Name__c
    FROM \`${FULL_TABLE}\`
    WHERE ${conditions.join(' AND ')}
    ORDER BY SGM_Owner_Name__c
  `;

  const rows = await runQuery<{ SGM_Owner_Name__c: string }>(
    query,
    Object.keys(params).length ? params : undefined
  );
  return rows.map((row) => row.SGM_Owner_Name__c);
}
```

---

### Step 6.2: Create External Agencies API

**File:** `src/app/api/recruiter-hub/external-agencies/route.ts` (NEW FILE)

```typescript
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDistinctExternalAgencies } from '@/lib/queries/recruiter-hub';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const agencies = await getDistinctExternalAgencies();
    
    return NextResponse.json({ agencies });
  } catch (error) {
    console.error('Error fetching external agencies:', error);
    return NextResponse.json(
      { error: 'Failed to fetch external agencies' },
      { status: 500 }
    );
  }
}
```

---

### Step 6.3: Create Prospects API

**File:** `src/app/api/recruiter-hub/prospects/route.ts` (NEW FILE)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { getRecruiterProspects } from '@/lib/queries/recruiter-hub';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const permissions = await getUserPermissions(session.user.email);
    
    // Check if user can access Recruiter Hub (page 12)
    if (!permissions.allowedPages.includes(12)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    
    const body = await request.json();
    const { stages, openOnly, externalAgencies } = body;
    
    // CRITICAL: For recruiters, always use their recruiterFilter
    // Never trust client-provided agency filter for recruiters
    const records = await getRecruiterProspects(
      permissions.recruiterFilter,  // null for admin, agency name for recruiter
      {
        stages,
        openOnly: openOnly ?? true,  // Default to open only
        externalAgencies: permissions.recruiterFilter ? undefined : externalAgencies,
      }
    );
    
    return NextResponse.json({ 
      records,
      count: records.length,
      recruiterFilter: permissions.recruiterFilter,  // Let client know if filtered
    });
  } catch (error) {
    console.error('Error fetching recruiter prospects:', error);
    return NextResponse.json(
      { error: 'Failed to fetch prospects' },
      { status: 500 }
    );
  }
}
```

---

### Step 6.4: Create Opportunities API

**File:** `src/app/api/recruiter-hub/opportunities/route.ts` (NEW FILE)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { getRecruiterOpportunities, getRecruiterHubSGMs } from '@/lib/queries/recruiter-hub';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const permissions = await getUserPermissions(session.user.email);
    
    // Check if user can access Recruiter Hub (page 12)
    if (!permissions.allowedPages.includes(12)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    
    const body = await request.json();
    const { stages, sgms, openOnly, externalAgencies } = body;
    
    // CRITICAL: For recruiters, always use their recruiterFilter
    const records = await getRecruiterOpportunities(
      permissions.recruiterFilter,
      {
        stages,
        sgms,
        openOnly: openOnly ?? true,
        externalAgencies: permissions.recruiterFilter ? undefined : externalAgencies,
      }
    );
    
    return NextResponse.json({ 
      records,
      count: records.length,
      recruiterFilter: permissions.recruiterFilter,
    });
  } catch (error) {
    console.error('Error fetching recruiter opportunities:', error);
    return NextResponse.json(
      { error: 'Failed to fetch opportunities' },
      { status: 500 }
    );
  }
}

// GET endpoint for filter options (SGMs)
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const permissions = await getUserPermissions(session.user.email);
    
    if (!permissions.allowedPages.includes(12)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    
    const sgms = await getRecruiterHubSGMs(permissions.recruiterFilter);
    
    return NextResponse.json({ sgms });
  } catch (error) {
    console.error('Error fetching SGMs:', error);
    return NextResponse.json({ error: 'Failed to fetch SGMs' }, { status: 500 });
  }
}
```

---

### Step 6.5: Validation Commands

```bash
# Create the directories if they don't exist
mkdir -p src/app/api/recruiter-hub/external-agencies
mkdir -p src/app/api/recruiter-hub/prospects
mkdir -p src/app/api/recruiter-hub/opportunities

# Type check
npx tsc --noEmit

# Lint check
npm run lint

# Verify files exist
ls -la src/app/api/recruiter-hub/
ls -la src/lib/queries/recruiter-hub.ts
```

---

### Step 6.6: Test APIs via MCP

**Verify the queries work by running them directly in BigQuery:**

**Test 1: External Agencies**
```sql
SELECT DISTINCT External_Agency__c
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE External_Agency__c IS NOT NULL 
  AND TRIM(External_Agency__c) != ''
ORDER BY External_Agency__c;
```

**Test 2: Prospects for Zero Staffing**
```sql
SELECT
  primary_key,
  advisor_name,
  External_Agency__c,
  SGA_Owner_Name__c,
  Next_Steps__c,
  TOF_Stage,
  Conversion_Status
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE External_Agency__c = 'Zero Staffing'
  AND Full_prospect_id__c IS NOT NULL
  AND Conversion_Status = 'Open'
LIMIT 10;
```

**Test 3: Opportunities for Zero Staffing**
```sql
SELECT
  primary_key,
  advisor_name,
  External_Agency__c,
  SGM_Owner_Name__c,
  StageName,
  NextStep
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE External_Agency__c = 'Zero Staffing'
  AND Full_Opportunity_ID__c IS NOT NULL
  AND is_primary_opp_record = 1
  AND StageName NOT IN ('Joined', 'Closed Lost')
LIMIT 10;
```

---

### Step 6.7: Create Permissions API Endpoint (if needed)

**First, check if it exists:**
```bash
ls src/app/api/auth/permissions/route.ts 2>/dev/null || echo "NEEDS CREATION"
```

**If it doesn't exist, create `src/app/api/auth/permissions/route.ts`:**

```typescript
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const permissions = await getUserPermissions(session.user.email);
    
    return NextResponse.json(permissions);
  } catch (error) {
    console.error('Error fetching permissions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch permissions' },
      { status: 500 }
    );
  }
}
```

This endpoint is used by RecruiterHubContent to get the current user's permissions.

---

### 🧑‍💻 HUMAN CHECKPOINT — Phase 6

**Agent completed:**
- [x] Created `src/lib/queries/recruiter-hub.ts` with query functions
- [x] Created `GET /api/recruiter-hub/external-agencies` endpoint
- [x] Created `POST /api/recruiter-hub/prospects` endpoint
- [x] Created `POST /api/recruiter-hub/opportunities` endpoint
- [x] Created or verified `GET /api/auth/permissions` endpoint (if needed)
- [x] Passed type check and linter
- [x] Verified queries work via MCP

**Human must verify:**
1. Start dev server: `npm run dev`
2. Test APIs with curl or browser:
   ```bash
   # Test external agencies (must be logged in - use browser dev tools)
   curl http://localhost:3000/api/recruiter-hub/external-agencies
   ```
3. In browser (logged in as admin), open F12 Console and run:
   ```javascript
   fetch('/api/recruiter-hub/external-agencies')
     .then(r => r.json())
     .then(console.log);
   ```
4. Verify response contains agencies array

**Human: Type "CONTINUE" to proceed to Phase 7**

---

# PHASE 7: User Management Updates

## Objectives
- Update User API to handle externalAgency
- Update UserModal to show External Agency field for recruiters
- Handle role change (clear externalAgency)

## Files to Modify
- `src/app/api/users/route.ts`
- `src/app/api/users/[id]/route.ts`
- `src/components/settings/UserModal.tsx`

## Pre-Implementation: Read Existing Patterns

Before modifying user management files, read:

```bash
# View current UserModal implementation
cat src/components/settings/UserModal.tsx

# View current user API routes
cat src/app/api/users/route.ts
cat src/app/api/users/[id]/route.ts
```

Your modifications should extend, not replace, the existing code.

---

### Step 7.1: Update User Create API

**File:** `src/app/api/users/route.ts`

Update the POST handler to accept and validate `externalAgency`:

```typescript
// In the POST function, update body destructuring and validation:

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const permissions = await getUserPermissions(session.user.email);
    
    if (!permissions.canManageUsers) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    
    const body = await request.json();
    const { email, name, password, role, isActive, externalAgency } = body;  // Add externalAgency
    
    if (!email || !name || !role) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    
    // NEW: Validate externalAgency for recruiter role
    if (role === 'recruiter') {
      if (!externalAgency || externalAgency.trim() === '') {
        return NextResponse.json(
          { error: 'External Agency is required for Recruiter role' },
          { status: 400 }
        );
      }
    }
    
    const user = await createUser(
      { 
        email, 
        name, 
        password, 
        role, 
        isActive,
        externalAgency: role === 'recruiter' ? externalAgency.trim() : null,  // NEW
      },
      session.user.email
    );
    
    // Convert to SafeUser...
    const safeUser: SafeUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as SafeUser['role'],
      isActive: user.isActive ?? true,
      createdAt: user.createdAt?.toISOString() || new Date().toISOString(),
      updatedAt: user.updatedAt?.toISOString() || new Date().toISOString(),
      createdBy: session.user.email,
      externalAgency: user.externalAgency ?? null,  // NEW
    };
    
    return NextResponse.json({ user: safeUser });
  } catch (error: any) {
    console.error('Error creating user:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create user' },
      { status: 500 }
    );
  }
}
```

---

### Step 7.2: Update User Update API

**IMPORTANT:** Before modifying, check if `getUserById` exists in `src/lib/users.ts`:

```bash
grep -n "getUserById" src/lib/users.ts
```

If it does NOT exist, add this function to `src/lib/users.ts`:

```typescript
export async function getUserById(id: string) {
  return prisma.user.findUnique({
    where: { id },
  });
}
```

Then import it in the route file.

**File:** `src/app/api/users/[id]/route.ts`

Update the PUT handler:

```typescript
// In the PUT function:

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const permissions = await getUserPermissions(session.user.email);
    
    if (!permissions.canManageUsers) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    
    const body = await request.json();
    
    // NEW: Get existing user to check role change
    const existingUser = await getUserById(params.id);
    if (!existingUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    
    // NEW: Validate externalAgency for recruiter role
    if (body.role === 'recruiter') {
      if (!body.externalAgency || body.externalAgency.trim() === '') {
        return NextResponse.json(
          { error: 'External Agency is required for Recruiter role' },
          { status: 400 }
        );
      }
      body.externalAgency = body.externalAgency.trim();
    }
    
    // NEW: Clear externalAgency when role changes FROM recruiter to something else
    if (body.role && body.role !== 'recruiter' && existingUser.role === 'recruiter') {
      body.externalAgency = null;
    }
    
    const user = await updateUser(params.id, body);
    
    // ... rest of SafeUser conversion with externalAgency included
    const safeUser: SafeUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as SafeUser['role'],
      isActive: user.isActive ?? true,
      createdAt: user.createdAt?.toISOString() || new Date().toISOString(),
      updatedAt: user.updatedAt?.toISOString() || new Date().toISOString(),
      createdBy: existingUser.createdBy || '',
      externalAgency: user.externalAgency ?? null,  // NEW
    };
    
    return NextResponse.json({ user: safeUser });
  } catch (error) {
    console.error('Error updating user:', error);
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}
```

Also update the GET handler to include `externalAgency` in the SafeUser response.

---

### Step 7.3: Update UserModal Component

**File:** `src/components/settings/UserModal.tsx`

This is a larger update. Here's the full updated component:

```tsx
'use client';

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { SafeUser } from '@/types/user';

interface UserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  user: SafeUser | null;
}

export function UserModal({ isOpen, onClose, onSaved, user }: UserModalProps) {
  const [formData, setFormData] = useState<{
    email: string;
    name: string;
    password: string;
    role: 'admin' | 'manager' | 'sgm' | 'sga' | 'viewer' | 'recruiter';
    isActive: boolean;
    externalAgency: string;
    externalAgencyIsOther: boolean;
  }>({
    email: '',
    name: '',
    password: '',
    role: 'viewer',
    isActive: true,
    externalAgency: '',
    externalAgencyIsOther: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agencies, setAgencies] = useState<string[]>([]);
  const [agenciesLoading, setAgenciesLoading] = useState(false);
  
  const isEditing = !!user;
  
  // Fetch external agencies for dropdown
  useEffect(() => {
    if (isOpen && formData.role === 'recruiter') {
      setAgenciesLoading(true);
      fetch('/api/recruiter-hub/external-agencies')
        .then(res => res.json())
        .then(data => {
          setAgencies(data.agencies || []);
        })
        .catch(err => {
          console.error('Failed to fetch agencies:', err);
        })
        .finally(() => {
          setAgenciesLoading(false);
        });
    }
  }, [isOpen, formData.role]);
  
  useEffect(() => {
    if (user) {
      const agencyInList = user.externalAgency && agencies.includes(user.externalAgency);
      setFormData({
        email: user.email,
        name: user.name,
        password: '',
        role: user.role,
        isActive: user.isActive,
        externalAgency: user.externalAgency || '',
        externalAgencyIsOther: user.externalAgency ? !agencyInList : false,
      });
    } else {
      setFormData({
        email: '',
        name: '',
        password: '',
        role: 'viewer',
        isActive: true,
        externalAgency: '',
        externalAgencyIsOther: false,
      });
    }
    setError(null);
  }, [user, isOpen, agencies]);
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    
    try {
      const url = isEditing ? `/api/users/${user.id}` : '/api/users';
      const method = isEditing ? 'PUT' : 'POST';
      
      const body: any = {
        email: formData.email,
        name: formData.name,
        role: formData.role,
        isActive: formData.isActive,
      };
      
      if (formData.password) {
        body.password = formData.password;
      }
      
      // Include externalAgency for recruiter role
      if (formData.role === 'recruiter') {
        body.externalAgency = formData.externalAgency.trim();
      }
      
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save user');
      }
      
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  
  const handleRoleChange = (newRole: typeof formData.role) => {
    setFormData(prev => ({
      ...prev,
      role: newRole,
      // Clear external agency when switching away from recruiter
      externalAgency: newRole === 'recruiter' ? prev.externalAgency : '',
      externalAgencyIsOther: false,
    }));
  };
  
  const handleAgencySelect = (value: string) => {
    if (value === '__OTHER__') {
      setFormData(prev => ({
        ...prev,
        externalAgency: '',
        externalAgencyIsOther: true,
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        externalAgency: value,
        externalAgencyIsOther: false,
      }));
    }
  };
  
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            {isEditing ? 'Edit User' : 'Add New User'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>
        
        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-600 dark:text-red-400 text-sm">
            {error}
          </div>
        )}
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Email *
            </label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              required
              disabled={isEditing}
              placeholder="user@example.com"
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:bg-gray-100 dark:disabled:bg-gray-600"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Name *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              placeholder="Full Name"
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Password {isEditing ? '(leave blank to keep current)' : '(optional for Google sign-in)'}
            </label>
            <input
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              minLength={formData.password ? 8 : undefined}
              placeholder={isEditing ? '••••••••' : 'Min 8 characters, or leave blank'}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Role *
            </label>
            <select
              value={formData.role}
              onChange={(e) => handleRoleChange(e.target.value as typeof formData.role)}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="admin">Admin - Full access, can manage users</option>
              <option value="manager">Manager - Full access, can manage users</option>
              <option value="sgm">SGM - Team data, limited pages</option>
              <option value="sga">SGA - Own data only, SGA Hub access</option>
              <option value="viewer">Viewer - Read-only, limited pages</option>
              <option value="recruiter">Recruiter - Recruiter Hub only, filtered by agency</option>
            </select>
          </div>
          
          {/* External Agency field - only shown for Recruiter role */}
          {formData.role === 'recruiter' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                External Agency *
              </label>
              {agenciesLoading ? (
                <div className="text-sm text-gray-500">Loading agencies...</div>
              ) : (
                <>
                  <select
                    value={formData.externalAgencyIsOther ? '__OTHER__' : formData.externalAgency}
                    onChange={(e) => handleAgencySelect(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    <option value="">-- Select Agency --</option>
                    {agencies.map((agency) => (
                      <option key={agency} value={agency}>
                        {agency}
                      </option>
                    ))}
                    <option value="__OTHER__">Other (enter manually)</option>
                  </select>
                  
                  {formData.externalAgencyIsOther && (
                    <input
                      type="text"
                      value={formData.externalAgency}
                      onChange={(e) => setFormData({ ...formData, externalAgency: e.target.value })}
                      required
                      placeholder="Enter agency name exactly as in Salesforce"
                      className="w-full mt-2 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                  )}
                </>
              )}
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                This recruiter will only see data for this agency.
              </p>
            </div>
          )}
          
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isActive"
              checked={formData.isActive}
              onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
              className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
            />
            <label htmlFor="isActive" className="text-sm text-gray-700 dark:text-gray-300">
              Active (can log in)
            </label>
          </div>
          
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || (formData.role === 'recruiter' && !formData.externalAgency.trim())}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Saving...' : isEditing ? 'Save Changes' : 'Add User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

---

### Step 7.4: Update User List Display

**File:** `src/components/settings/UserManagement.tsx`

If the user list shows columns, add External Agency display for recruiters. Find the table body and add:

```tsx
{/* In the table row, add External Agency column or badge for recruiters */}
{user.role === 'recruiter' && user.externalAgency && (
  <span className="ml-2 text-xs text-gray-500">
    ({user.externalAgency})
  </span>
)}
```

---

### Step 7.5: Validation Commands

```bash
# Type check
npx tsc --noEmit

# Lint check
npm run lint

# Verify recruiter appears in role options
grep -n "recruiter" src/components/settings/UserModal.tsx
```

---

### 🧑‍💻 HUMAN CHECKPOINT — Phase 7

**Agent completed:**
- [x] Updated POST /api/users to handle externalAgency
- [x] Updated PUT /api/users/[id] to handle externalAgency and role changes
- [x] Updated UserModal with External Agency dropdown + "Other" option
- [x] Passed type check and linter

**Human must verify:**
1. Start dev server: `npm run dev`
2. Log in as admin
3. Go to Settings → User Management
4. Click "Add User"
5. Select Role = "Recruiter"
6. Verify External Agency dropdown appears with agencies
7. Try selecting "Other" and typing a custom agency name
8. Create a test recruiter user with `externalAgency = 'Zero Staffing'`
9. Verify the user is created successfully

**Human: Type "CONTINUE" to proceed to Phase 8**

---

# PHASE 8: Recruiter Hub Page & Components

## Objectives
- Create Recruiter Hub page with access control
- Create RecruiterHubContent component
- Create Prospects and Opportunities tables
- Implement filters and record detail modal integration

## Files to Create
- `src/app/dashboard/recruiter-hub/page.tsx`
- `src/app/dashboard/recruiter-hub/RecruiterHubContent.tsx`

## Files to Modify
- `src/lib/api-client.ts`

## Pre-Implementation: Read Existing Patterns

Before creating the Recruiter Hub page, study these similar implementations:

```bash
# View SGA Hub page structure (most similar)
cat src/app/dashboard/sga-hub/page.tsx
cat src/app/dashboard/sga-hub/SGAHubContent.tsx

# View Pipeline page for filter patterns
cat src/app/dashboard/pipeline/page.tsx

# View existing table patterns
cat src/components/dashboard/DetailRecordsTable.tsx
```

The Recruiter Hub should follow the same patterns as SGA Hub.

---

### Step 8.1: Create Recruiter Hub Page

**File:** `src/app/dashboard/recruiter-hub/page.tsx` (NEW FILE)

```typescript
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { RecruiterHubContent } from './RecruiterHubContent';

export const dynamic = 'force-dynamic';

export default async function RecruiterHubPage() {
  const session = await getServerSession(authOptions);
  
  if (!session?.user?.email) {
    redirect('/login');
  }
  
  const permissions = await getUserPermissions(session.user.email);
  
  // Check if user can access Recruiter Hub (page 12)
  if (!permissions.allowedPages.includes(12)) {
    // Redirect based on role
    if (permissions.role === 'sga') {
      redirect('/dashboard/sga-hub');
    }
    redirect('/dashboard');
  }
  
  return <RecruiterHubContent />;
}
```

---

### Step 8.2: Create RecruiterHubContent Component

**IMPORTANT:** Before implementing, read the existing patterns in these files:
- `src/app/dashboard/sga-hub/SGAHubContent.tsx` - for how to fetch permissions
- `src/app/dashboard/pipeline/page.tsx` - for filter and table patterns
- `src/components/dashboard/RecordDetailModal.tsx` - for modal integration

Match the existing patterns exactly.

**Check for LoadingSpinner:**
```bash
find src/components -name "*[Ll]oading*" -o -name "*[Ss]pinner*"
```

If no LoadingSpinner exists, either:
1. Use an inline loading state: `<div className="animate-spin">⏳</div>`
2. Use Tremor's loading: `import { Text } from '@tremor/react'` then `<Text>Loading...</Text>`
3. Create a simple spinner component

Adjust the import accordingly.

**File:** `src/app/dashboard/recruiter-hub/RecruiterHubContent.tsx` (NEW FILE)

```tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Title, Text, Card } from '@tremor/react';
import { ChevronDown, ChevronUp, Search, ExternalLink } from 'lucide-react';
import { RecordDetailModal } from '@/components/dashboard/RecordDetailModal';
import { UserPermissions } from '@/types/user';
// Import LoadingSpinner only if it exists (see check above); otherwise use inline/Tremor loading

// Types
interface ProspectRecord {
  primary_key: string;
  advisor_name: string;
  External_Agency__c: string;
  SGA_Owner_Name__c: string | null;
  Next_Steps__c: string | null;
  TOF_Stage: string;
  Conversion_Status: string;
  salesforce_url: string | null;
}

interface OpportunityRecord {
  primary_key: string;
  advisor_name: string;
  External_Agency__c: string;
  SGM_Owner_Name__c: string | null;
  StageName: string;
  NextStep: string | null;
  salesforce_url: string | null;
}

interface ProspectFilters {
  stages: string[];
  openOnly: boolean;
  externalAgencies: string[];
}

interface OpportunityFilters {
  stages: string[];
  sgms: string[];
  openOnly: boolean;
  externalAgencies: string[];
}

// Stage options
const PROSPECT_STAGES = ['MQL', 'SQL', 'SQO'];
const OPPORTUNITY_STAGES = [
  'Qualifying', 'Discovery', 'Sales Process', 'Negotiating', 
  'Signed', 'On Hold', 'Planned Nurture', 'Re-Engaged',
  'Closed Lost', 'Joined'
];

export function RecruiterHubContent() {
  const { data: session } = useSession();
  const [permissions, setPermissions] = useState<UserPermissions | null>(null);

  useEffect(() => {
    if (session?.user?.email) {
      fetch('/api/auth/permissions')
        .then(res => res.json())
        .then(data => setPermissions(data))
        .catch(console.error);
    }
  }, [session?.user?.email]);

  const isAdmin = permissions?.role === 'admin' || permissions?.role === 'manager';
  const recruiterFilter = permissions?.recruiterFilter ?? null;
  
  // Prospects state
  const [prospects, setProspects] = useState<ProspectRecord[]>([]);
  const [prospectsLoading, setProspectsLoading] = useState(true);
  const [prospectFilters, setProspectFilters] = useState<ProspectFilters>({
    stages: [],  // Empty means all
    openOnly: true,
    externalAgencies: [],
  });
  const [prospectFiltersExpanded, setProspectFiltersExpanded] = useState(false);
  
  // Opportunities state
  const [opportunities, setOpportunities] = useState<OpportunityRecord[]>([]);
  const [opportunitiesLoading, setOpportunitiesLoading] = useState(true);
  const [opportunityFilters, setOpportunityFilters] = useState<OpportunityFilters>({
    stages: [],
    sgms: [],
    openOnly: true,
    externalAgencies: [],
  });
  const [opportunityFiltersExpanded, setOpportunityFiltersExpanded] = useState(false);
  
  // Filter options
  const [externalAgencies, setExternalAgencies] = useState<string[]>([]);
  const [sgmOptions, setSgmOptions] = useState<string[]>([]);
  
  // Record detail modal
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  
  // Search
  const [prospectSearch, setProspectSearch] = useState('');
  const [opportunitySearch, setOpportunitySearch] = useState('');
  
  // Fetch external agencies (for admin filter)
  useEffect(() => {
    if (isAdmin) {
      fetch('/api/recruiter-hub/external-agencies')
        .then(res => res.json())
        .then(data => setExternalAgencies(data.agencies || []))
        .catch(console.error);
    }
  }, [isAdmin]);
  
  // Fetch SGM options
  useEffect(() => {
    fetch('/api/recruiter-hub/opportunities')
      .then(res => res.json())
      .then(data => setSgmOptions(data.sgms || []))
      .catch(console.error);
  }, []);
  
  // Fetch prospects
  const fetchProspects = useCallback(async () => {
    setProspectsLoading(true);
    try {
      const response = await fetch('/api/recruiter-hub/prospects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stages: prospectFilters.stages.length > 0 ? prospectFilters.stages : undefined,
          openOnly: prospectFilters.openOnly,
          externalAgencies: isAdmin && prospectFilters.externalAgencies.length > 0 
            ? prospectFilters.externalAgencies 
            : undefined,
        }),
      });
      const data = await response.json();
      setProspects(data.records || []);
    } catch (error) {
      console.error('Failed to fetch prospects:', error);
    } finally {
      setProspectsLoading(false);
    }
  }, [prospectFilters, isAdmin]);
  
  // Fetch opportunities
  const fetchOpportunities = useCallback(async () => {
    setOpportunitiesLoading(true);
    try {
      const response = await fetch('/api/recruiter-hub/opportunities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stages: opportunityFilters.stages.length > 0 ? opportunityFilters.stages : undefined,
          sgms: opportunityFilters.sgms.length > 0 ? opportunityFilters.sgms : undefined,
          openOnly: opportunityFilters.openOnly,
          externalAgencies: isAdmin && opportunityFilters.externalAgencies.length > 0 
            ? opportunityFilters.externalAgencies 
            : undefined,
        }),
      });
      const data = await response.json();
      setOpportunities(data.records || []);
    } catch (error) {
      console.error('Failed to fetch opportunities:', error);
    } finally {
      setOpportunitiesLoading(false);
    }
  }, [opportunityFilters, isAdmin]);
  
  // Initial fetch
  useEffect(() => {
    fetchProspects();
  }, [fetchProspects]);
  
  useEffect(() => {
    fetchOpportunities();
  }, [fetchOpportunities]);
  
  // Filter records by search
  const filteredProspects = prospects.filter(p => 
    p.advisor_name?.toLowerCase().includes(prospectSearch.toLowerCase()) ||
    p.External_Agency__c?.toLowerCase().includes(prospectSearch.toLowerCase()) ||
    p.SGA_Owner_Name__c?.toLowerCase().includes(prospectSearch.toLowerCase())
  );
  
  const filteredOpportunities = opportunities.filter(o =>
    o.advisor_name?.toLowerCase().includes(opportunitySearch.toLowerCase()) ||
    o.External_Agency__c?.toLowerCase().includes(opportunitySearch.toLowerCase()) ||
    o.SGM_Owner_Name__c?.toLowerCase().includes(opportunitySearch.toLowerCase())
  );
  
  // Empty state component
  const EmptyState = ({ agencyName }: { agencyName?: string }) => (
    <div className="text-center py-12">
      <div className="text-gray-400 text-4xl mb-4">📋</div>
      <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
        No records found{agencyName ? ` for ${agencyName}` : ''}
      </h3>
      <p className="text-gray-500 dark:text-gray-400">
        If you believe this is an error, please contact your administrator.
      </p>
    </div>
  );
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Title>Recruiter Hub</Title>
        <Text>
          {recruiterFilter 
            ? `Viewing prospects and opportunities for ${recruiterFilter}`
            : 'Viewing all prospects and opportunities with external agencies'
          }
        </Text>
      </div>
      
      {/* Prospects Section */}
      <Card>
        <div className="space-y-4">
          {/* Prospects Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Prospects
              </h2>
              <span className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 rounded-full">
                {filteredProspects.length}
              </span>
            </div>
            
            {/* Filters Toggle */}
            <button
              onClick={() => setProspectFiltersExpanded(!prospectFiltersExpanded)}
              className="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            >
              Filters
              {prospectFiltersExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
          
          {/* Prospects Filters */}
          {prospectFiltersExpanded && (
            <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Stage Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Prospect Stage
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {PROSPECT_STAGES.map(stage => (
                      <label key={stage} className="inline-flex items-center">
                        <input
                          type="checkbox"
                          checked={prospectFilters.stages.includes(stage)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setProspectFilters(prev => ({
                                ...prev,
                                stages: [...prev.stages, stage]
                              }));
                            } else {
                              setProspectFilters(prev => ({
                                ...prev,
                                stages: prev.stages.filter(s => s !== stage)
                              }));
                            }
                          }}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">{stage}</span>
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Leave all unchecked for all stages</p>
                </div>
                
                {/* Open/Closed Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Status
                  </label>
                  <select
                    value={prospectFilters.openOnly ? 'open' : 'all'}
                    onChange={(e) => setProspectFilters(prev => ({
                      ...prev,
                      openOnly: e.target.value === 'open'
                    }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    <option value="open">Open Only</option>
                    <option value="all">All (Open + Closed)</option>
                  </select>
                </div>
                
                {/* External Agency Filter (Admin only) */}
                {isAdmin && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      External Agency
                    </label>
                    <select
                      value={prospectFilters.externalAgencies[0] || ''}
                      onChange={(e) => setProspectFilters(prev => ({
                        ...prev,
                        externalAgencies: e.target.value ? [e.target.value] : []
                      }))}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    >
                      <option value="">All Agencies</option>
                      {externalAgencies.map(agency => (
                        <option key={agency} value={agency}>{agency}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setProspectFilters({
                    stages: [],
                    openOnly: true,
                    externalAgencies: [],
                  })}
                  className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                >
                  Reset
                </button>
                <button
                  onClick={fetchProspects}
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Apply Filters
                </button>
              </div>
            </div>
          )}
          
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={prospectSearch}
              onChange={(e) => setProspectSearch(e.target.value)}
              placeholder="Search prospects..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
          
          {/* Prospects Table */}
          {prospectsLoading ? (
            <div className="flex justify-center py-8">
              <Text>Loading...</Text>
            </div>
          ) : filteredProspects.length === 0 ? (
            <EmptyState agencyName={recruiterFilter || undefined} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 dark:text-gray-400">Advisor</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 dark:text-gray-400">External Agency</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 dark:text-gray-400">SGA</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 dark:text-gray-400">Stage</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 dark:text-gray-400">Next Steps</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 dark:text-gray-400">SF</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProspects.slice(0, 50).map((prospect) => (
                    <tr
                      key={prospect.primary_key}
                      onClick={() => setSelectedRecordId(prospect.primary_key)}
                      className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer"
                    >
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-white font-medium">
                        {prospect.advisor_name}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                        {prospect.External_Agency__c}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                        {prospect.SGA_Owner_Name__c || '-'}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className="px-2 py-1 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded">
                          {prospect.TOF_Stage}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300 max-w-xs truncate">
                        {prospect.Next_Steps__c || '-'}
                      </td>
                      <td className="px-4 py-3">
                        {prospect.salesforce_url && (
                          <a
                            href={prospect.salesforce_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-blue-600 hover:text-blue-800"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredProspects.length > 50 && (
                <div className="text-center py-4 text-sm text-gray-500">
                  Showing 50 of {filteredProspects.length} prospects
                </div>
              )}
            </div>
          )}
        </div>
      </Card>
      
      {/* Opportunities Section */}
      <Card>
        <div className="space-y-4">
          {/* Opportunities Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Opportunities
              </h2>
              <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 rounded-full">
                {filteredOpportunities.length}
              </span>
            </div>
            
            <button
              onClick={() => setOpportunityFiltersExpanded(!opportunityFiltersExpanded)}
              className="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            >
              Filters
              {opportunityFiltersExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
          
          {/* Opportunities Filters */}
          {opportunityFiltersExpanded && (
            <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {/* Stage Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Stage
                  </label>
                  <select
                    multiple
                    value={opportunityFilters.stages}
                    onChange={(e) => {
                      const values = Array.from(e.target.selectedOptions, option => option.value);
                      setOpportunityFilters(prev => ({ ...prev, stages: values }));
                    }}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white h-24"
                  >
                    {OPPORTUNITY_STAGES.map(stage => (
                      <option key={stage} value={stage}>{stage}</option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">Ctrl+click to select multiple</p>
                </div>
                
                {/* SGM Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    SGM
                  </label>
                  <select
                    value={opportunityFilters.sgms[0] || ''}
                    onChange={(e) => setOpportunityFilters(prev => ({
                      ...prev,
                      sgms: e.target.value ? [e.target.value] : []
                    }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    <option value="">All SGMs</option>
                    {sgmOptions.map(sgm => (
                      <option key={sgm} value={sgm}>{sgm}</option>
                    ))}
                  </select>
                </div>
                
                {/* Open/Closed Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Status
                  </label>
                  <select
                    value={opportunityFilters.openOnly ? 'open' : 'all'}
                    onChange={(e) => setOpportunityFilters(prev => ({
                      ...prev,
                      openOnly: e.target.value === 'open'
                    }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    <option value="open">Open Only</option>
                    <option value="all">All (Open + Closed)</option>
                  </select>
                </div>
                
                {/* External Agency Filter (Admin only) */}
                {isAdmin && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      External Agency
                    </label>
                    <select
                      value={opportunityFilters.externalAgencies[0] || ''}
                      onChange={(e) => setOpportunityFilters(prev => ({
                        ...prev,
                        externalAgencies: e.target.value ? [e.target.value] : []
                      }))}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    >
                      <option value="">All Agencies</option>
                      {externalAgencies.map(agency => (
                        <option key={agency} value={agency}>{agency}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setOpportunityFilters({
                    stages: [],
                    sgms: [],
                    openOnly: true,
                    externalAgencies: [],
                  })}
                  className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                >
                  Reset
                </button>
                <button
                  onClick={fetchOpportunities}
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Apply Filters
                </button>
              </div>
            </div>
          )}
          
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={opportunitySearch}
              onChange={(e) => setOpportunitySearch(e.target.value)}
              placeholder="Search opportunities..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
          
          {/* Opportunities Table */}
          {opportunitiesLoading ? (
            <div className="flex justify-center py-8">
              <Text>Loading...</Text>
            </div>
          ) : filteredOpportunities.length === 0 ? (
            <EmptyState agencyName={recruiterFilter || undefined} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 dark:text-gray-400">Advisor</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 dark:text-gray-400">Stage</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 dark:text-gray-400">External Agency</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 dark:text-gray-400">SGM</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 dark:text-gray-400">Next Step</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 dark:text-gray-400">SF</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOpportunities.slice(0, 50).map((opp) => (
                    <tr
                      key={opp.primary_key}
                      onClick={() => setSelectedRecordId(opp.primary_key)}
                      className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer"
                    >
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-white font-medium">
                        {opp.advisor_name}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`px-2 py-1 text-xs font-medium rounded ${
                          opp.StageName === 'Joined' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                          opp.StageName === 'Closed Lost' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' :
                          'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
                        }`}>
                          {opp.StageName}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                        {opp.External_Agency__c}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                        {opp.SGM_Owner_Name__c || '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300 max-w-xs truncate">
                        {opp.NextStep || '-'}
                      </td>
                      <td className="px-4 py-3">
                        {opp.salesforce_url && (
                          <a
                            href={opp.salesforce_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-blue-600 hover:text-blue-800"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredOpportunities.length > 50 && (
                <div className="text-center py-4 text-sm text-gray-500">
                  Showing 50 of {filteredOpportunities.length} opportunities
                </div>
              )}
            </div>
          )}
        </div>
      </Card>
      
      {/* Record Detail Modal */}
      <RecordDetailModal
        isOpen={selectedRecordId !== null}
        onClose={() => setSelectedRecordId(null)}
        recordId={selectedRecordId}
      />
    </div>
  );
}
```

---

### Step 8.3: Update API Client (Optional)

**File:** `src/lib/api-client.ts`

Add helper methods for Recruiter Hub APIs:

```typescript
// Add these methods to the dashboardApi object or create a new recruiterHubApi:

export const recruiterHubApi = {
  getExternalAgencies: async (): Promise<{ agencies: string[] }> => {
    const response = await fetch('/api/recruiter-hub/external-agencies');
    if (!response.ok) throw new Error('Failed to fetch agencies');
    return response.json();
  },
  
  getProspects: async (filters: {
    stages?: string[];
    openOnly?: boolean;
    externalAgencies?: string[];
  }): Promise<{ records: any[]; count: number }> => {
    const response = await fetch('/api/recruiter-hub/prospects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(filters),
    });
    if (!response.ok) throw new Error('Failed to fetch prospects');
    return response.json();
  },
  
  getOpportunities: async (filters: {
    stages?: string[];
    sgms?: string[];
    openOnly?: boolean;
    externalAgencies?: string[];
  }): Promise<{ records: any[]; count: number }> => {
    const response = await fetch('/api/recruiter-hub/opportunities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(filters),
    });
    if (!response.ok) throw new Error('Failed to fetch opportunities');
    return response.json();
  },
};
```

---

### Step 8.4: Update Login Redirect

**File:** `src/app/login/page.tsx`

Find the login success handler and add recruiter redirect. Look for the existing SGA redirect logic:

```typescript
// Find the existing redirect logic (typically in handleSubmit or useEffect after login)
// Add recruiter case:

// After successful login, redirect based on role
if (permissions?.role === 'sga') {
  router.push('/dashboard/sga-hub');
} else if (permissions?.role === 'recruiter') {
  router.push('/dashboard/recruiter-hub');
} else {
  router.push('/dashboard');
}
```

---

### Step 8.5: Validation Commands

```bash
# Create directory
mkdir -p src/app/dashboard/recruiter-hub

# Type check
npx tsc --noEmit

# Lint check
npm run lint

# Verify files exist
ls -la src/app/dashboard/recruiter-hub/
```

---

### 🧑‍💻 HUMAN CHECKPOINT — Phase 8 (FINAL)

**Agent completed:**
- [x] Created `page.tsx` with access control
- [x] Created `RecruiterHubContent.tsx` with full UI
- [x] Prospects table with filters, search, and pagination
- [x] Opportunities table with filters, search, and pagination
- [x] Record detail modal integration
- [x] Empty state handling
- [x] Login redirect for recruiters
- [x] Passed type check and linter

**Human must verify:**

1. **Start dev server:** `npm run dev`

2. **Test as Admin:**
   - Log in as admin
   - Navigate to Recruiter Hub from sidebar
   - Verify both tables load with data
   - Verify External Agency filter appears
   - Test filtering by stage, open/closed, agency
   - Click a row → verify RecordDetailModal opens
   - Verify Salesforce link works

3. **Test as Recruiter:**
   - Log in as the test recruiter user (created in Phase 7)
   - Verify automatic redirect to Recruiter Hub
   - Verify sidebar only shows Settings and Recruiter Hub
   - Verify data is filtered to their agency only
   - Verify External Agency filter does NOT appear
   - Test all filters work

4. **Test Direct URL Protection:**
   - As recruiter, try navigating to `/dashboard/pipeline` directly
   - Should redirect to `/dashboard/recruiter-hub`

5. **Test Record Detail:**
   - Click any row
   - Verify modal shows all record details
   - Verify Next Steps section appears (if data exists)
   - Verify Salesforce link works

6. **Browser Console Check (F12):**
   - Check for any JavaScript errors
   - Check Network tab for failed API calls

---

# POST-IMPLEMENTATION: Google OAuth Domain Update

**This is a manual step for the human:**

To allow external recruiters to use Google sign-in:

1. **Go to Google Cloud Console:**
   https://console.cloud.google.com/auth/clients/644017037386-varan6og6ou96mk4tql8d8mmcrkrof37.apps.googleusercontent.com?project=savvy-pirate-extension

2. **Update OAuth consent screen** (if needed):
   - Add authorized domains for recruiter agencies

3. **Update `src/lib/auth.ts`:**
   - Modify the Google OAuth callback to allow any pre-provisioned user
   - Remove or modify the `@savvywealth.com` domain restriction

**Recommended code change:**
```typescript
// In the Google OAuth signIn callback, change from:
if (!profile?.email?.endsWith('@savvywealth.com')) {
  return '/login?error=InvalidDomain';
}

// To:
const existingUser = await getUserByEmail(profile?.email || '');
if (!existingUser) {
  return '/login?error=NotProvisioned';
}
// Allow sign-in for any provisioned user
```

---

# IMPLEMENTATION COMPLETE ✅

## Summary of Changes

| Area | Files Modified/Created |
|------|------------------------|
| **Database** | `prisma/schema.prisma` (+externalAgency) |
| **Types** | `src/types/user.ts` (+recruiter role, +externalAgency) |
| **Permissions** | `src/lib/permissions.ts` (+recruiter, +recruiterFilter) |
| **Users** | `src/lib/users.ts` (+externalAgency handling) |
| **Sidebar** | `src/components/layout/Sidebar.tsx` (+Recruiter Hub) |
| **BigQuery** | `views/vw_funnel_master.sql` (+Next_Steps__c, +NextStep) |
| **Record Detail** | `src/lib/queries/record-detail.ts`, `src/types/record-detail.ts`, `RecordDetailModal.tsx` |
| **APIs** | `src/app/api/recruiter-hub/*` (3 new routes) |
| **Queries** | `src/lib/queries/recruiter-hub.ts` (new) |
| **User Mgmt** | `src/app/api/users/*`, `UserModal.tsx` |
| **Page** | `src/app/dashboard/recruiter-hub/*` (new) |
| **Auth** | `src/app/login/page.tsx` (+recruiter redirect) |

## Test Checklist

- [ ] Admin can see Recruiter Hub and view all agencies
- [ ] Admin can create a recruiter user with external agency
- [ ] Recruiter can log in and is redirected to Recruiter Hub
- [ ] Recruiter only sees their agency's data
- [ ] Recruiter cannot access other pages (direct URL redirects)
- [ ] Filters work correctly (stages, open/closed, SGM)
- [ ] Record detail modal opens and shows all fields including Next Steps
- [ ] Salesforce links work
- [ ] Export works for recruiters
- [ ] Empty state displays when no records

## Known Limitations

1. Pagination is client-side only (first 50 shown, need scroll for more)
2. Google OAuth for external domains requires manual GCP configuration
3. No email notifications when recruiter user is created

---

## Troubleshooting Guide

### Issue: Prisma migrate fails with Neon
**Solution:** Never use `npx prisma migrate dev` with Neon. Use the manual SQL approach in Phase 1.

### Issue: Type errors after adding recruiter role
**Solution:** Ensure `'recruiter'` is added to ALL role unions in `src/types/user.ts`. Search for `'admin' | 'manager'` and add `| 'recruiter'` to each.

### Issue: BigQuery query returns empty results
**Solution:** Verify the vw_funnel_master view was deployed correctly. Check column names match exactly (case-sensitive).

### Issue: RecruiterHubContent doesn't load permissions
**Solution:** Ensure `/api/auth/permissions` endpoint exists and returns the correct structure.

### Issue: UserModal doesn't show External Agency dropdown
**Solution:** The dropdown only appears when role is exactly `'recruiter'`. Check the role comparison is using triple equals.

### Issue: Recruiter can access other pages via direct URL
**Solution:** Ensure the page-level permission check uses `allowedPages.includes(12)` and redirects properly.

---

**End of Implementation Guide**
