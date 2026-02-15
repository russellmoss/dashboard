# Per-User Page Access Overrides — Codebase Investigation

> **Purpose:** This document contains phased investigation questions that Claude Code must execute against the Savvy Dashboard repo (`russellmoss/dashboard`) **before** writing the implementation guide for per-user page access overrides. Each phase targets a specific architectural concern. Answers should be recorded inline so this document becomes the codebase knowledge base for implementation.
>
> **Scope:** This document covers **page access toggles only** — the ability for an admin to grant or revoke access to specific dashboard pages on a per-user basis, overriding their role's defaults. A separate follow-up document will cover read-only vs. edit enforcement.
>
> **Why this matters:** The current permission system is purely role-based (`ROLE_PERMISSIONS` in `src/lib/permissions.ts`). Every user with the same role sees the same pages. This upgrade adds a per-user override layer stored in Neon/Postgres via Prisma, which means we're touching the permission resolution chain from database → JWT → session → sidebar → route protection → API authorization. If we don't understand every touchpoint, overrides will work in some places and silently fail in others.
>
> **How to use:** Execute each phase sequentially. Use `cat`, `grep`, `find`, and file reads against the repo. Record exact file paths, line numbers, function signatures, and code snippets. Do NOT skip any question — gaps here become bugs in implementation.

---

## Phase 1: Current Permission System — Complete Inventory

**Goal:** Map every file and function involved in the current permission system so we know exactly what to modify.

### 1.1 — ROLE_PERMISSIONS Complete State
- **File:** `src/lib/permissions.ts`
- **Question:** Paste the complete current `ROLE_PERMISSIONS` object including all roles. Confirm: how many roles exist? What is the full list of page IDs in use across all roles? Are there any page IDs referenced in `ROLE_PERMISSIONS` that do NOT appear in the `PAGES` array in the Sidebar?
- **Why:** We need a complete baseline of what "default" looks like for every role before we layer overrides on top. Any orphaned page IDs could cause confusion.
- **Finding:**

**File:** `src/lib/permissions.ts` (lines 13-70)

**Complete ROLE_PERMISSIONS object:**
```typescript
export const ROLE_PERMISSIONS: Record<string, Omit<UserPermissions, 'sgaFilter' | 'sgmFilter' | 'recruiterFilter' | 'capitalPartnerFilter' | 'userId'>> = {
  revops_admin: {
    role: 'revops_admin',
    allowedPages: [1, 3, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],  // All pages + 14 = Chart Builder, 15 = Advisor Map, 16 = GC Hub
    canExport: true,
    canManageUsers: true,
    canManageRequests: true,  // Only role that can manage requests
  },
  admin: {
    role: 'admin',
    allowedPages: [1, 3, 7, 8, 9, 10, 11, 12, 13, 15, 16],  // 15 = Advisor Map, 16 = GC Hub (Chart Builder restricted to revops_admin)
    canExport: true,
    canManageUsers: true,
    canManageRequests: false,
  },
  manager: {
    role: 'manager',
    allowedPages: [1, 3, 7, 8, 9, 10, 11, 12, 13, 15],  // 15 = Advisor Map (Chart Builder restricted to revops_admin)
    canExport: true,
    canManageUsers: false,
    canManageRequests: false,
  },
  sgm: {
    role: 'sgm',
    allowedPages: [1, 3, 7, 10, 13, 15],  // 15 = Advisor Map (Chart Builder restricted to revops_admin)
    canExport: true,
    canManageUsers: false,
    canManageRequests: false,
  },
  sga: {
    role: 'sga',
    allowedPages: [1, 3, 7, 8, 10, 11, 13, 15],  // 15 = Advisor Map (Chart Builder restricted to revops_admin)
    canExport: true,
    canManageUsers: false,
    canManageRequests: false,
  },
  viewer: {
    role: 'viewer',
    allowedPages: [1, 3, 7, 10, 13, 15],  // 13 = Dashboard Requests, 15 = Advisor Map
    canExport: false,
    canManageUsers: false,
    canManageRequests: false,
  },
  recruiter: {
    role: 'recruiter',
    allowedPages: [7, 12],  // Settings (7) + Recruiter Hub (12) only - NO Dashboard Requests, NO Advisor Map
    canExport: true,
    canManageUsers: false,
    canManageRequests: false,
  },
  capital_partner: {
    role: 'capital_partner',
    allowedPages: [7, 16],  // Settings (7) + GC Hub (16) only
    canExport: true,         // Can export anonymized CSV
    canManageUsers: false,
    canManageRequests: false,
  },
};
```

**Summary:**
- **8 roles exist:** `revops_admin`, `admin`, `manager`, `sgm`, `sga`, `viewer`, `recruiter`, `capital_partner`
- **All page IDs in ROLE_PERMISSIONS:** 1, 3, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16
- **Page IDs in Sidebar PAGES array:** 1, 3, 7, 8, 9, 10, 12, 13, 14, 15, 16

**⚠️ ORPHANED PAGE ID DISCOVERED:** Page 11 appears in allowedPages for `revops_admin`, `admin`, `manager`, and `sga` but does NOT exist in the Sidebar `PAGES` array (lines 49-61). This is a dead reference — no page with id=11 is displayed in the Sidebar.

### 1.2 — Permission Resolution Functions
- **File:** `src/lib/permissions.ts`
- **Question:** Paste the complete `getPermissionsFromToken()` and `getUserPermissions()` functions. For each: what are the inputs, what does it return, and where is it called from? Use `grep -rn "getPermissionsFromToken\|getUserPermissions" src/` to find all call sites.
- **Why:** These are the two functions we'll modify to merge per-user overrides. We need to know every call site to ensure the override logic propagates everywhere.
- **Finding:**

**File:** `src/lib/permissions.ts` (lines 77-88, 95-123)

**`getPermissionsFromToken()` — Complete function:**
```typescript
export function getPermissionsFromToken(tokenData: TokenUserData): UserPermissions {
  const basePermissions = ROLE_PERMISSIONS[tokenData.role] || ROLE_PERMISSIONS.viewer;

  return {
    ...basePermissions,
    sgaFilter: tokenData.role === 'sga' ? tokenData.name : null,
    sgmFilter: tokenData.role === 'sgm' ? tokenData.name : null,
    recruiterFilter: tokenData.role === 'recruiter' ? (tokenData.externalAgency ?? null) : null,
    capitalPartnerFilter: tokenData.role === 'capital_partner' ? (tokenData.externalAgency ?? null) : null,
    userId: tokenData.id,
  };
}
```
- **Input:** `TokenUserData` (id, email, name, role, externalAgency)
- **Returns:** `UserPermissions` (spreads role defaults + adds filter fields + userId)
- **Call sites:**
  - `src/lib/auth.ts:140` — in the session callback

**`getUserPermissions()` — Complete function:**
```typescript
export async function getUserPermissions(email: string): Promise<UserPermissions> {
  const user = await getUserByEmail(email);

  if (!user) {
    return {
      role: 'viewer',
      allowedPages: [1, 3, 7, 10],
      sgaFilter: null,
      sgmFilter: null,
      recruiterFilter: null,
      capitalPartnerFilter: null,
      canExport: false,
      canManageUsers: false,
      canManageRequests: false,
      userId: null,
    };
  }

  const basePermissions = ROLE_PERMISSIONS[user.role] || ROLE_PERMISSIONS.viewer;

  return {
    ...basePermissions,
    sgaFilter: user.role === 'sga' ? user.name : null,
    sgmFilter: user.role === 'sgm' ? user.name : null,
    recruiterFilter: user.role === 'recruiter' ? (user.externalAgency ?? null) : null,
    capitalPartnerFilter: user.role === 'capital_partner' ? (user.externalAgency ?? null) : null,
    userId: user.id,
  };
}
```
- **Input:** `email: string`
- **Returns:** `Promise<UserPermissions>` (fetches user from DB, then computes permissions)
- **Call sites:** None found! Only mentioned in a comment in `src/lib/api-authz.ts:6`. This function exists but is UNUSED.

**Key insight:** Only `getPermissionsFromToken()` is actually called (in auth.ts session callback). The `getUserPermissions()` function is dead code. All permission resolution goes through the token-based path.

### 1.3 — canAccessPage Helper
- **File:** `src/lib/permissions.ts`
- **Question:** Paste the `canAccessPage()` function. Use `grep -rn "canAccessPage" src/` to find every call site. Is it used in middleware, API routes, page components, or all three?
- **Why:** This is the most likely single enforcement point. If all page access checks go through this function, our override only needs to modify the `allowedPages` array before it reaches this function. If some checks bypass it, we have a gap.
- **Finding:**

**File:** `src/lib/permissions.ts` (lines 125-127)

**`canAccessPage()` — Complete function:**
```typescript
export function canAccessPage(permissions: UserPermissions, pageNumber: number): boolean {
  return permissions.allowedPages.includes(pageNumber);
}
```
- **Input:** `permissions: UserPermissions`, `pageNumber: number`
- **Returns:** `boolean`
- **Call sites:** **NONE** — This function is exported but never called anywhere in the codebase!

**Key insight:** `canAccessPage` is dead code. The codebase does NOT use a centralized page access check function. Instead, permission checks are done inline using `permissions.allowedPages.includes(pageId)` directly at each check site. This is important — there's no single enforcement point to modify.

### 1.4 — Permission Type Definitions
- **File:** `src/types/user.ts`
- **Question:** Paste the complete `UserPermissions` interface. Also paste the `UserRole` type. Are there any other interfaces or types in this file that reference `allowedPages` or `role`?
- **Why:** We may need to extend `UserPermissions` with an `overriddenPages` field or a flag indicating overrides are active, so the UI can show "custom" vs "role default."
- **Finding:**

**File:** `src/types/user.ts` (complete file, 52 lines)

