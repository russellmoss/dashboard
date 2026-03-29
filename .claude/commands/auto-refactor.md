# /auto-refactor — Automated Refactor Planning and Safety Pipeline

You are an orchestrator. Your job is to take a refactor target or refactor-audit finding, run a full exploration and planning pipeline, get adversarial review, and produce a refined refactor guide ready for execution. You do NOT execute the guide unless the user explicitly asks for execution in a fresh context after this command completes.

**Refactor target / audit finding:** $ARGUMENTS

---

## MODE DETECTION

Read $ARGUMENTS and determine the operating mode:

**Audit Remediation Mode** — if the input contains multiple audit categories (npm vulnerabilities, large files, TODOs, dead exports) or looks like output from the weekly refactoring audit workflow. Go to **AUDIT REMEDIATION MODE** below.

**Single-Target Mode** — if the input is a single refactor target (one file, one module, one specific finding). Go to **RULES** below and proceed through Phases 0-5. Single-target mode has two tracks:

- **Standard track** — full exploration team, full artifact set, council review. Used for Lane 2 (non-2a), Lane 3, or any target with ambiguity.
- **Lightweight track** — dependency-mapper-first, reduced exploration, council optional, shorter artifacts. Used only when Phase 0 triage confirms Lane 2a AND the dependency mapper confirms all lightweight eligibility criteria. See **LIGHTWEIGHT LANE 2a TRACK** below.

When in doubt, ask the user which mode they intend.

---

## AUDIT REMEDIATION MODE

This mode processes weekly audit findings efficiently. It does NOT spawn agent teams or run council review for individual audit items. Those heavyweight phases are reserved for specific refactor targets that emerge from the assessment.

### Audit Rules

1. Work through findings in priority order (npm vulns → TODOs → large files → dead exports).
2. **Skip sections that are at baseline.** If the audit says "at baseline — skip," move on immediately.
3. Separate every finding into one of three dispositions: **apply**, **assess and report**, or **skip**.
4. Run `npx tsc --noEmit` after every accepted code change. Not after every finding — after every change that touches code.
5. Do not batch multiple code changes before validating. One change, one typecheck.
6. `npm run gen:all` runs once at the end, not between changes.
7. Hard constraints from the RULES section (zero behavior change, blocked areas) apply in full.
8. Do not over-refactor. If a file is large but stable, reporting is the right action.

### Priority 1: npm Vulnerabilities

1. Run `npm audit --omit=dev` to see current state.
2. If new high-severity vulnerabilities exceed the baseline in `.github/workflows/refactor-audit.yml`:
   - Run `npm audit fix` (without `--force`).
   - Run `npx tsc --noEmit` and then `npm run build` to verify nothing broke. The build is important here because dependency bumps can cause runtime/SSR issues that the typecheck alone won't catch.
   - If `npm audit fix` resolves the issue, report what changed.
   - If unresolved vulnerabilities remain, report: which packages, which advisories, whether `--force` would introduce breaking changes, and what the breaking-change risk is. Do NOT run `--force` without explicit user approval.
3. If at baseline, skip entirely.

### Priority 2: TODO/HACK/FIXME Comments

1. If above baseline: list the new comments with file paths and line numbers.
2. For each new TODO: if the fix is small, mechanical, and safe (e.g., a missing null check, a cleanup of an unused variable), apply it and run `npx tsc --noEmit`.
3. For anything non-trivial: report the finding and what it would take to address, but do not change code.
4. If at baseline, skip entirely.

### Priority 3: Large Files (>500 lines)

This is the most important section to get right. **Assessment first, extraction only when clearly safe.**

For each newly-large file (exceeding the baseline count):

1. **Read the file.** Do not propose changes without reading it.
2. **Assess the file** using the leverage/risk rubric below.
3. **Report your assessment** with a clear disposition per file.

### Leverage/Risk Rubric

For every candidate extraction or cleanup, evaluate two things:

**Agentic leverage** — would this refactor make future agentic development concretely easier?

| Leverage indicator | Example in this repo |
|---|---|
| Creates a clearer module boundary | Extracting pure transform helpers from a 700-line Content component so `/new-feature` agents can add metrics without reading UI code |
| Isolates pure logic from side effects or UI | Splitting constants/types out of a file that also does BigQuery calls, so type changes don't require understanding the query layer |
| Reduces dependency blast radius | Extracting a shared utility so changes to it don't require reading all 120+ API routes to verify safety |
| Removes real duplication agents will encounter again | Two Content components with copy-pasted filter logic — agents will copy the pattern again unless it's consolidated |
| Makes targeted validation faster | Smaller files = faster `npx tsc --noEmit` feedback loops; fewer imports = easier to verify extraction safety |
| Creates a safer seam for future features | Extracting a hook from a monolithic component so the next `/new-feature` can add behavior without editing a 600-line render function |

