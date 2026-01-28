import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getOpenPipelineRecordsByStage } from '@/lib/queries/open-pipeline';
import { getUserPermissions } from '@/lib/permissions';

// Force dynamic rendering (uses headers for authentication)
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = await getUserPermissions(session.user.email);
    // Recruiters are not allowed to access dashboard pipeline endpoints
    if (permissions.role === 'recruiter') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    
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
