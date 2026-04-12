# /auto-feature — Automated Feature Planning Pipeline

You are an orchestrator. Your job is to take a feature request, run a full exploration and planning pipeline, get adversarial review, and produce a refined implementation guide ready for execution. You do NOT execute the guide — that happens in a fresh context after this command completes.

**Feature request:** $ARGUMENTS

---

## RULES

1. Execute phases in strict order. Do not skip phases.
2. Write all artifacts to disk in the project root. Later phases read them from disk.
3. Print a progress header at the start of each phase.
4. Do not ask the user anything until the Human Input Gate in Phase 4.
5. If a phase fails (MCP timeout, BigQuery connection error), report clearly and stop.

---

## PHASE 1: EXPLORATION

Spawn an agent team with 3 teammates to investigate in parallel:

### Teammate 1: Code Inspector (agent: code-inspector)

Task: "First, read `.claude/bq-views.md` for the view→consumer mapping. Also read `.claude/docs/LLD.md` for the current module index and construction site inventory, and `.claude/docs/CONSTRAINTS.md` for blocked areas and data contracts — use these as a starting point. If what you find in the code contradicts these docs, trust the code, proceed with what the code shows, and note the discrepancy in your findings. Then investigate the codebase for the following feature: $ARGUMENTS

Find:
- Every TypeScript type/interface that needs new fields
- Every file that CONSTRUCTS objects of those types (construction sites)
- Every query function, API route, and component that needs changes
- Both export paths: ExportButton (auto via Object.keys) and ExportMenu/MetricDrillDownModal (explicit column mappings)
- Any components that manually construct typed records from raw data (e.g., ExploreResults.tsx drilldown handler)

Save findings to `code-inspector-findings.md` in the project root."

### Teammate 2: Data Verifier (agent: data-verifier)

Task: "First, use `schema-context` MCP tools (`describe_view`, `get_rule`, `get_metric`, `resolve_term`) as the primary schema context source. Fall back to `.claude/bq-*.md` files if MCP is unavailable or incomplete. Then verify the data layer for the following feature: $ARGUMENTS

Using MCP access to BigQuery:
- Confirm source fields exist in the relevant views. Start with the schema docs, then query BQ only for things not already documented (new fields, population rates for specific date ranges).
- Run population rate checks: `SELECT COUNTIF(field IS NOT NULL) / COUNT(*) as rate`
- Run value distribution checks for each field
- Check for edge cases: NULLs, empty strings, newlines, special characters, max lengths
- If a BigQuery view modification is needed, document exactly what needs to change and flag it as a blocker

Save findings to `data-verifier-findings.md` in the project root."

### Teammate 3: Pattern Finder (agent: pattern-finder)

Task: "First, read `.claude/bq-patterns.md` for established query patterns. Then find implementation patterns for the following feature: $ARGUMENTS

Trace how existing similar fields flow end-to-end:
- BigQuery view → query function SELECT → transform → return type → API route → component → export/CSV
- Document date handling patterns: `extractDate()` vs `extractDateValue()` — which files use which
- Document NULL handling and type coercion patterns: `toString()`, `toNumber()` from bigquery-raw.ts
- Document CSV export column mapping patterns for both export paths
- Flag any inconsistencies between files that should follow the same pattern

Save findings to `pattern-finder-findings.md` in the project root."

### Synthesis

Once all three teammates complete, read all three findings files and produce `exploration-results.md` containing:

1. **Pre-Flight Summary** — 5-10 line plain-English summary of what was found. Print this to console so the user sees it scroll by.
2. **BigQuery Status** — Fields exist ✅/❌, view changes needed, data quality issues
3. **Files to Modify** — Complete list with file paths and what changes
4. **Type Changes** — Exact fields to add to each TypeScript interface
5. **Construction Site Inventory** — Every code location that constructs objects of modified types
6. **Recommended Phase Order** — Based on dependencies
7. **Risks and Blockers** — View changes, CSV escaping, missing data, inconsistencies

Proceed immediately to Phase 2.

---

## PHASE 2: BUILD GUIDE

