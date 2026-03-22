import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sgm-hub/quota
 * Get SGM quarterly goals. Optional ?year=2026 filter.
 * Auth: admin, manager, revops_admin, sgm
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }
    if (!['admin', 'manager', 'sgm', 'revops_admin'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const year = searchParams.get('year');

    const quotas = await prisma.sGMQuarterlyGoal.findMany({
      where: year ? { quarter: { startsWith: year } } : undefined,
      orderBy: { quarter: 'asc' },
    });

    // Look up SGM display names from User table
    const userEmails = [...new Set(quotas.map(q => q.userEmail))];
    const users = await prisma.user.findMany({
      where: { email: { in: userEmails } },
      select: { email: true, name: true },
    });
    const emailToName = new Map(users.map(u => [u.email, u.name || u.email]));

    const result = quotas.map(q => ({
      id: q.id,
      userEmail: q.userEmail,
      sgmName: emailToName.get(q.userEmail) || q.userEmail,
      quarter: q.quarter,
      arrGoal: q.arrGoal,
      createdBy: q.createdBy,
      updatedBy: q.updatedBy,
    }));

    return NextResponse.json({ quotas: result });
  } catch (error) {
    console.error('[API] Error fetching SGM quotas:', error);
    return NextResponse.json(
      { error: 'Failed to fetch SGM quotas' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/sgm-hub/quota
 * Create or update an SGM quarterly goal.
 * Auth: admin, revops_admin ONLY
 */
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
    if (!['admin', 'revops_admin'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { userEmail, quarter, arrGoal } = body;

    if (!userEmail || !quarter || arrGoal === undefined) {
      return NextResponse.json(
        { error: 'userEmail, quarter, and arrGoal are required' },
        { status: 400 }
      );
    }

    // Validate quarter format: YYYY-QN
    if (!/^\d{4}-Q[1-4]$/.test(quarter)) {
      return NextResponse.json(
        { error: 'Invalid quarter format. Expected YYYY-QN (e.g., 2026-Q1)' },
        { status: 400 }
      );
    }

    if (typeof arrGoal !== 'number' || arrGoal < 0) {
      return NextResponse.json(
        { error: 'arrGoal must be a non-negative number' },
        { status: 400 }
      );
    }

    const quota = await prisma.sGMQuarterlyGoal.upsert({
      where: { userEmail_quarter: { userEmail, quarter } },
      create: {
        userEmail,
        quarter,
        arrGoal,
        createdBy: session.user.email,
        updatedAt: new Date(),
      },
      update: {
        arrGoal,
        updatedBy: session.user.email,
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({
      quota: {
        id: quota.id,
        userEmail: quota.userEmail,
        quarter: quota.quarter,
        arrGoal: quota.arrGoal,
        updatedBy: quota.updatedBy,
      },
    });
  } catch (error) {
    console.error('[API] Error saving SGM quota:', error);
    return NextResponse.json(
      { error: 'Failed to save SGM quota' },
      { status: 500 }
    );
  }
}
