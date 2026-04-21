# Savvy Analyst Bot — Specification Analysis Report

## 1. Summary

This build produces a conversational AI data analyst Slack bot (`savvy-analyst-bot`) that lives inside the existing Dashboard monorepo as `packages/analyst-bot/`. The bot connects Slack users to the company BigQuery warehouse through the already-deployed `schema-context-mcp` Cloud Run service. It maintains per-thread conversation history in Neon Postgres, generates chart PNGs server-side using `chartjs-node-canvas`, produces on-demand XLSX workbooks via ExcelJS, routes issue reports to a `#data-issues` Slack channel, and writes an append-only audit log to BigQuery. The system is built in two phases: a CLI prototype (Phase 1) for system prompt tuning and behavioral validation, followed by Slack Bolt wrapping with persistence, file uploads, and audit logging (Phase 2). Deployment is a standalone Cloud Run service (`savvy-analyst-bot`) sharing the same GCP project, service account, Neon instance, and BigQuery project as the existing dashboard. The entry point switches between CLI and Slack mode via a `--mode` flag.

---

## 2. Module Inventory

| File Path | Purpose | Public Interface | Internal Dependencies | External Dependencies | Complexity |
|---|---|---|---|---|---|
| `packages/analyst-bot/src/types.ts` | Shared TypeScript types | `ChartRequest`, `WorkbookRequest`, `ConversationMessage`, `AuditRecord`, `IssueReport`, `ThreadState`, `ChartType` | none | none | Small |
| `packages/analyst-bot/src/system-prompt.ts` | System prompt text — single source of truth for Claude's analyst persona and behavioral rules | `getSystemPrompt(): string` | `types.ts` | none | Small |
| `packages/analyst-bot/src/claude.ts` | Claude API client configured with remote MCP server | `callClaude(messages: ConversationMessage[], opts?): Promise<ClaudeResponse>` | `types.ts`, `system-prompt.ts` | `@anthropic-ai/sdk`, `MCP_SERVER_URL`, `MCP_API_KEY`, `ANTHROPIC_API_KEY` | Medium |
| `packages/analyst-bot/src/charts.ts` | Server-side PNG chart rendering from `[CHART]` JSON blocks | `renderChart(req: ChartRequest): Promise<Buffer>`, `parseChartBlock(text: string): ChartRequest \| null` | `types.ts` | `chartjs-node-canvas`, `chart.js` | Medium |
| `packages/analyst-bot/src/xlsx.ts` | On-demand XLSX workbook generation | `generateWorkbook(req: WorkbookRequest): Promise<Buffer>` | `types.ts` | `exceljs` | Medium |
| `packages/analyst-bot/src/thread-store.ts` | Neon Postgres thread state CRUD | `loadThread(threadId: string): Promise<ThreadState \| null>`, `saveThread(state: ThreadState): Promise<void>`, `deleteExpiredThreads(): Promise<void>` | `types.ts` | `pg`, `DATABASE_URL` | Small |
| `packages/analyst-bot/src/audit.ts` | Append-only BigQuery audit log writer | `writeAuditRecord(record: AuditRecord): Promise<void>` | `types.ts` | `@google-cloud/bigquery`, `BIGQUERY_PROJECT`, `AUDIT_DATASET`, `AUDIT_TABLE` | Small |
| `packages/analyst-bot/src/issues.ts` | Issue report formatting and Slack posting to `#data-issues` | `formatIssueReport(details: IssueReport): SlackBlock[]`, `postIssueToChannel(client: SlackWebClient, issue: IssueReport): Promise<void>` | `types.ts` | `@slack/bolt` (WebClient), `ISSUES_CHANNEL`, `MAINTAINER_SLACK_ID` | Small |
| `packages/analyst-bot/src/conversation.ts` | Core conversation engine shared by CLI and Slack | `processMessage(input: string, threadId: string, channelId: string, userId: string): Promise<ConversationResult>` | `types.ts`, `claude.ts`, `charts.ts`, `xlsx.ts`, `thread-store.ts`, `audit.ts`, `issues.ts` | none (orchestrator) | Large |
| `packages/analyst-bot/src/cli.ts` | CLI conversation loop — Phase 1 prototype | `runCLI(): Promise<void>` | `conversation.ts`, `types.ts` | `readline` (Node built-in) | Small |
| `packages/analyst-bot/src/slack.ts` | Slack Bolt app setup and event handlers | `startSlackApp(): Promise<void>` | `conversation.ts`, `types.ts` | `@slack/bolt`, `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_APP_TOKEN`, `ALLOWED_CHANNELS` | Medium |
| `packages/analyst-bot/src/index.ts` | Entry point — mode switch via `--mode cli` or `--mode slack` | N/A (executable) | `cli.ts`, `slack.ts` | `dotenv` | Small |
| `packages/analyst-bot/package.json` | Package manifest with scripts and dependencies | N/A | N/A | All npm deps | Small |
| `packages/analyst-bot/tsconfig.json` | TypeScript compiler config | N/A | N/A | `typescript` | Small |
| `packages/analyst-bot/Dockerfile` | Cloud Run container build | N/A | N/A | `node:20-slim`, system libs for `node-canvas` | Small |
| `packages/analyst-bot/.env` | Local dev environment variables (gitignored) | N/A | N/A | N/A | Small |

