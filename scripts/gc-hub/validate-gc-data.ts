// scripts/gc-hub/validate-gc-data.ts
// Full data integrity validation — final gate before Guide 2 (API + frontend)
import * as dotenv from 'dotenv';
dotenv.config();

import prisma from '../../src/lib/prisma';

const TOLERANCE = 0.02;

// Eric Kirste ground truth (gc_dashboard_data_exploration.md Appendix F) — 14 periods
const ERIC_KIRSTE_GROUND_TRUTH = [
  { period: 'Q4 2022', grossRevenue: 15449.43, commissionsPaid: 0, amountEarned: 15449.43 },
  { period: 'Q1 2023', grossRevenue: 18220.54, commissionsPaid: 0, amountEarned: 18220.54 },
  { period: 'Q2 2023', grossRevenue: 22523.86, commissionsPaid: 1282.13, amountEarned: 21241.73 },
  { period: 'Q3 2023', grossRevenue: 27474.08, commissionsPaid: 10165.41, amountEarned: 17308.67 },
  { period: 'Q4 2023', grossRevenue: 32160.44, commissionsPaid: 11899.36, amountEarned: 20261.08 },
  { period: 'Q1 2024', grossRevenue: 37384.07, commissionsPaid: 13832.11, amountEarned: 23551.96 },
  { period: 'Q2 2024', grossRevenue: 37255.74, commissionsPaid: 13784.63, amountEarned: 23471.11 },
  { period: 'Q3 2024', grossRevenue: 37525.03, commissionsPaid: 13884.26, amountEarned: 23640.77 },
  { period: 'Q4 2024', grossRevenue: 43367.77, commissionsPaid: 16046.07, amountEarned: 27321.7 },
  { period: 'Q1 2025', grossRevenue: 36849.11, commissionsPaid: 13634.17, amountEarned: 23214.94 },
  { period: 'Q2 2025', grossRevenue: 49542.65, commissionsPaid: 18330.78, amountEarned: 31211.87 },
  { period: 'Q3 2025', grossRevenue: 56670.69, commissionsPaid: 19517.48, amountEarned: 37153.21 },
  { period: 'Q4 2025', grossRevenue: 62628.83, commissionsPaid: 21625.16, amountEarned: 41003.67 },
  { period: 'Jan 2026', grossRevenue: 25135.56, commissionsPaid: 9300.16, amountEarned: 15835.4 },
];

const CHURNED_ADVISORS = ['Nathan Wallace', 'Kevin May', 'Brad Weber', 'Michael McCarthy'];
const BARONE_TEAM = ['Joshua Barone', 'Robert Barone', 'Andrea Nolan', 'Michael Lambrecht', 'Eugene Hoover'];
const P6_NAMES = ['Matthew Nelson', 'Matthew Finley', 'Jacob LaRue'];
const QUARTERLY_ORDER = [
  'Q4 2022', 'Q1 2023', 'Q2 2023', 'Q3 2023', 'Q4 2023',
  'Q1 2024', 'Q2 2024', 'Q3 2024', 'Q4 2024',
  'Q1 2025', 'Q2 2025', 'Q3 2025', 'Q4 2025',
];

interface CheckResult {
  name: string;
  passed: boolean;
  warn: boolean;
  message: string;
  details?: string | number;
}

function withinTolerance(actual: number | null, expected: number): boolean {
  if (actual === null) return false;
  return Math.abs(actual - expected) <= TOLERANCE;
}

