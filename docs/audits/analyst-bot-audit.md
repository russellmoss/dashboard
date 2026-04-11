# Feature Audit: Savvy Analyst Bot

**Audited**: 2026-04-11
**Requested by**: Russell Moss — ensure optimal UX, data presentation, and Slack interaction quality
**Status**: Reviewed by Council (Codex GPT-5.4 + Gemini 3.1 Pro)
**Codebase**: `packages/analyst-bot/src/` — 14 files, 2,952 lines

---

## Executive Summary

The Savvy Analyst Bot is a well-architected Slack-based BI tool that lets Savvy Wealth employees ask natural-language questions about their recruiting funnel and get tables, charts, XLSX exports, and file issue reports. The core engine (Claude API + MCP + BigQuery) works. However, the audit uncovered **3 critical data accuracy bugs** that silently break audit trails and can produce overstated metrics, **several performance issues** (no BQ export timeout, sequential uploads), and a **Slack UX that underutilizes Block Kit** — leaving significant interaction quality on the table. The single biggest improvement opportunity is fixing the broken telemetry pipeline (`sql_executed` always empty, `bytes_scanned` always zero) and surfacing query provenance to users, which simultaneously improves data trust, debugging, and issue triage.

---

## Feature Overview

### What It Does

A Slack bot where employees @mention it with natural-language questions about the recruiting funnel (pipeline, SGA performance, conversions, AUM). Claude generates BigQuery SQL via MCP tools, executes queries, and returns formatted results as Slack messages with optional chart PNGs, XLSX workbook exports, and issue report filing to a dashboard kanban.

### Architecture

```
User @mention in Slack
  → Slack Bolt event handler (slack.ts)
    → processMessage() (conversation.ts)
      → callClaude() with MCP beta (claude.ts)
        → Claude calls schema_context, describe_table, execute_sql via remote MCP server
      → parseClaudeResponse(): strip narration, extract text/tool records
      → Parse [CHART], [XLSX], [EXPORT_SQL], [ISSUE] blocks
      → Render Chart.js PNG, generate XLSX workbook
      → Write audit record to BigQuery (fire-and-forget)
      → Save thread to Neon Postgres
    → handleResponse(): toSlackMrkdwn → extractTableSnippets → splitSlackMessage
      → Post text chunks → Upload file snippets → Upload chart/XLSX → Swap reactions
```

### Key Files

| File | Lines | Purpose |
|------|-------|---------|
| `slack.ts` | 788 | Slack Bolt app, event handlers, mrkdwn formatting, message splitting, table snippet extraction |
| `conversation.ts` | 591 | Core engine: Claude call → parse all block types → audit → thread save |
| `claude.ts` | 222 | Claude API client with MCP beta, retry, timeout, narration stripping |
| `charts.ts` | 221 | Chart.js PNG rendering (bar, line, pie, stacked, horizontal) |
| `system-prompt.ts` | 193 | Full system prompt with formatting rules, business definitions, guardrails |
| `dashboard-request.ts` | 174 | Issue filing to dashboard API + BigQuery sync |
| `types.ts` | 169 | All TypeScript interfaces |
| `xlsx.ts` | 153 | XLSX workbook generation with ExcelJS |
| `issues.ts` | 93 | Slack Block Kit formatting for #data-issues channel |
| `thread-store.ts` | 85 | Neon Postgres thread persistence (48h TTL) |
| `bq-query.ts` | 72 | Direct BigQuery query execution for [EXPORT_SQL] |
| `cli.ts` | 72 | CLI mode for local testing |
| `audit.ts` | 61 | BigQuery audit log writes |
| `index.ts` | 58 | Entry point |

---

## Enhancement Opportunities

### Priority 1: Fix Broken Telemetry Pipeline — Data Accuracy
**Impact**: High | **Effort**: Small | **Risk**: Low

**Current state**: `sql_executed` is ALWAYS empty in the audit log (124/124 records). `claude.ts` checks `block.input?.sql` but the MCP tool parameter is named `query`. `bytes_scanned` is also always zero — MCP returns `bytesProcessed` but the parser looks for `bytes_scanned`. Developers cannot debug data accuracy issues, and query provenance is invisible to users and issue reports.

