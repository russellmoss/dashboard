// packages/analyst-bot/src/dashboard-request.ts
// ============================================================================
// Create DashboardRequest entries for issue reports + sync to BigQuery
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
 * Returns { id, name, email } or null.
 */
async function findUserByEmail(email: string): Promise<{ id: string; name: string; email: string } | null> {
  const result = await getPool().query(
    `SELECT id, name, email FROM "User" WHERE email = $1 AND "isActive" = true LIMIT 1`,
    [email]
  );
  return result.rows[0] ?? null;
}

/**
 * Write the initial issue_tracker row to BigQuery.
 * Fire-and-forget — errors logged but never thrown.
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

  const row = {
    dashboard_request_id: dashboardRequestId,
    title,
    description,
    priority,
    status: 'SUBMITTED',
    reporter_email: reporterEmail,
    reporter_name: reporterName,
    comments: JSON.stringify([]),
    source: 'analyst-bot',
    thread_id: threadLink,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    status_changed_at: now.toISOString(),
  };

  bq.dataset(dataset)
    .table('issue_tracker')
    .insert([row])
    .then(() => verbose('📊 Issue synced to BigQuery issue_tracker'))
    .catch((err) => {
      console.error('[dashboard-request] BigQuery sync failed:', err.message);
    });
}

/**
 * Create a DashboardRequest from a bot issue report.
 * Writes to both Neon (DashboardRequest table) and BigQuery (issue_tracker).
 * Works from both CLI and Slack mode.
 */
export async function createDashboardRequest(
  issue: IssueReport,
  userEmail: string
): Promise<string | null> {
  try {
    // Resolve submitter — try email lookup first, then fallback
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

    // Build description from available fields
    const descriptionParts: string[] = [];
    if (issue.whatLooksWrong) {
      descriptionParts.push(`**What looks wrong:** ${issue.whatLooksWrong}`);
    }
    if (issue.whatExpected) {
      descriptionParts.push(`**Expected:** ${issue.whatExpected}`);
    }
    if (issue.sqlExecuted?.length > 0) {
      descriptionParts.push(`**SQL executed:**\n\`\`\`\n${issue.sqlExecuted.join('\n')}\n\`\`\``);
    }
    if (issue.schemaToolsCalled?.length > 0) {
      descriptionParts.push(`**Schema tools called:** ${issue.schemaToolsCalled.join(', ')}`);
    }
    descriptionParts.push(`**Reporter:** ${reporterName} (${userEmail})`);
    descriptionParts.push(`**Priority:** ${issue.priority ?? 'MEDIUM'}`);
    descriptionParts.push(`**Source:** Savvy Analyst Bot (${issue.threadLink})`);

    const description = descriptionParts.join('\n\n');
    const priority = issue.priority ?? 'MEDIUM';

    await getPool().query(
      `INSERT INTO "DashboardRequest" (
        id, title, description, "requestType", status, priority,
        "submitterId", "statusChangedAt", "createdAt", "updatedAt",
        "valueSeen", "valueExpected", "isPrivate"
      ) VALUES ($1, $2, $3, 'DATA_ERROR', 'SUBMITTED', $4,
        $5, $6, $6, $6,
        $7, $8, false
      )`,
      [
        id,
        title.substring(0, 255),
        description,
        priority,
        submitterId,
        now,
        issue.whatLooksWrong?.substring(0, 500) || null,
        issue.whatExpected?.substring(0, 500) || null,
      ]
    );

    verbose(`📋 Dashboard request created: ${id} (submitter: ${reporterName})`);

    // Sync to BigQuery issue_tracker (fire-and-forget)
    syncIssueToBigQuery(id, title, description, priority, userEmail, reporterName, issue.threadLink, now);

    return id;
  } catch (err) {
    console.error('[dashboard-request] Failed to create:', (err as Error).message);
    return null;
  }
}
