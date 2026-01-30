'use client';

import { useState, useEffect } from 'react';
import { CheckCircle, Clock, AlertCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { DataFreshness, DataFreshnessStatus } from '@/types/dashboard';
import { dashboardApi } from '@/lib/api-client';
import { getSessionPermissions } from '@/types/auth';
import { TransferConfirmModal } from '@/components/dashboard/TransferConfirmModal';
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
  // Hooks must be called unconditionally at the top level
  const { data: session } = useSession();
  const permissions = getSessionPermissions(session);
  const isAdmin = permissions?.role === 'admin' || permissions?.role === 'manager' || permissions?.role === 'revops_admin';

  const [freshness, setFreshness] = useState<DataFreshness | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // Transfer state
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferState, setTransferState] = useState<'idle' | 'triggering' | 'polling' | 'success' | 'error'>('idle');
  const [transferRunId, setTransferRunId] = useState<string | null>(null);
  const [transferMessage, setTransferMessage] = useState<string>('');
  const [cooldownMinutes, setCooldownMinutes] = useState<number>(0);

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
    // Check cooldown first
    try {
      const cooldown = await dashboardApi.getTransferCooldownStatus();
      setCooldownMinutes(cooldown.cooldownMinutes);
      if (cooldown.cooldown) {
        // Still show modal but with cooldown warning
        setShowTransferModal(true);
        return;
      }
    } catch (err) {
      console.error('Error checking cooldown:', err);
    }
    
    // Show confirmation modal
    setShowTransferModal(true);
  };

  // Keep existing handleCacheRefresh as fallback (rename if needed)
  const handleCacheRefreshOnly = async () => {
    setIsRefreshing(true);
    try {
      const response = await fetch('/api/admin/refresh-cache', {
        method: 'POST',
      });
      
      if (response.ok) {
        console.log('Cache refreshed successfully');
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

  const handleConfirmTransfer = async () => {
    setShowTransferModal(false);
    setTransferState('triggering');
    setTransferMessage('Starting data sync...');

    try {
      const response = await dashboardApi.triggerDataTransfer();
      
      if (response.success && response.runId) {
        setTransferRunId(response.runId);
        setTransferState('polling');
        setTransferMessage('Syncing data from Salesforce... (3-5 min)');
      } else {
        setTransferState('error');
        setTransferMessage(response.message || 'Failed to start transfer');
        if (response.cooldownMinutes) {
          setCooldownMinutes(response.cooldownMinutes);
        }
      }
    } catch (err) {
      setTransferState('error');
      setTransferMessage(err instanceof Error ? err.message : 'Failed to trigger transfer');
    }
  };

  useEffect(() => {
    fetchFreshness();
    
    // Refresh every 5 minutes
    const interval = setInterval(fetchFreshness, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Poll for transfer completion
  useEffect(() => {
    if (transferState !== 'polling' || !transferRunId) return;

    const pollInterval = setInterval(async () => {
      try {
        const status = await dashboardApi.getTransferStatus(transferRunId);

        if (status.isComplete) {
          clearInterval(pollInterval);
          
          if (status.success) {
            setTransferState('success');
            setTransferMessage('Data synced successfully! Refreshing...');
            // Refresh freshness data
            setTimeout(() => {
              fetchFreshness();
              setTransferState('idle');
              setTransferRunId(null);
            }, 2000);
          } else {
            setTransferState('error');
            setTransferMessage(status.errorMessage || 'Transfer failed');
          }
        }
      } catch (err) {
        console.error('Error polling transfer status:', err);
      }
    }, 10000); // Poll every 10 seconds

    // Timeout after 10 minutes
    const timeout = setTimeout(() => {
      clearInterval(pollInterval);
      setTransferState('error');
      setTransferMessage('Transfer timed out. Please check BigQuery console.');
    }, 10 * 60 * 1000);

    return () => {
      clearInterval(pollInterval);
      clearTimeout(timeout);
    };
  }, [transferState, transferRunId]);

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
      <>
        <div className={`flex items-center gap-2 ${className}`}>
          <div 
            className={`flex items-center gap-1.5 text-xs ${colors.text}`}
            title={`Last synced: ${absoluteTime}\nStatus: ${freshness!.status}`}
          >
            <span className={`w-2 h-2 rounded-full ${colors.dot}`} />
            <span>Updated {relativeTime}</span>
          </div>
          {isAdmin && (
            <button
              onClick={handleRefresh}
              disabled={isRefreshing || transferState !== 'idle'}
              className="flex items-center gap-1 px-1.5 py-0.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="Sync data from Salesforce (admin only)"
            >
              <RefreshCw className={`w-3 h-3 ${isRefreshing || transferState !== 'idle' ? 'animate-spin' : ''}`} />
            </button>
          )}
          {/* Transfer status indicator for compact variant */}
          {transferState !== 'idle' && (
            <div className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs ${
              transferState === 'polling' || transferState === 'triggering' 
                ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400'
                : transferState === 'success'
                ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
            }`}>
              {transferState === 'polling' || transferState === 'triggering' ? (
                <RefreshCw className="w-2.5 h-2.5 animate-spin" />
              ) : transferState === 'success' ? (
                <CheckCircle className="w-2.5 h-2.5" />
              ) : (
                <AlertTriangle className="w-2.5 h-2.5" />
              )}
              <span className="hidden sm:inline">{transferMessage}</span>
            </div>
          )}
        </div>
        
        {/* Transfer confirmation modal - shared for both variants */}
        <TransferConfirmModal
          isOpen={showTransferModal}
          onClose={() => setShowTransferModal(false)}
          onConfirm={handleConfirmTransfer}
          isTriggering={transferState === 'triggering'}
          cooldownMinutes={cooldownMinutes}
        />
      </>
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
          disabled={isRefreshing || transferState !== 'idle'}
          className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Sync data from Salesforce (admin only)"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing || transferState !== 'idle' ? 'animate-spin' : ''}`} />
          <span>{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
        </button>
      )}
      
      {/* Transfer status overlay */}
      {transferState !== 'idle' && (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-md text-xs ${
          transferState === 'polling' || transferState === 'triggering' 
            ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400'
            : transferState === 'success'
            ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
            : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
        }`}>
          {transferState === 'polling' || transferState === 'triggering' ? (
            <RefreshCw className="w-3 h-3 animate-spin" />
          ) : transferState === 'success' ? (
            <CheckCircle className="w-3 h-3" />
          ) : (
            <AlertTriangle className="w-3 h-3" />
          )}
          <span>{transferMessage}</span>
          {transferState === 'error' && (
            <button
              onClick={() => setTransferState('idle')}
              className="ml-2 text-xs underline hover:no-underline"
            >
              Dismiss
            </button>
          )}
        </div>
      )}
      
      {/* Transfer confirmation modal */}
      <TransferConfirmModal
        isOpen={showTransferModal}
        onClose={() => setShowTransferModal(false)}
        onConfirm={handleConfirmTransfer}
        isTriggering={transferState === 'triggering'}
        cooldownMinutes={cooldownMinutes}
      />
    </div>
  );
}
