import { prisma } from '@/lib/prisma';
import type { UserPermissions } from '@/types/user';
import { GC_CP_MIN_START_DATE } from '@/config/gc-hub-theme';

// ============================================================
// TYPES
// ============================================================

export interface GcHubFilters {
  startDate?: string;     // ISO date string "2022-10-01"
  endDate?: string;       // ISO date string "2026-01-31"
  accountNames?: string[]; // Filter by team/account
  advisorNames?: string[]; // Filter by advisor (admin only, ignored for CP)
  billingFrequency?: string; // "quarterly" | "monthly"
}

export interface GcPeriodSummary {
  period: string;
  periodStart: string;
  totalRevenue: number;
  totalCommissions: number;
  totalAmountEarned: number;
  activeAdvisorCount: number;
  revenuePerAdvisor: number;
}

export interface GcAdvisorRow {
  advisorName: string;       // Real or anonymous depending on role
  accountName: string | null; // Real or anonymous depending on role
  orionRepresentativeId: string | null;
  period: string;
  periodStart: string;
  grossRevenue: number | null;
  commissionsPaid: number | null;
  amountEarned: number | null;
  billingFrequency: string | null;
  billingStyle: string | null;
  dataSource: string;
  isManuallyOverridden: boolean;
}

export interface GcAdvisorDetail {
  advisorName: string;
  accountName: string | null;
  orionRepresentativeId: string | null;
  billingFrequency: string | null;
  billingStyle: string | null;
  periods: {
    period: string;
    periodStart: string;
    grossRevenue: number | null;
    commissionsPaid: number | null;
    amountEarned: number | null;
    dataSource: string;
  }[];
}

// ============================================================
// ANONYMIZATION HELPER
// ============================================================

/**
 * Applies anonymization for Capital Partner users.
 * Replaces real advisor names with anonymous IDs from GcAdvisorMapping.
 * Only shows anonymousAccountName for accounts with 2+ advisors.
 * Called at the query layer — Capital Partners never see real names.
 */
async function getAnonymizationMap(): Promise<Map<string, { anonymousAdvisorId: string; anonymousAccountName: string | null }>> {
  const mappings = await prisma.gcAdvisorMapping.findMany({
    where: { isExcluded: false },
    select: {
      advisorNormalizedName: true,
      anonymousAdvisorId: true,
      anonymousAccountName: true,
      accountName: true,
    },
  });

  // Count advisors per account to determine which accounts have 2+ members
  const accountCounts = new Map<string, number>();
  for (const m of mappings) {
    if (m.accountName) {
      accountCounts.set(m.accountName, (accountCounts.get(m.accountName) || 0) + 1);
    }
  }

  // Build the map, only including anonymousAccountName for multi-advisor accounts
  const map = new Map<string, { anonymousAdvisorId: string; anonymousAccountName: string | null }>();
  for (const m of mappings) {
    const accountSize = m.accountName ? accountCounts.get(m.accountName) || 0 : 0;
    map.set(m.advisorNormalizedName, {
      anonymousAdvisorId: m.anonymousAdvisorId,
      // Only show team name if account has 2+ advisors
      anonymousAccountName: accountSize >= 2 ? m.anonymousAccountName : null,
    });
  }
  return map;
}

function isCapitalPartner(permissions: UserPermissions): boolean {
  return permissions.role === 'capital_partner';
}

/** For Capital Partners, startDate cannot be before 2024-01-01. Admin/RevOps unchanged. */
function effectiveStartDate(permissions: UserPermissions, startDate: string | undefined): string | undefined {
  if (!startDate) return startDate;
  if (!isCapitalPartner(permissions)) return startDate;
  return startDate < GC_CP_MIN_START_DATE ? GC_CP_MIN_START_DATE : startDate;
}

/**
 * Gets a map from advisorNormalizedName -> accountName for advisors on multi-member teams.
 * Returns null for solo advisors. Uses GcAdvisorMapping as source of truth since
 * GcAdvisorPeriodData.accountName can be inconsistent (null, "Individual", etc.).
 */
async function getAdvisorTeamMap(): Promise<Map<string, string | null>> {
  const mappings = await prisma.gcAdvisorMapping.findMany({
    where: { isExcluded: false },
    select: { advisorNormalizedName: true, accountName: true },
  });

  // Count advisors per account
  const accountCounts = new Map<string, number>();
  for (const m of mappings) {
    if (m.accountName) {
      accountCounts.set(m.accountName, (accountCounts.get(m.accountName) || 0) + 1);
    }
  }

  // Build map: advisor -> team name (only if team has 2+ members)
  const advisorTeamMap = new Map<string, string | null>();
  for (const m of mappings) {
    const teamSize = m.accountName ? accountCounts.get(m.accountName) || 0 : 0;
    // Only show team name if it's a real team (2+ advisors)
    advisorTeamMap.set(m.advisorNormalizedName, teamSize >= 2 ? m.accountName : null);
  }
  return advisorTeamMap;
}

