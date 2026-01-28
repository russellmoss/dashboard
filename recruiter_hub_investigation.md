# Recruiter Hub – Investigation & Implementation Plan

This document defines the Recruiter Hub feature for the Savvy Funnel Analytics Dashboard: scope, data model, permissions, UI, and a step-by-step implementation plan suitable for agentic execution. All references to the codebase and BigQuery are accurate as of the investigation date.

---

## 1. Goals & Scope

- **New main page: “Recruiter Hub”** – A dashboard where:
  - **Recruiters** (new role) see only Prospects and Opportunities linked to **their** External Agency.
  - **Admins** see all Prospects and Opportunities that have *any* External Agency, with the ability to sort/filter by External Agency.
- **Two lists:** (1) **Prospects** (lead-level, with External Agency); (2) **Opportunities** (opportunity-level, with External Agency).
- **Record scope:** Only records where `External_Agency__c` is set (non-null, non-empty). Include both **Recruiting** and **Re-engagement** record types (same as `vw_funnel_master` Opp_Base: `RecordTypeId IN ('012Dn000000mrO3IAI', '012VS000009VoxrYAC')`).
- **Drilldown:** Each row is drillable to a full-record modal (same pattern as Funnel Performance / SGA Hub) with a Salesforce link.

---

## 2. Permissions & User Model

### 2.1 Current State

- **Roles** (Prisma `User.role`, `src/lib/permissions.ts`, `src/types/user.ts`): `admin`, `manager`, `sgm`, `sga`, `viewer`.
- **Permission pattern:** `getUserPermissions(email)` returns `role`, `allowedPages`, `sgaFilter` (for SGA), `sgmFilter` (for SGM), `canExport`, `canManageUsers`.
- **Sidebar** (`src/components/layout/Sidebar.tsx`): Renders nav from `PAGES`; visibility is gated by `allowedPages` from session permissions.
- **Page IDs in use:** 1 (Funnel Performance), 3 (Open Pipeline), 7 (Settings), 8 (SGA Hub), 9 (SGA Management), 10 (Explore), 11 (e.g. reserved). Recruiter Hub should use a **new page ID** (e.g. **12**).

**Phase 2 validation (codebase): current Prisma User fields**

From `prisma/schema.prisma`, the `User` model currently includes:
- `id`, `email`, `name`, `passwordHash?`, `role` (string), `isActive`, `createdAt`, `updatedAt`, `createdBy?`

There is **no existing `externalAgency` field**.

### 2.2 New Role: Recruiter

