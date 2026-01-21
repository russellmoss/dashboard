export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Server-side Sentry initialization
    await import('@sentry/nextjs').then((Sentry) => {
      Sentry.init({
        dsn: process.env.SENTRY_DSN,
        enableLogs: true,
        debug: false,
        integrations: [
          Sentry.consoleLoggingIntegration({ 
            levels: ['log', 'warn', 'error'] 
          }),
        ],
      });
    });

    // Handle unhandled rejections from Next.js cache (data > 2MB limit)
    // These errors occur asynchronously after responses are sent and can be safely ignored
    // The data is still returned successfully, caching just fails silently
    if (typeof process !== 'undefined') {
      // Add handler to catch and suppress cache size limit errors
      // These are non-fatal - the API still returns data successfully
      const cacheErrorHandler = (reason: any, promise: Promise<any>) => {
        const errorMessage = reason?.message || reason?.toString() || '';
        if (
          errorMessage.includes('over 2MB') || 
          errorMessage.includes('can not be cached') ||
          errorMessage.includes('Failed to set Next.js data cache')
        ) {
          // Data was returned successfully, just not cached - this is expected for large datasets
          // Suppress the error to prevent unhandled rejection warnings
          // Mark as handled to prevent default Node.js behavior
          return true;
        }
      };
      // Prepend so our handler runs first and can suppress the error
      process.prependListener('unhandledRejection', cacheErrorHandler);
    }
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    // Edge runtime Sentry initialization
    await import('@sentry/nextjs').then((Sentry) => {
      Sentry.init({
        dsn: process.env.SENTRY_DSN,
        enableLogs: true,
        debug: false,
        integrations: [
          Sentry.consoleLoggingIntegration({ 
            levels: ['log', 'warn', 'error'] 
          }),
        ],
      });
    });
  }
}