**Risk** — see the risk-based disposition table below. In addition, consider:
- How many downstream consumers import from this file?
- Does the file have tests? (Most do not — only `forecast-penalties.ts` and `semantic-layer/` have tests.)
- Is the extraction boundary clean or fuzzy?
- Would it require import path changes across many files?

**Decision matrix (audit remediation mode — conservative):**

| | Low risk | High risk |
|---|---|---|
| **High leverage** | **Apply** — good candidate for extraction during audit remediation | **Assess and report** — flag as recommended follow-up for a dedicated `/auto-refactor` single-target pass |
| **Medium leverage** | **Assess and report** — note as candidate for single-target pass | **Skip** |
| **Low leverage** | **Skip or apply only if trivially small** — e.g., extracting a 5-line constant block. Do not spend effort on cosmetic cleanup. | **Skip** — not worth the risk for low payoff |

Line count alone is never sufficient reason to refactor. A 600-line file with one cohesive responsibility and no agentic leverage is correctly left alone.

**Risk-based disposition for large files:**

| File location | Default disposition | When extraction is OK |
|---|---|---|
| `src/lib/semantic-layer/` | Report only | Never during audit remediation |
| `src/lib/queries/` | Report only | Only tiny pure helpers with zero consumer path changes |
| `src/lib/sheets/` | Report only | Never during audit remediation |
| `src/lib/forecast-penalties.ts` | Report only | Never during audit remediation |
| `src/components/dashboard/ExportMenu.tsx` | Report only | Never during audit remediation |
| `*DrillDownModal.tsx` | Report only | Never during audit remediation |
| `src/app/api/**/route.ts` | Report only | Never during audit remediation — routes are thin pass-throughs |
| `src/components/**/*Content.tsx` | Assess for extraction | Local UI subcomponents, local constants, repeated JSX blocks |
| `src/lib/utils/` | Assess for extraction | Pure helper consolidation, duplicate logic across nearby files |
| `src/components/` (general) | Assess for extraction | Local subcomponents, extracted hooks, separated constants |

**Only apply a large-file extraction during audit remediation if ALL of these are true:**
- The extracted code is a pure function, constant block, type definition, or self-contained UI subcomponent
- It has zero side effects and no external state dependencies
- The extraction does not change any import path consumed by other modules (or the consumer count is small and all paths are updated)
- It does not touch any blocked-by-default area
- You have high confidence it will not change behavior
- `npx tsc --noEmit` passes after the extraction

**If any of these are not true, report the finding but do not extract.**

### Priority 4: Dead Exports

1. If above baseline: list the newly-dead exports with file paths.
2. Verify each with knip before removing — check for dynamic imports, barrel re-exports, and test-only usage.
3. Remove only exports you can verify have zero consumers.
4. Run `npx tsc --noEmit` after each removal.
5. If at baseline, skip entirely.

### Audit Final Report

After processing all priorities, produce a structured report:

```
## Weekly Audit Remediation Report — [date]

### Changes Made
- [list each change: what was done, which file, validation result]

### Assessed but Intentionally Unchanged
- [list each finding that was assessed but left alone]
- [for each: leverage (high/medium/low), risk (high/medium/low), and why it was left unchanged]

### Skipped (At Baseline)
- [list any sections that were at baseline and skipped]

### Validation Results
- npx tsc --noEmit: [pass/fail, any errors]
- npm run gen:all: [pass/fail, any errors]

### Unresolved npm Audit Issues
- [list any high-severity vulnerabilities that npm audit fix did not resolve]
- [for each: package, advisory, breaking-change risk of --force]

### Recommended Follow-ups
- [any findings that warrant a dedicated /auto-refactor pass as a single-target refactor]
- [any findings that need user decisions before proceeding]
```

Run `npm run gen:all` to regenerate doc inventories, then print the report.

**STOP. Do not proceed further unless the user asks for a specific follow-up.**

---

## SINGLE-TARGET MODE

The following phases apply when `/auto-refactor` is invoked with a single refactor target — one file, one module, or one specific finding that warrants deep exploration and planning.

---

## RULES

1. Execute phases in strict order. Do not skip phases.
2. Write all artifacts to disk in the project root. Later phases read them from disk.
3. Print a progress header at the start of each phase.
4. Do not ask the user anything until the Human Input Gate in Phase 4.
5. If a phase fails (tool timeout, repo search failure, build failure), report clearly and stop.
6. Treat this as a refactor, not feature work. Default assumption is **zero intentional behavior change**. If you discover a bug during exploration, report it but do NOT fix it as part of the refactor. Bug fixes require explicit user scope expansion or a separate session.
7. Hard constraints:
   - **Zero BigQuery view changes** — no SQL semantics, filters, aggregations, or column changes
   - **Zero data mutations** — no Salesforce writebacks, no Hightouch sync changes
   - **Zero intentional behavior changes** — dashboard outputs, exports, and API responses must be identical
   - **Do not change**: semantic layer definitions (`src/lib/semantic-layer/definitions.ts`, `query-templates.ts`), metric calculations, export column mappings, drill-down record construction, or Sheets export formatting — unless the user explicitly expands scope
