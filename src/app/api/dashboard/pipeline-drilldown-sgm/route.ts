import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getOpenPipelineRecordsBySgm } from '@/lib/queries/open-pipeline';
import { getSessionPermissions } from '@/types/auth';
import { forbidRecruiter, forbidCapitalPartner } from '@/lib/api-authz';

// Force dynamic rendering (uses headers for authentication)
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Use permissions from session (derived from JWT, no DB query)
    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }
    // Block recruiters from dashboard pipeline endpoints
    const forbidden = forbidRecruiter(permissions);
    if (forbidden) return forbidden;

    const cpForbidden = forbidCapitalPartner(permissions);
    if (cpForbidden) return cpForbidden;

    const body = await request.json();
    const { sgm, stages, sgms } = body;

    if (!sgm) {
      return NextResponse.json(
        { error: 'SGM parameter is required' },
        { status: 400 }
      );
    }

    const records = await getOpenPipelineRecordsBySgm(sgm, stages, sgms);

    return NextResponse.json({ records, sgm });
  } catch (error) {
    console.error('Error fetching SGM drilldown:', error);
    return NextResponse.json(
      { error: 'Failed to fetch SGM drilldown' },
      { status: 500 }
    );
  }
}
