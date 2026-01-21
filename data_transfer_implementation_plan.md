# Data Transfer Feature - Step-by-Step Implementation Plan

> **Purpose**: Enable on-demand Salesforce → BigQuery data transfers from the dashboard
> **Created**: January 21, 2026
> **Updated**: January 21, 2026 (based on codebase analysis)
> **Estimated Time**: 4-6 hours

---

## Pre-Implementation Checklist

- [x] BigQuery Data Transfer configured (every 6 hours)
- [x] Objects syncing: Lead, Opportunity, Task
- [x] Service account has `BigQuery Admin` role
- [x] `@google-cloud/bigquery-data-transfer` package installed (v5.1.2)
- [x] Manual transfer trigger tested and working
- [x] Codebase analysis completed (`data_transfer_answers.md`)
- [ ] ⚠️ **Verify**: Service account has `bigquery.transfers.update` IAM permission (not just BigQuery Admin)

---

## ⚠️ Important Notes

1. **Cooldown Storage**: Current plan uses in-memory cooldown tracking. This resets on server restart. For production, consider storing in database or Redis.
2. **Cache TTL**: Update to reduced values immediately (4h default, 2h detail records) - BigQuery transfers are reliable (99% success rate over 90 runs).
3. **Cron Jobs**: Cron jobs refresh cache 10 minutes AFTER BigQuery transfers complete (not during). Transfers are scheduled separately in BigQuery, our crons just refresh cache after completion.
4. **Confirmation Dialog**: Add confirmation before triggering transfer (reuse `DeleteConfirmModal` pattern) - created as new `TransferConfirmModal` component.
5. **API Client Pattern**: Add methods to existing `dashboardApi` object, not separate `dataTransferApi`.
6. **Component Updates**: Incrementally update `DataFreshnessIndicator` - preserve all existing functionality, add transfer trigger as enhancement.
7. **Permissions**: Component already calculates `isAdmin` internally - just update to include manager role (single line change).

## 📋 Key Updates Made to Plan

Based on codebase analysis (`data_transfer_answers.md`):

1. ✅ **API Client**: Changed from separate `dataTransferApi` to methods on existing `dashboardApi` object
2. ✅ **Component Update**: Changed from full rewrite to incremental updates preserving existing behavior
3. ✅ **Confirmation Modal**: Added as separate component (`TransferConfirmModal.tsx`) before component updates
4. ✅ **Cron Jobs**: Clarified approach - separate endpoint for triggering transfers, cache invalidates on status check
5. ✅ **Cache TTL**: Reduce TTL immediately to 4h/2h - BigQuery transfers are reliable (99% success rate)
6. ✅ **Permissions**: Component already handles internally - just need to update one line to include manager
7. ✅ **File Structure**: Added `TransferConfirmModal.tsx` and `src/app/api/cron/trigger-transfer/route.ts` to created files list

---

## Phase 1: Create Data Transfer Library

### Step 1.1: Create TypeScript Types

**Create file**: `src/types/data-transfer.ts`

```typescript
export interface TransferRunStatus {
  runId: string;
  state: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  startTime: string;
  endTime?: string;
  errorMessage?: string;
}

export interface TriggerTransferResponse {
  success: boolean;
  runId?: string;
  message: string;
  estimatedDuration?: string;
}

export interface TransferStatusResponse {
  status: TransferRunStatus;
  isComplete: boolean;
  success: boolean;
}

export type TransferTriggerRole = 'admin' | 'manager';
```

### Step 1.2: Create Data Transfer Client Library

**Create file**: `src/lib/data-transfer.ts`

