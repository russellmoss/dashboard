import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import OpportunityDetailClient from './OpportunityDetailClient';

export const dynamic = 'force-dynamic';

const SFDC_ID_RE = /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/;
const ALLOWED_ROLES = ['manager', 'admin', 'revops_admin', 'sgm', 'sga'] as const;

export default async function OpportunityDetailPage({
  params,
}: {
  params: Promise<{ opportunityId: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect('/login');

  const permissions = getSessionPermissions(session);
  if (!permissions) redirect('/login');
  if (permissions.role === 'recruiter') redirect('/dashboard/recruiter-hub');
  if (permissions.role === 'capital_partner') redirect('/dashboard/gc-hub');
  if (!permissions.allowedPages.includes(20)) redirect('/dashboard');
  if (!(ALLOWED_ROLES as readonly string[]).includes(permissions.role)) redirect('/dashboard');

  const { opportunityId } = await params;
  if (!SFDC_ID_RE.test(opportunityId) || !opportunityId.startsWith('006')) {
    redirect('/dashboard/call-intelligence?tab=opportunities');
  }

  return (
    <OpportunityDetailClient
      opportunityId={opportunityId}
      role={permissions.role}
    />
  );
}
