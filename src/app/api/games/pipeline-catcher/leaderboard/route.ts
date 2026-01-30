import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, getSessionUserId } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { forbidRecruiter } from '@/lib/api-authz';
import prisma from '@/lib/prisma';
import { LeaderboardApiResponse, SubmitScoreRequest, SubmitScoreResponse, LeaderboardEntry } from '@/types/game';

export const dynamic = 'force-dynamic';

function formatPlayerName(fullName: string): string {
  const parts = fullName.split(' ');
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[1]?.[0] || ''}.`;
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const userId = getSessionUserId(session);
    if (!userId) {
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

    const quarter = new URL(request.url).searchParams.get('quarter');
    if (!quarter) {
      return NextResponse.json({ error: 'Quarter required' }, { status: 400 });
    }
    
    const scores = await prisma.gameScore.findMany({
      where: { quarter },
      orderBy: { score: 'desc' },
      take: 10,
      include: { user: { select: { id: true, name: true } } },
    });
    
    const entries: LeaderboardEntry[] = scores.map((score, i) => ({
      id: score.id,
      rank: i + 1,
      playerName: formatPlayerName(score.user.name),
      playerId: score.user.id,
      score: Number(score.score),
      advisorsCaught: score.advisorsCaught,
      joinedCaught: score.joinedCaught,
      message: score.message,
      playedAt: score.playedAt.toISOString(),
      isCurrentUser: score.user.id === userId,
    }));
    
    const response: LeaderboardApiResponse = {
      quarter,
      entries,
      userRank: entries.find(e => e.isCurrentUser)?.rank || null,
      userEntry: entries.find(e => e.isCurrentUser) || null,
    };
    
    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    return NextResponse.json({ error: 'Failed to fetch leaderboard' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const userId = getSessionUserId(session);
    if (!userId) {
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

    const body: SubmitScoreRequest = await request.json();
    const { quarter, score, advisorsCaught, joinedCaught, ghostsHit, gameDuration, message } = body;

    // Validate score is non-negative
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0) {
      return NextResponse.json(
        { error: 'Score must be a non-negative number' },
        { status: 400 }
      );
    }

    const newScore = await prisma.gameScore.create({
      data: {
        userId,
        quarter,
        score: BigInt(Math.floor(score)),
        advisorsCaught,
        joinedCaught: joinedCaught || 0,
        ghostsHit: ghostsHit || 0,
        gameDuration: gameDuration ?? 120,
        message: message?.slice(0, 100).trim() || null,
      },
      include: { user: { select: { id: true, name: true } } },
    });
    
    const higherScores = await prisma.gameScore.count({
      where: { quarter, score: { gt: newScore.score } },
    });
    const rank = higherScores + 1;
    
    const response: SubmitScoreResponse = {
      success: true,
      rank,
      isTopThree: rank <= 3,
      entry: {
        id: newScore.id,
        rank,
        playerName: formatPlayerName(newScore.user.name),
        playerId: newScore.user.id,
        score: Number(newScore.score),
        advisorsCaught: newScore.advisorsCaught,
        joinedCaught: newScore.joinedCaught,
        message: newScore.message,
        playedAt: newScore.playedAt.toISOString(),
        isCurrentUser: true,
      },
    };
    
    return NextResponse.json(response);
  } catch (error) {
    console.error('Error submitting score:', error);
    return NextResponse.json({ error: 'Failed to submit score' }, { status: 500 });
  }
}

/** PATCH: update message for an existing score (same user only). Prevents duplicate rows from "Save Message". */
export async function PATCH(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const userId = getSessionUserId(session);
    if (!userId) {
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

    const body = await request.json();
    const { scoreId, message } = body as { scoreId: string; message?: string };
    if (!scoreId || typeof scoreId !== 'string') {
      return NextResponse.json({ error: 'scoreId required' }, { status: 400 });
    }
    
    const updated = await prisma.gameScore.updateMany({
      where: { id: scoreId, userId },
      data: { message: message?.slice(0, 100).trim() || null },
    });
    
    if (updated.count === 0) {
      return NextResponse.json({ error: 'Score not found or not yours' }, { status: 404 });
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating score message:', error);
    return NextResponse.json({ error: 'Failed to update message' }, { status: 500 });
  }
}
