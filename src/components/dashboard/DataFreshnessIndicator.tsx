'use client';

import { useState, useEffect } from 'react';
import { CheckCircle, Clock, AlertCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import { DataFreshness, DataFreshnessStatus } from '@/types/dashboard';
import { dashboardApi } from '@/lib/api-client';
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
    <div 
      className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs ${colors.bg} ${colors.text} ${className}`}
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
  );
}
