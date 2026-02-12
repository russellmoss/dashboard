import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getFunnelMetrics } from '@/lib/queries/funnel-metrics';
import { getAggregateForecastGoals } from '@/lib/queries/forecast-goals';
import { getSessionPermissions } from '@/types/auth';
import { forbidRecruiter, forbidCapitalPartner } from '@/lib/api-authz';
import { DashboardFilters } from '@/types/filters';
import { ViewMode } from '@/types/dashboard';
import { buildDateRangeFromFilters } from '@/lib/utils/date-helpers';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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

    // Handle both old format (just filters) and new format ({ filters, viewMode })
    const body = await request.json();
    const filters: DashboardFilters = body.filters || body; // Backward compatibility
    const viewMode: ViewMode | undefined = body.viewMode;
    
    // Note: SGA/SGM filters are NOT automatically applied to main dashboard
    // (Non-recruiter users can see all data on the funnel performance dashboard)
    
    const { startDate, endDate } = buildDateRangeFromFilters(filters);
    logger.debug('[Funnel Metrics API] Date range', { startDate, endDate, datePreset: filters.datePreset, year: filters.year, viewMode });
    
    // Fetch metrics and goals in parallel
    // getFunnelMetrics now returns prospects, contacted, mqls (always)
    // getAggregateForecastGoals already includes prospects, mqls, sqls, sqos, joined
    // Use allSettled so goals failure doesn't break the entire request
    const [metricsResult, goalsResult] = await Promise.allSettled([
      getFunnelMetrics(filters),
      getAggregateForecastGoals(filters).catch((error) => {
        // Log but don't fail - goals are optional
        logger.warn('[Funnel Metrics API] Forecast goals query failed (non-critical)', error);
        return null;
      }),
    ]);
    
    // If metrics failed, throw error
    if (metricsResult.status === 'rejected') {
      throw metricsResult.reason;
    }
    
    const metrics = metricsResult.value;
    const goals = goalsResult.status === 'fulfilled' ? goalsResult.value : null;
    
    logger.debug('[Funnel Metrics API] Goals result', { 
      hasGoals: !!goals, 
      sqls: goals?.sqls, 
      sqos: goals?.sqos 
    });
    
    // Return combined response (always includes all fields, frontend decides what to show)
    return NextResponse.json({
      ...metrics,
      goals,
    });
  } catch (error) {
    logger.error('Funnel metrics error', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
