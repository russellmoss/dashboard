import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { GCHubContent } from './GCHubContent';

export const dynamic = 'force-dynamic';

export default async function GCHubPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect('/login');
  }

  // Use permissions from session (derived from JWT, no DB query)
  const permissions = getSessionPermissions(session);
  if (!permissions) {
    redirect('/login');
  }

  // Check if user can access GC Hub (page 16)
  if (!permissions.allowedPages.includes(16)) {
    // Role-specific redirects
    if (permissions.role === 'recruiter') {
      redirect('/dashboard/recruiter-hub');
    }
    if (permissions.role === 'sga') {
      redirect('/dashboard/sga-hub');
    }
    redirect('/dashboard');
  }

  return <GCHubContent />;
}
