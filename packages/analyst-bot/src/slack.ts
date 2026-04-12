// packages/analyst-bot/src/slack.ts
// ============================================================================
// Slack Bolt app setup and event handlers
// ============================================================================
//
// KEY DESIGN: Ack-fast pattern for Cloud Run.
// Slack requires HTTP 200 within 3 seconds. Claude + MCP + charts exceed this.
// Solution: Do NOT use processBeforeResponse. Bolt acks immediately, then the
// handler runs asynchronously. Cloud Run must use --no-cpu-throttling to keep
// CPU allocated after the response is sent.

import { App, ExpressReceiver, LogLevel } from '@slack/bolt';
import type { BlockAction, ButtonAction } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';
import { processMessage } from './conversation';
import { postIssueToChannel } from './issues';
import { loadThread, saveUserQuery, getRecentQueriesForUser } from './thread-store';
import { createDashboardRequest } from './dashboard-request';
import { buildHomeView, buildAdminHomeView } from './app-home';
import { dmUser } from './dm-helper';
import { createSchedule, getActiveSchedulesForUser, cancelSchedule, getAllSchedules, adminCancelSchedule, computeNextRunAt } from './schedule-store';
import { isReportRequest, generateReport } from './report-generator';
import { runDueSchedules } from './schedule-runner';
import { getAllReports } from './report-store';
import { IssueReport, IssuePriority, ScheduleFrequency } from './types';

// Admin user IDs — see admin App Home view instead of regular user view.
// Configured via ADMIN_SLACK_USER_IDS env var (comma-separated).
// Falls back to hardcoded Russell Moss ID if env var is unset.
const ADMIN_USER_IDS = new Set(
  (process.env.ADMIN_SLACK_USER_IDS ?? 'U09DX3U7UTW').split(',').map(s => s.trim()).filter(Boolean)
);

function isAdmin(userId: string): boolean {
  return ADMIN_USER_IDS.has(userId);
}

// In-memory cache for user email lookups
const userEmailCache = new Map<string, string>();

// ---- Distributed deduplication via Upstash Redis ----
// Falls back to in-memory Map if Redis is not configured.
// In-memory fallback works for single-instance Cloud Run (min-instances: 1)
// but does NOT deduplicate across replicas if Cloud Run scales horizontally.
// For production multi-instance deployments, set UPSTASH_REDIS_REST_URL and
// UPSTASH_REDIS_REST_TOKEN to enable distributed dedup.

let redis: Redis | null = null;
let rateLimiter: Ratelimit | null = null;

function getRedis(): Redis | null {
  if (redis) return redis;
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    rateLimiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(5, '60s'),
      prefix: 'analyst-bot:ratelimit',
    });
    console.log('[dedup] Using Upstash Redis for distributed dedup + rate limiting');
    return redis;
  }
  return null;
}

// In-memory fallback dedup (single-instance only)
const inMemoryDedup = new Map<string, number>(); // eventId → expiry timestamp

async function isDuplicate(eventId: string): Promise<boolean> {
  const r = getRedis();
  if (r) {
    // Redis-backed: SET NX with 60s TTL — returns null if key already exists
    const key = `analyst-bot:dedup:${eventId}`;
    const set = await r.set(key, '1', { nx: true, ex: 60 });
    if (set === null) {
      console.log(`[dedup] Dropping duplicate event ${eventId} (Redis)`);
      return true;
    }
    return false;
  }

  // In-memory fallback — clean expired entries, then check
  const now = Date.now();
  for (const [key, expiry] of inMemoryDedup.entries()) {
    if (expiry < now) inMemoryDedup.delete(key);
  }
  if (inMemoryDedup.has(eventId)) {
    console.log(`[dedup] Dropping duplicate event ${eventId} (in-memory)`);
    return true;
  }
  inMemoryDedup.set(eventId, now + 60_000);
  return false;
}

/**
 * Per-user rate limit: 5 requests per 60 seconds.
 * Returns true if the user should be rate-limited (over quota).
 * Returns false if Upstash Redis is not configured (no rate limiting).
 */
async function isRateLimited(userId: string): Promise<boolean> {
  if (!rateLimiter) return false;
  try {
    const { success } = await rateLimiter.limit(userId);
    return !success;
  } catch (err) {
    console.error('[ratelimit] Check failed, allowing request:', (err as Error).message);
    return false; // fail open — don't block users if Redis is down
  }
}

/**
 * Resolve a Slack user ID to their email address.
 * Results are cached in-memory.
 */
async function getUserEmail(client: any, userId: string): Promise<string> {
  const cached = userEmailCache.get(userId);
  if (cached) return cached;

  try {
    const result = await client.users.info({ user: userId });
    const email = result.user?.profile?.email ?? `${userId}@unknown`;
    userEmailCache.set(userId, email);
    return email;
  } catch {
    return `${userId}@unknown`;
  }
}

/**
 * Check if a channel is in the allowlist.
 */
