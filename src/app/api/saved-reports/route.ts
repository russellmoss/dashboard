import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getUserPermissions } from '@/lib/permissions'; // Required for admin permission checks

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

    // Get user from database
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Fetch user's reports
    const userReports = await prisma.savedReport.findMany({
      where: {
        userId: user.id,
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

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

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

    // Check if admin template and user has permission
    const permissions = await getUserPermissions(session.user.email);
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
          userId: user.id,
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
        userId: user.id,
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
      userId: user.id,
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
