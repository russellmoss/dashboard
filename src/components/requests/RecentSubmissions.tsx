'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, ExternalLink } from 'lucide-react';
import { useDebounce } from '@/hooks/useDebounce';
import { dashboardRequestsApi } from '@/lib/api-client';
import {
  DashboardRequestCard,
  STATUS_LABELS,
  STATUS_COLORS,
  TYPE_LABELS,
  TYPE_COLORS,
} from '@/types/dashboard-request';

interface RecentSubmissionsProps {
  searchText: string;
  onSelectRequest?: (request: DashboardRequestCard) => void;
}

export function RecentSubmissions({ searchText, onSelectRequest }: RecentSubmissionsProps) {
  const [results, setResults] = useState<DashboardRequestCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debouncedSearch = useDebounce(searchText, 300);

  useEffect(() => {
    async function fetchRecent() {
      // Only search if we have at least 3 characters
      if (!debouncedSearch || debouncedSearch.length < 3) {
        setResults([]);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const requests = await dashboardRequestsApi.getRecent(debouncedSearch);
        setResults(requests);
      } catch (err) {
        console.error('Failed to fetch recent submissions:', err);
        setError('Failed to search for similar requests');
        setResults([]);
      } finally {
        setLoading(false);
      }
    }

    fetchRecent();
  }, [debouncedSearch]);

  // Don't show anything if search is too short
  if (!debouncedSearch || debouncedSearch.length < 3) {
    return null;
  }

  if (loading) {
    return (
      <div className="mt-2 p-3 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg">
        <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300 text-sm">
          <div className="animate-spin w-4 h-4 border-2 border-blue-600 dark:border-blue-400 border-t-transparent rounded-full" />
          Searching for similar requests...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-2 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg">
        <div className="flex items-center gap-2 text-red-700 dark:text-red-300 text-sm">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      </div>
    );
  }

  if (results.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 p-3 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg">
      <div className="flex items-start gap-2 mb-2">
        <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-amber-800 dark:text-amber-200 text-sm font-medium">
            Similar requests found
          </p>
          <p className="text-amber-700 dark:text-amber-300 text-xs mt-0.5">
            Check if your issue has already been reported to avoid duplicates.
          </p>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {results.map((request) => (
          <button
            key={request.id}
            type="button"
            onClick={() => onSelectRequest?.(request)}
            className="w-full text-left p-2 bg-white dark:bg-gray-800 border border-amber-200 dark:border-amber-700 rounded-md hover:border-amber-300 dark:hover:border-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors group"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`inline-flex px-1.5 py-0.5 text-xs font-medium rounded ${
                      TYPE_COLORS[request.requestType].bg
                    } ${TYPE_COLORS[request.requestType].text}`}
                  >
                    {TYPE_LABELS[request.requestType]}
                  </span>
                  <span
                    className={`inline-flex px-1.5 py-0.5 text-xs font-medium rounded ${
                      STATUS_COLORS[request.status].bg
                    } ${STATUS_COLORS[request.status].text}`}
                  >
                    {STATUS_LABELS[request.status]}
                  </span>
                </div>
                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                  {request.title}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Submitted by {request.submitter.name} on{' '}
                  {new Date(request.createdAt).toLocaleDateString()}
                </p>
              </div>
              <ExternalLink className="w-4 h-4 text-gray-400 dark:text-gray-500 group-hover:text-amber-600 dark:group-hover:text-amber-400 flex-shrink-0 mt-1" />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
