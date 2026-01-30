// src/app/api/agent/query/route.ts
// =============================================================================
// AGENT QUERY API ROUTE
// Natural language → Template → SQL → Results
// =============================================================================

// EXACT IMPORT PATTERN (from funnel-metrics/route.ts):
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { runQuery } from '@/lib/bigquery';
import Anthropic from '@anthropic-ai/sdk';
import { getSessionPermissions } from '@/types/auth';
import { forbidRecruiter } from '@/lib/api-authz';

export const dynamic = 'force-dynamic';

// EXACT AUTHENTICATION PATTERN:
// const session = await getServerSession(authOptions);
// if (!session) {
//   return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
// }

// EXACT ERROR RESPONSE FORMATS:
// 401: NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
// 500: NextResponse.json({ error: 'Internal server error' }, { status: 500 })
// 400: NextResponse.json({ error: 'Error message' }, { status: 400 })

// EXACT LOGGER USAGE:
// logger.debug(message, context) - for development debugging
// logger.info(message, context) - for informational logs
// logger.warn(message, error) - for warnings
// logger.error(message, error, context) - for errors

// EXACT runQuery SIGNATURE:
// runQuery<T>(query: string, params?: Record<string, any>): Promise<T[]>
// Usage: const rows = await runQuery<Record<string, unknown>>(sql, params);

import { generateAgentSystemPrompt } from '@/lib/semantic-layer/agent-prompt';
import { compileQuery, validateTemplateSelection, determineVisualization } from '@/lib/semantic-layer/query-compiler';

import type { 
  AgentRequest, 
  AgentResponse, 
  TemplateSelection,
  StreamChunk,
  CompiledQuery
} from '@/types/agent';

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// =============================================================================
// STREAMING RESPONSE HELPER
// =============================================================================

function createStreamResponse(stream: ReadableStream): Response {
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

function formatSSE(chunk: StreamChunk): string {
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

// Timeout constants
const CLAUDE_TIMEOUT_MS = 30000; // 30 seconds
const BIGQUERY_TIMEOUT_MS = 30000; // 30 seconds
const MAX_QUESTION_LENGTH = 500;

// Timeout wrapper utility
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string
): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(errorMessage));
    }, timeoutMs);
  });
  
  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (e) {
    clearTimeout(timeoutId!);
    throw e;
  }
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    // 1. Authentication
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Use permissions from session (derived from JWT, no DB query)
    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }

    // Block recruiters from Explore/agent queries
    const forbidden = forbidRecruiter(permissions);
    if (forbidden) return forbidden;

    // 2. Parse request
    const body: AgentRequest = await request.json();
    const { question, conversationHistory, userContext } = body;

    // Request validation
    if (!question || typeof question !== 'string') {
      return NextResponse.json(
        { 
          success: false,
          error: {
            code: 'QUESTION_REQUIRED',
            message: 'Question is required',
          }
        },
        { status: 400 }
      );
    }

    if (question.length > MAX_QUESTION_LENGTH) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'QUESTION_TOO_LONG',
            message: `Question must be under ${MAX_QUESTION_LENGTH} characters`,
          }
        },
        { status: 400 }
      );
    }

    if (question.trim().length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'QUESTION_EMPTY',
            message: 'Question cannot be empty',
          }
        },
        { status: 400 }
      );
    }

    logger.info('Agent query received', { 
      question: question.substring(0, 100),
      user: session.user.email 
    });

    // 3. Check if streaming is requested
    const acceptHeader = request.headers.get('accept') || '';
    const wantsStream = acceptHeader.includes('text/event-stream');

    if (wantsStream) {
      return handleStreamingRequest(question, conversationHistory);
    } else {
      return handleNonStreamingRequest(question, conversationHistory, startTime);
    }

  } catch (error) {
    logger.error('Agent query error', error);
    return NextResponse.json(
      { 
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'An unexpected error occurred',
        }
      },
      { status: 500 }
    );
  }
}

// =============================================================================
// NON-STREAMING HANDLER
// =============================================================================

