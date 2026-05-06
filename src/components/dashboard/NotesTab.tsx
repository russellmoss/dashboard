// Per-record Notes tab for RecordDetailModal.
// Renders an accordion of sales-coaching call_notes confidently linked
// to this record. Most-recent note expanded by default; the rest are
// collapsed and openable individually. Each note can be downloaded
// as a markdown file; "Download all" concatenates the lot.

'use client';

import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Download, ExternalLink, Loader2, Check } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { NoteRecord, LinkConfidence } from '@/types/record-notes';

// Same prose styling the Coaching Usage modal uses — kept in sync by
// duplication on purpose; extracting it would be a bigger refactor than
// the gain warrants for two callsites.
const MARKDOWN_PROSE_CLASSES = [
  '[&_h1]:text-xl [&_h1]:font-bold [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:dark:text-white',
  '[&_h2]:text-lg [&_h2]:font-bold [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:dark:text-white',
  '[&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:dark:text-white',
  '[&_p]:text-sm [&_p]:leading-6 [&_p]:my-2 [&_p]:dark:text-gray-100',
  '[&_strong]:font-semibold [&_strong]:dark:text-white',
  '[&_em]:italic',
  '[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-2 [&_ul]:space-y-1',
  '[&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-2 [&_ol]:space-y-1',
  '[&_li]:text-sm [&_li]:leading-6 [&_li]:dark:text-gray-100',
  '[&_blockquote]:border-l-4 [&_blockquote]:border-gray-300 [&_blockquote]:dark:border-gray-600 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-gray-600 [&_blockquote]:dark:text-gray-300 [&_blockquote]:my-2',
  '[&_code]:bg-gray-100 [&_code]:dark:bg-gray-700 [&_code]:px-1 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono',
  '[&_a]:text-blue-600 [&_a]:dark:text-blue-400 [&_a]:underline',
  '[&_hr]:my-4 [&_hr]:border-gray-200 [&_hr]:dark:border-gray-700',
].join(' ');

function formatCallDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

const CONFIDENCE_BADGE: Record<LinkConfidence, { label: string; classes: string; tooltip: string }> = {
  pushed: {
    label: 'Pushed',
    classes: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200',
    tooltip: 'Notes pushed back to this Salesforce record — strongest link.',
  },
  direct: {
    label: 'Linked',
    classes: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200',
    tooltip: 'Linked via SFDC who_id (Lead/Contact match) but not pushed to SFDC.',
  },
  email: {
    label: 'Email match',
    classes: 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200',
    tooltip: 'Matched via a unique invitee email — high confidence but not linked in Salesforce.',
  },
};

function buildMarkdownExport(advisorName: string, notes: NoteRecord[]): string {
  const lines: string[] = [];
  lines.push(`# Notes — ${advisorName}`);
  lines.push('');
  lines.push(`Exported ${new Date().toISOString()} · ${notes.length} note${notes.length === 1 ? '' : 's'}`);
  lines.push('');
  for (const n of notes) {
    lines.push('---');
    lines.push('');
    lines.push(`## ${formatCallDate(n.callDate)} — ${n.repName ?? 'Unknown rep'}${n.repRole ? ` (${n.repRole})` : ''}`);
    lines.push('');
    lines.push(`- **Source**: ${n.source}`);
    if (n.managerName) lines.push(`- **Manager**: ${n.managerName}`);
    if (n.otherSavvyAttendees.length > 0) {
      lines.push(`- **Other Savvy attendees**: ${n.otherSavvyAttendees.join(', ')}`);
    }
    lines.push(`- **Pushed to SFDC**: ${n.pushedToSfdc ? 'yes' : 'no'}`);
    lines.push(`- **Link confidence**: ${n.linkConfidence}`);
    lines.push('');
    if (n.notesMarkdown) {
      lines.push('### Notes');
      lines.push('');
      lines.push(n.notesMarkdown);
      lines.push('');
    }
    if (n.coachingMarkdown) {
      lines.push('### Coaching Analysis');
      lines.push('');
      lines.push(n.coachingMarkdown);
      lines.push('');
    }
  }
  return lines.join('\n');
}

function buildSingleNoteMarkdown(advisorName: string, n: NoteRecord): string {
  return buildMarkdownExport(advisorName, [n]);
}

