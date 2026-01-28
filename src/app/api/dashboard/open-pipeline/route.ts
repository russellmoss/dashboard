import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getOpenPipelineRecords, getOpenPipelineSummary } from '@/lib/queries/open-pipeline';
import { getUserPermissions } from '@/lib/permissions';
import { DashboardFilters } from '@/types/filters';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const body = await request.json();
    const filters: Partial<DashboardFilters> = body.filters || {};
    const includeSummary = body.includeSummary || false;
    
    // Apply permission-based filters
    const permissions = await getUserPermissions(session.user?.email || '');
    // Recruiters are not allowed to access dashboard pipeline endpoints
    if (permissions.role === 'recruiter') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const pipelineFilters: {
      channel?: string;
      source?: string;
      sga?: string;
      sgm?: string;
    } = {};
    
    if (filters.channel) pipelineFilters.channel = filters.channel;
    if (filters.source) pipelineFilters.source = filters.source;
    if (permissions.sgaFilter) {
      pipelineFilters.sga = permissions.sgaFilter;
    } else if (filters.sga) {
      pipelineFilters.sga = filters.sga;
    }
    if (permissions.sgmFilter) {
      pipelineFilters.sgm = permissions.sgmFilter;
    } else if (filters.sgm) {
      pipelineFilters.sgm = filters.sgm;
    }
    
    const records = await getOpenPipelineRecords(pipelineFilters);
    
    let summary = null;
    if (includeSummary) {
      summary = await getOpenPipelineSummary();
    }
    
    return NextResponse.json({ records, summary });
  } catch (error) {
    console.error('Open pipeline error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
