# CLAUDE.md — Claude Code Standing Instructions

> This file is read automatically by Claude Code at session start.
> For Cursor-specific instructions, see `.cursorrules`.

## Project Overview

Savvy Wealth recruiting funnel analytics dashboard.

- **Stack**: Next.js 14, TypeScript, Tailwind CSS, Tremor React
- **Data**: Neon PostgreSQL (Prisma) + Google BigQuery (semantic layer)
- **Deployment**: Vercel (dashboard) + GCP Cloud Run (bot + MCP server)
- **Integrations**: Salesforce, Wrike, SendGrid, Claude API (Explore feature)

## GCP Services & Deployment

All GCP services run in project `savvy-gtm-analytics`, region `us-east1`.

| Service | Source Code | Purpose | Deploy Command |
|---------|-------------|---------|----------------|
| `savvy-analyst-bot` | `packages/analyst-bot/` | Slack bot — @Savvy Analyst Bot. Receives Slack events, calls Claude API with MCP tools, returns formatted answers + charts. | See below |
| `savvy-mcp-server` | `mcp-server/` | MCP tool server — schema context, BigQuery query execution. Called by the analyst bot via Claude's remote MCP. | `bash mcp-server/deploy.sh` |
| `analyst-bot` | (same as savvy-analyst-bot) | Legacy service name — still exists but `savvy-analyst-bot` is the active one receiving Slack traffic. |  |

### How They Connect

```
Slack → savvy-analyst-bot → Claude API (Anthropic, remote MCP) → savvy-mcp-server → BigQuery
                 ↓                                                       ↓
         Neon Postgres (thread state)                          .claude/schema-config.yaml (baked into image)
```

### Deploying the Analyst Bot

```bash
cd packages/analyst-bot
gcloud builds submit --config=cloudbuild.yaml --project=savvy-gtm-analytics .
gcloud run deploy savvy-analyst-bot --project=savvy-gtm-analytics --region=us-east1 \
  --image=gcr.io/savvy-gtm-analytics/analyst-bot:latest
```

- Bump the `source-bust-*` line in `packages/analyst-bot/Dockerfile` to invalidate Docker cache.
- The `--image` only deploy preserves all existing secrets and env vars on the Cloud Run service.
- Do **NOT** use `--set-secrets` or `--set-env-vars` unless intentionally reconfiguring — it overwrites everything.

### Deploying the MCP Server

```bash
bash mcp-server/deploy.sh
```

Only needed for changes to `mcp-server/src/**` (tool handlers, query validation, auth). NOT needed for schema-config.yaml changes.

### Schema Config: Auto-Syncs from Git

`.claude/schema-config.yaml` is the single source of truth. The MCP server fetches it **live from GitHub** (5-minute cache). Workflow:

1. Edit `.claude/schema-config.yaml`
2. Commit and push to `main`
3. Within 5 minutes, both the Slack bot and all MCP users get the updated schema

No rebuild or redeploy needed. The baked-in copy in the Docker image is only an offline fallback.

### When to Deploy What

| You Changed… | Deploy… |
|---|---|
| `packages/analyst-bot/src/**` (system prompt, Slack handler, chart rendering) | Analyst bot |
| `.claude/schema-config.yaml` (field definitions, rules, glossary) | **Nothing** — just push to git, auto-syncs within 5 min |
| `mcp-server/src/**` (query validation, MCP tool handlers) | MCP server (via `deploy.sh`) |
| `src/lib/semantic-layer/**` (dimensions, metrics, templates) | Nothing — these are used by the dashboard's Explore feature on Vercel, not the Slack bot |

### Detailed Operations Guide

See `packages/analyst-bot/savvy_analyst_bot.md` for: env vars, secrets, log commands, Slack app config, audit trail, scheduled reports, local dev setup.

## Environment

- **Windows (win32)** — shell is bash (Git Bash / Husky hook context)
- Use Unix/bash commands: `grep`, `ls`, `head`, `wc -l`, `find` all work
- Do NOT use PowerShell-only commands: `Get-Content`, `Test-Path`, `Get-ChildItem`, `Select-String`, `$env:VAR`

## Neon Postgres Schema Context — Doc + MCP

The Dashboard app is backed by **two Neon Postgres projects**, both reachable via the Neon MCP (`mcp__Neon__*`):

