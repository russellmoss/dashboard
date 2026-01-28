import bcrypt from 'bcryptjs';
import type { Prisma } from '@prisma/client';
import prisma from './prisma';
import { logger } from './logger';

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'manager' | 'sgm' | 'sga' | 'viewer';
  isActive?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
  createdBy?: string | null;
}

// Retry helper for database operations (handles Neon connection timeouts)
async function retryDatabaseOperation<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      
      // Check if it's a connection error that might be retryable
      const isConnectionError = 
        error?.message?.includes('Can\'t reach database server') ||
        error?.message?.includes('connection') ||
        error?.code === 'P1001' || // Prisma connection error code
        error?.name === 'PrismaClientInitializationError';
      
      if (isConnectionError && attempt < maxRetries) {
        logger.warn(`[retryDatabaseOperation] Connection error (attempt ${attempt}/${maxRetries}), retrying...`, {
          error: error.message,
          attempt,
        });
        await new Promise(resolve => setTimeout(resolve, delayMs * attempt)); // Exponential backoff
        continue;
      }
      
      // If not a connection error or last attempt, throw immediately
      throw error;
    }
  }
  
  throw lastError || new Error('Database operation failed after retries');
}

export async function validateUser(
  email: string,
  password: string
): Promise<User | null> {
  const normalizedEmail = email.toLowerCase();
  logger.debug('[validateUser] Looking up user', { email: normalizedEmail });

  try {
    const user = await retryDatabaseOperation(async () => {
      return await prisma.user.findUnique({
        where: { email: normalizedEmail },
      });
    });

    if (!user) {
      logger.warn('[validateUser] User not found in database', { email: normalizedEmail });
      return null;
    }

    // Check if user is active
    if (user.isActive === false) {
      logger.warn('[validateUser] User is inactive', { email: normalizedEmail });
      return null;
    }

    // OAuth-only users have no password; they must sign in with Google
    if (!user.passwordHash) {
      logger.warn('[validateUser] User has no password (OAuth-only)', { email: normalizedEmail });
      return null;
    }

    logger.debug('[validateUser] User found, comparing password', { email: normalizedEmail });
    const isValid = await bcrypt.compare(password, user.passwordHash);

    if (!isValid) {
      logger.warn('[validateUser] Password comparison failed', { email: normalizedEmail });
      return null;
    }

    logger.debug('[validateUser] Password valid, returning user', { email: user.email });
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as User['role'],
      isActive: user.isActive ?? true,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      createdBy: user.createdBy,
    };
  } catch (error) {
    logger.error('[validateUser] Database error', error);
    throw error;
  }
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });

  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as User['role'],
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    isActive: user.isActive ?? true,
    createdBy: user.createdBy,
  };
}

export async function getUserById(id: string): Promise<User | null> {
  const user = await prisma.user.findUnique({
    where: { id },
  });

  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as User['role'],
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    isActive: user.isActive ?? true,
    createdBy: user.createdBy,
  };
}

export async function getAllUsers(): Promise<User[]> {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
  });

  return users.map((user) => ({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as User['role'],
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    isActive: user.isActive ?? true,
    createdBy: user.createdBy,
  }));
}

export async function createUser(
  data: { email: string; name: string; password?: string; role: string; isActive?: boolean },
  createdBy: string
): Promise<User> {
  const existingUser = await prisma.user.findUnique({
    where: { email: data.email.toLowerCase() },
  });

  if (existingUser) {
    throw new Error('User with this email already exists');
  }

  const passwordHash =
    data.password != null && data.password !== ''
      ? await bcrypt.hash(data.password, 10)
      : null;

  const createData = {
    email: data.email.toLowerCase(),
    name: data.name,
    role: data.role,
    isActive: data.isActive ?? true,
    createdBy,
    ...(passwordHash !== null && { passwordHash }),
  } as Prisma.UserUncheckedCreateInput;

  const user = await prisma.user.create({
    data: createData,
  });

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as User['role'],
    isActive: user.isActive ?? true,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    createdBy: user.createdBy,
  };
}

export async function updateUser(
  id: string,
  data: { name?: string; role?: string; password?: string; isActive?: boolean }
): Promise<User> {
  const updateData: any = {};
  
  if (data.name) updateData.name = data.name;
  if (data.role) updateData.role = data.role;
  if (data.password) updateData.passwordHash = await bcrypt.hash(data.password, 10);
  if (typeof data.isActive === 'boolean') updateData.isActive = data.isActive;

  const user = await prisma.user.update({
    where: { id },
    data: updateData,
  });

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as User['role'],
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    isActive: user.isActive ?? true,
    createdBy: user.createdBy,
  };
}

export async function deleteUser(id: string): Promise<void> {
  await prisma.user.delete({
    where: { id },
  });
}

export async function resetPassword(id: string, newPassword?: string): Promise<string> {
  const password = newPassword || 'Savvy1234!';
  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.user.update({
    where: { id },
    data: { passwordHash },
  });

  return password;
}
