# Cursor.ai Task: Update Recruiter Hub Implementation Document

## Objective

Update `C:\Users\russe\Documents\Dashboard\recruiter_hub_implementation.md` to fix several issues that will cause the agentic implementation to fail. The main issues are:

1. **CRITICAL: Neon Database Migration** - Prisma migrate commands don't work with Neon. Must use manual SQL.
2. **Missing Function References** - Some functions referenced don't exist (e.g., `getUserById`, `getSessionPermissions`)
3. **Component Import Paths** - Some imports may not match actual codebase structure
4. **Pattern Alignment** - Need explicit instructions to read existing patterns before implementing

---

## SECTION 1: Fix Phase 1 (Database Migration) — CRITICAL

### Problem
The current Phase 1 tells the agent to run `npx prisma migrate dev` which **does not work with Neon**. The migration will fail or hang.

### Solution
Replace the entire Phase 1 with a manual SQL approach:

**Replace lines 59-173 with:**

```markdown
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
```

---

## SECTION 2: Fix Phase 7 (getUserById Function)

### Problem
Step 7.2 references `getUserById(params.id)` but this function may not exist in `src/lib/users.ts`.

### Solution
Add instructions to either verify the function exists OR create it.

**In Phase 7, Step 7.2, add this BEFORE the code block:**

```markdown
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
```

---

## SECTION 3: Fix Phase 8 (RecruiterHubContent Component)

### Problem 1: `getSessionPermissions` may not exist

The current code uses `getSessionPermissions(session)` which may not be a real function.

### Solution
Replace the permissions retrieval with the actual pattern used in the codebase.

**In Step 8.2, find this code:**
```typescript
import { getSessionPermissions } from '@/types/auth';
// ...
const permissions = getSessionPermissions(session);
```

**Replace with:**
```typescript
// Remove the getSessionPermissions import - it doesn't exist

// Instead, fetch permissions via API or use session data directly
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
```

**Also add a note at the top of Step 8.2:**
```markdown
**IMPORTANT:** Before implementing, read the existing patterns in these files:
- `src/app/dashboard/sga-hub/SGAHubContent.tsx` - for how to fetch permissions
- `src/app/dashboard/pipeline/page.tsx` - for filter and table patterns
- `src/components/dashboard/RecordDetailModal.tsx` - for modal integration

Match the existing patterns exactly.
```

---

### Problem 2: LoadingSpinner Component

The component may not exist at `@/components/ui/LoadingSpinner`.

**Add this check before using LoadingSpinner:**

```markdown
**Check for LoadingSpinner:**
```bash
find src/components -name "*[Ll]oading*" -o -name "*[Ss]pinner*"
```

If no LoadingSpinner exists, either:
1. Use an inline loading state: `<div className="animate-spin">⏳</div>`
2. Use Tremor's loading: `import { Text } from '@tremor/react'` then `<Text>Loading...</Text>`
3. Create a simple spinner component

Adjust the import accordingly.
```

---

## SECTION 4: Add "Read First" Instructions to Each Phase

### Problem
The agent may implement code that doesn't match existing patterns.

### Solution
Add explicit "read first" instructions at the start of each major phase.

**Add to Phase 2 (after Objectives):**
```markdown
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
```

**Add to Phase 6 (after Objectives):**
```markdown
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
```

**Add to Phase 7 (after Objectives):**
```markdown
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
```

**Add to Phase 8 (after Objectives):**
```markdown
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
```

---

## SECTION 5: Fix Phase 4 (BigQuery View Deployment)

### Problem
The MCP deployment instructions are vague about how Cursor.ai should deploy.

### Solution
Make the deployment instructions explicit for MCP.

**In Step 4.2, replace with:**

```markdown
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
```

---

## SECTION 6: Add Permissions API Endpoint

### Problem
Phase 8 needs to fetch user permissions, but there may not be an endpoint for this.

### Solution
Add a step to create the permissions API endpoint (if it doesn't exist).

**Add as Step 6.7 (new step in Phase 6):**

```markdown
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
```

---

## SECTION 7: Fix Validation Notes Section

### Problem
The Validation Notes at the top mention corrections but don't mention the Neon migration issue.

### Solution
Update the Validation Notes to include all known issues.

**Replace lines 10-17 with:**

```markdown
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
```

---

## SECTION 8: Add Known Issues Section

### Solution
Add a new section after "Known Limitations" at the end.

**Add before "End of Implementation Guide":**

```markdown
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
```

---

## Verification Checklist

After making all updates, verify the document contains:

- [ ] Phase 1 uses manual SQL file + Neon Console instructions (NO `prisma migrate dev`)
- [ ] Phase 1 human checkpoint includes Neon SQL Editor steps
- [ ] Each major phase has "Pre-Implementation: Read Existing Patterns" section
- [ ] Phase 6 includes Step 6.7 for permissions API endpoint
- [ ] Phase 7 includes check for `getUserById` function
- [ ] Phase 8 uses API-based permission fetching (not `getSessionPermissions`)
- [ ] Phase 8 includes check for LoadingSpinner component
- [ ] Validation Notes section is updated with all corrections
- [ ] Troubleshooting Guide section is added at the end

---

## Final Instructions

Save the updated `recruiter_hub_implementation.md` file and confirm all changes are complete.
