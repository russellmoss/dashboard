# Build Implementation Guide: Scheduled Reports + Google Docs Report Generation

> **Target:** `packages/analyst-bot/`
> **Features:** (1) Scheduled/recurring query delivery via Slack DM, (2) Multi-section Google Docs report generation
> **Spec:** `specs/scheduled-reports-and-gdocs.md`
> **Exploration:** `specs/exploration-results.md` (13 spec gaps addressed)

---

## Phase 0: Scaffold

### 0.1 Install googleapis

```bash
cd packages/analyst-bot
npm install googleapis
```

### 0.2 SQL Migrations

Run these against Neon Postgres (`DATABASE_URL`):

```sql
-- bot_schedules: recurring query schedules with named reports and delivery time control
CREATE TABLE bot_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  user_email TEXT,
  report_name TEXT NOT NULL,           -- user-defined name: "Weekly SGA Leaderboard"
  question_text TEXT NOT NULL,         -- natural language prompt
  frozen_sql TEXT NOT NULL,            -- validated SQL from preview run
  frequency TEXT NOT NULL,             -- 'daily' | 'weekly' | 'monthly'
  deliver_at_hour INTEGER NOT NULL DEFAULT 9,  -- UTC hour 0-23
  delivery_type TEXT DEFAULT 'slack_dm',       -- 'slack_dm' | 'google_doc'
  next_run_at TIMESTAMPTZ NOT NULL,
  last_run_at TIMESTAMPTZ,
  failure_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE
);

CREATE INDEX idx_schedules_due ON bot_schedules (next_run_at)
  WHERE is_active = TRUE;

CREATE INDEX idx_schedules_user ON bot_schedules (user_id)
  WHERE is_active = TRUE;

-- bot_reports: Google Docs report records
CREATE TABLE bot_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  title TEXT NOT NULL,
  sections_json JSONB NOT NULL,
  status TEXT DEFAULT 'pending',    -- 'pending' | 'running' | 'done' | 'failed'
  google_doc_id TEXT,
  google_doc_url TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_reports_user ON bot_reports (user_id);
```

### 0.3 Update `.env.example`

Add these lines to the bottom of `.env.example`:

```
# Google Docs / Drive — service account credentials (stringified JSON or individual fields)
GOOGLE_DOCS_CREDENTIALS_JSON={"type":"service_account","project_id":"...","private_key":"...","client_email":"..."}

# Cron endpoint security
CRON_SECRET=a-random-32-char-hex-for-cloud-scheduler

# Admin — comma-separated Slack user IDs who see the admin App Home view
ADMIN_SLACK_USER_IDS=U09DX3U7UTW
```

### 0.3b — Run Neon Migrations (REQUIRED before validation)

The TypeScript build passes regardless of whether the Neon tables exist.
However `schedule-store.ts` and `report-store.ts` will throw
`"relation does not exist"` errors at runtime if you skip this step.

Run the DDL from Phase 0.2 against your Neon database now.

**Option A — Neon console:**
Open https://console.neon.tech → your project → SQL Editor →
paste and run both CREATE TABLE blocks from Phase 0.2.

**Option B — psql:**
```bash
psql $DATABASE_URL \
  -c "CREATE TABLE IF NOT EXISTS bot_schedules ..." \
  -c "CREATE TABLE IF NOT EXISTS bot_reports ..."
```
(paste the full DDL from Phase 0.2)

**Verify tables exist:**
```bash
psql $DATABASE_URL -c "\dt bot_schedules" -c "\dt bot_reports"
```
PASS: Both tables listed
FAIL: `"Did not find any relation"` — run the DDL before proceeding

**Do not proceed to Phase 1 until both tables exist.**

### 0.4 Validation Gate

```bash
npx tsc --noEmit
```

Must pass with zero errors (no code changes yet, only infra).

---

## Phase 1: Types (extend `src/types.ts`)

Append the following type definitions to the end of `src/types.ts`:

```typescript
// ============================================================================
// Scheduled Reports + Google Docs Report Generation types
// ============================================================================

/**
 * Frequency for scheduled recurring reports.
 */
export type ScheduleFrequency = 'daily' | 'weekly' | 'monthly';

/**
 * A scheduled recurring report persisted in Neon Postgres (bot_schedules table).
 * Users create these via the Report Builder modal (App Home or "Schedule This" shortcut).
 */
export interface ScheduleRecord {
  id: string;
  userId: string;
  userEmail: string | null;
  reportName: string;
  questionText: string;
  frozenSql: string;
  frequency: ScheduleFrequency;
  deliverAtHour: number;        // UTC hour 0-23
  deliveryType: 'slack_dm' | 'google_doc';
  nextRunAt: Date;
  lastRunAt: Date | null;
  failureCount: number;
  createdAt: Date;
  isActive: boolean;
}

/**
 * Status of a single section within a generated report.
 */
export type ReportSectionStatus = 'pending' | 'running' | 'done' | 'failed';

/**
 * A section in a multi-section report (stored in bot_reports.sections_json).
 */
export interface ReportSection {
  title: string;
  question: string;
  status: ReportSectionStatus;
  narrativeText?: string;
  errorMessage?: string;
}

/**
 * Result of processing a single report section through the Claude pipeline.
 */
export interface SectionResult {
  title: string;
  text: string;
  chartBuffer: Buffer | null;
  tableData: Record<string, any>[] | null;
}

/**
 * Status of a generated report.
 */
export type ReportStatus = 'pending' | 'running' | 'done' | 'failed';

/**
 * A generated report record persisted in Neon Postgres (bot_reports table).
 */
export interface ReportRecord {
  id: string;
  userId: string;
  userEmail: string;
  title: string;
  sectionsJson: ReportSection[];
  status: ReportStatus;
  googleDocId: string | null;
  googleDocUrl: string | null;
  errorMessage: string | null;
  createdAt: Date;
  completedAt: Date | null;
}
```

### Validation Gate

```bash
npx tsc --noEmit
```

---

## Phase 2a: DM Helper (`src/dm-helper.ts` — new file)

Create `src/dm-helper.ts`:

```typescript
// packages/analyst-bot/src/dm-helper.ts
// ============================================================================
// Slack DM delivery helper — conversations.open + chat.postMessage
// ============================================================================
//
// The Slack API requires calling conversations.open to get a DM channel ID
// before posting. You CANNOT post to a userId directly via chat.postMessage.
// This module caches DM channel IDs in-memory to avoid repeated API calls.

import type { WebClient } from '@slack/web-api';
import type { KnownBlock } from '@slack/types';

// In-memory DM channel ID cache: Slack userId → DM channelId
const dmChannelCache = new Map<string, string>();

/**
 * Send a direct message to a Slack user.
 * Opens a DM channel if needed (cached after first call).
 * Never throws — logs errors and returns silently.
 */
export async function dmUser(
  client: WebClient,
  userId: string,
  opts: {
    text: string;
    blocks?: KnownBlock[];
  }
): Promise<void> {
  try {
    // Resolve DM channel (cached)
    let channelId = dmChannelCache.get(userId);
    if (!channelId) {
      const dm = await client.conversations.open({ users: userId });
      channelId = dm.channel?.id;
      if (!channelId) {
        console.error(`[dm-helper] conversations.open returned no channel for user ${userId}`);
        return;
      }
      dmChannelCache.set(userId, channelId);
    }

    await client.chat.postMessage({
      channel: channelId,
      text: opts.text,
      ...(opts.blocks ? { blocks: opts.blocks } : {}),
    });
  } catch (err) {
    console.error(`[dm-helper] Failed to DM user ${userId}:`, (err as Error).message);
  }
}
```

### Validation Gate

```bash
npx tsc --noEmit
```

---

## Phase 2b: Schedule Store (`src/schedule-store.ts` — new file)

> **NOTE:** `getPool()` in `thread-store.ts` is NOT exported. Rather than modifying
> that file and risking regressions, we duplicate the singleton pool pattern here.
> Both pools share the same `DATABASE_URL` and Neon will multiplex connections.

Create `src/schedule-store.ts`:

```typescript
// packages/analyst-bot/src/schedule-store.ts
// ============================================================================
// Neon Postgres CRUD for bot_schedules table
// ============================================================================

import { Pool } from 'pg';
import { ScheduleRecord, ScheduleFrequency } from './types';

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set');
    }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }
  return pool;
}

/**
 * Compute the next run timestamp based on frequency.
 * - daily: +24 hours
 * - weekly: +7 days
 * - monthly: same day next month, clamped to last day if needed (e.g., Jan 31 → Feb 28)
 *
 * Respects deliverAtHour: schedules fire at the specified UTC hour each period.
 * All timestamps are UTC. DST drift is expected for daily schedules — documented as known behavior.
 */
export function computeNextRunAt(frequency: ScheduleFrequency, deliverAtHour: number = 9): Date {
  const now = new Date();
  const next = new Date(now);

  // Set to the target hour today
  next.setUTCHours(deliverAtHour, 0, 0, 0);

  // If that time has already passed today, advance by one frequency period
  if (next <= now) {
    switch (frequency) {
      case 'daily':
        next.setUTCDate(next.getUTCDate() + 1);
        break;
      case 'weekly':
        next.setUTCDate(next.getUTCDate() + 7);
        break;
      case 'monthly': {
        const targetDay = next.getUTCDate();
        const targetMonth = next.getUTCMonth() + 1;
        next.setUTCMonth(targetMonth);
        // Clamp to last day of month if the target day doesn't exist
        if (next.getUTCMonth() !== targetMonth % 12) {
          next.setUTCDate(0); // rolls back to last day of intended month
        }
        break;
      }
    }
  }

  return next;
}

function rowToSchedule(row: any): ScheduleRecord {
  return {
    id: row.id,
    userId: row.user_id,
    userEmail: row.user_email,
    reportName: row.report_name,
    questionText: row.question_text,
    frozenSql: row.frozen_sql,
    frequency: row.frequency as ScheduleFrequency,
    deliverAtHour: row.deliver_at_hour ?? 9,
    deliveryType: row.delivery_type ?? 'slack_dm',
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    failureCount: row.failure_count ?? 0,
    createdAt: row.created_at,
    isActive: row.is_active,
  };
}

/**
 * Create a new schedule. Returns the created record.
 */
export async function createSchedule(params: {
  userId: string;
  userEmail: string | null;
  reportName: string;
  questionText: string;
  frozenSql: string;
  frequency: ScheduleFrequency;
  deliverAtHour: number;
  deliveryType?: 'slack_dm' | 'google_doc';
  nextRunAt?: Date;
}): Promise<ScheduleRecord> {
  const nextRunAt = params.nextRunAt ?? computeNextRunAt(params.frequency, params.deliverAtHour);
  const result = await getPool().query(
    `INSERT INTO bot_schedules
       (user_id, user_email, report_name, question_text, frozen_sql, frequency, deliver_at_hour, delivery_type, next_run_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      params.userId, params.userEmail, params.reportName, params.questionText,
      params.frozenSql, params.frequency, params.deliverAtHour,
      params.deliveryType ?? 'slack_dm', nextRunAt,
    ]
  );
  return rowToSchedule(result.rows[0]);
}

/**
 * Get all schedules that are due to run (next_run_at <= NOW() and is_active = true).
 */
export async function getDueSchedules(): Promise<ScheduleRecord[]> {
  const result = await getPool().query(
    `SELECT * FROM bot_schedules
     WHERE is_active = TRUE AND next_run_at <= NOW()
     ORDER BY next_run_at ASC`
  );
  return result.rows.map(rowToSchedule);
}

/**
 * Mark a schedule as having just run. Updates last_run_at and advances next_run_at.
 */
export async function markScheduleRun(scheduleId: string): Promise<void> {
  const now = new Date();
  const schedule = await getPool().query(
    `SELECT frequency FROM bot_schedules WHERE id = $1`,
    [scheduleId]
  );
  if (schedule.rows.length === 0) return;

  const frequency = schedule.rows[0].frequency as ScheduleFrequency;
  const nextRunAt = computeNextRunAt(frequency, now);

  await getPool().query(
    `UPDATE bot_schedules
     SET last_run_at = $1, next_run_at = $2
     WHERE id = $3`,
    [now, nextRunAt, scheduleId]
  );
}