```typescript
import { DataTransferServiceClient } from '@google-cloud/bigquery-data-transfer';
import { logger } from './logger';

// Transfer configuration
const TRANSFER_CONFIG_ID = 'projects/154995667624/locations/northamerica-northeast2/transferConfigs/68d12521-0000-207a-b4fa-ac3eb14e17d8';

// Cooldown tracking (in-memory for now)
let lastTransferTime: number | null = null;
const COOLDOWN_MINUTES = 15;

// Singleton client
let dataTransferClient: DataTransferServiceClient | null = null;

/**
 * Get or create the Data Transfer Service client
 */
function getDataTransferClient(): DataTransferServiceClient {
  if (dataTransferClient) return dataTransferClient;

  const projectId = process.env.GCP_PROJECT_ID || 'savvy-gtm-analytics';

  // Use same credential handling as BigQuery client
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    try {
      let jsonString = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
      
      // Fix newlines in private_key
      jsonString = jsonString.replace(/"private_key"\s*:\s*"([\s\S]*?)"/g, (match, keyContent) => {
        const fixedKey = keyContent
          .replace(/\r\n/g, '\\n')
          .replace(/\n/g, '\\n')
          .replace(/\r/g, '\\n');
        return `"private_key":"${fixedKey}"`;
      });
      
      const credentials = JSON.parse(jsonString);
      
      if (credentials.private_key && typeof credentials.private_key === 'string') {
        credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
      }
      
      dataTransferClient = new DataTransferServiceClient({
        projectId,
        credentials,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to initialize Data Transfer client: ${errorMessage}`);
    }
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    dataTransferClient = new DataTransferServiceClient({
      projectId,
      keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    });
  } else {
    throw new Error('No Google Cloud credentials configured');
  }

  return dataTransferClient;
}

/**
 * Check if we're within the cooldown period
 */
export function isWithinCooldown(): { withinCooldown: boolean; minutesRemaining: number } {
  if (!lastTransferTime) {
    return { withinCooldown: false, minutesRemaining: 0 };
  }
  
  const elapsedMs = Date.now() - lastTransferTime;
  const elapsedMinutes = elapsedMs / (1000 * 60);
  const minutesRemaining = Math.ceil(COOLDOWN_MINUTES - elapsedMinutes);
  
  return {
    withinCooldown: elapsedMinutes < COOLDOWN_MINUTES,
    minutesRemaining: Math.max(0, minutesRemaining),
  };
}

/**
 * Trigger a manual data transfer run
 */
