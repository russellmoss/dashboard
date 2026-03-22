import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { getSgmDashboardMetrics } from '@/lib/queries/sgm-dashboard';

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = ['admin', 'manager', 'sgm', 'revops_admin'];

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
    if (!ALLOWED_ROLES.includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { startDate, endDate, channels, sources, sgmNames } = body;

    if (!startDate || !endDate || !channels || channels.length === 0) {
      return NextResponse.json({ error: 'startDate, endDate, and channels are required' }, { status: 400 });
    }

    // Auto-scope SGM users to their own data if no sgmNames filter provided
    const effectiveSgmNames = permissions.role === 'sgm' && (!sgmNames || sgmNames.length === 0)
      ? [permissions.sgmFilter].filter(Boolean) as string[]
      : sgmNames;

    const metrics = await getSgmDashboardMetrics({
      startDate,
      endDate,
      channels,
      sources,
      sgmNames: effectiveSgmNames,
    });

    return NextResponse.json({ metrics });
  } catch (error) {
    console.error('SGM Dashboard metrics error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
