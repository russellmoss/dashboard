const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

// ============================================================
// 16 active SGAs (IsSGA__c=TRUE, IsActive=TRUE, minus exclusion list)
// ============================================================
const SGAS = [
  'Amy Waller', "Brian O'Hara", 'Channing Guyer', 'Craig Suchodolski',
  'Dan Clifford', 'Eleni Stefanopoulos', 'Helen Kamens', 'Holly Huffman',
  'Jason Ainsworth', 'Kai Jean-Simon', 'Katie Bassford', 'Marisa Saucedo',
  'Perry Kalmeta', 'Rashard Wade', 'Russell Armitage', 'Ryan Crandall'
];

const METRICS = ['Cold_Call', 'Scheduled_Call', 'Outbound_SMS', 'LinkedIn', 'Manual_Email', 'Email_Engagement'];
const METRIC_LABELS = {
  Cold_Call: 'Cold Calls', Scheduled_Call: 'Scheduled Calls', Outbound_SMS: 'Outbound SMS',
  LinkedIn: 'LinkedIn', Manual_Email: 'Manual Email', Email_Engagement: 'Email Engagement'
};
const WEEK_KEYS = ['Week_1', 'Week_2', 'Week_3', 'Week_4', 'Last_Week'];
const WEEK_HEADERS = ['Wk 1 (3/2-3/6)', 'Wk 2 (3/9-3/13)', 'Wk 3 (3/16-3/20)', 'Wk 4 (3/23-3/27)', 'Last Wk (3/30-4/3)'];

const RAW_RESULTS_FILE = path.join(
  'C:\\Users\\russe\\.claude\\projects\\C--Users-russe-documents-dashboard\\f47e4ffc-7537-4713-875c-c083bb22ddd6\\tool-results',
  'mcp-bigquery-execute_sql-1775486863637.txt'
);

const headerStyle = {
  font: { bold: true, color: { argb: 'FFFFFFFF' } },
  fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5496' } },
  alignment: { horizontal: 'center', wrapText: true },
};

function applyHeaderStyle(cell) {
  cell.font = headerStyle.font;
  cell.fill = headerStyle.fill;
  cell.alignment = headerStyle.alignment;
}

