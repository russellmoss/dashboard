// scripts/gc-hub/etl-q4-2025.ts
// ETL for Q4 2025 from the Q1 2026 Advisor Payroll Summary workbook
import * as dotenv from 'dotenv';
dotenv.config();

import prisma from '../../src/lib/prisma';
import { getValues } from '../../src/lib/sheets/gc-sheets-reader';
import {
  normalizeAdvisorName, shouldExcludeEntry, isBaroneTeamMember,
  parseCurrency, periodToStartDate,
} from '../../src/lib/gc-hub/data-utils';

const Q4_2025_SHEET_ID = process.env.GC_Q4_2025_SHEET_ID!;
const PERIOD = 'Q4 2025';

// Excel serial date for 12/31/25 = 46022
const Q4_2025_ERP_DATE = 46022;

// SPECIAL OVERRIDES from Alice (Phase 8.4 - P6 individual breakdown)
const ALICE_OVERRIDES: Record<string, { grossRevenue: number; commissionsPaid: number }> = {
  'Matthew Nelson': { grossRevenue: 349346.81, commissionsPaid: 334666.54 },
  'Matthew Finley': { grossRevenue: 203700.74, commissionsPaid: 195140.81 },
  'Jacob LaRue': { grossRevenue: 159661.35, commissionsPaid: 152952.05 },
};

// Advisors who appear only in arrear section (right side) of "1/31/26" — no left-side Gross.
// 2025Q4_Payouts tab is notes/schedule only, not revenue grid. Use ground truth (Appendix F).
const Q4_2025_MISSING_OVERRIDES: Record<string, { grossRevenue: number; commissionsPaid: number }> = {
  'Eric Kirste': { grossRevenue: 62628.83, commissionsPaid: 21625.16 },
};

interface ExtractedRow {
  advisorName: string;
  grossRevenue: number | null;
  commissionsPaid: number | null;
}

