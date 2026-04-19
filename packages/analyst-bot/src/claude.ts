// packages/analyst-bot/src/claude.ts
// ============================================================================
// Claude API client with remote MCP server configuration
// ============================================================================

import Anthropic from '@anthropic-ai/sdk';
import { ConversationMessage, ClaudeResponse, ToolCallRecord } from './types';
import { getSystemPrompt } from './system-prompt';

const CLAUDE_MAX_RETRIES = 3;
const CLAUDE_RETRY_BASE_MS = 1000;
const CLAUDE_TIMEOUT_MS = 300_000; // 5 minutes — MCP beta multi-tool calls take longer than standard API calls
const MAX_MESSAGES = 40; // 20 exchanges (user + assistant) for token budget

function verbose(...args: any[]): void {
  if (process.env.VERBOSE === 'true') console.log(...args);
}

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not set');
    }
    client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      timeout: CLAUDE_TIMEOUT_MS, // SDK-level HTTP timeout
    });
  }
  return client;
}

/**
 * Call Claude with remote MCP server attached.
 * Uses the beta API path for mcp_servers support.
 * Includes retry with exponential backoff for 429/529.
 */
export async function callClaude(
  messages: ConversationMessage[],
  opts?: { maxTokens?: number }
): Promise<ClaudeResponse> {
  const anthropic = getClient();
  const systemPrompt = getSystemPrompt();
  const maxTokens = opts?.maxTokens ?? 8192;

  if (!process.env.MCP_SERVER_URL) {
    throw new Error('MCP_SERVER_URL is not set');
  }

  // Truncate to most recent messages to manage token budget
  const truncated = messages.slice(-MAX_MESSAGES);

  // Build message params for the beta API
  const messageParams = truncated.map((msg) => ({
    role: msg.role as 'user' | 'assistant',
    content: msg.content,
  }));

  const mcpServers = [
    {
      type: 'url' as const,
      url: process.env.MCP_SERVER_URL,
      name: 'schema-context',
      authorization_token: process.env.MCP_API_KEY,
    },
  ];

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < CLAUDE_MAX_RETRIES; attempt++) {
    // AbortController as a hard safety net — the SDK timeout may not fire
    // during MCP beta tool execution (server keeps the connection open).
    const abortController = new AbortController();
    const abortTimer = setTimeout(() => abortController.abort(), CLAUDE_TIMEOUT_MS);

    try {
      const response = await anthropic.beta.messages.create(
        {
          model: 'claude-sonnet-4-6',
          max_tokens: maxTokens,
          betas: ['mcp-client-2025-04-04'],
          system: systemPrompt,
          messages: messageParams,
          mcp_servers: mcpServers,
        },
        { timeout: CLAUDE_TIMEOUT_MS, signal: abortController.signal as any }
      );

      clearTimeout(abortTimer);
      return parseClaudeResponse(response);
    } catch (error) {
      clearTimeout(abortTimer);
      // Detect timeout (SDK throws APIConnectionTimeoutError, or AbortController fires)
      const errMsg = (error as any)?.message ?? '';
      const errName = (error as any)?.name ?? '';
      if (errName === 'APIConnectionTimeoutError' || errName === 'AbortError' || errMsg.includes('timeout') || errMsg.includes('timed out') || errMsg.includes('abort')) {
        const msg = `Claude API timed out after ${CLAUDE_TIMEOUT_MS / 1000}s — the query may be too complex for a single request. Try breaking it into smaller questions.`;
        console.error('[claude]', msg);
        throw new Error(msg);
      }
      lastError = error instanceof Error ? error : new Error(String(error));
      const status = (error as any)?.status;
      const isRetryable = status === 429 || status === 529 || status === 400;

      if (isRetryable && attempt < CLAUDE_MAX_RETRIES - 1) {
        const delayMs = CLAUDE_RETRY_BASE_MS * Math.pow(2, attempt);
        console.warn(
          `[claude] API ${status}, retrying in ${delayMs}ms (attempt ${attempt + 1}/${CLAUDE_MAX_RETRIES})`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }

      if (isRetryable) {
        throw new Error('Claude API is temporarily overloaded. Please try again in a moment.');
      }
      throw error;
    }
  }

  throw lastError || new Error('Claude API call failed');
}

/**
 * Minimal Claude call for utility tasks (section planning, short classifications).
 * No system prompt, no MCP tools — just a text-in / text-out completion.
 *
 * Required because the analyst system prompt instructs Claude to call schema-context,
 * run SQL, and wrap data in [CHART] blocks. Passing a simple "return a JSON array"
 * prompt through callClaude() causes Claude to run the full analytical pipeline and
 * emit [CHART] output instead of the expected JSON.
 */
