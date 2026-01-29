# Recruiter Security Audit: Questions & Answers

**Purpose:** This document is a structured investigation guide for Cursor.ai to audit the recruiter role security implementation and identify gaps, edge cases, or risks—especially as the codebase evolves with agentic development.

**Instructions for Cursor.ai:**
1. Work through each phase sequentially
2. Use file searches, code inspection, and MCP BigQuery queries to answer questions
3. Write your answers directly in the `**Answer:**` sections
4. If you find issues, document them in the **Findings & Recommendations** section at the bottom
5. Mark each question as ✅ (verified/no issues), ⚠️ (potential concern), or ❌ (confirmed vulnerability)

---

## Phase 1: Middleware & Global Access Control Verification

> **Goal:** Verify that the default-deny middleware implementation is comprehensive and cannot be bypassed.

### Q1.1: Middleware Matcher Coverage ✅

**Question:** Inspect `src/middleware.ts`. Does the `config.matcher` array cover ALL routes that could return sensitive data? Are there any routes outside `/dashboard/*` and `/api/*` that could leak data?

**Files to check:**
- `src/middleware.ts`
- All files in `src/app/` (look for any routes outside the matched paths)

**Answer:**
```
The config.matcher in src/middleware.ts is:
  matcher: ['/dashboard/:path*', '/api/:path*']

Sensitive data is served only from:
- /dashboard/* — pipeline, explore, sga-hub, sga-activity, sga-management, settings, recruiter-hub (all under /dashboard)
- /api/* — dashboard, sga-hub, sga-activity, agent, admin, saved-reports, users, recruiter-hub (all under /api)

Other app routes (/, /login, /reset-password, /sentry-example-page) are not in the matcher, so middleware does not run on them. Those routes are intentionally public (login, reset-password) or non-sensitive (root page, Sentry example). None of them return pipeline, funnel, or recruiter-hub data.

Conclusion: The matcher covers all routes that could return sensitive data. No routes outside /dashboard/* and /api/* leak pipeline or recruiter data.
```

---

### Q1.2: Public Route Exceptions ✅ (one ⚠️ for dot-bypass)

**Question:** The middleware skips auth checks for certain paths (listed in the `if` block at the start). For each exception, confirm it cannot return sensitive data:
- `/_next` — Safe? Why?
- `/api/auth/*` — What endpoints exist here? Could any leak user data?
- `/api/cron/*` — Protected by `CRON_SECRET`? Verify the implementation.
- `/login`, `/static/*`, `/monitoring/*` — Safe? Why?
- Paths containing a dot (`.`) — Could an attacker craft a URL like `/api/dashboard/secrets.json` to bypass?

**Files to check:**
- `src/middleware.ts`
- `src/app/api/auth/` (all route files)
- `src/app/api/cron/` (all route files)

**Answer:**
```
/_next: Safe. Next.js build artifacts (JS, CSS, chunks). No application data; static assets only.

/api/auth/*: Endpoints: [...nextauth] (sign-in, sign-out, session, providers), forgot-password, reset-password, permissions. 
  - NextAuth and forgot/reset are public by design. 
  - GET /api/auth/permissions returns the current user's permissions only after session check; the route uses getServerSession() and returns 401 if no session. So unauthenticated callers get 401, not data. Safe.

/api/cron/*: refresh-cache and trigger-transfer both validate Authorization: Bearer ${CRON_SECRET}. If CRON_SECRET is missing or header doesn't match, they return 401. Implementation verified in both route files. Safe.

/login, /static/*, /monitoring/*: Login and static are UI only. Monitoring is the Sentry tunnel route; no pipeline data. Safe.

Dot-bypass risk: pathname.includes('.') causes any path containing a dot to skip auth and return NextResponse.next(). So /api/dashboard/funnel-metrics.json would skip auth. Next.js routing is file-based: no route exists for /api/dashboard/funnel-metrics.json (only /api/dashboard/funnel-metrics/route.ts), so the request would 404. Risk is low today. If a future route served files by name (e.g. [file].json), it could be reachable without auth. Recommendation: consider restricting the dot exception to known static path prefixes (e.g. /_next/, /static/) instead of any path containing ".".
```

---

### Q1.3: Recruiter API Allowlist Completeness ⚠️ (external-agencies finding)

**Question:** The middleware has a recruiter allowlist:
```typescript
const allowlisted =
  pathname.startsWith('/api/auth') ||
  pathname.startsWith('/api/recruiter-hub') ||
  pathname === '/api/users/me/change-password' ||
  pathname === '/api/dashboard/data-freshness';
```

For each allowlisted path, verify:
1. Does the route exist?
2. Does it return ONLY non-sensitive or properly-filtered data?
3. For `/api/recruiter-hub/*`, does every endpoint apply `recruiterFilter`?

**Files to check:**
- `src/app/api/recruiter-hub/` (all route files)
- `src/app/api/users/me/change-password/route.ts`
- `src/app/api/dashboard/data-freshness/route.ts`

**Answer:**
```
/api/auth/*: Safe. NextAuth and auth helpers; permissions endpoint requires session and returns only that user's permissions.

/api/recruiter-hub/*:
  - prospects (POST): Exists. Uses permissions.recruiterFilter; passes it to getRecruiterProspects(); for recruiters externalAgencies from body is ignored (undefined). Applies recruiterFilter. ✅
  - opportunities (POST, GET): Exists. Same pattern; recruiterFilter passed to getRecruiterOpportunities and getRecruiterHubSGMs; externalAgencies from body ignored when recruiterFilter is set. Applies recruiterFilter. ✅
  - external-agencies (GET): Exists. Does NOT pass recruiterFilter. Calls getDistinctExternalAgencies() with no args; that function returns ALL distinct agency names from BigQuery. So recruiters can see the list of all external agency names (not records, just names). ⚠️ Low sensitivity but worth noting; consider filtering to single agency for recruiters if desired.

/api/users/me/change-password: Safe. Requires session; updates only the current user's password in DB by session.user.email. No pipeline or user-list data returned.

/api/dashboard/data-freshness: Safe. Returns high-level data freshness timestamps (when data was last updated). No record-level or agency-level data. Session required.
```

---

### Q1.4: Dashboard Redirect Bypass Attempts ✅ (case note)

**Question:** The middleware redirects recruiters from forbidden dashboard pages to `/dashboard/recruiter-hub`. Test these potential bypasses:
1. Does `/dashboard` (root) get redirected?
2. Does `/dashboard/` (with trailing slash) get redirected?
3. Does `/dashboard/recruiter-hub/../pipeline` get normalized before middleware runs?
4. Does `/DASHBOARD/pipeline` (case difference) get caught?
5. Does `/dashboard/recruiter-hub/../../pipeline` work?

**Files to check:**
- `src/middleware.ts`
- Next.js URL normalization behavior

