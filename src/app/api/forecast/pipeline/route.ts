import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { canAccessPage } from '@/lib/permissions';
import { getForecastPipeline } from '@/lib/queries/forecast-pipeline';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = getSessionPermissions(session);
    if (!permissions || !canAccessPage(permissions, 19)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { records, summary } = await getForecastPipeline(
      permissions.sgmFilter,
      permissions.sgaFilter
    );

    return NextResponse.json({ records, summary });
  } catch (error) {
    console.error('Forecast pipeline error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch forecast pipeline' },
      { status: 500 }
    );
  }
}
