// src/app/dashboard/chart-builder/page.tsx
// ═══════════════════════════════════════════════════════════════════════
// CHART BUILDER PAGE
// Embedded Metabase interface for self-serve analytics
// ═══════════════════════════════════════════════════════════════════════

import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { ChartBuilderEmbed } from '@/components/chart-builder/ChartBuilderEmbed';

export const metadata: Metadata = {
  title: 'Chart Builder | Savvy Dashboard',
  description: 'Build custom charts and dashboards with self-serve analytics',
};

export const dynamic = 'force-dynamic';

const PAGE_ID = 14;

export default async function ChartBuilderPage() {
  // Get session and verify authentication
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect('/login');
  }

  // Use permissions from session (derived from JWT, no DB query)
  const permissions = getSessionPermissions(session);

  if (!permissions) {
    redirect('/login');
  }

  // Recruiters must never access Chart Builder
  if (permissions.role === 'recruiter') {
    redirect('/dashboard/recruiter-hub');
  }

  // Check if user can access Chart Builder (page 14)
  if (!permissions.allowedPages.includes(PAGE_ID)) {
    redirect('/dashboard');
  }

  // Get Metabase URL from environment
  const metabaseUrl = process.env.NEXT_PUBLIC_METABASE_SITE_URL;

  if (!metabaseUrl) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-64px)] bg-gray-50 dark:bg-gray-900">
        <div className="text-center p-8 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 max-w-md">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            Chart Builder Not Configured
          </h2>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            Please contact your administrator to configure Metabase integration.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-64px)] w-full">
      <ChartBuilderEmbed metabaseUrl={metabaseUrl} />
    </div>
  );
}