**`UserRole` type (line 2):**
```typescript
export type UserRole = 'admin' | 'manager' | 'sgm' | 'sga' | 'viewer' | 'recruiter' | 'revops_admin' | 'capital_partner';
```

**`UserPermissions` interface (lines 17-28):**
```typescript
export interface UserPermissions {
  role: UserRole;
  allowedPages: number[];
  sgaFilter: string | null;  // If SGA, filter to their records
  sgmFilter: string | null;  // If SGM, filter to their team
  recruiterFilter: string | null;  // If recruiter, filter to their agency
  capitalPartnerFilter?: string | null;  // If capital_partner, filter to their company (stored in externalAgency)
  canExport: boolean;
  canManageUsers: boolean;
  canManageRequests: boolean;  // RevOps Admin only - manage Dashboard Requests
  userId?: string | null;  // User ID for API routes that need it
}
```

**Other interfaces referencing `role`:**
- `User` interface (lines 4-15) — has `role: UserRole`
- `SafeUser` interface (lines 31-41) — has `role: UserRole` (API response, no passwordHash)
- `UserInput` interface (lines 44-51) — has `role: UserRole` (create/update input)

**Key insight:** The `UserPermissions` interface has no field for tracking overrides. To show "custom" vs "role default" in the UI, we'd need to add something like `hasCustomOverrides?: boolean` or `pageOverrides?: Record<number, boolean>`.

### 1.5 — Auth Types & Session Extension
- **File:** `src/types/auth.ts`
- **Question:** Paste the complete file. How is `ExtendedSession` defined? What does `getSessionPermissions()` return? Use `grep -rn "getSessionPermissions" src/` to find all call sites.
- **Why:** Session permissions are the client-side source of truth. If overrides aren't in the session, client components won't know about them.
- **Finding:**

**File:** `src/types/auth.ts` (complete file, 31 lines)

```typescript
import { Session } from 'next-auth';
import { UserPermissions } from './user';

// Extended session with permissions attached
export interface ExtendedSession extends Session {
  permissions?: UserPermissions;
}

// Type guard to check if session has permissions
export function hasPermissions(
  session: Session | ExtendedSession | null | undefined
): session is ExtendedSession & { permissions: UserPermissions } {
  return (
    session !== null &&
    session !== undefined &&
    'permissions' in session &&
    session.permissions !== undefined &&
    session.permissions !== null
  );
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

**`getSessionPermissions()` call sites (widespread usage — 27+ locations):**
- `src/components/layout/Sidebar.tsx:72`
- `src/app/login/page.tsx:58`
- `src/components/dashboard/DataFreshnessIndicator.tsx:43`
- `src/app/dashboard/chart-builder/page.tsx:32`
- `src/app/dashboard/sga-management/page.tsx:19`
- `src/app/dashboard/advisor-map/page.tsx:32`
- `src/app/dashboard/sga-hub/SGAHubContent.tsx:36`
- `src/app/dashboard/layout.tsx` (multiple locations)
- Many more components and pages...

**Key insight:** `getSessionPermissions()` is THE standard way components access permissions. It's heavily used throughout the codebase. The `ExtendedSession` interface attaches `permissions?: UserPermissions` to the Next-Auth session. If we modify `UserPermissions` to include override info, it will automatically flow to all these call sites.

---

## Phase 2: JWT & Session Pipeline

**Goal:** Understand exactly how permissions flow from database → JWT token → session → client, so we know where to inject per-user overrides.

### 2.1 — NextAuth Configuration
- **File:** `src/lib/auth.ts`
- **Question:** Paste the complete `authOptions` object, focusing on:
  1. The `credentials` provider — how does it authenticate and what user data does it fetch?
  2. The `jwt` callback — what fields are written into the token? Is `allowedPages` baked into the JWT, or just the role?
  3. The `session` callback — how does it build the session from the token? Does it call `getPermissionsFromToken()` or `getUserPermissions()`?
- **Why:** This is the critical question: are permissions computed at login time (JWT) or on every request (session callback)? If they're baked into the JWT at login, a user's overrides won't take effect until they re-login. We need to decide if that's acceptable or if we need to change the resolution strategy.
- **Finding:**

**File:** `src/lib/auth.ts` (complete file, 210 lines)

**1. Credentials Provider (lines 58-103):**
```typescript
async authorize(credentials) {
  // ... rate limiting, validation ...
  const user = await validateUser(credentials.email, credentials.password);
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };
}
```
- Authenticates via `validateUser()` from `./users`
- Returns basic user data (id, email, name, role) — NOT allowedPages

**2. JWT Callback (lines 145-198):**
```typescript
async jwt({ token, user }) {
  if (user) {
    token.email = user.email;
    // ... fetches from DB or uses cached data ...
    token.id = dbUser.id;
    token.name = dbUser.name;
    token.role = dbUser.role;
    token.externalAgency = dbUser.externalAgency ?? null;
  }
  // Backfill for existing JWTs missing data
  // ...
  return token;
}
```
- On sign-in: stores `id`, `email`, `name`, `role`, `externalAgency` in JWT
- **`allowedPages` is NOT stored in the JWT** — only the role string

**3. Session Callback (lines 125-144):**
```typescript
async session({ session, token }) {
  if (session.user) {
    (session.user as { id?: string }).id = (token.sub ?? token.id) as string;

    const tokenData: TokenUserData = {
      id: (token.id as string) || (token.sub as string) || '',
      email: (token.email as string) || '',
      name: (token.name as string) || '',
      role: ((token.role as string) || 'viewer') as UserRole,
      externalAgency: (token.externalAgency as string | null) || null,
    };

    const permissions = getPermissionsFromToken(tokenData);
    (session as ExtendedSession).permissions = permissions;
  }
  return session;
}
```
- Builds `TokenUserData` from JWT fields
- Calls `getPermissionsFromToken(tokenData)` to compute permissions
- Attaches computed `permissions` to session

**CRITICAL ANSWER:** Permissions are **computed on every session request** via `getPermissionsFromToken()`. However, the computation uses ONLY data from the JWT (role) — it looks up `ROLE_PERMISSIONS[role]` to get `allowedPages`. No DB query occurs in the session callback.

**Implication for overrides:** If we want page overrides to take effect without re-login, we have two options:
1. **Store overrides in JWT** — baked at login, fast, but stale until next login
2. **Query DB in session callback** — always fresh, but adds latency to every authenticated request

### 2.2 — Token Refresh Behavior
- **File:** `src/lib/auth.ts`
- **Question:** Is there any token refresh logic? What is the JWT `maxAge`? If an admin changes a user's page overrides, when does it take effect — next login, next page load, or immediately?
- **Why:** This directly affects UX. If overrides are JWT-baked, we may need a "force re-auth" mechanism or accept that changes take effect on next login (24hr max based on current session config).
- **Finding:**

**File:** `src/lib/auth.ts` (lines 204-207)

```typescript
session: {
  strategy: 'jwt',
  maxAge: 24 * 60 * 60, // 24 hours
},
```

**Token refresh behavior:**
- **JWT strategy** — no server-side session store
- **maxAge: 24 hours** — JWT expires after 24 hours, forcing re-login
- **No explicit refresh logic** — JWT is created at login and used until expiry
- **Backfill mechanism (lines 182-195):** Runs if `role` or `externalAgency` is missing from token. This is a migration path for old tokens, NOT a refresh mechanism.

**When do override changes take effect?**
- If overrides are stored in JWT: **Next login** (up to 24 hours delay)
- If we add a DB query to session callback: **Immediately on next page load**

**No "force re-auth" mechanism exists** — if an admin changes a user's overrides while they're logged in, the user would need to log out and back in to see the change (if JWT-baked approach is used).

### 2.3 — Token Data Structure
- **File:** `src/lib/permissions.ts`
- **Question:** Paste the `TokenUserData` interface. What fields are currently stored in the JWT? Is there room to add an `pageOverrides` field, or would that bloat the token unacceptably?
- **Why:** JWTs are sent with every request. If we store per-user page overrides in the JWT (e.g., `{pageId: 8, hasAccess: false}`), the token grows. We need to estimate the size impact — if a user has 5 overrides, that's maybe 100 bytes. If 20, it could matter.
- **Finding:**

**File:** `src/lib/permissions.ts` (lines 5-11)

```typescript
export interface TokenUserData {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  externalAgency?: string | null;
}
```

**Current JWT fields stored:**
- `id` (string, ~36 bytes for UUID)
- `email` (string, ~30 bytes typical)
- `name` (string, ~20 bytes typical)
- `role` (string, ~15 bytes max)
- `externalAgency` (string | null, 0-30 bytes)

**Size impact analysis for overrides:**
- Current estimated token payload: ~130 bytes (plus JWT overhead)
- If we add `pageOverrides: { [pageId]: boolean }`:
  - 5 overrides: `{"8":false,"14":false,"15":true,"16":false,"12":true}` ≈ 50 bytes
  - 10 overrides: ≈ 100 bytes
  - All 12 pages: ≈ 120 bytes

**Verdict:** Adding page overrides to JWT is feasible. Even with maximum overrides, we'd roughly double the payload size (~250 bytes total). This is well within acceptable limits for JWTs (browsers typically handle headers up to 8KB).

**Alternative:** Store only a `hasOverrides: boolean` flag in JWT, then fetch overrides from DB only when `hasOverrides === true`. This keeps JWT small but adds a conditional DB query.

### 2.4 — usePermissions Client Hook
- **Question:** Search for how client components access permissions. Run: `grep -rn "usePermissions\|useSession\|permissions\." src/components/ src/app/dashboard/` and identify the primary pattern. Is there a custom hook, or do components use `useSession()` directly?
- **Why:** Client components need the resolved `allowedPages` (with overrides applied) to conditionally render UI elements. We need to know if there's a single hook to modify or if permissions are accessed in many different ways.
- **Finding:**

**No custom `usePermissions` hook exists.**

**Standard pattern used across the codebase:**
```typescript
import { useSession } from 'next-auth/react';
import { getSessionPermissions } from '@/types/auth';

