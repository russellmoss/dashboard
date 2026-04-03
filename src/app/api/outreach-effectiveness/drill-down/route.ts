import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import {
  getOutreachLeadDrillDown,
  getZeroTouchDrillDown,
  getWeeklyCallsDrillDown,
} from '@/lib/queries/outreach-effectiveness';
import { OutreachEffectivenessFilters } from '@/types/outreach-effectiveness';
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
    const {
      type,
      filters: rawFilters,
      sgaName,
      statusFilter,
      columnFilter,
      page = 1,
      pageSize = 100,
    } = body;

    let filters: OutreachEffectivenessFilters = rawFilters;

    // SGA role: force filter to own name
    if (permissions.role === 'sga' && permissions.sgaFilter) {
      filters = { ...filters, sga: permissions.sgaFilter };
    }

    switch (type) {
      case 'leads': {
        const result = await getOutreachLeadDrillDown(filters, sgaName, statusFilter, page, pageSize, columnFilter);
        return NextResponse.json(result);
      }
      case 'zero-touch': {
        const result = await getZeroTouchDrillDown(filters, sgaName, page, pageSize);
        return NextResponse.json(result);
      }
      case 'weekly-calls': {
        const result = await getWeeklyCallsDrillDown(filters, sgaName);
        return NextResponse.json(result);
      }
      default:
        return NextResponse.json({ error: 'Invalid drill-down type' }, { status: 400 });
    }
  } catch (error: any) {
    logger.error('Outreach Effectiveness drill-down error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error?.message },
      { status: 500 }
    );
  }
}
