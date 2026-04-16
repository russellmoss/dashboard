# Savvy Analyst Bot — Architecture & Operations Guide

## What It Is

A conversational AI data analyst that lives in Slack. Users @mention the bot with natural language questions about the recruiting funnel, pipeline, conversion rates, etc. The bot queries BigQuery through an MCP (Model Context Protocol) server, returns formatted answers with charts, generates XLSX exports on demand, and routes data issue reports to the dashboard request board.

---

## Architecture Overview

```
Slack Channel (@mention or thread reply)
    |
    v
Cloud Run: savvy-analyst-bot (us-east1)
    |
    ├── Loads thread history from Neon Postgres
    ├── Calls Claude API (Anthropic) with remote MCP server attached
    |       |
    |       └── Claude calls MCP tools server-side:
    |               describe_view, get_metric, lint_query,
    |               resolve_term, list_views, execute_sql
    |               |
    |               v
    |           Cloud Run: savvy-mcp-server (us-east1)
    |               |
    |               v
    |           BigQuery (savvy-gtm-analytics)
    |
    ├── Parses response: text, [CHART] blocks, [XLSX] blocks, [ISSUE] blocks
    ├── Renders chart PNG (chartjs-node-canvas)
    ├── Generates XLSX workbook (ExcelJS)
    ├── Posts response + chart + XLSX to Slack thread
    ├── Saves thread state to Neon Postgres
    ├── Writes audit record to BigQuery (bot_audit.interaction_log)
    └── Creates DashboardRequest + BigQuery issue if [ISSUE] block detected
```

---

## Cloud Run Services

| Service | URL | Region | Purpose |
|---------|-----|--------|---------|
| savvy-analyst-bot | https://savvy-analyst-bot-154995667624.us-east1.run.app | us-east1 | Slack bot — receives events, processes queries |
| savvy-mcp-server | https://savvy-mcp-server-154995667624.us-east1.run.app | us-east1 | MCP server — schema context, query execution |

### Accessing Logs

```bash
# Bot logs (verbose output when VERBOSE=true)
gcloud run services logs read savvy-analyst-bot --region us-east1 --limit 50

# Detailed logs with severity filtering
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=savvy-analyst-bot" \
  --project=savvy-gtm-analytics --limit=30 --format="table(timestamp,textPayload)" --freshness=10m

# MCP server logs
gcloud run services logs read savvy-mcp-server --region us-east1 --limit 50

# Errors only
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=savvy-analyst-bot AND severity>=ERROR" \
  --project=savvy-gtm-analytics --limit=20 --freshness=1h
```

### Service Configuration

```bash
# View current env vars and secrets
gcloud run services describe savvy-analyst-bot --region us-east1 --format="yaml(spec.template.spec.containers[0].env)"

# Update an env var
gcloud run services update savvy-analyst-bot --region us-east1 --set-env-vars="KEY=value"

# Update a secret (add new version, Cloud Run picks up :latest automatically)
echo -n "new-secret-value" | gcloud secrets versions add SECRET_NAME --project=savvy-gtm-analytics --data-file=-
```

---

## How MCP Works

The bot uses Anthropic's **server-side MCP connector** — a beta API feature where Claude connects to a remote MCP server over HTTP and executes tools autonomously within a single API call.

### The Flow

1. Bot calls `client.beta.messages.create()` with `mcp_servers` parameter pointing at the MCP Cloud Run URL
2. Claude reads the system prompt, sees the user's question, and decides which MCP tools to call
3. The Anthropic API connects to `savvy-mcp-server` over HTTP, passes the tool call
4. MCP server executes the tool (e.g., runs a BigQuery query) and returns results
5. Claude sees the results, may call more tools, then produces the final text response
6. The entire tool-call loop happens server-side — the bot receives one response with all `mcp_tool_use` and `mcp_tool_result` blocks

### API Call Shape

```typescript
const response = await client.beta.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 8192,
  betas: ['mcp-client-2025-04-04'],
  system: systemPrompt,
  messages: conversationHistory,
  mcp_servers: [{
    type: 'url',
    url: 'https://savvy-mcp-server-e2vyxy5ipa-ue.a.run.app/mcp',
    name: 'schema-context',
    authorization_token: 'sk-savvy-...',
  }],
});
```

