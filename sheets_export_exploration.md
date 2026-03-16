# Forecast Google Sheets Export — Exploration & Feasibility

> **Purpose**: Determine whether the new dashboard forecasting feature can export a fully functional Google Sheet with formulas (not just static values). Investigate the existing Google Sheets export on the Funnel Performance & Efficiency page to understand the current implementation, then assess what's needed to export a forecast sheet with waterfall formulas, override annotations, and actuals comparison columns.
>
> **Dashboard Codebase**: `C:\Users\russe\Documents\Dashboard`
>
> **Key Reference**: The existing Sheets export on the "Funnel Performance & Efficiency" page.
>
> **Goal**: By the end of this exploration, we should know:
> 1. How the current Sheets export works (library, API, approach)
> 2. Whether it supports formulas, formatting, and multiple tabs
> 3. What it would take to export a forecast with live formulas (waterfall calculations, rate × volume chains)
> 4. Whether we can include conditional formatting, override indicators, and annotation notes
> 5. Architectural recommendation for the export feature

---

## Phase 1: Existing Export Implementation

### 1.1 — Locate the Export Code

**Prompt for Claude Code:**
```
In the dashboard codebase at `C:\Users\russe\Documents\Dashboard`, find all code related to the Google Sheets export on the "Funnel Performance & Efficiency" page.

Search for:
1. `grep -rl "export" --include="*.ts" --include="*.tsx" | grep -i -E "funnel|sheet|export|google|xlsx|csv"`
2. `grep -rl "sheets" --include="*.ts" --include="*.tsx"`
3. `grep -rl "xlsx\|exceljs\|sheetjs\|google.*sheet\|spreadsheet" --include="*.ts" --include="*.tsx" --include="*.js"`
4. `grep -rl "funnel.*performance\|performance.*efficiency" --include="*.ts" --include="*.tsx"`
5. Look at the page component for Funnel Performance: search for route definitions or page files containing "funnel" or "performance"
6. Check `package.json` for any spreadsheet-related dependencies (xlsx, exceljs, sheetjs, google-spreadsheet, googleapis, etc.)

For each relevant file found:
- Document the file path
- Read the full contents
- Identify: What library/API is used? What data is exported? Is it client-side or server-side? Does it produce .xlsx, .csv, or write directly to Google Sheets API?

Write your findings below.
```

### Answer

**Complete inventory of export-related files:**

| File | Purpose |
|------|---------|
| `src/lib/sheets/google-sheets-exporter.ts` | **Core export class** — `GoogleSheetsExporter` uses Google Sheets API v4 + Apps Script web app to create and populate spreadsheets |
| `src/lib/sheets/sheets-types.ts` | TypeScript interfaces for `SheetsExportData`, `ExportDetailRecord`, `ConversionAnalysisRecord`, `SheetsExportResult`, `ExportOptions` |
| `src/lib/sheets/gc-sheets-reader.ts` | **Reader** — reads from Google Sheets (used for GC Hub data ingestion, NOT export) |
| `src/components/dashboard/ExportToSheetsButton.tsx` | **UI trigger** — "Export to Sheets" button on the Funnel Performance page |
| `src/app/api/dashboard/export-sheets/route.ts` | **API route** — `POST /api/dashboard/export-sheets` — orchestrates the entire export server-side |
| `src/lib/queries/export-records.ts` | **BigQuery query** — `getExportDetailRecords()` fetches all detail records for export via UNION of 5 cohorts; also `buildConversionAnalysis()` |
| `src/lib/utils/export-csv.ts` | **Generic CSV util** — client-side CSV download (used by `ExportButton` component) |
| `src/lib/utils/sga-hub-csv-export.ts` | **SGA Hub CSV exports** — weekly goals, quarterly progress, closed lost, admin overview CSV downloads |
| `src/components/dashboard/ExportMenu.tsx` | **Explore feature export** — dropdown with CSV/SQL/PNG/ZIP export for AI-generated query results (unrelated to Sheets export) |
| `src/components/ui/ExportButton.tsx` | **Simple CSV button** — wraps `exportToCSV()` utility |

**Key dependency:** `googleapis` (v170.0.0) in `package.json` — the official Google API Node.js client, used for Sheets API v4.

**Auth infrastructure:**
- Service account JWT auth via `GOOGLE_SHEETS_CREDENTIALS_JSON` (Vercel) or `GOOGLE_SHEETS_SERVICE_ACCOUNT_PATH` (local)
- Scopes: `https://www.googleapis.com/auth/spreadsheets` (read/write)
- Apps Script web app URL via `GOOGLE_SHEETS_WEBAPP_URL` — handles template copying, folder placement, and sharing

**The Funnel Performance & Efficiency page** is `src/app/dashboard/page.tsx`. The `ExportToSheetsButton` is rendered at line ~1100 with the current `appliedFilters` and `trendMode` props.

---

### 1.2 — How Does the Current Export Work?

**Prompt for Claude Code:**
```
Based on the files identified in 1.1, document the complete export flow:

1. **Trigger**: How does the user initiate the export? (button click, menu option, etc.) What component renders the export button?

2. **Data preparation**: Where does the data come from? Is it the same data already rendered on the page, or does it make a separate API call? How is it structured before export?

3. **Sheet generation**: 
   - What library generates the spreadsheet? (e.g., exceljs, sheetjs/xlsx, Google Sheets API, csv-stringify)
   - Does it create a file for download (.xlsx/.csv) or write directly to a Google Sheet via API?
   - Does it support multiple tabs/sheets?
   - Does it include any formulas, or is everything static values?
   - Does it include any formatting (bold headers, column widths, number formats, colors)?
   - Does it include any data validation, conditional formatting, or cell comments/notes?

4. **Delivery**: How does the exported file reach the user? (browser download, Google Drive link, email, etc.)

5. **Limitations**: What can't the current export do? (e.g., no formulas, no formatting, single sheet only, etc.)

Read the actual source code and extract the key functions. Include code snippets for the core export logic.
```

### Answer

**1. Trigger:**
User clicks the "Export to Sheets" button (`ExportToSheetsButton` component at `src/components/dashboard/ExportToSheetsButton.tsx`). It's a Tremor `Button` with a `FileSpreadsheet` icon. On click, it POSTs to `/api/dashboard/export-sheets` with the current `filters` and `mode` (cohort/period).

**2. Data Preparation:**
The API route (`src/app/api/dashboard/export-sheets/route.ts`) fetches ALL data server-side in parallel — it does NOT reuse the client-side rendered data:

```typescript
const [metricsResult, ratesResult, trendsResult, detailRecords] = await Promise.all([
  getFunnelMetrics(filters),
  getConversionRates(filters, mode),
  getConversionTrends(filters, 'month', mode),
  getExportDetailRecords(filters, maxRecords),  // separate BQ query with 5-cohort UNION
]);
```

Then `buildConversionAnalysis(detailRecords)` groups records by conversion type. The data is packaged into a `SheetsExportData` object with metadata, metrics, rates, trends, detail records, and conversion analysis.

**3. Sheet Generation:**
- **Library:** Google Sheets API v4 via `googleapis` package (NOT exceljs or sheetjs)
- **Approach:** Writes DIRECTLY to Google Sheets via API (Approach B — not a file download)
- **Template-based:** Calls an Apps Script web app to copy a pre-existing template spreadsheet, then populates it
- **Multiple tabs:** YES — populates 5 sheets: `Summary`, `Trend Data`, `Detail Records`, `Conversion Analysis`, `Validation`
- **Formulas:** YES — the `Validation` sheet contains live `COUNTIFS` and `IFERROR` formulas that reference `Detail Records` data. Example:

```typescript
const contactedToMqlFormula = `=IFERROR(COUNTIFS('Detail Records'!M:M,">=${startDate}",...)*100,0)&"%"`;
```

- **Formatting:** Minimal — no programmatic formatting (bold, colors, column widths). The template likely has pre-formatted headers. Data is written as `USER_ENTERED` which auto-detects numbers/dates/formulas.
- **Conditional formatting:** None added programmatically. The Validation tab uses `✓`/`✗` match indicators via formulas.
- **Cell comments/notes:** None.

**4. Delivery:**
Server returns a JSON response with `{ spreadsheetUrl: "https://docs.google.com/spreadsheets/d/{id}/edit" }`. The client auto-opens this URL in a new tab and shows a success banner with a link.

**5. Limitations of Current Export:**
- No cell formatting applied programmatically (relies on template)
- No conditional formatting rules
- No cell comments/notes
- No named ranges
- No data validation dropdowns
- The Validation sheet has formulas, but Summary/Trend Data/Detail Records/Conversion Analysis are all **static values**
- Large exports chunked at 1000 rows with 100ms delay between chunks (API rate limit workaround)
- `maxDuration = 60` seconds (Vercel serverless timeout)
- Permission-gated: requires `canExport` permission, blocks recruiters and capital partners

