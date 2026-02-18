# Guide 0: Bulk Documentation Update

> **Purpose**: Bring `docs/ARCHITECTURE.md` fully current with the actual codebase, eliminating all drift identified in the exploration document (Phases 4-5).
> **Date**: 2026-02-18
> **Prerequisite**: Completed `docs_maintenance_exploration.md` with all 6 phases filled in.
> **Estimated Time**: ~2-3 hours across all phases in a single Claude Code session.
> **CRITICAL RULE**: This guide modifies ONLY documentation files. Do NOT change any `.ts`, `.tsx`, `.js`, `.json`, or other source code files.

---

## ⚠️ IMPORTANT: Rules for This Guide

1. **DOCUMENTATION ONLY** — You are editing `docs/ARCHITECTURE.md` and nothing else. Do NOT modify any source code, config files, scripts, or other non-documentation files.
2. **READ BEFORE WRITE** — Before documenting any route, model, or config, READ the actual source file first. Do not guess what a route does.
3. **Windows environment** — Use PowerShell commands only.
4. **Match existing style** — Read how existing sections are formatted in ARCHITECTURE.md and match that style exactly for new content.
5. **Preserve existing correct content** — Do not rewrite sections that are already accurate. Only add missing content and fix incorrect content.
6. **No aspirational content** — Only document what EXISTS in code today. Do not add TODOs, planned features, or speculative content.

---

## How to Use This Guide

1. Open Claude Code in your project root (`C:\Users\russe\Documents\Dashboard`)
2. Copy-paste each **PHASE PROMPT** one at a time
3. After each phase, Claude Code will run verification steps
4. Where indicated, Russell performs a manual review before proceeding
5. Do NOT skip phases — each builds on the previous

---

## PHASE 1: Read Current State & Plan

### Prompt

```
You are performing a bulk documentation update on docs/ARCHITECTURE.md. Your job is to bring this file current with the actual codebase. You will ONLY modify documentation files — never source code.

PHASE 1: Read the current state and establish what needs to change.

**Step 1.1** — Read docs/ARCHITECTURE.md in full. Note:
- The total line count
- The exact section structure (every ## and ### heading with approximate line numbers)
- Where the Table of Contents is (we'll need to update it at the end)

**Step 1.2** — Read the exploration findings for the punch list. Read docs_maintenance_exploration.md and extract from Phase 4 and Phase 5:
- The complete list of undocumented API routes (Phase 4.1)
- The page route discrepancies (Phase 4.2)
- The undocumented Prisma models (Phase 4.3)
- The missing environment variables (Phase 4.7)
- The permissions gaps (Phase 4.5)
- The semantic layer gaps (Phase 4.6)
- The undocumented cron jobs (Phase 3.4)

**Step 1.3** — Create a work plan. Based on what you read, list:
1. Which EXISTING sections need modifications (and what specifically)
2. Which NEW sections need to be added (and where they should go in the document)
3. The order you'll make changes (bottom-up to avoid line number shifts)

**Step 1.4** — Read the formatting patterns. Look at how Section 8 (SGA Hub) documents its API routes. Record the exact format used:
- How are routes listed? (table? bullet list? headers?)
- What info is included per route? (method, auth, description?)
- How are subsections structured?
This is the template you'll follow for all new feature sections.

Report your plan. Do NOT make any edits yet. Just report:
- "Here is the section structure I found..."
- "Here are the changes I plan to make..."
- "Here is the format I'll follow for new sections..."
- "Ready for Phase 2."
```

### Expected Outcome
- Claude Code has read ARCHITECTURE.md and the exploration doc
- A clear work plan is established
- No files have been modified yet

---

## PHASE 2: Fix Section 5 — Page Access Control & Permissions

### Prompt

