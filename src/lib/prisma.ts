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

// Ensure DATABASE_URL is set for Prisma to read
// During build, if no URL is available, set a dummy value
// Prisma won't actually connect during build, but needs a valid format
if (!process.env.DATABASE_URL) {
  const dbUrl = getDatabaseUrl();
  if (dbUrl) {
    process.env.DATABASE_URL = dbUrl;
  } else if (process.env.NEXT_PHASE === 'phase-production-build') {
    // During build, provide a dummy URL with valid format
    // This prevents Prisma from throwing during build
    // The actual connection won't be used during build
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db?schema=public';
  }
}

// Initialize PrismaClient
// Prisma will read DATABASE_URL from environment
export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;
