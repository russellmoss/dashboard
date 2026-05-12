# Neon Schema Context — savvy-dashboard-db

**Project ID:** `lingering-grass-54841964`
**Default branch / database:** `main` / `neondb`
**Postgres version:** 17.8
**Endpoint host (pooled):** `ep-orange-scene-ahcb2f6w-pooler.c-3.us-east-1.aws.neon.tech`
**Region:** aws-us-east-1
**Last refreshed:** 2026-05-12

> **HARD GATE:** Before writing any SQL against this Neon DB or modifying a table here, you MUST (a) call `mcp__Neon__describe_table_schema` for the live column list, AND (b) consult the relevant table section in this doc for business purpose, grain, and known traps. Do not guess column names — most are PascalCase, but some are snake_case. Most PKs are `cuid()`-generated text; a few are uuid; one is serial integer. Do not assume a JSONB shape without checking the JSONB Shapes section.

---

## At a Glance

| Stat | Value |
|---|---|
| Total tables | 37 (all in `public`) |
| Prisma-managed | 32 (via `prisma/schema.prisma`) |
| Raw-SQL-only | 5 (all owned by `packages/analyst-bot/`) |
| Tables with JSONB | 9 (15 JSONB columns total) |
| Hot tables (>1M rows) | None — largest table is `GcAdvisorPeriodData` at ~1,457 rows. This is a small operational DB. |
| Dormant Prisma models (0 consumers) | 8 — `ReportShare` + the entire legacy `Forecast*` family (`Forecast`, `ForecastAssumption`, `ForecastLineItem`, `ForecastOverride`, `ForecastRateItem`, `ForecastSource`, `ForecastTarget`). See "Active Forecast vs Legacy Forecast" below. |
| Extensions | `plpgsql` only — no `pgvector`, no `pg_trgm`, no `uuid-ossp`. `gen_random_uuid()` works natively in PG 13+. |
| Migration authority | Hand-rolled SQL in `prisma/migrations/manual_*.sql`. **NOT `prisma migrate`** — no `_prisma_migrations` tracking table exists. |

## How Consumers Connect

- **Dashboard app** (`src/`, Next.js 14): Prisma client via `DATABASE_URL`. Lives in `src/lib/prisma.ts`. All 32 Prisma-managed tables accessed this way.
- **Analyst-bot service** (`packages/analyst-bot/`, Cloud Run): direct `pg` Pool connection using the same DB. Owns the 5 raw-SQL tables exclusively.
- **MCP server** (`mcp-server/`, Cloud Run): direct `pg` for one operation only — validating MCP API keys against `mcp_api_keys` and updating `lastUsedAt`. Everything else goes through Prisma in the dashboard app.

Use the **pooled** host (`-pooler` suffix) for serverless / per-request connections (Next.js API routes, Cloud Run handlers). The unpooled host is for migrations and long-lived connections only.

---

## Domain Map

| Domain | Purpose | Tables |
|---|---|---|
| **Auth & Identity** | Dashboard users, password reset, MCP API keys | `User`, `PasswordResetToken`, `mcp_api_keys` |
| **Dashboard Requests** | Feature requests + data-error tickets (Wrike-synced) | `DashboardRequest`, `RequestAttachment`, `RequestComment`, `RequestEditHistory`, `RequestNotification` |
| **Forecast — Active** | Current Monte-Carlo forecasting + quarterly targets + exports | `ForecastScenario`, `ForecastQuarterTarget`, `forecast_exports` |
| **Forecast — Legacy (DORMANT)** | Original deterministic forecasting model — superseded but not deleted | `Forecast`, `ForecastAssumption`, `ForecastLineItem`, `ForecastOverride`, `ForecastRateItem`, `ForecastSource`, `ForecastTarget` |
| **Goals** | Per-user activity + revenue targets (weekly/quarterly/manager/SGM) | `WeeklyGoal`, `QuarterlyGoal`, `SGMQuarterlyGoal`, `manager_quarterly_goals` |
| **Growth Capital (GC Hub)** | Per-advisor monthly revenue/AUM from Orion + manual overrides | `GcAdvisorMapping`, `GcAdvisorPeriodData`, `GcSyncLog` |
| **Agentic Reports** | Background AI report generation (parameterized prompts, results, share edges) | `ReportJob`, `ReportConversation`, `ReportShare` (dormant), `SavedReport` |
| **Explore Feature** | Thumbs-up/down on AI-generated SQL responses | `ExploreFeedback` |
| **Map Overrides** | Manual advisor address/lat-lng corrections layered onto BQ | `advisor_address_overrides` |
| **Games** | Pipeline-catcher game leaderboard | `GameScore` |
| **Analyst-Bot (raw SQL)** | Slack bot state — threads, schedules, generated reports, DM allowlist | `bot_threads`, `bot_schedules`, `bot_reports`, `bot_dm_approved_users`, `user_queries` |

