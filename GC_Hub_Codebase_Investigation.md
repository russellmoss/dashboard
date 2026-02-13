# GC Hub — Pre-Implementation Codebase Investigation

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

### 1.2 — ROLE_PERMISSIONS Map
- **File:** `src/lib/permissions.ts`
- **Question:** Paste the complete `ROLE_PERMISSIONS` object. For each role, what are: `allowedPages`, `canExport`, `canManageUsers`, `canManageRequests`? What page IDs are currently assigned?
- **Why:** We need to define `capital_partner` permissions. Must know the next available page ID for GC Hub and what permission flags exist.
- **Finding:**

### 1.3 — Recruiter Auth Pattern (Our Template)
- **File:** `src/middleware.ts`
- **Question:** Paste the complete recruiter middleware block (the default-deny section). How does it detect recruiter role? What routes are allowlisted? How does the redirect work?
- **Why:** Capital Partner will use an identical isolation pattern — restricted to GC Hub + Settings only. We'll replicate this block.
- **Finding:**

### 1.4 — Recruiter API Allowlist
- **File:** `src/middleware.ts`
- **Question:** Find the section that blocks recruiters from API routes. What's the exact allowlist? How is `forbidRecruiter()` implemented (file path, function signature)?
- **Why:** We need an equivalent `forbidCapitalPartner()` function and API allowlist for GC Hub routes.
- **Finding:**

### 1.5 — Login Flow for Email/Password Users
- **File:** `src/lib/auth.ts` (authOptions)
- **Question:** How does the credentials provider work? Does it check `isActive`? How is the JWT populated — what fields go into the token? How does the session callback extract permissions?
- **Why:** Capital Partners use email/password (like recruiters). Need to understand the token→session→permissions chain to ensure `capital_partner` role flows through correctly.
- **Finding:**

### 1.6 — User Creation Flow
- **File:** `src/app/api/users/route.ts` (POST handler)
- **Question:** How are users created? What validation exists on the `role` field? Is there a hardcoded list of valid roles? Does the UI user management form have a role dropdown — where is it defined?
- **Why:** Admin needs to create Capital Partner users. Must know if role validation will reject unknown roles.
- **Finding:**

### 1.7 — Dashboard Layout Route Protection
- **File:** `src/app/dashboard/layout.tsx`
- **Question:** Paste the complete client-side route protection logic (the useEffect that checks permissions and redirects). How does it handle the "flash" prevention for restricted users?
- **Why:** Must add equivalent logic for `capital_partner` — restrict to `/dashboard/gc-hub` and `/dashboard/settings`.
- **Finding:**

---

## Phase 2: Sidebar & Page Navigation

**Goal:** Understand how to add GC Hub to the sidebar and control visibility per role.

### 2.1 — PAGES Array
- **File:** `src/components/layout/Sidebar.tsx`
- **Question:** Paste the complete `PAGES` array. What is the highest page ID currently used? What icons are imported?
- **Why:** Need the next available page ID for GC Hub. Need to pick an appropriate icon.
- **Finding:**

### 2.2 — Sidebar Filtering Logic
- **File:** `src/components/layout/Sidebar.tsx`
- **Question:** How does the sidebar filter pages based on `allowedPages`? Is it the `filteredPages` variable? Paste the filter logic.
- **Why:** Confirming that adding a page ID to `ROLE_PERMISSIONS` is sufficient to show/hide sidebar items.
- **Finding:**

### 2.3 — Recruiter Hub Page Pattern
- **File:** `src/app/dashboard/recruiter-hub/page.tsx`
- **Question:** Paste the complete server component. How does it check permissions? What's the redirect logic for unauthorized access?
- **Why:** This is the exact pattern we'll replicate for `src/app/dashboard/gc-hub/page.tsx`.
- **Finding:**

### 2.4 — Recruiter Hub Client Component Structure
- **File:** `src/app/dashboard/recruiter-hub/RecruiterHubContent.tsx`
- **Question:** What's the high-level component structure? How does it fetch data? Does it use tabs? How are permissions checked client-side?
- **Why:** Establishes the pattern for GC Hub's client component with tabs, data fetching, and permission-gated features.
- **Finding:**

---

## Phase 3: Database Schema & Prisma Patterns

**Goal:** Understand how to add new Prisma models for GC Hub data without conflicting with existing schema.

