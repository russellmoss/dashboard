// src/lib/queries/quarterly-goals.ts

import { prisma } from '@/lib/prisma';
import { QuarterlyGoal, QuarterlyGoalInput } from '@/types/sga-hub';
import { parseQuarter } from '@/lib/utils/sga-hub-helpers';

/**
 * Get a quarterly goal for a specific user and quarter
 */
export async function getQuarterlyGoal(
  userEmail: string,
  quarter: string
): Promise<QuarterlyGoal | null> {
  const goal = await prisma.quarterlyGoal.findUnique({
    where: {
      userEmail_quarter: {
        userEmail,
        quarter,
      },
    },
  });

  return goal ? transformQuarterlyGoal(goal) : null;
}

/**
 * Get all quarterly goals for a user
 */
export async function getQuarterlyGoals(
  userEmail: string
): Promise<QuarterlyGoal[]> {
  const goals = await prisma.quarterlyGoal.findMany({
    where: { userEmail },
    orderBy: { quarter: 'desc' },
  });

  return goals.map(transformQuarterlyGoal);
}

/**
 * Create or update a quarterly goal
 */
export async function upsertQuarterlyGoal(
  input: QuarterlyGoalInput,
  updatedBy: string
): Promise<QuarterlyGoal> {
  // Validate quarter format
  const parsed = parseQuarter(input.quarter);
  if (!parsed) {
    throw new Error('Invalid quarter format. Use "YYYY-QN" (e.g., "2026-Q1")');
  }
  
  // Validate goal is non-negative
  if (input.sqoGoal < 0) {
    throw new Error('SQO goal must be non-negative');
  }
  
  const goal = await prisma.quarterlyGoal.upsert({
    where: {
      userEmail_quarter: {
        userEmail: input.userEmail,
        quarter: input.quarter,
      },
    },
    update: {
      sqoGoal: input.sqoGoal,
      updatedBy,
    },
    create: {
      userEmail: input.userEmail,
      quarter: input.quarter,
      sqoGoal: input.sqoGoal,
      createdBy: updatedBy,
      updatedBy,
    },
  });

  return transformQuarterlyGoal(goal);
}

/**
 * Get all SGA quarterly goals for a specific quarter (admin view)
 */
export async function getAllSGAQuarterlyGoals(
  quarter: string
): Promise<QuarterlyGoal[]> {
  const goals = await prisma.quarterlyGoal.findMany({
    where: { quarter },
    orderBy: { userEmail: 'asc' },
  });

  return goals.map(transformQuarterlyGoal);
}

/**
 * Get quarterly goals for multiple quarters (for historical view)
 */
export async function getQuarterlyGoalsForQuarters(
  userEmail: string,
  quarters: string[]
): Promise<QuarterlyGoal[]> {
  const goals = await prisma.quarterlyGoal.findMany({
    where: {
      userEmail,
      quarter: { in: quarters },
    },
    orderBy: { quarter: 'desc' },
  });

  return goals.map(transformQuarterlyGoal);
}

/**
 * Delete a quarterly goal (admin only)
 */
export async function deleteQuarterlyGoal(
  userEmail: string,
  quarter: string
): Promise<void> {
  await prisma.quarterlyGoal.delete({
    where: {
      userEmail_quarter: {
        userEmail,
        quarter,
      },
    },
  });
}

/**
 * Transform Prisma model to API response type
 */
function transformQuarterlyGoal(goal: any): QuarterlyGoal {
  return {
    id: goal.id,
    userEmail: goal.userEmail,
    quarter: goal.quarter,
    sqoGoal: goal.sqoGoal,
    createdAt: goal.createdAt.toISOString(),
    updatedAt: goal.updatedAt.toISOString(),
    createdBy: goal.createdBy,
    updatedBy: goal.updatedBy,
  };
}
