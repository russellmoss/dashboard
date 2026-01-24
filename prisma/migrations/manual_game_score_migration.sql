-- CreateTable: GameScore
-- Migration: add_game_score_leaderboard
-- This SQL can be run directly in Neon's SQL editor

-- Create the GameScore table
CREATE TABLE "GameScore" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "score" BIGINT NOT NULL,
    "advisorsCaught" INTEGER NOT NULL,
    "joinedCaught" INTEGER NOT NULL,
    "ghostsHit" INTEGER NOT NULL,
    "quarter" TEXT NOT NULL,
    "gameDuration" INTEGER NOT NULL,
    "message" VARCHAR(100),
    "playedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameScore_pkey" PRIMARY KEY ("id")
);

-- Create foreign key constraint
ALTER TABLE "GameScore" ADD CONSTRAINT "GameScore_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create indexes for fast leaderboard queries
CREATE INDEX "GameScore_quarter_score_idx" ON "GameScore"("quarter", "score" DESC);
CREATE INDEX "GameScore_userId_idx" ON "GameScore"("userId");
CREATE INDEX "GameScore_playedAt_idx" ON "GameScore"("playedAt");
