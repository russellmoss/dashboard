# New Feature Cheat Sheet

When you want to add a new field, metric, column, or capability to the dashboard, use `/auto-feature`. It handles the entire planning pipeline — from data verification through adversarial review — and produces a ready-to-execute implementation guide.

---

### When to use `/auto-feature`

- Adding new fields or columns to existing dashboard tabs
- Adding new metrics or calculations derived from BigQuery data
- Surfacing existing Salesforce fields that aren't yet shown in the dashboard
- Adding new drill-down detail, export columns, or filter dimensions
- Any feature that touches the BigQuery-to-UI pipeline (query, transform, type, component, export)

### When NOT to use it

- Refactoring or decomposing existing code (use `/auto-refactor`)
- Fixing a bug (do that in a focused session, not a planning pipeline)
- Changing business rules or metric definitions (those need human-led design first)
- Building something that doesn't involve the BigQuery data pipeline (e.g., a new settings page, UI-only changes)

---

### Quick-start checklist

1. **Describe the feature clearly.** Know what fields you want, where they should appear, and roughly what BigQuery data backs them.
2. **Run `/auto-feature`:**
   ```
   /auto-feature Add [field/metric] to [which dashboard tab/view], sourced from [BigQuery field if known]
   ```
3. **Wait for all 4 phases.** The pipeline runs exploration, builds the guide, gets council review, and self-triages — all without asking you anything (unless it has design questions).
4. **Answer any design questions.** If the pipeline stops with "Human Input Required," answer the numbered questions so it can finalize the guide.
5. **Review the guide.** Read `agentic_implementation_guide.md` — check that phases make sense, file paths look right, and the scope matches what you asked for.
6. **Execute in a fresh context:**
   ```
   /compact
   ```
   Then:
   ```
   Execute agentic_implementation_guide.md phase by phase. Stop at each validation gate and report results before proceeding. Start with Pre-Flight.
   ```
7. **Browser-test at the end.** Phase 8 of every guide requires you to verify the feature in the browser — check drilldowns, exports, filters, and formatting.

---

### What the pipeline produces

| File | What it is |
|------|-----------|
| `code-inspector-findings.md` | Every type, construction site, and file dependency affected |
| `data-verifier-findings.md` | BigQuery schema confirmation, population rates, data quality |
| `pattern-finder-findings.md` | How existing similar features are built end-to-end |
| `exploration-results.md` | Synthesized summary of all three explorations |
| `agentic_implementation_guide.md` | The phased execution plan (the main output) |
| `council-feedback.md` | Adversarial review from OpenAI and Gemini |
| `triage-results.md` | How council feedback was categorized and resolved |

---

### If in doubt

**Start with `/auto-feature` and let it tell you if something is wrong.** If BigQuery fields don't exist, the data verifier will flag it as a blocker. If the feature touches too many areas, the council will flag the risk. The pipeline is designed to stop and report problems rather than push through them.

---
---

# `/auto-feature` Operating Guide

> **Audience**: Anyone building new features on this dashboard.
> **Last updated**: 2026-03-27

---

## 1. What `/auto-feature` Is

This dashboard follows a data pipeline pattern: Salesforce data flows into BigQuery, gets queried by the Next.js API layer, transforms into typed TypeScript records, and renders in React components with export/CSV support. Adding a new field or metric means touching many files across that pipeline — types, queries, transforms, components, export mappings, and sometimes BigQuery views.

`/auto-feature` is a Claude Code command that automates the planning for all of that. You describe the feature you want, and it:

1. **Explores the codebase and data layer** using three specialized agents in parallel
2. **Verifies against live BigQuery** that the source fields exist and checks data quality
3. **Builds a phased implementation guide** with exact file paths, code changes, and validation gates
4. **Sends the plan to other AI models** (OpenAI, Gemini) for adversarial review
5. **Self-triages the feedback** — fixes what it can, asks you about genuine design questions
6. **Produces a ready-to-execute guide** that another Claude Code session can follow step by step

It does NOT execute the guide itself. Planning and execution happen in separate contexts to keep the work clean and reversible.

### Why we built it

