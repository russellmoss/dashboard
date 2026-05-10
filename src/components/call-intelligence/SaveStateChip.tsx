'use client';
type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved'; at: Date } | { kind: 'error'; onRetry: () => void };

export function SaveStateChip({ state }: { state: SaveState }) {
  if (state.kind === 'idle') return null;
  if (state.kind === 'saving') return <span className="text-xs text-gray-500 dark:text-gray-400">Saving…</span>;
  if (state.kind === 'saved') {
    const t = state.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved at {t}</span>;
  }
  return (
    <span className="text-xs text-red-600 dark:text-red-400 inline-flex items-center gap-2">
      Failed —
      <button onClick={state.onRetry} className="underline hover:no-underline">retry</button>
    </span>
  );
}
