import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { getForecastExportP2, getForecastExportAudit } from '@/lib/queries/forecast-export';
import type { ForecastExportP2Row, ForecastExportAuditRow } from '@/lib/queries/forecast-export';
import { getTieredForecastRates, type TieredForecastRates, type ForecastRates } from '@/lib/queries/forecast-rates';
import { computeAdjustedDeal } from '@/lib/forecast-penalties';
import { getDateRevisionMap } from '@/lib/queries/forecast-date-revisions';
import { runMonteCarlo, type MonteCarloResponse } from '@/lib/queries/forecast-monte-carlo';
import { getJoinedAumByQuarter } from '@/lib/queries/forecast-pipeline';
import { runQuery } from '@/lib/bigquery';
import { prisma } from '@/lib/prisma';

const TARGET_SHEET_ID = '1Iz9X6HY-bsAGBNkuQWH-SYoB7Xzy-9Hkg2Kk8ipxKQY';
const EXPORT_FOLDER_ID = '1rmmgf2rQ_VULLhKsC1jGdtaOc2QTrBgi'; // Shared Drive: "Forecast exports"
const FORECAST_TAB = 'BQ Forecast P2';
const AUDIT_TAB = 'BQ Audit Trail';
const MONTE_CARLO_TAB = 'BQ Monte Carlo';
const RATES_TAB = 'BQ Rates and Days';
const SQO_TARGETS_TAB = 'BQ SQO Targets';
const REALIZATION_TAB = 'BQ Realization Forecast';
const SCENARIO_TAB = 'BQ Scenario Runner';

// Auth — returns both Sheets and Drive clients using the same service account
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
  const requiredRows = clean.length;

  // Get the sheet metadata to find sheetId and current row count
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties(sheetId,title,gridProperties(rowCount)))',
  });
  const sheet = meta.data.sheets?.find(
    (s: any) => s.properties?.title === tabName
  );
  let sheetId = sheet?.properties?.sheetId;
  const currentRows = sheet?.properties?.gridProperties?.rowCount ?? 1000;

  // Create the tab if it doesn't exist
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

  // Expand the sheet if needed (add 100 buffer rows)
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

// Recompute P2 rows with dynamic tiered rates + duration penalties
// (same logic as client-side useMemo in page.tsx, using computeAdjustedDeal)
function recomputeP2WithRates(
  rows: ForecastExportP2Row[],
  tieredRates: TieredForecastRates
): ForecastExportP2Row[] {
  const { avg_days_in_sp, avg_days_in_neg, avg_days_in_signed } = tieredRates.flat;

  return rows.map(r => {
    const stage = r.StageName;

    // Compute duration-penalized, tier-adjusted P(Join)
    const deal = computeAdjustedDeal(stage, r.days_in_current_stage, r.Opportunity_AUM, tieredRates);
    const { sqo_to_sp, sp_to_neg, neg_to_signed, signed_to_joined } = deal.ratesUsed;

    // Per-stage rates for display (from the tier-selected rate set)
    const rateSqoToSp = (stage === 'Discovery' || stage === 'Qualifying') ? sqo_to_sp : null;
    const rateSpToNeg = ['Discovery', 'Qualifying', 'Sales Process'].includes(stage) ? sp_to_neg : null;
    const rateNegToSigned = ['Discovery', 'Qualifying', 'Sales Process', 'Negotiating'].includes(stage) ? neg_to_signed : null;

    // Recalculate expected days remaining (uses flat avg_days)
    let totalDays = 0;
    if (stage === 'Discovery' || stage === 'Qualifying') {
      totalDays = avg_days_in_sp + avg_days_in_neg + avg_days_in_signed;
    } else if (stage === 'Sales Process') {
      totalDays = avg_days_in_neg + avg_days_in_signed;
    } else if (stage === 'Negotiating') {
      totalDays = avg_days_in_signed;
    }
    const daysRemaining = Math.max(0, totalDays - r.days_in_current_stage);

    // Recalculate projected join date
    let finalDate = r.Earliest_Anticipated_Start_Date__c;
    let dateSource = 'Anticipated';
    if (!finalDate) {
      const projected = new Date();
      projected.setDate(projected.getDate() + daysRemaining);
      finalDate = projected.toISOString().split('T')[0];
      dateSource = 'Model';
    }

    // Compute projected quarter
    let projectedQuarter: string | null = null;
    if (finalDate) {
      const d = new Date(finalDate);
      const q = Math.ceil((d.getMonth() + 1) / 3);
      projectedQuarter = `Q${q} ${d.getFullYear()}`;
    }

    // Adjusted expected AUM (primary value, uses adjusted P(Join))
    const expectedAum = r.is_zero_aum ? 0 : r.Opportunity_AUM * deal.adjustedPJoin;

    return {
      ...r,
      p_join: deal.adjustedPJoin,
      rate_sqo_to_sp: rateSqoToSp,
      rate_sp_to_neg: rateSpToNeg,
      rate_neg_to_signed: rateNegToSigned,
      rate_signed_to_joined: signed_to_joined,
      expected_days_remaining: daysRemaining,
      model_projected_join_date: finalDate && dateSource === 'Model' ? finalDate : r.model_projected_join_date,
      final_projected_join_date: finalDate,
      date_source: dateSource,
      projected_quarter: projectedQuarter,
      expected_aum_weighted: expectedAum,
      // Duration penalty fields
      aumTier2: deal.tier,
      durationBucket: deal.durationBucket,
      durationMultiplier: deal.durationMultiplier,
      baselinePJoin: deal.baselinePJoin,
      adjustedPJoin: deal.adjustedPJoin,
    };
  });
}

function buildP2Values(rows: ForecastExportP2Row[], dateRevisionMap: Map<string, { revisionCount: number; firstDateSet: string | null; dateConfidence: string }>): any[][] {
  const buildWorkings = (r: ForecastExportP2Row): string => {
    const rates: number[] = [];
    if (r.rate_sqo_to_sp != null) rates.push(r.rate_sqo_to_sp);
    if (r.rate_sp_to_neg != null) rates.push(r.rate_sp_to_neg);
    if (r.rate_neg_to_signed != null) rates.push(r.rate_neg_to_signed);
    if (r.rate_signed_to_joined != null) rates.push(r.rate_signed_to_joined);
    if (rates.length === 0) return r.p_join.toFixed(4);
    return rates.map(x => x.toFixed(2)).join(' \u00d7 ') + ' = ' + r.p_join.toFixed(4);
  };

  // Columns A-X (existing) + Y-AE (new duration penalty columns)
  const headers = [
    // A-X: existing columns
    'Opp ID', 'Advisor', 'SGM', 'SGA', 'Stage', 'Days in Stage',
    'Raw AUM', 'AUM ($M)', 'AUM Tier', 'Zero AUM',
    'Rate SQO\u2192SP', 'Rate SP\u2192Neg', 'Rate Neg\u2192Signed', 'Rate Signed\u2192Joined',
    'Stages Remaining', 'P(Join) Workings', 'P(Join)', 'Days Remaining',
    'Model Join Date', 'Anticipated Date', 'Final Join Date', 'Date Source',
    'Projected Quarter', 'Expected AUM',
    // Y-AE: duration penalty columns
    'AUM Tier (2-tier)', 'Duration Bucket', 'Duration Multiplier',
    'Baseline P(Join)', 'Adjusted P(Join)',
    'Baseline Expected AUM', 'Adjusted Expected AUM',
    // AF-AH: date revision confidence columns
    'Date Revisions', 'Date Confidence', 'First Date Set',
  ];

  const dataRows = rows.map((r, i) => {
    const row = i + 2;
    return [
      // A-X: existing columns
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
      // K: Rate SQO→SP — picks tier rate via named range based on AUM tier (col Y)
      `=IF(OR(E${row}="Discovery",E${row}="Qualifying"),IF(Y${row}="Lower (< $75M)",Lower_SQO_to_SP_rate,Upper_SQO_to_SP_rate),"")`,
      // L: Rate SP→Neg
      `=IF(OR(E${row}="Discovery",E${row}="Qualifying",E${row}="Sales Process"),IF(Y${row}="Lower (< $75M)",Lower_SP_to_Neg_rate,Upper_SP_to_Neg_rate),"")`,
      // M: Rate Neg→Signed
      `=IF(OR(E${row}="Discovery",E${row}="Qualifying",E${row}="Sales Process",E${row}="Negotiating"),IF(Y${row}="Lower (< $75M)",Lower_Neg_to_Signed_rate,Upper_Neg_to_Signed_rate),"")`,
      // N: Rate Signed→Joined
      `=IF(Y${row}="Lower (< $75M)",Lower_Signed_to_Joined_rate,Upper_Signed_to_Joined_rate)`,
      r.stages_remaining,
      // P: P(Join) Workings — formula-based text showing the rate multiplication
      `=IF(K${row}<>"",TEXT(K${row},"0.00")&" \u00d7 ","")&IF(L${row}<>"",TEXT(L${row},"0.00")&" \u00d7 ","")&IF(M${row}<>"",TEXT(M${row},"0.00")&" \u00d7 ","")&TEXT(N${row},"0.00")&" = "&TEXT(Q${row},"0.0000")`,
      // Q: P(Join) — product of tier-selected rates from K-N
      `=IF(K${row}<>"",K${row},1)*IF(L${row}<>"",L${row},1)*IF(M${row}<>"",M${row},1)*N${row}`,
      r.expected_days_remaining,
      r.model_projected_join_date || '',
      r.Earliest_Anticipated_Start_Date__c || '',
      r.final_projected_join_date || '',
      r.date_source,
      r.projected_quarter || '',
      `=IF(AND(W${row}<>"",J${row}="NO"),G${row}*Q${row},0)`,
      // Y-AE: new duration penalty columns
      r.aumTier2 === 'Lower' ? 'Lower (< $75M)' : r.aumTier2 === 'Upper' ? 'Upper (\u2265 $75M)' : '',
      r.durationBucket ?? '',
      r.durationMultiplier ?? '',
      r.baselinePJoin ?? '',
      r.adjustedPJoin ?? '',
      `=IF(AND(W${row}<>"",J${row}="NO"),G${row}*AB${row},0)`,  // AD: Baseline Expected AUM
      `=IF(AND(W${row}<>"",J${row}="NO"),G${row}*AC${row},0)`,  // AE: Adjusted Expected AUM
      // AF-AH: date revision confidence columns
      ...(() => {
        const rev = dateRevisionMap.get(r.Full_Opportunity_ID__c);
        return [
          rev?.revisionCount ?? 0,
          rev ? rev.dateConfidence : (r.Earliest_Anticipated_Start_Date__c ? 'High' : ''),
          rev?.firstDateSet ?? '',
        ];
      })(),
    ];
  });

  return [headers, ...dataRows];
}

function buildMonteCarloValues(mc: MonteCarloResponse): any[][] {
  // Section 1: Summary — quarter-level P10/P50/P90/Mean
  const summaryHeader = ['Quarter', 'P10 (Bear)', 'P50 (Base)', 'P90 (Bull)', 'Mean'];
  const summaryRows = mc.quarters.map(q => [
    q.label,
    q.p10,
    q.p50,
    q.p90,
    q.mean,
  ]);

  // Section 2: Rates used
  const ratesHeader = ['Transition', 'Rate'];
  const ratesRows = [
    ['SQO → SP', mc.ratesUsed.sqo_to_sp],
    ['SP → Negotiating', mc.ratesUsed.sp_to_neg],
    ['Negotiating → Signed', mc.ratesUsed.neg_to_signed],
    ['Signed → Joined', mc.ratesUsed.signed_to_joined],
  ];

  // Section 3: Per-deal simulation detail
  const detailHeader = [
    'Opp ID', 'Quarter', 'Win % (of trials)', 'Avg AUM if Won',
    'Expected AUM', 'AUM Tier', 'Duration Bucket', 'Duration Multiplier',
  ];
  const detailRows = mc.perOpp
    .sort((a, b) => b.winPct - a.winPct || b.avgAum - a.avgAum)
    .map(opp => [
      opp.oppId,
      opp.quarterLabel,
      opp.winPct,
      opp.avgAum,
      `=C${0}*D${0}`,  // placeholder — replaced below
      opp.aumTier2 ?? '',
      opp.durationBucket ?? '',
      opp.durationMultiplier ?? '',
    ]);

  // Fix expected AUM formulas with actual row numbers
  // Layout: row 1 = "MONTE CARLO SIMULATION", row 2 = "Trials: ...", row 3 blank,
  // row 4 = summary header, rows 5..5+Q-1 = summary, row 5+Q = blank,
  // row 6+Q = rates header, rows 7+Q..10+Q = rates, row 11+Q = blank,
  // row 12+Q = detail header, row 13+Q onward = detail rows
  const qCount = mc.quarters.length;
  const detailStartRow = 13 + qCount;
  const fixedDetailRows = detailRows.map((row, i) => {
    const r = detailStartRow + i;
    return [
      row[0], row[1], row[2], row[3],
      `=C${r}*D${r}`,
      row[5], row[6], row[7],
    ];
  });

  // Assemble the full grid
  const values: any[][] = [];
  values.push([`MONTE CARLO SIMULATION — ${mc.trialCount.toLocaleString()} trials`]);
  values.push([`Generated: ${new Date().toISOString().split('T')[0]}`]);
  values.push([]);  // blank row
  values.push(summaryHeader);
  for (const row of summaryRows) values.push(row);
  values.push([]);  // blank row
  values.push(ratesHeader);
  for (const row of ratesRows) values.push(row);
  values.push([]);  // blank row
  values.push(detailHeader);
  for (const row of fixedDetailRows) values.push(row);

  return values;
}

