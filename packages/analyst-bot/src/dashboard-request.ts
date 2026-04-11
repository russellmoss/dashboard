// packages/analyst-bot/src/dashboard-request.ts
// ============================================================================
// Create DashboardRequest entries + sync to BigQuery issue tracking tables
//
// BigQuery schema:
//   bot_audit.issues        — one mutable row per issue (current state)
//   bot_audit.issue_events  — append-only audit trail (every change)
//   bot_audit.issue_summary — VIEW joining both for easy querying
// ============================================================================

import { Pool } from 'pg';
import { BigQuery } from '@google-cloud/bigquery';
import crypto from 'crypto';
import { IssueReport } from './types';

let pool: Pool | null = null;
let bigquery: BigQuery | null = null;

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

function getBigQuery(): BigQuery {
  if (!bigquery) {
    bigquery = new BigQuery({ projectId: process.env.BIGQUERY_PROJECT });
  }
  return bigquery;
}

function verbose(...args: any[]): void {
  if (process.env.VERBOSE === 'true') console.error(...args);
}

/**
 * Look up a dashboard User by email.
 */
async function findUserByEmail(email: string): Promise<{ id: string; name: string; email: string } | null> {
  const result = await getPool().query(
    `SELECT id, name, email FROM "User" WHERE email = $1 AND "isActive" = true LIMIT 1`,
    [email]
  );
  return result.rows[0] ?? null;
}

/**
 * Write to bot_audit.issues (DML INSERT — no streaming buffer, immediately updatable)
 * and bot_audit.issue_events (streaming insert for the "created" event).
 */
function syncIssueToBigQuery(
  dashboardRequestId: string,
  title: string,
  description: string,
  priority: string,
  reporterEmail: string,
  reporterName: string,
  threadLink: string,
  now: Date,
): void {
  const bq = getBigQuery();
  const dataset = process.env.AUDIT_DATASET;
  if (!dataset) return;

  const timestamp = now.toISOString();

  // 1. Insert into issues table via DML (not streaming) so it's immediately updatable
  bq.query({
    query: `INSERT INTO \`${dataset}.issues\`
      (dashboard_request_id, title, description, priority, status, reporter_email, reporter_name, source, thread_id, created_at, updated_at)
      VALUES (@id, @title, @desc, @priority, 'SUBMITTED', @email, @name, 'analyst-bot', @thread, @ts, @ts)`,
    params: {
      id: dashboardRequestId, title, desc: description, priority,
      email: reporterEmail, name: reporterName, thread: threadLink, ts: timestamp,
    },
    types: {
      id: 'STRING', title: 'STRING', desc: 'STRING', priority: 'STRING',
      email: 'STRING', name: 'STRING', thread: 'STRING', ts: 'TIMESTAMP',
    },
  }).then(() => verbose('📊 Issue row created in BigQuery'))
    .catch((err) => console.error('[dashboard-request] BQ issues insert failed:', err.message));

  // 2. Append "created" event to issue_events via streaming insert
  bq.dataset(dataset).table('issue_events').insert([{
    event_id: crypto.randomUUID(),
    dashboard_request_id: dashboardRequestId,
    event_type: 'created',
    actor_email: reporterEmail,
    actor_name: reporterName,
    old_value: null,
    new_value: 'SUBMITTED',
    metadata: JSON.stringify({ title, description, priority, thread: threadLink }),
    created_at: timestamp,
  }]).then(() => verbose('📊 Issue created event logged'))
    .catch((err) => console.error('[dashboard-request] BQ event insert failed:', err.message));
}

/**
 * Create a DashboardRequest from a bot issue report.
 * Writes to Neon (DashboardRequest), BigQuery (issues + issue_events).
 */
export async function createDashboardRequest(
  issue: IssueReport,
  userEmail: string
): Promise<string | null> {
  try {
    const user = await findUserByEmail(userEmail);
    let submitterId = user?.id ?? null;
    const reporterName = user?.name ?? userEmail;

    if (!submitterId) {
      submitterId = process.env.BOT_SUBMITTER_ID ?? null;
    }
    if (!submitterId) {
      console.error('[dashboard-request] No submitter found for', userEmail, 'and BOT_SUBMITTER_ID not set');
      return null;
    }

    const id = 'cbot_' + crypto.randomUUID().replace(/-/g, '').substring(0, 20);
    const now = new Date();

    const title = issue.originalQuestion
      ? `[Bot Issue] ${issue.originalQuestion}`
      : '[Bot Issue] Data issue reported via analyst bot';

    const descriptionParts: string[] = [];
    if (issue.whatLooksWrong) descriptionParts.push(`**What looks wrong:** ${issue.whatLooksWrong}`);
    if (issue.whatExpected) descriptionParts.push(`**Expected:** ${issue.whatExpected}`);
    if (issue.sqlExecuted?.length > 0) descriptionParts.push(`**SQL executed:**\n\`\`\`\n${issue.sqlExecuted.join('\n')}\n\`\`\``);
    if (issue.schemaToolsCalled?.length > 0) descriptionParts.push(`**Schema tools called:** ${issue.schemaToolsCalled.join(', ')}`);
    descriptionParts.push(`**Reporter:** ${reporterName} (${userEmail})`);
    descriptionParts.push(`**Priority:** ${issue.priority ?? 'MEDIUM'}`);
    const threadDisplay = issue.threadLink.startsWith('https://')
      ? `[View Slack thread](${issue.threadLink})`
      : issue.threadLink;
    descriptionParts.push(`**Source:** Savvy Analyst Bot — ${threadDisplay}`);
    const description = descriptionParts.join('\n\n');

    const priority = issue.priority ?? 'MEDIUM';

    // Write to Neon DashboardRequest table
    await getPool().query(
      `INSERT INTO "DashboardRequest" (
        id, title, description, "requestType", status, priority,
        "submitterId", "statusChangedAt", "createdAt", "updatedAt",
        "valueSeen", "valueExpected", "isPrivate"
      ) VALUES ($1, $2, $3, 'DATA_ERROR', 'SUBMITTED', $4,
        $5, $6, $6, $6, $7, $8, false)`,
      [id, title.substring(0, 255), description, priority, submitterId, now,
        issue.whatLooksWrong?.substring(0, 500) || null,
        issue.whatExpected?.substring(0, 500) || null],
    );

    verbose(`📋 Dashboard request created: ${id} (submitter: ${reporterName})`);

    // Write to BigQuery (fire-and-forget)
    syncIssueToBigQuery(id, title, description, priority, userEmail, reporterName, issue.threadLink, now);

    return id;
  } catch (err) {
    console.error('[dashboard-request] Failed to create:', (err as Error).message);
    return null;
  }
}
