import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { periodToStartDate } from '@/lib/gc-hub/data-utils';

export const dynamic = 'force-dynamic';

export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }

    // Only admin and revops_admin can override values
    if (permissions.role !== 'admin' && permissions.role !== 'revops_admin') {
      return NextResponse.json({ error: 'Forbidden — only Admin and RevOps can edit values' }, { status: 403 });
    }

    const body = await request.json();
    const { recordId, period: periodInput, grossRevenue, commissionsPaid, reason } = body;

    if (!recordId) {
      return NextResponse.json({ error: 'recordId is required' }, { status: 400 });
    }

    if (grossRevenue === undefined && commissionsPaid === undefined && !periodInput) {
      return NextResponse.json({ error: 'At least one value (period, grossRevenue, or commissionsPaid) must be provided' }, { status: 400 });
    }

    if (!reason || reason.trim() === '') {
      return NextResponse.json({ error: 'Override reason is required' }, { status: 400 });
    }

    // Fetch current record
    const existing = await prisma.gcAdvisorPeriodData.findUnique({
      where: { id: recordId },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    }

    // Build update payload
    const updateData: any = {
      isManuallyOverridden: true,
      overrideReason: reason.trim(),
      overriddenBy: session.user.email,
      overriddenAt: new Date(),
    };

    // Optional: update period (and periodStart)
    if (periodInput != null && String(periodInput).trim() !== '') {
      const newPeriod = String(periodInput).trim();
      try {
        const periodStartDate = periodToStartDate(newPeriod);
        // Unique constraint is (advisorNormalizedName, period) — ensure no other record has this period for this advisor
        const conflict = await prisma.gcAdvisorPeriodData.findFirst({
          where: {
            advisorNormalizedName: existing.advisorNormalizedName,
            period: newPeriod,
            id: { not: recordId },
          },
        });
        if (conflict) {
          return NextResponse.json({ error: `Another record already exists for period "${newPeriod}"` }, { status: 400 });
        }
        updateData.period = newPeriod;
        updateData.periodStart = periodStartDate;
      } catch {
        return NextResponse.json({ error: 'Invalid period format. Use "Q1 2024" or "Jan 2026".' }, { status: 400 });
      }
    }

    // Store originals (only on first override — don't overwrite previous originals)
    if (!existing.isManuallyOverridden) {
      updateData.originalGrossRevenue = existing.grossRevenue;
      updateData.originalCommissionsPaid = existing.commissionsPaid;
    }

    if (grossRevenue !== undefined) {
      updateData.grossRevenue = parseFloat(grossRevenue);
    }
    if (commissionsPaid !== undefined) {
      updateData.commissionsPaid = parseFloat(commissionsPaid);
    }

    // Recalculate amount earned
    const newRevenue = updateData.grossRevenue ?? existing.grossRevenue ?? 0;
    const newCommissions = updateData.commissionsPaid ?? existing.commissionsPaid ?? 0;
    updateData.amountEarned = newRevenue - newCommissions;

    const updated = await prisma.gcAdvisorPeriodData.update({
      where: { id: recordId },
      data: updateData,
    });

    logger.info('[GC Hub] Value override', {
      recordId,
      advisorName: existing.advisorNormalizedName,
      period: existing.period,
      overriddenBy: session.user.email,
      reason: reason.trim(),
      oldRevenue: existing.grossRevenue,
      newRevenue: updated.grossRevenue,
      oldCommissions: existing.commissionsPaid,
      newCommissions: updated.commissionsPaid,
    });

    return NextResponse.json({
      success: true,
      record: {
        id: updated.id,
        advisorName: updated.advisorNormalizedName,
        period: updated.period,
        grossRevenue: updated.grossRevenue,
        commissionsPaid: updated.commissionsPaid,
        amountEarned: updated.amountEarned,
        isManuallyOverridden: updated.isManuallyOverridden,
        overrideReason: updated.overrideReason,
        overriddenBy: updated.overriddenBy,
        overriddenAt: updated.overriddenAt?.toISOString(),
      },
    });
  } catch (error) {
    logger.error('Error in GC Hub override:', error);
    return NextResponse.json(
      { error: 'Failed to update record' },
      { status: 500 }
    );
  }
}
