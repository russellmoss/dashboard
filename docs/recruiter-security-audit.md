# Recruiter Security Audit

**Last Updated:** 2026-01-28
**Status:** Hardened and Verified
**Verification:** All 28 security tests passing (`npm run verify:recruiter-security`)

---

## 1. Executive Summary

We have implemented a **defense-in-depth security model** for the recruiter role. Recruiters are external users who must only see data related to their own agency within the Recruiter Hub.

**Key Security Guarantees:**

1. **Default-Deny Architecture**: All new pages and APIs are blocked for recruiters by default
2. **Multi-Layer Protection**: Middleware + Route-level + Query-level security
3. **Automated Verification**: Security tests validate all 28 critical endpoints
4. **Future-Proof**: New development automatically inherits recruiter restrictions

**Bottom Line:** A recruiter cannot access any dashboard data, API, or page unless we explicitly allow it. Even then, data is filtered to their agency only.

---

## 2. What Recruiters Can and Cannot Access

### Allowed (Explicitly Permitted)

| Resource | Path | Notes |
|----------|------|-------|
| Recruiter Hub | `/dashboard/recruiter-hub` | Main page for recruiters |
| Settings | `/dashboard/settings` | Password change, account info |
| Prospects API | `/api/recruiter-hub/prospects` | Filtered by agency |
| Opportunities API | `/api/recruiter-hub/opportunities` | Filtered by agency |
| External Agencies API | `/api/recruiter-hub/external-agencies` | Returns only their agency |
| Record Detail API | `/api/dashboard/record-detail/[id]` | Filtered by agency, returns 404 for others |
| Data Freshness | `/api/dashboard/data-freshness` | Non-sensitive metadata |
| Auth APIs | `/api/auth/*` | Login, logout, session |
| Change Password | `/api/users/me/change-password` | Self-service password change |

### Blocked (Returns 403 Forbidden)

| Category | Examples | Protection Layer |
|----------|----------|------------------|
| Main Dashboard | `/dashboard`, `/dashboard/pipeline` | Middleware redirect |
| SGA Hub | `/dashboard/sga-hub`, `/api/sga-hub/*` | Middleware + Route |
| Explore (AI) | `/dashboard/explore`, `/api/agent/query` | Middleware + Route |
| Games | `/api/games/pipeline-catcher/*` | Middleware + Route |
| Saved Reports | `/api/saved-reports/*` | Middleware + Route |
| All Dashboard APIs | `/api/dashboard/funnel-metrics`, etc. | Middleware + Route |
| Admin APIs | `/api/admin/*` | Middleware + Route |
| Export | `/api/dashboard/export-sheets` | Middleware + Route |
| **Any Future API** | `/api/new-feature/*` | Middleware (automatic) |

---

## 3. Security Architecture

### 3.1 Three-Layer Defense Model

```
┌─────────────────────────────────────────────────────────────────┐
│                     LAYER 1: MIDDLEWARE                         │
│  src/middleware.ts                                              │
│  - Runs BEFORE any page or API code                             │
│  - Default-deny for recruiters on all /api/* and /dashboard/*   │
│  - Explicit allowlist for recruiter-accessible paths            │
│  - Redirects recruiters away from forbidden dashboard pages     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   LAYER 2: ROUTE HANDLERS                       │
│  Each API route (defense-in-depth)                              │
│  - Uses forbidRecruiter(permissions) helper                     │
│  - Returns 403 even if middleware somehow bypassed              │
│  - Self-documenting security in code                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   LAYER 3: QUERY FILTERING                      │
│  For recruiter-accessible endpoints only                        │
│  - Uses permissions.recruiterFilter (agency)                    │
│  - BigQuery WHERE clause: External_Agency__c = @agency          │
│  - Returns 404 (not 403) for records outside agency             │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Middleware Allowlist (Current)

The middleware at `src/middleware.ts` defines what recruiters CAN access:

```typescript
// Recruiter allowlist (everything else is 403)
const allowlisted =
  pathname.startsWith('/api/auth') ||
  pathname.startsWith('/api/recruiter-hub') ||
  pathname.startsWith('/api/dashboard/record-detail') ||  // Has agency filtering
  pathname === '/api/users/me/change-password' ||
  pathname === '/api/dashboard/data-freshness';
```

**Important:** Any path NOT in this list returns 403 for recruiters automatically.

### 3.3 Route-Level Pattern

All sensitive API routes use this pattern:

```typescript
import { getUserPermissions } from '@/lib/permissions';
import { forbidRecruiter } from '@/lib/api-authz';

