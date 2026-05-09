import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import {
  salesCoachingClient,
  BridgeAuthError, BridgeTransportError,
} from '@/lib/sales-coaching-client';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const permissions = getSessionPermissions(session);
    if (!permissions || !permissions.allowedPages.includes(20)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const result = await salesCoachingClient.listMyContentRefinements(session.user.email);
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
    console.error('[/api/call-intelligence/my-content-refinements GET] error', err);
    return NextResponse.json(
      { ok: false, error: 'internal_error', message: err instanceof Error ? err.message : 'Failed' },
      { status: 500 },
    );
  }
}
