// src/app/api/sga-hub/closed-lost/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { getClosedLostRecords } from '@/lib/queries/closed-lost';
import { ClosedLostTimeBucket } from '@/types/sga-hub';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sga-hub/closed-lost
 * Get closed lost records for the logged-in SGA or specified SGA (admin/manager only)
 * Query params:
 * - userEmail: (admin/manager only) View a specific user's records
 * - showAll: (any role) When 'true', returns all records with SGA column
 * - timeBuckets: Comma-separated time bucket filters
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

    // Check role permissions
    if (!['admin', 'manager', 'sga', 'sgm', 'revops_admin'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Parse query params
    const { searchParams } = new URL(request.url);
    const targetUserEmail = searchParams.get('userEmail'); // Admin/manager only
    const timeBucketsParam = searchParams.get('timeBuckets'); // Comma-separated or single value
    const showAll = searchParams.get('showAll') === 'true'; // Toggle for all records

    // Determine which user's records to fetch
    let sgaName: string | null = null;

    if (showAll) {
      // Show all records - pass null to query to skip SGA filter
      sgaName = null;
    } else if (targetUserEmail) {
      // Only admin/manager/revops_admin/sga can view other users' records
      if (!['admin', 'manager', 'revops_admin', 'sga'].includes(permissions.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      const targetUser = await prisma.user.findUnique({
        where: { email: targetUserEmail },
        select: { name: true },
      });
      if (!targetUser) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }
      sgaName = targetUser.name;
    } else {
      // Get current user's name for filtering
      const user = await prisma.user.findUnique({
        where: { email: session.user.email },
        select: { name: true },
      });
      if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }
      sgaName = user.name;
    }

    // Parse timeBuckets parameter
    let timeBuckets: ClosedLostTimeBucket[] | undefined;

    if (timeBucketsParam) {
      // Handle comma-separated string or single value
      const buckets = timeBucketsParam.split(',').map(b => b.trim()) as ClosedLostTimeBucket[];
      // Validate buckets are valid ClosedLostTimeBucket values
      const validBuckets: ClosedLostTimeBucket[] = ['30-60', '60-90', '90-120', '120-150', '150-180', '180+', 'all'];
      timeBuckets = buckets.filter(b => validBuckets.includes(b));

      // If no valid buckets, default to all
      if (timeBuckets.length === 0) {
        timeBuckets = ['30-60', '60-90', '90-120', '120-150', '150-180', '180+'];
      }
    } else {
      // Default to all buckets if not specified
      timeBuckets = ['30-60', '60-90', '90-120', '120-150', '150-180', '180+'];
    }

    // Fetch closed lost records (pass null for sgaName to get all records)
    const records = await getClosedLostRecords(sgaName, timeBuckets);

    return NextResponse.json({ records });

  } catch (error) {
    console.error('[API] Error fetching closed lost records:', error);
    return NextResponse.json(
      { error: 'Failed to fetch closed lost records' },
      { status: 500 }
    );
  }
}
