import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  validatePasswordResetToken,
  validatePassword,
  hashPassword,
  markTokenAsUsed,
} from '@/lib/password-utils';
import { getResetPasswordLimiter, checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');

    if (!token) {
      return NextResponse.json(
        { error: 'Token is required' },
        { status: 400 }
      );
    }

    const result = await validatePasswordResetToken(token);

    if (!result.isValid) {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({ valid: true });
  } catch (error) {
    console.error('Token validation error:', error);
    return NextResponse.json(
      { error: 'An error occurred validating the reset link' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, password } = body;

    if (!token) {
      return NextResponse.json(
        { error: 'Reset token is required' },
        { status: 400 }
      );
    }

    const rateLimit = await checkRateLimit(getResetPasswordLimiter(), token);
    if (!rateLimit.success) {
      console.log('Rate limit exceeded for reset-password token');
      return NextResponse.json(
        { error: 'Too many attempts. Please request a new password reset link.' },
        { status: 429 }
      );
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      return NextResponse.json(
        { error: passwordValidation.errors[0] },
        { status: 400 }
      );
    }

    const tokenResult = await validatePasswordResetToken(token);
    if (!tokenResult.isValid || !tokenResult.userId) {
      return NextResponse.json(
        { error: tokenResult.error || 'Invalid reset link' },
        { status: 400 }
      );
    }

    const passwordHash = await hashPassword(password);

    await prisma.user.update({
      where: { id: tokenResult.userId },
      data: { passwordHash },
    });

    await markTokenAsUsed(token);

    console.log(`Password reset successfully for user ${tokenResult.userId}`);

    return NextResponse.json({
      message: 'Password reset successfully. You can now log in with your new password.',
    });
  } catch (error) {
    console.error('Reset password error:', error);
    return NextResponse.json(
      { error: 'An error occurred. Please try again.' },
      { status: 500 }
    );
  }
}
