import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { SGAHubContent } from './SGAHubContent';

export const dynamic = 'force-dynamic';

export default async function SGAHubPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect('/login');
  }

  // Use permissions from session (derived from JWT, no DB query)
  const permissions = getSessionPermissions(session);
  if (!permissions) {
    redirect('/login');
  }

  // Only SGA, SGM, admin, manager, and revops_admin roles can access
  if (!['admin', 'manager', 'sga', 'sgm', 'revops_admin'].includes(permissions.role)) {
    redirect('/dashboard');
  }

  return <SGAHubContent />;
}
