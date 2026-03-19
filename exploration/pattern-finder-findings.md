# Pattern Finder Findings - Agentic Reporting Feature

**Date:** 2026-03-17
**Scope:** Permissions, Email, Prisma schema, API route auth, Dashboard page components, Route collision check

---

## Task 1: Permissions

### Key Files
- `src/lib/permissions.ts` - ROLE_PERMISSIONS, getPermissionsFromToken, getUserPermissions, canAccessPage, getDataFilters
- `src/types/user.ts` - UserRole type, UserPermissions, SafeUser, UserInput interfaces
- `src/types/auth.ts` - ExtendedSession, hasPermissions, getSessionPermissions
- `src/lib/api-authz.ts` - forbidRecruiter, forbidCapitalPartner helpers

### UserRole Type (src/types/user.ts)

Eight string literal union values. Not a Prisma enum - validated at the application layer.

```typescript
export type UserRole =
  | 'admin'
  | 'manager'
  | 'sgm'
  | 'sga'
  | 'viewer'
  | 'recruiter'
  | 'revops_admin'
  | 'capital_partner';
```

### UserPermissions Interface (src/types/user.ts)

```typescript
export interface UserPermissions {
  role: UserRole;
  allowedPages: number[];
  sgaFilter: string | null;
  sgmFilter: string | null;
  recruiterFilter: string | null;
  capitalPartnerFilter?: string | null;
  canExport: boolean;
  canManageUsers: boolean;
  canManageRequests: boolean; // revops_admin only
  userId?: string | null;
}
```

### Function Signatures (src/lib/permissions.ts)

Preferred - no DB query, reads JWT token data:
```typescript
export function getPermissionsFromToken(tokenData: TokenUserData): UserPermissions
```

Fallback - DB query for freshness after role changes:
```typescript
export async function getUserPermissions(email: string): Promise<UserPermissions>
```

Page access check:
```typescript
export function canAccessPage(permissions: UserPermissions, pageNumber: number): boolean
```

Data filter triple (excludes capitalPartnerFilter):
```typescript
export function getDataFilters(permissions: UserPermissions): {
  sgaFilter: string | null;
  sgmFilter: string | null;
  recruiterFilter: string | null;
}
```

### Session-Layer Helper (src/types/auth.ts)

Used in every API route and page. Reads from JWT - never hits the database.
```typescript
export function getSessionPermissions(
  session: Session | ExtendedSession | null | undefined
): UserPermissions | null
```

### Role-to-Page Mapping (from ROLE_PERMISSIONS in permissions.ts)

| Role            | Pages Allowed                         | canExport | canManageUsers | canManageRequests |
|-----------------|---------------------------------------|-----------|----------------|-------------------|
| revops_admin    | 1,3,7,8,9,10,11,12,13,14,15,16       | true      | true           | true              |
| admin           | 1,3,7,8,9,10,11,12,13,15,16          | true      | true           | false             |
| manager         | 1,3,7,8,9,10,11,12,13,15             | true      | false          | false             |
| sgm             | 1,3,7,10,13,15                        | true      | false          | false             |
| sga             | 1,3,7,8,10,11,13,15                   | true      | false          | false             |
| viewer          | 1,3,7,10,13,15                        | false     | false          | false             |
| recruiter       | 7,12                                  | true      | false          | false             |
| capital_partner | 7,16                                  | true      | false          | false             |

### Defense-in-Depth Helpers (src/lib/api-authz.ts)

Both return a 403 Forbidden response when matched, null otherwise.
```typescript
export function forbidRecruiter(permissions: UserPermissions): NextResponse | null
export function forbidCapitalPartner(permissions: UserPermissions): NextResponse | null
```

### Notes for Agentic Reporting
- Next unused page number is **17** - assign to the Agentic Reports page in ROLE_PERMISSIONS.
- Consider adding `canScheduleReports: boolean` to UserPermissions if scheduling is role-gated.
- Target roles: revops_admin, admin, manager, sgm, sga. Exclude: recruiter, capital_partner, viewer.
- Always use `getSessionPermissions(session)` - never `getUserPermissions(email)`.

---

## Task 2: Email

### Key Files
- `src/lib/email.ts` - sendEmail, sendPasswordResetEmail
- `src/app/api/auth/forgot-password/route.ts` - only existing caller of sendPasswordResetEmail

### sendEmail Signature

```typescript
interface SendEmailParams {
  to: string;
  subject: string;
  text: string;   // plain-text fallback body
  html: string;   // HTML body
}

export async function sendEmail(
  { to, subject, text, html }: SendEmailParams
): Promise<boolean>
```

Behavior:
- Returns `true` on success, `false` on failure. Never throws.
- Reads `SENDGRID_API_KEY` and `EMAIL_FROM` from env at module init.
- If either is absent, returns `false` and logs via `console.error`.
- Sender is always `process.env.EMAIL_FROM` - callers cannot override the `from` field.

### sendPasswordResetEmail Signature

```typescript
export async function sendPasswordResetEmail(
  to: string,
  resetToken: string,
  userName: string
): Promise<boolean>
```

