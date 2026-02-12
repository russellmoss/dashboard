// scripts/gc-hub/verify-phase6.ts
// Verify Phase 6 results: Q3 2025, Q4 2025, and Barone override
import * as dotenv from 'dotenv';
dotenv.config();

import prisma from '../../src/lib/prisma';

const TOLERANCE = 0.02;

function withinTolerance(actual: number | null, expected: number): boolean {
  if (actual === null) return false;
  return Math.abs(actual - expected) <= TOLERANCE;
}

async function verify() {
  console.log('=== Phase 6 Verification ===\n');

  let allPassed = true;

  // 1. Eric Kirste Q3 2025 and Q4 2025
  console.log('--- Eric Kirste Ground Truth (Q3-Q4 2025) ---');
  const ericExpected = {
    'Q3 2025': { revenue: 56670.69, commission: 19517.48, earned: 37153.21 },
    'Q4 2025': { revenue: 62628.83, commission: 21625.16, earned: 41003.67 },
  };

  for (const [period, expected] of Object.entries(ericExpected)) {
    const actual = await prisma.gcAdvisorPeriodData.findUnique({
      where: {
        advisorNormalizedName_period: {
          advisorNormalizedName: 'Eric Kirste',
          period,
        },
      },
    });

    if (!actual) {
      console.log(`❌ Eric Kirste ${period}: MISSING`);
      allPassed = false;
      continue;
    }

    const revMatch = withinTolerance(actual.grossRevenue, expected.revenue);
    const commMatch = withinTolerance(actual.commissionsPaid, expected.commission);
    const earnMatch = withinTolerance(actual.amountEarned, expected.earned);

    if (revMatch && commMatch && earnMatch) {
      console.log(`✅ Eric Kirste ${period}: Rev $${actual.grossRevenue?.toFixed(2)}, Comm $${actual.commissionsPaid?.toFixed(2)}, Earned $${actual.amountEarned?.toFixed(2)}`);
    } else {
      allPassed = false;
      console.log(`❌ Eric Kirste ${period}:`);
      if (!revMatch) console.log(`   Rev: got $${actual.grossRevenue?.toFixed(2)}, expected $${expected.revenue.toFixed(2)}`);
      if (!commMatch) console.log(`   Comm: got $${actual.commissionsPaid?.toFixed(2)}, expected $${expected.commission.toFixed(2)}`);
      if (!earnMatch) console.log(`   Earned: got $${actual.amountEarned?.toFixed(2)}, expected $${expected.earned.toFixed(2)}`);
    }
  }

  // 2. Barone team validation
  console.log('\n--- Barone Team Validation ---');

  // Joshua Barone Q1 2025: Sum of Jan+Feb+Mar = 75366.10+55168.73+59733.85 = 190268.68
  const joshQ1 = await prisma.gcAdvisorPeriodData.findUnique({
    where: {
      advisorNormalizedName_period: {
        advisorNormalizedName: 'Joshua Barone',
        period: 'Q1 2025',
      },
    },
  });

  if (joshQ1 && withinTolerance(joshQ1.grossRevenue, 190268.68)) {
    console.log(`✅ Joshua Barone Q1 2025: Rev $${joshQ1.grossRevenue?.toFixed(2)} (expected $190,268.68)`);
  } else {
    console.log(`❌ Joshua Barone Q1 2025: Rev ${joshQ1?.grossRevenue?.toFixed(2) || 'MISSING'}, expected $190,268.68`);
    allPassed = false;
  }

  // Robert Barone Q4 2025: Rev = 126.13 (only Oct has revenue)
  // Commission = 8063.07+8000+8000 = 24063.07
  const bobQ4 = await prisma.gcAdvisorPeriodData.findUnique({
    where: {
      advisorNormalizedName_period: {
        advisorNormalizedName: 'Robert Barone',
        period: 'Q4 2025',
      },
    },
  });

  if (bobQ4) {
    const bobRevMatch = withinTolerance(bobQ4.grossRevenue, 126.13);
    const bobCommMatch = withinTolerance(bobQ4.commissionsPaid, 24063.07);
    const bobEarnedNegative = bobQ4.amountEarned !== null && bobQ4.amountEarned < 0;

    if (bobRevMatch && bobCommMatch && bobEarnedNegative) {
      console.log(`✅ Robert Barone Q4 2025: Rev $${bobQ4.grossRevenue?.toFixed(2)}, Comm $${bobQ4.commissionsPaid?.toFixed(2)}, Earned $${bobQ4.amountEarned?.toFixed(2)} (negative as expected)`);
    } else {
      console.log(`❌ Robert Barone Q4 2025 mismatch:`);
      if (!bobRevMatch) console.log(`   Rev: got $${bobQ4.grossRevenue?.toFixed(2)}, expected $126.13`);
      if (!bobCommMatch) console.log(`   Comm: got $${bobQ4.commissionsPaid?.toFixed(2)}, expected $24,063.07`);
      if (!bobEarnedNegative) console.log(`   Earned should be negative: got $${bobQ4.amountEarned?.toFixed(2)}`);
      allPassed = false;
    }
  } else {
    console.log(`❌ Robert Barone Q4 2025: MISSING`);
    allPassed = false;
  }

  // All Barone dataSource = "cfo_provided"
  const baroneRecords = await prisma.gcAdvisorPeriodData.findMany({
    where: {
      advisorNormalizedName: { in: ['Joshua Barone', 'Robert Barone', 'Andrea Nolan', 'Michael Lambrecht', 'Eugene Hoover'] },
    },
    select: { advisorNormalizedName: true, period: true, dataSource: true },
  });

  const allCfoProvided = baroneRecords.every(r => r.dataSource === 'cfo_provided');
  if (allCfoProvided) {
    console.log(`✅ All Barone records have dataSource = "cfo_provided" (${baroneRecords.length} records)`);
  } else {
    console.log(`❌ Some Barone records don't have dataSource = "cfo_provided"`);
    allPassed = false;
  }

  // Barone Jan 2026 exists
  const baroneJan2026 = await prisma.gcAdvisorPeriodData.count({
    where: {
      advisorNormalizedName: { in: ['Joshua Barone', 'Robert Barone', 'Andrea Nolan', 'Michael Lambrecht', 'Eugene Hoover'] },
      period: 'Jan 2026',
    },
  });

  if (baroneJan2026 === 5) {
    console.log(`✅ Barone Jan 2026: 5 rows (one per team member)`);
  } else {
    console.log(`❌ Barone Jan 2026: got ${baroneJan2026} rows, expected 5`);
    allPassed = false;
  }

  // 3. P6 individual entries
  console.log('\n--- P6 Individual Breakdown (Q3 2025) ---');
  const p6Expected = {
    'Matthew Nelson': { revenue: 353247.98, commission: 338398.29 },
    'Matthew Finley': { revenue: 195979.06, commission: 187884.06 },
    'Jacob LaRue': { revenue: 136459.49, commission: 130822.54 },
  };

  for (const [name, expected] of Object.entries(p6Expected)) {
    const actual = await prisma.gcAdvisorPeriodData.findUnique({
      where: {
        advisorNormalizedName_period: {
          advisorNormalizedName: name,
          period: 'Q3 2025',
        },
      },
    });

    if (actual && withinTolerance(actual.grossRevenue, expected.revenue) && withinTolerance(actual.commissionsPaid, expected.commission)) {
      console.log(`✅ ${name} Q3 2025: Rev $${actual.grossRevenue?.toFixed(2)}, Comm $${actual.commissionsPaid?.toFixed(2)}`);
    } else {
      console.log(`❌ ${name} Q3 2025: Rev ${actual?.grossRevenue?.toFixed(2) || 'MISSING'}, Comm ${actual?.commissionsPaid?.toFixed(2) || 'MISSING'}`);
      allPassed = false;
    }
  }

  // 4. Additional checks
  console.log('\n--- Additional Checks ---');

  // No churned advisors
  const churned = await prisma.gcAdvisorPeriodData.count({
    where: {
      advisorNormalizedName: { in: ['Nathan Wallace', 'Kevin May', 'Brad Weber', 'Michael McCarthy'] },
    },
  });
  console.log(`${churned === 0 ? '✅' : '❌'} Churned advisors in data: ${churned} (expected: 0)`);
  if (churned > 0) allPassed = false;

  // No negative revenue
  const negativeRev = await prisma.gcAdvisorPeriodData.count({
    where: { grossRevenue: { lt: 0 } },
  });
  console.log(`${negativeRev === 0 ? '✅' : '❌'} Negative revenue records: ${negativeRev} (expected: 0)`);
  if (negativeRev > 0) allPassed = false;

  // Row counts by period
  const periodCounts = await prisma.gcAdvisorPeriodData.groupBy({
    by: ['period'],
    _count: true,
    orderBy: { period: 'asc' },
  });
  console.log('\n  Row counts by period:');
  periodCounts.forEach(p => console.log(`    ${p.period}: ${p._count} advisors`));

  // Eric Kirste total period count
  const ericTotal = await prisma.gcAdvisorPeriodData.count({
    where: { advisorNormalizedName: 'Eric Kirste' },
  });
  console.log(`\n  Eric Kirste total periods: ${ericTotal} (expected: 13 = Q4'22 through Q4'25)`);

  console.log('\n========================================');
  if (allPassed) {
    console.log('✅ ALL PHASE 6 CHECKS PASSED!');
  } else {
    console.log('❌ SOME PHASE 6 CHECKS FAILED');
  }
  console.log('========================================\n');

  await prisma.$disconnect();
}

verify().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
