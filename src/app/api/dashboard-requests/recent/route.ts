import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { prisma } from '@/lib/prisma';
import { RequestStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';

/**
 * GET /api/dashboard-requests/recent
 * Get recent requests for duplicate detection
 * Returns requests from last 30 days that match search query
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

    if (permissions.role === 'recruiter') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const userId = permissions.userId;
    if (!userId) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search');

    // Only search if we have at least 3 characters
    if (!search || search.length < 3) {
      return NextResponse.json({ requests: [] });
    }

    // Calculate 30 days ago
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Build visibility clause
    let visibilityClause: any;
    if (permissions.canManageRequests) {
      visibilityClause = {}; // See all
    } else {
      // Regular users see their own + non-private, non-submitted
      visibilityClause = {
        OR: [
          { submitterId: userId },
          {
            AND: [
              { isPrivate: false },
              { status: { not: RequestStatus.SUBMITTED } },
            ],
          },
        ],
      };
    }

    const requests = await prisma.dashboardRequest.findMany({
      where: {
        AND: [
          visibilityClause,
          { createdAt: { gte: thirtyDaysAgo } },
          { status: { not: RequestStatus.ARCHIVED } },
          {
            OR: [
              { title: { contains: search, mode: 'insensitive' } },
              { description: { contains: search, mode: 'insensitive' } },
            ],
          },
        ],
      },
      select: {
        id: true,
        title: true,
        requestType: true,
        status: true,
        priority: true,
        isPrivate: true,
        createdAt: true,
        statusChangedAt: true,
        submitter: {
          select: { id: true, name: true },
        },
        _count: {
          select: { comments: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    // Transform dates to ISO strings
    const transformedRequests = requests.map((req) => ({
      ...req,
      createdAt: req.createdAt.toISOString(),
      statusChangedAt: req.statusChangedAt.toISOString(),
    }));

    return NextResponse.json({ requests: transformedRequests });
  } catch (error) {
    console.error('[API] Error fetching recent requests:', error);
    return NextResponse.json(
      { error: 'Failed to fetch recent requests' },
      { status: 500 }
    );
  }
}
