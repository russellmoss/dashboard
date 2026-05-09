import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { getRepIdByEmail } from '@/lib/queries/call-intelligence-evaluations';
import EvalDetailClient from './EvalDetailClient';

export const dynamic = 'force-dynamic';

export default async function EvalDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTab?: string }>;
}) {
  const { id } = await params;
  const { returnTab } = await searchParams;
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect('/login');
  const permissions = getSessionPermissions(session);
  if (!permissions) redirect('/login');
  if (permissions.role === 'recruiter') redirect('/dashboard/recruiter-hub');
  if (permissions.role === 'capital_partner') redirect('/dashboard/gc-hub');
  if (!permissions.allowedPages.includes(20)) redirect('/dashboard');

  // Resolve rep_id once on server so the client can render delete-own-comment UI
  // without needing to fetch a separate /me endpoint. Falls back to null for users
  // (e.g., admins) who aren't registered in the coaching reps table.
  const rep = await getRepIdByEmail(session.user.email);

  return (
    <EvalDetailClient
      id={id}
      role={permissions.role}
      returnTab={returnTab ?? 'queue'}
      currentRepId={rep?.id ?? null}
    />
  );
}
