// src/app/dashboard/sga-management/page.tsx

import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { SGAManagementContent } from './SGAManagementContent';

export const dynamic = 'force-dynamic';

export default async function SGAManagementPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect('/login');
  }

  // Use permissions from session (derived from JWT, no DB query)
  const permissions = getSessionPermissions(session);
  if (!permissions) {
    redirect('/login');
  }

  // Only admin, manager, and revops_admin can access this page
  if (!['admin', 'manager', 'revops_admin'].includes(permissions.role)) {
    redirect('/dashboard');
  }

  return <SGAManagementContent />;
}
