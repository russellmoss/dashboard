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
import { loadThread } from './thread-store';
import { createDashboardRequest } from './dashboard-request';
import { IssueReport, IssuePriority } from './types';

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

  const result = text.replace(/```\n([\s\S]*?\n)```/g, (match, content: string) => {
    const lines = content.trim().split('\n');
    if (lines.length < minLines) return match;

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
 * Build Block Kit blocks for an analyst bot response.
 * Uses MarkdownBlock (type: 'markdown') for the main body — it accepts real
 * markdown (headings, bold, pipe tables) and Slack renders it natively.
 * This eliminates the need for toSlackMrkdwn() conversion.
 *
 * Follow-up suggestions stay as plain text in the body (too long for button labels).
 * Footer has two action buttons: Export XLSX + Report Issue.
 */
function buildResponseBlocks(
  bodyText: string,
  channelId: string,
  threadTs: string,
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
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: ':bar_chart: Export XLSX', emoji: true },
        action_id: 'export_xlsx_action',
        value: JSON.stringify({ threadTs, channelId }),
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: ':triangular_flag_on_post: Report Issue', emoji: true },
        action_id: 'report_issue_action',
        value: JSON.stringify({ threadTs, channelId }),
      },
    ],
  } as KnownBlock);

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
): Promise<void> {
  // Clear progress timers before final update
  for (const t of progressTimers) clearTimeout(t);

  // Strip the plain-text footer (replaced by interactive buttons) and extract table snippets
  const bodyText = stripFooter(result.text);
  const { text: cleanText, snippets } = extractTableSnippets(bodyText);

  // Build Block Kit blocks — follow-up suggestion stays as inline text
  const blocks = buildResponseBlocks(cleanText, channelId, threadTs);

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
    await handleResponse(client, channelId, threadTs, eventTs, userId, result, workingTs, progressTimers);
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
  }

  // Start the app
  const port = parseInt(process.env.PORT ?? '3000', 10);
  await slackApp.start(port);
  console.log(`Savvy Analyst Bot running on port ${port}`);
}