// In component:
const { data: session } = useSession();
const permissions = getSessionPermissions(session);

// Then access:
permissions?.allowedPages.includes(pageId)
permissions?.role
permissions?.canExport
```

**Call sites using this pattern (partial list):**
- `src/components/layout/Sidebar.tsx:71-72`
- `src/app/dashboard/layout.tsx:17`
- `src/app/dashboard/page.tsx:257-258`
- `src/app/dashboard/chart-builder/page.tsx:32`
- `src/app/dashboard/sga-hub/page.tsx:17`
- `src/app/dashboard/sga-hub/SGAHubContent.tsx:35-36`
- `src/app/dashboard/settings/page.tsx:14-15`
- `src/app/dashboard/advisor-map/page.tsx:32`
- `src/app/dashboard/gc-hub/page.tsx:17`
- ... and many more

**Key insight:** The pattern is consistent — `useSession()` + `getSessionPermissions()`. Since `getSessionPermissions()` just extracts `session.permissions`, any changes to how `permissions` is computed in the session callback will automatically propagate to all these components. No custom hook modification needed.

---

## Phase 3: Sidebar & Client-Side Route Protection

**Goal:** Understand exactly how the sidebar renders and how client-side route guards work, so overrides affect both.

### 3.1 — Sidebar Page Filtering
- **File:** `src/components/layout/Sidebar.tsx`
- **Question:** Paste the complete filtering logic that determines which pages appear in the sidebar. Does it read from `session.permissions.allowedPages`? Is there any additional filtering beyond `allowedPages` (e.g., feature flags, environment checks)?
- **Why:** If the sidebar purely reads `allowedPages` from the session, then our override just needs to modify `allowedPages` before it reaches the session and the sidebar "just works." If there's additional logic, we need to account for it.
- **Finding:**

**File:** `src/components/layout/Sidebar.tsx` (lines 69-75)

```typescript
export function Sidebar({ isCollapsed, onToggle, allowedPagesOverride }: SidebarProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const permissions = getSessionPermissions(session);
  const allowedPages = allowedPagesOverride || permissions?.allowedPages || [1, 2];

  const filteredPages = PAGES.filter(page => allowedPages.includes(page.id));
  // ...
}
```

**Filtering logic:**
1. Gets session via `useSession()`
2. Extracts permissions via `getSessionPermissions(session)`
3. Uses `allowedPagesOverride` prop if provided, otherwise `permissions?.allowedPages`, fallback `[1, 2]`
4. Filters `PAGES` array: `PAGES.filter(page => allowedPages.includes(page.id))`

**Additional filtering beyond allowedPages:** None. The sidebar purely uses `allowedPages.includes(page.id)`.

**Key insight:** The sidebar will "just work" with overrides. If we modify `permissions.allowedPages` in the session callback to include overrides, the sidebar will automatically show/hide pages correctly. The `allowedPagesOverride` prop exists but appears to be for testing/preview purposes.

### 3.2 — Dashboard Layout Route Guards
- **File:** `src/app/dashboard/layout.tsx`
- **Question:** Paste the complete route protection logic — both the `useEffect` redirect and the render guard (flash prevention). List every role-specific check (recruiter, capital_partner, etc.). Is there a generic `allowedPages` check for all roles, or is each restricted role handled with its own explicit block?
- **Why:** Critical question: does the layout do a generic "is this page in the user's allowedPages?" check, or does it only have hardcoded blocks for recruiter and capital_partner? If it's hardcoded per-role, overrides for admin/manager users won't be enforced at the layout level.
- **Finding:**

**File:** `src/app/dashboard/layout.tsx` (complete file, 124 lines)

**Permission loading (lines 29-58):**
```typescript
useEffect(() => {
  async function loadPermissions() {
    // ...
    const res = await fetch('/api/auth/permissions');
    const data = (await res.json()) as UserPermissions;
    if (!cancelled) setPermissions(data);
  }
  loadPermissions();
}, [session?.user?.email, status]);
```
- **Fetches permissions via API call** (`/api/auth/permissions`), NOT from session directly
- This is a separate fetch that could potentially include overrides

**Recruiter route guard (lines 61-73):**
```typescript
useEffect(() => {
  if (permissionsLoading) return;
  if (!permissions) return;
  if (permissions.role !== 'recruiter') return;  // <-- ROLE CHECK

  const allowed =
    pathname.startsWith('/dashboard/recruiter-hub') ||
    pathname.startsWith('/dashboard/settings');

  if (!allowed) {
    router.replace('/dashboard/recruiter-hub');
  }
}, [permissions, permissionsLoading, pathname, router]);
```

**Capital partner route guard (lines 76-88):** Same pattern, checks `role === 'capital_partner'`

**Flash prevention render guards (lines 90-104):** Also role-specific

**⚠️ CRITICAL GAP: No generic `allowedPages` check!**

The layout only has hardcoded role checks for `recruiter` and `capital_partner`. There is NO generic check like:
```typescript
if (!permissions.allowedPages.includes(currentPageId)) {
  router.replace('/dashboard');
}
```

**Impact:** If an admin user's access to page 14 (Chart Builder) is overridden/removed:
- ✅ Sidebar will NOT show Chart Builder (uses `allowedPages`)
- ❌ Layout will NOT block direct URL access (no generic check)
- The page component itself must enforce access

**Recommendation:** Add a generic `allowedPages` check to the layout for all roles, or ensure every page component enforces its own access.

### 3.3 — Server-Side Page Protection Pattern
- **Question:** Pick 3 different page server components and paste their permission checks. Suggested files:
  1. `src/app/dashboard/sga-hub/page.tsx`
  2. `src/app/dashboard/chart-builder/page.tsx`
  3. `src/app/dashboard/requests/page.tsx`
  
  For each: How does it get permissions? Does it check `allowedPages.includes(pageId)`? Does it check specific roles? Does it redirect or return 403?
- **Why:** We need to know if server components use a consistent pattern (checking `allowedPages`) or if some use role checks directly. If a page checks `role === 'admin'` instead of `allowedPages.includes(14)`, our override won't affect it.
- **Finding:**

**1. SGA Hub (`src/app/dashboard/sga-hub/page.tsx`, lines 22-25) — ROLE CHECK ONLY:**
```typescript
// Only SGA, SGM, admin, manager, and revops_admin roles can access
if (!['admin', 'manager', 'sga', 'sgm', 'revops_admin'].includes(permissions.role)) {
  redirect('/dashboard');
}
```
- ❌ Does NOT check `allowedPages.includes(8)`
- Uses hardcoded role whitelist
- **Overrides would NOT be enforced here**

**2. Chart Builder (`src/app/dashboard/chart-builder/page.tsx`, lines 21, 38-46) — USES allowedPages:**
```typescript
const PAGE_ID = 14;
// ...
if (permissions.role === 'recruiter') {
  redirect('/dashboard/recruiter-hub');
}
if (!permissions.allowedPages.includes(PAGE_ID)) {
  redirect('/dashboard');
}
```
- ✅ Defines `PAGE_ID = 14` constant
- ✅ Checks `allowedPages.includes(PAGE_ID)`
- Also has recruiter role check as belt-and-suspenders
- **Overrides WOULD be enforced here**

**3. Dashboard Requests (`src/app/dashboard/requests/page.tsx`, lines 22-30) — USES allowedPages:**
```typescript
if (permissions.role === 'recruiter') {
  redirect('/dashboard/recruiter-hub');
}
if (!permissions.allowedPages.includes(13)) {
  redirect('/dashboard');
}
```
- ✅ Checks `allowedPages.includes(13)`
- Also has recruiter role check
- **Overrides WOULD be enforced here**

**Summary:** Mixed patterns across pages:
- ✅ Chart Builder, Requests: Use `allowedPages.includes(pageId)` — overrides will work
- ❌ SGA Hub: Uses role whitelist only — overrides will NOT work without modification

### 3.4 — Generic Page Access Check
- **Question:** Is there a shared utility or pattern used across page server components for access control? Run: `grep -rn "allowedPages\|canAccessPage\|includes(" src/app/dashboard/*/page.tsx` to see how each page checks access.
- **Why:** If every page uses `permissions.allowedPages.includes(pageId)`, we're in great shape — modify `allowedPages` once and it flows everywhere. If pages use mixed patterns, we need to standardize first.
- **Finding:**

**Pages using `allowedPages.includes(pageId)` — overrides WILL work:**
| Page | File | Check |
|------|------|-------|
| Chart Builder (14) | `chart-builder/page.tsx:44` | `allowedPages.includes(PAGE_ID)` |
| GC Hub (16) | `gc-hub/page.tsx:23` | `allowedPages.includes(16)` |
| Dashboard Requests (13) | `requests/page.tsx:28` | `allowedPages.includes(13)` |
| Recruiter Hub (12) | `recruiter-hub/page.tsx:23` | `allowedPages.includes(12)` |
| Explore (10) | `explore/page.tsx:28` | `allowedPages.includes(10)` |
| Advisor Map (15) | `advisor-map/page.tsx:44` | `allowedPages.includes(PAGE_ID)` |

**Pages using ROLE CHECK ONLY — overrides will NOT work:**
| Page | File | Check |
|------|------|-------|
| SGA Hub (8) | `sga-hub/page.tsx:23` | `['admin','manager','sga','sgm','revops_admin'].includes(role)` |
| SGA Management (9) | `sga-management/page.tsx:25` | `['admin','manager','revops_admin'].includes(role)` |
| SGA Activity | `sga-activity/page.tsx:23` | `['admin','manager','sga','sgm','revops_admin'].includes(role)` |

**Pages with NO page-level protection (auth only):**
| Page | File | Notes |
|------|------|-------|
| Settings (7) | `settings/page.tsx` | Client component, auth check only — all roles have page 7 |
| Pipeline (3) | `pipeline/page.tsx` | Client component, no permission check |
| Funnel (1) | `page.tsx` | Client component, no permission check |

**⚠️ MIXED PATTERNS — Standardization needed before implementing overrides.**

To make overrides work consistently, pages currently using role-only checks need to be migrated to `allowedPages.includes(pageId)` pattern.

---

## Phase 4: API Route Protection

**Goal:** Ensure that per-user page overrides are enforced at the API level, not just the UI. A user who loses page access via override should also lose access to that page's API routes.

### 4.1 — API Route Inventory
- **Question:** Run `find src/app/api -name "route.ts" | sort` and list every API route. For each, note which dashboard page it serves (if obvious from the path).
- **Why:** We need a complete map of API routes → pages so we can determine which routes need page-access checks when overrides remove a page.
- **Finding:**

**Total: 86 API routes found.** Grouped by associated page:

| Page | API Route Prefix | Route Count |
|------|------------------|-------------|
| Auth (no page) | `/api/auth/*` | 4 |
| Admin | `/api/admin/*` | 3 |
| Advisor Map (15) | `/api/advisor-map/*` | 2 |
| Explore (10) | `/api/agent/query`, `/api/explore/*` | 2 |
| Cron (internal) | `/api/cron/*` | 4 |
| Funnel/Pipeline (1,3) | `/api/dashboard/*` | 14 |
| Dashboard Requests (13) | `/api/dashboard-requests/*` | 11 |
| Games (easter egg) | `/api/games/*` | 3 |
| GC Hub (16) | `/api/gc-hub/*` | 9 |
| Chart Builder (14) | `/api/metabase/*` | 1 |
| Notifications | `/api/notifications/*` | 4 |
| Recruiter Hub (12) | `/api/recruiter-hub/*` | 3 |
| Saved Reports | `/api/saved-reports/*` | 5 |
| SGA Activity (11?) | `/api/sga-activity/*` | 4 |
| SGA Hub (8) | `/api/sga-hub/*` | 13 |
| User Management (7) | `/api/users/*` | 4 |
| Webhooks (internal) | `/api/webhooks/*` | 1 |

**Key insight:** Page-specific API routes exist for: SGA Hub (8), Explore (10), SGA Activity (11?), Recruiter Hub (12), Dashboard Requests (13), Chart Builder (14), Advisor Map (15), GC Hub (16). Each of these route groups should enforce their page's access control.

### 4.2 — API Auth Patterns
- **Question:** Pick 3 API routes that serve different pages and paste their auth/permission checking logic. Suggested:
  1. `src/app/api/sga-hub/weekly-goals/route.ts` (SGA Hub — page 8)
  2. `src/app/api/requests/route.ts` (Dashboard Requests — page 13)
  3. An API route for Chart Builder or Advisor Map if they exist
  
  For each: Does it check `allowedPages`? Does it check role directly? Does it use `forbidRecruiter()` or similar?
- **Why:** If API routes check role rather than `allowedPages`, a user with an admin role whose page 8 access has been overridden could still hit the SGA Hub API. This is a security gap.
- **Finding:**

**1. SGA Hub Weekly Goals (`src/app/api/sga-hub/weekly-goals/route.ts`) — ROLE CHECK ONLY:**
```typescript
// Line 46, 52
if (!['admin', 'manager', 'revops_admin'].includes(permissions.role)) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
// Line 119
if (!['admin', 'manager', 'sga', 'sgm', 'revops_admin'].includes(permissions.role)) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
```
- ❌ Does NOT check `allowedPages.includes(8)`
- Uses hardcoded role whitelist
- **Overrides would NOT be enforced**

**2. Dashboard Requests (`src/app/api/dashboard-requests/route.ts`) — ROLE CHECK ONLY:**
```typescript
// Lines 29-31
if (permissions.role === 'recruiter') {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
```
- ❌ Does NOT check `allowedPages.includes(13)`
- Only blocks recruiter role explicitly
- **Overrides would NOT be enforced** (any non-recruiter can access)

**3. Metabase/Chart Builder (`src/app/api/metabase/content/route.ts`) — USES allowedPages ✅:**
```typescript
const PAGE_ID = 14; // Chart Builder page
// Lines 31-35
const permissions = getSessionPermissions(session);
if (!permissions || !permissions.allowedPages.includes(PAGE_ID)) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
```
- ✅ Defines `PAGE_ID = 14` constant
- ✅ Checks `allowedPages.includes(PAGE_ID)`
- **Overrides WOULD be enforced**

**⚠️ MIXED PATTERNS — Most API routes use role checks, not allowedPages checks.**

The Chart Builder API is the exception that follows the correct pattern. SGA Hub and Dashboard Requests APIs would allow users with overridden page access to still hit the APIs.

### 4.3 — forbidRecruiter / forbidCapitalPartner Pattern
- **File:** `src/lib/api-authz.ts` (or wherever these live)
- **Question:** Paste all "forbid" functions. How are they called in API routes? Is there a generic `forbidPageAccess(session, pageId)` function, or is each role handled separately?
- **Why:** Ideally we'd have or create a generic `requirePageAccess(session, pageId)` function that checks the resolved `allowedPages` (with overrides). If the pattern is role-specific forbid functions, we need to either refactor or add a new layer.
- **Finding:**

**File:** `src/lib/api-authz.ts` (complete file, 26 lines)

```typescript
export function forbidRecruiter(permissions: UserPermissions) {
  if (permissions.role !== 'recruiter') return null;
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

export function forbidCapitalPartner(permissions: UserPermissions) {
  if (permissions.role !== 'capital_partner') return null;
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
```

**Usage across codebase:** Used in 15+ API routes as defense-in-depth:
- `/api/games/pipeline-catcher/*` (3 routes)
- `/api/explore/feedback`
- `/api/advisor-map/locations`
- `/api/agent/query`
- `/api/dashboard/*` (10 routes)
- `/api/saved-reports/*` (4 routes)

**No generic `requirePageAccess(session, pageId)` function exists.**

The current pattern is role-based blocking only. There's no facility for page-based API protection.

**Recommendation:** Create a new helper function:
```typescript
export function requirePageAccess(permissions: UserPermissions, pageId: number) {
  if (!permissions.allowedPages.includes(pageId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return null;
}
```
This would allow API routes to enforce page-level access that respects overrides.

### 4.4 — Middleware API Route Protection
- **File:** `src/middleware.ts`
- **Question:** Paste the complete middleware file. Focus on: How does it handle API route protection? Is there a generic allowedPages check at the middleware level, or is it all role-specific? Does middleware have access to the full session/permissions, or just the JWT token?
- **Why:** Middleware runs before API route handlers. If we can enforce page-access overrides at the middleware level, it's a single enforcement point. If middleware only has the raw JWT (without resolved overrides), we'll need a different strategy.
- **Finding:**

**File:** `src/middleware.ts` (complete file, 120 lines)

**What middleware has access to:**
```typescript
const token = await getToken({
  req: request,
  secret: process.env.NEXTAUTH_SECRET
});
const role = (token as any)?.role as string | undefined;
```
- ✅ Has access to JWT token
- ✅ Can read `token.role`
- ❌ Does NOT have resolved `allowedPages`
- ❌ Does NOT have page overrides

**Dashboard route protection (lines 44-72):**
```typescript
if (role === 'recruiter') {
  const allowed =
    pathname.startsWith('/dashboard/recruiter-hub') ||
    pathname.startsWith('/dashboard/settings');
  if (!allowed) {
    return NextResponse.redirect('/dashboard/recruiter-hub');
  }
}
// Similar for capital_partner
```
- Role-specific only
- Hardcoded path allowlists

**API route protection (lines 85-109):**
```typescript
const allowlisted =
  pathname.startsWith('/api/auth') ||
  pathname.startsWith('/api/recruiter-hub') ||
  // ... more paths
if (role === 'recruiter' && !allowlisted) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
// Similar for capital_partner
```
- Role-specific only
- Hardcoded API path allowlists

**⚠️ No generic `allowedPages` check at middleware level.**

**Limitation:** Middleware only has the raw JWT token. To enforce page-level overrides in middleware, we would need to either:
1. **Store overrides in JWT** — then middleware could check `token.pageOverrides` or compute `allowedPages` from `token.role` + `token.pageOverrides`
2. **Make DB query in middleware** — significant performance cost on every request

**Recommendation:** If overrides are stored in JWT, add middleware-level page enforcement. Otherwise, rely on page components and API routes for enforcement (defense-in-depth).

---

## Phase 5: Prisma Schema & Database

**Goal:** Understand the current Prisma schema so we can design the `UserPageOverride` table correctly and confirm the migration path.

### 5.1 — Current Prisma Schema
- **File:** `prisma/schema.prisma`
- **Question:** Paste the complete schema file. Focus on:
  1. The `User` model — what fields does it have? Is `role` stored as a string or enum?
  2. Are there any existing relations on the User model?
  3. What is the datasource provider (postgresql)?
  4. Are there any existing migration files in `prisma/migrations/`? List them.
- **Why:** We need to add a new `UserPageOverride` model with a relation to `User`. Must understand the existing schema to design it correctly.
- **Finding:**

**File:** `prisma/schema.prisma` (423 lines)

**Datasource (lines 7-10):**
```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```
- ✅ PostgreSQL (Neon)

**User model (lines 12-35):**
```prisma
model User {
  id             String   @id @default(cuid())
  email          String   @unique
  name           String
  passwordHash   String?  // Optional for OAuth-only users
  role           String   @default("viewer")  // NOT an enum, just a string
  isActive       Boolean  @default(true)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  createdBy      String?
  externalAgency String?  // Links recruiter to their External Agency

  // Relations
  savedReports        SavedReport[]
  gameScores          GameScore[]
  passwordResetTokens PasswordResetToken[]
  submittedRequests   DashboardRequest[]    @relation("SubmittedRequests")
  requestComments     RequestComment[]      @relation("RequestComments")
  uploadedAttachments RequestAttachment[]   @relation("UploadedAttachments")
  requestEdits        RequestEditHistory[]  @relation("RequestEdits")
  notifications       RequestNotification[] @relation("UserNotifications")
}
```

**Key observations:**
- `role` is stored as a **String**, not an enum — matches the TypeScript `UserRole` union type
- User has **7 existing relations** — adding a `pageOverrides` relation is straightforward
- No existing `pageOverrides` or `allowedPages` field on User

**Other notable models:**
- `WeeklyGoal`, `QuarterlyGoal`, `ManagerQuarterlyGoal` — SGA Hub
- `DashboardRequest`, `RequestComment`, etc. — Dashboard Requests feature
- `GcAdvisorPeriodData`, `GcAdvisorMapping`, `GcSyncLog` — GC Hub

### 5.2 — User Storage Pattern
- **File:** `src/lib/users.ts`
- **Question:** Paste the complete file. Does user CRUD go through Prisma, or is there a JSON-file fallback? How are users fetched — `prisma.user.findUnique()` or something else?
- **Why:** The GC Hub investigation flagged that `src/lib/users.ts` has a local `User` interface that's out of sync with `src/types/user.ts`. We need to confirm the current state and whether user fetching uses Prisma or a different store, since page overrides need to be fetched alongside user data.
- **Finding:**

**File:** `src/lib/users.ts` (276 lines)

**All user CRUD goes through Prisma — no JSON file fallback:**
```typescript
import prisma from './prisma';

export async function getUserByEmail(email: string): Promise<User | null> {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });
  // ...
}
```

**Local `User` interface (lines 7-17) — duplicated from types:**
```typescript
export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive?: boolean;        // Optional here, required in types/user.ts
  createdAt?: Date;          // Optional here
  updatedAt?: Date;          // Optional here
  createdBy?: string | null;
  externalAgency?: string | null;
}
```
- ⚠️ Slightly out of sync with `src/types/user.ts` (optional vs required fields)
- Does NOT include `passwordHash` (intentionally, for security)

**Available functions:**
- `validateUser(email, password)` — login validation
- `getUserByEmail(email)` — fetch by email
- `getUserById(id)` — fetch by id
- `getAllUsers()` — fetch all users
- `createUser(data, createdBy)` — create user
- `updateUser(id, data)` — update user
- `deleteUser(id)` — delete user
- `resetPassword(id, newPassword?)` — reset password

**Key insight for page overrides:**
- If using separate `UserPageOverride` table: Need to add `include: { pageOverrides: true }` to user queries
- If using JSON column on User: Need to update all user fetch/return mappings to include overrides
- The `getUserByEmail()` function is called from `getPermissionsFromToken()` path for backfill — this is where we'd fetch overrides

### 5.3 — Existing Migration History
- **Question:** Run `ls -la prisma/migrations/` and list all migration directories. What was the most recent migration? Is the migration history clean (no failed/partial migrations)?
- **Why:** We need to add a new migration for `UserPageOverride`. If there's migration debt or a messy history, we should know before adding to it.
- **Finding:**

**Migration directory:** `prisma/migrations/`

**⚠️ Non-standard migration pattern — Manual SQL files, NOT Prisma Migrate:**

```
prisma/migrations/
├── manual_add_user_external_agency.sql      (Jan 28)
├── manual_game_score_migration.sql          (Jan 23)
├── manual_manager_quarterly_goal_migration.sql (Jan 27)
└── manual_password_hash_optional_migration.sql (Jan 28)
```

**Example migration (`manual_add_user_external_agency.sql`):**
```sql
/*
  Add externalAgency column to User table.
  Run in Neon SQL Editor. Then run: npx prisma generate
  Idempotent: safe to run more than once.
*/

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "externalAgency" TEXT;
```

**Migration workflow:**
1. Write idempotent SQL file in `prisma/migrations/`
2. Run SQL directly in Neon SQL Editor
3. Run `npx prisma generate` to regenerate Prisma Client
4. Update `schema.prisma` to match database

**No standard Prisma Migrate history** — No `_prisma_migrations` table tracking. This is a simpler, manual approach.

**Implication for page overrides:** We'll create a new `manual_add_user_page_overrides.sql` file following the same pattern. Use `IF NOT EXISTS` for idempotency.

---

## Phase 6: User Management UI

**Goal:** Understand the current user management interface so we can design where the per-user page override controls will live.

### 6.1 — Settings Page Structure
- **File:** `src/app/dashboard/settings/` directory
- **Question:** List all files in the settings directory and its subdirectories. What tabs or sections exist on the Settings page? How is tab navigation implemented?
- **Why:** The page override controls could live as a new tab in Settings, or as part of the existing User Management section. Need to understand the current layout.
- **Finding:**

**Settings page:** `src/app/dashboard/settings/page.tsx` (1 file)

**Settings components:** `src/components/settings/`
```
├── ChangePasswordModal.tsx   — User changes own password
├── DeleteConfirmModal.tsx    — Confirm user deletion
├── ResetPasswordModal.tsx    — Admin resets user password
├── UserManagement.tsx        — User list/table (admin only)
└── UserModal.tsx             — Create/edit user modal
```

**Settings page structure (from Phase 3 read):**
```typescript
export default function SettingsPage() {
  // ...
  return (
    <div>
      <Title>Settings</Title>

      {/* My Account section - all users */}
      <div className="mb-6 p-4 bg-white ...">
        <h3>My Account</h3>
        <button>Change My Password</button>
      </div>

      {/* User Management - admins only */}
      {permissions?.canManageUsers && (
        <UserManagement currentUserEmail={session?.user?.email || ''} />
      )}

      <ChangePasswordModal ... />
    </div>
  );
}
```

**No tabs** — Settings is a single-page layout with sections:
1. "My Account" section (all users) — Change password button
2. "User Management" section (admins only) — UserManagement component

**Recommendation:** Page access overrides could be added to the UserModal (edit user flow) rather than creating a new tab structure.

### 6.2 — UserModal Component
- **File:** `src/components/settings/UserModal.tsx`
- **Question:** Paste the complete component. Focus on:
  1. What fields are in the user create/edit form?
  2. Is there a role dropdown? What options does it show?
  3. How does it handle form submission — what API endpoint does it call?
  4. What's the modal's current layout? Is there room for a "Page Access" section, or would it need a tabbed layout?
- **Why:** The most natural place for per-user overrides is in the user edit modal — you click a user, see their role, and then see toggles for each page showing "role default" vs "override: on/off." We need to know if the modal can accommodate this.
- **Finding:**

**File:** `src/components/settings/UserModal.tsx` (335 lines)

**Current form fields:**
1. Name (text input)
2. Email (email input)
3. Password (password input, optional for edit)
4. Role (select dropdown with all 8 roles)
5. External Agency (conditional, for recruiter/capital_partner only)
6. isActive (checkbox)

**Role dropdown (lines 226-239):**
```typescript
<select value={formData.role} onChange={...}>
  <option value="revops_admin">RevOps Admin - Full access + manage Dashboard Requests</option>
  <option value="admin">Admin - Full access, can manage users</option>
  <option value="manager">Manager - Full access, can manage users</option>
  <option value="sgm">SGM - Team data, pages 1-3 & 6</option>
  <option value="sga">SGA - Own data only, pages 1-2 & 6</option>
  <option value="viewer">Viewer - Read-only, pages 1-2</option>
  <option value="recruiter">Recruiter - Recruiter Hub only, filtered by agency</option>
  <option value="capital_partner">Capital Partner - GC Hub Only</option>
