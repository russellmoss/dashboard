// src/app/api/sga-hub/admin-quarterly-progress/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { getAdminQuarterlyProgress } from '@/lib/queries/admin-quarterly-progress';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sga-hub/admin-quarterly-progress
 * Get admin quarterly progress with team totals and individual SGA breakdown
 */
export async function GET(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = await getUserPermissions(session.user.email);
    // Only admins/managers can access
    if (!['admin', 'manager'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const year = searchParams.get('year');
    const quarter = searchParams.get('quarter');
    const sgaNames = searchParams.getAll('sgaNames');
    const channels = searchParams.getAll('channels');
    const sources = searchParams.getAll('sources');

    if (!year || !quarter) {
      return NextResponse.json(
        { error: 'Missing required parameters: year and quarter' },
        { status: 400 }
      );
    }

    const yearNum = parseInt(year, 10);
    const quarterNum = parseInt(quarter, 10);

    if (isNaN(yearNum) || isNaN(quarterNum) || quarterNum < 1 || quarterNum > 4) {
      return NextResponse.json(
        { error: 'Invalid year or quarter' },
        { status: 400 }
      );
    }

    // Build filters
    const filters: {
      sgaNames?: string[];
      channels?: string[];
      sources?: string[];
    } = {};

    if (sgaNames.length > 0) {
      filters.sgaNames = sgaNames;
    }
    if (channels.length > 0) {
      filters.channels = channels;
    }
    if (sources.length > 0) {
      filters.sources = sources;
    }

    const progress = await getAdminQuarterlyProgress(yearNum, quarterNum, Object.keys(filters).length > 0 ? filters : undefined);

    return NextResponse.json(progress);
  } catch (error) {
    console.error('[API] Error fetching admin quarterly progress:', error);
    return NextResponse.json(
      { error: 'Failed to fetch admin progress' },
      { status: 500 }
    );
  }
}
