import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { getRepIdByEmail } from '@/lib/queries/call-intelligence-evaluations';
import { getRepIdsVisibleToActor } from '@/lib/queries/call-intelligence/visible-reps';
import { getOpportunityIdentityMap } from '@/lib/queries/opportunity-header';
import { getThreadedCallCounts } from '@/lib/queries/call-intelligence/opportunity-list-counts';
import { getSfdcUserIdToPodMap } from '@/lib/queries/call-intelligence/pods';
import type { OpportunityListRow } from '@/types/call-intelligence-opportunities';

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = ['manager', 'admin', 'revops_admin', 'sgm', 'sga'] as const;

export async function GET(request: Request) {
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

  if (!(ALLOWED_ROLES as readonly string[]).includes(permissions.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const isPrivileged = permissions.role === 'admin' || permissions.role === 'revops_admin' || permissions.role === 'sgm';
  const rep = await getRepIdByEmail(session.user.email);

  if (!rep && !isPrivileged) {
    return NextResponse.json({ error: 'Rep not found' }, { status: 403 });
  }

  const actorRepId = rep?.id ?? '';
  const visibleRepIds = await getRepIdsVisibleToActor({
    repId: actorRepId,
    role: isPrivileged ? 'admin' : permissions.role,
    email: session.user.email,
  });

  const allRepIds = actorRepId && !visibleRepIds.includes(actorRepId)
    ? [actorRepId, ...visibleRepIds]
    : visibleRepIds;

  const [identityMap, podMap] = await Promise.all([
    getOpportunityIdentityMap(),
    getSfdcUserIdToPodMap(),
  ]);

  const counts = await getThreadedCallCounts(identityMap, allRepIds);

  const { searchParams } = new URL(request.url);
  const stageFilter = searchParams.getAll('stage');
  const ownerFilter = searchParams.getAll('owner');
  const podFilter = searchParams.getAll('podId');
  const hasLikelyUnlinked = searchParams.get('hasLikelyUnlinked') === 'true';

  let rows: OpportunityListRow[] = identityMap
    .map((opp) => {
      const c = counts.get(opp.oppId);
      const pod = opp.ownerSfdcId ? podMap.get(opp.ownerSfdcId) : undefined;
      return {
        opportunityId: opp.oppId,
        name: opp.name,
        stageName: opp.stageName,
        daysInStage: opp.daysInStage,
        lastActivityDate: opp.lastActivityDate,
        ownerName: opp.ownerName,
        podId: pod?.podId ?? null,
        podName: pod?.podName ?? null,
        threadedCallCount: c?.total ?? 0,
        likelyUnlinkedCount: c?.likelyUnlinked ?? 0,
        lastCallDate: c?.lastCallDate ?? null,
        granolaCount: c?.granolaCount ?? 0,
        kixieCount: c?.kixieCount ?? 0,
      };
    })
    .filter((r) => r.threadedCallCount > 0);

  if (stageFilter.length > 0) {
    rows = rows.filter((r) => stageFilter.includes(r.stageName));
  }
  if (ownerFilter.length > 0) {
    rows = rows.filter((r) => ownerFilter.includes(r.ownerName));
  }
  if (podFilter.length > 0) {
    rows = rows.filter((r) => r.podId !== null && podFilter.includes(r.podId));
  }
  if (hasLikelyUnlinked) {
    rows = rows.filter((r) => r.likelyUnlinkedCount > 0);
  }

  rows.sort((a, b) => {
    const aDate = a.lastCallDate ?? '';
    const bDate = b.lastCallDate ?? '';
    return bDate.localeCompare(aDate);
  });

  return NextResponse.json({ rows, total: rows.length });
}
