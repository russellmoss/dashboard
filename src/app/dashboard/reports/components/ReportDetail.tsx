'use client';

import type { ReportOutput } from '@/types/reporting';
import { REPORT_LABELS } from '@/types/reporting';
import { KPICardRow } from './KPICardRow';
import { ChartRenderer } from './ChartRenderer';
import { TableRenderer } from './TableRenderer';
import { Recommendations } from './Recommendations';

interface ReportDetailProps {
  report: ReportOutput;
}

export function ReportDetail({ report }: ReportDetailProps) {
  return (
    <div className="report-detail max-w-5xl mx-auto">
      {/* Report Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary">
            {REPORT_LABELS[report.reportType] ?? report.reportType}
          </span>
          <span className="text-xs text-muted-foreground">
            {new Date(report.generatedAt).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>
        <h2 className="text-xl font-bold">{report.title}</h2>
        <p className="text-sm text-muted-foreground mt-2">{report.executiveSummary}</p>
      </div>

      {/* KPI Cards */}
      <KPICardRow metrics={report.keyMetrics} />

      {/* Sections */}
      {report.sections.map(section => (
        <div key={section.id} className="report-section my-8">
          <h3 className="text-lg font-semibold mb-3">{section.title}</h3>
          <div className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line mb-4">
            {section.narrative}
          </div>
          {section.charts.map(chart => (
            <ChartRenderer key={chart.id} spec={chart} />
          ))}
          {section.tables.map(table => (
            <TableRenderer key={table.id} spec={table} />
          ))}
          {section.callouts.length > 0 && (
            <KPICardRow metrics={section.callouts} />
          )}
        </div>
      ))}

      {/* Recommendations */}
      <Recommendations items={report.recommendations} />
    </div>
  );
}