**Proposed improvement**: Fix both field name mismatches. Surface a provenance footer in Slack responses showing query count and bytes scanned. Pre-populate `sqlExecuted` into modal-filed issue reports by querying the audit log by thread ID at filing time.

**Implementation sketch**: In `claude.ts` line 164, change `block.input?.sql` to `block.input?.query`. Change the bytes regex to match `bytesProcessed`. Pass `sqlExecuted` and `bytesScanned` through to `handleResponse()` and append a context line to the last text chunk.

---

### Priority 2: Align System Prompt with Actual MCP Tools — Data Accuracy
**Impact**: High | **Effort**: Small | **Risk**: Low

**Current state**: System prompt references `describe_view`, `get_metric`, and `lint_query` as "MANDATORY" tools — none exist on the MCP server. Claude silently skips all pre-query validation. The SGA attribution rule only mentions `task_executor_name` as an example, so Claude doesn't apply the User table join when grouping by `SGA_Owner_Name__c` or `Opp_SGA_Name__c`. This caused a confirmed **13.4 percentage point overstatement** in a production query.

**Proposed improvement**: Rewrite the system prompt to reference the actual tools (`schema_context`, `execute_sql`, `describe_table`, `list_tables`). Explicitly enumerate ALL SGA name columns requiring User joins. Consider adding the missing tools to the MCP server long-term.

**Implementation sketch**: In `system-prompt.ts`, replace all `describe_view`/`get_metric`/`lint_query` references with "call `schema_context` with no term parameter for full context." Expand the SGA filter rule to explicitly list `SGA_Owner_Name__c`, `Opp_SGA_Name__c`, and `task_executor_name`.

---

### Priority 3: Overhaul Slack UX with Block Kit & Progressive Loading — UI/UX
**Impact**: High | **Effort**: Medium | **Risk**: Low

**Current state**: All responses are plain `text:` with mrkdwn formatting. No structured sections, no interactive buttons, no progress updates during long queries. Suggested follow-ups are plain text users must retype. "Export xlsx" and "report issue" are footer text, not buttons. Pie charts have no data labels (unreadable as static PNGs). The working message shows once and then silence for up to 5 minutes.

**Proposed improvement**: Refactor `handleResponse` to use Block Kit sections. Add interactive follow-up suggestion buttons. Add "Export XLSX" and "Report Issue" action buttons. Enable pie/doughnut data labels. Use `chat.update` for staged progress updates during long queries. Wire `showPercentages` into Chart.js config.

**Implementation sketch**: Replace `chat.postMessage({ text })` with `chat.postMessage({ blocks: [...sections, ...actions] })`. Add a `setTimeout` at 60s mark that calls `chat.update` on the working message with a progress indicator. Add button click handlers that post the button text as a new message in the thread.

---

### Priority 4: Route Exports Through MCP & Add BQ Timeout — Performance/Security
**Impact**: High | **Effort**: Medium | **Risk**: Medium

**Current state**: `[EXPORT_SQL]` blocks go directly to BigQuery via `bq-query.ts`, bypassing the MCP server's validation, LIMIT injection, 1GB byte cap, and audit logging. No `jobTimeoutMs` on the export query — a runaway query blocks the bot indefinitely. The council flagged this as the biggest security/safety gap.

**Proposed improvement**: Add `jobTimeoutMs: 120_000` to `bq-query.ts`. Long-term, route exports through the MCP server's `execute_sql` tool (or add an `execute_export_sql` tool) to get validation and audit coverage.

**Implementation sketch**: Immediate fix: add `jobTimeoutMs: 120_000` to the `bq.query()` call in `bq-query.ts`. For MCP routing, modify `runExportQuery()` to call the MCP server's `execute_sql` endpoint instead of direct BigQuery, inheriting all safety controls.

---

### Priority 5: Fix Issue Report Context & Transactional Logging — Data/UX
**Impact**: Medium | **Effort**: Small | **Risk**: Low

