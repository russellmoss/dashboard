import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { SGAHubContent } from './SGAHubContent';

export const dynamic = 'force-dynamic';

export default async function SGAHubPage() {
  const session = await getServerSession(authOptions);
  
  if (!session?.user?.email) {
    redirect('/login');
  }
  
  const permissions = await getUserPermissions(session.user.email);
  
  // Only SGA, admin, and manager roles can access
  if (!['admin', 'manager', 'sga'].includes(permissions.role)) {
    redirect('/dashboard');
  }
  
  return <SGAHubContent />;
}
