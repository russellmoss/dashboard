import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  isInitializeRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { BigQuery } from '@google-cloud/bigquery';
import express from 'express';
import fs from 'fs';
import crypto from 'crypto';
import { authenticateApiKey, type AuthenticatedUser } from './auth.js';
import { validateQuery } from './query-validator.js';
import { logAuditEntry } from './audit.js';

const bigquery = new BigQuery();
const app = express();
const PORT = parseInt(process.env.PORT || '8080', 10);

// Schema config: fetched from GitHub (single source of truth) with local fallback
const SCHEMA_CONFIG_URL = process.env.SCHEMA_CONFIG_URL
  || 'https://raw.githubusercontent.com/russellmoss/dashboard/main/.claude/schema-config.yaml';
const SCHEMA_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let schemaConfig = '';
let schemaCacheExpiry = 0;

// Load local copy as initial fallback
const schemaConfigPath = process.env.SCHEMA_CONFIG_PATH || '/app/schema-config.yaml';
try {
  schemaConfig = fs.readFileSync(schemaConfigPath, 'utf8');
  console.log('[schema] Loaded local schema-config.yaml as initial fallback');
} catch (e) {
  console.warn('[schema] No local schema-config.yaml:', (e as Error).message);
}

async function getSchemaConfig(): Promise<string> {
  const now = Date.now();
  if (schemaConfig && now < schemaCacheExpiry) return schemaConfig;

  try {
    const res = await fetch(SCHEMA_CONFIG_URL, {
      headers: { 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      schemaConfig = await res.text();
      schemaCacheExpiry = now + SCHEMA_CACHE_TTL_MS;
      console.log('[schema] Refreshed schema-config.yaml from GitHub');
    } else {
      console.warn(`[schema] GitHub fetch failed (${res.status}), using cached copy`);
      schemaCacheExpiry = now + 60_000; // retry in 1 min on failure
    }
  } catch (e) {
    console.warn('[schema] GitHub fetch error, using cached copy:', (e as Error).message);
    schemaCacheExpiry = now + 60_000; // retry in 1 min on failure
  }

  return schemaConfig;
}

// Track active transports by session ID (supports both SSE and Streamable HTTP)
const transports = new Map<string, SSEServerTransport | StreamableHTTPServerTransport>();

// Council review C5: user context passed via closure, not transport property
function createMcpServer(user: AuthenticatedUser) {
  const server = new Server(
    { name: 'savvy-bq', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'execute_sql',
        description:
          'Execute a read-only SQL query against BigQuery. Only SELECT queries against Tableau_Views, SavvyGTMData, and savvy_analytics datasets are allowed.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            query: {
              type: 'string',
              description: 'The SQL SELECT query to execute',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'list_datasets',
        description: 'List available BigQuery datasets',
        inputSchema: { type: 'object' as const, properties: {} },
      },
      {
        name: 'list_tables',
        description: 'List tables in a BigQuery dataset',
        inputSchema: {
          type: 'object' as const,
          properties: {
            dataset: {
              type: 'string',
              description:
                'Dataset name (Tableau_Views, SavvyGTMData, or savvy_analytics)',
            },
          },
          required: ['dataset'],
        },
      },
      {
        name: 'describe_table',
        description:
          'Get column names and types for a BigQuery table or view',
        inputSchema: {
          type: 'object' as const,
          properties: {
            dataset: { type: 'string', description: 'Dataset name' },
            table: { type: 'string', description: 'Table or view name' },
          },
          required: ['dataset', 'table'],
        },
      },
      {
        name: 'schema_context',
        description:
          'Get business context for BigQuery views: field descriptions, metric definitions, query rules, and term glossary. Use this before writing queries to understand what columns mean and how to use them correctly.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            term: {
              type: 'string',
              description:
                'Optional: a business term or field name to look up (e.g., "MQL", "AUM", "SQO"). If omitted, returns the full schema context.',
            },
          },
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case 'execute_sql': {
        const query = (args as Record<string, unknown>).query as string;
        const validation = validateQuery(query);

        if (!validation.valid) {
          logAuditEntry({
            userEmail: user.email,
            apiKeyId: user.apiKeyId,
            queryText: query,
            datasetsReferenced: validation.datasetsReferenced,
            success: false,
            errorMessage: validation.error,
          });
          return {
            content: [
              {
                type: 'text',
                text: `Query validation failed: ${validation.error}`,
              },
            ],
          };
        }

        const startTime = Date.now();
        try {
          const [job] = await bigquery.createQueryJob({
            query: validation.sanitizedQuery,
            maximumBytesBilled: '1000000000', // 1GB cap
            jobTimeoutMs: 120000, // Q1: 120s timeout
          });
          const [rows] = await job.getQueryResults();
          const metadata = await job.getMetadata();
          const executionTimeMs = Date.now() - startTime;
          const bytesProcessed = parseInt(
            metadata[0]?.statistics?.totalBytesProcessed || '0',
            10
          );

          logAuditEntry({
            userEmail: user.email,
            apiKeyId: user.apiKeyId,
            queryText: query,
            datasetsReferenced: validation.datasetsReferenced,
            success: true,
            executionTimeMs,
            bytesProcessed,
            rowsReturned: rows.length,
          });

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    rows: rows.slice(0, 1000),
                    rowCount: rows.length,
                    bytesProcessed,
                    executionTimeMs,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (err: unknown) {
          const errorMessage =
            err instanceof Error ? err.message : String(err);
          logAuditEntry({
            userEmail: user.email,
            apiKeyId: user.apiKeyId,
            queryText: query,
            datasetsReferenced: validation.datasetsReferenced,
            success: false,
            errorMessage,
            executionTimeMs: Date.now() - startTime,
          });
          return {
            content: [
              { type: 'text', text: `BigQuery error: ${errorMessage}` },
            ],
          };
        }
      }

      case 'list_datasets': {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify([
                'Tableau_Views',
                'SavvyGTMData',
                'savvy_analytics',
              ]),
            },
          ],
        };
      }

      case 'list_tables': {
        const dataset = (args as Record<string, unknown>).dataset as string;
        const allowedDatasets = [
          'Tableau_Views',
          'SavvyGTMData',
          'savvy_analytics',
        ];
        if (!allowedDatasets.includes(dataset)) {
          return {
            content: [
              {
                type: 'text',
                text: `Dataset "${dataset}" is not accessible`,
              },
            ],
          };
        }
        const [tables] = await bigquery.dataset(dataset).getTables();
        const tableNames = tables.map((t) => ({
          name: t.id,
          type: t.metadata?.type || 'UNKNOWN',
        }));
        return {
          content: [
            { type: 'text', text: JSON.stringify(tableNames, null, 2) },
          ],
        };
      }

      case 'describe_table': {
        const dataset = (args as Record<string, unknown>).dataset as string;
        const table = (args as Record<string, unknown>).table as string;
        const allowedDatasets = [
          'Tableau_Views',
          'SavvyGTMData',
          'savvy_analytics',
        ];
        if (!allowedDatasets.includes(dataset)) {
          return {
            content: [
              {
                type: 'text',
                text: `Dataset "${dataset}" is not accessible`,
              },
            ],
          };
        }
        const [metadata] = await bigquery
          .dataset(dataset)
          .table(table)
          .getMetadata();
        const fields =
          metadata.schema?.fields?.map(
            (f: { name: string; type: string; mode: string; description?: string }) => ({
              name: f.name,
              type: f.type,
              mode: f.mode,
              description: f.description || null,
            })
          ) || [];
        return {
          content: [
            { type: 'text', text: JSON.stringify(fields, null, 2) },
          ],
        };
      }

      case 'schema_context': {
        const term = (args as Record<string, unknown>)?.term as
          | string
          | undefined;
        const config = await getSchemaConfig();
        if (!config) {
          return {
            content: [
              { type: 'text', text: 'Schema context not available' },
            ],
          };
        }
        if (term) {
          const lines = config.split('\n');
          const relevant = lines.filter((l) =>
            l.toLowerCase().includes(term.toLowerCase())
          );
          const context =
            relevant.length > 0
              ? relevant.join('\n')
              : `No matches for "${term}". Try a different term or omit the term parameter for the full schema.`;
          return { content: [{ type: 'text', text: context }] };
        }
        return { content: [{ type: 'text', text: config }] };
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        };
    }
  });

  return server;
}