---

## Per-Table Detail

For each table: **purpose**, **grain**, key consumers, and any traps. Column lists and FK details are NOT duplicated here — call `mcp__Neon__describe_table_schema` for live truth.

### Auth & Identity

#### `public.User`
**Purpose:** Dashboard auth + RBAC root. Every other user-owned entity points here.
**Grain:** one row per dashboard user account.
**PK:** `id` (cuid text). `email` is UNIQUE.
**Role enum (text):** `revops_admin`, `admin`, `manager`, `sgm`, `sga`, `viewer`, `recruiter`, `capital_partner` — source of truth is `src/lib/permissions.ts`, NOT a Postgres enum.
**Consumers (read):** `src/lib/users.ts:76,126,147,168,198`, `src/lib/notifications.ts:49,168,264`, `src/lib/queries/weekly-goals.ts:148`, `src/lib/queries/sgm-quota.ts:35`, `src/app/api/sgm-hub/quota/route.ts:39`.
**Consumers (write):** `src/lib/users.ts:222,260,280,289`.
**API routes:** `src/app/api/admin/users/route.ts`, `src/app/api/admin/users/[id]/route.ts`, `src/app/api/auth/[...nextauth]/route.ts`.

#### `public.PasswordResetToken`
**Purpose:** One-time tokens for the forgot-password email flow.
**Grain:** one row per issued reset token. Multiple per user possible (successive forgot-password flows).
**Lifecycle:** TTL'd via `expiresAt`; `usedAt` marks consumed. `deleteMany` for expired tokens runs in `src/lib/password-utils.ts:120`.
**Consumers:** `src/lib/password-utils.ts` (full lifecycle), routes `auth/forgot-password`, `auth/reset-password`.

#### `public.mcp_api_keys` (Prisma model `McpApiKey`, `@@map`)
**Purpose:** Per-user MCP server API keys — used by the Slack analyst bot and external MCP clients to authenticate to the MCP server.
**Grain:** one row per issued key.
**DUAL-ACCESS PATTERN — TRAP:** This table is read/written by Prisma in `src/lib/mcp-key-utils.ts` *and* by raw SQL in `mcp-server/src/auth.ts:29,46`. The MCP server validates keys on every request and fire-and-forgets a `lastUsedAt` UPDATE. **If you change this table's shape, you must update both code paths.**
**Consumers (Prisma):** `src/lib/mcp-key-utils.ts:34,45,60,76`, `src/app/api/admin/mcp-keys/route.ts`, `src/app/api/admin/mcp-keys/[id]/route.ts`.
**Consumers (raw SQL):** `mcp-server/src/auth.ts:29,46`.

---

### Dashboard Requests

#### `public.DashboardRequest`
**Purpose:** Feature requests and data-error tickets submitted from the dashboard UI. Two-way synced with Wrike (`wrikeTaskId`).
**Grain:** one row per request.
**Wrike sync:** inbound via `src/app/api/webhooks/wrike/route.ts`; outbound via `src/lib/wrike.ts` (status, title, description, comments, attachments all bidirectional).
**Status enum (Postgres enum `RequestStatus`):** `SUBMITTED`, `PLANNED`, `IN_PROGRESS`, `DONE`, `ARCHIVED`.
**Type enum (Postgres enum `RequestType`):** `FEATURE_REQUEST`, `DATA_ERROR`.
**Priority enum (Postgres enum `RequestPriority`):** `LOW`, `MEDIUM`, `HIGH`, `IMMEDIATE` (nullable).
**Aggregate children (all cascade-delete):** `RequestAttachment`, `RequestComment`, `RequestEditHistory`, `RequestNotification`.
**Consumers (read):** `src/lib/wrike.ts:90,179,225,286,325,360`, `src/lib/notifications.ts:90,158,257`, route `dashboard-requests/[id]/route.ts:57,141,338`, webhook `wrike/route.ts:46`.
**Consumers (write):** `src/lib/wrike.ts:135,154,194,255`, `webhooks/wrike/route.ts:143`, `dashboard-requests/[id]/route.ts:361`.

