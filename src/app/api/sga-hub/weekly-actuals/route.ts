// src/app/api/sga-hub/weekly-actuals/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { getWeeklyActuals, getAllSGAWeeklyActuals } from '@/lib/queries/weekly-actuals';
import { getDefaultWeekRange } from '@/lib/utils/sga-hub-helpers';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/sga-hub/weekly-actuals
 * Get weekly actuals from BigQuery for the logged-in user or specified SGA
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const permissions = await getUserPermissions(session.user.email);
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const targetUserEmail = searchParams.get('userEmail');
    const allSGAs = searchParams.get('allSGAs') === 'true';
    
    const dateRange = startDate && endDate 
      ? { startDate, endDate }
      : getDefaultWeekRange();
    
    if (allSGAs) {
      if (!['admin', 'manager'].includes(permissions.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      
      const allActuals = await getAllSGAWeeklyActuals(
        dateRange.startDate,
        dateRange.endDate
      );
      
      return NextResponse.json({ 
        actuals: allActuals,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
      });
    }
    
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
    
    const user = await prisma.user.findUnique({
      where: { email: userEmail },
      select: { name: true },
    });
    
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    
    const actuals = await getWeeklyActuals(
      user.name,
      dateRange.startDate,
      dateRange.endDate
    );
    
    return NextResponse.json({ 
      actuals,
      sgaName: user.name,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
    });
    
  } catch (error) {
    console.error('[API] Error fetching weekly actuals:', error);
    return NextResponse.json(
      { error: 'Failed to fetch weekly actuals' },
      { status: 500 }
    );
  }
}