8. If exploration suggests that the requested work requires changing BigQuery views, changing exported data shape, changing record inclusion rules, or changing dashboard calculations, stop and report a **scope violation** instead of planning the refactor.
9. Prefer extraction, decomposition, utility consolidation, import cleanup, naming cleanup, and boundary clarification.
10. Never present a risky refactor as safe unless it passes the validation gates defined below.

---

## PHASE 0: TRIAGE THE FINDING

Read the audit finding / request and classify it into one of four lanes. Write the result to `refactor-triage.md`.

### Lane 1 — Mechanical
Examples:
- `npm audit fix`
- lockfile refresh
- generated inventory sync
- obvious import dedupe

### Lane 2 — Structural-safe
These require assessment before action. Being Lane 2 does NOT mean "always extract" — it means the extraction is safe **if** a clean boundary exists. Assess first, apply only when confident.

Examples:
- extract pure helper functions from large files — only when the helper is self-contained with no shared state
- extract local UI subcomponents from page-level `*Content.tsx` files — only when the component is fully local
- split constants/types from one oversized file — only when no consumer path changes are needed or all are identified
- consolidate copy-pasted formatting/mapping utilities in `src/lib/utils/` — only when the duplicated logic is truly identical
- dead export cleanup confirmed by knip (see current baseline in `.github/workflows/refactor-audit.yml`) — only after verifying zero consumers

**Lane 2a — Low-blast-radius UI/component extraction** (single-target mode only):
A Lane 2 target qualifies as 2a when ALL of the following are true:
- The target is primarily a UI/component file (`src/components/`, `*Content.tsx`)
- 1-3 consumers (verified by dependency mapper)
- No barrel file involvement
- No `next/dynamic` import fragility
- No server/client boundary hazard
- Proposed extractions are local subcomponents, pure helpers, constants, hooks, or renderer utilities
- No coupling to blocked-by-default areas (drill-down record construction, export shape, semantic layer)

Lane 2a targets may advance to execution-ready guidance without excessive caution. These are exactly the refactors that improve future agentic development — smaller files, cleaner seams, isolated presentation logic — and should not get stuck in assess-only mode when the dependency map confirms low blast radius.

**Precedent:** `ExploreResults.tsx` (1779→1139 lines) was successfully decomposed via Lane 2a: 4 new files extracted, 1 consumer, no barrel involvement, zero behavior change, all validation gates passed.

### Lane 3 — Structural-risky
Examples:
- decomposing query modules in `src/lib/queries/` (no barrel file — all consumers import by direct path)
- moving shared types across module boundaries in `src/types/`
- changing barrel exports in `src/components/ui/index.ts` or `src/lib/semantic-layer/index.ts`
- splitting semantic layer files (`definitions.ts`, `query-compiler.ts`, `query-templates.ts`)
- extracting from drill-down modals that manually construct typed records

### Lane 4 — Blocked by default
These areas are blocked within `/auto-refactor` scope. They may only proceed with explicit user approval that expands scope beyond a non-breaking refactor.

Examples:
- changing BigQuery views or SQL behavior/filters
- changing export columns, Sheets export shape, or CSV formatting
- changing calculations, dashboard metrics, conversion rate logic, or AUM aggregations
- changing Hightouch sync behavior or Salesforce writeback logic
- changing `forecast-penalties.ts` computation (`computeAdjustedDeal()`) — single source of truth
- changing semantic layer definitions, query templates, or agent prompt

For the triage file include:
1. Classification lane (and whether Lane 2a applies — see Lane 2a criteria above)
2. Why it belongs in that lane
3. **Agentic leverage** — would this refactor concretely improve future agentic development? (See leverage indicators in the Audit Remediation rubric.) If leverage is low, note that and consider whether the refactor is worth the effort. Use `high / medium / low` (not just binary).
4. **Blast radius** — `tiny` (1-3 consumers, no barrel, no dynamic imports), `small` (4-10 consumers, all paths mapped), `large` (10+ consumers or barrel/dynamic import involvement)
5. Whether `/auto-refactor` may proceed
6. Non-goals and hard constraints for this specific target
7. Whether this should be treated as one refactor or split into multiple smaller refactors

If the result is Lane 4, stop after writing `refactor-triage.md` and report the scope violation.

If the result is Lane 1, create a minimal plan and skip directly to Phase 5.

If the result is Lane 2a, proceed to **LIGHTWEIGHT LANE 2a TRACK** below.

Otherwise proceed to Phase 1 (standard track).

---

## LIGHTWEIGHT LANE 2a TRACK

