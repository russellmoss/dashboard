import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { getSqoLagAuditTrail, AUDIT_TRAIL_COLUMNS } from '@/lib/queries/sqo-lag-export';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const EXPORT_FOLDER_ID = '1rmmgf2rQ_VULLhKsC1jGdtaOc2QTrBgi';

// --- Helpers copied from forecast export route ---

function getGoogleClients() {
  let credentials: any;

  if (process.env.GOOGLE_SHEETS_CREDENTIALS_JSON) {
    try {
      const raw = process.env.GOOGLE_SHEETS_CREDENTIALS_JSON
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '');
      credentials = JSON.parse(raw);
    } catch (error) {
      throw new Error('Failed to parse GOOGLE_SHEETS_CREDENTIALS_JSON: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  } else if (process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_PATH) {
    const credPath = path.resolve(process.cwd(), process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_PATH);
    if (fs.existsSync(credPath)) {
      try {
        credentials = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
      } catch (error) {
        throw new Error(`Failed to read credentials from ${credPath}: ` + (error instanceof Error ? error.message : 'Unknown error'));
      }
    } else {
      throw new Error(`Credentials file not found at: ${credPath}`);
    }
  } else {
    throw new Error('Google Sheets credentials not found. Set GOOGLE_SHEETS_CREDENTIALS_JSON (Vercel) or GOOGLE_SHEETS_SERVICE_ACCOUNT_PATH (local)');
  }

  if (!credentials?.client_email || !credentials?.private_key) {
    throw new Error('Invalid credentials: missing client_email or private_key');
  }

  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
  });

  return {
    sheets: google.sheets({ version: 'v4', auth }),
    drive: google.drive({ version: 'v3', auth }),
  };
}

function sanitizeCell(val: any): string | number | boolean {
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') {
    if ('value' in val && typeof val.value === 'string') return val.value;
    return JSON.stringify(val);
  }
  return val;
}

function sanitizeRows(values: any[][]): (string | number | boolean)[][] {
  return values.map(row => row.map(sanitizeCell));
}

async function writeTab(
  sheets: any,
  spreadsheetId: string,
  tabName: string,
  values: any[][]
): Promise<void> {
  const clean = sanitizeRows(values);
  const CHUNK_SIZE = 500;
  const requiredRows = clean.length;

  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties(sheetId,title,gridProperties(rowCount)))',
  });
  const sheet = meta.data.sheets?.find(
    (s: any) => s.properties?.title === tabName
  );
  let sheetId = sheet?.properties?.sheetId;
  const currentRows = sheet?.properties?.gridProperties?.rowCount ?? 1000;

  if (sheetId == null) {
    const addResp = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          addSheet: {
            properties: {
              title: tabName,
              gridProperties: { rowCount: Math.max(requiredRows + 100, 1000) },
            },
          },
        }],
      },
    });
    sheetId = addResp.data.replies?.[0]?.addSheet?.properties?.sheetId;
  }

  if (sheetId != null && requiredRows > currentRows) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          updateSheetProperties: {
            properties: {
              sheetId,
              gridProperties: { rowCount: requiredRows + 100 },
            },
            fields: 'gridProperties.rowCount',
          },
        }],
      },
    });
  }

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `'${tabName}'!A:AZ`,
  });
  for (let i = 0; i < clean.length; i += CHUNK_SIZE) {
    const chunk = clean.slice(i, i + CHUNK_SIZE);
    const startRow = i + 1;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${tabName}'!A${startRow}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: chunk },
    });
  }
}

// --- Column references from AUDIT_TRAIL_COLUMNS ---

function col(key: string): string {
  const entry = AUDIT_TRAIL_COLUMNS.find(c => c.key === key);
  if (!entry) throw new Error(`Unknown column key: ${key}`);
  return entry.col;
}

const AT = "'BQ Audit Trail'"; // tab name for formula references

// --- Summary tab builders ---

interface CohortConfig {
  tabName: string;
  cohortColKey: string;       // key in AUDIT_TRAIL_COLUMNS for cohort filter
  cohortLabel: string;        // display label for the cohort
  cohortWindow: string;       // e.g. "Apr 2024 – Mar 2026 (2yr)"
  dateRange: string;          // e.g. "Apr 2024 – present"
  namedRangePrefix: string;   // e.g. "TwoYr"
  isTrailing?: boolean;       // if true, add the caution warning
}

