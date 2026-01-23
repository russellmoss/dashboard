import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import SGAActivityContent from './SGAActivityContent';

export const dynamic = 'force-dynamic';

export default async function SGAActivityPage() {
  const session = await getServerSession(authOptions);
  
  if (!session?.user?.email) {
    redirect('/login');
  }
  
  const permissions = await getUserPermissions(session.user.email);
  
  // Only admin, manager, and sga roles can access
  if (!['admin', 'manager', 'sga'].includes(permissions.role)) {
    redirect('/dashboard');
  }
  
  return <SGAActivityContent />;
}