```
Continuing the bulk documentation update. You are editing docs/ARCHITECTURE.md ONLY.

PHASE 2: Fix the Page Access Control table and Permissions documentation in Section 5.

**Step 2.1** — Read `src/lib/permissions.ts` in full. Record:
- All 8 roles and their exact allowedPages arrays
- All permission properties in the UserPermissions interface
- The page number → route mapping from code comments

**Step 2.2** — Read the middleware file `src/middleware.ts` to understand how page numbers map to actual routes. Record any PAGE_MAP or similar mapping object.

**Step 2.3** — Update the Page Access Control table in Section 5 of ARCHITECTURE.md:

REMOVE these phantom pages (they don't exist in code):
- Page 2: /dashboard/channels
- Page 4: /dashboard/partners
- Page 5: /dashboard/experiments
- Page 6: /dashboard/sga

ADD these real pages (they exist in code but aren't in the table):
- Page 11: /dashboard/sga-activity (SGA Activity Dashboard)
- Page 12: /dashboard/recruiter-hub (Recruiter Hub)
- Page 13: /dashboard/requests (Dashboard Requests)
- Page 14: /dashboard/chart-builder (Chart Builder)
- Page 15: /dashboard/advisor-map (Advisor Map)
- Page 16: /dashboard/gc-hub (GC Hub)
- (Also add /dashboard/games/pipeline-catcher if it has a page number, or note it's unprotected)

For each page, include: page number, route path, page name, and which roles have access (from the allowedPages arrays you read in Step 2.1).

**Step 2.4** — Update the Permission Properties subsection:
- Add `canManageRequests` if missing
- Add `capitalPartnerFilter` if missing
- Add `recruiterFilter` if missing
- Ensure all 8 roles are listed in the Role Hierarchy

**Step 2.5** — Verify your changes:
- Count the rows in your updated page table — should match the number of dashboard page.tsx files found in Phase 4.2 (13 dashboard pages)
- Verify every role's allowedPages array in the doc matches what you read from permissions.ts
- Read the section you just edited and confirm it's well-formatted

Report: "Phase 2 complete. Page access table updated from 10 to [X] rows. [X] permission properties added. Ready for Phase 3."
```

### Expected Outcome
- Page access table is accurate (phantom routes removed, real routes added)
- All 8 roles documented with correct allowedPages
- All permission properties listed

---

## PHASE 3: Add Prisma Models & Update Environment Variables

### Prompt

```
Continuing the bulk documentation update. You are editing docs/ARCHITECTURE.md ONLY.

PHASE 3: Document all Prisma models and fix the environment variables table.

**PART A: Prisma Models**

**Step 3.1** — Read `prisma/schema.prisma` in full. For each of the 17 models, record:
- Model name
- Field count
- Key fields (id, foreign keys, important business fields)
- Which feature area it belongs to

**Step 3.2** — Find where models are currently documented in ARCHITECTURE.md (Section 8 has WeeklyGoal and QuarterlyGoal). Decide: should you expand that section, or create a new dedicated subsection?

Recommendation: Add a new subsection `### Database Models (Prisma)` inside Section 2 (Data Layer), since that's where data sources are documented. Group models by feature area:

- **Core**: User, PasswordResetToken
- **SGA Hub**: WeeklyGoal, QuarterlyGoal, ManagerQuarterlyGoal
- **Explore**: ExploreFeedback
- **Games**: GameScore
- **Saved Reports**: SavedReport
- **Dashboard Requests**: DashboardRequest, RequestComment, RequestAttachment, RequestEditHistory, RequestNotification
- **Advisor Map**: AdvisorAddressOverride
- **GC Hub**: GcAdvisorPeriodData, GcAdvisorMapping, GcSyncLog

For each model, document in a table format:
| Model | Feature Area | Key Fields | Purpose |
Keep it concise — model name, area, 3-4 key fields, one-sentence purpose.

**Step 3.3** — Write the section and insert it into ARCHITECTURE.md.

**PART B: Environment Variables**

**Step 3.4** — Read `.env.example` in full.

**Step 3.5** — Update the Environment Variables table in Section 10 of ARCHITECTURE.md:

FIX: Change `GOOGLE_SHEETS_TEMPLATE_ID` to `GOOGLE_SHEETS_WEBAPP_URL` (name changed in code)

ADD these 19 missing variables (group by purpose):
- **Auth**: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
- **GCP**: GCP_PROJECT_ID
- **GC Hub Sheets**: GC_REVENUE_ESTIMATES_SHEET_ID, GC_PAYOUTS_TRACKER_SHEET_ID, GC_Q3_2025_SHEET_ID, GC_Q4_2025_SHEET_ID
- **Email**: SENDGRID_API_KEY, EMAIL_FROM, NEXT_PUBLIC_APP_URL
- **Rate Limiting**: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
- **Wrike Integration**: WRIKE_ACCESS_TOKEN, WRIKE_FOLDER_ID, WRIKE_WEBHOOK_SECRET
- **Metabase**: METABASE_SITE_URL, METABASE_SECRET_KEY, NEXT_PUBLIC_METABASE_SITE_URL, METABASE_API_EMAIL, METABASE_API_PASSWORD

