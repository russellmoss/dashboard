import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { getActivityBreakdownDrillDown } from '@/lib/queries/sga-activity';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }

    if (!['admin', 'manager', 'sga', 'sgm', 'revops_admin'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    let { sgaName, startDate, endDate, metricType, page = 1, pageSize = 100, search } = body;

    if (!sgaName || !startDate || !endDate) {
      return NextResponse.json({ error: 'sgaName, startDate, and endDate are required' }, { status: 400 });
    }

    if (page < 1) page = 1;

    // SGA role self-filter
    if (permissions.role === 'sga' && permissions.sgaFilter) {
      sgaName = permissions.sgaFilter;
    }

    const result = await getActivityBreakdownDrillDown(
      sgaName,
      startDate,
      endDate,
      metricType || null,
      page,
      pageSize,
      search || undefined
    );

    return NextResponse.json(result);
  } catch (error: any) {
    logger.error('Activity breakdown drilldown error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error?.message },
      { status: 500 }
    );
  }
}