async function handleNonStreamingRequest(
  question: string,
  conversationHistory: any[] | undefined,
  startTime: number
): Promise<Response> {
  try {
    // Call Claude to get template selection (with timeout)
    const templateSelection = await withTimeout(
      callClaude(question, conversationHistory),
      CLAUDE_TIMEOUT_MS,
      'AI response timed out. Please try a simpler question or rephrase.'
    );

    // Check for unsupported questions
    if (templateSelection.templateId === 'unsupported') {
      return NextResponse.json({
        success: false,
        error: {
          code: 'UNSUPPORTED_QUESTION',
          message: templateSelection.explanation,
          suggestion: 'Try rephrasing your question or ask about metrics, conversions, or trends.',
        },
        visualization: 'metric',
      } as AgentResponse);
    }

    // Validate template selection
    const validation = validateTemplateSelection(templateSelection);
    if (!validation.valid) {
      return NextResponse.json({
        success: false,
        error: {
          code: 'INVALID_TEMPLATE',
          message: `Template validation failed: ${validation.errors.join(', ')}`,
        },
        visualization: 'metric',
        visualizationOverridden: false,
      } as AgentResponse);
    }

    // Compile query
    // Note: No RBAC filters applied - all users can see all data in Explore
    const compiledQuery = compileQuery(templateSelection);

    // Execute query (with timeout)
    const rows = await withTimeout(
      runQuery<Record<string, unknown>>(compiledQuery.sql, compiledQuery.params),
      BIGQUERY_TIMEOUT_MS,
      'Query execution timed out. Try narrowing your date range or filters.'
    );

    // Re-determine visualization based on actual row count
    const finalViz = determineVisualization(
      templateSelection.templateId,
      templateSelection,
      rows.length  // Pass actual row count for smart defaults
    );

    // Build response with final visualization
    const response: AgentResponse = {
      success: true,
      templateSelection,
      compiledQuery: {
        ...compiledQuery,
        visualization: finalViz.visualization,  // Use final determination
      },
      result: {
        rows,
        columns: inferColumns(rows, templateSelection, compiledQuery),
        metadata: {
          rowCount: rows.length,
          executionTimeMs: Date.now() - startTime,
          fromCache: false,
        },
      },
      visualization: finalViz.visualization,
      visualizationOverridden: finalViz.overridden,
      visualizationReason: finalViz.reason,
      followUpSuggestions: generateFollowUpSuggestions(templateSelection),
    };

    return NextResponse.json(response);

  } catch (error) {
    logger.error('Non-streaming query error', error);
    
    // Handle timeout errors specifically
    if (error instanceof Error && error.message.includes('timed out')) {
      return NextResponse.json({
        success: false,
        error: {
          code: 'TIMEOUT',
          message: error.message,
          suggestion: 'Try simplifying your question or narrowing the date range.',
        },
        visualization: 'metric',
      } as AgentResponse);
    }
    
    // Handle BigQuery errors
    if (error instanceof Error && error.message.includes('BigQuery') || 
        (error as any)?.code === 400 || (error as any)?.code === 403) {
      return NextResponse.json({
        success: false,
        error: {
          code: 'QUERY_ERROR',
          message: error instanceof Error ? error.message : 'Query execution failed',
          suggestion: 'Check the Query Inspector for the generated SQL and try adjusting your question.',
        },
        visualization: 'metric',
      } as AgentResponse);
    }
    
    // Re-throw for other errors to be handled by outer catch
    throw error;
  }
}

// =============================================================================
// STREAMING HANDLER
// =============================================================================

async function handleStreamingRequest(
  question: string,
  conversationHistory: any[] | undefined
): Promise<Response> {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Step 1: Thinking
        controller.enqueue(
          encoder.encode(formatSSE({ type: 'thinking', content: 'Analyzing your question...' }))
        );

        // Step 2: Call Claude (with timeout)
        const templateSelection = await withTimeout(
          callClaude(question, conversationHistory),
          CLAUDE_TIMEOUT_MS,
          'AI response timed out. Please try a simpler question or rephrase.'
        );
        
        controller.enqueue(
          encoder.encode(formatSSE({ type: 'template_selected', data: templateSelection }))
        );

        // Check for unsupported
        if (templateSelection.templateId === 'unsupported') {
          controller.enqueue(
            encoder.encode(formatSSE({
              type: 'error',
              data: {
                code: 'UNSUPPORTED_QUESTION',
                message: templateSelection.explanation,
              }
            }))
          );
          controller.close();
          return;
        }

        // Step 3: Compile query
        // Note: No RBAC filters applied - all users can see all data in Explore
        const compiledQuery = compileQuery(templateSelection);
        
        controller.enqueue(
          encoder.encode(formatSSE({
            type: 'query_compiled',
            data: { sql: compiledQuery.sql, params: compiledQuery.params }
          }))
        );

        // Step 4: Execute
        controller.enqueue(
          encoder.encode(formatSSE({ type: 'executing' }))
        );

        const startTime = Date.now();
        const rows = await withTimeout(
          runQuery<Record<string, unknown>>(compiledQuery.sql, compiledQuery.params),
          BIGQUERY_TIMEOUT_MS,
          'Query execution timed out. Try narrowing your date range or filters.'
        );

        // Re-determine visualization based on actual row count (same as non-streaming)
        const finalViz = determineVisualization(
          templateSelection.templateId,
          templateSelection,
          rows.length  // Pass actual row count for smart defaults
        );

        controller.enqueue(
          encoder.encode(formatSSE({
            type: 'result',
            data: {
              rows,
              columns: inferColumns(rows, templateSelection, compiledQuery),
              metadata: {
                rowCount: rows.length,
                executionTimeMs: Date.now() - startTime,
                fromCache: false,
              },
            }
          }))
        );

        // Step 5: Complete
        controller.enqueue(
          encoder.encode(formatSSE({
            type: 'complete',
            data: {
              success: true,
              templateSelection,
              compiledQuery: {
                ...compiledQuery,
                visualization: finalViz.visualization,  // Use final determination
              },
              result: {
                rows,
                columns: inferColumns(rows, templateSelection, compiledQuery),
                metadata: {
                  rowCount: rows.length,
                  executionTimeMs: Date.now() - startTime,
                  fromCache: false,
                },
              },
              visualization: finalViz.visualization,
              visualizationOverridden: finalViz.overridden,
              visualizationReason: finalViz.reason,
              followUpSuggestions: generateFollowUpSuggestions(templateSelection),
            } as AgentResponse
          }))
        );

        controller.close();

      } catch (error) {
        controller.enqueue(
          encoder.encode(formatSSE({
            type: 'error',
            data: {
              code: 'EXECUTION_ERROR',
              message: error instanceof Error ? error.message : 'Query execution failed',
            }
          }))
        );
        controller.close();
      }
    },
  });

  return createStreamResponse(stream);
}