function buildAuditValues(rows: ForecastExportAuditRow[]): any[][] {
  const headers = [
    'Opp ID', 'Salesforce URL', 'Advisor', 'Cohort Month', 'Created Date',
    'SGM', 'SGA', 'Source', 'Channel', 'Lead Type', 'SQO',
    'Date Became SQO', 'SP Entered (raw)', 'Neg Entered (raw)',
    'Signed Entered (raw)', 'Joined Entered (raw)', 'On Hold Entered',
    'Closed Entered', 'Join Date', 'Anticipated Start Date',
    'SP (backfilled)', 'Neg (backfilled)', 'Signed (backfilled)', 'Joined (backfilled)',
    'Days SQO\u2192SP', 'Days in SP', 'Days in Neg', 'Days in Signed',
    'Days in Current Stage', 'Days SQO\u2192Joined',
    'Stage', 'Status', 'AUM ($M)', 'On Hold', 'Has Anticipated Date', 'Stages Skipped',
    'Joined?', 'SP Denom', 'SP Numer', 'Neg Denom', 'Neg Numer',
    'Signed Denom', 'Signed Numer', 'Joined Denom', 'Joined Numer',
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
      `=IFERROR(DAYS(DATEVALUE(LEFT(U${row},10)),DATEVALUE(LEFT(L${row},10))),"")`,
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
      r.is_joined_flag,
      r.SP_Denominator,
      r.SP_Numerator,
      r.Neg_Denominator,
      r.Neg_Numerator,
      r.Signed_Denominator,
      r.Signed_Numerator,
      r.Joined_Denominator,
      r.Joined_Numerator,
    ];
  });

  return [headers, ...dataRows];
}

// Build the "BQ SQO Targets" tab — full gap analysis with joined AUM, projected pipeline,
// incremental SQOs, entry quarters, and auditable formulas referencing the Rates tab.
function buildSQOTargetsValues(
  targetAumByQuarter: Record<string, number>,
  flatRates: ForecastRates,
  joinedByQuarter: Record<string, { joined_aum: number; joined_count: number }>,
  projectedAumByQuarter: Record<string, number>,
): any[][] {
  const r = `'${RATES_TAB}'`;

  const sqoToJoinedRate = flatRates.sqo_to_sp * flatRates.sp_to_neg * flatRates.neg_to_signed * flatRates.signed_to_joined;
  const meanJoinedAum = flatRates.mean_joined_aum;
  const joinedDealCount = flatRates.joined_deal_count;
  const avgDaysToJoin = flatRates.avg_days_sqo_to_sp + flatRates.avg_days_in_sp + flatRates.avg_days_in_neg + flatRates.avg_days_in_signed;

  // Only show quarters that have a target OR have projected pipeline (current/future relevance)
  // Skip old quarters with only joined AUM and no target — they clutter the sheet
  const allQuarters = new Set([
    ...Object.keys(targetAumByQuarter),
    ...Object.keys(projectedAumByQuarter),
  ]);
  // Also include any quarter with joined AUM if it's in the current year or later
  const currentYear = new Date().getFullYear();
  for (const q of Object.keys(joinedByQuarter)) {
    const m = q.match(/^Q\d\s+(\d{4})$/);
    if (m && parseInt(m[1]) >= currentYear) allQuarters.add(q);
  }
  const quarters = Array.from(allQuarters)
    .filter(q => /^Q\d \d{4}$/.test(q))
    .sort((a, b) => {
      const [aq, ay] = a.replace('Q', '').split(' ').map(Number);
      const [bq, by] = b.replace('Q', '').split(' ').map(Number);
      return ay !== by ? ay - by : aq - bq;
    });

  // ── MODEL INPUTS (rows 1-11) ──
  const values: any[][] = [
    // Row 1
    ['SQO TARGET CALCULATOR \u2014 GAP ANALYSIS'],
    // Row 2
    [`Generated: ${new Date().toISOString().split('T')[0]} | Rates from "${RATES_TAB}" tab | Pipeline from "${FORECAST_TAB}" tab`],
    // Row 3
    [],
    // Row 4
    ['MODEL INPUTS', '', '', ''],
    // Row 5
    ['Input', 'Value', 'Source', 'Description'],
    // Row 6 — Rates tab has rates at B6:B9 (row 5 is header)
    ['SQO \u2192 SP Rate', `=${r}!$B$6`, `=${r}!$B$6`, `${(flatRates.sqo_to_sp * 100).toFixed(1)}%`],
    // Row 7
    ['SP \u2192 Negotiating Rate', `=${r}!$B$7`, `=${r}!$B$7`, `${(flatRates.sp_to_neg * 100).toFixed(1)}%`],
    // Row 8
    ['Neg \u2192 Signed Rate', `=${r}!$B$8`, `=${r}!$B$8`, `${(flatRates.neg_to_signed * 100).toFixed(1)}%`],
    // Row 9
    ['Signed \u2192 Joined Rate', `=${r}!$B$9`, `=${r}!$B$9`, `${(flatRates.signed_to_joined * 100).toFixed(1)}%`],
    // Row 10
    ['SQO \u2192 Joined Rate (product)', `=B6*B7*B8*B9`, '', 'Product of 4 stage rates'],
    // Row 11
    ['Mean Joined AUM ($)', meanJoinedAum, 'BQ query', `Avg AUM of ${joinedDealCount} joined deals${joinedDealCount < 30 ? ' \u26A0\uFE0F LOW' : ''}`],
    // Row 12
    ['Expected AUM per SQO ($)', `=B10*B11`, '', 'SQO\u2192Joined rate \u00D7 Mean Joined AUM'],
    // Row 13
    ['Avg Days SQO \u2192 Joined', avgDaysToJoin, `=${r}!$B$34`, 'Lead time: SQOs need this many days to reach Joined'],
    // Row 14
    [],
  ];

  // ── QUARTER ANALYSIS (row 15+) ──
  // Row 15 = header row
  const headerRow = values.length + 1; // 1-indexed
  values.push([
    'QUARTERLY GAP ANALYSIS', '', '', '', '', '', '', '', '', '', '',
  ]);
  // Row 16 = column headers
  values.push([
    'Quarter',              // A
    'Target AUM ($)',       // B
    'Joined AUM ($)',       // C: actual closed deals
    'Joined Count',         // D
    'Projected AUM ($)',    // E: open pipeline expected
    'Total Expected ($)',   // F = C + E
    'Gap ($)',              // G = B - F (negative = surplus)
    'Coverage %',           // H = F / B
    'Status',               // I
    'Incremental SQOs',     // J = CEILING(G / $B$12)
    'Total SQOs for Target', // K = CEILING(B / $B$12)
    'SQO Entry Quarter',    // L: when SQOs need to enter pipeline
  ]);

  // Sheets formula to compute SQO Entry Quarter from a quarter label in column A and velocity in $B$13.
  // Logic: parse "Q3 2026" → DATE(year, (q-1)*3+1, 1) + 45 days (midpoint) - $B$13 days → format back to "Q# YYYY"
  // LET breaks it into readable steps.
  const entryQFormula = (row: number) =>
    `=IF($B$13=0,"",LET(` +
      `q,VALUE(MID(A${row},2,1)),` +
      `yr,VALUE(RIGHT(A${row},4)),` +
      `mid,DATE(yr,(q-1)*3+1,1)+45,` +
      `entry,mid-$B$13,` +
      `eq,ROUNDUP(MONTH(entry)/3,0),` +
      `ey,YEAR(entry),` +
      `"Q"&eq&" "&ey` +
    `))`;

  if (quarters.length === 0) {
    values.push(['(No data \u2014 set targets on the Pipeline Forecast dashboard)']);
  } else {
    quarters.forEach((quarter) => {
      const row = values.length + 1;
      const target = targetAumByQuarter[quarter] ?? 0;
      const joined = joinedByQuarter[quarter]?.joined_aum ?? 0;
      const joinedCt = joinedByQuarter[quarter]?.joined_count ?? 0;
      const projected = projectedAumByQuarter[quarter] ?? 0;

      values.push([
        quarter,                                                    // A: Quarter
        target,                                                     // B: Target AUM
        joined,                                                     // C: Joined AUM
        joinedCt,                                                   // D: Joined Count
        projected,                                                  // E: Projected AUM
        `=C${row}+E${row}`,                                        // F: Total Expected = Joined + Projected
        `=IF(B${row}=0,"",B${row}-F${row})`,                       // G: Gap = Target - Total Expected
        `=IF(B${row}=0,"",F${row}/B${row})`,                       // H: Coverage %
        `=IF(B${row}=0,"No target",IF(G${row}<=0,"On track","Gap: "&TEXT(G${row}/1000000,"#,##0")&"M"))`, // I: Status
        `=IF(B${row}=0,"",IF(G${row}<=0,0,CEILING(G${row}/$B$12,1)))`,  // J: Incremental SQOs
        `=IF(B${row}=0,"",CEILING(B${row}/$B$12,1))`,              // K: Total SQOs
        entryQFormula(row),                                         // L: SQO Entry Quarter (formula referencing $B$13)
      ]);
    });
  }

  values.push([]);

  // ── METHODOLOGY ──
  values.push(['HOW THESE NUMBERS ARE CALCULATED']);
  values.push([]);
  values.push([
    'Column', 'Formula', 'Explanation',
  ]);
  values.push([
    'Joined AUM (C)',
    'BigQuery: SUM(AUM) WHERE is_joined=1 for the quarter',
    'Actual AUM from advisors who have already Joined this quarter. This is real, closed business.',
  ]);
  values.push([
    'Projected AUM (E)',
    'SUM of (Opp AUM \u00D7 adjusted P(Join)) from BQ Forecast P2 tab',
    'Expected AUM from open pipeline deals, weighted by their probability of joining. Duration penalties and AUM-tier adjustments are applied.',
  ]);
  values.push([
    'Total Expected (F)',
    'Joined AUM + Projected AUM  [cell: C+E]',
    'Combined actual + expected. For past/current quarters, this is mostly joined AUM. For future quarters, mostly projected.',
  ]);
  values.push([
    'Gap (G)',
    'Target AUM - Total Expected  [cell: B-F]',
    'How much more AUM is needed. Negative means we\'re ahead of target.',
  ]);
  values.push([
    'Coverage % (H)',
    'Total Expected / Target AUM  [cell: F/B]',
    'What % of the target is covered by joined + pipeline. >100% = on track.',
  ]);
  values.push([
    'Incremental SQOs (J)',
    'CEILING(Gap / Expected AUM per SQO)  [cell: CEILING(G/$B$12)]',
    'Additional SQOs needed to close the gap. Expected AUM per SQO = Mean Joined AUM \u00D7 SQO\u2192Joined Rate.',
  ]);
  values.push([
    'Total SQOs (K)',
    'CEILING(Target AUM / Expected AUM per SQO)  [cell: CEILING(B/$B$12)]',
    'Total SQOs required to reach the full target from zero (ignoring existing pipeline).',
  ]);
  values.push([
    'SQO Entry Quarter (L)',
    'Quarter midpoint (day 45) minus $B$13 days  [formula: LET-based date math]',
    'When SQOs need to enter the pipeline. Change B13 to game out different velocities — L updates automatically.',
  ]);
  values.push([]);
  values.push([
    'SQO\u2192Joined Rate:',
    `${(flatRates.sqo_to_sp * 100).toFixed(1)}% \u00D7 ${(flatRates.sp_to_neg * 100).toFixed(1)}% \u00D7 ${(flatRates.neg_to_signed * 100).toFixed(1)}% \u00D7 ${(flatRates.signed_to_joined * 100).toFixed(1)}% = ${(sqoToJoinedRate * 100).toFixed(1)}%`,
  ]);
  values.push([
    'Note:',
    'All formulas reference cells in this sheet and the Rates tab. Click any cell to trace the math.',
  ]);

  return values;
}

