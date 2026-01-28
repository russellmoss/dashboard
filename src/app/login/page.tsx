'use client';

import { useState, useEffect, useCallback } from 'react';
import { signIn, useSession, getProviders, getCsrfToken } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import { getSessionPermissions } from '@/types/auth';

const ERROR_MESSAGES: Record<string, string> = {
  NotProvisioned: 'You must be invited by an administrator.',
  AccountDisabled: 'Your account has been disabled. Contact an administrator.',
  InvalidDomain: 'Only @savvywealth.com accounts can sign in with Google.',
  AccessDenied: 'Access denied.',
  Default: 'An error occurred. Please try again.',
};

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, update: updateSession } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState('');
  const [forgotPasswordLoading, setForgotPasswordLoading] = useState(false);
  const [forgotPasswordMessage, setForgotPasswordMessage] = useState('');
  const [forgotPasswordError, setForgotPasswordError] = useState('');
  const [justLoggedIn, setJustLoggedIn] = useState(false);
  const [hasGoogleProvider, setHasGoogleProvider] = useState(false);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);

  const errorFromUrl = searchParams.get('error');
  const displayError = errorFromUrl ? (ERROR_MESSAGES[errorFromUrl] ?? ERROR_MESSAGES.Default) : null;

  const clearUrlError = useCallback(() => {
    if (errorFromUrl) {
      router.replace('/login', { scroll: false });
    }
  }, [errorFromUrl, router]);

  useEffect(() => {
    Promise.all([getProviders(), getCsrfToken()]).then(([providers, token]) => {
      setHasGoogleProvider(!!providers?.google);
      setCsrfToken(token ?? null);
    });
  }, []);

  // Handle redirect after login based on user role
  useEffect(() => {
    if (justLoggedIn && session) {
      const permissions = getSessionPermissions(session);
      if (permissions) {
        // SGA users go to SGA Hub, everyone else goes to Funnel Performance
        const redirectPath = permissions.role === 'sga' ? '/dashboard/sga-hub' : '/dashboard';
        router.push(redirectPath);
        router.refresh();
        setJustLoggedIn(false);
      }
    }
  }, [justLoggedIn, session, router]);

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotPasswordLoading(true);
    setForgotPasswordError('');
    setForgotPasswordMessage('');

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotPasswordEmail }),
      });

      const data = await res.json();

      if (!res.ok) {
        setForgotPasswordError(data.error || 'An error occurred');
        return;
      }

      setForgotPasswordMessage(data.message ?? '');
    } catch {
      setForgotPasswordError('An error occurred. Please try again.');
    } finally {
      setForgotPasswordLoading(false);
    }
  };

  const closeForgotPasswordModal = () => {
    setShowForgotPassword(false);
    setForgotPasswordEmail('');
    setForgotPasswordMessage('');
    setForgotPasswordError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setLoginError(null);
    clearUrlError();

    try {
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setLoginError('Invalid email or password');
      } else if (result?.ok) {
        // Update session to get permissions
        await updateSession();
        // Set flag to trigger redirect in useEffect once session updates
        setJustLoggedIn(true);
      }
    } catch (err) {
      setLoginError('An error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div 
      className="min-h-screen w-full flex items-center justify-center p-4 relative overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
      }}
    >
      {/* Decorative blur elements */}
      <div className="absolute top-0 left-0 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-blue-500/3 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-md w-full relative z-10">
        {/* Logo area above card */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2 text-white">Savvy Wealth</h1>
          <p className="text-gray-300 text-sm">GTM Analytics Dashboard</p>
        </div>

        {/* Glassmorphism card */}
        <div className="bg-gray-900/50 backdrop-blur-md border border-gray-700/50 rounded-2xl p-8 shadow-2xl">
          {(loginError || displayError) && (
            <div className="mb-6 p-3 bg-red-900/30 border border-red-700/50 rounded-lg flex items-start justify-between gap-2">
              <p className="text-sm text-red-300">{loginError ?? displayError}</p>
              {displayError && (
                <button
                  type="button"
                  onClick={clearUrlError}
                  className="text-red-400 hover:text-red-300 shrink-0 p-0.5"
                  aria-label="Dismiss"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          )}
          
          {hasGoogleProvider && csrfToken && (
            <div className="mb-6">
              <form
                action="/api/auth/signin/google"
                method="POST"
                onSubmit={() => {
                  setGoogleLoading(true);
                  setLoginError(null);
                }}
              >
                <input type="hidden" name="csrfToken" value={csrfToken} />
                <input type="hidden" name="callbackUrl" value="/dashboard" />
                <button
                  type="submit"
                  disabled={isLoading || googleLoading}
                  className="w-full py-3 px-4 bg-white hover:bg-gray-100 text-gray-800 font-medium rounded-lg border border-gray-300 transition-all duration-200 flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                  {googleLoading ? 'Signing in...' : 'Sign in with Google'}
                </button>
              </form>
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-600/50" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-3 bg-gray-900/50 text-gray-400">or continue with email</span>
                </div>
              </div>
            </div>
          )}
          
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-2">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@savvywealth.com"
                required
                className="w-full px-4 py-3 bg-gray-800/50 border border-gray-600/50 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent transition-all"
              />
            </div>
            
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-2">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full px-4 py-3 pr-12 bg-gray-800/50 border border-gray-600/50 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 bg-transparent border-none cursor-pointer p-1 flex items-center justify-center text-gray-400 hover:text-gray-300 transition-colors"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <EyeOff size={18} />
                  ) : (
                    <Eye size={18} />
                  )}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-600 bg-gray-800/50 text-blue-600 focus:ring-2 focus:ring-blue-500/50 focus:ring-offset-0 focus:ring-offset-transparent"
                />
                <span className="text-sm text-gray-300">Remember me</span>
              </label>
              <button
                type="button"
                onClick={() => setShowForgotPassword(true)}
                className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
                aria-label="Forgot password"
              >
                Forgot password?
              </button>
            </div>
            
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg transition-all duration-200 shadow-lg shadow-blue-500/25 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-blue-600"
            >
              {isLoading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
          
          <p className="mt-6 text-center text-xs text-gray-400">
            Only @savvywealth.com accounts are authorized
          </p>
        </div>

        {/* Footer */}
        <p className="mt-8 text-center text-xs text-gray-400/70">
          © 2026 Savvy Wealth. All rights reserved.
        </p>
      </div>

      {/* Forgot Password Modal */}
      {showForgotPassword && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-gray-900/95 backdrop-blur-md border border-gray-700/50 rounded-2xl shadow-2xl max-w-md w-full p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold text-white">Reset Password</h2>
              <button
                type="button"
                onClick={closeForgotPasswordModal}
                className="text-gray-400 hover:text-gray-200 transition-colors p-1"
                aria-label="Close"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {forgotPasswordMessage ? (
              <div className="text-center py-4">
                <div className="w-12 h-12 bg-green-900/30 border border-green-700/50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-white font-medium">Check Your Email</p>
                <p className="text-gray-300 mt-2">{forgotPasswordMessage}</p>
                <div className="mt-4 p-3 bg-amber-900/30 border border-amber-600/50 rounded-lg">
                  <p className="text-amber-200 text-sm">
                    <strong>📧 Don&apos;t see it?</strong> Check your spam/junk folder and mark as &quot;Not Spam&quot;.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeForgotPasswordModal}
                  className="mt-4 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg transition-colors"
                >
                  Close
                </button>
              </div>
            ) : (
              <form onSubmit={handleForgotPassword}>
                <p className="text-gray-300 mb-4">
                  Enter your email address and we&apos;ll send you a link to reset your password.
                </p>

                <div className="mb-4">
                  <label htmlFor="forgotEmail" className="block text-sm font-medium text-gray-300 mb-2">
                    Email
                  </label>
                  <input
                    type="email"
                    id="forgotEmail"
                    value={forgotPasswordEmail}
                    onChange={(e) => setForgotPasswordEmail(e.target.value)}
                    className="w-full px-4 py-3 bg-gray-800/50 border border-gray-600/50 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent transition-all"
                    placeholder="you@savvywealth.com"
                    required
                    disabled={forgotPasswordLoading}
                  />
                </div>

                {forgotPasswordError && (
                  <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded-lg">
                    <p className="text-sm text-red-300">{forgotPasswordError}</p>
                  </div>
                )}

                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={closeForgotPasswordModal}
                    className="px-4 py-2 text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-50"
                    disabled={forgotPasswordLoading}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={forgotPasswordLoading}
                    className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {forgotPasswordLoading ? 'Sending...' : 'Send Reset Link'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
