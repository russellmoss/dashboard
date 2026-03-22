import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { SGMHubContent } from './SGMHubContent';

export const dynamic = 'force-dynamic';

export default async function SGMHubPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect('/login');
  }

  const permissions = getSessionPermissions(session);
  if (!permissions) {
    redirect('/login');
  }

  // Only SGM, admin, manager, and revops_admin roles can access
  if (!['admin', 'manager', 'sgm', 'revops_admin'].includes(permissions.role)) {
    redirect('/dashboard');
  }

  return <SGMHubContent />;
}
