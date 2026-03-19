import { NextRequest, NextResponse } from 'next/server';
import { triggerDataTransfer } from '@/lib/data-transfer';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Validate CRON_SECRET (auto-injected by Vercel)
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
      logger.warn('[Cron Transfer] CRON_SECRET not configured');
      return NextResponse.json({ error: 'Cron not configured' }, { status: 500 });
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
      logger.warn('[Cron Transfer] Invalid CRON_SECRET');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Trigger all transfers in parallel
    const result = await triggerDataTransfer();

    logger.info('[Cron Transfer] Scheduled transfers triggered', {
      success: result.success,
      runIds: result.runIds,
      timestamp: new Date().toISOString(),
    });

    if (result.success) {
      return NextResponse.json({
        success: true,
        message: 'Transfers triggered successfully',
        runIds: result.runIds,
      });
    } else {
      // Don't fail cron job if cooldown is active - that's expected
      return NextResponse.json({
        success: false,
        message: result.message,
      }, { status: 200 }); // Return 200 so cron doesn't retry
    }
  } catch (error) {
    logger.error('[Cron Transfer] Error triggering transfer:', error);
    return NextResponse.json(
      { error: 'Failed to trigger transfer' },
      { status: 500 }
    );
  }
}
