// src/app/api/sga-hub/re-engagement/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { getReEngagementOpportunities } from '@/lib/queries/re-engagement';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sga-hub/re-engagement
 * Get open re-engagement opportunities for the logged-in SGA or specified SGA (admin/manager only)
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
    if (!['admin', 'manager', 'sga'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    
    // Parse query params
    const { searchParams } = new URL(request.url);
    const targetUserEmail = searchParams.get('userEmail'); // Admin/manager only
    const showAll = searchParams.get('showAll') === 'true';
    
    // Only admins/managers can use showAll
    if (showAll && !['admin', 'manager'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    
    // Determine SGA name to filter by
    let sgaName: string | null = null;
    
    if (showAll) {
      // Show all records - pass null to query
      sgaName = null;
    } else if (targetUserEmail) {
      // Only admin/manager can view other users' records
      if (!['admin', 'manager'].includes(permissions.role)) {
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
    
    // Fetch re-engagement opportunities
    const opportunities = await getReEngagementOpportunities(sgaName);
    
    return NextResponse.json({ opportunities });
    
  } catch (error) {
    console.error('[API] Error fetching re-engagement opportunities:', error);
    return NextResponse.json(
      { error: 'Failed to fetch re-engagement opportunities' },
      { status: 500 }
    );
  }
}
