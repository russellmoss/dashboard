import { wrikeClient, isWrikeConfigured, WrikeAPIError } from './wrike-client';
import { prisma } from './prisma';
import {
  WRIKE_CONFIG,
  STATUS_TO_WRIKE,
  PRIORITY_TO_WRIKE,
  CreateTaskData,
} from '@/types/wrike';
import { DashboardRequest, RequestPriority, RequestStatus, User } from '@prisma/client';

type RequestWithSubmitter = DashboardRequest & {
  submitter: Pick<User, 'id' | 'name' | 'email'>;
};

// Format request description for Wrike task (using HTML)
function formatDescriptionForWrike(request: RequestWithSubmitter): string {
  const typeLabel = request.requestType === 'FEATURE_REQUEST' ? 'Feature Request' : 'Data Error';

  let html = `
<p><strong>Submitted by:</strong> ${escapeHtml(request.submitter.name)} (${escapeHtml(request.submitter.email)})</p>
<p><strong>Type:</strong> ${typeLabel}</p>`;

  if (request.affectedPage) {
    html += `<p><strong>Affected Page:</strong> ${escapeHtml(request.affectedPage)}</p>`;
  }

  html += `
<br/>
<p><strong>Description:</strong></p>
<p>${escapeHtml(request.description).replace(/\n/g, '<br/>')}</p>`;

  // Data error specific fields
  if (request.requestType === 'DATA_ERROR') {
    const dataErrorFields: string[] = [];

    if (request.filtersApplied) {
      dataErrorFields.push(`<p><strong>Filters Applied:</strong> ${escapeHtml(request.filtersApplied)}</p>`);
    }
    if (request.valueSeen) {
      dataErrorFields.push(`<p><strong>Value Seen (Incorrect):</strong> ${escapeHtml(request.valueSeen)}</p>`);
    }
    if (request.valueExpected) {
      dataErrorFields.push(`<p><strong>Value Expected (Correct):</strong> ${escapeHtml(request.valueExpected)}</p>`);
    }
    if (request.errorOccurredAt) {
      dataErrorFields.push(`<p><strong>When Noticed:</strong> ${new Date(request.errorOccurredAt).toLocaleDateString()}</p>`);
    }

    if (dataErrorFields.length > 0) {
      html += '<br/>' + dataErrorFields.join('');
    }
  }

  html += `
<br/>
<hr/>
<p style="color: #888; font-size: 0.9em;">Dashboard Request ID: ${request.id}</p>`;

  return html.trim();
}

// Helper to escape HTML special characters
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Sync result type
interface SyncResult {
  success: boolean;
  wrikeTaskId?: string;
  wrikePermalink?: string;
  error?: string;
}

/**
 * Create a Wrike task for a new dashboard request
 */
