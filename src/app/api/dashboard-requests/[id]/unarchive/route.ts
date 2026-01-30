import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { RequestStatus } from '@prisma/client';
import { syncStatusToWrike } from '@/lib/wrike';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/dashboard-requests/[id]/unarchive
 * Unarchive a request (RevOps Admin only)
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
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

    // Only RevOps Admin can unarchive
    if (!permissions.canManageRequests) {
      return NextResponse.json(
        { error: 'Only RevOps Admin can unarchive requests' },
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

    if (existingRequest.status !== RequestStatus.ARCHIVED) {
      return NextResponse.json(
        { error: 'Request is not archived' },
        { status: 400 }
      );
    }

    // Unarchive the request (set status back to DONE)
    const updatedRequest = await prisma.$transaction(async (tx) => {
      // Create history entry
      await tx.requestEditHistory.create({
        data: {
          requestId: id,
          fieldName: 'status',
          oldValue: RequestStatus.ARCHIVED,
          newValue: RequestStatus.DONE,
          editedById: user.id,
        },
      });

      // Update the request
      return tx.dashboardRequest.update({
        where: { id },
        data: {
          status: RequestStatus.DONE,
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
    syncStatusToWrike(id, RequestStatus.DONE).catch((err) => {
      console.error('[API] Background Wrike unarchive sync failed:', err);
    });

    return NextResponse.json({ request: updatedRequest });
  } catch (error) {
    console.error('[API] Error unarchiving request:', error);
    return NextResponse.json(
      { error: 'Failed to unarchive request' },
      { status: 500 }
    );
  }
}
