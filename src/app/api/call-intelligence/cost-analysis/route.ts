import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import {
  salesCoachingClient,
  BridgeAuthError,
  BridgeValidationError,
  BridgeTransportError,
} from '@/lib/sales-coaching-client';
import { CostAnalysisRequest } from '@/lib/sales-coaching-client/schemas';

export const dynamic = 'force-dynamic';

function isAdmin(role: string) {
  return role === 'admin' || role === 'revops_admin';
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const permissions = getSessionPermissions(session);
    if (!permissions || !isAdmin(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const startDate = request.nextUrl.searchParams.get('start_date');
    const endDate = request.nextUrl.searchParams.get('end_date');
    const parsed = CostAnalysisRequest.safeParse({ start_date: startDate, end_date: endDate });
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid query params', issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const result = await salesCoachingClient.getCostAnalysis(session.user.email, parsed.data);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof BridgeValidationError) {
      return NextResponse.json(
        { error: err.message, issues: err.issues, requestId: err.requestId },
        { status: 400 },
      );
    }
    if (err instanceof BridgeAuthError) {
      return NextResponse.json(
        { error: err.message, requestId: err.requestId },
        { status: err.status },
      );
    }
    if (err instanceof BridgeTransportError) {
      return NextResponse.json(
        { error: err.message, requestId: err.requestId },
        { status: err.status || 500 },
      );
    }
    console.error('[/api/call-intelligence/cost-analysis GET] error', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed' },
      { status: 500 },
    );
  }
}