This track is available only when Phase 0 triage classifies the target as Lane 2a. It reduces orchestration overhead for clearly safe, tiny-blast-radius UI/component refactors while preserving all validation discipline.

**This track is NOT available when any of the following are true:**
- Target touches a blocked-by-default area (semantic layer, queries, drill-down, exports, sheets, forecast, permissions)
- Barrel file involvement
- Server/client boundary hazard
- `next/dynamic` import fragility
- More than 3 consumers
- Public API surface instability
- Any evidence of behavior-change risk

If any disqualifier is discovered at any point during this track, escalate to the standard track (Phase 1 with full exploration team).

### Step L1: Dependency Mapping (eligibility gate)

Spawn the dependency-mapper agent (agent: dependency-mapper) with the standard task prompt from Phase 1 Teammate 3.

Read `dependency-mapper-findings.md` when complete. The dependency mapper's output includes a `lightweight-eligible` assessment. Check it:

- If **lightweight-eligible: yes** — continue this track.
- If **lightweight-eligible: no** — escalate to standard track (Phase 1 with full exploration team). Print: "Dependency mapper found disqualifiers for lightweight mode: [reasons]. Escalating to standard track."

### Step L2: Focused Exploration

Read the target file(s) yourself. Perform a focused review covering:
- Current responsibilities of the target
- Natural extraction boundaries (subcomponents, helpers, constants, hooks, types)
- Whether any extraction would cross into blocked areas
- Whether the extraction boundaries are clean or fuzzy

**Optional escalation to additional agents:** If this review reveals ambiguity — fuzzy boundaries, unclear shared state, surprising coupling, or anything that makes you less confident — spawn code-inspector and/or pattern-finder as needed. If you spawn either, read their findings before continuing.

If the focused review confirms clean extraction boundaries, proceed.

Write `refactor-exploration-results.md` with the standard 10 sections, but keep each section proportional to the target's complexity. For a tiny-blast-radius extraction, most sections will be 1-3 lines.

### Step L3: Build Concise Guide

Follow the refactor-guide skill (`.claude/skills/refactor-guide/SKILL.md`) using the **lightweight guide format** (see skill docs).

Read:
- `refactor-triage.md`
- `dependency-mapper-findings.md`
- `refactor-exploration-results.md`

Produce `agentic_refactor_guide.md` using the lightweight format.

### Step L4: Council Decision

Council is **optional** in lightweight mode. Use it when:
- The extraction boundary is fuzzy
- Shared utilities are being introduced (not just local extractions)
- More than 4-5 files are touched
- The dependency mapper flagged any caution signals (even if still lightweight-eligible)
- Server/client issues are even remotely possible
- You are not confident the refactor is obviously safe

If council is skipped, note it in the ready summary: "Council skipped — target is a clearly safe Lane 2a extraction with [N] consumers, no barrel involvement, and clean boundaries."

If council is used, follow Phase 3 as normal.

### Step L5: Ready Summary

Write `refactor-ready-summary.md` with the standard 10 fields from Phase 5.

Write `refactor-decisions-needed.md` — likely `No human decisions required.` for most lightweight targets.

Then print the console summary. For lightweight targets, the files list is shorter:

```
Refactor: [target]
Lane: 2a (lightweight track)
Safe to attempt: [yes/no/conditional]
Top risks:
  1. ...
Human input required: [yes/no]
Council: [used / skipped — reason]
Files written: refactor-triage.md, dependency-mapper-findings.md, refactor-exploration-results.md, agentic_refactor_guide.md, refactor-decisions-needed.md, refactor-ready-summary.md

Recommended next steps:
1. Run /compact to clear context
2. Then: "Execute agentic_refactor_guide.md phase by phase. Stop at each validation gate and report results before proceeding. Start with Pre-Flight."
```

**STOP. Do not proceed further.**

---

## PHASE 1: EXPLORATION (standard track)

> **Note:** If the target was classified as Lane 2a in Phase 0, use the Lightweight Lane 2a Track instead of this phase. This phase is for standard-track targets only.

Spawn an agent team with 3 teammates to investigate in parallel:

### Teammate 1: Code Inspector (agent: code-inspector)

Task: "Investigate the codebase for the following refactor target: $ARGUMENTS

Focus on:
- The current responsibilities of the target file(s)
- Natural extraction boundaries (helpers, subcomponents, query builders, constants, types)
- Every TypeScript type/interface touched by the target
- Every file that constructs, consumes, or re-exports the target module's outputs
- Any public API surfaces that must remain stable
- Any places where behavior could accidentally drift during extraction

Save findings to `code-inspector-findings.md` in the project root."

### Teammate 2: Pattern Finder (agent: pattern-finder)

Task: "Find refactor and implementation patterns relevant to the following target: $ARGUMENTS

