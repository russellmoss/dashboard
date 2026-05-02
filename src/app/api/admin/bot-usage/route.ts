// src/app/api/admin/bot-usage/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { runQuery } from '@/lib/bigquery';
import { prisma } from '@/lib/prisma';
import { cachedQuery, CACHE_TAGS } from '@/lib/cache';

export const dynamic = 'force-dynamic';

const AUDIT_TABLE = '`savvy-gtm-analytics.bot_audit.interaction_log`';
const BOT_USAGE_TTL = 3600; // 1 hour

interface ScorecardRow {
  active_users_in_range: number;
  active_users_30d: number;
  total_questions: number;
  total_threads: number;
  error_count: number;
  issue_report_count: number;
}

interface TimeSeriesRow {
  day: { value: string } | string;
  questions: number;
  users: number;
}

interface InteractionRow {
  id: string;
  thread_id: string;
  channel_id: string;
  user_email: string;
  timestamp: { value: string } | string;
  user_message: string;
  assistant_response: string;
  tool_calls: string | null;
  sql_executed: string | null;
  bytes_scanned: number | null;
  chart_generated: boolean | null;
  chart_type: string | null;
  export_generated: boolean | null;
  is_issue_report: boolean | null;
  issue_details: string | null;
  error: string | null;
  thread_seq: number | null;
  thread_total: number | null;
}

const extractDate = (field: { value: string } | string | null | undefined): string | null => {
  if (!field) return null;
  if (typeof field === 'string') return field;
  if (typeof field === 'object' && 'value' in field) return field.value;
  return null;
};

const safeJsonParse = <T,>(s: string | null): T | null => {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
};

interface BotUsageQueryArgs {
  startDate: string | null;
  endDate: string | null;
  errorsOnly: boolean;
  issuesOnly: boolean;
  searchQuery: string;
  limit: number;
  offset: number;
}

async function _resolveSearchEmails(searchQuery: string): Promise<string[]> {
  if (!searchQuery) return [];
  const matchedUsers = await prisma.user.findMany({
    where: {
      OR: [
        { email: { contains: searchQuery, mode: 'insensitive' } },
        { name: { contains: searchQuery, mode: 'insensitive' } },
      ],
    },
    select: { email: true },
  });
  return matchedUsers.map((u) => u.email);
}

async function _resolveEmailToName(emails: string[]): Promise<Record<string, string>> {
  if (emails.length === 0) return {};
  const users = await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { email: true, name: true },
  });
  const map: Record<string, string> = {};
  for (const u of users) {
    if (u.email && u.name) map[u.email.toLowerCase()] = u.name;
  }
  return map;
}

function buildClauses(args: BotUsageQueryArgs, emailMatches: string[]) {
  const dateConds: string[] = [];
  const params: Record<string, any> = {};

  if (args.startDate) {
    dateConds.push('timestamp >= TIMESTAMP(@startDate)');
    params.startDate = args.startDate;
  }
  if (args.endDate) {
    dateConds.push('timestamp <= TIMESTAMP(@endDate)');
    params.endDate = `${args.endDate} 23:59:59`;
  }

  const extraConds: string[] = [];
  if (args.errorsOnly) extraConds.push('error IS NOT NULL');
  if (args.issuesOnly) extraConds.push('is_issue_report = TRUE');
  if (args.searchQuery) {
    extraConds.push(
      '(LOWER(user_email) LIKE LOWER(@searchLike) OR user_email IN UNNEST(@searchEmails))'
    );
    params.searchLike = `%${args.searchQuery}%`;
    params.searchEmails = emailMatches;
  }

  return { dateConds, extraConds, params };
}

/**
 * Cached BigQuery work for the bot-usage page.
 * Hourly TTL — manual refresh via revalidateTag(CACHE_TAGS.BOT_USAGE).
 */
