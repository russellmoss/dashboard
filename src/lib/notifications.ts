import sgMail from '@sendgrid/mail';
import { prisma } from './prisma';
import { RequestStatus } from '@prisma/client';

// Initialize SendGrid if API key is available
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

const FROM_EMAIL = process.env.EMAIL_FROM || 'noreply@savvywealth.com';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

// Check if email is configured
function isEmailConfigured(): boolean {
  return !!(process.env.SENDGRID_API_KEY && FROM_EMAIL);
}

interface NotifyOptions {
  userId: string;
  requestId: string;
  message: string;
  emailSubject?: string;
  emailBody?: string;
  skipEmail?: boolean;
}

/**
 * Create an in-app notification and optionally send an email
 */
export async function createNotification({
  userId,
  requestId,
  message,
  emailSubject,
  emailBody,
  skipEmail = false,
}: NotifyOptions) {
  // Create in-app notification
  const notification = await prisma.requestNotification.create({
    data: {
      userId,
      requestId,
      message,
    },
  });

  // Send email if configured and not skipped
  if (!skipEmail && emailSubject && isEmailConfigured()) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true },
    });

    if (user?.email) {
      try {
        await sgMail.send({
          to: user.email,
          from: FROM_EMAIL,
          subject: emailSubject,
          html: emailBody || `<p>${message}</p>`,
        });
        console.log(`[Notifications] Email sent to ${user.email}`);
      } catch (error) {
        console.error('[Notifications] Failed to send email:', error);
        // Don't throw - email failure shouldn't break the flow
      }
    }
  }

  return notification;
}

// Status labels for notifications
const STATUS_LABELS: Record<RequestStatus, string> = {
  SUBMITTED: 'Submitted',
  PLANNED: 'Planned',
  IN_PROGRESS: 'In Progress',
  DONE: 'Done',
  ARCHIVED: 'Archived',
};

/**
 * Notify user when their request status changes
 */
export async function notifyStatusChange(
  requestId: string,
  oldStatus: RequestStatus,
  newStatus: RequestStatus
) {
  const request = await prisma.dashboardRequest.findUnique({
    where: { id: requestId },
    include: { submitter: true },
  });

  if (!request) return;

  const oldLabel = STATUS_LABELS[oldStatus];
  const newLabel = STATUS_LABELS[newStatus];

  await createNotification({
    userId: request.submitterId,
    requestId,
    message: `Your request "${request.title}" status changed to ${newLabel}`,
    emailSubject: `[Dashboard Request] Status Update: ${request.title}`,
    emailBody: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #2563eb; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
          .content { background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; }
          .status-change { background: white; padding: 15px; border-radius: 8px; margin: 15px 0; }
          .old-status { color: #6b7280; text-decoration: line-through; }
          .new-status { color: #059669; font-weight: bold; }
          .button { display: inline-block; background: #2563eb; color: #ffffff !important; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 15px; }
          a.button { color: #ffffff !important; }
          .footer { color: #6b7280; font-size: 12px; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2 style="margin: 0;">Request Status Updated</h2>
          </div>
          <div class="content">
            <p>Hi ${request.submitter.name},</p>
            <p>Your dashboard request has been updated:</p>

            <div class="status-change">
              <p><strong>Request:</strong> ${request.title}</p>
              <p><strong>Status:</strong> <span class="old-status">${oldLabel}</span> → <span class="new-status">${newLabel}</span></p>
            </div>

            <a href="${APP_URL}/dashboard/requests" class="button" style="color: #ffffff !important;">View Request</a>

            <p class="footer">
              This is an automated notification from the Savvy Dashboard.<br/>
              You received this because you submitted this request.
            </p>
          </div>
        </div>
      </body>
      </html>
    `,
  });
}

/**
 * Notify request submitter when someone comments on their request
 */
export async function notifyNewComment(
  requestId: string,
  commentAuthorId: string,
  commentContent: string
) {
  const request = await prisma.dashboardRequest.findUnique({
    where: { id: requestId },
    include: { submitter: true },
  });

  if (!request) return;

  // Don't notify if the submitter is the one who commented
  if (request.submitterId === commentAuthorId) return;

  const author = await prisma.user.findUnique({
    where: { id: commentAuthorId },
    select: { name: true },
  });

  const authorName = author?.name || 'Someone';
  const commentPreview = commentContent.length > 100
    ? commentContent.substring(0, 100) + '...'
    : commentContent;

  await createNotification({
    userId: request.submitterId,
    requestId,
    message: `${authorName} commented on "${request.title}"`,
    emailSubject: `[Dashboard Request] New Comment: ${request.title}`,
    emailBody: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #2563eb; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
          .content { background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; }
          .comment-box { background: white; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #2563eb; }
          .comment-author { font-weight: bold; color: #1f2937; }
          .comment-text { color: #4b5563; margin-top: 8px; }
          .button { display: inline-block; background: #2563eb; color: #ffffff !important; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 15px; }
          a.button { color: #ffffff !important; }
          .footer { color: #6b7280; font-size: 12px; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2 style="margin: 0;">New Comment on Your Request</h2>
          </div>
          <div class="content">
            <p>Hi ${request.submitter.name},</p>
            <p>Someone left a comment on your dashboard request:</p>

            <div class="comment-box">
              <p><strong>Request:</strong> ${request.title}</p>
              <p class="comment-author">${authorName} commented:</p>
              <p class="comment-text">"${commentPreview}"</p>
            </div>

            <a href="${APP_URL}/dashboard/requests" class="button" style="color: #ffffff !important;">View & Reply</a>

            <p class="footer">
              This is an automated notification from the Savvy Dashboard.<br/>
              You received this because you submitted this request.
            </p>
          </div>
        </div>
      </body>
      </html>
    `,
  });
}

/**
 * Get notifications for a user
 */
export async function getUserNotifications(userId: string, limit = 20) {
  return prisma.requestNotification.findMany({
    where: { userId },
    include: {
      request: {
        select: { id: true, title: true },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/**
 * Get unread notification count for a user
 */
export async function getUnreadCount(userId: string): Promise<number> {
  return prisma.requestNotification.count({
    where: {
      userId,
      isRead: false,
    },
  });
}

/**
 * Mark a notification as read
 */
export async function markAsRead(notificationId: string, userId: string) {
  return prisma.requestNotification.updateMany({
    where: {
      id: notificationId,
      userId, // Ensure user owns this notification
    },
    data: { isRead: true },
  });
}

/**
 * Mark all notifications as read for a user
 */
export async function markAllAsRead(userId: string) {
  return prisma.requestNotification.updateMany({
    where: {
      userId,
      isRead: false,
    },
    data: { isRead: true },
  });
}