---

## 3. Dependency Graph

```
types.ts
  └── (no dependencies — pure type definitions)

system-prompt.ts
  └── types.ts

claude.ts
  ├── types.ts
  └── system-prompt.ts

charts.ts
  └── types.ts

xlsx.ts
  └── types.ts

thread-store.ts
  └── types.ts

audit.ts
  └── types.ts

issues.ts
  └── types.ts

conversation.ts  <── THE HUB
  ├── types.ts
  ├── claude.ts
  ├── charts.ts
  ├── xlsx.ts
  ├── thread-store.ts
  ├── audit.ts
  └── issues.ts

cli.ts
  └── conversation.ts

slack.ts
  └── conversation.ts

index.ts
  ├── cli.ts
  └── slack.ts
```

**Critical path (longest sequential dependency chain):**

```
types.ts → system-prompt.ts → claude.ts → conversation.ts → slack.ts → index.ts
```

6 hops. `conversation.ts` is the integration point that blocks final assembly.

**Modules that can be built in parallel** (no dependencies on each other):

- `charts.ts`, `xlsx.ts`, `thread-store.ts`, `audit.ts`, `issues.ts` — all depend only on `types.ts`. They can all be built concurrently once `types.ts` is complete.
- `cli.ts` and `slack.ts` — both depend only on `conversation.ts`. Once `conversation.ts` is done, both can be written in parallel.

**Circular dependencies:** None detected. The graph is a clean DAG with `types.ts` at the root and `index.ts` at the leaf.

---

## 4. Build Order

### Phase 0 — Scaffold
Create `packages/analyst-bot/` directory with:
- `package.json` (name, scripts: `build`, `cli`, `dev`, `start`, dependencies)
- `tsconfig.json` (target ES2022, outDir `dist`, rootDir `src`, strict)
- `Dockerfile`
- `.env` (gitignored)
- `src/` directory

### Phase 1 — Types and Interfaces
**File:** `packages/analyst-bot/src/types.ts`
Define all shared types before any implementation module:
- `ChartType`, `ChartRequest`, `WorkbookRequest`, `ConversationMessage`, `ThreadState`, `AuditRecord`, `IssueReport`, `ConversationResult`, `ClaudeResponse`

### Phase 2 — Foundation (System Prompt + Claude Client)
**Files:** `system-prompt.ts`, `claude.ts`
Build order: system-prompt.ts first (pure string), then claude.ts (imports system-prompt).

### Phase 3 — Leaf Modules (parallel)
All five depend only on `types.ts`:
- `charts.ts` — chartjs-node-canvas renderer + [CHART] block parser
- `xlsx.ts` — ExcelJS workbook builder
- `thread-store.ts` — pg client wrapping bot_threads table
- `audit.ts` — BigQuery insert wrapper for interaction_log
- `issues.ts` — Slack Block Kit formatter + channel poster

### Phase 4 — CLI Prototype Validation
Build `conversation.ts` (orchestrator), `cli.ts` (thin wrapper), `index.ts` (mode switch).
Run CLI and tune system prompt iteratively.

### Phase 5 — Slack Deployment
Build `slack.ts`. Wire Slack Bolt event handlers, file uploads, reaction handler, channel allowlist.

### Phase 6 — Integration and Deployment
Wire everything into index.ts. Create BQ audit table and Neon bot_threads table.
Build Docker image, deploy to Cloud Run.

---

## 5. Interface Contracts

### claude.ts → conversation.ts
`callClaude(messages: ConversationMessage[], opts?) → Promise<ClaudeResponse>`
ClaudeResponse must carry: raw text, tool call records, SQL statements, bytes scanned, error.

### charts.ts → conversation.ts
`parseChartBlock(text: string) → ChartRequest | null` then `renderChart(req: ChartRequest) → Promise<Buffer>`
Chart failures must not block text response.

### xlsx.ts → conversation.ts
`generateWorkbook(req: WorkbookRequest) → Promise<Buffer>`

