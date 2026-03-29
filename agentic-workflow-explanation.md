# Agentic Feature Development Workflow

This document explains the multi-agent workflow we use to build new dashboard features. The workflow uses Claude Code slash commands that orchestrate specialized agents, cross-LLM adversarial review, and phased execution with validation gates.

## Why This Workflow Exists

The #1 cause of agentic build failures is **missing construction sites** — when a TypeScript interface gets a new required field, every file that constructs an object of that type must be updated. Miss one and the build breaks. The #2 cause is **wrong BigQuery field names** — using a field that doesn't exist or misspelling a Salesforce field causes silent data loss. This workflow catches both problems before a single line of code is written.

## The Five Phases

```
/new-feature  →  /build-guide  →  /council  →  /refine  →  Execute
 (explore)       (plan)           (review)     (fix)       (build)
```

---

## Phase 1: Exploration — `/new-feature`

**What it does:** Spawns three specialized agents in parallel to investigate the codebase, verify the data layer, and document established patterns before any code is written.

**How to use it:** Run `/new-feature` and describe what you're adding — new fields, metrics, tabs, or capabilities.

**The three agents:**

| Agent | Focus | Output |
|-------|-------|--------|
| **Code Inspector** | Finds every TypeScript type, query function, API route, component, and construction site that will need changes | `code-inspector-findings.md` |
| **Data Verifier** | Connects to BigQuery via MCP to confirm field existence, data types, population rates, NULL frequencies, and edge cases | `data-verifier-findings.md` |
| **Pattern Finder** | Traces how existing similar features flow end-to-end (BigQuery → API → component → CSV/Sheets export) and documents date handling, NULL coercion, and import patterns | `pattern-finder-findings.md` |

After all three agents complete, the lead agent synthesizes their findings into **`exploration-results.md`** covering: what BigQuery fields exist and their data quality, which files need changes, what types are affected, every construction site, the recommended phase order, and known risks.

**When it's done:** You have a complete map of what needs to change and what the data actually looks like. Run `/build-guide` next.

---

## Phase 2: Planning — `/build-guide`

**What it does:** Reads all four exploration documents and produces a phased, validation-gated implementation guide that a single agent can execute step-by-step.

**How to use it:** Run `/build-guide` after `/new-feature` completes and you've reviewed the exploration results.

**The guide structure:**

| Phase | Purpose |
|-------|---------|
| **Phase 1** | Blocking prerequisites — CSV escaping utilities, infrastructure setup |
| **Phase 2** | Utility functions — helpers, formatters, shared logic |
| **Phase 3** | Type definitions — intentionally breaks the build; the compiler errors become the construction site checklist |
| **Phase 4-6** | Query layer, pipeline integration, drill-down support |
| **Phase 7** | Component updates and all construction sites — every file that builds a typed object |
| **Phase 7.5** | Documentation sync (`npx agent-guard sync`) |
| **Phase 8** | UI/UX browser validation (requires human) |

Every phase includes:
- A **validation gate** with concrete bash/grep commands to verify the phase succeeded
- A **STOP AND REPORT** checkpoint where the executing agent pauses for human review
- A **troubleshooting appendix** drawn from data-verifier edge cases

**When it's done:** You have `agentic_implementation_guide.md` — a complete, executable plan. Run `/council` next.

---

## Phase 3: Adversarial Review — `/council`

**What it does:** Sends the implementation guide and all exploration documents to GPT-4 and Gemini simultaneously for adversarial review. Each model gets a different review focus tailored to its strengths. Their feedback is synthesized into a structured report.

**How to use it:** Run `/council` after `/build-guide` produces the implementation guide.

**The two review tracks:**

| Reviewer | Focus Areas |
|----------|-------------|
| **OpenAI** (reasoning_effort: high) | Type safety and missing construction sites, BigQuery field name correctness (exact casing), parameterized query safety (`@paramName` only), phase ordering and dependencies, NULL handling for nullable fields |
| **Gemini** | Business logic correctness (deduplication flags, AUM calculations), data quality edge cases (NULLs, special characters, encoding), Sheets/CSV export integrity vs existing tabs, pattern consistency vs established patterns, UI/display logic |

**Five mandatory checks baked into every review:**
1. Every BigQuery field name referenced actually exists in the verified schema
2. Every TypeScript interface change has ALL construction sites covered
3. All SQL uses `@paramName` parameterized queries, never string interpolation
4. Sheets export handles the same edge cases as existing tabs
5. Duration penalty math uses `computeAdjustedDeal()` from `forecast-penalties.ts` — never duplicated

