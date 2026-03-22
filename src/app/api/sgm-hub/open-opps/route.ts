import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { getSGMOpenOpportunities } from '@/lib/queries/sgm-quota';

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

    // SGM users can only see their own data
    if (permissions.role === 'sgm' && permissions.sgmFilter) {
      sgmName = permissions.sgmFilter;
    }

    if (!sgmName) {
      return NextResponse.json({ error: 'sgmName is required' }, { status: 400 });
    }

    const opps = await getSGMOpenOpportunities(sgmName);
    return NextResponse.json({ opps });
  } catch (error) {
    console.error('[API] Error fetching SGM open opps:', error);
    return NextResponse.json(
      { error: 'Failed to fetch open opportunities' },
      { status: 500 }
    );
  }
}
