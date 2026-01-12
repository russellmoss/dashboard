import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getFunnelMetrics } from '@/lib/queries/funnel-metrics';
import { getAggregateForecastGoals } from '@/lib/queries/forecast-goals';
import { getUserPermissions } from '@/lib/permissions';
import { DashboardFilters } from '@/types/filters';
import { buildDateRangeFromFilters } from '@/lib/utils/date-helpers';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const filters: DashboardFilters = await request.json();
    
    // Apply permission-based filters
    const permissions = await getUserPermissions(session.user?.email || '');
    if (permissions.sgaFilter) {
      filters.sga = permissions.sgaFilter;
    }
    if (permissions.sgmFilter) {
      filters.sgm = permissions.sgmFilter;
    }
    
    // Debug: Log the filters being used
    const { startDate, endDate } = buildDateRangeFromFilters(filters);
    console.log('[Funnel Metrics API] Date range:', { startDate, endDate, datePreset: filters.datePreset, year: filters.year });
    
    // Fetch metrics and goals in parallel
    // Use allSettled so goals failure doesn't break the entire request
    const [metricsResult, goalsResult] = await Promise.allSettled([
      getFunnelMetrics(filters),
      getAggregateForecastGoals(filters).catch((error) => {
        // Log but don't fail - goals are optional
        console.error('[Funnel Metrics API] Forecast goals query failed (non-critical):', error.message || error);
        return null;
      }),
    ]);
    
    // If metrics failed, throw error
    if (metricsResult.status === 'rejected') {
      throw metricsResult.reason;
    }
    
    const metrics = metricsResult.value;
    const goals = goalsResult.status === 'fulfilled' ? goalsResult.value : null;
    
    console.log('[Funnel Metrics API] Goals result:', goals ? `Found goals (SQLs: ${goals.sqls}, SQOs: ${goals.sqos})` : 'No goals');
    
    // Return combined response
    return NextResponse.json({
      ...metrics,
      goals,
    });
  } catch (error) {
    console.error('Funnel metrics error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
