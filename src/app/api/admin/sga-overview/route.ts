// src/app/api/admin/sga-overview/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { prisma } from '@/lib/prisma';
import { getWeeklyGoalByWeek } from '@/lib/queries/weekly-goals';
import { getWeeklyActuals } from '@/lib/queries/weekly-actuals';
import { getQuarterlyGoal } from '@/lib/queries/quarterly-goals';
import { getQuarterlySQOCount } from '@/lib/queries/quarterly-progress';
import { getClosedLostRecords } from '@/lib/queries/closed-lost';
import { calculateQuarterPacing, getCurrentQuarter, getWeekMondayDate } from '@/lib/utils/sga-hub-helpers';
import { formatCurrency } from '@/lib/utils/date-helpers';
import { AdminSGAOverview } from '@/types/sga-hub';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/sga-overview
 * Get aggregated SGA performance data for admin/manager view
 * 
 * Query params:
 * - weekStartDate?: string (ISO date, defaults to current week Monday)
 * - quarter?: string (format: "YYYY-QN", defaults to current quarter)
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

    // Only admin, manager, and revops_admin can access this endpoint
    if (!['admin', 'manager', 'revops_admin'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Parse query params
    const { searchParams } = new URL(request.url);
    const weekStartDateParam = searchParams.get('weekStartDate');
    const quarterParam = searchParams.get('quarter');

    // Determine current week (Monday)
    const currentWeekMonday = weekStartDateParam
      ? new Date(weekStartDateParam)
      : getWeekMondayDate(new Date());
    const weekStartDate = currentWeekMonday.toISOString().split('T')[0];

    // Determine current quarter
    const quarter = quarterParam || getCurrentQuarter();

    // Get all SGA users
    const sgaUsers = await prisma.user.findMany({
      where: {
        role: 'sga',
        isActive: true, // Only active SGAs
      },
      select: {
        email: true,
        name: true,
        isActive: true,
      },
      orderBy: {
        name: 'asc',
      },
    });

    // Fetch data for all SGAs in parallel
    const overviewPromises = sgaUsers.map(async (user) => {
      try {
        // Fetch all data in parallel for this SGA
        const [
          weeklyGoal,
          weeklyActuals,
          quarterlyGoal,
          quarterlySQOData,
          closedLostRecords,
        ] = await Promise.all([
          // Current week goal
          getWeeklyGoalByWeek(user.email, weekStartDate).catch(() => null),
          
          // Current week actuals (need to calculate week end date)
          (async () => {
            const weekEndDate = new Date(currentWeekMonday);
            weekEndDate.setDate(weekEndDate.getDate() + 6); // Sunday
            const actuals = await getWeeklyActuals(
              user.name,
              weekStartDate,
              weekEndDate.toISOString().split('T')[0]
            );
            // Find actual for this specific week
            return actuals.find(a => a.weekStartDate === weekStartDate) || null;
          })().catch(() => null),
          
          // Current quarter goal
          getQuarterlyGoal(user.email, quarter).catch(() => null),
          
          // Current quarter SQO count and AUM
          getQuarterlySQOCount(user.name, quarter).catch(() => ({ sqoCount: 0, totalAum: 0 })),
          
          // Closed lost count (all time buckets)
          getClosedLostRecords(user.name).catch(() => []),
        ]);

        // Calculate quarterly progress with pacing
        let quarterlyProgress = null;
        if (quarterlyGoal) {
          quarterlyProgress = calculateQuarterPacing(
            quarter,
            quarterlyGoal.sqoGoal,
            quarterlySQOData.sqoCount,
            quarterlySQOData.totalAum,
            formatCurrency
          );
        } else if (quarterlySQOData.sqoCount > 0) {
          // Calculate progress even without goal (for display purposes)
          quarterlyProgress = calculateQuarterPacing(
            quarter,
            null,
            quarterlySQOData.sqoCount,
            quarterlySQOData.totalAum,
            formatCurrency
          );
        }

        // Calculate alerts
        const missingWeeklyGoal = weeklyGoal === null;
        const missingQuarterlyGoal = quarterlyGoal === null;
        const behindPacing = quarterlyProgress?.pacingStatus === 'behind';

        return {
          userEmail: user.email,
          userName: user.name,
          isActive: user.isActive ?? true,
          currentWeekGoal: weeklyGoal,
          currentWeekActual: weeklyActuals,
          currentQuarterGoal: quarterlyGoal,
          currentQuarterProgress: quarterlyProgress,
          closedLostCount: closedLostRecords.length,
          missingWeeklyGoal,
          missingQuarterlyGoal,
          behindPacing,
        } as AdminSGAOverview;
      } catch (error) {
        // If any error occurs for a specific SGA, return minimal data
        console.error(`[API] Error fetching data for SGA ${user.email}:`, error);
        return {
          userEmail: user.email,
          userName: user.name,
          isActive: user.isActive ?? true,
          currentWeekGoal: null,
          currentWeekActual: null,
          currentQuarterGoal: null,
          currentQuarterProgress: null,
          closedLostCount: 0,
          missingWeeklyGoal: true,
          missingQuarterlyGoal: true,
          behindPacing: false,
        } as AdminSGAOverview;
      }
    });

    // Wait for all promises to resolve
    const sgaOverviews = await Promise.all(overviewPromises);

    return NextResponse.json({
      sgaOverviews,
      weekStartDate,
      quarter,
    });

  } catch (error) {
    console.error('[API] Error fetching SGA overview:', error);
    return NextResponse.json(
      { error: 'Failed to fetch SGA overview' },
      { status: 500 }
    );
  }
}