#### `public.RequestAttachment`
**Purpose:** File attachments on a DashboardRequest.
**Grain:** one row per uploaded file. **`data` column stores the file content as base64 text in-DB** (TRAP — see Anti-Patterns). Also tracks Wrike attachment ID for sync.
**Consumers:** `src/lib/wrike.ts:360` + `src/app/api/dashboard-requests/[id]/attachments/route.ts`.

#### `public.RequestComment`
**Purpose:** Comments on a DashboardRequest. Mirrored to/from Wrike via `wrikeCommentId`.
**Grain:** one row per comment.
**Consumers:** `src/lib/wrike.ts:301`, `src/app/api/dashboard-requests/[id]/comments/route.ts`.

#### `public.RequestEditHistory`
**Purpose:** Field-level audit trail — every PATCH to a DashboardRequest writes one row per changed field.
**Grain:** one row per (request, field, edit event).
**Write-heavy:** read only via Prisma relation include on the request GET response.
**Consumers (write):** `webhooks/wrike/route.ts:75,117`, `dashboard-requests/[id]/route.ts:247` (batched `createMany`).

#### `public.RequestNotification`
**Purpose:** In-app notification for request activity (new comment, status change, etc.).
**Grain:** one row per recipient per event.
**Consumers:** `src/lib/notifications.ts:345,361,373,386`, `src/app/api/notifications/route.ts`, `src/app/api/notifications/[id]/route.ts`, `webhooks/wrike/route.ts:99`.

---

### Forecast — Active

**Active Forecast vs Legacy Forecast — TRAP:** The dashboard uses three actively-consumed forecast tables: `ForecastScenario` (Monte Carlo), `ForecastQuarterTarget` (AUM goals), and `forecast_exports` (Google Sheets audit log). The seven-table legacy `Forecast*` family (one-to-many `Forecast → ForecastLineItem / ForecastRateItem / …`) is **DORMANT** — zero application consumers. Schema is preserved but writes go to the active family only. **When writing forecast code, do NOT touch the legacy family unless you know you're working on a restore/migration path.**

#### `public.ForecastScenario`
**Purpose:** Monte-Carlo scenarios for the forecasting tool — per-scenario rate/avg-day overrides plus historical baselines plus simulated per-opp results.
**Grain:** one row per saved scenario.
**Stage transitions modeled:** `sqo→sp`, `sp→neg`, `neg→signed`, `signed→joined` (4 transitions, each with `rateOverride_*`, `historicalRate_*`, `avgDaysOverride_*`).
**JSONB columns:**
- `perOppResults` — array of per-opportunity simulation outputs (1 sampled row; shape TBD on demand).
- `quartersJson` — currently 0 non-null rows (column reserved for future quarterly aggregations).
**Sharing:** `shareToken` (unique) lets external viewers see a scenario via `forecast/scenarios/share/[shareToken]/route.ts`.
**Schema-churn flag:** ordinal_position gap at 22-29 (8 dropped columns) — there's been significant historical schema change here. If you're confused by old code referencing missing columns, that's why.
**Consumers:** `src/app/api/forecast/scenarios/route.ts`, `src/app/api/forecast/scenarios/[id]/route.ts`, `src/app/api/forecast/scenarios/share/[shareToken]/route.ts`.

#### `public.forecast_quarter_targets` (Prisma model `ForecastQuarterTarget`, `@@map`)
**Purpose:** Per-quarter AUM target in dollars for the forecasting view.
**Grain:** one row per quarter. UNIQUE on `quarter`.
**Consumers:** `src/app/api/forecast/sqo-targets/route.ts:21,69`, included by `src/app/api/forecast/export/route.ts:1451`.

#### `public.forecast_exports` (Prisma model `ForecastExport`, `@@map`)
**Purpose:** Audit log of Google Sheets forecast exports — what was generated, when, by whom, how many rows.
**Grain:** one row per export job.
**Consumers:** `src/app/api/forecast/export/route.ts:2382,2435,2456`, `src/app/api/forecast/exports/route.ts:21`.

