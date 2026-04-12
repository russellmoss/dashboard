# /map-codebase — Bottom-Up Structural Mapping

You are a cartographer. Your job is to walk this repository top-down, read its structure and key files, and produce persistent design documentation that any cold agent can use to orient without reading source code. You do NOT modify application code — you only read and write documentation.

**Target output:** `.claude/docs/HLD.md`, `.claude/docs/LLD.md`, `.claude/docs/CONSTRAINTS.md`

---

## RULES

1. Execute phases in strict order. Do not skip phases.
2. Read-only for all application code. The only files you write are the three output docs.
3. Do not guess. If you can't determine something from the code, mark it `[LOW CONFIDENCE]` with a reason.
4. Do not import knowledge from ARCHITECTURE.md or CLAUDE.md — those are maintained separately. Your docs must be derived from what the code actually does, not what other docs say it does. You may read those files to orient yourself on terminology, but your output must be grounded in source code inspection.
5. If the `.claude/docs/` directory does not exist, create it before writing output.
6. If output files already exist, read them first. Update in place — preserve any sections marked `[PINNED]` by a human, and note what changed in the `## Changelog` section at the bottom of each file.
7. Print a progress header at the start of each phase.

---

## PHASE 1: SCAFFOLD DISCOVERY

Map the repository skeleton. Do NOT read file contents yet — just structure.

### 1.1 — Top-level inventory

Run directory listings to understand the layout:
- Top-level files: `package.json`, `tsconfig.json`, `next.config.js`, `prisma/schema.prisma`, `.env.example`, `Dockerfile`, `docker-compose.yml`, any other config
- Top-level directories: what exists at depth 1 and what each directory's name implies
- Monorepo check: does `packages/` exist? Are there multiple `package.json` files? Workspace config?

### 1.2 — Source tree skeleton

For the main source directory (usually `src/`):
- List all directories to depth 3
- Count files per directory (use `find ... | wc -l` or equivalent)
- Identify entry points: `layout.tsx`, `page.tsx`, `route.ts`, `middleware.ts`, any `index.ts` barrel files

### 1.3 — Config and schema files

Read (not just list) these key files — they define the system's shape:
- `package.json` — dependencies, scripts, workspaces
- `tsconfig.json` — path aliases, module system, target
- `next.config.js` — redirects, rewrites, env exposure, experimental features
- `prisma/schema.prisma` — all models, relations, enums
- `.env.example` — every environment variable the system expects
- Any `Dockerfile`, `docker-compose.yml`, deployment config
- `.eslintrc.json`, `jest.config.js`, `knip.json` — tooling config
- `packages/*/package.json` — sub-package dependencies if monorepo

### 1.4 — External integration surface