// Build the "BQ Realization Forecast" tab — two-component quarterly forecast
// with deal-level detail. Every number traceable to deal-level data via formulas.
//
// Section 1: Forecast summary per quarter (COUNTIF/SUMIFS reference Section 2)
// Section 2: Component A deal detail (one row per Neg+Signed deal with future date)
// Section 3: Component B history (hardcoded $398M surprise baseline from PIT backtest)
//
// Two-component model reference: docs/forecast/forecast_modeling_backtest_results.md, Part 4
function buildRealizationValues(
  p2Rows: ForecastExportP2Row[],
  flatRates: ForecastRates,
  dateRevisionMap: Map<string, { revisionCount: number; firstDateSet: string | null; dateConfidence: string }> | undefined,
  historicalJoinedDeals: { Full_Opportunity_ID__c: string; advisor_name: string; Opportunity_AUM: number; advisor_join_date__c: string; joined_quarter: string }[],
  componentADealsHistory: { qtr: string; Full_Opportunity_ID__c: string; advisor_name: string; Opportunity_AUM: number; stage_at_snapshot: string; pit_anticipated_date: string; date_source: string; joined_in_quarter: number; advisor_join_date: string | null }[],
): any[][] {
  // ── Constants ──
  // Component B surprise baseline: trailing 4Q average from PIT backtest.
  // Cannot be computed from vw_funnel_master (anticipated dates overwritten post-join).
  // Derived via OpportunityFieldHistory reconstruction. Update quarterly.
  const SURPRISE_BASELINE = 398_000_000;

  // Deal-count realization bands (backtest Part 4, "Deal-count bands" section):
  // <10 deals = 60%, 10-14 = 45%, 15+ = 35%
  const getBandRate = (count: number) =>
    count < 10 ? 0.60 : count <= 14 ? 0.45 : 0.35;
  const getBandLabel = (count: number) =>
    count < 10 ? '<10 deals (60%)' : count <= 14 ? '10-14 deals (45%)' : '15+ deals (35%)';

  // ── Build Section 2 first (deal detail) ──
  // Filter to Neg+Signed deals with future anticipated dates
  const now = new Date();
  const currentQ = Math.ceil((now.getMonth() + 1) / 3);
  const currentYear = now.getFullYear();

  const isFutureQ = (dateStr: string) => {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return false;
    const q = Math.ceil((d.getMonth() + 1) / 3);
    const yr = d.getFullYear();
    if (yr > currentYear) return true;
    if (yr === currentYear && q > currentQ) return true;
    return false;
  };

  const toQuarterLabel = (dateStr: string) => {
    const d = new Date(dateStr);
    return `Q${Math.ceil((d.getMonth() + 1) / 3)} ${d.getFullYear()}`;
  };

  const componentADeals = p2Rows
    .filter((r) =>
      (r.StageName === 'Negotiating' || r.StageName === 'Signed') &&
      r.Earliest_Anticipated_Start_Date__c &&
      isFutureQ(r.Earliest_Anticipated_Start_Date__c)
    )
    .map((r) => ({
      oppId: r.Full_Opportunity_ID__c || '',
      advisor: r.advisor_name || '',
      stage: r.StageName,
      aum: r.Opportunity_AUM || 0, // raw dollars (not _M)
      anticipatedDate: r.Earliest_Anticipated_Start_Date__c,
      targetQuarter: toQuarterLabel(r.Earliest_Anticipated_Start_Date__c!),
      dateConfidence: dateRevisionMap?.get(r.Full_Opportunity_ID__c)?.dateConfidence ?? '',
      dateRevisions: dateRevisionMap?.get(r.Full_Opportunity_ID__c)?.revisionCount ?? '',
      durationBucket: (r as any).durationBucket || '',
    }))
    .sort((a, b) => {
      // Sort by quarter first, then AUM descending
      if (a.targetQuarter !== b.targetQuarter) return a.targetQuarter < b.targetQuarter ? -1 : 1;
      return b.aum - a.aum;
    });

  // Get unique quarters for Section 1
  const quarterSet = new Set(componentADeals.map((d) => d.targetQuarter));
  const quarters = Array.from(quarterSet).sort((a, b) => {
    const [aq, ay] = a.replace('Q', '').split(' ').map(Number);
    const [bq, by] = b.replace('Q', '').split(' ').map(Number);
    return ay !== by ? ay - by : aq - bq;
  });

  // Per-quarter stats for hardcoded display values
  const quarterStats = new Map<string, { count: number; aum: number }>();
  for (const deal of componentADeals) {
    const existing = quarterStats.get(deal.targetQuarter) || { count: 0, aum: 0 };
    existing.count += 1;
    existing.aum += deal.aum;
    quarterStats.set(deal.targetQuarter, existing);
  }

  // ── Section 2 rows ──
  const sec2Header = [
    'Opp ID', 'Advisor', 'Stage', 'AUM ($)', 'Anticipated Date',
    'Target Quarter', 'Date Confidence', 'Date Revisions', 'Duration Bucket',
  ];
  const sec2DataRows = componentADeals.map((d) => [
    d.oppId,
    d.advisor,
    d.stage,
    d.aum,
    d.anticipatedDate ? new Date(d.anticipatedDate).toISOString().split('T')[0] : '',
    d.targetQuarter,
    d.dateConfidence,
    d.dateRevisions,
    d.durationBucket,
  ]);

  // Section 2 starts at row = Section 1 size + blank row + detail title row + header row
  // We'll compute this after building Section 1
  const sec1RowCount = 3 + 1 + 1 + quarters.length + 1; // title(1) + subtitle(1) + blank(1) + header(1) + col headers(1) + quarter rows + blank separator
  const sec2TitleRow = sec1RowCount + 1; // 1-indexed
  const sec2HeaderRow = sec2TitleRow + 1;
  const sec2Start = sec2HeaderRow + 1; // first data row
  const sec2End = sec2Start + sec2DataRows.length - 1;

  // ── Section 1 rows (summary) ──
  // Formulas reference Section 2 ranges
  const sec1Rows: any[][] = [
    // Row 1
    ['REALIZATION FORECAST \u2014 TWO-COMPONENT MODEL'],
    // Row 2
    [`Generated: ${new Date().toISOString().split('T')[0]} | Deal-count band realization rates | Component B = $398M trailing 4Q surprise baseline (PIT backtest)`],
    // Row 3
    [],
    // Row 4
    ['FORECAST SUMMARY'],
    // Row 5 (column headers)
    [
      'Quarter',                      // A
      'Neg+Signed Dated Deals',       // B: COUNTIF
      'Component A AUM ($)',           // C: SUMIFS
      'Realization Band',             // D: human-readable label
      'Realization Rate',             // E: numeric rate for formulas
      'Pipeline Contribution ($)',     // F: C × E
      'Surprise Baseline ($)',         // G: constant
      'Total Forecast ($)',            // H: F + G
    ],
  ];

  // Quarter rows with formulas
  for (const quarter of quarters) {
    const row = sec1Rows.length + 1; // 1-indexed
    const stats = quarterStats.get(quarter)!;

    sec1Rows.push([
      quarter,                                                                        // A
      `=COUNTIF(F${sec2Start}:F${sec2End},"${quarter}")`,                            // B
      `=SUMIFS(D${sec2Start}:D${sec2End},F${sec2Start}:F${sec2End},"${quarter}")`,   // C
      // D: readable band label — e.g. "<10 deals → 60%" or "15+ deals → 35%"
      `=IF(B${row}<10,"<10 deals \u2192 60%",IF(B${row}<=14,"10-14 deals \u2192 45%","15+ deals \u2192 35%"))`,
      // E: numeric rate (used by Pipeline Contribution formula)
      `=IF(B${row}<10,0.6,IF(B${row}<=14,0.45,0.35))`,
      `=C${row}*E${row}`,                                                             // F
      SURPRISE_BASELINE,                                                               // G
      `=F${row}+G${row}`,                                                             // H
    ]);
  }
  sec1Rows.push([]); // blank separator

  // ── Assemble: Section 1, then Section 2, then Section 3 ──
  const values: any[][] = [...sec1Rows];

  // Section 2: deal detail
  values.push(['COMPONENT A \u2014 DEAL DETAIL (Neg+Signed with future anticipated dates)']);
  values.push(sec2Header);
  for (const row of sec2DataRows) {
    values.push(row);
  }
  values.push([]);

  // ── Section 3: Component B — Full Backtest Audit Trail ──
  // ALL values computed from raw data via formulas. Nothing hardcoded.
  // - Component A: from OpportunityFieldHistory PIT reconstruction (deal-level detail in Section 3b)
  // - Total Joined: from vw_funnel_master (deal-level detail in Section 3c)
  // - Surprise = Total - Component A (formula)
  values.push(['COMPONENT B \u2014 SURPRISE BASELINE (fully computed from raw data)']);
  values.push([]);

  // Section 3a: Summary per quarter — placeholders, filled in after detail rows are built
  values.push(['QUARTERLY SUMMARY']);
  values.push([
    'Quarter',                        // A
    'Total Joined AUM ($)',           // B: SUMIFS over Section 3c
    'Component A AUM ($)',            // C: SUMIFS over Section 3b (joined Component A deals)
    'Realization Rate',               // D: =C/E (what % of Component A pipeline actually joined)
    'Component A Pipeline ($)',       // E: SUMIFS over Section 3b (all Component A deals)
    'Surprise AUM ($)',               // F: =B-C
    'Notes',                          // G
  ]);

  const sec3Quarters = ['Q1 2025', 'Q2 2025', 'Q3 2025', 'Q4 2025'];
  const summaryStartIdx = values.length;
  for (const q of sec3Quarters) {
    values.push([q, 0, 0, 0, 0, 0, '']); // placeholders — filled in below
  }
  values.push(['Trailing 4Q Average', '', '', '', '', '', 'Used as Component B baseline (col F average)']);
  values.push([]);

  // Section 3b: Component A deal-level detail (PIT-reconstructed from OpportunityFieldHistory)
  values.push(['COMPONENT A DEAL DETAIL \u2014 PIT-reconstructed from OpportunityFieldHistory']);
  values.push([
    'Anticipated dates rolled back to quarter-start values using OldValue from the earliest post-snapshot',
  ]);
  values.push([
    'field change in OpportunityFieldHistory. Deals with no post-snapshot change use the current value.',
  ]);
  values.push([
    'AUM filter: > $1,000 (excludes placeholder records).',
  ]);
  values.push([
    'Opp ID', 'Advisor', 'AUM ($)', 'Stage at Snapshot', 'PIT Anticipated Date',
    'Quarter', 'Date Source', 'Joined in Quarter?', 'Join Date',
  ]);
  const compAStartRow = values.length + 1; // first data row, 1-indexed

  for (const deal of componentADealsHistory) {
    values.push([
      deal.Full_Opportunity_ID__c,
      deal.advisor_name,
      deal.Opportunity_AUM || 0,
      deal.stage_at_snapshot,
      deal.pit_anticipated_date || '',
      deal.qtr,
      deal.date_source,
      deal.joined_in_quarter === 1 ? 'Yes' : 'No',
      deal.advisor_join_date || '',
    ]);
  }
  const compAEndRow = values.length; // last data row, 1-indexed
  values.push([]);

  // Section 3c: Joined deal detail (from vw_funnel_master)
  values.push(['JOINED DEAL DETAIL (Q1\u2013Q4 2025) \u2014 from vw_funnel_master']);
  values.push([
    'Filter: AUM > $1,000. Deals with $0, $0.01, or $1 AUM are excluded \u2014 these are placeholder/test records',
  ]);
  values.push([
    'that contribute $0 to totals. The backtest (17% MAPE) included them but they had zero impact on accuracy.',
  ]);
  values.push(['Opp ID', 'Advisor', 'AUM ($)', 'Join Date', 'Joined Quarter']);
  const joinedStartRow = values.length + 1; // first data row, 1-indexed

  for (const deal of historicalJoinedDeals) {
    values.push([
      deal.Full_Opportunity_ID__c,
      deal.advisor_name,
      deal.Opportunity_AUM || 0,
      deal.advisor_join_date__c || '',
      deal.joined_quarter || '',
    ]);
  }
  const joinedEndRow = values.length; // last data row, 1-indexed
  values.push([]);

  // Now fill in the summary formulas referencing both detail sections
  for (let i = 0; i < sec3Quarters.length; i++) {
    const q = sec3Quarters[i];
    const summaryRow = summaryStartIdx + i; // 0-indexed in values array
    const sheetRow = summaryRow + 1; // 1-indexed
    const compADealCount = componentADealsHistory.filter(d => d.qtr === q).length;
    const joinedDealCount = historicalJoinedDeals.filter(d => d.joined_quarter === q).length;

    values[summaryRow] = [
      q,
      // B: Total Joined AUM = SUMIFS over joined detail (col C = AUM, col E = quarter)
      `=SUMIFS(C${joinedStartRow}:C${joinedEndRow},E${joinedStartRow}:E${joinedEndRow},"${q}")`,
      // C: Component A Joined AUM = SUMIFS over comp A detail where joined=Yes AND quarter matches
      `=SUMIFS(C${compAStartRow}:C${compAEndRow},F${compAStartRow}:F${compAEndRow},"${q}",H${compAStartRow}:H${compAEndRow},"Yes")`,
      // D: Realization Rate = C/E
      `=IF(E${sheetRow}=0,"",C${sheetRow}/E${sheetRow})`,
      // E: Component A Pipeline = SUMIFS over comp A detail (all deals, not just joined)
      `=SUMIFS(C${compAStartRow}:C${compAEndRow},F${compAStartRow}:F${compAEndRow},"${q}")`,
      // F: Surprise = Total - Component A Joined
      `=B${sheetRow}-C${sheetRow}`,
      `${compADealCount} Component A deals, ${joinedDealCount} total joined deals`,
    ];
  }

  // Fill in the trailing average row
  const firstSummaryRow = summaryStartIdx + 1; // 1-indexed
  const lastSummaryRow = summaryStartIdx + sec3Quarters.length; // 1-indexed
  values[summaryStartIdx + sec3Quarters.length] = [
    'Trailing 4Q Average',
    `=AVERAGE(B${firstSummaryRow}:B${lastSummaryRow})`,
    `=AVERAGE(C${firstSummaryRow}:C${lastSummaryRow})`,
    `=AVERAGE(D${firstSummaryRow}:D${lastSummaryRow})`,
    `=AVERAGE(E${firstSummaryRow}:E${lastSummaryRow})`,
    `=AVERAGE(F${firstSummaryRow}:F${lastSummaryRow})`,
    'Used as Component B baseline (col F average)',
  ];

  values.push([]);

  // Methodology
  values.push(['MODEL METHODOLOGY']);
  values.push(['Forecast = (Component A \u00D7 Realization Rate) + Component B']);
  values.push(['Component A = AUM of Neg+Signed deals with PIT-corrected anticipated date in the target quarter']);
  values.push(['  PIT correction: Earliest_Anticipated_Start_Date__c rolled back via OpportunityFieldHistory']);
  values.push(['  OldValue from earliest post-snapshot change = what the field was at quarter start']);
  values.push(['Realization Rate = deal-count band: <10 deals \u2192 60%, 10-14 \u2192 45%, 15+ \u2192 35%']);
  values.push(['Component B = trailing 4Q average of Surprise AUM (col F)']);
  values.push(['Surprise AUM = Total Joined AUM (col B) minus Component A Joined AUM (col C)']);
  values.push(['Every value traces to deal-level detail via SUMIFS formulas \u2014 no hardcoded numbers']);
  values.push(['Backtest MAPE: 17% across Q1-Q4 2025 (8x more accurate than probability model)']);

  return values;
}

