import { NextAuthOptions } from 'next-auth';
import type { Session } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import { validateUser, getUserByEmail } from './users';
import { getUserPermissions } from './permissions';
import { ExtendedSession } from '@/types/auth';
import { getLoginLimiter, checkRateLimit } from '@/lib/rate-limit';

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
      }
      return true;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string }).id = (token.sub ?? token.id) as string;
        if (session.user.email) {
          const permissions = await getUserPermissions(session.user.email);
          (session as ExtendedSession).permissions = permissions;
        }
      }
      return session;
    },
    async jwt({ token, user }) {
      if (user) {
        token.email = user.email;
        if (user.email) {
          const dbUser = await getUserByEmail(user.email.toLowerCase());
          if (dbUser) {
            (token as { id?: string }).id = dbUser.id;
          } else {
            (token as { id?: string }).id = user.id;
          }
        } else {
          (token as { id?: string }).id = user.id;
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
