import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDetailRecords } from '@/lib/queries/detail-records';
import { getUserPermissions } from '@/lib/permissions';
import { forbidRecruiter } from '@/lib/api-authz';
import { DashboardFilters } from '@/types/filters';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = await getUserPermissions(session.user?.email || '');
    // Block recruiters from main dashboard endpoints
    const forbidden = forbidRecruiter(permissions);
    if (forbidden) return forbidden;
    
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