export async function triggerDataTransfer(): Promise<{
  success: boolean;
  runId?: string;
  message: string;
}> {
  // Check cooldown
  const cooldown = isWithinCooldown();
  if (cooldown.withinCooldown) {
    return {
      success: false,
      message: `Please wait ${cooldown.minutesRemaining} minutes before triggering another transfer`,
    };
  }

  try {
    const client = getDataTransferClient();
    
    logger.info('[Data Transfer] Triggering manual transfer run', {
      configId: TRANSFER_CONFIG_ID,
    });

    const [response] = await client.startManualTransferRuns({
      parent: TRANSFER_CONFIG_ID,
      requestedRunTime: {
        seconds: Math.floor(Date.now() / 1000),
      },
    });

    if (response.runs && response.runs.length > 0) {
      const run = response.runs[0];
      const runId = run.name || '';
      
      // Update cooldown tracker
      lastTransferTime = Date.now();
      
      logger.info('[Data Transfer] Transfer triggered successfully', {
        runId,
        state: run.state,
      });

      return {
        success: true,
        runId,
        message: 'Data transfer started successfully. This typically takes 3-5 minutes.',
      };
    }

    return {
      success: false,
      message: 'Transfer triggered but no run ID returned',
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('[Data Transfer] Failed to trigger transfer', { error: errorMessage });
    
    return {
      success: false,
      message: `Failed to trigger transfer: ${errorMessage}`,
    };
  }
}

/**
 * Get the status of a transfer run
 */
export async function getTransferRunStatus(runId: string): Promise<{
  state: string;
  isComplete: boolean;
  success: boolean;
  errorMessage?: string;
  startTime?: string;
  endTime?: string;
}> {
  try {
    const client = getDataTransferClient();
    
    const [run] = await client.getTransferRun({ name: runId });
    
    const state = run.state as string;
    const isComplete = ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(state);
    const success = state === 'SUCCEEDED';
    
    return {
      state,
      isComplete,
      success,
      errorMessage: run.errorStatus?.message,
      startTime: run.runTime?.seconds 
        ? new Date(Number(run.runTime.seconds) * 1000).toISOString() 
        : undefined,
      endTime: run.endTime?.seconds 
        ? new Date(Number(run.endTime.seconds) * 1000).toISOString() 
        : undefined,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('[Data Transfer] Failed to get transfer status', { runId, error: errorMessage });
    
    return {
      state: 'UNKNOWN',
      isComplete: true,
      success: false,
      errorMessage,
    };
  }
}

/**
 * Get recent transfer runs for display
 */
export async function getRecentTransferRuns(limit: number = 5): Promise<Array<{
  runId: string;
  state: string;
  startTime: string;
  endTime?: string;
  durationSeconds?: number;
}>> {
  try {
    const client = getDataTransferClient();
    
    const [runs] = await client.listTransferRuns({
      parent: TRANSFER_CONFIG_ID,
      pageSize: limit,
    });

    return runs.map(run => {
      const startTime = run.runTime?.seconds 
        ? new Date(Number(run.runTime.seconds) * 1000).toISOString() 
        : '';
      const endTime = run.endTime?.seconds 
        ? new Date(Number(run.endTime.seconds) * 1000).toISOString() 
        : undefined;
      
      let durationSeconds: number | undefined;
      if (run.runTime?.seconds && run.endTime?.seconds) {
        durationSeconds = Number(run.endTime.seconds) - Number(run.runTime.seconds);
      }

      return {
        runId: run.name || '',
        state: run.state as string,
        startTime,
        endTime,
        durationSeconds,
      };
    });
  } catch (error) {
    logger.error('[Data Transfer] Failed to list transfer runs', { error });
    return [];
  }
}
```

---

## Phase 2: Create API Endpoints

### Step 2.1: Create Trigger Transfer Endpoint (Admin/Manager)

**Create file**: `src/app/api/admin/trigger-transfer/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { triggerDataTransfer, isWithinCooldown } from '@/lib/data-transfer';
import { revalidateTag } from 'next/cache';
import { CACHE_TAGS } from '@/lib/cache';
import { logger } from '@/lib/logger';

// Roles allowed to trigger transfers
const ALLOWED_ROLES = ['admin', 'manager'];

export async function POST(request: NextRequest) {
  try {
    // Auth check
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Permission check
    const permissions = await getUserPermissions(session.user?.email || '');
    if (!ALLOWED_ROLES.includes(permissions.role)) {
      return NextResponse.json(
        { error: 'Only admins and managers can trigger data transfers' },
        { status: 403 }
      );
    }

    // Check cooldown first (before triggering)
    const cooldown = isWithinCooldown();
    if (cooldown.withinCooldown) {
      return NextResponse.json({
        success: false,
        message: `Please wait ${cooldown.minutesRemaining} minutes before triggering another transfer`,
        cooldownMinutes: cooldown.minutesRemaining,
      }, { status: 429 });
    }

    // Trigger the transfer
    const result = await triggerDataTransfer();

    logger.info('[API] Transfer trigger requested', {
      user: session.user?.email,
      success: result.success,
      runId: result.runId,
    });

    if (result.success) {
      return NextResponse.json({
        success: true,
        runId: result.runId,
        message: result.message,
        estimatedDuration: '3-5 minutes',
      });
    } else {
      return NextResponse.json({
        success: false,
        message: result.message,
      }, { status: 400 });
    }
  } catch (error) {
    logger.error('[API] Error triggering transfer:', error);
    return NextResponse.json(
      { error: 'Failed to trigger data transfer' },
      { status: 500 }
    );
  }
}

// GET endpoint to check transfer status
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = await getUserPermissions(session.user?.email || '');
    if (!ALLOWED_ROLES.includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const runId = searchParams.get('runId');

    if (!runId) {
      // Return cooldown status if no runId
      const cooldown = isWithinCooldown();
      return NextResponse.json({
        cooldown: cooldown.withinCooldown,
        cooldownMinutes: cooldown.minutesRemaining,
      });
    }

    // Get status of specific run
    const { getTransferRunStatus } = await import('@/lib/data-transfer');
    const status = await getTransferRunStatus(runId);

    // If transfer completed successfully, invalidate cache
    if (status.isComplete && status.success) {
      revalidateTag(CACHE_TAGS.DASHBOARD);
      revalidateTag(CACHE_TAGS.SGA_HUB);
      
      logger.info('[API] Cache invalidated after successful transfer', {
        runId,
        tags: [CACHE_TAGS.DASHBOARD, CACHE_TAGS.SGA_HUB],
      });
    }

    return NextResponse.json({
      runId,
      ...status,
      cacheInvalidated: status.isComplete && status.success,
    });
  } catch (error) {
    logger.error('[API] Error checking transfer status:', error);
    return NextResponse.json(
      { error: 'Failed to check transfer status' },
      { status: 500 }
    );
  }
}
```

### Step 2.2: Update API Client

**Update file**: `src/lib/api-client.ts`

Add these methods to the existing `dashboardApi` object (around line 400, before the closing brace):

```typescript
  /**
   * Trigger a manual data transfer (admin/manager only)
   */
  async triggerDataTransfer(): Promise<{
    success: boolean;
    runId?: string;
    message: string;
    estimatedDuration?: string;
    cooldownMinutes?: number;
  }> {
    return apiFetch<{
      success: boolean;
      runId?: string;
      message: string;
      estimatedDuration?: string;
      cooldownMinutes?: number;
    }>('/api/admin/trigger-transfer', {
      method: 'POST',
    });
  },

  /**
   * Check the status of a transfer run
   */
  async getTransferStatus(runId: string): Promise<{
    runId: string;
    state: string;
    isComplete: boolean;
    success: boolean;
    errorMessage?: string;
    cacheInvalidated?: boolean;
  }> {
    return apiFetch<{
      runId: string;
      state: string;
      isComplete: boolean;
      success: boolean;
      errorMessage?: string;
      cacheInvalidated?: boolean;
    }>(`/api/admin/trigger-transfer?runId=${encodeURIComponent(runId)}`);
  },

  /**
   * Check cooldown status
   */
  async getTransferCooldownStatus(): Promise<{
    cooldown: boolean;
    cooldownMinutes: number;
  }> {
    return apiFetch<{
      cooldown: boolean;
      cooldownMinutes: number;
    }>('/api/admin/trigger-transfer');
  },
```

**Note**: Use `apiFetch` helper function (already defined in the file) for consistency with other API calls.

**Location**: Add these methods inside the `dashboardApi` object (around line 400, before the closing brace `};`).

---

## Phase 3: Update UI Components

### Step 3.1: Create Transfer Confirmation Modal

**Create file**: `src/components/dashboard/TransferConfirmModal.tsx`

**Pattern**: Follow the same structure as `DeleteConfirmModal.tsx` (reuse pattern)

```typescript
'use client';