| Project | Project ID | Role | Curated doc |
|---|---|---|---|
| `savvy-dashboard-db` | `lingering-grass-54841964` | Prisma-managed dashboard backend (users, requests, forecast, GC Hub, agentic reports, games) + 5 raw-SQL analyst-bot tables | `.claude/neon-savvy-dashboard.md` |
| `sales_coaching` | `falling-hall-15641609` | Sales-coaching DB (evaluations, KB, call notes/transcripts, Neon Auth). Dashboard accesses **read-side via direct `pg`** (`src/lib/coachingDb.ts`) and **write-side via bridge HTTP** (`src/lib/sales-coaching-client/`) | `.claude/neon-sales-coaching.md` |

> **HARD GATE — Neon SQL:** Before writing any SQL against either Neon DB OR modifying a Dashboard query that touches one, you MUST:
> 1. Call `mcp__Neon__describe_table_schema` for the live column list (no guessing names — most are snake_case or PascalCase; getting it wrong wastes a tool call), AND
> 2. Consult the matching `.claude/neon-<db>.md` doc for business purpose, grain, JSONB shape, dormant tables, and known traps.
>
> No exceptions. The curated docs cover what the schema CANNOT tell you — Prisma vs raw-SQL boundaries, dormant tables, JSONB shapes (especially `evaluations.dimension_scores` and `notification_outbox.payload`), the direct-pg vs bridge split for sales_coaching, and trap-list memory cross-references like [[feedback-coaching-db-schema-traps]]. Live `describe_table_schema` covers what the doc CANNOT tell you — current columns, types, FKs, indexes. **You need both.**
>
> If you catch yourself about to write Neon SQL without having consulted both this turn, STOP and consult them first. To refresh either doc when schema drifts, run `/document-neon-schema <savvy-dashboard|sales-coaching>`.

## BigQuery Schema Context — MCP-First

When writing, reviewing, or validating SQL against BigQuery views:

> **HARD GATE:** You MUST call at least one schema-context MCP tool (`resolve_term`, `describe_view`, `get_metric`, or `get_rule`) BEFORE writing any `execute_sql` call. No exceptions. Do NOT guess field names — look them up first. If you catch yourself about to write SQL without having consulted schema-context in this conversation turn, STOP and query schema-context first.

1. **Use `schema-context` MCP tools first** (runtime: `@mossrussell/schema-context-mcp` npm package, config: `.claude/schema-config.yaml`):
   - `describe_view` — purpose, grain, key filters, dangerous columns, intent warnings
   - `list_views` — discover all views/tables, annotation status, column counts
   - `get_rule` — dedup rules, required filters, banned patterns
   - `get_metric` — numerator/denominator, date anchor, mode guidance
   - `resolve_term` — business term → field/rule cross-references
   - `lint_query` — heuristic SQL validation against configured rules
   - `health_check` — drift detection between annotations and live schema

2. **Fall back to `.claude/bq-*.md` markdown docs only when**:
   - MCP tools are unavailable (server not running)
   - MCP returns low-confidence or missing annotations for a field
   - You need Salesforce→BigQuery field lineage or sync cadence detail (`bq-salesforce-mapping.md` — separate concern, not in MCP scope)

3. **Never skip both** — always consult at least one context source before writing SQL.

4. **Agent tool access matters**: Only agents with `mcp__*` in their tools list (e.g., `data-verifier`) can call MCP tools directly. Read-only agents without MCP access (e.g., `code-inspector`, `pattern-finder`) should read `.claude/bq-*.md` markdown docs instead.

The markdown docs (`.claude/bq-views.md`, `bq-field-dictionary.md`, `bq-patterns.md`, `bq-salesforce-mapping.md`, `bq-activity-layer.md`) remain authoritative fallback and are not being removed.

## Bridge Schema Mirror — sales-coaching

`src/lib/sales-coaching-client/schemas.ts` is a **byte-for-byte mirror** of the canonical Zod contract at `russellmoss/sales-coaching@main:src/lib/dashboard-api/schemas.ts`. Drift between the two breaks runtime parsing of bridge responses and silently corrupts typed errors.

CI runs `npm run check:schema-mirror` (script: `scripts/check-schema-mirror.cjs`) on every push. The script fetches the upstream file from GH raw and compares byte-for-byte. Drift fails the build.

**If `npm run check:schema-mirror` fails** (CI or local):

