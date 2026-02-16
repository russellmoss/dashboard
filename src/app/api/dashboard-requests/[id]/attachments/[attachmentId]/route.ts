import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * GET /api/dashboard-requests/[id]/attachments/[attachmentId]
 * Download/view an attachment
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Use permissions from session (derived from JWT, no DB query)
    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }
    if (permissions.role === 'recruiter') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id, attachmentId } = await params;

    const attachment = await prisma.requestAttachment.findFirst({
      where: {
        id: attachmentId,
        requestId: id,
      },
    });

    if (!attachment) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    }

    // If we have local data, return it
    if (attachment.data) {
      const buffer = Buffer.from(attachment.data, 'base64');
      // Sanitize filename for Content-Disposition header (ASCII only)
      // Replace non-ASCII chars with underscores for basic filename
      const safeFilename = attachment.filename.replace(/[^\x20-\x7E]/g, '_');
      // Also provide UTF-8 encoded filename for modern browsers
      const encodedFilename = encodeURIComponent(attachment.filename);
      return new NextResponse(buffer, {
        headers: {
          'Content-Type': attachment.mimeType,
          'Content-Disposition': `inline; filename="${safeFilename}"; filename*=UTF-8''${encodedFilename}`,
          'Content-Length': buffer.length.toString(),
        },
      });
    }

    // If we have a Wrike download URL, redirect to it
    if (attachment.wrikeDownloadUrl) {
      return NextResponse.redirect(attachment.wrikeDownloadUrl);
    }

    return NextResponse.json(
      { error: 'Attachment data not available' },
      { status: 404 }
    );
  } catch (error) {
    console.error('[API] Error fetching attachment:', error);
    return NextResponse.json(
      { error: 'Failed to fetch attachment' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/dashboard-requests/[id]/attachments/[attachmentId]
 * Delete an attachment
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Use permissions from session (derived from JWT, no DB query)
    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }
    if (permissions.role === 'recruiter') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id, attachmentId } = await params;

    const userId = permissions.userId;
    if (!userId) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const attachment = await prisma.requestAttachment.findFirst({
      where: {
        id: attachmentId,
        requestId: id,
      },
    });

    if (!attachment) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    }

    // Only uploader or admin can delete
    if (attachment.uploadedById !== userId && !permissions.canManageRequests) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await prisma.requestAttachment.delete({
      where: { id: attachmentId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API] Error deleting attachment:', error);
    return NextResponse.json(
      { error: 'Failed to delete attachment' },
      { status: 500 }
    );
  }
}