function isAllowedChannel(channelId: string): boolean {
  const allowed = process.env.ALLOWED_CHANNELS?.split(',').map((c) => c.trim()) ?? [];
  return allowed.includes(channelId);
}

/**
 * Build a Slack thread link.
 */
function buildThreadLink(channelId: string, threadTs: string): string {
  return `https://slack.com/archives/${channelId}/p${threadTs.replace('.', '')}`;
}

// ---- "Working on it" personality messages ----

const WORKING_MESSAGES = [
  ':pickaxe: Off to the mines of BigQuery to fetch your answers. Back in a sec.',
  ':mag: Diving into the data warehouse. Hold tight.',
  ':rocket: On it. Querying the mothership now.',
  ':gear: Crunching the numbers. This is the fun part (for me, anyway).',
  ':books: Let me check the receipts. One moment.',
  ':detective: Investigating. I love a good data mystery.',
  ':coffee: Brewing up your answer. Give me a moment.',
  ':satellite: Pinging the data warehouse. Stand by for results.',
  ':bar_chart: Running the numbers. I live for this.',
  ':flashlight: Digging through the data. Be right back.',
  ':zap: On it. Let me see what the numbers say.',
  ':nerd_face: Great question. Let me go find out.',
  ':hammer_and_wrench: Working on it. BigQuery and I are having a chat.',
  ':crystal_ball: Consulting the data oracle. One moment.',
  ':abacus: Doing the math. I promise I won\'t guess.',
];

function getWorkingMessage(): string {
  return WORKING_MESSAGES[Math.floor(Math.random() * WORKING_MESSAGES.length)];
}

/**
 * Post a fun "working on it" message and return its ts for later in-place update.
 * The returned ts is used by chat.update to replace the working message with the
 * final Block Kit response — no delete+post flicker.
 */
async function postWorkingMessage(
  client: any,
  channelId: string,
  threadTs: string
): Promise<string | null> {
  try {
    const result = await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: getWorkingMessage(),
    });
    return result.ts ?? null;
  } catch {
    return null; // Non-critical
  }
}

// ---- Issue reporting via Slack modal ----

const ISSUE_TRIGGERS = [
  'report issue', "this doesn't look right", 'flag this',
  'this looks wrong', 'something is off',
];

function isIssueTrigger(text: string): boolean {
  return ISSUE_TRIGGERS.some((t) => text.toLowerCase().includes(t));
}

/**
 * Extract issue description if the user wrote text after the trigger phrase.
 * e.g., "report issue the SGA list has non-SGAs" → "the SGA list has non-SGAs"
 */
function extractIssueText(text: string): string {
  for (const trigger of ISSUE_TRIGGERS) {
    const idx = text.toLowerCase().indexOf(trigger);
    if (idx !== -1) {
      const after = text.substring(idx + trigger.length).replace(/^[:\-–—\s]+/, '').trim();
      if (after) return after;
    }
  }
  return '';
}

/**
 * Post a "Report Issue" button in the thread instead of starting a multi-turn
 * conversation with Claude. Clicking the button opens a Slack modal form.
 */
