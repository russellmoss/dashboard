-- CreateTable: ManagerQuarterlyGoal
-- Migration: add_manager_quarterly_goals
-- This SQL can be run directly in Neon's SQL editor

-- Create the manager_quarterly_goals table
CREATE TABLE "manager_quarterly_goals" (
    "id" TEXT NOT NULL,
    "quarter" TEXT NOT NULL,
    "sqoGoal" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "manager_quarterly_goals_pkey" PRIMARY KEY ("id")
);

-- Create unique constraint on quarter (one goal per quarter)
CREATE UNIQUE INDEX "manager_quarterly_goals_quarter_key" ON "manager_quarterly_goals"("quarter");

-- Create index on quarter for fast lookups
CREATE INDEX "manager_quarterly_goals_quarter_idx" ON "manager_quarterly_goals"("quarter");
