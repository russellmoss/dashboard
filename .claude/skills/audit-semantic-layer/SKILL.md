---
name: audit-semantic-layer
description: "Audit the semantic layer for gaps against current dashboard features. Spawns an agent team to find missing coverage, draft additive updates, and validate against live BigQuery data. Run after adding new dashboard features or periodically."
---

# Audit Semantic Layer — Agent Team

You are auditing the Explore AI feature's semantic layer to find gaps where dashboard features exist but the semantic layer doesn't cover them. The goal is **additive-only** updates — never modify existing working definitions.

## Semantic Layer Files (Source of Truth)

- `src/lib/semantic-layer/definitions.ts` — metrics, dimensions, filters, entity mappings
- `src/lib/semantic-layer/query-templates.ts` — pre-verified SQL query patterns
- `src/lib/semantic-layer/query-compiler.ts` — deterministic SQL assembler
- `src/lib/semantic-layer/agent-prompt.ts` — Claude agent instructions + example mappings
- `src/lib/semantic-layer/__tests__/validation-examples.ts` — test cases
- `src/lib/semantic-layer/__tests__/query-compiler-validation.ts` — validation suite

## Step 1: Spawn Agent Team

Create 3 agents in parallel:

### Agent 1: Gap Finder

**Goal**: Identify everything the dashboard can do that the semantic layer can't answer questions about.

**Instructions for the agent:**

1. **Read the current semantic layer** — Read `src/lib/semantic-layer/definitions.ts` completely. Catalog every metric, dimension, entity mapping, and date field currently defined.

2. **Scan dashboard query files** — Read every file in `src/lib/queries/*.ts`. For each query file, extract:
   - What BigQuery fields/columns are queried
   - What metrics are calculated (SUMs, COUNTs, rates)
   - What dimensions are used for grouping/filtering
   - What BigQuery views/tables are referenced

3. **Scan dashboard components for features** — Check these areas:
   - `src/app/dashboard/pipeline/page.tsx` and pipeline-related components (stale pipeline, pipeline aging)
   - `src/app/dashboard/sga-hub/` and `src/components/sga-hub/` (closed-lost, re-engagement, SGA breakdowns)
   - `src/app/dashboard/sga-management/` (SGA management features)
   - `src/app/dashboard/recruiter-hub/` (recruiter-specific views)
   - `src/app/dashboard/gc-hub/` (GC hub features)
   - `src/components/dashboard/StalePipelineAlerts.tsx`
   - `src/components/dashboard/ConversionTrendChart.tsx`
   - `src/components/dashboard/ConversionRateCards.tsx`
   - `src/lib/queries/forecast.ts` and `src/lib/queries/forecast-goals.ts`
   - `src/lib/queries/closed-lost.ts`
   - `src/lib/queries/re-engagement.ts`
   - `src/lib/queries/sga-activity.ts`
   - `src/lib/queries/sga-leaderboard.ts`
   - `src/lib/queries/source-performance.ts`
   - `src/lib/queries/weekly-actuals.ts`

4. **Scan API routes for data capabilities** — Check `src/app/api/` for routes that serve data the semantic layer doesn't cover.

5. **Scan types for fields** — Check `src/types/dashboard.ts`, `src/types/sga-hub.ts`, `src/types/record-detail.ts` for fields that represent queryable data.

6. **Cross-reference and produce gap report** — For each gap found, document:
   - **Feature name**: What the dashboard calls it
   - **Where it lives**: File paths (query, component, API route)
   - **What data it uses**: BigQuery fields, views, calculations
   - **Semantic layer status**: Not covered / Partially covered / Covered
   - **Gap type**: Missing metric / Missing dimension / Missing entity mapping / Missing query template / Missing date field
   - **Priority**: High (users would naturally ask about this) / Medium / Low

Save findings to `semantic-layer-gap-finder-results.md` in project root.

### Agent 2: Schema Author

**Goal**: Draft additive semantic layer updates based on Agent 1's gap report.

**IMPORTANT**: Wait conceptually for Agent 1 — but since agents run in parallel, this agent should ALSO read the dashboard query files and semantic layer independently to draft updates. It will need to be reconciled with Agent 1's findings.

**Instructions for the agent:**

1. **Read the current semantic layer** — Read ALL files in `src/lib/semantic-layer/` to understand:
   - Naming conventions (camelCase keys, specific field patterns)
   - SQL patterns (how metrics use CASE WHEN, date comparisons, SGA filter placeholders)
   - How dimensions reference `v.` prefixed fields
   - How entity mappings define filter conditions
   - How query templates are structured with `{metric}`, `{dimension}`, `{dimensionFilters}` placeholders
   - How the agent-prompt.ts documents example mappings

