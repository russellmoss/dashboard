// src/lib/coachingDb.ts
//
// Raw pg Pool against the sales-coaching Neon DB.
//
// FIRST raw pg helper in this codebase. The main app DB goes through Prisma
// (src/lib/prisma.ts). The sales-coaching DB is a SEPARATE Neon project, hence
// raw pg here. Read-only, analytics-only.
//
// CONSTRAINTS.md "all Postgres goes through Prisma" applies to the main DB,
// not this secondary DB. If you extend with another secondary DB later, add a
// sibling helper alongside this one rather than overloading it.

import { Pool } from 'pg';

const globalForCoaching = globalThis as unknown as {
  coachingPool: Pool | undefined;
};

function getCoachingUrl(): string {
  // Use UNPOOLED (direct) — Neon's pooler is PgBouncer (transaction mode), which
  // disables prepared statements. Raw pg uses prepared statements by default,
  // so the pooler URL would fail at runtime.
  const url =
    process.env.SALES_COACHING_DATABASE_URL_UNPOOLED ||
    process.env.SALES_COACHING_DATABASE_URL ||
    '';
  if (!url) {
    throw new Error(
      'SALES_COACHING_DATABASE_URL_UNPOOLED is required. ' +
      'See .env.example for the Sales-Coaching Neon DB section.'
    );
  }
  return url;
}

export function getCoachingPool(): Pool {
  if (globalForCoaching.coachingPool) return globalForCoaching.coachingPool;
  globalForCoaching.coachingPool = new Pool({
    connectionString: getCoachingUrl(),
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
  return globalForCoaching.coachingPool;
}

export type AllowedRange = '7d' | '30d' | '90d' | 'all';
export const ALLOWED_RANGES: readonly AllowedRange[] = ['7d', '30d', '90d', 'all'];
