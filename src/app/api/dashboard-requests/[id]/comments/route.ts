import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { RequestStatus } from '@prisma/client';
import { syncCommentToWrike } from '@/lib/wrike';
import { notifyNewComment } from '@/lib/notifications';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Check if user can view/comment on a request
 */
async function canAccessRequest(
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
 * POST /api/dashboard-requests/[id]/comments
 * Add a comment to a request
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

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, name: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Get the request to check access
    const dashboardRequest = await prisma.dashboardRequest.findUnique({
      where: { id },
    });

    if (!dashboardRequest) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }

    // Check if user can access this request
    const canAccess = await canAccessRequest(user.id, permissions.canManageRequests, dashboardRequest);
    if (!canAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { content } = body;

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return NextResponse.json(
        { error: 'Comment content is required' },
        { status: 400 }
      );
    }

    // Create the comment
    const comment = await prisma.requestComment.create({
      data: {
        content: content.trim(),
        requestId: id,
        authorId: user.id,
      },
      include: {
        author: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    // Sync comment to Wrike in background
    syncCommentToWrike(id, comment.id, user.name || 'Unknown', content.trim()).catch((err) => {
      console.error('[API] Background Wrike comment sync failed:', err);
    });

    // Notify request submitter of new comment in background
    notifyNewComment(id, user.id, content.trim()).catch((err) => {
      console.error('[API] Background comment notification failed:', err);
    });

    return NextResponse.json({ comment }, { status: 201 });
  } catch (error) {
    console.error('[API] Error adding comment:', error);
    return NextResponse.json(
      { error: 'Failed to add comment' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/dashboard-requests/[id]/comments
 * Get all comments for a request
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

    // Get the request to check access
    const dashboardRequest = await prisma.dashboardRequest.findUnique({
      where: { id },
    });

    if (!dashboardRequest) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }

    // Check if user can access this request
    const canAccess = await canAccessRequest(user.id, permissions.canManageRequests, dashboardRequest);
    if (!canAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const comments = await prisma.requestComment.findMany({
      where: { requestId: id },
      include: {
        author: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return NextResponse.json({ comments });
  } catch (error) {
    console.error('[API] Error fetching comments:', error);
    return NextResponse.json(
      { error: 'Failed to fetch comments' },
      { status: 500 }
    );
  }
}
