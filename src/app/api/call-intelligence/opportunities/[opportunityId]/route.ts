import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { getRepIdByEmail } from '@/lib/queries/call-intelligence-evaluations';
import { getRepIdsVisibleToActor } from '@/lib/queries/call-intelligence/visible-reps';
import { getOpportunityHeader, getStageAtTimeOfCalls } from '@/lib/queries/opportunity-header';
import { getThreadedTimeline } from '@/lib/queries/call-intelligence/opportunity-timeline';

export const dynamic = 'force-dynamic';

const SFDC_ID_RE = /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/;
const ALLOWED_ROLES = ['manager', 'admin', 'revops_admin', 'sgm', 'sga'] as const;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ opportunityId: string }> },
) {
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

  const { opportunityId } = await params;
  if (!SFDC_ID_RE.test(opportunityId) || !opportunityId.startsWith('006')) {
    return NextResponse.json({ error: 'Invalid Opportunity ID' }, { status: 400 });
  }

  const header = await getOpportunityHeader(opportunityId);
  if (!header) {
    return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 });
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

  const timeline = await getThreadedTimeline(
    opportunityId,
    header.leadId,
    header.contactId,
    allRepIds,
  );

  if (timeline.length === 0 && !isPrivileged) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const callDates = timeline.map((t) => t.callDate);
  const stageMap = await getStageAtTimeOfCalls(opportunityId, callDates);

  const timelineWithStages = timeline.map((row) => ({
    ...row,
    stageAtTimeOfCall: stageMap.get(row.callDate) ?? null,
  }));

  return NextResponse.json({ header, timeline: timelineWithStages });
}