const _getBotUsageData = async (args: BotUsageQueryArgs) => {
  const emailMatches = await _resolveSearchEmails(args.searchQuery);
  const { dateConds, extraConds, params } = buildClauses(args, emailMatches);

  const allConds = [...dateConds, ...extraConds];
  const fullClause = allConds.length ? `WHERE ${allConds.join(' AND ')}` : '';
  const dateOnlyClause = dateConds.length ? `WHERE ${dateConds.join(' AND ')}` : '';

  const scorecardSql = `
    SELECT
      (SELECT COUNT(DISTINCT user_email) FROM ${AUDIT_TABLE} ${fullClause}) AS active_users_in_range,
      (SELECT COUNT(DISTINCT user_email) FROM ${AUDIT_TABLE}
         WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)) AS active_users_30d,
      (SELECT COUNT(*) FROM ${AUDIT_TABLE} ${fullClause}) AS total_questions,
      (SELECT COUNT(DISTINCT thread_id) FROM ${AUDIT_TABLE} ${fullClause}) AS total_threads,
      (SELECT COUNTIF(error IS NOT NULL) FROM ${AUDIT_TABLE} ${fullClause}) AS error_count,
      (SELECT COUNTIF(is_issue_report = TRUE) FROM ${AUDIT_TABLE} ${fullClause}) AS issue_report_count
  `;

  const timeSeriesSql = `
    SELECT
      DATE(timestamp) AS day,
      COUNT(*) AS questions,
      COUNT(DISTINCT user_email) AS users
    FROM ${AUDIT_TABLE}
    ${fullClause}
    GROUP BY day
    ORDER BY day
  `;

  // Window functions partition over date-scoped subset only, so thread_seq /
  // thread_total reflect position within the thread, not within the page.
  const interactionsSql = `
    WITH base AS (
      SELECT
        id, thread_id, channel_id, user_email, timestamp,
        user_message, assistant_response,
        tool_calls, sql_executed, bytes_scanned,
        chart_generated, chart_type, export_generated,
        is_issue_report, issue_details, error,
        ROW_NUMBER() OVER (PARTITION BY thread_id ORDER BY timestamp) AS thread_seq,
        COUNT(*) OVER (PARTITION BY thread_id) AS thread_total
      FROM ${AUDIT_TABLE}
      ${dateOnlyClause}
    )
    SELECT *
    FROM base
    ${fullClause}
    ORDER BY timestamp DESC
    LIMIT ${args.limit} OFFSET ${args.offset}
  `;

  const [scorecardRows, timeSeriesRows, interactionRows] = await Promise.all([
    runQuery<ScorecardRow>(scorecardSql, params),
    runQuery<TimeSeriesRow>(timeSeriesSql, params),
    runQuery<InteractionRow>(interactionsSql, params),
  ]);

  const emails = Array.from(new Set(interactionRows.map((r) => r.user_email).filter(Boolean)));
  const emailToName = await _resolveEmailToName(emails);

  return {
    scorecardRows,
    timeSeriesRows,
    interactionRows,
    emailToName,
    cachedAt: new Date().toISOString(),
  };
};

const getBotUsageData = cachedQuery(
  _getBotUsageData,
  'getBotUsageData',
  CACHE_TAGS.BOT_USAGE,
  BOT_USAGE_TTL
);

const _getBotThread = async (threadId: string) => {
  const sql = `
    SELECT
      id, thread_id, channel_id, user_email, timestamp,
      user_message, assistant_response,
      tool_calls, sql_executed, bytes_scanned,
      chart_generated, chart_type, export_generated,
      is_issue_report, issue_details, error,
      ROW_NUMBER() OVER (PARTITION BY thread_id ORDER BY timestamp) AS thread_seq,
      COUNT(*) OVER (PARTITION BY thread_id) AS thread_total
    FROM ${AUDIT_TABLE}
    WHERE thread_id = @threadId
    ORDER BY timestamp ASC
  `;
  const rows = await runQuery<InteractionRow>(sql, { threadId });
  const emails = Array.from(new Set(rows.map((r) => r.user_email).filter(Boolean)));
  const emailToName = await _resolveEmailToName(emails);
  return { rows, emailToName, cachedAt: new Date().toISOString() };
};

