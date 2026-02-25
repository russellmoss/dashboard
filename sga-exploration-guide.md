# SGA Permissions Expansion
## Codebase Exploration & Agentic Implementation Guide

**Project:** Savvy Wealth Recruiting Funnel Dashboard  
**Objective:** Expand SGA role to (1) see ALL data on Funnel Performance page and (2) see ALL Closed Lost Follow-Up and Re-Engagement Opportunities in SGA Hub — matching current Admin view behavior.  
**Method:** Phased codebase exploration with Claude Code. Answer each question directly in this document before proceeding to the Implementation Guide at the bottom.

---

## ✅ IMPLEMENTATION STATUS

| Change | Status | Date | Method |
|--------|--------|------|--------|
| Closed Lost Follow-Up — SGA sees all records | **COMPLETE** | — | Direct Claude Code prompt (see Appendix A) |
| Re-Engagement Opportunities — SGA sees all records | **COMPLETE** | — | Direct Claude Code prompt (see Appendix A) |
| Funnel Performance — SGA sees all data (no sgaFilter) | **COMPLETE** | d23ba60 | funnel-metrics/route.ts never applied sgaFilter (confirmed by Phase 1.3 exploration) |

> **Note:** Phases 1–3 exploration questions remain valuable even though Implementation A is done. The Closed Lost/Re-Engagement changes may interact with Phase 1's sgaFilter investigation — document the findings below so the full picture is captured before touching `permissions.ts`.

---

> **Anti-Hallucination Rules for Claude Code**
> - Read every file listed **before** answering questions or writing code
> - Use exact `grep` commands as written — do not paraphrase results
> - Paste actual code snippets, not descriptions of what you think the code says
> - If a file path does not exist, say so explicitly — do not assume its contents
> - Do not begin any implementation phase until all exploration questions in that phase are answered

---

## Phase 1: Permission System Baseline

**Goal:** Understand exactly how SGA permissions are constructed and where `sgaFilter` originates, flows, and is consumed.

---

### 1.1 — ROLE_PERMISSIONS for SGA

**Command:**
```bash
grep -n "sga" src/lib/permissions.ts
```

**Also run:**
```bash
cat src/lib/permissions.ts
```

**Questions:**
1. Paste the complete `sga` entry from `ROLE_PERMISSIONS` — what `allowedPages` does it have?
2. In `getPermissionsFromToken()`, what line sets `sgaFilter` and what is the exact condition that triggers it?
3. In `getUserPermissions()`, what line sets `sgaFilter`?
4. Are these two functions producing identical `sgaFilter` logic, or is there any divergence?

**Finding:**
```
1. Complete SGA entry from ROLE_PERMISSIONS (permissions.ts:42-48):
   sga: {
     role: 'sga',
     allowedPages: [1, 3, 7, 8, 10, 11, 13, 15],  // 15 = Advisor Map
     canExport: true,
     canManageUsers: false,
     canManageRequests: false,
   },

2. getPermissionsFromToken(), line 82:
     sgaFilter: tokenData.role === 'sga' ? tokenData.name : null,
   Condition: role is 'sga' → set to token name. All other roles → null.

3. getUserPermissions(), line 117:
     sgaFilter: user.role === 'sga' ? user.name : null,

4. IDENTICAL logic. Both set sgaFilter to the user's name when role === 'sga',
   and null for all other roles. No divergence.
```

---

### 1.2 — sgaFilter Call Sites (Where It Is Consumed)

**Command:**
```bash
grep -rn "sgaFilter" src/ --include="*.ts" --include="*.tsx"
```

**Questions:**
1. List every file and line number where `sgaFilter` is read or applied
2. Which of these are API routes vs. components vs. utility functions?
3. Is there any location where `sgaFilter` is applied conditionally based on which page is being served, or is it always applied uniformly?
4. Does any API route check the current page context before applying `sgaFilter`?

**Finding:**
```
Files and lines where permissions.sgaFilter is READ/APPLIED (API routes only):
  src/app/api/sga-activity/scheduled-calls/route.ts:56-57
  src/app/api/sga-activity/filters/route.ts:30-32
  src/app/api/sga-activity/dashboard/route.ts:41-42
  src/app/api/sga-activity/activity-records/route.ts:33-34
  src/app/api/dashboard/open-pipeline/route.ts:43-44
  src/app/api/dashboard/forecast/route.ts:34-35
  src/app/api/dashboard/export-sheets/route.ts:55-56

Also defined/typed in: src/lib/permissions.ts:82,117,135 | src/types/user.ts:20 | src/types/agent.ts:82
Query files (closed-lost.ts, re-engagement.ts, drill-down.ts, sga-activity.ts) use a LOCAL
variable named sgaFilter derived from a sgaName parameter — NOT directly from permissions.sgaFilter.

2. API routes: all 7 above. Components: none (no permissions.sgaFilter in .tsx files).
   Utility: permissions.ts getDataFilters() at line 130-138.

3. sgaFilter is NOT applied uniformly. It is ABSENT from:
   - funnel-metrics/route.ts (explicit comment: "SGA/SGM filters are NOT auto-applied")
   - conversion-rates/route.ts
   - channel-performance (no separate route — served via funnel-metrics)
   - source-performance/route.ts
   - detail-records/route.ts
   Each route makes its own independent decision. No page-context awareness.

4. No API route checks page context before applying sgaFilter.
   Each route applies it unconditionally based on role.
```

---

### 1.3 — Funnel Metrics API Route

**Command:**
```bash
find src/app/api -name "route.ts" | xargs grep -l "sgaFilter\|sga_filter\|SGA_Owner" 2>/dev/null
```

