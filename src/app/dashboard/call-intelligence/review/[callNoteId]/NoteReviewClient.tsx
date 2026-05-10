'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@tremor/react';
import type {
  CallNoteDetailT, SfdcSearchMatchT, SfdcSearchQueryTypeT,
  BridgeSfdcSuggestionT,
} from '@/lib/sales-coaching-client/schemas';
import { LONG_NOTE_CHAR_THRESHOLD } from '@/lib/call-intelligence/note-review-constants';
import { formatRelativeTimestamp } from '@/lib/utils/freshness-helpers';
import { SaveStateChip } from '@/components/call-intelligence/SaveStateChip';
import { SfdcResultsList } from '@/components/call-intelligence/SfdcResultsList';
import { SuggestedRecordsPanel } from '@/components/call-intelligence/SuggestedRecordsPanel';
import { RejectReasonModal } from '@/components/call-intelligence/RejectReasonModal';
import { ConfirmSubmitModal } from '@/components/call-intelligence/ConfirmSubmitModal';

type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved'; at: Date } | { kind: 'error'; onRetry: () => void };
type Banner = null | { kind: 'success' | 'info' | 'error'; text: string };

// 2026-05-10 — unified SFDC lookup input. The bridge backend has 4 query
// types (crd / email / name / manual_id) and only manual_id accepts an
// exact 15/18-char ID — URLs aren't extracted server-side. Detect the
// shape client-side and dispatch to the right type. Falls through to
// `name` for anything that isn't recognizable as an ID/CRD/email/URL.
const SFDC_URL_RE = /lightning\.force\.com\/lightning\/r\/[a-zA-Z]+\/([a-zA-Z0-9]{15,18})/;
const SFDC_ID_RE = /^00[1QF36][a-zA-Z0-9]{12}([a-zA-Z0-9]{3})?$/;
const CRD_RE = /^[0-9]{5,8}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function detectSfdcQuery(input: string): { type: SfdcSearchQueryTypeT; query: string; label: string } {
  const trimmed = input.trim();
  const url = trimmed.match(SFDC_URL_RE);
  if (url) return { type: 'manual_id', query: url[1], label: 'SFDC URL' };
  if (SFDC_ID_RE.test(trimmed)) return { type: 'manual_id', query: trimmed, label: 'SFDC ID' };
  if (CRD_RE.test(trimmed)) return { type: 'crd', query: trimmed, label: 'CRD' };
  if (EMAIL_RE.test(trimmed)) return { type: 'email', query: trimmed, label: 'Email' };
  return { type: 'name', query: trimmed, label: 'Name' };
}

