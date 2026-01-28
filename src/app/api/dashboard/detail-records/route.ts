import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDetailRecords } from '@/lib/queries/detail-records';
import { getUserPermissions } from '@/lib/permissions';
import { DashboardFilters } from '@/types/filters';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = await getUserPermissions(session.user?.email || '');
    // Recruiters are not allowed to access main dashboard endpoints
    if (permissions.role === 'recruiter') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    
    const body = await request.json();
    const filters: DashboardFilters = body.filters;
    const limit = body.limit || 10000; // Reduced default limit to prevent cache errors (2MB limit)
    
    // Note: SGA/SGM filters are NOT automatically applied to main dashboard
    // (Non-recruiter users can see all data on the funnel performance dashboard)
    
    const records = await getDetailRecords(filters, limit);
    
    return NextResponse.json({ records });
  } catch (error) {
    console.error('Detail records error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