- **The pipeline has many touchpoints.** A single new field can require changes in 8-15 files. Missing one construction site causes a build failure. Missing an export mapping means the field silently doesn't appear in CSV downloads.
- **Data verification matters.** Salesforce field names are case-sensitive. Fields can be null, empty, or contain newlines. The data verifier agent checks all of this against live BigQuery before any code is written.
- **Cross-LLM review catches things.** Sending the plan to OpenAI and Gemini for adversarial review regularly catches missing construction sites, incorrect field casing, and NULL handling gaps that a single model misses.
- **Phased execution with validation gates.** The guide intentionally breaks the build in Phase 3 (type definitions) so that TypeScript errors become the checklist for remaining work. Each phase has a concrete validation step.

---

## 2. What `/auto-feature` Is NOT For

| Not for | Use instead |
|---------|-------------|
| **Refactoring or decomposing code** | `/auto-refactor` |
| **Bug fixes** | Direct fix in a focused session |
| **Changing business rules or metric definitions** | Human-led design session first, then possibly `/auto-feature` for implementation |
| **BigQuery view creation or schema design** | Manual BigQuery work first — `/auto-feature` consumes views, it doesn't create them |
| **UI-only changes** (styling, layout, no data pipeline) | Direct implementation — the pipeline overhead isn't needed |
| **Semantic layer changes** (Explore AI definitions, query templates) | `/audit-semantic-layer` or manual work |
| **Broad architecture changes** | Manual planning and execution |

---

## 3. How It Relates to `/new-feature` and `/build-guide`

These three commands form a progression:

| Command | What it does | When to use |
|---------|-------------|-------------|
| `/new-feature` | Runs exploration only (3 agents). Produces findings files and `exploration-results.md`. Stops and tells you to run `/build-guide`. | When you want to explore first and decide later whether to proceed |
| `/build-guide` | Takes existing exploration results and builds `agentic_implementation_guide.md`. No exploration, no council. | After `/new-feature` completes, or when you already have exploration artifacts |
| `/auto-feature` | Runs the entire pipeline end-to-end: exploration, guide building, council review, self-triage. | When you're ready to go from request to execution-ready guide in one pass |

**For most features, use `/auto-feature`.** It combines `/new-feature` + `/build-guide` + council review + self-triage into a single unattended pipeline. Use the individual commands only when you want more manual control over each step.

---

## 4. The Four Phases

### Phase 1: Exploration

Three specialized agents run in parallel:

**Code Inspector** reads the codebase and finds:
- Every TypeScript type/interface that needs new fields
- Every file that constructs objects of those types (construction sites)
- Every query function, API route, and component that needs changes
- Both export paths: ExportButton (auto via `Object.keys`) and ExportMenu (explicit column mappings)
- Any components that manually build typed records (like the ExploreResults drilldown handler)

**Data Verifier** queries live BigQuery and checks:
- Whether the source fields exist in the relevant views (starting with `vw_funnel_master`)
- Population rates (what percentage of records have non-null values)
- Value distributions and edge cases (NULLs, empty strings, special characters, max lengths)
- Whether a BigQuery view modification is needed (flagged as a blocker if so)

**Pattern Finder** traces how existing similar features are built:
- The end-to-end flow: BigQuery view -> query function -> transform -> return type -> API route -> component -> export
- Date handling patterns (`extractDate()` vs `extractDateValue()`)
- NULL handling and type coercion patterns (`toString()`, `toNumber()`)
- CSV export column mapping patterns for both export paths

After all three complete, the orchestrator synthesizes everything into `exploration-results.md` with a pre-flight summary, BigQuery status, file list, type changes, construction site inventory, recommended phase order, and risks/blockers.

### Phase 2: Build Guide

The orchestrator reads all exploration artifacts and produces `agentic_implementation_guide.md` — a phased execution plan:

