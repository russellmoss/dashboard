# Savvy GTM MCP Server

**Internal infrastructure for AI-assisted BigQuery access**

---

## What This Is

The Savvy GTM MCP (Model Context Protocol) server gives AI tools — Claude Code, Cursor, Windsurf, or any MCP-compatible client — direct, governed access to our BigQuery analytics data. Instead of copy-pasting SQL results or granting raw GCP credentials, team members connect an AI assistant to a managed endpoint that enforces read-only access, dataset boundaries, cost limits, and a full audit trail.

In practice this means: an internal user can open Claude Code, connect to `savvy-bq`, and ask natural-language questions about pipeline, funnel performance, SGA activity, or advisor data. The AI writes and executes SQL against our production BigQuery views, gets real results, and reasons over them — all within the guardrails we've defined.

---

## Architecture Overview

```
                         Dashboard (Vercel)
                        ┌──────────────────────┐
                        │  Settings > Users     │
                        │  ┌────────────────┐   │
                        │  │ McpKeyModal    │   │     API key lifecycle
                        │  │ Generate/Rotate│───│──── POST/DELETE /api/users/[id]/mcp-key
                        │  │ Download .json │   │     Keys: SHA-256 hashed in Neon DB
                        │  └────────────────┘   │
                        └──────────────────────┘

                                  │
                     .mcp.json    │   sk-savvy-xxxx...
                     downloaded   │   (shown once, never stored)
                                  │
                                  ▼

                        MCP Client (Claude Code, etc.)
                        ┌──────────────────────┐
                        │  Authorization:       │
                        │  Bearer sk-savvy-xxx  │
                        └──────────┬───────────┘
                                   │
                          Streamable HTTP / SSE
                                   │
                                   ▼

              Cloud Run: savvy-mcp-server (us-east1)
              ┌─────────────────────────────────────────┐
              │                                         │
              │  ┌─────────┐   ┌───────────────────┐    │
              │  │  Auth   │──▶│  Query Validator   │   │
              │  │ SHA-256 │   │  SELECT-only       │   │
              │  │ lookup  │   │  Dataset allowlist │   │
              │  └────┬────┘   │  LIMIT injection   │   │
              │       │        │  Comment stripping │   │
              │       │        └────────┬──────────┘    │
              │       │                 │               │
              │       │                 ▼               │
              │       │        ┌────────────────┐       │
              │       │        │   BigQuery     │       │
              │       │        │   Job Runner   │       │
              │       │        │   1GB cap      │       │
              │       │        │   120s timeout │       │
              │       │        └────────┬───────┘       │
              │       │                 │               │
              │       │                 ▼               │
              │       │        ┌────────────────┐       │
              │       │        │  Audit Logger  │       │
              │       │        │  (fire+forget) │       │
              │       │        └────────────────┘       │
              │       │                                 │
              │  Tools: execute_sql, list_datasets,     │
              │         list_tables, describe_table,    │
              │         schema_context                  │
              └─────────────────────────────────────────┘
                          │              │
                          ▼              ▼
              ┌──────────────┐  ┌────────────────────┐
              │  Neon (PG)   │  │  BigQuery           │
              │  API key     │  │  Tableau_Views      │
              │  validation  │  │  SavvyGTMData       │
              └──────────────┘  │  savvy_analytics    │
                                │  mcp_audit_log      │
                                └────────────────────┘
```

---

## Data Access Scope

The MCP server provides access to three BigQuery datasets in the `savvy-gtm-analytics` project:

| Dataset | Contents | Example Views/Tables |
|---------|----------|---------------------|
| **Tableau_Views** | Core analytics views powering the dashboard | `vw_funnel_master` (118K rows, 88 columns — the single source of truth for all funnel metrics), pipeline views, conversion rate views |
| **SavvyGTMData** | Salesforce-synced operational data | Tasks, Leads, Opportunities, Contacts, Accounts, broker protocol members |
| **savvy_analytics** | Derived analytics and ML outputs | SMS intent classifications, SGA timing analysis, weekly metrics, MCP audit log |

**Explicitly excluded**: `FinTrx_data_CA` (regulated financial data), `FinTrx_data`, and all other datasets. Exclusion is enforced at both the query validation layer (parse-time allowlist) and GCP IAM (the service account has no permissions on excluded datasets).

---

## MCP Tools

The server exposes five tools to connected AI clients:

### execute_sql
The primary tool. Executes a read-only SQL query against BigQuery and returns structured results (rows, row count, bytes processed, execution time).

Every query passes through the validator before execution:
- Must start with `SELECT`, `WITH`, or `(SELECT`
- No DML/DDL (`INSERT`, `UPDATE`, `DELETE`, `CREATE`, `DROP`, `ALTER`, `MERGE`, `TRUNCATE`)
- No `EXECUTE IMMEDIATE` or `CALL` (stored procedure bypass prevention)
- No `INFORMATION_SCHEMA` access
- No `_tmp_*` tables (transient pipeline artifacts)
- All referenced datasets must be in the allowlist
- `LIMIT 1000` auto-injected when no LIMIT clause is present
- Leading SQL comments stripped before validation (prevents `/* bypass */ DELETE` attacks)