import { X, RefreshCw, AlertTriangle } from 'lucide-react';
import { Button } from '@tremor/react';

interface TransferConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isTriggering?: boolean;
  cooldownMinutes?: number;
}

export function TransferConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  isTriggering = false,
  cooldownMinutes = 0,
}: TransferConfirmModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black bg-opacity-50"
        onClick={onClose}
      />
      <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
            <RefreshCw className="w-5 h-5" />
            <h2 className="text-lg font-semibold">Sync Data from Salesforce</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            disabled={isTriggering}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4">
          <p className="text-gray-700 dark:text-gray-300 mb-3">
            This will trigger a data sync from Salesforce to BigQuery. The process typically takes 3-5 minutes.
          </p>
          
          {cooldownMinutes > 0 && (
            <div className="flex items-center gap-2 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md mb-3">
              <AlertTriangle className="w-4 h-4 text-yellow-600 dark:text-yellow-400 flex-shrink-0" />
              <span className="text-sm text-yellow-800 dark:text-yellow-200">
                Please wait {cooldownMinutes} minute{cooldownMinutes !== 1 ? 's' : ''} before triggering another sync.
              </span>
            </div>
          )}

          <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md">
            <AlertTriangle className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-blue-800 dark:text-blue-200">
              <p className="font-medium mb-1">Note:</p>
              <ul className="list-disc list-inside space-y-1">
                <li>Data will be synced for Lead, Opportunity, and Task objects</li>
                <li>The dashboard cache will refresh automatically after completion</li>
                <li>You can continue using the dashboard during the sync</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 p-4 border-t border-gray-200 dark:border-gray-700">
          <Button variant="secondary" onClick={onClose} disabled={isTriggering}>
            Cancel
          </Button>
          <Button
            icon={RefreshCw}
            color="blue"
            onClick={onConfirm}
            loading={isTriggering}
            disabled={isTriggering || cooldownMinutes > 0}
          >
            Start Sync
          </Button>
        </div>
      </div>
    </div>
  );
}
```

### Step 3.2: Update DataFreshnessIndicator Component

**Update file**: `src/components/dashboard/DataFreshnessIndicator.tsx`

**Approach**: Incrementally update the existing component rather than replacing it entirely. Add transfer trigger functionality while preserving existing behavior.

**Key changes to make** (preserve all existing code, add new functionality):

1. **Update imports** at the top (add new imports, keep existing):
```typescript
import { TransferConfirmModal } from '@/components/dashboard/TransferConfirmModal';
import { CheckCircle } from 'lucide-react'; // Add if not already imported
```

2. **Update line 43** to include manager role:
```typescript
// OLD (line 43):
const isAdmin = permissions?.role === 'admin';

