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
import { prisma } from '@/lib/prisma';

const TARGET_SHEET_ID = '1Iz9X6HY-bsAGBNkuQWH-SYoB7Xzy-9Hkg2Kk8ipxKQY';
const EXPORT_FOLDER_ID = '1rmmgf2rQ_VULLhKsC1jGdtaOc2QTrBgi'; // Shared Drive: "Forecast exports"
const FORECAST_TAB = 'BQ Forecast P2';
const AUDIT_TAB = 'BQ Audit Trail';
const MONTE_CARLO_TAB = 'BQ Monte Carlo';
const RATES_TAB = 'BQ Rates and Days';
const SQO_TARGETS_TAB = 'BQ SQO Targets';

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
    ['SQO \u2192 SP Rate', flatRates.sqo_to_sp, `=${r}!$B$6`, `${(flatRates.sqo_to_sp * 100).toFixed(1)}%`],
    // Row 7
    ['SP \u2192 Negotiating Rate', flatRates.sp_to_neg, `=${r}!$B$7`, `${(flatRates.sp_to_neg * 100).toFixed(1)}%`],
    // Row 8
    ['Neg \u2192 Signed Rate', flatRates.neg_to_signed, `=${r}!$B$8`, `${(flatRates.neg_to_signed * 100).toFixed(1)}%`],
    // Row 9
    ['Signed \u2192 Joined Rate', flatRates.signed_to_joined, `=${r}!$B$9`, `${(flatRates.signed_to_joined * 100).toFixed(1)}%`],
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
function buildRatesAndDaysValues(auditRowCount: number): any[][] {
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

    const [p2RowsRaw, auditRows, tieredRates, dateRevisionMap, joinedByQuarter, dbTargets] = await Promise.all([
      getForecastExportP2(),
      getForecastExportAudit(windowDays ?? null),
      getTieredForecastRates(windowDays ?? null),
      getDateRevisionMap(),
      getJoinedAumByQuarter(),
      prisma.forecastQuarterTarget.findMany(),
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

    // Create a new blank spreadsheet (avoids template copy which eats service account quota)
    const userName = session.user.name || session.user.email || 'Unknown';
    const dateStr = new Date().toISOString().split('T')[0];
    const windowLabel = windowDays ? `${windowDays}d` : 'all-time';
    const newName = `Pipeline Forecast — ${dateStr} — ${userName} (${windowLabel})`;

    console.log(`[Forecast Export] Creating new spreadsheet "${newName}" in shared drive...`);
    const createResp = await drive.files.create({
      requestBody: {
        name: newName,
        mimeType: 'application/vnd.google-apps.spreadsheet',
        parents: [EXPORT_FOLDER_ID],
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
    const ratesValues = buildRatesAndDaysValues(auditRows.length);
    const projectedAumByQuarter: Record<string, number> = {};
    for (const row of p2Rows) {
      const q = row.projected_quarter;
      if (q) {
        projectedAumByQuarter[q] = (projectedAumByQuarter[q] ?? 0) + (row.expected_aum_weighted ?? 0);
      }
    }
    const sqoTargetsValues = buildSQOTargetsValues(targetAumByQuarter, tieredRates.flat, joinedByQuarter, projectedAumByQuarter);

    // Write all tabs to the NEW sheet
    await writeTab(sheets, newSheetId, FORECAST_TAB, p2Values);
    console.log(`[Forecast Export] P2 tab written`);
    await writeTab(sheets, newSheetId, AUDIT_TAB, auditValues);
    console.log(`[Forecast Export] Audit tab written`);
    await writeTab(sheets, newSheetId, MONTE_CARLO_TAB, mcValues);
    console.log(`[Forecast Export] Monte Carlo tab written`);
    await writeTab(sheets, newSheetId, RATES_TAB, ratesValues);
    console.log(`[Forecast Export] Rates tab written`);

    // Create named ranges that the P2 tab formulas reference
    // These point to cells in the "BQ Rates and Days" tab
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
        // Helper: create a named range pointing to a single cell in the Rates tab
        const namedRanges: { name: string; row: number; col: number }[] = [
          // Flat rates (rows 6-9, col B=1)
          { name: 'SQO_to_SP_rate', row: 5, col: 1 },
          { name: 'SP_to_Neg_rate', row: 6, col: 1 },
          { name: 'Neg_to_Signed_rate', row: 7, col: 1 },
          { name: 'Signed_to_Joined_rate', row: 8, col: 1 },
          { name: 'SQO_to_Joined_rate', row: 9, col: 1 },
          // Lower tier rates (rows 14-17, col B=1)
          { name: 'Lower_SQO_to_SP_rate', row: 13, col: 1 },
          { name: 'Lower_SP_to_Neg_rate', row: 14, col: 1 },
          { name: 'Lower_Neg_to_Signed_rate', row: 15, col: 1 },
          { name: 'Lower_Signed_to_Joined_rate', row: 16, col: 1 },
          // Upper tier rates (rows 22-25, col B=1)
          { name: 'Upper_SQO_to_SP_rate', row: 21, col: 1 },
          { name: 'Upper_SP_to_Neg_rate', row: 22, col: 1 },
          { name: 'Upper_Neg_to_Signed_rate', row: 23, col: 1 },
          { name: 'Upper_Signed_to_Joined_rate', row: 24, col: 1 },
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

    await writeTab(sheets, newSheetId, SQO_TARGETS_TAB, sqoTargetsValues);
    console.log(`[Forecast Export] SQO Targets tab written`);

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
