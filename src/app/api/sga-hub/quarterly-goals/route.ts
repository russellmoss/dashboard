// src/app/api/sga-hub/quarterly-goals/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { 
  getQuarterlyGoal,
  getQuarterlyGoals,
  upsertQuarterlyGoal,
  getAllSGAQuarterlyGoals,
} from '@/lib/queries/quarterly-goals';
import { getCurrentQuarter } from '@/lib/utils/sga-hub-helpers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sga-hub/quarterly-goals
 * Get quarterly goals for the logged-in user or all SGAs (admin)
 */
export async function GET(request: NextRequest) {
  try {
    // Authentication check
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = await getUserPermissions(session.user.email);

    // Parse query params
    const { searchParams } = new URL(request.url);
    const quarter = searchParams.get('quarter') || getCurrentQuarter();
    const targetUserEmail = searchParams.get('userEmail');
    const allSGAs = searchParams.get('allSGAs') === 'true'; // Admin only

    // Admin: Get all SGAs' goals for a quarter
    if (allSGAs) {
      if (!['admin', 'manager'].includes(permissions.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      const goals = await getAllSGAQuarterlyGoals(quarter);
      return NextResponse.json({ goals, quarter });
    }

    // Get specific user's goals
    let userEmail = session.user.email;

    if (targetUserEmail) {
      if (!['admin', 'manager'].includes(permissions.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      userEmail = targetUserEmail;
    } else {
      if (!['admin', 'manager', 'sga'].includes(permissions.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
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

    const permissions = await getUserPermissions(session.user.email);

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
