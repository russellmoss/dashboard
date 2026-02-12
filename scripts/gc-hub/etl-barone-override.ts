// scripts/gc-hub/etl-barone-override.ts
// ETL for Barone team using CFO-provided data (Appendix H)
// This OVERRIDES all other sources for Barone team members
import * as dotenv from 'dotenv';
dotenv.config();

import prisma from '../../src/lib/prisma';
import { periodToStartDate } from '../../src/lib/gc-hub/data-utils';

// Months index: [Jan'25, Feb'25, Mar'25, Apr'25, May'25, Jun'25, Jul'25, Aug'25, Sep'25, Oct'25, Nov'25, Dec'25, Jan'26]
// Index:        [0,      1,      2,      3,      4,      5,      6,      7,      8,      9,      10,     11,     12    ]

// REVENUE (monthly) - from Appendix H
const REVENUE: Record<string, number[]> = {
  'Joshua Barone': [75366.10, 55168.73, 59733.85, 57244.95, 58987.53, 57139.30, 60205.36, 60052.64, 58602.66, 61792.11, 60959.16, 63034.93, 63213.09],
  'Robert Barone': [0, 0, 0, 0, 0, 0, 0, 0, 0, 126.13, 0, 0, 0],
  'Andrea Nolan': [39366.93, 40611.20, 45481.17, 45388.43, 46545.18, 45195.13, 47504.94, 46389.92, 47054.28, 50503.13, 48103.70, 50893.35, 50985.22],
  'Michael Lambrecht': [53306.22, 48702.67, 53316.16, 48619.95, 54371.99, 51345.39, 55987.81, 57110.73, 55787.85, 60014.96, 64522.16, 59878.53, 60565.70],
  'Eugene Hoover': [384.75, 746.49, 619.64, 1718.32, 2857.30, 587.44, 614.28, 616.15, 1974.79, 2456.62, 4235.17, 2086.45, 3194.54],
};

// COMMISSIONS (monthly) - from Appendix H
const COMMISSIONS: Record<string, number[]> = {
  'Joshua Barone': [33222.35, 24330.54, 26296.43, 23972.53, 24702.47, 23929.50, 25196.25, 25132.40, 24525.29, 25863.64, 25515.49, 26383.72, 26458.24],
  'Robert Barone': [8000, 8000, 8000, 8000, 8000, 8000, 8000, 8000, 8000, 8063.07, 8000, 8000, 33450],
  'Andrea Nolan': [24599.33, 25377.00, 28425.73, 28367.77, 29090.74, 28247.00, 29690.59, 28993.70, 29409.03, 31564.46, 30064.81, 31808.34, 31865.76],
  'Michael Lambrecht': [19740.30, 18019.99, 19727.28, 17989.38, 20117.64, 18997.79, 20715.49, 21130.97, 20641.50, 22205.54, 23873.20, 22155.06, 22409.31],
  'Eugene Hoover': [192.38, 373.25, 309.82, 859.16, 1428.65, 293.72, 307.14, 308.08, 987.40, 1228.31, 2117.59, 1043.23, 1597.27],
};

// Quarter aggregation: sum months
// Q1 2025 = Jan + Feb + Mar (indices 0, 1, 2)
// Q2 2025 = Apr + May + Jun (indices 3, 4, 5)
// Q3 2025 = Jul + Aug + Sep (indices 6, 7, 8)
// Q4 2025 = Oct + Nov + Dec (indices 9, 10, 11)
// Jan 2026 = index 12 (monthly, no aggregation)

interface PeriodData {
  period: string;
  grossRevenue: number;
  commissionsPaid: number;
  amountEarned: number;
}

