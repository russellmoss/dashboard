---
name: new-feature
description: "Kick off a new dashboard feature with parallel exploration. Use when adding fields, metrics, or capabilities to the dashboard. Spawns an agent team for codebase inspection, data verification, and pattern analysis."
---

# New Dashboard Feature — Parallel Exploration

You are starting the exploration phase for a new dashboard feature. The user will describe what they want to add. Your job is to run a parallel investigation and produce a comprehensive exploration report.

## Step 1: Understand the Feature

If not already clear from the user's request, ask:
- What fields, metrics, or capabilities are being added?
- Which parts of the dashboard should be affected? (main dashboard, pipeline, SGA Hub, Explore, all?)
- Are there specific BigQuery fields they already know about, or should you discover them?

Do NOT ask more than necessary — infer what you can from the request.

## Step 2: Create Agent Team

Spawn an agent team with 3 teammates:

### Teammate 1: Code Inspector (use code-inspector agent)
Investigate:
- What TypeScript types need new fields? (DetailRecord, DrillDownRecordBase, raw BQ types, and any others)
- What query functions return records that will need changes? List ALL of them — missing one causes build failure
- What export paths exist and which need manual column mapping updates vs auto-include?
- What API routes are involved and are they pass-through or do they transform data?
- Are there any components that manually construct typed records from raw data? (e.g., ExploreResults.tsx drilldown handler)
- Save findings to `code-inspector-findings.md` in the project root

### Teammate 2: Data Verifier (use data-verifier agent)
Investigate using MCP access to BigQuery:
- Do the source fields exist in the relevant BigQuery view(s)? If not, what view changes are needed?
- What are the population rates, value distributions, and data quality for each field?
- Are there edge cases that will affect CSV export? (newlines, special chars, long text, encoding)
- Are there cross-field consistency issues?
- If a view modification is needed, document what needs to change and flag it as a blocker
- Save findings to `data-verifier-findings.md` in the project root

### Teammate 3: Pattern Finder (use pattern-finder agent)
Investigate:
- How do existing similar fields flow end-to-end from BigQuery to CSV export?
- What's the exact transform pattern in each query file that needs changes?
- Are there inconsistencies between query files we should be aware of?
- What date handling, null handling, and type coercion patterns should the new feature follow?
- Save findings to `pattern-finder-findings.md` in the project root

## Step 3: Synthesize Results

Once all teammates complete, read all three findings files and produce `exploration-results.md` containing:

### Sections:
1. **Feature Summary** — What's being added, which fields, which source columns
2. **BigQuery Status** — Fields exist ✅/❌, view changes needed, data quality
3. **Files to Modify** — Complete list with file paths, function names, what changes
4. **Type Changes** — Exact fields to add to each TypeScript interface
5. **Construction Site Inventory** — Every code location that constructs modified types
6. **Recommended Phase Order** — Ordered phases with rationale
7. **Risks and Blockers** — View changes, CSV escaping, missing dates, inconsistencies
8. **Documentation** — Implementation guide must include `npx agent-guard sync` phase

## Step 4: Present to User

Tell the user:
- "Exploration complete. [N] files to modify, [blockers if any]."
- "Run `/build-guide` to generate the implementation guide, or investigate further."
