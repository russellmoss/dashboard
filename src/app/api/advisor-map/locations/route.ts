import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { forbidRecruiter } from '@/lib/api-authz';
import { getAdvisorLocations, AdvisorLocationFilters } from '@/lib/queries/advisor-locations';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }

    // Block recruiters from advisor map
    const forbidden = forbidRecruiter(permissions);
    if (forbidden) return forbidden;

    const body = await request.json();
    const filters: AdvisorLocationFilters = body.filters || body;

    logger.debug('[Advisor Map API] Fetching locations', { filters });

    const result = await getAdvisorLocations(filters);

    logger.debug('[Advisor Map API] Returned locations', {
      total: result.stats.total,
      withCoords: result.stats.withCoords,
    });

    return NextResponse.json(result);
  } catch (error) {
    logger.error('Advisor locations error', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }

    const forbidden = forbidRecruiter(permissions);
    if (forbidden) return forbidden;

    // Parse query params for GET request
    const searchParams = request.nextUrl.searchParams;
    const filters: AdvisorLocationFilters = {
      startDate: searchParams.get('startDate') || undefined,
      endDate: searchParams.get('endDate') || undefined,
      sga: searchParams.get('sga') || undefined,
      sgm: searchParams.get('sgm') || undefined,
      channel: searchParams.get('channel') || undefined,
      source: searchParams.get('source') || undefined,
      coordSourceFilter: (searchParams.get('coordSourceFilter') as 'all' | 'geocoded' | 'sfdc') || undefined,
    };

    const result = await getAdvisorLocations(filters);

    return NextResponse.json(result);
  } catch (error) {
    logger.error('Advisor locations error', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
