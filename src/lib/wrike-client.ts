import {
  WrikeTask,
  WrikeComment,
  WrikeError,
  CreateTaskData,
  UpdateTaskData,
} from '@/types/wrike';

// Custom error class for Wrike API errors
export class WrikeAPIError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public isRateLimited: boolean = false,
    public retryAfter?: number
  ) {
    super(message);
    this.name = 'WrikeAPIError';
  }
}

// Rate limit tracking
interface WrikeRateLimitInfo {
  remaining: number;
  reset: Date;
}

// Simple in-memory rate limit tracking
let rateLimitInfo: WrikeRateLimitInfo = {
  remaining: 400, // Wrike default limit
  reset: new Date(),
};

// Check if Wrike integration is configured
export function isWrikeConfigured(): boolean {
  return !!(process.env.WRIKE_ACCESS_TOKEN && process.env.WRIKE_FOLDER_ID);
}

// Core request function with rate limit handling
async function wrikeRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  if (!process.env.WRIKE_ACCESS_TOKEN) {
    throw new WrikeAPIError('Wrike access token not configured', 500);
  }

  // Check rate limit before making request
  if (rateLimitInfo.remaining <= 5 && new Date() < rateLimitInfo.reset) {
    const waitTime = rateLimitInfo.reset.getTime() - Date.now();
    console.warn(`[Wrike] Rate limit approaching, waiting ${waitTime}ms`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }

  const url = `https://www.wrike.com/api/v4${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${process.env.WRIKE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  // Update rate limit tracking from headers
  const remaining = response.headers.get('X-RateLimit-Remaining');
  const reset = response.headers.get('X-RateLimit-Reset');

  if (remaining) rateLimitInfo.remaining = parseInt(remaining);
  if (reset) rateLimitInfo.reset = new Date(parseInt(reset) * 1000);

  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get('Retry-After') || '60');
    throw new WrikeAPIError(
      'Wrike rate limit exceeded',
      429,
      true,
      retryAfter
    );
  }

  if (!response.ok) {
    let errorMessage = 'Wrike API error';
    try {
      const error = await response.json() as WrikeError;
      errorMessage = error.errorDescription || error.error || errorMessage;
    } catch {
      // Ignore JSON parse errors
    }
    throw new WrikeAPIError(errorMessage, response.status);
  }

  const data = await response.json();
  return data.data as T;
}

// Retry wrapper with exponential backoff
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (error instanceof WrikeAPIError) {
        // Don't retry client errors (4xx except 429)
        if (error.statusCode >= 400 && error.statusCode < 500 && !error.isRateLimited) {
          throw error;
        }

        // Rate limited - wait the specified time
        if (error.isRateLimited && error.retryAfter) {
          console.log(`[Wrike] Rate limited, waiting ${error.retryAfter}s before retry`);
          await new Promise(resolve => setTimeout(resolve, error.retryAfter! * 1000));
          continue;
        }
      }

      // Exponential backoff for other errors
      const delay = Math.pow(2, attempt) * 1000;
      console.log(`[Wrike] Request failed, retrying in ${delay}ms...`, error);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

// Export wrapped API functions
export const wrikeClient = {
  async createTask(folderId: string, data: CreateTaskData): Promise<WrikeTask[]> {
    return withRetry(() =>
      wrikeRequest<WrikeTask[]>(`/folders/${folderId}/tasks`, {
        method: 'POST',
        body: JSON.stringify(data),
      })
    );
  },

  async updateTask(taskId: string, data: UpdateTaskData): Promise<WrikeTask[]> {
    return withRetry(() =>
      wrikeRequest<WrikeTask[]>(`/tasks/${taskId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      })
    );
  },

  async deleteTask(taskId: string): Promise<void> {
    return withRetry(() =>
      wrikeRequest<void>(`/tasks/${taskId}`, {
        method: 'DELETE',
      })
    );
  },

  async getTask(taskId: string): Promise<WrikeTask[]> {
    return withRetry(() =>
      wrikeRequest<WrikeTask[]>(`/tasks/${taskId}`)
    );
  },

  async addComment(taskId: string, text: string): Promise<WrikeComment[]> {
    return withRetry(() =>
      wrikeRequest<WrikeComment[]>(`/tasks/${taskId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      })
    );
  },

  async getComments(taskId: string): Promise<WrikeComment[]> {
    return withRetry(() =>
      wrikeRequest<WrikeComment[]>(`/tasks/${taskId}/comments`)
    );
  },
};
