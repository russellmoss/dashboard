'use client';

import type { Recommendation } from '@/types/reporting';

const PRIORITY_STYLES: Record<string, string> = {
  high: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  low: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
};

const TIMEFRAME_LABELS: Record<string, string> = {
  'immediate': 'Immediate',
  'this-quarter': 'This Quarter',
  'next-quarter': 'Next Quarter',
};

export function Recommendations({ items }: { items: Recommendation[] }) {
  if (items.length === 0) return null;

  return (
    <div className="my-8">
      <h3 className="text-lg font-semibold mb-4">Recommendations</h3>
      <div className="space-y-4">
        {items.map(rec => (
          <div
            key={rec.id}
            className="recommendation-card rounded-lg border border-border bg-card p-5 shadow-sm"
          >
            <div className="flex items-center gap-3 mb-2">
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                  PRIORITY_STYLES[rec.priority] ?? ''
                }`}
              >
                {rec.priority.toUpperCase()}
              </span>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground">
                {rec.category}
              </span>
            </div>
            <h4 className="font-semibold text-base">{rec.title}</h4>
            <p className="text-sm text-muted-foreground mt-1">{rec.rationale}</p>
            <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
              {rec.expectedImpact && (
                <span>Impact: {rec.expectedImpact}</span>
              )}
              <span>Timeframe: {TIMEFRAME_LABELS[rec.timeframe] ?? rec.timeframe}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
