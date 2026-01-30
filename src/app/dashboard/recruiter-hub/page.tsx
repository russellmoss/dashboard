import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { RecruiterHubContent } from './RecruiterHubContent';

export const dynamic = 'force-dynamic';

export default async function RecruiterHubPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect('/login');
  }

  // Use permissions from session (derived from JWT, no DB query)
  const permissions = getSessionPermissions(session);
  if (!permissions) {
    redirect('/login');
  }

  // Check if user can access Recruiter Hub (page 12)
  if (!permissions.allowedPages.includes(12)) {
    if (permissions.role === 'sga') {
      redirect('/dashboard/sga-hub');
    }
    redirect('/dashboard');
  }

  return <RecruiterHubContent />;
}