**Then read the primary funnel metrics API route in full:**
```bash
cat src/app/api/dashboard/metrics/route.ts
# or wherever the main funnel metrics route lives — check the file above
```

**Questions:**
1. What is the exact file path of the API route that powers the Funnel Performance page metrics?
2. Paste the section of that route where `sgaFilter` is applied to the query
3. Is the filter applied server-side in the BigQuery query itself, or is it applied after data is returned?
4. If an SGA hits this endpoint, can they pass query params to override the filter, or is the filter hardcoded from `permissions.sgaFilter`?

**Finding:**
```
1. File path: src/app/api/dashboard/funnel-metrics/route.ts

2. sgaFilter is NOT applied in this route. The route explicitly comments at lines 39-40:
   // Note: SGA/SGM filters are NOT automatically applied to main dashboard
   // (Non-recruiter users can see all data on the funnel performance dashboard)
   The route passes `filters` directly from the request body to getFunnelMetrics(filters)
   without injecting permissions.sgaFilter anywhere.

3. Filter is applied SERVER-SIDE in the BigQuery query — but only when the user passes
   filters.sga as a query param from the frontend. The server never forces sgaFilter in.

4. An SGA hitting this endpoint can freely omit filters.sga and see all data.
   The filter is purely frontend-controlled; the server does not enforce it.

⚠️ KEY FINDING: The Funnel Performance "PENDING" item is ALREADY IMPLEMENTED.
   SGA users already see all funnel data. The recent commit d23ba60 ("feat(sga): expand
   SGA visibility") added the explicit comment confirming this intentional design.
```

---

### 1.4 — SGA Hub Weekly Goals Filter Behavior

**Command:**
```bash
cat src/app/api/sga-hub/weekly-goals/route.ts
```

**Questions:**
1. Does the weekly-goals API route apply `sgaFilter` from permissions, or does it use a different mechanism (e.g., session email, `targetUserEmail` param)?
2. If `sgaFilter` were set to `null` for the SGA role globally, would this route still correctly scope data to the logged-in SGA's own goals — or would it return all SGAs' goals?
3. What is the exact line/block that scopes weekly goals to the current SGA user?

**Finding:**
```
1. weekly-goals route does NOT use sgaFilter from permissions. It uses a DIFFERENT mechanism:
   session.user.email → passed directly to getWeeklyGoals(userEmail, ...).

2. If sgaFilter were null globally for SGA, this route would still correctly scope to
   the logged-in SGA's own goals. The scoping mechanism is independent of permissions.sgaFilter.

3. Exact scoping block (weekly-goals/route.ts:42-55):
   let userEmail = session.user.email;

   if (targetUserEmail) {
     // Only admin/manager/revops_admin can view other users' goals
     if (!['admin', 'manager', 'revops_admin'].includes(permissions.role)) {
       return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
     }
     userEmail = targetUserEmail;
   } else {
     // SGA role required for own goals
     if (!['admin', 'manager', 'sga', 'sgm', 'revops_admin'].includes(permissions.role)) {
       return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
     }
   }
   // Then: getWeeklyGoals(userEmail, ...)
```

---

### 1.5 — SGA Hub Quarterly Progress Filter Behavior

**Command:**
```bash
cat src/app/api/sga-hub/quarterly-progress/route.ts
```

**Questions:**
1. Same as 1.4 — does this route use `sgaFilter` from permissions or a separate scoping mechanism?
2. If `sgaFilter` were `null` for SGA role, would quarterly progress still show only the SGA's own data?
3. Paste the exact block that scopes data to the current user.

**Finding:**
```
1. quarterly-progress route does NOT use sgaFilter from permissions. Uses DIFFERENT mechanism:
   session.user.email → DB lookup for name → BigQuery query.

2. If sgaFilter were null globally for SGA, quarterly progress would still correctly show
   only the SGA's own data — completely unaffected.

3. Exact scoping block (quarterly-progress/route.ts:40-66):
   let userEmail = session.user.email;

   if (targetUserEmail) {
     // Admin/Manager/RevOps Admin can view any SGA's progress
     if (!['admin', 'manager', 'revops_admin'].includes(permissions.role)) {
       return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
     }
     userEmail = targetUserEmail;
   } else {
     // SGA can only view their own progress
     if (!['admin', 'manager', 'sga', 'sgm', 'revops_admin'].includes(permissions.role)) {
       return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
     }
   }
   // DB lookup:
   const user = await prisma.user.findUnique({
     where: { email: userEmail },
     select: { name: true },
   });
   // Then: getQuarterlySQOCount(user.name, quarter)
```

---

### 1.6 — Blast Radius Assessment for Setting sgaFilter = null

**Based on findings from 1.2, 1.4, and 1.5, answer:**

1. If we set `sgaFilter: null` in `getPermissionsFromToken()` for the `sga` role (unconditionally), list every API route that would change behavior
2. For each affected route, would the change be: (a) desired — SGA sees all data, or (b) undesired — SGA sees data they shouldn't?
3. Complete this table:

| API Route | Current Behavior (sgaFilter applied) | Behavior if sgaFilter = null | Desired? |
|-----------|--------------------------------------|-------------------------------|----------|
| [route]   | [current]                            | [new]                         | Yes/No   |

4. **Decision gate:** Is setting `sgaFilter: null` for the SGA role globally safe, or does it break SGA Hub personal tabs (weekly goals, quarterly progress)?

