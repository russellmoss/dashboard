import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getSessionPermissions } from '@/types/auth';
import { forbidRecruiter, forbidCapitalPartner } from '@/lib/api-authz';

interface RouteParams {
  params: { id: string };
}

/**
 * GET /api/saved-reports/[id]
 * Get a specific saved report
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
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

    const cpForbidden = forbidCapitalPartner(permissions);
    if (cpForbidden) return cpForbidden;

    const report = await prisma.savedReport.findUnique({
      where: { id: params.id },
    });

    if (!report || !report.isActive) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    // Check access: user owns it OR it's an admin template
    const canAccess = report.userId === permissions.userId || report.reportType === 'admin_template';
    if (!canAccess) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    return NextResponse.json({ 
      report: {
        ...report,
        filters: report.filters as any,
        featureSelection: report.featureSelection as any,
      }
    });
  } catch (error) {
    logger.error('[GET /api/saved-reports/[id]] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch saved report' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/saved-reports/[id]
 * Update a saved report
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
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

    const cpForbidden = forbidCapitalPartner(permissions);
    if (cpForbidden) return cpForbidden;

    const existingReport = await prisma.savedReport.findUnique({
      where: { id: params.id },
    });

    if (!existingReport || !existingReport.isActive) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    // Check edit permission: user owns it OR (it's admin template AND user is admin/manager)
    const isOwner = existingReport.userId === permissions.userId;
    const isAdminEditingTemplate = 
      existingReport.reportType === 'admin_template' && 
      ['admin', 'manager'].includes(permissions.role);
    
    if (!isOwner && !isAdminEditingTemplate) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const body = await request.json();
    const { name, description, filters, featureSelection, viewMode, isDefault } = body;

    // Validate name if provided
    if (name && name.length > 255) {
      return NextResponse.json(
        { error: 'Name must be 255 characters or less' },
        { status: 400 }
      );
    }

    // If setting as default, unset any existing default for this user
    if (isDefault && existingReport.reportType === 'user') {
      await prisma.savedReport.updateMany({
        where: {
          userId: permissions.userId,
          isDefault: true,
          isActive: true,
          id: { not: params.id },
        },
        data: { isDefault: false },
      });
    }

    const report = await prisma.savedReport.update({
      where: { id: params.id },
      data: {
        ...(name && { name: name.trim() }),
        ...(description !== undefined && { description: description?.trim() || null }),
        ...(filters && { filters }),
        ...(featureSelection !== undefined && { featureSelection }),
        ...(viewMode && { viewMode }),
        ...(isDefault !== undefined && existingReport.reportType === 'user' && { isDefault }),
      },
    });

    logger.info('[PUT /api/saved-reports/[id]] Updated report', {
      reportId: report.id,
      userId: permissions.userId,
    });

    return NextResponse.json({ 
      report: {
        ...report,
        filters: report.filters as any,
        featureSelection: report.featureSelection as any,
      }
    });
  } catch (error) {
    logger.error('[PUT /api/saved-reports/[id]] Error:', error);
    return NextResponse.json(
      { error: 'Failed to update saved report' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/saved-reports/[id]
 * Soft delete a saved report
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
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

    const cpForbidden = forbidCapitalPartner(permissions);
    if (cpForbidden) return cpForbidden;

    const existingReport = await prisma.savedReport.findUnique({
      where: { id: params.id },
    });

    if (!existingReport || !existingReport.isActive) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    // Check delete permission: user owns it OR (it's admin template AND user is admin/manager)
    const isOwner = existingReport.userId === permissions.userId;
    const isAdminDeletingTemplate = 
      existingReport.reportType === 'admin_template' && 
      ['admin', 'manager'].includes(permissions.role);
    
    if (!isOwner && !isAdminDeletingTemplate) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Soft delete
    await prisma.savedReport.update({
      where: { id: params.id },
      data: { isActive: false },
    });

    logger.info('[DELETE /api/saved-reports/[id]] Deleted report', {
      reportId: params.id,
      userId: permissions.userId,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('[DELETE /api/saved-reports/[id]] Error:', error);
    return NextResponse.json(
      { error: 'Failed to delete saved report' },
      { status: 500 }
    );
  }
}
