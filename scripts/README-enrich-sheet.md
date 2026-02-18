# Enrich Google Sheet from BigQuery (RIA contacts)

Scripts match sheet participants to `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current` and enrich columns E–I: CRD, firm AUM, rep AUM, producing advisor, and **match_type**.

## Matching strategy

1. **Primary:** Normalized LinkedIn URL (best)  
   - Sheet column D `linkedin` vs BQ `LINKEDIN_PROFILE_URL`  
   - Normalization: lowercase, strip protocol/www, trailing slash, query params → `linkedin.com/in/username`

2. **Fallback:** Fuzzy match on **name** (sheet column B vs BQ first/last). Never match on firm only.

3. **Fuzzy name:** Normalized equality or one string contains the other (first and last).

4. **Fuzzy firm:** When a row is matched (by LinkedIn or name), firm is checked for match_type; normalization + contains.

## Column mapping (sheet ← BQ)

| Sheet col | Header              | BQ column               |
|-----------|---------------------|-------------------------|
| E         | CRD                 | RIA_CONTACT_CRD_ID      |
| F         | PRIMARY_FIRM_TOTAL_AUM | PRIMARY_FIRM_TOTAL_AUM |
| G         | REP_AUM             | REP_AUM                 |
| H         | PRODUCING_ADVISOR   | PRODUCING_ADVISOR (Yes/No) |
| I         | match_type          | See below               |

## match_type (column I)

- **linkedin + name + firm** – Matched by LinkedIn and name + firm also match (best).
- **linkedin + name** – Matched by LinkedIn, name matches, firm does not.
- **linkedin + firm** – Matched by LinkedIn, firm matches, name does not.
- **linkedin** – Matched by LinkedIn only.
- **name + firm** – No LinkedIn match; fuzzy name match and firm matches.
- **name** – No LinkedIn match; fuzzy name match only.
- Never **firm** only (we never match on firm alone).

## One-time setup

1. **Sheet data**  
   - Sheet JSON was fetched via Google Sheets MCP and saved (or re-fetch with same range).  
   - Run:  
     `node enrich-sheet-from-bq.js "<path-to-sheet-json>" scripts/sheet-rows.json`  
   - This creates `sheet-rows.json` (normalized URLs, names, firms).

2. **BQ query files (per chunk)**  
   - `node build-bq-query.js <chunkIndex> <output.sql>`  
   - Chunk index 0..4 (400 URLs per chunk; 1794 unique LinkedIn URLs from sheet).  
   - Example: `node build-bq-query.js 0 bq-chunk0.sql`

## Getting BQ results (required: outside MCP)

The BigQuery MCP tool in this environment returns only **one row** per query when multiple rows match. So you must run the BQ queries **outside** MCP and save results:

1. In **BigQuery Console** (or `bq query`), run the SQL from `bq-chunk0.sql` … `bq-chunk4.sql` (one query per chunk).
2. Export each result as JSON (same schema: `norm_url`, `RIA_CONTACT_CRD_ID`, `CONTACT_FIRST_NAME`, `CONTACT_LAST_NAME`, `PRIMARY_FIRM_NAME`, `PRIMARY_FIRM_TOTAL_AUM`, `REP_AUM`, `PRODUCING_ADVISOR`).
3. Save as:
   - `scripts/bq-result-0.json` … `scripts/bq-result-4.json` (array of rows),  
   **or**
   - One merged file: `scripts/bq-results.json` (array of rows).

## Merge and write to sheet

1. **Merge** sheet rows with BQ results and build E–H values:  
   `node run-enrichment.js --merge`  
   - Reads `sheet-rows.json` and `bq-results.json` (or `bq-result-0.json` … `bq-result-4.json`).  
   - Writes `enriched-eh.json` (includes `values` for E–H and match counts).

2. **Write to Google Sheet**  
   - Use **Google Sheets MCP** `sheets_update_values`:  
     - `spreadsheetId`: `12G9ogzalMDtJBVhOGqi4_zv9CrPLUodYe_3cNDowgx8`  
     - `range`: `futureproof_FINAL_2056_participants!E1` (flexible; expands to all data)  
     - `values`: the `values` array from `enriched-eh.json` (2057 rows: 1 header + 2056 data)  
     - `valueInputOption`: `USER_ENTERED`  
   - If the API limits payload size, write in batches of 500 rows (e.g. E1:H500, E501:H1000, … E2001:H2057) using the same `values` chunks.

## Files

- `enrich-sheet-from-bq.js` – Parse sheet JSON → normalized rows + URL list.
- `sheet-rows.json` – Normalized sheet rows and `urlList` (generated).
- `build-bq-query.js` – Build BQ SQL for one chunk of URLs.
- `bq-chunk0.sql` … `bq-chunk4.sql` – BQ queries (generated).
- `bq-results.json` or `bq-result-0.json` … `bq-result-4.json` – BQ results (you create from BQ export).
- `run-enrichment.js --merge` – Match sheet ↔ BQ, output E–H → `enriched-eh.json`.
- `enriched-eh.json` – Final E–H values and match stats.

## Batch write (if needed)

If a single `sheets_update_values` call is too large, use 500-row batches:

- Batch 0: range `E1:H500`, values = `values.slice(0, 500)` from `enriched-eh.json`
- Batch 1: range `E501:H1000`, values = `values.slice(500, 1000)`
- Batch 2: range `E1001:H1500`, values = `values.slice(1000, 1500)`
- Batch 3: range `E1501:H2000`, values = `values.slice(1500, 2000)`
- Batch 4: range `E2001:H2057`, values = `values.slice(2000, 2057)`

You can run these via Google Sheets MCP in Cursor (e.g. 5 `sheets_update_values` calls with the above ranges and chunks).
