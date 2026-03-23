import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { getForecastExportP2, getForecastExportAudit } from '@/lib/queries/forecast-export';
import type { ForecastExportP2Row, ForecastExportAuditRow } from '@/lib/queries/forecast-export';

const TARGET_SHEET_ID = '1Iz9X6HY-bsAGBNkuQWH-SYoB7Xzy-9Hkg2Kk8ipxKQY';
const FORECAST_TAB = 'BQ Forecast P2';
const AUDIT_TAB = 'BQ Audit Trail';

// Auth pattern copied from src/lib/sheets/google-sheets-exporter.ts (lines 34-72)
function getSheetsClient() {
  let credentials: any;

  if (process.env.GOOGLE_SHEETS_CREDENTIALS_JSON) {
    try {
      // Sanitize: .env files may embed literal newlines in the private_key
      // which break JSON.parse. Replace them with escaped \\n first.
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
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  return google.sheets({ version: 'v4', auth });
}

// Sanitize a cell value for Sheets API: no nulls, no objects, no undefined
function sanitizeCell(val: any): string | number | boolean {
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') {
    // BigQuery TIMESTAMP/DATE comes as { value: "2026-01-01T..." }
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
  // Clear existing data first (overwrite, not append)
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

function buildP2Values(rows: ForecastExportP2Row[]): any[][] {
  const buildWorkings = (r: ForecastExportP2Row): string => {
    const rates: number[] = [];
    if (r.rate_sqo_to_sp != null) rates.push(r.rate_sqo_to_sp);
    if (r.rate_sp_to_neg != null) rates.push(r.rate_sp_to_neg);
    if (r.rate_neg_to_signed != null) rates.push(r.rate_neg_to_signed);
    if (r.rate_signed_to_joined != null) rates.push(r.rate_signed_to_joined);
    if (rates.length === 0) return r.p_join.toFixed(4);
    return rates.map(x => x.toFixed(2)).join(' \u00d7 ') + ' = ' + r.p_join.toFixed(4);
  };

  const headers = [
    'Opp ID', 'Advisor', 'SGM', 'SGA', 'Stage', 'Days in Stage',
    'Raw AUM', 'AUM ($M)', 'AUM Tier', 'Zero AUM',
    'Rate SQO\u2192SP', 'Rate SP\u2192Neg', 'Rate Neg\u2192Signed', 'Rate Signed\u2192Joined',
    'Stages Remaining', 'P(Join) Workings', 'P(Join)', 'Days Remaining',
    'Model Join Date', 'Anticipated Date', 'Final Join Date', 'Date Source',
    'Projected Quarter', 'Expected AUM',
  ];

  const dataRows = rows.map((r, i) => {
    const row = i + 2;
    return [
      r.Full_Opportunity_ID__c,
      r.advisor_name,
      r.SGM_Owner_Name__c || '',
      r.SGA_Owner_Name__c || '',
      r.StageName,
      r.days_in_current_stage,
      r.Opportunity_AUM,
      `=G${row}/1000000`,
      r.aum_tier,
      r.is_zero_aum ? 'YES' : 'NO',
      r.rate_sqo_to_sp ?? '',
      r.rate_sp_to_neg ?? '',
      r.rate_neg_to_signed ?? '',
      r.rate_signed_to_joined,
      r.stages_remaining,
      buildWorkings(r),
      `=IF(K${row}<>"",K${row},1)*IF(L${row}<>"",L${row},1)*IF(M${row}<>"",M${row},1)*N${row}`,
      r.expected_days_remaining,
      r.model_projected_join_date || '',
      r.Earliest_Anticipated_Start_Date__c || '',
      r.final_projected_join_date || '',
      r.date_source,
      r.projected_quarter || '',
      `=IF(AND(W${row}<>"",J${row}="NO"),G${row}*Q${row},0)`,
    ];
  });

  return [headers, ...dataRows];
}

function buildAuditValues(rows: ForecastExportAuditRow[]): any[][] {
  const headers = [
    'Opp ID', 'Salesforce URL', 'Advisor', 'Cohort Month', 'Created Date',
    'SGM', 'SGA', 'Source', 'Channel', 'Lead Type', 'SQO',
    'Date Became SQO', 'SP Entered (raw)', 'Neg Entered (raw)',
    'Signed Entered (raw)', 'Joined Entered (raw)', 'On Hold Entered',
    'Closed Entered', 'Join Date', 'Anticipated Start Date',
    'SP (backfilled)', 'Neg (backfilled)', 'Signed (backfilled)', 'Joined (backfilled)',
    'Days to SQO', 'Days in SP', 'Days in Neg', 'Days in Signed',
    'Days in Current Stage', 'Days SQO\u2192Joined',
    'Stage', 'Status', 'AUM ($M)', 'On Hold', 'Has Anticipated Date', 'Stages Skipped',
  ];

  const dataRows = rows.map((r, i) => {
    const row = i + 2;
    return [
      r.Full_Opportunity_ID__c,
      r.salesforce_url,
      r.advisor_name,
      r.cohort_month,
      r.Opp_CreatedDate,
      r.SGM_Owner_Name__c || '',
      r.SGA_Owner_Name__c || '',
      r.Original_source || '',
      r.Finance_View__c || '',
      r.lead_record_source || '',
      r.SQO_raw,
      r.Date_Became_SQO__c || '',
      r.Stage_Entered_Sales_Process__c || '',
      r.Stage_Entered_Negotiating__c || '',
      r.Stage_Entered_Signed__c || '',
      r.Stage_Entered_Joined__c || '',
      r.Stage_Entered_On_Hold__c || '',
      r.Stage_Entered_Closed__c || '',
      r.advisor_join_date__c || '',
      r.Earliest_Anticipated_Start_Date__c || '',
      r.eff_sp_ts || '',
      r.eff_neg_ts || '',
      r.eff_signed_ts || '',
      r.eff_joined_ts || '',
      `=IFERROR(DAYS(DATEVALUE(LEFT(L${row},10)),DATEVALUE(LEFT(E${row},10))),"")`,
      `=IFERROR(DAYS(DATEVALUE(LEFT(V${row},10)),DATEVALUE(LEFT(U${row},10))),"")`,
      `=IFERROR(DAYS(DATEVALUE(LEFT(W${row},10)),DATEVALUE(LEFT(V${row},10))),"")`,
      `=IFERROR(DAYS(DATEVALUE(LEFT(X${row},10)),DATEVALUE(LEFT(W${row},10))),"")`,
      r.days_in_current_stage ?? '',
      `=IFERROR(DAYS(DATEVALUE(LEFT(X${row},10)),DATEVALUE(LEFT(L${row},10))),"")`,
      r.StageName,
      r.Conversion_Status,
      r.Opportunity_AUM_M,
      r.is_on_hold ? 'YES' : 'NO',
      r.has_anticipated_date ? 'YES' : 'NO',
      r.stages_skipped,
    ];
  });

  return [headers, ...dataRows];
}

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const permissions = getSessionPermissions(session);
  if (!permissions || !permissions.allowedPages.includes(19)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const [p2Rows, auditRows] = await Promise.all([
      getForecastExportP2(),
      getForecastExportAudit(),
    ]);

    console.log(`[Forecast Export] P2 rows: ${p2Rows.length}, Audit rows: ${auditRows.length}`);

    const sheets = getSheetsClient();
    const p2Values = buildP2Values(p2Rows);
    const auditValues = buildAuditValues(auditRows);

    console.log(`[Forecast Export] P2 grid: ${p2Values.length} rows x ${p2Values[0]?.length || 0} cols`);
    console.log(`[Forecast Export] Audit grid: ${auditValues.length} rows x ${auditValues[0]?.length || 0} cols`);
    console.log(`[Forecast Export] P2 row 1 sample:`, JSON.stringify(p2Values[1]?.slice(0, 5)));
    console.log(`[Forecast Export] Audit row 1 sample:`, JSON.stringify(auditValues[1]?.slice(0, 5)));

    // Write sequentially to avoid race conditions
    await writeTab(sheets, TARGET_SHEET_ID, FORECAST_TAB, p2Values);
    console.log(`[Forecast Export] P2 tab written`);
    await writeTab(sheets, TARGET_SHEET_ID, AUDIT_TAB, auditValues);
    console.log(`[Forecast Export] Audit tab written`);

    return NextResponse.json({
      success: true,
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${TARGET_SHEET_ID}/edit#gid=194360408`,
      p2RowCount: p2Rows.length,
      auditRowCount: auditRows.length,
    });
  } catch (error) {
    console.error('Forecast export error:', error);
    return NextResponse.json(
      { error: 'Export failed', details: String(error) },
      { status: 500 }
    );
  }
}
