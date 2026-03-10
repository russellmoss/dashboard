import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Tracing: full sampling in dev, 10% in production
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,

  // Send user IP / cookies for debugging authenticated issues
  sendDefaultPii: true,

  // Replay is heavy — disable by default, enable if needed later
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,

  debug: false,
});
