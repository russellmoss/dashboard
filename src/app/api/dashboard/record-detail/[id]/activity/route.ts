// src/app/api/dashboard/record-detail/[id]/activity/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getRecordDetail } from '@/lib/queries/record-detail';
import { getRecordActivity } from '@/lib/queries/record-activity';
import { getSessionPermissions } from '@/types/auth';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: { id: string };
}

export async function GET(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    // Authentication check
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }

    const { id } = params;
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid record ID' }, { status: 400 });
    }

    // Validate ID format (00Q for Lead, 006 for Opportunity, 003 for Contact)
    if (!id.startsWith('00Q') && !id.startsWith('006') && !id.startsWith('003')) {
      return NextResponse.json({ error: 'Invalid record ID format' }, { status: 400 });
    }

    // Fetch the record first to get all linked IDs
    const recruiterFilter = permissions.role === 'recruiter' ? permissions.recruiterFilter : undefined;
    const record = await getRecordDetail(id, recruiterFilter);

    if (!record) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    }

    // Determine the IDs for the activity query.
    // Contact-level rows (advisor-grain Joined/Signed drill-downs) carry the Contact id
    // in record.id. Tasks for that advisor live under WhoId = contactId; team-level
    // Tasks live under WhatId = opportunityId.
    const isContactRecord = id.startsWith('003');
    const leadId = isContactRecord ? null : record.fullProspectId;
    const contactId = isContactRecord ? record.id : null;
    const opportunityId = record.fullOpportunityId;
    const originRecruitingOppId = record.originRecruitingOppId || null;
    const isReEngagement = record.prospectSourceType === 'Re-Engagement';

    const result = await getRecordActivity(
      leadId,
      opportunityId,
      originRecruitingOppId,
      isReEngagement,
      contactId
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error fetching record activity:', error);
    return NextResponse.json(
      { error: 'Failed to fetch record activity' },
      { status: 500 }
    );
  }
}