Trace:
- Similar files that are already well-factored (look for comparable modules in `src/lib/queries/`, `src/lib/utils/`, `src/components/`)
- Existing utility extraction patterns (how helpers are split in `src/lib/utils/`)
- Existing query/helper/component decomposition patterns
- Existing import/export and barrel-file conventions (barrel files exist at `src/components/ui/index.ts`, `src/lib/semantic-layer/index.ts` — but NOT in `src/lib/queries/`)
- Repeated logic across nearby files that could be consolidated safely
- Any inconsistencies between similar files that the refactor should align with

Save findings to `pattern-finder-findings.md` in the project root."

### Teammate 3: Dependency Mapper (agent: dependency-mapper)

Task: "Map the dependency and impact surface for the following refactor target: $ARGUMENTS

Find:
- All imports into the target file(s) — search both `@/` alias paths and relative paths
- All exports from the target file(s)
- All consumers of those exports (API route files under `src/app/api/`, component files, utility files)
- Any barrel files involved (known: `src/components/ui/index.ts`, `src/lib/semantic-layer/index.ts`, `src/components/advisor-map/index.ts`, `src/components/games/pipeline-catcher/index.ts`)
- Note: `src/lib/queries/` has NO barrel file — all query files are imported by direct path
- Any likely circular dependency risks if code is extracted
- Any `next/dynamic` imports or lazy-loaded components that reference the target
- Which paths must remain stable to avoid breakage

Save findings to `dependency-mapper-findings.md` in the project root."

### Synthesis

Once all three teammates complete, read all findings files plus `refactor-triage.md` and produce `refactor-exploration-results.md` containing:

1. **Pre-Flight Summary** — 5-10 line plain-English summary. Print this to console so the user sees it scroll by.
2. **Triage Outcome** — lane (including 2a if applicable), scope, and whether the refactor may proceed
3. **Blast Radius Assessment** — consumer count, barrel involvement, dynamic import exposure, server/client boundary status. For Lane 2a targets, explicitly confirm the low-blast-radius criteria are met.
4. **Target Responsibilities Today** — what the current file/module does
5. **Safe Extraction Boundaries** — specific blocks that can move without changing behavior
6. **Dependency Surface** — imports, exports, consumers, barrel files, path stability risks
7. **Files to Modify** — complete list with file paths and exact intended changes
8. **Behavior Preservation Risks** — places where seemingly-safe movement could change semantics
9. **Recommended Refactor Order** — smallest safe sequence of steps
10. **Blocked / Out-of-Scope Areas** — especially BigQuery views, SQL semantics, export shapes, business logic

Proceed immediately to Phase 2.

---

## PHASE 2: BUILD REFACTOR GUIDE

Follow the refactor-guide skill (`.claude/skills/refactor-guide/SKILL.md`).

Read:
- `refactor-triage.md`
- `code-inspector-findings.md`
- `pattern-finder-findings.md`
- `dependency-mapper-findings.md`
- `refactor-exploration-results.md`

Produce `agentic_refactor_guide.md`.

The guide must optimize for **small, reversible, non-breaking** changes.

Required sections:
- Pre-flight checklist
- Non-goals and hard constraints
- Refactor phases in execution order
- Exact file moves / extractions / import changes
- Validation gate after every phase
- STOP AND REPORT checkpoints
- Post-refactor verification checklist
- Rollback notes

Every phase must include:
- What code moves and where
- Which imports/exports change
- Which file paths must remain stable
- What must remain semantically identical
- Concrete validation commands: `npx tsc --noEmit`, `npm run build`, `npm run lint`, targeted Grep checks. Note: test coverage is sparse — only `src/lib/__tests__/forecast-penalties.test.ts` and `src/lib/semantic-layer/__tests__/` exist. Run `npx jest --passWithNoTests` for affected test files when applicable.

**Savvy-specific safety rules:**
- Do not modify BigQuery views or schemas
- Do not change SQL behavior, record inclusion, aggregations, or metric definitions
- Do not change CSV/Sheets/export shape unless explicitly in scope — both `ExportButton` (auto via `Object.keys`) and `ExportMenu` (explicit column mappings) paths
- Do not change drill-down record construction in any `*DrillDownModal.tsx` component
- Preserve exact casing of existing field names and existing typed shapes
- Keep parameterized queries (`@paramName`) as parameterized queries
- Prefer import merges, not duplicate imports
- Preserve existing route contracts and component props unless the refactor explicitly includes a compat layer
- Do not move or restructure `src/lib/semantic-layer/` files without explicit approval — changes ripple into the Explore AI feature
- Do not modify `src/lib/forecast-penalties.ts` (`computeAdjustedDeal()`) — single source of truth for penalty math

**Post-refactor doc sync:** Every refactor guide must include a doc sync phase: `npx agent-guard sync` followed by `npm run gen:all`.

Write the guide to `agentic_refactor_guide.md`, then proceed immediately to Phase 3.

---