export function NoteReviewClient({ initial, suggestion }: { initial: CallNoteDetailT; suggestion: BridgeSfdcSuggestionT | null }) {
  const router = useRouter();
  const [note, setNote] = useState<CallNoteDetailT>(initial);
  const initialText = initial.summary_markdown_edited ?? initial.summary_markdown ?? '';
  const [draft, setDraft] = useState(initialText);
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });
  const [banner, setBanner] = useState<Banner>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [detectedLabel, setDetectedLabel] = useState<string>('');
  const [results, setResults] = useState<SfdcSearchMatchT[]>([]);
  const [isLinking, setIsLinking] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [confirmSubmitOpen, setConfirmSubmitOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);

  // Refs: read latest server state without depending on render closures
  const editVersionRef = useRef(initial.edit_version);
  const lastSavedDraftRef = useRef(initialText);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const pendingDraftRef = useRef<string | null>(null);
  const editorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);

  useEffect(() => () => {
    if (editorTimerRef.current) clearTimeout(editorTimerRef.current);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (searchAbortRef.current) searchAbortRef.current.abort();
  }, []);

  // ─── Single-flight save ────────────────────────────────────────────────
  const runSave = useCallback(async (text: string): Promise<void> => {
    setSaveState({ kind: 'saving' });
    const expected = editVersionRef.current;
    const res = await fetch(`/api/call-intelligence/note-reviews/${note.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary_markdown_edited: text, expected_edit_version: expected }),
      cache: 'no-store',
    });
    if (res.ok) {
      const json = await res.json() as { call_note: CallNoteDetailT };
      setNote(json.call_note);
      editVersionRef.current = json.call_note.edit_version;
      lastSavedDraftRef.current = text;
      setSaveState({ kind: 'saved', at: new Date() });
      setTimeout(() => setSaveState((s) => s.kind === 'saved' ? { kind: 'idle' } : s), 2500);
      return;
    }
    if (res.status === 409) {
      setBanner({ kind: 'info', text: 'Someone else (or another tab) edited this note. Loaded latest.' });
      try {
        const fresh = await fetch(`/api/call-intelligence/note-reviews/${note.id}`, { cache: 'no-store' }).then((r) => r.json()) as { call_note: CallNoteDetailT };
        setNote(fresh.call_note);
        const freshText = fresh.call_note.summary_markdown_edited ?? fresh.call_note.summary_markdown ?? '';
        setDraft(freshText);
        editVersionRef.current = fresh.call_note.edit_version;
        lastSavedDraftRef.current = freshText;
      } catch { /* swallow */ }
      pendingDraftRef.current = null;
      setSaveState({ kind: 'idle' });
      router.refresh();
      throw new Error('conflict');
    }
    setSaveState({ kind: 'error', onRetry: () => { void scheduleSave(text, true); } });
    throw new Error('save_failed');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id, router]);

  const scheduleSave = useCallback(async (text: string, _immediate = false): Promise<void> => {
    if (text === lastSavedDraftRef.current) return;
    if (inFlightRef.current) {
      pendingDraftRef.current = text;
      return inFlightRef.current;
    }
    const exec = async () => {
      try {
        await runSave(text);
      } finally {
        inFlightRef.current = null;
        const next = pendingDraftRef.current;
        pendingDraftRef.current = null;
        if (next !== null && next !== lastSavedDraftRef.current) {
          await scheduleSave(next, true);
        }
      }
    };
    inFlightRef.current = exec();
    return inFlightRef.current;
  }, [runSave]);

  function handleEditorChange(next: string) {
    setDraft(next);
    if (editorTimerRef.current) clearTimeout(editorTimerRef.current);
    editorTimerRef.current = setTimeout(() => { void scheduleSave(next, true); }, 800);
  }

  // Flush any pending save before an action.
  const flushPendingSave = useCallback(async (): Promise<void> => {
    if (editorTimerRef.current) {
      clearTimeout(editorTimerRef.current);
      editorTimerRef.current = null;
    }
    if (draft !== lastSavedDraftRef.current) {
      await scheduleSave(draft, true);
    } else if (inFlightRef.current) {
      await inFlightRef.current;
    }
  }, [draft, scheduleSave]);

  // ─── SFDC search POST (400ms debounce, AbortController) ────────────────
  // 2026-05-10 — auto-detects the input shape (URL → SFDC ID extraction,
  // SFDC ID, CRD, email, name) and dispatches to the matching backend
  // query_type. One field replaces the previous radio strip + 4 separate
  // input modes.
  const performSearch = useCallback(async (raw: string) => {
    if (!raw.trim()) { setResults([]); return; }
    if (searchAbortRef.current) searchAbortRef.current.abort();
    const ctrl = new AbortController();
    searchAbortRef.current = ctrl;
    const { type, query } = detectSfdcQuery(raw);
    try {
      const res = await fetch(`/api/call-intelligence/note-reviews/${note.id}/sfdc-search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, query_type: type }),
        cache: 'no-store',
        signal: ctrl.signal,
      });
      if (ctrl.signal.aborted) return;
      if (res.ok) {
        const json = await res.json() as { matches: SfdcSearchMatchT[] };
        if (!ctrl.signal.aborted) setResults(json.matches);
      } else {
        setResults([]);
        setBanner({ kind: 'error', text: 'Search failed. Please try again.' });
      }
    } catch (err: unknown) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setBanner({ kind: 'error', text: 'Search failed. Please try again.' });
      }
    }
  }, [note.id]);

  function handleSearchChange(next: string) {
    setSearchQuery(next);
    setDetectedLabel(next.trim() ? detectSfdcQuery(next).label : '');
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => { void performSearch(next); }, 400);
  }

  // ─── Pick a match → flush save → PATCH /sfdc-link ──────────────────────
  async function handlePick(m: SfdcSearchMatchT) {
    setIsLinking(true);
    try {
      try { await flushPendingSave(); } catch { setIsLinking(false); return; }
      const body = {
        sfdc_record_id: m.id,
        sfdc_record_type: m.type,
        linkage_strategy: 'manual_entry' as const,
        sfdc_who_id: (m.type === 'Lead' || m.type === 'Contact') ? m.id : null,
        sfdc_what_id: (m.type === 'Opportunity' || m.type === 'Account') ? m.id : null,
        expected_edit_version: editVersionRef.current,
      };
      const res = await fetch(`/api/call-intelligence/note-reviews/${note.id}/sfdc-link`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
      });
      if (res.ok) {
        const json = await res.json() as { call_note: CallNoteDetailT };
        setNote(json.call_note);
        editVersionRef.current = json.call_note.edit_version;
        setBanner({ kind: 'success', text: `Linked to ${m.name}` });
        return;
      }
      if (res.status === 409) {
        setBanner({ kind: 'info', text: 'Someone else edited this note. Loaded latest.' });
        router.refresh();
        return;
      }
      setBanner({ kind: 'error', text: 'Link failed.' });
    } finally {
      setIsLinking(false);
    }
  }

  // ─── Approve → flush save → POST /submit ───────────────────────────────
  async function handleSubmit() {
    setIsSubmitting(true);
    try {
      try { await flushPendingSave(); } catch { setIsSubmitting(false); setConfirmSubmitOpen(false); return; }
      const res = await fetch(`/api/call-intelligence/note-reviews/${note.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true, expected_edit_version: editVersionRef.current }),
        cache: 'no-store',
      });
      setConfirmSubmitOpen(false);
      if (res.ok) {
        router.push('/dashboard/call-intelligence?tab=queue');
        router.refresh();
        return;
      }
      if (res.status === 409) {
        setBanner({ kind: 'info', text: 'Someone else edited this note. Loaded latest.' });
        router.refresh();
        return;
      }
      if (res.status === 400) {
        const j = await res.json().catch(() => ({}));
        setBanner({ kind: 'error', text: j.error ?? 'Cannot submit — check linkage and try again.' });
        return;
      }
      setBanner({ kind: 'error', text: 'Submit failed.' });
    } finally {
      setIsSubmitting(false);
    }
  }

  // ─── Reject → flush save → POST /reject ────────────────────────────────
  async function handleReject(reason: string) {
    setIsRejecting(true);
    try {
      try { await flushPendingSave(); } catch { setIsRejecting(false); setRejectOpen(false); return; }
      const res = await fetch(`/api/call-intelligence/note-reviews/${note.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, expected_edit_version: editVersionRef.current }),
        cache: 'no-store',
      });
      setRejectOpen(false);
      if (res.ok) {
        router.push('/dashboard/call-intelligence?tab=queue');
        router.refresh();
        return;
      }
      if (res.status === 409) {
        setBanner({ kind: 'info', text: 'Someone else edited this note. Loaded latest.' });
        router.refresh();
        return;
      }
      setBanner({ kind: 'error', text: 'Reject failed.' });
    } finally {
      setIsRejecting(false);
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────
  const linked = !!note.sfdc_record_id;
  const linkedRecordTypeLabel = note.sfdc_record_type ? `${note.sfdc_record_type} ${note.sfdc_record_id}` : '';
  const matchedName = linked ? results.find((r) => r.id === note.sfdc_record_id)?.name : undefined;
  const submitTargetLabel = matchedName ?? linkedRecordTypeLabel;
  const isLong = note.note_char_count > LONG_NOTE_CHAR_THRESHOLD;
  const hasUnsavedChanges = draft !== lastSavedDraftRef.current;
  const draftIsEmpty = draft.trim().length === 0;
  const approveDisabled = !linked || isSubmitting || hasUnsavedChanges || draftIsEmpty;

  return (
    <div className="flex flex-col min-h-[calc(100vh-64px)] px-4 py-4 bg-white dark:bg-gray-900">
      <header className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg md:text-xl font-semibold text-gray-900 dark:text-gray-100">{note.title}</h1>
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300" title={note.call_started_at}>
            {formatRelativeTimestamp(note.call_started_at)}
          </span>
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${note.source === 'granola' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'}`}>{note.source === 'granola' ? 'Granola' : 'Kixie'}</span>
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">{note.note_char_count.toLocaleString()} chars</span>
          {isLong && <span className="text-xs text-gray-500 dark:text-gray-400">Long note (&gt;{LONG_NOTE_CHAR_THRESHOLD} chars)</span>}
        </div>
      </header>

      {banner && (
        <div className={`mb-3 px-4 py-3 text-sm rounded flex items-center justify-between gap-4 ${
          banner.kind === 'success' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
          : banner.kind === 'info' ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
          : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
        }`}>
          <span>{banner.text}</span>
          <button onClick={() => setBanner(null)} aria-label="Dismiss" className="text-current hover:opacity-70">×</button>
        </div>
      )}

      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Note summary</h2>
            <SaveStateChip state={saveState} />
          </div>
          {/* transcript field is opaque — DO NOT render it here */}
          <textarea
            value={draft}
            onChange={(e) => handleEditorChange(e.target.value)}
            className="flex-1 resize-none min-h-[300px] w-full text-sm bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 rounded p-3 focus:outline-none focus:border-blue-500"
            spellCheck
          />
        </div>

        <div className="flex flex-col gap-4">
          <Card className="dark:bg-gray-800 dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">Salesforce linkage</h3>
            {linked ? (
              <div className="text-sm">
                {matchedName && (
                  <div className="text-gray-900 dark:text-gray-100 font-medium">{matchedName}</div>
                )}
                <div className="text-gray-500 dark:text-gray-400 text-xs">{note.sfdc_record_type} · {note.sfdc_record_id}</div>
              </div>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">No SFDC record selected. Pick a suggestion below, search, or paste an ID.</p>
            )}
          </Card>

          <SuggestedRecordsPanel
            suggestion={suggestion}
            currentRecordId={note.sfdc_record_id}
            isLinking={isLinking}
            onPick={(m) => handlePick({ id: m.id, name: m.name, type: m.type, score: 1, owner_email: undefined, crd: undefined })}
          />

          <Card className="dark:bg-gray-800 dark:border-gray-700">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Find a record</h3>
              {detectedLabel && (
                <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
                  {detectedLabel}
                </span>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <input
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Paste URL · CRD · 15/18-char Id · email · or type a name"
                className="min-h-[44px] w-full text-sm bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 rounded px-3 focus:outline-none focus:border-blue-500"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Lead, Contact, Opportunity, or Account — full Lightning URL, the 15/18-char Id, a 5–8 digit CRD, an email, or a person/company name.
              </p>
              <SfdcResultsList matches={results} onPick={handlePick} isLinking={isLinking} />
            </div>
          </Card>
        </div>
      </div>

      <div className="sticky bottom-0 -mx-4 px-4 py-3 mt-4 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between gap-3 z-10">
        <button
          onClick={() => setRejectOpen(true)}
          className="min-h-[44px] px-4 py-2 rounded text-sm font-medium border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          Reject
        </button>
        <button
          disabled={approveDisabled}
          onClick={() => setConfirmSubmitOpen(true)}
          title={
            !linked ? 'Link a Salesforce record first'
            : draftIsEmpty ? 'Write a summary before approving'
            : hasUnsavedChanges ? 'Wait for save to complete'
            : undefined
          }
          className="min-h-[44px] px-4 py-2 rounded text-sm font-semibold bg-yellow-500 text-gray-900 dark:text-gray-900 hover:bg-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Approve & push to Salesforce
        </button>
      </div>

      <ConfirmSubmitModal
        isOpen={confirmSubmitOpen}
        onClose={() => setConfirmSubmitOpen(false)}
        onConfirm={handleSubmit}
        linkedRecordName={submitTargetLabel}
        isSubmitting={isSubmitting}
      />
      <RejectReasonModal
        isOpen={rejectOpen}
        onClose={() => setRejectOpen(false)}
        onConfirm={handleReject}
        isSubmitting={isRejecting}
      />
    </div>
  );
}
