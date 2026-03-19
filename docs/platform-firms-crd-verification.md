# Platform Firms CRD Verification

## Goal

Ensure `firm_crd` in `savvy-gtm-analytics.FinTrx_data_CA.platform_firms` is the correct CRD for each `firm_name`. The source of truth is `savvy-gtm-analytics.FinTrx_data_CA.ria_firms_current`: **CRD_ID** ↔ **NAME**.

- **Correct**: `platform_firms.firm_crd` = `ria_firms_current.CRD_ID` and `ria_firms_current.NAME` matches `platform_firms.firm_name`.
- **Wrong**: CRD not in `ria_firms_current`, or the same CRD maps to a different firm name in `ria_firms_current`. In those cases we need to set `firm_crd` to the actual CRD from `ria_firms_current` (or from `ria_contacts_current` if we fuzzy match names).

## Script

Run the queries in **`scripts/platform_firms_crd_verification.sql`** in BigQuery (Console or `bq` CLI).

### If you get "Permission denied while getting Drive credentials"

**`platform_firms` is a native BigQuery table** (no longer Sheet-backed). The verification script and MCP can query it without Drive access. To update the table when the Google Sheet changes, re-load from the Sheet (e.g. re-create an external table from the Sheet, then `TRUNCATE` / `INSERT ... SELECT` into `platform_firms`) or load from another source; see **`scripts/platform_firms_materialize_native.sql`** for refresh notes.

## Normalized name matching

Verification and the main correction list use **normalized** names: strip commas and periods, collapse spaces, trim, lower-case. So `"Allworth Financial, L.P."` and `"Allworth Financial LP"` count as the same; punctuation-only differences are MATCH.

## Steps in the script

| Step | Purpose |
|------|--------|
| **1** | Count MATCH vs NAME_MISMATCH vs CRD_NOT_IN_RIA_FIRMS (using normalized comparison). |
| **2** | List mismatches: `firm_name`, current `firm_crd`, and the RIA name for that CRD. |
| **3 / 5a** | **Correction list**: suggest CRD only when there is a **normalized-exact** match in `ria_firms_current`. One row per firm; prefers keeping `current_crd` when it is among the matches. Use this list for Sheet updates. Rows with no normalized match get `suggested_crd` = NULL and `match_type` = `REVIEW_MANUAL` — do not change the Sheet until reviewed. |
| **4** | **Fuzzy** (SOUNDEX / LIKE): for firms with no normalized-exact match. **Manual review only**; do not use for Sheet updates without verifying. |
| **5** | (Optional) Use `ria_contacts_current.RIA_INVESTOR_NAME` / `RIA_INVESTOR_CRD_ID` for alternate firm names; commented in script. |

## Interpreting results (example run)

From a typical run:

- **Step 1 counts**: e.g. MATCH 63, NAME_MISMATCH 26, CRD_NOT_IN_RIA_FIRMS 51 (140 total).
- **Step 5a (final correction list)** is what you act on:
  - **Rows with `match_type` = NORMALIZED_EXACT** (e.g. 16 firms): the script found the same firm in `ria_firms_current` under a different CRD or name variant. **Safe to apply**: update the Sheet so `firm_crd` = `new_firm_crd_to_use` (and optionally `firm_name` = `suggested_name`).
  - **Rows with `match_type` = REVIEW_MANUAL** (e.g. 64 firms): no normalized-exact match. Do **not** change the Sheet from this list alone. Use Step 4 (fuzzy) as hints and/or SEC IAPD / FINRA to look up the correct CRD, then fix after verification.

**NAME_MISMATCH** (26 in Step 1): the platform CRD exists in `ria_firms_current` but the registered name differs (e.g. "Edward D. Jones & Co LP" vs "Edward Jones"). Either leave as-is (display name is intentional) or set `firm_name` to the RIA name if you want consistency—no CRD change needed.

**CRD_name_match column**: The platform Google Sheet has an optional column **CRD_name_match** (e.g. column E) that can be populated with the firm NAME from `ria_firms_current` for each row’s `firm_crd`. That lets you compare `firm_name` (sheet) vs FinTrx registry name and confirm the CRD is correct. Populate it by joining the sheet’s `firm_crd` to `ria_firms_current.CRD_ID` and writing `ria_firms_current.NAME` into the column (e.g. via a one-off script or BigQuery export).

## Updating `platform_firms`

`platform_firms` is a **native BigQuery table**. To correct CRDs you can either update the table in BQ (e.g. `UPDATE ... SET firm_crd = ... WHERE firm_name = ...`) or edit the Google Sheet and then re-load into `platform_firms` (see `scripts/platform_firms_materialize_native.sql`). For corrections sourced from the verification script:

1. Run **STEP 5a** (correction list) and export rows where `suggested_crd` is not NULL (i.e. skip `REVIEW_MANUAL`).
2. Update **platform_firms** (or the Sheet, then re-load): set `firm_crd` to `new_firm_crd_to_use` for each of those rows (and optionally `firm_name` to `suggested_name`).
3. Rows with `match_type` = `REVIEW_MANUAL` have no normalized-exact match; review STEP 4 (fuzzy) or external sources before changing.
4. **Optional**: Use the correction CSV at `scripts/platform_firms_crd_corrections_16.csv` as a checklist.

## Alternative: inline platform list

If you cannot query the Sheet-backed table, you can run verification using an inline list. Example:

```sql
WITH platform_firms_inline AS (
  SELECT firm_name, firm_crd FROM UNNEST([
    STRUCT('Example Firm LLC' AS firm_name, 12345 AS firm_crd),
    STRUCT('Another RIA Inc' AS firm_name, 67890 AS firm_crd)
  ])
)
SELECT
  p.firm_name,
  p.firm_crd AS platform_firm_crd,
  r.CRD_ID   AS ria_crd_id,
  r.NAME     AS ria_name,
  CASE
    WHEN r.CRD_ID IS NULL THEN 'CRD_NOT_IN_RIA_FIRMS'
    WHEN TRIM(LOWER(COALESCE(r.NAME, ''))) <> TRIM(LOWER(COALESCE(p.firm_name, ''))) THEN 'NAME_MISMATCH'
    ELSE 'MATCH'
  END AS verification_status
FROM platform_firms_inline p
LEFT JOIN `savvy-gtm-analytics.FinTrx_data_CA.ria_firms_current` r
  ON r.CRD_ID = p.firm_crd
ORDER BY verification_status, p.firm_name;
```

Replace the `STRUCT(...)` rows with your actual `firm_name` and `firm_crd` from the sheet.

## Tables

| Table | Role |
|-------|------|
| `FinTrx_data_CA.platform_firms` | Target: `firm_name` (trusted), `firm_crd` (to verify/correct). Native BQ table (can be re-loaded from Sheet). |
| `FinTrx_data_CA.ria_firms_current` | Source of truth: `CRD_ID`, `NAME`. |
| `FinTrx_data_CA.ria_contacts_current` | Optional: `RIA_INVESTOR_CRD_ID`, `RIA_INVESTOR_NAME` (array-like strings) for fuzzy backup. |
