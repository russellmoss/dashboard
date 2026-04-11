---
name: audit-feature
description: "Critically analyze an existing dashboard feature and produce a prioritized enhancement report. Spawns agents for code inspection, pattern analysis, and data verification, then sends findings to the council (Gemini + Codex) for independent improvement ideas across performance, UI/UX, and data accuracy."
---

# Feature Audit — Critical Enhancement Analysis

You are auditing an existing feature in the Savvy Wealth dashboard. The user will name a feature and optionally provide context about what they're trying to accomplish with it. Your job is to deeply understand the feature as-built, then produce a critical enhancement report with actionable improvement recommendations.

## Inputs

`$ARGUMENTS` — the feature name or path, plus optional context. Examples:
- `SGA Hub leaderboard`
- `Explore AI chat feature — we want it to handle more complex queries`
- `src/app/(dashboard)/pipeline/ — the open pipeline table feels slow`
- `deal calculator — want to make sure the AUM calculations are accurate`

If the user provides no arguments, ask: "Which feature should I audit? Give me a name, page path, or description of what it does."

---

## Phase 1: Scope the Feature

### 1.1 Identify the feature boundary

From the user's description, identify:
- **Pages**: Which route(s) render this feature? (`src/app/(dashboard)/...`)
- **API routes**: Which API endpoints serve data to it?
- **Query functions**: Which `src/lib/queries/*.ts` files fetch the data?
- **Components**: Which React components render the UI?
- **Types**: Which TypeScript types define the data shape?
- **BigQuery views**: Which views are queried?

If unclear, do a quick search (Grep/Glob) to locate the feature before spawning agents.

### 1.2 Confirm scope with user

Tell the user what you found:
> "I've identified the **[feature name]** feature spanning [N] files: [key files]. I'll audit this for performance, UI/UX, and data accuracy. Launching investigation now..."

---

## Phase 2: Parallel Agent Investigation

Spawn a team with these agents running in parallel:

### Agent 1: Code & Performance Inspector (code-inspector)

Prompt:
```
Audit the following feature for code quality and performance concerns.

Feature: [name]
Key files: [list from Phase 1]

Investigate:

**Architecture**
- How does data flow from BigQuery → API → client? Trace the full path.
- Are there unnecessary data transformations or re-renders?
- Is the component tree efficient? Are there deeply nested prop chains?
- What is the bundle size impact of this feature's dependencies?

**Performance**
- Are BigQuery queries using appropriate filters and dedup flags?
- Is there server-side or client-side caching? Should there be?
- Are large datasets paginated or loaded all at once?
- Are there N+1 query patterns or redundant API calls?
- Are React components memoized where they should be?
- Is there any client-side filtering/sorting that should happen server-side?

**Code Quality**
- Are TypeScript types tight or overly permissive (lots of `any`, optional fields that shouldn't be)?
- Is error handling comprehensive? What happens when the API fails?
- Are there TODO/FIXME/HACK comments indicating known tech debt?
- Is the code DRY or are there copy-paste patterns?

Save findings to `audit-feature-code-findings.md` in the project root.
```

### Agent 2: UI/UX Analyst (pattern-finder)

Prompt:
```
Audit the following feature for UI/UX quality and improvement opportunities.

Feature: [name]
Key files: [list component files from Phase 1]

Investigate:

**User Flow**
- What is the primary user journey through this feature?
- How many clicks/interactions to reach the key insight?
- Are there dead ends or confusing navigation patterns?

**Visual Design & Layout**
- Does the layout follow the patterns used by other dashboard pages?
- Are Tremor/Tailwind components used consistently?
- Is the information hierarchy clear? (most important data most prominent)
- Are there visual elements that are cluttered or underutilized?

**Interactivity**
- Are filters, sorting, and drill-downs intuitive?
- Are loading states handled gracefully (skeletons, spinners)?
- Do empty states have helpful messaging?
- Are tooltips/help text provided for non-obvious metrics?

**Responsiveness & Accessibility**
- Does the feature work on different screen sizes?
- Are tables scrollable on smaller screens?
- Are color-only indicators also conveyed via text/icons?

**Comparison to Best Practices**
- How do similar features in competing analytics dashboards present this data?
- What modern dashboard UX patterns could improve this?

Save findings to `audit-feature-ux-findings.md` in the project root.
```