**Answer:**
```
/dashboard: Yes. pathname "/dashboard" does not start with /dashboard/recruiter-hub or /dashboard/settings, so recruiter is redirected to /dashboard/recruiter-hub.

/dashboard/: Typically normalized by Next.js/host to /dashboard; same logic applies, redirect.

Path traversal (../): Next.js and the request URL are typically normalized so /dashboard/recruiter-hub/../pipeline becomes /dashboard/pipeline before or when middleware runs. pathname would be /dashboard/pipeline, which is not allowed; recruiter is redirected.

Case sensitivity: Matcher is literal: '/dashboard/:path*'. So /DASHBOARD/pipeline does NOT match the matcher; middleware does not run for that path. The request would be handled by Next.js; app route is under dashboard/ (lowercase), so /DASHBOARD/pipeline may 404 depending on host/server normalization. If the host normalizes to lowercase, the request becomes /dashboard/pipeline and is then protected. Recommendation: verify production host (e.g. Vercel) normalizes path case; if not, consider adding a matcher or check for case-insensitive /dashboard.

Double traversal: /dashboard/recruiter-hub/../../pipeline normalizes to /dashboard/pipeline; same as above, not allowed, redirect.
```

---

## Phase 2: Route-Level Authorization (Defense in Depth)

> **Goal:** Verify that individual API routes enforce authorization even if middleware were bypassed.

### Q2.1: Sensitive Routes Without Role Checks ✅

**Question:** Search for all API routes under `/api/dashboard/*`, `/api/sga-hub/*`, `/api/sga-activity/*`, `/api/agent/*`, `/api/admin/*`, and `/api/saved-reports/*`. For each route, verify it:
1. Calls `getServerSession(authOptions)`
2. Calls `getUserPermissions(session.user.email)`
3. Either uses `forbidRecruiter(permissions)` OR explicitly checks role

List any routes that DON'T have these checks.

**Files to check:**
- All files in `src/app/api/dashboard/`
- All files in `src/app/api/sga-hub/`
- All files in `src/app/api/sga-activity/`
- All files in `src/app/api/agent/`
- All files in `src/app/api/admin/`
- All files in `src/app/api/saved-reports/`

**Answer:**
```
All sensitive routes use getServerSession(authOptions) and getUserPermissions(session.user.email). None use forbidRecruiter(); all use explicit `if (permissions.role === 'recruiter') return 403` (or equivalent role checks).

/api/dashboard/*: funnel-metrics, conversion-rates, filters, forecast, open-pipeline, pipeline-drilldown, pipeline-summary, pipeline-sgm-options, detail-records, record-detail/[id], source-performance, export-sheets — all have session + permissions + recruiter 403. data-freshness has session + permissions (recruiters allowed by middleware; route does not need to block).

/api/sga-hub/*: All routes (weekly-goals, weekly-actuals, quarterly-goals, quarterly-progress, closed-lost, leaderboard, drill-down/*, etc.) use session + getUserPermissions. They restrict by role to admin/manager/sga (e.g. if (!['admin','manager','sga'].includes(permissions.role)) return 403). Recruiters are thus blocked at route level as well as by middleware.

/api/sga-activity/*: dashboard, filters, activity-records, scheduled-calls — session + permissions + role check for admin/manager/sga; recruiters get 403.

/api/agent/query: session + permissions + explicit `if (permissions.role === 'recruiter') return 403`.

/api/admin/*: refresh-cache, trigger-transfer, sga-overview — session + permissions; refresh-cache and trigger-transfer require role === 'admin'; sga-overview uses canManageUsers or equivalent. Recruiters blocked.

/api/saved-reports/*: All routes use session + getUserPermissions. Recruiters are blocked by middleware (saved-reports not allowlisted); route-level checks also enforce canManageUsers / ownership where needed.

Routes MISSING authorization: None. Defense-in-depth: middleware blocks recruiters from these paths; routes that run also enforce session and role.
```

---

### Q2.2: `forbidRecruiter` Helper Adoption ⚠️

**Question:** The helper `forbidRecruiter(permissions)` in `src/lib/api-authz.ts` provides a consistent pattern. Search for all API routes that check `permissions.role === 'recruiter'` manually instead of using this helper. Are any of them inconsistent in their handling?

**Search for:**
- `role === 'recruiter'`
- `role !== 'recruiter'`
- `permissions.role`

**Answer:**
```
Routes using forbidRecruiter(): None. No API route imports or uses forbidRecruiter from api-authz.ts.

Routes with manual role checks: All recruiter-blocking routes use manual checks, e.g.:
  if (permissions.role === 'recruiter') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
Found in: dashboard (funnel-metrics, conversion-rates, filters, forecast, open-pipeline, pipeline-drilldown, detail-records, pipeline-summary, pipeline-sgm-options, source-performance, export-sheets), agent/query, record-detail/[id] (different pattern: fetches with recruiterFilter and returns 404 if no record).

Inconsistencies found: Behavior is consistent (all return 403 for recruiters on forbidden routes). The only inconsistency is pattern: helper exists but is unused; consider adopting forbidRecruiter(permissions) in new and refactored routes for consistency and single place to update.
```

---

### Q2.3: New API Route Risk Assessment ✅

**Question:** What happens if a developer creates a new API route tomorrow at `/api/dashboard/new-feature/route.ts` and forgets to add authorization? Trace the flow:
1. Does middleware block recruiters?
2. If the route has no `getServerSession` check, what happens?
3. What safeguards exist to prevent this?

**Answer:**
```
Middleware protection: Yes. The matcher is /api/:path*, so /api/dashboard/new-feature is matched. Recruiters are allowlisted only for /api/auth*, /api/recruiter-hub*, /api/users/me/change-password, /api/dashboard/data-freshness. /api/dashboard/new-feature is not on the list, so middleware returns 403 Forbidden for recruiters before the route handler runs. Recruiters cannot reach the new route.

Route-level fallback: If middleware were bypassed (e.g. bug or different path), a route with no getServerSession would still receive the request. Unauthenticated users get 401 from middleware when hitting /api without a token; for a logged-in recruiter with a valid JWT, the request would reach the handler. So a new route with no session/role check could leak data to recruiters only in a scenario where middleware was bypassed. Default-deny in middleware is the primary safeguard.

Safeguards: (1) Middleware default-deny for recruiters on /api/* except allowlist. (2) .cursorrules documents API route pattern (getServerSession, getUserPermissions, apply permission filters) but does not explicitly mention recruiters or forbidRecruiter. (3) No ESLint or CI rule was found that enforces authorization on new API routes. Recommendation: add a cursor rule or checklist reminding that new /api/dashboard/* and other sensitive routes must call getUserPermissions and block recruiters (or use forbidRecruiter).
```

---

## Phase 3: Data-Level Isolation (Row-Level Security)

> **Goal:** Verify that even if a recruiter reaches a valid endpoint, they ONLY see their agency's data.

### Q3.1: Recruiter Hub Query Filtering ✅ (external-agencies ⚠️)

**Question:** Inspect all queries in `src/lib/queries/recruiter-hub.ts`. For each function:
1. Does it accept `recruiterFilter` as a parameter?
2. Does it ALWAYS apply `WHERE External_Agency__c = @recruiterFilter` when `recruiterFilter` is non-null?
3. Could a recruiter manipulate request body params to see other agencies' data?

