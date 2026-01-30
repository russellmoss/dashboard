import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import SGAActivityContent from './SGAActivityContent';

export const dynamic = 'force-dynamic';

export default async function SGAActivityPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect('/login');
  }

  // Use permissions from session (derived from JWT, no DB query)
  const permissions = getSessionPermissions(session);
  if (!permissions) {
    redirect('/login');
  }

  // Only admin, manager, sga, sgm, and revops_admin roles can access
  if (!['admin', 'manager', 'sga', 'sgm', 'revops_admin'].includes(permissions.role)) {
    redirect('/dashboard');
  }

  return <SGAActivityContent />;
}
