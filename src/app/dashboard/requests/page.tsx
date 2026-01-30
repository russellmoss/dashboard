import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { RequestsPageContent } from './RequestsPageContent';

export const dynamic = 'force-dynamic';

export default async function DashboardRequestsPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect('/login');
  }

  // Use permissions from session (derived from JWT, no DB query)
  const permissions = getSessionPermissions(session);
  if (!permissions) {
    redirect('/login');
  }

  // Block recruiter role - they don't have access to page 13
  if (permissions.role === 'recruiter') {
    redirect('/dashboard/recruiter-hub');
  }

  // Check if user has access to page 13
  if (!permissions.allowedPages.includes(13)) {
    redirect('/dashboard');
  }

  return (
    <RequestsPageContent
      canManageRequests={permissions.canManageRequests}
      userRole={permissions.role}
    />
  );
}
