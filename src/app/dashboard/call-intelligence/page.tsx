import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import CallIntelligenceClient from './CallIntelligenceClient';
import type { CallIntelligenceTab } from '@/types/call-intelligence';

export const dynamic = 'force-dynamic';

const VALID_TABS: CallIntelligenceTab[] = ['queue', 'settings', 'admin-users', 'admin-refinements'];

export default async function CallIntelligencePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect('/login');

  const permissions = getSessionPermissions(session);
  if (!permissions) redirect('/login');
  if (permissions.role === 'recruiter') redirect('/dashboard/recruiter-hub');
  if (permissions.role === 'capital_partner') redirect('/dashboard/gc-hub');
  if (!permissions.allowedPages.includes(20)) redirect('/dashboard');

  const params = await searchParams;
  const initialTab = (params.tab && (VALID_TABS as string[]).includes(params.tab))
    ? (params.tab as CallIntelligenceTab)
    : undefined;

  return <CallIntelligenceClient role={permissions.role} initialTab={initialTab} />;
}