## PHASE 3: ADVERSARIAL COUNCIL REVIEW (standard track)

> **Note:** If the target is on the lightweight Lane 2a track, council is optional. See Step L4 in the Lightweight Lane 2a Track for when to use it.

Send the refactor guide and exploration results to OpenAI and Gemini for adversarial review using the council-mcp MCP tools (`mcp__council-mcp__ask_openai`, `mcp__council-mcp__ask_gemini`). Send **separate** prompts — do NOT use `ask_all`.

> **Pre-flight check:** Before attempting council calls, verify that `mcp__council-mcp__ask_openai` and `mcp__council-mcp__ask_gemini` tools are visible. If they are not visible, council-mcp is not registered or not running.
>
> **Fallback — council unavailable:** If council-mcp tools are not visible, or if calls fail with missing API key errors, do NOT halt the entire pipeline. Instead:
> 1. Print: "⚠ Council MCP is unavailable. Skipping adversarial cross-LLM review."
> 2. Print the specific reason (tools not visible, or which API key is missing).
> 3. Print: "To enable council for future runs, see the Council MCP Troubleshooting section at the bottom of this file."
> 4. Skip to Phase 4 with a note that council review was skipped and the user may run `/council` manually after this command completes.
>
> **Do NOT block the pipeline on council availability.** Council is valuable but optional — the exploration, guide, and self-triage phases still produce a usable refactor plan.

### Prepare the payload

Read and concatenate:
- `refactor-triage.md`
- `refactor-exploration-results.md`
- `agentic_refactor_guide.md`

### Send to OpenAI

Use `ask_openai` with `reasoning_effort: "high"`.

**System prompt:** "You are a senior TypeScript engineer reviewing a non-breaking refactor plan for a Next.js 14 analytics dashboard backed by BigQuery. Your job is adversarial — find what will break."

**Prompt:** Include the full payload, then ask OpenAI to focus on:
- Type safety: Are all touched construction/consumption sites covered? Every file that constructs an object of a modified type?
- Import/export safety: Will any import path, barrel export (`src/components/ui/index.ts`, `src/lib/semantic-layer/index.ts`), or public module surface break?
- Server/client boundary safety: Does any extraction move Node-only code (BigQuery SDK, Prisma, `src/lib/queries/`) into a path importable by `'use client'` components? Does any move break `next/dynamic` lazy imports?
- Refactor ordering: Can each phase execute given the prior phases?
- Circular dependency risk: Does any proposed extraction create cycles or awkward coupling?
- Compatibility: Are route contracts, component props, and typed return shapes preserved?
- Missing steps: Anything implied but not spelled out?
- Path alias: All `@/` imports resolve correctly after moves?

**Required response format:**
```
## CRITICAL ISSUES (will break build/runtime or change behavior)
## SHOULD FIX (fragile boundaries, drift, cleanup gaps)
## DESIGN QUESTIONS (decisions needing human input — number each one)
## SUGGESTED IMPROVEMENTS (ranked by impact)
```

### Send to Gemini

Use `ask_gemini` (thinking enabled by default).

**System prompt:** "You are a senior software architect and maintainer reviewing a non-breaking refactor plan for a Next.js 14 financial analytics dashboard. Your job is to find maintainability problems, hidden behavior drift, and architectural regressions."

**Prompt:** Include the full payload, then ask Gemini to focus on:
- Module boundaries: Are the proposed module boundaries actually cleaner and easier to maintain?
- Behavior preservation: Could the refactor accidentally change outputs, exports, sorting, formatting, or query semantics? Check drill-down modals, Sheets export tabs, and CSV export paths.
- Pattern consistency: Does the plan match conventions already present in the codebase? (e.g., direct imports vs barrel files, `@/` alias usage, utility file organization in `src/lib/utils/`)
- Long-term maintainability: Is this reducing complexity or merely moving it around?
- What should stay untouched even if it looks messy? (e.g., semantic layer files, `forecast-penalties.ts`)
- What has not been considered?

**Same required response format as OpenAI.**

### Cross-Checks

After receiving both responses, run these checks yourself:

1. Every proposed extraction has identified consumers and path updates
2. Every changed export/re-export is covered in the guide (check barrel files: `src/components/ui/index.ts`, `src/lib/semantic-layer/index.ts`)
3. No phase changes BigQuery views, SQL semantics, export shape, or business logic
4. No extraction moves Node-only code (BigQuery SDK, Prisma, query functions) into a module importable by `'use client'` components
5. Validation gates are concrete and sufficient — at minimum `npx tsc --noEmit`, `npm run build`, and `npm run lint` per phase
6. Any risky or ambiguous step is either guarded with a checkpoint or deferred
7. Drill-down record construction in `*DrillDownModal.tsx` components is not altered
8. `computeAdjustedDeal()` in `forecast-penalties.ts` is not moved, duplicated, or modified

### Write council-feedback.md

