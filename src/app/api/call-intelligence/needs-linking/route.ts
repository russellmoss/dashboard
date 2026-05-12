import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { getRepIdByEmail } from '@/lib/queries/call-intelligence-evaluations';
import { getRepIdsVisibleToActor } from '@/lib/queries/call-intelligence/visible-reps';
import { getNeedsLinkingRows } from '@/lib/queries/call-intelligence/needs-linking';

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = ['manager', 'admin', 'revops_admin', 'sgm'] as const;

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const permissions = getSessionPermissions(session);
  if (!permissions) {
    return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
  }

  if (!permissions.allowedPages.includes(20)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (!(ALLOWED_ROLES as readonly string[]).includes(permissions.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const isPrivileged = permissions.role === 'admin' || permissions.role === 'revops_admin';
  const rep = await getRepIdByEmail(session.user.email);

  if (!rep && !isPrivileged) {
    return NextResponse.json({ error: 'Rep not found' }, { status: 403 });
  }

  const actorRepId = rep?.id ?? '';
  const visibleRepIds = await getRepIdsVisibleToActor({
    repId: actorRepId,
    role: permissions.role,
    email: session.user.email,
  });

  const allRepIds = actorRepId && !visibleRepIds.includes(actorRepId)
    ? [actorRepId, ...visibleRepIds]
    : visibleRepIds;

  const { searchParams } = new URL(request.url);
  const showAll = searchParams.get('showAll') === 'true';

  const rows = await getNeedsLinkingRows(allRepIds, showAll);

  return NextResponse.json({ rows, total: rows.length });
}
