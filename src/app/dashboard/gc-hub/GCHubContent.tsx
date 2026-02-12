// src/app/dashboard/gc-hub/GCHubContent.tsx

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Title, Text, Card } from '@tremor/react';
import { RefreshCw } from 'lucide-react';
import type { UserPermissions } from '@/types/user';
import type { GcHubTab, GcHubFilterState, GcHubFilterOptions, GcSyncStatus } from '@/types/gc-hub';
import { GC_DEFAULT_DATE_RANGE, getDefaultEndDate } from '@/config/gc-hub-theme';
import { GCHubTabs } from '@/components/gc-hub/GCHubTabs';
import { gcHubApi, type GcPeriodSummary, type GcAdvisorRow } from '@/lib/api-client';
import { formatRelativeTime } from '@/lib/gc-hub/formatters';
import { GCHubScorecards } from '@/components/gc-hub/GCHubScorecards';
import { RevenueChart } from '@/components/gc-hub/RevenueChart';
import { AdvisorCountChart } from '@/components/gc-hub/AdvisorCountChart';
import { RevenuePerAdvisorChart } from '@/components/gc-hub/RevenuePerAdvisorChart';
import { GCHubFilterBar } from '@/components/gc-hub/GCHubFilterBar';
import { GCHubAdvisorTable } from '@/components/gc-hub/GCHubAdvisorTable';
import { GCHubAdvisorModal } from '@/components/gc-hub/GCHubAdvisorModal';
import { GCHubAdminBar } from '@/components/gc-hub/GCHubAdminBar';