async function postIssueButton(
  client: any,
  channelId: string,
  threadTs: string,
  threadId: string,
  prefillText: string
): Promise<void> {
  const thread = await loadThread(threadId);
  const firstUserMsg = thread?.messages.find(
    (m) => m.role === 'user' && typeof m.content === 'string'
  );
  const originalQuestion = (firstUserMsg?.content as string) ?? '';

  const metadata = JSON.stringify({
    channelId,
    threadTs,
    threadId,
    originalQuestion: originalQuestion.substring(0, 500),
    prefillText: prefillText.substring(0, 500),
  });

  const blocks: KnownBlock[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: ':triangular_flag_on_post: Click below to file a data issue.',
      },
    },
  ];

  if (originalQuestion) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Original question:*\n>${originalQuestion.substring(0, 300)}`,
      },
    });
  }

  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Report Issue' },
        style: 'danger',
        action_id: 'open_issue_modal',
        value: metadata,
      },
    ],
  });

  await client.chat.postMessage({
    channel: channelId,
    thread_ts: threadTs,
    text: 'Click the button to file a data issue.',
    blocks,
  });
}

// ---- Response formatting utilities ----

/**
 * Split a long message into chunks that stay under a character limit.
 * Splits at paragraph boundaries (\n\n) while keeping code blocks
 * (``` ... ```) as atomic units that are never split across chunks.
 */
function splitSlackMessage(text: string, maxLen = 3800): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let current = '';

  const segments = text.split(/(```[\s\S]*?```)/g);

  for (const segment of segments) {
    if (!segment) continue;
    const isCodeBlock = segment.startsWith('```') && segment.endsWith('```');

    if (isCodeBlock) {
      if (current.length + segment.length > maxLen && current.trim()) {
        chunks.push(current.trimEnd());
        current = '';
      }
      current += segment;
    } else {
      const paragraphs = segment.split(/(\n\n)/);
      for (const para of paragraphs) {
        if (current.length + para.length > maxLen && current.trim()) {
          chunks.push(current.trimEnd());
          current = '';
        }
        current += para;
      }
    }
  }

  if (current.trim()) chunks.push(current.trimEnd());
  return chunks.length ? chunks : [text];
}

interface TableSnippet {
  content: string;
  title: string;
}

/**
 * Extract large code blocks (tables, matrices, grids) from the message text
 * and return them as separate snippets to be uploaded as text files.
 * Code blocks with fewer than minLines stay inline.
 */
function extractTableSnippets(text: string, minLines = 5): { text: string; snippets: TableSnippet[] } {
  const snippets: TableSnippet[] = [];

  const result = text.replace(/```(?:sql)?\n([\s\S]*?\n)```/g, (match, content: string) => {
    const lines = content.trim().split('\n');
    if (lines.length < minLines) return match;

    // Skip SQL code blocks — they should stay inline, not be extracted as file snippets.
    // SQL blocks start with SELECT, WITH, INSERT, or common SQL keywords.
    const firstLine = content.trim().split('\n')[0].trim().toUpperCase();
    if (/^(SELECT|WITH|--|\/\*|CREATE|ALTER|INSERT|UPDATE|DELETE|EXPLAIN)\b/.test(firstLine)) {
      return match; // keep SQL inline
    }

    let title = 'Data Table';
    if (/[╔╗╚╝╠╣╬║═┌┐└┘├┤┬┴┼│]/.test(content)) {
      title = 'Performance Matrix';
    } else if (/──────/.test(content)) {
      title = 'Leaderboard';
    } else if (/\|[-:]+\|/.test(content)) {
      title = 'Results Table';
    }

    snippets.push({ content: content.trim(), title });
    return '';
  });

  return { text: result.replace(/\n{3,}/g, '\n\n').trim(), snippets };
}

/**
 * Strip the plain-text export/issue footer that Claude appends to every response.
 * We replace it with interactive Block Kit buttons.
 */
function stripFooter(text: string): string {
  // Remove the "---\n"export xlsx"...\n"report issue"..." footer
  return text
    .replace(/\n?---\n"export xlsx"[^\n]*\n"report issue"[^\n]*/i, '')
    .replace(/\n?———\n"export xlsx"[^\n]*\n"report issue"[^\n]*/i, '')
    .trimEnd();
}

/**
 * Format query provenance for display in a Slack context block.
 * Shows query count (singular/plural) and bytes scanned in human-readable units.
 */
function formatProvenance(queryCount: number, bytesScanned: number): string {
  const queryLabel = queryCount === 1 ? '1 query' : `${queryCount} queries`;

  let bytesLabel: string;
  if (bytesScanned <= 0) {
    bytesLabel = 'usage unavailable';
  } else if (bytesScanned < 1_048_576) { // < 1 MB
    bytesLabel = '< 1 MB scanned';
  } else if (bytesScanned < 1_073_741_824) { // < 1 GB
    const mb = (bytesScanned / 1_048_576).toFixed(1);
    bytesLabel = `${mb} MB scanned`;
  } else {
    const gb = (bytesScanned / 1_073_741_824).toFixed(2);
    bytesLabel = `${gb} GB scanned`;
  }

  return `:mag: ${queryLabel} · ${bytesLabel}`;
}

/**
 * Build Block Kit blocks for an analyst bot response.
 * Uses MarkdownBlock (type: 'markdown') for the main body — it accepts real
 * markdown (headings, bold, pipe tables) and Slack renders it natively.
 * This eliminates the need for toSlackMrkdwn() conversion.
 *
 * Follow-up suggestions stay as plain text in the body (too long for button labels).
 * Footer has two action buttons: Export XLSX + Report Issue.
 * Provenance context block (query count + bytes scanned) is always last.
 */
function buildResponseBlocks(
  bodyText: string,
  channelId: string,
  threadTs: string,
  queryCount: number,
  bytesScanned: number,
  questionText?: string,
  frozenSql?: string,
): KnownBlock[] {
  const blocks: KnownBlock[] = [];

  // Main body — split into chunks for the 12K char MarkdownBlock limit
  const chunks = splitSlackMessage(bodyText, 11_000);
  for (const chunk of chunks) {
    blocks.push({
      type: 'markdown',
      text: chunk,
    } as KnownBlock);
  }

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
  console.log(`[buildResponseBlocks] queryCount=${queryCount}, questionText="${questionText?.substring(0, 50)}", frozenSql=${frozenSql ? 'present' : 'absent'}, footerElements=${footerElements.length}`);
  if (queryCount > 0 && questionText) {
    footerElements.push({
      type: 'button',
      text: { type: 'plain_text', text: ':calendar: Schedule This', emoji: true },
      action_id: 'open_report_builder',
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

  // Provenance context block — always last, small grey text
  if (queryCount > 0) {
    blocks.push({
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: formatProvenance(queryCount, bytesScanned),
      }],
    } as KnownBlock);
  }

  return blocks;
}

/**
 * Handle a bot response — update working message in-place with Block Kit,
 * upload chart/xlsx/snippets, post issues.
 */
async function handleResponse(
  client: any,
  channelId: string,
  threadTs: string,
  eventTs: string,
  userId: string,
  result: Awaited<ReturnType<typeof processMessage>>,
  workingTs: string | null,
  progressTimers: NodeJS.Timeout[],
  questionText?: string,
): Promise<void> {
  // Clear progress timers before final update
  for (const t of progressTimers) clearTimeout(t);

  // Strip the plain-text footer (replaced by interactive buttons) and extract table snippets
  const bodyText = stripFooter(result.text);
  const { text: cleanText, snippets } = extractTableSnippets(bodyText);

  // Extract frozen SQL for the "Schedule This" button (last SQL executed is the main data query)
  const frozenSql = (result as any).sqlExecuted?.length > 0
    ? (result as any).sqlExecuted[(result as any).sqlExecuted.length - 1]
    : undefined;

  // Build Block Kit blocks — follow-up suggestion stays as inline text
  const blocks = buildResponseBlocks(
    cleanText, channelId, threadTs,
    result.provenanceQueryCount, result.provenanceBytesScanned,
    questionText, frozenSql,
  );

  // Plain-text fallback for push notifications
  const fallback = cleanText.substring(0, 300).replace(/[*`#]/g, '');

  // Update working message in-place with final Block Kit response (no flicker)
  if (workingTs) {
    try {
      await client.chat.update({
        channel: channelId,
        ts: workingTs,
        text: fallback,
        blocks,
      });
    } catch (err) {
      console.error('[slack] chat.update failed, falling back to postMessage:', (err as Error).message);
      // Fallback: post as new message
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: fallback,
        blocks,
      });
    }
  } else {
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: fallback,
      blocks,
    });
  }

  // Upload large tables/matrices as text file snippets
  for (const snippet of snippets) {
    try {
      await client.filesUploadV2({
        channel_id: channelId,
        thread_ts: threadTs,
        file: Buffer.from(snippet.content, 'utf-8'),
        filename: `${snippet.title.toLowerCase().replace(/\s+/g, '_')}.txt`,
        title: snippet.title,
      });
    } catch (err) {
      console.error('[slack] Snippet upload failed:', (err as Error).message);
    }
  }

  // Upload chart if generated
  if (result.chartBuffer) {
    try {
      await client.filesUploadV2({
        channel_id: channelId,
        thread_ts: threadTs,
        file: result.chartBuffer,
        filename: `chart_${result.chartType ?? 'data'}.png`,
        title: `${result.chartType ?? 'Data'} Chart`,
      });
    } catch (err) {
      console.error('[slack] Chart upload failed:', (err as Error).message);
    }
  }

  // Upload XLSX if generated
  if (result.xlsxBuffer && result.xlsxFilename) {
    try {
      await client.filesUploadV2({
        channel_id: channelId,
        thread_ts: threadTs,
        file: result.xlsxBuffer,
        filename: result.xlsxFilename,
        title: result.xlsxFilename.replace(/_/g, ' ').replace(/\.xlsx$/, ''),
      });
    } catch (err) {
      console.error('[slack] XLSX upload failed:', (err as Error).message);
    }
  }

  // Post issue to #data-issues if this is an issue report
  if (result.isIssueReport && result.issueDetails) {
    result.issueDetails.reporterSlackId = userId;
    await postIssueToChannel(client, result.issueDetails);
  }

  // Swap hourglass for checkmark
  try {
    await client.reactions.remove({
      channel: channelId,
      timestamp: eventTs,
      name: 'hourglass_flowing_sand',
    });
    await client.reactions.add({
      channel: channelId,
      timestamp: eventTs,
      name: 'white_check_mark',
    });
  } catch {
    // Non-critical
  }
}