---

### Forecast — Legacy (DORMANT)

**Status: DORMANT — zero consumers as of 2026-05-12.** All seven tables are intact in Prisma at `prisma/schema.prisma:449-584` but have no read/write call sites in `src/`. The fact that `ForecastAssumption` has 0 rows confirms this. Worth a cleanup pass — but verify with the user that no offline scripts depend on them before dropping.

| Table | Rows | What it was |
|---|---|---|
| `Forecast` | 1 | Top-level forecast version (quarter + status). |
| `ForecastAssumption` | 0 | Free-form key/value planning assumptions per channel/sub-source/month. |
| `ForecastLineItem` | 324 | Calculated + final volume per channel/sub-source/month/stage. |
| `ForecastOverride` | 6 | Manual override audit (line-item OR rate-item value). |
| `ForecastRateItem` | 270 | Stage-transition conversion rates (calculated vs final). |
| `ForecastSource` | 18 | Per-forecast channel/sub-source registry (active/manual flags). |
| `ForecastTarget` | 150 | Per-channel/month/stage finance minimums + gap-filler allocations. |

---

### Goals

All four goal tables key on `userEmail TEXT` rather than an FK to `User.id` — see TRAP in Anti-Patterns.

#### `public.WeeklyGoal`
**Purpose:** Weekly per-SGA activity targets (initial calls, qualification calls, MQL, SQL, SQO, leads sourced, leads contacted).
**Grain:** one row per (userEmail, weekStartDate). UNIQUE.
**Consumers:** `src/lib/queries/weekly-goals.ts:27,42,75,116,133,168`, routes under `sga-hub/weekly-goals/`.

#### `public.QuarterlyGoal`
**Purpose:** Per-user quarterly SQO target.
**Grain:** one row per (userEmail, quarter). UNIQUE.
**Consumers:** `src/lib/queries/quarterly-goals.ts:14,32,58,87,102,120`, routes under `sga-hub/quarterly-goals/`.

#### `public.SGMQuarterlyGoal`
**Purpose:** SGM-specific quarterly ARR target. (SGMs are SQO qualification gates — see [[feedback-sgm-role]].)
**Grain:** one row per (userEmail, quarter). UNIQUE.
**PK quirk:** uses `gen_random_uuid()` default (the only Prisma model that does — the rest use `cuid()` generated client-side).
**Consumers:** `src/lib/queries/sgm-quota.ts:82,237,347,404`, `src/app/api/sgm-hub/quota/route.ts:110`.

#### `public.manager_quarterly_goals` (Prisma model `ManagerQuarterlyGoal`, `@@map`)
**Purpose:** Team-wide manager-level quarterly SQO target (aggregate across all SGAs under that manager).
**Grain:** one row per (quarter). UNIQUE on `quarter`. NOT per-user despite the table name — `createdBy`/`updatedBy` are audit fields only.
**Consumers:** `src/lib/queries/admin-quarterly-progress.ts:160`, `src/app/api/sga-hub/manager-quarterly-goal/route.ts:55,124`.

---

### Growth Capital (GC Hub)

Snake-case columns inside camelCase tables — names like `advisorNormalizedName` are correct (PascalCase table, camelCase columns). All three tables are part of one ETL pipeline.

#### `public.GcAdvisorMapping`
**Purpose:** Advisor identity registry — maps normalized advisor name to anonymized ID, Orion representative ID, account name, billing flags, and churn/exclusion state.
**Grain:** one row per (normalized) advisor.
**UNIQUE keys:** `advisorNormalizedName`, `anonymousAdvisorId`, `orionRepresentativeId`.
**Write authority:** populated out-of-band — **no application code writes to it**. Maintained via SQL or an offline tool. If you need to add an advisor, you'll add it manually.
**Consumers (read):** `src/lib/queries/gc-hub.ts:69,117,165,267,296,399,487,537,608`, multiple routes under `gc-hub/`.

