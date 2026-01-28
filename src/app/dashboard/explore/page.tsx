import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import ExploreClient from './ExploreClient';

export const dynamic = 'force-dynamic';

export default async function ExplorePage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect('/login');
  }

  const permissions = await getUserPermissions(session.user.email);

  // Recruiters must never access Explore
  if (permissions.role === 'recruiter') {
    redirect('/dashboard/recruiter-hub');
  }

  // Check if user can access Explore (page 10)
  if (!permissions.allowedPages.includes(10)) {
    if (permissions.role === 'sga') {
      redirect('/dashboard/sga-hub');
    }
    redirect('/dashboard');
  }

  return <ExploreClient />;
}