/**
 * Cancel a schedule (soft delete — sets is_active = false).
 */
export async function cancelSchedule(scheduleId: string): Promise<void> {
  await getPool().query(
    `UPDATE bot_schedules SET is_active = FALSE WHERE id = $1`,
    [scheduleId]
  );
}

/**
 * Get all active schedules for a given user (for App Home display).
 */
export async function getActiveSchedulesForUser(userId: string): Promise<ScheduleRecord[]> {
  const result = await getPool().query(
    `SELECT * FROM bot_schedules
     WHERE user_id = $1 AND is_active = TRUE
     ORDER BY created_at DESC`,
    [userId]
  );
  return result.rows.map(rowToSchedule);
}

/**
 * Get ALL active schedules across all users — admin only.
 * Returns schedules ordered by user then next_run_at for grouped display.
 */
export async function getAllSchedules(): Promise<ScheduleRecord[]> {
  try {
    const result = await getPool().query(
      `SELECT * FROM bot_schedules
       WHERE is_active = TRUE
       ORDER BY user_id, next_run_at ASC`
    );
    return result.rows.map(rowToSchedule);
  } catch (err) {
    console.error('[schedule-store] getAllSchedules failed:', (err as Error).message);
    return [];
  }
}

/**
 * Admin cancel — cancel any schedule by ID regardless of owner.
 */
export async function adminCancelSchedule(scheduleId: string): Promise<void> {
  await getPool().query(
    `UPDATE bot_schedules SET is_active = FALSE WHERE id = $1`,
    [scheduleId]
  );
}
```

### Validation Gate

```bash
npx tsc --noEmit
```

---

## Phase 2c: Google Docs Client (`src/google-docs.ts` — new file)

Create `src/google-docs.ts`:

```typescript
// packages/analyst-bot/src/google-docs.ts
// ============================================================================
// Google Docs + Drive client for report generation
// ============================================================================
//
// Auth: JWT with service account from GOOGLE_DOCS_CREDENTIALS_JSON env var.
// The private key stored in Cloud Run env vars has literal "\n" (two chars)
// that must be replaced with actual newline chars before JWT construction.
//
// KEY GOTCHAS (from exploration-results.md):
// - Use endOfSegmentLocation: {} to append at end of doc (avoids index tracking)
// - updateParagraphStyle REQUIRES fields: 'namedStyleType' — omitting causes 400
// - Table cell population must be done bottom-up (sort by index descending)
// - InsertInlineImage requires a publicly-accessible URI
// - After uploading chart to Drive, create anyone/reader permission before embed

import { google, docs_v1, drive_v3 } from 'googleapis';
import { JWT } from 'google-auth-library';

let docsClient: docs_v1.Docs | null = null;
let driveClient: drive_v3.Drive | null = null;

/**
 * Parse credentials from GOOGLE_DOCS_CREDENTIALS_JSON env var and build a JWT.
 */
function getAuth(): JWT {
  const credsJson = process.env.GOOGLE_DOCS_CREDENTIALS_JSON;
  if (!credsJson) {
    throw new Error('GOOGLE_DOCS_CREDENTIALS_JSON is not set');
  }

  const creds = JSON.parse(credsJson);

  // CRITICAL: Cloud Run stores \n as literal two characters in env vars.
  // Must replace before passing to JWT constructor.
  const privateKey = creds.private_key.replace(/\\n/g, '\n');

  return new JWT({
    email: creds.client_email,
    key: privateKey,
    scopes: [
      'https://www.googleapis.com/auth/documents',
      'https://www.googleapis.com/auth/drive',
    ],
  });
}

function getDocs(): docs_v1.Docs {
  if (!docsClient) {
    docsClient = google.docs({ version: 'v1', auth: getAuth() });
  }
  return docsClient;
}

function getDrive(): drive_v3.Drive {
  if (!driveClient) {
    driveClient = google.drive({ version: 'v3', auth: getAuth() });
  }
  return driveClient;
}

// Root Google Drive folder for all analyst bot reports
const REPORTS_ROOT_FOLDER_ID = '1Gxyv3Ce70IMiTB9Vxg_2ZDKfoIMktT65';

/**
 * Find or create a per-user subfolder under the reports root folder.
 * Pattern copied from src/app/api/sqo-lag-export/route.ts — same SA, same approach.
 * Caches folder IDs in-memory to avoid repeated Drive API calls.
 */
const userFolderCache = new Map<string, string>();

async function getOrCreateUserFolder(userName: string): Promise<string> {
  const cached = userFolderCache.get(userName);
  if (cached) return cached;

  try {
    const drive = getDrive();
    // Search for existing folder by name
    const search = await drive.files.list({
      q: `name='${userName.replace(/'/g, "\\'")}' and '${REPORTS_ROOT_FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id,name)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    if (search.data.files && search.data.files.length > 0) {
      const folderId = search.data.files[0].id!;
      userFolderCache.set(userName, folderId);
      return folderId;
    }

    // Create new subfolder
    const folder = await drive.files.create({
      requestBody: {
        name: userName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [REPORTS_ROOT_FOLDER_ID],
      },
      supportsAllDrives: true,
    });
    const folderId = folder.data.id!;
    userFolderCache.set(userName, folderId);
    return folderId;
  } catch (err) {
    console.error(`[google-docs] Failed to create user folder for ${userName}:`, (err as Error).message);
    return REPORTS_ROOT_FOLDER_ID; // fallback to root folder
  }
}

/**
 * Create a new Google Doc in the user's subfolder. Returns the doc ID and URL.
 *
 * CRITICAL: Must use drive.files.create with parents:[folderId], NOT
 * docs.documents.create — the SA has zero Drive storage quota, so creating
 * docs in the SA's root Drive fails with "quota exceeded". Creating directly
 * in a shared folder bypasses this limitation.
 */
export async function createDoc(
  title: string,
  userName: string
): Promise<{ docId: string; docUrl: string }> {
  try {
    const drive = getDrive();
    const folderId = await getOrCreateUserFolder(userName);

    const res = await drive.files.create({
      requestBody: {
        name: title,
        mimeType: 'application/vnd.google-apps.document',
        parents: [folderId],
      },
      supportsAllDrives: true,
      fields: 'id,webViewLink',
    });
    const docId = res.data.id!;
    const docUrl = res.data.webViewLink ?? `https://docs.google.com/document/d/${docId}/edit`;
    return { docId, docUrl };
  } catch (err) {
    throw new Error(`[google-docs] Failed to create doc: ${(err as Error).message}`);
  }
}

/**
 * Append a heading to the end of the document.
 * Uses endOfSegmentLocation to avoid manual index tracking.
 */
export async function appendHeading(
  docId: string,
  text: string,
  level: 1 | 2 | 3 = 1
): Promise<void> {
  try {
    const docs = getDocs();

    // First, insert the text at the end of the document
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [
          {
            insertText: {
              endOfSegmentLocation: {},
              text: text + '\n',
            },
          },
        ],
      },
    });

    // Fetch the document to find the index of the text we just inserted
    const doc = await docs.documents.get({ documentId: docId });
    const body = doc.data.body?.content ?? [];
    const lastElement = body[body.length - 2]; // -2 because last is always empty paragraph
    if (!lastElement?.startIndex) return;

    const namedStyleMap: Record<number, string> = {
      1: 'HEADING_1',
      2: 'HEADING_2',
      3: 'HEADING_3',
    };

    // Apply heading style to the paragraph we just inserted
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [
          {
            updateParagraphStyle: {
              range: {
                startIndex: lastElement.startIndex,
                endIndex: lastElement.endIndex! - 1,
              },
              paragraphStyle: {
                namedStyleType: namedStyleMap[level] ?? 'HEADING_1',
              },
              fields: 'namedStyleType', // REQUIRED — omitting causes 400 error
            },
          },
        ],
      },
    });
  } catch (err) {
    console.error(`[google-docs] appendHeading failed:`, (err as Error).message);
    throw err;
  }
}

/**
 * Append a paragraph of plain text to the end of the document.
 */
export async function appendParagraph(docId: string, text: string): Promise<void> {
  try {
    const docs = getDocs();
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [
          {
            insertText: {
              endOfSegmentLocation: {},
              text: text + '\n\n',
            },
          },
        ],
      },
    });
  } catch (err) {
    console.error(`[google-docs] appendParagraph failed:`, (err as Error).message);
    throw err;
  }
}

/**
 * Append a table to the end of the document.
 *
 * CRITICAL: Table cell population must be done bottom-up (sort by index descending).
 * After inserting an empty table, we fetch the doc to get the cell indices, then
 * populate cells from the last row/cell to the first. This prevents index shifts
 * from invalidating subsequent insertions.
 */
export async function appendTable(
  docId: string,
  headers: string[],
  rows: string[][]
): Promise<void> {
  if (headers.length === 0) return;

  try {
    const docs = getDocs();
    const numRows = rows.length + 1; // +1 for header row
    const numCols = headers.length;

    // Insert an empty table at the end of the document
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [
          {
            insertTable: {
              endOfSegmentLocation: {},
              rows: numRows,
              columns: numCols,
            },
          },
        ],
      },
    });

    // Fetch the document to find the table's cell indices
    const doc = await docs.documents.get({ documentId: docId });
    const body = doc.data.body?.content ?? [];

    // Find the last table in the document (the one we just inserted)
    let table: docs_v1.Schema$Table | null = null;
    for (let i = body.length - 1; i >= 0; i--) {
      if (body[i].table) {
        table = body[i].table!;
        break;
      }
    }
    if (!table || !table.tableRows) return;

    // Build cell insertions — MUST be sorted by index descending (bottom-up)
    // to prevent index shifts from invalidating subsequent insertions
    const insertions: Array<{ index: number; text: string }> = [];

    // Header row (row 0)
    for (let c = 0; c < numCols; c++) {
      const cell = table.tableRows[0]?.tableCells?.[c];
      const idx = cell?.content?.[0]?.startIndex;
      if (idx != null) {
        insertions.push({ index: idx, text: headers[c] ?? '' });
      }
    }

    // Data rows
    for (let r = 0; r < rows.length; r++) {
      const tableRow = table.tableRows[r + 1]; // +1 to skip header
      if (!tableRow?.tableCells) continue;
      for (let c = 0; c < numCols; c++) {
        const cell = tableRow.tableCells[c];
        const idx = cell?.content?.[0]?.startIndex;
        if (idx != null) {
          insertions.push({ index: idx, text: rows[r][c] ?? '' });
        }
      }
    }

    // Sort by index DESCENDING — bottom-up to prevent index shift corruption
    insertions.sort((a, b) => b.index - a.index);

    // Batch insert all cell contents
    if (insertions.length > 0) {
      await docs.documents.batchUpdate({
        documentId: docId,
        requestBody: {
          requests: insertions.map((ins) => ({
            insertText: {
              location: { index: ins.index },
              text: ins.text,
            },
          })),
        },
      });
    }

    // Bold the header row
    const headerRow = table.tableRows[0];
    if (headerRow?.tableCells) {
      const firstCellIdx = headerRow.tableCells[0]?.content?.[0]?.startIndex;
      const lastCell = headerRow.tableCells[headerRow.tableCells.length - 1];
      const lastCellEnd = lastCell?.content?.[0]?.endIndex;
      if (firstCellIdx != null && lastCellEnd != null) {
        // Re-fetch doc since indices shifted after insertions
        const updated = await docs.documents.get({ documentId: docId });
        const updatedBody = updated.data.body?.content ?? [];
        let updatedTable: docs_v1.Schema$Table | null = null;
        for (let i = updatedBody.length - 1; i >= 0; i--) {
          if (updatedBody[i].table) {
            updatedTable = updatedBody[i].table!;
            break;
          }
        }
        if (updatedTable?.tableRows?.[0]?.tableCells) {
          const hRow = updatedTable.tableRows[0];
          const startIdx = hRow.tableCells![0]?.content?.[0]?.startIndex;
          const endCell = hRow.tableCells![hRow.tableCells!.length - 1];
          const endIdx = endCell?.content?.[endCell.content!.length - 1]?.endIndex;
          if (startIdx != null && endIdx != null) {
            await docs.documents.batchUpdate({
              documentId: docId,
              requestBody: {
                requests: [{
                  updateTextStyle: {
                    range: { startIndex: startIdx, endIndex: endIdx },
                    textStyle: { bold: true },
                    fields: 'bold',
                  },
                }],
              },
            });
          }
        }
      }
    }
  } catch (err) {
    console.error(`[google-docs] appendTable failed:`, (err as Error).message);
    throw err;
  }
}

