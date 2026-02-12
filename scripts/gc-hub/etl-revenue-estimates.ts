// scripts/gc-hub/etl-revenue-estimates.ts
// 2026+ live data sync from Revenue Estimates workbook (Phase 7)
import * as dotenv from 'dotenv';
dotenv.config();

import prisma from '../../src/lib/prisma';
import { syncAllMonths } from '../../src/lib/gc-hub/sync-revenue-estimates';

async function run() {
  console.log('=== GC Hub: Revenue Estimates Sync (2026+) ===\n');

  const syncLog = await prisma.gcSyncLog.create({
    data: {
      syncType: 'live_sync',
      sourceWorkbookId: process.env.GC_REVENUE_ESTIMATES_SHEET_ID,
      status: 'started',
      triggeredBy: 'manual',
    },
  });

  try {
    const results = await syncAllMonths();

    let totalInserted = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;
    const allErrors: string[] = [];

    for (const r of results) {
      console.log(
        `  ${r.period}: ${r.advisorsProcessed} processed, ${r.advisorsInserted} inserted, ${r.advisorsUpdated} updated, ${r.advisorsSkipped} skipped`
      );
      totalInserted += r.advisorsInserted;
      totalUpdated += r.advisorsUpdated;
      totalSkipped += r.advisorsSkipped;
      allErrors.push(...r.errors);
    }

    await prisma.gcSyncLog.update({
      where: { id: syncLog.id },
      data: {
        status: 'completed',
        recordsProcessed: totalInserted + totalUpdated + totalSkipped,
        recordsInserted: totalInserted,
        recordsUpdated: totalUpdated,
        recordsSkipped: totalSkipped,
        errorMessage: allErrors.length > 0 ? allErrors.join('\n') : null,
        completedAt: new Date(),
      },
    });

    console.log('\n✅ Revenue Estimates Sync Complete');
    console.log(
      `   Inserted: ${totalInserted}, Updated: ${totalUpdated}, Skipped: ${totalSkipped}`
    );
    if (allErrors.length > 0) {
      console.log(`   ⚠️ Errors (${allErrors.length}):`);
      allErrors.forEach((e) => console.log(`     - ${e}`));
    }
  } catch (err: any) {
    await prisma.gcSyncLog.update({
      where: { id: syncLog.id },
      data: {
        status: 'failed',
        errorMessage: err.message,
        completedAt: new Date(),
      },
    });
    throw err;
  }

  await prisma.$disconnect();
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