</select>
```

**API endpoints (lines 96-97):**
```typescript
const url = isEditing ? `/api/users/${user.id}` : '/api/users';
const method = isEditing ? 'PUT' : 'POST';
```

**Modal layout:** Single-column vertical form, no tabs. Max-width `max-w-md`.

**Assessment for page access section:**
- Current modal is already moderately long with role-specific fields
- **Option A:** Add collapsible "Page Access Overrides" section below role dropdown
- **Option B:** Convert to tabbed layout ("User Details" / "Page Access")
- **Option C:** Widen modal to `max-w-2xl` and use two-column layout

**Recommendation:** Option A (collapsible section) is simplest. Show a "Customize Page Access" toggle that expands to reveal page checkboxes with tri-state: "Role Default (✓/✗)" / "Grant Access" / "Revoke Access".

### 6.3 — User List Component
- **File:** Look for a user list/table component in `src/components/settings/`
- **Question:** How are users displayed in the management UI? Is there a table? Does it show role? Is there any indication of "custom permissions" that we could extend?
- **Why:** When an admin looks at the user list, they should be able to tell at a glance which users have custom page overrides. We need to know what columns/indicators already exist.
- **Finding:**

**File:** `src/components/settings/UserManagement.tsx` (229 lines)

**Table columns (lines 128-135):**
| Column | Content |
|--------|---------|
| Name | User name + "You" badge for current user |
| Email | User email |
| Role | Role in uppercase, color-coded + external agency for recruiters |
| Status | Active (green) / Inactive (gray) with icons |
| Created | Date formatted |
| Actions | Reset Password, Edit, Delete buttons |

**Role display (lines 147-156):**
```typescript
<span className={`font-semibold ${ROLE_COLOR_CLASSES[user.role]}`}>
  {user.role.toUpperCase()}