**Current state**: Modal-filed issues always have `sqlExecuted: []` and `schemaToolsCalled: []` — developers see "SQL executed: None." The `issues` and `issue_events` BQ inserts fire independently — if `issues` fails, `issue_events` writes orphaned records. Thread link is a raw URL, timestamp is raw ISO.

**Proposed improvement**: When filing via modal, look up the thread's audit record and attach the SQL. Chain `issue_events` inside the `issues` insert's `.then()`. Format thread link as `<url|View thread>` and use Slack date tokens.

**Implementation sketch**: In the modal submit handler, query `bot_audit.interaction_log` by thread_id to retrieve `tool_calls` JSON and extract SQL. Pass into the issue payload. In `dashboard-request.ts`, move the `issue_events` streaming insert inside the `issues` DML insert's success callback.

---

## Additional Enhancement Opportunities

### Priority 6: Add Distributed Event Dedup & Rate Limiting — Infrastructure
**Impact**: Medium | **Effort**: Medium | **Risk**: Low

In-memory `processedEvents` Set doesn't work across Cloud Run replicas. No per-user rate limiting exists. Combined with Slack's retry behavior, one message could spawn multiple expensive Claude/BQ queries.

### Priority 7: Add Per-Thread Serialization — Code Quality
**Impact**: Medium | **Effort**: Medium | **Risk**: Medium

No mutex on `processMessage` for the same `threadId`. Concurrent events can interleave `loadThread`/`saveThread`, causing duplicate messages or lost responses.

### Priority 8: Remove Dead Code & Fix Minor Bugs — Code Quality
**Impact**: Low | **Effort**: Small | **Risk**: Low

- Remove 400 from retryable errors in `claude.ts`
- Remove dead `reaction_added` conversations.history fetch
- Remove dead multi-turn issue flow from system prompt
- Wire `showPercentages` into Chart.js datalabels config
- Fix stale "32k tokens" log message
- Fix XLSX file title to preserve spaces

### Priority 9: Add App Home Tab — UI/UX
**Impact**: Medium | **Effort**: Large | **Risk**: Low

No App Home tab exists. Could show recent queries, common question shortcuts (clickable), recent data issues filed, and usage stats.

### Priority 10: Add Scheduled/Recurring Reports via Slack DM — UI/UX
**Impact**: High | **Effort**: Large | **Risk**: Low

**Current state**: No mechanism for recurring reports. Users re-type the same questions weekly. 48-hour thread expiry means they lose context between sessions.

**Proposed feature**: Users iterate on a query in a channel thread until the output is exactly what they want. Then they say "schedule this every Monday at 9am" and the bot freezes the validated SQL, column spec, and chart config. On schedule, the bot replays the frozen SQL against live BigQuery data and DMs the user the results — no Claude API call needed (fast, cheap, deterministic).

**User flow**:
1. User asks a question → bot responds with analysis + chart + table
2. User iterates: "add the XLSX too" / "change to weekly on Fridays"
3. User says "schedule this every Friday at 9 AM"
4. Bot previews what will be delivered and asks for confirmation
5. User confirms → bot saves the frozen SQL + template + schedule
6. Every Friday at 9 AM → bot executes frozen SQL, renders chart, generates XLSX, DMs user
7. User can say "my schedules" anytime to list, pause, edit, or delete

**Key design decisions**:
- **Frozen SQL, not re-prompted**: On "confirm", the bot captures the exact SQL, column spec (`[EXPORT_SQL]` shape), and chart config JSON. Each run replays the frozen SQL — the only thing that changes is the data. This guarantees the report structure is identical every time. No Claude API call, no MCP round-trip, no token cost per run.
- **DM delivery bypasses `ALLOWED_CHANNELS`**: The allowlist gates inbound messages from users in public channels. Scheduled DMs are bot-initiated outbound messages via `conversations.open` + `chat.postMessage` — architecturally separate from the Slack event handlers. No env var changes needed.
- **Schema drift handling**: If the frozen SQL fails because a BQ view changed (column renamed/dropped), the bot DMs the user: "Your Friday report failed because a data source changed. Reply 'rebuild' to re-create it." This triggers a fresh Claude run to regenerate SQL against the current schema, and the user validates again.

