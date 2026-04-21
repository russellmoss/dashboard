# Block Kit Refactor Integration Research — Savvy Analyst Bot

**SDK versions verified (installed):**
- `@slack/bolt`: **4.7.0** (package.json specifies `^4.1.0`)
- `@slack/web-api`: **7.15.0** (transitive)
- `@slack/types`: **2.20.1** (transitive)

---

## 1. Block Kit `blocks` Array

### Character limits

| Block | Field | Limit |
|---|---|---|
| `header` | `text` (plain_text only) | 150 chars |
| `section` | `text` | 3000 chars |
| `section` | each `fields[]` item | 2000 chars |
| `context` | each element text | 2000 chars |
| `actions` | button `text` (plain_text) | ~75 chars |
| `markdown` | `text` | 12,000 chars |

### Working snippet

```typescript
import { type KnownBlock } from '@slack/bolt';

function buildAnalystResponseBlocks(opts: {
  headerText: string;
  tableContent: string;
  assumptions: string;
  followUpQuestion: string;
  followUpValue: string;
}): KnownBlock[] {
  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: opts.headerText.substring(0, 150), emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: '```\n' + opts.tableContent + '\n```' },
    },
    { type: 'divider' },
    {
      type: 'actions',
      elements: [{
        type: 'button',
        text: { type: 'plain_text', text: opts.followUpQuestion.substring(0, 75), emoji: false },
        action_id: 'analyst_followup',
        value: opts.followUpValue,
      }],
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: ':information_source: ' + opts.assumptions.substring(0, 2000) }],
    },
  ];
}

async function postBlockKitResponse(client: any, channelId: string, threadTs: string, opts: any) {
  await client.chat.postMessage({
    channel: channelId,
    thread_ts: threadTs,
    text: opts.headerText, // fallback for push notifications
    blocks: buildAnalystResponseBlocks(opts),
  });
}
```

### Gotchas
- **`header` only accepts `plain_text`**, not `mrkdwn` — passing mrkdwn causes API error
- **`section` text limit is 3000 chars** — Slack silently truncates (no error thrown)
- **`MarkdownBlock` (`type: 'markdown'`)** is a genuine `KnownBlock` in `@slack/types` 2.20.1 — accepts real markdown (bold with `**`, `#` headings, pipe tables). Could eliminate `toSlackMrkdwn()` entirely for the block body
- **`blocks` array is fully replaced on `chat.update`** — no diff/patch mechanism

---

## 2. `chat.update`

### Verified: full blocks replacement supported

```typescript
await client.chat.update({
  channel: channelId,
  ts: workingMessageTs,   // timestamp of message to update
  text: fallbackText,     // fallback for notifications
  blocks: finalBlocks,    // completely replaces existing blocks
});
```

### Rate limits
**Tier 3: 50 requests per minute per workspace.** SDK has auto-retry with exponential backoff for 429s built in.

### Working snippet — post-then-update pattern

```typescript
async function postThenUpdateWithBlocks(
  client: any, channelId: string, threadTs: string, workingText: string,
  buildFinalBlocks: () => Promise<{ blocks: KnownBlock[]; fallbackText: string }>,
) {
  // Post working message — capture ts
  let workingTs: string | undefined;
  try {
    const initial = await client.chat.postMessage({
      channel: channelId, thread_ts: threadTs, text: workingText,
    });
    workingTs = initial.ts;
  } catch { /* non-fatal */ }

  const { blocks, fallbackText } = await buildFinalBlocks();

  // Update in-place (smooth UX — no flicker)
  if (workingTs) {
    try {
      await client.chat.update({ channel: channelId, ts: workingTs, text: fallbackText, blocks });
      return;
    } catch { /* fall through to postMessage */ }
  }

  await client.chat.postMessage({ channel: channelId, thread_ts: threadTs, text: fallbackText, blocks });
}
```

### Gotchas
- **Cannot change `thread_ts`** — can't move message between thread/top-level
- **Bot can only update its own messages**
- **`blocks: []` renders blank message** — always guard non-empty
- **Replaces `postWorkingMessage` + `deleteWorkingMessage` pattern** — smoother UX

---

## 3. Slack Bolt Action Handlers

### Registration pattern

