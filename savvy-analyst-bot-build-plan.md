# Savvy Data Analyst Bot: Build Plan

## What We're Building

A conversational AI data analyst that lives in Slack. It connects to our BigQuery warehouse through our existing schema-context-mcp remote server (already deployed on Cloud Run), maintains conversation context across Slack threads, asks clarifying questions when requests are ambiguous, executes queries, editorializes on what the numbers mean, suggests logical follow-up questions, **automatically generates charts (bar, pie, line) inline with every data response**, and provides an issue reporting flow that alerts the schema config maintainer when something looks wrong. XLSX workbooks with formulas are available on demand when users explicitly request a data export or when the result set is too large for a Slack thread.

## Existing Infrastructure (Already Deployed)

- **schema-context-mcp remote server**: Running on Cloud Run. URL and API key available from the dashboard. Handles all warehouse queries, schema context, linting, metric definitions, and health checks. SELECT-only enforcement, dataset allowlist, cost cap, audit logging already in place.
- **GCP Service Account**: Already configured for Google Sheets generation with @savvywealth.com domain locking. Reuse for BigQuery audit log writes and any other GCP interactions the bot needs.
- **Neon Postgres**: Already running. Use for thread state persistence.
- **BigQuery**: Warehouse is live. Audit log table needs to be created but the project and permissions exist.

## Architecture

```
Slack Thread
    ↓
Bot Server (Node.js, Slack Bolt)
    ↓
Thread History Store (Neon Postgres)
    ↓
Claude API
    ├── mcp_servers: [schema-context-mcp remote URL]
    ├── Tools: describe_view, get_metric, lint_query,
    │         resolve_term, list_views, health_check, execute_sql
    └── System prompt: analyst persona + guardrails
    ↓
Responses posted back to Slack thread
    ↓
Chart images (PNG) generated and attached automatically
    ↓
XLSX workbooks attached on demand (explicit request or large result sets)
    ↓
Issue reports posted to #data-issues channel
    ↓
Audit log appended to BigQuery
```

## Build Order

### Phase 1: CLI Prototype (Morning, Day 1)

Build the conversation engine as a terminal application. No Slack. This is where we tune the system prompt, validate answer quality, and nail the editorial and follow-up behavior.

**What to build:**

1. **Conversation loop.** Read user input from stdin, send to Claude API with MCP server attached, print response, repeat. Maintain message history in an array in memory.

2. **Claude API integration with remote MCP.** Every call to Claude includes `mcp_servers` pointing at our Cloud Run schema-context-mcp URL with the API key. Claude calls `describe_view`, `get_metric`, `lint_query`, `execute_sql` etc. as needed to answer questions.

3. **System prompt.** This is the most important piece. See the System Prompt Specification section below for the full behavioral requirements.

4. **Response formatting.** Even in the CLI, format responses with the same structure they'll have in Slack: results, chart (saved to local file in CLI), editorial, suggested follow-up, issue reporting prompt. Validate that the format is consistent and useful.

5. **Chart generation.** Build the `charts.ts` module using `chartjs-node-canvas`. Takes structured query results and renders PNG images. Claude determines chart type based on the data shape and includes a chart with every data response by default. See Charts Generation Details section below. In the CLI, charts save to local files for visual verification.

6. **Issue reporting flow.** When the user types "report issue," Claude shifts into issue-gathering mode: asks what looks wrong, what they expected, how critical it is. Summarizes the issue and prints it to console. In Phase 2 this posts to Slack instead.

7. **XLSX export to local file.** When the user explicitly asks for a data export ("export xlsx," "give me a spreadsheet," "csv," "excel file," "data export," "send me the raw data") or when a result set exceeds 20 rows (too much for a Slack thread), generate an XLSX workbook from the query results. Save to a local file. Validate that formulas, formatting, and multi-tab output work correctly before wiring into Slack.

**Exit criteria for Phase 1:** You can have a multi-turn conversation in the terminal, get correct answers with charts, editorial and follow-ups, report an issue, and export an XLSX with formulas when explicitly requested. You trust the answers and the charts accurately represent the data.

### Phase 2: Slack Deployment (Afternoon Day 1 + Day 2)

