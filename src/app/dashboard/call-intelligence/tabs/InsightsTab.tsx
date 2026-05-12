'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card } from '@tremor/react';
import RepFilterCombobox from '@/components/call-intelligence/RepFilterCombobox';
import InsightsEvalListModal from '@/components/call-intelligence/InsightsEvalListModal';
import InsightsEvalDetailModal from '@/components/call-intelligence/InsightsEvalDetailModal';
import InsightsClusterEvidenceModal from '@/components/call-intelligence/InsightsClusterEvidenceModal';
import { TranscriptModal } from '@/components/call-intelligence/TranscriptModal';
import type {
  DimensionHeatmapResult,
  DimensionHeatmapRowBlock,
  DimensionHeatmapCell,
  KnowledgeGapClusterRow,
  KnowledgeGapClusterEvidence,
  InsightsPod,
  InsightsRep,
  InsightsDateRange,
  InsightsRoleFilter,
  InsightsSourceFilter,
  InsightsTrendMode,
  RepFocusTrendComparison,
  InsightsModalStackLayer,
  EvalListModalPayload,
  EvalDetailDrillPayload,
  TranscriptDrillPayload,
  EvaluationDetail,
} from '@/types/call-intelligence';

interface Props {
  initialFocusRep: string | null;
}

const DATE_RANGES = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
] as const;

const SOURCE_OPTIONS: Array<{ value: InsightsSourceFilter; label: string }> = [
  { value: 'all', label: 'All signals' },
  { value: 'gaps_only', label: 'Knowledge gaps only' },
  { value: 'deferrals_only', label: 'Deferrals only' },
  { value: 'deferrals_kb_missing', label: 'Deferrals → KB missing' },
  { value: 'deferrals_kb_covered', label: 'Deferrals → KB covered' },
];

function cellColor(score: number | null | undefined): string {
  if (!score || isNaN(score)) return 'bg-gray-200 dark:bg-gray-700';
  if (score >= 3) return 'bg-[#175242] text-white';
  if (score >= 2) return 'bg-[#8e7e57] text-white';
  return 'bg-[#c7bca1] text-gray-900';
}

