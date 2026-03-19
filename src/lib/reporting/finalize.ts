import { prisma } from '@/lib/prisma';
import { sendReportReadyEmail } from '@/lib/email';
import { REPORT_LABELS } from '@/types/reporting';
import type { ReportOutput } from '@/types/reporting';
import { logger } from '@/lib/logger';

export async function notifyReportComplete(jobId: string, userEmail: string) {
  try {
    logger.info('[report-job] notify.lookup.begin', { jobId, userEmail });
    const job = await prisma.reportJob.findUnique({ where: { id: jobId } });
    if (!job?.reportJson) {
      logger.warn('[report-job] notify.lookup.missing-report', { jobId, userEmail });
      return;
    }

    const reportJson = job.reportJson as unknown as ReportOutput;
    const reportTitle = REPORT_LABELS[job.type as keyof typeof REPORT_LABELS] || job.type;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000';
    const reportUrl = `${appUrl}/dashboard/reports/${job.id}`;

    logger.info('[report-job] notify.email.begin', {
      jobId,
      userEmail,
      reportTitle,
    });

    await sendReportReadyEmail(
      userEmail,
      reportTitle,
      reportJson.executiveSummary,
      reportUrl
    );
    logger.info('[report-job] notify.email.complete', { jobId, userEmail });
  } catch (error) {
    logger.error('[notifyReportComplete] Failed to send email', error);
    // Non-blocking — report is already saved
  }
}