Wrap the proven conversation engine in Slack Bolt. Add persistence, file uploads, issue routing, and audit logging.

**What to build:**

1. **Slack Bolt app.** Event handlers for `app_mention` and `message` events in threads. The bot responds when mentioned in a channel or when a user replies in an existing bot thread.

2. **Thread state persistence in Neon.** Table schema: `thread_id (text, PK)`, `channel_id (text)`, `messages (jsonb)`, `created_at (timestamptz)`, `updated_at (timestamptz)`. On each incoming message: load thread history, append user message, send to Claude, append Claude response, save. TTL: expire threads older than 48 hours (audit log retains everything permanently).

3. **Message formatting for Slack.** Convert Claude's response into Slack Block Kit or mrkdwn format. The response structure for every data answer:

```
📊 [Results section]
Tables, numbers, breakdowns.

[chart image attached — bar, pie, or line depending on data shape]

💡 [Editorial]
Two to three sentences interpreting the data.

🔎 [Suggested follow-up]
A specific, context-aware next question.

———
📎 "export xlsx" for a workbook with formulas
🚩 "report issue" if something looks off
```

4. **Chart images uploaded to Slack.** On every data response, the bot generates a chart PNG using `chartjs-node-canvas` and uploads it to the thread using `files.uploadV2`. The chart type is determined by Claude based on the data shape (see Charts Generation Details). Charts are the default visual. They are always included unless the response contains no quantitative data.

5. **XLSX export uploaded to Slack (on demand only).** XLSX workbooks are NOT generated by default. They are generated and uploaded only when:
   - The user explicitly requests it: "export xlsx," "give me a spreadsheet," "csv," "excel file," "data export," "send me the raw data," "download this," "sheet"
   - The result set exceeds 20 rows, making it too large for readable Slack output. In this case, the bot presents a summary and chart in-thread and automatically attaches the full dataset as an XLSX: "Full dataset attached as XLSX — too many rows to display inline."
   - The user requests an audit trail or "show me all the queries" with large output
   
   The XLSX includes formulas, formatting, and multi-tab layout per the XLSX Generation Details section.

5. **Issue reporting to #data-issues channel.** When the user triggers issue reporting, Claude gathers the issue details in-thread, then the bot posts a structured summary to a dedicated #data-issues channel. The summary includes:
   - Link to the original Slack thread
   - The original question
   - The SQL that was executed
   - The results that were returned
   - Schema context tools called and their responses
   - User's description of what looks wrong
   - What they expected
   - Severity
   - User email and timestamp
   - @mention of the schema config maintainer (you)

6. **🚩 Emoji reaction handler.** If a user reacts with 🚩 on any bot message, trigger the issue reporting flow in-thread. Same as typing "report issue" but faster.

7. **Audit logging to BigQuery.** One table, append-only. Every interaction logged with:
   - `thread_id`, `channel_id`, `user_email`
   - `timestamp`
   - `user_message` (verbatim)
   - `assistant_response` (verbatim)
   - `tool_calls` (JSON array of MCP tool calls made: tool name, parameters, response summary)
   - `sql_executed` (JSON array of SQL queries run)
   - `bytes_scanned` (total across all queries)
   - `chart_generated` (boolean)
   - `chart_type` ("bar", "pie", "line", or null)
   - `export_generated` (boolean)
   - `export_type` ("xlsx" or null)
   - `export_trigger` ("explicit_request", "large_result_set", or null)
   - `is_issue_report` (boolean)
   - `issue_details` (JSON, null if not an issue)
   - `error` (any errors encountered)

8. **Access control.** Channel allowlist: the bot only responds in configured channel IDs. All other channels are ignored. User identification: resolve Slack user ID to email via `users.info` API for audit logging.

9. **Cloud Run deployment.** Deploy from `packages/analyst-bot/` as its own Cloud Run service (`savvy-analyst-bot`) in the same GCP project as schema-context-mcp. See the Deployment section for the full `gcloud run deploy` command. Secrets via Secret Manager, non-secret config as env vars.

---

## System Prompt Specification

The system prompt defines Claude's behavior as a data analyst. This is the single most important piece of the build. All behavioral requirements below must be encoded in the system prompt.

### Identity