// SSE endpoint — authenticates and establishes SSE connection
app.get('/sse', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing Authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  const authUser = await authenticateApiKey(token);
  if (!authUser) {
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }

  // Council review C5: pass user via closure, not transport property
  const server = createMcpServer(authUser);
  const transport = new SSEServerTransport('/messages', res);

  // Track transport for POST routing
  transports.set(transport.sessionId, transport);

  // Clean up on close
  transport.onclose = () => {
    transports.delete(transport.sessionId);
  };

  // server.connect() calls transport.start() internally
  await server.connect(transport);
});

// POST endpoint — routes messages to the correct SSE transport
app.post('/messages', express.json(), async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const transport = transports.get(sessionId);
  if (!transport || !(transport instanceof SSEServerTransport)) {
    res.status(400).json({ error: 'Invalid or expired session' });
    return;
  }
  await transport.handlePostMessage(req, res);
});

// ============================================
// Streamable HTTP transport (Claude Code uses this)
// ============================================
// Auth helper for Streamable HTTP — validates on every request
async function authenticateRequest(req: express.Request, res: express.Response): Promise<AuthenticatedUser | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Missing Authorization header' }, id: null });
    return null;
  }
  const token = authHeader.slice(7);
  const user = await authenticateApiKey(token);
  if (!user) {
    res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Invalid API key' }, id: null });
    return null;
  }
  return user;
}

app.all('/mcp', express.json(), async (req, res) => {
  // Authenticate every request (unlike SSE which authenticates once)
  const authUser = await authenticateRequest(req, res);
  if (!authUser) return;

  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  // Existing session — route to its transport
  if (sessionId && transports.has(sessionId)) {
    const transport = transports.get(sessionId)!;
    if (!(transport instanceof StreamableHTTPServerTransport)) {
      res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Session is not Streamable HTTP' }, id: null });
      return;
    }
    await transport.handleRequest(req, res, req.body);
    return;
  }

  // New session — only allowed via POST with initialize request
  if (req.method === 'POST' && isInitializeRequest(req.body)) {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (sid) => {
        transports.set(sid, transport);
      },
    });

    transport.onclose = () => {
      if (transport.sessionId) {
        transports.delete(transport.sessionId);
      }
    };

    const server = createMcpServer(authUser);
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    return;
  }

  // No session and not an initialize request
  res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request: no session ID and not an initialize request' }, id: null });
});

app.post('/refresh-schema', async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token || token !== process.env.CRON_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  schemaCacheExpiry = 0; // force re-fetch
  const config = await getSchemaConfig();
  res.json({ ok: true, length: config.length, refreshedAt: new Date().toISOString() });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '1.0.0' });
});

app.listen(PORT, () => {
  console.log(`Savvy MCP server listening on port ${PORT}`);
});