/**
 * Set up progressive mid-flight update timers on the working message.
 * Updates at 60s and 120s so the user knows the bot is still alive.
 * Returns timer handles so the caller can clear them on completion.
 */
function setupProgressTimers(
  client: any,
  channelId: string,
  workingTs: string | null,
): NodeJS.Timeout[] {
  if (!workingTs) return [];

  const t1 = setTimeout(async () => {
    try {
      await client.chat.update({
        channel: channelId,
        ts: workingTs,
        text: ':hourglass: Still working — complex query in progress...',
        blocks: [{
          type: 'section',
          text: { type: 'mrkdwn', text: ':hourglass: Still working — complex query in progress...' },
        }],
      });
    } catch { /* non-critical */ }
  }, 60_000);

  const t2 = setTimeout(async () => {
    try {
      await client.chat.update({
        channel: channelId,
        ts: workingTs,
        text: ':hourglass: Almost there — finalizing results...',
        blocks: [{
          type: 'section',
          text: { type: 'mrkdwn', text: ':hourglass: Almost there — finalizing results...' },
        }],
      });
    } catch { /* non-critical */ }
  }, 120_000);

  return [t1, t2];
}

/**
 * Process a user query end-to-end: post working message, set progress timers,
 * call Claude, update in-place with Block Kit response.
 * Shared by app_mention and message handlers.
 */
