# Infrastructure Scout Findings — Savvy Analyst Bot

**Investigation date**: 2026-04-10
**Target build**: `packages/analyst-bot/` inside `C:\Users\russe\Documents\Dashboard`

---

## 1. Summary

**What already exists and can be reused:**
- Anthropic SDK (`@anthropic-ai/sdk` ^0.71.2) installed at root
- `exceljs` ^4.4.0 installed at root
- `@google-cloud/bigquery` ^7.9.4 installed at root
- `schema-context-mcp` remote server deployed at `https://savvy-mcp-server-e2vyxy5ipa-ue.a.run.app`
- GCP service account already configured (`dashboard-bigquery-reader@savvy-gtm-analytics.iam.gserviceaccount.com`)
- Neon Postgres live and accessible (DATABASE_URL confirmed in Cloud Run env)
- `ANTHROPIC_API_KEY` documented in `.env.example`
- `DATABASE_URL` documented in `.env.example`
- Logger utility, BigQuery client factory, Prisma connection patterns — all reusable by reference
- Existing BigQuery audit log writer (`mcp-server/src/audit.ts`) as a direct pattern template
- Raw `pg` pool pattern for Postgres without Prisma (`mcp-server/src/auth.ts`)

**What is missing and needs to be created:**
- `packages/` directory does not exist
- No workspace/monorepo configuration in root `package.json`
- `@slack/bolt`, `chartjs-node-canvas`, `chart.js`, `pg` — not installed anywhere in the repo
- `bot_threads` table — does not exist in Neon Postgres schema
- `bot_audit.interaction_log` table — does not exist in BigQuery
- Slack app — not created, no SLACK_BOT_TOKEN or SLACK_SIGNING_SECRET in `.env.example`
- `savvy-analyst-bot` Cloud Run service — does not exist
- Secret Manager API — disabled on `savvy-gtm-analytics` project (blocker for deployment)
- `MCP_SERVER_URL` and `MCP_API_KEY` — not in `.env.example`
- `BIGQUERY_PROJECT`, `AUDIT_DATASET`, `AUDIT_TABLE`, `ALLOWED_CHANNELS`, `ISSUES_CHANNEL`, `MAINTAINER_SLACK_ID` — not in `.env.example`

---

## 2. Reusable Code

| File path | What it does | How to reuse | Notes |
|---|---|---|---|
| `src/lib/logger.ts` | Structured logger with env-based log levels | Copy class into bot's own `logger.ts` — no external deps, trivially portable | Cannot import directly (Next.js path alias) |
| `src/lib/bigquery.ts` | `getBigQueryClient()` singleton + `runQuery<T>()` + `buildQueryParams()` | Copy `getBigQueryClient` pattern into bot's `audit.ts` | Bot only needs BQ client for audit writes, not analytics queries |
| `mcp-server/src/audit.ts` | Fire-and-forget BigQuery append-only audit writer | Direct copy-and-adapt into bot's `audit.ts` — identical pattern | Uses `@google-cloud/bigquery` ^7.0.0 |
| `mcp-server/src/auth.ts` | Raw `pg.Pool` connected to `DATABASE_URL` with SSL | Copy pool init pattern into bot's `thread-store.ts` | Bot needs `pg` directly, not Prisma |
| `src/app/api/agent/query/route.ts` | Full `@anthropic-ai/sdk` usage: client init, `messages.create`, retry logic with exponential backoff | Reference for bot's `claude.ts` — retry loop and message assembly directly reusable | Bot adds `mcp_servers` config not present in dashboard |
| `src/lib/semantic-layer/agent-prompt.ts` | `generateAgentSystemPrompt()` | Structural reference for `system-prompt.ts` | Content entirely different |

**Key note:** The dashboard calls Claude without remote MCP servers (uses a local semantic layer). The bot is the first code in this repo to use `mcp_servers`. No existing pattern for that call shape.

---

## 3. Database Status

### Neon Postgres
- **Connection**: Verified. DATABASE_URL is live.
- **`bot_threads` table**: Does not exist. Not in Prisma schema (17 models, none is bot_threads).
- **Required DDL**: `CREATE TABLE bot_threads (...)` — see spec for full schema.
- **Migration approach**: Raw SQL (not Prisma) — the bot uses raw `pg`, not Prisma ORM.
- **Connection pooling**: Neon pooled endpoint in use. Bot should use same with `ssl: { rejectUnauthorized: false }`, pool `max: 3-5`.

### BigQuery
- **Connection**: Verified via Cloud Run. `savvy-gtm-analytics` project live.
- **Service account**: `dashboard-bigquery-reader@savvy-gtm-analytics.iam.gserviceaccount.com` has BQ insert permissions (confirmed by existing `mcp_audit_log` writes).
- **`bot_audit` dataset and `interaction_log` table**: Do not exist. Must be created.

---

## 4. Cloud Services Status

