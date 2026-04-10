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
import { processMessage } from './conversation';
import { postIssueToChannel } from './issues';

// In-memory cache for user email lookups
const userEmailCache = new Map<string, string>();

// Event deduplication — prevents double-processing on Slack retries
const processedEvents = new Set<string>();
const DEDUP_TTL_MS = 60_000; // Keep event IDs for 60 seconds

function isDuplicate(eventId: string): boolean {
  if (processedEvents.has(eventId)) return true;
  processedEvents.add(eventId);
  setTimeout(() => processedEvents.delete(eventId), DEDUP_TTL_MS);
  return false;
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

/**
 * Convert markdown to Slack mrkdwn format.
 * Slack uses *bold* not **bold**, doesn't support # headings,
 * and doesn't render pipe tables — those need to be in code blocks.
 */
function toSlackMrkdwn(text: string): string {
  // Protect existing code blocks from transformation — replace with placeholders
  const codeBlocks: string[] = [];
  text = text.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match);
    return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
  });

  // Wrap bare markdown tables (not already in code blocks) in triple backticks
  text = text.replace(
    /((?:^[^\n]*\|[^\n]*\n)+)/gm,
    (match) => {
      if (/\|[-:| ]+\|/.test(match)) {
        return '```\n' + match.trim() + '\n```\n';
      }
      return match;
    }
  );

  text = text
    // **bold** → *bold*
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    // ### heading → *heading*
    .replace(/^#{1,3}\s+(.+)$/gm, '*$1*')
    // [text](url) → <url|text>
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>')
    // --- horizontal rule → ———
    .replace(/^---$/gm, '———')
  ;

  // Restore code blocks
  text = text.replace(/__CODE_BLOCK_(\d+)__/g, (_, idx) => codeBlocks[parseInt(idx)]);

  return text;
}

/**
 * Handle a bot response — post text, upload chart/xlsx, post issues.
 * Extracted to avoid duplication between app_mention and message handlers.
 */
async function handleResponse(
  client: any,
  channelId: string,
  threadTs: string,
  eventTs: string,
  userId: string,
  result: Awaited<ReturnType<typeof processMessage>>
): Promise<void> {
  // Post text response — convert markdown to Slack mrkdwn
  const slackText = toSlackMrkdwn(result.text);
  await client.chat.postMessage({
    channel: channelId,
    thread_ts: threadTs,
    text: slackText,
  });

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
        title: result.xlsxFilename,
      });
    } catch (err) {
      console.error('[slack] XLSX upload failed:', (err as Error).message);
    }
  }

  // Post issue to #data-issues if this is an issue report
  if (result.isIssueReport && result.issueDetails) {
    result.issueDetails.threadLink = buildThreadLink(channelId, threadTs);
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

  // ---- app_mention: bot is @mentioned in a channel ----
  slackApp.event('app_mention', async ({ event, client, body }) => {
    // Deduplicate Slack retries
    const eventId = (body as any).event_id;
    if (eventId && isDuplicate(eventId)) return;

    if (!isAllowedChannel(event.channel)) return;

    const threadTs = (event as any).thread_ts ?? event.ts;
    const threadId = `${event.channel}:${threadTs}`;
    const userId = event.user ?? 'unknown';
    const userEmail = await getUserEmail(client, userId);

    // Strip the bot mention from the text
    const text = event.text.replace(/<@[A-Z0-9]+>/g, '').trim();
    if (!text) return;

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

    try {
      const result = await processMessage(text, threadId, event.channel, userEmail);
      await handleResponse(client, event.channel, threadTs, event.ts, userId, result);
    } catch (err) {
      console.error('[slack] app_mention handler error:', (err as Error).message);
      await client.chat.postMessage({
        channel: event.channel,
        thread_ts: threadTs,
        text: `Sorry, I ran into a technical issue: ${(err as Error).message}`,
      }).catch(() => {});
    }
  });

  // ---- message: user replies in an existing bot thread ----
  // Only responds in threads the bot started (thread exists in bot_threads table).
  // Ignores all other threads — the bot doesn't jump into random conversations.
  slackApp.message(async ({ message, client, body }) => {
    const msg = message as any;

    // Deduplicate Slack retries
    const eventId = (body as any).event_id;
    if (eventId && isDuplicate(eventId)) return;

    // Only handle normal user messages in threads — filter out subtypes
    if (msg.subtype) return;
    if (msg.bot_id) return;
    if (!msg.thread_ts) return; // Only thread replies, not top-level messages

    // Check allowlist
    if (!isAllowedChannel(msg.channel)) return;

    // Only respond in threads the bot started — check if thread exists in bot_threads
    const threadId = `${msg.channel}:${msg.thread_ts}`;
    const { loadThread } = require('./thread-store');
    const existingThread = await loadThread(threadId);
    if (!existingThread) return; // Not a bot thread — ignore

    const userId = msg.user;
    const userEmail = await getUserEmail(client, userId);
    const text = (msg.text ?? '').trim();
    if (!text) return;

    try {
      const result = await processMessage(text, threadId, msg.channel, userEmail);
      await handleResponse(client, msg.channel, msg.thread_ts, msg.ts, userId, result);
    } catch (err) {
      console.error('[slack] message handler error:', (err as Error).message);
      await client.chat.postMessage({
        channel: msg.channel,
        thread_ts: msg.thread_ts,
        text: `Sorry, I ran into a technical issue: ${(err as Error).message}`,
      }).catch(() => {});
    }
  });

  // ---- reaction_added: flag emoji triggers issue flow ----
  slackApp.event('reaction_added', async ({ event, client, body }) => {
    const eventId = (body as any).event_id;
    if (eventId && isDuplicate(eventId)) return;

    if (event.reaction !== 'triangular_flag_on_post') return;
    if (!isAllowedChannel(event.item.channel)) return;
    if (event.item.type !== 'message') return;

    const channelId = event.item.channel;
    const messageTs = event.item.ts;
    const userId = event.user;
    const userEmail = await getUserEmail(client, userId);

    // Fetch the message that was reacted to for context
    try {
      await client.conversations.history({
        channel: channelId,
        latest: messageTs,
        inclusive: true,
        limit: 1,
      });
    } catch (err) {
      console.error('[slack] Failed to fetch reacted message:', (err as Error).message);
      return;
    }

    const threadTs = messageTs;
    const threadId = `${channelId}:${threadTs}`;

    try {
      const result = await processMessage('report issue', threadId, channelId, userEmail);
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: result.text,
      });
    } catch (err) {
      console.error('[slack] Failed to post issue prompt:', (err as Error).message);
    }
  });

  // ---- Cleanup endpoint (POST /internal/cleanup) ----
  // For Cloud Scheduler to call daily. Authenticated via CLEANUP_SECRET header.
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