### MCP Tools Available

| Tool | Purpose |
|------|---------|
| `describe_view` | Get schema context, dangerous columns, key filters for a view |
| `get_metric` | Get computation logic for named metrics (conversion rates, etc.) |
| `lint_query` | Validate SQL against configured rules before execution |
| `resolve_term` | Map business terms to field names and rules |
| `list_views` | Discover all available views/tables |
| `execute_sql` | Run a SELECT query against BigQuery |
| `health_check` | Check for drift between annotations and live schema |

### MCP API Key

Generated via the dashboard at Settings > MCP Key Management. The key is stored in GCP Secret Manager as `MCP_API_KEY` and passed to Claude as the `authorization_token`. The MCP server validates it against the `mcp_api_keys` table in Neon.

---

## Schema Configuration

The MCP server's behavior is governed by `.claude/schema-config.yaml` in the dashboard repo. This file defines:

- **Which datasets/views are available** and their purpose
- **Key filters** (dedup rules, record type exclusions)
- **Dangerous columns** (fields that produce wrong results if misused)
- **Metric definitions** (how to compute conversion rates, etc.)
- **Mode guidance** (cohort vs. period mode defaults)

### File Location

```
C:\Users\russe\Documents\Dashboard\.claude\schema-config.yaml
```

### Updating the Schema

1. Edit `.claude/schema-config.yaml` — add/modify view annotations, metrics, rules
2. The MCP server reads this at startup. To deploy changes:
   ```bash
   cd mcp-server
   cp ../.claude/schema-config.yaml .
   gcloud run deploy savvy-mcp-server --source . --region us-east1
   ```
3. The bot doesn't need redeployment — it calls MCP tools at runtime, so schema changes take effect immediately after the MCP server redeploys

### Key Schema Sections

```yaml
defaults:
  preferred_conversion_mode: cohort    # Cohort mode by default for conversion rates

views:
  vw_funnel_master:
    purpose: "Single source of truth for the recruiting funnel"
    grain: "One row per lead-opportunity combination"
    key_filters:
      active_sqos: "is_sqo_unique = 1 AND recordtypeid = '012Dn000000mrO3IAI'"
    dangerous_columns:
      is_sqo: "Use is_sqo_unique instead for volume counts"
    metrics:
      sql_to_sqo:
        numerator: "is_sqo_unique = 1"
        denominator: "is_sql = 1"
        mode: cohort
```

---

## MCP API Key Management & Team Access

The MCP server isn't just used by the analyst bot — it's a shared infrastructure service that any team member can use from their own tools (Claude Code, Codex CLI, Cursor, custom scripts, etc.) to query the BigQuery warehouse with full schema context.

### How API Keys Work

```
User (dashboard UI) → Generate Key → sk-savvy-<random hex>
                                           |
                                    SHA-256 hash stored in
                                    Neon mcp_api_keys table
                                           |
User puts key in .mcp.json → Claude Code / Codex / etc.
                                           |
                                    Request hits MCP server →
                                    SHA-256(bearer token) →
                                    O(1) indexed DB lookup →
                                    Authenticated ✓
```

Keys use the `sk-savvy-` prefix and are hashed with SHA-256 (not bcrypt) for O(1) indexed database lookup. The plaintext key is shown once at generation and never stored or retrievable again.

### Generating a Key (Admin)

1. Go to **Dashboard > Settings > User Management**
2. Find the user, click the **database icon** (MCP Key)
3. The user must have **BigQuery Access** enabled (`bqAccess: true`)
4. Click **Generate API Key** — the plaintext `sk-savvy-...` key appears once
5. Click **Download .mcp.json** — downloads a ready-to-use config file

### The `.mcp.json` File

The downloaded file looks like this:

```json
{
  "mcpServers": {
    "savvy-bq": {
      "type": "http",
      "url": "https://savvy-mcp-server-e2vyxy5ipa-ue.a.run.app/mcp",
      "headers": {
        "Authorization": "Bearer sk-savvy-<their-key>"
      }
    }
  }
}
```

### Setting Up for a Team Member

1. **Enable BigQuery access**: Dashboard > Settings > User Management > toggle BQ Access on
2. **Generate their MCP key**: click the database icon, generate, download `.mcp.json`
3. **Team member places `.mcp.json`** in their project root (for Claude Code) or home directory