function humanizeKey(key: string): string {
  return key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Compile-time guard: forces the modal-stack dispatcher to cover every variant
 *  of {@link InsightsModalStackLayer}. Adding a new variant without wiring its
 *  render branch fails the build here. (Council C2 intent.) */
function _assertExhaustiveModalLayer(layer: InsightsModalStackLayer): InsightsModalStackLayer['kind'] {
  switch (layer.kind) {
    case 'list':       return 'list';
    case 'cluster':    return 'cluster';
    case 'detail':     return 'detail';
    case 'transcript': return 'transcript';
    default: {
      const _exhaustive: never = layer;
      return _exhaustive;
    }
  }
}
void _assertExhaustiveModalLayer;

/** Human label for a cluster bucket. 'kb_path' buckets render as a ›-separated
 *  Title-case path; 'kb_topic' buckets render as Title-case underscore tags;
 *  'Uncategorized' / 'Uncategorized: <topic>' values pass through verbatim. */
function humanizeBucket(bucket: string, kind: 'kb_path' | 'kb_topic' | 'uncategorized'): string {
  if (bucket === 'Uncategorized' || bucket.startsWith('Uncategorized: ')) return bucket;
  if (kind === 'kb_path') {
    return bucket.split('/').map(seg =>
      seg.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    ).join(' › ');
  }
  return bucket.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Weighted-average aggregation across multiple (role, rubricVersion) blocks.
 *  Combines cells with the same dimensionName as `sum(avg * n) / sum(n)`. */
function aggregateBlocks(blocks: DimensionHeatmapRowBlock[]): DimensionHeatmapRowBlock {
  const byDim = new Map<string, { sum: number; n: number }>();
  // Preserve dimension order from the first block.
  const dimOrder: string[] = [];
  for (const b of blocks) {
    for (const c of b.cells) {
      const prev = byDim.get(c.dimensionName);
      if (!prev) {
        dimOrder.push(c.dimensionName);
        byDim.set(c.dimensionName, { sum: c.avgScore * c.n, n: c.n });
      } else {
        prev.sum += c.avgScore * c.n;
        prev.n += c.n;
      }
    }
  }
  const cells: DimensionHeatmapCell[] = dimOrder.map(name => {
    const agg = byDim.get(name)!;
    return { dimensionName: name, avgScore: agg.n > 0 ? agg.sum / agg.n : 0, n: agg.n };
  });
  return {
    role: blocks[0].role,
    rubricVersion: blocks[0].rubricVersion,
    podLabel: '__AGG__',
    podId: null,
    leadFullName: null,
    cells,
  };
}

/** Inline two-bar trend row: current vs prior + delta chip. Bars scale to the
 *  1.0–4.0 score range; bar fill uses the same thresholds as heat-map cells. */
function TrendCompare({ row, label }: { row: RepFocusTrendComparison; label: string }) {
  const SCORE_MAX = 4;
  const barW = (v: number | null) => v === null ? 0 : Math.max(0, Math.min(1, v / SCORE_MAX)) * 100;
  const cellBg = (v: number | null): string => {
    if (v === null) return 'bg-gray-200 dark:bg-gray-700';
    if (v >= 3) return 'bg-[#175242]';
    if (v >= 2) return 'bg-[#8e7e57]';
    return 'bg-[#c7bca1]';
  };
  const formatAvg = (v: number | null) => v === null ? '—' : v.toFixed(2);

  const delta = row.delta;
  const flat = delta !== null && Math.abs(delta) < 0.1;
  const deltaChip = delta === null
    ? <span className="text-xs text-gray-400 dark:text-gray-500 tabular-nums">—</span>
    : flat
      ? <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 tabular-nums">— flat</span>
      : delta > 0
        ? <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-200 tabular-nums">▲ +{delta.toFixed(1)}</span>
        : <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-200 tabular-nums">▼ {delta.toFixed(1).replace('-', '−')}</span>;

  const Bar = ({ label: barLabel, avg, n }: { label: string; avg: number | null; n: number }) => (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{barLabel}</span>
      <div className="flex-1 h-2 rounded bg-gray-100 dark:bg-gray-800 overflow-hidden">
        <div className={`h-full ${cellBg(avg)}`} style={{ width: `${barW(avg)}%` }} />
      </div>
      <span className="w-24 shrink-0 text-right text-xs text-gray-600 dark:text-gray-300 tabular-nums">
        {formatAvg(avg)} <span className="text-gray-400 dark:text-gray-500">n={n}</span>
      </span>
    </div>
  );

  return (
    <div className="flex items-center gap-4 py-1.5">
      <div className="w-48 shrink-0 text-sm text-gray-700 dark:text-gray-300 truncate" title={label}>{label}</div>
      <div className="flex-1 min-w-0 space-y-1">
        <Bar label="Current" avg={row.currentAvg} n={row.currentN} />
        <Bar label="Prior" avg={row.priorAvg} n={row.priorN} />
      </div>
      <div className="w-20 shrink-0 text-right">{deltaChip}</div>
    </div>
  );
}

/** Group row blocks by (role, rubricVersion), preserving insertion order. */
function groupBlocks(rowBlocks: DimensionHeatmapRowBlock[]): Array<{ key: string; role: string; rubricVersion: number; blocks: DimensionHeatmapRowBlock[] }> {
  const map = new Map<string, { key: string; role: string; rubricVersion: number; blocks: DimensionHeatmapRowBlock[] }>();
  for (const b of rowBlocks) {
    const key = `${b.role}|${b.rubricVersion}`;
    const existing = map.get(key);
    if (existing) existing.blocks.push(b);
    else map.set(key, { key, role: b.role, rubricVersion: b.rubricVersion, blocks: [b] });
  }
  return Array.from(map.values());
}

export default function InsightsTab({ initialFocusRep }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Read filter state from URL params (with initialFocusRep as a SSR-passed fallback)
  const dateRange: InsightsDateRange = useMemo(() => {
    const r = searchParams.get('range') ?? '30d';
    if (r === '7d' || r === '30d' || r === '90d') return { kind: r };
    if (r === 'custom') {
      const start = searchParams.get('start') ?? '';
      const end = searchParams.get('end') ?? '';
      return { kind: 'custom', start, end };
    }
    return { kind: '30d' };
  }, [searchParams]);

  const role: InsightsRoleFilter = useMemo(() => {
    const r = searchParams.get('role');
    if (r === 'SGA' || r === 'SGM' || r === 'both') return r;
    return 'both';
  }, [searchParams]);

  const podIds = useMemo(
    () => (searchParams.get('pods') ?? '').split(',').filter(Boolean),
    [searchParams],
  );
  const repIds = useMemo(
    () => (searchParams.get('reps') ?? '').split(',').filter(Boolean),
    [searchParams],
  );
  const sourceFilter: InsightsSourceFilter = useMemo(() => {
    const s = searchParams.get('source') as InsightsSourceFilter | null;
    return s && SOURCE_OPTIONS.some(o => o.value === s) ? s : 'all';
  }, [searchParams]);
  const trendMode: InsightsTrendMode = useMemo(() => {
    const t = searchParams.get('trend');
    return t === '90d' ? '90d' : '30d';
  }, [searchParams]);

  const focusRep = searchParams.get('focus_rep') ?? initialFocusRep;
  const isFocusMode = !!focusRep;

  // Data
  const [heatmap, setHeatmap] = useState<DimensionHeatmapResult | null>(null);
  const [clusters, setClusters] = useState<KnowledgeGapClusterRow[] | null>(null);
  const [pods, setPods] = useState<InsightsPod[]>([]);
  const [reps, setReps] = useState<InsightsRep[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Heat-map: groups (role|rubricVersion) collapse to a single aggregate block
  // by default; users can expand SGM to see per-pod breakdown.
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (key: string) => setExpandedGroups(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const [longtailOpen, setLongtailOpen] = useState(false);

  // === Three-layer modal stack (5c-2) ===
  const [modalStack, setModalStack] = useState<InsightsModalStackLayer[]>([]);
  const [detailCache, setDetailCache] = useState<Map<string, EvaluationDetail>>(new Map());
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  // Captures the heat-map button that opened the stack (focus-restore on close).
  const triggerRef = useRef<HTMLElement | null>(null);

  const popTopLayer = useCallback(() => setModalStack(s => s.slice(0, -1)), []);
  const closeAll = useCallback(() => {
    setModalStack([]);
    setTimeout(() => triggerRef.current?.focus({ preventScroll: true }), 0);
  }, []);

  const openListModal = useCallback((payload: EvalListModalPayload, trigger: HTMLElement | null) => {
    triggerRef.current = trigger;
    setModalStack([{ kind: 'list', payload }]);
  }, []);

  const openDetailModal = useCallback(async (payload: EvalDetailDrillPayload) => {
    setModalStack(s => [...s, { kind: 'detail', payload }]);
    if (detailCache.has(payload.evaluationId)) return;
    setDetailLoading(true);
    setDetailError(null);
    try {
      const res = await fetch(`/api/call-intelligence/evaluations/${payload.evaluationId}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Detail: ${res.status}`);
      const detail = await res.json() as EvaluationDetail;
      setDetailCache(prev => { const next = new Map(prev); next.set(payload.evaluationId, detail); return next; });
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setDetailLoading(false);
    }
  }, [detailCache]);

  const openTranscriptLayer = useCallback((payload: TranscriptDrillPayload) => {
    setModalStack(s => [...s, { kind: 'transcript', payload }]);
  }, []);

  // Unified Esc handler — closes only the topmost layer.
  useEffect(() => {
    if (modalStack.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (modalStack.length === 1) closeAll();
        else popTopLayer();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [modalStack.length, popTopLayer, closeAll]);

  // URL hash sync — push a hash entry per layer change so browser back pops one layer.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const top = modalStack[modalStack.length - 1];
    let hash = '';
    if (top?.kind === 'list') {
      hash = '#modal=list';
    } else if (top?.kind === 'cluster') {
      hash = `#modal=cluster&bucket=${encodeURIComponent(top.payload.bucket)}`;
    } else if (top?.kind === 'detail') {
      hash = `#modal=detail&eval=${top.payload.evaluationId}`;
    } else if (top?.kind === 'transcript') {
      const utt = top.payload.initialUtteranceIndex ?? '';
      hash = `#modal=transcript&eval=${top.payload.evaluationId}&utt=${utt}`;
    }
    if (window.location.hash !== hash) {
      window.history.pushState(
        { modalDepth: modalStack.length },
        '',
        `${window.location.pathname}${window.location.search}${hash}`,
      );
    }
  }, [modalStack]);

  // popstate — browser back pops the top modal layer (no full navigation).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPop = () => {
      setModalStack(s => s.length > 0 ? s.slice(0, -1) : s);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('range', dateRange.kind);
      if (dateRange.kind === 'custom') {
        params.set('start', dateRange.start);
        params.set('end', dateRange.end);
      }
      params.set('role', role);
      if (podIds.length > 0) params.set('pods', podIds.join(','));
      if (repIds.length > 0) params.set('reps', repIds.join(','));
      if (focusRep) params.set('focus_rep', focusRep);
      params.set('trend', trendMode);

      const clusterParams = new URLSearchParams(params);
      clusterParams.set('source', sourceFilter);

      const [hRes, cRes, pRes, rRes] = await Promise.all([
        fetch(`/api/call-intelligence/insights/heatmap?${params.toString()}`, { cache: 'no-store' }),
        fetch(`/api/call-intelligence/insights/clusters?${clusterParams.toString()}`, { cache: 'no-store' }),
        fetch(`/api/call-intelligence/insights/pods`, { cache: 'no-store' }),
        fetch(`/api/call-intelligence/insights/reps`, { cache: 'no-store' }),
      ]);
      if (!hRes.ok) throw new Error(`Heatmap: ${hRes.status}`);
      if (!cRes.ok) throw new Error(`Clusters: ${cRes.status}`);
      if (!pRes.ok) throw new Error(`Pods: ${pRes.status}`);
      if (!rRes.ok) throw new Error(`Reps: ${rRes.status}`);
      const [h, c, p, r] = await Promise.all([hRes.json(), cRes.json(), pRes.json(), rRes.json()]);
      setHeatmap(h);
      setClusters(c.clusters ?? c);
      setPods(p.pods ?? []);
      setReps(r.reps ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, [dateRange, role, podIds, repIds, sourceFilter, focusRep, trendMode]);

  // Key the fetch effect on the raw URL search string instead of fetchData's
  // identity. fetchData is a useCallback over derived useMemo values keyed on
  // searchParams — in Next.js 14, useSearchParams() returns a new reference
  // whenever the URL changes for ANY reason (including hash changes from the
  // modal-stack pushState below). Keying on the URL's search string keeps the
  // fetch from re-firing on hash-only updates while still reacting to real
  // filter changes. fetchData itself remains a stable closure-over-state via
  // useCallback so async work in-flight can finish without stale captures.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void fetchData(); }, [searchParams.toString(), initialFocusRep]);

  // URL state update helper
  const updateUrl = useCallback((updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '') params.delete(k);
      else params.set(k, v);
    }
    if (!params.has('tab')) params.set('tab', 'insights');
    router.replace(`/dashboard/call-intelligence?${params.toString()}`, { scroll: false });
  }, [router, searchParams]);

  const setFocusRep = (repId: string | null) => updateUrl({ focus_rep: repId });
  const setRoleFilter = (newRole: InsightsRoleFilter) => updateUrl({ role: newRole, pods: null });
  const setRangeFilter = (newRange: '7d' | '30d' | '90d') => updateUrl({ range: newRange });
  const togglePod = (podId: string) => {
    const next = podIds.includes(podId) ? podIds.filter(p => p !== podId) : [...podIds, podId];
    updateUrl({ pods: next.length > 0 ? next.join(',') : null });
  };
  const setSource = (s: InsightsSourceFilter) => updateUrl({ source: s === 'all' ? null : s });
  const setTrendMode = (t: InsightsTrendMode) => updateUrl({ trend: t === '30d' ? null : t });

  // Auto-set role to the rep's role when activating focus mode, so the locked
  // chips reflect the rep and clearing focus leaves a sensible role filter.
  const handleRepSelect = (rep: InsightsRep | null) => {
    if (!rep) {
      updateUrl({ focus_rep: null });
      return;
    }
    const nextRole: InsightsRoleFilter | null =
      rep.role === 'SGA' || rep.role === 'SGM' ? rep.role : null;
    updateUrl({ focus_rep: rep.id, role: nextRole, pods: null });
  };

  // The focused rep's full record (if loaded) — drives role-lock + header label.
  const focusedRep = useMemo(
    () => (focusRep ? reps.find(r => r.id === focusRep) ?? null : null),
    [reps, focusRep],
  );

  // Open Layer 1 (eval-list modal) from a heat-map cell click.
  const heatmapCellPayload = (block: DimensionHeatmapRowBlock, dim: string): EvalListModalPayload => ({
    role: block.role,
    rubricVersion: block.rubricVersion,
    podId: block.podId,
    dimension: dim,
    dateRange,
    focusRep,
  });

  // Rep-focus header content. Renders even before `reps` resolves so the page
  // doesn't briefly flash the team view when loaded with ?focus_rep=… in the URL.
  const focusHeader = (() => {
    if (!isFocusMode) return null;
    const name = focusedRep?.fullName ?? 'Loading rep…';
    const role = focusedRep?.role ?? '—';
    const pod = focusedRep?.podName ?? 'Unassigned';
    const firstName = focusedRep?.fullName?.split(' ')[0] ?? 'this rep';
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            Rep focus mode — {name} ({role}, {pod})
          </h2>
          <button onClick={() => setFocusRep(null)}
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
            ← Back to team
          </button>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          This view shows only {firstName}&apos;s evaluations. The cards below are their personal
          averages for the selected period.
        </p>
      </div>
    );
  })();

  return (
    <div className="space-y-6">
      {focusHeader}
      {/* Sticky filter bar */}
      <div className="sticky top-0 z-10 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3 -mx-4 mb-2 flex flex-wrap items-center gap-3">
        {/* Rep type-ahead — always visible. Selecting a rep activates focus mode. */}
        <RepFilterCombobox
          reps={reps}
          value={focusRep}
          onChange={handleRepSelect}
          className="w-64"
        />

        <select value={dateRange.kind} onChange={(e) => setRangeFilter(e.target.value as '7d' | '30d' | '90d')}
          className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100">
          {DATE_RANGES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>

        <div
          className={`inline-flex border border-gray-300 dark:border-gray-600 rounded-md overflow-hidden ${
            isFocusMode ? 'opacity-60' : ''
          }`}
          aria-disabled={isFocusMode}
          title={isFocusMode && focusedRep ? `Locked to ${focusedRep.role} while focused on ${focusedRep.fullName}` : undefined}
        >
          {(['both', 'SGA', 'SGM'] as const).map((r) => (
            <button key={r} type="button"
              onClick={() => { if (!isFocusMode) setRoleFilter(r); }}
              disabled={isFocusMode}
              className={`px-2 py-0.5 text-xs transition-colors ${
                role === r ? 'bg-blue-600 text-white'
                : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
              } ${isFocusMode ? 'cursor-not-allowed' : ''}`}>
              {r === 'both' ? 'Both' : r}
            </button>
          ))}
        </div>

        {!isFocusMode && role !== 'SGA' && pods.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {pods.map(p => {
              const active = podIds.includes(p.id);
              return (
                <button key={p.id} onClick={() => togglePod(p.id)}
                  className={`px-2 py-0.5 rounded-full border text-xs transition-colors ${
                    active ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}>
                  {p.name}
                </button>
              );
            })}
          </div>
        )}

        {/* Source filter pills — always visible */}
        <div className="flex flex-wrap items-center gap-1 ml-auto">
          {SOURCE_OPTIONS.map(opt => {
            const active = sourceFilter === opt.value;
            return (
              <button key={opt.value} onClick={() => setSource(opt.value)}
                className={`px-2 py-0.5 rounded-full border text-xs transition-colors ${
                  active ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}>
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="py-4 text-center text-sm text-red-600 dark:text-red-400">
          Failed to load: {error}
        </div>
      )}

      {/* Heat map */}
      <Card className="dark:bg-gray-800 dark:border-gray-700">
        <h2 className="text-lg font-semibold mb-3 text-gray-900 dark:text-gray-100">Dimension heat map</h2>
        {loading && <div className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">Loading…</div>}
        {!loading && (!heatmap || heatmap.rowBlocks.length === 0) && (
          <div className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
            No evaluations yet for this period.
          </div>
        )}
        {!loading && heatmap && heatmap.rowBlocks.length > 0 && (
          <div className="overflow-x-auto">
            {groupBlocks(heatmap.rowBlocks).map((group) => {
              // Per-pod children with real pods only (drop the synthetic
              // "Unassigned (no pod)" pod from the expand view — its evals
              // are already rolled up into the aggregate).
              const podChildren = group.blocks.filter(b => b.podId !== null && b.podLabel !== '__SGA__');
              // SGA blocks already collapse via the __SGA__ sentinel, and any
              // group with only one block has nothing meaningful to expand.
              const isSingle = group.blocks.length === 1;
              const canExpand = !isSingle && podChildren.length >= 2;
              const expanded = expandedGroups.has(group.key);
              const headerBlock = isSingle ? group.blocks[0] : aggregateBlocks(group.blocks);

              const renderCells = (block: DimensionHeatmapRowBlock) => (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                  {block.cells.map((cell, ci) => (
                    <button key={ci} type="button"
                       onClick={(e) => openListModal(heatmapCellPayload(block, cell.dimensionName), e.currentTarget)}
                       className={`flex flex-col justify-center min-h-[72px] px-3 py-2 rounded font-medium text-center transition-opacity hover:opacity-80 ${cellColor(cell.avgScore)}`}
                       title={`${humanizeKey(cell.dimensionName)} • avg ${cell.avgScore.toFixed(2)} • n=${cell.n}`}>
                      <div className="text-sm leading-snug">{humanizeKey(cell.dimensionName)}</div>
                      <div className="font-bold tabular-nums">{cell.avgScore.toFixed(1)}</div>
                      <div className="text-[10px] opacity-80">n={cell.n}</div>
                    </button>
                  ))}
                </div>
              );

              const renderBlockHeader = (block: DimensionHeatmapRowBlock, opts?: { aggregate?: boolean }) => (
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    block.role === 'SGA' ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-200'
                    : 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-200'
                  }`}>
                    {block.role}
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                    Rubric v{block.rubricVersion}
                  </span>
                  {opts?.aggregate && (
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">All {block.role}s</span>
                  )}
                  {!opts?.aggregate && block.podLabel !== '__SGA__' && (
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {block.podLabel}
                      {block.leadFullName && <span className="ml-1 text-gray-500 dark:text-gray-400">— led by {block.leadFullName}</span>}
                    </span>
                  )}
                  {canExpand && opts?.aggregate && (
                    <button
                      onClick={() => toggleGroup(group.key)}
                      className="ml-auto text-xs text-blue-600 dark:text-blue-400 hover:underline"
                      aria-expanded={expanded}
                    >
                      {expanded ? 'Hide per-pod breakdown ▴' : 'Show per-pod breakdown ▾'}
                    </button>
                  )}
                </div>
              );

              return (
                <div key={group.key} className="mb-6 last:mb-0">
                  {renderBlockHeader(headerBlock, { aggregate: !isSingle })}
                  {renderCells(headerBlock)}

                  {canExpand && expanded && (
                    <div className="mt-4 pl-4 border-l-2 border-gray-200 dark:border-gray-700 space-y-4">
                      {podChildren.map((child, ci) => (
                        <div key={`${group.key}|${child.podId ?? ci}`}>
                          {renderBlockHeader(child)}
                          {renderCells(child)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Rep-focus sparklines */}
            {isFocusMode && heatmap.sparklines && (() => {
              const visible = heatmap.sparklines.filter(r => r.currentN + r.priorN >= 2);
              const windowLabel = trendMode === '30d' ? 'Last 30d vs prior 30d' : 'Last 90d vs prior 90d';
              return (
                <div className="mt-6 border-t border-gray-200 dark:border-gray-700 pt-4">
                  <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                    <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Period-over-period — {windowLabel}
                    </h3>
                    <div className="inline-flex border border-gray-300 dark:border-gray-600 rounded-md overflow-hidden">
                      {(['30d', '90d'] as const).map((t) => (
                        <button key={t} type="button" onClick={() => setTrendMode(t)}
                          className={`px-2 py-0.5 text-xs transition-colors ${
                            trendMode === t ? 'bg-blue-600 text-white'
                            : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                          }`}>
                          {t === '30d' ? 'Last 30d vs prior 30d' : 'Last 90d vs prior 90d'}
                        </button>
                      ))}
                    </div>
                  </div>
                  {visible.length === 0 ? (
                    <div className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                      Not enough evaluations in either window to compare.
                    </div>
                  ) : (
                    <div className="space-y-1 divide-y divide-gray-100 dark:divide-gray-700/60">
                      {visible.map(row => (
                        <TrendCompare key={row.dimensionName} row={row} label={humanizeKey(row.dimensionName)} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}
      </Card>

      {/* Cluster list */}
      <Card className="dark:bg-gray-800 dark:border-gray-700">
        <h2 className="text-lg font-semibold mb-3 text-gray-900 dark:text-gray-100">Knowledge gap clusters</h2>
        {loading && <div className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">Loading…</div>}
        {!loading && (!clusters || clusters.length === 0) ? (
          <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              <strong className="block text-gray-900 dark:text-gray-100 mb-1">No advisor calls in this window.</strong>
              Adjust the date range or filters above.
            </p>
          </div>
        ) : !loading && clusters && clusters.length > 0 ? (
          (() => {
            const longtail = clusters.filter(c => c.totalOccurrences === 1 && c.bucketKind === 'uncategorized');
            const main = clusters.filter(c => !(c.totalOccurrences === 1 && c.bucketKind === 'uncategorized'));
            const renderCard = (c: KnowledgeGapClusterRow) => (
              <button
                key={c.bucket}
                type="button"
                onClick={() => setModalStack(s => [...s, {
                  kind: 'cluster',
                  payload: {
                    bucket: c.bucket,
                    bucketKind: c.bucketKind,
                    evidence: c.sampleEvidence,
                    gapCount: c.gapCount,
                    deferralCount: c.deferralCount,
                  },
                }])}
                aria-label={`Open cluster evidence for ${humanizeBucket(c.bucket, c.bucketKind)}`}
                className="w-full text-left border border-gray-200 dark:border-gray-700 rounded p-3 hover:border-blue-500 hover:bg-gray-50 dark:hover:bg-gray-700/40 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900 dark:text-gray-100">{humanizeBucket(c.bucket, c.bucketKind)}</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">total {c.totalOccurrences}</span>
                    <span
                      className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400 whitespace-nowrap"
                      title={`${c.repBreakdown.length} rep${c.repBreakdown.length === 1 ? '' : 's'} contributed to this bucket`}
                    >
                      · {c.repBreakdown.length} {c.repBreakdown.length === 1 ? 'rep' : 'reps'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-xs">
                    {c.gapCount > 0 && (
                      <span className="px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200">
                        gap × {c.gapCount}
                      </span>
                    )}
                    {c.deferralCount > 0 && (
                      <span className="px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200">
                        deferral × {c.deferralCount} (
                        {c.deferralByCoverage.missing > 0 && <span className="text-red-700 dark:text-red-300">kb missing × {c.deferralByCoverage.missing}</span>}
                        {c.deferralByCoverage.partial > 0 && <span className="text-yellow-700 dark:text-yellow-300">{c.deferralByCoverage.missing > 0 ? ', ' : ''}partial × {c.deferralByCoverage.partial}</span>}
                        {c.deferralByCoverage.covered > 0 && <span className="text-green-700 dark:text-green-300">{(c.deferralByCoverage.missing > 0 || c.deferralByCoverage.partial > 0) ? ', ' : ''}covered × {c.deferralByCoverage.covered}</span>}
                        )
                      </span>
                    )}
                  </div>
                </div>
                {!isFocusMode && c.repBreakdown.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1 text-xs">
                    {c.repBreakdown.map(rep => (
                      <span
                        key={rep.repId}
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); setFocusRep(rep.repId); }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            setFocusRep(rep.repId);
                          }
                        }}
                        className="cursor-pointer px-2 py-0.5 rounded-full border border-gray-300 dark:border-gray-600 hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                      >
                        {rep.repName} ({rep.gapCount + rep.deferralCount})
                      </span>
                    ))}
                  </div>
                )}
              </button>
            );
            return (
              <>
                <div className="space-y-2">
                  {main.map(renderCard)}
                </div>
                {longtail.length > 0 && (
                  <div className="mt-4">
                    <button
                      type="button"
                      onClick={() => setLongtailOpen(o => !o)}
                      aria-expanded={longtailOpen}
                      className="text-sm text-gray-600 dark:text-gray-400 hover:underline"
                    >
                      {longtailOpen
                        ? `Hide ${longtail.length} one-off${longtail.length === 1 ? '' : 's'} ▴`
                        : `Other (${longtail.length} one-off${longtail.length === 1 ? '' : 's'}) ▾`}
                    </button>
                    {longtailOpen && (
                      <div className="mt-2 space-y-2">
                        {longtail.map(renderCard)}
                      </div>
                    )}
                  </div>
                )}
              </>
            );
          })()
        ) : null}
      </Card>

      {/* === Modal stack (list | cluster | detail | transcript) === */}
      {(() => {
        const listLayer = modalStack.find((l): l is Extract<InsightsModalStackLayer, { kind: 'list' }> => l.kind === 'list');
        const clusterLayer = modalStack.find((l): l is Extract<InsightsModalStackLayer, { kind: 'cluster' }> => l.kind === 'cluster');
        const detailLayer = modalStack.find((l): l is Extract<InsightsModalStackLayer, { kind: 'detail' }> => l.kind === 'detail');
        const transcriptLayer = modalStack.find((l): l is Extract<InsightsModalStackLayer, { kind: 'transcript' }> => l.kind === 'transcript');
        const cachedDetail = detailLayer ? detailCache.get(detailLayer.payload.evaluationId) ?? null : null;
        const transcriptDetail = transcriptLayer ? detailCache.get(transcriptLayer.payload.evaluationId) ?? null : null;
        const topKind = modalStack[modalStack.length - 1]?.kind;
        const listAriaHidden = !!listLayer && topKind !== 'list';
        const clusterAriaHidden = !!clusterLayer && topKind !== 'cluster';
        const detailAriaHidden = !!detailLayer && topKind !== 'detail';

        // Only the bottom-most modal renders the page-dimming backdrop. If every
        // layer rendered its own bg-black/40, stacking N layers would compound to
        // 1 - 0.6^N opacity — so each drill-in / drill-out would visibly darken
        // or lighten the heat map underneath. Single backdrop keeps dimness flat.
        const bottomKind = modalStack[0]?.kind;

        const handleClusterSelectRow = (e: KnowledgeGapClusterEvidence) => {
          if (!clusterLayer) return;
          openDetailModal({
            evaluationId: e.evaluationId,
            bucket: clusterLayer.payload.bucket,
            bucketKind: clusterLayer.payload.bucketKind,
          });
        };
        const handleClusterSelectRep = (repId: string) => {
          setModalStack([]);
          setFocusRep(repId);
        };

        return (
          <>
            {listLayer && (
              <InsightsEvalListModal
                isOpen
                payload={listLayer.payload}
                onClose={closeAll}
                onRowClick={(evaluationId) => openDetailModal({
                  evaluationId,
                  dimension: listLayer.payload.dimension ?? undefined,
                })}
                ariaHidden={listAriaHidden}
                hideBackdrop={bottomKind !== 'list'}
              />
            )}
            {clusterLayer && (
              <InsightsClusterEvidenceModal
                isOpen
                payload={clusterLayer.payload}
                onClose={popTopLayer}
                onSelectRow={handleClusterSelectRow}
                onSelectRep={handleClusterSelectRep}
                ariaHidden={clusterAriaHidden}
                hideBackdrop={bottomKind !== 'cluster'}
              />
            )}
            {detailLayer && (
              <InsightsEvalDetailModal
                isOpen
                payload={detailLayer.payload}
                detail={cachedDetail}
                loading={detailLoading && !cachedDetail}
                error={detailError}
                onClose={popTopLayer}
                onOpenTranscript={openTranscriptLayer}
                onOpenKB={undefined}
                ariaHidden={detailAriaHidden}
                hideBackdrop={bottomKind !== 'detail'}
              />
            )}
            {transcriptLayer && transcriptDetail && (
              <TranscriptModal
                isOpen
                transcript={transcriptDetail.transcript}
                comments={transcriptDetail.transcript_comments}
                currentUserId={null}
                isAdmin={false}
                canComposeComments={false}
                repFullName={transcriptDetail.rep_full_name ?? ''}
                onCommentChanged={() => {}}
                evaluationId={transcriptLayer.payload.evaluationId}
                initialUtteranceIndex={transcriptLayer.payload.initialUtteranceIndex}
                zClassName="z-[70]"
                disableOwnEscHandler
                onClose={popTopLayer}
                hideBackdrop={bottomKind !== 'transcript'}
              />
            )}
          </>
        );
      })()}
    </div>
  );
}