const COHORT_CONFIGS: CohortConfig[] = [
  {
    tabName: '2yr Cohort',
    cohortColKey: 'in_2yr_cohort',
    cohortLabel: '2-Year Cohort',
    cohortWindow: 'SQOs created in the last 2 years, maturity-gated per bucket',
    dateRange: 'Apr 2024 \u2013 present',
    namedRangePrefix: 'TwoYr',
  },
  {
    tabName: '1yr Cohort',
    cohortColKey: 'in_1yr_cohort',
    cohortLabel: '1-Year Cohort',
    cohortWindow: 'SQOs created in the last 1 year, maturity-gated per bucket',
    dateRange: 'Apr 2025 \u2013 present',
    namedRangePrefix: 'OneYr',
  },
  {
    tabName: 'Recent Mature (180d)',
    cohortColKey: 'in_recent_mature',
    cohortLabel: 'Recent Mature Cohort',
    cohortWindow: 'SQOs created in the last 1 year, aged 180+ days',
    dateRange: 'Apr 2025 \u2013 Oct 2025, aged 180+ days',
    namedRangePrefix: 'Recent',
  },
  {
    tabName: 'Trailing 180d (Caution)',
    cohortColKey: 'in_trailing_180d',
    cohortLabel: 'Trailing 180d Cohort',
    cohortWindow: 'SQOs created in the last 180 days, NO maturity gating',
    dateRange: 'last 180 days, NOT maturity-gated',
    namedRangePrefix: 'Trailing',
    isTrailing: true,
  },
];

const LAG_BUCKETS = [
  { label: '0-30 days', maxDay: 30, denomKey: 'in_signed_denom_30d' },
  { label: '31-60 days', maxDay: 60, denomKey: 'in_signed_denom_60d' },
  { label: '61-90 days', maxDay: 90, denomKey: 'in_signed_denom_90d' },
  { label: '91-120 days', maxDay: 120, denomKey: 'in_signed_denom_120d' },
  { label: '121-150 days', maxDay: 150, denomKey: 'in_signed_denom_150d' },
  { label: '151-180 days', maxDay: 180, denomKey: 'in_signed_denom_180d' },
  { label: '180+ days', maxDay: null, denomKey: 'in_signed_denom_180d' },
];

const CUMULATIVE_THRESHOLDS = [
  { day: 30, denomKey: 'in_signed_denom_30d' },
  { day: 60, denomKey: 'in_signed_denom_60d' },
  { day: 90, denomKey: 'in_signed_denom_90d' },
  { day: 120, denomKey: 'in_signed_denom_120d' },
  { day: 150, denomKey: 'in_signed_denom_150d' },
  { day: 180, denomKey: 'in_signed_denom_180d' },
];

const PLANNING_TARGETS = [5, 10, 15, 20, 30];

/**
 * Build a summary tab's 2D values array.
 * Returns { values, rateRows } where rateRows lists the 0-indexed row numbers
 * containing rate formulas (for percentage formatting).
 * Also returns namedRangeRows for the 90d and 120d cumulative rate cells.
 */
