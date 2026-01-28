'use client';

import { useState, useEffect } from 'react';
import { signIn, useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import { getSessionPermissions } from '@/types/auth';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  const router = useRouter();
  const { data: session, update: updateSession } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState('');
  const [forgotPasswordLoading, setForgotPasswordLoading] = useState(false);
  const [forgotPasswordMessage, setForgotPasswordMessage] = useState('');
  const [forgotPasswordError, setForgotPasswordError] = useState('');
  const [justLoggedIn, setJustLoggedIn] = useState(false);

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
          {loginError && (
            <div className="mb-6 p-3 bg-red-900/30 border border-red-700/50 rounded-lg">
              <p className="text-sm text-red-300">{loginError}</p>
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
