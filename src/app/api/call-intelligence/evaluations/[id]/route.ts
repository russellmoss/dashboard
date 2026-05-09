import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { getEvaluationDetail, getRepIdByEmail } from '@/lib/queries/call-intelligence-evaluations';

export const dynamic = 'force-dynamic';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const permissions = getSessionPermissions(session);
    if (!permissions) return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    if (!permissions.allowedPages.includes(20)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const detail = await getEvaluationDetail(id);
    if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (permissions.role !== 'admin' && permissions.role !== 'revops_admin') {
      const rep = await getRepIdByEmail(session.user.email);
      if (!rep) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      const isOwner = detail.rep_id === rep.id;
      const isAssignedManager = detail.assigned_manager_id_snapshot === rep.id;
      if (!isOwner && !isAssignedManager) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return NextResponse.json(detail);
  } catch (err) {
    console.error('[/api/call-intelligence/evaluations/[id]] error', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
  }
}
