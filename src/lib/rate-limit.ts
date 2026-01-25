import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

let _redis: Redis | null = null;
let _forgotPasswordLimiter: Ratelimit | null = null;
let _resetPasswordLimiter: Ratelimit | null = null;
let _loginLimiter: Ratelimit | null = null;

function getRedis(): Redis | null {
  if (_redis) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  _redis = new Redis({ url, token });
  return _redis;
}

export function isRateLimitConfigured(): boolean {
  return !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

export function getForgotPasswordLimiter(): Ratelimit | null {
  if (_forgotPasswordLimiter) return _forgotPasswordLimiter;
  const redis = getRedis();
  if (!redis) return null;
  _forgotPasswordLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(3, '1 h'),
    analytics: true,
    prefix: 'ratelimit:forgot-password',
  });
  return _forgotPasswordLimiter;
}

export function getResetPasswordLimiter(): Ratelimit | null {
  if (_resetPasswordLimiter) return _resetPasswordLimiter;
  const redis = getRedis();
  if (!redis) return null;
  _resetPasswordLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, '1 h'),
    analytics: true,
    prefix: 'ratelimit:reset-password',
  });
  return _resetPasswordLimiter;
}

export function getLoginLimiter(): Ratelimit | null {
  if (_loginLimiter) return _loginLimiter;
  const redis = getRedis();
  if (!redis) return null;
  _loginLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, '15 m'),
    analytics: true,
    prefix: 'ratelimit:login',
  });
  return _loginLimiter;
}

export async function checkRateLimit(
  limiter: Ratelimit | null,
  identifier: string
): Promise<{ success: boolean; remaining: number; reset: number }> {
  if (!isRateLimitConfigured() || !limiter) {
    console.warn('Rate limiting not configured - UPSTASH env vars missing');
    return { success: true, remaining: 999, reset: 0 };
  }

  const result = await limiter.limit(identifier);
  return {
    success: result.success,
    remaining: result.remaining,
    reset: result.reset,
  };
}