For each variable, include: name, which environment (local/Vercel/both), and purpose. Match the existing table format.

**Step 3.6** — Verify:
- Count models in your new section — should be 17
- Count env vars in your updated table — should be ~29+ (matching .env.example)
- Read both sections and confirm formatting is consistent with rest of document

Report: "Phase 3 complete. 17 Prisma models documented. Env vars table expanded from 12 to [X]. Ready for Phase 4."
```

### Expected Outcome
- All 17 Prisma models documented in a new subsection
- Environment variables table is complete and accurate
- No source code modified

---

## PHASE 4: Document Undocumented Feature Areas (Part 1)

### Prompt

```
Continuing the bulk documentation update. You are editing docs/ARCHITECTURE.md ONLY.

PHASE 4: Add documentation for GC Hub, Dashboard Requests, and Notifications.

For each feature area below, you MUST:
1. Read EVERY route file to understand what it does (method, auth, query, purpose)
2. Read the main page.tsx or content component to understand the feature
3. Write a new section following the same format as Section 8 (SGA Hub)

**FEATURE 1: GC Hub (8 routes)**

Step 4.1 — Read these files:
- src/app/dashboard/gc-hub/page.tsx (or the content component it renders)
- src/app/api/gc-hub/advisors/route.ts
- src/app/api/gc-hub/advisor-detail/route.ts
- src/app/api/gc-hub/filters/route.ts
- src/app/api/gc-hub/summary/route.ts
- src/app/api/gc-hub/override/route.ts
- src/app/api/gc-hub/period/route.ts
- src/app/api/gc-hub/manual-sync/route.ts
- src/app/api/gc-hub/sync-status/route.ts