Write `council-feedback.md` with:
- **Critical Issues** — merged and deduplicated from both reviewers plus your cross-checks
- **Should Fix** — merged
- **Design Questions** — merged, numbered sequentially
- **Suggested Improvements** — merged, ranked by impact vs effort
- **Raw Responses** — full text from each reviewer, labeled

Proceed immediately to Phase 4.

---

## PHASE 4: SELF-TRIAGE AND REFINEMENT

**Lane 2a posture:** For Lane 2a targets (low-blast-radius UI/component refactors), council feedback should be triaged with the understanding that clean presentation-layer extractions are expected to succeed. The absence of critical issues from council review is a positive signal — do not invent additional reasons to downgrade the recommendation. Focus triage on genuinely new risks the council identified, not on re-litigating the basic extraction approach.

Read `council-feedback.md` and triage EVERY item into one of three buckets:

### Bucket 1 — APPLY AUTONOMOUSLY

Items where the correct fix is determinable from the codebase:
- Missing import/export path updates
- Missing consumers in the dependency map
- Missing validation gates
- Unsafe phase ordering
- A better extraction boundary clearly supported by existing patterns
- Missing compat/re-export shim where needed
- Scope drift that can be tightened back to zero-behavior-change refactor

**Apply all Bucket 1 fixes directly to `agentic_refactor_guide.md`.**

### Bucket 2 — NEEDS HUMAN INPUT

Items where the answer depends on product, team, or architecture preference:
- Whether to preserve an awkward public import path for backwards compatibility
- Whether to introduce a new shared utility vs leave duplication in place
- Whether to split one large refactor into multiple PRs
- Whether a barrel file should remain or be retired
- Naming choices when multiple valid options exist

### Bucket 3 — NOTE BUT DON'T APPLY

Valid observations that are out of scope for this refactor:
- Adjacent cleanup not required for safety
- Broader architectural modernization
- Feature work disguised as refactor work
- Data-layer redesign opportunities

### Human Input Gate

If Bucket 2 is empty:
- write `refactor-decisions-needed.md` with `No human decisions required.`
- proceed immediately

If Bucket 2 is non-empty:
- write `refactor-decisions-needed.md` listing only the unresolved decisions
- stop and present those decisions to the user in a concise numbered list
- do not proceed until the user answers

If Bucket 2 is empty, continue to Phase 5.

---

## PHASE 5: READY-TO-EXECUTE PACKAGE

Write `refactor-ready-summary.md` containing:

1. Refactor target
2. Triage lane (including 2a if applicable)
3. Exact scope
4. Explicit non-goals
5. Files to modify (with exact paths)
6. Ordered execution phases
7. Validation gates (concrete commands)
8. Key risks being guarded against
9. Whether human input is still needed
10. Final recommendation: proceed / split into smaller refactors / do not execute

**Final recommendation logic:**

For **Lane 2a** targets: if council review found no critical issues, all validation gates are defined, and the dependency map confirms tiny blast radius — the recommendation should be **proceed**. Do not downgrade to "conditional" or "split" unless there is a concrete reason. These refactors improve agentic development and should advance.

For **Lane 2** targets (non-2a): recommend proceed only if confidence is high across all phases. Otherwise recommend splitting or flag specific concerns.

For **Lane 3** targets: default to conditional or split. Recommend proceed only if the exploration and council review converge on safety.

**Bug discovery during refactor exploration:** If exploration reveals a bug in the target code, note it in `refactor-exploration-results.md` but do NOT incorporate a fix into the refactor guide. Refactors are zero-intentional-behavior-change. Bug fixes require explicit user scope expansion or a separate session. The correct output is: "Bug found: [description]. This is out of scope for this refactor — address separately."

Then print a concise console summary:

```
Refactor: [target]
Lane: [1-3]
Safe to attempt: [yes/no/conditional]
Top risks:
  1. ...
  2. ...
  3. ...
Human input required: [yes/no]
Files written: refactor-triage.md, refactor-exploration-results.md, agentic_refactor_guide.md, council-feedback.md, refactor-decisions-needed.md, refactor-ready-summary.md

Recommended next steps:
1. Run /compact to clear context
2. Then: "Execute agentic_refactor_guide.md phase by phase. Stop at each validation gate and report results before proceeding. Start with Pre-Flight."
```

**STOP. Do not proceed further.**

---

## OUTPUT FILES

**Single-Target Mode (standard track)** — at minimum, this command must produce:
- `refactor-triage.md`
- `code-inspector-findings.md`
- `pattern-finder-findings.md`
- `dependency-mapper-findings.md`
- `refactor-exploration-results.md`
- `agentic_refactor_guide.md`
- `council-feedback.md`
- `refactor-decisions-needed.md`
- `refactor-ready-summary.md`