**Files to check:**
- `src/lib/queries/recruiter-hub.ts`
- `src/app/api/recruiter-hub/prospects/route.ts`
- `src/app/api/recruiter-hub/opportunities/route.ts`
- `src/app/api/recruiter-hub/external-agencies/route.ts`

**Answer:**
```
getDistinctExternalAgencies(): Does NOT accept recruiterFilter. Returns all distinct External_Agency__c from the table. Used by external-agencies route; recruiters get full list of agency names. Should it filter? Optional improvement: for recruiters, return only their agency (or single-item list) so they don't see other agency names.

getRecruiterProspects(recruiterFilter, filters): Accepts recruiterFilter. When recruiterFilter is non-null, adds condition External_Agency__c = @recruiterFilter. Filter applied correctly. Admin path: when recruiterFilter is null, optional externalAgencies from filters is used.

getRecruiterOpportunities(recruiterFilter, filters): Same pattern; recruiterFilter applied when non-null. Filter applied correctly.

getRecruiterHubSGMs(recruiterFilter): Accepts recruiterFilter; applies External_Agency__c = @recruiterFilter when non-null. Correct.

Request body manipulation risk:
- Prospects and opportunities routes pass permissions.recruiterFilter to the query. When recruiterFilter is set (recruiter), they pass externalAgencies: permissions.recruiterFilter ? undefined : externalAgencies — so recruiters never pass externalAgencies from the body; only server-side recruiterFilter is used. A recruiter cannot pass externalAgencies: ['CompetitorAgency'] to see other agencies; the API overwrites with undefined for recruiters.
- Prevented by: server derives recruiterFilter from getUserPermissions(session.user.email), which reads User.externalAgency from DB; request body externalAgencies is ignored when permissions.recruiterFilter is set.
```

---

### Q3.2: Record Detail Endpoint Security ✅

**Question:** When a recruiter clicks a row to view record details, they call `/api/dashboard/record-detail/[id]` (or similar). 
1. Does this endpoint exist?
2. Does it verify the requested record belongs to the recruiter's agency?
3. Could a recruiter guess/enumerate `primary_key` values to access other agencies' records?

**Files to check:**
- `src/app/api/dashboard/record-detail/[id]/route.ts` (or similar)
- `src/lib/queries/record-detail.ts`

**Answer:**
```
Record detail endpoint exists: Yes. GET /api/dashboard/record-detail/[id] in src/app/api/dashboard/record-detail/[id]/route.ts.

Agency verification: For recruiters (permissions.role === 'recruiter'), the route requires allowedPages.includes(12) and permissions.recruiterFilter, then calls getRecordDetail(id, permissions.recruiterFilter). The query in record-detail.ts adds AND v.External_Agency__c = @recruiterFilter when recruiterFilter is provided. So the record is returned only if it belongs to the recruiter's agency; otherwise the query returns no row and the route returns 404.

Enumeration risk: A recruiter could try arbitrary primary_key values. For each id: if the record is in their agency, they get the record; if not (or invalid id), they get 404. The response does not distinguish "record exists but wrong agency" from "record not found" — both are 404, so existence of other agencies' records is not leaked. Guessing/enumerating primary_key is possible in principle (IDs are predictable in some systems), but the server never returns data for records outside recruiterFilter; only 404. Mitigation: agency filter in query; uniform 404 for no record or wrong agency.
```

---

### Q3.3: Export Feature Security ✅

**Question:** Recruiters have `canExport: true` in their permissions. 
1. What export endpoints exist?
2. Do they respect `recruiterFilter` when generating exports?
3. Could a recruiter export data from other agencies?

**Files to check:**
- `src/app/api/dashboard/export-sheets/route.ts` (or similar export endpoints)
- Any other export-related files

**Answer:**
```
Export endpoints found: POST /api/dashboard/export-sheets (Google Sheets export of funnel metrics, conversion rates, trends, detail records). No other server-side export endpoints for dashboard data.

Each endpoint's filtering: export-sheets route calls getUserPermissions and explicitly returns 403 if permissions.role === 'recruiter'. Recruiters cannot call this endpoint at all (middleware also blocks /api/dashboard/* for recruiters except data-freshness). So recruiters do not have access to the main dashboard export. Recruiter Hub has client-side CSV export only (from data already fetched and filtered by recruiterFilter in prospects/opportunities). So recruiters cannot export data from other agencies; they can only export the same agency-filtered data they see in the UI.
```

---

## Phase 4: Agent/Explore System Security

> **Goal:** Verify the AI agent system (Explore feature) is completely inaccessible to recruiters.

### Q4.1: Agent Query Endpoint Protection ✅

**Question:** The `/api/agent/query` endpoint allows natural language queries that generate SQL. Verify:
1. Middleware blocks recruiters from this endpoint
2. Route-level code also blocks recruiters
3. Even if bypassed, would the generated SQL include agency filtering?

**Files to check:**
- `src/app/api/agent/query/route.ts`
- `src/lib/semantic-layer/query-compiler.ts`

**Answer:**
```
Middleware blocks /api/agent/query for recruiters: Yes. /api/agent/query is not on the recruiter allowlist (only /api/auth*, /api/recruiter-hub*, /api/users/me/change-password, /api/dashboard/data-freshness). Middleware returns 403 for recruiters on any other /api path.

Route-level check exists: Yes. In agent/query/route.ts, after getServerSession and getUserPermissions, there is an explicit check: if (permissions.role === 'recruiter') return NextResponse.json({ error: 'Forbidden' }, { status: 403 }).

SQL generation includes agency filter: Not Applicable for recruiters — they never reach the handler. The semantic layer / query-compiler does not add recruiterFilter to generated SQL; Explore is intended for non-recruiter roles. If middleware were bypassed, the generated SQL would not automatically include External_Agency__c filtering; the route-level 403 prevents that scenario.
```

---

### Q4.2: Explore Page Protection ✅

**Question:** The Explore page at `/dashboard/explore` provides the AI interface. Verify:
1. Middleware redirects recruiters away from this page
2. Page-level code also checks permissions
3. No data is fetched/rendered before redirect

**Files to check:**
- `src/app/dashboard/explore/page.tsx`
- Any related components

**Answer:**
```
Middleware redirect: Yes. pathname /dashboard/explore does not start with /dashboard/recruiter-hub or /dashboard/settings, so middleware redirects recruiters to /dashboard/recruiter-hub before the page runs.

Page-level permission check: Yes. explore/page.tsx is a server component. It calls getServerSession and getUserPermissions, then if (permissions.role === 'recruiter') redirect('/dashboard/recruiter-hub'). Only after that does it check allowedPages and render <ExploreClient />. Defense in depth.

Pre-redirect data exposure: Low risk. Middleware runs first and redirects recruiters; they never reach the page component. If middleware were skipped (e.g. bug), the page runs on the server and redirect() is called before any ExploreClient render or client-side fetch; no Explore data is fetched in the page itself before the redirect (ExploreClient would mount only after the redirect check passes, and for recruiters it never does). So no Explore data is rendered or fetched before redirect.
```

---

### Q4.3: Future AI Feature Risk ⚠️

**Question:** If we add new AI/agent features in the future (e.g., Claude-powered assistants, MCP integrations):
1. What patterns should be followed to ensure recruiter isolation?
2. Are there cursor rules or documentation that would remind developers?
3. What could go wrong?

