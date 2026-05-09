import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import {
  salesCoachingClient,
  BridgeAuthError, BridgeTransportError, BridgeValidationError,
  ContentRefinementDuplicateError, EvaluationNotFoundError,
} from '@/lib/sales-coaching-client';
import { ContentRefinementCreateRequest } from '@/lib/sales-coaching-client/schemas';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const permissions = getSessionPermissions(session);
    if (!permissions || !permissions.allowedPages.includes(20)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const json = await request.json().catch(() => null);
    const parsed = ContentRefinementCreateRequest.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'invalid_request', issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const result = await salesCoachingClient.submitContentRefinement(session.user.email, parsed.data);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ContentRefinementDuplicateError) {
      return NextResponse.json(
        { ok: false, error: 'content_refinement_duplicate', message: err.message, requestId: err.requestId },
        { status: 409 },
      );
    }
    if (err instanceof EvaluationNotFoundError) {
      return NextResponse.json(
        { ok: false, error: 'evaluation_not_found', requestId: err.requestId },
        { status: 404 },
      );
    }
    if (err instanceof BridgeValidationError) {
      return NextResponse.json(
        { ok: false, error: 'invalid_request', issues: err.issues, requestId: err.requestId },
        { status: 400 },
      );
    }
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
    console.error('[/api/call-intelligence/content-refinements POST] error', err);
    return NextResponse.json(
      { ok: false, error: 'internal_error', message: err instanceof Error ? err.message : 'Failed' },
      { status: 500 },
    );
  }
}
