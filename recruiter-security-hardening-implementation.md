# Recruiter Security Hardening — Agentic Implementation Guide

**Version:** 1.2
**Date:** 2026-01-28
**Last Reviewed:** 2026-01-28 (Claude Code Opus 4.5)
**Status:** ✅ IMPLEMENTED
**Reference:** `recruiter-security-audit-questions-and-answers.md` (completed audit)
**Priority:** P0 fixes first, then P1, then P2+

---

## Implementation Status

All phases have been implemented by Claude Code Opus 4.5 on 2026-01-28:

| Phase | Status | Description |
|-------|--------|-------------|
| 1 | ✅ Complete | Games API authorization (leaderboard, levels, play) |
| 2 | ✅ Complete | Explore feedback authorization |
| 3 | ✅ Complete | Middleware allowlist for record-detail |
| 4 | ✅ Complete | Saved reports authorization (3 routes) |
| 5 | ✅ Verified | GET opportunities already correct (no changes) |
| 6 | ✅ Complete | `.cursorrules` updated with security rules |
| 7 | ✅ Complete | Refactored 12 dashboard routes to use `forbidRecruiter()` |
| 8 | ✅ Complete | External agencies list filtered for recruiters |
| 9 | ⏳ Optional | Security test template (needs human implementation) |

**Files Modified (19 total):**
- Games: `leaderboard/route.ts`, `levels/route.ts`, `play/[quarter]/route.ts`
- Explore: `feedback/route.ts`
- Middleware: `middleware.ts`
- Saved Reports: `route.ts`, `[id]/route.ts`, `[id]/duplicate/route.ts`
- Dashboard: `funnel-metrics`, `conversion-rates`, `detail-records`, `source-performance`, `filters`, `export-sheets`, `forecast`, `open-pipeline`, `pipeline-drilldown`, `pipeline-sgm-options`, `pipeline-summary`
- Agent: `query/route.ts`
- Recruiter Hub: `external-agencies/route.ts`
- Config: `.cursorrules`

---

## Executive Summary

This document provides step-by-step instructions for agentic implementation of all security fixes identified in the recruiter security audit. The fixes are organized by priority:

| Priority | Issues | Est. Time |
|----------|--------|-----------|
| **P0 (Critical)** | Games API authorization, Explore feedback | 30 min |
| **P1 (High)** | Record detail modal fix (middleware allowlist), Saved reports, GET opportunities | 45 min |
| **P2 (Medium)** | `forbidRecruiter()` adoption, Cursor rules | 1.5 hrs |
| **P3 (Low)** | External agencies filter, Documentation | 30 min |

**Total Estimated Time:** 3-4 hours

---

## Important Implementation Notes

### Existing Security Patterns Already in Place
Before implementing, understand what's already working:

1. **Middleware Default-Deny**: `src/middleware.ts` already blocks recruiters from all `/api/*` except the allowlist
2. **Record Detail Route**: `src/app/api/dashboard/record-detail/[id]/route.ts` **already has proper recruiter filtering** (lines 49-58) - it checks role, validates `recruiterFilter`, and queries with agency filter
3. **RecordDetailModal**: Uses `dashboardApi.getRecordDetail()` from `src/lib/api-client.ts` which calls `/api/dashboard/record-detail/[id]`
4. **forbidRecruiter() helper**: Already exists in `src/lib/api-authz.ts` but is unused

### What's Actually Broken for Recruiters
The record detail modal doesn't work for recruiters because:
- The route (`/api/dashboard/record-detail/[id]`) is NOT in the middleware allowlist
- So recruiters get 403 from middleware before the route's proper filtering can run
- **Fix**: Add to allowlist (the route already handles recruiters safely)

---

## Revision Notes (v1.1)

Changes made based on Claude Code Opus 4.5 review:

1. **Phase 3 Simplified**: Instead of creating a duplicate `/api/recruiter-hub/record-detail/[id]` endpoint, we now just add the existing `/api/dashboard/record-detail` to the middleware allowlist. The route already has proper recruiter filtering - it was just being blocked by middleware.

2. **Phase 5 Removed**: Code review showed the GET opportunities handler already has proper permission checks - no changes needed.

3. **Phase 1 Updated**: Added PATCH handler authorization (was missing from original plan).

4. **All Phases Updated**: Added specific line numbers and current state descriptions for easier implementation.

5. **Phase 4 Updated**: Clarified which handlers need changes and which already have `getUserPermissions` calls.

---

## Pre-Implementation Checklist

Before starting, verify the development environment:

