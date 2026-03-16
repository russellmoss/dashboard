// src/app/api/sga-hub/drill-down/initial-calls/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { getInitialCallsDrillDown } from '@/lib/queries/drill-down';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }
    if (!['admin', 'manager', 'sga', 'sgm', 'revops_admin'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const targetUserEmail = searchParams.get('userEmail');
    const sgaNameParam = searchParams.get('sgaName');
    const teamLevel = searchParams.get('teamLevel') === 'true';
    const weekStartDate = searchParams.get('weekStartDate');
    const weekEndDate = searchParams.get('weekEndDate');

    if (!weekStartDate || !weekEndDate) {
      return NextResponse.json(
        { error: 'Missing required parameters: weekStartDate, weekEndDate' },
        { status: 400 }
      );
    }

    let sgaName: string | null = null;

    if (teamLevel) {
      if (!['admin', 'manager', 'revops_admin'].includes(permissions.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      sgaName = null;
    } else if (sgaNameParam) {
      sgaName = sgaNameParam;
    } else {
      let userEmail = session.user.email;
      if (targetUserEmail) {
        if (!['admin', 'manager', 'revops_admin'].includes(permissions.role)) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        userEmail = targetUserEmail;
      }

      const user = await prisma.user.findUnique({
        where: { email: userEmail },
        select: { name: true },
      });

      if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }
      sgaName = user.name;
    }

    const records = await getInitialCallsDrillDown(sgaName, weekStartDate, weekEndDate);

    return NextResponse.json({ records });
  } catch (error) {
    console.error('Error fetching initial calls drill-down:', error);
    return NextResponse.json(
      { error: 'Failed to fetch initial calls records' },
      { status: 500 }
    );
  }
}
