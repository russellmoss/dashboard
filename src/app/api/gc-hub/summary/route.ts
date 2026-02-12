import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { getGcPeriodSummary } from '@/lib/queries/gc-hub';
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

    // Check GC Hub access (page 16)
    if (!permissions.allowedPages.includes(16)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const { startDate, endDate, accountNames, advisorNames, billingFrequency } = body;

    const summary = await getGcPeriodSummary(permissions, {
      startDate,
      endDate,
      accountNames,
      advisorNames,
      billingFrequency,
    });

    return NextResponse.json({ summary });
  } catch (error) {
    logger.error('Error fetching GC Hub summary:', error);
    return NextResponse.json(
      { error: 'Failed to fetch GC Hub summary' },
      { status: 500 }
    );
  }
}
