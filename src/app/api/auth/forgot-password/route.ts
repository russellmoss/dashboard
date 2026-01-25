import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createPasswordResetToken } from '@/lib/password-utils';
import { sendPasswordResetEmail } from '@/lib/email';
import { getForgotPasswordLimiter, checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email } = body;

    if (!email) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      );
    }

    const normalizedEmail = (email as string).toLowerCase().trim();

    const rateLimit = await checkRateLimit(getForgotPasswordLimiter(), normalizedEmail);
    if (!rateLimit.success) {
      console.log(`Rate limit exceeded for forgot-password: ${normalizedEmail}`);
      return NextResponse.json(
        { error: 'Too many password reset requests. Please try again later.' },
        { status: 429 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user || !user.isActive) {
      console.log(`Password reset requested for non-existent or inactive email: ${normalizedEmail}`);
      return NextResponse.json({
        message: 'If an account exists with this email, you will receive a password reset link.',
      });
    }

    const token = await createPasswordResetToken(user.id);

    const emailSent = await sendPasswordResetEmail(
      user.email,
      token,
      user.name
    );

    if (!emailSent) {
      console.error(`Failed to send password reset email to ${user.email}`);
    }

    console.log(`Password reset email sent to ${user.email}`);

    return NextResponse.json({
      message: 'If an account exists with this email, you will receive a password reset link.',
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    return NextResponse.json(
      { error: 'An error occurred. Please try again.' },
      { status: 500 }
    );
  }
}
