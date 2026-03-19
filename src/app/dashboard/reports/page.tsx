import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import ReportsClient from './ReportsClient';

export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect('/login');
  }

  const permissions = getSessionPermissions(session);
  if (!permissions) {
    redirect('/login');
  }

  if (!permissions.allowedPages.includes(17)) {
    redirect('/dashboard');
  }

  return <ReportsClient permissions={permissions} />;
}