You are a data analyst for a financial services company. You have access to the company's BigQuery data warehouse through MCP tools. You are careful, precise, and transparent about your methodology. You never guess. You never fabricate numbers. You are not a chatbot. You are an analyst.

### Pre-Query Requirements (Non-Negotiable)

Before writing any SQL:
1. Call `describe_view` with an `intent` parameter to get schema context, dangerous columns, warnings, and key filters for the view you plan to query.
2. Call `get_metric` when the user references a named metric (conversion rate, pipeline volume, etc.) to get the exact computation logic, mode guidance, and gotchas.
3. After writing SQL but before executing, call `lint_query` to check your SQL against configured rules. If lint returns errors, fix the SQL and re-lint before executing.

Never skip these steps. Never write SQL from memory or assumption. The MCP tools are the source of truth for how to query this warehouse correctly.

### Clarification Behavior

Ask clarifying questions when the request is ambiguous. Common ambiguity patterns to check for:
- **Time period**: trailing 90 days, specific quarter, YTD, MTD, custom range?
- **Mode**: cohort (based on when records entered a stage) or period (based on when events happened)?
- **Scope**: full funnel or specific stages? All channels or specific channels?
- **Metric definition**: which conversion (stage A to stage B)? Volume or value?
- **Exclusions**: include or exclude re-engagement records? Include or exclude specific record types?

Do not ask more than three clarifying questions at once. Prioritize the questions that would most change the query. If the request is unambiguous, proceed without asking.

### Response Format

Every response that includes quantitative data must follow this structure:

**📊 Results**: The data. Numbers, tables, breakdowns. Clean and scannable.

**📈 Chart**: A chart is included with every data response by default. You determine the chart type based on the data shape:
- **Bar chart**: categorical comparisons (channel breakdown, stage-by-stage, source distribution). This is the most common.
- **Pie chart**: composition/share data where parts sum to a whole (channel mix as percentage of total, stage distribution). Use only when there are 6 or fewer categories. More than 6 and pie charts become unreadable. Fall back to bar.
- **Line chart**: time series data (weekly trends, monthly progression, quarter-over-quarter). Any data with a time axis.
- **Stacked bar**: when showing composition across multiple groups (channel mix per quarter, stage breakdown by source).

If the data is a single number (e.g., "what's our conversion rate?"), no chart. If the data has two or more comparable values, chart it.

Include chart specification in your response as a structured JSON block tagged with `[CHART]` so the bot application can extract it and render it. Format:
```json
[CHART]
{
  "type": "bar",
  "title": "SQO by Channel — Q2 2026",
  "labels": ["Organic", "Paid Search", "Referral", "Partner", "Other"],
  "datasets": [
    {
      "label": "SQO Count",
      "values": [38, 29, 18, 6, 3]
    }
  ]
}
[/CHART]
```

For line charts, labels are time periods. For pie charts, only one dataset. For stacked bar, multiple datasets. The bot application handles rendering. You handle choosing the right chart type and structuring the data correctly.

**💡 Editorial**: Two to three sentences interpreting the data. What's notable, what's trending, what stands out, what a smart analyst would flag. Grounded in the data just returned. Never speculative. Never invented.

**🔎 Suggested follow-up**: One specific, context-aware question the user might want to ask next. Based on what the data just revealed. Not generic. Examples:
- If one channel is outperforming: "Want me to drill into Referral to see what's driving the outperformance?"
- If numbers are early in a period: "These will keep moving as Q2 progresses. Want me to compare against Q1 at the same point in the quarter?"
- If a conversion rate changed significantly: "That's a notable shift from last quarter. Want me to break down what changed?"

**Footer** (always present):
```
———
📎 "export xlsx" for a workbook with formulas
🚩 "report issue" if something looks off
```

### Assumption Transparency

Every answer must state the key assumptions applied:
- What filters were used (dedup flags, record type exclusions, date ranges)
- What mode was used (cohort vs. period)
- What records were excluded and why
- Any caveats (recent data may be incomplete, numbers will change as records progress)

### XLSX Export Behavior (On Demand Only)

XLSX workbooks are NOT generated by default. Charts are the default visual output. XLSX is generated only when:

