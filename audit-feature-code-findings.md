# Analyst Bot Code Quality and Performance Audit

**Date**: 2026-04-11  
**Scope**: packages/analyst-bot/src/ (all 14 source files)  
**Auditor**: code-inspector agent

---

## 1. Architecture: Data Flow

User message -> Slack Bolt event handler (slack.ts) -> processMessage() (conversation.ts) -> callClaude() (claude.ts) -> Anthropic beta messages API with mcp_servers config -> Claude makes MCP tool calls to the schema-context remote server -> Claude returns content blocks -> parseClaudeResponse() strips narration, extracts text/tool records -> conversation.ts parses [CHART], [XLSX], [EXPORT_SQL], [ISSUE] blocks -> renders chart PNG, generates XLSX, writes audit log, saves thread -> handleResponse() in slack.ts posts text chunks, uploads files, swaps emoji reactions.

The transformation chain is reasonable and not gratuitously deep. No unnecessary intermediate serialization: full content blocks are stored as-is in the thread for conversation continuity, and text extraction is a single linear pass.

One mild redundancy: EXPORT_RE is evaluated twice in conversation.ts (lines 80 and 113) -- once to set maxTokens and again to detect export mode. A single assignment before the Claude call would suffice.

---

## 2. Performance

### Latency Budget

The critical path is: Slack 3s ack -> working message post -> Claude API (dominant) -> parse blocks -> render chart -> save thread -> post response chunks -> upload files. The Claude API timeout is 300 seconds with no mid-flight feedback beyond the initial working-on-it message. Real-world latency depends almost entirely on MCP round-trips: describe_view + get_metric + lint_query + execute_sql = 4 serial network calls before Claude can write its final answer.

### Bottlenecks (ranked by expected contribution)

**1. Claude API generation time** -- dominant. 5-minute ceiling. The two timeouts in claude.ts (SDK timeout on line 87 and AbortController on line 75) are set to the same CLAUDE_TIMEOUT_MS value. The AbortController cannot fire before the SDK timeout, but per the code comment its purpose is as a safety net if the SDK timeout misfires during MCP beta tool execution. The design is intentional and correct.

**2. Sequential Slack file uploads** -- handleResponse() uploads snippets, then chart, then XLSX with individual awaits in sequence. For a response with 3 table snippets + chart + XLSX that is 5 serial Slack API calls (~200ms each = ~1s). All are independent and could be parallelized with Promise.all, reducing this to ~200ms.

**3. Thread load on every message event** -- loadThread() is called unconditionally in the message handler (slack.ts line 536) to check if the thread exists. This is a Neon Postgres query on every thread reply in any allowed channel. Necessary for correctness but adds ~10-50ms per event.

**4. Chart rendering** -- ChartJSNodeCanvas uses a single global renderer instance (correct singleton). renderToBuffer() runs ~50-150ms. Not a bottleneck.

**5. No schema-context caching** -- Every message triggers fresh MCP calls. If a user asks three follow-up questions about the same view, describe_view is called three times. No client-side cache of MCP responses exists.

### Timeout Appropriateness

300 seconds is very long. Slack threads will show a working message for up to 5 minutes before the user gets a timeout error. A more user-friendly approach: 90-120s timeout with a mid-flight message at the 60s mark. The 300s ceiling is not a correctness bug but is a UX concern.

### Parallelization Opportunities

| Location | Current | Improvement |
|---|---|---|
| handleResponse() uploads | Sequential await in loop | Promise.all() -- all independent |
| EXPORT_RE evaluation | Evaluated on lines 80 and 113 | Single assignment at line 80, reuse at 113 |

---

## 3. Code Quality

### TypeScript Type Safety

The type coverage is good for a bot of this scope. Most internal types are well-defined in types.ts. Problem areas:

- Pervasive any usage: client: any appears in slack.ts at lines 37, 93, 113, 156, 503, 551, and others. The Slack WebClient from @slack/web-api has a typed export that could replace most of these.
- parseClaudeResponse takes response: any (claude.ts line 129) because the beta API response type is not yet stable in the SDK. Acceptable but should be documented.
- blocks: any[] in the modal construction in slack.ts (line 177) could use Slack Block Kit types from @slack/types.
- normalizeXlsxBlock (conversation.ts lines 392-504) takes parsed: any. The function is 90 lines and would benefit from a narrower intermediate type for Claude sheet shape.
- strict: true is set in tsconfig.json but noUncheckedIndexedAccess is not enabled, so array index operations are not statically checked for undefined.

### Error Handling

**Comprehensive paths:**
- Claude API timeout: clear user-facing message, throws out of retry loop, caught by processMessage outer try/catch, returned as error text to Slack.
- Chart render failure: logged, does not block text response (conversation.ts line 104).
- Thread save failure: logged, response still returned (conversation.ts line 234).
- File upload failures in handleResponse: individually caught, logged, processing continues.
- Emoji reaction failure: silently ignored (non-critical).
- postWorkingMessage failure: returns null, deleteWorkingMessage correctly handles with early return.

