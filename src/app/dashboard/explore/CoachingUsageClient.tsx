'use client';

import { useEffect, useState } from 'react';
import { Card, Title, Text, Metric } from '@tremor/react';
import { RefreshCw } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { CallDetailModal, type CallDetailRowSummary } from './CallDetailModal';

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

// Hardcoded OPPORTUNITY stage list (StageName values from SFDC Recruiting opps).
// Lead-stage labels (New / Contacted / MQL) are intentionally excluded — the
// stage column shows opportunity stage only, and unlinked / lead-only rows
// have a null currentStage that no stage filter can match (which is correct:
// people we can't definitively link to a SFDC opportunity get filtered out
// when any filter is active).
const STAGE_OPTIONS: readonly string[] = [
  'Discovery',
  'Sales Process',
  'Negotiating',
  'On Hold',
  'Signed',
  'Joined',
  'Closed Lost',
];

interface CoachingUsageKpis {
  activeCoachingUsers: number;       // census, all-time, ignores date range
  activeUsersInRange: number;        // distinct reps with >= 1 call in selected range
  totalAdvisorFacingCalls: number;
  pctPushedToSfdc: number;
  pctWithAiFeedback: number;
  pctWithManagerEditEval: number;
  rawNoteVolume: { granola: number; kixie: number; total: number };
}
interface CoachingUsageTrendRow {
  month: string;
  advisorFacingCalls: number;
  pctPushedToSfdc: number;
  pctWithAiFeedback: number;
  pctWithManagerEditEval: number;
  rawNoteVolume: number;
}
interface CoachingUsageDetailRow {
  callNoteId: string;
  callDate: string;
  // Resolved person on the call. Cascade: SFDC who_id → unique-email match
  // → first external email (with extras in tooltip) → "Unknown".
  advisorName: string | null;
  advisorEmail: string | null;
  advisorEmailExtras: string[];
  // True iff the advisor was definitively linked to an SFDC Lead/Contact.
  // The server filter requires this when any filter is active.
  linkedToSfdc: boolean;
  // Lightning deep-links — null when the advisor wasn't resolved to SFDC, or
  // (for opportunityUrl) when they're lead-only with no opp yet.
  leadUrl: string | null;
  opportunityUrl: string | null;
  // Funnel status (vw_funnel_master). Defaults to false / null when unlinked.
  didSql: boolean;
  didSqo: boolean;
  /** Current OPPORTUNITY StageName. null when no opp exists or unlinked. */
  currentStage: string | null;
  closedLost: boolean;
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
  kpis: CoachingUsageKpis;
  trend: CoachingUsageTrendRow[];
  drillDown: CoachingUsageDetailRow[];
  range: AllowedRange;
  sortBy: AllowedSortField;
  sortDir: AllowedSortDir;
  filters?: {
    sql: TriState;
    sqo: TriState;
    closedLost: TriState;
    stages: string[];
    pushed: TriState;
    repRole: RepRoleFilter;
  };
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
function formatMonthLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}
const RANGE_LABELS: Record<AllowedRange, string> = {
  '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days', 'all': 'All time',
};

