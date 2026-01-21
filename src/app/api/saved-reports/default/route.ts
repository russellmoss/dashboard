import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

/**
 * GET /api/saved-reports/default
 * Get the user's default saved report (if any)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const defaultReport = await prisma.savedReport.findFirst({
      where: {
        userId: user.id,
        isDefault: true,
        isActive: true,
        dashboard: 'funnel_performance',
      },
    });


    return NextResponse.json({ 
      report: defaultReport ? {
        ...defaultReport,
        filters: defaultReport.filters as any,
        featureSelection: defaultReport.featureSelection as any,
      } : null
    });
  } catch (error) {
    logger.error('[GET /api/saved-reports/default] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch default report' },
      { status: 500 }
    );
  }
}
