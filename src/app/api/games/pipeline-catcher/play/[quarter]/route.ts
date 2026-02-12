import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, getSessionUserId } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { forbidRecruiter, forbidCapitalPartner } from '@/lib/api-authz';
import { getGameDataForQuarter } from '@/lib/queries/pipeline-catcher';
import { GameDataApiResponse } from '@/types/game';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest, 
  { params }: { params: Promise<{ quarter: string }> | { quarter: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!getSessionUserId(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Use permissions from session (derived from JWT, no DB query)
    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }

    // Block recruiters from games
    const forbidden = forbidRecruiter(permissions);
    if (forbidden) return forbidden;

    const cpForbidden = forbidCapitalPartner(permissions);
    if (cpForbidden) return cpForbidden;

    // Next.js 14+ App Router: params may be a Promise
    const resolvedParams = await Promise.resolve(params);
    const { quarter } = resolvedParams;
    if (!/^\d{4}-Q[1-4]$/.test(quarter)) {
      return NextResponse.json({ error: 'Invalid quarter format' }, { status: 400 });
    }
    
    const gameData = await getGameDataForQuarter(quarter);
    const response: GameDataApiResponse = { quarter, data: gameData };
    
    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching game data:', error);
    return NextResponse.json({ error: 'Failed to fetch game data' }, { status: 500 });
  }
}
