'use client';
import type { SfdcSearchMatchT } from '@/lib/sales-coaching-client/schemas';

export function SfdcResultsList({ matches, onPick, isLinking }: { matches: SfdcSearchMatchT[]; onPick: (m: SfdcSearchMatchT) => void; isLinking?: boolean }) {
  if (matches.length === 0) return <p className="text-sm text-gray-500 dark:text-gray-400">No matches.</p>;
  return (
    <ul className="divide-y divide-gray-200 dark:divide-gray-700 border border-gray-200 dark:border-gray-700 rounded-md overflow-hidden">
      {matches.map((m) => (
        <li key={m.id}>
          <button
            type="button"
            onClick={() => onPick(m)}
            disabled={isLinking}
            className="w-full min-h-[44px] px-3 py-2 text-left bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
          >
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{m.name}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 inline-flex gap-2">
              <span>{m.type}</span>
              {m.crd && <span>· CRD {m.crd}</span>}
              {m.owner_email && <span>· {m.owner_email}</span>}
              <span className="ml-auto">score {m.score.toFixed(2)}</span>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