export async function POST(request: NextRequest) {
  // 1. Authentication
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Authorization - Block recruiters
  const permissions = await getUserPermissions(session.user.email);
  const forbidden = forbidRecruiter(permissions);
  if (forbidden) return forbidden;

  // 3. Business logic...
}
```

**Files using this pattern:** 19 API routes (verified via grep)

---

## 4. Building New Features: Security Checklist

### 4.1 Adding a New Dashboard Page

When creating a new page under `/dashboard/`:

1. **No action needed for blocking** - Middleware automatically redirects recruiters to `/dashboard/recruiter-hub`
2. **Verify in browser** - Log in as recruiter, try to access the new page URL directly
3. **Expected result** - Immediate redirect to Recruiter Hub

### 4.2 Adding a New API Route

When creating a new API under `/api/`:

```typescript
// REQUIRED: Add this pattern to ALL new API routes
import { getUserPermissions } from '@/lib/permissions';
import { forbidRecruiter } from '@/lib/api-authz';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ADD THIS - blocks recruiters with 403
  const permissions = await getUserPermissions(session.user.email);
  const forbidden = forbidRecruiter(permissions);
  if (forbidden) return forbidden;

  // Your business logic here...
}
```

**Why both middleware AND route-level?**
- Middleware provides the global safety net
- Route-level makes the code self-documenting
- Defense-in-depth catches configuration mistakes

### 4.3 Adding a Recruiter-Accessible Feature

If you intentionally want recruiters to access something:

1. **Add to middleware allowlist** in `src/middleware.ts`:
   ```typescript
   const allowlisted =
     // ... existing paths ...
     pathname.startsWith('/api/your-new-path') ||  // Document why!
   ```

2. **Filter by agency** in the route:
   ```typescript
   const permissions = await getUserPermissions(session.user.email);

   // For recruiter-accessible routes, filter by agency
   if (permissions.role === 'recruiter') {
     if (!permissions.recruiterFilter) {
       return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
     }
     // Use permissions.recruiterFilter in your query
     const data = await getDataForAgency(permissions.recruiterFilter);
     return NextResponse.json({ data });
   }
   ```

3. **Never trust client input** for agency filtering:
   ```typescript
   // WRONG - recruiter can manipulate this
   const agency = request.body.agency;

   // RIGHT - use server-side permissions
   const agency = permissions.recruiterFilter;
   ```

### 4.4 Verification After Changes

Run the security verification script:

```bash
# Start dev server first
npm run dev

# In another terminal, get a recruiter session token and run:
npm run verify:recruiter-security <session-token>
```

Expected output: All 28 tests passing

---

## 5. Current Protection Status

### 5.1 Verified Protected Endpoints (23 endpoints, all return 403)

**Dashboard APIs:**
- `/api/dashboard/funnel-metrics`
- `/api/dashboard/conversion-rates`
- `/api/dashboard/detail-records`
- `/api/dashboard/source-performance`
- `/api/dashboard/filters`
- `/api/dashboard/export-sheets`
- `/api/dashboard/forecast`
- `/api/dashboard/open-pipeline`
- `/api/dashboard/pipeline-drilldown`
- `/api/dashboard/pipeline-sgm-options`
- `/api/dashboard/pipeline-summary`

**SGA Hub APIs:**
- `/api/sga-hub/weekly-goals`
- `/api/sga-hub/weekly-actuals`
- `/api/sga-hub/quarterly-progress`
- `/api/sga-hub/closed-lost`

**Games APIs:**
- `/api/games/pipeline-catcher/leaderboard`
- `/api/games/pipeline-catcher/levels`
- `/api/games/pipeline-catcher/play/[quarter]`

**Explore/Agent APIs:**
- `/api/explore/feedback`
- `/api/agent/query`

**Saved Reports APIs:**
- `/api/saved-reports` (GET, POST)

**Admin APIs:**
- `/api/admin/refresh-cache`

### 5.2 Verified Accessible Endpoints (5 endpoints)

- `/api/recruiter-hub/prospects` → 200 (filtered by agency)
- `/api/recruiter-hub/opportunities` → 200 (filtered by agency)
- `/api/recruiter-hub/external-agencies` → 200 (only their agency)
- `/api/dashboard/data-freshness` → 200 (non-sensitive)
- `/api/dashboard/record-detail/[id]` → 200/404 (filtered by agency)

---

## 6. Key Files Reference

| File | Purpose |
|------|---------|
| `src/middleware.ts` | Global default-deny, recruiter allowlist |
| `src/lib/api-authz.ts` | `forbidRecruiter()` helper function |
| `src/lib/permissions.ts` | `getUserPermissions()`, role definitions |
| `src/lib/auth.ts` | NextAuth config, JWT with role |
| `src/lib/queries/recruiter-hub.ts` | Agency-filtered queries |
| `scripts/verify-recruiter-security.js` | Automated security tests |
| `.cursorrules` | Recruiter Security Rules section |

---

## 7. Permissions Reference

```typescript
// From src/lib/permissions.ts
const ROLE_PERMISSIONS = {
  recruiter: {
    role: 'recruiter',
    allowedPages: [7, 12],  // 7=Settings, 12=Recruiter Hub ONLY
    canExport: true,        // Can export their agency's data
    canManageUsers: false,
  },
  // ... other roles have more allowedPages
};

