# Savvy Analyst Bot — UX/UI Audit Findings

**Files examined:**
- `/packages/analyst-bot/src/slack.ts`
- `/packages/analyst-bot/src/system-prompt.ts`
- `/packages/analyst-bot/src/conversation.ts`
- `/packages/analyst-bot/src/issues.ts`
- `/packages/analyst-bot/src/charts.ts`
- `/packages/analyst-bot/src/types.ts`
- `/packages/analyst-bot/src/claude.ts`
- `/packages/analyst-bot/src/thread-store.ts`
- `/packages/analyst-bot/src/audit.ts`
- `/packages/analyst-bot/src/bq-query.ts`
- `/packages/analyst-bot/src/xlsx.ts`
- `/packages/analyst-bot/savvy_analyst_bot.md`

---

## User Flow

### Interaction Model

The bot responds to two entry points: `app_mention` (a user @mentions the bot in an allowed channel, which starts a new thread) and `message` (any reply within an existing bot thread, detected by checking `bot_threads` in Neon). The bot only engages in threads it started — it ignores all non-bot threads, which is the right call for avoiding noise, but means a user cannot start a conversation with a simple DM. There is no DM support at all. The `ALLOWED_CHANNELS` env var is a comma-separated allowlist; the bot silently drops messages from unlisted channels with no feedback to the user.

### Loading/Thinking State

Two signals run in parallel once a message is received:
1. An `hourglass_flowing_sand` reaction is added to the user's message.
2. A "working on it" text message is posted in the thread.

When the response is ready, the working message is deleted and the hourglass reaction is swapped for `white_check_mark`. This is a clean pattern. The 15 personality messages are fun and varied. However, there is no time estimate or progress indication. Claude + MCP can take 30-60 seconds per the architecture doc, and users see nothing between the working message appearing and the answer arriving. If the working message deletion fails (silently caught), the user is left with both the working message and the real answer in the thread, which looks messy.

### Error Handling from User Perspective

Errors surface as raw `(err as Error).message` strings in the format `Sorry, I ran into a technical issue: <error text>`. This is developer-level output, not user-friendly. Examples of what users would see:
- "Sorry, I ran into a technical issue: Claude API timed out after 300s — the query may be too complex..." (this one is actually decent)
- "Sorry, I ran into a technical issue: AUDIT_DATASET or AUDIT_TABLE not set, skipping audit" (env var name exposure)
- Any raw BigQuery error text

There is no retry suggestion beyond the timeout case. There is no fallback that says "try asking a simpler question" as a general error cue.

### Multi-Turn Conversations

Multi-turn is fully supported. Thread state is persisted in Neon as JSONB, capped at 40 messages (20 exchanges). Thread IDs are `channel:thread_ts`, so context is scoped to a Slack thread. The 48-hour expiry on threads means a user cannot return to a conversation the next day and continue where they left off. The truncation to 40 messages is hard and silent — no warning is shown when context starts getting dropped.

---

## Response Formatting

### Tables

Two paths exist. Small code blocks (under 5 lines) stay inline as triple-backtick code blocks. Larger tables (5+ lines) are extracted by `extractTableSnippets()` and uploaded as `.txt` file snippets via `filesUploadV2`. The title classification logic is heuristic: box-drawing characters get "Performance Matrix", dash patterns get "Leaderboard", pipe-separator patterns get "Results Table", everything else gets "Data Table".

The `toSlackMrkdwn()` function correctly wraps bare pipe tables in triple backticks. The regex requires the separator row to be present — a table without a separator row would be passed through raw.

### Visual Gaps

There is no Block Kit usage in regular responses — all text is plain `text:` with `mrkdwn` formatting via `chat.postMessage`. This means no structured sections, no context footers, no dividers, no action buttons for follow-up suggestions. The entire response is one or more raw text messages plus file uploads.

The system prompt mandates a "Suggested follow-up" section in every data response, but this is just plain text — not a clickable button. Users have to manually type the suggestion.

The footer `"export xlsx" for a workbook / "report issue" if something looks off` is plain text that appears at the end of every response including single-number answers.

### Markdown Conversion Completeness

`toSlackMrkdwn()` handles: `**bold**` to `*bold*`, `### heading` to `*heading*`, `[text](url)` to `<url|text>`, `---` to `———`, bare pipe tables wrapped in code blocks.

