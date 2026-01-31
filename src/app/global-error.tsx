'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

/**
 * Global error boundary for the entire application.
 * This catches React rendering errors that occur in the root layout.
 *
 * Note: This component MUST render its own <html> and <body> tags
 * because it replaces the entire document when an error occurs.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to Sentry with additional context
    Sentry.captureException(error, {
      tags: {
        errorBoundary: 'global',
      },
      extra: {
        digest: error.digest,
      },
    });
  }, [error]);

  return (
    <html lang="en">
      <head>
        <title>Error - Savvy Dashboard</title>
      </head>
      <body className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          {/* Error Icon */}
          <div className="mx-auto w-16 h-16 mb-6 rounded-full bg-red-500/10 flex items-center justify-center">
            <svg
              className="w-8 h-8 text-red-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>

          {/* Error Message */}
          <h1 className="text-2xl font-bold text-white mb-2">
            Something went wrong
          </h1>
          <p className="text-gray-400 mb-8">
            An unexpected error occurred. Our team has been notified and is working on a fix.
          </p>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={() => reset()}
              className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700
                         transition-colors font-medium focus:outline-none focus:ring-2
                         focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900"
            >
              Try again
            </button>
            <button
              onClick={() => window.location.href = '/'}
              className="px-6 py-2.5 bg-gray-700 text-white rounded-lg hover:bg-gray-600
                         transition-colors font-medium focus:outline-none focus:ring-2
                         focus:ring-gray-500 focus:ring-offset-2 focus:ring-offset-gray-900"
            >
              Go to home
            </button>
          </div>

          {/* Error Details (Development Only) */}
          {process.env.NODE_ENV === 'development' && (
            <details className="mt-8 text-left">
              <summary className="text-gray-500 cursor-pointer hover:text-gray-400
                                  text-sm font-medium">
                Error Details (Development Only)
              </summary>
              <div className="mt-3 p-4 bg-gray-800 rounded-lg overflow-auto">
                <p className="text-red-400 text-sm font-mono break-all">
                  {error.message}
                </p>
                {error.stack && (
                  <pre className="mt-3 text-gray-500 text-xs font-mono whitespace-pre-wrap">
                    {error.stack}
                  </pre>
                )}
                {error.digest && (
                  <p className="mt-3 text-gray-600 text-xs">
                    Error ID: {error.digest}
                  </p>
                )}
              </div>
            </details>
          )}
        </div>
      </body>
    </html>
  );
}
