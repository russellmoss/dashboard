'use client';
import type { SfdcSearchQueryTypeT } from '@/lib/sales-coaching-client/schemas';

const OPTIONS: { value: SfdcSearchQueryTypeT; label: string }[] = [
  { value: 'crd', label: 'CRD' },
  { value: 'email', label: 'Email' },
  { value: 'name', label: 'Name' },
  { value: 'manual_id', label: 'Manual ID' },
];

export function QueryTypeSelector({ value, onChange }: { value: SfdcSearchQueryTypeT; onChange: (v: SfdcSearchQueryTypeT) => void }) {
  return (
    <>
      <div className="hidden md:inline-flex border border-gray-300 dark:border-gray-700 rounded-md overflow-hidden">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`min-h-[44px] px-3 text-sm ${
              value === o.value
                ? 'bg-blue-600 text-white'
                : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as SfdcSearchQueryTypeT)}
        className="md:hidden min-h-[44px] w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 rounded-md px-3 text-sm"
      >
        {OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </>
  );
}
