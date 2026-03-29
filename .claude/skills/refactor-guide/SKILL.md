---
name: refactor-guide
summary: Build a detailed, non-breaking refactor guide from exploration findings. Optimized for decomposition, extraction, import/export safety, and behavior preservation in this Next.js 14 / TypeScript / BigQuery dashboard.
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
---

# Refactor Guide Skill

You are writing a refactor execution guide for a codebase where safety matters more than aggressiveness.

The guide is not a brainstorm. It is an execution document for a future implementation pass.

## Goal

Convert exploration findings into a **small-step, reversible, non-breaking** refactor plan.

The plan must:
- preserve behavior exactly — zero intentional behavior changes
- preserve stable public import surfaces when possible
- minimize simultaneous changes
- surface risks before code is touched
- include concrete verification after every phase

**Guide tone calibration:** Match the guide's caution level to the actual risk. For Lane 2a targets (low-blast-radius UI/component extractions with tiny consumer counts), the guide should read as confident and execution-oriented — phases are "apply" by default when the extraction is clean. For Lane 3 or targets touching blocked areas, the guide should be more cautious with explicit stop-and-report checkpoints. Do not write every guide as if the refactor is presumptively dangerous.

## Assessment vs. extraction

Not every large or flagged file needs to be refactored. A valid guide output is: "assessed, no safe extraction available — leave as-is."

**Assessment-first posture (audit remediation):** For files flagged by the weekly audit, the default action is to read it, understand its responsibilities, identify what is and isn't safely extractable, and report. Extraction is only appropriate when:
- A clean, self-contained block (pure helper, local constant, type definition, isolated subcomponent) can be moved without changing behavior
- The consumer surface is fully identified and small
- Confidence is high that `npx tsc --noEmit` will pass
- The file is not in a blocked-by-default area

Do not force decomposition of files just because they exceed a line-count threshold. Some files are large because they have a single cohesive responsibility. Report that finding — it is a useful output.

**Execution-oriented posture (single-target, Lane 2a):** For dedicated single-target passes on UI/component files with confirmed tiny blast radius, the default shifts from "assess first" to "apply when clean." The exploration phase has already mapped dependencies and confirmed safety. If the dependency mapper shows 1-3 consumers, no barrel involvement, and no blocked-area coupling, each clean extraction boundary should be tagged as **apply** — not hedged with unnecessary assess-only qualifiers. These presentation-layer decompositions (extracting local subcomponents, pure helpers, renderer utilities, formatting functions, hooks) are exactly the refactors that make the codebase more agentically friendly: smaller files, clearer seams, and isolated concerns that `/new-feature` agents can modify without reading hundreds of lines of unrelated code.

### Leverage/risk tags

For each proposed extraction or cleanup in the guide, include a brief tag:

- **Agentic leverage**: `high` / `medium` / `low` — does this make future agentic work (via `/new-feature`, `/auto-refactor`, or manual agent prompts) concretely easier? High leverage means: clearer module boundary, isolated pure logic, reduced blast radius, removed real duplication agents will encounter again, faster targeted validation, or a safer seam for future features. Medium leverage means: useful improvement that makes the file easier to navigate or modify, but doesn't fundamentally change how agents interact with it.
- **Risk**: `high` / `medium` / `low` — does this touch blocked-by-default areas, have many consumers, require broad import churn, or have a fuzzy extraction boundary? Low risk means: 1-3 consumers, no barrel file, clean boundary, pure/presentation-focused code.
- **Recommendation**: `apply` / `assess-only` / `skip`
- One sentence explaining why.

This helps the user (and future agents) understand the reasoning, and helps the orchestrator prioritize when multiple extractions are possible but time is limited.

**Decision logic (single-target mode):**
- High leverage + low risk: **apply**
- High leverage + medium risk: **apply** with extra validation gates
- Medium leverage + low risk: **apply** — these are the bread-and-butter UI/component refactors that improve agentic development
- High leverage + high risk: **assess-only** (recommend as follow-up for dedicated single-target pass)
- Medium leverage + medium risk: **apply if** extraction boundary is clean and dependency map is confident; otherwise assess-only
- Low leverage + low risk: **skip** unless trivially small
- Low leverage + high risk: **skip**

**Decision logic (audit remediation mode):**
- High leverage + low risk: **apply** (unchanged — same conservative bar)
- Everything else: **assess and report** or **skip** (unchanged)

## Inputs

Read all exploration artifacts provided by the orchestrator.
At minimum, expect:
- `refactor-triage.md` — triage results and lane classification
- `code-inspector-findings.md` — types, construction sites, file dependencies
- `pattern-finder-findings.md` — established codebase patterns
- `dependency-mapper-findings.md` — imports, exports, consumers, barrel files, path stability
- `refactor-exploration-results.md` — synthesized exploration results

## Blocked by default

These areas are blocked within refactor scope. They may only proceed with explicit user approval.

