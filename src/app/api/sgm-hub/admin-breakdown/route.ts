import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { getSGMAdminBreakdown } from '@/lib/queries/sgm-quota';
import { SGMQuotaFilters } from '@/types/sgm-hub';

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
    if (!['admin', 'revops_admin'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json() as SGMQuotaFilters;
    const { quarter } = body;

    if (!quarter) {
      return NextResponse.json({ error: 'quarter is required' }, { status: 400 });
    }

    const breakdown = await getSGMAdminBreakdown(quarter, body);
    return NextResponse.json({ breakdown });
  } catch (error) {
    console.error('[API] Error fetching SGM admin breakdown:', error);
    return NextResponse.json(
      { error: 'Failed to fetch admin breakdown' },
      { status: 500 }
    );
  }
}
