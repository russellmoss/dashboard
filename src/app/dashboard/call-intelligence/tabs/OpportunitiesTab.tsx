'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Text } from '@tremor/react';
import { Check, ChevronDown } from 'lucide-react';
import { OPEN_PIPELINE_STAGES } from '@/config/constants';
import { ExportButton } from '@/components/ui/ExportButton';
import type { OpportunityListRow } from '@/types/call-intelligence-opportunities';
import type { InsightsPod } from '@/types/call-intelligence';

type SortField = 'lastCallDate' | 'name' | 'stageName' | 'threadedCallCount' | 'ownerName' | 'daysInStage';
type SortDir = 'asc' | 'desc';

const ALL_STAGES = [
  { value: 'Qualifying', label: 'Qualifying', isOpenPipeline: true },
  { value: 'Discovery', label: 'Discovery', isOpenPipeline: true },
  { value: 'Sales Process', label: 'Sales Process', isOpenPipeline: true },
  { value: 'Negotiating', label: 'Negotiating', isOpenPipeline: true },
  { value: 'Signed', label: 'Signed', isOpenPipeline: false },
  { value: 'On Hold', label: 'On Hold', isOpenPipeline: false },
  { value: 'Joined', label: 'Joined', isOpenPipeline: false },
  { value: 'Closed Lost', label: 'Closed Lost', isOpenPipeline: false },
  { value: 'Planned Nurture', label: 'Planned Nurture', isOpenPipeline: false },
];

function fuzzyMatches(target: string | null | undefined, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const t = (target ?? '').toLowerCase();
  for (const token of q.split(/\s+/)) {
    if (token && !t.includes(token)) return false;
  }
  return true;
}

const STAGE_COLORS: Record<string, string> = {
  'Discovery': 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
  'Sales Process': 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200',
  'Negotiating': 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200',
  'On Hold': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200',
  'Signed': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  'Joined': 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
  'Closed Lost': 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
};

function StageBadge({ stage }: { stage: string }) {
  const cls = STAGE_COLORS[stage] ?? 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {stage}
    </span>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString();
}