/**
 * Upload a chart PNG to Google Drive, make it publicly readable, embed it in the
 * doc via InsertInlineImage, then delete the temp Drive file.
 *
 * InsertInlineImage requires a publicly-accessible URI (Docs API fetches server-side).
 * We create an anyone/reader permission on the temp Drive file, use the direct
 * download URL for embedding, then clean up the temp file.
 */
export async function embedChartImage(docId: string, chartBuffer: Buffer): Promise<void> {
  let tempFileId: string | null = null;

  try {
    const drive = getDrive();
    const docs = getDocs();

    // 1. Upload chart PNG to Drive as a temp file
    const { Readable } = require('stream');
    const stream = new Readable();
    stream.push(chartBuffer);
    stream.push(null);

    const uploadRes = await drive.files.create({
      requestBody: {
        name: `chart_${Date.now()}.png`,
        mimeType: 'image/png',
      },
      media: {
        mimeType: 'image/png',
        body: stream,
      },
      fields: 'id',
    });
    tempFileId = uploadRes.data.id!;

    // 2. Make the file publicly readable (required for InsertInlineImage)
    await drive.permissions.create({
      fileId: tempFileId,
      requestBody: {
        type: 'anyone',
        role: 'reader',
      },
    });

    // 3. Build the direct download URL
    const imageUri = `https://drive.google.com/uc?export=download&id=${tempFileId}`;

    // 4. Insert the image at the end of the document
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [
          {
            insertInlineImage: {
              endOfSegmentLocation: {},
              uri: imageUri,
              objectSize: {
                width: { magnitude: 500, unit: 'PT' },
                height: { magnitude: 312, unit: 'PT' }, // 800x500 aspect ratio
              },
            },
          },
          {
            insertText: {
              endOfSegmentLocation: {},
              text: '\n',
            },
          },
        ],
      },
    });
  } catch (err) {
    console.error(`[google-docs] embedChartImage failed:`, (err as Error).message);
    // Don't throw — chart embed failure should not block the entire report
  } finally {
    // 5. Delete the temp Drive file (cleanup)
    if (tempFileId) {
      try {
        const drive = getDrive();
        await drive.files.delete({ fileId: tempFileId });
      } catch (cleanupErr) {
        console.error(`[google-docs] Failed to clean up temp chart file ${tempFileId}:`, (cleanupErr as Error).message);
      }
    }
  }
}

/**
 * Share a Google Doc with a user (writer access).
 * Uses Drive permissions API. Sends email notification by default.
 */
export async function shareDoc(docId: string, email: string): Promise<void> {
  try {
    const drive = getDrive();
    await drive.permissions.create({
      fileId: docId,
      requestBody: {
        type: 'user',
        role: 'writer',
        emailAddress: email,
      },
      sendNotificationEmail: false,
    });
  } catch (err) {
    console.error(`[google-docs] shareDoc failed for ${email}:`, (err as Error).message);
    // Don't throw — sharing failure should not block the report. User can request access.
  }
}
```

### Validation Gate

```bash
npx tsc --noEmit
```

---

## Phase 3a: Schedule Runner (`src/schedule-runner.ts` — new file)

Create `src/schedule-runner.ts`:

```typescript
// packages/analyst-bot/src/schedule-runner.ts
// ============================================================================
// Cron handler: run all due schedules and DM results to users
// ============================================================================

import type { WebClient } from '@slack/web-api';
import type { KnownBlock } from '@slack/types';
import { getDueSchedules, markScheduleRun } from './schedule-store';
import { runExportQuery } from './bq-query';
import { dmUser } from './dm-helper';
import type { ScheduleRecord } from './types';

/**
 * Format query result rows as a simple text table for Slack DM.
 * Handles 0 rows, capped at 20 rows for readability.
 */
function formatResultsAsText(rows: Record<string, any>[]): string {
  if (rows.length === 0) return '';

  const keys = Object.keys(rows[0]);
  const displayRows = rows.slice(0, 20);

  // Calculate column widths
  const widths: Record<string, number> = {};
  for (const key of keys) {
    widths[key] = key.length;
    for (const row of displayRows) {
      const val = String(row[key] ?? '');
      widths[key] = Math.max(widths[key], val.length);
    }
  }

  // Build text table
  const header = keys.map((k) => k.padEnd(widths[k])).join(' | ');
  const separator = keys.map((k) => '-'.repeat(widths[k])).join('-+-');
  const dataLines = displayRows.map((row) =>
    keys.map((k) => String(row[k] ?? '').padEnd(widths[k])).join(' | ')
  );

  let table = `\`\`\`\n${header}\n${separator}\n${dataLines.join('\n')}\n\`\`\``;
  if (rows.length > 20) {
    table += `\n_...and ${rows.length - 20} more rows_`;
  }

  return table;
}

/**
 * Run a single schedule: execute frozen SQL, format results, DM user.
 */
async function runSingleSchedule(
  client: WebClient,
  schedule: ScheduleRecord
): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await runExportQuery(schedule.frozenSql);

    if (result.rows.length === 0) {
      // Spec gap #5: handle 0-row results
      await dmUser(client, schedule.userId, {
        text: `Your scheduled report "${schedule.questionText}" returned no results this run.`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `:calendar: *Scheduled Report: No Results*\n\nYour report _"${schedule.questionText}"_ ran but returned no data this period.`,
            },
          },
        ] as KnownBlock[],
      });
    } else {
      const tableText = formatResultsAsText(result.rows);
      await dmUser(client, schedule.userId, {
        text: `Your scheduled report: ${schedule.questionText}`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `:calendar: *Scheduled Report*\n*${schedule.questionText}*`,
            },
          },
          { type: 'divider' },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: tableText,
            },
          },
          {
            type: 'context',
            elements: [{
              type: 'mrkdwn',
              text: `:repeat: _${schedule.frequency}_ · ${result.rows.length} rows · ${(result.bytesProcessed / 1048576).toFixed(1)} MB scanned`,
            }],
          },
        ] as KnownBlock[],
      });
    }

    // Update schedule timestamps
    await markScheduleRun(schedule.id);
    return { success: true };
  } catch (err) {
    const errorMsg = (err as Error).message;
    console.error(`[schedule-runner] Schedule ${schedule.id} failed:`, errorMsg);

    // DM the user about the failure
    await dmUser(client, schedule.userId, {
      text: `Your scheduled report failed: ${errorMsg}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:warning: *Scheduled Report Failed*\n\nYour report _"${schedule.questionText}"_ encountered an error:\n\`${errorMsg.substring(0, 500)}\``,
          },
        },
      ] as KnownBlock[],
    });

    // Still advance the schedule so it doesn't retry forever
    try {
      await markScheduleRun(schedule.id);
    } catch {
      // Non-critical
    }

    return { success: false, error: errorMsg };
  }
}

/**
 * Main cron entry point: find all due schedules and run them.
 * Called by the /internal/run-schedules endpoint.
 *
 * Returns a summary of results for the HTTP response.
 */
export async function runDueSchedules(
  client: WebClient
): Promise<{ ran: number; succeeded: number; failed: number }> {
  const due = await getDueSchedules();
  console.log(`[schedule-runner] Found ${due.length} due schedules`);

  if (due.length === 0) {
    return { ran: 0, succeeded: 0, failed: 0 };
  }

  let succeeded = 0;
  let failed = 0;

  // Run schedules sequentially to avoid overwhelming BQ / Slack rate limits
  for (const schedule of due) {
    const result = await runSingleSchedule(client, schedule);
    if (result.success) {
      succeeded++;
    } else {
      failed++;
    }
  }

  console.log(`[schedule-runner] Complete: ${succeeded} succeeded, ${failed} failed out of ${due.length}`);
  return { ran: due.length, succeeded, failed };
}
```

### Validation Gate

```bash
npx tsc --noEmit
```

---

## Phase 3b: Report Generator (`src/report-generator.ts` — new file)

Create `src/report-generator.ts`:

```typescript
// packages/analyst-bot/src/report-generator.ts
// ============================================================================
// Google Docs report orchestrator: detect intent, plan sections, run through
// Claude pipeline concurrently, assemble into a Google Doc, DM the link.
// ============================================================================

import type { WebClient } from '@slack/web-api';
import { callClaude } from './claude';
import { processMessage } from './conversation';
import { parseChartBlock, renderChart, stripChartBlocks } from './charts';
import {
  createDoc,
  appendHeading,
  appendParagraph,
  appendTable,
  embedChartImage,
  shareDoc,
} from './google-docs';
import { dmUser } from './dm-helper';
import { createReport, updateReportStatus } from './report-store';
import type { ReportSection, SectionResult } from './types';

/**
 * Detect if a user message is a report request.
 *
 * Spec gap #8: The original spec's triggers were too broad ("full analysis").
 * We require the word "report" to be present in the trigger phrase.
 */
const REPORT_PATTERNS = [
  /\bgenerate\s+(?:a\s+)?report\b/i,
  /\bcreate\s+(?:a\s+)?report\b/i,
  /\bwrite\s+(?:me\s+)?(?:a\s+)?report\b/i,
  /\bput\s+together\s+(?:a\s+)?report\b/i,
  /\bbuild\s+(?:me\s+)?(?:a\s+)?report\b/i,
  /\bmulti[- ]section\s+report\b/i,
];

export function isReportRequest(text: string): boolean {
  return REPORT_PATTERNS.some((re) => re.test(text));
}

/**
 * Ask Claude to plan report sections from the user's request.
 * Returns a structured array of sections with titles and questions.
 */
async function planSections(userText: string): Promise<ReportSection[]> {
  const plannerPrompt = `You are a report planner. Given the user request below, produce a JSON array of sections for a data report. Each section has:
- title (string): A clear section heading
- question (string): The specific question to ask the data analyst bot to fill this section

Return ONLY a valid JSON array, no markdown fences, no prose. Limit to 6 sections max.

User request: "${userText}"`;

  const response = await callClaude(
    [{ role: 'user', content: plannerPrompt }],
    { maxTokens: 2048 }
  );

  const jsonText = response.text.trim();

  // Try to parse the JSON (Claude sometimes wraps in ```json ... ```)
  let cleaned = jsonText;
  const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  let sections: Array<{ title: string; question: string }>;
  try {
    sections = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`[report-generator] Failed to parse section plan: ${(err as Error).message}`);
  }

  if (!Array.isArray(sections) || sections.length === 0) {
    throw new Error('[report-generator] Section plan returned empty or non-array');
  }

  return sections.slice(0, 6).map((s) => ({
    title: s.title,
    question: s.question,
    status: 'pending' as const,
  }));
}

/**
 * Process a single report section through the Claude pipeline.
 * Captures narrative text, optional chart buffer, and optional table data.
 */
