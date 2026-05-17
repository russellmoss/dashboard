'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@tremor/react';
import { Check, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import type { EvaluationQueueRow, InsightsPod } from '@/types/call-intelligence';

const ALL_STAGES = [
  { value: 'Qualifying', label: 'Qualifying' },
  { value: 'Discovery', label: 'Discovery' },
  { value: 'Sales Process', label: 'Sales Process' },
  { value: 'Negotiating', label: 'Negotiating' },
  { value: 'Signed', label: 'Signed' },
  { value: 'On Hold', label: 'On Hold' },
  { value: 'Joined', label: 'Joined' },
  { value: 'Closed Lost', label: 'Closed Lost' },
  { value: 'Planned Nurture', label: 'Planned Nurture' },
];

type HistoryFilter = 'pending' | 'revealed' | 'all';
type RepRoleFilter = 'any' | 'SGA' | 'SGM';
type SortDir = 'asc' | 'desc';
type SortField =
  | 'date'
  | 'time'
  | 'rep'
  | 'advisor'
  | 'reviewer'
  | 'status'
  | 'edit_version'
  | 'scheduled_reveal'
  | 'call_id';

interface Props {
  role: string;
  /** 'mine' for SGM/SGA (coachee view); 'queue' for manager/admin (reviewer view). */
  mode: 'mine' | 'queue';
}

interface QueueResponse {
  rows: EvaluationQueueRow[];
  generated_at: string;
  historyFilter?: HistoryFilter;
  notice?: string;
}

const FILTER_LABELS: Record<HistoryFilter, string> = {
  pending: 'Pending',
  revealed: 'Revealed',
  all: 'All',
};

function formatDate(ts: string | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString();
}

function formatDateOnly(ts: string | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleDateString();
}

function formatTimeOnly(ts: string | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Multi-token case-insensitive substring match. "Bre McDan" matches
 *  "Brennan McDaniel" because every space-separated token appears in the
 *  target. Empty query → match-all. Mirrors CoachingUsage's helper. */
function fuzzyMatches(target: string | null | undefined, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const t = (target ?? '').toLowerCase();
  for (const token of q.split(/\s+/)) {
    if (token && !t.includes(token)) return false;
  }
  return true;
}

function StatusBadge({ status }: { status: EvaluationQueueRow['status'] }) {
  const cls = status === 'pending_review'
    ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
    : status === 'revealed'
    ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200'
    : 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200';
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{status}</span>;
}

function SortHeader({
  label,
  field,
  active,
  dir,
  onClick,
}: {
  label: string;
  field: SortField;
  active: boolean;
  dir: SortDir;
  onClick: (field: SortField) => void;
}) {
  return (
    <th
      className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider cursor-pointer select-none hover:bg-gray-100 dark:hover:bg-gray-800"
      onClick={() => onClick(field)}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active ? (
          dir === 'asc' ? (
            <ChevronUp className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )
        ) : (
          <ChevronsUpDown className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600" />
        )}
      </span>
    </th>
  );
}

export default function QueueTab({ role, mode }: Props) {
  const router = useRouter();
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('pending');
  const [rows, setRows] = useState<EvaluationQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Sort state — defaults to date desc (newest first), matches existing server-side ORDER BY.
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Client-side filters
  const [repNameSearch, setRepNameSearch] = useState('');
  const [advisorNameSearch, setAdvisorNameSearch] = useState('');
  const [repRoleFilter, setRepRoleFilter] = useState<RepRoleFilter>('any');
  const [stageFilter, setStageFilter] = useState<string[]>(ALL_STAGES.map((s) => s.value));
  const [stageDropdownOpen, setStageDropdownOpen] = useState(false);
  const [podFilter, setPodFilter] = useState<string[]>([]);
  const [pods, setPods] = useState<InsightsPod[]>([]);
  const [podDropdownOpen, setPodDropdownOpen] = useState(false);
  const stageDropdownRef = useRef<HTMLDivElement>(null);
  const podDropdownRef = useRef<HTMLDivElement>(null);

  // Admin-or-manager-only role filter visibility — SGM/SGA only see their own evals.
  const isAdminOrManager = role === 'admin' || role === 'revops_admin' || role === 'manager';

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/call-intelligence/queue?status=${historyFilter}`, { cache: 'no-store' });
        const json: QueueResponse = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError((json as { error?: string }).error ?? `HTTP ${res.status}`);
          setRows([]);
        } else {
          setRows(json.rows ?? []);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load queue');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [historyFilter]);

  useEffect(() => {
    if (!isAdminOrManager) return;
    fetch('/api/call-intelligence/insights/pods')
      .then((res) => res.json())
      .then((data) => setPods(data.pods ?? []))
      .catch(() => {});
  }, [isAdminOrManager]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (stageDropdownRef.current && !stageDropdownRef.current.contains(e.target as Node)) {
        setStageDropdownOpen(false);
      }
      if (podDropdownRef.current && !podDropdownRef.current.contains(e.target as Node)) {
        setPodDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleSort(field: SortField) {
    if (field === sortField) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir(field === 'date' || field === 'time' || field === 'scheduled_reveal' ? 'desc' : 'asc');
    }
  }

  function clearAllFilters() {
    setRepNameSearch('');
    setAdvisorNameSearch('');
    setRepRoleFilter('any');
    setStageFilter(ALL_STAGES.map((s) => s.value));
    setPodFilter([]);
  }
  const hasActiveFilters =
    repNameSearch.trim() !== '' ||
    advisorNameSearch.trim() !== '' ||
    repRoleFilter !== 'any' ||
    stageFilter.length < ALL_STAGES.length ||
    podFilter.length > 0;

  // ─── Filter pass ─────────────────────────────────────────────────────────
  const stageSummary =
    stageFilter.length === ALL_STAGES.length
      ? 'All Stages'
      : stageFilter.length === 0
        ? 'No Stages'
        : `${stageFilter.length} Stages`;

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (!fuzzyMatches(r.rep_full_name, repNameSearch)) return false;
      if (!fuzzyMatches(r.advisor_name, advisorNameSearch)) return false;
      if (repRoleFilter !== 'any' && r.rep_role !== repRoleFilter) return false;
      if (stageFilter.length < ALL_STAGES.length) {
        if (r.opp_stage && !stageFilter.includes(r.opp_stage)) return false;
      }
      if (podFilter.length > 0) {
        if (!r.pod_id || !podFilter.includes(r.pod_id)) return false;
      }
      return true;
    });
  }, [rows, repNameSearch, advisorNameSearch, repRoleFilter, stageFilter, podFilter]);

  // ─── Sort pass ───────────────────────────────────────────────────────────
  const visibleRows = useMemo(() => {
    const arr = [...filteredRows];
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      let av: string | number = '';
      let bv: string | number = '';
      switch (sortField) {
        case 'date':
        case 'time':
          av = a.call_started_at ?? '';
          bv = b.call_started_at ?? '';
          break;
        case 'rep':
          av = (a.rep_full_name ?? '').toLowerCase();
          bv = (b.rep_full_name ?? '').toLowerCase();
          break;
        case 'advisor':
          av = (a.advisor_name ?? '').toLowerCase();
          bv = (b.advisor_name ?? '').toLowerCase();
          break;
        case 'reviewer':
          av = (a.assigned_manager_full_name ?? '').toLowerCase();
          bv = (b.assigned_manager_full_name ?? '').toLowerCase();
          break;
        case 'status':
          av = a.status;
          bv = b.status;
          break;
        case 'edit_version':
          av = a.edit_version;
          bv = b.edit_version;
          break;
        case 'scheduled_reveal':
          av = a.scheduled_reveal_at ?? '';
          bv = b.scheduled_reveal_at ?? '';
          break;
        case 'call_id':
          av = a.call_note_id;
          bv = b.call_note_id;
          break;
      }
      // Empty string sorts last regardless of direction (NULLS LAST behavior).
      if (av === '' && bv !== '') return 1;
      if (bv === '' && av !== '') return -1;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return arr;
  }, [filteredRows, sortField, sortDir]);

  return (
    <Card className="dark:bg-gray-800 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {mode === 'mine' ? 'My Evaluations' : 'Review Queue'}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {mode === 'mine'
              ? 'AI evaluations of your calls. Pending entries are awaiting reveal by your reviewer.'
              : 'Evaluations assigned to you for review.'}
          </p>
        </div>
        <div className="inline-flex border border-gray-300 dark:border-gray-600 rounded-md overflow-hidden">
          {(Object.keys(FILTER_LABELS) as HistoryFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setHistoryFilter(f)}
              className={`px-3 py-1 text-xs transition-colors ${
                historyFilter === f
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              {FILTER_LABELS[f]}
            </button>
          ))}
        </div>
      </div>

      {/* Filter bar — global filters mirror CoachingUsage's pattern. */}
      <div className="flex flex-wrap items-end gap-3 mb-4 pb-3 border-b border-gray-200 dark:border-gray-700">
        {/* Stage dropdown multi-select */}
        <div className="flex flex-col">
          <label className="text-xs text-gray-600 dark:text-gray-400 mb-1">Stage</label>
          <div className="relative" ref={stageDropdownRef}>
            <button
              type="button"
              onClick={() => setStageDropdownOpen(!stageDropdownOpen)}
              className="flex items-center gap-1.5 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <span>{stageSummary}</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${stageDropdownOpen ? 'rotate-180' : ''}`} />
            </button>
            {stageDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-20 p-2">
                <div className="flex gap-2 text-xs mb-2 pb-2 border-b border-gray-200 dark:border-gray-700">
                  <button type="button" onClick={() => setStageFilter(ALL_STAGES.map((s) => s.value))} className="text-blue-600 dark:text-blue-400 hover:underline">
                    All
                  </button>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <button type="button" onClick={() => setStageFilter([])} className="text-blue-600 dark:text-blue-400 hover:underline">
                    None
                  </button>
                </div>
                <div className="space-y-0.5 max-h-56 overflow-y-auto">
                  {ALL_STAGES.map((stage) => {
                    const isSelected = stageFilter.includes(stage.value);
                    return (
                      <label
                        key={stage.value}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${
                          isSelected ? 'bg-blue-50 dark:bg-blue-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                        }`}
                      >
                        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                          isSelected ? 'bg-blue-600 border-blue-600' : 'border-gray-300 dark:border-gray-600'
                        }`}>
                          {isSelected && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => setStageFilter((prev) => prev.includes(stage.value) ? prev.filter((s) => s !== stage.value) : [...prev, stage.value])}
                          className="sr-only"
                        />
                        <span className={`text-sm ${isSelected ? 'text-blue-700 dark:text-blue-300 font-medium' : 'text-gray-700 dark:text-gray-300'}`}>
                          {stage.label}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Pod dropdown multi-select */}
        {isAdminOrManager && pods.length > 0 && (
          <div className="flex flex-col">
            <label className="text-xs text-gray-600 dark:text-gray-400 mb-1">Pod</label>
            <div className="relative" ref={podDropdownRef}>
              <button
                type="button"
                onClick={() => setPodDropdownOpen(!podDropdownOpen)}
                className="flex items-center gap-1.5 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                <span>{podFilter.length === 0 ? 'All Pods' : `${podFilter.length} Pod${podFilter.length > 1 ? 's' : ''}`}</span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${podDropdownOpen ? 'rotate-180' : ''}`} />
              </button>
              {podDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 w-56 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-20 p-2">
                  <div className="flex gap-2 text-xs mb-2 pb-2 border-b border-gray-200 dark:border-gray-700">
                    <button type="button" onClick={() => setPodFilter(pods.map((p) => p.id))} className="text-blue-600 dark:text-blue-400 hover:underline">
                      All
                    </button>
                    <span className="text-gray-300 dark:text-gray-600">|</span>
                    <button type="button" onClick={() => setPodFilter([])} className="text-blue-600 dark:text-blue-400 hover:underline">
                      None
                    </button>
                  </div>
                  <div className="space-y-0.5 max-h-56 overflow-y-auto">
                    {pods.map((pod) => {
                      const isSelected = podFilter.includes(pod.id);
                      return (
                        <label
                          key={pod.id}
                          className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${
                            isSelected ? 'bg-blue-50 dark:bg-blue-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                          }`}
                        >
                          <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                            isSelected ? 'bg-blue-600 border-blue-600' : 'border-gray-300 dark:border-gray-600'
                          }`}>
                            {isSelected && <Check className="w-3 h-3 text-white" />}
                          </div>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => setPodFilter((prev) => prev.includes(pod.id) ? prev.filter((id) => id !== pod.id) : [...prev, pod.id])}
                            className="sr-only"
                          />
                          <span className={`text-sm ${isSelected ? 'text-blue-700 dark:text-blue-300 font-medium' : 'text-gray-700 dark:text-gray-300'}`}>
                            {pod.name}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-col">
          <label className="text-xs text-gray-600 dark:text-gray-400 mb-1">Rep name</label>
          <input
            type="text"
            value={repNameSearch}
            onChange={(e) => setRepNameSearch(e.target.value)}
            placeholder="e.g. Bre McDan"
            className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:border-blue-500 w-40"
          />
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-gray-600 dark:text-gray-400 mb-1">Advisor name</label>
          <input
            type="text"
            value={advisorNameSearch}
            onChange={(e) => setAdvisorNameSearch(e.target.value)}
            placeholder="e.g. Holdsworth"
            className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:border-blue-500 w-40"
          />
        </div>
        {isAdminOrManager && (
          <div className="flex flex-col">
            <label className="text-xs text-gray-600 dark:text-gray-400 mb-1">Rep role</label>
            <div className="inline-flex border border-gray-300 dark:border-gray-600 rounded-md overflow-hidden">
              {(['any', 'SGA', 'SGM'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRepRoleFilter(r)}
                  className={`px-2 py-0.5 text-xs transition-colors ${
                    repRoleFilter === r
                      ? 'bg-blue-600 text-white'
                      : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  {r === 'any' ? 'Any' : r}
                </button>
              ))}
            </div>
          </div>
        )}
        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearAllFilters}
            className="px-2 py-1 text-xs text-blue-600 dark:text-blue-300 hover:underline"
          >
            Clear filters
          </button>
        )}
        <div className="ml-auto text-xs text-gray-500 dark:text-gray-400 self-end">
          {visibleRows.length} of {rows.length} shown
        </div>
      </div>

      {loading && (
        <div className="py-12 flex justify-center">
          <LoadingSpinner />
        </div>
      )}

      {!loading && error && (
        <div className="py-8 px-4 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded">
          {error}
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
          {mode === 'mine'
            ? (historyFilter === 'pending' ? 'No pending evaluations.' : 'No evaluations.')
            : (historyFilter === 'pending' ? 'No pending reviews.' : 'No evaluations.')}
        </div>
      )}

      {!loading && !error && rows.length > 0 && visibleRows.length === 0 && (
        <div className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
          No rows match the current filters. <button onClick={clearAllFilters} className="text-blue-600 dark:text-blue-300 hover:underline">Clear filters</button>.
        </div>
      )}

      {!loading && !error && visibleRows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <SortHeader label="Date" field="date" active={sortField === 'date'} dir={sortDir} onClick={handleSort} />
                <SortHeader label="Time" field="time" active={sortField === 'time'} dir={sortDir} onClick={handleSort} />
                <SortHeader label="Rep" field="rep" active={sortField === 'rep'} dir={sortDir} onClick={handleSort} />
                <SortHeader label="Advisor" field="advisor" active={sortField === 'advisor'} dir={sortDir} onClick={handleSort} />
                {mode === 'queue' && (
                  <SortHeader label="Reviewer" field="reviewer" active={sortField === 'reviewer'} dir={sortDir} onClick={handleSort} />
                )}
                <SortHeader label="Status" field="status" active={sortField === 'status'} dir={sortDir} onClick={handleSort} />
                <SortHeader label="Edit ver." field="edit_version" active={sortField === 'edit_version'} dir={sortDir} onClick={handleSort} />
                <SortHeader label="Scheduled reveal" field="scheduled_reveal" active={sortField === 'scheduled_reveal'} dir={sortDir} onClick={handleSort} />
                <SortHeader label="Call ID" field="call_id" active={sortField === 'call_id'} dir={sortDir} onClick={handleSort} />
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {visibleRows.map((r) => {
                const href = `/dashboard/call-intelligence/evaluations/${r.evaluation_id}?returnTab=queue`;
                return (
                  <tr
                    key={r.evaluation_id}
                    role="link"
                    tabIndex={0}
                    onClick={() => router.push(href)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        router.push(href);
                      }
                    }}
                    className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 focus:outline-none focus:bg-gray-100 dark:focus:bg-gray-700"
                  >
                    <td className="px-3 py-2 text-sm text-gray-900 dark:text-gray-100 whitespace-nowrap">{formatDateOnly(r.call_started_at)}</td>
                    <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap">{formatTimeOnly(r.call_started_at)}</td>
                    <td className="px-3 py-2 text-sm text-gray-900 dark:text-gray-100">
                      <span className="inline-flex items-center gap-2">
                        <span>{r.rep_full_name ?? '—'}</span>
                        {r.rep_role && (
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                              r.rep_role === 'SGA'
                                ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-200'
                                : r.rep_role === 'SGM'
                                  ? 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-200'
                                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200'
                            }`}
                          >
                            {r.rep_role}
                          </span>
                        )}
                        {r.rubric_version !== null && (
                          <span
                            className="px-1.5 py-0.5 rounded text-[10px] bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
                            title={`Scored against rubric v${r.rubric_version}`}
                          >
                            Rubric: v{r.rubric_version}
                          </span>
                        )}
                      </span>
                    </td>
                    <td
                      className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300"
                      title={r.call_title ?? undefined}
                    >
                      {r.advisor_name ?? '—'}
                    </td>
                    {mode === 'queue' && (
                      <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">{r.assigned_manager_full_name ?? '—'}</td>
                    )}
                    <td className="px-3 py-2 text-sm"><StatusBadge status={r.status} /></td>
                    <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">{r.edit_version}</td>
                    <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap">{formatDate(r.scheduled_reveal_at)}</td>
                    <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 font-mono" title={r.call_note_id}>
                      {r.call_note_id.slice(0, 8)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