**Files to check:**
- `.cursorrules` (or similar)
- Any documentation about security patterns

**Answer:**
```
Documented patterns: docs/recruiter-security-audit.md describes default-deny for recruiters, middleware allowlist, and record-level filtering. New AI endpoints under /api/* are blocked for recruiters by default unless added to the middleware allowlist. Pattern: (1) Do not add new AI routes to the recruiter allowlist unless intended for recruiters. (2) If an AI route is added under a path that is not matched by middleware (e.g. a new top-level path), ensure the matcher is updated or the route explicitly checks role and returns 403 for recruiters.

Cursor rules mentioning recruiters: .cursorrules does not mention recruiters, forbidRecruiter, recruiterFilter, or default-deny. It documents API route pattern (getServerSession, getUserPermissions, apply permission filters) and SGA/Explore patterns but not recruiter-specific rules.

Risk scenarios: (1) New AI route added under /api/agent/ or new prefix — middleware blocks recruiters by default; low risk if matcher stays /api/:path*. (2) New route under a path that bypasses matcher (e.g. /api/ai/...) — matcher would still match /api/:path*; safe. (3) New page at /dashboard/ai-assistant — middleware would redirect recruiters; safe. (4) Cursor or a developer adds an AI route to the allowlist by mistake — recruiters could call it; ensure allowlist changes are reviewed. Recommendation: add a short recruiter-security bullet to .cursorrules (e.g. "New /api/* routes are default-deny for recruiters; do not add to allowlist unless the route is intended for Recruiter Hub and filters by recruiterFilter.").
```

---

## Phase 5: Authentication & Session Security

> **Goal:** Verify the JWT/session cannot be manipulated to escalate recruiter privileges.

### Q5.1: JWT Token Role Integrity ✅

**Question:** The middleware reads `token.role` from the JWT. Verify:
1. Role is set correctly during login in `src/lib/auth.ts`
2. Role cannot be modified by the client
3. Role is re-validated if missing (backfill logic)

**Files to check:**
- `src/lib/auth.ts`
- JWT callback logic

**Answer:**
```
Role set during login: In auth.ts, CredentialsProvider authorize() returns user with id, email, name, role from validateUser() (DB). In jwt callback, when user is present (first sign-in), token gets role from dbUser via getUserByEmail(user.email) or from user.role. So role is set from the database at login, not from client input.

Client cannot modify role: True. JWTs are signed with NEXTAUTH_SECRET. The client receives the JWT but cannot alter payload (including role) without invalidating the signature; getToken() in middleware verifies the signature. So role is server-authoritative.

Backfill logic: In jwt callback, if token.email exists and token.role is missing, the code fetches dbUser via getUserByEmail(email) and sets token.role = dbUser.role. This handles older JWTs created before role was added. Security: backfill uses DB as source of truth; it runs only when role is missing and uses the same email already in the token (from prior login). No client-supplied role is used.
```

---

### Q5.2: Role Change Handling ⚠️

**Question:** If an admin changes a user's role from `recruiter` to `admin`:
1. Does the JWT get invalidated?
2. Could a recruiter keep using an old JWT with `role: recruiter` while actually being an admin now (or vice versa)?
3. What's the maximum time a stale role could persist?

**Files to check:**
- `src/lib/auth.ts` (JWT refresh logic)
- User update API routes

**Answer:**
```
JWT invalidation on role change: No. Updating the user in the database (e.g. PUT /api/users/[id]) does not sign the user out or invalidate their JWT. The JWT is not tied to a version or role hash; it only gets role at login or when backfill runs (when role is missing).

Stale role risk: Yes. If an admin changes a user from recruiter to admin, that user's existing JWT still has role: 'recruiter' until the next time the JWT is issued (next login) or until backfill runs. Backfill runs only when token.role is missing (e.g. legacy tokens), not when DB role has changed. So the user could continue with role recruiter in the JWT and be blocked from admin routes until they log in again. Conversely, if an admin demotes a user from admin to recruiter, the old JWT with role: 'admin' would still allow access to admin routes until session expiry or re-login.

Maximum stale duration: session.maxAge is 24 * 60 * 60 (24 hours). So a stale role could persist up to 24 hours, or until the user signs out and signs in again (which issues a new JWT with current DB role). Recommendation: document this for admins (role changes take effect on next login or within 24h); optionally add a "force re-login" or token invalidation when role/externalAgency is updated.
```

---

### Q5.3: externalAgency Field Security ✅

**Question:** The `User.externalAgency` field determines what agency a recruiter sees. Verify:
1. Only admins can set this field
2. A recruiter cannot modify their own `externalAgency`
3. Field is validated (non-empty, matches actual agency in BigQuery)

**Files to check:**
- `src/app/api/users/route.ts`
- `src/app/api/users/[id]/route.ts`
- User creation/update logic

**Answer:**
```
Admin-only modification: Yes. GET/POST /api/users and GET/PUT/DELETE /api/users/[id] all require getServerSession and then permissions.canManageUsers. Only admin (and manager for some actions) have canManageUsers; recruiters do not. So only admins (or managers with user management) can create or update users, including setting externalAgency. Recruiters cannot call these routes for other users. They also cannot call PUT /api/users/[id] for their own id to change externalAgency — same canManageUsers check; recruiters get 403.

Self-modification prevention: Yes. There is no dedicated "update my profile" endpoint that allows changing role or externalAgency. The only self-service user endpoint allowlisted for recruiters is /api/users/me/change-password, which only updates passwordHash. So a recruiter cannot modify their own externalAgency via any allowlisted API.

Validation: When role === 'recruiter', POST and PUT validate that externalAgency is present and non-empty (trim); otherwise 400 "External Agency is required for Recruiter role". When role changes from recruiter to something else, PUT clears externalAgency (body.externalAgency = null). There is no validation against a list of known agencies in BigQuery (e.g. no check that externalAgency exists in vw_funnel_master). So a typo or invalid agency name would still be stored; the recruiter would then see no records (query filter would match zero rows). Optional improvement: validate externalAgency against getDistinctExternalAgencies() or a allowlist when creating/updating a recruiter.
```

---

## Phase 6: Agentic Development Safeguards

> **Goal:** Ensure security is maintained as Cursor.ai and other agents make code changes.

### Q6.1: Cursor Rules Analysis ⚠️

**Question:** Review `.cursorrules` (or equivalent configuration). 
1. Are there rules reminding about recruiter security?
2. Do the rules mention `forbidRecruiter`, `recruiterFilter`, or default-deny?
3. Are the rules comprehensive enough?

**Files to check:**
- `.cursorrules`
- Any other cursor/agent configuration files