Follow the build-guide skill (`.claude/skills/build-guide/SKILL.md`).

Read all four exploration documents and produce `agentic_implementation_guide.md` with:

- Pre-flight checklist (`npm run build` baseline)
- Phase 1: Blocking prerequisites (CSV escaping, infrastructure)
- Phase 2: Utility functions (helpers, formatters)
- Phase 3: Type definitions (intentionally breaks build — errors become the construction site checklist)
- Phase 4-6: Query layer, pipeline integration, drill-down support
- Phase 7: Component updates and ALL construction sites
- Phase 7.5: Documentation sync (`npx agent-guard sync`)
- Phase 8: UI/UX browser validation (requires human)

Every phase must have:
- A validation gate with concrete bash/grep commands
- A STOP AND REPORT checkpoint
- Exact file paths and exact field names with correct casing from data-verifier findings

**Savvy-specific rules:**
- BigQuery fields use exact casing from data-verifier (Salesforce fields are case-sensitive)
- NULL handling uses COALESCE with sensible defaults — keep records, don't lose them
- All SQL uses `@paramName` parameterized queries — never string interpolation
- Duration penalty math references `computeAdjustedDeal()` from `forecast-penalties.ts` — never duplicated
- Sheets/CSV export handles the same edge cases as existing tabs
- Import merges, not additions — never add a second import from the same module

Write the guide to `agentic_implementation_guide.md`, then proceed immediately to Phase 3.

---

## PHASE 3: ADVERSARIAL COUNCIL REVIEW

Send the implementation guide and exploration results to OpenAI and Gemini for adversarial review using the council-mcp tools. Send **separate** prompts — do NOT use `ask_all`.

### Prepare the payload

Read and concatenate:
- `exploration-results.md`
- `agentic_implementation_guide.md`

### Send to Codex

Use `ask_codex`.

**System prompt:** "You are a senior TypeScript engineer reviewing an implementation plan for a Next.js dashboard backed by BigQuery. Your job is adversarial — find what will break."

**Prompt:** Include the full payload, then ask Codex to focus on:
- Type safety: Are ALL construction sites covered? Every file that builds an object of a modified type?
- BigQuery field names: Do they match the verified schema exactly (case-sensitive)?
- Parameterized queries: Any string interpolation in SQL?
- Phase ordering: Can each phase execute given what prior phases produce?
- NULL handling: Are nullable fields handled everywhere they appear?
- Missing steps: Anything implied but not spelled out?

**Required response format:**
```
## CRITICAL ISSUES (will break build or cause data loss)
## SHOULD FIX (pattern drift, inconsistencies, potential bugs)
## DESIGN QUESTIONS (decisions needing human input — number each one)
## SUGGESTED IMPROVEMENTS (ranked by impact)
```

### Send to Gemini

Use `ask_gemini` (thinking enabled by default).

**System prompt:** "You are a senior data engineer and product analyst reviewing an implementation plan for a financial advisor dashboard. Your job is to find business logic errors and data quality risks."

**Prompt:** Include the full payload, then ask Gemini to focus on:
- Business logic: Calculations correct? Deduplication flags? AUM aggregations?
- Data quality: What happens with NULLs, empty strings, special characters in names?
- Export integrity: Will CSV/Sheets export match the shape of existing tabs?
- Pattern consistency: Does this follow conventions from existing similar features?
- UI/display: Will formatting, sorting, filtering work with the new fields?
- What hasn't been considered?

**Same required response format as OpenAI.**

### Cross-Checks

After receiving both responses, run these five checks yourself:

1. Every BigQuery field name in the guide exists in `data-verifier-findings.md`
2. Every TypeScript interface change has ALL construction sites covered
3. All SQL uses `@paramName` — no string interpolation
4. Sheets export handles same edge cases as existing tabs
5. Duration penalty math uses `computeAdjustedDeal()` — never duplicated

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

Read `council-feedback.md` and triage EVERY item into one of three buckets:

### Bucket 1 — APPLY AUTONOMOUSLY

