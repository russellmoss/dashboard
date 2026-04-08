# Explore Feature — Technical Architecture

> Internal reference document covering the Explore tab's architecture, the semantic layer that powers it, and a forward-looking comparison with the schema-context MCP approach.

---

## Table of Contents

1. [Overview](#overview)
2. [Request Lifecycle](#request-lifecycle)
3. [Semantic Layer Deep Dive](#semantic-layer-deep-dive)
   - [definitions.ts](#definitionsts)
   - [query-templates.ts](#query-templatests)
   - [query-compiler.ts](#query-compilerts)
   - [agent-prompt.ts](#agent-promptts)
   - [index.ts](#indexts)
   - [Tests](#tests)
4. [UI Components](#ui-components)
5. [API Route](#api-route)
6. [SQL Audit Trail](#sql-audit-trail)
7. [Types Contract](#types-contract)
8. [Schema-Context MCP Comparison](#schema-context-mcp-comparison)
9. [Migration Analysis](#migration-analysis)

---

## Overview

The Explore tab is a natural-language analytics interface. Users type questions in plain English (e.g., "How many SQOs this quarter by channel?") and get back charts, tables, and drilldowns — all backed by BigQuery.

**Key design principle:** Claude never generates raw SQL. Instead, it selects a *template ID* and *parameters* from a predefined menu. A deterministic compiler then assembles the SQL from verified fragments. This eliminates SQL injection risk and ensures every query is structurally valid.

**Stack:**
- **UI:** React client component (`ExploreClient.tsx`) with `useReducer` state machine
- **API:** Next.js route handler at `/api/agent/query`
- **AI:** Claude Sonnet (`claude-sonnet-4-20250514`) with a dynamically-generated system prompt
- **SQL Engine:** Deterministic query compiler in `src/lib/semantic-layer/query-compiler.ts`
- **Data:** BigQuery view `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
- **Audit:** SQL + params logged in QueryInspector UI and `exploreFeedback` Prisma table

---

## Request Lifecycle

```
User types question
  |
  v
ExploreClient.handleSubmit()
  |  dispatches SUBMIT_QUESTION
  |  sends last 5 conversation messages
  v
agentApi.query() --- POST /api/agent/query
  |
  v
API Route (route.ts)
  |
  +--[1] Auth: JWT session + RBAC (blocks recruiter, capital_partner)
  |
  +--[2] callClaude(question, history)
  |       - Model: claude-sonnet-4-20250514, max 1024 tokens
  |       - System prompt: generateAgentSystemPrompt() (built dynamically from definitions)
  |       - Retries: 3x on 429/529 with exponential backoff
  |       - Parses first {...} JSON block from response -> TemplateSelection
  |
  +--[3] validateTemplateSelection(selection)
  |       - Template exists? Metric valid? Dimension valid? Date preset valid?
  |       - Template-specific required params (e.g., sga for sga_summary)
  |
  +--[4] compileQuery(selection)
  |       - Dispatches to 1 of 22 sub-compiler functions
  |       - Returns parameterized SQL + @param values (never string interpolation)
  |
  +--[5] runQuery(sql, params) -> BigQuery (30s timeout)
  |
  +--[6] determineVisualization(templateId, selection, rowCount)
  |       - 3-tier: Claude preference > row-count heuristics > template default
  |
  +--[7] inferColumns(rows, selection, compiledQuery)
  |       - Detects rate columns by name pattern
  |
  v
AgentResponse returned to client
  |
  v
ExploreResults renders:
  [1] Template badge (templateId + explanation)
  [2] Visualization (metric card / bar chart / line chart)
  [3] Paginated data table (50 rows/page, clickable records)
  [4] QueryInspector (collapsed — shows parameterized + executable SQL)
  [5] ResponseFeedback (thumbs up/down -> Prisma)
  [6] Follow-up suggestions
```

**Drilldowns** are full round-trips: clicking a chart element constructs a natural-language follow-up question and re-submits through the entire pipeline.

---

## Semantic Layer Deep Dive

All files live in `src/lib/semantic-layer/`. The layer has four responsibilities:

1. **Define** what can be queried (definitions.ts)
2. **Describe** the query patterns available (query-templates.ts)
3. **Compile** selections into executable SQL (query-compiler.ts)
4. **Instruct** Claude on how to map questions to selections (agent-prompt.ts)

### definitions.ts

Single source of truth for all business logic. Every metric, dimension, date field, and filter is defined here as immutable TypeScript `const` objects.

#### Constants

```typescript
CONSTANTS = {
  FULL_TABLE: 'savvy-gtm-analytics.Tableau_Views.vw_funnel_master',
  MAPPING_TABLE: 'savvy-gtm-analytics.SavvyGTMData.new_mapping',  // deprecated
  DAILY_FORECAST_VIEW: 'savvy-gtm-analytics.Tableau_Views.vw_daily_forecast',
  FORECAST_TABLE: 'savvy-gtm-analytics.SavvyGTMData.q4_2025_forecast',
  RECRUITING_RECORD_TYPE: '012Dn000000mrO3IAI',
  RE_ENGAGEMENT_RECORD_TYPE: '012VS000009VoxrYAC',
  OPEN_PIPELINE_STAGES: ['Qualifying', 'Discovery', 'Sales Process', 'Negotiating'],
}
```

#### Volume Metrics (9)

Each metric definition contains: `sql` (the COUNT/SUM expression with date range placeholders), `dateField` (which field to filter on), `description`, and `aliases` (alternative names Claude should recognize).

| Key | Date Field | Type | Notes |
|---|---|---|---|
| `prospects` | `FilterDate` | TIMESTAMP | Funnel entry |
| `contacted` | `stage_entered_contacting__c` | TIMESTAMP | `is_contacted = 1` |
| `mqls` | `mql_stage_entered_ts` | TIMESTAMP | Call Scheduled stage |
| `sqls` | `converted_date_raw` | DATE | `is_sql = 1` |
| `sqos` | `Date_Became_SQO__c` | TIMESTAMP | `is_sqo_unique = 1` + recordtypeid filter |
| `joined` | `advisor_join_date__c` | DATE | `is_joined_unique = 1` |
| `initial_calls_scheduled` | `Initial_Call_Scheduled_Date__c` | DATE | COUNT DISTINCT primary_key |
| `qualification_calls` | `Qualification_Call_Date__c` | DATE | COUNT DISTINCT Full_Opportunity_ID__c |
| `signed` | `Stage_Entered_Signed__c` | TIMESTAMP | `is_sqo_unique = 1` |
| `closed_lost` | null (snapshot) | — | StageName = 'Closed Lost', no date filter |

All metric SQL bodies contain `{sgaFilterLead}` / `{sgaFilterOpp}` placeholders that the compiler strips out (RBAC not applied in Explore — all users see all data).

#### AUM Metrics (5)

All use `COALESCE(v.Underwritten_AUM__c, v.Amount, 0)`: `sqo_aum`, `joined_aum`, `signed_aum`, `open_pipeline_aum`, `avg_aum`.

#### Conversion Metrics (4)

All use **cohort mode only** (never periodic). Pattern: `SAFE_DIVIDE(SUM(progressionField), SUM(eligibilityFlag)) * 100`.

| Key | Cohort Anchor | Numerator | Denominator |
|---|---|---|---|
| `contacted_to_mql_rate` | `stage_entered_contacting__c` | `contacted_to_mql_progression` | `eligible_for_contacted_conversions_30d` |
| `mql_to_sql_rate` | `mql_stage_entered_ts` | `mql_to_sql_progression` | `eligible_for_mql_conversions` |
| `sql_to_sqo_rate` | `converted_date_raw` | `sql_to_sqo_progression` | `eligible_for_sql_conversions` |
| `sqo_to_joined_rate` | `Date_Became_SQO__c` | `sqo_to_joined_progression` | `eligible_for_sqo_conversions` |

#### Dimensions (17)

Standard: `channel`, `source`, `sga`, `sgm`, `stage_name`, `aum_tier`, `record_type`, `tof_stage`, `lead_score_tier`, `external_agency`, `next_steps`, `opp_next_step`, `conversion_status`, `closed_lost_reason`, `campaign_name`.

Special:
- **`experimentation_tag`** — Has both `field` (raw string) and `arrayField` (array for `UNNEST`). Value `"*"` means "any tag exists."
- **`campaign`** — Supports 15-18 char Salesforce ID exact match OR fuzzy `LIKE` name match.

#### Date Fields Registry

`DATE_FIELDS` — 14 entries mapping each date field to its BigQuery type (`DATE` vs `TIMESTAMP`). The compiler consults this to choose `DATE()` vs `TIMESTAMP()` wrappers. This is critical — using the wrong wrapper silently truncates or fails.

#### Other Exports

- `TIME_DIMENSIONS` (4): `quarter`, `month`, `week`, `year` — each is a function `(dateField) => SQL expression`
- `DATE_RANGES` (10 presets + `custom`): Each preset has `startDateSql`/`endDateSql` as BigQuery SQL expressions
- `ENTITY_MAPPINGS` (9): Predefined filter strings for business concepts like "open pipeline"
- `AGGREGATIONS` (6): SQL aggregate patterns
- `SGA_FILTER_PATTERNS`: Lead-level vs opp-level WHERE clauses
- `SEMANTIC_LAYER`: Composite object bundling everything above

---

### query-templates.ts

Defines the menu of 22+ named query patterns Claude can select from. Templates are **declarative documentation** — they describe expected SQL structure but are not directly substituted. The compiler generates SQL independently from definitions.

Each template specifies: `id`, `description`, `exampleQuestions`, `requiredParams`, `optionalParams`, `visualization` (default), and `implementationNotes`.

#### Template Inventory

**Aggregate / Chart templates:**

| Template ID | Default Viz | Description |
|---|---|---|
| `single_metric` | `metric` | One metric, one value |
| `metric_by_dimension` | `bar` | Metric grouped by dimension |
| `conversion_by_dimension` | `bar` | Cohort rates by dimension |
| `metric_trend` | `line` | Time series with optional rolling avg |
| `conversion_trend` | `line` | Conversion rates over time |
| `period_comparison` | `comparison` | Two periods side-by-side (V2) |
| `top_n` | `bar` | Top/bottom N with LIMIT |
| `funnel_summary` | `funnel` | All 6 stage volumes (V2) |
| `pipeline_by_stage` | `bar` | Stage counts + AUM |
| `sga_leaderboard` | `bar` | RANK() by metric |
| `sga_summary` | `table` | Full scorecard for one SGA |
| `average_aum` | `metric` | AVG/MIN/MAX AUM |
| `multi_stage_conversion` | `metric` | Direct cohort across N stages |
| `time_to_convert` | `metric` | Avg/median/percentile days between stages |
| `forecast_vs_actual` | `table` | **NOT IMPLEMENTED** (throws) |
| `rolling_average` | `line` | **NOT IMPLEMENTED** (throws) |
| `opportunities_by_age` | `table` | **NOT IMPLEMENTED** (throws) |

**Detail / List templates:**

| Template ID | Description |
|---|---|
| `scheduled_calls_list` | Initial calls in date range |
| `qualification_calls_list` | Qual calls in date range |
| `sqo_detail_list` | SQO records with full context |
| `generic_detail_list` | Detail rows for any metric |
| `mql_detail_list` | Alias → `generic_detail_list` |
| `sql_detail_list` | Alias → `generic_detail_list` |
| `open_pipeline_list` | Snapshot of open SQOs |
| `closed_lost_list` | Current closed-lost SQOs |
| `re_engagement_list` | Open re-engagement opps |
| `weekly_actuals_by_sga` | Weekly cadence scorecard |
| `sga_quarterly_progress` | Quarterly SQO count + AUM |

Also exports: `VISUALIZATION_TYPES` (6 definitions), `QUESTION_PATTERNS` (regex hint map for agent routing).

---

### query-compiler.ts

The deterministic SQL assembly engine. Takes a `TemplateSelection`, calls the appropriate sub-compiler, returns a `CompiledQuery` with executable BigQuery SQL + params.

#### Public API

```typescript
// Validate before compiling
validateTemplateSelection(selection: TemplateSelection): ValidationResult

// Main entry point — dispatches to sub-compiler
compileQuery(selection: TemplateSelection): CompiledQuery

// Helpers (used internally and by tests)
getMetricSql(metricName: string): string
getDimensionSql(dimensionName: string): string
getTimeDimensionSql(timePeriod: string, dateField: string): string
getDateRangeSql(dateRange: DateRangeParams): { startSql, endSql, startDate, endDate }
getMetricDateField(metricName: string): string
buildDimensionFilterSql(filters: DimensionFilter[], isOppLevel: boolean): { sql, needsUserJoin }
determineVisualization(templateId, selection, rowCount?): VisualizationType
```

#### How Compilation Works

1. `compileQuery()` validates the selection, then dispatches via `switch(templateId)` to one of ~22 private sub-compiler functions.

2. Each sub-compiler:
   - Calls `getMetricSql()` to get the COUNT/SUM expression from `definitions.ts`
   - Calls `getDateRangeSql()` to resolve date bounds (presets become inline SQL expressions, custom dates use `@param` values)
   - Calls `buildDimensionFilterSql()` for any WHERE clauses from filters
   - Calls `getTimeDimensionSql()` for GROUP BY time bucketing
   - Assembles the full SQL string using template literals (but user values are always `@paramName`)

3. Returns `CompiledQuery` with: `sql`, `params`, `templateId`, `visualization`, `metadata`.

#### Date Range Handling

- **Presets** (e.g., `this_quarter`): SQL expressions like `DATE_TRUNC(CURRENT_DATE(), QUARTER)` are inlined directly — no `@param` needed.
- **Custom ranges**: `@startDate` / `@endDate` params are included in the `queryParams` object.
- **"All time" queries**: When `dateRange` is omitted, date condition lines are stripped from the metric SQL via line-by-line regex filtering.

#### Dimension Filter Builder

`buildDimensionFilterSql()` handles special cases per dimension:
- **`experimentation_tag`**: `UNNEST(Experimentation_Tag_List)` with fuzzy `UPPER(tag) LIKE UPPER('%value%')`. Value `"*"` maps to `ARRAY_LENGTH(...) > 0`.
- **`campaign`**: Salesforce ID regex → exact match; otherwise fuzzy `LIKE` on `Campaign_Name__c` and `all_campaigns[]` array.
- **`sga`**: At opp-level, checks both `SGA_Owner_Name__c` and `Opp_SGA_Name__c` (with optional `LEFT JOIN User`). Lead-level checks `SGA_Owner_Name__c` only. Always fuzzy `LIKE`.
- **All others**: Standard `=`, `IN`, `!=`, `NOT IN` with single-quote escaping.

#### Visualization Decision

Three-tier priority:
1. Claude's explicit `preferredVisualization` wins
2. Post-query heuristics: 1 row → `metric`, <=15 rows + non-table default → `bar`, >50 rows → `table`
3. Template default fallback

---

### agent-prompt.ts

Generates the system prompt injected into every Claude API call. **Not static** — builds dynamically by iterating over all metrics, dimensions, templates, and date ranges from `definitions.ts` and `query-templates.ts`.

#### Prompt Structure

1. Capability description (what topics Claude can answer)
2. Available templates (formatted: id + description + example questions)
3. Volume metrics with aliases
4. AUM metrics
5. Conversion metrics with aliases + CRITICAL note about cohort-only mode
6. Dimensions with aliases
7. Date range presets with aliases
8. Output format (JSON schema Claude must return)
9. Visualization selection rules
10. **14 numbered CRITICAL RULES** covering:
    - No raw SQL generation
    - Cohort mode enforcement
    - "All time" date handling (omit dateRange)
    - Alias mapping (e.g., "conversions" → "sqls", "win rate" → "sqo_to_joined_rate")
    - Experimentation tag `"*"` wildcard
    - Fuzzy SGA/SGM name matching
    - Campaign fuzzy match
    - "Last N quarters" custom date calculation
11. 15 example question → JSON response mappings

#### Output Format

Claude returns:
```json
{
  "templateId": "metric_by_dimension",
  "parameters": {
    "metric": "sqos",
    "dimension": "channel",
    "dateRange": { "preset": "this_quarter" }
  },
  "confidence": 0.95,
  "explanation": "Counting SQOs grouped by channel for the current quarter",
  "preferredVisualization": "bar",
  "visualizationReasoning": "Categorical comparison is best shown as a bar chart"
}
```

---

### index.ts

Barrel re-export file. Provides a single import path:

```typescript
export * from './definitions';
export * from './query-templates';
export * from './query-compiler';

// Named convenience re-exports
export { SEMANTIC_LAYER } from './definitions';
export { QUERY_TEMPLATES } from './query-templates';
export { compileQuery, validateTemplateSelection, determineVisualization, ... } from './query-compiler';
```

---

### Tests

**`__tests__/query-compiler-validation.ts`** — Manual test runner (not Jest, runs via `npx ts-node`):
- Validates template selection (valid passes, unknown template/metric fails)
- Tests `getMetricSql()`, `getDimensionSql()`, `getDateRangeSql()`
- Tests `compileQuery()` output for basic templates
- Runs first 10 validation examples from the ground truth table

**`__tests__/validation-examples.ts`** — Ground truth mapping table of `{ question, expectedMapping, explanation }` objects. Covers volume, dimension, conversion, and trend questions.

---

## UI Components

### ExploreClient (`src/app/dashboard/explore/ExploreClient.tsx`)

Client component with `useReducer` state machine:

```
status: 'idle' | 'thinking' | 'parsing' | 'compiling' | 'executing' | 'success' | 'error'
```

In practice, the intermediate states (`thinking`, `parsing`, `compiling`, `executing`) are never dispatched — the client makes a single non-streaming POST and jumps from `idle` → `success`/`error`. The states exist for a future streaming variant.

Conversation history is maintained in state. The last 5 messages are sent with each request for context.

### ExploreResults (`src/components/dashboard/ExploreResults.tsx`)

Renders five sections stacked vertically:

1. **Template badge** — Shows the `templateId` and `explanation` in a code pill
2. **Visualization panel** — Delegates to `explore-visualizations.tsx`:
   - `metric` → single value card (clickable for drilldown)
   - `bar` → Recharts `BarChart` (clickable bars filter by dimension value)
   - `line` → Recharts `LineChart` (clickable points drill to time period)
   - `table` → fallback for `funnel`/`comparison` (V2 not implemented)
3. **Paginated data table** — 50 rows/page, rows with `primary_key` open `RecordDetailModal`
4. **QueryInspector** — Collapsed by default, shows SQL audit trail
5. **ResponseFeedback** — Thumbs up/down saved to Prisma

### Drilldown Behavior

Clicking a chart element triggers a full round-trip:
- **Metric click** → constructs NL question from metric + date context
- **Bar click** → extracts dimension value from clicked bar, adds as filter
- **Line click** → extracts period label, parses to date range
- All drilldowns POST to `/api/agent/query` with the constructed question

---

## API Route

**`src/app/api/agent/query/route.ts`** (~645 lines)

1. **Auth**: JWT session (no DB), blocks `recruiter` and `capital_partner`
2. **Validation**: Question must exist, be a string, be under 500 chars
3. **Streaming branch**: Checks `Accept: text/event-stream` — currently unused by the primary UI flow
4. **Claude call**: 30s timeout, 3 retries on rate limits
5. **Validation + compilation**: Uses semantic layer functions
6. **BigQuery execution**: 30s timeout
7. **Post-processing**: Visualization override, column inference, follow-up suggestions

Error handling distinguishes: timeout, BigQuery errors (400/403), missing parameters, and unknown errors.

---

## SQL Audit Trail

The Explore feature maintains a complete audit trail at two levels:

### Runtime (QueryInspector)

**`src/components/dashboard/QueryInspector.tsx`** — Collapsible panel showing:
- **Parameterized SQL**: Raw template with `@param` placeholders
- **Executable SQL**: Params substituted in, ready to paste into BigQuery console
- **Parameters table**: Each `@paramName: value` pair shown as a badge
- **Execution time** in milliseconds
- Copy-to-clipboard button

The executable SQL is generated by `generateExecutableSql()` in `src/lib/utils/sql-helpers.ts`, which handles NULL, string literals, SQL expression detection (`DATE(`, `TIMESTAMP(`, `DATE_TRUNC(`), numbers, booleans, and arrays.

### Persistent (Prisma)

**`src/app/api/explore/feedback/route.ts`** → `exploreFeedback.create` in Neon PostgreSQL:
- `questionId` (ISO timestamp)
- `templateId`
- `question` (original user text)
- `feedback` (thumbs up/down)
- `comment` (required for negative feedback)
- `compiledQuery` (full object: SQL + params + metadata)
- `executableSql` (the substituted version)
- `resultSummary` (rowCount, executionTimeMs, visualization)
- `error` (if query failed)

---

## Types Contract

**`src/types/agent.ts`** defines the complete interface:

| Type | Purpose |
|---|---|
| `VisualizationType` | `'metric' \| 'bar' \| 'line' \| 'table' \| 'funnel' \| 'comparison'` |
| `TemplateSelection` | What Claude returns (templateId + parameters + confidence + explanation) |
| `CompiledQuery` | Executable SQL + params + visualization + metadata |
| `AgentRequest` | Question + conversation history (last 5) + optional user context |
| `AgentResponse` | Success flag + all above + follow-up suggestions |
| `StreamChunk` | Discriminated union for SSE events (future streaming) |
| `ConversationMessage` | Role + content + timestamp + optional query result |
| `DimensionFilter` | Dimension + operator (`equals`/`in`/`not_equals`/`not_in`) + value |
| `DateRangeParams` | Preset string OR custom start/end dates |

---

## Schema-Context MCP Comparison

The project also has a **schema-context MCP** system (`@mossrussell/schema-context-mcp`) configured via `.claude/schema-config.yaml`. This is currently used as a **development-time guardrail** for AI agents writing SQL, but shares significant overlap with what the semantic layer does at runtime.

### What schema-config.yaml Contains

The YAML file (`686 lines`) defines:

| Section | Content | Overlap with Semantic Layer |
|---|---|---|
| `connection` | BQ project + datasets | `CONSTANTS.FULL_TABLE` |
| `views` (7) | Purpose, grain, key_filters, dangerous_columns, consumers, date fields, freshness notes | Partially in `definitions.ts` (only vw_funnel_master) |
| `terms` (15) | Business term definitions, related fields, gotchas | Implicitly in `agent-prompt.ts` rules |
| `fields` (40+) | Field meaning, type, gotchas, `use_instead_of` | `DATE_FIELDS`, metric SQL bodies, dimension definitions |
| `rules` (16) | Dedup rules, required filters, banned patterns, date type rules | Hardcoded in compiler logic |
| `metrics` (4) | Numerator/denominator, cohort vs period modes, gotchas | `CONVERSION_METRICS` in `definitions.ts` |

### MCP Tools Available

| Tool | Purpose |
|---|---|
| `describe_view` | View purpose, grain, filters, dangerous columns, field annotations |
| `list_views` | Discover all views, annotation status |
| `resolve_term` | Business term → field/rule cross-references |
| `get_metric` | Numerator/denominator, mode guidance, gotchas |
| `get_rule` | Dedup rules, required filters, banned patterns |
| `lint_query` | Heuristic SQL validation against rules |
| `health_check` | Drift detection between annotations and live schema |

### Key Differences

| Aspect | Semantic Layer (Runtime) | Schema-Context MCP (Dev-time) |
|---|---|---|
| **When it runs** | Every user query, in production | During AI agent development sessions |
| **Who consumes it** | Claude Sonnet via system prompt + deterministic compiler | Claude Code (or any MCP-connected agent) |
| **SQL generation** | Never — Claude picks a template, compiler builds SQL | Agent writes raw SQL guided by schema context |
| **Safety model** | Template whitelist + parameterized compilation | Heuristic lint rules (substring-based, not AST) |
| **Coverage** | vw_funnel_master only | 7 views, 40+ fields, 16 rules |
| **Metric definitions** | 18 metrics (9 volume + 5 AUM + 4 conversion) | 4 conversion metrics (cohort + period modes) |
| **Dimensions** | 17 hardcoded dimensions | Implicit in field annotations |
| **Date handling** | Type registry + presets + compiler DATE/TIMESTAMP wrappers | Date type rules in `rules` section |
| **Audit trail** | Full: parameterized SQL, executable SQL, params, feedback | None (dev-time only) |
| **Extensibility** | Requires TS code changes to add metrics/templates | YAML edit + MCP restart |
| **Multi-view support** | Single view (vw_funnel_master) | 7 views across 3 datasets |

---

## Migration Analysis

### Could Schema-Context MCP Replace the Semantic Layer?

**Short answer:** Partially. The MCP has richer schema knowledge but lacks the deterministic SQL compilation and audit trail that make Explore safe and auditable.

### What MCP Does Better

1. **Broader coverage** — 7 views vs 1. The Explore feature is locked to `vw_funnel_master`. If Explore ever needs to query `vw_sga_activity_performance`, `vw_forecast_p2`, or `vw_lost_to_competition`, the MCP already describes them.

2. **Richer field metadata** — The YAML has `meaning`, `type`, `gotcha`, and `use_instead_of` for 40+ fields. The semantic layer only knows about fields it directly uses in metrics/dimensions.

3. **Business term glossary** — `resolve_term` maps business vocabulary to fields and rules. The semantic layer handles this via alias lists in the agent prompt, which are less structured.

4. **Validation rules as data** — Rules are declarative YAML, not hardcoded compiler logic. Adding a new "banned pattern" is a YAML edit, not a code change.

5. **Drift detection** — `health_check` compares annotations against live BigQuery schema. The semantic layer has no equivalent — if a field is renamed in BQ, the compiler just breaks.

6. **Easier to maintain** — Adding a new field/view/rule to YAML is simpler than modifying TypeScript definitions + compiler + agent prompt.

### What the Semantic Layer Does Better

1. **Deterministic SQL** — The compiler guarantees structurally valid SQL. With MCP-guided raw SQL generation, Claude could produce syntactically correct but semantically wrong queries (wrong JOIN, missing filter, wrong date type wrapper).

2. **SQL audit trail** — Every query shows parameterized SQL, executable SQL, and parameters. This is critical for debugging and trust. If Claude wrote raw SQL, you'd lose the template→SQL mapping.

3. **No injection surface** — Template selection + parameterized compilation means zero SQL injection risk. Raw SQL generation (even with lint rules) has a larger attack surface.

4. **Reproducibility** — Same `TemplateSelection` JSON always produces the same SQL. Raw SQL generation is non-deterministic.

5. **Visualization coupling** — Templates carry visualization defaults and the compiler overrides them based on row counts. This tight coupling would need to be rebuilt.

### Hybrid Architecture (Recommended)

Rather than a full replacement, a hybrid approach preserves the audit trail while leveraging MCP's richer metadata:

```
User question
  |
  v
Claude (with MCP-enriched system prompt)
  |  - resolve_term() for business vocabulary
  |  - describe_view() for field context
  |  - get_metric() for conversion logic
  |  - get_rule() for constraint awareness
  |
  v
TemplateSelection (same JSON contract)
  |
  v
Compiler (enhanced)
  |  - Uses schema-config.yaml for date types (not hardcoded DATE_FIELDS)
  |  - Uses rules from YAML for validation (not hardcoded in compiler)
  |  - Uses field metadata from YAML for dimension SQL
  |  - Compiles SQL deterministically (same as today)
  |
  v
lint_query() post-check (new)
  |  - Validates compiled SQL against all YAML rules
  |  - Catches drift between compiler output and current schema
  |
  v
BigQuery execution + audit trail (same as today)
```

**Migration steps:**

1. **Phase 1 — Enrich the prompt**: Replace `generateAgentSystemPrompt()`'s hardcoded metric/dimension formatting with MCP tool calls at prompt-build time. The YAML already has richer descriptions, gotchas, and aliases.

2. **Phase 2 — Externalize definitions**: Move `DATE_FIELDS`, `DIMENSIONS`, and field metadata from `definitions.ts` to `schema-config.yaml`. The compiler reads from YAML at startup instead of importing TS constants. Metrics and their SQL stay in TypeScript (they're executable, not declarative).

3. **Phase 3 — Add lint-on-compile**: After `compileQuery()`, run `lint_query()` against the compiled SQL as a safety net. Log warnings but don't block execution (initially).

4. **Phase 4 — Multi-view support**: Use `describe_view()` to dynamically build sub-compilers for views beyond vw_funnel_master. Each view's key_filters, dangerous_columns, and recommended_date_fields inform the compiler.

### What to Preserve (Non-Negotiable)

- **Template selection pattern** — Claude selects a template ID + parameters, never writes SQL
- **Parameterized compilation** — All user values flow through `@param` syntax
- **QueryInspector** — The SQL audit trail UI must remain
- **Feedback persistence** — `exploreFeedback` Prisma table with full query details
- **Visualization decision engine** — Template defaults + Claude preference + row-count heuristics

### What Can Go Away

- `DATE_FIELDS` in `definitions.ts` — redundant with `fields` section in YAML (every field already has `type`)
- `ENTITY_MAPPINGS` — the `key_filters` in YAML serve the same purpose
- Hardcoded dimension field mappings — YAML `fields` section has `meaning` and `type` for each
- The 14 CRITICAL RULES in `agent-prompt.ts` — most are expressible as MCP `rules` with `get_rule()` lookups

### Estimated Complexity

| Phase | Effort | Risk |
|---|---|---|
| Phase 1 (enrich prompt) | Low | Low — additive, no behavior change |
| Phase 2 (externalize definitions) | Medium | Medium — compiler must parse YAML at startup |
| Phase 3 (lint-on-compile) | Low | Low — additive safety net |
| Phase 4 (multi-view) | High | High — new compiler paths, new templates, new test coverage |

---

## File Reference

| File | Role | Lines |
|---|---|---|
| `src/lib/semantic-layer/definitions.ts` | All metric/dimension/date/filter definitions | ~500 |
| `src/lib/semantic-layer/query-templates.ts` | 22+ named query pattern schemas | ~400 |
| `src/lib/semantic-layer/query-compiler.ts` | Deterministic SQL assembly engine | ~2700 |
| `src/lib/semantic-layer/agent-prompt.ts` | Dynamic Claude system prompt builder | ~300 |
| `src/lib/semantic-layer/index.ts` | Barrel re-exports | ~20 |
| `src/lib/semantic-layer/__tests__/query-compiler-validation.ts` | Manual test runner | ~200 |
| `src/lib/semantic-layer/__tests__/validation-examples.ts` | Ground truth Q→template mappings | ~150 |
| `src/app/dashboard/explore/page.tsx` | Server component (auth + render) | ~36 |
| `src/app/dashboard/explore/ExploreClient.tsx` | Client state machine | ~268 |
| `src/app/api/agent/query/route.ts` | API orchestrator | ~645 |
| `src/components/dashboard/ExploreResults.tsx` | Results renderer + drilldown | ~1020 |
| `src/components/dashboard/QueryInspector.tsx` | SQL audit trail panel | ~143 |
| `src/components/dashboard/explore-visualizations.tsx` | Chart renderers | ~300 |
| `src/components/dashboard/ResponseFeedback.tsx` | Thumbs up/down feedback | ~193 |
| `src/lib/utils/sql-helpers.ts` | `generateExecutableSql()` | ~100 |
| `src/types/agent.ts` | Full type contract | ~172 |
| `.claude/schema-config.yaml` | Schema-context MCP configuration | ~686 |