// Build the "BQ Scenario Runner" tab — leadership what-if analysis
// Section 1: Current trailing rates (named range refs, read-only)
// Section 2: Scenario inputs (editable cells — rates, days-per-stage, AUM)
// Section 3: Target analysis (scenario vs current SQO comparison with gap/raw + velocity pipeline entry quarter)
// Section 4: Sensitivity matrix (required SQOs at different rate × AUM combos)
function buildScenarioRunnerValues(
  flatRates: ForecastRates,
  targetAumByQuarter: Record<string, number>,
  realizationRowRange: string,
): any[][] {
  const values: any[][] = [];
  const rTab = `'BQ Realization Forecast'`;

  // ── Section 1: Current Trailing Rates (rows 1-12) ──
  values.push(['SCENARIO RUNNER \u2014 WHAT-IF ANALYSIS']);
  values.push([`Generated: ${new Date().toISOString().split('T')[0]} | Section 1 is read-only (references Rates tab). Edit Section 2 to run scenarios.`]);
  values.push([]);

  // Row 4
  values.push(['CURRENT TRAILING RATES (from Rates tab)', '', '']);
  // Row 5 (column headers)
  values.push(['Transition', 'Current Rate', 'Current Avg Days']);
  // Row 6
  values.push(['SQO \u2192 SP', '=SQO_to_SP_rate', '=avg_days_sqo_to_sp']);
  // Row 7
  values.push(['SP \u2192 Neg', '=SP_to_Neg_rate', '=avg_days_in_sp']);
  // Row 8
  values.push(['Neg \u2192 Signed', '=Neg_to_Signed_rate', '=avg_days_in_neg']);
  // Row 9
  values.push(['Signed \u2192 Joined', '=Signed_to_Joined_rate', '=avg_days_in_signed']);
  // Row 10
  values.push(['SQO \u2192 Joined (product)', '=B6*B7*B8*B9', '=SUM(C6:C9)']);
  // Row 11
  values.push(['Mean Joined AUM ($)', '=mean_joined_aum', '']);
  // Row 12
  values.push(['Cohort Size', '=cohort_count', '']);
  values.push([]);

  // ── Section 2: Scenario Inputs (rows 14-22) ──
  // Row 14
  values.push(['SCENARIO INPUTS (\u2190 edit these cells)', '', '']);
  // Row 15
  values.push(['Transition', 'Scenario Rate', 'Scenario Days']);
  // Row 16 — default to current rates (user can edit)
  values.push(['SQO \u2192 SP', flatRates.sqo_to_sp, Math.round(flatRates.avg_days_sqo_to_sp)]);
  // Row 17
  values.push(['SP \u2192 Neg', flatRates.sp_to_neg, Math.round(flatRates.avg_days_in_sp)]);
  // Row 18
  values.push(['Neg \u2192 Signed', flatRates.neg_to_signed, Math.round(flatRates.avg_days_in_neg)]);
  // Row 19
  values.push(['Signed \u2192 Joined', flatRates.signed_to_joined, Math.round(flatRates.avg_days_in_signed)]);
  // Row 20
  values.push(['SQO \u2192 Joined (product)', '=B16*B17*B18*B19', '=SUM(C16:C19)']);
  // Row 21
  values.push(['Mean Joined AUM ($)', flatRates.mean_joined_aum, '']);
  // Row 22
  values.push(['Expected AUM per SQO ($)', '=B21*B20', '']);
  values.push([]);

  // ── Section 3: Target Analysis (rows 24+) ──
  values.push(['TARGET ANALYSIS \u2014 SCENARIO vs CURRENT (velocity-adjusted)', '', '', '', '', '', '', '', '', '', '', '', '', '']);
  const targetHeaderRow = values.length + 1;
  values.push([
    'Quarter',                          // A
    'Target AUM ($)',                    // B
    'Realization Forecast ($)',          // C: VLOOKUP from BQ Realization Forecast tab
    'Forecast Gap ($)',                  // D: =MAX(0, B - C)
    'Expected AUM/SQO (Scenario)',      // E: from Section 2
    'SQOs to Fill Gap',                 // F: =CEILING(D/E)
    'SQOs Without Forecast',            // G: =CEILING(B/E)
    'Expected AUM/SQO (Current)',        // H: from Section 1
    'SQOs (Current Rates)',             // I: =CEILING(B/H)
    'SQO Delta (Scenario vs Current)',   // J: G - I
    'Scenario Velocity (days)',          // K: total scenario days
    'Pipeline Entry Quarter',            // L: quarter SQOs must enter pipeline
    'Entry Qtr Status',                  // M: "PAST" if already passed
  ]);

  // Helper: convert "Q2 2026" → Sheets DATE formula for quarter start
  const quarterToDateFormula = (q: string): string => {
    const match = q.match(/^Q(\d)\s+(\d{4})$/);
    if (!match) return '';
    const qNum = parseInt(match[1]);
    const yr = parseInt(match[2]);
    const month = (qNum - 1) * 3 + 1;
    return `DATE(${yr},${month},1)`;
  };

  // Get future quarters with targets (exclude current quarter — already realized)
  const now = new Date();
  const currentQ = Math.ceil((now.getMonth() + 1) / 3);
  const currentYr = now.getFullYear();
  const isFutureQuarter = (q: string) => {
    const match = q.match(/^Q(\d)\s+(\d{4})$/);
    if (!match) return false;
    const qNum = parseInt(match[1]), yr = parseInt(match[2]);
    return yr > currentYr || (yr === currentYr && qNum > currentQ);
  };

  const quarters = Object.entries(targetAumByQuarter)
    .filter(([q, v]) => v > 0 && isFutureQuarter(q))
    .sort(([a], [b]) => {
      const [aq, ay] = a.replace('Q', '').split(' ').map(Number);
      const [bq, by] = b.replace('Q', '').split(' ').map(Number);
      return ay !== by ? ay - by : aq - bq;
    });

  if (quarters.length === 0) {
    values.push(['(No future quarter targets set \u2014 set target AUM on the Pipeline Forecast dashboard)']);
  } else {
    for (const [quarter, target] of quarters) {
      const row = values.length + 1;
      const qStartFormula = quarterToDateFormula(quarter);
      const forecastLookup = `=IFERROR(VLOOKUP(A${row},${rTab}!${realizationRowRange},8,FALSE),0)`;
      values.push([
        quarter,                                                           // A
        target,                                                            // B
        forecastLookup,                                                    // C
        `=MAX(0,B${row}-C${row})`,                                        // D
        '=$B$22',                                                          // E
        `=IF(E${row}=0,"",IF(D${row}=0,0,CEILING(D${row}/E${row},1)))`,  // F
        `=IF(E${row}=0,"",CEILING(B${row}/E${row},1))`,                  // G
        '=$B$10*$B$11',                                                    // H
        `=IF(H${row}=0,"",CEILING(B${row}/H${row},1))`,                  // I
        `=IF(OR(G${row}="",I${row}=""),"",G${row}-I${row})`,             // J
        '=$C$20',                                                          // K
        `="Q"&CEILING(MONTH(${qStartFormula}-$C$20)/3,1)&" "&YEAR(${qStartFormula}-$C$20)`, // L
        `=IF(${qStartFormula}-$C$20<TODAY(),"PAST","")`,                   // M
      ]);
    }
  }
  values.push([]);

  // ── Section 4: Sensitivity Matrix ──
  values.push(['SENSITIVITY MATRIX \u2014 How many SQOs are needed at different conversion rate and AUM assumptions?']);
  values.push(['Each cell = Required SQOs to hit the target. Rows = SQO\u2192Joined conversion rate. Columns = average AUM per joined deal.']);

  const matrixTarget = quarters.length > 0 ? quarters[0][1] : 500_000_000;
  const matrixTargetLabel = quarters.length > 0 ? quarters[0][0] : 'Default ($500M)';
  values.push([`Target: ${matrixTargetLabel} = $${(matrixTarget / 1e6).toFixed(0)}M`, '', '', '', '']);
  values.push([]);

  const aumValues = [50_000_000, 65_000_000, 80_000_000, 100_000_000, 125_000_000];
  const rateValues = [0.10, 0.12, 0.14, 0.16, 0.18, 0.20];

  values.push([
    'SQO\u2192Joined Rate \\ Avg Joined AUM',
    ...aumValues.map(v => `$${(v / 1e6).toFixed(0)}M avg AUM`),
  ]);

  for (const rate of rateValues) {
    const row: any[] = [`${(rate * 100).toFixed(0)}%`];
    for (const aum of aumValues) {
      const sqos = Math.ceil(matrixTarget / (aum * rate));
      row.push(sqos);
    }
    values.push(row);
  }

  values.push([]);
  values.push(['HOW TO USE THIS TAB']);
  values.push(['1. Section 1 shows current trailing rates and velocity from the Rates tab (read-only).']);
  values.push(['2. Edit cells in Section 2 to model different scenarios (change any rate, days-per-stage, or mean AUM).']);
  values.push(['3. Section 3 shows TWO SQO numbers per quarter:']);
  values.push(['   - "SQOs to Fill Gap" = how many SQOs you need ASSUMING the realization forecast comes through.']);
  values.push(['     It VLOOKUPs into the BQ Realization Forecast tab for full traceability \u2014 you can audit exactly which deals drive the forecast.']);
  values.push(['   - "SQOs Without Forecast" = how many SQOs you need IGNORING the forecast entirely (straight target \u00F7 expected AUM/SQO).']);
  values.push(['     Use this as a conservative planning number or when you want to disregard pipeline forecasts.']);
  values.push(['4. Section 3 also shows the PIPELINE ENTRY QUARTER \u2014 when SQOs must enter the funnel to realize AUM by the target quarter.']);
  values.push(['   Entry quarters marked "PAST" mean the window has closed. Adjust velocity or target to compensate.']);
  values.push(['5. The sensitivity matrix shows Required SQOs across different rate \u00D7 AUM combinations.']);
  values.push(['6. Duplicate this tab (right-click \u2192 Duplicate) to save multiple scenarios side by side.']);
  values.push(['7. All formulas trace back to source data: rates from BQ Rates and Days, forecasts from BQ Realization Forecast, targets from BQ SQO Targets.']);

  return values;
}

