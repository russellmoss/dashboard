// src/app/api/sga-hub/sqo-details/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { getQuarterlySQODetails } from '@/lib/queries/quarterly-progress';
import { getCurrentQuarter } from '@/lib/utils/sga-hub-helpers';
import { prisma } from '@/lib/prisma';
import { SQODetail } from '@/types/sga-hub';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sga-hub/sqo-details
 * Get detailed SQO records for a specific quarter
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

    // Determine target user
    let userEmail = session.user.email;

    if (targetUserEmail) {
      // Admin/Manager can view any SGA's SQO details
      if (!['admin', 'manager'].includes(permissions.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      userEmail = targetUserEmail;
    } else {
      // SGA can only view their own SQO details
      if (!['admin', 'manager', 'sga'].includes(permissions.role)) {
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

    // Fetch SQO details from BigQuery
    const sqos = await getQuarterlySQODetails(user.name, quarter);

    return NextResponse.json({ sqos });

  } catch (error) {
    console.error('[API] Error fetching SQO details:', error);
    return NextResponse.json(
      { error: 'Failed to fetch SQO details' },
      { status: 500 }
    );
  }
}