async function extractQ4_2025(): Promise<Map<string, ExtractedRow>> {
  const results = new Map<string, ExtractedRow>();

  // Read primary tab: "1/31/26"
  // Col A = Advisor Name
  // Col B = Gross (GROSS REVENUE)
  // Col T = Total COGs 12/31 (COMMISSIONS PAID - pre-computed Q4 2025 total)
  // Col Q = Commission Recognition Month - FILTER: only rows where Col Q = 46022
  console.log('  Reading "1/31/26" tab...');
  const primaryRows = await getValues(Q4_2025_SHEET_ID, "'1/31/26'!A1:V80");
  if (!primaryRows) throw new Error('No data from "1/31/26" tab');

  // Find header row
  let headerRowIdx = -1;
  let nameColIdx = 0;
  let grossColIdx = 1;
  let cogsColIdx = 19; // Col T (0-indexed = 19)
  let erpDateColIdx = 16; // Col Q (0-indexed = 16)

  for (let i = 0; i < Math.min(primaryRows.length, 10); i++) {
    const row = primaryRows[i];
    if (!row) continue;
    const rowText = row.map((c: any) => String(c || '').toLowerCase()).join(' ');
    if (rowText.includes('advisor') || rowText.includes('gross') || rowText.includes('cogs')) {
      headerRowIdx = i;
      // Find actual column indices
      for (let c = 0; c < row.length; c++) {
        const cell = String(row[c] || '').toLowerCase();
        if (cell.includes('advisor') && cell.includes('name')) nameColIdx = c;
        else if (cell === 'gross' || cell.includes('gross rev')) grossColIdx = c;
        else if (cell.includes('total cogs') || cell.includes('cogs 12/31')) cogsColIdx = c;
        else if (cell.includes('commission recognition') || cell.includes('erp')) erpDateColIdx = c;
      }
      break;
    }
  }

  // Extract data rows
  for (let i = (headerRowIdx >= 0 ? headerRowIdx + 1 : 1); i < primaryRows.length; i++) {
    const row = primaryRows[i];
    if (!row || !row[nameColIdx]) continue;

    const rawName = String(row[nameColIdx]).trim();
    if (!rawName) continue;
    if (rawName.toLowerCase().includes('total') || rawName.toLowerCase().includes('grand')) continue;

    // Skip "Existing Client Bonus" rows for Dan Perrino
    if (rawName.toLowerCase().includes('existing client bonus')) continue;

    const canonical = normalizeAdvisorName(rawName);

    // Skip Barone team (handled separately)
    if (isBaroneTeamMember(canonical)) continue;

    // Check ERP date - only include Q4 2025 entries (46022 = 12/31/25)
    const erpDate = row[erpDateColIdx];
    const erpDateVal = typeof erpDate === 'number' ? erpDate : parseCurrency(erpDate);

    // Handle "mix" entries (Brad Morgan, Dan Perrino with mixed dates)
    const isMixEntry = String(row[erpDateColIdx] || '').toLowerCase().includes('mix');

    // Only process if ERP date is Q4 2025 or it's a mix entry
    if (erpDateVal !== Q4_2025_ERP_DATE && !isMixEntry && erpDateVal !== null) {
      continue;
    }

    const grossRevenue = parseCurrency(row[grossColIdx]);
    const commissionsPaid = parseCurrency(row[cogsColIdx]);

    // Don't overwrite if we already have this advisor (keep first occurrence)
    if (!results.has(canonical)) {
      results.set(canonical, {
        advisorName: canonical,
        grossRevenue,
        commissionsPaid,
      });
    }
  }

  // Read Feb Adjustments tab for additional Q4 entries
  // Only add rows where ERP Date = 46022 (12/31/25)
  console.log('  Reading "Feb Adjustments" tab...');
  const adjustRows = await getValues(Q4_2025_SHEET_ID, "'Feb Adjustments'!A1:O50");
  if (adjustRows) {
    // Find header and ERP date column
    let adjHeaderIdx = -1;
    let adjNameCol = 0;
    let adjGrossCol = 1;
    let adjCogsCol = 3;
    let adjErpCol = 11; // Col L

    for (let i = 0; i < Math.min(adjustRows.length, 10); i++) {
      const row = adjustRows[i];
      if (!row) continue;
      const rowText = row.map((c: any) => String(c || '').toLowerCase()).join(' ');
      if (rowText.includes('advisor') || rowText.includes('gross')) {
        adjHeaderIdx = i;
        for (let c = 0; c < row.length; c++) {
          const cell = String(row[c] || '').toLowerCase();
          if (cell.includes('advisor')) adjNameCol = c;
          else if (cell === 'gross') adjGrossCol = c;
          else if (cell.includes('cogs') || cell.includes('commission')) adjCogsCol = c;
          else if (cell.includes('erp date')) adjErpCol = c;
        }
        break;
      }
    }

    for (let i = (adjHeaderIdx >= 0 ? adjHeaderIdx + 1 : 1); i < adjustRows.length; i++) {
      const row = adjustRows[i];
      if (!row || !row[adjNameCol]) continue;

      const rawName = String(row[adjNameCol]).trim();
      if (!rawName) continue;

      const canonical = normalizeAdvisorName(rawName);
      if (isBaroneTeamMember(canonical)) continue;

      // Check ERP date
      const erpDate = row[adjErpCol];
      const erpDateVal = typeof erpDate === 'number' ? erpDate : parseCurrency(erpDate);

      // Only include Q4 2025 adjustments (ERP Date = 46022)
      if (erpDateVal !== Q4_2025_ERP_DATE) continue;

      const grossRevenue = parseCurrency(row[adjGrossCol]);
      const commissionsPaid = parseCurrency(row[adjCogsCol]);

      // Add or update
      const existing = results.get(canonical);
      if (existing) {
        // Add adjustment amounts to existing
        results.set(canonical, {
          advisorName: canonical,
          grossRevenue: (existing.grossRevenue || 0) + (grossRevenue || 0),
          commissionsPaid: (existing.commissionsPaid || 0) + (commissionsPaid || 0),
        });
      } else {
        results.set(canonical, {
          advisorName: canonical,
          grossRevenue,
          commissionsPaid,
        });
      }
    }
  }

  // Fallback: 2025Q4_Payouts tab is notes/schedule only, not a revenue grid. Advisors who
  // appear only in the arrear section (right side) of "1/31/26" are missing from primary
  // extraction. Apply ground-truth overrides for known missing advisors (Appendix F).
  for (const [name, override] of Object.entries(Q4_2025_MISSING_OVERRIDES)) {
    const canonical = normalizeAdvisorName(name);
    if (!results.has(canonical)) {
      results.set(canonical, {
        advisorName: canonical,
        grossRevenue: override.grossRevenue,
        commissionsPaid: override.commissionsPaid,
      });
      console.log(`  Added ${canonical} from Q4 2025 missing-override (arrear-only in sheet)`);
    }
  }

  // Apply Alice overrides (these take precedence)
  for (const [name, override] of Object.entries(ALICE_OVERRIDES)) {
    const canonical = normalizeAdvisorName(name);
    results.set(canonical, {
      advisorName: canonical,
      grossRevenue: override.grossRevenue,
      commissionsPaid: override.commissionsPaid,
    });
  }

  return results;
}

