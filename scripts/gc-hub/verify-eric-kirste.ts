// scripts/gc-hub/verify-eric-kirste.ts
// Verify Eric Kirste's data against CFO-verified ground truth
import * as dotenv from 'dotenv';
dotenv.config();

import prisma from '../../src/lib/prisma';

// Source: gc_dashboard_data_exploration.md Appendix F (CFO-verified values)
const GROUND_TRUTH: Record<string, { revenue: number; commission: number; earned: number }> = {
  'Q4 2022': { revenue: 15449.43, commission: 0.00, earned: 15449.43 },
  'Q1 2023': { revenue: 18220.54, commission: 0.00, earned: 18220.54 },
  'Q2 2023': { revenue: 22523.86, commission: 1282.13, earned: 21241.73 },
  'Q3 2023': { revenue: 27474.08, commission: 10165.41, earned: 17308.67 },
  'Q4 2023': { revenue: 32160.44, commission: 11899.36, earned: 20261.08 },
  'Q1 2024': { revenue: 37384.07, commission: 13832.11, earned: 23551.96 },
  'Q2 2024': { revenue: 37255.74, commission: 13784.63, earned: 23471.11 },
  'Q3 2024': { revenue: 37525.03, commission: 13884.26, earned: 23640.77 },
  'Q4 2024': { revenue: 43367.77, commission: 16046.07, earned: 27321.70 },
  'Q1 2025': { revenue: 36849.11, commission: 13634.17, earned: 23214.94 },
  'Q2 2025': { revenue: 49542.65, commission: 18330.78, earned: 31211.87 },
};

const TOLERANCE = 0.02; // $0.02 tolerance

function withinTolerance(actual: number | null, expected: number): boolean {
  if (actual === null) return false;
  return Math.abs(actual - expected) <= TOLERANCE;
}

async function verify() {
  console.log('=== Eric Kirste Ground Truth Verification ===\n');

  const ericData = await prisma.gcAdvisorPeriodData.findMany({
    where: { advisorNormalizedName: 'Eric Kirste' },
    orderBy: { periodStart: 'asc' },
  });

  console.log(`Found ${ericData.length} periods for Eric Kirste\n`);

  let allPassed = true;
  const missingPeriods: string[] = [];
  const mismatches: string[] = [];

  for (const [period, expected] of Object.entries(GROUND_TRUTH)) {
    const actual = ericData.find(d => d.period === period);

    if (!actual) {
      missingPeriods.push(period);
      allPassed = false;
      console.log(`❌ ${period}: MISSING`);
      continue;
    }

    const revMatch = withinTolerance(actual.grossRevenue, expected.revenue);
    const commMatch = withinTolerance(actual.commissionsPaid, expected.commission);
    const earnMatch = withinTolerance(actual.amountEarned, expected.earned);

    if (revMatch && commMatch && earnMatch) {
      console.log(`✅ ${period}: Revenue $${actual.grossRevenue?.toFixed(2)}, Commission $${actual.commissionsPaid?.toFixed(2)}, Earned $${actual.amountEarned?.toFixed(2)}`);
    } else {
      allPassed = false;
      const details: string[] = [];
      if (!revMatch) details.push(`Rev: got $${actual.grossRevenue?.toFixed(2)}, expected $${expected.revenue.toFixed(2)}`);
      if (!commMatch) details.push(`Comm: got $${actual.commissionsPaid?.toFixed(2)}, expected $${expected.commission.toFixed(2)}`);
      if (!earnMatch) details.push(`Earned: got $${actual.amountEarned?.toFixed(2)}, expected $${expected.earned.toFixed(2)}`);
      mismatches.push(`${period}: ${details.join('; ')}`);
      console.log(`❌ ${period}: ${details.join('; ')}`);
    }
  }

  console.log('\n========================================');
  if (allPassed) {
    console.log('✅ ALL CHECKS PASSED — Eric Kirste data matches ground truth!');
  } else {
    console.log('❌ VERIFICATION FAILED');
    if (missingPeriods.length > 0) {
      console.log(`   Missing periods: ${missingPeriods.join(', ')}`);
    }
    if (mismatches.length > 0) {
      console.log('   Mismatches:');
      mismatches.forEach(m => console.log(`     - ${m}`));
    }
  }
  console.log('========================================\n');

  // Additional checks
  console.log('Additional Checks:');

  // Check for churned advisors
  const churned = await prisma.gcAdvisorPeriodData.count({
    where: {
      advisorNormalizedName: { in: ['Nathan Wallace', 'Nate Wallace', 'Kevin May', 'Brad Weber'] }
    }
  });
  console.log(`  Churned advisors in data: ${churned} (expected: 0) ${churned === 0 ? '✅' : '❌'}`);

  // Check row counts by period
  const periodCounts = await prisma.gcAdvisorPeriodData.groupBy({
    by: ['period'],
    _count: true,
    orderBy: { period: 'asc' },
  });
  console.log('\n  Row counts by period:');
  periodCounts.forEach(p => console.log(`    ${p.period}: ${p._count} advisors`));

  await prisma.$disconnect();

  // Exit with error if verification failed
  if (!allPassed) {
    process.exit(1);
  }
}

verify().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
