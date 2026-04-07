import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import {
  getCachedScheduledInitialCalls,
  getCachedScheduledQualificationCalls,
  getCachedSMSResponseRate,
  getCachedCallAnswerRate,
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

    // Fetch all data in parallel
    const [
      initialCalls,
      qualificationCalls,
      smsResponseRate,
      callAnswerRate,
      totals,
    ] = await Promise.all([
      getCachedScheduledInitialCalls(filters),
      getCachedScheduledQualificationCalls(filters),
      getCachedSMSResponseRate(filters),
      getCachedCallAnswerRate(filters),
      getCachedActivityTotals(filters),
    ]);

    const data: SGAActivityDashboardData = {
      initialCalls,
      qualificationCalls,
      smsResponseRate,
      callAnswerRate,
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
