// src/app/api/sga-hub/re-engagement/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { getReEngagementOpportunities } from '@/lib/queries/re-engagement';
import { prisma } from '@/lib/prisma';

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
    
    const permissions = await getUserPermissions(session.user.email);
    
    // Check role permissions
    if (!['admin', 'manager', 'sga'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    
    // Parse query params
    const { searchParams } = new URL(request.url);
    const targetUserEmail = searchParams.get('userEmail'); // Admin/manager only
    
    // Determine which user's records to fetch
    let userEmail = session.user.email;
    
    if (targetUserEmail) {
      // Only admin/manager can view other users' records
      if (!['admin', 'manager'].includes(permissions.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      userEmail = targetUserEmail;
    } else {
      // SGA role can only view own records
      if (permissions.role === 'sga' && userEmail !== session.user.email) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }
    
    // Get user to retrieve name for BigQuery filter
    const user = await prisma.user.findUnique({
      where: { email: userEmail },
      select: { name: true },
    });
    
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    
    // Fetch re-engagement opportunities
    const opportunities = await getReEngagementOpportunities(user.name);
    
    return NextResponse.json({ opportunities });
    
  } catch (error) {
    console.error('[API] Error fetching re-engagement opportunities:', error);
    return NextResponse.json(
      { error: 'Failed to fetch re-engagement opportunities' },
      { status: 500 }
    );
  }
}
