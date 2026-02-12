// scripts/gc-hub/etl-payouts-tracker.ts
import * as dotenv from 'dotenv';
dotenv.config();

import prisma from '../../src/lib/prisma';
import { getValues } from '../../src/lib/sheets/gc-sheets-reader';
import {
  normalizeAdvisorName, shouldExcludeEntry, getSubEntryParent,
  isBaroneTeamMember, parseCurrency, periodToStartDate,
} from '../../src/lib/gc-hub/data-utils';

const PAYOUTS_TRACKER_ID = process.env.GC_PAYOUTS_TRACKER_SHEET_ID!;

// Source: gc_dashboard_data_exploration.md Findings 2A
const QUARTERLY_TABS = [
  { tab: '2023Q1_Payouts', period: 'Q1 2023' },
  { tab: '2023Q2_Payouts', period: 'Q2 2023' },
  { tab: '2023Q3_Payouts', period: 'Q3 2023' },
  { tab: '2023Q4_Payouts', period: 'Q4 2023' },
  { tab: '2024Q1_Payouts', period: 'Q1 2024' },
  { tab: '2024Q2_Payouts', period: 'Q2 2024' },
  { tab: '2024Q3_Payouts', period: 'Q3 2024' },
  { tab: '2024Q4_Payouts', period: 'Q4 2024' },
  { tab: '2025Q1_Payouts', period: 'Q1 2025' },
  { tab: '2025Q2_Payouts', period: 'Q2 2025' },
];

interface ExtractedRow {
  advisorName: string;
  grossRevenue: number | null;
  commissionsPaid: number | null;
}

/**
 * Extract revenue/commission data from Payouts tabs.
 *
 * Structure varies by quarter:
 * - Q1-Q2 2023: Look for "Servicing Rev Participation" section with "Q1/Q2 Revenue" column header
 * - Q3 2023+: Look for "Revenue Share Participation" section with "Net Revenue" column header
 *
 * The key difference: we need to find the section that has REVENUE data, not just commission summaries.
 */
function extractPayoutSection(rows: any[][], period: string): ExtractedRow[] {
  const results: ExtractedRow[] = [];

  // Find the detail section with revenue data
  // Look for a row that has both the section header AND revenue column header
  let dataStartRow = -1;
  let revenueColIdx = 2; // Default Col C
  let commissionColIdx = 3; // Default Col D

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 3) continue;

    const rowText = row.map((c: any) => String(c || '').toLowerCase()).join(' ');

    // Look for the detail section header that includes revenue column
    // Q1-Q2 2023: "Servicing Rev Participation" with "Q1 Revenue" or "Q2 Revenue"
    // Q3 2023+: "Revenue Share Participation" with "Net Revenue" or "Qx Net Revenue"
    if (
      (rowText.includes('servicing rev participation') || rowText.includes('revenue share participation')) &&
      (rowText.includes('revenue') && !rowText.includes('total'))
    ) {
      // This is the header row - find column indices
      for (let c = 0; c < row.length; c++) {
        const cellText = String(row[c] || '').toLowerCase();
        if (cellText.includes('revenue') && !cellText.includes('commission')) {
          revenueColIdx = c;
        }
        if (cellText.includes('advisor commission') || (cellText.includes('commission') && !cellText.includes('cash') && !cellText.includes('equity'))) {
          commissionColIdx = c;
        }
      }
      dataStartRow = i + 1;
      break;
    }
  }

  if (dataStartRow === -1) {
    console.log(`    ⚠️ Could not find revenue section in ${period}`);
    return results;
  }

  // Extract data rows
  for (let i = dataStartRow; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 3) break;

    const cellB = String(row[1] || '').trim();
    if (!cellB) break; // Empty row ends section
    if (cellB.toLowerCase().includes('total')) break;

    // Skip sub-section headers or notes
    if (cellB.startsWith('  ')) continue; // Indented = sub-item

    const revenue = parseCurrency(row[revenueColIdx]);
    const commission = parseCurrency(row[commissionColIdx]);

    results.push({
      advisorName: cellB,
      grossRevenue: revenue,
      commissionsPaid: commission,
    });
  }

  return results;
}

/**
 * Special handler for Q4 2022
 */