**Answer:**
```
Recruiter-specific rules: None. .cursorrules does not mention recruiters, Recruiter Hub, or recruiter isolation.

Coverage assessment: Gaps: (1) No reminder that new /api/* routes are default-deny for recruiters. (2) No mention of forbidRecruiter or recruiterFilter when adding API routes or queries. (3) No mention of the recruiter allowlist in middleware when adding new API routes.

Recommended additions: Add a short "Recruiter security" bullet: e.g. "Recruiter role: Middleware blocks recruiters from all /api/* except allowlist (/api/auth*, /api/recruiter-hub*, /api/users/me/change-password, /api/dashboard/data-freshness). Do not add new routes to the allowlist unless intended for Recruiter Hub. For Recruiter Hub data, always use permissions.recruiterFilter from getUserPermissions and pass it to queries; ignore client-supplied agency filters for recruiters. Use forbidRecruiter(permissions) or explicit role check for routes that must block recruiters."
```

---

### Q6.2: Code Pattern Enforcement ⚠️

**Question:** What automated checks exist to catch authorization mistakes?
1. ESLint rules for API routes?
2. TypeScript enforcement?
3. Tests that verify recruiter access is denied?

**Files to check:**
- `.eslintrc.js` or `eslint.config.js`
- `tsconfig.json`
- Test files (if any)

**Answer:**
```
Linting rules: No ESLint rules were found that enforce getServerSession, getUserPermissions, or forbidRecruiter in API routes. Standard Next/TypeScript lint only.

TypeScript safety: Permissions and role are typed (UserPermissions, role string). No type-level enforcement that sensitive routes must check role; that is by convention.

Authorization tests: No tests were found that assert recruiters get 403 from sensitive endpoints or that recruiters only see their agency's data. Tests would require authenticated recruiter and admin sessions and would be valuable to add (e.g. Playwright or API tests).
```

---

### Q6.3: Documentation Completeness ✅

**Question:** Is the security model documented well enough that a new developer (human or AI) would understand it?
1. Where is the recruiter security documented?
2. Are patterns and examples provided?
3. What's missing?

**Files to check:**
- `docs/recruiter-security-audit.md`
- `docs/ARCHITECTURE.md`
- `README.md`

**Answer:**
```
Documentation locations: docs/recruiter-security-audit.md contains high-level summary, behavioral view (what recruiters can/cannot access), and technical architecture (roles, middleware, JWT, API gating, record-level filtering, allowlist). It explains default-deny and defense in depth. .cursorrules documents general API route pattern (getServerSession, getUserPermissions) but not recruiter-specific rules.

Pattern examples provided: Yes. recruiter-security-audit.md describes middleware allowlist, route-level 403, recruiterFilter in queries, and record-detail agency check. Code examples are in the codebase (middleware.ts, record-detail route, recruiter-hub routes).

Missing documentation: (1) .cursorrules does not mention recruiters. (2) No step-by-step "adding a new API route" checklist that includes "block recruiters unless allowlisted." (3) Role-change staleness (JWT not invalidated on role change) could be documented in recruiter-security-audit.md for admins.
```

---

## Phase 7: Edge Cases & Attack Vectors

> **Goal:** Think like an attacker and identify edge cases.

### Q7.1: API Parameter Injection ✅

**Question:** For recruiter-hub endpoints, can a malicious recruiter inject parameters to bypass filtering?
1. Can they add `filters.sga` to see specific SGA data?
2. Can they add SQL injection via filter parameters?
3. Can they send malformed JSON that causes errors exposing data?

**Test patterns:**
```javascript
// Attempt 1: Try to filter by a different agency
POST /api/recruiter-hub/prospects
{ "externalAgencies": ["CompetitorAgency"], "stages": ["MQL"] }

// Attempt 2: SQL injection
POST /api/recruiter-hub/prospects  
{ "stages": ["MQL'; SELECT * FROM users--"] }
```

**Answer:**
```
Parameter override risk: No. Prospects and opportunities routes pass permissions.recruiterFilter to the query and set externalAgencies: permissions.recruiterFilter ? undefined : externalAgencies. So when the user is a recruiter, externalAgencies from the body is never passed to the query; only the server-derived recruiterFilter (from User.externalAgency) is used. SGA/SGM filters are not used in recruiter-hub queries for agency scoping; External_Agency__c is the only agency filter and it comes from recruiterFilter. So recruiters cannot override agency via request body.

SQL injection risk: Low. Queries use BigQuery parameterized syntax (@recruiterFilter, @stages, etc.). Stages and other filters are passed as bound parameters, not concatenated into SQL. getRecruiterProspects builds conditions with params object; runQuery uses parameterized execution. So stages like ["MQL'; SELECT * FROM users--"] would be passed as a single string value in a parameter, not executed as SQL.

Error message exposure: Request body is parsed with request.json().catch(() => ({})); malformed JSON yields empty body, not necessarily a stack trace. Errors are caught and returned as generic messages (e.g. "Failed to fetch prospects"); no evidence of leaking query details or internal data in error responses. Recommend keeping error responses generic in production.
```

---

### Q7.2: Timing/Race Conditions ✅

**Question:** Are there any race conditions that could expose data?
1. Between permission check and data query
2. During role changes
3. During session refresh

**Answer:**
```
Race condition risks: (1) Permission check and data query run in the same request; getUserPermissions(session.user.email) and getRecruiterProspects(permissions.recruiterFilter, ...) are sequential. No other request can change this user's permissions mid-request. So no race between check and query within a single request. (2) Role changes: see Q5.2 — JWT is not invalidated when role changes; stale role can persist until next login or session expiry. That is a consistency/UX issue, not a classic race. (3) Session refresh: NextAuth refreshes JWT in the background; role in token is updated only when a new JWT is issued (e.g. on next request after refresh). No identified race that would allow a recruiter to see another agency's data due to timing.
```

---

### Q7.3: Caching Risks ✅

**Question:** Does the application cache any data that could be shared between users?
1. Are recruiter queries cached?
2. Could cached data from one agency leak to another?
3. Is the cache key agency-aware?

**Files to check:**
- `src/lib/cache.ts` (or similar)
- Any `unstable_cache` usage
- `.cursorrules` caching guidance

**Answer:**
```
Cached queries: cachedQuery (unstable_cache) is used in record-detail.ts for getRecordDetail. Recruiter-hub queries (getRecruiterProspects, getRecruiterOpportunities, getDistinctExternalAgencies, getRecruiterHubSGMs) are NOT wrapped in cachedQuery; they are force-dynamic. Other cached queries (funnel-metrics, conversion-rates, etc.) are only reachable by non-recruiters (middleware blocks recruiters).

Cache isolation: getRecordDetail is called with (id, recruiterFilter). The cache key for unstable_cache is derived from the keyName and the function arguments (Next.js serializes arguments). So (id: "abc", recruiterFilter: "AgencyA") and (id: "abc", recruiterFilter: "AgencyB") produce different cache entries. Cache is agency-aware for record-detail.

Risks: Low. Recruiter-hub data is not cached. The only recruiter-accessible cached path is record-detail, and the cache key includes recruiterFilter, so one agency's record detail cannot be returned for another agency.
```

---

### Q7.4: Browser DevTools Exploitation ✅

**Question:** What can a recruiter see if they open browser DevTools?
1. Are any sensitive API responses visible in Network tab?
2. Are full record details pre-loaded but hidden in the UI?
3. Is there any client-side filtering that could be bypassed?

