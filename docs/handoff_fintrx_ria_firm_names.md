# Handoff: Pulling RIA Firm Names from FinTrx (BigQuery)

This document is for another Claude Code instance that needs a canonical list of RIA firm names. The dashboard repo at `C:\Users\russe\Documents\dashboard` already has working credentials for the BigQuery dataset that contains them — you can borrow that service-account key file. This doc explains the table, the credentials, and the exact code to read it.

---

## 1. The table

- **Project**: `savvy-gtm-analytics`
- **Dataset**: `FinTrx_data_CA` (location: `northamerica-northeast2`)
- **Table**: `ria_firms_current`
- **Fully qualified**: `` `savvy-gtm-analytics.FinTrx_data_CA.ria_firms_current` ``
- **Rows**: 45,179 (all `ACTIVE = TRUE`, all have non-null `NAME`, 44,896 distinct names — a few firms have duplicate legal names)
- **Source**: FinTrx data feed — SEC Form ADV–derived RIA universe. This is the canonical source for "real RIA firm names."

### Columns relevant to a firm-name seed list

| Column | Type | Notes |
|---|---|---|
| `NAME` | STRING | Legal firm name (e.g. "Edward Jones", "Fisher Investments") |
| `CRD_ID` | INTEGER | SEC CRD number — stable unique key, prefer this over `NAME` for joins |
| `ENTITY_CLASSIFICATION` | STRING | RIA / Broker-Dealer / Hybrid / Custodian flag — use to filter to RIAs only if needed |
| `TOTAL_AUM` | STRING | Stored as STRING — cast/parse before sorting numerically |
| `MAIN_OFFICE_CITY_NAME`, `MAIN_OFFICE_STATE`, `MAIN_OFFICE_COUNTRY_NAME` | STRING | Headquarters location |
| `NUM_OF_EMPLOYEES` | STRING | Cast to INT before sorting |
| `ACTIVE` | BOOLEAN | All rows are TRUE in `*_current` (it's a snapshot view of currently-active firms) |
| `LATEST_UPDATE` | STRING | Date of last refresh from FinTrx |

The full schema has ~80 columns (AUM by client type, investment styles, custodian, etc.) — pull only `NAME` (and `CRD_ID` if you want a stable key) for a seed list.

### Recommended query

```sql
-- Top 200 RIAs by AUM (firm-name seed list)
SELECT
  NAME,
  CRD_ID,
  ENTITY_CLASSIFICATION,
  MAIN_OFFICE_STATE,
  SAFE_CAST(REPLACE(REPLACE(TOTAL_AUM, '$', ''), ',', '') AS NUMERIC) AS total_aum_numeric
FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_firms_current`
WHERE NAME IS NOT NULL
  AND ENTITY_CLASSIFICATION IN ('Investment Advisor', 'RIA')   -- adjust to taste
ORDER BY total_aum_numeric DESC NULLS LAST
LIMIT 200;
```

If you also want broker-dealers and aggregators, drop the `ENTITY_CLASSIFICATION` filter and inspect the distinct values first:

```sql
SELECT ENTITY_CLASSIFICATION, COUNT(*) c
FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_firms_current`
GROUP BY 1 ORDER BY c DESC;
```

---

## 2. Credentials — what to borrow

The dashboard repo authenticates to BigQuery using a **GCP service-account key file** stored locally. The same file works for any BigQuery client that has read access to `savvy-gtm-analytics`.

### Where the key lives on this machine

```
C:\Users\russe\Documents\Dashboard\.json\savvy-gtm-analytics-2233e5984994.json
```

This is the file referenced by `GOOGLE_APPLICATION_CREDENTIALS` in `dashboard/.env`. It is a service-account JSON with read access to BigQuery datasets in project `savvy-gtm-analytics` (including `FinTrx_data_CA`).

### Env vars the dashboard sets (you need the same two)

From `dashboard/.env`:

```bash
GOOGLE_APPLICATION_CREDENTIALS=C:\Users\russe\Documents\Dashboard\.json\savvy-gtm-analytics-2233e5984994.json
GCP_PROJECT_ID=savvy-gtm-analytics
```

### How to "borrow" them in your project

Pick one of these — they're equivalent.

**Option A (simplest): point your project at the same key file.**

In your project's `.env`:
```bash
GOOGLE_APPLICATION_CREDENTIALS=C:\Users\russe\Documents\Dashboard\.json\savvy-gtm-analytics-2233e5984994.json
GCP_PROJECT_ID=savvy-gtm-analytics
```

Pros: zero file copying, single source of truth.
Cons: your project depends on a path outside its repo.

**Option B: copy the key file into your project.**

```powershell
# from your project root
mkdir .json
copy "C:\Users\russe\Documents\Dashboard\.json\savvy-gtm-analytics-2233e5984994.json" .json\
```

Then in your project's `.env`:
```bash
GOOGLE_APPLICATION_CREDENTIALS=.json/savvy-gtm-analytics-2233e5984994.json
GCP_PROJECT_ID=savvy-gtm-analytics
```

**Make sure `.json/` is in `.gitignore`** — this is a private credential, never commit it. The dashboard repo already gitignores `.json/`; mirror that.

**Option C (for cloud deploys, e.g. Vercel): use the JSON contents as an env var.**

The dashboard supports both modes (see `src/lib/bigquery.ts`). For server deployments where you can't ship a file, set:
```bash
GOOGLE_APPLICATION_CREDENTIALS_JSON=<paste the full JSON, single line>
GCP_PROJECT_ID=savvy-gtm-analytics
```
and **do not** set `GOOGLE_APPLICATION_CREDENTIALS`. The dashboard's `bigquery.ts` shows the parsing pattern (handles newline-escaping issues in the `private_key` field).

---

## 3. Code: minimal Node.js client

Install:
```bash
npm install @google-cloud/bigquery
```

`scripts/fetch-ria-firms.ts` (or `.js`):

```ts
import { BigQuery } from '@google-cloud/bigquery';
import * as fs from 'fs';

const bq = new BigQuery({
  projectId: process.env.GCP_PROJECT_ID || 'savvy-gtm-analytics',
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
});

async function main() {
  const sql = `
    SELECT NAME, CRD_ID, MAIN_OFFICE_STATE
    FROM \`savvy-gtm-analytics.FinTrx_data_CA.ria_firms_current\`
    WHERE NAME IS NOT NULL
    ORDER BY NAME
  `;

  const [rows] = await bq.query({ query: sql });
  console.log(`Fetched ${rows.length} firms`);

  // Write a seed file
  fs.writeFileSync(
    'data/ria-firms-seed.json',
    JSON.stringify(rows.map(r => ({ name: r.NAME, crdId: r.CRD_ID, state: r.MAIN_OFFICE_STATE })), null, 2)
  );
}

