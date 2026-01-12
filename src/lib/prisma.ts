import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Get database URL from environment variables
// Neon: POSTGRES_URL or DATABASE_URL
// Vercel Postgres: POSTGRES_PRISMA_URL
function getDatabaseUrl(): string {
  const url = 
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL ||
    '';
  
  // Ensure DATABASE_URL is set for Prisma to read
  if (url && !process.env.DATABASE_URL) {
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

  // Get database URL and ensure it's set
  const dbUrl = getDatabaseUrl();
  
  if (!dbUrl) {
    // If no database URL is available, throw a clear error
    throw new Error(
      'DATABASE_URL is required. Please set POSTGRES_URL, POSTGRES_PRISMA_URL, or DATABASE_URL environment variable. ' +
      `Current env vars: POSTGRES_PRISMA_URL=${!!process.env.POSTGRES_PRISMA_URL}, ` +
      `POSTGRES_URL=${!!process.env.POSTGRES_URL}, ` +
      `DATABASE_URL=${!!process.env.DATABASE_URL}`
    );
  }

  // Ensure DATABASE_URL is set (Prisma reads from this)
  process.env.DATABASE_URL = dbUrl;

  console.log('[Prisma] Initializing PrismaClient with DATABASE_URL:', dbUrl.substring(0, 20) + '...');

  // Create PrismaClient - Prisma will read DATABASE_URL from environment
  globalForPrisma.prisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

  return globalForPrisma.prisma;
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
