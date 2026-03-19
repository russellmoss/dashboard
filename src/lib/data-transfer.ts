import { DataTransferServiceClient } from '@google-cloud/bigquery-data-transfer';
import { logger } from './logger';

// Transfer configurations — one per Salesforce object
const TRANSFER_CONFIGS = [
  { id: 'projects/154995667624/locations/northamerica-northeast2/transferConfigs/69ba87ea-0000-2a91-9630-5c337bbe1213', label: 'Lead' },
  { id: 'projects/154995667624/locations/northamerica-northeast2/transferConfigs/69ba8764-0000-2a91-9630-5c337bbe1213', label: 'Opportunity' },
  { id: 'projects/154995667624/locations/northamerica-northeast2/transferConfigs/69bd1cab-0000-2f23-a3d2-ac3eb15e6930', label: 'Campaign History' },
  { id: 'projects/154995667624/locations/northamerica-northeast2/transferConfigs/68d12521-0000-207a-b4fa-ac3eb14e17d8', label: 'Contact' },
  { id: 'projects/154995667624/locations/northamerica-northeast2/transferConfigs/69bbd8c0-0000-2b19-9d1c-9898fbb3ccd5', label: 'Task' },
  { id: 'projects/154995667624/locations/northamerica-northeast2/transferConfigs/69ba8889-0000-2a91-9630-5c337bbe1213', label: 'Campaign' },
];

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
 * Trigger all data transfer runs in parallel
 */
export async function triggerDataTransfer(): Promise<{
  success: boolean;
  runIds?: string[];
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
    const requestedRunTime = { seconds: Math.floor(Date.now() / 1000) };

    logger.info('[Data Transfer] Triggering all transfer runs in parallel', {
      configs: TRANSFER_CONFIGS.map(c => c.label),
    });

    const results = await Promise.allSettled(
      TRANSFER_CONFIGS.map(async (config) => {
        const [response] = await client.startManualTransferRuns({
          parent: config.id,
          requestedRunTime,
        });

        if (response.runs && response.runs.length > 0) {
          const runId = response.runs[0].name || '';
          logger.info(`[Data Transfer] ${config.label} triggered`, { runId });
          return { label: config.label, runId };
        }
        throw new Error(`${config.label}: no run ID returned`);
      })
    );

    const succeeded = results
      .filter((r): r is PromiseFulfilledResult<{ label: string; runId: string }> => r.status === 'fulfilled')
      .map(r => r.value);

    const failed = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map(r => String(r.reason));

    if (succeeded.length === 0) {
      return {
        success: false,
        message: `All transfers failed: ${failed.join('; ')}`,
      };
    }

    // Start cooldown only after triggering (will be refreshed on completion)
    lastTransferTime = Date.now();

    const runIds = succeeded.map(s => s.runId);

    logger.info('[Data Transfer] Transfers triggered', {
      succeeded: succeeded.map(s => s.label),
      failed,
      runIds,
    });

    return {
      success: true,
      runIds,
      message: failed.length > 0
        ? `${succeeded.length}/${TRANSFER_CONFIGS.length} transfers started. Failed: ${failed.join('; ')}`
        : `All ${TRANSFER_CONFIGS.length} transfers started successfully.`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('[Data Transfer] Failed to trigger transfers', { error: errorMessage });

    return {
      success: false,
      message: `Failed to trigger transfers: ${errorMessage}`,
    };
  }
}

/**
 * Get the aggregated status of multiple transfer runs.
 * Complete only when ALL runs reach a terminal state.
 * Success only if ALL completed runs succeeded.
 */
export async function getTransferRunStatus(runIds: string | string[]): Promise<{
  state: string;
  isComplete: boolean;
  success: boolean;
  errorMessage?: string;
  startTime?: string;
  endTime?: string;
  runs?: Array<{ runId: string; state: string; success: boolean }>;
}> {
  const ids = Array.isArray(runIds) ? runIds : [runIds];

  try {
    const client = getDataTransferClient();

    const statuses = await Promise.all(
      ids.map(async (runId) => {
        try {
          const [run] = await client.getTransferRun({ name: runId });
          const state = run.state as string;
          return {
            runId,
            state,
            isComplete: ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(state),
            success: state === 'SUCCEEDED',
            errorMessage: run.errorStatus?.message ?? undefined,
            startTime: run.runTime?.seconds
              ? new Date(Number(run.runTime.seconds) * 1000).toISOString()
              : undefined,
            endTime: run.endTime?.seconds
              ? new Date(Number(run.endTime.seconds) * 1000).toISOString()
              : undefined,
          };
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Unknown error';
          return {
            runId,
            state: 'UNKNOWN',
            isComplete: true,
            success: false,
            errorMessage: msg,
            startTime: undefined,
            endTime: undefined,
          };
        }
      })
    );

    const allComplete = statuses.every(s => s.isComplete);
    const allSuccess = allComplete && statuses.every(s => s.success);
    const failedRuns = statuses.filter(s => s.isComplete && !s.success);

    // Reset cooldown to now when all complete so the 15-min window
    // starts from actual completion, not from trigger time.
    if (allComplete) {
      lastTransferTime = Date.now();
    }

    // Aggregate state
    let aggregateState: string;
    if (!allComplete) {
      aggregateState = 'RUNNING';
    } else if (allSuccess) {
      aggregateState = 'SUCCEEDED';
    } else {
      aggregateState = 'PARTIALLY_FAILED';
    }

    // Earliest start, latest end
    const startTimes = statuses.map(s => s.startTime).filter(Boolean) as string[];
    const endTimes = statuses.map(s => s.endTime).filter(Boolean) as string[];

    return {
      state: aggregateState,
      isComplete: allComplete,
      success: allSuccess,
      errorMessage: failedRuns.length > 0
        ? `${failedRuns.length} transfer(s) failed: ${failedRuns.map(r => r.errorMessage || r.state).join('; ')}`
        : undefined,
      startTime: startTimes.length > 0 ? startTimes.sort()[0] : undefined,
      endTime: endTimes.length > 0 ? endTimes.sort().reverse()[0] : undefined,
      runs: statuses.map(s => ({ runId: s.runId, state: s.state, success: s.success })),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('[Data Transfer] Failed to get transfer statuses', { runIds: ids, error: errorMessage });

    return {
      state: 'UNKNOWN',
      isComplete: true,
      success: false,
      errorMessage,
    };
  }
}

/**
 * Get recent transfer runs for display (across all configs)
 */
export async function getRecentTransferRuns(limit: number = 5): Promise<Array<{
  runId: string;
  label: string;
  state: string;
  startTime: string;
  endTime?: string;
  durationSeconds?: number;
}>> {
  try {
    const client = getDataTransferClient();

    const allRuns = await Promise.all(
      TRANSFER_CONFIGS.map(async (config) => {
        try {
          const [runs] = await client.listTransferRuns({
            parent: config.id,
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
              label: config.label,
              state: run.state as string,
              startTime,
              endTime,
              durationSeconds,
            };
          });
        } catch {
          return [];
        }
      })
    );

    // Flatten and sort by start time descending, take top N
    return allRuns
      .flat()
      .sort((a, b) => (b.startTime || '').localeCompare(a.startTime || ''))
      .slice(0, limit);
  } catch (error) {
    logger.error('[Data Transfer] Failed to list transfer runs', { error });
    return [];
  }
}