async function extractQ4_2022(): Promise<Map<string, ExtractedRow>> {
  console.log('  Processing Q4 2022 (special: Old Inputs + 2022Q4_Payouts)...');

  // Read Old Inputs for separated Q4 revenue
  const oldInputsRows = await getValues(PAYOUTS_TRACKER_ID, 'Old Inputs!A1:N120');
  if (!oldInputsRows) throw new Error('No data from Old Inputs tab');

  // Find Q4-2022 revenue in "Advisor Net Revenue Collected by Quarter" section
  const q4RevenueByName = new Map<string, number>();
  let inRevenueSection = false;
  let q4ColIdx = 3; // Default: Col D (Q4-2022)
  let foundColumnHeaders = false;

  for (let i = 0; i < oldInputsRows.length; i++) {
    const row = oldInputsRows[i];
    if (!row) continue;
    const rowText = row.map((c: any) => String(c || '')).join(' ').toLowerCase();

    // Find section header
    if (rowText.includes('advisor net revenue') || rowText.includes('net revenue collected')) {
      inRevenueSection = true;
      continue;
    }
    if (!inRevenueSection) continue;

    // Look for column header row with Q4-2022
    if (!foundColumnHeaders) {
      for (let c = 0; c < row.length; c++) {
        const cellText = String(row[c] || '').toLowerCase();
        if (cellText.includes('q4') && cellText.includes('2022')) {
          q4ColIdx = c;
          foundColumnHeaders = true;
          break;
        }
      }
      if (foundColumnHeaders) continue; // Skip the header row
      continue; // Skip rows until we find headers
    }

    const cellB = String(row[1] || '').trim();
    const cellA = String(row[0] || '').trim();
    const name = cellB || cellA;

    if (!name) continue; // Skip empty rows but don't break
    if (name.toLowerCase().includes('total')) break;

    const q4Revenue = parseCurrency(row[q4ColIdx]);
    if (q4Revenue !== null) {
      q4RevenueByName.set(normalizeAdvisorName(name), q4Revenue);
    }
  }

  // Read 2022Q4_Payouts for combined commission
  const q4PayoutsRows = await getValues(PAYOUTS_TRACKER_ID, '2022Q4_Payouts!A1:J100');
  if (!q4PayoutsRows) throw new Error('No data from 2022Q4_Payouts tab');

  // Find the servicing rev participation detail section
  const combinedData = extractPayoutSection(q4PayoutsRows, 'Q4 2022');

  // Pro-rate commission based on Q4 revenue vs combined revenue
  const results = new Map<string, ExtractedRow>();
  for (const row of combinedData) {
    const canonical = normalizeAdvisorName(row.advisorName);
    const q4Revenue = q4RevenueByName.get(canonical) ?? null;
    const combinedRevenue = row.grossRevenue;
    const combinedCommission = row.commissionsPaid;

    let q4Commission: number | null = null;
    if (q4Revenue !== null && combinedRevenue !== null && combinedCommission !== null && combinedRevenue > 0) {
      q4Commission = (q4Revenue / combinedRevenue) * combinedCommission;
    } else if (combinedCommission === 0 || combinedCommission === null) {
      q4Commission = 0;
    }

    if (q4Revenue !== null) {
      results.set(canonical, {
        advisorName: canonical,
        grossRevenue: q4Revenue,
        commissionsPaid: q4Commission !== null ? Math.round(q4Commission * 100) / 100 : null,
      });
    }
  }

  // Also add advisors from Old Inputs that might not be in 2022Q4_Payouts
  for (const [name, revenue] of q4RevenueByName) {
    if (!results.has(name)) {
      results.set(name, {
        advisorName: name,
        grossRevenue: revenue,
        commissionsPaid: 0, // No commission record = $0 commission
      });
    }
  }

  return results;
}

