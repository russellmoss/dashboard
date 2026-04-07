import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { getActivityBreakdownExportData } from '@/lib/queries/sga-activity';
import { TrailingWeeksOption, METRIC_TYPES, METRIC_DISPLAY_NAMES, ActivityBreakdownAuditRow } from '@/types/sga-activity';
import { logger } from '@/lib/logger';
import ExcelJS from 'exceljs';

export const dynamic = 'force-dynamic';

const VALID_TRAILING_WEEKS = [4, 6, 8, 12];

const HEADER_STYLE: Partial<ExcelJS.Style> = {
  font: { bold: true, color: { argb: 'FFFFFFFF' } },
  fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5496' } },
  alignment: { horizontal: 'center', wrapText: true },
};

function applyHeaderStyle(cell: ExcelJS.Cell) {
  cell.font = HEADER_STYLE.font!;
  cell.fill = HEADER_STYLE.fill as ExcelJS.FillPattern;
  cell.alignment = HEADER_STYLE.alignment!;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }

    if (!['admin', 'manager', 'sga', 'sgm', 'revops_admin'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { trailingWeeks = 4 } = body;

    if (!VALID_TRAILING_WEEKS.includes(trailingWeeks)) {
      return NextResponse.json({ error: 'Invalid trailingWeeks' }, { status: 400 });
    }

    // SGA role self-filter
    let sgaName: string | undefined;
    if (permissions.role === 'sga' && permissions.sgaFilter) {
      sgaName = permissions.sgaFilter;
    }

    const { aggregation, auditRows, weekBounds } = await getActivityBreakdownExportData(
      trailingWeeks as TrailingWeeksOption,
      sgaName
    );

    // Build week bucket keys in display order: This Week, Last Week, Wk 1 (most recent), Wk 2, ...
    const formatDateRange = (start: string, end: string) => {
      const s = start.slice(5); // MM-DD
      const e = end.slice(5);
      return `${s} to ${e}`;
    };
    const trailingKeys = weekBounds.trailingWeeks
      .sort((a, b) => a.weekNum - b.weekNum) // ascending: 1 (most recent) to N (oldest)
      .map(tw => `Trailing_${tw.weekNum}`);
    const weekKeys = ['This_Week', 'Last_Week', ...trailingKeys];

    // Build week header labels matching same order
    const trailingHeaders = weekBounds.trailingWeeks
      .sort((a, b) => a.weekNum - b.weekNum)
      .map(tw => `Wk ${tw.weekNum} (${formatDateRange(tw.start, tw.end)})`);
    const weekHeaders = [
      `This Wk (${formatDateRange(weekBounds.thisWeek.start, weekBounds.thisWeek.end)})`,
      `Last Wk (${formatDateRange(weekBounds.lastWeek.start, weekBounds.lastWeek.end)})`,
      ...trailingHeaders,
    ];

    // Get unique SGA names from aggregation
    const sgaNames = [...new Set(aggregation.map(r => r.sgaName))].sort();

    const AUDIT_SHEET = 'Audit Trail';
    const auditRowCount = auditRows.length;
    const auditLastRow = auditRowCount + 1;

    // Create workbook
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Savvy Analytics';

    // Create sheets in tab order: Summary, Activity by Metric, Audit Trail, Methodology
    const ws2 = wb.addWorksheet('Summary - Total Activity', { views: [{ state: 'frozen', xSplit: 1, ySplit: 2 }] });
    const ws1 = wb.addWorksheet('Activity by Metric', { views: [{ state: 'frozen', xSplit: 2, ySplit: 3 }] });
    const wsAudit = wb.addWorksheet(AUDIT_SHEET, { views: [{ state: 'frozen', ySplit: 1 }] });
    const ws3 = wb.addWorksheet('Methodology');

    // ==========================================
    // Audit Trail sheet
    // ==========================================
    wsAudit.columns = [
      { header: 'Task_ID', key: 'task_id', width: 22 },
      { header: 'SGA_Name', key: 'sga_name', width: 20 },
      { header: 'Activity_Date', key: 'activity_date', width: 14 },
      { header: 'Week_Bucket', key: 'week_bucket', width: 16 },
      { header: 'Metric_Type', key: 'metric_type', width: 18 },
      { header: 'Channel_Group', key: 'channel_group', width: 18 },
      { header: 'Direction', key: 'direction', width: 12 },
      { header: 'Task_Subject', key: 'task_subject', width: 40 },
    ];
    const ah = wsAudit.getRow(1);
    for (let i = 1; i <= 8; i++) applyHeaderStyle(ah.getCell(i));

    for (const rec of auditRows) {
      wsAudit.addRow({
        task_id: rec.taskId,
        sga_name: rec.sgaName,
        activity_date: rec.activityDate,
        week_bucket: rec.weekBucket,
        metric_type: rec.metricType,
        channel_group: rec.channelGroup,
        direction: rec.direction,
        task_subject: rec.subject,
      });
    }
    wsAudit.autoFilter = { from: 'A1', to: 'H1' };

    // Named ranges
    const auditRef = (col: string) => `'${AUDIT_SHEET}'!$${col}$2:$${col}$${auditLastRow}`;
    wb.definedNames.add(auditRef('B'), 'Audit_SGA');
    wb.definedNames.add(auditRef('D'), 'Audit_Week');
    wb.definedNames.add(auditRef('E'), 'Audit_Metric');
    wb.definedNames.add(auditRef('A'), 'Audit_TaskID');

    // ==========================================
    // Sheet 1: Activity by Metric
    // ==========================================
    const weekColCount = weekKeys.length;
    const totalCols = 2 + weekColCount + 4; // SGA, Metric, weeks, Avg, Delta, %Change, Direction

    // Title rows
    ws1.mergeCells(1, 1, 1, totalCols);
    ws1.getCell('A1').value = `SGA Activity: Last Week vs Trailing ${trailingWeeks}-Week Average`;
    ws1.getCell('A1').font = { bold: true, size: 14 };
    ws1.getCell('A1').alignment = { horizontal: 'center' };
    ws1.mergeCells(2, 1, 2, totalCols);
    ws1.getCell('A2').value = `Generated ${new Date().toISOString().slice(0, 10)} | All values are COUNTIFS formulae against "${AUDIT_SHEET}" sheet`;
    ws1.getCell('A2').font = { italic: true, size: 10, color: { argb: 'FF666666' } };
    ws1.getCell('A2').alignment = { horizontal: 'center' };

    // Headers (row 3)
    const headers1 = ['SGA', 'Metric', ...weekHeaders, `Trailing ${trailingWeeks}-Wk Avg`, 'Delta', '% Change', 'Direction'];
    const hr1 = ws1.getRow(3);
    headers1.forEach((h, i) => {
      const c = hr1.getCell(i + 1);
      c.value = h;
      applyHeaderStyle(c);
    });

    // Column indices (1-indexed, offset by 2 for SGA + Metric columns)
    const lastWeekCol = 2 + weekKeys.indexOf('Last_Week') + 1;
    const lastWeekLetter = colLetter(lastWeekCol);
    // Trailing week columns start after This_Week and Last_Week
    const trailingStartCol = 2 + weekKeys.indexOf(trailingKeys[0]) + 1;
    const trailingEndCol = 2 + weekKeys.indexOf(trailingKeys[trailingKeys.length - 1]) + 1;
    const trailingStartLetter = colLetter(trailingStartCol);
    const trailingEndLetter = colLetter(trailingEndCol);
    const avgCol = 2 + weekColCount + 1;
    const deltaCol = avgCol + 1;
    const pctCol = deltaCol + 1;
    const dirCol = pctCol + 1;
    const avgLetter = colLetter(avgCol);
    const deltaLetter = colLetter(deltaCol);
    const pctLetter = colLetter(pctCol);
    const dirLetter = colLetter(dirCol);

    let row = 4;
    for (const sga of sgaNames) {
      const sgaStart = row;

      for (const metric of METRIC_TYPES) {
        const r = ws1.getRow(row);
        r.getCell(1).value = sga;
        if (row === sgaStart) r.getCell(1).font = { bold: true };
        r.getCell(2).value = METRIC_DISPLAY_NAMES[metric];

        // Week columns — COUNTIFS formulas
        for (let w = 0; w < weekKeys.length; w++) {
          const col = 3 + w;
          r.getCell(col).value = {
            formula: `COUNTIFS(Audit_SGA,"${sga}",Audit_Metric,"${metric}",Audit_Week,"${weekKeys[w]}")`
          };
          r.getCell(col).numFmt = '#,##0';
        }

        // Trailing Avg
        r.getCell(avgCol).value = { formula: `AVERAGE(${trailingStartLetter}${row}:${trailingEndLetter}${row})` };
        r.getCell(avgCol).numFmt = '#,##0.0';

        // Delta
        r.getCell(deltaCol).value = { formula: `${lastWeekLetter}${row}-${avgLetter}${row}` };
        r.getCell(deltaCol).numFmt = '+#,##0.0;-#,##0.0;0';

        // % Change
        r.getCell(pctCol).value = { formula: `IF(${avgLetter}${row}=0,IF(${lastWeekLetter}${row}>0,1,0),(${lastWeekLetter}${row}-${avgLetter}${row})/${avgLetter}${row})` };
        r.getCell(pctCol).numFmt = '0.0%';

        // Direction
        r.getCell(dirCol).value = { formula: `IF(${lastWeekLetter}${row}>${avgLetter}${row},"UP",IF(${lastWeekLetter}${row}<${avgLetter}${row},"DOWN","FLAT"))` };

        row++;
      }

      // TOTAL row
      const tr = ws1.getRow(row);
      tr.getCell(1).value = sga;
      tr.getCell(2).value = 'TOTAL';
      tr.getCell(2).font = { bold: true, color: { argb: 'FF2F5496' } };

      for (let c = 3; c <= 2 + weekColCount; c++) {
        const L = colLetter(c);
        tr.getCell(c).value = { formula: `SUM(${L}${sgaStart}:${L}${row - 1})` };
        tr.getCell(c).numFmt = '#,##0';
        tr.getCell(c).font = { bold: true };
      }
      tr.getCell(avgCol).value = { formula: `AVERAGE(${trailingStartLetter}${row}:${trailingEndLetter}${row})` };
      tr.getCell(avgCol).numFmt = '#,##0.0'; tr.getCell(avgCol).font = { bold: true };
      tr.getCell(deltaCol).value = { formula: `${lastWeekLetter}${row}-${avgLetter}${row}` };
      tr.getCell(deltaCol).numFmt = '+#,##0.0;-#,##0.0;0'; tr.getCell(deltaCol).font = { bold: true };
      tr.getCell(pctCol).value = { formula: `IF(${avgLetter}${row}=0,IF(${lastWeekLetter}${row}>0,1,0),(${lastWeekLetter}${row}-${avgLetter}${row})/${avgLetter}${row})` };
      tr.getCell(pctCol).numFmt = '0.0%'; tr.getCell(pctCol).font = { bold: true };
      tr.getCell(dirCol).value = { formula: `IF(${lastWeekLetter}${row}>${avgLetter}${row},"UP",IF(${lastWeekLetter}${row}<${avgLetter}${row},"DOWN","FLAT"))` };
      tr.getCell(dirCol).font = { bold: true };

      for (let c = 1; c <= totalCols; c++) tr.getCell(c).border = { bottom: { style: 'medium' } };
      row += 2; // spacer
    }

    // Conditional formatting for direction
    ws1.addConditionalFormatting({ ref: `${dirLetter}4:${dirLetter}${row}`, rules: [
      { type: 'containsText', operator: 'containsText', text: 'UP', style: { font: { color: { argb: 'FF008000' }, bold: true } } } as any,
      { type: 'containsText', operator: 'containsText', text: 'DOWN', style: { font: { color: { argb: 'FFCC0000' }, bold: true } } } as any,
    ]});

    // ==========================================
    // Sheet 2: Summary — Total Activity
    // ==========================================
    const summCols = 1 + weekColCount + 4; // SGA, weeks, Avg, Delta, %Change, Direction
    ws2.mergeCells(1, 1, 1, summCols);
    ws2.getCell('A1').value = `SGA Total Activity Summary: Last Week vs Trailing ${trailingWeeks}-Week Average`;
    ws2.getCell('A1').font = { bold: true, size: 14 };
    ws2.getCell('A1').alignment = { horizontal: 'center' };

    const headers2 = ['SGA', ...weekHeaders, `Trailing ${trailingWeeks}-Wk Avg`, 'Delta', '% Change', 'Direction'];
    const h2r = ws2.getRow(2);
    headers2.forEach((h, i) => {
      const c = h2r.getCell(i + 1);
      c.value = h;
      applyHeaderStyle(c);
    });

    // Summary column indices (1-indexed, no Metric column)
    const sLastWeekCol = 1 + weekKeys.indexOf('Last_Week') + 1;
    const sLastWeekLetter = colLetter(sLastWeekCol);
    // Summary sheet: offset by 1 (SGA column only, no Metric column)
    const sTrailStartCol = 1 + weekKeys.indexOf(trailingKeys[0]) + 1;
    const sTrailEndCol = 1 + weekKeys.indexOf(trailingKeys[trailingKeys.length - 1]) + 1;
    const sTrailStartLetter = colLetter(sTrailStartCol);
    const sTrailEndLetter = colLetter(sTrailEndCol);
    const sAvgCol = 1 + weekColCount + 1;
    const sDeltaCol = sAvgCol + 1;
    const sPctCol = sDeltaCol + 1;
    const sDirCol = sPctCol + 1;
    const sAvgLetter = colLetter(sAvgCol);
    const sDirLetter = colLetter(sDirCol);

    let r2 = 3;
    for (const sga of sgaNames) {
      const sr = ws2.getRow(r2);
      sr.getCell(1).value = sga;
      sr.getCell(1).font = { bold: true };

      for (let w = 0; w < weekKeys.length; w++) {
        sr.getCell(2 + w).value = {
          formula: `COUNTIFS(Audit_SGA,"${sga}",Audit_Week,"${weekKeys[w]}")`
        };
        sr.getCell(2 + w).numFmt = '#,##0';
      }

      sr.getCell(sAvgCol).value = { formula: `AVERAGE(${sTrailStartLetter}${r2}:${sTrailEndLetter}${r2})` };
      sr.getCell(sAvgCol).numFmt = '#,##0.0';
      sr.getCell(sDeltaCol).value = { formula: `${sLastWeekLetter}${r2}-${sAvgLetter}${r2}` };
      sr.getCell(sDeltaCol).numFmt = '+#,##0.0;-#,##0.0;0';
      sr.getCell(sPctCol).value = { formula: `IF(${sAvgLetter}${r2}=0,IF(${sLastWeekLetter}${r2}>0,1,0),(${sLastWeekLetter}${r2}-${sAvgLetter}${r2})/${sAvgLetter}${r2})` };
      sr.getCell(sPctCol).numFmt = '0.0%';
      sr.getCell(sDirCol).value = { formula: `IF(${sLastWeekLetter}${r2}>${sAvgLetter}${r2},"UP",IF(${sLastWeekLetter}${r2}<${sAvgLetter}${r2},"DOWN","FLAT"))` };

      r2++;
    }

    // TEAM TOTAL row
    const teamRow = ws2.getRow(r2);
    teamRow.getCell(1).value = 'TEAM TOTAL';
    teamRow.getCell(1).font = { bold: true, color: { argb: 'FF2F5496' } };
    for (let c = 2; c <= 1 + weekColCount; c++) {
      const L = colLetter(c);
      teamRow.getCell(c).value = { formula: `SUM(${L}3:${L}${r2 - 1})` };
      teamRow.getCell(c).numFmt = '#,##0';
      teamRow.getCell(c).font = { bold: true };
    }
    teamRow.getCell(sAvgCol).value = { formula: `AVERAGE(${sTrailStartLetter}${r2}:${sTrailEndLetter}${r2})` };
    teamRow.getCell(sAvgCol).numFmt = '#,##0.0'; teamRow.getCell(sAvgCol).font = { bold: true };
    teamRow.getCell(sDeltaCol).value = { formula: `${sLastWeekLetter}${r2}-${sAvgLetter}${r2}` };
    teamRow.getCell(sDeltaCol).numFmt = '+#,##0.0;-#,##0.0;0'; teamRow.getCell(sDeltaCol).font = { bold: true };
    teamRow.getCell(sPctCol).value = { formula: `IF(${sAvgLetter}${r2}=0,IF(${sLastWeekLetter}${r2}>0,1,0),(${sLastWeekLetter}${r2}-${sAvgLetter}${r2})/${sAvgLetter}${r2})` };
    teamRow.getCell(sPctCol).numFmt = '0.0%'; teamRow.getCell(sPctCol).font = { bold: true };
    teamRow.getCell(sDirCol).value = { formula: `IF(${sLastWeekLetter}${r2}>${sAvgLetter}${r2},"UP",IF(${sLastWeekLetter}${r2}<${sAvgLetter}${r2},"DOWN","FLAT"))` };
    teamRow.getCell(sDirCol).font = { bold: true };
    for (let c = 1; c <= summCols; c++) teamRow.getCell(c).border = { top: { style: 'medium' }, bottom: { style: 'double' } };

    ws2.addConditionalFormatting({ ref: `${sDirLetter}3:${sDirLetter}${r2}`, rules: [
      { type: 'containsText', operator: 'containsText', text: 'UP', style: { font: { color: { argb: 'FF008000' }, bold: true } } } as any,
      { type: 'containsText', operator: 'containsText', text: 'DOWN', style: { font: { color: { argb: 'FFCC0000' }, bold: true } } } as any,
    ]});

    // ==========================================
    // Sheet 3: Methodology
    // ==========================================
    ws3.columns = [{ width: 30 }, { width: 90 }];
    const mh = ws3.getRow(1);
    mh.getCell(1).value = 'Field'; mh.getCell(2).value = 'Value';
    applyHeaderStyle(mh.getCell(1)); applyHeaderStyle(mh.getCell(2));

    const trailingBounds = weekBounds.trailingWeeks.sort((a, b) => a.weekNum - b.weekNum);
    const methData: [string, string][] = [
      ['Report', `SGA Activity — Last Week vs Trailing ${trailingWeeks}-Week Average`],
      ['Generated', new Date().toISOString()],
      ['Last Week Period', `${weekBounds.lastWeek.start} to ${weekBounds.lastWeek.end} (Mon-Sun)`],
      ...trailingBounds.map(tw => [`Trailing Week ${tw.weekNum}`, `${tw.start} to ${tw.end}`] as [string, string]),
      ['This Week Period', `${weekBounds.thisWeek.start} to ${weekBounds.thisWeek.end} (in progress)`],
      ['', ''],
      ['DATA SOURCE', ''],
      ['View', 'savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance'],
      ['SGA Filter', 'INNER JOIN SavvyGTMData.User WHERE IsSGA__c=TRUE AND IsActive=TRUE, plus name exclusion list'],
      ['Activity Filter', 'is_marketing_activity=0, lemlist campaign tasks excluded from Scheduled_Call'],
      ['Deduplication', `One row per unique task_id in Audit Trail sheet (COUNT(DISTINCT task_id))`],
      ['', ''],
      ['METRIC DEFINITIONS', ''],
      ['Cold_Call', 'activity_channel_group=Call AND Outbound AND (no scheduled date OR date mismatch) AND task_subject NOT LIKE [lemlist]'],
      ['Scheduled_Call', 'activity_channel_group=Call AND Outbound AND task_created_date_est matches Initial_Call_Scheduled_Date__c AND task_subject NOT LIKE [lemlist]'],
      ['Outbound_SMS', 'activity_channel_group=SMS AND direction=Outbound'],
      ['LinkedIn', 'activity_channel_group=LinkedIn'],
      ['Manual_Email', 'activity_channel_group=Email AND is_engagement_tracking=0 AND is_marketing_activity=0'],
      ['Email_Engagement', 'activity_channel_group=Email(Engagement) OR (Email AND is_engagement_tracking=1)'],
      ['', ''],
      ['FORMULA CHAIN', ''],
      ['Activity by Metric — weekly cells', 'COUNTIFS(Audit_SGA, [sga], Audit_Metric, [metric], Audit_Week, [week])'],
      ['Activity by Metric — TOTAL row', 'SUM of the 6 metric rows above'],
      [`Activity by Metric — ${trailingWeeks}-Wk Avg`, `AVERAGE(Trailing_${trailingWeeks}..Trailing_1)`],
      ['Activity by Metric — Delta', 'Last_Week - Trailing_Avg'],
      ['Activity by Metric — % Change', 'IF(avg=0, IF(last>0, 100%, 0%), (last-avg)/avg)'],
      ['Summary — weekly cells', 'COUNTIFS(Audit_SGA, [sga], Audit_Week, [week]) — all metrics'],
      ['Summary — TEAM TOTAL', 'SUM of individual SGA rows'],
      ['', ''],
      ['EXCLUSION LIST', 'Anett Diaz, Ariana Butler, Bre McDaniel, Bryan Belville, GinaRose Galli, Jacqueline Tully, Jed Entin, Russell Moss, Savvy Marketing, Savvy Operations, Lauren George'],
      ['SGAs Included', sgaNames.join(', ')],
      ['Audit Trail Records', `${auditRows.length} unique tasks`],
    ];
    for (const [f, v] of methData) {
      const addedRow = ws3.addRow([f, v]);
      if (f.endsWith('DEFINITIONS') || f.endsWith('CHAIN') || f === 'DATA SOURCE' || f === 'EXCLUSION LIST') {
        addedRow.getCell(1).font = { bold: true, color: { argb: 'FF2F5496' } };
      }
    }

    // Write buffer
    const buffer = await wb.xlsx.writeBuffer();

    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="sga-activity-breakdown-${trailingWeeks}wk.xlsx"`,
      },
    });
  } catch (error: any) {
    logger.error('Activity breakdown export error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error?.message },
      { status: 500 }
    );
  }
}

/** Convert 1-indexed column number to Excel letter(s) */
function colLetter(n: number): string {
  let result = '';
  while (n > 0) {
    n--;
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
}
