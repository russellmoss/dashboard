// src/app/api/sga-hub/drill-down/open-sqls/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { getOpenSQLDrillDown } from '@/lib/queries/drill-down';
import { getQuarterInfo } from '@/lib/utils/sga-hub-helpers';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Check authentication
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

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const sgaName = searchParams.get('sgaName');
    const quarter = searchParams.get('quarter');
    const channels = searchParams.getAll('channels');
    const sources = searchParams.getAll('sources');

    if (!sgaName) {
      return NextResponse.json({ error: 'Missing required parameter: sgaName' }, { status: 400 });
    }
    if (!quarter) {
      return NextResponse.json({ error: 'Missing required parameter: quarter' }, { status: 400 });
    }

    // Convert quarter to date range
    const quarterInfo = getQuarterInfo(quarter);
    const startDate = quarterInfo.startDate;
    const endDate = quarterInfo.endDate;

    // Fetch drill-down records
    const records = await getOpenSQLDrillDown(
      sgaName,
      startDate,
      endDate,
      {
        channels: channels.length > 0 ? channels : undefined,
        sources: sources.length > 0 ? sources : undefined,
      }
    );

    return NextResponse.json({ records });
  } catch (error) {
    console.error('Error fetching Open SQL drill-down:', error);
    return NextResponse.json(
      { error: 'Failed to fetch Open SQL records' },
      { status: 500 }
    );
  }
}
