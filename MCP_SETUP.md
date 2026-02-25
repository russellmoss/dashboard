# MCP Setup (BigQuery & Google Sheets) — Agent Runbook

Use this document so **Cursor can agentically set up** BigQuery and Google Sheets MCP for this workspace. The service account key for Google Sheets lives in the workspace at `.cursor\service-account-key.json`. Do **not** commit key file contents or paste secrets into the repo.

**Verification — Toolbox vs repo:** The repo does **not** ship or depend on Toolbox for GCP. There is no `toolbox.exe` (or other toolbox binary) in the repo and no npm dependency named `toolbox`. The app uses `GCP_PROJECT_ID`, `GOOGLE_APPLICATION_CREDENTIALS` / `GOOGLE_APPLICATION_CREDENTIALS_JSON`, and the `@google-cloud/bigquery` / `@google-cloud/bigquery-data-transfer` packages — no toolbox involved. **Toolbox is only documented here** as an optional, per-machine executable (e.g. Cursor-installed `toolbox.exe`) used to run the BigQuery MCP server. On a machine without `toolbox.exe`, use the “Alternative: BigQuery via npx” section below with a service account key.

---

## Where things live

| What | Location |
|------|----------|
| Service account key (Google Sheets; optional for BigQuery if using npx) | **`<workspace>\.cursor\service-account-key.json`** — e.g. `C:\Users\russe\Documents\Dashboard\.cursor\service-account-key.json` |
| MCP config (both servers) | **`<workspace>\.cursor\mcp.json`** — single file for BigQuery and Google Sheets |
| Toolbox (BigQuery MCP, optional) | **`%USERPROFILE%\toolbox.exe`** — e.g. `C:\Users\russe\toolbox.exe`. Not in the repo; copy from another machine if needed (see below). |

The `.cursor` folder is gitignored; the key file and `mcp.json` stay local.

**Using toolbox on another machine:** Copy `toolbox.exe` from a machine that has it (e.g. `C:\Users\russe\toolbox.exe`) to the other machine at the same path — i.e. `C:\Users\<that_username>\toolbox.exe` (or `C:\Users\russe\toolbox.exe` if the username is the same). No installer or run step; Cursor launches it when starting the BigQuery MCP server. If toolbox is not present, use the “Alternative: BigQuery via npx” section instead.

---

## Agent instructions (do these in order)

Follow these steps programmatically. Replace placeholders using the current environment (workspace root, user profile).

### 1. Ensure the key file exists

- **Path:** `<workspace_root>\.cursor\service-account-key.json`
- **Action:** If the file is missing, tell the user: *"Put your Google Sheets service account key at `<workspace>\.cursor\service-account-key.json` (create `.cursor` if needed), then run this setup again."*
- If the file exists, proceed.

### 2. Ensure `.cursor` exists

- **Action:** Create the directory `<workspace_root>\.cursor` if it does not exist (e.g. `mkdir .cursor` or equivalent).

### 3. Resolve paths for this machine

- **Credentials path:** Absolute path to the key file.  
  - Example (Windows): `C:\Users\russe\Documents\Dashboard\.cursor\service-account-key.json`  
  - In JSON use double backslashes: `C:\\Users\\russe\\Documents\\Dashboard\\.cursor\\service-account-key.json`
- **Toolbox path (BigQuery):** Cursor’s `toolbox.exe` is usually at `%USERPROFILE%\toolbox.exe` (e.g. `C:\Users\<username>\toolbox.exe`). Use the current user’s home directory. If `toolbox.exe` is not present, use the npx BigQuery server block from step 5b instead.

### 4. Write `mcp.json`

- **Path:** `<workspace_root>\.cursor\mcp.json`
- **Content:** Use the template below. Substitute:
  - `CREDENTIALS_PATH_ESCAPED` → absolute path to `service-account-key.json` with backslashes doubled for JSON.
  - `TOOLBOX_PATH_ESCAPED` → absolute path to `toolbox.exe` with backslashes doubled (e.g. `C:\\Users\\russe\\toolbox.exe`). If toolbox is not available, use the npx BigQuery block from step 5b and skip the toolbox block.

**Template (toolbox + Google Sheets):**

