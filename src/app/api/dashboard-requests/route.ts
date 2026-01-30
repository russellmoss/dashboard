import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { RequestStatus, RequestType, RequestPriority } from '@prisma/client';
import { syncToWrike } from '@/lib/wrike';

export const dynamic = 'force-dynamic';

/**
 * GET /api/dashboard-requests
 * Get all requests (with visibility rules)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = await getUserPermissions(session.user.email);

    // Block recruiter role
    if (permissions.role === 'recruiter') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get user ID for visibility filtering
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Parse query params
    const { searchParams } = new URL(request.url);
    const includeArchived = searchParams.get('includeArchived') === 'true';

    // Build where clause based on visibility rules
    let whereClause: any = {};

    if (permissions.canManageRequests) {
      // RevOps Admin sees ALL requests
      if (!includeArchived) {
        whereClause.status = { not: RequestStatus.ARCHIVED };
      }
    } else {
      // Regular users see:
      // 1. Their own submissions (any status)
      // 2. Non-private requests that are not in SUBMITTED status
      whereClause = {
        AND: [
          !includeArchived ? { status: { not: RequestStatus.ARCHIVED } } : {},
          {
            OR: [
              { submitterId: user.id },
              {
                AND: [
                  { isPrivate: false },
                  { status: { not: RequestStatus.SUBMITTED } },
                ],
              },
            ],
          },
        ],
      };
    }

    const requests = await prisma.dashboardRequest.findMany({
      where: whereClause,
      include: {
        submitter: {
          select: { id: true, name: true, email: true },
        },
        _count: {
          select: { comments: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ requests });
  } catch (error) {
    console.error('[API] Error fetching dashboard requests:', error);
    return NextResponse.json(
      { error: 'Failed to fetch requests' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/dashboard-requests
 * Create a new request
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = await getUserPermissions(session.user.email);

    // Block recruiter role
    if (permissions.role === 'recruiter') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get user
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, name: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const body = await request.json();
    const {
      title,
      description,
      requestType,
      priority,
      affectedPage,
      filtersApplied,
      valueSeen,
      valueExpected,
      errorOccurredAt,
      isPrivate,
    } = body;

    // Validate required fields
    if (!title || !description || !requestType) {
      return NextResponse.json(
        { error: 'Title, description, and request type are required' },
        { status: 400 }
      );
    }

    // Validate request type
    if (!Object.values(RequestType).includes(requestType)) {
      return NextResponse.json(
        { error: 'Invalid request type' },
        { status: 400 }
      );
    }

    // Validate priority if provided
    if (priority && !Object.values(RequestPriority).includes(priority)) {
      return NextResponse.json(
        { error: 'Invalid priority' },
        { status: 400 }
      );
    }

    // Create the request
    const dashboardRequest = await prisma.dashboardRequest.create({
      data: {
        title,
        description,
        requestType,
        priority: priority || null,
        affectedPage: affectedPage || null,
        filtersApplied: filtersApplied || null,
        valueSeen: valueSeen || null,
        valueExpected: valueExpected || null,
        errorOccurredAt: errorOccurredAt ? new Date(errorOccurredAt) : null,
        isPrivate: isPrivate || false,
        submitterId: user.id,
        status: RequestStatus.SUBMITTED,
        statusChangedAt: new Date(),
      },
      include: {
        submitter: {
          select: { id: true, name: true, email: true },
        },
        comments: {
          include: {
            author: {
              select: { id: true, name: true, email: true },
            },
          },
        },
        attachments: {
          include: {
            uploadedBy: {
              select: { id: true, name: true },
            },
          },
        },
        editHistory: {
          include: {
            editedBy: {
              select: { id: true, name: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        _count: {
          select: { comments: true },
        },
      },
    });

    // Sync to Wrike in background (don't block response)
    syncToWrike(dashboardRequest.id).catch((err) => {
      console.error('[API] Background Wrike sync failed:', err);
    });

    return NextResponse.json({ request: dashboardRequest }, { status: 201 });
  } catch (error) {
    console.error('[API] Error creating dashboard request:', error);
    return NextResponse.json(
      { error: 'Failed to create request' },
      { status: 500 }
    );
  }
}