async function processSection(
  section: ReportSection,
  sectionIndex: number,
  userId: string,
  channelId: string
): Promise<SectionResult> {
  // Use a unique thread ID per section to avoid context cross-contamination
  const threadId = `report:${userId}:${Date.now()}:s${sectionIndex}`;

  const result = await processMessage(
    section.question,
    threadId,
    channelId,
    userId
  );

  // Parse table data from markdown tables in the response
  let tableData: Record<string, any>[] | null = null;
  const tableMatch = result.text.match(/\|(.+)\|\n\|[-| ]+\|\n((?:\|.+\|\n?)+)/);
  if (tableMatch) {
    const headers = tableMatch[1].split('|').map((h: string) => h.trim()).filter(Boolean);
    const dataRows = tableMatch[2].trim().split('\n').map((row: string) =>
      row.split('|').map((c: string) => c.trim()).filter(Boolean)
    );
    tableData = dataRows.map((row: string[]) => {
      const obj: Record<string, any> = {};
      headers.forEach((h: string, i: number) => {
        obj[h] = row[i] ?? '';
      });
      return obj;
    });
  }

  return {
    title: section.title,
    text: result.text,
    chartBuffer: result.chartBuffer,
    tableData,
  };
}

/**
 * Main report generation orchestrator.
 *
 * 1. Plan sections via Claude
 * 2. Run sections concurrently (max 3 at a time) via processMessage
 * 3. Create Google Doc
 * 4. Assemble sections into doc (heading + narrative + table + chart)
 * 5. Share doc with user
 * 6. Persist report record
 * 7. DM user the link
 */
export async function generateReport(
  client: WebClient,
  userId: string,
  userEmail: string,
  userName: string,
  text: string,
  channelId: string
): Promise<string> {
  // Create initial report record
  let sections: ReportSection[] = [];
  let reportId: string | null = null;

  try {
    // Step 1: Plan sections
    sections = await planSections(text);

    // Create report record in Neon
    const report = await createReport({
      userId,
      userEmail,
      title: `Report: ${text.substring(0, 100)}`,
      sectionsJson: sections,
    });
    reportId = report.id;

    await updateReportStatus(reportId, 'running', { sectionsJson: sections });

    // Step 2: Run sections concurrently (up to 3 at a time)
    const CONCURRENCY = 3;
    const results: SectionResult[] = [];

    for (let i = 0; i < sections.length; i += CONCURRENCY) {
      const batch = sections.slice(i, i + CONCURRENCY);
      const batchPromises = batch.map((section, batchIdx) =>
        processSection(section, i + batchIdx, userId, channelId)
      );

      const settled = await Promise.allSettled(batchPromises);

      for (let j = 0; j < settled.length; j++) {
        const outcome = settled[j];
        const sectionIdx = i + j;

        if (outcome.status === 'fulfilled') {
          results.push(outcome.value);
          sections[sectionIdx].status = 'done';
          sections[sectionIdx].narrativeText = outcome.value.text.substring(0, 5000);
        } else {
          const errMsg = outcome.reason?.message ?? 'Unknown error';
          console.error(`[report-generator] Section "${sections[sectionIdx].title}" failed:`, errMsg);
          results.push({
            title: sections[sectionIdx].title,
            text: `[Section failed to generate: ${errMsg}]`,
            chartBuffer: null,
            tableData: null,
          });
          sections[sectionIdx].status = 'failed';
          sections[sectionIdx].errorMessage = errMsg;
        }
      }
    }

    // Step 3: Create Google Doc
    const reportTitle = `Report: ${text.substring(0, 80)} — ${new Date().toLocaleDateString()}`;
    const { docId, docUrl } = await createDoc(reportTitle, userName);

    // Step 4: Assemble sections into the doc
    for (const sectionResult of results) {
      await appendHeading(docId, sectionResult.title, 1);

      // Strip chart/export blocks from the narrative for clean doc text
      const cleanText = stripChartBlocks(sectionResult.text)
        .replace(/\[XLSX\]\s*[\s\S]*?\s*\[\/XLSX\]/g, '')
        .replace(/\[EXPORT_SQL\]\s*[\s\S]*?\s*\[\/EXPORT_SQL\]/g, '')
        .trim();

      // Insert narrative text
      if (cleanText) {
        // Remove markdown table from narrative (will be inserted as a real table)
        const narrativeOnly = sectionResult.tableData
          ? cleanText.replace(/\|(.+)\|\n\|[-| ]+\|\n((?:\|.+\|\n?)+)/g, '').trim()
          : cleanText;
        if (narrativeOnly) {
          await appendParagraph(docId, narrativeOnly);
        }
      }

      // Insert table if data exists
      if (sectionResult.tableData && sectionResult.tableData.length > 0) {
        const headers = Object.keys(sectionResult.tableData[0]);
        const rows = sectionResult.tableData.map((row) =>
          headers.map((h) => String(row[h] ?? ''))
        );
        await appendTable(docId, headers, rows);
        await appendParagraph(docId, ''); // spacing after table
      }

      // Embed chart if available
      if (sectionResult.chartBuffer) {
        await embedChartImage(docId, sectionResult.chartBuffer);
      }
    }

    // Step 5: Share doc with user
    if (userEmail && !userEmail.endsWith('@unknown')) {
      await shareDoc(docId, userEmail);
    }

    // Step 6: Persist final state
    await updateReportStatus(reportId, 'done', {
      sectionsJson: sections,
      googleDocId: docId,
      googleDocUrl: docUrl,
    });

    // Step 7: DM user the link
    await dmUser(client, userId, {
      text: `Your report is ready: ${docUrl}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:page_facing_up: *Your report is ready!*\n\n<${docUrl}|Open in Google Docs>\n\n_${sections.length} sections · ${sections.filter((s) => s.status === 'done').length} completed · ${sections.filter((s) => s.status === 'failed').length} failed_`,
          },
        },
      ],
    });

    return docUrl;
  } catch (err) {
    const errMsg = (err as Error).message;
    console.error('[report-generator] Report generation failed:', errMsg);

    // Update report status to failed
    if (reportId) {
      await updateReportStatus(reportId, 'failed', { errorMessage: errMsg }).catch(() => {});
    }

    // DM user about the failure
    await dmUser(client, userId, {
      text: `Sorry, your report failed to generate: ${errMsg}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:warning: *Report generation failed*\n\n${errMsg.substring(0, 500)}\n\nPlease try again or simplify your request.`,
          },
        },
      ],
    });

    throw err;
  }
}
```

### Validation Gate

```bash
npx tsc --noEmit
```

---

## Phase 3c: Report Store (`src/report-store.ts` — new file)

Create `src/report-store.ts`:

```typescript
// packages/analyst-bot/src/report-store.ts
// ============================================================================
// Neon Postgres CRUD for bot_reports table
// ============================================================================

import { Pool } from 'pg';
import { ReportRecord, ReportSection, ReportStatus } from './types';

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set');
    }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }
  return pool;
}