function aggregateBaroneData(advisorName: string): PeriodData[] {
  const rev = REVENUE[advisorName];
  const comm = COMMISSIONS[advisorName];

  if (!rev || !comm) return [];

  const results: PeriodData[] = [];

  // Q1 2025: Jan + Feb + Mar (indices 0, 1, 2)
  const q1Rev = rev[0] + rev[1] + rev[2];
  const q1Comm = comm[0] + comm[1] + comm[2];
  results.push({
    period: 'Q1 2025',
    grossRevenue: Math.round(q1Rev * 100) / 100,
    commissionsPaid: Math.round(q1Comm * 100) / 100,
    amountEarned: Math.round((q1Rev - q1Comm) * 100) / 100,
  });

  // Q2 2025: Apr + May + Jun (indices 3, 4, 5)
  const q2Rev = rev[3] + rev[4] + rev[5];
  const q2Comm = comm[3] + comm[4] + comm[5];
  results.push({
    period: 'Q2 2025',
    grossRevenue: Math.round(q2Rev * 100) / 100,
    commissionsPaid: Math.round(q2Comm * 100) / 100,
    amountEarned: Math.round((q2Rev - q2Comm) * 100) / 100,
  });

  // Q3 2025: Jul + Aug + Sep (indices 6, 7, 8)
  const q3Rev = rev[6] + rev[7] + rev[8];
  const q3Comm = comm[6] + comm[7] + comm[8];
  results.push({
    period: 'Q3 2025',
    grossRevenue: Math.round(q3Rev * 100) / 100,
    commissionsPaid: Math.round(q3Comm * 100) / 100,
    amountEarned: Math.round((q3Rev - q3Comm) * 100) / 100,
  });

  // Q4 2025: Oct + Nov + Dec (indices 9, 10, 11)
  const q4Rev = rev[9] + rev[10] + rev[11];
  const q4Comm = comm[9] + comm[10] + comm[11];
  results.push({
    period: 'Q4 2025',
    grossRevenue: Math.round(q4Rev * 100) / 100,
    commissionsPaid: Math.round(q4Comm * 100) / 100,
    amountEarned: Math.round((q4Rev - q4Comm) * 100) / 100,
  });

  // Jan 2026: monthly (index 12)
  const jan26Rev = rev[12];
  const jan26Comm = comm[12];
  results.push({
    period: 'Jan 2026',
    grossRevenue: Math.round(jan26Rev * 100) / 100,
    commissionsPaid: Math.round(jan26Comm * 100) / 100,
    amountEarned: Math.round((jan26Rev - jan26Comm) * 100) / 100,
  });

  return results;
}

async function runETL() {
  console.log('=== GC Hub: Barone Team Override ETL ===\n');
  console.log('This data OVERRIDES all other sources for Barone team members.');
  console.log('Source: CFO-provided data (Appendix H)\n');

  const syncLog = await prisma.gcSyncLog.create({
    data: {
      syncType: 'historical_etl',
      sourceWorkbookId: 'CFO_PROVIDED_APPENDIX_H',
      status: 'started',
      triggeredBy: 'manual',
    },
  });

  let totalInserted = 0;
  let totalUpdated = 0;
  const errors: string[] = [];

  try {
    const baroneMembers = Object.keys(REVENUE);

    for (const advisorName of baroneMembers) {
      console.log(`  Processing ${advisorName}...`);
      const periodData = aggregateBaroneData(advisorName);

      for (const data of periodData) {
        try {
          const existing = await prisma.gcAdvisorPeriodData.findUnique({
            where: {
              advisorNormalizedName_period: {
                advisorNormalizedName: advisorName,
                period: data.period,
              },
            },
          });

          if (existing) {
            await prisma.gcAdvisorPeriodData.update({
              where: {
                advisorNormalizedName_period: {
                  advisorNormalizedName: advisorName,
                  period: data.period,
                },
              },
              data: {
                grossRevenue: data.grossRevenue,
                commissionsPaid: data.commissionsPaid,
                amountEarned: data.amountEarned,
                sourceWorkbookId: 'CFO_PROVIDED',
                sourceTab: 'Appendix H',
                dataSource: 'cfo_provided',
                lastSyncedAt: new Date(),
              },
            });
            totalUpdated++;
          } else {
            await prisma.gcAdvisorPeriodData.create({
              data: {
                advisorNormalizedName: advisorName,
                period: data.period,
                periodStart: periodToStartDate(data.period),
                grossRevenue: data.grossRevenue,
                commissionsPaid: data.commissionsPaid,
                amountEarned: data.amountEarned,
                sourceWorkbookId: 'CFO_PROVIDED',
                sourceTab: 'Appendix H',
                dataSource: 'cfo_provided',
              },
            });
            totalInserted++;
          }
        } catch (err: any) {
          errors.push(`${advisorName}/${data.period}: ${err.message}`);
        }
      }

      // Log sample data for verification
      const q1Data = periodData.find(p => p.period === 'Q1 2025');
      if (q1Data) {
        console.log(`    Q1 2025: Rev $${q1Data.grossRevenue.toFixed(2)}, Comm $${q1Data.commissionsPaid.toFixed(2)}, Earned $${q1Data.amountEarned.toFixed(2)}`);
      }
    }

    await prisma.gcSyncLog.update({
      where: { id: syncLog.id },
      data: {
        status: 'completed',
        recordsProcessed: totalInserted + totalUpdated,
        recordsInserted: totalInserted,
        recordsUpdated: totalUpdated,
        errorMessage: errors.length > 0 ? errors.join('\n') : null,
        completedAt: new Date(),
      },
    });

    console.log(`\n✅ Barone Override ETL Complete`);
    console.log(`   Inserted: ${totalInserted}`);
    console.log(`   Updated (overridden): ${totalUpdated}`);
    console.log(`   Team members: ${baroneMembers.length}`);
    console.log(`   Periods per member: 5 (Q1-Q4 2025 + Jan 2026)`);
    if (errors.length > 0) {
      console.log(`   ⚠️ Errors (${errors.length}):`);
      errors.forEach(e => console.log(`     - ${e}`));
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
