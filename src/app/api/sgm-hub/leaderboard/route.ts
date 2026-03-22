import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { getSGMLeaderboard } from '@/lib/queries/sgm-leaderboard';
import { SGMLeaderboardFilters } from '@/types/sgm-hub';

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
    if (!['admin', 'manager', 'sgm', 'revops_admin'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { startDate, endDate, channels, sources, sgmNames } = body as SGMLeaderboardFilters;

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: 'startDate and endDate are required' },
        { status: 400 }
      );
    }

    if (!channels || !Array.isArray(channels) || channels.length === 0) {
      return NextResponse.json(
        { error: 'At least one channel is required' },
        { status: 400 }
      );
    }

    const filters: SGMLeaderboardFilters = {
      startDate,
      endDate,
      channels,
      sources: sources && sources.length > 0 ? sources : undefined,
      sgmNames: sgmNames && sgmNames.length > 0 ? sgmNames : undefined,
    };

    const entries = await getSGMLeaderboard(filters);

    return NextResponse.json({ entries });

  } catch (error) {
    console.error('[API] Error fetching SGM leaderboard:', error);
    return NextResponse.json(
      { error: 'Failed to fetch SGM leaderboard' },
      { status: 500 }
    );
  }
}