</span>
{user.role === 'recruiter' && user.externalAgency && (
  <span className="ml-2 text-xs text-gray-500">
    ({user.externalAgency})
  </span>
)}
```

**No existing "custom permissions" indicator.**

**Fetches users from:** `GET /api/users`

**Recommendation for page overrides:** Add visual indicator next to role:
```typescript
{user.role.toUpperCase()}
{user.hasCustomPageAccess && (
  <span className="ml-1 text-xs bg-orange-100 text-orange-700 px-1 rounded">
    Custom
  </span>
)}
```
This requires the `/api/users` endpoint to return a `hasCustomPageAccess` boolean (or count of overrides).

### 6.4 — User API Routes
- **File:** `src/app/api/users/route.ts` and any related files
- **Question:** Paste the GET and POST handlers. How does user creation work? How does user updating work? Is there a separate PATCH/PUT endpoint? What validation exists on the role field?
- **Why:** We'll need to extend the user update API to accept page override data, or create a separate `/api/users/[id]/page-overrides` endpoint. Need to understand the existing patterns.
- **Finding:**

**Files:**
- `src/app/api/users/route.ts` — GET (list), POST (create)
- `src/app/api/users/[id]/route.ts` — GET (single), PUT (update), DELETE

**GET /api/users (lines 11-48):**
```typescript
const users = await getAllUsers();
const safeUsers: SafeUser[] = users.map(user => ({
  id, email, name, role, isActive, createdAt, updatedAt, createdBy, externalAgency
}));
return NextResponse.json({ users: safeUsers });
```
- Returns array of `SafeUser` objects
- No page override info currently returned

**POST /api/users (lines 51-130):**
```typescript
const { email, name, password, role, isActive, externalAgency } = body;
// Validation for recruiter/capital_partner externalAgency
const user = await createUser({...}, session.user.email);
```
- Creates user with basic fields
- Role-specific validation for externalAgency

**PUT /api/users/[id] (lines 67-143):**
```typescript
const body = await request.json();
// Validation for recruiter/capital_partner externalAgency
const user = await updateUser(params.id, body);
```
- Updates user with fields from request body
- Role-specific validation

**Authorization:** All routes check `permissions.canManageUsers` (admin, manager, revops_admin)

**Options for page overrides:**
1. **Extend PUT endpoint:** Add `pageOverrides: { [pageId]: boolean }` to request body, handle in `updateUser()` function
2. **Separate endpoint:** Create `PUT /api/users/[id]/page-overrides` with dedicated logic

**Recommendation:** Option 1 (extend PUT) is simpler and keeps all user updates in one place. The `updateUser()` function in `src/lib/users.ts` would need to handle the new field.

---

## Phase 7: Edge Cases & Architectural Decisions

**Goal:** Surface edge cases and architectural questions that need answers before implementation.

### 7.1 — Settings Page Self-Access
- **Question:** Can a user's access to the Settings page (page 7) be overridden? Currently every role has page 7. If an admin removes their own access to Settings via an override, they lock themselves out of the permission management UI. Should page 7 be un-overridable?
- **Why:** Need a safeguard. Also: should `revops_admin` users be immune to overrides entirely (since they're the super-admin role)?
- **Finding / Decision:**

**Current state:** Page 7 (Settings) is included in ALL roles' `allowedPages`:
- revops_admin: `[1, 3, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]`
- admin: `[1, 3, 7, 8, 9, 10, 11, 12, 13, 15, 16]`
- ... all other roles include 7

**Risk scenarios:**
1. Admin removes their own access to page 7 → locked out of Settings → can't undo
2. Admin A removes Admin B's page 7 access → Admin B can't manage their account
3. Someone removes all revops_admin users' page 7 access → no one can manage permissions

**Decision options:**

| Option | Page 7 Overridable? | revops_admin Immune? | Pros | Cons |
|--------|---------------------|----------------------|------|------|
| A | No | No | Simple, safe | Can't restrict Settings for anyone |
| B | Yes (others only) | Yes | revops_admin is ultimate backstop | Complex self-protection logic |
| C | No | Yes | Maximum safety | May be overkill |

**Recommendation: Option B**
- Page 7 (Settings) CAN be overridden, but only by someone else (not self)
- `revops_admin` users are immune to ALL overrides (they're the super-admin)
- UI should prevent self-lockout with a warning
- Implementation: In permission resolution, skip overrides entirely if `role === 'revops_admin'`

### 7.2 — Override Scope — Add vs. Remove
- **Question:** Should overrides be able to both ADD pages a role doesn't normally have AND REMOVE pages a role normally has? For example: could you give a `viewer` access to Chart Builder (page 14) that their role doesn't include? Or should overrides only be able to restrict (remove pages from the role default)?
- **Why:** "Add" overrides are more complex — they could circumvent the intent of the role system. "Remove-only" overrides are simpler and safer. This is an architectural decision that affects the DB schema and UI design.
- **Finding / Decision:**

**Decision options:**

| Option | Can Add Pages? | Can Remove Pages? | Use Case |
|--------|---------------|-------------------|----------|
| A: Remove-only | ❌ | ✅ | Restrict specific users from pages their role grants |
| B: Add+Remove | ✅ | ✅ | Full flexibility, can grant pages role doesn't have |

**Analysis:**

**Remove-only (Option A):**
- Simpler mental model: "Role gives you pages, overrides take them away"
- Safer: Can't accidentally give viewer access to admin pages
- DB schema: `pageOverrides: { [pageId]: false }` (only removals stored)
- UI: Show role's pages as checkboxes, user can only uncheck

**Add+Remove (Option B):**
- Full flexibility: "Give this viewer access to Chart Builder for a demo"
- Risk: Could circumvent role-based access control intent
- DB schema: `pageOverrides: { [pageId]: boolean }` (true = add, false = remove)
- UI: Show ALL pages as tri-state (role default / grant / revoke)

**Real-world scenarios:**
1. "Remove Chart Builder from this admin" → Both options support
2. "Give this viewer temporary access to SGA Hub" → Only Option B supports
3. "This recruiter needs Dashboard Requests access" → Only Option B supports

**Recommendation: Option B (Add+Remove)**
- Provides flexibility for legitimate edge cases
- The UI should make clear what the role default is
- Safeguard: Only users with `canManageUsers` can set overrides
- Safeguard: `revops_admin` cannot have their access reduced (from 7.1)
- The role system remains the primary access control; overrides are exceptions

### 7.3 — Multiple Active Sessions
- **Question:** If a user is currently logged in and an admin changes their page overrides, what happens? Does the JWT refresh on the next API call, or only on next login? Run `grep -rn "maxAge\|jwt.*expire\|session.*expire" src/` to find session/token expiry settings.
- **Why:** Determines whether we need a "force logout" or "invalidate sessions" mechanism when overrides change, or if we accept the delay.
- **Finding:**

**Current session configuration (`src/lib/auth.ts:206`):**
```typescript
session: {
  strategy: 'jwt',
  maxAge: 24 * 60 * 60, // 24 hours
},
```

**Session invalidation mechanisms:**
- `signOut()` from next-auth — user-initiated logout only
- No server-side session store (JWT strategy)
- No "force logout" or "invalidate all sessions" mechanism exists

**What happens when admin changes user's overrides:**

| Scenario | If overrides in JWT | If overrides fetched from DB |
|----------|---------------------|------------------------------|
| User is logged in | No change until re-login (up to 24hr) | Change on next page load |
| User navigates | Old permissions used | Fresh permissions fetched |
| API call | Old permissions (from JWT) | Depends on API implementation |

**Decision options:**

| Option | Implementation | Latency | Complexity |
|--------|---------------|---------|------------|
| A: Accept delay | Store overrides in JWT | Up to 24 hours | Low |
| B: DB lookup in session callback | Query DB every session resolution | Immediate | Medium (perf concern) |
| C: Hybrid | JWT flag + conditional DB lookup | Immediate when flag set | Medium |
| D: Force re-auth | Invalidate user's sessions on change | Immediate | High (need session store) |

**Recommendation: Option C (Hybrid)**
- Store `overrideVersion: number` in JWT (incremented when overrides change)
- Store `overrideVersion` in DB alongside overrides
- Session callback: If `token.overrideVersion !== db.overrideVersion`, fetch fresh overrides
- This gives immediate effect without querying DB on every request for users without changes

### 7.4 — Override Audit Trail
- **Question:** Is there any existing audit logging in the codebase? Run `grep -rn "audit\|activity.log\|action.log\|changelog" src/` to check. Does user creation/update currently log who made the change?
- **Why:** When admin A removes admin B's access to a page, there should be a record. Need to know if there's existing audit infrastructure to hook into.
- **Finding:**

**Existing audit patterns:**

| Feature | Audit Fields | Full History? |
|---------|--------------|---------------|
| User creation | `createdBy` (email) | No, just creator |
| User updates | None | No |
| Weekly/Quarterly Goals | `createdBy`, `updatedBy` | No, just last modifier |
| GC Hub sync | `GcSyncLog` table | Yes, full log |
| Dashboard Requests | `RequestEditHistory` table | Yes, full history |

**No comprehensive audit system exists.** User updates don't track who made changes or what changed.

**Options for page override audit:**

| Option | Implementation | Queryable? |
|--------|---------------|------------|
| A: No audit | Just store current state | ❌ |
| B: updatedBy field | Add `overridesUpdatedBy`, `overridesUpdatedAt` | Last change only |
| C: Audit log table | Create `UserPageOverrideAuditLog` | Full history |

**Recommendation: Option B (updatedBy field) for MVP**
- Add `overridesUpdatedBy: String?` and `overridesUpdatedAt: DateTime?` to User model (or override table)
- Shows who last modified overrides and when
- Full audit log (Option C) can be added later if needed
- Consistent with Weekly/Quarterly Goals pattern

### 7.5 — Bulk Operations
- **Question:** Is there any existing pattern for bulk user operations in the UI (e.g., select multiple users, apply changes)? Check the user management components.
- **Why:** If you have 15 admins and want to remove Chart Builder access from 10 of them, doing it one-by-one is painful. If there's a bulk pattern, we should leverage it. If not, it's a nice-to-have for later.
- **Finding:**

**Existing bulk patterns in codebase:**

| Feature | Bulk Support | Implementation |
|---------|--------------|----------------|
| User Management | ❌ No | Single-user modal only |
| SGA Hub Goals | ✅ Yes | `BulkGoalEditor.tsx` with select all/deselect all |
| Dashboard Filters | ✅ Yes | `selectAll` boolean + array of selected |
| GC Hub Sync | ✅ Yes | Batch operations via Google Sheets API |

**No bulk user operations exist.**

The user management table (`UserManagement.tsx`) has:
- No checkbox column for multi-select
- No "Select All" functionality
- Actions are per-row only (Edit, Delete, Reset Password)

**Recommendation for page overrides:**
- **MVP:** Single-user override editing in UserModal (consistent with current patterns)
- **Future enhancement:** Add "Bulk Edit Page Access" feature similar to `BulkGoalEditor.tsx`:
  - Checkbox column in user table
  - "Edit Page Access for Selected" button
  - Modal with page toggles applied to all selected users

This is a nice-to-have for v2, not required for initial implementation.

### 7.6 — Data Model Design Question
- **Question:** Examine the Prisma schema again. Given that we're using Neon/Postgres, propose two schema options and note tradeoffs:
  - **Option A:** Separate `UserPageOverride` table with one row per user-per-page override (`userId`, `pageId`, `hasAccess`)
  - **Option B:** JSON column on the `User` model (e.g., `pageOverrides: Json?` storing `{pageId: boolean}`)
  
  For each: How does it affect querying? How does it affect the permission resolution function? How does it affect Prisma typing? Which approach does the existing codebase's patterns favor?
- **Why:** This is the foundational data model decision. Affects everything downstream.
- **Finding / Recommendation:**

**Option A: Separate `UserPageOverride` table**

```prisma
model UserPageOverride {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  pageId    Int
  hasAccess Boolean  // true = grant, false = revoke
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  updatedBy String?  // Email of admin who set it

  @@unique([userId, pageId])
  @@index([userId])
}

