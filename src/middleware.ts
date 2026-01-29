import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

/**
 * Middleware to protect dashboard routes.
 * Uses request.nextUrl instead of new URL() to avoid Invalid URL errors
 * when NEXTAUTH_URL is not set during build/runtime.
 */
export async function middleware(request: NextRequest) {
  // Use request.nextUrl instead of new URL() - it's already parsed
  const { pathname } = request.nextUrl;
  
  // Skip auth check for public routes
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/cron') ||
    pathname === '/login' ||
    pathname.startsWith('/static') ||
    pathname.startsWith('/monitoring') || // Sentry tunnel route
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  // Check for auth token
  const token = await getToken({ 
    req: request,
    secret: process.env.NEXTAUTH_SECRET 
  });

  // If no token and trying to access protected route, redirect to login
  if (!token && pathname.startsWith('/dashboard')) {
    // Use request.nextUrl.clone() instead of new URL()
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Default-deny for recruiters: they may only access Recruiter Hub + Settings in dashboard.
  // This runs BEFORE any page JS, preventing "flash" and blocking direct URL access.
  if (token && pathname.startsWith('/dashboard')) {
    const role = (token as any)?.role as string | undefined;
    if (role === 'recruiter') {
      const allowed =
        pathname.startsWith('/dashboard/recruiter-hub') ||
        pathname.startsWith('/dashboard/settings');

      if (!allowed) {
        const redirectUrl = request.nextUrl.clone();
        redirectUrl.pathname = '/dashboard/recruiter-hub';
        redirectUrl.search = '';
        return NextResponse.redirect(redirectUrl);
      }
    }
  }

  // If no token and trying to access API routes, return 401
  // (Public exceptions are handled above: /api/auth/* and /api/cron/*)
  if (!token && pathname.startsWith('/api')) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  // Recruiters are blocked from ALL /api/* by default (defense-in-depth),
  // except explicit allowlist required for Recruiter Hub + Settings + approved shared endpoints.
  if (token && pathname.startsWith('/api')) {
    const role = (token as any)?.role as string | undefined;
    const allowlisted =
      pathname.startsWith('/api/auth') ||
      pathname.startsWith('/api/recruiter-hub') ||
      pathname.startsWith('/api/dashboard/record-detail') ||  // Record detail modal (route has proper recruiter filtering)
      pathname === '/api/users/me/change-password' ||
      pathname === '/api/dashboard/data-freshness';

    if (role === 'recruiter' && !allowlisted) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/api/:path*',
  ],
};
