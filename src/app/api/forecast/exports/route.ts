import { NextResponse } from 'next/server';
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

    const exports = await prisma.forecastExport.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return NextResponse.json({
      exports: exports.map(e => ({
        id: e.id,
        name: e.name,
        spreadsheetUrl: e.spreadsheetUrl,
        createdAt: e.createdAt.toISOString(),
        createdBy: e.createdBy,
        windowDays: e.windowDays,
        p2RowCount: e.p2RowCount,
        auditRowCount: e.auditRowCount,
      })),
    });
  } catch (error) {
    console.error('Forecast exports list error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch exports' },
      { status: 500 }
    );
  }
}
