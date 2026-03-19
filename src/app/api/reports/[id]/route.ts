import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, getSessionUserId } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = getSessionPermissions(session);
    if (!permissions || !permissions.allowedPages.includes(17)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const userId = getSessionUserId(session);
    if (!userId) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const report = await prisma.reportJob.findUnique({
      where: { id: params.id },
      include: {
        conversations: {
          orderBy: { createdAt: 'asc' },
          take: 20,
        },
      },
    });

    if (!report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    // Owner check
    if (report.requestedById !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return NextResponse.json(report);
  } catch (error) {
    logger.error('[GET /api/reports/[id]] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch report' }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = getSessionPermissions(session);
    if (!permissions || !permissions.allowedPages.includes(17)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const userId = getSessionUserId(session);
    if (!userId) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const report = await prisma.reportJob.findUnique({
      where: { id: params.id },
    });

    if (!report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    if (report.requestedById !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await prisma.reportJob.delete({ where: { id: params.id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('[DELETE /api/reports/[id]] Error:', error);
    return NextResponse.json({ error: 'Failed to delete report' }, { status: 500 });
  }
}
