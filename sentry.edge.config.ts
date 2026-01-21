// DEPRECATED: This file is no longer used. Sentry initialization has been moved to src/instrumentation.ts
// This file can be safely deleted. Edge runtime Sentry is now configured in the instrumentation hook.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

// This file configures the initialization of Sentry for edge features (middleware, edge routes, and so on).
// The config you add here will be used whenever one of the edge features is loaded.
// Note that this config is unrelated to the Vercel Edge Runtime and is also required when running locally.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  // Enable logging
  enableLogs: true,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,

  // Send console.log, console.warn, and console.error calls as logs to Sentry
  integrations: [
    Sentry.consoleLoggingIntegration({ levels: ["log", "warn", "error"] }),
  ],
});
