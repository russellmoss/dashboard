import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { forbidRecruiter } from '@/lib/api-authz';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

interface RouteParams {
  params: { id: string };
}

/**
 * POST /api/saved-reports/[id]/duplicate
 * Duplicate an existing report (user reports or admin templates)
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Block recruiters from saved reports
    const permissions = await getUserPermissions(session.user.email);
    const forbidden = forbidRecruiter(permissions);
    if (forbidden) return forbidden;

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const sourceReport = await prisma.savedReport.findUnique({
      where: { id: params.id },
    });

    if (!sourceReport || !sourceReport.isActive) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    // Check access: user owns it OR it's an admin template
    const canAccess = sourceReport.userId === user.id || sourceReport.reportType === 'admin_template';
    if (!canAccess) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Optional: allow custom name from request body
    const body = await request.json().catch(() => ({}));
    const customName = body.name;

    // Generate new name
    const newName = customName || `${sourceReport.name} (Copy)`;

    // Create duplicate (always as user report, never as template)
    const duplicatedReport = await prisma.savedReport.create({
      data: {
        userId: user.id,
        name: newName.substring(0, 255), // Ensure max length
        description: sourceReport.description,
        filters: sourceReport.filters as any,
        featureSelection: sourceReport.featureSelection as any,
        viewMode: sourceReport.viewMode,
        dashboard: sourceReport.dashboard,
        reportType: 'user', // Always user report
        isDefault: false,
        createdBy: session.user.email,
      },
    });

    logger.info('[POST /api/saved-reports/[id]/duplicate] Duplicated report', {
      sourceReportId: params.id,
      newReportId: duplicatedReport.id,
      userId: user.id,
    });

    return NextResponse.json({ 
      report: {
        ...duplicatedReport,
        filters: duplicatedReport.filters as any,
        featureSelection: duplicatedReport.featureSelection as any,
      }
    }, { status: 201 });
  } catch (error) {
    logger.error('[POST /api/saved-reports/[id]/duplicate] Error:', error);
    return NextResponse.json(
      { error: 'Failed to duplicate report' },
      { status: 500 }
    );
  }
}
