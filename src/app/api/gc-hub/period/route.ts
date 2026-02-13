import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { periodToStartDate } from '@/lib/gc-hub/data-utils';

export const dynamic = 'force-dynamic';

/**
 * POST /api/gc-hub/period — Create a new period row for an advisor.
 * Admin/RevOps only. Body: advisorName, period, grossRevenue?, commissionsPaid?, reason.
 */
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

    if (permissions.role !== 'admin' && permissions.role !== 'revops_admin') {
      return NextResponse.json({ error: 'Forbidden — only Admin and RevOps can add periods' }, { status: 403 });
    }

    if (!permissions.allowedPages.includes(16)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { advisorName, period: periodInput, grossRevenue, commissionsPaid, reason } = body;

    if (!advisorName || typeof advisorName !== 'string' || advisorName.trim() === '') {
      return NextResponse.json({ error: 'advisorName is required' }, { status: 400 });
    }

    if (!periodInput || typeof periodInput !== 'string' || periodInput.trim() === '') {
      return NextResponse.json({ error: 'period is required' }, { status: 400 });
    }

    if (!reason || reason.trim() === '') {
      return NextResponse.json({ error: 'Reason is required' }, { status: 400 });
    }

    const advisorNormalizedName = advisorName.trim();
    const period = periodInput.trim();

    let periodStart: Date;
    try {
      periodStart = periodToStartDate(period);
    } catch {
      return NextResponse.json({ error: 'Invalid period format. Use "Q1 2024" or "Jan 2026".' }, { status: 400 });
    }

    // Unique constraint: (advisorNormalizedName, period)
    const existing = await prisma.gcAdvisorPeriodData.findFirst({
      where: { advisorNormalizedName, period },
    });
    if (existing) {
      return NextResponse.json({ error: `A record already exists for period "${period}"` }, { status: 400 });
    }

    // Copy metadata from an existing record for this advisor (orionRepresentativeId, accountName, billingFrequency, billingStyle)
    const existingRecord = await prisma.gcAdvisorPeriodData.findFirst({
      where: { advisorNormalizedName },
      orderBy: { periodStart: 'desc' },
    });

    const revenue = grossRevenue !== undefined ? parseFloat(grossRevenue) : null;
    const commissions = commissionsPaid !== undefined ? parseFloat(commissionsPaid) : null;
    const amountEarned = revenue != null && commissions != null ? revenue - commissions : null;

    const created = await prisma.gcAdvisorPeriodData.create({
      data: {
        advisorNormalizedName,
        orionRepresentativeId: existingRecord?.orionRepresentativeId ?? null,
        accountName: existingRecord?.accountName ?? null,
        period,
        periodStart,
        grossRevenue: revenue,
        commissionsPaid: commissions,
        amountEarned,
        billingFrequency: existingRecord?.billingFrequency ?? null,
        billingStyle: existingRecord?.billingStyle ?? null,
        dataSource: 'manual_override',
        isManuallyOverridden: true,
        overrideReason: reason.trim(),
        overriddenBy: session.user.email,
        overriddenAt: new Date(),
      },
    });

    logger.info('[GC Hub] Period created', {
      recordId: created.id,
      advisorName: advisorNormalizedName,
      period: created.period,
      overriddenBy: session.user.email,
      reason: reason.trim(),
    });

    return NextResponse.json({
      success: true,
      record: {
        id: created.id,
        advisorName: created.advisorNormalizedName,
        period: created.period,
        periodStart: created.periodStart.toISOString().split('T')[0],
        grossRevenue: created.grossRevenue,
        commissionsPaid: created.commissionsPaid,
        amountEarned: created.amountEarned,
        isManuallyOverridden: created.isManuallyOverridden,
        overrideReason: created.overrideReason,
        overriddenBy: created.overriddenBy,
        overriddenAt: created.overriddenAt?.toISOString(),
      },
    });
  } catch (error) {
    logger.error('Error in GC Hub create period:', error);
    return NextResponse.json(
      { error: 'Failed to create period' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/gc-hub/period — Delete a period row by recordId.
 * Admin/RevOps only. Body: recordId.
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }

    if (permissions.role !== 'admin' && permissions.role !== 'revops_admin') {
      return NextResponse.json({ error: 'Forbidden — only Admin and RevOps can delete periods' }, { status: 403 });
    }

    if (!permissions.allowedPages.includes(16)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const { recordId } = body;

    if (!recordId || typeof recordId !== 'string' || recordId.trim() === '') {
      return NextResponse.json({ error: 'recordId is required' }, { status: 400 });
    }

    const existing = await prisma.gcAdvisorPeriodData.findUnique({
      where: { id: recordId.trim() },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    }

    await prisma.gcAdvisorPeriodData.delete({
      where: { id: recordId.trim() },
    });

    logger.info('[GC Hub] Period deleted', {
      recordId: recordId.trim(),
      advisorName: existing.advisorNormalizedName,
      period: existing.period,
      deletedBy: session.user.email,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('Error in GC Hub delete period:', error);
    return NextResponse.json(
      { error: 'Failed to delete period' },
      { status: 500 }
    );
  }
}
