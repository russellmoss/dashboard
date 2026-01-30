import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { RequestStatus, RequestType, RequestPriority } from '@prisma/client';

export const dynamic = 'force-dynamic';

const KANBAN_STATUSES = [
  { status: RequestStatus.SUBMITTED, label: 'Submitted' },
  { status: RequestStatus.PLANNED, label: 'Planned' },
  { status: RequestStatus.IN_PROGRESS, label: 'In Progress' },
  { status: RequestStatus.DONE, label: 'Done' },
];

/**
 * POST /api/dashboard-requests/kanban
 * Get requests organized for Kanban board view
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = await getUserPermissions(session.user.email);

    if (permissions.role === 'recruiter') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Parse filters from body
    const body = await request.json().catch(() => ({}));
    const {
      search,
      requestType,
      priority,
      submitterId,
      dateFrom,
      dateTo,
      includeArchived,
    } = body;

    // Build where clause
    const baseWhere: any = {
      // Exclude archived by default
      ...(includeArchived ? {} : { status: { not: RequestStatus.ARCHIVED } }),
    };

    // Apply filters
    if (search) {
      baseWhere.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (requestType && Object.values(RequestType).includes(requestType)) {
      baseWhere.requestType = requestType;
    }

    if (priority && Object.values(RequestPriority).includes(priority)) {
      baseWhere.priority = priority;
    }

    if (submitterId) {
      baseWhere.submitterId = submitterId;
    }

    if (dateFrom) {
      baseWhere.createdAt = { ...baseWhere.createdAt, gte: new Date(dateFrom) };
    }

    if (dateTo) {
      baseWhere.createdAt = { ...baseWhere.createdAt, lte: new Date(dateTo) };
    }

    // Apply visibility rules
    let whereClause: any;
    if (permissions.canManageRequests) {
      // RevOps Admin sees all
      whereClause = baseWhere;
    } else {
      // Regular users see their own + non-private, non-submitted
      whereClause = {
        AND: [
          baseWhere,
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

    // Fetch all matching requests with latest comment
    const requests = await prisma.dashboardRequest.findMany({
      where: whereClause,
      include: {
        submitter: {
          select: { id: true, name: true },
        },
        _count: {
          select: { comments: true },
        },
        comments: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            author: {
              select: { name: true },
            },
          },
        },
      },
      orderBy: [
        { priority: 'desc' }, // IMMEDIATE > HIGH > MEDIUM > LOW > null
        { createdAt: 'desc' },
      ],
    });

    // Transform to card format
    const transformedRequests = requests.map((req) => ({
      id: req.id,
      title: req.title,
      requestType: req.requestType,
      status: req.status,
      priority: req.priority,
      isPrivate: req.isPrivate,
      createdAt: req.createdAt.toISOString(),
      statusChangedAt: req.statusChangedAt.toISOString(),
      submitter: req.submitter,
      _count: req._count,
      latestComment: req.comments[0]
        ? {
            content: req.comments[0].content,
            createdAt: req.comments[0].createdAt.toISOString(),
            author: req.comments[0].author,
          }
        : null,
    }));

    // Group by status for Kanban columns
    const columns = KANBAN_STATUSES.map(({ status, label }) => ({
      status,
      label,
      requests: transformedRequests.filter((r) => r.status === status),
    }));

    return NextResponse.json({
      data: {
        columns,
        totalCount: transformedRequests.length,
      },
    });
  } catch (error) {
    console.error('[API] Error fetching kanban data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch kanban data' },
      { status: 500 }
    );
  }
}
