import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSgmConversionData } from '@/lib/queries/open-pipeline';
import { getSessionPermissions } from '@/types/auth';
import { forbidRecruiter, forbidCapitalPartner } from '@/lib/api-authz';

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

    const forbidden = forbidRecruiter(permissions);
    if (forbidden) return forbidden;

    const cpForbidden = forbidCapitalPartner(permissions);
    if (cpForbidden) return cpForbidden;

    // revops_admin only
    if (permissions.role !== 'revops_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { sgms, dateRange } = body;

    const data = await getSgmConversionData({ sgms, dateRange });

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Error fetching SGM conversions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch SGM conversions' },
      { status: 500 }
    );
  }
}