### 3.1 — Current Prisma Schema
- **File:** `prisma/schema.prisma`
- **Question:** List ALL model names currently defined. For each, note: primary key type (cuid vs uuid vs serial), any `@@unique` constraints, any relations to `User`.
- **Why:** Need to design `GcAdvisorPeriodData`, `GcAdvisorMapping`, and `GcSyncLog` models that follow existing conventions.
- **Finding:**

### 3.2 — Migration Strategy
- **File:** `prisma/migrations/` directory
- **Question:** List all migration folders. Are there any `manual_*.sql` files? How have schema changes been deployed — via `prisma migrate dev` or manual SQL in Neon?
- **Why:** Need to understand whether to use Prisma migrations or manual SQL for the new tables. The existing codebase uses both approaches.
- **Finding:**

### 3.3 — Prisma Client Usage Pattern
- **Files:** Any API route that uses `prisma` (e.g., `src/app/api/users/route.ts`)
- **Question:** How is the Prisma client imported and initialized? Is there a singleton pattern? What's the import path?
- **Why:** Must use the same client instance for GC Hub data operations.
- **Finding:**

### 3.4 — Database Connection Config
- **File:** `prisma/schema.prisma` datasource block + `.env.example`
- **Question:** What's the datasource configuration? Is there a `directUrl` for migrations? What connection pooling is used?
- **Why:** Large ETL imports may need the direct (non-pooled) connection to avoid timeout issues.
- **Finding:**

---

## Phase 4: Google Sheets Integration (Existing)

**Goal:** Understand what Google Sheets infrastructure already exists so we can reuse it for the GC Hub live sync.

### 4.1 — Sheets Auth Client
- **File:** `src/lib/sheets/google-sheets-exporter.ts`
- **Question:** Paste the `getAuthClient()` method. What scopes does it use? How does it handle local vs Vercel credentials?
- **Why:** The GC Hub sync will need a READ-ONLY Sheets client. We can reuse or extend this auth pattern.
- **Finding:**

### 4.2 — Sheets API Package
- **File:** `package.json`
- **Question:** Is `googleapis` already installed? What version? Any other Google-related packages?
- **Why:** Confirming we don't need to add new dependencies for Sheets read access.
- **Finding:**

### 4.3 — Existing Sheets Read Patterns
- **Question:** Search the codebase for any `sheets.spreadsheets.values.get` or `sheets.spreadsheets.values.batchGet` calls. Are there any existing patterns for reading (not just writing) from Google Sheets?
- **Why:** The ETL and live sync need to READ from sheets. If there's an existing reader pattern, we should follow it.
- **Finding:**

### 4.4 — Service Account Permissions
- **Question:** Check the `.env.example` comments — does the existing service account have read access to the Revenue Estimates workbook? Or will we need a separate service account or share the workbook?
- **Why:** The data exploration used MCP tools (separate auth). Production sync needs the dashboard's service account to have read access to spreadsheet `1-6cBC1V2H7V-DrzpkII2qPshJyzriWpfjS80VEnPWq4`.
- **Finding:**

---

## Phase 5: API Route Patterns & Data Fetching

**Goal:** Understand how to build GC Hub API routes that follow existing conventions.

### 5.1 — API Route Convention
- **Question:** Do existing routes use POST with JSON body or GET with query params? Paste one example of a typical dashboard API route handler (e.g., `src/app/api/dashboard/funnel-metrics/route.ts` — just the handler skeleton with auth check).
- **Why:** GC Hub API routes must follow the same convention for consistency.
- **Finding:**

### 5.2 — Error Handling Pattern
- **Question:** How do API routes handle errors? Is there a common pattern (try/catch → JSON error response)? Any logging (Sentry, console)?
- **Why:** GC Hub routes must use the same error handling for Sentry visibility.
- **Finding:**

### 5.3 — Cron Job Pattern
- **File:** `src/app/api/cron/refresh-cache/route.ts`
- **Question:** Paste the complete cron route. How does it authenticate (CRON_SECRET)? How is it registered in `vercel.json`?
- **Why:** The daily Google Sheets sync will be a cron job. Must follow this exact pattern.
- **Finding:**

