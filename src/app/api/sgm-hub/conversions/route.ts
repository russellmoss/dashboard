import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { getSgmConversionCohortData } from '@/lib/queries/sgm-dashboard';

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
    const { sgmNames, dateRange } = body;

    // Auto-scope SGM users
    const effectiveSgms = permissions.role === 'sgm' && (!sgmNames || sgmNames.length === 0)
      ? [permissions.sgmFilter].filter(Boolean) as string[]
      : sgmNames;

    const data = await getSgmConversionCohortData({
      sgms: effectiveSgms,
      dateRange: dateRange || null,
    });

    return NextResponse.json({ data });
  } catch (error) {
    console.error('SGM Hub conversions error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
