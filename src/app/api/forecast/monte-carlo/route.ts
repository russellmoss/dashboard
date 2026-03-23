import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { canAccessPage } from '@/lib/permissions';
import { runMonteCarlo, MonteCarloRequest } from '@/lib/queries/forecast-monte-carlo';
import { getForecastRates } from '@/lib/queries/forecast-rates';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = getSessionPermissions(session);
    if (!permissions || !canAccessPage(permissions, 19)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!permissions.canRunScenarios) {
      return NextResponse.json(
        { error: 'Scenario execution requires admin privileges' },
        { status: 403 }
      );
    }

    const body: MonteCarloRequest = await request.json();

    // Use provided rates or fetch historical
    let rates;
    let avgDays;

    if (body.conversionRates) {
      rates = body.conversionRates;
    } else {
      const historical = await getForecastRates(body.conversionWindowDays ?? null);
      rates = {
        sqo_to_sp: historical.sqo_to_sp,
        sp_to_neg: historical.sp_to_neg,
        neg_to_signed: historical.neg_to_signed,
        signed_to_joined: historical.signed_to_joined,
      };
    }

    if (body.avgDays) {
      avgDays = body.avgDays;
    } else {
      const historical = await getForecastRates(body.conversionWindowDays ?? null);
      avgDays = {
        in_sp: historical.avg_days_in_sp,
        in_neg: historical.avg_days_in_neg,
        in_signed: historical.avg_days_in_signed,
      };
    }

    const results = await runMonteCarlo(rates, avgDays);
    return NextResponse.json(results);
  } catch (error) {
    console.error('Monte Carlo error:', error);
    return NextResponse.json(
      { error: 'Monte Carlo simulation failed' },
      { status: 500 }
    );
  }
}