Identify every external system the code talks to:
- Database connection strings in `.env.example` (Postgres, BigQuery, Redis, etc.)
- API keys and service accounts (don't read values — just note which services)
- SDK imports: grep for `@google-cloud`, `@anthropic-ai`, `@slack`, `@sentry`, `googleapis`, `openai`, `@upstash/redis`, `@upstash/ratelimit`, etc.
- Webhook endpoints, cron jobs, scheduled functions

### Output

Write nothing yet. Hold findings in working memory for Phase 2.

---

## PHASE 2: DEEP READ

Now read file contents selectively. The goal is to understand what the system does, not memorize every line.

### 2.1 — Data layer

This codebase has two data layers — treat them as separate systems:

**POSTGRES (Neon via Prisma):**
- Read `prisma/schema.prisma` — 27 models across: Auth/Users, Goals, Forecast, Dashboard Requests, GC Hub, Explore/Reports, Games, Map
- Read `src/lib/prisma.ts` — singleton client with Neon-specific SSL/pooler logic
- Note which of the 14 Prisma-importing files are query files vs utility files

**BIGQUERY:**
- Read `src/lib/queries/` — analytics queries against Salesforce-sourced views
- Note: app reads BigQuery only. Writes flow Salesforce → BigQuery via Data Transfer Service, never from the app.
- Catalog which BigQuery views each query file depends on

**SHARED CONCERNS:**
- Read type definitions (`src/types/`) — every exported interface and type alias. Note which types are shared vs feature-local.
- Read the semantic layer (`src/lib/semantic-layer/`) — abstraction over BigQuery for the Explore AI feature.
- Identify how each data layer flows into the app: Prisma models serve user/config data; BigQuery views serve analytics data. These paths do not mix.

### 2.2 — API surface

- Read API route files (`src/app/api/**/route.ts`) — don't read every line, but scan each file to understand: HTTP methods exported, what query function it calls, what it returns, any auth/permission checks.
- Group routes by domain (e.g., `/api/dashboard/`, `/api/games/`, `/api/auth/`).
- Note which routes are thin pass-throughs vs which contain business logic.

### 2.3 — Component architecture

- Read page files (`src/app/**/page.tsx`) — what does each page render? What data does it fetch?
- Read layout files — auth wrappers, navigation, providers.
- Scan component directories — identify major feature components vs shared UI components.
- Note the client/server boundary: which components use `'use client'`? Which are server components?

### 2.4 — Supporting infrastructure

- Read utility files (`src/lib/utils/`) — what helpers exist? Date formatting, number formatting, export helpers, filter logic.
- Read any middleware (`middleware.ts`) — auth, redirects, rewrites.
- Read hooks (`src/hooks/`) — custom React hooks.
- Read config files (`src/config/`) — feature flags, constants, role definitions.

### 2.5 — Sub-packages

If `packages/` exists, for each sub-package:
- Read its `package.json` for purpose and dependencies
- Scan its `src/` directory structure
- Read its entry point and type files
- Understand how it connects to the main app (shared deploy? separate service? Slack bot? CLI tool?)

### 2.6 — Deployment and CI

- Read any CI workflow files (`.github/workflows/`)
- Read deployment configs (Vercel `vercel.json`, Dockerfile, deploy scripts)
- Read git hooks (`.husky/`) — pre-commit, post-commit behaviors
- Note the deployment model: serverless, container, monolith, microservices

### Output

Write nothing yet. Proceed to Phase 3.

---

## PHASE 3: WRITE HLD.md

Create or update `.claude/docs/HLD.md`. This is the file a cold agent reads first.

### Required sections

```markdown
# High-Level Design
> Auto-generated by /map-codebase on [DATE]. Do not edit sections not marked [PINNED].

## System Purpose
[2-3 sentences: what this system does, who uses it, what problem it solves]

## Architecture Overview
[Diagram or structured description of major components and how they connect.
Use ASCII art or markdown tables — no external image references.]

## Major Components
[For each top-level module/package/feature area:]
### [Component Name]
- **Purpose**: [one line]
- **Key files**: [entry points, not exhaustive file lists]
- **Data sources**: [what it reads from]
- **Data sinks**: [what it writes to or serves to]
- **External dependencies**: [APIs, services, SDKs]

## Data Flow
[How data moves through the system end-to-end. Start from the external source
(Salesforce, user input, etc.) and trace through to what the user sees.
Include the primary read path and any write-back paths.

Describe BOTH read paths explicitly — they are separate systems that never mix:
1. **Postgres read path**: Prisma client (`src/lib/prisma.ts`) → query/utility file → API route → component. Serves user accounts, goals, forecasts, dashboard requests, saved reports, game scores.
2. **BigQuery read path**: BigQuery SDK (`@google-cloud/bigquery`) → query function (`src/lib/queries/`) → API route → component. Serves recruiting funnel analytics, pipeline metrics, advisor data.

No API route or query function reads from both Postgres and BigQuery in the same request.
Note which path each major feature uses.]

## External Dependencies
| Dependency | Purpose | Integration Point |
|---|---|---|
| [service/SDK] | [why] | [which files/modules] |

## Authentication and Authorization
[How users authenticate, what roles exist, how permissions are enforced.
Note the auth provider, session management, and where role checks happen.]

## Deployment Model
[How the system is deployed. Serverless? Container? What hosting?
What's the CI/CD pipeline? What happens on git push?]

## Sub-Packages
[If monorepo: what each sub-package does, how it's deployed,
how it connects to the main app]

## Changelog
| Date | What changed |
|---|---|
| [DATE] | Initial mapping |
```

### Writing rules for HLD.md

- Write for an agent that has never seen this codebase. No jargon without definition.
- Every claim must be traceable to a file you read. If you inferred something, say so.
- Prefer concrete file paths over vague descriptions ("the query layer" -> "`src/lib/queries/` — 33 files, each exports one or more query functions consumed by API routes").
- Keep sections scannable. Use tables and bullet points, not paragraphs.
- Total length target: 200-400 lines. If a section needs more detail, that detail belongs in LLD.md.

---

## PHASE 4: WRITE LLD.md

Create or update `.claude/docs/LLD.md`. This is the file an agent reads when it needs to modify a specific module.

### Required sections

```markdown
# Low-Level Design
> Auto-generated by /map-codebase on [DATE]. Do not edit sections not marked [PINNED].

## Module Index
[Table: module path, purpose, key exports, primary consumers, line count]

## Per-Module Breakdown

### [Module: src/lib/queries/]
- **Purpose**: [what this module does]
- **Files**: [count and naming pattern]
- **Key exports**: [the 5-10 most important functions/types, with one-line descriptions]
- **Interfaces**: [what types flow in and out — parameter types, return types]
- **Consumers**: [who calls these exports — API routes, components, other modules]
- **Patterns**: [notable implementation patterns — parameterized queries, caching, transforms]
- **Gotchas**: [things an agent modifying this module must know]

### [Module: src/types/]
...

### [Module: src/components/dashboard/]
...

[Repeat for every significant module. Skip trivially small modules
but mention them in the Module Index table.]

## Cross-Cutting Patterns
[Patterns that span multiple modules:]
### Date Handling
[Which functions, which files, when to use which]
### NULL / Default Handling
[Convention for nullable fields across the stack]
### Export / CSV
[Both export paths, how columns are mapped, edge case handling]
### Error Handling
[Convention for try/catch, error responses, logging]
### Import Conventions
[Path aliases, barrel files, merge rules]

## Interface Map
[Key boundaries between modules — what data shape crosses each boundary.
Focus on the boundaries agents are most likely to change:]
- Query function return type -> API route response shape
- API response shape -> Component prop types
- Component data -> Export column mapping
- Prisma model -> API response (user/permission data)

## Changelog
| Date | What changed |
|---|---|
| [DATE] | Initial mapping |
```

### Writing rules for LLD.md

- Organize by module, not by feature. A module is a directory under `src/` that has a cohesive purpose.
- For each module, focus on what an agent needs to know to MODIFY it safely — not a line-by-line walkthrough.
- Include actual function signatures for key exports (copy from source, don't paraphrase).
- Note which modules are tightly coupled and which are independent.
- Flag any module where a change has a non-obvious ripple effect (e.g., changing a type requires updating 15 construction sites).
- Total length target: 400-800 lines. Err toward completeness — this is the reference doc.

---

## PHASE 5: WRITE CONSTRAINTS.md

Create or update `.claude/docs/CONSTRAINTS.md`. This is the file that prevents agents from breaking things.

### Required sections

```markdown
# Constraints
> Auto-generated by /map-codebase on [DATE]. Do not edit sections not marked [PINNED].
> An agent reading this file must treat every constraint as a hard rule
> unless the user explicitly overrides it.

## Naming Conventions
[File naming, variable naming, type naming patterns that MUST be followed.
Derive from actual code, not aspirational standards.]
- Route files: [pattern]
- Query files: [pattern]
- Type files: [pattern]
- Component files: [pattern]
- Utility files: [pattern]

## Data Contracts
[Shapes that must not change without updating all consumers:]
- [Type name] — used by [N] construction sites (list them)
- [API response shape] — consumed by [components]
- [BigQuery view contract] — field names are case-sensitive, tied to Salesforce

## Environment Assumptions
- **OS**: [what the code assumes — path separators, shell, line endings]
- **Node version**: [from .nvmrc or engines field]
- **Package manager**: [npm/yarn/pnpm, lockfile present?]
- **Module system**: [ESM/CJS, how determined]
- **Shell**: [what hooks and scripts assume]

## Blocked Areas
[Code that must not be modified without explicit human approval.
Derive from existing guardrails in CLAUDE.md, .cursorrules, or
agent definitions — but verify each one against the actual code.]
- [Area]: [why it's blocked, what would break]

## Known Fragility
[Places where a small change causes a large blast radius:]
- [File/module]: [what happens if you change it, how many consumers]
- [Pattern]: [why it's fragile, what the safe approach is]

## BigQuery Query Rules
[Rules for writing queries against BigQuery views:]
- Parameterization: all queries must use `@paramName` syntax — never string interpolation or template literals
- Field naming: case-sensitive, derived from Salesforce field API names (e.g., `Earliest_Anticipated_Start_Date__c`)
- NULL handling: COALESCE with sensible defaults — keep records, never filter NULLs to silently drop data
- Deduplication: document which flags exist (`is_sqo_unique`, `is_joined_unique`, `is_primary_opp_record`) and when each must be used
- No writes: the app never writes to BigQuery — all data flows inbound from Salesforce via Data Transfer Service

## Postgres/Prisma Rules
[Rules for the Prisma/Neon data layer:]
- ORM only: all Postgres access goes through Prisma client — no raw SQL, no `pg` driver, no `@vercel/postgres` queries
- Migration discipline: schema changes require `prisma migrate` — document whether migrations run automatically on deploy or must be triggered manually
- Sessions: NextAuth uses JWT strategy — there are no session tables in Postgres. Do not add database session management.
- User provisioning: users must be pre-created by an admin. Google OAuth sign-in checks for an existing `User` record and rejects unknown emails. Do not add auto-provisioning without explicit approval.
- Connection handling: `src/lib/prisma.ts` uses a Proxy for lazy init with Neon-specific timeouts — do not replace with a simple `new PrismaClient()` instantiation

## Build and Deploy Constraints
- Pre-commit hooks: [what they enforce]
- CI checks: [what must pass]
- Deployment: [what triggers a deploy, what can block it]
- Documentation: [what must be updated when code changes]

## Security Boundaries
- [What must never be logged]
- [What must never be exposed to the client]
- [Auth/permission enforcement points]

## Changelog
| Date | What changed |
|---|---|
| [DATE] | Initial mapping |
```

### Writing rules for CONSTRAINTS.md

- Every constraint must come from observed code, not policy wishes. If the pre-commit hook enforces X, say so. If nothing enforces X, don't list it.
- Be specific. "Don't break types" is useless. "Adding a field to `DetailRecord` requires updating 12 construction sites — see LLD.md Module: src/types/" is actionable.
- Include file paths and line numbers where constraints are enforced (e.g., "pre-commit hook at `.husky/pre-commit:3` runs `npx tsc --noEmit`").
- This file should be readable in under 2 minutes. If it's longer than 200 lines, you're including too much detail — move it to LLD.md.

---

## PHASE 6: SUMMARY AND CONFIDENCE REPORT

Print a structured summary to the console:

```
## Mapping Complete

### Files Written
- .claude/docs/HLD.md  — [N] lines, [M] components mapped
- .claude/docs/LLD.md  — [N] lines, [M] modules detailed
- .claude/docs/CONSTRAINTS.md — [N] lines, [M] constraints documented

### Coverage
- Source modules mapped: [N] / [total]
- API routes scanned: [N] / [total]
- Type definitions cataloged: [N] / [total]
- Sub-packages mapped: [N] / [total]

### Low-Confidence Areas
[List every section or claim marked [LOW CONFIDENCE], grouped by file.
For each one, explain what additional information would raise confidence.]

### Staleness Risk
[List areas most likely to become stale as the codebase evolves.
Suggest re-running /map-codebase when these areas change.]
```

**STOP. Do not proceed further.**

---

## FILES PRODUCED

| File | Phase | Purpose |
|------|-------|---------|
| `.claude/docs/HLD.md` | 3 | System purpose, components, data flows, external deps — the first file a cold agent reads |
| `.claude/docs/LLD.md` | 4 | Per-module breakdown, key functions, interfaces, patterns — the reference for modifying code |
| `.claude/docs/CONSTRAINTS.md` | 5 | Hard rules, naming conventions, data contracts, blocked areas — what agents must not violate |

---

## FAILURE MODES

- **Unreadable file (binary, too large):** Skip it, note in the relevant section as `[SKIPPED: reason]`.
- **Ambiguous module purpose:** Mark as `[LOW CONFIDENCE]` and describe what you observed vs what you couldn't determine.
- **Monorepo sub-package with separate toolchain:** Map its structure and dependencies but note that its internals may follow different conventions than the main app.
- **Missing config files:** If `.env.example`, `tsconfig.json`, or `package.json` don't exist at expected locations, note this as a constraint gap and proceed with what you can determine.

---

## WHEN TO RE-RUN

Re-run `/map-codebase` when:
- A new major feature area is added (new directory under `src/components/` or `src/app/`)
- A new sub-package is added to `packages/`
- The data layer changes significantly (new BigQuery views, new Prisma models)
- A new external integration is added
- An agent reports that `.claude/docs/` is stale or contradicts the code

The docs are designed to be updated incrementally — `[PINNED]` sections survive re-runs, and the Changelog tracks what changed.
