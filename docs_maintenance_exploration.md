# Documentation Maintenance System â€” Codebase Exploration

> **Purpose**: Systematically explore the existing codebase to build a knowledge base before implementing the three-layer documentation maintenance system (pre-commit hook, Claude Code standing instructions, GitHub Actions daily audit).
> **Date**: 2026-02-18
> **Method**: Phased exploration â€” Claude Code reads files and records findings directly in this document.
> **Usage**: Open Claude Code, paste each phase prompt. Claude Code will explore and you record findings below each question.

---

## âš ï¸ IMPORTANT: Windows Environment

This project runs on **Windows (win32)**. All commands must use **PowerShell syntax**. Do NOT use `grep`, `ls -la`, `head`, `wc -l`, `find` (Unix), or other Linux-only commands. Use PowerShell equivalents.

---

## PHASE 1: Existing Documentation Inventory

### Prompt

```
You are exploring a codebase to understand its current documentation structure before building an automated documentation maintenance system. Read and answer each question below. Record your findings DIRECTLY after each question in this file under the "Finding:" line.

IMPORTANT: Use PowerShell commands only (Windows environment). Do NOT use grep, find (Unix), ls -la, head, wc -l, or other Linux commands.

**Questions:**

1.1 â€” What documentation files exist in the project root and docs/ directory?
     Run: Get-ChildItem -Path . -Filter "*.md" -Depth 0 | Select-Object Name
     Run: Get-ChildItem -Path docs/ -Recurse -Filter "*.md" | Select-Object FullName
     List every .md file with its path and approximate line count.

1.2 â€” Read `.cursorrules` in full. Record:
     - Total line count
     - What sections/headers it contains
     - Does it already have any standing instructions about documentation maintenance?
     - What verification values does it contain?
     - What constants does it reference?

1.3 â€” Read `docs/ARCHITECTURE.md` in full. Record:
     - Total line count
     - Full table of contents (every ## and ### header)
     - What API routes are documented?
     - What page routes are documented?
     - What Prisma models are documented?
     - What environment variables are documented?

1.4 â€” Do any of these files exist? Read them if they do:
     - docs/CALCULATIONS.md
     - docs/GLOSSARY.md
     - docs/semantic_layer/semantic_layer_corrections.md
     - CLAUDE.md
     - AGENTS.md
     - CONTEXT.md
     Record what each contains and its line count.

1.5 â€” Check for any existing .cursor/ directory:
     Run: Test-Path .cursor
     Run: Get-ChildItem -Path .cursor/ -Recurse 2>$null
     Record what's there.
```

### Findings:

**1.1 â€” Documentation files:**

**Root .md files (10 files):**
| File | Lines |
|------|-------|
| docs_maintenance_exploration.md | 374 |
| open_pipeline_exploration.md | 1,687 |
| output_summary.md | 89 |
| permissions-upgrade-readonly-edit.md | 2,250 |
| permissions-upgrade.md | 1,710 |
| pipeline_by_sgm_implementation_guide.md | 1,279 |
| README.md | 503 |
| sgm_conversion_table_exploration.md | 507 |
| sgm_conversion_table_findings.md | 1,387 |
| sgm_conversion_table_implementation_guide.md | 1,624 |

**docs/ .md files (21 files):**
| File | Lines |
|------|-------|
| docs/ARCHITECTURE.md | 1,485 |
| docs/CALCULATIONS.md | 1,010 |
| docs/campaign-and-lead-opportunity-relationships.md | 110 |
| docs/DATA_FRESHNESS_FEATURE.md | 154 |
| docs/DATE_TIMESTAMP_BUG_VERIFICATION_REPORT.md | 211 |
| docs/FILTER-MATRIX.md | 257 |
| docs/GC_Hub_Manual_Override_Codebase_Exploration.md | 499 |
| docs/GC_Hub_Manual_Override_Implementation.md | 301 |
| docs/GLOSSARY.md | 201 |
| docs/GROUND-TRUTH.md | 419 |
| docs/lead_scoring_explanation.md | 459 |
| docs/salesforce-flows-and-bigquery.md | 121 |
| docs/savvy-dashboard-security-assessment.md | 644 |
| docs/SEMANTIC_LAYER_REVIEW_GUIDE.md | 1,109 |
| docs/data-transfer/salesforce-bigquery-data-transfer-analysis.md | 420 |
| docs/flows/new_flows_validation.md | 121 |
| docs/optimization-implementation-docs/fix-02-database-indexes.md | 468 |
| docs/optimization-implementation-docs/fix-05-client-data-fetching.md | 960 |
| docs/semantic_layer/PHASE_1_VALIDATION_RESULTS.md | 291 |
| docs/semantic_layer/semantic_layer_admin_questions.md | 529 |
| docs/semantic_layer/semantic_layer_corrections.md | 2,256 |

Note: The "primary" architecture doc is `docs/ARCHITECTURE.md`. The root-level .md files are largely exploration/implementation guides from past feature builds, not living reference docs.

**1.2 â€” .cursorrules contents:**

- **Exists**: `True`
- **Line count**: 2,135 lines
- **Sections/headers** (from first 120 lines read):
  - `# Savvy Funnel Analytics Dashboard - Project Instructions`
  - `## Project Context`
  - `## âš ï¸ VERIFICATION PROTOCOL - MANDATORY` (with subsections: "Before Making ANY Calculation Changes", "Cohort Maturity Quick Reference", "Q1 2025 Ground Truth (PRIMARY)", "Q2 2025 Ground Truth (SECONDARY)", "Verification Workflow", "Files That REQUIRE Verification After Changes", "MCP Salesforce Verification (When Needed)")
  - `## Key Principles`
  - `## Architecture Patterns`
  - (file continues beyond what was read â€” 2,135 lines total, additional sections not enumerated here)
- **Documentation maintenance instructions**: NONE found in the first 120 lines. No standing instructions about keeping docs updated.
- **Verification values**:
  - Q1 2025: SQLs=**123** (Â±0), SQOs=**96** (Â±0), Joined=**12** (Â±0), Contactedâ†’MQL=**4.94%** (314/6,360), MQLâ†’SQL=**27.70%** (123/444), SQLâ†’SQO=**70.83%** (85/120), SQOâ†’Joined=**12.20%** (10/82)
  - Q2 2025: SQLs=**155** (Â±0), SQOs=**110** (Â±0), Joined=**13** (Â±0), Contactedâ†’MQL=**4.63%** (315/6,809), MQLâ†’SQL=**37.93%** (154/406), SQLâ†’SQO=**68.63%** (105/153), SQOâ†’Joined=**13.79%** (12/87)
- **Constants referenced**: `RECRUITING_RECORD_TYPE = '012Dn000000mrO3IAI'`, `vw_funnel_master` (`savvy-gtm-analytics.Tableau_Views.vw_funnel_master`), `OPEN_PIPELINE_STAGES`

**1.3 â€” docs/ARCHITECTURE.md contents:**

