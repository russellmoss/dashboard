import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getOpenPipelineRecordsByStage } from '@/lib/queries/open-pipeline';
import { getSessionPermissions } from '@/types/auth';
import { forbidRecruiter } from '@/lib/api-authz';

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
    
    const body = await request.json();
    const { stage, filters, sgms } = body;
    
    if (!stage) {
      return NextResponse.json(
        { error: 'Stage parameter is required' },
        { status: 400 }
      );
    }
    
    // Apply user's SGM filter selection if provided
    const pipelineFilters = { ...filters };
    if (sgms && sgms.length > 0) {
      pipelineFilters.sgms = sgms;
    }
    
    const records = await getOpenPipelineRecordsByStage(stage, pipelineFilters);
    
    return NextResponse.json({ records, stage });
  } catch (error) {
    console.error('Error fetching pipeline drilldown:', error);
    return NextResponse.json(
      { error: 'Failed to fetch pipeline drilldown' },
      { status: 500 }
    );
  }
}
