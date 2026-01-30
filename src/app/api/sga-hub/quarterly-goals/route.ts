// src/app/api/sga-hub/quarterly-goals/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { 
  getQuarterlyGoal,
  getQuarterlyGoals,
  upsertQuarterlyGoal,
  getAllSGAQuarterlyGoals,
} from '@/lib/queries/quarterly-goals';
import { getCurrentQuarter } from '@/lib/utils/sga-hub-helpers';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sga-hub/quarterly-goals
 * Get quarterly goals for the logged-in user or all SGAs (admin)
 * 
 * Supports two modes:
 * 1. Legacy mode: quarter (string), allSGAs, userEmail
 * 2. New mode: year, quarter (number), sgaNames (optional array)
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
    if (!['admin', 'manager', 'sga'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Parse query params
    const { searchParams } = new URL(request.url);
    const year = searchParams.get('year');
    const quarterNum = searchParams.get('quarter');
    const sgaNames = searchParams.getAll('sgaNames');
    
    // Legacy parameters
    const quarter = searchParams.get('quarter') || getCurrentQuarter();
    const targetUserEmail = searchParams.get('userEmail');
    const allSGAs = searchParams.get('allSGAs') === 'true'; // Admin only

    // NEW MODE: year and quarter (number) provided - return Record format
    if (year && quarterNum && !isNaN(parseInt(quarterNum, 10))) {
      const yearNum = parseInt(year, 10);
      const quarterNumber = parseInt(quarterNum, 10);

      if (isNaN(yearNum) || isNaN(quarterNumber) || quarterNumber < 1 || quarterNumber > 4) {
        return NextResponse.json(
          { error: 'Invalid year or quarter' },
          { status: 400 }
        );
      }

      const quarterStr = `${yearNum}-Q${quarterNumber}`;
      
      // Get all goals for the quarter
      const goals = await getAllSGAQuarterlyGoals(quarterStr);
      
      // Get User records to map userEmail to name
      const userEmails = goals.map(g => g.userEmail);
      const users = await prisma.user.findMany({
        where: { email: { in: userEmails } },
        select: { email: true, name: true },
      });
      
      const emailToNameMap = new Map(users.map(u => [u.email, u.name]));
      
      // Convert to Record format: sgaName -> sqoGoal
      const goalsRecord: Record<string, number | null> = {};
      goals.forEach(goal => {
        const sgaName = emailToNameMap.get(goal.userEmail);
        if (sgaName) {
          // Filter by sgaNames if provided
          if (sgaNames.length === 0 || sgaNames.includes(sgaName)) {
            goalsRecord[sgaName] = goal.sqoGoal;
          }
        }
      });
      
      return NextResponse.json({ goals: goalsRecord });
    }

    // LEGACY MODE: Admin: Get all SGAs' goals for a quarter
    if (allSGAs) {
      if (!['admin', 'manager'].includes(permissions.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      const goals = await getAllSGAQuarterlyGoals(quarter);
      return NextResponse.json({ goals, quarter });
    }

    // LEGACY MODE: Get specific user's goals
    let userEmail = session.user.email;

    if (targetUserEmail) {
      if (!['admin', 'manager'].includes(permissions.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      userEmail = targetUserEmail;
    }

    // Get all quarters for user (for historical view)
    const goals = await getQuarterlyGoals(userEmail);

    return NextResponse.json({ goals });

  } catch (error) {
    console.error('[API] Error fetching quarterly goals:', error);
    return NextResponse.json(
      { error: 'Failed to fetch quarterly goals' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/sga-hub/quarterly-goals
 * Create or update a quarterly goal (admin/manager only)
 */
export async function POST(request: NextRequest) {
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

    // Only admin/manager can set quarterly goals
    if (!['admin', 'manager'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Parse request body
    const body = await request.json();
    const { userEmail, quarter, sqoGoal } = body;

    // Validate required fields
    if (!userEmail || !quarter || sqoGoal === undefined) {
      return NextResponse.json(
        { error: 'userEmail, quarter, and sqoGoal are required' },
        { status: 400 }
      );
    }

    const goal = await upsertQuarterlyGoal(
      { userEmail, quarter, sqoGoal },
      session.user.email
    );

    return NextResponse.json({ goal });

  } catch (error: any) {
    console.error('[API] Error saving quarterly goal:', error);

    if (error.message?.includes('Invalid quarter')) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(
      { error: 'Failed to save quarterly goal' },
      { status: 500 }
    );
  }
}
