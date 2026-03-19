'use client';

import type { KeyMetric } from '@/types/reporting';
import { formatReportingValue, isAumLike } from './formatting';

export function KPICardRow({ metrics }: { metrics: KeyMetric[] }) {
  return (
    <div className="kpi-card-row grid grid-cols-2 md:grid-cols-4 gap-4 my-6">
      {metrics.map(metric => (
        <div
          key={metric.id}
          className="rounded-lg border border-border bg-card p-4 shadow-sm"
        >
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {metric.label}
          </p>
          <p className="text-2xl font-bold mt-1">
            {formatReportingValue(metric.value, metric.format, metric.label)}
          </p>
          {metric.delta && (
            <div className="flex items-center gap-1 mt-1.5">
              <span
                className={`text-xs font-medium ${
                  metric.delta.favorable ? 'text-green-600' : 'text-red-600'
                }`}
              >
                {metric.delta.direction === 'up' ? '\u2191' : metric.delta.direction === 'down' ? '\u2193' : '\u2192'}
                {' '}
                {typeof metric.delta.value === 'number'
                  ? isAumLike(metric.label)
                    ? formatReportingValue(Math.abs(metric.delta.value), 'currency', metric.label)
                    : `${Math.abs(metric.delta.value).toFixed(1)}%`
                  : metric.delta.value}
              </span>
              <span className="text-xs text-muted-foreground">
                {metric.delta.label}
              </span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