Constructs reset link as NEXT_PUBLIC_APP_URL/reset-password?token=TOKEN. Delegates to sendEmail.

### Call Site Pattern (forgot-password/route.ts)

```typescript
const emailSent = await sendPasswordResetEmail(user.email, token, user.name);
if (!emailSent) {
  console.error("Failed to send reset email to: " + user.email);
}
```

Email failures are logged but the route returns success regardless - avoids leaking account existence.

### Notes for Agentic Reporting
- Call `sendEmail({ to, subject, text, html })` directly for report-ready notifications.
- Build `sendReportReadyEmail(to, reportName, reportUrl)` helper in `src/lib/email.ts`
  following the `sendPasswordResetEmail` pattern: construct text+html, delegate to sendEmail.
- No new env vars needed: `SENDGRID_API_KEY`, `EMAIL_FROM`, `NEXT_PUBLIC_APP_URL` all defined.

---

## Task 3: Prisma Schema

### Key File
- `prisma/schema.prisma`

### User Model Fields

| Field | Type | Notes |
|-------|------|-------|
| id | String @id @default(cuid()) | Primary key |
| email | String @unique | Login identifier |
| name | String | Display name |
| passwordHash | String? | Nullable - OAuth-only users have none |
| role | String @default("viewer") | NOT a Prisma enum; validated at app layer |
| isActive | Boolean @default(true) | Soft-disable flag |
| createdAt | DateTime @default(now()) | Immutable creation timestamp |
| updatedAt | DateTime @updatedAt | Auto-updated on every write |
| createdBy | String? | Email of creating admin, nullable |
| externalAgency | String? | Recruiter/capital_partner affiliation |

### Current User Relations

savedReports, gameScores, passwordResetTokens, submittedRequests,
requestComments, uploadedAttachments, requestEdits, notifications.

A new AgenticReport model must add `agenticReports AgenticReport[]` as a relation on User.

### Foreign Key Pattern

```prisma
// Owning side (child model):
userId  String
user    User   @relation(fields: [userId], references: [id], onDelete: Cascade)
```

Non-owning side omits onDelete. FK field naming convention: {entity}Id.

### Index Pattern
- Every FK column: `@@index([fieldName])`
- Composite unique: `@@unique([field1, field2])`
- Composite sort: `@@index([field1, field2(sort: Desc)])`
- Table rename when model name differs from DB: @@map("snake_case_name")

### Audit Trail Pattern
- `createdAt DateTime @default(now())`
- `updatedAt DateTime @updatedAt`
- `createdBy String?` - stores actor email, nullable
- `updatedBy String?` - present on WeeklyGoal/QuarterlyGoal, absent from most other models (minor drift)

### Nullable Conventions
- Fields genuinely optional at the data level use ?.
- role is a plain String with a default - role validation is in application code, not the DB schema.
- JSON blobs use Json (required) or Json? (optional).
- @db.VarChar(N) used on bounded string fields (name 255, description 500).

### Recommended AgenticReport Model

```prisma
model AgenticReport {
  id           String   @id @default(cuid())
  userId       String
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  name         String   @db.VarChar(255)
  description  String?  @db.VarChar(500)
  config       Json                          // report parameters / schedule config
  status       String   @default("pending") // "pending" | "running" | "done" | "failed"
  resultData   Json?                         // output data blob
  errorMessage String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  createdBy    String?

  @@index([userId])
  @@index([status])
  @@index([createdAt])
}
```

Add inverse relation to User model: `agenticReports AgenticReport[]`

---

## Task 4: API Route Auth Pattern

### Key Files Examined
- `src/app/api/saved-reports/route.ts` - standard read/write with role check
- `src/app/api/users/route.ts` - canManageUsers gate pattern
- `src/app/api/notifications/route.ts` - userId extraction pattern
- `src/app/api/dashboard-requests/route.ts` - complex visibility WHERE clause logic

### Canonical Auth Block

Every route handler follows this exact structure:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }

    // Role gate example:
    if (!permissions.canManageUsers) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // userId extraction:
    const userId = permissions.userId;
    if (!userId) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({ data });
  } catch (error) {
    logger.error('[GET /api/your-route] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch ...' }, { status: 500 });
  }
}
```

### Verified Import Paths

| Symbol | Import Path |
|--------|-------------|
| `getServerSession` | `next-auth` |
| `authOptions` | `@/lib/auth` |
| `getSessionPermissions` | `@/types/auth` |
| `prisma` | `@/lib/prisma` |
| `logger` | `@/lib/logger` |
| `forbidRecruiter`, `forbidCapitalPartner` | `@/lib/api-authz` |

### Error Response Convention

| Status | Condition | Body |
|--------|-----------|------|
| 401 | No session | { error: "Unauthorized" } |
| 401 | Session missing permissions | { error: "Session invalid" } |
| 403 | Authenticated but no permission | { error: "Forbidden" } |
| 404 | Resource not found | { error: "<Entity> not found" } |
| 400 | Bad input | { error: "<specific validation message>" } |
| 500 | Unexpected error | { error: "Failed to <verb> <noun>" } |

### Inconsistency: Logging (flagged)

`saved-reports/route.ts` and `notifications/route.ts` use `logger` from `@/lib/logger`.
`users/route.ts` and `users/[id]/reset-password/route.ts` use raw `console.error`.

The `logger` singleton is preferred: suppresses info/debug in production, adds ISO timestamps.
New routes must use logger.

---

## Task 5: Dashboard Page Components

### Key Files Examined
- `src/app/dashboard/requests/page.tsx` + `RequestsPageContent.tsx`
- `src/app/dashboard/sga-hub/page.tsx` + `SGAHubContent.tsx`
- `src/app/dashboard/explore/page.tsx` + `ExploreClient.tsx`

### Server Page Pattern

Every `page.tsx` under `src/app/dashboard/` is an async server component (no 'use client' directive):

```typescript
// page.tsx - Server Component
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { YourContent } from './YourContent';