```typescript
slackApp.action<BlockAction<ButtonAction>>('analyst_followup', async ({ ack, body, client }) => {
  await ack(); // MUST be within 3 seconds

  const action = body.actions[0] as ButtonAction;
  const channelId = body.channel?.id;
  const threadTs = (body.message as any)?.thread_ts ?? body.message?.ts;

  const followUpQuestion = action.value ?? action.text.text;

  // Post follow-up as message in thread, then process it
  await client.chat.postMessage({
    channel: channelId!, thread_ts: threadTs!, text: followUpQuestion,
  });

  const threadId = `${channelId}:${threadTs}`;
  const workingTs = await postWorkingMessage(client, channelId!, threadTs!);
  const result = await processMessage(followUpQuestion, threadId, channelId!, '');
  await deleteWorkingMessage(client, channelId!, workingTs);
  await handleResponse(client, channelId!, threadTs!, body.message!.ts!, body.user.id, result);
});
```

### Gotchas
- **CRITICAL: `say()` does NOT auto-thread in action handlers.** Confirmed in Bolt source: `say()` is constructed with only `channelId`, no `thread_ts`. Always use `client.chat.postMessage` with explicit `thread_ts`.
- **`body.channel` can be undefined** in modal-originated actions — guard with `if (!channelId)`
- **`body.actions` is always an array** — access `body.actions[0]`
- **`thread_ts` not typed on `body.message`** — access as `(body.message as any)?.thread_ts`. Safest: bake `threadTs` into button `value` JSON (existing pattern in `open_issue_modal`)
- **`ack()` timeout is 3 seconds** — if not called, Slack shows "This app is not responding" and retries

---

## 4. `files.uploadV2` + Block Kit Coexistence

### Verdict: always separate calls

Block Kit `chat.postMessage` and `files.uploadV2` are always two distinct Slack messages. There is no way to embed a file inside a Block Kit message.

```typescript
// Call 1: Block Kit response
await client.chat.postMessage({ channel: channelId, thread_ts: threadTs, text: fallback, blocks });

// Call 2: Chart — appears as separate message below
await client.filesUploadV2({
  channel_id: channelId, thread_ts: threadTs, file: chartBuffer,
  filename: `chart_${chartType}.png`, title: `${chartType} Chart`,
});
```

### Gotchas
- **Two separate messages** — chart appears below the Block Kit analysis. Unavoidable.
- **Use `channel_id` not `channels`** (deprecated)
- **`initial_comment` and `blocks` are mutually exclusive** on `filesUploadV2`
- **Multiple files in one message**: Use `file_uploads: [...]` array to combine chart + XLSX into one upload message

---

## 5. Socket Mode vs HTTP Mode Payload Shape

### Verdict: identical payload shape

No difference between Socket Mode and HTTP mode. Both deliver the same `BlockAction` JSON body. Bolt abstracts the transport — handlers receive identical `{ ack, body, client, action }`.

### Button click payload shape

```typescript
{
  type: 'block_actions',
  user: { id: string, username: string },
  channel: { id: string, name: string },  // undefined in modals
  message: {
    ts: string,          // message containing the button
    thread_ts?: string,  // present at runtime but NOT typed
  },
  actions: [{
    type: 'button',
    action_id: string,
    block_id: string,
    value?: string,      // your custom payload
    text: { type: 'plain_text', text: string },
  }],
}
```

---

## Key Decisions for Refactor

1. **Use `chat.update` instead of delete+post** — post working message, capture `ts`, update in-place with final Block Kit response. Smoother UX.

2. **Consider `MarkdownBlock`** (`type: 'markdown'`) for main response body — accepts real markdown, 12K char limit, eliminates `toSlackMrkdwn()`. Test in sandbox first.

3. **Bake `threadTs` into button `value` JSON** — safest approach for action handlers (existing pattern in `open_issue_modal`).

4. **Follow-up buttons use `client.chat.postMessage`** — never `say()`, which doesn't auto-thread.

5. **Chart/XLSX always separate messages** — post Block Kit first, then upload files.

## Risk Matrix

| Risk | Level | Mitigation |
|---|---|---|
| `say()` doesn't auto-thread | HIGH | Always use `client.chat.postMessage` with `thread_ts` |
| `header` rejects mrkdwn | MEDIUM | Use `plain_text` only, strip markdown |
| `chat.update` rate limit (50/min) | LOW | One update per conversation |
| `thread_ts` not typed | MEDIUM | Bake into button `value` JSON |
| File + blocks are separate messages | LOW | Accepted behavior |
| `section.text` > 3000 chars | LOW | Apply `splitSlackMessage` logic before block building |
| `MarkdownBlock` availability | LOW | Verified in `@slack/types` 2.20.1 |