```json
{
  "mcpServers": {
    "bigquery": {
      "command": "TOOLBOX_PATH_ESCAPED",
      "args": ["--prebuilt", "bigquery", "--stdio"],
      "env": {
        "BIGQUERY_PROJECT": "savvy-gtm-analytics"
      }
    },
    "google-sheets": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "mcp-gsheets@latest"],
      "env": {
        "GOOGLE_PROJECT_ID": "savvy-pirate-extension",
        "GOOGLE_APPLICATION_CREDENTIALS": "CREDENTIALS_PATH_ESCAPED"
      }
    }
  }
}
```

**Example** (this machine, with key in workspace `.cursor`):

```json
{
  "mcpServers": {
    "bigquery": {
      "command": "C:\\Users\\russe\\toolbox.exe",
      "args": ["--prebuilt", "bigquery", "--stdio"],
      "env": {
        "BIGQUERY_PROJECT": "savvy-gtm-analytics"
      }
    },
    "google-sheets": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "mcp-gsheets@latest"],
      "env": {
        "GOOGLE_PROJECT_ID": "savvy-pirate-extension",
        "GOOGLE_APPLICATION_CREDENTIALS": "C:\\Users\\russe\\Documents\\Dashboard\\.cursor\\service-account-key.json"
      }
    }
  }
}
```

### 5a. (Optional) Verify toolbox exists

- **Action:** If using the toolbox for BigQuery, check that the `toolbox.exe` path exists (e.g. `dir "%USERPROFILE%\toolbox.exe"` on Windows). If it does not exist, use step 5b for BigQuery instead.

### 5b. Alternative: BigQuery via npx (if no toolbox)

If `toolbox.exe` is not available, use the npx BigQuery server. In the same `.cursor\mcp.json`, set the `bigquery` server to:

```json
"bigquery": {
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-bigquery"],
  "env": {
    "GOOGLE_APPLICATION_CREDENTIALS": "CREDENTIALS_PATH_ESCAPED",
    "PROJECT_ID": "savvy-gtm-analytics",
    "DATASETS": "Tableau_Views,SavvyGTMData"
  }
}
```

Use the same `CREDENTIALS_PATH_ESCAPED` as for Google Sheets. The key must have **BigQuery API** access (e.g. in project `savvy-gtm-analytics`). If your key is Sheets-only, the user must add a BigQuery-capable key to `.cursor` (e.g. a second file) and point this env at it.

### 6. Tell the user to restart Cursor

- **Action:** After writing `mcp.json`, say: *"MCP config is in place. Fully quit Cursor and start it again so the BigQuery and Google Sheets servers load."*
- If the user had to log in to `savvy-gtm-analytics` (e.g. `gcloud auth application-default login`), they do that once before or after restart; no need for the agent to run it unless you have permission.

---

## Manual steps (user only)

- **Key file:** Ensure `service-account-key.json` is at `<workspace>\.cursor\service-account-key.json`. (On this machine it is already at `C:\Users\russe\Documents\Dashboard\.cursor\service-account-key.json`.)
- **Restart Cursor** after the agent writes `mcp.json`.
- **BigQuery (if needed):** If using toolbox and BigQuery prompts for auth, run `gcloud auth application-default login` and sign in to the account that can access `savvy-gtm-analytics`. If using npx BigQuery server, a service account key with BigQuery access is enough; no interactive login required.

---

## Checklist (agent)

- [ ] `.cursor` directory exists.
- [ ] Key file present at `<workspace>\.cursor\service-account-key.json` (or user instructed to add it).
- [ ] `.cursor\mcp.json` written with correct `GOOGLE_APPLICATION_CREDENTIALS` path (absolute, double backslashes).
- [ ] BigQuery: either toolbox path set (and exists) or npx server block with `GOOGLE_APPLICATION_CREDENTIALS`, `PROJECT_ID`, `DATASETS`.
- [ ] User told to restart Cursor.

---

## Reference (this workspace)

- **Key file:** `C:\Users\russe\Documents\Dashboard\.cursor\service-account-key.json`
- **MCP config:** `C:\Users\russe\Documents\Dashboard\.cursor\mcp.json` — one file, both servers.
- **BigQuery project:** `savvy-gtm-analytics` (user can log in to this project if needed).
- **Google Sheets project:** `savvy-pirate-extension` (key is for this project).
