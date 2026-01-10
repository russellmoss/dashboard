import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getChannelPerformance, getSourcePerformance } from '@/lib/queries/source-performance';
import { getUserPermissions } from '@/lib/permissions';
import { DashboardFilters } from '@/types/filters';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const body = await request.json();
    const filters: DashboardFilters = body.filters;
    const groupBy = body.groupBy || 'source'; // 'channel' or 'source'
    
    // Apply permission-based filters
    const permissions = await getUserPermissions(session.user?.email || '');
    if (permissions.sgaFilter) {
      filters.sga = permissions.sgaFilter;
    }
    if (permissions.sgmFilter) {
      filters.sgm = permissions.sgmFilter;
    }
    
    if (groupBy === 'channel') {
      const channels = await getChannelPerformance(filters);
      return NextResponse.json({ channels });
    } else {
      const sources = await getSourcePerformance(filters);
      return NextResponse.json({ sources });
    }
  } catch (error) {
    console.error('Source performance error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
