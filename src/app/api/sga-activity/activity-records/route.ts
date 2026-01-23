import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { getActivityRecords } from '@/lib/queries/sga-activity';
import { SGAActivityFilters, ActivityChannel } from '@/types/sga-activity';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = await getUserPermissions(session.user.email);
    if (!['admin', 'manager', 'sga'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    let filters: SGAActivityFilters = body.filters;
    const { channel, subType, dayOfWeek, activityType, page = 1, pageSize = 100 } = body;

    // Apply SGA filter for non-admin/manager users
    if (permissions.role === 'sga' && permissions.sgaFilter) {
      filters = { ...filters, sga: permissions.sgaFilter };
    }

    const { records, total } = await getActivityRecords(
      filters,
      channel as ActivityChannel | undefined,
      subType,
      dayOfWeek,
      activityType,
      page,
      pageSize
    );

    return NextResponse.json({ records, total, page, pageSize });
  } catch (error: any) {
    logger.error('Activity records drill-down error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error?.message },
      { status: 500 }
    );
  }
}
