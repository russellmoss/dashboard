import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import {
  salesCoachingClient,
  BridgeAuthError, BridgeTransportError,
} from '@/lib/sales-coaching-client';

export const dynamic = 'force-dynamic';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const permissions = getSessionPermissions(session);
    if (!permissions || !permissions.allowedPages.includes(20)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const result = await salesCoachingClient.deleteTranscriptComment(session.user.email, id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof BridgeAuthError) {
      return NextResponse.json(
        { ok: false, error: 'role_forbidden', message: err.message, requestId: err.requestId },
        { status: err.status },
      );
    }
    if (err instanceof BridgeTransportError) {
      return NextResponse.json(
        { ok: false, error: 'upstream_error', message: err.message, requestId: err.requestId },
        { status: err.status || 502 },
      );
    }
    console.error('[/api/call-intelligence/transcript-comments/[id] DELETE] error', err);
    return NextResponse.json(
      { ok: false, error: 'internal_error', message: err instanceof Error ? err.message : 'Failed' },
      { status: 500 },
    );
  }
}
