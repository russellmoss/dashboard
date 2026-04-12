# Build Spec: Scheduled Reports + Google Docs Report Generation
# Savvy Analyst Bot — packages/analyst-bot

## Overview

Two related features that share a delivery layer, async execution pattern, and Neon
Postgres persistence. Build together to avoid schema conflicts.

---

## Feature 1: Scheduled / Recurring Reports

### What it does
Users can freeze a validated query and schedule it to run on a recurring basis
(daily, weekly, monthly). The bot re-runs the query on the cron schedule and DMs
the results to the user who created the schedule.

### User flow
1. User runs a query and gets a good result
2. User clicks "📅 Schedule This" button (new footer button on responses)
3. Bot opens a modal: frequency selector (daily / weekly / monthly), confirmation
4. User confirms — schedule is saved
5. On each scheduled run: bot re-runs the original query, formats result as
   normal Block Kit response, DMs it to the user with a header like
   "📅 Your scheduled report: [original question]"
6. User can cancel by DMing "cancel my schedules" or via App Home
   (show active schedules on Home tab with a Cancel button per schedule)

### Neon schema

```sql
CREATE TABLE bot_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,               -- Slack user ID
  user_email TEXT,                     -- for Google Doc sharing if needed
  question_text TEXT NOT NULL,         -- original natural language question
  frozen_sql TEXT NOT NULL,            -- exact SQL to re-run (from audit log)
  frequency TEXT NOT NULL,             -- 'daily' | 'weekly' | 'monthly'
  next_run_at TIMESTAMPTZ NOT NULL,    -- when to run next
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE,
  delivery_type TEXT DEFAULT 'slack_dm' -- 'slack_dm' | 'google_doc'
);
```

### Cron execution
- Use Google Cloud Scheduler to POST to a `/cron/run-schedules` HTTP endpoint
  on the Cloud Run service every 15 minutes
- The endpoint queries `bot_schedules` for all rows where `next_run_at <= NOW()`
  and `is_active = true`
- For each due schedule: re-run `frozen_sql` directly via BigQuery (bypass Claude —
  the SQL is already validated and frozen), format results, DM to `user_id`,
  update `last_run_at` and `next_run_at`
- Endpoint must be protected — check a `CRON_SECRET` header, reject all others
- `next_run_at` calculation:
  - daily: now + 24h
  - weekly: now + 7 days
  - monthly: same day next calendar month

### How to get `frozen_sql`
When user clicks "Schedule This", retrieve the most recent `sql_executed` from
the BigQuery audit table for their current thread:
```sql
SELECT sql_executed FROM `savvy-gtm-analytics.audit.analyst_bot_queries`
WHERE thread_id = @threadId
ORDER BY created_at DESC
LIMIT 1
```

### New Slack interactions required
- "📅 Schedule This" button on every response footer (alongside Export XLSX,
  Report Issue buttons)
- `app.action('schedule_this')` handler — opens modal
- `app.view('confirm_schedule')` handler — saves to Neon
- App Home: show active schedules section with Cancel buttons
- `app.action('cancel_schedule')` handler — sets `is_active = false`

---

## Feature 2: Google Docs Report Generation

### What it does
Users can request a multi-section analytical report. The bot orchestrates a
section-by-section Claude pipeline (each section is a scoped API call that won't
timeout), assembles the results into a Google Doc, and DMs the user a link.

### User flow
1. User sends a multi-section request, e.g.:
   "Generate a full Q1 recruiting report with sections for pipeline overview,
   SGA performance, funnel conversion by source, and AUM breakdown"
2. Bot detects report intent and replies: "Working on your report — I'll DM you
   when it's ready. This usually takes 2-3 minutes."
3. Bot runs async:
   a. Report planner Claude call: produce a structured outline (section titles +
      question per section)
   b. For each section in parallel (up to 3 concurrent):
      - Run the section question through the normal processMessage pipeline
      - Capture: narrative text, table data, chart PNG (if any)
   c. Create a Google Doc via Google Docs API
   d. For each section: insert heading → insert table → embed chart image →
      insert narrative paragraph
   e. Share the doc with the user's email (writer access)
   f. DM the user: "📄 Your Q1 Recruiting Report is ready: [link]"
4. Bot saves report record to Neon

### Report intent detection
Trigger report flow (not normal response) when the message contains any of:
- "generate a report"
- "create a report"
- "full analysis"
- "multi-section"
- "write me a report"
- "put together a report"

### Neon schema

```sql
CREATE TABLE bot_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  title TEXT NOT NULL,
  sections_json JSONB NOT NULL,       -- array of {title, question, status}
  status TEXT DEFAULT 'pending',      -- 'pending' | 'running' | 'done' | 'failed'
  google_doc_id TEXT,
  google_doc_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
```

### Google Docs API integration
- Auth: Google service account (same one used for Sheets export if it exists)
- Create doc: `docs.documents.create({ title })`
- Insert content: `docs.documents.batchUpdate` with structured InsertText,
  InsertTable, and InsertInlineImage requests
- Share with user: `drive.permissions.create({ type: 'user', role: 'writer',
  emailAddress: userEmail })`
- The service account creates and owns the doc, user gets editor access

### Chart embedding
- Render Chart.js PNG (existing charts.ts) → upload to Google Drive as temp file
  via `drive.files.create` → get fileId → embed via
  `InsertInlineImage` with `uri` pointing to Drive URL
- Delete temp Drive file after embedding (cleanup)

### Section orchestration
- Report planner prompt: "Given this user request, produce a JSON array of
  sections. Each section has: title (string), question (string to ask the
  analyst bot). Return ONLY the JSON array, no prose."
- Parse JSON response → array of sections
- Run up to 3 sections concurrently via Promise.allSettled
- If a section fails, insert a placeholder: "[Section failed to load]"
- Never let one section failure block the whole report

### How to get user email
The Slack Users API can return a user's email:
```typescript
const info = await client.users.info({ user: userId });
const email = info.user?.profile?.email;
```
This requires the `users:read.email` OAuth scope — confirm it is in the bot's
scope list.

---

## Shared Infrastructure

### Async execution pattern
Both features run long operations asynchronously after acking Slack. Both DM
results to the user. Use the same helper:

```typescript
async function dmUser(client: WebClient, userId: string, opts: {
  text: string;
  blocks?: KnownBlock[];
}): Promise<void>
```

DM channel = `userId` in Slack (posting to a user ID opens their DM with the bot).

### Environment variables required
```
# Existing (verify present)
SLACK_BOT_TOKEN=
SLACK_APP_TOKEN=
NEON_DATABASE_URL=
BIGQUERY_PROJECT_ID=

# New — Google Docs
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=

# New — Cron security
CRON_SECRET=

# New — optional if Sheets SA already exists
# GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL=  (may be same as above)
```

### Deployment additions required
- Cloud Scheduler job: POST to `/cron/run-schedules` every 15 minutes
- Cloud Run service must accept unauthenticated HTTP on `/cron/*` routes
  (protected by CRON_SECRET header check, not IAM)
- Google Docs API and Google Drive API must be enabled in GCP project
- Service account needs Drive and Docs API permissions

---

## Out of Scope for v1
- Email delivery (Slack DM only)
- Report editing or regeneration
- Schedule editing (cancel and recreate)
- Webhook-based schedule triggers
- PDF export of Google Docs
- Report sharing with multiple users