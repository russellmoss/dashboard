import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
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

    // Use permissions from session (derived from JWT, no DB query)
    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }

    if (!['admin', 'manager', 'revops_admin'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Invalidate all cache tags
    revalidateTag(CACHE_TAGS.DASHBOARD);
    revalidateTag(CACHE_TAGS.SGA_HUB);
    revalidateTag(CACHE_TAGS.SGM_HUB);
    revalidateTag(CACHE_TAGS.BOT_USAGE);
    revalidateTag(CACHE_TAGS.COACHING_USAGE);
    revalidateTag(CACHE_TAGS.CALL_INTELLIGENCE_QUEUE);

    logger.info('[Cache Refresh] Admin cache invalidation', {
      user: session.user?.email,
      tags: [CACHE_TAGS.DASHBOARD, CACHE_TAGS.SGA_HUB, CACHE_TAGS.SGM_HUB, CACHE_TAGS.BOT_USAGE, CACHE_TAGS.COACHING_USAGE, CACHE_TAGS.CALL_INTELLIGENCE_QUEUE],
    });

    return NextResponse.json({
      success: true,
      message: 'Cache invalidated successfully',
      tags: [CACHE_TAGS.DASHBOARD, CACHE_TAGS.SGA_HUB, CACHE_TAGS.SGM_HUB, CACHE_TAGS.BOT_USAGE, CACHE_TAGS.COACHING_USAGE, CACHE_TAGS.CALL_INTELLIGENCE_QUEUE],
    });
  } catch (error) {
    logger.error('Error refreshing cache:', error);
    return NextResponse.json(
      { error: 'Failed to refresh cache' },
      { status: 500 }
    );
  }
}
