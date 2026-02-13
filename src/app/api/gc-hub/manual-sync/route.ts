import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

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

    // Only admin and revops_admin can trigger manual sync
    if (permissions.role !== 'admin' && permissions.role !== 'revops_admin') {
      return NextResponse.json({ error: 'Forbidden — only Admin and RevOps can trigger sync' }, { status: 403 });
    }

    const { syncAllMonths } = await import('@/lib/gc-hub/sync-revenue-estimates');

    logger.info('[GC Hub] Manual sync triggered', { triggeredBy: session.user.email });

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
          triggeredBy: session.user.email,
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
      logger.warn('[GC Hub] Could not write GcSyncLog', { error: logErr });
    }

    logger.info('[GC Hub] Manual sync completed', {
      triggeredBy: session.user.email,
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
      triggeredBy: session.user.email,
    });
  } catch (error) {
    logger.error('[GC Hub] Manual sync failed:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    // Missing env on Vercel (or elsewhere) — return 503 so UI can show "not configured"
    const isNotConfigured =
      message.includes('GC_REVENUE_ESTIMATES_SHEET_ID') ||
      message.includes('Missing required parameters: spreadsheetId');
    return NextResponse.json(
      {
        error: isNotConfigured ? 'GC Hub live sync is not configured' : 'Sync failed',
        details: message,
      },
      { status: isNotConfigured ? 503 : 500 }
    );
  }
}
