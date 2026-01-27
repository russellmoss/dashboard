// src/app/api/sga-hub/leaderboard/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { getSGALeaderboard } from '@/lib/queries/sga-leaderboard';
import { LeaderboardFilters } from '@/types/sga-hub';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sga-hub/leaderboard
 * Get SGA leaderboard with SQO counts for a given date range and filters
 * 
 * Request body:
 * {
 *   startDate: string;      // YYYY-MM-DD
 *   endDate: string;        // YYYY-MM-DD
 *   channels: string[];      // Array of channel names
 *   sources?: string[];     // Optional array of source names (defaults to all if undefined/empty)
 *   sgaNames?: string[];     // Optional array of SGA names (defaults to all active if undefined/empty)
 * }
 * 
 * Response:
 * {
 *   entries: LeaderboardEntry[];
 * }
 */
export async function POST(request: NextRequest) {
  try {
    // Authentication check
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Authorization check - SGA Hub is accessible to admin, manager, and sga roles
    const permissions = await getUserPermissions(session.user.email);
    if (!['admin', 'manager', 'sga'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Parse request body
    const body = await request.json();
    const { startDate, endDate, channels, sources, sgaNames } = body as LeaderboardFilters;

    // Validate required fields
    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: 'startDate and endDate are required' },
        { status: 400 }
      );
    }

    if (!channels || !Array.isArray(channels) || channels.length === 0) {
      return NextResponse.json(
        { error: 'At least one channel is required' },
        { status: 400 }
      );
    }

    // Build filters object
    const filters: LeaderboardFilters = {
      startDate,
      endDate,
      channels,
      sources: sources && sources.length > 0 ? sources : undefined,
      sgaNames: sgaNames && sgaNames.length > 0 ? sgaNames : undefined,
    };

    // Fetch leaderboard data
    const entries = await getSGALeaderboard(filters);

    return NextResponse.json({ entries });

  } catch (error) {
    console.error('[API] Error fetching leaderboard:', error);
    return NextResponse.json(
      { error: 'Failed to fetch leaderboard' },
      { status: 500 }
    );
  }
}