async function processAndRespond(
  client: any,
  channelId: string,
  threadTs: string,
  eventTs: string,
  userId: string,
  userEmail: string,
  text: string,
): Promise<void> {
  const workingTs = await postWorkingMessage(client, channelId, threadTs);
  const progressTimers = setupProgressTimers(client, channelId, workingTs);

  try {
    const threadId = `${channelId}:${threadTs}`;
    const slackThreadLink = buildThreadLink(channelId, threadTs);
    const result = await processMessage(text, threadId, channelId, userEmail, { threadLink: slackThreadLink });
    await handleResponse(client, channelId, threadTs, eventTs, userId, result, workingTs, progressTimers, text);
    // Save query for App Home recent queries (fire-and-forget)
    saveUserQuery(userId, text);
  } catch (err) {
    for (const t of progressTimers) clearTimeout(t);
    console.error('[slack] handler error:', (err as Error).message);

    // Update working message with error (or post new if no working message)
    const errorText = `Sorry, I ran into a technical issue. Please try again or simplify your question.`;
    if (workingTs) {
      try {
        await client.chat.update({
          channel: channelId,
          ts: workingTs,
          text: errorText,
          blocks: [{
            type: 'section',
            text: { type: 'mrkdwn', text: `:warning: ${errorText}` },
          }],
        });
        return;
      } catch { /* fall through */ }
    }
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: errorText,
    }).catch(() => {});
  }
}