// Inline tri-state segmented control for the SQL'd / SQO'd / Closed Lost filters.
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
  const [range, setRange] = useState<AllowedRange>('7d');
  const [sortBy, setSortBy] = useState<AllowedSortField>('call_date');
  const [sortDir, setSortDir] = useState<AllowedSortDir>('desc');
  const [filterSql, setFilterSql] = useState<TriState>('any');
  const [filterSqo, setFilterSqo] = useState<TriState>('any');
  const [filterClosedLost, setFilterClosedLost] = useState<TriState>('any');
  const [filterStages, setFilterStages] = useState<string[]>([]);
  const [filterPushed, setFilterPushed] = useState<TriState>('any');
  const [filterRepRole, setFilterRepRole] = useState<RepRoleFilter>('any');
  // Fuzzy name searches — applied client-side so typing is instant. Filtered
  // before render; never sent to the API (kept out of the URL params to keep
  // the cache key stable).
  const [repNameSearch, setRepNameSearch] = useState('');
  const [advisorNameSearch, setAdvisorNameSearch] = useState('');
  const [data, setData] = useState<CoachingUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [cacheBuster, setCacheBuster] = useState(0);
  // Row selected for the detail modal. null = modal closed.
  const [selectedRow, setSelectedRow] = useState<CallDetailRowSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setFetchError(null);
      try {
        const params = new URLSearchParams({ range, sortBy, sortDir });
        if (filterSql !== 'any') params.set('sql', filterSql);
        if (filterSqo !== 'any') params.set('sqo', filterSqo);
        if (filterClosedLost !== 'any') params.set('closedLost', filterClosedLost);
        if (filterStages.length > 0) params.set('stages', filterStages.join(','));
        if (filterPushed !== 'any') params.set('pushed', filterPushed);
        if (filterRepRole !== 'any') params.set('repRole', filterRepRole);
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
  }, [range, sortBy, sortDir, filterSql, filterSqo, filterClosedLost, filterStages, filterPushed, filterRepRole, cacheBuster]);

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

  // Apply client-side fuzzy filters on top of the server-filtered drill-down.
  // Server already handled role/funnel-status/stage filters; here we narrow
  // by name as the user types — instant feedback, no fetch needed.
  const visibleDrillDown = (data?.drillDown ?? []).filter((row) => {
    if (!fuzzyMatches(row.sgaName, repNameSearch)) return false;
    // For advisor: search across the resolved name + the email fallback so
    // "acme.com" or "Carl" both work.
    const advisorTarget = `${row.advisorName ?? ''} ${row.advisorEmail ?? ''}`;
    if (!fuzzyMatches(advisorTarget, advisorNameSearch)) return false;
    return true;
  });

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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4 dark:bg-gray-800 dark:border-gray-700">
          <Text className="dark:text-gray-300">Active coaching users</Text>
          <Metric className="text-2xl font-bold dark:text-white">
            {loading ? '—' : data?.kpis.activeCoachingUsers ?? 0}
          </Metric>
          <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">Census · all-time</Text>
        </Card>
        <Card className="p-4 dark:bg-gray-800 dark:border-gray-700">
          <Text className="dark:text-gray-300">Active users in range</Text>
          <Metric className="text-2xl font-bold dark:text-white">
            {loading ? '—' : data?.kpis.activeUsersInRange ?? 0}
          </Metric>
          <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">Reps with ≥1 call · {RANGE_LABELS[range]}</Text>
        </Card>
        <Card className="p-4 dark:bg-gray-800 dark:border-gray-700">
          <Text className="dark:text-gray-300">Advisor-facing calls</Text>
          <Metric className="text-2xl font-bold dark:text-white">
            {loading ? '—' : data?.kpis.totalAdvisorFacingCalls ?? 0}
          </Metric>
          <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">{RANGE_LABELS[range]}</Text>
        </Card>
        <Card className="p-4 dark:bg-gray-800 dark:border-gray-700">
          <Text className="dark:text-gray-300">% pushed to SFDC</Text>
          <Metric className="text-2xl font-bold dark:text-white">
            {loading ? '—' : formatPct(data?.kpis.pctPushedToSfdc ?? 0)}
          </Metric>
          <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">{RANGE_LABELS[range]}</Text>
        </Card>
        <Card className="p-4 dark:bg-gray-800 dark:border-gray-700">
          <Text className="dark:text-gray-300">% with AI Feedback</Text>
          <Metric className="text-2xl font-bold dark:text-white">
            {loading ? '—' : formatPct(data?.kpis.pctWithAiFeedback ?? 0)}
          </Metric>
          <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">{RANGE_LABELS[range]}</Text>
        </Card>
        <Card className="p-4 dark:bg-gray-800 dark:border-gray-700">
          <Text className="dark:text-gray-300">% with manager Edit Eval</Text>
          <Metric className="text-2xl font-bold dark:text-white">
            {loading ? '—' : formatPct(data?.kpis.pctWithManagerEditEval ?? 0)}
          </Metric>
          <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">{RANGE_LABELS[range]}</Text>
        </Card>
        <Card className="p-4 dark:bg-gray-800 dark:border-gray-700">
          <Text className="dark:text-gray-300">Raw note volume</Text>
          <Metric className="text-2xl font-bold dark:text-white">
            {loading ? '—' : data?.kpis.rawNoteVolume.total ?? 0}
          </Metric>
          <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {loading ? '—' : `${data?.kpis.rawNoteVolume.granola ?? 0} Granola · ${data?.kpis.rawNoteVolume.kixie ?? 0} Kixie`}
          </Text>
        </Card>
      </div>

      <Card className="dark:bg-gray-800 dark:border-gray-700">
        <Title className="dark:text-white">Monthly trend (rolling 6 months)</Title>
        <Text className="text-xs text-gray-500 dark:text-gray-400 -mt-1">
          Always shows the last 6 calendar months — independent of the date-range selector above.
        </Text>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-gray-600 dark:text-gray-300">
                <th className="py-2 px-2">Month</th>
                <th className="py-2 px-2">Advisor calls</th>
                <th className="py-2 px-2">% SFDC</th>
                <th className="py-2 px-2">% AI FB</th>
                <th className="py-2 px-2">% Edit Eval</th>
                <th className="py-2 px-2">Raw notes</th>
              </tr>
            </thead>
            <tbody>
              {(data?.trend ?? []).map(row => (
                <tr key={row.month} className="border-b border-gray-100 dark:border-gray-700/50">
                  <td className="py-2 px-2 dark:text-gray-200">{formatMonthLabel(row.month)}</td>
                  <td className="py-2 px-2 dark:text-gray-200">{row.advisorFacingCalls}</td>
                  <td className="py-2 px-2 dark:text-gray-200">{formatPct(row.pctPushedToSfdc)}</td>
                  <td className="py-2 px-2 dark:text-gray-200">{formatPct(row.pctWithAiFeedback)}</td>
                  <td className="py-2 px-2 dark:text-gray-200">{formatPct(row.pctWithManagerEditEval)}</td>
                  <td className="py-2 px-2 dark:text-gray-200">{row.rawNoteVolume}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

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

        {/* Fuzzy name searches — applied client-side so typing is instant. */}
        <div className="flex flex-wrap items-center gap-3 mb-2 text-xs">
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
        </div>

        {/* Status filters — apply to drill-down only. KPIs/trend stay unfiltered. */}
        <div className="flex flex-wrap items-center gap-3 mb-2 text-xs">
          <TriStateGroup label="SQL'd"        value={filterSql}        onChange={setFilterSql} />
          <TriStateGroup label="SQO'd"        value={filterSqo}        onChange={setFilterSqo} />
          <TriStateGroup label="Closed Lost"  value={filterClosedLost} onChange={setFilterClosedLost} />
          <TriStateGroup label="Pushed to SFDC" value={filterPushed}   onChange={setFilterPushed} />
          {/* Rep-role segmented (Any / SGA / SGM) — same look as TriStateGroup
              but with role-shaped labels rather than yes/no. */}
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
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearAllFilters}
              className="px-2 py-0.5 text-xs underline text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200"
            >
              Clear filters
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 mb-3 text-xs">
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
              </tr>
            </thead>
            <tbody>
              {visibleDrillDown.map(row => {
                // Advisor cell: name (resolved via SFDC) > first external email with
                // tooltip listing the rest > "Unknown".
                const extras = row.advisorEmailExtras ?? [];
                const tooltip = extras.length > 0 ? `Other invitees:\n${extras.join('\n')}` : undefined;
                const advisorDisplay = row.advisorName ?? row.advisorEmail ?? 'Unknown';
                // Role badge styling: SGA = blue, SGM = purple, other = neutral.
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
