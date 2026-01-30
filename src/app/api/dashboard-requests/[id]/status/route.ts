import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { RequestStatus } from '@prisma/client';
import { syncStatusToWrike } from '@/lib/wrike';
import { notifyStatusChange } from '@/lib/notifications';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PATCH /api/dashboard-requests/[id]/status
 * Update request status (RevOps Admin only)
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

    // Only RevOps Admin can change status
    if (!permissions.canManageRequests) {
      return NextResponse.json(
        { error: 'Only RevOps Admin can change request status' },
        { status: 403 }
      );
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

    const body = await request.json();
    const { status } = body;

    // Validate status
    if (!status || !Object.values(RequestStatus).includes(status)) {
      return NextResponse.json(
        { error: 'Invalid status' },
        { status: 400 }
      );
    }

    const previousStatus = existingRequest.status;

    // Skip if status hasn't changed
    if (status === previousStatus) {
      const unchangedRequest = await prisma.dashboardRequest.findUnique({
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
      return NextResponse.json({ request: unchangedRequest, previousStatus });
    }

    // Update status and create history entry in a transaction
    const updatedRequest = await prisma.$transaction(async (tx) => {
      // Create history entry
      await tx.requestEditHistory.create({
        data: {
          requestId: id,
          fieldName: 'status',
          oldValue: previousStatus,
          newValue: status,
          editedById: user.id,
        },
      });

      // Update the request
      return tx.dashboardRequest.update({
        where: { id },
        data: {
          status,
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

    // Sync status change to Wrike in background
    syncStatusToWrike(id, status).catch((err) => {
      console.error('[API] Background Wrike status sync failed:', err);
    });

    // Notify submitter of status change in background
    notifyStatusChange(id, previousStatus, status).catch((err) => {
      console.error('[API] Background notification failed:', err);
    });

    return NextResponse.json({ request: updatedRequest, previousStatus });
  } catch (error) {
    console.error('[API] Error updating request status:', error);
    return NextResponse.json(
      { error: 'Failed to update status' },
      { status: 500 }
    );
  }
}
