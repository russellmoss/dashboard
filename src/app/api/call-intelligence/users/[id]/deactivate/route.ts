import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { revalidateTag } from 'next/cache';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { CACHE_TAGS } from '@/lib/cache';
import {
  salesCoachingClient,
  BridgeAuthError, BridgeTransportError,
  DeactivateBlockedError,
} from '@/lib/sales-coaching-client';

export const dynamic = 'force-dynamic';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isAdmin(role: string) { return role === 'admin' || role === 'revops_admin'; }

export async function POST(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const permissions = getSessionPermissions(session);
    if (!permissions || !isAdmin(permissions.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const result = await salesCoachingClient.deactivateUser(session.user.email, id);
    revalidateTag(CACHE_TAGS.CALL_INTELLIGENCE_QUEUE);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof DeactivateBlockedError) {
      return NextResponse.json({
        error: 'Cannot deactivate — has blocking dependencies',
        blocked_reason: err.blocked_reason,
        blocking_count: err.blocking_count,
        blocking_eval_ids: err.blocking_eval_ids ?? [],
        blocking_rep_ids: err.blocking_rep_ids ?? [],
        requestId: err.requestId,
      }, { status: 409 });
    }
    if (err instanceof BridgeAuthError) return NextResponse.json({ error: err.message, requestId: err.requestId }, { status: err.status });
    if (err instanceof BridgeTransportError) return NextResponse.json({ error: err.message, requestId: err.requestId }, { status: err.status || 500 });
    console.error('[/api/call-intelligence/users/[id]/deactivate] error', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
  }
}
