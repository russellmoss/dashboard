import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { getGcAdvisorDetail } from '@/lib/queries/gc-hub';
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

    // Capital Partners CAN drill into advisors (with anonymized data)
    // The query layer handles anonymization

    const body = await request.json().catch(() => ({}));
    const { advisorName } = body;

    if (!advisorName) {
      return NextResponse.json({ error: 'advisorName is required' }, { status: 400 });
    }

    const detail = await getGcAdvisorDetail(permissions, advisorName);

    if (!detail) {
      return NextResponse.json({ error: 'Advisor not found' }, { status: 404 });
    }

    return NextResponse.json({ advisor: detail });
  } catch (error) {
    logger.error('Error fetching advisor detail:', error);
    return NextResponse.json(
      { error: 'Failed to fetch advisor detail' },
      { status: 500 }
    );
  }
}
