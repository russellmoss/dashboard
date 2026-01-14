// src/lib/queries/weekly-goals.ts

import { prisma } from '@/lib/prisma';
import { WeeklyGoal, WeeklyGoalInput } from '@/types/sga-hub';
import { isMonday } from '@/lib/utils/sga-hub-helpers';

/**
 * Get weekly goals for a specific user within a date range
 */
export async function getWeeklyGoals(
  userEmail: string,
  startDate?: string,
  endDate?: string
): Promise<WeeklyGoal[]> {
  const where: any = { userEmail };
  
  if (startDate || endDate) {
    where.weekStartDate = {};
    if (startDate) {
      where.weekStartDate.gte = new Date(startDate);
    }
    if (endDate) {
      where.weekStartDate.lte = new Date(endDate);
    }
  }
  
  const goals = await prisma.weeklyGoal.findMany({
    where,
    orderBy: { weekStartDate: 'desc' },
  });
  
  return goals.map(transformWeeklyGoal);
}

/**
 * Get a single weekly goal by user and week
 */
export async function getWeeklyGoalByWeek(
  userEmail: string,
  weekStartDate: string
): Promise<WeeklyGoal | null> {
  const goal = await prisma.weeklyGoal.findUnique({
    where: {
      userEmail_weekStartDate: {
        userEmail,
        weekStartDate: new Date(weekStartDate),
      },
    },
  });
  
  return goal ? transformWeeklyGoal(goal) : null;
}

/**
 * Create or update a weekly goal
 */
export async function upsertWeeklyGoal(
  userEmail: string,
  input: WeeklyGoalInput,
  updatedBy: string
): Promise<WeeklyGoal> {
  // Validate weekStartDate is a Monday
  if (!isMonday(input.weekStartDate)) {
    throw new Error('weekStartDate must be a Monday');
  }
  
  // Validate goals are non-negative
  if (input.initialCallsGoal < 0 || input.qualificationCallsGoal < 0 || input.sqoGoal < 0) {
    throw new Error('Goal values must be non-negative');
  }
  
  const weekStartDate = new Date(input.weekStartDate);
  
  const goal = await prisma.weeklyGoal.upsert({
    where: {
      userEmail_weekStartDate: {
        userEmail,
        weekStartDate,
      },
    },
    update: {
      initialCallsGoal: input.initialCallsGoal,
      qualificationCallsGoal: input.qualificationCallsGoal,
      sqoGoal: input.sqoGoal,
      updatedBy,
    },
    create: {
      userEmail,
      weekStartDate,
      initialCallsGoal: input.initialCallsGoal,
      qualificationCallsGoal: input.qualificationCallsGoal,
      sqoGoal: input.sqoGoal,
      createdBy: updatedBy,
      updatedBy,
    },
  });
  
  return transformWeeklyGoal(goal);
}

/**
 * Get all weekly goals for a specific week (admin view)
 */
export async function getWeeklyGoalsByWeek(
  weekStartDate: string
): Promise<WeeklyGoal[]> {
  const goals = await prisma.weeklyGoal.findMany({
    where: {
      weekStartDate: new Date(weekStartDate),
    },
    orderBy: { userEmail: 'asc' },
  });
  
  return goals.map(transformWeeklyGoal);
}

/**
 * Get all SGA weekly goals within a date range (admin view)
 */
export async function getAllSGAWeeklyGoals(
  startDate: string,
  endDate: string
): Promise<WeeklyGoal[]> {
  const goals = await prisma.weeklyGoal.findMany({
    where: {
      weekStartDate: {
        gte: new Date(startDate),
        lte: new Date(endDate),
      },
    },
    orderBy: [
      { weekStartDate: 'desc' },
      { userEmail: 'asc' },
    ],
  });
  
  return goals.map(transformWeeklyGoal);
}

/**
 * Delete a weekly goal (admin only)
 */
export async function deleteWeeklyGoal(
  userEmail: string,
  weekStartDate: string
): Promise<void> {
  await prisma.weeklyGoal.delete({
    where: {
      userEmail_weekStartDate: {
        userEmail,
        weekStartDate: new Date(weekStartDate),
      },
    },
  });
}

/**
 * Copy goals from one week to another
 */
export async function copyWeeklyGoal(
  userEmail: string,
  sourceWeekStartDate: string,
  targetWeekStartDate: string,
  updatedBy: string
): Promise<WeeklyGoal | null> {
  const sourceGoal = await getWeeklyGoalByWeek(userEmail, sourceWeekStartDate);
  
  if (!sourceGoal) {
    return null;
  }
  
  return upsertWeeklyGoal(
    userEmail,
    {
      weekStartDate: targetWeekStartDate,
      initialCallsGoal: sourceGoal.initialCallsGoal,
      qualificationCallsGoal: sourceGoal.qualificationCallsGoal,
      sqoGoal: sourceGoal.sqoGoal,
    },
    updatedBy
  );
}

/**
 * Transform Prisma model to API response type
 * ✅ VERIFIED: Prisma @db.Date fields return as Date objects in JavaScript
 * weekStartDate is stored as DATE in database (via @db.Date), so it's a Date object but only contains date part
 */
function transformWeeklyGoal(goal: any): WeeklyGoal {
  // ✅ VERIFIED: Prisma Date fields (with @db.Date) return as Date objects
  // Convert to ISO string and extract date part (YYYY-MM-DD)
  const weekStartDate = goal.weekStartDate instanceof Date 
    ? goal.weekStartDate.toISOString().split('T')[0]
    : String(goal.weekStartDate).split('T')[0];
  
  return {
    id: goal.id,
    userEmail: goal.userEmail,
    weekStartDate,
    initialCallsGoal: goal.initialCallsGoal,
    qualificationCallsGoal: goal.qualificationCallsGoal,
    sqoGoal: goal.sqoGoal,
    createdAt: goal.createdAt.toISOString(),
    updatedAt: goal.updatedAt.toISOString(),
    createdBy: goal.createdBy,
    updatedBy: goal.updatedBy,
  };
}
