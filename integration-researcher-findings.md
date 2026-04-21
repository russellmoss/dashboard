# Integration Research Findings: Savvy Analyst Bot

## Summary

Six external integrations researched. Two spec conflicts found. Key issues:

1. **ExcelJS does not support embedded charts** — workaround: embed chart as PNG image via `addImage()`
2. **`horizontalBar` is not a valid Chart.js v4 type** — removed in v3. Use `"bar"` with `options.indexAxis: 'y'`
3. **`mcp_servers` is a beta API** requiring `client.beta.messages.create()` path (not `client.messages.create()`) and `betas: ['mcp-client-2025-04-04']` header
4. **chartjs-node-canvas v5 is CommonJS-only** — uses `require()` internally, bot must use `"type": "commonjs"` or CJS module system

---

## 1. Anthropic SDK / Claude API with Remote MCP Servers

**Status: has issues — MCP is a beta API**

**Correct initialization:**

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
```

**Calling with `mcp_servers` (beta API):**

Must use `client.beta.messages.create()`, NOT `client.messages.create()`. Requires beta string `'mcp-client-2025-04-04'` or newer `'mcp-client-2025-11-20'`.

```typescript
const response = await client.beta.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 8192,
  betas: ['mcp-client-2025-04-04'],
  system: SYSTEM_PROMPT,
  messages,
  mcp_servers: [{
    type: 'url',
    name: 'schema-context',
    url: process.env.MCP_SERVER_URL!,
    authorization_token: process.env.MCP_API_KEY,
  }],
});
```

**Parsing MCP tool use from responses:**

Response `content` array contains `BetaMCPToolUseBlock` (type `'mcp_tool_use'`) and `BetaMCPToolResultBlock` (type `'mcp_tool_result'`). With remote MCP, Claude handles tool execution server-side — you do NOT inject `mcp_tool_result` messages. Both blocks appear in the same assistant response.

```typescript
for (const block of response.content) {
  if (block.type === 'text') {
    const text = block.text; // Strip [CHART] blocks here
  } else if (block.type === 'mcp_tool_use') {
    // block.name, block.server_name, block.input, block.id
  } else if (block.type === 'mcp_tool_result') {
    // block.tool_use_id, block.content, block.is_error
  }
}
```

**Conversation history:** Store full `response.content` array as the assistant turn. Do not add synthetic tool_result messages.

```typescript
const messages = [
  { role: 'user', content: 'What is our Q1 SQO count?' },
  { role: 'assistant', content: response.content },
  { role: 'user', content: 'Break it down by channel.' },
];
```

**Gotchas:**
- `mcp_servers` only accepts `type: 'url'` — Cloud Run MCP server must use HTTP transport
- `authorization_token` is passed as-is to MCP server's Authorization header
- `stop_reason` is always `'end_turn'` with remote MCP (Claude handles tools internally)
- Rate limits: claude-sonnet-4-6 Tier 1: 2,000 req/min, 400K input tokens/min
- Use `BetaMessageParam` types (not `MessageParam`) for beta context

---

## 2. Slack Bolt for Node.js (v4.7.0)

**Status: compatible**

**HTTP mode initialization (for Cloud Run):**

```typescript
import { App } from '@slack/bolt';

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: false,
  processBeforeResponse: true, // CRITICAL for Cloud Run
});

await app.start(process.env.PORT || 3000);
```

**Event handlers:**
- `app.event('app_mention', ...)` — use `thread_ts ?? ts` for threading
- `app.message(...)` — filter for `message.thread_ts` to only handle thread replies
- `app.event('reaction_added', ...)` — emoji name for 🚩 is `triangular_flag_on_post`

**files.uploadV2:**

```typescript
await client.filesUploadV2({
  channel_id: channelId,
  thread_ts: threadTs,
  filename: 'chart.png',
  file: pngBuffer, // Buffer accepted directly
  title: chartSpec.title,
});
```

**users.info for email:** Requires `users:read.email` scope.

**Required bot token scopes:** `chat:write`, `files:write`, `reactions:read`, `users:read`, `users:read.email`, `channels:history`, `groups:history`, `app_mentions:read`

**Gotchas:**
- `processBeforeResponse: true` required for Cloud Run
- Bolt 4 uses Express 5 internally
- 🚩 emoji name: `triangular_flag_on_post` — verify during dev
- Rate limits: `chat.postMessage` 1/sec/channel, `files.uploadV2` 20/min, `users.info` 100/min

---

## 3. chartjs-node-canvas (v5.0.0) + chart.js (v4.5.1)

**Status: has issues — `horizontalBar` removed, CommonJS-only**

**CRITICAL: chartjs-node-canvas v5 is CommonJS-only.** Bot package must NOT use `"type": "module"`.

**Initialization:**

```typescript
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';

