'use client';

import { useEffect } from 'react';
import { RefreshCw, MapPin } from 'lucide-react';
import * as Sentry from '@sentry/nextjs';

/**
 * Route-level error boundary for /dashboard/advisor-map.
 * Catches ChunkLoadError (stale deployment) and other rendering errors.
 *
 * Next.js App Router automatically wraps this route segment with this
 * error boundary. It receives the error and a reset function.
 */
export default function AdvisorMapError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const isChunkError =
    error.name === 'ChunkLoadError' ||
    error.message?.includes('Loading chunk') ||
    error.message?.includes('Loading CSS chunk');

  useEffect(() => {
    // Report to Sentry with route context
    Sentry.captureException(error, {
      tags: {
        errorBoundary: 'advisor-map-route',
        isChunkError: String(isChunkError),
      },
      extra: {
        digest: error.digest,
      },
    });

    // Auto-reload for ChunkLoadError (once per session)
    if (isChunkError) {
      const key = 'advisor-map-chunk-reloaded';
      const alreadyReloaded = sessionStorage.getItem(key);
      if (!alreadyReloaded) {
        sessionStorage.setItem(key, 'true');
        window.location.reload();
      }
    }
  }, [error, isChunkError]);

  if (isChunkError) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex flex-col items-center justify-center p-12 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
          <RefreshCw className="w-12 h-12 text-amber-500 dark:text-amber-400 mb-4" />
          <h2 className="text-xl font-semibold text-amber-800 dark:text-amber-200 mb-2">
            Page Update Available
          </h2>
          <p className="text-sm text-amber-600 dark:text-amber-300 mb-6 text-center max-w-md">
            A new version of the dashboard was deployed while you were using it.
            Please reload to load the updated Advisor Map.
          </p>
          <button
            onClick={() => {
              sessionStorage.removeItem('advisor-map-chunk-reloaded');
              window.location.reload();
            }}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg transition-colors duration-200"
          >
            <RefreshCw className="w-4 h-4" />
            Reload Page
          </button>
        </div>
      </div>
    );
  }

  // Non-chunk errors — general advisor map error UI
  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col items-center justify-center p-12 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
        <MapPin className="w-12 h-12 text-red-500 dark:text-red-400 mb-4" />
        <h2 className="text-xl font-semibold text-red-800 dark:text-red-200 mb-2">
          Advisor Map Failed to Load
        </h2>
        <p className="text-sm text-red-600 dark:text-red-300 mb-6 text-center max-w-md">
          An error occurred while loading the Advisor Map. This may be a temporary issue.
        </p>
        {process.env.NODE_ENV === 'development' && (
          <pre className="text-xs bg-red-100 dark:bg-red-900/40 p-3 rounded mb-4 max-w-full overflow-auto text-red-700 dark:text-red-300 font-mono">
            {error.message}
          </pre>
        )}
        <div className="flex gap-3">
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors duration-200"
          >
            <RefreshCw className="w-4 h-4" />
            Try Again
          </button>
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white text-sm font-medium rounded-lg transition-colors duration-200"
          >
            Reload Page
          </button>
        </div>
      </div>
    </div>
  );
}