// NEW:
const isAdmin = permissions?.role === 'admin' || permissions?.role === 'manager';
```

3. **Add transfer state** (after line 48, after existing state declarations):
```typescript
// Transfer state (add after isRefreshing state)
const [showTransferModal, setShowTransferModal] = useState(false);
const [transferState, setTransferState] = useState<'idle' | 'triggering' | 'polling' | 'success' | 'error'>('idle');
const [transferRunId, setTransferRunId] = useState<string | null>(null);
const [transferMessage, setTransferMessage] = useState<string>('');
const [cooldownMinutes, setCooldownMinutes] = useState<number>(0);
```

4. **Update `handleRefresh` function** (replace existing function starting at line 63) to show confirmation modal:
```typescript
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
```

4. **Add polling effect** (after existing useEffect):
```typescript
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
```

5. **Update button text and behavior** (in the admin button section):
```typescript
{isAdmin && (
  <button
    onClick={handleRefresh}  // Changed from handleCacheRefresh
    disabled={isRefreshing || transferState !== 'idle'}
    className="flex items-center gap-1 px-1.5 py-0.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    title="Sync data from Salesforce (admin only)"
  >
    <RefreshCw className={`w-3 h-3 ${isRefreshing || transferState !== 'idle' ? 'animate-spin' : ''}`} />
  </button>
)}
```

6. **Add transfer status display** (before closing component):
```typescript
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

{/* Transfer confirmation modal - add at the very end, before final closing tag */}
<TransferConfirmModal
  isOpen={showTransferModal}
  onClose={() => setShowTransferModal(false)}
  onConfirm={handleConfirmTransfer}
  isTriggering={transferState === 'triggering'}
  cooldownMinutes={cooldownMinutes}
/>
```

**Important Notes**:
- ✅ **Preserve all existing code** - this is an incremental enhancement, not a rewrite
- ✅ The component already calculates `isAdmin` internally - just update line 43 to include manager
- ✅ Keep existing `handleRefresh` logic as `handleCacheRefreshOnly` for fallback
- ✅ No prop changes needed in parent components (`GlobalFilters.tsx`, `Header.tsx`)
- ✅ Existing cache refresh button behavior is preserved as fallback

### Step 3.3: Verify DataFreshnessIndicator Usage

**Current usage locations**:
- `src/components/dashboard/GlobalFilters.tsx` (line 421) - `variant="detailed"`
- `src/components/layout/Header.tsx` (line 25) - `variant="compact"`

**No changes needed**: The component already calculates `isAdmin` internally using `getSessionPermissions(session)` (line 43). The component will automatically show the transfer button for admin/manager users.

**Current implementation**:
```typescript
// In DataFreshnessIndicator.tsx (line 43)
const { data: session } = useSession();
const permissions = getSessionPermissions(session);
const isAdmin = permissions?.role === 'admin';
```

**Update needed**: Change line 43 to also check for manager:
```typescript
const isAdmin = permissions?.role === 'admin' || permissions?.role === 'manager';
```

This single-line change enables transfer triggering for both admins and managers.

---

## Phase 4: Update Vercel Cron Configuration

### Step 4.1: Create Cron Transfer Endpoint (Optional - for Future Use)

**Create file**: `src/app/api/cron/trigger-transfer/route.ts`

**Note**: This endpoint is created for potential future use (e.g., if we want cron jobs to trigger transfers). Currently, BigQuery transfers are scheduled separately in BigQuery, and our cron jobs just refresh cache after they complete. This endpoint can be used for manual transfer triggering via cron if needed later.

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { triggerDataTransfer } from '@/lib/data-transfer';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Validate CRON_SECRET (auto-injected by Vercel)
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
      logger.warn('[Cron Transfer] CRON_SECRET not configured');
      return NextResponse.json({ error: 'Cron not configured' }, { status: 500 });
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
      logger.warn('[Cron Transfer] Invalid CRON_SECRET');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Trigger the transfer
    const result = await triggerDataTransfer();

    logger.info('[Cron Transfer] Scheduled transfer triggered', {
      success: result.success,
      runId: result.runId,
      timestamp: new Date().toISOString(),
    });

    if (result.success) {
      return NextResponse.json({
        success: true,
        message: 'Transfer triggered successfully',
        runId: result.runId,
      });
    } else {
      // Don't fail cron job if cooldown is active - that's expected
      return NextResponse.json({
        success: false,
        message: result.message,
      }, { status: 200 }); // Return 200 so cron doesn't retry
    }
  } catch (error) {
    logger.error('[Cron Transfer] Error triggering transfer:', error);
    return NextResponse.json(
      { error: 'Failed to trigger transfer' },
      { status: 500 }
    );
  }
}
```