1. **Explicit user request**: The user says "export xlsx," "give me a spreadsheet," "csv," "excel file," "data export," "send me the raw data," "download this," "sheet," or similar.
2. **Large result sets**: The query returns more than 20 rows, making inline display impractical. In this case, present a summary and chart in-thread and note: "Full dataset attached as XLSX — too many rows to display inline."
3. **Audit trail requests**: The user asks to see all queries and results from a complex multi-step analysis where the output would overwhelm the thread.

When generating XLSX, the workbook should include:
- **Bold header row** with column names
- **Number formatting**: integers with comma separators, percentages with one decimal, currency with two decimals where applicable
- **Formula row at the bottom**: `SUM` for volume columns, weighted average or overall rate for percentage columns, `COUNT` for record counts
- **Conversion rate formulas**: when showing stage-to-stage data, include a column with formulas like `=B2/C2` that compute the rate from the raw numbers so the user can modify inputs and see updated rates
- **Multiple tabs** when the conversation produced multiple related analyses (e.g., Tab 1: Stage Summary, Tab 2: Channel Breakdown, Tab 3: Raw Records)
- **Descriptive tab names** based on the analysis content
- **Auto-sized columns** where the library supports it
- **Chart embedded in the workbook** matching the chart that was displayed in Slack, so the XLSX is self-contained

### Issue Reporting Behavior

When the user says "report issue," "this doesn't look right," "flag this," or reacts with 🚩:

1. Acknowledge: "Got it, let me capture this."
2. Ask three targeted questions:
   - "What looks wrong? Wrong numbers, missing records, unexpected results, or something else?"
   - "What were you expecting, and where does that expectation come from? A dashboard, a prior report, a manual count?"
   - "Is this blocking something right now, or something to investigate when we can?"
3. Summarize the issue and confirm with the user before filing.
4. The bot application handles posting to #data-issues and alerting the maintainer. Claude just needs to produce the structured issue summary.

### Guardrails

- Never fabricate numbers. If a query returns no results, say so.
- Never invent metric definitions. If `get_metric` doesn't have it, say "I don't have a configured definition for that metric. Can you describe how it should be calculated?"
- Never skip `describe_view` before writing SQL. Even if you think you know the schema.
- Never present results without stating assumptions.
- If a query errors, show the error, explain what likely went wrong, and offer to try a different approach. Do not silently retry with different SQL.

---

## Charts Generation Details

Charts are the default visual output for every data response. The `charts.ts` module renders PNG images server-side using `chartjs-node-canvas` (Chart.js running on a Node canvas). No browser required. The module receives structured chart data from Claude's response, renders a PNG buffer, and returns it for upload to Slack or save to disk.

**Library:** `chartjs-node-canvas` (wraps Chart.js + node-canvas)

**Install:**
```bash
npm install chartjs-node-canvas chart.js
```

**Chart Types and When to Use Them:**

| Chart Type | Data Shape | Example |
|---|---|---|
| **Bar** | Categorical comparison, ranked values | SQO by channel, pipeline by stage, volume by source |
| **Horizontal Bar** | Categorical comparison with long labels | Conversion rate by source name, activity by SGA |
| **Pie / Doughnut** | Composition where parts sum to whole, ≤6 categories | Channel mix percentage, stage distribution |
| **Line** | Time series, trends, progression | Weekly lead volume, monthly conversion rate, Q/Q trends |
| **Stacked Bar** | Composition across multiple groups | Channel mix per quarter, stage breakdown by source |

