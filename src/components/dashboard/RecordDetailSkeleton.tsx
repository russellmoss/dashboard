// src/components/dashboard/RecordDetailSkeleton.tsx

'use client';

import React from 'react';

export function RecordDetailSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      {/* Header Skeleton */}
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <div className="h-8 w-64 bg-gray-200 dark:bg-gray-700 rounded" />
          <div className="h-4 w-32 bg-gray-200 dark:bg-gray-700 rounded" />
        </div>
        <div className="h-6 w-20 bg-gray-200 dark:bg-gray-700 rounded-full" />
      </div>

      {/* Funnel Stepper Skeleton */}
      <div className="py-4">
        <div className="flex items-center justify-between">
          {[...Array(5)].map((_, i) => (
            <React.Fragment key={i}>
              <div className="flex flex-col items-center">
                <div className="w-10 h-10 bg-gray-200 dark:bg-gray-700 rounded-full" />
                <div className="mt-2 h-3 w-12 bg-gray-200 dark:bg-gray-700 rounded" />
              </div>
              {i < 4 && (
                <div className="flex-1 h-1 mx-2 bg-gray-200 dark:bg-gray-700" />
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Sections Grid Skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Attribution Section */}
        <div className="space-y-3">
          <div className="h-5 w-24 bg-gray-200 dark:bg-gray-700 rounded" />
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="flex justify-between">
                <div className="h-4 w-20 bg-gray-200 dark:bg-gray-700 rounded" />
                <div className="h-4 w-32 bg-gray-200 dark:bg-gray-700 rounded" />
              </div>
            ))}
          </div>
        </div>

        {/* Dates Section */}
        <div className="space-y-3">
          <div className="h-5 w-20 bg-gray-200 dark:bg-gray-700 rounded" />
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex justify-between">
                <div className="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded" />
                <div className="h-4 w-28 bg-gray-200 dark:bg-gray-700 rounded" />
              </div>
            ))}
          </div>
        </div>

        {/* Financials Section */}
        <div className="space-y-3">
          <div className="h-5 w-20 bg-gray-200 dark:bg-gray-700 rounded" />
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex justify-between">
                <div className="h-4 w-28 bg-gray-200 dark:bg-gray-700 rounded" />
                <div className="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded" />
              </div>
            ))}
          </div>
        </div>

        {/* Status Section */}
        <div className="space-y-3">
          <div className="h-5 w-16 bg-gray-200 dark:bg-gray-700 rounded" />
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex justify-between">
                <div className="h-4 w-20 bg-gray-200 dark:bg-gray-700 rounded" />
                <div className="h-4 w-32 bg-gray-200 dark:bg-gray-700 rounded" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Salesforce Links Skeleton */}
      <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
        <div className="flex gap-3">
          <div className="h-9 w-40 bg-gray-200 dark:bg-gray-700 rounded" />
          <div className="h-9 w-48 bg-gray-200 dark:bg-gray-700 rounded" />
        </div>
      </div>
    </div>
  );
}

export default RecordDetailSkeleton;
