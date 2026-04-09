import crypto from 'crypto';
import { prisma } from '@/lib/prisma';

// ============================================
// MCP API KEY GENERATION (SHA-256, not bcrypt)
// ============================================
// Council review (Gemini C1): API keys are high-entropy machine-generated strings,
// not human passwords. SHA-256 enables O(1) indexed DB lookup instead of O(N) bcrypt
// comparison. bcrypt would require fetching ALL active keys and comparing each one
// sequentially (~100ms per hash), making auth unusably slow at scale.

const KEY_PREFIX = 'sk-savvy-';

/**
 * Hash an MCP API key for storage using SHA-256.
 * Unlike bcrypt, SHA-256 is deterministic — same input always produces same hash —
 * which enables direct indexed DB lookup.
 */
export function hashMcpKey(plaintext: string): string {
  return crypto.createHash('sha256').update(plaintext).digest('hex');
}

// ============================================
// MCP API KEY LIFECYCLE
// ============================================

/**
 * Create a new MCP API key for a user.
 * Revokes any existing active keys first (same pattern as createPasswordResetToken).
 * Returns the plaintext key (shown once, never retrievable again).
 */
export async function createMcpApiKey(userId: string, label?: string): Promise<string> {
  // Step 1: Revoke all existing active keys for this user
  await prisma.mcpApiKey.updateMany({
    where: { userId, isActive: true },
    data: { isActive: false, revokedAt: new Date() },
  });

  // Step 2: Generate new key
  const randomPart = crypto.randomBytes(20).toString('hex');
  const plaintext = `${KEY_PREFIX}${randomPart}`;
  const hashedKey = hashMcpKey(plaintext);

  // Step 3: Store hashed key
  await prisma.mcpApiKey.create({
    data: {
      userId,
      key: hashedKey,
      label: label ?? null,
    },
  });

  return plaintext;
}

/**
 * Revoke all active MCP API keys for a user.
 */
export async function revokeMcpApiKeys(userId: string): Promise<void> {
  await prisma.mcpApiKey.updateMany({
    where: { userId, isActive: true },
    data: { isActive: false, revokedAt: new Date() },
  });
}

/**
 * Rotate: atomically revoke existing key and create a new one.
 * Returns the new plaintext key.
 */
export async function rotateMcpApiKey(userId: string, label?: string): Promise<string> {
  const randomPart = crypto.randomBytes(20).toString('hex');
  const plaintext = `${KEY_PREFIX}${randomPart}`;
  const hashedKey = hashMcpKey(plaintext);

  await prisma.$transaction([
    prisma.mcpApiKey.updateMany({
      where: { userId, isActive: true },
      data: { isActive: false, revokedAt: new Date() },
    }),
    prisma.mcpApiKey.create({
      data: {
        userId,
        key: hashedKey,
        label: label ?? null,
      },
    }),
  ]);

  return plaintext;
}