| Service | Status | Notes |
|---|---|---|
| `savvy-mcp-server` Cloud Run | ✅ Exists | URL: `https://savvy-mcp-server-e2vyxy5ipa-ue.a.run.app`, Region: `us-east1` |
| `savvy-analyst-bot` Cloud Run | ❌ Does not exist | Must be created. Spec targets `us-central1` but MCP server is in `us-east1` — consider aligning regions |
| Secret Manager API | ❌ Disabled | Must be enabled before deployment. Spec uses `--set-secrets` which requires it |
| Cloud Scheduler | ❓ Unknown | Needed for daily thread cleanup cron |
| GCP Service Account | ✅ Exists | May need `bigquery.tables.create` permission for `bot_audit` dataset |
| Slack App | ❌ Does not exist | Must create at api.slack.com with proper event subscriptions and OAuth scopes |

---

## 5. NPM Packages

| Package | Required | Available in repo | Notes |
|---|---|---|---|
| `@slack/bolt` | Yes | No | Must install. Current stable: 4.x. Works with CJS and ESM |
| `@anthropic-ai/sdk` | Yes | Root ^0.71.2 | Bot declares own dependency. `mcp_servers` supported since >= 0.27.0 |
| `chartjs-node-canvas` | Yes | No | Native deps: libcairo2, libpango, libjpeg, libgif, librsvg2. Windows needs WSL or Docker |
| `chart.js` | Yes | No | Peer dep of chartjs-node-canvas. Stable: 4.x |
| `exceljs` | Yes | Root ^4.4.0 | Bot declares own copy |
| `pg` | Yes | mcp-server ^8.12.0 | Bot needs own install. Use ^8.x |
| `@google-cloud/bigquery` | Yes | Root ^7.9.4 | Bot declares own copy |
| `dotenv` | Yes | Root ^16.3.1 | Bot declares own |
| `typescript` | Yes (dev) | Root ^5.9.3 | Bot uses own tsconfig |

**Windows local dev concern**: `chartjs-node-canvas` / `node-canvas` requires native libraries. Either use WSL, install Visual Studio Build Tools + cairo, or test charts only in Docker.

**Node version**: Root requires `>=22.0.0 <23.0.0`. Local Node is 24.14.0 (outside range). Bot should declare `"engines": { "node": ">=20.0.0" }` to match Dockerfile (`node:20-slim`).

---

## 6. Environment Variables

| Variable | In .env.example | Provision via | Type |
|---|---|---|---|
| `SLACK_BOT_TOKEN` | No | Secret Manager | Secret |
| `SLACK_SIGNING_SECRET` | No | Secret Manager | Secret |
| `SLACK_APP_TOKEN` | No | Secret Manager (dev only) | Secret |
| `ANTHROPIC_API_KEY` | Yes | Already available | Secret |
| `MCP_SERVER_URL` | Partially | Plain env var. Value: `https://savvy-mcp-server-e2vyxy5ipa-ue.a.run.app/mcp` | Plain |
| `MCP_API_KEY` | No | Secret Manager. Generate via dashboard MCP Key Management | Secret |
| `DATABASE_URL` | Yes | Already available | Secret |
| `BIGQUERY_PROJECT` | Yes (as GCP_PROJECT_ID) | Plain. Value: `savvy-gtm-analytics` | Plain |
| `AUDIT_DATASET` | No | Plain. Value: `bot_audit` | Plain |
| `AUDIT_TABLE` | No | Plain. Value: `interaction_log` | Plain |
| `ALLOWED_CHANNELS` | No | Plain. Configure after Slack app creation | Plain |
| `ISSUES_CHANNEL` | No | Plain. #data-issues channel ID | Plain |
| `MAINTAINER_SLACK_ID` | No | Plain. Your Slack user ID | Plain |
| `GOOGLE_APPLICATION_CREDENTIALS` | Yes | Cloud Run: inherited. Local: path to SA key | Local dev |

---

## 7. Project Compatibility

| Concern | Root Dashboard | mcp-server | Bot (to create) |
|---|---|---|---|
| Node version | >=22.0.0 <23.0.0 | Not pinned | >=20.0.0 (Docker: node:20-slim) |
| Module system | CJS (no `"type"`) | ESM (`"type": "module"`) | ESM (match mcp-server) |
| TS target | ES2017 | ES2022 | ES2022 |
| TS module | ESNext + bundler | ESNext + node | ESNext + node |
| Path aliases | `@/*` → `./src/*` | None | None |
| `noEmit` | true | false (outputs to dist/) | false (outputs to dist/) |
| Strict | true | true | true |
| Package manager | npm | npm | npm |

**Bot cannot import from `src/` directly** — root uses `"noEmit": true` and Next.js-specific module resolution. Shared code must be copied.

---

## 8. Provisioning Checklist (Ordered)

1. **Enable Secret Manager API** on `savvy-gtm-analytics` GCP project (blocker)
2. **Create Slack app** at api.slack.com — configure events, scopes, install to workspace
3. **Generate MCP API key** via dashboard Settings > MCP Key Management
4. **Create `bot_threads` table** in Neon Postgres (DDL in spec)
5. **Create `bot_audit` dataset and `interaction_log` table** in BigQuery
6. **Create `packages/analyst-bot/` directory** with package.json, tsconfig.json, Dockerfile, .env
7. **Install bot dependencies** via npm install
8. **Verify connectivity** — MCP server URL, DATABASE_URL, ANTHROPIC_API_KEY
9. **Create secrets in Secret Manager** — SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, etc.
10. **Decide Cloud Run region** — align with us-east1 (where MCP server is) or keep us-central1
