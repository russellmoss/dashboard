'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, ArrowRightCircle, ChevronDown, ChevronUp, DollarSign, Flame, Loader2, RefreshCw, Sparkles, Swords } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CallDetailModal, type CallDetailRowSummary, type ReviewData } from '@/components/call-intelligence/CallDetailModal';
import type { OpportunityHeader, OpportunityTimelineRow, LinkageStatus, OpportunityAiSummary } from '@/types/call-intelligence-opportunities';

interface Props {
  opportunityId: string;
  role: string;
}

interface DetailResponse {
  header: OpportunityHeader;
  timeline: OpportunityTimelineRow[];
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

const LINKAGE_LABELS: Record<LinkageStatus, { text: string; cls: string }> = {
  linked_opp: { text: 'Linked to Opp', cls: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200' },
  linked_contact: { text: 'Linked to Contact', cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  linked_lead: { text: 'Linked to Lead', cls: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200' },
  likely_match: { text: 'Likely match', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200' },
};

const MARKDOWN_PROSE = [
  '[&_h1]:text-xl [&_h1]:font-bold [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:dark:text-white',
  '[&_h2]:text-lg [&_h2]:font-bold [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:dark:text-white',
  '[&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:dark:text-white',
  '[&_p]:text-sm [&_p]:leading-6 [&_p]:my-2 [&_p]:dark:text-gray-100',
  '[&_strong]:font-semibold [&_strong]:dark:text-white',
  '[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-2 [&_ul]:space-y-1',
  '[&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-2 [&_ol]:space-y-1',
  '[&_li]:text-sm [&_li]:leading-6 [&_li]:dark:text-gray-100',
].join(' ');

function StageBadge({ stage }: { stage: string }) {
  const cls = STAGE_COLORS[stage] ?? 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {stage}
    </span>
  );
}

function LinkageBadge({ status }: { status: LinkageStatus }) {
  const { text, cls } = LINKAGE_LABELS[status];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {text}
    </span>
  );
}

function StageAtCallBadge({ stage }: { stage: string | null }) {
  if (!stage) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
        Pre-conversion
      </span>
    );
  }
  return <StageBadge stage={stage} />;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString();
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function formatCurrency(amount: number | null): string {
  if (amount == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
}

const CALL_DATE_TAG_RE = /\(([A-Z][a-z]{2} \d{1,2} call)\)/g;

function renderBulletWithCallLinks(
  text: string,
  callDateMap: Record<string, string>,
  onClickCallId: (callNoteId: string) => void,
): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(CALL_DATE_TAG_RE);

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const tag = match[1];
    const callNoteId = callDateMap[tag];
    if (callNoteId) {
      parts.push(
        <button
          key={match.index}
          type="button"
          onClick={(e) => { e.stopPropagation(); onClickCallId(callNoteId); }}
          className="text-blue-600 dark:text-blue-400 hover:underline"
        >
          ({tag})
        </button>,
      );
    } else {
      parts.push(`(${tag})`);
    }
    lastIndex = re.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

export default function OpportunityDetailClient({ opportunityId, role }: Props) {
  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<CallDetailRowSummary | null>(null);
  const [selectedReviewData, setSelectedReviewData] = useState<ReviewData | undefined>(undefined);

  const [aiSummary, setAiSummary] = useState<OpportunityAiSummary | null>(null);
  const [aiSummaryLoading, setAiSummaryLoading] = useState(true);
  const [aiSummaryError, setAiSummaryError] = useState<string | null>(null);
  const [aiSummaryCollapsed, setAiSummaryCollapsed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchAiSummary = useCallback((force = false) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setAiSummaryLoading(true);
    setAiSummaryError(null);
    const url = `/api/call-intelligence/opportunities/${opportunityId}/ai-summary`;
    const fetchOpts: RequestInit = { signal: controller.signal };
    if (force) fetchOpts.method = 'POST';
    fetch(url, fetchOpts)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Failed (${res.status})`);
        }
        return res.json();
      })
      .then((d: OpportunityAiSummary) => {
        setAiSummary(d);
        setAiSummaryLoading(false);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setAiSummaryError(err instanceof Error ? err.message : 'Failed to generate summary');
        setAiSummaryLoading(false);
      });
  }, [opportunityId]);

  useEffect(() => { fetchAiSummary(); }, [fetchAiSummary]);

  const fetchDetail = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/call-intelligence/opportunities/${opportunityId}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Request failed (${res.status})`);
        }
        return res.json();
      })
      .then((d: DetailResponse) => {
        setData(d);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load');
        setLoading(false);
      });
  }, [opportunityId]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  const handleOpenCall = (row: OpportunityTimelineRow) => {
    setSelectedRow({
      callNoteId: row.callNoteId,
      callDate: row.callDate,
      advisorName: data?.header.name ?? null,
      advisorEmail: null,
      sgaName: row.repName,
      sgmName: row.managerName,
      source: row.source,
      didSql: false,
      didSqo: false,
      currentStage: data?.header.stageName ?? null,
      closedLost: data?.header.isClosed === true && data?.header.isWon === false,
      pushedToSfdc: row.linkageStatus !== 'likely_match',
      hasAiFeedback: false,
      hasManagerEditEval: false,
      leadUrl: data?.header.leadId
        ? `https://savvywealth.lightning.force.com/lightning/r/Lead/${data.header.leadId}/view`
        : null,
      opportunityUrl: `https://savvywealth.lightning.force.com/lightning/r/Opportunity/${opportunityId}/view`,
    });
    setSelectedReviewData(undefined);
  };