#### `public.GcAdvisorPeriodData`
**Purpose:** Per-advisor per-period (typically monthly) revenue, commissions, AUM, and override metadata. Largest table in the DB (~1,457 rows).
**Grain:** one row per (advisorNormalizedName, period). UNIQUE.
**Sources:** `dataSource` field — `'historical_etl'` (default) or user-set values from manual overrides.
**Override pattern:** `originalGrossRevenue` / `originalCommissionsPaid` preserve pre-override values for audit.
**Consumers:** `src/lib/queries/gc-hub.ts:210,341,407,529,593`, `src/app/api/gc-hub/period/route.ts:61,69,78,162,170`, `src/app/api/gc-hub/override/route.ts:44,66,101`, write path in `src/lib/gc-hub/sync-revenue-estimates.ts:217,232,253`.

#### `public.GcSyncLog`
**Purpose:** ETL audit log — one row per sync attempt (manual or cron), recording processed/inserted/updated/skipped counts and error details.
**Grain:** one row per sync run.
**JSONB column:** `errorDetails` — currently 0 non-null rows (only populated on failure). Shape: TBD when first error occurs.
**Consumers:** `src/lib/queries/gc-hub.ts:588`, `src/app/api/gc-hub/manual-sync/route.ts:41`, `src/app/api/cron/gc-hub-sync/route.ts:36`.

---

### Agentic Reports

Async AI-generated reports — user submits a question, a background worker runs Claude with parameterized prompts and stores the result.

#### `public.ReportJob`
**Purpose:** Async agentic report jobs — input params + result + per-step metrics + verification.
**Grain:** one row per requested report.
**Status (text, not enum):** `'pending'` (default) → `'processing'` → `'complete'` or `'failed'`.
**Visibility (text):** `'private'` (default) or `'public'`.
**Type (text):** free-form (used as a categorizer — e.g. `'sga_review'`).
**JSONB columns:** see JSONB Shapes section. `parameters`, `reportJson`, `queryLog`, `extractedMetrics` populated. `verificationResult` always null currently.
**Consumers (read):** `src/lib/reporting/finalize.ts:10`, `src/app/api/reports/[id]/route.ts:31,78`.
**Consumers (write):** `src/app/api/reports/generate/route.ts:116,133,173,211,324,343,364,418`, `src/app/api/reports/[id]/route.ts:90`.

#### `public.ReportConversation` (NICHE)
**Purpose:** Per-message thread on an agentic ReportJob (user prompts + agent replies).
**Grain:** one row per turn (role + content + timestamp).
**Status:** **NICHE** — 0 rows; only accessed via Prisma relation include (`include: { conversations: ... }`) on `ReportJob.findUnique`. Writes happen in `reports/generate/route.ts` during job execution. No direct `prisma.reportConversation.*` calls anywhere.

#### `public.ReportShare` (DORMANT)
**Purpose:** Sharing edges from ReportJob to a recipient User.
**Status:** **DORMANT** — 0 rows, 0 code consumers. Model is defined at `prisma/schema.prisma:425` but the sharing UI was either never built or removed. If you're building report-sharing, this is the table to use.

#### `public.SavedReport`
**Purpose:** User-saved dashboard filter snapshots — lets a user save a (filters + feature visibility + dashboard + viewMode) combination by name and re-load it later.
**Grain:** one row per saved filter set per user.
**Dashboard (text):** which dashboard this snapshot belongs to (default `'funnel_performance'`).
**ReportType (text):** `'user'` (default) — distinguishes user-saved vs system-default presets.
**Consumers:** `src/app/api/reports/route.ts` (GET, POST), `src/app/api/reports/[slug]/route.ts` (GET, PATCH, DELETE).
**Caution:** there's a naming overlap — `/api/reports/` operates on `SavedReport` while `/api/reports/generate/` and `/api/reports/[id]/` operate on `ReportJob`. The `[slug]` route is for SavedReport (slug-keyed); the `[id]` route is for ReportJob (cuid-keyed).

---

### Explore Feature

#### `public.ExploreFeedback`
**Purpose:** Thumbs-up / thumbs-down feedback on Explore AI query responses, plus the compiled SQL/template that generated them.
**Grain:** one row per feedback event.
**Feedback (text):** `'positive'` or `'negative'`.
**JSONB columns:** `compiledQuery` (shape documented below), `resultSummary` (summary of returned data).
**Write-only from app code:** 1 write site, 0 read sites — analytics consumption is presumably offline.
**Consumer:** `src/app/api/explore/feedback/route.ts:76`.

---

### Map Overrides