**Finding:**
```
1. If sgaFilter: null globally for SGA role, these routes change behavior:
   - api/sga-activity/dashboard         — SGA sees ALL SGAs' activity dashboard
   - api/sga-activity/activity-records  — SGA sees ALL SGAs' activity records
   - api/sga-activity/scheduled-calls   — SGA sees ALL SGAs' scheduled calls
   - api/sga-activity/filters           — SGA no longer pre-filtered to own name
   - api/dashboard/open-pipeline        — SGA sees ALL pipeline (currently scoped to own)
   - api/dashboard/forecast             — SGA sees ALL forecast (currently scoped to own)
   - api/dashboard/export-sheets        — SGA sees ALL export data

2. Desired vs undesired breakdown:
   - SGA Activity routes (4): UNDESIRED — SGAs should only see their own activity
   - open-pipeline, forecast, export-sheets: DEPENDS on product intent (not scoped in this task)
   - funnel-metrics, conversion-rates, detail-records: UNCHANGED (already all-data)
   - weekly-goals, quarterly-progress: UNCHANGED (use session.user.email)

3. Blast radius table:
   | API Route                            | Current (sgaFilter applied)    | If sgaFilter = null        | Desired? |
   |--------------------------------------|-------------------------------|----------------------------|----------|
   | api/dashboard/funnel-metrics         | Not applied (all data)        | No change                  | Yes      |
   | api/dashboard/open-pipeline          | SGA sees own pipeline only    | SGA sees ALL pipeline      | Unclear  |
   | api/dashboard/forecast               | SGA sees own forecast only    | SGA sees ALL forecasts     | Unclear  |
   | api/dashboard/export-sheets          | SGA sees own data only        | SGA sees ALL export        | Unclear  |
   | api/sga-activity/dashboard           | SGA sees own activity only    | SGA sees ALL SGAs' activity| NO       |
   | api/sga-activity/activity-records    | SGA sees own records only     | SGA sees ALL SGAs' records | NO       |
   | api/sga-activity/scheduled-calls     | SGA sees own calls only       | SGA sees ALL calls         | NO       |
   | api/sga-activity/filters             | SGA name pre-selected         | All SGAs available         | NO       |
   | api/sga-hub/weekly-goals             | Not affected (session.email)  | No change                  | Yes      |
   | api/sga-hub/quarterly-progress       | Not affected (session.email)  | No change                  | Yes      |

4. DECISION: Setting sgaFilter: null globally is NOT SAFE.
   The four SGA Activity routes would break — SGAs would see all other SGAs' activity data.
   Implementation B (Option A — global null) is off the table.
   However: Funnel Performance is already showing all data without ANY change needed.
   The only remaining risk is open-pipeline, forecast, export-sheets — Russell to decide
   if SGA should see all pipeline/forecast data (separate from this task scope).
```

---

## Phase 2: Closed Lost & Re-Engagement API Deep Dive

**Goal:** Understand the exact gatekeeping logic in both API routes so we know the minimum surgical changes needed.

---

### 2.1 — Closed Lost Route Full Read

**Command:**
```bash
cat src/app/api/sga-hub/closed-lost/route.ts
```

**Questions:**
1. Paste the exact `if (showAll && ...)` block that gates the `showAll` functionality by role
2. What roles are currently allowed to use `showAll`?
3. If a user sends `?showAll=true` and their role is `sga`, what happens today — 403, or does it fall through to default SGA filtering?
4. When `showAll` is false and no `targetUserEmail` is provided, how does the route determine which SGA's records to fetch? Does it use `sgaFilter` from permissions, or does it query the database for the user's name directly?
5. Paste the exact lines that determine `sgaName` for the default (non-showAll, non-targetUserEmail) path

**Finding:**
```
1. The showAll block in closed-lost/route.ts (lines 49-51):
   if (showAll) {
     // Show all records - pass null to query to skip SGA filter
     sgaName = null;
   }
   ⚠️ CRITICAL: There is NO role guard for showAll here. The only role check is the
   blanket allowlist at lines 36-38 (admin, manager, sga, sgm, revops_admin).
   ANY of those roles can use showAll=true — including SGM.

2. Roles currently allowed to use showAll: admin, manager, sga, sgm, revops_admin
   (all roles in the general allowlist — no separate showAll gate).

3. If SGA sends ?showAll=true today: it WORKS — falls through to sgaName = null,
   returning all records. The API already allows it.

4. Default path (no showAll, no targetUserEmail) — sgaName determination (lines 66-75):
   const user = await prisma.user.findUnique({
     where: { email: session.user.email },
     select: { name: true },
   });
   if (!user) {
     return NextResponse.json({ error: 'User not found' }, { status: 404 });
   }
   sgaName = user.name;
   Uses session.user.email → DB name lookup. NOT permissions.sgaFilter.

5. Lines 66-75 shown above — session.user.email is the gate, not sgaFilter.

⚠️ KEY FINDING: The closed-lost API already allows SGA to use showAll=true.
   Implementation A for this route was already correct in the API.
   The only remaining question was whether the frontend was sending showAll=true for SGAs.
```

---

### 2.2 — Re-Engagement Route Full Read

**Command:**
```bash
cat src/app/api/sga-hub/re-engagement/route.ts
```

**Questions:**
1. Same as 2.1 — paste the `showAll` gate block
2. What roles are currently allowed to use `showAll`?
3. Is the `showAll` logic and `sgaName` determination identical to the closed-lost route, or are there differences?
4. Note any differences between the two routes