export const dynamic = 'force-dynamic';

export default async function YourPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect('/login');
  }

  const permissions = getSessionPermissions(session);
  if (!permissions) {
    redirect('/login');
  }

  // Use allowedPages - see Inconsistency note below
  if (!permissions.allowedPages.includes(/* page number */)) {
    redirect('/dashboard');
  }

  return <YourContent someProp={permissions.someField} />;
}
```

### Client Content Pattern

```typescript
// YourContent.tsx - Client Component
'use client';

interface YourContentProps { someProp: boolean; }

export function YourContent({ someProp }: YourContentProps) {
  // useState, useEffect, fetch calls, event handlers all live here
  return <div>...</div>;
}
```

### Key Conventions
- Server/client split is universal across all dashboard pages without exception.
- Session and permissions resolved server-side. Only serializable primitives passed as props.
- `export const dynamic = 'force-dynamic'` present on every page.
- Redirect targets: recruiters to /dashboard/recruiter-hub, SGAs to /dashboard/sga-hub, others to /dashboard.

### Inconsistency: Role Check Style (flagged)

`sga-hub/page.tsx` uses an inline role-string allowlist:
```typescript
if (!['admin', 'manager', 'sga', 'sgm', 'revops_admin'].includes(permissions.role)) {
  redirect('/dashboard');
}
```

`requests/page.tsx` and `explore/page.tsx` use the preferred page-number approach:
```typescript
if (!permissions.allowedPages.includes(13)) {
  redirect('/dashboard');
}
```

The `allowedPages` approach is preferred: derives from `ROLE_PERMISSIONS` in `src/lib/permissions.ts`
and stays correct automatically when role-to-page assignments change. New pages must use allowedPages.includes(N).

---

## Task 6: Route Collision Check

### Results: No Conflicts

| Path Checked | Files Found |
|---|---|
| src/app/api/reports/** | None - CLEAR |
| src/app/dashboard/reports/** | None - CLEAR |

The route segments /api/agentic-reports and /dashboard/agentic-reports are fully available.

### Closest Existing Routes (awareness only, no conflict)
- `src/app/api/saved-reports/` - manages saved filter snapshots, not generated report output
- `src/app/dashboard/requests/` - Dashboard Requests (page 13), unrelated domain

---

## Implementation Checklist for Agentic Reporting

### Prisma Model
1. Define `AgenticReport` model per the pattern in Task 3.
2. Add `agenticReports AgenticReport[]` inverse relation to the `User` model.
3. Run `npx prisma migrate dev --name add_agentic_reports`.
4. Run `npx prisma generate`.

### API Routes
Suggested layout under `src/app/api/agentic-reports/`:
- `route.ts` - GET (list), POST (create)
- `[id]/route.ts` - GET (single), PATCH (update), DELETE
- `[id]/run/route.ts` - POST (trigger execution)

Every handler must:
1. Include `export const dynamic = 'force-dynamic'`.
2. Use the canonical auth block documented in Task 4.
3. Use `logger` from `@/lib/logger` - not raw `console.error`.
4. Use `forbidRecruiter`/`forbidCapitalPartner` from `@/lib/api-authz` for role exclusions.
5. Follow the 401/403/404/400/500 error body convention.

### Dashboard Page
1. Assign page number **17** to target roles in ROLE_PERMISSIONS in src/lib/permissions.ts.
2. `src/app/dashboard/agentic-reports/page.tsx` - server component with `allowedPages.includes(17)`.
3. `src/app/dashboard/agentic-reports/AgenticReportsContent.tsx` - 'use client' component.
4. Pass only serializable permission-derived values as props to the content component.

### Email Notifications
1. Add `sendReportReadyEmail(to: string, reportName: string, reportUrl: string): Promise<boolean>`
   to `src/lib/email.ts`, following the `sendPasswordResetEmail` pattern.
2. Call from the run-completion code path in the API route.
3. No new env vars needed.

### Documentation Sync
1. Run `npm run gen:all` to regenerate API route and Prisma model inventories.
2. Run `npx agent-guard sync` before committing.