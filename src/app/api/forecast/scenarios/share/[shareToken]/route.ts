import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { prisma } from '@/lib/prisma';

export async function GET(
  request: NextRequest,
  { params }: { params: { shareToken: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }

    const scenario = await prisma.forecastScenario.findUnique({
      where: { shareToken: params.shareToken },
    });

    if (!scenario) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (!scenario.isPublic && scenario.createdById !== permissions.userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return NextResponse.json({ scenario });
  } catch (error) {
    console.error('Shared scenario error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch shared scenario' },
      { status: 500 }
    );
  }
}