**Answer:**
```
Network tab exposure: A recruiter can only call allowlisted APIs (recruiter-hub, auth, change-password, data-freshness). Responses they see are those returned by the server: prospects/opportunities filtered by their agency, their own permissions, data-freshness metadata. They cannot call /api/dashboard/funnel-metrics or other blocked routes from the browser (middleware returns 403). So in the Network tab they see only what the server intentionally returns to them (agency-scoped data).

Pre-loaded data: Recruiter Hub fetches prospects and opportunities via POST to /api/recruiter-hub/prospects and /api/recruiter-hub/opportunities; record detail is fetched on demand when they click a row (GET /api/dashboard/record-detail/[id]). There is no pre-loading of all record details or other agencies' data. Data loaded is only what the server returns after server-side filtering.

Client-side filtering: Filtering by agency is done on the server (recruiterFilter in queries). The client may filter by stage/SGM for display, but the dataset is already limited to the recruiter's agency. Bypassing client-side filters (e.g. hiding a "stage" filter) would not reveal other agencies' data; the server never sends it.
```

---

## Phase 8: Future-Proofing Recommendations

> **Goal:** Provide actionable recommendations for ongoing security.

### Q8.1: Automated Security Tests

**Question:** Propose a set of automated tests that should be added:
1. Test that recruiters get 403 from all sensitive endpoints
2. Test that recruiters only see their agency's data
3. Test that new routes default to blocked

**Answer:**
```
Proposed test structure (e.g. Playwright API or Jest + fetch):

1. Obtain a recruiter session (login as recruiter, capture session cookie or JWT).
2. For each sensitive path (e.g. /api/dashboard/funnel-metrics, /api/dashboard/export-sheets, /api/agent/query, /api/sga-hub/weekly-actuals, /api/saved-reports), send GET or POST with recruiter session; assert response.status === 403.
3. For allowlisted paths (/api/recruiter-hub/prospects, /api/recruiter-hub/opportunities), send POST with recruiter session; assert 200 and that every record has External_Agency__c (or equivalent) equal to the recruiter's assigned agency.
4. Call GET /api/dashboard/record-detail/[id] with a known id that belongs to another agency; assert 404 (not 200).
5. New route default: add a temporary route under /api/dashboard/test-new-route that has no role check; request as recruiter; assert 403 (middleware blocks). Then remove the route.

Example (pseudo-code):
describe('Recruiter Security', () => {
  it('returns 403 for recruiters on sensitive endpoints', async () => {
    const cookie = await getRecruiterSessionCookie();
    const sensitive = ['/api/dashboard/funnel-metrics', '/api/agent/query', ...];
    for (const path of sensitive) {
      const res = await fetch(origin + path, { headers: { cookie } });
      expect(res.status).toBe(403);
    }
  });
  it('returns only agency-scoped data for recruiter-hub', async () => {
    const cookie = await getRecruiterSessionCookie();
    const res = await fetch(origin + '/api/recruiter-hub/prospects', { method: 'POST', body: '{}', headers: { cookie, 'Content-Type': 'application/json' } });
    const data = await res.json();
    const agency = getRecruiterAgency(); // from test user
    data.records.forEach(r => expect(r.External_Agency__c).toBe(agency));
  });
});
```

---

### Q8.2: CI/CD Checks

**Question:** What CI/CD checks should be added?
1. Pre-commit hooks?
2. PR checks for new API routes?
3. Scheduled security scans?

**Answer:**
```
1. Pre-commit hooks: Optional. Run lint and typecheck (existing). Could add a simple script that greps for new files under src/app/api/ and warns if they don't contain getUserPermissions or getServerSession (heuristic only; not foolproof).

2. PR checks for new API routes: In CI, on PRs that touch src/app/api/, run the recruiter security tests (Q8.1) so that new routes are verified as blocked for recruiters unless allowlisted. Optionally, a script that parses middleware.ts and fails if a new route under /api/dashboard/ or /api/agent/ is added to the allowlist without a comment or ticket reference.

3. Scheduled security scans: Use existing dependency scanning (e.g. npm audit, Dependabot). No evidence of OWASP or DAST scans; consider adding if required by policy. Recruiter-specific: periodic run of the recruiter security test suite against staging to catch regressions.
```

---

### Q8.3: Monitoring & Alerting

**Question:** What runtime monitoring would help detect security issues?
1. Failed authorization attempts
2. Unusual data access patterns
3. Role changes

**Answer:**
```
1. Failed authorization attempts: Log and optionally alert on 403 responses for /api/* when the request has a valid session (e.g. cookie present). High volume of 403s for a single user could indicate probing. Differentiate recruiter 403s (expected when they hit blocked paths) vs. other roles.

2. Unusual data access patterns: Log GET /api/dashboard/record-detail/[id] with user id and role; alert on very high request volume per user or per id. Monitor recruiter-hub POST body size or parameter patterns for anomalies (e.g. bulk enumeration attempts).

3. Role changes: Log when User.role or User.externalAgency is updated (PUT /api/users/[id]), including who made the change and the target user. Consider alerting when a user is demoted from admin to recruiter or when externalAgency is set, for audit trail.
```

---

## Findings & Recommendations Summary

> **Cursor.ai: After completing all phases, summarize findings here**

### Critical Issues (Must Fix) ❌

```
None. No critical security vulnerabilities were found. Recruiters are blocked by middleware from sensitive routes, and allowlisted routes apply recruiterFilter correctly (except external-agencies returning all agency names, which is low sensitivity).
```

### Potential Concerns (Should Review) ⚠️

```
1. external-agencies: GET /api/recruiter-hub/external-agencies returns all distinct agency names; recruiters can see the full list. Low sensitivity; consider filtering to single agency for recruiters if desired.
2. Dot-bypass: pathname.includes('.') skips auth for any path with a dot. No current route serves files by name; if one is added (e.g. [file].json), it could be reachable without auth. Consider restricting the dot exception to known static prefixes.
3. Case sensitivity: /DASHBOARD/* may not match matcher; verify production host normalizes path case.
4. JWT role staleness: Role changes (e.g. recruiter → admin) do not invalidate JWT; stale role can persist up to 24h. Document for admins; consider invalidating or forcing re-login on role/externalAgency change.
5. forbidRecruiter unused: No route uses forbidRecruiter(); all use manual role checks. Consider adopting the helper for consistency.
6. .cursorrules: No recruiter-specific rules; add a short bullet so Cursor/developers remember default-deny and recruiterFilter when adding routes.
7. No automated recruiter security tests: Add tests that recruiters get 403 on sensitive endpoints and only see agency-scoped data.
```

### Verified Secure ✅