const chartRenderer = new ChartJSNodeCanvas({
  width: 800,
  height: 500,
  backgroundColour: 'white',
  chartCallback: (ChartJS) => {
    ChartJS.defaults.font.family = 'Arial, sans-serif';
    ChartJS.defaults.font.size = 12;
  },
});

const buffer = await chartRenderer.renderToBuffer(config);
```

**horizontalBar fix:** Use `type: 'bar'` with `options.indexAxis: 'y'`.

**stackedBar:** Use `type: 'bar'` with `scales.x.stacked: true, scales.y.stacked: true`.

**Gotchas:**
- Config object mutation bug — always pass fresh config objects
- Create one global `ChartJSNodeCanvas` instance, not one per request
- Chart.js v4: title/legend under `options.plugins`, not `options` directly
- `scales.x`/`scales.y` (not `scales.xAxes[]`/`scales.yAxes[]`)

**System deps (Dockerfile):** The spec's apt-get line is correct for `node:20-slim`.

---

## 4. ExcelJS (v4.4.0)

**Status: has issues — NO chart embedding API**

ExcelJS has NO `addChart()` method. The spec's "embedded chart" requirement cannot be met with native Excel charts.

**Workaround:** Embed chart PNG as an image:

```typescript
const imageId = workbook.addImage({ buffer: chartBuffer, extension: 'png' });
worksheet.addImage(imageId, {
  tl: { col: 0, row: worksheet.rowCount + 2 },
  ext: { width: 800, height: 500 },
});
```

**No auto-fit columns:** Must set `column.width` manually.

**Formula cells:** `cell.value = { formula: '=SUM(B2:B10)' }` — Excel computes on open.

**writeBuffer for Slack upload:** `const buffer = await workbook.xlsx.writeBuffer();`

---

## 5. pg (node-postgres) v8.20.0

**Status: compatible**

```typescript
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // includes ?sslmode=require
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});
```

**JSONB auto-parsing:** pg automatically parses JSONB columns to JS objects. No `JSON.parse()` needed.

**Parameterized queries:** `$1, $2, ...` positional placeholders.

---

## 6. @google-cloud/bigquery (v7.9.4)

**Status: compatible — JSON columns require JSON.stringify()**

```typescript
import { BigQuery } from '@google-cloud/bigquery';

const bq = new BigQuery({ projectId: process.env.BIGQUERY_PROJECT });
const table = bq.dataset(process.env.AUDIT_DATASET!).table(process.env.AUDIT_TABLE!);

await table.insert([{
  id: crypto.randomUUID(),
  tool_calls: JSON.stringify(toolCallsArray),    // MUST stringify for JSON columns
  sql_executed: JSON.stringify(sqlArray),
  issue_details: issueDetails ? JSON.stringify(issueDetails) : null,
  // ... other fields
}]);
```

**Gotchas:**
- JSON column type requires `JSON.stringify()` for streaming inserts
- `parseJSON: true` in query options for reading back JSON columns
- Streaming inserts have ~1 second eventual consistency
- Max row size: 1MB, max request: 10MB (no issue for audit log)

---

## Spec Conflicts

### Conflict 1: `horizontalBar` chart type
**Severity: Will break at runtime.** Removed in Chart.js v3. Fix: map to `type: 'bar'` + `indexAxis: 'y'`.

### Conflict 2: ExcelJS chart embedding
**Severity: Feature unavailable.** No `addChart()` API. Workaround: embed PNG image.

### Conflict 3: `mcp_servers` is beta API
**Severity: Will silently fail.** Must use `client.beta.messages.create()` not `client.messages.create()`.

---

## Risk Matrix

| Integration | Risk | Key Risk | Mitigation |
|---|---|---|---|
| Anthropic SDK (MCP) | Medium | Beta API, conversation history format | Use `client.beta.messages.create()`, store full content array |
| Slack Bolt v4 | Low | `processBeforeResponse` for Cloud Run | Set `processBeforeResponse: true` |
| chartjs-node-canvas | Medium | CJS-only, `horizontalBar` removed | Use CJS module system, map chart types |
| ExcelJS | High | No chart embedding | Embed PNG via `addImage()` |
| pg | Low | SSL, JSONB auto-parsing | Use `?sslmode=require` in URL |
| BigQuery | Medium | JSON.stringify for JSON columns | Always stringify before insert |