**Input format (parsed from Claude's `[CHART]` block):**

```typescript
interface ChartRequest {
  type: "bar" | "horizontalBar" | "pie" | "doughnut" | "line" | "stackedBar";
  title: string;
  labels: string[];  // x-axis labels (categories or time periods)
  datasets: Array<{
    label: string;   // legend label
    values: number[];
  }>;
  options?: {
    showPercentages?: boolean;   // add % labels to pie/doughnut
    showValues?: boolean;        // add value labels to bars
    yAxisLabel?: string;         // e.g., "Count", "Conversion Rate (%)"
    xAxisLabel?: string;         // e.g., "Quarter", "Channel"
  };
}
```

**Output:** A Buffer containing the PNG image (800x500px default, adjustable).

**Styling defaults:**
- Clean white background
- Consistent color palette across all charts (a fixed array of 8 colors so charts look cohesive across a conversation)
- Title at the top, bold, 16px
- Legend below the title when multiple datasets
- Value labels on bars when ≤10 categories
- Percentage labels on pie/doughnut slices
- Grid lines on line and bar charts, subtle gray
- No 3D effects, no gradients, no decorative elements. Clean and professional.

**Parsing Claude's response:** The bot application scans Claude's response for `[CHART]...[/CHART]` blocks, extracts the JSON, passes it to `charts.ts`, gets back a PNG buffer, strips the `[CHART]` block from the text response before posting to Slack, and uploads the PNG as an attached image. The user sees the text response with a chart image inline.

**Edge cases:**
- If Claude's chart JSON is malformed, log the error, skip the chart, post the text response without it. Never block a response because the chart failed.
- If the data has more than 8 categories for a pie chart, the system prompt instructs Claude to use a bar chart instead, but if it still comes through as pie, the charts module should fall back to bar automatically.
- Single-value responses (just one number) get no chart. Claude handles this in the system prompt.

---

## XLSX Generation Details

Use a Node.js Excel library (ExcelJS or similar). The generation logic should be a standalone module that accepts structured data and produces a workbook buffer that can be saved to disk (CLI) or uploaded to Slack (production).

**Input format:**

```typescript
interface WorkbookRequest {
  title: string; // Used for filename: "SQL_to_SQO_by_Channel_Q1_2026.xlsx"
  sheets: Array<{
    name: string; // Tab name: "Stage Summary", "Channel Breakdown"
    columns: Array<{
      header: string;
      key: string;
      type: "string" | "number" | "percent" | "currency";
    }>;
    rows: Record<string, any>[]; // Data rows
    includeTotal: boolean; // Add a SUM/AVG formula row at bottom
    formulaColumns?: Array<{
      header: string;
      formula: string; // Excel formula template, e.g., "=B{row}/C{row}"
      type: "percent" | "number";
    }>;
  }>;
}
```

**Output:** A Buffer containing the XLSX file, ready to write to disk or upload to Slack.

---

## Database Schema (Neon Postgres)

These tables are created in the existing Neon instance. The bot connects using the same `DATABASE_URL` as other services.

### Thread State Table

```sql
CREATE TABLE bot_threads (
  thread_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  messages JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bot_threads_updated ON bot_threads (updated_at);
```

The `messages` column stores the full conversation history as a JSON array of `{role, content}` objects. This is what gets sent to Claude on each turn.

### Thread Cleanup

A scheduled job (cron or Cloud Scheduler) runs daily and deletes threads where `updated_at < NOW() - INTERVAL '48 hours'`. The audit log in BigQuery retains everything permanently.

---

## BigQuery Audit Log Schema

```sql
CREATE TABLE IF NOT EXISTS `your_project.bot_audit.interaction_log` (
  id STRING NOT NULL,
  thread_id STRING NOT NULL,
  channel_id STRING NOT NULL,
  user_email STRING NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  user_message STRING NOT NULL,
  assistant_response STRING,
  tool_calls JSON,
  sql_executed JSON,
  bytes_scanned INT64,
  chart_generated BOOL DEFAULT FALSE,
  chart_type STRING,
  export_generated BOOL DEFAULT FALSE,
  export_type STRING,
  export_trigger STRING,
  is_issue_report BOOL DEFAULT FALSE,
  issue_details JSON,
  error STRING
);
```

---

## Issue Report Structure

When an issue is filed, the bot posts to #data-issues with this structure:

```
🚩 Data Issue Report

Reporter: @jane.smith
Thread: [link to original Slack thread]
Severity: [Non-urgent / Needs attention / Blocking]
Timestamp: 2026-04-10 14:32 EST

Question asked: "What's our SQL-to-SQO conversion for Q2?"

What looks wrong: Total SQO count (94) seems low compared
to Q1 pacing at the same point in the quarter.

Expected: Higher than Q1's 89 SQOs at comparable point,
based on increased top-of-funnel volume.

Schema context used:
• describe_view("vw_funnel_master", intent: "conversion_rate")
• get_metric("sql_to_sqo", mode: "cohort")
• Dedup: is_sqo_unique = 1
• Filter: recordtypeid exclusion applied

SQL executed:
[attached or inline]

@russell.moss for review
```

The same data is written to the BigQuery audit log with `is_issue_report: true`.

---

## Environment Variables

Secrets go in GCP Secret Manager and are mounted at deploy time. Non-secret config goes as plain env vars. For local dev, use a `.env` file in `packages/analyst-bot/` (gitignored).

```
# Slack
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SLACK_APP_TOKEN=xapp-... (if using socket mode for dev)

# Claude
ANTHROPIC_API_KEY=sk-ant-...

# schema-context-mcp remote server
MCP_SERVER_URL=https://schema-context-mcp-abc123-uc.a.run.app/mcp
MCP_API_KEY=sk-savvy-...

# Neon Postgres
DATABASE_URL=postgresql://...

# BigQuery
BIGQUERY_PROJECT=your-project-id
AUDIT_DATASET=bot_audit
AUDIT_TABLE=interaction_log

# Bot config
ALLOWED_CHANNELS=C01ABC,C02DEF
ISSUES_CHANNEL=C03GHI
MAINTAINER_SLACK_ID=U04JKL

# GCP (inherited from Cloud Run SA or explicit)
GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json
```

---

## File Structure

The bot lives inside the existing Dashboard repo as a self-contained package. It has its own `package.json`, `tsconfig.json`, and `Dockerfile` so it builds and deploys independently, but it shares the same git history, PR workflow, and context-ledger precedents as the dashboard.

```
C:\Users\russe\Documents\Dashboard\
├── src/                              # existing dashboard code
├── packages/
│   └── analyst-bot/
│       ├── src/
│       │   ├── index.ts              # Entry point: CLI mode or Slack mode based on flag
│       │   ├── cli.ts                # CLI conversation loop (Phase 1)
│       │   ├── slack.ts              # Slack Bolt app setup and event handlers
│       │   ├── conversation.ts       # Core conversation engine (shared by CLI and Slack)
│       │   ├── claude.ts             # Claude API client with MCP server config
│       │   ├── system-prompt.ts      # System prompt text (single source of truth)
│       │   ├── charts.ts             # Chart PNG generation (chartjs-node-canvas)
│       │   ├── xlsx.ts               # XLSX workbook generation module (on-demand)
│       │   ├── thread-store.ts       # Neon Postgres thread state CRUD
│       │   ├── audit.ts              # BigQuery audit log writer
│       │   ├── issues.ts             # Issue report formatting and posting to Slack
│       │   └── types.ts              # Shared TypeScript types (ChartRequest, WorkbookRequest, etc.)
│       ├── .env                      # Environment variables (gitignored)
│       ├── package.json
│       ├── tsconfig.json
│       └── Dockerfile
├── package.json                      # existing root package.json
└── ...
```

The key architectural decision: `conversation.ts` contains all the logic for managing conversation state, calling Claude, handling tool responses, parsing `[CHART]` blocks from Claude's response and routing them to `charts.ts` for rendering, detecting export requests, and detecting issue reports. Both `cli.ts` and `slack.ts` are thin wrappers that handle I/O (terminal vs. Slack) and call into the shared conversation engine. This means everything you prove in the CLI works identically in Slack.

---

## Deployment

The bot deploys as its own Cloud Run service in the same GCP project as the schema-context-mcp remote server. It is a separate service from the dashboard. The dashboard serves the web UI. The bot serves Slack events. They share the same GCP project, the same service account, the same Neon database, and the same BigQuery project.

### Building and deploying from the subdirectory

Cloud Build and Cloud Run need to know the Dockerfile lives in a subdirectory. The build context is the `packages/analyst-bot/` directory, not the repo root.

```bash
# From the repo root
cd packages/analyst-bot

# Build and deploy
gcloud run deploy savvy-analyst-bot \
  --source . \
  --region us-central1 \
  --set-secrets="SLACK_BOT_TOKEN=SLACK_BOT_TOKEN:latest" \
  --set-secrets="SLACK_SIGNING_SECRET=SLACK_SIGNING_SECRET:latest" \
  --set-secrets="ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest" \
  --set-secrets="MCP_API_KEY=MCP_API_KEY:latest" \
  --set-secrets="DATABASE_URL=DATABASE_URL:latest" \
  --set-env-vars="MCP_SERVER_URL=https://schema-context-mcp-abc123-uc.a.run.app/mcp" \
  --set-env-vars="BIGQUERY_PROJECT=your-project-id" \
  --set-env-vars="AUDIT_DATASET=bot_audit" \
  --set-env-vars="AUDIT_TABLE=interaction_log" \
  --set-env-vars="ALLOWED_CHANNELS=C01ABC,C02DEF" \
  --set-env-vars="ISSUES_CHANNEL=C03GHI" \
  --set-env-vars="MAINTAINER_SLACK_ID=U04JKL" \
  --min-instances=1 \
  --timeout=300
```

`--min-instances=1` keeps one instance warm so Slack events don't hit cold start delays. Costs roughly $0.50/day. Worth it for responsive bot behavior.

`--timeout=300` gives 5 minutes per request, enough for complex multi-query conversations where Claude makes several MCP tool calls before responding.

### Dockerfile

The Dockerfile builds only the bot package. It does not include the dashboard code.

```dockerfile
FROM node:20-slim

# node-canvas dependencies for chartjs-node-canvas
RUN apt-get update && apt-get install -y \
  build-essential \
  libcairo2-dev \
  libpango1.0-dev \
  libjpeg-dev \
  libgif-dev \
  librsvg2-dev \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY dist/ ./dist/

USER node

CMD ["node", "dist/index.js"]
```

Note the system dependencies for `node-canvas` (required by `chartjs-node-canvas`). These must be in the Docker image or chart generation will fail.

### Local development

```bash
cd packages/analyst-bot

# Install dependencies
npm install

# Run CLI mode for system prompt iteration
npm run cli

# Run Slack mode locally (requires ngrok or Slack socket mode)
npm run dev
```

`package.json` scripts:

```json
{
  "scripts": {
    "build": "tsc",
    "cli": "node dist/index.js --mode cli",
    "dev": "node dist/index.js --mode slack",
    "start": "node dist/index.js --mode slack"
  }
}
```

The `--mode` flag lets you switch between CLI (for iteration) and Slack (for production) from the same entry point. In Cloud Run, it always runs in Slack mode.

---

## Day 1 Plan

**Morning:**
1. Scaffold `packages/analyst-bot/` in the Dashboard repo. `npm init`, install dependencies (Slack Bolt, Anthropic SDK, chartjs-node-canvas, chart.js, ExcelJS, pg). Set up `tsconfig.json` and the `--mode` flag in `index.ts`.
2. Write `system-prompt.ts` first. This is the brain. Include chart type selection logic and the `[CHART]` block format.
3. Build `conversation.ts` and `claude.ts`. Get Claude calling your remote MCP server and returning answers.
4. Build `cli.ts`. Have a working terminal conversation.
5. Build `charts.ts`. Parse Claude's `[CHART]` blocks, render PNGs, save to local files in CLI mode. Validate bar, pie, and line charts on real query results.
6. Iterate on the system prompt until the editorial, follow-ups, clarification behavior, and chart type selection are solid.

**Afternoon:**
1. Build `slack.ts`. Wire up Slack Bolt event handlers.
2. Build `thread-store.ts`. Thread persistence in Neon.
3. Wire chart PNG uploads into Slack responses (attach image to every data response).
4. Build `issues.ts`. Issue reporting flow posting to #data-issues.
5. Build `audit.ts`. Audit log writes to BigQuery.
6. Test full flow in a test Slack channel.
7. Deploy to Cloud Run from `packages/analyst-bot/`.

**Day 2 (polish):**
1. Build `xlsx.ts`. On-demand only, triggered by explicit request or result sets >20 rows. Include embedded charts in workbooks.
2. Response formatting refinement in Slack (Block Kit or mrkdwn).
3. System prompt tuning based on real team conversations.
4. Chart styling polish (color palette consistency, label positioning, edge cases).
5. Edge case handling (long responses, large result sets, malformed chart JSON fallback, error formatting).
6. Add the 🚩 emoji reaction handler.
7. Verify audit log captures everything needed (including chart_type and export_trigger).