2. **Read dashboard query files** — Focus on `src/lib/queries/` files that use BigQuery fields NOT present in definitions.ts.

3. **For each potential gap, draft the update** following existing conventions exactly:
   - New VOLUME_METRICS entries: must include name, description, dateField, sql, visualization, aliases
   - New AUM_METRICS entries: must include format: 'currency'
   - New DIMENSIONS entries: must include name, description, field, rawField, requiresJoin, filterable, groupable, aliases
   - New ENTITY_MAPPINGS entries: must include filter and description
   - New QUERY_TEMPLATES entries: must include id, description, template, parameters, visualization, exampleQuestions
   - New agent-prompt examples: must show question -> templateId mapping with notes

4. **For each drafted update, note**:
   - Which file to add it to
   - Where in the file (after which existing entry)
   - Whether it requires a new query template or works with existing templates
   - Whether the agent-prompt.ts needs new example mappings

5. **DO NOT modify existing definitions** — only propose additions.

Save findings to `semantic-layer-schema-author-results.md` in project root.

### Agent 3: Data Validator

**Goal**: Verify that any new fields/queries proposed would return real, valid data from BigQuery.

**Instructions for the agent:**

1. **Read the current semantic layer** — Understand what views and tables are referenced (primarily `vw_funnel_master`).

2. **Use BigQuery MCP tools to investigate**:
   - Run `mcp__bigquery__get_table_info` on `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` to get the current schema
   - Check for any fields referenced in dashboard queries that exist in the view but aren't in the semantic layer
   - For each potential new metric/dimension, run a sample query to verify:
     - The field exists and has data
     - Population rate (what % of records have non-null values)
     - Value distribution (for dimensions: distinct values; for metrics: min/max/avg)
     - Data quality issues (unexpected nulls, bad values, encoding issues)

3. **Check other BigQuery views** that dashboard features reference:
   - `savvy-gtm-analytics.Tableau_Views.vw_daily_forecast` (forecast features)
   - Any views referenced in `src/lib/queries/closed-lost.ts`, `re-engagement.ts`, etc.
   - Run `mcp__bigquery__list_table_ids` on `savvy-gtm-analytics.Tableau_Views` to find all available views

4. **For each field/metric that could be added to the semantic layer**:
   - Confirm the BigQuery field name is correct
   - Confirm data type (TIMESTAMP vs DATE vs STRING vs INT64 vs FLOAT64)
   - Confirm the SQL pattern would work (run a test query if needed)
   - Flag any fields with low population rates (<10%) or data quality issues
   - Flag any fields that require JOINs or views not currently referenced in the semantic layer

5. **Test existing semantic layer SQL patterns with new fields** — For any new metric SQL, verify it compiles and returns sensible results by running against BigQuery.

Save findings to `semantic-layer-data-validator-results.md` in project root.

## Step 2: Synthesize Results

Once all 3 agents complete, read all findings files and produce `semantic-layer-audit-results.md` containing:

### Sections:

1. **Audit Summary** — How many gaps found, breakdown by type and priority
2. **Gap Inventory** — Complete table: feature name, gap type, priority, data status (verified/unverified/missing)
3. **Recommended Additions** — Organized by file, with exact code snippets ready to add:
   - `definitions.ts` additions (new metrics, dimensions, entity mappings, date fields)
   - `query-templates.ts` additions (new query templates)
   - `agent-prompt.ts` additions (new example mappings, capability descriptions)
   - `validation-examples.ts` additions (new test cases)
4. **Data Validation Results** — Which fields are confirmed in BigQuery, population rates, quality notes
5. **Blocked Items** — Anything that can't be added yet (missing BQ fields, view changes needed, low data quality)
6. **Recommended Priority Order** — Which additions to make first based on user impact and data readiness

## Step 3: Present to User

Tell the user:
- "Semantic layer audit complete. [N] gaps found ([H] high / [M] medium / [L] low priority)."
- "[X] ready to implement now, [Y] blocked on data issues."
- "Review `semantic-layer-audit-results.md` for the full report."
- "When ready, I can apply the recommended additions to the semantic layer files."

**IMPORTANT**: Do NOT apply changes automatically. The user must review the gap report and approve which additions to make. Some gaps may be intentional (internal data not meant for Explore).
