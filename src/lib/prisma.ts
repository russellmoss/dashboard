import { PrismaClient } from '@prisma/client';
import { logger } from './logger';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Get database URL from environment variables
// Neon: POSTGRES_URL or DATABASE_URL
// Vercel Postgres: POSTGRES_PRISMA_URL
function getDatabaseUrl(): string {
  // Check all possible environment variable names
  let url = 
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
  
  // For Neon databases, ensure connection parameters are set for local development
  // Add connection timeout and pool settings to prevent connection failures
  if (url.includes('neon.tech') || url.includes('neon')) {
    try {
      const urlObj = new URL(url);
      
      // Set connection timeout (30 seconds for local dev, 15 for production)
      const connectTimeout = process.env.NODE_ENV === 'development' ? '30' : '15';
      urlObj.searchParams.set('connect_timeout', connectTimeout);
      
      // Set statement timeout (60 seconds)
      urlObj.searchParams.set('statement_timeout', '60000');
      
      // Ensure SSL is required
      if (!urlObj.searchParams.has('sslmode')) {
        urlObj.searchParams.set('sslmode', 'require');
      }
      
      // For local development, prefer direct connection if DIRECT_URL is available
      // This avoids pooler issues during development
      if (process.env.NODE_ENV === 'development' && process.env.DIRECT_URL) {
        logger.debug('[Prisma] Using DIRECT_URL for local development');
        url = process.env.DIRECT_URL;
      } else {
        url = urlObj.toString();
      }
    } catch (e) {
      // If URL parsing fails, use original URL
      logger.warn('[Prisma] Failed to parse DATABASE_URL, using as-is', { error: e });
    }
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

  logger.debug('[Prisma] Initializing PrismaClient', {
    hasDatabaseUrl: !!process.env.DATABASE_URL,
    databaseUrlPrefix: process.env.DATABASE_URL?.substring(0, 30) || 'NOT SET',
  });

  try {
    // Create PrismaClient - Prisma 7 with binary engine reads DATABASE_URL from process.env
    // Configure connection pool and timeout settings for Neon
    globalForPrisma.prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
      datasources: {
        db: {
          url: dbUrl,
        },
      },
      // Connection pool configuration for Neon
      // These help prevent connection timeout issues in local development
      ...(process.env.NODE_ENV === 'development' && {
        // Extended connection timeout for local dev (Neon can take time to wake up)
        __internal: {
          engine: {
            connectTimeout: 30000, // 30 seconds
          },
        },
      }),
    });

    logger.info('[Prisma] PrismaClient created successfully');
    return globalForPrisma.prisma;
  } catch (error: any) {
    logger.error('[Prisma] Failed to create PrismaClient', error, {
      hasDatabaseUrl: !!process.env.DATABASE_URL,
    });
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