// ============================================================
// QUERY: Period Summary (for charts)
// ============================================================

export async function getGcPeriodSummary(
  permissions: UserPermissions,
  filters: GcHubFilters
): Promise<GcPeriodSummary[]> {
  const where: any = {};

  // Date range filter (Capital Partner: startDate clamped to 2024-01-01 minimum)
  const start = effectiveStartDate(permissions, filters.startDate);
  if (start || filters.endDate) {
    where.periodStart = {};
    if (start) where.periodStart.gte = new Date(start);
    if (filters.endDate) where.periodStart.lte = new Date(filters.endDate);
  }

  // Account filter (works for both roles — CP uses anonymous names that we map back)
  // We filter by looking up advisors in the mapping table to ensure consistency
  if (filters.accountNames && filters.accountNames.length > 0) {
    const mappingWhere = isCapitalPartner(permissions)
      ? { anonymousAccountName: { in: filters.accountNames }, isExcluded: false }
      : { accountName: { in: filters.accountNames }, isExcluded: false };

    const mappings = await prisma.gcAdvisorMapping.findMany({
      where: mappingWhere,
      select: { advisorNormalizedName: true },
    });
    const advisorNames = mappings.map(m => m.advisorNormalizedName);
    if (advisorNames.length > 0) {
      // Store for later intersection with advisor filter
      where.advisorNormalizedName = { in: advisorNames };
    } else {
      // No advisors found for this account — return empty
      where.advisorNormalizedName = { in: [] };
    }
  }

  // Advisor name filter (admin only — CP can't filter by real name)
  if (!isCapitalPartner(permissions) && filters.advisorNames && filters.advisorNames.length > 0) {
    if (where.advisorNormalizedName?.in) {
      // Intersect with account filter
      where.advisorNormalizedName.in = where.advisorNormalizedName.in.filter(
        (n: string) => filters.advisorNames!.includes(n)
      );
    } else {
      where.advisorNormalizedName = { in: filters.advisorNames };
    }
  }

  // Billing frequency filter
  if (filters.billingFrequency) {
    where.billingFrequency = filters.billingFrequency;
  }

  // Exclude excluded advisors (but respect existing advisor filter if set)
  const excluded = await getExcludedAdvisorNames();
  if (where.advisorNormalizedName?.in) {
    // Filter out excluded from the selected advisors
    where.advisorNormalizedName.in = where.advisorNormalizedName.in.filter(
      (n: string) => !excluded.includes(n)
    );
  } else {
    where.advisorNormalizedName = {
      notIn: excluded,
    };
  }

  // Group by period
  const periods = await prisma.gcAdvisorPeriodData.groupBy({
    by: ['period', 'periodStart'],
    where,
    _sum: {
      grossRevenue: true,
      commissionsPaid: true,
      amountEarned: true,
    },
    _count: {
      advisorNormalizedName: true,
    },
    orderBy: {
      periodStart: 'asc',
    },
  });

  return periods.map(p => ({
    period: p.period,
    periodStart: p.periodStart.toISOString().split('T')[0],
    totalRevenue: p._sum.grossRevenue ?? 0,
    totalCommissions: p._sum.commissionsPaid ?? 0,
    totalAmountEarned: p._sum.amountEarned ?? 0,
    activeAdvisorCount: p._count.advisorNormalizedName,
    revenuePerAdvisor: p._count.advisorNormalizedName > 0
      ? (p._sum.grossRevenue ?? 0) / p._count.advisorNormalizedName
      : 0,
  }));
}

// ============================================================
// QUERY: Advisor Table (filterable, sortable)
// ============================================================

