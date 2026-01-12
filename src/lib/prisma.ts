import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Get database URL from environment variables
// Neon: POSTGRES_URL or DATABASE_URL
// Vercel Postgres: POSTGRES_PRISMA_URL
function getDatabaseUrl(): string {
  return (
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL ||
    ''
  );
}

// Lazy initialization function - only creates PrismaClient when actually called
// This prevents Prisma from being instantiated during build
function getPrismaClient(): PrismaClient {
  if (globalForPrisma.prisma) {
    return globalForPrisma.prisma;
  }

  // Ensure DATABASE_URL is set
  if (!process.env.DATABASE_URL) {
    const dbUrl = getDatabaseUrl();
    if (dbUrl) {
      process.env.DATABASE_URL = dbUrl;
    } else {
      // If no database URL is available, throw an error
      // This should only happen at runtime, not during build
      throw new Error(
        'DATABASE_URL is required. Please set POSTGRES_URL, POSTGRES_PRISMA_URL, or DATABASE_URL environment variable.'
      );
    }
  }

  // Create PrismaClient - Prisma will read DATABASE_URL from environment
  globalForPrisma.prisma = new PrismaClient();

  if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = globalForPrisma.prisma;
  }

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
