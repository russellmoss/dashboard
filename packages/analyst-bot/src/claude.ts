// packages/analyst-bot/src/claude.ts
// ============================================================================
// Claude API client with remote MCP server configuration
// ============================================================================

import Anthropic from '@anthropic-ai/sdk';
import { ConversationMessage, ClaudeResponse, ToolCallRecord } from './types';
import { getSystemPrompt } from './system-prompt';

const CLAUDE_MAX_RETRIES = 3;
const CLAUDE_RETRY_BASE_MS = 1000;
const MAX_MESSAGES = 40; // 20 exchanges (user + assistant) for token budget

function verbose(...args: any[]): void {
  if (process.env.VERBOSE === 'true') console.error(...args);
}

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not set');
    }
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
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
    try {
      const response = await anthropic.beta.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: maxTokens,
        betas: ['mcp-client-2025-04-04'],
        system: systemPrompt,
        messages: messageParams,
        mcp_servers: mcpServers,
      });

      return parseClaudeResponse(response);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const status = (error as any)?.status;
      const isRetryable = status === 429 || status === 529;

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
      // Track SQL from execute_sql calls
      if (block.name === 'execute_sql' && block.input?.sql) {
        sqlExecuted.push(block.input.sql);
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
      // Extract bytes scanned from execute_sql results
      if (typeof block.content === 'string') {
        const bytesMatch = block.content.match(/"bytes_scanned"\s*:\s*(\d+)/);
        if (bytesMatch) {
          bytesScanned += parseInt(bytesMatch[1], 10);
        }
      }
    }
  }

  verbose(`✅ Got response from Claude (${response.content.length} content blocks)`);

  return {
    text,
    contentBlocks: response.content,
    toolCalls,
    sqlExecuted,
    bytesScanned,
    error: null,
  };
}
