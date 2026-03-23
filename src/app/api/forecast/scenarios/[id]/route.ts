import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { prisma } from '@/lib/prisma';

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = getSessionPermissions(session);
    if (!permissions || !permissions.canRunScenarios) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const scenario = await prisma.forecastScenario.findUnique({
      where: { id: params.id },
      select: { createdById: true },
    });

    if (!scenario) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Only creator or admin can delete
    if (scenario.createdById !== permissions.userId && permissions.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await prisma.forecastScenario.delete({
      where: { id: params.id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Scenario delete error:', error);
    return NextResponse.json(
      { error: 'Failed to delete scenario' },
      { status: 500 }
    );
  }
}