  const handleOpenCallById = (callNoteId: string) => {
    const row = data?.timeline.find((t) => t.callNoteId === callNoteId);
    if (row) handleOpenCall(row);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-500 dark:text-gray-400">
        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
        Loading opportunity details…
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-3xl mx-auto py-12 px-4">
        <Link href="/dashboard/call-intelligence?tab=opportunities" className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to Opportunities
        </Link>
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { header, timeline } = data;
  const latestCall = timeline.length > 0 ? timeline[0] : null;
  const latestSummary = latestCall
    ? (latestCall.summaryPreview ? undefined : null)
    : null;

  const latestCallFullSummary = latestCall;

  return (
    <div className="space-y-6 px-4 py-6 max-w-6xl mx-auto">
      {/* Back nav */}
      <Link href="/dashboard/call-intelligence?tab=opportunities" className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:underline">
        <ArrowLeft className="w-4 h-4" /> Back to Opportunities
      </Link>

      {/* Header Card */}
      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{header.name}</h1>
            <div className="flex items-center gap-3 mt-2">
              <StageBadge stage={header.stageName} />
              {header.daysInStage != null && (
                <span className="text-sm text-gray-500 dark:text-gray-400">{header.daysInStage} days in stage</span>
              )}
              {header.isClosed && (
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                  header.isWon
                    ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200'
                    : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200'
                }`}>
                  {header.isWon ? 'Won' : 'Lost'}
                </span>
              )}
            </div>
          </div>
          <a
            href={`https://savvywealth.lightning.force.com/lightning/r/Opportunity/${opportunityId}/view`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline shrink-0"
          >
            View in SFDC
          </a>
        </div>

        <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Owner</dt>
            <dd className="dark:text-gray-100 mt-0.5">{header.ownerName}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Amount</dt>
            <dd className="dark:text-gray-100 mt-0.5">{formatCurrency(header.amount)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Close Date</dt>
            <dd className="dark:text-gray-100 mt-0.5">{formatDate(header.closeDate)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Last Activity</dt>
            <dd className="dark:text-gray-100 mt-0.5">{formatDate(header.lastActivityDate)}</dd>
          </div>
        </dl>
      </div>

      {/* AI Deal Summary Card */}
      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
        <button
          type="button"
          onClick={() => setAiSummaryCollapsed((v) => !v)}
          className="w-full flex items-center justify-between px-6 py-4 text-left"
        >
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-500" />
            <span className="text-sm font-semibold text-gray-900 dark:text-white">AI Deal Summary</span>
            {aiSummary && !aiSummaryLoading && (
              <>
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {new Date(aiSummary.generatedAt).toLocaleDateString()}
                </span>
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
                  aiSummary.cacheHit
                    ? 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                    : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                }`}>
                  {aiSummary.cacheHit ? 'Cached' : 'Fresh'}
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!aiSummaryLoading && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); fetchAiSummary(true); }}
                className="p-1 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                title="Regenerate summary"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            )}
            {aiSummaryCollapsed ? (
              <ChevronDown className="w-4 h-4 text-gray-400" />
            ) : (
              <ChevronUp className="w-4 h-4 text-gray-400" />
            )}
          </div>
        </button>

        {!aiSummaryCollapsed && (
          <div className="px-6 pb-5 border-t border-gray-100 dark:border-gray-800">
            {aiSummaryLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-4 animate-pulse">
                {[
                  'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800/40',
                  'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800/40',
                  'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/40',
                  'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/40',
                ].map((cls, i) => (
                  <div key={i} className={`rounded-lg border p-4 ${cls}`}>
                    <div className="h-4 bg-gray-200/60 dark:bg-gray-700/40 rounded w-28 mb-3" />
                    <div className="h-3 bg-gray-200/40 dark:bg-gray-700/30 rounded w-full mb-1.5" />
                    <div className="h-3 bg-gray-200/40 dark:bg-gray-700/30 rounded w-4/5" />
                  </div>
                ))}
                <div className="md:col-span-2 rounded-lg border p-4 bg-purple-50 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800/40">
                  <div className="h-4 bg-gray-200/60 dark:bg-gray-700/40 rounded w-36 mb-3" />
                  <div className="h-3 bg-gray-200/40 dark:bg-gray-700/30 rounded w-full mb-1.5" />
                  <div className="h-3 bg-gray-200/40 dark:bg-gray-700/30 rounded w-3/5" />
                </div>
              </div>
            ) : aiSummaryError ? (
              <div className="pt-4">
                <p className="text-sm text-red-600 dark:text-red-400">{aiSummaryError}</p>
                <button
                  type="button"
                  onClick={() => fetchAiSummary()}
                  className="mt-2 text-sm text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Retry
                </button>
              </div>
            ) : aiSummary && aiSummary.callNoteIds.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 italic pt-4">
                No call data available to generate summary.
              </p>
            ) : aiSummary ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-4">
                {([
                  {
                    label: 'Pain Points',
                    items: aiSummary.painPoints,
                    icon: <Flame className="w-4 h-4" />,
                    border: 'border-l-red-400 dark:border-l-red-500',
                    bg: 'bg-red-50/70 dark:bg-red-950/20',
                    ring: 'border-red-100 dark:border-red-900/30',
                    iconBg: 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400',
                    heading: 'text-red-800 dark:text-red-300',
                    emptyText: 'No pain points identified',
                  },
                  {
                    label: 'Competitors',
                    items: aiSummary.competitorsInTheMix,
                    icon: <Swords className="w-4 h-4" />,
                    border: 'border-l-blue-400 dark:border-l-blue-500',
                    bg: 'bg-blue-50/70 dark:bg-blue-950/20',
                    ring: 'border-blue-100 dark:border-blue-900/30',
                    iconBg: 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400',
                    heading: 'text-blue-800 dark:text-blue-300',
                    emptyText: 'No competitors mentioned',
                  },
                  {
                    label: 'Advisor Concerns',
                    items: aiSummary.advisorConcerns,
                    icon: <AlertTriangle className="w-4 h-4" />,
                    border: 'border-l-purple-400 dark:border-l-purple-500',
                    bg: 'bg-purple-50/70 dark:bg-purple-950/20',
                    ring: 'border-purple-100 dark:border-purple-900/30',
                    iconBg: 'bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400',
                    heading: 'text-purple-800 dark:text-purple-300',
                    emptyText: 'No advisor concerns raised',
                  },
                  {
                    label: 'Compensation',
                    items: aiSummary.compensationDiscussions,
                    icon: <DollarSign className="w-4 h-4" />,
                    border: 'border-l-amber-400 dark:border-l-amber-500',
                    bg: 'bg-amber-50/70 dark:bg-amber-950/20',
                    ring: 'border-amber-100 dark:border-amber-900/30',
                    iconBg: 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400',
                    heading: 'text-amber-800 dark:text-amber-300',
                    emptyText: 'No compensation discussed',
                  },
                ]).map((cat) => (
                  <div
                    key={cat.label}
                    className={`rounded-lg border border-l-4 ${cat.border} ${cat.ring} ${cat.bg} p-4`}
                  >
                    <div className="flex items-center gap-2 mb-2.5">
                      <span className={`flex items-center justify-center w-6 h-6 rounded-md ${cat.iconBg}`}>
                        {cat.icon}
                      </span>
                      <h4 className={`text-xs font-bold uppercase tracking-wider ${cat.heading}`}>
                        {cat.label}
                      </h4>
                      {cat.items.length > 0 && (
                        <span className="ml-auto text-xs font-medium text-gray-400 dark:text-gray-500">
                          {cat.items.length}
                        </span>
                      )}
                    </div>
                    {cat.items.length > 0 ? (
                      <ul className="space-y-1.5">
                        {cat.items.map((item, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-200 leading-snug">
                            <span className="mt-1.5 w-1 h-1 rounded-full bg-gray-400 dark:bg-gray-500 shrink-0" />
                            <span>{renderBulletWithCallLinks(item, aiSummary.callDateMap, handleOpenCallById)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-gray-400 dark:text-gray-500 italic">{cat.emptyText}</p>
                    )}
                  </div>
                ))}

                {/* Next Steps — full width bottom row */}
                <div className="md:col-span-2 rounded-lg border border-l-4 border-l-emerald-400 dark:border-l-emerald-500 border-emerald-100 dark:border-emerald-900/30 bg-emerald-50/70 dark:bg-emerald-950/20 p-4">
                  <div className="flex items-center gap-2 mb-2.5">
                    <span className="flex items-center justify-center w-6 h-6 rounded-md bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400">
                      <ArrowRightCircle className="w-4 h-4" />
                    </span>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                      Next Steps
                    </h4>
                    {aiSummary.nextSteps.length > 0 && (
                      <span className="ml-auto text-xs font-medium text-gray-400 dark:text-gray-500">
                        {aiSummary.nextSteps.length}
                      </span>
                    )}
                  </div>
                  {aiSummary.nextSteps.length > 0 ? (
                    <ul className="space-y-1.5">
                      {aiSummary.nextSteps.map((item, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-200 leading-snug">
                          <span className="mt-1.5 w-1 h-1 rounded-full bg-gray-400 dark:bg-gray-500 shrink-0" />
                          <span>{renderBulletWithCallLinks(item, aiSummary.callDateMap, handleOpenCallById)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-gray-400 dark:text-gray-500 italic">No next steps identified</p>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Latest Activity Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Latest Call Recap */}
        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Latest Call Recap</h3>
          {latestCallFullSummary ? (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs text-gray-500 dark:text-gray-400">{formatTimestamp(latestCallFullSummary.callDate)}</span>
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
                  latestCallFullSummary.source === 'granola'
                    ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                    : 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
                }`}>
                  {latestCallFullSummary.source}
                </span>
                {latestCallFullSummary.repName && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">{latestCallFullSummary.repName}</span>
                )}
              </div>
              <div className={`text-sm dark:text-gray-100 max-h-40 overflow-y-auto ${MARKDOWN_PROSE}`}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {latestCallFullSummary.summaryPreview ?? 'No summary available.'}
                </ReactMarkdown>
              </div>
              <button
                type="button"
                onClick={() => handleOpenCall(latestCallFullSummary)}
                className="mt-2 text-sm text-blue-600 dark:text-blue-400 hover:underline"
              >
                View full call
              </button>
            </div>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400 italic">No calls recorded yet.</p>
          )}
        </div>

        {/* Next Step */}
        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Rep&apos;s Next Step</h3>
          {header.nextStep ? (
            <div>
              <p className="text-sm dark:text-gray-100">{header.nextStep}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                Last updated {formatDate(header.lastModifiedDate)}
              </p>
            </div>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400 italic">No next step entered in SFDC.</p>
          )}
        </div>
      </div>

      {/* Timeline */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Call Timeline ({timeline.length} {timeline.length === 1 ? 'call' : 'calls'})
        </h2>
        {timeline.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 italic py-4">
            No threaded calls found for this opportunity.
          </p>
        ) : (
          <div className="space-y-3">
            {timeline.map((row) => (
              <div
                key={row.callNoteId}
                className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-4 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium dark:text-gray-100">{row.title}</span>
                      <LinkageBadge status={row.linkageStatus} />
                      <StageAtCallBadge stage={row.stageAtTimeOfCall} />
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
                        row.source === 'granola'
                          ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                          : 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
                      }`}>
                        {row.source}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 dark:text-gray-400">
                      <span>{formatTimestamp(row.callDate)}</span>
                      {row.repName && <span>{row.repName}</span>}
                      {row.managerName && <span className="text-gray-400">({row.managerName})</span>}
                    </div>
                    {row.summaryPreview && (
                      <p className="mt-2 text-sm text-gray-600 dark:text-gray-300 line-clamp-2">{row.summaryPreview}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleOpenCall(row)}
                    className="shrink-0 px-3 py-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 rounded-lg transition-colors"
                  >
                    Open
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Call Detail Modal */}
      <CallDetailModal
        row={selectedRow}
        onClose={() => { setSelectedRow(null); setSelectedReviewData(undefined); }}
        onRefresh={() => { setSelectedRow(null); setSelectedReviewData(undefined); fetchDetail(); }}
        initialReviewData={selectedReviewData}
      />
    </div>
  );
}