**Output:** `council-feedback.md` containing:
- **Critical Issues** — things that will break the build or cause data loss
- **Design Questions** — decisions that need human input (numbered for easy reference)
- **Suggested Improvements** — ranked by impact vs effort
- **Raw Responses** — full text from each reviewer

**When it's done:** Review the critical issues and answer the design questions in the chat. Then run `/refine`.

---

## Phase 4: Refinement — `/refine`

**What it does:** Reads the council feedback and your answers to design questions, then edits the implementation guide directly — fixing issues, applying decisions, and logging everything.

**How to use it:** Answer the design questions from `/council` in the chat, then run `/refine`.

**Triage rules:**

| Bucket | What Goes Here | Action |
|--------|---------------|--------|
| **Apply Immediately** | Missing construction sites, wrong field names, missing NULL handling, string interpolation in SQL, pattern drift | Fixed in the guide automatically |
| **Apply Based on Answers** | Display formatting, sort orders, business logic choices, calculation formulas | Applied using your answers from the conversation |
| **Note but Don't Apply** | Scope expansions, alternative approaches, declined suggestions | Logged in the Refinement Log, not applied |

**Savvy-specific rules enforced during refinement:**
- BigQuery fields use exact casing from the data-verifier schema (Salesforce fields are case-sensitive)
- NULL handling prefers COALESCE with sensible defaults over filtering — we keep records, not lose them
- Pattern fixes match the exact function names and import paths from pattern-finder findings
- Duration penalty math always references `computeAdjustedDeal()` — never inlined

**Output:** The implementation guide is updated in place with a **Refinement Log** appended at the bottom documenting every change, every design decision with rationale, and every item noted but deferred.

**When it's done:** You can run `/council` again for another review round, or proceed to execution.

---

## Phase 5: Execution

**What it does:** A single Claude Code agent executes the refined implementation guide phase-by-phase, stopping at each validation gate for verification.

**How to use it:** Tell Claude Code to execute the guide: "Execute `agentic_implementation_guide.md` phase by phase. Stop at each validation gate and report results before proceeding."

**What to expect:**
- The agent works through each phase sequentially
- At each STOP AND REPORT checkpoint, it pauses and shows you what was done and whether validation passed
- Phase 3 (type definitions) intentionally breaks the build — the TypeScript compiler errors become the checklist for Phase 7
- Phase 7.5 runs `npx agent-guard sync` to update documentation
- Phase 8 requires you to check the UI in the browser

---

## Full Workflow Example

```
You: /new-feature
     "Add Earliest_Anticipated_Start_Date__c to the SQO drill-down table
      and Sheets export"

     → code-inspector-findings.md
     → data-verifier-findings.md
     → pattern-finder-findings.md
     → exploration-results.md

You: /build-guide
     → agentic_implementation_guide.md

You: /council
     → council-feedback.md
     → "3 critical issues found, 2 design questions need answers"

You: "For Q1, use extractDate not extractDateValue. For Q2, sort
      descending by date."

You: /refine
     → agentic_implementation_guide.md (updated with fixes + refinement log)

You: "Execute the guide phase by phase."
     → Feature built, tested, documented
```

---

## When to Skip Steps

- **Small changes** (renaming a label, fixing a typo): Skip the whole workflow, just make the change.
- **Medium changes** (adding a column to an existing table): You can skip `/council` and `/refine` if the exploration results look clean and the guide is straightforward.
- **Large changes** (new tab, new data source, new calculation): Run the full workflow. The council step has caught critical issues on every large feature we've built.

## Files Produced

| File | Created By | Purpose |
|------|-----------|---------|
| `code-inspector-findings.md` | `/new-feature` | TypeScript types, construction sites, file dependencies |
| `data-verifier-findings.md` | `/new-feature` | BigQuery schema, field existence, NULL rates, data quality |
| `pattern-finder-findings.md` | `/new-feature` | Established patterns for date handling, exports, coercion |
| `exploration-results.md` | `/new-feature` | Synthesized exploration summary |
| `agentic_implementation_guide.md` | `/build-guide` | Phased execution plan with validation gates |
| `council-feedback.md` | `/council` | GPT + Gemini adversarial review feedback |
