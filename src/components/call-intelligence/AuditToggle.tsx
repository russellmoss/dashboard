'use client';

import type { EvaluationDetail } from '@/types/call-intelligence';

interface Props {
  evaluation: EvaluationDetail;
  enabled: boolean;
  onToggle: () => void;
}

const SUPPORTED_VERSIONS = [2, 3, 4, 5];

export function AuditToggle({ evaluation, enabled, onToggle }: Props) {
  const v = evaluation.ai_original_schema_version;
  const supported = v !== null && SUPPORTED_VERSIONS.includes(v);

  return (
    <div className="flex items-center gap-2">
      <label className="inline-flex items-center cursor-pointer">
        <input type="checkbox" checked={enabled} onChange={onToggle} className="sr-only peer" />
        <div className="relative w-9 h-5 bg-gray-200 dark:bg-gray-700 peer-checked:bg-blue-600 rounded-full peer transition-colors">
          <div
            className={`absolute top-0.5 ${enabled ? 'left-5' : 'left-0.5'} h-4 w-4 bg-white rounded-full transition-all`}
          />
        </div>
        <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">
          Audit: show original AI output
        </span>
      </label>
      {!supported && enabled && (
        <span className="text-xs text-amber-600 dark:text-amber-400">
          Schema v{v ?? '—'} not supported in renderer
        </span>
      )}
    </div>
  );
}
