import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { RecruiterHubContent } from './RecruiterHubContent';

export const dynamic = 'force-dynamic';

export default async function RecruiterHubPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect('/login');
  }

  const permissions = await getUserPermissions(session.user.email);

  // Check if user can access Recruiter Hub (page 12)
  if (!permissions.allowedPages.includes(12)) {
    if (permissions.role === 'sga') {
      redirect('/dashboard/sga-hub');
    }
    redirect('/dashboard');
  }

  return <RecruiterHubContent />;
}
