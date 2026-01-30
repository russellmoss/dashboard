import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { RequestStatus, RequestPriority } from '@prisma/client';
import { syncUpdateToWrike, deleteFromWrike } from '@/lib/wrike';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Check if user can view a request
 */
async function canViewRequest(
  userId: string,
  canManageRequests: boolean,
  request: { submitterId: string; isPrivate: boolean; status: string }
): Promise<boolean> {
  if (canManageRequests) return true;
  if (request.submitterId === userId) return true;
  if (!request.isPrivate && request.status !== RequestStatus.SUBMITTED) return true;
  return false;
}

/**
 * GET /api/dashboard-requests/[id]
 * Get a single request with all details
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

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

    const dashboardRequest = await prisma.dashboardRequest.findUnique({
      where: { id },
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
          orderBy: { createdAt: 'asc' },
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

    if (!dashboardRequest) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }

    // Check visibility
    const canView = await canViewRequest(user.id, permissions.canManageRequests, dashboardRequest);
    if (!canView) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return NextResponse.json({ request: dashboardRequest });
  } catch (error) {
    console.error('[API] Error fetching dashboard request:', error);
    return NextResponse.json(
      { error: 'Failed to fetch request' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/dashboard-requests/[id]
 * Update a request (RevOps Admin can update any, users can update their own)
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

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

    // Get existing request
    const existingRequest = await prisma.dashboardRequest.findUnique({
      where: { id },
    });

    if (!existingRequest) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }

    // Check permissions
    const isOwner = existingRequest.submitterId === user.id;
    if (!permissions.canManageRequests && !isOwner) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const {
      title,
      description,
      priority,
      affectedPage,
      filtersApplied,
      valueSeen,
      valueExpected,
      errorOccurredAt,
      isPrivate,
    } = body;

    // Build update data and track changes for history
    const updateData: any = {};
    const historyEntries: any[] = [];

    if (title !== undefined && title !== existingRequest.title) {
      updateData.title = title;
      historyEntries.push({
        fieldName: 'title',
        oldValue: existingRequest.title,
        newValue: title,
        editedById: user.id,
      });
    }

    if (description !== undefined && description !== existingRequest.description) {
      updateData.description = description;
      historyEntries.push({
        fieldName: 'description',
        oldValue: existingRequest.description,
        newValue: description,
        editedById: user.id,
      });
    }

    if (priority !== undefined && priority !== existingRequest.priority) {
      if (priority && !Object.values(RequestPriority).includes(priority)) {
        return NextResponse.json({ error: 'Invalid priority' }, { status: 400 });
      }
      updateData.priority = priority || null;
      historyEntries.push({
        fieldName: 'priority',
        oldValue: existingRequest.priority,
        newValue: priority || null,
        editedById: user.id,
      });
    }

    if (affectedPage !== undefined && affectedPage !== existingRequest.affectedPage) {
      updateData.affectedPage = affectedPage || null;
      historyEntries.push({
        fieldName: 'affectedPage',
        oldValue: existingRequest.affectedPage,
        newValue: affectedPage || null,
        editedById: user.id,
      });
    }

    if (filtersApplied !== undefined && filtersApplied !== existingRequest.filtersApplied) {
      updateData.filtersApplied = filtersApplied || null;
    }

    if (valueSeen !== undefined && valueSeen !== existingRequest.valueSeen) {
      updateData.valueSeen = valueSeen || null;
    }

    if (valueExpected !== undefined && valueExpected !== existingRequest.valueExpected) {
      updateData.valueExpected = valueExpected || null;
    }

    if (errorOccurredAt !== undefined) {
      const newDate = errorOccurredAt ? new Date(errorOccurredAt) : null;
      updateData.errorOccurredAt = newDate;
    }

    // Only RevOps Admin can change privacy
    if (isPrivate !== undefined && permissions.canManageRequests && isPrivate !== existingRequest.isPrivate) {
      updateData.isPrivate = isPrivate;
      historyEntries.push({
        fieldName: 'isPrivate',
        oldValue: String(existingRequest.isPrivate),
        newValue: String(isPrivate),
        editedById: user.id,
      });
    }

    // Update the request and create history entries in a transaction
    const updatedRequest = await prisma.$transaction(async (tx) => {
      // Create history entries
      if (historyEntries.length > 0) {
        await tx.requestEditHistory.createMany({
          data: historyEntries.map((entry) => ({
            ...entry,
            requestId: id,
          })),
        });
      }

      // Update the request
      return tx.dashboardRequest.update({
        where: { id },
        data: updateData,
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
            orderBy: { createdAt: 'asc' },
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
    });

    // Sync relevant changes to Wrike in background
    if (title || description || priority !== undefined) {
      syncUpdateToWrike(id, { title, description, priority }).catch((err) => {
        console.error('[API] Background Wrike update sync failed:', err);
      });
    }

    return NextResponse.json({ request: updatedRequest });
  } catch (error) {
    console.error('[API] Error updating dashboard request:', error);
    return NextResponse.json(
      { error: 'Failed to update request' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/dashboard-requests/[id]
 * Delete a request (RevOps Admin only, or owner if in SUBMITTED status)
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

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

    const existingRequest = await prisma.dashboardRequest.findUnique({
      where: { id },
    });

    if (!existingRequest) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }

    // Check permissions
    const isOwner = existingRequest.submitterId === user.id;
    const canDelete = permissions.canManageRequests ||
      (isOwner && existingRequest.status === RequestStatus.SUBMITTED);

    if (!canDelete) {
      return NextResponse.json(
        { error: 'You can only delete your own requests while in Submitted status' },
        { status: 403 }
      );
    }

    // Delete from Wrike first (before we lose the wrikeTaskId)
    await deleteFromWrike(id);

    await prisma.dashboardRequest.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API] Error deleting dashboard request:', error);
    return NextResponse.json(
      { error: 'Failed to delete request' },
      { status: 500 }
    );
  }
}