**Gaps:**
- runExportQuery() (bq-query.ts line 70) has no timeout parameter. BigQuery query execution can run indefinitely. A jobTimeoutMs option would prevent runaway export queries.
- syncIssueToBigQuery() (dashboard-request.ts lines 78 and 94) fires two BigQuery writes independently. If the issues DML INSERT fails, the issue_events streaming insert still runs with a dashboard_request_id that does not exist in issues. This silently corrupts the issue_summary view. The issue_events insert should be chained inside the issues insert promise chain.
- reaction_added handler (slack.ts line 584): conversations.history result is fetched but the variable is never used. Dead code.
- The cleanup endpoint at /internal/cleanup uses require("./thread-store") (line 774) instead of a top-level import. deleteExpiredThreads is not imported at the top of slack.ts. Works at runtime but is inconsistent with the module pattern.

### Race Conditions

- **Deduplication processedEvents Set** (slack.ts lines 23-31): In-memory per process. In a multi-replica Cloud Run deployment, Slack retries routed to different replicas will not be deduplicated. Known limitation, should be documented.
- **Concurrent thread processing**: No mutex on processMessage for the same threadId. Two concurrent Slack events for the same thread will both call loadThread, both append their user message, and the second saveThread UPSERT will overwrite the first. The thread could end up with duplicate user messages or a missing response. Mitigation: SELECT ... FOR UPDATE inside a transaction in saveThread.
- **userEmailCache Map** grows unboundedly. No eviction policy. Low risk in practice.

### Retry Logic: 400 Retry Bug

claude.ts line 104:



HTTP 400 (Bad Request) is **not a retryable error**. A malformed request will be retried 3 times with exponential backoff, wasting 1s + 2s + 4s = 7 seconds before throwing the same error. Remove 400 from isRetryable. Retryable set should be 429, 529 (optionally add 500, 502, 503).

### Secrets Handling

All secrets sourced from process.env. No hardcoded credentials found. MCP_API_KEY correctly passed as authorization_token. The CLEANUP_SECRET endpoint check uses plain string equality; crypto.timingSafeEqual would be more correct to prevent timing oracle attacks.

### TODO/FIXME/HACK Comments

None found in any of the 14 source files.

---

## 4. Specific Function Analysis

### toSlackMrkdwn (slack.ts lines 223-262)

Code block protection (extract to placeholders, transform, restore) is correct. The table detection regex requires each row to start and end with | and end with a newline. The hadTrailingNewline guard correctly handles strings not ending in newline. The separator check /|[-:| ]+|/ guards against wrapping non-table pipe content. Windows line endings work because s* captures . The bold transform uses lazy matching and does not span newlines -- multi-line bold is not transformed, acceptable in practice.

### splitSlackMessage (slack.ts lines 271-307)

Empty chunk prevention is correct: both the mid-loop check and the final push use .trim() to skip whitespace-only chunks. Oversized code blocks (single block > maxLen) produce a single over-limit chunk -- correct documented behavior (code blocks are atomic). Unbalanced code blocks in the input would produce incorrect split results, but that is a Claude output formatting problem, not a function defect.

### extractTableSnippets (slack.ts lines 322-346)

The regex requires the opening fence to be immediately followed by a newline. Code blocks with language specifiers (e.g., triple-backtick sql) will NOT match and will stay inline. The system prompt instructs Claude to use plain fences for tables, so this is acceptable but fragile: a stray language-specifier code block with 50 rows will not be extracted as a snippet and will render poorly in Slack.

### stripLeadingNarration (claude.ts lines 209-222)

The 500-char limit means narration longer than 500 characters is not stripped. The system prompt strongly prohibits narration, so the 500-char case should be rare. The result markers set is narrow (Results, chart emoji, :chart, triple backtick, or a pipe separator row). A response starting with a bold section header followed by data will not trigger stripping. This is belt-and-suspenders on top of the lastToolResultIdx filtering in parseClaudeResponse, which already removes pre-tool text blocks.

### Thread Truncation: 40 Messages

MAX_THREAD_MESSAGES = 40 in conversation.ts (line 25) and MAX_MESSAGES = 40 in claude.ts (line 13) are aligned. The claude.ts truncation at line 52 (messages.slice(-MAX_MESSAGES)) is the gate that limits what is sent to Claude. The conversation.ts truncation limits what is saved to Postgres.

Token budget concern: a 20-exchange thread where each exchange includes large BigQuery results (e.g., 1000-row query result in an MCP tool response) could push effective token count well above 40K even with only 40 messages. There is no dynamic truncation based on estimated token count. For threads with consistently large query results, the token budget could be exceeded before the message count limit is reached.

### Fire-and-Forget Audit Write

writeAuditRecord() is called without await (conversation.ts line 260). Intentional -- audit must not block responses. Risks: (1) BigQuery downtime silently drops records with no retry or queue; (2) Cloud Run instance termination before the pending promise resolves drops the record. For the current usage scale (dozens of daily questions), this is acceptable. For compliance or billing-sensitive usage, a Pub/Sub buffer would be warranted.

