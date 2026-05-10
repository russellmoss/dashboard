import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { canEditRubrics } from '@/lib/permissions';
import { salesCoachingClient } from '@/lib/sales-coaching-client';
import {
  getRubricsForList,
  isSystemRubric,
} from '@/lib/queries/call-intelligence-rubrics';
import { RubricEditorClient } from './RubricEditorClient';
import type { RubricRoleT } from '@/lib/sales-coaching-client/schemas';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function RubricEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ role?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect('/login');
  const permissions = getSessionPermissions(session);
  if (!permissions) redirect('/login');
  if (permissions.role === 'recruiter') redirect('/dashboard/recruiter-hub');
  if (permissions.role === 'capital_partner') redirect('/dashboard/gc-hub');
  if (!permissions.allowedPages.includes(20)) redirect('/dashboard');
  if (!canEditRubrics(permissions.role)) redirect('/dashboard');

  const email = session.user.email;
  const { id } = await params;
  const sp = await searchParams;

  if (id === 'new') {
    const role: RubricRoleT = sp.role === 'SGM' ? 'SGM' : 'SGA';
    // Q1 (council): seed from current active rubric for this role; falls back to
    // blank if no active exists.
    const active = await getRubricsForList({ role, status: 'active' });
    const seed = active[0] ?? null;
    return (
      <RubricEditorClient
        mode="new"
        role={role}
        email={email}
        seedFromActive={seed}
      />
    );
  }

  if (!UUID_RE.test(id)) redirect('/dashboard/call-intelligence?tab=rubrics');

  const { rubric } = await salesCoachingClient.getRubric(email, id);
  // Q4 (council): system rubrics open in read-only View mode regardless of status.
  const isSystem = await isSystemRubric(rubric.id);
  return (
    <RubricEditorClient
      mode="edit"
      rubric={rubric}
      email={email}
      readOnlyReason={isSystem ? 'system' : null}
    />
  );
}