function rowToReport(row: any): ReportRecord {
  return {
    id: row.id,
    userId: row.user_id,
    userEmail: row.user_email,
    title: row.title,
    sectionsJson: row.sections_json as ReportSection[],
    status: row.status as ReportStatus,
    googleDocId: row.google_doc_id,
    googleDocUrl: row.google_doc_url,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

/**
 * Create a new report record. Returns the created record.
 */
export async function createReport(params: {
  userId: string;
  userEmail: string;
  title: string;
  sectionsJson: ReportSection[];
}): Promise<ReportRecord> {
  const result = await getPool().query(
    `INSERT INTO bot_reports (user_id, user_email, title, sections_json, status)
     VALUES ($1, $2, $3, $4, 'pending')
     RETURNING *`,
    [params.userId, params.userEmail, params.title, JSON.stringify(params.sectionsJson)]
  );
  return rowToReport(result.rows[0]);
}

/**
 * Update a report's status and optional fields.
 */
export async function updateReportStatus(
  reportId: string,
  status: ReportStatus,
  updates?: {
    sectionsJson?: ReportSection[];
    googleDocId?: string;
    googleDocUrl?: string;
    errorMessage?: string;
  }
): Promise<void> {
  const setClauses = ['status = $2'];
  const params: any[] = [reportId, status];
  let paramIdx = 3;

  if (status === 'done' || status === 'failed') {
    setClauses.push(`completed_at = NOW()`);
  }

  if (updates?.sectionsJson !== undefined) {
    setClauses.push(`sections_json = $${paramIdx}`);
    params.push(JSON.stringify(updates.sectionsJson));
    paramIdx++;
  }
  if (updates?.googleDocId !== undefined) {
    setClauses.push(`google_doc_id = $${paramIdx}`);
    params.push(updates.googleDocId);
    paramIdx++;
  }
  if (updates?.googleDocUrl !== undefined) {
    setClauses.push(`google_doc_url = $${paramIdx}`);
    params.push(updates.googleDocUrl);
    paramIdx++;
  }
  if (updates?.errorMessage !== undefined) {
    setClauses.push(`error_message = $${paramIdx}`);
    params.push(updates.errorMessage);
    paramIdx++;
  }

  await getPool().query(
    `UPDATE bot_reports SET ${setClauses.join(', ')} WHERE id = $1`,
    params
  );
}

/**
 * Get all reports for a user, ordered by creation date descending.
 */
export async function getReportsForUser(userId: string): Promise<ReportRecord[]> {
  const result = await getPool().query(
    `SELECT * FROM bot_reports
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 10`,
    [userId]
  );
  return result.rows.map(rowToReport);
}

/**
 * Get all generated reports across all users — admin only.
 * Returns most recent 50, ordered by created_at DESC.
 */
export async function getAllReports(): Promise<ReportRecord[]> {
  try {
    const result = await getPool().query(
      `SELECT * FROM bot_reports
       ORDER BY created_at DESC
       LIMIT 50`
    );
    return result.rows.map(rowToReport);
  } catch (err) {
    console.error('[report-store] getAllReports failed:', (err as Error).message);
    return [];
  }
}
```

### Validation Gate

```bash
npx tsc --noEmit
```

---

## Phase 4: Wire into Slack + App Home

### 4.1 Add "Schedule This" shortcut button to `buildResponseBlocks` in `src/slack.ts`

Find the existing footer actions block in `buildResponseBlocks` and add a third button.
The "Schedule This" button opens the same Report Builder modal as App Home, but pre-fills
the question and frozen SQL from the current response. Only shown when the response has
executed SQL (provenanceQueryCount > 0).

The `buildResponseBlocks` function needs two new params: `questionText` (the user's original
question) and `frozenSql` (the last SQL from sql_executed). These come from the response pipeline.

```typescript
// In buildResponseBlocks(), replace the existing actions block with:

  // Footer action buttons — always present
  blocks.push({ type: 'divider' } as KnownBlock);

  const footerElements: any[] = [
    {
      type: 'button',
      text: { type: 'plain_text', text: ':bar_chart: Export XLSX', emoji: true },
      action_id: 'export_xlsx_action',
      value: JSON.stringify({ threadTs, channelId }),
    },
  ];

  // "Schedule This" shortcut — opens the Report Builder modal with pre-filled question + SQL.
  // Only shown when the response executed at least one SQL query.
  if (queryCount > 0 && questionText) {
    footerElements.push({
      type: 'button',
      text: { type: 'plain_text', text: ':calendar: Schedule This', emoji: true },
      action_id: 'open_report_builder',
      // Pass question + frozen SQL so the modal can pre-populate
      value: JSON.stringify({
        prefillQuestion: questionText.substring(0, 500),
        prefillSql: frozenSql?.substring(0, 2800) ?? '',
      }),
    });
  }

  footerElements.push({
    type: 'button',
    text: { type: 'plain_text', text: ':triangular_flag_on_post: Report Issue', emoji: true },
    action_id: 'report_issue_action',
    value: JSON.stringify({ threadTs, channelId }),
  });

  blocks.push({ type: 'actions', elements: footerElements } as KnownBlock);
```

### 4.2 Add new imports to top of `src/slack.ts`

```typescript
// Add these imports at the top of slack.ts, after existing imports:
import { dmUser } from './dm-helper';
import { createSchedule, getActiveSchedulesForUser, cancelSchedule, getAllSchedules, adminCancelSchedule } from './schedule-store';
import { isReportRequest, generateReport } from './report-generator';
import { runDueSchedules } from './schedule-runner';
import { getAllReports } from './report-store';
import { buildAdminHomeView } from './app-home';
import type { ScheduleFrequency } from './types';

// Admin user IDs — see admin App Home view instead of regular user view.
// Configured via ADMIN_SLACK_USER_IDS env var (comma-separated).
// Falls back to hardcoded Russell Moss ID if env var is unset.
const ADMIN_USER_IDS = new Set(
  (process.env.ADMIN_SLACK_USER_IDS ?? 'U09DX3U7UTW').split(',').map(s => s.trim()).filter(Boolean)
);

function isAdmin(userId: string): boolean {
  return ADMIN_USER_IDS.has(userId);
}
```

### 4.3 Register Report Builder modal + schedule handlers

The Report Builder modal is a three-step flow:
1. `open_report_builder` (action) — opens modal with report name, question, frequency, delivery time
2. `report_builder_submit` (view) — runs the query live for a preview, then pushes the preview modal
3. `report_preview_confirm` (view) — saves the schedule to Neon, DMs confirmation

Both the App Home "Create Recurring Report" button and the footer "Schedule This" button
use the same `action_id: 'open_report_builder'`. The footer button passes prefilled question
and frozen SQL in its value JSON; the App Home button passes no value (empty prefill).

Add this after the existing `report_issue_action` handler, before the `open_issue_modal` handler:

```typescript
  // ---- Report Builder modal: open from App Home or "Schedule This" footer button ----
  slackApp.action<BlockAction<ButtonAction>>(
    'open_report_builder',
    async ({ ack, body, client }) => {
      await ack();

      // Parse prefill data if coming from "Schedule This" footer button
      let prefillQuestion = '';
      let prefillSql = '';
      try {
        const action = body.actions[0] as ButtonAction;
        if (action.value) {
          const parsed = JSON.parse(action.value);
          prefillQuestion = parsed.prefillQuestion ?? '';
          prefillSql = parsed.prefillSql ?? '';
        }
      } catch { /* no prefill — opened from App Home */ }

      const triggerId = (body as any).trigger_id;
      if (!triggerId) return;

      // trigger_id expires in 3 seconds — open modal immediately, no async work before this
      await client.views.open({
        trigger_id: triggerId,
        view: {
          type: 'modal',
          callback_id: 'report_builder_submit',
          title: { type: 'plain_text', text: 'Create Recurring Report' },
          submit: { type: 'plain_text', text: 'Preview Report' },
          close: { type: 'plain_text', text: 'Cancel' },
          // Store frozen SQL in private_metadata (max 3000 chars)
          private_metadata: JSON.stringify({
            prefillSql: prefillSql.substring(0, 2800),
          }),
          blocks: [
            {
              type: 'input',
              block_id: 'report_name',
              label: { type: 'plain_text', text: 'Report Name' },
              hint: { type: 'plain_text', text: 'e.g. "Weekly SGA Leaderboard"' },
              element: {
                type: 'plain_text_input',
                action_id: 'value',
                placeholder: { type: 'plain_text', text: 'Give your report a name' },
                max_length: 80,
              },
            },
            {
              type: 'input',
              block_id: 'report_question',
              label: { type: 'plain_text', text: 'What do you want in this report?' },
              hint: { type: 'plain_text', text: 'Be specific — this is the question the bot will run on each delivery.' },
              element: {
                type: 'plain_text_input',
                action_id: 'value',
                multiline: true,
                placeholder: { type: 'plain_text', text: 'e.g. "Show me SQO volume by SGA for the last 7 days with conversion rates"' },
                ...(prefillQuestion ? { initial_value: prefillQuestion } : {}),
                max_length: 500,
              },
            },
            {
              type: 'input',
              block_id: 'delivery_type',
              label: { type: 'plain_text', text: 'Delivery Format' },
              element: {
                type: 'static_select',
                action_id: 'value',
                initial_option: {
                  text: { type: 'plain_text', text: 'Slack DM' },
                  value: 'slack_dm',
                },
                options: [
                  { text: { type: 'plain_text', text: 'Slack DM' }, value: 'slack_dm' },
                  { text: { type: 'plain_text', text: 'Google Doc' }, value: 'google_doc' },
                ],
              },
            },
            {
              type: 'input',
              block_id: 'frequency',
              label: { type: 'plain_text', text: 'Cadence' },
              element: {
                type: 'static_select',
                action_id: 'value',
                initial_option: {
                  text: { type: 'plain_text', text: 'Weekly' },
                  value: 'weekly',
                },
                options: [
                  { text: { type: 'plain_text', text: 'Daily' }, value: 'daily' },
                  { text: { type: 'plain_text', text: 'Weekly' }, value: 'weekly' },
                  { text: { type: 'plain_text', text: 'Monthly' }, value: 'monthly' },
                ],
              },
            },
            {
              type: 'input',
              block_id: 'deliver_at_hour',
              label: { type: 'plain_text', text: 'Deliver At (UTC)' },
              hint: { type: 'plain_text', text: '9 AM UTC = 5 AM ET / 4 AM CT' },
              element: {
                type: 'static_select',
                action_id: 'value',
                initial_option: {
                  text: { type: 'plain_text', text: '9:00 AM UTC' },
                  value: '9',
                },
                options: [
                  { text: { type: 'plain_text', text: '6:00 AM UTC' }, value: '6' },
                  { text: { type: 'plain_text', text: '7:00 AM UTC' }, value: '7' },
                  { text: { type: 'plain_text', text: '8:00 AM UTC' }, value: '8' },
                  { text: { type: 'plain_text', text: '9:00 AM UTC' }, value: '9' },
                  { text: { type: 'plain_text', text: '10:00 AM UTC' }, value: '10' },
                  { text: { type: 'plain_text', text: '12:00 PM UTC' }, value: '12' },
                  { text: { type: 'plain_text', text: '3:00 PM UTC' }, value: '15' },
                  { text: { type: 'plain_text', text: '5:00 PM UTC' }, value: '17' },
                ],
              },
            },
          ],
        },
      });
    }
  );

  // ---- View: Report Builder submitted → run live preview ----
  slackApp.view('report_builder_submit', async ({ ack, body, view, client }) => {
    // Extract form values
    const reportName = view.state.values.report_name.value.value ?? '';
    const question = view.state.values.report_question.value.value ?? '';
    const deliveryType = view.state.values.delivery_type.value.selected_option?.value ?? 'slack_dm';
    const frequency = (view.state.values.frequency.value.selected_option?.value ?? 'weekly') as ScheduleFrequency;
    const deliverAtHour = parseInt(view.state.values.deliver_at_hour.value.selected_option?.value ?? '9', 10);
    const userId = body.user.id;

    // Parse prefill SQL from private_metadata
    let frozenSql = '';
    try {
      const meta = JSON.parse(view.private_metadata ?? '{}');
      frozenSql = meta.prefillSql ?? '';
    } catch { /* no prefill SQL */ }

    // Ack with a loading update so Slack doesn't close the modal
    await ack({
      response_action: 'update',
      view: {
        type: 'modal',
        callback_id: 'report_builder_submit',
        title: { type: 'plain_text', text: 'Generating Preview...' },
        close: { type: 'plain_text', text: 'Cancel' },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `:hourglass: Running *"${question.substring(0, 100)}"* against live data...\n\nThis usually takes 10-30 seconds.`,
            },
          },
        ],
      },
    });

    // Run the query live for preview
    const threadId = `preview:${userId}:${Date.now()}`;
    let previewText = '';
    let finalSql = frozenSql;

    try {
      const result = await processMessage(question, threadId, userId, userId);
      previewText = result.text ?? '';

      // Capture frozen SQL from the preview run if we don't have it from prefill
      if (!finalSql && result.provenanceQueryCount > 0) {
        // The last SQL executed is typically the main data query
        // This is available because processMessage populates sqlExecuted via claude.ts
        // Note: we can't access sqlExecuted directly from ConversationResult — it's in the audit record.
        // Fallback: query BQ audit for the synthetic threadId we just used.
        try {
          const { BigQuery } = require('@google-cloud/bigquery');
          const bq = new BigQuery({ projectId: process.env.BIGQUERY_PROJECT });
          const ds = process.env.AUDIT_DATASET ?? 'bot_audit';
          const tbl = process.env.AUDIT_TABLE ?? 'interaction_log';
          const [rows] = await bq.query({
            query: `SELECT sql_executed FROM \`${process.env.BIGQUERY_PROJECT}.${ds}.${tbl}\`
                    WHERE thread_id = @threadId ORDER BY timestamp DESC LIMIT 1`,
            params: { threadId },
          });
          if (rows?.[0]?.sql_executed) {
            const sqlArr = typeof rows[0].sql_executed === 'string'
              ? JSON.parse(rows[0].sql_executed)
              : rows[0].sql_executed;
            if (Array.isArray(sqlArr) && sqlArr.length > 0) {
              finalSql = sqlArr[sqlArr.length - 1];
            }
          }
        } catch (sqlErr) {
          console.error('[report_builder] Failed to retrieve preview SQL:', (sqlErr as Error).message);
        }
      }
    } catch (err) {
      previewText = ':warning: Could not generate a preview for this query. You can still schedule it.';
    }

    // Compute first delivery time for display
    const nextRun = computeNextRunAt(frequency, deliverAtHour);
    const frequencyLabel = frequency.charAt(0).toUpperCase() + frequency.slice(1);
    const deliveryLabel = deliveryType === 'google_doc' ? 'Google Doc' : 'Slack DM';

    // Push the preview modal (replaces the loading state)
    try {
      await client.views.update({
        view_id: view.id,
        view: {
          type: 'modal',
          callback_id: 'report_preview_confirm',
          title: { type: 'plain_text', text: ('Preview: ' + reportName).substring(0, 24) },
          submit: { type: 'plain_text', text: 'Schedule Report' },
          close: { type: 'plain_text', text: 'Edit' },
          private_metadata: JSON.stringify({
            reportName,
            question,
            frequency,
            deliverAtHour,
            deliveryType,
            frozenSql: (finalSql ?? '').substring(0, 2800),
            userId,
          }),
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Here's what your report will look like based on today's data:*`,
              },
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: '```\n' + previewText.substring(0, 2800) + '\n```',
              },
            },
            { type: 'divider' },
            {
              type: 'section',
              fields: [
                { type: 'mrkdwn', text: `*Report Name*\n${reportName}` },
                { type: 'mrkdwn', text: `*Cadence*\n${frequencyLabel}` },
                { type: 'mrkdwn', text: `*Delivery*\n${deliveryLabel}` },
                { type: 'mrkdwn', text: `*First Delivery*\n${nextRun.toUTCString()}` },
              ],
            },
          ],
        },
      });
    } catch (err) {
      console.error('[report_builder] Failed to push preview modal:', (err as Error).message);
    }
  });

  // ---- View: Preview confirmed → save schedule ----
  slackApp.view('report_preview_confirm', async ({ ack, body, view, client }) => {
    await ack();

    const userId = body.user.id;
    let meta: any = {};
    try { meta = JSON.parse(view.private_metadata ?? '{}'); } catch { /* ignore */ }

    const { reportName, question, frequency, deliverAtHour, deliveryType, frozenSql } = meta;

    if (!frozenSql || !question || !reportName) {
      await dmUser(client, userId, {
        text: ':warning: Something went wrong saving your report. Please try again.',
      });
      return;
    }

    const userEmail = await getUserEmail(client, userId);

    try {
      const schedule = await createSchedule({
        userId,
        userEmail: userEmail.endsWith('@unknown') ? null : userEmail,
        reportName,
        questionText: question,
        frozenSql,
        frequency: frequency as ScheduleFrequency,
        deliverAtHour: deliverAtHour ?? 9,
        deliveryType: deliveryType ?? 'slack_dm',
      });

      const frequencyLabel = frequency.charAt(0).toUpperCase() + frequency.slice(1);
      const deliveryLabel = deliveryType === 'google_doc' ? 'Google Doc' : 'Slack DM';

      await dmUser(client, userId, {
        text: `"${reportName}" has been scheduled.`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `:white_check_mark: *"${reportName}"* has been scheduled.\n\n*Cadence:* ${frequencyLabel}\n*Delivery:* ${deliveryLabel}\n*First delivery:* ${schedule.nextRunAt.toUTCString()}\n\nManage your reports in *App Home → Scheduled Reports*.`,
            },
          },
        ],
      });

      // Refresh App Home so the new schedule appears immediately
      const [recentQueries, activeSchedules] = await Promise.all([
        getRecentQueriesForUser(userId),
        getActiveSchedulesForUser(userId),
      ]);
      await client.views.publish({
        user_id: userId,
        view: { type: 'home', blocks: buildHomeView({ recentQueries, activeSchedules }) },
      });
    } catch (err) {
      console.error('[report_preview_confirm] Failed to save schedule:', (err as Error).message);
      await dmUser(client, userId, {
        text: `:warning: Failed to schedule "${reportName}". Please try again.`,
      });
    }
  });

  // ---- Action: Cancel schedule (from App Home) ----
  slackApp.action<BlockAction<ButtonAction>>(
    'cancel_schedule',
    async ({ ack, body, client }) => {
      await ack();

      const action = body.actions[0] as ButtonAction;
      const scheduleId = action.value;
      const userId = body.user.id;

      if (!scheduleId) return;

      try {
        await cancelSchedule(scheduleId);

        // Refresh App Home
        const recentQueries = await getRecentQueriesForUser(userId);
        const activeSchedules = await getActiveSchedulesForUser(userId);
        await client.views.publish({
          user_id: userId,
          view: {
            type: 'home',
            blocks: buildHomeView({ recentQueries, activeSchedules }),
          },
        });
      } catch (err) {
        console.error('[slack] Cancel schedule failed:', (err as Error).message);
      }
    }
  );

  // ---- Action: Admin cancel schedule (from Admin App Home) ----
  // Only admins can use this action — non-admins are silently rejected.
  // When admin cancels another user's schedule, that user receives a DM notification.
  slackApp.action<BlockAction<ButtonAction>>(
    'admin_cancel_schedule',
    async ({ ack, body, client }) => {
      await ack();

      const userId = body.user.id;

      // Guard — only admins can use this action
      if (!isAdmin(userId)) {
        console.warn(`[admin] Non-admin user ${userId} attempted admin_cancel_schedule`);
        return;
      }

      const action = body.actions[0] as ButtonAction;
      const scheduleId = action.value;
      if (!scheduleId) return;

      try {
        // Fetch the schedule first so we can DM the owner and log the name
        const allSchedules = await getAllSchedules();
        const target = allSchedules.find(s => s.id === scheduleId);

        await adminCancelSchedule(scheduleId);

        console.log(`[admin] ${userId} cancelled schedule ${scheduleId} (${target?.reportName ?? 'unknown'})`);

        // If the schedule belonged to someone else, DM them
        if (target && target.userId !== userId) {
          await dmUser(client, target.userId, {
            text: `Your scheduled report "${target.reportName}" was cancelled by an admin.`,
            blocks: [{
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `:information_source: Your scheduled report *"${target.reportName}"* was cancelled by an admin. If you have questions, reach out in <#data-issues>.`,
              },
            }],
          });
        }

        // Refresh admin App Home
        const [allSchedulesRefresh, allReports] = await Promise.all([
          getAllSchedules(),
          getAllReports(),
        ]);

        await client.views.publish({
          user_id: userId,
          view: {
            type: 'home',
            blocks: buildAdminHomeView({
              allSchedules: allSchedulesRefresh,
              allReports,
            }),
          },
        });
      } catch (err) {
        console.error('[admin_cancel_schedule] failed:', (err as Error).message);
      }
    }
  );