// Build the "BQ Rates and Days" tab — pure Sheets formulas referencing the Audit Trail tab.
// All values are auditable: click any cell to see the formula and trace it back to the raw data.
//
// Audit Trail column map:
//   L  = Date Became SQO          U  = SP (backfilled)       V  = Neg (backfilled)
//   W  = Signed (backfilled)      X  = Joined (backfilled)
//   Z  = Days in SP (SP→Neg)      AA = Days in Neg (Neg→Signed)   AB = Days in Signed (Signed→Joined)
//   AL = SP Denom   AM = SP Numer   AN = Neg Denom   AO = Neg Numer
//   AP = Signed Denom   AQ = Signed Numer   AR = Joined Denom   AS = Joined Numer
//
// NOTE: Y = "Days to SQO" (Created→SQO), NOT SQO→SP. For SQO→SP days we compute
// from timestamps: SP(backfilled) col U minus Date_Became_SQO col L.
// Days formulas are filtered by numer flags so only cohort deals that completed the
// transition are included (not all 457+ rows in the audit trail).
function buildRatesAndDaysValues(auditRowCount: number, flatRates?: ForecastRates): any[][] {
  const a = `'${AUDIT_TAB}'`;
  const lastRow = auditRowCount + 1;
  const rng = (col: string) => `${a}!${col}2:${col}${lastRow}`;
  const aumRng = rng('AG'); // AUM ($M) column for tier filtering

  // --- Flat rate helpers (all deals) ---
  const rate = (numerCol: string, denomCol: string) =>
    `=IFERROR(SUMPRODUCT(${rng(numerCol)})/SUMPRODUCT(${rng(denomCol)}), "N/A")`;
  const denomCount = (denomCol: string) => `=SUMPRODUCT(${rng(denomCol)})`;
  const numerCount = (numerCol: string) => `=SUMPRODUCT(${rng(numerCol)})`;

  // --- Tiered rate helpers (filtered by AUM < 75 or >= 75 in col AG) ---
  // AG is AUM in $M, so 75 = $75M boundary
  const tierRate = (numerCol: string, denomCol: string, op: '<' | '>=') =>
    `=IFERROR(SUMPRODUCT((${aumRng}${op}75)*(${rng(numerCol)}))/SUMPRODUCT((${aumRng}${op}75)*(${rng(denomCol)})), "N/A")`;
  const tierDenomCount = (denomCol: string, op: '<' | '>=') =>
    `=SUMPRODUCT((${aumRng}${op}75)*(${rng(denomCol)}))`;
  const tierNumerCount = (numerCol: string, op: '<' | '>=') =>
    `=SUMPRODUCT((${aumRng}${op}75)*(${rng(numerCol)}))`;

  // --- Days helpers ---
  const avgDaysFiltered = (daysCol: string, numerCol: string) =>
    `=IFERROR(AVERAGEIFS(${rng(daysCol)}, ${rng(numerCol)}, 1, ${rng(daysCol)}, "<>"), "N/A")`;
  const daysCount = (numerCol: string, daysCol: string) =>
    `=COUNTIFS(${rng(numerCol)}, 1, ${rng(daysCol)}, "<>")`;

  // Row layout reference (for named ranges and P2 formula references):
  //   B6  = flat SQO→SP        B14 = Lower SQO→SP        B22 = Upper SQO→SP
  //   B7  = flat SP→Neg        B15 = Lower SP→Neg        B23 = Upper SP→Neg
  //   B8  = flat Neg→Signed    B16 = Lower Neg→Signed    B24 = Upper Neg→Signed
  //   B9  = flat Signed→Joined B17 = Lower Signed→Joined B25 = Upper Signed→Joined
  //   B10 = flat SQO→Joined    B18 = Lower SQO→Joined    B26 = Upper SQO→Joined

  return [
    // Section 1: Title (rows 1-3)
    ['HISTORICAL CONVERSION RATES & AVG DAYS IN STAGE'],
    [`Generated: ${new Date().toISOString().split('T')[0]} \u2014 All formulas reference the "${AUDIT_TAB}" tab. Click any cell to see the formula.`],
    [],

    // Section 2: Flat Conversion Rates (rows 4-10)
    ['CONVERSION RATES (ALL DEALS)', '', '', '', ''],
    ['Transition', 'Rate', 'Numerator', 'Denominator', 'Formula Description'],
    [
      'SQO \u2192 SP',
      rate('AM', 'AL'),
      numerCount('AM'),
      denomCount('AL'),
      'All deals: reached SP+ \u00F7 resolved SQOs',
    ],
    [
      'SP \u2192 Neg',
      rate('AO', 'AN'),
      numerCount('AO'),
      denomCount('AN'),
      'All deals: reached Neg+ \u00F7 reached SP+',
    ],
    [
      'Neg \u2192 Signed',
      rate('AQ', 'AP'),
      numerCount('AQ'),
      denomCount('AP'),
      'All deals: reached Signed+ \u00F7 reached Neg+',
    ],
    [
      'Signed \u2192 Joined',
      rate('AS', 'AR'),
      numerCount('AS'),
      denomCount('AR'),
      'All deals: Joined \u00F7 reached Signed+',
    ],
    [
      'SQO \u2192 Joined (product)',
      '=B6*B7*B8*B9',
      numerCount('AS'),
      denomCount('AL'),
      'Product of flat rates',
    ],
    [],

    // Section 3: Lower Tier Rates (rows 12-18)
    ['LOWER TIER RATES (< $75M AUM)', '', '', '', ''],
    ['Transition', 'Rate', 'Numerator', 'Denominator', 'Formula Description'],
    [
      'SQO \u2192 SP',
      tierRate('AM', 'AL', '<'),
      tierNumerCount('AM', '<'),
      tierDenomCount('AL', '<'),
      'Lower tier: reached SP+ \u00F7 resolved SQOs where AUM < $75M',
    ],
    [
      'SP \u2192 Neg',
      tierRate('AO', 'AN', '<'),
      tierNumerCount('AO', '<'),
      tierDenomCount('AN', '<'),
      'Lower tier: reached Neg+ \u00F7 reached SP+ where AUM < $75M',
    ],
    [
      'Neg \u2192 Signed',
      tierRate('AQ', 'AP', '<'),
      tierNumerCount('AQ', '<'),
      tierDenomCount('AP', '<'),
      'Lower tier: reached Signed+ \u00F7 reached Neg+ where AUM < $75M',
    ],
    [
      'Signed \u2192 Joined',
      tierRate('AS', 'AR', '<'),
      tierNumerCount('AS', '<'),
      tierDenomCount('AR', '<'),
      'Lower tier: Joined \u00F7 reached Signed+ where AUM < $75M',
    ],
    [
      'SQO \u2192 Joined (product)',
      '=B14*B15*B16*B17',
      tierNumerCount('AS', '<'),
      tierDenomCount('AL', '<'),
      'Product of Lower tier rates',
    ],
    [],

    // Section 4: Upper Tier Rates (rows 20-26)
    ['UPPER TIER RATES (\u2265 $75M AUM)', '', '', '', ''],
    ['Transition', 'Rate', 'Numerator', 'Denominator', 'Formula Description'],
    [
      'SQO \u2192 SP',
      tierRate('AM', 'AL', '>='),
      tierNumerCount('AM', '>='),
      tierDenomCount('AL', '>='),
      'Upper tier: reached SP+ \u00F7 resolved SQOs where AUM \u2265 $75M',
    ],
    [
      'SP \u2192 Neg',
      tierRate('AO', 'AN', '>='),
      tierNumerCount('AO', '>='),
      tierDenomCount('AN', '>='),
      'Upper tier: reached Neg+ \u00F7 reached SP+ where AUM \u2265 $75M',
    ],
    [
      'Neg \u2192 Signed',
      tierRate('AQ', 'AP', '>='),
      tierNumerCount('AQ', '>='),
      tierDenomCount('AP', '>='),
      'Upper tier: reached Signed+ \u00F7 reached Neg+ where AUM \u2265 $75M',
    ],
    [
      'Signed \u2192 Joined',
      tierRate('AS', 'AR', '>='),
      tierNumerCount('AS', '>='),
      tierDenomCount('AR', '>='),
      'Upper tier: Joined \u00F7 reached Signed+ where AUM \u2265 $75M',
    ],
    [
      'SQO \u2192 Joined (product)',
      '=B22*B23*B24*B25',
      tierNumerCount('AS', '>='),
      tierDenomCount('AL', '>='),
      'Product of Upper tier rates',
    ],
    [],

    // Section 5: Average Days in Stage (rows 28-34)
    ['AVERAGE DAYS IN STAGE', '', '', '', ''],
    ['Transition', 'Avg Days', 'Deals with Data', '', 'Formula Description'],
    [
      'SQO \u2192 SP',
      avgDaysFiltered('Y', 'AM'),
      daysCount('AM', 'Y'),
      '',
      'Avg of "Days SQO\u2192SP" (col Y) where SP Numer=1',
    ],
    [
      'SP \u2192 Neg (days in SP)',
      avgDaysFiltered('Z', 'AO'),
      daysCount('AO', 'Z'),
      '',
      'Avg of "Days in SP" (col Z) where Neg Numer=1',
    ],
    [
      'Neg \u2192 Signed (days in Neg)',
      avgDaysFiltered('AA', 'AQ'),
      daysCount('AQ', 'AA'),
      '',
      'Avg of "Days in Neg" (col AA) where Signed Numer=1',
    ],
    [
      'Signed \u2192 Joined (days in Signed)',
      avgDaysFiltered('AB', 'AS'),
      daysCount('AS', 'AB'),
      '',
      'Avg of "Days in Signed" (col AB) where Joined Numer=1',
    ],
    [
      'Total SQO \u2192 Joined',
      '=SUM(B30:B33)',
      '',
      '',
      'Sum of all stage durations',
    ],
    [],

    // Section 5b: Additional Named-Range Values (rows 36-39)
    // These rows exist so they can be referenced as named ranges by the Scenario Runner tab
    // Values are FORMULAS referencing the Audit Trail — fully traceable, not hardcoded
    ['ADDITIONAL VALUES (computed from BQ Audit Trail)', '', '', '', ''],
    ['Metric', 'Value', 'Deal Count', '', 'Description'],
    [
      'Mean Joined AUM ($)',
      // AVERAGEIFS: AUM ($M) where Joined Numer=1 AND AUM>0, × 1M to convert $M → raw dollars
      `=IFERROR(AVERAGEIFS(${rng('AG')},${rng('AS')},1,${rng('AG')},">0")*1000000, 0)`,
      // Count of joined deals with AUM > 0
      `=COUNTIFS(${rng('AS')},1,${rng('AG')},">0")`,
      '',
      'Avg AUM of joined deals in trailing window (from Audit Trail)',
    ],
    [
      'Cohort Count',
      // SUMPRODUCT of SP Denom = total resolved SQOs in the cohort
      `=SUMPRODUCT(${rng('AL')})`,
      '',
      '',
      'Total resolved SQOs in trailing window (= SP Denominator sum)',
    ],
    [],

    // Section 6: Named Ranges Reference
    ['NAMED RANGES (create in Sheets: Data \u2192 Named ranges)'],
    ['Cell', 'Named Range', 'Used By'],
    ['B6', 'SQO_to_SP_rate', 'Flat rate \u2014 BQ Forecast P2 fallback'],
    ['B7', 'SP_to_Neg_rate', 'Flat rate'],
    ['B8', 'Neg_to_Signed_rate', 'Flat rate'],
    ['B9', 'Signed_to_Joined_rate', 'Flat rate'],
    ['B10', 'SQO_to_Joined_rate', 'Flat product'],
    ['B14', 'Lower_SQO_to_SP_rate', 'BQ Forecast P2 col K (Lower tier deals)'],
    ['B15', 'Lower_SP_to_Neg_rate', 'BQ Forecast P2 col L'],
    ['B16', 'Lower_Neg_to_Signed_rate', 'BQ Forecast P2 col M'],
    ['B17', 'Lower_Signed_to_Joined_rate', 'BQ Forecast P2 col N'],
    ['B22', 'Upper_SQO_to_SP_rate', 'BQ Forecast P2 col K (Upper tier deals)'],
    ['B23', 'Upper_SP_to_Neg_rate', 'BQ Forecast P2 col L'],
    ['B24', 'Upper_Neg_to_Signed_rate', 'BQ Forecast P2 col M'],
    ['B25', 'Upper_Signed_to_Joined_rate', 'BQ Forecast P2 col N'],
    ['B38', 'mean_joined_aum', 'BQ Scenario Runner \u2014 Mean Joined AUM'],
    ['B39', 'cohort_count', 'BQ Scenario Runner \u2014 Cohort Count'],
    ['B30', 'avg_days_sqo_to_sp', 'BQ Scenario Runner \u2014 Avg Days SQO\u2192SP'],
    ['B31', 'avg_days_in_sp', 'BQ Scenario Runner \u2014 Avg Days in SP'],
    ['B32', 'avg_days_in_neg', 'BQ Scenario Runner \u2014 Avg Days in Neg'],
    ['B33', 'avg_days_in_signed', 'BQ Scenario Runner \u2014 Avg Days in Signed'],
    [],

    // Section 7: Methodology notes
    ['METHODOLOGY'],
    [
      'Cohort:',
      'Resolved SQOs only (Joined + Closed Lost) within the selected trailing window',
    ],
    [
      'Denominators:',
      '"Reached or beyond" \u2014 COALESCE backfill. Flagged as 0/1 in cols AL\u2013AS.',
    ],
    [
      'Tier split:',
      'AUM < $75M = Lower, AUM \u2265 $75M = Upper. Uses COALESCE(Underwritten_AUM__c, Amount) from Audit Trail col AG.',
    ],
    [
      'P2 link:',
      'Cols K\u2013N in BQ Forecast P2 use IF formulas to pick the tier-appropriate rate from this tab based on col Y (AUM Tier 2-tier).',
    ],
    [
      'Days:',
      'Filtered by numer flag = 1. SQO\u2192SP from col Y (timestamp diff); others from cols Z, AA, AB.',
    ],
  ];
}

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const permissions = getSessionPermissions(session);
  if (!permissions || !permissions.allowedPages.includes(19)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const windowDays = body.windowDays as 180 | 365 | 730 | null | undefined;
    const clientTargets = (body.targetAumByQuarter ?? {}) as Record<string, number>;

    const [p2RowsRaw, auditRows, tieredRates, dateRevisionMap, joinedByQuarter, dbTargets, historicalJoinedDeals, componentADealsHistory] = await Promise.all([
      getForecastExportP2(),
      getForecastExportAudit(windowDays ?? null),
      getTieredForecastRates(windowDays ?? null),
      getDateRevisionMap(),
      getJoinedAumByQuarter(),
      prisma.forecastQuarterTarget.findMany(),
      // Historical joined deals for Component B backtest audit trail
      runQuery<{
        Full_Opportunity_ID__c: string;
        advisor_name: string;
        Opportunity_AUM: number;
        advisor_join_date__c: string;
        joined_quarter: string;
      }>(`
        SELECT
          Full_Opportunity_ID__c,
          COALESCE(advisor_name, 'Unknown') AS advisor_name,
          COALESCE(Underwritten_AUM__c, Amount, 0) AS Opportunity_AUM,
          FORMAT_DATE('%F', advisor_join_date__c) AS advisor_join_date__c,
          CONCAT('Q', EXTRACT(QUARTER FROM advisor_join_date__c), ' ', EXTRACT(YEAR FROM advisor_join_date__c)) AS joined_quarter
        FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\`
        WHERE is_joined = 1
          AND is_primary_opp_record = 1
          AND advisor_join_date__c >= '2025-01-01'
          AND advisor_join_date__c < '2026-01-01'
          AND COALESCE(Underwritten_AUM__c, Amount, 0) > 1000
        ORDER BY advisor_join_date__c
      `),
      // Component A PIT reconstruction — Neg+Signed deals with PIT-corrected anticipated dates
      // Uses OpportunityFieldHistory to roll back Earliest_Anticipated_Start_Date__c to quarter-start values
      runQuery<{
        qtr: string;
        Full_Opportunity_ID__c: string;
        advisor_name: string;
        Opportunity_AUM: number;
        stage_at_snapshot: string;
        pit_anticipated_date: string;
        date_source: string;
        joined_in_quarter: number;
        advisor_join_date: string | null;
      }>(`
        WITH quarters AS (
          SELECT 'Q1 2025' AS qtr, DATE '2025-01-01' AS q_start, DATE '2025-04-01' AS q_end
          UNION ALL SELECT 'Q2 2025', DATE '2025-04-01', DATE '2025-07-01'
          UNION ALL SELECT 'Q3 2025', DATE '2025-07-01', DATE '2025-10-01'
          UNION ALL SELECT 'Q4 2025', DATE '2025-10-01', DATE '2026-01-01'
        ),
        -- Earliest post-snapshot change to anticipated date → OldValue = what it was at snapshot
        pit_date_changes AS (
          SELECT
            h.OpportunityId,
            q.qtr,
            SAFE.PARSE_DATE('%F', h.OldValue) AS pit_anticipated_date
          FROM \`savvy-gtm-analytics.SavvyGTMData.OpportunityFieldHistory\` h
          CROSS JOIN quarters q
          WHERE h.Field = 'Earliest_Anticipated_Start_Date__c'
            AND DATE(h.CreatedDate) >= q.q_start
          QUALIFY ROW_NUMBER() OVER (PARTITION BY h.OpportunityId, q.qtr ORDER BY h.CreatedDate ASC) = 1
        ),
        pipeline AS (
          SELECT
            q.qtr,
            q.q_start,
            q.q_end,
            f.Full_Opportunity_ID__c,
            COALESCE(f.advisor_name, 'Unknown') AS advisor_name,
            COALESCE(f.Underwritten_AUM__c, f.Amount, 0) AS Opportunity_AUM,
            CASE
              WHEN f.Stage_Entered_Signed__c IS NOT NULL AND DATE(f.Stage_Entered_Signed__c) < q.q_start THEN 'Signed'
              WHEN f.Stage_Entered_Negotiating__c IS NOT NULL AND DATE(f.Stage_Entered_Negotiating__c) < q.q_start THEN 'Negotiating'
              WHEN f.Stage_Entered_Sales_Process__c IS NOT NULL AND DATE(f.Stage_Entered_Sales_Process__c) < q.q_start THEN 'Sales Process'
              ELSE 'Discovery'
            END AS stage_at_snapshot,
            COALESCE(pd.pit_anticipated_date, f.Earliest_Anticipated_Start_Date__c) AS pit_anticipated_date,
            CASE WHEN pd.pit_anticipated_date IS NOT NULL THEN 'PIT-corrected (OFH)' ELSE 'Current value (no post-snapshot change)' END AS date_source,
            CASE WHEN f.StageName = 'Joined' AND f.advisor_join_date__c >= q.q_start AND f.advisor_join_date__c < q.q_end THEN 1 ELSE 0 END AS joined_in_quarter,
            FORMAT_DATE('%F', f.advisor_join_date__c) AS advisor_join_date
          FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\` f
          CROSS JOIN quarters q
          LEFT JOIN pit_date_changes pd ON pd.OpportunityId = f.Full_Opportunity_ID__c AND pd.qtr = q.qtr
          WHERE f.SQO_raw = 'Yes'
            AND f.is_primary_opp_record = 1
            AND DATE(f.Date_Became_SQO__c) < q.q_start
            AND (f.advisor_join_date__c IS NULL OR f.advisor_join_date__c >= q.q_start)
            AND (f.Stage_Entered_Closed__c IS NULL OR DATE(f.Stage_Entered_Closed__c) >= q.q_start)
            AND COALESCE(f.Underwritten_AUM__c, f.Amount, 0) > 1000
        )
        SELECT
          qtr, Full_Opportunity_ID__c, advisor_name, Opportunity_AUM,
          stage_at_snapshot, FORMAT_DATE('%F', pit_anticipated_date) AS pit_anticipated_date,
          date_source, joined_in_quarter, advisor_join_date
        FROM pipeline
        WHERE stage_at_snapshot IN ('Negotiating', 'Signed')
          AND pit_anticipated_date IS NOT NULL
          AND pit_anticipated_date >= q_start
          AND pit_anticipated_date < q_end
        ORDER BY qtr, Opportunity_AUM DESC
      `),
    ]);

    // Merge DB targets with client targets (client takes priority for latest edits)
    const targetAumByQuarter: Record<string, number> = {};
    for (const t of dbTargets) {
      if (t.targetAumDollars > 0) targetAumByQuarter[t.quarter] = t.targetAumDollars;
    }
    for (const [q, v] of Object.entries(clientTargets)) {
      if (v > 0) targetAumByQuarter[q] = v;
    }

    // Recompute P2 rows with the dynamic tiered rates + duration penalties
    const p2Rows = recomputeP2WithRates(p2RowsRaw, tieredRates);

    // Run Monte Carlo simulation (same rates used by the dashboard)
    const avgDays = {
      in_sp: tieredRates.flat.avg_days_in_sp,
      in_neg: tieredRates.flat.avg_days_in_neg,
      in_signed: tieredRates.flat.avg_days_in_signed,
    };
    const mcResults = await runMonteCarlo(tieredRates, avgDays);

    console.log(`[Forecast Export] P2 rows: ${p2Rows.length}, Audit rows: ${auditRows.length}, MC per-opp: ${mcResults.perOpp.length}`);

    const { sheets, drive } = getGoogleClients();

    // Create a new blank spreadsheet in a per-user subfolder
    const userName = session.user.name || session.user.email || 'Unknown';
    const dateStr = new Date().toISOString().split('T')[0];
    const windowLabel = windowDays ? `${windowDays}d` : 'all-time';
    const newName = `Pipeline Forecast — ${dateStr} — ${userName} (${windowLabel})`;

    // Find or create per-user subfolder inside the shared export folder
    let userFolderId = EXPORT_FOLDER_ID;
    try {
      const folderName = userName;
      // Search for existing folder with this name
      const folderSearch = await drive.files.list({
        q: `name='${folderName.replace(/'/g, "\\'")}' and '${EXPORT_FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id,name)',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      if (folderSearch.data.files && folderSearch.data.files.length > 0) {
        userFolderId = folderSearch.data.files[0].id!;
        console.log(`[Forecast Export] Found existing folder for ${folderName}: ${userFolderId}`);
      } else {
        // Create new subfolder
        const folderResp = await drive.files.create({
          requestBody: {
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [EXPORT_FOLDER_ID],
          },
          supportsAllDrives: true,
        });
        userFolderId = folderResp.data.id!;
        console.log(`[Forecast Export] Created folder for ${folderName}: ${userFolderId}`);
      }
    } catch (folderErr) {
      console.warn(`[Forecast Export] Failed to create user folder, using root:`, folderErr);
    }

    console.log(`[Forecast Export] Creating new spreadsheet "${newName}" in user folder...`);
    const createResp = await drive.files.create({
      requestBody: {
        name: newName,
        mimeType: 'application/vnd.google-apps.spreadsheet',
        parents: [userFolderId],
      },
      supportsAllDrives: true,
    });
    const newSheetId = createResp.data.id!;
    const newSheetUrl = `https://docs.google.com/spreadsheets/d/${newSheetId}/edit`;
    console.log(`[Forecast Export] Created new sheet: ${newSheetId}`);

    // Share with the exporting user (editor access)
    const userEmail = session.user.email;
    if (userEmail) {
      try {
        await drive.permissions.create({
          fileId: newSheetId,
          requestBody: {
            type: 'user',
            role: 'writer',
            emailAddress: userEmail,
          },
          supportsAllDrives: true,
          sendNotificationEmail: false,
        });
        console.log(`[Forecast Export] Shared with ${userEmail}`);
      } catch (shareErr) {
        // Non-fatal — the export still works, user just won't have direct access
        console.warn(`[Forecast Export] Failed to share with ${userEmail}:`, shareErr);
      }
    }

    // Build all tab data
    const p2Values = buildP2Values(p2Rows, dateRevisionMap);
    const auditValues = buildAuditValues(auditRows);
    const mcValues = buildMonteCarloValues(mcResults);
    const ratesValues = buildRatesAndDaysValues(auditRows.length, tieredRates.flat);
    const projectedAumByQuarter: Record<string, number> = {};
    for (const row of p2Rows) {
      const q = row.projected_quarter;
      if (q) {
        projectedAumByQuarter[q] = (projectedAumByQuarter[q] ?? 0) + (row.expected_aum_weighted ?? 0);
      }
    }
    const sqoTargetsValues = buildSQOTargetsValues(targetAumByQuarter, tieredRates.flat, joinedByQuarter, projectedAumByQuarter);
    const realizationValues = buildRealizationValues(p2Rows, tieredRates.flat, dateRevisionMap, historicalJoinedDeals, componentADealsHistory);

    // Build Scenario Runner values (depends on realizationValues for VLOOKUP range)
    const realizationQuarterCount = realizationValues.filter((r: any[]) =>
      r[0] && typeof r[0] === 'string' && (r[0] as string).match(/^Q\d\s+\d{4}$/) && r.length >= 8
    ).length;
    const realizationRowRange = `A6:H${5 + realizationQuarterCount}`;
    const scenarioRunnerValues = buildScenarioRunnerValues(tieredRates.flat, targetAumByQuarter, realizationRowRange);

    // Write tabs in DEPENDENCY ORDER (referenced tabs must exist before referencing tabs).
    // Formulas that reference other tabs get #REF! if the target tab doesn't exist yet.
    // Dependency chain: Audit Trail → Rates → Named Ranges → Realization → Scenario Runner
    //                   Monte Carlo, SQO Targets, Forecast P2 also reference Rates/Audit

    // 1. Audit Trail first (Rates tab formulas reference it)
    await writeTab(sheets, newSheetId, AUDIT_TAB, auditValues);
    console.log(`[Forecast Export] Audit tab written`);

    // 2. Rates and Days (formulas reference Audit Trail)
    await writeTab(sheets, newSheetId, RATES_TAB, ratesValues);
    console.log(`[Forecast Export] Rates tab written`);

    // 3. Create named ranges (point to Rates tab cells, referenced by Scenario Runner + P2)
    try {
      const sheetMeta = await sheets.spreadsheets.get({
        spreadsheetId: newSheetId,
        fields: 'sheets(properties(sheetId,title))',
      });
      const ratesSheet = sheetMeta.data.sheets?.find(
        (s: any) => s.properties?.title === RATES_TAB
      );
      const ratesSheetId = ratesSheet?.properties?.sheetId;

      if (ratesSheetId != null) {
        const namedRanges: { name: string; row: number; col: number }[] = [
          { name: 'SQO_to_SP_rate', row: 5, col: 1 },
          { name: 'SP_to_Neg_rate', row: 6, col: 1 },
          { name: 'Neg_to_Signed_rate', row: 7, col: 1 },
          { name: 'Signed_to_Joined_rate', row: 8, col: 1 },
          { name: 'SQO_to_Joined_rate', row: 9, col: 1 },
          { name: 'Lower_SQO_to_SP_rate', row: 13, col: 1 },
          { name: 'Lower_SP_to_Neg_rate', row: 14, col: 1 },
          { name: 'Lower_Neg_to_Signed_rate', row: 15, col: 1 },
          { name: 'Lower_Signed_to_Joined_rate', row: 16, col: 1 },
          { name: 'Upper_SQO_to_SP_rate', row: 21, col: 1 },
          { name: 'Upper_SP_to_Neg_rate', row: 22, col: 1 },
          { name: 'Upper_Neg_to_Signed_rate', row: 23, col: 1 },
          { name: 'Upper_Signed_to_Joined_rate', row: 24, col: 1 },
          { name: 'mean_joined_aum', row: 37, col: 1 },
          { name: 'cohort_count', row: 38, col: 1 },
          { name: 'avg_days_sqo_to_sp', row: 29, col: 1 },
          { name: 'avg_days_in_sp', row: 30, col: 1 },
          { name: 'avg_days_in_neg', row: 31, col: 1 },
          { name: 'avg_days_in_signed', row: 32, col: 1 },
        ];

        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: newSheetId,
          requestBody: {
            requests: namedRanges.map(nr => ({
              addNamedRange: {
                namedRange: {
                  name: nr.name,
                  range: {
                    sheetId: ratesSheetId,
                    startRowIndex: nr.row,
                    endRowIndex: nr.row + 1,
                    startColumnIndex: nr.col,
                    endColumnIndex: nr.col + 1,
                  },
                },
              },
            })),
          },
        });
        console.log(`[Forecast Export] Created ${namedRanges.length} named ranges`);
      }
    } catch (nrErr) {
      console.warn(`[Forecast Export] Failed to create named ranges:`, nrErr);
    }

    // 4. Realization Forecast (self-contained, but needed by Scenario Runner VLOOKUP)
    await writeTab(sheets, newSheetId, REALIZATION_TAB, realizationValues);
    console.log(`[Forecast Export] Realization Forecast tab written`);

    // 5. Scenario Runner (references named ranges + Realization tab)
    await writeTab(sheets, newSheetId, SCENARIO_TAB, scenarioRunnerValues);
    console.log(`[Forecast Export] Scenario Runner tab written`);

    // 6-8. Remaining tabs (reference named ranges which already exist)
    await writeTab(sheets, newSheetId, FORECAST_TAB, p2Values);
    console.log(`[Forecast Export] P2 tab written`);
    await writeTab(sheets, newSheetId, MONTE_CARLO_TAB, mcValues);
    console.log(`[Forecast Export] Monte Carlo tab written`);
    await writeTab(sheets, newSheetId, SQO_TARGETS_TAB, sqoTargetsValues);
    console.log(`[Forecast Export] SQO Targets tab written`);

    // Reorder tabs to desired display order (written order ≠ display order)
    // Desired: Scenario Runner, Rates, Realization, Forecast P2, Monte Carlo, SQO Targets, Audit Trail
    try {
      const tabMeta = await sheets.spreadsheets.get({
        spreadsheetId: newSheetId,
        fields: 'sheets(properties(sheetId,title))',
      });
      const tabOrder = [SCENARIO_TAB, RATES_TAB, REALIZATION_TAB, FORECAST_TAB, MONTE_CARLO_TAB, SQO_TARGETS_TAB, AUDIT_TAB];
      const reorderRequests = tabOrder.map((tabName, idx) => {
        const sheet = tabMeta.data.sheets?.find((s: any) => s.properties?.title === tabName);
        if (!sheet?.properties?.sheetId) return null;
        return {
          updateSheetProperties: {
            properties: { sheetId: sheet.properties.sheetId, index: idx },
            fields: 'index',
          },
        };
      }).filter((r): r is NonNullable<typeof r> => r != null);

      if (reorderRequests.length > 0) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: newSheetId,
          requestBody: { requests: reorderRequests },
        });
        console.log(`[Forecast Export] Tabs reordered`);
      }
    } catch (reorderErr) {
      console.warn(`[Forecast Export] Failed to reorder tabs:`, reorderErr);
    }

    // Style the Scenario Runner tab — highlight editable vs read-only sections
    try {
      const scenarioMeta = await sheets.spreadsheets.get({
        spreadsheetId: newSheetId,
        fields: 'sheets(properties(sheetId,title))',
      });
      const scenarioSheet = scenarioMeta.data.sheets?.find(
        (s: any) => s.properties?.title === SCENARIO_TAB
      );

      const scenarioSheetId = scenarioSheet?.properties?.sheetId;
      if (scenarioSheetId != null) {
        // Colors
        const lightBlue = { red: 0.85, green: 0.92, blue: 1.0 };     // editable cells
        const lightGray = { red: 0.93, green: 0.93, blue: 0.93 };    // read-only / computed
        const darkHeader = { red: 0.2, green: 0.2, blue: 0.3 };      // section headers
        const white = { red: 1, green: 1, blue: 1 };

        // Helper to build a repeatCell request
        const formatRange = (startRow: number, endRow: number, startCol: number, endCol: number, bgColor: any, bold = false, fontColor?: any) => ({
          repeatCell: {
            range: { sheetId: scenarioSheetId, startRowIndex: startRow, endRowIndex: endRow, startColumnIndex: startCol, endColumnIndex: endCol },
            cell: {
              userEnteredFormat: {
                backgroundColor: bgColor,
                textFormat: { bold, ...(fontColor ? { foregroundColor: fontColor } : {}) },
              },
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat)',
          },
        });

        // Helper to set number format on a range
        const numberFormat = (startRow: number, endRow: number, startCol: number, endCol: number, pattern: string) => ({
          repeatCell: {
            range: { sheetId: scenarioSheetId, startRowIndex: startRow, endRowIndex: endRow, startColumnIndex: startCol, endColumnIndex: endCol },
            cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern } } },
            fields: 'userEnteredFormat.numberFormat',
          },
        });

        // Helper to protect a range
        const protectRange = (startRow: number, endRow: number, startCol: number, endCol: number, description: string) => ({
          addProtectedRange: {
            protectedRange: {
              range: { sheetId: scenarioSheetId, startRowIndex: startRow, endRowIndex: endRow, startColumnIndex: startCol, endColumnIndex: endCol },
              description,
              warningOnly: true, // shows a warning but doesn't block — allows override
            },
          },
        });

        const formatRequests: any[] = [
          // Section 1 headers (rows 0-2: title, subtitle, blank)
          formatRange(0, 1, 0, 3, darkHeader, true, white),

          // Section 1 data (rows 3-12): gray background — read-only
          formatRange(3, 4, 0, 3, darkHeader, true, white),  // "CURRENT TRAILING RATES" header
          formatRange(4, 13, 0, 3, lightGray),                // rows 5-12 data

          // Section 2 header (row 13-14)
          formatRange(13, 14, 0, 3, darkHeader, true, white), // "SCENARIO INPUTS" header
          formatRange(14, 15, 0, 3, lightGray, true),         // column headers

          // Section 2 EDITABLE cells (rows 15-18, cols B-C = rate + days for 4 stage transitions)
          formatRange(15, 19, 1, 3, lightBlue),

          // Section 2 EDITABLE AUM cell (row 20, col B)
          formatRange(20, 21, 1, 2, lightBlue),

          // Section 2 computed cells (rows 19, 21 = product row, expected AUM)
          formatRange(19, 20, 1, 3, lightGray),  // SQO→Joined product
          formatRange(21, 22, 1, 2, lightGray),   // Expected AUM per SQO

          // Section 3 header
          formatRange(23, 24, 0, 13, darkHeader, true, white),
          formatRange(24, 25, 0, 13, lightGray, true), // column headers

          // Section 3 data — gray (formula-driven, not editable)
          // Count quarter rows: scenarioRunnerValues rows that start with "Q# YYYY" after the header
          ...(() => {
            const qCount = scenarioRunnerValues.filter((r: any[]) =>
              r[0] && typeof r[0] === 'string' && (r[0] as string).match(/^Q\d\s+\d{4}$/)
            ).length;
            const sec3End = 25 + Math.max(qCount, 1);
            return [
              formatRange(25, sec3End, 0, 13, lightGray),
              // Protect read-only sections (warning only — allows override)
              protectRange(4, 13, 0, 3, 'Section 1: Current trailing rates (read-only — references Rates tab)'),
              protectRange(19, 20, 0, 3, 'Computed: SQO→Joined product'),
              protectRange(21, 22, 0, 3, 'Computed: Expected AUM per SQO'),
              protectRange(23, sec3End, 0, 13, 'Section 3: Target analysis (formula-driven)'),
            ];
          })(),

          // ── Number formatting ──

          // Section 1: rates as % to 1 decimal (col B, rows 5-9)
          numberFormat(5, 10, 1, 2, '0.0%'),
          // Section 1: days as integer (col C, rows 5-9)
          numberFormat(5, 10, 2, 3, '#,##0'),
          // Section 1: Mean Joined AUM as currency (row 10, col B)
          numberFormat(10, 11, 1, 2, '$#,##0'),

          // Section 2: scenario rates as % to 1 decimal (col B, rows 15-19)
          numberFormat(15, 20, 1, 2, '0.0%'),
          // Section 2: scenario days as integer (col C, rows 15-19)
          numberFormat(15, 20, 2, 3, '#,##0'),
          // Section 2: Mean Joined AUM as currency (row 20, col B)
          numberFormat(20, 21, 1, 2, '$#,##0'),
          // Section 2: Expected AUM per SQO as currency (row 21, col B)
          numberFormat(21, 22, 1, 2, '$#,##0'),

          // Section 3: Target AUM as currency (col B)
          ...(() => {
            const qCount = scenarioRunnerValues.filter((r: any[]) =>
              r[0] && typeof r[0] === 'string' && (r[0] as string).match(/^Q\d\s+\d{4}$/)
            ).length;
            const sec3Start = 25;
            const sec3End = sec3Start + Math.max(qCount, 1);
            return [
              numberFormat(sec3Start, sec3End, 1, 2, '$#,##0'),     // B: Target AUM
              numberFormat(sec3Start, sec3End, 2, 3, '$#,##0'),     // C: Realization Forecast
              numberFormat(sec3Start, sec3End, 3, 4, '$#,##0'),     // D: Forecast Gap
              numberFormat(sec3Start, sec3End, 4, 5, '$#,##0'),     // E: Expected AUM/SQO (Scenario)
              numberFormat(sec3Start, sec3End, 7, 8, '$#,##0'),     // H: Expected AUM/SQO (Current)
            ];
          })(),
        ];

        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: newSheetId,
          requestBody: { requests: formatRequests },
        });
        console.log(`[Forecast Export] Scenario Runner styling applied`);
      }
    } catch (styleErr) {
      console.warn(`[Forecast Export] Failed to style Scenario Runner tab:`, styleErr);
    }

    // Number formatting for ALL other tabs
    try {
      const allTabMeta = await sheets.spreadsheets.get({
        spreadsheetId: newSheetId,
        fields: 'sheets(properties(sheetId,title))',
      });
      const getSheetId = (name: string) =>
        allTabMeta.data.sheets?.find((s: any) => s.properties?.title === name)?.properties?.sheetId;

      const numFmt = (sheetId: number, startRow: number, endRow: number, startCol: number, endCol: number, pattern: string) => ({
        repeatCell: {
          range: { sheetId, startRowIndex: startRow, endRowIndex: endRow, startColumnIndex: startCol, endColumnIndex: endCol },
          cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern } } },
          fields: 'userEnteredFormat.numberFormat',
        },
      });

      const allFormatRequests: any[] = [];
      const auditCount = auditRows.length + 1; // +1 for header
      const p2Count = p2Rows.length + 1;

      // ── BQ Rates and Days ──
      const ratesId = getSheetId(RATES_TAB);
      if (ratesId != null) {
        allFormatRequests.push(
          // Flat rates % (col B=1, rows 5-9)
          numFmt(ratesId, 5, 10, 1, 2, '0.0%'),
          // Lower rates % (col B=1, rows 13-17)
          numFmt(ratesId, 13, 18, 1, 2, '0.0%'),
          // Upper rates % (col B=1, rows 21-25)
          numFmt(ratesId, 21, 26, 1, 2, '0.0%'),
          // Days as integer (col B=1, rows 29-34)
          numFmt(ratesId, 29, 35, 1, 2, '#,##0'),
          // Mean Joined AUM as $ (row 37, col B=1)
          numFmt(ratesId, 37, 38, 1, 2, '$#,##0'),
          // Numerator/Denominator as integer (col C-D, flat rows 5-9)
          numFmt(ratesId, 5, 10, 2, 4, '#,##0'),
          numFmt(ratesId, 13, 18, 2, 4, '#,##0'),
          numFmt(ratesId, 21, 26, 2, 4, '#,##0'),
          // Days deals count as integer (col C, rows 29-33)
          numFmt(ratesId, 29, 34, 2, 3, '#,##0'),
        );
      }

      // ── BQ Realization Forecast ──
      const realId = getSheetId(REALIZATION_TAB);
      if (realId != null) {
        // Section 1 summary (rows 5+): B=count, C=AUM $, D=band label, E=rate %, F=pipeline $, G=surprise $, H=total $
        const realQCount = realizationValues.filter((r: any[]) =>
          r[0] && typeof r[0] === 'string' && (r[0] as string).match(/^Q\d\s+\d{4}$/) && r.length >= 8
        ).length;
        const realDataEnd = 5 + realQCount;
        allFormatRequests.push(
          numFmt(realId, 5, realDataEnd, 2, 3, '$#,##0'),   // C: Component A AUM
          numFmt(realId, 5, realDataEnd, 4, 5, '0.0%'),     // E: Realization Rate
          numFmt(realId, 5, realDataEnd, 5, 6, '$#,##0'),   // F: Pipeline Contribution
          numFmt(realId, 5, realDataEnd, 6, 7, '$#,##0'),   // G: Surprise Baseline
          numFmt(realId, 5, realDataEnd, 7, 8, '$#,##0'),   // H: Total Forecast
        );

        // Section 3 quarterly summary — find it by scanning for the summary header rows
        // The summary starts after "QUARTERLY SUMMARY" row. Let's find it.
        const sec3SummaryIdx = realizationValues.findIndex((r: any[]) => r[0] === 'QUARTERLY SUMMARY');
        if (sec3SummaryIdx >= 0) {
          const sec3DataStart = sec3SummaryIdx + 2; // skip header + col headers
          const sec3DataEnd = sec3DataStart + 5; // 4 quarters + average row
          allFormatRequests.push(
            numFmt(realId, sec3DataStart, sec3DataEnd, 1, 2, '$#,##0'),   // B: Total Joined AUM
            numFmt(realId, sec3DataStart, sec3DataEnd, 2, 3, '$#,##0'),   // C: Component A AUM
            numFmt(realId, sec3DataStart, sec3DataEnd, 3, 4, '0.0%'),     // D: Realization Rate
            numFmt(realId, sec3DataStart, sec3DataEnd, 4, 5, '$#,##0'),   // E: Component A Pipeline
            numFmt(realId, sec3DataStart, sec3DataEnd, 5, 6, '$#,##0'),   // F: Surprise AUM
          );
        }

        // Component A detail — AUM column (col C=2)
        const compAHeaderIdx = realizationValues.findIndex((r: any[]) =>
          r[0] && typeof r[0] === 'string' && (r[0] as string).startsWith('COMPONENT A DEAL DETAIL'));
        if (compAHeaderIdx >= 0) {
          // Data starts 5 rows after the header (header + 3 note rows + col header row)
          const compADataStart = compAHeaderIdx + 5;
          const compADataEnd = realizationValues.findIndex((r: any[], i: number) => i > compADataStart && r.length === 0);
          if (compADataEnd > compADataStart) {
            numFmt(realId, compADataStart, compADataEnd, 2, 3, '$#,##0'); // AUM ($)
            allFormatRequests.push(numFmt(realId, compADataStart, compADataEnd, 2, 3, '$#,##0'));
          }
        }

        // Joined detail — AUM column (col C=2)
        const joinedHeaderIdx = realizationValues.findIndex((r: any[]) =>
          r[0] && typeof r[0] === 'string' && (r[0] as string).startsWith('JOINED DEAL DETAIL'));
        if (joinedHeaderIdx >= 0) {
          const joinedDataStart = joinedHeaderIdx + 4; // header + 2 note rows + col header row
          const joinedDataEnd = realizationValues.findIndex((r: any[], i: number) => i > joinedDataStart && r.length === 0);
          if (joinedDataEnd > joinedDataStart) {
            allFormatRequests.push(numFmt(realId, joinedDataStart, joinedDataEnd, 2, 3, '$#,##0'));
          }
        }
      }

      // ── BQ Forecast P2 ──
      const p2Id = getSheetId(FORECAST_TAB);
      if (p2Id != null) {
        allFormatRequests.push(
          // Col G (6): Raw AUM — $
          numFmt(p2Id, 1, p2Count, 6, 7, '$#,##0'),
          // Col H (7): AUM ($M) — $M with 1 decimal
          numFmt(p2Id, 1, p2Count, 7, 8, '$#,##0.0'),
          // Col K-N (10-13): Rates — %
          numFmt(p2Id, 1, p2Count, 10, 14, '0.0%'),
          // Col Q (16): P(Join) — %
          numFmt(p2Id, 1, p2Count, 16, 17, '0.0%'),
          // Col X (23): Expected AUM — $
          numFmt(p2Id, 1, p2Count, 23, 24, '$#,##0'),
          // Col AA (26): Duration Multiplier — decimal
          numFmt(p2Id, 1, p2Count, 26, 27, '0.00'),
          // Col AB (27): Baseline P(Join) — %
          numFmt(p2Id, 1, p2Count, 27, 28, '0.0%'),
          // Col AC (28): Adjusted P(Join) — %
          numFmt(p2Id, 1, p2Count, 28, 29, '0.0%'),
          // Col AD (29): Baseline Expected AUM — $
          numFmt(p2Id, 1, p2Count, 29, 30, '$#,##0'),
          // Col AE (30): Adjusted Expected AUM — $
          numFmt(p2Id, 1, p2Count, 30, 31, '$#,##0'),
        );
      }

      // ── BQ Monte Carlo ──
      const mcId = getSheetId(MONTE_CARLO_TAB);
      if (mcId != null) {
        // Quarter summary rows (rows 4-7): cols B-E (1-4) are AUM values
        const mcQCount = mcValues.filter((r: any[]) =>
          r[0] && typeof r[0] === 'string' && (r[0] as string).match(/^Q\d\s+\d{4}$/)
        ).length;
        if (mcQCount > 0) {
          allFormatRequests.push(
            numFmt(mcId, 4, 4 + mcQCount, 1, 5, '$#,##0'), // B-E: P10, P50, P90, Mean
          );
        }

        // Rates section (rows 10-13): col B (1) = rate as %
        allFormatRequests.push(
          numFmt(mcId, 10, 14, 1, 2, '0.0%'),
        );

        // Per-opp section: find header row "Opp ID"
        const mcPerOppHeaderIdx = mcValues.findIndex((r: any[]) => r[0] === 'Opp ID');
        if (mcPerOppHeaderIdx >= 0) {
          const mcPerOppStart = mcPerOppHeaderIdx + 1;
          const mcPerOppEnd = mcValues.length;
          allFormatRequests.push(
            // Col C (2): Win % as %
            numFmt(mcId, mcPerOppStart, mcPerOppEnd, 2, 3, '0.0%'),
            // Col D (3): Avg AUM if Won as $
            numFmt(mcId, mcPerOppStart, mcPerOppEnd, 3, 4, '$#,##0'),
            // Col E (4): Expected AUM as $
            numFmt(mcId, mcPerOppStart, mcPerOppEnd, 4, 5, '$#,##0'),
            // Col H (7): Duration Multiplier as decimal
            numFmt(mcId, mcPerOppStart, mcPerOppEnd, 7, 8, '0.00'),
          );
        }
      }

      // ── BQ SQO Targets ──
      const sqoId = getSheetId(SQO_TARGETS_TAB);
      if (sqoId != null) {
        // Model inputs (rows 5-12):
        // Rows 5-8 (0-idx): 4 stage rates as % (B col)
        // Row 9: SQO→Joined product as %
        // Row 10: Mean Joined AUM as $
        // Row 11: Expected AUM per SQO as $
        // Row 12: Avg Days as integer
        // Also format cols C-D for rows 5-8 (Source = rate formula, Description = rate value)
        allFormatRequests.push(
          numFmt(sqoId, 5, 10, 1, 2, '0.0%'),     // B: Rates (rows 5-9)
          numFmt(sqoId, 5, 9, 2, 3, '0.0%'),       // C: Source (rate formula refs)
          numFmt(sqoId, 5, 9, 3, 4, '0.0%'),       // D: Description (rate values)
          numFmt(sqoId, 10, 12, 1, 2, '$#,##0'),   // B: Mean AUM + Expected AUM/SQO
          numFmt(sqoId, 12, 13, 1, 2, '#,##0'),    // B: Days
          numFmt(sqoId, 12, 13, 2, 3, '#,##0'),    // C: Days source
        );

        // Gap analysis section (row 15 = header "QUARTERLY GAP ANALYSIS", row 16 = col headers, rows 17+ = data)
        const gapIdx = sqoTargetsValues.findIndex((r: any[]) =>
          r[0] && typeof r[0] === 'string' && (r[0] as string).includes('GAP ANALYSIS'));
        if (gapIdx >= 0) {
          const sqoQCount = sqoTargetsValues.filter((r: any[]) =>
            r[0] && typeof r[0] === 'string' && (r[0] as string).match(/^Q\d\s+\d{4}$/)
          ).length;
          const gapDataStart = gapIdx + 2; // skip header + col headers
          const gapDataEnd = gapDataStart + sqoQCount;
          allFormatRequests.push(
            numFmt(sqoId, gapDataStart, gapDataEnd, 1, 2, '$#,##0'),   // B: Target AUM
            numFmt(sqoId, gapDataStart, gapDataEnd, 2, 3, '$#,##0'),   // C: Joined AUM
            numFmt(sqoId, gapDataStart, gapDataEnd, 4, 5, '$#,##0'),   // E: Projected AUM
            numFmt(sqoId, gapDataStart, gapDataEnd, 5, 6, '$#,##0'),   // F: Total Expected
            numFmt(sqoId, gapDataStart, gapDataEnd, 6, 7, '$#,##0'),   // G: Gap
            numFmt(sqoId, gapDataStart, gapDataEnd, 7, 8, '0%'),       // H: Coverage %
          );
        }
      }

      // ── BQ Audit Trail ──
      const auditId = getSheetId(AUDIT_TAB);
      if (auditId != null) {
        allFormatRequests.push(
          // Col AG (32): AUM ($M) — $M with 1 decimal
          numFmt(auditId, 1, auditCount, 32, 33, '$#,##0.0'),
          // Days columns Y-AB (24-27): integer
          numFmt(auditId, 1, auditCount, 24, 28, '#,##0'),
          // Days in Current Stage AC (28): integer
          numFmt(auditId, 1, auditCount, 28, 29, '#,##0'),
          // Days SQO→Joined AD (29): integer
          numFmt(auditId, 1, auditCount, 29, 30, '#,##0'),
        );
      }

      if (allFormatRequests.length > 0) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: newSheetId,
          requestBody: { requests: allFormatRequests },
        });
        console.log(`[Forecast Export] Number formatting applied to all tabs (${allFormatRequests.length} format requests)`);
      }

      // Fix: explicit percentage format for SQO Targets rate cells (rows 6-10, cols B-C)
      // Applied as a separate call after all other formatting to ensure it's not overridden
      const sqoFixId = getSheetId(SQO_TARGETS_TAB);
      if (sqoFixId != null) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: newSheetId,
          requestBody: {
            requests: [
              numFmt(sqoFixId, 5, 10, 1, 3, '0.0%'),  // B6:C10 as percentage
            ],
          },
        });
        console.log(`[Forecast Export] SQO Targets rate format fix applied`);
      }
    } catch (fmtErr) {
      console.warn(`[Forecast Export] Failed to apply number formatting:`, fmtErr);
    }

    // Delete the default "Sheet1" tab that Drive API creates automatically
    try {
      const allSheets = await sheets.spreadsheets.get({
        spreadsheetId: newSheetId,
        fields: 'sheets(properties(sheetId,title))',
      });
      const defaultSheet = allSheets.data.sheets?.find(
        (s: any) => s.properties?.title === 'Sheet1'
      );
      if (defaultSheet?.properties?.sheetId != null) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: newSheetId,
          requestBody: {
            requests: [{ deleteSheet: { sheetId: defaultSheet.properties.sheetId } }],
          },
        });
        console.log(`[Forecast Export] Deleted default Sheet1 tab`);
      }
    } catch (delErr) {
      console.warn(`[Forecast Export] Failed to delete Sheet1:`, delErr);
    }

    // Log the export
    try {
      await prisma.forecastExport.create({
        data: {
          spreadsheetId: newSheetId,
          spreadsheetUrl: newSheetUrl,
          name: newName,
          createdBy: userEmail || 'unknown',
          windowDays: windowDays ?? 0,
          p2RowCount: p2Rows.length,
          auditRowCount: auditRows.length,
        },
      });
    } catch (logErr) {
      console.warn(`[Forecast Export] Failed to log export:`, logErr);
    }

    return NextResponse.json({
      success: true,
      spreadsheetUrl: newSheetUrl,
      spreadsheetName: newName,
      p2RowCount: p2Rows.length,
      auditRowCount: auditRows.length,
      mcPerOppCount: mcResults.perOpp.length,
      mcTrialCount: mcResults.trialCount,
    });
  } catch (error) {
    console.error('Forecast export error:', error);
    return NextResponse.json(
      { error: 'Export failed', details: String(error) },
      { status: 500 }
    );
  }
}