### 5.4 — Data Freshness Pattern
- **File:** `src/app/api/dashboard/data-freshness/route.ts`
- **Question:** How does the existing data freshness indicator work? What does it check?
- **Why:** GC Hub needs its own sync status indicator ("Last synced from Google Sheets: 2 hours ago"). May extend or replicate this pattern.
- **Finding:**

### 5.5 — Recruiter Hub API Routes
- **File:** `src/app/api/recruiter-hub/` directory
- **Question:** List all files in this directory. Pick one route and paste its complete implementation. How does it use `permissions.recruiterFilter` for data scoping?
- **Why:** This is the closest analog to what GC Hub API routes will look like — role-scoped data access.
- **Finding:**

---

## Phase 6: Frontend Component Patterns

**Goal:** Understand the UI component library and patterns used so GC Hub looks native.

### 6.1 — UI Component Library
- **File:** `package.json`
- **Question:** List all UI-related dependencies (Tremor, Recharts, Headless UI, etc.) and their versions.
- **Why:** GC Hub charts and tables must use the same component library.
- **Finding:**

### 6.2 — Tremor Component Usage
- **Question:** Search for imports from `@tremor/react` across the codebase. What specific Tremor components are used? (Card, Title, BarChart, LineChart, Table, etc.)
- **Why:** Need to know which Tremor components are already in use so GC Hub charts are consistent.
- **Finding:**

### 6.3 — Table Component Pattern
- **Question:** Find the main data table used in the dashboard (the Detail Records table or the SGA Hub table). What component is it? Is it a custom table or Tremor's? How does it handle pagination, sorting, and search?
- **Why:** GC Hub's advisor table will need the same features.
- **Finding:**

### 6.4 — Scorecard/KPI Card Pattern
- **Question:** Find the scorecard components on the main dashboard page. What component are they? How are they styled? Do they support click-to-filter?
- **Why:** GC Hub will have summary KPI cards (total revenue, total amount earned, etc.).
- **Finding:**

### 6.5 — Chart Components
- **Question:** What chart library is used (Tremor charts vs raw Recharts)? Find one chart component and paste its implementation pattern (data format, props, styling).
- **Why:** GC Hub needs revenue-over-time line charts and potentially cohort analysis charts.
- **Finding:**

### 6.6 — Tab Navigation Pattern
- **Question:** Search for tab components in the codebase. Is there an existing tab pattern (Headless UI tabs, Tremor tabs, custom)? Find one example and note the implementation.
- **Why:** GC Hub will likely have tabs (Overview, Advisor Detail, Data Explorer, etc.).
- **Finding:**

### 6.7 — Dark Mode Support
- **Question:** Search for `dark:` Tailwind classes. Is dark mode fully supported? How is it toggled? Is it required for new pages?
- **Why:** Need to know if GC Hub components need dark mode variants.
- **Finding:**

### 6.8 — CSV Export Implementation
- **Question:** Find the existing CSV export functionality. Is there a "Download CSV" button somewhere? What library does it use? How is the file generated (client-side or server-side)?
- **Why:** GC Hub needs CSV export. Should use the same approach.
- **Finding:**

---

## Phase 7: Inline Editing & Mutation Patterns

**Goal:** Determine if any inline editing patterns exist in the codebase that we can extend for GC Hub data corrections.

### 7.1 — Existing Edit/Mutation Patterns
- **Question:** Search for any PUT/PATCH API routes in the codebase. Are there any forms that edit data inline (e.g., SGA weekly goals, user management)? Paste one example of a mutation pattern.
- **Why:** GC Hub allows Admin/RevOps to edit revenue/commission values inline. Need to follow existing mutation patterns.
- **Finding:**

### 7.2 — Weekly Goals Edit Pattern
- **File:** SGA Hub weekly goals
- **Question:** How do SGAs edit their weekly goals? Is it inline in a table? Is there a form? How does it save (debounced, on blur, explicit save button)?
- **Why:** This is the closest existing pattern to inline data editing. GC Hub will use a similar approach for data corrections.
- **Finding:**

### 7.3 — Optimistic Updates
- **Question:** Does the codebase use optimistic UI updates (update UI before server confirms) or pessimistic (wait for server response)? Search for patterns like `setData` before/after fetch.
- **Why:** For inline editing, we need to decide on the update strategy.
- **Finding:**