// recruiterFilter is set from user.externalAgency in the database
```

---

## 8. Risks and Mitigations

### 8.1 Low Risk: Misconfigured Recruiter Hub Query

**Risk:** A new query in `/api/recruiter-hub/*` forgets to filter by agency.

**Mitigation:**
- Follow existing patterns in `src/lib/queries/recruiter-hub.ts`
- Always use `permissions.recruiterFilter` from server
- Never trust client-supplied agency filters
- Add to security test suite

### 8.2 Low Risk: Middleware Allowlist Expansion

**Risk:** Adding new paths to recruiter allowlist without proper filtering.

**Mitigation:**
- Document why each path is allowlisted
- Require agency filtering for any data-returning endpoint
- Code review checklist for security implications

### 8.3 Very Low Risk: New API Without forbidRecruiter

**Risk:** Developer forgets to add `forbidRecruiter()` to new route.

**Mitigation:**
- Middleware blocks it anyway (defense-in-depth)
- `.cursorrules` reminds AI assistants to add the pattern
- Security test catches the regression

---

## 9. Testing Recruiter Security

### 9.1 Automated Testing

```bash
# Run all security tests
npm run verify:recruiter-security <session-token>
```

### 9.2 Manual Testing Checklist

1. **Login as recruiter**
2. **Try forbidden pages:**
   - Navigate to `/dashboard` → Should redirect to `/dashboard/recruiter-hub`
   - Navigate to `/dashboard/explore` → Should redirect
   - Navigate to `/dashboard/sga-hub` → Should redirect
3. **Try forbidden APIs (browser console):**
   ```javascript
   fetch('/api/dashboard/funnel-metrics', {method:'POST'}).then(r=>console.log(r.status))
   // Expected: 403
   ```
4. **Verify data isolation:**
   - Check that prospects/opportunities only show your agency
   - Try to access a record ID from another agency → Should get 404

---

## 10. Future Development Guidelines

### DO:
- Add `forbidRecruiter()` to all new API routes by default
- Use `permissions.recruiterFilter` for any recruiter-accessible data
- Run security tests after adding new endpoints
- Document any additions to the middleware allowlist

### DON'T:
- Trust client-supplied agency/filter parameters for recruiters
- Add paths to the middleware allowlist without agency filtering
- Assume middleware alone is sufficient (add route-level checks too)
- Create public APIs outside `/api/` that return sensitive data

### Code Review Checklist:
- [ ] New API routes have `forbidRecruiter()` check
- [ ] If recruiter-accessible, uses `permissions.recruiterFilter`
- [ ] No client-supplied filters override server-side agency restrictions
- [ ] Middleware allowlist changes are documented with rationale
- [ ] Security tests updated for new endpoints

---

## 11. Audit History

| Date | Action | Verified By |
|------|--------|-------------|
| 2026-01-28 | Initial security audit | Human + Claude |
| 2026-01-28 | Hardening implementation (19 files) | Claude Code Opus 4.5 |
| 2026-01-28 | Automated tests created and passing (28/28) | Claude Code Opus 4.5 |
| 2026-01-28 | Documentation updated | Claude Code Opus 4.5 |

---

## 12. Quick Reference Card

```
┌────────────────────────────────────────────────────────────────┐
│                  RECRUITER SECURITY QUICK REF                   │
├────────────────────────────────────────────────────────────────┤
│                                                                  │
│  NEW API ROUTE? Add this after session check:                   │
│  ─────────────────────────────────────────────                  │
│  const permissions = await getUserPermissions(session.user.email);
│  const forbidden = forbidRecruiter(permissions);                │
│  if (forbidden) return forbidden;                               │
│                                                                  │
│  RECRUITER-ACCESSIBLE ENDPOINT? Filter by agency:              │
│  ─────────────────────────────────────────────────              │
│  const agency = permissions.recruiterFilter;  // NEVER from client
│  const data = await query(agency);                              │
│                                                                  │
│  VERIFY SECURITY:                                               │
│  ─────────────────                                              │
│  npm run verify:recruiter-security <token>                      │
│                                                                  │
│  KEY FILES:                                                     │
│  ──────────                                                     │
│  src/middleware.ts          → Allowlist                         │
│  src/lib/api-authz.ts       → forbidRecruiter()                 │
│  src/lib/permissions.ts     → getUserPermissions()              │
│                                                                  │
└────────────────────────────────────────────────────────────────┘
```
