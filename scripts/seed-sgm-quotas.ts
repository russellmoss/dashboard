// scripts/seed-sgm-quotas.ts
// Run with: npx tsx scripts/seed-sgm-quotas.ts
// Idempotent — safe to re-run (uses upsert)

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Emails sourced from BigQuery SavvyGTMData.User where Is_SGM__c = TRUE
const SGM_QUOTAS: Array<{ name: string; email: string; quotas: Record<string, number> }> = [
  { name: 'Bre McDaniel', email: 'bre.mcdaniel@savvywealth.com', quotas: { '2026-Q1': 2_000_000, '2026-Q2': 2_000_000, '2026-Q3': 2_000_000, '2026-Q4': 2_000_000 } },
  { name: 'Corey Marcello', email: 'corey.marcello@savvywealth.com', quotas: { '2026-Q1': 1_300_000, '2026-Q2': 1_300_000, '2026-Q3': 1_300_000, '2026-Q4': 1_300_000 } },
  { name: 'Bryan Belville', email: 'bryan.belville@savvywealth.com', quotas: { '2026-Q1': 1_300_000, '2026-Q2': 1_300_000, '2026-Q3': 1_300_000, '2026-Q4': 1_300_000 } },
  { name: 'Erin Pearson', email: 'erin.pearson@savvywealth.com', quotas: { '2026-Q1': 1_300_000, '2026-Q2': 1_300_000, '2026-Q3': 1_300_000, '2026-Q4': 1_300_000 } },
  { name: 'Jade Bingham', email: 'jade.bingham@savvywealth.com', quotas: { '2026-Q1': 1_300_000, '2026-Q2': 1_300_000, '2026-Q3': 1_300_000, '2026-Q4': 1_300_000 } },
  { name: 'Tim Mackey', email: 'tim.mackey@savvywealth.com', quotas: { '2026-Q1': 650_000, '2026-Q2': 1_300_000, '2026-Q3': 1_300_000, '2026-Q4': 1_300_000 } },
  { name: 'Arianna Butler', email: 'arianna.butler@savvywealth.com', quotas: { '2026-Q1': 650_000, '2026-Q2': 1_300_000, '2026-Q3': 1_300_000, '2026-Q4': 1_300_000 } },
  { name: 'Lexi Harrison', email: 'lexi.harrison@savvywealth.com', quotas: { '2026-Q1': 325_000, '2026-Q2': 0, '2026-Q3': 758_333, '2026-Q4': 1_300_000 } },
  { name: 'David Eubanks', email: 'david.eubanks@savvywealth.com', quotas: { '2026-Q1': 0, '2026-Q2': 650_000, '2026-Q3': 1_300_000, '2026-Q4': 1_300_000 } },
  { name: 'Clayton Kennamer', email: 'clayton.kennamer@savvywealth.com', quotas: { '2026-Q1': 0, '2026-Q2': 650_000, '2026-Q3': 1_300_000, '2026-Q4': 1_300_000 } },
  { name: 'Lena Allouche', email: 'lena.allouche@savvywealth.com', quotas: { '2026-Q1': 0, '2026-Q2': 325_000, '2026-Q3': 1_191_667, '2026-Q4': 1_300_000 } },
  { name: 'GinaRose Galli', email: 'ginarose@savvywealth.com', quotas: { '2026-Q1': 0, '2026-Q2': 0, '2026-Q3': 0, '2026-Q4': 0 } },
];

async function main() {
  console.log('Seeding SGM quarterly quotas...\n');

  let upsertCount = 0;

  for (const sgm of SGM_QUOTAS) {
    for (const [quarter, arrGoal] of Object.entries(sgm.quotas)) {
      const result = await prisma.sGMQuarterlyGoal.upsert({
        where: { userEmail_quarter: { userEmail: sgm.email, quarter } },
        create: {
          userEmail: sgm.email,
          quarter,
          arrGoal,
          createdBy: 'seed-script',
          updatedAt: new Date(),
        },
        update: {
          arrGoal,
          updatedBy: 'seed-script',
          updatedAt: new Date(),
        },
      });
      console.log(`  ${sgm.name} | ${quarter} | $${arrGoal.toLocaleString()} → ${result.id}`);
      upsertCount++;
    }
  }

  console.log(`\nDone. ${upsertCount} quota records upserted.`);
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
