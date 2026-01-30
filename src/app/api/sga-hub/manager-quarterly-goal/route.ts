// src/app/api/sga-hub/manager-quarterly-goal/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { prisma } from '@/lib/prisma';
import { revalidateTag } from 'next/cache';
import { CACHE_TAGS } from '@/lib/cache';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sga-hub/manager-quarterly-goal
 * Get manager's quarterly goal for a specific quarter
 */
export async function GET(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Use permissions from session (derived from JWT, no DB query)
    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }
    if (!['admin', 'manager', 'sga'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const quarter = searchParams.get('quarter');

    if (!quarter) {
      return NextResponse.json(
        { error: 'Missing required parameter: quarter' },
        { status: 400 }
      );
    }

    // Validate quarter format (e.g., "2026-Q1")
    const quarterRegex = /^(\d{4})-Q([1-4])$/;
    if (!quarterRegex.test(quarter)) {
      return NextResponse.json(
        { error: 'Invalid quarter format. Expected format: YYYY-QN (e.g., 2026-Q1)' },
        { status: 400 }
      );
    }

    // Fetch manager goal
    const managerGoal = await prisma.managerQuarterlyGoal.findUnique({
      where: {
        quarter: quarter,
      },
    });

    return NextResponse.json({
      goal: managerGoal ? managerGoal.sqoGoal : null,
    });
  } catch (error) {
    console.error('[API] Error fetching manager quarterly goal:', error);
    return NextResponse.json(
      { error: 'Failed to fetch manager goal' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/sga-hub/manager-quarterly-goal
 * Create or update manager's quarterly goal (admin/manager only)
 */
export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Use permissions from session (derived from JWT, no DB query)
    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }
    // Only admins/managers can set manager goals
    if (!['admin', 'manager'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { quarter, sqoGoal } = body;

    if (!quarter || sqoGoal === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: quarter, sqoGoal' },
        { status: 400 }
      );
    }

    // Validate quarter format
    const quarterRegex = /^(\d{4})-Q([1-4])$/;
    if (!quarterRegex.test(quarter)) {
      return NextResponse.json(
        { error: 'Invalid quarter format. Expected format: YYYY-QN (e.g., 2026-Q1)' },
        { status: 400 }
      );
    }

    // Validate sqoGoal
    const sqoGoalNum = parseInt(String(sqoGoal), 10);
    if (isNaN(sqoGoalNum) || sqoGoalNum < 0) {
      return NextResponse.json(
        { error: 'Invalid sqoGoal. Must be a non-negative number' },
        { status: 400 }
      );
    }

    // Upsert manager goal
    const managerGoal = await prisma.managerQuarterlyGoal.upsert({
      where: {
        quarter: quarter,
      },
      update: {
        sqoGoal: sqoGoalNum,
        updatedBy: session.user.email,
      },
      create: {
        quarter: quarter,
        sqoGoal: sqoGoalNum,
        createdBy: session.user.email,
        updatedBy: session.user.email,
      },
    });

    // Invalidate SGA_HUB cache to ensure admin progress queries return fresh data
    revalidateTag(CACHE_TAGS.SGA_HUB);

    return NextResponse.json({
      goal: managerGoal.sqoGoal,
      message: 'Manager goal saved successfully',
    });
  } catch (error) {
    console.error('[API] Error saving manager quarterly goal:', error);
    return NextResponse.json(
      { error: 'Failed to save manager goal' },
      { status: 500 }
    );
  }
}