const getBotThread = cachedQuery(
  _getBotThread,
  'getBotThread',
  CACHE_TAGS.BOT_USAGE,
  BOT_USAGE_TTL
);

function mapInteraction(r: InteractionRow, emailToName: Record<string, string>) {
  const email = r.user_email ?? '';
  return {
    id: r.id,
    threadId: r.thread_id,
    channelId: r.channel_id,
    userEmail: email,
    userName: email ? emailToName[email.toLowerCase()] ?? null : null,
    timestamp: extractDate(r.timestamp),
    userMessage: r.user_message ?? '',
    assistantResponse: r.assistant_response ?? '',
    toolCalls: safeJsonParse<unknown[]>(r.tool_calls) ?? [],
    sqlExecuted: safeJsonParse<string[]>(r.sql_executed) ?? [],
    bytesScanned: r.bytes_scanned == null ? 0 : Number(r.bytes_scanned),
    chartGenerated: !!r.chart_generated,
    chartType: r.chart_type,
    exportGenerated: !!r.export_generated,
    isIssueReport: !!r.is_issue_report,
    issueDetails: safeJsonParse<Record<string, unknown>>(r.issue_details),
    error: r.error,
    threadSeq: r.thread_seq == null ? null : Number(r.thread_seq),
    threadTotal: r.thread_total == null ? null : Number(r.thread_total),
  };
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }

    if (permissions.role !== 'revops_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const threadIdParam = searchParams.get('threadId');

    if (threadIdParam) {
      const { rows, emailToName, cachedAt } = await getBotThread(threadIdParam);
      return NextResponse.json({
        threadId: threadIdParam,
        interactions: rows.map((r) => mapInteraction(r, emailToName)),
        cachedAt,
      });
    }

    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const rawLimit = parseInt(searchParams.get('limit') ?? '100', 10);
    const rawOffset = parseInt(searchParams.get('offset') ?? '0', 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 100;
    const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0;
    const errorsOnly = searchParams.get('errorsOnly') === 'true';
    const issuesOnly = searchParams.get('issuesOnly') === 'true';
    const searchQuery = (searchParams.get('q') ?? '').trim();

    const args: BotUsageQueryArgs = {
      startDate,
      endDate,
      errorsOnly,
      issuesOnly,
      searchQuery,
      limit,
      offset,
    };

    const { scorecardRows, timeSeriesRows, interactionRows, emailToName, cachedAt } =
      await getBotUsageData(args);

    const sc = scorecardRows[0] ?? {
      active_users_in_range: 0,
      active_users_30d: 0,
      total_questions: 0,
      total_threads: 0,
      error_count: 0,
      issue_report_count: 0,
    };

    return NextResponse.json({
      scorecards: {
        activeUsersInRange: Number(sc.active_users_in_range) || 0,
        activeUsers30d: Number(sc.active_users_30d) || 0,
        totalQuestions: Number(sc.total_questions) || 0,
        totalThreads: Number(sc.total_threads) || 0,
        errorCount: Number(sc.error_count) || 0,
        issueReportCount: Number(sc.issue_report_count) || 0,
      },
      timeSeries: timeSeriesRows.map((r) => ({
        date: extractDate(r.day),
        questions: Number(r.questions) || 0,
        users: Number(r.users) || 0,
      })),
      interactions: interactionRows.map((r) => mapInteraction(r, emailToName)),
      pagination: {
        limit,
        offset,
        returned: interactionRows.length,
      },
      filters: {
        startDate,
        endDate,
        q: searchQuery || null,
        errorsOnly,
        issuesOnly,
      },
      cachedAt,
    });
  } catch (error) {
    console.error('[API] Error fetching bot usage:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch bot usage' },
      { status: 500 }
    );
  }
}
