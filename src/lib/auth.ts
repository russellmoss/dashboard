import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { validateUser } from './users';
import { getUserPermissions } from './permissions';
import { ExtendedSession } from '@/types/auth';

// Helper to get NEXTAUTH_URL safely (never empty during build)
function getNextAuthUrl(): string {
  // During build, VERCEL_URL might not be set, so use fallback
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  
  if (process.env.NEXTAUTH_URL && process.env.NEXTAUTH_URL.trim() !== '') {
    return process.env.NEXTAUTH_URL;
  }
  
  // Fallback for build time
  return 'http://localhost:3000';
}

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  // Ensure URL is never empty during build
  ...(typeof window === 'undefined' && { url: getNextAuthUrl() }),
  providers: [
    CredentialsProvider({
      name: 'Email',
      credentials: {
        email: { label: 'Email', type: 'email', placeholder: 'you@savvywealth.com' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          console.error('[Auth] Missing credentials');
          return null;
        }

        try {
          console.log('[Auth] Attempting to validate user:', credentials.email);
          const user = await validateUser(credentials.email, credentials.password);
          
          if (!user) {
            console.error('[Auth] User validation failed for:', credentials.email);
            return null;
          }

          console.log('[Auth] User validated successfully:', user.email);
          return {
            id: user.id,
            email: user.email,
            name: user.name,
          };
        } catch (error) {
          console.error('[Auth] Error during authorization:', error);
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async session({ session, token }) {
      if (session.user?.email) {
        const permissions = await getUserPermissions(session.user.email);
        (session as ExtendedSession).permissions = permissions;
      }
      return session;
    },
    async jwt({ token, user }) {
      if (user) {
        token.email = user.email;
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