**Note**: This endpoint triggers transfers but does NOT invalidate cache. Cache invalidation happens automatically when the transfer status is checked after completion (handled in `/api/admin/trigger-transfer` GET endpoint when `status.isComplete && status.success` is true).

💡 **Current Implementation**: BigQuery transfers are scheduled separately in BigQuery (every 6 hours + Friday additions). Our Vercel cron jobs refresh cache 10 minutes AFTER those transfers complete, ensuring fresh data is available immediately after sync.

### Step 4.2: Update vercel.json

**Update file**: `vercel.json`

**Approach**: Cron jobs refresh cache **10 minutes AFTER** BigQuery transfers complete. BigQuery transfers are scheduled separately and take ~4 minutes to complete. Our cron jobs run cache refresh to ensure fresh data is available immediately after transfers finish.

```json
{
  "functions": {
    "src/app/api/dashboard/export-sheets/route.ts": { "maxDuration": 60 },
    "src/app/api/agent/query/route.ts": { "maxDuration": 60 },
    "src/app/api/admin/trigger-transfer/route.ts": { "maxDuration": 60 },
    "src/app/api/cron/trigger-transfer/route.ts": { "maxDuration": 60 }
  },
  "crons": [
    {
      "path": "/api/cron/refresh-cache",
      "schedule": "10 4 * * *"
    },
    {
      "path": "/api/cron/refresh-cache",
      "schedule": "10 10 * * *"
    },
    {
      "path": "/api/cron/refresh-cache",
      "schedule": "10 16 * * *"
    },
    {
      "path": "/api/cron/refresh-cache",
      "schedule": "10 22 * * *"
    },
    {
      "path": "/api/cron/refresh-cache",
      "schedule": "47 19 * * 5"
    },
    {
      "path": "/api/cron/refresh-cache",
      "schedule": "47 20 * * 5"
    },
    {
      "path": "/api/cron/refresh-cache",
      "schedule": "47 22 * * 5"
    }
  ]
}
```

**Schedule breakdown**:
| BQ Transfer (UTC) | Transfer Duration | Cron Time (UTC) | Cron Expression | EST Time | Purpose |
|-------------------|-------------------|-----------------|-----------------|----------|---------|
| 4:00 AM | ~4 minutes | 4:10 AM | `10 4 * * *` | 11:10 PM (prev day) | Night sync |
| 10:00 AM | ~4 minutes | 10:10 AM | `10 10 * * *` | 5:10 AM | Morning sync |
| 4:00 PM | ~4 minutes | 4:10 PM | `10 16 * * *` | 11:10 AM | Midday sync |
| 10:00 PM | ~4 minutes | 10:10 PM | `10 22 * * *` | 5:10 PM | Evening sync |
| Fri 7:37 PM | ~4 minutes | Fri 7:47 PM | `47 19 * * 5` | Fri 2:47 PM | Friday #1 |
| Fri 8:37 PM | ~4 minutes | Fri 8:47 PM | `47 20 * * 5` | Fri 3:47 PM | Friday #2 |
| Fri 10:37 PM | ~4 minutes | Fri 10:47 PM | `47 22 * * 5` | Fri 5:47 PM | Friday #3 |