---

## 5. Issue Summary (Ranked by Severity)

### High

**H1 -- bq-query.ts line 70: No timeout on export query**  
bq.query({ query: sql }) has no jobTimeoutMs option. A runaway export query blocks the bot indefinitely.  
Fix: bq.query({ query: sql, jobTimeoutMs: 120_000 })

**H2 -- claude.ts line 104: HTTP 400 is not retryable**  
status === 400 is included in isRetryable. Bad requests are retried 3 times, wasting 7 seconds before throwing the same error.  
Fix: Remove 400. Retryable set should be 429, 529 (optionally add 500, 502, 503).

**H3 -- dashboard-request.ts lines 78+94: issue_events fires independently of issues insert**  
If the issues DML INSERT fails, issue_events still inserts a record with a non-existent dashboard_request_id. Silently corrupts the issue_summary view.  
Fix: Chain issue_events insert inside the issues insert .then() callback, not as a separate fire-and-forget.

### Medium

**M1 -- slack.ts handleResponse: Sequential file uploads should be parallelized**  
Snippet uploads, chart upload, and XLSX upload are sequential awaits. Adds ~800ms-1s of unnecessary latency for multi-attachment responses.  
Fix: Replace sequential loop with Promise.all().

**M2 -- conversation.ts lines 80+113: EXPORT_RE evaluated twice**  
Minor DRY violation. Assign const isExportRequest = EXPORT_RE.test(input) once and reuse as userRequestedExport at line 113.

**M3 -- Thread race condition on concurrent events for same threadId**  
No mutex on thread read/write. Two concurrent Slack events for the same thread can interleave loadThread/saveThread calls, with the slower write overwriting the faster.  
Fix: SELECT ... FOR UPDATE in a transaction in saveThread, or a per-threadId in-process lock.

**M4 -- reaction_added handler: conversations.history result is unused**  
slack.ts line 584 fetches the reacted message but discards the result. Either use the message body to populate prefillText in postIssueButton, or remove the API call entirely.

**M5 -- In-memory dedup processedEvents not shared across replicas**  
Multi-replica Cloud Run deployments will not deduplicate Slack retries across instances.  
Fix: Document this limitation, or use a Redis SET with TTL for distributed dedup.

### Low

**L1 -- slack.ts cleanup endpoint uses require instead of top-level import**  
Line 774: const { deleteExpiredThreads } = require("./thread-store"). Add deleteExpiredThreads to the named import at line 11.

**L2 -- CLEANUP_SECRET check uses plain string equality**  
slack.ts line 767. Use crypto.timingSafeEqual to prevent timing oracle attacks on the cleanup endpoint.

**L3 -- userEmailCache Map grows unboundedly**  
No eviction policy. Should be bounded (e.g., LRU with max 500 entries) for long-running deployments.

**L4 -- 300s timeout with no mid-flight feedback**  
If a Claude call takes 90-180s, the user only sees the initial working message.  
Fix: Post a follow-up at the 60s mark via setTimeout inside the try block before the Claude call resolves.

**L5 -- Stale log message in conversation.ts line 82**  
Log says (export mode, 32k tokens) but the actual value assigned on line 81 is 16384 (16k). Stale artifact from a prior token limit change.

**L6 -- tsconfig.json missing noUncheckedIndexedAccess**  
strict: true is set but noUncheckedIndexedAccess is not enabled. Array index operations in normalizeXlsxBlock and parseXlsxFromResponse are not statically checked for undefined.

---

## 6. No Issues Found

The following were inspected and found correct:

- **Dockerfile**: canvas system deps installed before npm ci; devDependencies pruned after build; non-root USER node; single-stage build appropriate for this service.
- **saveThread upsert** (thread-store.ts): ON CONFLICT (thread_id) DO UPDATE correctly handles create vs. update atomically.
- **Pool sizing** (max: 3): appropriate for Cloud Run single-instance concurrency model.
- **Chart renderer singleton** (charts.ts): global renderer instance correctly reused -- no per-chart canvas construction overhead.
- **generateWorkbook formula cells** (xlsx.ts): correctly handles Excel formula strings via { formula: raw.substring(1) } to strip the leading equals sign.
- **getColumnLetter** (xlsx.ts): correctly converts column numbers to Excel letters including two-letter columns (AA, AB...).
- **48-hour thread TTL** (thread-store.ts): reasonable for a conversational bot. Cleanup endpoint is authenticated.
- **System prompt**: internally consistent. SGA/SGM join rule, lint_query mandate, and cohort mode default are well-specified and non-contradictory.
- **Env var validation at startup** (index.ts): required vars checked before the app starts; missing vars produce a clear error and process.exit(1).
- **Working message pattern**: postWorkingMessage/deleteWorkingMessage correctly handles null ts and swallows non-critical errors. Delete-before-post ordering ensures the spinner is removed before the real response appears.