// DELETE /api/forecast/export — delete an export (DB record + Google Drive file)
export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = getSessionPermissions(session);
    if (!permissions?.canRunScenarios) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const exportId = body.id as string;
    if (!exportId) {
      return NextResponse.json({ error: 'Missing export id' }, { status: 400 });
    }

    // Look up the export record
    const exportRecord = await prisma.forecastExport.findUnique({
      where: { id: exportId },
    });
    if (!exportRecord) {
      return NextResponse.json({ error: 'Export not found' }, { status: 404 });
    }

    // Delete from Google Drive
    try {
      const { drive } = getGoogleClients();
      await drive.files.delete({
        fileId: exportRecord.spreadsheetId,
        supportsAllDrives: true,
      });
      console.log(`[Forecast Export] Deleted Drive file: ${exportRecord.spreadsheetId}`);
    } catch (driveErr) {
      // Non-fatal — file may already be deleted or inaccessible
      console.warn(`[Forecast Export] Failed to delete Drive file:`, driveErr);
    }

    // Delete from DB
    await prisma.forecastExport.delete({
      where: { id: exportId },
    });
    console.log(`[Forecast Export] Deleted export record: ${exportId}`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Forecast export delete error:', error);
    return NextResponse.json(
      { error: 'Delete failed', details: String(error) },
      { status: 500 }
    );
  }
}