### Agent 3: Data Accuracy Auditor (data-verifier)

This agent has MCP access to BigQuery. Prompt:
```
Audit the following feature for data accuracy and correctness.

Feature: [name]
Key query files: [list from Phase 1]
BigQuery views used: [list from Phase 1]

Investigate:

**Schema Validation**
- Use schema-context MCP tools (describe_view, get_rule, get_metric, resolve_term) for every view and field used.
- Are all fields referenced in queries actually present in the views?
- Are the correct dedup flags used? (is_sqo_unique for SQO counts, is_primary_opp_record for AUM, etc.)

**Business Logic Correctness**
- Do the queries match the business definitions in the glossary?
- Are filters correct? (active SGA filter via User table join, recordtypeid for recruiting, etc.)
- Are conversion rates using the right numerator/denominator fields?
- Are date anchors correct for cohort vs period mode?

**Data Quality**
- What are the population rates for key fields used by this feature?
- Are there NULL-handling gaps that could produce incorrect counts or averages?
- Run the actual queries and spot-check: do the numbers match what you'd expect?
- Are there edge cases that produce misleading results? (e.g., SGAs with 1 day active, division by zero)

**Consistency**
- Do the numbers this feature shows match what other features show for the same metric?
- Are there places where the same metric is calculated differently in different parts of the codebase?

Save findings to `audit-feature-data-findings.md` in the project root.
```

---

## Phase 3: Synthesize Findings

Once all agents complete, read all three findings files. Create a structured synthesis.

### 3.1 Build the enhancement list

For each finding, classify it:

| Category | Subcategory | Examples |
|----------|-------------|---------|
| Performance | Query | Slow BQ query, missing index, full table scan |
| Performance | Rendering | Unnecessary re-renders, large bundle, no pagination |
| Performance | Caching | No caching, stale cache, redundant fetches |
| UI/UX | Layout | Cluttered, poor hierarchy, wasted space |
| UI/UX | Interaction | Too many clicks, confusing flow, missing drill-down |
| UI/UX | Polish | No loading state, poor empty state, missing tooltips |
| Data Accuracy | Logic | Wrong filter, bad dedup, incorrect formula |
| Data Accuracy | Completeness | Missing NULLs, low population rate, edge cases |
| Data Accuracy | Consistency | Different numbers across features, dashboard vs raw |

### 3.2 Prioritize

Score each enhancement:
- **Impact**: How much would this improve the user experience or data quality? (High/Medium/Low)
- **Effort**: How much work to implement? (Small/Medium/Large)
- **Risk**: Could this break something? (Low/Medium/High)

Priority = High Impact + Small Effort + Low Risk first.

---

## Phase 4: Cross-LLM Council Review

### 4.1 Check council availability

Verify `ask_codex`, `ask_gemini`, and `ask_all` tools are available from council-mcp. If not, skip to Phase 5 and note the review was not cross-validated.

### 4.2 Send to council

Send the synthesized findings to **both** Codex and Gemini using `ask_all`. Include:
- The feature description and key files
- The three agent findings (code, UX, data)
- Your prioritized enhancement list

Prompt for the council:

