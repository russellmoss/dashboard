import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { getJoinedDrillDown } from '@/lib/queries/sgm-leaderboard';
import { getQuarterInfo } from '@/lib/utils/sga-hub-helpers';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }
    if (!['admin', 'manager', 'sgm', 'revops_admin'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const sgmName = searchParams.get('sgmName');
    const quarter = searchParams.get('quarter');
    const channels = searchParams.getAll('channels');
    const sources = searchParams.getAll('sources');

    if (!sgmName) {
      return NextResponse.json({ error: 'sgmName is required' }, { status: 400 });
    }
    if (!quarter) {
      return NextResponse.json({ error: 'quarter is required' }, { status: 400 });
    }

    const quarterInfo = getQuarterInfo(quarter);

    const records = await getJoinedDrillDown(
      sgmName,
      quarterInfo.startDate,
      quarterInfo.endDate,
      {
        channels: channels.length > 0 ? channels : undefined,
        sources: sources.length > 0 ? sources : undefined,
      }
    );

    return NextResponse.json({ records });

  } catch (error) {
    console.error('[API] Error fetching joined drill-down:', error);
    return NextResponse.json(
      { error: 'Failed to fetch joined advisor records' },
      { status: 500 }
    );
  }
}