#### For Claude Code / Claude Desktop

Place `.mcp.json` in the project root or `~/.claude/`:

```bash
# Project-level (recommended)
cp .mcp.json ~/Documents/my-project/.mcp.json

# Or user-level
cp .mcp.json ~/.claude/.mcp.json
```

Claude Code automatically discovers `.mcp.json` and connects to the MCP server. The user can then use MCP tools directly:
- `describe_view("vw_funnel_master", intent: "conversion rate")`
- `get_metric("sql_to_sqo")`
- `execute_sql("SELECT COUNT(*) FROM ...")`

#### For Codex CLI

```bash
# Place in project root
cp .mcp.json ./.mcp.json

# Codex auto-discovers MCP servers from .mcp.json
codex "What's our SQO count by channel?"
```

#### For Cursor / Other Tools

Add the MCP server configuration in the tool's settings. The URL and auth header are all that's needed:

```
URL:    https://savvy-mcp-server-e2vyxy5ipa-ue.a.run.app/mcp
Header: Authorization: Bearer sk-savvy-<key>
```

### Key Lifecycle

| Action | API Route | Who Can Do It |
|--------|-----------|---------------|
| Generate | `POST /api/users/[id]/mcp-key` | Admin (canManageUsers) |
| Revoke | `DELETE /api/users/[id]/mcp-key` | Admin |
| Rotate | `POST /api/users/[id]/mcp-key/rotate` | Admin |

- Generating a new key **automatically revokes** any existing active key for that user
- Rotation is atomic (revoke + create in a transaction)
- Revoked keys are kept in the database with `revokedAt` timestamp for audit trail
- `lastUsedAt` is updated on every authenticated MCP request (fire-and-forget)

### Database Schema

```sql
-- Neon Postgres: mcp_api_keys table
CREATE TABLE mcp_api_keys (
  id          TEXT PRIMARY KEY,
  userId      TEXT NOT NULL REFERENCES "User"(id),
  key         TEXT UNIQUE NOT NULL,    -- SHA-256 hash of the plaintext key
  isActive    BOOLEAN DEFAULT true,
  createdAt   TIMESTAMPTZ DEFAULT now(),
  revokedAt   TIMESTAMPTZ,
  label       TEXT,
  lastUsedAt  TIMESTAMPTZ
);
```

### Authentication Flow (MCP Server)

```
1. Request arrives at MCP server with Authorization: Bearer sk-savvy-...
2. Server extracts the bearer token
3. Validates prefix: must start with "sk-savvy-"
4. Computes SHA-256 hash of the token
5. Queries: SELECT FROM mcp_api_keys WHERE key = $hash AND isActive = true
6. JOINs User table to verify user isActive and bqAccess = true
7. Updates lastUsedAt (fire-and-forget)
8. Returns { email, apiKeyId } — used for audit logging
```

### Security Notes

- Keys are **never stored in plaintext** — only the SHA-256 hash
- The plaintext is shown **once** at generation, then gone forever
- All MCP queries are **SELECT-only** — the server enforces this
- All queries are **audit-logged** to BigQuery `savvy_analytics.mcp_audit_log` with user email, query text, bytes scanned
- Dataset allowlist restricts which BigQuery datasets can be queried
- Cost cap prevents runaway queries

### Who Has Access

Any dashboard user with `bqAccess: true` can have an MCP key generated for them. Check current access:

```bash
# From the bot's Neon connection
node -e "
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
pool.query('SELECT name, email, role, \\\"bqAccess\\\" FROM \\\"User\\\" WHERE \\\"bqAccess\\\" = true AND \\\"isActive\\\" = true ORDER BY name')
  .then(r => r.rows.forEach(u => console.log(u.name, u.email, u.role)))
  .then(() => pool.end());
"
```

---

## Source Code Structure

