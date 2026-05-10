'use client';
import { Card } from '@tremor/react';
import type { BridgeSfdcSuggestionT, BridgeSfdcCandidateT, SfdcRecordTypeT } from '@/lib/sales-coaching-client/schemas';

type Props = {
  suggestion: BridgeSfdcSuggestionT | null;
  currentRecordId: string | null;
  isLinking: boolean;
  onPick: (m: { id: string; name: string; type: SfdcRecordTypeT }) => void;
};

// 2026-05-10 — surfaces the SFDC waterfall candidates the Slack DM already
// rendered, so the rep can one-click pick the recommended record (or any
// other waterfall hit) without doing a fresh SOQL search. Renders nothing
// when the suggestion is null OR when there are zero candidates (manual-
// entry waterfall path) — falls through to the existing search panel.
export function SuggestedRecordsPanel({ suggestion, currentRecordId, isLinking, onPick }: Props) {
  if (!suggestion) return null;
  if (suggestion.candidates.length === 0) return null;

  // Top candidate (recommended) is candidates[0] per the upstream contract;
  // everything else is "other matches." A linked-record check de-dupes
  // visually if the rep already picked one of these.
  const [recommended, ...others] = suggestion.candidates;

  function handlePick(c: BridgeSfdcCandidateT) {
    // sfdc_record_id mirrors who_id (Lead/Contact) or what_id (Opp/Account)
    // — same convention used by setSfdcLink throughout this codebase.
    const isWhoType = c.primary_record_type === 'Lead' || c.primary_record_type === 'Contact';
    const recordId = isWhoType ? c.who_id : c.what_id;
    if (!recordId) return;
    onPick({ id: recordId, name: c.primary_label, type: c.primary_record_type });
  }

  return (
    <Card className="dark:bg-gray-800 dark:border-gray-700">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Suggested records</h3>
      <CandidateRow
        candidate={recommended}
        isRecommended
        isCurrent={isCurrent(recommended, currentRecordId)}
        isLinking={isLinking}
        onPick={() => handlePick(recommended)}
      />
      {others.length > 0 && (
        <>
          <div className="mt-3 mb-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Other matches from the call
          </div>
          <ul className="flex flex-col gap-2">
            {others.map((c, i) => (
              <li key={`${c.who_id ?? ''}|${c.what_id ?? ''}|${i}`}>
                <CandidateRow
                  candidate={c}
                  isCurrent={isCurrent(c, currentRecordId)}
                  isLinking={isLinking}
                  onPick={() => handlePick(c)}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function isCurrent(c: BridgeSfdcCandidateT, currentRecordId: string | null): boolean {
  if (!currentRecordId) return false;
  return c.who_id === currentRecordId || c.what_id === currentRecordId;
}

function CandidateRow({
  candidate, isRecommended, isCurrent, isLinking, onPick,
}: {
  candidate: BridgeSfdcCandidateT;
  isRecommended?: boolean;
  isCurrent: boolean;
  isLinking: boolean;
  onPick: () => void;
}) {
  return (
    <div
      className={`min-h-[44px] p-3 rounded border flex items-start justify-between gap-3 ${
        isRecommended
          ? 'border-yellow-400 dark:border-yellow-500 bg-yellow-50 dark:bg-yellow-900/10'
          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {isRecommended && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-yellow-500 text-gray-900">
              Recommended
            </span>
          )}
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
            {candidate.primary_label}
          </span>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          {candidate.display_subtitle || candidate.primary_record_type}
          {candidate.owner_name && <span> · Owner: {candidate.owner_name}</span>}
        </div>
      </div>
      {isCurrent ? (
        <span className="shrink-0 inline-flex items-center text-xs font-medium text-emerald-600 dark:text-emerald-400 px-2 py-1">
          ✓ Linked
        </span>
      ) : (
        <button
          type="button"
          onClick={onPick}
          disabled={isLinking}
          className="shrink-0 min-h-[44px] px-3 py-1 rounded text-sm font-medium border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLinking ? 'Linking…' : 'Use this'}
        </button>
      )}
    </div>
  );
}
