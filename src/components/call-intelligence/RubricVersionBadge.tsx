import type { ReactNode } from 'react';

interface Props {
  version: number | null;
  name?: string | null;
  dimensionCount?: number | null;
}

/**
 * Small badge that surfaces the rubric version on every overall_score display.
 * Different rubric versions may have different dimension counts, so overall_score
 * lives on a different scale across versions. The tooltip makes the caveat explicit.
 */
export function RubricVersionBadge({
  version,
  name,
  dimensionCount,
}: Props): ReactNode {
  if (version === null) return null;
  const tooltip =
    name && dimensionCount !== null && dimensionCount !== undefined
      ? `This evaluation was scored against rubric v${version} (${name}) which had ${dimensionCount} dimensions. Comparing overall_score across rubric versions can be misleading.`
      : `Rubric v${version}`;
  return (
    <span
      title={tooltip}
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200 cursor-help"
    >
      Rubric v{version}
    </span>
  );
}
