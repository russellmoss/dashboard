'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, Title, Text, Metric } from '@tremor/react';
import { useTheme } from 'next-themes';
import { RefreshCw } from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { CHART_COLORS } from '@/config/theme';
import { SqlDateFilter } from '@/components/dashboard/SqlDateFilter';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { buildDateRangeFromSqlFilter } from '@/lib/utils/date-helpers';
import type { SqlDateRange } from '@/types/dashboard';

interface ToolCall {
  toolName?: string;
  serverName?: string;
  input?: Record<string, unknown>;
  isError?: boolean;
}

interface Interaction {
  id: string;
  threadId: string;
  channelId: string;
  userEmail: string;
  userName: string | null;
  timestamp: string | null;
  userMessage: string;
  assistantResponse: string;
  toolCalls: ToolCall[];
  sqlExecuted: string[];
  bytesScanned: number;
  chartGenerated: boolean;
  chartType: string | null;
  exportGenerated: boolean;
  isIssueReport: boolean;
  issueDetails: Record<string, unknown> | null;
  error: string | null;
  threadSeq: number | null;
  threadTotal: number | null;
}

interface ListResponse {
  scorecards: {
    activeUsersInRange: number;
    activeUsers30d: number;
    totalQuestions: number;
    totalThreads: number;
    errorCount: number;
    issueReportCount: number;
  };
  timeSeries: Array<{ date: string | null; questions: number; users: number }>;
  interactions: Interaction[];
  pagination: { limit: number; offset: number; returned: number };
  cachedAt?: string;
}

interface ThreadResponse {
  threadId: string;
  interactions: Interaction[];
}

const PAGE_SIZE = 100;

function formatTimestamp(ts: string | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString();
}

function formatBytes(n: number): string {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length <= n ? s : `${s.slice(0, n).trim()}…`;
}

function userLabel(it: Interaction): string {
  if (it.userName) return `${it.userName}`;
  return it.userEmail || '—';
}

function formatRelativeTime(iso: string | undefined): string {
  if (!iso) return '';
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return '';
  const minutesAgo = Math.floor((Date.now() - ts) / 60000);
  if (minutesAgo < 1) return 'just now';
  if (minutesAgo === 1) return '1 minute ago';
  if (minutesAgo < 60) return `${minutesAgo} minutes ago`;
  const hoursAgo = Math.floor(minutesAgo / 60);
  if (hoursAgo === 1) return '1 hour ago';
  return `${hoursAgo} hours ago`;
}

