import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import {
  salesCoachingClient,
  BridgeAuthError, BridgeTransportError, BridgeValidationError,
  EvaluationConflictError, EvaluationNotFoundError,
} from '@/lib/sales-coaching-client';
import { TranscriptCommentCreateRequest } from '@/lib/sales-coaching-client/schemas';
import { getTranscriptComments } from '@/lib/queries/call-intelligence-evaluations';

export const dynamic = 'force-dynamic';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const permissions = getSessionPermissions(session);
    if (!permissions || !permissions.allowedPages.includes(20)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Bucket 2 Q2: managers + admins only. Reps see an empty list rather than 403
    // so the UI renders cleanly. Coaching framing in comments is intentionally
    // private to the manager review process.
    const role = permissions.role;
    if (role !== 'manager' && role !== 'admin' && role !== 'revops_admin') {
      return NextResponse.json({ comments: [] });
    }

    const comments = await getTranscriptComments(id);
    return NextResponse.json({ comments });
  } catch (err) {
    console.error('[/api/call-intelligence/evaluations/[id]/transcript-comments GET] error', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const permissions = getSessionPermissions(session);
    if (!permissions || !permissions.allowedPages.includes(20)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const json = await request.json().catch(() => null);
    const parsed = TranscriptCommentCreateRequest.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'invalid_request', issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const result = await salesCoachingClient.createTranscriptComment(
      session.user.email,
      id,
      parsed.data,
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EvaluationConflictError) {
      return NextResponse.json(
        { ok: false, error: 'evaluation_conflict', message: err.message, requestId: err.requestId },
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
    console.error('[/api/call-intelligence/evaluations/[id]/transcript-comments POST] error', err);
    return NextResponse.json(
      { ok: false, error: 'internal_error', message: err instanceof Error ? err.message : 'Failed' },
      { status: 500 },
    );
  }
}
