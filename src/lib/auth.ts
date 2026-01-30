import { NextAuthOptions } from 'next-auth';
import type { Session } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import { validateUser, getUserByEmail } from './users';
import { getPermissionsFromToken, TokenUserData } from './permissions';
import { ExtendedSession } from '@/types/auth';
import { getLoginLimiter, checkRateLimit } from '@/lib/rate-limit';
import { UserRole } from '@/types/user';

/** Get user id from session (set by auth callbacks). Use in API routes. */
export function getSessionUserId(session: Session | null): string | null {
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

// Helper to get NEXTAUTH_URL safely (never empty during build)
function getNextAuthUrl(): string {
  // Priority 1: Explicitly set NEXTAUTH_URL
  if (process.env.NEXTAUTH_URL && process.env.NEXTAUTH_URL.trim() !== '') {
    return process.env.NEXTAUTH_URL;
  }
  
  // Priority 2: Use VERCEL_URL (automatically set by Vercel)
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  
  // Priority 3: Use VERCEL_BRANCH_URL (for preview deployments)
  if (process.env.VERCEL_BRANCH_URL) {
    return `https://${process.env.VERCEL_BRANCH_URL}`;
  }
  
  // Fallback for local development
  return process.env.NODE_ENV === 'production' 
    ? 'https://dashboard-eta-lime-45.vercel.app' // Hardcoded fallback for production
    : 'http://localhost:3000';
}

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  // Ensure URL is never empty during build
  ...(typeof window === 'undefined' && { url: getNextAuthUrl() }),
  providers: [
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            authorization: {
              params: {
                prompt: 'select_account',
                hd: 'savvywealth.com', // Hint: prefer @savvywealth.com accounts
              },
            },
          }),
        ]
      : []),
    CredentialsProvider({
      name: 'Email',
      credentials: {
        email: { label: 'Email', type: 'email', placeholder: 'you@savvywealth.com' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          console.error('[Auth] Missing credentials - email:', !!credentials?.email, 'password:', !!credentials?.password);
          return null;
        }

        const normalizedEmail = credentials.email.toLowerCase().trim();

        try {
          const rateLimit = await checkRateLimit(getLoginLimiter(), normalizedEmail);
          if (!rateLimit.success) {
            console.log(`[Auth] Rate limit exceeded for login: ${normalizedEmail}`);
            return null;
          }

          console.log('[Auth] Attempting to validate user:', credentials.email);
          const user = await validateUser(credentials.email, credentials.password);
          
          if (!user) {
            console.error('[Auth] User validation failed for:', credentials.email, '- validateUser returned null');
            return null;
          }

          console.log('[Auth] User validated successfully:', user.email);
          return {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
          };
        } catch (error: any) {
          console.error('[Auth] Error during authorization:', {
            message: error?.message,
            stack: error?.stack,
            name: error?.name,
          });
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === 'google' && user?.email) {
        const email = user.email.toLowerCase().trim();
        if (!email.endsWith('@savvywealth.com')) {
          return '/login?error=InvalidDomain';
        }
        const dbUser = await getUserByEmail(email);
        if (!dbUser) {
          return '/login?error=NotProvisioned';
        }
        if (dbUser.isActive === false) {
          return '/login?error=AccountDisabled';
        }
        // Store dbUser data on user object for jwt callback to use
        // This avoids another DB query in jwt callback
        (user as any)._dbUser = dbUser;
      }
      return true;
    },
    async session({ session, token }) {
      if (session.user) {
        // Set user ID from token
        (session.user as { id?: string }).id = (token.sub ?? token.id) as string;

        // Derive permissions from token data (NO DATABASE QUERY)
        // All required data is stored in the JWT at sign-in time
        const tokenData: TokenUserData = {
          id: (token.id as string) || (token.sub as string) || '',
          email: (token.email as string) || '',
          name: (token.name as string) || '',
          role: ((token.role as string) || 'viewer') as UserRole,
          externalAgency: (token.externalAgency as string | null) || null,
        };

        const permissions = getPermissionsFromToken(tokenData);
        (session as ExtendedSession).permissions = permissions;
      }
      return session;
    },
    async jwt({ token, user }) {
      // On initial sign-in, populate token with all user data
      if (user) {
        token.email = user.email;

        // Check if we already have dbUser from signIn callback (Google OAuth)
        const cachedDbUser = (user as any)._dbUser;

        if (cachedDbUser) {
          // Use cached data from signIn callback (no DB query needed)
          token.id = cachedDbUser.id;
          token.name = cachedDbUser.name;
          token.role = cachedDbUser.role;
          token.externalAgency = cachedDbUser.externalAgency ?? null;
        } else if (user.email) {
          // Credentials provider - user object already has the data
          const credUser = user as { id: string; name?: string; role?: string };
          token.id = credUser.id;
          token.name = credUser.name || user.name;
          token.role = credUser.role;

          // For credentials, we need to get externalAgency from DB
          // This only happens once at sign-in, not on every request
          const dbUser = await getUserByEmail(user.email.toLowerCase());
          if (dbUser) {
            token.externalAgency = dbUser.externalAgency ?? null;
            // Ensure we have the latest data
            token.id = dbUser.id;
            token.name = dbUser.name;
            token.role = dbUser.role;
          }
        } else {
          token.id = user.id;
          token.role = (user as { role?: string }).role;
        }
      }

      // Backfill missing data for existing JWTs (migration path)
      // This only runs if role or externalAgency is missing - typically once after upgrade
      const email = typeof token.email === 'string' ? token.email.toLowerCase().trim() : null;
      const needsBackfill = email && (!token.role || token.externalAgency === undefined);

      if (needsBackfill) {
        const dbUser = await getUserByEmail(email);
        if (dbUser) {
          token.id = token.id ?? dbUser.id;
          token.name = token.name ?? dbUser.name;
          token.role = token.role ?? dbUser.role;
          token.externalAgency = token.externalAgency ?? dbUser.externalAgency ?? null;
        }
      }

      return token;
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  session: {
    strategy: 'jwt',
    maxAge: 24 * 60 * 60, // 24 hours
  },
  debug: process.env.NODE_ENV === 'development',
};