```
- Middleware matcher covers /dashboard/* and /api/*; no sensitive routes outside.
- Public exceptions: /_next, /api/auth/*, /api/cron/* (CRON_SECRET), /login, /static, /monitoring — all safe or protected.
- Recruiter allowlist: prospects and opportunities apply recruiterFilter; request body externalAgencies ignored for recruiters; change-password and data-freshness safe.
- Dashboard redirect: /dashboard and /dashboard/ redirect recruiters; path traversal normalizes and is blocked.
- All sensitive API routes use getServerSession and getUserPermissions; dashboard/agent/admin/sga-hub/sga-activity/saved-reports block recruiters at route level or by role allowlist.
- Record detail: agency verification via getRecordDetail(id, recruiterFilter); 404 for wrong agency.
- Export: recruiters blocked from export-sheets; Recruiter Hub export is client-side from already-filtered data.
- Agent/Explore: middleware blocks /api/agent/query; route and page both block recruiters; no pre-redirect data exposure.
- JWT: role set from DB at login; client cannot modify; backfill uses DB.
- externalAgency: only admins (canManageUsers) can set; recruiters cannot change own; validated non-empty for recruiter role.
- Recruiter-hub: parameter override and SQL injection risks mitigated (server-side recruiterFilter; parameterized queries).
- Caching: record-detail cache key includes recruiterFilter; recruiter-hub queries not cached.
- DevTools: recruiters see only allowlisted API responses (agency-scoped data).
```

### Recommended Actions

| Priority | Action | Files Affected | Effort |
|----------|--------|----------------|--------|
| P1 | Add recruiter security bullet to .cursorrules (default-deny, recruiterFilter, allowlist) | .cursorrules | ~15 min |
| P1 | Optionally filter getDistinctExternalAgencies by recruiterFilter when caller is recruiter | src/lib/queries/recruiter-hub.ts, src/app/api/recruiter-hub/external-agencies/route.ts | ~30 min |
| P1 | Document JWT role staleness (role change takes effect on next login / within 24h) in recruiter-security-audit.md | docs/recruiter-security-audit.md | ~15 min |
| P2 | Add automated tests: recruiter 403 on sensitive endpoints, agency-scoped data only | New test file(s) | 2–4 h |
| P2 | Consider adopting forbidRecruiter(permissions) in sensitive routes for consistency | Multiple API route files | ~1 h |
| P2 | Consider restricting pathname.includes('.') to known static prefixes | src/middleware.ts | ~30 min |
| P3 | Optional: validate externalAgency against BigQuery agency list on user create/update | src/app/api/users/route.ts, [id]/route.ts | ~1 h |

---

## Appendix: Files Inspected

```
src/middleware.ts
src/lib/auth.ts
src/lib/api-authz.ts
src/lib/permissions.ts
src/lib/cache.ts
src/lib/queries/recruiter-hub.ts
src/lib/queries/record-detail.ts
src/app/api/auth/permissions/route.ts
src/app/api/cron/refresh-cache/route.ts
src/app/api/cron/trigger-transfer/route.ts
src/app/api/recruiter-hub/prospects/route.ts
src/app/api/recruiter-hub/opportunities/route.ts
src/app/api/recruiter-hub/external-agencies/route.ts
src/app/api/users/me/change-password/route.ts
src/app/api/users/route.ts
src/app/api/users/[id]/route.ts
src/app/api/dashboard/data-freshness/route.ts
src/app/api/dashboard/record-detail/[id]/route.ts
src/app/api/dashboard/export-sheets/route.ts
src/app/api/agent/query/route.ts
src/app/dashboard/explore/page.tsx
.cursorrules
docs/recruiter-security-audit.md
(Grep/search across src/app/api/ for getUserPermissions, forbidRecruiter, role === 'recruiter')
```

---

## Audit Metadata

- **Auditor:** Cursor.ai
- **Date:** 2026-01-28
- **Codebase Version/Commit:** [Not captured]
- **Time Spent:** [Estimated: single audit pass]

---

# Claude Code Security Audit

> **Auditor:** Claude Code (Opus 4.5)
> **Date:** 2026-01-28
> **Purpose:** Deep-dive security review to identify additional vulnerabilities not covered in the initial audit, with focus on recruiter role isolation and future-proofing for agentic development.

---

## Critical Issues Found (❌ Must Fix Immediately)

### 1. `/api/explore/feedback` - Missing Recruiter Authorization Check

**Severity:** CRITICAL
**File:** `src/app/api/explore/feedback/route.ts`

**Issue:** This route has `getServerSession()` authentication but **NO role authorization check**. While middleware blocks it as a non-allowlisted `/api` route, there is no defense-in-depth.

**Risks:**
- If middleware is bypassed, recruiters could access this endpoint
- Could potentially leak information about queries being run by other users
- Missing the pattern that all other sensitive routes follow

**Recommended Fix:**
```typescript
// Add after getServerSession() check:
const permissions = await getUserPermissions(session.user.email);
if (permissions.role === 'recruiter') {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
```

---

### 2. `/api/games/*` Routes - No Authorization Checks At All

**Severity:** CRITICAL
**Files:**
- `src/app/api/games/pipeline-catcher/leaderboard/route.ts`
- `src/app/api/games/pipeline-catcher/levels/route.ts`
- `src/app/api/games/pipeline-catcher/play/[quarter]/route.ts`

**Issue:** Game routes have authentication (`getServerSession`, `getSessionUserId`) but **NO `getUserPermissions` calls and NO role checks**. They don't even import `getUserPermissions`.

**What recruiters can access:**
- `GET /api/games/pipeline-catcher/leaderboard?quarter=2026-Q1` - View ALL users' game scores (fetches all scores from BigQuery, no filtering)
- `POST /api/games/pipeline-catcher/leaderboard` - Submit game scores and manipulate rankings
- `GET /api/games/pipeline-catcher/levels` - Enumerate all game quarters
- `GET /api/games/pipeline-catcher/play/[quarter]` - Get game data for any quarter

**Risk Assessment:** Game data reveals information about employees (names, scores) which shouldn't be accessible to recruiters.

**Recommended Fix:** Add to each route:
```typescript
import { getUserPermissions } from '@/lib/permissions';

// After getSessionUserId():
const permissions = await getUserPermissions(session.user.email);
if (permissions.role === 'recruiter') {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
```

---

## High-Priority Issues (⚠️ Should Fix Soon)

### 3. GET `/api/recruiter-hub/opportunities` Missing `allowedPages` Check

**Severity:** MEDIUM
**File:** `src/app/api/recruiter-hub/opportunities/route.ts` (lines 54-78)

**Issue:** The `GET` endpoint doesn't call `getUserPermissions()` or verify `allowedPages.includes(12)`, while the `POST` endpoint does. Inconsistent defense-in-depth pattern.

**Recommended Fix:**
```typescript
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const permissions = await getUserPermissions(session.user.email);
  if (!permissions.allowedPages.includes(12)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const sgms = await getRecruiterHubSGMs(permissions.recruiterFilter);
  // ...
}
```

---

### 4. Saved Reports Routes Need Recruiter Block for Defense-in-Depth

**Severity:** MEDIUM
**Files:**
- `src/app/api/saved-reports/[id]/route.ts`
- `src/app/api/saved-reports/[id]/duplicate/route.ts`

**Issue:** While saved-reports is not on the recruiter middleware allowlist, the routes themselves don't explicitly block recruiters. The `GET` endpoint allows access to `admin_template` reports which could contain sensitive filter configurations.

**Recommended Fix:** Add explicit recruiter check at route level:
```typescript
const permissions = await getUserPermissions(session.user.email);
if (permissions.role === 'recruiter') {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
```

---