```
packages/analyst-bot/
  src/
    index.ts              Entry point — --mode cli | --mode slack
    cli.ts                CLI conversation loop (local testing)
    slack.ts              Slack Bolt app (production)
    conversation.ts       Core engine — orchestrates everything
    claude.ts             Claude API client with MCP + retry + timeout
    system-prompt.ts      System prompt (analyst persona, rules, formatting)
    charts.ts             Chart PNG rendering (chartjs-node-canvas + datalabels)
    xlsx.ts               XLSX workbook generation (ExcelJS)
    thread-store.ts       Neon Postgres thread CRUD
    audit.ts              BigQuery audit log writer
    issues.ts             Slack Block Kit issue formatting
    dashboard-request.ts  DashboardRequest + BigQuery issue tracker
    types.ts              All shared TypeScript types
  package.json
  tsconfig.json
  Dockerfile
  .env                    Local secrets (gitignored)
  .env.example            Template
```

### Module Dependency Graph

```
types.ts (no deps — pure types)
  |
  ├── system-prompt.ts
  |     └── claude.ts (imports system-prompt)
  |
  ├── charts.ts
  ├── xlsx.ts
  ├── thread-store.ts
  ├── audit.ts
  ├── issues.ts
  ├── dashboard-request.ts
  |
  └── conversation.ts (THE HUB — imports all above)
        |
        ├── cli.ts
        └── slack.ts
              |
              └── index.ts
```

---

## Conversation Flow (conversation.ts)

1. **Load thread** — fetch from Neon by `channel:thread_ts` ID
2. **Append user message** to history
3. **Call Claude** with MCP server attached (8K tokens default, 16K for export requests)
4. **Parse response** — strip narration (text before last tool result), extract text
5. **Chart**: if `[CHART]` block found, render PNG via chartjs-node-canvas
6. **XLSX**: if user requested export OR Claude produced `[XLSX]` block, parse and generate workbook
7. **Issue**: if user said "report issue" OR Claude produced `[ISSUE]` block, create DashboardRequest + BigQuery issue
8. **Save thread** to Neon (truncated to last 40 messages)
9. **Write audit** to BigQuery `bot_audit.interaction_log` (fire-and-forget)
10. **Return** text + chart buffer + XLSX buffer to the Slack/CLI handler

---

## Slack Integration (slack.ts)

### Architecture: Ack-Fast Pattern

Slack requires HTTP 200 within 3 seconds. Claude + MCP takes 30-60 seconds. Solution:
- **Do NOT use `processBeforeResponse: true`** — Bolt acks immediately
- Cloud Run runs with **`--no-cpu-throttling`** to keep CPU alive after ack
- Event deduplication via in-memory Set prevents double-processing on Slack retries

### Event Handlers

| Event | Trigger | Behavior |
|-------|---------|----------|
| `app_mention` | @bot in a channel | Start new thread, process question |
| `message` | Reply in bot thread | Continue conversation in existing thread |
| `reaction_added` | Flag emoji on any bot message | Trigger issue reporting flow |

### Formatting

Claude outputs Slack `mrkdwn` natively (single `*bold*`, backtick code). The `toSlackMrkdwn()` function handles conversion as a safety net:
- `**bold**` to `*bold*`
- Markdown tables wrapped in triple backtick code blocks
- `[text](url)` to `<url|text>`
- `---` to `---`

### Allowed Channels

Only responds in channel IDs listed in `ALLOWED_CHANNELS` env var (comma-separated). Currently: `C0A6YL0EBH6,C0ASC9GCW02,C0APUB35TQU`.

---

## Charts (charts.ts)

Server-side PNG rendering using `chartjs-node-canvas` v5 + `chart.js` v4 + `chartjs-plugin-datalabels`.

### Features

- **Value labels on bars** — every bar shows its numeric value (formatted: K for thousands, M for millions)
- **Y-axis label** — derived from dataset label or explicit `yAxisLabel` option
- **Type mapping**: `horizontalBar` to `bar` + `indexAxis:'y'`, `stackedBar` to `bar` + stacked scales
- **Pie safety**: >6 categories auto-falls back to bar chart
- **8-color palette**: consistent across all charts in a conversation
- **Single global renderer** instance for memory efficiency

### Chart Block Format

Claude embeds chart specs as `[CHART]...[/CHART]` JSON blocks in its response. The bot parses, renders, strips the block from text, and uploads the PNG to the Slack thread.

---

## XLSX Export (xlsx.ts + conversation.ts)

### Trigger Conditions

1. **User asks**: regex matches "xlsx", "excel", "spreadsheet", "csv", "export", "download", "raw data", etc.
2. **Claude decides**: response contains `[XLSX]` block (e.g., result set > 20 rows)

