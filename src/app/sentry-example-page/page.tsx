'use client';

import { useState } from 'react';

export default function SentryExamplePage() {
  const [error, setError] = useState<string | null>(null);

  const triggerError = () => {
    try {
      throw new Error('This is a test error from Sentry!');
    } catch (err) {
      setError((err as Error).message);
      throw err; // Re-throw to send to Sentry
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
        <h1 className="text-2xl font-bold mb-4 text-gray-900 dark:text-white">
          Sentry Test Page
        </h1>
        <p className="text-gray-600 dark:text-gray-300 mb-6">
          Click the button below to trigger a test error that will be sent to Sentry.
        </p>
        <button
          onClick={triggerError}
          className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded transition-colors"
        >
          Trigger Test Error
        </button>
        {error && (
          <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded">
            <p className="text-red-800 dark:text-red-200 text-sm">
              Error triggered: {error}
            </p>
            <p className="text-red-600 dark:text-red-400 text-xs mt-2">
              Check your Sentry dashboard to see this error.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
