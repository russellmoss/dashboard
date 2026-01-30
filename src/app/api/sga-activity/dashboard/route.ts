import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import {
  getCachedScheduledInitialCalls,
  getCachedScheduledQualificationCalls,
  getCachedActivityDistribution,
  getCachedSMSResponseRate,
  getCachedCallAnswerRate,
  getCachedActivityBreakdown,
  getCachedActivityTotals,
} from '@/lib/queries/sga-activity';
import { SGAActivityFilters, SGAActivityDashboardData } from '@/types/sga-activity';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Use permissions from session (derived from JWT, no DB query)
    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }

    // Check page access - allow admin, manager, sga, and revops_admin roles
    if (!['admin', 'manager', 'sga', 'sgm', 'revops_admin'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    let filters: SGAActivityFilters = body.filters;

    // Apply SGA filter for non-admin/manager users
    if (permissions.role === 'sga' && permissions.sgaFilter) {
      filters = { ...filters, sga: permissions.sgaFilter };
    }

    // Create separate filters for Activity Distribution (uses Period A/B if set)
    // Note: comparisonDateRangeType doesn't support 'this_week' or 'next_week', so we map Period B to supported types
    const periodBType = filters.periodBType || filters.comparisonDateRangeType;
    const mappedPeriodBType = (periodBType === 'this_week' || periodBType === 'next_week') 
      ? 'last_30' 
      : periodBType as 'last_30' | 'last_60' | 'last_90' | 'qtd' | 'all_time' | 'custom';
    
    const activityDistributionFilters: SGAActivityFilters = {
      ...filters,
      // Use Period A/B for Activity Distribution if they're set, otherwise use main filters
      dateRangeType: filters.periodAType || filters.dateRangeType,
      startDate: filters.periodAStartDate || filters.startDate,
      endDate: filters.periodAEndDate || filters.endDate,
      comparisonDateRangeType: mappedPeriodBType,
      comparisonStartDate: filters.periodBStartDate || filters.comparisonStartDate,
      comparisonEndDate: filters.periodBEndDate || filters.comparisonEndDate,
    };

    // Fetch all data in parallel
    // Main queries use main filters, Activity Distribution uses Period A/B filters
    const [
      initialCalls,
      qualificationCalls,
      activityDistribution,
      smsResponseRate,
      callAnswerRate,
      activityBreakdown,
      totals,
    ] = await Promise.all([
      getCachedScheduledInitialCalls(filters),
      getCachedScheduledQualificationCalls(filters),
      getCachedActivityDistribution(activityDistributionFilters),
      getCachedSMSResponseRate(filters),
      getCachedCallAnswerRate(filters),
      getCachedActivityBreakdown(filters),
      getCachedActivityTotals(filters),
    ]);

    const data: SGAActivityDashboardData = {
      initialCalls,
      qualificationCalls,
      activityDistribution,
      smsResponseRate,
      callAnswerRate,
      activityBreakdown,
      totals,
    };

    return NextResponse.json(data);
  } catch (error: any) {
    logger.error('SGA Activity Dashboard error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error?.message },
      { status: 500 }
    );
  }
}