function buildSummaryTab(config: CohortConfig): {
  values: any[][];
  rateRows: number[];
  dispositionRateRows: number[];
  planningModelRateRows: { row: number; col: number }[];
  namedRanges: { name: string; row: number; colIndex: number }[];
} {
  const cc = col(config.cohortColKey); // cohort column letter
  const rows: any[][] = [];
  const rateRows: number[] = [];           // col D (index 3) — Tables 1 & 2
  const dispositionRateRows: number[] = []; // cols B-E (indices 1-4) — Table 0
  const planningModelRateRows: { row: number; col: number }[] = []; // mixed cols
  const namedRanges: { name: string; row: number; colIndex: number }[] = [];

  // Helper: push row, return its 0-indexed row number
  const push = (row: any[]) => { rows.push(row); return rows.length - 1; };

  const dr = config.dateRange; // shorthand for date range

  // Row 1: Header
  push([`SQO-to-Close Lag Distribution \u2014 ${config.cohortLabel} (${dr})`, '', '', 'Generated:', '=TODAY()']);
  // Row 2: Summary line (placeholder — backfilled after disposition table is built)
  const summaryRowIdx = push(['']);
  // Row 3: blank
  push([]);
  // Row 4: Methodology
  push(['Methodology: docs/analyses/2026-04-01-sqo-to-close-lag-distribution/analysis-plan.md']);
  // Row 5: blank
  push([]);

  // --- Table 0: Disposition Table ---
  push([`How did SQOs resolve within each time window? \u2014 ${dr}`]);
  push(['Closed Won = reached Signed stage. Overall Closed = Closed Lost + Closed Won. Remaining = still open or in earlier stages (does not sum to 100%).']);
  push(['Time Bucket', 'Closed Lost %', 'Closed Won (Signed) %', 'Closed Won (Joined) %', 'Overall Closed %']);

  const closedLostBucketCol = col('closed_lost_lag_bucket');
  const signedBucketColRef = col('signed_lag_bucket');
  const joinedBucketColRef = col('joined_lag_bucket');

  for (const bucket of LAG_BUCKETS) {
    const denomCol = col(bucket.denomKey);
    const r = rows.length + 1;
    const denomBase = `COUNTIFS(${AT}!${cc}2:${cc}9999,1,${AT}!${denomCol}2:${denomCol}9999,1)`;
    const closedLostFormula = `=IFERROR(COUNTIFS(${AT}!${cc}2:${cc}9999,1,${AT}!${denomCol}2:${denomCol}9999,1,${AT}!${closedLostBucketCol}2:${closedLostBucketCol}9999,"${bucket.label}")/${denomBase},"—")`;
    const closedWonSignedFormula = `=IFERROR(COUNTIFS(${AT}!${cc}2:${cc}9999,1,${AT}!${denomCol}2:${denomCol}9999,1,${AT}!${signedBucketColRef}2:${signedBucketColRef}9999,"${bucket.label}")/${denomBase},"—")`;
    const closedWonJoinedFormula = `=IFERROR(COUNTIFS(${AT}!${cc}2:${cc}9999,1,${AT}!${denomCol}2:${denomCol}9999,1,${AT}!${joinedBucketColRef}2:${joinedBucketColRef}9999,"${bucket.label}")/${denomBase},"—")`;
    const overallClosedFormula = `=IFERROR((COUNTIFS(${AT}!${cc}2:${cc}9999,1,${AT}!${denomCol}2:${denomCol}9999,1,${AT}!${closedLostBucketCol}2:${closedLostBucketCol}9999,"${bucket.label}")+COUNTIFS(${AT}!${cc}2:${cc}9999,1,${AT}!${denomCol}2:${denomCol}9999,1,${AT}!${signedBucketColRef}2:${signedBucketColRef}9999,"${bucket.label}"))/${denomBase},"—")`;
    const rowIdx = push([bucket.label, closedLostFormula, closedWonSignedFormula, closedWonJoinedFormula, overallClosedFormula]);
    dispositionRateRows.push(rowIdx);
  }

  // Backfill summary line with formulas referencing disposition table cells
  // dispositionRateRows: [0-30d, 31-60d, 61-90d, 91-120d, 121-150d, 151-180d, 180+d]
  // X = Overall Closed % (col E) for first 3 rows (0-30d + 31-60d + 61-90d)
  // Y = Closed Won Signed % (col C) for last 4 rows (91-120d + 121-150d + 151-180d + 180+d)
  const xRows = dispositionRateRows.slice(0, 3).map(r => `E${r + 1}`).join('+');
  const yRows = dispositionRateRows.slice(3).map(r => `C${r + 1}`).join('+');
  const summaryPrefix = config.isTrailing
    ? '\u26A0\uFE0F CAUTION (immature cohort): '
    : '';
  rows[summaryRowIdx] = [
    `="${summaryPrefix}"&TEXT(${xRows},"0%")&" of SQOs that resolved did so within 90 days of becoming an SQO. Only "&TEXT(${yRows},"0%")&" signed after day 90."`
  ];

  push([]); // blank row

  // --- Two-Step Planning Model ---
  const convertedSignedColPM = col('converted_to_signed');
  const signedBucketColPM = col('signed_lag_bucket');

  // Step 1: Headline Close Rate
  push([`Two-Step Planning Model (${dr})`]);
  push([]);
  push(['Step 1: Headline Close Rate']);
  const closeRateRow = rows.length + 1; // 1-indexed
  push([
    'Overall Signed Close Rate:',
    `=IFERROR(COUNTIFS(${AT}!${cc}2:${cc}9999,1,${AT}!${convertedSignedColPM}2:${convertedSignedColPM}9999,1)/COUNTIFS(${AT}!${cc}2:${cc}9999,1),"\u2014")`,
    '',
    `="Of every 100 SQOs created, roughly "&TEXT(B${closeRateRow}*100,"0")&" will eventually sign."`,
  ]);
  planningModelRateRows.push({ row: rows.length - 1, col: 1 }); // format col B as percentage

  push([]);

  // Step 2: Timing Distribution
  push([`Of the deals that signed, when did they sign? (${dr})`]);
  push(['Use this to spread your expected signed deals across time periods.']);
  push(['Time Bucket', 'Signed in Window', '% of All Signed Deals']);

  const timingPctRows: number[] = [];
  const TIMING_BUCKETS = [
    '0-30 days', '31-60 days', '61-90 days', '91-120 days',
    '121-150 days', '151-180 days', '180+ days',
  ];

  for (const bucketLabel of TIMING_BUCKETS) {
    const r = rows.length + 1;
    const signedInWindow = `=COUNTIFS(${AT}!${cc}2:${cc}9999,1,${AT}!${signedBucketColPM}2:${signedBucketColPM}9999,"${bucketLabel}")`;
    const pctFormula = `=IFERROR(COUNTIFS(${AT}!${cc}2:${cc}9999,1,${AT}!${signedBucketColPM}2:${signedBucketColPM}9999,"${bucketLabel}")/COUNTIFS(${AT}!${cc}2:${cc}9999,1,${AT}!${convertedSignedColPM}2:${convertedSignedColPM}9999,1),"\u2014")`;
    const rowIdx = push([bucketLabel, signedInWindow, pctFormula]);
    timingPctRows.push(rowIdx);
  }

  // Totals row
  const firstPctRow = timingPctRows[0] + 1; // 1-indexed
  const lastPctRow = timingPctRows[timingPctRows.length - 1] + 1;
  push([
    'Total',
    `=COUNTIFS(${AT}!${cc}2:${cc}9999,1,${AT}!${convertedSignedColPM}2:${convertedSignedColPM}9999,1)`,
    `=IFERROR(SUM(C${firstPctRow}:C${lastPctRow}),"\u2014")`,
  ]);
  timingPctRows.push(rows.length - 1); // format totals row too

  // Track timing % rows for percentage formatting (col C = index 2)
  for (const rowIdx of timingPctRows) {
    planningModelRateRows.push({ row: rowIdx, col: 2 });
  }

  push([]);
  push(['How to read this:', 'Step 1 tells you how many signed deals to expect from a given SQO count. Step 2 tells you when to expect them. Example: 100 SQOs in April at a 12% close rate = 12 expected signed deals. If 42% of signed deals close in the first 30 days, expect roughly 5 of those in May.']);
  push([]); // blank row

  // --- Table 1: Discrete Lag Buckets (Signed) ---
  push([`What % of SQOs converted IN each time window? \u2014 SIGNED (${dr})`]);
  push(['Lag Bucket', 'SQOs in Denominator', 'Converted in Window', '% of Mature SQOs']);

  for (const bucket of LAG_BUCKETS) {
    const denomCol = col(bucket.denomKey);
    const signedBucketCol = col('signed_lag_bucket');
    const r = rows.length + 1; // 1-indexed row for formula
    const denomFormula = `=COUNTIFS(${AT}!${cc}2:${cc}9999,1,${AT}!${denomCol}2:${denomCol}9999,1)`;
    const convertedFormula = `=COUNTIFS(${AT}!${cc}2:${cc}9999,1,${AT}!${denomCol}2:${denomCol}9999,1,${AT}!${signedBucketCol}2:${signedBucketCol}9999,"${bucket.label}")`;
    const rateFormula = `=IFERROR(C${r}/B${r},"—")`;
    const rowIdx = push([bucket.label, denomFormula, convertedFormula, rateFormula]);
    rateRows.push(rowIdx);
  }

  push([]); // blank row

  // --- Table 1: Discrete Lag Buckets (Joined) ---
  push([`What % of SQOs converted IN each time window? \u2014 JOINED (${dr})`]);
  push(['Lag Bucket', 'SQOs in Denominator', 'Converted in Window', '% of Mature SQOs']);

  for (const bucket of LAG_BUCKETS) {
    const denomCol = col(bucket.denomKey);
    const joinedBucketCol = col('joined_lag_bucket');
    const r = rows.length + 1;
    const denomFormula = `=COUNTIFS(${AT}!${cc}2:${cc}9999,1,${AT}!${denomCol}2:${denomCol}9999,1)`;
    const convertedFormula = `=COUNTIFS(${AT}!${cc}2:${cc}9999,1,${AT}!${denomCol}2:${denomCol}9999,1,${AT}!${joinedBucketCol}2:${joinedBucketCol}9999,"${bucket.label}")`;
    const rateFormula = `=IFERROR(C${r}/B${r},"—")`;
    const rowIdx = push([bucket.label, denomFormula, convertedFormula, rateFormula]);
    rateRows.push(rowIdx);
  }

  push([]); // blank row

  // --- Table 2: Cumulative Conversion (Signed) ---
  push([`What % of SQOs have converted BY each time threshold? \u2014 SIGNED (${dr})`]);
  push(['By Day', 'SQOs in Denominator', 'Cumulative Converted', 'Cumulative Rate']);

  const signedDaysCol = col('days_to_signed');
  const convertedSignedCol = col('converted_to_signed');

  for (const t of CUMULATIVE_THRESHOLDS) {
    const denomCol = col(t.denomKey);
    const r = rows.length + 1;
    const denomFormula = `=COUNTIFS(${AT}!${cc}2:${cc}9999,1,${AT}!${denomCol}2:${denomCol}9999,1)`;
    const convertedFormula = `=COUNTIFS(${AT}!${cc}2:${cc}9999,1,${AT}!${denomCol}2:${denomCol}9999,1,${AT}!${convertedSignedCol}2:${convertedSignedCol}9999,1,${AT}!${signedDaysCol}2:${signedDaysCol}9999,"<>",${AT}!${signedDaysCol}2:${signedDaysCol}9999,"<="&${t.day})`;
    const rateFormula = `=IFERROR(C${r}/B${r},"—")`;
    const rowIdx = push([`By day ${t.day}`, denomFormula, convertedFormula, rateFormula]);
    rateRows.push(rowIdx);

    // Named ranges for 90d and 120d
    if (t.day === 90) {
      namedRanges.push({ name: `${config.namedRangePrefix}_Signed_90d_Rate`, row: rowIdx, colIndex: 3 });
    } else if (t.day === 120) {
      namedRanges.push({ name: `${config.namedRangePrefix}_Signed_120d_Rate`, row: rowIdx, colIndex: 3 });
    }
  }

  push([]); // blank row

  // --- Table 2: Cumulative Conversion (Joined) ---
  push([`What % of SQOs have converted BY each time threshold? \u2014 JOINED (${dr})`]);
  push(['By Day', 'SQOs in Denominator', 'Cumulative Converted', 'Cumulative Rate']);

  const joinedDaysCol = col('days_to_joined');
  const convertedJoinedCol = col('converted_to_joined');

  for (const t of CUMULATIVE_THRESHOLDS) {
    const denomCol = col(t.denomKey);
    const r = rows.length + 1;
    const denomFormula = `=COUNTIFS(${AT}!${cc}2:${cc}9999,1,${AT}!${denomCol}2:${denomCol}9999,1)`;
    const convertedFormula = `=COUNTIFS(${AT}!${cc}2:${cc}9999,1,${AT}!${denomCol}2:${denomCol}9999,1,${AT}!${convertedJoinedCol}2:${convertedJoinedCol}9999,1,${AT}!${joinedDaysCol}2:${joinedDaysCol}9999,"<>",${AT}!${joinedDaysCol}2:${joinedDaysCol}9999,"<="&${t.day})`;
    const rateFormula = `=IFERROR(C${r}/B${r},"—")`;
    const rowIdx = push([`By day ${t.day}`, denomFormula, convertedFormula, rateFormula]);
    rateRows.push(rowIdx);

    if (t.day === 90) {
      namedRanges.push({ name: `${config.namedRangePrefix}_Joined_90d_Rate`, row: rowIdx, colIndex: 3 });
    } else if (t.day === 120) {
      namedRanges.push({ name: `${config.namedRangePrefix}_Joined_120d_Rate`, row: rowIdx, colIndex: 3 });
    }
  }

  push([]); // blank row

  // --- Table 3: Planning Back-Calculator (Signed) ---
  push([`How many SQOs do we need to hit a given target? \u2014 SIGNED (${dr})`]);
  push(['Target Advisors', 'SQOs Needed (90d rate)', 'SQOs Needed (120d rate)', '90d Rate Used', '120d Rate Used']);

  const signedRate90 = `${config.namedRangePrefix}_Signed_90d_Rate`;
  const signedRate120 = `${config.namedRangePrefix}_Signed_120d_Rate`;

  for (const target of PLANNING_TARGETS) {
    const r = rows.length + 1;
    push([
      target,
      `=IFERROR(A${r}/${signedRate90},"—")`,
      `=IFERROR(A${r}/${signedRate120},"—")`,
      `=${signedRate90}`,
      `=${signedRate120}`,
    ]);
  }

  push([]); // blank row

  // --- Table 3: Planning Back-Calculator (Joined) ---
  push([`How many SQOs do we need to hit a given target? \u2014 JOINED (${dr})`]);
  push(['Target Advisors', 'SQOs Needed (90d rate)', 'SQOs Needed (120d rate)', '90d Rate Used', '120d Rate Used']);

  const joinedRate90 = `${config.namedRangePrefix}_Joined_90d_Rate`;
  const joinedRate120 = `${config.namedRangePrefix}_Joined_120d_Rate`;

  for (const target of PLANNING_TARGETS) {
    const r = rows.length + 1;
    push([
      target,
      `=IFERROR(A${r}/${joinedRate90},"—")`,
      `=IFERROR(A${r}/${joinedRate120},"—")`,
      `=${joinedRate90}`,
      `=${joinedRate120}`,
    ]);
  }

  push([]); // blank row
  push([]); // blank row

  // --- Notes Section ---
  push(['— NOTES —']);
  push([]);

  // Trailing 180d caution warning (first note for this tab only)
  if (config.isTrailing) {
    push(['\u26A0\uFE0F WARNING: Rates in this tab are intentionally deflated. Recently created SQOs have not had sufficient time to convert \u2014 a 60-day-old SQO that hasn\'t signed is not a failed conversion, it\'s just early. Do not use these rates for back-calculating SQO targets. Use the Recent Mature (180d) tab for planning. This tab exists to show current pipeline conversion progress only.']);
    push([]);
  }

  push(['Cohort Definition:', config.cohortWindow]);
  push([`Cohort N:`, `=COUNTIFS(${AT}!${cc}2:${cc}9999,1)`]);
  push([]);
  push(['Denominator Explanation:', 'Each bucket\'s denominator only includes SQOs old enough to have had a genuine opportunity to convert within that window. The denominator shrinks as the lag window grows \u2014 this is expected and correct.']);
  push([]);
  push(['Closed-Lost Treatment:', 'Closed-lost opportunities remain in the denominator and count as non-conversions. This is intentionally conservative for planning purposes.']);
  push([]);
  push(['\u26A0\uFE0F Gross vs Net Joined Caveat:', '\'Joined\' here means the advisor entered the Joined stage, including those who later churned to Closed Lost. The dashboard excludes those. Joined rates may be slightly lower if net-active joins are required. Resolve before using for headcount planning.']);
  push([]);
  push(['How to Read Planning Table:', 'Divide your target advisor count by the conversion rate to get the required SQO input. Use 90-day rate if SQOs will be created at the start of the quarter; use 120-day rate if you want a buffer.']);
  push([]);
  push(['Cohort Window:', config.cohortWindow]);
  push(['Generated:', '=TODAY()']);
  push(['Methodology:', 'docs/analyses/2026-04-01-sqo-to-close-lag-distribution/analysis-plan.md']);

  return { values: rows, rateRows, dispositionRateRows, planningModelRateRows, namedRanges };
}

