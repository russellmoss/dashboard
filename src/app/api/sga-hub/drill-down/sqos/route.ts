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
    const sgaNameParam = searchParams.get('sgaName'); // For leaderboard drill-down
    const weekStartDate = searchParams.get('weekStartDate');
    const weekEndDate = searchParams.get('weekEndDate');
    const quarter = searchParams.get('quarter');
    const channels = searchParams.getAll('channels'); // Returns array
    const sources = searchParams.getAll('sources');   // Returns array

    // Validate date range parameters
    if (!quarter && (!weekStartDate || !weekEndDate)) {
      return NextResponse.json(
        { error: 'Missing required parameters: provide either quarter OR (weekStartDate AND weekEndDate)' },
        { status: 400 }
      );
    }

    // Determine SGA name to use for BigQuery filter
    let sgaName: string;
    
    if (sgaNameParam) {
      // If sgaName is provided (from leaderboard), use it directly
      // No permission check - everyone can view any SGA's SQOs
      sgaName = sgaNameParam;
    } else {
      // Legacy behavior: use logged-in user's name or target user's name
      let userEmail = session.user.email;
      if (targetUserEmail) {
        // For targetUserEmail, still require admin/manager (legacy behavior)
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
      
      sgaName = user.name;
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

    // Fetch drill-down records with optional filters
    const records = await getSQODrillDown(
      sgaName, 
      startDate, 
      endDate,
      {
        channels: channels.length > 0 ? channels : undefined,
        sources: sources.length > 0 ? sources : undefined,
      }
    );

    return NextResponse.json({ records });
  } catch (error) {
    console.error('Error fetching SQO drill-down:', error);
    return NextResponse.json(
      { error: 'Failed to fetch SQO records' },
      { status: 500 }
    );
  }
}
