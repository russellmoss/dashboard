import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { triggerDataTransfer, isWithinCooldown } from '@/lib/data-transfer';
import { revalidateTag } from 'next/cache';
import { CACHE_TAGS } from '@/lib/cache';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

// Roles allowed to trigger transfers
const ALLOWED_ROLES = ['admin', 'manager'];

export async function POST(request: NextRequest) {
  try {
    // Auth check
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Use permissions from session (derived from JWT, no DB query)
    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }

    // Permission check
    if (!ALLOWED_ROLES.includes(permissions.role)) {
      return NextResponse.json(
        { error: 'Only admins and managers can trigger data transfers' },
        { status: 403 }
      );
    }

    // Check cooldown first (before triggering)
    const cooldown = isWithinCooldown();
    if (cooldown.withinCooldown) {
      return NextResponse.json({
        success: false,
        message: `Please wait ${cooldown.minutesRemaining} minutes before triggering another transfer`,
        cooldownMinutes: cooldown.minutesRemaining,
      }, { status: 429 });
    }

    // Trigger the transfer
    const result = await triggerDataTransfer();

    logger.info('[API] Transfer trigger requested', {
      user: session.user?.email,
      success: result.success,
      runId: result.runId,
    });

    if (result.success) {
      return NextResponse.json({
        success: true,
        runId: result.runId,
        message: result.message,
        estimatedDuration: '3-5 minutes',
      });
    } else {
      return NextResponse.json({
        success: false,
        message: result.message,
      }, { status: 400 });
    }
  } catch (error) {
    logger.error('[API] Error triggering transfer:', error);
    return NextResponse.json(
      { error: 'Failed to trigger data transfer' },
      { status: 500 }
    );
  }
}

// GET endpoint to check transfer status
export async function GET(request: NextRequest) {
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

    if (!ALLOWED_ROLES.includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const runId = searchParams.get('runId');

    if (!runId) {
      // Return cooldown status if no runId
      const cooldown = isWithinCooldown();
      return NextResponse.json({
        cooldown: cooldown.withinCooldown,
        cooldownMinutes: cooldown.minutesRemaining,
      });
    }

    // Get status of specific run
    const { getTransferRunStatus } = await import('@/lib/data-transfer');
    const status = await getTransferRunStatus(runId);

    // If transfer completed successfully, invalidate cache
    if (status.isComplete && status.success) {
      revalidateTag(CACHE_TAGS.DASHBOARD);
      revalidateTag(CACHE_TAGS.SGA_HUB);
      
      logger.info('[API] Cache invalidated after successful transfer', {
        runId,
        tags: [CACHE_TAGS.DASHBOARD, CACHE_TAGS.SGA_HUB],
      });
    }

    return NextResponse.json({
      runId,
      ...status,
      cacheInvalidated: status.isComplete && status.success,
    });
  } catch (error) {
    logger.error('[API] Error checking transfer status:', error);
    return NextResponse.json(
      { error: 'Failed to check transfer status' },
      { status: 500 }
    );
  }
}