export async function startSlackApp(): Promise<void> {
  const useSocketMode = !!process.env.SLACK_APP_TOKEN;

  // Use ExpressReceiver for HTTP mode to get access to router for custom endpoints
  const receiver = useSocketMode
    ? undefined
    : new ExpressReceiver({
        signingSecret: process.env.SLACK_SIGNING_SECRET!,
      });

  const slackApp = new App({
    token: process.env.SLACK_BOT_TOKEN,
    ...(useSocketMode
      ? { socketMode: true, appToken: process.env.SLACK_APP_TOKEN }
      : { receiver }),
    // Do NOT set processBeforeResponse: true — we ack fast, process async.
    // Cloud Run must use --no-cpu-throttling to keep CPU alive after ack.
    logLevel: LogLevel.INFO,
  });

  // ---- App Home tab ----

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

  // Quick-launch and Ask Again buttons from App Home — each has a unique action_id
  // but they all do the same thing: open a DM, post the question, run it.
  const quickLaunchIds = [
    'home_quick_pipeline', 'home_quick_sga', 'home_quick_funnel',
    'home_quick_sqos', 'home_quick_leads', 'home_ask_again',
  ];
  for (const actionId of quickLaunchIds) {
    slackApp.action<BlockAction<ButtonAction>>(
      actionId,
      async ({ ack, body, client }) => {
        await ack(); // within 3 seconds

        const action = body.actions[0] as ButtonAction;
        const question = action.value;
        const userId = body.user.id;
        if (!question || !userId) return;

        // Open a DM with the user to post results
        let dmChannelId: string | undefined;
        try {
          const dm = await client.conversations.open({ users: userId });
          dmChannelId = dm.channel?.id;
        } catch (err) {
          console.error('[app_home] Failed to open DM:', (err as Error).message);
          return;
        }
        if (!dmChannelId) return;

        // Post the question as a visible message in the DM
        let questionTs: string | undefined;
        try {
          const posted = await client.chat.postMessage({
            channel: dmChannelId,
            text: question,
          });
          questionTs = posted.ts;
        } catch (err) {
          console.error('[app_home] Failed to post question:', (err as Error).message);
          return;
        }
        if (!questionTs) return;

        const userEmail = await getUserEmail(client, userId);

        // Run through normal pipeline — post working message in thread, process, respond
        await processAndRespond(client, dmChannelId, questionTs, questionTs, userId, userEmail, question);

        // Refresh Home tab so recent queries + schedules update
        const [recentQueries, activeSchedules] = await Promise.all([
          getRecentQueriesForUser(userId),
          getActiveSchedulesForUser(userId),
        ]);
        try {
          await client.views.publish({
            user_id: userId,
            view: {
              type: 'home',
              blocks: buildHomeView({ recentQueries, activeSchedules }),
            },
          });
        } catch (err) {
          console.error('[app_home] Home refresh failed:', (err as Error).message);
        }
      }
    );
  }

  // ---- Action handlers — registered BEFORE app.start() ----

  // Export XLSX button clicked → trigger export in the thread
  slackApp.action<BlockAction<ButtonAction>>(
    'export_xlsx_action',
    async ({ ack, body, client }) => {
      await ack();

      const action = body.actions[0] as ButtonAction;
      let channelId: string | undefined;
      let threadTs: string | undefined;

      try {
        const parsed = JSON.parse(action.value ?? '{}');
        channelId = parsed.channelId;
        threadTs = parsed.threadTs;
      } catch {
        return;
      }
      if (!channelId || !threadTs) return;

      const userId = body.user.id;
      const userEmail = await getUserEmail(client, userId);

      await processAndRespond(client, channelId, threadTs, threadTs, userId, userEmail, 'export xlsx');
    }
  );

  // Report Issue button clicked → show issue modal
  slackApp.action<BlockAction<ButtonAction>>(
    'report_issue_action',
    async ({ ack, body, client }) => {
      await ack();

      const action = body.actions[0] as ButtonAction;
      let channelId: string | undefined;
      let threadTs: string | undefined;

      try {
        const parsed = JSON.parse(action.value ?? '{}');
        channelId = parsed.channelId;
        threadTs = parsed.threadTs;
      } catch {
        return;
      }
      if (!channelId || !threadTs) return;

      const threadId = `${channelId}:${threadTs}`;
      await postIssueButton(client, channelId, threadTs, threadId, '');
    }
  );

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
              block_id: 'deliver_at_time',
              label: { type: 'plain_text', text: 'Deliver At (Eastern Time)' },
              hint: { type: 'plain_text', text: 'Pick any time — converted to UTC internally' },
              element: {
                type: 'timepicker',
                action_id: 'value',
                initial_time: '09:00',
                placeholder: { type: 'plain_text', text: 'Pick a time' },
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
    const userId = body.user.id;

    // Timepicker returns "HH:MM" — treat as ET, convert to UTC (+4 EDT / +5 EST)
    const etTime = view.state.values.deliver_at_time.value.selected_time ?? '09:00';
    const [etHour, etMinute] = etTime.split(':').map(Number);
    // Use EDT offset (+4) — DST-aware conversion would require a library.
    // EDT: UTC = ET + 4. EST: UTC = ET + 5. Using 4 (EDT) since most of the year.
    const utcHour = (etHour + 4) % 24;
    // Store as minutes since midnight UTC for sub-hour precision
    const deliverAtHour = utcHour * 60 + (etMinute ?? 0);

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
                { type: 'mrkdwn', text: `*First Delivery*\n${nextRun.toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' })} ET` },
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

    if (!question || !reportName) {
      await dmUser(client, userId, {
        text: ':warning: Something went wrong saving your report. Please try again.',
      });
      return;
    }

    // If no frozen SQL was captured (BQ streaming buffer delay), use question text as fallback.
    // The schedule runner will detect this and re-run through processMessage instead of raw SQL.
    const effectiveSql = frozenSql || `QUESTION:${question}`;

    const userEmail = await getUserEmail(client, userId);

    try {
      const schedule = await createSchedule({
        userId,
        userEmail: userEmail.endsWith('@unknown') ? null : userEmail,
        reportName,
        questionText: question,
        frozenSql: effectiveSql,
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
              text: `:white_check_mark: *"${reportName}"* has been scheduled.\n\n*Cadence:* ${frequencyLabel}\n*Delivery:* ${deliveryLabel}\n*First delivery:* ${schedule.nextRunAt.toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' })} ET\n\nManage your reports in *App Home → Scheduled Reports*.`,
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
      } catch (err) {
        console.error('[slack] Cancel schedule failed:', (err as Error).message);
      }
    }
  );

  // ---- Action: Admin cancel schedule (from Admin App Home) ----
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
        const allSchedulesSnapshot = await getAllSchedules();
        const target = allSchedulesSnapshot.find(s => s.id === scheduleId);

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

  // Existing: "Report Issue" modal button → open modal form
  slackApp.action('open_issue_modal', async ({ ack, body, client }) => {
    await ack();

    const payload = body as any;
    const triggerId = payload.trigger_id;
    const metadata = JSON.parse(payload.actions[0].value);

    const modalBlocks: any[] = [];

    if (metadata.originalQuestion) {
      modalBlocks.push(
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Original question:*\n>${metadata.originalQuestion}`,
          },
        },
        { type: 'divider' }
      );
    }

    modalBlocks.push(
      {
        type: 'input',
        block_id: 'what_wrong',
        label: { type: 'plain_text', text: 'What looks wrong?' },
        element: {
          type: 'plain_text_input',
          action_id: 'what_wrong_input',
          multiline: true,
          ...(metadata.prefillText ? { initial_value: metadata.prefillText } : {}),
          placeholder: {
            type: 'plain_text',
            text: 'Describe what looks wrong with the data...',
          },
        },
      },
      {
        type: 'input',
        block_id: 'what_expected',
        optional: true,
        label: { type: 'plain_text', text: 'What did you expect?' },
        element: {
          type: 'plain_text_input',
          action_id: 'what_expected_input',
          multiline: true,
          placeholder: {
            type: 'plain_text',
            text: 'What should the data show, and where does that expectation come from?',
          },
        },
      },
      {
        type: 'input',
        block_id: 'priority',
        label: { type: 'plain_text', text: 'Priority' },
        element: {
          type: 'static_select',
          action_id: 'priority_select',
          options: [
            { text: { type: 'plain_text', text: 'Low \u2014 nice to fix' }, value: 'LOW' },
            { text: { type: 'plain_text', text: 'Medium \u2014 should fix soon' }, value: 'MEDIUM' },
            { text: { type: 'plain_text', text: 'High \u2014 blocking work' }, value: 'HIGH' },
          ],
          initial_option: {
            text: { type: 'plain_text', text: 'Medium \u2014 should fix soon' },
            value: 'MEDIUM',
          },
        },
      }
    );

    await client.views.open({
      trigger_id: triggerId,
      view: {
        type: 'modal',
        callback_id: 'issue_report_submit',
        title: { type: 'plain_text', text: 'Report Data Issue' },
        submit: { type: 'plain_text', text: 'Submit Issue' },
        close: { type: 'plain_text', text: 'Cancel' },
        private_metadata: JSON.stringify({
          channelId: metadata.channelId,
          threadTs: metadata.threadTs,
          threadId: metadata.threadId,
          originalQuestion: metadata.originalQuestion,
        }),
        blocks: modalBlocks,
      },
    });
  });

  // ---- View: Issue modal submitted → file the issue ----
  slackApp.view('issue_report_submit', async ({ ack, body, view, client }) => {
    await ack();

    const metadata = JSON.parse(view.private_metadata);
    const userId = body.user.id;
    const userEmail = await getUserEmail(client, userId);

    const whatWrong =
      view.state.values.what_wrong.what_wrong_input.value ?? '';
    const whatExpected =
      view.state.values.what_expected.what_expected_input.value ?? '';
    const priority = (view.state.values.priority.priority_select
      .selected_option?.value ?? 'MEDIUM') as IssuePriority;

    const threadLink = buildThreadLink(metadata.channelId, metadata.threadTs);

    const severityMap: Record<string, 'non-urgent' | 'needs-attention' | 'blocking'> = {
      LOW: 'non-urgent',
      MEDIUM: 'needs-attention',
      HIGH: 'blocking',
    };

    const issue: IssueReport = {
      reporterEmail: userEmail,
      reporterSlackId: userId,
      threadLink,
      originalQuestion: metadata.originalQuestion ?? '',
      sqlExecuted: [],
      schemaToolsCalled: [],
      whatLooksWrong: whatWrong,
      whatExpected: whatExpected,
      severity: severityMap[priority] ?? 'needs-attention',
      priority,
      timestamp: new Date().toISOString(),
    };

    try {
      await createDashboardRequest(issue, userEmail);
    } catch (err) {
      console.error('[slack] Issue creation failed:', (err as Error).message);
    }

    try {
      await postIssueToChannel(client, issue);
    } catch (err) {
      console.error('[slack] Issue channel post failed:', (err as Error).message);
    }

    // Confirm in the original thread — plain text intentional (confirmation is simple)
    try {
      await client.chat.postMessage({
        channel: metadata.channelId,
        thread_ts: metadata.threadTs,
        text: `:white_check_mark: Issue filed \u2014 *${priority}* priority. We'll look into it.`,
      });
    } catch (err) {
      console.error('[slack] Confirmation message failed:', (err as Error).message);
    }
  });

  // ---- Event: app_mention — bot is @mentioned in a channel ----
  // NOTE ON ACK: Bolt 4.x with processBeforeResponse: false (the default) sends
  // HTTP 200 to Slack BEFORE this handler runs. There is no ack() parameter on
  // event handlers — Bolt handles it automatically. This is the correct pattern
  // for Cloud Run where processing takes 30-300 seconds.
  slackApp.event('app_mention', async ({ event, client, body }) => {
    // Dedup — Slack retries events if it doesn't see the 200 fast enough.
    // Uses Upstash Redis (distributed) with in-memory fallback (single-instance).
    const eventId = (body as any).event_id;
    if (!eventId) console.warn('[dedup] No event_id on app_mention body');
    if (eventId && await isDuplicate(eventId)) return;

    if (!isAllowedChannel(event.channel)) return;

    const threadTs = (event as any).thread_ts ?? event.ts;
    const userId = event.user ?? 'unknown';

    // Per-user rate limit: 5 requests per 60 seconds
    if (await isRateLimited(userId)) {
      await client.chat.postMessage({
        channel: event.channel,
        thread_ts: threadTs,
        text: ':warning: You\'re sending requests too quickly. Please wait a moment before trying again.',
      }).catch(() => {});
      return;
    }

    const userEmail = await getUserEmail(client, userId);
    const text = event.text.replace(/<@[A-Z0-9]+>/g, '').trim();
    if (!text) return;

    // Issue reporting — show modal button
    if (isIssueTrigger(text)) {
      const threadId = `${event.channel}:${threadTs}`;
      const prefill = extractIssueText(text);
      await postIssueButton(client, event.channel, threadTs, threadId, prefill);
      return;
    }

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

      // Fire-and-forget — report generator handles its own error messages
      const userName = userEmail.split('@')[0] ?? userId;
      generateReport(client as any, userId, userEmail, userName, text, event.channel, threadTs).catch((err) => {
        console.error('[slack] Report generation error:', (err as Error).message);
      });
      return;
    }

    // Add thinking reaction
    try {
      await client.reactions.add({
        channel: event.channel,
        timestamp: event.ts,
        name: 'hourglass_flowing_sand',
      });
    } catch {
      // Non-critical
    }

    await processAndRespond(client, event.channel, threadTs, event.ts, userId, userEmail, text);
  });

  // ---- Event: message — user replies in an existing bot thread ----
  slackApp.message(async ({ message, client, body }) => {
    const msg = message as any;

    const eventId = (body as any).event_id;
    if (!eventId) console.warn('[dedup] No event_id on message body');
    if (eventId && await isDuplicate(eventId)) return;

    if (msg.subtype) return;
    if (msg.bot_id) return;
    if (!msg.thread_ts) return;

    if (!isAllowedChannel(msg.channel)) return;

    const threadId = `${msg.channel}:${msg.thread_ts}`;
    const existingThread = await loadThread(threadId);
    if (!existingThread) return;

    const userId = msg.user;

    // Per-user rate limit: 5 requests per 60 seconds
    if (await isRateLimited(userId)) {
      await client.chat.postMessage({
        channel: msg.channel,
        thread_ts: msg.thread_ts,
        text: ':warning: You\'re sending requests too quickly. Please wait a moment before trying again.',
      }).catch(() => {});
      return;
    }

    const userEmail = await getUserEmail(client, userId);
    const text = (msg.text ?? '').trim();
    if (!text) return;

    // Issue reporting — show modal button
    if (isIssueTrigger(text)) {
      const prefill = extractIssueText(text);
      await postIssueButton(client, msg.channel, msg.thread_ts, threadId, prefill);
      return;
    }

    // Report intent check — redirect to report generator
    if (isReportRequest(text)) {
      await client.chat.postMessage({
        channel: msg.channel,
        thread_ts: msg.thread_ts,
        text: ':page_facing_up: Working on your report — I\'ll DM you when it\'s ready. This usually takes 2-3 minutes.',
      });

      const userName = userEmail.split('@')[0] ?? userId;
      generateReport(client as any, userId, userEmail, userName, text, msg.channel, msg.thread_ts).catch((err) => {
        console.error('[slack] Report generation error:', (err as Error).message);
      });
      return;
    }

    await processAndRespond(client, msg.channel, msg.thread_ts, msg.ts, userId, userEmail, text);
  });

  // ---- Event: reaction_added — flag emoji triggers issue flow ----
  slackApp.event('reaction_added', async ({ event, client, body }) => {
    const eventId = (body as any).event_id;
    if (eventId && await isDuplicate(eventId)) return;

    if (event.reaction !== 'triangular_flag_on_post') return;
    if (!isAllowedChannel(event.item.channel)) return;
    if (event.item.type !== 'message') return;

    const channelId = event.item.channel;
    const messageTs = event.item.ts;
    const threadTs = messageTs;
    const threadId = `${channelId}:${threadTs}`;

    try {
      await postIssueButton(client, channelId, threadTs, threadId, '');
    } catch (err) {
      console.error('[slack] Failed to post issue button:', (err as Error).message);
    }
  });

  // ---- Cleanup endpoint (POST /internal/cleanup) ----
  if (receiver) {
    receiver.router.post('/internal/cleanup', async (req, res) => {
      const secret = req.headers['x-cleanup-secret'];
      if (!process.env.CLEANUP_SECRET || secret !== process.env.CLEANUP_SECRET) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      try {
        const { deleteExpiredThreads } = require('./thread-store');
        const count = await deleteExpiredThreads();
        console.log(`[cleanup] Deleted ${count} expired threads`);
        res.status(200).json({ deleted: count });
      } catch (err) {
        console.error('[cleanup] Error:', (err as Error).message);
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // ---- Cron endpoint (POST /internal/run-schedules) ----
    // Protected by CRON_SECRET header. Called by Cloud Scheduler every 15 minutes.
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

  // Start the app
  const port = parseInt(process.env.PORT ?? '3000', 10);
  await slackApp.start(port);
  console.log(`Savvy Analyst Bot running on port ${port}`);
}