1. In Claude Code: invoke `/sync-bridge-schema`. The skill pulls the upstream file via `gh api` (or local sibling repo at `C:/Users/russe/Documents/sales-coaching/` if available) and overwrites the mirror.
2. Re-run `npm run check:schema-mirror` to confirm byte-equality.
3. Re-run `npm run build` — type errors after sync usually indicate the upstream schema changed shape and a `salesCoachingClient` method or API route handler needs an update. Inspect `git diff --staged src/lib/sales-coaching-client/schemas.ts` to scope the work.

**Local dev** — set `SALES_COACHING_SCHEMAS_PATH` env var to a sibling-repo file path (e.g. `C:/Users/russe/Documents/sales-coaching/src/lib/dashboard-api/schemas.ts`) to skip the network fetch.

**CI** — `GH_TOKEN` must be available in the workflow env to fetch the raw file from a private repo. The default workflow `secrets.GITHUB_TOKEN` works if sales-coaching is in the same org with workflow permissions; otherwise use a PAT with `repo:read` scope.

**Authoring side (sales-coaching)** — when changing `src/lib/dashboard-api/schemas.ts` in the sales-coaching repo, sales-coaching's CLAUDE.md instructs the agent to either run `/sync-bridge-schema` in Dashboard in the same PR, or open a paired Dashboard PR. Do not delete or rename existing exports without coordinating both repos — Dashboard imports them and a renamed export breaks runtime parsing.

## Git Commit Protocol — Wrike Session Context

**Before every `git commit`, you MUST write `.ai-session-context.md` first.**

A post-commit hook reads this file and auto-creates a Wrike task card in the Dashboards kanban. This is how we track all development work — do NOT skip this step.

Structure:

```
### Session Summary
One paragraph: what was built/fixed/changed.

### Business Context
Why — what problem, who asked, what it enables.

### Technical Approach
Key decisions and tradeoffs.

### What Changed
Brief list of meaningful changes.

### Verification
What was tested and how.
```

Rules:
- ALWAYS write this before `git commit` — never skip
- 10–20 lines total, concise
- Focus on WHY — the diff captures WHAT
- Do NOT stage the file — it is in .gitignore
- The hook deletes it after reading

## Documentation Maintenance

When you add, rename, remove, or significantly modify code, update the relevant documentation in the same session. See the full lookup table in `.cursorrules` under "Documentation Maintenance — Standing Instructions."

Key commands:
- `npm run gen:api-routes` — regenerate API route inventory
- `npm run gen:models` — regenerate Prisma model inventory
- `npm run gen:env` — regenerate env var inventory
- `npm run gen:all` — regenerate all inventories

## Feature Development Workflow

### Exploration Phase
Use `/new-feature` skill to spawn parallel agent team (code-inspector,
data-verifier, pattern-finder). Each saves findings to project root.
Lead synthesizes into exploration-results.md.

### Semantic Layer Maintenance
Use `/audit-semantic-layer` skill after adding new dashboard features
or periodically. Spawns 3 agents (gap-finder, schema-author,
data-validator) to find missing Explore AI coverage, draft additive
updates, and verify against live BigQuery. Produces audit report for
human review before applying changes.

### Guide Building Phase
Use `/build-guide` skill to create agentic_implementation_guide.md from
exploration results + actual source code inspection.

### Cross-LLM Validation
Before executing: take the guide + exploration results to another LLM
(Gemini, GPT, DeepSeek) for adversarial review. Fix any gaps found.

### Execution Phase
Single Claude Code agent executes the guide phase-by-phase with
validation gates and stop-and-report checkpoints. Phase 3 (types)
intentionally breaks build as checklist. Never skip validation gates.

### Critical Rule
Every code path that constructs a DetailRecord or DrillDownRecord must
include ALL required fields. Missing even one construction site causes
build failure. The code-inspector subagent should find all of them
during exploration.

### BigQuery
- Multiple views and tables exist in the `savvy-gtm-analytics` project
- The primary analytics view is `vw_funnel_master` but features may
  require other views or view modifications
- The data-verifier subagent has MCP access to BigQuery — use it to
  discover schema, not assumptions
- Never use string interpolation in queries — always @paramName syntax

### Documentation
- This project uses `agent-guard` for documentation sync
- After completing code changes, always run `npx agent-guard sync`
  before committing
- Generated docs in `docs/_generated/` are auto-maintained — never
  edit them manually
