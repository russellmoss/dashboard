import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { revalidateTag } from 'next/cache';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { CACHE_TAGS } from '@/lib/cache';
import {
  salesCoachingClient,
  BridgeAuthError, BridgeTransportError, BridgeValidationError,
} from '@/lib/sales-coaching-client';
import { AddCoachingTeamMemberRequest } from '@/lib/sales-coaching-client/schemas';

export const dynamic = 'force-dynamic';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isAdmin(role: string) { return role === 'admin' || role === 'revops_admin'; }

export async function POST(request: NextRequest, ctx: { params: Promise<{ teamId: string }> }) {
  try {
    const { teamId } = await ctx.params;
    if (!UUID_RE.test(teamId)) return NextResponse.json({ error: 'Invalid teamId' }, { status: 400 });
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const permissions = getSessionPermissions(session);
    if (!permissions || !isAdmin(permissions.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const json = await request.json().catch(() => null);
    const parsed = AddCoachingTeamMemberRequest.safeParse(json);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid body', issues: parsed.error.issues }, { status: 400 });

    const result = await salesCoachingClient.addCoachingTeamMember(session.user.email, teamId, parsed.data);
    revalidateTag(CACHE_TAGS.CALL_INTELLIGENCE_QUEUE);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof BridgeValidationError) return NextResponse.json({ error: err.message, issues: err.issues, requestId: err.requestId }, { status: 400 });
    if (err instanceof BridgeAuthError) return NextResponse.json({ error: err.message, requestId: err.requestId }, { status: err.status });
    if (err instanceof BridgeTransportError) return NextResponse.json({ error: err.message, requestId: err.requestId }, { status: err.status || 500 });
    console.error('[/api/call-intelligence/coaching-teams/[teamId]/members POST] error', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
  }
}
