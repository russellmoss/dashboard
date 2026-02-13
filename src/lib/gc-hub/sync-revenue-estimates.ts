// src/lib/gc-hub/sync-revenue-estimates.ts
// 2026+ live data sync from Revenue Estimates workbook
import { prisma } from '@/lib/prisma';
import { getValues, getMetadata } from '@/lib/sheets/gc-sheets-reader';
import {
  normalizeAdvisorName,
  shouldExcludeEntry,
  isBaroneTeamMember,
  parseCurrency,
  periodToStartDate,
} from '@/lib/gc-hub/data-utils';
import { logger } from '@/lib/logger';

/** Throws if GC_REVENUE_ESTIMATES_SHEET_ID is not set (e.g. on Vercel). Call at start of sync. */
function getRevenueEstimatesSheetId(): string {
  const id = process.env.GC_REVENUE_ESTIMATES_SHEET_ID;
  if (!id || !id.trim()) {
    throw new Error(
      'GC_REVENUE_ESTIMATES_SHEET_ID is not set. Add it in Vercel (Project Settings → Environment Variables) to enable GC Hub live sync.'
    );
  }
  return id.trim();
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export interface SyncResult {
  month: string;
  year: number;
  period: string;
  advisorsProcessed: number;
  advisorsInserted: number;
  advisorsUpdated: number;
  advisorsSkipped: number;
  errors: string[];
}

/**
 * Find column index by searching header row for matching text.
 * Returns -1 if not found.
 */
function findColumnByHeader(
  headerRow: any[],
  searchTerms: string[],
  excludeTerms: string[] = []
): number {
  for (let i = 0; i < headerRow.length; i++) {
    const header = String(headerRow[i] || '').toLowerCase().trim();
    const matchesSearch = searchTerms.some((term) =>
      header.includes(term.toLowerCase())
    );
    const matchesExclude = excludeTerms.some((term) =>
      header.includes(term.toLowerCase())
    );
    if (matchesSearch && !matchesExclude) return i;
  }
  return -1;
}

/**
 * Discover which monthly summary tabs exist in the workbook.
 */
export async function discoverAvailableMonths(): Promise<
  { month: string; year: number; tabName: string }[]
> {
  const spreadsheetId = getRevenueEstimatesSheetId();
  const meta = await getMetadata(spreadsheetId);
  const results: { month: string; year: number; tabName: string }[] = [];

  for (const sheet of meta.sheets) {
    const match = sheet.title.match(/^(\w+)\s*-\s*Summary$/i);
    if (match) {
      const monthName = match[1];
      if (MONTH_NAMES.some((m) => m.toLowerCase() === monthName.toLowerCase())) {
        results.push({
          month: MONTH_NAMES[MONTH_NAMES.findIndex((m) => m.toLowerCase() === monthName.toLowerCase())],
          year: 2026,
          tabName: sheet.title,
        });
      }
    }
  }

  return results;
}

/**
 * Sync a single month from Revenue Estimates workbook into GcAdvisorPeriodData.
 */
export async function syncMonth(
  monthName: string,
  year: number = 2026
): Promise<SyncResult> {
  const tabName = `${monthName} - Summary`;
  const period = `${monthName} ${year}`;
  const result: SyncResult = {
    month: monthName,
    year,
    period,
    advisorsProcessed: 0,
    advisorsInserted: 0,
    advisorsUpdated: 0,
    advisorsSkipped: 0,
    errors: [],
  };

  const spreadsheetId = getRevenueEstimatesSheetId();
  const rows = await getValues(
    spreadsheetId,
    `'${tabName}'!A1:Z120`,
    'UNFORMATTED_VALUE'
  );
  if (!rows || rows.length === 0) {
    result.errors.push(`No data from ${tabName}`);
    return result;
  }

  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const row = rows[i];
    if (!row) continue;
    const rowText = row.map((c: any) => String(c || '').toLowerCase()).join(' ');
    if (rowText.includes('orion id') || rowText.includes('advisor name')) {
      headerRowIdx = i;
      break;
    }
  }

  if (headerRowIdx === -1) {
    result.errors.push(`Cannot find header row in ${tabName}`);
    return result;
  }

  const headerRow = rows[headerRowIdx];

  const orionIdCol = findColumnByHeader(headerRow, ['orion id', 'orion']);
  let nameCol = findColumnByHeader(headerRow, ['advisor name', 'name'], ['account']);
  // Some tabs (e.g. Feb - Summary) may have different header; Col C = Advisor Name per guide
  if (nameCol === -1) nameCol = 2;
  const typeCol = findColumnByHeader(headerRow, ['type']);

  const revenueCol = findColumnByHeader(headerRow, ['rev'], [
    'share',
    'accrual',
    'from aum',
    'actual',
  ]);
  const revenueFallback =
    revenueCol === -1
      ? findColumnByHeader(headerRow, ['actual revenue'])
      : revenueCol;

  const cogsCol = findColumnByHeader(headerRow, ['cogs'], ['actual']);

  logger.info(
    `[GC Sync] ${tabName} column indices: orion=${orionIdCol}, name=${nameCol}, type=${typeCol}, rev=${revenueCol}, cogs=${cogsCol}`
  );

  const finalRevenueCol = revenueCol !== -1 ? revenueCol : revenueFallback;
  if (
    nameCol === -1 ||
    finalRevenueCol === -1 ||
    cogsCol === -1
  ) {
    result.errors.push(
      `Cannot find required columns in ${tabName}. Header: ${JSON.stringify(headerRow)}`
    );
    return result;
  }

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const advisorName = String(row[nameCol] || '').trim();
    if (!advisorName) continue;

    if (
      advisorName.toLowerCase().includes('total') ||
      advisorName.toLowerCase().includes('grand')
    ) {
      continue;
    }

    const canonical = normalizeAdvisorName(advisorName);

    if (shouldExcludeEntry(advisorName) || shouldExcludeEntry(canonical)) {
      result.advisorsSkipped++;
      continue;
    }
    // Barone team uses only CFO-provided data; do not overwrite with live_sync
    if (isBaroneTeamMember(canonical)) {
      result.advisorsSkipped++;
      continue;
    }

    const orionId =
      orionIdCol >= 0 && row[orionIdCol]
        ? String(row[orionIdCol]).trim()
        : null;
    const accountName =
      typeCol >= 0 && row[typeCol] ? String(row[typeCol]).trim() : null;
    const grossRevenue = parseCurrency(row[finalRevenueCol]);
    const commissionsPaid = parseCurrency(row[cogsCol]);

    const amountEarned =
      grossRevenue !== null && commissionsPaid !== null
        ? Math.round((grossRevenue - commissionsPaid) * 100) / 100
        : null;

    result.advisorsProcessed++;

    try {
      const existing = await prisma.gcAdvisorPeriodData.findUnique({
        where: {
          advisorNormalizedName_period: {
            advisorNormalizedName: canonical,
            period,
          },
        },
      });

      if (existing) {
        if (existing.isManuallyOverridden) {
          result.advisorsSkipped++;
          continue;
        }

        await prisma.gcAdvisorPeriodData.update({
          where: {
            advisorNormalizedName_period: {
              advisorNormalizedName: canonical,
              period,
            },
          },
          data: {
            orionRepresentativeId: orionId,
            accountName,
            grossRevenue,
            commissionsPaid,
            amountEarned,
            sourceWorkbookId: spreadsheetId,
            sourceTab: tabName,
            dataSource: 'live_sync',
            lastSyncedAt: new Date(),
          },
        });
        result.advisorsUpdated++;
      } else {
        await prisma.gcAdvisorPeriodData.create({
          data: {
            advisorNormalizedName: canonical,
            orionRepresentativeId: orionId,
            accountName,
            period,
            periodStart: periodToStartDate(period),
            grossRevenue,
            commissionsPaid,
            amountEarned,
            sourceWorkbookId: spreadsheetId,
            sourceTab: tabName,
            dataSource: 'live_sync',
          },
        });
        result.advisorsInserted++;
      }
    } catch (err: any) {
      result.errors.push(`${canonical}: ${err.message}`);
    }
  }

  return result;
}

/**
 * Full sync: discover all available months and sync each one.
 */
export async function syncAllMonths(): Promise<SyncResult[]> {
  const months = await discoverAvailableMonths();
  logger.info(
    `[GC Sync] Found ${months.length} monthly tabs: ${months.map((m) => m.month).join(', ')}`
  );

  const results: SyncResult[] = [];
  for (const { month, year } of months) {
    const result = await syncMonth(month, year);
    results.push(result);
  }

  return results;
}
