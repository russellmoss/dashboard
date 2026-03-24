import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { getDateRevisionMap } from '@/lib/queries/forecast-date-revisions';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }

    const revisionMap = await getDateRevisionMap();

    // Serialize Map to plain object for JSON response
    const revisions: Record<string, { revisionCount: number; firstDateSet: string | null; dateConfidence: string }> = {};
    for (const [oppId, info] of revisionMap) {
      revisions[oppId] = info;
    }

    return NextResponse.json({ revisions });
  } catch (error) {
    console.error('Date revisions error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch date revisions' },
      { status: 500 }
    );
  }
}
