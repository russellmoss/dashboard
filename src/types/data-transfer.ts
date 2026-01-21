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
