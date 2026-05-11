import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { getRepIdByEmail } from '@/lib/queries/call-intelligence-evaluations';
import { getRepIdsVisibleToActor } from '@/lib/queries/call-intelligence/visible-reps';
import { getDimensionHeatmap } from '@/lib/queries/call-intelligence/dimension-heatmap';
import type {
  InsightsDateRange, InsightsRoleFilter, InsightsTrendMode,
} from '@/types/call-intelligence';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDateRange(params: URLSearchParams): InsightsDateRange | { error: string } {
  const range = params.get('range') ?? '30d';
  if (range === '7d' || range === '30d' || range === '90d') {
    return { kind: range };
  }
  if (range === 'custom') {
    const start = params.get('start'); const end = params.get('end');
    if (!start || !end || !DATE_RE.test(start) || !DATE_RE.test(end)) {
      return { error: 'custom range requires start and end as yyyy-mm-dd' };
    }
    return { kind: 'custom', start, end };
  }
  return { error: `invalid range: ${range}` };
}

function parseUuidList(raw: string | null): string[] {
  if (!raw) return [];
  return raw.split(',').map(s => s.trim()).filter(s => UUID_RE.test(s));
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }
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

    const roleRaw = sp.get('role') ?? 'both';
    if (!['SGA', 'SGM', 'both'].includes(roleRaw)) {
      return NextResponse.json({ error: 'invalid role' }, { status: 400 });
    }
    const role = roleRaw as InsightsRoleFilter;

    const podIds = parseUuidList(sp.get('pods'));
    const repIds = parseUuidList(sp.get('reps'));
    const focusRep = sp.get('focus_rep');
    if (focusRep && !UUID_RE.test(focusRep)) {
      return NextResponse.json({ error: 'invalid focus_rep' }, { status: 400 });
    }

    const rubricVersionRaw = sp.get('rubric_version');
    const rubricVersion = rubricVersionRaw && /^\d+$/.test(rubricVersionRaw)
      ? Number(rubricVersionRaw) : null;

    const trendRaw = sp.get('trend') ?? '30d';
    if (trendRaw !== '30d' && trendRaw !== '90d') {
      return NextResponse.json({ error: 'invalid trend' }, { status: 400 });
    }
    const trendMode: InsightsTrendMode = trendRaw;

    const visibleRepIds = await getRepIdsVisibleToActor({
      repId: actorRepId, role: permissions.role, email: session.user.email,
    });

    // Authority gate for focus_rep — return 404 to avoid leaking rep existence
    if (focusRep && !visibleRepIds.includes(focusRep)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const effectiveRepIds = focusRep
      ? [focusRep]
      : (repIds.length > 0 ? repIds : visibleRepIds);

    const result = await getDimensionHeatmap({
      dateRange,
      role,
      podIds,
      repIds: effectiveRepIds,
      rubricVersion,
      visibleRepIds,
      trendMode,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error('[/api/call-intelligence/insights/heatmap] error', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed' },
      { status: 500 },
    );
  }
}
