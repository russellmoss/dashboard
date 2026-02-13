# GC Hub — Pre-Implementation Codebase Investigation (COMPLETED)

> **Purpose:** This document contains phased investigation questions that Claude Code must execute against the Savvy Dashboard repo (`russellmoss/dashboard`) **before** writing the GC Hub implementation guide. Each phase targets a specific architectural concern. Answers should be recorded inline so this document becomes the codebase knowledge base for implementation.
>
> **Why this matters:** The GC Hub introduces a new data domain (Google Sheets → Neon → Dashboard), a new user role (`capital_partner`), inline data editing with audit trails, and anonymized views — all within an existing codebase that has established patterns for auth, permissions, middleware, sidebar navigation, and data fetching. If the implementation guide doesn't respect these patterns, every Cursor prompt will produce code that conflicts with the existing architecture.
>
> **How to use:** Execute each phase sequentially. Use `cat`, `grep`, `find`, and file reads against the cloned repo. Record exact file paths, line numbers, function signatures, and code snippets. Do NOT skip any question — gaps here become bugs in implementation.

---

## Phase 1: Authentication & Role System Deep Dive

**Goal:** Understand exactly how to add the `capital_partner` role without breaking existing auth flows.

### 1.1 — UserRole Type Definition
- **File:** `src/types/user.ts`
- **Question:** What is the exact `UserRole` type union? List every value.
- **Why:** We need to add `'capital_partner'` to this union. Need to know if it's a string literal union or enum, and what downstream types reference it.
- **Finding:**
  - **File path:** `src/types/user.ts`, lines 1-2
  - **Exact code:**
    ```typescript
    // Role type used across all user interfaces
    export type UserRole = 'admin' | 'manager' | 'sgm' | 'sga' | 'viewer' | 'recruiter' | 'revops_admin';
    ```
  - **Interpretation:** 7 roles currently defined. `capital_partner` does not exist yet. This is a **string literal union type**, not an enum. Adding a new value requires:
    1. Adding `'capital_partner'` to this union
    2. The `UserPermissions` interface (same file, lines 17-27) references `UserRole` via the `role` property
    3. The `User` interface (lines 4-15) and `SafeUser` interface (lines 30-40) both use `role: UserRole`
    4. `src/lib/users.ts` has a local `User` interface (line 10) with a slightly different list — will need updating

> ⚠️ **ADDENDUM:** Additional findings for this section were discovered — see **Gap 2.1, 2.2, 2.3** in Addendum A below. Critical finding: `src/lib/users.ts` has a local inline role union that is ALREADY out of sync (missing `revops_admin`) and does NOT import from the single source of truth.

### 1.2 — ROLE_PERMISSIONS Map
- **File:** `src/lib/permissions.ts`
- **Question:** Paste the complete `ROLE_PERMISSIONS` object. For each role, what are: `allowedPages`, `canExport`, `canManageUsers`, `canManageRequests`? What page IDs are currently assigned?
- **Why:** We need to define `capital_partner` permissions. Must know the next available page ID for GC Hub and what permission flags exist.
- **Finding:**
  - **File path:** `src/lib/permissions.ts`, lines 13-63
  - **Exact code:**
    ```typescript
    const ROLE_PERMISSIONS: Record<string, Omit<UserPermissions, 'sgaFilter' | 'sgmFilter' | 'recruiterFilter' | 'userId'>> = {
      revops_admin: {
        role: 'revops_admin',
        allowedPages: [1, 3, 7, 8, 9, 10, 11, 12, 13, 14, 15],  // All pages + 14 = Chart Builder, 15 = Advisor Map
        canExport: true,
        canManageUsers: true,
        canManageRequests: true,  // Only role that can manage requests
      },
      admin: {
        role: 'admin',
        allowedPages: [1, 3, 7, 8, 9, 10, 11, 12, 13, 15],  // 15 = Advisor Map (Chart Builder restricted to revops_admin)
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
    };
    ```
  - **Interpretation:**
    - Page IDs in use: 1, 3, 7, 8, 9, 10, 11, 12, 13, 14, 15
    - **Next available page ID: 16** for GC Hub
    - Recruiter pattern shows restricted role: only pages [7, 12] (Settings + Recruiter Hub)
    - `capital_partner` should follow same pattern: `allowedPages: [7, 16]` (Settings + GC Hub only)
    - Permission flags: `canExport`, `canManageUsers`, `canManageRequests`
    - May need a new flag like `canEditGcData` for inline editing privileges

### 1.3 — Recruiter Auth Pattern (Our Template)
- **File:** `src/middleware.ts`
- **Question:** Paste the complete recruiter middleware block (the default-deny section). How does it detect recruiter role? What routes are allowlisted? How does the redirect work?
- **Why:** Capital Partner will use an identical isolation pattern — restricted to GC Hub + Settings only. We'll replicate this block.
- **Finding:**
  - **File path:** `src/middleware.ts`, lines 42-58
  - **Exact code:**
    ```typescript
    // Default-deny for recruiters: they may only access Recruiter Hub + Settings in dashboard.
    // This runs BEFORE any page JS, preventing "flash" and blocking direct URL access.
    if (token && pathname.startsWith('/dashboard')) {
      const role = (token as any)?.role as string | undefined;
      if (role === 'recruiter') {
        const allowed =
          pathname.startsWith('/dashboard/recruiter-hub') ||
          pathname.startsWith('/dashboard/settings');

        if (!allowed) {
          const redirectUrl = request.nextUrl.clone();
          redirectUrl.pathname = '/dashboard/recruiter-hub';
          redirectUrl.search = '';
          return NextResponse.redirect(redirectUrl);
        }
      }
    }
    ```
  - **Interpretation:**
    - Role is extracted from JWT token: `(token as any)?.role`
    - Uses route prefix matching with `startsWith`
    - Redirects to their "home" page (recruiter-hub) if accessing unauthorized routes
    - For `capital_partner`: replicate this block, allow `/dashboard/gc-hub` and `/dashboard/settings`, redirect to `/dashboard/gc-hub`

### 1.4 — Recruiter API Allowlist
- **File:** `src/middleware.ts`
- **Question:** Find the section that blocks recruiters from API routes. What's the exact allowlist? How is `forbidRecruiter()` implemented (file path, function signature)?
- **Why:** We need an equivalent `forbidCapitalPartner()` function and API allowlist for GC Hub routes.
- **Finding:**
  - **File path:** `src/middleware.ts`, lines 69-83
  - **Exact code:**
    ```typescript
    // Recruiters are blocked from ALL /api/* by default (defense-in-depth),
    // except explicit allowlist required for Recruiter Hub + Settings + approved shared endpoints.
    if (token && pathname.startsWith('/api')) {
      const role = (token as any)?.role as string | undefined;
      const allowlisted =
        pathname.startsWith('/api/auth') ||
        pathname.startsWith('/api/recruiter-hub') ||
        pathname.startsWith('/api/dashboard/record-detail') ||  // Record detail modal (route has proper recruiter filtering)
        pathname === '/api/users/me/change-password' ||
        pathname === '/api/dashboard/data-freshness';

      if (role === 'recruiter' && !allowlisted) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }
    ```
  - **Interpretation:**
    - NO separate `forbidRecruiter()` function — the logic is inline in middleware
    - Allowlist uses exact path matching (`===`) and prefix matching (`startsWith`)
    - For `capital_partner`: Add similar block allowing:
      - `/api/auth`
      - `/api/gc-hub/*` (new)
      - `/api/users/me/change-password`
      - `/api/dashboard/data-freshness`

> ⚠️ **ADDENDUM:** Additional findings for this section were discovered — see **Gap 1.1, 1.2, 1.3, 1.4** in Addendum A below. Critical finding: There IS a separate `forbidRecruiter()` helper function in `src/lib/api-authz.ts` used by 20 API route handlers as defense-in-depth — this is a SECOND authorization layer beyond middleware.

### 1.5 — Login Flow for Email/Password Users
- **File:** `src/lib/auth.ts` (authOptions)
- **Question:** How does the credentials provider work? Does it check `isActive`? How is the JWT populated — what fields go into the token? How does the session callback extract permissions?
- **Why:** Capital Partners use email/password (like recruiters). Need to understand the token→session→permissions chain to ensure `capital_partner` role flows through correctly.
- **Finding:**
  - **File path:** `src/lib/auth.ts`, lines 58-103 (Credentials provider), lines 145-198 (JWT callback), lines 125-143 (Session callback)
  - **Key code sections:**

  **Credentials authorize (lines 64-103):**
  ```typescript
  async authorize(credentials) {
    // ...validation...
    const user = await validateUser(credentials.email, credentials.password);
    if (!user) {
      return null;
    }
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };
  }
  ```

  **JWT callback (lines 145-198) - populates token:**
  ```typescript
  async jwt({ token, user }) {
    if (user) {
      token.email = user.email;
      // ...
      token.id = credUser.id;
      token.name = credUser.name;
      token.role = credUser.role;
      // For credentials, get externalAgency from DB
      const dbUser = await getUserByEmail(user.email.toLowerCase());
      if (dbUser) {
        token.externalAgency = dbUser.externalAgency ?? null;
      }
    }
    return token;
  }
  ```

  **Session callback (lines 125-143) - extracts permissions:**
  ```typescript
  async session({ session, token }) {
    const tokenData: TokenUserData = {
      id: (token.id as string) || (token.sub as string) || '',
      email: (token.email as string) || '',
      name: (token.name as string) || '',
      role: ((token.role as string) || 'viewer') as UserRole,
      externalAgency: (token.externalAgency as string | null) || null,
    };
    const permissions = getPermissionsFromToken(tokenData);
    (session as ExtendedSession).permissions = permissions;
    return session;
  }
  ```

  - **Interpretation:**
    - `isActive` is checked in `validateUser()` (see `src/lib/users.ts` lines 76-79)
    - Token contains: `id`, `email`, `name`, `role`, `externalAgency`
    - Permissions derived via `getPermissionsFromToken()` which uses `ROLE_PERMISSIONS` map
    - For `capital_partner`: Just need to add role to `ROLE_PERMISSIONS` map; auth flow will work automatically
    - May need to add a `capitalPartnerFilter` field similar to `recruiterFilter` for data scoping

### 1.6 — User Creation Flow
- **File:** `src/app/api/users/route.ts` (POST handler)
- **Question:** How are users created? What validation exists on the `role` field? Is there a hardcoded list of valid roles? Does the UI user management form have a role dropdown — where is it defined?
- **Why:** Admin needs to create Capital Partner users. Must know if role validation will reject unknown roles.
- **Finding:**
  - **File path:** `src/app/api/users/route.ts`, lines 50-120
  - **Exact code (POST handler key parts):**
  ```typescript
  export async function POST(request: NextRequest) {
    // ... auth checks ...
    const body = await request.json();
    const { email, name, password, role, isActive, externalAgency } = body;

    if (!email || !name || !role) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Validate externalAgency for recruiter role
    if (role === 'recruiter') {
      if (!externalAgency || String(externalAgency).trim() === '') {
        return NextResponse.json(
          { error: 'External Agency is required for Recruiter role' },
          { status: 400 }
        );
      }
    }

    const user = await createUser(
      { email, name, password, role, isActive,
        externalAgency: role === 'recruiter' ? String(externalAgency).trim() : null },
      session.user.email
    );
    // ...
  }
  ```

  - **File path:** `src/lib/users.ts`, lines 171-220 (`createUser` function)
  - **Interpretation:**
    - **NO hardcoded role validation** in API route — role is passed directly to Prisma
    - Prisma schema has `role String @default("viewer")` — accepts any string
    - Special validation only for `recruiter` role (requires `externalAgency`)
    - **UI dropdown:** Would be in `src/components/settings/UserModal.tsx` (needs to add `capital_partner` option)
    - For `capital_partner`: May need similar validation if we add a `capitalPartnerCompany` field

> ⚠️ **ADDENDUM:** See **Gap 3.1, 3.2, 3.3** in Addendum B for the actual UserModal role dropdown code, conditional field pattern (recruiter → externalAgency), and role color classes that need updating.

### 1.7 — Dashboard Layout Route Protection
- **File:** `src/app/dashboard/layout.tsx`
- **Question:** Paste the complete client-side route protection logic (the useEffect that checks permissions and redirects). How does it handle the "flash" prevention for restricted users?
- **Why:** Must add equivalent logic for `capital_partner` — restrict to `/dashboard/gc-hub` and `/dashboard/settings`.
- **Finding:**
  - **File path:** `src/app/dashboard/layout.tsx`, lines 60-81
  - **Exact code:**
  ```typescript
  // Client-side route protection for recruiters (prevents accessing other dashboard pages via direct URL)
  useEffect(() => {
    if (permissionsLoading) return;
    if (!permissions) return;
    if (permissions.role !== 'recruiter') return;

    const allowed =
      pathname.startsWith('/dashboard/recruiter-hub') ||
      pathname.startsWith('/dashboard/settings');

    if (!allowed) {
      router.replace('/dashboard/recruiter-hub');
    }
  }, [permissions, permissionsLoading, pathname, router]);

  // Avoid rendering restricted pages for recruiters (prevents UI flash)
  if (!permissionsLoading && permissions?.role === 'recruiter') {
    const allowed =
      pathname.startsWith('/dashboard/recruiter-hub') ||
      pathname.startsWith('/dashboard/settings');
    if (!allowed) return null;
  }
  ```
  - **Interpretation:**
    - Two-part protection: useEffect for redirect + render guard for flash prevention
    - Checks `permissions.role === 'recruiter'` explicitly
    - For `capital_partner`: Add identical blocks checking for `permissions.role === 'capital_partner'`
    - Flash prevention returns `null` while redirect happens

---

## Phase 1 Complete

**Summary:** The role system is straightforward:
1. Add `'capital_partner'` to `UserRole` union in `src/types/user.ts`
2. Add `capital_partner` entry to `ROLE_PERMISSIONS` in `src/lib/permissions.ts` with `allowedPages: [7, 16]` (Settings + GC Hub)
3. Add middleware blocks in `src/middleware.ts` for dashboard routes and API allowlist
4. Add client-side guards in `src/app/dashboard/layout.tsx`
5. Update UI dropdown in `src/components/settings/UserModal.tsx`