| Phase | What it does |
|-------|-------------|
| Pre-Flight | Baseline `npm run build` — must pass before any changes |
| Phase 1 | Blocking prerequisites (CSV escaping, infrastructure) |
| Phase 2 | Utility functions (helpers, formatters) |
| Phase 3 | Type definitions — **intentionally breaks the build** so TypeScript errors become the remaining checklist |
| Phase 4-6 | Query layer, pipeline integration, drill-down support |
| Phase 7 | Component updates and ALL construction sites |
| Phase 7.5 | Documentation sync (`npx agent-guard sync`) |
| Phase 8 | UI/UX browser validation (requires human) |

Every phase includes:
- A validation gate with concrete commands (`npx tsc --noEmit`, `npm run build`, targeted Grep checks)
- A STOP AND REPORT checkpoint
- Exact file paths and field names with correct casing from the data verifier

### Phase 3: Adversarial Council Review

The implementation guide and exploration results are sent to two other AI models for adversarial review:

**OpenAI** (engineering focus): Checks type safety, BigQuery field names, parameterized queries, phase ordering, NULL handling, missing steps.

**Gemini** (data/business focus): Checks business logic, data quality handling, export integrity, pattern consistency, UI formatting, and what hasn't been considered.

The orchestrator then runs its own cross-checks:
1. Every BigQuery field name in the guide exists in the data verifier findings
2. Every TypeScript interface change has ALL construction sites covered
3. All SQL uses `@paramName` — no string interpolation
4. Sheets/CSV export handles the same edge cases as existing tabs
5. Penalty math uses `computeAdjustedDeal()` — never duplicated

All feedback is written to `council-feedback.md`.

### Phase 4: Self-Triage and Refinement

Every council finding is sorted into three buckets:

**Bucket 1 — Apply automatically:** Wrong field names, missing construction sites, missing NULL handling, string interpolation in SQL, pattern drift, phase ordering errors. These are fixed directly in the guide.

**Bucket 2 — Needs your input:** Display formatting choices, calculation methodology, sort order preferences, field inclusion/exclusion, business rule interpretations, scope decisions. The pipeline stops and asks you.

**Bucket 3 — Noted but deferred:** Scope expansions, alternative architectures, performance optimizations, nice-to-haves.

After triage, the guide is updated with all Bucket 1 fixes and a Refinement Log documenting every change.

---

## 5. Savvy-Specific Safety Rules

These rules are enforced throughout the pipeline:

| Rule | Why |
|------|-----|
| BigQuery fields use exact casing from data-verifier | Salesforce fields are case-sensitive. `AUM_Amount__c` is not `aum_amount__c`. |
| NULL handling uses COALESCE with sensible defaults | Keep records visible — don't lose them because one field is null. |
| All SQL uses `@paramName` parameterized queries | Never string interpolation. Prevents SQL injection and ensures proper type handling. |
| Penalty math references `computeAdjustedDeal()` | Single source of truth in `forecast-penalties.ts`. Never duplicated, never reimplemented. |
| Sheets/CSV export handles same edge cases as existing tabs | Newlines, special characters, encoding — match what existing features already handle. |
| Import merges, not additions | Never add a second import from the same module. Merge into the existing import statement. |
| Phase 3 intentionally breaks the build | TypeScript errors after type changes become the checklist for remaining work. This is by design. |

---

## 6. What Good Input Looks Like

The more specific your feature request, the better the output. Here are examples:

### Good — specific fields and location
```
/auto-feature Add AUM_at_Qualification__c to the pipeline drilldown and main dashboard detail records, sourced from vw_funnel_master
```

### Good — clear scope with context
```
/auto-feature Add SMS response time metrics to the SGA Activity tab. We want average first-response time per SGA, sourced from the sms_intent_classified view.
```

### Okay — lets the pipeline discover
```
/auto-feature Add stage entry dates (MQL, SQL, SQO) to the pipeline detail records
```
The data verifier will check which date fields exist and the code inspector will find where to add them.

### Too vague
```
/auto-feature Make the pipeline page better
```
The pipeline can't explore effectively without knowing what fields or metrics you want.

---

## 7. How to Execute the Guide

After `/auto-feature` completes and you've reviewed the guide:

1. **Clear context:**
   ```
   /compact
   ```

2. **Start execution:**
   ```
   Execute agentic_implementation_guide.md phase by phase. Stop at each validation gate and report results before proceeding. Start with Pre-Flight.
   ```

