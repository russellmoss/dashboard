import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { getActivityBreakdownAggregation } from '@/lib/queries/sga-activity';
import { TrailingWeeksOption } from '@/types/sga-activity';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const VALID_TRAILING_WEEKS = [4, 6, 8, 12];

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
    const { trailingWeeks = 4 } = body;

    if (!VALID_TRAILING_WEEKS.includes(trailingWeeks)) {
      return NextResponse.json({ error: 'Invalid trailingWeeks. Must be 4, 6, 8, or 12.' }, { status: 400 });
    }

    // SGA role self-filter
    let sgaName: string | undefined;
    if (permissions.role === 'sga' && permissions.sgaFilter) {
      sgaName = permissions.sgaFilter;
    }

    const result = await getActivityBreakdownAggregation(trailingWeeks as TrailingWeeksOption, sgaName);

    return NextResponse.json(result);
  } catch (error: any) {
    logger.error('Activity breakdown aggregation error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error?.message },
      { status: 500 }
    );
  }
}
