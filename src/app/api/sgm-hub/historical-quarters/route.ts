import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { getSGMHistoricalQuarters } from '@/lib/queries/sgm-quota';

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
    let sgmName = searchParams.get('sgmName');
    const numQuarters = parseInt(searchParams.get('numQuarters') || '8', 10);

    // SGM users can only see their own data
    if (permissions.role === 'sgm' && permissions.sgmFilter) {
      sgmName = permissions.sgmFilter;
    }

    if (!sgmName) {
      return NextResponse.json({ error: 'sgmName is required' }, { status: 400 });
    }

    const quarters = await getSGMHistoricalQuarters(sgmName, numQuarters);
    return NextResponse.json({ quarters });
  } catch (error) {
    console.error('[API] Error fetching SGM historical quarters:', error);
    return NextResponse.json(
      { error: 'Failed to fetch historical quarters' },
      { status: 500 }
    );
  }
}