**Next available page ID: 16** (for GC Hub)

---

## Phase 2: Sidebar & Page Navigation

**Goal:** Understand how to add GC Hub to the sidebar and control visibility per role.

### 2.1 — PAGES Array
- **File:** `src/components/layout/Sidebar.tsx`
- **Question:** Paste the complete `PAGES` array. What is the highest page ID currently used? What icons are imported?
- **Why:** Need the next available page ID for GC Hub. Need to pick an appropriate icon.
- **Finding:**
  - **File path:** `src/components/layout/Sidebar.tsx`, lines 49-60
  - **Exact code:**
  ```typescript
  const PAGES = [
    { id: 1, name: 'Funnel Performance', href: '/dashboard', icon: BarChart3 },
    { id: 3, name: 'Open Pipeline', href: '/dashboard/pipeline', icon: Layers },
    { id: 10, name: 'Explore', href: '/dashboard/explore', icon: Bot },
    { id: 8, name: 'SGA Hub', href: '/dashboard/sga-hub', icon: Target },
    { id: 9, name: 'SGA Management', href: '/dashboard/sga-management', icon: Users },
    { id: 12, name: 'Recruiter Hub', href: '/dashboard/recruiter-hub', icon: Briefcase },
    { id: 13, name: 'Dashboard Requests', href: '/dashboard/requests', icon: MessageSquarePlus },
    { id: 14, name: 'Chart Builder', href: '/dashboard/chart-builder', icon: BarChart2 },
    { id: 15, name: 'Advisor Map', href: '/dashboard/advisor-map', icon: MapPin },
    { id: 7, name: 'Settings', href: '/dashboard/settings', icon: Settings },
  ];
  ```

  - **Icons imported (lines 9-11):**
  ```typescript
  import {
    BarChart3, BarChart2, Settings, Menu, X, Target,
    Bot, Users, Layers, Briefcase, MessageSquarePlus, MapPin
  } from 'lucide-react';
  ```

  - **Interpretation:**
    - **Highest page ID: 15** (Advisor Map)
    - **Next available: 16** for GC Hub
    - Available icons from lucide-react; for GC Hub could use: `DollarSign`, `TrendingUp`, `PieChart`, `Wallet`, or `Building2`
    - Settings (id: 7) is last in display order — GC Hub should be inserted before Settings

### 2.2 — Sidebar Filtering Logic
- **File:** `src/components/layout/Sidebar.tsx`
- **Question:** How does the sidebar filter pages based on `allowedPages`? Is it the `filteredPages` variable? Paste the filter logic.
- **Why:** Confirming that adding a page ID to `ROLE_PERMISSIONS` is sufficient to show/hide sidebar items.
- **Finding:**
  - **File path:** `src/components/layout/Sidebar.tsx`, lines 68-74
  - **Exact code:**
  ```typescript
  export function Sidebar({ isCollapsed, onToggle, allowedPagesOverride }: SidebarProps) {
    const pathname = usePathname();
    const { data: session } = useSession();
    const permissions = getSessionPermissions(session);
    const allowedPages = allowedPagesOverride || permissions?.allowedPages || [1, 2];

    const filteredPages = PAGES.filter(page => allowedPages.includes(page.id));
    // ... render filteredPages ...
  }
  ```
  - **Interpretation:**
    - Simple filter: `PAGES.filter(page => allowedPages.includes(page.id))`
    - `allowedPages` comes from `ROLE_PERMISSIONS[role].allowedPages`
    - Confirmed: Adding page ID to `ROLE_PERMISSIONS` is sufficient to show/hide sidebar items
    - For GC Hub: Add `{ id: 16, name: 'GC Hub', href: '/dashboard/gc-hub', icon: DollarSign }` to PAGES, add 16 to `capital_partner.allowedPages`

### 2.3 — Recruiter Hub Page Pattern
- **File:** `src/app/dashboard/recruiter-hub/page.tsx`
- **Question:** Paste the complete server component. How does it check permissions? What's the redirect logic for unauthorized access?
- **Why:** This is the exact pattern we'll replicate for `src/app/dashboard/gc-hub/page.tsx`.
- **Finding:**
  - **File path:** `src/app/dashboard/recruiter-hub/page.tsx`, lines 1-31
  - **Exact code:**
  ```typescript
  import { redirect } from 'next/navigation';
  import { getServerSession } from 'next-auth';
  import { authOptions } from '@/lib/auth';
  import { getSessionPermissions } from '@/types/auth';
  import { RecruiterHubContent } from './RecruiterHubContent';

  export const dynamic = 'force-dynamic';

  export default async function RecruiterHubPage() {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      redirect('/login');
    }

    // Use permissions from session (derived from JWT, no DB query)
    const permissions = getSessionPermissions(session);
    if (!permissions) {
      redirect('/login');
    }

    // Check if user can access Recruiter Hub (page 12)
    if (!permissions.allowedPages.includes(12)) {
      if (permissions.role === 'sga') {
        redirect('/dashboard/sga-hub');
      }
      redirect('/dashboard');
    }

    return <RecruiterHubContent />;
  }
  ```
  - **Interpretation:**
    - Server component with `'force-dynamic'`
    - Gets session via `getServerSession(authOptions)`
    - Extracts permissions via `getSessionPermissions(session)`
    - Checks `permissions.allowedPages.includes(12)` for page access
    - Role-specific redirect for SGA, generic redirect for others
    - Renders client component `<RecruiterHubContent />`
    - For GC Hub: Same pattern, check `allowedPages.includes(16)`, render `<GCHubContent />`

### 2.4 — Recruiter Hub Client Component Structure
- **File:** `src/app/dashboard/recruiter-hub/RecruiterHubContent.tsx`
- **Question:** What's the high-level component structure? How does it fetch data? Does it use tabs? How are permissions checked client-side?
- **Why:** Establishes the pattern for GC Hub's client component with tabs, data fetching, and permission-gated features.
- **Finding:**
  - **File path:** `src/app/dashboard/recruiter-hub/RecruiterHubContent.tsx` (1062 lines total)
  - **High-level structure:**
  ```typescript
  'use client';

  // Imports: useState, useEffect, useCallback, useSession, Tremor components, icons
  import { Title, Text, Card } from '@tremor/react';

  // Interfaces for data types
  interface ProspectRecord { ... }
  interface OpportunityRecord { ... }
  interface ProspectFilters { ... }
  interface OpportunityFilters { ... }

  export function RecruiterHubContent() {
    const { data: session } = useSession();
    const [permissions, setPermissions] = useState<UserPermissions | null>(null);

    // Fetch permissions client-side
    useEffect(() => {
      if (session?.user?.email) {
        fetch('/api/auth/permissions')
          .then((res) => res.json())
          .then((data) => setPermissions(data));
      }
    }, [session?.user?.email]);

    // Role-based UI: isAdmin check for additional features
    const isAdmin = permissions?.role === 'admin' || permissions?.role === 'manager' || permissions?.role === 'revops_admin';
    const recruiterFilter = permissions?.recruiterFilter ?? null;

    // State for data, filters, pagination, sorting
    const [prospects, setProspects] = useState<ProspectRecord[]>([]);
    const [opportunities, setOpportunities] = useState<OpportunityRecord[]>([]);

    // Data fetching via POST to API routes
    const fetchProspects = useCallback(async () => {
      const response = await fetch('/api/recruiter-hub/prospects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stages, openOnly, closedOnly, externalAgencies }),
      });
      const data = await response.json();
      setProspects(data.records || []);
    }, [filters]);

    // CSV Export (client-side generation)
    function exportProspectsCsv() { ... }

    // Render: Title, filter panels, search, tables with pagination/sorting
    return (
      <div className="space-y-6">
        <Title>Recruiter Hub</Title>
        <Card> {/* Prospects table */} </Card>
        <Card> {/* Opportunities table */} </Card>
        <RecordDetailModal ... />
      </div>
    );
  }
  ```
  - **Interpretation:**
    - **No tabs** — uses two Card sections (Prospects, Opportunities)
    - Data fetched via POST to `/api/recruiter-hub/prospects` and `/api/recruiter-hub/opportunities`
    - Permissions fetched client-side via `/api/auth/permissions`
    - `isAdmin` check controls additional features (agency filter for admins)
    - `recruiterFilter` from permissions used for data scoping
    - CSV export is client-side using Blob
    - For GC Hub: Similar pattern but with tabs (Overview, Advisor Detail, etc.), and `capitalPartnerFilter` for data scoping

---

## Phase 2 Complete

**Summary:** Sidebar and page navigation follows a clean pattern:
1. Add entry to `PAGES` array with id: 16, href: '/dashboard/gc-hub'
2. Add page ID 16 to `ROLE_PERMISSIONS.capital_partner.allowedPages`
3. Create server component `src/app/dashboard/gc-hub/page.tsx` following Recruiter Hub pattern
4. Create client component `src/app/dashboard/gc-hub/GCHubContent.tsx` with tabs

---

## Phase 3: Database Schema & Prisma Patterns

**Goal:** Understand how to add new Prisma models for GC Hub data without conflicting with existing schema.

### 3.1 — Current Prisma Schema
- **File:** `prisma/schema.prisma`
- **Question:** List ALL model names currently defined. For each, note: primary key type (cuid vs uuid vs serial), any `@@unique` constraints, any relations to `User`.
- **Why:** Need to design `GcAdvisorPeriodData`, `GcAdvisorMapping`, and `GcSyncLog` models that follow existing conventions.
- **Finding:**
  - **File path:** `prisma/schema.prisma` (319 lines)
  - **Models defined:**

  | Model | Primary Key | Unique Constraints | User Relations |
  |-------|-------------|-------------------|----------------|
  | User | `@id @default(cuid())` | `email @unique` | Has many: savedReports, gameScores, passwordResetTokens, submittedRequests, requestComments, uploadedAttachments, requestEdits, notifications |
  | PasswordResetToken | `@id @default(cuid())` | `token @unique`, `@@index([token])`, `@@index([userId])` | Belongs to User |
  | WeeklyGoal | `@id @default(cuid())` | `@@unique([userEmail, weekStartDate])` | None (uses userEmail string) |
  | QuarterlyGoal | `@id @default(cuid())` | `@@unique([userEmail, quarter])` | None (uses userEmail string) |
  | ManagerQuarterlyGoal | `@id @default(cuid())` | `@@unique([quarter])` | None |
  | ExploreFeedback | `@id @default(cuid())` | None | None (uses userId string) |
  | GameScore | `@id @default(cuid())` | None | Belongs to User |
  | SavedReport | `@id @default(cuid())` | None | Optional belongs to User |
  | DashboardRequest | `@id @default(cuid())` | `wrikeTaskId @unique` | Belongs to User (submitter) |
  | RequestComment | `@id @default(cuid())` | `wrikeCommentId @unique` | Belongs to User (author), DashboardRequest |
  | RequestAttachment | `@id @default(cuid())` | `wrikeAttachmentId @unique` | Belongs to User (uploadedBy), DashboardRequest |
  | RequestEditHistory | `@id @default(cuid())` | None | Belongs to User (editedBy), DashboardRequest |
  | RequestNotification | `@id @default(cuid())` | None | Belongs to User, DashboardRequest |
  | AdvisorAddressOverride | `@id @default(cuid())` | `primaryKey @unique` | None (uses createdBy/updatedBy strings) |

  - **Interpretation:**
    - All models use `@id @default(cuid())` for primary keys — **use cuid** for GC Hub models
    - User relations use `String` fields for audit (createdBy, updatedBy) rather than foreign keys
    - Composite unique constraints use `@@unique([field1, field2])` syntax
    - For GC Hub models:
      - `GcAdvisorPeriodData`: `@@unique([advisorId, periodId])`
      - `GcAdvisorMapping`: `@@unique([realAdvisorName])` for deterministic anonymization
      - `GcSyncLog`: No unique needed, just audit trail

### 3.2 — Migration Strategy
- **File:** `prisma/migrations/` directory
- **Question:** List all migration folders. Are there any `manual_*.sql` files? How have schema changes been deployed — via `prisma migrate dev` or manual SQL in Neon?
- **Why:** Need to understand whether to use Prisma migrations or manual SQL for the new tables. The existing codebase uses both approaches.
- **Finding:**
  - **Directory listing:**
  ```
  manual_add_user_external_agency.sql
  manual_game_score_migration.sql
  manual_manager_quarterly_goal_migration.sql
  manual_password_hash_optional_migration.sql
  ```
  - **Interpretation:**
    - **NO Prisma migration folders** — only manual SQL files
    - Project uses **manual SQL migrations** executed directly in Neon console
    - Files follow naming pattern: `manual_<description>_migration.sql`
    - For GC Hub: Create `manual_gc_hub_tables_migration.sql` with CREATE TABLE statements
    - Run via Neon SQL Editor, then update `schema.prisma` to match

### 3.3 — Prisma Client Usage Pattern
- **Files:** Any API route that uses `prisma` (e.g., `src/app/api/users/route.ts`)
- **Question:** How is the Prisma client imported and initialized? Is there a singleton pattern? What's the import path?
- **Why:** Must use the same client instance for GC Hub data operations.
- **Finding:**
  - **File path:** `src/lib/prisma.ts` (134 lines)
  - **Import pattern in API routes:**
  ```typescript
  import prisma from '@/lib/prisma';
  ```

  - **Singleton implementation (key parts):**
  ```typescript
  const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClient | undefined;
  };

  function getPrismaClient(): PrismaClient {
    if (globalForPrisma.prisma) {
      return globalForPrisma.prisma;
    }
    // ... create new client ...
    globalForPrisma.prisma = new PrismaClient(prismaConfig);
    return globalForPrisma.prisma;
  }

  // Export a getter that lazily initializes Prisma
  export const prisma = new Proxy({} as PrismaClient, {
    get(_target, prop) {
      const client = getPrismaClient();
      const value = (client as any)[prop];
      return typeof value === 'function' ? value.bind(client) : value;
    },
  });

  export default prisma;
  ```
  - **Interpretation:**
    - Singleton pattern using `globalThis` to persist across hot reloads
    - Lazy initialization via Proxy — client only created when first accessed
    - Import: `import prisma from '@/lib/prisma';` or `import { prisma } from '@/lib/prisma';`
    - For GC Hub: Same import, use `prisma.gcAdvisorPeriodData.findMany()` etc.

