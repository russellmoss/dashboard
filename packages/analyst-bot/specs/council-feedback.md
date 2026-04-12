# Council Feedback: Scheduled Reports + Google Docs

## CRITICAL ISSUES (merged and deduplicated)

### C1 — `googleapis` not installed in analyst-bot package (Codex)
Must `npm install googleapis` before any code compilation. Phase 0 already includes this step.
**Resolution:** Already in Phase 0 scaffold. Verify.

### C2 — processMessage returns text, not structured table data (Codex)
`processMessage()` returns `ConversationResult` with `text`, `chartBuffer`, etc. — but no structured `rows[]`. The report generator parses markdown tables from the text to extract table data, which is fragile.
**Resolution:** The guide already includes a regex-based markdown table parser in `processSection()`. Fragile but workable for v1. Note as tech debt.

### C3 — Concurrent processMessage corrupts thread state (Codex)
Parallel calls to `processMessage()` with the same threadId race on loadThread/saveThread.
**Resolution:** The guide already uses synthetic per-section threadIds: `report:${userId}:${Date.now()}:s${sectionIndex}`. Confirmed correct.

### C4 — Frozen SQL is JSON array, not a single string (Codex)
`sql_executed` in audit log is `JSON.stringify(record.sqlExecuted)` — a JSON array of SQL strings. The confirm handler must parse it and pick the right query.
**Resolution:** Must fix in Phase 4 — parse JSON, take the last element (most likely the final data query).

### C5 — Cloud Run memory insufficient (Gemini)
512MB is too low for 3 concurrent Claude + BQ sections plus chart rendering.
**Resolution:** Bump to 1GB or 2GB in deploy command. Address in Phase 5.

### C6 — Orphaned public Drive chart files (Gemini)
If Cloud Run crashes during doc generation, `finally` block may not execute. Publicly accessible chart files leak.
**Resolution:** Keep the `finally` cleanup pattern but also add a periodic cleanup of orphaned Drive files. For v1, the risk is low (charts contain no PII, just aggregated data). Flag as tech debt. GCS signed URLs are a better long-term solution.

### C7 — BQ streaming buffer race condition (Gemini)
Audit records may not be immediately queryable if they're in BQ's streaming buffer. User clicks "Schedule This" before the audit record is queryable.
**Resolution:** The bot writes audit records via `insertAll` (streaming insert). BQ streaming buffer typically has a few seconds delay. Add a fallback: if BQ returns 0 rows for frozen SQL, check if the current `processMessage` result has `sqlExecuted` available and pass it through the action payload metadata instead.

### C8 — Cron route only exists in HTTP mode (Codex)
If `SLACK_APP_TOKEN` is set, `receiver` is undefined and the cron endpoint is never registered.
**Resolution:** The production deployment uses HTTP mode (not Socket Mode). Document this constraint. The cron endpoint is intentionally HTTP-only.

## SHOULD FIX (merged)

### S1 — New env vars not in startup validation (Codex)
`index.ts` doesn't validate `CRON_SECRET` or `GOOGLE_DOCS_CREDENTIALS_JSON` at startup.
**Resolution:** Add to SLACK_VARS validation in index.ts (optional — only required when those features are used).

### S2 — "Schedule This" button appears even when no SQL was executed (Codex)
Many bot replies have zero provenance queries. The button should only appear when `provenanceQueryCount > 0`.
**Resolution:** Gate the button on `provenanceQueryCount > 0` in `buildResponseBlocks()`.

### S3 — Failed schedules advance forever with no retry/disable (Codex + Gemini)
Advancing `next_run_at` on failure means broken schedules silently skip runs.
**Resolution:** Add `failure_count` column to bot_schedules. After 3 consecutive failures, auto-disable the schedule and DM the user.

### S4 — Pool duplication (Codex + Gemini)
Three separate `getPool()` singletons waste connections and cold-start time.
**Resolution:** Create a shared `src/db.ts` that exports `getPool()`. All stores import from it.

### S5 — Google Docs service account ownership (Gemini)
SA owns the docs. If SA is deleted, docs disappear.
**Resolution:** Acceptable for v1. Note as tech debt — consider Shared Drive later.

### S6 — Docs API batchUpdate can 429/500 (Gemini)
Google Docs API is "notoriously flaky" — needs retry logic.
**Resolution:** Add simple retry with exponential backoff on 429/500 in google-docs.ts.

## DESIGN QUESTIONS (numbered)

### Q1 — Frozen SQL with CURRENT_DATE() drifts over time (Codex)
If the frozen SQL uses `CURRENT_DATE()` or rolling windows, reruns produce different date ranges.
**Context:** This is actually the DESIRED behavior — "SQOs this week" should always show the current week.
**Resolution:** Document that frozen SQL with relative dates is intentional. Add a note in the schedule confirmation modal.

### Q2 — Temporary public chart exposure acceptable? (Codex + Gemini)
Charts made publicly accessible for InsertInlineImage.
**Context:** Charts contain aggregated funnel data (not PII). Public for seconds during embed, then deleted.
**Resolution:** Acceptable for v1 with cleanup. GCS signed URLs are the long-term fix.

### Q3 — Failed schedule behavior: retry, disable, or keep DMing? (Codex + Gemini)
**Resolution:** Add failure_count. Auto-disable after 3 consecutive failures. DM user once on disable.

### Q4 — Report intent: regex vs Claude tool calling? (Gemini)
Regex requiring "report" is brittle. Claude tool calling would be more flexible.
**Context:** Claude tool calling adds latency and cost to EVERY message (checking if it's a report request). Regex is instant and free. For v1, regex is fine.
**Resolution:** Keep regex for v1. Note Claude classification as a v2 option.

### Q5 — Which SQL to freeze when sql_executed has multiple queries? (Codex)
**Resolution:** Take the last SQL in the array — it's typically the main data query (earlier ones are schema exploration).

### Q6 — Slack user email mapping for doc sharing? (Gemini)
**Resolution:** Already handled — `getUserEmail()` exists and uses `users.info`. `users:read.email` scope is already in use.

## SUGGESTED IMPROVEMENTS (ranked by impact)

1. **Shared db.ts pool module** — eliminates pool duplication, reduces cold-start time (High impact, Small effort)
2. **Gate "Schedule This" on provenanceQueryCount > 0** — prevents confusing UX (High impact, Tiny effort)
3. **failure_count + auto-disable on schedules** — prevents infinite failure loops (High impact, Small effort)
4. **Retry wrapper for Docs API batchUpdate** — prevents flaky 429/500 failures (Medium impact, Small effort)
5. **Store frozen SQL in Neon instead of reading from BQ audit** — eliminates streaming buffer race (Medium impact, Medium effort)
6. **Tests for computeNextRunAt edge cases** — prevents date math bugs (Medium impact, Small effort)
7. **GCS signed URLs for chart embedding** — eliminates public file risk (Medium impact, Large effort — defer to v2)
8. **Sequential section processing instead of concurrent** — reduces OOM risk (Low impact — concurrent is fine with 1GB+ RAM)

## RAW RESPONSES

### Codex (GPT-5.4) — Full Text
[See above — 6 critical, 9 should-fix, 6 design questions, 6 suggested improvements]

### Gemini (3.1 Pro Preview) — Full Text
[See above — 3 critical, 4 should-fix, 3 design questions, 4 suggested improvements]
