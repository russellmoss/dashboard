import { redirect, notFound } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { getSessionUserId } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ReportDetail } from '../components/ReportDetail';
import type { ReportOutput } from '@/types/reporting';

export const dynamic = 'force-dynamic';

export default async function ReportDetailPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect('/login');
  }

  const permissions = getSessionPermissions(session);
  if (!permissions || !permissions.allowedPages.includes(17)) {
    redirect('/dashboard');
  }

  const userId = getSessionUserId(session);
  if (!userId) {
    redirect('/login');
  }

  const report = await prisma.reportJob.findUnique({
    where: { id: params.id },
  });

  if (!report) {
    notFound();
  }

  if (report.requestedById !== userId) {
    redirect('/dashboard');
  }

  if (report.status !== 'complete' || !report.reportJson) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-xl font-bold mb-2">Report not ready</h1>
        <p className="text-muted-foreground text-sm">
          {report.status === 'failed'
            ? report.error || 'Report generation failed.'
            : 'This report is still generating or could not be loaded.'}
        </p>
        <a
          href="/dashboard/reports"
          className="mt-4 inline-block text-sm text-primary hover:underline"
        >
          &larr; Back to reports
        </a>
      </div>
    );
  }

  const reportOutput = report.reportJson as unknown as ReportOutput;

  return (
    <div className="p-6">
      <ReportDetail report={reportOutput} />
    </div>
  );
}