### 3.4 — Database Connection Config
- **File:** `prisma/schema.prisma` datasource block + `.env.example`
- **Question:** What's the datasource configuration? Is there a `directUrl` for migrations? What connection pooling is used?
- **Why:** Large ETL imports may need the direct (non-pooled) connection to avoid timeout issues.
- **Finding:**
  - **File path:** `prisma/schema.prisma`, lines 7-10
  ```prisma
  datasource db {
    provider = "postgresql"
    url      = env("DATABASE_URL")
  }
  ```

  - **File path:** `.env.example`, lines 28-36
  ```bash
  # For Neon: Use the pooled connection URL (with -pooler in hostname)
  # Example: postgresql://user:password@ep-name-pooler.region.aws.neon.tech:5432/dbname?sslmode=require
  DATABASE_URL=postgresql://user:password@host:port/database?sslmode=require

  # For Neon Local Development (Optional):
  # Use direct connection URL (without pooler) for local dev to avoid connection issues
  # DIRECT_URL=postgresql://user:password@ep-name.region.aws.neon.tech:5432/dbname?sslmode=require
  ```

  - **From `src/lib/prisma.ts` (lines 48-52):**
  ```typescript
  // For local development, prefer direct connection if DIRECT_URL is available
  if (process.env.NODE_ENV === 'development' && process.env.DIRECT_URL) {
    logger.debug('[Prisma] Using DIRECT_URL for local development');
    url = process.env.DIRECT_URL;
  }
  ```

  - **Interpretation:**
    - Uses Neon PostgreSQL with connection pooler
    - `DATABASE_URL` points to pooled connection (for production/Vercel)
    - `DIRECT_URL` available for direct connection (local dev, migrations)
    - No `directUrl` in schema.prisma — manual migrations bypass Prisma migrate
    - For GC Hub ETL: Large batch inserts should use transactions and chunking; pooler should handle it, but monitor for timeouts

---

## Phase 3 Complete

**Summary:** Database patterns are straightforward:
1. Use `@id @default(cuid())` for primary keys
2. Create manual SQL migration file (no Prisma migrate)
3. Import prisma via `import prisma from '@/lib/prisma'`
4. ETL should use chunked batch inserts with transactions

---

## Phase 4: Google Sheets Integration (Existing)

**Goal:** Understand what Google Sheets infrastructure already exists so we can reuse it for the GC Hub live sync.

### 4.1 — Sheets Auth Client
- **File:** `src/lib/sheets/google-sheets-exporter.ts`
- **Question:** Paste the `getAuthClient()` method. What scopes does it use? How does it handle local vs Vercel credentials?
- **Why:** The GC Hub sync will need a READ-ONLY Sheets client. We can reuse or extend this auth pattern.
- **Finding:**
  - **File path:** `src/lib/sheets/google-sheets-exporter.ts`, lines 34-72
  - **Exact code:**
  ```typescript
  private getAuthClient() {
    let credentials: any;

    // Try environment variable first (Vercel deployment)
    if (process.env.GOOGLE_SHEETS_CREDENTIALS_JSON) {
      try {
        credentials = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS_JSON);
      } catch (error) {
        throw new Error('Failed to parse GOOGLE_SHEETS_CREDENTIALS_JSON: ' + (error instanceof Error ? error.message : 'Unknown error'));
      }
    }
    // Fall back to file (local development)
    else if (process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_PATH) {
      const credPath = path.resolve(process.cwd(), process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_PATH);
      if (fs.existsSync(credPath)) {
        try {
          credentials = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
        } catch (error) {
          throw new Error(`Failed to read credentials from ${credPath}: ` + (error instanceof Error ? error.message : 'Unknown error'));
        }
      } else {
        throw new Error(`Credentials file not found at: ${credPath}`);
      }
    } else {
      throw new Error('Google Sheets credentials not found. Set GOOGLE_SHEETS_CREDENTIALS_JSON (Vercel) or GOOGLE_SHEETS_SERVICE_ACCOUNT_PATH (local)');
    }

    if (!credentials?.client_email || !credentials?.private_key) {
      throw new Error('Invalid credentials: missing client_email or private_key');
    }

    return new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
      ],
    });
  }
  ```
  - **Interpretation:**
    - Scope: `https://www.googleapis.com/auth/spreadsheets` (read/write)
    - For GC Hub READ-ONLY, could use: `https://www.googleapis.com/auth/spreadsheets.readonly`
    - Credentials: `GOOGLE_SHEETS_CREDENTIALS_JSON` (Vercel) or `GOOGLE_SHEETS_SERVICE_ACCOUNT_PATH` (local)
    - Same service account can be reused — just need to share the Revenue Estimates workbook with the service account email

### 4.2 — Sheets API Package
- **File:** `package.json`
- **Question:** Is `googleapis` already installed? What version? Any other Google-related packages?
- **Why:** Confirming we don't need to add new dependencies for Sheets read access.
- **Finding:**
  - **File path:** `package.json`, lines 38, 25-26
  ```json
  "dependencies": {
    "@google-cloud/bigquery": "^7.9.4",
    "@google-cloud/bigquery-data-transfer": "^5.1.2",
    // ...
    "googleapis": "^170.0.0",
  }
  ```
  - **Interpretation:**
    - `googleapis` v170.0.0 already installed — includes Sheets API
    - BigQuery packages also installed for data queries
    - **No new dependencies needed** for GC Hub Sheets integration

### 4.3 — Existing Sheets Read Patterns
- **Question:** Search the codebase for any `sheets.spreadsheets.values.get` or `sheets.spreadsheets.values.batchGet` calls. Are there any existing patterns for reading (not just writing) from Google Sheets?
- **Why:** The ETL and live sync need to READ from sheets. If there's an existing reader pattern, we should follow it.
- **Finding:**
  - **Grep result:** No matches for `sheets.spreadsheets.values.get` or `batchGet` in source code
  - **Current usage is WRITE-ONLY:**
    - `google-sheets-exporter.ts` uses `sheets.spreadsheets.values.update()` for writing
    - No existing read patterns
  - **Interpretation:**
    - GC Hub will be the **first Sheets reader** in the codebase
    - Need to implement read pattern:
    ```typescript
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: '1-6cBC1V2H7V-DrzpkII2qPshJyzriWpfjS80VEnPWq4',
      range: 'Sheet1!A1:Z1000',
    });
    const rows = response.data.values;
    ```
    - Or use `batchGet` for multiple ranges in one request

### 4.4 — Service Account Permissions
- **Question:** Check the `.env.example` comments — does the existing service account have read access to the Revenue Estimates workbook? Or will we need a separate service account or share the workbook?
- **Why:** The data exploration used MCP tools (separate auth). Production sync needs the dashboard's service account to have read access to spreadsheet `1-6cBC1V2H7V-DrzpkII2qPshJyzriWpfjS80VEnPWq4`.
- **Finding:**
  - **File path:** `.env.example`, lines 68-77
  ```bash
  # =============================================================================
  # Google Sheets Export (Optional)
  # =============================================================================
  # Google Apps Script Web App URL for creating sheets
  GOOGLE_SHEETS_WEBAPP_URL=https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec

  # Option 1: For VERCEL DEPLOYMENT - JSON credentials as environment variable
  # GOOGLE_SHEETS_CREDENTIALS_JSON={"type":"service_account","project_id":"...","private_key":"...","client_email":"..."}

  # Option 2: For LOCAL DEVELOPMENT - Path to service account JSON key file
  # GOOGLE_SHEETS_SERVICE_ACCOUNT_PATH=./google-sheets-service-account.json
  ```
  - **Interpretation:**
    - No mention of Revenue Estimates workbook access
    - **Action required:** Share the Revenue Estimates spreadsheet (`1-6cBC1V2H7V-DrzpkII2qPshJyzriWpfjS80VEnPWq4`) with the service account email (found in credentials JSON as `client_email`)
    - Grant "Viewer" access (read-only) to the service account

> ⚠️ **ADDENDUM:** Service account email confirmed as `sheet-436@savvy-pirate-extension.iam.gserviceaccount.com` — see **Gap 4.1, 4.2, 4.3** in Addendum B for full verification and workbook access checklist. Revenue Estimates workbook is ALREADY shared; Billing Frequency workbook still needs sharing.

---

## Phase 4 Complete

**Summary:** Google Sheets infrastructure exists but is write-only:
1. `googleapis` package installed
2. Auth pattern exists in `google-sheets-exporter.ts`
3. Need to implement READ pattern (no existing examples)
4. **Must share Revenue Estimates workbook with service account** (action item)

---

## Phase 5: API Route Patterns & Data Fetching

**Goal:** Understand how to build GC Hub API routes that follow existing conventions.