**Finding:**
```
1. showAll gate block (re-engagement/route.ts lines 40-43):
   // Only admins/managers/revops_admin/sga can use showAll
   if (showAll && !['admin', 'manager', 'revops_admin', 'sga'].includes(permissions.role)) {
     return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
   }

2. Roles allowed to use showAll: admin, manager, revops_admin, sga.
   SGA is ALREADY in this list — explicitly included.

3. The showAll logic is nearly identical to closed-lost, with one key difference:
   - closed-lost: NO explicit showAll role guard (relying on blanket allowlist)
   - re-engagement: HAS explicit showAll role guard (already includes 'sga')
   Both default to session.user.email → DB name lookup for non-showAll path.

4. Differences between the two routes:
   - re-engagement has an explicit showAll guard (closed-lost does not)
   - re-engagement has no timeBuckets parameter
   - re-engagement queries getReEngagementOpportunities(sgaName) vs getClosedLostRecords(sgaName, timeBuckets)
   - re-engagement lacks the targetUserEmail gate (closed-lost explicitly gates to admin/manager/revops_admin/sga)
   Both use session.user.email → prisma.user.findUnique for default scoping.

⚠️ KEY FINDING: re-engagement API already allows SGA to use showAll=true (explicitly listed).
```

---

### 2.3 — SGAHubContent.tsx — isAdmin and showAll Wiring

**Command:**
```bash
grep -n "isAdmin\|showAll\|showAllClosedLost\|ClosedLostFollowUpTabs" src/app/dashboard/sga-hub/SGAHubContent.tsx
```

**Then read the full relevant section:**
```bash
sed -n '1,80p' src/app/dashboard/sga-hub/SGAHubContent.tsx
```

**Questions:**
1. Paste the exact `isAdmin` variable definition
2. Paste the exact prop being passed to `ClosedLostFollowUpTabs` for `showAllRecords`
3. Paste the exact prop being passed for `onToggleShowAll`
4. Is there a `useEffect` or API call that passes `showAll=true` to the backend, or is `showAllRecords` only a frontend display prop?
5. **Critical:** When `showAllRecords={true}` is passed to `ClosedLostFollowUpTabs`, does the component re-fetch data from the API with `?showAll=true`, or does it only filter/display the already-fetched records differently?

**Finding:**
```
1. isAdmin definition (SGAHubContent.tsx:37):
   const isAdmin = permissions?.role === 'admin' || permissions?.role === 'manager' || permissions?.role === 'revops_admin';

2. showAllRecords prop passed to ClosedLostFollowUpTabs (line 776):
   showAllRecords={isAdminOrSGAForClosedLost ? true : showAllClosedLost}

3. onToggleShowAll prop (line 777):
   onToggleShowAll={isAdminOrSGAForClosedLost ? undefined : handleToggleShowAllClosedLost}
   (undefined = hide the toggle button; SGA gets all records without a toggle)

4. There is a useEffect at line 271-284 that fires on tab change. When activeTab === 'closed-lost',
   it calls fetchClosedLostRecords(isAdminOrSGAForClosedLost ? true : showAllClosedLost) and
   fetchReEngagementOpportunities(). These fetch from the backend with showAll param.

5. CRITICAL — isAdminOrSGAForClosedLost variable (line 38):
   const isAdminOrSGAForClosedLost = isAdmin || permissions?.role === 'sga';
   When showAllRecords={true} is passed, the component re-fetches data from the API
   with ?showAll=true (via dashboardApi.getClosedLostRecords(undefined, undefined, showAll)).
   The fetch happens at the parent level, NOT inside the table component.

⚠️ KEY FINDING: Implementation A is ALREADY COMPLETE in the codebase.
   isAdminOrSGAForClosedLost exists and is wired to both showAllRecords prop and fetch calls.
   This matches the "COMPLETE" status in the implementation table.
```

---

### 2.4 — Data Fetching for Closed Lost Tab

**Command:**
```bash
grep -n "closed-lost\|re-engagement\|fetchClosedLost\|fetchReEngagement\|showAll" src/app/dashboard/sga-hub/SGAHubContent.tsx
```

**Questions:**
1. Paste the `fetch()` call(s) that hit `/api/sga-hub/closed-lost` — is `showAll` passed as a query param?
2. Paste the `fetch()` call(s) that hit `/api/sga-hub/re-engagement` — same question
3. When is data fetched — on mount, on tab switch, or continuously?
4. If `isAdmin` is true, does the fetch call include `?showAll=true`? Paste the exact ternary or conditional

**Finding:**
```
1. fetch() call for /api/sga-hub/closed-lost (SGAHubContent.tsx:124-136):
   const fetchClosedLostRecords = async (showAll: boolean = showAllClosedLost) => {
     const response = await dashboardApi.getClosedLostRecords(undefined, undefined, showAll);
     setClosedLostRecords(response.records);
   };
   showAll IS passed as a query param. When triggered from useEffect (line 275):
   fetchClosedLostRecords(isAdminOrSGAForClosedLost ? true : showAllClosedLost);
   → SGA users always call with showAll=true.

2. fetch() call for /api/sga-hub/re-engagement (SGAHubContent.tsx:145-158):
   const fetchReEngagementOpportunities = async () => {
     const showAll = isAdminOrSGAForClosedLost;
     const response = await dashboardApi.getReEngagementOpportunities(showAll);
     setReEngagementOpportunities(response.opportunities);
   };
   showAll IS passed. For SGA users, isAdminOrSGAForClosedLost = true → showAll=true.

3. Data is fetched on tab switch — when activeTab changes to 'closed-lost' in useEffect
   (lines 271-284). Not on mount, not continuously. One fetch per tab activation.

4. isAdminOrSGAForClosedLost is used to determine showAll for both fetch calls.
   Closed-lost: fetchClosedLostRecords(isAdminOrSGAForClosedLost ? true : showAllClosedLost)
   Re-engagement: const showAll = isAdminOrSGAForClosedLost;
```