### thread-store.ts → conversation.ts
`loadThread(threadId) → Promise<ThreadState | null>`, `saveThread(state: ThreadState) → Promise<void>`

### audit.ts → conversation.ts
`writeAuditRecord(record: AuditRecord) → Promise<void>` — non-fatal, log and continue.

### issues.ts → conversation.ts and slack.ts
`formatIssueReport(details: IssueReport) → SlackBlock[]`, `postIssueToChannel(client, issue) → Promise<void>`
Slack WebClient should be injected by slack.ts for testability.

### conversation.ts → cli.ts / slack.ts
`processMessage(input, threadId, channelId, userId) → Promise<ConversationResult>`
ConversationResult: `{ text, chartBuffer, xlsxBuffer, chartType, isIssueReport, issueDetails, exportTrigger }`

---

## 6. Spec Gaps

1. **`ClaudeResponse` type not defined** — Must carry text, toolCalls, sqlExecuted, bytesScanned, error
2. **`ConversationResult` type not defined** — Must carry text, chartBuffer, xlsxBuffer, chartType, isIssueReport, issueDetails, exportTrigger
3. **Thread ID strategy** — Use `channel_id + ":" + thread_ts` for global uniqueness
4. **🚩 emoji reaction context retrieval** — Use `conversations.history` with `latest=ts&inclusive=true&limit=1`
5. **ExcelJS "embedded chart" limitation** — ExcelJS cannot create live Excel chart objects, only insert PNG images via `addImage()`
6. **userId in CLI mode** — Default to `"cli@local"` or `process.env.USER + "@local"`
7. **Thread TTL cleanup mechanism** — Expose `POST /internal/cleanup` endpoint, schedule via Cloud Scheduler
8. **users.info caching** — Cache `Map<string, string>` in-process, no expiry
9. **Bot error response format** — Post "Sorry, I ran into a technical issue: [error]" to thread
10. **Socket mode vs HTTP mode** — HTTP for production (Cloud Run), socket mode for local dev
11. **pg pool size** — Set `max: 3` to avoid Neon connection exhaustion
12. **Stacked bar example missing from system prompt** — Add multi-dataset example
13. **`mcp_servers` parameter format** — `[{ type: "url", url, name, authorization_token }]`
14. **Audit record `id` generation** — Use `crypto.randomUUID()`
15. **DM handling** — Ignore DMs unless DM channel is in ALLOWED_CHANNELS

---

## 7. Decision Inventory (Already Made — Do Not Re-Litigate)

| Decision | What Was Decided |
|---|---|
| Runtime | Node.js 20 (Dockerfile base) |
| Slack framework | @slack/bolt |
| Claude SDK | @anthropic-ai/sdk |
| MCP transport | Remote HTTP (Cloud Run URL + API key) |
| Chart library | chartjs-node-canvas + chart.js |
| XLSX library | ExcelJS |
| Thread persistence | Neon Postgres, same instance as dashboard |
| Audit log | BigQuery, append-only |
| Chart-vs-XLSX default | Charts default; XLSX on-demand only |
| Chart size | 800x500px |
| Chart output | PNG buffer |
| [CHART] block format | JSON between [CHART] and [/CHART] tags |
| Architecture | conversation.ts shared engine; cli.ts and slack.ts thin wrappers |
| Mode flag | --mode cli / --mode slack |
| Package structure | Self-contained packages/analyst-bot/ |
| Deployment | Cloud Run, us-central1, --min-instances=1, --timeout=300 |
| Thread TTL | 48 hours |
| Pie chart limit | 6 categories max |
| Row threshold for XLSX | 20 rows |

---

## 8. Risks

1. **node-canvas native dependency build failures (HIGH)** — System libs required in Docker. Windows local dev may need WSL or Docker-only chart testing.
2. **Anthropic SDK mcp_servers API stability (MEDIUM)** — Relatively new feature, verify exact parameter shape against current SDK version.
3. **ExcelJS "embedded chart" false expectation (MEDIUM)** — Can only embed PNG images, not live Excel charts.
4. **Neon connection exhaustion (MEDIUM)** — Multiple Cloud Run instances + default pool sizes could hit limits.
5. **Slack files.uploadV2 token scopes (LOW-MEDIUM)** — Required scopes: app_mentions:read, channels:history, channels:read, chat:write, files:write, reactions:read, users:read, users:read.email.
6. **Cold start latency for charts (LOW)** — Mitigated by --min-instances=1.
7. **System prompt size and token budget (LOW)** — Cap messages sent to Claude at most recent 20 exchanges.
8. **Day 2 polish items at risk** — XLSX embedded charts, emoji handler, Block Kit refinement, audit verification.
