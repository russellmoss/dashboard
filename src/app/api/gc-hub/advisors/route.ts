import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { getGcAdvisorTable } from '@/lib/queries/gc-hub';
import { logger } from '@/lib/logger';

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

    if (!permissions.allowedPages.includes(16)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const {
      startDate, endDate, accountNames, advisorNames,
      billingFrequency, sortBy, sortDir, search
    } = body;

    const records = await getGcAdvisorTable(permissions, {
      startDate, endDate, accountNames, advisorNames,
      billingFrequency, sortBy, sortDir, search,
    });

    return NextResponse.json({
      records,
      count: records.length,
      isAnonymized: permissions.role === 'capital_partner',
    });
  } catch (error) {
    logger.error('Error fetching GC Hub advisors:', error);
    return NextResponse.json(
      { error: 'Failed to fetch advisor data' },
      { status: 500 }
    );
  }
}