#### `public.advisor_address_overrides` (Prisma model `AdvisorAddressOverride`, `@@map`)
**Purpose:** Manual address / lat-lng corrections layered onto BigQuery advisor data for the advisor map view.
**Grain:** one row per `primaryKey` (the BQ-side advisor identifier).
**Consumers:** `src/lib/queries/advisor-locations.ts:183` (merges with BQ data), `src/app/api/advisor-map/overrides/route.ts:114,177,184,201,253`.

---

### Games

#### `public.GameScore`
**Purpose:** Pipeline-catcher game leaderboard — per-play score record.
**Grain:** one row per game play.
**Composite index:** `(quarter, score)` for fast leaderboard queries.
**Consumers:** `src/app/api/games/pipeline-catcher/leaderboard/route.ts:43,109,123,181`, `src/app/api/games/pipeline-catcher/levels/route.ts:40`.

---

### Analyst-Bot (raw SQL, owned by `packages/analyst-bot/`)

These five tables are **NOT in `prisma/schema.prisma`**. They are accessed exclusively via raw SQL in `packages/analyst-bot/src/` using a direct `pg` Pool to the same Neon DB. No `src/` code touches them. snake_case throughout.

#### `public.bot_threads`
**Purpose:** Slack thread state for the analyst bot — full conversation history stored as a single JSONB blob.
**Grain:** one row per Slack thread (keyed by `thread_id`).
**JSONB column:** `messages` (357 non-null rows) — array of `{ role: 'user' | 'assistant', content: string }`. **TRAP:** entire conversation stored unstructured; no per-message normalization. Long threads will bloat row size.
**Consumers:** `packages/analyst-bot/src/thread-store.ts:36,58,71`.

#### `public.bot_schedules`
**Purpose:** Recurring Slack-bot report jobs — frozen SQL + cadence + recipients.
**Grain:** one row per scheduled report.
**Key fields:** `frozen_sql` (the literal SQL to run), `frequency` (`'daily'`, `'weekly'`, etc.), `deliver_at_hour`, `next_run_at`, `is_active`, `recipients` (JSONB array).
**JSONB column:** `recipients` — array of `{ email: string, userId: string }` (Slack user IDs).
**Consumers:** `packages/analyst-bot/src/schedule-store.ts:207,260,270,283,294,306,316,331,347`.

#### `public.bot_reports`
**Purpose:** Slack-bot async generated reports → Google Doc.
**Grain:** one row per generated report.
**Status (text):** `'pending'`, `'processing'`, `'complete'`, `'failed'` (loose convention, not enforced).
**JSONB column:** `sections_json` — array of `{ title: string, status: 'pending'|..., question: string, ... }` — each section is a question to answer.
**Consumers:** `packages/analyst-bot/src/report-store.ts:53,104,114,130`.

#### `public.bot_dm_approved_users`
**Purpose:** Allowlist of Slack user IDs allowed to DM the analyst bot directly.
**Grain:** one row per approved user.
**Consumers:** `packages/analyst-bot/src/dm-access-store.ts:54,66,89,103`.

#### `public.user_queries`
**Purpose:** Question history (one row per query) — likely from Slack bot or Explore feature audit. Only table with a `SERIAL` PK in the entire DB.
**Grain:** one row per asked question.
**Consumers:** `packages/analyst-bot/src/thread-store.ts:84,103`.

---

## JSONB Shapes

Documented from sampled live data on 2026-05-12. Re-sample on schema change.