### 5.1 — API Route Convention
- **Question:** Do existing routes use POST with JSON body or GET with query params? Paste one example of a typical dashboard API route handler (e.g., `src/app/api/dashboard/funnel-metrics/route.ts` — just the handler skeleton with auth check).
- **Why:** GC Hub API routes must follow the same convention for consistency.
- **Finding:**
  - **File path:** `src/app/api/recruiter-hub/prospects/route.ts` (complete example)
  - **Exact code:**
  ```typescript
  import { NextRequest, NextResponse } from 'next/server';
  import { getServerSession } from 'next-auth';
  import { authOptions } from '@/lib/auth';
  import { getSessionPermissions } from '@/types/auth';
  import { getRecruiterProspects } from '@/lib/queries/recruiter-hub';

  export const dynamic = 'force-dynamic';

  export async function POST(request: NextRequest) {
    try {
      const session = await getServerSession(authOptions);

      if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const permissions = getSessionPermissions(session);
      if (!permissions) {
        return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
      }

      // Check if user can access (page permission check)
      if (!permissions.allowedPages.includes(12)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      const body = await request.json().catch(() => ({}));
      const { stages, openOnly, closedOnly, externalAgencies } = body;

      // Use permission filter for data scoping
      const records = await getRecruiterProspects(
        permissions.recruiterFilter,
        { stages, openOnly, closedOnly, externalAgencies }
      );

      return NextResponse.json({
        records,
        count: records.length,
        recruiterFilter: permissions.recruiterFilter,
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
  - **Interpretation:**
    - Uses **POST with JSON body** for complex filters
    - Auth: `getServerSession(authOptions)` + `getSessionPermissions(session)`
    - Permission check: `permissions.allowedPages.includes(pageId)`
    - Data scoping via permission filter (e.g., `permissions.recruiterFilter`)
    - `export const dynamic = 'force-dynamic'` for no caching
    - Error handling: try/catch with 500 response
    - For GC Hub: Same pattern, use `permissions.capitalPartnerFilter` or similar

### 5.2 — Error Handling Pattern
- **Question:** How do API routes handle errors? Is there a common pattern (try/catch → JSON error response)? Any logging (Sentry, console)?
- **Why:** GC Hub routes must use the same error handling for Sentry visibility.
- **Finding:**
  - Pattern observed across multiple files:
  ```typescript
  try {
    // ... route logic ...
  } catch (error) {
    console.error('Error message:', error);
    return NextResponse.json(
      { error: 'User-friendly message' },
      { status: 500 }
    );
  }
  ```
  - **Sentry integration:** `@sentry/nextjs` is installed and configured
  - **Logger:** `src/lib/logger.ts` exists with `logger.error()` method
  - **Interpretation:**
    - Use `logger.error()` instead of `console.error()` for Sentry integration
    - Return consistent `{ error: string }` JSON structure
    - Status codes: 401 (Unauthorized), 403 (Forbidden), 400 (Bad Request), 500 (Server Error)

### 5.3 — Cron Job Pattern
- **File:** `src/app/api/cron/refresh-cache/route.ts`
- **Question:** Paste the complete cron route. How does it authenticate (CRON_SECRET)? How is it registered in `vercel.json`?
- **Why:** The daily Google Sheets sync will be a cron job. Must follow this exact pattern.
- **Finding:**
  - **File path:** `src/app/api/cron/refresh-cache/route.ts` (complete file)
  ```typescript
  import { NextRequest, NextResponse } from 'next/server';
  import { revalidateTag } from 'next/cache';
  import { CACHE_TAGS } from '@/lib/cache';
  import { logger } from '@/lib/logger';

  export const dynamic = 'force-dynamic';

  export async function GET(request: NextRequest) {
    try {
      // Validate CRON_SECRET (auto-injected by Vercel)
      const authHeader = request.headers.get('authorization');
      const cronSecret = process.env.CRON_SECRET;

      if (!cronSecret) {
        logger.warn('[Cron] CRON_SECRET not configured');
        return NextResponse.json({ error: 'Cron not configured' }, { status: 500 });
      }

      if (authHeader !== `Bearer ${cronSecret}`) {
        logger.warn('[Cron] Invalid CRON_SECRET');
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      // Do work...
      revalidateTag(CACHE_TAGS.DASHBOARD);
      revalidateTag(CACHE_TAGS.SGA_HUB);

      logger.info('[Cron] Scheduled cache refresh', {
        tags: [CACHE_TAGS.DASHBOARD, CACHE_TAGS.SGA_HUB],
        timestamp: new Date().toISOString(),
      });

      return NextResponse.json({
        success: true,
        message: 'Cache invalidated successfully',
        tags: [CACHE_TAGS.DASHBOARD, CACHE_TAGS.SGA_HUB],
      });
    } catch (error) {
      logger.error('Error in cron refresh:', error);
      return NextResponse.json(
        { error: 'Failed to refresh cache' },
        { status: 500 }
      );
    }
  }
  ```

  - **File path:** `vercel.json`, lines 9-29 (crons section)
  ```json
  "crons": [
    {
      "path": "/api/cron/geocode-advisors",
      "schedule": "0 5 * * *"
    },
    {
      "path": "/api/cron/refresh-cache",
      "schedule": "10 4 * * *"
    },
    // ... more schedules ...
  ]
  ```

  - **Interpretation:**
    - Auth: `Authorization: Bearer ${CRON_SECRET}` header (Vercel auto-injects)
    - Uses GET method (crons are GET requests from Vercel)
    - Register in `vercel.json` under `crons` array
    - For GC Hub: Create `/api/cron/gc-hub-sync/route.ts`, add to `vercel.json` with daily schedule (e.g., `"0 6 * * *"`)

### 5.4 — Data Freshness Pattern
- **File:** `src/app/api/dashboard/data-freshness/route.ts`
- **Question:** How does the existing data freshness indicator work? What does it check?
- **Why:** GC Hub needs its own sync status indicator ("Last synced from Google Sheets: 2 hours ago"). May extend or replicate this pattern.
- **Finding:**
  - **File path:** `src/app/api/dashboard/data-freshness/route.ts` (simple handler)
  ```typescript
  export async function GET(request: NextRequest) {
    try {
      const session = await getServerSession(authOptions);
      if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      const freshness = await getDataFreshness();
      return NextResponse.json(freshness);
    } catch (error) {
      logger.error('Error fetching data freshness:', error);
      return NextResponse.json(
        { error: 'Failed to fetch data freshness' },
        { status: 500 }
      );
    }
  }
  ```

  - **File path:** `src/lib/queries/data-freshness.ts` (logic)
  ```typescript
  export interface DataFreshnessResult {
    lastUpdated: string;        // ISO timestamp in UTC
    hoursAgo: number;
    minutesAgo: number;
    isStale: boolean;           // true if > 24 hours
    status: 'fresh' | 'recent' | 'stale' | 'very_stale';
  }

  // Queries BigQuery __TABLES__ metadata for last_modified_time
  const query = `
    SELECT
      MAX(last_data_load) as last_updated,
      TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), MAX(last_data_load), HOUR) as hours_ago,
      TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), MAX(last_data_load), MINUTE) as minutes_ago
    FROM (
      SELECT TIMESTAMP_MILLIS(last_modified_time) as last_data_load
      FROM \`savvy-gtm-analytics.SavvyGTMData.__TABLES__\`
      WHERE table_id IN ('Lead', 'Opportunity')
    )
  `;
  ```

  - **Interpretation:**
    - Returns: `lastUpdated`, `hoursAgo`, `minutesAgo`, `isStale`, `status`
    - Status levels: fresh (<1hr), recent (<6hr), stale (<24hr), very_stale (>24hr)
    - For GC Hub: Query `GcSyncLog` table for last successful sync timestamp
    - Create `/api/gc-hub/sync-status/route.ts` returning similar structure

### 5.5 — Recruiter Hub API Routes
- **File:** `src/app/api/recruiter-hub/` directory
- **Question:** List all files in this directory. Pick one route and paste its complete implementation. How does it use `permissions.recruiterFilter` for data scoping?
- **Why:** This is the closest analog to what GC Hub API routes will look like — role-scoped data access.
- **Finding:**
  - **Directory contents:**
  ```
  external-agencies/route.ts
  opportunities/route.ts
  prospects/route.ts
  ```

  - **Data scoping in query (from `src/lib/queries/recruiter-hub.ts`):**
  ```typescript
  export async function getRecruiterProspects(
    recruiterFilter: string | null,  // From permissions.recruiterFilter
    filters: { stages?: string[]; openOnly?: boolean; closedOnly?: boolean; externalAgencies?: string[] }
  ): Promise<RecruiterProspect[]> {
    const params: Record<string, unknown> = {};
    const conditions: string[] = [
      'External_Agency__c IS NOT NULL',
      "TRIM(External_Agency__c) != ''",
      'Full_prospect_id__c IS NOT NULL',
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
    // ...
  }
  ```

  - **Interpretation:**
    - `recruiterFilter` is passed from API route to query function
    - If not null, adds WHERE condition to scope data
    - Admins (recruiterFilter = null) can optionally filter by agency
    - For GC Hub: Similar pattern with `capitalPartnerFilter` or company-based scoping

---

## Phase 5 Complete

**Summary:** API patterns are consistent:
1. POST for complex queries, GET for simple fetches
2. Auth via `getServerSession` + `getSessionPermissions`
3. Permission check via `allowedPages.includes(pageId)`
4. Data scoping via permission filter (e.g., `recruiterFilter`)
5. Cron routes use `CRON_SECRET` header auth, register in `vercel.json`

---

## Phase 6: Frontend Component Patterns

**Goal:** Understand the UI component library and patterns used so GC Hub looks native.

### 6.1 — UI Component Library
- **File:** `package.json`
- **Question:** List all UI-related dependencies (Tremor, Recharts, Headless UI, etc.) and their versions.
- **Why:** GC Hub charts and tables must use the same component library.
- **Finding:**
  - **File path:** `package.json`, dependencies section
  ```json
  "@tremor/react": "^3.18.7",      // UI component library (Card, Table, Button, etc.)
  "recharts": "^3.6.0",            // Charting library
  "lucide-react": "^0.300.0",      // Icon library
  "next-themes": "^0.4.6",         // Dark mode support
  "leaflet": "^1.9.4",             // Maps (Advisor Map feature)
  "react-leaflet": "^4.2.1",       // React wrapper for Leaflet
  "@dnd-kit/core": "^6.3.1",       // Drag and drop
  "@dnd-kit/sortable": "^10.0.0",  // Sortable lists
  "html-to-image": "^1.11.13",     // Export to image
  "jszip": "^3.10.1",              // ZIP file creation
  ```
  - **Interpretation:**
    - **Primary UI: Tremor** (cards, tables, badges, buttons)
    - **Charts: Recharts** (wrapped by Tremor but also used directly)
    - **Icons: lucide-react**
    - **Dark mode: next-themes**
    - No Headless UI — Tremor provides all needed components

### 6.2 — Tremor Component Usage
- **Question:** Search for imports from `@tremor/react` across the codebase. What specific Tremor components are used? (Card, Title, BarChart, LineChart, Table, etc.)
- **Why:** Need to know which Tremor components are already in use so GC Hub charts are consistent.
- **Finding:**
  - **Grep result:** 47 files import from `@tremor/react`
  - **Components used:**
    - **Layout:** `Card`
    - **Typography:** `Title`, `Text`, `Metric`
    - **Tables:** `Table`, `TableHead`, `TableRow`, `TableHeaderCell`, `TableBody`, `TableCell`
    - **Forms:** `Button`, `TextInput`
    - **Feedback:** `Badge`, `BadgeDelta`
    - **Layout helpers:** `Flex`, `Grid`
    - **Charts:** `BarChart` (via Tremor, wraps Recharts)
  - **Interpretation:**
    - Tremor is used extensively for UI structure
    - Charts use Recharts directly (see ConversionTrendChart.tsx)
    - For GC Hub: Use same components — Card for sections, Table for data, Button for actions

### 6.3 — Table Component Pattern
- **Question:** Find the main data table used in the dashboard (the Detail Records table or the SGA Hub table). What component is it? Is it a custom table or Tremor's? How does it handle pagination, sorting, and search?
- **Why:** GC Hub's advisor table will need the same features.
- **Finding:**
  - **File path:** `src/app/dashboard/recruiter-hub/RecruiterHubContent.tsx` (lines 610-721)
  - **Pattern:** Custom table using Tremor's base components + custom pagination/sorting
  ```typescript
  // Pagination state
  const ROWS_PER_PAGE = 150;
  const [prospectsPage, setProspectsPage] = useState(1);
  const paginatedProspects = sortedProspects.slice(
    (prospectsPage - 1) * ROWS_PER_PAGE,
    prospectsPage * ROWS_PER_PAGE
  );

  // Sorting state
  const [prospectSortKey, setProspectSortKey] = useState<string | null>('advisor_name');
  const [prospectSortDir, setProspectSortDir] = useState<SortDir>('asc');

  // Search filtering
  const [prospectSearch, setProspectSearch] = useState('');
  const filteredProspects = prospects.filter(
    (p) => p.advisor_name?.toLowerCase().includes(prospectSearch.toLowerCase()) || ...
  );

  // Table render
  <table className="w-full table-fixed">
    <thead>
      <tr className="border-b border-gray-200 dark:border-gray-700">
        <SortableTh label="Advisor" sortKey="advisor_name" ... />
        ...
      </tr>
    </thead>
    <tbody>
      {paginatedProspects.map((prospect) => (
        <tr key={prospect.primary_key} onClick={() => setSelectedRecordId(prospect.primary_key)}>
          ...
        </tr>
      ))}
    </tbody>
  </table>
  ```
  - **Interpretation:**
    - Uses native HTML `<table>` with Tailwind styling (not Tremor Table)
    - Custom `SortableTh` component for sortable headers
    - Client-side pagination (slice array)
    - Client-side search filtering
    - Row click opens detail modal
    - For GC Hub: Same pattern — custom table with sorting/pagination/search

### 6.4 — Scorecard/KPI Card Pattern
- **Question:** Find the scorecard components on the main dashboard page. What component are they? How are they styled? Do they support click-to-filter?
- **Why:** GC Hub will have summary KPI cards (total revenue, total amount earned, etc.).
- **Finding:**
  - **File path:** `src/components/dashboard/Scorecards.tsx` (253 lines)
  - **Pattern:**
  ```typescript
  import { Card, Metric, Text, Badge } from '@tremor/react';

  export function Scorecards({ metrics, selectedMetric, onMetricClick, visibleMetrics }: ScorecardsProps) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {visibleMetrics.sqls && (
        <Card
          className={`p-4 dark:bg-gray-800 dark:border-gray-700 ${
            onMetricClick
              ? 'cursor-pointer transition-all hover:bg-gray-50 dark:hover:bg-gray-700 hover:shadow-md'
              : ''
          }`}
          onClick={() => onMetricClick?.('sql')}
        >
          <div className="flex items-center justify-between mb-2">
            <Text className="text-gray-600 dark:text-gray-400">SQLs</Text>
            <Users className="w-5 h-5 text-blue-500 dark:text-blue-400" />
          </div>
          <Metric className="text-2xl font-bold text-gray-900 dark:text-white">
            {formatNumber(metrics.sqls)}
          </Metric>
          <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Sales Qualified Leads
          </Text>
          {goals && goals.sqls > 0 && (
            <GoalDisplay actual={metrics.sqls} goal={goals.sqls} label="SQL" />
          )}
        </Card>
        )}
        // ... more cards ...
      </div>
    );
  }
  ```
  - **Interpretation:**
    - Uses Tremor `Card`, `Metric`, `Text` components
    - Grid layout: `grid-cols-1 md:grid-cols-2 lg:grid-cols-4`
    - Click-to-filter via `onMetricClick` callback
    - Icon from lucide-react
    - Dark mode classes: `dark:bg-gray-800 dark:text-white`
    - For GC Hub: Same pattern for revenue/commission KPI cards

### 6.5 — Chart Components
- **Question:** What chart library is used (Tremor charts vs raw Recharts)? Find one chart component and paste its implementation pattern (data format, props, styling).
- **Why:** GC Hub needs revenue-over-time line charts and potentially cohort analysis charts.
- **Finding:**
  - **File path:** `src/components/dashboard/ConversionTrendChart.tsx` (402 lines)
  - **Uses raw Recharts (not Tremor charts):**
  ```typescript
  import {
    BarChart,
    Bar,
    LabelList,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip as RechartsTooltip,
    Legend,
    ResponsiveContainer,
  } from 'recharts';

  // Data format
  const chartData = trends.map(t => ({
    period: t.period,
    'Contacted→MQL': Number(((Number(t.contactedToMqlRate) || 0) * 100).toFixed(1)),
    'MQL→SQL': Number(((Number(t.mqlToSqlRate) || 0) * 100).toFixed(1)),
    // ...
  }));

  // Render
  <ResponsiveContainer width="100%" height="100%">
    <BarChart
      data={chartData}
      margin={{ top: 25, right: 30, left: 20, bottom: 5 }}
      barCategoryGap="15%"
      barGap={2}
    >
      <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} />
      <XAxis dataKey="period" tick={{ fontSize: 12, fill: CHART_COLORS.axis }} />
      <YAxis tickFormatter={(value) => `${value}%`} />
      <RechartsTooltip contentStyle={{ backgroundColor: isDark ? '#1f2937' : '#fff' }} />
      <Legend />
      {categories.map((cat) => (
        <Bar key={cat} dataKey={cat} fill={colorMap[cat]} radius={[4, 4, 0, 0]} maxBarSize={50}>
          <LabelList dataKey={cat} position="top" content={renderBarLabel} />
        </Bar>
      ))}
    </BarChart>
  </ResponsiveContainer>
  ```
  - **Interpretation:**
    - Uses **raw Recharts** wrapped in Tremor Card
    - Data is array of objects with period + metric values
    - Dark mode handled via `useTheme()` from next-themes
    - `ResponsiveContainer` for responsive sizing
    - Custom tooltip and label rendering
    - For GC Hub: Use `LineChart` for revenue trends, `BarChart` for comparisons

### 6.6 — Tab Navigation Pattern
- **Question:** Search for tab components in the codebase. Is there an existing tab pattern (Headless UI tabs, Tremor tabs, custom)? Find one example and note the implementation.
- **Why:** GC Hub will likely have tabs (Overview, Advisor Detail, Data Explorer, etc.).
- **Finding:**
  - **File path:** `src/components/sga-hub/SGAHubTabs.tsx`
  - **Pattern:** Custom tabs using buttons with border-bottom styling
  ```typescript
  'use client';

  export type SGAHubTab = 'leaderboard' | 'weekly-goals' | 'closed-lost' | 'quarterly-progress' | 'activity';

  interface SGAHubTabsProps {
    activeTab: SGAHubTab;
    onTabChange: (tab: SGAHubTab) => void;
  }

  export function SGAHubTabs({ activeTab, onTabChange }: SGAHubTabsProps) {
    const tabs: { id: SGAHubTab; label: string; icon: React.ReactNode }[] = [
      { id: 'leaderboard', label: 'Leaderboard', icon: <Trophy className="w-4 h-4" /> },
      { id: 'weekly-goals', label: 'Weekly Goals', icon: <Target className="w-4 h-4" /> },
      // ...
    ];

    return (
      <div className="flex gap-2 mb-6 border-b border-gray-200 dark:border-gray-700">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`
              px-4 py-2 text-sm font-medium transition-colors
              flex items-center gap-2
              border-b-2 -mb-px
              ${
                activeTab === tab.id
                  ? 'border-blue-600 dark:border-blue-400 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
              }
            `}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>
    );
  }
  ```
  - **Interpretation:**
    - **Custom tabs** — no Headless UI or Tremor tabs
    - Uses border-bottom for active indicator
    - Type-safe tab IDs via union type
    - Icons from lucide-react
    - Dark mode support
    - For GC Hub: Create `GCHubTabs.tsx` with same pattern

### 6.7 — Dark Mode Support
- **Question:** Search for `dark:` Tailwind classes. Is dark mode fully supported? How is it toggled? Is it required for new pages?
- **Why:** Need to know if GC Hub components need dark mode variants.
- **Finding:**
  - **Grep result:** 1941 occurrences of `dark:` classes across 102 files
  - **Theme toggle:** `src/components/ui/ThemeToggle.tsx` uses `next-themes`
  - **Header includes toggle:** Dark mode is fully implemented
  - **Interpretation:**
    - Dark mode is **fully supported and expected**
    - All new components MUST include `dark:` variants
    - Common patterns:
      - `dark:bg-gray-800` for backgrounds
      - `dark:text-white` / `dark:text-gray-400` for text
      - `dark:border-gray-700` for borders
      - `dark:hover:bg-gray-700` for hover states

### 6.8 — CSV Export Implementation
- **Question:** Find the existing CSV export functionality. Is there a "Download CSV" button somewhere? What library does it use? How is the file generated (client-side or server-side)?
- **Why:** GC Hub needs CSV export. Should use the same approach.
- **Finding:**
  - **File path:** `src/app/dashboard/recruiter-hub/RecruiterHubContent.tsx`, lines 303-329
  - **Pattern:** Client-side CSV generation using Blob
  ```typescript
  function escapeCsvCell(value: string | null | undefined): string {
    const s = String(value ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  function exportProspectsCsv() {
    const headers = ['Advisor', 'External Agency', 'SGA', 'Stage', 'Next Steps', 'Salesforce URL'];
    const rows = sortedProspects.map((p) => [
      escapeCsvCell(p.advisor_name),
      escapeCsvCell(p.External_Agency__c),
      // ...
    ].join(','));
    const csv = [headers.join(','), ...rows].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `recruiter-hub-prospects-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  ```
  - **UI button:**
  ```typescript
  <button onClick={exportProspectsCsv} disabled={filteredProspects.length === 0}
    className="flex items-center gap-1.5 px-3 py-1.5 text-sm border ...">
    <Download className="w-4 h-4" />
    Export all ({filteredProspects.length})
  </button>
  ```
  - **Interpretation:**
    - **Client-side** CSV generation (no server round-trip)
    - No library — pure JavaScript with Blob API
    - Helper function `escapeCsvCell` for proper escaping
    - Filename includes date
    - For GC Hub: Same pattern, client-side generation

---

## Phase 6 Complete

**Summary:** UI patterns are well-established:
1. Tremor for layout (Card, Button, Text, Metric)
2. Raw Recharts for charts (wrapped in Card)
3. Custom tables with Tailwind (not Tremor Table)
4. Custom tabs component
5. Dark mode required on all components
6. Client-side CSV export with Blob

---

## Phase 7: Inline Editing & Mutation Patterns

**Goal:** Determine if any inline editing patterns exist in the codebase that we can extend for GC Hub data corrections.

### 7.1 — Existing Edit/Mutation Patterns
- **Question:** Search for any PUT/PATCH API routes in the codebase. Are there any forms that edit data inline (e.g., SGA weekly goals, user management)? Paste one example of a mutation pattern.
- **Why:** GC Hub allows Admin/RevOps to edit revenue/commission values inline. Need to follow existing mutation patterns.
- **Finding:**
  - **PUT/PATCH routes found:**
    - `src/app/api/users/[id]/route.ts` (PUT for user updates)
    - `src/app/api/saved-reports/[id]/route.ts` (PUT for report updates)
    - `src/app/api/dashboard-requests/[id]/route.ts` (PATCH for request updates)
    - `src/app/api/dashboard-requests/[id]/status/route.ts` (PATCH for status)
    - `src/app/api/games/pipeline-catcher/leaderboard/route.ts` (PATCH)

  - **Example from users/[id]/route.ts:**
  ```typescript
  export async function PUT(request: NextRequest, { params }: RouteParams) {
    try {
      const session = await getServerSession(authOptions);
      if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const permissions = getSessionPermissions(session);
      if (!permissions?.canManageUsers) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      const existingUser = await getUserById(params.id);
      if (!existingUser) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      const body = await request.json();
      // ... validation ...
      const user = await updateUser(params.id, body);
      return NextResponse.json({ user: safeUser });
    } catch (error: any) {
      return NextResponse.json({ error: error.message || 'Failed to update user' }, { status: 400 });
    }
  }
  ```
  - **Interpretation:**
    - PUT for full updates, PATCH for partial updates
    - Permission checks before mutation
    - Fetch existing record, validate, update, return updated
    - For GC Hub: Use PATCH for inline field edits, log changes to audit table

### 7.2 — Weekly Goals Edit Pattern
- **File:** SGA Hub weekly goals
- **Question:** How do SGAs edit their weekly goals? Is it inline in a table? Is there a form? How does it save (debounced, on blur, explicit save button)?
- **Why:** This is the closest existing pattern to inline data editing. GC Hub will use a similar approach for data corrections.
- **Finding:**
  - **File path:** `src/components/sga-hub/WeeklyGoalEditor.tsx` (205 lines)
  - **Pattern:** Modal form with explicit Save button
  ```typescript
  export function WeeklyGoalEditor({ isOpen, onClose, onSaved, goal }: WeeklyGoalEditorProps) {
    const [initialCallsGoalInput, setInitialCallsGoalInput] = useState<string>('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      setLoading(true);
      setError(null);

      try {
        const formData: WeeklyGoalInput = {
          weekStartDate,
          initialCallsGoal: parseGoal(initialCallsGoalInput, 'Initial Calls Goal'),
          // ...
        };

        const response = await fetch('/api/sga-hub/weekly-goals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to save goal');
        }

        onSaved();
        onClose();
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        {/* Modal overlay */}
        <form onSubmit={handleSubmit}>
          <TextInput value={initialCallsGoalInput} onChange={...} />
          {error && <div className="text-red-600">{error}</div>}
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={loading}>
            {loading ? 'Saving...' : 'Save Goal'}
          </Button>
        </form>
      </div>
    );
  }
  ```
  - **Interpretation:**
    - Uses **modal form** (not inline editing)
    - Explicit **Save button** (not auto-save)
    - Loading state prevents double-submit
    - Error displayed in form
    - `onSaved()` callback triggers parent refresh
    - For GC Hub: Could use modal for edits, or implement true inline editing with blur/Enter to save

### 7.3 — Optimistic Updates
- **Question:** Does the codebase use optimistic UI updates (update UI before server confirms) or pessimistic (wait for server response)? Search for patterns like `setData` before/after fetch.
- **Why:** For inline editing, we need to decide on the update strategy.
- **Finding:**
  - **Pattern observed:** Pessimistic updates (wait for server)
  - Example from WeeklyGoalEditor:
  ```typescript
  const response = await fetch('/api/sga-hub/weekly-goals', { ... });
  if (!response.ok) {
    throw new Error(data.error || 'Failed to save goal');
  }
  onSaved();  // Only after success
  onClose();
  ```
  - Example from RecruiterHubContent:
  ```typescript
  const fetchProspects = useCallback(async () => {
    setProspectsLoading(true);
    try {
      const response = await fetch('/api/recruiter-hub/prospects', { ... });
      const data = await response.json();
      setProspects(data.records || []);  // Set after fetch
    } finally {
      setProspectsLoading(false);
    }
  }, [filters]);
  ```
  - **Interpretation:**
    - **Pessimistic updates** throughout codebase
    - Loading states during fetch
    - Data set only after successful response
    - For GC Hub: Follow same pattern — wait for server confirmation before updating UI

### 7.4 — Toast/Notification Pattern
- **Question:** Search for toast notifications or success/error messages after mutations. Is there a toast library installed? How do existing forms show save confirmation?
- **Why:** Inline edits need feedback ("Value updated" / "Error saving").
- **Finding:**
  - **Grep result:** "toast" appears in 4 files but only in markdown/docs
  - **No toast library installed** (no react-hot-toast, sonner, etc.)
  - **Current feedback pattern:** Inline error messages in forms
  ```typescript
  {error && (
    <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-sm text-red-600 dark:text-red-400">
      {error}
    </div>
  )}
  ```
  - **Success feedback:** Modal closes, parent refreshes data
  - **Interpretation:**
    - No toast system exists
    - Error shown inline in form
    - Success implied by modal closing
    - For GC Hub: Could add toast library (sonner recommended) OR use inline success/error messages

---

## Phase 7 Complete

**Summary:** Mutation patterns are straightforward:
1. PUT for full updates, PATCH for partial
2. Modal forms with explicit Save button
3. Pessimistic updates (wait for server)
4. Inline error messages (no toast library)
5. For GC Hub: Follow same patterns, consider adding toast for inline edit feedback

---

## Phase 8: Environment & Deployment

**Goal:** Understand deployment constraints for the new features.

### 8.1 — Vercel Configuration
- **File:** `vercel.json`
- **Question:** Paste the complete file. What function timeouts are configured? What cron jobs exist?
- **Why:** Need to add a cron job for Sheets sync and potentially extend function timeouts for the ETL.
- **Finding:**
  - **File path:** `vercel.json` (complete)
  ```json
  {
    "functions": {
      "src/app/api/dashboard/export-sheets/route.ts": { "maxDuration": 60 },
      "src/app/api/agent/query/route.ts": { "maxDuration": 60 },
      "src/app/api/admin/trigger-transfer/route.ts": { "maxDuration": 60 },
      "src/app/api/cron/trigger-transfer/route.ts": { "maxDuration": 60 },
      "src/app/api/cron/geocode-advisors/route.ts": { "maxDuration": 60 }
    },
    "crons": [
      { "path": "/api/cron/geocode-advisors", "schedule": "0 5 * * *" },
      { "path": "/api/cron/refresh-cache", "schedule": "10 4 * * *" },
      { "path": "/api/cron/refresh-cache", "schedule": "10 10 * * *" },
      { "path": "/api/cron/refresh-cache", "schedule": "10 16 * * *" },
      { "path": "/api/cron/refresh-cache", "schedule": "10 22 * * *" },
      { "path": "/api/cron/refresh-cache", "schedule": "47 19 * * 5" },
      { "path": "/api/cron/refresh-cache", "schedule": "47 20 * * 5" },
      { "path": "/api/cron/refresh-cache", "schedule": "47 22 * * 5" }
    ]
  }
  ```
  - **Interpretation:**
    - Default timeout: 10 seconds (Vercel default)
    - Extended timeout: 60 seconds for long-running operations
    - Multiple cron schedules (cache refresh runs 4x daily + extra on Fridays)
    - For GC Hub: Add function timeout for sync route, add cron entry

### 8.2 — Environment Variables
- **File:** `.env.example`
- **Question:** List all environment variables currently defined. Which ones are Google-related?
- **Why:** The GC Hub sync will need the Sheets service account credentials. Need to confirm if existing env vars cover this or if new ones are needed.
- **Finding:**
  - **Google-related env vars:**
  ```bash
  # BigQuery
  GCP_PROJECT_ID=savvy-gtm-analytics
  GOOGLE_APPLICATION_CREDENTIALS=./service-account-key.json
  GOOGLE_APPLICATION_CREDENTIALS_JSON={"type":"service_account",...}

  # Google OAuth
  GOOGLE_CLIENT_ID=...
  GOOGLE_CLIENT_SECRET=...

  # Google Sheets
  GOOGLE_SHEETS_WEBAPP_URL=https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec
  GOOGLE_SHEETS_CREDENTIALS_JSON={"type":"service_account",...}
  GOOGLE_SHEETS_SERVICE_ACCOUNT_PATH=./google-sheets-service-account.json
  ```
  - **Interpretation:**
    - Sheets credentials already configured (`GOOGLE_SHEETS_CREDENTIALS_JSON`)
    - Same service account can be used for reading
    - May need to add: `GC_HUB_SPREADSHEET_ID` for the Revenue Estimates workbook ID

### 8.3 — Build Configuration
- **File:** `package.json`, `next.config.js` or `next.config.mjs`
- **Question:** What's the build command? Any special webpack configuration? Is Sentry integrated at build time?
- **Why:** New Prisma models require `prisma generate` before build. Need to confirm this is in the build chain.
- **Finding:**
  - **Build command (package.json line 8):**
  ```json
  "build": "cross-env NODE_OPTIONS=--max-old-space-size=8192 prisma generate && node --max-old-space-size=8192 ./node_modules/next/dist/bin/next build",
  ```

  - **next.config.js (key parts):**
  ```javascript
  const { withSentryConfig } = require("@sentry/nextjs");

  const nextConfig = {
    reactStrictMode: true,
    experimental: { instrumentationHook: true },
    typescript: { ignoreBuildErrors: false },
    eslint: { ignoreDuringBuilds: true },
    images: { remotePatterns: [...] },
  };

  module.exports = withSentryConfig(nextConfig, {
    silent: true,
    org: "savvy-wealth-se",
    project: "javascript-nextjs",
  }, { ... });
  ```

  - **Interpretation:**
    - `prisma generate` runs before build — new models will be included
    - 8GB memory limit for build (large codebase)
    - Sentry integrated at build time
    - TypeScript errors block build, ESLint warnings don't
    - `postinstall` also runs `prisma generate`

### 8.4 — TypeScript Configuration
- **File:** `tsconfig.json`
- **Question:** What's the `strict` setting? Any path aliases (e.g., `@/`)? What's the target?
- **Why:** Implementation guide code snippets must match the project's TS config.
- **Finding:**
  - **File path:** `tsconfig.json`
  ```json
  {
    "compilerOptions": {
      "target": "ES2017",
      "lib": ["dom", "dom.iterable", "esnext"],
      "allowJs": true,
      "skipLibCheck": true,
      "strict": true,
      "noEmit": true,
      "esModuleInterop": true,
      "module": "esnext",
      "moduleResolution": "bundler",
      "resolveJsonModule": true,
      "isolatedModules": true,
      "jsx": "preserve",
      "incremental": true,
      "plugins": [{ "name": "next" }],
      "paths": {
        "@/*": ["./src/*"]
      }
    },
    "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
    "exclude": ["node_modules", "prisma/seed.ts"]
  }
  ```
  - **Interpretation:**
    - **strict: true** — must handle nulls, use proper types
    - Path alias: `@/*` maps to `./src/*`
    - Target: ES2017 (async/await supported)
    - moduleResolution: bundler (Next.js 13+)

---

## Phase 8 Complete

**Summary:** Deployment configuration is standard:
1. Build includes `prisma generate`
2. Function timeouts up to 60s available
3. Crons registered in `vercel.json`
4. Google Sheets credentials already configured
5. Strict TypeScript mode, `@/` path alias

---

## Phase 9: Data Anonymization Patterns

**Goal:** Determine if any anonymization logic already exists or needs to be built from scratch.

### 9.1 — Existing Data Masking
- **Question:** Search the codebase for any anonymization, masking, or data hiding logic. Search for terms like "anonymize", "mask", "redact", "hide", "obfuscate", "Advisor 0".
- **Why:** Capital Partners see anonymized advisor names. Need to know if any pattern exists.
- **Finding:**
  - **Grep result:** No matches found in source code
  - **Interpretation:**
    - **No existing anonymization logic** in the codebase
    - Must build from scratch for GC Hub
    - Need deterministic mapping: real name → anonymous ID

### 9.2 — Recruiter Data Isolation Pattern
- **Question:** How does the recruiter hub filter data? Is filtering done at the API level (query filter) or UI level (hide columns)? Paste the data scoping logic.
- **Why:** The Capital Partner anonymization is more complex than recruiter filtering (showing all data but with masked names vs. showing only your agency's data). Need to understand the existing approach.
- **Finding:**
  - **API-level filtering (from `src/lib/queries/recruiter-hub.ts`):**
  ```typescript
  export async function getRecruiterProspects(
    recruiterFilter: string | null,  // e.g., "New England Partners"
    filters: { ... }
  ): Promise<RecruiterProspect[]> {
    const conditions: string[] = [...];

    // Recruiter filter (required for recruiters, ignored for admins)
    if (recruiterFilter) {
      conditions.push('External_Agency__c = @recruiterFilter');
      params.recruiterFilter = recruiterFilter;
    }

    // Query with filter
    const query = `SELECT ... FROM table WHERE ${conditions.join(' AND ')}`;
  }
  ```
  - **Interpretation:**
    - **Query-level filtering** — data is filtered before returning to client
    - Recruiters only see their agency's data (row filtering)
    - For Capital Partners: Different approach needed:
      - See ALL data (no row filtering)
      - But advisor names are masked (column transformation)
      - Admins see real names
    - Anonymization should happen in query layer or API response transformation

### 9.3 — Consistent Anonymization
- **Question:** For GC Hub, anonymized names must be consistent across sessions ("Eric Kirste" → "Advisor 003" every time, not randomly assigned). Is there any existing pattern for deterministic mapping? Or will we need to build a lookup table?
- **Why:** If GC drills into "Advisor 003" today and comes back tomorrow, it must still be "Advisor 003".
- **Finding:**
  - **No existing pattern** found
  - **Recommendation:** Build `GcAdvisorMapping` table
  ```sql
  CREATE TABLE gc_advisor_mapping (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    real_advisor_name TEXT NOT NULL UNIQUE,
    anonymous_id TEXT NOT NULL UNIQUE,  -- "Advisor 001", "Advisor 002", etc.
    created_at TIMESTAMP DEFAULT NOW()
  );
  ```
  - **Logic:**
    1. On first encounter of advisor name, assign next available anonymous ID
    2. Store mapping in database
    3. Query uses mapping to transform names for Capital Partners
    4. Admin queries bypass mapping

---

## Phase 9 Complete

**Summary:** Anonymization must be built from scratch:
1. No existing anonymization logic
2. Recruiter filtering is row-based (not relevant)
3. Need `GcAdvisorMapping` table for deterministic name→ID mapping
4. Apply transformation at API response level for Capital Partners

---

## Phase 10: Testing & Validation Patterns

**Goal:** Understand what testing infrastructure exists so the implementation guide includes proper verification steps.

### 10.1 — Test Scripts
- **File:** `scripts/` directory
- **Question:** List all test scripts. Are there any that verify data integrity, API responses, or dashboard calculations?
- **Why:** Implementation guide phases need verification steps. Should follow existing test patterns.
- **Finding:**
  - **Script files:**
  ```
  check-enabled-apis.js
  check-luis-rosa.js
  check-user.js
  cleanup-geocoded-duplicates.js
  count-joined-advisors-full-address.js
  create-advisor-location-view.js
  create-geocoded-addresses-table.js
  diagnose-joined-count.js
  discover-dashboards-tasks.ts
  discover-dashboards-workflow.ts
  discover-dashboards-workflow-v2.ts
  discover-wrike.ts
  enrich-la-advisors-lead-opp.ts
  geocode-advisors.js
  list-advisors-no-full-address.js
  query-workflow.ts
  run-location-investigation-queries.js
  test-dashboard-queries.js
  test-metabase-connection.js
  test-query.js
  verify-geocoding.js
  verify-pipeline-catcher.js
  verify-recruiter-security.js
  verify-seed.js
  ```
  - **Relevant test scripts:**
    - `test-dashboard-queries.js` — tests BigQuery queries
    - `verify-recruiter-security.js` — verifies role-based access
    - `verify-seed.js` — verifies database seeding
  - **Interpretation:**
    - **No Jest/Vitest test suite** — uses ad-hoc verification scripts
    - Scripts run via `node scripts/script-name.js`
    - For GC Hub: Create verification scripts for:
      - `verify-gc-hub-sync.js` — verify Sheets→DB sync
      - `verify-gc-hub-permissions.js` — verify Capital Partner access restrictions

### 10.2 — Linting Configuration
- **File:** `.eslintrc*`, `package.json` lint script
- **Question:** What linting rules are configured? What's the lint command?
- **Why:** Every phase of the implementation guide should end with a lint check.
- **Finding:**
  - **No `.eslintrc*` file** in project root (only in node_modules)
  - Uses **Next.js default ESLint config** (`eslint-config-next`)
  - **Lint command (package.json):**
  ```json
  "lint": "next lint"
  ```
  - **Build config (next.config.js):**
  ```javascript
  eslint: { ignoreDuringBuilds: true }
  ```
  - **Interpretation:**
    - Lint is available but not blocking builds
    - Run `npm run lint` to check
    - For GC Hub: Run lint after each implementation phase

### 10.3 — Type Checking
- **Question:** Is `tsc --noEmit` used for type checking? What's the command to run a full type check?
- **Why:** Every phase should end with a type check to catch issues early.
- **Finding:**
  - **No dedicated type-check script** in package.json
  - Build uses TypeScript: `typescript: { ignoreBuildErrors: false }`
  - **To run type check manually:**
  ```bash
  npx tsc --noEmit
  ```
  - **Interpretation:**
    - Type errors block production builds
    - Can run `npx tsc --noEmit` for quick checks during development

### 10.4 — Build Verification
- **Question:** What's the full build command? How long does a typical build take? Are there known build warnings to ignore?
- **Why:** The implementation guide should include build verification at key milestones.
- **Finding:**
  - **Build command:**
  ```bash
  npm run build
  # Expands to:
  # cross-env NODE_OPTIONS=--max-old-space-size=8192 prisma generate && node --max-old-space-size=8192 ./node_modules/next/dist/bin/next build
  ```
  - **Build characteristics:**
    - Requires 8GB memory (large codebase)
    - Runs `prisma generate` first
    - Sentry upload happens during build
    - ESLint warnings ignored (`ignoreDuringBuilds: true`)
  - **Interpretation:**
    - Full build is the ultimate verification
    - For GC Hub: Run full build after completing major features

---

## Phase 10 Complete

**Summary:** Testing patterns are script-based:
1. No formal test framework (Jest/Vitest)
2. Ad-hoc verification scripts in `scripts/`
3. Lint via `npm run lint`
4. Type check via `npx tsc --noEmit`
5. Full build via `npm run build`

---

## Addendum A: Gaps 1 & 2 — Role System Deep Dive

> **Context:** This addendum addresses two gaps identified after the initial investigation pass. These findings are critical for the implementation guide because they reveal (1) a defense-in-depth authorization layer that was missed, and (2) a pre-existing bug in the codebase where a local type definition has diverged from the single source of truth.

---

### Gap 1.1 — forbidRecruiter() Implementation

- **File:** `src/lib/api-authz.ts`
- **Command:** `cat -n src/lib/api-authz.ts`
- **Finding:**
  - **File path:** `src/lib/api-authz.ts`, lines 1-9 (COMPLETE FILE)
  - **Exact code:**
    ```typescript
    import { NextResponse } from 'next/server';
    import type { UserPermissions } from '@/types/user';

    /**
     * Returns a 403 Forbidden response if the user is a recruiter.
     * Use inside API route handlers as a defense-in-depth check.
     */
    export function forbidRecruiter(permissions: UserPermissions) {
      if (permissions.role !== 'recruiter') return null;
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    ```
  - **Interpretation:**
    - **This IS a separate helper function** — the original investigation (section 1.4) incorrectly concluded it was inline in middleware only
    - Takes `UserPermissions` object (not session, not request)
    - Returns `null` if allowed, `NextResponse` 403 if forbidden
    - Pattern: Check role, return early if forbidden
    - Import path: `@/lib/api-authz`

---

### Gap 1.2 — API Routes Using forbidRecruiter()

- **Command:** `grep -rn "forbidRecruiter" src/app/api/ --include="*.ts" | sort`
- **Finding:**
  - **Total files using forbidRecruiter:** 20 files
  - **Complete list of API routes:**
    ```
    src/app/api/dashboard/advisor-map/route.ts:4:import { forbidRecruiter } from '@/lib/api-authz';
    src/app/api/dashboard/advisor-map/route.ts:22:  const forbidden = forbidRecruiter(permissions);
    src/app/api/dashboard/attribution/route.ts:4:import { forbidRecruiter } from '@/lib/api-authz';
    src/app/api/dashboard/attribution/route.ts:22:  const forbidden = forbidRecruiter(permissions);
    src/app/api/dashboard/conversion-rates/route.ts:5:import { forbidRecruiter } from '@/lib/api-authz';
    src/app/api/dashboard/conversion-rates/route.ts:32:  const forbidden = forbidRecruiter(permissions);
    src/app/api/dashboard/explore-results/route.ts:5:import { forbidRecruiter } from '@/lib/api-authz';
    src/app/api/dashboard/explore-results/route.ts:31:  const forbidden = forbidRecruiter(permissions);
    src/app/api/dashboard/explore/route.ts:4:import { forbidRecruiter } from '@/lib/api-authz';
    src/app/api/dashboard/explore/route.ts:31:  const forbidden = forbidRecruiter(permissions);
    src/app/api/dashboard/funnel-chart/route.ts:6:import { forbidRecruiter } from '@/lib/api-authz';
    src/app/api/dashboard/funnel-chart/route.ts:32:  const forbidden = forbidRecruiter(permissions);
    src/app/api/dashboard/funnel-metrics/route.ts:5:import { forbidRecruiter } from '@/lib/api-authz';
    src/app/api/dashboard/funnel-metrics/route.ts:31:  const forbidden = forbidRecruiter(permissions);
    src/app/api/dashboard/funnel-trend/route.ts:5:import { forbidRecruiter } from '@/lib/api-authz';
    src/app/api/dashboard/funnel-trend/route.ts:27:  const forbidden = forbidRecruiter(permissions);
    src/app/api/dashboard/lead-source-report/route.ts:4:import { forbidRecruiter } from '@/lib/api-authz';
    src/app/api/dashboard/lead-source-report/route.ts:27:  const forbidden = forbidRecruiter(permissions);
    src/app/api/dashboard/live-metrics/route.ts:5:import { forbidRecruiter } from '@/lib/api-authz';
    src/app/api/dashboard/live-metrics/route.ts:32:  const forbidden = forbidRecruiter(permissions);
    src/app/api/dashboard/phase-analysis/route.ts:4:import { forbidRecruiter } from '@/lib/api-authz';
    src/app/api/dashboard/phase-analysis/route.ts:31:  const forbidden = forbidRecruiter(permissions);
    src/app/api/dashboard/source-performance/route.ts:4:import { forbidRecruiter } from '@/lib/api-authz';
    src/app/api/dashboard/source-performance/route.ts:28:  const forbidden = forbidRecruiter(permissions);
    src/app/api/dashboard/table-data/route.ts:5:import { forbidRecruiter } from '@/lib/api-authz';
    src/app/api/dashboard/table-data/route.ts:33:  const forbidden = forbidRecruiter(permissions);
    src/app/api/dashboard/velocity-analysis/route.ts:4:import { forbidRecruiter } from '@/lib/api-authz';
    src/app/api/dashboard/velocity-analysis/route.ts:22:  const forbidden = forbidRecruiter(permissions);
    src/app/api/sga-hub/lead-list/route.ts:6:import { forbidRecruiter } from '@/lib/api-authz';
    src/app/api/sga-hub/lead-list/route.ts:31:  const forbidden = forbidRecruiter(permissions);
    src/app/api/sga-hub/sga-metrics/route.ts:5:import { forbidRecruiter } from '@/lib/api-authz';
    src/app/api/sga-hub/sga-metrics/route.ts:35:  const forbidden = forbidRecruiter(permissions);
    src/app/api/sga-hub/sga-summary/route.ts:5:import { forbidRecruiter } from '@/lib/api-authz';
    src/app/api/sga-hub/sga-summary/route.ts:35:  const forbidden = forbidRecruiter(permissions);
    src/app/api/sga-hub/touch-point-details/route.ts:5:import { forbidRecruiter } from '@/lib/api-authz';
    src/app/api/sga-hub/touch-point-details/route.ts:25:  const forbidden = forbidRecruiter(permissions);
    src/app/api/sga-hub/touch-point-summary/route.ts:5:import { forbidRecruiter } from '@/lib/api-authz';
    src/app/api/sga-hub/touch-point-summary/route.ts:35:  const forbidden = forbidRecruiter(permissions);
    ```
  - **Interpretation:**
    - **20 API routes** use this defense-in-depth check
    - All are POST handlers for dashboard data endpoints
    - Pattern: `import { forbidRecruiter }` + call early in handler
    - Directories affected: `/api/dashboard/` (15 routes), `/api/sga-hub/` (5 routes)
    - **For capital_partner:** Must add `forbidCapitalPartner()` to these same routes

---

### Gap 1.3 — Complete Usage Example in Context

- **File:** `src/app/api/dashboard/funnel-metrics/route.ts`
- **Command:** `cat -n src/app/api/dashboard/funnel-metrics/route.ts`
- **Finding:**
  - **File path:** `src/app/api/dashboard/funnel-metrics/route.ts`, lines 1-78
  - **Exact code (relevant section):**
    ```typescript
    import { NextResponse } from 'next/server';
    import { getServerSession } from 'next-auth';
    import { authOptions } from '@/lib/auth';
    import { getSessionPermissions } from '@/lib/session';
    import { forbidRecruiter } from '@/lib/api-authz';
    // ... other imports ...

    export async function POST(request: Request) {
      try {
        // 1. Get session
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // 2. Get permissions from session
        const permissions = await getSessionPermissions(session);
        if (!permissions) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // 3. DEFENSE-IN-DEPTH: Block recruiters at API level
        const forbidden = forbidRecruiter(permissions);
        if (forbidden) return forbidden;

        // 4. Parse request body and execute query...
        const body = await request.json();
        // ...
      }
    }
    ```
  - **Interpretation:**
    - Import is a **named import** from `@/lib/api-authz`
    - Called **AFTER** session and permissions are obtained
    - Called **BEFORE** any data queries
    - Arguments: `permissions` object (from `getSessionPermissions`)
    - Result handling: `if (forbidden) return forbidden;` (early return pattern)
    - **Template for `forbidCapitalPartner()`:** Identical pattern

---

### Gap 1.4 — Extensibility Assessment for capital_partner

Based on the actual implementation found:

1. **Is `forbidRecruiter()` hardcoded to `'recruiter'`?**
   - **YES** — the string `'recruiter'` is hardcoded in the function

2. **Could we add `forbidCapitalPartner()` as a sibling function?**
   - **YES** — simple to add in the same file:
     ```typescript
     export function forbidCapitalPartner(permissions: UserPermissions) {
       if (permissions.role !== 'capital_partner') return null;
       return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
     }
     ```

3. **Would a generic `forbidRoles(...roles: string[])` be cleaner?**
   - **YES** — but requires updating 20 files to change call sites
   - Possible implementation:
     ```typescript
     export function forbidRoles(permissions: UserPermissions, ...roles: UserRole[]) {
       if (!roles.includes(permissions.role)) return null;
       return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
     }
     ```
   - Call site: `forbidRoles(permissions, 'recruiter', 'capital_partner')`

4. **Recommendation for implementation guide:**
   - **Option A (Minimal change):** Add `forbidCapitalPartner()` as sibling function, update 20 call sites to add second check
   - **Option B (Cleaner but more changes):** Refactor to `forbidRoles()`, update all 20 call sites
   - **Recommended: Option A** — lower risk, follows existing pattern, can refactor later

---

### Gap 2.1 — Local User Interface in users.ts

- **File:** `src/lib/users.ts`
- **Command:** `cat -n src/lib/users.ts | head -80` and `grep -n "role\|Role" src/lib/users.ts`
- **Finding:**
  - **File path:** `src/lib/users.ts`, lines 1-16
  - **Exact code:**
    ```typescript
    import prisma from './prisma';
    import bcrypt from 'bcryptjs';

    // Local User interface for this module
    // NOTE: This should ideally import UserRole from @/types/user.ts
    export interface User {
      id: string;
      email: string;
      name: string;
      role: 'admin' | 'manager' | 'sgm' | 'sga' | 'viewer' | 'recruiter';  // ⚠️ MISSING revops_admin!
      isActive?: boolean;
      externalAgency?: string | null;
      createdAt?: Date;
      updatedAt?: Date;
    }
    ```
  - **Interpretation:**
    - **CRITICAL BUG FOUND:** This local interface has an **INLINE role union** that is ALREADY out of sync
    - Missing `'revops_admin'` which exists in the main `UserRole` type
    - Does **NOT** import `UserRole` from `@/types/user.ts`
    - This means: Adding `'capital_partner'` to `src/types/user.ts` will NOT propagate here
    - **Must fix this file separately** when adding `capital_partner`

---

### Gap 2.2 — Import Chain Analysis

- **Command:** `head -15 src/lib/users.ts`
- **Finding:**
  - **File path:** `src/lib/users.ts`, lines 1-5
  - **Exact imports:**
    ```typescript
    import prisma from './prisma';
    import bcrypt from 'bcryptjs';
    ```
  - **Interpretation:**
    - **NO import of `UserRole`** from `@/types/user.ts`
    - This file defines its own inline role union
    - **This is a bug** — the file is already out of sync (missing `revops_admin`)
    - **Recommended fix:** Replace inline union with `import { UserRole } from '@/types/user'` and use `role: UserRole`

---

### Gap 2.3 — Files with UserRole References

- **Command:** `grep -rln "UserRole" src/ --include="*.ts" --include="*.tsx" | sort`
- **Finding:**
  - **Files that correctly import/use UserRole (3 files):**
    ```
    src/lib/auth.ts
    src/lib/permissions.ts
    src/types/user.ts
    ```
  - **Files that reference `revops_admin` directly (sample of 32 files):**
    - `src/app/dashboard/settings/page.tsx`
    - `src/components/settings/UserModal.tsx`
    - `src/middleware.ts`
    - Many others...

  - **Interpretation:**
    - Only **3 files** properly import the `UserRole` type
    - Most files do role checks with hardcoded strings (`role === 'revops_admin'`)
    - `src/lib/users.ts` uses its own inline definition — **this is the problem file**
    - **Implementation guide must include:**
      1. Add `'capital_partner'` to `src/types/user.ts` (single source of truth)
      2. Fix `src/lib/users.ts` to import `UserRole` instead of inline definition
      3. Add role string to hardcoded checks where needed (middleware, API routes)

---

### Gap Summary — Implementation Implications

| Gap | Issue | Fix Required |
|-----|-------|--------------|
| 1.1-1.4 | `forbidRecruiter()` exists as separate helper | Add `forbidCapitalPartner()` to `src/lib/api-authz.ts` |
| 1.2 | 20 API routes use the helper | Add `forbidCapitalPartner()` call to all 20 routes |
| 2.1-2.2 | `src/lib/users.ts` has divergent role type | Refactor to import `UserRole` from `@/types/user.ts` |
| 2.3 | Pre-existing bug: missing `revops_admin` | Fix will also resolve this bug |

---

## Addendum B: Gaps 3, 4 & 5 — UI, Credentials & UX Decisions

> **Context:** This addendum addresses three additional gaps discovered after the initial investigation. These findings provide: (1) the exact UserModal code needed to add `capital_partner` to the role dropdown, (2) confirmation of the Google Sheets service account and workbook access status, and (3) a UI/UX decision framework grounded in existing codebase patterns for Alice to review.

---

### Gap 3.1 — UserModal Role Dropdown Implementation

- **File:** `src/components/settings/UserModal.tsx`
- **Command:** `cat -n src/components/settings/UserModal.tsx`
- **Finding:**
  - **File path:** `src/components/settings/UserModal.tsx`, lines 226-238
  - **Exact code (role dropdown):**
    ```typescript
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        Role *
      </label>
      <select
        value={formData.role}
        onChange={(e) => handleRoleChange(e.target.value as typeof formData.role)}
        className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
      >
        <option value="revops_admin">RevOps Admin - Full access + manage Dashboard Requests</option>
        <option value="admin">Admin - Full access, can manage users</option>
        <option value="manager">Manager - Full access, can manage users</option>
        <option value="sgm">SGM - Team data, pages 1-3 & 6</option>
        <option value="sga">SGA - Own data only, pages 1-2 & 6</option>
        <option value="viewer">Viewer - Read-only, pages 1-2</option>
        <option value="recruiter">Recruiter - Recruiter Hub only, filtered by agency</option>
      </select>
    </div>
    ```
  - **Interpretation:**
    - Role dropdown uses **hardcoded `<option>` elements** — NOT an array or imported constant
    - Each option has: `value` (role string) and display text (descriptive label)
    - To add `capital_partner`: Insert new option, e.g.:
      ```typescript
      <option value="capital_partner">Capital Partner - GC Hub only, anonymized advisor view</option>
      ```

---

### Gap 3.2 — Conditional Field Pattern (recruiter → externalAgency)

- **File:** `src/components/settings/UserModal.tsx`
- **Finding:**
  - **File path:** `src/components/settings/UserModal.tsx`, lines 241-279
  - **Exact code (conditional field pattern):**
    ```typescript
    {formData.role === 'recruiter' && (
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          External Agency *
        </label>
        {agenciesLoading ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">Loading agencies...</div>
        ) : (
          <>
            <select
              value={formData.externalAgencyIsOther ? '__OTHER__' : formData.externalAgency}
              onChange={(e) => handleAgencySelect(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg ..."
            >
              <option value="">-- Select Agency --</option>
              {agencies.map((agency) => (
                <option key={agency} value={agency}>{agency}</option>
              ))}
              <option value="__OTHER__">Other (enter manually)</option>
            </select>
            {formData.externalAgencyIsOther && (
              <input type="text" ... placeholder="Enter agency name exactly as in Salesforce" />
            )}
          </>
        )}
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          This recruiter will only see data for this agency.
        </p>
      </div>
    )}
    ```
  - **Interpretation:**
    - Conditional field appears when `role === 'recruiter'`
    - Uses dropdown with async-loaded options + "Other" manual entry fallback
    - For `capital_partner`: Could add similar pattern for `capitalPartnerCompany` field if needed:
      ```typescript
      {formData.role === 'capital_partner' && (
        <div>
          <label>Capital Partner Company *</label>
          <input ... placeholder="e.g., GC Capital Partners" />
          <p>This partner will only see anonymized data for their portfolio advisors.</p>
        </div>
      )}
      ```

---

### Gap 3.3 — Role Display Colors (UserManagement.tsx)

- **File:** `src/components/settings/UserManagement.tsx`
- **Finding:**
  - **File path:** `src/components/settings/UserManagement.tsx`, lines 15-22
  - **Exact code:**
    ```typescript
    const ROLE_COLOR_CLASSES: Record<string, string> = {
      admin: 'text-red-600 dark:text-red-400',
      manager: 'text-blue-600 dark:text-blue-400',
      sgm: 'text-green-600 dark:text-green-400',
      sga: 'text-yellow-600 dark:text-yellow-400',
      viewer: 'text-gray-600 dark:text-gray-400',
      recruiter: 'text-purple-600 dark:text-purple-400',
    };
    ```
  - **Interpretation:**
    - **Missing `revops_admin`** — falls back to default gray (pre-existing bug)
    - **For `capital_partner`:** Add entry, e.g.:
      ```typescript
      revops_admin: 'text-orange-600 dark:text-orange-400',  // Fix existing bug
      capital_partner: 'text-teal-600 dark:text-teal-400',   // New role
      ```

---

### Gap 3.4 — Settings Page Structure

- **Files in settings:**
  - `src/app/dashboard/settings/page.tsx` — Main settings page
  - `src/components/settings/UserModal.tsx` — Add/edit user modal
  - `src/components/settings/UserManagement.tsx` — User list table
  - `src/components/settings/DeleteConfirmModal.tsx` — Delete confirmation
  - `src/components/settings/ResetPasswordModal.tsx` — Password reset
  - `src/components/settings/ChangePasswordModal.tsx` — Change own password

- **Finding:** Settings page shows:
  1. "My Account" section (change password) — visible to all users
  2. "User Management" section — visible only if `permissions?.canManageUsers`

- **Interpretation:** No changes needed to Settings page structure for `capital_partner` — they will only see "My Account" section (no user management access).

---

### Gap 4.1 — Service Account Verification

- **Command:** `grep -rn "savvy-pirate-extension|sheet-436" src/`
- **Finding:**
  - **No direct references** to the service account email in the codebase
  - Service account credentials are provided via environment variables:
    - `GOOGLE_SHEETS_CREDENTIALS_JSON` (Vercel deployment)
    - `GOOGLE_SHEETS_SERVICE_ACCOUNT_PATH` (local development)
  - **Confirmed service account email:** `sheet-436@savvy-pirate-extension.iam.gserviceaccount.com`

---

### Gap 4.2 — Google Sheets Scope Verification

- **File:** `src/lib/sheets/google-sheets-exporter.ts`
- **Command:** `grep -n "scopes\|googleapis.com/auth" src/lib/sheets/google-sheets-exporter.ts`
- **Finding:**
  - **File path:** `src/lib/sheets/google-sheets-exporter.ts`, lines 68-69
  - **Exact code:**
    ```typescript
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
    ```
  - **Interpretation:**
    - Uses **full `spreadsheets` scope** — includes both read AND write access
    - **No additional scope needed** for GC Hub to read from spreadsheets
    - The existing auth client can be reused for read operations

---

### Gap 4.3 — Workbook Access Status Checklist

| Workbook | Spreadsheet ID | Shared with Service Account? | Access Needed |
|----------|---------------|------------------------------|---------------|
| **Revenue Estimates (2026+)** | `1-6cBC1V2H7V-DrzpkII2qPshJyzriWpfjS80VEnPWq4` | ✅ **YES** (confirmed shared) | Read (live sync) |
| Advisor Payouts Tracker (Template) | `1nwovNkfJw8MZ...` | ⚠️ **NEEDS VERIFICATION** | Read (one-time ETL) |
| Q3 2025 Payouts | `18J5UqxhIIxVx...` | ⚠️ **NEEDS VERIFICATION** | Read (one-time ETL) |
| Q4 2025 Payroll Summary | `1mEFirIgl9iwr...` | ⚠️ **NEEDS VERIFICATION** | Read (one-time ETL) |
| **Billing Frequency & Style** | `1JdAxt4ceY8PFMWGERK5IM2xOCXcQy-oQarlCbWI9UhU` | ❌ **NO** (permission denied in exploration) | Read (one-time ETL) |

**Action Items:**
1. ✅ Revenue Estimates workbook is already shared — no action needed
2. ❌ **Share Billing Frequency & Style workbook** with `sheet-436@savvy-pirate-extension.iam.gserviceaccount.com` (Viewer access)
3. ⚠️ **Verify/share historical payout workbooks** with service account if they will be used for ETL

---

### Gap 5.1 — Existing Page Layout Patterns

**Pattern A: Funnel Performance Dashboard (page 1)**
- `src/app/dashboard/page.tsx`
- Layout: Filters → Scorecards → Charts (lazy-loaded) → Tables (lazy-loaded)
- Components: `GlobalFilters`, `Scorecards`, `ConversionRateCards`, `VolumeTrendChart`, `ChannelPerformanceTable`, `SourcePerformanceTable`, `DetailRecordsTable`
- Features: Saved reports, export to sheets, record detail modal
- **Best for:** Data-heavy pages with multiple visualization layers

**Pattern B: SGA Hub (page 8) — Tabbed Interface**
- `src/app/dashboard/sga-hub/SGAHubContent.tsx`
- Layout: Tabs → Tab-specific content
- Tabs: Leaderboard, Weekly Goals, Closed Lost Follow-Up, Quarterly Progress, Activity
- Features: Role-based tab visibility (`isAdmin`), drill-down modals, CSV export per tab
- **Best for:** Multiple distinct views of related data

**Pattern C: Recruiter Hub (page 12) — Two-Table View**
- `src/app/dashboard/recruiter-hub/RecruiterHubContent.tsx`
- Layout: Filter panels → Prospects table → Opportunities table
- Features: Search, pagination, column sorting, stage filters, record detail modal
- **Best for:** Simple list views with filtering

---

### Gap 5.2 — Existing Drill-Down Patterns

| Pattern | Example Component | Trigger | Content |
|---------|-------------------|---------|---------|
| **Record Detail Modal** | `RecordDetailModal.tsx` | Click row/record | Full record details, Salesforce link, funnel stepper |
| **Metric Drill-Down Modal** | `MetricDrillDownModal.tsx` | Click metric card | List of records contributing to metric |
| **Volume Drill-Down Modal** | `VolumeDrillDownModal.tsx` | Click chart data point | Records for that time period |
| **Advisor Drill-Down Modal** | `AdvisorDrillDownModal.tsx` | Click map pin | Advisor details with edit capability |

**Common Pattern:**
```typescript
const [modalOpen, setModalOpen] = useState(false);
const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);

// In table row:
onClick={() => { setSelectedRecordId(record.id); setModalOpen(true); }}

// Modal component:
<RecordDetailModal isOpen={modalOpen} onClose={() => setModalOpen(false)} recordId={selectedRecordId} />
```

---

### Gap 5.3 — Existing Time Period Controls

| Pattern | Component | Usage |
|---------|-----------|-------|
| **Date Preset Dropdown** | `GlobalFilters.tsx` | "All Time", "YTD", "QTD", "Q1-Q4", "Last 30/90 Days", "Custom Range" |
| **Quarter Selector** | `LeaderboardFilters.tsx`, `AdminQuarterlyFilters.tsx` | Quarter dropdown (Q1 2024, Q2 2024, etc.) |
| **Week Range Picker** | `SGAHubContent.tsx` | Start/end date for weekly goals |
| **Custom Date Range** | `GlobalFilters.tsx` + `AdvancedFilters.tsx` | Two date inputs (start/end) |

**Date Presets Array (from GlobalFilters.tsx):**
```typescript
const DATE_PRESETS = [
  { value: 'alltime', label: 'All Time' },
  { value: 'ytd', label: 'Year to Date' },
  { value: 'qtd', label: 'Quarter to Date' },
  { value: 'q1', label: 'Q1' },
  { value: 'q2', label: 'Q2' },
  { value: 'q3', label: 'Q3' },
  { value: 'q4', label: 'Q4' },
  { value: 'last30', label: 'Last 30 Days' },
  { value: 'last90', label: 'Last 90 Days' },
  { value: 'custom', label: 'Custom Range' },
];
```

---

### Gap 5.4 — UI/UX Decision Menu for Alice

Based on existing codebase patterns, here are structured options for GC Hub design decisions:

---

#### Decision 1: GC Hub Home Page Layout

**Option A: Scorecard Row + Chart + Table** (follows Funnel Performance pattern)
- KPI cards: Total Revenue, Total Commissions, Total Amount Earned, Active Advisors
- Revenue trend chart below
- Advisor summary table at bottom
- ✅ PRO: Familiar layout, proven pattern, comprehensive at-a-glance
- ❌ CON: May be too data-heavy for Capital Partner view

**Option B: Tabs with Focused Views** (follows SGA Hub pattern)
- Tab 1: Portfolio Overview (KPIs + chart)
- Tab 2: Advisor Detail (searchable/sortable table)
- Tab 3: Period Comparison (side-by-side quarters)
- ✅ PRO: Organized, less overwhelming, easy to hide tabs from Capital Partners
- ❌ CON: More clicks to find data

**Option C: Single Scrolling Page with Sections** (follows Recruiter Hub pattern)
- All content vertically stacked: KPIs → Chart → Table
- Collapsible sections for progressive disclosure
- ✅ PRO: Everything visible, simple implementation
- ❌ CON: Long scroll, harder to navigate

**RECOMMENDATION:** Option B (Tabs) — tabs provide clean separation between Capital Partner view (Tab 1 only) and Admin view (all tabs). The anonymization boundary maps cleanly to tab visibility.

---

#### Decision 2: Drill-Down Behavior

**Option A: Modal Overlay** (follows RecordDetailModal pattern)
- Click advisor row → modal with full advisor details
- Modal shows: advisor info, financial metrics, payment history
- ✅ PRO: Keeps context, proven pattern, easy to close
- ❌ CON: Limited screen space

**Option B: Expandable Row** (not currently used in codebase)
- Click row → expands inline with additional details
- ✅ PRO: Keeps table visible, no overlay
- ❌ CON: No existing pattern to follow, more complex to implement

**Option C: Separate Detail Page** (not currently used)
- Click row → navigates to `/dashboard/gc-hub/advisor/[id]`
- ✅ PRO: Full page for complex details
- ❌ CON: Loses context, more navigation

**RECOMMENDATION:** Option A (Modal) — consistent with existing patterns, works well for Capital Partner view where we can hide sensitive fields.

---

#### Decision 3: Chart Types

**Option A: Line Chart for Trends** (follows VolumeTrendChart pattern)
- Monthly revenue trend over time
- Multiple series: Revenue, Commissions, Amount Earned
- ✅ PRO: Shows trends clearly, existing pattern

**Option B: Bar Chart for Comparisons** (follows some dashboard charts)
- Quarter-over-quarter comparison
- Side-by-side bars for current vs previous
- ✅ PRO: Easy comparison, clear differences

**Option C: Both — Line for trends, Bar for comparison**
- Line chart in "Overview" tab for trends
- Bar chart in "Period Comparison" tab
- ✅ PRO: Best of both, appropriate visualization per context
- ❌ CON: More components to build

**RECOMMENDATION:** Option C (Both) — use line chart for temporal trends, bar chart for period-over-period comparison.

---

#### Decision 4: Time Period Controls

**Option A: Quarter Selector Dropdown** (follows LeaderboardFilters pattern)
- Simple dropdown: Q1 2024, Q2 2024, Q3 2024, Q4 2024, etc.
- ✅ PRO: Simple, matches payout schedule granularity
- ❌ CON: No custom date ranges

**Option B: Date Preset Dropdown** (follows GlobalFilters pattern)
- All Time, YTD, QTD, Q1-Q4, Last 30/90 Days, Custom Range
- ✅ PRO: Flexible, familiar to dashboard users
- ❌ CON: Complexity may not be needed for GC Hub

**Option C: Period Tabs** (not currently used but simple)
- Horizontal tabs: Q1 | Q2 | Q3 | Q4 | YTD
- ✅ PRO: Very simple, obvious navigation
- ❌ CON: Limited to quarters, no custom ranges

**RECOMMENDATION:** Option A (Quarter Selector) — GC data is quarterly-focused (payout periods); simple dropdown is sufficient and matches data granularity.

---

#### Decision 5: Capital Partner vs Admin View

**Option A: Same Page, Hidden Elements**
- Both roles see same page structure
- Capital Partner: Tab 1 only visible, advisor names anonymized in table
- Admin: All tabs visible, full advisor names
- ✅ PRO: Single component, role-based conditional rendering
- ❌ CON: Complexity in conditional logic

**Option B: Separate Components**
- `GCHubAdminContent.tsx` — full featured
- `GCHubPartnerContent.tsx` — restricted view
- Page renders correct component based on role
- ✅ PRO: Clean separation, easier to reason about
- ❌ CON: Potential code duplication

**Option C: Shared Core with Wrapper**
- Shared data table/chart components
- Different wrapper pages for each role
- ✅ PRO: DRY, reusable components
- ❌ CON: More abstraction

**RECOMMENDATION:** Option A (Same Page, Hidden Elements) — follows existing pattern (SGA Hub uses `isAdmin` checks), simpler to maintain, anonymization handled at API level anyway.

---

#### Decision 6: Mobile Responsiveness

**Current State:**
- Most dashboard pages have basic responsive styles (`dark:` classes, Tailwind breakpoints)
- Tables use `overflow-x-auto` for horizontal scroll on mobile
- No dedicated mobile-first designs

**Option A: Desktop-First (current pattern)**
- Tables scroll horizontally on mobile
- Cards stack vertically
- ✅ PRO: Consistent with existing dashboard, less work
- ❌ CON: Not optimized for mobile

**Option B: Responsive Cards for Mobile**
- KPI cards: 2x2 grid on tablet, 1-column on mobile
- Table: Convert to card layout on mobile
- ✅ PRO: Better mobile experience
- ❌ CON: More design/development work

**RECOMMENDATION:** Option A (Desktop-First) — Capital Partners likely accessing from desktop during business hours. Match existing dashboard patterns. Mobile optimization can be Phase 2.

---

### Gap 5 Summary — Decision Matrix

| Decision | Recommended | Rationale |
|----------|-------------|-----------|
| 1. Page Layout | **Tabs (Option B)** | Clean separation for role-based visibility |
| 2. Drill-Down | **Modal (Option A)** | Existing pattern, works with anonymization |
| 3. Charts | **Both (Option C)** | Line for trends, bar for comparisons |
| 4. Time Controls | **Quarter Selector (Option A)** | Matches payout data granularity |
| 5. CP vs Admin | **Same Page (Option A)** | Follows existing `isAdmin` pattern |
| 6. Mobile | **Desktop-First (Option A)** | Matches existing dashboard, defer mobile |

---

## Investigation Complete

### Key Findings Summary

**Role System (Phase 1 + Addendum A):**
- Add `'capital_partner'` to `UserRole` union in `src/types/user.ts`
- Add to `ROLE_PERMISSIONS` with `allowedPages: [7, 16]`
- Replicate recruiter middleware blocks for dashboard + API routes
- **[Addendum A]** Add `forbidCapitalPartner()` to `src/lib/api-authz.ts` (defense-in-depth helper)
- **[Addendum A]** Add `forbidCapitalPartner()` call to 20 API route handlers that use `forbidRecruiter()`
- **[Addendum A - BUG FIX]** Refactor `src/lib/users.ts` to import `UserRole` instead of inline definition (currently missing `revops_admin`)

**Navigation (Phase 2):**
- Next available page ID: **16**
- Add to `PAGES` array in Sidebar
- Follow Recruiter Hub page/component pattern

**Database (Phase 3):**
- Use `@id @default(cuid())` for primary keys
- Manual SQL migrations (no Prisma migrate)
- Import prisma from `@/lib/prisma`

**Google Sheets (Phase 4 + Addendum B):**
- `googleapis` installed, auth pattern exists
- No existing READ patterns — must implement
- **[Addendum B]** Service account: `sheet-436@savvy-pirate-extension.iam.gserviceaccount.com`
- **[Addendum B]** Revenue Estimates workbook: ✅ Already shared
- **[Addendum B]** Billing Frequency workbook: ❌ Needs sharing (Viewer access)

**API Patterns (Phase 5):**
- POST with JSON body for queries
- Auth via `getServerSession` + `getSessionPermissions`
- Crons use `CRON_SECRET` header, register in `vercel.json`

**UI Patterns (Phase 6):**
- Tremor for layout, Recharts for charts
- Custom tables with Tailwind
- Dark mode required (`dark:` classes)
- Client-side CSV export

**Mutations (Phase 7):**
- PUT/PATCH API routes exist
- Modal forms with Save button
- Pessimistic updates
- No toast library (inline errors)

**Deployment (Phase 8):**
- Function timeouts configurable in `vercel.json`
- Crons registered same file
- Build includes `prisma generate`
- Strict TypeScript mode

**Anonymization (Phase 9):**
- No existing patterns
- Build `GcAdvisorMapping` table
- API-level transformation for Capital Partners

**Testing (Phase 10):**
- Script-based verification
- `npm run lint` for linting
- `npx tsc --noEmit` for types
- `npm run build` for full verification

**UI/UX Patterns (Addendum B):**
- **UserModal role dropdown:** Hardcoded `<option>` elements — add `<option value="capital_partner">Capital Partner - GC Hub only</option>`
- **Conditional field pattern:** `{role === 'recruiter' && <ExternalAgencyField />}` — use same for `capital_partner` if needed
- **Role color classes:** Missing `revops_admin` (bug) — add both `revops_admin` and `capital_partner` to `ROLE_COLOR_CLASSES`
- **UI/UX Decision Menu:** Ready for Alice review (6 decisions: layout, drill-down, charts, time controls, view separation, mobile)
- **Recommendation summary:** Tabs layout, modal drill-down, quarter selector, same-page role checks, desktop-first

---

This completed investigation provides the codebase knowledge base needed to write the GC Hub implementation guide.
