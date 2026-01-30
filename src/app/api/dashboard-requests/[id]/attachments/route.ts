import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// Max file size: 5MB
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const VALID_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/**
 * GET /api/dashboard-requests/[id]/attachments
 * Get all attachments for a request
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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

    const { id } = await params;

    const attachments = await prisma.requestAttachment.findMany({
      where: { requestId: id },
      select: {
        id: true,
        filename: true,
        mimeType: true,
        size: true,
        createdAt: true,
        uploadedBy: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ attachments });
  } catch (error) {
    console.error('[API] Error fetching attachments:', error);
    return NextResponse.json(
      { error: 'Failed to fetch attachments' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/dashboard-requests/[id]/attachments
 * Upload an attachment to a request
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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

    const { id } = await params;

    const userId = permissions.userId;
    if (!userId) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Verify request exists
    const dashboardRequest = await prisma.dashboardRequest.findUnique({
      where: { id },
      select: { id: true, submitterId: true },
    });

    if (!dashboardRequest) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }

    // Parse form data
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate file type
    if (!VALID_MIME_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: 'Invalid file type. Please upload PNG, JPEG, GIF, or WebP.' },
        { status: 400 }
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'File too large. Maximum size is 5MB.' },
        { status: 400 }
      );
    }

    // Convert file to base64
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const base64Data = buffer.toString('base64');

    // Create attachment record
    const attachment = await prisma.requestAttachment.create({
      data: {
        filename: file.name,
        mimeType: file.type,
        size: file.size,
        data: base64Data,
        requestId: id,
        uploadedById: userId,
      },
      select: {
        id: true,
        filename: true,
        mimeType: true,
        size: true,
        createdAt: true,
        uploadedBy: {
          select: { id: true, name: true },
        },
      },
    });

    return NextResponse.json({ attachment }, { status: 201 });
  } catch (error) {
    console.error('[API] Error uploading attachment:', error);
    return NextResponse.json(
      { error: 'Failed to upload attachment' },
      { status: 500 }
    );
  }
}
