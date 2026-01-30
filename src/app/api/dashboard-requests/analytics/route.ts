import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { prisma } from '@/lib/prisma';
import { RequestStatus, RequestType } from '@prisma/client';

export const dynamic = 'force-dynamic';

/**
 * GET /api/dashboard-requests/analytics
 * Get analytics data for dashboard requests (RevOps Admin only)
 */
export async function GET() {
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

    // Only RevOps Admin can view analytics
    if (!permissions.canManageRequests) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get date range for "this month"
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    // Total requests count
    const totalRequests = await prisma.dashboardRequest.count();

    // Requests by status
    const byStatus = await prisma.dashboardRequest.groupBy({
      by: ['status'],
      _count: { id: true },
    });

    // Requests by type
    const byType = await prisma.dashboardRequest.groupBy({
      by: ['requestType'],
      _count: { id: true },
    });

    // This month's stats
    const thisMonthFeatureRequests = await prisma.dashboardRequest.count({
      where: {
        requestType: RequestType.FEATURE_REQUEST,
        createdAt: { gte: startOfMonth, lte: endOfMonth },
      },
    });

    const thisMonthDataErrors = await prisma.dashboardRequest.count({
      where: {
        requestType: RequestType.DATA_ERROR,
        createdAt: { gte: startOfMonth, lte: endOfMonth },
      },
    });

    const thisMonthResolved = await prisma.dashboardRequest.count({
      where: {
        status: { in: [RequestStatus.DONE, RequestStatus.ARCHIVED] },
        statusChangedAt: { gte: startOfMonth, lte: endOfMonth },
      },
    });

    // Calculate average resolution time (for DONE requests)
    const resolvedRequests = await prisma.dashboardRequest.findMany({
      where: {
        status: RequestStatus.DONE,
      },
      select: {
        createdAt: true,
        statusChangedAt: true,
      },
    });

    let averageResolutionDays: number | null = null;
    if (resolvedRequests.length > 0) {
      const totalDays = resolvedRequests.reduce((sum, req) => {
        const created = new Date(req.createdAt).getTime();
        const resolved = new Date(req.statusChangedAt).getTime();
        const days = (resolved - created) / (1000 * 60 * 60 * 24);
        return sum + days;
      }, 0);
      averageResolutionDays = Math.round((totalDays / resolvedRequests.length) * 10) / 10;
    }

    // Requests by priority
    const byPriority = await prisma.dashboardRequest.groupBy({
      by: ['priority'],
      _count: { id: true },
    });

    // Recent activity (last 7 days)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const recentSubmissions = await prisma.dashboardRequest.count({
      where: {
        createdAt: { gte: sevenDaysAgo },
      },
    });

    const recentResolutions = await prisma.dashboardRequest.count({
      where: {
        status: RequestStatus.DONE,
        statusChangedAt: { gte: sevenDaysAgo },
      },
    });

    // Top submitters this month
    const topSubmitters = await prisma.dashboardRequest.groupBy({
      by: ['submitterId'],
      where: {
        createdAt: { gte: startOfMonth, lte: endOfMonth },
      },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 5,
    });

    // Get submitter names
    const submitterIds = topSubmitters.map((s) => s.submitterId);
    const submitters = await prisma.user.findMany({
      where: { id: { in: submitterIds } },
      select: { id: true, name: true },
    });

    const topSubmittersWithNames = topSubmitters.map((s) => ({
      name: submitters.find((u) => u.id === s.submitterId)?.name || 'Unknown',
      count: s._count.id,
    }));

    return NextResponse.json({
      analytics: {
        totalRequests,
        averageResolutionDays,
        thisMonth: {
          featureRequests: thisMonthFeatureRequests,
          dataErrors: thisMonthDataErrors,
          resolved: thisMonthResolved,
        },
        byStatus: byStatus.map((s) => ({
          status: s.status,
          count: s._count.id,
        })),
        byType: byType.map((t) => ({
          type: t.requestType,
          count: t._count.id,
        })),
        byPriority: byPriority.map((p) => ({
          priority: p.priority,
          count: p._count.id,
        })),
        recentActivity: {
          submissions: recentSubmissions,
          resolutions: recentResolutions,
        },
        topSubmitters: topSubmittersWithNames,
      },
    });
  } catch (error) {
    console.error('[API] Error fetching analytics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch analytics' },
      { status: 500 }
    );
  }
}