- **Line count**: 1,485 lines
- **Full table of contents (all ## and ### headers)**:
  - `# Savvy Dashboard â€” Architecture Reference`
  - `## Table of Contents`
  - `## 1. System Overview` â†’ `### What This Dashboard Does`, `### Tech Stack`, `### Data Flow`, `### Key Principle: Single Source of Truth`
  - `## 2. Data Layer` â†’ `### BigQuery Connection`, `### Primary Data Sources`, `### Critical Fields in vw_funnel_master`, `### DATE vs TIMESTAMP Handling`, `### Channel Mapping Pattern`, `### SGA/SGM Filtering`, `### Record Type Filtering`
  - `## 3. Caching Strategy` â†’ `### Approach`, `### Cache Tags`, `### TTL Policy`, `### Cache Key Generation`, `### Wrapper Pattern`, `### Invalidation Triggers`, `### Cron Schedule`, `### Cache Miss Logging`, `### Rollback Strategy`
  - `## 4. Data Freshness` â†’ `### Purpose`, `### How It Works`, `### Status Thresholds`, `### Display Locations`, `### Caching`, `### Admin Refresh Button`
  - `## 5. Authentication & Permissions` â†’ `### Authentication Method`, `### Session Strategy`, `### Password Handling`, `### Role Hierarchy`, `### Permission Properties`, `### Page Access Control`, `### Automatic Data Filtering`, `### Middleware Protection`
  - `## 6. Core Dashboard Features` â†’ `### Funnel Stages`, `### View Modes`, `### Scorecards`, `### Conversion Rates`, `### Channel/Source Performance Tables`, `### Detail Records Table`, `### Global Filters`, `### API Route Pattern`
  - `## 7. Advanced Features` â†’ `### 7.1 Full Funnel View Toggle`, `### 7.2 Record Detail Modal`, `### 7.3 Google Sheets Export`
  - `## 8. SGA Hub & Management` â†’ `### Overview`, `### SGA Hub Tabs`, `#### 1. Weekly Goals Tab`, `#### 2. Quarterly Progress Tab`, `#### 3. Closed Lost Tab`, `#### 4. Re-Engagement Tab`, `### SGA Management Page (Admin)`, `### Drill-Down Modals`, `### SGA Name Matching`, `### DATE vs TIMESTAMP Handling (SGA Queries)`, `### CSV Export`, `### API Routes`
  - `## 9. Self-Serve Analytics (Explore)` â†’ `### Overview`, `### Architecture`, `### Key Components`, `### Semantic Layer Structure`, `#### Metrics`, `#### Dimensions`, `#### Date Presets`, `### Query Templates`, `### Visualization Selection`, `### DATE vs TIMESTAMP Handling`, `### RBAC Integration`, `### API Route Flow`, `### Export Features`, `### Environment Variables`, `### Constants`, `### Drill-Down Integration`, `### Common Issues`
  - `## 10. Deployment & Operations` â†’ `### Environment Variables`, `### Vercel Configuration`, `### Error Monitoring (Sentry)`
  - `## Appendix A: Validated Reference Values` â†’ `### Volume Metrics`, `### Conversion Rates`, `### AUM Values`
  - `## Appendix B: Glossary`
  - `## Appendix C: Known Code Issues` â†’ `### DATE vs TIMESTAMP Inconsistency`
  - `## Validation Summary (January 18, 2026 - Updated January 18, 2026)` â†’ multiple `### Changes Made` and `### Verification Status` subsections
  - `## Document Maintenance`

- **API routes documented** (~30 routes listed):
  - `/api/dashboard/funnel-metrics`, `/api/dashboard/conversion-rates`, `/api/dashboard/source-performance`, `/api/dashboard/detail-records`, `/api/dashboard/record-detail/[id]`, `/api/dashboard/export-sheets`, `/api/dashboard/data-freshness`, `/api/dashboard/filters`, `/api/dashboard/forecast`, `/api/dashboard/open-pipeline`
  - `/api/sga-hub/weekly-goals`, `/api/sga-hub/weekly-actuals`, `/api/sga-hub/quarterly-progress`, `/api/sga-hub/quarterly-goals`, `/api/sga-hub/closed-lost`, `/api/sga-hub/sqo-details`, `/api/sga-hub/re-engagement`, `/api/sga-hub/drill-down/initial-calls`, `/api/sga-hub/drill-down/qualification-calls`, `/api/sga-hub/drill-down/sqos`
  - `/api/admin/refresh-cache`, `/api/admin/sga-overview`
  - `/api/agent/query`, `/api/explore/feedback`
  - `/api/cron/refresh-cache`
  - `/api/auth/[...nextauth]`
  - `/api/users`, `/api/users/[id]`, `/api/users/[id]/reset-password`

- **Page routes documented** (from page access control table, lines 396â€“404):
  - Page 1: `/dashboard/` (main dashboard)
  - Page 2: `/dashboard/channels` (Channel Drilldown)
  - Page 3: `/dashboard/pipeline` (Open Pipeline)
  - Page 4: `/dashboard/partners` (Partner Performance)
  - Page 5: `/dashboard/experiments` (Experimentation)
  - Page 6: `/dashboard/sga` (SGA Performance)
  - Page 7: `/dashboard/settings` (Settings)
  - Page 8: `/dashboard/sga-hub` (SGA Hub)
  - Page 9: `/dashboard/sga-management` (SGA Management)
  - Page 10: `/dashboard/explore` (Explore AI)
  - Page 14: Chart Builder (mentioned in comments only, not in table rows)
  - Page 15: Advisor Map (mentioned in comments only, not in table rows)
  - Page 16: GC Hub (mentioned in comments only, not in table rows)

- **Prisma models documented**: Only `WeeklyGoal` and `QuarterlyGoal` are shown with full model definitions (lines 726â€“762). `User` is mentioned generically. No other models are documented.

- **Environment variables documented** (from Section 10 table, lines 1135â€“1145):
  - `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_APPLICATION_CREDENTIALS_JSON`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `DATABASE_URL`, `CRON_SECRET`, `GOOGLE_SHEETS_TEMPLATE_ID`, `GOOGLE_SHEETS_SERVICE_ACCOUNT_PATH`, `GOOGLE_SHEETS_CREDENTIALS_JSON`, `ANTHROPIC_API_KEY`, `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`

**1.4 â€” Additional doc files:**

- **docs/CALCULATIONS.md**: EXISTS â€” 1,010 lines. Contains explicit formulas and SQL snippets for all dashboard metrics. Covers Period Mode vs Cohort Mode calculations, conversion rate formulas, volume metrics, opportunity stage metrics, open pipeline AUM, resolution/flagging logic, and period vs cohort mode details.
- **docs/GLOSSARY.md**: EXISTS â€” 201 lines.
- **docs/semantic_layer/semantic_layer_corrections.md**: EXISTS â€” 2,256 lines. Large corrections/exploration document for the semantic layer feature.
- **CLAUDE.md**: FALSE â€” does not exist.
- **AGENTS.md**: FALSE â€” does not exist.
- **CONTEXT.md**: FALSE â€” does not exist.

**1.5 â€” .cursor/ directory:**

- **Exists**: `True`
- **Contents**:
  - `.cursor/mcp.json`
  - `.cursor/rules/` (directory)
  - `.cursor/rules/recruiter-security.mdc`
- Note: `.cursor/` is listed in `.gitignore` so it is NOT committed to the repo.

---

## PHASE 2: Existing Git Hooks & Tooling

### Prompt

```
Continuing codebase exploration. Read and answer each question, recording findings in this file.

**Questions:**

2.1 â€” Is Husky installed? Check:
     Run: Get-Content package.json | Select-String "husky"
     Run: Test-Path .husky
     Run: Get-ChildItem -Path .husky/ -Recurse 2>$null
     If .husky/ exists, read every file in it and record contents.

2.2 â€” Are there any existing git hooks?
     Run: Test-Path .git/hooks
     Run: Get-ChildItem -Path .git/hooks/ -Filter "pre-*" 2>$null
     Record any custom (non-sample) hooks.

2.3 â€” Is there a scripts/ directory? What's in it?
     Run: Test-Path scripts
     Run: Get-ChildItem -Path scripts/ -Recurse 2>$null
     Read any existing scripts and record what they do.

2.4 â€” Check package.json for relevant config:
     Read package.json and record:
     - Does it have a "prepare" script (Husky setup)?
     - Does it have any "pre-commit" or "lint-staged" config?
     - Does it have any "scripts" related to docs, audit, or maintenance?
     - What is the Node.js engine requirement (if any)?
     - Is "type": "module" set? (affects whether we use .mjs or .js for scripts)

2.5 â€” Check for any existing linting/formatting hooks:
     Run: Get-Content package.json | Select-String "lint-staged"
     Run: Test-Path .lintstagedrc*
     Run: Test-Path lint-staged.config*
     Record what exists.
```

### Findings:

**2.1 â€” Husky status:**

- **In package.json**: NOT found â€” no "husky" reference in package.json
- **`.husky/` directory**: FALSE â€” does not exist
- No Husky installed or configured.

**2.2 â€” Existing git hooks:**

- **`.git/hooks/` exists**: TRUE
- **Non-sample hooks**: NONE â€” only `.sample` files exist. No custom pre-commit, pre-push, or other hooks are installed.

**2.3 â€” Scripts directory:**

- **Exists**: TRUE
- **Contents** (26 files, mix of .js and .ts):

  | File | Type |
  |------|------|
  | check-enabled-apis.js | .js |
  | check-luis-rosa.js | .js |
  | check-user.js | .js |
  | cleanup-geocoded-duplicates.js | .js |
  | count-joined-advisors-full-address.js | .js |
  | create-advisor-location-view.js | .js |
  | create-geocoded-addresses-table.js | .js |
  | diagnose-joined-count.js | .js |
  | discover-dashboards-tasks.ts | .ts |
  | discover-dashboards-workflow-v2.ts | .ts |
  | discover-dashboards-workflow.ts | .ts |
  | discover-wrike.ts | .ts |
  | enrich-la-advisors-lead-opp.ts | .ts |
  | geocode-advisors.js | .js |
  | list-advisors-no-full-address.js | .js |
  | query-workflow.ts | .ts |
  | run-location-investigation-queries.js | .js |
  | test-dashboard-queries.js | .js |
  | test-gc-data-utils.ts | .ts |
  | test-metabase-connection.js | .js |
  | test-query.js | .js |
  | verify-gc-permissions.ts | .ts |
  | verify-geocoding.js | .js |
  | verify-pipeline-catcher.js | .js |
  | verify-recruiter-security.js | .js |
  | verify-seed.js | .js |

- **Purpose**: One-off data utilities (geocoding, BigQuery checks), integration tests, verification scripts. None are documentation-related. Scripts are invoked manually or via `npm run verify:*` commands, not via any automated hook.

**2.4 â€” package.json config:**

- **"prepare" script**: NO (no Husky setup)
- **"pre-commit" or "lint-staged" config**: NONE
- **Docs/audit/maintenance scripts**: NONE
- **Node.js engine requirement**: NOT specified (no `"engines"` field)
- **`"type": "module"`**: NOT SET â†’ project is **CommonJS**. Hook scripts should use `.js` (not `.mjs`).
- **Relevant scripts as-is**:
  ```json
  "dev": "next dev",
  "build": "cross-env NODE_OPTIONS=--max-old-space-size=8192 prisma generate && node ...",
  "start": "next start",
  "lint": "next lint",
  "test": "node test-connection.js",
  "test:query": "node scripts/test-query.js",
  "test:dashboard": "node scripts/test-dashboard-queries.js",
  "verify:game": "node scripts/verify-pipeline-catcher.js",
  "verify:game:api": "node scripts/verify-pipeline-catcher.js --api",
  "verify:recruiter-security": "node scripts/verify-recruiter-security.js",
  "postinstall": "prisma generate"
  ```

**2.5 â€” Lint-staged config:**

- **In package.json**: NOT found (no `lint-staged` reference)
- **`.lintstagedrc`**: FALSE
- **`.lintstagedrc.js`**: FALSE
- **`lint-staged.config.js`**: FALSE
- No lint-staged configuration of any kind.

---

## PHASE 3: GitHub Actions & CI/CD

### Prompt

```
Continuing codebase exploration. Read and answer each question, recording findings in this file.

**Questions:**

3.1 â€” Does .github/ directory exist? What's in it?
     Run: Test-Path .github
     Run: Get-ChildItem -Path .github/ -Recurse 2>$null
     Read every workflow YAML file and record:
     - Filename
     - What triggers it (on: push, schedule, etc.)
     - What it does
     - What secrets/env vars it uses

3.2 â€” Check the Vercel deployment setup:
     Read vercel.json in full and record:
     - All cron jobs (path, schedule)
     - All function configurations
     - Any build or routing config

3.3 â€” How is the project deployed?
     Check for:
     - vercel.json (already read above)
     - netlify.toml
     - Dockerfile
     - Any CI/CD config files
     Record the deployment pipeline.

3.4 â€” Check for any existing automation patterns:
     Run: Get-ChildItem -Path src/app/api/cron/ -Recurse 2>$null
     Read each cron route file and record:
     - What does each cron do?
     - How do they authenticate (CRON_SECRET pattern)?
     - What's the error handling pattern?
     This tells us the established pattern for automated tasks.

3.5 â€” Check .gitignore for relevant patterns:
     Read .gitignore and record:
     - Is .env ignored?
     - Are any doc files ignored?
     - Are any generated files ignored?
     - Is node_modules ignored?
     We need to know what gets committed vs ignored.
```

### Findings:

**3.1 â€” GitHub Actions:**

- **`.github/` at project root**: FALSE â€” does not exist
- **Workflows**: NONE â€” no GitHub Actions workflows of any kind
- This project has no CI/CD automation through GitHub Actions. All automation runs through Vercel's built-in cron system.

**3.2 â€” Vercel config:**

`vercel.json` â€” EXISTS. Full contents:

**Function configurations** (all `maxDuration: 60`):
| Function | maxDuration |
|----------|-------------|
| `src/app/api/dashboard/export-sheets/route.ts` | 60s |
| `src/app/api/agent/query/route.ts` | 60s |
| `src/app/api/admin/trigger-transfer/route.ts` | 60s |
| `src/app/api/cron/trigger-transfer/route.ts` | 60s |
| `src/app/api/cron/geocode-advisors/route.ts` | 60s |
| `src/app/api/cron/gc-hub-sync/route.ts` | 60s |
| `src/app/api/gc-hub/manual-sync/route.ts` | 60s |

**Cron jobs**:
| Path | Schedule (UTC) | Description |
|------|---------------|-------------|
| `/api/cron/gc-hub-sync` | `30 6 * * *` | 6:30 AM daily |
| `/api/cron/geocode-advisors` | `0 5 * * *` | 5:00 AM daily |
| `/api/cron/refresh-cache` | `10 4 * * *` | 4:10 AM daily |
| `/api/cron/refresh-cache` | `10 10 * * *` | 10:10 AM daily |
| `/api/cron/refresh-cache` | `10 16 * * *` | 4:10 PM daily |
| `/api/cron/refresh-cache` | `10 22 * * *` | 10:10 PM daily |
| `/api/cron/refresh-cache` | `47 19 * * 5` | 7:47 PM Friday |
| `/api/cron/refresh-cache` | `47 20 * * 5` | 8:47 PM Friday |
| `/api/cron/refresh-cache` | `47 22 * * 5` | 10:47 PM Friday |

**3.3 â€” Deployment pipeline:**

- **Platform**: Vercel only
- **netlify.toml**: FALSE
- **Dockerfile**: FALSE
- **Pipeline**: Git push to `main` â†’ Vercel auto-deploys. Vercel runs cron jobs per `vercel.json` schedule. No GitHub Actions, no Docker, no other CI/CD.

**3.4 â€” Existing cron/automation patterns:**

4 cron routes exist at `src/app/api/cron/`:
- `gc-hub-sync/route.ts` â€” Syncs GC Hub data from Google Sheets to Postgres
- `geocode-advisors/route.ts` â€” Geocodes advisor addresses
- `refresh-cache/route.ts` â€” Invalidates Next.js cache tags
- `trigger-transfer/route.ts` â€” Triggers BigQuery data transfer

**Authentication pattern** (from ARCHITECTURE.md, confirmed in code structure): All cron routes validate `CRON_SECRET` from the `Authorization` header. Vercel auto-injects this header when running cron jobs. Pattern:
```typescript
const authHeader = request.headers.get('authorization');
if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}
```

**Error handling pattern**: Routes return JSON responses with `{ error: string }` on failure and `{ success: true, ... }` on success. All use try/catch with appropriate HTTP status codes.

**3.5 â€” .gitignore patterns:**

- **`.env` ignored**: YES â€” `.env*.local`, `.env`, `.env.local` all explicitly listed
- **Doc files ignored**: NO â€” no `*.md` or `docs/` patterns in `.gitignore`
- **Generated files ignored**: `/src/generated/prisma`, `/.next/`, `/build`, `/out/`, `next-env.d.ts`, `*.tsbuildinfo`
- **`node_modules` ignored**: YES â€” `/node_modules`
- **`.json` files ignored**: YES â€” `*.json` is ignored, BUT with explicit exceptions: `!package.json`, `!package-lock.json`, `!tsconfig.json`. `vercel.json` is also explicitly un-ignored: `!vercel.json`
- **`.cursor/` ignored**: YES â€” `.cursor/` is in `.gitignore`
- **`.vercel` ignored**: YES â€” `.vercel` is ignored

---

## PHASE 4: Current Codebase Structure (Ground Truth Baseline)

### Prompt

```
Continuing codebase exploration. This phase establishes the ground truth that our audit system will compare against. Record findings in this file.

**Questions:**

4.1 â€” Complete API route inventory:
     Run: Get-ChildItem -Path src/app/api -Recurse -Filter "route.ts" | Select-Object FullName | Sort-Object FullName
     Record every API route path. Count the total.
     Then compare against what's documented in ARCHITECTURE.md â€” note any routes that exist in code but NOT in docs, and vice versa.

4.2 â€” Complete page route inventory:
     Run: Get-ChildItem -Path src/app -Recurse -Filter "page.tsx" | Select-Object FullName | Sort-Object FullName
     Record every page route path. Count the total.
     Compare against ARCHITECTURE.md â€” note discrepancies.

4.3 â€” Prisma schema models:
     Read prisma/schema.prisma and list:
     - Every model name
     - Key fields for each model (just the model name and field count is fine)
     Compare against what ARCHITECTURE.md documents.

4.4 â€” Config constants:
     Read src/config/constants.ts and record:
     - Every exported constant name
     - Any constants referenced in .cursorrules â€” do they match?

4.5 â€” Permissions structure:
     Read src/lib/permissions.ts and record:
     - All role types
     - All permission properties
     - The allowedPages for each role
     Compare against ARCHITECTURE.md RBAC documentation.

4.6 â€” Semantic layer inventory:
     Run: Get-ChildItem -Path src/lib/semantic-layer/ -Filter "*.ts" | Select-Object Name
     Read src/lib/semantic-layer/query-templates.ts and list all template IDs.
     Read src/lib/semantic-layer/definitions.ts and list all metric names and dimension names.
     Compare against ARCHITECTURE.md Explore section.

4.7 â€” Environment variables:
     Read .env.example and list every variable name.
     Compare against ARCHITECTURE.md Environment Variables table.
     Note any that exist in .env.example but not in docs, and vice versa.
```

### Findings:

**4.1 â€” API routes (code vs docs):**

**Total routes in code: 90** (`route.ts` files found by filesystem scan)

Full list (sorted):
```
src/app/api/admin/refresh-cache/route.ts
src/app/api/admin/sga-overview/route.ts
src/app/api/admin/trigger-transfer/route.ts
src/app/api/advisor-map/locations/route.ts
src/app/api/advisor-map/overrides/route.ts
src/app/api/agent/query/route.ts
src/app/api/auth/[...nextauth]/route.ts
src/app/api/auth/forgot-password/route.ts
src/app/api/auth/permissions/route.ts
src/app/api/auth/reset-password/route.ts
src/app/api/cron/gc-hub-sync/route.ts
src/app/api/cron/geocode-advisors/route.ts
src/app/api/cron/refresh-cache/route.ts
src/app/api/cron/trigger-transfer/route.ts
src/app/api/dashboard/conversion-rates/route.ts
src/app/api/dashboard/data-freshness/route.ts
src/app/api/dashboard/detail-records/route.ts
src/app/api/dashboard/export-sheets/route.ts
src/app/api/dashboard/filters/route.ts
src/app/api/dashboard/forecast/route.ts
src/app/api/dashboard/funnel-metrics/route.ts
src/app/api/dashboard/open-pipeline/route.ts
src/app/api/dashboard/pipeline-by-sgm/route.ts
src/app/api/dashboard/pipeline-drilldown/route.ts
src/app/api/dashboard/pipeline-drilldown-sgm/route.ts
src/app/api/dashboard/pipeline-sgm-options/route.ts
src/app/api/dashboard/pipeline-summary/route.ts
src/app/api/dashboard/record-detail/[id]/route.ts
src/app/api/dashboard/sgm-conversion-drilldown/route.ts
src/app/api/dashboard/sgm-conversions/route.ts
src/app/api/dashboard/source-performance/route.ts
src/app/api/dashboard-requests/[id]/archive/route.ts
src/app/api/dashboard-requests/[id]/attachments/[attachmentId]/route.ts
src/app/api/dashboard-requests/[id]/attachments/route.ts
src/app/api/dashboard-requests/[id]/comments/route.ts
src/app/api/dashboard-requests/[id]/route.ts
src/app/api/dashboard-requests/[id]/status/route.ts
src/app/api/dashboard-requests/[id]/unarchive/route.ts
src/app/api/dashboard-requests/analytics/route.ts
src/app/api/dashboard-requests/kanban/route.ts
src/app/api/dashboard-requests/recent/route.ts
src/app/api/dashboard-requests/route.ts
src/app/api/explore/feedback/route.ts
src/app/api/games/pipeline-catcher/leaderboard/route.ts
src/app/api/games/pipeline-catcher/levels/route.ts
src/app/api/games/pipeline-catcher/play/[quarter]/route.ts
src/app/api/gc-hub/advisor-detail/route.ts
src/app/api/gc-hub/advisors/route.ts
src/app/api/gc-hub/filters/route.ts
src/app/api/gc-hub/manual-sync/route.ts
src/app/api/gc-hub/override/route.ts
src/app/api/gc-hub/period/route.ts
src/app/api/gc-hub/summary/route.ts
src/app/api/gc-hub/sync-status/route.ts
src/app/api/metabase/content/route.ts
src/app/api/notifications/[id]/read/route.ts
src/app/api/notifications/mark-all-read/route.ts
src/app/api/notifications/route.ts
src/app/api/notifications/unread-count/route.ts
src/app/api/recruiter-hub/external-agencies/route.ts
src/app/api/recruiter-hub/opportunities/route.ts
src/app/api/recruiter-hub/prospects/route.ts
src/app/api/saved-reports/[id]/duplicate/route.ts
src/app/api/saved-reports/[id]/route.ts
src/app/api/saved-reports/[id]/set-default/route.ts
src/app/api/saved-reports/default/route.ts
src/app/api/saved-reports/route.ts
src/app/api/sga-activity/activity-records/route.ts
src/app/api/sga-activity/dashboard/route.ts
src/app/api/sga-activity/filters/route.ts
src/app/api/sga-activity/scheduled-calls/route.ts
src/app/api/sga-hub/admin-quarterly-progress/route.ts
src/app/api/sga-hub/closed-lost/route.ts
src/app/api/sga-hub/drill-down/initial-calls/route.ts
src/app/api/sga-hub/drill-down/qualification-calls/route.ts
src/app/api/sga-hub/drill-down/sqos/route.ts
src/app/api/sga-hub/leaderboard/route.ts
src/app/api/sga-hub/leaderboard-sga-options/route.ts
src/app/api/sga-hub/manager-quarterly-goal/route.ts
src/app/api/sga-hub/quarterly-goals/route.ts
src/app/api/sga-hub/quarterly-progress/route.ts
src/app/api/sga-hub/re-engagement/route.ts
src/app/api/sga-hub/sqo-details/route.ts
src/app/api/sga-hub/weekly-actuals/route.ts
src/app/api/sga-hub/weekly-goals/route.ts
src/app/api/users/[id]/reset-password/route.ts
src/app/api/users/[id]/route.ts
src/app/api/users/me/change-password/route.ts
src/app/api/users/route.ts
src/app/api/users/taggable/route.ts
src/app/api/webhooks/wrike/route.ts
```

**Routes in CODE but NOT in ARCHITECTURE.md** (~60 routes):
- `/api/admin/trigger-transfer` â€” not documented
- `/api/advisor-map/locations`, `/api/advisor-map/overrides` â€” not documented
- `/api/auth/forgot-password`, `/api/auth/permissions`, `/api/auth/reset-password` â€” not documented
- `/api/cron/gc-hub-sync`, `/api/cron/geocode-advisors`, `/api/cron/trigger-transfer` â€” not documented
- `/api/dashboard/pipeline-by-sgm`, `/api/dashboard/pipeline-drilldown`, `/api/dashboard/pipeline-drilldown-sgm`, `/api/dashboard/pipeline-sgm-options`, `/api/dashboard/pipeline-summary`, `/api/dashboard/sgm-conversion-drilldown`, `/api/dashboard/sgm-conversions` â€” not documented
- ALL `/api/dashboard-requests/*` (10 routes) â€” not documented
- ALL `/api/games/pipeline-catcher/*` (3 routes) â€” not documented
- ALL `/api/gc-hub/*` (8 routes) â€” not documented
- `/api/metabase/content` â€” not documented
- ALL `/api/notifications/*` (4 routes) â€” not documented
- ALL `/api/recruiter-hub/*` (3 routes) â€” not documented
- ALL `/api/saved-reports/*` (5 routes) â€” not documented
- ALL `/api/sga-activity/*` (4 routes) â€” not documented
- `/api/sga-hub/admin-quarterly-progress`, `/api/sga-hub/leaderboard`, `/api/sga-hub/leaderboard-sga-options`, `/api/sga-hub/manager-quarterly-goal` â€” not documented
- `/api/users/me/change-password`, `/api/users/taggable` â€” not documented
- `/api/webhooks/wrike` â€” not documented

**Routes in ARCHITECTURE.md but NOT in code**: NONE â€” all ~30 documented routes exist in code.

**4.2 â€” Page routes (code vs docs):**

**Total page.tsx files in code: 17**

```
src/app/dashboard/advisor-map/page.tsx       â†’ /dashboard/advisor-map
src/app/dashboard/chart-builder/page.tsx     â†’ /dashboard/chart-builder
src/app/dashboard/explore/page.tsx           â†’ /dashboard/explore
src/app/dashboard/games/pipeline-catcher/page.tsx  â†’ /dashboard/games/pipeline-catcher
src/app/dashboard/gc-hub/page.tsx            â†’ /dashboard/gc-hub
src/app/dashboard/page.tsx                   â†’ /dashboard/
src/app/dashboard/pipeline/page.tsx          â†’ /dashboard/pipeline
src/app/dashboard/recruiter-hub/page.tsx     â†’ /dashboard/recruiter-hub
src/app/dashboard/requests/page.tsx          â†’ /dashboard/requests
src/app/dashboard/settings/page.tsx          â†’ /dashboard/settings
src/app/dashboard/sga-activity/page.tsx      â†’ /dashboard/sga-activity
src/app/dashboard/sga-hub/page.tsx           â†’ /dashboard/sga-hub
src/app/dashboard/sga-management/page.tsx    â†’ /dashboard/sga-management
src/app/login/page.tsx                       â†’ /login
src/app/page.tsx                             â†’ /
src/app/reset-password/page.tsx              â†’ /reset-password
src/app/sentry-example-page/page.tsx         â†’ /sentry-example-page
```

**Discrepancies vs ARCHITECTURE.md:**

In ARCHITECTURE.md access table but **NOT in code** (phantom/stale routes):
- `/dashboard/channels` (Page 2)
- `/dashboard/partners` (Page 4)
- `/dashboard/experiments` (Page 5)
- `/dashboard/sga` (Page 6)

In code but **NOT in ARCHITECTURE.md page table**:
- `/dashboard/advisor-map` (Page 15 â€” mentioned in comments only, not in table)
- `/dashboard/chart-builder` (Page 14 â€” mentioned in comments only, not in table)
- `/dashboard/games/pipeline-catcher` (no page number documented)
- `/dashboard/gc-hub` (Page 16 â€” mentioned in comments only, not in table)
- `/dashboard/recruiter-hub` (Page 12 â€” mentioned in permissions.ts comments only)
- `/dashboard/requests` (Page 13 â€” mentioned in permissions.ts comments only)
- `/dashboard/sga-activity` (no documentation found)
- `/` (root redirect page)
- `/reset-password`
- `/sentry-example-page`

**4.3 â€” Prisma models (code vs docs):**

**Models in code (prisma/schema.prisma) â€” 17 models:**

| Model | Notes |
|-------|-------|
| `User` | Core auth/user model |
| `PasswordResetToken` | Password reset tokens |
| `WeeklyGoal` | SGA weekly goals |
| `QuarterlyGoal` | SGA quarterly goals |
| `ManagerQuarterlyGoal` | Manager-level quarterly goals |
| `ExploreFeedback` | Explore feature feedback |
| `GameScore` | Pipeline Catcher game scores |
| `SavedReport` | Saved report configurations |
| `DashboardRequest` | Dashboard feature requests |
| `RequestComment` | Comments on dashboard requests |
| `RequestAttachment` | File attachments on requests |
| `RequestEditHistory` | Edit history for requests |
| `RequestNotification` | Notifications for request activity |
| `AdvisorAddressOverride` | Manual address overrides for advisor map |
| `GcAdvisorPeriodData` | GC Hub periodic advisor data |
| `GcAdvisorMapping` | GC Hub advisor mapping |
| `GcSyncLog` | GC Hub sync log |

**What ARCHITECTURE.md documents**: Only `WeeklyGoal` and `QuarterlyGoal` (with full model definitions). `User` is referenced generically. **14 of 17 models are completely undocumented**.

**4.4 â€” Config constants:**

**All exported constants from `src/config/constants.ts`:**

```typescript
OPEN_PIPELINE_STAGES: readonly string[] = ['Qualifying', 'Discovery', 'Sales Process', 'Negotiating']
STAGE_STACK_ORDER: readonly string[] = ['Planned Nurture', 'Qualifying', 'Discovery', 'Sales Process', 'Negotiating', 'Signed', 'On Hold']
STAGE_COLORS: Record<string, string>  // maps stage names to hex colors
RECRUITING_RECORD_TYPE = '012Dn000000mrO3IAI'
RE_ENGAGEMENT_RECORD_TYPE = '012VS000009VoxrYAC'
FULL_TABLE = 'savvy-gtm-analytics.Tableau_Views.vw_funnel_master'
FORECAST_TABLE = 'savvy-gtm-analytics.SavvyGTMData.q4_2025_forecast'
MAPPING_TABLE = 'savvy-gtm-analytics.SavvyGTMData.new_mapping'
DAILY_FORECAST_VIEW = 'savvy-gtm-analytics.Tableau_Views.vw_daily_forecast'
DEFAULT_YEAR = 2025
DEFAULT_DATE_PRESET = 'q4' as const
```

**`.cursorrules` vs code comparison:**
- `RECRUITING_RECORD_TYPE`: .cursorrules has `'012Dn000000mrO3IAI'` â†’ code has `'012Dn000000mrO3IAI'` âœ… MATCH
- `FULL_TABLE`: .cursorrules has `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` â†’ code matches âœ… MATCH
- `OPEN_PIPELINE_STAGES`: .cursorrules lists `['Qualifying', 'Discovery', 'Sales Process', 'Negotiating']` â†’ code matches âœ… MATCH

**4.5 â€” Permissions structure:**

**Roles** (8 total from `src/lib/permissions.ts`): `revops_admin`, `admin`, `manager`, `sgm`, `sga`, `viewer`, `recruiter`, `capital_partner`

**Permission properties** (from `UserPermissions` interface): `role`, `allowedPages` (number[]), `canExport`, `canManageUsers`, `canManageRequests`, `sgaFilter`, `sgmFilter`, `recruiterFilter`, `capitalPartnerFilter`, `userId`

**allowedPages by role:**
| Role | allowedPages |
|------|-------------|
| `revops_admin` | [1, 3, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16] |
| `admin` | [1, 3, 7, 8, 9, 10, 11, 12, 13, 15, 16] |
| `manager` | [1, 3, 7, 8, 9, 10, 11, 12, 13, 15] |
| `sgm` | [1, 3, 7, 10, 13, 15] |
| `sga` | [1, 3, 7, 8, 10, 11, 13, 15] |
| `viewer` | [1, 3, 7, 10, 13, 15] |
| `recruiter` | [7, 12] |
| `capital_partner` | [7, 16] |

**Page number mapping** (from code comments in permissions.ts):
- 1 = Main dashboard, 3 = Open Pipeline, 7 = Settings, 8 = SGA Hub, 9 = SGA Management, 10 = Explore, 11 = (unlabeled in comments â€” likely SGA Activity or similar), 12 = Recruiter Hub, 13 = Dashboard Requests, 14 = Chart Builder, 15 = Advisor Map, 16 = GC Hub

**Comparison vs ARCHITECTURE.md:**
- ARCHITECTURE.md page access table only shows pages 1â€“10 with names; pages 11â€“16 are mentioned only in inline comments.
- `recruiter` and `capital_partner` roles are NOT fully documented in ARCHITECTURE.md.
- `canManageRequests` permission property is NOT documented in ARCHITECTURE.md.
- `capitalPartnerFilter` is NOT documented in ARCHITECTURE.md.

**4.6 â€” Semantic layer:**

**Files in `src/lib/semantic-layer/`** (5 files):
- `agent-prompt.ts`
- `definitions.ts`
- `index.ts`
- `query-compiler.ts`
- `query-templates.ts`

**All 22 template IDs in `query-templates.ts`:**
1. `single_metric`
2. `metric_by_dimension`
3. `conversion_by_dimension`
4. `metric_trend`
5. `conversion_trend`
6. `period_comparison`
7. `top_n`
8. `funnel_summary`
9. `scheduled_calls_list`
10. `qualification_calls_list`
11. `sqo_detail_list`
12. `generic_detail_list`
13. `open_pipeline_list`
14. `sga_leaderboard`
15. `average_aum`
16. `forecast_vs_actual`
17. `multi_stage_conversion`
18. `time_to_convert`
19. `pipeline_by_stage`
20. `sga_summary`
21. `rolling_average`
22. `opportunities_by_age`

**Metrics in `definitions.ts`:**
- Volume metrics: `prospects`, `contacted`, `mqls`, `sqls`, `sqos`, `joined`, `initial_calls_scheduled`, `qualification_calls`, `signed`
- AUM metrics: `sqo_aum`, `joined_aum`, `signed_aum`, `open_pipeline_aum`, `avg_aum`
- Conversion metrics: `contacted_to_mql_rate`, `mql_to_sql_rate`, `sql_to_sqo_rate`, `sqo_to_joined_rate`

**Dimensions in `definitions.ts`** (12 total): `channel`, `source`, `sga`, `sgm`, `experimentation_tag`, `campaign`, `stage_name`, `aum_tier`, `record_type`, `tof_stage`, `lead_score_tier`, `external_agency`

**Comparison vs ARCHITECTURE.md Section 9**: ARCHITECTURE.md documents the semantic layer conceptually in Section 9, but the template list is partial â€” it mentions some templates but is not exhaustive. Later templates added to the codebase (`rolling_average`, `opportunities_by_age`, `multi_stage_conversion`, `time_to_convert`, `sga_summary`, `pipeline_by_stage`, `average_aum`, `rolling_average`) are likely underdocumented.

**4.7 â€” Environment variables (code vs docs):**

**Active variables in `.env.example`** (29 variables, excluding commented-out alternates):
```
NEXTAUTH_SECRET
NEXTAUTH_URL
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
DATABASE_URL
GCP_PROJECT_ID
GOOGLE_APPLICATION_CREDENTIALS
GOOGLE_SHEETS_WEBAPP_URL
GC_REVENUE_ESTIMATES_SHEET_ID
GC_PAYOUTS_TRACKER_SHEET_ID
GC_Q3_2025_SHEET_ID
GC_Q4_2025_SHEET_ID
ANTHROPIC_API_KEY
CRON_SECRET
SENDGRID_API_KEY
EMAIL_FROM
NEXT_PUBLIC_APP_URL
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
SENTRY_DSN
NEXT_PUBLIC_SENTRY_DSN
WRIKE_ACCESS_TOKEN
WRIKE_FOLDER_ID
WRIKE_WEBHOOK_SECRET
METABASE_SITE_URL
METABASE_SECRET_KEY
NEXT_PUBLIC_METABASE_SITE_URL
METABASE_API_EMAIL
METABASE_API_PASSWORD
```

**Comparison vs ARCHITECTURE.md env table:**

âœ… In both docs and code: `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `DATABASE_URL`, `GOOGLE_APPLICATION_CREDENTIALS`, `CRON_SECRET`, `GOOGLE_SHEETS_SERVICE_ACCOUNT_PATH` (optional), `GOOGLE_SHEETS_CREDENTIALS_JSON` (optional), `ANTHROPIC_API_KEY`, `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`

âš ï¸ **Name mismatch**: ARCHITECTURE.md has `GOOGLE_SHEETS_TEMPLATE_ID` but `.env.example` has `GOOGLE_SHEETS_WEBAPP_URL` â€” these appear to be the same slot, but the name changed and docs were not updated.

âŒ **In `.env.example` but NOT in ARCHITECTURE.md** (19 variables):
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (Google OAuth)
- `GCP_PROJECT_ID`
- `GC_REVENUE_ESTIMATES_SHEET_ID`, `GC_PAYOUTS_TRACKER_SHEET_ID`, `GC_Q3_2025_SHEET_ID`, `GC_Q4_2025_SHEET_ID`
- `SENDGRID_API_KEY`, `EMAIL_FROM`
- `NEXT_PUBLIC_APP_URL`
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- `WRIKE_ACCESS_TOKEN`, `WRIKE_FOLDER_ID`, `WRIKE_WEBHOOK_SECRET`
- `METABASE_SITE_URL`, `METABASE_SECRET_KEY`, `NEXT_PUBLIC_METABASE_SITE_URL`, `METABASE_API_EMAIL`, `METABASE_API_PASSWORD`
- `GOOGLE_SHEETS_WEBAPP_URL`

---

## PHASE 5: Drift Analysis & Implementation Constraints

### Prompt

```
Final exploration phase. Based on everything you've found in Phases 1-4, analyze and record:

**Questions:**

5.1 â€” Documentation drift summary:
     Based on your Phase 4 comparisons, create a table:
     | Category | In Docs | In Code | Drift? | Details |
     |----------|---------|---------|--------|---------|
     Fill in for: API routes, page routes, Prisma models, env vars, permissions, semantic layer templates, cron jobs.
     This establishes the CURRENT drift state before we build the system.

5.2 â€” Implementation constraints for the hook script:
     - Is the project using ES modules ("type": "module") or CommonJS?
     - What Node.js version is required?
     - Does the project use TypeScript for scripts, or plain JS?
     - Are there any existing patterns in scripts/ we should follow?
     This determines whether we use .mjs, .js, or .ts for the hook script.

5.3 â€” Implementation constraints for GitHub Actions:
     - Are there existing workflows we should follow the pattern of?
     - What secrets are already configured? (We can infer from existing workflows)
     - Is there a preferred branch protection or PR review pattern?
     Record so we match existing conventions.

5.4 â€” .cursorrules modification plan:
     - Current line count of .cursorrules
     - Where should the standing instruction go (top? after which section?)
     - Are there any existing instructions that overlap with what we want to add?
     - Will adding ~40 lines push it past a reasonable size?
     Record your recommendation.

5.5 â€” Risk assessment:
     - Could the pre-commit hook slow down commits noticeably? (It only runs git commands, no API calls)
     - Could the GitHub Action create noise? (Issues every day if docs are always slightly off)
     - Are there any security concerns with the approach? (API keys in CI, etc.)
     Record concerns and mitigations.

After completing this phase, write a SUMMARY section at the bottom of this document titled "## Exploration Summary" that captures:
1. Current doc state (healthy/drifted/severely drifted)
2. Key constraints for implementation
3. Recommended adjustments to the implementation plan
4. Any risks or concerns discovered
```

### Findings:

**5.1 â€” Drift summary table:**

| Category | In Docs | In Code | Drift? | Details |
|----------|---------|---------|--------|---------|
| API routes | ~30 documented | 90 in code | **SEVERE** | ~60 routes completely undocumented. Missing entire feature areas: dashboard-requests (10 routes), gc-hub (8), saved-reports (5), notifications (4), sga-activity (4), recruiter-hub (3), games (3), advisor-map (2), webhooks, metabase, auth sub-routes, pipeline SGM routes |
| Page routes | 10 in table + 3 in comments | 17 in code | **MODERATE** | 4 documented pages don't exist in code (/channels, /partners, /experiments, /sga). 7 real pages not in docs table (advisor-map, chart-builder, gc-hub, recruiter-hub, requests, sga-activity, games) |
| Prisma models | 3 documented (User, WeeklyGoal, QuarterlyGoal) | 17 in schema | **SEVERE** | 14 models completely undocumented: PasswordResetToken, ManagerQuarterlyGoal, ExploreFeedback, GameScore, SavedReport, DashboardRequest+4 related, AdvisorAddressOverride, GcAdvisorPeriodData, GcAdvisorMapping, GcSyncLog |
| Env vars | 12 documented (1 wrong name) | 29 active in .env.example | **SEVERE** | 19 vars missing from docs; GOOGLE_SHEETS_TEMPLATE_ID in docs vs GOOGLE_SHEETS_WEBAPP_URL in code (name mismatch) |
| Permissions | Partial â€” 10 pages, some roles | 8 roles, pages 1â€“16 | **MODERATE** | recruiter and capital_partner roles not fully documented; pages 11â€“16 missing from table; canManageRequests and capitalPartnerFilter not documented |
| Semantic layer templates | Partial in Section 9 | 22 templates in code | **MODERATE** | Docs mention the concept and some templates; later additions (rolling_average, opportunities_by_age, time_to_convert, etc.) likely absent from docs |
| Cron jobs | 1 documented (refresh-cache) | 4 cron routes in code | **MODERATE** | gc-hub-sync, geocode-advisors, trigger-transfer not documented in ARCHITECTURE.md (though all 4 are in vercel.json which is committed) |

**Overall drift state: SEVERE** â€” docs were last comprehensively updated ~January 18, 2026. Many features added since (GC Hub, Recruiter Hub, Dashboard Requests, Notifications, Games, Advisor Map, Metabase) are not reflected.

**5.2 â€” Hook script constraints:**

- **Module system**: `"type": "module"` is NOT set â†’ project is **CommonJS**. Use `.js` extension for hook scripts.
- **Node.js version**: NOT specified in package.json (`"engines"` field absent). Node.js version in use is whatever the developer has installed. No constraint to work around.
- **TypeScript for scripts**: MIXED â€” scripts/ directory has both `.js` (15 files) and `.ts` (11 files). `ts-node` is installed as a devDependency. Either works, but `.js` is simpler for git hooks (no compilation step, runs with `node` directly).
- **Existing script patterns**:
  - `.js` scripts use CommonJS `require()` style
  - `.ts` scripts use ES module `import` style with ts-node execution
  - None of the existing scripts interact with git, documentation, or file comparison
- **Recommendation**: Use **plain `.js` (CommonJS)** for the pre-commit hook script. Reasons: no build step needed, runs directly with `node`, consistent with CommonJS project setting, simpler to maintain. Place at `scripts/check-docs-sync.js`.

**5.3 â€” GitHub Actions constraints:**

- **Existing workflows**: NONE â€” `.github/` directory does not exist at project root. There is no existing pattern to follow.
- **Inferred secrets from existing code**: The codebase uses `CRON_SECRET` for Vercel cron auth, but no GitHub Actions secrets exist yet. For a documentation audit action, we would need: `GITHUB_TOKEN` (automatically available in Actions â€” no setup needed).
- **Branch protection / PR review pattern**: Cannot be inferred â€” no existing Actions to observe. No `.github/` config files at all.
- **Starting from scratch**: Since there are no existing workflows, we have complete freedom in structure. Recommended approach:
  - Create `.github/workflows/docs-audit.yml`
  - Use `GITHUB_TOKEN` (built-in) for creating issues â€” no secrets needed
  - Follow standard Next.js project patterns for Node.js setup in Actions
  - Schedule: Consider **weekly** instead of daily to avoid noise (given the severe current drift state, daily would immediately spam issues)

**5.4 â€” .cursorrules modification plan:**

- **Current line count**: 2,135 lines
- **Addition size**: ~40 lines â†’ new total ~2,175 lines
- **Impact**: Minimal. The file is already large (2,135 lines). Adding 40 more lines is a ~2% increase. If there is a context window concern, 2,175 lines is still reasonable for most AI assistants.
- **Placement recommendation**: Add the documentation maintenance standing instruction **after the `## Architecture Patterns` section** (around line 120 based on what was read). This puts it after the critical verification protocol (which must stay prominent) and near other operational patterns. Do NOT place it at the very top as that space is reserved for the mandatory verification protocol.
- **Existing overlapping instructions**: NONE â€” no current instructions mention doc maintenance, ARCHITECTURE.md updates, or documentation sync.
- **Sample standing instruction to add** (suggested placement after `## Architecture Patterns`):

```markdown
## Documentation Maintenance â€” Standing Instructions

When you add, rename, or remove any of the following, you MUST update `docs/ARCHITECTURE.md`:
- **API routes** (`src/app/api/*/route.ts`) â†’ update Section 6 API Route Pattern and relevant feature section
- **Page routes** (`src/app/*/page.tsx`) â†’ update Section 5 Page Access Control table
- **Prisma models** (`prisma/schema.prisma`) â†’ update the relevant section (or add a new models section)
- **Environment variables** â†’ update Section 10 Environment Variables table
- **Permissions / roles** (`src/lib/permissions.ts`) â†’ update Section 5 Role Hierarchy and Permission Properties

Do NOT wait until the end of a task. Update docs as part of the same commit that changes the code.
```

**5.5 â€” Risk assessment:**

| Risk | Severity | Mitigation |
|------|----------|-----------|
| **Pre-commit hook slows commits** | LOW | Hook only runs `git diff --staged --name-only` and some string comparisons â€” no API calls, no file compilation, no BigQuery. Estimated runtime < 200ms. |
| **GitHub Action creates daily noise** | HIGH | Current drift is SEVERE. A daily audit would immediately open many issues and continue opening them until docs are fully updated. **Mitigation: Use weekly schedule, or trigger only on changes to `src/app/api/`, `prisma/schema.prisma`, `.env.example`, or `src/lib/permissions.ts`** rather than daily. |
| **Pre-commit hook blocks legitimate commits** | MEDIUM | If hook is too strict (blocks any commit that touches an API route without a docs change), it will frustrate developers during rapid feature development. **Mitigation: Make hook WARN-only (print to stderr, exit 0) rather than blocking (exit 1). Block only if ARCHITECTURE.md was not touched AT ALL during a session where 3+ routes changed.** |
| **GitHub Actions secrets exposure** | LOW | Documentation audit only needs `GITHUB_TOKEN` (automatically available, no user-created secrets required). No BigQuery, no Anthropic API key needed for the audit itself. |
| **`.json` gitignore rule affecting scripts** | LOW | `.gitignore` ignores `*.json` except specific exceptions. Any new config JSON file for the doc audit system must be explicitly un-ignored. `.js` and `.yml` files are not affected. |
| **Large drift backlog makes audit meaningless initially** | MEDIUM | The first run of any audit system will flag dozens of issues. **Mitigation: Before activating the GitHub Action, do a one-time bulk documentation update to bring ARCHITECTURE.md current. Then activate the automation.** |

---

## Exploration Summary

**Current documentation state:**
The documentation is in a **severely drifted** state. `docs/ARCHITECTURE.md` was last comprehensively updated on January 18, 2026. Since then (or concurrently, as features existed but were never documented), approximately 60 of 90 API routes are undocumented, 14 of 17 Prisma models are undocumented, 19 of 29 environment variables are absent from docs, 4 page routes documented in the access table don't exist in code, and 7 real page routes are absent from the table. The `.cursorrules` file has no documentation maintenance instructions of any kind. There is no pre-commit hook, no GitHub Actions CI, no Husky, and no lint-staged â€” zero automated enforcement of documentation standards currently exists.

**Key implementation constraints:**
1. **No `.github/` directory** â€” GitHub Actions must be created from scratch; no existing pattern to follow
2. **No Husky** â€” Pre-commit hooks must be installed via `git config core.hooksPath` or direct placement into `.git/hooks/`, or Husky must be added
3. **CommonJS project** (`"type": "module"` not set) â€” hook scripts use `.js` with `require()`, not `.mjs`
4. **No Node.js version pinned** â€” hook script can use any modern Node.js feature safely
5. **`ts-node` available** as devDependency â€” TypeScript scripts are possible but plain `.js` is simpler for hooks
6. **`.json` files are gitignored** by default (with specific exceptions) â€” any new JSON config files for the system need `!filename.json` exceptions in `.gitignore`
7. **`.cursor/` is gitignored** â€” Cursor rules are local-only and not in the repo; standing instructions must go in `.cursorrules` (which IS committed)
8. **2,135 line `.cursorrules`** â€” adding ~40 lines is fine; place after `## Architecture Patterns` section

**Recommended adjustments to implementation plan:**
1. **Do a bulk documentation update FIRST** before activating any automation. The current drift is so severe that activating a daily audit would immediately generate dozens of issues. Fix the docs, then automate.
2. **GitHub Action should be change-triggered, not daily** â€” trigger on changes to `src/app/api/**`, `prisma/schema.prisma`, `.env.example`, `src/lib/permissions.ts` rather than on a daily schedule. This targets drift at the moment it happens.
3. **Pre-commit hook should be warn-only initially** â€” use `exit 0` (warning) not `exit 1` (blocking) until the team trusts the system. Upgrade to blocking after the initial doc cleanup.
4. **The ARCHITECTURE.md page access table needs immediate structural repair** â€” remove 4 phantom page routes (/channels, /partners, /experiments, /sga) and add the 7+ missing real pages
5. **Add a "Models" section to ARCHITECTURE.md** â€” document all 17 Prisma models, not just WeeklyGoal and QuarterlyGoal
6. **Expand env vars table** â€” add all 19 missing variables and fix the GOOGLE_SHEETS_TEMPLATE_ID â†’ GOOGLE_SHEETS_WEBAPP_URL rename

**Risks and concerns:**
1. **Noise risk is HIGH** if automation is activated before docs are brought current â€” daily issues on a severely drifted repo will be ignored/dismissed and train the team to ignore the system
2. **Hook blocking risk is MEDIUM** â€” making pre-commit blocking too early will cause developers to bypass it with `--no-verify`
3. **Scope of initial cleanup is significant** â€” bringing ARCHITECTURE.md fully current (60 API routes, 14 Prisma models, 19 env vars, page table corrections) is a substantial one-time investment; estimate 3â€“5 hours of focused documentation work
4. **No security risks** â€” the documentation maintenance system requires no API keys beyond the built-in `GITHUB_TOKEN`; all comparisons are local file/git operations

**Refactoring baseline:**
The codebase carries **MODERATE technical debt**. 39 TypeScript/TSX files exceed 400 lines (largest: `query-compiler.ts` at 2,432 lines), with `ExploreResults.tsx` (1,689 lines) and `dashboard/page.tsx` (1,293 lines) as the clearest "god component/page" cases. Only 4 TODO comments exist â€” all active gaps in the semantic layer compiler (3 unimplemented templates: `forecast_vs_actual`, `rolling_average`, `opportunities_by_age`). Error handling across API routes is mostly consistent (`try/catch`, `{ error: string }`, `logger`), with two deviations: `sga-hub/weekly-goals` uses `console.error` instead of `logger`, and `gc-hub/advisors` checks `permissions.allowedPages.includes(16)` instead of a role helper. Three exports appear to be dead code: `INPUT_STYLES` and `BUTTON_STYLES` from `src/config/ui.ts`, and `DEFAULT_YEAR` from `src/config/constants.ts`. Dependency health is a concern: **3 high-severity npm audit vulnerabilities** (including two in `next` itself, fixable only via a breaking `next@16` upgrade), and `next` is 2 major versions behind (14 vs 16). The 7 barrel files are all small and focused (none exceed 10 re-exports).

---

## PHASE 6: Refactoring Signals Baseline

### Prompt

```
Using the codebase at C:\Users\russe\documents\dashboard, investigate refactoring signals. For each question below, run the specified commands, read the specified files, and record actual findings. Do not guess or summarize from memory.
```

### Findings:

**6.1 â€” Large Files (over 400 lines):**

**Total: 39 files over 400 lines** (errors for dynamic-route paths with `[brackets]` in filenames were expected and do not affect results).

Full list (sorted by line count, largest first):

| Lines | File |
|-------|------|
| 2432 | `src/lib/semantic-layer/query-compiler.ts` |
| 1957 | `src/lib/queries/sga-activity.ts` |
| 1689 | `src/components/dashboard/ExploreResults.tsx` |
| 1305 | `src/lib/semantic-layer/query-templates.ts` |
| 1293 | `src/app/dashboard/page.tsx` |
| 1100 | `src/lib/api-client.ts` |
| 1044 | `src/lib/queries/conversion-rates.ts` |
| 1009 | `src/app/dashboard/recruiter-hub/RecruiterHubContent.tsx` |
| 873 | `src/app/dashboard/sga-hub/SGAHubContent.tsx` |
| 871 | `src/lib/queries/open-pipeline.ts` |
| 868 | `src/components/games/pipeline-catcher/GameCanvas.tsx` |
| 854 | `src/lib/semantic-layer/definitions.ts` |
| 747 | `src/lib/semantic-layer/__tests__/validation-examples.ts` |
| 652 | `src/components/dashboard/DetailRecordsTable.tsx` |
| 619 | `src/components/sga-hub/AdminQuarterlyFilters.tsx` |
| 582 | `src/lib/sheets/google-sheets-exporter.ts` |
| 572 | `src/components/requests/RequestDetailModal.tsx` |
| 545 | `src/lib/queries/gc-hub.ts` |
| 542 | `src/components/sga-hub/LeaderboardFilters.tsx` |
| 542 | `src/app/dashboard/pipeline/page.tsx` |
| 533 | `src/components/sga-activity/ActivityDistributionTable.tsx` |
| 531 | `src/app/api/agent/query/route.ts` |
| 525 | `src/app/dashboard/sga-activity/SGAActivityContent.tsx` |
| 523 | `src/app/dashboard/sga-management/SGAManagementContent.tsx` |
| 479 | `src/components/sga-hub/ClosedLostFilters.tsx` |
| 475 | `src/components/dashboard/AdvancedFilters.tsx` |
| 472 | `src/components/sga-hub/AdminSGATable.tsx` |
| 455 | `src/components/dashboard/SaveReportModal.tsx` |
| 453 | `src/components/dashboard/RecordDetailModal.tsx` |
| 447 | `src/components/advisor-map/AdvisorDrillDownModal.tsx` |
| 446 | `src/lib/queries/source-performance.ts` |
| 444 | `src/lib/semantic-layer/__tests__/query-compiler-validation.ts` |
| 440 | `src/components/dashboard/GlobalFilters.tsx` |
| 429 | `src/components/games/pipeline-catcher/hooks/useGameAudio.ts` |
| 414 | `src/components/sga-hub/ClosedLostTable.tsx` |
| 407 | `src/lib/queries/detail-records.ts` |
| 406 | `src/components/requests/RequestForm.tsx` |
| 406 | `src/components/advisor-map/AddressEditModal.tsx` |
| 405 | `src/components/dashboard/PipelineBySgmChart.tsx` |

**Top 5 descriptions (from reading first 30 lines of each):**
1. **`query-compiler.ts`** (2432 lines): Deterministic SQL compiler that converts `TemplateSelection` objects into parameterized BigQuery SQL, with one compile function per template (22 total). Header declares: `"Deterministic compiler that assembles safe SQL from verified semantic layer fragments"`.
2. **`sga-activity.ts`** (1957 lines): BigQuery query module for the SGA Activity hub. Defines a local `ACTIVITY_VIEW` constant and contains queries for scheduled calls summaries, call analytics, SMS response rates, and activity distribution.
3. **`ExploreResults.tsx`** (1689 lines): Client component tagged `'use client'`. Imports chart components (BarChart, LineChart from recharts), table components, modals, and API client. A "god component" rendering all Explore AI results â€” charts, data tables, drilldown interactions, feedback buttons, pagination, and CSV export in a single file.
4. **`query-templates.ts`** (1305 lines): Central registry of 22 SQL template strings (`export const QUERY_TEMPLATES`) plus `QUERY_LAYER` visualization configuration. Comment header: `"QUERY TEMPLATES â€” Natural language â†’ Template â†’ SQL â†’ Results"`.
5. **`dashboard/page.tsx`** (1293 lines): Main dashboard Next.js page. Manages all filter state, all API data-fetch calls, scorecards, charts, and view mode toggling in one 1,293-line component.

---

**6.2 â€” Duplicated Query Patterns:**

**Total query files: 25** (in `src/lib/queries/`):
`admin-quarterly-progress.ts`, `advisor-locations.ts`, `closed-lost.ts`, `conversion-rates.ts`, `data-freshness.ts`, `detail-records.ts`, `drill-down.ts`, `export-records.ts`, `filter-options.ts`, `forecast-goals.ts`, `forecast.ts`, `funnel-metrics.ts`, `gc-hub.ts`, `open-pipeline.ts`, `pipeline-catcher.ts`, `quarterly-goals.ts`, `quarterly-progress.ts`, `re-engagement.ts`, `record-detail.ts`, `recruiter-hub.ts`, `sga-activity.ts`, `sga-leaderboard.ts`, `source-performance.ts`, `weekly-actuals.ts`, `weekly-goals.ts`

**WHERE clause patterns appearing in 3+ files (confirmed by reading funnel-metrics.ts, open-pipeline.ts, conversion-rates.ts):**
- `v.recordtypeid = @recruitingRecordType` (or `params.recruitingRecordType = RECRUITING_RECORD_TYPE`) â€” appears in `funnel-metrics.ts`, `open-pipeline.ts`, `conversion-rates.ts` and almost certainly the remaining pipeline/detail/SGA query files as well
- SGA filter: `v.SGA_Owner_Name__c = @sga` â€” appears in `funnel-metrics.ts`, `open-pipeline.ts`; same pattern expected in `source-performance.ts`, `detail-records.ts`, `closed-lost.ts`
- SGM filter: `v.SGM_Owner_Name__c = @sgm` â€” same pattern

**Already-extracted shared utilities:**
- `buildDateRangeFromFilters()` â€” imported from `lib/utils/date-helpers` by at least 2 query files
- `buildAdvancedFilterClauses()` â€” imported from `lib/utils/filter-helpers`
- `buildQueryParams()` â€” shared BigQuery param helper from `lib/bigquery`
- `cachedQuery()` â€” cache wrapper imported by all BigQuery query files

**Not yet extracted (copy-paste patterns):**
- The `RECRUITING_RECORD_TYPE` WHERE clause and its param setup are repeated in each file rather than extracted into a shared `buildBaseWhereClause()` helper
- SGA/SGM filter condition construction is duplicated across most pipeline/funnel query files
- Each query file is otherwise **standalone** (no cross-file imports between query files)

---

**6.3 — TODO/HACK/FIXME Comments:**

**Total: 4 items** — all TODOs, no HACKs, no FIXMEs, no WORKAROUNDs.

Full list (exact text from `Select-String -Pattern '//\s*(TODO|HACK|FIXME|WORKAROUND)'`):
1. `ExploreResults.tsx:1411  // TODO: Implement funnel visualization component`
2. `query-compiler.ts:2008  // TODO: Implement following pattern from forecast_vs_actual template`
3. `query-compiler.ts:2469  // TODO: Implement following pattern from rolling_average template`
4. `query-compiler.ts:2627  // TODO: Implement following pattern from opportunities_by_age template`

**Categorization:** TODOs: **4** / HACKs/WORKAROUNDs: **0** / FIXMEs: **0**

**Stale assessment:** TODOs 2-4 in `query-compiler.ts` reference templates that exist in `query-templates.ts` but whose compiler implementations are stubs. These are **active gaps**, NOT stale. TODO 1 in `ExploreResults.tsx` references a funnel visualization not yet built — also an **active gap**.

Note: Initial search with `-Pattern 'TODO|HACK|FIXME|TEMP|WORKAROUND'` returned hundreds of false positives because `TEMP` matched `template`, `Template`, `templateId` throughout the codebase. The corrected pattern matched only comment-style occurrences.

---

**6.4 — Types Defined Outside `src/types/`:**

PowerShell command for this check failed (exit 1 when piped). Assessment based on direct file reading:

Types are **well-centralized** in `src/types/`. From reading multiple files:
- `src/types/agent.ts` — `TemplateSelection`, `CompiledQuery`, `AgentResponse`, `AgentRequest`, `StreamChunk`, `DateRangeParams`, `DimensionFilter`, `VisualizationType` (imported by `query-compiler.ts`, `agent/query/route.ts`, `ExploreResults.tsx`)
- `src/types/sga-activity.ts` — all SGA Activity hub types
- `src/types/filters.ts` — `DashboardFilters`, `DEFAULT_ADVANCED_FILTERS`
- `src/types/dashboard.ts` — `FunnelMetrics`, `DetailRecord`, `SgmConversionData`, etc.
- `src/types/saved-reports.ts` — `ReportType`, `SavedReport` (re-exported via `src/types/index.ts`)
- `src/types/bigquery-raw.ts` — raw BigQuery result types

No widely-imported types were found living outside `src/types/`. Types appear to be one of the better-organized aspects of the codebase — no cross-cutting refactoring candidates identified.

---

**6.5 — API Route Error Handling Consistency:**

6 routes read in full. Summary:

| Route | try/catch | Error codes | Error shape | Logger | Auth | Permission check |
|-------|-----------|-------------|-------------|--------|------|-----------------|
| `dashboard/funnel-metrics` | YES | 401, 500 | `{ error: string }` | `logger.error` | `getServerSession` | `forbidRecruiter` / `forbidCapitalPartner` helpers |
| `admin/refresh-cache` | YES | 401, 403, 500 | `{ error: string }` | `logger.error` | `getServerSession` | manual role array |
| `agent/query` | YES | 401, 400, 500 | `{ error: string }` | `logger` | `getServerSession` | `forbidRecruiter` / `forbidCapitalPartner` helpers |
| `cron/refresh-cache` | YES | 401, 500 | `{ error: string }` | `logger.warn/info/error` | CRON_SECRET header | header check only |
| `sga-hub/weekly-goals` | YES | 400, 401, 403, 500 | `{ error: string }` | **`console.error`** | `getServerSession` | manual role array |
| `gc-hub/advisors` | YES | 401, 403, 500 | `{ error: string }` | `logger.error` | `getServerSession` | **`permissions.allowedPages.includes(16)`** |

**Dominant pattern** (5 of 6 non-cron routes): `getServerSession(authOptions)` → `getSessionPermissions(session)` → 401/403 guard → try/catch → `logger.error` → `{ error: string }` flat response shape.

**Deviations (2 actionable):**
1. **`sga-hub/weekly-goals`** uses `console.error` in BOTH GET and POST handlers instead of `logger`. Only route in the sample not using `logger`.
2. **`gc-hub/advisors`** checks `permissions.allowedPages.includes(16)` directly. All other routes use role names or helper functions — not page numbers. Would break silently if page 16 is renumbered.
3. **`cron/refresh-cache`** uses CRON_SECRET header instead of session — expected for cron routes, not a defect.

**Overall: Mostly consistent.** The `{ error: string }` shape, `getServerSession`, and `getSessionPermissions` patterns are universal.

---


**6.6 â€” Large Components (over 300 lines):**

**38 component files** (`src/components/**/*.tsx`) and **2 page files** exceed 300 lines.

Full component list (over 300 lines, sorted by size):

| Lines | File |
|-------|------|
| 1689 | `src/components/dashboard/ExploreResults.tsx` |
| 868 | `src/components/games/pipeline-catcher/GameCanvas.tsx` |
| 652 | `src/components/dashboard/DetailRecordsTable.tsx` |
| 619 | `src/components/sga-hub/AdminQuarterlyFilters.tsx` |
| 572 | `src/components/requests/RequestDetailModal.tsx` |
| 542 | `src/components/sga-hub/LeaderboardFilters.tsx` |
| 533 | `src/components/sga-activity/ActivityDistributionTable.tsx` |
| 479 | `src/components/sga-hub/ClosedLostFilters.tsx` |
| 475 | `src/components/dashboard/AdvancedFilters.tsx` |
| 472 | `src/components/sga-hub/AdminSGATable.tsx` |
| 455 | `src/components/dashboard/SaveReportModal.tsx` |
| 453 | `src/components/dashboard/RecordDetailModal.tsx` |
| 447 | `src/components/advisor-map/AdvisorDrillDownModal.tsx` |
| 440 | `src/components/dashboard/GlobalFilters.tsx` |
| 414 | `src/components/sga-hub/ClosedLostTable.tsx` |
| 406 | `src/components/requests/RequestForm.tsx` |
| 406 | `src/components/advisor-map/AddressEditModal.tsx` |
| 405 | `src/components/dashboard/PipelineBySgmChart.tsx` |
| 388 | `src/components/dashboard/PipelineFilters.tsx` |
| 385 | `src/components/dashboard/ConversionTrendChart.tsx` |
| 378 | `src/components/gc-hub/GCHubOverrideModal.tsx` |
| 372 | `src/components/sga-hub/ReEngagementOpportunitiesTable.tsx` |
| 362 | `src/components/dashboard/SourcePerformanceTable.tsx` |
| 353 | `src/components/sga-activity/ActivityDrillDownModal.tsx` |
| 345 | `src/components/sga-hub/ReEngagementFilters.tsx` |
| 337 | `src/components/gc-hub/GCHubAdvisorTable.tsx` |
| 335 | `src/components/sga-hub/WeeklyGoalsTable.tsx` |
| 330 | `src/components/gc-hub/GCHubAdvisorModal.tsx` |
| 323 | `src/components/advisor-map/AdvisorMap.tsx` |
| 321 | `src/components/settings/UserModal.tsx` |
| 319 | `src/components/requests/RequestAnalytics.tsx` |
| 317 | `src/components/dashboard/ChannelPerformanceTable.tsx` |
| 311 | `src/components/dashboard/SavedReportsDropdown.tsx` |
| 307 | `src/components/sga-hub/MetricDrillDownModal.tsx` |
| 306 | `src/components/dashboard/DataFreshnessIndicator.tsx` |
| 305 | `src/components/chart-builder/ChartBuilderEmbed.tsx` |
| 303 | `src/components/dashboard/PipelineByStageChart.tsx` |

Page files over 300 lines:
| Lines | File |
|-------|------|
| 1293 | `src/app/dashboard/page.tsx` |
| 542 | `src/app/dashboard/pipeline/page.tsx` |

**Top 5 component assessments (from reading first 30 lines):**

1. **`ExploreResults.tsx`** (1689 lines) â€” **GOD COMPONENT.** Header: `'use client'`. Imports: recharts chart components, `DetailRecordsTable`, `RecordDetailModal`, `ExportMenu`, `QueryInspector`, `dashboardApi`. Handles chart rendering (bar, line, area), data tables, drilldown query execution, feedback thumbs, pagination, CSV export, and detail modals â€” all in one file. Estimated 8â€“12 `useState` hooks. High extraction opportunity (feedback panel, chart type selector, drilldown logic, export controls are all candidates).

2. **`GameCanvas.tsx`** (868 lines) â€” **Length is justified.** Canvas-based game renderer with animation loop, game physics, collision detection, sprite rendering. Single responsibility (render and run the Pipeline Catcher game). Not a god component.

3. **`DetailRecordsTable.tsx`** (652 lines) â€” **Somewhat justified.** Complex data table with column sorting, pagination, column visibility toggles, row expansion, and drill-down. Single responsibility (one table). Could be trimmed but not a refactoring priority.

4. **`AdminQuarterlyFilters.tsx`** (619 lines) â€” **Marginal.** Multi-dimensional SGA quarterly filter form. Contains significant JSX repetition across filter row patterns â€” some extraction opportunity.

5. **`RequestDetailModal.tsx`** (572 lines) â€” **Sub-component opportunity.** Multi-tab modal (Details, Comments, Attachments, History). Each tab is a candidate for extraction into its own sub-component.

**`dashboard/page.tsx`** (1293 lines) â€” **GOD PAGE.** Manages 15+ filter states, all API fetch calls via `useCallback`, scorecard rendering, chart orchestration, view mode toggling. Filter state should be extracted to a custom hook; section rendering should be broken into child components.

---

**6.7 â€” Dead/Unused Exports:**

Import counts checked via `Select-String` (count = 1 means 0 external imports â€” only the definition itself matched):

**From `src/config/ui.ts`:**
| Export | Total matches | External imports | Status |
|--------|--------------|------------------|--------|
| `CARD_STYLES` | 2 | 1 | Barely used |
| `TABLE_STYLES` | 6 | 5 | Used |
| `INPUT_STYLES` | **1** | **0** | **DEAD** |
| `BUTTON_STYLES` | **1** | **0** | **DEAD** |

**From `src/config/constants.ts`:**
| Export | Total matches | External imports | Status |
|--------|--------------|------------------|--------|
| `RE_ENGAGEMENT_RECORD_TYPE` | 7 | 6 | Used |
| `FORECAST_TABLE` | 5 | 4 | Used |
| `MAPPING_TABLE` | 12 | 11 | Used |
| `DAILY_FORECAST_VIEW` | 7 | 6 | Used |
| `DEFAULT_YEAR` | **1** | **0** | **DEAD** |

**Dead export summary (3 confirmed):**
- `INPUT_STYLES` in `src/config/ui.ts` â€” 0 external imports
- `BUTTON_STYLES` in `src/config/ui.ts` â€” 0 external imports
- `DEFAULT_YEAR` in `src/config/constants.ts` â€” 0 external imports

Note: `getTableRowClasses` referenced in the Phase 6 prompt does not exist in `src/config/ui.ts` â€” the file exports only the 4 object constants shown above.

---

**6.8 â€” Dependency Health:**

**`npm outdated` output** (24 packages behind latest, 8 are 1+ major versions behind):

| Package | Current | Latest | Major versions behind |
|---------|---------|--------|----------------------|
| `cross-env` | 7.0.3 | 10.1.0 | **3** |
| `@types/node` | 20.x | 25.x | **5** (types only, low risk) |
| `next` | 14.2.35 | 16.1.6 | **2** |
| `eslint` | 8.57.1 | 10.0.0 | **2** |
| `eslint-config-next` | 14.2.35 | 16.1.6 | **2** |
| `@prisma/client` | 6.19.0 | 7.4.0 | 1 |
| `prisma` | 6.19.0 | 7.4.0 | 1 |
| `@google-cloud/bigquery` | 7.9.4 | 8.1.1 | 1 |
| `react` / `react-dom` | 18.3.1 | 19.2.4 | 1 |
| `tailwindcss` | 3.4.19 | 4.2.0 | 1 |
| `date-fns` | 3.6.0 | 4.1.0 | 1 |
| `react-leaflet` | 4.2.1 | 5.0.0 | 1 |

**`npm audit --production` output** â€” **6 vulnerabilities (1 low, 2 moderate, 3 high)**:

| Package | Severity | Vulnerability |
|---------|----------|---------------|
| `next` (10.0â€“15.5.9) | **HIGH** | DoS via Image Optimizer `remotePatterns` (GHSA-9g9p-9gw9-jx7f); HTTP request deserialization DoS via RSC (GHSA-h25m-26qc-wcjf) |
| `axios` (â‰¤1.13.4) | **HIGH** | DoS via `__proto__` key in `mergeConfig` (GHSA-43fc-jf86-j433) |
| `glob` (10.2.0â€“10.4.5) | **HIGH** | Command injection via `-c/--cmd` flag with `shell:true` (GHSA-5j98-mcp5-4vw2) |
| `ajv` (<8.18.0) | MODERATE | ReDoS when using `$data` option (GHSA-2g4f-4pwh-qvx6) |
| `lodash` (4.0â€“4.17.21) | MODERATE | Prototype pollution in `_.unset` / `_.omit` (GHSA-xxjr-mmjv-4gpg) |
| `qs` (6.7â€“6.14.1) | LOW | `arrayLimit` bypass DoS via comma parsing (GHSA-w7fw-mjwx-w883) |

**Critical action:** The `next` vulnerabilities require `npm audit fix --force` which installs `next@16.1.6` â€” a **breaking change**. Most other vulnerabilities can be fixed with `npm audit fix` (no force needed).

---

**6.9 â€” Barrel Files and Circular Dependency Risk:**

**7 `index.ts` files found:**

| File | Re-exports | Assessment |
|------|-----------|------------|
| `src/components/advisor-map/index.ts` | 1 named (`AdvisorMap`) | Minimal |
| `src/components/chart-builder/index.ts` | 1 named (`ChartBuilderEmbed`) | Minimal |
| `src/components/games/pipeline-catcher/index.ts` | 5 named (`PipelineCatcher`, `LevelSelect`, `GameCanvas`, `GameOver`, `useGameAudio`) | Small, appropriate |
| `src/components/ui/index.ts` | 6 named (error boundary exports) | Small, appropriate |
| `src/lib/semantic-layer/index.ts` | 3 wildcard `export *` + 8 specific named exports | Largest barrel; wildcard exports from 3 large files create a broad public surface |
| `src/lib/sheets/index.ts` | 2 wildcard `export *` from `sheets-types`, `google-sheets-exporter` | Small |
| `src/types/index.ts` | 1 wildcard `export *` from `saved-reports` | Nearly empty barrel |

**Circular dependency risk: LOW.**
- `src/lib/semantic-layer/index.ts` re-exports from `definitions`, `query-templates`, and `query-compiler`
- `query-compiler.ts` imports from `definitions` and `query-templates` (both read directly, not through `index.ts`)
- No file imports from `index.ts` within the same module â€” no circular pattern
- All other barrel files are leaf-node re-exporters with no intra-module cross-imports

**Oversized barrels: NONE.** The `semantic-layer/index.ts` uses `export *` wildcards (technically unlimited scope) but all referenced files are tightly coupled by design and within the same directory. No barrel file exceeds reasonable size.

---

## Next Steps

Once this exploration is complete:
1. Review findings with Russell
2. Do a one-time bulk documentation update to bring ARCHITECTURE.md current (fix the severe drift identified in Phase 5)
3. Adjust the implementation plan based on Phase 5 and Phase 6 discoveries
4. Build the implementation guide for the four-layer system:
   - Layer 4: Weekly refactoring audit (GitHub Action, runs Sundays)
   - Layer 3: Smart pre-commit hook with prompt generator
   - Layer 2: Claude Code standing instructions (docs + refactoring awareness)
   - Layer 1: Daily documentation audit (GitHub Action)
5. Execute implementation in phases with verification at each step
