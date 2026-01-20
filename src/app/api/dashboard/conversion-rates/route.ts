import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getConversionRates, getConversionTrends } from '@/lib/queries/conversion-rates';
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
    const includeTrends = body.includeTrends || false;
    const granularity = body.granularity || 'month';
    
    // Parse mode parameter (default to 'cohort' for funnel efficiency analysis)
    const mode = (body.mode as 'period' | 'cohort') || 'cohort';
    
    // Validate mode
    if (!['period', 'cohort'].includes(mode)) {
      return NextResponse.json({ error: 'Invalid mode. Must be "period" or "cohort"' }, { status: 400 });
    }
    
    // Note: SGA/SGM filters are NOT automatically applied to main dashboard
    // All users (including SGAs) can see all data on the funnel performance dashboard
    // SGA filters are only applied in SGA Hub features
    
    // Pass mode to getConversionRates()
    const rates = await getConversionRates(filters, mode);
    
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
