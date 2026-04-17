// src/app/dashboard/advisor-map/page.tsx
// ═══════════════════════════════════════════════════════════════════════
// ADVISOR MAP PAGE
// Geographic visualization of joined advisors
// ═══════════════════════════════════════════════════════════════════════

import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { AdvisorMap } from '@/components/advisor-map';

export const metadata: Metadata = {
  title: 'Advisor Map | Savvy Dashboard',
  description: 'Geographic visualization of joined advisor locations',
};

export const dynamic = 'force-dynamic';

const PAGE_ID = 15;

export default async function AdvisorMapPage() {
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

  // Recruiters must never access Advisor Map
  if (permissions.role === 'recruiter') {
    redirect('/dashboard/recruiter-hub');
  }

  // Check if user can access Advisor Map (page 15)
  if (!permissions.allowedPages.includes(PAGE_ID)) {
    redirect('/dashboard');
  }

  // h-[calc(100vh-7rem)] = viewport minus Header (h-16 = 4rem) minus main's p-6 top+bottom (3rem)
  // The -m-6 cancels main's p-6 so this page can claim its own padding and full height.
  return (
    <div className="-m-6 p-6 flex flex-col gap-6 h-[calc(100vh-4rem)]">
      <div className="flex items-center justify-between flex-none">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Advisor Map
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Geographic distribution of joined advisors across the United States
          </p>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <AdvisorMap />
      </div>
    </div>
  );
}