- No BigQuery view or schema changes
- No SQL behavior changes (filters, aggregations, record inclusion)
- No metric, aggregation, or business-logic changes
- No export shape changes — both `ExportButton` (auto via `Object.keys`) and `ExportMenu` (explicit column mappings) paths
- No changes to drill-down record construction in any `*DrillDownModal.tsx` component (4 currently: `MetricDrillDownModal`, `VolumeDrillDownModal`, `ActivityDrillDownModal`, `AdvisorDrillDownModal`)
- No changes to semantic layer definitions (`src/lib/semantic-layer/definitions.ts`, `query-templates.ts`, `query-compiler.ts`)
- No changes to `src/lib/forecast-penalties.ts` (`computeAdjustedDeal()`)
- No extractions that move Node-only code (BigQuery SDK, Prisma, `src/lib/queries/`) into modules importable by `'use client'` components
- No broad path churn unless unavoidable
- No "while we're here" cleanup that expands risk

## Validation discipline

- **`npx tsc --noEmit`** after every code change. Not after every phase — after every individual file edit or extraction. This is the primary safety net.
- **`npm run build`** at phase boundaries or when confident a phase is complete. The build is slower and catches additional issues (unused imports, SSR problems), but is not needed after every micro-change.
- **`npm run lint`** at phase boundaries.
- **`npx jest --passWithNoTests`** only when the change touches `forecast-penalties.ts` or `semantic-layer/` (only test-covered areas).
- **`npm run gen:all`** once at the end of a session as a doc-sync step. It is NOT a substitute for typecheck validation.

## Preferred refactor style

Prefer this order of operations:
1. Add compatibility surfaces first if needed (re-exports from old paths)
2. Extract pure/internal pieces before shared/public pieces
3. Move types/constants/helpers before moving behavior-heavy logic
4. Update imports in the smallest coherent slice (`@/` alias paths)
5. Keep old paths as re-exports temporarily when that reduces risk
6. Run `npx tsc --noEmit` after every slice — do not continue if it fails

## Guide format selection

The orchestrator (`/auto-refactor`) specifies which format to use:

- **Full guide format** — for standard-track targets (Lane 2 non-2a, Lane 3, or any target with ambiguity). Use the "Required guide structure" below.
- **Lightweight guide format** — for lightweight Lane 2a targets only (confirmed by dependency mapper). Use the "Lightweight guide structure" below.

When in doubt, use the full format. The lightweight format is a privilege earned by clean dependency maps, not a default.

---

## Lightweight guide structure (Lane 2a only)

For confirmed lightweight Lane 2a targets — tiny blast radius, 1-3 consumers, no barrel involvement, no blocked-area coupling, clean extraction boundaries.

### 1. Refactor Summary
- target, triage lane (2a), one-sentence summary

### 2. Scope and Non-Goals
- exact scope (2-3 lines)
- blocked areas confirmed as untouched (1 line)

### 3. Pre-Flight
- `npx tsc --noEmit` — baseline
- `npm run build` — baseline
- targeted Grep for current import paths of the target

### 4. Execution Phases
For each phase:
- leverage/risk tag (same format as full guide)
- files touched (exact paths)
- what moves where
- import/export updates
- validation: `npx tsc --noEmit` after each extraction
- `npm run build` + `npm run lint` after the final phase

Keep phase descriptions concise. For a 2-file extraction, a phase can be 5-10 lines.

### 5. Post-Refactor Verification
- `npx tsc --noEmit`
- `npm run build`
- `npm run lint`
- targeted Grep for stale import paths
- doc sync: `npx agent-guard sync` && `npm run gen:all`

### 6. Rollback
- `git revert` guidance (1-2 lines)

**Zero-behavior-change rule still applies.** If a bug is found, report it separately — do not fold it into the refactor.

**All validation discipline still applies.** `npx tsc --noEmit` after every code change is non-negotiable even in lightweight mode.

---

## Required guide structure (full format)

### 1. Refactor Summary
- target
- triage lane (1-4, per `/auto-refactor` classification)
- one-paragraph summary of the planned refactor

### 2. Scope and Non-Goals
- exact scope
- explicitly excluded areas
- safety constraints for this target

### 3. Pre-Flight Checklist
Must include these concrete commands:
- `npx tsc --noEmit` — baseline typecheck
- `npm run build` — full Next.js build (uses `cross-env NODE_OPTIONS=--max-old-space-size=8192`)
- `npm run lint` — Next.js lint
- `npx jest --passWithNoTests` — run existing tests (note: test coverage is sparse — only `src/lib/__tests__/forecast-penalties.test.ts` and `src/lib/semantic-layer/__tests__/` have tests)
- targeted Grep checks relevant to the refactor (e.g., verify current import paths, export consumers)
- baseline knip check if the refactor touches exports: `npx knip --reporter json`

