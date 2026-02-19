'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import * as Sentry from '@sentry/nextjs';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackTitle?: string;
  fallbackMessage?: string;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  isChunkError: boolean;
}

/**
 * Helper to detect ChunkLoadError from webpack dynamic imports.
 * Covers both the standard name and common message patterns.
 */
function isChunkLoadError(err: Error): boolean {
  return (
    err.name === 'ChunkLoadError' ||
    err.message?.includes('Loading chunk') ||
    err.message?.includes('Loading CSS chunk')
  );
}

/**
 * Key used to track whether we've already attempted an auto-reload
 * for a ChunkLoadError in this browser session. Prevents infinite
 * reload loops if the chunk is genuinely broken (not just stale).
 */
const CHUNK_RELOAD_KEY = 'chunk-error-reloaded';

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, isChunkError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      error,
      isChunkError: isChunkLoadError(error),
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Always report to Sentry — including production
    Sentry.captureException(error, {
      tags: {
        errorBoundary: 'dashboard',
        isChunkError: String(isChunkLoadError(error)),
      },
      extra: {
        componentStack: errorInfo.componentStack,
      },
    });

    // Also log in development for local debugging
    if (process.env.NODE_ENV === 'development') {
      console.error('[ErrorBoundary] Caught error:', error.message, error.stack);
      console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack);
    }

    // Auto-reload for ChunkLoadError — but only once per session
    if (isChunkLoadError(error)) {
      const alreadyReloaded = sessionStorage.getItem(CHUNK_RELOAD_KEY);
      if (!alreadyReloaded) {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, 'true');
        window.location.reload();
        return; // Reload initiated — no further action
      }
      // If we already reloaded once and still got ChunkLoadError,
      // fall through to show the error UI with a manual reload button.
      // This prevents infinite reload loops.
    }
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null, isChunkError: false });
    this.props.onReset?.();
  };

  handleReload = (): void => {
    // Clear the reload guard so user can trigger one more attempt
    sessionStorage.removeItem(CHUNK_RELOAD_KEY);
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // ChunkLoadError-specific UI — "Try Again" won't work, need full reload
      if (this.state.isChunkError) {
        return (
          <div className="flex flex-col items-center justify-center p-8 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg min-h-[200px]">
            <RefreshCw className="w-12 h-12 text-amber-500 dark:text-amber-400 mb-4" />
            <h3 className="text-lg font-semibold text-amber-800 dark:text-amber-200 mb-2">
              Page Update Available
            </h3>
            <p className="text-sm text-amber-600 dark:text-amber-300 mb-4 text-center max-w-md">
              A new version of the dashboard was deployed. Please reload the page to get the latest update.
            </p>
            <button
              onClick={this.handleReload}
              className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg transition-colors duration-200"
            >
              <RefreshCw className="w-4 h-4" />
              Reload Page
            </button>
          </div>
        );
      }

      // Standard error UI for non-chunk errors (unchanged behavior)
      return (
        <div className="flex flex-col items-center justify-center p-8 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg min-h-[200px]">
          <AlertTriangle className="w-12 h-12 text-red-500 dark:text-red-400 mb-4" />
          <h3 className="text-lg font-semibold text-red-800 dark:text-red-200 mb-2">
            {this.props.fallbackTitle || 'Something went wrong'}
          </h3>
          <p className="text-sm text-red-600 dark:text-red-300 mb-4 text-center max-w-md">
            {this.props.fallbackMessage || 'An error occurred while loading this section. Please try again.'}
          </p>
          {process.env.NODE_ENV === 'development' && this.state.error && (
            <pre className="text-xs bg-red-100 dark:bg-red-900/40 p-3 rounded mb-4 max-w-full overflow-auto text-red-700 dark:text-red-300 font-mono">
              {this.state.error.message}
            </pre>
          )}
          <button
            onClick={this.handleReset}
            className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors duration-200"
          >
            <RefreshCw className="w-4 h-4" />
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// Higher-order component wrapper for functional components
export function withErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  errorBoundaryProps?: Omit<ErrorBoundaryProps, 'children'>
): React.FC<P> {
  const WithErrorBoundary: React.FC<P> = (props) => (
    <ErrorBoundary {...errorBoundaryProps}>
      <WrappedComponent {...props} />
    </ErrorBoundary>
  );

  WithErrorBoundary.displayName = `withErrorBoundary(${WrappedComponent.displayName || WrappedComponent.name || 'Component'})`;

  return WithErrorBoundary;
}