**Why 10-minute offset**: 
- BigQuery transfers start at the scheduled time and take approximately 4 minutes to complete
- Cron jobs run 10 minutes after transfer start time (6 minutes after completion) to ensure:
  - Transfers have completed successfully
  - Data is fully synced to BigQuery tables
  - Cache refresh happens when fresh data is available
  - Provides buffer for any transfer delays

⚠️ **Note**: These cron jobs refresh cache after scheduled BigQuery transfers complete. Manual transfers triggered via UI will still invalidate cache automatically when status is checked after completion.

---

## Phase 5: Update Cache TTL

### Step 5.1: Update Cache Configuration

**File**: `src/lib/cache.ts`

**Update TTL values** to align with 6-hour transfer schedule. The BigQuery Salesforce connector is reliable (99% success rate over 90 runs), so we should reduce TTL immediately:

```typescript
// Before:
export const DEFAULT_CACHE_TTL = 43200; // 12 hours in seconds
export const DETAIL_RECORDS_TTL = 21600; // 6 hours in seconds

// After:
export const DEFAULT_CACHE_TTL = 14400; // 4 hours in seconds (shorter than 6h transfer interval)
export const DETAIL_RECORDS_TTL = 7200;  // 2 hours in seconds
```

**Rationale**:
- BigQuery transfers run every 6 hours reliably (99% success rate)
- Cache refresh cron jobs run 10 minutes after transfers complete
- Reduced TTL ensures cache expires before next transfer, preventing stale data
- 4-hour TTL provides buffer while ensuring fresh data after each transfer cycle
- 2-hour TTL for detail records balances performance with data freshness for large result sets

---

## Phase 6: Testing

### Step 6.1: Local Testing Checklist

Run these tests locally before deploying:

```bash
# 1. Test data transfer library
node -e "
const { triggerDataTransfer, getTransferRunStatus, isWithinCooldown } = require('./src/lib/data-transfer');
// Test cooldown check
console.log('Cooldown:', isWithinCooldown());
"

# 2. Test API endpoint with curl
curl -X POST http://localhost:3000/api/admin/trigger-transfer \
  -H "Cookie: <your-session-cookie>"

# 3. Test status check
curl "http://localhost:3000/api/admin/trigger-transfer?runId=<run-id>" \
  -H "Cookie: <your-session-cookie>"
```

### Step 6.2: Manual Testing Steps

1. **Login as Admin**:
   - Verify "Sync Data" button appears
   - Click button, confirm transfer starts
   - Watch for progress indicator
   - Verify cache invalidates after completion

2. **Login as Manager**:
   - Verify "Sync Data" button appears
   - Test trigger works

3. **Login as SGA/SGM**:
   - Verify "Sync Data" button does NOT appear
   - Only see data freshness indicator

4. **Test Rate Limiting**:
   - Trigger transfer
   - Immediately try again
   - Verify cooldown message appears

5. **Test Stale Data Warning**:
   - Wait for data to become stale (or mock it)
   - Verify warning banner appears

### Step 6.3: Vercel Deployment Testing

After deploying to Vercel:

1. **Verify Cron Jobs**:
   - Go to Vercel Dashboard → Project → Settings → Cron Jobs
   - Confirm all 7 cron jobs are listed
   - Wait for first scheduled run and check logs

2. **Test Production Transfer**:
   - Login as admin
   - Trigger manual transfer
   - Monitor Vercel function logs
   - Verify data freshness updates

---

## Rollback Plan

If issues occur:

1. **Revert vercel.json** to single cron job: `0 5 * * *`
2. **Revert cache TTL** to original values: `DEFAULT_CACHE_TTL = 43200` (12 hours), `DETAIL_RECORDS_TTL = 21600` (6 hours)
3. **Comment out** transfer trigger button in UI
4. Cache expires naturally within TTL

---

## Summary

### Files Created
- `src/types/data-transfer.ts` - TypeScript types for transfer operations
- `src/lib/data-transfer.ts` - Data Transfer API client library
- `src/app/api/admin/trigger-transfer/route.ts` - Admin/manager transfer trigger endpoint
- `src/app/api/cron/trigger-transfer/route.ts` - Cron-triggered transfer endpoint
- `src/components/dashboard/TransferConfirmModal.tsx` - Confirmation dialog for transfers