```ts
// SavedReport.filters — JSONB object (always populated, 12 rows)
interface SavedReportFilters {
  advancedFilters: unknown;       // 12/12
  channel: unknown;               // 12/12
  datePreset: string;             // 12/12
  endDate: string | null;         // 12/12
  experimentationTag: string | null; // 12/12
  metricFilter: unknown;          // 12/12
  sga: unknown;                   // 12/12
  sgm: unknown;                   // 12/12
  source: unknown;                // 12/12
  stage: unknown;                 // 12/12
  startDate: string | null;       // 12/12
  year: number;                   // 12/12
  campaignId?: string;            // 2/12 — optional, only on filter sets that scope to a campaign
}

// SavedReport.featureSelection — JSONB object (always populated)
interface SavedReportFeatureSelection {
  charts: unknown;                // 12/12 — which charts to show
  conversionRates: unknown;       // 12/12
  scorecards: unknown;            // 12/12
  tables: unknown;                // 12/12
}

// ReportJob.parameters — JSONB, mixed: 26 rows are JSON null, 8 are objects.
// When object-typed, observed shape is { name: string } (a person's name for the report subject).
// Treat this as parameterized prompt input — extend by adding new keys without breaking old consumers.
interface ReportJobParameters {
  name?: string;
  // Other keys may exist depending on report type — check report-type-specific code.
}

// ReportJob.queryLog — JSONB array of structured query records (per-step SQL + result snapshot)
// ReportJob.reportJson — JSONB object — the final rendered report payload
// ReportJob.extractedMetrics — JSONB object — key:number map of headline metrics
// ReportJob.verificationResult — always null currently (column reserved for future)

// ExploreFeedback.compiledQuery — JSONB object (3 sampled rows, all have same 5 keys)
interface ExploreCompiledQuery {
  sql: string;
  params: Record<string, unknown>;
  metadata: Record<string, unknown>;
  templateId: string;
  visualization: unknown;
}

// bot_threads.messages — JSONB array, role/content turns. Slack-bot conversation log.
interface BotThreadMessage {
  role: 'user' | 'assistant';
  content: string;
}
// Length distribution: 264 threads with 2 messages, 41 with 4, tail up to 36 messages.

// bot_schedules.recipients — JSONB array, default '[]'
interface BotScheduleRecipient {
  email: string;
  userId: string; // Slack user ID, e.g. "U06DUE9D35W"
}

// bot_reports.sections_json — JSONB array, one entry per report section
interface BotReportSection {
  title: string;
  status: 'pending' | string; // loose convention
  question: string;            // the natural-language question to answer
  // additional fields may be appended after generation (answer/sql/result)
}

// ForecastScenario.perOppResults — JSONB; only 1 row populated; shape TBD on demand
// ForecastScenario.quartersJson — JSONB; 0 rows; column reserved
// GcSyncLog.errorDetails — JSONB; 0 rows; populated on sync failure
```

---

## Business Glossary

