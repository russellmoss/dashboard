// scripts/gc-hub/verify-phase7.ts
// Verify Phase 7: Eric Kirste Jan 2026 ground truth and live_sync data
import * as dotenv from 'dotenv';
dotenv.config();

import prisma from '../../src/lib/prisma';

const TOLERANCE = 0.02;

function withinTolerance(actual: number | null, expected: number): boolean {
  if (actual === null) return false;
  return Math.abs(actual - expected) <= TOLERANCE;
}

async function verify() {
  console.log('=== Phase 7 Verification ===\n');

  let allPassed = true;

  // Eric Kirste Jan 2026 ground truth
  const ericJan = await prisma.gcAdvisorPeriodData.findUnique({
    where: {
      advisorNormalizedName_period: {
        advisorNormalizedName: 'Eric Kirste',
        period: 'Jan 2026',
      },
    },
  });

  const expected = {
    grossRevenue: 25135.56,
    commissionsPaid: 9300.16,
    amountEarned: 15835.4,
  };

  if (!ericJan) {
    console.log('❌ Eric Kirste Jan 2026: MISSING');
    allPassed = false;
  } else {
    const revOk = withinTolerance(ericJan.grossRevenue, expected.grossRevenue);
    const commOk = withinTolerance(ericJan.commissionsPaid, expected.commissionsPaid);
    const earnedOk = withinTolerance(ericJan.amountEarned, expected.amountEarned);
    if (revOk && commOk && earnedOk) {
      console.log(
        `✅ Eric Kirste Jan 2026: Rev $${ericJan.grossRevenue?.toFixed(2)}, Comm $${ericJan.commissionsPaid?.toFixed(2)}, Earned $${ericJan.amountEarned?.toFixed(2)}, dataSource=${ericJan.dataSource}`
      );
    } else {
      allPassed = false;
      console.log('❌ Eric Kirste Jan 2026:');
      if (!revOk) console.log(`   Rev: got ${ericJan.grossRevenue}, expected ${expected.grossRevenue}`);
      if (!commOk) console.log(`   Comm: got ${ericJan.commissionsPaid}, expected ${expected.commissionsPaid}`);
      if (!earnedOk) console.log(`   Earned: got ${ericJan.amountEarned}, expected ${expected.amountEarned}`);
    }
  }

  const ericTotal = await prisma.gcAdvisorPeriodData.count({
    where: { advisorNormalizedName: 'Eric Kirste' },
  });
  console.log(`\n  Eric Kirste total periods: ${ericTotal} (expected: 14 = Q4'22 through Q4'25 + Jan 2026; or 15 if Feb 2026)`);

  const jan2026Count = await prisma.gcAdvisorPeriodData.count({
    where: { period: 'Jan 2026' },
  });
  console.log(`  Jan 2026 advisor count: ${jan2026Count}`);

  const feb2026Count = await prisma.gcAdvisorPeriodData.count({
    where: { period: 'Feb 2026' },
  });
  console.log(`  Feb 2026 advisor count: ${feb2026Count}`);

  console.log('\n========================================');
  console.log(allPassed ? '✅ PHASE 7 CHECKS PASSED' : '❌ SOME CHECKS FAILED');
  console.log('========================================\n');

  await prisma.$disconnect();
}

verify().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
