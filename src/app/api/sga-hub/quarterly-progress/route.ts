// src/app/api/sga-hub/quarterly-progress/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { getQuarterlySQOCount } from '@/lib/queries/quarterly-progress';
import { getQuarterlyGoal } from '@/lib/queries/quarterly-goals';
import { calculateQuarterPacing, getCurrentQuarter } from '@/lib/utils/sga-hub-helpers';
import { formatCurrency } from '@/lib/utils/date-helpers';
import { prisma } from '@/lib/prisma';
import { QuarterlyProgress } from '@/types/sga-hub';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sga-hub/quarterly-progress
 * Get quarterly progress with pacing calculation for the logged-in user or specified SGA
 */
export async function GET(request: NextRequest) {
  try {
    // Authentication check
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Use permissions from session (derived from JWT, no DB query)
    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }

    // Parse query params
    const { searchParams } = new URL(request.url);
    const quarter = searchParams.get('quarter') || getCurrentQuarter();
    const targetUserEmail = searchParams.get('userEmail');

    // Determine target user
    let userEmail = session.user.email;

    if (targetUserEmail) {
      // Admin/Manager/RevOps Admin can view any SGA's progress
      if (!['admin', 'manager', 'revops_admin'].includes(permissions.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      userEmail = targetUserEmail;
    } else {
      // SGA can only view their own progress
      if (!['admin', 'manager', 'sga', 'sgm', 'revops_admin'].includes(permissions.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    // Get user's name (matches SGA_Owner_Name__c in BigQuery)
    const user = await prisma.user.findUnique({
      where: { email: userEmail },
      select: { name: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Fetch SQO count and AUM from BigQuery
    const { sqoCount, totalAum } = await getQuarterlySQOCount(user.name, quarter);

    // Fetch quarterly goal from Prisma
    const goal = await getQuarterlyGoal(userEmail, quarter);
    const sqoGoal = goal?.sqoGoal || null;

    // Calculate pacing using helper function
    const progress: QuarterlyProgress = calculateQuarterPacing(
      quarter,
      sqoGoal,
      sqoCount,
      totalAum,
      formatCurrency
    );

    return NextResponse.json(progress);

  } catch (error) {
    console.error('[API] Error fetching quarterly progress:', error);
    return NextResponse.json(
      { error: 'Failed to fetch quarterly progress' },
      { status: 500 }
    );
  }
}
