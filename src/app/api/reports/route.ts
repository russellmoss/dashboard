import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, getSessionUserId } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { forbidRecruiter, forbidCapitalPartner } from '@/lib/api-authz';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }

    const recruiterBlock = forbidRecruiter(permissions);
    if (recruiterBlock) return recruiterBlock;

    const cpBlock = forbidCapitalPartner(permissions);
    if (cpBlock) return cpBlock;

    if (!permissions.allowedPages.includes(17)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const userId = getSessionUserId(session);
    if (!userId) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const reports = await prisma.reportJob.findMany({
      where: { requestedById: userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        type: true,
        status: true,
        customPrompt: true,
        parameters: true,
        extractedMetrics: true,
        stepsCompleted: true,
        error: true,
        durationMs: true,
        totalTokens: true,
        createdAt: true,
        completedAt: true,
      },
    });

    return NextResponse.json(reports);
  } catch (error) {
    logger.error('[GET /api/reports] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch reports' }, { status: 500 });
  }
}
