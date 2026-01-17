'use client';

import { useState, useEffect } from 'react';
import { CheckCircle, Clock, AlertCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { DataFreshness, DataFreshnessStatus } from '@/types/dashboard';
import { dashboardApi } from '@/lib/api-client';
import { getSessionPermissions } from '@/types/auth';
import { 
  formatRelativeTime, 
  formatAbsoluteTime, 
  getStatusColor 
} from '@/lib/utils/freshness-helpers';

interface DataFreshnessIndicatorProps {
  variant?: 'compact' | 'detailed';
  className?: string;
}

const StatusIcon = ({ status }: { status: DataFreshnessStatus }) => {
  const iconClass = 'w-3.5 h-3.5';
  switch (status) {
    case 'fresh':
      return <CheckCircle className={iconClass} />;
    case 'recent':
      return <Clock className={iconClass} />;
    case 'stale':
      return <AlertCircle className={iconClass} />;
    case 'very_stale':
      return <AlertTriangle className={iconClass} />;
    default:
      return <Clock className={iconClass} />;
  }
};

export function DataFreshnessIndicator({ 
  variant = 'compact',
  className = '' 
}: DataFreshnessIndicatorProps) {
  const [freshness, setFreshness] = useState<DataFreshness | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchFreshness = async () => {
    try {
      const data = await dashboardApi.getDataFreshness();
      setFreshness(data);
      setError(false);
    } catch (err) {
      console.error('Error fetching data freshness:', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const response = await fetch('/api/admin/refresh-cache', {
        method: 'POST',
      });
      
      if (response.ok) {
        // Show success message in console (no toast library available)
        console.log('Cache refreshed successfully');
        // Optionally refetch data freshness
        await fetchFreshness();
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.error('Failed to refresh cache:', errorData.error || 'Unknown error');
      }
    } catch (error) {
      console.error('Error refreshing cache:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchFreshness();
    
    // Refresh every 5 minutes
    const interval = setInterval(fetchFreshness, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Don't render anything if error or no data
  if (error || (!loading && !freshness)) {
    return null;
  }

  // Loading state
  if (loading) {
    return (
      <div className={`flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500 ${className}`}>
        <RefreshCw className="w-3 h-3 animate-spin" />
        <span>Loading...</span>
      </div>
    );
  }

  const { data: session } = useSession();
  const permissions = getSessionPermissions(session);
  const isAdmin = permissions?.role === 'admin';

  const colors = getStatusColor(freshness!.status);
  const relativeTime = formatRelativeTime(freshness!.minutesAgo);
  const absoluteTime = formatAbsoluteTime(freshness!.lastUpdated);

  if (variant === 'compact') {
    return (
      <div 
        className={`flex items-center gap-1.5 text-xs ${colors.text} ${className}`}
        title={`Last synced: ${absoluteTime}\nStatus: ${freshness!.status}`}
      >
        <span className={`w-2 h-2 rounded-full ${colors.dot}`} />
        <span>Updated {relativeTime}</span>
      </div>
    );
  }

  // Detailed variant
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div 
        className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs ${colors.bg} ${colors.text}`}
        title={`Data is ${freshness!.status.replace('_', ' ')}`}
      >
        <StatusIcon status={freshness!.status} />
        <span>
          Last synced: <span className="font-medium">{absoluteTime}</span>
        </span>
        {freshness!.isStale && (
          <span className="text-[10px] uppercase tracking-wide opacity-75">
            (stale)
          </span>
        )}
      </div>
      {isAdmin && (
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Refresh cache (admin only)"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span>{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
        </button>
      )}
    </div>
  );
}