```bash
# Verify you're in the correct directory
pwd

# Verify dependencies
npm list next @prisma/client

# Start dev server (keep running in separate terminal)
npm run dev

# Verify TypeScript compiles
npx tsc --noEmit
```

---

## How to Use This Document

This document is designed for **agentic execution**. Each phase:

1. **Starts** with clear objectives and file targets
2. **Contains** step-by-step code changes with exact snippets
3. **Includes** validation commands after each change
4. **Ends** with a human checkpoint for manual verification

**Execution Rules:**
- Complete each phase fully before moving to the next
- Run ALL validation commands and fix any errors before proceeding
- At each 🧑‍💻 HUMAN CHECKPOINT, STOP and wait for human confirmation
- If any validation fails, debug and fix before continuing

---

# PHASE 1: Block Recruiters from Games (P0 — CRITICAL)

## Objectives
- Add authorization to ALL game API endpoints
- Ensure recruiters receive 403 Forbidden for any game-related request
- Use the `forbidRecruiter()` helper pattern for consistency

## Files to Modify
- `src/app/api/games/pipeline-catcher/leaderboard/route.ts`
- `src/app/api/games/pipeline-catcher/levels/route.ts`
- `src/app/api/games/pipeline-catcher/play/[quarter]/route.ts`

---

### Step 1.1: Update Leaderboard Route

**File:** `src/app/api/games/pipeline-catcher/leaderboard/route.ts`

**Current state:** The route uses `getSessionUserId(session)` for auth but has NO role checking.

**Add to imports at the top of the file (around line 3):**

```typescript
import { getUserPermissions } from '@/lib/permissions';
import { forbidRecruiter } from '@/lib/api-authz';
```

**In the GET handler, after line 21 (`if (!userId) { return... }`), add:**

```typescript
    // Block recruiters from games
    const permissions = await getUserPermissions(session?.user?.email || '');
    const forbidden = forbidRecruiter(permissions);
    if (forbidden) return forbidden;
```

**In the POST handler, after line 68 (`if (!userId) { return... }`), add the same block:**

```typescript
    // Block recruiters from games
    const permissions = await getUserPermissions(session?.user?.email || '');
    const forbidden = forbidRecruiter(permissions);
    if (forbidden) return forbidden;
```

**In the PATCH handler (around line 124), after the `if (!userId)` check, add the same block:**

```typescript
    // Block recruiters from games
    const permissions = await getUserPermissions(session?.user?.email || '');
    const forbidden = forbidRecruiter(permissions);
    if (forbidden) return forbidden;
```

**Also add input validation for negative scores in POST (after the recruiter check, before line 73):**

```typescript
    // Validate score is non-negative
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0) {
      return NextResponse.json(
        { error: 'Score must be a non-negative number' },
        { status: 400 }
      );
    }
```

---

### Step 1.2: Update Levels Route

**File:** `src/app/api/games/pipeline-catcher/levels/route.ts`

**Add imports at top:**

```typescript
import { getUserPermissions } from '@/lib/permissions';
import { forbidRecruiter } from '@/lib/api-authz';
```

**After the session check in GET handler, add:**

```typescript
    // Block recruiters from games
    const permissions = await getUserPermissions(session.user.email);
    const forbidden = forbidRecruiter(permissions);
    if (forbidden) return forbidden;
```

---

### Step 1.3: Update Play Route

**File:** `src/app/api/games/pipeline-catcher/play/[quarter]/route.ts`

**Add imports at top:**

```typescript
import { getUserPermissions } from '@/lib/permissions';
import { forbidRecruiter } from '@/lib/api-authz';
```

**After the session check in GET handler, add:**

```typescript
    // Block recruiters from games
    const permissions = await getUserPermissions(session.user.email);
    const forbidden = forbidRecruiter(permissions);
    if (forbidden) return forbidden;
```

---

### Step 1.4: Validation

Run these commands to verify changes:

```bash
# Type check
npx tsc --noEmit

# Lint
npm run lint

# Verify imports work
grep -r "forbidRecruiter" src/app/api/games/
```

**Expected output from grep:** Should show all three game route files importing and using `forbidRecruiter`.

---

### 🧑‍💻 HUMAN CHECKPOINT — Phase 1

**Agent completed:**
- [x] Added authorization to leaderboard route (GET and POST)
- [x] Added authorization to levels route
- [x] Added authorization to play route
- [x] Added negative score validation
- [x] Type check passed
- [x] Lint passed

**Human must verify:**
1. Log in as a recruiter user
2. Open browser console (F12)
3. Try to access game API:
   ```javascript
   fetch('/api/games/pipeline-catcher/leaderboard').then(r => console.log(r.status))
   ```