- The pre-commit hook runs generators automatically, but explicit
  sync ensures narrative docs (ARCHITECTURE.md, README.md) are
  updated too
- Every implementation guide must include a doc sync phase (7.5)
  after code changes pass build and before UI validation

## Documentation Maintenance — Standing Instructions

### Rule: Update Docs When You Change Code

When you add, rename, remove, or significantly modify any of the following, you MUST update the relevant documentation **in the same session** — do not defer to a later task:

| If You Changed… | Update This | And Run… |
|---|---|---|
| `prisma/schema.prisma` | Database Models section in `docs\ARCHITECTURE.md` | Run `npm run gen:models` |
| `.env.example` | Environment Variables section in `docs\ARCHITECTURE.md` | Run `npm run gen:env` |
| Files matching `^src/app/api/.+/route\.ts$` | API Routes section in `docs\ARCHITECTURE.md` | Run `npm run gen:api-routes` |
| Files matching `^src/app/.+/page\.tsx$` | Page Routes section in `docs\ARCHITECTURE.md` | — |

### Generated Inventories

Auto-generated inventory files exist at `docs\_generated\`:
- `npm run gen:models`
- `npm run gen:env`
- `npm run gen:api-routes`
- Run all: `npm run gen:all`

These are committed to the repo. Always regenerate after changing routes, models, or env vars.

### Pre-Commit Hook Behavior
- If the pre-commit hook is in **blocking mode** (`autoFix.hook.mode: "blocking"`), you MUST update documentation BEFORE committing. The hook will exit 1 and reject the commit if docs are stale. Run generators and update narrative docs first, then commit.
- When you (an AI agent) trigger a commit, the hook detects this and skips all AI engines to prevent self-invocation. If docs are stale, the commit will be rejected with exit 1. Read the changed source files, update the relevant sections in docs/ARCHITECTURE.md (and any other doc targets) yourself, stage with git add, then retry the commit. Do NOT run npx agent-guard sync — update the files yourself directly.

### What NOT to Do
- Do NOT edit files in `docs\_generated\` manually — they are overwritten by scripts
- Do NOT skip documentation updates because "it's a small change" — small changes accumulate into drift
- Do NOT update `docs\ARCHITECTURE.md` without reading the existing section first — match the format

### Session Start
- At the start of every session, if `.agent-guard/session-context.md` exists, read it before making any code changes. It contains a summary of recent commits, what documentation was updated, and patterns to be aware of.
- Do NOT edit `.agent-guard/session-context.md` — it is auto-generated on every commit.

## Context Ledger — Decision Capture

This project uses `@mossrussell/context-ledger` to record the "why" behind architectural choices so AI agents don't repeat mistakes.

### Session Start (non-/auto-feature sessions)
- Check `.context-ledger/inbox.jsonl` for pending items that need review or promotion.

### Before Modifying Architectural Patterns
- Use `query_decisions` with the relevant file path to retrieve prior decisions.
- If a trusted precedent exists (`retrieval_weight >= 0.7`, `durability = precedent`), **follow it**.
- If you must diverge from a precedent, use `supersede_decision` with a clear `rationale` and `pain_points` explaining why.

### After Answering Phase 4 Bucket 2 Questions
- Classify the answer as `precedent`, `feature-local`, or `temporary`.
- Use `record_writeback` for **precedent-worthy answers only** — don't pollute the ledger with one-off decisions.

### Key Conventions Already Captured
- NULL handling: COALESCE with defaults, never filter NULLs
- Date helpers: `extractDate()` for display, `extractDateValue()` for comparisons
- BigQuery SQL: always `@paramName`, never string interpolation
- Export patterns: ExportButton auto-includes fields; ExportMenu/MetricDrillDownModal need manual column updates
- Duration penalties: `computeAdjustedDeal()` is the single source of truth
- Import convention: merge imports, never add a second import from the same module
- Construction sites: new required fields must be added to every construction site
- API routes in `src/app/api/dashboard/` are pass-through — rarely need changes
- URL-keyed fetch effects: `useEffect(() => void fetchData(), [searchParams.toString(), ...scalar deps])` — NOT `[fetchData]` or `[searchParams]`. In Next.js 14, `useSearchParams()` returns a new reference whenever the URL changes for any reason (including hash-only `window.history.pushState`), so keying on derived useMemo/useCallback values refires fetches on every modal hash sync. See `feedback_searchparams_pushstate.md` in memory.