### Generation

Claude produces an `[XLSX]` JSON block with `headers`, `rows` (array-of-arrays), and `format_hints`. The normalizer in `conversation.ts` converts this to our `WorkbookRequest` type:
- Headers to `ColumnDef[]` with type detection from `format_hints`
- Array rows to keyed objects
- Strings starting with `=` become Excel formulas
- Total rows detected (prevents double totals)
- Chart PNG embedded via `addImage()`

### Token Budget

Export requests use 16K tokens (vs 8K default) so Claude has room to write large `[XLSX]` JSON blocks without truncation.

---

## Issue Reporting

### Flow

1. User says "report issue" or reacts with flag emoji
2. Claude asks: What looks wrong? What did you expect? How urgent? (Low/Medium/High)
3. User provides details, confirms
4. Claude produces `[ISSUE]` JSON block
5. Bot creates:
   - **DashboardRequest** in Neon (type: DATA_ERROR, user-selected priority)
   - **BigQuery `bot_audit.issues`** row (current state)
   - **BigQuery `bot_audit.issue_events`** row (created event)
6. Card appears on dashboard at `/dashboard/requests`

### Dashboard Sync

When you interact with a bot-created issue card on the dashboard:
- **Status change** (e.g., Submitted to Planned to In Progress): updates `bot_audit.issues` row + appends `status_change` event
- **Comment added**: touches `bot_audit.issues.updated_at` + appends `comment` event

Only bot-created issues sync (IDs starting with `cbot_`). Non-bot issues are unaffected.

### BigQuery Issue Tables

```sql
-- Current state of all bot issues
SELECT * FROM bot_audit.issues;

-- Full audit trail for a specific issue
SELECT * FROM bot_audit.issue_events
WHERE dashboard_request_id = 'cbot_...'
ORDER BY created_at;

-- Summary view with comment counts and recent activity
SELECT * FROM bot_audit.issue_summary;
```

---

## Audit Logging

Every bot interaction is logged to `bot_audit.interaction_log`:

| Field | Description |
|-------|-------------|
| `thread_id` | `channel:thread_ts` |
| `user_email` | Resolved from Slack user ID |
| `user_message` | Verbatim input |
| `assistant_response` | Bot's text reply |
| `tool_calls` | JSON array of MCP tools called |
| `sql_executed` | JSON array of SQL queries run |
| `bytes_scanned` | BigQuery bytes processed |
| `chart_generated` | Whether a chart was rendered |
| `chart_type` | bar, pie, line, etc. |
| `export_generated` | Whether XLSX was created |
| `is_issue_report` | Whether this was an issue filing |

```sql
-- Recent bot interactions
SELECT timestamp, user_email, SUBSTR(user_message, 1, 80), chart_type, export_generated
FROM bot_audit.interaction_log
ORDER BY timestamp DESC
LIMIT 20;
```

---

## Thread Persistence

Thread state is stored in Neon Postgres table `bot_threads`:

```sql
CREATE TABLE bot_threads (
  thread_id TEXT PRIMARY KEY,       -- channel:thread_ts
  channel_id TEXT NOT NULL,
  messages JSONB NOT NULL DEFAULT '[]',  -- full conversation history
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

- Conversation history is truncated to **40 messages** (20 exchanges) before saving
- Threads expire after **48 hours** (cleanup via Cloud Scheduler or `/internal/cleanup` endpoint)
- The `messages` JSONB stores the full Claude content block array for assistant turns, preserving MCP tool call context

---

## Environment Variables

### Secrets (GCP Secret Manager)

| Secret | Purpose |
|--------|---------|
| `SLACK_BOT_TOKEN` | Slack bot OAuth token (`xoxb-...`) |
| `SLACK_SIGNING_SECRET` | Verifies Slack HTTP requests |
| `ANTHROPIC_API_KEY` | Claude API key |
| `MCP_API_KEY` | Authentication token for the MCP server |
| `DATABASE_URL` | Neon Postgres connection string |
| `CLEANUP_SECRET` | Auth token for `/internal/cleanup` endpoint |

### Plain Env Vars (Cloud Run)

| Variable | Value |
|----------|-------|
| `MCP_SERVER_URL` | `https://savvy-mcp-server-e2vyxy5ipa-ue.a.run.app/mcp` |
| `BIGQUERY_PROJECT` | `savvy-gtm-analytics` |
| `AUDIT_DATASET` | `bot_audit` |
| `AUDIT_TABLE` | `interaction_log` |
| `ALLOWED_CHANNELS` | `C0A6YL0EBH6,C0ASC9GCW02,C0APUB35TQU` |
| `ISSUES_CHANNEL` | `C0ATMP48BUY` |
| `MAINTAINER_SLACK_ID` | `U09DX3U7UTW` |
| `VERBOSE` | `true` |