3. **At each validation gate:** The executing agent will run `npx tsc --noEmit`, `npm run build`, and any targeted checks, then report results and ask if you want to continue.

4. **Phase 3 will break the build.** This is expected. The error count becomes the remaining work checklist. It should decrease through Phases 4-7 until it reaches zero.

5. **Phase 7.5 (doc sync):** The agent runs `npx agent-guard sync` and `npm run gen:all` to update documentation.

6. **Phase 8 (browser testing):** You verify the feature in the browser. The guide provides specific test groups: what to click, what to check in exports, what values to verify.

---

## 8. What to Review Before Committing

After execution completes and Phase 8 passes:

- [ ] `npm run build` passes with zero errors
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run lint` passes
- [ ] Browser testing confirms the feature works (drilldowns, exports, filters, formatting)
- [ ] CSV/Sheets export includes the new fields with correct headers
- [ ] No unrelated files were changed
- [ ] `git diff` shows only expected changes
- [ ] Documentation was synced (`docs/_generated/` files updated if applicable)

---

## 9. When Things Go Wrong

### BigQuery field doesn't exist

The data verifier will flag this as a blocker in Phase 1. The pipeline stops and tells you what view change is needed. You'll need to modify the BigQuery view first (outside of `/auto-feature`) and then re-run.

### Council is unavailable

If the council-mcp server isn't running or API keys aren't configured, `/auto-feature` will stop at Phase 3. The exploration and guide are still usable — you just don't get the adversarial review. You can run `/council` manually later, or proceed without it if you're confident.

**To fix council:** Add `OPENAI_API_KEY` and `GEMINI_API_KEY` to your project `.env` file and restart Claude Code. See the council troubleshooting section in `docs/auto-refactor-workflow.md` for details.

### One of the exploration agents fails

If any of the three exploration agents (code-inspector, data-verifier, pattern-finder) fails, the pipeline stops. It reports which agent failed and what it couldn't do. Do not proceed with incomplete exploration — the guide would be missing critical information.

### Phase 3 errors don't decrease through later phases

This means construction sites are being missed. Check `code-inspector-findings.md` for the full list of files that construct objects of the modified types. Every one must be updated.

### Build fails after a phase

The executing agent stops at the validation gate. Review the error. If it's a missing import or wrong field name, fix it and re-run the typecheck. If it's structural, you may need to revisit the guide.

### Feature needs a BigQuery view change

`/auto-feature` does not modify BigQuery views. If the data verifier determines that a view change is needed, it flags this as a blocker. Handle the view change separately, then re-run `/auto-feature`.

---

## 10. Real Examples

### Adding stage entry dates to pipeline detail records

**Feature request:** "Add MQL, SQL, and SQO entry dates to the pipeline drilldown."

**What happened:**
- Data verifier confirmed the date fields exist in `vw_funnel_master` with 85%+ population rates
- Code inspector found 8 construction sites across query functions and components
- Pattern finder documented that existing date fields use `extractDate()` and format with `formatDate()`
- Guide was built with 8 phases, council found 2 missing construction sites (Bucket 1 — auto-fixed)
- Execution completed, build passed, dates appeared in drilldowns and exports

### Adding a field from a view that didn't have it

**Feature request:** "Add advisor AUM tier to the recruiter hub detail records."

**What happened:**
- Data verifier checked `vw_funnel_master` and found the field did not exist
- Pipeline stopped with a blocker: "BigQuery view modification needed — `AUM_Tier__c` is not in `vw_funnel_master`"
- The view was updated separately, then `/auto-feature` was re-run successfully

---

## 11. How `/auto-feature` Differs From `/auto-refactor`

| | `/auto-feature` | `/auto-refactor` |
|---|---|---|
| **Purpose** | Build something new | Restructure existing code |
| **Behavior change** | Expected — that's the point | Zero intentional behavior change |
| **Data verifier** | Always runs (checks BigQuery fields) | Never runs (no data layer changes) |
| **Typical output** | New fields in types, queries, components, exports | Extracted subcomponents, consolidated helpers, removed dead code |
| **Council focus** | "Will this break or produce wrong data?" | "Will this accidentally change behavior?" |
| **Guide structure** | 8 standard phases (prereqs through browser testing) | Variable phases based on extraction plan |
| **Phase 3 trick** | Intentionally breaks build with required type fields | No intentional build breakage |
| **Blocked areas** | Can touch most areas (that's how features get built) | Many areas blocked by default (semantic layer, exports, queries) |

---

## 12. Exact Prompts

### Standard feature request
```
/auto-feature Add [field/metric name] to [dashboard tab/view], sourced from [BigQuery field or view]
```

### Feature with multiple fields
```
/auto-feature Add the following fields to the pipeline detail records: AUM_at_Qualification__c, Days_in_SQO_Stage__c, and Qualification_Method__c. All sourced from vw_funnel_master.
```

### Feature that might need a view change
```
/auto-feature Add advisor custodian information to the recruiter hub. I believe the field is Custodian__c on the Opportunity object but I'm not sure if it's in vw_funnel_master yet.
```

### Executing the guide after planning
```
/compact
```
Then:
```
Execute agentic_implementation_guide.md phase by phase. Stop at each validation gate and report results before proceeding. Start with Pre-Flight.
```

---

## 13. Common Pitfalls

| Pitfall | What happens | What to do instead |
|---------|-------------|-------------------|
| Vague feature requests | Agents can't focus their exploration, findings are broad and shallow | Be specific: name the fields, the source, and where they should appear |
| Skipping council review | Missing construction sites or NULL handling gaps slip through | Let council run. If it's unavailable, at least manually review the construction site inventory. |
| Not clearing context before execution | Planning context fills the window, execution gets confused | Always `/compact` between planning and execution |
| Ignoring Phase 3 error count | Remaining errors mean construction sites were missed | Track the error count decreasing through each phase. If it stalls, check the code-inspector findings. |
| Assuming the guide is perfect | Council and self-triage catch most issues, but not all | Read the guide before executing. Check that file paths exist and the scope matches your intent. |
| Trying to add features to BigQuery views via `/auto-feature` | The pipeline doesn't modify views | Handle view changes separately, then re-run `/auto-feature` |
| Mixing feature work and refactoring | Different safety models, different validation | Use `/auto-feature` for features, `/auto-refactor` for refactoring. Don't combine them. |

---

## Glossary

| Term | Meaning |
|------|---------|
| **Construction site** | A place in the code that manually builds an object of a typed interface. If you add a required field to the type, every construction site must include it or the build breaks. |
| **Data verifier** | A specialized agent with live BigQuery access that checks whether fields exist, their population rates, value distributions, and data quality. |
| **Code inspector** | A specialized agent that reads the codebase to find types, construction sites, file dependencies, and export paths affected by a feature. |
| **Pattern finder** | A specialized agent that traces how existing similar features are built end-to-end, so the new feature follows the same conventions. |
| **Council** | Adversarial review by OpenAI and Gemini. They try to find what will break or produce wrong data. |
| **Validation gate** | A required check (`npx tsc --noEmit`, `npm run build`, targeted Grep) that must pass before the next phase proceeds. |
| **Phase 3 trick** | Adding new required (non-optional) fields to TypeScript interfaces intentionally breaks the build. The resulting errors are the checklist of construction sites that still need updating. |
| **Bucket 1 / 2 / 3** | How council feedback is triaged. Bucket 1 = auto-fixed. Bucket 2 = needs your input. Bucket 3 = noted but deferred. |
| **Blocker** | A finding that prevents the pipeline from continuing (e.g., a BigQuery field that doesn't exist). Must be resolved before re-running. |
| **Pre-flight** | The first step of guide execution: verify that `npm run build` passes before making any changes. If it doesn't, stop — don't start from a broken baseline. |
| **Export paths** | Two mechanisms for CSV/Sheets export. ExportButton auto-includes fields via `Object.keys`. ExportMenu uses explicit column mappings. Both must be updated for new fields. |
| **`vw_funnel_master`** | The primary BigQuery view that most dashboard features query. Pre-computes joins, deduplication, conversion flags, and SGA/SGM attribution. |
