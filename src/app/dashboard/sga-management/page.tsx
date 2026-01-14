// src/app/dashboard/sga-management/page.tsx

import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { SGAManagementContent } from './SGAManagementContent';

export const dynamic = 'force-dynamic';

export default async function SGAManagementPage() {
  const session = await getServerSession(authOptions);
  
  if (!session?.user?.email) {
    redirect('/login');
  }
  
  const permissions = await getUserPermissions(session.user.email);
  
  // Only admin and manager can access this page
  if (!['admin', 'manager'].includes(permissions.role)) {
    redirect('/dashboard');
  }
  
  return <SGAManagementContent />;
}