export async function syncToWrike(requestId: string): Promise<SyncResult> {
  // Check if Wrike is configured
  if (!isWrikeConfigured()) {
    console.log('[Wrike] Integration not configured, skipping sync');
    return { success: true }; // Not an error, just not configured
  }

  const request = await prisma.dashboardRequest.findUnique({
    where: { id: requestId },
    include: {
      submitter: {
        select: { id: true, name: true, email: true },
      },
    },
  });

  if (!request) {
    return { success: false, error: 'Request not found' };
  }

  // Already synced?
  if (request.wrikeTaskId) {
    console.log(`[Wrike] Request ${requestId} already synced to task ${request.wrikeTaskId}`);
    return { success: true, wrikeTaskId: request.wrikeTaskId };
  }

  try {
    // Build custom fields
    const customFields: Array<{ id: string; value: string }> = [];

    if (request.priority) {
      customFields.push({
        id: WRIKE_CONFIG.CUSTOM_FIELD_IDS.PRIORITY,
        value: PRIORITY_TO_WRIKE[request.priority],
      });
    }

    // Create task data
    const taskData: CreateTaskData = {
      title: `[${request.requestType === 'FEATURE_REQUEST' ? 'Feature' : 'Data Error'}] ${request.title}`,
      description: formatDescriptionForWrike(request),
      customStatus: STATUS_TO_WRIKE[request.status],
      customFields: customFields.length > 0 ? customFields : undefined,
      metadata: [
        { key: 'dashboardRequestId', value: request.id },
      ],
    };

    const folderId = process.env.WRIKE_FOLDER_ID || WRIKE_CONFIG.FOLDER_ID;
    const [task] = await wrikeClient.createTask(folderId, taskData);

    // Update local record with Wrike info
    await prisma.dashboardRequest.update({
      where: { id: requestId },
      data: {
        wrikeTaskId: task.id,
        wrikePermalink: task.permalink,
        lastSyncedAt: new Date(),
      },
    });

    console.log(`[Wrike] Created task ${task.id} for request ${requestId}`);
    return {
      success: true,
      wrikeTaskId: task.id,
      wrikePermalink: task.permalink,
    };
  } catch (error) {
    console.error('[Wrike] Failed to sync to Wrike:', error);

    // Log sync failure but don't fail the request creation
    await prisma.dashboardRequest.update({
      where: { id: requestId },
      data: {
        lastSyncedAt: null, // null indicates sync failed
      },
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Update Wrike task when request status changes
 */
export async function syncStatusToWrike(
  requestId: string,
  newStatus: RequestStatus
): Promise<SyncResult> {
  if (!isWrikeConfigured()) {
    return { success: true };
  }

  const request = await prisma.dashboardRequest.findUnique({
    where: { id: requestId },
    select: { wrikeTaskId: true },
  });

  if (!request?.wrikeTaskId) {
    console.log(`[Wrike] No Wrike task for request ${requestId}, skipping status sync`);
    return { success: true };
  }

  try {
    await wrikeClient.updateTask(request.wrikeTaskId, {
      customStatus: STATUS_TO_WRIKE[newStatus],
    });

    await prisma.dashboardRequest.update({
      where: { id: requestId },
      data: { lastSyncedAt: new Date() },
    });

    console.log(`[Wrike] Updated task ${request.wrikeTaskId} status to ${newStatus}`);
    return { success: true, wrikeTaskId: request.wrikeTaskId };
  } catch (error) {
    console.error('[Wrike] Failed to sync status:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Update Wrike task when request is updated
 */
export async function syncUpdateToWrike(
  requestId: string,
  updates: {
    title?: string;
    description?: string;
    priority?: RequestPriority | null;
  }
): Promise<SyncResult> {
  if (!isWrikeConfigured()) {
    return { success: true };
  }

  const request = await prisma.dashboardRequest.findUnique({
    where: { id: requestId },
    select: { wrikeTaskId: true, requestType: true },
  });

  if (!request?.wrikeTaskId) {
    return { success: true };
  }

  try {
    const updateData: Record<string, unknown> = {};

    if (updates.title) {
      const prefix = request.requestType === 'FEATURE_REQUEST' ? 'Feature' : 'Data Error';
      updateData.title = `[${prefix}] ${updates.title}`;
    }

    if (updates.description) {
      updateData.description = updates.description;
    }

    if (updates.priority !== undefined) {
      updateData.customFields = updates.priority
        ? [{ id: WRIKE_CONFIG.CUSTOM_FIELD_IDS.PRIORITY, value: PRIORITY_TO_WRIKE[updates.priority] }]
        : [];
    }

    if (Object.keys(updateData).length > 0) {
      await wrikeClient.updateTask(request.wrikeTaskId, updateData);

      await prisma.dashboardRequest.update({
        where: { id: requestId },
        data: { lastSyncedAt: new Date() },
      });

      console.log(`[Wrike] Updated task ${request.wrikeTaskId}`);
    }

    return { success: true, wrikeTaskId: request.wrikeTaskId };
  } catch (error) {
    console.error('[Wrike] Failed to sync update:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Sync comment to Wrike task
 */
export async function syncCommentToWrike(
  requestId: string,
  commentId: string,
  authorName: string,
  content: string
): Promise<{ success: boolean; wrikeCommentId?: string; error?: string }> {
  if (!isWrikeConfigured()) {
    return { success: true };
  }

  const request = await prisma.dashboardRequest.findUnique({
    where: { id: requestId },
    select: { wrikeTaskId: true },
  });

  if (!request?.wrikeTaskId) {
    return { success: true };
  }

  try {
    // Format comment with author name using HTML
    const formattedComment = `<p><strong>${escapeHtml(authorName)}</strong> commented:</p><p>${escapeHtml(content).replace(/\n/g, '<br/>')}</p>`;
    const [wrikeComment] = await wrikeClient.addComment(request.wrikeTaskId, formattedComment);

    // Update comment with Wrike ID
    await prisma.requestComment.update({
      where: { id: commentId },
      data: { wrikeCommentId: wrikeComment.id },
    });

    console.log(`[Wrike] Added comment ${wrikeComment.id} to task ${request.wrikeTaskId}`);
    return { success: true, wrikeCommentId: wrikeComment.id };
  } catch (error) {
    console.error('[Wrike] Failed to sync comment:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Delete Wrike task when request is deleted
 */
export async function deleteFromWrike(requestId: string): Promise<SyncResult> {
  if (!isWrikeConfigured()) {
    return { success: true };
  }

  const request = await prisma.dashboardRequest.findUnique({
    where: { id: requestId },
    select: { wrikeTaskId: true },
  });

  if (!request?.wrikeTaskId) {
    return { success: true };
  }

  try {
    await wrikeClient.deleteTask(request.wrikeTaskId);
    console.log(`[Wrike] Deleted task ${request.wrikeTaskId}`);
    return { success: true };
  } catch (error) {
    // If task doesn't exist in Wrike, that's fine
    if (error instanceof WrikeAPIError && error.statusCode === 404) {
      return { success: true };
    }
    console.error('[Wrike] Failed to delete task:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get Wrike sync status for a request
 */
export async function getWrikeSyncStatus(requestId: string): Promise<{
  synced: boolean;
  wrikeTaskId?: string;
  wrikePermalink?: string;
  lastSyncedAt?: Date;
}> {
  const request = await prisma.dashboardRequest.findUnique({
    where: { id: requestId },
    select: { wrikeTaskId: true, wrikePermalink: true, lastSyncedAt: true },
  });

  return {
    synced: !!request?.wrikeTaskId && !!request?.lastSyncedAt,
    wrikeTaskId: request?.wrikeTaskId ?? undefined,
    wrikePermalink: request?.wrikePermalink ?? undefined,
    lastSyncedAt: request?.lastSyncedAt ?? undefined,
  };
}

/**
 * Manual retry for failed syncs
 */
export async function retrySyncToWrike(requestId: string): Promise<SyncResult> {
  return syncToWrike(requestId);
}