Step 4.2 — Write a new section (suggest: ## 11. GC Hub, or insert as ## 10 and bump Deployment to ## 11). Include:
- ### Overview (what it does, who uses it, what data source)
- ### API Routes table (route, method, auth, description)
- ### Key Features (sync from Google Sheets, manual overrides, period management)
- ### Related Models (reference the Prisma models from Phase 3)

**FEATURE 2: Dashboard Requests (10 routes)**

Step 4.3 — Read these files:
- src/app/dashboard/requests/page.tsx (or content component)
- src/app/api/dashboard-requests/route.ts (list/create)
- src/app/api/dashboard-requests/[id]/route.ts (get/update/delete)
- src/app/api/dashboard-requests/[id]/status/route.ts
- src/app/api/dashboard-requests/[id]/comments/route.ts
- src/app/api/dashboard-requests/[id]/attachments/route.ts
- src/app/api/dashboard-requests/[id]/attachments/[attachmentId]/route.ts
- src/app/api/dashboard-requests/[id]/archive/route.ts
- src/app/api/dashboard-requests/[id]/unarchive/route.ts
- src/app/api/dashboard-requests/kanban/route.ts
- src/app/api/dashboard-requests/recent/route.ts
- src/app/api/dashboard-requests/analytics/route.ts

Step 4.4 — Write a new section. Include:
- ### Overview (Kanban board for dashboard feature requests)
- ### API Routes table
- ### Key Features (Kanban view, comments, attachments, status workflow, analytics)
- ### Related Models (DashboardRequest, RequestComment, RequestAttachment, RequestEditHistory, RequestNotification)

**FEATURE 3: Notifications (4 routes)**

Step 4.5 — Read these files:
- src/app/api/notifications/route.ts
- src/app/api/notifications/[id]/read/route.ts
- src/app/api/notifications/mark-all-read/route.ts
- src/app/api/notifications/unread-count/route.ts

Step 4.6 — Write a subsection (can be part of Dashboard Requests section since notifications are tied to requests, or standalone). Include:
- ### Notifications API Routes table
- Brief description of notification system

**Step 4.7** — Verify:
- Every route file you read exists and you quoted actual exports/handlers from it
- Route count: GC Hub (8) + Dashboard Requests (10) + Notifications (4) = 22 routes documented
- All new sections follow the same formatting as Section 8
- Read each new section back and confirm it reads well

Report: "Phase 4 complete. Documented GC Hub (8 routes), Dashboard Requests (10 routes), Notifications (4 routes). 22 new routes documented. Ready for Phase 5."
```

### Expected Outcome
- Three new feature sections added to ARCHITECTURE.md
- 22 previously undocumented routes are now documented
- Each section follows the established format

---

## PHASE 5: Document Remaining Feature Areas & Missing Routes

### Prompt

```
Continuing the bulk documentation update. You are editing docs/ARCHITECTURE.md ONLY.

PHASE 5: Document all remaining undocumented features and add missing routes to existing sections.

**PART A: New Feature Sections (smaller features)**

For each feature below, read the route files and page component, then write a section.

**Recruiter Hub (3 routes)**
Read: src/app/api/recruiter-hub/prospects/route.ts, opportunities/route.ts, external-agencies/route.ts
Read: src/app/dashboard/recruiter-hub/page.tsx (or RecruiterHubContent.tsx)
Write: Section with overview + API routes table

**Advisor Map (2 routes)**
Read: src/app/api/advisor-map/locations/route.ts, overrides/route.ts
Read: src/app/dashboard/advisor-map/page.tsx
Write: Section with overview + API routes table + reference to AdvisorAddressOverride model

**Pipeline Catcher Game (3 routes)**
Read: src/app/api/games/pipeline-catcher/leaderboard/route.ts, levels/route.ts, play/[quarter]/route.ts
Read: src/app/dashboard/games/pipeline-catcher/page.tsx
Write: Section with overview + API routes table + reference to GameScore model

**SGA Activity (4 routes)**
Read: src/app/api/sga-activity/dashboard/route.ts, activity-records/route.ts, filters/route.ts, scheduled-calls/route.ts
Read: src/app/dashboard/sga-activity/page.tsx (or SGAActivityContent.tsx)
Write: Section with overview + API routes table

**Saved Reports (5 routes)**
Read: src/app/api/saved-reports/route.ts, [id]/route.ts, [id]/duplicate/route.ts, [id]/set-default/route.ts, default/route.ts
Write: Section or subsection with overview + API routes table + reference to SavedReport model

**PART B: Add Missing Routes to EXISTING Sections**

**Section 6 (Core Dashboard) — add these pipeline/SGM routes:**
Read each file first, then add to the existing API routes documentation:
- /api/dashboard/pipeline-by-sgm
- /api/dashboard/pipeline-drilldown
- /api/dashboard/pipeline-drilldown-sgm
- /api/dashboard/pipeline-sgm-options
- /api/dashboard/pipeline-summary
- /api/dashboard/sgm-conversion-drilldown
- /api/dashboard/sgm-conversions

**Section 8 (SGA Hub) — add these missing routes:**
- /api/sga-hub/admin-quarterly-progress
- /api/sga-hub/leaderboard
- /api/sga-hub/leaderboard-sga-options
- /api/sga-hub/manager-quarterly-goal

**Admin routes — add to relevant section:**
- /api/admin/trigger-transfer

**Auth routes — add to Section 5:**
- /api/auth/forgot-password
- /api/auth/permissions
- /api/auth/reset-password

**Cron routes — add to Section 10 (Deployment):**
- /api/cron/gc-hub-sync
- /api/cron/geocode-advisors
- /api/cron/trigger-transfer

**User routes — add to existing users documentation:**
- /api/users/me/change-password
- /api/users/taggable

**Other standalone routes:**
- /api/metabase/content (add brief note)
- /api/webhooks/wrike (add brief note)

**Step 5.1** — Verify route count. After this phase, ALL 90 routes should be documented. Run:
```powershell
Get-ChildItem -Path src/app/api -Recurse -Filter "route.ts" | Measure-Object
```
Count the routes documented in ARCHITECTURE.md. They should match.

**Step 5.2** — Read through every new section and every modified section. Confirm:
- No duplicate route entries
- Every route has: path, method(s), brief description
- Formatting is consistent throughout

Report: "Phase 5 complete. [X] routes added across new and existing sections. Total documented routes: [X]. Ready for Phase 6."
```

### Expected Outcome
- All 90 API routes are now documented
- 5 new feature sections added
- Missing routes added to 5 existing sections
- Route count in docs matches route count in code

---

## PHASE 6: Semantic Layer Update & Final Verification

### Prompt

```
Continuing the bulk documentation update. You are editing docs/ARCHITECTURE.md ONLY.

PHASE 6: Update Semantic Layer section + Table of Contents + Final verification.

**PART A: Semantic Layer (Section 9)**

Step 6.1 — Read src/lib/semantic-layer/query-templates.ts and confirm all 22 template IDs.
Step 6.2 — Read src/lib/semantic-layer/definitions.ts and confirm all metrics and dimensions.
Step 6.3 — Update Section 9's Query Templates table to list ALL 22 templates (currently partial). For each template, include: ID, description, typical question.
Step 6.4 — Verify the metrics list in Section 9 includes all metrics from definitions.ts.
Step 6.5 — Verify the dimensions list in Section 9 includes all 12 dimensions from definitions.ts.

**PART B: Update Vercel Cron Documentation**

Step 6.6 — Read vercel.json and confirm all cron schedules are documented in Section 10. Add any that are missing (gc-hub-sync, geocode-advisors, trigger-transfer schedules).

**PART C: Update Table of Contents**

Step 6.7 — Go to the Table of Contents at the top of ARCHITECTURE.md. Update it to reflect:
- All new sections added (GC Hub, Dashboard Requests, Recruiter Hub, Advisor Map, Games, SGA Activity, Saved Reports)
- Any renumbered sections
- All new subsections

**PART D: Update Document Maintenance section**

Step 6.8 — Find the "Document Maintenance" section at the bottom. Update the "Last Updated" date to today (2026-02-18) and add a note:
"Bulk update: documented all 90 API routes (previously ~30), all 17 Prisma models (previously 3), all 29 environment variables (previously 12), updated page access table to reflect all 16 pages, updated permissions for all 8 roles."

**PART E: Final Verification**

Step 6.9 — Run these checks and report results:

1. **Route count parity:**
   Run: Get-ChildItem -Path src/app/api -Recurse -Filter "route.ts" | Measure-Object
   Then search ARCHITECTURE.md for all route paths. Count them. Do they match?

2. **Model count parity:**
   Run: Select-String -Path prisma/schema.prisma -Pattern "^model "
   Count models documented in ARCHITECTURE.md. Do they match?

3. **Env var count parity:**
   Run: Select-String -Path .env.example -Pattern "^[A-Z]"
   Count env vars in the ARCHITECTURE.md table. Do they match?

4. **Page route parity:**
   Run: Get-ChildItem -Path src/app/dashboard -Recurse -Filter "page.tsx" | Measure-Object
   Count page routes in the access control table. Do they match? (Note: some non-dashboard pages like /login won't be in the table — that's expected)

5. **No phantom references:**
   Confirm these removed phantom pages are NOT in the document:
   - /dashboard/channels
   - /dashboard/partners
   - /dashboard/experiments
   - /dashboard/sga

6. **Formatting consistency:**
   Read the first 50 lines of 3 different new sections. Do they all follow the same header/table pattern?

7. **Line count:**
   What is the new total line count of ARCHITECTURE.md? Report old vs new.

Step 6.10 — Report final summary:

"Guide 0 COMPLETE. ARCHITECTURE.md updated:
- API routes: [old] → [new] (target: 90)
- Prisma models: [old] → [new] (target: 17)
- Env vars: [old] → [new] (target: 29)
- Page access table: [old rows] → [new rows]
- Sections: [old count] → [new count]
- Line count: [old] → [new]
- Phantom routes removed: 4
- All verification checks: PASS/FAIL"

If ANY verification check fails, fix the issue and re-run that check before reporting complete.
```

### Expected Outcome
- Semantic layer section is complete (22 templates, all metrics, all dimensions)
- Table of Contents is accurate
- All verification counts match
- Document maintenance date updated
- ARCHITECTURE.md is fully current

---

## Post-Completion: Manual Review Checklist

> **This section is for Russell, not Claude Code.**

After Claude Code reports Guide 0 complete, review these manually:

### Quick Scan
- [ ] Open `docs/ARCHITECTURE.md` in VS Code or your editor
- [ ] Scroll through — does the formatting look consistent?
- [ ] Check the Table of Contents — do the section numbers make sense?
- [ ] Spot-check 3 random new API route entries — do they accurately describe the route?

### Verify No Code Changes
Run in PowerShell:
```powershell
git diff --name-only
```
The ONLY file that should appear is `docs/ARCHITECTURE.md`. If any `.ts`, `.tsx`, `.js`, `.json`, or other source files appear, something went wrong — revert those changes.

### Commit
```powershell
git add docs/ARCHITECTURE.md
git commit -m "docs: bulk update ARCHITECTURE.md — document all 90 routes, 17 models, 29 env vars"
```

### Ready for Guide 1
Once committed, you're ready for **Guide 1: Generated Inventories + Standing Instructions**.