```
You are a senior product engineer reviewing a feature audit for the Savvy Wealth recruiting analytics dashboard (Next.js 14, TypeScript, Tailwind, Tremor, BigQuery).

Feature being audited: [name and description]

Below are findings from three specialized auditors covering code/performance, UI/UX, and data accuracy.

Your job:
1. **Validate**: Are the findings accurate? Flag any that seem wrong or exaggerated.
2. **Add**: What did the auditors MISS? Think about:
   - Performance optimizations specific to Next.js 14 (RSC, streaming, parallel routes)
   - Modern dashboard UX patterns (sparklines, micro-interactions, progressive disclosure)
   - BigQuery-specific optimizations (partitioning, clustering, materialized views)
   - Accessibility and mobile responsiveness
3. **Prioritize**: Of everything found + your additions, what are the top 5 highest-impact improvements?
4. **Propose**: For each top-5 item, describe the specific implementation approach in 2-3 sentences.

Structure your response as:
- **Validated findings** (agree these are real)
- **Disputed findings** (disagree or need more context)
- **Missed opportunities** (things the audit didn't catch)
- **Top 5 Recommendations** (prioritized, with implementation sketch)

[FINDINGS BELOW]
```

### 4.3 Incorporate council feedback

Merge council recommendations into your enhancement list. For any new ideas from the council, add them with source attribution. For disputed findings, note the disagreement.

---

## Phase 5: Produce the Enhancement Report

Write the report to `docs/audits/[feature-name]-audit.md`:

```markdown
# Feature Audit: [Feature Name]

**Audited**: [date]
**Requested by**: [user context]
**Status**: [Reviewed by Council | Unreviewed]

---

## Executive Summary

[3-5 sentences: what the feature does, its current state, and the single biggest improvement opportunity]

## Feature Overview

### What It Does
[1 paragraph description of the feature's purpose and user value]

### Architecture
[Data flow diagram in text: BigQuery view → query function → API route → component]

### Key Files
| File | Purpose |
|------|---------|
| [path] | [role] |

---

## Enhancement Opportunities

### Priority 1: [Title] — [Category]
**Impact**: High | **Effort**: [size] | **Risk**: [level]

**Current state**: [what's wrong or suboptimal]
**Proposed improvement**: [what to do]
**Implementation sketch**: [2-3 sentences on how]

### Priority 2: [Title] — [Category]
[repeat...]

---

## Detailed Findings

### Performance
[all performance findings with evidence]

### UI/UX
[all UX findings with evidence]

### Data Accuracy
[all data accuracy findings with evidence]

---

## Council Review

**Models consulted**: [list]
**New opportunities identified**: [count]
**Findings disputed**: [count]

### Council Additions
[enhancement ideas from the council not caught by agents]

### Disputed Findings
[any agent findings the council disagreed with, and reasoning]

---

## Appendix: Raw Council Feedback

### OpenAI/Codex Review
[full unedited text]

### Gemini Review
[full unedited text]
```

---

## Phase 6: Present to User

Tell the user:

1. **Headline**: "Audit complete for **[feature name]**. Found [N] enhancement opportunities across performance, UI/UX, and data accuracy."
2. **Top 3**: List the three highest-priority improvements with 1-sentence descriptions
3. **Council highlights**: Notable additions or disagreements from Gemini/Codex
4. **Location**: Where the full report is saved
5. **Next steps**: "Pick any enhancement and I can implement it, or run `/build-guide` to create an implementation plan for the top priorities."

---

## Critical Rules

- **Read before judging**: Always read the actual code before claiming something is wrong. Don't guess based on file names.
- **Evidence required**: Every finding must include a file path and line number or a BigQuery query result. No hand-waving.
- **Respect existing patterns**: If the codebase does something a certain way consistently, that's a pattern to follow, not a bug to fix. Only flag it if it's genuinely suboptimal.
- **Business context matters**: A "slow" query that runs once per page load on a dashboard used by 20 people is different from one that runs on every keystroke. Scale your recommendations to the actual usage.
- **Don't pad the report**: If a category has no findings, say "No significant issues found" — don't invent problems to fill space.
- **Council is advisory**: The council models don't have codebase access. Their suggestions are directional — validate feasibility against the actual code before recommending.