```

### 4.4 Add report intent check to `app_mention` and `message` handlers

In the `app_mention` handler, add this block **after** the issue trigger check and **before** the thinking reaction (around line 1011-1017):

```typescript
    // Report intent check — redirect to report generator
    if (isReportRequest(text)) {
      try {
        await client.reactions.add({
          channel: event.channel,
          timestamp: event.ts,
          name: 'page_facing_up',
        });
      } catch { /* non-critical */ }

      await client.chat.postMessage({
        channel: event.channel,
        thread_ts: threadTs,
        text: ':page_facing_up: Working on your report — I\'ll DM you when it\'s ready. This usually takes 2-3 minutes.',
      });

      // Fire-and-forget — report generator handles its own error DMs
      generateReport(client as any, userId, userEmail, text, event.channel).catch((err) => {
        console.error('[slack] Report generation error:', (err as Error).message);
      });
      return;
    }
```

In the `message` handler, add the same check after the issue trigger check (around line 1067-1072):

```typescript
    // Report intent check — redirect to report generator
    if (isReportRequest(text)) {
      await client.chat.postMessage({
        channel: msg.channel,
        thread_ts: msg.thread_ts,
        text: ':page_facing_up: Working on your report — I\'ll DM you when it\'s ready. This usually takes 2-3 minutes.',
      });

      generateReport(client as any, userId, userEmail, text, msg.channel).catch((err) => {
        console.error('[slack] Report generation error:', (err as Error).message);
      });
      return;
    }
```

### 4.5 Register `/internal/run-schedules` endpoint

Add this **after** the existing `/internal/cleanup` block (around line 1116), inside the `if (receiver)` guard:

```typescript
  // ---- Cron endpoint (POST /internal/run-schedules) ----
  // Protected by CRON_SECRET header. Called by Cloud Scheduler every 15 minutes.
  if (receiver) {
    receiver.router.post('/internal/run-schedules', async (req, res) => {
      const secret = req.headers['x-cron-secret'];
      if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      try {
        // Need a WebClient to send DMs — use the bot token
        const { WebClient } = require('@slack/web-api');
        const webClient = new WebClient(process.env.SLACK_BOT_TOKEN);

        const summary = await runDueSchedules(webClient);
        console.log(`[cron] Schedule run complete:`, summary);
        res.status(200).json(summary);
      } catch (err) {
        console.error('[cron] run-schedules error:', (err as Error).message);
        res.status(500).json({ error: (err as Error).message });
      }
    });
  }
```

**IMPORTANT:** The existing `/internal/cleanup` endpoint is already inside an `if (receiver)` block. The new `/internal/run-schedules` endpoint must also be inside this block. If the existing code has a single `if (receiver) { ... }` block for cleanup, add the new route inside the same block.

### 4.6 Update `app_home_opened` event handler — admin branch

Replace the existing `app_home_opened` handler with one that branches on `isAdmin(userId)`.
Admin users see a global view of all schedules and reports across all users.
Regular users see only their own schedules and recent queries.

```typescript
  slackApp.event('app_home_opened', async ({ event, client }) => {
    if (event.tab !== 'home') return;

    const userId = event.user;

    try {
      if (isAdmin(userId)) {
        // Admin view — fetch all data across all users
        const [allSchedules, allReports] = await Promise.all([
          getAllSchedules(),
          getAllReports(),
        ]);

        await client.views.publish({
          user_id: userId,
          view: {
            type: 'home',
            blocks: buildAdminHomeView({ allSchedules, allReports }),
          },
        });
      } else {
        // Regular user view
        const [recentQueries, activeSchedules] = await Promise.all([
          getRecentQueriesForUser(userId),
          getActiveSchedulesForUser(userId),
        ]);

        await client.views.publish({
          user_id: userId,
          view: {
            type: 'home',
            blocks: buildHomeView({ recentQueries, activeSchedules }),
          },
        });
      }
    } catch (err) {
      console.error('[app_home_opened] views.publish failed:', (err as Error).message);
    }
  });
```

### 4.7 Update `src/app-home.ts` — add schedules section

Update the `HomeViewOptions` interface and `buildHomeView` function:

```typescript
// packages/analyst-bot/src/app-home.ts
// ============================================================================
// App Home tab builder — renders the persistent Home view in the bot's DM
// ============================================================================

import type { KnownBlock } from '@slack/types';
import type { ScheduleRecord } from './types';

interface HomeViewOptions {
  recentQueries: Array<{ questionText: string; askedAt: Date }>;
  activeSchedules?: ScheduleRecord[];
}

export function buildHomeView(opts: HomeViewOptions): KnownBlock[] {
  const blocks: KnownBlock[] = [];

  // ── Hero ──────────────────────────────────────────────
  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: 'Savvy Analyst Bot', emoji: true },
  });
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: 'Ask questions about your recruiting funnel. Results include tables, charts, and XLSX exports.',
    },
  });
  blocks.push({ type: 'divider' });

  // ── Quick Reports ──────────────────────────────────────
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: '*Quick Reports*' },
  });

  // Row 1 — 3 buttons
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: ':chart_with_upwards_trend: Pipeline Summary', emoji: true },
        action_id: 'home_quick_pipeline',
        value: 'Show me a full pipeline summary for this month including SQOs, offers, and joins',
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: ':trophy: SGA Leaderboard', emoji: true },
        action_id: 'home_quick_sga',
        value: 'Show me the SGA leaderboard ranked by SQOs created this month',
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: ':repeat: Funnel Conversion', emoji: true },
        action_id: 'home_quick_funnel',
        value: 'Show me funnel conversion rates by stage for this quarter in cohort mode',
      },
    ],
  });

  // Row 2 — 2 buttons
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: ':calendar: SQOs This Week', emoji: true },
        action_id: 'home_quick_sqos',
        value: 'How many SQOs were created this week and by which SGAs?',
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: ':globe_with_meridians: Leads by Source', emoji: true },
        action_id: 'home_quick_leads',
        value: 'Show me lead volume by source for the last 30 days',
      },
    ],
  });

  blocks.push({ type: 'divider' });

  // ── Scheduled Reports ───────────────────────────────────
  const schedules = opts.activeSchedules ?? [];

  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: '*Scheduled Reports*' },
    accessory: {
      type: 'button',
      text: { type: 'plain_text', text: ':memo: New Report', emoji: true },
      action_id: 'open_report_builder',
      style: 'primary' as const,
    },
  });

  if (schedules.length === 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '_No scheduled reports yet. Click New Report to create one._',
      },
    });
  } else {
    for (const schedule of schedules) {
      const frequencyLabel = schedule.frequency.charAt(0).toUpperCase() + schedule.frequency.slice(1);
      const deliveryLabel = schedule.deliveryType === 'google_doc' ? ':page_facing_up: Google Doc' : ':speech_balloon: Slack DM';
      const nextRun = schedule.nextRunAt?.toUTCString() ?? 'pending';

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${schedule.reportName}*\n${frequencyLabel} · ${deliveryLabel} · Next: ${nextRun}`,
        },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: 'Cancel', emoji: false },
          style: 'danger' as const,
          action_id: 'cancel_schedule',
          value: schedule.id,
          confirm: {
            title: { type: 'plain_text', text: 'Cancel this report?' },
            text: { type: 'mrkdwn', text: `This will permanently cancel *"${schedule.reportName}"*. You can recreate it at any time.` },
            confirm: { type: 'plain_text', text: 'Yes, cancel it' },
            deny: { type: 'plain_text', text: 'Keep it' },
          },
        },
      });
    }
  }

  blocks.push({ type: 'divider' });

  // ── Recent Queries ─────────────────────────────────────
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: '*Your Recent Queries*' },
  });

  if (opts.recentQueries.length === 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: "_You haven't asked anything yet. Try a quick report above or @mention me in any channel._",
      },
    });
  } else {
    for (const query of opts.recentQueries) {
      const timeAgo = formatTimeAgo(query.askedAt);
      const truncated = query.questionText.length > 80
        ? query.questionText.substring(0, 77) + '...'
        : query.questionText;

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:clock1: _${timeAgo}_  "${truncated}"`,
        },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: 'Ask Again', emoji: false },
          action_id: 'home_ask_again',
          value: query.questionText.substring(0, 2000),
        },
      });
    }
  }

  blocks.push({ type: 'divider' });

  // ── Tips ───────────────────────────────────────────────
  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: ':bulb: *Tips:* Ask for charts ("as a pie chart"), exports ("as xlsx"), reports ("generate a report"), or schedule recurring queries. @mention me in any channel.',
    }],
  });

  return blocks;
}

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 172800) return 'Yesterday';
  return `${Math.floor(seconds / 86400)}d`;
}