**Key code — core export method (`google-sheets-exporter.ts:77-111`):**
```typescript
async exportToSheets(data: SheetsExportData): Promise<SheetsExportResult> {
  const newSpreadsheet = await this.copyTemplate(data);  // Apps Script creates copy
  const spreadsheetId = newSpreadsheet.id!;
  await this.populateSummarySheet(spreadsheetId, data);
  await this.populateTrendDataSheet(spreadsheetId, data.trends);
  await this.populateDetailRecordsSheet(spreadsheetId, data.detailRecords);
  await this.populateConversionAnalysisSheet(spreadsheetId, data.conversionAnalysis);
  await this.populateValidationSheet(spreadsheetId, data);
  return { success: true, spreadsheetId, spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` };
}
```

---

### 1.3 — What Data Gets Exported?

**Prompt for Claude Code:**
```
Read the Funnel Performance & Efficiency page component and the export function to understand exactly what data gets exported.

Document:
1. What columns are included in the export?
2. What rows are included? (all channels? all stages? summary + detail?)
3. Are there any transformations applied to the data before export (e.g., percentage formatting, rounding, null handling)?
4. Does the export include any metadata (date range, filters applied, export timestamp)?
5. How does the export handle the funnel structure — is it a flat table or does it preserve the hierarchical channel → sub-source → stage structure?

