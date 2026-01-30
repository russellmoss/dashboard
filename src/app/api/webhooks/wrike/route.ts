import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { WRIKE_TO_STATUS, WrikeWebhookEvent } from '@/types/wrike';

export const dynamic = 'force-dynamic';

const WEBHOOK_SECRET = process.env.WRIKE_WEBHOOK_SECRET;

/**
 * Verify webhook signature using HMAC SHA256
 */
function verifyWebhookSignature(
  payload: string,
  signature: string | null
): boolean {
  if (!WEBHOOK_SECRET || !signature) {
    console.warn('[Wrike Webhook] Secret not configured or signature missing');
    // In development, allow unsigned webhooks for testing
    return process.env.NODE_ENV === 'development';
  }

  const expectedSignature = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(payload)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch {
    return false;
  }
}

/**
 * Process a single Wrike webhook event
 */
async function processWrikeEvent(event: WrikeWebhookEvent): Promise<void> {
  const { taskId, eventType } = event;

  // Find our request by Wrike task ID
  const request = await prisma.dashboardRequest.findFirst({
    where: { wrikeTaskId: taskId },
  });

  if (!request) {
    console.log(`[Wrike Webhook] No matching request for Wrike task ${taskId}`);
    return;
  }

  // Prevent sync loops - check if we recently updated this request
  const recentlyUpdated = request.updatedAt > new Date(Date.now() - 5000);
  if (recentlyUpdated) {
    console.log(`[Wrike Webhook] Skipping event for ${taskId} - recently updated locally`);
    return;
  }

  console.log(`[Wrike Webhook] Processing ${eventType} for request ${request.id}`);

  switch (eventType) {
    case 'TaskStatusChanged': {
      const newStatusId = event.newStatusId;
      if (!newStatusId) break;

      const newStatus = WRIKE_TO_STATUS[newStatusId];
      if (newStatus && newStatus !== request.status) {
        const previousStatus = request.status;

        await prisma.$transaction(async (tx) => {
          // Create edit history entry
          await tx.requestEditHistory.create({
            data: {
              requestId: request.id,
              fieldName: 'status',
              oldValue: previousStatus,
              newValue: newStatus,
              editedById: request.submitterId, // Use submitter as fallback
            },
          });

          // Update the request
          await tx.dashboardRequest.update({
            where: { id: request.id },
            data: {
              status: newStatus,
              statusChangedAt: new Date(),
              lastSyncedAt: new Date(),
            },
          });
        });

        console.log(`[Wrike Webhook] Updated request ${request.id} status: ${previousStatus} -> ${newStatus}`);

        // Create notification for submitter
        await prisma.requestNotification.create({
          data: {
            userId: request.submitterId,
            requestId: request.id,
            message: `Your request "${request.title}" status changed from ${previousStatus} to ${newStatus}`,
          },
        });
      }
      break;
    }

    case 'TaskTitleChanged': {
      const newTitle = event.newTitle;
      if (newTitle) {
        // Strip the prefix [Feature] or [Data Error] if present
        const cleanTitle = newTitle.replace(/^\[(Feature|Data Error)\]\s*/i, '');

        await prisma.$transaction(async (tx) => {
          await tx.requestEditHistory.create({
            data: {
              requestId: request.id,
              fieldName: 'title',
              oldValue: request.title,
              newValue: cleanTitle,
              editedById: request.submitterId,
            },
          });

          await tx.dashboardRequest.update({
            where: { id: request.id },
            data: {
              title: cleanTitle,
              lastSyncedAt: new Date(),
            },
          });
        });

        console.log(`[Wrike Webhook] Updated request ${request.id} title`);
      }
      break;
    }

    case 'TaskDeleted': {
      // Clear Wrike reference but don't delete the request
      await prisma.dashboardRequest.update({
        where: { id: request.id },
        data: {
          wrikeTaskId: null,
          wrikePermalink: null,
          lastSyncedAt: null,
        },
      });
      console.log(`[Wrike Webhook] Cleared Wrike reference for request ${request.id}`);
      break;
    }

    case 'CommentAdded': {
      // We could sync comments from Wrike back to dashboard
      // For now, just log it
      console.log(`[Wrike Webhook] Comment added to Wrike task ${taskId}`);
      break;
    }

    default:
      console.log(`[Wrike Webhook] Unhandled event type: ${eventType}`);
  }
}

/**
 * POST /api/webhooks/wrike
 * Handle incoming Wrike webhook events
 */
export async function POST(request: NextRequest) {
  try {
    const headersList = await headers();
    const hookSecret = headersList.get('X-Hook-Secret');
    const signature = headersList.get('X-Wrike-Signature');

    // Handle Wrike's webhook verification handshake
    // Wrike sends X-Hook-Secret on setup, we need to echo it back
    if (hookSecret) {
      console.log('[Wrike Webhook] Responding to verification handshake');
      return new NextResponse(null, {
        status: 200,
        headers: { 'X-Hook-Secret': hookSecret },
      });
    }

    // Get raw body for signature verification
    const rawBody = await request.text();

    if (!rawBody) {
      return NextResponse.json({ error: 'Empty body' }, { status: 400 });
    }

    // Verify signature
    if (!verifyWebhookSignature(rawBody, signature)) {
      console.error('[Wrike Webhook] Invalid signature');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    // Parse payload
    let payload: WrikeWebhookEvent[];
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    // Wrike sends events as an array
    if (!Array.isArray(payload)) {
      payload = [payload];
    }

    // Process each event
    for (const event of payload) {
      try {
        await processWrikeEvent(event);
      } catch (error) {
        console.error('[Wrike Webhook] Error processing event:', error);
        // Continue processing other events
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Wrike Webhook] Error:', error);
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}

/**
 * GET /api/webhooks/wrike
 * Health check endpoint
 */
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    configured: !!WEBHOOK_SECRET,
  });
}