// ---- Admin App Home View ----

interface AdminHomeViewOptions {
  allSchedules: ScheduleRecord[];
  allReports: ReportRecord[];
}

/**
 * Build the admin App Home view — shows all schedules across all users
 * with failure state indicators, plus all generated Google Doc reports.
 * Only shown to users in ADMIN_SLACK_USER_IDS.
 */
export function buildAdminHomeView(opts: AdminHomeViewOptions): KnownBlock[] {
  const blocks: KnownBlock[] = [];

  // ── Admin Header ───────────────────────────────────────
  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: 'Analyst Bot — Admin View', emoji: true },
  });
  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: `Viewing as admin · ${opts.allSchedules.length} active schedules · ${opts.allReports.length} reports`,
    }],
  });
  blocks.push({ type: 'divider' });

  // ── All Scheduled Reports ──────────────────────────────
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*All Scheduled Reports* (${opts.allSchedules.length} active)`,
    },
  });

  if (opts.allSchedules.length === 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '_No active schedules._' },
    });
  } else {
    // Group by user_id for display
    const byUser = new Map<string, ScheduleRecord[]>();
    for (const s of opts.allSchedules) {
      const existing = byUser.get(s.userId) ?? [];
      existing.push(s);
      byUser.set(s.userId, existing);
    }

    for (const [userId, schedules] of byUser.entries()) {
      const userLabel = schedules[0].userEmail ?? userId;
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*${userLabel}*` },
      });

      for (const schedule of schedules) {
        const frequencyLabel = schedule.frequency.charAt(0).toUpperCase() + schedule.frequency.slice(1);
        const deliveryLabel = schedule.deliveryType === 'google_doc' ? ':page_facing_up: Google Doc' : ':speech_balloon: Slack DM';
        const nextRun = schedule.nextRunAt.toUTCString();
        const lastRunText = schedule.lastRunAt
          ? formatTimeAgo(schedule.lastRunAt) + ' ago'
          : 'never run';

        // Failure state indicator
        const failureIndicator = schedule.failureCount >= 2
          ? ` :x: *FAILING (${schedule.failureCount}/3)*`
          : schedule.failureCount === 1
          ? ` :warning: 1 failure`
          : ' :white_check_mark:';

        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: [
              `*${schedule.reportName}*${failureIndicator}`,
              `${frequencyLabel} · ${deliveryLabel} · ${schedule.deliverAtHour}:00 UTC`,
              `Last run: ${lastRunText}  |  Next: ${nextRun}`,
              `_"${schedule.questionText.substring(0, 80)}${schedule.questionText.length > 80 ? '...' : ''}"_`,
            ].join('\n'),
          },
          accessory: {
            type: 'button',
            text: { type: 'plain_text', text: 'Cancel', emoji: true },
            action_id: 'admin_cancel_schedule',
            style: 'danger' as const,
            value: schedule.id,
            confirm: {
              title: { type: 'plain_text', text: 'Cancel this schedule?' },
              text: {
                type: 'mrkdwn',
                text: `Cancel *"${schedule.reportName}"* for ${userLabel}? This cannot be undone.`,
              },
              confirm: { type: 'plain_text', text: 'Yes, cancel it' },
              deny: { type: 'plain_text', text: 'Keep it' },
            },
          },
        });
      }
    }
  }

  blocks.push({ type: 'divider' });

  // ── All Generated Reports ──────────────────────────────
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*Generated Reports* (last 50)`,
    },
  });

  if (opts.allReports.length === 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '_No reports generated yet._' },
    });
  } else {
    for (const report of opts.allReports) {
      const userLabel = report.userEmail ?? report.userId;
      const timeAgo = formatTimeAgo(report.createdAt);
      const statusEmoji = report.status === 'done' ? ':white_check_mark:'
        : report.status === 'failed' ? ':x:'
        : report.status === 'running' ? ':hourglass:'
        : ':clock1:';

      const docLink = report.googleDocUrl
        ? `<${report.googleDocUrl}|View Doc>`
        : '_no doc_';

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            `${statusEmoji} *${report.title}*  ·  ${userLabel}`,
            `${timeAgo} ago  ·  ${docLink}`,
            report.status === 'failed' && report.errorMessage
              ? `_Error: ${report.errorMessage.substring(0, 100)}_`
              : '',
          ].filter(Boolean).join('\n'),
        },
      });
    }
  }

  return blocks;
}
```

### 4.8 Validation Gate

```bash
npx tsc --noEmit
npm run build
```

Both must pass.

---

## Phase 5: Integration Test + Deploy

### 5.1 Build

```bash
cd packages/analyst-bot
npm run build
```

### 5.2 Deploy to Cloud Run

```bash
# Build and push container
gcloud builds submit --tag gcr.io/savvy-gtm-analytics/analyst-bot

# Deploy with new secrets
gcloud run deploy analyst-bot \
  --image gcr.io/savvy-gtm-analytics/analyst-bot \
  --region us-east1 \
  --memory 2Gi \
  --cpu 2 \
  --timeout 300 \
  --no-cpu-throttling \
  --set-secrets "GOOGLE_DOCS_CREDENTIALS_JSON=google-docs-credentials:latest,CRON_SECRET=cron-secret:latest" \
  --set-env-vars "ADMIN_SLACK_USER_IDS=U09DX3U7UTW"
```

> **Warning:** `ADMIN_SLACK_USER_IDS` is a plain env var, not a Secret Manager secret.
> It must be passed via `--set-env-vars`, not `--set-secrets`.
> If this is omitted, `isAdmin()` always returns `false` and the admin view never renders.

### 5.3 Get Cloud Run URL + Create Cloud Scheduler Job

#### Step 1 — Get the deployed Cloud Run URL

After Phase 5.2 deploy completes, run:
```bash
gcloud run services describe analyst-bot \
  --region us-east1 \
  --format="value(status.url)"
```

Copy the output — it will look like:
`https://analyst-bot-abc12xyz-ue.a.run.app`

#### Step 2 — Get your CRON_SECRET value

```bash
gcloud secrets versions access latest \
  --secret=cron-secret \
  --project=savvy-gtm-analytics
```

Copy the output.

#### Step 3 — Create the Cloud Scheduler job

Replace `CLOUD_RUN_URL` and `YOUR_CRON_SECRET` with the values from Steps 1 and 2:

```bash
gcloud scheduler jobs create http analyst-bot-run-schedules \
  --schedule="*/15 * * * *" \
  --uri="CLOUD_RUN_URL/internal/run-schedules" \
  --http-method=POST \
  --headers="x-cron-secret=YOUR_CRON_SECRET" \
  --time-zone="UTC" \
  --attempt-deadline="120s" \
  --project=savvy-gtm-analytics
```

#### Step 4 — Verify the job was created

```bash
gcloud scheduler jobs describe analyst-bot-run-schedules \
  --project=savvy-gtm-analytics
```

Confirm `state: ENABLED` and the URI matches your Cloud Run URL.

#### Step 5 — Manually trigger to test cron endpoint

```bash
gcloud scheduler jobs run analyst-bot-run-schedules \
  --project=savvy-gtm-analytics
```

Watch Cloud Logging for the cron handler firing:
```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND textPayload=~"run-schedules"' \
  --project=savvy-gtm-analytics \
  --limit=10 \
  --format="value(textPayload)"
```

PASS: Log shows schedules checked (even if 0 are due yet)
FAIL: 403 — CRON_SECRET mismatch; 404 — route not registered (HTTP mode issue, check receiver setup)

### 5.4 Test Plan

Run these tests in order. Do not skip edge cases — they cover the most likely
failure modes in production.

---

#### Test 1 — Report Builder modal (primary schedule creation flow)

**From App Home:**
1. Open Slack → click Savvy Analyst Bot → Home tab
2. Confirm you see the regular user view (not admin) — hero, quick reports,
   scheduled reports section, "📋 New Report" button
3. Click "📋 New Report"
   PASS: Report Builder modal opens with all 5 fields:
         Report Name, Question, Delivery Format, Cadence, Deliver At
   FAIL: Nothing happens → check terminal for `open_report_builder` action
         payload arriving; if absent, action handler not registered

4. Fill in:
   - Report Name: "Test Schedule"
   - Question: "how many SQOs came in this week?"
   - Delivery: Slack DM
   - Cadence: Daily
   - Deliver At: 9:00 AM UTC
5. Click "Preview Report"
   PASS: Modal updates to a loading state ("⏳ Generating Preview..."),
         then updates again to show actual query results, report config
         summary, and first delivery time
   FAIL: Modal closes → `ack()` not returning `response_action: 'update'`;
         check terminal for view submission handler errors

6. Click "✅ Schedule Report"
   PASS: Modal closes, DM arrives confirming schedule with name, cadence,
         and first delivery time
   FAIL: Modal closes but no DM → check `report_preview_confirm` handler
         and `dmUser()` for errors

**From a query response (Schedule This shortcut):**
7. Ask any question that produces a table in Slack
8. Confirm "📅 Schedule This" button appears in the response footer
   (if provenanceQueryCount > 0 — it should not appear on zero-query responses)
9. Click "📅 Schedule This"
   PASS: Report Builder modal opens with Question field pre-filled with
         the question you just asked
   FAIL: Modal opens empty → prefill JSON not being passed through button value

---

#### Test 2 — App Home scheduled reports section

1. After Test 1, open App Home
   PASS: "Scheduled Reports" section shows "Test Schedule" with:
         - Correct cadence and delivery format
         - Next run time
         - Cancel button
   FAIL: Schedule not visible → `getSchedulesForUser()` query or
         App Home refresh after `report_preview_confirm` not firing

2. Click "Cancel" on "Test Schedule" → confirm dialog appears → confirm
   PASS: Schedule disappears from App Home immediately
   FAIL: Schedule remains → `cancel_schedule` handler not updating DB

---

#### Test 3 — Admin view (Russell Moss only — U09DX3U7UTW)

1. Open App Home as Russell Moss (U09DX3U7UTW)
   PASS: Admin view renders with header "🔧 Analyst Bot — Admin View",
         "All Scheduled Reports" section, "Generated Reports" section
   FAIL: Regular user view renders → ADMIN_SLACK_USER_IDS env var not
         set in Cloud Run; verify with:
         `gcloud run services describe analyst-bot --region us-east1 --format="value(spec.template.spec.containers[0].env)"`

2. Create a second schedule as a different user (or re-create Test Schedule)
   Then re-open App Home as Russell Moss
   PASS: Admin view shows schedules grouped by user with email labels,
         last run time, next run time

3. Verify failure state indicators render correctly:
   Manually update a schedule's failure_count in Neon:
   ```sql
   UPDATE bot_schedules SET failure_count = 2
   WHERE report_name = 'Test Schedule';
   ```
   Refresh App Home as admin
   PASS: Schedule shows "❌ FAILING (2/3)" indicator

4. Click "🗑 Cancel" on another user's schedule from the admin view
   PASS: Schedule cancelled, that user receives a DM:
         "ℹ️ Your scheduled report 'X' was cancelled by an admin."
         Admin App Home refreshes with schedule removed
   FAIL: No DM to owner → `dmUser()` failing for that user ID;
         check terminal logs

5. Attempt to trigger `admin_cancel_schedule` as a non-admin user:
   (Check terminal logs)
   PASS: Terminal shows `[admin] non-admin user <id> attempted admin_cancel_schedule`
         and no action is taken