Also check: are there any OTHER export features elsewhere in the dashboard? (e.g., on other pages, in shared utility functions, etc.) We want a complete inventory of export capabilities.
```

### Answer

**Tab 1: Summary (A1:B21)**

Columns: Label, Value. Rows:
1. Metadata: Export Date, Exported By, Date Range, Calculation Mode, Filters Applied
2. Funnel Metrics: SQLs, SQOs, Signed, Signed AUM, Joined, Joined AUM, Pipeline AUM, Open Pipeline AUM
3. Conversion Rates: Contacted→MQL, MQL→SQL, SQL→SQO, SQO→Joined (formatted as `"XX.X% (num/denom)"`)

All values are **static** — pre-computed strings. AUM values are formatted as `$X.XM` or `$X.XB` strings. Conversion rates are pre-formatted percentage strings with numerator/denominator.

**Tab 2: Trend Data (A1:P{N+1})**

Columns (16): Period, SQLs, SQOs, Joined, then 4 conversion rate groups (Rate, Num, Denom × 4 transitions). One row per monthly trend period. All **static values** — rates formatted as `"XX.X%"` strings.

**Tab 3: Detail Records (A1:AH{N+1})**

34 columns including: Lead ID, Contact ID, Opportunity ID, Advisor Name, Salesforce URL, Original Source, Channel, SGA, SGM, Stage, AUM, 5 date fields, 5 stage flags (YES/NO), 4 progression flags, 4 eligibility flags, dedup flags, Record Type, Export Reason. Up to 50,000 rows. All **static values**.

The data comes from a 5-cohort UNION query (`export-records.ts`) that captures records for: contacted in period, MQL in period, SQL in period, SQO in period, joined in period. Records appearing in multiple cohorts are deduplicated with comma-separated export reasons.

**Tab 4: Conversion Analysis (A1:G{N})**

4 sections (one per transition), each with headers + detail rows: Advisor Name, Salesforce URL, From Date, To Date, In Numerator (YES/NO), In Denominator (YES/NO), Notes. All **static values**.

**Tab 5: Validation (A1:H16)**

This is the only tab with **live formulas**. Contains:
- Conversion rate validation: Dashboard value vs. COUNTIFS formula against Detail Records, with match check formula
- Volume validation: Dashboard SQLs/SQOs/Joined vs. COUNTIFS formulas against Detail Records
- Match indicator (`✓`/`✗`) via formula comparing dashboard values to recalculated values

**Transformations:**
- AUM formatted to `$X.XK/M/B` via `formatCurrency()`
- Dates formatted as `YYYY-MM-DD`
- Boolean flags mapped to `YES`/`NO` strings
- Conversion rates formatted as `"XX.X% (num/denom)"` strings

**No metadata row** for date range or filters in Trend Data/Detail Records tabs — those are only in the Summary tab.

**Other export features in the dashboard:**
1. **Generic CSV export** (`src/components/ui/ExportButton.tsx` + `src/lib/utils/export-csv.ts`) — used by other pages
2. **SGA Hub CSV exports** (`src/lib/utils/sga-hub-csv-export.ts`) — 4 functions: `exportWeeklyGoalsCSV`, `exportQuarterlyProgressCSV`, `exportClosedLostCSV`, `exportAdminOverviewCSV`
3. **Explore feature export** (`src/components/dashboard/ExportMenu.tsx`) — client-side CSV/SQL/PNG/ZIP export for AI query results
4. **SGA Activity drill-down** — references sheet export in `ActivityDrillDownModal.tsx`

All other exports are **client-side CSV downloads** — only the Funnel Performance export uses the Google Sheets API.

---

## Phase 2: Formula Export Feasibility

### 2.1 — Can the Current Library Support Formulas?

**Prompt for Claude Code:**
```
Based on the library identified in Phase 1 (whether it's exceljs, sheetjs, or something else):

1. **Check the library's documentation/capabilities**: Does it support writing cell formulas (not just static values)? Search the library's npm page, README, or type definitions for formula-related APIs.

2. **Test formula support**: If the library supports formulas, show an example of how a cell formula would be set. For instance:
   - exceljs: `cell.value = { formula: 'B2*C2', result: 150 }` 
   - sheetjs: `{ f: 'B2*C2', v: 150, t: 'n' }`
   
3. **Check for Google Sheets API usage**: Does the codebase use the Google Sheets API (`googleapis` package) anywhere? If so, formulas can be written directly via `spreadsheets.values.update` with `valueInputOption: 'USER_ENTERED'` which auto-parses formulas.

4. **If the current library does NOT support formulas**, research what libraries do:
   - `exceljs` — supports formulas, formatting, conditional formatting, comments, multiple sheets
   - `sheetjs` (xlsx) — supports formulas (read/write), formatting (limited in free version)
   - `Google Sheets API` — full formula support, formatting, comments, conditional formatting, collaboration
   - `@googleapis/sheets` — Node.js client for Google Sheets API

Document exactly what's possible with the current setup vs. what would require a library change or addition.
```

### Answer

**The current library (Google Sheets API v4) fully supports formulas.** This is the critical finding.

**1. Formula support — already proven in the codebase:**

The existing `populateValidationSheet()` method in `google-sheets-exporter.ts` already writes cell formulas. The key is `valueInputOption: 'USER_ENTERED'`:

```typescript
await this.sheets.spreadsheets.values.update({
  spreadsheetId,
  range: 'Validation!A1',
  valueInputOption: 'USER_ENTERED',  // <-- THIS is how formulas work
  requestBody: { values },
});
```

When `valueInputOption` is set to `'USER_ENTERED'`, any string starting with `=` is interpreted as a formula. This is already working — the Validation tab writes complex COUNTIFS formulas like:

```
=IFERROR(COUNTIFS('Detail Records'!M:M,">=${startDate}",...)*100,0)&"%"
```

**2. Formula API examples (from the codebase):**

- Simple formula: `'=A1*B1'` (just a string starting with `=`)
- Cross-sheet reference: `'=COUNTIFS(\'Detail Records\'!M:M,">="&A1)'`
- Conditional: `'=IF(B14=C14,"✓","✗")'`
- Error-safe: `'=IFERROR(A1/B1*100,0)&"%"'`

**No library change needed.** The Google Sheets API with `USER_ENTERED` gives us:
- ✅ Cell formulas (any Google Sheets formula)
- ✅ Cross-tab references (`'Tab Name'!A1`)
- ✅ Named ranges (via `spreadsheets.batchUpdate` with `AddNamedRangeRequest`)
- ✅ Number formatting (via `spreadsheets.batchUpdate` with `RepeatCellRequest`)
- ✅ Conditional formatting (via `spreadsheets.batchUpdate` with `AddConditionalFormatRuleRequest`)
- ✅ Cell notes/comments (via `spreadsheets.batchUpdate` with `UpdateCellsRequest` setting `note` field)
- ✅ Data validation (via `spreadsheets.batchUpdate` with `SetDataValidationRequest`)
- ✅ Multiple tabs (already using this)
- ✅ Merging cells, bold, colors, borders (via `batchUpdate` formatting requests)

**3. Google Sheets API is already configured:**

The codebase has full Google API auth infrastructure:
- `googleapis` v170.0.0 in `package.json`
- Service account with `spreadsheets` scope (read/write)
- Apps Script web app for template copying + sharing
- Environment variables: `GOOGLE_SHEETS_CREDENTIALS_JSON`, `GOOGLE_SHEETS_SERVICE_ACCOUNT_PATH`, `GOOGLE_SHEETS_WEBAPP_URL`

**4. What would need to change for forecast export:**

The current export uses `spreadsheets.values.update` (simple value writes). For rich formatting, conditional formatting, and cell notes, we'd need to add `spreadsheets.batchUpdate` calls which support:

```typescript
// Example: Add conditional formatting
await this.sheets.spreadsheets.batchUpdate({
  spreadsheetId,
  requestBody: {
    requests: [
      {
        addConditionalFormatRule: {
          rule: {
            ranges: [{ sheetId: 0, startRowIndex: 1, endRowIndex: 100, startColumnIndex: 5, endColumnIndex: 6 }],
            booleanRule: {
              condition: { type: 'NUMBER_LESS', values: [{ userEnteredValue: '0' }] },
              format: { backgroundColor: { red: 1, green: 0.8, blue: 0.8 } }
            }
          }
        }
      }
    ]
  }
});
```

**Bottom line: The current library (Google Sheets API v4) supports EVERYTHING we need for formula export. No library change required. The `USER_ENTERED` value input option already handles formulas, and `batchUpdate` handles formatting, conditional formatting, cell notes, and named ranges.**

---

### 2.2 — What Formulas Would the Forecast Export Need?

**Prompt for Claude Code:**
```
Based on the forecasting methodology documented in `C:\Users\russe\Documents\Dashboard\forecasting_exploration.md` (specifically Phases 2.2, 2.3, and Appendix C), define the complete set of formulas the exported Google Sheet would need.

The export should recreate the forecast model as a functional spreadsheet. Map out:

1. **Waterfall volume formulas**: For each stage after Created, the volume = previous stage volume × conversion rate. Example:
   - If Created is in cell D5 and Created→Contacted rate is in D6, then Contacted (D7) = `=D5*D6`
   - MQL (D9) = `=D7*D8` (Contacted × Contacted→MQL rate)
   - And so on down the funnel

2. **Quarterly total formulas**: Quarterly forecast volume = sum of 3 monthly values. Example:
   - If April SQOs is in E12, May in G12, June in I12, then Q2 Total (C12) = `=E12+G12+I12`

3. **Rate cells**: These should be editable values (not formulas) since they come from trailing 90-day actuals or manual overrides. But they should have number formatting as percentages.

4. **Variance formulas**: If forecast is in column E and actual is in column F, variance = `=F5-E5` and variance % = `=IF(E5=0,"",F5/E5-1)`

5. **Summary aggregation formulas**: Channel-level totals that SUM across sub-sources. Example:
   - Outbound SQOs = `=SUM(Outbound_PLL_SQOs, Outbound_LinkedIn_SQOs)`

6. **Target/gap formulas**: 
   - Gap to target = `=finance_minimum - forecast_total`
   - Monthly target = `=total_target * monthly_distribution_pct`

7. **Conditional formatting rules**: 
   - Green for actual > forecast
   - Red for actual < forecast  
   - Yellow/icon for overridden cells

8. **Cell comments/notes**: Override annotations should appear as cell comments (hover to see the note, who set it, when)

Create a complete formula map showing the cell layout and every formula needed. Use a sample section (e.g., Outbound channel with 2 sub-sources, 3 months) to illustrate the pattern.
```

### Answer

Based on `forecasting_exploration.md` Phase 2.2 (waterfall formula patterns), Appendix C (methodology), and Phase 6.2 (schema), here is the complete formula map.

**Sample layout: Outbound channel with 3 sub-sources (PLL, LinkedIn, Fintrx), 3 months (Apr/May/Jun)**

```
     A                    B            C         D          E         F          G         H          I
1  [Channel Detail — Outbound]
2  Sub-Source             Stage        Q2 Fcst   Apr Fcst   Apr Act   Apr Var    May Fcst  May Act    May Var
3  ─────────────────────────────────────────────────────────────────────────────────────────────────────────
4  Provided List (Lead Scoring)  Created  =SUM(D4,G4,...)  150       120        =E4-D4    155       ...
5                         Cr→Cont Rate            0.877               =E5                0.877
6                         Contacted    =SUM(D6,...) =D4*D5   =E4*E5   =E6-D6    =G4*G5
7                         Cont→MQL Rate            0.023               =E7                0.023
8                         MQL          =SUM(D8,...) =D6*D7   =E6*E7   =E8-D8    =G6*G7
9                         MQL→SQL Rate             0.480               =E9                0.480
10                        SQL          =SUM(D10,...) =D8*D9  =E8*E9   =E10-D10  =G8*G9
11                        SQL→SQO Rate             0.710               =E11               0.710
12                        SQO          =SUM(D12,...) =D10*D11 =E10*E11 =E12-D12 =G10*G11
13                        SQO→Join Rate            0.150               =E13               0.150
14                        Joined       =SUM(D14,...) =D12*D13 =E12*E13 =E14-D14 =G12*G13
15
16  LinkedIn (Self Srcd)  Created      =SUM(D16,...) 80       ...
17                        ... (same pattern as rows 5-14)
28
29  Fintrx (Self-Sourced) Created      =SUM(D29,...) 50       ...
30                        ... (same pattern as rows 5-14)
```

**Complete formula catalog:**

**1. Waterfall Volume Formulas (the core ask)**

For each stage after Created, the monthly forecast volume = previous stage × conversion rate:

| Cell | Formula | Example |
|------|---------|---------|
| Contacted (D6) | `=D4*D5` | Created × Created→Contacted rate |
| MQL (D8) | `=D6*D7` | Contacted × Contacted→MQL rate |
| SQL (D10) | `=D8*D9` | MQL × MQL→SQL rate |
| SQO (D12) | `=D10*D11` | SQL × SQL→SQO rate |
| Joined (D14) | `=D12*D13` | SQO × SQO→Joined rate |

For Outbound channels, Created has a special formula:
- `Created = # Ramped SGAs × Lead List Size per SGA` (from Assumptions tab)
- PLL: `=Assumptions!B3 * Assumptions!B4`
- LinkedIn: `=Assumptions!B5 * Assumptions!B6`
- Fintrx: `=Assumptions!B7 * Assumptions!B8`

For non-Outbound channels, Created is a static input value (no formula — sourced from trailing actuals or manual entry).

**2. Quarterly Total Formulas**

Quarterly forecast = sum of 3 monthly forecasts:

| Cell | Formula |
|------|---------|
| Q2 Forecast Created (C4) | `=D4+G4+J4` (Apr + May + Jun) |
| Q2 Forecast Contacted (C6) | `=D6+G6+J6` |
| Q2 Forecast SQO (C12) | `=D12+G12+J12` |

Quarterly rates are NOT averaged — they are informational only (computed as weighted average or just displayed per-month).

**3. Rate Cells — Editable Values, NOT formulas**

Rate cells contain **static numbers** (from trailing 90-day actuals or manual overrides). They are formatted as percentages:
- `D5 = 0.877` (formatted as `87.7%`)
- Rates default to the same trailing-90-day value for all 3 months (per Appendix C.1)
- Users can override per-month; overridden cells get a cell note

**4. Variance Formulas**

For each month, variance columns compare actual to forecast:

| Cell | Formula | Description |
|------|---------|-------------|
| Variance (F4) | `=E4-D4` | Actual - Forecast (absolute) |
| Variance % (F4 alt) | `=IF(D4=0,"",E4/D4-1)` | Percentage variance |

For rates:
| Cell | Formula |
|------|---------|
| Rate Variance (F5) | `=E5-D5` | Actual rate - Forecast rate (formatted as % points) |

**5. Channel Summary Aggregation Formulas**

On the Summary tab, channel-level totals SUM across sub-sources:

| Cell | Formula |
|------|---------|
| Outbound Total SQOs (Apr) | `=SUM('Channel Detail — Outbound'!D12, 'Channel Detail — Outbound'!D26)` |
| Or with named ranges: | `=Outbound_PLL_SQO_Apr + Outbound_LinkedIn_SQO_Apr` |

Grand total:
| Cell | Formula |
|------|---------|
| Total Forecast SQOs (Q2) | `=SUM(Outbound_SQO_Q2, Marketing_SQO_Q2, Inbound_SQO_Q2, ...)` |

**6. Target/Gap Formulas (Targets & Gap Analysis tab)**

| Cell | Formula | Description |
|------|---------|-------------|
| Gap to Target | `=B5-C5` | Finance Minimum - Forecast Total |
| Monthly Target | `=B5*D5` | Total Target × Monthly Distribution % |
| QTD Progress | `=SUM(Apr_Actual, May_Actual, Jun_Actual)` | Sum of actual SQOs to date |
| QTD vs Target | `=C8-C7` | QTD Progress - QTD Target |

**7. Conditional Formatting Rules**

Applied via `spreadsheets.batchUpdate` API:

| Rule | Condition | Format |
|------|-----------|--------|
| Variance positive | Cell value > 0 | Green background (`#C6EFCE`) |
| Variance negative | Cell value < 0 | Red background (`#FFC7CE`) |
| Override indicator | Cell has note | Yellow background (`#FFEB9C`) or small icon |
| Rate > 100% | Cell value > 1.0 | Orange background (data anomaly) |
| Target gap positive (behind) | Cell value > 0 | Red text |
| Target gap zero/negative (ahead) | Cell value <= 0 | Green text |

**8. Cell Comments/Notes for Override Annotations**

Via `spreadsheets.batchUpdate` with `updateCells` request:

```typescript
{
  updateCells: {
    rows: [{
      values: [{
        note: "Overridden by jane@savvy.com on 2026-04-15\nOriginal: 0.48 → Override: 0.52\nReason: LinkedIn campaigns ramping up, expect higher MQL rate"
      }]
    }],
    fields: 'note',
    start: { sheetId: tabId, rowIndex: 8, columnIndex: 3 }
  }
}
```

**Formula dependency chain (critical for correctness):**
```
Created (input or SGA formula)
  → Created→Contacted Rate (input)
    → Contacted = Created × Rate
      → Contacted→MQL Rate (input)
        → MQL = Contacted × Rate
          → MQL→SQL Rate (input)
            → SQL = MQL × Rate
              → SQL→SQO Rate (input)
                → SQO = SQL × Rate
                  → SQO→Joined Rate (input)
                    → Joined = SQO × Rate
```

Each formula cell only references cells above/left of it in the waterfall, so Google Sheets can resolve all formulas in a single pass with no circular dependencies.

---

### 2.3 — Google Sheets API vs. Local File Export

**Prompt for Claude Code:**
```
There are two approaches to exporting a forecast with formulas:

**Approach A: Generate .xlsx file with formulas (download)**
- Use exceljs or sheetjs to create an .xlsx file with embedded formulas
- User downloads the file and opens it in Excel or uploads to Google Drive
- Pros: No Google API auth needed, works offline, simple
- Cons: Some formula/formatting features may not translate perfectly to Google Sheets; conditional formatting support varies; no cell comments in some libraries; user has to manually upload to Drive

**Approach B: Write directly to Google Sheets via API**
- Use the Google Sheets API to create a new spreadsheet in the user's Google Drive
- Write values, formulas, formatting, conditional formatting, and notes directly
- Pros: Full Google Sheets feature support (formulas, comments, conditional formatting, named ranges, data validation); shareable immediately; can include multiple tabs
- Cons: Requires Google OAuth consent (may already exist if dashboard has Google integration); slightly more complex; requires server-side API route

**Approach C: Hybrid — generate .xlsx then import to Sheets**
- Generate .xlsx with exceljs (formulas + formatting)
- Optionally auto-import to Google Sheets via API
- User gets both: a download link and a Google Sheets link

Evaluate:
1. Does the dashboard already have Google OAuth / Google API credentials configured? (Check for googleapis, google-auth-library, or OAuth tokens in the codebase — look at environment variables, auth configs, middleware)
2. Does the existing Sheets export use Approach A, B, or something else?
3. Which approach gives us the best formula + formatting + comments support for the forecast use case?
4. What's the implementation effort for each approach?

Provide a recommendation.
```

### Answer

**1. Does the dashboard already have Google OAuth / Google API credentials?**

**YES — fully configured and in production.** The dashboard has:
- `googleapis` v170.0.0 in `package.json`
- Google service account JWT auth with `spreadsheets` scope (read + write)
- Three environment variables: `GOOGLE_SHEETS_CREDENTIALS_JSON` (Vercel), `GOOGLE_SHEETS_SERVICE_ACCOUNT_PATH` (local), `GOOGLE_SHEETS_WEBAPP_URL` (Apps Script)
- An Apps Script web app that handles template copying, Drive folder placement, and user sharing
- Two separate auth clients: one for writing (`google-sheets-exporter.ts`, full access) and one for reading (`gc-sheets-reader.ts`, read-only scope)

No additional OAuth setup needed.

**2. Current export approach:**

The current Funnel Performance export uses **Approach B: Google Sheets API directly**. The flow:
1. Apps Script web app copies a template spreadsheet → returns new spreadsheet ID
2. Service account writes data via `spreadsheets.values.update` with `valueInputOption: 'USER_ENTERED'`
3. User receives a Google Sheets link that opens in their browser

**3. Best approach for forecast export:**

**Recommendation: Approach B (Google Sheets API) — extend the existing pattern.**

Justification:
- **Already proven:** The infrastructure, auth, and template-copy pattern are all working in production
- **Full formula support:** `valueInputOption: 'USER_ENTERED'` handles formulas natively
- **Full formatting support:** `spreadsheets.batchUpdate` handles conditional formatting, cell notes, named ranges, data validation, merge cells, bold, colors, borders — everything in the Phase 2.2 formula map
- **Immediate sharing:** The Apps Script web app already handles sharing the spreadsheet with the requesting user
- **No user friction:** No file download → manual upload to Drive workflow
- **Consistent UX:** Same "Export to Sheets" button pattern, same "opens in new tab" behavior

Why NOT Approach A (.xlsx download):
- Would require adding `exceljs` as a new dependency
- Formula/formatting translation between Excel and Sheets is lossy
- User has to manually upload to Google Drive — extra friction
- Cell notes format differently in Excel vs. Sheets
- Conditional formatting rules don't always translate perfectly

Why NOT Approach C (Hybrid):
- Adds complexity for no clear benefit over Approach B
- Would need both `exceljs` AND Google Sheets API code
- Two export artifacts to maintain

**4. Implementation effort:**

| Component | Effort | Reusable from existing |
|-----------|--------|----------------------|
| Template spreadsheet (create in Google Sheets manually) | 2-3 hours | No (new template, but pattern is known) |
| API route `POST /api/forecast/export` | ~1 day | Auth pattern from `export-sheets/route.ts`, data fetching patterns |
| `ForecastSheetsExporter` class | 2-3 days | `GoogleSheetsExporter` class structure, `writeInChunks`, `copyTemplate` pattern |
| Formula generation logic (waterfall formulas, cross-tab refs) | 1-2 days | New code, but formula patterns are well-defined |
| Formatting (conditional formatting, cell notes, named ranges) | 1 day | New code using `batchUpdate` API |
| UI button + integration | 0.5 day | `ExportToSheetsButton` pattern directly reusable |
| **Total** | **~5-7 days** | **~30% reusable** |

This is a **medium** effort task. The hardest part is the formula generation logic — building cell references dynamically for an arbitrary number of sub-sources across multiple tabs. The API infrastructure is already done.

---

## Phase 3: Export Layout Design

### 3.1 — Proposed Sheet Structure

**Prompt for Claude Code:**
```
Based on the forecast data model (from `forecasting_exploration.md` Phase 6.2 and Appendix C) and the formula requirements (from Phase 2.2 above), propose the complete layout of the exported Google Sheet.

Design it as a multi-tab workbook:

**Tab 1: "Forecast Summary"**
- Similar to the current sheet's rows 56-103 zone
- Channels as row groups, stages as sub-rows
- Columns: Historical Q-3, Q-2, Q-1 (actuals, read-only) | Q Forecast | Month 1 Forecast | Month 1 Actual | Month 1 Variance | Month 2 Forecast | Month 2 Actual | Month 2 Variance | Month 3 Forecast | Month 3 Actual | Month 3 Variance
- Formulas: Quarterly totals = SUM of monthly, Variance = Actual - Forecast, Channel totals = SUM of sub-sources
- Include a "Total Forecast SQOs" cell at the top

**Tab 2: "Channel Detail — [Channel Name]" (one per channel)**
- Mirrors the detail sections (rows 106+)
- Full funnel waterfall: Created → Contacted → MQL → SQL → SQO → Joined
- Rate rows between each stage (editable, formatted as %)
- Volume rows with formulas: volume = prev_stage × rate
- Monthly columns with forecast + actual + variance
- Override indicator column: "Override?" (Y/N), "Override Reason" (text from audit trail)

**Tab 3: "Targets & Gap Analysis"**
- Mirrors the P:W zone
- Finance minimum by channel (input)
- Forecast by channel (formula linking to Tab 1)
- Gap = minimum - forecast (formula)
- Gap filler allocation (input)
- Monthly distribution %s and targets

**Tab 4: "Assumptions"**
- SGA counts by month
- Lead list sizes
- Special rate adjustments
- Any locked rate values with their annotations

**Tab 5: "Override Log"**
- Flat table of all overrides: Cell, Original Value, Override Value, Reason, User, Date
- Exported from `forecast_overrides` table

For each tab, specify:
- Exact row/column layout (use cell references like A1, B2, etc.)
- Which cells contain formulas vs. static values
- Formatting rules (bold, colors, number formats)
- Any named ranges that would make cross-tab formulas work

Keep the layout practical — this needs to be readable by finance and leadership, not just engineers.
```

### Answer

Based on the forecast data model (Phase 6.2) and the formula requirements (Phase 2.2), here is the complete multi-tab workbook layout.

---

### Tab 1: "Forecast Summary"

**Purpose:** High-level view of the entire quarterly forecast. Mirrors the Google Sheet's summary zone (rows 56-103). Consumed by leadership and finance.

**Layout:**

```
     A                  B              C           D           E          F          G          H          I          J          K          L
1    Savvy Wealth Q2 2026 Forecast                                                              Export Date: 2026-04-15
2    Status: Active | Created by: jane@savvy.com | Last updated: 2026-04-15                     Trailing 90-day rates as of: 2026-04-15
3
4    Channel            Sub-Source     Q2 Fcst     Apr Fcst    Apr Act    Apr Var    May Fcst   May Act    May Var    Jun Fcst   Jun Act    Jun Var
5    ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
6    TOTAL FORECAST SQOs               =C7+C22+C37+C47+C52+C57+C62  (sum of all channel SQO rows)
7    Outbound           (all)          =SUM(C8:C9)  =SUM(D8:D9)  =SUM(E8:E9)  =F7  ...
8                       PLL            ='Ch-Outbound'!C12  ='Ch-Outbound'!D12  ='Ch-Outbound'!E12  =E8-D8  ...
9                       LinkedIn SS    ='Ch-Outbound'!C26  ='Ch-Outbound'!D26  ='Ch-Outbound'!E26  =E9-D9  ...
10                      Fintrx         ='Ch-Outbound'!C40  ='Ch-Outbound'!D40  ='Ch-Outbound'!E40  =E10-D10 ...
11   (repeat for each sub-source...)
...
23   Marketing          (all)          =SUM(C24:C29)  ...
24                      Direct Traffic ='Ch-Marketing'!C12  ...
25                      Job Applications ='Ch-Marketing'!C26  ...
...
37   Inbound            (all)          ...
...
47   Advisor Referral   (all)          ...
52   Partnerships       (all)          ...
57   Re-Engagement      (all)          ...
62   Other              (all)          ...
```

**Cell types:**
- Row 1-2: Static metadata (text)
- Row 4: Headers (bold, frozen)
- Column A-B: Channel/sub-source labels (static text, bold for channel names)
- Column C (Q2 Fcst): **Formula** — `=SUM(D_row, G_row, J_row)` (sum of 3 months)
- Column D, G, J (Monthly Fcst): **Formula** — cross-tab reference to Channel Detail tab
- Column E, H, K (Monthly Act): **Formula** — cross-tab reference to Channel Detail tab
- Column F, I, L (Variance): **Formula** — `=E_row - D_row`

**Formatting:**
- Freeze row 4 + columns A-B
- Bold channel names, gray background on channel total rows
- Number format: `#,##0` for volumes
- Variance columns: green fill if > 0, red fill if < 0 (conditional formatting)
- Row 6 (Total): bold, larger font, top border

**Named ranges:**
- `Total_Forecast_SQOs` → C6
- `Outbound_SQO_Q2` → C7
- `Marketing_SQO_Q2` → C22
- (etc. for each channel)

---

### Tab 2: "Ch-Outbound" (one tab per channel)

**Purpose:** Detailed waterfall for each channel, showing all sub-sources with full funnel stage breakdown. This is where the live waterfall formulas live.

**Layout for Outbound (3 sub-sources: PLL, LinkedIn SS, Fintrx):**

```
     A                       B                C           D           E          F          G          H          I
1    OUTBOUND — Channel Detail
2    Trailing 90-day rates as of: 2026-04-15
3
4    Sub-Source               Stage            Q2 Fcst     Apr Fcst    Apr Act    Apr Var    May Fcst   May Act    May Var ...
5    ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
6    Provided List (Lead Scoring)  Created     =SUM(D6,G6,J6)  =Assumptions!B3*Assumptions!B4   [actual]  =E6-D6
7                             Cr→Contacted     —           0.877                  —           0.877
8                             Contacted        =SUM(D8,...) =D6*D7      [actual]   =E8-D8     =G6*G7
9                             Cont→MQL         —           0.023                  —           0.023
10                            MQL              =SUM(D10,...) =D8*D9    [actual]    =E10-D10   =G8*G9
11                            MQL→SQL          —           0.480                  —           0.480
12                            SQL              =SUM(D12,...) =D10*D11  [actual]    =E12-D12   =G10*G11
13                            SQL→SQO          —           0.710                  —           0.710
14                            SQO              =SUM(D14,...) =D12*D13  [actual]    =E14-D14   =G12*G13
15                            SQO→Joined       —           0.150                  —           0.150
16                            Joined           =SUM(D16,...) =D14*D15  [actual]    =E16-D16   =G14*G15
17                            Override?        —           [Y/N]                              [Y/N]
18
19   LinkedIn (Self Sourced)  Created          =SUM(D19,...) =Assumptions!B5*Assumptions!B6  ...
20                            ... (same pattern, rows 19-30)
...
32   Fintrx (Self-Sourced)   Created          =SUM(D32,...) [input]    ...
33                            ... (same pattern, rows 32-43)
...
44   CHANNEL TOTALS           SQO              =D14+D27+D41  ...       ...         ...
45                            Joined           =D16+D29+D43  ...       ...         ...
```

**Cell types:**
- Volume rows (Created, Contacted, MQL, SQL, SQO, Joined): **Formula** — waterfall `=prev_stage × rate`
- Rate rows (Cr→Contacted, Cont→MQL, etc.): **Static value** — editable number, formatted as `%`
- Override indicator row: **Static** — `Y` or `N` (or blank)
- Actual columns: **Static value** — populated from BQ actuals data
- Variance columns: **Formula** — `=Actual - Forecast`
- Q2 Fcst column: **Formula** — `=SUM(Apr, May, Jun)`

**Formatting:**
- Rate rows: light gray background, percentage format (`0.0%`)
- Volume rows: white background, number format (`#,##0`)
- Override indicator: yellow background if `Y`
- Overridden rate cells: yellow fill + cell note with override details
- Channel totals row: bold, top border
- Sub-source headers: bold

**Cell notes (for overridden cells):**
```
Override by jane@savvy.com on 2026-04-10
Original (calculated): 0.480
Override value: 0.520
Reason: LinkedIn campaign ramp expected to improve MQL conversion
```

**Repeat for each channel:** `Ch-Marketing`, `Ch-OutboundMarketing`, `Ch-AdvisorReferral`, `Ch-Partnerships`, `Ch-ReEngagement`, `Ch-Other`

---

### Tab 3: "Targets & Gap Analysis"

**Purpose:** Finance minimums, gap tracking, and monthly distribution. Mirrors the P:W zone in the Google Sheet.

**Layout:**

```
     A                  B              C              D              E
1    TARGETS & GAP ANALYSIS
2
3    Channel            Finance Min    Forecast       Gap            Gap Filler
4    ═══════════════════════════════════════════════════════════════════════
5    Outbound           85             =Summary!C7    =B5-C5         [input]
6    Marketing          30             =Summary!C22   =B6-C6         [input]
7    Inbound            20             =Summary!C37   =B7-C7         [input]
8    Advisor Referral   15             =Summary!C47   =B8-C8         [input]
9    Partnerships       10             =Summary!C52   =B9-C9         [input]
10   Re-Engagement      5              =Summary!C57   =B10-C10       [input]
11   Other              5              =Summary!C62   =B11-C11       [input]
12   ─────────────────────────────────────────────────────────────────────
13   TOTAL              =SUM(B5:B11)   =SUM(C5:C11)   =SUM(D5:D11)   =SUM(E5:E11)
14
15
16   MONTHLY DISTRIBUTION
17   Month              Weight %       Target SQOs    Actual SQOs    Variance
18   April              0.333          =B13*B18       [actual]       =D18-C18
19   May                0.333          =B13*B19       [actual]       =D19-C19
20   June               0.334          =B13*B20       [actual]       =D20-C20
```

**Cell types:**
- Finance Min (B): Static input values
- Forecast (C): **Formula** — cross-tab reference to Summary
- Gap (D): **Formula** — `=B-C`
- Gap Filler (E): Static input values
- Weight % (B18-20): Static input (editable)
- Target SQOs (C18-20): **Formula** — `=Total × Weight`

**Formatting:**
- Gap column: red fill if > 0 (behind target), green if ≤ 0 (ahead)
- Totals row: bold, double top border

---

### Tab 4: "Assumptions"

**Purpose:** Input assumptions that drive the forecast model. Referenced by Channel Detail tabs.

**Layout:**

```
     A                          B              C
1    FORECAST ASSUMPTIONS
2
3    # Ramped SGAs (PLL)        12
4    Lead List Size (PLL)       150
5    # Ramped SGAs (LinkedIn)   8
6    Lead List Size (LinkedIn)  100
7    # Ramped SGAs (Fintrx)     4
8    Lead List Size (Fintrx)    50
9
10   SQO→Joined Rate            0.15           Source: SGM Conversion & Velocity (trailing)
9
10   MONTHLY DISTRIBUTION
11   April Weight               0.333
12   May Weight                 0.333
13   June Weight                0.334
14
15   RATE METHODOLOGY
16   Source                     Trailing 90-day resolved rates
17   Lookback Window            [today-120d, today-30d] for Cont→MQL; [today-90d, today] for others
18   Rate Date                  2026-04-15
```

**Cell types:** All static values. No formulas — this tab is pure input.

**Named ranges:**
- `PLL_SGAs` → B3
- `PLL_ListSize` → B4
- `LinkedIn_SGAs` → B5
- `LinkedIn_ListSize` → B6
- `Fintrx_SGAs` → B7
- `Fintrx_ListSize` → B8
- `SQO_Joined_Rate` → B10

---

### Tab 5: "Override Log"

**Purpose:** Flat audit trail of all overrides. Exported from `forecast_overrides` table.

**Layout:**

```
     A              B              C                D                 E              F              G
1    Override Log
2
3    Channel        Sub-Source     Cell             Original Value    Override Value  Reason         User            Date
4    Outbound       PLL            Apr MQL→SQL Rate 0.480             0.520          LinkedIn ramp  jane@savvy.com  2026-04-10
5    Marketing      Job Applications  May Created   40                55             Job fair boost  john@savvy.com  2026-04-12
...
```

**Cell types:** All static values. This is a read-only audit trail.

**Formatting:**
- Headers: bold, freeze row 3
- Alternating row colors for readability
- Date column: date format (`YYYY-MM-DD`)

---

**Dynamic tab generation note:** The number of Channel Detail tabs (Tab 2) depends on how many channels have non-zero forecasts. The code should dynamically create one tab per channel with non-zero data. The Summary tab formulas and named ranges must be generated to match the actual tabs created.

---

### 3.2 — Formula Portability Check

**Prompt for Claude Code:**
```
Take the formula map from 2.2 and the layout from 3.1 and verify:

1. **Excel compatibility**: Will all proposed formulas work in both Excel (.xlsx) and Google Sheets? Flag any that are Sheets-only or Excel-only.

2. **Cross-tab references**: If Tab 1 (Summary) needs to reference Tab 2 (Channel Detail), what's the formula syntax?
   - Excel: `='Channel Detail - Outbound'!D12`
   - Google Sheets: same syntax, but sheet names with spaces need single quotes

3. **Conditional formatting portability**: Can conditional formatting rules (green/red for variance) be written programmatically and work in both Excel and Sheets?

4. **Cell comments**: Can override annotations be written as cell comments/notes? What's the library support?
   - exceljs: `cell.note = { texts: [...] }` — YES, supports rich text notes
   - sheetjs: Limited comment support
   - Google Sheets API: `spreadsheets.batchUpdate` with `UpdateCellsRequest` for notes

5. **Named ranges**: Can we define named ranges (e.g., `Outbound_SQO_Forecast`) to make formulas more readable? What's the library support?

6. **Data validation**: Can we add dropdown validation for certain cells (e.g., a dropdown for "Live Rate" vs "Locked Rate")? What's the library support?

Document any limitations or gotchas for the recommended approach.
```

### Answer

**Since we're using Google Sheets API directly (Approach B), portability to Excel is NOT a concern.** The export creates a native Google Sheet — all formulas are Google Sheets formulas. However, users may download the Sheet as .xlsx, so let's verify compatibility.

**1. Excel Compatibility of All Proposed Formulas:**

| Formula | Google Sheets | Excel (.xlsx download) | Notes |
|---------|:---:|:---:|-------|
| `=D4*D5` (multiplication) | ✅ | ✅ | Universal |
| `=SUM(D4,G4,J4)` | ✅ | ✅ | Universal |
| `=E4-D4` (subtraction) | ✅ | ✅ | Universal |
| `=IF(D4=0,"",E4/D4-1)` | ✅ | ✅ | Universal |
| `=SUM(D8:D9)` (range sum) | ✅ | ✅ | Universal |
| `=IFERROR(A1/B1,0)` | ✅ | ✅ | Universal |
| `=COUNTIFS(...)` | ✅ | ✅ | Universal |

**All proposed formulas use basic arithmetic and standard functions.** No Sheets-only functions (like `GOOGLEFINANCE`, `IMPORTRANGE`, `QUERY`, `FILTER`, `ARRAYFORMULA`) are needed. Every formula will work if downloaded as .xlsx and opened in Excel.

**2. Cross-Tab References:**

Syntax in both Google Sheets and Excel:
```
='Ch-Outbound'!D12
```

- Sheet names with spaces, hyphens, or special characters must be wrapped in single quotes
- Tab names should avoid characters that cause issues: `/`, `\`, `*`, `?`, `[`, `]`
- Our proposed tab names (`Ch-Outbound`, `Forecast Summary`, `Targets & Gap Analysis`, etc.) use hyphens and ampersands — both are fine in single quotes
- **Recommendation:** Use simple tab names to avoid edge cases. `Ch-Outbound` is safe. `Targets & Gap Analysis` has `&` which is fine when quoted.

Cross-tab formula example:
```
=SUM('Ch-Outbound'!D14, 'Ch-Outbound'!D28)
```
This works identically in Google Sheets and Excel.

**3. Conditional Formatting Portability:**

Google Sheets API conditional formatting is set via `spreadsheets.batchUpdate`:
```typescript
addConditionalFormatRule: {
  rule: {
    ranges: [{ sheetId, startRowIndex, endRowIndex, startColumnIndex, endColumnIndex }],
    booleanRule: {
      condition: { type: 'NUMBER_LESS', values: [{ userEnteredValue: '0' }] },
      format: { backgroundColor: { red: 1, green: 0.8, blue: 0.8 } }
    }
  }
}
```

- ✅ Works natively in Google Sheets (this is the native API)
- ⚠️ When downloaded as .xlsx, conditional formatting rules are **partially preserved**. Simple rules (number comparison, text contains) translate well. Complex rules (custom formula-based) may not survive the conversion.
- **Recommendation:** Use simple condition types (`NUMBER_GREATER_THAN`, `NUMBER_LESS_THAN`, `TEXT_CONTAINS`) which translate cleanly. Avoid `CUSTOM_FORMULA`-based conditional formatting rules for maximum portability.

**4. Cell Comments/Notes:**

| Feature | Google Sheets API | Library Support | Excel Download |
|---------|:-:|:-:|:-:|
| Cell notes (simple text) | ✅ `updateCells` with `note` field | Native API | ✅ Converts to Excel comments |
| Threaded comments | ✅ Separate Comments API | Requires Drive API | ⚠️ Threaded structure lost |

**Recommendation:** Use **cell notes** (not threaded comments) for override annotations. They're simpler to write via the API and survive .xlsx download.

Example:
```typescript
{
  updateCells: {
    rows: [{ values: [{ note: "Override: 0.48 → 0.52\nBy: jane@savvy.com\nReason: Campaign ramp" }] }],
    fields: 'note',
    start: { sheetId: tabId, rowIndex: row, columnIndex: col }
  }
}
```

**5. Named Ranges:**

| Feature | Google Sheets API | Excel Download |
|---------|:-:|:-:|
| Define named range | ✅ `addNamedRange` request | ✅ Preserved in .xlsx |
| Use in formulas | ✅ `=Total_Forecast_SQOs` | ✅ Works in Excel |
| Cross-sheet named ranges | ✅ | ✅ |

Named ranges are fully supported via `spreadsheets.batchUpdate`:
```typescript
{
  addNamedRange: {
    namedRange: {
      name: 'Outbound_SQO_Apr',
      range: { sheetId: outboundTabId, startRowIndex: 13, endRowIndex: 14, startColumnIndex: 3, endColumnIndex: 4 }
    }
  }
}
```

**Recommendation:** Use named ranges for all cross-tab formula references. They make formulas more readable and survive .xlsx download.

**6. Data Validation (Dropdowns):**

| Feature | Google Sheets API | Excel Download |
|---------|:-:|:-:|
| Dropdown list | ✅ `setDataValidation` | ✅ Preserved |
| Custom validation formula | ✅ | ⚠️ May not translate |

Example — dropdown for rate mode:
```typescript
{
  setDataValidation: {
    range: { sheetId: tabId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 16, endColumnIndex: 17 },
    rule: {
      condition: { type: 'ONE_OF_LIST', values: [{ userEnteredValue: 'Live Rate' }, { userEnteredValue: 'Locked Rate' }] },
      showCustomUi: true,
      strict: true
    }
  }
}
```

**Recommendation:** Use simple `ONE_OF_LIST` validation for the Override indicator column. Avoid formula-based validation for portability.

---

**Summary of Limitations/Gotchas:**

1. **No gotchas for the core formula export.** All waterfall formulas, cross-tab references, SUM aggregations, and variance calculations use universal functions that work everywhere.
2. **Conditional formatting:** Stick to simple numeric/text conditions. Avoid `CUSTOM_FORMULA` conditions.
3. **Cell notes:** Use notes (not threaded comments) for override annotations — they're API-simple and portable.
4. **Named ranges:** Fully supported and recommended for readability.
5. **Template tab pre-formatting:** Headers, column widths, freeze panes, bold styling, etc. should be set in the template spreadsheet (not generated via API) where possible, to reduce API calls and ensure consistent appearance.
6. **API rate limits:** The Sheets API has a 60 requests/minute/user limit. For a forecast with 7 channels × 25 sub-sources, we need to batch requests efficiently. Use `spreadsheets.batchUpdate` (single call with multiple requests) rather than individual API calls per cell.

---

## Phase 4: Implementation Recommendation

### 4.1 — Architecture Decision

**Prompt for Claude Code:**
```
Based on everything explored in Phases 1-3, write the implementation recommendation:

1. **Recommended approach** (A: .xlsx download, B: Google Sheets API, or C: Hybrid) with justification

2. **Library/tool choice** with version and key capabilities

3. **Where the export logic lives**: 
   - Client-side (browser generates the file) vs. server-side (API route generates it)?
   - If server-side, what's the API route structure? (e.g., `POST /api/forecast/export`)
   - What data does the export endpoint need? (forecast ID, date range, include actuals?, etc.)

4. **Implementation effort estimate**:
   - How much of the existing export code can be reused?
   - What new code needs to be written?
   - Rough estimate: small (1-2 days), medium (3-5 days), large (1-2 weeks)?

5. **Integration with forecasting feature**:
   - Where does the "Export to Sheets" button go in the forecast UI?
   - Does the export happen on-demand or can it be scheduled?
   - Should the export be read-only (snapshot) or should changes in the Sheet sync back to the dashboard? (Recommendation: read-only snapshot — two-way sync is a massive complexity increase)

6. **Dependencies and prerequisites**:
   - Does this need to be built after the core forecasting feature, or can parts be built in parallel?
   - Are there any auth/permissions requirements?

Write this as an actionable spec that an engineer could pick up and implement.
```

### Answer

## Implementation Recommendation: Forecast Google Sheets Export

### 1. Recommended Approach

**Approach B: Google Sheets API — extend the existing pattern.**

Justification:
- The dashboard already has a working Google Sheets export via the exact same API (`googleapis` v170.0.0)
- Auth infrastructure (service account, Apps Script web app, sharing) is production-ready
- The API natively supports formulas via `valueInputOption: 'USER_ENTERED'` — already proven in the Validation tab
- Full formatting support via `spreadsheets.batchUpdate` — conditional formatting, cell notes, named ranges, data validation
- Zero new dependencies required
- Consistent UX with the existing "Export to Sheets" flow

### 2. Library/Tool Choice

| Component | Library | Version | Key Capability |
|-----------|---------|---------|----------------|
| Sheets API | `googleapis` | v170.0.0 (already installed) | Read/write values, formulas, formatting |
| Auth | `google-auth-library` (bundled in googleapis) | — | Service account JWT |
| Template management | Google Apps Script web app | Already deployed | Template copy, Drive folder, sharing |

No new npm packages needed.

### 3. Where the Export Logic Lives

**Server-side API route.** Same pattern as the existing export.

**New API route:** `POST /api/forecast/export`

```
Request body:
{
  forecastId: string,       // UUID of the forecast to export
  includeActuals: boolean,  // Whether to include actuals columns (default: true)
  includeOverrideLog: boolean, // Whether to include Override Log tab (default: true)
}

Response:
{
  success: boolean,
  spreadsheetId: string,
  spreadsheetUrl: string,
}
```

**Export flow:**
1. Auth + permission check (same as `export-sheets/route.ts`)
2. Fetch forecast data from Neon: `forecasts`, `forecast_line_items`, `forecast_rate_items`, `forecast_overrides`, `forecast_assumptions`, `forecast_targets`
3. Fetch current actuals from BQ (reuse existing dashboard queries)
4. Call Apps Script web app to copy the forecast template → get new spreadsheet ID
5. Create channel detail tabs dynamically (one per channel with non-zero data)
6. Populate each tab with formulas + static values using `spreadsheets.values.update`
7. Apply formatting, conditional formatting, cell notes, named ranges via `spreadsheets.batchUpdate`
8. Return spreadsheet URL

**New class:** `ForecastSheetsExporter` in `src/lib/sheets/forecast-sheets-exporter.ts`

```typescript
export class ForecastSheetsExporter {
  // Reuses the same auth pattern as GoogleSheetsExporter

  async exportForecast(forecast: ForecastData): Promise<SheetsExportResult> {
    const spreadsheetId = await this.copyTemplate(forecast);
    await this.createChannelTabs(spreadsheetId, forecast.channels);
    await this.populateSummaryTab(spreadsheetId, forecast);
    for (const channel of forecast.channels) {
      await this.populateChannelTab(spreadsheetId, channel);
    }
    await this.populateTargetsTab(spreadsheetId, forecast.targets);
    await this.populateAssumptionsTab(spreadsheetId, forecast.assumptions);
    await this.populateOverrideLogTab(spreadsheetId, forecast.overrides);
    await this.applyFormatting(spreadsheetId, forecast);
    await this.addNamedRanges(spreadsheetId, forecast);
    return { success: true, spreadsheetId, spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` };
  }

  // Key method: generates waterfall formulas for a channel detail tab
  private buildWaterfallFormulas(subSource: SubSourceData, startRow: number): CellValue[][] {
    // Rate cells: static values from forecast_rate_items.final_rate
    // Volume cells: formulas like `=D${startRow}*D${startRow+1}`
    // Quarterly cells: `=SUM(D${row},G${row},J${row})`
    // Variance cells: `=E${row}-D${row}`
  }
}
```

### 4. Implementation Effort

| Task | Effort | Dependencies |
|------|--------|-------------|
| Create Google Sheets template (manual) | 3 hours | None |
| `ForecastSheetsExporter` class — core structure, auth, template copy | 0.5 day | Template ready |
| Formula generation — waterfall formulas, cross-tab refs, aggregations | 1.5 days | Schema finalized |
| Tab population — Summary, Channel Details (×N), Targets, Assumptions, Override Log | 1.5 days | Formula gen |
| Formatting — conditional formatting, cell notes, named ranges | 1 day | Tab population |
| API route `POST /api/forecast/export` — auth, data fetching, orchestration | 0.5 day | Exporter class |
| UI — `ExportForecastButton` component + integration into forecast page | 0.5 day | API route |
| Testing — verify formulas work, formatting renders, edge cases | 1 day | All above |
| **Total** | **~6-7 days** | |

**Reusable from existing codebase (~30%):**
- Auth pattern (`GoogleSheetsExporter.getAuthClient()`)
- Template copy pattern (`copyTemplate()`)
- Chunked writing (`writeInChunks()`)
- API route structure (`export-sheets/route.ts` — auth, permissions, error handling)
- UI button pattern (`ExportToSheetsButton` component)

### 5. Integration with Forecasting Feature

**Export button placement:** On the forecast detail page (where users view/edit a specific quarterly forecast). Add an "Export to Sheets" button in the page header, next to existing actions (Save, Lock, etc.).

**On-demand only.** No scheduled exports — the exported Sheet is a **read-only snapshot** at the time of export. This is critical:
- **No two-way sync.** Changes in the Google Sheet do NOT sync back to the dashboard.
- The Sheet is a "frozen" view with live formulas that reference each other WITHIN the sheet, but no live connection to the dashboard database.
- Users can edit rate values in the Sheet to do "what-if" analysis without affecting the dashboard.
- The export includes a timestamp and "snapshot as of" label to make this clear.

**Re-export:** Users can re-export at any time to get a fresh snapshot. Each export creates a new Google Sheet.

### 6. Dependencies and Prerequisites

| Prerequisite | Status | Blocking? |
|-------------|--------|-----------|
| Core forecasting feature (CRUD, forecast model, Neon schema) | Not started | YES — export needs data to export |
| Google Sheets API auth | ✅ Production-ready | No |
| Apps Script web app | ✅ Deployed | No — needs a new template ID for forecast exports |
| Forecast template spreadsheet (manual creation in Google Drive) | Not started | YES — needed before export code |
| `googleapis` package | ✅ v170.0.0 installed | No |

**Can parts be built in parallel?**
- ✅ The Google Sheets template can be designed/created while the core forecasting backend is being built
- ✅ The `ForecastSheetsExporter` class structure and formula generation logic can be built once the schema is finalized (Phase 6.2), even before the Neon tables are populated
- ❌ The API route and end-to-end testing require the core forecast CRUD to be working

**Auth/permissions:**
- Reuse existing `canExport` permission check
- Same role restrictions as the funnel export (block recruiters, capital partners)
- Consider adding a `canExportForecast` permission if forecast data should have tighter access control

---

### 4.2 — Relationship to `forecasting_exploration.md`

**Prompt for Claude Code:**
```
Read `C:\Users\russe\Documents\Dashboard\forecasting_exploration.md` (specifically Phase 7.1 — Feature Specification and the Migration Path in Appendix C.8).

Based on this export exploration:
1. Where does the Sheets export feature fit in the migration path (v1, v2, or v3)?
2. Does anything in the proposed Neon schema (Phase 6.2) need to change to support the export?
3. Does the BQ sync format need to align with the Sheets export format, or are they independent?
4. Should the export feature be documented as an addendum to `forecasting_exploration.md`, or kept as a separate spec?

Write a brief recommendation for how to integrate these findings into the main forecasting spec.
```

### Answer

Based on `forecasting_exploration.md` Phase 7.1 (Migration Path) and Appendix C.8 (Scope & Priority):

**1. Where does Sheets export fit in the migration path?**

**v1 (MVP).** The export should ship with v1, not deferred to v2/v3.

Reasoning from the spec:
- v1's #1 priority is "eliminate the manual forecast creation/update process" (Appendix C.8)
- The current workflow IS the Google Sheet — leadership and finance consume the forecast AS a spreadsheet
- If v1 doesn't export to Sheets, users lose their primary consumption format. They'd have to view the forecast only in the dashboard UI, which is a regression for non-dashboard-power-users (finance, board)
- The export is a **read-only snapshot** that lets non-technical stakeholders consume the forecast in their familiar format while the dashboard becomes the source of truth for editing
- v3 mentions "Export to BQ (fully replace the Google Apps Script pipeline)" — that's the BQ sync, not the Sheets export. These are different features.

**Recommendation:** Include Sheets export in v1 as the final phase, after core CRUD + waterfall calculation + override system are working. It's the bridge that makes v1 viable for the full audience (not just RevOps).

**2. Does anything in the Neon schema need to change?**

**No.** The proposed schema (Phase 6.2) already has everything the export needs:

| Export Tab | Data Source (Neon Table) |
|-----------|------------------------|
| Forecast Summary | `forecast_line_items` (aggregated) + `forecasts` metadata |
| Channel Detail | `forecast_line_items` + `forecast_rate_items` (volumes + rates by channel/source/month/stage) |
| Targets & Gap Analysis | `forecast_targets` |
| Assumptions | `forecast_assumptions` |
| Override Log | `forecast_overrides` (who/when/why audit trail) |
| Actuals columns | BQ `vw_funnel_master` via existing dashboard queries (not stored in Neon for export — fetched live) |

The `forecast_overrides` table already stores `original_value`, `override_value`, `reason`, `overridden_by`, `overridden_at` — exactly what's needed for cell notes and the Override Log tab.

One minor addition that would help: a `is_locked` boolean on `forecast_rate_items` to distinguish "live rate" (auto-updates from trailing 90-day) vs. "locked rate" (manual override). This is already implied by the presence of an override record but having an explicit flag would simplify the export query. This is already part of the Appendix C.2 spec ("toggle between live and locked") so it's likely in the schema design.

**3. Does the BQ sync format need to align with the Sheets export format?**

**Independent.** They serve different purposes:

| Feature | BQ Sync | Sheets Export |
|---------|---------|---------------|
| Purpose | Feed `vw_daily_forecast` for downstream Tableau/scorecards | Human-readable snapshot for leadership/finance |
| Format | Flat table matching `q4_2025_forecast` structure | Multi-tab workbook with formulas |
| Frequency | Daily automated sync | On-demand user action |
| Data model | Denormalized rows (channel, source, stage, month, value) | Hierarchical tabs with waterfall formulas |
| Consumers | BQ views, Tableau, scorecards | Humans (finance, board, leadership) |

The BQ sync (Appendix C.7) needs to output rows compatible with the existing `q4_2025_forecast` table structure. The Sheets export is a completely separate rendering of the same underlying data. They can be built independently.

**4. Should this be an addendum or separate spec?**

**Keep as a separate spec**, referenced from `forecasting_exploration.md`.

Reasoning:
- `forecasting_exploration.md` is already ~2000+ lines and covers the core data model, methodology, and feature spec
- The Sheets export is an output format / delivery mechanism, not a core data model concern
- This document (`sheets_export_exploration.md`) is self-contained with its own phases, layout design, and formula map
- Cross-reference: Add a note in `forecasting_exploration.md` Phase 7.1 (Migration Path, v1) pointing to this document

**Recommended addition to `forecasting_exploration.md`:**

In Phase 7.1, v1 section, add:
```
- Google Sheets export with live waterfall formulas (see `sheets_export_exploration.md` for full spec)
  - Exports a read-only snapshot as a native Google Sheet
  - Includes: Forecast Summary, Channel Detail tabs (with formulas), Targets, Assumptions, Override Log
  - Uses the existing Google Sheets API infrastructure (googleapis + Apps Script web app)
  - Estimated effort: 6-7 days (after core CRUD is working)
```

---

*Document completed. All phases (1.1–4.2) populated with findings from codebase analysis and cross-referenced with `forecasting_exploration.md`.*

---

## Appendix: Q2 Forecast Sheet Changes Log (2026-03-12)

The following changes were made to the Q2 forecast Google Sheet (`1JjmBA-z4yzD-iGLhrf_XTuHdBSgtQjeU1ih9c5-ujFc`, tab `Q2 forecast`) and are reflected in the layout examples above:

### Source Taxonomy Changes
| Change | Old | New | Reason |
|--------|-----|-----|--------|
| Rename | Provided Lead List (Lead Scoring) | Provided List (Lead Scoring) | Align with BQ `Final_Source__c` name |
| Replace | Ashby | Job Applications | BQ has 0 records under "Ashby"; 775+ under "Job Applications" |
| Replace | Advisor Waitlist | Direct Traffic | Advisor Waitlist had 0 BQ records; Direct Traffic promoted to PRIMARY |
| Add | *(new)* | Fintrx (Self-Sourced) | New Outbound PRIMARY source (1,817 prospects since 2025) |
| Promote | Direct Traffic (was SUB) | Direct Traffic (now PRIMARY) | 1,140 prospects, good MQL→SQL pipeline |
| Promote | Provided List (Marketing) (was SUB) | Provided List (Marketing) (now PRIMARY) | 1,562 prospects, O+M channel |

### BQ View Changes
- **`vw_channel_funnel_volume_by_month`**: Deployed with deterministic 1:1 `Original_source → Finance_View` CASE mapping (eliminates multi-Finance_View inflation bug)
- **`vw_channel_conversion_rates_pivoted`**: Deployed with same CASE mapping + cohorted resolution-based rates (30-day timeout)

### Data Tab Refreshes
| Tab | Rows | Columns | Cells |
|-----|------|---------|-------|
| Volumes | 372 | 19 | 7,068 |
| monthly_conversion_rates | 373 | 34 | 12,682 |

### Row Shift
- Inserting 13 rows for Fintrx (Self-Sourced) at row 133 shifted all subsequent source blocks down by +13 rows
- SUMIFS rollup formulas (rows 56–103) use column A matching, so they auto-captured the new block after column A was filled

### Finance_View Groups (BQ-backed)
| Finance_View | Sub-Sources |
|-------------|-------------|
| Outbound | Provided List (Lead Scoring), LinkedIn (Self Sourced), Fintrx (Self-Sourced) |
| Marketing | Direct Traffic, Job Applications, Google Ads + LinkedIn Ads, LinkedIn Savvy, Blog, Google Ads, LinkedIn Ads |
| Outbound + Marketing | Events, Provided List (Marketing) |
| Re-Engagement | Re-Engagement |
| Partnerships | Recruitment Firm |
| Advisor Referrals | Advisor Referral |
| Other | Other, Unknown |
