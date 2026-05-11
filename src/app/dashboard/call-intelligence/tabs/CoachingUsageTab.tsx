'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, Title, Text, Metric } from '@tremor/react';
import { RefreshCw } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { CallDetailModal, type CallDetailRowSummary } from '@/components/call-intelligence/CallDetailModal';

type AllowedRange = '7d' | '30d' | '90d' | 'all';
type AllowedSortField = 'call_date' | 'sga_name' | 'sgm_name';
type AllowedSortDir = 'asc' | 'desc';
type TriState = 'any' | 'yes' | 'no';
type RepRoleFilter = 'any' | 'SGA' | 'SGM';

/** Multi-token case-insensitive substring match. "Bre McDan" matches
 *  "Brennan McDaniel" because every space-separated token appears in the
 *  target. Empty query → match-all. */
function fuzzyMatches(target: string | null | undefined, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const t = (target ?? '').toLowerCase();
  for (const token of q.split(/\s+/)) {
    if (token && !t.includes(token)) return false;
  }
  return true;
}

function triMatches(value: boolean, filter: TriState): boolean {
  if (filter === 'any') return true;
  return filter === 'yes' ? value : !value;
}

// Hardcoded OPPORTUNITY stage list (StageName values from SFDC Recruiting opps).
// Lead-stage labels (New / Contacted / MQL) are intentionally excluded — the
// stage column shows opportunity stage only, and unlinked / lead-only rows
// have a null currentStage that no stage filter can match.
const STAGE_OPTIONS: readonly string[] = [
  'Discovery',
  'Sales Process',
  'Negotiating',
  'On Hold',
  'Signed',
  'Joined',
  'Closed Lost',
];

interface CoachingUsageDetailRow {
  callNoteId: string;
  callDate: string;
  // Resolved person on the call. Cascade: SFDC who_id → unique-email match
  // → first external email (with extras in tooltip) → "Unknown".
  advisorName: string | null;
  advisorEmail: string | null;
  advisorEmailExtras: string[];
  // True iff the advisor was definitively linked to an SFDC Lead/Contact.
  // Funnel-status filters require this when active.
  linkedToSfdc: boolean;
  leadUrl: string | null;
  opportunityUrl: string | null;
  // Funnel status (vw_funnel_master). Defaults to false / null when unlinked.
  didSql: boolean;
  didSqo: boolean;
  /** Current OPPORTUNITY StageName. null when no opp exists or unlinked. */
  currentStage: string | null;
  closedLost: boolean;
  /** call_notes.rep_id — used for distinct active-users-in-range count. */
  repId: string | null;
  sgaName: string | null;
  /** reps.role for the call's rep — 'SGA' | 'SGM' | 'manager' | 'admin' | null. */
  repRole: string | null;
  sgmName: string | null;
  source: 'granola' | 'kixie';
  pushedToSfdc: boolean;
  hasAiFeedback: boolean;
  hasManagerEditEval: boolean;
}
interface CoachingUsageResponse {
  activeCoachingUsers: number;
  drillDown: CoachingUsageDetailRow[];
  range: AllowedRange;
  generated_at: string;
}

