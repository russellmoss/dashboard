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
      errorMessage: run.errorStatus?.message ?? undefined,
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