export async function getGcAdvisorTable(
  permissions: UserPermissions,
  filters: GcHubFilters & {
    sortBy?: string;
    sortDir?: 'asc' | 'desc';
    search?: string;
  }
): Promise<GcAdvisorRow[]> {
  const where: any = {};

  // Date range (Capital Partner: startDate clamped to 2024-01-01 minimum)
  const start = effectiveStartDate(permissions, filters.startDate);
  if (start || filters.endDate) {
    where.periodStart = {};
    if (start) where.periodStart.gte = new Date(start);
    if (filters.endDate) where.periodStart.lte = new Date(filters.endDate);
  }

  // Account filter (resolve to advisor names via mapping table for consistency)
  if (filters.accountNames && filters.accountNames.length > 0) {
    const mappingWhere = isCapitalPartner(permissions)
      ? { anonymousAccountName: { in: filters.accountNames }, isExcluded: false }
      : { accountName: { in: filters.accountNames }, isExcluded: false };

    const mappings = await prisma.gcAdvisorMapping.findMany({
      where: mappingWhere,
      select: { advisorNormalizedName: true },
    });
    const advisorNames = mappings.map(m => m.advisorNormalizedName);
    if (advisorNames.length > 0) {
      where.advisorNormalizedName = { in: advisorNames };
    } else {
      where.advisorNormalizedName = { in: [] };
    }
  }

  // Advisor name filter (admin only — CP can't filter by real name)
  if (!isCapitalPartner(permissions) && filters.advisorNames && filters.advisorNames.length > 0) {
    if (where.advisorNormalizedName?.in) {
      // Intersect with account filter
      where.advisorNormalizedName.in = where.advisorNormalizedName.in.filter(
        (n: string) => filters.advisorNames!.includes(n)
      );
    } else {
      where.advisorNormalizedName = { in: filters.advisorNames };
    }
  }

  // Search (admin searches real names, CP searches anonymous IDs)
  if (filters.search && filters.search.trim()) {
    const searchTerm = filters.search.trim();
    if (isCapitalPartner(permissions)) {
      // Resolve anonymous search to real names
      const mappings = await prisma.gcAdvisorMapping.findMany({
        where: {
          OR: [
            { anonymousAdvisorId: { contains: searchTerm, mode: 'insensitive' } },
            { anonymousAccountName: { contains: searchTerm, mode: 'insensitive' } },
          ],
        },
        select: { advisorNormalizedName: true },
      });
      const realNames = mappings.map(m => m.advisorNormalizedName);
      where.advisorNormalizedName = { in: realNames };
    } else {
      where.OR = [
        { advisorNormalizedName: { contains: searchTerm, mode: 'insensitive' } },
        { accountName: { contains: searchTerm, mode: 'insensitive' } },
      ];
    }
  }

  // Billing frequency
  if (filters.billingFrequency) {
    where.billingFrequency = filters.billingFrequency;
  }

  // Exclude excluded advisors
  const excluded = await getExcludedAdvisorNames();
  if (where.advisorNormalizedName) {
    // If we already have an advisorNormalizedName filter, intersect with exclusion
    if (where.advisorNormalizedName.in) {
      where.advisorNormalizedName.in = where.advisorNormalizedName.in.filter(
        (n: string) => !excluded.includes(n)
      );
    } else if (where.advisorNormalizedName.notIn) {
      where.advisorNormalizedName.notIn = [...where.advisorNormalizedName.notIn, ...excluded];
    }
  } else {
    where.advisorNormalizedName = { notIn: excluded };
  }

  // Sort
  const orderBy: any = {};
  const sortField = filters.sortBy || 'grossRevenue';
  const sortDirection = filters.sortDir || 'desc';
  orderBy[sortField] = sortDirection;

  const records = await prisma.gcAdvisorPeriodData.findMany({
    where,
    orderBy: [orderBy, { periodStart: 'asc' }],
  });

  // Apply anonymization for Capital Partners
  if (isCapitalPartner(permissions)) {
    const anonMap = await getAnonymizationMap();
    return records.map(r => ({
      advisorName: anonMap.get(r.advisorNormalizedName)?.anonymousAdvisorId ?? 'Unknown',
      accountName: anonMap.get(r.advisorNormalizedName)?.anonymousAccountName ?? null,
      orionRepresentativeId: null, // Hidden from CP
      period: r.period,
      periodStart: r.periodStart.toISOString().split('T')[0],
      grossRevenue: r.grossRevenue,
      commissionsPaid: r.commissionsPaid,
      amountEarned: r.amountEarned,
      billingFrequency: r.billingFrequency,
      billingStyle: r.billingStyle,
      dataSource: r.dataSource,
      isManuallyOverridden: false, // Hidden from CP
    }));
  }

  // For admins: use team assignment from mapping table (source of truth)
  // Period data accountName can be inconsistent (null, "Individual", etc.)
  const advisorTeamMap = await getAdvisorTeamMap();

  return records.map(r => ({
    advisorName: r.advisorNormalizedName,
    // Get team from mapping table, not from period data
    accountName: advisorTeamMap.get(r.advisorNormalizedName) ?? null,
    orionRepresentativeId: r.orionRepresentativeId,
    period: r.period,
    periodStart: r.periodStart.toISOString().split('T')[0],
    grossRevenue: r.grossRevenue,
    commissionsPaid: r.commissionsPaid,
    amountEarned: r.amountEarned,
    billingFrequency: r.billingFrequency,
    billingStyle: r.billingStyle,
    dataSource: r.dataSource,
    isManuallyOverridden: r.isManuallyOverridden,
  }));
}

