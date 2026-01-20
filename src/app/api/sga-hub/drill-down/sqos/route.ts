// src/app/api/sga-hub/drill-down/sqos/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { getSQODrillDown } from '@/lib/queries/drill-down';
import { getQuarterInfo } from '@/lib/utils/sga-hub-helpers';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = await getUserPermissions(session.user.email);
    if (!['admin', 'manager', 'sga'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const targetUserEmail = searchParams.get('userEmail');
    const weekStartDate = searchParams.get('weekStartDate');
    const weekEndDate = searchParams.get('weekEndDate');
    const quarter = searchParams.get('quarter');

    // Validate date range parameters
    if (!quarter && (!weekStartDate || !weekEndDate)) {
      return NextResponse.json(
        { error: 'Missing required parameters: provide either quarter OR (weekStartDate AND weekEndDate)' },
        { status: 400 }
      );
    }

    // Determine which user's records to fetch
    let userEmail = session.user.email;
    if (targetUserEmail) {
      if (!['admin', 'manager'].includes(permissions.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      userEmail = targetUserEmail;
    }

    // Get user to retrieve name for BigQuery filter
    const user = await prisma.user.findUnique({
      where: { email: userEmail },
      select: { name: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Determine date range
    let startDate: string;
    let endDate: string;

    if (quarter) {
      // Convert quarter to date range using existing helper
      const quarterInfo = getQuarterInfo(quarter);
      startDate = quarterInfo.startDate;
      endDate = quarterInfo.endDate;
    } else {
      // Use week range
      startDate = weekStartDate!;
      endDate = weekEndDate!;
    }

    // Fetch drill-down records
    const records = await getSQODrillDown(user.name, startDate, endDate);

    return NextResponse.json({ records });
  } catch (error) {
    console.error('Error fetching SQO drill-down:', error);
    return NextResponse.json(
      { error: 'Failed to fetch SQO records' },
      { status: 500 }
    );
  }
}