export function GCHubContent() {
  const { data: session } = useSession();

  // ── Permissions ──
  const [permissions, setPermissions] = useState<UserPermissions | null>(null);
  useEffect(() => {
    if (session?.user?.email) {
      fetch('/api/auth/permissions')
        .then((res) => res.json())
        .then((data) => setPermissions(data))
        .catch(console.error);
    }
  }, [session?.user?.email]);

  const isAdmin = permissions?.role === 'admin' || permissions?.role === 'revops_admin';
  const isCapitalPartner = permissions?.role === 'capital_partner';

  // ── Tab State ──
  const [activeTab, setActiveTab] = useState<GcHubTab>('overview');

  // ── Filter State ──
  const [filters, setFilters] = useState<GcHubFilterState>({
    startDate: GC_DEFAULT_DATE_RANGE.startDate,
    endDate: getDefaultEndDate(),
    accountNames: [],
    advisorNames: [],
    billingFrequency: '',
    search: '',
  });

  // ── Data State (use exported API types from api-client.ts) ──
  const [summary, setSummary] = useState<GcPeriodSummary[]>([]);
  const [advisors, setAdvisors] = useState<GcAdvisorRow[]>([]);
  const [advisorCount, setAdvisorCount] = useState(0);
  const [isAnonymized, setIsAnonymized] = useState(false);
  const [filterOptions, setFilterOptions] = useState<GcHubFilterOptions | null>(null);
  const [syncStatus, setSyncStatus] = useState<GcSyncStatus | null>(null);

  // ── Loading / Error State ──
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [loadingAdvisors, setLoadingAdvisors] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Selected Advisor (for drill-down modal) ──
  const [selectedAdvisor, setSelectedAdvisor] = useState<string | null>(null);

  // ── Fetch filter options (once) ──
  useEffect(() => {
    if (!permissions) return;
    gcHubApi.getFilterOptions()
      .then((data) => setFilterOptions(data))
      .catch(console.error);
    gcHubApi.getSyncStatus()
      .then((data) => setSyncStatus(data as GcSyncStatus))
      .catch(console.error);
  }, [permissions]);

  // ── Fetch summary data (when filters change) ──
  const fetchSummary = useCallback(async () => {
    if (!permissions) return;
    setLoadingSummary(true);
    setError(null);
    try {
      const data = await gcHubApi.getSummary({
        startDate: filters.startDate,
        endDate: filters.endDate,
        accountNames: filters.accountNames.length > 0 ? filters.accountNames : undefined,
        advisorNames: filters.advisorNames.length > 0 ? filters.advisorNames : undefined,
        billingFrequency: filters.billingFrequency || undefined,
      });
      setSummary(data.summary || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load summary');
    } finally {
      setLoadingSummary(false);
    }
  }, [permissions, filters.startDate, filters.endDate, filters.accountNames, filters.advisorNames, filters.billingFrequency]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  // ── Fetch advisor data (when filters change). Search is debounced 300ms to avoid API call on every keystroke; the table does client-side search filtering, so debouncing avoids flicker. ──
  const fetchAdvisors = useCallback(async (searchValue?: string) => {
    if (!permissions) return;
    const search = searchValue !== undefined ? searchValue : filters.search;
    setLoadingAdvisors(true);
    try {
      const data = await gcHubApi.getAdvisors({
        startDate: filters.startDate,
        endDate: filters.endDate,
        accountNames: filters.accountNames.length > 0 ? filters.accountNames : undefined,
        advisorNames: filters.advisorNames.length > 0 ? filters.advisorNames : undefined,
        billingFrequency: filters.billingFrequency || undefined,
        search: search || undefined,
      });
      setAdvisors(data.records || []);
      setAdvisorCount(data.count || 0);
      setIsAnonymized(data.isAnonymized || false);
    } catch (err) {
      console.error('Failed to load advisors:', err);
    } finally {
      setLoadingAdvisors(false);
    }
  }, [permissions, filters.startDate, filters.endDate, filters.accountNames, filters.advisorNames, filters.billingFrequency]);

  // Run immediately when non-search filters change
  useEffect(() => { fetchAdvisors(filters.search); }, [fetchAdvisors]);

  // Debounce 300ms when search changes (table also filters client-side; this avoids API call on every keystroke and prevents flicker)
  useEffect(() => {
    const t = setTimeout(() => { fetchAdvisors(filters.search); }, 300);
    return () => clearTimeout(t);
  }, [filters.search, fetchAdvisors]);

  // NOTE (optional cleanup): When a non-search filter changes (date, team, etc.), fetchAdvisors gets a new identity, so both the immediate effect and this debounced effect run — resulting in two identical API calls ~300ms apart. It's a wasted request, not a correctness bug. Optional fix: use a ref for fetchAdvisors inside this effect and depend only on filters.search, so the debounce does not re-trigger on fetchAdvisors identity change. Not required for correctness.

  // ── CSV Export ──
  const handleExportCsv = useCallback(() => {
    function escapeCsvCell(value: string | null | undefined): string {
      const s = String(value ?? '');
      if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    }

    const headers = [
      'Advisor',
      'Team',
      'Total Revenue',
      'Total Commissions',
      'Amount Earned',
      'Periods',
    ];

    // Build rows from the current advisors data (already filtered/anonymized by API)
    // Group by advisor for the export
    const grouped: Record<string, typeof advisors> = {};
    for (const r of advisors) {
      if (!grouped[r.advisorName]) grouped[r.advisorName] = [];
      grouped[r.advisorName].push(r);
    }

    const rows = Object.entries(grouped).map(([name, records]) => {
      const totalRev = records.reduce((s, r) => s + (r.grossRevenue ?? 0), 0);
      const totalComm = records.reduce((s, r) => s + (r.commissionsPaid ?? 0), 0);
      const totalEarned = records.reduce((s, r) => s + (r.amountEarned ?? 0), 0);
      return [
        escapeCsvCell(name),
        escapeCsvCell(records[0]?.accountName),
        totalRev.toFixed(2),
        totalComm.toFixed(2),
        totalEarned.toFixed(2),
        String(records.length),
      ].join(',');
    });

    const csv = [headers.join(','), ...rows].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gc-hub-advisors-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [advisors]);

  // ── Loading guard ──
  if (!permissions) {
    return (
      <div className="flex items-center justify-center h-64" role="status" aria-live="polite">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" aria-hidden="true" />
        <span className="sr-only">Loading GC Hub...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* DOM order (do not reorder): Header → Error Banner → FilterBar → AdminBar (admin only) → Tabs → Tab Panels. Phase 7 adds FilterBar; Phase 11 adds AdminBar. */}
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <Title className="dark:text-white">GC Hub</Title>
          <Text className="text-gray-500 dark:text-gray-400">
            {isCapitalPartner
              ? 'Portfolio performance summary'
              : 'Advisor revenue, commissions & portfolio analytics'}
          </Text>
        </div>
        {syncStatus && (
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Updated {formatRelativeTime(syncStatus.lastSync)}</span>
          </div>
        )}
      </div>

      {/* ── Error Banner ── */}
      {error && (
        <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4">
          <Text className="text-red-700 dark:text-red-300">{error}</Text>
        </div>
      )}

      {/* ── FilterBar ── */}
      <GCHubFilterBar
        filters={filters}
        onFilterChange={setFilters}
        filterOptions={filterOptions}
        isAdmin={isAdmin}
        isCapitalPartner={isCapitalPartner}
        isLoading={loadingSummary}
      />

      {/* ── AdminBar (admin only) ── */}
      {isAdmin && (
        <GCHubAdminBar
          syncStatus={syncStatus}
          onSyncComplete={() => {
            // Refresh sync status and data
            gcHubApi.getSyncStatus().then((s) => setSyncStatus(s as GcSyncStatus)).catch(console.error);
            fetchSummary();
            fetchAdvisors();
          }}
        />
      )}

      {/* ── Tabs ── */}
      <GCHubTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        isCapitalPartner={isCapitalPartner}
      />

      {/* ── Tab Panels ── */}
      {activeTab === 'overview' && (
        <div
          role="tabpanel"
          id="gc-hub-tabpanel-overview"
          aria-labelledby="gc-hub-tab-overview"
          className="space-y-6"
        >
          {/* KPI Scorecards */}
          <GCHubScorecards summary={summary} isLoading={loadingSummary} />

          {/* Revenue + Amount Earned Chart */}
          <RevenueChart data={summary} isLoading={loadingSummary} />

          {/* Advisor Count + Revenue Per Advisor Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <AdvisorCountChart data={summary} isLoading={loadingSummary} />
            <RevenuePerAdvisorChart data={summary} isLoading={loadingSummary} />
          </div>
        </div>
      )}

      {activeTab === 'advisor-detail' && (
        <div
          role="tabpanel"
          id="gc-hub-tabpanel-advisor-detail"
          aria-labelledby="gc-hub-tab-advisor-detail"
          className="space-y-6"
        >
          {/* Advisor Table */}
          <GCHubAdvisorTable
            records={advisors}
            isLoading={loadingAdvisors}
            isAnonymized={isAnonymized}
            isAdmin={isAdmin}
            isCapitalPartner={isCapitalPartner}
            search={filters.search}
            onSearchChange={(s) => setFilters((f) => ({ ...f, search: s }))}
            onAdvisorClick={(name) => setSelectedAdvisor(name)}
            onExportCsv={handleExportCsv}
          />
        </div>
      )}

      {/* Advisor Detail Modal (admin + capital partner) */}
      {selectedAdvisor && (isAdmin || isCapitalPartner) && (
        <GCHubAdvisorModal
          advisorName={selectedAdvisor}
          onClose={() => setSelectedAdvisor(null)}
        />
      )}
    </div>
  );
}
