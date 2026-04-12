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

    const postResult = await client.chat.postMessage({
      channel: channelId,
      text: opts.text,
      ...(opts.blocks ? { blocks: opts.blocks } : {}),
    });
    console.log(`[dm-helper] DM sent to ${userId} in channel ${channelId}, ok=${postResult.ok}`);
  } catch (err) {
    console.error(`[dm-helper] Failed to DM user ${userId}:`, (err as Error).message);
  }
}
