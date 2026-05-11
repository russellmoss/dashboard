import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { getRepIdByEmail } from '@/lib/queries/call-intelligence-evaluations';
import { getRepIdsVisibleToActor } from '@/lib/queries/call-intelligence/visible-reps';
import { getActivePodsVisibleToActor } from '@/lib/queries/call-intelligence/pods';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
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
    if (!['manager', 'admin', 'revops_admin'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const isPrivileged = permissions.role === 'admin' || permissions.role === 'revops_admin';
    const rep = await getRepIdByEmail(session.user.email);
    if (!rep && !isPrivileged) {
      return NextResponse.json({ error: 'Rep not found' }, { status: 403 });
    }
    const actorRepId = rep?.id ?? '';

    const visibleRepIds = await getRepIdsVisibleToActor({
      repId: actorRepId, role: permissions.role, email: session.user.email,
    });

    const pods = await getActivePodsVisibleToActor(visibleRepIds);
    return NextResponse.json({ pods });
  } catch (err) {
    console.error('[/api/call-intelligence/insights/pods] error', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed' },
      { status: 500 },
    );
  }
}
