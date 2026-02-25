# MCP Setup (BigQuery & Google Sheets)

Cursor MCP connections for BigQuery and Google Sheets are **not stored in the repo**. They live in your Cursor config. On a new machine (or new clone), you need to add the config and credentials yourself.

## Why you see errors here

- **BigQuery**: Cursor knows a server named `project-0-Dashboard-bigquery` exists (from project binding), but the server never starts successfully → "No server info found" / "Server not yet created, returning empty offerings".
- **Google Sheets**: The server is not defined in this machine’s MCP config, so it doesn’t appear at all.

## What you need on this machine

### 1. MCP configuration file

Cursor reads MCP servers from:

- **Project-level**: `Dashboard/.cursor/mcp.json` (entire `.cursor/` folder is gitignored, so this file is local-only).
- **User-level**: `%USERPROFILE%\.cursor\mcp.json` (e.g. `C:\Users\russe\.cursor\mcp.json`).

Use **one** of these. If you had it working on the original computer, check there for either:

- `Dashboard\.cursor\mcp.json`, or  
- `%USERPROFILE%\.cursor\mcp.json`.

Copy that file to the same location on this machine. If you don’t have it, use the example below.

### 2. Example `mcp.json`

See the committed example in the repo root: **`mcp.json.example`**. Copy it to:

- **Project**: `Dashboard\.cursor\mcp.json`, or  
- **User**: `%USERPROFILE%\.cursor\mcp.json`.

Then edit:

- **BigQuery**: Set `GOOGLE_APPLICATION_CREDENTIALS` in the server `env` to the **absolute path** to your service account JSON key (same key you use for the app’s BigQuery access). Set `PROJECT_ID` and optionally `DATASETS` to match your project (e.g. `savvy-gtm-analytics`, `Tableau_Views,SavvyGTMData`).
- **Google Sheets**: Set the `command` / `args` to the actual MCP server you use (the example uses `npx -y mcp-gsheets`; your original machine may use a different package or path). Set `GOOGLE_APPLICATION_CREDENTIALS` (or your Sheets-specific env) in `env` to the path of the service account JSON (that key needs **Sheets API** and **Drive API** enabled in Google Cloud).

**If you still have the original computer:** Open **Cursor → Settings → Tools & MCP** there (or open `%USERPROFILE%\.cursor\mcp.json` / `Dashboard\.cursor\mcp.json`) and copy the exact server names, `command`, `args`, and `env`. Use that as your source of truth; package names and args differ between BigQuery/Sheets MCP implementations.

### 3. Credentials

- **BigQuery**: Same as the app:
  - Either put the key file somewhere (e.g. `service-account-key.json`) and set `GOOGLE_APPLICATION_CREDENTIALS` in the MCP server’s `env` to that path.
  - Or use Application Default Credentials: `gcloud auth application-default login` (and point the MCP `env` to the same project if required).
- **Google Sheets**: Service account JSON with **Sheets API** and **Drive API** enabled. Use the same path (or a dedicated Sheets key) in the Google Sheets MCP server’s `env`.

Do **not** commit key files or put secrets in the repo. Keys stay only in `.env` (or env vars) and in the paths you reference from `mcp.json`.

### 4. Restart Cursor

After adding or changing `mcp.json`, **fully quit and restart Cursor** so it picks up the new MCP servers.

## Quick checklist

- [ ] Locate or create `mcp.json` (project or user path).
- [ ] BigQuery server in `mcp.json`: correct `command`/`args`, `env` with `GOOGLE_APPLICATION_CREDENTIALS` and `PROJECT_ID` (and `DATASETS` if needed).
- [ ] Google Sheets server in `mcp.json`: correct `command`/`args`, `env` with credentials path.
- [ ] Service account key file(s) present on this machine and paths in `env` correct.
- [ ] Cursor restarted.

## Reference

- Cursor: **Settings (Ctrl+,)** → **Tools & MCP** to add or edit MCP servers (writes to the same config).
- BigQuery in the app: `GOOGLE_APPLICATION_CREDENTIALS` or `GOOGLE_APPLICATION_CREDENTIALS_JSON` (see `.env.example` and `docs/_generated/env-vars.md`).
