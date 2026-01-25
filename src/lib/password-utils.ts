import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';

// ============================================
// PASSWORD VALIDATION
// ============================================

export interface PasswordValidationResult {
  isValid: boolean;
  errors: string[];
}

export function validatePassword(password: string): PasswordValidationResult {
  const errors: string[] = [];

  if (!password) {
    errors.push('Password is required');
    return { isValid: false, errors };
  }

  if (password.length < 8) {
    errors.push('Password must be at least 8 characters');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ============================================
// PASSWORD RESET TOKENS
// ============================================

const TOKEN_EXPIRY_HOURS = 1;

export async function createPasswordResetToken(userId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');

  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + TOKEN_EXPIRY_HOURS);

  await prisma.passwordResetToken.updateMany({
    where: {
      userId,
      usedAt: null,
    },
    data: {
      usedAt: new Date(),
    },
  });

  await prisma.passwordResetToken.create({
    data: {
      token,
      userId,
      expiresAt,
    },
  });

  return token;
}

export interface ValidateTokenResult {
  isValid: boolean;
  userId?: string;
  error?: string;
}

export async function validatePasswordResetToken(token: string): Promise<ValidateTokenResult> {
  if (!token) {
    return { isValid: false, error: 'Token is required' };
  }

  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { token },
    include: { user: true },
  });

  if (!resetToken) {
    return { isValid: false, error: 'Invalid or expired reset link' };
  }

  if (resetToken.usedAt) {
    return { isValid: false, error: 'This reset link has already been used' };
  }

  if (new Date() > resetToken.expiresAt) {
    return { isValid: false, error: 'This reset link has expired' };
  }

  if (!resetToken.user.isActive) {
    return { isValid: false, error: 'Account is not active' };
  }

  return { isValid: true, userId: resetToken.userId };
}

export async function markTokenAsUsed(token: string): Promise<void> {
  await prisma.passwordResetToken.update({
    where: { token },
    data: { usedAt: new Date() },
  });
}

// ============================================
// CLEANUP (optional - can be called via cron)
// ============================================

export async function cleanupExpiredTokens(): Promise<number> {
  const result = await prisma.passwordResetToken.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date() } },
        { usedAt: { not: null } },
      ],
    },
  });
  return result.count;
}
