# Exploration Results: Scheduled Reports + Google Docs Report Generation

## Pre-Flight Summary

All infrastructure prerequisites are in place or easily provisionable. Google Docs API and Drive API are already enabled on the GCP project. The `sheet-436@savvy-pirate-extension.iam.gserviceaccount.com` service account with its JSON key at `.json/sheets-service-account.json` has `roles/editor` and is ready for Docs/Drive operations. The existing `bq-query.ts:runExportQuery()` handles frozen SQL replay with validation, byte caps, and timeouts — no new BQ logic needed. The `conversations.open` → DM pattern is already proven in the App Home quick-launch handler. Three spec gaps need correction before build: (1) audit table name is `bot_audit.interaction_log` not `audit.analyst_bot_queries`, (2) env var names are `DATABASE_URL` and `BIGQUERY_PROJECT` not the spec's variants, (3) `InsertInlineImage` requires a publicly-accessible URI — must create `anyone/reader` permission on Drive chart files before embedding. The `googleapis` npm package is not yet installed in the analyst-bot package and must be added. Two Neon tables (`bot_schedules`, `bot_reports`) must be created via migration.

---

## Build Order DAG

```
Phase 0: Scaffold
  ├── Install googleapis
  ├── Create Neon tables (bot_schedules, bot_reports)
  ├── Add env vars to .env.example
  │
Phase 1: Types (src/types.ts extensions)
  │
  ├──── Phase 2a: dm-helper.ts ──┐
  ├──── Phase 2b: schedule-store.ts ──┤── can build in parallel
  ├──── Phase 2c: google-docs.ts ─────┘
  │
  ├──── Phase 3a: schedule-runner.ts (needs 2a + 2b)
  ├──── Phase 3b: report-generator.ts (needs 2a + 2c)
  │
  Phase 4: Wire into slack.ts + app-home.ts (needs all above)
  │
  Phase 5: Integration test + deploy
```

---

## Infrastructure Status

| Item | Status | Notes |
|------|--------|-------|
| Google Docs API | Enabled | `docs.googleapis.com` on `savvy-gtm-analytics` |
| Google Drive API | Enabled | `drive.googleapis.com` on `savvy-gtm-analytics` |
| Service account key | Exists | `.json/sheets-service-account.json` = `sheet-436@savvy-pirate-extension.iam.gserviceaccount.com` |
| SA permissions | Sufficient | `roles/editor` on `savvy-pirate-extension` |
| Neon Postgres | Connected | Pool pattern in `thread-store.ts`, env var `DATABASE_URL` |
| `bot_schedules` table | Must create | DDL in spec |
| `bot_reports` table | Must create | DDL in spec |
| `user_queries` table | Exists | Created earlier this session |
| `googleapis` npm package | Must install | Not in analyst-bot `package.json` |
| `GOOGLE_DOCS_CREDENTIALS_JSON` secret | Must create | Stringified JSON key for Cloud Run |
| `CRON_SECRET` secret | Must create | Random 32-char hex |
| Cloud Scheduler job | Must create | POST every 15min to `/internal/run-schedules` |
| Slack `im:write` scope | Added | Already requested (pending workspace admin approval) |
| Slack `users:read.email` scope | Already in use | `getUserEmail()` already calls `users.info` |
| Cloud Run memory | 512MB | Consider bumping to 1GB for concurrent chart rendering |

---

## Reusable Code (DO NOT rebuild)

| Module | Import | What to reuse |
|--------|--------|---------------|
| `bq-query.ts` | `runExportQuery(sql)` | Frozen SQL replay with validation + byte cap + timeout |
| `thread-store.ts` | Pool pattern (copy `getPool()`) | Neon connection for schedule/report CRUD |
| `conversation.ts` | `processMessage(input, threadId, channelId, userId)` | Run each report section through Claude pipeline |
| `charts.ts` | `renderChart(req)`, `parseChartBlock(text)` | Chart PNGs for Google Docs embedding |
| `slack.ts` | `getUserEmail(client, userId)` | Resolve Slack user → email for Doc sharing |
| `slack.ts` | `buildResponseBlocks(text, channelId, threadTs, queryCount, bytesScanned)` | Format scheduled report DM |
| `slack.ts` | `/internal/cleanup` pattern | Copy for `/internal/run-schedules` |
| `slack.ts` | `conversations.open` pattern (lines 729-734) | DM channel resolution |
| `google-sheets-exporter.ts` (dashboard root) | JWT auth pattern | Copy for Google Docs auth |

---

## Integration Findings — Key Gotchas

### Google Docs batchUpdate
- Use `endOfSegmentLocation: {}` to append at end of doc (avoids index tracking)
- `updateParagraphStyle` REQUIRES `fields: 'namedStyleType'` — omitting causes 400 error
- Cell population in tables must be done bottom-up (sort by index descending)
- Fetch doc after each structural insert to get actual indices