// ============================================================
// QUERY: Advisor Detail (drill-down modal — admin/revops + capital partner)
// ============================================================

export async function getGcAdvisorDetail(
  permissions: UserPermissions,
  advisorName: string
): Promise<GcAdvisorDetail | null> {
  // For Capital Partners, advisorName is the anonymous ID (e.g., "Advisor 001")
  // We need to resolve it to the real advisor name first
  let realAdvisorName = advisorName;

  if (isCapitalPartner(permissions)) {
    const mapping = await prisma.gcAdvisorMapping.findFirst({
      where: { anonymousAdvisorId: advisorName },
      select: { advisorNormalizedName: true },
    });
    if (!mapping) return null;
    realAdvisorName = mapping.advisorNormalizedName;
  }

  let records = await prisma.gcAdvisorPeriodData.findMany({
    where: { advisorNormalizedName: realAdvisorName },
    orderBy: { periodStart: 'asc' },
  });

  // Capital Partner: only periods from 2024-01-01 onward (no 2022/2023)
  if (isCapitalPartner(permissions)) {
    const minDate = new Date(GC_CP_MIN_START_DATE);
    records = records.filter((r) => r.periodStart >= minDate);
  }

  if (records.length === 0) return null;

  const first = records[0];

  // For Capital Partners, return anonymized data
  if (isCapitalPartner(permissions)) {
    const anonMap = await getAnonymizationMap();
    const anonInfo = anonMap.get(realAdvisorName);

    return {
      advisorName: anonInfo?.anonymousAdvisorId ?? 'Unknown',
      accountName: anonInfo?.anonymousAccountName ?? null,
      orionRepresentativeId: null, // Hidden from CP
      billingFrequency: first.billingFrequency,
      billingStyle: first.billingStyle,
      periods: records.map(r => ({
        period: r.period,
        periodStart: r.periodStart.toISOString().split('T')[0],
        grossRevenue: r.grossRevenue,
        commissionsPaid: r.commissionsPaid,
        amountEarned: r.amountEarned,
        dataSource: 'Aggregated', // Hide specific data source from CP
      })),
    };
  }

  // For admins: use team assignment from mapping table (source of truth)
  const advisorTeamMap = await getAdvisorTeamMap();

  return {
    advisorName: first.advisorNormalizedName,
    accountName: advisorTeamMap.get(first.advisorNormalizedName) ?? null,
    orionRepresentativeId: first.orionRepresentativeId,
    billingFrequency: first.billingFrequency,
    billingStyle: first.billingStyle,
    periods: records.map(r => ({
      id: r.id,
      period: r.period,
      periodStart: r.periodStart.toISOString().split('T')[0],
      grossRevenue: r.grossRevenue,
      commissionsPaid: r.commissionsPaid,
      amountEarned: r.amountEarned,
      dataSource: r.dataSource,
      isManuallyOverridden: r.isManuallyOverridden,
      originalGrossRevenue: r.originalGrossRevenue,
      originalCommissionsPaid: r.originalCommissionsPaid,
      overrideReason: r.overrideReason,
      overriddenBy: r.overriddenBy,
      overriddenAt: r.overriddenAt?.toISOString() ?? null,
    })),
  };
}

// ============================================================
// QUERY: Filter Options (for dropdowns)
// ============================================================