4. Verify response is `403` (not 200 or 401)
5. Try navigating to game (if there's a UI route) and confirm it's inaccessible

**Human: Type "CONTINUE" to proceed to Phase 2**

---

# PHASE 2: Block Recruiters from Explore Feedback (P0)

## Objectives
- Add authorization to the explore feedback endpoint
- Ensure recruiters cannot submit feedback for a feature they can't access

## Files to Modify
- `src/app/api/explore/feedback/route.ts`

---

### Step 2.1: Update Explore Feedback Route

**File:** `src/app/api/explore/feedback/route.ts`

**Current state:** The route checks `session.user` but has NO role checking.

**Add to imports at top (after line 6):**

```typescript
import { getUserPermissions } from '@/lib/permissions';
import { forbidRecruiter } from '@/lib/api-authz';
```

**After the session check (line 19), add:**

```typescript
    // Block recruiters - they can't access Explore so shouldn't submit feedback
    const permissions = await getUserPermissions(session.user.email || '');
    const forbidden = forbidRecruiter(permissions);
    if (forbidden) return forbidden;
```

The complete section should look like:
```typescript
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Block recruiters - they can't access Explore so shouldn't submit feedback
    const permissions = await getUserPermissions(session.user.email || '');
    const forbidden = forbidRecruiter(permissions);
    if (forbidden) return forbidden;

    // 2. Parse request body
    const body = await request.json();
```

---

### Step 2.2: Validation

```bash
npx tsc --noEmit
npm run lint
grep -r "forbidRecruiter" src/app/api/explore/
```

---

### 🧑‍💻 HUMAN CHECKPOINT — Phase 2

**Agent completed:**
- [x] Added authorization to explore feedback route
- [x] Type check passed

**Human: Type "CONTINUE" to proceed to Phase 3**

---

# PHASE 3: Fix Record Detail Modal for Recruiters (P1)

## Objectives
- Enable recruiters to view record details for records in their agency
- Use the EXISTING `/api/dashboard/record-detail/[id]` route (it already has proper filtering!)
- Simply add the path to the middleware allowlist

## Why This Approach (Not Creating a New Endpoint)

**The existing route already handles recruiters correctly:**
```typescript
// From src/app/api/dashboard/record-detail/[id]/route.ts (lines 49-58)
if (permissions.role === 'recruiter') {
  if (!permissions.allowedPages.includes(12) || !permissions.recruiterFilter) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const record = await getRecordDetail(id, permissions.recruiterFilter);
  if (!record) {
    return NextResponse.json({ error: 'Record not found' }, { status: 404 });
  }
  return NextResponse.json({ record });
}
```

**The problem is only that middleware blocks it before the route runs!**

Creating a duplicate endpoint would:
- Add unnecessary code duplication
- Require modifying `RecordDetailModal` to use different endpoints based on context
- Be harder to maintain

**The simple fix**: Add `/api/dashboard/record-detail` to the middleware allowlist.

## Files to Modify
- `src/middleware.ts` (add to recruiter allowlist)

---

### Step 3.1: Update Middleware Allowlist

**File:** `src/middleware.ts`

**Find the allowlist section (around line 73-77):**

```typescript
    const allowlisted =
      pathname.startsWith('/api/auth') ||
      pathname.startsWith('/api/recruiter-hub') ||
      pathname === '/api/users/me/change-password' ||
      pathname === '/api/dashboard/data-freshness';
```

**Update to include record-detail:**

```typescript
    const allowlisted =
      pathname.startsWith('/api/auth') ||
      pathname.startsWith('/api/recruiter-hub') ||
      pathname.startsWith('/api/dashboard/record-detail') ||  // Record detail modal (route has proper filtering)
      pathname === '/api/users/me/change-password' ||
      pathname === '/api/dashboard/data-freshness';
```

**Why this is safe:**
- The route at `/api/dashboard/record-detail/[id]/route.ts` already:
  - Requires authentication (`getServerSession`)
  - Checks `permissions.role === 'recruiter'`
  - Validates `permissions.allowedPages.includes(12)`
  - Requires `permissions.recruiterFilter` to be set
  - Filters query results by `recruiterFilter` (agency)
  - Returns 404 for records outside the recruiter's agency (no information leakage)

---

### Step 3.2: Validation

```bash
# Type check
npx tsc --noEmit

# Lint
npm run lint

# Verify the middleware change
grep -A10 "allowlisted =" src/middleware.ts
```

---

### 🧑‍💻 HUMAN CHECKPOINT — Phase 3

**Agent completed:**
- [x] Added `/api/dashboard/record-detail` to middleware allowlist
- [x] Type check passed

**Human must verify:**
1. Log in as a recruiter user
2. Go to Recruiter Hub (`/dashboard/recruiter-hub`)
3. Click on any prospect or opportunity row
4. Verify the Record Detail Modal opens and shows data
5. **Security test**: In browser console, try fetching a record ID that belongs to another agency:
   ```javascript
   fetch('/api/dashboard/record-detail/006FAKE12345').then(r => console.log(r.status))
   // Should return 404 (not 200 with data from another agency)
   ```

**Human: Type "CONTINUE" to proceed to Phase 4**

---

# PHASE 4: Block Recruiters from Saved Reports (P1)

## Objectives
- Add recruiter authorization to saved reports endpoints
- Ensure recruiters cannot create, read, update, or delete saved reports
- This is defense-in-depth (middleware already blocks these routes for recruiters)

## Files to Modify
- `src/app/api/saved-reports/route.ts`
- `src/app/api/saved-reports/[id]/route.ts`
- `src/app/api/saved-reports/[id]/duplicate/route.ts`

---

### Step 4.1: Update Main Saved Reports Route

**File:** `src/app/api/saved-reports/route.ts`

**Current state:**
- GET handler: Has NO `getUserPermissions` call at all
- POST handler: Calls `getUserPermissions` but only for admin template check, not recruiter block

**Add import at top (after line 6):**

```typescript
import { forbidRecruiter } from '@/lib/api-authz';
```

**In GET handler, after line 18 (the unauthorized check), add:**

```typescript
    // Block recruiters from saved reports
    const permissions = await getUserPermissions(session.user.email);
    const forbidden = forbidRecruiter(permissions);
    if (forbidden) return forbidden;
```

**In POST handler, after line 115 (`const permissions = await getUserPermissions...`), add:**

```typescript
    // Block recruiters from saved reports
    const forbidden = forbidRecruiter(permissions);
    if (forbidden) return forbidden;
```

---

### Step 4.2: Update Individual Report Route

**File:** `src/app/api/saved-reports/[id]/route.ts`

**Current state:**
- GET: No `getUserPermissions` call at all
- PUT: Calls `getUserPermissions` on line 91 (for admin template check only)
- DELETE: Calls `getUserPermissions` on line 187 (for admin template check only)

**Add import at top (after line 6):**

```typescript
import { forbidRecruiter } from '@/lib/api-authz';
```

**In GET handler, after line 22 (the unauthorized check), add:**

```typescript
    // Block recruiters from saved reports
    const permissions = await getUserPermissions(session.user.email);
    const forbidden = forbidRecruiter(permissions);
    if (forbidden) return forbidden;
```

**In PUT handler, after line 91 (`const permissions = await getUserPermissions...`), add:**

```typescript
    // Block recruiters from saved reports
    const forbidden = forbidRecruiter(permissions);
    if (forbidden) return forbidden;
```

**In DELETE handler, after line 187 (`const permissions = await getUserPermissions...`), add:**

```typescript
    // Block recruiters from saved reports
    const forbidden = forbidRecruiter(permissions);
    if (forbidden) return forbidden;
```

---

### Step 4.3: Update Duplicate Route

**File:** `src/app/api/saved-reports/[id]/duplicate/route.ts`

**Current state:** No `getUserPermissions` call at all.

**Add imports at top (after line 5):**

```typescript
import { getUserPermissions } from '@/lib/permissions';
import { forbidRecruiter } from '@/lib/api-authz';
```

**In POST handler, after line 21 (the unauthorized check), add:**

```typescript
    // Block recruiters from saved reports
    const permissions = await getUserPermissions(session.user.email);
    const forbidden = forbidRecruiter(permissions);
    if (forbidden) return forbidden;
```

---

### Step 4.4: Validation

```bash
npx tsc --noEmit
npm run lint
grep -r "forbidRecruiter" src/app/api/saved-reports/
```

**Expected:** All three files should show `forbidRecruiter` usage.

---

### 🧑‍💻 HUMAN CHECKPOINT — Phase 4

**Agent completed:**
- [x] Added authorization to saved-reports route
- [x] Added authorization to saved-reports/[id] route  
- [x] Added authorization to saved-reports/[id]/duplicate route
- [x] Type check passed

**Human: Type "CONTINUE" to proceed to Phase 5**

---

# PHASE 5: Verify GET Opportunities (Already Implemented!)

## Status: NO CHANGES NEEDED

**Upon code review, the GET handler in `src/app/api/recruiter-hub/opportunities/route.ts` ALREADY has proper permission checking:**

```typescript
// Lines 54-68 - ALREADY CORRECT
export async function GET() {
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
  }
  // ...
}
```

**What's already in place:**
- Session authentication check
- `getUserPermissions(session.user.email)` is called
- `allowedPages.includes(12)` check (Recruiter Hub access)
- `getRecruiterHubSGMs(permissions.recruiterFilter)` uses the recruiter filter

**Skip to Phase 6.**

---

### 🧑‍💻 HUMAN CHECKPOINT — Phase 5

**Agent note:** Phase 5 requires NO CHANGES - the code is already correct.

**Human: Type "CONTINUE" to proceed to Phase 6**

---

# PHASE 6: Update .cursorrules with Recruiter Security Rules (P2)

## Objectives
- Add comprehensive recruiter security rules to .cursorrules
- Ensure future agentic development maintains security

## Files to Modify
- `.cursorrules`

---

### Step 6.1: Add Recruiter Security Section

**File:** `.cursorrules`

**Add the following section (find an appropriate location, such as after existing security-related rules or at the end):**

```markdown
---

## Recruiter Role Security (CRITICAL)

The `recruiter` role is for EXTERNAL users who must be isolated from internal data. Follow these rules strictly:

### Default-Deny Architecture

1. **Middleware blocks all `/api/*` for recruiters EXCEPT:**
   - `/api/auth/*` (authentication)
   - `/api/recruiter-hub/*` (their dedicated endpoints)
   - `/api/users/me/change-password` (password change)
   - `/api/dashboard/data-freshness` (non-sensitive metadata)

2. **New API routes are blocked by default** — middleware will return 403 for any new `/api/*` route until explicitly allowlisted.

### Creating New API Routes

When creating ANY new API route under `/api/*`:

1. **Always add authorization:**
   ```typescript
   import { getUserPermissions } from '@/lib/permissions';
   import { forbidRecruiter } from '@/lib/api-authz';
   
   // After session check:
   const permissions = await getUserPermissions(session.user.email);
   const forbidden = forbidRecruiter(permissions);
   if (forbidden) return forbidden;
   ```

2. **Exception: Recruiter-intended routes** — If the route IS for recruiters (under `/api/recruiter-hub/*`):
   - Check `permissions.allowedPages.includes(12)` 
   - ALWAYS filter data by `permissions.recruiterFilter`
   - NEVER trust client-provided agency filters for recruiters

### Data Filtering Rules

For recruiter-accessible endpoints:

```typescript
// ✅ CORRECT - Use server-side recruiterFilter
const records = await getRecruiterProspects(
  permissions.recruiterFilter,  // From getUserPermissions, not from request body
  { stages, openOnly }
);

// ❌ WRONG - Trusting client input
const records = await getRecruiterProspects(
  body.externalAgency,  // NEVER trust this for recruiters
  { stages, openOnly }
);
```

### Recruiter Permissions Reference

```typescript
// From src/lib/permissions.ts
recruiter: {
  role: 'recruiter',
  allowedPages: [7, 12],  // Settings (7) + Recruiter Hub (12) ONLY
  canExport: true,        // Can export their agency's data
  canManageUsers: false,
}
// recruiterFilter = user.externalAgency (set in DB)
```

### Security Checklist for New Features

Before marking any feature complete, verify:

- [ ] Recruiters cannot access the feature (unless explicitly intended)
- [ ] If recruiter-accessible, data is filtered by `recruiterFilter`
- [ ] No client-provided filters can override server-side agency restriction
- [ ] Middleware allowlist updated only if intentional (document why)
- [ ] `forbidRecruiter()` helper used for consistent blocking

### Files to Know

| File | Purpose |
|------|---------|
| `src/middleware.ts` | Global default-deny for recruiters |
| `src/lib/api-authz.ts` | `forbidRecruiter()` helper |
| `src/lib/permissions.ts` | Role definitions and `getUserPermissions()` |
| `src/lib/queries/recruiter-hub.ts` | Recruiter data queries with agency filter |

---
```

---

### Step 6.2: Validation

```bash
# Verify the rules were added
grep -A5 "Recruiter Role Security" .cursorrules
```

---

### 🧑‍💻 HUMAN CHECKPOINT — Phase 6

**Agent completed:**
- [x] Added comprehensive recruiter security rules to .cursorrules

**Human: Review the added rules and confirm they're appropriate.**

**Human: Type "CONTINUE" to proceed to Phase 7**

---

# PHASE 7: Adopt forbidRecruiter() Pattern Across Codebase (P2)

## Objectives
- Refactor existing manual role checks to use `forbidRecruiter()` helper
- Improve consistency and auditability

## Files to Modify
- All API routes that currently have `if (permissions.role === 'recruiter')` checks

---

### Step 7.1: Find All Manual Checks

Run this command to find files that need updating:

```bash
grep -rn "permissions.role === 'recruiter'" src/app/api/
grep -rn "role === 'recruiter'" src/app/api/
```

For each file found, apply the following pattern:

---

### Step 7.2: Refactoring Pattern

**Before:**
```typescript
const permissions = await getUserPermissions(session.user.email);

if (permissions.role === 'recruiter') {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
```

**After:**
```typescript
import { forbidRecruiter } from '@/lib/api-authz';

// ...

const permissions = await getUserPermissions(session.user.email);
const forbidden = forbidRecruiter(permissions);
if (forbidden) return forbidden;
```

---

### Step 7.3: Files to Update

Based on the audit, these files likely need updating:

1. `src/app/api/dashboard/funnel-metrics/route.ts`
2. `src/app/api/dashboard/conversion-rates/route.ts`
3. `src/app/api/dashboard/source-performance/route.ts`
4. `src/app/api/dashboard/detail-records/route.ts`
5. `src/app/api/dashboard/export-sheets/route.ts`
6. `src/app/api/dashboard/filters/route.ts`
7. `src/app/api/dashboard/forecast/route.ts`
8. `src/app/api/dashboard/open-pipeline/route.ts`
9. `src/app/api/sga-hub/*.ts` (all routes)
10. `src/app/api/sga-activity/*.ts` (all routes)
11. `src/app/api/agent/query/route.ts`
12. `src/app/api/admin/*.ts` (all routes)

For each file:
1. Add import: `import { forbidRecruiter } from '@/lib/api-authz';`
2. Replace manual check with helper pattern

---

### Step 7.4: Validation

```bash
# Verify no manual checks remain (should return nothing or only false positives)
grep -rn "permissions.role === 'recruiter'" src/app/api/

# Verify forbidRecruiter is imported where needed
grep -rn "forbidRecruiter" src/app/api/ | wc -l

# Type check
npx tsc --noEmit
```

---

### 🧑‍💻 HUMAN CHECKPOINT — Phase 7

**Agent completed:**
- [x] Refactored all manual recruiter checks to use `forbidRecruiter()`
- [x] Type check passed

**Human: Type "CONTINUE" to proceed to Phase 8**

---

# PHASE 8: Filter External Agencies List for Recruiters (P3)

## Objectives
- Recruiters currently see ALL agency names (low sensitivity but unnecessary)
- Filter to show only their own agency

## Files to Modify
- `src/app/api/recruiter-hub/external-agencies/route.ts`

---

### Step 8.1: Update External Agencies Route

**File:** `src/app/api/recruiter-hub/external-agencies/route.ts`

**Update to filter for recruiters:**

```typescript
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { getDistinctExternalAgencies } from '@/lib/queries/recruiter-hub';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const permissions = await getUserPermissions(session.user.email);
    
    // Check if user can access Recruiter Hub
    if (!permissions.allowedPages.includes(12)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    
    // For recruiters, only return their own agency
    // For admins/managers, return all agencies
    if (permissions.role === 'recruiter' && permissions.recruiterFilter) {
      return NextResponse.json({ agencies: [permissions.recruiterFilter] });
    }
    
    // Non-recruiters get the full list
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

### Step 8.2: Validation

```bash
npx tsc --noEmit
npm run lint
```

---

### 🧑‍💻 HUMAN CHECKPOINT — Phase 8

**Agent completed:**
- [x] Filtered external agencies list for recruiters
- [x] Type check passed

**Human: Type "CONTINUE" to proceed to Phase 9**

---

# PHASE 9: Add Automated Security Tests (P2)

## Objectives
- Create tests that verify recruiter access restrictions
- Ensure regressions are caught automatically

## Files to Create
- `src/__tests__/security/recruiter-access.test.ts` (or appropriate test location)

---

### Step 9.1: Create Security Test File

**Note:** Adjust the test file location based on your project's test structure.

**File:** `src/__tests__/security/recruiter-access.test.ts`

```typescript
/**
 * Recruiter Access Security Tests
 * 
 * These tests verify that recruiters cannot access sensitive endpoints
 * and can only see data within their agency.
 * 
 * To run: npm test -- --grep "Recruiter Security"
 */

import { describe, it, expect, beforeAll } from 'vitest'; // or jest

// Mock session for a recruiter user
const recruiterSession = {
  user: {
    email: 'recruiter@externalagency.com',
    role: 'recruiter',
  },
};

// List of endpoints that should return 403 for recruiters
const FORBIDDEN_ENDPOINTS = [
  { method: 'POST', path: '/api/dashboard/funnel-metrics' },
  { method: 'POST', path: '/api/dashboard/conversion-rates' },
  { method: 'POST', path: '/api/dashboard/detail-records' },
  { method: 'POST', path: '/api/dashboard/source-performance' },
  { method: 'GET', path: '/api/dashboard/filters' },
  { method: 'POST', path: '/api/dashboard/export-sheets' },
  { method: 'GET', path: '/api/sga-hub/weekly-goals' },
  { method: 'GET', path: '/api/sga-hub/weekly-actuals' },
  { method: 'GET', path: '/api/sga-activity/dashboard' },
  { method: 'POST', path: '/api/agent/query' },
  { method: 'GET', path: '/api/admin/refresh-cache' },
  { method: 'GET', path: '/api/saved-reports' },
  { method: 'GET', path: '/api/games/pipeline-catcher/leaderboard' },
  { method: 'GET', path: '/api/games/pipeline-catcher/levels' },
  { method: 'POST', path: '/api/explore/feedback' },
];

// List of endpoints that SHOULD be accessible to recruiters
const ALLOWED_ENDPOINTS = [
  { method: 'POST', path: '/api/recruiter-hub/prospects' },
  { method: 'POST', path: '/api/recruiter-hub/opportunities' },
  { method: 'GET', path: '/api/recruiter-hub/external-agencies' },
  { method: 'GET', path: '/api/recruiter-hub/record-detail/00Q123456789' },
  { method: 'POST', path: '/api/users/me/change-password' },
  { method: 'GET', path: '/api/dashboard/data-freshness' },
];

describe('Recruiter Security', () => {
  describe('Forbidden Endpoints', () => {
    FORBIDDEN_ENDPOINTS.forEach(({ method, path }) => {
      it(`should return 403 for ${method} ${path}`, async () => {
        // This is a template - actual implementation depends on your test setup
        // You may need to:
        // 1. Mock the session to return recruiterSession
        // 2. Make an actual HTTP request or call the route handler directly
        // 3. Assert the response status is 403
        
        // Example with fetch (requires test server running):
        // const response = await fetch(`http://localhost:3000${path}`, { method });
        // expect(response.status).toBe(403);
        
        // Mark as TODO if test infrastructure isn't set up
        expect(true).toBe(true); // Placeholder
      });
    });
  });

  describe('Allowed Endpoints', () => {
    ALLOWED_ENDPOINTS.forEach(({ method, path }) => {
      it(`should allow ${method} ${path} for recruiters`, async () => {
        // Similar setup as above, but expect 200 or 404 (not 403)
        expect(true).toBe(true); // Placeholder
      });
    });
  });

  describe('Data Isolation', () => {
    it('should only return records matching recruiter agency', async () => {
      // Test that /api/recruiter-hub/prospects only returns
      // records where External_Agency__c matches the recruiter's agency
      expect(true).toBe(true); // Placeholder
    });

    it('should return 404 for record detail outside agency', async () => {
      // Test that /api/recruiter-hub/record-detail/[id] returns 404
      // for a record belonging to a different agency
      expect(true).toBe(true); // Placeholder
    });
  });
});
```

---

### Step 9.2: Validation

```bash
# If using vitest
npx vitest run src/__tests__/security/

# If using jest
npm test -- --testPathPattern=security
```

---

### 🧑‍💻 HUMAN CHECKPOINT — Phase 9 (FINAL)

**Agent completed:**
- [x] Created security test template
- [x] Listed all endpoints that should be tested

**Human action required:**
1. Review the test file structure
2. Implement actual test assertions based on your test infrastructure
3. Add tests to CI/CD pipeline

---

# Post-Implementation Verification Checklist

## Manual Testing (Do as Recruiter User)

1. **Login & Navigation**
   - [ ] Login as recruiter redirects to Recruiter Hub
   - [ ] Cannot navigate to `/dashboard` (redirects)
   - [ ] Cannot navigate to `/dashboard/explore` (redirects)
   - [ ] Can access `/dashboard/settings`

2. **API Access (Browser Console)**
   ```javascript
   // Should all return 403:
   fetch('/api/dashboard/funnel-metrics', {method:'POST'}).then(r=>console.log(r.status))
   fetch('/api/sga-hub/weekly-goals').then(r=>console.log(r.status))
   fetch('/api/games/pipeline-catcher/leaderboard').then(r=>console.log(r.status))
   fetch('/api/agent/query', {method:'POST'}).then(r=>console.log(r.status))
   ```

3. **Recruiter Hub Functionality**
   - [ ] Can view prospects list (only own agency)
   - [ ] Can view opportunities list (only own agency)
   - [ ] Can click row to open record detail modal
   - [ ] Modal shows correct data

4. **Data Isolation**
   - [ ] Cannot see other agencies' records (even by guessing IDs)
   - [ ] External agencies dropdown shows only own agency

## Automated Verification

```bash
# Full type check
npx tsc --noEmit

# Full lint
npm run lint

# Run security tests
npm test -- --testPathPattern=security

# Verify all forbidden endpoints use forbidRecruiter
grep -rn "forbidRecruiter" src/app/api/ | wc -l
# Should be 20+ files
```

---

# Summary of Changes

| Phase | Files Modified | Change | Status |
|-------|----------------|--------|--------|
| 1 | `src/app/api/games/pipeline-catcher/leaderboard/route.ts` | Added recruiter authorization (GET, POST, PATCH) + score validation | ✅ |
| 1 | `src/app/api/games/pipeline-catcher/levels/route.ts` | Added recruiter authorization | ✅ |
| 1 | `src/app/api/games/pipeline-catcher/play/[quarter]/route.ts` | Added recruiter authorization | ✅ |
| 2 | `src/app/api/explore/feedback/route.ts` | Added recruiter authorization | ✅ |
| 3 | `src/middleware.ts` | Added `/api/dashboard/record-detail` to allowlist | ✅ |
| 4 | `src/app/api/saved-reports/route.ts` | Added recruiter authorization (GET, POST) | ✅ |
| 4 | `src/app/api/saved-reports/[id]/route.ts` | Added recruiter authorization (GET, PUT, DELETE) | ✅ |
| 4 | `src/app/api/saved-reports/[id]/duplicate/route.ts` | Added recruiter authorization (POST) | ✅ |
| 5 | _No changes needed_ | GET handler already has proper permission checks | ✅ |
| 6 | `.cursorrules` | Added recruiter security rules section | ✅ |
| 7 | 12 dashboard API routes + agent/query | Refactored to use `forbidRecruiter()` helper | ✅ |
| 8 | `src/app/api/recruiter-hub/external-agencies/route.ts` | Filter agency list for recruiters | ✅ |
| 9 | `src/__tests__/security/recruiter-access.test.ts` | Security tests (template in plan) | ⏳ Optional |

---

# Future Maintenance Guidelines

1. **New API Routes**: Always add `forbidRecruiter()` check unless explicitly for recruiters
2. **New Recruiter Features**: Always filter by `permissions.recruiterFilter`
3. **Middleware Changes**: Document any allowlist additions with security rationale
4. **Code Reviews**: Check for recruiter security in all API route PRs
5. **Periodic Audits**: Re-run security audit quarterly

---

## Document Metadata

- **Created:** 2026-01-28
- **Last Reviewed:** 2026-01-28 by Claude Code Opus 4.5
- **Based On:** Recruiter Security Audit (completed same day)
- **Estimated Implementation Time:** 3-4 hours
- **Risk Level:** Low (defensive additions, no breaking changes)

## Files Verified During Review

The following files were read and analyzed to ensure plan accuracy:

| File | Status | Notes |
|------|--------|-------|
| `src/middleware.ts` | Verified | Allowlist logic confirmed |
| `src/lib/api-authz.ts` | Verified | `forbidRecruiter()` helper exists and is correctly implemented |
| `src/app/api/dashboard/record-detail/[id]/route.ts` | Verified | Already has proper recruiter filtering (lines 49-58) |
| `src/app/api/games/pipeline-catcher/leaderboard/route.ts` | Verified | Missing authorization - needs fix |
| `src/app/api/explore/feedback/route.ts` | Verified | Missing authorization - needs fix |
| `src/app/api/saved-reports/route.ts` | Verified | Missing recruiter block - needs fix |
| `src/app/api/saved-reports/[id]/route.ts` | Verified | Missing recruiter block in GET - needs fix |
| `src/app/api/saved-reports/[id]/duplicate/route.ts` | Verified | Missing authorization entirely - needs fix |
| `src/app/api/recruiter-hub/opportunities/route.ts` | Verified | GET handler already correct - no changes needed |
| `src/app/dashboard/recruiter-hub/RecruiterHubContent.tsx` | Verified | Uses `RecordDetailModal` correctly |
| `src/components/dashboard/RecordDetailModal.tsx` | Verified | Uses `dashboardApi.getRecordDetail()` |
| `src/lib/api-client.ts` | Verified | `getRecordDetail` calls `/api/dashboard/record-detail/[id]` |