Items where the correct fix is determinable from the codebase:
- Wrong field names → fix to match data-verifier schema
- Missing construction sites → add to guide
- Missing NULL handling → add COALESCE
- String interpolation in SQL → replace with parameterized queries
- Pattern drift → fix to match pattern-finder findings
- Phase ordering errors → reorder
- Missing validation gates → add concrete commands
- Incorrect imports or file paths → fix to match codebase

**Apply all Bucket 1 fixes directly to `agentic_implementation_guide.md`.**

### Bucket 2 — NEEDS HUMAN INPUT

Items where the answer depends on business intent or preference:
- Display formatting choices (date format, number precision, column ordering)
- Calculation methodology (trailing vs calendar year, weighted vs unweighted)
- Sort order preferences
- Field inclusion/exclusion when multiple options exist
- Business rule interpretations ("active" means what? "recent" cutoff?)
- Scope decisions (should this also appear in another view?)

### Bucket 3 — NOTE BUT DON'T APPLY

Valid observations that are out of scope or where the current approach works:
- Scope expansions
- Alternative architectures where current is fine
- Performance optimizations not needed at current scale
- Nice-to-haves that would delay the feature

### Apply and Log

1. Apply all Bucket 1 fixes to `agentic_implementation_guide.md`
2. Update any validation gates affected by the fixes
3. Append a **Refinement Log** to the bottom of the guide:
   - Every Bucket 1 change (what changed, why, which reviewer flagged it)
   - Every Bucket 3 item (what it was, why deferred)
4. Self-review the updated guide for internal consistency
5. Write triage details to `triage-results.md`

### Human Input Gate

**IF Bucket 2 is empty:**

Print:
```
✅ Council review complete. All feedback resolved autonomously.

[N] fixes applied to the implementation guide (see Refinement Log).
[M] items noted but deferred.

The guide is ready for execution. Recommended next steps:
1. Run /compact to clear context
2. Then: "Execute agentic_implementation_guide.md phase by phase. Stop at each validation gate and report results before proceeding. Start with Pre-Flight."
```

**STOP. Do not proceed further.**

**IF Bucket 2 has items:**

Print:
```
🛑 Human Input Required

The council raised [N] questions that need your judgment.
[M] other issues were resolved autonomously (see Refinement Log).
[K] items noted but deferred.

Please answer each question:

Q1: [question]
    Context: [why it matters, what the tradeoffs are]

Q2: [question]
    ...

After you answer, I'll apply your decisions to the guide.
```

**STOP. WAIT FOR THE USER TO RESPOND.**

When the user responds, apply their answers to `agentic_implementation_guide.md`, add each decision to the Refinement Log with rationale, then print:

```
✅ Guide updated with your decisions.

The guide is ready for execution. Recommended next steps:
1. Run /compact to clear context
2. Then: "Execute agentic_implementation_guide.md phase by phase. Stop at each validation gate and report results before proceeding. Start with Pre-Flight."
```

**STOP. Do not proceed further.**

---

## FILES PRODUCED

| File | Phase | Purpose |
|------|-------|---------|
| `code-inspector-findings.md` | 1 | Types, construction sites, file dependencies |
| `data-verifier-findings.md` | 1 | BigQuery schema, field existence, data quality |
| `pattern-finder-findings.md` | 1 | Established patterns for transforms, exports, dates |
| `exploration-results.md` | 1 | Synthesized summary with pre-flight check |
| `agentic_implementation_guide.md` | 2 (created), 4 (refined) | Phased execution plan with validation gates |
| `council-feedback.md` | 3 | GPT + Gemini adversarial review |
| `triage-results.md` | 4 | Categorized triage of council feedback |

---

## FAILURE MODES

- **MCP tool timeout (council):** Retry once. If both retries fail for a provider, proceed with whichever responded. If both fail, STOP and tell the user.
- **BigQuery connection failure (data verifier):** Fall back to schema docs, type definitions, and existing query files. Note in exploration-results.md that verification was inferred, not confirmed.
- **Agent teammate failure:** If one of the three exploration agents fails, report which one and what it couldn't do. Do not proceed — the exploration is incomplete.

---

## BEGIN

Start Phase 1 now. The feature to build is: **$ARGUMENTS**