Cost and time limits:
- **1 GB** maximum bytes billed per query (`maximumBytesBilled`)
- **120 second** query timeout (`jobTimeoutMs`)
- **1,000 row** response cap

### list_datasets
Returns the three accessible dataset names. Useful for AI clients to discover what's available.

### list_tables
Lists all tables and views in a specified dataset with their type (TABLE or VIEW). Restricted to the three allowed datasets.

### describe_table
Returns the full column schema for a table or view — field names, types, modes (NULLABLE/REPEATED), and any column descriptions. This is how AI clients learn the shape of data before writing queries.

### schema_context
Serves the bundled `schema-config.yaml` — our semantic layer configuration that contains business context for views: field descriptions, metric definitions (numerator/denominator/date anchor), query rules (required filters, deduplication flags, banned patterns), and a business term glossary. Supports optional term-based filtering (e.g., pass `"MQL"` to get only MQL-related context).

This tool is what makes the AI actually useful — without it, the AI would know column names and types but not what they mean in a GTM context. With it, the AI understands that `is_sqo_unique = 1` is required for SQO counts, that `is_primary_opp_record = 1` is only for AUM aggregation, and that `Full_prospect_id__c` is the universal join key.

---

## Authentication

### API Key Lifecycle

Keys are managed through the dashboard UI at **Settings > User Management**:

1. An admin enables **BigQuery Access** on a user (checkbox in the edit modal)
2. The admin clicks the Database icon to open the MCP API Key modal
3. **Generate Key** creates a `sk-savvy-` prefixed key (20 random bytes, hex-encoded)
4. The plaintext key is shown **once** — it can be copied or downloaded as a `.mcp.json` config file
5. The SHA-256 hash of the key is stored in the `mcp_api_keys` table in Neon
6. The plaintext is never stored anywhere

Key operations:
- **Generate**: Revokes any existing active key for the user, creates a new one
- **Rotate**: Atomic transaction — revokes old key and creates new one simultaneously
- **Revoke**: Deactivates the key immediately

### Authentication Flow

When an MCP client connects:

1. Client sends `Authorization: Bearer sk-savvy-xxxx...` header
2. Server rejects immediately if the token doesn't start with `sk-savvy-`
3. Server computes `SHA-256(token)` and does a single indexed DB lookup
4. The query joins `mcp_api_keys` to `User` and checks three gates:
   - Key `isActive = true`
   - User `isActive = true`
   - User `bqAccess = true`
5. If all three pass, the request proceeds with the user's email and key ID captured for audit
6. `lastUsedAt` is updated in the background (fire-and-forget, non-blocking)

Revoking a key or disabling a user's BigQuery access takes effect on the next request — there is no session cache to invalidate.

---

## Transport Protocols

The server supports two MCP transport protocols on the same Express app:

| Protocol | Endpoint | Used By | Auth Model |
|----------|----------|---------|------------|
| **Streamable HTTP** | `POST /mcp` | Claude Code, newer MCP clients | Auth validated on every request |
| **SSE** (legacy) | `GET /sse` + `POST /messages` | Older MCP clients | Auth validated once at connection time |

Claude Code uses Streamable HTTP. The SSE transport is maintained for backward compatibility.

### Connecting Claude Code

After generating a key, click **Download .mcp.json** in the modal. Place the file in your project root. The file contains:

```json
{
  "mcpServers": {
    "savvy-bq": {
      "type": "http",
      "url": "https://savvy-mcp-server-e2vyxy5ipa-ue.a.run.app/mcp",
      "headers": {
        "Authorization": "Bearer sk-savvy-<your-key>"
      }
    }
  }
}
```

Claude Code discovers this file automatically and connects to the MCP server on startup.

---

## Audit Trail

Every query attempt — successful or failed — is logged to `savvy_analytics.mcp_audit_log` in BigQuery. The table is partitioned by `DATE(logged_at)` with 365-day retention.

| Field | Purpose |
|-------|---------|
| `log_id` | Unique UUID per entry |
| `logged_at` | Timestamp |
| `user_email` | Who ran the query |
| `api_key_id` | Which key was used (ID only, never the raw key) |
| `query_text` | The SQL that was submitted |
| `datasets_referenced` | Array of datasets touched |
| `success` | Whether the query executed successfully |
| `error_message` | Validation or BigQuery error, if any |
| `execution_time_ms` | Wall-clock query duration |
| `bytes_processed` | BigQuery bytes scanned (billing signal) |
| `rows_returned` | Result set size |

Audit writes are fire-and-forget — they do not add latency to the query response. If an audit write fails (e.g., network blip), the error is logged to stdout but the query response is still returned to the client.

### Example: Who queried what this week

