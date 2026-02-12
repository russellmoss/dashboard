import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
      logger.warn('[GC Hub Cron] CRON_SECRET not configured');
      return NextResponse.json({ error: 'Cron not configured' }, { status: 500 });
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
      logger.warn('[GC Hub Cron] Invalid CRON_SECRET');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { syncAllMonths } = await import('@/lib/gc-hub/sync-revenue-estimates');

    logger.info('[GC Hub Cron] Starting scheduled sync');

    const results = await syncAllMonths();

    const monthsSynced = results.length;
    const totalInserted = results.reduce((s, r) => s + r.advisorsInserted, 0);
    const totalUpdated = results.reduce((s, r) => s + r.advisorsUpdated, 0);
    const totalSkipped = results.reduce((s, r) => s + r.advisorsSkipped, 0);
    const allErrors = results.flatMap(r => r.errors);

    // Write GcSyncLog entry for audit
    try {
      await prisma.gcSyncLog.create({
        data: {
          syncType: 'live_sync',
          status: 'completed',
          triggeredBy: 'cron',
          recordsProcessed: results.reduce((s, r) => s + r.advisorsProcessed, 0),
          recordsInserted: totalInserted,
          recordsUpdated: totalUpdated,
          recordsSkipped: totalSkipped,
          completedAt: new Date(),
          errorMessage: allErrors.length > 0 ? allErrors.slice(0, 3).join('; ') : null,
          errorDetails: allErrors.length > 0 ? { count: allErrors.length, sample: allErrors.slice(0, 5) } : undefined,
        },
      });
    } catch (logErr) {
      logger.warn('[GC Hub Cron] Could not write GcSyncLog', { error: logErr });
    }

    logger.info('[GC Hub Cron] Sync completed', {
      monthsSynced,
      totalInserted,
      totalUpdated,
      totalSkipped,
      errors: allErrors.length,
    });

    return NextResponse.json({
      success: true,
      message: 'GC Hub sync completed',
      monthsSynced,
      totalInserted,
      totalUpdated,
      totalSkipped,
      errors: allErrors,
    });
  } catch (error) {
    logger.error('[GC Hub Cron] Sync failed:', error);
    return NextResponse.json(
      { error: 'Sync failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
