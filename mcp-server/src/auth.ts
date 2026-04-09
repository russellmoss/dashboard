import { Pool } from 'pg';
import crypto from 'crypto';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
});

export interface AuthenticatedUser {
  email: string;
  apiKeyId: string;
}

/**
 * Validate an API key from the Authorization: Bearer header.
 * Keys are stored as SHA-256 hashes, enabling O(1) indexed DB lookup.
 * (Council review C1: switched from bcrypt O(N) scan to SHA-256 O(1) lookup)
 */
export async function authenticateApiKey(bearerToken: string): Promise<AuthenticatedUser | null> {
  if (!bearerToken || !bearerToken.startsWith('sk-savvy-')) {
    return null;
  }

  const hashedKey = crypto.createHash('sha256').update(bearerToken).digest('hex');

  const result = await pool.query(
    `SELECT k.id AS "apiKeyId", u.email
     FROM mcp_api_keys k
     JOIN "User" u ON k."userId" = u.id
     WHERE k.key = $1
       AND k."isActive" = true
       AND u."isActive" = true
       AND u."bqAccess" = true`,
    [hashedKey]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];

  // Fire-and-forget: update lastUsedAt
  pool.query(
    'UPDATE mcp_api_keys SET "lastUsedAt" = NOW() WHERE id = $1',
    [row.apiKeyId]
  ).catch(() => {}); // non-blocking

  return { email: row.email, apiKeyId: row.apiKeyId };
}
