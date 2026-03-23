import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { getForecastRates } from '@/lib/queries/forecast-rates';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const windowDaysParam = searchParams.get('windowDays');
    const windowDays = windowDaysParam
      ? (parseInt(windowDaysParam) as 180 | 365 | 730)
      : null;

    const rates = await getForecastRates(windowDays);
    return NextResponse.json({ rates });
  } catch (error) {
    console.error('Forecast rates error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch forecast rates' },
      { status: 500 }
    );
  }
}