### Files Modified
- `src/lib/api-client.ts` - Add `triggerDataTransfer()`, `getTransferStatus()`, `getTransferCooldownStatus()` methods to `dashboardApi` object
- `src/components/dashboard/DataFreshnessIndicator.tsx` - Add transfer trigger functionality (incremental update, preserve existing behavior)
  - Update line 43: Change `isAdmin` check to include manager role
  - Add transfer state management
  - Add confirmation modal integration
  - Add polling logic
  - Add transfer status display
- `vercel.json` - Update cron jobs to refresh cache 10 minutes after BigQuery transfers complete (7 cron jobs)
- `src/lib/cache.ts` - Update TTL values: `DEFAULT_CACHE_TTL = 14400` (4 hours), `DETAIL_RECORDS_TTL = 7200` (2 hours)

### Files NOT Modified
- `src/components/dashboard/GlobalFilters.tsx` - No changes needed (component handles permissions internally)
- `src/components/layout/Header.tsx` - No changes needed (component handles permissions internally)

### Key Behaviors
- Admins and Managers can trigger transfers (via confirmation modal)
- 15-minute cooldown between triggers (in-memory, resets on server restart)
- 10-second polling for transfer status (with 10-minute timeout)
- Cache invalidates automatically after successful transfer completion
- Stale data warning when > 6 hours old (existing behavior preserved)
- 7 cron jobs refresh cache 10 minutes after BigQuery transfers complete (4 daily + 3 Friday)
- Cron jobs run after transfers complete to ensure fresh data is available
- Transfer confirmation dialog prevents accidental triggers

### ⚠️ Known Limitations

1. **Cooldown Storage**: In-memory cooldown resets on server restart. For production, consider:
   - Storing in database (Prisma) - create `LastTransferTrigger` table
   - Using Redis (if available)
   - Querying BigQuery transfer run history to check last run time (most reliable)

2. **Cache Timing**: Cache invalidates when status is checked after transfer completes. If no one checks status (e.g., cron-triggered transfers), cache may not invalidate until TTL expires. 
   - 💡 **Workaround**: Cron jobs could call status check endpoint after triggering, or create separate polling endpoint

3. **Error Handling**: Transfer failures are logged but may not be immediately visible to users unless they check status. Consider:
   - Adding Sentry alerts for transfer failures
   - Email notifications for admins on repeated failures

4. **Component State**: Transfer state is component-local. If user navigates away during transfer, state is lost. Consider:
   - Storing transfer run ID in localStorage
   - Restoring polling state on component mount

### 💡 Future Enhancements

1. **Persistent Cooldown**: Store last transfer time in database (Prisma model) or query BigQuery transfer run history
2. **Automatic Cache Invalidation**: Add background cron job to poll transfer status and invalidate cache after completion
3. **Toast Notifications**: Add toast library (`react-hot-toast` or `sonner`) for better user feedback instead of console.log
4. **Transfer History**: Show recent transfer runs in UI (use `getRecentTransferRuns()` function)
5. **Email Alerts**: Notify admins if transfers fail multiple times (via Sentry or custom email service)
6. **State Persistence**: Store transfer run ID in localStorage to restore polling state after page refresh
7. **Better Error Messages**: Parse BigQuery error messages for user-friendly display

---

## Implementation Order Recommendation

**Recommended sequence**:

1. **Phase 1**: Create data transfer library (foundation)
2. **Phase 2**: Create API endpoints (backend)
3. **Phase 3.1**: Create confirmation modal (UI component)
4. **Phase 3.2**: Incrementally update DataFreshnessIndicator (UI integration)
5. **Phase 2.2**: Update API client (connect UI to backend)
6. **Phase 4**: Create cron transfer endpoint and update vercel.json (automation - cache refresh 10 min after transfers)
7. **Phase 5**: Update cache TTL values to reduced values (4h default, 2h detail records)
8. **Phase 6**: Test thoroughly before production

**Why this order**: Build foundation → backend → UI components → connect them → automate → test

---

*Implementation plan created: January 21, 2026*
