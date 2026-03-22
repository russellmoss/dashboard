import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { getSGMTeamProgress } from '@/lib/queries/sgm-quota';
import { getCurrentQuarter } from '@/lib/utils/sga-hub-helpers';

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
    if (!['admin', 'revops_admin'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const quarter = searchParams.get('quarter') || getCurrentQuarter();

    const progress = await getSGMTeamProgress(quarter);
    return NextResponse.json({ progress });
  } catch (error) {
    console.error('[API] Error fetching SGM team progress:', error);
    return NextResponse.json(
      { error: 'Failed to fetch team progress' },
      { status: 500 }
    );
  }
}
