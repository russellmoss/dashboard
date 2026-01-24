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

  // If no token and trying to access protected API route, return 401
  // /api/games/* is NOT checked here - those routes use getServerSession directly
  // (avoids getToken vs session mismatch that caused 401s for game levels)
  if (!token && pathname.startsWith('/api/dashboard')) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/api/dashboard/:path*',
  ],
};