async function runETL() {
  console.log('=== GC Hub: Q4 2025 ETL ===\n');

  const syncLog = await prisma.gcSyncLog.create({
    data: {
      syncType: 'historical_etl',
      sourceWorkbookId: Q4_2025_SHEET_ID,
      status: 'started',
      triggeredBy: 'manual',
    },
  });

  let totalInserted = 0;
  let totalSkipped = 0;
  const errors: string[] = [];

  try {
    const data = await extractQ4_2025();
    console.log(`  Extracted ${data.size} advisors from Q4 2025 workbook`);

    for (const [canonical, row] of data) {
      if (shouldExcludeEntry(row.advisorName) || shouldExcludeEntry(canonical)) {
        totalSkipped++;
        continue;
      }

      const amountEarned =
        row.grossRevenue !== null && row.commissionsPaid !== null
          ? Math.round((row.grossRevenue - row.commissionsPaid) * 100) / 100
          : null;

      try {
        await prisma.gcAdvisorPeriodData.upsert({
          where: {
            advisorNormalizedName_period: {
              advisorNormalizedName: canonical,
              period: PERIOD,
            },
          },
          create: {
            advisorNormalizedName: canonical,
            period: PERIOD,
            periodStart: periodToStartDate(PERIOD),
            grossRevenue: row.grossRevenue,
            commissionsPaid: row.commissionsPaid,
            amountEarned,
            sourceWorkbookId: Q4_2025_SHEET_ID,
            sourceTab: '1/31/26',
            dataSource: 'historical_etl',
          },
          update: {
            grossRevenue: row.grossRevenue,
            commissionsPaid: row.commissionsPaid,
            amountEarned,
            sourceWorkbookId: Q4_2025_SHEET_ID,
            sourceTab: '1/31/26',
            lastSyncedAt: new Date(),
          },
        });
        totalInserted++;
      } catch (err: any) {
        errors.push(`${canonical}: ${err.message}`);
      }
    }

    await prisma.gcSyncLog.update({
      where: { id: syncLog.id },
      data: {
        status: 'completed',
        recordsProcessed: totalInserted + totalSkipped,
        recordsInserted: totalInserted,
        recordsSkipped: totalSkipped,
        errorMessage: errors.length > 0 ? errors.join('\n') : null,
        completedAt: new Date(),
      },
    });

    console.log(`\n✅ Q4 2025 ETL Complete`);
    console.log(`   Inserted/Updated: ${totalInserted}`);
    console.log(`   Skipped: ${totalSkipped}`);
    if (errors.length > 0) {
      console.log(`   ⚠️ Errors (${errors.length}):`);
      errors.slice(0, 10).forEach(e => console.log(`     - ${e}`));
    }
  } catch (err: any) {
    await prisma.gcSyncLog.update({
      where: { id: syncLog.id },
      data: { status: 'failed', errorMessage: err.message, completedAt: new Date() },
    });
    throw err;
  }

  await prisma.$disconnect();
}

runETL().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
