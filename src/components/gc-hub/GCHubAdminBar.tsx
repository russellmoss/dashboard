// src/components/gc-hub/GCHubAdminBar.tsx

'use client';

import { useState } from 'react';
import { Text } from '@tremor/react';
import { RefreshCw, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { gcHubApi } from '@/lib/api-client';
import { formatRelativeTime } from '@/lib/gc-hub/formatters';
import type { GcSyncStatus } from '@/types/gc-hub';

interface GCHubAdminBarProps {
  syncStatus: GcSyncStatus | null;
  onSyncComplete: () => void;
}

export function GCHubAdminBar({ syncStatus, onSyncComplete }: GCHubAdminBarProps) {
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncSuccess, setSyncSuccess] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    setSyncError(null);
    setSyncSuccess(false);
    try {
      const result = await gcHubApi.triggerSync();
      if (result.success) {
        setSyncSuccess(true);
        onSyncComplete();
        setTimeout(() => setSyncSuccess(false), 3000);
      } else {
        setSyncError(result.message || 'Sync failed');
      }
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-4 flex-wrap px-4 py-2 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700">
      {/* Status */}
      <div className="flex items-center gap-4 text-sm flex-wrap" role="status" aria-live="polite">
        <div className="flex items-center gap-1.5">
          {syncStatus?.lastSyncStatus === 'completed' ? (
            <CheckCircle className="w-4 h-4 text-emerald-500" aria-hidden="true" />
          ) : (
            <AlertCircle className="w-4 h-4 text-amber-500" aria-hidden="true" />
          )}
          <Text className="text-gray-600 dark:text-gray-400">
            Last sync: {formatRelativeTime(syncStatus?.lastSync)}
          </Text>
        </div>
        <Text className="text-gray-400 dark:text-gray-500">·</Text>
        <Text className="text-gray-600 dark:text-gray-400">
          {syncStatus?.totalRecords?.toLocaleString() ?? 0} records
        </Text>
        <Text className="text-gray-400 dark:text-gray-500">·</Text>
        <Text className="text-gray-600 dark:text-gray-400">
          Type: {syncStatus?.lastSyncType ?? '—'}
        </Text>
      </div>

      {/* Sync Button */}
      <div className="flex items-center gap-2">
        {syncError && (
          <Text className="text-sm text-red-500 dark:text-red-400">{syncError}</Text>
        )}
        {syncSuccess && (
          <Text className="text-sm text-emerald-500 dark:text-emerald-400">Sync complete!</Text>
        )}
        <button
          onClick={handleSync}
          disabled={syncing}
          aria-busy={syncing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          {syncing ? (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
          )}
          {syncing ? 'Syncing...' : 'Sync Now'}
        </button>
      </div>
    </div>
  );
}