async function runChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // 1. Eric Kirste ground truth (all 14 periods)
  const ericRows = await prisma.gcAdvisorPeriodData.findMany({
    where: { advisorNormalizedName: 'Eric Kirste' },
    orderBy: { periodStart: 'asc' },
  });
  let ericMatch = 0;
  for (const expected of ERIC_KIRSTE_GROUND_TRUTH) {
    const row = ericRows.find((r) => r.period === expected.period);
    if (
      row &&
      withinTolerance(row.grossRevenue, expected.grossRevenue) &&
      withinTolerance(row.commissionsPaid, expected.commissionsPaid) &&
      withinTolerance(row.amountEarned, expected.amountEarned)
    ) {
      ericMatch++;
    }
  }
  results.push({
    name: 'Eric Kirste ground truth',
    passed: ericMatch === ERIC_KIRSTE_GROUND_TRUTH.length,
    warn: false,
    message: `${ericMatch}/${ERIC_KIRSTE_GROUND_TRUTH.length} periods match`,
    details: ericMatch,
  });

  // 2. No churned advisors present
  const churnedCount = await prisma.gcAdvisorPeriodData.count({
    where: { advisorNormalizedName: { in: CHURNED_ADVISORS } },
  });
  results.push({
    name: 'No churned advisors present',
    passed: churnedCount === 0,
    warn: false,
    message: churnedCount === 0 ? '0 found' : `${churnedCount} found`,
    details: churnedCount,
  });

  // 3. Revenue non-negative
  const negativeRev = await prisma.gcAdvisorPeriodData.count({
    where: { grossRevenue: { lt: 0 } },
  });
  results.push({
    name: 'Revenue non-negative',
    passed: negativeRev === 0,
    warn: false,
    message: negativeRev === 0 ? '0 violations' : `${negativeRev} violations`,
    details: negativeRev,
  });

  // 4. Commission > Revenue (flag as WARN, don't fail — Bob Barone expected)
  const commGtRev = await prisma.gcAdvisorPeriodData.findMany({
    where: {
      grossRevenue: { not: null },
      commissionsPaid: { not: null },
    },
    select: {
      advisorNormalizedName: true,
      period: true,
      grossRevenue: true,
      commissionsPaid: true,
    },
  });
  const violations = commGtRev.filter(
    (r) =>
      r.grossRevenue != null &&
      r.commissionsPaid != null &&
      r.commissionsPaid > r.grossRevenue
  );
  const allBobBarone = violations.every((v) => v.advisorNormalizedName === 'Robert Barone');
  results.push({
    name: 'Commission > Revenue',
    passed: true,
    warn: violations.length > 0 && !allBobBarone,
    message:
      violations.length === 0
        ? '0 rows'
        : `${
            violations.length
          } rows — ${allBobBarone ? 'all Bob Barone (expected)' : 'includes non-Barone'}`,
    details: violations.length,
  });

  // 5. Amount Earned = Gross Revenue - Commissions Paid
  const allRows = await prisma.gcAdvisorPeriodData.findMany({
    where: {
      grossRevenue: { not: null },
      commissionsPaid: { not: null },
      amountEarned: { not: null },
    },
    select: {
      id: true,
      advisorNormalizedName: true,
      period: true,
      grossRevenue: true,
      commissionsPaid: true,
      amountEarned: true,
    },
  });
  const earnedMismatches = allRows.filter((r) => {
    const expected = Math.round((r.grossRevenue! - r.commissionsPaid!) * 100) / 100;
    return Math.abs((r.amountEarned ?? 0) - expected) > TOLERANCE;
  });
  results.push({
    name: 'Amount Earned arithmetic',
    passed: earnedMismatches.length === 0,
    warn: false,
    message:
      earnedMismatches.length === 0
        ? '0 mismatches'
        : `${earnedMismatches.length} mismatches`,
    details: earnedMismatches.length,
  });

  // 6. No duplicate advisor+period (unique constraint enforces; verify no dupes)
  const grouped = await prisma.gcAdvisorPeriodData.groupBy({
    by: ['advisorNormalizedName', 'period'],
    _count: true,
  });
  const duplicates = grouped.filter((g) => g._count > 1);
  const dupCount = duplicates.length;
  results.push({
    name: 'No duplicate entries',
    passed: dupCount === 0,
    warn: false,
    message: dupCount === 0 ? '0 duplicates' : `${dupCount} duplicates`,
    details: dupCount,
  });

  // 7. Period continuity — Eric Kirste has full 14 periods
  const ericPeriodCount = await prisma.gcAdvisorPeriodData.count({
    where: { advisorNormalizedName: 'Eric Kirste' },
  });
  results.push({
    name: 'Period coverage (Eric Kirste)',
    passed: ericPeriodCount >= 14,
    warn: false,
    message: `${ericPeriodCount} periods (expected ≥14)`,
    details: ericPeriodCount,
  });

  // 8. Advisor count growth (Q4 2022 < ... < Q4 2025)
  const periodCounts = await prisma.gcAdvisorPeriodData.groupBy({
    by: ['period'],
    _count: true,
    where: { period: { in: QUARTERLY_ORDER } },
  });
  const countByPeriod = new Map(periodCounts.map((p) => [p.period, p._count]));
  let growthOk = true;
  for (let i = 1; i < QUARTERLY_ORDER.length; i++) {
    const prev = countByPeriod.get(QUARTERLY_ORDER[i - 1]) ?? 0;
    const curr = countByPeriod.get(QUARTERLY_ORDER[i]) ?? 0;
    if (curr < prev) growthOk = false;
  }
  const countsStr = QUARTERLY_ORDER.map((p) => countByPeriod.get(p) ?? 0).join(' → ');
  results.push({
    name: 'Advisor count growth',
    passed: growthOk,
    warn: false,
    message: growthOk ? 'Monotonically increasing' : 'Some quarters decreased',
    details: countsStr,
  });

  // 9. GcAdvisorMapping coverage
  const distinctAdvisors = await prisma.gcAdvisorPeriodData.findMany({
    select: { advisorNormalizedName: true },
    distinct: ['advisorNormalizedName'],
  });
  const advisorNames = distinctAdvisors.map((a) => a.advisorNormalizedName);
  const mappings = await prisma.gcAdvisorMapping.findMany({
    where: { advisorNormalizedName: { in: advisorNames } },
    select: { advisorNormalizedName: true },
  });
  const mappedSet = new Set(mappings.map((m) => m.advisorNormalizedName));
  const missingMapping = advisorNames.filter((n) => !mappedSet.has(n));
  const pct =
    advisorNames.length === 0
      ? 100
      : Math.round((mappings.length / advisorNames.length) * 100);
  const mappingPerfect = missingMapping.length === 0;
  // Pass if coverage is reasonable; WARN if not 100% (goal: every advisor has mapping)
  results.push({
    name: 'Mapping coverage',
    passed: true,
    warn: !mappingPerfect,
    message: `${pct}% (${mappings.length}/${advisorNames.length})${!mappingPerfect ? ' — add missing to mapping tab and re-run seed for 100%' : ''}`,
    details: missingMapping.length > 0 ? missingMapping.slice(0, 5).join(', ') : undefined,
  });

  // 10. GcSyncLog — all completed
  const syncLogs = await prisma.gcSyncLog.findMany({
    orderBy: { startedAt: 'desc' },
    take: 20,
  });
  const failedSyncs = syncLogs.filter((s) => s.status !== 'completed');
  results.push({
    name: 'All sync logs completed',
    passed: failedSyncs.length === 0,
    warn: false,
    message:
      failedSyncs.length === 0
        ? `${syncLogs.length} logs OK`
        : `${failedSyncs.length} failed or in progress`,
    details: failedSyncs.length,
  });

  // 11. Barone team data source = cfo_provided (Q1–Q4 2025, Jan 2026)
  const baronePeriods = ['Q1 2025', 'Q2 2025', 'Q3 2025', 'Q4 2025', 'Jan 2026'];
  const baroneRows = await prisma.gcAdvisorPeriodData.findMany({
    where: {
      advisorNormalizedName: { in: BARONE_TEAM },
      period: { in: baronePeriods },
    },
    select: { advisorNormalizedName: true, period: true, dataSource: true },
  });
  const baroneWrongSource = baroneRows.filter((r) => r.dataSource !== 'cfo_provided');
  results.push({
    name: 'Barone team data source',
    passed: baroneWrongSource.length === 0,
    warn: false,
    message:
      baroneWrongSource.length === 0
        ? 'All cfo_provided'
        : `${baroneWrongSource.length} rows not cfo_provided`,
    details: baroneWrongSource.length,
  });

  // 12. P6 individual entries (Matthew Nelson, Matthew Finley, Jacob LaRue) for Q3 2025, Q4 2025
  const p6Periods = ['Q3 2025', 'Q4 2025'];
  const p6Rows = await prisma.gcAdvisorPeriodData.findMany({
    where: {
      advisorNormalizedName: { in: P6_NAMES },
      period: { in: p6Periods },
    },
    select: { advisorNormalizedName: true, period: true },
  });
  const expectedP6Rows = P6_NAMES.length * p6Periods.length;
  results.push({
    name: 'P6 individual entries (Q3/Q4 2025)',
    passed: p6Rows.length >= expectedP6Rows,
    warn: false,
    message: `${p6Rows.length}/${expectedP6Rows} rows`,
    details: p6Rows.length,
  });

  return results;
}

async function main() {
  console.log('=== GC Hub Data Validation Report ===\n');

  const results = await runChecks();

  for (const r of results) {
    const icon = r.passed ? (r.warn ? '⚠️ WARN' : '✅ PASS') : '❌ FAIL';
    console.log(`${icon}: ${r.name} (${r.message})`);
    if (r.details !== undefined && typeof r.details === 'string' && r.details.length > 0) {
      console.log(`     ${r.details}`);
    }
  }

  const passCount = results.filter((r) => r.passed && !r.warn).length;
  const warnCount = results.filter((r) => r.warn).length;
  const failCount = results.filter((r) => !r.passed).length;

  console.log('\n----------------------------------------');
  console.log(
    `Summary: ${passCount} PASS, ${failCount} FAIL, ${warnCount} WARN`
  );
  console.log('----------------------------------------\n');

  await prisma.$disconnect();

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