Not handled: `~~strikethrough~~` (Slack uses single `~`). The system prompt tells Claude to write Slack mrkdwn natively, so the converter is a safety net — adequate for its purpose.

---

## Charts

### Size and Resolution

Fixed at 800x500 pixels with a white background. A 1200x750 retina-quality render would display better on high-DPI screens without significant file size penalty for PNG.

### Chart Types Available

`bar`, `horizontalBar`, `pie`, `doughnut`, `line`, `stackedBar`. No `scatter` or `area` chart type — limits trend analysis options. No dual-axis line chart support.

### Data Labels

Pie/doughnut charts have labels completely off. Users cannot read values in Slack since they cannot hover over a static PNG. Pie charts in Slack are nearly unreadable without data labels. The `showPercentages` option exists in `ChartRequest` but is never wired into the Chart.js config — dead option.

### Chart Title

No subtitle support — context like "Cohort mode, re-engagement excluded" ends up in editorial text instead of the chart.

---

## XLSX Export

XLSX files use underscored filenames for both `filename` and `title` parameters. The Slack display title contains underscores instead of spaces (`Open_Pipeline_Advisors.xlsx`). A separate `title` parameter (space-preserving) vs `filename` (underscore) would improve this.

Column widths use `estimateWidth()` based on header length, not data length — wide data values could overflow narrow columns.

---

## Issue Reporting

### Dual Trigger Paths (Conflict)

1. `slack.ts` checks `isIssueTrigger(text)` BEFORE calling `processMessage()`. If triggered, it posts an issue button (Block Kit with modal) and returns early — Claude is never called.
2. `conversation.ts` also checks `ISSUE_TRIGGERS` and handles `[ISSUE]` blocks from Claude.

The system prompt's multi-turn issue flow (steps 1-4) never executes in Slack because `slack.ts` intercepts first. The modal is actually better UX (faster, more structured) but the system prompt section is dead code in production.

### Modal-Filed Issues Missing SQL Context

When filed via modal, `sqlExecuted` is always `[]` and `schemaToolsCalled` is always `[]`. The developer receiving the issue sees "SQL executed: None" and "Schema context used: None". This is a meaningful information gap for issue triage.

### Issue Block Kit Formatting Issues

- Thread link is a raw URL string, not `<url|View thread>` format
- Timestamp is raw ISO string, not Slack date format token
- `ISSUES_CHANNEL` and `ALLOWED_CHANNELS` are both set to the same channel ID in production

---

## Missing Features

1. **No rate limiting per user** — no protection against spam/cost
2. **No query provenance** — users can't see what SQL was run or bytes scanned (data is in ClaudeResponse but not surfaced)
3. **No saved queries or bookmarks** — recurring questions must be re-typed
4. **No App Home tab** — no recent queries, common questions, or usage stats
5. **No slash commands** — only @mention entry point
6. **No scheduled/recurring reports** — no "send weekly leaderboard every Monday"
7. **Suggested follow-up is not interactive** — plain text, not clickable button
8. **Context window drops silently** — no warning when messages are trimmed
9. **Dead code**: `reaction_added` handler fetches message but discards result

---

## Block Kit Opportunities Not Being Used

1. Results section block with context footer
2. Follow-up suggestion buttons (clickable)
3. "Export as XLSX" button instead of footer text
4. "Report Issue" flag button always present
5. Overflow menu: Export, Report Issue, Show SQL, Show Assumptions

---

## Priority Findings

### High impact, low effort:
- Fix thread link formatting in issue blocks: use `<url|View thread>` (1 line)
- Fix ISO timestamp in issue blocks: use Slack date format token
- Remove dead multi-turn issue flow from system prompt
- Surface query provenance (bytesScanned, SQL count) in response footer
- Fix XLSX Slack file title to use unescaped title

### High impact, moderate effort:
- Add interactive follow-up suggestion buttons via Block Kit
- Add App Home tab with recent queries and common question shortcuts
- Wire SQL into issue block for modal-filed issues (query audit log by thread ID)
- Add per-user rate limiting / in-flight request dedup

### Structural:
- `reaction_added` handler's conversations.history fetch is dead code
- `ISSUES_CHANNEL` should differ from `ALLOWED_CHANNELS` in production
- Pie/doughnut `showPercentages` is a dead option — wire into Chart.js config
