import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getSessionPermissions } from '@/types/auth';
import { forbidRecruiter } from '@/lib/api-authz';

/**
 * GET /api/saved-reports
 * Returns user's saved reports + all admin templates
 */
export async function GET(request: NextRequest) {
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

    // Block recruiters from saved reports
    const forbidden = forbidRecruiter(permissions);
    if (forbidden) return forbidden;

    // Fetch user's reports
    const userReports = await prisma.savedReport.findMany({
      where: {
        userId: permissions.userId,
        isActive: true,
        dashboard: 'funnel_performance',
      },
      orderBy: [
        { isDefault: 'desc' },
        { updatedAt: 'desc' },
      ],
    });


    // Fetch admin templates (reportType is 'admin_template')
    // Note: admin templates have userId set to track creator, but are shared with all users
    const adminTemplates = await prisma.savedReport.findMany({
      where: {
        reportType: 'admin_template',
        isActive: true,
        dashboard: 'funnel_performance',
      },
      orderBy: { name: 'asc' },
    });

    return NextResponse.json({
      userReports: userReports.map(r => ({
        ...r,
        filters: r.filters as any,
        featureSelection: r.featureSelection as any,
      })),
      adminTemplates: adminTemplates.map(r => ({
        ...r,
        filters: r.filters as any,
        featureSelection: r.featureSelection as any,
      })),
    });
  } catch (error) {
    logger.error('[GET /api/saved-reports] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch saved reports' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/saved-reports
 * Create a new saved report
 */
export async function POST(request: NextRequest) {
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

    // Block recruiters from saved reports
    const forbidden = forbidRecruiter(permissions);
    if (forbidden) return forbidden;

    const body = await request.json();
    const { name, description, filters, featureSelection, viewMode, isDefault, reportType } = body;

    // Validate required fields
    if (!name || !filters) {
      return NextResponse.json(
        { error: 'Name and filters are required' },
        { status: 400 }
      );
    }

    // Validate name length
    if (name.length > 255) {
      return NextResponse.json(
        { error: 'Name must be 255 characters or less' },
        { status: 400 }
      );
    }

    const isAdminTemplate = reportType === 'admin_template';
    if (isAdminTemplate && !['admin', 'manager'].includes(permissions.role)) {
      return NextResponse.json(
        { error: 'Only admins can create templates' },
        { status: 403 }
      );
    }

    // If setting as default, unset any existing default for this user
    // CRITICAL: Must enforce one default per user in application logic (Prisma doesn't support WHERE in @@unique)
    if (isDefault && !isAdminTemplate) {
      await prisma.savedReport.updateMany({
        where: {
          userId: permissions.userId,
          isDefault: true,
          isActive: true,
        },
        data: { isDefault: false },
      });
    }

    // Create the report
    // Note: userId is always set to track who created it, even for admin templates
    // The reportType field distinguishes between user reports and admin templates
    const report = await prisma.savedReport.create({
      data: {
        userId: permissions.userId,
        name: name.trim(),
        description: description?.trim() || null,
        filters,
        featureSelection: featureSelection || null,
        viewMode: viewMode || 'focused',
        dashboard: 'funnel_performance',
        reportType: isAdminTemplate ? 'admin_template' : 'user',
        isDefault: isDefault && !isAdminTemplate ? true : false,
        createdBy: session.user.email,
      },
    });

    logger.info('[POST /api/saved-reports] Created report', {
      reportId: report.id,
      userId: permissions.userId,
      reportType: report.reportType,
    });

    return NextResponse.json({ 
      report: {
        ...report,
        filters: report.filters as any,
        featureSelection: report.featureSelection as any,
      }
    }, { status: 201 });
  } catch (error) {
    logger.error('[POST /api/saved-reports] Error:', error);
    return NextResponse.json(
      { error: 'Failed to create saved report' },
      { status: 500 }
    );
  }
}
