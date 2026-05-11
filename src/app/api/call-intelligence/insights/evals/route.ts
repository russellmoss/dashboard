import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { getRepIdByEmail } from '@/lib/queries/call-intelligence-evaluations';
import { getRepIdsVisibleToActor } from '@/lib/queries/call-intelligence/visible-reps';
import { getInsightsEvalsList } from '@/lib/queries/call-intelligence/insights-evals-list';
import type { InsightsDateRange } from '@/types/call-intelligence';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDateRange(params: URLSearchParams): InsightsDateRange | { error: string } {
  const range = params.get('range') ?? '30d';
  if (range === '7d' || range === '30d' || range === '90d') return { kind: range };
  if (range === 'custom') {
    const start = params.get('start'); const end = params.get('end');
    if (!start || !end || !DATE_RE.test(start) || !DATE_RE.test(end)) {
      return { error: 'custom range requires start and end as yyyy-mm-dd' };
    }
    return { kind: 'custom', start, end };
  }
  return { error: `invalid range: ${range}` };
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const permissions = getSessionPermissions(session);
    if (!permissions) return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    if (!permissions.allowedPages.includes(20)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!['manager', 'admin', 'revops_admin'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const isPrivileged = permissions.role === 'admin' || permissions.role === 'revops_admin';
    const rep = await getRepIdByEmail(session.user.email);
    if (!rep && !isPrivileged) {
      return NextResponse.json({ error: 'Rep not found' }, { status: 403 });
    }
    const actorRepId = rep?.id ?? '';

    const sp = request.nextUrl.searchParams;

    const dateRange = parseDateRange(sp);
    if ('error' in dateRange) {
      return NextResponse.json({ error: dateRange.error }, { status: 400 });
    }

    const roleRaw = sp.get('role');
    const role = roleRaw === 'SGA' || roleRaw === 'SGM' ? roleRaw : null;

    const rubricVersionRaw = sp.get('rubric_version');
    const rubricVersion = rubricVersionRaw && /^\d+$/.test(rubricVersionRaw)
      ? Number(rubricVersionRaw) : null;

    const podId = sp.get('pod');
    if (podId && !UUID_RE.test(podId)) {
      return NextResponse.json({ error: 'invalid pod' }, { status: 400 });
    }

    const dimension = sp.get('dimension');

    const focusedRepId = sp.get('rep');
    if (focusedRepId && !UUID_RE.test(focusedRepId)) {
      return NextResponse.json({ error: 'invalid rep' }, { status: 400 });
    }

    const visibleRepIds = await getRepIdsVisibleToActor({
      repId: actorRepId, role: permissions.role, email: session.user.email,
    });

    if (focusedRepId && !visibleRepIds.includes(focusedRepId)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const rows = await getInsightsEvalsList({
      dateRange,
      role,
      rubricVersion,
      podId,
      dimension,
      focusedRepId,
      visibleRepIds,
    });

    return NextResponse.json({ rows });
  } catch (err) {
    console.error('[/api/call-intelligence/insights/evals] error', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed' },
      { status: 500 },
    );
  }
}
