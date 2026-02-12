import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getForecastData, getMonthlyForecastTotals } from '@/lib/queries/forecast';
import { getSessionPermissions } from '@/types/auth';
import { forbidRecruiter, forbidCapitalPartner } from '@/lib/api-authz';
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
    
    // Use permissions from session (derived from JWT, no DB query)
    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }
    // Block recruiters from main dashboard endpoints
    const forbidden = forbidRecruiter(permissions);
    if (forbidden) return forbidden;

    const cpForbidden = forbidCapitalPartner(permissions);
    if (cpForbidden) return cpForbidden;

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
