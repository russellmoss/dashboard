import { redirect, notFound } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import CallIntelligenceClient from './CallIntelligenceClient';
import { getRepIdByEmail } from '@/lib/queries/call-intelligence-evaluations';
import { getRepIdsVisibleToActor } from '@/lib/queries/call-intelligence/visible-reps';
import type { CallIntelligenceTab } from '@/types/call-intelligence';

export const dynamic = 'force-dynamic';

const VALID_TABS: CallIntelligenceTab[] = ['queue', 'settings', 'admin-users', 'admin-refinements', 'rubrics', 'coaching-usage', 'opportunities', 'insights', 'cost-analysis'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CallIntelligencePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; focus_rep?: string; returnTab?: string }>;
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

  // focus_rep authority gate — server-side notFound() to avoid leaking rep existence.
  // Admin/revops_admin short-circuit: don't 403/404 if they lack a coaching reps row.
  let initialFocusRep: string | null = null;
  if (params.focus_rep && UUID_RE.test(params.focus_rep)) {
    const isPrivileged = permissions.role === 'admin' || permissions.role === 'revops_admin';
    const rep = await getRepIdByEmail(session.user.email);
    if (!rep && !isPrivileged) notFound();
    const visibleRepIds = await getRepIdsVisibleToActor({
      repId: rep?.id ?? '',
      role: permissions.role,
      email: session.user.email,
    });
    if (!visibleRepIds.includes(params.focus_rep)) notFound();
    initialFocusRep = params.focus_rep;
  }

  return <CallIntelligenceClient role={permissions.role} initialTab={initialTab} initialFocusRep={initialFocusRep} />;
}
