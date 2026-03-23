import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { prisma } from '@/lib/prisma';

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

    const userId = permissions.userId;

    const scenarios = await prisma.forecastScenario.findMany({
      where: {
        OR: [
          { isPublic: true },
          ...(userId ? [{ createdById: userId }] : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        description: true,
        createdAt: true,
        createdByName: true,
        createdById: true,
        conversionWindowDays: true,
        isBaseForecast: true,
        rateOverride_sqo_to_sp: true,
        rateOverride_sp_to_neg: true,
        rateOverride_neg_to_signed: true,
        rateOverride_signed_to_joined: true,
        avgDaysOverride_in_sp: true,
        avgDaysOverride_in_neg: true,
        avgDaysOverride_in_signed: true,
        historicalRate_sqo_to_sp: true,
        historicalRate_sp_to_neg: true,
        historicalRate_neg_to_signed: true,
        historicalRate_signed_to_joined: true,
        trialCount: true,
        quartersJson: true,
        pipelineOppCount: true,
        pipelineTotalAum: true,
        shareToken: true,
        isPublic: true,
      },
    });

    return NextResponse.json({ scenarios });
  } catch (error) {
    console.error('Scenarios list error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch scenarios' },
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

    const scenario = await prisma.forecastScenario.create({
      data: {
        name: body.name,
        description: body.description || null,
        createdById: permissions.userId!,
        createdByName: session.user.name || session.user.email!,
        conversionWindowDays: body.conversionWindowDays ?? null,
        isBaseForecast: body.isBaseForecast ?? false,
        rateOverride_sqo_to_sp: body.rateOverride_sqo_to_sp,
        rateOverride_sp_to_neg: body.rateOverride_sp_to_neg,
        rateOverride_neg_to_signed: body.rateOverride_neg_to_signed,
        rateOverride_signed_to_joined: body.rateOverride_signed_to_joined,
        avgDaysOverride_in_sp: body.avgDaysOverride_in_sp,
        avgDaysOverride_in_neg: body.avgDaysOverride_in_neg,
        avgDaysOverride_in_signed: body.avgDaysOverride_in_signed,
        historicalRate_sqo_to_sp: body.historicalRate_sqo_to_sp,
        historicalRate_sp_to_neg: body.historicalRate_sp_to_neg,
        historicalRate_neg_to_signed: body.historicalRate_neg_to_signed,
        historicalRate_signed_to_joined: body.historicalRate_signed_to_joined,
        trialCount: body.trialCount ?? 5000,
        quartersJson: body.quartersJson ?? null,
        pipelineOppCount: body.pipelineOppCount ?? null,
        pipelineTotalAum: body.pipelineTotalAum ?? null,
        isPublic: body.isPublic ?? true,
        perOppResults: body.perOppResults ?? null,
      },
    });

    return NextResponse.json({
      id: scenario.id,
      shareToken: scenario.shareToken,
      shareUrl: `/dashboard/forecast?scenario=${scenario.shareToken}`,
    });
  } catch (error) {
    console.error('Scenario create error:', error);
    return NextResponse.json(
      { error: 'Failed to create scenario' },
      { status: 500 }
    );
  }
}
