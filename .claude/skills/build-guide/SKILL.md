---
name: build-guide
description: "Build an agentic implementation guide from exploration results. Use after /new-feature exploration completes. Creates a phased, validation-gated guide that another agent can execute step-by-step."
---

# Build Agentic Implementation Guide

You are building an implementation guide from completed exploration results. The guide must be executable by a single Claude Code agent working phase-by-phase with human checkpoints.

## Prerequisites

Before starting, verify that exploration files exist:
- `exploration-results.md` (synthesized findings)
- `code-inspector-findings.md`
- `data-verifier-findings.md`
- `pattern-finder-findings.md`

Read ALL of them. The exploration results are the primary source, but the raw findings files contain detail you'll need for exact line numbers, code snippets, and edge cases.

## Guide Structure

Create `agentic_implementation_guide.md` in the project root with this exact structure:

### Header Section

# Agentic Implementation Guide: [Feature Name]

## Reference Document
All decisions in this guide are based on the completed exploration files.
Those documents are the single source of truth.

## Feature Summary
[Table of new fields/capabilities being added, their sources, and notes]

## Architecture Rules
- Never use string interpolation in BigQuery queries — always @paramName
- All queries target the appropriate view via constants
- Use toString()/toNumber() helpers for type-safe transforms
- Use extractDate()/extractDateValue() for date fields
- Do not modify API routes unless they transform data (most are pass-through)

## Pre-Flight Checklist
npm run build 2>&1 | head -50
If pre-existing errors, stop and report. Do not proceed with a broken baseline.

### Phase Pattern

Every phase follows this template:

# PHASE N: [Title]

## Context
[Why this phase exists, what it does, which files are affected]

## Step N.1: [Specific action]
**File**: [exact path]
[Exact code to add/change, with before/after when helpful]

## PHASE N — VALIDATION GATE
[bash commands to verify: tsc, lint, grep for expected patterns]

**Expected**: [What the output should look like]

**STOP AND REPORT**: Tell the user:
- "[Summary of what was done]"
- "[Error count change if applicable]"
- "[What's next]"
- "Ready to proceed to Phase [N+1]?"

### Standard Phase Order

**Phase 1: Blocking Prerequisites**
- CSV escaping fixes (if free-text fields with newlines)
- Any other infrastructure fixes that must come first
- Skip if exploration found no prerequisites needed

**Phase 2: Utility Functions**
- New calculation functions (e.g., calculateDaysInStage)
- Add to existing util files, don't create new ones
- Define function signature based on the types that will exist after Phase 3

**Phase 3: Type Definitions**
- Update TypeScript interfaces with new REQUIRED (non-optional) fields
- This INTENTIONALLY breaks the build — TypeScript errors become the Phase 4-7 checklist
- Update ALL relevant types: dashboard types, raw BQ types, drill-down types
- Validation gate: COUNT the errors and list which files have them

**Phase 4: Main Dashboard Query**
- `src/lib/queries/detail-records.ts` (usually)
- Add columns to SELECT, add fields to transform, wire up calculations
- Merge imports into existing import statements (don't add duplicate imports)

**Phase 5: Pipeline Queries**
- `src/lib/queries/open-pipeline.ts` (usually)
- Multiple functions — list ALL of them from exploration results
- Functions whose output doesn't reach exports still need type compliance (minimal fields, null for calculations)
- Unfreeze any hardcoded nulls that should now be real values
- Verify SELECT consistency across functions that should match

**Phase 6: Drill-Down Queries**
- `src/lib/queries/drill-down.ts` (usually)
- Multiple functions with different record types
- Each has its own relevant subset of stage entry dates
- Match the patterns found by pattern-finder

**Phase 7: Component Export Mappings**
- Update explicit column mappings in ExportMenu, MetricDrillDownModal, etc.
- Update any components that manually construct typed records (ExploreResults.tsx drilldown handler, etc.)
- This is where the code-inspector's "construction site inventory" is critical — every site must be covered
- Validation gate: `npm run build` must pass with ZERO errors

**Phase 7.5: Documentation Sync**
Run: npx agent-guard sync
Review changes to ARCHITECTURE.md and generated inventories. Stage if correct.

**Phase 8: UI/UX Validation (Requires User)**
- Present test groups for the user to verify in the browser
- Each test group: steps to perform, what to verify in the CSV, question to ask user
- Cover: pipeline drilldown, main dashboard, SGA Hub, Explore, spot-check accuracy

### Critical Rules for Guide Quality

1. **Every construction site must be covered.** Cross-reference the code-inspector's findings. If 4 functions return `DetailRecord[]`, all 4 must be updated. If a component manually builds records from raw rows, it must include all new required fields.

2. **Include both approaches for transforms.** Show the named-variable pattern AND the inline pattern, let the executing agent pick whichever fits the existing code structure.

3. **Validation gates must have concrete grep commands.** Not "verify the changes" — actual bash commands that produce checkable output.

4. **Import merges, not additions.** Always say "add X to the EXISTING import from Y" — never add a second import from the same module.

5. **Phase 3 errors are the checklist.** Explicitly state that build errors after Phase 3 are expected and represent the work remaining. Count them and track the count decreasing through phases.

6. **Include a Troubleshooting Appendix.** Common causes of persistent TypeScript errors, CSV corruption, null values, negative numbers. Draw from the data-verifier's edge case findings.

7. **Include Known Limitations.** Document any proxies, workarounds, or intentionally-null fields with rationale.

8. **Agent-guard sync before UI validation.** Always include `npx agent-guard sync` as Phase 7.5 (after code changes pass build, before browser testing).

## Output

Save the guide as `agentic_implementation_guide.md` in the project root.

**STOP AND REPORT**: Tell the user:
- "Implementation guide complete: `agentic_implementation_guide.md`"
- "[N] phases, [M] files to modify, [K] functions to update"
- "**Recommended next step**: Take this guide plus the exploration docs to another LLM (Gemini, GPT, etc.) for cross-validation before execution. Look for: missing construction sites, incorrect file paths, and logic gaps."
- "When validated, run: `Read agentic_implementation_guide.md top to bottom. Execute each phase sequentially. Stop and report at every gate. Start with Pre-Flight.`"