export function BotUsageClient() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const [dateRange, setDateRange] = useState<SqlDateRange | null>(null);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [offset, setOffset] = useState(0);

  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Interaction | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [cacheBuster, setCacheBuster] = useState(0);

  const dateBounds = useMemo(() => {
    if (!dateRange) return null;
    return buildDateRangeFromSqlFilter(dateRange);
  }, [dateRange]);

  // Debounce search input -> applied filter
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setOffset(0);
  }, [dateRange, errorsOnly, issuesOnly, debouncedSearch]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setFetchError(null);
      try {
        const params = new URLSearchParams();
        if (dateBounds) {
          params.set('startDate', dateBounds.startDate);
          params.set('endDate', dateBounds.endDate);
        }
        if (errorsOnly) params.set('errorsOnly', 'true');
        if (issuesOnly) params.set('issuesOnly', 'true');
        if (debouncedSearch) params.set('q', debouncedSearch);
        params.set('limit', String(PAGE_SIZE));
        params.set('offset', String(offset));

        const res = await fetch(`/api/admin/bot-usage?${params.toString()}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Request failed (${res.status})`);
        }
        const json = (await res.json()) as ListResponse;
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) {
          setFetchError(err instanceof Error ? err.message : 'Failed to load');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [dateBounds, errorsOnly, issuesOnly, debouncedSearch, offset, cacheBuster]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setFetchError(null);
    try {
      const res = await fetch('/api/admin/refresh-cache', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Refresh failed (${res.status})`);
      }
      // Trigger refetch by bumping the cache-buster (re-runs the effect)
      setCacheBuster((n) => n + 1);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to refresh cache');
    } finally {
      setRefreshing(false);
    }
  };

  const rangeLabel = dateBounds
    ? `${dateBounds.startDate} → ${dateBounds.endDate}`
    : 'All time';

  const chartData = (data?.timeSeries ?? []).map((p) => ({
    date: p.date ?? '',
    Questions: p.questions,
    Users: p.users,
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Title className="dark:text-white">Savvy Analyst Bot — Usage</Title>
          <Text className="text-gray-500 dark:text-gray-400">
            Monitor who's using the Slack analyst bot, what they're asking, and what answers they get.
          </Text>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right text-xs text-gray-500 dark:text-gray-400 leading-tight">
            <div>
              Cached for 1 hour.
              {data?.cachedAt && (
                <>
                  {' '}Last fetched {formatRelativeTime(data.cachedAt)}.
                </>
              )}
            </div>
            <div className="text-gray-400 dark:text-gray-500">
              Click refresh to invalidate the cache and re-query.
            </div>
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing || loading}
            title="Refresh cache"
            className="p-2 border border-gray-300 dark:border-gray-600 rounded-lg
                       bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300
                       hover:bg-gray-50 dark:hover:bg-gray-800
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <SqlDateFilter value={dateRange} onChange={setDateRange} />

      {loading && !data ? (
        <Card className="dark:bg-gray-800 dark:border-gray-700">
          <LoadingSpinner />
          <Text className="text-center text-gray-500 dark:text-gray-400 pb-4">
            Loading bot usage… this can take a few seconds the first time, then it's cached.
          </Text>
        </Card>
      ) : (
        <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4 dark:bg-gray-800 dark:border-gray-700">
          <Text className="dark:text-gray-300">Active users</Text>
          <Metric className="text-2xl font-bold dark:text-white">
            {loading ? '—' : data?.scorecards.activeUsersInRange ?? 0}
          </Metric>
          <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">{rangeLabel}</Text>
        </Card>

        <Card className="p-4 dark:bg-gray-800 dark:border-gray-700">
          <Text className="dark:text-gray-300">Active users (last 30d)</Text>
          <Metric className="text-2xl font-bold dark:text-white">
            {loading ? '—' : data?.scorecards.activeUsers30d ?? 0}
          </Metric>
          <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">trailing 30 days</Text>
        </Card>

        <Card className="p-4 dark:bg-gray-800 dark:border-gray-700">
          <Text className="dark:text-gray-300">Questions asked</Text>
          <Metric className="text-2xl font-bold dark:text-white">
            {loading ? '—' : data?.scorecards.totalQuestions ?? 0}
          </Metric>
          <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            across {data?.scorecards.totalThreads ?? 0} threads
          </Text>
        </Card>

        <Card className="p-4 dark:bg-gray-800 dark:border-gray-700">
          <Text className="dark:text-gray-300">Errors / issues flagged</Text>
          <Metric className="text-2xl font-bold dark:text-white">
            {loading ? '—' : `${data?.scorecards.errorCount ?? 0} / ${data?.scorecards.issueReportCount ?? 0}`}
          </Metric>
          <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            errors / user-reported issues
          </Text>
        </Card>
      </div>

      <Card className="dark:bg-gray-800 dark:border-gray-700">
        <Title className="dark:text-white">Questions over time</Title>
        <Text className="text-gray-500 dark:text-gray-400 text-sm mt-1">
          Daily question count and unique active users.
        </Text>
        <div className="h-72 mt-4">
          {chartData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-gray-500 dark:text-gray-400">
              {loading ? 'Loading…' : 'No interactions in this range'}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 5 }}>
                <defs>
                  <linearGradient id="qFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART_COLORS.primary} stopOpacity={0.4} />
                    <stop offset="100%" stopColor={CHART_COLORS.primary} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={isDark ? CHART_COLORS.gridDark : CHART_COLORS.grid}
                  vertical={false}
                />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: CHART_COLORS.axis }}
                  tickLine={{ stroke: isDark ? CHART_COLORS.gridDark : CHART_COLORS.grid }}
                  className="dark:[&_text]:fill-gray-400"
                />
                <YAxis
                  tick={{ fontSize: 11, fill: CHART_COLORS.axis }}
                  tickLine={{ stroke: isDark ? CHART_COLORS.gridDark : CHART_COLORS.grid }}
                  allowDecimals={false}
                  className="dark:[&_text]:fill-gray-400"
                />
                <RechartsTooltip
                  contentStyle={{
                    backgroundColor: isDark ? '#1f2937' : '#fff',
                    border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
                    borderRadius: '8px',
                    color: isDark ? '#f9fafb' : '#111827',
                  }}
                />
                <Legend wrapperStyle={{ color: isDark ? '#d1d5db' : '#374151' }} />
                <Area
                  type="monotone"
                  dataKey="Questions"
                  stroke={CHART_COLORS.primary}
                  fill="url(#qFill)"
                  strokeWidth={2.5}
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="Users"
                  stroke={CHART_COLORS.quinary}
                  fill="transparent"
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      <Card className="dark:bg-gray-800 dark:border-gray-700">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <Title className="dark:text-white">Questions & answers</Title>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              placeholder="Search by name or email…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg
                         bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100
                         focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none w-56"
            />
            <label className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={errorsOnly}
                onChange={(e) => setErrorsOnly(e.target.checked)}
              />
              Errors only
            </label>
            <label className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={issuesOnly}
                onChange={(e) => setIssuesOnly(e.target.checked)}
              />
              Flagged only
            </label>
          </div>
        </div>

        {fetchError && (
          <div className="p-3 mb-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
            {fetchError}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="py-2 pr-3 font-medium">When</th>
                <th className="py-2 pr-3 font-medium">User</th>
                <th className="py-2 pr-3 font-medium">Thread</th>
                <th className="py-2 pr-3 font-medium">Question</th>
                <th className="py-2 pr-3 font-medium">Answer (preview)</th>
                <th className="py-2 pr-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-gray-500 dark:text-gray-400">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && data?.interactions.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-gray-500 dark:text-gray-400">
                    No interactions match these filters.
                  </td>
                </tr>
              )}
              {data?.interactions.map((it) => {
                const isFollowUp =
                  it.threadTotal !== null && it.threadTotal > 1 && it.threadSeq !== 1;
                const isInThread = it.threadTotal !== null && it.threadTotal > 1;
                return (
                  <tr
                    key={it.id}
                    onClick={() => setSelected(it)}
                    className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700/40 cursor-pointer"
                  >
                    <td className="py-2 pr-3 align-top whitespace-nowrap text-gray-700 dark:text-gray-300">
                      {formatTimestamp(it.timestamp)}
                    </td>
                    <td className="py-2 pr-3 align-top text-gray-700 dark:text-gray-300">
                      <div className="font-medium text-gray-900 dark:text-gray-100">
                        {userLabel(it)}
                      </div>
                      {it.userName && it.userEmail && (
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {it.userEmail}
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-3 align-top whitespace-nowrap">
                      {isInThread ? (
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-xs ${
                            isFollowUp
                              ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300'
                              : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                          }`}
                          title={isFollowUp ? 'Follow-up question' : 'First question in thread'}
                        >
                          Q{it.threadSeq} of {it.threadTotal}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">solo</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 align-top text-gray-900 dark:text-gray-100 max-w-md">
                      {truncate(it.userMessage, 140) || (
                        <span className="text-gray-400">(empty)</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 align-top text-gray-700 dark:text-gray-300 max-w-md">
                      {truncate(it.assistantResponse, 140) || (
                        <span className="text-gray-400">(no response)</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 align-top whitespace-nowrap">
                      {it.error && (
                        <span className="inline-block px-2 py-0.5 mr-1 rounded text-xs bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">
                          error
                        </span>
                      )}
                      {it.isIssueReport && (
                        <span className="inline-block px-2 py-0.5 mr-1 rounded text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
                          flagged
                        </span>
                      )}
                      {it.chartGenerated && (
                        <span className="inline-block px-2 py-0.5 mr-1 rounded text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
                          chart
                        </span>
                      )}
                      {it.exportGenerated && (
                        <span className="inline-block px-2 py-0.5 mr-1 rounded text-xs bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300">
                          xlsx
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between mt-3 text-sm text-gray-600 dark:text-gray-400">
          <div>
            {data && (
              <>
                Showing {data.pagination.offset + 1}–
                {data.pagination.offset + data.pagination.returned} of{' '}
                {data.scorecards.totalQuestions}
              </>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0 || loading}
              className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg
                         bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300
                         disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              ← Prev
            </button>
            <button
              type="button"
              onClick={() => setOffset(offset + PAGE_SIZE)}
              disabled={
                loading ||
                !data ||
                data.pagination.offset + data.pagination.returned >= data.scorecards.totalQuestions
              }
              className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg
                         bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300
                         disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              Next →
            </button>
          </div>
        </div>
      </Card>

        </>
      )}

      {selected && <DetailModal interaction={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

interface DetailModalProps {
  interaction: Interaction;
  onClose: () => void;
}

function DetailModal({ interaction: it, onClose }: DetailModalProps) {
  const [thread, setThread] = useState<Interaction[] | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [showThread, setShowThread] = useState(false);

  const hasThread = it.threadTotal !== null && it.threadTotal > 1;

  async function loadThread() {
    setThreadLoading(true);
    setThreadError(null);
    setShowThread(true);
    try {
      const res = await fetch(
        `/api/admin/bot-usage?threadId=${encodeURIComponent(it.threadId)}`
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      const json = (await res.json()) as ThreadResponse;
      setThread(json.interactions);
    } catch (err) {
      setThreadError(err instanceof Error ? err.message : 'Failed to load thread');
    } finally {
      setThreadLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="relative bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-4xl w-full my-8 border border-gray-200 dark:border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-5 border-b border-gray-200 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-900 rounded-t-lg z-10">
          <div>
            <Title className="dark:text-white">
              {showThread ? 'Full thread chronology' : 'Interaction detail'}
            </Title>
            <Text className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              {userLabel(it)}
              {it.userName && it.userEmail ? ` (${it.userEmail})` : ''} ·{' '}
              {formatTimestamp(it.timestamp)}
              {hasThread && (
                <>
                  {' · '}
                  Q{it.threadSeq} of {it.threadTotal} in thread
                </>
              )}
            </Text>
          </div>
          <div className="flex items-center gap-2">
            {hasThread && !showThread && (
              <button
                type="button"
                onClick={loadThread}
                className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg
                           bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300
                           hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                View full thread ({it.threadTotal} messages)
              </button>
            )}
            {showThread && (
              <button
                type="button"
                onClick={() => setShowThread(false)}
                className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg
                           bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300
                           hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                ← Back to single message
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-2xl leading-none px-2"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

        <div className="p-5 space-y-5">
          {showThread ? (
            <ThreadView
              loading={threadLoading}
              error={threadError}
              thread={thread}
              highlightId={it.id}
            />
          ) : (
            <InteractionDetail it={it} />
          )}

          <section className="text-xs text-gray-500 dark:text-gray-400 pt-2 border-t border-gray-200 dark:border-gray-700">
            <div>thread: <span className="font-mono">{it.threadId}</span></div>
            <div>channel: <span className="font-mono">{it.channelId}</span></div>
            <div>id: <span className="font-mono">{it.id}</span></div>
          </section>
        </div>
      </div>
    </div>
  );
}

function InteractionDetail({ it }: { it: Interaction }) {
  return (
    <>
      <section>
        <Text className="font-semibold text-gray-700 dark:text-gray-300 mb-1">Question</Text>
        <pre className="whitespace-pre-wrap text-sm text-gray-900 dark:text-gray-100 bg-gray-50 dark:bg-gray-800 p-3 rounded-lg border border-gray-200 dark:border-gray-700">
          {it.userMessage || '(empty)'}
        </pre>
      </section>

      <section>
        <Text className="font-semibold text-gray-700 dark:text-gray-300 mb-1">Answer</Text>
        <pre className="whitespace-pre-wrap text-sm text-gray-900 dark:text-gray-100 bg-gray-50 dark:bg-gray-800 p-3 rounded-lg border border-gray-200 dark:border-gray-700">
          {it.assistantResponse || '(no response recorded)'}
        </pre>
      </section>

      {it.error && (
        <section>
          <Text className="font-semibold text-red-700 dark:text-red-300 mb-1">Error</Text>
          <pre className="whitespace-pre-wrap text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-200 dark:border-red-800">
            {it.error}
          </pre>
        </section>
      )}

      {it.sqlExecuted.length > 0 && (
        <section>
          <Text className="font-semibold text-gray-700 dark:text-gray-300 mb-1">
            SQL executed ({it.sqlExecuted.length}, {formatBytes(it.bytesScanned)} scanned)
          </Text>
          <div className="space-y-2">
            {it.sqlExecuted.map((sql, i) => (
              <pre
                key={i}
                className="whitespace-pre-wrap text-xs text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-800 p-3 rounded-lg border border-gray-200 dark:border-gray-700 overflow-x-auto"
              >
                {sql}
              </pre>
            ))}
          </div>
        </section>
      )}

      {it.toolCalls.length > 0 && (
        <section>
          <Text className="font-semibold text-gray-700 dark:text-gray-300 mb-1">
            Tool calls ({it.toolCalls.length})
          </Text>
          <ul className="text-sm text-gray-700 dark:text-gray-300 space-y-1">
            {it.toolCalls.map((tc, i) => (
              <li key={i} className="font-mono text-xs">
                {tc.serverName ? `${tc.serverName}::` : ''}
                {tc.toolName ?? '(unknown)'}
                {tc.isError ? ' ⚠️' : ''}
              </li>
            ))}
          </ul>
        </section>
      )}

      {it.issueDetails && (
        <section>
          <Text className="font-semibold text-amber-700 dark:text-amber-300 mb-1">
            Issue report
          </Text>
          <pre className="whitespace-pre-wrap text-xs text-gray-800 dark:text-gray-200 bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg border border-amber-200 dark:border-amber-800">
            {JSON.stringify(it.issueDetails, null, 2)}
          </pre>
        </section>
      )}
    </>
  );
}

function ThreadView({
  loading,
  error,
  thread,
  highlightId,
}: {
  loading: boolean;
  error: string | null;
  thread: Interaction[] | null;
  highlightId: string;
}) {
  if (loading) {
    return <div className="text-sm text-gray-500 dark:text-gray-400">Loading thread…</div>;
  }
  if (error) {
    return (
      <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
        {error}
      </div>
    );
  }
  if (!thread || thread.length === 0) {
    return <div className="text-sm text-gray-500 dark:text-gray-400">No messages found.</div>;
  }
  return (
    <div className="space-y-4">
      {thread.map((msg) => (
        <div
          key={msg.id}
          className={`p-3 rounded-lg border ${
            msg.id === highlightId
              ? 'border-blue-400 dark:border-blue-500 ring-1 ring-blue-300 dark:ring-blue-700'
              : 'border-gray-200 dark:border-gray-700'
          } bg-gray-50 dark:bg-gray-800`}
        >
          <div className="flex items-center justify-between mb-2 text-xs text-gray-500 dark:text-gray-400">
            <span>
              <span className="font-semibold text-gray-700 dark:text-gray-300">
                Q{msg.threadSeq}
              </span>
              {' · '}
              {formatTimestamp(msg.timestamp)}
            </span>
            <span className="flex items-center gap-1">
              {msg.error && (
                <span className="px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">
                  error
                </span>
              )}
              {msg.isIssueReport && (
                <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
                  flagged
                </span>
              )}
              {msg.chartGenerated && (
                <span className="px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
                  chart
                </span>
              )}
            </span>
          </div>
          <div className="space-y-2">
            <div>
              <Text className="text-xs font-semibold text-gray-600 dark:text-gray-400">
                Question
              </Text>
              <pre className="whitespace-pre-wrap text-sm text-gray-900 dark:text-gray-100 mt-0.5">
                {msg.userMessage || '(empty)'}
              </pre>
            </div>
            <div>
              <Text className="text-xs font-semibold text-gray-600 dark:text-gray-400">
                Answer
              </Text>
              <pre className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-200 mt-0.5">
                {msg.assistantResponse || '(no response)'}
              </pre>
            </div>
            {msg.sqlExecuted.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-gray-500 dark:text-gray-400">
                  {msg.sqlExecuted.length} SQL{' '}
                  {msg.sqlExecuted.length === 1 ? 'query' : 'queries'} ·{' '}
                  {formatBytes(msg.bytesScanned)}
                </summary>
                <div className="mt-2 space-y-2">
                  {msg.sqlExecuted.map((sql, i) => (
                    <pre
                      key={i}
                      className="whitespace-pre-wrap text-xs text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-900 p-2 rounded border border-gray-200 dark:border-gray-700 overflow-x-auto"
                    >
                      {sql}
                    </pre>
                  ))}
                </div>
              </details>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