function downloadMarkdown(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on the next tick — Safari needs the URL alive long enough to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function safeFilename(s: string): string {
  return s.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
}

interface NoteCardProps {
  note: NoteRecord;
  advisorName: string;
  defaultOpen: boolean;
}

function NoteCard({ note, advisorName, defaultOpen }: NoteCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [justCopied, setJustCopied] = useState(false);
  const badge = CONFIDENCE_BADGE[note.linkConfidence];

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    const stamp = new Date(note.callDate).toISOString().slice(0, 16).replace(':', '');
    const fname = `${safeFilename(advisorName)}-${stamp}-${note.source}.md`;
    downloadMarkdown(fname, buildSingleNoteMarkdown(advisorName, note));
  };

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(buildSingleNoteMarkdown(advisorName, note));
      setJustCopied(true);
      setTimeout(() => setJustCopied(false), 1500);
    } catch {
      // Clipboard write can fail in iframes / older browsers — silently no-op.
    }
  };

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-800">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
        aria-expanded={open}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {open
            ? <ChevronDown className="w-4 h-4 text-gray-500 flex-shrink-0" />
            : <ChevronRight className="w-4 h-4 text-gray-500 flex-shrink-0" />}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-gray-900 dark:text-white">
                {formatCallDate(note.callDate)}
              </span>
              <span className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {note.source}
              </span>
              <span
                className={`px-2 py-0.5 text-[10px] font-semibold rounded-full ${badge.classes}`}
                title={badge.tooltip}
              >
                {badge.label}
              </span>
            </div>
            <div className="mt-0.5 text-xs text-gray-600 dark:text-gray-300 truncate">
              {note.repName ?? 'Unknown rep'}
              {note.repRole ? ` · ${note.repRole}` : ''}
              {note.managerName ? ` · mgr ${note.managerName}` : ''}
              {note.otherSavvyAttendees.length > 0
                ? ` · +${note.otherSavvyAttendees.length} other Savvy`
                : ''}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={handleCopy}
            className="px-2 py-1 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
            title="Copy this note as markdown"
          >
            {justCopied ? <Check className="w-3.5 h-3.5 text-green-600" /> : 'Copy'}
          </button>
          <button
            onClick={handleDownload}
            className="px-2 py-1 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors flex items-center gap-1"
            title="Download this note as a .md file"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Download</span>
          </button>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-2 border-t border-gray-100 dark:border-gray-700">
          {note.otherSavvyAttendees.length > 0 && (
            <div className="mb-3 text-xs text-gray-500 dark:text-gray-400">
              <span className="font-semibold">Other Savvy attendees:</span>{' '}
              {note.otherSavvyAttendees.join(', ')}
            </div>
          )}
          {note.notesMarkdown ? (
            <div className={MARKDOWN_PROSE_CLASSES}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{note.notesMarkdown}</ReactMarkdown>
            </div>
          ) : (
            <div className="text-sm italic text-gray-500 dark:text-gray-400">No notes content.</div>
          )}
          {note.coachingMarkdown && (
            <details className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                Coaching analysis
              </summary>
              <div className={`mt-2 ${MARKDOWN_PROSE_CLASSES}`}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{note.coachingMarkdown}</ReactMarkdown>
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

interface NotesTabProps {
  notes: NoteRecord[];
  advisorName: string;
  loading: boolean;
  error: string | null;
}

export function NotesTab({ notes, advisorName, loading, error }: NotesTabProps) {
  // Pre-sort defensive copy — server already orders DESC but never trust the wire.
  const sorted = useMemo(
    () => [...notes].sort((a, b) => b.callDate.localeCompare(a.callDate)),
    [notes],
  );

  const handleDownloadAll = () => {
    const fname = `${safeFilename(advisorName)}-all-notes.md`;
    downloadMarkdown(fname, buildMarkdownExport(advisorName, sorted));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-500 dark:text-gray-400">
        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
        Loading notes…
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
        {error}
      </div>
    );
  }
  if (sorted.length === 0) {
    // Parent should hide the tab entirely in this case, but render an
    // empty-state defensively in case the parent renders us anyway.
    return (
      <div className="text-sm italic text-gray-500 dark:text-gray-400 py-6 text-center">
        No notes for this record.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {sorted.length} note{sorted.length === 1 ? '' : 's'} · most recent open below
        </div>
        <button
          onClick={handleDownloadAll}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800 transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          Download all as markdown
        </button>
      </div>
      {sorted.map((n, i) => (
        <NoteCard key={n.id} note={n} advisorName={advisorName} defaultOpen={i === 0} />
      ))}
      <div className="text-[11px] text-gray-400 dark:text-gray-500 pt-2 flex items-center gap-1">
        <ExternalLink className="w-3 h-3" />
        Notes sourced from sales-coaching DB. Coaching analysis (when present) is collapsed by default.
      </div>
    </div>
  );
}
