// packages/analyst-bot/src/xlsx.ts
// ============================================================================
// XLSX workbook generation using ExcelJS
// ============================================================================

import ExcelJS from 'exceljs';
import { WorkbookRequest, ColumnDef } from './types';

/**
 * Generate an XLSX workbook from structured data.
 * Returns a Buffer ready for Slack upload or disk write.
 */
export async function generateWorkbook(req: WorkbookRequest): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Savvy Analyst Bot';
  workbook.created = new Date();

  for (const sheet of req.sheets) {
    const ws = workbook.addWorksheet(sheet.name);

    // Build columns — data columns + formula columns
    const allColumns: any[] = sheet.columns.map((col) => ({
      header: col.header,
      key: col.key,
      width: estimateWidth(col),
    }));

    if (sheet.formulaColumns) {
      for (const fc of sheet.formulaColumns) {
        allColumns.push({
          header: fc.header,
          key: `_formula_${fc.header}`,
          width: 16,
        });
      }
    }

    ws.columns = allColumns;

    // Style header row
    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'F3F4F6' },
    };

    // Add data rows
    for (let i = 0; i < sheet.rows.length; i++) {
      const rowData = sheet.rows[i];
      const excelRowNum = i + 2; // 1-indexed, row 1 is header
      const row = ws.getRow(excelRowNum);

      for (const col of sheet.columns) {
        const cell = row.getCell(col.key);
        const raw = rowData[col.key] ?? null;
        // Strings starting with "=" are Excel formulas — ExcelJS needs { formula: '...' }
        // with the leading "=" stripped.
        if (typeof raw === 'string' && raw.startsWith('=')) {
          cell.value = { formula: raw.substring(1) } as any;
        } else {
          cell.value = raw;
        }
        applyCellFormat(cell, col.type);
      }

      if (sheet.formulaColumns) {
        for (const fc of sheet.formulaColumns) {
          const cell = row.getCell(`_formula_${fc.header}`);
          const formula = fc.formula.replace(/\{row\}/g, String(excelRowNum));
          cell.value = { formula } as any;
          applyCellFormat(cell, fc.type);
        }
      }

      row.commit();
    }

    // Add total/summary row if requested
    if (sheet.includeTotal && sheet.rows.length > 0) {
      const totalRowNum = sheet.rows.length + 2;
      const totalRow = ws.getRow(totalRowNum);
      totalRow.font = { bold: true };

      for (let colIdx = 0; colIdx < sheet.columns.length; colIdx++) {
        const col = sheet.columns[colIdx];
        const cell = totalRow.getCell(col.key);

        if (colIdx === 0) {
          cell.value = 'Total';
        } else if (col.type === 'number' || col.type === 'currency') {
          const colLetter = getColumnLetter(colIdx + 1);
          cell.value = { formula: `=SUM(${colLetter}2:${colLetter}${totalRowNum - 1})` } as any;
          applyCellFormat(cell, col.type);
        } else if (col.type === 'percent') {
          cell.value = null;
        }
      }

      totalRow.commit();
    }
  }

  // Embed chart PNG if provided
  if (req.chartBuffer) {
    const lastSheet = workbook.worksheets[workbook.worksheets.length - 1];
    const imageId = workbook.addImage({
      buffer: req.chartBuffer as any,
      extension: 'png',
    });
    lastSheet.addImage(imageId, {
      tl: { col: 0, row: lastSheet.rowCount + 2 },
      ext: { width: 800, height: 500 },
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function estimateWidth(col: ColumnDef): number {
  const headerLen = col.header.length;
  if (col.type === 'currency') return Math.max(headerLen + 2, 14);
  if (col.type === 'percent') return Math.max(headerLen + 2, 10);
  if (col.type === 'number') return Math.max(headerLen + 2, 12);
  return Math.max(headerLen + 2, 20);
}

function applyCellFormat(cell: any, type: string): void {
  switch (type) {
    case 'number':
      cell.numFmt = '#,##0';
      break;
    case 'percent':
      cell.numFmt = '0.0%';
      break;
    case 'currency':
      cell.numFmt = '$#,##0.00';
      break;
  }
}

function getColumnLetter(colNum: number): string {
  let letter = '';
  let num = colNum;
  while (num > 0) {
    num--;
    letter = String.fromCharCode(65 + (num % 26)) + letter;
    num = Math.floor(num / 26);
  }
  return letter;
}