export default function OpportunitiesTab() {
  const router = useRouter();
  const [rows, setRows] = useState<OpportunityListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState<SortField>('lastCallDate');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [stageFilter, setStageFilter] = useState<string[]>([...OPEN_PIPELINE_STAGES]);
  const [repNameSearch, setRepNameSearch] = useState('');
  const [advisorNameSearch, setAdvisorNameSearch] = useState('');
  const [hasLikelyUnlinked, setHasLikelyUnlinked] = useState(false);
  const [stageDropdownOpen, setStageDropdownOpen] = useState(false);
  const [podFilter, setPodFilter] = useState<string[]>([]);
  const [pods, setPods] = useState<InsightsPod[]>([]);
  const [podDropdownOpen, setPodDropdownOpen] = useState(false);
  const stageDropdownRef = useRef<HTMLDivElement>(null);
  const podDropdownRef = useRef<HTMLDivElement>(null);

  const fetchRows = useCallback(() => {
    setLoading(true);
    fetch('/api/call-intelligence/opportunities')
      .then((res) => res.json())
      .then((data) => {
        setRows(data.rows ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  useEffect(() => {
    fetch('/api/call-intelligence/insights/pods')
      .then((res) => res.json())
      .then((data) => setPods(data.pods ?? []))
      .catch(() => {});
  }, []);

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

  const filtered = useMemo(() => {
    let result = rows;
    if (stageFilter.length > 0 && stageFilter.length < ALL_STAGES.length) {
      result = result.filter((r) => stageFilter.includes(r.stageName));
    }
    if (stageFilter.length === 0) {
      result = [];
    }
    if (repNameSearch) {
      result = result.filter((r) => fuzzyMatches(r.ownerName, repNameSearch));
    }
    if (advisorNameSearch) {
      result = result.filter((r) => fuzzyMatches(r.name, advisorNameSearch));
    }
    if (podFilter.length > 0) {
      result = result.filter((r) => r.podId !== null && podFilter.includes(r.podId));
    }
    if (hasLikelyUnlinked) {
      result = result.filter((r) => r.likelyUnlinkedCount > 0);
    }
    return result;
  }, [rows, stageFilter, repNameSearch, advisorNameSearch, podFilter, hasLikelyUnlinked]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const handleStageToggle = (stage: string) => {
    setStageFilter((prev) =>
      prev.includes(stage) ? prev.filter((s) => s !== stage) : [...prev, stage]
    );
  };

  const stageSummary =
    stageFilter.length === ALL_STAGES.length
      ? 'All Stages'
      : stageFilter.length === OPEN_PIPELINE_STAGES.length &&
          OPEN_PIPELINE_STAGES.every((s) => stageFilter.includes(s))
        ? 'Open Pipeline'
        : stageFilter.length === 0
          ? 'No Stages'
          : `${stageFilter.length} Stages`;

  const hasActiveFilters =
    repNameSearch !== '' ||
    advisorNameSearch !== '' ||
    podFilter.length > 0 ||
    hasLikelyUnlinked ||
    !(
      stageFilter.length === OPEN_PIPELINE_STAGES.length &&
      OPEN_PIPELINE_STAGES.every((s) => stageFilter.includes(s))
    );

  const clearFilters = () => {
    setStageFilter([...OPEN_PIPELINE_STAGES]);
    setRepNameSearch('');
    setAdvisorNameSearch('');
    setPodFilter([]);
    setHasLikelyUnlinked(false);
  };

  const sorted = [...filtered].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    switch (sortField) {
      case 'name': return dir * a.name.localeCompare(b.name);
      case 'stageName': return dir * a.stageName.localeCompare(b.stageName);
      case 'ownerName': return dir * a.ownerName.localeCompare(b.ownerName);
      case 'threadedCallCount': return dir * (a.threadedCallCount - b.threadedCallCount);
      case 'daysInStage': return dir * ((a.daysInStage ?? 9999) - (b.daysInStage ?? 9999));
      case 'lastCallDate':
      default:
        return dir * (a.lastCallDate ?? '').localeCompare(b.lastCallDate ?? '');
    }
  });

  const sortIndicator = (field: SortField) =>
    sortField === field ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  const exportData = sorted.map((r) => ({
    'Opportunity': r.name,
    'Stage': r.stageName,
    'Days in Stage': r.daysInStage ?? '',
    'Owner': r.ownerName,
    'Pod': r.podName ?? '',
    'Threaded Calls': r.threadedCallCount,
    'Likely Unlinked': r.likelyUnlinkedCount,
    'Last Call': formatDate(r.lastCallDate),
  }));

  if (loading) {
    return <Text className="py-8 text-center">Loading opportunities…</Text>;
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 pb-3 border-b border-gray-200 dark:border-gray-700">
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
                  <button type="button" onClick={() => setStageFilter([...OPEN_PIPELINE_STAGES])} className="text-blue-600 dark:text-blue-400 hover:underline">
                    Open Pipeline
                  </button>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
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
                          onChange={() => handleStageToggle(stage.value)}
                          className="sr-only"
                        />
                        <span className={`text-sm ${isSelected ? 'text-blue-700 dark:text-blue-300 font-medium' : 'text-gray-700 dark:text-gray-300'}`}>
                          {stage.label}
                        </span>
                        {stage.isOpenPipeline && (
                          <span className="text-xs text-gray-400 dark:text-gray-500">(Open)</span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Pod dropdown multi-select */}
        {pods.length > 0 && (
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

        {/* Rep name search */}
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

        {/* Advisor name search */}
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

        {/* Has likely-but-unlinked */}
        <label className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-300 cursor-pointer self-end pb-0.5">
          <input
            type="checkbox"
            checked={hasLikelyUnlinked}
            onChange={(e) => setHasLikelyUnlinked(e.target.checked)}
            className="rounded border-gray-300 dark:border-gray-600"
          />
          Has likely-but-unlinked
        </label>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="px-2 py-1 text-xs text-blue-600 dark:text-blue-300 hover:underline self-end pb-0.5"
          >
            Clear filters
          </button>
        )}

        <div className="ml-auto flex items-center gap-3 self-end">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {sorted.length} of {rows.length}
          </span>
          <ExportButton data={exportData} filename="opportunities-calls" />
        </div>
      </div>

      {sorted.length === 0 ? (
        <Text className="py-8 text-center text-gray-500 dark:text-gray-400">
          No Opportunities with linked or likely call activity. Try expanding filters or check the Needs Linking tab to attach orphan calls.
        </Text>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                <th className="py-2 px-2 cursor-pointer select-none" onClick={() => toggleSort('name')}>
                  Opportunity{sortIndicator('name')}
                </th>
                <th className="py-2 px-2 cursor-pointer select-none" onClick={() => toggleSort('stageName')}>
                  Stage{sortIndicator('stageName')}
                </th>
                <th className="py-2 px-2 cursor-pointer select-none" onClick={() => toggleSort('daysInStage')}>
                  Days in Stage{sortIndicator('daysInStage')}
                </th>
                <th className="py-2 px-2 cursor-pointer select-none" onClick={() => toggleSort('ownerName')}>
                  Owner{sortIndicator('ownerName')}
                </th>
                <th className="py-2 px-2 cursor-pointer select-none" onClick={() => toggleSort('threadedCallCount')}>
                  Calls{sortIndicator('threadedCallCount')}
                </th>
                <th className="py-2 px-2">Likely Unlinked</th>
                <th className="py-2 px-2 cursor-pointer select-none" onClick={() => toggleSort('lastCallDate')}>
                  Last Call{sortIndicator('lastCallDate')}
                </th>

              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr
                  key={row.opportunityId}
                  onClick={() => router.push(`/dashboard/call-intelligence/opportunity/${row.opportunityId}`)}
                  className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer transition-colors"
                >
                  <td className="py-2 px-2 font-medium text-blue-600 dark:text-blue-400">
                    {row.name}
                  </td>
                  <td className="py-2 px-2">
                    <StageBadge stage={row.stageName} />
                  </td>
                  <td className="py-2 px-2 dark:text-gray-200">
                    {row.daysInStage != null ? `${row.daysInStage}d` : '—'}
                  </td>
                  <td className="py-2 px-2 dark:text-gray-200">{row.ownerName}</td>
                  <td className="py-2 px-2 dark:text-gray-200 font-medium">{row.threadedCallCount}</td>
                  <td className="py-2 px-2">
                    {row.likelyUnlinkedCount > 0 ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                        {row.likelyUnlinkedCount}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="py-2 px-2 dark:text-gray-200">{formatDate(row.lastCallDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
