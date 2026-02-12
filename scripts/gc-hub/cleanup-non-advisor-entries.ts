// scripts/gc-hub/cleanup-non-advisor-entries.ts
// One-time: remove period data for system/entity rows that are not advisors
// (e.g. Milestone Bonuses, December AUM Blitz — now in EXCLUDED_ENTRIES)
import * as dotenv from 'dotenv';
dotenv.config();

import prisma from '../../src/lib/prisma';

const NON_ADVISOR_NAMES = ['Milestone Bonuses', 'December AUM Blitz'];

async function main() {
  console.log('Removing GcAdvisorPeriodData for non-advisor entries:', NON_ADVISOR_NAMES.join(', '));

  const result = await prisma.gcAdvisorPeriodData.deleteMany({
    where: { advisorNormalizedName: { in: NON_ADVISOR_NAMES } },
  });

  console.log(`Deleted ${result.count} rows.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
