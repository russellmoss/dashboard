# BigQuery MCP Setup Guide

> Step-by-step guide for connecting Claude Code (or Cursor) to Google BigQuery via the Model Context Protocol (MCP). This is the setup we use on the Savvy Wealth dashboard project.

---

## What This Gets You

Once configured, your AI coding assistant (Claude Code or Cursor) can directly:

- **List datasets and tables** in your BigQuery project
- **Read table/view schemas** (column names, types, descriptions)
- **Execute SQL queries** against live BigQuery data
- **Search the data catalog** for tables by keyword
- **Get data insights** — ask natural-language questions about table contents
- **Forecast time series** using built-in ML
- **Analyze metric contributions** across dimensions

This is used heavily by our `/new-feature`, `/sga-performance`, `/analyze-wins`, `/audit-semantic-layer`, and `/SGM-analysis` skills, which spawn `data-verifier` subagents that query BigQuery in real time.

---

## Prerequisites

| Requirement | What you need |
|---|---|
| **Google Cloud SDK (gcloud CLI)** | Installed and on your PATH. Download: https://cloud.google.com/sdk/docs/install |
| **A GCP project with BigQuery** | You need at least BigQuery Data Viewer role on the project |
| **Google account authenticated** | Via `gcloud auth` (see Step 1) |
| **Google MCP Toolbox binary** | `toolbox.exe` (Windows) or `toolbox` (Mac/Linux) — see Step 2 |
| **Claude Code or Cursor** | The AI tool you're configuring |

---

## Step 1: Authenticate with Google Cloud

The MCP server uses your **Application Default Credentials (ADC)** to authenticate with BigQuery. This means it piggybacks on your local gcloud login — no service account keys needed.

### 1a. Log in to gcloud

```bash
gcloud auth login
```

This opens a browser. Sign in with your Google account that has access to the BigQuery project.

### 1b. Set Application Default Credentials

```bash
gcloud auth application-default login
```

This is the critical step. It writes a credential file to your local machine that any application (including the Toolbox) can use to authenticate as you. The file is stored at:

- **Windows:** `%APPDATA%\gcloud\application_default_credentials.json`
- **Mac/Linux:** `~/.config/gcloud/application_default_credentials.json`

### 1c. Verify it works

```bash
gcloud auth application-default print-access-token
```

If this prints a long token string (starts with `ya29.`), you're good. If it errors, re-run step 1b.

### 1d. (Optional) Set a default project

```bash
gcloud config set project savvy-gtm-analytics
```

This isn't strictly required since we set the project in the MCP config, but it's useful for running `bq` commands directly.

---

## Step 2: Download the Google MCP Toolbox

The Toolbox is a standalone binary from Google that acts as the MCP server. It translates MCP protocol messages into BigQuery API calls.

### Download

Go to the releases page and download the binary for your platform:

**https://github.com/googleapis/genai-toolbox/releases**

Look for the latest release and download:
- **Windows:** `toolbox_windows_amd64.exe`
- **Mac (Apple Silicon):** `toolbox_darwin_arm64`
- **Mac (Intel):** `toolbox_darwin_amd64`
- **Linux:** `toolbox_linux_amd64`

### Place the binary

Put it somewhere accessible and note the **full path**. In our setup:

```
C:\Users\russe\toolbox.exe
```

On Mac/Linux, you might put it at `~/toolbox` or `/usr/local/bin/toolbox`. Make sure it's executable:

```bash
# Mac/Linux only
chmod +x ~/toolbox
```

### Verify it works

```bash
# Windows
C:\Users\russe\toolbox.exe --version

# Mac/Linux
~/toolbox --version
```

Should print something like: `toolbox version 0.18.0+binary.windows.amd64.3ca58b1`

---

## Step 3: Configure the MCP Server

### For Claude Code

Create or edit `.mcp.json` in your **project root** (the directory where you run Claude Code):

```json
{
  "mcpServers": {
    "bigquery": {
      "command": "C:\\Users\\russe\\toolbox.exe",
      "args": ["--prebuilt", "bigquery", "--stdio"],
      "env": {
        "BIGQUERY_PROJECT": "savvy-gtm-analytics"
      }
    }
  }
}
```

**Adapt for your system:**

| Field | What to change |
|---|---|
| `command` | Full path to your toolbox binary. Use `\\` on Windows, `/` on Mac/Linux |
| `BIGQUERY_PROJECT` | Your GCP project ID that contains the BigQuery datasets |

**Mac/Linux example:**
```json
{
  "mcpServers": {
    "bigquery": {
      "command": "/Users/yourname/toolbox",
      "args": ["--prebuilt", "bigquery", "--stdio"],
      "env": {
        "BIGQUERY_PROJECT": "savvy-gtm-analytics"
      }
    }
  }
}
```

### For Cursor

Create or edit `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "bigquery": {
      "command": "C:\\Users\\russe\\toolbox.exe",
      "args": ["--prebuilt", "bigquery", "--stdio"],
      "env": {
        "BIGQUERY_PROJECT": "savvy-gtm-analytics"
      }
    }
  }
}
```

Same format, just different file location.

---

## Step 4: Enable the MCP Server in Claude Code

### Option A: Auto-enabled (recommended)

If you have this in your Claude Code settings (`.claude/settings.local.json`):

```json
{
  "enableAllProjectMcpServers": true
}
```

The BigQuery MCP server will start automatically when Claude Code launches in the project directory.

### Option B: Manually allow tools

If you don't want to auto-enable all MCP servers, you can add specific tool permissions to the `allow` list in `.claude/settings.local.json`:

