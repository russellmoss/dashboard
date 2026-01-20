import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getForecastData, getMonthlyForecastTotals } from '@/lib/queries/forecast';
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
    const filters: DashboardFilters = body.filters;
    const monthKey = body.monthKey;
    
    // Apply permission-based filters
    const permissions = await getUserPermissions(session.user?.email || '');
    if (permissions.sgaFilter) {
      filters.sga = permissions.sgaFilter;
    }
    if (permissions.sgmFilter) {
      filters.sgm = permissions.sgmFilter;
    }
    
    if (monthKey) {
      const totals = await getMonthlyForecastTotals(monthKey);
      return NextResponse.json({ totals });
    } else {
      const forecastData = await getForecastData(filters);
      return NextResponse.json({ forecast: forecastData });
    }
  } catch (error) {
    console.error('Forecast error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