model User {
  // ... existing fields
  pageOverrides UserPageOverride[]
}
```

| Aspect | Assessment |
|--------|------------|
| Querying | `include: { pageOverrides: true }` — one extra join |
| Prisma typing | Strongly typed, auto-generated types |
| Adding override | `prisma.userPageOverride.upsert()` |
| Clearing overrides | `prisma.userPageOverride.deleteMany({ where: { userId } })` |
| Migration | New table, simple `CREATE TABLE` |

**Option B: JSON column on User model**

```prisma
model User {
  // ... existing fields
  pageOverrides     Json?     // { "8": false, "14": true }
  overridesUpdatedBy String?
  overridesUpdatedAt DateTime?
}
```

| Aspect | Assessment |
|--------|------------|
| Querying | No join needed, JSON is on User row |
| Prisma typing | `pageOverrides: Prisma.JsonValue` — needs manual typing |
| Adding override | Update entire JSON object |
| Clearing overrides | Set to `null` or `{}` |
| Migration | `ALTER TABLE ADD COLUMN` |

**Comparison:**

| Criterion | Option A (Table) | Option B (JSON) |
|-----------|------------------|-----------------|
| Type safety | ✅ Strong | ⚠️ Manual |
| Query complexity | ⚠️ Extra join | ✅ Simple |
| Partial updates | ✅ Per-override | ⚠️ Full JSON |
| Audit per-override | ✅ Easy | ❌ Hard |
| Existing patterns | ✅ Matches codebase | ⚠️ Used sparingly |
| Performance | ⚠️ Join on every user fetch | ✅ No join |

**Existing codebase patterns:**
- Relations are common (User has many SavedReports, GameScores, etc.)
- JSON columns used for: `SavedReport.filters`, `ExploreFeedback.compiledQuery`
- The codebase leans toward relational patterns

**Recommendation: Option A (Separate Table)**

Reasons:
1. **Type safety** — Prisma generates types automatically, less error-prone
2. **Consistency** — Matches existing relational patterns in the codebase
3. **Audit trail** — Each override can have its own `updatedBy`/`updatedAt`
4. **Future flexibility** — Easy to add more fields per override (e.g., `expiresAt`, `reason`)
5. **Query efficiency** — Can fetch just user or user+overrides as needed

The extra join cost is negligible for the small user count in this system.

---

## Phase 8: Complete Touchpoint Map

**Goal:** Produce a final summary of every file that will need to be modified for this feature.

### 8.1 — File Change Inventory
- **Question:** Based on all findings above, produce a complete list of files that need changes, grouped by category:
  1. **Schema/Database:** Prisma schema, migrations
  2. **Type Definitions:** TypeScript interfaces and types
  3. **Permission Logic:** Resolution functions, helpers
  4. **Auth Pipeline:** JWT callbacks, session callbacks
  5. **Middleware:** Route protection
  6. **API Routes:** Any routes needing page-access enforcement changes
  7. **UI Components:** Sidebar, user management modal, user list
  8. **Page Components:** Server components with permission checks
  
  For each file, note: what changes, estimated complexity (low/medium/high), and any dependencies on other changes.
- **Finding:**

#### 1. Schema/Database

| File | Changes | Complexity | Dependencies |
|------|---------|------------|--------------|
| `prisma/schema.prisma` | Add `UserPageOverride` model with relation to User | Low | None |
| `prisma/migrations/manual_add_user_page_overrides.sql` | CREATE TABLE, indexes, foreign key | Low | Schema change |

#### 2. Type Definitions

| File | Changes | Complexity | Dependencies |
|------|---------|------------|--------------|
| `src/types/user.ts` | Add `pageOverrides?: PageOverride[]` to `UserPermissions`; add `hasCustomPageAccess?: boolean` to `SafeUser` | Low | None |
| `src/lib/permissions.ts` | Update `TokenUserData` interface to include `pageOverrides` or `overrideVersion` | Low | Type definitions |

#### 3. Permission Logic

| File | Changes | Complexity | Dependencies |
|------|---------|------------|--------------|
| `src/lib/permissions.ts` | Modify `getPermissionsFromToken()` to merge overrides into `allowedPages`; add `revops_admin` immunity check | Medium | Type definitions |
| `src/lib/users.ts` | Add functions to fetch/update page overrides; update `getUserByEmail()` to include overrides | Medium | Schema |

#### 4. Auth Pipeline

| File | Changes | Complexity | Dependencies |
|------|---------|------------|--------------|
| `src/lib/auth.ts` | Update JWT callback to store `overrideVersion`; update session callback to fetch overrides when version mismatch | Medium | Permission logic |

#### 5. API Authorization Helpers

| File | Changes | Complexity | Dependencies |
|------|---------|------------|--------------|
| `src/lib/api-authz.ts` | Add `requirePageAccess(permissions, pageId)` helper function | Low | None |

#### 6. Middleware

| File | Changes | Complexity | Dependencies |
|------|---------|------------|--------------|
| `src/middleware.ts` | (Optional) Add generic `allowedPages` check if overrides stored in JWT | Medium | Auth pipeline |

#### 7. API Routes — User Management

| File | Changes | Complexity | Dependencies |
|------|---------|------------|--------------|
| `src/app/api/users/route.ts` | Update GET to return `hasCustomPageAccess` flag | Low | Schema |
| `src/app/api/users/[id]/route.ts` | Update GET to return overrides; update PUT to accept/save overrides | Medium | Schema, users.ts |
| `src/app/api/auth/permissions/route.ts` | Ensure overrides are included in response | Low | Permission logic |

#### 8. API Routes — Page-Specific (Standardization)

| File | Changes | Complexity | Dependencies |
|------|---------|------------|--------------|
| `src/app/api/sga-hub/*.ts` (13 routes) | Add `requirePageAccess(permissions, 8)` check | Low | api-authz.ts |
| `src/app/api/sga-activity/*.ts` (4 routes) | Add `requirePageAccess(permissions, 11)` check | Low | api-authz.ts |
| `src/app/api/dashboard-requests/*.ts` (11 routes) | Replace role check with `requirePageAccess(permissions, 13)` | Low | api-authz.ts |

#### 9. UI Components

| File | Changes | Complexity | Dependencies |
|------|---------|------------|--------------|
| `src/components/settings/UserModal.tsx` | Add "Page Access Overrides" collapsible section with page toggles | High | API routes |
| `src/components/settings/UserManagement.tsx` | Add "Custom" badge next to role for users with overrides | Low | API routes |

#### 10. Page Components (Standardization)

| File | Changes | Complexity | Dependencies |
|------|---------|------------|--------------|
| `src/app/dashboard/sga-hub/page.tsx` | Replace role whitelist with `allowedPages.includes(8)` | Low | None |
| `src/app/dashboard/sga-management/page.tsx` | Replace role whitelist with `allowedPages.includes(9)` | Low | None |
| `src/app/dashboard/sga-activity/page.tsx` | Replace role whitelist with `allowedPages.includes(11)` | Low | None |

#### 11. Dashboard Layout

| File | Changes | Complexity | Dependencies |
|------|---------|------------|--------------|
| `src/app/dashboard/layout.tsx` | Add generic `allowedPages` check for all roles (not just recruiter/capital_partner) | Medium | Permission logic |

### 8.2 — Recommended Implementation Order
- **Question:** Based on the dependency graph from 8.1, what is the correct order to implement changes so that each step can be tested independently? Propose a sequence of PRs or implementation phases.
- **Finding:**

#### Phase A: Foundation (No User-Facing Changes)

**PR 1: Database Schema + Type Definitions**
1. `prisma/schema.prisma` — Add `UserPageOverride` model
2. `prisma/migrations/manual_add_user_page_overrides.sql` — Migration script
3. `src/types/user.ts` — Add types for overrides
4. Run migration in Neon, run `prisma generate`

*Testable: Verify schema in database, types compile*

**PR 2: Permission Resolution Logic**
1. `src/lib/permissions.ts` — Update `getPermissionsFromToken()` to merge overrides
2. `src/lib/users.ts` — Add `getUserPageOverrides()`, `setUserPageOverrides()` functions
3. `src/lib/api-authz.ts` — Add `requirePageAccess()` helper

*Testable: Unit tests for permission merging logic*

#### Phase B: Auth Pipeline

**PR 3: Session/JWT Updates**
1. `src/lib/auth.ts` — Store `overrideVersion` in JWT; fetch overrides in session callback when needed
2. `src/app/api/auth/permissions/route.ts` — Include overrides in response

*Testable: Log in as user, verify overrides appear in session*

#### Phase C: API Enforcement (Backend Complete)

**PR 4: User Management API**
1. `src/app/api/users/route.ts` — Return `hasCustomPageAccess` in user list
2. `src/app/api/users/[id]/route.ts` — Accept/return overrides in GET/PUT

*Testable: Use API directly (curl/Postman) to set and retrieve overrides*

**PR 5: Page-Specific API Standardization**
1. `src/app/api/sga-hub/*.ts` — Add `requirePageAccess(permissions, 8)`
2. `src/app/api/sga-activity/*.ts` — Add `requirePageAccess(permissions, 11)`
3. `src/app/api/dashboard-requests/*.ts` — Replace role check with page check

*Testable: Set override to remove page access, verify API returns 403*

#### Phase D: Page Component Standardization

**PR 6: Server Component Protection**
1. `src/app/dashboard/sga-hub/page.tsx` — Use `allowedPages.includes(8)`
2. `src/app/dashboard/sga-management/page.tsx` — Use `allowedPages.includes(9)`
3. `src/app/dashboard/sga-activity/page.tsx` — Use `allowedPages.includes(11)`
4. `src/app/dashboard/layout.tsx` — Add generic `allowedPages` check

*Testable: Set override, verify redirect when accessing page directly*

#### Phase E: UI (Feature Complete)

**PR 7: User Management UI**
1. `src/components/settings/UserManagement.tsx` — Add "Custom" badge
2. `src/components/settings/UserModal.tsx` — Add page access override section

*Testable: Full end-to-end test of setting overrides via UI*

---

**Dependency Graph:**
```
PR1 (Schema)
  ↓
PR2 (Permission Logic) → PR3 (Auth Pipeline)
                              ↓
                         PR4 (User API) → PR7 (UI)
                              ↓
                         PR5 (Page APIs)
                              ↓
                         PR6 (Page Components)
```

**Recommended merge order:** PR1 → PR2 → PR3 → PR4 → PR5 → PR6 → PR7

Each PR can be tested independently before merging.

### 8.3 — Risk Assessment
- **Question:** What are the top 3 risks of this implementation? For each, note: what could go wrong, how severe the impact would be, and what mitigation exists.
- **Finding:**

#### Risk 1: Permission Bypass — User Retains Access After Override

| Aspect | Detail |
|--------|--------|
| **What could go wrong** | User's page access is overridden to "revoke", but they can still access the page or API due to missed enforcement points |
| **Severity** | **High** — Security/authorization failure |
| **Root causes** | (1) Page component uses role check instead of `allowedPages`; (2) API route missing `requirePageAccess()` call; (3) Session not refreshed with new overrides |
| **Mitigation** | (1) PR5 and PR6 standardize all checks to use `allowedPages.includes(pageId)`; (2) Create checklist of all 86 API routes and verify each has appropriate check; (3) Hybrid session refresh ensures overrides take effect on next page load |
| **Testing** | For each page: set override to revoke access, verify page redirects AND API returns 403 |

#### Risk 2: Admin Self-Lockout

| Aspect | Detail |
|--------|--------|
| **What could go wrong** | Admin removes their own access to Settings (page 7) or removes all admins' access, locking everyone out of user management |
| **Severity** | **Medium** — Requires database intervention to fix |
| **Root causes** | (1) No safeguard preventing self-lockout; (2) No safeguard ensuring at least one admin has Settings access |
| **Mitigation** | (1) `revops_admin` users are immune to overrides; (2) UI prevents setting overrides on yourself; (3) Backend validation rejects override that would remove your own page 7 access |
| **Testing** | Attempt to remove own Settings access via API — should return 400 error |

#### Risk 3: Performance Degradation from DB Queries

| Aspect | Detail |
|--------|--------|
| **What could go wrong** | If overrides are fetched from DB on every session resolution, response times increase significantly |
| **Severity** | **Medium** — User experience degradation |
| **Root causes** | Session callback runs on every authenticated request; adding DB query adds latency |
| **Mitigation** | (1) Hybrid approach: only query DB when `token.overrideVersion !== db.overrideVersion`; (2) Most users have no overrides, so most requests skip DB query; (3) Query is simple (single user ID lookup with index) |
| **Testing** | Load test with/without overrides; measure p50/p95 response times |

#### Additional Risks (Lower Priority)

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Orphaned overrides after user deletion** | Low | `onDelete: Cascade` in Prisma schema handles this |
| **Override for non-existent page ID** | Low | Validate page ID against known pages in API |
| **JWT size growth** | Low | Only store `overrideVersion` (number), not full overrides |
| **Race condition in override updates** | Low | Use Prisma transactions for upsert operations |

---

## Addendum A: Investigation Gaps

> **Instructions:** As you work through the phases above, if you discover information that contradicts earlier findings, reveals new files/patterns not covered by the questions, or surfaces additional concerns, record them here.

### Gap A.1 — Orphaned Page ID 11
- **Discovered during:** Phase 1.1
- **Finding:** Page ID 11 exists in `ROLE_PERMISSIONS` for revops_admin, admin, manager, and sga roles, but there is NO corresponding entry in the Sidebar `PAGES` array. This page ID is referenced but doesn't map to any visible page.
- **Impact on implementation:** Before implementing overrides, should either (1) remove page 11 from all `allowedPages` arrays if it's truly unused, or (2) add the missing page to the Sidebar if it should exist. Overriding page 11 access would have no visible effect currently.

### Gap A.2 — Dead Code in permissions.ts
- **Discovered during:** Phase 1.2, 1.3
- **Finding:** Two exported functions are never called anywhere in the codebase:
  - `getUserPermissions(email)` — defined but unused (line 95)
  - `canAccessPage(permissions, pageNumber)` — defined but unused (line 125)
- **Impact on implementation:** These could be useful for the override implementation. `canAccessPage()` in particular could become the centralized check function. Alternatively, remove dead code to reduce confusion.

### Gap A.3 — Layout Fetches Permissions via API
- **Discovered during:** Phase 3.2
- **Finding:** `src/app/dashboard/layout.tsx` fetches permissions via `fetch('/api/auth/permissions')` rather than using `getSessionPermissions(session)` directly. This is a separate code path from most components.
- **Impact on implementation:** The `/api/auth/permissions` endpoint must return overrides-merged permissions. Verify this endpoint uses the same permission resolution logic as the session callback.

### Gap A.4 — SGA Activity Page Not in PAGES Array
- **Discovered during:** Phase 3.4
- **Finding:** `src/app/dashboard/sga-activity/page.tsx` exists and has role-based protection, but "SGA Activity" does not appear in the Sidebar `PAGES` array. It may be accessed via a link within SGA Hub rather than the sidebar.
- **Impact on implementation:** Need to determine if SGA Activity should have its own page ID for override purposes, or if it's considered part of SGA Hub (page 8).

---

## Summary: Key Decisions Needed Before Implementation

| Decision | Options | Recommendation | Rationale |
|----------|---------|----------------|-----------|
| Override direction | Remove-only vs. Add+Remove | **Add+Remove** | Provides flexibility for legitimate edge cases (e.g., give viewer temp access to a page) |
| Storage model | Separate table vs. JSON column | **Separate table** | Type safety, consistency with existing patterns, per-override audit capability |
| JWT strategy | Bake overrides into JWT vs. DB lookup per request | **Hybrid (version check)** | Store `overrideVersion` in JWT; only fetch overrides when version mismatch |
| Session refresh | Accept delay vs. force re-auth on change | **Immediate via version check** | Hybrid approach gives immediate effect without DB query on every request |
| Settings page protection | Page 7 un-overridable vs. overridable with safeguard | **Overridable with safeguard** | Can override others' page 7 access, but not your own; prevents self-lockout |
| revops_admin immunity | Immune to overrides vs. overridable | **Immune** | revops_admin is super-admin role; serves as ultimate backstop |
| API enforcement | Middleware-level vs. per-route vs. both | **Per-route (primary) + middleware (defense-in-depth)** | Per-route `requirePageAccess()` for all page-specific APIs; middleware for recruiter/capital_partner |

---

## Investigation Complete

This document now contains:
- ✅ Complete inventory of current permission system (Phase 1)
- ✅ JWT & session pipeline analysis (Phase 2)
- ✅ Sidebar & route protection patterns (Phase 3)
- ✅ API route protection audit (Phase 4)
- ✅ Prisma schema & database patterns (Phase 5)
- ✅ User management UI structure (Phase 6)
- ✅ Architectural decisions (Phase 7)
- ✅ Complete touchpoint map with implementation order (Phase 8)

**Next step:** Use this document to write the implementation guide for per-user page access overrides.