```json
{
  "permissions": {
    "allow": [
      "mcp__bigquery__search_catalog",
      "mcp__bigquery__get_table_info",
      "mcp__bigquery__execute_sql",
      "mcp__bigquery__list_table_ids",
      "mcp__bigquery__list_dataset_ids",
      "mcp__bigquery__get_dataset_info",
      "mcp__bigquery__ask_data_insights",
      "mcp__bigquery__forecast",
      "mcp__bigquery__analyze_contribution"
    ]
  }
}
```

This pre-approves those tools so Claude won't prompt you each time.

---

## Step 5: Verify the Connection

Restart Claude Code (or Cursor), then try asking it to query BigQuery. Examples:

```
"List all datasets in the savvy-gtm-analytics project"
"Show me the schema of vw_funnel_master in the Tableau_Views dataset"
"Run: SELECT COUNT(*) FROM savvy-gtm-analytics.Tableau_Views.vw_funnel_master"
```

If the MCP server is running, Claude will use tools like `mcp__bigquery__list_dataset_ids`, `mcp__bigquery__get_table_info`, and `mcp__bigquery__execute_sql` to answer.

---

## How It Works Under the Hood

```
┌─────────────┐     MCP (stdio)     ┌─────────────┐    BigQuery API    ┌──────────┐
│ Claude Code  │ ◄────────────────► │  toolbox.exe │ ◄───────────────► │ BigQuery │
│ (or Cursor)  │   JSON messages    │  (MCP server)│   REST + ADC      │  (GCP)   │
└─────────────┘                     └─────────────┘                    └──────────┘
```

1. **Claude Code** launches `toolbox.exe` as a child process with `--stdio` flag
2. **Toolbox** starts in MCP server mode, communicating over stdin/stdout
3. When Claude calls a tool (e.g., `mcp__bigquery__execute_sql`), Claude Code sends an MCP request to Toolbox
4. **Toolbox** translates it to a BigQuery API call, authenticating with your **Application Default Credentials** (from `gcloud auth application-default login`)
5. **Toolbox** returns the BigQuery response as an MCP response back to Claude Code
6. Claude reads the results and incorporates them into its response

The `--prebuilt bigquery` flag tells Toolbox to use its built-in BigQuery tool definitions (9 tools total — list, search, query, schema, insights, forecast, contribution analysis).

The `BIGQUERY_PROJECT` env var sets the default project for queries that don't specify one.

---

## Available MCP Tools

Once connected, these tools are available to the AI:

| Tool | Purpose | Example use |
|---|---|---|
| `list_dataset_ids` | List all datasets in a project | Discover what data exists |
| `list_table_ids` | List all tables/views in a dataset | Browse a dataset's contents |
| `get_dataset_info` | Get dataset metadata | Check dataset description, labels |
| `get_table_info` | Get table/view schema | See column names, types, descriptions |
| `search_catalog` | Search for tables by keyword | Find tables related to "funnel" or "SMS" |
| `execute_sql` | Run a SQL query | Any read query against BigQuery |
| `ask_data_insights` | Natural language questions about data | "What's the distribution of StageName?" |
| `forecast` | Time series forecasting | Predict future metric values |
| `analyze_contribution` | Contribution analysis | Find what dimensions drive metric changes |

---

## Troubleshooting

### "Permission denied" or "403" errors

Your Google account doesn't have BigQuery access. Ask your GCP admin to grant you:
- `roles/bigquery.dataViewer` (read table data)
- `roles/bigquery.jobUser` (run queries)

on the `savvy-gtm-analytics` project.

### "Could not load default credentials"

Re-run:
```bash
gcloud auth application-default login
```

### Toolbox fails to start / MCP not connecting

1. Verify toolbox runs standalone: `toolbox.exe --version`
2. Check the path in `.mcp.json` is correct and uses proper escaping (`\\` on Windows)
3. Restart Claude Code / Cursor after editing `.mcp.json`
4. Check Claude Code output for MCP server startup errors

### Queries return "not found" for tables

- Make sure `BIGQUERY_PROJECT` matches the project containing your datasets
- Use fully qualified table names: `` `project.dataset.table` ``
- Check that the table/view actually exists: `list_table_ids` tool

### Token expired

ADC tokens auto-refresh. If you see auth errors after a long time, just re-run:
```bash
gcloud auth application-default login
```

---

## Our BigQuery Project Structure

For reference, the `savvy-gtm-analytics` project contains these key datasets and views:

| Dataset | Key Tables/Views | Purpose |
|---|---|---|
| `Tableau_Views` | `vw_funnel_master` | Primary analytics view — all funnel stages, eligibility flags, progression flags |
| `savvy_analytics` | `sms_intent_classified`, `sms_weekly_metrics_daily`, `vw_sga_sms_timing_analysis_v2` | SMS behavior and SGA performance |
| `SavvyGTMData` | `Lead`, `Opportunity`, `Account`, `Task`, `Contact` | Raw Salesforce mirror tables |

The dashboard's semantic layer (`src/lib/semantic-layer/`) and conversion rate queries (`src/lib/queries/conversion-rates.ts`) all query `vw_funnel_master` as the primary data source.

---

## Security Notes

- **ADC credentials are user-scoped** — whoever runs `gcloud auth application-default login` determines what BigQuery data the MCP server can access
- **No service account keys are needed** for the MCP setup — it uses OAuth2 user credentials
- **The `.mcp.json` file is checked into the repo** — it contains no secrets, only the toolbox path and project ID
- **Queries are read-only by default** — the BigQuery prebuilt config only supports SELECT queries, not DDL/DML
- **Cost awareness** — every `execute_sql` call runs a real BigQuery query. Large scans cost money. Use `LIMIT` clauses and target specific partitions when possible