```sql
SELECT
  user_email,
  COUNT(*) AS query_count,
  SUM(bytes_processed) / 1e9 AS gb_scanned,
  COUNTIF(NOT success) AS failed_queries
FROM savvy_analytics.mcp_audit_log
WHERE logged_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
GROUP BY user_email
ORDER BY query_count DESC
```

---

## Infrastructure

### Cloud Run Service

| Property | Value |
|----------|-------|
| Service name | `savvy-mcp-server` |
| Region | `us-east1` |
| Project | `savvy-gtm-analytics` |
| Service account | `dashboard-bigquery-reader@savvy-gtm-analytics.iam.gserviceaccount.com` |
| Memory | 512 Mi |
| CPU | 1 |
| Min instances | 0 (scales to zero when idle) |
| Max instances | 3 |
| Auth | `--allow-unauthenticated` (app-layer auth via API keys) |
| Container | Node.js 20 Alpine, multi-stage Docker build |

### Schema Context

The MCP server bundles `.claude/schema-config.yaml` at build time. This file is the single source of truth for business context served by the `schema_context` tool.

To update the schema context after adding new views, metrics, or rules:
1. Edit `.claude/schema-config.yaml`
2. Commit and push
3. Redeploy: `cd mcp-server && bash deploy.sh`

The `deploy.sh` script copies the file from `.claude/` into the Docker build context automatically. The copy inside `mcp-server/` is gitignored to prevent drift.

### Deployment

```bash
cd mcp-server
bash deploy.sh
```

The script:
1. Loads `DATABASE_URL` from `.env` (if not already in the environment)
2. Copies `.claude/schema-config.yaml` into the build context
3. Submits the Docker build to Cloud Build
4. Deploys the new image to Cloud Run
5. Prints the service URL

---

## Security Model

### Defense in Depth

| Layer | Control |
|-------|---------|
| **Network** | Cloud Run accepts all inbound traffic; auth is application-layer |
| **Authentication** | SHA-256 API key validation against Neon DB; three-gate check (key active, user active, BQ access enabled) |
| **Authorization** | `canManageUsers` permission required for key management API routes (admin/revops_admin/manager only) |
| **Query validation** | 9-rule validator: SELECT-only, dataset allowlist, DML/DDL blocking, comment stripping, INFORMATION_SCHEMA blocking, temp table blocking |
| **Cost control** | `maximumBytesBilled: 1GB` per query; `jobTimeoutMs: 120s` |
| **Row limiting** | Auto-injected `LIMIT 1000` when no LIMIT clause present; response capped at 1,000 rows |
| **Data boundary** | Only Tableau_Views, SavvyGTMData, savvy_analytics accessible; FinTrx_data_CA excluded at both parse-time and IAM level |
| **Audit** | Every query logged to `mcp_audit_log` with user, query text, cost, and success/failure |
| **Key hygiene** | SHA-256 hashed storage; plaintext shown once; one active key per user; atomic rotation |

### What the MCP Server Cannot Do

- Write, update, or delete any data in BigQuery
- Access `INFORMATION_SCHEMA` (no schema discovery outside the provided tools)
- Query datasets outside the three allowed ones
- Execute stored procedures (`CALL`) or dynamic SQL (`EXECUTE IMMEDIATE`)
- Access temporary pipeline tables (`_tmp_*`)
- Scan more than 1 GB per query
- Return more than 1,000 rows per query
- Run queries longer than 120 seconds

---

## GTM Utility

### For Revenue Operations

- **Ad-hoc funnel analysis**: Ask Claude to calculate conversion rates across segments, time periods, or sources without writing SQL manually
- **Pipeline diagnostics**: "Which SGAs have the most MQLs stuck without an SQO this quarter?" — the AI queries `vw_funnel_master` with the correct filters and dedup flags
- **Data validation**: Cross-reference dashboard numbers against raw BigQuery data to verify calculations

### For Sales Leadership

- **Team performance**: Connect Claude Code to `savvy-bq` and ask natural-language questions about SGA activity, call volume, SMS engagement patterns
- **Forecast inputs**: Pull real-time pipeline data and conversion rates to inform quarterly planning
- **Recruiter metrics**: Analyze external agency performance from the same data that powers the Recruiter Hub

### For Engineering

- **Schema exploration**: AI clients can discover tables, describe columns, and understand business context through the `schema_context` tool without needing direct BQ console access
- **Query prototyping**: Test BigQuery queries through the MCP server before embedding them in dashboard code — the same validation rules and dataset boundaries apply
- **Audit compliance**: All AI-generated queries are logged with full context, supporting internal audit requirements

### For Anyone with Access

The `.mcp.json` download in the dashboard means setup is a 30-second process:
1. Admin enables BQ Access on your user
2. Admin generates a key and hands you the `.mcp.json` file
3. Drop it in your project root
4. Claude Code connects automatically

No GCP credentials, no BigQuery console access, no SQL expertise required. The AI handles query construction, and the server handles governance.
