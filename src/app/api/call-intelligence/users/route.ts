import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { revalidateTag } from 'next/cache';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { CACHE_TAGS } from '@/lib/cache';
import { getCoachingUsers } from '@/lib/queries/call-intelligence-users';
import { salesCoachingClient, BridgeAuthError, BridgeValidationError, BridgeTransportError } from '@/lib/sales-coaching-client';
import { CreateUserRequest } from '@/lib/sales-coaching-client/schemas';

export const dynamic = 'force-dynamic';
function isAdmin(role: string) { return role === 'admin' || role === 'revops_admin'; }

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const permissions = getSessionPermissions(session);
    if (!permissions || !isAdmin(permissions.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const includeInactive = request.nextUrl.searchParams.get('includeInactive') === 'true';
    const rows = await getCoachingUsers({ includeInactive });
    return NextResponse.json({ rows });
  } catch (err) {
    console.error('[/api/call-intelligence/users GET] error', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const permissions = getSessionPermissions(session);
    if (!permissions || !isAdmin(permissions.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const json = await request.json().catch(() => null);
    const parsed = CreateUserRequest.safeParse(json);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid body', issues: parsed.error.issues }, { status: 400 });

    const result = await salesCoachingClient.createUser(session.user.email, parsed.data);
    revalidateTag(CACHE_TAGS.CALL_INTELLIGENCE_QUEUE);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof BridgeValidationError) return NextResponse.json({ error: err.message, issues: err.issues, requestId: err.requestId }, { status: 400 });
    if (err instanceof BridgeAuthError) return NextResponse.json({ error: err.message, requestId: err.requestId }, { status: err.status });
    if (err instanceof BridgeTransportError) return NextResponse.json({ error: err.message, requestId: err.requestId }, { status: err.status || 500 });
    console.error('[/api/call-intelligence/users POST] error', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
  }
}