---

### 2.5 — ClosedLostTable & ReEngagementOpportunitiesTable: showAllRecords Prop Usage

**Command:**
```bash
grep -n "showAllRecords\|showAll" src/components/sga-hub/ClosedLostTable.tsx
grep -n "showAllRecords\|showAll" src/components/sga-hub/ReEngagementOpportunitiesTable.tsx
```

**Questions:**
1. In `ClosedLostTable.tsx`, what does `showAllRecords` actually do — does it show/hide a toggle UI element, filter displayed data, or both?
2. In `ReEngagementOpportunitiesTable.tsx`, same question
3. Is there a "Show All / Show Mine" toggle button that appears for admins? Paste the JSX
4. Confirming: does the frontend re-fetch data when `showAllRecords` changes, or does it only affect display?

**Finding:**
```
1. In ClosedLostTable.tsx, showAllRecords DOES BOTH:
   - Controls display of an extra "SGA" table column (line 330: {showAllRecords && <TableCell>SGA</TableCell>})
   - Enables client-side SGA filter dropdown (lines 158-169, 280): when showAllRecords=true,
     an SGA name filter is available for client-side filtering
   - Affects colSpan on empty rows (line 343: colSpan={showAllRecords ? 7 : 6})
   No re-fetch occurs from within the component when showAllRecords changes.

2. In ReEngagementOpportunitiesTable.tsx, same pattern:
   - Controls display of SGA column and SGA filter dropdown
   - colSpan changes (line 299: colSpan={showAllRecords ? 8 : 7})
   No re-fetch from within the component.

3. "Show All / Show Mine" toggle: In ClosedLostFollowUpTabs, when onToggleShowAll is defined,
   a toggle button is shown. For SGA users, onToggleShowAll={undefined} so no toggle appears
   — they always see all records without a toggle.

4. CONFIRMED: No re-fetch when showAllRecords changes inside the table components.
   The data fetching is entirely handled by SGAHubContent.tsx's fetchClosedLostRecords()
   and fetchReEngagementOpportunities() functions.
```

---

### 2.6 — Blast Radius Assessment for Closed Lost / Re-Engagement Changes

**Based on Phase 2 findings, answer:**

1. To give SGA role the same view as admin for Closed Lost and Re-Engagement, list the exact files that need to change
2. Are there any other components or API routes that check roles specifically for the Closed Lost / Re-Engagement feature (run `grep -rn "closed-lost\|re-engagement" src/ --include="*.ts" --include="*.tsx"` to confirm)?
3. Will adding `'sga'` to the `showAll` role guard in both API routes be sufficient, or does the frontend also need changes to pass `?showAll=true` for SGA users?
4. Does changing `isAdmin` in `SGAHubContent.tsx` risk affecting goal editing behavior for SGA users?

**Finding:**
```
1. Implementation A is ALREADY COMPLETE. Files that changed (confirmed via code):
   - src/app/dashboard/sga-hub/SGAHubContent.tsx — isAdminOrSGAForClosedLost variable created
     and used in showAllRecords prop and both fetch calls (lines 38, 151, 275, 776-777)
   - Both API routes already allow SGA for showAll (closed-lost implicitly, re-engagement explicitly)
   - No additional API route changes were needed

2. Other components/routes referencing closed-lost/re-engagement:
   - ClosedLostFollowUpTabs.tsx — wrapper component, passes props through
   - ClosedLostTable.tsx — display only, no role checks
   - ReEngagementOpportunitiesTable.tsx — display only, no role checks
   - No other API routes reference these features

3. Adding 'sga' to the showAll role guard was NOT needed in closed-lost (no guard exists there).
   Re-engagement already included 'sga'. The critical change was on the FRONTEND:
   sending showAll=true for SGA users. This was done via isAdminOrSGAForClosedLost.

4. isAdmin was not modified. The new isAdminOrSGAForClosedLost variable is used ONLY
   for closed-lost/re-engagement related props and fetch calls. isAdmin remains unchanged
   for goal editing (line 347: canEdit: isAdmin || isCurrentWeek || isFutureWeek) and
   the quarterly progress AdminQuarterlyProgressView render (line 783: isAdmin ? ...).
```

---

## Phase 3: SGM & Other Role Cross-Check

**Goal:** Ensure our changes don't accidentally affect SGM or other roles.

---

### 3.1 — SGM Filter Isolation

**Command:**
```bash
grep -rn "sgmFilter" src/ --include="*.ts" --include="*.tsx"
```

**Questions:**
1. Does `sgmFilter` go through the same code paths as `sgaFilter` in the funnel metrics API?
2. Would any of our planned changes affect SGM behavior?

**Finding:**
```
1. sgmFilter is used in:
   - api/dashboard/filters/route.ts:67-68 — scopes SGM dropdown to logged-in SGM's name
   - api/dashboard/forecast/route.ts:37-38 — scopes forecast to SGM's name
   - api/dashboard/export-sheets/route.ts:58-59 — scopes exports
   - api/dashboard/open-pipeline/route.ts:48-49 — scopes pipeline

   sgmFilter is NOT in funnel-metrics/route.ts — same pattern as sgaFilter.
   The open-pipeline.ts QUERY file uses local variable named sgmFilter for array params,
   but this is unrelated to permissions.sgmFilter.

2. NONE of our planned changes (Implementation A — closed-lost/re-engagement) touch
   sgmFilter at all. SGM behavior is completely unaffected.
   The funnel-metrics route was already showing all data to both SGM and SGA.
```

---

### 3.2 — Funnel Performance Page Server Component Role Check