---

## Deployment

### Redeploy the Bot

```bash
# 1. Bump source-bust line in Dockerfile to invalidate Docker cache
# 2. Build and push image
cd packages/analyst-bot
gcloud builds submit --config=cloudbuild.yaml --project=savvy-gtm-analytics .

# 3. Deploy image only — preserves existing secrets and env vars
gcloud run deploy savvy-analyst-bot --project=savvy-gtm-analytics --region=us-east1 \
  --image=gcr.io/savvy-gtm-analytics/analyst-bot:latest
```

> **WARNING**: Do NOT use `--set-secrets` or `--set-env-vars` unless intentionally reconfiguring the service. These flags overwrite ALL existing values. The secrets (SLACK_BOT_TOKEN, ANTHROPIC_API_KEY, etc.) are already configured on the Cloud Run service via Secret Manager references.

### Redeploy the MCP Server

The MCP server bundles `.claude/schema-config.yaml` — the single source of truth for field definitions, rules, and glossary terms. If you updated that file, redeploy:

```bash
bash mcp-server/deploy.sh
```

The script copies `.claude/schema-config.yaml` into the build context, builds the image, deploys to Cloud Run, and cleans up.

### Local Development

```bash
cd packages/analyst-bot
cp .env.example .env   # Fill in real values
npm install
npm run build

# CLI mode (no Slack needed)
npm run cli

# Slack socket mode (needs SLACK_APP_TOKEN in .env)
npm run dev
```

### Dockerfile

The Docker build:
1. Installs system deps for node-canvas (cairo, pango, jpeg, gif, rsvg)
2. `npm ci` all dependencies (including devDependencies for tsc)
3. Compiles TypeScript (`npm run build`)
4. Prunes devDependencies (`npm prune --production`)
5. Runs `node dist/index.js --mode slack`

---

## System Prompt

Located at `src/system-prompt.ts`. Key behavioral rules:

1. **Pre-query requirements**: Always call `describe_view` and `get_metric` before writing SQL. Always `lint_query` before executing.
2. **Cohort mode default**: Use cohort mode for conversion rates unless user explicitly asks for period mode.
3. **No narration**: Never say "Let me check the schema" — go straight to results.
4. **Response format**: Results, Chart, Editorial, Suggested follow-up, Footer.
5. **Slack mrkdwn**: Single `*bold*`, tables in code blocks, backtick field names.
6. **Priority on issues**: Ask for Low/Medium/High when reporting issues.

---

## Troubleshooting

### Bot doesn't respond

1. Check logs: `gcloud run services logs read savvy-analyst-bot --region us-east1 --limit 20`
2. Look for "Calling Claude with MCP server..." — if stuck there, Claude/MCP is timing out (90s limit)
3. Check if the channel is in `ALLOWED_CHANNELS`
4. Check Slack Event Subscriptions are enabled at api.slack.com

### MCP server timeout

Claude returns 400 with "Connection to MCP server timed out." The MCP server may be cold-starting. The bot retries once on 400 errors. If persistent, check MCP server logs.

### Chart rendering fails

Charts require system libraries (cairo, pango). If chart fails, text response still posts. Check for "Chart render failed" in logs.

### XLSX truncated

If the `[XLSX]` block is missing `[/XLSX]`, Claude ran out of tokens. Export requests use 16K tokens but very large datasets (200+ rows) may still truncate. The bot falls back to parsing markdown tables from the response.

### Thread history issues

Old thread context can cause Claude to follow stale patterns. Clear with:
```bash
node -e "require('pg'); /* delete from bot_threads where thread_id = '...' */"
```