main().catch(err => { console.error(err); process.exit(1); });
```

Run:
```bash
node --loader ts-node/esm scripts/fetch-ria-firms.ts
# or, for plain JS, just node scripts/fetch-ria-firms.js
```

---

## 4. Reference: dashboard's BigQuery client pattern

If your project is also Next.js / Node and you want the exact pattern the dashboard uses (handles both local file and Vercel JSON-env-var modes, plus Drive scopes for external tables), copy the implementation from:

```
C:\Users\russe\Documents\dashboard\src\lib\bigquery.ts
```

It exports:
- `getBigQueryClient()` — singleton BigQuery client, reads creds from env
- `runQuery<T>(sql, params)` — parameterized query helper

Note: the dashboard always uses `@paramName` parameter binding, never string interpolation. Do the same in your project — SQL injection is real.

---

## 5. Recommendation for the v1 seed list

Per the design discussion: **hardcode a seed list, with a refresh path for v2.**

Concrete v1 path:
1. Run the "Top 200 RIAs by AUM" query above once.
2. Save as `data/ria-firms-seed.json` in your project. Commit this file (it's public RIA names, not credentials).
3. Add a `npm run refresh-firms` script that re-runs the query and overwrites the JSON.
4. v2: have the same script also write to a Drive file the rest of the system already syncs from — gives you the override path without changing the consumer.

This avoids a live BigQuery dependency at runtime (each query costs cents and adds latency for a list that changes monthly at most) while keeping a clean refresh story.

---

## 6. Sanity checks before you ship

- [ ] Run the query once interactively, eyeball the top 20 names — confirm they look like real RIAs (Edward Jones, Fisher Investments, etc.)
- [ ] Confirm row count matches expectation (~45k total active, ~200 if you LIMIT)
- [ ] Verify the service account has access — `bq query --project_id=savvy-gtm-analytics --use_legacy_sql=false 'SELECT COUNT(*) FROM \`FinTrx_data_CA.ria_firms_current\`'` should return `45179` (or whatever the current count is)
- [ ] Confirm `.json/` (or wherever you put the key) is gitignored
- [ ] Never log the credential file contents or commit them

---

## 7. If access fails

The service account in this dashboard project has been granted BigQuery Data Viewer on the `FinTrx_data_CA` dataset. If you get a `403 / Access Denied` on a different machine, the issue is one of:

- **Wrong project ID** — must be `savvy-gtm-analytics`, not the dataset's location
- **Stale key file** — keys can be rotated; if it stops working, ask Russell for a fresh download from GCP Console → IAM & Admin → Service Accounts
- **Wrong dataset** — `FinTrx_data` (without `_CA`) also exists; the firm-names table is specifically in the `_CA` (Canada-region) dataset because that's where FinTrx writes the snapshot

Owner of the GCP project: russell.moss@savvywealth.com.
