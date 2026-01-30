import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, getSessionUserId } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { forbidRecruiter } from '@/lib/api-authz';
import { getAvailableLevels } from '@/lib/queries/pipeline-catcher';
import { getCurrentQuarter } from '@/config/game-constants';
import prisma from '@/lib/prisma';
import { LevelsApiResponse } from '@/types/game';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
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

    const levels = await getAvailableLevels();
    
    // Get high scores (top score per quarter)
    // Note: Prisma doesn't support distinct on multiple fields easily, so we query each quarter separately
    const quarterList = levels.map(l => l.quarter);
    const topScores = await Promise.all(
      quarterList.map(async (quarter) => {
        const topScore = await prisma.gameScore.findFirst({
          where: { quarter },
          orderBy: { score: 'desc' },
          include: { user: { select: { name: true } } },
        });
        return topScore ? { ...topScore } : null;
      })
    );
    const validTopScores = topScores.filter((s): s is NonNullable<typeof s> => s !== null);
    
    const levelsWithScores = levels.map(level => {
      const topScore = validTopScores.find(ts => ts.quarter === level.quarter);
      return {
        ...level,
        highScore: topScore ? {
          playerName: topScore.user.name.split(' ')[0] + ' ' + (topScore.user.name.split(' ')[1]?.[0] || '') + '.',
          score: Number(topScore.score),
        } : undefined,
      };
    });
    
    const response: LevelsApiResponse = {
      levels: levelsWithScores,
      currentQuarter: getCurrentQuarter(),
    };
    
    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching game levels:', error);
    return NextResponse.json({ error: 'Failed to fetch game levels' }, { status: 500 });
  }
}