### InsertInlineImage — CRITICAL
- URI must be publicly accessible (Docs API fetches server-side)
- After uploading chart to Drive, create `anyone/reader` permission
- Use `https://drive.google.com/uc?export=download&id={fileId}` as the URI
- Delete temp Drive file after embedding

### Private Key in Env Vars
- Cloud Run stores `\n` as literal two characters
- Must `.replace(/\\n/g, '\n')` before passing to JWT constructor

### Slack Modals
- `trigger_id` expires in 3 seconds — call `views.open` immediately after `ack()`
- `private_metadata` limited to 3000 chars — don't put frozen SQL in it
- Retrieve frozen SQL in the `view` handler via BQ audit query

### DM Delivery
- CANNOT post `chat.postMessage({ channel: userId })` — must call `conversations.open` first
- Existing pattern at slack.ts lines 729-734 is correct

---

## Module Inventory

| File | Purpose | Dependencies | Complexity |
|------|---------|-------------|------------|
| `src/types.ts` (modify) | Add `ScheduleRecord`, `ReportRecord`, `ReportSection`, `SectionResult` | none | Small |
| `src/dm-helper.ts` (new) | `dmUser()`: conversations.open + postMessage | `@slack/web-api` | Small (~40 lines) |
| `src/schedule-store.ts` (new) | CRUD for `bot_schedules`: create, getDue, markRun, cancel, getForUser | `pg` pool | Medium (~120 lines) |
| `src/google-docs.ts` (new) | Google Docs/Drive client: createDoc, appendSection, insertTable, embedChart, shareDoc | `googleapis` | Large (~250 lines) |
| `src/schedule-runner.ts` (new) | Cron handler: getDueSchedules → runExportQuery → format → dmUser → updateNextRun | `schedule-store`, `bq-query`, `dm-helper` | Medium (~160 lines) |
| `src/report-generator.ts` (new) | Report orchestrator: detect intent, plan sections, run concurrently, assemble Doc, persist | `google-docs`, `dm-helper`, `conversation`, `charts` | Large (~220 lines) |
| `src/report-store.ts` (new) | CRUD for `bot_reports`: create, updateStatus, getForUser | `pg` pool | Small (~80 lines) |
| `src/slack.ts` (modify) | Add "Schedule This" button, 3 new action/view handlers, report intent check, cron endpoint | All new modules | Medium (~150 lines added) |
| `src/app-home.ts` (modify) | Add active schedules section with Cancel buttons | `schedule-store` | Small (~60 lines added) |

---

## Spec Gaps (corrected for build guide)

| # | Gap | Resolution |
|---|-----|-----------|
| 1 | Audit table name wrong (`audit.analyst_bot_queries`) | Use `bot_audit.interaction_log` (from env vars `AUDIT_DATASET`/`AUDIT_TABLE`) |
| 2 | Env var `NEON_DATABASE_URL` | Use `DATABASE_URL` (matches existing code) |
| 3 | Env var `BIGQUERY_PROJECT_ID` | Use `BIGQUERY_PROJECT` (matches existing code) |
| 4 | DM channel = userId | Must use `conversations.open` first |
| 5 | Frozen SQL returns 0 rows | DM user "Your scheduled report returned no results this run" |
| 6 | Timezone for schedules | Use UTC, document DST drift for daily reports |
| 7 | batchUpdate index management | Use `endOfSegmentLocation` for appending, fetch doc for indices |
| 8 | Report intent too broad ("full analysis") | Require "report" in the trigger phrase |
| 9 | `users:read.email` scope | Already in use — no new scope needed |
| 10 | `sections_json` underspecified | Extend to store `narrativeText` and `errorMessage` per section |
| 11 | Cron endpoint registration | Use existing `receiver.router.post` pattern from `/internal/cleanup` |
| 12 | `InsertInlineImage` requires public URI | Create `anyone/reader` permission on Drive file before embedding |
| 13 | Private key `\n` handling | `.replace(/\\n/g, '\n')` before JWT constructor |

---

## Risks and Blockers

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Google Docs batchUpdate index management | HIGH | Use endOfSegmentLocation; test in isolation |
| InsertInlineImage requires public URI | HIGH | anyone/reader permission + direct download URL |
| `googleapis` not installed | HIGH | Install before any code — `npm install googleapis` |
| 512MB Cloud Run memory with concurrent charts | MEDIUM | Consider bumping to 1GB |
| processMessage concurrency (3 sections) | MEDIUM | Use Promise.allSettled; 300s Cloud Run timeout is sufficient |
| Monthly next_run_at edge cases (Jan 31) | LOW | Clamp to last day of month |
| Stuck `bot_reports` in `running` status | LOW | Note as tech debt — no v1 cleanup job |