function formatPct(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(1)}%`;
}
function formatTimestamp(ts: string | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString();
}
const RANGE_LABELS: Record<AllowedRange, string> = {
  '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days', 'all': 'All time',
};

// Inline tri-state segmented control for the SQL'd / SQO'd / Closed Lost / Pushed filters.
function TriStateGroup(props: {
  label: string;
  value: TriState;
  onChange: (next: TriState) => void;
}) {
  const opts: Array<{ key: TriState; label: string }> = [
    { key: 'any', label: 'Any' },
    { key: 'yes', label: 'Yes' },
    { key: 'no', label: 'No' },
  ];
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-gray-600 dark:text-gray-300 whitespace-nowrap">{props.label}:</span>
      <div className="inline-flex border border-gray-300 dark:border-gray-600 rounded-md overflow-hidden">
        {opts.map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => props.onChange(o.key)}
            className={
              `px-2 py-0.5 text-xs transition-colors `
              + (props.value === o.key
                ? 'bg-blue-600 text-white'
                : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700')
            }
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function CoachingUsageClient() {
  // Range is the only server-side input. Everything else is client-side.
  const [range, setRange] = useState<AllowedRange>('7d');
  // Drill-down sort — client-side. Filter changes don't refetch.
  const [sortBy, setSortBy] = useState<AllowedSortField>('call_date');
  const [sortDir, setSortDir] = useState<AllowedSortDir>('desc');
  // Global filters — apply to KPIs AND drill-down identically.
  const [filterSql, setFilterSql] = useState<TriState>('any');
  const [filterSqo, setFilterSqo] = useState<TriState>('any');
  const [filterClosedLost, setFilterClosedLost] = useState<TriState>('any');
  const [filterStages, setFilterStages] = useState<string[]>([]);
  const [filterPushed, setFilterPushed] = useState<TriState>('any');
  const [filterRepRole, setFilterRepRole] = useState<RepRoleFilter>('any');
  const [repNameSearch, setRepNameSearch] = useState('');
  const [advisorNameSearch, setAdvisorNameSearch] = useState('');

  const [data, setData] = useState<CoachingUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [cacheBuster, setCacheBuster] = useState(0);
  const [selectedRow, setSelectedRow] = useState<CallDetailRowSummary | null>(null);
  const [copiedNoteId, setCopiedNoteId] = useState<string | null>(null);

  async function copyNoteId(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(id);
      setCopiedNoteId(id);
      setTimeout(() => setCopiedNoteId((curr) => (curr === id ? null : curr)), 1200);
    } catch {
      // Older browsers / non-secure contexts — fall back to a hidden textarea.
      const ta = document.createElement('textarea');
      ta.value = id;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* noop */ }
      document.body.removeChild(ta);
      setCopiedNoteId(id);
      setTimeout(() => setCopiedNoteId((curr) => (curr === id ? null : curr)), 1200);
    }
  }

  // Fetch is range-only — no filter changes trigger a refetch.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setFetchError(null);
      try {
        const params = new URLSearchParams({ range });
        const res = await fetch(`/api/admin/coaching-usage?${params.toString()}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Request failed (${res.status})`);
        }
        const json = (await res.json()) as CoachingUsageResponse;
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setFetchError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [range, cacheBuster]);

  function toggleStage(stage: string) {
    setFilterStages((prev) =>
      prev.includes(stage) ? prev.filter((s) => s !== stage) : [...prev, stage],
    );
  }
  function clearAllFilters() {
    setFilterSql('any');
    setFilterSqo('any');
    setFilterClosedLost('any');
    setFilterStages([]);
    setFilterPushed('any');
    setFilterRepRole('any');
    setRepNameSearch('');
    setAdvisorNameSearch('');
  }
  const hasActiveFilters =
    filterSql !== 'any'
    || filterSqo !== 'any'
    || filterClosedLost !== 'any'
    || filterStages.length > 0
    || filterPushed !== 'any'
    || filterRepRole !== 'any'
    || repNameSearch.trim() !== ''
    || advisorNameSearch.trim() !== '';

  // ─── Filter pass ──────────────────────────────────────────────────────────
  // Applied to BOTH the KPI roll-ups and the drill-down so headline numbers
  // and the modal universe always match.
  //
  // Linkage rule: when any FUNNEL-STATUS filter is active (sql/sqo/closedLost/
  // stages), unlinked rows are dropped — we can only definitively know an
  // advisor's status when we resolved them to SFDC. The "pushed" filter is
  // per-call (sfdc_write_log on the call_note itself), NOT per-advisor, so it
  // does NOT require SFDC linkage.
  const filteredRows = useMemo(() => {
    const rows = data?.drillDown ?? [];
    const stageSet = new Set(filterStages.map((s) => s.toLowerCase()));
    const anyFunnelFilterActive =
      filterSql !== 'any'
      || filterSqo !== 'any'
      || filterClosedLost !== 'any'
      || stageSet.size > 0;
    return rows.filter((r) => {
      if (anyFunnelFilterActive && !r.linkedToSfdc) return false;
      if (!triMatches(r.didSql, filterSql)) return false;
      if (!triMatches(r.didSqo, filterSqo)) return false;
      if (!triMatches(r.closedLost, filterClosedLost)) return false;
      if (stageSet.size > 0) {
        const stage = (r.currentStage ?? '').toLowerCase();
        if (!stageSet.has(stage)) return false;
      }
      if (!triMatches(r.pushedToSfdc, filterPushed)) return false;
      if (filterRepRole !== 'any' && r.repRole !== filterRepRole) return false;
      if (!fuzzyMatches(r.sgaName, repNameSearch)) return false;
      // For advisor: search across the resolved name + the email fallback so
      // "acme.com" or "Carl" both work.
      const advisorTarget = `${r.advisorName ?? ''} ${r.advisorEmail ?? ''}`;
      if (!fuzzyMatches(advisorTarget, advisorNameSearch)) return false;
      return true;
    });
  }, [data, filterSql, filterSqo, filterClosedLost, filterStages, filterPushed, filterRepRole, repNameSearch, advisorNameSearch]);

  // KPIs derive entirely from the filtered set — so selecting "Perry Kalmetta
  // last 7 days" recomputes his pushed-to-SFDC rate instantly.
  const kpis = useMemo(() => {
    const total = filteredRows.length;
    const distinctReps = new Set<string>();
    let pushed = 0, aiFb = 0, mgrEdit = 0;
    for (const r of filteredRows) {
      if (r.repId) distinctReps.add(r.repId);
      if (r.pushedToSfdc) pushed++;
      if (r.hasAiFeedback) aiFb++;
      if (r.hasManagerEditEval) mgrEdit++;
    }
    const ratio = (n: number) => (total === 0 ? 0 : n / total);
    return {
      activeUsersInRange: distinctReps.size,
      totalAdvisorFacingCalls: total,
      pctPushedToSfdc: ratio(pushed),
      pctWithAiFeedback: ratio(aiFb),
      pctWithManagerEditEval: ratio(mgrEdit),
    };
  }, [filteredRows]);

  // Sort the filtered set for the drill-down render.
  const visibleDrillDown = useMemo(() => {
    const arr = [...filteredRows];
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      const av = sortBy === 'call_date' ? a.callDate
        : sortBy === 'sga_name' ? (a.sgaName ?? '')
        : (a.sgmName ?? '');
      const bv = sortBy === 'call_date' ? b.callDate
        : sortBy === 'sga_name' ? (b.sgaName ?? '')
        : (b.sgmName ?? '');
      // Empty-string sorts last regardless of direction (NULLS LAST behavior).
      if (av === '' && bv !== '') return 1;
      if (bv === '' && av !== '') return -1;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return arr;
  }, [filteredRows, sortBy, sortDir]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setFetchError(null);
    try {
      const res = await fetch('/api/admin/refresh-cache', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Refresh failed (${res.status})`);
      }
      setCacheBuster(n => n + 1);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to refresh cache');
    } finally {
      setRefreshing(false);
    }
  };

  if (loading && !data) {
    return (
      <Card className="dark:bg-gray-800 dark:border-gray-700">
        <LoadingSpinner />
        <Text className="text-center text-gray-500 dark:text-gray-400 pb-4">Loading coaching usage…</Text>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <select
          value={range}
          onChange={(e) => setRange(e.target.value as AllowedRange)}
          className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg
                     bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
                     focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
        >
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
          <option value="all">All time</option>
        </select>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg
                     bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700
                     disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {fetchError && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
          {fetchError}
        </div>
      )}

      {/* Global filters — apply to BOTH the KPIs and the drill-down. */}
      <Card className="dark:bg-gray-800 dark:border-gray-700">
        <div className="flex items-center justify-between gap-3 mb-2">
          <Title className="dark:text-white">Filters</Title>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearAllFilters}
              className="px-2 py-0.5 text-xs underline text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200"
            >
              Clear all
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-1.5">
            <span className="text-gray-600 dark:text-gray-300 whitespace-nowrap">Rep name:</span>
            <input
              type="search"
              value={repNameSearch}
              onChange={(e) => setRepNameSearch(e.target.value)}
              placeholder="e.g. Bre McDaniel"
              className="px-2 py-1 w-44 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-gray-600 dark:text-gray-300 whitespace-nowrap">Advisor name:</span>
            <input
              type="search"
              value={advisorNameSearch}
              onChange={(e) => setAdvisorNameSearch(e.target.value)}
              placeholder="e.g. Aaron Dym"
              className="px-2 py-1 w-44 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </label>
          <TriStateGroup label="SQL'd"          value={filterSql}        onChange={setFilterSql} />
          <TriStateGroup label="SQO'd"          value={filterSqo}        onChange={setFilterSqo} />
          <TriStateGroup label="Closed Lost"    value={filterClosedLost} onChange={setFilterClosedLost} />
          <TriStateGroup label="Pushed to SFDC" value={filterPushed}     onChange={setFilterPushed} />
          <div className="flex items-center gap-1.5">
            <span className="text-gray-600 dark:text-gray-300 whitespace-nowrap">Rep role:</span>
            <div className="inline-flex border border-gray-300 dark:border-gray-600 rounded-md overflow-hidden">
              {(['any','SGA','SGM'] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setFilterRepRole(opt)}
                  className={
                    'px-2 py-0.5 text-xs transition-colors '
                    + (filterRepRole === opt
                      ? 'bg-blue-600 text-white'
                      : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700')
                  }
                >
                  {opt === 'any' ? 'Any' : opt}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 mt-2 text-xs">
          <span className="text-gray-600 dark:text-gray-300 whitespace-nowrap">Stage:</span>
          {STAGE_OPTIONS.map((stage) => {
            const active = filterStages.includes(stage);
            return (
              <button
                key={stage}
                type="button"
                onClick={() => toggleStage(stage)}
                className={
                  `px-2 py-0.5 rounded-full border transition-colors `
                  + (active
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700')
                }
              >
                {stage}
              </button>
            );
          })}
          {filterStages.length === 0 && (
            <span className="text-gray-400 dark:text-gray-500 italic ml-1">(any)</span>
          )}
        </div>
      </Card>

      {/* KPIs — derived live from the filtered set above. */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card className="p-4 dark:bg-gray-800 dark:border-gray-700">
          <Text className="dark:text-gray-300">Active coaching users</Text>
          <Metric className="text-2xl font-bold dark:text-white">
            {loading ? '—' : data?.activeCoachingUsers ?? 0}
          </Metric>
          <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">Census · all-time</Text>
        </Card>
        <Card className="p-4 dark:bg-gray-800 dark:border-gray-700">
          <Text className="dark:text-gray-300">Active users in range</Text>
          <Metric className="text-2xl font-bold dark:text-white">
            {loading ? '—' : kpis.activeUsersInRange}
          </Metric>
          <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">Distinct reps · {RANGE_LABELS[range]}{hasActiveFilters ? ' · filtered' : ''}</Text>
        </Card>
        <Card className="p-4 dark:bg-gray-800 dark:border-gray-700">
          <Text className="dark:text-gray-300">Advisor-facing calls</Text>
          <Metric className="text-2xl font-bold dark:text-white">
            {loading ? '—' : kpis.totalAdvisorFacingCalls}
          </Metric>
          <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">{RANGE_LABELS[range]}{hasActiveFilters ? ' · filtered' : ''}</Text>
        </Card>
        <Card className="p-4 dark:bg-gray-800 dark:border-gray-700">
          <Text className="dark:text-gray-300">% pushed to SFDC</Text>
          <Metric className="text-2xl font-bold dark:text-white">
            {loading ? '—' : formatPct(kpis.pctPushedToSfdc)}
          </Metric>
          <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">{RANGE_LABELS[range]}{hasActiveFilters ? ' · filtered' : ''}</Text>
        </Card>
        <Card className="p-4 dark:bg-gray-800 dark:border-gray-700">
          <Text className="dark:text-gray-300">% with AI Feedback</Text>
          <Metric className="text-2xl font-bold dark:text-white">
            {loading ? '—' : formatPct(kpis.pctWithAiFeedback)}
          </Metric>
          <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">{RANGE_LABELS[range]}{hasActiveFilters ? ' · filtered' : ''}</Text>
        </Card>
        <Card className="p-4 dark:bg-gray-800 dark:border-gray-700">
          <Text className="dark:text-gray-300">% with manager Edit Eval</Text>
          <Metric className="text-2xl font-bold dark:text-white">
            {loading ? '—' : formatPct(kpis.pctWithManagerEditEval)}
          </Metric>
          <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">{RANGE_LABELS[range]}{hasActiveFilters ? ' · filtered' : ''}</Text>
        </Card>
      </div>

      <Card className="dark:bg-gray-800 dark:border-gray-700">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <Title className="dark:text-white">Call drill-down</Title>
          <select
            value={`${sortBy}:${sortDir}`}
            onChange={(e) => {
              const [f, d] = e.target.value.split(':') as [AllowedSortField, AllowedSortDir];
              setSortBy(f); setSortDir(d);
            }}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg
                       bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100
                       focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          >
            <option value="call_date:desc">Call date (newest first)</option>
            <option value="call_date:asc">Call date (oldest first)</option>
            <option value="sga_name:asc">Rep name (A–Z)</option>
            <option value="sga_name:desc">Rep name (Z–A)</option>
            <option value="sgm_name:asc">Manager name (A–Z)</option>
            <option value="sgm_name:desc">Manager name (Z–A)</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-gray-600 dark:text-gray-300">
                <th className="py-2 px-2">Call date</th>
                <th className="py-2 px-2">Advisor</th>
                <th className="py-2 px-2">Rep</th>
                <th className="py-2 px-2">Manager</th>
                <th className="py-2 px-2">Source</th>
                <th className="py-2 px-2">SQL</th>
                <th className="py-2 px-2">SQO</th>
                <th className="py-2 px-2">Opp Stage</th>
                <th className="py-2 px-2">Closed Lost</th>
                <th className="py-2 px-2">SFDC</th>
                <th className="py-2 px-2">AI FB</th>
                <th className="py-2 px-2">Edit Eval</th>
                <th className="py-2 px-2">Note ID</th>
              </tr>
            </thead>
            <tbody>
              {visibleDrillDown.map(row => {
                const extras = row.advisorEmailExtras ?? [];
                const tooltip = extras.length > 0 ? `Other invitees:\n${extras.join('\n')}` : undefined;
                const advisorDisplay = row.advisorName ?? row.advisorEmail ?? 'Unknown';
                const role = row.repRole;
                const roleClass =
                  role === 'SGA' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200'
                  : role === 'SGM' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-200'
                  : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300';
                return (
                  <tr
                    key={row.callNoteId}
                    onClick={() => setSelectedRow({
                      callNoteId: row.callNoteId,
                      callDate: row.callDate,
                      advisorName: row.advisorName,
                      advisorEmail: row.advisorEmail,
                      sgaName: row.sgaName,
                      sgmName: row.sgmName,
                      source: row.source,
                      didSql: row.didSql,
                      didSqo: row.didSqo,
                      currentStage: row.currentStage,
                      closedLost: row.closedLost,
                      pushedToSfdc: row.pushedToSfdc,
                      hasAiFeedback: row.hasAiFeedback,
                      hasManagerEditEval: row.hasManagerEditEval,
                      leadUrl: row.leadUrl,
                      opportunityUrl: row.opportunityUrl,
                    })}
                    className="border-b border-gray-100 dark:border-gray-700/50 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors"
                  >
                    <td className="py-2 px-2 dark:text-gray-200">{formatTimestamp(row.callDate)}</td>
                    <td
                      className={`py-2 px-2 dark:text-gray-200${tooltip ? ' underline decoration-dotted' : ''}`}
                      title={tooltip}
                    >
                      {advisorDisplay}
                    </td>
                    <td className="py-2 px-2 dark:text-gray-200">
                      <span>{row.sgaName ?? '—'}</span>
                      {role && (
                        <span className={`ml-1.5 px-1.5 py-0.5 text-xs rounded-full ${roleClass}`}>
                          {role}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-2 dark:text-gray-200">{row.sgmName ?? '—'}</td>
                    <td className="py-2 px-2 dark:text-gray-200">{row.source}</td>
                    <td className="py-2 px-2 dark:text-gray-200">{row.didSql ? '✓' : '—'}</td>
                    <td className="py-2 px-2 dark:text-gray-200">{row.didSqo ? '✓' : '—'}</td>
                    <td className="py-2 px-2 dark:text-gray-200">{row.currentStage ?? '—'}</td>
                    <td className="py-2 px-2 dark:text-gray-200">{row.closedLost ? '✓' : '—'}</td>
                    <td className="py-2 px-2 dark:text-gray-200">{row.pushedToSfdc ? '✓' : '—'}</td>
                    <td className="py-2 px-2 dark:text-gray-200">{row.hasAiFeedback ? '✓' : '—'}</td>
                    <td className="py-2 px-2 dark:text-gray-200">{row.hasManagerEditEval ? '✓' : '—'}</td>
                    <td className="py-2 px-2">
                      <button
                        type="button"
                        onClick={(e) => copyNoteId(row.callNoteId, e)}
                        title={`Copy ${row.callNoteId}`}
                        className="px-1.5 py-0.5 font-mono text-xs rounded border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-200 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:border-blue-400 transition-colors"
                      >
                        {copiedNoteId === row.callNoteId ? 'Copied!' : `${row.callNoteId.slice(0, 8)}…`}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {data && visibleDrillDown.length === 0 && (
            <Text className="text-center text-gray-500 dark:text-gray-400 py-6">
              {data.drillDown.length === 0
                ? 'No advisor-facing calls in this range.'
                : 'No calls match the current filters.'}
            </Text>
          )}
        </div>
      </Card>

      {data?.generated_at && (
        <Text className="text-xs text-gray-500 dark:text-gray-400 text-right">
          Cached at {formatTimestamp(data.generated_at)}
        </Text>
      )}

      <CallDetailModal row={selectedRow} onClose={() => setSelectedRow(null)} />
    </div>
  );
}
