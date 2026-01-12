import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Prisma will automatically read DATABASE_URL from environment
// For Neon: POSTGRES_URL or DATABASE_URL
// For Vercel Postgres: POSTGRES_PRISMA_URL
// We ensure the env var is set before Prisma reads it
if (!process.env.DATABASE_URL) {
  // Set DATABASE_URL from Neon/Vercel Postgres env vars if not already set
  process.env.DATABASE_URL = 
    process.env.POSTGRES_PRISMA_URL || 
    process.env.POSTGRES_URL || 
    process.env.DATABASE_URL || 
    '';
}

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;
