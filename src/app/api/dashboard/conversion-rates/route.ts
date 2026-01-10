import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getConversionRates, getConversionTrends } from '@/lib/queries/conversion-rates';
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
    const includeTrends = body.includeTrends || false;
    const granularity = body.granularity || 'month';
    const mode = body.mode || 'period';
    
    // Apply permission-based filters
    const permissions = await getUserPermissions(session.user?.email || '');
    if (permissions.sgaFilter) {
      filters.sga = permissions.sgaFilter;
    }
    if (permissions.sgmFilter) {
      filters.sgm = permissions.sgmFilter;
    }
    
    const rates = await getConversionRates(filters);
    
    let trends = null;
    if (includeTrends) {
      try {
        trends = await getConversionTrends(filters, granularity, mode);
      } catch (trendError) {
        console.error('Conversion trends error:', trendError);
        // Don't fail the whole request if trends fail, just return empty array
        trends = [];
      }
    }
    
    return NextResponse.json({ rates, trends, mode });
  } catch (error) {
    console.error('Conversion rates error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
