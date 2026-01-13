import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDetailRecords } from '@/lib/queries/detail-records';
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
    const limit = body.limit || 50000; // Increased default limit to fetch all records
    
    // Apply permission-based filters
    const permissions = await getUserPermissions(session.user?.email || '');
    if (permissions.sgaFilter) {
      filters.sga = permissions.sgaFilter;
    }
    if (permissions.sgmFilter) {
      filters.sgm = permissions.sgmFilter;
    }
    
    const records = await getDetailRecords(filters, limit);
    
    return NextResponse.json({ records });
  } catch (error) {
    console.error('Detail records error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
