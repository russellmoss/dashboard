import { PrismaClient } from '@prisma/client';
import { Pool } from 'postgres';
import { PrismaPostgres } from '@prisma/adapter-postgres';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Get database URL from environment variables
// Neon: POSTGRES_URL or DATABASE_URL
// Vercel Postgres: POSTGRES_PRISMA_URL
function getDatabaseUrl(): string {
  // Check all possible environment variable names
  const url = 
    process.env.DATABASE_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL ||
    '';
  
  if (!url) {
    throw new Error(
      'DATABASE_URL is required. Please set DATABASE_URL, POSTGRES_URL, or POSTGRES_PRISMA_URL environment variable. ' +
      `Current env vars: DATABASE_URL=${!!process.env.DATABASE_URL}, ` +
      `POSTGRES_PRISMA_URL=${!!process.env.POSTGRES_PRISMA_URL}, ` +
      `POSTGRES_URL=${!!process.env.POSTGRES_URL}`
    );
  }
  
  // Ensure DATABASE_URL is set (Prisma 7 requires this exact name)
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = url;
  }
  
  return url;
}

// Lazy initialization function - only creates PrismaClient when actually called
// This prevents Prisma from being instantiated during build
function getPrismaClient(): PrismaClient {
  if (globalForPrisma.prisma) {
    return globalForPrisma.prisma;
  }

  // Get and validate database URL
  const dbUrl = getDatabaseUrl();
  
  // Double-check DATABASE_URL is set (Prisma 7 requires this)
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = dbUrl;
  }

  console.log('[Prisma] Initializing PrismaClient');
  console.log('[Prisma] DATABASE_URL available:', !!process.env.DATABASE_URL);
  console.log('[Prisma] DATABASE_URL prefix:', process.env.DATABASE_URL?.substring(0, 30) || 'NOT SET');

  try {
    // Create PostgreSQL connection pool
    const pool = new Pool({ connectionString: dbUrl });
    const adapter = new PrismaPostgres(pool);

    // Create PrismaClient with adapter (required for Prisma 7 in serverless)
    globalForPrisma.prisma = new PrismaClient({
      adapter,
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });

    console.log('[Prisma] PrismaClient created successfully with adapter');
    return globalForPrisma.prisma;
  } catch (error: any) {
    console.error('[Prisma] Failed to create PrismaClient:', error.message);
    console.error('[Prisma] DATABASE_URL at error time:', process.env.DATABASE_URL ? 'SET' : 'NOT SET');
    throw error;
  }
}

// Export a getter that lazily initializes Prisma
// This prevents Prisma from being instantiated during build
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getPrismaClient();
    const value = (client as any)[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

export default prisma;