**Architecture**:
```
Cloud Scheduler (every 15 min)
  → POST /internal/run-schedules (authenticated)
    → Query bot_schedules for due reports
    → For each: execute frozen_sql against BigQuery
    → Render chart from frozen_chart config
    → Generate XLSX from frozen_columns
    → Format text output (no LLM — simple template)
    → conversations.open(userId) → chat.postMessage to DM
    → Update last_run_at, next_run_at
```

**New components**:

| Component | Effort | Details |
|-----------|--------|---------|
| `bot_schedules` Postgres table | Small | `user_id, user_email, title, frozen_sql, frozen_columns, frozen_chart, include_xlsx, cron_expression, timezone, is_active, last_run_at, next_run_at, created_at` |
| Schedule trigger detection | Small | Detect "schedule this", "send me this weekly", "every Monday" in conversation.ts |
| Freeze & confirm flow | Medium | On trigger: extract SQL from audit trail + chart config from response, preview to user, wait for confirmation |
| `/internal/run-schedules` endpoint | Medium | Authenticated endpoint called by Cloud Scheduler. Queries due schedules, executes frozen SQL, renders output, DMs user |
| DM delivery | Small | `conversations.open({ users: userId })` → post with full response (text + chart + XLSX) |
| Schedule management | Medium | "my schedules" → list; "pause #3"; "delete #2"; "edit #1 to biweekly" |
| Cloud Scheduler job | Small | `gcloud scheduler jobs create http ...` every 15 min |
| Failure handling | Small | DM user on failure with reason + "rebuild" option |

**Slack permissions needed**: `im:write` scope (to post in DMs), `users:read` (to look up user info). Bot already has `chat:write`.

**Total estimated effort**: ~2-3 days. The heavy lifting (BQ query execution, chart rendering, XLSX generation) already exists in the bot. This is mostly plumbing — a new Postgres table, a schedule parser, an HTTP endpoint, and DM delivery.

---

### Priority 11: Google Docs Report Generation for Complex Multi-Section Analyses — UI/UX
**Impact**: High | **Effort**: Large | **Risk**: Low

**Current state**: Complex analyses that require multiple queries, cross-referencing, and narrative synthesis hit Slack's 300s timeout, formatting limits (no headings, no TOC, limited tables), and ephemerality (messages get buried, 48h thread expiry). There is no persistent, shareable, professionally formatted output artifact.

**Proposed feature**: Users request a multi-section report. The bot plans an outline, the user confirms, then each section is executed independently (no single-query timeout risk). The bot assembles everything into a formatted Google Doc with headings, styled tables, embedded charts, and editorial narrative, then DMs the user the link.

