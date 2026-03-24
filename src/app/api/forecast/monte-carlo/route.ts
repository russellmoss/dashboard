import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { canAccessPage } from '@/lib/permissions';
import { runMonteCarlo, MonteCarloRequest } from '@/lib/queries/forecast-monte-carlo';
import { getTieredForecastRates } from '@/lib/queries/forecast-rates';

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

    // Fetch tiered historical rates
    const tieredRates = await getTieredForecastRates(body.conversionWindowDays ?? null);

    // If manual rate overrides are provided (from ScenarioRunner), apply them
    // to all tiers uniformly — the scenario runner uses flat overrides
    let effectiveRates = tieredRates;
    if (body.conversionRates) {
      const overrides = body.conversionRates;
      const overrideRateSet = {
        ...tieredRates.flat,
        sqo_to_sp: overrides.sqo_to_sp,
        sp_to_neg: overrides.sp_to_neg,
        neg_to_signed: overrides.neg_to_signed,
        signed_to_joined: overrides.signed_to_joined,
      };
      effectiveRates = {
        flat: overrideRateSet,
        lower: overrideRateSet,
        upper: overrideRateSet,
      };
    }

    const avgDays = body.avgDays ?? {
      in_sp: tieredRates.flat.avg_days_in_sp,
      in_neg: tieredRates.flat.avg_days_in_neg,
      in_signed: tieredRates.flat.avg_days_in_signed,
    };

    const results = await runMonteCarlo(effectiveRates, avgDays);
    return NextResponse.json(results);
  } catch (error) {
    console.error('Monte Carlo error:', error);
    return NextResponse.json(
      { error: 'Monte Carlo simulation failed' },
      { status: 500 }
    );
  }
}