export async function getGcFilterOptions(
  permissions: UserPermissions
): Promise<{
  accountNames: string[];
  advisorNames: string[];
  advisorsByAccount: Record<string, string[]>;
  periods: string[];
  billingFrequencies: string[];
}> {
  const excluded = await getExcludedAdvisorNames();

  // Get all advisors with their account names
  const advisors = await prisma.gcAdvisorMapping.findMany({
    where: { isExcluded: false },
    select: {
      advisorNormalizedName: true,
      anonymousAdvisorId: true,
      accountName: true,
      anonymousAccountName: true,
    },
    orderBy: { advisorNormalizedName: 'asc' },
  });

  // Build account -> advisors mapping and count advisors per account
  const accountAdvisorMap = new Map<string, string[]>();
  const anonAccountAdvisorMap = new Map<string, string[]>();

  for (const advisor of advisors) {
    if (advisor.accountName) {
      const existing = accountAdvisorMap.get(advisor.accountName) || [];
      existing.push(advisor.advisorNormalizedName);
      accountAdvisorMap.set(advisor.accountName, existing);
    }
    if (advisor.anonymousAccountName) {
      const existing = anonAccountAdvisorMap.get(advisor.anonymousAccountName) || [];
      existing.push(advisor.anonymousAdvisorId);
      anonAccountAdvisorMap.set(advisor.anonymousAccountName, existing);
    }
  }

  // Filter to accounts with 2+ advisors, sort alphabetically
  const accountsWithMultiple = Array.from(accountAdvisorMap.entries())
    .filter(([_, advisorList]) => advisorList.length > 1)
    .sort((a, b) => a[0].localeCompare(b[0]));

  const anonAccountsWithMultiple = Array.from(anonAccountAdvisorMap.entries())
    .filter(([_, advisorList]) => advisorList.length > 1)
    .sort((a, b) => a[0].localeCompare(b[0]));

  // Get distinct periods (Capital Partner: only 2024-01-01 onward)
  const periodWhere: any = { advisorNormalizedName: { notIn: excluded } };
  if (isCapitalPartner(permissions)) {
    periodWhere.periodStart = { gte: new Date(GC_CP_MIN_START_DATE) };
  }
  const periods = await prisma.gcAdvisorPeriodData.findMany({
    where: periodWhere,
    select: { period: true, periodStart: true },
    distinct: ['period'],
    orderBy: { periodStart: 'asc' },
  });

  // Get distinct billing frequencies
  const billingFreqs = await prisma.gcAdvisorMapping.findMany({
    where: { isExcluded: false, billingFrequency: { not: null } },
    select: { billingFrequency: true },
    distinct: ['billingFrequency'],
  });

  if (isCapitalPartner(permissions)) {
    // Build advisorsByAccount for CP (anonymous names)
    const advisorsByAccount: Record<string, string[]> = {};
    for (const [account, advisorList] of anonAccountsWithMultiple) {
      advisorsByAccount[account] = advisorList.sort((a, b) => a.localeCompare(b));
    }

    return {
      accountNames: anonAccountsWithMultiple.map(([name]) => name),
      advisorNames: advisors.map(a => a.anonymousAdvisorId).sort((a, b) => a.localeCompare(b)),
      advisorsByAccount,
      periods: periods.map(p => p.period),
      billingFrequencies: billingFreqs
        .map(b => b.billingFrequency)
        .filter(Boolean) as string[],
    };
  }

  // Build advisorsByAccount for admin (real names)
  const advisorsByAccount: Record<string, string[]> = {};
  for (const [account, advisorList] of accountsWithMultiple) {
    advisorsByAccount[account] = advisorList.sort((a, b) => a.localeCompare(b));
  }

  return {
    accountNames: accountsWithMultiple.map(([name]) => name),
    advisorNames: advisors.map(a => a.advisorNormalizedName).sort((a, b) => a.localeCompare(b)),
    advisorsByAccount,
    periods: periods.map(p => p.period),
    billingFrequencies: billingFreqs
      .map(b => b.billingFrequency)
      .filter(Boolean) as string[],
  };
}

// ============================================================
// QUERY: Sync Status (for data freshness indicator)
// ============================================================

export async function getGcSyncStatus(): Promise<{
  lastSync: string | null;
  lastSyncType: string | null;
  lastSyncStatus: string | null;
  totalRecords: number;
}> {
  const lastSync = await prisma.gcSyncLog.findFirst({
    where: { status: 'completed' },
    orderBy: { completedAt: 'desc' },
  });

  const totalRecords = await prisma.gcAdvisorPeriodData.count();

  return {
    lastSync: lastSync?.completedAt?.toISOString() ?? null,
    lastSyncType: lastSync?.syncType ?? null,
    lastSyncStatus: lastSync?.status ?? null,
    totalRecords,
  };
}

// ============================================================
// HELPER: Excluded advisor names
// ============================================================

async function getExcludedAdvisorNames(): Promise<string[]> {
  const excluded = await prisma.gcAdvisorMapping.findMany({
    where: { isExcluded: true },
    select: { advisorNormalizedName: true },
  });
  return excluded.map(e => e.advisorNormalizedName);
}
