'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@tremor/react';
import type { CallNoteSummaryT } from '@/lib/sales-coaching-client/schemas';
import { LONG_NOTE_CHAR_THRESHOLD } from '@/lib/call-intelligence/note-review-constants';

export function MyPendingNoteReviewsWidget() {
  const [items, setItems] = useState<CallNoteSummaryT[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/call-intelligence/note-reviews', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((j: { items: CallNoteSummaryT[] }) => { if (!cancelled) setItems(j.items); })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, []);

  if (!items || items.length === 0) return null;

  return (
    <Card className="mb-4 dark:bg-gray-800 dark:border-gray-700">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">My pending note reviews</h3>
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {items.map((n) => {
          const ageMin = Math.max(1, Math.round((Date.now() - new Date(n.call_started_at).getTime()) / 60000));
          const ageLabel = ageMin < 60 ? `${ageMin}m ago` : ageMin < 1440 ? `${Math.round(ageMin / 60)}h ago` : `${Math.round(ageMin / 1440)}d ago`;
          const isLong = n.note_char_count > LONG_NOTE_CHAR_THRESHOLD;
          return (
            <li key={n.id}>
              <Link
                href={`/dashboard/call-intelligence/review/${n.id}`}
                className="block min-h-[44px] p-3 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{n.title}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 inline-flex gap-2 mt-1">
                  <span>{n.note_char_count.toLocaleString()} chars{isLong ? ' · long' : ''}</span>
                  <span>· {ageLabel}</span>
                  <span className="ml-auto text-blue-600 dark:text-blue-400">Review →</span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