export async function callClaudePlain(
  prompt: string,
  opts?: { maxTokens?: number; model?: string }
): Promise<string> {
  const anthropic = getClient();
  const maxTokens = opts?.maxTokens ?? 2048;
  const model = opts?.model ?? 'claude-sonnet-4-6';

  const abortController = new AbortController();
  const abortTimer = setTimeout(() => abortController.abort(), CLAUDE_TIMEOUT_MS);

  try {
    const response = await anthropic.messages.create(
      {
        model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      },
      { timeout: CLAUDE_TIMEOUT_MS, signal: abortController.signal as any }
    );
    clearTimeout(abortTimer);

    const text = response.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('');
    return text;
  } catch (error) {
    clearTimeout(abortTimer);
    throw error;
  }
}

/**
 * Parse the beta API response into our ClaudeResponse type.
 * Extracts text, tool calls, SQL executed, and bytes scanned from content blocks.
 */
function parseClaudeResponse(response: any): ClaudeResponse {
  const toolCalls: ToolCallRecord[] = [];
  const sqlExecuted: string[] = [];
  let bytesScanned = 0;

  // Find the index of the last mcp_tool_result block.
  // Text blocks before it are narration ("Let me check the schema...").
  // Text blocks after it are the actual answer.
  let lastToolResultIdx = -1;
  for (let i = response.content.length - 1; i >= 0; i--) {
    if (response.content[i].type === 'mcp_tool_result') {
      lastToolResultIdx = i;
      break;
    }
  }

  let text = '';
  for (let i = 0; i < response.content.length; i++) {
    const block = response.content[i];
    if (block.type === 'text') {
      // Only include text blocks after the last tool result (the actual answer).
      // If there were no tool calls at all, include everything.
      if (lastToolResultIdx === -1 || i > lastToolResultIdx) {
        text += block.text;
      }
    } else if (block.type === 'mcp_tool_use') {
      const params = JSON.stringify(block.input ?? {}).substring(0, 200);
      verbose(`📊 Claude called ${block.name} with ${params}`);
      toolCalls.push({
        toolName: block.name,
        serverName: block.server_name ?? 'schema-context',
        input: block.input ?? {},
        isError: false,
      });
      // Track SQL from execute_sql calls — MCP tool param is "query", not "sql"
      if (block.name === 'execute_sql' && block.input?.query) {
        sqlExecuted.push(block.input.query);
      }
    } else if (block.type === 'mcp_tool_result') {
      // Check for errors in tool results
      if (block.is_error) {
        const matchingCall = toolCalls.find(
          (tc) => !tc.isError && tc.toolName
        );
        if (matchingCall) {
          matchingCall.isError = true;
        }
      }
      // Extract bytes scanned from execute_sql results — MCP returns "bytesProcessed".
      // block.content can be a string OR an array of content blocks [{type:'text', text:'...'}].
      let resultText = '';
      if (typeof block.content === 'string') {
        resultText = block.content;
      } else if (Array.isArray(block.content)) {
        resultText = block.content
          .filter((c: any) => c.type === 'text' && c.text)
          .map((c: any) => c.text)
          .join('');
      }
      if (resultText) {
        const bytesMatch = resultText.match(/"(?:bytesProcessed|bytes_scanned)"\s*:\s*(\d+)/);
        if (bytesMatch) {
          bytesScanned += parseInt(bytesMatch[1], 10);
        }
      }
    }
  }

  verbose(`✅ Got response from Claude (${response.content.length} content blocks)`);

  // Strip leading narration — Claude sometimes starts with "Let me..." or
  // "I have all the data..." even when there are no tool calls to filter on.
  // Find the first line that looks like actual content (starts with a result
  // marker, emoji, table, or data).
  const cleaned = stripLeadingNarration(text);

  return {
    text: cleaned,
    contentBlocks: response.content,
    toolCalls,
    sqlExecuted,
    bytesScanned,
    error: null,
  };
}

/**
 * Strip leading narration lines before the actual results.
 * Looks for the first line that starts with a result marker and drops everything before it.
 */
function stripLeadingNarration(text: string): string {
  // Common result markers that indicate the actual answer starts
  const resultMarkers = /^(\*?Results\*?|📊|:chart|```|\|[\s-|]+\|)/m;
  const match = text.match(resultMarkers);
  if (match && match.index && match.index > 0) {
    // Only strip if the narration before it is < 500 chars (safety check)
    const before = text.substring(0, match.index).trim();
    if (before.length > 0 && before.length < 2000) {
      verbose('[narration-strip] Removed', before.length, 'chars of leading narration');
      return text.substring(match.index);
    }
  }
  return text;
}