### 7.4 — Toast/Notification Pattern
- **Question:** Search for toast notifications or success/error messages after mutations. Is there a toast library installed? How do existing forms show save confirmation?
- **Why:** Inline edits need feedback ("Value updated" / "Error saving").
- **Finding:**

---

## Phase 8: Environment & Deployment

**Goal:** Understand deployment constraints for the new features.

### 8.1 — Vercel Configuration
- **File:** `vercel.json`
- **Question:** Paste the complete file. What function timeouts are configured? What cron jobs exist?
- **Why:** Need to add a cron job for Sheets sync and potentially extend function timeouts for the ETL.
- **Finding:**

### 8.2 — Environment Variables
- **File:** `.env.example`
- **Question:** List all environment variables currently defined. Which ones are Google-related?
- **Why:** The GC Hub sync will need the Sheets service account credentials. Need to confirm if existing env vars cover this or if new ones are needed.
- **Finding:**

### 8.3 — Build Configuration
- **File:** `package.json`, `next.config.js` or `next.config.mjs`
- **Question:** What's the build command? Any special webpack configuration? Is Sentry integrated at build time?
- **Why:** New Prisma models require `prisma generate` before build. Need to confirm this is in the build chain.
- **Finding:**

### 8.4 — TypeScript Configuration
- **File:** `tsconfig.json`
- **Question:** What's the `strict` setting? Any path aliases (e.g., `@/`)? What's the target?
- **Why:** Implementation guide code snippets must match the project's TS config.
- **Finding:**

---

## Phase 9: Data Anonymization Patterns

**Goal:** Determine if any anonymization logic already exists or needs to be built from scratch.

### 9.1 — Existing Data Masking
- **Question:** Search the codebase for any anonymization, masking, or data hiding logic. Search for terms like "anonymize", "mask", "redact", "hide", "obfuscate", "Advisor 0".
- **Why:** Capital Partners see anonymized advisor names. Need to know if any pattern exists.
- **Finding:**

### 9.2 — Recruiter Data Isolation Pattern
- **Question:** How does the recruiter hub filter data? Is filtering done at the API level (query filter) or UI level (hide columns)? Paste the data scoping logic.
- **Why:** The Capital Partner anonymization is more complex than recruiter filtering (showing all data but with masked names vs. showing only your agency's data). Need to understand the existing approach.
- **Finding:**

### 9.3 — Consistent Anonymization
- **Question:** For GC Hub, anonymized names must be consistent across sessions ("Eric Kirste" → "Advisor 003" every time, not randomly assigned). Is there any existing pattern for deterministic mapping? Or will we need to build a lookup table?
- **Why:** If GC drills into "Advisor 003" today and comes back tomorrow, it must still be "Advisor 003".
- **Finding:**

---

## Phase 10: Testing & Validation Patterns

**Goal:** Understand what testing infrastructure exists so the implementation guide includes proper verification steps.

### 10.1 — Test Scripts
- **File:** `scripts/` directory
- **Question:** List all test scripts. Are there any that verify data integrity, API responses, or dashboard calculations?
- **Why:** Implementation guide phases need verification steps. Should follow existing test patterns.
- **Finding:**

### 10.2 — Linting Configuration
- **File:** `.eslintrc*`, `package.json` lint script
- **Question:** What linting rules are configured? What's the lint command?
- **Why:** Every phase of the implementation guide should end with a lint check.
- **Finding:**

### 10.3 — Type Checking
- **Question:** Is `tsc --noEmit` used for type checking? What's the command to run a full type check?
- **Why:** Every phase should end with a type check to catch issues early.
- **Finding:**

### 10.4 — Build Verification
- **Question:** What's the full build command? How long does a typical build take? Are there known build warnings to ignore?
- **Why:** The implementation guide should include build verification at key milestones.
- **Finding:**

---

## Execution Notes

After completing all 10 phases, the findings become the codebase knowledge base. Combined with:

1. **`gc_dashboard_data_exploration.md`** — The data knowledge base (ETL rules, source maps, transformation logic)
2. **Alice's wrap-up answers** — Resolved data ambiguities (P1 items A–E)
3. **Dashboard UI/UX Decisions** — Alice's answers on layout, charts, drill-down, GC view
4. **GC Hub Data Architecture Spec** — The Hybrid A+B architecture decision

...these findings provide everything needed to write a comprehensive, conflict-free, phased implementation guide with accurate Cursor prompts.
