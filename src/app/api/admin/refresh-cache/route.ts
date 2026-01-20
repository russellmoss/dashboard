import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { revalidateTag } from 'next/cache';
import { CACHE_TAGS } from '@/lib/cache';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = await getUserPermissions(session.user?.email || '');
    if (permissions.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Invalidate both cache tags
    revalidateTag(CACHE_TAGS.DASHBOARD);
    revalidateTag(CACHE_TAGS.SGA_HUB);

    logger.info('[Cache Refresh] Admin cache invalidation', {
      user: session.user?.email,
      tags: [CACHE_TAGS.DASHBOARD, CACHE_TAGS.SGA_HUB],
    });

    return NextResponse.json({
      success: true,
      message: 'Cache invalidated successfully',
      tags: [CACHE_TAGS.DASHBOARD, CACHE_TAGS.SGA_HUB],
    });
  } catch (error) {
    logger.error('Error refreshing cache:', error);
    return NextResponse.json(
      { error: 'Failed to refresh cache' },
      { status: 500 }
    );
  }
}