- Add role **`recruiter`** everywhere roles are defined or checked:
  - `prisma/schema.prisma`: `User.role` (string; no enum, so just allow `"recruiter"` in validation).
  - `src/types/user.ts`: Extend `User`, `UserPermissions`, `SafeUser`, `UserInput` to include `'recruiter'`.
  - `src/lib/permissions.ts`: Add `recruiter` to `ROLE_PERMISSIONS` with:
    - **`allowedPages: [7, 12]`** — Settings (7) and Recruiter Hub (12) **ONLY**. Recruiters are restricted to only their dedicated hub and settings to maintain focus and data isolation.
    - `canManageUsers: false`, **`canExport: true`** (recruiters can export their agency's data).
  - Add **`recruiterFilter: string | null`** to the return type of `getUserPermissions`: when `role === 'recruiter'`, set `recruiterFilter` to the user’s linked External Agency name; otherwise `null`. Use this in Recruiter Hub APIs to restrict data.

### 2.3 Linking a User to an External Agency

- **Storage:** Add optional field to Prisma `User` model, e.g. **`externalAgency`** (String?, nullable). This stores the **External Agency name** (same value as `External_Agency__c` in Salesforce/BigQuery) so that:
  - Recruiter users see only records where `External_Agency__c` matches their `externalAgency`.
  - Admins can create/edit a recruiter and set this field.
- **UI for creating/editing Recruiter users (Settings → User Management):**
  - When role is **Recruiter**, show:
    - **External Agency:** Either:
      - **Manual:** Free-text input for `External_Agency__c` name, or
      - **Dropdown:** Select from distinct `External_Agency__c` values currently in Salesforce (Lead + Opportunity). Optionally allow “Other” that switches to manual entry.
    - Persist the chosen value in `User.externalAgency`.
  - Validation: For role `recruiter`, require `externalAgency` to be non-empty before save.
- **APIs:** User create/update (`POST /api/users`, `PUT /api/users/[id]`) must accept and persist `externalAgency` when role is `recruiter`. Optionally, an endpoint like `GET /api/recruiter-hub/external-agencies` can return distinct agency names for the dropdown (see Data & APIs below).

### 2.4 Authentication & Provisioning Implications (Recruiters)

**Phase 2 validation (codebase): OAuth users are never auto-created.**

In `src/lib/auth.ts` (NextAuth callbacks):
- For Google sign-in, the user must already exist in Postgres (`getUserByEmail(email)`), otherwise sign-in redirects with `error=NotProvisioned`.
- This means **all recruiter users must be provisioned via User Management** (or an admin seed process) before they can sign in with Google.

**Google OAuth Domain Configuration:**

Currently, Google OAuth is restricted to `@savvywealth.com` in `src/lib/auth.ts`. To allow external recruiters to use Google sign-in:

1. **Google Cloud Console Configuration:**
   - Navigate to: https://console.cloud.google.com/auth/clients/644017037386-varan6og6ou96mk4tql8d8mmcrkrof37.apps.googleusercontent.com?project=savvy-pirate-extension
   - Under "Authorized domains" or OAuth consent screen, add recruiter agency domains as needed
   - Example domains to add: Agency email domains (e.g., zerostaffing.com, ucare.com, etc.)

2. **Code Change in `src/lib/auth.ts`:**
   - Current restriction: Email must end with `@savvywealth.com`
   - Update to: Check if email domain is in an allowlist OR if user exists in database with `role='recruiter'`
   - **Recommended approach:** Allow Google OAuth for ANY email that has a matching User record in the database (since recruiters must be pre-provisioned anyway, this is secure).

   Example logic change:
   ```typescript
   // Instead of checking domain, check if user exists in DB
   const existingUser = await getUserByEmail(profile.email);
   if (!existingUser) {
     // User not provisioned - redirect with error
     return '/login?error=NotProvisioned';
   }
   // User exists, allow sign-in regardless of domain
   ```

3. **Recruiter Provisioning Flow (unchanged):**
   - Admin creates recruiter user in User Management (provisions email)
   - Recruiter can then sign in via Google OAuth (if their email is Gmail/Google Workspace)
   - OR recruiter can use email/password if they prefer or don't have Google account

**Login redirect behavior (current):**
- `src/app/login/page.tsx` redirects **SGA → `/dashboard/sga-hub`**, everyone else → `/dashboard`.
- Recruiter redirect to `/dashboard/recruiter-hub` after login is **REQUIRED** (see Phase A Step 5).

### 2.5 Phase 4: Settings / User Management Integration (Findings)

**UserModal (`src/components/settings/UserModal.tsx`):**
- Role is a single `<select>` with options: admin, manager, sgm, sga, viewer (no recruiter yet). There is **no conditional field rendering** based on role today.
- **External Agency Field (when role = 'recruiter'):** Implement as a **combo field** with dropdown + "Other" option:
  1. **Primary UI:** Dropdown populated from `/api/recruiter-hub/external-agencies` — shows all 32+ existing agencies from BigQuery; includes an **"Other (enter manually)"** option at the bottom.
  2. **"Other" behavior:** When "Other" is selected, show a text input field below the dropdown; text input is required (cannot save with empty "Other"); placeholder: "Enter agency name exactly as it appears in Salesforce".
  3. **Form state:** `externalAgency: string | null`; `externalAgencyIsOther: boolean` (true when "Other" selected); `externalAgencyCustom: string` (value when "Other" selected).
  4. **On save:** If dropdown selection (not "Other"): use dropdown value; if "Other": use custom text input value (trimmed).
  5. **Validation:** When role is 'recruiter', externalAgency is required; show error: "External Agency is required for Recruiter role".
- **Insertion point:** After the Role select block and before the "Active (can log in)" checkbox.

**User API (POST /api/users, PUT /api/users/[id]):**
- POST destructures only `email, name, password, role, isActive`; PUT passes the full `body` to `updateUser`. `createUser` / `updateUser` in `src/lib/users.ts` do not accept or persist `externalAgency`; they only handle name, role, password, isActive (updateUser builds updateData only from those).
- **Validation approach for externalAgency:** (1) In both route handlers, destructure `externalAgency` from body. (2) When `role === 'recruiter'`, require non-empty `externalAgency` (after trim); return 400 with a clear message if missing. (3) Pass `externalAgency` into `createUser` / `updateUser` and in lib/users include it in Prisma create/update data. (4) When role is changed from recruiter to another role, either clear `externalAgency` in the same update or leave it (document product preference; clearing avoids stale data).

**Settings page (`src/app/dashboard/settings/page.tsx`):**
- Renders two blocks: (1) "My Account" with "Change My Password" (no permission check); (2) `UserManagement` only when `permissions?.canManageUsers`. So **recruiters already see only password change**: they do not have `canManageUsers`, so the User Management section is hidden. No code change needed for recruiter restriction.

**Sidebar (`src/components/layout/Sidebar.tsx`):**
- Page visibility: `allowedPages = permissions?.allowedPages || [1, 2]`; `filteredPages = PAGES.filter(page => allowedPages.includes(page.id))`. Only pages whose `id` is in `allowedPages` are shown. Recruiter role has **`allowedPages: [7, 12]`** only (Settings + Recruiter Hub). Recruiter Hub is not yet in the `PAGES` array; implementation adds `{ id: 12, name: 'Recruiter Hub', href: '/dashboard/recruiter-hub', icon: Briefcase }`. **Verification:** allowedPages correctly hides any page not in the array.

### 2.6 Phase 5: Implementation Readiness (Migration, BQ View, Test Data)

**Migration workflow (Q31–Q32):**
- **prisma/migrations** contains only **manual** SQL files (`manual_*.sql`), not Prisma-generated migration directories. **package.json** has no `prisma migrate` script; it has `postinstall` and `build` running `prisma generate` only. So schema changes are applied either by (1) **Prisma Migrate:** run `npx prisma migrate dev --name add_user_external_agency` after adding `externalAgency` to `schema.prisma` (this creates a new migration dir and applies it), or (2) **Manual SQL:** add a file e.g. `prisma/migrations/manual_user_external_agency_migration.sql` and run it (e.g. `psql $DATABASE_URL -f prisma/migrations/manual_user_external_agency_migration.sql`), then run `npx prisma generate` so the client reflects the new column.
- **Idempotent migration (column already exists):** For manual SQL, use PostgreSQL `ADD COLUMN IF NOT EXISTS` so re-running is safe:  
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "externalAgency" TEXT;`  
  If using `prisma migrate dev`, Prisma will fail if the column already exists (migration already applied); re-running after applying once is safe.

**BigQuery view deployment (Q33–Q34):**
- **View SQL** is maintained in **`views/vw_funnel_master.sql`** (repo is source of truth; docs reference this file). There is **no automated deploy script** in the repo for pushing the view to BigQuery; deployment is **manual** (e.g. run the SQL in BigQuery console, or use `bq` CLI against the target project/dataset, e.g. `savvy-gtm-analytics.Tableau_Views`). Document exact steps with your team (project, dataset, replace view).
- **Adding columns (Next_Steps__c, NextStep):** All app queries use **explicit column lists** when selecting from the view (e.g. `record-detail.ts`, `detail-records.ts`, `export-records.ts` base_select, semantic-layer, etc.). There is **no `SELECT * FROM vw_funnel_master`** in the codebase; `export-records.ts` uses `SELECT *` only from **CTEs** (e.g. `SELECT * FROM contacted_cohort`), whose columns come from an explicit `base_select` list. So adding new columns to the view is **additive** and will not break existing queries; Recruiter Hub (and optional record-detail) will add the new columns to their SELECT lists.

**Test data (Q35–Q36):**
- **Test agency:** Phase 1 data: **Zero Staffing** (17 Lead, 3 Opportunity) and **UCare** (61 Lead, 38 Opportunity) both have diverse records. **Zero Staffing** is a good candidate for a test recruiter (smaller set); **UCare** for fuller testing.
- **Test users:** **prisma/seed.js** creates admin, manager, and SGA users only; there is **no recruiter** user. Add to implementation plan: create a test recruiter (e.g. `recruiter-test@savvywealth.com`, role `recruiter`, `externalAgency: 'Zero Staffing'`) either in seed or via a one-off script / User Management after deploy.

### 2.7 Phase 6: Edge Cases & Error Handling

**Data edge cases (Q37–Q38):**
- **Special characters in External_Agency__c (Q37):** Recruiter Hub and external-agencies APIs must use **parameterized BigQuery** (e.g. `@agency` bound to `recruiterFilter` or user input); this avoids SQL injection. For display and for `User.externalAgency` storage, **trim** values; optionally run the Phase 6 Q37 query (Lead table: `WHERE External_Agency__c LIKE '%"%' OR ... LIKE "%'%" OR ... LIKE '%<%'`) to see if any values contain quotes or angle brackets—if so, document escaping/sanitization for UI (e.g. React text content is safe; HTML attributes or CSV export may need escaping). No string concatenation of agency into SQL.
- **Orphaned recruiters (Q38):** If an agency is renamed or removed in Salesforce, recruiters with that `externalAgency` will see no (or wrong) data. Options: (1) **Admin notification:** periodic check or “agency no longer in BQ” warning when loading Recruiter Hub; (2) **Validation:** on recruiter login or Recruiter Hub load, optionally validate that `externalAgency` still exists in distinct BQ list and show a banner or prompt admin to update user; (3) **Allow edit:** admins can change `User.externalAgency` so they can fix without recreating the user. Add to implementation plan: at least (3); (1) or (2) as product preference.

**Permission edge cases (Q39–Q40):**
- **Role change from recruiter (REQUIRED behavior):** When an admin changes a user’s role **from** recruiter **to** another role, **clear `externalAgency`** in the same update to avoid stale data and avoid leaking recruiter semantics. Document in User API (PUT): if `role` in body is not `'recruiter'` and the existing user’s role was recruiter, set `body.externalAgency = null` before calling updateUser.
- **Direct URL access (REQUIRED):** If a recruiter types a URL directly (e.g. `/dashboard/pipeline`) for a page not in their `allowedPages`, redirect them to `/dashboard/recruiter-hub`. **Implementation — Layout-level guard:** Create or update `src/app/dashboard/layout.tsx` (or a server wrapper) to: get session and permissions; map pathname to page ID (`/dashboard`→1, `/dashboard/pipeline`→3, `/dashboard/settings`→7, `/dashboard/sga-hub`→8, `/dashboard/sga-management`→9, `/dashboard/explore`→10, `/dashboard/recruiter-hub`→12); if currentPageId is set and `!permissions.allowedPages.includes(currentPageId)`, redirect recruiter → `/dashboard/recruiter-hub`, sga → `/dashboard/sga-hub`, else → `/dashboard`. **Alternative:** Each page checks its own access (current SGA Hub/Management pattern). **(Legacy context)** **Middleware** (`src/middleware.ts`) only enforces **session presence** for `/dashboard/*` and `/api/dashboard/*`; it does **not** check `allowedPages` or role. **Page-level protection:** SGA Management and SGA Hub are **server** components that call `getServerSession` → `getUserPermissions` → **role** check → `redirect('/dashboard')` if not allowed. Main dashboard and Pipeline are **client** components and do **not** redirect by role or allowedPages. So a recruiter with a valid session who types `/dashboard/pipeline` or `/dashboard` would currently get the page (sidebar would not show the link, but the URL would still load). **Recruiter Hub page** must follow the SGA Hub pattern: server component, session check, then **allowedPages.includes(12)** (or equivalent) and redirect to `/dashboard` if not allowed. **Recommendation:** Add to implementation plan that the recruiter-hub page enforces access (session + page 12 in allowedPages). Optionally add a **layout-level or shared guard** that maps pathname to page ID and redirects when the current user’s `allowedPages` does not include that page ID, so direct URLs to other dashboard pages (e.g. pipeline, explore) also redirect for recruiters; otherwise accept that direct URL can show the page while APIs still enforce permissions and data filters.

### 2.8 Phase 7: Performance & Scale Considerations

**Query performance (Q41–Q42):**
- **Record count (Q41):** Phase 1 already reported **244** records in `vw_funnel_master` with non-empty `External_Agency__c` (238 with prospect, 133 with opportunity). Well under 10k; no mandatory pagination for initial launch, but **still implement a server-side limit** (e.g. 1000 or 5000) in prospects/opportunities APIs and **client-side 50-per-page** pagination in the UI so behavior is consistent with other tables and ready for growth.
- **Indexes (Q42):** BigQuery **views have no indexes**; they are computed at query time. Underlying tables (Lead, Opportunity) are columnar; BQ does not use traditional row indexes. Filtering by `External_Agency__c` will scan the view (or underlying tables in the view definition). At ~244 rows this is trivial; if agency-scoped data grows significantly, performance is still typically acceptable; partitioning of source tables is a data-warehouse concern, not app code.

**UI performance (Q43–Q44):**
- **Pagination pattern (Q43):** **DetailRecordsTable** uses **client-side pagination**: it receives a full `records` array (up to API limit, e.g. 10000 for detail-records), then `sortedRecords.slice(startIndex, endIndex)` with **50 records per page** and currentPage state. The dashboard detail-records API uses `body.limit || 10000`. **Recruiter Hub recommendation:** Use the same pattern—prospects/opportunities APIs return up to a cap (e.g. 1000 or 5000); the Recruiter Hub table component (or reused DetailRecordsTable with adapted columns) does **client-side 50-per-page** pagination. At 244 rows, a single fetch + client-side pagination is sufficient; cap the API for future scale.
- **External Agency dropdown caching (Q44):** The list of distinct agencies is small (~32 values) and changes only when new agencies appear in Salesforce (infrequent). The app uses **Next.js `unstable_cache`** via `cachedQuery` in `src/lib/cache.ts` with tags (DASHBOARD, SGA_HUB) and TTL (e.g. 4h for dashboard, 2h for detail records). The dashboard filters API (`/api/dashboard/filters`) is `force-dynamic` and does not cache at the route level; caching is at the **query layer** where `cachedQuery` wraps BigQuery calls. **Recommendation:** Implement `getDistinctExternalAgencies()` (or equivalent) and wrap it with `cachedQuery` using a tag (e.g. add `RECRUITER_HUB` to `CACHE_TAGS` or reuse `DASHBOARD`) and TTL of 4 hours (or 1h if agencies are updated more often). Optionally expose a small external-agencies API that calls this cached query so the UserModal dropdown stays fast and avoids hitting BQ on every open.

### 2.9 Phase 8: Final Verification & Documentation

**File checklist (Q45):**
- **Existing paths (verified):** `prisma/schema.prisma`, `src/types/user.ts`, `src/lib/permissions.ts`, `src/components/layout/Sidebar.tsx`, `views/vw_funnel_master.sql`, `src/lib/queries/record-detail.ts`, `src/types/record-detail.ts`, `src/app/api/users/route.ts`, `src/app/api/users/[id]/route.ts`, `src/components/settings/UserModal.tsx`, `src/lib/api-client.ts` all exist. Structure and imports are as used elsewhere (e.g. SGA Hub, dashboard).
- **New paths (to create):** `src/app/api/recruiter-hub/external-agencies/route.ts`, `src/app/api/recruiter-hub/prospects/route.ts`, `src/app/api/recruiter-hub/opportunities/route.ts`; `src/lib/queries/recruiter-hub-prospects.ts`, `src/lib/queries/recruiter-hub-opportunities.ts` (and optional `getDistinctExternalAgencies` in a shared module or one of these); `src/app/dashboard/recruiter-hub/page.tsx`, `src/app/dashboard/recruiter-hub/RecruiterHubContent.tsx` (content component in the same folder as page, same pattern as `sga-hub/SGAHubContent.tsx`). **Correction:** In Section 8 table, "RecruiterHubContent.tsx" should be read as `src/app/dashboard/recruiter-hub/RecruiterHubContent.tsx` (full path). Tables/Filters: no single file—either new components under `src/components/` (e.g. `recruiter-hub/`) or reuse DetailRecordsTable/PipelineFilters; document in Phase F.

**Dependencies (Q46):**
- **package.json:** Recruiter Hub uses existing stack (Next.js, Prisma, BigQuery, NextAuth, bcrypt, etc.). **No new npm packages required.** All recruiter-hub APIs and queries use `@/lib/bigquery`, `@/lib/prisma`, `@/lib/permissions`, existing types and cache—no additional dependencies.

**Documentation updates (Q47):**
- **ARCHITECTURE.md:** (1) In **Authentication & Permissions**, add role `recruiter` to the role union and document `allowedPages: [7, 12]` only, `recruiterFilter`, `canExport: true`, and `User.externalAgency`. (2) Add **Recruiter Hub** to the pages table (page ID 12, path `/dashboard/recruiter-hub`, which roles can access). (3) Add a short subsection (e.g. under "Core Dashboard Features" or new "Recruiter Hub") describing the feature: recruiter-scoped prospects/opportunities by External Agency, two tables, drilldown modal, Settings/User Management for External Agency when role is recruiter.
- **GLOSSARY.md:** Add entries: **Recruiter** (role; users who see only prospects/opportunities for their External Agency), **External Agency** (Salesforce field `External_Agency__c`; agency name linking recruiters to records), **Recruiter Hub** (dashboard page for recruiter-scoped prospects and opportunities). Optionally document **Open/Closed** for prospects (Conversion_Status) and opportunities (StageName) as in Section 4.2 and 5.2.
- **API documentation:** If the project maintains explicit API docs, add recruiter-hub routes (`GET /api/recruiter-hub/external-agencies`, `POST /api/recruiter-hub/prospects`, `POST /api/recruiter-hub/opportunities`) and note recruiterFilter server-side override. Phase G step 21 already lists GLOSSARY; add ARCHITECTURE and any API doc tasks to the implementation plan.

**READMEs (Q48):**
- **src/app/dashboard/:** No README files; only `explore/help.md` and page/layout components. **src/components/:** No README files. **No README updates required** for Phase 8 unless the team adds a `src/app/dashboard/recruiter-hub/README.md` or similar for the feature.

---

## 3. Data Model & BigQuery

### 3.1 External_Agency__c in vw_funnel_master

- **Already present:** In `views/vw_funnel_master.sql`:
  - **Lead_Base:** `External_Agency__c AS Lead_External_Agency__c` from `savvy-gtm-analytics.SavvyGTMData.Lead`.
  - **Opp_Base:** `External_Agency__c AS Opp_External_Agency__c` from `savvy-gtm-analytics.SavvyGTMData.Opportunity`.
  - **Combined:** `COALESCE(o.Opp_External_Agency__c, l.Lead_External_Agency__c) AS External_Agency__c`.
- So the view already exposes a single **`External_Agency__c`** per row. Recruiter Hub filters and columns should use this.

**Phase 1 validation (BigQuery):** In `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`, the column exists exactly as **`External_Agency__c`** (STRING) with that casing (not lowercased).

### 3.2 Next_Steps__c (Lead) and NextStep (Opportunity)

- **Lead table** (BigQuery `SavvyGTMData.Lead`): Column **`Next_Steps__c`** (STRING) exists.
- **Opportunity table** (BigQuery `SavvyGTMData.Opportunity`): Column **`NextStep`** (STRING) exists.
- **vw_funnel_master:** These fields are **not** currently in the view. They must be added so that:
  - Prospect table can show **Next_Steps__c** (from Lead).
  - Opportunity table can show **NextStep** (from Opportunity).

**Phase 1 validation (BigQuery): field completeness and sample formats**

- **Lead.Next_Steps__c completeness**:
  - `total_leads`: **95,322**
  - `has_next_steps`: **28,736**
  - `null_next_steps`: **66,586**
- **Opportunity.NextStep completeness** *(Recruiting + Re-engagement record types only)*:
  - `total_opps`: **2,771**
  - `has_next_step`: **1,966**
  - `null_next_step`: **805**
- **Sample `Next_Steps__c` values** show that content can be:
  - Short codes / numbered steps (e.g. `"1"`, `"2"`, `"(LIC), 1"`, `"NI (LC, LM)"`)
  - Free-text sentences (e.g. `"Emailed saying no portable book"`)
  - Long timeline strings with dates and separators (e.g. `"Nurture | 12.9 T5 | 12.4 T3 | 11.26 T2 | 11.25 T1 | 11.20 LIM"`)

**UI implication:** The Next Steps columns should allow wrapping or a tooltip/expanded cell UI; do not assume short content.

**Required view changes:**

1. **Lead_Base:** Add  
   `Next_Steps__c AS Lead_Next_Steps__c`  
   (select from `savvy-gtm-analytics.SavvyGTMData.Lead`).
2. **Opp_Base:** Add  
   `NextStep AS Opp_NextStep`  
   (select from `savvy-gtm-analytics.SavvyGTMData.Opportunity`).
3. **Combined:** Add to the SELECT list:
   - `l.Lead_Next_Steps__c AS Next_Steps__c` (for lead/combined row; null when row is opportunity-only).
   - `o.Opp_NextStep AS NextStep` (for opportunity; null when row is lead-only).
4. **Final:** Pass through `Next_Steps__c` and `NextStep` (no transformation needed). Ensure they are in the final SELECT so that querying `vw_funnel_master` exposes them.

After this, Recruiter Hub queries against `vw_funnel_master` can select:
- For prospect-focused rows: `External_Agency__c`, `SGA_Owner_Name__c`, advisor name, `Next_Steps__c`.
- For opportunity-focused rows: `External_Agency__c`, `SGM_Owner_Name__c`, `StageName`, advisor name, `NextStep`.

Note: For `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`, Phase 1 confirmed the view exposes mixed-casing column names like `External_Agency__c`, `Full_Opportunity_ID__c`, `Conversion_Status`, etc. When adding `Next_Steps__c` and `NextStep`, keep the same naming convention in the view so downstream queries can reference them consistently.

### 3.3 Record Types

- **Recruiting:** `RecordTypeId = '012Dn000000mrO3IAI'`.
- **Re-engagement:** `RecordTypeId = '012VS000009VoxrYAC'`.
- **vw_funnel_master** Opp_Base already filters `RecordTypeId IN ('012Dn000000mrO3IAI', '012VS000009VoxrYAC')`. Recruiter Hub should include all rows from the view that have `External_Agency__c` set; no extra record-type filter is needed beyond what the view already does (opportunity rows are already Recruiting or Re-engagement). For **prospects**, include both lead-only and converted rows where `External_Agency__c` is non-null (lead can come from Lead.External_Agency__c or from the converted opportunity).

### 3.4 Distinct External Agency List

- **Source:** Distinct `External_Agency__c` from:
  - Leads: `savvy-gtm-analytics.SavvyGTMData.Lead` WHERE `External_Agency__c IS NOT NULL AND TRIM(External_Agency__c) != ''`
  - Opportunities: `savvy-gtm-analytics.SavvyGTMData.Opportunity` WHERE `External_Agency__c IS NOT NULL AND TRIM(External_Agency__c) != ''` AND `RecordTypeId IN (...)`
- **API:** Implement e.g. `GET /api/recruiter-hub/external-agencies` that runs a single BigQuery query (UNION of distinct values from Lead and Opportunity) and returns a string array for the dropdown. Cache if desired (e.g. same TTL as other dashboard lists).

**Phase 1 validation (BigQuery): distinct agencies + counts**

Lead agencies (non-empty) with counts:

- UCare: 61
- Storm2: 17
- Zero Staffing: 17
- Muriel: 17
- Diamond Consulting: 17
- Goodwin Recruiting: 16
- BrokerHunter: 16
- Professions: 9
- Elanden: 8
- Urgent Partners: 6
- Uptick: 5
- W3Global: 5
- Recruiter 360: 4
- Selby Jennings: 4
- QntmLogic: 4
- Full Circle Advisor Solutions: 3
- Entech: 3
- Coda: 3
- Merkle: 3
- Otterbrook: 3
- Freelance Recruiters: 2
- Career Solutions: 2
- TruTalent: 2
- JCW: 2
- Club Level Consulting: 2
- Talent Staffing Solutions: 1
- Rocklyn: 1
- Immensetec: 1
- Essence Search: 1
- Infinia: 1
- Occulus: 1
- Bluebix: 1

Opportunity agencies (non-empty) with counts:

- UCare: 38
- Muriel: 15
- Diamond Consulting: 13
- Storm2: 12
- Goodwin Recruiting: 9
- BrokerHunter: 8
- Professions: 5
- Uptick: 3
- Full Circle Advisor Solutions: 3
- Zero Staffing: 3
- Urgent Partners: 3
- W3Global: 2
- Entech: 2
- Merkle: 2
- Coda: 2
- Infinia: 1
- Essence Search: 1
- Rocklyn: 1
- Otterbrook: 1
- JCW: 1
- Recruiter 360: 1
- Selby Jennings: 1
- Club Level Consulting: 1
- Bluebix: 1
- Immensetec: 1
- Elanden: 1
- Career Solutions: 1

Distinct counts (Phase 1):
- Lead distinct agencies: **32**
- Opportunity distinct agencies: **27**

**Lead vs Opportunity coverage differences:** In the current data, every opportunity agency also appears in leads; leads have additional agencies that do not appear in opportunities (currently: `Freelance Recruiters`, `TruTalent`, `Talent Staffing Solutions`, `Occulus`, `QntmLogic`, and potentially others depending on future refresh).

**Casing/spelling consistency check:** No casing/spelling duplicates were found in Lead after normalizing with `LOWER(TRIM(External_Agency__c))` (0 rows returned). This suggests we can treat `External_Agency__c` as case-stable for now.

**Implementation recommendation:** Still apply `TRIM()` in distinct queries and in recruiter scoping comparisons, because whitespace inconsistencies can exist even when casing is stable.

---

## 4. Prospect Table (Recruiter Hub)

### 4.1 Scope

- **Rows:** All records in `vw_funnel_master` where **`External_Agency__c` IS NOT NULL** (and optionally `TRIM(External_Agency__c) != ''`). Include both Recruiting and Re-engagement; the view already restricts opportunity side to those record types. For prospect list we care about “lead-level” view: one row per lead/prospect, so prefer using `primary_key` from the view and filtering so we get prospects (e.g. lead rows or first-row-per-lead logic as in existing detail tables). In practice: query the view with `WHERE External_Agency__c IS NOT NULL` and, for “prospect” semantics, restrict to rows that represent a prospect (e.g. not only opportunity-only rows without a lead – product may want only rows that have a lead side, or include converted ones; clarify with product). Simplest: include all view rows with non-null `External_Agency__c` and let filters (Prospect Stage, Open/Closed) narrow the list.

### 4.2 Filters (Picklists)

- **Prospect Stage:** Multi-select or single-select of **MQL**, **SQL**, **SQO** (and optionally “Prospect” / “Contacted” if product wants). Map to view logic:
  - **MQL:** `is_mql = 1` (and optionally not yet SQL if desired).
  - **SQL:** `is_sql = 1`.
  - **SQO:** `is_sqo = 1` (and use primary-opp-row logic if deduping).
  For “all stages” default, do not filter by stage.
- **Open vs Closed Prospects:**
  - **Open:** Prospects that are **not** closed and **not** converted (to opportunity) in the sense of “still a prospect.” In `vw_funnel_master`, **Conversion_Status** is derived: `'Open' | 'Joined' | 'Closed'`. For prospect table, “Open” = `Conversion_Status = 'Open'` (and optionally exclude converted leads if you want only pre-SQL; otherwise “Open” = not Closed and not Joined).
  - **Closed:** `Conversion_Status IN ('Closed', 'Joined')` or equivalent (Disposition set or lead closed or opportunity closed/joined).
- **External Agency (Admin only):** Multi-select dropdown of all agencies; hidden for recruiters. Default: All selected.
- **Default:** Pre-filter to **all stages** and **Open Prospects only** (i.e. `Conversion_Status = 'Open'`).

### 4.3 Columns (Prospect Table)

- Advisor name  
- External Agency (`External_Agency__c`)  
- SGA name (`SGA_Owner_Name__c`)  
- Next_Steps__c (from Lead – use the new view column, e.g. `Next_Steps__c` or `next_steps__c`)  

Optional: Stage (TOF_Stage or Prospect Stage), Conversion_Status, or other fields for context.

### 4.4 Behavior

- **Recruiter:** Filter rows by `External_Agency__c = recruiterFilter` (value from `User.externalAgency`).
- **Admin:** Default: show ALL agencies, sorted alphabetically by External Agency. **Sort:** External Agency column is sortable (click header to sort A–Z or Z–A). **Filter:** Optional External Agency multi-select dropdown in filter panel; default: All agencies selected (no filter applied); admin can select specific agencies to filter the view.
- **Drilldown:** Row click opens the same **RecordDetailModal** used elsewhere (e.g. Funnel Performance), using `primary_key` and existing `getRecordDetail(primary_key)` API so the user sees the full record and the Salesforce link.

---

## 5. Opportunity Table (Recruiter Hub)

### 5.1 Scope

- **Rows:** Rows from `vw_funnel_master` where **`External_Agency__c` IS NOT NULL** and the row represents an **opportunity** (i.e. has `Full_Opportunity_ID__c`). Use **`is_primary_opp_record = 1`** (or equivalent) so each opportunity appears once. Record types are already Recruiting + Re-engagement in the view.

### 5.2 Filters (Picklists)

- **SGM:** Filter by `SGM_Owner_Name__c` (same pattern as Open Pipeline / Leaderboard SGM filter). Options from distinct SGMs in the filtered set (or from a central SGM list).
- **External Agency (Admin only):** Multi-select dropdown of all agencies. Hidden for recruiters (they are already scoped to one agency). Default: All selected.
- **Stage (StageName):** Multi-select of opportunity stages, e.g. Qualifying, Discovery, Sales Process, Negotiating, Signed, On Hold, Planned Nurture, Closed Lost, Joined. Use actual `StageName` values from BigQuery.
- **Open vs Closed:**
  - **Open:** `StageName NOT IN ('Joined', 'Closed Lost')` (and optionally exclude other “closed” stages if any).
  - **Closed:** `StageName IN ('Joined', 'Closed Lost')`.
- **Default:** **Open** only (i.e. `StageName NOT IN ('Joined', 'Closed Lost')`).

**Phase 1 validation (BigQuery): StageName values in vw_funnel_master (agency-scoped opps)**

From `vw_funnel_master` where `External_Agency__c IS NOT NULL AND Full_Opportunity_ID__c IS NOT NULL`:

- Closed Lost: 95
- Joined: 13
- Negotiating: 7
- Sales Process: 6
- On Hold: 5
- Discovery: 3
- Qualifying: 2
- Signed: 1
- Re-Engaged: 1
**UI implication:** The Stage filter dropdown must include `Re-Engaged` (seen in data) in addition to the standard recruiting stages.

### 5.3 Columns (Opportunity Table)

- Advisor name  
- StageName  
- External Agency  
- SGM (`SGM_Owner_Name__c`)  
- NextStep (from Opportunity – use the new view column)  

Optional: AUM, SGA, dates.

### 5.4 Behavior

- **Recruiter:** Filter by `External_Agency__c = recruiterFilter`.
- **Admin:** Default: show ALL agencies, sorted alphabetically by External Agency. **Sort:** External Agency column is sortable (click header to sort A–Z or Z–A). **Filter:** Optional External Agency multi-select dropdown in filter panel; default: All agencies selected; admin can select specific agencies to filter the view.
- **Drilldown:** Same as Prospect table – open RecordDetailModal by `primary_key`, reuse `getRecordDetail`.

---

## 6. UI/UX Patterns to Reuse

### 6.1 Filters: picklist + apply/reset pattern (recommended to match existing UX)

**PipelineFilters pattern (Open Pipeline page)** – `src/components/dashboard/PipelineFilters.tsx` and `src/app/dashboard/pipeline/page.tsx`:
- **Collapsible** “Filters” header with summary chips (e.g. “Open Pipeline”, “All SGMs”).
- **Local state** inside the filter component; changes are not applied until **Apply Filters** is clicked.
- **Validation**: blocks apply if required selections are empty (Pipeline requires at least 1 stage and 1 SGM).
- **Reset** button resets local state to defaults.
- Parent page stores the **applied** selections and passes them into the filter component; `useEffect` in the filter component syncs local state from props.

**LeaderboardFilters pattern (SGA Hub)** – `src/components/sga-hub/LeaderboardFilters.tsx`:
- Same collapsible/local-state/apply/reset pattern.
- Adds **search boxes** for long option lists (SGAs, sources) and “Select all / active only / deselect all” helpers.
- Uses “empty selection means default” semantics (e.g. if sources empty → treat as all sources on apply).

**Recruiter Hub recommendation:**
- Implement Prospect and Opportunity filters as **collapsible filter panels with local state + Apply/Reset**, matching PipelineFilters/LeaderboardFilters.
- **Default state:** Filter panels are **collapsed by default** with summary chips showing the current filter state (e.g. "Open Only", "All Stages", "3 SGMs selected"). User clicks to expand, makes changes, then clicks "Apply Filters" to apply. This matches the PipelineFilters pattern.
- Include **search** for External Agency dropdown/list (today only 32 agencies, but this scales).
- Use “empty means all” where appropriate for admin-only filters (e.g. StageName empty → all stages).

### 6.2 Tables: sorting/search/pagination + row click to modal

**DetailRecordsTable** – `src/components/dashboard/DetailRecordsTable.tsx`:
- Supports **client-side search** (fuzzy match) over chosen field (advisor/sga/sgm/source/channel).
- Supports **sorting** by column and **pagination** (50 records per page).
- Supports a `stageFilter` that affects which “date” column is shown/sorted (used heavily by funnel/pipeline drilldowns).

**Recruiter Hub recommendation:**
- For Recruiter Hub lists, either:
  - Reuse `DetailRecordsTable` with a tailored `DetailRecord` shape (requires mapping Next steps fields into the record and possibly adding “externalAgency” column support), or
  - Create a dedicated Recruiter Hub table component but **copy the same behaviors**: search, sortable headers, 50/page pagination, row-click to open record modal.

### 6.3 Drilldown & nested modal pattern (list → record detail → back)

**VolumeDrillDownModal** – `src/components/dashboard/VolumeDrillDownModal.tsx`:
- Standard modal shell with ESC handler and backdrop click-to-close.
- Renders a `DetailRecordsTable` and takes `onRecordClick(primary_key)` callback.

**PipelinePage nested modal flow** – `src/app/dashboard/pipeline/page.tsx`:
- State split:
  - Drilldown modal open + drilldown records
  - RecordDetailModal selected record id
- On row click: close drilldown modal, open RecordDetailModal.
- RecordDetailModal supports **Back to list** via `showBackButton` + `onBack`.

**RecordDetailModal fields** – `src/components/dashboard/RecordDetailModal.tsx`:
- Displays “Attribution” including `External Agency` (already in modal today).
- To display `Next_Steps__c` / `NextStep` here, we must extend the record-detail query and types (Phase C in the plan).

**Recruiter Hub recommendation:**
- Use the same state pattern as PipelinePage:
  - Clicking a row opens RecordDetailModal.
  - If the UI ever uses a drilldown modal (e.g. “show me all open prospects”), reuse VolumeDrillDownModal + Back button pattern.

### 6.4 API request/response patterns to mirror

**POST-with-body filter pattern (common):**
- `POST /api/dashboard/detail-records` expects `{ filters, limit }`.
- `POST /api/dashboard/pipeline-drilldown` expects `{ stage, filters, sgms }`.
- `POST /api/sga-hub/leaderboard` expects `{ startDate, endDate, channels, sources?, sgaNames? }`.

**Permission-applied filters pattern (critical):**
- `src/app/api/sga-activity/dashboard/route.ts`:
  - Reads `getUserPermissions(session.user.email)`
  - If role is SGA, **overrides incoming filters** with `filters = { ...filters, sga: permissions.sgaFilter }`
- `src/app/api/sga-activity/filters/route.ts`:
  - If role is SGA, filters option lists down to only their SGA value

**Recruiter Hub recommendation (must-follow):**
- For recruiter role, never trust client-provided external agency:
  - Always override to `External_Agency__c = permissions.recruiterFilter` (server-side) exactly like the SGA pattern above.
- For admin, allow filtering by agency from the request body.

### 6.5 Page Layout: Stacked Vertical Sections

The Recruiter Hub page uses a **stacked vertical layout**:

1. **Header/Title** — "Recruiter Hub" with optional subtitle showing agency name for recruiters
2. **Prospects Section** (top)
   - Section header: "Prospects" with count badge
   - Collapsible filter panel (Prospect Stage, Open/Closed)
   - Prospects table
3. **Opportunities Section** (below)
   - Section header: "Opportunities" with count badge
   - Collapsible filter panel (SGM, Stage, Open/Closed, External Agency for admins)
   - Opportunities table

This matches existing dashboard patterns and works well on all screen sizes.

### 6.6 Empty States

**When a recruiter's agency has zero prospects/opportunities:**

Display a friendly empty state message:

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│     📋  No records found for [Agency Name]              │
│                                                         │
│     If you believe this is an error, please contact     │
│     your administrator.                                 │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Implementation:**
- Check if `records.length === 0` after API fetch
- Display empty state component with agency name (from session/permissions)
- Use existing empty state patterns from other dashboard components

**For admins:** If ALL agency records are somehow empty (unlikely), show: "No prospects/opportunities with External Agency found."

---

## 7. Implementation Checklist (Step-by-Step)

Execute in order to avoid hallucination and keep the codebase consistent.

### Phase A: Schema & Permissions

1. **Prisma**
   - Add optional `externalAgency String?` to `User` in `prisma/schema.prisma`.
   - Run `npx prisma migrate dev` (or create migration) and name it e.g. `add_user_external_agency`.

2. **Types**
   - In `src/types/user.ts`: Add `'recruiter'` to all role unions (`User`, `UserPermissions`, `SafeUser`, `UserInput`). Add `externalAgency?: string | null` to `User`/`SafeUser`/`UserInput` where appropriate.
   - In `src/lib/users.ts` (if it has role types): Add `'recruiter'`.

3. **Permissions**
   - In `src/lib/permissions.ts`: Add `recruiter` to `ROLE_PERMISSIONS` with `allowedPages` including new Recruiter Hub page ID (e.g. 12), `canManageUsers: false`, `canExport` as desired. In `getUserPermissions`, add `recruiterFilter: user.role === 'recruiter' ? (user.externalAgency ?? null) : null` (read `externalAgency` from Prisma user; ensure Prisma client includes it in the select).

4. **Sidebar & Nav**
   - In `src/components/layout/Sidebar.tsx`: Add to `PAGES`:
     ```typescript
     { id: 12, name: 'Recruiter Hub', href: '/dashboard/recruiter-hub', icon: Briefcase }
     ```
   - Import `Briefcase` from `lucide-react` at the top of the file.
   - Ensure `allowedPages` for role `recruiter` is `[7, 12]`.

5. **Auth redirect (REQUIRED)**
   - In `src/app/login/page.tsx`, add recruiter redirect logic:
     ```typescript
     // After successful sign-in, check role for redirect
     if (session?.user) {
       const permissions = await getUserPermissions(session.user.email);
       if (permissions.role === 'sga') {
         router.push('/dashboard/sga-hub');
       } else if (permissions.role === 'recruiter') {
         router.push('/dashboard/recruiter-hub');
       } else {
         router.push('/dashboard');
       }
     }
     ```
   - This ensures recruiters land directly on their dedicated page.

### Phase B: BigQuery View

6. **vw_funnel_master view update**
   - **File changes** in `views/vw_funnel_master.sql`:
     - Lead_Base CTE: Add `Next_Steps__c AS Lead_Next_Steps__c`
     - Opp_Base CTE: Add `NextStep AS Opp_NextStep`
     - Combined CTE: Add `l.Lead_Next_Steps__c AS Next_Steps__c`, `o.Opp_NextStep AS NextStep`
     - Final CTE: Pass through `Next_Steps__c` and `NextStep`
   - **Deployment via MCP (Cursor.ai):** After editing the SQL file, deploy to BigQuery using MCP:
     ```sql
     CREATE OR REPLACE VIEW `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` AS
     -- [paste the entire updated SQL here]
     ```
   - **Verification query after deployment:**
     ```sql
     SELECT Next_Steps__c, NextStep
     FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
     WHERE External_Agency__c IS NOT NULL
     LIMIT 5
     ```
   - Confirm both columns exist and contain expected data.

### Phase C: Record Detail Enhancement (REQUIRED)

7. **Record detail query & type (REQUIRED)**
   - In `src/lib/queries/record-detail.ts`: Add `Next_Steps__c` and `NextStep` to the SELECT from `vw_funnel_master`.
   - In `src/types/record-detail.ts`: Add to `RecordDetailRaw` and `RecordDetailFull`:
     ```typescript
     nextSteps: string | null;           // From Lead.Next_Steps__c
     opportunityNextStep: string | null; // From Opportunity.NextStep
     ```
   - In `transformToRecordDetail`: Map the new fields.
   - In `RecordDetailModal`: Display these fields in an appropriate section (e.g. under "Activity" or new "Next Steps" section).

### Phase D: Recruiter Hub APIs

8. **External agencies list**
   - Create `src/app/api/recruiter-hub/external-agencies/route.ts`. GET: auth required; call a new query e.g. `getDistinctExternalAgencies()` that returns distinct `External_Agency__c` from Lead and Opportunity (UNION), return JSON `{ agencies: string[] }`. Optionally cache.

9. **Prospects list**
   - Create `src/app/api/recruiter-hub/prospects/route.ts`. POST (or GET with query params): body/params include filters (prospectStages[], openOnly: boolean). Auth required; load `getUserPermissions`. If `recruiterFilter` set, add `WHERE External_Agency__c = @recruiterFilter`. Else (admin) filter only by `External_Agency__c IS NOT NULL`. Apply stage filters (MQL/SQL/SQO via is_mql, is_sql, is_sqo) and Open/Closed (Conversion_Status). Select: primary_key, advisor_name, External_Agency__c, SGA_Owner_Name__c, Next_Steps__c (and any needed for table). Use parameterized BigQuery. Return `{ records: [...] }`. Implement in `src/lib/queries/recruiter-hub-prospects.ts` (or similar).

10. **Opportunities list**
    - Create `src/app/api/recruiter-hub/opportunities/route.ts`. POST/GET with filters (sgm[], externalAgency[], stages[], openOnly). If recruiter, restrict by `External_Agency__c = recruiterFilter`. Else restrict by `External_Agency__c IS NOT NULL`. Filter by StageName, SGM; Open = StageName NOT IN ('Joined','Closed Lost'). Select: primary_key, advisor_name, StageName, External_Agency__c, SGM_Owner_Name__c, NextStep. Use `is_primary_opp_record = 1`. Implement in `src/lib/queries/recruiter-hub-opportunities.ts`.

### Phase E: User Management (Recruiter + External Agency)

11. **User API**
    - In `src/app/api/users/route.ts` (POST) and `src/app/api/users/[id]/route.ts` (PUT): Accept `externalAgency?: string | null` in body. When role is `recruiter`, require non-empty `externalAgency` (return 400 otherwise). Persist to `User.externalAgency` via Prisma.

12. **User modal**
    - In `src/components/settings/UserModal.tsx`: When role is **Recruiter**, show External Agency field: either a dropdown (fetch from `/api/recruiter-hub/external-agencies`) or a text input, or both (dropdown + “Other” with text). On save, send `externalAgency` in the payload. Validate required when role is recruiter.

13. **Settings user list**
    - Ensure Prisma user fetch for Settings/User Management includes `externalAgency` so it can be displayed/edited for recruiters.

### Phase F: Recruiter Hub Page & Components

14. **Page & layout**
    - Create `src/app/dashboard/recruiter-hub/page.tsx`: Server component that checks session and permissions; if user lacks Recruiter Hub access (e.g. page 12 not in allowedPages), redirect. Render a client content component.

15. **RecruiterHubContent**
    - Create `src/app/dashboard/recruiter-hub/RecruiterHubContent.tsx` (or equivalent): Fetch prospects and opportunities from the new APIs. State: prospect filters (stages, openOnly), opportunity filters (sgm, externalAgency, stages, openOnly). Defaults: prospects = all stages + Open only; opportunities = Open only. Two sections: Prospect table, Opportunity table. Each table: filters UI (reuse PipelineFilters pattern), table with columns as specified, row click → set selected primary_key and open RecordDetailModal. Use existing RecordDetailModal and getRecordDetail.

16. **Prospect filters component**
    - Prospect Stage: MQL, SQL, SQO (multi-select). Open/Closed: radio or toggle for “Open Prospects” vs “Closed Prospects” vs “All”. Default: All stages, Open only.

17. **Opportunity filters component**
    - SGM multi-select (fetch SGM list from existing pipeline or a small BQ query). External Agency (admin only) dropdown. Stage (StageName) multi-select. Open/Closed: Open vs Closed vs All; default Open.

18. **Tables**
    - Prospect table: columns Advisor Name, External Agency, SGA, Next_Steps__c; sortable; row click opens RecordDetailModal(primary_key). Opportunity table: columns Advisor Name, StageName, External Agency, SGM, NextStep; same drilldown. For admin, add sort by External_Agency__c and optional agency filter in the filter bar.

19. **API client**
    - In `src/lib/api-client.ts`: Add methods e.g. `getRecruiterHubProspects(filters)`, `getRecruiterHubOpportunities(filters)`, `getRecruiterHubExternalAgencies()` that call the new routes.

### Phase G: Testing & Docs

20. **Manual tests**
    - Create a recruiter user with `externalAgency = 'Zero Staffing'` (or an agency that exists in BQ). Log in as recruiter: Recruiter Hub shows only that agency’s prospects/opportunities. Log in as admin: Recruiter Hub shows all agencies; sort by External Agency works.
    - Verify Prospect table: default Open + all stages; toggle to Closed; filter by MQL/SQL/SQO. Verify Opportunity table: default Open; filter by Stage, SGM, External Agency (admin).
    - Click a row: RecordDetailModal opens with full record and Salesforce link.

21. **Docs**
    - Update `docs/GLOSSARY.md` or a dedicated Recruiter Hub doc with definitions of Recruiter role, External Agency, and Recruiter Hub filters (Open/Closed for prospects vs opportunities).

---

## 8. File Reference Summary

| Area | Files to add or touch |
|------|------------------------|
| Schema | `prisma/schema.prisma` (User.externalAgency) |
| Types | `src/types/user.ts` (recruiter, externalAgency) |
| Permissions | `src/lib/permissions.ts` (recruiter role, recruiterFilter) |
| Nav | `src/components/layout/Sidebar.tsx` (Recruiter Hub page) |
| View | `views/vw_funnel_master.sql` (Next_Steps__c, NextStep) |
| Record detail | `src/lib/queries/record-detail.ts`, `src/types/record-detail.ts` (nextSteps, opportunityNextStep — REQUIRED) |
| APIs | `src/app/api/recruiter-hub/external-agencies/route.ts`, `prospects/route.ts`, `opportunities/route.ts` |
| Queries | `src/lib/queries/recruiter-hub-prospects.ts`, `recruiter-hub-opportunities.ts`, optional `getDistinctExternalAgencies` |
| User API | `src/app/api/users/route.ts`, `src/app/api/users/[id]/route.ts` (externalAgency) |
| User UI | `src/components/settings/UserModal.tsx` (External Agency when role=recruiter) |
| Page | `src/app/dashboard/recruiter-hub/page.tsx`, `src/app/dashboard/recruiter-hub/RecruiterHubContent.tsx` |
| Tables/Filters | New components or reuse DetailRecordsTable/PipelineFilters patterns |
| Client | `src/lib/api-client.ts` (recruiter-hub methods) |

---

## 9. BigQuery Details (for Agent)

- **Lead table:** `savvy-gtm-analytics.SavvyGTMData.Lead`. Columns used: `External_Agency__c`, `Next_Steps__c`, plus existing Lead_Base fields.
- **Opportunity table:** `savvy-gtm-analytics.SavvyGTMData.Opportunity`. Columns used: `External_Agency__c`, `NextStep`, `StageName`, `RecordTypeId` (Recruiting + Re-engagement).
- **View:** `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` (or as in `FULL_TABLE` in `src/config/constants.ts`). After edits, it must expose `External_Agency__c`, `Next_Steps__c`, `NextStep` (or lowercase equivalents depending on dataset).
- **Record types:** Recruiting `012Dn000000mrO3IAI`, Re-engagement `012VS000009VoxrYAC` (already in `config/constants.ts` as `RECRUITING_RECORD_TYPE` and `RE_ENGAGEMENT_RECORD_TYPE`).
- **Distinct External_Agency__c:** Sample check showed at least `"Zero Staffing"` in both Lead and Opportunity; the external-agencies API should return all distinct values from both objects.

**Phase 1 validation (BigQuery): vw_funnel_master column casing and existence**

`vw_funnel_master` columns are a mix of lower_snake and Salesforce-style names; importantly:
- `External_Agency__c` exists as **`External_Agency__c`** (STRING)
- `Full_prospect_id__c` exists as **`Full_prospect_id__c`** (STRING)
- `Full_Opportunity_ID__c` exists as **`Full_Opportunity_ID__c`** (STRING)
- `Conversion_Status` exists as **`Conversion_Status`** (STRING)
- `TOF_Stage` exists as **`TOF_Stage`** (STRING)
- `StageName` exists as **`StageName`** (STRING)
- `SGA_Owner_Name__c` exists as **`SGA_Owner_Name__c`** (STRING)
- `SGM_Owner_Name__c` exists as **`SGM_Owner_Name__c`** (STRING)

**Phase 1 validation (BigQuery): Recruiter Hub dataset size**

From `vw_funnel_master` where `External_Agency__c` is non-empty:

- `total_records`: **244**
- `has_prospect`: **238**
- `has_opportunity`: **133**
**UI implication:** Initial version can safely render full tables without pagination, but still implement server-side limiting and/or lightweight pagination patterns consistent with other pages for future growth.

**Phase 1 validation (BigQuery): Open vs Closed prospect logic sanity-check**

Grouping by `Disposition__c`, `Conversion_Status`, `TOF_Stage` for rows where `External_Agency__c IS NOT NULL` shows:

- Many records are `Conversion_Status='Closed'` with `Disposition__c IS NULL` at TOF_Stage SQL/SQO (these are likely opportunity-side closures, where lead disposition is not set).
- Joined records appear as `Conversion_Status='Joined'`, `TOF_Stage='Joined'`.
**Recommendation:** Define prospect Open/Closed primarily via `Conversion_Status` (as originally planned), not via `Disposition__c`, since `Disposition__c` may be null even when `Conversion_Status='Closed'`.

---

## 10. Open / Clarification Points

- ~~Exact **allowedPages** for recruiter~~ → **RESOLVED:** [7, 12] only.
- Whether **Prospect** table should include only lead rows (Full_prospect_id__c IS NOT NULL) or also opportunity-only rows with External_Agency__c set: **recommendation (keep as-is):** include all view rows with non-null External_Agency__c and use Open/Closed + stage filters.
- ~~Whether **RecordDetailModal** should display Next_Steps__c / NextStep~~ → **RESOLVED:** Yes; Phase C is REQUIRED.

This document is intended to be followed by an agent implementing the feature; all paths, role names, and field names match the current codebase and BQ schema.

---

## 11. Finalized Product Decisions

This section summarizes all product decisions made for the Recruiter Hub feature.

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Recruiter allowedPages | [7, 12] only | Focus recruiters on their dedicated hub |
| Recruiter canExport | true | Allow recruiters to export their agency data |
| Google OAuth | Allow any provisioned user | Recruiters can use Google if pre-provisioned |
| Page layout | Stacked vertical | Prospects on top, Opportunities below |
| External Agency field | Dropdown + "Other" | Support existing and new agencies |
| Admin agency view | Sort + Filter | Admins can sort and optionally filter by agency |
| Filter panel state | Collapsed by default | Match existing patterns |
| Sidebar icon | Briefcase | Business/recruiting connotation |
| Login redirect | Yes, to /dashboard/recruiter-hub | Better UX for recruiters |
| Next Steps in modal | Yes (Phase C required) | Full visibility into record details |
| Role change behavior | Clear externalAgency | Prevent stale data |
| Empty state | "Contact admin" message | Helpful guidance for recruiters |
| Direct URL protection | Redirect to default | Secure page access |

---

## 12. Phase 1 Update Log (BigQuery Data Discovery & Validation)

| Phase | Question # | Finding | Investigation Update |
|-------|-----------:|---------|----------------------|
| 1.1 | Q1 | Pulled full Lead agency list with counts (top: UCare=61). | Updated Section 3.4 with Lead agencies + counts. |
| 1.1 | Q2 | Pulled full Opportunity agency list with counts (top: UCare=38). | Updated Section 3.4 with Opportunity agencies + counts and noted coverage differences. |
| 1.1 | Q3 | No casing/spelling duplicates in Lead after normalization (0 rows). | Added data-quality note and recommendation to still `TRIM()` values. |
| 1.2 | Q4 | Lead.Next_Steps__c exists; 28,736/95,322 non-null. | Updated Section 3.2 with completeness metrics + UI implications. |
| 1.2 | Q5 | Opportunity.NextStep exists; 1,966/2,771 non-null (Recruiting+Re-engagement). | Updated Section 3.2 with completeness metrics. |
| 1.2 | Q6 | Next_Steps__c contains both short codes and long narrative strings. | Updated Section 3.2 with sample formats and UI guidance. |
| 1.3 | Q7 | Confirmed actual vw_funnel_master columns + casing via INFORMATION_SCHEMA. | Updated Sections 3.1 and 9 with concrete casing notes. |
| 1.3 | Q8 | Confirmed `External_Agency__c` exists in vw_funnel_master with that casing. | Updated Section 3.1/9 accordingly. |
| 1.3 | Q9 | Only 244 records currently have a non-empty External_Agency__c in the view. | Updated Section 9 with dataset size guidance. |
| 1.4 | Q10 | `Conversion_Status` is the reliable Open/Closed indicator; `Disposition__c` can be null even when Closed. | Updated Section 9 with filter-definition recommendation. |
| 1.4 | Q11 | StageName values for agency-scoped opps include `Re-Engaged`. | Updated Section 5.2 with enumerated StageName list + counts. |

---

## 13. Phase 2 Update Log (Permissions & User Model Deep Dive)

| Phase | Question # | Finding | Investigation Update |
|-------|-----------:|---------|----------------------|
| 2.1 | Q12 | Confirmed Prisma `User` fields; no `externalAgency` exists today. | Updated Section 2.1 with current Prisma User fields and explicit “no externalAgency” note. |
| 2.1 | Q13 | No `externalAgency` references found in codebase outside these investigation docs. | Reinforced that a Prisma migration will be required. |
| 2.1 | Q14 | Confirmed `ROLE_PERMISSIONS` structure and `getUserPermissions` return shape (sgaFilter/sgmFilter only). | Added notes under Section 2 for how recruiterFilter must be added in implementation. |
| 2.2 | Q15 | Confirmed page IDs in Sidebar PAGES: 1, 3, 7, 8, 9, 10 (no 11/12). | Confirms page ID **12 is available** for Recruiter Hub. |
| 2.2 | Q16 | No references found to page id 11 or 12 elsewhere in `src/`. | Low risk of page-id collision; still keep 11 reserved. |
| 2.3 | Q17 | Google OAuth requires user to already exist; not auto-provisioned; enforces `@savvywealth.com`. | Added Section 2.4 with recruiter auth implications (external recruiters cannot use Google today). |
| 2.3 | Q18 | Login redirect currently only special-cases SGA → `/dashboard/sga-hub`; everyone else → `/dashboard`. | Added recommendation to redirect recruiter → `/dashboard/recruiter-hub`. |

---

## 14. Phase 3 Update Log (Existing Component Pattern Analysis)

| Phase | Question # | Finding | Investigation Update |
|-------|-----------:|---------|----------------------|
| 3.1 | Q19 | Pipeline page uses `PipelineFilters` (collapsible + local state + Apply/Reset) and optimizes payload by omitting SGMs when “all selected”. | Added Section 6.1 describing the exact pattern to reuse for Recruiter Hub filters. |
| 3.1 | Q20 | Leaderboard filters (`LeaderboardFilters`) use same Apply/Reset pattern and add search + “select all/active only” helpers. | Added Section 6.1 recommendation to include search for External Agency and reuse this UX. |
| 3.1 | Q21 | Closest existing toggle UX is a binary switch (e.g. Activity “Active vs All” toggle). Open/Closed is typically handled via explicit filter state rather than implicit logic. | Added guidance in Section 6.1 to implement Open/Closed as a simple toggle/segmented control consistent with existing toggles. |
| 3.2 | Q22 | `DetailRecordsTable` provides search, sorting, and 50-row pagination; supports `stageFilter`-driven date display logic. | Added Section 6.2 describing reuse vs building a dedicated Recruiter Hub table with the same behaviors. |
| 3.2 | Q23 | `VolumeDrillDownModal` + `RecordDetailModal` “back to list” is the established nested modal pattern (used by Pipeline). | Added Section 6.3 with the exact list → record → back state pattern to mirror. |
| 3.2 | Q24 | `RecordDetailModal` already displays External Agency in Attribution; showing Next Steps would require record-detail query/type extension. | Added note in Section 6.3 and linked to Phase C plan. |
| 3.3 | Q25 | Established API pattern is POST with JSON body carrying filters; request shapes differ by feature but follow the same structure. | Added Section 6.4 with concrete examples and recommended same for Recruiter Hub. |
| 3.3 | Q26 | `sgaFilter` is applied server-side by overriding incoming filters (cannot be bypassed); filter option APIs also restrict option lists for SGA role. | Added Section 6.4 “must-follow” pattern for `recruiterFilter` enforcement. |

---

## 15. Phase 4 Update Log (Settings / User Management Integration)

| Phase | Question # | Finding | Investigation Update |
|-------|-----------:|---------|----------------------|
| 4.1 | Q27 | UserModal has a single role `<select>` (admin, manager, sgm, sga, viewer); no conditional fields by role. | Added Section 2.5 with exact insertion point for External Agency (after Role, before isActive) and form state/type extensions. |
| 4.1 | Q28 | POST only destructures email, name, password, role, isActive; PUT passes full body to updateUser. createUser/updateUser in lib/users do not accept externalAgency. | Added Section 2.5 validation approach: destructure externalAgency in routes; when role is recruiter require non-empty (trim); pass to lib/users and persist; document role-change behavior for externalAgency. |
| 4.2 | Q29 | Settings page shows "My Account" + Change Password for all; UserManagement only when `permissions?.canManageUsers`. | Documented in Section 2.5: recruiters already see only password change; no change needed. |
| 4.2 | Q30 | Sidebar filters nav via `PAGES.filter(page => allowedPages.includes(page.id))`; Recruiter Hub (id 12) not in PAGES yet. | Added Section 2.5: verified allowedPages hides pages correctly; recruiter must have 7 and 12 in allowedPages; add page 12 in implementation. |

---

## 16. Phase 5 Update Log (Implementation Readiness Checklist)

| Phase | Question # | Finding | Investigation Update |
|-------|-----------:|---------|----------------------|
| 5.1 | Q31 | Migrations folder has only manual SQL files; package.json has no prisma migrate script (only prisma generate). | Added Section 2.6: document two options—`npx prisma migrate dev --name add_user_external_agency` or manual SQL + psql, then prisma generate. |
| 5.1 | Q32 | Manual SQL can be idempotent with `ADD COLUMN IF NOT EXISTS`; Prisma migrate is safe once applied. | Added Section 2.6 with example: `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "externalAgency" TEXT;` |
| 5.2 | Q33 | View SQL maintained in `views/vw_funnel_master.sql`; no deploy script in repo. | Added Section 2.6: deployment is manual (BigQuery console or bq CLI); document exact project/dataset steps with team. |
| 5.2 | Q34 | All app queries use explicit column lists from the view; no direct `SELECT * FROM vw_funnel_master`. export-records uses `SELECT *` only from CTEs with fixed column sets. | Added Section 2.6: adding Next_Steps__c and NextStep to view is additive; no existing queries need adjustment. |
| 5.3 | Q35 | Phase 1 data: Zero Staffing (17 Lead, 3 Opp), UCare (61 Lead, 38 Opp). | Added Section 2.6: recommend Zero Staffing for test recruiter; UCare for fuller testing. |
| 5.3 | Q36 | Seed creates admin, manager, SGA only; no recruiter user. | Added Section 2.6: add test recruiter creation to implementation plan (seed or User Management / one-off script). |

---

## 17. Phase 6 Update Log (Edge Cases & Error Handling)

| Phase | Question # | Finding | Investigation Update |
|-------|-----------:|---------|----------------------|
| 6.1 | Q37 | Use parameterized BQ for all agency values; trim for display/storage. Optional: run Q37 query to find special chars; if any, document UI/export escaping. | Added Section 2.7: parameterized queries required; trim; optional Q37 check for quotes/angle brackets. |
| 6.1 | Q38 | Orphaned recruiters (agency renamed/deleted in SF) need product decision. | Added Section 2.7: options—admin notification, validation on load, and allow admin to edit externalAgency; recommend at least editable field + optional validation/banner. |
| 6.2 | Q39 | When role changed from recruiter to other, clear externalAgency in same update. | Added Section 2.7: document in PUT handler—if new role ≠ recruiter and previous role was recruiter, set externalAgency to null. |
| 6.2 | Q40 | Middleware only checks token; SGA Management/SGA Hub use server-component role check + redirect. Dashboard/Pipeline are client and do not redirect by allowedPages. | Added Section 2.7: recruiter-hub page must enforce session + allowedPages.includes(12); optionally add layout-level pathname→pageId guard so direct URLs redirect for recruiters. |

---

## 18. Phase 7 Update Log (Performance & Scale Considerations)

| Phase | Question # | Finding | Investigation Update |
|-------|-----------:|---------|----------------------|
| 7.1 | Q41 | Phase 1 count: 244 records with non-empty External_Agency__c; well under 10k. | Added Section 2.8: no mandatory pagination for launch; still implement server-side limit + client-side 50-per-page for consistency and future growth. |
| 7.1 | Q42 | BigQuery views have no indexes; source tables are columnar. At 244 rows performance is trivial. | Added Section 2.8: document that BQ view scans are acceptable; partitioning is data-warehouse concern. |
| 7.2 | Q43 | DetailRecordsTable uses client-side pagination (50 per page, slice of full records); API uses limit (e.g. 10000). | Added Section 2.8: Recruiter Hub should use same pattern—API cap (e.g. 1000/5000), client-side 50-per-page. |
| 7.2 | Q44 | Caching is at query layer via cachedQuery (unstable_cache, tags, TTL 4h/2h); filters API is force-dynamic. | Added Section 2.8: cache getDistinctExternalAgencies with cachedQuery, tag RECRUITER_HUB or DASHBOARD, TTL 4h (or 1h). |

---

## 19. Phase 8 Update Log (Final Verification & Documentation)

| Phase | Question # | Finding | Investigation Update |
|-------|-----------:|---------|----------------------|
| 8.1 | Q45 | All existing File Reference paths exist; new paths (recruiter-hub APIs, queries, page, RecruiterHubContent) to be created. Content component full path: src/app/dashboard/recruiter-hub/RecruiterHubContent.tsx. | Added Section 2.9: verified existing paths; clarified new paths and RecruiterHubContent.tsx location; Tables/Filters noted as new components or reuse. |
| 8.1 | Q46 | Recruiter Hub uses existing stack (Next.js, Prisma, BigQuery, NextAuth, bcrypt, cache). | Added Section 2.9: no new npm packages required. |
| 8.2 | Q47 | ARCHITECTURE has roles/pages; GLOSSARY has funnel/opportunity terms. Phase G already lists GLOSSARY. | Added Section 2.9: ARCHITECTURE—add recruiter role, page 12, Recruiter Hub subsection; GLOSSARY—add Recruiter, External Agency, Recruiter Hub; add API doc tasks if applicable. |
| 8.2 | Q48 | No README in src/app/dashboard or src/components. | Added Section 2.9: no README updates required unless team adds recruiter-hub README. |
