import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { prisma } from '@/lib/prisma';

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

    const targets = await prisma.forecastQuarterTarget.findMany({
      orderBy: { quarter: 'asc' },
    });

    const targetsByQuarter: Record<string, number> = {};
    for (const t of targets) {
      targetsByQuarter[t.quarter] = t.targetAumDollars;
    }

    return NextResponse.json({ targets: targetsByQuarter });
  } catch (error) {
    console.error('SQO targets GET error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch SQO targets' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = getSessionPermissions(session);
    if (!permissions || !permissions.canRunScenarios) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { quarter, targetAumDollars } = body;

    if (!quarter || typeof quarter !== 'string') {
      return NextResponse.json(
        { error: 'quarter is required (e.g. "Q2 2026")' },
        { status: 400 }
      );
    }

    if (targetAumDollars === undefined || typeof targetAumDollars !== 'number' || targetAumDollars < 0) {
      return NextResponse.json(
        { error: 'targetAumDollars must be a non-negative number' },
        { status: 400 }
      );
    }

    const target = await prisma.forecastQuarterTarget.upsert({
      where: { quarter },
      update: {
        targetAumDollars,
        updatedBy: session.user.email,
      },
      create: {
        quarter,
        targetAumDollars,
        updatedBy: session.user.email,
      },
    });

    return NextResponse.json({
      quarter: target.quarter,
      targetAumDollars: target.targetAumDollars,
    });
  } catch (error) {
    console.error('SQO targets POST error:', error);
    return NextResponse.json(
      { error: 'Failed to save SQO target' },
      { status: 500 }
    );
  }
}