**Command:**
```bash
cat src/app/dashboard/page.tsx
# or find the server component for the main dashboard
find src/app/dashboard -maxdepth 1 -name "page.tsx" | xargs cat
```

**Questions:**
1. Does the Funnel Performance page server component do any role-based redirect or data filtering itself, or does all filtering happen at the API layer?
2. Are there any UI elements on the Funnel Performance page that are conditionally shown/hidden based on role? Would SGA seeing all data cause any UI layout issues (e.g., SGM filter dropdowns appearing that shouldn't)?

**Finding:**
```
1. src/app/dashboard/page.tsx is a CLIENT component ('use client' on line 1).
   There are NO server-side role-based redirects — page access is controlled by
   the middleware/layout, not within the page itself.
   All data filtering happens at the API layer.

2. Role-conditional UI elements in page.tsx:
   - isAdmin (line 323): used only for Saved Reports isAdmin prop → affects whether
     admin templates are shown in saved reports UI. NOT related to data filtering.
   - No SGA/SGM specific UI conditional rendering.
   - SGA seeing all data would NOT cause UI layout issues.
   - Filter dropdowns (SGA, SGM, Channel, Source) are shown to all non-recruiter roles.
     The GlobalFilters component renders based on filterOptions, not user role.
```

---

### 3.3 — Funnel Performance Filter Dropdowns for SGA

**Command:**
```bash
grep -rn "sgaFilter\|sgmFilter\|role.*sga\|permissions.*sga" src/components/dashboard/ --include="*.tsx" 2>/dev/null | head -40
```

**Questions:**
1. Are SGA/SGM filter dropdowns on the Funnel Performance page hidden from SGA users today?
2. If SGA sees all data, should they also be able to filter by SGA/SGM, or should those dropdowns remain hidden?
3. Note any component files that conditionally render filters based on role

**Finding:**
```
1. SGA/SGM filter dropdowns on Funnel Performance page — are they hidden from SGA today?
   NO. The filters/route.ts comment at line 65 explicitly states:
   "Note: SGA users see all SGAs in the dropdown (same as admins on funnel performance page)"
   SGA users see the FULL SGA dropdown list (all SGAs).
   Only sgmFilter scopes the SGM dropdown to just the logged-in SGM's name.
   No sgaFilter is applied to the SGA dropdown for SGA role users.

2. If SGA sees all data, should they be able to filter by SGA/SGM?
   Already can filter by SGA — the dropdown is unrestricted for SGA role.
   SGM dropdown would show all SGMs (not scoped) — same as today.
   No UI changes needed for filter dropdowns.

3. Component files with role-conditional filter rendering:
   grep -rn "sgaFilter|sgmFilter|role.*sga|permissions.*sga" src/components/dashboard/ returned:
   NO MATCHES — zero role-based conditionals in dashboard components.
   All filter visibility is controlled by filterOptions from the API, not by role checks
   in the component layer.
```

---

## Phase 4: Implementation Strategy Decision

**To be completed by Russell and Claude Code together after Phase 1–3 findings.**

---

### 4.1 — Funnel Performance Implementation Decision

Based on Phase 1 blast radius findings, select the implementation approach:

**Option A — Global sgaFilter null (Simple)**
- Set `sgaFilter: null` for `sga` role in `permissions.ts`
- Safe ONLY if Phase 1.4 and 1.5 confirm weekly goals and quarterly progress use a different scoping mechanism (session email / DB query) rather than `sgaFilter`
- One-line change in permissions.ts

**Option B — Page-Scoped Filter Override (Surgical)**
- Keep `sgaFilter` set for SGA role
- Modify the funnel metrics API route to ignore `sgaFilter` when role is `sga` (or add an explicit override flag)
- More changes but zero risk to SGA Hub personal tabs

**Decision:**
```
NEITHER Option A nor Option B is needed.

Rationale: Phase 1.3 exploration revealed that funnel-metrics/route.ts ALREADY does not
apply sgaFilter to SGA users. The code contains an explicit comment:
  "Note: SGA/SGM filters are NOT automatically applied to main dashboard"
The same applies to conversion-rates, source-performance, and detail-records routes.

The Funnel Performance "PENDING" item was already implemented as part of commit d23ba60
("feat(sga): expand SGA visibility to all records and all SGAs in dropdown").

Action required: Update the Implementation Status table at the top of this document to
mark Funnel Performance as COMPLETE. No code changes needed.

One open question from Phase 1.6: open-pipeline, forecast, and export-sheets still apply
sgaFilter for SGA role. Whether SGA should see all data in those views is out of scope
for this task — Russell to decide separately.
```

---

### 4.2 — Closed Lost / Re-Engagement Implementation Decision

Based on Phase 2 blast radius findings, the changes required are:

**Minimum required changes (to be confirmed by exploration):**
- [ ] `src/app/api/sga-hub/closed-lost/route.ts` — add `'sga'` to showAll role guard
- [ ] `src/app/api/sga-hub/re-engagement/route.ts` — add `'sga'` to showAll role guard
- [ ] `src/app/dashboard/sga-hub/SGAHubContent.tsx` — update `showAllRecords` and fetch logic for SGA role

**Additional changes if needed (per Phase 2.4–2.5 findings):**
- None. Phase 2 exploration confirmed no additional files need changes.

**Decision:**
```
List is COMPLETE — and all items are already done:

✅ src/app/api/sga-hub/closed-lost/route.ts — no showAll role guard exists; SGA was
   already able to use showAll=true via the general role allowlist.
✅ src/app/api/sga-hub/re-engagement/route.ts — 'sga' is already in the showAll guard:
   ['admin', 'manager', 'revops_admin', 'sga']
✅ src/app/dashboard/sga-hub/SGAHubContent.tsx — isAdminOrSGAForClosedLost variable
   already created and used for both showAllRecords prop and fetch calls.

No additional changes discovered. Implementation A is fully complete.
```

---

## Phase 5: Pre-Implementation Verification Checklist

**Complete before running any implementation prompt.**

- [x] All Phase 1 questions answered with actual code snippets
- [x] All Phase 2 questions answered with actual code snippets
- [x] Phase 1.6 blast radius table completed
- [x] Phase 2.6 blast radius assessment completed
- [x] Implementation approach selected (Neither A nor B needed — Funnel Performance already complete)
- [x] No unanswered questions marked `[Claude Code: paste your findings here]`

---

---

# Implementation Guide

> **Do not begin this section until all Exploration Phases above are complete and the Implementation Decision (Phase 4) is made.**

---

## Implementation A: Closed Lost & Re-Engagement (Lower Risk — Do First)

### Files to Modify
1. `src/app/api/sga-hub/closed-lost/route.ts`
2. `src/app/api/sga-hub/re-engagement/route.ts`
3. `src/app/dashboard/sga-hub/SGAHubContent.tsx`

---

### Claude Code Prompt — Implementation A

```
You are implementing a targeted permissions change. Read each file completely before writing any code.

MANDATORY FILE READS (in this order):
1. src/app/api/sga-hub/closed-lost/route.ts
2. src/app/api/sga-hub/re-engagement/route.ts
3. src/app/dashboard/sga-hub/SGAHubContent.tsx

CONTEXT:
- Currently, only admin/manager/revops_admin roles can use showAll=true for Closed Lost and Re-Engagement data
- We want SGA role to also see ALL records (not just their own) in the Closed Lost Follow-Up tab
- This mirrors the current admin experience

CHANGE 1 — closed-lost/route.ts:
Find the block that checks if showAll is requested and gates by role (currently allows only admin/manager/revops_admin).
Add 'sga' to that allowed-roles array so SGAs can also use showAll.
Do NOT change any other logic in this file.

CHANGE 2 — re-engagement/route.ts:
Same change as above — add 'sga' to the showAll role guard array.
Do NOT change any other logic in this file.

CHANGE 3 — SGAHubContent.tsx:
Find the isAdmin variable definition. Do NOT modify it — goal editing must remain unchanged.
Instead, create a NEW variable: const isAdminOrSGAView = isAdmin || permissions?.role === 'sga';
Use isAdminOrSGAView ONLY in these two places:
  (a) The showAllRecords prop passed to ClosedLostFollowUpTabs
  (b) The onToggleShowAll prop passed to ClosedLostFollowUpTabs
  (c) If the fetch call for closed-lost or re-engagement uses isAdmin to conditionally add ?showAll=true, update those fetch calls to use isAdminOrSGAView instead
Do NOT use isAdminOrSGAView anywhere related to goal editing, quarterly progress admin view, or weekly goals.

VERIFICATION STEPS (run after making changes):
1. npx tsc --noEmit
2. grep -n "isAdminOrSGAView" src/app/dashboard/sga-hub/SGAHubContent.tsx
   — Confirm it appears only in closed-lost-related lines
3. grep -n "isAdmin" src/app/dashboard/sga-hub/SGAHubContent.tsx
   — Confirm isAdmin still exists and is used for goal editing
4. grep -n "'sga'" src/app/api/sga-hub/closed-lost/route.ts
   — Confirm sga appears in the showAll guard
5. grep -n "'sga'" src/app/api/sga-hub/re-engagement/route.ts
   — Confirm sga appears in the showAll guard

Report all verification results before declaring done.
```

---

### Expected Outcome — Implementation A
- SGA users land on the Closed Lost Follow-Up tab and see ALL closed lost records across all SGAs
- SGA users see ALL open re-engagement opportunities across all SGAs
- SGA users can still only edit their own weekly goals
- Admin/manager behavior is completely unchanged
- TypeScript compiles with no errors

---

## Implementation B — Option A: Funnel Performance (Global sgaFilter null)

> **Only use this prompt if Phase 1.6 confirmed that weekly goals and quarterly progress do NOT rely on sgaFilter for user scoping.**

### Files to Modify
1. `src/lib/permissions.ts`

---

### Claude Code Prompt — Implementation B (Option A)

```
You are making a single targeted change to the permissions system.

MANDATORY FILE READS (in this order):
1. src/lib/permissions.ts
2. src/app/api/sga-hub/weekly-goals/route.ts
3. src/app/api/sga-hub/quarterly-progress/route.ts

CONTEXT:
- SGA role currently has sgaFilter set to their name, which scopes all data to only their records
- We want SGA users to see ALL data on the Funnel Performance page
- Exploration confirmed that weekly goals and quarterly progress use session email / DB lookup for scoping, NOT sgaFilter — so removing sgaFilter for SGA is safe

CHANGE — permissions.ts:
In the getPermissionsFromToken() function, find the line:
  sgaFilter: tokenData.role === 'sga' ? tokenData.name : null,
Change it to:
  sgaFilter: null,  // SGA role sees all funnel data (scoping handled per-feature where needed)

If getUserPermissions() also sets sgaFilter for sga role, make the same change there.

Do NOT change sgmFilter or any other filter.
Do NOT change ROLE_PERMISSIONS object.
Do NOT change any other file.

VERIFICATION STEPS:
1. npx tsc --noEmit
2. grep -n "sgaFilter" src/lib/permissions.ts
   — Confirm sgaFilter is now null unconditionally (or only set for non-sga roles)
3. grep -rn "sgaFilter" src/app/api/sga-hub/weekly-goals/route.ts
   — Confirm this route does NOT use sgaFilter (it should use session email or DB lookup)
4. grep -rn "sgaFilter" src/app/api/sga-hub/quarterly-progress/route.ts
   — Same check

Report all verification results before declaring done.
```

---

## Implementation B — Option B: Funnel Performance (Surgical API Override)

> **Use this prompt if Phase 1.6 found that sgaFilter IS used by SGA Hub personal tabs — making a global null unsafe.**

### Files to Modify
1. The funnel metrics API route (path confirmed in Phase 1.3)
2. Any other funnel-specific API routes that apply sgaFilter (from Phase 1.2 list)

---

### Claude Code Prompt — Implementation B (Option B)

```
You are making a targeted change to the funnel metrics API to allow SGA users to see all data.

MANDATORY FILE READS (in this order):
1. src/lib/permissions.ts
2. [exact path of funnel metrics route from Phase 1.3 findings]
3. Any other API routes identified in Phase 1.2 that apply sgaFilter to funnel-specific data

CONTEXT:
- SGA role has sgaFilter set to their name in permissions
- We cannot remove sgaFilter globally because SGA Hub personal tabs depend on it
- We want ONLY the Funnel Performance page APIs to ignore sgaFilter for SGA users
- SGA Hub goal/progress APIs must continue to scope to the individual SGA

CHANGE — Funnel metrics route(s):
Find where sgaFilter from permissions is applied to the query.
Add a role check: if permissions.role === 'sga', do not apply sgaFilter (treat it as null for this route only).

The pattern should look like:
  const effectiveSgaFilter = permissions.role === 'sga' ? null : permissions.sgaFilter;
  // Then use effectiveSgaFilter instead of permissions.sgaFilter when building query filters

Apply this same pattern to every funnel-related API route identified in Phase 1.2 that should show all-data to SGA.
Do NOT apply this to SGA Hub routes (weekly-goals, quarterly-progress, closed-lost, re-engagement, etc.)

VERIFICATION STEPS:
1. npx tsc --noEmit
2. grep -n "effectiveSgaFilter\|role.*sga.*null" [funnel route file]
   — Confirm the override is present
3. grep -rn "sgaFilter" src/app/api/sga-hub/weekly-goals/route.ts
   — Confirm this file is UNCHANGED
4. grep -rn "sgaFilter" src/app/api/sga-hub/quarterly-progress/route.ts
   — Confirm this file is UNCHANGED

Report all verification results before declaring done.
```

---

## Post-Implementation Testing Checklist

### Manual QA — SGA User Login Required

**Funnel Performance Page:**
- [ ] SGA user sees total prospect/contacted/MQL/SQL/SQO/joined counts matching admin view
- [ ] SGA user scorecards are not filtered to their name
- [ ] Date range filters work correctly for SGA user
- [ ] No JavaScript console errors on page load

**SGA Hub — Closed Lost Tab:**
- [ ] SGA user sees ALL closed lost records (not just their own)
- [ ] Record count matches admin view for same date/filter state
- [ ] SGA user can click records to open detail modal
- [ ] Export CSV includes all records

**SGA Hub — Re-Engagement Tab:**
- [ ] SGA user sees ALL open re-engagement opportunities
- [ ] Count matches admin view

**SGA Hub — Weekly Goals Tab (regression check):**
- [ ] SGA user still sees ONLY their own weekly goals
- [ ] SGA user can still edit their own goals
- [ ] No other SGAs' goals are visible

**SGA Hub — Quarterly Progress Tab (regression check):**
- [ ] SGA user still sees ONLY their own quarterly progress
- [ ] Admin quarterly overview is NOT shown to SGA

**Admin User Regression:**
- [ ] Admin funnel performance page unchanged
- [ ] Admin closed lost / re-engagement unchanged
- [ ] Admin goal editing unchanged

**Manager User Regression:**
- [ ] Manager funnel performance page unchanged
- [ ] Manager SGA Hub behavior unchanged

---

## Rollback Plan

If any regression is found:

**For Implementation A (Closed Lost / Re-Engagement):**
```bash
git diff src/app/api/sga-hub/closed-lost/route.ts
git diff src/app/api/sga-hub/re-engagement/route.ts
git diff src/app/dashboard/sga-hub/SGAHubContent.tsx
git checkout -- src/app/api/sga-hub/closed-lost/route.ts
git checkout -- src/app/api/sga-hub/re-engagement/route.ts
git checkout -- src/app/dashboard/sga-hub/SGAHubContent.tsx
```

**For Implementation B (Option A — permissions.ts):**
```bash
git checkout -- src/lib/permissions.ts
```

**For Implementation B (Option B — funnel route):**
```bash
git checkout -- [funnel route file path]
```

---

## Document Completion Checklist

- [x] Phase 1: All 6 sections answered
- [x] Phase 2: All 6 sections answered
- [x] Phase 3: All 3 sections answered
- [x] Phase 4: Implementation approach selected with rationale
- [x] Phase 5: Pre-implementation checklist signed off
- [x] Implementation A executed and verified (already in codebase — commit d23ba60)
- [x] Implementation B: N/A — Funnel Performance already complete, no code changes needed
- [ ] Post-implementation QA checklist completed (manual SGA login test still required)
- [ ] No TypeScript compilation errors (run: npx tsc --noEmit)
- [x] Changes committed with descriptive commit message (d23ba60)

---

*Document generated for Savvy Wealth RevOps Dashboard — SGA Permissions Expansion*  
*Companion to Claude Projects planning session — execute exploration with Claude Code + Cursor.ai BigQuery MCP*
