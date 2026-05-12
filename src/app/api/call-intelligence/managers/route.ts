import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import {
  salesCoachingClient,
  BridgeAuthError, BridgeTransportError, BridgeValidationError,
} from '@/lib/sales-coaching-client';

export const dynamic = 'force-dynamic';
function isAdmin(role: string) { return role === 'admin' || role === 'revops_admin'; }

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const permissions = getSessionPermissions(session);
    if (!permissions || !isAdmin(permissions.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const result = await salesCoachingClient.listManagers(session.user.email);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof BridgeValidationError) return NextResponse.json({ error: err.message, issues: err.issues, requestId: err.requestId }, { status: 400 });
    if (err instanceof BridgeAuthError) return NextResponse.json({ error: err.message, requestId: err.requestId }, { status: err.status });
    if (err instanceof BridgeTransportError) return NextResponse.json({ error: err.message, requestId: err.requestId }, { status: err.status || 500 });
    console.error('[/api/call-intelligence/managers GET] error', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
  }
}