### 5. No Rate Limiting on Data API Endpoints

**Severity:** MEDIUM
**File:** `src/lib/rate-limit.ts`

**Issue:** Rate limiting is only configured for auth endpoints (`login`, `forgot-password`, `reset-password`). No rate limiting on:
- `/api/recruiter-hub/prospects`
- `/api/recruiter-hub/opportunities`
- `/api/dashboard/*` endpoints
- `/api/games/*` endpoints

**Risk:** A recruiter could potentially enumerate records or perform DoS attacks on expensive BigQuery operations.

**Recommended Fix:** Add rate limiters for data endpoints (e.g., 100 requests/minute per user).

---

### 6. Game Score Endpoint Accepts Negative Scores

**Severity:** MEDIUM
**File:** `src/app/api/games/pipeline-catcher/leaderboard/route.ts` (POST endpoint)

**Issue:** The POST endpoint accepts any integer via `BigInt(Math.floor(score))` without validation for negative values.

**Risk:** Could corrupt leaderboard data or cause unexpected behavior.

**Recommended Fix:**
```typescript
if (!Number.isInteger(score) || score < 0) {
  return NextResponse.json({ error: 'Score must be a non-negative integer' }, { status: 400 });
}
```

---

## Pattern & Consistency Issues (⚠️ Should Address)

### 7. `forbidRecruiter()` Helper Exists But Is Never Used

**Severity:** MEDIUM (consistency concern)
**File:** `src/lib/api-authz.ts`

**Issue:** The helper function `forbidRecruiter(permissions)` exists and provides a consistent authorization pattern, but **no API route uses it**. Every sensitive route manually implements:
```typescript
if (permissions.role === 'recruiter') {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
```

**Risks:**
- Inconsistent implementation across 15+ routes
- Harder to audit (no single grep pattern)
- If behavior needs to change (e.g., add logging), requires updates in many files
- New developers may not know about the helper

**Recommended Fix:** Refactor routes to use the helper:
```typescript
import { forbidRecruiter } from '@/lib/api-authz';

// Instead of manual check:
const forbidden = forbidRecruiter(permissions);
if (forbidden) return forbidden;
```

---

## Verified Secure Components (✅)

The following were verified as properly secured during this review:

| Component | Status | Notes |
|-----------|--------|-------|
| Middleware default-deny | ✅ | Correctly blocks recruiters from non-allowlisted paths |
| Recruiter Hub query filters | ✅ | `recruiterFilter` properly applied in all queries |
| Request body override prevention | ✅ | `externalAgencies` from body ignored when `recruiterFilter` set |
| Record detail agency verification | ✅ | Returns 404 for records outside recruiter's agency |
| JWT role integrity | ✅ | Role set from DB at login, cannot be modified by client |
| User management permissions | ✅ | Only `canManageUsers` users can create/modify users |
| SGA/SGA-Activity routes | ✅ | All have proper role restrictions |
| Export endpoints | ✅ | Recruiters blocked from all export functionality |
| SQL injection prevention | ✅ | Parameterized queries used throughout |

---

## Summary: Issues by Priority

| Priority | Issue | Effort | Status |
|----------|-------|--------|--------|
| **P0** | `/api/games/*` routes missing all authorization | 30 min | ❌ NEW |
| **P0** | `/api/explore/feedback` missing recruiter block | 10 min | ❌ NEW |
| **P1** | GET `/api/recruiter-hub/opportunities` missing permissions check | 10 min | ⚠️ NEW |
| **P1** | Saved reports routes need recruiter block | 20 min | ⚠️ NEW |
| **P1** | No rate limiting on data APIs | 1-2 hrs | ⚠️ NEW |
| **P2** | Game scores accept negative values | 15 min | ⚠️ NEW |
| **P2** | Adopt `forbidRecruiter()` helper pattern | 1 hr | ⚠️ NEW |
| **P2** | Add recruiter rules to `.cursorrules` | 15 min | ⚠️ EXISTING |
| **P3** | Filter `getDistinctExternalAgencies` for recruiters | 20 min | ⚠️ EXISTING |
| **P3** | Document JWT role staleness for admins | 15 min | ⚠️ EXISTING |

---

## Recommended Immediate Actions

### 1. Fix Critical Issues (Do Now)

**File: `src/app/api/games/pipeline-catcher/leaderboard/route.ts`**
```typescript
// Add import at top:
import { getUserPermissions } from '@/lib/permissions';

// Add after getSessionUserId() check in both GET and POST:
const permissions = await getUserPermissions(session.user.email);
if (permissions.role === 'recruiter') {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
```

Apply same pattern to:
- `src/app/api/games/pipeline-catcher/levels/route.ts`
- `src/app/api/games/pipeline-catcher/play/[quarter]/route.ts`
- `src/app/api/explore/feedback/route.ts`

### 2. Add to `.cursorrules`

```markdown
## Recruiter Security Rules

- **Default-deny**: Middleware blocks recruiters from all `/api/*` except allowlist
- **Allowlist**: `/api/auth*`, `/api/recruiter-hub*`, `/api/users/me/change-password`, `/api/dashboard/data-freshness`
- **New API routes**: MUST include `getUserPermissions()` and check `role !== 'recruiter'` unless specifically intended for recruiters
- **Recruiter data**: Always use `permissions.recruiterFilter` from `getUserPermissions()` - never trust client-supplied agency filters
- **Helper**: Use `forbidRecruiter(permissions)` from `@/lib/api-authz.ts` for consistent blocking
```

### 3. Add Automated Tests

Create tests that verify:
1. Recruiters get 403 from all sensitive endpoints (dashboard, sga-hub, games, explore, saved-reports)
2. Recruiters only see records matching their `External_Agency__c`
3. New routes under `/api/*` are blocked by default

---

## Files Requiring Updates

| File | Change Needed | Priority |
|------|---------------|----------|
| `src/app/api/games/pipeline-catcher/leaderboard/route.ts` | Add recruiter authorization | P0 |
| `src/app/api/games/pipeline-catcher/levels/route.ts` | Add recruiter authorization | P0 |
| `src/app/api/games/pipeline-catcher/play/[quarter]/route.ts` | Add recruiter authorization | P0 |
| `src/app/api/explore/feedback/route.ts` | Add recruiter authorization | P0 |
| `src/app/api/recruiter-hub/opportunities/route.ts` | Add permissions check to GET | P1 |
| `src/app/api/saved-reports/[id]/route.ts` | Add recruiter block | P1 |
| `src/app/api/saved-reports/[id]/duplicate/route.ts` | Add recruiter block | P1 |
| `.cursorrules` | Add recruiter security rules | P2 |
| `src/lib/rate-limit.ts` | Add data endpoint limiters | P2 |

---

## Claude Code Security Audit Metadata

- **Auditor:** Claude Code (Opus 4.5)
- **Date:** 2026-01-28
- **Methodology:** Comprehensive codebase exploration including middleware, API routes, queries, permissions, and rate limiting
- **Files Inspected:** 40+ files across middleware, API routes, queries, and configuration
- **New Issues Found:** 7 (2 critical, 4 medium, 1 low)
- **Existing Issues Confirmed:** 5
