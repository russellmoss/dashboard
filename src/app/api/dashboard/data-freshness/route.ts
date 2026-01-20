import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDataFreshness } from '@/lib/queries/data-freshness';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Check authentication (following pattern from other dashboard API routes)
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const freshness = await getDataFreshness();

    return NextResponse.json(freshness);
  } catch (error) {
    logger.error('Error fetching data freshness:', error);
    return NextResponse.json(
      { error: 'Failed to fetch data freshness' },
      { status: 500 }
    );
  }
}
