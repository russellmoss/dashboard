import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getSessionPermissions } from '@/types/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/notifications
 * Get all notifications for the current user
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

    const userId = permissions.userId;
    if (!userId) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Get query params
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '20', 10);

    const notifications = await prisma.requestNotification.findMany({
      where: { userId },
      include: {
        request: {
          select: { id: true, title: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100), // Cap at 100
    });

    return NextResponse.json({ notifications });
  } catch (error) {
    console.error('[API] Error fetching notifications:', error);
    return NextResponse.json(
      { error: 'Failed to fetch notifications' },
      { status: 500 }
    );
  }
}
