'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type {
  ClusterEvidenceModalPayload,
  KnowledgeGapClusterEvidence,
} from '@/types/call-intelligence';

interface Props {
  isOpen: boolean;
  payload: ClusterEvidenceModalPayload | null;
  onClose: () => void;
  onSelectRow: (e: KnowledgeGapClusterEvidence) => void;
  onSelectRep: (repId: string) => void;
  ariaHidden?: boolean;
  /** When true, render no black backdrop. Used when this modal is layered above
   *  another that already owns the dimming backdrop, so opacity doesn't compound. */
  hideBackdrop?: boolean;
}

function truncate(text: string, max = 120): string {
  if (!text) return '';
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + '…';
}

function CoverageChip({ kind, coverage }: {
  kind: 'gap' | 'deferral';
  coverage?: 'covered' | 'partial' | 'missing';
}): JSX.Element {
  if (kind === 'gap') {
    return (
      <span className="inline-block rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide font-semibold bg-[#8e7e57]/15 text-[#8e7e57]">
        Gap
      </span>
    );
  }
  const palette =
    coverage === 'covered' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
    : coverage === 'partial' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300'
    : coverage === 'missing' ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'
    : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200';
  const label =
    coverage === 'covered' ? 'Deferral · Covered'
    : coverage === 'partial' ? 'Deferral · Partial'
    : coverage === 'missing' ? 'Deferral · Missing'
    : 'Deferral';
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide font-semibold ${palette}`}>
      {label}
    </span>
  );
}

export default function InsightsClusterEvidenceModal({
  isOpen,
  payload,
  onClose,
  onSelectRow,
  onSelectRep,
  ariaHidden,
  hideBackdrop,
}: Props) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen && !ariaHidden) {
      const t = setTimeout(() => closeButtonRef.current?.focus({ preventScroll: true }), 0);
      return () => clearTimeout(t);
    }
  }, [isOpen, ariaHidden]);

  useEffect(() => {
    if (!isOpen || ariaHidden) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, ariaHidden, onClose]);

  if (!isOpen || !payload) return null;

  const evidence = payload.evidence ?? [];
  const totalShown = evidence.length;
  const totalCount = payload.gapCount + payload.deferralCount;

  return (
    <div
      className="fixed inset-0 z-50 flex md:items-center md:justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="insights-cluster-evidence-title"
      aria-hidden={ariaHidden}
    >
      <div className={`fixed inset-0 ${hideBackdrop ? '' : 'bg-black/40'}`} onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 shadow-xl flex flex-col overflow-hidden w-full h-full md:h-auto md:max-w-4xl md:mx-4 md:max-h-[90vh] md:rounded-lg">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <div className="min-w-0 flex-1">
            <h2
              id="insights-cluster-evidence-title"
              className="text-lg font-semibold text-gray-900 dark:text-white truncate"
            >
              Cluster · {payload.bucket}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              <span className="mr-2">{payload.gapCount} gap{payload.gapCount === 1 ? '' : 's'}</span>
              <span className="mr-2">·</span>
              <span className="mr-2">{payload.deferralCount} deferral{payload.deferralCount === 1 ? '' : 's'}</span>
              <span className="mr-2">·</span>
              <span>showing {totalShown} of {totalCount}</span>
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close cluster evidence"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {evidence.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
              No evidence rows in this bucket.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200 dark:border-gray-700">
                <tr>
                  <th className="text-left py-2 px-2 font-medium text-gray-700 dark:text-gray-200">Rep</th>
                  <th className="text-left py-2 px-2 font-medium text-gray-700 dark:text-gray-200">Call</th>
                  <th className="text-left py-2 px-2 font-medium text-gray-700 dark:text-gray-200">Kind</th>
                  <th className="text-left py-2 px-2 font-medium text-gray-700 dark:text-gray-200">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {evidence.map((e, i) => (
                  <tr
                    key={`${e.evaluationId}-${e.kind}-${i}`}
                    role="button"
                    aria-label={`Open evaluation for ${e.repName}`}
                    tabIndex={0}
                    onClick={() => onSelectRow(e)}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.preventDefault();
                        onSelectRow(e);
                      }
                    }}
                    className="cursor-pointer min-h-[44px] border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/50 focus:bg-blue-50 dark:focus:bg-blue-900/30 outline-none"
                  >
                    <td className="py-2 px-2 align-top">
                      <button
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          onSelectRep(e.repId);
                        }}
                        className="text-blue-600 dark:text-blue-400 hover:underline"
                        aria-label={`Focus on rep ${e.repName}`}
                      >
                        {e.repName}
                      </button>
                    </td>
                    <td className="py-2 px-2 text-gray-500 dark:text-gray-400 tabular-nums whitespace-nowrap align-top">
                      {e.callStartedAt ? new Date(e.callStartedAt).toLocaleDateString() : '—'}
                    </td>
                    <td className="py-2 px-2 align-top">
                      <CoverageChip kind={e.kind} coverage={e.kbCoverage} />
                    </td>
                    <td className="py-2 px-2 text-gray-800 dark:text-gray-200 align-top">
                      <div className="line-clamp-2">{truncate(e.text, 200)}</div>
                      {e.expectedSource && (
                        <div className="mt-0.5 text-[11px] font-mono text-gray-500 dark:text-gray-400">
                          {e.expectedSource}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
