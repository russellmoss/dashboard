'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { REPORT_LABELS } from '@/types/reporting';
import type { ReportType, ReportOutput } from '@/types/reporting';

interface ReportProgressProps {
  jobId: string;
  onComplete: (reportJson: ReportOutput) => void;
  onFailed: (error: string, retryable: boolean) => void;
}

interface JobStatus {
  id: string;
  type: string;
  status: string;
  stepsCompleted: number;
  error: string | null;
  reportJson: ReportOutput | null;
  durationMs: number | null;
  completedAt?: string | null;
}

export function ReportProgress({ jobId, onComplete, onFailed }: ReportProgressProps) {
  const [job, setJob] = useState<JobStatus | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const resolvedRef = useRef(false);

  const pollStatus = useCallback(async () => {
    if (resolvedRef.current) return;

    try {
      const res = await fetch(`/api/reports/${jobId}?t=${Date.now()}`, {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data = await res.json();
      setJob(data);

      if ((data.status === 'complete' || data.completedAt) && data.reportJson) {
        resolvedRef.current = true;
        onComplete(data.reportJson);
      } else if (data.status === 'failed') {
        resolvedRef.current = true;
        onFailed(data.error || 'Report generation failed', true);
      }
    } catch {
      // Silently retry on next poll
    }
  }, [jobId, onComplete, onFailed]);

  useEffect(() => {
    pollStatus(); // Immediate first poll
    const interval = setInterval(pollStatus, 3000);
    return () => clearInterval(interval);
  }, [pollStatus]);

  useEffect(() => {
    const timer = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const status = job?.status ?? 'running';
  const steps = job?.stepsCompleted ?? 0;
  const reportType = job?.type as ReportType | undefined;
  const maxSteps = reportType === 'sgm-analysis' ? 10 :
    reportType === 'competitive-intel' ? 15 : 15;

  const getStatusMessage = () => {
    if (status === 'complete') return 'Report complete!';
    if (status === 'failed') return 'Generation failed';
    if (steps === 0) return 'Initializing agent...';
    if (steps <= maxSteps) return `Analyzing data... Step ${steps} of ~${maxSteps}`;
    return 'Formatting report...';
  };

  const formatElapsed = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  };

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <div className="flex items-center gap-3 mb-4">
        {status === 'running' && (
          <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        )}
        <div>
          <h3 className="font-medium">
            {reportType ? REPORT_LABELS[reportType] : 'Report'} — Generating
          </h3>
          <p className="text-sm text-muted-foreground">{getStatusMessage()}</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-2 bg-muted rounded-full overflow-hidden mb-3">
        <div
          className="h-full bg-primary transition-all duration-500 rounded-full"
          style={{
            width: status === 'complete' ? '100%' :
              `${Math.min(95, (steps / maxSteps) * 80 + 5)}%`,
          }}
        />
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Elapsed: {formatElapsed(elapsed)}</span>
        {steps > 0 && <span>{steps} queries executed</span>}
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>Active job: <span className="font-mono">{jobId}</span></span>
        <a
          href={`/dashboard/reports/${jobId}`}
          className="text-primary hover:underline"
        >
          Open this job
        </a>
      </div>
    </div>
  );
}
