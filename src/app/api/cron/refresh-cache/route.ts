import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { CACHE_TAGS } from '@/lib/cache';
import { logger } from '@/lib/logger';

export async function GET(request: NextRequest) {
  try {
    // Validate CRON_SECRET (auto-injected by Vercel)
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
      logger.warn('[Cron] CRON_SECRET not configured');
      return NextResponse.json({ error: 'Cron not configured' }, { status: 500 });
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
      logger.warn('[Cron] Invalid CRON_SECRET');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Invalidate both cache tags
    revalidateTag(CACHE_TAGS.DASHBOARD);
    revalidateTag(CACHE_TAGS.SGA_HUB);

    logger.info('[Cron] Scheduled cache refresh', {
      tags: [CACHE_TAGS.DASHBOARD, CACHE_TAGS.SGA_HUB],
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      message: 'Cache invalidated successfully',
      tags: [CACHE_TAGS.DASHBOARD, CACHE_TAGS.SGA_HUB],
    });
  } catch (error) {
    logger.error('Error in cron refresh:', error);
    return NextResponse.json(
      { error: 'Failed to refresh cache' },
      { status: 500 }
    );
  }
}