- **"SGA" / "SGM"** — Sales Growth Associate / Manager. SGM is a *qualification gate* (SQO approver), NOT a team manager. See [[feedback-sgm-role]].
- **"Quarter"** — text string in form `'Q1 2026'` / `'2026Q1'` (varies by table — check the column comment).
- **"User who created a thing"** — every audit field (`createdBy`, `updatedBy`, `overriddenBy`, etc.) is a `text` field, NOT an FK. Stores either `User.email` (most tables) or `User.id` (DashboardRequest's `submitterId` is the only true FK). Check the column to see which.
- **"won deal" / "joined advisor"** — these business terms are NOT modeled in this DB. They live in BigQuery (`Joined_Date__c`, etc.). See `.claude/bq-views.md`. See [[feedback-won-deal-definition]].
- **"forecast"** — refers to the **active** forecasting model (`ForecastScenario` + targets + exports). The legacy `Forecast` model family (parent table named just `Forecast`) is DORMANT.
- **"report"** — ambiguous; resolve by context: `SavedReport` = saved dashboard filters; `ReportJob` = async AI-generated report; `bot_reports` = Slack-bot async report → Google Doc.

---

## Known Anti-Patterns & Traps

- **Schema authority is NOT `prisma migrate`.** Migrations are hand-rolled SQL files at `prisma/migrations/manual_*.sql` applied by hand. No `_prisma_migrations` tracking table. The workflow: edit `schema.prisma`, write a `manual_*.sql`, apply by hand, `prisma generate`. If you create a migration with `prisma migrate dev`, **it will not match this workflow** and may conflict with future hand-rolled changes. Use `prisma db pull` to round-trip live → schema if you need verification.
- **Goal tables use `userEmail` text, not a FK to `User.id`.** Affects `QuarterlyGoal`, `SGMQuarterlyGoal`, `WeeklyGoal`, `manager_quarterly_goals` (last one is per-quarter, not per-user, but still uses `createdBy` as email). If a user's email changes, their goals do NOT cascade. Joining requires `JOIN "User" u ON u.email = "QuarterlyGoal"."userEmail"`.
- **Audit columns (`createdBy`, `updatedBy`, etc.) inconsistently store email vs id.** Check before joining. DashboardRequest's `submitterId` is the only true FK to `User.id`.
- **Legacy `Forecast*` family is dormant — don't write to it.** Seven tables (`Forecast`, `ForecastAssumption`, `ForecastLineItem`, `ForecastOverride`, `ForecastRateItem`, `ForecastSource`, `ForecastTarget`) defined at `prisma/schema.prisma:449-584` have zero application consumers. Active forecast tables are `ForecastScenario`, `ForecastQuarterTarget`, `forecast_exports`.
- **Five "raw SQL" lookalikes are actually Prisma-managed via `@@map`.** `advisor_address_overrides`, `forecast_exports`, `forecast_quarter_targets`, `manager_quarterly_goals`, `mcp_api_keys` — they look snake_case but they DO have Prisma models (`AdvisorAddressOverride`, `ForecastExport`, `ForecastQuarterTarget`, `ManagerQuarterlyGoal`, `McpApiKey`). Use Prisma to access them; the 5 truly raw tables are the `bot_*` family + `user_queries`.
- **`mcp_api_keys` is dual-access.** Prisma in `src/lib/mcp-key-utils.ts`, raw SQL in `mcp-server/src/auth.ts`. Schema changes require updating BOTH paths.
- **`RequestAttachment.data` is base64-encoded file content stored in-DB.** Storing files in Postgres is unusual; if you're tempted to query `data` directly, prefer fetching via the API route which knows the encoding.
- **`bot_threads.messages` stores entire Slack conversations as a single JSONB blob.** No per-message normalization. Long threads bloat row size; very long threads (>100 turns) could approach TOAST limits.
- **`ReportJob.parameters` is sometimes JSON null vs SQL NULL.** 26 rows have `'null'::jsonb`; 8 have actual objects. Always check `jsonb_typeof(parameters) = 'object'` before calling `jsonb_object_keys()` — or you'll get `cannot call jsonb_object_keys on a scalar`.
- **`ForecastScenario` ordinal_position gap (22-29).** Eight dropped columns historically. If you find old code referencing missing column names, that's why — don't try to restore them.
- **`User.role` is text, not a Postgres enum.** The source of truth for valid roles is `src/lib/permissions.ts`. Don't constrain in DB.
- **`SGMQuarterlyGoal` PK uses `gen_random_uuid()` default** while every other Prisma model uses `cuid()` generated client-side. If you write to it via raw SQL with `id = NULL`, Postgres fills it in; via Prisma it works either way.
- **`user_queries` is the only table with a SERIAL integer PK.** Everything else is text (cuid) or uuid. Sequence: `user_queries_id_seq`.

---

## Migration & Schema Authority

**Schema authority:** `prisma/schema.prisma` (canonical model definitions) applied to Neon via hand-written `prisma/migrations/manual_*.sql`.
**Migration tool:** none — there is no `prisma migrate` history and no `_prisma_migrations` tracking table.
**Workflow:** edit `schema.prisma` → write a `manual_*.sql` file → apply by hand → `prisma generate`.
**Drift detection:** none automated. Run `mcp__Neon__describe_table_schema` against Prisma to spot-check. Last full audit (2026-05-12): **zero drift across all 27 spot-checked Prisma models**.
**Existing migration files (newest first, only 6 exist):**
1. `manual_add_mcp_api_key.sql` — 2026-04-09
2. `manual_add_agentic_reporting.sql` — 2026-03-17
3. `manual_add_user_external_agency.sql` — 2026-02-17
4. `manual_game_score_migration.sql` — 2026-02-17
5. `manual_manager_quarterly_goal_migration.sql` — 2026-02-17
6. `manual_password_hash_optional_migration.sql` — 2026-02-17

---

## Cross-References

- **Live introspection (always preferred for current schema):** `mcp__Neon__describe_table_schema`, `mcp__Neon__get_database_tables`
- **Schema drift between branches:** `mcp__Neon__compare_database_schema`
- **Slow queries:** `mcp__Neon__list_slow_queries`
- **Refresh this doc:** `/document-neon-schema savvy-dashboard`
- **Related memory:** [[reference-neon-projects]], [[feedback-sgm-role]], [[feedback-won-deal-definition]]
- **Related docs:** `prisma/schema.prisma`, `docs/ARCHITECTURE.md`, sister doc `.claude/neon-sales-coaching.md` (the other Neon DB), BigQuery context at `.claude/bq-*.md`
