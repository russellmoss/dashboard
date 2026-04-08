# CLAUDE.md — Claude Code Standing Instructions

> This file is read automatically by Claude Code at session start.
> For Cursor-specific instructions, see `.cursorrules`.

## Project Overview

Savvy Wealth recruiting funnel analytics dashboard.

- **Stack**: Next.js 14, TypeScript, Tailwind CSS, Tremor React
- **Data**: Neon PostgreSQL (Prisma) + Google BigQuery (semantic layer)
- **Deployment**: Vercel (serverless)
- **Integrations**: Salesforce, Wrike, SendGrid, Claude API (Explore feature)

## Environment

- **Windows (win32)** — shell is bash (Git Bash / Husky hook context)
- Use Unix/bash commands: `grep`, `ls`, `head`, `wc -l`, `find` all work
- Do NOT use PowerShell-only commands: `Get-Content`, `Test-Path`, `Get-ChildItem`, `Select-String`, `$env:VAR`

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
