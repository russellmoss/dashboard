'use client';

import { useCallback, useEffect, useState } from 'react';
import { UserPermissions } from '@/types/user';
import type { ReportOutput, ReportType } from '@/types/reporting';
import { REPORT_LABELS } from '@/types/reporting';
import { ReportDetail } from './components/ReportDetail';
import { ReportGenerator } from './components/ReportGenerator';
import { ReportProgress } from './components/ReportProgress';

interface ReportsClientProps {
  permissions: UserPermissions;
}

type ViewState =
  | { mode: 'generator' }
  | { mode: 'progress'; jobId: string }
  | { mode: 'report'; report: ReportOutput }
  | { mode: 'error'; message: string; retryable: boolean };

interface ReportListItem {
  id: string;
  type: ReportType;
  status: 'running' | 'complete' | 'failed';
  customPrompt: string | null;
  parameters: Record<string, string> | null;
  extractedMetrics: unknown;
  stepsCompleted: number;
  error: string | null;
  durationMs: number | null;
  totalTokens: number | null;
  createdAt: string;
  completedAt: string | null;
}

export default function ReportsClient({ permissions }: ReportsClientProps) {
  const [view, setView] = useState<ViewState>({ mode: 'generator' });
  const [recentReports, setRecentReports] = useState<ReportListItem[]>([]);

  const loadRecentReports = useCallback(async () => {
    try {
      const res = await fetch(`/api/reports?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setRecentReports(Array.isArray(data) ? data : []);
    } catch {
      // Leave existing recent reports in place on transient failure
    }
  }, []);

  useEffect(() => {
    loadRecentReports();
  }, [loadRecentReports]);

  useEffect(() => {
    const hasRunningReport =
      view.mode === 'progress' || recentReports.some(report => report.status === 'running');
    if (!hasRunningReport) return;

    const interval = setInterval(loadRecentReports, 5000);
    return () => clearInterval(interval);
  }, [loadRecentReports, recentReports, view.mode]);

  const handleGenerate = (jobId: string) => {
    setView({ mode: 'progress', jobId });
    void loadRecentReports();
  };

  const handleComplete = (reportJson: ReportOutput) => {
    setView({ mode: 'report', report: reportJson });
    void loadRecentReports();
  };

  const handleFailed = (message: string, retryable: boolean) => {
    setView({ mode: 'error', message, retryable });
    void loadRecentReports();
  };

  const handleBack = () => {
    setView({ mode: 'generator' });
    void loadRecentReports();
  };

  const formatTimestamp = (value: string | null) => {
    if (!value) return null;
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(value));
  };

  const formatDuration = (durationMs: number | null) => {
    if (!durationMs) return null;
    const totalSeconds = Math.round(durationMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  };

  const activeJobId = view.mode === 'progress' ? view.jobId : null;
  const runningReports = recentReports.filter(report => report.status === 'running');
  const completedReports = recentReports.filter(report => report.status === 'complete').slice(0, 6);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Intelligence Reports</h1>
        {view.mode !== 'generator' && (
          <button
            onClick={handleBack}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            &larr; Back to generator
          </button>
        )}
      </div>

      {view.mode === 'generator' && (
        <ReportGenerator onGenerate={handleGenerate} />
      )}

      {view.mode === 'progress' && (
        <ReportProgress
          jobId={view.jobId}
          onComplete={handleComplete}
          onFailed={handleFailed}
        />
      )}

      {view.mode === 'report' && (
        <ReportDetail report={view.report} />
      )}

      {view.mode === 'error' && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-6">
          <h3 className="font-medium text-red-500">Report Generation Failed</h3>
          <p className="text-sm text-muted-foreground mt-1">{view.message}</p>
          <button
            onClick={handleBack}
            className="mt-4 px-4 py-2 text-sm rounded-md border border-border hover:bg-muted"
          >
            Try Again
          </button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-border bg-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Active Job</h2>
            <button
              onClick={() => void loadRecentReports()}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Refresh
            </button>
          </div>

          {activeJobId ? (
            <div className="space-y-2 text-sm">
              <p>
                Currently watching job <span className="font-mono">{activeJobId}</span>
              </p>
              <a
                href={`/dashboard/reports/${activeJobId}`}
                className="text-primary hover:underline"
              >
                Open active job details
              </a>
            </div>
          ) : runningReports.length > 0 ? (
            <div className="space-y-3">
              {runningReports.slice(0, 3).map(report => (
                <div key={report.id} className="rounded-md border border-border p-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">{REPORT_LABELS[report.type]}</div>
                      <div className="text-xs text-muted-foreground font-mono">{report.id}</div>
                    </div>
                    <button
                      onClick={() => setView({ mode: 'progress', jobId: report.id })}
                      className="text-primary hover:underline"
                    >
                      Watch
                    </button>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    Step {report.stepsCompleted} • Started {formatTimestamp(report.createdAt)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No report is currently running.</p>
          )}
        </section>

        <section className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-lg font-semibold mb-4">Recent Completed Reports</h2>
          {completedReports.length === 0 ? (
            <p className="text-sm text-muted-foreground">No completed reports yet.</p>
          ) : (
            <div className="space-y-3">
              {completedReports.map(report => (
                <a
                  key={report.id}
                  href={`/dashboard/reports/${report.id}`}
                  className="block rounded-md border border-border p-3 hover:bg-muted/40"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium text-sm">{REPORT_LABELS[report.type]}</div>
                      <div className="text-xs text-muted-foreground font-mono">{report.id}</div>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <div>{formatTimestamp(report.completedAt) ?? formatTimestamp(report.createdAt)}</div>
                      <div>{formatDuration(report.durationMs) ?? 'duration n/a'}</div>
                    </div>
                  </div>
                </a>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
