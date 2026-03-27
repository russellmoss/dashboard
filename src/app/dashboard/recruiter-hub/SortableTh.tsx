import { ArrowUp, ArrowDown } from 'lucide-react';
import type { SortDir } from './recruiter-hub-types';

export function SortableTh({
  label,
  sortKey,
  currentKey,
  currentDir,
  onSort,
}: {
  label: string;
  sortKey: string;
  currentKey: string | null;
  currentDir: SortDir;
  onSort: (key: string) => void;
}) {
  return (
    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 dark:text-gray-400">
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="flex items-center gap-1.5 hover:text-gray-700 dark:hover:text-gray-300 group w-full"
      >
        <span>{label}</span>
        <span className="flex flex-col opacity-60 group-hover:opacity-100">
          <ArrowUp
            className={`w-3.5 h-3.5 -mb-0.5 ${currentKey === sortKey && currentDir === 'asc' ? 'text-blue-600 dark:text-blue-400 opacity-100' : ''}`}
            aria-hidden
          />
          <ArrowDown
            className={`w-3.5 h-3.5 ${currentKey === sortKey && currentDir === 'desc' ? 'text-blue-600 dark:text-blue-400 opacity-100' : ''}`}
            aria-hidden
          />
        </span>
      </button>
    </th>
  );
}
