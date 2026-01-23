'use client';

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';

export function CacheClearButton() {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const router = useRouter();

  const handleClearCache = async () => {
    setIsRefreshing(true);
    try {
      const response = await fetch('/api/admin/refresh-cache', {
        method: 'POST',
      });
      
      if (response.ok) {
        // Refresh the page to get fresh data
        router.refresh();
        // Also trigger a client-side refresh after a short delay
        setTimeout(() => {
          window.location.reload();
        }, 500);
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.error('Failed to clear cache:', errorData.error || 'Unknown error');
        alert('Failed to clear cache. You may not have admin permissions.');
      }
    } catch (error) {
      console.error('Error clearing cache:', error);
      alert('Error clearing cache. Please try again.');
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <button
      onClick={handleClearCache}
      className="theme-toggle group relative"
      aria-label="Clear cache"
      title="Clear cache"
      disabled={isRefreshing}
    >
      <RefreshCw className={`w-5 h-5 ${isRefreshing ? 'animate-spin' : ''}`} />
      <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-800 px-2 py-1 rounded">
        Clear Cache
      </span>
    </button>
  );
}
