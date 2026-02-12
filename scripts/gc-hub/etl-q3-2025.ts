// scripts/gc-hub/etl-q3-2025.ts
// ETL for Q3 2025 from the dedicated Q3 2025 Payouts workbook
import * as dotenv from 'dotenv';
dotenv.config();

import prisma from '../../src/lib/prisma';
import { getValues } from '../../src/lib/sheets/gc-sheets-reader';
import {
  normalizeAdvisorName, shouldExcludeEntry, isBaroneTeamMember,
  parseCurrency, periodToStartDate,
} from '../../src/lib/gc-hub/data-utils';

const Q3_2025_SHEET_ID = process.env.GC_Q3_2025_SHEET_ID!;
const PERIOD = 'Q3 2025';

// SPECIAL OVERRIDES from Alice (Phase 8.3 and 8.4)
const ALICE_OVERRIDES: Record<string, { grossRevenue: number; commissionsPaid: number }> = {
  'Cindy Alvarez': { grossRevenue: 184992.15, commissionsPaid: 129494.51 },
  'Janelle Van Meel': { grossRevenue: 81980.62, commissionsPaid: 57386.43 },
  // P6 individual breakdown (Phase 8.4)
  'Matthew Nelson': { grossRevenue: 353247.98, commissionsPaid: 338398.29 },
  'Matthew Finley': { grossRevenue: 195979.06, commissionsPaid: 187884.06 },
  'Jacob LaRue': { grossRevenue: 136459.49, commissionsPaid: 130822.54 },
};

interface ExtractedRow {
  advisorName: string;
  grossRevenue: number | null;
  commissionsPaid: number | null;
}

async function extractQ3_2025(): Promise<Map<string, ExtractedRow>> {
  const results = new Map<string, ExtractedRow>();

  // Read primary tab: "As of 10/27"
  // Col A = "Advisor Name Payout Q3 2025" (parse name from filename format)
  // Col B = Total Client Fees (GROSS REVENUE)
  // Col E = Paydown (stored as negative number)
  // Col F = Commission Payout
  // Commission = abs(Col E) + Col F
  console.log('  Reading "As of 10/27" tab...');
  const primaryRows = await getValues(Q3_2025_SHEET_ID, "'As of 10/27'!A1:G100");
  if (!primaryRows) throw new Error('No data from "As of 10/27" tab');

  // Find header row
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(primaryRows.length, 10); i++) {
    const row = primaryRows[i];
    if (!row) continue;
    const rowText = row.map((c: any) => String(c || '').toLowerCase()).join(' ');
    if (rowText.includes('advisor') || rowText.includes('client fees') || rowText.includes('total')) {
      headerRowIdx = i;
      break;
    }
  }

  // Extract primary data
  for (let i = (headerRowIdx >= 0 ? headerRowIdx + 1 : 1); i < primaryRows.length; i++) {
    const row = primaryRows[i];
    if (!row || !row[0]) continue;

    let rawName = String(row[0]).trim();
    if (!rawName) continue;
    if (rawName.toLowerCase().includes('total') || rawName.toLowerCase().includes('grand')) continue;

    // Parse name from "Advisor Name Payout Q3 2025" format
    rawName = rawName.replace(/\s*payout\s+q\d\s+\d{4}$/i, '').trim();

    const canonical = normalizeAdvisorName(rawName);

    // Skip Barone team (handled separately)
    if (isBaroneTeamMember(canonical)) continue;

    const grossRevenue = parseCurrency(row[1]); // Col B = Total Client Fees
    const paydown = parseCurrency(row[4]); // Col E = Paydown (negative)
    const commissionPayout = parseCurrency(row[5]); // Col F = Commission Payout

    // Commission = abs(paydown) + commissionPayout
    let commissionsPaid: number | null = null;
    if (paydown !== null || commissionPayout !== null) {
      commissionsPaid = Math.abs(paydown || 0) + (commissionPayout || 0);
    }

    results.set(canonical, {
      advisorName: canonical,
      grossRevenue,
      commissionsPaid,
    });
  }

  // Read adjustments tab: "Changes after 10/27"
  // If an advisor appears here with "Current" value marked for Q3, use as override
  console.log('  Reading "Changes after 10/27" tab...');
  const adjustRows = await getValues(Q3_2025_SHEET_ID, "'Changes after 10/27'!A1:U60");
  if (adjustRows) {
    // This tab has adjustments - look for Q3-specific entries
    for (let i = 1; i < adjustRows.length; i++) {
      const row = adjustRows[i];
      if (!row || !row[0]) continue;

      let rawName = String(row[0]).trim();
      if (!rawName) continue;

      // Skip Q4 entries, signing bonuses, etc.
      if (rawName.toLowerCase().includes('q4')) continue;
      if (rawName.toLowerCase().includes('signing bonus')) continue;
      if (rawName.toLowerCase().includes('trent grzegorczyk')) continue;
      if (rawName.toLowerCase().includes('steven grogan')) continue;

      rawName = rawName.replace(/\s*payout\s+q\d\s+\d{4}$/i, '').trim();
      const canonical = normalizeAdvisorName(rawName);

      if (isBaroneTeamMember(canonical)) continue;

      // Look for "Current" commission value in this row
      // The structure varies, so just skip if we can't parse it reliably
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
  console.log('=== GC Hub: Q3 2025 ETL ===\n');

  const syncLog = await prisma.gcSyncLog.create({
    data: {
      syncType: 'historical_etl',
      sourceWorkbookId: Q3_2025_SHEET_ID,
      status: 'started',
      triggeredBy: 'manual',
    },
  });

  let totalInserted = 0;
  let totalSkipped = 0;
  const errors: string[] = [];

  try {
    const data = await extractQ3_2025();
    console.log(`  Extracted ${data.size} advisors from Q3 2025 workbook`);

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
            sourceWorkbookId: Q3_2025_SHEET_ID,
            sourceTab: 'As of 10/27',
            dataSource: 'historical_etl',
          },
          update: {
            grossRevenue: row.grossRevenue,
            commissionsPaid: row.commissionsPaid,
            amountEarned,
            sourceWorkbookId: Q3_2025_SHEET_ID,
            sourceTab: 'As of 10/27',
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

    console.log(`\n✅ Q3 2025 ETL Complete`);
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
