import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { getScheduledCallRecords } from '@/lib/queries/sga-activity';
import { logger } from '@/lib/logger';
import { SGAActivityFilters } from '@/types/sga-activity';

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

    if (!['admin', 'manager', 'sga', 'sgm', 'revops_admin'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { filters, callType, weekType, dayOfWeek, sgaName } = body;

    // Use provided filters or create empty filters object
    const queryFilters: SGAActivityFilters = filters || {
      sga: null,
      dateRangeType: 'custom',
      startDate: null,
      endDate: null,
      comparisonDateRangeType: 'last_30',
      comparisonStartDate: null,
      comparisonEndDate: null,
      periodAType: 'this_week',
      periodAStartDate: null,
      periodAEndDate: null,
      periodBType: 'last_30',
      periodBStartDate: null,
      periodBEndDate: null,
      activityTypes: [],
      includeAutomated: true,
      callTypeFilter: 'all_outbound',
    };

    // Apply SGA filter priority:
    // 1. If user is SGA role, use their SGA filter
    // 2. Otherwise, use filters.sga from request (if set)
    // 3. Otherwise, use sgaName parameter (for SGA total clicks)
    let effectiveSgaName: string | undefined = undefined;
    if (permissions.role === 'sga' && permissions.sgaFilter) {
      effectiveSgaName = permissions.sgaFilter;
    } else if (queryFilters.sga) {
      effectiveSgaName = queryFilters.sga;
    } else if (sgaName) {
      effectiveSgaName = sgaName;
    }

    const result = await getScheduledCallRecords(
      queryFilters,
      callType,
      weekType,
      dayOfWeek,
      effectiveSgaName
    );

    return NextResponse.json({ 
      records: result.records,
      total: result.total 
    });
  } catch (error: any) {
    logger.error('Scheduled calls drill-down error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error?.message },
      { status: 500 }
    );
  }
}