**Single-Target Mode (lightweight Lane 2a track)** — at minimum, this command must produce:
- `refactor-triage.md`
- `dependency-mapper-findings.md`
- `refactor-exploration-results.md`
- `agentic_refactor_guide.md`
- `refactor-decisions-needed.md`
- `refactor-ready-summary.md`
- `council-feedback.md` only if council was used
- `code-inspector-findings.md` only if code-inspector was spawned
- `pattern-finder-findings.md` only if pattern-finder was spawned

**Audit Remediation Mode** — produces the final report to console (not a separate file). If extractions were applied, the changed files are the output. No agent findings files, no council review, no refactor guide.

---

## WEEKLY AUDIT CATEGORIES

The weekly refactor audit (`.github/workflows/refactor-audit.yml`) tracks four categories. Current baselines are defined in the workflow file — check it for up-to-date values before comparing.

| Audit category | Lane | Audit remediation behavior |
|---|---|---|
| npm vulnerabilities | Lane 1 | `npm audit fix` only; report unresolved; do NOT `--force` without approval |
| TODO/HACK/FIXME comments | Lane 1-2 | Implement if small and mechanical; otherwise report only |
| Large files (>500 lines) | Lane 2-3 | **Assess first.** Report extraction opportunities. Only extract when boundary is clean and confidence is high. Default to report-only for high-risk areas (queries, semantic layer, exports, drill-down modals). |
| Dead exports (knip) | Lane 2 | Verify with knip before removing; check dynamic imports and barrel re-exports |

**Large-file escalation:** If assessment reveals a file that would benefit from deep refactoring (not a quick extraction), note it in the audit report as a "recommended follow-up" for a dedicated single-target `/auto-refactor` pass. Do not attempt complex refactors during audit remediation.

---

## FAILURE MODES

Stop and report immediately if:
- the requested refactor requires BigQuery view/schema changes — blocked by default
- the requested refactor requires changing metric/business logic — blocked by default
- the requested refactor requires changing semantic layer definitions or query templates — blocked by default
- a dependency surface cannot be mapped confidently
- the guide cannot preserve existing import paths without risky broad changes
- the target is too large and should be split before planning
- the refactor would touch `forecast-penalties.ts`, drill-down record construction, or Sheets export formatting — blocked by default; requires explicit user approval to proceed

---

## MCP TOOL FAILURE MODES

- **Council MCP unavailable:** If council-mcp tools are not visible or calls fail with missing API keys, skip council review gracefully (see Phase 3 fallback). Do not block the pipeline.
- **Council MCP timeout:** Retry once per provider. If both retries fail for a provider, proceed with whichever responded. If both fail entirely, skip council and note it in the output.
- **Agent teammate failure:** If one of the three exploration agents fails, report which one and what it couldn't do. Do not proceed — the exploration is incomplete.

---

## COUNCIL MCP TROUBLESHOOTING

Council review (Phase 3) requires the `council-mcp` MCP server to be both **registered** and **able to authenticate** with OpenAI and Google Gemini.

### How council-mcp loads API keys

council-mcp loads environment variables from two sources, in order:
1. **Shell environment variables** inherited by the MCP process
2. **`.env` file** in `process.cwd()` — for Claude Code, this is the project root directory

Required variables:
- `OPENAI_API_KEY` — for `ask_openai`
- `GEMINI_API_KEY` or `GOOGLE_API_KEY` — for `ask_gemini` (either works)

### "Keys exist on my machine" ≠ "Keys are visible to the MCP process"

Common pitfalls on Windows:
- Keys set in a **PowerShell session** (`$env:OPENAI_API_KEY = "..."`) are session-scoped and not inherited by Claude Code unless Claude Code was launched from that same session
- Keys set via **Windows System Properties > Environment Variables** (User or System) require a new terminal/process to take effect — existing terminals won't see them
- Claude Code launched from VS Code, desktop app, or a different terminal will NOT inherit session-scoped variables

### Registration

council-mcp must be registered with Claude Code. Check with:
```bash
# View current MCP servers
claude mcp list
```

To register (from cloned repo):
```bash
claude mcp add --scope user council-mcp -- node C:/Users/russe/Documents/Council_of_models_mcp/dist/index.js
```

Or if installed globally via npm:
```bash
npm install -g council-mcp
claude mcp add --scope user council-mcp -- council-mcp
```

### Recommended setup: keys in project `.env`

The most reliable approach (avoids all shell/process inheritance issues):

Add to your project `.env` file (already in `.gitignore`):
```
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AI...
```

council-mcp uses `import "dotenv/config"` at startup, which reads `.env` from the current working directory (the project root when launched by Claude Code).

### Verify council availability

Before relying on council in a workflow, test it:
1. Start a new Claude Code session in the project directory
2. Check that `mcp__council-mcp__ask_openai` and `mcp__council-mcp__ask_gemini` tools are visible
3. If tools are visible but calls fail, the issue is missing API keys — check `.env` in the project root