**User flow**:
1. User: "generate a report: Q2 pipeline health — include SGA leaderboard, SGM quota attainment, channel mix trend, and closed-lost reasons. Add an executive summary."
2. Bot: "That's a multi-section report — I'll generate it as a Google Doc. Here's the outline: [sections]. Say 'go' to start, or adjust."
3. User iterates on the outline if needed, then confirms
4. Bot runs each section independently — parallel BQ queries, per-section Claude narrative calls (small, scoped, won't timeout)
5. Bot assembles into a Google Doc via the Docs API, embeds chart PNGs, shares with the user
6. Bot DMs: "Your Q2 Pipeline Health Report is ready: [Google Doc link]. 6 sections, 4 charts."

**Why Google Docs vs Slack**:

| Constraint | Slack (current) | Google Doc report |
|-----------|----------------|-------------------|
| Timeout | 300s single Claude call | Each section runs independently — no timeout risk |
| Formatting | mrkdwn, no headings | Full rich text — headings, TOC, styled tables, inline charts |
| Length | ~4K chars per message | Unlimited |
| Shareability | "Look at this Slack thread" | A URL anyone can open |
| Persistence | 48h thread expiry | Permanent Google Doc |
| Editability | Can't edit bot responses | User can annotate, comment, edit |

**Key design decisions**:
- **Section-by-section execution**: Each section is an independent unit — its own SQL query, its own Claude narrative call (scoped to 1-2 paragraphs about that section's data). No single call exceeds timeout. Sections can run in parallel.
- **Frozen SQL per section (for scheduled doc reports)**: If combined with Priority 10 (scheduled reports), the user can schedule a recurring Google Doc. Same frozen-SQL pattern — the only thing that changes is the data.
- **Google Docs API for assembly**: Use `documents.batchUpdate` to insert headings, tables, and inline images in a single API call. Charts rendered as Chart.js PNGs, uploaded to Drive, and embedded inline.

**Google Workspace Infrastructure — Already In Place**:

The `savvy-pirate-extension` GCP project has a service account that already handles Google Sheets exports for the pipeline forecast page. The same account and credentials work for Google Docs.

| Component | Status | Details |
|-----------|--------|---------|
| **Service account** | Exists | `sheet-436@savvy-pirate-extension.iam.gserviceaccount.com` |
| **JSON key file** | Exists | `.json/sheets-service-account.json` (same as `.json/savvy-pirate-extension-a5c6a37460a2.json`) |
| **Project role** | `roles/editor` | Broad role that includes Docs, Drive, and Sheets access |
| **Google Docs API** | Enabled | `docs.googleapis.com` enabled on `savvy-gtm-analytics` project |
| **Google Drive API** | Enabled | `drive.googleapis.com` enabled on `savvy-gtm-analytics` project |
| **Google Sheets API** | Enabled | `sheets.googleapis.com` enabled on `savvy-gtm-analytics` project |
| **Auth pattern** | Established | `src/lib/sheets/google-sheets-exporter.ts` — uses `google.auth.JWT` with the same service account |
| **Local dev auth** | Works | `GOOGLE_SHEETS_SERVICE_ACCOUNT_PATH=.json/sheets-service-account.json` |
| **Cloud Run auth** | Pattern exists | `GOOGLE_SHEETS_CREDENTIALS_JSON` env var (full JSON stringified) — used on Vercel, same pattern for Cloud Run |

**Auth setup for the analyst-bot**:

The existing `GoogleSheetsExporter` in `src/lib/sheets/google-sheets-exporter.ts` is the template. The auth pattern:
```typescript
// Two paths — env var (Cloud Run) or file (local dev)
const credentials = process.env.GOOGLE_DOCS_CREDENTIALS_JSON
  ? JSON.parse(process.env.GOOGLE_DOCS_CREDENTIALS_JSON)
  : JSON.parse(fs.readFileSync(process.env.GOOGLE_DOCS_SERVICE_ACCOUNT_PATH, 'utf-8'));

const auth = new google.auth.JWT({
  email: credentials.client_email,    // sheet-436@savvy-pirate-extension.iam.gserviceaccount.com
  key: credentials.private_key,
  scopes: [
    'https://www.googleapis.com/auth/documents',    // Create/edit Google Docs
    'https://www.googleapis.com/auth/drive.file',   // Upload charts, share docs
  ],
});

const docs = google.docs({ version: 'v1', auth });
const drive = google.drive({ version: 'v3', auth });
```

**Deployment changes needed**:

1. Add the service account JSON as a Cloud Run secret:
   ```
   gcloud secrets create GOOGLE_DOCS_CREDENTIALS_JSON --project savvy-gtm-analytics
   gcloud secrets versions add GOOGLE_DOCS_CREDENTIALS_JSON \
     --data-file=.json/sheets-service-account.json
   ```
2. Add to the deploy command's `--set-secrets`:
   ```
   GOOGLE_DOCS_CREDENTIALS_JSON=GOOGLE_DOCS_CREDENTIALS_JSON:latest
   ```
3. Add `googleapis` to `packages/analyst-bot/package.json`
4. No IAM changes needed — the service account already has `roles/editor`

**New components**:

| Component | Effort | Details |
|-----------|--------|---------|
| Google Docs client module | Small | `google-docs.ts` — JWT auth, create doc, batchUpdate helper, share with user email. Copy auth pattern from `google-sheets-exporter.ts`. |
| Report planner | Medium | Claude generates outline + SQL per section from user's description. Returns structured JSON: `{ title, sections: [{ heading, sql, chartConfig?, includeTable? }] }` |
| Section executor | Medium | Runs each section independently and in parallel: SQL → BQ → data rows. Catches per-section failures without aborting the whole report. |
| Section narrator | Medium | For each section's data, Claude writes 2-3 paragraphs of editorial/interpretation. Small scoped calls (~2K tokens each) that won't timeout. |
| Doc assembler | Medium | Converts sections into Google Docs API `batchUpdate` requests: insert heading → insert table → insert image (chart) → insert narrative text. Handles formatting (bold headers, table borders, section spacing). |
| Chart embedding | Small | Render Chart.js PNGs → upload to Google Drive via `drive.files.create` → get file ID → embed as `inlineObjectProperties` in the doc. |
| Report trigger detection | Small | Detect "generate a report", "create a doc", "full analysis", "multi-section" — route to report flow instead of normal response. |
| Background execution + DM delivery | Small | Report runs async. Bot posts "Working on your report..." then DMs the Google Doc link when done. Reuses the same async pattern as scheduled reports. |
| `bot_reports` Postgres table | Small | Track report requests: `user_id, user_email, title, sections_json, status, google_doc_id, google_doc_url, created_at, completed_at` |

**Doc sharing**: The service account creates the doc (owned by the service account), then shares it with the requesting user's email via `drive.permissions.create({ fileId, requestBody: { type: 'user', role: 'writer', emailAddress: userEmail } })`. The user gets editor access.

**Combination with scheduled reports**: A user can iterate on a report, confirm it, then say "schedule this monthly." The frozen SQL per section + frozen outline is saved. Each month, the bot creates a fresh Google Doc with the same structure but current data, and DMs the link. The `bot_schedules` table would add a `delivery_type` column: `'slack_dm'` or `'google_doc'`.

**Total estimated effort**: ~4-5 days. BQ query execution, chart rendering, and Claude integration already exist. New work is the Google Docs API integration (auth + doc assembly), the section-by-section orchestrator, and the report planner.

---

## Detailed Findings

### Performance

| Finding | Severity | File:Line | Evidence |
|---------|----------|-----------|----------|
| No timeout on BQ export query | High | `bq-query.ts:70` | `bq.query({ query: sql })` — no `jobTimeoutMs` |
| Sequential file uploads | Medium | `slack.ts:handleResponse` | 5 serial Slack API calls, ~1s avoidable latency |
| No schema-context caching | Low | `claude.ts` | Every message triggers fresh MCP calls |
| Thread load on every message event | Low | `slack.ts:536` | Neon query per message in any allowed channel |
| 300s timeout with no mid-flight feedback | Low | `claude.ts:12` | Users see silence after working message |
| Export path bypasses MCP validation | High | `bq-query.ts` | No LIMIT injection, byte cap, or audit logging (council finding) |

### UI/UX

| Finding | Severity | File:Line | Evidence |
|---------|----------|-----------|----------|
| No Block Kit in responses | High | `slack.ts:handleResponse` | Plain `text:` only, no sections/buttons |
| Follow-up suggestions not interactive | Medium | `system-prompt.ts` | Plain text, not clickable buttons |
| Pie/doughnut charts no data labels | Medium | `charts.ts` | `showPercentages` dead code — never wired to Chart.js |
| XLSX title has underscores | Low | `slack.ts:handleResponse` | Both `filename` and `title` use sanitized name |
| Dead system prompt: multi-turn issue flow | Low | `system-prompt.ts` | Never fires in Slack (intercepted by modal) |
| Issue thread link is raw URL | Low | `issues.ts` | Not mrkdwn-formatted |
| Error messages expose internals | Medium | `slack.ts:505-512` | Raw `(err as Error).message` sent to users |
| No App Home tab | Medium | — | Missing feature |
| No scheduled/recurring reports | High | — | Users re-type recurring queries weekly; no way to freeze + schedule a validated report to DM |
| No Google Docs report generation | High | — | Complex multi-section analyses timeout in Slack; no persistent, shareable, formatted output artifact |
| Context drops silently | Low | `conversation.ts:25` | 40-message cap, no warning |

### Data Accuracy

| Finding | Severity | File:Line | Evidence |
|---------|----------|-----------|----------|
| `sql_executed` always empty | Critical | `claude.ts:164` | `.input?.sql` should be `.input?.query` |
| `bytes_scanned` always zero | Critical | `claude.ts:179` | Parses `bytes_scanned`, server returns `bytesProcessed` |
| System prompt references nonexistent tools | Critical | `system-prompt.ts` | `describe_view`, `get_metric`, `lint_query` don't exist |
| SGA filter rule too narrow | Critical | `system-prompt.ts` | Only mentions `task_executor_name`, missed other SGA columns |
| `schema_context` term search unreliable | Medium | `mcp-server/src/index.ts` | Returns single lines, not YAML blocks |
| Issue events orphaning | Medium | `dashboard-request.ts:78+94` | Independent BQ inserts can corrupt issue_summary |

---

## Council Review

**Models consulted**: Codex GPT-5.4, Gemini 3.1 Pro Preview
**New opportunities identified**: 6
**Findings disputed**: 3

### Council Additions (not caught by agents)

1. **Export path bypasses MCP server entirely** (Codex) — `[EXPORT_SQL]` goes direct to BQ, skipping validation, LIMIT injection, byte cap, and audit logging. Major safety gap.
2. **Progressive UI updates via `chat.update`** (both) — replace one-shot working message with staged progress indicators.
3. **Prompt injection risk** (Gemini) — no guardrails against "ignore all previous instructions" style attacks. Read-only BQ mitigates data risk but system prompt could be leaked.
4. **BigQuery cache normalization** (Gemini) — Claude generates slightly different SQL formats, bypassing BQ's native query cache.
5. **Monorepo type sharing** (Gemini) — SGA attribution rules and TypeScript interfaces should be shared with the main Next.js dashboard via a monorepo package.
6. **User-level access control** (Codex) — bot uses a single `MCP_API_KEY`; MCP server cannot distinguish which Slack user asked.

### Disputed Findings

1. **L2 (timing attack on CLEANUP_SECRET)**: Gemini says exaggerated — timing attacks over network latency on Cloud Run are practically impossible. Fix for compliance, not security.
2. **H2 (400 retry severity)**: Gemini says "High" is overstated — 7s in a 300s flow is negligible. It's a code smell, not high severity.
3. **D6 (SGA rule too narrow)**: Codex notes the current system prompt may already list all SGA columns — verify against latest deployed version.

---

## Appendix: Raw Council Feedback

### Codex Review (GPT-5.4)

**Validated findings**: H1, H2, H3, M1, M3, M4, M5, D1, D2, D4, D5 confirmed directly. Most issue-report UX findings real.

**Disputed**: "No Block Kit usage" overstated (issue flow uses Block Kit). D6 may be outdated if prompt was updated. D3's exact numbers need external evidence. ISSUES_CHANNEL config is deployment-specific. Chart resolution/types are feature preferences.

**Missed**: Export bypasses MCP entirely. Access control is bot-level not user-level. Error handling leaks internals. No rate limiting despite @upstash/ratelimit in parent repo. No shared observability (Sentry, structured metrics). Slack UX is "message dump" oriented.

**Top 5**: (1) Unify tool contract, enforce rules server-side. (2) Route exports through MCP. (3) Fix telemetry and surface provenance. (4) Add distributed dedup, thread serialization, rate limiting. (5) Harden long-running UX and error surface.

### Gemini Review (3.1 Pro Preview)

**Validated**: All data accuracy findings (D1-D6) strongly validated. Infrastructure/concurrency flaws (H1, H3, M3, M5) confirmed. UX gaps (Block Kit, modal context) confirmed.

**Disputed**: L2 timing attack exaggerated. H2 severity overstated.

**Missed**: Slack 3-second ack rule + broken dedup = one message could spawn 3-4 identical queries. Next.js monorepo synergy for shared types. Progressive UI updates via chat.update. Prompt injection risk. BigQuery cache normalization.

**Top 5**: (1) Fix Slack ack + distributed dedup. (2) Repair data provenance and tool mapping. (3) Overhaul Slack UX with Block Kit + progressive loading. (4) Fix issue context + transactional logging. (5) Add BQ timeouts + context window management.