async function runETL() {
  console.log('=== GC Hub: Payouts Tracker ETL (Q4 2022 → Q2 2025) ===\n');

  const syncLog = await prisma.gcSyncLog.create({
    data: {
      syncType: 'historical_etl',
      sourceWorkbookId: PAYOUTS_TRACKER_ID,
      status: 'started',
      triggeredBy: 'manual',
    },
  });

  let totalInserted = 0;
  let totalSkipped = 0;
  const errors: string[] = [];

  try {
    // ---- Q4 2022 (special) ----
    const q4_2022_data = await extractQ4_2022();
    for (const [canonical, data] of q4_2022_data) {
      if (shouldExcludeEntry(data.advisorName) || shouldExcludeEntry(canonical)) {
        totalSkipped++;
        continue;
      }
      if (isBaroneTeamMember(canonical)) {
        totalSkipped++;
        continue;
      }

      const amountEarned =
        data.grossRevenue !== null && data.commissionsPaid !== null
          ? Math.round((data.grossRevenue - data.commissionsPaid) * 100) / 100
          : null;

      try {
        await prisma.gcAdvisorPeriodData.upsert({
          where: {
            advisorNormalizedName_period: {
              advisorNormalizedName: canonical,
              period: 'Q4 2022',
            },
          },
          create: {
            advisorNormalizedName: canonical,
            period: 'Q4 2022',
            periodStart: periodToStartDate('Q4 2022'),
            grossRevenue: data.grossRevenue,
            commissionsPaid: data.commissionsPaid,
            amountEarned,
            sourceWorkbookId: PAYOUTS_TRACKER_ID,
            sourceTab: 'Old Inputs + 2022Q4_Payouts',
            dataSource: 'historical_etl',
          },
          update: {
            grossRevenue: data.grossRevenue,
            commissionsPaid: data.commissionsPaid,
            amountEarned,
            sourceWorkbookId: PAYOUTS_TRACKER_ID,
            sourceTab: 'Old Inputs + 2022Q4_Payouts',
            lastSyncedAt: new Date(),
          },
        });
        totalInserted++;
      } catch (err: any) {
        errors.push(`Q4 2022/${canonical}: ${err.message}`);
      }
    }
    console.log(`  Q4 2022: ${q4_2022_data.size} advisors extracted`);

    // ---- Q1 2023 through Q2 2025 ----
    for (const { tab, period } of QUARTERLY_TABS) {
      console.log(`  Processing ${period} (${tab})...`);
      const rows = await getValues(PAYOUTS_TRACKER_ID, `'${tab}'!A1:J100`);
      if (!rows) {
        errors.push(`${period}: No data from ${tab}`);
        continue;
      }

      const extracted = extractPayoutSection(rows, period);
      const rollups = new Map<string, { revenue: number; commission: number }>();

      for (const row of extracted) {
        const canonical = normalizeAdvisorName(row.advisorName);

        if (shouldExcludeEntry(row.advisorName) || shouldExcludeEntry(canonical)) {
          totalSkipped++;
          continue;
        }

        if (isBaroneTeamMember(canonical)) {
          totalSkipped++;
          continue;
        }

        // Check for sub-entry rollup (Frank Malpigli → Michael Most)
        const parentName = getSubEntryParent(row.advisorName);
        if (parentName) {
          const existing = rollups.get(parentName) || { revenue: 0, commission: 0 };
          existing.commission += row.commissionsPaid || 0;
          rollups.set(parentName, existing);
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
                period,
              },
            },
            create: {
              advisorNormalizedName: canonical,
              period,
              periodStart: periodToStartDate(period),
              grossRevenue: row.grossRevenue,
              commissionsPaid: row.commissionsPaid,
              amountEarned,
              sourceWorkbookId: PAYOUTS_TRACKER_ID,
              sourceTab: tab,
              dataSource: 'historical_etl',
            },
            update: {
              grossRevenue: row.grossRevenue,
              commissionsPaid: row.commissionsPaid,
              amountEarned,
              sourceWorkbookId: PAYOUTS_TRACKER_ID,
              sourceTab: tab,
              lastSyncedAt: new Date(),
            },
          });
          totalInserted++;
        } catch (err: any) {
          errors.push(`${period}/${canonical}: ${err.message}`);
        }
      }

      // Apply sub-entry rollups
      for (const [parentName, rollup] of rollups) {
        try {
          const existing = await prisma.gcAdvisorPeriodData.findUnique({
            where: {
              advisorNormalizedName_period: {
                advisorNormalizedName: parentName,
                period,
              },
            },
          });
          if (existing && existing.commissionsPaid !== null) {
            const newComm = existing.commissionsPaid + rollup.commission;
            const newEarned = existing.grossRevenue !== null
              ? Math.round((existing.grossRevenue - newComm) * 100) / 100
              : null;
            await prisma.gcAdvisorPeriodData.update({
              where: {
                advisorNormalizedName_period: {
                  advisorNormalizedName: parentName,
                  period,
                },
              },
              data: {
                commissionsPaid: newComm,
                amountEarned: newEarned,
              },
            });
          }
        } catch (err: any) {
          errors.push(`Rollup ${parentName}/${period}: ${err.message}`);
        }
      }

      console.log(`    → ${extracted.length} rows extracted`);
    }

    // Update sync log
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

    console.log(`\n✅ Payouts Tracker ETL Complete`);
    console.log(`   Inserted/Updated: ${totalInserted}`);
    console.log(`   Skipped (excluded/Barone): ${totalSkipped}`);
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