---

#### Test 4 — Cron execution

1. Create a new schedule via the Report Builder modal
2. Manually trigger the cron job:
   ```bash
   gcloud scheduler jobs run analyst-bot-run-schedules \
     --project=savvy-gtm-analytics
   ```
3. PASS: DM arrives within 60 seconds with the scheduled report results,
         formatted as a normal Block Kit response with provenance footer
4. Check Neon:
   ```sql
   SELECT last_run_at, next_run_at, failure_count
   FROM bot_schedules
   WHERE report_name = 'your schedule name';
   ```
   PASS: `last_run_at` updated to now, `next_run_at` advanced correctly,
         `failure_count` remains 0

5. Test zero-result schedule:
   Create a schedule with a question that returns no data
   (e.g. "how many SQOs came in on January 1st 1900?")
   Manually trigger cron
   PASS: DM arrives saying "no results this run" — bot does not crash
   FAIL: Bot throws and `failure_count` increments — query logic treating
         empty result as error

---

#### Test 5 — Google Docs report generation

1. In Slack: `@analyst-bot generate a report on Q1 pipeline with SGA breakdown`
   PASS: Bot replies "Working on your report..." in the channel thread
   FAIL: Normal query response instead → report intent regex not matching;
         check that "report" appears in the message

2. Wait 2-3 minutes
   PASS: DM arrives with Google Doc link
   FAIL: No DM after 5 minutes → check Cloud Logging:
   ```bash
   gcloud logging read \
     'resource.type="cloud_run_revision" AND textPayload=~"report-generator"' \
     --project=savvy-gtm-analytics \
     --limit=20 \
     --format="value(textPayload)"
   ```

3. Open the Google Doc
   PASS: Doc exists in "Analyst Bot Reports/Russell Moss/" folder,
         sections have headings, tables are populated, charts embedded,
         doc is shared with your email as writer
   FAIL: Doc exists but charts missing → Drive upload or InsertInlineImage
         failed; check for orphaned files in the Drive folder

4. Check admin App Home after report generation
   PASS: "Generated Reports" section shows the new report with ✅ status
         and a "View Doc" link
   FAIL: Report missing or shows ⏳ (stuck in running) → `bot_reports`
         status not being updated to 'done'

---

#### Test 6 — Edge cases

- **Schedule auto-disable:** Set `failure_count = 3` directly in Neon,
  trigger cron → verify schedule is set to `is_active = FALSE` and user
  receives DM notifying them the schedule was disabled

- **Unauthorized cron request:** `curl -X POST CLOUD_RUN_URL/internal/run-schedules`
  (no secret header) → PASS: 403 response

- **Report with failed section:** Ask for a report with 4+ sections where
  one question is intentionally unanswerable → PASS: Doc still created
  with "[Section failed to load]" placeholder for the failed section

- **Cancel from App Home while cron is mid-run:** Set `is_active = FALSE`
  in Neon while a schedule run is in flight → PASS: Run completes for
  current execution (cron already fetched it), but does not run again next cycle

---

## Spec Gap Resolution Checklist

| # | Gap | Resolution | Where |
|---|-----|-----------|-------|
| 1 | Audit table name wrong | Uses `AUDIT_DATASET`/`AUDIT_TABLE` env vars → `bot_audit.interaction_log` | `slack.ts` report_builder_submit handler |
| 2 | Env var `NEON_DATABASE_URL` | Uses `DATABASE_URL` throughout | All store files |
| 3 | Env var `BIGQUERY_PROJECT_ID` | Uses `BIGQUERY_PROJECT` throughout | `slack.ts`, `bq-query.ts` |
| 4 | DM channel = userId | Uses `conversations.open` via `dm-helper.ts` | `dm-helper.ts` |
| 5 | Frozen SQL returns 0 rows | DM "no results this run" message | `schedule-runner.ts` |
| 6 | Timezone for schedules | All timestamps UTC, DST drift documented | `schedule-store.ts` |
| 7 | batchUpdate index management | `endOfSegmentLocation` for appends, fetch doc for indices | `google-docs.ts` |
| 8 | Report intent too broad | Requires "report" in trigger phrase | `report-generator.ts` |
| 9 | `users:read.email` scope | Already in use — no new scope needed | n/a |
| 10 | `sections_json` underspecified | Extended with `narrativeText` and `errorMessage` per section | `types.ts` ReportSection |
| 11 | Cron endpoint registration | Uses `receiver.router.post` pattern from `/internal/cleanup` | `slack.ts` |
| 12 | `InsertInlineImage` requires public URI | `anyone/reader` permission on Drive file before embedding | `google-docs.ts` |
| 13 | Private key `\n` handling | `.replace(/\\n/g, '\n')` before JWT constructor | `google-docs.ts` |

---

## Refinement Log (Council Review Applied)

### Bucket 1 — Applied Autonomously

| # | Change | Why | Source | Phase |
|---|--------|-----|--------|-------|
| 1 | Cloud Run memory → 2GB, CPU → 2 | 3 concurrent sections + chart rendering needs headroom. OOM on a 3-min report is unacceptable. | Gemini (C5), User Q1 | 5 |
| 2 | Parse `sql_executed` as JSON array, take last element | Audit stores JSON.stringify(string[]), not a raw SQL string. Last query is typically the main data query. | Codex (C4) | 4 |
| 3 | Pass `sql_executed` through "Schedule This" button value JSON | Avoids BQ streaming buffer race condition. Data is already in the response pipeline — no round trip needed. | Gemini (C7), User Q3 | 4 |
| 4 | Gate "Schedule This" button on `provenanceQueryCount > 0` | Prevents confusing button on responses with no executed SQL. | Codex (S2) | 4 |
| 5 | Add `failure_count` to bot_schedules, auto-disable after 3 consecutive failures | Prevents infinite failure loops where broken SQL fires every 15 min. | Both (S3) | 0, 2b, 3a |
| 6 | Create shared `src/db.ts` pool module | Eliminates 3 duplicate getPool() singletons. One pool = one TLS connection setup on cold start. | Both (S4) | 2b |
| 7 | Add retry wrapper for Docs API batchUpdate (exponential backoff on 429/500) | Google Docs API is "notoriously flaky" — retries prevent transient failures from aborting reports. | Gemini (S6) | 2c |
| 8 | Document HTTP-mode-only constraint on cron endpoint | If SLACK_APP_TOKEN is set (Socket Mode), the Express receiver is undefined and cron route is never registered. | Codex (C8) | 4 |
| 9 | Add env var validation for CRON_SECRET and GOOGLE_DOCS_CREDENTIALS_JSON to index.ts | Fail fast at startup, not at first use. | Codex (S1) | 4 |

### Human Decisions Applied

| # | Question | Decision | Rationale |
|---|----------|----------|-----------|
| Q1 | Cloud Run memory | 2GB + 2 vCPU | OOM on a report users waited 3 min for is terrible. A few dollars/month. |
| Q2 | Public chart files | Accept for v1 with finally cleanup | Aggregated funnel data, not PII. GCS signed URLs are v2. |
| Q3 | Frozen SQL retrieval | Pass through button value JSON | Data already in pipeline. No BQ round trip, no streaming buffer risk. |

### Bucket 3 — Deferred to v2

| # | Item | Why Deferred |
|---|------|-------------|
| 1 | GCS signed URLs for chart embedding | Adds GCS dependency. Current approach works with cleanup. |
| 2 | Shared Drive for doc ownership | Requires Google Workspace admin. SA-owned docs fine for v1. |
| 3 | Claude tool calling for report intent | Adds latency/cost to every message. Regex sufficient for v1. |
| 4 | Sequential section processing | Concurrent is fine with 2GB RAM. |

### Post-Council Fix: Google Drive Folder Structure (verified via live testing)

**Finding:** The service account (`sheet-436@savvy-pirate-extension`) has 0 GB Drive storage quota. `docs.documents.create()` fails with "quota exceeded" because it creates docs in the SA's root Drive.

**Fix:** Create docs via `drive.files.create({ mimeType: 'application/vnd.google-apps.document', parents: [folderId] })` — creating directly in a shared folder bypasses the SA's quota. This is the same pattern used by `src/app/api/sqo-lag-export/route.ts`.

**Folder structure:**
```
Analyst Bot Reports (1Gxyv3Ce70IMiTB9Vxg_2ZDKfoIMktT65)
├── Russell Moss/
│   ├── Q1 Pipeline Report - 2026-04-11
│   └── SGA Performance Analysis - 2026-04-15
├── Another User/
│   └── ...
```

**Changes applied to google-docs.ts:**
- `createDoc()` now takes `userName` param and creates docs in per-user subfolders
- `getOrCreateUserFolder()` searches for existing folder by name, creates if not found
- User folder IDs cached in-memory Map
- Falls back to root folder if subfolder creation fails
- `REPORTS_ROOT_FOLDER_ID` constant: `1Gxyv3Ce70IMiTB9Vxg_2ZDKfoIMktT65`

**Also required:** Enable Google Docs API on `savvy-pirate-extension` project (done: `gcloud services enable docs.googleapis.com --project savvy-pirate-extension`)

**Live test results (2026-04-11):**
- Subfolder creation: PASS
- Doc creation in subfolder: PASS
- batchUpdate content insertion: PASS
- Heading styling with fields mask: PASS
- Table with bottom-up cell population: PASS
- Sharing with user email: PASS
- Test doc URL: https://docs.google.com/document/d/1JtG9OlxTB4YZ_d76flszhy5EqvxiCXn0NNEOGmRAuXI/edit

### Report Builder Modal UX Upgrade (post-council addition)

**What changed:** Replaced the bare "Schedule This" footer button flow with a full
Report Builder modal experience. Users now have a named, previewed, time-controlled
scheduling UX accessible from App Home and as a shortcut on query responses.

**Schema additions:** `report_name TEXT NOT NULL`, `deliver_at_hour INTEGER NOT NULL DEFAULT 9`,
`failure_count INTEGER NOT NULL DEFAULT 0` added to `bot_schedules`.

**New Slack interactions:**
- `open_report_builder` (action) — opens the Report Builder modal. Used by BOTH the
  App Home "New Report" button and the response footer "Schedule This" button.
- `report_builder_submit` (view) — runs the query live for a preview, then pushes
  the preview modal via `views.update`.
- `report_preview_confirm` (view) — saves the schedule to Neon, DMs confirmation,
  refreshes App Home.

**Old interactions removed:** `schedule_this` action, `confirm_schedule` view — both
fully replaced by the new three-step flow.

**Why:** The original flow required users to already have a query result before
scheduling and offered only a frequency selector. The new flow is a first-class
"design your report" experience with:
- User-defined report name
- Natural language question input (pre-filled when coming from "Schedule This")
- Delivery format choice (Slack DM or Google Doc)
- Delivery time control (UTC hour selector)
- Live preview of the report output before committing
- Three-step confirmation: Fill → Preview → Schedule

### Admin View Addition (pre-build addition)

**What changed:** Added admin App Home view for Russell Moss (U09DX3U7UTW) showing
all scheduled reports across all users with failure state indicators, plus all
generated Google Doc reports. Added `admin_cancel_schedule` action with owner DM
notification. Added `getAllSchedules()`, `getAllReports()`, `adminCancelSchedule()`
queries. `app_home_opened` now branches on `isAdmin(userId)`.

**Access control:** `ADMIN_SLACK_USER_IDS` env var (comma-separated). Falls back to
hardcoded `U09DX3U7UTW`. Non-admin users attempting `admin_cancel_schedule` are
rejected with a console.warn and no action taken.

**Failure visibility:** Admin view shows :warning: for 1 failure, :x: FAILING (N/3)
for 2+ failures — giving admin visibility to cancel before auto-disable fires.

**Owner notification:** When admin cancels another user's schedule, that user
receives a DM explaining what happened and pointing to #data-issues.
