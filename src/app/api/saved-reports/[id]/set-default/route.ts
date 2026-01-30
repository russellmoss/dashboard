import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getSessionPermissions } from '@/types/auth';

interface RouteParams {
  params: { id: string };
}

/**
 * POST /api/saved-reports/[id]/set-default
 * Set a report as the user's default
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Use permissions from session (derived from JWT, no DB query)
    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }

    const report = await prisma.savedReport.findUnique({
      where: { id: params.id },
    });

    if (!report || !report.isActive) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    // Only user reports can be set as default (not admin templates)
    if (report.reportType === 'admin_template') {
      return NextResponse.json(
        { error: 'Admin templates cannot be set as default' },
        { status: 400 }
      );
    }

    // Check ownership
    if (report.userId !== permissions.userId) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Unset any existing default
    await prisma.savedReport.updateMany({
      where: {
        userId: permissions.userId,
        isDefault: true,
        isActive: true,
      },
      data: { isDefault: false },
    });

    // Set this report as default
    const updatedReport = await prisma.savedReport.update({
      where: { id: params.id },
      data: { isDefault: true },
    });

    logger.info('[POST /api/saved-reports/[id]/set-default] Set default', {
      reportId: params.id,
      userId: permissions.userId,
    });

    return NextResponse.json({ 
      report: {
        ...updatedReport,
        filters: updatedReport.filters as any,
        featureSelection: updatedReport.featureSelection as any,
      }
    });
  } catch (error) {
    logger.error('[POST /api/saved-reports/[id]/set-default] Error:', error);
    return NextResponse.json(
      { error: 'Failed to set default report' },
      { status: 500 }
    );
  }
}