// =============================================================================
// CLAUDE API CALL
// =============================================================================

async function callClaude(
  question: string,
  conversationHistory?: any[]
): Promise<TemplateSelection> {
  const systemPrompt = generateAgentSystemPrompt();

  // Build messages
  const messages: Anthropic.MessageParam[] = [];

  // Add conversation history if present
  if (conversationHistory && conversationHistory.length > 0) {
    for (const msg of conversationHistory.slice(-5)) { // Last 5 messages for context
      messages.push({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      });
    }
  }

  // Add current question
  messages.push({
    role: 'user',
    content: question,
  });

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  });

  // Extract text from response
  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude');
  }

  // Parse JSON from response
  const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON found in Claude response');
  }

  try {
    const selection = JSON.parse(jsonMatch[0]) as TemplateSelection;
    return selection;
  } catch (parseError) {
    logger.error('Failed to parse Claude response', { text: textBlock.text });
    throw new Error('Failed to parse template selection from Claude');
  }
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function inferColumns(
  rows: Record<string, unknown>[], 
  templateSelection?: TemplateSelection,
  compiledQuery?: CompiledQuery
): { name: string; type: string; displayName: string }[] {
  if (rows.length === 0) return [];
  
  const firstRow = rows[0];
  const isConversionMetric = templateSelection?.parameters?.conversionMetric || false;
  
  // Check if this is a leaderboard template - leaderboards show counts, not rates
  const isLeaderboard = templateSelection?.templateId === 'sga_leaderboard' ||
                        compiledQuery?.templateId === 'sga_leaderboard';
  
  return Object.keys(firstRow).map((key) => {
    const value = firstRow[key];
    const baseType = typeof value;
    
    // Detect conversion rate columns
    // For leaderboards, don't treat 'value' as a rate unless it's explicitly a conversion metric
    const isRateColumn = 
      key.toLowerCase().includes('rate') || 
      key.toLowerCase().includes('percent') ||
      (key === 'value' && isConversionMetric && !isLeaderboard) ||
      // Only treat as rate if column name explicitly indicates it AND it's not a leaderboard
      (baseType === 'number' && value !== null && value !== undefined && typeof value === 'number' && value >= 0 && value <= 100 && 
       (key === 'conversion_rate' || (key === 'value' && isConversionMetric && !isLeaderboard)));
    
    return {
      name: key,
      type: isRateColumn ? 'rate' : baseType,
      displayName: key
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (l) => l.toUpperCase()),
    };
  });
}

function generateFollowUpSuggestions(selection: TemplateSelection): string[] {
  const suggestions: string[] = [];
  const { templateId, parameters } = selection;

  // Template-specific suggestions
  if (templateId === 'single_metric') {
    suggestions.push(`Show ${parameters.metric} by channel`);
    suggestions.push(`${parameters.metric} trend by month`);
    suggestions.push(`Compare ${parameters.metric} to last quarter`);
  } else if (templateId === 'metric_by_dimension') {
    suggestions.push(`Show conversion rate by ${parameters.dimension}`);
    suggestions.push(`Top 5 ${parameters.dimension}s by ${parameters.metric}`);
  } else if (templateId === 'conversion_by_dimension') {
    suggestions.push(`Show ${parameters.dimension} volume`);
    suggestions.push(`Conversion trend by month`);
  }

  return suggestions.slice(0, 3);
}

// =============================================================================
// OPTIONS HANDLER (for CORS preflight)
// =============================================================================

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
