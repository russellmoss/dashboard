// src/app/api/sga-hub/weekly-goals/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { 
  getWeeklyGoals, 
  upsertWeeklyGoal,
  copyWeeklyGoal,
} from '@/lib/queries/weekly-goals';
import { getDefaultWeekRange, getWeekMondayDate, isMonday } from '@/lib/utils/sga-hub-helpers';
import { WeeklyGoalInput } from '@/types/sga-hub';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sga-hub/weekly-goals
 * Get weekly goals for the logged-in user or a specific user (admin only)
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
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const targetUserEmail = searchParams.get('userEmail'); // Admin only
    
    // Determine which user's goals to fetch
    let userEmail = session.user.email;
    
    if (targetUserEmail) {
      // Only admin/manager/revops_admin can view other users' goals
      if (!['admin', 'manager', 'revops_admin'].includes(permissions.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      userEmail = targetUserEmail;
    } else {
      // SGA role required for own goals
      if (!['admin', 'manager', 'sga', 'sgm', 'revops_admin'].includes(permissions.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    // Use default range if not provided
    const dateRange = startDate && endDate 
      ? { startDate, endDate }
      : getDefaultWeekRange();
    
    const goals = await getWeeklyGoals(
      userEmail,
      dateRange.startDate,
      dateRange.endDate
    );
    
    return NextResponse.json({ goals });
    
  } catch (error) {
    console.error('[API] Error fetching weekly goals:', error);
    return NextResponse.json(
      { error: 'Failed to fetch weekly goals' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/sga-hub/weekly-goals
 * Create or update a weekly goal
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
    
    // Parse request body
    const body = await request.json();
    const { 
      weekStartDate, 
      initialCallsGoal, 
      qualificationCallsGoal, 
      sqoGoal,
      userEmail: targetUserEmail, // Admin only - to set for another user
      copyFromWeek, // Optional - copy goals from another week
    } = body;
    
    // Determine target user
    let userEmail = session.user.email;
    
    if (targetUserEmail && targetUserEmail !== session.user.email) {
      // Only admin/manager/revops_admin can set goals for other users
      if (!['admin', 'manager', 'revops_admin'].includes(permissions.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      userEmail = targetUserEmail;
    } else {
      // SGA role required for own goals
      if (!['admin', 'manager', 'sga', 'sgm', 'revops_admin'].includes(permissions.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    // Handle copy from previous week
    if (copyFromWeek) {
      const copiedGoal = await copyWeeklyGoal(
        userEmail,
        copyFromWeek,
        weekStartDate,
        session.user.email
      );
      
      if (!copiedGoal) {
        return NextResponse.json(
          { error: 'No goals found for source week' },
          { status: 404 }
        );
      }
      
      return NextResponse.json({ goal: copiedGoal });
    }
    
    // Validate required fields
    if (!weekStartDate) {
      return NextResponse.json(
        { error: 'weekStartDate is required' },
        { status: 400 }
      );
    }
    
    // Validate weekStartDate is a Monday
    if (!isMonday(weekStartDate)) {
      return NextResponse.json(
        { error: 'weekStartDate must be a Monday' },
        { status: 400 }
      );
    }
    
    // SGA role can only edit current/future weeks (not past weeks)
    if (permissions.role === 'sga' && userEmail === session.user.email) {
      // Parse weekStartDate as local date to avoid timezone issues
      const [year, month, day] = weekStartDate.split('-').map(Number);
      const weekDate = new Date(year, month - 1, day);
      weekDate.setHours(0, 0, 0, 0);
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const currentWeekMonday = getWeekMondayDate(today);
      currentWeekMonday.setHours(0, 0, 0, 0);
      
      // Allow current week and future weeks (>= comparison)
      if (weekDate.getTime() < currentWeekMonday.getTime()) {
        return NextResponse.json(
          { error: 'SGAs can only edit goals for current or future weeks' },
          { status: 403 }
        );
      }
    }
    
    const goalInput: WeeklyGoalInput = {
      weekStartDate,
      initialCallsGoal: initialCallsGoal ?? 0,
      qualificationCallsGoal: qualificationCallsGoal ?? 0,
      sqoGoal: sqoGoal ?? 0,
    };
    
    const goal = await upsertWeeklyGoal(
      userEmail,
      goalInput,
      session.user.email
    );
    
    return NextResponse.json({ goal });
    
  } catch (error: any) {
    console.error('[API] Error saving weekly goal:', error);
    
    // Handle validation errors
    if (error.message?.includes('Monday') || error.message?.includes('non-negative')) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    
    return NextResponse.json(
      { error: 'Failed to save weekly goal' },
      { status: 500 }
    );
  }
}