// --- Main handler ---

export async function POST(request: NextRequest) {
  try {
    // 1. Auth gate (email-based)
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (session.user.email.toLowerCase() !== 'russell.moss@savvywealth.com') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    console.log('[SQO Lag Export] Starting export...');

    // 2. Run BQ query
    const auditRows = await getSqoLagAuditTrail();
    console.log(`[SQO Lag Export] Fetched ${auditRows.length} audit trail rows`);

    // 3. Create Google Sheet
    const { sheets, drive } = getGoogleClients();
    const userName = session.user.name || session.user.email || 'Unknown';
    const dateStr = new Date().toISOString().split('T')[0];
    const newName = `SQO Lag Distribution \u2014 ${dateStr} \u2014 ${userName}`;

    // Find or create per-user subfolder
    let userFolderId = EXPORT_FOLDER_ID;
    try {
      const folderName = userName;
      const folderSearch = await drive.files.list({
        q: `name='${folderName.replace(/'/g, "\\'")}' and '${EXPORT_FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id,name)',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      if (folderSearch.data.files && folderSearch.data.files.length > 0) {
        userFolderId = folderSearch.data.files[0].id!;
      } else {
        const folderResp = await drive.files.create({
          requestBody: {
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [EXPORT_FOLDER_ID],
          },
          supportsAllDrives: true,
        });
        userFolderId = folderResp.data.id!;
      }
    } catch (folderErr) {
      console.warn('[SQO Lag Export] Failed to create user folder, using root:', folderErr);
    }

    const createResp = await drive.files.create({
      requestBody: {
        name: newName,
        mimeType: 'application/vnd.google-apps.spreadsheet',
        parents: [userFolderId],
      },
      supportsAllDrives: true,
    });
    const newSheetId = createResp.data.id!;
    console.log(`[SQO Lag Export] Created spreadsheet: ${newSheetId}`);

    // Share with user
    try {
      await drive.permissions.create({
        fileId: newSheetId,
        requestBody: {
          type: 'user',
          role: 'writer',
          emailAddress: session.user.email,
        },
        supportsAllDrives: true,
        sendNotificationEmail: false,
      });
    } catch (shareErr) {
      console.warn('[SQO Lag Export] Failed to share:', shareErr);
    }

    // 4. Write BQ Audit Trail tab FIRST (referenced by all formulas)
    const headers = AUDIT_TRAIL_COLUMNS.map(c => c.header);
    const dataRows = auditRows.map(row =>
      AUDIT_TRAIL_COLUMNS.map(c => sanitizeCell(row[c.key]))
    );
    await writeTab(sheets, newSheetId, 'BQ Audit Trail', [headers, ...dataRows]);
    console.log('[SQO Lag Export] BQ Audit Trail tab written');

    // 5. Write 4 summary tabs with COUNTIFS formulas
    const allNamedRanges: { name: string; row: number; colIndex: number; tabName: string }[] = [];
    const allRateRanges: { tabName: string; rateRows: number[]; dispositionRateRows: number[]; planningModelRateRows: { row: number; col: number }[] }[] = [];

    for (const config of COHORT_CONFIGS) {
      const { values, rateRows, dispositionRateRows, planningModelRateRows, namedRanges } = buildSummaryTab(config);
      await writeTab(sheets, newSheetId, config.tabName, values);
      console.log(`[SQO Lag Export] ${config.tabName} tab written`);
      allNamedRanges.push(...namedRanges.map(nr => ({ ...nr, tabName: config.tabName })));
      allRateRanges.push({ tabName: config.tabName, rateRows, dispositionRateRows, planningModelRateRows });
    }

    // 6. Create 16 named ranges
    const sheetMeta = await sheets.spreadsheets.get({
      spreadsheetId: newSheetId,
      fields: 'sheets(properties(sheetId,title))',
    });
    const sheetMap = new Map<string, number>();
    for (const s of sheetMeta.data.sheets || []) {
      if (s.properties?.title && s.properties?.sheetId != null) {
        sheetMap.set(s.properties.title, s.properties.sheetId);
      }
    }

    const namedRangeRequests = allNamedRanges.map(nr => ({
      addNamedRange: {
        namedRange: {
          name: nr.name,
          range: {
            sheetId: sheetMap.get(nr.tabName),
            startRowIndex: nr.row,
            endRowIndex: nr.row + 1,
            startColumnIndex: nr.colIndex,
            endColumnIndex: nr.colIndex + 1,
          },
        },
      },
    }));

    // 7. Apply formatting (freeze, percentage, bold) in a single batchUpdate
    const formatRequests: any[] = [];

    // Freeze header row on BQ Audit Trail
    const auditSheetId = sheetMap.get('BQ Audit Trail');
    if (auditSheetId != null) {
      formatRequests.push({
        updateSheetProperties: {
          properties: {
            sheetId: auditSheetId,
            gridProperties: { frozenRowCount: 1 },
          },
          fields: 'gridProperties.frozenRowCount',
        },
      });
    }

    // Percentage format on rate cells for each summary tab
    for (const { tabName, rateRows, dispositionRateRows, planningModelRateRows } of allRateRanges) {
      const tabSheetId = sheetMap.get(tabName);
      if (tabSheetId == null) continue;

      // Table 1 & 2 rate cells: col D (index 3)
      for (const rowIdx of rateRows) {
        formatRequests.push({
          repeatCell: {
            range: {
              sheetId: tabSheetId,
              startRowIndex: rowIdx,
              endRowIndex: rowIdx + 1,
              startColumnIndex: 3,
              endColumnIndex: 4,
            },
            cell: {
              userEnteredFormat: {
                numberFormat: { type: 'PERCENT', pattern: '0.0%' },
              },
            },
            fields: 'userEnteredFormat.numberFormat',
          },
        });
      }

      // Table 0 disposition rate cells: cols B-E (indices 1-4)
      for (const rowIdx of dispositionRateRows) {
        formatRequests.push({
          repeatCell: {
            range: {
              sheetId: tabSheetId,
              startRowIndex: rowIdx,
              endRowIndex: rowIdx + 1,
              startColumnIndex: 1,
              endColumnIndex: 5,
            },
            cell: {
              userEnteredFormat: {
                numberFormat: { type: 'PERCENT', pattern: '0.0%' },
              },
            },
            fields: 'userEnteredFormat.numberFormat',
          },
        });
      }

      // Planning model rate cells: mixed columns
      for (const { row: rowIdx, col: colIdx } of planningModelRateRows) {
        formatRequests.push({
          repeatCell: {
            range: {
              sheetId: tabSheetId,
              startRowIndex: rowIdx,
              endRowIndex: rowIdx + 1,
              startColumnIndex: colIdx,
              endColumnIndex: colIdx + 1,
            },
            cell: {
              userEnteredFormat: {
                numberFormat: { type: 'PERCENT', pattern: '0.0%' },
              },
            },
            fields: 'userEnteredFormat.numberFormat',
          },
        });
      }
    }

    // Combine named range + formatting requests
    const batchRequests = [...namedRangeRequests, ...formatRequests];
    if (batchRequests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: newSheetId,
        requestBody: { requests: batchRequests },
      });
      console.log(`[SQO Lag Export] Created ${namedRangeRequests.length} named ranges, applied ${formatRequests.length} format rules`);
    }

    // 8. Reorder tabs to display order
    const displayOrder = [
      '2yr Cohort',
      '1yr Cohort',
      'Recent Mature (180d)',
      'Trailing 180d (Caution)',
      'BQ Audit Trail',
    ];
    const reorderRequests: any[] = [];
    for (let idx = 0; idx < displayOrder.length; idx++) {
      const sid = sheetMap.get(displayOrder[idx]);
      if (sid != null) {
        reorderRequests.push({
          updateSheetProperties: {
            properties: { sheetId: sid, index: idx },
            fields: 'index',
          },
        });
      }
    }

    // Delete the default "Sheet1" if it exists
    const sheet1Id = sheetMap.get('Sheet1');
    if (sheet1Id != null) {
      reorderRequests.push({ deleteSheet: { sheetId: sheet1Id } });
    }

    if (reorderRequests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: newSheetId,
        requestBody: { requests: reorderRequests },
      });
    }

    console.log('[SQO Lag Export] Export complete');

    // 9. Return result
    return NextResponse.json({
      success: true,
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${newSheetId}/edit`,
      spreadsheetName: newName,
    });
  } catch (error) {
    console.error('[SQO Lag Export] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Export failed' },
      { status: 500 }
    );
  }
}