async function generate() {
  // ============================================================
  // Step 1: Load and deduplicate raw records by task_id
  // ============================================================
  console.log('Loading raw records...');
  const rawContent = fs.readFileSync(RAW_RESULTS_FILE, 'utf8');
  const rawItems = JSON.parse(rawContent);

  const activeSgaSet = new Set(SGAS);
  const seen = new Set();
  const records = [];

  for (const item of rawItems) {
    if (item.type !== 'text') continue;
    const rec = JSON.parse(item.text);
    if (!rec.metric_type || rec.metric_type === 'EXCLUDED') continue;
    if (!rec.week_bucket) continue;
    if (!activeSgaSet.has(rec.sga_name)) continue;
    if (seen.has(rec.task_id)) continue;
    seen.add(rec.task_id);
    records.push(rec);
  }

  // Sort: SGA name → activity date → task_id
  records.sort((a, b) =>
    a.sga_name.localeCompare(b.sga_name) ||
    a.task_activity_date.localeCompare(b.task_activity_date) ||
    a.task_id.localeCompare(b.task_id)
  );

  console.log(`Deduplicated: ${records.length} unique task records (from ${seen.size} task IDs)`);

  const auditRowCount = records.length; // data rows (header on row 1)
  const auditLastRow = auditRowCount + 1; // +1 for header row

  // ============================================================
  // Step 2: Build workbook
  // ============================================================
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Savvy Analytics';
  wb.created = new Date();

  // ============================================================
  // Create all sheets in display order first, populate later
  // ============================================================
  const AUDIT_SHEET = 'Audit Trail';
  const ws1 = wb.addWorksheet('Activity by Metric', { views: [{ state: 'frozen', xSplit: 2, ySplit: 3 }] });
  const ws2 = wb.addWorksheet('Summary - Total Activity', { views: [{ state: 'frozen', xSplit: 1, ySplit: 2 }] });
  const ws3 = wb.addWorksheet('Methodology');
  const wsAudit = wb.addWorksheet(AUDIT_SHEET, { views: [{ state: 'frozen', ySplit: 1 }] });
  wsAudit.columns = [
    { header: 'Task_ID', key: 'task_id', width: 22 },
    { header: 'SGA_Name', key: 'sga_name', width: 20 },
    { header: 'Activity_Date', key: 'activity_date', width: 14 },
    { header: 'Week_Bucket', key: 'week_bucket', width: 16 },
    { header: 'Metric_Type', key: 'metric_type', width: 18 },
    { header: 'Channel_Group', key: 'channel_group', width: 18 },
    { header: 'Direction', key: 'direction', width: 12 },
    { header: 'Task_Subject', key: 'task_subject', width: 40 },
    { header: 'Is_Cold_Call', key: 'is_cold_call', width: 12 },
    { header: 'Is_Engagement', key: 'is_engagement', width: 14 },
  ];
  const ah = wsAudit.getRow(1);
  for (let i = 1; i <= 10; i++) applyHeaderStyle(ah.getCell(i));

  for (const rec of records) {
    wsAudit.addRow({
      task_id: rec.task_id,
      sga_name: rec.sga_name,
      activity_date: rec.task_activity_date,
      week_bucket: rec.week_bucket,
      metric_type: rec.metric_type,
      channel_group: rec.activity_channel_group,
      direction: rec.direction,
      task_subject: rec.task_subject,
      is_cold_call: rec.is_true_cold_call,
      is_engagement: rec.is_engagement_tracking,
    });
  }
  wsAudit.autoFilter = { from: 'A1', to: 'J1' };

  // ============================================================
  // Define named ranges referencing the audit trail columns
  // ============================================================
  const auditRef = (col) => `'${AUDIT_SHEET}'!$${col}$2:$${col}$${auditLastRow}`;
  // ExcelJS: definedNames.add(value, name)  — value is the cell ref, name is the range name
  wb.definedNames.add(auditRef('B'), 'Audit_SGA');
  wb.definedNames.add(auditRef('D'), 'Audit_Week');
  wb.definedNames.add(auditRef('E'), 'Audit_Metric');
  wb.definedNames.add(auditRef('A'), 'Audit_TaskID');

  console.log(`Named ranges defined: Audit_SGA, Audit_Week, Audit_Metric, Audit_TaskID (rows 2-${auditLastRow})`);

  // ============================================================
  // Sheet 1: Activity by Metric
  // Every data cell is a COUNTIFS formula against the audit trail
  // ============================================================
  ws1.columns = [
    { width: 22 }, { width: 18 }, { width: 15 }, { width: 15 },
    { width: 15 }, { width: 15 }, { width: 17 }, { width: 17 },
    { width: 13 }, { width: 13 }, { width: 12 },
  ];

  // Title rows
  ws1.mergeCells('A1:K1');
  ws1.getCell('A1').value = 'SGA Activity: Last Week (3/30-4/3) vs Trailing 4-Week Average (3/2-3/27)';
  ws1.getCell('A1').font = { bold: true, size: 14 };
  ws1.getCell('A1').alignment = { horizontal: 'center' };
  ws1.mergeCells('A2:K2');
  ws1.getCell('A2').value = `Generated ${new Date().toISOString().slice(0, 10)} | All values are COUNTIFS formulae against "${AUDIT_SHEET}" sheet | COUNT(DISTINCT task_id)`;
  ws1.getCell('A2').font = { italic: true, size: 10, color: { argb: 'FF666666' } };
  ws1.getCell('A2').alignment = { horizontal: 'center' };

  // Headers (row 3)
  const h1 = ['SGA', 'Metric', ...WEEK_HEADERS, 'Trailing 4-Wk Avg', 'Delta', '% Change', 'Direction'];
  const hr1 = ws1.getRow(3);
  h1.forEach((h, i) => { const c = hr1.getCell(i + 1); c.value = h; applyHeaderStyle(c); c.border = { bottom: { style: 'thin' } }; });

  let row = 4;
  for (const sga of SGAS) {
    const sgaStart = row;
    // No escaping needed for COUNTIFS string criteria — apostrophes are literal
    const sgaEsc = sga;

    for (const metric of METRICS) {
      const r = ws1.getRow(row);
      r.getCell(1).value = sga;
      if (row === sgaStart) r.getCell(1).font = { bold: true };
      r.getCell(2).value = METRIC_LABELS[metric];

      // Weeks 1-4 (cols C-F) — COUNTIFS against audit trail
      for (let w = 0; w < 4; w++) {
        const col = 3 + w;
        r.getCell(col).value = {
          formula: `COUNTIFS(Audit_SGA,"${sgaEsc}",Audit_Metric,"${metric}",Audit_Week,"${WEEK_KEYS[w]}")`
        };
        r.getCell(col).numFmt = '#,##0';
      }

      // Last Week (col G=7)
      r.getCell(7).value = {
        formula: `COUNTIFS(Audit_SGA,"${sgaEsc}",Audit_Metric,"${metric}",Audit_Week,"Last_Week")`
      };
      r.getCell(7).numFmt = '#,##0';
      r.getCell(7).font = { bold: true };

      // Trailing 4-Wk Avg (col H=8)
      r.getCell(8).value = { formula: `AVERAGE(C${row}:F${row})` };
      r.getCell(8).numFmt = '#,##0.0';

      // Delta (col I=9)
      r.getCell(9).value = { formula: `G${row}-H${row}` };
      r.getCell(9).numFmt = '+#,##0.0;-#,##0.0;0';

      // % Change (col J=10)
      r.getCell(10).value = { formula: `IF(H${row}=0,IF(G${row}>0,1,0),(G${row}-H${row})/H${row})` };
      r.getCell(10).numFmt = '0.0%';

      // Direction (col K=11)
      r.getCell(11).value = { formula: `IF(G${row}>H${row},"UP",IF(G${row}<H${row},"DOWN","FLAT"))` };

      row++;
    }

    // TOTAL row — SUM of the 6 metric rows above
    const tr = ws1.getRow(row);
    tr.getCell(1).value = sga;
    tr.getCell(2).value = 'TOTAL';
    tr.getCell(2).font = { bold: true, color: { argb: 'FF2F5496' } };

    for (let c = 3; c <= 7; c++) {
      const L = String.fromCharCode(64 + c);
      tr.getCell(c).value = { formula: `SUM(${L}${sgaStart}:${L}${row - 1})` };
      tr.getCell(c).numFmt = '#,##0';
      tr.getCell(c).font = { bold: true };
    }
    tr.getCell(8).value = { formula: `AVERAGE(C${row}:F${row})` };
    tr.getCell(8).numFmt = '#,##0.0'; tr.getCell(8).font = { bold: true };
    tr.getCell(9).value = { formula: `G${row}-H${row}` };
    tr.getCell(9).numFmt = '+#,##0.0;-#,##0.0;0'; tr.getCell(9).font = { bold: true };
    tr.getCell(10).value = { formula: `IF(H${row}=0,IF(G${row}>0,1,0),(G${row}-H${row})/H${row})` };
    tr.getCell(10).numFmt = '0.0%'; tr.getCell(10).font = { bold: true };
    tr.getCell(11).value = { formula: `IF(G${row}>H${row},"UP",IF(G${row}<H${row},"DOWN","FLAT"))` };
    tr.getCell(11).font = { bold: true };

    for (let c = 1; c <= 11; c++) tr.getCell(c).border = { bottom: { style: 'medium' } };
    row += 2; // spacer
  }

  // Conditional formatting for direction
  ws1.addConditionalFormatting({ ref: `K4:K${row}`, rules: [
    { type: 'containsText', operator: 'containsText', text: 'UP', style: { font: { color: { argb: 'FF008000' }, bold: true } } },
    { type: 'containsText', operator: 'containsText', text: 'DOWN', style: { font: { color: { argb: 'FFCC0000' }, bold: true } } },
  ]});

  // ============================================================
  // Sheet 2: Summary — Total Activity
  // Every weekly cell is a COUNTIFS against audit trail (all metrics for that SGA+week)
  // ============================================================
  ws2.columns = [
    { width: 22 }, { width: 15 }, { width: 15 }, { width: 15 },
    { width: 15 }, { width: 17 }, { width: 17 }, { width: 13 },
    { width: 13 }, { width: 12 },
  ];

  ws2.mergeCells('A1:J1');
  ws2.getCell('A1').value = 'SGA Total Activity Summary: Last Week vs Trailing 4-Week Average';
  ws2.getCell('A1').font = { bold: true, size: 14 };
  ws2.getCell('A1').alignment = { horizontal: 'center' };

  const h2Labels = ['SGA', ...WEEK_HEADERS, 'Trailing 4-Wk Avg', 'Delta', '% Change', 'Direction'];
  const h2r = ws2.getRow(2);
  h2Labels.forEach((h, i) => { const c = h2r.getCell(i + 1); c.value = h; applyHeaderStyle(c); });

  let r2 = 3;
  for (const sga of SGAS) {
    const sr = ws2.getRow(r2);
    const sgaEsc = sga;
    sr.getCell(1).value = sga;
    sr.getCell(1).font = { bold: true };

    // Weeks 1-4 (cols B-E)
    for (let w = 0; w < 4; w++) {
      sr.getCell(2 + w).value = {
        formula: `COUNTIFS(Audit_SGA,"${sgaEsc}",Audit_Week,"${WEEK_KEYS[w]}")`
      };
      sr.getCell(2 + w).numFmt = '#,##0';
    }

    // Last Week (col F=6)
    sr.getCell(6).value = {
      formula: `COUNTIFS(Audit_SGA,"${sgaEsc}",Audit_Week,"Last_Week")`
    };
    sr.getCell(6).numFmt = '#,##0';
    sr.getCell(6).font = { bold: true };

    // Trailing 4-Wk Avg (col G=7)
    sr.getCell(7).value = { formula: `AVERAGE(B${r2}:E${r2})` };
    sr.getCell(7).numFmt = '#,##0.0';

    // Delta (col H=8)
    sr.getCell(8).value = { formula: `F${r2}-G${r2}` };
    sr.getCell(8).numFmt = '+#,##0.0;-#,##0.0;0';

    // % Change (col I=9)
    sr.getCell(9).value = { formula: `IF(G${r2}=0,IF(F${r2}>0,1,0),(F${r2}-G${r2})/G${r2})` };
    sr.getCell(9).numFmt = '0.0%';

    // Direction (col J=10)
    sr.getCell(10).value = { formula: `IF(F${r2}>G${r2},"UP",IF(F${r2}<G${r2},"DOWN","FLAT"))` };

    r2++;
  }

  // Team total row
  const teamRow = ws2.getRow(r2);
  teamRow.getCell(1).value = 'TEAM TOTAL';
  teamRow.getCell(1).font = { bold: true, color: { argb: 'FF2F5496' } };
  for (let c = 2; c <= 6; c++) {
    const L = String.fromCharCode(64 + c);
    teamRow.getCell(c).value = { formula: `SUM(${L}3:${L}${r2 - 1})` };
    teamRow.getCell(c).numFmt = '#,##0';
    teamRow.getCell(c).font = { bold: true };
  }
  teamRow.getCell(7).value = { formula: `AVERAGE(B${r2}:E${r2})` };
  teamRow.getCell(7).numFmt = '#,##0.0'; teamRow.getCell(7).font = { bold: true };
  teamRow.getCell(8).value = { formula: `F${r2}-G${r2}` };
  teamRow.getCell(8).numFmt = '+#,##0.0;-#,##0.0;0'; teamRow.getCell(8).font = { bold: true };
  teamRow.getCell(9).value = { formula: `IF(G${r2}=0,IF(F${r2}>0,1,0),(F${r2}-G${r2})/G${r2})` };
  teamRow.getCell(9).numFmt = '0.0%'; teamRow.getCell(9).font = { bold: true };
  teamRow.getCell(10).value = { formula: `IF(F${r2}>G${r2},"UP",IF(F${r2}<G${r2},"DOWN","FLAT"))` };
  teamRow.getCell(10).font = { bold: true };
  for (let c = 1; c <= 10; c++) teamRow.getCell(c).border = { top: { style: 'medium' }, bottom: { style: 'double' } };

  ws2.addConditionalFormatting({ ref: `J3:J${r2}`, rules: [
    { type: 'containsText', operator: 'containsText', text: 'UP', style: { font: { color: { argb: 'FF008000' }, bold: true } } },
    { type: 'containsText', operator: 'containsText', text: 'DOWN', style: { font: { color: { argb: 'FFCC0000' }, bold: true } } },
  ]});

  // ============================================================
  // Sheet 3: Methodology
  // ============================================================
  ws3.columns = [{ width: 30 }, { width: 90 }];
  const mh = ws3.getRow(1);
  mh.getCell(1).value = 'Field'; mh.getCell(2).value = 'Value';
  applyHeaderStyle(mh.getCell(1)); applyHeaderStyle(mh.getCell(2));

  const methData = [
    ['Report', 'SGA Activity — Last Week vs Trailing 4-Week Average'],
    ['Generated', new Date().toISOString()],
    ['Last Week Period', 'Monday 2026-03-30 to Friday 2026-04-03 (5 business days)'],
    ['Trailing Week 4', 'Monday 2026-03-23 to Friday 2026-03-27'],
    ['Trailing Week 3', 'Monday 2026-03-16 to Friday 2026-03-20'],
    ['Trailing Week 2', 'Monday 2026-03-09 to Friday 2026-03-13'],
    ['Trailing Week 1', 'Monday 2026-03-02 to Friday 2026-03-06'],
    ['', ''],
    ['DATA SOURCE', ''],
    ['View', 'savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance'],
    ['SGA Filter', 'INNER JOIN SavvyGTMData.User WHERE IsSGA__c=TRUE AND IsActive=TRUE, plus name exclusion list'],
    ['Activity Filter', 'is_marketing_activity=0 (SGA_IsActive filter REMOVED — was dropping valid records with NULL flag)'],
    ['Deduplication', 'One row per unique task_id in Audit Trail sheet (matches COUNT(DISTINCT task_id) in BigQuery)'],
    ['', ''],
    ['NAMED RANGES (used in all formulas)', ''],
    ['Audit_SGA', `'${AUDIT_SHEET}'!$B$2:$B$${auditLastRow} — SGA name column`],
    ['Audit_Week', `'${AUDIT_SHEET}'!$D$2:$D$${auditLastRow} — Week bucket column (Week_1..Week_4, Last_Week)`],
    ['Audit_Metric', `'${AUDIT_SHEET}'!$E$2:$E$${auditLastRow} — Metric type column`],
    ['Audit_TaskID', `'${AUDIT_SHEET}'!$A$2:$A$${auditLastRow} — Task ID column`],
    ['', ''],
    ['METRIC DEFINITIONS', ''],
    ['Cold_Call', 'activity_channel_group=Call AND is_true_cold_call=1'],
    ['Scheduled_Call', 'activity_channel_group=Call AND is_true_cold_call=0 AND direction=Outbound'],
    ['Outbound_SMS', 'activity_channel_group=SMS AND direction=Outbound'],
    ['LinkedIn', 'activity_channel_group=LinkedIn'],
    ['Manual_Email', 'activity_channel_group=Email AND is_engagement_tracking=0'],
    ['Email_Engagement', 'activity_channel_group=Email(Engagement) OR (Email AND is_engagement_tracking=1)'],
    ['', ''],
    ['FORMULA CHAIN', ''],
    ['Activity by Metric — weekly cells', 'COUNTIFS(Audit_SGA, [sga], Audit_Metric, [metric], Audit_Week, [week])'],
    ['Activity by Metric — TOTAL row', 'SUM of the 6 metric rows above'],
    ['Activity by Metric — 4-Wk Avg', 'AVERAGE(Wk1, Wk2, Wk3, Wk4)'],
    ['Activity by Metric — Delta', 'Last_Week - Trailing_4Wk_Avg'],
    ['Activity by Metric — % Change', 'IF(avg=0, IF(last>0, 100%, 0%), (last-avg)/avg)'],
    ['Summary — weekly cells', 'COUNTIFS(Audit_SGA, [sga], Audit_Week, [week]) — all metrics'],
    ['Summary — TEAM TOTAL', 'SUM of individual SGA rows'],
    ['', ''],
    ['HOW TO VERIFY', ''],
    ['Step 1', 'Go to Audit Trail sheet, filter by SGA + Week_Bucket + Metric_Type'],
    ['Step 2', 'Count the visible rows — should match the value in Activity by Metric'],
    ['Step 3', 'The Summary total = sum of all 6 metrics, or filter Audit Trail by SGA + Week only'],
    ['', ''],
    ['EXCLUSION LIST', 'Anett Diaz, Ariana Butler, Bre McDaniel, Bryan Belville, GinaRose Galli, Jacqueline Tully, Jed Entin, Russell Moss, Savvy Marketing, Savvy Operations, Lauren George'],
    ['SGAs Included (16)', SGAS.join(', ')],
    ['Audit Trail Records', `${records.length} unique tasks`],
  ];
  for (const [f, v] of methData) {
    const addedRow = ws3.addRow([f, v]);
    if (f.endsWith('DEFINITIONS') || f.endsWith('CHAIN') || f === 'DATA SOURCE' || f.startsWith('NAMED RANGES') || f === 'HOW TO VERIFY' || f === 'EXCLUSION LIST') {
      addedRow.getCell(1).font = { bold: true, color: { argb: 'FF2F5496' } };
    }
  }

  // ============================================================
  // Write
  // ============================================================
  const outPath = path.join(__dirname, '..', 'SGA_Activity_LastWeek_vs_TrailingAvg.xlsx');
  await wb.xlsx.writeFile(outPath);
  console.log(`\nWritten to: ${outPath}`);
  console.log(`SGAs: ${SGAS.length}`);
  console.log(`Audit trail: ${records.length} unique task records`);
  console.log(`Named ranges: Audit_SGA, Audit_Week, Audit_Metric, Audit_TaskID`);
  console.log(`All data cells use COUNTIFS formulas — zero hardcoded values`);
}

generate().catch(err => { console.error(err); process.exit(1); });