### 4. Execution Phases
For each phase include all of the following:
- objective
- **leverage/risk tag** — agentic leverage (high/low), risk (high/low), one-line reason (see "Assessment vs. extraction" above)
- exact files touched (full paths from `src/`)
- exact code movement or extraction
- import/export updates required (note: `@/*` maps to `./src/*`)
- compatibility shims/re-exports if needed (especially for barrel files: `src/components/ui/index.ts`, `src/lib/semantic-layer/index.ts`)
- what must remain semantically identical
- validation gate: `npx tsc --noEmit` + `npm run build` + `npm run lint` at minimum; add `npx jest --passWithNoTests` if the phase touches `forecast-penalties.ts` or `semantic-layer/`
- stop-and-report criteria

### 5. Post-Refactor Verification
Include:
- full typecheck: `npx tsc --noEmit`
- full build: `npm run build`
- full lint: `npm run lint`
- `npx jest --passWithNoTests` — run all existing tests
- targeted Grep for stale import paths (search for old `@/` paths that should have been updated)
- targeted Grep for server/client boundary violations (search for `'use client'` files that now import from moved server-only modules)
- targeted runtime/UI smoke checks for affected areas
- export/path parity checks (verify no barrel file exports were dropped)
- doc sync: `npx agent-guard sync` followed by `npm run gen:all`

### 6. Rollback Notes
- how to revert safely (`git revert` or `git reset` guidance)
- what partial states are not acceptable to leave committed

### 7. Open Decisions
- only decisions that truly require a human
- keep concise and numbered

## What a good phase looks like

A strong phase is narrow and verifiable, for example:
- **Leverage**: high — isolates pure transform helpers so `/new-feature` agents can add query logic without reading UI code. **Risk**: low — only one consumer, no barrel file involved. **Recommendation**: apply.
- extract local constants and pure helper functions from `src/lib/queries/detail-records.ts` into `src/lib/queries/detail-records-helpers.ts`
- update imports in the same folder only
- preserve existing public exports (no barrel file in `src/lib/queries/`, so only direct consumers need updating)
- run `npx tsc --noEmit`, `npm run build`, and Grep checks before continuing

Another strong phase (Lane 2a UI extraction):
- **Leverage**: medium — smaller component file means future `/new-feature` agents modifying the parent don't need to read 200 lines of unrelated feedback UI. **Risk**: low — self-contained component with useState and fetch only, no shared state with parent. **Recommendation**: apply.
- extract `ResponseFeedback` component from `ExploreResults.tsx` into `ResponseFeedback.tsx`
- add `'use client'` directive, move ThumbsUp/ThumbsDown imports
- parent gains one import line; no other files affected
- run `npx tsc --noEmit` to verify

A weak phase is broad, low-leverage, or hard to validate, for example:
- "reorganize the semantic layer" — high risk, unclear leverage
- "clean up shared utilities" — vague scope, no specific agentic benefit stated
- "modernize the dashboard architecture" — cosmetic, not a concrete extraction

## Repo-specific risk areas

These areas require extra caution during refactors. During weekly audit remediation, the default for all blocked-by-default areas is **report only** — do not extract or restructure.

| Area | Why it's risky | What to preserve |
|---|---|---|
| `src/lib/queries/` (~33 files) | No barrel file — every consumer imports by direct path | All import paths; do not introduce a barrel without updating all 120+ API routes |
| `src/types/drill-down.ts` | 4 `*DrillDownModal.tsx` files construct records by hand | Every field in every record type; every construction site |
| `src/lib/semantic-layer/` | Barrel file at `index.ts`; changes ripple into Explore AI | Blocked by default — do not restructure without explicit approval |
| `src/lib/forecast-penalties.ts` | Single source of truth for penalty math; has tests at `src/lib/__tests__/forecast-penalties.test.ts` | Blocked by default — do not move `computeAdjustedDeal()` or duplicate logic |
| `src/components/dashboard/ExportMenu.tsx` | Explicit column mappings for Sheets/CSV export | Blocked by default — column order, headers, and formatting |
| `src/components/ui/ExportButton.tsx` | Auto-exports via `Object.keys` — silently includes/excludes fields | Blocked by default — do not change which fields appear on exported objects |
| `src/lib/sheets/` (3 files) | Google Sheets export formatting (`google-sheets-exporter.ts`, `sheets-types.ts`, `gc-sheets-reader.ts`) | Blocked by default — tab structure, conditional formatting, cell formatting |
| `src/lib/permissions.ts` | RBAC source of truth (8 roles) | Blocked by default — do not change role definitions or permission checks |
| `src/lib/utils/` (9 files) | Shared helpers consumed by both server routes and client components | If extracting, verify no Node-only code leaks into `'use client'` consumers |
| `next/dynamic` imports | 4 page/component files lazy-load components by string path | If renaming/moving lazily-loaded components, update the dynamic import string |

## Quality bar

The final guide should read like a careful senior engineer's rollout plan, not a brainstorming memo.
