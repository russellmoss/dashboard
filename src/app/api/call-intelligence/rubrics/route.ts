import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { canEditRubrics } from '@/lib/permissions';
import {
  salesCoachingClient,
  BridgeAuthError, BridgeTransportError, BridgeValidationError,
} from '@/lib/sales-coaching-client';
import {
  CreateRubricRequest,
  RubricRoleSchema,
  RubricStatusSchema,
} from '@/lib/sales-coaching-client/schemas';
import { getRubricsForList } from '@/lib/queries/call-intelligence-rubrics';

export const dynamic = 'force-dynamic';

/**
 * GET /api/call-intelligence/rubrics
 *
 * Returns the listing as { rows: RubricListRow[] }. Calls the LOCAL DB query
 * helper (NOT the bridge) because the listing UI requires `created_by_name`
 * (joined from the reps table) which the bridge's RubricSchema does not include.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const permissions = getSessionPermissions(session);
    if (!permissions || !permissions.allowedPages.includes(20)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!canEditRubrics(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const roleParam = searchParams.get('role');
    const statusParam = searchParams.get('status');

    const role = roleParam ? RubricRoleSchema.safeParse(roleParam) : null;
    const status = statusParam ? RubricStatusSchema.safeParse(statusParam) : null;

    if (roleParam && !role?.success) {
      return NextResponse.json({ error: 'invalid_role' }, { status: 400 });
    }
    if (statusParam && !status?.success) {
      return NextResponse.json({ error: 'invalid_status' }, { status: 400 });
    }

    const rows = await getRubricsForList({
      role: role?.success ? role.data : undefined,
      status: status?.success ? status.data : undefined,
    });

    return NextResponse.json({ rows });
  } catch (err) {
    console.error('[/api/call-intelligence/rubrics GET] error', err);
    return NextResponse.json(
      { error: 'internal_error', message: err instanceof Error ? err.message : 'Failed' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/call-intelligence/rubrics
 *
 * Creates a new draft rubric via the bridge.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const permissions = getSessionPermissions(session);
    if (!permissions || !permissions.allowedPages.includes(20)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!canEditRubrics(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const json = await request.json().catch(() => null);
    const parsed = CreateRubricRequest.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'invalid_request', issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const result = await salesCoachingClient.createRubric(session.user.email, parsed.data);
    return NextResponse.json(result);
  } catch (err) {
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
    console.error('[/api/call-intelligence/rubrics POST] error', err);
    return NextResponse.json(
      { ok: false, error: 'internal_error', message: err instanceof Error ? err.message : 'Failed' },
      { status: 500 },
    );
  }
}
