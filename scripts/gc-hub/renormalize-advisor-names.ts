import * as dotenv from 'dotenv';
dotenv.config();

import prisma from '../../src/lib/prisma';
import { normalizeAdvisorName, shouldExcludeEntry } from '../../src/lib/gc-hub/data-utils';

async function renormalizeAdvisorNames() {
  console.log('=== Re-normalizing advisor names in GcAdvisorPeriodData ===\n');

  // Get all records that need renaming
  const allRecords = await prisma.gcAdvisorPeriodData.findMany({
    select: {
      id: true,
      advisorNormalizedName: true,
      period: true
    }
  });

  console.log(`Found ${allRecords.length} total records\n`);

  let updated = 0;
  let deleted = 0;
  let skippedConflicts = 0;

  for (const record of allRecords) {
    const oldName = record.advisorNormalizedName;
    const newName = normalizeAdvisorName(oldName);

    // Check if this entry should be excluded
    if (shouldExcludeEntry(oldName) || shouldExcludeEntry(newName)) {
      await prisma.gcAdvisorPeriodData.delete({
        where: { id: record.id }
      });
      console.log(`🗑️  Deleted excluded entry: "${oldName}" (${record.period})`);
      deleted++;
      continue;
    }

    // Skip if name didn't change
    if (newName === oldName) continue;

    // Check if target name+period already exists
    const existing = await prisma.gcAdvisorPeriodData.findFirst({
      where: {
        advisorNormalizedName: newName,
        period: record.period,
        id: { not: record.id }
      }
    });

    if (existing) {
      // Conflict - delete this duplicate entry (main entry already exists)
      await prisma.gcAdvisorPeriodData.delete({
        where: { id: record.id }
      });
      console.log(`⚠️  Deleted duplicate: "${oldName}" → "${newName}" (${record.period}) - target already exists`);
      skippedConflicts++;
    } else {
      // No conflict - safe to rename
      await prisma.gcAdvisorPeriodData.update({
        where: { id: record.id },
        data: { advisorNormalizedName: newName }
      });
      console.log(`✏️  Renamed: "${oldName}" → "${newName}" (${record.period})`);
      updated++;
    }
  }

  console.log(`\n✅ Complete:`);
  console.log(`   ${updated} records renamed`);
  console.log(`   ${deleted} excluded entries deleted`);
  console.log(`   ${skippedConflicts} duplicates removed (target already existed)`);

  await prisma.$disconnect();
}

renormalizeAdvisorNames().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
